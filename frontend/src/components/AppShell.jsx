import React, { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_LABELS } from '@/lib/format';
import { isOwner as isOwnerUser, navItemsFor as permittedNavItems } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { BrandMark } from '@/components/BrandMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { KitchenAlerts } from '@/components/KitchenAlerts';
import { AssistantBar } from '@/components/AssistantBar';
import { RoleInbox } from '@/components/RoleInbox';
import { NotifyProvider } from '@/contexts/NotifyContext';
import {
    LayoutDashboard, Grid2X2, Receipt, ChefHat, Wallet, BarChart3,
    Package, Users, Settings, LogOut, Menu, CreditCard, Store, Globe, MoreHorizontal,
} from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { getRestaurant } from '@/lib/api/restaurant';

// Cuántos destinos caben en la barra inferior del móvil. El resto queda a un
// toque, en la misma hoja lateral que abre la hamburguesa ("Más").
const BOTTOM_NAV_MAX = 4;

// The menu entries (who sees what) live in lib/permissions, next to the route
// guards. The shell only knows how to draw them.
const NAV_ICONS = {
    dashboard: LayoutDashboard,
    salon: Grid2X2,
    catalog: Package,
    cash: Wallet,
    receipt: Receipt,
    reports: BarChart3,
    kitchen: ChefHat,
    payments: CreditCard,
    store: Store,
    team: Users,
    settings: Settings,
};

export const navItemsFor = (user) => permittedNavItems(user).map((n) => ({ ...n, icon: NAV_ICONS[n.icon] }));

// Fallback de la carga bajo demanda: las pantallas del POS se descargan al
// entrar, así que hace falta algo que ocupe el sitio y que se anuncie como
// estado (no como contenido) mientras llega el trozo de código.
const RouteLoading = () => (
    <div role="status" aria-live="polite" className="flex min-h-[40dvh] items-center justify-center gap-3 text-sm text-muted-foreground">
        <span className="pulse-dot" aria-hidden />
        Cargando pantalla…
    </div>
);

const NavItems = ({ items, onNav }) => items.map((it) => (
    <NavLink
        key={`${it.to}-${it.label}`}
        to={it.to}
        onClick={onNav}
        data-testid={`nav-${it.to.slice(1)}`}
        className={({ isActive }) =>
            // min-h-11: la fila mide 44 px, el mínimo cómodo para el dedo.
            `flex min-h-11 items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground/85 hover:bg-secondary'
            }`
        }
    >
        <it.icon className="h-[18px] w-[18px]" />
        <span>{it.label}</span>
    </NavLink>
));

const SidebarContent = ({ user, onNav, restaurant }) => {
    const isOwner = isOwnerUser(user);
    const items = navItemsFor(user);
    const main = items.filter((n) => n.group !== 'more');
    const more = items.filter((n) => n.group === 'more');
    return (
        <div className="flex h-full flex-col bg-card">
            <div className="px-5 py-5 border-b border-border">
                <BrandMark name={restaurant?.name || 'Restaurante'} logoUrl={restaurant?.logo_url} kicker="Servicio de salón" compact />
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
                <NavItems items={main} onNav={onNav} />
                {more.length > 0 && (
                    <>
                        <div className="page-kicker px-3 pt-4 pb-1">Más</div>
                        <NavItems items={more} onNav={onNav} />
                    </>
                )}
                {isOwner && (
                    <a
                        href="/"
                        target="_blank"
                        rel="noreferrer"
                        onClick={onNav}
                        data-testid="nav-mi-web"
                        title="Abrir la carta pública en otra pestaña"
                        className="mt-3 flex min-h-11 items-center gap-3 rounded-sm border border-border px-3 py-2.5 text-sm font-medium text-foreground/85 transition-colors hover:border-primary hover:bg-secondary"
                    >
                        <Globe className="h-[18px] w-[18px]" />
                        <span>Mi página web</span>
                    </a>
                )}
            </nav>
            <div className="border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="page-kicker">En turno</div>
                <div className="font-medium text-sm truncate mt-1">{user.full_name}</div>
                <div className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</div>
            </div>
        </div>
    );
};

/**
 * Barra de navegación inferior (solo móvil).
 *
 * Antes, en un teléfono, cada cambio de pantalla costaba dos toques: abrir la
 * hamburguesa y elegir. Ahora los destinos principales del rol están siempre a
 * un toque y, si el rol tiene más, "Más" abre la misma hoja lateral, así que no
 * se pierde ningún acceso.
 */
const BottomNav = ({ items, showMore, onMore }) => (
    <nav
        className="app-bottom-nav fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-background/95 backdrop-blur md:hidden"
        aria-label="Navegación principal"
    >
        {items.map((it) => (
            <NavLink
                key={`bottom-${it.to}`}
                to={it.to}
                aria-label={it.label}
                data-testid={`bottom-nav-${it.to.slice(1)}`}
                className={({ isActive }) =>
                    // En modo oscuro `primary` (#2463e0) sobre el fondo de la
                    // barra da 3,33:1: la etiqueta activa se aclara, como ya
                    // hace el pase de cocina con sus ámbar/azul claros.
                    `flex min-h-touch min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs font-medium transition-colors ${
                        isActive ? 'text-primary dark:text-blue-300' : 'text-muted-foreground'
                    }`
                }
            >
                <it.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="w-full truncate text-center leading-none">{it.label}</span>
            </NavLink>
        ))}
        {showMore && (
            <button
                type="button"
                onClick={onMore}
                aria-label="Más opciones"
                data-testid="bottom-nav-more"
                className="flex min-h-touch min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs font-medium text-muted-foreground transition-colors active:text-foreground"
            >
                <MoreHorizontal className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="leading-none">Más</span>
            </button>
        )}
    </nav>
);

export const AppShell = () => {
    const { user, logout } = useAuth();
    const [restaurant, setRestaurant] = useState(null);

    useEffect(() => {
        let active = true;
        getRestaurant().then(({ data }) => {
            if (active) setRestaurant(data);
        }).catch(() => {});
        return () => { active = false; };
    }, []);
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();

    if (!user) return null;

    const items = navItemsFor(user);
    const bottomItems = items.slice(0, BOTTOM_NAV_MAX);
    const hasMore = items.length > BOTTOM_NAV_MAX;

    return (
        <NotifyProvider>
        <div className="min-h-dvh flex bg-background">
            <a
                href="#contenido"
                className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-sm focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
            >
                Saltar al contenido
            </a>
            <aside className="hidden md:flex w-64 shrink-0 border-r border-border">
                <SidebarContent user={user} restaurant={restaurant} />
            </aside>

            <div className="flex-1 flex flex-col min-w-0">
                <header className="app-header sticky top-0 z-30 flex shrink-0 items-center gap-1 border-b border-border bg-background/90 px-3 backdrop-blur sm:gap-3 sm:px-4 md:px-6">
                    <Sheet open={open} onOpenChange={setOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="shrink-0 md:hidden" aria-label="Abrir menú de navegación" data-testid="open-sidebar-button">
                                <Menu className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="p-0 w-[min(20rem,85vw)] border-border">
                            <SheetTitle className="sr-only">Navegación</SheetTitle>
                            <SidebarContent user={user} restaurant={restaurant} onNav={() => setOpen(false)} />
                        </SheetContent>
                    </Sheet>

                    {/* El pulso se mantiene en móvil (es el único indicador de
                        que el tablero se refresca); el rótulo aparece cuando
                        hay ancho para él. */}
                    <div className="flex flex-1 min-w-0 items-center gap-2 text-sm text-muted-foreground">
                        <span className="pulse-dot shrink-0" aria-hidden />
                        <span className="hidden font-medium sm:inline">En vivo</span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                        <RoleInbox />
                        <KitchenAlerts />
                        <AssistantBar />
                        <ThemeToggle />
                        <div className="hidden lg:flex flex-col items-end leading-tight">
                            <span className="text-sm font-medium">{user.full_name}</span>
                            <span className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</span>
                        </div>
                        {/* Un único botón de salida: icono de 44 px en móvil y
                            pastilla con texto a partir de 640 px. El data-testid
                            no se duplica para no romper los localizadores
                            estrictos de las pruebas. */}
                        <Button
                            variant="outline"
                            size="icon"
                            className="shrink-0 rounded-sm sm:h-8 sm:w-auto sm:px-3"
                            aria-label="Salir"
                            onClick={() => { logout(); navigate('/login'); }}
                            data-testid="logout-button"
                        >
                            <LogOut className="h-4 w-4 sm:mr-1.5" />
                            <span className="hidden sm:inline">Salir</span>
                        </Button>
                    </div>
                </header>

                {/* Sin utilidades de padding inferior: el hueco de la barra
                    inferior lo pone `.has-bottom-nav`, que vive en la capa
                    `components` y perdería contra un `p-*` de `utilities`. */}
                <main id="contenido" tabIndex={-1} className="has-bottom-nav flex-1 focus:outline-none px-3 pt-3 sm:px-4 sm:pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-8">
                    <Suspense fallback={<RouteLoading />}>
                        <Outlet />
                    </Suspense>
                </main>
            </div>

            <BottomNav items={bottomItems} showMore={hasMore} onMore={() => setOpen(true)} />

            {/* En móvil la barra inferior tapa los avisos si quedan pegados al
                borde, así que se levantan por encima de ella. */}
            <Toaster position="bottom-center" offset={24} mobileOffset={{ top: 16, right: 16, bottom: 84, left: 16 }} />
        </div>
        </NotifyProvider>
    );
};
