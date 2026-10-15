import {
    ROUTE_ROLES,
    NAV_ITEMS,
    routeRoles,
    canAccessRoute,
    navItemsFor,
    isOwner,
    can,
    ACTIONS,
} from '@/lib/permissions';
import { hasFn, canAccessRole } from '@/lib/functions';

// ---- oracle: the nav and the inline checks exactly as they were before the
// permission module existed. The new module must agree with them for every
// user below.
const LEGACY_NAV = [
    { to: '/dashboard', label: 'Hoy', roles: ['admin'], group: 'main' },
    { to: '/salon', label: 'Salón', roles: ['admin', 'mozo', 'cajero'], group: 'main' },
    { to: '/productos', label: 'Carta', roles: ['admin'], group: 'main' },
    { to: '/gestion/menu', label: 'Menú de hoy', roles: ['admin'], group: 'main' },
    { to: '/caja', label: 'Caja', roles: ['admin', 'cajero'], group: 'main' },
    { to: '/comprobantes', label: 'Comprobantes', roles: ['admin', 'cajero'], group: 'main' },
    { to: '/reportes', label: 'Reportes', roles: ['admin'], group: 'main' },
    { to: '/cocina', label: 'Cocina', roles: ['cocina'], group: 'main' },
    { to: '/disponibilidad', label: 'Disponibilidad', roles: ['cocina'], group: 'main' },
    { to: '/pedidos', label: 'Pedidos', roles: ['mozo', 'cajero'], group: 'main' },
    { to: '/pedidos', label: 'Pedidos', roles: ['admin'], group: 'more' },
    { to: '/cocina', label: 'Cocina', roles: ['admin'], group: 'more' },
    { to: '/pagos', label: 'Datos de cobro', roles: ['admin'], group: 'more' },
    { to: '/local', label: 'Local', roles: ['admin'], group: 'more' },
    { to: '/usuarios', label: 'Equipo', roles: ['admin'], group: 'more' },
    { to: '/configuracion', label: 'Configuración', roles: ['admin'], group: 'more' },
];

const legacyNavItemsFor = (user) => {
    const seen = new Set();
    return LEGACY_NAV.filter((n) => {
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

const LEGACY_GUARDS = {
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
    '/gestion/menu': ['admin'],
    '/combos': ['admin'],
    '/categorias': ['admin'],
    '/usuarios': ['admin'],
    '/pagos': ['admin'],
    '/configuracion': ['admin'],
};

const ROLES = ['admin', 'mozo', 'cajero', 'cocina'];
const FN_SETS = [undefined, [], ['atencion'], ['preparacion'], ['cobro'], ['administracion'], ['atencion', 'cobro'], ['preparacion', 'cobro', 'atencion']];

const users = [];
for (const role of ROLES) {
    for (const functions of FN_SETS) {
        for (const can_discount of [false, true]) {
            users.push({
                id: `${role}-${(functions || ['none']).join('+') || 'empty'}-${can_discount}`, role, functions, can_discount, can_void: can_discount,
            });
        }
    }
}

describe('route access', () => {
    test('ROUTE_ROLES keeps today\'s guards', () => {
        expect(ROUTE_ROLES).toEqual(LEGACY_GUARDS);
        Object.entries(LEGACY_GUARDS).forEach(([path, roles]) => expect(routeRoles(path)).toEqual(roles));
        expect(routeRoles('/dashboard')).toEqual([]);
        expect(routeRoles('/nope')).toEqual([]);
    });

    test('canAccessRoute agrees with the role guard for every user', () => {
        users.forEach((u) => {
            Object.entries(LEGACY_GUARDS).forEach(([path, roles]) => {
                expect(canAccessRoute(u, path)).toBe(canAccessRole(u, roles));
            });
            expect(canAccessRoute(u, '/dashboard')).toBe(true);
        });
        expect(canAccessRoute(null, '/salon')).toBe(false);
    });
});

describe('charging from the floor', () => {
    /**
     * El botón "Cobrar" del salón manda a `/caja?order=<id>`. Eso es seguro solo
     * mientras quien puede cobrar pueda abrir la caja: si las dos reglas se
     * separaran, el mozo tocaría Cobrar y aterrizaría en "Sin autorización".
     */
    test('whoever may charge may open the cash screen', () => {
        const profiles = [
            { id: 'admin', role: 'admin' },
            { id: 'mozo', role: 'mozo' },
            { id: 'cajero', role: 'cajero' },
            { id: 'cocina', role: 'cocina' },
            { id: 'mozo-cobro', role: 'mozo', functions: ['atencion', 'cobro'] },
            { id: 'cocina-admin', role: 'cocina', functions: ['preparacion', 'administracion'] },
            { id: 'mozo-solo-atencion', role: 'mozo', functions: ['atencion'] },
            { id: 'cajero-sin-cobro', role: 'cajero', functions: ['atencion'] },
        ];
        profiles.forEach((user) => {
            if (can(user, ACTIONS.SALON_CHARGE)) {
                expect([user.id, canAccessRoute(user, '/caja')]).toEqual([user.id, true]);
            }
        });
        // La comprobación no es vacía: hay perfiles que sí pueden cobrar.
        expect(profiles.filter((u) => can(u, ACTIONS.SALON_CHARGE)).map((u) => u.id))
            .toEqual(['admin', 'cajero', 'mozo-cobro', 'cocina-admin']);
    });
});

describe('navigation', () => {
    test('NAV_ITEMS is the same menu as before', () => {
        expect(NAV_ITEMS.map(({ to, label, roles, group }) => ({ to, label, roles, group }))).toEqual(LEGACY_NAV);
        NAV_ITEMS.forEach((item) => expect(typeof item.icon).toBe('string'));
    });

    test('navItemsFor shows exactly the same entries for every user', () => {
        users.forEach((u) => {
            const expected = legacyNavItemsFor(u).map((n) => [n.to, n.label, n.group]);
            expect(navItemsFor(u).map((n) => [n.to, n.label, n.group])).toEqual(expected);
        });
    });

    test('known nav vs guard mismatches (recorded for stage 4, not fixed here)', () => {
        const NAV_ROUTES_WITH_GUARD = (u) => navItemsFor(u).map((n) => n.to);
        const mismatches = {};
        ROLES.forEach((role) => {
            const user = { id: role, role };
            const inNav = NAV_ROUTES_WITH_GUARD(user);
            const guarded = Object.keys(LEGACY_GUARDS).filter((p) => !p.includes(':') && p !== '/pedidos/nuevo');
            const reachableButHidden = guarded.filter((p) => canAccessRoute(user, p) && !inNav.includes(p));
            const listedButBlocked = inNav.filter((p) => LEGACY_GUARDS[p] && !canAccessRoute(user, p));
            mismatches[role] = { reachableButHidden: reachableButHidden.sort(), listedButBlocked };
        });
        expect(mismatches).toEqual({
            admin: { reachableButHidden: ['/categorias', '/combos'], listedButBlocked: [] },
            mozo: { reachableButHidden: ['/cocina'], listedButBlocked: [] },
            cajero: { reachableButHidden: [], listedButBlocked: [] },
            cocina: { reachableButHidden: [], listedButBlocked: [] },
        });
    });

    test('/usuarios is hidden from non-admin roles even with the administracion function, but the guard lets them in', () => {
        const owner = { id: 'c', role: 'cajero', functions: ['administracion'] };
        expect(navItemsFor(owner).some((n) => n.to === '/usuarios')).toBe(false);
        expect(canAccessRoute(owner, '/usuarios')).toBe(true);
    });

    test('/dashboard has no guard but only the owner sees it in the menu', () => {
        const mozo = { id: 'm', role: 'mozo' };
        expect(canAccessRoute(mozo, '/dashboard')).toBe(true);
        expect(navItemsFor(mozo).some((n) => n.to === '/dashboard')).toBe(false);
    });
});

describe('can(user, action)', () => {
    const legacy = {
        owner: (u) => u?.role === 'admin' || hasFn(u, 'administracion'),
        'salon.serve': (u) => ['admin', 'mozo', 'cocina'].includes(u?.role),
        'salon.take': (u) => ['admin', 'mozo'].includes(u?.role),
        'salon.close': (u) => ['admin', 'mozo', 'cajero'].includes(u?.role),
        'salon.charge': (u) => hasFn(u, 'cobro', 'administracion'),
        'cash.discount': (u) => u?.role === 'admin' || !!u?.can_discount,
        'cash.void': (u) => u?.role === 'admin' || !!u?.can_void,
        'cash.submitProof': (u) => u?.role === 'admin' || u?.role === 'cajero'
            || u?.functions?.includes('cobro') || u?.functions?.includes('administracion'),
        'order.edit': (u) => ['admin', 'mozo'].includes(u.role),
        'order.collect': (u) => hasFn(u, 'cobro', 'administracion'),
        'order.serve': (u) => hasFn(u, 'preparacion', 'atencion', 'administracion'),
        'order.reassign': (u) => u.role === 'admin',
        'order.cancel': (u) => ['admin', 'cajero'].includes(u.role),
    };

    test('every action is defined and matches the inline rule it replaces', () => {
        expect(Object.values(ACTIONS).sort()).toEqual(Object.keys(legacy).sort());
        users.forEach((u) => {
            Object.entries(legacy).forEach(([action, rule]) => {
                expect(can(u, action)).toBe(Boolean(rule(u)));
            });
        });
    });

    test('isOwner is the owner action', () => {
        users.forEach((u) => expect(isOwner(u)).toBe(can(u, 'owner')));
    });

    test('the owner checks written against user.functions directly are equivalent', () => {
        users.forEach((u) => {
            const direct = u?.role === 'admin' || u?.functions?.includes('administracion');
            expect(Boolean(direct)).toBe(isOwner(u));
        });
    });

    test('no user means no permission, and an unknown action is denied', () => {
        expect(can(null, 'salon.take')).toBe(false);
        expect(can(undefined, 'owner')).toBe(false);
        expect(can({ role: 'admin' }, 'does.not.exist')).toBe(false);
    });
});
