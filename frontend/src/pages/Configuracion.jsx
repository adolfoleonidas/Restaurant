import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, Save, Grid2X2, Plus, Pencil, Trash2, MapPin, Palette } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import TableQrActions from '@/components/TableQrActions';
import { useTheme } from '@/contexts/ThemeContext';
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

function Sucursales() {
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState({ name: '', timezone: '', business_day_cutoff: '', pickup_enabled: false });
    const [saving, setSaving] = useState(false);
    const load = async () => {
        setLoading(true);
        try { const { data } = await api.get('/branches'); setBranches(Array.isArray(data) ? data : []); }
        catch (e) { toast.error(e.response?.data?.detail || 'No se pudieron cargar las sucursales'); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);
    const update = (id, key, value) => setBranches((rows) => rows.map((branch) => branch.id === id ? { ...branch, [key]: value } : branch));
    const create = async () => {
        setSaving(true);
        try {
            await api.post('/branches', draft);
            setDraft({ name: '', timezone: '', business_day_cutoff: '', pickup_enabled: false });
            toast.success('Sucursal creada'); await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo crear la sucursal'); }
        finally { setSaving(false); }
    };
    const save = async (branch) => {
        setSaving(true);
        try {
            await api.patch(`/branches/${branch.id}`, {
                name: branch.name,
                timezone: branch.timezone,
                business_day_cutoff: branch.business_day_cutoff,
                pickup_enabled: Boolean(branch.pickup_enabled),
            });
            toast.success('Sucursal guardada'); await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo guardar la sucursal'); }
        finally { setSaving(false); }
    };
    const fields = (value, onChange, prefix) => (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>Nombre de sucursal</Label><Input value={value.name || ''} onChange={(e) => onChange('name', e.target.value)} data-testid={`${prefix}-name`} /></div>
            <div><Label>Zona horaria IANA</Label><Input value={value.timezone || ''} onChange={(e) => onChange('timezone', e.target.value)} placeholder="America/Lima" data-testid={`${prefix}-timezone`} /></div>
            <div><Label>Corte del día de negocio (hora local)</Label><Input type="time" value={value.business_day_cutoff || ''} onChange={(e) => onChange('business_day_cutoff', e.target.value)} data-testid={`${prefix}-cutoff`} /></div>
        </div>
    );
    return (
        <Card><CardContent className="p-5 space-y-5">
            <div><h2 className="font-display text-lg font-semibold">Sucursales</h2><p className="text-sm text-muted-foreground">El recojo público solo aparece en sucursales habilitadas explícitamente.</p></div>
            <div className="rounded-xl border p-4 space-y-3">
                {fields(draft, (key, value) => setDraft((current) => ({ ...current, [key]: value })), 'branch-new')}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.pickup_enabled} onChange={(e) => setDraft((current) => ({ ...current, pickup_enabled: e.target.checked }))} data-testid="branch-pickup-enabled-new" />Habilitar recojo público</label>
                <Button onClick={create} disabled={saving || !draft.name.trim() || !draft.timezone.trim() || !draft.business_day_cutoff} data-testid="branch-create">Crear sucursal</Button>
            </div>
            {loading ? <p className="text-sm text-muted-foreground">Cargando sucursales…</p> : branches.map((branch) => (
                <div key={branch.id} className="rounded-xl border p-4 space-y-3" data-testid={`branch-row-${branch.id}`}>
                    {fields(branch, (key, value) => update(branch.id, key, value), `branch-${branch.id}`)}
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(branch.pickup_enabled)} onChange={(e) => update(branch.id, 'pickup_enabled', e.target.checked)} data-testid={`branch-pickup-enabled-${branch.id}`} />Habilitar recojo público</label>
                    <Button onClick={() => save(branch)} disabled={saving || !branch.name?.trim() || !branch.timezone?.trim() || !branch.business_day_cutoff} data-testid={`branch-save-${branch.id}`}>Guardar sucursal</Button>
                </div>
            ))}
            {!loading && branches.length === 0 && <p className="text-sm text-muted-foreground">No hay sucursales configuradas.</p>}
        </CardContent></Card>
    );
}

function Zonas() {
    const [zones, setZones] = useState([]);
    const [branches, setBranches] = useState([]);
    const [tables, setTables] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const [branchId, setBranchId] = useState('');
    const [confirmDel, setConfirmDel] = useState(null);
    
    const load = async () => {
        const [z, b, t] = await Promise.all([
            api.get('/zones'),
            api.get('/branches'),
            api.get('/tables')
        ]);
        setZones(z.data);
        setBranches(Array.isArray(b.data) ? b.data : []);
        setTables(t.data);
    };
    
    useEffect(() => { load(); }, []);
    
    const openNew = () => { 
        setEditing(null); 
        setName(''); 
        setBranchId('');
        setDlg(true); 
    };
    
    const openEdit = (z) => { 
        setEditing(z); 
        setName(z.name); 
        setBranchId(z.branch_id || '');
        setDlg(true); 
    };
    
    const save = async () => {
        try {
            const payload = { name };
            if (branchId) payload.branch_id = branchId;
            
            if (editing) await api.patch(`/zones/${editing.id}`, payload);
            else await api.post('/zones', payload);
            toast.success('Guardado'); setDlg(false); await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };
    
    const doDelete = async (z) => {
        try { await api.delete(`/zones/${z.id}`); toast.success('Zona eliminada'); await load(); }
        catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };
    
    const getBranchName = (id) => {
        const branch = branches.find(b => b.id === id);
        return branch ? branch.name : 'Sin sucursal';
    };
    
    const getTablesInZone = (zoneName) => {
        return tables.filter(t => t.area === zoneName);
    };

    return (
        <Card><CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-lg font-semibold flex items-center gap-2"><MapPin className="h-5 w-5" /> Zonas del salón</h2>
                <Button onClick={openNew} data-testid="zona-config-nueva"><Plus className="h-4 w-4 mr-2" />Nueva zona</Button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Asigná una sucursal a cada zona. Las mesas heredarán automáticamente la sucursal de su zona.</p>
            
            {zones.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Sin zonas. Creá una para agrupar las mesas (ej: Salón, Terraza).</p>
            ) : (
                <div className="space-y-3">
                    {zones.map((z) => {
                        const zoneTables = getTablesInZone(z.name);
                        return (
                            <div key={z.id} className="border rounded-xl p-4 space-y-3" data-testid={`zona-row-${z.id}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-lg">{z.name}</span>
                                            <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                                                {getBranchName(z.branch_id)}
                                            </span>
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {zoneTables.length} {zoneTables.length === 1 ? 'mesa' : 'mesas'} en esta zona
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button size="icon" variant="ghost" onClick={() => openEdit(z)}><Pencil className="h-4 w-4" /></Button>
                                        <Button size="icon" variant="ghost" onClick={() => setConfirmDel(z)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                    </div>
                                </div>
                                
                                {zoneTables.length > 0 && (
                                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                                        {zoneTables.map(t => (
                                            <span key={t.id} className="text-xs px-2 py-1 rounded bg-muted">
                                                Mesa {t.number}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <Dialog open={dlg} onOpenChange={setDlg}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editing ? 'Editar zona' : 'Nueva zona'}</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Nombre</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Terraza" data-testid="zona-form-name" />
                        </div>
                        <div>
                            <Label>Sucursal asignada</Label>
                            <Select value={branchId} onValueChange={setBranchId}>
                                <SelectTrigger data-testid="zona-form-branch">
                                    <SelectValue placeholder="Seleccionar sucursal..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">
                                Las mesas de esta zona heredarán automáticamente esta sucursal.
                            </p>
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Al renombrar una zona, las mesas que la usan se actualizan solas.</p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDlg(false)}>Cancelar</Button>
                        <Button onClick={save} disabled={!name.trim()} data-testid="zona-form-save">Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!confirmDel} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar zona «{confirmDel?.name}»?</AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={async () => { await doDelete(confirmDel); setConfirmDel(null); }}>Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </CardContent></Card>
    );
}

const TABLE_STATUS_DOT = {
    disponible: 'bg-green-500',
    ocupada: 'bg-red-500',
    esperando_pago: 'bg-amber-500',
    reservada: 'bg-blue-500',
    inactiva: 'bg-gray-400',
    pagada: 'bg-emerald-400',
};

function Mesas() {
    const [tables, setTables] = useState([]);
    const [zones, setZones] = useState([]);
    const [branches, setBranches] = useState([]);
    const [branchesLoading, setBranchesLoading] = useState(true);
    const [branchesError, setBranchesError] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [confirmDel, setConfirmDel] = useState(null);
    const [form, setForm] = useState({ number: '', name: '', capacity: 4, area: 'Salón', status: 'disponible', branch_id: '' });
    const load = async () => {
        const [t, z] = await Promise.all([api.get('/tables'), api.get('/zones')]);
        setTables(t.data); setZones(z.data);
    };
    useEffect(() => { load(); }, []);
    const loadBranches = async () => {
        setBranchesLoading(true);
        setBranchesError(false);
        try {
            const { data } = await api.get('/branches');
            setBranches(Array.isArray(data) ? data : []);
        } catch (e) {
            setBranchesError(true);
            toast.error(e.response?.data?.detail || 'No se pudieron cargar las sucursales');
        } finally { setBranchesLoading(false); }
    };
    useEffect(() => { loadBranches(); }, []);
    const defaultArea = () => (zones[0]?.name || 'Salón');
    const openNew = () => { setEditing(null); setForm({ number: tables.length + 1, name: '', capacity: 4, area: defaultArea(), status: 'disponible', branch_id: '' }); setDlg(true); };
    const openEdit = (t) => { setEditing(t); setForm({ number: t.number, name: t.name, capacity: t.capacity, area: t.area, status: t.status, branch_id: t.branch_id || '' }); setDlg(true); };
    const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const { branch_id, ...tableForm } = form;
            const payload = { ...tableForm, number: Number(form.number), capacity: Number(form.capacity) };
            if (branch_id && branch_id !== (editing?.branch_id || '')) payload.branch_id = branch_id;
            if (editing) await api.patch(`/tables/${editing.id}`, payload);
            else await api.post('/tables', payload);
            toast.success('Guardado'); setDlg(false); await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
        finally { setSaving(false); }
    };
    const doDelete = async (t) => {
        try { await api.delete(`/tables/${t.id}`); toast.success('Eliminada'); await load(); }
        catch (e) { toast.error('Error'); }
    };
    
    const getZoneBranch = (area) => {
        const zone = zones.find(z => z.name === area);
        return zone?.branch_id || null;
    };
    
    const getBranchName = (id) => {
        const branch = branches.find(b => b.id === id);
        return branch ? branch.name : null;
    };
    
    const getTableBranchInfo = (table) => {
        if (table.branch_id) {
            const name = getBranchName(table.branch_id);
            return { type: 'explicit', name: name || table.branch_id };
        }
        const zoneBranch = getZoneBranch(table.area);
        if (zoneBranch) {
            const name = getBranchName(zoneBranch);
            return { type: 'inherited', name: name || zoneBranch };
        }
        return { type: 'none', name: 'Sin sucursal' };
    };

    return (
        <Card><CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Grid2X2 className="h-5 w-5" /> Mesas</h2>
                <Button onClick={openNew} data-testid="mesa-config-nueva"><Plus className="h-4 w-4 mr-2" />Nueva mesa</Button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
                Las mesas heredan la sucursal de su zona. Podés asignar una sucursal diferente individualmente si es necesario.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {tables.map((t) => {
                    const branchInfo = getTableBranchInfo(t);
                    return (
                        <div key={t.id} className="border rounded-xl p-3" data-testid={`mesa-config-row-${t.id}`}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${TABLE_STATUS_DOT[t.status] || 'bg-gray-400'}`} title={t.status} />
                                    <div>
                                        <div className="font-medium">{t.name}</div>
                                        <div className="text-xs text-muted-foreground">{t.area} · {t.capacity} pax</div>
                                        <div className="text-xs mt-1" data-testid={`mesa-config-branch-${t.id}`}>
                                            {branchInfo.type === 'explicit' && (
                                                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                                    {branchInfo.name}
                                                </span>
                                            )}
                                            {branchInfo.type === 'inherited' && (
                                                <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                                    Hereda: {branchInfo.name}
                                                </span>
                                            )}
                                            {branchInfo.type === 'none' && (
                                                <span className="text-muted-foreground">{branchInfo.name}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button size="icon" variant="ghost" onClick={() => openEdit(t)} aria-label={`Editar ${t.name}`}><Pencil className="h-4 w-4" /></Button>
                                    <Button size="icon" variant="ghost" onClick={() => setConfirmDel(t)} aria-label={`Eliminar ${t.name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                </div>
                            </div>
                            <TableQrActions table={t} />
                        </div>
                    );
                })}
            </div>

            <Dialog open={dlg} onOpenChange={setDlg}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editing ? 'Editar mesa' : 'Nueva mesa'}</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3">
                        <div><Label>Número</Label><Input type="number" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} data-testid="mesa-form-number" /></div>
                        <div><Label>Nombre</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                        <div><Label>Capacidad</Label><Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
                        <div><Label>Zona</Label>
                            <Select value={form.area} onValueChange={(v) => {
                                const zoneBranch = getZoneBranch(v);
                                // Si la mesa no tiene branch_id explícito, hereda de la zona
                                const newBranchId = (!editing || !editing.branch_id) ? (zoneBranch || '') : form.branch_id;
                                setForm({ ...form, area: v, branch_id: newBranchId });
                            }}>
                                <SelectTrigger data-testid="mesa-form-area"><SelectValue placeholder="Elegí una zona" /></SelectTrigger>
                                <SelectContent>
                                    {zones.map((z) => <SelectItem key={z.id} value={z.name}>{z.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="col-span-2">
                            <Label htmlFor="mesa-form-branch">Sucursal</Label>
                            <select
                                id="mesa-form-branch"
                                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={form.branch_id}
                                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                                disabled={branchesLoading || branchesError || saving}
                                data-testid="mesa-form-branch"
                            >
                                <option value="">Heredar de la zona</option>
                                {editing?.branch_id && !branches.some((branch) => branch.id === editing.branch_id) && <option value={editing.branch_id}>{editing.branch_id}</option>}
                                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                            </select>
                            {branchesLoading && <p className="text-xs text-muted-foreground mt-1" data-testid="mesa-branches-loading">Cargando sucursales…</p>}
                            {!branchesLoading && branchesError && <div className="flex items-center gap-2 mt-1"><p className="text-xs text-muted-foreground">No se pudo cargar la lista. Los cambios de sucursal están deshabilitados.</p><Button type="button" size="sm" variant="outline" onClick={loadBranches} disabled={saving} data-testid="mesa-branches-retry">Reintentar</Button></div>}
                            {!branchesLoading && !branchesError && branches.length === 0 && <p className="text-xs text-muted-foreground mt-1">No hay sucursales configuradas.</p>}
                            
                            {/* Mostrar qué sucursal heredará si no hay asignación explícita */}
                            {!form.branch_id && form.area && (() => {
                                const zoneBranch = getZoneBranch(form.area);
                                if (zoneBranch) {
                                    const branchName = getBranchName(zoneBranch);
                                    return (
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                            ✓ Heredará: {branchName || zoneBranch} (de la zona "{form.area}")
                                        </p>
                                    );
                                }
                                return (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        La zona "{form.area}" no tiene sucursal asignada. Esta mesa quedará sin sucursal.
                                    </p>
                                );
                            })()}
                            {form.branch_id && (
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                    ✓ Asignación explícita (override de la zona)
                                </p>
                            )}
                        </div>
                        {editing && (
                            <div className="col-span-2"><Label>Estado</Label>
                                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {['disponible', 'ocupada', 'esperando_pago', 'reservada', 'inactiva'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDlg(false)}>Cancelar</Button>
                        <Button onClick={save} disabled={saving} data-testid="mesa-form-save">{saving ? 'Guardando…' : 'Guardar'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!confirmDel} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar {confirmDel?.name}?</AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={async () => { await doDelete(confirmDel); setConfirmDel(null); }}>Eliminar</AlertDialogAction>
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
            <p className="text-muted-foreground text-sm">Datos del restaurante, sucursales, zonas y mesas.</p>
            <Temas />
            <Restaurante />
            <Sucursales />
            <Zonas />
            <Mesas />
        </div>
    );
}
