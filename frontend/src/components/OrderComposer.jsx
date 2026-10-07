import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Minus, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { fmtMoney } from '@/lib/format';
import { setSoundEnabled, soundEnabled, tick } from '@/lib/feedback';
import { isCancelled, isDraft, sendAction } from '@/lib/orderDraft';

/**
 * Nota general para cocina del pedido completo.
 *
 * Vive en el compositor y también en la hoja del borrador (móvil): mismo
 * estado, mismo guardado (blur o Enter) y testid por prefijo. Si el PATCH
 * falla, el campo vuelve a la última nota confirmada.
 */
export function OrderNote({ order = null, testIdPrefix = 'mesa-sheet' }) {
    const [noteDraft, setNoteDraft] = useState(order?.notes || '');

    // La nota sigue al pedido (cambio de cuenta o refresco del polling); el
    // texto que se está escribiendo no se pisa porque las dependencias son los
    // valores del servidor, no la identidad del objeto.
    useEffect(() => {
        setNoteDraft(order?.notes || '');
    }, [order?.id, order?.notes]);

    const saveNote = async () => {
        if (!order?.id) return;
        const next = noteDraft.trim();
        if (next === String(order.notes || '').trim()) return;
        try {
            await api.patch(`/orders/${order.id}/notes`, { notes: next });
        } catch (e) {
            setNoteDraft(order.notes || '');
            toast.error(e.response?.data?.detail || 'No se pudo guardar la nota');
        }
    };

    if (!order) return null;

    return (
        <Textarea
            rows={2}
            className="text-sm"
            placeholder="Nota general para cocina (opcional)"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={saveNote}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    saveNote();
                }
            }}
            data-testid={`${testIdPrefix}-nota-general`}
        />
    );
}

/**
 * Carta para componer un pedido sin salir del panel.
 *
 * La disposición sigue la del prototipo de referencia: buscador, categorías como
 * pestañas, cada plato como tarjeta con su stepper `− n +` siempre visible, y un
 * pie pegajoso con lo que se lleva la cuenta y la acción de enviar. El pie es el
 * que evita que el mozo tenga que subir a buscar el botón después de agregar.
 *
 * Cada toque responde al instante: el número cambia, la tarjeta da un pulso breve
 * y (si el sonido está activo) suena un clic seco.
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
    sendLabel = null,
}) {
    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState('all');
    const [sound, setSound] = useState(soundEnabled);
    const [pulse, setPulse] = useState(null);
    const pulseTimer = useRef(null);

    const lines = (items || (order?.items || [])).filter((i) => !isCancelled(i));

    // La cantidad que se muestra es la de la cuenta abierta: el resumen general
    // de la mesa vive en el resumen de arriba, así que acá no se mezclan personas.
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
    const accountQty = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    // El envío dice cuánto viaja. Si la pantalla no trae su propia etiqueta
    // (Nuevo pedido), sale de las mismas reglas de `sendAction`.
    const sendButtonLabel = sendLabel || sendAction(lines, order)?.label || 'Enviar a cocina';

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

    const chip = (active) => [
        'shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary hover:text-foreground',
    ].join(' ');

    return (
        <div className="rounded-xl border" data-testid={`${testIdPrefix}-pedido`}>
            <div className="flex items-center justify-between gap-2 px-3 pt-3">
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
                {/* El sonido es opcional y se recuerda: en un salón ruidoso el clic
                    confirma el toque, pero no todos lo quieren. */}
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
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:border-primary hover:text-foreground"
                >
                    {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                </button>
            </div>

            <div className="space-y-2 p-3">
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
                        <button type="button" onClick={() => setCategoryId('all')} className={chip(categoryId === 'all')}>
                            Todas
                        </button>
                        {categories.map((c) => (
                            <button key={c.id} type="button" onClick={() => setCategoryId(c.id)} className={chip(categoryId === c.id)}>
                                {c.name}
                            </button>
                        ))}
                    </div>
                )}

                <div className="grid grid-cols-2 gap-2 max-h-[42dvh] overflow-y-auto" data-testid={`${testIdPrefix}-productos`}>
                    {visible.map((p) => {
                        const out = !p.is_available || (p.is_combo && p.components_available === false);
                        const mine = lines.filter((i) => i.product_id === p.id);
                        const qty = mine.reduce((s, i) => s + Number(i.quantity || 0), 0);
                        // El "−" sólo toca lo que sigue en borrador: lo que ya salió a
                        // cocina se anula desde el resumen, no desaparece por acá.
                        const drafts = mine.filter((i) => isDraft(i, order?.status));
                        const target = drafts[drafts.length - 1] || null;
                        const busy = out || savingItem;
                        return (
                            <div
                                key={p.id}
                                data-testid={`${testIdPrefix}-producto-fila-${p.id}`}
                                className={`relative flex flex-col rounded-xl border bg-card p-2.5 transition-colors ${out ? 'opacity-50' : 'hover:border-primary/60'} ${pulse === p.id ? 'composer-pulse' : ''}`}
                            >
                                {/* Badge del prototipo: indicador persistente de la
                                    cantidad, arriba a la derecha. No reemplaza al
                                    stepper: el número del medio es el del control. */}
                                {qty > 0 && (
                                    <span
                                        aria-hidden="true"
                                        data-testid={`${testIdPrefix}-producto-badge-${p.id}`}
                                        className="pointer-events-none absolute right-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-none text-primary-foreground"
                                    >
                                        {qty}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => add(p)}
                                    data-testid={`${testIdPrefix}-producto-nombre-${p.id}`}
                                    className="flex min-w-0 flex-col text-left"
                                >
                                    <span className="w-full truncate text-sm font-semibold">{p.name}</span>
                                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{fmtMoney(p.price)}</span>
                                </button>
                                <div className="mt-2 flex items-center justify-between">
                                    <button
                                        type="button"
                                        disabled={busy || qty === 0 || !target}
                                        onClick={() => remove(p, target)}
                                        aria-label={`Quitar uno de ${p.name}`}
                                        data-testid={`${testIdPrefix}-producto-menos-${p.id}`}
                                        className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
                                    >
                                        <Minus className="h-3.5 w-3.5" />
                                    </button>
                                    <span
                                        className={`text-sm font-bold tabular-nums ${qty > 0 ? '' : 'text-muted-foreground'} ${pulse === p.id ? 'composer-pulse' : ''}`}
                                        data-testid={`${testIdPrefix}-producto-cantidad-${p.id}`}
                                    >
                                        {qty}
                                    </span>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => add(p)}
                                        aria-label={`Agregar uno de ${p.name}`}
                                        data-testid={`${testIdPrefix}-producto-${p.id}`}
                                        className="grid h-7 w-7 place-items-center rounded-lg border border-border transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    {visible.length === 0 && (
                        <p className="col-span-2 py-2 text-center text-xs text-muted-foreground">{emptyLabel}</p>
                    )}
                </div>
            </div>

            {/* Nota general para cocina del pedido entero, no de un producto. */}
            {order && (
                <div className="px-3 pb-2">
                    <OrderNote order={order} testIdPrefix={testIdPrefix} />
                </div>
            )}

            {/* Pie: lo que se lleva la cuenta y la acción de enviar, juntos y siempre
                a la vista. Antes el envío vivía arriba y el mozo tenía que subir a
                buscarlo después de agregar. */}
            {order && (
                <div
                    className="sticky bottom-0 flex items-center justify-between gap-3 rounded-b-xl border-t bg-card/95 px-3 py-2 backdrop-blur"
                    data-testid={`${testIdPrefix}-pedido-resumen`}
                >
                    <div className="leading-tight">
                        <div className="text-xs text-muted-foreground">
                            {accountQty} en esta cuenta
                        </div>
                        <div className="font-mono text-sm font-semibold tabular-nums">{fmtMoney(order.total)}</div>
                    </div>
                    {showKitchen && (
                        <Button className="h-12 shrink-0" onClick={() => onSendToKitchen?.()} data-testid={`${testIdPrefix}-enviar-cocina`}>
                            {sendButtonLabel}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
