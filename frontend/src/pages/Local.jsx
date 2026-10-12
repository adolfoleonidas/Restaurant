import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createBranch, listBranches, updateBranch } from '@/lib/api/branches';
import { createTable, deleteTable, listTables, updateTable } from '@/lib/api/tables';
import { createZone, deleteZone, listZones, updateZone } from '@/lib/api/zones';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Grid2X2, Plus, Pencil, Trash2, MapPin, Store } from 'lucide-react';
import { toast } from 'sonner';
import TableQrActions from '@/components/TableQrActions';
import { TABLE_STATUS_LABELS } from '@/constants/status';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiErrorMessage } from '@/lib/apiError';

/**
 * Local — structural master data of the venue (sede → zona → mesa).
 * Split out of Configuración so that screen holds only settings (theme,
 * restaurant data, branding and system info).
 */

export function SucursalesPanel() {
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [draft, setDraft] = useState({ name: '', timezone: '', business_day_cutoff: '', pickup_enabled: false });
    const [saving, setSaving] = useState(false);
    const load = async () => {
        setLoading(true);
        try { const { data } = await listBranches(); setBranches(Array.isArray(data) ? data : []); }
        catch (e) { toast.error(apiErrorMessage(e, 'No se pudieron cargar las sucursales')); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);
    const update = (id, key, value) => setBranches((rows) => rows.map((branch) => branch.id === id ? { ...branch, [key]: value } : branch));
    const create = async () => {
        setSaving(true);
        try {
            await createBranch(draft);
            setDraft({ name: '', timezone: '', business_day_cutoff: '', pickup_enabled: false });
            toast.success('Sucursal creada'); await load();
        } catch (e) { toast.error(apiErrorMessage(e, 'No se pudo crear la sucursal')); }
        finally { setSaving(false); }
    };
    const save = async (branch) => {
        setSaving(true);
        try {
            await updateBranch(branch.id, {
                name: branch.name,
                timezone: branch.timezone,
                business_day_cutoff: branch.business_day_cutoff,
                pickup_enabled: Boolean(branch.pickup_enabled),
            });
            toast.success('Sucursal guardada'); await load();
        } catch (e) { toast.error(apiErrorMessage(e, 'No se pudo guardar la sucursal')); }
        finally { setSaving(false); }
    };
    const fields = (value, onChange, prefix) => (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label htmlFor={`${prefix}-name`}>Nombre de sucursal</Label><Input id={`${prefix}-name`} value={value.name || ''} onChange={(e) => onChange('name', e.target.value)} data-testid={`${prefix}-name`} /></div>
            <div><Label htmlFor={`${prefix}-timezone`}>Zona horaria IANA</Label><Input id={`${prefix}-timezone`} value={value.timezone || ''} onChange={(e) => onChange('timezone', e.target.value)} placeholder="America/Lima" data-testid={`${prefix}-timezone`} /></div>
            <div><Label htmlFor={`${prefix}-cutoff`}>Corte del día de negocio (hora local)</Label><Input id={`${prefix}-cutoff`} type="time" value={value.business_day_cutoff || ''} onChange={(e) => onChange('business_day_cutoff', e.target.value)} data-testid={`${prefix}-cutoff`} /></div>
        </div>
    );
    return (
        <Card><CardContent className="p-5 space-y-5">
            <div><h2 className="font-display text-lg font-semibold">Sucursales</h2><p className="text-sm text-muted-foreground">El recojo público solo aparece en sucursales habilitadas explícitamente.</p></div>
            <div className="rounded-xl border p-4 space-y-3">
                {fields(draft, (key, value) => setDraft((current) => ({ ...current, [key]: value })), 'branch-new')}
                <label className="flex min-h-touch items-center gap-2 text-sm"><input type="checkbox" className="h-6 w-6 shrink-0" checked={draft.pickup_enabled} onChange={(e) => setDraft((current) => ({ ...current, pickup_enabled: e.target.checked }))} data-testid="branch-pickup-enabled-new" />Habilitar recojo público</label>
                <Button onClick={create} disabled={saving || !draft.name.trim() || !draft.timezone.trim() || !draft.business_day_cutoff} data-testid="branch-create">Crear sucursal</Button>
            </div>
            {loading ? <p className="text-sm text-muted-foreground">Cargando sucursales…</p> : branches.map((branch) => (
                <div key={branch.id} className="rounded-xl border p-4 space-y-3" data-testid={`branch-row-${branch.id}`}>
                    {fields(branch, (key, value) => update(branch.id, key, value), `branch-${branch.id}`)}
                    <label className="flex min-h-touch items-center gap-2 text-sm"><input type="checkbox" className="h-6 w-6 shrink-0" checked={Boolean(branch.pickup_enabled)} onChange={(e) => update(branch.id, 'pickup_enabled', e.target.checked)} data-testid={`branch-pickup-enabled-${branch.id}`} />Habilitar recojo público</label>
                    <Button onClick={() => save(branch)} disabled={saving || !branch.name?.trim() || !branch.timezone?.trim() || !branch.business_day_cutoff} data-testid={`branch-save-${branch.id}`}>Guardar sucursal</Button>
                </div>
            ))}
            {!loading && branches.length === 0 && <p className="text-sm text-muted-foreground">No hay sucursales configuradas.</p>}
        </CardContent></Card>
    );
}

export function ZonasPanel() {
    const [zones, setZones] = useState([]);
    const [branches, setBranches] = useState([]);
    const [tables, setTables] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const [branchId, setBranchId] = useState('');
    const [confirmDel, setConfirmDel] = useState(null);

    const load = async () => {
        try {
            const [z, b, t] = await Promise.all([
                listZones(),
                listBranches(),
                listTables()
            ]);
            setZones(z.data);
            setBranches(Array.isArray(b.data) ? b.data : []);
            setTables(t.data);
        } catch {
            // Keep the section usable with whatever data is already loaded.
        }
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

            if (editing) await updateZone(editing.id, payload);
            else await createZone(payload);
            toast.success('Guardado'); setDlg(false); await load();
        } catch (e) { toast.error(apiErrorMessage(e, 'No se pudo guardar el cambio. Revisá tu conexión y reintentá.')); }
    };

    const doDelete = async (z) => {
        try { await deleteZone(z.id); toast.success('Zona eliminada'); await load(); }
        catch (e) { toast.error(apiErrorMessage(e, 'No se pudo guardar el cambio. Revisá tu conexión y reintentá.')); }
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
                                        <Button size="icon" variant="ghost" aria-label={`Editar ${z.name}`} onClick={() => openEdit(z)}><Pencil className="h-4 w-4" /></Button>
                                        <Button size="icon" variant="ghost" aria-label={`Eliminar ${z.name}`} onClick={() => setConfirmDel(z)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
                            <Label htmlFor="zona-form-nombre">Nombre</Label>
                            <Input id="zona-form-nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Terraza" data-testid="zona-form-name" />
                        </div>
                        <div>
                            <Label htmlFor="zona-form-sucursal">Sucursal asignada</Label>
                            <Select value={branchId} onValueChange={setBranchId}>
                                <SelectTrigger id="zona-form-sucursal" data-testid="zona-form-branch">
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

export function TablesManager() {
    const [tables, setTables] = useState([]);
    const [zones, setZones] = useState([]);
    const [branches, setBranches] = useState([]);
    const [branchesLoading, setBranchesLoading] = useState(true);
    const [branchesError, setBranchesError] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [confirmDel, setConfirmDel] = useState(null);
    const [assignBranch, setAssignBranch] = useState('');
    const [assigning, setAssigning] = useState(false);
    const [form, setForm] = useState({ number: '', name: '', capacity: 4, area: 'Salón', status: 'disponible', branch_id: '' });
    const load = async () => {
        try {
            const [t, z] = await Promise.all([listTables(), listZones()]);
            setTables(t.data); setZones(z.data);
        } catch {
            // Keep the section usable with whatever data is already loaded.
        }
    };
    useEffect(() => { load(); }, []);
    const loadBranches = async () => {
        setBranchesLoading(true);
        setBranchesError(false);
        try {
            const { data } = await listBranches();
            setBranches(Array.isArray(data) ? data : []);
        } catch (e) {
            setBranchesError(true);
            toast.error(apiErrorMessage(e, 'No se pudieron cargar las sucursales'));
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
            if (editing) await updateTable(editing.id, payload);
            else await createTable(payload);
            toast.success('Guardado'); setDlg(false); await load();
        } catch (e) { toast.error(apiErrorMessage(e, 'No se pudo guardar el cambio. Revisá tu conexión y reintentá.')); }
        finally { setSaving(false); }
    };
    const doDelete = async (t) => {
        try { await deleteTable(t.id); toast.success('Eliminada'); await load(); }
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
        // Sin `branch_id` guardado la mesa no existe para el salón de esa
        // sucursal: el filtro de todos los roles operativos lee ese campo. La
        // zona puede tenerla definida, pero hasta que la mesa la herede sigue
        // siendo invisible, así que no se muestra como si ya estuviera asignada.
        const zoneBranch = getZoneBranch(table.area);
        if (zoneBranch) {
            return { type: 'zone-pending', name: getBranchName(zoneBranch) || zoneBranch };
        }
        return { type: 'none', name: 'Sin sucursal' };
    };

    // Mesas que ningún rol de sucursal puede ver (mozo, caja, cocina).
    const missingBranch = tables.filter((t) => !t.branch_id);

    const assignMissingToBranch = async () => {
        if (!assignBranch || assigning || missingBranch.length === 0) return;
        setAssigning(true);
        let done = 0;
        try {
            for (const t of missingBranch) {
                await updateTable(t.id, { branch_id: assignBranch });
                done += 1;
            }
            toast.success(done === 1 ? 'Mesa asignada' : `${done} mesas asignadas`);
        } catch (e) {
            const detail = apiErrorMessage(e, '');
            toast.error(done > 0
                ? `${done} de ${missingBranch.length} mesas asignadas. ${detail || 'Reintentá con el resto.'}`
                : (detail || 'No se pudieron asignar las mesas'));
        } finally {
            setAssigning(false);
            setAssignBranch('');
            await load();
        }
    };

    return (
        <Card><CardContent className="p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Grid2X2 className="h-5 w-5" /> Mesas</h2>
                <Button className="h-11 sm:h-10" onClick={openNew} data-testid="mesa-config-nueva"><Plus className="h-4 w-4 mr-2" />Nueva mesa</Button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
                Las mesas heredan la sucursal de su zona. Podés asignar una sucursal diferente individualmente si es necesario.
            </p>
            {missingBranch.length > 0 && (
                <div
                    role="alert"
                    className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
                    data-testid="mesa-sin-sucursal-aviso"
                >
                    <p className="font-medium" data-testid="mesa-sin-sucursal-titulo">
                        {missingBranch.length === 1 ? '1 mesa sin sucursal' : `${missingBranch.length} mesas sin sucursal`}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                        El mozo, la caja y la cocina solo ven las mesas de su sucursal: estas mesas no
                        aparecen en su salón. Asigná la sucursal de la zona (pestaña Zonas) o elegila acá.
                    </p>
                    {branches.length > 0 ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <select
                                className="h-11 rounded-md border border-input bg-background px-3 py-2 text-sm sm:h-10"
                                value={assignBranch}
                                onChange={(e) => setAssignBranch(e.target.value)}
                                disabled={assigning}
                                aria-label="Sucursal para las mesas sin sucursal"
                                data-testid="mesa-sin-sucursal-branch"
                            >
                                <option value="">Elegí una sucursal</option>
                                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                            </select>
                            <Button
                                className="h-11 sm:h-10"
                                onClick={assignMissingToBranch}
                                disabled={!assignBranch || assigning}
                                data-testid="mesa-sin-sucursal-asignar"
                            >
                                {assigning ? 'Asignando…' : 'Asignar a la sucursal'}
                            </Button>
                        </div>
                    ) : (
                        <p className="mt-2 text-muted-foreground">
                            Todavía no hay sucursales: creá una en la pestaña Sucursales para poder asignarlas.
                        </p>
                    )}
                </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {tables.map((t) => {
                    const branchInfo = getTableBranchInfo(t);
                    return (
                        <div
                            key={t.id}
                            className={`border rounded-xl p-3 ${branchInfo.type === 'explicit' ? '' : 'border-amber-300 dark:border-amber-900'}`}
                            data-testid={`mesa-config-row-${t.id}`}
                            data-branch-missing={t.branch_id ? undefined : 'true'}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    {/* El color solo no comunica en táctil (no hay tooltip): estado también en texto */}
                                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${TABLE_STATUS_DOT[t.status] || 'bg-gray-400'}`} title={t.status} aria-hidden="true" />
                                    <div className="min-w-0">
                                        <div className="font-medium truncate">{t.name}</div>
                                        <div className="text-xs text-muted-foreground">{t.area} · {t.capacity} pax · {TABLE_STATUS_LABELS[t.status] || t.status}</div>
                                        <div className="text-xs mt-1" data-testid={`mesa-config-branch-${t.id}`}>
                                            {branchInfo.type === 'explicit' && (
                                                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                                    {branchInfo.name}
                                                </span>
                                            )}
                                            {branchInfo.type === 'zone-pending' && (
                                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                                                    Sin sucursal · la zona es {branchInfo.name}
                                                </span>
                                            )}
                                            {branchInfo.type === 'none' && (
                                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                                                    {branchInfo.name}
                                                </span>
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
                    {/* Una columna en móvil: a 360 px cada campo de la rejilla de 2 quedaba en ~136 px */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div><Label htmlFor="mesa-form-numero">Número</Label><Input id="mesa-form-numero" type="number" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} data-testid="mesa-form-number" /></div>
                        <div><Label htmlFor="mesa-form-nombre">Nombre</Label><Input id="mesa-form-nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                        <div><Label htmlFor="mesa-form-capacidad">Capacidad</Label><Input id="mesa-form-capacidad" type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
                        <div><Label htmlFor="mesa-form-zona">Zona</Label>
                            <Select value={form.area} onValueChange={(v) => {
                                const zoneBranch = getZoneBranch(v);
                                // Si la mesa no tiene branch_id explícito, hereda de la zona
                                const newBranchId = (!editing || !editing.branch_id) ? (zoneBranch || '') : form.branch_id;
                                setForm({ ...form, area: v, branch_id: newBranchId });
                            }}>
                                <SelectTrigger id="mesa-form-zona" data-testid="mesa-form-area"><SelectValue placeholder="Elegí una zona" /></SelectTrigger>
                                <SelectContent>
                                    {zones.map((z) => <SelectItem key={z.id} value={z.name}>{z.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="col-span-2">
                            <Label htmlFor="mesa-form-branch">Sucursal</Label>
                            <select
                                id="mesa-form-branch"
                                className="w-full h-11 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={form.branch_id}
                                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                                disabled={branchesLoading || branchesError || saving}
                                data-testid="mesa-form-branch"
                            >
                                {!editing?.branch_id && <option value="">Heredar de la zona</option>}
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
                                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                        {branches.length > 0
                                            ? `La zona "${form.area}" no tiene sucursal asignada: la mesa quedará sin sucursal y el mozo, la caja y la cocina no la verán.`
                                            : `La zona "${form.area}" no tiene sucursal asignada. Esta mesa quedará sin sucursal.`}
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
                            <div className="col-span-2"><Label htmlFor="mesa-form-estado">Estado</Label>
                                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                                    <SelectTrigger id="mesa-form-estado"><SelectValue /></SelectTrigger>
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

const TABS = [
    { key: 'sucursales', label: 'Sucursales' },
    { key: 'zonas', label: 'Zonas' },
    { key: 'mesas', label: 'Mesas' },
];

export default function Local({ defaultTab = 'sucursales' }) {
    const [params] = useSearchParams();
    // `?tab=mesas` deja entrar directo al arreglo que pide el salón cuando avisa
    // que hay mesas sin sucursal.
    const requested = params?.get('tab');
    const [tab, setTab] = useState(TABS.some((t) => t.key === requested) ? requested : defaultTab);

    return (
        <div className="space-y-5" data-testid="local-root">
            <p className="page-kicker mb-1">Administración</p>
            <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Store className="h-6 w-6 text-primary" /> Local</h1>
            <p className="text-muted-foreground text-sm">Sucursales, zonas y mesas del local.</p>

            <div className="flex gap-2 flex-wrap" data-testid="local-tabs">
                {TABS.map((t) => (
                    <Button
                        key={t.key}
                        variant={tab === t.key ? 'default' : 'outline'}
                        className="h-11 sm:h-10"
                        onClick={() => setTab(t.key)}
                        data-testid={`local-tab-${t.key}`}
                    >
                        {t.label}
                    </Button>
                ))}
            </div>

            {tab === 'sucursales' && <SucursalesPanel />}
            {tab === 'zonas' && <ZonasPanel />}
            {tab === 'mesas' && <TablesManager />}
        </div>
    );
}
