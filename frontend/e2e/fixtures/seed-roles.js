#!/usr/bin/env node
/**
 * Test-only fixture (task E3): ensures the branch, staff accounts, and
 * branch-bound tables required by the MVP flow journeys (E4/E5) exist.
 *
 * Why this script exists: backend/seed.py (FULL demo seed) creates the
 * restaurant, 4 role users, categories, products, zones, and 12 tables,
 * but creates NO branches and assigns NO branch_id. Branch isolation is
 * fail-closed (backend/branch_access.py): a non-admin user without
 * branch_id gets 403 "El usuario no tiene una sucursal asignada" on
 * orders/cash routes, and branch users cannot see branchless tables.
 *
 * This script talks ONLY to the public REST API as admin. It never edits
 * backend sources and never touches seeded demo users. Idempotent: safe
 * to re-run; it finds-or-creates every record and re-asserts passwords,
 * branch assignment, and active status.
 *
 * Usage (from frontend/):
 *   node e2e/fixtures/seed-roles.js
 *
 * Env overrides:
 *   API_BASE        (default http://localhost:8000/api)
 *   ADMIN_EMAIL     (default admin@resto.com)
 *   ADMIN_PASSWORD  (default admin123)
 *   BRANCH_NAME     (default Sucursal MVP)
 *
 * Note on emails: backend EmailStr validation rejects special-use TLDs
 * (`.local`, `.test` fail with 422 "should have a period" / reserved),
 * so fixtures use RFC-reserved example.com: mozo.test@example.com etc.
 */

const API_BASE = process.env.API_BASE || 'http://localhost:8000/api';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@resto.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const BRANCH_NAME = process.env.BRANCH_NAME || 'Sucursal MVP';
const BRANCH_TIMEZONE = 'America/Lima';
const BRANCH_CUTOFF = '04:00';
const TEST_PASSWORD = 'test1234';

const TEST_USERS = [
  { email: 'mozo.test@example.com', full_name: 'Mozo Test', role: 'mozo' },
  { email: 'cocinero.test@example.com', full_name: 'Cocinero Test', role: 'cocina' },
  { email: 'cajero.test@example.com', full_name: 'Cajero Test', role: 'cajero' },
];

// Tables bound to the test branch. Numbers 20+ avoid collision with the
// seeded tables 1-12 (table number is unique per restaurant).
const TEST_TABLES = [20, 21, 22];
const TEST_TABLE_AREA = 'Salón';

let adminToken = null;

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = data && typeof data === 'object' ? JSON.stringify(data) : String(data);
    throw new Error(`${method} ${path} -> ${res.status} ${detail}`);
  }
  return data;
}

async function login(email, password) {
  return req('POST', '/auth/login', { email, password });
}

async function ensureBranch() {
  const branches = await req('GET', '/branches', undefined, adminToken);
  const existing = branches.find((b) => b.name === BRANCH_NAME);
  if (existing) {
    console.log(`branch: found "${existing.name}" id=${existing.id}`);
    return existing;
  }
  const created = await req('POST', '/branches', {
    name: BRANCH_NAME,
    timezone: BRANCH_TIMEZONE,
    business_day_cutoff: BRANCH_CUTOFF,
    pickup_enabled: false,
  }, adminToken);
  console.log(`branch: created "${created.name}" id=${created.id}`);
  return created;
}

async function ensureUser(spec, branchId) {
  const users = await req('GET', '/users', undefined, adminToken);
  const existing = users.find((u) => u.email === spec.email);
  if (existing) {
    // Re-assert deterministic password, branch, and active status.
    const updated = await req('PATCH', `/users/${existing.id}`, {
      password: TEST_PASSWORD,
      branch_id: branchId,
      status: 'active',
      role: spec.role,
    }, adminToken);
    console.log(`user: updated ${spec.email} role=${updated.role} branch_id=${updated.branch_id}`);
    return updated;
  }
  const created = await req('POST', '/users', {
    email: spec.email,
    password: TEST_PASSWORD,
    full_name: spec.full_name,
    role: spec.role,
    branch_id: branchId,
  }, adminToken);
  console.log(`user: created ${spec.email} role=${created.role} branch_id=${created.branch_id}`);
  return created;
}

async function ensureTable(number, branchId) {
  const tables = await req('GET', '/tables', undefined, adminToken);
  const existing = tables.find((t) => t.number === number);
  if (existing) {
    if (existing.branch_id !== branchId) {
      const updated = await req('PATCH', `/tables/${existing.id}`, { branch_id: branchId }, adminToken);
      console.log(`table ${number}: rebound to branch (id=${updated.id})`);
      return updated;
    }
    console.log(`table ${number}: already bound to branch (id=${existing.id})`);
    return existing;
  }
  const created = await req('POST', '/tables', {
    number,
    name: `Mesa ${number}`,
    capacity: 4,
    area: TEST_TABLE_AREA,
    branch_id: branchId,
  }, adminToken);
  console.log(`table ${number}: created (id=${created.id})`);
  return created;
}

async function main() {
  console.log(`API_BASE=${API_BASE} branch="${BRANCH_NAME}"`);

  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  adminToken = adminLogin.access_token;
  console.log(`admin login: OK (${ADMIN_EMAIL})`);

  const branch = await ensureBranch();
  const branchId = branch.id;

  for (const spec of TEST_USERS) await ensureUser(spec, branchId);
  for (const number of TEST_TABLES) await ensureTable(number, branchId);

  // Verify each test user can log in and reports the branch assignment.
  console.log('\nverification:');
  const summary = { branch: { name: branch.name, id: branchId }, users: [] };
  for (const spec of TEST_USERS) {
    const r = await login(spec.email, TEST_PASSWORD);
    const ok = r.user.branch_id === branchId;
    console.log(`  login ${spec.email} -> ${ok ? 'OK' : 'MISMATCH'} role=${r.user.role} branch_id=${r.user.branch_id || '(none)'}`);
    if (!ok) throw new Error(`branch mismatch for ${spec.email}`);
    summary.users.push({ email: spec.email, password: TEST_PASSWORD, role: r.user.role, branch_id: r.user.branch_id });
  }

  // Verify branch-scoped visibility: mozo must see the test tables.
  const mozoLogin = await login(TEST_USERS[0].email, TEST_PASSWORD);
  const mozoTables = await req('GET', '/tables', undefined, mozoLogin.access_token);
  console.log(`  mozo sees ${mozoTables.length} tables (expect ${TEST_TABLES.length}: numbers ${TEST_TABLES.join(', ')})`);
  if (mozoTables.length !== TEST_TABLES.length) {
    throw new Error(`mozo branch table visibility unexpected: ${mozoTables.length}`);
  }

  // Data counts as admin (tenant-wide view).
  const [branches, tables, products] = await Promise.all([
    req('GET', '/branches', undefined, adminToken),
    req('GET', '/tables', undefined, adminToken),
    req('GET', '/products', undefined, adminToken),
  ]);
  console.log(`  counts: branches=${branches.length} tables=${tables.length} products=${products.length}`);
  summary.counts = { branches: branches.length, tables: tables.length, products: products.length };

  console.log('\nFIXTURE READY');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(`FIXTURE FAILED: ${err.message}`);
  process.exit(1);
});
