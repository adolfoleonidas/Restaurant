import { useEffect, useState } from 'react';
import { API } from '@/lib/api';
import { STREAM_IDLE_MS, nextBackoffMs, withIdleTimeout } from '@/lib/streamResilience';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        // Consecutive failed attempts: drives the backoff, resets on a good connection.
        let failures = 0;

        const connect = async () => {
            while (!stopped) {
                // One controller per connection: the idle watchdog drops a dead
                // socket without ending the whole subscription (`ctrl`).
                const conn = new AbortController();
                const stop = () => conn.abort();
                ctrl.signal.addEventListener('abort', stop);
                let reader = null;
                try {
                    const res = await withIdleTimeout(fetch(`${API}/public/stream?${key}`, {
                        headers: { Accept: 'text/event-stream' },
                        signal: conn.signal,
                    }), STREAM_IDLE_MS, stop);
                    if (!res.ok || !res.body) throw new Error('stream');
                    failures = 0;
                    reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buf = '';
                    while (!stopped) {
                        // The server pings every 15 s: silence past the idle limit is a dead link.
                        const { done, value } = await withIdleTimeout(reader.read(), STREAM_IDLE_MS, stop);
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
                    // The server ended the stream: reconnect, but never in a tight loop.
                    if (!stopped) await pause(nextBackoffMs(0));
                } catch (e) {
                    if (stopped || ctrl.signal.aborted) return;
                    await pause(nextBackoffMs(failures));
                    failures += 1;
                } finally {
                    ctrl.signal.removeEventListener('abort', stop);
                    stop();
                    if (reader && reader.cancel) Promise.resolve(reader.cancel()).catch(() => {});
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
