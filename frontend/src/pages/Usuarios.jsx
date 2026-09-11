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
import { useAuth } from '@/contexts/AuthContext';

export default function Usuarios() {
    const [users, setUsers] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'mozo', phone: '', can_discount: false, can_void: false });
    const { user: me } = useAuth();

    const load = async () => { const { data } = await api.get('/users'); setUsers(data); };
    useEffect(() => { load(); }, []);

    const openNew = () => { setEditing(null); setForm({ email: '', password: '', full_name: '', role: 'mozo', phone: '', can_discount: false, can_void: false }); setDlg(true); };
    const openEdit = (u) => { setEditing(u); setForm({ email: u.email, password: '', full_name: u.full_name, role: u.role, phone: u.phone || '', can_discount: !!u.can_discount, can_void: !!u.can_void }); setDlg(true); };

    const save = async () => {
        try {
            if (editing) {
                const payload = { full_name: form.full_name, role: form.role, phone: form.phone, can_discount: form.can_discount, can_void: form.can_void };
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
                                <div className="text-xs text-muted-foreground">{u.email} · {ROLE_LABELS[u.role]}{u.phone ? ` · ${u.phone}` : ''}</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1 text-xs"><Switch checked={u.status === 'active'} onCheckedChange={() => toggleActive(u)} /> {u.status === 'active' ? 'Activo' : 'Inactivo'}</label>
                                <Button size="icon" variant="ghost" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
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
                            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                                <SelectTrigger data-testid="usuario-form-rol"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="sm:col-span-2"><Label>{editing ? 'Nueva contraseña (dejar vacío para mantener)' : 'Contraseña'}</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="usuario-form-pass" /></div>
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
        </div>
    );
}
