export const ROLE_HOME = {
    mozo: '/mesas',
    cocina: '/cocina',
    cajero: '/caja',
    admin: '/dashboard',
};

export function homeFor(role) {
    return ROLE_HOME[role] || '/dashboard';
}
