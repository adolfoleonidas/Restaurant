import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AttentionReference, { hasAttentionReference, validBusinessDate } from '@/components/AttentionReference';
import useBranchNames from '@/hooks/useBranchNames';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

function BranchLabel({ scope, order }) {
  const names = useBranchNames(scope);
  return <AttentionReference order={order} branchNames={names} />;
}

describe('attention reference and branch labels', () => {
  let host; let root;
  const order = { order_type: 'recojo', acceptance_status: 'aceptado', attention_number: 8, attention_business_date: '2026-10-02', branch_id: 'branch-1' };
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); api.get.mockReset(); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; });

  it('validates date and number without shifting the stored business date', () => {
    expect(hasAttentionReference(order)).toBe(true);
    expect(validBusinessDate('2026-02-30')).toBe(false);
    expect(validBusinessDate('0099-02-28')).toBe(true);
    expect(validBusinessDate('2024-02-29')).toBe(true);
    expect(validBusinessDate('2025-02-29')).toBe(false);
    expect(hasAttentionReference({ ...order, attention_number: true })).toBe(false);
    expect(hasAttentionReference({ ...order, attention_number: 0 })).toBe(false);
    expect(hasAttentionReference({ ...order, order_type: 'delivery' })).toBe(false);
  });

  it('uses the fetched tenant catalog name and ignores a late result from the prior auth scope', async () => {
    let resolveFirst;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ data: [{ id: 'branch-1', name: 'Sucursal nueva' }] });
    await act(async () => root.render(<BranchLabel scope="tenant-a:user-a" order={order} />));
    await act(async () => root.render(<BranchLabel scope="tenant-b:user-b" order={order} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain('Sucursal nueva');
    await act(async () => resolveFirst({ data: [{ id: 'branch-1', name: 'Sucursal anterior' }] }));
    expect(host.textContent).toContain('Sucursal nueva');
    expect(host.textContent).not.toContain('Sucursal anterior');
  });

  it('uses full branch id on staff views when the catalog name is unavailable and never exposes it publicly', async () => {
    await act(async () => root.render(<AttentionReference order={order} />));
    expect(host.textContent).toContain('branch-1');
    await act(async () => root.render(<AttentionReference order={order} publicView />));
    expect(host.textContent).not.toContain('branch-1');
  });

  it('falls back to an unambiguous staff branch id when catalog loading fails', async () => {
    api.get.mockRejectedValue(new Error('catalog unavailable'));
    await act(async () => root.render(<BranchLabel scope="tenant-a:user-a" order={order} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain('branch-1');
    expect(host.textContent).toContain('Atención 8');
  });
});
