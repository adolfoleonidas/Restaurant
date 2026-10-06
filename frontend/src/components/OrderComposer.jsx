import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Minus, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtMoney } from '@/lib/format';
import { setSoundEnabled, soundEnabled, tick } from '@/lib/feedback';
import { isCancelled, isDraft } from '@/lib/orderDraft';

/**
 * Carta para componer un pedido sin salir del panel: buscador, categorías y
 * platos con sus controles de cantidad.
 *
 * Cada plato arranca con un "+" y, una vez agregado, pasa a "− 1 +" para subir o
 * bajar sin abrir nada. Cada toque responde al instante: el número cambia, la
 * fila da un pulso breve y (si el sonido está activo) suena un clic seco.
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
    onRemoveProduct,
    onSendToKitchen,
    sendLabel = 'Enviar a cocina',
}) {
    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState('all');
    const [sound, setSound] = useState(soundEnabled);
    const [pulse, setPulse] = useState(null);
    const pulseTimer = useRef(null);

    const lines = (items || (order?.items || [])).filter((i) => !isCancelled(i));

    // La cantidad que se muestra es la de la cuenta abierta: el resumen general
    // de la mesa vive abajo, así que acá no se mezclan las personas.
    const visible = useMemo(() => (products || [])
        .filter((p) => {
            if (categoryId !== 'all' && p.category_id !== categoryId) return false;
            if (search && !String(p.name || '').toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1))), [products, categoryId, search]);

    useEffect(() => () => clearTimeout(pulseTimer.current), []);

    const label = title || (order
        ? (order.customer_name ? `Agregar a ${order.customer_name}` : `Agregar a la cuenta #${order.order_number}`)
        : 'Agregar productos');

    const flash = (productId) => {
        setPulse(productId);
        clearTimeout(pulseTimer.current);
        pulseTimer.current = setTimeout(() => setPulse(null), 260);
        tick();
    };

    const add = (product) => {
        flash(product.id);
        onAddProduct?.(product);
    };

    const remove = (product, item) => {
        flash(product.id);
        onRemoveProduct?.(product, item);
    };

    // Sin permiso para tomar pedido no hay carta que mostrar.
    if (!canCompose) return null;

    return (
        <div className="space-y-2 rounded-xl border p-3" data-testid={`${testIdPrefix}-pedido`}>
            <div className="flex items-center justify-between gap-2">
                <span className="page-kicker">{label}</span>
                <span className="flex items-center gap-1.5">
                    {/* El sonido es opcional y se recuerda: en un salón ruidoso el
                        clic confirma el toque, pero no todos lo quieren. */}
                    <button
                        type="button"
                        onClick={() => {
                            const next = !sound;
                            setSound(next);
                            setSoundEnabled(next);
                        }}
                        aria-pressed={sound}
                        aria-label={sound ? 'Silenciar la confirmación sonora' : 'Activar la confirmación sonora'}
                        title={sound ? 'Sonido activado' : 'Sonido desactivado'}
                        data-testid={`${testIdPrefix}-sonido`}
                        className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground hover:border-primary hover:text-foreground"
                    >
                        {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                    </button>
                    {showKitchen && (
                        <Button size="sm" onClick={() => onSendToKitchen?.()} data-testid={`${testIdPrefix}-enviar-cocina`}>
                            {sendLabel}
                        </Button>
                    )}
                </span>
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
                <Search className="h-4 w-4 absolute left-3 top-3.5 sm:top-3 text-muted-foreground" />
                <Input
                    className="pl-9"
                    placeholder="Buscar plato"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid={`${testIdPrefix}-buscar-producto`}
                />
            </div>
            {categories.length > 0 && (
                <div className="scroll-x flex gap-1.5 pb-1">
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
            <div className="grid grid-cols-2 gap-1.5 max-h-[38dvh] overflow-y-auto" data-testid={`${testIdPrefix}-productos`}>
                {visible.map((p) => {
                    const out = !p.is_available || (p.is_combo && p.components_available === false);
                    const mine = lines.filter((i) => i.product_id === p.id);
                    const qty = mine.reduce((s, i) => s + Number(i.quantity || 0), 0);
                    // El "−" sólo toca lo que sigue en borrador. Lo que ya salió a
                    // cocina se anula desde el resumen, no desaparece por acá.
                    const drafts = mine.filter((i) => isDraft(i, order?.status));
                    const target = drafts[drafts.length - 1] || null;
                    const busy = out || savingItem;
                    return (
                        <div
                            key={p.id}
                            data-testid={`${testIdPrefix}-producto-fila-${p.id}`}
                            className={`flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors ${out ? 'opacity-50' : 'hover:border-primary hover:bg-primary/5'} ${pulse === p.id ? 'composer-pulse' : ''}`}
                        >
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => add(p)}
                                data-testid={`${testIdPrefix}-producto-nombre-${p.id}`}
                                className="flex min-w-0 flex-1 flex-col text-left"
                            >
                                <span className="w-full truncate font-medium">{p.name}</span>
                                <span className="font-mono tabular-nums text-muted-foreground">{fmtMoney(p.price)}</span>
                            </button>
                            <span className="flex shrink-0 items-center gap-1">
                                {qty > 0 && (
                                    <>
                                        <button
                                            type="button"
                                            disabled={busy || !target}
                                            onClick={() => remove(p, target)}
                                            aria-label={`Quitar uno de ${p.name}`}
                                            data-testid={`${testIdPrefix}-producto-menos-${p.id}`}
                                            className="grid h-6 w-6 place-items-center rounded-full border border-border hover:bg-secondary"
                                        >
                                            <Minus className="h-3 w-3" />
                                        </button>
                                        <span
                                            className={`grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 font-semibold tabular-nums text-primary-foreground ${pulse === p.id ? 'composer-pulse' : ''}`}
                                            data-testid={`${testIdPrefix}-producto-cantidad-${p.id}`}
                                        >
                                            {qty}
                                        </span>
                                    </>
                                )}
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => add(p)}
                                    aria-label={`Agregar uno de ${p.name}`}
                                    data-testid={`${testIdPrefix}-producto-${p.id}`}
                                    className="grid h-6 w-6 place-items-center rounded-full border border-border hover:bg-primary hover:text-primary-foreground"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </button>
                            </span>
                        </div>
                    );
                })}
                {visible.length === 0 && (
                    <p className="col-span-2 text-xs text-muted-foreground py-2 text-center">{emptyLabel}</p>
                )}
            </div>
        </div>
    );
}
