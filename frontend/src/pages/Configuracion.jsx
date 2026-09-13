import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, Save, Grid2X2, Plus, Pencil, Trash2, MapPin } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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

function Zonas() {
    const [zones, setZones] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const load = async () => { const { data } = await api.get('/zones'); setZones(data); };
    useEffect(() => { load(); }, []);
    const openNew = () => { setEditing(null); setName(''); setDlg(true); };
    const openEdit = (z) => { setEditing(z); setName(z.name); setDlg(true); };
    const save = async () => {
        try {
            if (editing) await api.patch(`/zones/${editing.id}`, { name });
            else await api.post('/zones', { name });
            toast.success('Guardado'); setDlg(false); await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };
    const del = async (z) => {
        if (!window.confirm(`Eliminar la zona «${z.name}»?`)) return;
        try { await api.delete(`/zones/${z.id}`); toast.success('Zona eliminada'); await load(); }
        catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    return (
        <Card><CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-lg font-semibold flex items-center gap-2"><MapPin className="h-5 w-5" /> Zonas del salón</h2>
                <Button onClick={openNew} data-testid="zona-config-nueva"><Plus className="h-4 w-4 mr-2" />Nueva zona</Button>
            </div>
            {zones.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Sin zonas. Creá una para agrupar las mesas (ej: Salón, Terraza).</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {zones.map((z) => (
                        <div key={z.id} className="flex items-center justify-between border rounded-xl p-3">
                            <div className="font-medium">{z.name}</div>
                            <div className="flex items-center gap-1">
                                <Button size="icon" variant="ghost" onClick={() => openEdit(z)}><Pencil className="h-4 w-4" /></Button>
                                <Button size="icon" variant="ghost" onClick={() => del(z)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={dlg} onOpenChange={setDlg}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editing ? 'Editar zona' : 'Nueva zona'}</DialogTitle></DialogHeader>
                    <div><Label>Nombre</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Terraza" data-testid="zona-form-name" /></div>
                    <p className="text-xs text-muted-foreground">Al renombrar una zona, las mesas que la usan se actualizan solas.</p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDlg(false)}>Cancelar</Button>
                        <Button onClick={save} disabled={!name.trim()} data-testid="zona-form-save">Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </CardContent></Card>
    );
}

function Mesas() {
    const [tables, setTables] = useState([]);
    const [zones, setZones] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ number: '', name: '', capacity: 4, area: 'Salón', status: 'disponible' });
    const load = async () => {
        const [t, z] = await Promise.all([api.get('/tables'), api.get('/zones')]);
        setTables(t.data); setZones(z.data);
    };
    useEffect(() => { load(); }, []);
    const defaultArea = () => (zones[0]?.name || 'Salón');
    const openNew = () => { setEditing(null); setForm({ number: tables.length + 1, name: '', capacity: 4, area: defaultArea(), status: 'disponible' }); setDlg(true); };
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
                        <div><Label>Zona</Label>
                            <Select value={form.area} onValueChange={(v) => setForm({ ...form, area: v })}>
                                <SelectTrigger data-testid="mesa-form-area"><SelectValue placeholder="Elegí una zona" /></SelectTrigger>
                                <SelectContent>
                                    {zones.map((z) => <SelectItem key={z.id} value={z.name}>{z.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
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
            <Zonas />
            <Mesas />
        </div>
    );
}
