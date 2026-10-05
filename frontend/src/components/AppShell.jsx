import React, { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_LABELS } from '@/lib/format';
import { hasFn } from '@/lib/functions';
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
import { api } from '@/lib/api';

// Cuántos destinos caben en la barra inferior del móvil. El resto queda a un
// toque, en la misma hoja lateral que abre la hamburguesa ("Más").
const BOTTOM_NAV_MAX = 4;

const ALL_NAV = [
    { to: '/dashboard', label: 'Hoy', icon: LayoutDashboard, roles: ['admin'], group: 'main' },
    { to: '/salon', label: 'Salón', icon: Grid2X2, roles: ['admin', 'mozo', 'cajero'], group: 'main' },
    { to: '/productos', label: 'Carta', icon: Package, roles: ['admin'], group: 'main' },
    { to: '/caja', label: 'Caja', icon: Wallet, roles: ['admin', 'cajero'], group: 'main' },
    { to: '/comprobantes', label: 'Comprobantes', icon: Receipt, roles: ['admin', 'cajero'], group: 'main' },
    { to: '/reportes', label: 'Reportes', icon: BarChart3, roles: ['admin'], group: 'main' },
    { to: '/cocina', label: 'Cocina', icon: ChefHat, roles: ['cocina'], group: 'main' },
    { to: '/disponibilidad', label: 'Disponibilidad', icon: Package, roles: ['cocina'], group: 'main' },
    { to: '/pedidos', label: 'Pedidos', icon: Receipt, roles: ['mozo', 'cajero'], group: 'main' },
    { to: '/pedidos', label: 'Pedidos', icon: Receipt, roles: ['admin'], group: 'more' },
    { to: '/cocina', label: 'Cocina', icon: ChefHat, roles: ['admin'], group: 'more' },
    // Combos y Categorías dejan de ser ítems propios del menú: los dos son
    // accesos al mismo formulario de "Carta" (Combos es un tab de Productos y
    // Categorías se abre desde su botón). Antes el menú ofrecía tres accesos a
    // lo mismo y no decía dónde gestionar la carta.
    { to: '/pagos', label: 'Datos de cobro', icon: CreditCard, roles: ['admin'], group: 'more' },
    { to: '/local', label: 'Local', icon: Store, roles: ['admin'], group: 'more' },
    { to: '/usuarios', label: 'Equipo', icon: Users, roles: ['admin'], group: 'more' },
    { to: '/configuracion', label: 'Configuración', icon: Settings, roles: ['admin'], group: 'more' },
];

// Un solo origen de verdad para el menú: se filtra ALL_NAV por rol y por
// funciones y se deduplica por destino. Antes había dos problemas: el menú
// se reemplazaba entero para los perfiles multifunción (un admin que también
// atiende y cobra perdía "Pedidos") y dos entradas del mismo destino podían
// coexistir (mozo/cajero con administracion). Lo comparten la hoja lateral
// (escritorio y móvil) y la barra inferior del móvil, para que las dos
// superficies no puedan divergir.
export const navItemsFor = (user) => {
    const seen = new Set();
    return ALL_NAV.filter((n) => {
        // Staff accounts and passwords belong to the owner: the `administracion`
        // function opens every other panel, but not this one.
        if (n.to === '/usuarios' && user.role !== 'admin') return false;
        const allowed = n.roles.includes(user.role)
            || (n.roles.includes('admin') && hasFn(user, 'administracion'))
            || (n.roles.includes('cajero') && hasFn(user, 'cobro'))
            || (n.roles.includes('mozo') && hasFn(user, 'atencion'))
            || (n.roles.includes('cocina') && hasFn(user, 'preparacion'));
        if (!allowed || seen.has(n.to)) return false;
        seen.add(n.to);
        return true;
    });
};

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
    const isOwner = user.role === 'admin' || hasFn(user, 'administracion');
    const items = navItemsFor(user);
    const main = items.filter((n) => n.group !== 'more');
    const more = items.filter((n) => n.group === 'more');
    return (
        <div className="flex h-full flex-col bg-card">
            <div className="px-5 py-5 border-b border-border">
                <BrandMark name={restaurant?.name || 'Sabor Peruano'} logoUrl={restaurant?.logo_url} kicker="Servicio de salón" compact />
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
        api.get('/restaurants/current').then(({ data }) => {
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
                <main className="has-bottom-nav flex-1 px-3 pt-3 sm:px-4 sm:pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-8">
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
