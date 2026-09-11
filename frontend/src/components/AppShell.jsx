import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_LABELS } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { BrandMark } from '@/components/BrandMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import { KitchenAlerts } from '@/components/KitchenAlerts';
import { RoleInbox } from '@/components/RoleInbox';
import { NotifyProvider } from '@/contexts/NotifyContext';
import {
    LayoutDashboard, Grid2X2, Receipt, ChefHat, Wallet, BarChart3,
    Package, Tags, Users, Settings, LogOut, Menu, Layers, CreditCard,
} from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';

const ALL_NAV = [
    { to: '/dashboard', label: 'Hoy', icon: LayoutDashboard, roles: ['admin'], group: 'main' },
    { to: '/mesas', label: 'Operación', icon: Grid2X2, roles: ['admin'], group: 'main' },
    { to: '/mesas', label: 'Mesas', icon: Grid2X2, roles: ['mozo', 'cajero'], group: 'main' },
    { to: '/disponibilidad', label: 'Carta', icon: Package, roles: ['admin'], group: 'main' },
    { to: '/caja', label: 'Caja', icon: Wallet, roles: ['admin', 'cajero'], group: 'main' },
    { to: '/reportes', label: 'Reportes', icon: BarChart3, roles: ['admin'], group: 'main' },
    { to: '/cocina', label: 'Cocina', icon: ChefHat, roles: ['cocina'], group: 'main' },
    { to: '/disponibilidad', label: 'Agotar', icon: Package, roles: ['cocina'], group: 'main' },
    { to: '/pedidos', label: 'Pedidos', icon: Receipt, roles: ['mozo', 'cajero'], group: 'main' },
    { to: '/pedidos', label: 'Pedidos', icon: Receipt, roles: ['admin'], group: 'more' },
    { to: '/cocina', label: 'Cocina', icon: ChefHat, roles: ['admin'], group: 'more' },
    { to: '/productos', label: 'Editar carta', icon: Package, roles: ['admin'], group: 'more' },
    { to: '/combos', label: 'Combos', icon: Layers, roles: ['admin'], group: 'more' },
    { to: '/categorias', label: 'Secciones', icon: Tags, roles: ['admin'], group: 'more' },
    { to: '/pagos', label: 'Datos de cobro', icon: CreditCard, roles: ['admin'], group: 'more' },
    { to: '/usuarios', label: 'Equipo', icon: Users, roles: ['admin'], group: 'more' },
    { to: '/configuracion', label: 'Casa', icon: Settings, roles: ['admin'], group: 'more' },
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

const SidebarContent = ({ user, onNav }) => {
    const items = ALL_NAV.filter((n) => n.roles.includes(user.role));
    const main = items.filter((n) => n.group !== 'more');
    const more = items.filter((n) => n.group === 'more');
    return (
        <div className="flex h-full flex-col bg-card">
            <div className="px-5 py-5 border-b border-border">
                <BrandMark kicker="Servicio de salón" compact />
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
                <NavItems items={main} onNav={onNav} />
                {more.length > 0 && (
                    <>
                        <div className="page-kicker px-3 pt-4 pb-1">Más</div>
                        <NavItems items={more} onNav={onNav} />
                    </>
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
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();

    if (!user) return null;

    return (
        <NotifyProvider>
        <div className="min-h-screen flex bg-background">
            <aside className="hidden md:flex w-64 shrink-0 border-r border-border">
                <SidebarContent user={user} />
            </aside>

            <div className="flex-1 flex flex-col min-w-0">
                <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/90 backdrop-blur px-4 md:px-6">
                    <Sheet open={open} onOpenChange={setOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="md:hidden" data-testid="open-sidebar-button">
                                <Menu className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="p-0 w-72 border-border">
                            <SidebarContent user={user} onNav={() => setOpen(false)} />
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
