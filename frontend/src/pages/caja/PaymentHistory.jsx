import { useState, useMemo, useEffect, useCallback } from 'react';
import { getOrder } from '@/lib/api/orders';
import { createApproval, listPayments, voidPayment } from '@/lib/api/payments';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { fmtMoney, fmtDateTime, PAYMENT_LABELS } from '@/lib/format';
import { PAYMENT_RECORD_STATUS_LABELS } from '@/constants/status';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { ACTIONS, can } from '@/lib/permissions';
import { Textarea } from '@/components/ui/textarea';
import { printCajaReceipt } from '@/lib/printReceipt';
import { accountLabel } from '@/lib/cash';
import { apiErrorMessage } from '@/lib/apiError';
import useRestaurantName from '@/hooks/useRestaurantName';

export default function PaymentHistory({ refreshKey, scopeParams = {}, runMutation }) {
    const { user } = useAuth();
    const restaurantName = useRestaurantName();
    const scopeOptions = useCallback(() => Object.keys(scopeParams).length ? { params: scopeParams } : undefined, [scopeParams]);
    const canVoid = can(user, ACTIONS.CASH_VOID);
    const [period, setPeriod] = useState('day');
    const [q, setQ] = useState('');
    const [items, setItems] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [detail, setDetail] = useState(null);
    const [voidKind, setVoidKind] = useState(null);
    const [voidReason, setVoidReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        const params = { period, limit: 200, ...scopeParams };
        if (q.trim()) params.q = q.trim();
        setLoadError(null);
        // Antes el fallo dejaba `items` en []: la pantalla decía «No hay pagos en
        // este período» y el cajero no podía distinguir una lista vacía de una
        // carga que no llegó.
        listPayments(params)
            .then((r) => setItems(r.data))
            .catch((e) => { setItems([]); setLoadError(apiErrorMessage(e, 'No se pudo cargar el historial de pagos')); });
    }, [period, q, refreshKey, reload, scopeParams]);

    const reprint = async (p) => {
        let order = null;
        try {
            const { data } = await getOrder(p.order_id, scopeOptions());
            order = data;
        } catch { /* payment still reprints from its own lines */ }
        const ok = printCajaReceipt({
            restaurantName,
            label: order ? accountLabel(order) : `Pedido #${p.order_number}`,
            order: order || { order_number: p.order_number, items: [] },
            payment: p,
            items: (p.lines || []).length
                ? p.lines.map((l) => ({ product_name: l.name, quantity: l.quantity, unit_price: 0, pay_qty: l.quantity }))
                : order?.items,
        });
        if (!ok) toast.error('El navegador bloqueó la ventana. Permite popups para imprimir.');
    };

    const submitVoid = async () => {
        if (!detail || !voidKind) return;
        // Anular o devolver mueve dinero: un segundo toque con el primero en vuelo
        // no puede mandar la misma operación otra vez.
        if (submitting) return;
        if ((voidReason || '').trim().length < 5) {
            toast.error('El motivo es obligatorio.');
            return;
        }
        setSubmitting(true);
        try {
            await runMutation(async () => {
                if (canVoid) {
                    const { data } = await voidPayment(detail.id, { kind: voidKind, reason: voidReason.trim() });
                    toast.success(voidKind === 'refund' ? 'Devolución registrada. El cobro sigue en el historial.' : 'Anulación registrada. El cobro no se eliminó.');
                    setDetail(data);
                } else {
                    await createApproval({ kind: voidKind, reason: voidReason.trim(), payment_id: detail.id });
                    toast.success('Solicitud enviada al encargado. No cobres de nuevo mientras tanto.');
                    setDetail(null);
                }
            });
            setVoidKind(null);
            setVoidReason('');
            setReload((n) => n + 1);
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo registrar'));
        } finally {
            setSubmitting(false);
        }
    };

    const statusLabel = (p) => (
        p.status === 'voided' || p.status === 'refunded' ? PAYMENT_RECORD_STATUS_LABELS[p.status] : null
    );

    // Compute method totals and status grouping
    const methodTotals = useMemo(() => {
        if (!items) return {};
        const map = {};
        for (const p of items) {
            if (p.status === 'completed') {
                const key = p.method;
                map[key] = (map[key] || 0) + Number(p.amount || 0);
            }
        }
        return map;
    }, [items]);

    return (
        <Card data-testid="caja-historial-pagos">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <h2 className="font-display text-lg font-semibold">Pagos registrados</h2>
                    <Tabs value={period} onValueChange={setPeriod}>
                        <TabsList>
                            <TabsTrigger value="day">Hoy</TabsTrigger>
                            <TabsTrigger value="week">Semana</TabsTrigger>
                            <TabsTrigger value="month">Mes</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>

                {/* Method totals summary */}
                {items && Object.keys(methodTotals).length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-lg border border-border p-3" data-testid="caja-pago-method-totals">
                        {Object.entries(methodTotals).map(([method, total]) => (
                            <div key={method} className="text-sm">
                                <div className="text-xs text-muted-foreground">{PAYMENT_LABELS[method] || method}</div>
                                <div className="font-mono font-semibold tabular-nums">{fmtMoney(total)}</div>
                            </div>
                        ))}
                    </div>
                )}

                <Input className="h-11" placeholder="Buscar #pedido, método o cajero" value={q} onChange={(e) => setQ(e.target.value)} data-testid="caja-hist-pagos-buscar" />
                {loadError && (
                    <div className="rounded-xl border border-destructive/50 p-3 text-sm text-destructive" data-testid="caja-hist-pagos-error">
                        {loadError}
                        <Button size="sm" variant="outline" className="ml-3 h-9" onClick={() => setReload((n) => n + 1)} data-testid="caja-hist-pagos-reintentar">
                            Reintentar
                        </Button>
                    </div>
                )}
                {!items ? (
                    <div className="text-sm text-muted-foreground">Cargando pagos…</div>
                ) : items.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                        {loadError ? 'No se pudo cargar el historial.' : 'No hay pagos en este período.'}
                    </div>
                ) : (
                    <div className="divide-y border border-border rounded-sm">
                        {items.map((p) => {
                            const isVoided = p.status === 'voided' || p.status === 'refunded';
                            return (
                                <div key={p.id} className={`px-3 py-2 flex items-center justify-between gap-3 text-sm ${isVoided ? 'caja-pago-voided opacity-60' : ''}`} data-testid={`caja-pago-${p.id}`}>
                                    <button type="button" className="text-left min-w-0" onClick={() => setDetail(p)}>
                                        <div className="font-medium">
                                            Pedido #{p.order_number} · {PAYMENT_LABELS[p.method] || p.method}
                                            {statusLabel(p) ? ` · ${statusLabel(p)}` : ''}
                                        </div>
                                        <div className="text-xs text-muted-foreground">{fmtDateTime(p.created_at)} · {p.paid_by_name}</div>
                                    </button>
                                    <div className="text-right shrink-0 space-y-1">
                                        <div className={`font-mono font-semibold tabular-nums ${isVoided ? 'line-through text-muted-foreground' : ''}`}>{fmtMoney(p.amount)}</div>
                                        <Button size="sm" variant="outline" onClick={() => reprint(p)} data-testid={`caja-reimprimir-${p.id}`}>
                                            <Printer className="h-3.5 w-3.5 mr-1" />Comprobante
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>Pago · Pedido #{detail?.order_number}</DialogTitle></DialogHeader>
                        {detail && (
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between"><span>Método</span><span>{PAYMENT_LABELS[detail.method] || detail.method}</span></div>
                                <div className="flex justify-between"><span>Importe</span><span className="font-mono">{fmtMoney(detail.amount)}</span></div>
                                {detail.change_amount > 0 && <div className="flex justify-between"><span>Vuelto</span><span className="font-mono">{fmtMoney(detail.change_amount)}</span></div>}
                                <div className="flex justify-between"><span>Cajero</span><span>{detail.paid_by_name}</span></div>
                                <div className="flex justify-between"><span>Hora</span><span>{fmtDateTime(detail.created_at)}</span></div>
                                {detail.status && detail.status !== 'completed' && (
                                    <div className="rounded-xl border border-border p-3 text-sm">
                                        {statusLabel(detail)} · {detail.void_reason} · {detail.voided_by_name}
                                    </div>
                                )}
                                {(detail.lines || []).length > 0 && (
                                    <div className="border-t pt-2 space-y-1">
                                        {detail.lines.map((l, i) => (
                                            <div key={i} className="flex justify-between"><span>{l.quantity}× {l.name}</span></div>
                                        ))}
                                    </div>
                                )}
                                {detail.status === 'completed' && !voidKind && (
                                    <div className="flex gap-2 pt-2">
                                        <Button variant="outline" className="flex-1" onClick={() => setVoidKind('void')} data-testid="caja-anular">{canVoid ? 'Anular cobro' : 'Solicitar anulación'}</Button>
                                        <Button variant="outline" className="flex-1" onClick={() => setVoidKind('refund')} data-testid="caja-devolver">{canVoid ? 'Devolver dinero' : 'Solicitar devolución'}</Button>
                                    </div>
                                )}
                                {voidKind && (
                                    <div className="space-y-2 pt-2">
                                        <p className="text-xs text-muted-foreground">
                                            {voidKind === 'refund'
                                                ? 'Devolución: el cliente recibe el dinero. El cobro queda registrado como devuelto, no se borra.'
                                                : 'Anulación: corrección de un cobro mal registrado. El cobro queda en el historial, no se elimina.'}
                                        </p>
                                        <Label htmlFor="caja-anular-motivo">Motivo</Label>
                                        <Textarea id="caja-anular-motivo" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} data-testid="caja-anular-motivo" />
                                        <div className="flex gap-2">
                                            <Button variant="outline" onClick={() => { setVoidKind(null); setVoidReason(''); }} disabled={submitting}>Cancelar</Button>
                                            <Button onClick={submitVoid} disabled={submitting} data-testid="caja-anular-confirmar">
                                                {submitting ? 'Registrando…' : 'Registrar'}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        <DialogFooter>
                            <Button variant="outline" onClick={() => { setDetail(null); setVoidKind(null); }}>Cerrar</Button>
                            {detail?.status === 'completed' && <Button onClick={() => reprint(detail)}>Reimprimir</Button>}
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
}
