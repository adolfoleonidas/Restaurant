import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, Save, Grid2X2, Plus, Pencil, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

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
            <div className="md:col-span-2 flex justify-end"><Button onClick={save} data-testid="config-save"><Save className="h-4 w-4 mr-2" />Guardar cambios</Button></div>
        </CardContent></Card>
    );
}

function Mesas() {
    const [tables, setTables] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ number: '', name: '', capacity: 4, area: 'Salón', status: 'disponible' });
    const load = async () => { const { data } = await api.get('/tables'); setTables(data); };
    useEffect(() => { load(); }, []);
    const openNew = () => { setEditing(null); setForm({ number: tables.length + 1, name: '', capacity: 4, area: 'Salón', status: 'disponible' }); setDlg(true); };
    const openEdit = (t) => { setEditing(t); setForm({ number: t.number, name: t.name, capacity: t.capacity, area: t.area, status: t.status }); setDlg(true); };
    const save = async () => {
        try {
            const payload = { ...form, number: Number(form.number), capacity: Number(form.capacity) };
            if (editing) await api.patch(`/tables/${editing.id}`, payload);
            else await api.post('/tables', payload);
            toast.success('Guardado'); setDlg(false); await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };
    const del = async (t) => {
        if (!window.confirm(`Eliminar ${t.name}?`)) return;
        try { await api.delete(`/tables/${t.id}`); toast.success('Eliminada'); await load(); }
        catch (e) { toast.error('Error'); }
    };

    return (
        <Card><CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Grid2X2 className="h-5 w-5" /> Mesas</h2>
                <Button onClick={openNew} data-testid="mesa-config-nueva"><Plus className="h-4 w-4 mr-2" />Nueva mesa</Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {tables.map((t) => (
                    <div key={t.id} className="flex items-center justify-between border rounded-xl p-3">
                        <div>
                            <div className="font-medium">{t.name}</div>
                            <div className="text-xs text-muted-foreground">{t.area} · {t.capacity} pax</div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => del(t)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                    </div>
                ))}
            </div>

            <Dialog open={dlg} onOpenChange={setDlg}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editing ? 'Editar mesa' : 'Nueva mesa'}</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3">
                        <div><Label>Número</Label><Input type="number" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} data-testid="mesa-form-number" /></div>
                        <div><Label>Nombre</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                        <div><Label>Capacidad</Label><Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
                        <div><Label>Zona</Label><Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></div>
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
                        <Button onClick={save} data-testid="mesa-form-save">Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </CardContent></Card>
    );
}

export default function Configuracion() {
    return (
        <div className="space-y-5" data-testid="config-root">
            <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Settings className="h-6 w-6 text-primary" /> Casa</h1>
            <Restaurante />
            <Mesas />
        </div>
    );
}
