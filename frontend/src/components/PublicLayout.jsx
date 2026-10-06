import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { ShoppingCart, MapPin, Phone, Clock, X } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { useLiveOrder } from '@/contexts/LiveOrderContext';
import { fmtMoney, ORDER_STATUS_LABELS } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { CartPanel } from '@/components/CartPanel';
import { BrandMark } from '@/components/BrandMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';

export const PublicLayout = () => {
    const { count, subtotal } = useCart();
    const { order: liveOrder, isActive, mode, clearMeta } = useLiveOrder();
    const [cartOpen, setCartOpen] = useState(false);
    const { data: restaurant } = usePolling(() => api.get('/public/restaurant').then((r) => r.data), 60000);
    const location = useLocation();
    const hideCartBtn = location.pathname.startsWith('/checkout') || location.pathname.startsWith('/pedido/');
    const showCart = !hideCartBtn;

    const cartMode = isActive && mode === 'cart';
    const liveCount = isActive && liveOrder ? (liveOrder.items || []).filter((i) => i.status !== 'cancelado').reduce((s, i) => s + (i.quantity || 0), 0) : 0;
    const displayCount = isActive && !cartMode ? liveCount : count;
    const displayTotal = isActive && !cartMode && liveOrder ? liveOrder.total : subtotal;
    const showDock = showCart && displayCount > 0;
    const showOrderBar = isActive && !location.pathname.startsWith('/pedido/');

    const cartSheet = (
        <Sheet open={cartOpen} onOpenChange={setCartOpen}>
            <SheetContent side="right" className="w-full sm:max-w-md p-0 bg-card border-border" aria-describedby={undefined}>
                <SheetTitle className="sr-only">Tu pedido</SheetTitle>
                <CartPanel onClose={() => setCartOpen(false)} />
            </SheetContent>
        </Sheet>
    );

    // El hueco del dock (barra + área segura) sigue las variables del index.css
    // en lugar del pb-24 fijo, que quedaba corto bajo la barra de gestos.
    return (
        <div className={`min-h-dvh flex flex-col bg-background ${showDock ? 'pb-[calc(var(--bottom-nav-h)+var(--safe-bottom)+1rem)] md:pb-0' : ''}`}>
            <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-md">
                <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-3">
                    <Link to="/" className="min-w-0">
                        <BrandMark name={restaurant?.name || 'Sabor Peruano'} logoUrl={restaurant?.logo_url} kicker="Carta · Barranco" compact />
                    </Link>
                    <div className="flex items-center gap-3">
                        <ThemeToggle />
                        {/* El enlace "Salón" medía ~16 px de alto (page-kicker):
                            en táctil necesita los 44 px. */}
                        <Link to="/login" className="inline-flex h-11 items-center px-2 -mx-2 page-kicker hover:text-primary transition-colors">
                            Salón
                        </Link>
                        {showCart && (
                            <Button aria-label="Abrir pedido" data-testid="public-cart-button" className="h-11 rounded-full relative font-semibold px-3 sm:px-4" onClick={() => setCartOpen(true)}>
                                <ShoppingCart className="h-4 w-4" />
                                {displayCount > 0 ? (
                                    <span className="hidden md:flex flex-col items-start leading-tight text-left">
                                        <span className="font-mono text-sm tabular-nums" data-testid="public-cart-total">{fmtMoney(displayTotal)}</span>
                                        <span className="text-xs font-medium opacity-90">{displayCount} {displayCount === 1 ? 'plato' : 'platos'}</span>
                                    </span>
                                ) : (
                                    <span className="hidden sm:inline">{cartMode ? 'Para llevar' : (isActive ? 'Tu pedido' : 'Pedido')}</span>
                                )}
                                {displayCount > 0 && (
                                    <span className="md:hidden font-mono text-sm tabular-nums">{displayCount}</span>
                                )}
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            {showOrderBar && (
                <div className="border-b border-border bg-secondary/40" data-testid="public-order-bar">
                    <div className="max-w-6xl mx-auto px-4 md:px-6 py-2 flex items-center justify-between gap-3 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />
                            <span className="truncate">
                                Tu pedido <span className="font-semibold">#{liveOrder.order_number}</span>
                                <span className="text-muted-foreground"> · {ORDER_STATUS_LABELS[liveOrder.status] || liveOrder.status}</span>
                            </span>
                            <span className="font-mono tabular-nums text-primary font-semibold shrink-0">{fmtMoney(liveOrder.total)}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Button asChild variant="outline" size="sm">
                                <Link to={`/pedido/${liveOrder.tracking_code}`} data-testid="public-order-bar-track">Ver estado</Link>
                            </Button>
                            <button onClick={clearMeta} aria-label="Ocultar mi pedido" className="grid h-11 w-11 place-items-center text-muted-foreground hover:text-foreground transition-colors" data-testid="public-order-bar-dismiss">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <main className="flex-1">
                <Outlet />
            </main>

            <footer className="border-t border-border mt-16">
                <div className="max-w-6xl mx-auto px-4 md:px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div>
                        <BrandMark name={restaurant?.name} logoUrl={restaurant?.logo_url} kicker="Cocina peruana de autor" />
                        <p className="text-sm text-muted-foreground mt-4 leading-relaxed">{restaurant?.public_description}</p>
                    </div>
                    <div className="space-y-2 text-sm">
                        <div className="page-kicker mb-3">Casa</div>
                        {restaurant?.address && <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="h-4 w-4 mt-0.5 text-primary" /><span>{restaurant.address}</span></div>}
                        {restaurant?.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4 text-primary" /><span>{restaurant.phone}</span></div>}
                        {restaurant?.opening_hours && <div className="flex items-center gap-2 text-muted-foreground"><Clock className="h-4 w-4 text-primary" /><span>{restaurant.opening_hours}</span></div>}
                    </div>
                    <div className="text-sm">
                        <div className="page-kicker mb-3">Redes</div>
                        <div className="flex flex-col gap-1 text-muted-foreground">
                            {/* min-h-8: los enlaces de redes medían 20 px de
                                alto y no llegaban al mínimo táctil de 24 px. */}
                            {restaurant?.social_instagram && (
                                <a href={`https://instagram.com/${restaurant.social_instagram.replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center hover:underline">{restaurant.social_instagram}</a>
                            )}
                            {restaurant?.social_facebook && (
                                <a href={restaurant.social_facebook.startsWith('http') ? restaurant.social_facebook : `https://facebook.com/${restaurant.social_facebook.replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center hover:underline">Facebook</a>
                            )}
                            {restaurant?.social_whatsapp && (
                                <a href={`https://wa.me/${restaurant.social_whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center hover:underline">WhatsApp</a>
                            )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-6">© {new Date().getFullYear()} {restaurant?.name}</div>
                    </div>
                </div>
            </footer>

            {showDock && (
                <div className="fixed bottom-0 inset-x-0 z-40 p-3 pb-[max(12px,env(safe-area-inset-bottom))] md:hidden">
                    <button
                        type="button"
                        onClick={() => setCartOpen(true)}
                        data-testid="public-cart-dock"
                        className="w-full h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-between px-5"
                    >
                        <span className="font-semibold">{cartMode ? 'Ver pedido' : 'Ver tu pedido'}</span>
                        <span className="font-mono tabular-nums font-semibold">{fmtMoney(displayTotal)} · {displayCount}</span>
                    </button>
                </div>
            )}
            {cartSheet}
            <Toaster position="bottom-center" offset={showDock ? 120 : 24} />
        </div>
    );
};
