import React from 'react';
import { Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/contexts/CartContext';
import { fmtMoney } from '@/lib/format';

export function ProductCard({ product, children }) {
    const { items, addProduct, updateQty } = useCart();
    const qty = items.find((x) => x.product_id === product.id)?.quantity || 0;

    return (
        <article
            className="snap-start shrink-0 w-56 md:w-64 rounded-xl border border-border bg-card overflow-hidden flex flex-col"
            data-testid={`landing-product-${product.id}`}
        >
            {product.image_url ? (
                <img src={product.image_url} alt="" className="h-36 w-full object-cover" />
            ) : (
                <div className="h-36 w-full bg-secondary" />
            )}
            <div className="p-3 flex flex-col gap-2 flex-1">
                {product.code && <div className="page-kicker text-primary">{product.code}</div>}
                <h3 className="font-display italic text-lg font-semibold leading-tight">{product.name}</h3>
                {product.description && <p className="text-xs text-muted-foreground line-clamp-2">{product.description}</p>}
                {children}
                <div className="mt-auto pt-2">
                    <div className="font-mono text-primary font-bold tabular-nums text-lg mb-2">{fmtMoney(product.price)}</div>
                    {qty === 0 ? (
                        <Button
                            className="w-full h-10 rounded-full"
                            onClick={() => addProduct(product, 1, '')}
                            data-testid={`landing-add-${product.id}`}
                        >
                            <Plus className="h-4 w-4" /> Agregar
                        </Button>
                    ) : (
                        <div className="flex items-center h-10 rounded-full border border-primary/40 bg-card" data-testid={`landing-qty-${product.id}`}>
                            <button
                                type="button"
                                className="h-10 w-10 flex items-center justify-center text-primary"
                                onClick={() => updateQty(product.id, qty - 1)}
                                data-testid={`landing-dec-${product.id}`}
                                aria-label="Quitar"
                            >
                                <Minus className="h-4 w-4" />
                            </button>
                            <span className="flex-1 text-center font-mono font-semibold tabular-nums">{qty}</span>
                            <button
                                type="button"
                                className="h-10 w-10 flex items-center justify-center text-primary"
                                onClick={() => updateQty(product.id, qty + 1)}
                                data-testid={`landing-inc-${product.id}`}
                                aria-label="Sumar"
                            >
                                <Plus className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}
