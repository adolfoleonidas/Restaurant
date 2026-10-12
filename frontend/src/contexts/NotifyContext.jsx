import React, { createContext, useContext, useEffect, useState } from 'react';
import { API } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

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
                            setGeneration((g) => g + 1);
                        }
                    }
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
        };
    }, [uid]);

    return (
        <NotifyContext.Provider value={{ generation, lastEvent }}>
            {children}
        </NotifyContext.Provider>
    );
}

export const useNotify = () => useContext(NotifyContext);
