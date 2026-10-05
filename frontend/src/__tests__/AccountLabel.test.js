import { accountLabel } from '@/lib/cash';

describe('accountLabel', () => {
    it('shows the table number and the order number', () => {
        expect(accountLabel({ table_id: 't1', table_number: 5, order_number: 42 })).toBe('Mesa 5 · #42');
    });

    it('never shows a table uuid when the number is missing', () => {
        const label = accountLabel({ table_id: 'c5c7aaaa-bbbb-cccc', order_number: 42 });
        expect(label).toBe('Mesa · #42');
        expect(label).not.toContain('c5c7');
    });

    it('labels counter takeaway and web orders', () => {
        expect(accountLabel({ order_type: 'llevar', order_number: 7 })).toBe('Llevar #7');
        expect(accountLabel({ source: 'public', order_number: 9, customer_name: 'Ana' })).toBe('Pedido web #9 — Ana');
    });
});
