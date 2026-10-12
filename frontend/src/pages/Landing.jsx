import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPublicCategories, getPublicProducts, getPublicRestaurant } from '@/lib/api/public';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { ProductCard } from '@/components/ProductCard';
import { Skeleton } from '@/components/ui/skeleton';
import usePublicStream from '@/hooks/usePublicStream';
import { useTableContext } from '@/contexts/TableContext';
import { Utensils, X } from 'lucide-react';

const PREVIEW = 8;

const byAvailable = (a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1));

const normalizeSearchText = (value) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const match = (p, q) =>
    !q
    || normalizeSearchText(p.name).includes(q)
    || normalizeSearchText(p.description || '').includes(q)
    || normalizeSearchText(p.code || '').includes(q);

// Esqueleto con la geometría real de la tarjeta de la carta (imagen 96×112 +
// tres líneas). El `h-36` anterior medía menos que la tarjeta real, así que al
// llegar los datos cada fila encogía/crecía bajo el dedo (CLS).
function ProductCardSkeleton() {
    return (
        <div className="w-full rounded-xl border border-border bg-card overflow-hidden flex flex-row outline-none">
            <Skeleton className="h-28 w-24 shrink-0 rounded-none" />
            <div className="min-w-0 p-3 sm:p-4 flex flex-col gap-2 flex-1">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
                <div className="mt-auto pt-2 flex items-center justify-between gap-3">
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-10 w-10 rounded-full" />
                </div>
            </div>
        </div>
    );
}

export default function Landing() {
    const [restaurant, setRestaurant] = useState(null);
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    const [search, setSearch] = useState('');
    const [activeCategory, setActiveCategory] = useState('');
    const sectionRefs = useRef({});
    const { generation } = usePublicStream({ restaurantId: restaurant?.id });
    const { table, hasTable, error: tableError, clearTable } = useTableContext();
    const [tableHintDismissed, setTableHintDismissed] = useState(false);

    useEffect(() => {
        let active = true;
        // Sin el .catch previo, un fallo de red se veía como "No hay platos con
        // esos filtros": el cliente creía que la carta estaba vacía. El
        // restaurante es el dato que habilita la carta entera (id del stream,
        // nombre de la portada), así que si falta no hay nada que mostrar.
        setLoadError(false);
        // Al reintentar con datos ya en memoria solo se refresca el
        // restaurante: el stream ya recarga categorías y platos con
        // `generation`, así que no se duplica el tráfico.
        const requests = restaurant
            ? getPublicRestaurant().then((r) => [r.data, categories, products])
            : Promise.all([
                getPublicRestaurant().then((r) => r.data),
                getPublicCategories().then((r) => r.data),
                getPublicProducts().then((r) => r.data),
            ]);
        requests.then(([r, c, p]) => {
            if (!active) return;
            setRestaurant(r); setCategories(c); setProducts(p);
        }).catch(() => {
            if (active) setLoadError(true);
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadToken]);

    useEffect(() => {
        if (!generation || !restaurant?.id) return;
        getPublicProducts().then((r) => setProducts(r.data));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generation]);

    const q = normalizeSearchText(search.trim());

    const combos = useMemo(
        () => products.filter((p) => p.is_combo).sort(byAvailable),
        [products]
    );

    const grouped = useMemo(() => {
        const map = {};
        for (const c of categories) {
            if (c.slug === 'combos' || /^combos$/i.test(c.name || '')) continue;
            map[c.id] = { category: c, items: [] };
        }
        for (const p of products.filter((p) => !p.is_combo)) {
            if (map[p.category_id]) map[p.category_id].items.push(p);
        }
        for (const g of Object.values(map)) g.items.sort(byAvailable);
        return Object.values(map).filter((g) => g.items.length > 0);
    }, [products, categories]);

    const searchResults = useMemo(
        () => (q ? products.filter((p) => match(p, q)).sort(byAvailable) : []),
        [products, q]
    );

    const comboAfter = useMemo(() => {
        const idx = grouped.findIndex((g) => /bebida/i.test(g.category?.name || ''));
        return idx === -1 ? grouped.length - 1 : idx;
    }, [grouped]);

    const scrollToCat = (id) => {
        const el = sectionRefs.current[id];
        if (el) {
            const y = el.getBoundingClientRect().top + window.pageYOffset - 130;
            window.scrollTo({ top: y, behavior: 'smooth' });
        }
    };

    const renderSection = (title, subtitle, items, testId, renderComboChildren, moreHref, sectionId) => {
        const showAll = moreHref && items.length > PREVIEW;
        const visible = showAll ? items.slice(0, PREVIEW) : items;
        return (
            <div ref={(el) => { if (sectionId) sectionRefs.current[sectionId] = el; }} data-testid={testId}>
                <div className="flex items-end justify-between mb-5 border-b border-border pb-3">
                    <div>
                        <h2 className="font-display text-2xl md:text-3xl font-bold">{title}</h2>
                        {subtitle && <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>}
                    </div>
                    <span className="page-kicker">{items.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                    {visible.map((p) => (
                        <ProductCard key={p.id} product={p}>
                            {renderComboChildren && (
                                <ul className="text-xs text-muted-foreground space-y-0.5">
                                    {(p.combo_components || []).map((c) => (
                                        <li key={c.product_id}>{c.quantity}× {c.product_name}</li>
                                    ))}
                                </ul>
                            )}
                        </ProductCard>
                    ))}
                </div>
                {showAll && (
                    <Button asChild variant="outline" className="w-full h-11 rounded-sm mt-4" data-testid="landing-ver-todos">
                        <Link to={moreHref}>Ver todos los {items.length}</Link>
                    </Button>
                )}
            </div>
        );
    };

    return (
        <div data-testid="public-landing-root">
            {/* El QR deja la mesa en contexto. El cliente no tiene que volver a
                elegirla, pero puede cambiarla o pedir para llevar más adelante. */}
            {hasTable && !tableHintDismissed && (
                <div className="border-b border-primary/30 bg-primary/10" data-testid="public-table-context">
                    <div className="max-w-6xl mx-auto px-4 md:px-6 py-2 flex items-center gap-3 text-sm">
                        <Utensils className="h-4 w-4 text-primary shrink-0" />
                        <span className="min-w-0 flex-1">
                            Estás pidiendo desde <span className="font-semibold">Mesa {table?.number}</span>
                            {table?.area ? ` · ${table.area}` : ''}. La carta es la misma para mesa, recojo o delivery.
                        </span>
                        <button
                            type="button"
                            onClick={() => setTableHintDismissed(true)}
                            aria-label="Ocultar el aviso de mesa"
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                            data-testid="public-table-context-dismiss"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            )}
            {tableError && (
                <div className="border-b border-destructive/40 bg-destructive/10" role="alert" data-testid="public-table-context-error">
                    <div className="max-w-6xl mx-auto px-4 md:px-6 py-2 flex items-center gap-3 text-sm">
                        <span className="min-w-0 flex-1">{tableError} Pide el QR otra vez o avisa al personal.</span>
                        <button type="button" onClick={clearTable} className="h-9 shrink-0 rounded-md border px-3 text-xs">Descartar</button>
                    </div>
                </div>
            )}
            {loading ? (
                // Reserva el espacio de la portada para que la imagen no salte
                // al cargar (CLS de la carta pública: 0,89 sin esto).
                <div className="h-40 sm:h-52 md:h-64 w-full bg-secondary/50 animate-pulse" data-testid="public-cover-skeleton" aria-hidden="true" />
            ) : restaurant?.cover_url && (
                <section className="relative" data-testid="public-cover">
                    {/* La portada es el LCP de la carta: sin lazy, con
                        width/height explícitos y reservando su caja con el
                        esqueleto de arriba (mismo h-40 sm:h-52 md:h-64). El
                        ancho/alto de atributo solo aporta la proporción
                        intrínseca cuando el CSS aún no aplicó. */}
                    <img
                        src={restaurant.cover_url}
                        alt=""
                        width={1200}
                        height={640}
                        fetchpriority="high"
                        decoding="async"
                        className="w-full h-40 sm:h-52 md:h-64 object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
                    <div className="absolute bottom-4 left-0 right-0">
                        <div className="max-w-6xl mx-auto px-4 md:px-6">
                            <h1 className="font-display text-3xl md:text-4xl font-semibold drop-shadow-sm">{restaurant?.name}</h1>
                            {restaurant?.public_description && (
                                <p className="text-sm text-muted-foreground mt-1 max-w-2xl line-clamp-2">{restaurant.public_description}</p>
                            )}
                        </div>
                    </div>
                </section>
            )}
            <div className="sticky top-16 z-20 bg-background/95 backdrop-blur border-b border-border shadow-sm" role="navigation" aria-label="Categorías del menú">
                <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center gap-2 snap-x scroll-x">                    <div className="relative shrink-0">
                        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input type="search" enterKeyHint="search" className="pl-9 h-10 w-44 sm:w-52 rounded-sm bg-card" placeholder="Buscar en la carta" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="landing-search" />
                    </div>
                    {grouped.map((g, i) => (
                        <React.Fragment key={g.category.id}>
                            <button
                                type="button"
                                onClick={() => { setActiveCategory(g.category.id); scrollToCat(g.category.id); }}
                                data-testid={`landing-cat-${g.category.id}`} aria-current={activeCategory === g.category.id ? 'location' : undefined}
                                className={`shrink-0 snap-start rounded-full px-4 py-2 min-h-11 sm:min-h-0 inline-flex items-center text-sm font-medium border transition-colors ${activeCategory === g.category.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent hover:bg-secondary border-border'}`}
                            >
                                {g.category.name}
                            </button>
                            {i === comboAfter && combos.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => { setActiveCategory('combos'); scrollToCat('combos'); }}
                                    aria-current={activeCategory === 'combos' ? 'location' : undefined}
                                    className={`shrink-0 snap-start rounded-full px-4 py-2 min-h-11 sm:min-h-0 inline-flex items-center text-sm font-medium border transition-colors ${activeCategory === 'combos' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent hover:bg-secondary border-border'}`}
                                >
                                    Combos
                                </button>
                            )}
                        </React.Fragment>
                    ))}
                </div>
            </div>

            <section className="max-w-6xl mx-auto px-4 md:px-6 py-10 space-y-14">
                {q ? (
                    <>
                        {renderSection('Resultados', `Buscando “${search}”`, searchResults, 'landing-section-search')}
                        {searchResults.length === 0 && (
                            <div className="mt-6 text-center" data-testid="landing-empty-search">
                                <p className="text-muted-foreground">No encontramos resultados. Prueba con otro término.</p>
                                <Button type="button" variant="outline" className="mt-3" data-testid="landing-clear-search" onClick={() => setSearch('')}>
                                    Limpiar búsqueda
                                </Button>
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        {loading && (
                            // El esqueleto replica la estructura real (sección
                            // por categoría + tarjeta con imagen y tres líneas):
                            // antes pintaba 2 secciones de cajas de 144 px y al
                            // llegar los datos todo saltaba bajo el dedo.
                            <div className="space-y-10" data-testid="landing-skeleton" aria-hidden="true">
                                {Array.from({ length: Math.max(2, grouped.length || 0) }).map((_, s) => (
                                    <div key={s}>
                                        <div className="flex items-end justify-between mb-5 border-b border-border pb-3">
                                            <Skeleton className="h-8 w-48" />
                                            <Skeleton className="h-4 w-8" />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                                            {Array.from({ length: 6 }).map((_, i) => (
                                                <ProductCardSkeleton key={i} />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {!loading && loadError && (
                            <div className="py-16 text-center" data-testid="landing-load-error">
                                <p className="text-muted-foreground">Revisa tu conexión y vuelve a intentar.</p>
                                <Button type="button" variant="outline" className="mt-3" onClick={() => setReloadToken((n) => n + 1)} data-testid="landing-retry">
                                    Reintentar
                                </Button>
                            </div>
                        )}
                        {!loading && !loadError && grouped.length === 0 && combos.length === 0 && (
                            <div className="py-20 text-center text-muted-foreground font-display text-xl">No hay platos con esos filtros.</div>
                        )}
                        {!loadError && grouped.map((g, i) => (
                            <React.Fragment key={g.category.id}>
                                {renderSection(
                                    g.category.name,
                                    g.category.description,
                                    g.items,
                                    `landing-section-${g.category.id}`,
                                    false,
                                    `/menu/categoria/${g.category.id}`,
                                    g.category.id
                                )}
                                {i === comboAfter && combos.length > 0 && (
                                    renderSection('Combos', 'Menús armados de la casa', combos, 'landing-section-combos', true, '/menu/categoria/combos', 'combos')
                                )}
                            </React.Fragment>
                        ))}
                        {!loadError && grouped.length === 0 && combos.length > 0 && (
                            renderSection('Combos', 'Menús armados de la casa', combos, 'landing-section-combos', true, '/menu/categoria/combos', 'combos')
                        )}
                    </>
                )}
            </section>
        </div>
    );
}
