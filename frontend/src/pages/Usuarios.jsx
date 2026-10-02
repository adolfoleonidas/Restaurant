import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS } from '@/lib/format';
import { FN_LABELS, ROLE_FUNCTIONS } from '@/lib/functions';
import { useAuth } from '@/contexts/AuthContext';

const ROLE_BADGE_CLASS = {
    admin: 'bg-primary/10 text-primary border-primary/20',
    cajero: 'bg-blue-50 text-blue-700 border-blue-200',
    mozo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cocina: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function Usuarios() {
    const [users, setUsers] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'mozo', phone: '', can_discount: false, can_void: false, functions: ['atencion'] });
    const [confirmDelete, setConfirmDelete] = useState(null);
    const { user: me } = useAuth();

    const load = async () => { const { data } = await api.get('/users'); setUsers(data); };
    useEffect(() => { load(); }, []);

    const openNew = () => { setEditing(null); setForm({ email: '', password: '', full_name: '', role: 'mozo', phone: '', can_discount: false, can_void: false, functions: ['atencion'] }); setDlg(true); };
    const openEdit = (u) => { setEditing(u); setForm({ email: u.email, password: '', full_name: u.full_name, role: u.role, phone: u.phone || '', can_discount: !!u.can_discount, can_void: !!u.can_void, functions: u.functions?.length ? u.functions : (ROLE_FUNCTIONS[u.role] || []) }); setDlg(true); };

    const save = async () => {
        try {
            if (editing) {
                const payload = { full_name: form.full_name, role: form.role, phone: form.phone, can_discount: form.can_discount, can_void: form.can_void, functions: form.functions };
                if (form.password) payload.password = form.password;
                await api.patch(`/users/${editing.id}`, payload);
                toast.success('Actualizado');
            } else {
                await api.post('/users', form);
                toast.success('Creado');
            }
            setDlg(false); await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };
    const doDelete = async () => {
        if (!confirmDelete) return;
        try { await api.delete(`/users/${confirmDelete.id}`); toast.success('Usuario eliminado'); await load(); }
        catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
        finally { setConfirmDelete(null); }
    };
    const toggleActive = async (u) => {
        try { await api.patch(`/users/${u.id}`, { status: u.status === 'active' ? 'inactive' : 'active' }); await load(); }
        catch (e) { toast.error('Error'); }
    };

    const activeCount = users.filter((u) => u.status === 'active').length;

    return (
        <div className="space-y-6" data-testid="usuarios-root">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Administración</p>
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Users className="h-6 w-6 text-primary" /> Equipo</h1>
                    <p className="text-sm text-muted-foreground mt-1">{users.length} {users.length === 1 ? 'persona' : 'personas'} · {activeCount} {activeCount === 1 ? 'activa' : 'activas'}</p>
                </div>
                <Button onClick={openNew} data-testid="usuario-nuevo-button"><Plus className="h-4 w-4 mr-2" />Nuevo usuario</Button>
            </div>
            <Card><CardContent className="p-0">
                {users.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted-foreground border-b border-border">
                        No hay usuarios todavía. Creá el primero para empezar.
                    </div>
                ) : (
                    <div className="divide-y">
                        {users.map((u) => (
                            <div key={u.id} className="p-4 flex flex-wrap items-center gap-3 justify-between" data-testid={`usuario-row-${u.id}`}>
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${u.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                                        {u.full_name?.charAt(0)?.toUpperCase() || '?'}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium truncate">{u.full_name}</span>
                                            {u.id === me.id && <span className="text-xs text-muted-foreground">(tú)</span>}
                                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${ROLE_BADGE_CLASS[u.role] || ''}`}>{ROLE_LABELS[u.role] || u.role}</Badge>
                                        </div>
                                        <div className="text-xs text-muted-foreground truncate">{u.email} · {(u.functions?.length ? u.functions : ROLE_FUNCTIONS[u.role] || []).map((f) => FN_LABELS[f] || f).join(', ')}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label className="flex items-center gap-1.5 text-xs">
                                        <Switch checked={u.status === 'active'} onCheckedChange={() => toggleActive(u)} />
                                        <span className={u.status === 'active' ? 'text-emerald-700 font-medium' : 'text-muted-foreground'}>{u.status === 'active' ? 'Activo' : 'Inactivo'}</span>
                                    </label>
                                    <Button size="icon" variant="ghost" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
                                    {u.id !== me.id && (<Button size="icon" variant="ghost" onClick={() => setConfirmDelete(u)}><Trash2 className="h-4 w-4 text-destructive" /></Button>)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
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
                        <Button onClick={save} data-testid="usuario-form-save">Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Eliminar a «{confirmDelete?.full_name}»</AlertDialogTitle>
                        <AlertDialogDescription>El usuario pierde acceso al sistema. Los pedidos y cobros que registró quedan en el historial.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={doDelete} data-testid="usuario-confirm-delete">Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
