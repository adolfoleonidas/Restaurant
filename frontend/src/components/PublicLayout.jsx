import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { ShoppingCart, MapPin, Phone, Clock } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { CartPanel } from '@/components/CartPanel';
import { BrandMark } from '@/components/BrandMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';

export const PublicLayout = () => {
    const { count, subtotal } = useCart();
    const [cartOpen, setCartOpen] = useState(false);
    const { data: restaurant } = usePolling(() => api.get('/public/restaurant').then((r) => r.data), 60000);
    const location = useLocation();
    const hideCartBtn = location.pathname.startsWith('/checkout') || location.pathname.startsWith('/pedido/');
    const showCart = !hideCartBtn;
    const showDock = showCart && count > 0;

    const cartSheet = (
        <Sheet open={cartOpen} onOpenChange={setCartOpen}>
            <SheetContent side="right" className="w-full sm:max-w-md p-0 bg-card border-border">
                <CartPanel onClose={() => setCartOpen(false)} />
            </SheetContent>
        </Sheet>
    );

    return (
        <div className={`min-h-screen flex flex-col bg-background ${showDock ? 'pb-24 md:pb-0' : ''}`}>
            <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-md">
                <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-3">
                    <Link to="/" className="min-w-0">
                        <BrandMark name={restaurant?.name || 'Sabor Peruano'} kicker="Carta · Barranco" compact />
                    </Link>
                    <div className="flex items-center gap-3">
                        <ThemeToggle />
                        <Link to="/login" className="hidden md:inline-flex page-kicker hover:text-primary transition-colors">
                            Salón
                        </Link>
                        {showCart && (
                            <Button data-testid="public-cart-button" className="h-11 rounded-full relative font-semibold px-3 sm:px-4" onClick={() => setCartOpen(true)}>
                                <ShoppingCart className="h-4 w-4" />
                                {count > 0 ? (
                                    <span className="hidden md:flex flex-col items-start leading-tight text-left">
                                        <span className="font-mono text-sm tabular-nums" data-testid="public-cart-total">{fmtMoney(subtotal)}</span>
                                        <span className="text-[10px] font-medium opacity-90">{count} {count === 1 ? 'plato' : 'platos'}</span>
                                    </span>
                                ) : (
                                    <span className="hidden sm:inline">Pedido</span>
                                )}
                                {count > 0 && (
                                    <span className="md:hidden font-mono text-sm tabular-nums">{count}</span>
                                )}
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-1">
                <Outlet />
            </main>

            <footer className="border-t border-border mt-16">
                <div className="max-w-6xl mx-auto px-4 md:px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div>
                        <BrandMark name={restaurant?.name} kicker="Cocina peruana de autor" />
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
                            {restaurant?.social_instagram && <span>{restaurant.social_instagram}</span>}
                            {restaurant?.social_facebook && <span>{restaurant.social_facebook}</span>}
                            {restaurant?.social_whatsapp && <span>WhatsApp {restaurant.social_whatsapp}</span>}
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
                        <span className="font-semibold">Ver pedido</span>
                        <span className="font-mono tabular-nums font-semibold">{fmtMoney(subtotal)} · {count}</span>
                    </button>
                </div>
            )}
            {cartSheet}
            <Toaster position="bottom-center" offset={showDock ? 88 : 24} />
        </div>
    );
};
