import React from 'react';
import { useCart } from '@/contexts/CartContext';
import { fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Minus, X, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router-dom';

export const CartPanel = ({ onClose }) => {
    const { items, updateQty, remove, setNotes, subtotal, count } = useCart();

    return (
        <div className="h-full flex flex-col">
            <div className="p-5 border-b">
                <h2 className="font-display text-xl font-semibold">Tu carrito ({count})</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {items.length === 0 ? (
                    <div className="py-16 text-center text-muted-foreground">
                        <ShoppingBag className="h-10 w-10 mx-auto mb-3 opacity-50" />
                        <div>Tu carrito está vacío</div>
                        <div className="text-xs mt-1">Agrega platos para empezar</div>
                    </div>
                ) : items.map((it) => (
                    <div key={it.product_id} className="border rounded-xl p-3 space-y-2" data-testid={`cart-item-${it.product_id}`}>
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{it.name}</div>
                                <div className="text-xs text-muted-foreground tabular-nums">{fmtMoney(it.price)} c/u</div>
                            </div>
                            <button onClick={() => remove(it.product_id)} className="text-muted-foreground hover:text-destructive" data-testid={`cart-item-${it.product_id}-remove`}><X className="h-4 w-4" /></button>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => updateQty(it.product_id, it.quantity - 1)} data-testid={`cart-item-${it.product_id}-dec`}><Minus className="h-3.5 w-3.5" /></Button>
                                <span className="w-6 text-center font-semibold tabular-nums">{it.quantity}</span>
                                <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => updateQty(it.product_id, it.quantity + 1)} data-testid={`cart-item-${it.product_id}-inc`}><Plus className="h-3.5 w-3.5" /></Button>
                            </div>
                            <span className="font-semibold tabular-nums">{fmtMoney(it.price * it.quantity)}</span>
                        </div>
                        <Input value={it.notes || ''} onChange={(e) => setNotes(it.product_id, e.target.value)} placeholder="Notas (ej: sin cebolla)" className="h-9 text-xs" />
                    </div>
                ))}
            </div>
            <div className="border-t p-4 space-y-3">
                <div className="flex justify-between font-display text-lg font-bold">
                    <span>Subtotal</span>
                    <span className="tabular-nums" data-testid="cart-subtotal">{fmtMoney(subtotal)}</span>
                </div>
                <Button asChild className="w-full h-12" disabled={items.length === 0} data-testid="cart-checkout-button">
                    <Link to="/checkout" onClick={onClose}>Finalizar pedido</Link>
                </Button>
            </div>
        </div>
    );
};
