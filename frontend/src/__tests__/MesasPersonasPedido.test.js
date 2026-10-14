import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Salon from '@/pages/Salon';
import { api } from '@/lib/api';
import { toast } from 'sonner';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'staff-1', restaurant_id: 'restaurant-1', role: 'admin' } }) }));
jest.mock('@/contexts/NotifyContext', () => ({
    useNotify: () => ({ generation: 0 }),
    useRealtimeGeneration: () => 0,
}));
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
        if (/^(?![\s\S]*legacy_only)[\s\S]*\blistTables\b/.test(src)) return { data: mockTables, refetch: jest.fn() };
        if (src.includes('listProducts')) return { data: mockProducts, refetch: jest.fn() };
        if (src.includes('listCategories')) return { data: [], refetch: jest.fn() };
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
async function openTableWith(accounts, tableExtra = {}, { select = null, features = null } = {}) {
    mockTables.splice(0, mockTables.length, baseTable(1, { active_order: { id: accounts[0].id, status: accounts[0].status }, ...tableExtra }));
    mockOrders.splice(0, mockOrders.length, ...accounts);
    api.get.mockImplementation((url) => {
        if (url === '/restaurants/current') return Promise.resolve({ data: { features: features || {} } });
        if (url === '/branches') return Promise.resolve({ data: [] });
        const match = accounts.find((o) => url === `/orders/${o.id}`);
        if (match) return Promise.resolve({ data: match });
        return Promise.resolve({ data: accounts });
    });
    const rendered = await renderPage();
    await click(rendered.container.querySelector('[data-testid="mesa-card-1"]'));
    const sheet = document.body.querySelector('[data-testid="mesa-sheet"]');
    // S10: la franja de personas se fue; la cuenta se elige tocando su tarjeta
    // en el detalle (el parámetro `select` es el número de pedido).
    if (select) await click(sheet.querySelector(`[data-testid="mesa-sheet-pedido-${select}"]`));
    return { ...rendered, sheet };
}

/** S10b: el desglose (S/ recibo) vive en el diálogo "Resumen de mesa" de ⋯ Más. */
async function openSummary() {
    await click(document.body.querySelector('[data-testid="mesa-sheet-mas"]'));
    await click(document.body.querySelector('[data-testid="mesa-sheet-ver-resumen"]'));
    return document.body.querySelector('[data-testid="mesa-sheet-resumen"]');
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

    it('muestra una tarjeta por persona con su alias y sin la franja vieja', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Ceviche', 1, 38, 'pendiente')], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Ceviche', 1, 38, 'pendiente')], { customer_name: 'María' });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        // S10: las personas se leen y se eligen por sus tarjetas, como el mockup;
        // la fila "Personas" ya no existe.
        const cardJuan = sheet.querySelector('[data-testid="mesa-sheet-pedido-11"]');
        const cardMaria = sheet.querySelector('[data-testid="mesa-sheet-pedido-12"]');
        expect(cardJuan.textContent).toContain('Juan');
        expect(cardMaria.textContent).toContain('María');
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuentas"]')).toBeNull();
        // Cada tarjeta conserva el ✎ para renombrar.
        expect(cardJuan.querySelector('[data-testid="mesa-sheet-renombrar-11"]')).not.toBeNull();
        expect(cardMaria.querySelector('[data-testid="mesa-sheet-renombrar-12"]')).not.toBeNull();
    });

    it('ofrece "Enviar a cocina" con el monto de lo nuevo y sólo manda lo nuevo', async () => {
        const sent = item('i1', 'Ceviche', 1, 38, 'pendiente');
        const draft = item('i2', 'Ceviche', 1, 38, 'borrador');
        const account = order('order-1', 11, 'en_preparacion', [sent, draft], { customer_name: 'Juan' });
        api.post.mockResolvedValue({ data: account });
        ({ container, root, sheet } = await openTableWith([account], {}, { select: 11 }));

        const button = sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(button).not.toBeNull();
        // S9b: el mockup no usa "adicionales (N)"; muestra el monto de lo nuevo.
        expect(button.textContent).toContain('Enviar a cocina');
        expect(button.textContent).toContain('S/ 38.00');

        // The button shows only the unsent amount; review precedes submission.
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        await click(button);
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]').textContent).toContain('S/ 38.00');
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).toBeNull();
    });

    it('un pedido nuevo ofrece la comanda completa', async () => {
        const account = order('order-1', 11, 'nuevo', [item('i1', 'Ceviche', 1, 38, 'borrador')], { customer_name: 'Juan' });
        api.post.mockResolvedValue({ data: account });
        ({ container, root, sheet } = await openTableWith([account]));

        const button = sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(button.textContent).toContain('Enviar a cocina');
        expect(button.textContent).not.toContain('adicionales');
    });

    it('the mobile ticket send action supports review cancellation and sends once after confirmation', async () => {
        const previousWidth = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        const account = order('order-1', 11, 'nuevo', [item('i1', 'Ceviche', 2, 38, 'borrador')], { customer_name: 'Juan' });
        api.post.mockResolvedValue({ data: account });
        ({ container, root, sheet } = await openTableWith([account]));

        const send = sheet.querySelector('[data-testid="mesa-sheet-ticket"] [data-testid="mesa-sheet-enviar-cocina"]');
        expect(send.textContent).toContain('Enviar a cocina');
        expect(send.textContent).toContain('S/ 76.00');
        await click(send);
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).not.toBeNull();
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]').textContent).toContain('S/ 76.00');
        expect(document.body.querySelector('[data-testid="mesa-sheet-ticket-sheet"]')).toBeNull();
        await click(document.body.querySelector('[data-testid="mesa-sheet-volver-editar"]'));
        expect(document.body.querySelector('[data-testid="mesa-sheet-revision-envio"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-i1"]')).not.toBeNull();
        expect(api.post).not.toHaveBeenCalled();
        await click(sheet.querySelector('[data-testid="mesa-sheet-ticket"] [data-testid="mesa-sheet-enviar-cocina"]'));
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-1/send-to-kitchen');
        expect(api.post).toHaveBeenCalledTimes(1);
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
    });

    it('guarda la observación de un producto concreto', async () => {
        const account = order('order-1', 11, 'nuevo', [
            item('i1', 'Pollo', 1, 20, 'borrador'),
            item('i2', 'Gaseosa', 1, 10, 'borrador'),
        ], { customer_name: 'María' });
        api.patch.mockResolvedValue({ data: account });
        ({ container, root, sheet } = await openTableWith([account]));

        // S10: la nota se edita con el botón 📝 de la línea (el input fijo y los
        // chips rápidos del mockup viejo ya no están).
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-nota-rapida-i1-Sin cebolla"]')).toBeNull();
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-notas-i1"]')).toBeNull();
        await click(sheet.querySelector('[data-testid="mesa-sheet-item-nota-i1"]'));
        const notes = sheet.querySelector('[data-testid="mesa-sheet-item-notas-i1"]');
        expect(notes).not.toBeNull();
        await type(notes, 'Sin ensalada');
        await act(async () => {
            notes.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });

        expect(api.patch).toHaveBeenCalledWith('/orders/order-1/items/i1', { notes: 'Sin ensalada' });
    });

    it('sin la flag `item_void` no muestra el ✕ de anular en lo enviado', async () => {
        const account = order('order-1', 11, 'enviado_cocina', [item('i1', 'Pollo', 1, 20, 'pendiente')], { customer_name: 'María' });
        ({ container, root, sheet } = await openTableWith([account], {}, { select: 11 }));

        // S11: anular productos individualmente es una flag apagada por defecto.
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-anular-i1"]')).toBeNull();
    });

    it('S12: el estado va en el tag del pedido y las líneas de la tarjeta van peladas', async () => {
        const account = order('order-1', 11, 'en_preparacion', [item('i1', 'Pollo', 1, 20, 'pendiente')], { customer_name: 'María' });
        ({ container, root, sheet } = await openTableWith([account], {}, { select: 11 }));

        // El tag del pedido vive en la cabecera de la tarjeta…
        const card = sheet.querySelector('[data-testid="mesa-sheet-pedido-11"]');
        expect(card.textContent).toContain('En cocina');
        // …y ninguna línea lleva chip de estado por ítem (cambio pedido: es por pedido).
        expect(card.querySelector('[data-testid="mesa-sheet-item-estado-i1"]')).toBeNull();
    });

    it('anula un producto ya enviado pidiendo el motivo', async () => {
        const account = order('order-1', 11, 'enviado_cocina', [item('i1', 'Pollo', 1, 20, 'pendiente')], { customer_name: 'María' });
        api.post.mockResolvedValue({ data: account });
        ({ container, root, sheet } = await openTableWith([account], {}, { select: 11, features: { item_void: true } }));

        // Lo enviado no se borra: se anula.
        await click(sheet.querySelector('[data-testid="mesa-sheet-item-anular-i1"]'));
        const reason = sheet.querySelector('[data-testid="mesa-sheet-item-anular-motivo-i1"]');
        expect(reason).not.toBeNull();
        await type(reason, 'El cliente canceló');
        await click(sheet.querySelector('[data-testid="mesa-sheet-item-anular-confirmar-i1"]'));

        expect(api.post).toHaveBeenCalledWith('/orders/order-1/items/i1/void', { reason: 'El cliente canceló' });
        expect(api.delete).not.toHaveBeenCalled();
    });

    it('el resumen de mesa vive en ⋯ Más, trae el total a la vista y agrupa a todas las personas', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente', { product_id: 'prod-sopa' })], { customer_name: 'Juan' });
        const maria = order('order-2', 12, 'en_preparacion', [item('i2', 'Sopa', 1, 12, 'pendiente', { product_id: 'prod-sopa' })], { customer_name: 'María' });
        ({ container, root, sheet } = await openTableWith([juan, maria]));

        // S10b: el bloque plegable ya no está en el cuerpo del detalle (no está
        // en el mockup); se abre como "Resumen de mesa / Recibo" desde ⋯ Más.
        expect(sheet.querySelector('[data-testid="mesa-sheet-resumen"]')).toBeNull();
        const summary = await openSummary();
        expect(summary).not.toBeNull();
        // Sin desplegar nada ya se lee el total y cuántos platos hay.
        expect(summary.textContent).toContain('Resumen de mesa');
        expect(summary.textContent).toContain('24.00');
        expect(summary.textContent).toContain('2 platos');

        await click(document.body.querySelector('[data-testid="mesa-sheet-resumen-toggle"]'));
        expect(summary.textContent).toContain('2× Sopa');
        expect(summary.textContent).toContain('Juan');
        expect(summary.textContent).toContain('María');
    });

    it('ordena el compositor como trabaja el mozo: persona y recién la carta', async () => {
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        ({ container, root, sheet } = await openTableWith([juan]));

        // Con una sola cuenta el cuerpo del detalle no muestra el bloque de
        // resumen: repetiría lo que ya dicen la lista de platos y el pie (S10b:
        // el desglose agrupado sólo existe como diálogo de ⋯ Más).
        expect(sheet.querySelector('[data-testid="mesa-sheet-resumen"]')).toBeNull();
        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        // S10: la identidad vive en la franja "Para {persona}" (ya no hay fila
        // "Personas" ni bloque "Organizar pedido"), y va antes de la carta.
        const persona = sheet.querySelector('[data-testid="mesa-sheet-persona"]');
        const carta = sheet.querySelector('[data-testid="mesa-sheet-pedido"]');
        expect(persona).not.toBeNull();
        expect(carta).not.toBeNull();
        expect(persona.compareDocumentPosition(carta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

        // New order prepares an independent account within the existing attention.
        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        const product = sheet.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]');
        expect(product.closest('[hidden]')).toBeNull();
        await click(product);

        expect(api.post).toHaveBeenCalledWith('/orders', {
            table_id: 'table-1', order_type: 'mesa', new_account: true, request_id: expect.any(String),
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

        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-producto-nombre-prod-n1"]'));
        expect(api.post).toHaveBeenCalledWith('/orders', { table_id: 'table-1', order_type: 'mesa', request_id: expect.any(String) });
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
        // S10: la franja de personas ya no existe; el borrador se lee en el ticket.
        expect(sheet.querySelector('[data-testid="mesa-sheet-cuentas"]')).toBeNull();

        const enviar = sheet.querySelector('[data-testid="mesa-sheet-enviar-cocina"]');
        expect(enviar).not.toBeNull();
        // Confirma el envío con el aviso del mockup (S11: "Enviado a cocina · Mesa
        // N"), ahora DENTRO de la hoja: como cartel flotante caía encima del "←",
        // que es el botón con el que el mozo vuelve para elegir otra mesa.
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-9/send-to-kitchen');
        await click(enviar);
        expect(api.post).not.toHaveBeenCalledWith('/orders/order-9/send-to-kitchen');
        await click(document.body.querySelector('[data-testid="mesa-sheet-confirmar-envio"]'));
        expect(api.post).toHaveBeenCalledWith('/orders/order-9/send-to-kitchen');
        const aviso = document.body.querySelector('[data-testid="mesa-sheet-enviado"]');
        expect(aviso).not.toBeNull();
        expect(aviso.textContent).toContain('Enviado a cocina · Mesa 1');
        expect(toast.success).not.toHaveBeenCalled();
        expect(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]').getAttribute('aria-expanded')).toBe('false');
    });

    it('Compartido es un interruptor dentro del editor del nombre', async () => {
        const borrador = {
            ...order('order-9', 13, 'nuevo', [item('i9', 'Fuente', 1, 45, 'borrador', { product_id: 'prod-n1' })]),
            customer_name: null,
        };
        const juan = order('order-1', 11, 'en_preparacion', [item('i1', 'Sopa', 1, 12, 'pendiente')], { customer_name: 'Juan' });
        api.patch.mockResolvedValue({ data: { ...borrador, shared: true } });
        api.post.mockResolvedValue({ data: { ...borrador, shared: true, status: 'enviado_cocina' } });
        ({ container, root, sheet } = await openTableWith([juan]));

        // La identidad se edita desde el ✎ de la franja "Para {persona}".
        await click(sheet.querySelector('[data-testid="mesa-sheet-nuevo-pedido"]'));
        await click(sheet.querySelector('[data-testid="mesa-sheet-persona-renombrar"]'));
        const toggle = sheet.querySelector('[data-testid="mesa-sheet-compartido"]');
        expect(toggle).not.toBeNull();
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        await click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });

    it('la nota por producto se edita con 📝 y se guarda como la de siempre', async () => {
        const borrador = {
            ...order('order-9', 13, 'nuevo', [item('i9', 'Sopa', 2, 12, 'borrador', { product_id: 'prod-n1' })]),
            customer_name: null,
        };
        api.post.mockResolvedValue({ data: borrador });
        api.patch.mockResolvedValue({ data: borrador });
        ({ container, root, sheet } = await openTableWith([borrador]));

        // S10: sin chips rápidos ni input fijo; el botón 📝 abre el editor.
        expect(sheet.querySelector('[data-testid="mesa-sheet-item-nota-rapida-i9-Sin cebolla"]')).toBeNull();
        await click(sheet.querySelector('[data-testid="mesa-sheet-item-nota-i9"]'));
        const input = sheet.querySelector('[data-testid="mesa-sheet-item-notas-i9"]');
        expect(input).not.toBeNull();
        await type(input, 'Sin cebolla');
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });

        expect(api.patch).toHaveBeenCalledWith('/orders/order-9/items/i9', { notes: 'Sin cebolla' });
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

        await openSummary();
        await click(document.body.querySelector('[data-testid="mesa-sheet-resumen-toggle"]'));
        await click(document.body.querySelector('[data-testid^="mesa-sheet-resumen-abrir-"]'));
        const selector = document.body.querySelector('[data-testid="mesa-sheet-mover-item-i1"]');
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

        await openSummary();
        await click(document.body.querySelector('[data-testid="mesa-sheet-ver-recibo"]'));
        const recibo = document.body.querySelector('[data-testid="mesa-sheet-recibo"]');
        expect(recibo).not.toBeNull();
        expect(recibo.textContent).toContain('2× Sopa');
        expect(recibo.textContent).toContain('Por persona');
        expect(recibo.textContent).toContain('Juan');
        expect(recibo.querySelector('[data-testid="mesa-sheet-recibo-imprimir"]')).not.toBeNull();
    });
});
