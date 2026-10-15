/**
 * ¿Quién se come el tiempo en vertical? Perfila el CPU durante los toques y
 * muestra las funciones que más tiempo propio consumen, en cada orientación.
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.AUDIT_BASE || 'http://179.236.76.74:8081';
const TABLE = Number(process.env.AUDIT_TABLE || 9);
const PRODUCT = process.env.AUDIT_PRODUCT || '256fc0c6-5179-4d85-86ac-1dbc979b8b2f';
const EMAIL = 'mozo@resto.com';
const PASSWORD = 'mozo123';
const CPU = Number(process.env.AUDIT_CPU || 4);
const TAPS = Number(process.env.AUDIT_TAPS || 6);
const PORTRAIT = { width: 412, height: 915 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const topFunctions = (profile) => {
    const totals = new Map();
    for (const node of profile.nodes) {
        const frame = node.callFrame || {};
        const name = frame.functionName || '(anónimo)';
        const file = (frame.url || '').split('/').pop().split('?')[0] || '(nativo)';
        const key = `${name}  [${file}:${(frame.lineNumber || 0) + 1}]`;
        totals.set(key, (totals.get(key) || 0) + (node.hitCount || 0));
    }
    const all = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const total = all.reduce((sum, [, hits]) => sum + hits, 0) || 1;
    return { all, total };
};

async function tapOnce(page) {
    await page.evaluate(({ productId }) => {
        const card = document.querySelector(`[data-testid$="producto-nombre-${productId}"]`);
        if (card && !card.disabled) card.click();
    }, { productId: PRODUCT });
    await sleep(400);
    await page.evaluate(({ productId }) => {
        const minus = document.querySelector(`[data-testid$="producto-menos-${productId}"]`);
        if (minus && !minus.disabled) minus.click();
    }, { productId: PRODUCT });
    await sleep(400);
}

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: PORTRAIT, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, locale: 'es-PE',
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 150 });

    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('login-email-input').fill(EMAIL);
    await page.getByTestId('login-password-input').fill(PASSWORD);
    await page.getByTestId('login-submit-button').click();
    await page.getByTestId('salon-root').waitFor({ timeout: 30000 });
    await page.getByTestId(`mesa-card-${TABLE}`).click();
    await page.getByTestId('mesa-sheet').waitFor({ timeout: 20000 });
    await page.locator(`[data-testid$="producto-nombre-${PRODUCT}"]`).waitFor({ timeout: 20000 });
    await sleep(1500);

    for (const [label, viewport] of [
        ['vertical', PORTRAIT],
        ['horizontal', { width: PORTRAIT.height, height: PORTRAIT.width }],
    ]) {
        // eslint-disable-next-line no-await-in-loop
        await page.setViewportSize(viewport);
        // eslint-disable-next-line no-await-in-loop
        await sleep(1000);
        // eslint-disable-next-line no-await-in-loop
        await cdp.send('Profiler.start');
        for (let i = 0; i < TAPS; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await tapOnce(page);
        }
        // eslint-disable-next-line no-await-in-loop
        const { profile } = await cdp.send('Profiler.stop');
        const { all, total } = topFunctions(profile);
        const ms = (hits) => Math.round((hits * 150) / 1000);

        console.log(`\n## ${label}   (${viewport.width}x${viewport.height})   muestras: ${total}  ~${ms(total)} ms de CPU`);
        for (const [name, hits] of all.slice(0, 14)) {
            const share = ((hits / total) * 100).toFixed(1);
            console.log(`   ${String(share).padStart(5)} %  ${String(ms(hits)).padStart(5)} ms  ${name}`);
        }
    }

    await browser.close();
})().catch((error) => {
    console.error('FALLO:', error.message);
    process.exit(1);
});
