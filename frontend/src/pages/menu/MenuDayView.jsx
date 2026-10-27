import { useMemo, useState } from 'react';
import { LayoutGrid, List, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { fmtMoney } from '@/lib/format';

/**
 * El catálogo del día, en tarjetas o en lista.
 *
 * Es presentacional a propósito: recibe el catálogo ya resuelto por el servidor y
 * devuelve intenciones (`onToggleOffered`, `onToggleSoldOut`). Así se puede probar
 * sin base ni red, y la pantalla que lo use no repite esta lógica.
 *
 * La pantalla está pensada para responder tres preguntas de un vistazo: qué se
 * ofrece hoy, qué falta por decidir y qué está agotado. Por eso agrupa por
 * categoría, muestra el estado en cada plato y deja el trabajo en bloque detrás
 * de una selección explícita.
 */

const FILTERS = [
    { key: 'todos', label: 'Todos' },
    { key: 'ofrecidos', label: 'En menú' },
    { key: 'fuera', label: 'Fuera' },
    { key: 'agotados', label: 'Agotados' },
];

const STATUS = {
    ofrecido: { label: 'En el menú', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' },
    agotado: { label: 'Agotado', className: 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200' },
    fuera: { label: 'Fuera hoy', className: 'border-border bg-muted text-muted-foreground' },
};

function categoryGroups(catalog, categories) {
    const byId = new Map(categories.map((category) => [category.id, category.name]));
    const groups = new Map();
    for (const product of catalog) {
        const key = product.category_id || '__otros';
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                label: byId.get(key) || 'Carta',
                items: [],
            });
        }
        groups.get(key).items.push(product);
    }
    const ordered = [...categories]
        .filter((category) => groups.has(category.id))
        .map((category) => groups.get(category.id));
    for (const [key, group] of groups) {
        if (!categories.some((category) => category.id === key)) ordered.push(group);
    }
    return ordered;
}

function StatusPill({ product }) {
    const key = product.sold_out ? 'agotado' : (product.offered_today ? 'ofrecido' : 'fuera');
    const status = STATUS[key];
    return (
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>
            {status.label}
        </span>
    );
}

function PriceEditor({ product, saving, onPriceChange }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Precio hoy</span>
            <div className="relative">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">S/</span>
                <Input
                    type="number"
                    min="0"
                    step="0.50"
                    inputMode="decimal"
                    aria-label={`Precio de hoy de ${product.name}`}
                    className="h-11 w-24 pl-7 text-right tabular-nums sm:h-9"
                    value={product.price_override ?? ''}
                    placeholder="—"
                    disabled={saving}
                    onChange={(e) => onPriceChange?.(product.product_id, e.target.value)}
                    data-testid={`menu-precio-${product.product_id}`}
                />
            </div>
        </div>
    );
}

function OfferControl({ product, saving, onToggleOffered }) {
    const label = product.is_fixed
        ? 'Siempre en la carta'
        : (product.offered_today ? 'Se ofrece hoy' : 'Ofrecer hoy');
    return (
        <div className="flex items-center gap-2">
            <Switch
                checked={product.offered_today}
                disabled={saving || product.is_fixed}
                onCheckedChange={(value) => onToggleOffered?.(product.product_id, value)}
                aria-label={
                    product.is_fixed
                        ? `${product.name} es de carta fija: se ofrece siempre`
                        : `Ofrecer ${product.name} hoy`
                }
                data-testid={`menu-ofrecer-${product.product_id}`}
            />
            <span className={`text-sm ${product.is_fixed ? 'text-muted-foreground' : 'font-medium'}`}>
                {label}
            </span>
        </div>
    );
}

function SoldOutButton({ product, saving, onToggleSoldOut }) {
    return (
        <Button
            type="button"
            size="sm"
            variant={!product.offered_today ? 'ghost' : (product.sold_out ? 'default' : 'outline')}
            className={!product.offered_today ? 'text-muted-foreground' : undefined}
            disabled={saving || !product.offered_today}
            title={product.offered_today
                ? 'Marca el plato como agotado; los pedidos ya tomados siguen'
                : 'Primero ofrece el plato hoy para poder marcarlo agotado'}
            onClick={() => onToggleSoldOut?.(product.product_id, !product.sold_out)}
            data-testid={`menu-agotar-${product.product_id}`}
        >
            {product.sold_out ? 'Habilitar' : (product.offered_today ? 'Marcar agotado' : 'Agotado')}
        </Button>
    );
}

function SelectionCheckbox({ product, marcados, onToggle }) {
    return (
        <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0 accent-primary"
            aria-label={`Seleccionar ${product.name} para aplicar en bloque`}
            title="Seleccionar para aplicar en bloque"
            checked={marcados.has(product.product_id)}
            onChange={() => onToggle(product.product_id)}
            data-testid={`menu-marcar-${product.product_id}`}
        />
    );
}

function MenuCard({
    product, categoryLabel, marcados, onToggleMark, saving, onToggleOffered, onToggleSoldOut, onPriceChange,
}) {
    return (
        <article
            data-testid={`menu-plato-${product.product_id}`}
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
        >
            <div className="flex items-start gap-2">
                <SelectionCheckbox product={product} marcados={marcados} onToggle={onToggleMark} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold" title={product.name}>{product.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                                {categoryLabel} · {product.is_fixed ? 'Carta fija' : `Precio de carta ${fmtMoney(product.base_price)}`}
                            </p>
                        </div>
                        <StatusPill product={product} />
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                <OfferControl product={product} saving={saving} onToggleOffered={onToggleOffered} />
                {product.offered_today && !product.is_fixed && (
                    <PriceEditor product={product} saving={saving} onPriceChange={onPriceChange} />
                )}
                <SoldOutButton product={product} saving={saving} onToggleSoldOut={onToggleSoldOut} />
            </div>

            {product.offered_today && !product.is_fixed && (
                <p className="text-[11px] text-muted-foreground">
                    Vacío = precio de carta ({fmtMoney(product.base_price)}).
                </p>
            )}
        </article>
    );
}

function MenuRow({
    product, categoryLabel, marcados, onToggleMark, saving, onToggleOffered, onToggleSoldOut, onPriceChange,
}) {
    return (
        <div data-testid={`menu-fila-${product.product_id}`} className="px-3 py-3">
            <div className="flex items-start gap-2">
                <SelectionCheckbox product={product} marcados={marcados} onToggle={onToggleMark} />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" title={product.name}>{product.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {categoryLabel} · {product.is_fixed ? 'Carta fija' : `Precio de carta ${fmtMoney(product.base_price)}`}
                    </p>
                </div>
                <StatusPill product={product} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                <OfferControl product={product} saving={saving} onToggleOffered={onToggleOffered} />
                {product.offered_today && !product.is_fixed && (
                    <PriceEditor product={product} saving={saving} onPriceChange={onPriceChange} />
                )}
                <SoldOutButton product={product} saving={saving} onToggleSoldOut={onToggleSoldOut} />
            </div>
        </div>
    );
}

export default function MenuDayView({
    catalog = [],
    categories = [],
    mode = 'cards',
    onModeChange,
    onToggleOffered,
    onToggleSoldOut,
    onPriceChange,
    onBulkOffer,
    saving = false,
}) {
    const ofrecidos = catalog.filter((product) => product.offered_today).length;
    const agotados = catalog.filter((product) => product.sold_out).length;
    const [marcados, setMarcados] = useState(() => new Set());
    const [query, setQuery] = useState('');
    const [filtro, setFiltro] = useState('todos');

    const alternarMarca = (productId) => {
        setMarcados((previos) => {
            const siguiente = new Set(previos);
            if (siguiente.has(productId)) siguiente.delete(productId); else siguiente.add(productId);
            return siguiente;
        });
    };

    const aplicar = (ofrecer) => {
        onBulkOffer?.([...marcados], ofrecer);
        setMarcados(new Set());
    };

    const filtrados = useMemo(() => {
        const busqueda = query.trim().toLowerCase();
        return catalog.filter((product) => {
            if (busqueda) {
                const category = categories.find((item) => item.id === product.category_id)?.name || '';
                if (!`${product.name} ${category}`.toLowerCase().includes(busqueda)) return false;
            }
            if (filtro === 'ofrecidos') return product.offered_today;
            if (filtro === 'fuera') return !product.offered_today;
            if (filtro === 'agotados') return product.sold_out;
            return true;
        });
    }, [catalog, categories, query, filtro]);

    const grupos = useMemo(() => categoryGroups(filtrados, categories), [filtrados, categories]);

    return (
        <section className="space-y-3" data-testid="menu-day-view">
            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <p className="text-sm font-semibold" data-testid="menu-day-resumen">
                            {ofrecidos} de {catalog.length} platos se ofrecen hoy
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {agotados > 0 ? `${agotados} agotado${agotados === 1 ? '' : 's'} · ` : ''}
                            Marca varios platos para ofrecerlos o quitarlos en bloque.
                        </p>
                    </div>
                    <div className="flex items-center gap-1" role="group" aria-label="Vista">
                        <Button
                            type="button"
                            size="sm"
                            variant={mode === 'cards' ? 'default' : 'outline'}
                            aria-pressed={mode === 'cards'}
                            onClick={() => onModeChange?.('cards')}
                            data-testid="menu-vista-tarjetas"
                        >
                            <LayoutGrid className="h-4 w-4 mr-1" />Tarjetas
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant={mode === 'list' ? 'default' : 'outline'}
                            aria-pressed={mode === 'list'}
                            onClick={() => onModeChange?.('list')}
                            data-testid="menu-vista-lista"
                        >
                            <List className="h-4 w-4 mr-1" />Lista
                        </Button>
                    </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            className="h-11 pl-9 sm:h-10"
                            placeholder="Buscar plato…"
                            aria-label="Buscar plato"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            data-testid="menu-buscar"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap">
                        {FILTERS.map((filter) => {
                            const count = filter.key === 'todos'
                                ? catalog.length
                                : filter.key === 'ofrecidos'
                                    ? ofrecidos
                                    : filter.key === 'agotados'
                                        ? agotados
                                        : catalog.length - ofrecidos;
                            return (
                                <Button
                                    key={filter.key}
                                    type="button"
                                    size="sm"
                                    variant={filtro === filter.key ? 'default' : 'outline'}
                                    aria-pressed={filtro === filter.key}
                                    onClick={() => setFiltro(filter.key)}
                                    className="w-full shrink-0 sm:w-auto"
                                    aria-label={`${filter.label}: ${count}`}
                                    data-testid={`menu-filtro-${filter.key}`}
                                >
                                    {filter.label}<span className="hidden sm:inline"> ({count})</span>
                                </Button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {catalog.length === 0 && (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="menu-day-vacio">
                    Todavía no hay platos en la carta. Agrega productos para poder armar el menú de hoy.
                </p>
            )}

            {marcados.size > 0 && (
                <div className="flex items-center gap-2 flex-wrap rounded-xl border border-primary/30 bg-primary/5 px-3 py-2" data-testid="menu-bloque">
                    <span className="text-sm font-medium">{marcados.size} seleccionados</span>
                    <Button type="button" size="sm" disabled={saving} onClick={() => aplicar(true)} data-testid="menu-bloque-ofrecer">
                        Ofrecer hoy
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => aplicar(false)} data-testid="menu-bloque-quitar">
                        Quitar de hoy
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setMarcados(new Set())} data-testid="menu-bloque-limpiar">
                        Desmarcar
                    </Button>
                </div>
            )}

            {catalog.length > 0 && filtrados.length === 0 && (
                <div className="rounded-xl border border-dashed p-6 text-center" data-testid="menu-day-sin-resultados">
                    <p className="text-sm font-medium">No hay platos con ese filtro.</p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => { setQuery(''); setFiltro('todos'); }}
                    >
                        Limpiar búsqueda
                    </Button>
                </div>
            )}

            {filtrados.length > 0 && (
                <div
                    className={mode === 'cards' ? 'space-y-4' : 'space-y-4'}
                    data-testid={mode === 'cards' ? 'menu-day-tarjetas' : 'menu-day-lista'}
                >
                    {grupos.map((group) => (
                        <section key={group.key} className="space-y-2" aria-label={group.label}>
                            <div className="flex items-baseline justify-between gap-2">
                                <h2 className="font-display text-base font-semibold">{group.label}</h2>
                                <span className="text-xs text-muted-foreground">
                                    {group.items.length} {group.items.length === 1 ? 'plato' : 'platos'}
                                </span>
                            </div>
                            {mode === 'cards' ? (
                                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                    {group.items.map((product) => (
                                        <MenuCard
                                            key={product.product_id}
                                            product={product}
                                            categoryLabel={group.label}
                                            marcados={marcados}
                                            onToggleMark={alternarMarca}
                                            saving={saving}
                                            onToggleOffered={onToggleOffered}
                                            onToggleSoldOut={onToggleSoldOut}
                                            onPriceChange={onPriceChange}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="divide-y rounded-xl border border-border bg-card">
                                    {group.items.map((product) => (
                                        <MenuRow
                                            key={product.product_id}
                                            product={product}
                                            categoryLabel={group.label}
                                            marcados={marcados}
                                            onToggleMark={alternarMarca}
                                            saving={saving}
                                            onToggleOffered={onToggleOffered}
                                            onToggleSoldOut={onToggleSoldOut}
                                            onPriceChange={onPriceChange}
                                        />
                                    ))}
                                </div>
                            )}
                        </section>
                    ))}
                </div>
            )}
        </section>
    );
}
