import React, { useMemo, useState } from 'react';
import { Search, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtMoney } from '@/lib/format';

/**
 * Carta para componer un pedido sin salir del panel: buscador, categorías y
 * platos con su "+" y la cantidad ya pedida en la cuenta.
 *
 * Lo comparten el sheet de una mesa y el compositor de "Nuevo pedido", para que
 * tomar un pedido se vea y se sienta igual en los dos caminos.
 */
export default function OrderComposer({
    order = null,
    items,
    products = [],
    categories = [],
    savingItem = false,
    canCompose = false,
    showKitchen = false,
    testIdPrefix = 'mesa-sheet',
    title = null,
    emptyLabel = 'Sin productos.',
    onAddProduct,
    onSendToKitchen,
}) {
    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState('all');

    const lines = items || (order?.items || []).filter((i) => i.status !== 'cancelado');

    const visible = useMemo(() => (products || [])
        .filter((p) => {
            if (categoryId !== 'all' && p.category_id !== categoryId) return false;
            if (search && !String(p.name || '').toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1))), [products, categoryId, search]);

    const label = title || (order
        ? (order.customer_name ? `Agregar a ${order.customer_name}` : `Agregar a la cuenta #${order.order_number}`)
        : 'Agregar productos');

    // Sin permiso para tomar pedido no hay carta que mostrar.
    if (!canCompose) return null;

    return (
        <div className="space-y-2 rounded-xl border p-3" data-testid={`${testIdPrefix}-pedido`}>
            <div className="flex items-center justify-between gap-2">
                <span className="page-kicker">{label}</span>
                {showKitchen && (
                    <Button size="sm" className="h-8" onClick={onSendToKitchen} data-testid={`${testIdPrefix}-enviar-cocina`}>
                        Enviar a cocina
                    </Button>
                )}
            </div>
            {order && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/50 px-2 py-1 text-xs" data-testid={`${testIdPrefix}-pedido-resumen`}>
                    <span className="text-muted-foreground">
                        {lines.reduce((s, i) => s + Number(i.quantity || 0), 0)} en esta cuenta
                    </span>
                    <span className="font-mono font-semibold tabular-nums">{fmtMoney(order.total)}</span>
                </div>
            )}
            <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
                <Input
                    className="pl-9 h-9"
                    placeholder="Buscar plato"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid={`${testIdPrefix}-buscar-producto`}
                />
            </div>
            {categories.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                    <button
                        type="button"
                        onClick={() => setCategoryId('all')}
                        className={`shrink-0 px-2.5 py-1 rounded-full text-xs border ${categoryId === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
                    >
                        Todas
                    </button>
                    {categories.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            onClick={() => setCategoryId(c.id)}
                            className={`shrink-0 px-2.5 py-1 rounded-full text-xs border ${categoryId === c.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
                        >
                            {c.name}
                        </button>
                    ))}
                </div>
            )}
            <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto" data-testid={`${testIdPrefix}-productos`}>
                {visible.map((p) => {
                    const out = !p.is_available || (p.is_combo && p.components_available === false);
                    const qty = lines
                        .filter((i) => i.product_id === p.id)
                        .reduce((s, i) => s + Number(i.quantity || 0), 0);
                    return (
                        <button
                            key={p.id}
                            type="button"
                            disabled={out || savingItem}
                            onClick={() => onAddProduct?.(p)}
                            data-testid={`${testIdPrefix}-producto-${p.id}`}
                            className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${out ? 'opacity-50' : 'hover:border-primary hover:bg-primary/5'}`}
                        >
                            <span className="flex min-w-0 flex-col">
                                <span className="w-full truncate font-medium">{p.name}</span>
                                <span className="font-mono tabular-nums text-muted-foreground">{fmtMoney(p.price)}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                                {qty > 0 && (
                                    <span
                                        className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 font-semibold tabular-nums text-primary-foreground"
                                        data-testid={`${testIdPrefix}-producto-cantidad-${p.id}`}
                                    >
                                        {qty}
                                    </span>
                                )}
                                <span className="grid h-6 w-6 place-items-center rounded-full border border-border" aria-hidden="true">
                                    <Plus className="h-3.5 w-3.5" />
                                </span>
                            </span>
                        </button>
                    );
                })}
                {visible.length === 0 && (
                    <p className="col-span-2 text-xs text-muted-foreground py-2 text-center">{emptyLabel}</p>
                )}
            </div>
        </div>
    );
}

/**
 * Detalle de la cuenta: cada producto con sus botones − / + y el total.
 */
export function OrderItems({ items = [], canCompose = false, total = null, onChangeQty, testIdPrefix = 'mesa-sheet' }) {
    return (
        <>
            <div className="border rounded-xl divide-y" data-testid={`${testIdPrefix}-items`}>
                {items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-2 py-2 px-3 text-sm">
                        <span className="min-w-0 truncate">{it.quantity}× {it.product_name}</span>
                        <span className="font-mono tabular-nums shrink-0">{fmtMoney(it.subtotal)}</span>
                        {canCompose && (
                            <span className="flex items-center gap-1 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => onChangeQty?.(it, -1)}
                                    aria-label={`Quitar uno de ${it.product_name}`}
                                    data-testid={`${testIdPrefix}-item-menos-${it.id}`}
                                    className="h-7 w-7 rounded-md border border-border grid place-items-center hover:bg-secondary"
                                >
                                    <Minus className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onChangeQty?.(it, 1)}
                                    aria-label={`Agregar uno de ${it.product_name}`}
                                    data-testid={`${testIdPrefix}-item-mas-${it.id}`}
                                    className="h-7 w-7 rounded-md border border-border grid place-items-center hover:bg-secondary"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </button>
                            </span>
                        )}
                    </div>
                ))}
            </div>
            <div className="flex justify-between font-display text-lg font-bold">
                <span>Total</span>
                <span className="font-mono tabular-nums">{total != null ? fmtMoney(total) : '—'}</span>
            </div>
        </>
    );
}
