import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAssistant } from '@/contexts/AssistantContext';
import { useNotify } from '@/contexts/NotifyContext';
import { pendingAnnouncement, textFor } from '@/lib/assistant/phrases';

/**
 * useAnnouncements — turns live bus events into speech.
 *
 * Reuses the SSE feed already consumed by NotifyContext (`lastEvent`) and the
 * existing read endpoints only. It never mutates anything: commands live in a
 * later phase and go through the same endpoints as the UI.
 */
export default function useAnnouncements() {
    const { user } = useAuth();
    const { enabled, announce } = useAssistant();
    const { lastEvent } = useNotify();
    const tablesRef = useRef(new Map());
    const handledRef = useRef(null);

    // Light table_id → number cache so phrases can say "mesa 5".
    useEffect(() => {
        if (!enabled || !user) return undefined;
        let active = true;
        const load = () => api.get('/tables')
            .then((res) => {
                if (!active) return;
                const map = new Map();
                for (const table of res.data || []) map.set(table.id, table.number);
                tablesRef.current = map;
            })
            .catch(() => { /* keep the previous cache */ });
        load();
        const timer = setInterval(load, 60000);
        return () => { active = false; clearInterval(timer); };
    }, [enabled, user]);

    useEffect(() => {
        if (!enabled || !user || !lastEvent) return;
        if (handledRef.current === lastEvent) return;
        handledRef.current = lastEvent;

        const item = pendingAnnouncement(lastEvent, user.role);
        if (!item) return;

        const emit = (extra = {}) => {
            const text = textFor(item, extra);
            if (text) announce({ ...item, text });
        };

        if (item.kind === 'bill') {
            emit({ table: tablesRef.current.get(lastEvent.table_id) });
            return;
        }

        // Order events don't carry the table, so resolve it once.
        api.get(`/orders/${item.refId}`)
            .then(({ data }) => {
                const order = data || {};
                const table = order.table_id ? tablesRef.current.get(order.table_id) : null;
                const count = (order.items || []).reduce((sum, it) => sum + (it.quantity || 0), 0);
                emit({ table, count, orderType: order.order_type });
            })
            .catch(() => emit());
    }, [enabled, lastEvent, user, announce]);
}
