import { homeFor as homeForUser } from '@/lib/functions';

export const ROLE_HOME = {
    mozo: '/salon',
    cocina: '/cocina',
    cajero: '/caja',
    admin: '/salon',
};

export function homeFor(userOrRole) {
    return homeForUser(userOrRole);
}
