/**
 * El medidor que dice dónde se va el tiempo en el dispositivo real.
 *
 * Existe porque el mismo toque es instantáneo en una laptop y lento en el
 * teléfono del local, y desde afuera no hay forma de medirlo. Se enciende con
 * `?diag=1` y, apagado, no debe existir ni costar nada.
 */
import { installPerfMeter, PANEL_ID, perfMeterEnabled, percentile, summarize } from '@/lib/perfMeter';

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

describe('perfMeter: el panel en pantalla', () => {
    let script;

    beforeEach(() => {
        script = document.createElement('script');
        script.setAttribute('src', '/static/js/main.3cf3fd66.js');
        document.head.appendChild(script);
    });

    afterEach(() => { script.remove(); document.body.innerHTML = ''; });

    it('muestra la versión, la pantalla y un aviso mientras no hay toques', () => {
        // Ventana simulada: jsdom mide 1024x768, y aquí lo que se prueba es que la
        // orientación y el tamaño salgan de la ventana real.
        const fakeWin = {
            document,
            innerWidth: 412,
            innerHeight: 915,
            devicePixelRatio: 2.625,
            setInterval: window.setInterval.bind(window),
            clearInterval: window.clearInterval.bind(window),
            requestAnimationFrame: window.requestAnimationFrame.bind(window),
            cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
        };
        const stop = installPerfMeter({ win: fakeWin, doc: document });

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

    it('se apaga y se va de la pantalla', () => {
        const stop = installPerfMeter();
        expect(document.getElementById(PANEL_ID)).not.toBeNull();
        stop();
        expect(document.getElementById(PANEL_ID)).toBeNull();
    });

    it('encenderlo dos veces no duplica el panel', () => {
        const stop = installPerfMeter();
        const second = installPerfMeter();
        expect(document.querySelectorAll(`#${PANEL_ID}`)).toHaveLength(1);
        second();
        // El segundo no pudo instalarse, así que no debe haberse llevado el panel del primero.
        expect(document.getElementById(PANEL_ID)).not.toBeNull();
        stop();
        expect(document.getElementById(PANEL_ID)).toBeNull();
    });

    it('sin PerformanceObserver en el navegador no se rompe', () => {
        const original = window.PerformanceObserver;
        // eslint-disable-next-line no-param-reassign
        delete window.PerformanceObserver;
        try {
            const stop = installPerfMeter();
            expect(document.getElementById(PANEL_ID)).not.toBeNull();
            stop();
        } finally {
            window.PerformanceObserver = original;
        }
    });
});
