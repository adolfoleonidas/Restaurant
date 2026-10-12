import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useCart } from '@/contexts/CartContext';
import { useLiveOrder } from '@/contexts/LiveOrderContext';
import { useTableContext } from '@/contexts/TableContext';
import {
    createPublicOrder,
    getPublicOrder,
    getPublicPaymentConfig,
    getPublicRestaurant,
    getPublicTables,
    listDeliveryBranches,
    listPickupBranches,
    resolvePublicTable,
    uploadPublicOrderProof,
} from '@/lib/api/public';
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
import {
    Truck, ShoppingBag, Utensils, Copy, CheckCircle2, ChevronLeft, Smartphone, Banknote,
    CreditCard as CreditCardIcon, Building2, Upload, Image as ImageIcon, AlertCircle, Clock,
} from 'lucide-react';
import { apiErrorMessage } from '@/lib/apiError';

const ORDER_TYPE_INFO = {
    local: { label: 'Comer en local', icon: Utensils, desc: 'Te esperamos en nuestra mesa' },
    recojo: { label: 'Recojo en tienda', icon: ShoppingBag, desc: 'Recoge tu pedido en tienda' },
    delivery: { label: 'Delivery', icon: Truck, desc: 'A domicilio (con costo de envío)' },
};

const METHOD_ICON = { efectivo: Banknote, yape: Smartphone, plin: Smartphone, tarjeta: CreditCardIcon, transferencia: Building2 };

// Métodos donde el cliente transfiere y manda su comprobante: el pedido espera
// que caja lo verifique.
const RECEIPT_METHODS = ['yape', 'plin', 'transferencia'];

// Estados del dinero tal como los cuenta el backend.
const PAYMENT_STATE_INFO = {
    pendiente: { label: 'Pendiente de pago', tone: 'amber', hint: 'Todavía no registramos tu pago.' },
    reportado: { label: 'Comprobante en revisión', tone: 'amber', hint: 'El restaurante está verificando tu pago.' },
    confirmado: { label: 'Pago confirmado', tone: 'green', hint: 'Tu pedido ya está en cocina.' },
    rechazado: { label: 'Pago rechazado', tone: 'red', hint: 'No pudimos verificar el pago. Probá con otro método o consultá al personal.' },
    expirado: { label: 'Pago vencido', tone: 'red', hint: 'El tiempo para pagar terminó. Empezá un pedido nuevo.' },
    reembolsado: { label: 'Pago reembolsado', tone: 'gray', hint: 'El dinero fue devuelto.' },
    no_requerido: { label: 'Se paga al final', tone: 'gray', hint: 'Podés pagar cuando termines.' },
};

const TONE_CLASSES = {
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    green: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
    red: 'border-destructive/40 bg-destructive/10 text-destructive',
    gray: 'border-border bg-secondary/40 text-muted-foreground',
};

function PaymentStateBanner({ state, orderNumber, className = '' }) {
    const info = PAYMENT_STATE_INFO[state] || PAYMENT_STATE_INFO.pendiente;
    return (
        <div className={`rounded-xl border p-4 ${TONE_CLASSES[info.tone]} ${className}`} data-testid="checkout-payment-state" data-payment-state={state}>
            <div className="flex items-center gap-2 font-semibold">
                {state === 'confirmado' ? <CheckCircle2 className="h-4 w-4" /> : state === 'rechazado' || state === 'expirado' ? <AlertCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                <span>{info.label}</span>
                {orderNumber ? <span className="font-normal opacity-80">· Pedido #{orderNumber}</span> : null}
            </div>
            <p className="mt-1 text-sm opacity-90">{info.hint}</p>
        </div>
    );
}

export default function Checkout() {
    const { items, subtotal, clear } = useCart();
    const { setMeta, isActive } = useLiveOrder();
    const { table: contextTable, policy: contextPolicy, refresh: refreshTable } = useTableContext();
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
    const [deliveryBranches, setDeliveryBranches] = useState([]);
    const [deliveryBranchId, setDeliveryBranchId] = useState('');
    const [deliveryBranchesLoading, setDeliveryBranchesLoading] = useState(false);
    const [deliveryBranchesError, setDeliveryBranchesError] = useState(false);
    const [customer, setCustomer] = useState({ name: '', phone: '', address: '', email: '' });
    const [notes, setNotes] = useState('');
    const [method, setMethod] = useState('yape');
    const [submitting, setSubmitting] = useState(false);
    const [confirmed, setConfirmed] = useState(null); // { tracking_code, order_number, total, payment_method }
    const [reviewing, setReviewing] = useState(false); // revisión antes de cobrar
    const [copied, setCopied] = useState(null);
    const [proofFile, setProofFile] = useState(null); // data URL
    const [uploading, setUploading] = useState(false);
    const [uploadPct, setUploadPct] = useState(0);
    const [proofSent, setProofSent] = useState(false);
    const [livePaymentState, setLivePaymentState] = useState(null);
    const pollRef = useRef(null);

    useEffect(() => {
        getPublicRestaurant().then((r) => setRestaurant(r.data));
        getPublicPaymentConfig().then((r) => {
            setPaymentCfg(r.data);
            const enabled = ['yape', 'plin', 'efectivo', 'transferencia', 'tarjeta'].find((m) => r.data[`enable_${m}`]);
            if (enabled) setMethod(enabled);
        });
    }, []);

    // Mesa del QR: se resuelve la capacidad firmada y queda preseleccionada.
    useEffect(() => {
        if (tableToken) {
            resolvePublicTable(tableToken)
                .then((r) => setTableInfo(r.data))
                .catch(() => setTableInfo(null));
            return;
        }
        if (contextTable) {
            setTableInfo(contextTable);
            return;
        }
        if (restaurant?.require_table_qr) return;
        getPublicTables().then((r) => setTables(r.data || [])).catch(() => setTables([]));
    }, [tableToken, restaurant, contextTable]);

    useEffect(() => {
        let active = true;
        if (orderType !== 'recojo') {
            setPickupBranchId('');
            setPickupBranchesError(false);
            return () => { active = false; };
        }
        setPickupBranchesLoading(true);
        setPickupBranchesError(false);
        listPickupBranches().then((r) => {
            if (active) setPickupBranches(r.data || []);
        }).catch(() => {
            if (active) { setPickupBranches([]); setPickupBranchesError(true); }
        }).finally(() => { if (active) setPickupBranchesLoading(false); });
        return () => { active = false; };
    }, [orderType]);

    useEffect(() => {
        let active = true;
        if (orderType !== 'delivery') {
            setDeliveryBranchId('');
            setDeliveryBranchesError(false);
            return () => { active = false; };
        }
        setDeliveryBranchesLoading(true);
        setDeliveryBranchesError(false);
        listDeliveryBranches().then((r) => {
            if (active) setDeliveryBranches(r.data || []);
        }).catch(() => {
            if (active) { setDeliveryBranches([]); setDeliveryBranchesError(true); }
        }).finally(() => { if (active) setDeliveryBranchesLoading(false); });
        return () => { active = false; };
    }, [orderType]);

    useEffect(() => {
        if (confirmed) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, [confirmed]);

    // Mientras el pedido espera pago, el cliente ve el estado real: caja puede
    // confirmarlo en cualquier momento desde otra pantalla.
    useEffect(() => {
        if (!confirmed?.tracking_code) return undefined;
        const settled = livePaymentState === 'confirmado' || livePaymentState === 'rechazado' || livePaymentState === 'expirado';
        if (!confirmed.prepay_required || settled) return undefined;
        pollRef.current = setInterval(() => {
            getPublicOrder(confirmed.tracking_code)
                .then((r) => {
                    setLivePaymentState(r.data?.payment_state || null);
                    if (r.data?.payment_state === 'confirmado') {
                        setConfirmed((cur) => (cur ? { ...cur, sent_to_kitchen: true, payment_state: 'confirmado', status: r.data.status } : cur));
                    }
                })
                .catch(() => { /* el sondeo se reintenta solo */ });
        }, 5000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [confirmed?.tracking_code, confirmed?.prepay_required, livePaymentState]);

    const deliveryFee = orderType === 'delivery' ? (restaurant?.delivery_fee || 0) : 0;
    const total = subtotal + deliveryFee;

    const enabledMethods = paymentCfg ? ['efectivo', 'yape', 'plin', 'transferencia', 'tarjeta'].filter((m) => paymentCfg[`enable_${m}`]) : [];

    const prepayPolicy = useMemo(() => {
        const fromRestaurant = restaurant?.prepay;
        if (!fromRestaurant) return { prepay_required: false, prepay_mode: 'never' };
        if (orderType === 'recojo') return { ...fromRestaurant, prepay_required: Boolean(fromRestaurant.prepay_pickup) };
        if (orderType === 'delivery') return { ...fromRestaurant, prepay_required: Boolean(fromRestaurant.prepay_delivery) };
        return fromRestaurant;
    }, [restaurant, orderType]);

    const needsCounterVerification = prepayPolicy.prepay_required && RECEIPT_METHODS.includes(method);
    const payAtCounter = prepayPolicy.prepay_required && !needsCounterVerification;
    const requiresPaymentBeforeKitchen = needsCounterVerification;

    if (items.length === 0 && !confirmed) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-16 text-center">
                <ShoppingBag className="h-12 w-12 mx-auto opacity-40 mb-4" />
                <h1 className="font-display text-2xl font-semibold mb-2">Tu carrito está vacío</h1>
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
        setUploadPct(0);
        try {
            // El comprobante es una imagen en base64: en datos móviles el envío
            // tarda y sin progreso el cliente reintentaba creyendo que colgó.
            await uploadPublicOrderProof(confirmed.tracking_code, { payment_proof: proofFile }, {
                onUploadProgress: (event) => {
                    if (event.total) setUploadPct(Math.round((event.loaded / event.total) * 100));
                },
            });
            setProofSent(true);
            setLivePaymentState('reportado');
            toast.success('Comprobante enviado al restaurante');
        } catch (e) { toast.error(apiErrorMessage(e, 'No se pudo subir')); }
        finally { setUploading(false); setUploadPct(0); }
    };

    const validate = () => {
        if (orderType !== 'local' && (!customer.name.trim() || !customer.phone.trim())) {
            toast.error('Completa tu nombre y celular'); return false;
        }
        if (orderType === 'delivery' && !customer.address.trim()) {
            toast.error('Indica la dirección para delivery'); return false;
        }
        if (orderType === 'recojo' && !pickupBranches.some((branch) => branch.id === pickupBranchId)) {
            toast.error('Selecciona una sucursal habilitada para recojo'); return false;
        }
        if (orderType === 'delivery' && !deliveryBranches.some((branch) => branch.id === deliveryBranchId)) {
            toast.error('Selecciona una sucursal para delivery'); return false;
        }
        if (orderType === 'local' && tableToken && !tableInfo) {
            toast.error('Escaneá el QR de tu mesa'); return false;
        }
        if (orderType === 'local' && !tableToken && !contextTable && !tableId) {
            toast.error(restaurant?.require_table_qr ? 'Escaneá el QR de tu mesa' : 'Elegí tu mesa'); return false;
        }
        return true;
    };

    const submit = async () => {
        if (!validate()) return;
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
                table_id: orderType === 'local' && !tableToken ? (contextTable?.id || tableId) : null,
                ...(orderType === 'recojo' ? { branch_id: pickupBranchId } : {}),
                ...(orderType === 'delivery' ? { branch_id: deliveryBranchId } : {}),
            };
            await submitPublicOrder({
                storage: window.sessionStorage,
                cryptoSource: window.crypto,
                fingerprint: JSON.stringify(payload),
                payload,
                post: (requestPayload) => createPublicOrder(requestPayload),
                onConfirmed: (data) => {
                    const next = {
                        ...data,
                        order_type: orderType,
                        branchName: (orderType === 'recojo' ? pickupBranches : deliveryBranches)
                            .find((branch) => branch.id === (orderType === 'recojo' ? pickupBranchId : deliveryBranchId))?.name || null,
                    };
                    setConfirmed(next);
                    // El estado en vivo solo manda si el servidor lo informó; si
                    // no, se usa el de la respuesta para no mostrarlo pendiente
                    // cuando el pedido ya fue a cocina.
                    setLivePaymentState(data.payment_state || null);
                    // Lo primero es vaciar el carrito: el pedido ya existe. Si algo
                    // de lo que sigue falla, el cliente no puede reenviar lo mismo
                    // por accidente. Cada intento posterior arranca de cero.
                    clear();
                    setProofFile(null);
                    setProofSent(false);
                    setNotes('');
                    // Lo demás es accesorio y nunca debe impedir el reinicio.
                    try {
                        if (!isActive) {
                            setMeta({
                                tracking_code: data.tracking_code,
                                order_number: data.order_number,
                                table_id: orderType === 'local' ? (tableInfo?.id || contextTable?.id) : null,
                            });
                        }
                    } catch { /* el seguimiento también queda en pantalla */ }
                    try {
                        if (orderType === 'local' && data.table_id) refreshTable();
                    } catch { /* el grupo de la mesa se refresca al volver */ }
                    if (data.sent_to_kitchen) toast.success(`Pedido #${data.order_number} en cocina`);
                    else toast.success(`Pedido #${data.order_number} guardado: falta el pago`);
                },
            });
        } catch (e) { toast.error(apiErrorMessage(e, 'No se pudo crear el pedido')); }
        finally { setSubmitting(false); }
    };

    if (confirmed) {
        const paymentState = livePaymentState || confirmed.payment_state || (confirmed.prepay_required ? 'pendiente' : 'no_requerido');
        // Un pedido que se cobra en caja ya está en cocina: solo espera pago el
        // que el restaurante quiso cobrar antes de preparar.
        const waiting = confirmed.prepay_required && !confirmed.pay_at_counter
            && paymentState !== 'confirmado' && paymentState !== 'rechazado' && paymentState !== 'expirado';
        const showProofBox = RECEIPT_METHODS.includes(confirmed.payment_method) && !confirmed.pay_at_counter;
        const wentToKitchen = !waiting && confirmed.sent_to_kitchen !== false;
        // "Pago confirmado" solo si alguien pagó; un pedido que va a cocina y se
        // cobra al final no ha pagado nada todavía.
        const isPaid = paymentState === 'confirmado'
            || ['pagado', 'confirmado'].includes(confirmed.payment_status);
        return (
            <div className="max-w-2xl mx-auto px-4 py-10 space-y-5" data-testid="checkout-confirmed-root">
                <Card>
                    <CardContent className="p-6 text-center">
                        <div className={`h-16 w-16 rounded-sm mx-auto flex items-center justify-center mb-3 ${wentToKitchen ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                            {wentToKitchen ? <CheckCircle2 className="h-9 w-9" /> : <Clock className="h-9 w-9" />}
                        </div>
                        <h1 className="font-display text-3xl font-bold" data-testid="checkout-result-title">
                            {isPaid ? 'Pago confirmado ✓' : wentToKitchen ? 'Pedido enviado a cocina' : waiting ? 'Pendiente de pago' : 'Pedido guardado'}
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            {wentToKitchen
                                ? `Pedido #${confirmed.order_number} enviado a cocina.`
                                : waiting
                                    ? 'Tu pedido queda guardado. Cuando el restaurante confirme el pago, pasa a cocina.'
                                    : 'Seguí el estado con tu código.'}
                        </p>
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

                <PaymentStateBanner state={paymentState} orderNumber={confirmed.order_number} />

                {payAtCounter && (
                    <Card><CardContent className="p-5 space-y-1">
                        <h2 className="font-display text-lg font-semibold">Se cobra en caja</h2>
                        <p className="text-sm text-muted-foreground">
                            Tu pedido ya está en cocina. Acercate a caja para pagar {fmtMoney(confirmed.total)} cuando quieras.
                        </p>
                    </CardContent></Card>
                )}

                {waiting && showProofBox && (
                    <Card><CardContent className="p-5 space-y-3">
                        <h2 className="font-display text-lg font-semibold">
                            {proofSent ? 'Comprobante enviado' : 'Sube tu comprobante'}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {proofSent
                                ? 'El restaurante está verificando tu pago. Esta pantalla se actualiza sola cuando lo confirme.'
                                : 'Transferí el monto y adjuntá la captura. El restaurante verifica el pago antes de preparar tu pedido.'}
                        </p>
                        {proofFile ? (
                            <div className="flex items-center gap-3 border rounded-xl p-2">
                                <img src={proofFile} alt="comprobante" className="h-20 w-20 object-cover rounded-lg" />
                                <div className="flex-1">
                                    <div className="text-sm font-medium">Captura cargada</div>
                                    <div className="flex gap-2 mt-2">
                                        <Button size="sm" onClick={uploadProof} disabled={uploading} data-testid="checkout-upload-proof"><Upload className="h-4 w-4 mr-1" />{uploading && uploadPct > 0 ? `Enviando ${uploadPct}%` : 'Enviar al restaurante'}</Button>
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

    // ---- Paso de revisión: el cliente ve exactamente qué está pagando ----
    if (reviewing) {
        const tableLabel = tableInfo?.number || contextTable?.number || tables.find((t) => t.id === tableId)?.number;
        return (
            <div className="max-w-2xl mx-auto px-4 py-8 pb-32 space-y-5" data-testid="checkout-review-root">
                <Button variant="ghost" size="sm" onClick={() => setReviewing(false)} data-testid="checkout-review-back">
                    <ChevronLeft className="h-4 w-4 mr-1" /> Volver a editar
                </Button>
                <div>
                    <p className="page-kicker mb-2">Revisa tu pedido</p>
                    <h1 className="font-display text-3xl font-bold">
                        {orderType === 'local' && tableLabel ? `Mesa ${tableLabel}` : ORDER_TYPE_INFO[orderType].label}
                    </h1>
                </div>

                <Card><CardContent className="p-5">
                    <div className="divide-y">
                        {items.map((it) => (
                            <div key={it.product_id} className="py-3 flex justify-between gap-3 text-sm">
                                <div className="flex-1">
                                    <div className="font-medium">{it.quantity} × {it.name}</div>
                                    {it.notes && <div className="text-xs italic text-muted-foreground mt-0.5" data-testid="checkout-review-note">Observación: {it.notes}</div>}
                                </div>
                                <div className="tabular-nums font-semibold">{fmtMoney(it.price * it.quantity)}</div>
                            </div>
                        ))}
                    </div>
                    {notes.trim() && (
                        <p className="mt-3 rounded-lg bg-secondary/40 p-3 text-sm" data-testid="checkout-review-order-note">
                            <span className="font-medium">Observaciones del pedido: </span>{notes.trim()}
                        </p>
                    )}
                    <div className="border-t mt-3 pt-3 space-y-1 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{fmtMoney(subtotal)}</span></div>
                        {deliveryFee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Envío</span><span className="tabular-nums">{fmtMoney(deliveryFee)}</span></div>}
                        <div className="flex justify-between font-display text-xl font-bold pt-2 border-t mt-2"><span>Total</span><span className="tabular-nums" data-testid="checkout-review-total">{fmtMoney(total)}</span></div>
                    </div>
                    <dl className="mt-4 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                        <div className="flex gap-2"><dt className="text-muted-foreground">Modalidad:</dt><dd className="font-medium">{ORDER_TYPE_INFO[orderType].label}</dd></div>
                        {orderType === 'local' && <div className="flex gap-2"><dt className="text-muted-foreground">Mesa:</dt><dd className="font-medium">{tableLabel ? `Mesa ${tableLabel}` : 'Sin definir'}</dd></div>}
                        <div className="flex gap-2"><dt className="text-muted-foreground">Pago:</dt><dd className="font-medium">{PAYMENT_LABELS[method]}</dd></div>
                    </dl>
                </CardContent></Card>

                {needsCounterVerification && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100" data-testid="checkout-prepay-warning">
                        <div className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" /> Se paga antes de preparar</div>
                        <p className="mt-1">
                            Este restaurante exige el pago antes de enviar a cocina. Al continuar vas a ver los datos para
                            transferir {fmtMoney(total)} y subir tu comprobante. Tu pedido entra a cocina cuando el restaurante confirme el pago.
                        </p>
                    </div>
                )}
                {payAtCounter && (
                    <div className="rounded-xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground" data-testid="checkout-pay-counter-warning">
                        <div className="flex items-center gap-2 font-semibold text-foreground"><Banknote className="h-4 w-4" /> Se cobra al entregar</div>
                        <p className="mt-1">Tu pedido va a cocina ahora y pagás {fmtMoney(total)} en caja.</p>
                    </div>
                )}

                <div className="fixed bottom-0 inset-x-0 z-40 p-3 pb-[max(12px,env(safe-area-inset-bottom))] bg-background/95 backdrop-blur border-t border-border">
                    <div className="max-w-2xl mx-auto">
                        <Button
                            onClick={submit}
                            disabled={submitting || !enabledMethods.includes(method)}
                            className="w-full h-12"
                            data-testid="checkout-pay-button"
                        >
                            {submitting
                                ? 'Procesando…'
                                : needsCounterVerification
                                    ? `Pagar ${fmtMoney(total)}`
                                    : `Confirmar pedido · ${fmtMoney(total)}`}
                        </Button>
                    </div>
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
            <h1 className="font-display text-4xl font-bold mb-6">Confirmar pedido</h1>

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
                                <div className="space-y-3">
                                    <p className="text-sm">
                                        Mesa <span className="font-display text-xl font-semibold" data-testid="checkout-mesa-preseleccionada">{tableInfo.number}</span>
                                        {tableInfo.area ? ` · ${tableInfo.area}` : ''}
                                        <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">Del QR</span>
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Si te moviste a otra mesa, elegila abajo. Las mesas ocupadas o reservadas no se pueden elegir.
                                    </p>
                                    {tables.length > 0 && (
                                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                            {tables.map((t) => <TableButton key={t.id} t={t} selected={false} onSelect={() => toast.info('Pedile al mozo que mueva tu cuenta a esa mesa')} />)}
                                        </div>
                                    )}
                                </div>
                            ) : restaurant?.require_table_qr ? (
                                <p className="text-sm text-muted-foreground">Escaneá el QR de tu mesa para pedir en el local.</p>
                            ) : contextTable ? (
                                <p className="text-sm">Mesa <span className="font-display text-xl font-semibold">{contextTable.number}</span></p>
                            ) : tables.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No hay mesas disponibles ahora. Pedí recojo o avisá al mozo.</p>
                            ) : (
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                    {tables.map((t) => <TableButton key={t.id} t={t} selected={tableId === t.id} onSelect={() => setTableId(t.id)} />)}
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

                    {orderType === 'delivery' && (
                        <Card><CardContent className="p-5 space-y-2">
                            <Label htmlFor="checkout-delivery-branch">Sucursal de entrega *</Label>
                            {deliveryBranchesLoading ? <p className="text-sm text-muted-foreground">Cargando sucursales…</p> : deliveryBranchesError ? <p role="alert" className="text-sm text-destructive">No se pudieron cargar las sucursales. Intenta nuevamente.</p> : deliveryBranches.length === 0 ? <p className="text-sm text-muted-foreground">No hay sucursales disponibles para delivery</p> : (
                                <select id="checkout-delivery-branch" className="h-11 w-full rounded-md border bg-background px-3" value={deliveryBranchId} onChange={(e) => setDeliveryBranchId(e.target.value)} data-testid="checkout-delivery-branch">
                                    <option value="">Selecciona una sucursal</option>
                                    {deliveryBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
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
                            <div><Label>Nombre y apellidos{orderType === 'local' ? '' : ' *'}</Label><Input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} autoComplete="name" className="h-11" data-testid="checkout-nombre" /></div>
                            <div><Label>Celular{orderType === 'local' ? '' : ' *'}</Label><Input type="tel" inputMode="tel" autoComplete="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} className="h-11" placeholder="+51 999 888 777" data-testid="checkout-celular" /></div>
                            <div className="sm:col-span-2"><Label>Correo (opcional)</Label><Input type="email" autoComplete="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} className="h-11" /></div>
                            {orderType === 'delivery' && (
                                <div className="sm:col-span-2"><Label>Dirección de entrega *</Label><Textarea value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} autoComplete="street-address" placeholder="Calle, número, referencia" data-testid="checkout-direccion" /></div>
                            )}
                            <div className="sm:col-span-2"><Label>Observaciones del pedido (opcional)</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: sin picante, cubiertos extra…" /></div>
                        </div>
                    </CardContent></Card>

                    {/* Payment method */}
                    <Card><CardContent className="p-5">
                        <h2 className="font-display text-lg font-semibold mb-3">Método de pago</h2>
                        <Tabs value={method} onValueChange={setMethod}>
                            <TabsList className="grid grid-cols-2 gap-1 h-auto sm:grid-cols-none sm:flex sm:flex-wrap">
                                {enabledMethods.map((m) => {
                                    const Icon = METHOD_ICON[m];
                                    return <TabsTrigger key={m} value={m} data-testid={`checkout-method-${m}`}><Icon className="h-4 w-4 mr-1" />{PAYMENT_LABELS[m]}</TabsTrigger>;
                                })}
                            </TabsList>
                        </Tabs>

                        <div className="mt-4">
                            {(method === 'yape' || method === 'plin') && paymentCfg && (
                                <div className="rounded-xl border bg-secondary/30 p-4" data-testid={`checkout-wallet-${method}`}>
                                    <div className={`grid grid-cols-1 gap-4 items-center ${paymentCfg[`${method}_qr`] ? 'md:grid-cols-2' : ''}`}>
                                        {/* Sin imagen de QR no se deja un recuadro vacío: el
                                            cliente paga con el número, que es como funciona
                                            Yape/Plin cuando el local no subió su código. */}
                                        {paymentCfg[`${method}_qr`] ? (
                                            <div className="flex items-center justify-center">
                                                <div className="h-56 w-56 shrink-0 rounded-xl border bg-white p-2 flex items-center justify-center">
                                                    <img src={paymentCfg[`${method}_qr`]} alt={`QR ${method}`} width={224} height={224} loading="eager" decoding="async" className="max-h-full max-w-full object-contain" />
                                                </div>
                                            </div>
                                        ) : null}
                                        <div className="space-y-3">
                                            <div className="text-xs uppercase text-muted-foreground tracking-wide">{PAYMENT_LABELS[method]}</div>
                                            <div>
                                                <div className="text-xs text-muted-foreground">
                                                    {paymentCfg[`${method}_qr`] ? 'O yapea al número' : 'Yapea o plinea al número'}
                                                </div>
                                                <div className="font-display text-2xl font-bold tabular-nums break-all">{paymentCfg[`${method}_number`] || '—'}</div>
                                            </div>
                                            <div className="text-sm">Titular: <span className="text-foreground">{paymentCfg[`${method}_holder`] || '—'}</span></div>
                                            <div className="rounded-lg border bg-background p-3">
                                                <div className="text-xs uppercase tracking-wide text-muted-foreground">Monto a pagar</div>
                                                <div className="font-display text-2xl font-bold tabular-nums" data-testid={`checkout-wallet-total-${method}`}>{fmtMoney(total)}</div>
                                            </div>
                                            <Button variant="outline" size="sm" className="h-11" onClick={() => copyText(paymentCfg[`${method}_number`] || '', method)} data-testid={`checkout-copy-${method}`}><Copy className="h-3.5 w-3.5 mr-1" /> {copied === method ? 'Copiado' : 'Copiar número'}</Button>
                                            <p className="text-xs text-muted-foreground">
                                                {needsCounterVerification
                                                    ? 'Hacé la transferencia y al confirmar el pedido vas a poder subir tu comprobante. Cocina arranca cuando el restaurante lo verifique.'
                                                    : 'Hacé la transferencia y al confirmar el pedido vas a poder subir tu comprobante.'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {method === 'transferencia' && paymentCfg && (
                                <div className="rounded-xl border bg-secondary/30 p-4 space-y-2">
                                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Banco</span><span className="font-semibold">{paymentCfg.bank_name || '—'}</span></div>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Cuenta</span>
                                        <div className="flex items-center gap-2 min-w-0 max-w-full">
                                            <span className="font-mono text-xs break-all">{paymentCfg.bank_account || '—'}</span>
                                            <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0" aria-label="Copiar número de cuenta" onClick={() => copyText(paymentCfg.bank_account || '', 'acc')}><Copy className="h-4 w-4" /></Button></div>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="text-muted-foreground">CCI</span>
                                        <div className="flex items-center gap-2 min-w-0 max-w-full">
                                            <span className="font-mono text-xs break-all">{paymentCfg.bank_cci || '—'}</span>
                                            <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0" aria-label="Copiar CCI" onClick={() => copyText(paymentCfg.bank_cci || '', 'cci')}><Copy className="h-4 w-4" /></Button></div>
                                    </div>
                                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Titular</span><span>{paymentCfg.bank_holder || '—'}</span></div>
                                    {paymentCfg.transfer_instructions && <div className="text-xs text-muted-foreground pt-2">{paymentCfg.transfer_instructions}</div>}
                                </div>
                            )}
                            {method === 'efectivo' && (
                                <div className="rounded-xl border bg-secondary/30 p-4 text-sm">
                                    {payAtCounter
                                        ? `Tu pedido va a cocina ahora y pagás ${fmtMoney(total)} en caja.`
                                        : `Paga ${fmtMoney(total)} en efectivo al recibir tu pedido. Te recomendamos llevar monto exacto.`}
                                </div>
                            )}
                            {method === 'tarjeta' && (
                                <div className="rounded-xl border bg-secondary/30 p-4 text-sm">
                                    {payAtCounter
                                        ? `Tu pedido va a cocina ahora y pagás ${fmtMoney(total)} con tarjeta en caja.`
                                        : `Aceptamos tarjeta al momento de entrega/recojo. Cobro: ${fmtMoney(total)}.`}
                                </div>
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
                                            {it.notes && <div className="text-xs italic text-muted-foreground mt-0.5">“{it.notes}”</div>}
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
                    <Button
                        onClick={() => { if (validate()) setReviewing(true); }}
                        disabled={submitting || enabledMethods.length === 0 || (orderType === 'recojo' && (pickupBranchesLoading || pickupBranchesError || !pickupBranches.some((branch) => branch.id === pickupBranchId))) || (orderType === 'delivery' && (deliveryBranchesLoading || deliveryBranchesError || !deliveryBranches.some((branch) => branch.id === deliveryBranchId)))}
                        className="w-full h-12"
                        data-testid="checkout-confirmar-button"
                    >
                        Revisar pedido · {fmtMoney(total)}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function TableButton({ t, selected, onSelect }) {
    const active = t.active_order;
    const billPending = active?.status === 'pendiente_pago';
    const blocked = billPending || t.status !== 'disponible';
    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={blocked}
            data-testid={`checkout-mesa-${t.number}`}
            className={`rounded-sm border p-3 text-left disabled:opacity-50 disabled:cursor-not-allowed ${selected ? 'border-primary ring-2 ring-primary/30 bg-primary/10' : 'hover:bg-secondary/40'}`}
        >
            <div className="font-display text-xl font-semibold">{t.number}</div>
            <div className="text-xs text-muted-foreground">{t.area}</div>
            {billPending && <div className="mt-1 text-xs font-medium text-amber-700">Cuenta solicitada</div>}
            {blocked && !billPending && <div className="mt-1 text-xs font-medium text-red-700">Ocupado</div>}
        </button>
    );
}
