import { useEffect, useState } from 'react';
import { API } from '@/lib/api';

export default function usePublicStream({ restaurantId, trackingCode } = {}) {
    const [generation, setGeneration] = useState(0);
    const [lastEvent, setLastEvent] = useState(null);

    const key = trackingCode
        ? `tracking=${encodeURIComponent(trackingCode)}`
        : (restaurantId ? `restaurant_id=${encodeURIComponent(restaurantId)}` : null);

    useEffect(() => {
        if (!key) return undefined;
        const ctrl = new AbortController();
        let stopped = false;

        const connect = async () => {
            while (!stopped) {
                try {
                    const res = await fetch(`${API}/public/stream?${key}`, {
                        headers: { Accept: 'text/event-stream' },
                        signal: ctrl.signal,
                    });
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
                    await new Promise((r) => setTimeout(r, 1500));
                }
            }
        };

        connect();
        return () => {
            stopped = true;
            ctrl.abort();
        };
    }, [key]);

    return { generation, lastEvent };
}
