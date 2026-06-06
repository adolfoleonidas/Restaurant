import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '@/lib/api';
import usePolling from '@/hooks/usePolling';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StateBadge } from '@/components/StateBadge';
import { fmtMoney, fmtElapsed, fmtTime } from '@/lib/format';
import { Plus, Minus, X, Send, ChevronLeft, CreditCard, Ban, Search } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';

export default function PedidoDetalle() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();

    const { data: order, refetch } = usePolling(() => api.get(`/orders/${id}`).then((r) => r.data), 3500, [id]);
    const { data: categories } = usePolling(() => api.get('/categories').then((r) => r.data), 60000);
    const { data: products } = usePolling(() => api.get('/products').then((r) => r.data), 60000);
    const { data: tables } = usePolling(() => api.get('/tables').then((r) => r.data), 10000);

    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState('all');
    const [cancelDlg, setCancelDlg] = useState(false);
    const [cancelReason, setCancelReason] = useState('');

    const table = useMemo(() => (tables || []).find((t) => t.id === order?.table_id), [tables, order]);

    const filteredProducts = useMemo(() => {
        return (products || []).filter((p) => {
            if (!p.is_available) return false;
            if (categoryId !== 'all' && p.category_id !== categoryId) return false;
            if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        });
    }, [products, search, categoryId]);

    if (!order) return <div className="text-muted-foreground">Cargando pedido…</div>;

    const locked = ['pagado', 'cancelado'].includes(order.status);
    const canEdit = !locked && ['admin', 'mozo'].includes(user.role);

    const addItem = async (product) => {
        try {
            await api.post(`/orders/${order.id}/items`, [{ product_id: product.id, quantity: 1 }]);
            await refetch();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error al agregar'); }
    };

    const updateQty = async (it, delta) => {
        const newQ = it.quantity + delta;
        if (newQ <= 0) {
            await api.delete(`/orders/${order.id}/items/${it.id}`);
        } else {
            await api.patch(`/orders/${order.id}/items/${it.id}`, { quantity: newQ });
        }
        await refetch();
    };

    const removeItem = async (it) => {
        await api.delete(`/orders/${order.id}/items/${it.id}`);
        await refetch();
    };

    const setItemNotes = async (it, notes) => {
        await api.patch(`/orders/${order.id}/items/${it.id}`, { notes });
        await refetch();
    };

    const sendToKitchen = async () => {
        try {
            await api.post(`/orders/${order.id}/send-to-kitchen`);
            toast.success('Pedido enviado a cocina');
            await refetch();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const requestBill = async () => {
        try {
            await api.post(`/orders/${order.id}/status`, { status: 'pendiente_pago' });
            toast.success('Cuenta solicitada');
            await refetch();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const markDelivered = async () => {
        try {
            await api.post(`/orders/${order.id}/status`, { status: 'entregado' });
            toast.success('Pedido entregado');
            await refetch();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const doCancel = async () => {
        if (!cancelReason.trim()) { toast.error('Indica el motivo'); return; }
        try {
            await api.post(`/orders/${order.id}/status`, { status: 'cancelado', reason: cancelReason });
            setCancelDlg(false);
            toast.success('Pedido cancelado');
            await refetch();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const cantCobrar = ['admin', 'cajero'].includes(user.role);

    return (
        <div className="space-y-5" data-testid="pedido-detalle-root">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)} data-testid="pedido-back-button"><ChevronLeft className="h-5 w-5" /></Button>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="font-display text-2xl font-semibold">Pedido #{order.order_number}</h1>
                            <StateBadge status={order.status} type="order" />
                        </div>
                        <div className="text-sm text-muted-foreground">
                            {table ? `${table.name} · ${table.area}` : 'Sin mesa'} · {fmtTime(order.created_at)} · hace {fmtElapsed(order.created_at)}
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {order.status === 'nuevo' && canEdit && (
                        <Button onClick={sendToKitchen} className="h-11" data-testid="pedido-enviar-cocina-button"><Send className="h-4 w-4 mr-2" />Enviar a cocina</Button>
                    )}
                    {order.status === 'listo' && canEdit && (
                        <Button onClick={markDelivered} className="h-11" data-testid="pedido-entregado-button">Marcar entregado</Button>
                    )}
                    {['entregado', 'listo'].includes(order.status) && canEdit && (
                        <Button onClick={requestBill} variant="secondary" className="h-11" data-testid="pedido-solicitar-cuenta-button"><CreditCard className="h-4 w-4 mr-2" />Solicitar cuenta</Button>
                    )}
                    {order.status === 'pendiente_pago' && cantCobrar && (
                        <Button asChild className="h-11"><Link to="/caja" data-testid="pedido-ir-caja-button"><CreditCard className="h-4 w-4 mr-2" />Ir a Caja</Link></Button>
                    )}
                    {!locked && ['admin', 'cajero'].includes(user.role) && (
                        <Button variant="outline" onClick={() => setCancelDlg(true)} className="h-11" data-testid="pedido-cancelar-button"><Ban className="h-4 w-4 mr-2" />Cancelar</Button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-7 space-y-4">
                    {/* Current items */}
                    <Card>
                        <CardContent className="p-4">
                            <h2 className="font-display text-lg font-semibold mb-3">Productos ({(order.items || []).length})</h2>
                            {(order.items || []).length === 0 ? (
                                <div className="text-sm text-muted-foreground py-6 text-center">Aún no hay productos en el pedido</div>
                            ) : (
                                <div className="divide-y">
                                    {(order.items || []).map((it) => (
                                        <div key={it.id} className="py-3 flex items-start gap-3" data-testid={`pedido-item-${it.product_id}`}>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium truncate">{it.product_name}</div>
                                                <div className="text-xs text-muted-foreground tabular-nums">{fmtMoney(it.unit_price)} c/u</div>
                                                {!locked && canEdit ? (
                                                    <Input className="mt-2 h-8 text-xs" placeholder="Notas" defaultValue={it.notes || ''} onBlur={(e) => { if (e.target.value !== (it.notes || '')) setItemNotes(it, e.target.value); }} />
                                                ) : it.notes ? <div className="text-xs mt-1 italic">{it.notes}</div> : null}
                                            </div>
                                            {!locked && canEdit ? (
                                                <div className="flex items-center gap-2">
                                                    <Button size="icon" variant="outline" onClick={() => updateQty(it, -1)} className="h-8 w-8" data-testid={`pedido-item-${it.product_id}-decrement`}><Minus className="h-3.5 w-3.5" /></Button>
                                                    <span className="w-6 text-center font-semibold tabular-nums">{it.quantity}</span>
                                                    <Button size="icon" variant="outline" onClick={() => updateQty(it, 1)} className="h-8 w-8" data-testid={`pedido-item-${it.product_id}-increment`}><Plus className="h-3.5 w-3.5" /></Button>
                                                    <button onClick={() => removeItem(it)} className="text-muted-foreground hover:text-destructive ml-1"><X className="h-4 w-4" /></button>
                                                </div>
                                            ) : (
                                                <div className="text-right">
                                                    <div className="text-sm"><span className="tabular-nums font-semibold">{it.quantity}</span> u.</div>
                                                </div>
                                            )}
                                            <div className="text-right w-20 tabular-nums font-semibold">{fmtMoney(it.subtotal)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="border-t mt-3 pt-3 flex justify-between font-display text-lg font-bold">
                                <span>Total</span>
                                <span className="tabular-nums" data-testid="pedido-total">{fmtMoney(order.total)}</span>
                            </div>
                        </CardContent>
                    </Card>

                    {order.notes && (
                        <Card><CardContent className="p-4">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">Notas del pedido</div>
                            <div className="text-sm mt-1">{order.notes}</div>
                        </CardContent></Card>
                    )}

                    {order.cancellation_reason && (
                        <Card><CardContent className="p-4">
                            <div className="text-xs uppercase tracking-wide text-destructive">Motivo de cancelación</div>
                            <div className="text-sm mt-1">{order.cancellation_reason}</div>
                        </CardContent></Card>
                    )}
                </div>

                {!locked && canEdit && (
                    <div className="lg:col-span-5">
                        <Card className="lg:sticky lg:top-[80px]">
                            <CardContent className="p-4">
                                <h2 className="font-display text-lg font-semibold mb-3">Agregar productos</h2>
                                <div className="flex gap-2 mb-3">
                                    <Select value={categoryId} onValueChange={setCategoryId}>
                                        <SelectTrigger className="h-10 flex-1"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Todas</SelectItem>
                                            {(categories || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="relative mb-3">
                                    <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                                    <Input className="pl-9 h-10" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
                                </div>
                                <div className="max-h-[55vh] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {filteredProducts.map((p) => (
                                        <button key={p.id} onClick={() => addItem(p)} className="text-left border rounded-xl p-3 hover:shadow transition-shadow" data-testid={`agregar-producto-${p.id}`}>
                                            <div className="text-sm font-medium">{p.name}</div>
                                            <div className="flex items-center justify-between mt-1">
                                                <span className="font-bold tabular-nums text-sm">{fmtMoney(p.price)}</span>
                                                <Plus className="h-4 w-4 text-primary" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>

            <Dialog open={cancelDlg} onOpenChange={setCancelDlg}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Cancelar pedido</DialogTitle></DialogHeader>
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Indica el motivo de la cancelación.</p>
                        <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Ej: Cliente cambió de opinión" data-testid="cancel-reason-input" />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCancelDlg(false)}>Cerrar</Button>
                        <Button variant="destructive" onClick={doCancel} data-testid="cancel-confirm-button">Confirmar cancelación</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
