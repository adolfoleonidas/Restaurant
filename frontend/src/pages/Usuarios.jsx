import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, Pencil, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS } from '@/lib/format';
import { FN_LABELS, ROLE_FUNCTIONS } from '@/lib/functions';
import { useAuth } from '@/contexts/AuthContext';

export default function Usuarios() {
    const [users, setUsers] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'mozo', phone: '', can_discount: false, can_void: false, functions: ['atencion'], branch_id: '' });
    const [branches, setBranches] = useState([]);
    const [branchesLoading, setBranchesLoading] = useState(true);
    const [branchesError, setBranchesError] = useState(false);
    const [saving, setSaving] = useState(false);
    const { user: me } = useAuth();

    const load = async () => { const { data } = await api.get('/users'); setUsers(data); };
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

    const openNew = () => { setEditing(null); setForm({ email: '', password: '', full_name: '', role: 'mozo', phone: '', can_discount: false, can_void: false, functions: ['atencion'], branch_id: '' }); setDlg(true); };
    const openEdit = (u) => { setEditing(u); setForm({ email: u.email, password: '', full_name: u.full_name, role: u.role, phone: u.phone || '', can_discount: !!u.can_discount, can_void: !!u.can_void, functions: u.functions?.length ? u.functions : (ROLE_FUNCTIONS[u.role] || []), branch_id: u.branch_id || '' }); setDlg(true); };

    const save = async () => {
        if (saving) return;
        setSaving(true);
        try {
            if (editing) {
                const payload = { full_name: form.full_name, role: form.role, phone: form.phone, can_discount: form.can_discount, can_void: form.can_void, functions: form.functions };
                if (form.password) payload.password = form.password;
                if (form.branch_id && form.branch_id !== (editing.branch_id || '')) payload.branch_id = form.branch_id;
                await api.patch(`/users/${editing.id}`, payload);
                toast.success('Actualizado');
            } else {
                const { branch_id, ...payload } = form;
                if (branch_id) payload.branch_id = branch_id;
                await api.post('/users', payload);
                toast.success('Creado');
            }
            setDlg(false); await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
        finally { setSaving(false); }
    };
    const del = async (u) => {
        if (!window.confirm(`Eliminar a "${u.full_name}"?`)) return;
        try { await api.delete(`/users/${u.id}`); toast.success('Eliminado'); await load(); }
        catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };
    const toggleActive = async (u) => {
        try { await api.patch(`/users/${u.id}`, { status: u.status === 'active' ? 'inactive' : 'active' }); await load(); }
        catch (e) { toast.error('Error'); }
    };

    return (
        <div className="space-y-5" data-testid="usuarios-root">
            <div className="flex items-center justify-between">
                <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Users className="h-6 w-6 text-primary" /> Equipo</h1>
                <Button onClick={openNew} data-testid="usuario-nuevo-button"><Plus className="h-4 w-4 mr-2" />Nuevo usuario</Button>
            </div>
            <Card><CardContent className="p-0">
                <div className="divide-y">
                    {users.map((u) => (
                        <div key={u.id} className="p-4 flex flex-wrap items-center gap-3 justify-between">
                            <div>
                                <div className="font-medium">{u.full_name} {u.id === me.id && <span className="text-xs text-muted-foreground">(tú)</span>}</div>
                                <div className="text-xs text-muted-foreground">{u.email} · {(u.functions?.length ? u.functions : ROLE_FUNCTIONS[u.role] || []).map((f) => FN_LABELS[f] || f).join(', ')}{u.branch_id && <span> · {branches.find((branch) => branch.id === u.branch_id)?.name || u.branch_id}</span>}</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1 text-xs"><Switch checked={u.status === 'active'} onCheckedChange={() => toggleActive(u)} /> {u.status === 'active' ? 'Activo' : 'Inactivo'}</label>
                                <Button size="icon" variant="ghost" onClick={() => openEdit(u)} aria-label={`Editar ${u.full_name}`}><Pencil className="h-4 w-4" /></Button>
                                {u.id !== me.id && (<Button size="icon" variant="ghost" onClick={() => del(u)}><Trash2 className="h-4 w-4 text-destructive" /></Button>)}
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent></Card>

            <Dialog open={dlg} onOpenChange={setDlg}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editing ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div><Label>Nombre completo</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} data-testid="usuario-form-name" /></div>
                        <div><Label>Teléfono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                        <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!editing} data-testid="usuario-form-email" /></div>
                        <div>
                            <Label>Rol</Label>
                            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v, functions: ROLE_FUNCTIONS[v] || form.functions })}>
                                <SelectTrigger data-testid="usuario-form-rol"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="sm:col-span-2"><Label htmlFor="usuario-form-branch">Sucursal</Label>
                            <select
                                id="usuario-form-branch"
                                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={form.branch_id}
                                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                                disabled={branchesLoading || branchesError || saving}
                                data-testid="usuario-form-branch"
                            >
                                {(!editing || !form.branch_id) && <option value="">Sin asignar</option>}
                                {editing?.branch_id && !branches.some((branch) => branch.id === editing.branch_id) && <option value={editing.branch_id}>{editing.branch_id}</option>}
                                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                            </select>
                            {branchesLoading && <p className="text-xs text-muted-foreground mt-1" data-testid="usuario-branches-loading">Cargando sucursales…</p>}
                            {!branchesLoading && branchesError && <div className="flex items-center gap-2 mt-1"><p className="text-xs text-muted-foreground">No se pudo cargar la lista. Los cambios de sucursal están deshabilitados.</p><Button type="button" size="sm" variant="outline" onClick={loadBranches} disabled={saving} data-testid="usuario-branches-retry">Reintentar</Button></div>}
                            {!branchesLoading && !branchesError && branches.length === 0 && <p className="text-xs text-muted-foreground mt-1">No hay sucursales configuradas.</p>}
                        </div>
                        <div className="sm:col-span-2"><Label>{editing ? 'Nueva contraseña (dejar vacío para mantener)' : 'Contraseña'}</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="usuario-form-pass" /></div>
                        <div className="sm:col-span-2 space-y-2 text-sm">
                            <div className="text-xs text-muted-foreground">Funciones (se pueden combinar)</div>
                            {Object.entries(FN_LABELS).map(([k, lab]) => (
                                <label key={k} className="flex items-center gap-2">
                                    <Switch
                                        checked={(form.functions || []).includes(k)}
                                        onCheckedChange={(on) => {
                                            const cur = new Set(form.functions || []);
                                            if (on) cur.add(k); else cur.delete(k);
                                            setForm({ ...form, functions: [...cur] });
                                        }}
                                    /> {lab}
                                </label>
                            ))}
                        </div>
                        {form.role !== 'admin' && (
                            <div className="sm:col-span-2 space-y-2 text-sm">
                                <label className="flex items-center gap-2"><Switch checked={form.can_discount} onCheckedChange={(v) => setForm({ ...form, can_discount: v })} /> Puede aplicar descuentos</label>
                                <label className="flex items-center gap-2"><Switch checked={form.can_void} onCheckedChange={(v) => setForm({ ...form, can_void: v })} /> Puede anular cobros o devolver dinero</label>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDlg(false)}>Cancelar</Button>
                        <Button onClick={save} disabled={saving} data-testid="usuario-form-save">{saving ? 'Guardando…' : 'Guardar'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
