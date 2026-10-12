import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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

export function NotifyProvider({ children }) {
    const { user } = useAuth();
    const uid = user?.id;
    const [generation, setGeneration] = useState(0);
    const [lastEvent, setLastEvent] = useState(null);

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
                if (!stopped) setGeneration((g) => g + 1);
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
                    if (connectedBefore) setGeneration((g) => g + 1);
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
    }, [uid]);

    const value = useMemo(() => ({ generation, lastEvent }), [generation, lastEvent]);

    return (
        <NotifyContext.Provider value={value}>
            {children}
        </NotifyContext.Provider>
    );
}

export const useNotify = () => useContext(NotifyContext);
