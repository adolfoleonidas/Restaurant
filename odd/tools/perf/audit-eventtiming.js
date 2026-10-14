/**
 * ¿El toque se demora porque el hilo principal está ocupado (input delay) o
 * porque mi código/React tarda en reaccionar (processing)?
 *
 * Usa la API de Event Timing del navegador, que parte cada interacción en:
 *   - input delay   : el hilo estaba ocupado con otra cosa (polling, SSE, GC)
 *   - processing    : el manejador + React + el commit
 *   - presentation  : hasta el siguiente fotograma pintado
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.AUDIT_BASE || 'http://179.236.76.74:8081';
const TABLE = Number(process.env.AUDIT_TABLE || 9);
const PRODUCT = process.env.AUDIT_PRODUCT || '256fc0c6-5179-4d85-86ac-1dbc979b8b2f';
const CPU = Number(process.env.AUDIT_CPU || 6);
const ROUNDS = Number(process.env.AUDIT_ROUNDS || 8);
const PORTRAIT = { width: 412, height: 915 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const p50 = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)]);
};

async function touchCenter(page, selector) {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) return false;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    return true;
}

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: PORTRAIT, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, locale: 'es-PE',
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        window.__events = [];
        window.__longs = [];
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                window.__events.push({
                    name: entry.name,
                    duration: entry.duration,
                    inputDelay: (entry.processingStart || 0) - entry.startTime,
                    processing: (entry.processingEnd || 0) - (entry.processingStart || 0),
                });
            }
        }).observe({ type: 'event', durationThreshold: 0, buffered: true });
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) window.__longs.push(Math.round(entry.duration));
        }).observe({ entryTypes: ['longtask'] });
    });

    await page.getByTestId('login-email-input').fill('mozo@resto.com');
    await page.getByTestId('login-password-input').fill('mozo123');
    await page.getByTestId('login-submit-button').click();
    await page.getByTestId('salon-root').waitFor({ timeout: 30000 });
    await page.getByTestId(`mesa-card-${TABLE}`).click();
    await page.getByTestId('mesa-sheet').waitFor({ timeout: 20000 });
    await page.locator(`[data-testid$="producto-nombre-${PRODUCT}"]`).waitFor({ timeout: 20000 });
    await sleep(2000);

    // Modo de prueba: cortar los sondeos (solo GET) una vez abierta la mesa, para
    // ver si las tareas largas y el "hilo ocupado" vienen de ahí.
    if (process.env.AUDIT_NOPOLL === '1') {
        await page.route('**/api/**', (route) => (
            route.request().method() === 'GET' ? route.abort() : route.continue()
        ));
        console.log('# sondeos bloqueados\n');
    }

    const card = `[data-testid$="producto-nombre-${PRODUCT}"]`;
    const minus = `[data-testid$="producto-menos-${PRODUCT}"]`;

    console.log(`# CPU x${CPU}, ${ROUNDS} toques alternando, midiendo con Event Timing\n`);
    for (const [label, viewport] of [
        ['vertical', PORTRAIT],
        ['horizontal', { width: PORTRAIT.height, height: PORTRAIT.width }],
    ]) {
        // eslint-disable-next-line no-await-in-loop
        await page.setViewportSize(viewport);
        // eslint-disable-next-line no-await-in-loop
        await sleep(400);
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate(() => { window.__events = []; window.__longs = []; });
        for (let i = 0; i < ROUNDS; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await touchCenter(page, card);
            // eslint-disable-next-line no-await-in-loop
            await sleep(400);
            // eslint-disable-next-line no-await-in-loop
            await touchCenter(page, minus);
            // eslint-disable-next-line no-await-in-loop
            await sleep(400);
        }
        // eslint-disable-next-line no-await-in-loop
        const data = await page.evaluate(() => ({ events: window.__events, longs: window.__longs }));
        const taps = data.events.filter((e) => e.name === 'pointerdown' || e.name === 'touchstart' || e.name === 'click');
        console.log(`## ${label}  (${viewport.width}x${viewport.height})`);
        console.log(`   interacciones medidas: ${taps.length}`);
        console.log(`   duración total     p50 ${p50(taps.map((e) => e.duration))} ms`);
        console.log(`   hilo ocupado antes p50 ${p50(taps.map((e) => e.inputDelay))} ms   <- polling/SSE/GC`);
        console.log(`   mi código + React  p50 ${p50(taps.map((e) => e.processing))} ms`);
        console.log(`   tareas largas: ${data.longs.length}${data.longs.length ? ` (max ${Math.max(...data.longs)} ms)` : ''}`);
    }

    await browser.close();
})().catch((error) => {
    console.error('FALLO:', error.message);
    process.exit(1);
});
