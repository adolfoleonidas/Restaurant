import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { useNotify } from '@/contexts/NotifyContext';

const ROLES = ['admin', 'cocina'];
const SEEN_KEY = (userId) => `kitchen-seen-ids:${userId}`;

function loadSeen(userId) {
    try {
        const raw = sessionStorage.getItem(SEEN_KEY(userId));
        return raw ? new Set(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

function saveSeen(userId, ids) {
    try {
        sessionStorage.setItem(SEEN_KEY(userId), JSON.stringify([...ids]));
    } catch { /* ignore */ }
}

function pingKitchen() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
    } catch { /* autoplay blocked until a gesture */ }
}

async function desktopNotify(title, body, onClick) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        const n = new Notification(title, { body, tag: 'sabor-cocina', silent: true });
        n.onclick = () => {
            window.focus();
            onClick?.();
            n.close();
        };
    } catch { /* ignore */ }
}

export function KitchenAlerts() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const enabled = user && ROLES.includes(user.role);
    const [permission, setPermission] = useState(
        typeof Notification === 'undefined' ? 'denied' : Notification.permission
    );
    const { generation } = useNotify();
    const { data: orders } = usePolling(
        () => (enabled ? api.get('/orders/kitchen').then((r) => r.data) : Promise.resolve([])),
        20000,
        [enabled, user?.id, generation]
    );

    useEffect(() => {
        if (!enabled || !user?.id) return;
        if (orders == null) return;

        const incoming = (orders || []).filter((o) => o.status === 'enviado_cocina');
        const seen = loadSeen(user.id);

        if (seen == null) {
            saveSeen(user.id, new Set((orders || []).map((o) => o.id)));
            return;
        }

        const fresh = incoming.filter((o) => !seen.has(o.id));
        const next = new Set([...(orders || []).map((o) => o.id), ...seen]);
        saveSeen(user.id, next);

        if (!fresh.length) return;

        pingKitchen();
        const first = fresh[0];
        const title = fresh.length === 1
            ? `Pedido #${first.order_number} en cocina`
            : `${fresh.length} pedidos nuevos en cocina`;
        const body = (first.items || []).slice(0, 3).map((it) => `${it.quantity}× ${it.product_name}`).join(', ') || 'Nuevo pase';
        toast(title, { description: body });
        desktopNotify(title, body, () => navigate('/cocina'));
    }, [enabled, orders, user?.id, navigate]);

    const enable = async () => {
        if (!('Notification' in window)) {
            toast.error('Este navegador no permite avisos');
            return;
        }
        const p = await Notification.requestPermission();
        setPermission(p);
        if (p === 'granted') toast.success('Avisos de cocina activados');
        else toast.error('No se concedieron los avisos');
    };

    if (!enabled) return null;

    if (permission === 'granted') return null;

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-sm hidden sm:inline-flex"
            onClick={enable}
            data-testid="kitchen-alerts-enable"
        >
            {permission === 'denied' ? <BellOff className="h-4 w-4 mr-1" /> : <Bell className="h-4 w-4 mr-1" />}
            Avisos cocina
        </Button>
    );
}
