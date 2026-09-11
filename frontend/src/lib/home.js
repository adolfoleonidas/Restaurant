import { homeFor as homeForUser } from '@/lib/functions';

export const ROLE_HOME = {
    mozo: '/mesas',
    cocina: '/cocina',
    cajero: '/caja',
    admin: '/servicio',
};

export function homeFor(userOrRole) {
    return homeForUser(userOrRole);
}
