import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Utensils, ShoppingCart, MapPin, Phone, Clock } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { CartPanel } from '@/components/CartPanel';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';

export const PublicLayout = () => {
    const { count } = useCart();
    const [cartOpen, setCartOpen] = useState(false);
    const { data: restaurant } = usePolling(() => api.get('/public/restaurant').then((r) => r.data), 60000);
    const location = useLocation();
    const hideCartBtn = location.pathname.startsWith('/checkout') || location.pathname.startsWith('/pedido/');

    return (
        <div className="min-h-screen flex flex-col bg-background">
            <header className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b">
                <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-3">
                    <Link to="/" className="flex items-center gap-2.5 min-w-0">
                        <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center"><Utensils className="h-5 w-5" /></div>
                        <div className="min-w-0">
                            <div className="font-display font-semibold text-base leading-tight truncate">{restaurant?.name || 'Restaurante'}</div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pide en línea</div>
                        </div>
                    </Link>
                    <div className="flex items-center gap-2">
                        <Link to="/login" className="hidden md:inline-flex text-xs text-muted-foreground hover:text-foreground transition-colors">Acceso staff</Link>
                        {!hideCartBtn && (
                            <Sheet open={cartOpen} onOpenChange={setCartOpen}>
                                <SheetTrigger asChild>
                                    <Button data-testid="public-cart-button" className="h-10 rounded-xl relative">
                                        <ShoppingCart className="h-4 w-4 mr-2" /> <span className="hidden sm:inline">Carrito</span>
                                        {count > 0 && (
                                            <span className="absolute -top-1.5 -right-1.5 bg-accent text-accent-foreground text-[11px] font-bold rounded-full h-5 min-w-5 px-1 flex items-center justify-center">
                                                {count}
                                            </span>
                                        )}
                                    </Button>
                                </SheetTrigger>
                                <SheetContent side="right" className="w-full sm:max-w-md p-0">
                                    <CartPanel onClose={() => setCartOpen(false)} />
                                </SheetContent>
                            </Sheet>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-1">
                <Outlet />
            </main>

            <footer className="border-t bg-card mt-12">
                <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center"><Utensils className="h-5 w-5" /></div>
                            <div className="font-display font-semibold">{restaurant?.name}</div>
                        </div>
                        <p className="text-sm text-muted-foreground">{restaurant?.public_description}</p>
                    </div>
                    <div className="space-y-2 text-sm">
                        <div className="font-semibold mb-2">Contacto</div>
                        {restaurant?.address && <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="h-4 w-4 mt-0.5" /><span>{restaurant.address}</span></div>}
                        {restaurant?.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" /><span>{restaurant.phone}</span></div>}
                        {restaurant?.opening_hours && <div className="flex items-center gap-2 text-muted-foreground"><Clock className="h-4 w-4" /><span>{restaurant.opening_hours}</span></div>}
                    </div>
                    <div className="text-sm">
                        <div className="font-semibold mb-2">Síguenos</div>
                        <div className="flex flex-col gap-1 text-muted-foreground">
                            {restaurant?.social_instagram && <span>Instagram: {restaurant.social_instagram}</span>}
                            {restaurant?.social_facebook && <span>Facebook: {restaurant.social_facebook}</span>}
                            {restaurant?.social_whatsapp && <span>WhatsApp: {restaurant.social_whatsapp}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-4">© {new Date().getFullYear()} {restaurant?.name}. Hecho con ❤ en Perú.</div>
                    </div>
                </div>
            </footer>

            <Toaster position="top-right" />
        </div>
    );
};
