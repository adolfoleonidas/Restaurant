import fs from 'fs';
import path from 'path';

/**
 * Global setup: provision two fresh, branch-bound tables per run so every
 * execution starts from a clean, deterministic state without mutating the
 * seeded demo tables (1-12) or the seed-roles tables (20-22).
 *
 * The attention/visit lifecycle makes resetting an already-used table hard
 * (paid orders + open attentions cannot be trivially released), so instead of
 * resetting we mint new high-numbered tables each run and record their numbers
 * in `e2e/.runtime.json` for the specs to read.
 */
const BASE = process.env.PW_API_BASE || 'http://localhost:8000/api';
const ADMIN = { email: 'admin@resto.com', password: 'admin123' };
const BRANCH_NAME = 'Sucursal MVP';
const RUNTIME_PATH = path.resolve('e2e', '.runtime.json');

async function req(method: string, url: string, token: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return res;
}

export default async function globalSetup() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  if (!loginRes.ok) {
    throw new Error(
      `global-setup: admin login failed (${loginRes.status}). Is the backend running on :8000? Run \`node e2e/fixtures/seed-roles.js\` first.`,
    );
  }
  const { access_token } = await loginRes.json();
  const token: string = access_token;

  const [tables, branches] = await Promise.all([
    (await req('GET', '/tables', token)).json(),
    (await req('GET', '/branches', token)).json(),
  ]);
  const branch = (branches as any[]).find((b) => b.name === BRANCH_NAME);
  if (!branch) {
    throw new Error(`global-setup: branch "${BRANCH_NAME}" not found. Run \`node e2e/fixtures/seed-roles.js\` first.`);
  }

  const used = new Set((tables as any[]).map((t) => Number(t.number)));
  const free: number[] = [];
  let n = 90000 + (Math.floor(Date.now() / 1000) % 8000);
  while (free.length < 2) {
    if (!used.has(n)) free.push(n);
    n += 1;
  }

  for (const number of free) {
    await req('POST', '/tables', token, {
      number,
      name: `Mesa E2E ${number}`,
      capacity: 4,
      area: 'Salón',
      branch_id: branch.id,
    });
    console.log(`global-setup: created table ${number} (branch ${BRANCH_NAME})`);
  }

  fs.writeFileSync(
    RUNTIME_PATH,
    JSON.stringify({ desktopTable: free[0], mobileTable: free[1] }, null, 2),
  );
  console.log(`global-setup: done → desktop=${free[0]} mobile=${free[1]}`);
}
