import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPublicCategories, getPublicProducts, getPublicRestaurant } from '@/lib/api/public';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { ProductCard } from '@/components/ProductCard';
import { Skeleton } from '@/components/ui/skeleton';
import usePublicStream from '@/hooks/usePublicStream';

const byAvailable = (a, b) => (a.is_available === b.is_available ? 0 : (a.is_available ? -1 : 1));

// Mismo esqueleto que la carta (imagen 96×112 + tres líneas): sin él, la
// categoría arrancaba con items=[] y pintaba "No hay platos en esta categoría"
// para después meter la rejilla (falso vacío + salto).
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

export default function CategoriaPage() {
    const { id } = useParams();
    const [restaurant, setRestaurant] = useState(null);
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    const { generation } = usePublicStream({ restaurantId: restaurant?.id });

    useEffect(() => {
        let active = true;
        // Sin .catch, un fallo de red se veía como una categoría vacía.
        setLoadError(false);
        Promise.all([
            getPublicRestaurant().then((r) => r.data),
            getPublicCategories().then((r) => r.data),
            getPublicProducts().then((r) => r.data),
        ]).then(([r, c, p]) => {
            if (!active) return;
            setRestaurant(r); setCategories(c); setProducts(p);
        }).catch(() => {
            if (active) setLoadError(true);
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [reloadToken]);

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
        getPublicProducts().then((r) => setProducts(r.data));
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
            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4" data-testid="categoria-skeleton" aria-hidden="true">
                    {Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)}
                </div>
            ) : loadError ? (
                <div className="py-16 text-center" data-testid="categoria-load-error">
                    <p className="text-muted-foreground">Revisa tu conexión y vuelve a intentar.</p>
                    <Button type="button" variant="outline" className="mt-3" onClick={() => setReloadToken((n) => n + 1)} data-testid="categoria-retry">
                        Reintentar
                    </Button>
                </div>
            ) : items.length === 0 ? (
                <div className="py-20 text-center text-muted-foreground font-display text-xl">No hay platos en esta categoría.</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                    {items.map((p) => (
                        <ProductCard key={p.id} product={p}>
                            {isCombos && (
                                <ul className="text-xs text-muted-foreground space-y-0.5">
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
