import React, { useState, useEffect, useMemo } from 'react';
import { listCategories } from '@/lib/api/categories';
import { createProduct, deleteProduct, importProducts, listProducts, setProductAvailability, updateProduct } from '@/lib/api/products';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtMoney, countOf } from '@/lib/format';
import { Plus, Pencil, Trash2, Package, Layers, Upload, Download, FileSpreadsheet, Tags } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useRealtimeGeneration } from '@/contexts/NotifyContext';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiErrorMessage } from '@/lib/apiError';
import PendingButton from '@/components/ui/pending-button';
import usePendingAction from '@/hooks/usePendingAction';
import useLoader from '@/hooks/useLoader';
import LoadState from '@/components/LoadState';

const emptyProduct = {
    name: '', description: '', price: '', category_id: '', preparation_time: 15,
    image_url: '', is_available: true, is_combo: false, combo_items: [], code: '',
};
const emptyCombo = {
    name: '', code: '', description: '', price: '', preparation_time: 20,
    image_url: '', is_available: true, is_combo: true, combo_items: [], category_id: '',
};

const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const COLUMN_MAP = {
    'nombre': 'name', 'name': 'name', 'plato': 'name', 'producto': 'name',
    'categoria': 'category', 'categoría': 'category', 'category': 'category',
    'precio': 'price', 'price': 'price', 'precio (s/)': 'price',
    'descripcion': 'description', 'descripción': 'description', 'description': 'description',
    'tiempo': 'preparation_time', 'tiempo (min)': 'preparation_time', 'time': 'preparation_time', 'prep': 'preparation_time',
    'imagen': 'image_url', 'imagen url': 'image_url', 'image': 'image_url', 'image url': 'image_url', 'foto': 'image_url',
    'codigo': 'code', 'código': 'code', 'code': 'code',
};

function splitDelimited(line, sep) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
            } else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === sep) { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}

function parseRows(text) {
    const lines = (text || '').split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { error: 'Pega o sube datos con encabezados (nombre, categoría, precio…).' };
    const first = lines[0].replace(/^\uFEFF/, '');
    const seps = ['\t', ';', ','];
    const counts = seps.map((s) => first.split(s).length - 1);
    const sepIdx = counts.indexOf(Math.max(...counts));
    if (Math.max(...counts) === 0) return { error: 'No se detectaron columnas. Sepáralas con tab, punto y coma o coma.' };
    const sep = seps[sepIdx];
    const header = splitDelimited(first, sep).map((h) => norm(h));
    const fields = header.map((h) => COLUMN_MAP[h] || null);
    if (!fields.includes('name') || !fields.includes('price')) {
        return { error: 'Faltan columnas: necesitas al menos «nombre» y «precio». Descarga la plantilla de ejemplo.' };
    }
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = splitDelimited(lines[i].replace(/^\uFEFF/, ''), sep);
        const row = { name: '', category: '', price: '', description: '', preparation_time: '', image_url: '', code: '' };
        fields.forEach((f, j) => { if (f) row[f] = (cells[j] || '').trim(); });
        const okName = Boolean(row.name);
        const priceNum = Number(String(row.price).replace(',', '.').replace(/[^0-9.\-]/g, ''));
        const okPrice = row.price !== '' && !Number.isNaN(priceNum) && priceNum >= 0;
        rows.push({
            name: row.name, category: row.category || 'General', price: row.price,
            description: row.description, preparation_time: row.preparation_time,
            image_url: row.image_url, code: row.code,
            ok: okName && okPrice,
            error: !okName ? 'Falta nombre' : (!okPrice ? 'Precio inválido' : ''),
        });
    }
    if (!rows.length) return { error: 'No hay filas de datos después del encabezado.' };
    return { rows };
}

function downloadTemplate() {
    const header = 'nombre;categoría;precio;descripción;tiempo;imagen;código';
    const sample = [
        'Causa Limeña;Entradas;18.00;Puré de papa amarilla con pollo;10;;CAU01',
        'Ceviche Clásico;Platos principales;38.00;Pescado fresco, limón y ají;12;https://…;CEV01',
    ];
    const csv = '\uFEFF' + [header, ...sample].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-platos.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function ImportarPlatos({ open, onOpenChange, onDone }) {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const parsed = useMemo(() => parseRows(text), [text]);
    const validRows = useMemo(
        () => ((parsed.rows || []).filter((r) => r.ok)).map((r) => ({
            name: r.name, category: r.category, price: r.price,
            description: r.description || null, preparation_time: r.preparation_time || null,
            image_url: r.image_url || null, code: r.code || null,
        })),
        [parsed]
    );

    const onFile = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => setText(String(reader.result || ''));
        reader.readAsText(f, 'utf-8');
    };

    const importNow = async () => {
        setBusy(true);
        try {
            const { data } = await importProducts({ items: validRows });
            const skipped = data.skipped?.length || 0;
            toast.success(
                skipped > 0
                    ? `${countOf(data.created.length, 'plato creado', 'platos creados')}, ${countOf(skipped, 'omitido', 'omitidos')}`
                    : countOf(data.created.length, 'plato creado', 'platos creados')
            );
            if (data.categories_created?.length) {
                toast.info(`Categorías nuevas: ${data.categories_created.join(', ')}`);
            }
            onOpenChange(false);
            setText('');
            onDone();
        } catch (err) {
            toast.error(apiErrorMessage(err, 'No se pudo importar'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* Sin max-h del llamador: anulaba el 85dvh del diálogo y en iOS la barra del navegador tapaba el pie */}
            <DialogContent className="max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Importar platos desde Excel</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground">
                            Copia las filas de tu Excel/Google Sheets y pégalas acá, o sube un archivo CSV.
                        </p>
                        <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
                            <Download className="h-4 w-4 mr-1" /> Plantilla
                        </Button>
                    </div>
                    <Textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={8}
                        placeholder={'nombre\tcategoría\tprecio\tdescripción\ttiempo\timagen\tcódigo\nCausa Limeña\tEntradas\t18.00\tPuré de papa\t10\t\tCAU01'}
                        data-testid="import-text"
                    />
                    <label className="flex items-center justify-center gap-2 border-2 border-dashed rounded-xl py-3 cursor-pointer hover:bg-secondary/30 text-sm">
                        <Upload className="h-4 w-4" /> Subir archivo CSV
                        <input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={onFile} data-testid="import-file" />
                    </label>

                    {parsed.error && <p className="text-sm text-destructive">{parsed.error}</p>}

                    {parsed.rows && (
                        <div className="border rounded-lg overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 bg-secondary/50 text-xs font-medium">
                                <span className="flex items-center gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" /> {parsed.rows.length} filas detectadas</span>
                                <span>{validRows.length} listas para importar</span>
                            </div>
                            <div className="max-h-52 overflow-y-auto divide-y">
                                {parsed.rows.map((r, i) => (
                                    <div key={i} className="flex items-center justify-between px-3 py-1.5 text-sm">
                                        <span className="truncate">{r.name || '—'}<span className="text-muted-foreground"> · {r.category}</span></span>
                                        {r.ok ? (
                                            <span className="text-green-600 text-xs font-medium shrink-0 ml-2">✔ {r.price}</span>
                                        ) : (
                                            <span className="text-destructive text-xs shrink-0 ml-2">{r.error}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                        Las categorías que no existan se crean solas. Si un plato ya existe por nombre, se omite.
                    </p>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={importNow} disabled={busy || validRows.length === 0} data-testid="import-confirm">
                        Importar {validRows.length > 0 ? `${validRows.length} plato${validRows.length === 1 ? '' : 's'}` : ''}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function Productos({ section = 'platos' }) {
    const navigate = useNavigate();
    const [tab, setTab] = useState(section);
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [openDlg, setOpenDlg] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyProduct);
    const [importOpen, setImportOpen] = useState(false);
    const [pendingAvail, setPendingAvail] = useState(null);
    const [confirmDel, setConfirmDel] = useState(null);
    const [run, busy] = usePendingAction();

    const { load, retry, loading, error, hasData } = useLoader(async () => {
        const [p, c] = await Promise.all([listProducts(), listCategories()]);
        setProducts(p.data); setCategories(c.data);
    });
    const generation = useRealtimeGeneration(['catalog']);
    // `load` es estable (`useCallback` en `useLoader`): incluirlo no repite la
    // carga y deja el build de CI sin el aviso de dependencias faltantes.
    useEffect(() => { if (generation) load(); }, [generation, load]);
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
            toast.error(tab === 'combos' ? 'Pon un nombre al combo' : 'Pon un nombre al plato');
            return;
        }
        if (form.is_combo && !(form.combo_items || []).length) {
            toast.error('Agrega al menos un plato al combo');
            return;
        }
        await run('save', async () => {
            const payload = {
                ...form,
                price: Number(form.price),
                preparation_time: Number(form.preparation_time),
                code: form.code.trim() || null,
                combo_items: form.is_combo ? (form.combo_items || []).filter((c) => c.product_id && Number(c.quantity) > 0) : [],
            };
            if (editing) {
                await updateProduct(editing.id, payload);
                toast.success(form.is_combo ? 'Combo actualizado' : 'Producto actualizado');
            } else {
                await createProduct(payload);
                toast.success(form.is_combo ? 'Combo creado' : 'Producto creado');
            }
            setOpenDlg(false);
            await load();
        }, { errorMessage: 'No se pudo guardar el cambio. Revisa tu conexión y reintenta.' });
    };

    const doDelete = (p) => run('delete', async () => {
        try { await deleteProduct(p.id); toast.success('Eliminado'); await load(); }
        finally { setConfirmDel(null); }
    }, { errorMessage: 'No se pudo eliminar. Revisa tu conexión y reintenta.' });

    const toggleAvail = async (p) => {
        try {
            const { data } = await setProductAvailability(p.id, { is_available: !p.is_available });
            if (!data.product.is_available) {
                setPendingAvail({ name: data.product.name, orders: data.pending_orders || [] });
                toast.success(`${data.product.name} agotado. Los pedidos ya aceptados siguen.`);
            } else {
                setPendingAvail(null);
                toast.success(`${data.product.name} vuelve a la carta`);
            }
            await load();
        } catch (e) { toast.error(apiErrorMessage(e, 'No se pudo actualizar')); }
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
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
                        {tab === 'combos' ? <Layers className="h-6 w-6 text-primary" /> : <Package className="h-6 w-6 text-primary" />}
                        {tab === 'combos' ? 'Combos' : 'Platos'}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {tab === 'combos'
                            ? 'Menús armados, con nombre propio y los platos que incluyen.'
                            : 'Platos sueltos de la carta.'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {tab === 'platos' && (
                        <>
                            <Button variant="outline" onClick={() => navigate('/categorias')} data-testid="producto-categorias-button">
                                <Tags className="h-4 w-4 mr-2" /> Categorías
                            </Button>
                            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="producto-importar-button">
                                <Upload className="h-4 w-4 mr-2" /> Importar
                            </Button>
                        </>
                    )}
                    <Button onClick={openNew} data-testid={tab === 'combos' ? 'combo-nuevo-button' : 'producto-nuevo-button'}>
                        <Plus className="h-4 w-4 mr-2" /> {tab === 'combos' ? 'Nuevo combo' : 'Nuevo producto'}
                    </Button>
                </div>
            </div>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => setTab('platos')}
                    className={`px-4 py-2 rounded-sm text-sm font-medium border ${tab === 'platos' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary'}`}
                >
                    Platos{hasData ? ` (${simples.length})` : ''}
                </button>
                <button
                    type="button"
                    onClick={() => setTab('combos')}
                    className={`px-4 py-2 rounded-sm text-sm font-medium border ${tab === 'combos' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-secondary'}`}
                    data-testid="tab-combos"
                >
                    Combos{hasData ? ` (${combos.length})` : ''}
                </button>
            </div>

            {pendingAvail && (
                <Card>
                    <CardContent className="p-4 text-sm space-y-2">
                        <div className="font-medium">{pendingAvail.name} — Agotado</div>
                        <div>Salón: actualizado. Carta web: el menú público deja de ofrecer el plato.</div>
                        {(pendingAvail.orders || []).length > 0 && (
                            <div>
                                <div className="text-muted-foreground mb-1">Consumos pendientes a revisar:</div>
                                {pendingAvail.orders.map((o) => (
                                    <Link key={o.id} to={`/pedidos/${o.id}`} className="block underline">Pedido #{o.order_number} · {o.quantity} u.</Link>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <LoadState loading={loading} error={error} hasData={hasData} onRetry={retry} testId="productos" errorText="No se pudo cargar la carta. Revisa tu conexión y reintenta.">
            {visible.length === 0 ? (
                <Card><CardContent className="py-14 text-center text-muted-foreground">
                    {tab === 'combos' ? 'Todavía no hay combos. Crea uno con nombre y los platos que incluye.' : 'No hay platos en la carta.'}
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
                                        <div className="font-display text-lg font-semibold">{p.name}</div>
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
                                <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                                    <label className="flex items-center gap-2 text-sm min-h-11 sm:min-h-0"><Switch checked={p.is_available} onCheckedChange={() => toggleAvail(p)} data-testid={`producto-disp-${p.id}`} /> {p.is_available ? 'Disponible' : 'Agotado'}</label>
                                    <div className="flex items-center gap-1">
                                        <Button size="icon" variant="ghost" aria-label={`Editar ${p.name}`} onClick={() => openEdit(p)} data-testid={`producto-edit-${p.id}`}><Pencil className="h-4 w-4" /></Button>
                                        <Button size="icon" variant="ghost" aria-label={`Eliminar ${p.name}`} onClick={() => setConfirmDel(p)} data-testid={`producto-del-${p.id}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                    </div>
                                </div>
                            </CardContent></Card>
                        );
                    })}
                </div>
            )}
            </LoadState>

            <Dialog open={openDlg} onOpenChange={setOpenDlg}>
                <DialogContent className="max-w-xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {form.is_combo
                                ? (editing ? 'Editar combo' : 'Nuevo combo')
                                : (editing ? 'Editar producto' : 'Nuevo producto')}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                            <Label htmlFor="producto-form-nombre">{form.is_combo ? 'Nombre del combo *' : 'Nombre *'}</Label>
                            <Input
                                id="producto-form-nombre"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder={form.is_combo ? 'Ej: Combo almuerzo criollo' : 'Ej: Ceviche clásico'}
                                data-testid="producto-form-name"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Label htmlFor="producto-form-codigo">{form.is_combo ? 'Código / identificador' : 'Código (opcional)'}</Label>
                            <Input
                                id="producto-form-codigo"
                                value={form.code}
                                onChange={(e) => setForm({ ...form, code: e.target.value })}
                                placeholder={form.is_combo ? 'Ej: ALM-01' : 'Ej: CE-01'}
                                data-testid="producto-form-code"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Label htmlFor="producto-form-descripcion">Descripción</Label>
                            <Textarea
                                id="producto-form-descripcion"
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                placeholder={form.is_combo ? 'Qué incluye y para quién es' : ''}
                            />
                        </div>
                        <div><Label htmlFor="producto-form-precio-s">Precio (S/)</Label><Input id="producto-form-precio-s" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="producto-form-price" /></div>
                        <div><Label htmlFor="producto-form-tiempo-prep-min">Tiempo prep. (min)</Label><Input id="producto-form-tiempo-prep-min" type="number" min="1" value={form.preparation_time} onChange={(e) => setForm({ ...form, preparation_time: e.target.value })} /></div>
                        {!form.is_combo && (
                            <div className="sm:col-span-2">
                                <Label htmlFor="producto-form-categoria">Categoría</Label>
                                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                                    <SelectTrigger id="producto-form-categoria" data-testid="producto-form-category"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                                    <SelectContent>
                                        {categories.filter((c) => c.slug !== 'combos').map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="sm:col-span-2"><Label htmlFor="producto-form-url-imagen-opcional">URL imagen (opcional)</Label><Input id="producto-form-url-imagen-opcional" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></div>
                        {form.is_combo && (
                            <div className="sm:col-span-2 space-y-2 border border-border rounded-sm p-3">
                                <div className="font-medium text-sm">Platos que incluye</div>
                                <p className="text-xs text-muted-foreground">Cada línea es un producto de la carta, con cantidad.</p>
                                {(form.combo_items || []).map((line, idx) => (
                                    <div key={idx} className="flex gap-2">
                                        <Select value={line.product_id} onValueChange={(v) => setComboLine(idx, { product_id: v })}>
                                            <SelectTrigger className="flex-1"><SelectValue placeholder="Elige un plato" /></SelectTrigger>
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
                                        if (!simples.length) { toast.error('Primero crea platos en la carta'); return; }
                                        setForm({ ...form, combo_items: [...(form.combo_items || []), { product_id: simples[0].id, quantity: 1 }] });
                                    }}
                                >
                                    <Plus className="h-4 w-4 mr-1" /> Agregar plato
                                </Button>
                            </div>
                        )}
                        <label className="flex items-center gap-2 text-sm min-h-11 sm:min-h-0"><Switch checked={form.is_available} onCheckedChange={(v) => setForm({ ...form, is_available: v })} /> Disponible</label>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpenDlg(false)}>Cancelar</Button>
                        <PendingButton onClick={save} pending={busy.has('save')} pendingLabel="Guardando…" data-testid="producto-form-save">{editing ? 'Guardar' : (form.is_combo ? 'Crear combo' : 'Crear')}</PendingButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ImportarPlatos open={importOpen} onOpenChange={setImportOpen} onDone={load} />

            <AlertDialog open={!!confirmDel} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar &quot;{confirmDel?.name}&quot;?</AlertDialogTitle>
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
