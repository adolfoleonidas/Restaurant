import React from 'react';
import { Plus, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCart } from '@/contexts/CartContext';
import { useLiveOrder } from '@/contexts/LiveOrderContext';
import { fmtMoney } from '@/lib/format';

const STATUS_CHIP = {
    pendiente: { label: 'nuevo', cls: 'bg-secondary text-muted-foreground' },
    en_preparacion: { label: 'en cocina', cls: 'bg-[#FFF6DB] text-[#6B4E00]' },
    listo: { label: 'listo', cls: 'bg-[#E6F2FF] text-[#0B3A66]' },
    entregado: { label: 'servido', cls: 'bg-[#E7F6EE] text-[#0F5132]' },
};

export function ProductCard({ product, children }) {
    const { items, addProduct, updateQty } = useCart();
    const { order, isActive, mode, productQty, statusCounts, addProduct: addLive, decrementProduct: decLive, busy } = useLiveOrder();

    const cartQty = items.find((x) => x.product_id === product.id)?.quantity || 0;
    const liveMode = isActive && mode !== 'cart';
    const agotado = product.is_available === false || (product.is_combo && product.components_available === false);

    if (liveMode) {
        const qty = productQty(product.id);
        const counts = statusCounts(product.id);
        const billPending = order.status === 'pendiente_pago';
        const pending = busy[product.id] || false;
        return (
            <article
                className={`w-full rounded-xl border bg-card overflow-hidden flex flex-row ${agotado ? 'opacity-60' : ''} ${qty > 0 ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border'}`}
                data-testid={`landing-product-${product.id}`}
            >
                {product.image_url ? (
                    <img src={product.image_url} alt="" className="h-28 w-24 sm:h-32 sm:w-32 object-cover shrink-0" />
                ) : (
                    <div className="h-28 w-24 sm:h-32 sm:w-32 bg-secondary shrink-0" aria-hidden="true" />
                )}
                <div className="min-w-0 p-3 sm:p-4 flex flex-col gap-2 flex-1">
                    {product.code && <div className="page-kicker text-primary">{product.code}</div>}
                    <h3 className="font-display text-lg font-semibold leading-tight">{product.name}</h3>
                    {agotado && (
                        <span className="shrink-0 self-start text-[10px] font-medium rounded-full bg-[#F2F2F2] text-[#3F3F46] border border-[#D4D4D8] px-2 py-0.5">Agotado</span>
                    )}
                    {product.description && <p className="text-xs text-muted-foreground line-clamp-2">{product.description}</p>}
                    {children}
                    {qty > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {Object.entries(STATUS_CHIP).map(([k, chip]) => (
                                counts[k] > 0 ? (
                                    <span key={k} className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${chip.cls}`} data-testid={`landing-chip-${product.id}-${k}`}>
                                        {counts[k]} {chip.label}
                                    </span>
                                ) : null
                            ))}
                        </div>
                    )}
                    {billPending && qty > 0 && (
                        <div className="text-[10px] text-amber-700 font-medium">Cuenta solicitada: pedí al mozo para agregar más.</div>
                    )}
                    <div className="mt-auto pt-2 flex items-center justify-between gap-3">
                        <div className="font-mono text-primary font-bold tabular-nums text-lg">{fmtMoney(product.price)}</div>
                        {qty === 0 ? (
                            <Button
                                className="h-10 w-10 shrink-0 rounded-full p-0"
                                onClick={() => addLive(product, 1).catch((e) => toast.error(e.message))}
                                disabled={pending || billPending || agotado}
                                data-testid={`landing-add-${product.id}`}
                            aria-label={`Agregar ${product.name} al pedido`}
                            >
                                {agotado ? <span className="sr-only">Agotado</span> : <Plus className="h-4 w-4" />}
                            </Button>
                        ) : (
                            <div className="flex items-center h-10 rounded-full border border-primary/40 bg-card" data-testid={`landing-live-${product.id}`}>
                                <button
                                    type="button"
                                    className="h-10 w-10 flex items-center justify-center text-primary disabled:opacity-40"
                                    onClick={() => decLive(product).catch((e) => toast.error(e.message))}
                                    disabled={pending}
                                    data-testid={`landing-livedec-${product.id}`}
                                    aria-label="Quitar de mi pedido"
                                >
                                    <Minus className="h-4 w-4" />
                                </button>
                                <span className="flex-1 text-center font-mono font-semibold tabular-nums">{qty}</span>
                                <button
                                    type="button"
                                    className="h-10 w-10 flex items-center justify-center text-primary disabled:opacity-40"
                                    onClick={() => addLive(product, 1).catch((e) => toast.error(e.message))}
                                    disabled={pending || billPending || agotado}
                                    data-testid={`landing-liveinc-${product.id}`}
                                    aria-label="Agregar a mi pedido"
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

    return (
        <article
            className={`w-full rounded-xl border border-border bg-card overflow-hidden flex flex-row ${agotado ? 'opacity-60' : ''}`}
            data-testid={`landing-product-${product.id}`}
        >
            {product.image_url ? (
                <img src={product.image_url} alt="" className="h-28 w-24 sm:h-32 sm:w-32 object-cover shrink-0" />
            ) : (
                <div className="h-28 w-24 sm:h-32 sm:w-32 bg-secondary shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 p-3 sm:p-4 flex flex-col gap-2 flex-1">
                {product.code && <div className="page-kicker text-primary">{product.code}</div>}
                <h3 className="font-display text-lg font-semibold leading-tight">{product.name}</h3>
                {agotado && (
                    <span className="shrink-0 self-start text-[10px] font-medium rounded-full bg-[#F2F2F2] text-[#3F3F46] border border-[#D4D4D8] px-2 py-0.5">Agotado</span>
                )}
                {product.description && <p className="text-xs text-muted-foreground line-clamp-2">{product.description}</p>}
                {children}
                <div className="mt-auto pt-2 flex items-center justify-between gap-3">
                    <div className="font-mono text-primary font-bold tabular-nums text-lg">{fmtMoney(product.price)}</div>
                    {cartQty === 0 ? (
                        <Button
                            className="h-10 w-10 shrink-0 rounded-full p-0"
                            onClick={() => addProduct(product, 1, '')}
                            disabled={agotado}
                            data-testid={`landing-add-${product.id}`}
                            aria-label={`Agregar ${product.name} al pedido`}
                        >
                            {agotado ? <span className="sr-only">Agotado</span> : <Plus className="h-4 w-4" />}
                        </Button>
                    ) : (
                        <div className="flex items-center h-10 rounded-full border border-primary/40 bg-card" data-testid={`landing-qty-${product.id}`}>
                            <button
                                type="button"
                                className="h-10 w-10 flex items-center justify-center text-primary"
                                onClick={() => updateQty(product.id, cartQty - 1)}
                                data-testid={`landing-dec-${product.id}`}
                                aria-label="Quitar"
                            >
                                <Minus className="h-4 w-4" />
                            </button>
                            <span className="flex-1 text-center font-mono font-semibold tabular-nums">{cartQty}</span>
                            <button
                                type="button"
                                className="h-10 w-10 flex items-center justify-center text-primary disabled:opacity-40"
                                onClick={() => updateQty(product.id, cartQty + 1)}
                                disabled={agotado}
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
