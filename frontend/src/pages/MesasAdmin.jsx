import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Grid2X2, Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import TableQrActions from '@/components/TableQrActions';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Mesas — independent management module (split out of Configuración).
 * Handles table CRUD, zone inheritance, branch assignment and QR actions.
 * Settings (restaurant, theme, branches, zones, data reset) stay in Configuración.
 */

const TABLE_STATUS_DOT = {
    disponible: 'bg-green-500',
    ocupada: 'bg-red-500',
    esperando_pago: 'bg-amber-500',
    reservada: 'bg-blue-500',
    inactiva: 'bg-gray-400',
    pagada: 'bg-emerald-400',
};

function TablesManager() {
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
        try {
            const [t, z] = await Promise.all([api.get('/tables'), api.get('/zones')]);
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

export default function Mesas() {
    return (
        <div className="space-y-5" data-testid="mesas-admin-root">
            <p className="page-kicker mb-1">Administración</p>
            <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><Grid2X2 className="h-6 w-6 text-primary" /> Mesas</h1>
            <p className="text-muted-foreground text-sm">Alta, edición, sucursal y códigos QR de las mesas del salón.</p>
            <TablesManager />
        </div>
    );
}
