import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getCurrentCash } from '@/lib/api/cash';
import { listCategories } from '@/lib/api/categories';
import {
    addOrderItems,
    getOrder,
    reassignOrder,
    removeOrderItem,
    sendOrderToKitchen,
    serveOrder,
    setOrderStatus,
    voidOrderItem,
} from '@/lib/api/orders';
import { listProducts } from '@/lib/api/products';
import { listTables } from '@/lib/api/tables';
import { listUsers } from '@/lib/api/users';
import usePolling from '@/hooks/usePolling';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PendingButton from '@/components/ui/pending-button';
import usePendingAction from '@/hooks/usePendingAction';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fmtMoney } from '@/lib/format';
import { Plus, ChevronLeft, CreditCard, Ban, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { ACTIONS, can } from '@/lib/permissions';
import { useRealtimeGeneration } from '@/contexts/NotifyContext';
import CobrarDialog from '@/components/CobrarDialog';
import AttentionReference from '@/components/AttentionReference';
import useBranchNames from '@/hooks/useBranchNames';
import useRestaurantFeatures from '@/hooks/useRestaurantFeatures';
import { isDraft } from '@/lib/orderDraft';
import { apiErrorMessage } from '@/lib/apiError';

function itemOpen(it) {
    return !['listo', 'entregado'].includes(it.status);
}

export default function PedidoDetalle() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    // Only this order's events refetch it (also those of an operation that
    // touched it from another order, e.g. a merge or a split).
    const orderGeneration = useRealtimeGeneration(
        ['orders'],
        (event) => event.order_id === id || (event.related_order_ids || []).includes(id)
    );
    const tablesGeneration = useRealtimeGeneration(['tables']);
    const catalogGeneration = useRealtimeGeneration(['catalog']);
    // El ✕ de cancelar ítem por ítem es una flag apagada por defecto (Ajustes).
    const features = useRestaurantFeatures();

    const { data: order, refetch } = usePolling(() => getOrder(id).then((r) => r.data), 12000, [id, orderGeneration]);
    const { data: categories } = usePolling(() => listCategories().then((r) => r.data), 60000, [catalogGeneration]);
    const { data: products } = usePolling(() => listProducts().then((r) => r.data), 60000, [catalogGeneration]);
    const { data: tables } = usePolling(() => listTables().then((r) => r.data), 20000, [tablesGeneration]);
    const { data: staff } = usePolling(
        () => (can(user, ACTIONS.ORDER_REASSIGN) ? listUsers().then((r) => r.data) : Promise.resolve([])),
        60000,
        [user?.role]
    );

    const [run, busy] = usePendingAction();
    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState('all');
    const [cancelDlg, setCancelDlg] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [collectionOpen, setCollectionOpen] = useState(false);
    const [collectionOrderId, setCollectionOrderId] = useState(null);
    const collectionRequestRef = React.useRef(0);
    const detailMountedRef = React.useRef(false);
    const closeCollection = React.useCallback(() => {
        collectionRequestRef.current += 1;
        setCollectionOpen(false);
        setCollectionOrderId(null);
    }, []);

    const locked = ['pagado', 'cancelado'].includes(order?.status);
    const canCollect = can(user, ACTIONS.ORDER_COLLECT);
    const canCharge = Boolean(order && !locked && canCollect
        && Number(order.amount_paid || 0) < Number(order.total || 0));
    // The backend keeps `status` on the kitchen fulfillment and flags the bill
    // request separately (`payment_requested`), so both must be checked.
    const billRequested = Boolean(order?.payment_requested) || order?.status === 'pendiente_pago';
    const collectionContextRef = React.useRef(null);
    collectionContextRef.current = { routeId: id, orderId: order?.id, canCollect, canCharge };

    React.useEffect(() => {
        detailMountedRef.current = true;
        return () => {
            detailMountedRef.current = false;
            collectionRequestRef.current += 1;
        };
    }, []);

    React.useEffect(() => {
        closeCollection();
    }, [id, order?.id, canCollect, closeCollection]);

    React.useEffect(() => {
        if (!collectionOpen || !canCollect || !order?.id || collectionOrderId !== order.id || collectionOrderId !== id) return undefined;
        let cancelled = false;
        const verifyRegister = async () => {
            try {
                const { data: register } = await getCurrentCash();
                const context = collectionContextRef.current;
                if (cancelled || !detailMountedRef.current) return;
                if (context.routeId !== collectionOrderId || context.orderId !== collectionOrderId || !context.canCollect) return;
                if (!register || register.status !== 'open') {
                    closeCollection();
                    toast.error('El turno de caja ya no está activo. Vuelve a Caja para continuar.');
                }
            } catch {
                const context = collectionContextRef.current;
                if (cancelled || !detailMountedRef.current || context.routeId !== collectionOrderId
                    || context.orderId !== collectionOrderId || !context.canCollect) return;
                closeCollection();
                toast.error('No se pudo verificar el turno de caja. Se cerró el diálogo de cobro.');
            }
        };
        const interval = setInterval(verifyRegister, 12000);
        verifyRegister();
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [collectionOpen, collectionOrderId, canCollect, id, order?.id, closeCollection]);

    const table = useMemo(() => (tables || []).find((t) => t.id === order?.table_id), [tables, order]);

    const filteredProducts = useMemo(() => {
        return (products || []).filter((p) => {
            if (categoryId !== 'all' && p.category_id !== categoryId) return false;
            if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        }).sort((a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1)));
    }, [products, search, categoryId]);

    if (!order) return <div className="text-muted-foreground">Cargando pedido…</div>;

    const canEdit = !locked && can(user, ACTIONS.ORDER_EDIT);
    const canServe = !locked && can(user, ACTIONS.ORDER_SERVE);
    const pending = (order.items || []).filter(itemOpen);
    const ready = (order.items || []).filter((it) => it.status === 'listo');
    const delivered = (order.items || []).filter((it) => it.status === 'entregado');

    const addItem = async (product) => {
        try {
            await addOrderItems(order.id, [{ product_id: product.id, quantity: 1 }]);
            await refetch();
        } catch (e) { toast.error(apiErrorMessage(e, 'Error al agregar')); }
    };

    const sendToKitchen = () => run('send', async () => {
        await sendOrderToKitchen(order.id);
        toast.success('Enviado a cocina');
        await refetch();
    }, { errorMessage: 'No se pudo enviar a cocina' });

    // Lo que sigue en borrador se quita; lo que cocina ya recibió se anula, para
    // no borrar de la comanda algo que ya se está preparando.
    const removeItem = (it) => run(`remove:${it.id}`, async () => {
        if (isDraft(it, order.status)) {
            await removeOrderItem(order.id, it.id);
            toast.success(`${it.product_name} quitado`);
        } else {
            await voidOrderItem(order.id, it.id, { reason: 'Anulado desde el detalle del pedido' });
            toast.success(`${it.product_name} anulado`);
        }
        await refetch();
    }, { errorMessage: 'No se pudo quitar el producto' });

    const serve = () => run('serve', async () => {
        await serveOrder(order.id);
        toast.success('Entregado. La cuenta sigue abierta.');
        await refetch();
    }, { errorMessage: 'No se pudo entregar' });

    const requestBill = () => run('bill', async () => {
        await setOrderStatus(order.id, { status: 'pendiente_pago' });
        toast.success('Cuenta solicitada');
        navigate('/salon');
    }, { errorMessage: 'No se pudo solicitar la cuenta' });

    const reassign = async (waiterId) => {
        try {
            await reassignOrder(order.id, { waiter_id: waiterId });
            toast.success('Mozo reasignado. Cocina no se reinicia.');
            await refetch();
        } catch (e) { toast.error(apiErrorMessage(e, 'No se pudo reasignar')); }
    };

    const doCancel = () => {
        if (!cancelReason.trim()) { toast.error('Indica el motivo'); return undefined; }
        return run('cancel', async () => {
            await setOrderStatus(order.id, { status: 'cancelado', reason: cancelReason });
            setCancelDlg(false);
            toast.success('Pedido anulado');
            navigate('/salon');
        }, { errorMessage: 'No se pudo anular el pedido' });
    };

    // The register lookup can take a moment: the button says so and ignores taps meanwhile.
    const openCollection = () => run('collect', openCollectionNow, { errorMessage: 'No se pudo abrir el cobro' });

    const openCollectionNow = async () => {
        if (!canCharge || !order?.id || id !== order.id || !detailMountedRef.current) return;
        const requestId = ++collectionRequestRef.current;
        const requestedRouteId = id;
        const requestedOrderId = order.id;
        const isCurrentRequest = () => {
            const context = collectionContextRef.current;
            return detailMountedRef.current
                && requestId === collectionRequestRef.current
                && context.routeId === requestedRouteId
                && context.orderId === requestedOrderId
                && context.canCollect
                && context.canCharge;
        };
        try {
            const { data: register } = await getCurrentCash();
            if (!isCurrentRequest()) return;
            if (!register || register.status !== 'open') {
                navigate(`/caja?order=${requestedOrderId}`);
                return;
            }
            setCollectionOrderId(requestedOrderId);
            setCollectionOpen(true);
        } catch {
            if (isCurrentRequest()) toast.error('No se pudo verificar si hay un turno de caja activo.');
        }
    };

    const floorLabel = {
        nuevo: 'Borrador',
        enviado_cocina: 'Preparando',
        en_preparacion: 'Preparando',
        listo: 'Listo para entregar',
        entregado: 'Entregado',
        pendiente_pago: 'Cuenta solicitada',
        pagado: 'Pagado',
        cancelado: 'Anulado',
    }[order.status] || order.status;

    return (
        <div className="space-y-4 pb-[calc(8rem+var(--bottom-nav-h)+var(--safe-bottom))] md:pb-32" data-testid="pedido-detalle-root">
            {/* La reserva inferior suma el hueco de la barra de navegación móvil,
                que ahora empuja la barra fija de acciones hacia arriba. */}
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Volver al salón" onClick={() => navigate('/salon')} data-testid="pedido-back-button">
                    <ChevronLeft className="h-5 w-5" />
                </Button>
                <div>
                    <p className="page-kicker">{floorLabel}</p>
                    <h1 className="font-display text-3xl font-semibold">
                        {table ? `Mesa ${table.number}` : `Pedido #${order.order_number}`}
                    </h1>
                    <p className="text-sm text-muted-foreground">Atiende: {order.created_by_name || '—'}</p>
                    <AttentionReference order={order} branchNames={branchNames} />
                </div>
            </div>
            {can(user, ACTIONS.ORDER_REASSIGN) && !locked && (
                <div className="flex items-center gap-2 text-sm">
                    <span>Reasignar mozo</span>
                    <select
                        className="h-11 sm:h-10 rounded-sm border border-border bg-background px-2"
                        aria-label="Reasignar mozo"
                        value={order.created_by || ''}
                        onChange={(e) => e.target.value && reassign(e.target.value)}
                        data-testid="pedido-reasignar"
                    >
                        {(staff || []).filter((u) => ['mozo', 'admin'].includes(u.role)).map((u) => (
                            <option key={u.id} value={u.id}>{u.full_name}</option>
                        ))}
                    </select>
                    <span className="text-xs text-muted-foreground">Cocina no se reinicia</span>
                </div>
            )}

            {pending.length > 0 && (
                <Card>
                    <CardContent className="p-4 space-y-2">
                        <div className="page-kicker">Pendientes</div>
                        {pending.map((it) => (
                            <div key={it.id} className="flex justify-between gap-3 text-sm">
                                <span>{it.quantity}× {it.product_name} · {it.status === 'en_preparacion' ? 'en preparación' : 'pendiente'}</span>
                                <span className="flex items-center gap-2 shrink-0">
                                    {canEdit && features.item_void && it.status === 'pendiente' && (
                                        <button
                                            type="button"
                                            onClick={() => removeItem(it)}
                                            disabled={busy.has(`remove:${it.id}`)}
                                            aria-busy={busy.has(`remove:${it.id}`) ? 'true' : undefined}
                                            className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-destructive md:h-4 md:w-4"
                                            aria-label={`Cancelar ${it.product_name}`}
                                            data-testid={`pedido-item-cancel-${it.id}`}
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                    <span className="font-mono tabular-nums">{fmtMoney(it.subtotal)}</span>
                                </span>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}
            {ready.length > 0 && (
                <Card className="ring-2 ring-primary">
                    <CardContent className="p-4 space-y-2">
                        <div className="page-kicker text-primary">Listos para entregar</div>
                        {ready.map((it) => (
                            <div key={it.id} className="flex justify-between gap-3 text-sm font-medium">
                                <span>{it.quantity}× {it.product_name}</span>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}
            {delivered.length > 0 && (
                <Card>
                    <CardContent className="p-4 space-y-2">
                        <div className="page-kicker">Entregados</div>
                        {delivered.map((it) => (
                            <div key={it.id} className="flex justify-between gap-3 text-sm text-muted-foreground">
                                <span>{it.quantity}× {it.product_name}</span>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {!locked && canEdit && (
                <>
                    <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-3.5 text-muted-foreground" />
                        <Input className="pl-9 h-12 text-base" placeholder="Agregar otro plato" value={search} onChange={(e) => setSearch(e.target.value)} />
                    </div>
                    <div className="scroll-x flex gap-2">
                        <button type="button" onClick={() => setCategoryId('all')} className={`min-h-11 md:min-h-0 shrink-0 px-4 py-2 rounded-full text-sm border ${categoryId === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}>Todas</button>
                        {(categories || []).map((c) => (
                            <button key={c.id} type="button" onClick={() => setCategoryId(c.id)} className={`min-h-11 md:min-h-0 shrink-0 px-4 py-2 rounded-full text-sm border ${categoryId === c.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}>{c.name}</button>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {filteredProducts.map((p) => (
                            (p.is_available && !(p.is_combo && p.components_available === false)) ? (
                                <button key={p.id} type="button" onClick={() => addItem(p)} className="text-left border rounded-xl p-4 h-16 flex items-center justify-between" data-testid={`agregar-producto-${p.id}`}>
                                    <span className="font-medium truncate pr-2">{p.name}</span>
                                    <span className="flex items-center gap-2 shrink-0 font-mono text-sm">{fmtMoney(p.price)} <Plus className="h-4 w-4 text-primary" /></span>
                                </button>
                            ) : (
                                <div key={p.id} className="text-left border rounded-xl p-4 h-16 flex items-center justify-between opacity-50" data-testid={`agregar-producto-${p.id}`}>
                                    <span className="font-medium truncate pr-2">{p.name}</span>
                                    <span className="shrink-0 text-xs font-medium rounded-full bg-[#F2F2F2] text-[#3F3F46] border border-[#D4D4D8] px-2 py-0.5">Agotado</span>
                                </div>
                            )
                        ))}
                    </div>
                </>
            )}

            <div className="text-right font-mono text-lg font-bold tabular-nums" data-testid="pedido-total">{fmtMoney(order.total)}</div>

            {/* Barra fija de acciones: en móvil sube por encima de la barra inferior
                de navegación (las dos están en z-40 y se tapaban). */}
            <div className="fixed bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))] md:bottom-0 inset-x-0 z-40 p-3 pb-[max(12px,env(safe-area-inset-bottom))] bg-background/95 border-t border-border space-y-2">
                {order.status === 'nuevo' && can(user, ACTIONS.ORDER_EDIT) && (
                    <PendingButton onClick={sendToKitchen} pending={busy.has('send')} pendingLabel="Enviando…" className="w-full h-14 rounded-full text-base" data-testid="pedido-enviar-cocina-detalle">
                        {order.acceptance_status === 'pendiente' ? 'Aceptar y enviar a cocina' : 'Enviar a cocina'}
                    </PendingButton>
                )}
                {['enviado_cocina', 'en_preparacion'].includes(order.status) && (
                    <Button variant="outline" className="w-full h-12" onClick={() => navigate('/cocina')} data-testid="pedido-ver-cocina">
                        Ver cocina
                    </Button>
                )}
                {order.status === 'listo' && canServe && (
                    <PendingButton onClick={serve} pending={busy.has('serve')} pendingLabel="Entregando…" className="w-full h-14 rounded-full text-base" data-testid="pedido-servir-button">
                        Entregar pedido
                    </PendingButton>
                )}
                {['entregado', 'listo'].includes(order.status) && canEdit && (
                    billRequested ? (
                        <Button disabled variant="outline" className="w-full h-12" data-testid="pedido-cuenta-solicitada-button">
                            Cuenta solicitada
                        </Button>
                    ) : (
                        <PendingButton
                            onClick={requestBill}
                            pending={busy.has('bill')}
                            pendingLabel="Solicitando…"
                            variant={order.status === 'listo' ? 'outline' : 'default'}
                            className={`w-full ${order.status === 'listo' ? 'h-12' : 'h-14 rounded-full text-base'}`}
                            data-testid="pedido-solicitar-cuenta-button"
                        >
                            Solicitar cuenta
                        </PendingButton>
                    )
                )}
                {['listo', 'entregado', 'pendiente_pago'].includes(order.status) && canCharge && (
                    <PendingButton
                        onClick={openCollection}
                        pending={busy.has('collect')}
                        pendingLabel="Abriendo cobro…"
                        variant={order.status === 'pendiente_pago' ? 'default' : 'outline'}
                        className={`w-full ${order.status === 'pendiente_pago' ? 'h-14 rounded-full text-base' : 'h-12'}`}
                        data-testid="pedido-cobrar-button"
                    >
                        <CreditCard className="h-4 w-4 mr-2" /> Cobrar
                    </PendingButton>
                )}
                {billRequested && !canCharge && (
                    <div className="text-center text-sm text-muted-foreground py-2" data-testid="pedido-cuenta-solicitada">Se paga en caja</div>
                )}
                {order.status === 'pagado' && (
                    <Button variant="outline" className="w-full h-12" onClick={() => navigate('/caja')} data-testid="pedido-ver-caja">
                        Ver en caja
                    </Button>
                )}
                {order.status === 'cancelado' && (
                    <Button variant="outline" className="w-full h-12" onClick={() => navigate('/salon')}>
                        Volver a mesas
                    </Button>
                )}
                {!locked && can(user, ACTIONS.ORDER_CANCEL) && (
                    <Button variant="outline" onClick={() => setCancelDlg(true)} className="w-full h-12 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" data-testid="pedido-cancelar-button">
                        <Ban className="h-4 w-4 mr-2" />Anular pedido
                    </Button>
                )}
            </div>

            <Dialog open={cancelDlg} onOpenChange={setCancelDlg}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Anular pedido</DialogTitle></DialogHeader>
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Queda registrado. Cocina y caja lo van a ver.</p>
                        <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Motivo" data-testid="cancel-reason-input" />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCancelDlg(false)}>Cerrar</Button>
                        <PendingButton variant="destructive" onClick={doCancel} pending={busy.has('cancel')} pendingLabel="Anulando…" data-testid="cancel-confirm-button">Confirmar anulación</PendingButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <CobrarDialog
                open={collectionOpen}
                onOpenChange={(open) => !open && closeCollection()}
                order={order}
                onPaid={refetch}
            />
        </div>
    );
}
