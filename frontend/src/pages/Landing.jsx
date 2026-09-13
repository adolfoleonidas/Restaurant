import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { ProductCard } from '@/components/ProductCard';
import usePublicStream from '@/hooks/usePublicStream';

const PREVIEW = 8;

const match = (p, q) =>
    !q
    || p.name.toLowerCase().includes(q)
    || (p.description || '').toLowerCase().includes(q)
    || (p.code || '').toLowerCase().includes(q);

const byAvailable = (a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1));

export default function Landing() {
    const [restaurant, setRestaurant] = useState(null);
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [search, setSearch] = useState('');
    const [activeCat, setActiveCat] = useState(null);
    const { generation } = usePublicStream({ restaurantId: restaurant?.id });

    useEffect(() => {
        Promise.all([
            api.get('/public/restaurant').then((r) => r.data),
            api.get('/public/categories').then((r) => r.data),
            api.get('/public/products').then((r) => r.data),
        ]).then(([r, c, p]) => {
            setRestaurant(r); setCategories(c); setProducts(p);
            if (c.length) setActiveCat(c[0].id);
            else if ((p || []).some((x) => x.is_combo)) setActiveCat('combos');
        });
    }, []);

    useEffect(() => {
        if (!generation || !restaurant?.id) return;
        api.get('/public/products').then((r) => setProducts(r.data));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generation]);

    const q = search.toLowerCase();

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

    const tabs = useMemo(() => {
        const list = grouped.map((g) => ({ id: g.category.id, name: g.category.name }));
        if (combos.length > 0) {
            const idx = list.findIndex((t) => /bebida/i.test(t.name || ''));
            list.splice(idx === -1 ? list.length : idx + 1, 0, { id: 'combos', name: 'Combos' });
        }
        return list;
    }, [grouped, combos]);

    const selectTab = (id) => {
        setSearch('');
        setActiveCat(id);
    };

    const activeGroup = q ? null : (activeCat === 'combos' ? null : grouped.find((g) => g.category.id === activeCat));

    const renderSection = (title, subtitle, items, testId, renderComboChildren, moreHref) => {
        const showAll = moreHref && items.length > PREVIEW;
        const visible = showAll ? items.slice(0, PREVIEW) : items;
        return (
            <div data-testid={testId}>
                <div className="flex items-end justify-between mb-5 border-b border-border pb-3">
                    <div>
                        <h2 className="font-display italic text-2xl md:text-3xl font-bold">{title}</h2>
                        {subtitle && <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>}
                    </div>
                    <span className="page-kicker">{items.length}</span>
                </div>
                {items.length === 0 ? (
                    <div className="py-16 text-center text-muted-foreground font-display italic text-xl">No hay platos con esos filtros.</div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
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
                    </>
                )}
            </div>
        );
    };

    return (
        <div data-testid="public-landing-root">
            <div className="sticky top-16 z-20 bg-background/95 backdrop-blur border-b border-border">
                <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center gap-2 overflow-x-auto">
                    <div className="relative shrink-0">
                        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input className="pl-9 h-10 w-52 rounded-sm bg-card" placeholder="Buscar en la carta" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="landing-search" />
                    </div>
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => selectTab(t.id)}
                            data-testid={`landing-cat-${t.id}`}
                            className={`shrink-0 rounded-sm px-4 py-2 text-sm font-medium border transition-colors ${!q && activeCat === t.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent hover:bg-secondary border-border'}`}
                        >
                            {t.name}
                        </button>
                    ))}
                </div>
            </div>

            <section className="max-w-6xl mx-auto px-4 md:px-6 py-10">
                {q ? (
                    renderSection('Resultados', `Buscando “${search}”`, searchResults, 'landing-section-search')
                ) : activeGroup ? (
                    renderSection(activeGroup.category.name, activeGroup.category.description, activeGroup.items, `landing-section-${activeGroup.category.id}`, false, `/menu/categoria/${activeGroup.category.id}`)
                ) : combos.length > 0 ? (
                    renderSection('Combos', 'Menús armados de la casa', combos, 'landing-section-combos', true, '/menu/categoria/combos')
                ) : (
                    <div className="py-20 text-center text-muted-foreground font-display italic text-xl">No hay platos con esos filtros.</div>
                )}
            </section>
        </div>
    );
}
