import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import usePolling from '@/hooks/usePolling';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fmtMoney } from '@/lib/format';
import { Plus, ChevronLeft, CreditCard, Ban, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { hasFn } from '@/lib/functions';
import { useNotify } from '@/contexts/NotifyContext';
import OrderCollectionDialog from '@/components/OrderCollectionDialog';
import AttentionReference from '@/components/AttentionReference';
import useBranchNames from '@/hooks/useBranchNames';

function itemOpen(it) {
    return !['listo', 'entregado'].includes(it.status);
}

export default function PedidoDetalle() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    const { generation } = useNotify();

    const { data: order, refetch } = usePolling(() => api.get(`/orders/${id}`).then((r) => r.data), 12000, [id, generation]);
    const { data: categories } = usePolling(() => api.get('/categories').then((r) => r.data), 60000);
    const { data: products } = usePolling(() => api.get('/products').then((r) => r.data), 60000);
    const { data: tables } = usePolling(() => api.get('/tables').then((r) => r.data), 20000, [generation]);
    const { data: staff } = usePolling(
        () => (user?.role === 'admin' ? api.get('/users').then((r) => r.data) : Promise.resolve([])),
        60000,
        [user?.role]
    );

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
    const canCollect = hasFn(user, 'cobro', 'administracion');
    const canCharge = Boolean(order && !locked && canCollect
        && Number(order.amount_paid || 0) < Number(order.total || 0));
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
                const { data: register } = await api.get('/cash/current');
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

    const canEdit = !locked && ['admin', 'mozo'].includes(user.role);
    const canServe = !locked && hasFn(user, 'preparacion', 'atencion', 'administracion');
    const pending = (order.items || []).filter(itemOpen);
    const ready = (order.items || []).filter((it) => it.status === 'listo');
    const delivered = (order.items || []).filter((it) => it.status === 'entregado');

    const addItem = async (product) => {
        try {
            await api.post(`/orders/${order.id}/items`, [{ product_id: product.id, quantity: 1 }]);
            await refetch();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error al agregar'); }
    };

    const sendToKitchen = async () => {
        try {
            await api.post(`/orders/${order.id}/send-to-kitchen`);
            toast.success('Enviado a cocina');
            await refetch();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const removeItem = async (it) => {
        try {
            await api.delete(`/orders/${order.id}/items/${it.id}`);
            toast.success(`${it.product_name} quitado`);
            await refetch();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const serve = async () => {
        try {
            await api.post(`/orders/${order.id}/serve`);
            toast.success('Servido. La cuenta sigue abierta.');
            await refetch();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const requestBill = async () => {
        try {
            await api.post(`/orders/${order.id}/status`, { status: 'pendiente_pago' });
            toast.success('Cuenta solicitada');
            navigate('/mesas');
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const reassign = async (waiterId) => {
        try {
            await api.post(`/orders/${order.id}/reassign`, { waiter_id: waiterId });
            toast.success('Mozo reasignado. Cocina no se reinicia.');
            await refetch();
        } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo reasignar'); }
    };

    const doCancel = async () => {
        if (!cancelReason.trim()) { toast.error('Indica el motivo'); return; }
        try {
            await api.post(`/orders/${order.id}/status`, { status: 'cancelado', reason: cancelReason });
            setCancelDlg(false);
            toast.success('Pedido cancelado');
            navigate('/mesas');
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const openCollection = async () => {
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
            const { data: register } = await api.get('/cash/current');
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
        cancelado: 'Cancelado',
    }[order.status] || order.status;

    return (
        <div className="space-y-4 pb-32" data-testid="pedido-detalle-root">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => navigate('/mesas')} data-testid="pedido-back-button">
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
            {user.role === 'admin' && !locked && (
                <div className="flex items-center gap-2 text-sm">
                    <span>Reasignar mozo</span>
                    <select
                        className="h-10 rounded-sm border border-border bg-background px-2"
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
                                    {canEdit && it.status === 'pendiente' && (
                                        <button
                                            type="button"
                                            onClick={() => removeItem(it)}
                                            className="text-muted-foreground hover:text-destructive"
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
                    <div className="flex gap-2 overflow-x-auto">
                        <button type="button" onClick={() => setCategoryId('all')} className={`shrink-0 px-4 py-2 rounded-full text-sm border ${categoryId === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}>Todas</button>
                        {(categories || []).map((c) => (
                            <button key={c.id} type="button" onClick={() => setCategoryId(c.id)} className={`shrink-0 px-4 py-2 rounded-full text-sm border ${categoryId === c.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}>{c.name}</button>
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
                                    <span className="shrink-0 text-[10px] font-medium rounded-full bg-[#F2F2F2] text-[#3F3F46] border border-[#D4D4D8] px-2 py-0.5">Agotado</span>
                                </div>
                            )
                        ))}
                    </div>
                </>
            )}

            <div className="text-right font-mono text-lg font-bold tabular-nums" data-testid="pedido-total">{fmtMoney(order.total)}</div>

            <div className="fixed bottom-0 inset-x-0 z-40 p-3 pb-[max(12px,env(safe-area-inset-bottom))] bg-background/95 border-t border-border space-y-2">
                {order.status === 'nuevo' && ['admin', 'mozo'].includes(user.role) && (
                    <Button onClick={sendToKitchen} className="w-full h-14 rounded-full text-base" data-testid="pedido-enviar-cocina-detalle">
                        {order.acceptance_status === 'pendiente' ? 'Aceptar y enviar a cocina' : 'Enviar a cocina'}
                    </Button>
                )}
                {['enviado_cocina', 'en_preparacion'].includes(order.status) && (
                    <Button variant="outline" className="w-full h-12" onClick={() => navigate('/cocina')} data-testid="pedido-ver-cocina">
                        Ver cocina
                    </Button>
                )}
                {order.status === 'listo' && canServe && (
                    <Button onClick={serve} className="w-full h-14 rounded-full text-base" data-testid="pedido-servir-button">
                        Entregar pedido
                    </Button>
                )}
                {['entregado', 'listo'].includes(order.status) && canEdit && (
                    <Button
                        onClick={requestBill}
                        variant={order.status === 'listo' ? 'outline' : 'default'}
                        className={`w-full ${order.status === 'listo' ? 'h-12' : 'h-14 rounded-full text-base'}`}
                        data-testid="pedido-solicitar-cuenta-button"
                    >
                        Solicitar cuenta
                    </Button>
                )}
                {['listo', 'entregado', 'pendiente_pago'].includes(order.status) && canCharge && (
                    <Button
                        onClick={openCollection}
                        variant={order.status === 'pendiente_pago' ? 'default' : 'outline'}
                        className={`w-full ${order.status === 'pendiente_pago' ? 'h-14 rounded-full text-base' : 'h-12'}`}
                        data-testid="pedido-cobrar-button"
                    >
                        <CreditCard className="h-4 w-4 mr-2" /> Cobrar
                    </Button>
                )}
                {order.status === 'pendiente_pago' && !canCharge && (
                    <div className="text-center text-sm text-muted-foreground py-2">Cuenta solicitada · se paga en caja</div>
                )}
                {order.status === 'pagado' && (
                    <Button variant="outline" className="w-full h-12" onClick={() => navigate('/caja')} data-testid="pedido-ver-caja">
                        Ver en caja
                    </Button>
                )}
                {order.status === 'cancelado' && (
                    <Button variant="outline" className="w-full h-12" onClick={() => navigate('/mesas')}>
                        Volver a mesas
                    </Button>
                )}
                {!locked && ['admin', 'cajero'].includes(user.role) && (
                    <Button variant="ghost" onClick={() => setCancelDlg(true)} className="w-full h-12" data-testid="pedido-cancelar-button">
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
                        <Button variant="destructive" onClick={doCancel} data-testid="cancel-confirm-button">Confirmar anulación</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <OrderCollectionDialog
                open={collectionOpen}
                onOpenChange={(open) => !open && closeCollection()}
                order={order}
                onPaid={refetch}
            />
        </div>
    );
}
