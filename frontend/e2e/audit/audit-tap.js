/**
 * Reproduce en un navegador controlado lo que el mozo ve en su teléfono:
 * el mismo servidor, la misma cuenta y los mismos toques, en vertical y en
 * horizontal, con el CPU estrangulado como el de un teléfono flojo.
 *
 * Objetivo: medir "toque -> pintado" en las dos orientaciones y ver qué cambia
 * de verdad (nodos, alto del documento, costo de recalcular el layout, tareas
 * largas), en vez de seguir suponiendo.
 *
 * No deja rastro: el toque "+" se deshace con el "−", así que la cantidad vuelve
 * a la original y no hay nada que guardar.
 */
const { chromium, devices } = require('@playwright/test');

const BASE = process.env.AUDIT_BASE || 'http://179.236.76.74:8081';
const TABLE = Number(process.env.AUDIT_TABLE || 9);
const PRODUCT = process.env.AUDIT_PRODUCT || '256fc0c6-5179-4d85-86ac-1dbc979b8b2f'; // Caldo, ya en borrador
const EMAIL = process.env.AUDIT_EMAIL || 'mozo@resto.com';
const PASSWORD = process.env.AUDIT_PASSWORD || 'mozo123';
const CPU = Number(process.env.AUDIT_CPU || 4);
const TAPS = Number(process.env.AUDIT_TAPS || 8);
// El teléfono del local tiene que CRUZAR el umbral de escritorio (768/820 px) al
// girar: si el ancho de horizontal se queda corto, el diseño no cambia y la
// prueba no mide lo que el mozo ve.
const PORTRAIT = { width: Number(process.env.AUDIT_W || 412), height: Number(process.env.AUDIT_H || 915) };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return {
        n: sorted.length,
        p50: Math.round(at(0.5)),
        p90: Math.round(at(0.9)),
        max: Math.round(sorted[sorted.length - 1]),
    };
};

async function installLongTaskObserver(page) {
    await page.evaluate(() => {
        window.__auditLong = [];
        if (!window.__auditObserver) {
            window.__auditObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) window.__auditLong.push(Math.round(entry.duration));
            });
            try { window.__auditObserver.observe({ entryTypes: ['longtask'] }); } catch { /* no soportado */ }
        }
    });
}

async function pageFacts(page) {
    return page.evaluate(() => {
        // Un pase forzado de estilo + layout de toda la página: es lo que el
        // navegador tiene que rehacer cada vez que React cambia algo.
        const nodes = document.querySelectorAll('*').length;
        document.body.style.paddingTop = '1px';
        void document.body.offsetHeight;
        const t0 = performance.now();
        void document.body.offsetHeight;
        const layoutMs = performance.now() - t0;
        document.body.style.paddingTop = '';
        return {
            nodes,
            layoutMs: Math.round(layoutMs * 10) / 10,
            height: document.documentElement.scrollHeight,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            long: (window.__auditLong || []).slice(),
            fixed: [...document.querySelectorAll('*')].filter((el) => {
                const pos = getComputedStyle(el).position;
                return pos === 'fixed' || pos === 'sticky';
            }).length,
            blurred: [...document.querySelectorAll('*')].filter((el) => {
                const style = getComputedStyle(el);
                return (style.backdropFilter && style.backdropFilter !== 'none')
                    || (style.webkitBackdropFilter && style.webkitBackdropFilter !== 'none');
            }).length,
        };
    });
}

async function measureTaps(page) {
    const runs = [];
    for (let i = 0; i < TAPS; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const ms = await page.evaluate(async ({ productId }) => {
            const card = document.querySelector(`[data-testid$="producto-nombre-${productId}"]`);
            const qtyEl = document.querySelector(`[data-testid$="producto-cantidad-${productId}"]`);
            if (!card || !qtyEl) return -1;
            const before = qtyEl.textContent.trim();
            const t0 = performance.now();
            card.click();
            let frames = 0;
            while (qtyEl.textContent.trim() === before && frames < 400) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => requestAnimationFrame(resolve));
                frames += 1;
            }
            // Dos fotogramas más: el cambio ya se pintó, no solo se calculó.
            await new Promise((resolve) => requestAnimationFrame(resolve));
            await new Promise((resolve) => requestAnimationFrame(resolve));
            return performance.now() - t0;
        }, { productId: PRODUCT });
        if (ms < 0) throw new Error('no encontré la tarjeta del producto: ¿el compositor está abierto?');
        runs.push(ms);
        // Deshace el toque: la cantidad vuelve a la original (no se guarda nada).
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate(({ productId }) => {
            const minus = document.querySelector(`[data-testid$="producto-menos-${productId}"]`);
            if (minus && !minus.disabled) minus.click();
        }, { productId: PRODUCT });
        // eslint-disable-next-line no-await-in-loop
        await sleep(150);
    }
    return runs;
}

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: PORTRAIT,
        deviceScaleFactor: 2.625,
        isMobile: true,
        hasTouch: true,
        locale: 'es-PE',
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    });
    const page = await context.newPage();

    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

    console.log(`# ${BASE}  mesa ${TABLE}  CPU x${CPU}  ${TAPS} toques por orientación`);
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    try {
        await page.getByTestId('login-email-input').waitFor({ timeout: 20000 });
    } catch (error) {
        console.error('no apareció el login. URL:', page.url());
        console.error((await page.content()).slice(0, 600));
        throw error;
    }
    await page.getByTestId('login-email-input').fill(EMAIL);
    await page.getByTestId('login-password-input').fill(PASSWORD);
    await page.getByTestId('login-submit-button').click();
    await page.getByTestId('salon-root').waitFor({ timeout: 30000 });

    await page.getByTestId(`mesa-card-${TABLE}`).click();
    await page.getByTestId('mesa-sheet').waitFor({ timeout: 20000 });
    await page.locator(`[data-testid$="producto-nombre-${PRODUCT}"]`).waitFor({ timeout: 20000 });
    await sleep(1500);

    const results = {};
    const portraitRun = ['vertical', PORTRAIT];
    const landscapeRun = ['horizontal', { width: PORTRAIT.height, height: PORTRAIT.width }];
    // El orden importa: el primer recorrido paga el arranque en frío (trozos,
    // JIT). Con AUDIT_ORDER=hv se invierte para ver si la diferencia es de
    // orientación o solo de "quién fue primero".
    const order = process.env.AUDIT_ORDER === 'hv'
        ? [landscapeRun, portraitRun]
        : [portraitRun, landscapeRun];
    for (const [label, viewport] of order) {
        // eslint-disable-next-line no-await-in-loop
        await page.setViewportSize(viewport);
        // eslint-disable-next-line no-await-in-loop
        await sleep(800);
        // eslint-disable-next-line no-await-in-loop
        await installLongTaskObserver(page);
        // eslint-disable-next-line no-await-in-loop
        const facts = await pageFacts(page);
        // eslint-disable-next-line no-await-in-loop
        const runs = await measureTaps(page);
        // eslint-disable-next-line no-await-in-loop
        const after = await pageFacts(page);
        results[label] = { ...stats(runs), facts, long: after.long };
        const s = results[label];
        console.log(`\n## ${label}  (viewport ${facts.viewport})`);
        console.log(`   toque -> pintado: p50 ${s.p50} ms | p90 ${s.p90} ms | max ${s.max} ms  (n=${s.n})`);
        console.log(`   nodos: ${facts.nodes}   alto del documento: ${facts.height} px`);
        console.log(`   un pase de estilo+layout: ${facts.layoutMs} ms`);
        console.log(`   elementos fixed/sticky: ${facts.fixed}   con desenfoque: ${facts.blurred}`);
        console.log(`   tareas largas durante los toques: ${s.long.length}${s.long.length ? ` (max ${Math.max(...s.long)} ms)` : ''}`);
    }

    console.log('\n## comparación');
    const v = results.vertical; const h = results.horizontal;
    console.log(`   vertical ${v.p50} ms  vs  horizontal ${h.p50} ms   ->  ${(v.p50 / Math.max(h.p50, 1)).toFixed(1)}x más lento en vertical`);

    await browser.close();
})().catch((error) => {
    console.error('FALLO:', error.message);
    process.exit(1);
});
