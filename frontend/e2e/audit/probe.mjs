// Probe v2: connect to an already-running Chromium over CDP (no browser spawn
// from Node, which the sandbox blocks with EPERM on piped stdio).
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CDP = process.env.AUDIT_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const OUT = path.resolve('e2e', 'audit', 'out');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
console.log('title:', await page.title());
console.log('email inputs:', await page.locator('[data-testid="login-email-input"]').count());
await page.locator('[data-testid="login-email-input"]').fill('admin@resto.com');
await page.locator('[data-testid="login-password-input"]').fill('admin123');
await page.locator('[data-testid="login-submit-button"]').click();
await page.waitForSelector('[data-testid="logout-button"]', { timeout: 25000 });
console.log('logged in ->', page.url());
await page.screenshot({ path: path.join(OUT, 'probe-dashboard.png') });
console.log('console errors:', errors.length ? errors : 'none');
await context.close();
await browser.close();
