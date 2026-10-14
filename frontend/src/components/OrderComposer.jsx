import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ComposerProductCard from '@/components/ComposerProductCard';
import SyncStatus from '@/components/SyncStatus';
import { setOrderNotes } from '@/lib/api/orders';
import { apiErrorMessage } from '@/lib/apiError';
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
            await setOrderNotes(order.id, { notes: next });
        } catch (e) {
            setNoteDraft(order.notes || '');
            toast.error(apiErrorMessage(e, 'No se pudo guardar la nota'));
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
 * pestañas, cada plato como tarjeta con su stepper `− n +` cuando ya está en la cuenta, y un
 * pie pegajoso con lo que se lleva la cuenta y la acción de enviar. El pie es el
 * que evita que el mozo tenga que subir a buscar el botón después de agregar.
 *
 * Cada toque responde al instante: el número cambia, la tarjeta cambia de color
 * mientras se toca (CSS) y (si el sonido está activo) suena un clic seco.
 *
 * La carta NUNCA se deshabilita por el estado de la pantalla: un producto que no
 * se puede pedir (`out`) es el único que no acepta el toque. Lo que el mozo toca
 * mientras la cuenta se está guardando o cargando no se pierde: lo retiene la cola
 * de la hoja (ver `useTableSheet`) y viaja en el lote siguiente.
 */
export default function OrderComposer({
    order = null,
    items,
    products = [],
    categories = [],
    // 'saving' | 'unsaved' | 'idle': where the waiter's taps are (see `SyncStatus`).
    saveState = 'idle',
    canCompose = false,
    showKitchen = false,
    testIdPrefix = 'mesa-sheet',
    title = null,
    emptyLabel = 'Sin productos.',
    onAddProduct,
    onRemoveProduct,
    onSendToKitchen,
    sendLabel = null,
    // El tomador del prototipo pone nota y envío en el TICKET, no en la carta.
    showActions = true,
    // La carta del tomador no lleva el rótulo "Agregar a…": lo dice la franja
    // "Para {persona}" del prototipo.
    showHeader = true,
    hideUnavailable = false,
}) {
    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState('all');
    const [sound, setSound] = useState(soundEnabled);

    const lines = useMemo(
        () => (items || (order?.items || [])).filter((i) => !isCancelled(i)),
        [items, order?.items]
    );
    // Units on the open account and the draft line a "−" takes from, per product,
    // so each card gets plain values instead of scanning every line itself.
    const orderStatus = order?.status;
    const perProduct = useMemo(() => {
        const map = new Map();
        lines.forEach((line) => {
            let entry = map.get(line.product_id);
            if (!entry) {
                entry = { qty: 0, target: null };
                map.set(line.product_id, entry);
            }
            entry.qty += Number(line.quantity || 0);
            // El "−" sólo toca lo que sigue en borrador: lo que ya salió a
            // cocina se anula desde el resumen, no desaparece por acá.
            if (isDraft(line, orderStatus)) entry.target = line;
        });
        return map;
    }, [lines, orderStatus]);
    const perProductRef = useRef(perProduct);
    perProductRef.current = perProduct;
    // The latest callbacks without making the cards' own callbacks change.
    const callbacks = useRef({});
    callbacks.current = { onAddProduct, onRemoveProduct };

    // La cantidad que se muestra es la de la cuenta abierta: el resumen general
    // de la mesa vive en el resumen de arriba, así que acá no se mezclan personas.
    const visible = useMemo(() => (products || [])
        .filter((p) => {
            if (hideUnavailable && (!p.is_available || (p.is_combo && p.components_available === false))) return false;
            if (categoryId !== 'all' && p.category_id !== categoryId) return false;
            if (search && !String(p.name || '').toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1))), [products, categoryId, search, hideUnavailable]);

    const label = title || (order
        ? (order.customer_name ? `Agregar a ${order.customer_name}` : `Agregar a la cuenta #${order.order_number}`)
        : 'Agregar productos');
    const accountQty = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    // El envío dice cuánto viaja. Si la pantalla no trae su propia etiqueta
    // (Nuevo pedido), sale de las mismas reglas de `sendAction`.
    const sendButtonLabel = sendLabel || sendAction(lines, order)?.label || 'Enviar a cocina';

    // The visual response to a tap is CSS (`.composer-card:active`); here only the click.
    const add = useCallback((product) => {
        tick();
        callbacks.current.onAddProduct?.(product);
    }, []);

    const remove = useCallback((product) => {
        tick();
        callbacks.current.onRemoveProduct?.(product, perProductRef.current.get(product.id)?.target || null);
    }, []);

    // Sin permiso para tomar pedido no hay carta que mostrar.
    if (!canCompose) return null;

    const chip = (active) => [
        'shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary hover:text-foreground',
    ].join(' ');

    return (
        <div className={showHeader ? 'rounded-xl border' : ''} data-testid={`${testIdPrefix}-pedido`}>
            {showHeader && (
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
            )}

            <div className="space-y-2 p-3">
                <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-3.5 sm:top-3 text-muted-foreground" />
                    <Input
                        className="pl-9"
                        placeholder="Buscar plato o bebida…"
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

                {/* Grilla del prototipo: 2 col en móvil, 3 desde 600px y
                    auto-fill (4+ a 1440) desde 960px. */}
                <div
                    className="grid grid-cols-2 gap-2.5 max-h-[42dvh] overflow-y-auto min-[600px]:grid-cols-3 min-[960px]:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
                    data-testid={`${testIdPrefix}-productos`}
                >
                    {visible.map((p) => {
                        const out = !p.is_available || (p.is_combo && p.components_available === false);
                        const entry = perProduct.get(p.id);
                        return (
                            <ComposerProductCard
                                key={p.id}
                                product={p}
                                qty={entry?.qty || 0}
                                out={out}
                                busy={out}
                                canRemove={Boolean(entry?.target)}
                                testIdPrefix={testIdPrefix}
                                onAdd={add}
                                onRemove={remove}
                            />
                        );
                    })}
                    {visible.length === 0 && (
                        <p className="col-span-2 py-2 text-center text-xs text-muted-foreground">{emptyLabel}</p>
                    )}
                </div>
            </div>

            {/* Nota general para cocina del pedido entero, no de un producto. */}
            {order && showActions && (
                <div className="px-3 pb-2">
                    <OrderNote order={order} testIdPrefix={testIdPrefix} />
                </div>
            )}

            {/* Pie: lo que se lleva la cuenta y la acción de enviar, juntos y siempre
                a la vista. Antes el envío vivía arriba y el mozo tenía que subir a
                buscarlo después de agregar. */}
            {order && showActions && (
                <div
                    className="sticky bottom-0 flex items-center justify-between gap-3 rounded-b-xl border-t bg-card/95 px-3 py-2"
                    data-testid={`${testIdPrefix}-pedido-resumen`}
                >
                    <div className="leading-tight">
                        <div className="text-xs text-muted-foreground">
                            {accountQty} en esta cuenta
                        </div>
                        <div className="font-mono text-sm font-semibold tabular-nums">{fmtMoney(order.total)}</div>
                        <SyncStatus state={saveState} testId={`${testIdPrefix}-sync`} />
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
