import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { API } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const WAKE_DEBOUNCE_MS = 300;
const RECONNECT_PAUSE_MS = 500;
// A burst of events (one waiter's quick taps, a table moving) asks the screens
// to refetch once: the bump waits for the stream to go quiet, but never longer
// than the max wait, so a busy service still refreshes while events keep coming.
const EVENT_DEBOUNCE_MS = 250;
const EVENT_MAX_WAIT_MS = 1000;

const NotifyContext = createContext({ generation: 0, lastEvent: null });

// The hub fans each stream event out to the screens that asked for its topic.
// It lives apart from `NotifyContext` and never changes identity, so a realtime
// event re-renders only the screens whose topics it touches (not every consumer).
const HubContext = createContext(null);

// The vocabulary of backend/notify.py. A topic outside it comes from a newer
// backend than this client, which cannot tell what it affects.
const KNOWN_TOPICS = new Set([
    'orders', 'kitchen', 'payments', 'prepay', 'tables', 'cash', 'catalog', 'approvals',
]);

/**
 * Topics an event announces, or null when it says nothing usable (legacy events,
 * unknown kinds, topics this client does not know): null refreshes everyone.
 */
function eventTopics(ev) {
    let topics = null;
    if (Array.isArray(ev?.topics) && ev.topics.length) topics = ev.topics;
    else if (typeof ev?.topic === 'string' && ev.topic) topics = [ev.topic];
    if (!topics || topics.some((topic) => !KNOWN_TOPICS.has(topic))) return null;
    return topics;
}

function createHub() {
    const subscribers = new Set();
    return {
        subscribe(sub) {
            subscribers.add(sub);
            return () => { subscribers.delete(sub); };
        },
        // One stream event.
        event(ev) {
            const topics = eventTopics(ev);
            [...subscribers].forEach((sub) => sub.onEvent(ev, topics));
        },
        // Reconnect and wake: events may have been missed, so everyone refreshes.
        all() {
            [...subscribers].forEach((sub) => sub.onAll());
        },
    };
}

export function NotifyProvider({ children }) {
    const { user } = useAuth();
    const uid = user?.id;
    const [generation, setGeneration] = useState(0);
    const [lastEvent, setLastEvent] = useState(null);
    const hubRef = useRef(null);
    if (!hubRef.current) hubRef.current = createHub();
    const hub = hubRef.current;

    useEffect(() => {
        if (!uid) return undefined;
        const token = localStorage.getItem('token');
        if (!token) return undefined;

        const ctrl = new AbortController();
        let stopped = false;
        let connectedBefore = false;
        let wakeTimer = null;
        let eventTimer = null;
        let eventMaxTimer = null;

        const flushEvents = () => {
            clearTimeout(eventTimer);
            clearTimeout(eventMaxTimer);
            eventTimer = null;
            eventMaxTimer = null;
            if (!stopped) setGeneration((g) => g + 1);
        };
        // Every event restarts the quiet period; the first one of a burst also
        // arms the max wait.
        const scheduleEventBump = () => {
            clearTimeout(eventTimer);
            eventTimer = setTimeout(flushEvents, EVENT_DEBOUNCE_MS);
            if (!eventMaxTimer) eventMaxTimer = setTimeout(flushEvents, EVENT_MAX_WAIT_MS);
        };

        // Screens refetch when `generation` changes. Waking up (tab visible again,
        // network back, window focused) may have missed events while the stream was
        // asleep, so one wake bumps once: the three signals usually arrive together.
        const wake = () => {
            if (wakeTimer) return;
            wakeTimer = setTimeout(() => {
                wakeTimer = null;
                if (stopped) return;
                setGeneration((g) => g + 1);
                hub.all();
            }, WAKE_DEBOUNCE_MS);
        };
        const onVisibility = () => { if (document.visibilityState === 'visible') wake(); };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('online', wake);
        window.addEventListener('focus', wake);

        const connect = async () => {
            while (!stopped) {
                try {
                    const res = await fetch(`${API}/notifications/stream`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            Accept: 'text/event-stream',
                        },
                        signal: ctrl.signal,
                    });
                    // Sin permiso (p. ej. usuario sin sucursal) reintentar no cambia nada:
                    // se deja de insistir hasta que el usuario inicie sesión de nuevo.
                    if (res.status === 403) return;
                    if (!res.ok || !res.body) throw new Error('stream');
                    // Back after a drop: whatever was published meanwhile never reached us.
                    if (connectedBefore) {
                        setGeneration((g) => g + 1);
                        hub.all();
                    }
                    connectedBefore = true;
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buf = '';
                    while (!stopped) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buf += decoder.decode(value, { stream: true });
                        const chunks = buf.split('\n\n');
                        buf = chunks.pop() || '';
                        for (const chunk of chunks) {
                            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
                            if (!line) continue;
                            let ev;
                            try { ev = JSON.parse(line.slice(6)); } catch { continue; }
                            if (!ev || ev.type === 'hello') continue;
                            setLastEvent(ev);
                            scheduleEventBump();
                            hub.event(ev);
                        }
                    }
                    // The server ended the stream (e.g. it dropped a slow client): reconnect.
                    if (!stopped) await new Promise((r) => setTimeout(r, RECONNECT_PAUSE_MS));
                } catch (e) {
                    if (stopped || ctrl.signal.aborted) return;
                    await new Promise((r) => setTimeout(r, 1200));
                }
            }
        };

        connect();
        return () => {
            stopped = true;
            ctrl.abort();
            if (wakeTimer) clearTimeout(wakeTimer);
            clearTimeout(eventTimer);
            clearTimeout(eventMaxTimer);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('online', wake);
            window.removeEventListener('focus', wake);
        };
    }, [uid, hub]);

    const value = useMemo(() => ({ generation, lastEvent }), [generation, lastEvent]);

    return (
        <HubContext.Provider value={hub}>
            <NotifyContext.Provider value={value}>
                {children}
            </NotifyContext.Provider>
        </HubContext.Provider>
    );
}

export const useNotify = () => useContext(NotifyContext);

/**
 * A counter that changes when something this screen shows may have changed.
 *
 * `topics` are the realtime topics the screen renders (see backend/notify.py);
 * `filter(event)` narrows them further (e.g. only events of the order on screen).
 * It coalesces like `useNotify().generation` (250 ms trailing, 1 s max wait).
 *
 * Always refreshes, whatever the topics or filter: reconnect, wake, and events
 * that carry no topic (legacy or unknown kinds), so nothing can go stale.
 */
export function useRealtimeGeneration(topics, filter) {
    const hub = useContext(HubContext);
    const [generation, setGeneration] = useState(0);
    const key = (Array.isArray(topics) ? topics : [topics]).join('|');
    const filterRef = useRef(filter);
    filterRef.current = filter;

    useEffect(() => {
        if (!hub) return undefined;
        const wanted = new Set(key.split('|'));
        let closed = false;
        let quietTimer = null;
        let maxTimer = null;

        const clear = () => {
            clearTimeout(quietTimer);
            clearTimeout(maxTimer);
            quietTimer = null;
            maxTimer = null;
        };
        const bump = () => {
            clear();
            if (!closed) setGeneration((g) => g + 1);
        };
        const schedule = () => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(bump, EVENT_DEBOUNCE_MS);
            if (!maxTimer) maxTimer = setTimeout(bump, EVENT_MAX_WAIT_MS);
        };
        const passes = (ev) => {
            if (!filterRef.current) return true;
            try { return Boolean(filterRef.current(ev)); } catch { return true; }
        };

        const off = hub.subscribe({
            onEvent(ev, evTopics) {
                // No topic: nothing says what changed, so everything refreshes.
                if (evTopics) {
                    if (!evTopics.some((t) => wanted.has(t))) return;
                    if (!passes(ev)) return;
                }
                schedule();
            },
            onAll: bump,
        });
        return () => {
            closed = true;
            clear();
            off();
        };
    }, [hub, key]);

    return generation;
}
