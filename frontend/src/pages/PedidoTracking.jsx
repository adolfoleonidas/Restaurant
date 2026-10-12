import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import usePolling from '@/hooks/usePolling';
import usePublicStream from '@/hooks/usePublicStream';
import { useTableContext } from '@/contexts/TableContext';
import { useLiveOrder } from '@/contexts/LiveOrderContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fmtMoney, fmtElapsed, PAYMENT_LABELS, waMeLink } from '@/lib/format';
import {
    ORDER_STATUS_LABELS, PAYMENT_STATE_LABELS, PAYMENT_STATE_TONES, trackingStepsFor, trackingStepIndex,
} from '@/constants/status';
import { CheckCircle2, ChefHat, Bell, Truck, Clock, Upload, Image as ImageIcon, MapPin, Phone, Utensils, ShoppingBag, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import AttentionReference from '@/components/AttentionReference';
import TableSessionPanel from '@/components/TableSessionPanel';

const STEP_ICONS = {
    check: CheckCircle2,
    chef: ChefHat,
    bell: Bell,
    truck: Truck,
    utensils: Utensils,
    bag: ShoppingBag,
};

export default function PedidoTracking() {
    const { code } = useParams();
    const navigate = useNavigate();
    const { table, session, hasTable, refresh: refreshTable } = useTableContext();
    const { clearMeta } = useLiveOrder();
    const [restaurant, setRestaurant] = useState(null);
    const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
    const { generation } = usePublicStream({ trackingCode: code });
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const onVisibility = () => setVisible(!document.hidden);
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);
    useEffect(() => {
        api.get('/public/restaurant').then((r) => setRestaurant(r.data)).catch(() => {});
    }, []);
    // El SSE ya empuja cada cambio de estado; el sondeo queda como red de
    // seguridad. A 5 s eran 12 peticiones/minuto de datos y batería, así que
    // baja a 30 s y se alarga mientras la pestaña está oculta (el intervalo es
    // un parámetro del hook, no hace falta tocar usePolling).
    const pollInterval = visible ? 30000 : 300000;
    const { data: order, loading, error, refetch } = usePolling(
        () => api.get(`/public/orders/${code}`).then((r) => r.data),
        pollInterval,
        [code, generation]
    );
    const [proof, setProof] = useState(null);
    const [uploading, setUploading] = useState(false);
    // Resumen de la mesa resuelto por el propio pedido: el enlace de seguimiento
    // se comparte y se abre sin el `?mesa=` del QR, así que no se puede depender
    // del contexto guardado en el teléfono.
    const [ownTable, setOwnTable] = useState(null);
    const tableId = order?.table_id || '';
    useEffect(() => {
        if (!code || !tableId) return undefined;
        let active = true;
        api.get(`/public/orders/${code}/table`)
            .then((r) => { if (active) setOwnTable(r.data); })
            .catch(() => { if (active) setOwnTable(null); });
        return () => { active = false; };
    }, [code, tableId, generation, order?.status]);

    if (loading && !order) {
        return (
            <div className="max-w-xl mx-auto px-4 py-16 text-center text-muted-foreground">
                <h1 className="font-display text-2xl font-semibold mb-2 text-foreground">Seguimiento de pedido</h1>
                <p>Cargando…</p>
            </div>
        );
    }
    if (!order) {
        return (
            <div className="max-w-xl mx-auto px-4 py-16 text-center">
                <h1 className="font-display text-2xl font-semibold mb-2">Pedido no encontrado</h1>
                <p className="text-muted-foreground mb-6">{error ? 'No se pudo cargar el pedido.' : 'Verifica tu código de seguimiento.'}</p>
                <Button asChild><Link to="/">Ir al inicio</Link></Button>
            </div>
        );
    }

    const idx = trackingStepIndex(order.status);
    const cancelled = order.status === 'cancelado';
    const steps = trackingStepsFor(order.order_type);

    const onFile = (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        if (f.size > 1.8 * 1024 * 1024) { toast.error('Imagen muy pesada'); return; }
        const reader = new FileReader();
        reader.onload = (ev) => setProof(ev.target.result);
        reader.readAsDataURL(f);
    };
    const upload = async () => {
        setUploading(true);
        try { await api.post(`/public/orders/${code}/proof`, { payment_proof: proof }); toast.success('Comprobante enviado'); await refetch(); setProof(null); }
        catch (e) { toast.error(e.response?.data?.detail || 'No se pudo enviar el comprobante. Revisá tu conexión y reintentá.'); }
        finally { setUploading(false); }
    };
    const needsProof = !order.has_proof && ['yape', 'plin', 'transferencia'].includes(order.payment_method_choice);
    const paymentState = order.payment_state || (order.prepay_required ? 'pendiente' : 'no_requerido');
    const waitingForPayment = order.prepay_required && (paymentState === 'pendiente' || paymentState === 'reportado');
    const isTableOrder = order.order_type === 'local' && Boolean(order.table_id);
    // El resumen de la mesa sale del propio pedido; el del contexto del QR queda
    // como respaldo inmediato mientras llega la respuesta.
    const sessionTable = isTableOrder ? (ownTable || (hasTable ? { table, session } : null)) : null;
    const showSession = Boolean(sessionTable?.table && sessionTable?.session);
    const currentOrderId = order.id;

    // "Pedir algo más" no modifica el pedido ya enviado: abre una cuenta nueva
    // en la misma mesa, que se cobra y se prepara por separado.
    const orderMore = () => {
        clearMeta();
        refreshTable().catch(() => {});
        navigate('/menu');
    };

    return (
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-5" data-testid="tracking-root">
            <div>
                <div className="page-kicker">Seguimiento</div>
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <h1 className="font-display text-3xl md:text-4xl font-bold">Pedido #{order.order_number}</h1>
                    <span className="font-mono text-sm bg-secondary px-2 py-1 rounded-sm">{order.tracking_code}</span>
                </div>
                <AttentionReference order={order} publicView />
                <div className="text-sm text-muted-foreground">Realizado hace {fmtElapsed(order.created_at)}</div>
            </div>

            {(waitingForPayment || paymentState === 'rechazado' || paymentState === 'expirado') && !cancelled && (
                <div
                    className={`rounded-xl border p-4 text-sm ${PAYMENT_STATE_TONES[paymentState] || 'border-border bg-secondary/40 text-muted-foreground'}`}
                    data-testid="tracking-payment-state"
                    data-payment-state={paymentState}
                >
                    <div className="flex items-center gap-2 font-semibold">
                        {paymentState === 'confirmado' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                        {PAYMENT_STATE_LABELS[paymentState] || 'Estado de pago'}
                    </div>
                    <p className="mt-1 opacity-90">
                        {waitingForPayment
                            ? 'Tu pedido queda guardado y todavía no entra a cocina. Cuando el restaurante confirme el pago, empieza la preparación.'
                            : 'No se pudo verificar el pago. Probá de nuevo o consultá al personal del local.'}
                    </p>
                </div>
            )}

            <Card>
                <CardContent className="p-5">
                    {cancelled ? (
                        <div className="text-center py-6">
                            <div className="h-14 w-14 rounded-full bg-destructive/10 text-destructive mx-auto flex items-center justify-center mb-2"><Clock className="h-7 w-7" /></div>
                            <div className="font-display text-lg font-semibold">Pedido cancelado</div>
                            <div className="text-sm text-muted-foreground">Contacta al restaurante para más información</div>
                        </div>
                    ) : (
                        <div className="relative">
                            <div className="absolute left-7 top-7 bottom-7 w-0.5 bg-border" />
                            <div className="space-y-5">
                                {steps.map((step, i) => {
                                    const Icon = STEP_ICONS[step.icon];
                                    const done = i <= idx;
                                    const current = i === idx;
                                    return (
                                        <div key={step.key} className="relative flex items-start gap-4">
                                            <div className={`h-14 w-14 rounded-full flex items-center justify-center shrink-0 border-2 ${done ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border'} ${current ? 'ring-4 ring-primary/15' : ''}`}>
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <div className="pt-3.5">
                                                <div className={`font-semibold ${done ? '' : 'text-muted-foreground'}`}>{step.label}</div>
                                                {current && <div className="text-xs text-primary mt-0.5">{order.status === 'pendiente_pago' ? 'Esperando tu pago' : 'En curso'}</div>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {needsProof && (
                <Card><CardContent className="p-5 space-y-3">
                    <h2 className="font-display text-lg font-semibold">Sube tu comprobante de pago</h2>
                    <p className="text-sm text-muted-foreground">Pagaste por {PAYMENT_LABELS[order.payment_method_choice]}. Sube la captura para confirmar.</p>
                    {proof ? (
                        <div className="flex items-center gap-3 border rounded-xl p-2">
                            <img src={proof} alt="" className="h-20 w-20 object-cover rounded-lg" />
                            <div className="flex-1">
                                <Button size="sm" onClick={upload} disabled={uploading} data-testid="tracking-upload-button"><Upload className="h-4 w-4 mr-1" />Enviar</Button>
                                <Button size="sm" variant="outline" onClick={() => setProof(null)} className="ml-2">Cambiar</Button>
                            </div>
                        </div>
                    ) : (
                        <label className="flex items-center justify-center border-2 border-dashed rounded-xl py-8 cursor-pointer hover:bg-secondary/30">
                            <input type="file" accept="image/*" className="hidden" onChange={onFile} />
                            <div className="text-center text-sm text-muted-foreground"><ImageIcon className="h-8 w-8 mx-auto mb-2" /> Tocar para seleccionar</div>
                        </label>
                    )}
                </CardContent></Card>
            )}
            {order.has_proof && (
                <div className="text-sm text-primary bg-primary/10 border border-primary/20 rounded-sm p-3 text-center">Comprobante enviado al restaurante</div>
            )}

            <Card><CardContent className="p-5">
                <h2 className="font-display text-lg font-semibold mb-3">Detalle del pedido</h2>
                <div className="text-sm text-muted-foreground space-y-1 mb-3">
                    <div>Cliente: <span className="text-foreground">{order.customer_name}</span></div>
                    <div className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {order.customer_phone}</div>
                    {order.customer_address && <div className="flex items-start gap-1"><MapPin className="h-3.5 w-3.5 mt-0.5" /> {order.customer_address}</div>}
                    <div>Tipo: <span className="capitalize text-foreground">{order.order_type}</span></div>
                    <div>Método de pago: <span className="text-foreground">{PAYMENT_LABELS[order.payment_method_choice] || '—'}</span></div>
                </div>
                <div className="divide-y">
                    {(order.items || []).map((it) => (
                        <div key={it.id} className="py-2 flex justify-between text-sm">
                            <div><span className="font-semibold tabular-nums mr-2">{it.quantity}×</span>{it.product_name}
                                {it.notes && <div className="text-xs italic text-muted-foreground">“{it.notes}”</div>}
                            </div>
                            <span className="tabular-nums">{fmtMoney(it.subtotal)}</span>
                        </div>
                    ))}
                </div>
                <div className="border-t pt-3 mt-3 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{fmtMoney(order.subtotal)}</span></div>
                    {order.delivery_fee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Envío</span><span className="tabular-nums">{fmtMoney(order.delivery_fee)}</span></div>}
                    <div className="flex justify-between font-display text-xl font-bold pt-2 border-t mt-2"><span>Total</span><span className="tabular-nums">{fmtMoney(order.total)}</span></div>
                </div>
            </CardContent></Card>

            {showSession && (
                <Card><CardContent className="p-5">
                    <TableSessionPanel
                        table={sessionTable.table}
                        session={sessionTable.session}
                        currentOrderId={currentOrderId}
                        onOrderMore={orderMore}
                    />
                </CardContent></Card>
            )}

            {waMeLink(restaurant?.social_whatsapp, `Hola, consulto pedido #${order.order_number} código ${order.tracking_code}`) && (
                <Button asChild variant="outline" className="w-full">
                    <a href={waMeLink(restaurant.social_whatsapp, `Hola, consulto pedido #${order.order_number} código ${order.tracking_code}`)} target="_blank" rel="noreferrer">WhatsApp a la casa</a>
                </Button>
            )}

            <div className="text-center">
                <Button asChild variant="outline"><Link to="/">Volver al menú</Link></Button>
            </div>
        </div>
    );
}
