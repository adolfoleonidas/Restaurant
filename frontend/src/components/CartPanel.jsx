import React from 'react';
import { useCart } from '@/contexts/CartContext';
import { fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Minus, X } from 'lucide-react';
import { Link } from 'react-router-dom';

export const CartPanel = ({ onClose }) => {
    const { items, updateQty, remove, setNotes, subtotal, count } = useCart();

    return (
        <div className="h-full flex flex-col bg-card">
            <div className="p-5 border-b border-border">
                <p className="page-kicker">Tu mesa</p>
                <h2 className="font-display italic text-2xl font-semibold">Pedido ({count})</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {items.length === 0 ? (
                    <div className="py-16 text-center text-muted-foreground">
                        <div className="font-display italic text-xl mb-2">Carta vacía</div>
                        <div className="text-sm">Agregá un plato para armar el pedido</div>
                    </div>
                ) : items.map((it) => (
                    <div key={it.product_id} className="border border-border rounded-sm p-3 space-y-2" data-testid={`cart-item-${it.product_id}`}>
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                <div className="font-display italic truncate">{it.name}{it.is_combo ? ' · combo' : ''}</div>
                                <div className="text-xs text-muted-foreground font-mono tabular-nums">{fmtMoney(it.price)} c/u</div>
                            </div>
                            <button onClick={() => remove(it.product_id)} className="text-muted-foreground hover:text-destructive" data-testid={`cart-item-${it.product_id}-remove`}><X className="h-4 w-4" /></button>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Button size="icon" variant="outline" className="h-9 w-9 rounded-sm" onClick={() => updateQty(it.product_id, it.quantity - 1)} data-testid={`cart-item-${it.product_id}-dec`}><Minus className="h-3.5 w-3.5" /></Button>
                                <span className="w-6 text-center font-mono font-semibold tabular-nums">{it.quantity}</span>
                                <Button size="icon" variant="outline" className="h-9 w-9 rounded-sm" onClick={() => updateQty(it.product_id, it.quantity + 1)} data-testid={`cart-item-${it.product_id}-inc`}><Plus className="h-3.5 w-3.5" /></Button>
                            </div>
                            <span className="font-mono font-semibold tabular-nums text-primary">{fmtMoney(it.price * it.quantity)}</span>
                        </div>
                        <Input value={it.notes || ''} onChange={(e) => setNotes(it.product_id, e.target.value)} placeholder="Notas (ej: sin cebolla)" className="h-9 text-xs rounded-sm" />
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
                    <Link to="/checkout" onClick={onClose}>Confirmar pedido</Link>
                </Button>
            </div>
        </div>
    );
};
