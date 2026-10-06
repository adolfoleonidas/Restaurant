// Diagnóstico: qué viewport ve el navegador en emulación Pixel 5.
import { chromium, devices } from '@playwright/test';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3001';
const browser = await chromium.launch();

const probe = async (label, url, opts) => {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  const data = await page.evaluate(() => ({
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    clientW: document.documentElement.clientWidth,
    clientH: document.documentElement.clientHeight,
    visualW: window.visualViewport && Math.round(window.visualViewport.width),
    visualScale: window.visualViewport && Number(window.visualViewport.scale.toFixed(3)),
    dpr: window.devicePixelRatio,
    screenW: window.screen.width,
    screenH: window.screen.height,
    scrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    metaViewport: (document.querySelector('meta[name="viewport"]') || {}).content || null,
    ua: navigator.userAgent.slice(-40),
  }));
  console.log(label, JSON.stringify(data));
  await context.close();
};

await probe('blank@pixel5 ', 'about:blank', { ...devices['Pixel 5'] });
await probe('app@pixel5   ', `${BASE}/login`, { ...devices['Pixel 5'], locale: 'es-PE' });
await probe('app@393x851  ', `${BASE}/login`, { viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.75 });
await probe('app@390x844  ', `${BASE}/login`, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await probe('app@390desk  ', `${BASE}/login`, { viewport: { width: 390, height: 844 } });

await browser.close();
