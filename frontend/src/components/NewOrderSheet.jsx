import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { createOrder, getOrder, sendOrderToKitchen } from '@/lib/api/orders';
import useOrderLineSync from '@/hooks/useOrderLineSync';
import { toast } from 'sonner';
import { ORDER_AREAS, ORDER_TYPE_LABELS } from '@/lib/format';
import OrderComposer from '@/components/OrderComposer';
import { PersonOrderSummary } from '@/components/OrderSummary';
import { apiErrorMessage } from '@/lib/apiError';

/**
 * Compositor único de "Nuevo pedido": las cuatro áreas de venta son pestañas del
 * mismo panel, así el mozo decide el tipo y carga los productos sin salir del
 * salón.
 *
 * - "Mesa" pide elegir la mesa y entrega el pedido al sheet de esa mesa.
 * - Llevar / Recojo / Delivery componen acá mismo, sin mesa, y la orden se crea
 *   recién con el primer producto.
 */
export default function NewOrderSheet({
    open,
    onOpenChange,
    tables = [],
    products = [],
    categories = [],
    canTake = false,
    onPickTable,
    onCreated,
}) {
    const [type, setType] = useState('mesa');
    const [order, setOrder] = useState(null);
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [customerAddress, setCustomerAddress] = useState('');
    // Account created by the queue that the state has not shown yet.
    const createdOrderRef = useRef(null);
    // Set when the queue created the order: saving taps then changes the list behind the sheet.
    const orderCreatedRef = useRef(false);

    const availableTables = useMemo(
        () => (tables || [])
            .filter((t) => t.status === 'disponible' && !t.active_order && !t.active_attention_id)
            .sort((a, b) => Number(a.number) - Number(b.number)),
        [tables]
    );

    // Al cerrar se limpia todo: el próximo "Nuevo pedido" arranca de cero.
    useEffect(() => {
        if (open) return;
        setType('mesa');
        setOrder(null);
        setCustomerName('');
        setCustomerPhone('');
        setCustomerAddress('');
        createdOrderRef.current = null;
        orderCreatedRef.current = false;
    }, [open]);

    const isTable = type === 'mesa';

    // Re-reads the order into the sheet; the sync queue asks it to throw on a
    // dead network, the other callers do not care.
    const reload = async (orderId, { strict = false } = {}) => {
        try {
            const { data } = await getOrder(orderId);
            if (data?.id !== orderId) return null;
            setOrder(data);
            return data;
        } catch (e) {
            if (strict) throw e;
            return null; /* la recarga es best-effort */
        }
    };

    // La orden nace con el primer producto, igual que en la mesa.
    const ensureOrder = async () => {
        if (order?.id) return order.id;
        if (createdOrderRef.current) return createdOrderRef.current;
        const payload = { order_type: type };
        if (customerName.trim()) payload.customer_name = customerName.trim();
        if (customerPhone.trim()) payload.customer_phone = customerPhone.trim();
        if (type === 'delivery') {
            if (!customerAddress.trim()) {
                toast.error('Falta la dirección del envío');
                return null;
            }
            payload.customer_address = customerAddress.trim();
        }
        const { data } = await createOrder(payload);
        createdOrderRef.current = data.id;
        orderCreatedRef.current = true;
        setOrder(data);
        return data.id;
    };

    // Taps update the screen at once and reach the server through a serial queue
    // (see `useOrderLineSync`), so a quick "+ + +" never loses a unit.
    const emptyOrder = useMemo(() => ({
        id: null, status: 'nuevo', items: [], total: 0,
    }), []);
    const sync = useOrderLineSync({
        order,
        placeholder: emptyOrder,
        ensureOrderId: ensureOrder,
        loadOrder: (orderId) => reload(orderId, { strict: true }),
        acceptOrder: setOrder,
        onError: (error, entry) => {
            toast.error(apiErrorMessage(
                error,
                entry.kind === 'new' && !entry.lineId ? 'No se pudo agregar el producto' : 'No se pudo cambiar la cantidad'
            ));
            if (entry.orderId) void reload(entry.orderId);
        },
        // Quantity changes are confirmed from the write's response; the list
        // behind the sheet only needs a refresh once the order exists.
        onSynced: () => {
            if (!orderCreatedRef.current) return;
            orderCreatedRef.current = false;
            onCreated?.();
        },
    });
    // The order as the waiter sees it: confirmed lines plus the taps on their way.
    const shownOrder = sync.order;
    const items = (shownOrder?.items || []).filter((i) => i.status !== 'cancelado');

    const addProduct = (product) => {
        if (!canTake) return Promise.resolve();
        return sync.tap(product, 1);
    };

    const removeProduct = (product, item) => {
        if (!canTake || !item) return Promise.resolve();
        return sync.tap(product, -1);
    };

    const changeQty = (item, delta) => {
        if (!canTake) return Promise.resolve();
        return sync.changeLine(item, delta, shownOrder?.id || order?.id || null);
    };

    const sendToKitchen = async () => {
        if (!canTake) return;
        // Never send a stale draft: wait for the taps still on their way.
        if (sync.busy()) {
            const failedBefore = sync.failures();
            await sync.flush();
            if (sync.failures() > failedBefore) return;
        }
        const orderId = sync.latest()?.id || order?.id;
        if (!orderId) return;
        try {
            await sendOrderToKitchen(orderId);
            toast.success('Enviado a cocina');
            onCreated?.();
            onOpenChange?.(false);
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo enviar a cocina'));
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="w-full sm:max-w-md p-0 flex flex-col"
                aria-describedby={undefined}
                data-testid="nuevo-pedido-sheet"
            >
                <SheetTitle className="sr-only">Nuevo pedido</SheetTitle>
                <div className="p-5 border-b">
                    <p className="page-kicker">Nuevo pedido</p>
                    <div className="scroll-x mt-2 flex gap-1.5 pb-1" data-testid="nuevo-pedido-tipos">
                        {ORDER_AREAS.map((area) => (
                            <button
                                key={area.key}
                                type="button"
                                onClick={() => setType(area.key)}
                                disabled={Boolean(shownOrder) && area.key !== type}
                                aria-pressed={type === area.key}
                                data-testid={`nuevo-pedido-tipo-${area.key}`}
                                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                                    type === area.key
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-border hover:border-primary hover:bg-primary/5'
                                }`}
                            >
                                {ORDER_TYPE_LABELS[area.key]}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                    {isTable ? (
                        availableTables.length === 0 ? (
                            <p className="text-sm text-muted-foreground" data-testid="nuevo-pedido-sin-mesas">
                                No hay mesas disponibles en este momento.
                            </p>
                        ) : (
                            <div className="grid grid-cols-3 gap-2" data-testid="nuevo-pedido-mesas">
                                {availableTables.map((t) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => onPickTable?.(t)}
                                        data-testid={`nuevo-pedido-mesa-${t.number}`}
                                        className="flex flex-col items-center justify-center rounded-lg border-2 border-border p-4 transition-colors hover:border-primary hover:bg-primary/5"
                                    >
                                        <span className="font-display text-2xl font-bold">{t.number}</span>
                                        <span className="mt-1 text-xs text-muted-foreground">{t.area}</span>
                                    </button>
                                ))}
                            </div>
                        )
                    ) : (
                        <>
                            {type === 'delivery' && (
                                <Input
                                    className="h-11"
                                    placeholder="Dirección de envío"
                                    value={customerAddress}
                                    onChange={(e) => setCustomerAddress(e.target.value)}
                                    data-testid="nuevo-pedido-direccion"
                                />
                            )}
                            <details
                                className="rounded-xl border px-3 py-2"
                                data-testid="nuevo-pedido-datos-opcionales"
                            >
                                <summary className="min-h-8 cursor-pointer list-none py-1 text-sm font-medium [&::-webkit-details-marker]:hidden">
                                    Datos del cliente <span className="font-normal text-muted-foreground">(opcional)</span>
                                </summary>
                                <div className="space-y-2 pt-2">
                                    <Input
                                        className="h-11"
                                        placeholder="Nombre"
                                        value={customerName}
                                        onChange={(e) => setCustomerName(e.target.value)}
                                        data-testid="nuevo-pedido-cliente"
                                    />
                                    <Input
                                        className="h-11"
                                        placeholder="Teléfono"
                                        value={customerPhone}
                                        onChange={(e) => setCustomerPhone(e.target.value)}
                                        data-testid="nuevo-pedido-telefono"
                                    />
                                </div>
                            </details>
                            <OrderComposer
                                order={shownOrder}
                                items={items}
                                products={products}
                                categories={categories}
                                canCompose={canTake}
                                showKitchen={Boolean(shownOrder) && shownOrder.status === 'nuevo' && items.length > 0}
                                testIdPrefix="nuevo-pedido"
                                onAddProduct={addProduct}
                                onRemoveProduct={removeProduct}
                                onSendToKitchen={sendToKitchen}
                            />
                            {shownOrder && (
                                <PersonOrderSummary
                                    items={shownOrder.items || []}
                                    orderStatus={shownOrder.status}
                                    canEdit={canTake}
                                    saving={false}
                                    onChangeQty={changeQty}
                                    products={products}
                                    categories={categories}
                                    testIdPrefix="nuevo-pedido"
                                />
                            )}
                        </>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
