import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { ProductCard } from '@/components/ProductCard';
import usePublicStream from '@/hooks/usePublicStream';

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

export default function Landing() {
    const [restaurant, setRestaurant] = useState(null);
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [search, setSearch] = useState('');
    const [activeCategory, setActiveCategory] = useState('');
    const sectionRefs = useRef({});
    const { generation } = usePublicStream({ restaurantId: restaurant?.id });

    useEffect(() => {
        Promise.all([
            api.get('/public/restaurant').then((r) => r.data),
            api.get('/public/categories').then((r) => r.data),
            api.get('/public/products').then((r) => r.data),
        ]).then(([r, c, p]) => {
            setRestaurant(r); setCategories(c); setProducts(p);
        });
    }, []);

    useEffect(() => {
        if (!generation || !restaurant?.id) return;
        api.get('/public/products').then((r) => setProducts(r.data));
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
                                <ul className="text-[11px] text-muted-foreground space-y-0.5">
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
            <div className="sticky top-16 z-20 bg-background/95 backdrop-blur border-b border-border shadow-sm" role="navigation" aria-label="Categorías del menú">
                <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center gap-2 overflow-x-auto">
                    <div className="relative shrink-0">
                        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input className="pl-9 h-10 w-52 rounded-sm bg-card" placeholder="Buscar en la carta" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="landing-search" />
                    </div>
                    {grouped.map((g, i) => (
                        <React.Fragment key={g.category.id}>
                            <button
                                type="button"
                                onClick={() => { setActiveCategory(g.category.id); scrollToCat(g.category.id); }}
                                data-testid={`landing-cat-${g.category.id}`} aria-current={activeCategory === g.category.id ? 'location' : undefined}
                                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium border transition-colors ${activeCategory === g.category.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent hover:bg-secondary border-border'}`}
                            >
                                {g.category.name}
                            </button>
                            {i === comboAfter && combos.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => { setActiveCategory('combos'); scrollToCat('combos'); }}
                                    aria-current={activeCategory === 'combos' ? 'location' : undefined}
                                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium border transition-colors ${activeCategory === 'combos' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent hover:bg-secondary border-border'}`}
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
                        {grouped.length === 0 && combos.length === 0 && (
                            <div className="py-20 text-center text-muted-foreground font-display text-xl">No hay platos con esos filtros.</div>
                        )}
                        {grouped.map((g, i) => (
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
                        {grouped.length === 0 && combos.length > 0 && (
                            renderSection('Combos', 'Menús armados de la casa', combos, 'landing-section-combos', true, '/menu/categoria/combos', 'combos')
                        )}
                    </>
                )}
            </section>
        </div>
    );
}
