import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function Categorias() {
    const [cats, setCats] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ name: '', description: '', sort_order: 0 });
    const [confirmDel, setConfirmDel] = useState(null);

    const load = async () => { const { data } = await api.get('/categories'); setCats(data); };
    useEffect(() => { load(); }, []);

    const openNew = () => { setEditing(null); setForm({ name: '', description: '', sort_order: cats.length + 1 }); setDlg(true); };
    const openEdit = (c) => { setEditing(c); setForm({ name: c.name, description: c.description || '', sort_order: c.sort_order }); setDlg(true); };
    const save = async () => {
        try {
            const payload = { ...form, sort_order: Number(form.sort_order) };
            if (editing) { await api.patch(`/categories/${editing.id}`, payload); toast.success('Actualizado'); }
            else { await api.post('/categories', payload); toast.success('Creado'); }
            setDlg(false); await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo guardar la categoría. Revisá tu conexión y reintentá.'); }
    };
    const doDelete = async (c) => {
        try { await api.delete(`/categories/${c.id}`); toast.success('Eliminada'); await load(); }
        catch (e) { toast.error(e.response?.data?.detail || 'No se pudo guardar la categoría. Revisá tu conexión y reintentá.'); }
    };

    return (
        <div className="space-y-5" data-testid="categorias-root">
            <p className="page-kicker mb-1">Administración</p>
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><Tags className="h-6 w-6 text-primary" /> Categorías</h1>
                    <p className="text-muted-foreground text-sm">Organizá los platos de la carta en grupos.</p>
                </div>
                <Button onClick={openNew} data-testid="categoria-nuevo-button"><Plus className="h-4 w-4 mr-2" />Nueva</Button>
            </div>
            <Card><CardContent className="p-0">
                <div className="divide-y">
                    {cats.map((c) => (
                        <div key={c.id} className="flex items-center justify-between p-4">
                            <div>
                                <div className="font-medium">{c.name}</div>
                                <div className="text-xs text-muted-foreground">{c.description || 'Sin descripción'} · Orden: {c.sort_order}</div>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button size="icon" variant="ghost" aria-label={`Editar ${c.name}`} onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                                <Button size="icon" variant="ghost" aria-label={`Eliminar ${c.name}`} onClick={() => setConfirmDel(c)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent></Card>

            <Dialog open={dlg} onOpenChange={setDlg}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editing ? 'Editar categoría' : 'Nueva categoría'}</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                        <div><Label>Nombre</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="categoria-form-name" /></div>
                        <div><Label>Descripción</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                        <div><Label>Orden</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDlg(false)}>Cancelar</Button>
                        <Button onClick={save} data-testid="categoria-form-save">Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!confirmDel} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar categoría &quot;{confirmDel?.name}&quot;?</AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={async () => { await doDelete(confirmDel); setConfirmDel(null); }}>Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
