/**
 * Bisecta el costo de vertical: desactiva un sospechoso por vez con CSS en vivo
 * (sin desplegar) y mide el toque -> pintado en vertical con cada uno.
 *
 * Si apagar algo cierra la brecha con horizontal, ese era el culpable.
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.AUDIT_BASE || 'http://179.236.76.74:8081';
const TABLE = Number(process.env.AUDIT_TABLE || 9);
const PRODUCT = process.env.AUDIT_PRODUCT || '256fc0c6-5179-4d85-86ac-1dbc979b8b2f';
const CPU = Number(process.env.AUDIT_CPU || 6);
const ROUNDS = Number(process.env.AUDIT_ROUNDS || 5);
const PORTRAIT = { width: 412, height: 915 };
const LANDSCAPE = { width: 915, height: 412 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const p50 = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length / 2)]);
};

const CONFIGS = [
    ['A. tal como está', null],
    ['B. sin barra inferior de navegación', '.app-bottom-nav { display: none !important; }'],
    ['C. barra de acciones no fija', '[data-testid="mesa-sheet-acciones"] { position: static !important; }'],
    ['D. cabecera no fija', '.app-header { position: static !important; }'],
    ['E. sin ninguna barra fija', '.app-bottom-nav, .app-header, [data-testid="mesa-sheet-acciones"] { position: static !important; } .app-bottom-nav { display: none !important; }'],
    ['F. grilla de productos sin scroll propio', '[data-testid="mesa-sheet-productos"] { max-height: none !important; overflow: visible !important; }'],
    ['G. sin dvh (alto fijo en px)', '.app-shell, main, [data-testid="salon-root"] { min-height: 0 !important; } [data-testid="mesa-sheet-productos"] { max-height: 420px !important; }'],
];

async function setupWatcher(page, productId) {
    await page.evaluate((id) => {
        const qty = document.querySelector(`[data-testid$="producto-cantidad-${id}"]`);
        if (!qty) { window.__watch = { missing: true }; return; }
        const state = { before: qty.textContent.trim(), at: null, painted: null, startedAt: performance.now(), frames: 0 };
        window.__watch = state;
        const frame = () => {
            if (state.painted !== null) return;
            if (qty.textContent.trim() !== state.before) {
                if (state.at === null) state.at = performance.now();
                state.frames += 1;
                if (state.frames >= 3) { state.painted = performance.now(); return; }
            }
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }, productId);
}

async function readWatcher(page, timeoutMs = 5000) {
    try {
        await page.waitForFunction(() => window.__watch && (window.__watch.painted !== null || window.__watch.missing), null, { timeout: timeoutMs, polling: 'raf' });
    } catch { /* se lee lo que haya */ }
    return page.evaluate(() => {
        const s = window.__watch || {};
        return { changed: Boolean(s.at), paintedMs: s.painted ? s.painted - s.startedAt : null };
    });
}

async function touchCenter(page, selector) {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) return false;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    return true;
}

async function measure(page, viewport, card, minus, rounds) {
    const painted = [];
    let missed = 0;
    await page.setViewportSize(viewport);
    await sleep(250);
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await setupWatcher(page, PRODUCT);
        // eslint-disable-next-line no-await-in-loop
        if (!await touchCenter(page, card)) { missed += 1; continue; }
        // eslint-disable-next-line no-await-in-loop
        const result = await readWatcher(page);
        if (result.paintedMs === null) missed += 1; else painted.push(result.paintedMs);
        // eslint-disable-next-line no-await-in-loop
        await touchCenter(page, minus);
        // eslint-disable-next-line no-await-in-loop
        await sleep(180);
    }
    return { p50: p50(painted), n: painted.length, missed };
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
    console.log(`# CPU x${CPU}, ${ROUNDS} toques por configuración\n`);

    const reference = await measure(page, LANDSCAPE, card, minus, ROUNDS);
    console.log(`REFERENCIA horizontal (sin overrides): p50 ${reference.p50} ms  (n=${reference.n}, sin registrar ${reference.missed})\n`);

    for (const [label, css] of CONFIGS) {
        // eslint-disable-next-line no-await-in-loop
        await page.addStyleTag({ content: css ? `${css}` : '/* nada */' });
        // eslint-disable-next-line no-await-in-loop
        const result = await measure(page, PORTRAIT, card, minus, ROUNDS);
        const verdict = result.p50 === null ? 'sin datos'
            : result.p50 <= reference.p50 * 1.25 ? 'CIERRA LA BRECHA'
                : result.p50 <= reference.p50 * 1.6 ? 'mejora algo' : 'sigue lento';
        console.log(`vertical ${label.padEnd(42)} p50 ${String(result.p50).padStart(4)} ms  (n=${result.n}, sin registrar ${result.missed})  -> ${verdict}`);
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate(() => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('!important')) s.remove(); }); });
        // eslint-disable-next-line no-await-in-loop
        await sleep(250);
    }

    await browser.close();
})().catch((error) => {
    console.error('FALLO:', error.message);
    process.exit(1);
});
