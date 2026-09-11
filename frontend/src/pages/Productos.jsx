import React, { useState, useEffect, useMemo } from 'react';
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
import { Plus, Pencil, Trash2, Package, Layers } from 'lucide-react';
import { toast } from 'sonner';

const emptyProduct = {
    name: '', description: '', price: '', category_id: '', preparation_time: 15,
    image_url: '', is_available: true, is_combo: false, combo_items: [], code: '',
};
const emptyCombo = {
    name: '', code: '', description: '', price: '', preparation_time: 20,
    image_url: '', is_available: true, is_combo: true, combo_items: [], category_id: '',
};

export default function Productos({ section = 'platos' }) {
    const [tab, setTab] = useState(section);
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [openDlg, setOpenDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyProduct);

    const load = async () => {
        const [p, c] = await Promise.all([api.get('/products'), api.get('/categories')]);
        setProducts(p.data); setCategories(c.data);
    };
    useEffect(() => { load(); }, []);
    useEffect(() => { setTab(section); }, [section]);

    const simples = useMemo(() => products.filter((p) => !p.is_combo), [products]);
    const combos = useMemo(() => products.filter((p) => p.is_combo), [products]);
    const visible = tab === 'combos' ? combos : simples;

    const productName = (id) => simples.find((p) => p.id === id)?.name || 'Producto';

    const openNew = () => {
        setEditing(null);
        setForm(tab === 'combos'
            ? { ...emptyCombo }
            : { ...emptyProduct, category_id: categories.find((c) => c.slug !== 'combos')?.id || categories[0]?.id || '' });
        setOpenDlg(true);
    };

    const openEdit = (p) => {
        setEditing(p);
        setForm({
            name: p.name || '',
            code: p.code || '',
            description: p.description || '',
            price: String(p.price ?? ''),
            category_id: p.category_id,
            preparation_time: p.preparation_time,
            image_url: p.image_url || '',
            is_available: p.is_available,
            is_combo: Boolean(p.is_combo),
            combo_items: p.combo_items || [],
        });
        setOpenDlg(true);
    };

    const save = async () => {
        if (!form.name.trim()) {
            toast.error(tab === 'combos' ? 'Poné un nombre al combo' : 'Poné un nombre al plato');
            return;
        }
        if (form.is_combo && !(form.combo_items || []).length) {
            toast.error('Agregá al menos un plato al combo');
            return;
        }
        try {
            const payload = {
                ...form,
                price: Number(form.price),
                preparation_time: Number(form.preparation_time),
                code: form.code.trim() || null,
                combo_items: form.is_combo ? (form.combo_items || []).filter((c) => c.product_id && Number(c.quantity) > 0) : [],
            };
            if (editing) {
                await api.patch(`/products/${editing.id}`, payload);
                toast.success(form.is_combo ? 'Combo actualizado' : 'Producto actualizado');
            } else {
                await api.post('/products', payload);
                toast.success(form.is_combo ? 'Combo creado' : 'Producto creado');
            }
            setOpenDlg(false);
            await load();
        } catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const del = async (p) => {
        if (!window.confirm(`Eliminar "${p.name}"?`)) return;
        try { await api.delete(`/products/${p.id}`); toast.success('Eliminado'); await load(); }
        catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    const toggleAvail = async (p) => {
        try { await api.patch(`/products/${p.id}`, { is_available: !p.is_available }); await load(); }
        catch (e) { toast.error('Error'); }
    };

    const setComboLine = (idx, patch) => {
        const copy = [...form.combo_items];
        copy[idx] = { ...copy[idx], ...patch };
        setForm({ ...form, combo_items: copy });
    };

    return (
        <div className="space-y-5" data-testid="productos-root">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Carta</p>
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2">
                        {tab === 'combos' ? <Layers className="h-6 w-6 text-primary" /> : <Package className="h-6 w-6 text-primary" />}
                        {tab === 'combos' ? 'Combos' : 'Platos'}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {tab === 'combos'
                            ? 'Menús armados, con nombre propio y los platos que incluyen.'
                            : 'Platos sueltos de la carta.'}
                    </p>
                </div>
                <Button onClick={openNew} data-testid={tab === 'combos' ? 'combo-nuevo-button' : 'producto-nuevo-button'}>
                    <Plus className="h-4 w-4 mr-2" /> {tab === 'combos' ? 'Nuevo combo' : 'Nuevo producto'}
                </Button>
            </div>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => setTab('platos')}
                    className={`px-4 py-2 rounded-sm text-sm font-medium border ${tab === 'platos' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary'}`}
                >
                    Platos ({simples.length})
                </button>
                <button
                    type="button"
                    onClick={() => setTab('combos')}
                    className={`px-4 py-2 rounded-sm text-sm font-medium border ${tab === 'combos' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary'}`}
                    data-testid="tab-combos"
                >
                    Combos ({combos.length})
                </button>
            </div>

            {visible.length === 0 ? (
                <Card><CardContent className="py-14 text-center text-muted-foreground">
                    {tab === 'combos' ? 'Todavía no hay combos. Creá uno con nombre y los platos que incluye.' : 'No hay platos en la carta.'}
                </CardContent></Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {visible.map((p) => {
                        const cat = categories.find((c) => c.id === p.category_id);
                        return (
                            <Card key={p.id}><CardContent className="p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        {p.code && <div className="page-kicker mb-1">{p.code}</div>}
                                        <div className="font-display italic text-lg font-semibold">{p.name}</div>
                                        <div className="text-xs text-muted-foreground">{p.is_combo ? 'Combo' : (cat?.name || '—')} · {p.preparation_time} min</div>
                                    </div>
                                    <span className="font-mono text-lg font-bold tabular-nums text-primary">{fmtMoney(p.price)}</span>
                                </div>
                                {p.description && <div className="text-sm text-muted-foreground mt-2 line-clamp-2">{p.description}</div>}
                                {p.is_combo && (
                                    <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
                                        {(p.combo_items || []).map((c, i) => (
                                            <li key={i}>{c.quantity}× {productName(c.product_id)}</li>
                                        ))}
                                    </ul>
                                )}
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
            )}

            <Dialog open={openDlg} onOpenChange={setOpenDlg}>
                <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {form.is_combo
                                ? (editing ? 'Editar combo' : 'Nuevo combo')
                                : (editing ? 'Editar producto' : 'Nuevo producto')}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                            <Label>{form.is_combo ? 'Nombre del combo *' : 'Nombre *'}</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder={form.is_combo ? 'Ej: Combo almuerzo criollo' : 'Ej: Ceviche clásico'}
                                data-testid="producto-form-name"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Label>{form.is_combo ? 'Código / identificador' : 'Código (opcional)'}</Label>
                            <Input
                                value={form.code}
                                onChange={(e) => setForm({ ...form, code: e.target.value })}
                                placeholder={form.is_combo ? 'Ej: ALM-01' : 'Ej: CE-01'}
                                data-testid="producto-form-code"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Label>Descripción</Label>
                            <Textarea
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                placeholder={form.is_combo ? 'Qué incluye y para quién es' : ''}
                            />
                        </div>
                        <div><Label>Precio (S/)</Label><Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="producto-form-price" /></div>
                        <div><Label>Tiempo prep. (min)</Label><Input type="number" min="1" value={form.preparation_time} onChange={(e) => setForm({ ...form, preparation_time: e.target.value })} /></div>
                        {!form.is_combo && (
                            <div className="sm:col-span-2">
                                <Label>Categoría</Label>
                                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                                    <SelectTrigger data-testid="producto-form-category"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                                    <SelectContent>
                                        {categories.filter((c) => c.slug !== 'combos').map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="sm:col-span-2"><Label>URL imagen (opcional)</Label><Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></div>
                        {form.is_combo && (
                            <div className="sm:col-span-2 space-y-2 border border-border rounded-sm p-3">
                                <div className="font-medium text-sm">Platos que incluye</div>
                                <p className="text-xs text-muted-foreground">Cada línea es un producto de la carta, con cantidad.</p>
                                {(form.combo_items || []).map((line, idx) => (
                                    <div key={idx} className="flex gap-2">
                                        <Select value={line.product_id} onValueChange={(v) => setComboLine(idx, { product_id: v })}>
                                            <SelectTrigger className="flex-1"><SelectValue placeholder="Elegí un plato" /></SelectTrigger>
                                            <SelectContent>
                                                {simples.filter((p) => p.id !== editing?.id).map((p) => (
                                                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Input
                                            type="number"
                                            min="1"
                                            className="w-20"
                                            value={line.quantity}
                                            onChange={(e) => setComboLine(idx, { quantity: Number(e.target.value) })}
                                        />
                                        <Button type="button" variant="ghost" size="icon" onClick={() => setForm({ ...form, combo_items: form.combo_items.filter((_, i) => i !== idx) })}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        if (!simples.length) { toast.error('Primero creá platos en la carta'); return; }
                                        setForm({ ...form, combo_items: [...(form.combo_items || []), { product_id: simples[0].id, quantity: 1 }] });
                                    }}
                                >
                                    <Plus className="h-4 w-4 mr-1" /> Agregar plato
                                </Button>
                            </div>
                        )}
                        <label className="flex items-center gap-2 text-sm"><Switch checked={form.is_available} onCheckedChange={(v) => setForm({ ...form, is_available: v })} /> Disponible</label>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpenDlg(false)}>Cancelar</Button>
                        <Button onClick={save} data-testid="producto-form-save">{editing ? 'Guardar' : (form.is_combo ? 'Crear combo' : 'Crear')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
