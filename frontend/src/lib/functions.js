export const FN_LABELS = {
    atencion: 'Atención',
    preparacion: 'Preparación',
    cobro: 'Cobro',
    administracion: 'Administración',
};

export const ROLE_FUNCTIONS = {
    admin: ['atencion', 'preparacion', 'cobro', 'administracion'],
    mozo: ['atencion'],
    cocina: ['preparacion'],
    cajero: ['cobro'],
};

const ROLE_TO_FN = {
    admin: 'administracion',
    cajero: 'cobro',
    mozo: 'atencion',
    cocina: 'preparacion',
};

export function functionsOf(user) {
    if (Array.isArray(user?.functions) && user.functions.length) return user.functions;
    return ROLE_FUNCTIONS[user?.role] || [];
}

export function hasFn(user, ...fns) {
    const have = functionsOf(user);
    return fns.some((f) => have.includes(f));
}

export function homeFor(user) {
    if (!user) return '/login';
    if (typeof user === 'string') {
        return { mozo: '/mesas', cocina: '/cocina', cajero: '/caja', admin: '/servicio' }[user] || '/dashboard';
    }
    if (user.home) return user.home;
    const fns = functionsOf(user);
    const floor = fns.includes('atencion');
    const prep = fns.includes('preparacion');
    const cash = fns.includes('cobro');
    const admin = fns.includes('administracion');
    if (floor && (prep || cash)) return '/servicio';
    if (floor && !prep && !cash) return '/mesas';
    if (prep && !floor && !cash) return '/cocina';
    if (cash && !floor) return '/caja';
    if (admin) return '/dashboard';
    return '/mesas';
}

export function canAccessRole(user, roles) {
    if (!user) return false;
    if (!roles || roles.length === 0) return true;
    if (roles.includes(user.role)) return true;
    const fns = functionsOf(user);
    if (fns.includes('administracion')) return true;
    return roles.some((r) => fns.includes(ROLE_TO_FN[r]));
}
