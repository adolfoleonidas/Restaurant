import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useCart } from '@/contexts/CartContext';
import { useLiveOrder } from '@/contexts/LiveOrderContext';
import { api } from '@/lib/api';
import { submitPublicOrder } from '@/lib/orderRequest';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtMoney, PAYMENT_LABELS, waMeLink } from '@/lib/format';
import { toast } from 'sonner';
import AttentionReference from '@/components/AttentionReference';
import { Truck, ShoppingBag, Utensils, Copy, CheckCircle2, ChevronLeft, Smartphone, Banknote, CreditCard as CreditCardIcon, Building2, Upload, Image as ImageIcon } from 'lucide-react';

const ORDER_TYPE_INFO = {
    local: { label: 'Comer en local', icon: Utensils, desc: 'Te esperamos en nuestra mesa' },
    recojo: { label: 'Recojo en tienda', icon: ShoppingBag, desc: 'Recoge tu pedido en tienda' },
    delivery: { label: 'Delivery', icon: Truck, desc: 'A domicilio (con costo de envío)' },
};

const METHOD_ICON = { efectivo: Banknote, yape: Smartphone, plin: Smartphone, tarjeta: CreditCardIcon, transferencia: Building2 };

export default function Checkout() {
    const { items, subtotal, clear } = useCart();
    const { setMeta, isActive } = useLiveOrder();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [restaurant, setRestaurant] = useState(null);
    const [paymentCfg, setPaymentCfg] = useState(null);
    const [orderType, setOrderType] = useState(() => {
        const t = searchParams.get('tipo');
        return ['local', 'recojo', 'delivery'].includes(t) ? t : 'local';
    });
    const [tableToken] = useState(() => searchParams.get('mesa') || '');
    const [tableInfo, setTableInfo] = useState(null);
    const [tableId, setTableId] = useState('');
    const [tables, setTables] = useState([]);
    const [pickupBranches, setPickupBranches] = useState([]);
    const [pickupBranchId, setPickupBranchId] = useState('');
    const [pickupBranchesLoading, setPickupBranchesLoading] = useState(false);
    const [pickupBranchesError, setPickupBranchesError] = useState(false);
    const [customer, setCustomer] = useState({ name: '', phone: '', address: '', email: '' });
    const [notes, setNotes] = useState('');
    const [method, setMethod] = useState('yape');
    const [submitting, setSubmitting] = useState(false);
    const [confirmed, setConfirmed] = useState(null); // { tracking_code, order_number, total, payment_method }
    const [copied, setCopied] = useState(null);
    const [proofFile, setProofFile] = useState(null); // data URL
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        api.get('/public/restaurant').then((r) => setRestaurant(r.data));
        api.get('/public/payment-config').then((r) => {
            setPaymentCfg(r.data);
            const enabled = ['yape', 'plin', 'efectivo', 'transferencia', 'tarjeta'].find((m) => r.data[`enable_${m}`]);
            if (enabled) setMethod(enabled);
        });
    }, []);

    useEffect(() => {
        if (tableToken) {
            api.get('/public/tables/resolve', { params: { token: tableToken } })
                .then((r) => setTableInfo(r.data))
                .catch(() => setTableInfo(null));
            return;
        }
        if (restaurant?.require_table_qr) return;
        api.get('/public/tables').then((r) => setTables(r.data || [])).catch(() => setTables([]));
    }, [tableToken, restaurant]);

    useEffect(() => {
        let active = true;
        if (orderType !== 'recojo') {
            setPickupBranchId('');
            setPickupBranchesError(false);
            return () => { active = false; };
        }
        setPickupBranchesLoading(true);
        setPickupBranchesError(false);
        api.get('/public/pickup-branches').then((r) => {
            if (active) setPickupBranches(r.data || []);
        }).catch(() => {
            if (active) { setPickupBranches([]); setPickupBranchesError(true); }
        }).finally(() => { if (active) setPickupBranchesLoading(false); });
        return () => { active = false; };
    }, [orderType]);

    useEffect(() => {
        if (confirmed) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, [confirmed]);

    const deliveryFee = orderType === 'delivery' ? (restaurant?.delivery_fee || 0) : 0;
    const total = subtotal + deliveryFee;

    const enabledMethods = paymentCfg ? ['efectivo', 'yape', 'plin', 'transferencia', 'tarjeta'].filter((m) => paymentCfg[`enable_${m}`]) : [];

    if (items.length === 0 && !confirmed) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-16 text-center">
                <ShoppingBag className="h-12 w-12 mx-auto opacity-40 mb-4" />
                <h2 className="font-display text-2xl font-semibold mb-2">Tu carrito está vacío</h2>
                <p className="text-muted-foreground mb-6">Agrega algunos platos para continuar.</p>
                <Button asChild><Link to="/">Ver menú</Link></Button>
            </div>
        );
    }

    const copyText = (text, key) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(key);
            toast.success('Copiado al portapapeles');
            setTimeout(() => setCopied(null), 1500);
        });
    };

    const onFile = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (f.size > 1.8 * 1024 * 1024) { toast.error('Imagen muy pesada. Máximo ~1.8MB.'); return; }
        const reader = new FileReader();
        reader.onload = (ev) => setProofFile(ev.target.result);
        reader.readAsDataURL(f);
    };

    const uploadProof = async () => {
        if (!proofFile || !confirmed) return;
        setUploading(true);
        try {
            await api.post(`/public/orders/${confirmed.tracking_code}/proof`, { payment_proof: proofFile });
            toast.success('Comprobante enviado al restaurante');
        } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo subir'); }
        finally { setUploading(false); }
    };

    const submit = async () => {
        if (orderType !== 'local' && (!customer.name.trim() || !customer.phone.trim())) {
            toast.error('Completa tu nombre y celular'); return;
        }
        if (orderType === 'delivery' && !customer.address.trim()) {
            toast.error('Indica la dirección para delivery'); return;
        }
        if (orderType === 'recojo' && !pickupBranches.some((branch) => branch.id === pickupBranchId)) {
            toast.error('Selecciona una sucursal habilitada para recojo'); return;
        }
        if (orderType === 'local' && tableToken && !tableInfo) {
            toast.error('Escaneá el QR de tu mesa'); return;
        }
        if (orderType === 'local' && !tableToken && !tableId) {
            toast.error(restaurant?.require_table_qr ? 'Escaneá el QR de tu mesa' : 'Elegí tu mesa'); return;
        }
        setSubmitting(true);
        try {
            const payload = {
                order_type: orderType,
                customer_name: customer.name.trim(),
                customer_phone: customer.phone.trim(),
                customer_address: customer.address.trim() || null,
                customer_email: customer.email.trim() || null,
                items: items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, notes: it.notes || null })),
                notes: notes.trim() || null,
                payment_method: method,
                table_token: orderType === 'local' && tableToken ? tableToken : null,
                table_id: orderType === 'local' && !tableToken ? tableId : null,
                ...(orderType === 'recojo' ? { branch_id: pickupBranchId } : {}),
            };
            await submitPublicOrder({
                storage: window.sessionStorage,
                cryptoSource: window.crypto,
                fingerprint: JSON.stringify(payload),
                payload,
                post: (requestPayload) => api.post('/public/orders', requestPayload),
                onConfirmed: (data) => {
                    setConfirmed({
                        ...data,
                        order_type: orderType,
                        branchName: pickupBranches.find((branch) => branch.id === pickupBranchId)?.name || null,
                    });
                    if (!isActive) {
                        setMeta({
                            tracking_code: data.tracking_code,
                            order_number: data.order_number,
                            table_id: orderType === 'local' ? tableInfo?.id : null,
                        });
                    }
                    clear();
                    toast.success(`Pedido #${data.order_number} confirmado`);
                },
            });
        } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo crear el pedido'); }
        finally { setSubmitting(false); }
    };

    if (confirmed) {
        const needsProof = ['yape', 'plin', 'transferencia'].includes(confirmed.payment_method);
        return (
            <div className="max-w-2xl mx-auto px-4 py-10 space-y-5" data-testid="checkout-confirmed-root">
                <Card>
                    <CardContent className="p-6 text-center">
                        <div className="h-16 w-16 rounded-sm bg-primary text-primary-foreground mx-auto flex items-center justify-center mb-3">
                            <CheckCircle2 className="h-9 w-9" />
                        </div>
                        <h1 className="font-display italic text-3xl font-bold">Pedido en cocina</h1>
                        <p className="text-muted-foreground mt-1">Seguí el estado con tu código. Si necesitás hablar con la casa, usá WhatsApp.</p>
                        <div className="mt-4 rounded-xl bg-secondary/40 p-4 inline-flex flex-col items-center gap-1">
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">Número de pedido</span>
                            <span className="font-display text-3xl font-bold">#{confirmed.order_number}</span>
                            <span className="text-xs text-muted-foreground">Código seguimiento: <span className="font-mono" data-testid="checkout-tracking-code">{confirmed.tracking_code}</span></span>
                        </div>
                        <AttentionReference order={confirmed} branchName={confirmed.branchName} publicView />
                        <div className="mt-4 font-display text-2xl font-bold tabular-nums">Total: {fmtMoney(confirmed.total)}</div>
                        <Button asChild variant="outline" className="mt-4">
                            <Link to={`/pedido/${confirmed.tracking_code}`} data-testid="checkout-ver-estado">Ver estado del pedido</Link>
                        </Button>
                    </CardContent>
                </Card>

                {needsProof && (
                    <Card><CardContent className="p-5 space-y-3">
                        <h2 className="font-display text-lg font-semibold">Sube tu comprobante (opcional pero recomendado)</h2>
                        <p className="text-sm text-muted-foreground">Adjunta la captura del pago para confirmar más rápido tu pedido.</p>
                        {proofFile ? (
                            <div className="flex items-center gap-3 border rounded-xl p-2">
                                <img src={proofFile} alt="comprobante" className="h-20 w-20 object-cover rounded-lg" />
                                <div className="flex-1">
                                    <div className="text-sm font-medium">Captura cargada</div>
                                    <div className="flex gap-2 mt-2">
                                        <Button size="sm" onClick={uploadProof} disabled={uploading} data-testid="checkout-upload-proof"><Upload className="h-4 w-4 mr-1" />Enviar al restaurante</Button>
                                        <Button size="sm" variant="outline" onClick={() => setProofFile(null)}>Cambiar</Button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <label className="flex items-center justify-center border-2 border-dashed rounded-xl py-8 cursor-pointer hover:bg-secondary/30 transition-colors" data-testid="checkout-proof-dropzone">
                                <input type="file" accept="image/*" className="hidden" onChange={onFile} />
                                <div className="text-center text-sm text-muted-foreground">
                                    <ImageIcon className="h-8 w-8 mx-auto mb-2" />
                                    Toca para seleccionar imagen del comprobante
                                </div>
                            </label>
                        )}
                    </CardContent></Card>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                    {waMeLink(restaurant?.social_whatsapp, `Hola, mi pedido es #${confirmed.order_number} código ${confirmed.tracking_code}`) && (
                        <Button asChild variant="outline" className="flex-1">
                            <a
                                href={waMeLink(restaurant.social_whatsapp, `Hola, mi pedido es #${confirmed.order_number} código ${confirmed.tracking_code}`)}
                                target="_blank"
                                rel="noreferrer"
                                data-testid="checkout-whatsapp"
                            >
                                WhatsApp a la casa
                            </a>
                        </Button>
                    )}
                    <Button asChild variant="outline" className="flex-1"><Link to="/">Volver al menú</Link></Button>
                    <Button asChild className="flex-1"><Link to={`/pedido/${confirmed.tracking_code}`} data-testid="checkout-track-button">Ver estado del pedido</Link></Button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto px-4 py-8 pb-32" data-testid="checkout-root">
            <div className="mb-5">
                <Button asChild variant="ghost" size="sm"><Link to="/"><ChevronLeft className="h-4 w-4 mr-1" /> Seguir comprando</Link></Button>
            </div>
            <p className="page-kicker mb-2">Carta</p>
            <h1 className="font-display italic text-4xl font-bold mb-6">Confirmar pedido</h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-5">
                    {/* Order type */}
                    <Card><CardContent className="p-5">
                        <h2 className="font-display text-lg font-semibold mb-3">¿Cómo lo quieres?</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {Object.entries(ORDER_TYPE_INFO).map(([k, v]) => (
                                <button
                                    key={k}
                                    onClick={() => setOrderType(k)}
                                    data-testid={`checkout-tipo-${k}`}
                                    className={`text-left rounded-xl border p-3 transition-all ${orderType === k ? 'border-primary ring-2 ring-primary/30 bg-primary/5' : 'hover:bg-secondary/40'}`}
                                >
                                    <v.icon className="h-5 w-5 text-primary mb-1" />
                                    <div className="font-semibold">{v.label}</div>
                                    <div className="text-xs text-muted-foreground">{v.desc}</div>
                                </button>
                            ))}
                        </div>
                    </CardContent></Card>

                    {orderType === 'local' && (
                        <Card><CardContent className="p-5">
                            <h2 className="font-display text-lg font-semibold mb-3">{tableInfo ? 'Tu mesa' : '¿En qué mesa estás?'}</h2>
                            {tableInfo ? (
                                <p className="text-sm">Mesa <span className="font-display text-xl font-semibold">{tableInfo.number}</span>{tableInfo.area ? ` · ${tableInfo.area}` : ''}</p>
                            ) : restaurant?.require_table_qr ? (
                                <p className="text-sm text-muted-foreground">Escaneá el QR de tu mesa para pedir en el local.</p>
                            ) : tables.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No hay mesas disponibles ahora. Pedí recojo o avisá al mozo.</p>
                            ) : (
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                    {tables.map((t) => {
                                        const active = t.active_order;
                                        const billPending = active?.status === 'pendiente_pago';
                                        const blocked = billPending || t.status !== 'disponible';
                                        return (
                                            <button
                                                key={t.id}
                                                type="button"
                                                onClick={() => setTableId(t.id)}
                                                disabled={blocked}
                                                data-testid={`checkout-mesa-${t.number}`}
                                                className={`rounded-sm border p-3 text-left disabled:opacity-50 disabled:cursor-not-allowed ${tableId === t.id ? 'border-primary ring-2 ring-primary/30 bg-primary/10' : 'hover:bg-secondary/40'}`}
                                            >
                                                <div className="font-display italic text-xl font-semibold">{t.number}</div>
                                                <div className="text-[11px] text-muted-foreground">{t.area}</div>
                                                {billPending && <div className="mt-1 text-[10px] font-medium text-amber-700">Cuenta solicitada</div>}
                                                {blocked && !billPending && <div className="mt-1 text-[10px] font-medium text-red-700">Ocupado</div>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </CardContent></Card>
                    )}

                    {orderType === 'recojo' && (
                        <Card><CardContent className="p-5 space-y-2">
                            <Label htmlFor="checkout-pickup-branch">Sucursal de recojo *</Label>
                            {pickupBranchesLoading ? <p className="text-sm text-muted-foreground">Cargando sucursales…</p> : pickupBranchesError ? <p role="alert" className="text-sm text-destructive">No se pudieron cargar las sucursales. Intenta nuevamente.</p> : pickupBranches.length === 0 ? <p className="text-sm text-muted-foreground">No hay sucursales disponibles para recojo</p> : (
                                <select id="checkout-pickup-branch" className="h-11 w-full rounded-md border bg-background px-3" value={pickupBranchId} onChange={(e) => setPickupBranchId(e.target.value)} data-testid="checkout-pickup-branch">
                                    <option value="">Selecciona una sucursal</option>
                                    {pickupBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                                </select>
                            )}
                        </CardContent></Card>
                    )}

                    {/* Customer data */}
                    <Card><CardContent className="p-5">
                        <h2 className="font-display text-lg font-semibold mb-1">Tus datos</h2>
                        {orderType === 'local' ? (
                            <p className="text-sm text-muted-foreground mb-3">Opcional: si querés, dejá tu nombre para conocerte mejor. En mesa no es obligatorio.</p>
                        ) : (
                            <p className="text-sm text-muted-foreground mb-3">Los necesitamos para entregarte el pedido.</p>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div><Label>Nombre y apellidos{orderType === 'local' ? '' : ' *'}</Label><Input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} className="h-11" data-testid="checkout-nombre" /></div>
                            <div><Label>Celular{orderType === 'local' ? '' : ' *'}</Label><Input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} className="h-11" placeholder="+51 999 888 777" data-testid="checkout-celular" /></div>
                            <div className="sm:col-span-2"><Label>Correo (opcional)</Label><Input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} className="h-11" /></div>
                            {orderType === 'delivery' && (
                                <div className="sm:col-span-2"><Label>Dirección de entrega *</Label><Textarea value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} placeholder="Calle, número, referencia" data-testid="checkout-direccion" /></div>
                            )}
                            <div className="sm:col-span-2"><Label>Observaciones del pedido (opcional)</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: sin picante, cubiertos extra…" /></div>
                        </div>
                    </CardContent></Card>

                    {/* Payment method */}
                    <Card><CardContent className="p-5">
                        <h2 className="font-display text-lg font-semibold mb-3">Método de pago</h2>
                        <Tabs value={method} onValueChange={setMethod}>
                            <TabsList className="flex flex-wrap h-auto">
                                {enabledMethods.map((m) => {
                                    const Icon = METHOD_ICON[m];
                                    return <TabsTrigger key={m} value={m} data-testid={`checkout-method-${m}`}><Icon className="h-4 w-4 mr-1" />{PAYMENT_LABELS[m]}</TabsTrigger>;
                                })}
                            </TabsList>
                        </Tabs>

                        <div className="mt-4">
                            {(method === 'yape' || method === 'plin') && paymentCfg && (
                                <div className="rounded-xl border bg-secondary/30 p-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                                        <div className="flex items-center justify-center">
                                            {paymentCfg[`${method}_qr`] ? (
                                                <img src={paymentCfg[`${method}_qr`]} alt={`QR ${method}`} className="max-h-56 rounded-xl border bg-white p-2" />
                                            ) : (
                                                <div className="h-56 w-56 rounded-xl border-2 border-dashed flex items-center justify-center text-muted-foreground text-sm text-center px-4">QR no configurado aún</div>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <div className="text-xs uppercase text-muted-foreground tracking-wide">{PAYMENT_LABELS[method]}</div>
                                            <div className="font-display text-2xl font-bold tabular-nums">{paymentCfg[`${method}_number`] || '—'}</div>
                                            <Button variant="outline" size="sm" onClick={() => copyText(paymentCfg[`${method}_number`] || '', method)} data-testid={`checkout-copy-${method}`}><Copy className="h-3.5 w-3.5 mr-1" /> {copied === method ? 'Copiado' : 'Copiar número'}</Button>
                                            <div className="text-sm text-muted-foreground pt-2">Titular: <span className="text-foreground">{paymentCfg[`${method}_holder`] || '—'}</span></div>
                                            <div className="text-sm pt-2">Monto a pagar: <span className="font-bold tabular-nums">{fmtMoney(total)}</span></div>
                                            <div className="text-xs text-muted-foreground pt-2">Realiza el pago y al confirmar el pedido podrás subir tu comprobante.</div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {method === 'transferencia' && paymentCfg && (
                                <div className="rounded-xl border bg-secondary/30 p-4 space-y-2">
                                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Banco</span><span className="font-semibold">{paymentCfg.bank_name || '—'}</span></div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Cuenta</span>
                                        <div className="flex items-center gap-2"><span className="font-mono">{paymentCfg.bank_account || '—'}</span>
                                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyText(paymentCfg.bank_account || '', 'acc')}><Copy className="h-3.5 w-3.5" /></Button></div>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">CCI</span>
                                        <div className="flex items-center gap-2"><span className="font-mono">{paymentCfg.bank_cci || '—'}</span>
                                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyText(paymentCfg.bank_cci || '', 'cci')}><Copy className="h-3.5 w-3.5" /></Button></div>
                                    </div>
                                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Titular</span><span>{paymentCfg.bank_holder || '—'}</span></div>
                                    {paymentCfg.transfer_instructions && <div className="text-xs text-muted-foreground pt-2">{paymentCfg.transfer_instructions}</div>}
                                </div>
                            )}
                            {method === 'efectivo' && (
                                <div className="rounded-xl border bg-secondary/30 p-4 text-sm">Paga {fmtMoney(total)} en efectivo al recibir tu pedido. Te recomendamos llevar monto exacto.</div>
                            )}
                            {method === 'tarjeta' && (
                                <div className="rounded-xl border bg-secondary/30 p-4 text-sm">Aceptamos tarjeta al momento de entrega/recojo. Cobro: {fmtMoney(total)}.</div>
                            )}
                        </div>
                    </CardContent></Card>
                </div>

                {/* Summary */}
                <div className="lg:col-span-1">
                    <Card className="lg:sticky lg:top-[80px]">
                        <CardContent className="p-5">
                            <h2 className="font-display text-lg font-semibold mb-3">Resumen</h2>
                            <div className="divide-y">
                                {items.map((it) => (
                                    <div key={it.product_id} className="py-2 flex justify-between text-sm gap-2">
                                        <div className="flex-1"><div className="font-medium truncate">{it.name}</div>
                                            <div className="text-xs text-muted-foreground tabular-nums">{it.quantity} x {fmtMoney(it.price)}</div>
                                            {it.notes && <div className="text-[11px] italic text-muted-foreground mt-0.5">“{it.notes}”</div>}
                                        </div>
                                        <div className="tabular-nums font-semibold">{fmtMoney(it.price * it.quantity)}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="border-t mt-2 pt-3 space-y-1 text-sm">
                                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{fmtMoney(subtotal)}</span></div>
                                {deliveryFee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Envío</span><span className="tabular-nums">{fmtMoney(deliveryFee)}</span></div>}
                                <div className="flex justify-between font-display text-xl font-bold pt-2 border-t mt-2"><span>Total</span><span className="tabular-nums" data-testid="checkout-total">{fmtMoney(total)}</span></div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <div className="fixed bottom-0 inset-x-0 z-40 p-3 pb-[max(12px,env(safe-area-inset-bottom))] bg-background/95 backdrop-blur border-t border-border">
                <div className="max-w-5xl mx-auto">
                    <Button onClick={submit} disabled={submitting || enabledMethods.length === 0 || (orderType === 'recojo' && (pickupBranchesLoading || pickupBranchesError || !pickupBranches.some((branch) => branch.id === pickupBranchId)))} className="w-full h-12" data-testid="checkout-confirmar-button">
                        {submitting ? 'Procesando…' : `Confirmar pedido · ${fmtMoney(total)}`}
                    </Button>
                </div>
            </div>
        </div>
    );
}
