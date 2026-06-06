import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/lib/api';
import usePolling from '@/hooks/usePolling';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fmtMoney, fmtElapsed, ORDER_STATUS_LABELS, PAYMENT_LABELS } from '@/lib/format';
import { CheckCircle2, ChefHat, Bell, Truck, Clock, Upload, Image as ImageIcon, MapPin, Phone } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_STEPS = [
    { key: 'nuevo', label: 'Pedido recibido', icon: CheckCircle2 },
    { key: 'en_preparacion', label: 'En preparación', icon: ChefHat },
    { key: 'listo', label: 'Listo', icon: Bell },
    { key: 'entregado', label: 'Entregado / En camino', icon: Truck },
    { key: 'pagado', label: 'Completado', icon: CheckCircle2 },
];

const statusIndex = (s) => {
    if (s === 'nuevo') return 0;
    if (s === 'enviado_cocina' || s === 'en_preparacion') return 1;
    if (s === 'listo') return 2;
    if (s === 'entregado' || s === 'pendiente_pago') return 3;
    if (s === 'pagado') return 4;
    return 0;
};

export default function PedidoTracking() {
    const { code } = useParams();
    const { data: order, refetch } = usePolling(
        () => api.get(`/public/orders/${code}`).then((r) => r.data).catch(() => null),
        5000,
        [code]
    );
    const [proof, setProof] = useState(null);
    const [uploading, setUploading] = useState(false);

    if (order === null) return (
        <div className="max-w-xl mx-auto px-4 py-16 text-center">
            <h2 className="font-display text-2xl font-semibold mb-2">Pedido no encontrado</h2>
            <p className="text-muted-foreground mb-6">Verifica tu código de seguimiento.</p>
            <Button asChild><Link to="/">Ir al inicio</Link></Button>
        </div>
    );
    if (!order) return <div className="max-w-xl mx-auto px-4 py-16 text-center text-muted-foreground">Cargando…</div>;

    const idx = statusIndex(order.status);
    const cancelled = order.status === 'cancelado';

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
        catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
        finally { setUploading(false); }
    };
    const needsProof = !order.has_proof && ['yape', 'plin', 'transferencia'].includes(order.payment_method_choice);

    return (
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-5" data-testid="tracking-root">
            <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Seguimiento</div>
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <h1 className="font-display text-2xl md:text-3xl font-bold">Pedido #{order.order_number}</h1>
                    <span className="font-mono text-sm bg-secondary px-2 py-1 rounded">{order.tracking_code}</span>
                </div>
                <div className="text-sm text-muted-foreground">Realizado hace {fmtElapsed(order.created_at)}</div>
            </div>

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
                                {STATUS_STEPS.map((step, i) => {
                                    const Icon = step.icon;
                                    const done = i <= idx;
                                    const current = i === idx;
                                    return (
                                        <div key={step.key} className="relative flex items-start gap-4">
                                            <div className={`h-14 w-14 rounded-full flex items-center justify-center shrink-0 border-2 ${done ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border'} ${current ? 'ring-4 ring-primary/15' : ''}`}>
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <div className="pt-3.5">
                                                <div className={`font-semibold ${done ? '' : 'text-muted-foreground'}`}>{step.label}</div>
                                                {current && <div className="text-xs text-primary mt-0.5">En curso</div>}
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
                <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">✓ Comprobante enviado al restaurante</div>
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

            <div className="text-center">
                <Button asChild variant="outline"><Link to="/">Volver al menú</Link></Button>
            </div>
        </div>
    );
}
