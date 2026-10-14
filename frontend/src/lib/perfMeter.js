/**
 * Medidor en pantalla. Solo se enciende cuando se pide con `?diag=1`, así que en
 * el uso normal no existe ni cuesta nada.
 *
 * Existe por una razón concreta: el mismo toque se siente instantáneo en una
 * laptop y lento en el teléfono del local, y desde afuera no hay forma de saber
 * dónde se va ese tiempo. La única medida que vale es la del dispositivo que lo
 * sufre. Muestra cuatro cosas:
 *
 *   - TOQUE: la duración real de la interacción, partida en dos. "hilo ocupado"
 *     es lo que el navegador tardó en atender el dedo porque estaba haciendo otra
 *     cosa; "código" es lo que tardó el manejador de la app. Si el problema fuera
 *     mi código, el segundo número sería el grande.
 *   - TAREAS LARGAS: cuántas veces el hilo principal se quedó bloqueado más de
 *     50 ms, y el peor caso. Es lo que hace que el toque siguiente espere.
 *   - FPS: fotogramas por segundo reales.
 *   - El contexto: versión, tamaño de pantalla, orientación y cuántos nodos tiene
 *     la página.
 *
 * Se lee de un vistazo o en una captura: texto grande, un dato por línea.
 */
import { api } from '@/lib/api';

export const PANEL_ID = 'dmi-perf';
const PANEL_ROWS = ['version', 'viewport', 'tap', 'long', 'fps'];

/** Por defecto, cada muestra viaja al servidor para poder leerla desde afuera. */
function defaultSend(sample) {
    return api.post('/diag/sample', sample);
}

/** ¿La pantalla pidió el medidor? (`?diag=1`) */
export function perfMeterEnabled(search = '') {
    try {
        return new URLSearchParams(search).get('diag') === '1';
    } catch {
        return false;
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

/**
 * La muestra que se manda al servidor. Pura: se puede probar sin navegador.
 *
 * Va también el `userAgent`: es la única forma de saber en qué teléfono y en qué
 * navegador se está midiendo, que hasta ahora era una pregunta sin responder.
 */
export function buildSample({ taps = [], longs = [], fps = null, win = window, doc = win && win.document } = {}) {
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
    const longs = [];
    let frames = 0;
    let fps = null;
    let rafId = null;
    let timerId = null;
    let observer = null;
    let longObserver = null;
    let reportedTaps = 0;
    let lastReportAt = 0;

    const panel = doc.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('data-testid', 'perf-meter');
    panel.style.cssText = [
        'position:fixed', 'left:8px', 'right:8px', 'bottom:8px', 'z-index:2147483647',
        'background:#0b0f17', 'color:#e8eef7', 'padding:10px 12px', 'border-radius:10px',
        'box-shadow:0 6px 20px rgba(0,0,0,.45)', 'pointer-events:none',
    ].join(';');
    const title = doc.createElement('div');
    title.textContent = 'MEDIDOR · ?diag=1';
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
        const durations = taps.map((t) => t.duration);
        const delays = taps.map((t) => t.inputDelay);
        const code = taps.map((t) => t.processing);
        const total = summarize(durations);
        rows.tap.textContent = total.p50 === null
            ? 'sin toques todavía (toca un producto)'
            : `${total.p50} ms p50 · ${total.max} ms peor (n=${total.n})   `
                + `hilo ocupado ${summarize(delays).p50} ms · código ${summarize(code).p50} ms`;
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

    // FPS: se cuentan fotogramas por segundo, sin medir nada más.
    const requestFrame = win.requestAnimationFrame
        ? (fn) => win.requestAnimationFrame(fn)
        : (fn) => win.setTimeout(fn, 16);
    let windowStart = Date.now();
    const tick = () => {
        frames += 1;
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
        if (taps.length > reportedTaps && Date.now() - lastReportAt >= reportEveryMs) {
            reportedTaps = taps.length;
            lastReportAt = Date.now();
            try {
                Promise.resolve(send(buildSample({ taps, longs, fps, win, doc }))).catch(() => {});
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
        panel.remove();
    };
}

export default installPerfMeter;
