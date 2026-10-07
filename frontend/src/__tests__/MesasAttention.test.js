import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

const mockOrder = { id: 'order-1', order_number: 22, status: 'en_preparacion', source: 'staff', order_type: 'mesa', acceptance_status: 'aceptado', attention_number: 3, attention_business_date: '2026-10-02', branch_id: 'branch-2', total: 20, items: [{ id: 'i1', product_name: 'Sopa', quantity: 1, unit_price: 20, subtotal: 20, status: 'pendiente' }] };
const mockTables = [{ id: 'table-1', number: 7, name: 'Mesa 7', area: 'Salón', capacity: 4, status: 'ocupada', active_attention_id: 'attention-1', active_order: mockOrder }];
jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({ __esModule: true, default: (fetcher) => fetcher.toString().includes("api.get('/tables')") ? { data: mockTables, refetch: jest.fn() } : { data: mockOrder } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
global.IS_REACT_ACT_ENVIRONMENT = true;

describe('Mesas attention history display', () => {
  let host; let root;
  beforeEach(() => { api.get.mockImplementation((path) => Promise.resolve({ data: path === '/branches' ? [{ id: 'branch-2', name: 'Sucursal Centro' }] : path === '/orders/order-1' ? mockOrder : [] })); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; });
  it('shows the order-attention pair and branch name in the read-only table sheet', async () => {
    await act(async () => root.render(<Salon />));
    await act(async () => host.querySelector('[data-testid="mesa-card-7"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(document.body.textContent).toContain('Mesa 7');
    // S9: la tarjeta del prototipo identifica la cuenta como "#22 · hora"; el
    // contexto de la visita (atención/fecha/sucursal) queda en una línea bajo
    // el resumen, no en la maraña gris que el usuario pidió quitar.
    expect(document.body.textContent).toContain('#22 ·');
    expect(document.body.textContent).toContain('Atención 3');
    expect(document.body.textContent).toContain('2026-10-02');
    expect(document.body.textContent).toContain('Sucursal Centro');
  });
});
