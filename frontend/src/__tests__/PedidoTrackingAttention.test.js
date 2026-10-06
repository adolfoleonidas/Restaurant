import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PedidoTracking from '@/pages/PedidoTracking';
import { api } from '@/lib/api';

let mockTrackedOrder;
jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('react-router-dom', () => ({
    useParams: () => ({ code: 'TRACK-1' }),
    useNavigate: () => jest.fn(),
    Link: ({ children }) => <a>{children}</a>,
}));
jest.mock('@/hooks/usePublicStream', () => ({ __esModule: true, default: () => ({ generation: 0 }) }));
jest.mock('@/hooks/usePolling', () => ({ __esModule: true, default: () => ({ data: mockTrackedOrder, loading: false, error: null, refetch: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/contexts/LiveOrderContext', () => ({
    useLiveOrder: () => ({ clearMeta: jest.fn(), meta: null, isActive: false }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('PedidoTracking attention reference', () => {
  let host; let root;
  beforeEach(() => {
    mockTrackedOrder = { id: 'o1', order_number: 91, tracking_code: 'TRACK-1', status: 'en_preparacion', order_type: 'recojo', acceptance_status: 'aceptado', attention_number: 3, attention_business_date: '2026-10-02', items: [] };
    api.get.mockResolvedValue({ data: {} });
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; });
  it('shows the accepted attention reference without replacing order or tracking identifiers', async () => {
    await act(async () => root.render(<PedidoTracking />));
    expect(host.textContent).toContain('Atención 3');
    expect(host.textContent).toContain('2026-10-02');
    expect(host.textContent).toContain('Pedido #91');
    expect(host.textContent).toContain('TRACK-1');
  });
  it('does not show attention for a delivery order', async () => {
    mockTrackedOrder = { ...mockTrackedOrder, order_type: 'delivery', attention_number: 4 };
    await act(async () => root.render(<PedidoTracking />));
    expect(host.textContent).not.toContain('Atención');
  });
  it('does not show a reference when the server accepted-status signal is missing', async () => {
    const { acceptance_status, ...legacyPayload } = mockTrackedOrder;
    mockTrackedOrder = legacyPayload;
    await act(async () => root.render(<PedidoTracking />));
    expect(host.textContent).not.toContain('Atención');
  });
});
