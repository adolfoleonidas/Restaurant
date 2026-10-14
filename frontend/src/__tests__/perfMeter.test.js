/**
 * El medidor que dice dónde se va el tiempo en el dispositivo real.
 *
 * Existe porque el mismo toque es instantáneo en una laptop y lento en el
 * teléfono del local, y desde afuera no hay forma de medirlo. Se enciende con
 * `?diag=1` y, apagado, no debe existir ni costar nada. Cada muestra viaja al
 * servidor, porque la pantalla del teléfono no se puede mirar a distancia.
 */
import {
    buildSample, installPerfMeter, PANEL_ID, perfMeterEnabled, percentile, runningVersion, summarize,
} from '@/lib/perfMeter';
import { api } from '@/lib/api';

// El medidor manda la muestra al servidor; aquí se sustituye para mirar qué manda
// sin salir a la red. Se miran las llamadas del propio mock, no un array propio:
// la fábrica de `jest.mock` se iza por encima de este archivo.
jest.mock('@/lib/api', () => ({
    api: { post: jest.fn(() => Promise.resolve({ data: { ok: true } })) },
}));

describe('perfMeter: se enciende solo si se pide', () => {
    it('reconoce ?diag=1 en cualquier posición', () => {
        expect(perfMeterEnabled('?diag=1')).toBe(true);
        expect(perfMeterEnabled('?a=2&diag=1&b=3')).toBe(true);
        expect(perfMeterEnabled('?diag=0')).toBe(false);
        expect(perfMeterEnabled('')).toBe(false);
        expect(perfMeterEnabled('?diag')).toBe(false);
    });

    it('no se rompe con una cadena rara', () => {
        expect(() => perfMeterEnabled(undefined)).not.toThrow();
    });
});

describe('perfMeter: las cuentas', () => {
    it('percentil y resumen', () => {
        expect(percentile([], 50)).toBeNull();
        expect(percentile([5], 50)).toBe(5);
        expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
        expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
        expect(summarize([2, 4, 6])).toEqual({ n: 3, p50: 4, max: 6 });
        expect(summarize([])).toEqual({ n: 0, p50: null, max: null });
    });
});

describe('perfMeter: la muestra que se manda', () => {
    const script = () => {
        const node = document.createElement('script');
        node.setAttribute('src', '/static/js/main.de8353ed.js');
        document.head.appendChild(node);
        return node;
    };

    it('lleva la versión, la pantalla, los toques y el teléfono', () => {
        const node = script();
        const fakeWin = {
            innerWidth: 412,
            innerHeight: 915,
            devicePixelRatio: 2.625,
            navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7)' },
        };
        try {
            const sample = buildSample({
                win: fakeWin,
                doc: document,
                fps: 52,
                taps: [
                    { duration: 120, inputDelay: 90, processing: 3 },
                    { duration: 200, inputDelay: 150, processing: 5 },
                    { duration: 160, inputDelay: 110, processing: 4 },
                ],
                longs: [320, 180],
            });

            expect(sample.version).toBe('de8353ed');
            expect(sample.screen).toBe('412x915 vertical');
            expect(sample.viewport).toMatchObject({
                w: 412, h: 915, orientation: 'vertical', dpr: 2.625,
            });
            expect(sample.viewport.nodes).toBeGreaterThan(0);
            expect(sample.viewport.ua).toContain('Pixel 7');
            // El toque se parte en dos: lo que el hilo estaba ocupado y lo que tardó
            // el manejador. Si el problema fuera el código, `code` sería el grande.
            expect(sample.taps).toEqual({ n: 3, p50: 160, max: 200, busy: 110, code: 4 });
            expect(sample.longs).toEqual({ n: 2, max: 320 });
            expect(sample.fps).toBe(52);
        } finally {
            node.remove();
        }
    });

    it('sin guion cargado la versión es honesta', () => {
        expect(runningVersion(document)).toBe('desconocida');
        expect(buildSample({ win: { innerWidth: 0, innerHeight: 0 }, doc: document }).version).toBe('desconocida');
    });
});

/** Una ventana falsa que deja disparar a mano los observadores y el latido. */
function fakeWindow() {
    const observers = [];
    let beat = null;
    class FakeObserver {
        constructor(callback) { this.callback = callback; observers.push(this); }

        observe() {}

        disconnect() {}
    }
    return {
        document,
        innerWidth: 412,
        innerHeight: 915,
        devicePixelRatio: 2.625,
        navigator: { userAgent: 'Pixel 7' },
        PerformanceObserver: FakeObserver,
        requestAnimationFrame: (fn) => setTimeout(fn, 16),
        cancelAnimationFrame: (id) => clearTimeout(id),
        setInterval: (fn) => { beat = fn; return 1; },
        clearInterval: () => {},
        _observers: observers,
        _beat: () => beat && beat(),
        _pushEvent: (entry) => observers[0].callback({ getEntries: () => [entry] }),
    };
}

describe('perfMeter: el panel en pantalla', () => {
    let script;

    beforeEach(() => {
        api.post.mockClear();
        script = document.createElement('script');
        script.setAttribute('src', '/static/js/main.3cf3fd66.js');
        document.head.appendChild(script);
    });

    afterEach(() => { script.remove(); document.body.innerHTML = ''; });

    it('muestra la versión, la pantalla y un aviso mientras no hay toques', () => {
        const stop = installPerfMeter({ win: fakeWindow(), doc: document });

        const panel = document.getElementById(PANEL_ID);
        expect(panel).not.toBeNull();
        expect(panel.getAttribute('data-testid')).toBe('perf-meter');
        const value = (name) => panel.querySelector(`[data-row="${name}"] span:last-child`).textContent;
        expect(value('version')).toBe('3cf3fd66');
        expect(value('viewport')).toContain('412x915 vertical');
        expect(value('viewport')).toContain('dpr 2.625');
        expect(value('viewport')).toContain('nodos');
        expect(value('tap')).toContain('sin toques');

        stop();
    });

    it('manda la muestra al servidor cuando hubo toques', () => {
        const win = fakeWindow();
        const stop = installPerfMeter({ win, doc: document });

        win._pushEvent({ name: 'pointerdown', duration: 120, startTime: 0, processingStart: 90, processingEnd: 93 });
        win._beat();

        expect(api.post).toHaveBeenCalledTimes(1);
        const [url, body] = api.post.mock.calls[0];
        expect(url).toBe('/diag/sample');
        expect(body.taps).toMatchObject({ n: 1, p50: 120, busy: 90, code: 3 });
        expect(body.viewport.orientation).toBe('vertical');
        expect(body.screen).toBe('412x915 vertical');

        // No repite la misma muestra: solo manda cuando hay toques nuevos.
        win._beat();
        expect(api.post).toHaveBeenCalledTimes(1);

        stop();
    });

    it('se apaga y se va de la pantalla', () => {
        const stop = installPerfMeter({ win: fakeWindow(), doc: document });
        expect(document.getElementById(PANEL_ID)).not.toBeNull();
        stop();
        expect(document.getElementById(PANEL_ID)).toBeNull();
    });

    it('encenderlo dos veces no duplica el panel', () => {
        const stop = installPerfMeter({ win: fakeWindow(), doc: document });
        const second = installPerfMeter({ win: fakeWindow(), doc: document });
        expect(document.querySelectorAll(`#${PANEL_ID}`)).toHaveLength(1);
        second();
        expect(document.getElementById(PANEL_ID)).not.toBeNull();
        stop();
        expect(document.getElementById(PANEL_ID)).toBeNull();
    });

    it('sin PerformanceObserver en el navegador no se rompe', () => {
        const win = fakeWindow();
        delete win.PerformanceObserver;
        const stop = installPerfMeter({ win, doc: document });
        expect(document.getElementById(PANEL_ID)).not.toBeNull();
        win._beat();
        expect(api.post).not.toHaveBeenCalled();
        stop();
    });
});
