import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import usePolling from '@/hooks/usePolling';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtMoney } from '@/lib/format';
import { Plus, Minus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';

export default function PedidoNuevo() {
    const navigate = useNavigate();
    const [tableId, setTableId] = useState('');
    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState('all');
    const [cart, setCart] = useState([]); // {product, quantity, notes}
    const [orderNotes, setOrderNotes] = useState('');
    const [loading, setLoading] = useState(false);

    const { data: tables } = usePolling(() => api.get('/tables').then((r) => r.data), 5000);
    const { data: categories } = usePolling(() => api.get('/categories').then((r) => r.data), 60000);
    const { data: products } = usePolling(() => api.get('/products').then((r) => r.data), 60000);

    const availableTables = (tables || []).filter((t) => t.status === 'disponible' && !t.active_order);

    const filteredProducts = useMemo(() => {
        return (products || []).filter((p) => {
            if (!p.is_available) return false;
            if (categoryId !== 'all' && p.category_id !== categoryId) return false;
            if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        });
    }, [products, search, categoryId]);

    const addToCart = (product) => {
        setCart((c) => {
            const idx = c.findIndex((it) => it.product.id === product.id);
            if (idx >= 0) {
                const copy = [...c];
                copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
                return copy;
            }
            return [...c, { product, quantity: 1, notes: '' }];
        });
    };

    const updateQty = (idx, delta) => {
        setCart((c) => {
            const copy = [...c];
            const newQ = copy[idx].quantity + delta;
            if (newQ <= 0) return copy.filter((_, i) => i !== idx);
            copy[idx] = { ...copy[idx], quantity: newQ };
            return copy;
        });
    };

    const setItemNotes = (idx, notes) => {
        setCart((c) => {
            const copy = [...c];
            copy[idx] = { ...copy[idx], notes };
            return copy;
        });
    };

    const removeFromCart = (idx) => setCart((c) => c.filter((_, i) => i !== idx));

    const subtotal = cart.reduce((s, it) => s + it.product.price * it.quantity, 0);

    const submit = async (sendToKitchen) => {
        if (!tableId) { toast.error('Selecciona una mesa'); return; }
        if (cart.length === 0) { toast.error('Agrega al menos un producto'); return; }
        setLoading(true);
        try {
            const items = cart.map((it) => ({ product_id: it.product.id, quantity: it.quantity, notes: it.notes || null }));
            const { data: order } = await api.post('/orders', { table_id: tableId, order_type: 'mesa', items, notes: orderNotes || null });
            if (sendToKitchen) {
                await api.post(`/orders/${order.id}/send-to-kitchen`);
                toast.success(`Pedido #${order.order_number} enviado a cocina`);
            } else {
                toast.success(`Pedido #${order.order_number} guardado`);
            }
            navigate(`/pedidos/${order.id}`);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al crear el pedido');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-5" data-testid="pedido-nuevo-root">
            <div>
                <h1 className="font-display text-2xl font-semibold">Nuevo pedido</h1>
                <p className="text-muted-foreground text-sm">Selecciona mesa, agrega productos y envía a cocina</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Categories + Products */}
                <div className="lg:col-span-8 space-y-4">
                    <Card><CardContent className="p-4 flex flex-wrap gap-3 items-center">
                        <div className="flex-1 min-w-[200px]">
                            <label className="text-xs text-muted-foreground">Mesa</label>
                            <Select value={tableId} onValueChange={setTableId}>
                                <SelectTrigger data-testid="pedido-mesa-select" className="h-11"><SelectValue placeholder="Selecciona una mesa disponible" /></SelectTrigger>
                                <SelectContent>
                                    {availableTables.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No hay mesas disponibles</div>}
                                    {availableTables.map((t) => (
                                        <SelectItem key={t.id} value={t.id} data-testid={`pedido-mesa-option-${t.number}`}>
                                            {t.name} · {t.area} · {t.capacity} pax
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex-1 min-w-[200px]">
                            <label className="text-xs text-muted-foreground">Categoría</label>
                            <Select value={categoryId} onValueChange={setCategoryId}>
                                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas</SelectItem>
                                    {(categories || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex-1 min-w-[200px]">
                            <label className="text-xs text-muted-foreground">Buscar producto</label>
                            <div className="relative">
                                <Search className="h-4 w-4 absolute left-3 top-3.5 text-muted-foreground" />
                                <Input className="pl-9 h-11" placeholder="Nombre del producto" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="pedido-buscar-producto" />
                            </div>
                        </div>
                    </CardContent></Card>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {filteredProducts.map((p) => (
                            <Card key={p.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => addToCart(p)} data-testid={`producto-card-${p.id}`}>
                                <CardContent className="p-4">
                                    <div className="font-semibold text-sm">{p.name}</div>
                                    {p.description && <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{p.description}</div>}
                                    <div className="flex items-center justify-between mt-3">
                                        <span className="font-display text-base font-bold tabular-nums">{fmtMoney(p.price)}</span>
                                        <Button size="sm" className="h-9"><Plus className="h-4 w-4" /></Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                        {filteredProducts.length === 0 && (
                            <Card className="col-span-full"><CardContent className="py-12 text-center text-muted-foreground">No hay productos con esos filtros</CardContent></Card>
                        )}
                    </div>
                </div>

                {/* Cart */}
                <div className="lg:col-span-4">
                    <Card className="lg:sticky lg:top-[80px]">
                        <CardContent className="p-4">
                            <h2 className="font-display text-lg font-semibold mb-3">Carrito ({cart.length})</h2>
                            <div className="max-h-[40vh] overflow-y-auto space-y-3 -mx-2 px-2">
                                {cart.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Aún no has agregado productos</div>}
                                {cart.map((it, idx) => (
                                    <div key={idx} className="border rounded-xl p-3 space-y-2" data-testid={`carrito-item-${idx}`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-sm truncate">{it.product.name}</div>
                                                <div className="text-xs text-muted-foreground tabular-nums">{fmtMoney(it.product.price)} c/u</div>
                                            </div>
                                            <button onClick={() => removeFromCart(idx)} className="text-muted-foreground hover:text-destructive" data-testid={`carrito-item-${idx}-remove`}><X className="h-4 w-4" /></button>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Button size="icon" variant="outline" onClick={() => updateQty(idx, -1)} className="h-8 w-8" data-testid={`carrito-item-${idx}-decrement`}><Minus className="h-3.5 w-3.5" /></Button>
                                                <span className="font-semibold tabular-nums w-6 text-center">{it.quantity}</span>
                                                <Button size="icon" variant="outline" onClick={() => updateQty(idx, 1)} className="h-8 w-8" data-testid={`carrito-item-${idx}-increment`}><Plus className="h-3.5 w-3.5" /></Button>
                                            </div>
                                            <span className="font-semibold tabular-nums">{fmtMoney(it.product.price * it.quantity)}</span>
                                        </div>
                                        <Input placeholder="Notas: sin cebolla, término..." value={it.notes} onChange={(e) => setItemNotes(idx, e.target.value)} className="h-8 text-xs" data-testid={`carrito-item-${idx}-notes`} />
                                    </div>
                                ))}
                            </div>

                            <div className="border-t mt-4 pt-3">
                                <Textarea placeholder="Notas del pedido (opcional)" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} className="text-sm" data-testid="pedido-notas" />
                            </div>

                            <div className="border-t mt-3 pt-3 space-y-1">
                                <div className="flex justify-between text-sm"><span>Subtotal</span><span className="tabular-nums">{fmtMoney(subtotal)}</span></div>
                                <div className="flex justify-between font-display text-xl font-bold"><span>Total</span><span className="tabular-nums" data-testid="carrito-total">{fmtMoney(subtotal)}</span></div>
                            </div>

                            <div className="mt-4 grid gap-2">
                                <Button onClick={() => submit(true)} disabled={loading || cart.length === 0 || !tableId} className="h-12" data-testid="pedido-enviar-cocina">Enviar a cocina</Button>
                                <Button variant="outline" onClick={() => submit(false)} disabled={loading || cart.length === 0 || !tableId} className="h-10">Guardar como borrador</Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
