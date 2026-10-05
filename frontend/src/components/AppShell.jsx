import React, { useEffect, useState } from 'react';
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
    Package, Users, Settings, LogOut, Menu, CreditCard, Store, Globe,
} from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { api } from '@/lib/api';

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

const NavItems = ({ items, onNav }) => items.map((it) => (
    <NavLink
        key={`${it.to}-${it.label}`}
        to={it.to}
        onClick={onNav}
        data-testid={`nav-${it.to.slice(1)}`}
        className={({ isActive }) =>
            `flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-colors ${
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
    // Un solo origen de verdad para el menú: se filtra ALL_NAV por rol y por
    // funciones y se deduplica por destino. Antes había dos problemas: el menú
    // se reemplazaba entero para los perfiles multifunción (un admin que también
    // atiende y cobra perdía "Pedidos") y dos entradas del mismo destino podían
    // coexistir (mozo/cajero con administracion).
    const seen = new Set();
    const items = ALL_NAV.filter((n) => {
        const allowed = n.roles.includes(user.role)
            || (n.roles.includes('admin') && hasFn(user, 'administracion'))
            || (n.roles.includes('cajero') && hasFn(user, 'cobro'))
            || (n.roles.includes('mozo') && hasFn(user, 'atencion'))
            || (n.roles.includes('cocina') && hasFn(user, 'preparacion'));
        if (!allowed || seen.has(n.to)) return false;
        seen.add(n.to);
        return true;
    });
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
                        className="mt-3 flex items-center gap-3 rounded-sm border border-border px-3 py-2.5 text-sm font-medium text-foreground/85 transition-colors hover:border-primary hover:bg-secondary"
                    >
                        <Globe className="h-[18px] w-[18px]" />
                        <span>Mi página web</span>
                    </a>
                )}
            </nav>
            <div className="border-t border-border px-4 py-3">
                <div className="page-kicker">En turno</div>
                <div className="font-medium text-sm truncate mt-1">{user.full_name}</div>
                <div className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</div>
            </div>
        </div>
    );
};

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

    return (
        <NotifyProvider>
        <div className="min-h-screen flex bg-background">
            <aside className="hidden md:flex w-64 shrink-0 border-r border-border">
                <SidebarContent user={user} restaurant={restaurant} />
            </aside>

            <div className="flex-1 flex flex-col min-w-0">
                <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/90 backdrop-blur px-4 md:px-6">
                    <Sheet open={open} onOpenChange={setOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menú de navegación" data-testid="open-sidebar-button">
                                <Menu className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="p-0 w-72 border-border">
                            <SheetTitle className="sr-only">Navegación</SheetTitle>
                            <SidebarContent user={user} restaurant={restaurant} onNav={() => setOpen(false)} />
                        </SheetContent>
                    </Sheet>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="pulse-dot" aria-hidden />
                            <span className="font-medium">En vivo</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <RoleInbox />
                        <KitchenAlerts />
                        <AssistantBar />
                        <ThemeToggle />
                        <div className="hidden sm:flex flex-col items-end leading-tight">
                            <span className="text-sm font-medium">{user.full_name}</span>
                            <span className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</span>
                        </div>
                        <Button variant="outline" size="sm" className="rounded-sm" onClick={() => { logout(); navigate('/login'); }} data-testid="logout-button">
                            <LogOut className="h-4 w-4 mr-1.5" /> Salir
                        </Button>
                    </div>
                </header>

                <main className="flex-1 p-4 md:p-6 lg:p-8">
                    <Outlet />
                </main>
            </div>

            <Toaster position="bottom-center" offset={24} />
        </div>
        </NotifyProvider>
    );
};
