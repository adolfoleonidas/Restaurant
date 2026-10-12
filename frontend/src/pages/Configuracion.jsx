import React, { useEffect, useState } from 'react';
import { getRestaurant, getSystemInfo, resetCatalog as resetCatalogRequest, resetData, updateRestaurant } from '@/lib/api/restaurant';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, Save, Trash2, Palette, Database, Image as ImageIcon, Sparkles, Copy, Globe } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useTheme } from '@/contexts/ThemeContext';
import { FEATURE_DEFS, mergeFeatures, notifyFeaturesChanged } from '@/lib/features';
import { fmtDateTimeShort, countOf } from '@/lib/format';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiErrorMessage } from '@/lib/apiError';
import { ENVIRONMENT_LABELS, RECORD_LABELS } from '@/constants/glossary';

export function Temas() {
    const { theme, setTheme, clearThemeOverride, themes } = useTheme();
    const [restaurant, setRestaurant] = useState(null);
    const [saving, setSaving] = useState(false);
    
    useEffect(() => {
        getRestaurant().then((res) => setRestaurant(res.data));
    }, []);
    
    const saveTheme = async (themeId) => {
        if (!restaurant) return;
        setSaving(true);
        try {
            await updateRestaurant({ theme_id: themeId });
            setTheme(themeId);
            toast.success('Tema guardado para todo el restaurante');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Error al guardar el tema'));
        } finally {
            setSaving(false);
        }
    };
    
    const hasLocalOverride = typeof window !== 'undefined' && localStorage.getItem('restaurant-theme') !== null;
    
    return (
        <Card><CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                        <Palette className="h-5 w-5" /> Tema de la interfaz
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Personaliza los colores para todo el restaurante
                    </p>
                </div>
                {hasLocalOverride && (
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={clearThemeOverride}
                        className="text-xs"
                    >
                        Restaurar tema del restaurante
                    </Button>
                )}
            </div>
            {/* Cuatro paletas: 2×2 en tablet, una fila en escritorio. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {themes.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => saveTheme(t.id)}
                        disabled={saving}
                        className={`p-4 rounded-lg border-2 text-left transition-all ${
                            theme === t.id 
                                ? 'border-primary bg-primary/5 ring-2 ring-primary/20' 
                                : 'border-border hover:border-primary/50'
                        } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
                        data-testid={`theme-${t.id}`}
                    >
                        <div className="font-medium mb-1">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.description}</div>
                        {theme === t.id && (
                            <div className="text-xs text-primary font-medium mt-2">✓ Activo</div>
                        )}
                    </button>
                ))}
            </div>
            {hasLocalOverride && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-4">
                    ⚠ Tienes un tema local activo. Los demás usuarios ven el tema del restaurante.
                </p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
                El tema se aplica inmediatamente para todos los usuarios del restaurante.
            </p>
        </CardContent></Card>
    );
}

function Restaurante() {
    const [r, setR] = useState(null);
    useEffect(() => { getRestaurant().then((res) => setR(res.data)); }, []);
    const save = async () => {
        try { const { data } = await updateRestaurant(r); setR(data); toast.success('Configuración guardada'); }
        catch (e) { toast.error(apiErrorMessage(e, 'No se pudo guardar la configuración. Revisa tu conexión y reintenta.')); }
    };
    if (!r) return <div className="text-muted-foreground">Cargando…</div>;
    return (
        <Card><CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label htmlFor="nombre-del-restaurante">Nombre del restaurante</Label><Input id="nombre-del-restaurante" value={r.name || ''} onChange={(e) => setR({ ...r, name: e.target.value })} data-testid="config-name" /></div>
            <div><Label htmlFor="ruc">RUC</Label><Input id="ruc" value={r.ruc || ''} onChange={(e) => setR({ ...r, ruc: e.target.value })} /></div>
            <div className="md:col-span-2"><Label htmlFor="direccion">Dirección</Label><Input id="direccion" value={r.address || ''} onChange={(e) => setR({ ...r, address: e.target.value })} /></div>
            <div><Label htmlFor="telefono">Teléfono</Label><Input id="telefono" value={r.phone || ''} onChange={(e) => setR({ ...r, phone: e.target.value })} /></div>
            <div><Label htmlFor="moneda">Moneda</Label><Input id="moneda" value={r.currency || ''} onChange={(e) => setR({ ...r, currency: e.target.value })} /></div>
            <div><Label htmlFor="zona-horaria">Zona horaria</Label><Input id="zona-horaria" value={r.timezone || ''} onChange={(e) => setR({ ...r, timezone: e.target.value })} /></div>
            <div><Label htmlFor="horario">Horario</Label><Input id="horario" value={r.opening_hours || ''} onChange={(e) => setR({ ...r, opening_hours: e.target.value })} /></div>
            <div className="md:col-span-2">
                <Label htmlFor="config-prep-mode">Seguimiento de preparación</Label>
                <Select value={r.prep_mode || 'detailed'} onValueChange={(v) => setR({ ...r, prep_mode: v })}>
                    {/* El botón de Radix toma su nombre del valor elegido; si el
                        ajuste llega vacío, el disparador queda sin nombre. */}
                    <SelectTrigger id="config-prep-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="simple">Sencillo — Pendiente → Entregado</SelectItem>
                        <SelectItem value="detailed">Detallado — Enviado → Preparando → Listo → Entregado</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">No mezcla cobrado con entregado. Se aplica a cómo trabajan, no cambia los pedidos ya tomados.</p>
            </div>
            <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer min-h-11 sm:min-h-0">
                    <Switch checked={!!r.auto_release_table} onCheckedChange={(v) => setR({ ...r, auto_release_table: v })} data-testid="config-auto-release" aria-label="Liberar mesa automáticamente al cobrar" />
                    Liberar mesa automáticamente al cobrar
                </label>
                <p className="text-xs text-muted-foreground mt-1">Al pagar la cuenta completa, la mesa pasa directo a «Disponible» (reaparece en la carta web al instante). Si está apagado, queda «Cuenta pagada» hasta que el mozo la libere.</p>
            </div>
            <div className="md:col-span-2 border-t pt-4 space-y-3">
                <div>
                    <Label htmlFor="config-prepay-mode">Cobro de pedidos hechos por el cliente (QR, web)</Label>
                    <Select value={r.table_prepay_mode || 'never'} onValueChange={(v) => setR({ ...r, table_prepay_mode: v })}>
                        <SelectTrigger id="config-prepay-mode" data-testid="config-prepay-mode"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="never">Pago al finalizar — se cocina y se cobra al terminar</SelectItem>
                            <SelectItem value="always">Prepago obligatorio — nada se cocina sin pago confirmado</SelectItem>
                            <SelectItem value="by_order_type">Según el tipo — mesa prepago, mostrador al final</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                        Con prepago, un pedido por Yape, Plin o transferencia no llega a cocina hasta que Caja confirme el pago.
                        El efectivo y la tarjeta se preparan y se cobran en caja, con el aviso «cobra en caja» en el ticket.
                        El mozo que toma el pedido en la mesa siempre cobra al final.
                    </p>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer min-h-11 sm:min-h-0">
                    <Switch checked={!!r.prepay_pickup} onCheckedChange={(v) => setR({ ...r, prepay_pickup: v })} data-testid="config-prepay-pickup" aria-label="Exigir pago antes de preparar los pedidos para recojo" />
                    Exigir pago antes de preparar los pedidos para recojo
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer min-h-11 sm:min-h-0">
                    <Switch checked={!!r.prepay_delivery} onCheckedChange={(v) => setR({ ...r, prepay_delivery: v })} data-testid="config-prepay-delivery" aria-label="Exigir pago antes de preparar los pedidos de delivery" />
                    Exigir pago antes de preparar los pedidos de delivery
                </label>
            </div>
            <div className="md:col-span-2 flex justify-end"><Button onClick={save} data-testid="config-save"><Save className="h-4 w-4 mr-2" />Guardar cambios</Button></div>
        </CardContent></Card>
    );
}

function Marca() {
    const [r, setR] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => { getRestaurant().then((res) => setR(res.data)); }, []);
    const set = (patch) => setR((prev) => ({ ...prev, ...patch }));

    const onFile = (key) => (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (f.size > 1.5 * 1024 * 1024) { toast.error('Imagen muy pesada (máx ~1.5 MB)'); return; }
        const reader = new FileReader();
        reader.onload = (ev) => set({ [key]: ev.target.result });
        reader.readAsDataURL(f);
    };

    const save = async () => {
        setSaving(true);
        try {
            const { data } = await updateRestaurant({
                logo_url: r.logo_url || '',
                cover_url: r.cover_url || '',
                public_description: r.public_description || '',
                social_instagram: r.social_instagram || '',
                social_facebook: r.social_facebook || '',
                social_whatsapp: r.social_whatsapp || '',
            });
            setR(data);
            toast.success('Marca guardada');
        } catch (e) { toast.error(apiErrorMessage(e, 'Error al guardar la marca')); }
        finally { setSaving(false); }
    };

    const publicUrl = typeof window === 'undefined' ? '/' : `${window.location.origin}/`;
    const copyUrl = async () => {
        try {
            await navigator.clipboard.writeText(publicUrl);
            toast.success('Link copiado');
        } catch {
            toast.error('No se pudo copiar el link');
        }
    };

    if (!r) return <div className="text-muted-foreground">Cargando…</div>;

    return (
        <Card><CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Palette className="h-5 w-5" /> Marca</h2>
                <Button onClick={save} disabled={saving} data-testid="marca-save">
                    <Save className="h-4 w-4 mr-2" />{saving ? 'Guardando…' : 'Guardar marca'}
                </Button>
            </div>
            <p className="text-sm text-muted-foreground">Logo, portada, descripción y redes: es lo que ve tu cliente en la carta web.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border p-4 space-y-3">
                    <div className="text-sm font-medium">Logo</div>
                    <div className="flex items-center gap-3">
                        <div className="h-16 w-16 rounded-lg border border-border bg-secondary/40 flex items-center justify-center overflow-hidden shrink-0" data-testid="marca-logo-preview">
                            {r.logo_url
                                ? <img src={r.logo_url} alt="Logo" className="h-full w-full object-contain" />
                                : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="inline-flex min-h-touch items-center rounded-md border px-3 text-sm underline cursor-pointer">
                                <input type="file" accept="image/*" className="hidden" onChange={onFile('logo_url')} data-testid="marca-logo-input" />
                                Subir logo
                            </label>
                            {r.logo_url && (
                                <button type="button" className="inline-flex min-h-touch items-center text-xs text-destructive text-left" onClick={() => set({ logo_url: '' })} data-testid="marca-logo-clear">Quitar</button>
                            )}
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">PNG o JPG hasta ~1.5 MB. Se muestra en el panel y en la carta.</p>
                </div>

                <div className="rounded-xl border border-border p-4 space-y-3">
                    <div className="text-sm font-medium">Portada</div>
                    <div className="h-20 w-full rounded-lg border border-border bg-secondary/40 overflow-hidden flex items-center justify-center" data-testid="marca-cover-preview">
                        {r.cover_url
                            ? <img src={r.cover_url} alt="Portada" className="h-full w-full object-cover" />
                            : <span className="text-xs text-muted-foreground">Sin portada</span>}
                    </div>
                    <div className="flex items-center gap-3">
                        <label className="inline-flex min-h-touch items-center rounded-md border px-3 text-sm underline cursor-pointer">
                            <input type="file" accept="image/*" className="hidden" onChange={onFile('cover_url')} data-testid="marca-cover-input" />
                            Subir portada
                        </label>
                        {r.cover_url && (
                            <button type="button" className="inline-flex min-h-touch items-center text-xs text-destructive" onClick={() => set({ cover_url: '' })} data-testid="marca-cover-clear">Quitar</button>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">Imagen ancha (ej. 1600×600) que encabeza la carta web.</p>
                </div>
            </div>

            <div>
                <Label htmlFor="marca-descripcion">Descripción pública</Label>
                <Textarea
                    id="marca-descripcion"
                    value={r.public_description || ''}
                    onChange={(e) => set({ public_description: e.target.value })}
                    placeholder="Cocina peruana de autor con productos frescos…"
                    className="mt-1"
                    data-testid="marca-description"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><Label htmlFor="instagram">Instagram</Label><Input id="instagram" value={r.social_instagram || ''} onChange={(e) => set({ social_instagram: e.target.value })} placeholder="@turestaurante" className="mt-1" data-testid="marca-instagram" /></div>
                <div><Label htmlFor="facebook">Facebook</Label><Input id="facebook" value={r.social_facebook || ''} onChange={(e) => set({ social_facebook: e.target.value })} placeholder="https://facebook.com/…" className="mt-1" data-testid="marca-facebook" /></div>
                <div><Label htmlFor="whatsapp">WhatsApp</Label><Input id="whatsapp" value={r.social_whatsapp || ''} onChange={(e) => set({ social_whatsapp: e.target.value })} placeholder="+51 999 888 777" className="mt-1" data-testid="marca-whatsapp" /></div>
            </div>

            <div className="rounded-xl border border-border p-3 space-y-2">
                <div className="page-kicker">Página web pública</div>
                <p className="text-xs text-muted-foreground">
                    Es el link que compartes con tus clientes para ver la carta, pedir delivery o pasar a recoger.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                    <code className="flex-1 min-w-[14rem] truncate rounded-md bg-secondary px-3 py-2 text-xs" data-testid="marca-web-url">{publicUrl}</code>
                    <Button type="button" variant="outline" size="sm" onClick={copyUrl} data-testid="marca-web-copiar">
                        <Copy className="h-4 w-4 mr-1.5" /> Copiar
                    </Button>
                    <a href="/" target="_blank" rel="noreferrer" data-testid="marca-web-abrir">
                        <Button type="button" size="sm">
                            <Globe className="h-4 w-4 mr-1.5" /> Ver mi web
                        </Button>
                    </a>
                </div>
            </div>
        </CardContent></Card>
    );
}

function Funciones() {
    const [features, setFeatures] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getRestaurant().then((res) => setFeatures(mergeFeatures(res.data?.features)));
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            await updateRestaurant({ features });
            notifyFeaturesChanged();
            toast.success('Funciones guardadas');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudieron guardar las funciones'));
        } finally {
            setSaving(false);
        }
    };

    if (!features) return <div className="text-muted-foreground">Cargando…</div>;

    return (
        <Card><CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Sparkles className="h-5 w-5" /> Funciones</h2>
                <Button onClick={save} disabled={saving} data-testid="funciones-save">
                    <Save className="h-4 w-4 mr-2" />{saving ? 'Guardando…' : 'Guardar funciones'}
                </Button>
            </div>
            <p className="text-sm text-muted-foreground">
                Activa solo lo que vas a usar. Lo que está apagado no se muestra, no se ejecuta ni consume.
            </p>
            <div className="space-y-2" data-testid="funciones-lista">
                {FEATURE_DEFS.map((def) => (
                    // A <label> here made the browser forward the click to the switch
                    // on top of the switch's own click, toggling twice (once back to
                    // where it started). The row is a plain container; the switch is
                    // the only control.
                    <div key={def.key} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
                        <span className="min-w-0">
                            <span className="block text-sm font-medium">{def.label}</span>
                            <span className="block text-xs text-muted-foreground">{def.description}</span>
                        </span>
                        <Switch
                            checked={Boolean(features[def.key])}
                            onCheckedChange={(value) => setFeatures((current) => ({ ...current, [def.key]: value }))}
                            data-testid={`funcion-${def.key}`}
                            /* La fila no puede ser un <label>: el navegador
                               reenviaría el clic al switch y lo apagaría otra
                               vez. El nombre accesible se da aquí. */
                            aria-label={def.label}
                        />
                    </div>
                ))}
            </div>
        </CardContent></Card>
    );
}

function fmtUptime(seconds) {
    if (seconds == null) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function SystemItem({ label, value }) {
    return (
        <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-medium text-sm break-words">{value}</div>
        </div>
    );
}

function Datos() {
    const [open, setOpen] = useState(false);
    const [confirm, setConfirm] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [catalogOpen, setCatalogOpen] = useState(false);
    const [catalogConfirm, setCatalogConfirm] = useState('');
    const [catalogPassword, setCatalogPassword] = useState('');
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [info, setInfo] = useState(null);
    const [infoError, setInfoError] = useState(false);

    const loadInfo = async () => {
        try {
            const { data } = await getSystemInfo();
            setInfo(data);
            setInfoError(false);
        } catch {
            setInfoError(true);
        }
    };
    useEffect(() => { loadInfo(); }, []);

    const reset = async () => {
        if (confirm.trim() !== 'ELIMINAR') { toast.error('Escribe ELIMINAR para confirmar'); return; }
        if (!password) { toast.error('Ingresa tu contraseña de administrador'); return; }
        setLoading(true);
        try {
            await resetData({ confirm: confirm.trim(), password });
            toast.success('Datos operativos restablecidos');
            setOpen(false);
            setConfirm('');
            setPassword('');
            loadInfo();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo restablecer los datos'));
        } finally {
            setLoading(false);
        }
    };

    const cancel = () => {
        setOpen(false);
        setConfirm('');
        setPassword('');
    };

    const resetCatalog = async () => {
        if (catalogConfirm.trim() !== 'ELIMINAR') { toast.error('Escribe ELIMINAR para confirmar'); return; }
        if (!catalogPassword) { toast.error('Ingresa tu contraseña de administrador'); return; }
        setCatalogLoading(true);
        try {
            const { data } = await resetCatalogRequest({ confirm: catalogConfirm.trim(), password: catalogPassword });
            const cleared = data?.cleared || {};
            toast.success(`Carta vaciada: ${countOf(cleared.products ?? 0, 'plato', 'platos')} y ${countOf(cleared.categories ?? 0, 'categoría', 'categorías')}`);
            setCatalogOpen(false);
            setCatalogConfirm('');
            setCatalogPassword('');
            loadInfo();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo vaciar la carta'));
        } finally {
            setCatalogLoading(false);
        }
    };

    const cancelCatalog = () => {
        setCatalogOpen(false);
        setCatalogConfirm('');
        setCatalogPassword('');
    };

    return (
        <Card><CardContent className="p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                    <Database className="h-5 w-5 text-primary" /> Datos del sistema
                </h2>
                <Button size="sm" variant="outline" onClick={loadInfo} data-testid="system-info-refresh">Actualizar</Button>
            </div>
            {infoError ? (
                <p role="alert" className="text-sm text-destructive" data-testid="system-info-error">No se pudo cargar la información del sistema.</p>
            ) : !info ? (
                <p className="text-sm text-muted-foreground">Cargando información…</p>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4" data-testid="system-info">
                        <SystemItem label="Versión" value={info.app_version} />
                        <SystemItem label="Entorno" value={ENVIRONMENT_LABELS[info.environment] || info.environment} />
                        <SystemItem label="Base de datos" value={`${info.database?.name} · ${info.database?.connected ? 'conectada' : 'sin conexión'}`} />
                        <SystemItem label="Restaurante" value={info.restaurant?.name || '—'} />
                        <SystemItem label="Zona horaria" value={info.restaurant?.timezone || '—'} />
                        <SystemItem label="Hora del servidor (UTC)" value={fmtDateTimeShort(info.server_time)} />
                        <SystemItem label="En línea desde" value={fmtUptime(info.uptime_seconds)} />
                        <SystemItem label="Python" value={info.runtime?.python || '—'} />
                        <SystemItem label="Datos demo" value={info.demo_seed ? 'Sí' : 'No'} />
                        <SystemItem
                            label="Claves demo activas"
                            value={(info.demo_password_accounts || []).length
                                ? countOf(info.demo_password_accounts.length, 'cuenta', 'cuentas')
                                : 'Ninguna'}
                        />
                    </div>
                    {(info.demo_password_accounts || []).length > 0 && (
                        <p
                            role="alert"
                            className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                            data-testid="demo-passwords-warning"
                        >
                            Hay {countOf(info.demo_password_accounts.length, 'cuenta', 'cuentas')} con contraseña demo
                            ({info.demo_password_accounts.join(', ')}).
                            Cámbialas en <strong>Equipo</strong> antes de abrir el local.
                        </p>
                    )}
                    <div className="mt-5 border-t pt-4" data-testid="system-counts">
                        <div className="page-kicker mb-2">Registros</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {Object.entries(info.counts || {}).map(([key, value]) => (
                                <div key={key} className="rounded-lg border border-border px-3 py-2">
                                    <div className="text-xs text-muted-foreground">{RECORD_LABELS[key] || key}</div>
                                    <div className="font-mono font-semibold tabular-nums">{value}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            <div className="mt-5 border-t pt-4">
                <h3 className="font-display text-base font-semibold flex items-center gap-2 text-destructive">
                    <Trash2 className="h-4 w-4" /> Restablecer datos operativos
                </h3>
                <p className="text-sm text-muted-foreground mt-2 mb-3">
                    Borra pedidos, pagos, caja y movimientos. Se conservan el menú, las mesas, las sucursales y los usuarios.
                </p>
                <Button variant="destructive" onClick={() => setOpen(true)} data-testid="data-reset-button">
                    <Trash2 className="h-4 w-4 mr-2" /> Restablecer datos operativos
                </Button>
            </div>

            <div className="mt-5 border-t pt-4">
                <h3 className="font-display text-base font-semibold flex items-center gap-2 text-destructive">
                    <Trash2 className="h-4 w-4" /> Vaciar carta
                </h3>
                <p className="text-sm text-muted-foreground mt-2 mb-3">
                    Borra el menú completo (platos, combos y categorías) para cargar el tuyo desde
                    <strong> Carta → Importar</strong>. No toca pedidos, mesas, sucursales ni usuarios.
                </p>
                <Button variant="destructive" onClick={() => setCatalogOpen(true)} data-testid="catalog-reset-button">
                    <Trash2 className="h-4 w-4 mr-2" /> Vaciar carta
                </Button>
            </div>

            <AlertDialog open={catalogOpen} onOpenChange={(o) => { if (!o) cancelCatalog(); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Vaciar la carta completa?</AlertDialogTitle>
                    </AlertDialogHeader>
                    <div className="space-y-3 text-sm">
                        <p>
                            Se borrarán <strong>todos los platos, combos y categorías</strong>. Los pedidos ya
                            registrados conservan su detalle. Esta acción <strong>no se puede deshacer</strong>.
                        </p>
                        <p className="text-muted-foreground">
                            Si hay pedidos activos el sistema lo rechaza: ciérralos o restablece primero los datos operativos.
                        </p>
                        <div>
                            <Label htmlFor="catalog-reset-confirm">Escribe <strong>ELIMINAR</strong> para confirmar</Label>
                            <Input id="catalog-reset-confirm" value={catalogConfirm} onChange={(e) => setCatalogConfirm(e.target.value)} placeholder="ELIMINAR" className="mt-1" data-testid="catalog-reset-confirm" />
                        </div>
                        <div>
                            <Label htmlFor="catalog-reset-password">Contraseña de administrador</Label>
                            <Input id="catalog-reset-password" type="password" value={catalogPassword} onChange={(e) => setCatalogPassword(e.target.value)} placeholder="••••••••" className="mt-1" data-testid="catalog-reset-password" />
                        </div>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={cancelCatalog}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            disabled={catalogLoading || catalogConfirm.trim() !== 'ELIMINAR' || !catalogPassword}
                            onClick={resetCatalog}
                            data-testid="catalog-reset-confirm-button"
                        >
                            {catalogLoading ? 'Vaciando…' : 'Vaciar carta'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={open} onOpenChange={(o) => { if (!o) cancel(); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Restablecer los datos operativos?</AlertDialogTitle>
                    </AlertDialogHeader>
                    <div className="space-y-3 text-sm">
                        <p>
                            Se borrarán permanentemente los pedidos, pagos, caja abierta, movimientos,
                            auditoría y visitas de mesa. El menú, las mesas, las sucursales y los usuarios
                            <strong> se conservan</strong>. Esta acción no se puede deshacer.
                        </p>
                        <div>
                            <Label htmlFor="data-reset-confirm">Escribe <strong>ELIMINAR</strong> para confirmar</Label>
                            <Input id="data-reset-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="ELIMINAR" className="mt-1" data-testid="data-reset-confirm" />
                        </div>
                        <div>
                            <Label htmlFor="data-reset-password">Contraseña de administrador</Label>
                            <Input id="data-reset-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="mt-1" data-testid="data-reset-password" />
                        </div>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={cancel}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            disabled={loading || confirm.trim() !== 'ELIMINAR' || !password}
                            onClick={reset}
                            data-testid="data-reset-confirm-button"
                        >
                            {loading ? 'Restableciendo…' : 'Restablecer'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </CardContent></Card>
    );
}

export default function Configuracion() {
    return (
        <div className="space-y-5" data-testid="config-root">
            <p className="page-kicker mb-1">Administración</p>
            <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Settings className="h-6 w-6 text-primary" /> Configuración</h1>
            <p className="text-muted-foreground text-sm">Marca, datos del restaurante y sistema. Las sedes, zonas y mesas están en Local.</p>
            <Temas />
            <Restaurante />
            <Marca />
            <Funciones />
            <Datos />
        </div>
    );
}
