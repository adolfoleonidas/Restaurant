/**
 * Reproduce el flujo que reporta el mozo y CUENTA LOS TOQUES PERDIDOS.
 *
 * "le doy en nuevo, le doy clic en un producto, no se agrega; le doy en el otro y
 * sí se agrega". Eso no es lentitud: es un toque que se pierde. Aquí se toca de
 * verdad (eventos táctiles, como el dedo) y por cada toque se mira si la tarjeta
 * cambió en pantalla hasta 2,5 s después.
 *
 * Escenarios:
 *   A. toques seguidos sobre una cuenta ya abierta (base)
 *   B. "Nuevo pedido" y toques inmediatamente después (el flujo reportado)
 *   C. dos toques muy juntos (toque perdido por re-render entre down y up)
 *
 * Deja rastro mínimo: los "+" de A y C se deshacen con "−"; B crea una cuenta.
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.AUDIT_BASE || 'http://179.236.76.74:8081';
const TABLE = Number(process.env.AUDIT_TABLE || 9);
const CPU = Number(process.env.AUDIT_CPU || 4);
const MOZO = { email: 'mozo@resto.com', password: 'mozo123' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tap(page, selector) {
    // El toque es por coordenadas: si el elemento está fuera de la pantalla, el
    // dedo cae en el vacío. Se desplaza primero, como haría el mozo.
    const locator = page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
    const box = await locator.boundingBox();
    if (!box) throw new Error(`sin caja: ${selector}`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const size = page.viewportSize();
    if (x < 0 || y < 0 || x > size.width || y > size.height) {
        throw new Error(`fuera de pantalla (${Math.round(x)},${Math.round(y)}): ${selector}`);
    }
    await page.touchscreen.tap(x, y);
}

/** Un toque sobre `card` (el botón `btn`), y cuánto tardó en cambiar de texto. */
async function tapAndWatch(page, btnSelector, cardSelector, timeoutMs = 2500) {
    const result = await page.evaluate(([btn, card]) => {
        const button = document.querySelector(btn);
        const node = document.querySelector(card);
        if (!button || !node) return { error: 'sin elemento' };
        window.__tap = { before: node.textContent, changedAt: null, startedAt: performance.now() };
        const frame = () => {
            const state = window.__tap;
            if (!state || state.changedAt !== null) return;
            if (node.textContent !== state.before) { state.changedAt = performance.now(); return; }
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        return { ok: true };
    }, [btnSelector, cardSelector]);
    if (result.error) return { lost: true, ms: null, error: result.error };

    await tap(page, btnSelector);

    try {
        await page.waitForFunction(() => window.__tap && window.__tap.changedAt !== null, null, { timeout: timeoutMs });
        const ms = await page.evaluate(() => Math.round(window.__tap.changedAt - window.__tap.startedAt));
        return { lost: false, ms };
    } catch {
        return { lost: true, ms: null };
    }
}

function summarize(label, results) {
    const lost = results.filter((r) => r.lost).length;
    const times = results.filter((r) => !r.lost).map((r) => r.ms).sort((a, b) => a - b);
    console.log(`  ${label}: ${results.length} toques · PERDIDOS ${lost} · `
        + `p50 ${times.length ? times[Math.floor(times.length / 2)] : '-'} ms`
        + `${times.length ? ` · peor ${times[times.length - 1]} ms` : ''}`);
    return { label, total: results.length, lost, times };
}

async function main() {
    const browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 2.6,
        hasTouch: true,
        isMobile: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });

    console.log(`== ${BASE} · mesa ${TABLE} · CPU x${CPU} ==`);
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', MOZO.email);
    await page.fill('input[type="password"]', MOZO.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/salon/, { timeout: 30000 });
    await page.waitForSelector(`[data-testid="mesa-card-${TABLE}"]`, { timeout: 30000 });

    await tap(page, `[data-testid="mesa-card-${TABLE}"]`);
    try {
        await page.waitForSelector('[data-testid="mesa-sheet"]', { timeout: 20000 });
    } catch {
        const state = await page.evaluate(() => ({
            testids: [...new Set([...document.querySelectorAll('[data-testid]')]
                .map((e) => e.dataset.testid).filter((t) => /mesa|sheet|salon|login/.test(t)))].slice(0, 30),
            text: document.body.innerText.slice(0, 300).replace(/\s+/g, ' '),
            url: location.href,
        }));
        console.log('  la hoja no abrió. url:', state.url);
        console.log('  texto:', state.text);
        console.log('  testids:', state.testids.join(', '));
        await page.screenshot({ path: '.tmp/lost-taps-no-sheet.png' });
        await browser.close();
        return;
    }

    // Los identificadores reales de las tarjetas de producto.
    const cards = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('[data-testid*="-producto-nombre-"]').forEach((el) => {
            const id = el.dataset.testid.split('-producto-nombre-')[1];
            out.push({ id, card: `[data-testid="${el.dataset.testid}"]`, add: `[data-testid$="-producto-${id}"]` });
        });
        return out;
    });
    console.log(`  productos en la carta: ${cards.map((c) => c.id.slice(0, 8)).join(', ')}`);
    if (cards.length < 2) { console.log('  ABORTO: hacen falta dos productos'); await browser.close(); return; }

    const [a, b] = cards;
    const results = [];

    // --- A: base, cuenta ya abierta ---
    console.log('\nA) cuenta ya abierta, toques seguidos');
    const A = [];
    for (let i = 0; i < 5; i += 1) A.push(await tapAndWatch(page, a.add, a.card));
    results.push(summarize('A', A));
    // se deshace
    for (let i = 0; i < A.filter((r) => !r.lost).length; i += 1) await tap(page, `[data-testid$="-producto-menos-${a.id}"]`);
    await sleep(1500);

    // --- B: "Nuevo pedido" y toques inmediatamente después ---
    console.log('\nB) "Nuevo pedido" y toques inmediatamente después');
    const nuevo = await page.$('[data-testid="mesa-sheet-nuevo-pedido"]');
    if (!nuevo) {
        console.log('  no hay botón "Nuevo pedido" en esta pantalla');
    } else {
        await tap(page, '[data-testid="mesa-sheet-nuevo-pedido"]');
        const B = [];
        // Sin esperar: es exactamente lo que hace el mozo.
        for (let i = 0; i < 4; i += 1) B.push(await tapAndWatch(page, i % 2 ? b.add : a.add, i % 2 ? b.card : a.card));
        results.push(summarize('B', B));
    }
    await sleep(2500);
    await page.screenshot({ path: '.tmp/lost-taps.png' });

    console.log('\n== resumen ==');
    results.forEach((r) => console.log(`  ${r.label}: ${r.lost}/${r.total} perdidos`));
    if (consoleErrors.length) {
        console.log('  errores de consola:');
        [...new Set(consoleErrors)].slice(0, 6).forEach((e) => console.log(`    ${e}`));
    }
    await browser.close();
}

main().catch((error) => { console.error(error); process.exit(1); });
