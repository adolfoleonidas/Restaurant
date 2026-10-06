import React, { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { ORDER_AREAS, ORDER_TYPE_LABELS } from '@/lib/format';
import OrderComposer from '@/components/OrderComposer';
import { PersonOrderSummary } from '@/components/OrderSummary';

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
    const [savingItem, setSavingItem] = useState(false);

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
    }, [open]);

    const items = (order?.items || []).filter((i) => i.status !== 'cancelado');
    const isTable = type === 'mesa';

    const reload = async (orderId) => {
        try {
            const { data } = await api.get(`/orders/${orderId}`);
            setOrder(data);
        } catch { /* la recarga es best-effort */ }
    };

    // La orden nace con el primer producto, igual que en la mesa.
    const ensureOrder = async () => {
        if (order?.id) return order.id;
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
        const { data } = await api.post('/orders', payload);
        setOrder(data);
        return data.id;
    };

    const addProduct = async (product) => {
        if (!canTake || savingItem) return;
        setSavingItem(true);
        try {
            const orderId = await ensureOrder();
            if (!orderId) return;
            await api.post(`/orders/${orderId}/items`, [{ product_id: product.id, quantity: 1 }]);
            await reload(orderId);
            onCreated?.();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo agregar el producto');
        } finally {
            setSavingItem(false);
        }
    };

    const changeQty = async (item, delta) => {
        if (!order?.id || !canTake) return;
        const next = Number(item.quantity || 1) + delta;
        try {
            if (next <= 0) await api.delete(`/orders/${order.id}/items/${item.id}`);
            else await api.patch(`/orders/${order.id}/items/${item.id}`, { quantity: next });
            await reload(order.id);
            onCreated?.();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo cambiar la cantidad');
        }
    };

    const sendToKitchen = async () => {
        if (!order?.id || !canTake) return;
        try {
            await api.post(`/orders/${order.id}/send-to-kitchen`);
            toast.success('Enviado a cocina');
            onCreated?.();
            onOpenChange?.(false);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo enviar a cocina');
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
                                disabled={Boolean(order) && area.key !== type}
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
                                order={order}
                                items={items}
                                products={products}
                                categories={categories}
                                savingItem={savingItem}
                                canCompose={canTake}
                                showKitchen={Boolean(order) && order.status === 'nuevo' && items.length > 0}
                                testIdPrefix="nuevo-pedido"
                                onAddProduct={addProduct}
                                onSendToKitchen={sendToKitchen}
                            />
                            {order && (
                                <PersonOrderSummary
                                    items={order.items || []}
                                    orderStatus={order.status}
                                    canEdit={canTake}
                                    saving={savingItem}
                                    onChangeQty={changeQty}
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
