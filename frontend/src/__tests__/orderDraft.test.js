import {
    draftCount,
    groupItems,
    isDraft,
    itemState,
    itemsTotal,
    personLabel,
    sendAction,
    summaryLine,
    tableSummary,
} from '@/lib/orderDraft';

const item = (id, productId, name, quantity, extra = {}) => ({
    id,
    product_id: productId,
    product_name: name,
    quantity,
    unit_price: extra.unit_price ?? 10,
    subtotal: quantity * (extra.unit_price ?? 10),
    status: extra.status ?? 'pendiente',
    notes: extra.notes ?? null,
    ...extra,
});

describe('estados del producto', () => {
    it('un producto cargado es borrador: todavía se puede corregir', () => {
        expect(isDraft({ status: 'borrador' }, 'nuevo')).toBe(true);
        expect(itemState({ status: 'borrador' }, 'nuevo').label).toBe('Pendiente');
    });

    it('lo que ya salió a cocina se muestra como enviado y no como borrador', () => {
        const sent = { status: 'pendiente' };
        expect(isDraft(sent, 'enviado_cocina')).toBe(false);
        expect(itemState(sent, 'enviado_cocina').label).toBe('Enviado a cocina');
        expect(itemState({ status: 'en_preparacion' }, 'enviado_cocina').label).toBe('En cocina');
        expect(itemState({ status: 'listo' }, 'enviado_cocina').label).toBe('Listo');
    });

    it('un producto anulado se distingue y deja de contarse', () => {
        const voided = { status: 'cancelado', subtotal: 20 };
        expect(itemState(voided, 'enviado_cocina').label).toBe('Anulado');
        expect(itemsTotal([voided, item('i1', 'p1', 'Sopa', 1)])).toBe(10);
    });

    it('un ítem viejo sin estado sólo es borrador mientras la cuenta no salió', () => {
        expect(isDraft({ status: null }, 'nuevo')).toBe(true);
        expect(isDraft({ status: null }, 'enviado_cocina')).toBe(false);
    });
});

describe('botón de envío', () => {
    it('el primer envío manda la comanda entera', () => {
        const order = { status: 'nuevo' };
        expect(sendAction([item('i1', 'p1', 'Sopa', 1)], order).label).toBe('✈ Enviar a cocina');
    });

    it('después sólo ofrece los adicionales, con su número', () => {
        const order = { status: 'en_preparacion' };
        const items = [
            item('i1', 'p1', 'Sopa', 1, { status: 'pendiente' }),
            item('i2', 'p2', 'Agua', 1, { status: 'borrador' }),
        ];
        const action = sendAction(items, order);
        expect(action.kind).toBe('extra');
        expect(action.label).toBe('✈ Enviar adicionales (1)');
        expect(draftCount(items, order.status)).toBe(1);
    });

    it('sin nada nuevo no hay nada que enviar', () => {
        const order = { status: 'en_preparacion' };
        expect(sendAction([item('i1', 'p1', 'Sopa', 1)], order)).toBeNull();
    });
});

describe('personas', () => {
    it('sin alias cae a Persona N y el compartido se llama Compartido', () => {
        expect(personLabel({}, 0)).toBe('Persona 1');
        expect(personLabel({}, 2)).toBe('Persona 3');
        expect(personLabel({ customer_name: 'Juan' }, 1)).toBe('Juan');
        expect(personLabel({ shared: true }, 0)).toBe('Compartido');
    });
});

describe('agrupación inteligente del resumen de mesa', () => {
    it('junta los platos exactamente iguales en una sola línea', () => {
        const rows = groupItems([
            { item: item('a', 'p1', 'Sopa', 1), person: 'Juan' },
            { item: item('b', 'p1', 'Sopa', 1), person: 'María' },
            { item: item('c', 'p1', 'Sopa', 1), person: 'Persona 3' },
            { item: item('d', 'p1', 'Sopa', 1), person: 'Carlos' },
        ]);
        expect(rows).toHaveLength(1);
        expect(summaryLine(rows[0])).toBe('4× Sopa');
    });

    it('separa el mismo plato cuando la observación es distinta', () => {
        const rows = groupItems([
            { item: item('a', 'p2', 'Pollo', 1), person: 'Juan' },
            { item: item('b', 'p2', 'Pollo', 1), person: 'Carlos' },
            { item: item('c', 'p2', 'Pollo', 1), person: 'Persona 3' },
            { item: item('d', 'p2', 'Pollo', 1, { notes: 'Sin ensalada' }), person: 'María' },
        ]);
        expect(rows.map(summaryLine)).toEqual(['3× Pollo', '1× Pollo — Sin ensalada']);
        // Y el sistema sigue sabiendo quién pidió cada uno.
        const sinEnsalada = rows.find((row) => row.notes === 'Sin ensalada');
        expect(sinEnsalada.people).toEqual([{ label: 'María', quantity: 1 }]);
    });

    it('no funde dos platos distintos que compartan código', () => {
        const rows = groupItems([
            { item: item('a', 'p1', 'Ceviche', 2), person: 'Juan' },
            { item: item('b', 'p1', 'Chicha', 2), person: 'María' },
        ]);
        expect(rows.map(summaryLine)).toEqual(['2× Ceviche', '2× Chicha']);
    });

    it('los anulados no entran al resumen de la mesa', () => {
        const rows = tableSummary([
            { label: 'Juan', items: [item('a', 'p1', 'Sopa', 1)] },
            { label: 'María', items: [item('b', 'p1', 'Sopa', 1, { status: 'cancelado' })] },
        ]);
        expect(rows.map(summaryLine)).toEqual(['1× Sopa']);
    });

    it('el resumen general conserva de quién es cada línea', () => {
        const rows = tableSummary([
            { label: 'Juan', items: [item('a', 'p1', 'Sopa', 1), item('b', 'p2', 'Pollo', 1)] },
            { label: 'María', items: [item('c', 'p2', 'Pollo', 1, { notes: 'Sin ensalada' })] },
        ]);
        const pollo = rows.find((row) => row.notes === '');
        expect(pollo.people).toEqual([{ label: 'Juan', quantity: 1 }]);
    });
});
