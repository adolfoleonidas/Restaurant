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
export const PANEL_ID = 'dmi-perf';

const PANEL_ROWS = ['version', 'viewport', 'tap', 'long', 'fps'];

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
 */
export function installPerfMeter({ win = window, doc = (win && win.document) } = {}) {
    if (!win || !doc || doc.getElementById(PANEL_ID)) return () => {};

    const taps = [];
    const longs = [];
    let frames = 0;
    let fps = null;
    let rafId = null;
    let timerId = null;
    let observer = null;
    let longObserver = null;

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
        const version = doc.querySelector('script[src*="/static/js/main."]');
        const found = version && /main\.([0-9a-f]+)\.js/.exec(version.getAttribute('src') || '');
        rows.version.textContent = found ? found[1] : 'desconocida';
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
    timerId = win.setInterval(paint, 500);
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
