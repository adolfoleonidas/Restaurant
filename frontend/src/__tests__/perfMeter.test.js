/**
 * El medidor que dice dónde se va el tiempo en el dispositivo real.
 *
 * Existe porque el problema es intermitente y depende del uso ("pido un pedido,
 * lo envío, y el segundo demora más"), y eso no se puede diagnosticar desde
 * afuera. Se enciende con `?diag=1`, se recuerda en el dispositivo (para medir
 * también el enlace normal) y cada muestra viaja al servidor.
 */
import {
    buildSample, DIAG_KEY, DIAG_POS_KEY, installPerfMeter, PANEL_ID, perfMeterEnabled, percentile,
    productIdFrom, runningVersion, slowestRequests, summarize, tapKind,
} from '@/lib/perfMeter';
import { api } from '@/lib/api';

// El medidor manda la muestra al servidor; aquí se sustituye para mirar qué manda
// sin salir a la red. Se miran las llamadas del propio mock, no un array propio:
// la fábrica de `jest.mock` se iza por encima de este archivo.
jest.mock('@/lib/api', () => ({
    api: { post: jest.fn(() => Promise.resolve({ data: { ok: true } })) },
}));

describe('perfMeter: se enciende y se recuerda', () => {
    const memoryStorage = () => {
        const items = new Map();
        return {
            getItem: (key) => (items.has(key) ? items.get(key) : null),
            setItem: (key, value) => items.set(key, String(value)),
            removeItem: (key) => items.delete(key),
        };
    };

    it('reconoce ?diag=1 en cualquier posición', () => {
        expect(perfMeterEnabled('?diag=1')).toBe(true);
        expect(perfMeterEnabled('?a=2&diag=1&b=3')).toBe(true);
        expect(perfMeterEnabled('?diag=0')).toBe(false);
        expect(perfMeterEnabled('')).toBe(false);
        expect(perfMeterEnabled('?diag')).toBe(false);
    });

    it('?diag=1 lo deja encendido para el enlace normal; ?diag=0 lo apaga', () => {
        const storage = memoryStorage();

        expect(perfMeterEnabled('?diag=1', storage)).toBe(true);
        expect(storage.getItem(DIAG_KEY)).toBe('1');
        // El enlace normal: el dispositivo recuerda que está encendido.
        expect(perfMeterEnabled('', storage)).toBe(true);
        expect(perfMeterEnabled('?otra=cosa', storage)).toBe(true);

        expect(perfMeterEnabled('?diag=0', storage)).toBe(false);
        expect(storage.getItem(DIAG_KEY)).toBeNull();
        expect(perfMeterEnabled('', storage)).toBe(false);
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

    it('reconoce la tarjeta de un producto', () => {
        const host = document.createElement('div');
        host.innerHTML = '<div data-testid="mesa-sheet-producto-fila-p-7">'
            + '<button data-testid="mesa-sheet-producto-nombre-p-7">Caldo</button>'
            + '<span data-testid="mesa-sheet-producto-cantidad-p-7">1</span>'
            + '<button data-testid="mesa-sheet-producto-menos-p-7">−</button>'
            + '<button data-testid="mesa-sheet-producto-p-7">+</button></div>';
        const [row] = host.children;
        const [nombre, cantidad, menos, mas] = row.children;
        expect(productIdFrom(nombre)).toBe('p-7');
        expect(productIdFrom(cantidad)).toBe('p-7');
        expect(productIdFrom(row)).toBe('p-7');
        expect(productIdFrom(host)).toBeNull();
        expect(productIdFrom(null)).toBeNull();
    });

    it('distingue qué parte de la tarjeta se tocó', () => {
        // Para que "no hizo nada" signifique algo: tocar la cantidad o el borde de la
        // fila no cambia nada y no debería; solo el toque que agrega es el problema.
        const host = document.createElement('div');
        host.innerHTML = '<div data-testid="mesa-sheet-producto-fila-p-7">'
            + '<button data-testid="mesa-sheet-producto-nombre-p-7">Caldo</button>'
            + '<span data-testid="mesa-sheet-producto-cantidad-p-7">1</span>'
            + '<button data-testid="mesa-sheet-producto-menos-p-7">−</button>'
            + '<button data-testid="mesa-sheet-producto-p-7">+</button></div>';
        const [row] = host.children;
        const [nombre, cantidad, menos, mas] = row.children;
        expect(tapKind(nombre, 'p-7')).toBe('add');
        expect(tapKind(mas, 'p-7')).toBe('add');
        expect(tapKind(menos, 'p-7')).toBe('minus');
        expect(tapKind(cantidad, 'p-7')).toBe('other');
        expect(tapKind(row, 'p-7')).toBe('other');
        expect(tapKind(null, 'p-7')).toBe('other');
    });

    it('resume las peticiones más lentas del período', () => {
        const win = {
            performance: {
                getEntriesByType: () => [
                    { name: 'http://x/api/tables', startTime: 10, duration: 90, initiatorType: 'xmlhttprequest', transferSize: 16 * 1024 },
                    { name: 'http://x/api/orders?active_only=true', startTime: 20, duration: 600, initiatorType: 'fetch', transferSize: 42 * 1024 },
                    { name: 'http://x/static/js/main.js', startTime: 30, duration: 900, initiatorType: 'script' },
                    { name: 'http://x/api/products', startTime: 5, duration: 999, initiatorType: 'fetch' },
                ],
            },
        };

        const slowest = slowestRequests(win, 8);

        // Solo las peticiones de datos, solo las del período, la más lenta primero.
        expect(slowest).toEqual([
            { url: '/api/orders?active_only=true', ms: 600, kb: 42 },
            { url: '/api/tables', ms: 90, kb: 16 },
        ]);
    });

    it('sin Performance API no se rompe', () => {
        expect(slowestRequests({}, 0)).toEqual([]);
        expect(slowestRequests({ performance: {} }, 0)).toEqual([]);
    });
});

describe('perfMeter: la muestra que se manda', () => {
    const script = () => {
        const node = document.createElement('script');
        node.setAttribute('src', '/static/js/main.de8353ed.js');
        document.head.appendChild(node);
        return node;
    };

    it('lleva la versión, la pantalla, el toque, el efecto y la red', () => {
        const node = script();
        const fakeWin = {
            innerWidth: 375,
            innerHeight: 689,
            devicePixelRatio: 3.25,
            navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 10; K)' },
        };
        try {
            const sample = buildSample({
                win: fakeWin,
                doc: document,
                fps: 60,
                taps: [
                    { duration: 120, inputDelay: 90, processing: 3 },
                    { duration: 200, inputDelay: 150, processing: 5 },
                    { duration: 160, inputDelay: 110, processing: 4 },
                ],
                visible: [40, 60, 50],
                silent: 2,
                silentAdd: 1,
                requests: [{ url: '/api/orders?active_only=true', ms: 600, kb: 42 }],
                longs: [320, 180],
            });

            expect(sample.version).toBe('de8353ed');
            expect(sample.screen).toBe('375x689 vertical');
            expect(sample.viewport.ua).toContain('Android 10');
            expect(sample.taps).toEqual({ n: 3, p50: 160, max: 200, busy: 110, code: 4 });
            // Lo que el mozo percibe: el toque hasta ver el cambio, los que no
            // cambiaron nada (y cuáles de esos iban a agregar), y el rato con las
            // tarjetas sin aceptar toques.
            expect(sample.visible).toEqual({
                n: 3, p50: 50, max: 60, silent: 2, silent_add: 1, blocked: 0,
            });
            expect(sample.requests).toHaveLength(1);
            expect(sample.longs).toEqual({ n: 2, max: 320 });
            expect(sample.fps).toBe(60);
        } finally {
            node.remove();
        }
    });

    it('sin guion cargado la versión es honesta', () => {
        expect(runningVersion(document)).toBe('desconocida');
    });
});

/** Una ventana falsa que deja disparar a mano los observadores, el latido y los fotogramas. */
function fakeWindow() {
    const observers = [];
    let beat = null;
    let frame = null;
    class FakeObserver {
        constructor(callback) { this.callback = callback; observers.push(this); }

        observe() {}

        disconnect() {}
    }
    return {
        document,
        localStorage,
        innerWidth: 375,
        innerHeight: 689,
        devicePixelRatio: 3.25,
        navigator: { userAgent: 'Pixel' },
        PerformanceObserver: FakeObserver,
        requestAnimationFrame: (fn) => { frame = fn; return 1; },
        cancelAnimationFrame: () => {},
        setInterval: (fn) => { beat = fn; return 1; },
        clearInterval: () => {},
        _observers: observers,
        _beat: () => beat && beat(),
        _frame: () => { const next = frame; frame = null; if (next) next(); },
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

    const panelValue = (name) => document
        .querySelector(`#${PANEL_ID} [data-row="${name}"] span:last-child`).textContent;

    /**
     * La tarjeta como es de verdad: la cantidad vive FUERA del botón del nombre
     * (son hermanos dentro de la fila), así que mirar el botón no ve el cambio.
     */
    const productCard = () => {
        document.body.innerHTML = '<div data-testid="mesa-sheet-producto-fila-p-7">'
            + '<button data-testid="mesa-sheet-producto-nombre-p-7">Caldo S/ 10.00</button>'
            + '<div><span data-testid="mesa-sheet-producto-cantidad-p-7">0</span>'
            + '<button data-testid="mesa-sheet-producto-p-7">+</button></div></div>';
        return {
            card: document.querySelector('[data-testid="mesa-sheet-producto-nombre-p-7"]'),
            qty: document.querySelector('[data-testid="mesa-sheet-producto-cantidad-p-7"]'),
        };
    };

    it('muestra la versión, la pantalla y un aviso mientras no hay toques', () => {
        const stop = installPerfMeter({ win: fakeWindow(), doc: document });

        expect(document.getElementById(PANEL_ID)).not.toBeNull();
        expect(panelValue('version')).toBe('3cf3fd66');
        expect(panelValue('viewport')).toContain('375x689 vertical');
        expect(panelValue('tap')).toContain('sin toques');
        expect(panelValue('effect')).toContain('sin toques a productos');

        stop();
    });

    it('mide del toque a ver el cambio en pantalla', () => {
        // La tarjeta primero: encender el medidor agrega el panel al body y
        // reemplazar el body después se lo llevaría por delante.
        const { card, qty } = productCard();
        const win = fakeWindow();
        const stop = installPerfMeter({ win, doc: document });

        card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        // El fotograma revisa si la cantidad cambió; el latido repinta el panel.
        win._frame();
        win._beat();
        expect(panelValue('effect')).toContain('sin toques a productos');
        // Ahora sí: la cantidad cambia y el efecto queda medido.
        qty.textContent = '1';
        win._frame();
        win._beat();
        expect(panelValue('effect')).toContain('1 con efecto');

        stop();
    });

    it('cuenta el toque que no cambió nada', () => {
        jest.useFakeTimers();
        try {
            const { card } = productCard();
            const win = fakeWindow();
            const stop = installPerfMeter({ win, doc: document });

            card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            jest.advanceTimersByTime(10100);
            win._frame();
            win._beat();

            expect(panelValue('effect')).toContain('1 SIN EFECTO');
            stop();
        } finally {
            jest.useRealTimers();
        }
    });

    it('un toque que tarda pero ENTRA no cuenta como perdido', () => {
        // Tres segundos en un teléfono lento es lento, no perdido. Con el corte
        // corto de antes esto se contaba como "no hizo nada" y no lo era.
        jest.useFakeTimers();
        try {
            const { card, qty } = productCard();
            const win = fakeWindow();
            const stop = installPerfMeter({ win, doc: document });

            card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            jest.advanceTimersByTime(3000);
            qty.textContent = '1';
            win._frame();
            win._beat();

            const text = panelValue('effect');
            expect(text).toContain('1 con efecto');
            expect(text).not.toContain('SIN EFECTO');
            stop();
        } finally {
            jest.useRealTimers();
        }
    });

    it('cuenta el tiempo con las tarjetas sin aceptar toques', () => {
        // Un botón deshabilitado no dispara el evento del toque, así que ni el
        // conteo de toques ni el de efecto lo ven: sin esta medida, la app puede
        // estar rechazando toques y el medidor decir que todo va en 67 ms.
        //
        // Se deshabilita el botón del NOMBRE (la tarjeta entera, el camino normal de
        // agregar). El "−" está deshabilitado con cantidad 0 en casi toda la carta y
        // contarlo hacía que esto midiera un estado normal como si fuera un bloqueo.
        jest.useFakeTimers();
        try {
            const { card } = productCard();
            card.disabled = true;
            const win = fakeWindow();
            const stop = installPerfMeter({ win, doc: document });

            win._frame();
            jest.advanceTimersByTime(50);
            win._frame();
            win._beat();

            expect(panelValue('effect')).toContain('sin aceptar toques');
            stop();
        } finally {
            jest.useRealTimers();
        }
    });

    it('un toque lento se reporta al instante, sin esperar al latido', () => {
        // El problema es intermitente: un toque de 300 ms entre cuarenta de 60 ms se
        // pierde en el promedio de cinco segundos. Este se manda solo.
        jest.useFakeTimers();
        try {
            const { card, qty } = productCard();
            const win = fakeWindow();
            // Latido larguísimo: si igual llega la muestra, es por el toque lento.
            const stop = installPerfMeter({ win, doc: document, reportEveryMs: 600000 });

            card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            win._pushEvent({ name: 'click', duration: 10, startTime: 0, processingStart: 5, processingEnd: 6 });

            jest.advanceTimersByTime(300);
            qty.textContent = '1';
            win._frame();
            win._beat();

            expect(api.post).toHaveBeenCalledTimes(1);
            expect(api.post.mock.calls[0][1].visible.p50).toBeGreaterThanOrEqual(200);
            stop();
        } finally {
            jest.useRealTimers();
        }
    });

    it('arranca minimizado: una barrita, no un panel encima de la carta', () => {
        const stop = installPerfMeter({ win: fakeWindow(), doc: document });

        const body = document.querySelector('[data-testid="perf-meter-cuerpo"]');
        expect(body.style.display).toBe('none');
        // La barrita igual muestra lo esencial mientras sigue midiendo.
        expect(document.querySelector('[data-testid="perf-meter-resumen"]').textContent).toContain('ms');
        // Y solo la barra recibe toques: el resto no bloquea los botones de debajo.
        expect(document.getElementById(PANEL_ID).style.pointerEvents).toBe('none');
        expect(document.querySelector('[data-testid="perf-meter-barra"]').style.pointerEvents).toBe('auto');

        stop();
    });

    it('se abre y se cierra tocando la barra', () => {
        const stop = installPerfMeter({ win: fakeWindow(), doc: document });
        const bar = document.querySelector('[data-testid="perf-meter-barra"]');
        const body = document.querySelector('[data-testid="perf-meter-cuerpo"]');
        const press = () => {
            bar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
            bar.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
        };

        press();
        expect(body.style.display).toBe('block');
        press();
        expect(body.style.display).toBe('none');

        stop();
    });

    it('se arrastra con el dedo y recuerda dónde quedó', () => {
        const win = fakeWindow();
        win.localStorage.removeItem(DIAG_POS_KEY);
        const stop = installPerfMeter({ win, doc: document });
        const bar = document.querySelector('[data-testid="perf-meter-barra"]');

        bar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 20 }));
        bar.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 40, clientY: 120 }));
        expect(document.getElementById(PANEL_ID).style.left).not.toBe('');
        bar.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 40, clientY: 120 }));

        // Queda donde el mozo lo dejó, también en la próxima visita.
        expect(JSON.parse(win.localStorage.getItem(DIAG_POS_KEY))).toEqual(expect.objectContaining({ left: expect.any(Number) }));
        expect(document.querySelector('[data-testid="perf-meter-cuerpo"]').style.display).toBe('none');

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
        expect(body.screen).toBe('375x689 vertical');

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
