import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import usePolling from '@/hooks/usePolling';
import { listOrders } from '@/lib/api/orders';
import { buildRoleNotifications } from '@/lib/roleNotifications';
import { fmtElapsed } from '@/lib/format';
import { useRealtimeGeneration } from '@/contexts/NotifyContext';

const SEEN_KEY = (userId) => `role-inbox-seen:${userId}`;

function loadSeen(userId) {
    try {
        const raw = sessionStorage.getItem(SEEN_KEY(userId));
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
        return new Set();
    }
}

function saveSeen(userId, ids) {
    try {
        sessionStorage.setItem(SEEN_KEY(userId), JSON.stringify([...ids]));
    } catch { /* ignore */ }
}

export function RoleInbox() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [seen, setSeen] = useState(() => loadSeen(user?.id));
    const [open, setOpen] = useState(false);
    // The inbox is built from the orders the kitchen, the cashier and the waiter
    // act on, so it skips the draft-line edits that never reach them.
    const generation = useRealtimeGeneration(['kitchen', 'payments', 'prepay']);

    // Misma llamada y mismo reloj que `useReadyDishes`: los dos montan juntos en el
    // shell, así que salen en fase y la capa de red comparte UNA descarga de la
    // lista en vez de bajar dos copias del mismo JSON de 16 KB cada ciclo. El
    // `limit: 80` que tenía antes la hacía una lectura distinta (el servidor ya
    // devuelve 200 por defecto, lo mismo que el piso).
    const { data: orders } = usePolling(
        () => listOrders({ active_only: true }).then((r) => r.data),
        25000,
        [user?.id, generation]
    );

    const items = useMemo(
        () => buildRoleNotifications(user?.role, orders || []),
        [user?.role, orders]
    );

    const unread = items.filter((it) => !seen.has(it.id));

    const onOpenChange = (next) => {
        setOpen(next);
        if (next && items.length) {
            const nextSeen = new Set([...seen, ...items.map((it) => it.id)]);
            setSeen(nextSeen);
            saveSeen(user.id, nextSeen);
        }
    };

    const go = (it) => {
        navigate(it.href);
        setOpen(false);
    };

    if (!user) return null;

    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="relative rounded-sm"
                    aria-label="Notificaciones"
                    data-testid="role-inbox-button"
                >
                    <Bell className="h-4 w-4" />
                    {unread.length > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-accent text-accent-foreground text-xs font-bold flex items-center justify-center">
                            {unread.length > 9 ? '9+' : unread.length}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-1rem))] p-0" data-testid="role-inbox-menu">
                <DropdownMenuLabel className="px-3 py-2">
                    {user.role === 'cocina' && 'Pases nuevos'}
                    {user.role === 'mozo' && 'Salón'}
                    {user.role === 'cajero' && 'Caja'}
                    {user.role === 'admin' && 'Actividad'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {items.length === 0 ? (
                    <div className="px-3 py-8 text-sm text-center text-muted-foreground">Nada nuevo por ahora.</div>
                ) : (
                    <div className="max-h-80 overflow-y-auto">
                        {items.map((it) => (
                            <DropdownMenuItem
                                key={it.id}
                                className={`flex flex-col items-start gap-0.5 px-3 py-2.5 cursor-pointer ${!seen.has(it.id) && !open ? 'font-semibold' : ''}`}
                                onSelect={() => go(it)}
                                data-testid={`role-inbox-item-${it.id}`}
                            >
                                <span className="text-sm leading-tight">{it.title}</span>
                                <span className="text-xs text-muted-foreground line-clamp-2">{it.body}</span>
                                {it.at && <span className="text-xs text-muted-foreground">{fmtElapsed(it.at)}</span>}
                            </DropdownMenuItem>
                        ))}
                    </div>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
