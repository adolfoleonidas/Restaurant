/**
 * Medidor en pantalla. Se enciende con `?diag=1` y **se queda encendido** en ese
 * teléfono (se recuerda en el dispositivo), así que también mide el enlace normal
 * y una sesión de todo el turno, no solo una pantalla recién abierta. Con
 * `?diag=0` se apaga.
 *
 * Existe porque el problema real es intermitente y depende del uso ("pido un
 * pedido, lo envío, y el segundo demora más"), y eso no se puede diagnosticar
 * desde afuera. Mide cinco cosas:
 *
 *   - TOQUE: la duración del propio evento, partida en "hilo ocupado" (el
 *     navegador tardó en atender el dedo) y "código" (lo que tardó el manejador).
 *   - EFECTO: desde el toque hasta que **la cantidad cambia en pantalla**, que es
 *     lo que el mozo percibe, y cuántos toques **no cambiaron nada**. Un toque
 *     puede tardar 20 ms en procesarse y no hacer nada visible: el evento dice
 *     "rápido" y el mozo ve "no pasó nada".
 *   - RED: las peticiones más lentas del período, con su peso. Así se ve si el
 *     costo está en el servidor o en la pantalla.
 *   - TAREAS LARGAS: cuántas veces el hilo principal se bloqueó más de 50 ms.
 *   - FPS, versión, pantalla, orientación y nodos.
 *
 * Se lee de un vistazo o en una captura, y además cada muestra viaja al servidor
 * (`POST /api/diag/sample`) para poder leerla desde afuera.
 */
import { api } from '@/lib/api';

export const PANEL_ID = 'dmi-perf';
export const DIAG_KEY = 'restaurant_diag';
const PANEL_ROWS = ['version', 'viewport', 'tap', 'effect', 'net', 'long', 'fps'];

/** Un toque que no cambió nada en este plazo cuenta como "no hizo nada". */
const SILENT_MS = 2000;
/** Cuántas peticiones lentas se reportan por muestra. */
const SLOW_REQUESTS = 3;

/** Por defecto, cada muestra viaja al servidor para poder leerla desde afuera. */
function defaultSend(sample) {
    return api.post('/diag/sample', sample);
}

/**
 * ¿La pantalla pidió el medidor?
 *
 * `?diag=1` lo enciende y lo deja encendido en ESTE dispositivo; `?diag=0` lo
 * apaga. Sin parámetro, manda lo que el dispositivo recuerde.
 */
export function perfMeterEnabled(search = '', storage = null) {
    let value = null;
    try {
        value = new URLSearchParams(search).get('diag');
    } catch {
        return false;
    }
    try {
        if (value === '1') {
            storage?.setItem(DIAG_KEY, '1');
            return true;
        }
        if (value === '0') {
            storage?.removeItem(DIAG_KEY);
            return false;
        }
        return storage?.getItem(DIAG_KEY) === '1';
    } catch {
        return value === '1';
    }
}

/** Percentil de una lista (0-100). `null` si está vacía. */
export function percentile(values, p) {
    if (!values || !values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[index];
}

/** Lo que se muestra de una lista de medidas. */
export function summarize(values) {
    if (!values || !values.length) return { n: 0, p50: null, max: null };
    return { n: values.length, p50: percentile(values, 50), max: percentile(values, 100) };
}

/** La versión de la app que se está ejecutando, leída del bundle cargado. */
export function runningVersion(doc) {
    const node = doc && doc.querySelector && doc.querySelector('script[src*="/static/js/main."]');
    const found = node && /main\.([0-9a-f]+)\.js/.exec(node.getAttribute('src') || '');
    return found ? found[1] : 'desconocida';
}

const PRODUCT_PREFIX = '-producto-nombre-';
const CARD_SELECTOR = `[data-testid*="${PRODUCT_PREFIX}"]`;

/** El producto de la tarjeta que se tocó, o null si el toque no fue a una. */
export function productIdFrom(target) {
    const card = target && target.closest && target.closest(CARD_SELECTOR);
    if (!card) return null;
    const testid = card.getAttribute('data-testid') || '';
    const index = testid.indexOf(PRODUCT_PREFIX);
    return index < 0 ? null : testid.slice(index + PRODUCT_PREFIX.length);
}

/** Las peticiones más lentas desde `since`, para ver dónde se va la red. */
export function slowestRequests(win, since, limit = SLOW_REQUESTS) {
    try {
        const entries = win.performance.getEntriesByType('resource') || [];
        return entries
            .filter((entry) => entry.startTime >= since
                && (entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest'))
            .sort((a, b) => b.duration - a.duration)
            .slice(0, limit)
            .map((entry) => ({
                // Sin el origen: lo que importa es la ruta y cuánto tardó.
                url: String(entry.name).replace(/^https?:\/\/[^/]+/, '').slice(0, 90),
                ms: Math.round(entry.duration),
                kb: Math.round((entry.transferSize || entry.encodedBodySize || 0) / 1024),
            }));
    } catch {
        return [];
    }
}

/**
 * La muestra que se manda al servidor. Pura: se puede probar sin navegador.
 *
 * Va también el `userAgent`: es la única forma de saber en qué teléfono y en qué
 * navegador se está midiendo.
 */
export function buildSample({
    taps = [], visible = [], silent = 0, requests = [], longs = [], fps = null,
    win = window, doc = win && win.document,
} = {}) {
    const portrait = (win.innerHeight || 0) >= (win.innerWidth || 0);
    const durations = taps.map((entry) => entry.duration);
    const delays = taps.map((entry) => entry.inputDelay);
    const code = taps.map((entry) => entry.processing);
    return {
        version: runningVersion(doc),
        screen: `${win.innerWidth || 0}x${win.innerHeight || 0} ${portrait ? 'vertical' : 'horizontal'}`,
        viewport: {
            w: win.innerWidth || 0,
            h: win.innerHeight || 0,
            orientation: portrait ? 'vertical' : 'horizontal',
            dpr: win.devicePixelRatio || 1,
            nodes: doc && doc.querySelectorAll ? doc.querySelectorAll('*').length : 0,
            ua: (win.navigator && win.navigator.userAgent) || '',
        },
        taps: { ...summarize(durations), busy: summarize(delays).p50, code: summarize(code).p50 },
        // Lo que el mozo percibe: el toque hasta que la cantidad cambia, y los
        // toques que no cambiaron nada.
        visible: { ...summarize(visible), silent },
        requests: requests.slice(0, SLOW_REQUESTS),
        longs: { n: longs.length, max: longs.length ? Math.max(...longs) : 0 },
        fps,
    };
}

const row = (doc, label) => {
    const line = doc.createElement('div');
    line.setAttribute('data-row', label);
    line.style.cssText = 'display:flex;gap:8px;white-space:nowrap;font:12px/1.5 ui-monospace,monospace';
    const key = doc.createElement('span');
    key.textContent = label.toUpperCase().padEnd(9, ' ');
    key.style.cssText = 'opacity:.65;flex:none';
    const value = doc.createElement('span');
    value.style.cssText = 'font-weight:700';
    line.append(key, value);
    return { line, value };
};

/**
 * Enciende el medidor. Devuelve cómo apagarlo (y quitarlo de la pantalla).
 * No usa animaciones ni transiciones: se actualiza a saltos, como el resto.
 *
 * `send` recibe cada muestra y por defecto la manda al servidor, para poder leerla
 * desde afuera: la pantalla del teléfono no se puede mirar a distancia.
 */
export function installPerfMeter({
    win = window,
    doc = (win && win.document),
    send = defaultSend,
    reportEveryMs = 5000,
} = {}) {
    if (!win || !doc || doc.getElementById(PANEL_ID)) return () => {};

    const taps = [];
    const visible = [];
    const pending = [];
    const longs = [];
    let silent = 0;
    let requests = [];
    let frames = 0;
    let fps = null;
    let rafId = null;
    let timerId = null;
    let observer = null;
    let longObserver = null;
    let reportedTaps = 0;
    let lastReportAt = 0;

    const clock = () => (win.performance && win.performance.now ? win.performance.now() : Date.now());

    const panel = doc.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('data-testid', 'perf-meter');
    panel.style.cssText = [
        'position:fixed', 'left:8px', 'right:8px', 'bottom:8px', 'z-index:2147483647',
        'background:#0b0f17', 'color:#e8eef7', 'padding:10px 12px', 'border-radius:10px',
        'box-shadow:0 6px 20px rgba(0,0,0,.45)', 'pointer-events:none',
    ].join(';');
    const title = doc.createElement('div');
    title.textContent = 'MEDIDOR · apágalo con ?diag=0';
    title.style.cssText = 'font:10px/1.4 ui-monospace,monospace;letter-spacing:.08em;opacity:.6;margin-bottom:6px';
    panel.appendChild(title);
    const rows = {};
    for (const name of PANEL_ROWS) {
        const { line, value } = row(doc, name);
        rows[name] = value;
        panel.appendChild(line);
    }
    doc.body.appendChild(panel);

    const paint = () => {
        rows.version.textContent = runningVersion(doc);
        const portrait = (win.innerHeight || 0) >= (win.innerWidth || 0);
        rows.viewport.textContent = `${win.innerWidth}x${win.innerHeight} ${portrait ? 'vertical' : 'horizontal'} `
            + `dpr ${win.devicePixelRatio || 1} nodos ${doc.querySelectorAll('*').length}`;
        const total = summarize(taps.map((t) => t.duration));
        rows.tap.textContent = total.p50 === null
            ? 'sin toques todavía (toca un producto)'
            : `${total.p50} ms p50 · ${total.max} ms peor (n=${total.n})   `
                + `hilo ocupado ${summarize(taps.map((t) => t.inputDelay)).p50} ms · `
                + `código ${summarize(taps.map((t) => t.processing)).p50} ms`;
        const effect = summarize(visible);
        rows.effect.textContent = effect.n === 0 && silent === 0
            ? 'sin toques a productos'
            : `${effect.p50 === null ? '—' : `${effect.p50} ms p50`}`
                + `${effect.max === null ? '' : ` · ${effect.max} ms peor`}`
                + ` · ${effect.n} con efecto`
                + `${silent ? ` · ${silent} SIN EFECTO` : ''}`;
        rows.net.textContent = requests.length
            ? requests.map((r) => `${r.ms} ms ${r.kb} KB ${r.url.split('/api/')[1] || r.url}`).join(' | ')
            : 'sin peticiones medidas';
        const worst = longs.length ? Math.max(...longs) : 0;
        rows.long.textContent = `${longs.length} tareas >50 ms · peor ${worst} ms`;
        rows.fps.textContent = fps === null ? '…' : `${fps} fps`;
    };

    if (typeof win.PerformanceObserver === 'function') {
        try {
            observer = new win.PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (!/pointerdown|click|touchstart/.test(entry.name)) continue;
                    taps.push({
                        duration: Math.round(entry.duration),
                        inputDelay: Math.round((entry.processingStart || 0) - entry.startTime),
                        processing: Math.round((entry.processingEnd || 0) - (entry.processingStart || 0)),
                    });
                }
            });
            observer.observe({ type: 'event', durationThreshold: 0, buffered: true });
        } catch { observer = null; }
        try {
            longObserver = new win.PerformanceObserver((list) => {
                for (const entry of list.getEntries()) longs.push(Math.round(entry.duration));
            });
            longObserver.observe({ entryTypes: ['longtask'] });
        } catch { longObserver = null; }
    }

    // El efecto del toque: se anota la cantidad que se ve al tocar y se espera a
    // que cambie. Se mira en el mismo latido de fotogramas, sin coste extra.
    const onPointerDown = (event) => {
        const productId = productIdFrom(event.target);
        if (!productId) return;
        const qty = doc.querySelector(`[data-testid$="-producto-cantidad-${productId}"]`);
        if (!qty) return;
        pending.push({ at: clock(), before: qty.textContent.trim(), qty });
    };
    if (doc.addEventListener) doc.addEventListener('pointerdown', onPointerDown, true);

    const checkPending = () => {
        const now = clock();
        for (let i = pending.length - 1; i >= 0; i -= 1) {
            const tap = pending[i];
            if (tap.qty.textContent.trim() !== tap.before) {
                visible.push(Math.round(now - tap.at));
                pending.splice(i, 1);
            } else if (now - tap.at > SILENT_MS) {
                silent += 1;
                pending.splice(i, 1);
            }
        }
    };

    // FPS: se cuentan fotogramas por segundo, sin medir nada más.
    const requestFrame = win.requestAnimationFrame
        ? (fn) => win.requestAnimationFrame(fn)
        : (fn) => win.setTimeout(fn, 16);
    let windowStart = Date.now();
    const tick = () => {
        frames += 1;
        checkPending();
        const elapsed = Date.now() - windowStart;
        if (elapsed >= 1000) {
            fps = Math.round((frames * 1000) / elapsed);
            frames = 0;
            windowStart = Date.now();
        }
        rafId = requestFrame(tick);
    };
    rafId = requestFrame(tick);

    // Cada medio segundo: refrescar la pantalla y, de vez en cuando, mandar la
    // muestra (solo si hubo toques nuevos). Un fallo al mandar no molesta a nadie:
    // es un diagnóstico, no una acción del mozo.
    const beat = () => {
        paint();
        if (taps.length > reportedTaps && clock() - lastReportAt >= reportEveryMs) {
            reportedTaps = taps.length;
            requests = slowestRequests(win, lastReportAt);
            lastReportAt = clock();
            try {
                Promise.resolve(send(buildSample({
                    taps, visible, silent, requests, longs, fps, win, doc,
                }))).catch(() => {});
                if (win.performance && win.performance.clearResourceTimings) win.performance.clearResourceTimings();
            } catch { /* el medidor nunca rompe la app */ }
        }
    };
    timerId = win.setInterval(beat, 500);
    paint();

    return () => {
        if (timerId !== null) win.clearInterval(timerId);
        if (rafId !== null) {
            if (win.cancelAnimationFrame) win.cancelAnimationFrame(rafId);
            else win.clearTimeout(rafId);
        }
        if (observer) observer.disconnect();
        if (longObserver) longObserver.disconnect();
        if (doc.removeEventListener) doc.removeEventListener('pointerdown', onPointerDown, true);
        panel.remove();
    };
}

export default installPerfMeter;
