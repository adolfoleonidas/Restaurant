import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({ useNotify: () => ({ generation: 0 }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const mockTables = [];
const mockOrders = [];
const mockProducts = [];
jest.mock('@/hooks/usePolling', () => ({
    __esModule: true,
    default: (fetcher) => {
        const src = fetcher.toString();
        if (src.includes("api.get('/tables')")) return { data: mockTables, refetch: jest.fn() };
        if (src.includes("api.get('/products')")) return { data: mockProducts, refetch: jest.fn() };
        if (src.includes("api.get('/categories')")) return { data: [], refetch: jest.fn() };
        return { data: mockOrders, refetch: jest.fn() };
    },
}));

const baseTable = (number, extra = {}) => ({
    id: `table-${number}`, number, name: `Mesa ${number}`, area: 'Salón', capacity: 4,
    status: 'ocupada', active_attention_id: 'att-1', branch_id: 'branch-1', active_order: null, group: null, ...extra,
});

const item = (id, name, qty, price, status, extra = {}) => ({
    id, product_id: extra.product_id || `prod-${id}`, product_name: name, quantity: qty, unit_price: price,
    subtotal: qty * price, status, notes: null, ...extra,
});

const order = (id, number, status, items, extra = {}) => ({
    id, order_number: number, table_id: 'table-1', status, order_type: 'mesa',
    total: items.reduce((s, i) => s + i.subtotal, 0), amount_paid: 0, source: 'staff',
    created_at: new Date().toISOString(), attention_id: 'att-1', attention_state: 'open',
    items, ...extra,
});

async function renderPage() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Salon />));
    return { container, root };
}

async function click(el) {
    await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function type(input, value) {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

/** Abre la mesa 1 con las cuentas indicadas ya cargadas en la API. */
async function openTableWith(accounts, tableExtra = {}, { select = null } = {}) {
    mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: accounts[0].id, status: accounts[0].status }, ...tableExtra }));
    mockOrders.splice(0, mockOrders.length, ...accounts);
    api.get.mockImplementation((url) => {
        if (url === '/branches') return Promise.resolve({ data: [] });
        const match = accounts.find((o) => url === `/orders/${o.id}`);
        if (match) return Promise.resolve({ data: match });
        return Promise.resolve({ data: accounts });
    });
    const rendered = await renderPage();
    await click(rendered.container.querySelector('[data-testid="mesa-card-1"]'));
    const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
    // Abrir la mesa deja la pantalla lista para la siguiente persona: para entrar
    // a una cuenta hay que tocar su píldora, como haría el mozo.
    if (select) await click(sheet.querySelector(`[data-testid="mesa-sheet-cuenta-${select}"]`));
    return { ...rendered, sheet };
}

describe('pedido por personas en el salón', () => {
    let container;
    let root;
    let sheet;

    beforeEach(() => {
        api.get.mockReset();
        api.post.mockReset();
        api.patch.mockReset();
        api.delete.mockReset();
        mockProducts.splice(0, mockProducts.length,
            { id: 'prod-n1', name: 'Ceviche', price: 38, is_available: true, category_id: 'c1' });
        mockOrders.splice(0, mockOrders.length);
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        root = null;
        container = null;
        document.body.innerHTML = '';
    });

    it('muestra las personas con su alias y la franja compacta', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Ceviche', 1, 38, 'pendiente')], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Ceviche', 1, 38, 'pendiente')], { customer_name: 'María' });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        const personas = sheet.querySelector('[data-testid="mesa-sheet-cuentas"]');
        expect(personas).not.toBeNull();
        expect(personas.textContent).toContain('Juan');
        expect(personas.textContent).toContain('María');
        // Cada persona tiene su propia cuenta, con su número para ubicarla.
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuenta-11"]')).not.toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuenta-12"]')).not.toBeNull();
    });

    it('ofrece "Enviar adicionales" con la cuenta ya enviada y sólo manda lo nuevo', async () => {
        const sent = item('i1', 'Ceviche', 1, 38, 'pendiente');
        const draft = item('i2', 'Ceviche', 1, 38, 'borrador');
        const account = order('order-1', 11, 'en_preparacion', [sent, draft], { customer_name: 'Juan' });
        api.post.mockResolvedValue({ data: account });
        ({ container, root, sheet } = await openTableWith([account], {}, { select: 11 }));

        const button = sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(button).not.toBeNull();
        expect(button.textContent).toContain('Enviar adicionales (1)');

        await click(button);
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
    });

    it('un pedido nuevo ofrece la comanda completa', async () => {
        const account = order('order-1', 11, 'nuevo', [item('i1', 'Ceviche', 1, 38, 'borrador')], { customer_name: 'Juan' });
        api.post.mockResolvedValue({ data: account });
        ({ container, root, sheet } = await openTableWith([account]));

        const button = sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(button.textContent).toContain('Enviar a cocina');
        expect(button.textContent).not.toContain('adicionales');
    });

    it('guarda la observación de un producto concreto', async () => {
        const account = order('order-1', 11, 'nuevo', [
            item('i1', 'Pollo', 1, 20, 'borrador'),
            item('i2', 'Gaseosa', 1, 10, 'borrador'),
        ], { customer_name: 'María' });
        api.patch.mockResolvedValue({ data: account });
        ({ container, root, sheet } = await openTableWith([account]));

        const notes = sheet.querySelector('[data-testid="mesa-sheet-item-notas-i1"]');
        expect(notes).not.toBeNull();
        await type(notes, 'Sin ensalada');
        await act(async () => {
            notes.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });

        expect(api.patch).toHaveBeenCalledWith('/orders/order-1/items/i1', { notes: 'Sin ensalada' });
    });

    it('anula un producto ya enviado pidiendo el motivo', async () => {
        const account = order('order-1', 11, 'enviado_cocina', [item('i1', 'Pollo', 1, 20, 'pendiente')], { customer_name: 'María' });
        api.post.mockResolvedValue({ data: account });
        ({ container, root, sheet } = await openTableWith([account], {}, { select: 11 }));

        // Lo enviado no se borra: se anula.
        await click(sheet.querySelector('[data-testid="mesa-sheet-item-anular-i1"]'));
        const reason = sheet.querySelector('[data-testid="mesa-sheet-item-anular-motivo-i1"]');
        expect(reason).not.toBeNull();
        await type(reason, 'El cliente canceló');
        await click(sheet.querySelector('[data-testid="mesa-sheet-item-anular-confirmar-i1"]'));

        expect(api.post).toHaveBeenCalledWith('/orders/order-1/items/i1/void', { reason: 'El cliente canceló' });
        expect(api.delete).not.toHaveBeenCalled();
    });

    it('el resumen de mesa vive arriba, trae el total a la vista y agrupa a todas las personas', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente', { product_id: 'prod-sopa' })], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Sopa', 1, 12, 'pendiente', { product_id: 'prod-sopa' })], { customer_name: 'María' });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        const summary = sheet.querySelector('[data-testid="mesa-sheet-resumen"]');
        expect(summary).not.toBeNull();
        // Sin desplegar nada ya se lee el total y cuántos platos hay.
        expect(summary.textContent).toContain('Resumen de mesa');
        expect(summary.textContent).toContain('24.00');
        expect(summary.textContent).toContain('2 platos');

        await click(sheet.querySelector('[data-testid="mesa-sheet-resumen-toggle"]'));
        expect(summary.textContent).toContain('2× Sopa');
        expect(summary.textContent).toContain('Juan');
        expect(summary.textContent).toContain('María');
    });

    it('ordena el modal como trabaja el mozo: personas, alias y recién la carta', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([juan]));

        // Con una sola cuenta no hay resumen de mesa: repetiría lo que ya dicen la
        // lista de platos y el pie, y el modal tiene que ser simple.
        expect(sheet.querySelector('[data-testid="mesa-sheet-resumen"]')).toBeNull();
        const sequence = ['mesa-sheet-cuentas', 'mesa-sheet-alias', 'mesa-sheet-pedido'];
        const nodes = sequence.map((id) => sheet.querySelector(`[data-testid="${id}"]`));
        nodes.forEach((node, index) => expect(node).not.toBeNull());
        for (let i = 1; i < nodes.length; i += 1) {
            // compareDocumentPosition: 4 = el segundo nodo va después del primero.
            expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
    });

    it('la segunda persona se pide como cuenta de la misma visita, no como mesa libre', async () => {
        // Juan ya envió su pedido: la mesa tiene su visita abierta. Cuando el mozo
        // carga el primer plato de la siguiente persona, esa cuenta tiene que
        // nacer DENTRO de esa visita o el backend la rechaza.
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        const nueva = { ...order('order-9', 13, 'nuevo', []), customer_name: null };
        api.post.mockImplementation((url) => {
            if (url === '/orders') return Promise.resolve({ data: nueva });
            return Promise.resolve({ data: { ...nueva, items: [] } });
        });
        ({ container, root, sheet } = await openTableWith([juan], { active_attention_id: 'att-1' }));

        // Se pasa a la siguiente persona desde la cuenta que se está viendo.
        await click(sheet.querySelector('[data-testid="mesa-sheet-otra-persona"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-producto-prod-n1"]'));

        expect(api.post).toHaveBeenCalledWith('/orders', {
            table_id: 'table-1', order_type: 'mesa', new_account: true,
        });
    });

    it('en una mesa libre la primera cuenta no se pide como adicional', async () => {
        const libre = baseTable(1, { status: 'disponible', active_attention_id: null, active_order: null });
        mockTables.splice(0, mockTables.length, libre);
        mockOrders.splice(0, mockOrders.length);
        api.get.mockImplementation((url) => {
            if (url === '/branches') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: [] });
        });
        const nueva = { ...order('order-9', 13, 'nuevo', []), customer_name: null };
        api.post.mockImplementation((url) => {
            if (url === '/orders') return Promise.resolve({ data: nueva });
            return Promise.resolve({ data: nueva });
        });
        const rendered = await renderPage();
        container = rendered.container;
        root = rendered.root;
        await click(container.querySelector('[data-testid="mesa-card-1"]'));
        sheet = document.body.querySelector('[data-testid="mesa-sheet"]');

        await click(sheet.querySelector('[data-testid="mesa-sheet-producto-prod-n1"]'));
        expect(api.post).toHaveBeenCalledWith('/orders', { table_id: 'table-1', order_type: 'mesa' });
    });

    it('deja fusionar al final, fuera del camino de carga', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'María' });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        // Fusionar es ocasional: no aparece en la barra ni compite con la carta.
        // Vive en ⋯ Más, junto al resto de las excepciones.
        expect(sheet.querySelector('[data-testid="mesa-sheet-fusionar-cuentas"]')).toBeNull();
        await click(sheet.querySelector('[data-testid="mesa-sheet-mas"]'));
        expect(sheet.querySelector('[data-testid="mesa-sheet-fusionar-cuentas"]')).not.toBeNull();
    });

    it('no hay botón de crear cuenta: la persona nace al enviar y la pantalla queda lista', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        const borrador = {
            ...order('order-9', 13, 'nuevo', [item('i9', 'Ceviche', 1, 38, 'borrador', { product_id: 'prod-n1' })]),
            customer_name: null,
        };
        api.patch.mockResolvedValue({ data: borrador });
        api.post.mockResolvedValue({ data: { ...borrador, customer_name: 'Pedro', status: 'enviado_cocina' } });
        // El pedido a medio armar es el que la mesa retoma al abrirse.
        ({ container, root, sheet } = await openTableWith([borrador, juan]));

        // No hay "+" que abra cuentas: eso lo decide el sistema por dentro.
        expect(sheet.querySelector('[data-testid="mesa-sheet-nueva-cuenta"]')).toBeNull();
        // Mientras todo es borrador, la cuenta todavía no figura como persona.
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuentas"]').textContent).not.toContain('Persona 1');

        const enviar = sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(enviar).not.toBeNull();
        await click(enviar);

        // Confirma el envío y deja la pantalla limpia para la siguiente persona.
        expect(api.post).toHaveBeenCalledWith('/orders/order-9/send-to-kitchen');
        const flash = sheet.querySelector('[data-testid="mesa-sheet-flash"]');
        expect(flash.textContent).toContain('¿Siguiente persona?');
        expect(flash.textContent).toContain('Pedro');
    });

    it('Compartido es un interruptor junto al alias, no una cuenta aparte', async () => {
        const borrador = {
            ...order('order-9', 13, 'nuevo', [item('i9', 'Fuente', 1, 45, 'borrador', { product_id: 'prod-n1' })]),
            customer_name: null,
        };
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        api.patch.mockResolvedValue({ data: { ...borrador, shared: true } });
        api.post.mockResolvedValue({ data: { ...borrador, shared: true, status: 'enviado_cocina' } });
        ({ container, root, sheet } = await openTableWith([juan]));

        const toggle = sheet.querySelector('[data-testid="mesa-sheet-compartido"]');
        expect(toggle).not.toBeNull();
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        await click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });

    it('las observaciones rápidas se aplican a una sola unidad', async () => {
        const borrador = {
            ...order('order-9', 13, 'nuevo', [item('i9', 'Sopa', 2, 12, 'borrador', { product_id: 'prod-n1' })]),
            customer_name: null,
        };
        api.post.mockResolvedValue({ data: borrador });
        api.patch.mockResolvedValue({ data: borrador });
        ({ container, root, sheet } = await openTableWith([borrador]));

        // Los chips están a la vista sin tener que abrir nada.
        const chip = sheet.querySelector('[data-testid="mesa-sheet-item-nota-rapida-i9-Sin cebolla"]');
        expect(chip).not.toBeNull();
        await click(chip);

        // Primero agrega la unidad anotada y recién después descuenta del grupo:
        // si algo falla, nunca se pierde comida.
        expect(api.post).toHaveBeenCalledWith('/orders/order-9/items', [
            { product_id: 'prod-n1', quantity: 1, notes: 'Sin cebolla' },
        ]);
        expect(api.patch).toHaveBeenCalledWith('/orders/order-9/items/i9', { quantity: 1 });
    });

    it('mueve un producto de una persona a otra', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [
            item('i1', 'Pollo', 1, 20, 'pendiente', { product_id: 'prod-p' }),
        ], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [
            item('i2', 'Sopa', 1, 12, 'pendiente', { product_id: 'prod-s' }),
        ], { customer_name: 'María' });
        api.post.mockResolvedValue({ data: maria });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-resumen-toggle"]'));
        await click(sheet.querySelector('[data-testid^="mesa-sheet-resumen-abrir-"]'));
        const selector = sheet.querySelector('[data-testid="mesa-sheet-mover-item-i1"]');
        expect(selector).not.toBeNull();
        await act(async () => {
            selector.value = 'order-2';
            selector.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(api.post).toHaveBeenCalledWith('/orders/order-1/items/i1/move', { target_order_id: 'order-2' });
    });

    it('el recibo de la mesa se abre desde el resumen cuando hay varias cuentas', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 2, 12, 'pendiente')], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Chicha', 1, 10, 'pendiente')], { customer_name: 'María' });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        await click(sheet.querySelector('[data-testid="mesa-sheet-ver-recibo"]'));
        const recibo = sheet.querySelector('[data-testid="mesa-sheet-recibo"]');
        expect(recibo).not.toBeNull();
        expect(recibo.textContent).toContain('2× Sopa');
        expect(recibo.textContent).toContain('Por persona');
        expect(recibo.textContent).toContain('Juan');
        expect(recibo.querySelector('[data-testid="mesa-sheet-recibo-imprimir"]')).not.toBeNull();
    });
});
