/**
 * ¿Cuánto de la pantalla cambia con un solo toque?
 *
 * Si un toque a un producto muta decenas de nodos repartidos por la pantalla, es
 * que React está re-renderizando toda la pantalla del Salón (el piso escondido,
 * la cabecera, los filtros, el resumen...) para cambiar un número.
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.AUDIT_BASE || 'http://179.236.76.74:8081';
const TABLE = Number(process.env.AUDIT_TABLE || 9);
const PRODUCT = process.env.AUDIT_PRODUCT || '256fc0c6-5179-4d85-86ac-1dbc979b8b2f';
const CPU = Number(process.env.AUDIT_CPU || 6);
const TAPS = Number(process.env.AUDIT_TAPS || 6);
const PORTRAIT = { width: 412, height: 915 };
const LANDSCAPE = { width: 915, height: 412 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tapAndCount(page, selector, minusSelector) {
    await page.evaluate(() => {
        window.__mut = [];
        if (window.__mutObserver) window.__mutObserver.disconnect();
        window.__mutObserver = new MutationObserver((records) => {
            for (const record of records) window.__mut.push(record.target);
        });
        window.__mutObserver.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    });
    const box = await page.locator(selector).first().boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(700);
    const report = await page.evaluate(() => {
        window.__mutObserver.disconnect();
        const unique = new Set(window.__mut.map((el) => {
            if (!el || el.nodeType === 3) return '#texto';
            const testid = el.closest?.('[data-testid]')?.getAttribute('data-testid');
            return testid || (el.tagName ? el.tagName.toLowerCase() : '?');
        }));
        return { mutations: window.__mut.length, zones: [...unique].slice(0, 30), zoneCount: unique.size };
    });
    await page.evaluate((sel) => {
        const minus = document.querySelector(sel);
        if (minus && !minus.disabled) minus.click();
    }, minusSelector);
    await sleep(400);
    return report;
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
    // Sin red: el toque es puramente local, así lo que se mide es el re-render.
    await page.route('**/api/**', (route) => route.abort());

    const card = `[data-testid$="producto-nombre-${PRODUCT}"]`;
    const minus = `[data-testid$="producto-menos-${PRODUCT}"]`;

    for (const [label, viewport] of [['vertical', PORTRAIT], ['horizontal', LANDSCAPE]]) {
        // eslint-disable-next-line no-await-in-loop
        await page.setViewportSize(viewport);
        // eslint-disable-next-line no-await-in-loop
        await sleep(500);
        console.log(`\n## ${label}  (${viewport.width}x${viewport.height})`);
        for (let i = 0; i < TAPS; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const r = await tapAndCount(page, card, minus);
            console.log(`   toque ${i + 1}: ${String(r.mutations).padStart(4)} mutaciones en ${String(r.zoneCount).padStart(2)} zonas -> ${r.zones.slice(0, 8).join(', ')}`);
        }
    }

    await browser.close();
})().catch((error) => {
    console.error('FALLO:', error.message);
    process.exit(1);
});
