import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import usePolling from '@/hooks/usePolling';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtMoney, ORDER_TYPE_LABELS } from '@/lib/format';
import { Plus, Minus, Search, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { useNotify } from '@/contexts/NotifyContext';

export default function PedidoNuevo() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const lockedTableId = params.get('mesa') || '';
    const orderType = params.get('tipo') || 'mesa';
    const isTableOrder = orderType === 'mesa';
    const [tableId, setTableId] = useState(lockedTableId);
    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState('all');
    const [cart, setCart] = useState([]);
    const [orderNotes, setOrderNotes] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [customerAddress, setCustomerAddress] = useState('');
    const [loading, setLoading] = useState(false);
    const { generation } = useNotify();

    const { data: tables } = usePolling(() => api.get('/tables').then((r) => r.data), 8000, [generation]);
    const { data: categories } = usePolling(() => api.get('/categories').then((r) => r.data), 60000);
    const { data: products } = usePolling(() => api.get('/products').then((r) => r.data), 60000, [generation]);

    useEffect(() => {
        if (lockedTableId) setTableId(lockedTableId);
    }, [lockedTableId]);

    const table = (tables || []).find((t) => t.id === tableId);

    const filteredProducts = useMemo(() => {
        return (products || []).filter((p) => {
            if (categoryId !== 'all' && p.category_id !== categoryId) return false;
            if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        }).sort((a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1)));
    }, [products, search, categoryId]);

    const qtyOf = (productId) => cart.find((it) => it.product.id === productId)?.quantity || 0;

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

    const setQty = (product, qty) => {
        setCart((c) => {
            if (qty <= 0) return c.filter((it) => it.product.id !== product.id);
            const idx = c.findIndex((it) => it.product.id === product.id);
            if (idx < 0) return [...c, { product, quantity: qty, notes: '' }];
            const copy = [...c];
            copy[idx] = { ...copy[idx], quantity: qty };
            return copy;
        });
    };

    const count = cart.reduce((s, it) => s + it.quantity, 0);
    const subtotal = cart.reduce((s, it) => s + it.product.price * it.quantity, 0);

    const discard = async () => {
        if (lockedTableId) {
            try {
                await api.post(`/tables/${lockedTableId}/release`);
            } catch (e) {
                const msg = e.response?.data?.detail;
                if (msg) toast.error(msg);
            }
        }
        navigate('/salon');
    };

    const submit = async () => {
        if (isTableOrder && !tableId) { toast.error('Falta la mesa'); return; }
        if (orderType === 'delivery' && !customerAddress.trim()) { toast.error('Falta la dirección del envío'); return; }
        if (cart.length === 0) { toast.error('Agregá al menos un plato'); return; }
        setLoading(true);
        try {
            const items = cart.map((it) => ({ product_id: it.product.id, quantity: it.quantity, notes: it.notes || null }));
            const payload = {
                order_type: orderType,
                items,
                notes: orderNotes || null,
                ...(isTableOrder ? { table_id: tableId } : {}),
                ...(customerName.trim() ? { customer_name: customerName.trim() } : {}),
                ...(customerPhone.trim() ? { customer_phone: customerPhone.trim() } : {}),
                ...(orderType === 'delivery' ? { customer_address: customerAddress.trim() } : {}),
            };
            const { data: order } = await api.post('/orders', payload);
            await api.post(`/orders/${order.id}/send-to-kitchen`);
            const where = isTableOrder ? `Mesa ${table?.number || ''}` : (ORDER_TYPE_LABELS[orderType] || 'Pedido');
            toast.success(`${where.trim()} enviado a cocina`);
            navigate('/salon', { replace: true });
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo enviar');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4 pb-6" data-testid="pedido-nuevo-root">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Descartar y volver" onClick={discard} data-testid="pedido-descartar-back">
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <p className="page-kicker">Borrador · no está en cocina</p>
                        <h1 className="font-display text-3xl font-semibold" data-testid="pedido-nuevo-titulo">
                            {!isTableOrder
                                ? (ORDER_TYPE_LABELS[orderType] || 'Pedido')
                                : (table ? `Mesa ${table.number}` : 'Elegí una mesa')}
                        </h1>
                    </div>
                </div>
                <Button variant="outline" className="h-11" onClick={discard} data-testid="pedido-descartar">
                    Descartar
                </Button>
            </div>

            {isTableOrder && !lockedTableId && (
                <div className="scroll-x flex gap-2 pb-1">
                    {(tables || []).filter((t) => t.status === 'disponible' || t.id === tableId).map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTableId(t.id)}
                            className={`min-h-11 md:min-h-0 shrink-0 px-4 py-2 rounded-full text-sm font-medium border ${tableId === t.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
                        >
                            Mesa {t.number}
                        </button>
                    ))}
                </div>
            )}

            <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-3.5 text-muted-foreground" />
                <Input className="pl-9 h-12 text-base" placeholder="Buscar plato" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="pedido-buscar-producto" />
            </div>

            <div className="scroll-x flex gap-2 pb-1">
                <button
                    type="button"
                    onClick={() => setCategoryId('all')}
                    className={`min-h-11 md:min-h-0 shrink-0 px-4 py-2 rounded-full text-sm font-medium border ${categoryId === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
                >
                    Todas
                </button>
                {(categories || []).map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        onClick={() => setCategoryId(c.id)}
                        className={`min-h-11 md:min-h-0 shrink-0 px-4 py-2 rounded-full text-sm font-medium border ${categoryId === c.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
                    >
                        {c.name}
                    </button>
                ))}
            </div>

            {!isTableOrder && (
                <Card>
                    <CardContent className="p-4 space-y-3" data-testid="pedido-cliente">
                        <div className="page-kicker">Datos del cliente</div>
                        <Input className="h-11" placeholder="Nombre" value={customerName} onChange={(e) => setCustomerName(e.target.value)} data-testid="pedido-cliente-nombre" />
                        <Input className="h-11" placeholder="Teléfono" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} data-testid="pedido-cliente-telefono" />
                        {orderType === 'delivery' && (
                            <Input className="h-11" placeholder="Dirección de envío" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} data-testid="pedido-cliente-direccion" />
                        )}
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredProducts.map((p) => {
                    const q = qtyOf(p.id);
                    const agotado = !p.is_available || (p.is_combo && p.components_available === false);
                    return (
                        <Card key={p.id} data-testid={`producto-card-${p.id}`} className={agotado ? 'opacity-60' : ''}>
                            <CardContent className="p-4 flex flex-col gap-3">
                                <div>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="font-display text-lg font-semibold leading-tight truncate">{p.name}</div>
                                        {agotado && (
                                            <span className="shrink-0 text-xs font-medium rounded-full bg-[#F2F2F2] text-[#3F3F46] border border-[#D4D4D8] px-2 py-0.5">Agotado</span>
                                        )}
                                    </div>
                                    {p.description && <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{p.description}</div>}
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-mono font-bold tabular-nums text-primary">{fmtMoney(p.price)}</span>
                                    {agotado ? (
                                        <Button disabled variant="outline" className="h-11 rounded-full px-5" data-testid={`producto-add-${p.id}`}>Agotado</Button>
                                    ) : q === 0 ? (
                                        <Button className="h-11 rounded-full px-5" onClick={() => addToCart(p)} data-testid={`producto-add-${p.id}`}>
                                            <Plus className="h-4 w-4" /> Agregar
                                        </Button>
                                    ) : (
                                        <div className="flex items-center h-11 rounded-full border border-primary/40">
                                            <button type="button" className="h-11 w-11 flex items-center justify-center" aria-label={`Quitar una unidad de ${p.name}`} onClick={() => setQty(p, q - 1)}><Minus className="h-4 w-4" /></button>
                                            <span className="w-8 text-center font-mono font-semibold">{q}</span>
                                            <button type="button" className="h-11 w-11 flex items-center justify-center" aria-label={`Agregar una unidad de ${p.name}`} onClick={() => setQty(p, q + 1)}><Plus className="h-4 w-4" /></button>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <Textarea placeholder="Observaciones (sin cebolla, término…)" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} className="text-base" data-testid="pedido-notas" />

            {/* El pie sube por encima de la barra inferior de navegación (60 px +
                área segura) en móvil; en escritorio la barra no existe. */}
            <div className="sticky bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))] md:bottom-0 z-40 p-3 pb-[max(12px,env(safe-area-inset-bottom))] bg-background/95 backdrop-blur border-t border-border mt-4">
                <Button
                    onClick={submit}
                    disabled={loading || cart.length === 0 || (isTableOrder && !tableId)}
                    className="w-full h-14 rounded-full text-base md:max-w-2xl md:mx-auto"
                    data-testid="pedido-enviar-cocina"
                >
                    {count} {count === 1 ? 'producto' : 'productos'} · {fmtMoney(subtotal)} · Enviar a cocina
                </Button>
            </div>
        </div>
    );
}
