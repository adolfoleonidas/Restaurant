import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { ProductCard } from '@/components/ProductCard';
import usePublicStream from '@/hooks/usePublicStream';

export default function Landing() {
    const [restaurant, setRestaurant] = useState(null);
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [search, setSearch] = useState('');
    const [activeCat, setActiveCat] = useState(null);
    const sectionRefs = useRef({});
    const { generation } = usePublicStream({ restaurantId: restaurant?.id });

    useEffect(() => {
        Promise.all([
            api.get('/public/restaurant').then((r) => r.data),
            api.get('/public/categories').then((r) => r.data),
            api.get('/public/products').then((r) => r.data),
        ]).then(([r, c, p]) => {
            setRestaurant(r); setCategories(c); setProducts(p);
            if ((p || []).some((x) => x.is_combo)) setActiveCat('combos');
            else if (c.length) setActiveCat(c[0].id);
        });
    }, []);

    useEffect(() => {
        if (!generation || !restaurant?.id) return;
        api.get('/public/products').then((r) => setProducts(r.data));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generation]);

    const q = search.toLowerCase();
    const matchesSearch = (p) =>
        !q
        || p.name.toLowerCase().includes(q)
        || (p.description || '').toLowerCase().includes(q)
        || (p.code || '').toLowerCase().includes(q);

    const combos = useMemo(
        () => products.filter((p) => p.is_combo && (
            !q
            || p.name.toLowerCase().includes(q)
            || (p.description || '').toLowerCase().includes(q)
            || (p.code || '').toLowerCase().includes(q)
        )).sort((a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1))),
        [products, q]
    );

    const grouped = useMemo(() => {
        const filtered = products.filter((p) => !p.is_combo && (
            !q
            || p.name.toLowerCase().includes(q)
            || (p.description || '').toLowerCase().includes(q)
            || (p.code || '').toLowerCase().includes(q)
        ));
        const map = {};
        for (const c of categories) {
            if (c.slug === 'combos' || /^combos$/i.test(c.name || '')) continue;
            map[c.id] = { category: c, items: [] };
        }
        for (const p of filtered) { if (map[p.category_id]) map[p.category_id].items.push(p); }
        for (const g of Object.values(map)) {
            g.items.sort((a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1)));
        }
        return Object.values(map).filter((g) => g.items.length > 0);
    }, [products, categories, q]);

    const comboAfter = useMemo(() => {
        const idx = grouped.findIndex((g) => /bebida/i.test(g.category?.name || ''));
        return idx === -1 ? grouped.length - 1 : idx;
    }, [grouped]);

    const scrollToCat = (id) => {
        const el = sectionRefs.current[id];
        if (el) {
            const y = el.getBoundingClientRect().top + window.pageYOffset - 130;
            window.scrollTo({ top: y, behavior: 'smooth' });
            setActiveCat(id);
        }
    };

    return (
        <div data-testid="public-landing-root">
            <div className="sticky top-16 z-20 bg-background/95 backdrop-blur border-b border-border">
                <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center gap-2 overflow-x-auto">
                    <div className="relative shrink-0">
                        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input className="pl-9 h-10 w-52 rounded-sm bg-card" placeholder="Buscar en la carta" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="landing-search" />
                    </div>
                    {combos.length > 0 && (
                        <button
                            onClick={() => scrollToCat('combos')}
                            className={`shrink-0 rounded-sm px-4 py-2 text-sm font-medium border transition-colors ${activeCat === 'combos' ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent hover:bg-secondary border-border'}`}
                        >
                            Combos
                        </button>
                    )}
                    {grouped.map((g) => (
                        <button
                            key={g.category.id}
                            onClick={() => scrollToCat(g.category.id)}
                            data-testid={`landing-cat-${g.category.id}`}
                            className={`shrink-0 rounded-sm px-4 py-2 text-sm font-medium border transition-colors ${activeCat === g.category.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent hover:bg-secondary border-border'}`}
                        >
                            {g.category.name}
                        </button>
                    ))}
                </div>
            </div>

            <section className="max-w-6xl mx-auto px-4 md:px-6 py-12 space-y-16">
                {grouped.length === 0 && combos.length === 0 && (
                    <div className="py-20 text-center text-muted-foreground font-display italic text-xl">No hay platos con esos filtros.</div>
                )}
                {grouped.map((g, i) => (
                    <React.Fragment key={g.category.id}>
                        <div ref={(el) => { sectionRefs.current[g.category.id] = el; }} data-testid={`landing-section-${g.category.id}`}>
                            <div className="flex items-end justify-between mb-6 border-b border-border pb-3">
                                <div>
                                    <h2 className="font-display italic text-3xl md:text-4xl font-bold">{g.category.name}</h2>
                                    {g.category.description && <p className="text-muted-foreground text-sm mt-1">{g.category.description}</p>}
                                </div>
                                <span className="page-kicker">{g.items.length} platos</span>
                            </div>
                            <div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory -mx-4 px-4 md:-mx-6 md:px-6">
                                {g.items.map((p) => (
                                    <ProductCard key={p.id} product={p} />
                                ))}
                            </div>
                        </div>
                        {i === comboAfter && combos.length > 0 && (
                            <div ref={(el) => { sectionRefs.current.combos = el; }} data-testid="landing-section-combos">
                                <div className="flex items-end justify-between mb-6 border-b border-border pb-3">
                                    <div>
                                        <h2 className="font-display italic text-3xl md:text-4xl font-bold">Combos</h2>
                                        <p className="text-muted-foreground text-sm mt-1">Menús armados de la casa</p>
                                    </div>
                                    <span className="page-kicker">{combos.length} combos</span>
                                </div>
                                <div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory -mx-4 px-4 md:-mx-6 md:px-6">
                                    {combos.map((p) => (
                                        <ProductCard key={p.id} product={p}>
                                            <ul className="text-[11px] text-muted-foreground space-y-0.5">
                                                {(p.combo_components || []).map((c) => (
                                                    <li key={c.product_id}>{c.quantity}× {c.product_name}</li>
                                                ))}
                                            </ul>
                                        </ProductCard>
                                    ))}
                                </div>
                            </div>
                        )}
                    </React.Fragment>
                ))}
                {grouped.length === 0 && combos.length > 0 && (
                    <div ref={(el) => { sectionRefs.current.combos = el; }} data-testid="landing-section-combos">
                        <div className="flex items-end justify-between mb-6 border-b border-border pb-3">
                            <div>
                                <h2 className="font-display italic text-3xl md:text-4xl font-bold">Combos</h2>
                                <p className="text-muted-foreground text-sm mt-1">Menús armados de la casa</p>
                            </div>
                            <span className="page-kicker">{combos.length} combos</span>
                        </div>
                        <div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory -mx-4 px-4 md:-mx-6 md:px-6">
                            {combos.map((p) => (
                                <ProductCard key={p.id} product={p}>
                                    <ul className="text-[11px] text-muted-foreground space-y-0.5">
                                        {(p.combo_components || []).map((c) => (
                                            <li key={c.product_id}>{c.quantity}× {c.product_name}</li>
                                        ))}
                                    </ul>
                                </ProductCard>
                            ))}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
