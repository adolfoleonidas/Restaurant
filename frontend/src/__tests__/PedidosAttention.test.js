import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Pedidos from '@/pages/Pedidos';
import { api } from '@/lib/api';

const mockOrders = [{ id: 'order-1', order_number: 32, order_type: 'recojo', acceptance_status: 'aceptado', attention_number: 4, attention_business_date: '2026-10-02', branch_id: 'branch-1', status: 'en_preparacion', created_at: '2026-10-02T10:00:00Z', total: 12, items: [] }];
jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/hooks/usePolling', () => ({ __esModule: true, default: () => ({ data: mockOrders }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
jest.mock('react-router-dom', () => ({ Link: ({ children, to }) => <a href={to}>{children}</a>, useNavigate: () => jest.fn() }));
global.IS_REACT_ACT_ENVIRONMENT = true;

describe('Pedidos attention disambiguation', () => {
  let host; let root;
  beforeEach(() => { api.get.mockReset().mockResolvedValue({ data: [{ id: 'branch-1', name: 'Sucursal Norte' }] }); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; });
  it('shows the number, stored day, and branch name beside the order number', async () => {
    await act(async () => root.render(<Pedidos />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain('#32');
    expect(host.textContent).toContain('Atención 4 · 2026-10-02 · Sucursal Norte');
  });
});
