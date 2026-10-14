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
export const DIAG_POS_KEY = 'restaurant_diag_pos';
const PANEL_ROWS = ['version', 'viewport', 'tap', 'effect', 'net', 'long', 'fps'];

/**
 * Un toque que no cambió nada en este plazo cuenta como perdido.
 *
 * Diez segundos, no dos: en un teléfono lento un toque retenido puede tardar tres o
 * cuatro en verse, y con un corte corto eso se contaba como "no hizo nada" cuando en
 * realidad sí entró. Aquí "perdido" tiene que significar perdido.
 */
const GIVE_UP_MS = 10000;
/**
 * Un toque que tarda más que esto se reporta AL INSTANTE, sin esperar al latido.
 *
 * El problema real es intermitente ("a veces demora"), y un promedio de cinco
 * segundos lo diluye: un toque de 800 ms entre cuarenta de 60 ms desaparece. Con
 * esto, cada toque lento llega solo, con las peticiones que había en el aire en ese
 * momento, que es lo que permite ver la causa en vez de suponerla.
 */
const SLOW_TAP_MS = 200;
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

const PRODUCT_MARKERS = ['-producto-fila-', '-producto-nombre-'];

/**
 * El producto de la tarjeta que se tocó, o null si el toque no fue a una.
 *
 * Se mira primero la FILA, porque la cantidad vive fuera del botón del nombre
 * (son hermanos dentro de la fila): observando el botón, su texto nunca cambia y
 * todo toque parecería no haber hecho nada.
 */
export function productIdFrom(target) {
    if (!target || !target.closest) return null;
    for (const marker of PRODUCT_MARKERS) {
        const node = target.closest(`[data-testid*="${marker}"]`);
        if (!node) continue;
        const testid = node.getAttribute('data-testid') || '';
        const index = testid.indexOf(marker);
        if (index >= 0) return testid.slice(index + marker.length);
    }
    return null;
}

/**
 * Qué parte de la tarjeta se tocó.
 *
 * Importa para que "no hizo nada" signifique algo: tocar la cantidad o el borde de
 * la fila no cambia nada y no debería. Un toque que no hizo nada **sobre la tarjeta
 * que agrega** es el problema del mozo; cualquier otro es ruido de la medición.
 */
export function tapKind(target, productId) {
    const node = target && target.closest && target.closest('[data-testid]');
    const testid = (node && node.getAttribute('data-testid')) || '';
    if (testid === '' || !productId) return 'other';
    if (testid.endsWith(`-producto-${productId}`)) return 'add';
    if (testid.includes('-producto-nombre-')) return 'add';
    if (testid.includes('-producto-menos-')) return 'minus';
    return 'other';
}

const ROW_SELECTOR = `[data-testid*="${PRODUCT_MARKERS[0]}"]`;

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
    taps = [], visible = [], silent = 0, silentAdd = 0, blocked = 0, requests = [], longs = [], fps = null,
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
        // Lo que el mozo percibe: el toque hasta que la tarjeta cambia, cuántos
        // toques no cambiaron nada, y cuánto tiempo las tarjetas ni siquiera
        // aceptaban un toque (un botón deshabilitado no dispara el evento, así que
        // esto no aparece en ninguna otra medida).
        visible: { ...summarize(visible), silent, silent_add: silentAdd, blocked: Math.round(blocked) },
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
    let silentAdd = 0;
    let requests = [];
    let frames = 0;
    let fps = null;
    let rafId = null;
    let timerId = null;
    let observer = null;
    let longObserver = null;
    let reportedTaps = 0;
    let lastReportAt = 0;
    let slowTapPending = false;
    let blockedMs = 0;

    const clock = () => (win.performance && win.performance.now ? win.performance.now() : Date.now());

    // El panel NO se pone encima de lo que el mozo tiene que tocar: arranca
    // minimizado (una barrita de ~18 px), se arrastra con el dedo a donde no
    // estorbe y su posición se recuerda. Solo la barra recibe toques —el resto
    // sigue en `pointer-events: none`— así que la carta y los botones de debajo
    // nunca se bloquean.
    const panel = doc.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('data-testid', 'perf-meter');
    panel.style.cssText = [
        'position:fixed', 'z-index:2147483647',
        'background:#0b0f17', 'color:#e8eef7', 'padding:3px 8px', 'border-radius:10px',
        'box-shadow:0 4px 14px rgba(0,0,0,.4)', 'pointer-events:none',
        'max-width:calc(100vw - 16px)',
    ].join(';');

    const bar = doc.createElement('div');
    bar.setAttribute('data-testid', 'perf-meter-barra');
    bar.style.cssText = [
        'pointer-events:auto', 'display:flex', 'gap:6px', 'align-items:center',
        'font:11px/1.6 ui-monospace,monospace', 'letter-spacing:.04em',
        'cursor:move', 'user-select:none', '-webkit-user-select:none', 'touch-action:none',
    ].join(';');
    const caret = doc.createElement('span');
    caret.textContent = '▸';
    const summary = doc.createElement('span');
    summary.setAttribute('data-testid', 'perf-meter-resumen');
    bar.append(caret, summary);

    const body = doc.createElement('div');
    body.setAttribute('data-testid', 'perf-meter-cuerpo');
    panel.append(bar, body);

    const rows = {};
    for (const name of PANEL_ROWS) {
        const { line, value } = row(doc, name);
        rows[name] = value;
        body.appendChild(line);
    }
    doc.body.appendChild(panel);

    const readPos = () => {
        try {
            const raw = win.localStorage?.getItem(DIAG_POS_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top) ? parsed : null;
        } catch { return null; }
    };
    const savePos = (left, top) => {
        try { win.localStorage?.setItem(DIAG_POS_KEY, JSON.stringify({ left, top })); } catch { /* sin storage */ }
    };
    const clampLeft = (value) => Math.max(2, Math.min(value, (win.innerWidth || 360) - 60));
    const clampTop = (value) => Math.max(2, Math.min(value, (win.innerHeight || 600) - 24));
    const place = (left, top) => {
        panel.style.left = `${clampLeft(left)}px`;
        panel.style.top = `${clampTop(top)}px`;
    };
    const stored = readPos();
    if (stored) place(stored.left, stored.top);
    else place(((win.innerWidth || 375) - 120) / 2, 2);

    let collapsed = true;
    let drag = null;
    const render = () => {
        body.style.display = collapsed ? 'none' : 'block';
        caret.textContent = collapsed ? '▸' : '▾';
        const effect = summarize(visible);
        const event = summarize(taps.map((tap) => tap.duration));
        summary.textContent = collapsed
            ? ` ${effect.p50 === null ? '—' : effect.p50} ms`
                + `${silentAdd ? ` · ${silentAdd}✗` : ''}`
                + `${blockedMs >= 1 ? ` · ⛔${Math.round(blockedMs)}` : ''}`
                + ` · ${event.p50 === null ? '—' : event.p50} ms`
            : ' MEDIDOR · toca para minimizar · ?diag=0 para apagar';
    };

    const onBarDown = (event) => {
        event.stopPropagation();
        drag = {
            x: event.clientX, y: event.clientY, left: panel.offsetLeft, top: panel.offsetTop, moved: false,
        };
    };
    const onBarMove = (event) => {
        if (!drag) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
        drag.moved = true;
        place(drag.left + dx, drag.top + dy);
    };
    const onBarUp = () => {
        if (!drag) return;
        if (drag.moved) savePos(panel.offsetLeft, panel.offsetTop);
        else { collapsed = !collapsed; render(); }
        drag = null;
    };
    bar.addEventListener('pointerdown', onBarDown);
    bar.addEventListener('pointermove', onBarMove);
    bar.addEventListener('pointerup', onBarUp);
    bar.addEventListener('pointercancel', () => { drag = null; });

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
            ? `sin toques a productos${blockedMs >= 1 ? ` · ${Math.round(blockedMs)} ms sin aceptar toques` : ''}`
            : `${effect.p50 === null ? '—' : `${effect.p50} ms p50`}`
                + `${effect.max === null ? '' : ` · ${effect.max} ms peor`}`
                + ` · ${effect.n} con efecto`
                + `${silentAdd ? ` · ${silentAdd} SIN EFECTO` : ''}`
                + `${silent > silentAdd ? ` · ${silent - silentAdd} fuera de la tarjeta` : ''}`
                + `${blockedMs >= 1 ? ` · ${Math.round(blockedMs)} ms sin aceptar toques` : ''}`;
        rows.net.textContent = requests.length
            ? requests.map((r) => `${r.ms} ms ${r.kb} KB ${r.url.split('/api/')[1] || r.url}`).join(' | ')
            : 'sin peticiones medidas';
        const worst = longs.length ? Math.max(...longs) : 0;
        rows.long.textContent = `${longs.length} tareas >50 ms · peor ${worst} ms`;
        rows.fps.textContent = fps === null ? '…' : `${fps} fps`;
        // La barrita minimizada muestra lo esencial aunque el detalle esté cerrado.
        render();
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

    // El efecto del toque: se anota cómo se ve la tarjeta al tocar y se espera a
    // que cambie CUALQUIER cosa visible en ella, no solo la cantidad. Un toque que
    // no cambia nada es justo lo que el mozo percibe como "no agarró".
    //
    // Y aparte se mide lo que el medidor no veía: cuánto tiempo las tarjetas de
    // producto estuvieron DESHABILITADAS. Un botón deshabilitado no dispara el
    // evento del toque, así que ni el conteo de toques ni el de efecto lo detectan;
    // el mozo toca y no pasa nada, y desde afuera parecía que todo iba en 67 ms.
    const onPointerDown = (event) => {
        const productId = productIdFrom(event.target);
        if (!productId) return;
        const row = event.target.closest(ROW_SELECTOR);
        if (!row) return;
        pending.push({
            at: clock(), before: row.textContent, card: row, kind: tapKind(event.target, productId),
        });
    };
    if (doc.addEventListener) doc.addEventListener('pointerdown', onPointerDown, true);

    const checkPending = () => {
        const now = clock();
        for (let i = pending.length - 1; i >= 0; i -= 1) {
            const tap = pending[i];
            if (tap.card.textContent !== tap.before) {
                const ms = Math.round(now - tap.at);
                visible.push(ms);
                if (ms >= SLOW_TAP_MS) slowTapPending = true;
                pending.splice(i, 1);
            } else if (now - tap.at > GIVE_UP_MS) {
                silent += 1;
                // Solo los que iban a agregar cuentan como el problema del mozo.
                if (tap.kind === 'add') silentAdd += 1;
                slowTapPending = true;
                pending.splice(i, 1);
            }
        }
    };

    /**
     * ¿Hay alguna tarjeta de producto que en este momento no acepte un toque?
     *
     * Se mira el botón del NOMBRE, que es la tarjeta entera y el camino normal para
     * agregar. No sirve mirar cualquier botón `-producto-`: el "−" está deshabilitado
     * cuando la cantidad es 0 —que es lo normal en casi toda la carta— y eso hacía
     * contar como "sin aceptar toques" un estado que no lo es.
     */
    const cardsRefuseTaps = () => Boolean(
        doc.querySelector('button[disabled][data-testid*="-producto-nombre-"]')
    );

    // FPS: se cuentan fotogramas por segundo, sin medir nada más. En el mismo
    // latido se acumula el tiempo con las tarjetas rechazando toques.
    const requestFrame = win.requestAnimationFrame
        ? (fn) => win.requestAnimationFrame(fn)
        : (fn) => win.setTimeout(fn, 16);
    let windowStart = Date.now();
    let lastFrameAt = clock();
    const tick = () => {
        frames += 1;
        checkPending();
        const now = clock();
        // El tope evita contar como "bloqueado" el rato en que la pantalla estuvo
        // apagada o la app en segundo plano: ahí no hay fotogramas y el salto sería
        // enorme.
        if (cardsRefuseTaps()) blockedMs += Math.min(200, now - lastFrameAt);
        lastFrameAt = now;
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
        const due = clock() - lastReportAt >= reportEveryMs;
        // Un toque lento no espera al latido: se manda en cuanto se detecta.
        if (taps.length > reportedTaps && (due || slowTapPending)) {
            reportedTaps = taps.length;
            requests = slowestRequests(win, lastReportAt);
            lastReportAt = clock();
            try {
                Promise.resolve(send(buildSample({
                    taps, visible, silent, silentAdd, blocked: blockedMs, requests, longs, fps, win, doc,
                }))).catch(() => {});
                if (win.performance && win.performance.clearResourceTimings) win.performance.clearResourceTimings();
            } catch { /* el medidor nunca rompe la app */ }
            slowTapPending = false;
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
