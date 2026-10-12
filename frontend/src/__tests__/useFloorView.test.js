import { act } from 'react';
import useFloorView from '@/pages/salon/useFloorView';
import { renderHook } from '@/test-utils/renderHook';

const table = (id, number, extra = {}) => ({
    id, number, name: `Mesa ${number}`, area: 'Salón', capacity: 4, status: 'disponible',
    branch_id: 'b1', active_order: null, active_attention_id: null, group: null, ...extra,
});

const tables = [
    table('t1', 1, { status: 'ocupada', area: 'Terraza', active_order: { id: 'o1', status: 'listo' } }),
    table('t2', 2),
    table('t3', 3, { status: 'ocupada', active_order: { id: 'o2', status: 'esperando' } }),
];
const orders = [
    {
        id: 'o1', table_id: 't1', status: 'listo', total: 30, amount_paid: 10, created_at: '2026-01-01T10:00:00Z',
        items: [{ id: 'i1', status: 'listo', quantity: 2 }],
    },
    {
        id: 'o9', order_type: 'recojo', table_id: null, status: 'en_preparacion', total: 12, amount_paid: 0,
        items: [{ id: 'i2', status: 'en_preparacion', quantity: 1 }],
    },
];

const user = { id: 'u1' };
let mounted;
const mount = async (props = {}) => {
    mounted = await renderHook((p) => useFloorView(p), { user, tables, orders, ...props });
    return mounted;
};

beforeEach(() => window.localStorage.clear());
afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('useFloorView', () => {
    test('derives the floor from the tables and the live orders', async () => {
        const { result } = await mount();
        const view = result.current;
        expect(view.areas).toEqual(['todas', 'Terraza', 'Salón']);
        expect(view.units.map((u) => u.anchorNumber)).toEqual([1, 2, 3]);
        expect(view.stateCounts).toMatchObject({ todas: 3, libre: 1, listo: 1 });
        // toPay counts the tables of the "Por cobrar" chip (none here: t1 is ready), not raw orders.
        expect(view.summary).toEqual({ toPrep: 1, toReady: 2, toPay: 0 });
        expect(view.floorSummary).toBe('En cocina 1 plato · listos 2 platos · por cobrar 0 mesas');
        expect(view.floorDue).toBe(20);
        expect(view.pickups.active.map((o) => o.id)).toEqual(['o9']);
        expect(view.byTable.t1.id).toBe('o1');
        expect(view.zoneSections.map((s) => s.area)).toEqual(['Terraza', 'Salón']);
        expect(view.filteredUnits).toHaveLength(3);
    });

    test('state, zone and search filters narrow the visible units', async () => {
        const { result } = await mount();
        await act(async () => result.current.setStateFilter('libre'));
        expect(result.current.filteredUnits.map((u) => u.anchorNumber)).toEqual([2]);
        await act(async () => result.current.setStateFilter('todas'));
        await act(async () => result.current.setAreaFilter('Terraza'));
        expect(result.current.filteredUnits.map((u) => u.anchorNumber)).toEqual([1]);
        await act(async () => result.current.setAreaFilter('todas'));
        await act(async () => result.current.setSearch('mesa 3'));
        expect(result.current.filteredUnits.map((u) => u.anchorNumber)).toEqual([3]);
    });

    test('the sort mode is restored per user and toggling remembers it', async () => {
        window.localStorage.setItem('salon-orden:u1', 'prioridad');
        const { result } = await mount();
        expect(result.current.sortMode).toBe('prioridad');
        expect(result.current.filteredUnits[0].anchorNumber).toBe(1);
        await act(async () => result.current.toggleSortMode());
        expect(result.current.sortMode).toBe('numero');
        expect(window.localStorage.getItem('salon-orden:u1')).toBe('numero');
        await act(async () => result.current.toggleSortMode());
        expect(window.localStorage.getItem('salon-orden:u1')).toBe('prioridad');
    });

    test('a missing floor reads as empty instead of throwing', async () => {
        const { result } = await mount({ tables: null, orders: [] });
        expect(result.current.units).toEqual([]);
        expect(result.current.areas).toEqual(['todas']);
        expect(result.current.floorDue).toBe(0);
    });

    test('the slash key focuses the search box unless the user is typing', async () => {
        const { result } = await mount();
        const input = document.createElement('input');
        document.body.appendChild(input);
        result.current.searchRef.current = input;
        const press = (target) => {
            const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
            target.dispatchEvent(event);
            return event.defaultPrevented;
        };
        expect(press(document.body)).toBe(true);
        expect(document.activeElement).toBe(input);
        // Typing in another field must not be hijacked.
        const other = document.createElement('textarea');
        document.body.appendChild(other);
        other.focus();
        expect(press(other)).toBe(false);
        expect(document.activeElement).toBe(other);
        input.remove();
        other.remove();
    });
});
