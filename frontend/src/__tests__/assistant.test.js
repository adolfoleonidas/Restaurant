import { SpeechQueue } from '@/lib/assistant/speechQueue';
import { pendingAnnouncement, textFor, PRIORITY } from '@/lib/assistant/phrases';

describe('assistant phrase mapping', () => {
    it('maps a bill request from a table event only for cash/floor roles', () => {
        const event = { type: 'table', table_id: 't5', status: 'esperando_pago' };
        expect(pendingAnnouncement(event, 'cajero')).toMatchObject({ kind: 'bill', refId: 't5', priority: PRIORITY.attention });
        expect(pendingAnnouncement(event, 'cocina')).toBeNull();
    });

    it('maps a new kitchen order only for kitchen/admin', () => {
        const event = { type: 'order', order_id: 'o1', status: 'enviado_cocina' };
        expect(pendingAnnouncement(event, 'cocina')).toMatchObject({ kind: 'new_order', refId: 'o1' });
        expect(pendingAnnouncement(event, 'cajero')).toBeNull();
    });

    it('maps a ready order only for floor/admin', () => {
        const event = { type: 'order', order_id: 'o1', status: 'listo' };
        expect(pendingAnnouncement(event, 'mozo')).toMatchObject({ kind: 'ready' });
        expect(pendingAnnouncement(event, 'cocina')).toBeNull();
    });

    it('ignores unrelated events', () => {
        expect(pendingAnnouncement({ type: 'cash', status: 'open' }, 'admin')).toBeNull();
        expect(pendingAnnouncement(null, 'admin')).toBeNull();
        expect(pendingAnnouncement({ type: 'order', order_id: 'o1', status: 'pagado' }, 'admin')).toBeNull();
    });

    it('builds neutral Spanish phrases with table and count', () => {
        expect(textFor({ kind: 'new_order' }, { table: 5, count: 3 })).toBe('Nuevo pedido, mesa 5, 3 platos');
        expect(textFor({ kind: 'new_order' }, { table: 5, count: 1 })).toBe('Nuevo pedido, mesa 5, 1 plato');
        expect(textFor({ kind: 'new_order' }, {})).toBe('Nuevo pedido en cocina');
        expect(textFor({ kind: 'ready' }, { table: 5 })).toBe('Mesa 5 lista para entregar');
        expect(textFor({ kind: 'ready' }, {})).toBe('Un pedido está listo para entregar');
        expect(textFor({ kind: 'bill' }, { table: 5 })).toBe('Mesa 5 pidió la cuenta');
    });

    it('names the sales area when the order is not at a table', () => {
        expect(textFor({ kind: 'new_order' }, { orderType: 'llevar', count: 2 })).toBe('Nuevo pedido para llevar, 2 platos');
        expect(textFor({ kind: 'new_order' }, { orderType: 'recojo' })).toBe('Nuevo pedido para recoger');
        expect(textFor({ kind: 'new_order' }, { orderType: 'delivery' })).toBe('Nuevo pedido para envío a domicilio');
        // A table wins over the area wording.
        expect(textFor({ kind: 'new_order' }, { table: 5, orderType: 'llevar' })).toBe('Nuevo pedido, mesa 5');
    });
});

function makeQueue() {
    const spoken = [];
    const pending = [];
    let now = 0;
    const queue = new SpeechQueue({
        speak: (text, { onDone }) => { spoken.push(text); pending.push(onDone); },
        cancel: () => { spoken.push('__cancel__'); },
        now: () => now,
        minRepeatMs: 60000,
    });
    return {
        queue,
        spoken,
        finish: () => { const done = pending.shift(); done?.(); },
        tick: (ms) => { now += ms; },
    };
}

describe('SpeechQueue', () => {
    it('speaks a single item at a time and then drains the queue', () => {
        const { queue, spoken, finish } = makeQueue();
        queue.enqueue({ key: 'a', text: 'A' });
        queue.enqueue({ key: 'b', text: 'B' });
        expect(spoken).toEqual(['A']);
        finish();
        expect(spoken).toEqual(['A', 'B']);
        expect(queue.pending).toBe(0);
    });

    it('serves the highest priority first', () => {
        const { queue, spoken, finish } = makeQueue();
        queue.enqueue({ key: 'a', text: 'A', priority: PRIORITY.info });
        queue.enqueue({ key: 'b', text: 'B', priority: PRIORITY.order });
        queue.enqueue({ key: 'c', text: 'C', priority: PRIORITY.attention });
        finish();
        expect(spoken).toEqual(['A', 'C']);
        finish();
        expect(spoken).toEqual(['A', 'C', 'B']);
    });

    it('rejects duplicates while queued and repeats only after the window', () => {
        const { queue, spoken, finish, tick } = makeQueue();
        expect(queue.enqueue({ key: 'a', text: 'A' })).toBe(true);
        finish();
        expect(queue.enqueue({ key: 'a', text: 'A' })).toBe(false);
        tick(60001);
        expect(queue.enqueue({ key: 'a', text: 'A' })).toBe(true);
        expect(spoken).toEqual(['A', 'A']);
    });

    it('ignores items without text or key', () => {
        const { queue, spoken } = makeQueue();
        expect(queue.enqueue({ key: 'a' })).toBe(false);
        expect(queue.enqueue({ text: 'A' })).toBe(false);
        expect(spoken).toEqual([]);
    });

    it('cancel empties the queue, stops the speaker and ignores a late completion', () => {
        const { queue, spoken, finish } = makeQueue();
        queue.enqueue({ key: 'a', text: 'A' });
        queue.enqueue({ key: 'b', text: 'B' });
        queue.cancel();
        expect(spoken).toEqual(['A', '__cancel__']);
        expect(queue.pending).toBe(0);
        finish();
        expect(spoken).toEqual(['A', '__cancel__']);
    });

    it('never stalls when the speaker completes immediately (no TTS support)', () => {
        const spoken = [];
        const queue = new SpeechQueue({
            speak: (text, { onDone }) => { spoken.push(text); onDone(); },
            cancel: () => {},
        });
        queue.enqueue({ key: 'a', text: 'A' });
        queue.enqueue({ key: 'b', text: 'B' });
        expect(spoken).toEqual(['A', 'B']);
    });
});
