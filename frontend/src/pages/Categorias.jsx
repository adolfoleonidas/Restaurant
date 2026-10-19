import React, { useState } from 'react';
import { createCategory, deleteCategory, listCategories, updateCategory } from '@/lib/api/categories';
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
import PendingButton from '@/components/ui/pending-button';
import usePendingAction from '@/hooks/usePendingAction';
import useLoader from '@/hooks/useLoader';
import LoadState from '@/components/LoadState';

export default function Categorias() {
    const [cats, setCats] = useState([]);
    const [dlg, setDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ name: '', description: '', sort_order: 0 });
    const [confirmDel, setConfirmDel] = useState(null);
    const [run, busy] = usePendingAction();

    const { load, retry, loading, error, hasData } = useLoader(async () => { const { data } = await listCategories(); setCats(data); });

    const openNew = () => { setEditing(null); setForm({ name: '', description: '', sort_order: cats.length + 1 }); setDlg(true); };
    const openEdit = (c) => { setEditing(c); setForm({ name: c.name, description: c.description || '', sort_order: c.sort_order }); setDlg(true); };
    const save = () => run('save', async () => {
        const payload = { ...form, sort_order: Number(form.sort_order) };
        if (editing) { await updateCategory(editing.id, payload); toast.success('Actualizado'); }
        else { await createCategory(payload); toast.success('Creado'); }
        setDlg(false); await load();
    }, { errorMessage: 'No se pudo guardar la categoría. Revisa tu conexión y reintenta.' });
    const doDelete = (c) => run('delete', async () => {
        try { await deleteCategory(c.id); toast.success('Eliminada'); await load(); }
        finally { setConfirmDel(null); }
    }, { errorMessage: 'No se pudo eliminar la categoría. Revisa tu conexión y reintenta.' });

    return (
        <div className="space-y-5" data-testid="categorias-root">
            <p className="page-kicker mb-1">Administración</p>
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="min-w-0">
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2 min-w-0"><Tags className="h-6 w-6 text-primary shrink-0" /> <span className="truncate">Categorías</span></h1>
                    <p className="text-muted-foreground text-sm">Organiza los platos de la carta en grupos.</p>
                </div>
                <Button onClick={openNew} data-testid="categoria-nuevo-button"><Plus className="h-4 w-4 mr-2" />Nueva</Button>
            </div>
            <LoadState loading={loading} error={error} hasData={hasData} onRetry={retry} testId="categorias" errorText="No se pudieron cargar las categorías. Revisa tu conexión y reintenta.">
            <Card><CardContent className="p-0">
                <div className="divide-y">
                    {cats.map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-3 p-4">
                            <div className="min-w-0">
                                <div className="font-medium truncate">{c.name}</div>
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
            </LoadState>

            <Dialog open={dlg} onOpenChange={setDlg}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editing ? 'Editar categoría' : 'Nueva categoría'}</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                        <div><Label htmlFor="categoria-form-nombre">Nombre</Label><Input id="categoria-form-nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="categoria-form-name" /></div>
                        <div><Label htmlFor="categoria-form-descripcion">Descripción</Label><Textarea id="categoria-form-descripcion" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                        <div><Label htmlFor="categoria-form-orden">Orden</Label><Input id="categoria-form-orden" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDlg(false)}>Cancelar</Button>
                        <PendingButton onClick={save} pending={busy.has('save')} pendingLabel="Guardando…" data-testid="categoria-form-save">Guardar</PendingButton>
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
                        <AlertDialogAction
                            variant="destructive"
                            disabled={busy.has('delete')}
                            aria-busy={busy.has('delete') ? 'true' : undefined}
                            onClick={(e) => { e.preventDefault(); doDelete(confirmDel); }}
                        >
                            {busy.has('delete') ? 'Eliminando…' : 'Eliminar'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
