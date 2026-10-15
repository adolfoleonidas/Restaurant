/**
 * Auditoría con toques de verdad (eventos táctiles, como el dedo del mozo),
 * alternando vertical y horizontal DENTRO de la misma sesión, para que el
 * arranque en frío no se cargue a una orientación.
 *
 * Mide tres cosas por toque:
 *   - cuánto tarda en cambiar la cantidad en pantalla,
 *   - cuánto tarda en pintarse,
 *   - si el toque NO registró (el dedo se lo comió un scroll, por ejemplo).
 *
 * No deja rastro: el "+" se deshace con el "−".
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.AUDIT_BASE || 'http://179.236.76.74:8081';
const TABLE = Number(process.env.AUDIT_TABLE || 9);
const PRODUCT = process.env.AUDIT_PRODUCT || '256fc0c6-5179-4d85-86ac-1dbc979b8b2f';
const CPU = Number(process.env.AUDIT_CPU || 6);
const ROUNDS = Number(process.env.AUDIT_ROUNDS || 6);
const PORTRAIT = { width: 412, height: 915 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const p50 = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)]);
};

async function setupWatcher(page, productId) {
    await page.evaluate((id) => {
        const qty = document.querySelector(`[data-testid$="producto-cantidad-${id}"]`);
        if (!qty) { window.__watch = { missing: true }; return; }
        const state = {
            before: qty.textContent.trim(),
            at: null,
            painted: null,
            startedAt: performance.now(),
            frames: 0,
        };
        window.__watch = state;
        const frame = () => {
            if (state.painted !== null) return;
            const now = qty.textContent.trim();
            if (now !== state.before) {
                if (state.at === null) state.at = performance.now();
                state.frames += 1;
                if (state.frames >= 3) { state.painted = performance.now(); return; }
            }
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }, productId);
}

async function readWatcher(page, timeoutMs = 4000) {
    try {
        await page.waitForFunction(
            () => window.__watch && (window.__watch.painted !== null || window.__watch.missing),
            null,
            { timeout: timeoutMs, polling: 'raf' },
        );
    } catch { /* se lee lo que haya */ }
    return page.evaluate(() => {
        const s = window.__watch || {};
        return {
            changed: s.at !== null && s.at !== undefined,
            changeMs: s.at ? s.at - s.startedAt : null,
            paintedMs: s.painted ? s.painted - s.startedAt : null,
        };
    });
}

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

    console.log(`# ${BASE}  mesa ${TABLE}  CPU x${CPU}  ${ROUNDS} rondas alternando orientación`);
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('login-email-input').fill('mozo@resto.com');
    await page.getByTestId('login-password-input').fill('mozo123');
    await page.getByTestId('login-submit-button').click();
    await page.getByTestId('salon-root').waitFor({ timeout: 30000 });
    await page.getByTestId(`mesa-card-${TABLE}`).click();
    await page.getByTestId('mesa-sheet').waitFor({ timeout: 20000 });
    await page.locator(`[data-testid$="producto-nombre-${PRODUCT}"]`).waitFor({ timeout: 20000 });
    await sleep(2000);

    const card = `[data-testid$="producto-nombre-${PRODUCT}"]`;
    const minus = `[data-testid$="producto-menos-${PRODUCT}"]`;
    const runs = { vertical: [], horizontal: [] };
    const missed = { vertical: 0, horizontal: 0 };

    for (let round = 0; round < ROUNDS; round += 1) {
        for (const [label, viewport] of [
            ['vertical', PORTRAIT],
            ['horizontal', { width: PORTRAIT.height, height: PORTRAIT.width }],
        ]) {
            // eslint-disable-next-line no-await-in-loop
            await page.setViewportSize(viewport);
            // eslint-disable-next-line no-await-in-loop
            await sleep(250);

            // eslint-disable-next-line no-await-in-loop
            await setupWatcher(page, PRODUCT);
            // eslint-disable-next-line no-await-in-loop
            const tapped = await touchCenter(page, card);
            if (!tapped) { missed[label] += 1; continue; }
            // eslint-disable-next-line no-await-in-loop
            const result = await readWatcher(page);
            if (!result.changed) missed[label] += 1;
            else runs[label].push(result);

            // Deshace el toque (también con el dedo) para no dejar rastro.
            // eslint-disable-next-line no-await-in-loop
            await touchCenter(page, minus);
            // eslint-disable-next-line no-await-in-loop
            await sleep(200);
        }
    }

    for (const label of ['vertical', 'horizontal']) {
        const list = runs[label];
        console.log(`\n## ${label}`);
        console.log(`   toques que registraron: ${list.length}   no registraron: ${missed[label]}`);
        console.log(`   cambio en pantalla: p50 ${p50(list.map((r) => r.changeMs))} ms`);
        console.log(`   pintado:            p50 ${p50(list.map((r) => r.paintedMs))} ms`);
    }
    const v = p50(runs.vertical.map((r) => r.paintedMs));
    const h = p50(runs.horizontal.map((r) => r.paintedMs));
    console.log(`\n## vertical ${v} ms  vs  horizontal ${h} ms  ->  ${(v / Math.max(h, 1)).toFixed(1)}x`);

    await browser.close();
})().catch((error) => {
    console.error('FALLO:', error.message);
    process.exit(1);
});
