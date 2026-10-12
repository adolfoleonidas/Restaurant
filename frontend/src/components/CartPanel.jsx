import React from 'react';
import { useCart } from '@/contexts/CartContext';
import { useLiveOrder } from '@/contexts/LiveOrderContext';
import { fmtMoney } from '@/lib/format';
import { ORDER_STATUS_LABELS } from '@/constants/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Minus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const LINE_STATUS = {
    pendiente: { label: 'nuevo', cls: 'bg-secondary text-muted-foreground' },
    en_preparacion: { label: 'en cocina', cls: 'bg-[#FFF6DB] text-[#6B4E00]' },
    listo: { label: 'listo', cls: 'bg-[#E6F2FF] text-[#0B3A66]' },
    entregado: { label: 'servido', cls: 'bg-[#E7F6EE] text-[#0F5132]' },
};

export const CartPanel = ({ onClose }) => {
    const { items, updateQty, remove, setNotes, subtotal, count } = useCart();
    const { order, isActive, mode, setMode, addProduct, decrementLine, busy } = useLiveOrder();

    const cartMode = isActive && mode === 'cart';
    const showLive = isActive && !cartMode;

    // h-11 sm:h-8: elegir mal el modo cambia el pedido, así que en móvil el
    // cambio de pestaña necesita el área táctil de 44 px.
    const tabs = isActive ? (
        <div className="grid grid-cols-2 gap-1 p-1 bg-secondary/50 rounded-sm mb-4">
            <button
                type="button"
                onClick={() => setMode('live')}
                data-testid="cart-tab-live"
                className={`h-11 sm:h-8 rounded-sm text-sm font-medium transition-colors ${showLive ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
                {(order && !['mesa', 'local'].includes(order.order_type)) ? 'Tu pedido' : 'En tu mesa'}
            </button>
            <button
                type="button"
                onClick={() => setMode('cart')}
                data-testid="cart-tab-cart"
                className={`h-11 sm:h-8 rounded-sm text-sm font-medium transition-colors ${cartMode ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
                Para llevar
            </button>
        </div>
    ) : null;

    if (showLive) {
        const liveItems = (order.items || []).filter((i) => i.status !== 'cancelado');
        const billPending = order.status === 'pendiente_pago';
        return (
            <div className="h-full flex flex-col bg-card">
                <div className="p-5 border-b border-border">
                    {tabs}
                    <p className="page-kicker">En curso</p>
                    <h2 className="font-display text-2xl font-semibold">Tu pedido #{order.order_number}</h2>
                    <p className="text-xs text-muted-foreground mt-1">{ORDER_STATUS_LABELS[order.status] || order.status}</p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {liveItems.length === 0 ? (
                        <div className="py-16 text-center text-muted-foreground">
                            <div className="font-display text-xl mb-2">Sin platos</div>
                            <div className="text-sm">Agregá un plato desde el menú</div>
                        </div>
                    ) : liveItems.map((it) => {
                        const st = LINE_STATUS[it.status] || LINE_STATUS.pendiente;
                        const pending = busy[it.product_id] || false;
                        const product = { id: it.product_id, name: it.product_name, price: it.unit_price };
                        return (
                            <div key={it.id} className="border border-border rounded-sm p-3 space-y-2" data-testid={`cart-live-item-${it.id}`}>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-display truncate">{it.product_name}</div>
                                        <div className="text-xs text-muted-foreground font-mono tabular-nums">{fmtMoney(it.unit_price)} c/u</div>
                                    </div>
                                    <span className={`text-xs font-medium rounded-full px-1.5 py-0.5 shrink-0 ${st.cls}`}>{st.label}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Button size="icon" variant="outline" className="h-11 w-11 rounded-sm" aria-label={`Quitar una unidad de ${it.product_name}`} disabled={pending} onClick={() => decrementLine(it).catch((e) => toast.error(e.message))} data-testid={`cart-live-item-${it.id}-dec`}><Minus className="h-3.5 w-3.5" /></Button>
                                        <span className="w-6 text-center font-mono font-semibold tabular-nums">{it.quantity}</span>
                                        <Button size="icon" variant="outline" className="h-11 w-11 rounded-sm" aria-label={`Agregar una unidad de ${it.product_name}`} disabled={pending || billPending} onClick={() => addProduct(product, 1).catch((e) => toast.error(e.message))} data-testid={`cart-live-item-${it.id}-inc`}><Plus className="h-3.5 w-3.5" /></Button>
                                    </div>
                                    <span className="font-mono font-semibold tabular-nums text-primary">{fmtMoney(it.subtotal)}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="border-t border-border p-4 pb-[calc(1rem+var(--safe-bottom))] space-y-3">
                    <div className="carta-row font-display text-lg">
                        <span>Total</span>
                        <span className="carta-dots" />
                        <span className="font-mono font-bold tabular-nums text-primary" data-testid="cart-live-total">{fmtMoney(order.total)}</span>
                    </div>
                    {billPending && <p className="text-xs text-amber-700">La cuenta ya fue solicitada. Podés pagar en caja.</p>}
                    <Button asChild className="w-full h-12 rounded-sm text-base" data-testid="cart-live-track-button">
                        <Link to={`/pedido/${order.tracking_code}`} onClick={onClose}>Ver estado del pedido</Link>
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-card">
            <div className="p-5 border-b border-border">
                {tabs}
                <p className="page-kicker">{cartMode ? 'Para llevar' : 'Tu mesa'}</p>
                <h2 className="font-display text-2xl font-semibold">Pedido ({count})</h2>
                {cartMode && <p className="text-xs text-muted-foreground mt-1">Este pedido es aparte del de tu mesa: lo pagás y lo llevás.</p>}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {items.length === 0 ? (
                    <div className="py-16 text-center text-muted-foreground">
                        <div className="font-display text-xl mb-2">Carta vacía</div>
                        <div className="text-sm">Agregá un plato para armar el pedido</div>
                    </div>
                ) : items.map((it) => (
                    <div key={it.product_id} className="border border-border rounded-sm p-3 space-y-2" data-testid={`cart-item-${it.product_id}`}>
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                <div className="font-display truncate">{it.name}{it.is_combo ? ' · combo' : ''}</div>
                                <div className="text-xs text-muted-foreground font-mono tabular-nums">{fmtMoney(it.price)} c/u</div>
                            </div>
                            <button onClick={() => remove(it.product_id)} aria-label={`Quitar ${it.name} del pedido`} className="grid h-11 w-11 place-items-center text-muted-foreground hover:text-destructive" data-testid={`cart-item-${it.product_id}-remove`}><X className="h-4 w-4" /></button>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Button size="icon" variant="outline" className="h-11 w-11 rounded-sm" aria-label={`Quitar una unidad de ${it.name}`} onClick={() => updateQty(it.product_id, it.quantity - 1)} data-testid={`cart-item-${it.product_id}-dec`}><Minus className="h-3.5 w-3.5" /></Button>
                                <span className="w-6 text-center font-mono font-semibold tabular-nums">{it.quantity}</span>
                                <Button size="icon" variant="outline" className="h-11 w-11 rounded-sm" aria-label={`Agregar una unidad de ${it.name}`} onClick={() => updateQty(it.product_id, it.quantity + 1)} data-testid={`cart-item-${it.product_id}-inc`}><Plus className="h-3.5 w-3.5" /></Button>
                            </div>
                            <span className="font-mono font-semibold tabular-nums text-primary">{fmtMoney(it.price * it.quantity)}</span>
                        </div>
                        <Input value={it.notes || ''} onChange={(e) => setNotes(it.product_id, e.target.value)} placeholder="Notas (ej: sin cebolla)" className="h-11 rounded-sm" />
                    </div>
                ))}
            </div>
            <div className="border-t border-border p-4 space-y-3">
                <div className="carta-row font-display text-lg">
                    <span>Subtotal</span>
                    <span className="carta-dots" />
                    <span className="font-mono font-bold tabular-nums text-primary" data-testid="cart-subtotal">{fmtMoney(subtotal)}</span>
                </div>
                <Button asChild className="w-full h-12 rounded-sm text-base" disabled={items.length === 0} data-testid="cart-checkout-button">
                    <Link to={cartMode ? '/checkout?tipo=recojo' : '/checkout'} onClick={onClose}>{cartMode ? 'Confirmar para llevar' : 'Confirmar pedido'}</Link>
                </Button>
            </div>
        </div>
    );
};
