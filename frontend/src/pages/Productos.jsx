import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtMoney } from '@/lib/format';
import { Plus, Pencil, Trash2, Package } from 'lucide-react';
import { toast } from 'sonner';

export default function Productos() {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [openDlg, setOpenDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ name: '', description: '', price: '', category_id: '', preparation_time: 15, image_url: '', is_available: true });

    const load = async () => {
        const [p, c] = await Promise.all([api.get('/products'), api.get('/categories')]);
        setProducts(p.data); setCategories(c.data);
    };
    useEffect(() => { load(); }, []);

    const openNew = () => {
        setEditing(null);
        setForm({ name: '', description: '', price: '', category_id: categories[0]?.id || '', preparation_time: 15, image_url: '', is_available: true });
        setOpenDlg(true);
    };

    const openEdit = (p) => {
        setEditing(p);
        setForm({
            name: p.name, description: p.description || '', price: String(p.price),
            category_id: p.category_id, preparation_time: p.preparation_time, image_url: p.image_url || '',
            is_available: p.is_available,
        });
        setOpenDlg(true);
    };

    const save = async () => {
        try {
            const payload = { ...form, price: Number(form.price), preparation_time: Number(form.preparation_time) };
            if (editing) {
                await api.patch(`/products/${editing.id}`, payload);
                toast.success('Producto actualizado');
            } else {
                await api.post('/products', payload);
                toast.success('Producto creado');
            }
            setOpenDlg(false);
            await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const del = async (p) => {
        if (!window.confirm(`Eliminar producto "${p.name}"?`)) return;
        try { await api.delete(`/products/${p.id}`); toast.success('Eliminado'); await load(); }
        catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const toggleAvail = async (p) => {
        try { await api.patch(`/products/${p.id}`, { is_available: !p.is_available }); await load(); }
        catch (e) { toast.error('Error'); }
    };

    return (
        <div className="space-y-5" data-testid="productos-root">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <h1 className="font-display text-2xl font-semibold flex items-center gap-2"><Package className="h-6 w-6" /> Productos</h1>
                <Button onClick={openNew} data-testid="producto-nuevo-button"><Plus className="h-4 w-4 mr-2" /> Nuevo producto</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {products.map((p) => {
                    const cat = categories.find((c) => c.id === p.category_id);
                    return (
                        <Card key={p.id}><CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <div className="font-semibold">{p.name}</div>
                                    <div className="text-xs text-muted-foreground">{cat?.name || '—'} · {p.preparation_time} min</div>
                                </div>
                                <span className="font-display text-lg font-bold tabular-nums">{fmtMoney(p.price)}</span>
                            </div>
                            {p.description && <div className="text-sm text-muted-foreground mt-2 line-clamp-2">{p.description}</div>}
                            <div className="mt-3 flex items-center justify-between">
                                <label className="flex items-center gap-2 text-sm"><Switch checked={p.is_available} onCheckedChange={() => toggleAvail(p)} data-testid={`producto-disp-${p.id}`} /> {p.is_available ? 'Disponible' : 'Agotado'}</label>
                                <div className="flex items-center gap-1">
                                    <Button size="icon" variant="ghost" onClick={() => openEdit(p)} data-testid={`producto-edit-${p.id}`}><Pencil className="h-4 w-4" /></Button>
                                    <Button size="icon" variant="ghost" onClick={() => del(p)} data-testid={`producto-del-${p.id}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                </div>
                            </div>
                        </CardContent></Card>
                    );
                })}
            </div>

            <Dialog open={openDlg} onOpenChange={setOpenDlg}>
                <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>{editing ? 'Editar producto' : 'Nuevo producto'}</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2"><Label>Nombre</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="producto-form-name" /></div>
                        <div className="sm:col-span-2"><Label>Descripción</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                        <div><Label>Precio (S/)</Label><Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="producto-form-price" /></div>
                        <div><Label>Tiempo prep. (min)</Label><Input type="number" min="1" value={form.preparation_time} onChange={(e) => setForm({ ...form, preparation_time: e.target.value })} /></div>
                        <div className="sm:col-span-2">
                            <Label>Categoría</Label>
                            <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                                <SelectTrigger data-testid="producto-form-category"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                                <SelectContent>
                                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="sm:col-span-2"><Label>URL imagen (opcional)</Label><Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></div>
                        <label className="flex items-center gap-2 text-sm"><Switch checked={form.is_available} onCheckedChange={(v) => setForm({ ...form, is_available: v })} /> Disponible</label>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpenDlg(false)}>Cancelar</Button>
                        <Button onClick={save} data-testid="producto-form-save">{editing ? 'Guardar' : 'Crear'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
