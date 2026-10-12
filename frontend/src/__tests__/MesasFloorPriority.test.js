import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const baseTable = (overrides) => ({
  capacity: 4,
  area: 'Salon',
  active_attention_id: null,
  active_order: null,
  qr_status: 'active',
  ...overrides,
});

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();

// Tables in mixed states to verify priority sorting:
// - table 5: cuenta (bill requested) — should appear first
// - table 3: listo (food ready) — should appear second
// - table 1: preparando — third
// - table 7: libre — last
const mockTables = [
  baseTable({ id: 't1', number: 1, name: 'Mesa 1', status: 'disponible', active_order: null }),
  baseTable({
    id: 't3', number: 3, name: 'Mesa 3', status: 'ocupada',
    active_order: { id: 'o3', order_number: 30, status: 'listo', source: 'staff', total: 50, created_at: minutesAgo(10) },
  }),
  baseTable({
    id: 't5', number: 5, name: 'Mesa 5', status: 'esperando_pago',
    active_order: { id: 'o5', order_number: 50, status: 'pendiente_pago', source: 'staff', total: 80, created_at: minutesAgo(25) },
  }),
  baseTable({
    id: 't7', number: 7, name: 'Mesa 7', status: 'ocupada',
    active_order: { id: 'o7', order_number: 70, status: 'en_preparacion', source: 'staff', total: 30, created_at: minutesAgo(5) },
  }),
];

jest.mock('@/hooks/usePolling', () => ({
  __esModule: true,
  default: (fetcher) => {
    const src = fetcher.toString();
    if (/^(?![\s\S]*legacy_only)[\s\S]*\blistTables\b/.test(src)) return { data: mockTables, refetch: jest.fn() };
    return { data: null };
  },
}));

describe('Mesas floor priority and actions (T04)', () => {
  let host, root;
  beforeEach(() => {
    api.get.mockImplementation((path) => {
      if (path === '/branches') return Promise.resolve({ data: [] });
      if (path.startsWith('/orders/')) return Promise.resolve({ data: null });
      return Promise.resolve({ data: [] });
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; });

  it('keeps a fixed order by table number regardless of state', async () => {
    await act(async () => root.render(<Salon />));
    const cards = Array.from(host.querySelectorAll('[data-floor-state]'));
    // Table 5 is waiting for payment and 3 has food ready, but the floor must
    // never reshuffle: order is always by table number.
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual([
      'mesa-card-1', 'mesa-card-3', 'mesa-card-5', 'mesa-card-7',
    ]);
    expect(cards.map((c) => c.getAttribute('data-floor-state'))).toEqual([
      'libre', 'listo', 'cuenta', 'preparando',
    ]);
  });

  it('shows a bell indicator on attention-needed cards', async () => {
    await act(async () => root.render(<Salon />));
    const cuentaCard = host.querySelector('[data-floor-state="cuenta"]');
    const libreCard = host.querySelector('[data-floor-state="libre"]');
    expect(cuentaCard.querySelector('[aria-label="Requiere atencion"]')).toBeTruthy();
    expect(libreCard.querySelector('[aria-label="Requiere atencion"]')).toBeFalsy();
  });

  it('shows elapsed time on active tables', async () => {
    await act(async () => root.render(<Salon />));
    const listoCard = host.querySelector('[data-floor-state="listo"]');
    expect(listoCard.textContent).toMatch(/Hace \d+ min/);
  });

  it('renders a prominent Entregar button on listo cards', async () => {
    await act(async () => root.render(<Salon />));
    const btn = host.querySelector('[data-testid="mesa-card-deliver-3"]');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/Entregar/);
  });

  it('renders a prominent Cobrar button on cuenta cards', async () => {
    await act(async () => root.render(<Salon />));
    const btn = host.querySelector('[data-testid="mesa-card-cobrar-5"]');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/Cobrar/);
  });

  it('calls the serve endpoint when Entregar is clicked', async () => {
    api.post.mockImplementation(() => Promise.resolve({ data: {} }));
    await act(async () => root.render(<Salon />));
    const btn = host.querySelector('[data-testid="mesa-card-deliver-3"]');
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(api.post).toHaveBeenCalledWith('/orders/o3/serve');
  });
});
