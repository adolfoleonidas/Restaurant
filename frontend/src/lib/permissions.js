/**
 * Single source of truth for who can open which screen and who can do what.
 *
 * - `ROUTE_ROLES`: the role guard of every protected route (App.js reads it).
 * - `NAV_ITEMS` / `navItemsFor`: the menu (AppShell reads it).
 * - `can(user, action)`: the in-screen permission checks.
 *
 * The three are kept as they behaved before they were gathered here. Where the
 * menu and the route guards disagree (see `permissions.test.js`) the disagreement
 * is preserved and recorded for the usability stage, not silently fixed.
 */
import { canAccessRole, hasFn } from '@/lib/functions';

// ---- routes ---------------------------------------------------------------

/** Role guard per path. A path that is not listed has no role restriction. */
export const ROUTE_ROLES = {
    '/salon': ['admin', 'mozo', 'cajero'],
    '/local': ['admin'],
    '/pedidos': ['admin', 'mozo', 'cajero'],
    '/pedidos/nuevo': ['admin', 'mozo'],
    '/pedidos/:id': ['admin', 'mozo', 'cajero'],
    '/cocina': ['admin', 'cocina', 'mozo'],
    '/caja': ['admin', 'cajero'],
    '/comprobantes': ['admin', 'cajero'],
    '/reportes': ['admin'],
    '/disponibilidad': ['admin', 'cocina'],
    '/productos': ['admin'],
    // Menú del día: qué se vende hoy, separado del catálogo. Es del dueño (o del
    // encargado con `administracion`, que pasa por el mismo camino).
    '/menu': ['admin'],
    '/combos': ['admin'],
    '/categorias': ['admin'],
    '/usuarios': ['admin'],
    '/pagos': ['admin'],
    '/configuracion': ['admin'],
};

export const routeRoles = (path) => ROUTE_ROLES[path] || [];

export const canAccessRoute = (user, path) => canAccessRole(user, routeRoles(path));

// ---- navigation -----------------------------------------------------------
// `icon` is a key the shell maps to a component, so this module has no UI imports.

export const NAV_ITEMS = [
    { to: '/dashboard', label: 'Hoy', icon: 'dashboard', roles: ['admin'], group: 'main' },
    { to: '/salon', label: 'Salón', icon: 'salon', roles: ['admin', 'mozo', 'cajero'], group: 'main' },
    { to: '/productos', label: 'Carta', icon: 'catalog', roles: ['admin'], group: 'main' },
    { to: '/menu', label: 'Menú de hoy', icon: 'catalog', roles: ['admin'], group: 'main' },
    { to: '/caja', label: 'Caja', icon: 'cash', roles: ['admin', 'cajero'], group: 'main' },
    { to: '/comprobantes', label: 'Comprobantes', icon: 'receipt', roles: ['admin', 'cajero'], group: 'main' },
    { to: '/reportes', label: 'Reportes', icon: 'reports', roles: ['admin'], group: 'main' },
    { to: '/cocina', label: 'Cocina', icon: 'kitchen', roles: ['cocina'], group: 'main' },
    { to: '/disponibilidad', label: 'Disponibilidad', icon: 'catalog', roles: ['cocina'], group: 'main' },
    { to: '/pedidos', label: 'Pedidos', icon: 'receipt', roles: ['mozo', 'cajero'], group: 'main' },
    { to: '/pedidos', label: 'Pedidos', icon: 'receipt', roles: ['admin'], group: 'more' },
    { to: '/cocina', label: 'Cocina', icon: 'kitchen', roles: ['admin'], group: 'more' },
    // Combos y Categorías dejan de ser ítems propios del menú: los dos son
    // accesos al mismo formulario de "Carta" (Combos es un tab de Productos y
    // Categorías se abre desde su botón). Antes el menú ofrecía tres accesos a
    // lo mismo y no decía dónde gestionar la carta.
    { to: '/pagos', label: 'Datos de cobro', icon: 'payments', roles: ['admin'], group: 'more' },
    { to: '/local', label: 'Local', icon: 'store', roles: ['admin'], group: 'more' },
    { to: '/usuarios', label: 'Equipo', icon: 'team', roles: ['admin'], group: 'more' },
    { to: '/configuracion', label: 'Configuración', icon: 'settings', roles: ['admin'], group: 'more' },
];

// Un solo origen de verdad para el menú: se filtra NAV_ITEMS por rol y por
// funciones y se deduplica por destino. Antes había dos problemas: el menú
// se reemplazaba entero para los perfiles multifunción (un admin que también
// atiende y cobra perdía "Pedidos") y dos entradas del mismo destino podían
// coexistir (mozo/cajero con administracion). Lo comparten la hoja lateral
// (escritorio y móvil) y la barra inferior del móvil, para que las dos
// superficies no puedan divergir.
export const navItemsFor = (user) => {
    const seen = new Set();
    return NAV_ITEMS.filter((n) => {
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

// ---- actions --------------------------------------------------------------

export const ACTIONS = {
    OWNER: 'owner',
    SALON_SERVE: 'salon.serve',
    SALON_TAKE: 'salon.take',
    SALON_CLOSE: 'salon.close',
    SALON_CHARGE: 'salon.charge',
    CASH_DISCOUNT: 'cash.discount',
    CASH_VOID: 'cash.void',
    CASH_SUBMIT_PROOF: 'cash.submitProof',
    ORDER_EDIT: 'order.edit',
    ORDER_COLLECT: 'order.collect',
    ORDER_SERVE: 'order.serve',
    ORDER_REASSIGN: 'order.reassign',
    ORDER_CANCEL: 'order.cancel',
};

const roleIn = (...roles) => (user) => roles.includes(user?.role);

const RULES = {
    // The owner sees the whole business (every branch) and the admin panels.
    [ACTIONS.OWNER]: (user) => user?.role === 'admin' || hasFn(user, 'administracion'),
    [ACTIONS.SALON_SERVE]: roleIn('admin', 'mozo', 'cocina'),
    [ACTIONS.SALON_TAKE]: roleIn('admin', 'mozo'),
    [ACTIONS.SALON_CLOSE]: roleIn('admin', 'mozo', 'cajero'),
    [ACTIONS.SALON_CHARGE]: (user) => hasFn(user, 'cobro', 'administracion'),
    [ACTIONS.CASH_DISCOUNT]: (user) => user?.role === 'admin' || !!user?.can_discount,
    [ACTIONS.CASH_VOID]: (user) => user?.role === 'admin' || !!user?.can_void,
    [ACTIONS.CASH_SUBMIT_PROOF]: (user) => user?.role === 'admin' || user?.role === 'cajero'
        || user?.functions?.includes('cobro') || user?.functions?.includes('administracion'),
    // Edit / create orders and send them to the kitchen.
    [ACTIONS.ORDER_EDIT]: roleIn('admin', 'mozo'),
    [ACTIONS.ORDER_COLLECT]: (user) => hasFn(user, 'cobro', 'administracion'),
    [ACTIONS.ORDER_SERVE]: (user) => hasFn(user, 'preparacion', 'atencion', 'administracion'),
    [ACTIONS.ORDER_REASSIGN]: roleIn('admin'),
    [ACTIONS.ORDER_CANCEL]: roleIn('admin', 'cajero'),
};

/** Whether `user` may perform `action`. No user, or an unknown action, means no. */
export const can = (user, action) => Boolean(user) && Boolean(RULES[action]?.(user));

export const isOwner = (user) => can(user, ACTIONS.OWNER);
