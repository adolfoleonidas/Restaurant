import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCart } from '@/contexts/CartContext';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, ChefHat, MapPin, Phone, Clock, Star, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

export default function Landing() {
    const { addProduct } = useCart();
    const [restaurant, setRestaurant] = useState(null);
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [search, setSearch] = useState('');
    const [activeCat, setActiveCat] = useState(null);
    const sectionRefs = useRef({});

    useEffect(() => {
        Promise.all([
            api.get('/public/restaurant').then((r) => r.data),
            api.get('/public/categories').then((r) => r.data),
            api.get('/public/products').then((r) => r.data),
        ]).then(([r, c, p]) => {
            setRestaurant(r); setCategories(c); setProducts(p);
            if (c.length) setActiveCat(c[0].id);
        });
    }, []);

    const grouped = useMemo(() => {
        const filtered = products.filter((p) =>
            !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.description || '').toLowerCase().includes(search.toLowerCase())
        );
        const map = {};
        for (const c of categories) map[c.id] = { category: c, items: [] };
        for (const p of filtered) { if (map[p.category_id]) map[p.category_id].items.push(p); }
        return Object.values(map).filter((g) => g.items.length > 0);
    }, [products, categories, search]);

    const scrollToCat = (id) => {
        const el = sectionRefs.current[id];
        if (el) {
            const y = el.getBoundingClientRect().top + window.pageYOffset - 130;
            window.scrollTo({ top: y, behavior: 'smooth' });
            setActiveCat(id);
        }
    };

    const onAdd = (product) => {
        addProduct(product, 1, '');
        toast.success(`${product.name} agregado al carrito`);
    };

    return (
        <div data-testid="public-landing-root">
            {/* Hero */}
            <section className="relative overflow-hidden">
                <div className="absolute inset-0">
                    <img
                        src={restaurant?.cover_url || "https://images.pexels.com/photos/14590691/pexels-photo-14590691.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=1600"}
                        alt=""
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-[#1F1D1B]/80 via-[#1F1D1B]/50 to-transparent" />
                </div>
                <div className="relative max-w-7xl mx-auto px-4 md:px-6 py-16 md:py-24">
                    <div className="max-w-2xl text-white">
                        <div className="inline-flex items-center gap-1.5 bg-white/10 backdrop-blur border border-white/15 rounded-full px-3 py-1 text-xs mb-4">
                            <Star className="h-3.5 w-3.5" /> Pide online en menos de 2 minutos
                        </div>
                        <h1 className="font-display text-4xl md:text-6xl font-bold leading-[1.05] mb-4">
                            {restaurant?.name || 'Sabor Peruano'}
                        </h1>
                        <p className="text-lg text-white/85 mb-6">{restaurant?.public_description}</p>
                        <div className="flex flex-wrap gap-4 text-sm text-white/85">
                            {restaurant?.opening_hours && <div className="flex items-center gap-1.5"><Clock className="h-4 w-4" />{restaurant.opening_hours}</div>}
                            {restaurant?.address && <div className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{restaurant.address}</div>}
                            {restaurant?.phone && <div className="flex items-center gap-1.5"><Phone className="h-4 w-4" />{restaurant.phone}</div>}
                        </div>
                        <div className="mt-7 flex flex-wrap gap-3">
                            <Button onClick={() => scrollToCat(categories[0]?.id)} className="h-12 px-6 text-base" data-testid="hero-ver-menu"><ChefHat className="h-4 w-4 mr-2" /> Ver menú</Button>
                            <div className="flex items-center gap-2 text-white/85 text-sm"><ChevronDown className="h-4 w-4 animate-bounce" /> Desliza para explorar</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Category sticky nav */}
            <div className="sticky top-16 z-20 bg-background/95 backdrop-blur border-b">
                <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex items-center gap-2 overflow-x-auto">
                    <div className="relative shrink-0">
                        <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input className="pl-9 h-10 w-56" placeholder="Buscar plato…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="landing-search" />
                    </div>
                    {grouped.map((g) => (
                        <button
                            key={g.category.id}
                            onClick={() => scrollToCat(g.category.id)}
                            data-testid={`landing-cat-${g.category.id}`}
                            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium border transition-colors ${activeCat === g.category.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                        >
                            {g.category.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* Menu sections */}
            <section className="max-w-7xl mx-auto px-4 md:px-6 py-10 space-y-12">
                {grouped.length === 0 && (
                    <Card><CardContent className="py-16 text-center text-muted-foreground">No hay productos con esos filtros.</CardContent></Card>
                )}
                {grouped.map((g) => (
                    <div key={g.category.id} ref={(el) => (sectionRefs.current[g.category.id] = el)} data-testid={`landing-section-${g.category.id}`}>
                        <div className="flex items-end justify-between mb-4">
                            <div>
                                <h2 className="font-display text-2xl md:text-3xl font-bold">{g.category.name}</h2>
                                {g.category.description && <p className="text-muted-foreground text-sm mt-1">{g.category.description}</p>}
                            </div>
                            <span className="text-xs text-muted-foreground">{g.items.length} platos</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {g.items.map((p) => (
                                <Card key={p.id} className="overflow-hidden hover:shadow-lg transition-shadow group" data-testid={`landing-product-${p.id}`}>
                                    {p.image_url ? (
                                        <div className="aspect-[16/10] overflow-hidden bg-secondary">
                                            <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                        </div>
                                    ) : (
                                        <div className="aspect-[16/10] bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center text-muted-foreground">
                                            <ChefHat className="h-12 w-12 opacity-30" />
                                        </div>
                                    )}
                                    <CardContent className="p-4">
                                        <div className="font-semibold">{p.name}</div>
                                        {p.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2 min-h-[2rem]">{p.description}</div>}
                                        <div className="flex items-center justify-between mt-3">
                                            <span className="font-display text-lg font-bold tabular-nums">{fmtMoney(p.price)}</span>
                                            <Button size="sm" onClick={() => onAdd(p)} className="h-10 rounded-xl" data-testid={`landing-add-${p.id}`}><Plus className="h-4 w-4 mr-1" /> Agregar</Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                ))}
            </section>
        </div>
    );
}
