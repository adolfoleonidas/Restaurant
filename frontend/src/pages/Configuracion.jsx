import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, Save, Grid2X2, Plus, Pencil, Trash2, MapPin, AlertTriangle, Building2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TABLE_STATUS_LABELS } from '@/lib/format';
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
        <Card><CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-primary" />
                <div>
                    <h2 className="font-display text-lg font-semibold">Datos del restaurante</h2>
                    <p className="text-xs text-muted-foreground">Información que aparece en los comprobantes y la carta web.</p>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            </div>
            <div className="flex justify-end"><Button onClick={save} data-testid="config-save"><Save className="h-4 w-4 mr-2" />Guardar cambios</Button></div>
        </CardContent></Card>
    );
}

function Zonas() {
    const [zones, setZones] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(null);
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
    const doDelete = async () => {
        if (!confirmDelete) return;
        try { await api.delete(`/zones/${confirmDelete.id}`); toast.success('Zona eliminada'); await load(); }
        catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
        finally { setConfirmDelete(null); }
    };

    return (
        <Card><CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <MapPin className="h-5 w-5 text-primary" />
                    <div>
                        <h2 className="font-display text-lg font-semibold">Zonas del salón</h2>
                        <p className="text-xs text-muted-foreground">{zones.length} {zones.length === 1 ? 'zona' : 'zonas'} configuradas</p>
                    </div>
                </div>
                <Button onClick={openNew} data-testid="zona-config-nueva"><Plus className="h-4 w-4 mr-2" />Nueva zona</Button>
            </div>
            {zones.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-border rounded-sm">
                    Sin zonas todavía. Creá una para agrupar las mesas (ej: Salón, Terraza).
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {zones.map((z) => (
                        <div key={z.id} className="flex items-center justify-between border rounded-sm p-3">
                            <div className="font-medium">{z.name}</div>
                            <div className="flex items-center gap-1">
                                <Button size="icon" variant="ghost" onClick={() => openEdit(z)}><Pencil className="h-4 w-4" /></Button>
                                <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(z)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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

            <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Eliminar zona «{confirmDelete?.name}»</AlertDialogTitle>
                        <AlertDialogDescription>Las mesas asignadas a esta zona quedarán sin zona. Esta acción no se puede deshacer.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={doDelete} data-testid="zona-confirm-delete">Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </CardContent></Card>
    );
}

const TABLE_STATUS_DOT = {
    disponible: '#22C55E', ocupada: '#EF4444', esperando_pago: '#F59E0B',
    reservada: '#8B5CF6', inactiva: '#71717A',
};

function Mesas() {
    const [tables, setTables] = useState([]);
    const [zones, setZones] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ number: '', name: '', capacity: 4, area: 'Salón', status: 'disponible' });
    const [confirmDelete, setConfirmDelete] = useState(null);
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
    const doDelete = async () => {
        if (!confirmDelete) return;
        try { await api.delete(`/tables/${confirmDelete.id}`); toast.success('Mesa eliminada'); await load(); }
        catch (e) { toast.error('Error'); }
        finally { setConfirmDelete(null); }
    };

    return (
        <Card><CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Grid2X2 className="h-5 w-5 text-primary" />
                    <div>
                        <h2 className="font-display text-lg font-semibold">Mesas</h2>
                        <p className="text-xs text-muted-foreground">{tables.length} {tables.length === 1 ? 'mesa' : 'mesas'} registradas</p>
                    </div>
                </div>
                <Button onClick={openNew} data-testid="mesa-config-nueva"><Plus className="h-4 w-4 mr-2" />Nueva mesa</Button>
            </div>
            {tables.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-border rounded-sm">
                    No hay mesas. Creá la primera para empezar a operar.
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {tables.map((t) => (
                        <div key={t.id} className="flex items-center justify-between border rounded-sm p-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: TABLE_STATUS_DOT[t.status] || '#71717A' }} />
                                <div className="min-w-0">
                                    <div className="font-medium truncate">{t.name}</div>
                                    <div className="text-xs text-muted-foreground">{t.area} · {t.capacity} pax · {TABLE_STATUS_LABELS[t.status] || t.status}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Pencil className="h-4 w-4" /></Button>
                                <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(t)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

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
                                        {['disponible', 'ocupada', 'esperando_pago', 'reservada', 'inactiva'].map((s) => <SelectItem key={s} value={s}>{TABLE_STATUS_LABELS[s] || s}</SelectItem>)}
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

            <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Eliminar {confirmDelete?.name}</AlertDialogTitle>
                        <AlertDialogDescription>Esta mesa se elimina del sistema. Los pedidos anteriores quedan en el historial.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={doDelete} data-testid="mesa-confirm-delete">Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </CardContent></Card>
    );
}

function EntregaLimpia() {
    const [confirmation, setConfirmation] = useState('');
    const submit = async () => {
        try {
            await api.post('/restaurants/current/handoff', { confirmation });
            toast.success('Sistema listo para el cliente nuevo');
            window.location.reload();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error');
        }
    };
    return (
        <Card className="border-destructive/40"><CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-sm bg-destructive/10 flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                    <h2 className="font-display text-lg font-semibold text-destructive">Entregar limpio</h2>
                    <p className="text-xs text-muted-foreground">Acción irreversible — solo al cambiar de cliente.</p>
                </div>
            </div>
            <div className="rounded-sm bg-destructive/5 border border-destructive/20 p-3 text-sm text-muted-foreground">
                Esto borra la carta, las mesas, los pedidos, los pagos, la caja y al resto del personal. Quedan el administrador actual y una casa en blanco para el cliente nuevo.
            </div>
            <div>
                <Label>Confirmación</Label>
                <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} data-testid="handoff-confirmation" autoComplete="off" placeholder="Escribí ENTREGAR LIMPIO" />
            </div>
            <div className="flex justify-end">
                <Button variant="destructive" onClick={submit} disabled={confirmation !== 'ENTREGAR LIMPIO'} data-testid="handoff-submit">Entregar limpio</Button>
            </div>
        </CardContent></Card>
    );
}

export default function Configuracion() {
    return (
        <div className="space-y-6" data-testid="config-root">
            <div>
                <p className="page-kicker mb-1">Administración</p>
                <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Settings className="h-6 w-6 text-primary" /> Casa</h1>
                <p className="text-sm text-muted-foreground mt-1">Configuración del restaurante, zonas, mesas y operaciones de servicio.</p>
            </div>
            <Restaurante />
            <Zonas />
            <Mesas />
            <EntregaLimpia />
        </div>
    );
}
