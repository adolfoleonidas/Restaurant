import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { ProductCard } from '@/components/ProductCard';
import usePublicStream from '@/hooks/usePublicStream';

const byAvailable = (a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1));

export default function CategoriaPage() {
    const { id } = useParams();
    const [restaurant, setRestaurant] = useState(null);
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const { generation } = usePublicStream({ restaurantId: restaurant?.id });

    useEffect(() => {
        Promise.all([
            api.get('/public/restaurant').then((r) => r.data),
            api.get('/public/categories').then((r) => r.data),
            api.get('/public/products').then((r) => r.data),
        ]).then(([r, c, p]) => { setRestaurant(r); setCategories(c); setProducts(p); });
    }, []);

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
    }, [id]);

    const isCombos = id === 'combos';

    const { title, subtitle, items } = useMemo(() => {
        if (isCombos) {
            return {
                title: 'Combos',
                subtitle: 'Menús armados de la casa',
                items: products.filter((p) => p.is_combo).sort(byAvailable),
            };
        }
        const cat = categories.find((c) => c.id === id);
        return {
            title: cat?.name || 'Categoría',
            subtitle: cat?.description || null,
            items: products.filter((p) => !p.is_combo && p.category_id === id).sort(byAvailable),
        };
    }, [isCombos, categories, products, id]);

    useEffect(() => {
        if (!generation) return;
        api.get('/public/products').then((r) => setProducts(r.data));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generation]);

    return (
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-6" data-testid="categoria-page-root">
            <Button asChild variant="ghost" size="sm" className="mb-4">
                <Link to="/" data-testid="categoria-back"><ChevronLeft className="h-4 w-4 mr-1" /> Volver a la carta</Link>
            </Button>
            <div className="flex items-end justify-between mb-6 border-b border-border pb-3">
                <div>
                    <h1 className="font-display text-3xl md:text-4xl font-bold">{title}</h1>
                    {subtitle && <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>}
                </div>
                <span className="page-kicker">{items.length}</span>
            </div>
            {items.length === 0 ? (
                <div className="py-20 text-center text-muted-foreground font-display text-xl">No hay platos en esta categoría.</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                    {items.map((p) => (
                        <ProductCard key={p.id} product={p}>
                            {isCombos && (
                                <ul className="text-[11px] text-muted-foreground space-y-0.5">
                                    {(p.combo_components || []).map((c) => (
                                        <li key={c.product_id}>{c.quantity}× {c.product_name}</li>
                                    ))}
                                </ul>
                            )}
                        </ProductCard>
                    ))}
                </div>
            )}
        </div>
    );
}
