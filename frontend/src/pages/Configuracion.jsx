import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, Save, Trash2, Palette, Database, Image as ImageIcon, Sparkles } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useTheme } from '@/contexts/ThemeContext';
import { FEATURE_DEFS, mergeFeatures, notifyFeaturesChanged } from '@/lib/features';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function Temas() {
    const { theme, setTheme, clearThemeOverride, themes } = useTheme();
    const [restaurant, setRestaurant] = useState(null);
    const [saving, setSaving] = useState(false);
    
    useEffect(() => {
        api.get('/restaurants/current').then((res) => setRestaurant(res.data));
    }, []);
    
    const saveTheme = async (themeId) => {
        if (!restaurant) return;
        setSaving(true);
        try {
            await api.patch('/restaurants/current', { theme_id: themeId });
            setTheme(themeId);
            toast.success('Tema guardado para todo el restaurante');
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al guardar el tema');
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
    useEffect(() => { api.get('/restaurants/current').then((res) => setR(res.data)); }, []);
    const save = async () => {
        try { const { data } = await api.patch('/restaurants/current', r); setR(data); toast.success('Configuración guardada'); }
        catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };
    if (!r) return <div className="text-muted-foreground">Cargando…</div>;
    return (
        <Card><CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Nombre del restaurante</Label><Input value={r.name || ''} onChange={(e) => setR({ ...r, name: e.target.value })} data-testid="config-name" /></div>
            <div><Label>RUC</Label><Input value={r.ruc || ''} onChange={(e) => setR({ ...r, ruc: e.target.value })} /></div>
            <div className="md:col-span-2"><Label>Dirección</Label><Input value={r.address || ''} onChange={(e) => setR({ ...r, address: e.target.value })} /></div>
            <div><Label>Teléfono</Label><Input value={r.phone || ''} onChange={(e) => setR({ ...r, phone: e.target.value })} /></div>
            <div><Label>Moneda</Label><Input value={r.currency || ''} onChange={(e) => setR({ ...r, currency: e.target.value })} /></div>
            <div><Label>Zona horaria</Label><Input value={r.timezone || ''} onChange={(e) => setR({ ...r, timezone: e.target.value })} /></div>
            <div><Label>Horario</Label><Input value={r.opening_hours || ''} onChange={(e) => setR({ ...r, opening_hours: e.target.value })} /></div>
            <div className="md:col-span-2">
                <Label>Seguimiento de preparación</Label>
                <Select value={r.prep_mode || 'detailed'} onValueChange={(v) => setR({ ...r, prep_mode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="simple">Sencillo — Pendiente → Servido</SelectItem>
                        <SelectItem value="detailed">Detallado — Enviado → Preparando → Listo → Entregado</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">No mezcla cobrado con servido. Se aplica a cómo trabajan, no cambia los pedidos ya tomados.</p>
            </div>
            <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Switch checked={!!r.auto_release_table} onCheckedChange={(v) => setR({ ...r, auto_release_table: v })} data-testid="config-auto-release" />
                    Liberar mesa automáticamente al cobrar
                </label>
                <p className="text-xs text-muted-foreground mt-1">Al pagar la cuenta completa, la mesa pasa directo a «Disponible» (reaparece en la carta web al instante). Si está apagado, queda «Cuenta pagada» hasta que el mozo la libere.</p>
            </div>
            <div className="md:col-span-2 flex justify-end"><Button onClick={save} data-testid="config-save"><Save className="h-4 w-4 mr-2" />Guardar cambios</Button></div>
        </CardContent></Card>
    );
}

function Marca() {
    const [r, setR] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => { api.get('/restaurants/current').then((res) => setR(res.data)); }, []);
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
            const { data } = await api.patch('/restaurants/current', {
                logo_url: r.logo_url || '',
                cover_url: r.cover_url || '',
                public_description: r.public_description || '',
                social_instagram: r.social_instagram || '',
                social_facebook: r.social_facebook || '',
                social_whatsapp: r.social_whatsapp || '',
            });
            setR(data);
            toast.success('Marca guardada');
        } catch (e) { toast.error(e.response?.data?.detail || 'Error al guardar la marca'); }
        finally { setSaving(false); }
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
                            <label className="text-sm underline cursor-pointer">
                                <input type="file" accept="image/*" className="hidden" onChange={onFile('logo_url')} data-testid="marca-logo-input" />
                                Subir logo
                            </label>
                            {r.logo_url && (
                                <button type="button" className="text-xs text-destructive text-left" onClick={() => set({ logo_url: '' })} data-testid="marca-logo-clear">Quitar</button>
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
                        <label className="text-sm underline cursor-pointer">
                            <input type="file" accept="image/*" className="hidden" onChange={onFile('cover_url')} data-testid="marca-cover-input" />
                            Subir portada
                        </label>
                        {r.cover_url && (
                            <button type="button" className="text-xs text-destructive" onClick={() => set({ cover_url: '' })} data-testid="marca-cover-clear">Quitar</button>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">Imagen ancha (ej. 1600×600) que encabeza la carta web.</p>
                </div>
            </div>

            <div>
                <Label>Descripción pública</Label>
                <Textarea
                    value={r.public_description || ''}
                    onChange={(e) => set({ public_description: e.target.value })}
                    placeholder="Cocina peruana de autor con productos frescos…"
                    className="mt-1"
                    data-testid="marca-description"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><Label>Instagram</Label><Input value={r.social_instagram || ''} onChange={(e) => set({ social_instagram: e.target.value })} placeholder="@turestaurante" className="mt-1" data-testid="marca-instagram" /></div>
                <div><Label>Facebook</Label><Input value={r.social_facebook || ''} onChange={(e) => set({ social_facebook: e.target.value })} placeholder="https://facebook.com/…" className="mt-1" data-testid="marca-facebook" /></div>
                <div><Label>WhatsApp</Label><Input value={r.social_whatsapp || ''} onChange={(e) => set({ social_whatsapp: e.target.value })} placeholder="+51 999 888 777" className="mt-1" data-testid="marca-whatsapp" /></div>
            </div>
        </CardContent></Card>
    );
}

function Funciones() {
    const [features, setFeatures] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.get('/restaurants/current').then((res) => setFeatures(mergeFeatures(res.data?.features)));
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            await api.patch('/restaurants/current', { features });
            notifyFeaturesChanged();
            toast.success('Funciones guardadas');
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudieron guardar las funciones');
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
                Activá solo lo que vas a usar. Lo que está apagado no se muestra, no se ejecuta ni consume.
            </p>
            <div className="space-y-2" data-testid="funciones-lista">
                {FEATURE_DEFS.map((def) => (
                    <label key={def.key} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3 cursor-pointer">
                        <span className="min-w-0">
                            <span className="block text-sm font-medium">{def.label}</span>
                            <span className="block text-xs text-muted-foreground">{def.description}</span>
                        </span>
                        <Switch
                            checked={Boolean(features[def.key])}
                            onCheckedChange={(value) => setFeatures((current) => ({ ...current, [def.key]: value }))}
                            data-testid={`funcion-${def.key}`}
                        />
                    </label>
                ))}
            </div>
        </CardContent></Card>
    );
}

function fmtServerTime(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'medium' }); }
    catch { return iso; }
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
    const [info, setInfo] = useState(null);
    const [infoError, setInfoError] = useState(false);

    const loadInfo = async () => {
        try {
            const { data } = await api.get('/system/info');
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
            await api.post('/data/reset', { confirm: confirm.trim(), password });
            toast.success('Datos operativos restablecidos');
            setOpen(false);
            setConfirm('');
            setPassword('');
            loadInfo();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo restablecer los datos');
        } finally {
            setLoading(false);
        }
    };

    const cancel = () => {
        setOpen(false);
        setConfirm('');
        setPassword('');
    };

    return (
        <Card><CardContent className="p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
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
                        <SystemItem label="Entorno" value={info.environment} />
                        <SystemItem label="Base de datos" value={`${info.database?.name} · ${info.database?.connected ? 'conectada' : 'sin conexión'}`} />
                        <SystemItem label="Restaurante" value={info.restaurant?.name || '—'} />
                        <SystemItem label="Zona horaria" value={info.restaurant?.timezone || '—'} />
                        <SystemItem label="Hora del servidor (UTC)" value={fmtServerTime(info.server_time)} />
                        <SystemItem label="En línea desde" value={fmtUptime(info.uptime_seconds)} />
                        <SystemItem label="Python" value={info.runtime?.python || '—'} />
                        <SystemItem label="Datos demo" value={info.demo_seed ? 'Sí' : 'No'} />
                    </div>
                    <div className="mt-5 border-t pt-4" data-testid="system-counts">
                        <div className="page-kicker mb-2">Registros</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {Object.entries(info.counts || {}).map(([key, value]) => (
                                <div key={key} className="rounded-lg border border-border px-3 py-2">
                                    <div className="text-xs text-muted-foreground capitalize">{key}</div>
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
                            <Label>Escribe <strong>ELIMINAR</strong> para confirmar</Label>
                            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="ELIMINAR" className="mt-1" data-testid="data-reset-confirm" />
                        </div>
                        <div>
                            <Label>Contraseña de administrador</Label>
                            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="mt-1" data-testid="data-reset-password" />
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
