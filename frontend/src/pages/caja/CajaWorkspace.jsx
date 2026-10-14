import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import usePolling from '@/hooks/usePolling';
import { confirmOrderPayment } from '@/lib/api/orders';
import { get as apiGet } from '@/lib/api/request';
import { DIGITAL_METHODS } from '@/lib/paymentMethods';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StateBadge } from '@/components/StateBadge';
import { fmtMoney, fmtTime, fmtDateTime, elapsedMinutes, PAYMENT_LABELS, countOf } from '@/lib/format';
import { Wallet, DollarSign, Lock, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useRealtimeGeneration } from '@/contexts/NotifyContext';
import { accountLabel } from '@/lib/cash';
import CobrarDialog from '@/components/CobrarDialog';
import AccountPaymentAudit from '@/components/AccountPaymentAudit';
import WebOrderRow from '@/pages/caja/WebOrderRow';
import PrepayQueue from '@/pages/caja/PrepayQueue';
import PaymentHistory from '@/pages/caja/PaymentHistory';
import SoldDishes from '@/pages/caja/SoldDishes';
import CashHistory from '@/pages/caja/CashHistory';
import OpenCajaCard from '@/pages/caja/OpenCajaCard';
import CloseCajaDialog from '@/pages/caja/CloseCajaDialog';
import MovementCard from '@/pages/caja/MovementCard';
import CajaKpis from '@/pages/caja/CajaKpis';
import { apiErrorMessage } from '@/lib/apiError';

export default function CajaWorkspace({ ownerContext = false, contextKey = 'staff', scopeParams = {}, selectedBranchId = null, branches = [], canOpen = true, runMutation, onCollectionChange }) {
    const [params, setParams] = useSearchParams();
    const [pendingOrder, setPendingOrder] = useState(null);
    const [closeDialog, setCloseDialog] = useState(false);
    const [tab, setTab] = useState('cobrar');
    const [histKind, setHistKind] = useState('pagos');
    const [query, setQuery] = useState('');

    // Each query follows only the topics it renders. Every payment also emits an
    // order event, so `orders` already covers the pending list's totals.
    const cashGeneration = useRealtimeGeneration(['cash', 'payments']);
    const pendingGeneration = useRealtimeGeneration(['orders', 'payments', 'prepay']);
    const tablesGeneration = useRealtimeGeneration(['tables']);
    const paymentsGeneration = useRealtimeGeneration(['payments', 'prepay']);
    const scopeOptions = useCallback((baseParams = {}) => {
        const params = { ...baseParams, ...scopeParams };
        return Object.keys(params).length ? { params } : undefined;
    }, [scopeParams]);
    const scopedGet = useCallback((path, baseParams) => {
        const options = scopeOptions(baseParams);
        return apiGet(path, options);
    }, [scopeOptions]);
    const { data: register, error: registerError, loading, refetch: refetchReg } = usePolling(
        () => scopedGet('/cash/current').then((r) => r.data), 12000, [cashGeneration, contextKey]
    );
    const { data: pending, error: pendingError, refetch: refetchPending } = usePolling(
        () => scopedGet('/orders', { active_only: true }).then((r) => r.data),
        12000,
        [pendingGeneration, contextKey]
    );
    const { data: tables } = usePolling(() => scopedGet('/tables').then((r) => r.data), 20000, [tablesGeneration, contextKey]);
    // Pagos de hoy: la misma fuente que el historial (`/payments?period=day`),
    // sólo para los KPIs. El cobro anulado/devuelto no cuenta como venta.
    const { data: dayPayments } = usePolling(
        () => scopedGet('/payments', { period: 'day', limit: 200 }).then((r) => r.data),
        12000,
        [paymentsGeneration, contextKey]
    );

    const selectOrder = useCallback((order) => {
        setPendingOrder(order);
        onCollectionChange?.(!!order);
    }, [onCollectionChange]);
    const closeCollection = useCallback(() => {
        setPendingOrder(null);
        onCollectionChange?.(false);
    }, [onCollectionChange]);

    /**
     * `?order=<id>` abre el cobro de esa cuenta: es el enlace que usa el detalle
     * del pedido cuando no hay turno abierto, y el que usa el salón en "Cobrar".
     *
     * Se consume **una sola vez**. Antes se releía en cada pasada, así que
     * cualquier sondeo que cambiara la lista de cuentas —el piso se mueve solo
     * cada pocos segundos— volvía a abrir el diálogo que el mozo acababa de
     * cerrar. Quitar el parámetro de la URL, además, deja la barra de dirección
     * diciendo lo que hay en pantalla.
     */
    useEffect(() => {
        const id = params.get('order');
        if (!id || !pending) return;
        const hit = pending.find((o) => o.id === id);
        if (!hit) return;
        selectOrder(hit);
        const rest = new URLSearchParams(params);
        rest.delete('order');
        setParams?.(rest, { replace: true });
    }, [params, pending, selectOrder, setParams]);

    const cobrables = useMemo(() => {
        // Un pedido web con comprobante ya subido se resuelve en su propio bloque
        // (Ver comprobante / Confirmar). Se excluye de las listas de cobro para que
        // una misma cuenta no ofrezca dos acciones de dinero a la vez.
        const list = (pending || []).filter((o) => o.status !== 'pagado' && o.status !== 'cancelado');
        const requested = list.filter((o) => o.payment_requested || o.status === 'pendiente_pago');
        const rest = list.filter((o) => !(o.payment_requested || o.status === 'pendiente_pago'));
        return [...requested, ...rest].map((o) => ({
            ...o,
            table_number: (tables || []).find((t) => t.id === o.table_id)?.number,
        }));
    }, [pending, tables]);

    const requestedBills = useMemo(() => cobrables.filter((o) => o.payment_requested || o.status === 'pendiente_pago'), [cobrables]);
    const otherBills = useMemo(() => cobrables.filter((o) => !(o.payment_requested || o.status === 'pendiente_pago')), [cobrables]);

    // KPIs del día: ventas/cobros de los pagos de hoy y saldo de las cuentas
    // abiertas que la página ya lista. Un pago anulado o devuelto no es venta.
    const todayPayments = useMemo(
        () => (Array.isArray(dayPayments) ? dayPayments : []).filter((p) => (p.status || 'completed') === 'completed'),
        [dayPayments]
    );
    const daySales = todayPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const openDue = cobrables.reduce(
        (sum, o) => sum + Math.max(0, Number(o.total || 0) - Number(o.amount_paid || 0)),
        0
    );

    const matchQ = (o) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return `${o.order_number} ${o.customer_name || ''} ${o.table_id || ''} ${accountLabel(o)}`.toLowerCase().includes(q);
    };

    // Los pedidos que esperan verificación de prepago tienen su propia cola:
    // acá quedan los web que ya entraron a cocina y solo falta comprobar el pago.
    const webPending = useMemo(() =>
        (pending || []).filter((o) =>
            o.source === 'public'
            && o.status !== 'pagado'
            && o.status !== 'cancelado'
            && o.payment_status !== 'confirmado'
            && o.acceptance_status !== 'pendiente'
        )
    , [pending]);

    const confirmWeb = async (order) => {
        try {
            await runMutation(() => confirmOrderPayment(order.id));
            toast.success(`Pedido #${order.order_number}: pago web confirmado`);
            refetchPending();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo confirmar'));
        }
    };

    if (loading && register == null) {
        return (
            <div className="space-y-5" data-testid="caja-root">
                <div>
                    <p className="page-kicker mb-1">Caja</p>
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Caja</h1>
                </div>
                <p className="text-sm text-muted-foreground">Cargando caja…</p>
            </div>
        );
    }

    const loadFailure = registerError || pendingError;
    const retryLoad = () => { refetchReg(); refetchPending(); };
    const loadErrorBanner = loadFailure ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" data-testid="caja-error">
            <span className="font-medium">
                No se pudo leer la caja. {(loadFailure.response && apiErrorMessage(loadFailure, '')) || 'Los datos pueden estar desactualizados.'}
            </span>
            <Button variant="outline" className="h-11" onClick={retryLoad} data-testid="caja-error-reintentar">Reintentar</Button>
        </div>
    ) : null;

    // Sin poder leer la caja no se sabe si está abierta: ofrecer "abrir caja" sería mentir.
    if (!register && registerError) return (
        <div className="space-y-4" data-testid="caja-root">
            <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Caja</h1>
            {loadErrorBanner}
        </div>
    );

    if (!register) return (
        <div className="space-y-4" data-testid="caja-root">
            <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Caja</h1>
            <CajaKpis ventas={daySales} cobros={todayPayments.length} porCobrar={openDue} />
                {ownerContext && scopeParams.legacy_only ? (
                    <p className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">No hay una caja histórica abierta</p>
                ) : <OpenCajaCard onOpened={refetchReg} branchId={selectedBranchId} canOpen={canOpen} runMutation={runMutation} />}
            {cobrables.length > 0 && (
                <Card data-testid="caja-cuentas-cerradas">
                    <CardContent className="p-4">
                        <h2 className="font-display text-lg font-semibold mb-1">Cuentas esperando tu turno ({cobrables.length})</h2>
                        <p className="text-xs text-muted-foreground mb-3">Abre la caja para cobrarlas.</p>
                        <div className="divide-y opacity-70">
                            {cobrables.slice(0, 8).map((o) => (
                                <div key={o.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-display font-bold truncate">{accountLabel(o)}</span>
                                        {(o.payment_requested || o.status === 'pendiente_pago') && <span className="text-xs text-primary shrink-0">Cuenta solicitada</span>}
                                    </div>
                                    <span className="font-mono font-semibold tabular-nums shrink-0">{fmtMoney(o.total)}</span>
                                </div>
                            ))}
                        </div>
                        {cobrables.length > 8 && <div className="text-xs text-muted-foreground mt-2">y {cobrables.length - 8} más…</div>}
                    </CardContent>
                </Card>
            )}
            <CashHistory refreshKey={contextKey} scopeParams={scopeParams} />
        </div>
    );

    return (
        <div className="space-y-5" data-testid="caja-root">
            {loadErrorBanner}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Caja</h1>
                    <p className="text-muted-foreground text-sm">Turno de {register.opened_by_name} · {fmtDateTime(register.opened_at)}</p>
                </div>
                <div className="flex gap-2">
                    {['cobrar', 'historial', 'turno'].map((k) => (
                <Button key={k} variant={tab === k ? 'default' : 'outline'} className="h-11" onClick={() => setTab(k)}>
                            {k === 'cobrar' ? 'Cobrar' : k === 'historial' ? 'Historial' : 'Mi turno'}
                        </Button>
                    ))}
                </div>
            </div>

            <CajaKpis ventas={daySales} cobros={todayPayments.length} porCobrar={openDue} />

            <Card><CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div><div className="text-xs text-muted-foreground">Monto inicial</div><div className="font-display text-xl font-semibold tabular-nums">{fmtMoney(register.opening_amount)}</div></div>
                <div><div className="text-xs text-muted-foreground">Caja</div><StateBadge status={register.status === 'open' ? 'disponible' : 'inactiva'} type="table" /></div>
            </CardContent></Card>

            {tab === 'cobrar' && (
            <>
            <PrepayQueue runMutation={runMutation} onChanged={() => { refetchPending(); refetchReg(); }} />

            {webPending.length > 0 && (
                <Card><CardContent className="p-4">
                    <h2 className="font-display text-lg font-semibold mb-3">Pedidos web ({webPending.length})</h2>
                    <div className="divide-y">
                        {webPending.map((o) => (
                            <WebOrderRow key={o.id} order={o} scopeParams={scopeParams} onConfirm={() => confirmWeb(o)} />
                        ))}
                    </div>
                </CardContent></Card>
            )}

            {cobrables.length > 0 && (
                <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9 h-11 sm:max-w-xs" placeholder="Buscar mesa, cliente o #pedido" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="caja-buscar" />
                </div>
            )}

            {requestedBills.length > 0 && (
                <Card className="border-primary/40" data-testid="caja-solicitadas"><CardContent className="p-4">
                    <h2 className="font-display text-lg font-semibold mb-3">Cuentas solicitadas ({requestedBills.length})</h2>
                    <div className="divide-y">
                        {requestedBills.filter(matchQ).map((o) => (
                            <div key={o.id} className="py-3 flex items-center justify-between gap-3" data-testid={`caja-pedido-${o.order_number}`}>
                                <div className="min-w-0">
                                    <div className="font-display text-lg font-bold truncate">{accountLabel(o)}</div>
                                    <div className="text-xs text-muted-foreground">{fmtTime(o.created_at)} · {elapsedMinutes(o.created_at)} min · {countOf((o.items || []).length, 'ítem', 'ítems')}</div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="font-display text-xl font-bold tabular-nums">{fmtMoney(o.total)}</div>
                                    <Button asChild size="sm" variant="outline" className="mt-1 h-11">
                                        <Link to={`/pedidos/${o.id}`} data-testid={`caja-ver-${o.order_number}`}>Ver</Link>
                                    </Button>
                                    {o.payment_status === 'pagado' ? <div className="text-xs text-primary mt-1">Pagado · sigue en cocina</div> : <Button size="sm" className="mt-1 h-11" onClick={() => selectOrder(o)} data-testid={`caja-cobrar-${o.order_number}`}><DollarSign className="h-4 w-4 mr-1" />Cobrar</Button>}
                                    <AccountPaymentAudit order={o} scopeParams={scopeParams} />
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent></Card>
            )}

            <Card data-testid="caja-otras"><CardContent className="p-4">
                <h2 className="font-display text-lg font-semibold mb-3">Otras cuentas ({otherBills.length})</h2>
                {cobrables.length === 0 || otherBills.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                        {cobrables.length === 0 ? 'No hay cuentas activas' : 'No hay otras cuentas. ¡Todo al día!'}
                    </div>
                ) : (
                    <div className="divide-y">
                        {otherBills.filter(matchQ).map((o) => (
                            <div key={o.id} className="py-3 flex items-center justify-between gap-3" data-testid={`caja-pedido-${o.order_number}`}>
                                <div className="min-w-0">
                                    <div className="font-display text-lg font-bold truncate">{accountLabel(o)}</div>
                                    <div className="text-xs text-muted-foreground">{fmtTime(o.created_at)} · {elapsedMinutes(o.created_at)} min · {countOf((o.items || []).length, 'ítem', 'ítems')}</div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="font-display text-xl font-bold tabular-nums">{fmtMoney(o.total)}</div>
                                    <Button asChild size="sm" variant="outline" className="mt-1 h-11">
                                        <Link to={`/pedidos/${o.id}`} data-testid={`caja-ver-${o.order_number}`}>Ver</Link>
                                    </Button>
                                    {o.payment_status === 'pagado' ? <div className="text-xs text-primary mt-1">Pagado · sigue en cocina</div> : <Button size="sm" className="mt-1 h-11" onClick={() => selectOrder(o)} data-testid={`caja-cobrar-${o.order_number}`}><DollarSign className="h-4 w-4 mr-1" />Cobrar</Button>}
                                    <AccountPaymentAudit order={o} scopeParams={scopeParams} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent></Card>
            </>
            )}

            {tab === 'historial' && (
            <div className="space-y-4">
                <div className="flex gap-2 flex-wrap">
                    {[['pagos', 'Pagos'], ['platos', 'Platos'], ['turnos', 'Turnos']].map(([k, lab]) => (
                        <Button key={k} variant={histKind === k ? 'default' : 'outline'} className="h-11" onClick={() => setHistKind(k)} data-testid={`caja-hist-${k}`}>
                            {lab}
                        </Button>
                    ))}
                </div>
                {histKind === 'pagos' && <PaymentHistory refreshKey={register?.id} scopeParams={scopeParams} runMutation={runMutation} />}
                {histKind === 'platos' && <SoldDishes refreshKey={register?.id} scopeParams={scopeParams} contextKey={contextKey} branchName={branches.find((branch) => String(branch.id) === String(selectedBranchId))?.name} />}
                {histKind === 'turnos' && <CashHistory refreshKey={register?.id} scopeParams={scopeParams} />}
            </div>
            )}

            {tab === 'turno' && (
            <div className="space-y-5">
                <Card><CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div><div className="text-xs text-muted-foreground">Fondo inicial</div><div className="font-display text-xl font-semibold tabular-nums">{fmtMoney(register.opening_amount)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Efectivo esperado</div><div className="font-display text-xl font-semibold tabular-nums" data-testid="caja-turno-esperado">{fmtMoney(register.expected_amount)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Cobros en efectivo</div><div className="font-mono font-semibold tabular-nums">{fmtMoney(register.cash_sales)}</div></div>
                    {DIGITAL_METHODS.map((m) => (
                        Number((register.by_method || {})[m] || 0) > 0 ? (
                            <div key={m}><div className="text-xs text-muted-foreground">{PAYMENT_LABELS[m]}</div><div className="font-mono font-semibold tabular-nums">{fmtMoney(register.by_method[m])}</div></div>
                        ) : null
                    ))}
                </CardContent></Card>
                <MovementCard register={register} onAdded={refetchReg} runMutation={runMutation} />
                <Button variant="outline" onClick={() => { refetchReg(); setCloseDialog(true); }} className="h-12 w-full" data-testid="caja-cerrar-button"><Lock className="h-4 w-4 mr-2" /> Cerrar turno</Button>
            </div>
            )}
            <CobrarDialog open={!!pendingOrder} onOpenChange={(o) => !o && closeCollection()} order={pendingOrder} onPaid={() => { refetchPending(); refetchReg(); }} />
            <CloseCajaDialog open={closeDialog} onOpenChange={setCloseDialog} register={register} onClosed={refetchReg} runMutation={runMutation} />
        </div>
    );
}
