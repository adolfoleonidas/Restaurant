/**
 * Traza del navegador durante los toques: dice en qué se va el tiempo, sin
 * suposiciones — JavaScript mío, recálculo de estilo, layout, pintado o compuesto.
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.AUDIT_BASE || 'http://179.236.76.74:8081';
const TABLE = Number(process.env.AUDIT_TABLE || 9);
const PRODUCT = process.env.AUDIT_PRODUCT || '256fc0c6-5179-4d85-86ac-1dbc979b8b2f';
const CPU = Number(process.env.AUDIT_CPU || 6);
const TAPS = Number(process.env.AUDIT_TAPS || 8);
const PORTRAIT = { width: 412, height: 915 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    const events = [];
    cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
    await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,v8.execute,blink.user_timing',
        transferMode: 'ReportEvents',
    });

    const card = page.locator(`[data-testid$="producto-nombre-${PRODUCT}"]`).first();
    for (let i = 0; i < TAPS; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const box = await card.boundingBox();
        // eslint-disable-next-line no-await-in-loop
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        // eslint-disable-next-line no-await-in-loop
        await sleep(500);
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate((sel) => {
            const minus = document.querySelector(sel);
            if (minus && !minus.disabled) minus.click();
        }, `[data-testid$="producto-menos-${PRODUCT}"]`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(300);
    }
    await new Promise((resolve) => { cdp.once('Tracing.tracingComplete', resolve); cdp.send('Tracing.end'); });
    await sleep(500);

    // Suma por tipo de trabajo. `dur` viene en microsegundos.
    const byName = new Map();
    for (const event of events) {
        if (!event.dur) continue;
        byName.set(event.name, (byName.get(event.name) || 0) + event.dur);
    }
    const total = [...byName.values()].reduce((sum, value) => sum + value, 0) || 1;
    console.log(`\n## ${TAPS} toques en vertical, CPU x${CPU}   (traza: ${events.length} eventos)`);
    console.log('   por tipo de trabajo:');
    for (const [name, dur] of [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
        console.log(`   ${String(Math.round(dur / 1000)).padStart(5)} ms  ${((dur / total) * 100).toFixed(1).padStart(5)} %  ${name}`);
    }

    // Dentro de las llamadas a función, qué función.
    const byFunction = new Map();
    for (const event of events) {
        if (!event.dur || (event.name !== 'FunctionCall' && event.name !== 'EvaluateScript')) continue;
        const frame = event.args?.data || {};
        const key = `${frame.functionName || '(anónimo)'}  [${(frame.url || '').split('/').pop()}:${(frame.lineNumber || 0) + 1}]`;
        byFunction.set(key, (byFunction.get(key) || 0) + event.dur);
    }
    const fnTotal = [...byFunction.values()].reduce((sum, value) => sum + value, 0) || 1;
    console.log(`\n   dentro del JavaScript (total ${Math.round(fnTotal / 1000)} ms):`);
    for (const [name, dur] of [...byFunction.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
        console.log(`   ${String(Math.round(dur / 1000)).padStart(5)} ms  ${((dur / fnTotal) * 100).toFixed(1).padStart(5)} %  ${name}`);
    }

    await browser.close();
})().catch((error) => {
    console.error('FALLO:', error.message);
    process.exit(1);
});
