/**
 * Un fallo de red no puede parecer «no hay nada».
 *
 * Tres pantallas de trabajo convertían el error en una lista vacía, así que la
 * pantalla afirmaba algo falso: la cola de prepagos por verificar desaparecía
 * entera (dinero esperando), el arqueo de caja mostraba KPI en cero, y el menú
 * decía «Todavía no hay plantillas». En las tres, un error visible es más seguro
 * que una lista vacía creíble.
 *
 * Fase 1 (T11) extiende lo mismo al resto de pantallas de administración y de
 * mozo: Productos, Categorías, Equipo, Pagos, Local (zonas, mesas, sucursales),
 * Pedidos, Disponibilidad, Comprobantes, detalle y alta de pedido, y el
 * seguimiento público. Un cajero con mala señal no puede concluir «no hay datos»
 * y volver a crear lo que ya existe.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import PrepayQueue from '@/pages/caja/PrepayQueue';
import CashHistory from '@/pages/caja/CashHistory';
import GestionarMenu from '@/pages/menu/GestionarMenu';
import Productos from '@/pages/Productos';
import Categorias from '@/pages/Categorias';
import Usuarios from '@/pages/Usuarios';
import Pagos from '@/pages/Pagos';
import { SucursalesPanel, ZonasPanel, TablesManager } from '@/pages/Local';
import Pedidos from '@/pages/Pedidos';
import Disponibilidad from '@/pages/Disponibilidad';
import Comprobantes from '@/pages/Comprobantes';
import PedidoDetalle from '@/pages/PedidoDetalle';
import PedidoNuevo from '@/pages/PedidoNuevo';
import PedidoTracking from '@/pages/PedidoTracking';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/lib/api/payments', () => ({
    listPendingPrepay: jest.fn(),
    runPrepayAction: jest.fn(),
    getPaymentConfig: jest.fn(),
    updatePaymentConfig: jest.fn(),
    listPaymentProofs: jest.fn(),
}));
jest.mock('@/lib/api/cash', () => ({ listCashHistory: jest.fn(), getCurrentCash: jest.fn() }));
jest.mock('@/lib/api/menu', () => ({
    getMenuDay: jest.fn(),
    saveMenuDay: jest.fn(),
    setMenuSoldOut: jest.fn(),
    copyMenuFrom: jest.fn(),
    listMenuTemplates: jest.fn(),
    saveMenuTemplate: jest.fn(),
    deleteMenuTemplate: jest.fn(),
    applyMenuTemplate: jest.fn(),
    repeatMenuTemplate: jest.fn(),
}));
jest.mock('@/lib/api/products', () => ({
    listProducts: jest.fn(),
    createProduct: jest.fn(),
    updateProduct: jest.fn(),
    deleteProduct: jest.fn(),
    importProducts: jest.fn(),
    setProductAvailability: jest.fn(),
}));
jest.mock('@/lib/api/categories', () => ({
    listCategories: jest.fn(),
    createCategory: jest.fn(),
    updateCategory: jest.fn(),
    deleteCategory: jest.fn(),
}));
jest.mock('@/lib/api/users', () => ({
    listUsers: jest.fn(),
    createUser: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
}));
jest.mock('@/lib/api/branches', () => ({ listBranches: jest.fn(), createBranch: jest.fn(), updateBranch: jest.fn() }));
jest.mock('@/lib/api/zones', () => ({ listZones: jest.fn(), createZone: jest.fn(), updateZone: jest.fn(), deleteZone: jest.fn() }));
jest.mock('@/lib/api/tables', () => ({
    listTables: jest.fn(),
    createTable: jest.fn(),
    updateTable: jest.fn(),
    deleteTable: jest.fn(),
    releaseTable: jest.fn(),
}));
jest.mock('@/lib/api/orders', () => ({
    listOrders: jest.fn(),
    getOrder: jest.fn(),
    createOrder: jest.fn(),
    sendOrderToKitchen: jest.fn(),
    addOrderItems: jest.fn(),
    reassignOrder: jest.fn(),
    removeOrderItem: jest.fn(),
    serveOrder: jest.fn(),
    setOrderStatus: jest.fn(),
    voidOrderItem: jest.fn(),
}));
jest.mock('@/lib/api/public', () => ({
    getPublicOrder: jest.fn(),
    getPublicOrderTable: jest.fn(),
    getPublicRestaurant: jest.fn(),
    uploadPublicOrderProof: jest.fn(),
}));
jest.mock('react-router-dom', () => ({
    Link: ({ children, to }) => <a href={to}>{children}</a>,
    useNavigate: () => jest.fn(),
    useParams: () => ({ id: 'order-1', code: 'TRACK-1' }),
    useSearchParams: () => [new URLSearchParams('tipo=llevar')],
}));
jest.mock('@/contexts/NotifyContext', () => ({ useRealtimeGeneration: () => 0 }));
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'admin-1', restaurant_id: 'r1', role: 'admin', functions: ['administracion', 'atencion', 'cobro'] } }),
}));
jest.mock('@/contexts/TableContext', () => ({
    useTableContext: () => ({ table: null, session: null, hasTable: false, refresh: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('@/contexts/LiveOrderContext', () => ({ useLiveOrder: () => ({ clearMeta: jest.fn(), meta: null, isActive: false }) }));
jest.mock('@/hooks/usePublicStream', () => ({ __esModule: true, default: () => ({ generation: 0 }) }));
jest.mock('@/hooks/useBranchNames', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('@/hooks/useRestaurantFeatures', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('@/components/CobrarDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/useOrderProof', () => ({
    __esModule: true,
    default: () => ({ proof: null, openProof: jest.fn(), closeProof: jest.fn() }),
}));
jest.mock('@/components/ProofPreview', () => ({ __esModule: true, default: () => null }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { listPendingPrepay, getPaymentConfig, listPaymentProofs } = require('@/lib/api/payments');
const { listCashHistory } = require('@/lib/api/cash');
const { getMenuDay, listMenuTemplates } = require('@/lib/api/menu');
const { listProducts } = require('@/lib/api/products');
const { listCategories, deleteCategory } = require('@/lib/api/categories');
const { listUsers, deleteUser } = require('@/lib/api/users');
const { listBranches } = require('@/lib/api/branches');
const { listZones, deleteZone } = require('@/lib/api/zones');
const { listTables, deleteTable } = require('@/lib/api/tables');
const { listOrders, getOrder } = require('@/lib/api/orders');
const { getPublicOrder, getPublicOrderTable, getPublicRestaurant } = require('@/lib/api/public');
const { toast } = require('sonner');

const flush = async () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
});

const mounted = [];
async function mount(element) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push(root);
    await act(async () => { root.render(element); });
    await flush();
    return { host, root };
}

const NETWORK_ERROR = { response: { status: 500, data: {} } };
// Estable entre renders: un objeto literal nuevo haría que el efecto se vuelva a
// disparar en cada render y la prueba se quedaría en bucle.
const NO_SCOPE = {};

afterEach(async () => {
    // Las pantallas con sondeo dejan un intervalo vivo si no se desmontan.
    while (mounted.length) {
        const root = mounted.pop();
        await act(async () => root.unmount());
    }
    document.body.innerHTML = '';
    jest.resetAllMocks();
});

describe('fallos de carga que antes se disfrazaban de lista vacía', () => {
    it('la cola de prepagos avisa en vez de desaparecer', async () => {
        listPendingPrepay.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<PrepayQueue runMutation={(fn) => fn()} />);

        expect(host.querySelector('[data-testid="caja-prepagos-error"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="caja-prepagos-reintentar"]')).not.toBeNull();

        const callsBefore = listPendingPrepay.mock.calls.length;
        await act(async () => host.querySelector('[data-testid="caja-prepagos-reintentar"]').click());
        await flush();
        expect(listPendingPrepay.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('una cola de prepagos realmente vacía sigue sin mostrar nada', async () => {
        listPendingPrepay.mockResolvedValue({ data: [] });
        const { host } = await mount(<PrepayQueue runMutation={(fn) => fn()} />);

        expect(host.querySelector('[data-testid="caja-prepagos-error"]')).toBeNull();
        expect(host.querySelector('[data-testid="caja-prepagos"]')).toBeNull();
    });

    it('el arqueo de caja avisa en vez de mostrar KPI en cero', async () => {
        listCashHistory.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<CashHistory refreshKey={0} scopeParams={NO_SCOPE} />);

        expect(host.querySelector('[data-testid="caja-historial-error"]')).not.toBeNull();
        // Los KPI no pueden salir en cero: no hay datos, no es que sean cero.
        expect(host.textContent).not.toContain('No hay turnos en este período');
    });

    it('un arqueo realmente vacío sí dice que no hay turnos', async () => {
        listCashHistory.mockResolvedValue({ data: { registers: [], sessions: 0, total_sales: 0, difference: 0 } });
        const { host } = await mount(<CashHistory refreshKey={0} scopeParams={NO_SCOPE} />);

        expect(host.querySelector('[data-testid="caja-historial-error"]')).toBeNull();
        expect(host.textContent).toContain('No hay turnos en este período');
    });

    it('el menú avisa en vez de decir que no hay plantillas', async () => {
        getMenuDay.mockResolvedValue({ data: { date: '2026-03-10', status: 'draft', published: false, has_menu: true, selection: [], catalog: [] } });
        listMenuTemplates.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<GestionarMenu />);

        await act(async () => host.querySelector('[data-testid="menu-tab-week"]').click());
        await flush();

        expect(host.querySelector('[data-testid="menu-plantillas-error"]')).not.toBeNull();
        expect(host.querySelector('[data-testid="menu-plantillas-vacio"]')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Fase 1 · T11 — el resto de pantallas
// ---------------------------------------------------------------------------

const $ = (host, id) => host.querySelector(`[data-testid="${id}"]`);
const click = async (node) => { await act(async () => node.click()); await flush(); };

/** El error se ve, ofrece reintentar y reintentar vuelve a pedir los datos. */
async function expectErrorThenRetry(host, prefix, fetcher, recover) {
    expect($(host, `${prefix}-error`)).not.toBeNull();
    expect($(host, `${prefix}-reintentar`)).not.toBeNull();

    const before = fetcher.mock.calls.length;
    recover();
    await click($(host, `${prefix}-reintentar`));
    expect(fetcher.mock.calls.length).toBeGreaterThan(before);
    expect($(host, `${prefix}-error`)).toBeNull();
}

describe('T11 · pantallas de administración que fingían estar vacías o cargando', () => {
    it('Productos avisa en vez de decir «No hay platos en la carta»', async () => {
        listProducts.mockRejectedValue(NETWORK_ERROR);
        listCategories.mockResolvedValue({ data: [] });
        const { host } = await mount(<Productos />);

        expect(host.textContent).not.toContain('No hay platos en la carta');
        await expectErrorThenRetry(host, 'productos', listProducts, () => {
            listProducts.mockResolvedValue({ data: [{ id: 'p1', name: 'Ceviche', price: 20, category_id: 'c1', preparation_time: 15, is_available: true, is_combo: false }] });
        });
        expect(host.textContent).toContain('Ceviche');
    });

    it('Productos con la carta realmente vacía sí lo dice', async () => {
        listProducts.mockResolvedValue({ data: [] });
        listCategories.mockResolvedValue({ data: [] });
        const { host } = await mount(<Productos />);

        expect($(host, 'productos-error')).toBeNull();
        expect(host.textContent).toContain('No hay platos en la carta');
    });

    it('Categorías avisa en vez de mostrar una lista vacía', async () => {
        listCategories.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<Categorias />);

        await expectErrorThenRetry(host, 'categorias', listCategories, () => {
            listCategories.mockResolvedValue({ data: [{ id: 'c1', name: 'Postres', description: '', sort_order: 1 }] });
        });
        expect(host.textContent).toContain('Postres');
    });

    it('Equipo avisa en vez de mostrar una lista vacía', async () => {
        listUsers.mockRejectedValue(NETWORK_ERROR);
        listBranches.mockResolvedValue({ data: [] });
        const { host } = await mount(<Usuarios />);

        await expectErrorThenRetry(host, 'usuarios', listUsers, () => {
            listUsers.mockResolvedValue({ data: [{ id: 'u2', full_name: 'Rosa Mozo', email: 'rosa@x.pe', role: 'mozo', status: 'active', functions: ['atencion'] }] });
        });
        expect(host.textContent).toContain('Rosa Mozo');
    });

    it('Métodos de pago avisa en vez de quedarse en «Cargando…» para siempre', async () => {
        getPaymentConfig.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<Pagos />);

        expect(host.textContent).not.toContain('Cargando métodos de pago');
        await expectErrorThenRetry(host, 'pagos', getPaymentConfig, () => {
            getPaymentConfig.mockResolvedValue({ data: { enable_efectivo: true } });
        });
        expect($(host, 'pagos-save')).not.toBeNull();
    });

    it('Zonas avisa en vez de decir «Sin zonas»', async () => {
        listZones.mockRejectedValue(NETWORK_ERROR);
        listBranches.mockResolvedValue({ data: [] });
        listTables.mockResolvedValue({ data: [] });
        const { host } = await mount(<ZonasPanel />);

        expect(host.textContent).not.toContain('Sin zonas');
        await expectErrorThenRetry(host, 'zonas', listZones, () => {
            listZones.mockResolvedValue({ data: [{ id: 'z1', name: 'Terraza', branch_id: null }] });
        });
        expect(host.textContent).toContain('Terraza');
    });

    it('Mesas avisa en vez de mostrar el salón sin mesas', async () => {
        listTables.mockRejectedValue(NETWORK_ERROR);
        listZones.mockResolvedValue({ data: [] });
        listBranches.mockResolvedValue({ data: [] });
        const { host } = await mount(<TablesManager />);

        await expectErrorThenRetry(host, 'mesas', listTables, () => {
            listTables.mockResolvedValue({ data: [{ id: 't1', number: 1, name: 'Mesa 1', capacity: 4, area: 'Salón', status: 'disponible', branch_id: 'b1' }] });
        });
        expect(host.textContent).toContain('Mesa 1');
    });

    it('Sucursales avisa en vez de decir «No hay sucursales configuradas»', async () => {
        listBranches.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<SucursalesPanel />);

        expect(host.textContent).not.toContain('No hay sucursales configuradas');
        await expectErrorThenRetry(host, 'sucursales', listBranches, () => {
            listBranches.mockResolvedValue({ data: [{ id: 'b1', name: 'Centro', timezone: 'America/Lima', business_day_cutoff: '04:00' }] });
        });
        expect($(host, 'branch-row-b1')).not.toBeNull();
    });

    it('Pedidos avisa en vez de decir «No hay pedidos en esta vista»', async () => {
        listOrders.mockRejectedValue(NETWORK_ERROR);
        listTables.mockResolvedValue({ data: [] });
        const { host } = await mount(<Pedidos />);

        expect(host.textContent).not.toContain('No hay pedidos en esta vista');
        await expectErrorThenRetry(host, 'pedidos', listOrders, () => {
            listOrders.mockResolvedValue({ data: [{ id: 'o1', order_number: 41, status: 'nuevo', total: 10, items: [], created_at: new Date().toISOString() }] });
        });
        expect($(host, 'pedidos-card-41')).not.toBeNull();
    });

    it('Pedidos con una vista realmente vacía sí lo dice', async () => {
        listOrders.mockResolvedValue({ data: [] });
        listTables.mockResolvedValue({ data: [] });
        const { host } = await mount(<Pedidos />);

        expect($(host, 'pedidos-error')).toBeNull();
        expect(host.textContent).toContain('No hay pedidos en esta vista');
    });

    it('elegir mesa en Pedidos no dice «No hay mesas disponibles» si las mesas no cargaron', async () => {
        listOrders.mockResolvedValue({ data: [] });
        listTables.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<Pedidos />);

        await click($(host, 'pedidos-nuevo-button'));
        await click(document.body.querySelector('[data-testid="area-mesa"]'));

        expect(document.body.textContent).not.toContain('No hay mesas disponibles');
        expect(document.body.querySelector('[data-testid="areas-venta-error"]')).not.toBeNull();
    });

    it('Agotar o habilitar avisa en vez de mostrar una lista vacía', async () => {
        listProducts.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<Disponibilidad />);

        await expectErrorThenRetry(host, 'disponibilidad', listProducts, () => {
            listProducts.mockResolvedValue({ data: [{ id: 'p1', name: 'Anticucho', is_available: true, is_combo: false }] });
        });
        expect(host.textContent).toContain('Anticucho');
    });

    it('Comprobantes avisa en vez de decir «Todavía no hay comprobantes subidos»', async () => {
        listPaymentProofs.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<Comprobantes />);

        expect(host.textContent).not.toContain('Todavía no hay comprobantes subidos');
        await expectErrorThenRetry(host, 'comprobantes', listPaymentProofs, () => {
            listPaymentProofs.mockResolvedValue({ data: { pending: 0, items: [{ id: 'o1', order_number: 12, payment_status: 'pagado', total: 25, amount_paid: 25, source: 'staff' }] } });
        });
        expect($(host, 'comprobantes-row-12')).not.toBeNull();
    });

    it('el detalle del pedido avisa en vez de quedarse en «Cargando pedido…»', async () => {
        getOrder.mockRejectedValue(NETWORK_ERROR);
        listCategories.mockResolvedValue({ data: [] });
        listProducts.mockResolvedValue({ data: [] });
        listTables.mockResolvedValue({ data: [] });
        listUsers.mockResolvedValue({ data: [] });
        const { host } = await mount(<PedidoDetalle />);

        expect(host.textContent).not.toContain('Cargando pedido');
        await expectErrorThenRetry(host, 'pedido-detalle', getOrder, () => {
            getOrder.mockResolvedValue({ data: { id: 'order-1', order_number: 17, status: 'nuevo', payment_status: 'pendiente', order_type: 'local', total: 25, subtotal: 25, amount_paid: 0, items: [] } });
        });
        expect(host.textContent).toContain('17');
    });

    it('el alta de pedido avisa en vez de mostrar una carta sin platos', async () => {
        listProducts.mockRejectedValue(NETWORK_ERROR);
        listCategories.mockResolvedValue({ data: [] });
        listTables.mockResolvedValue({ data: [] });
        const { host } = await mount(<PedidoNuevo />);

        await expectErrorThenRetry(host, 'pedido-nuevo', listProducts, () => {
            listProducts.mockResolvedValue({ data: [{ id: 'p1', name: 'Ceviche', price: 38, is_available: true }] });
        });
        expect($(host, 'producto-card-p1')).not.toBeNull();
    });

    it('el alta de pedido también avisa si fallan las categorías', async () => {
        listProducts.mockResolvedValue({ data: [{ id: 'p1', name: 'Ceviche', price: 38, is_available: true }] });
        listCategories.mockRejectedValue(NETWORK_ERROR);
        listTables.mockResolvedValue({ data: [] });
        const { host } = await mount(<PedidoNuevo />);

        expect($(host, 'pedido-nuevo-error')).not.toBeNull();
        // Lo que sí cargó sigue usable: la alerta no tapa la carta.
        expect($(host, 'producto-card-p1')).not.toBeNull();
    });

    it('el seguimiento no dice «Pedido no encontrado» ante un fallo de red', async () => {
        getPublicRestaurant.mockResolvedValue({ data: {} });
        getPublicOrderTable.mockResolvedValue({ data: null });
        getPublicOrder.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<PedidoTracking />);

        expect(host.textContent).not.toContain('Pedido no encontrado');
        await expectErrorThenRetry(host, 'tracking', getPublicOrder, () => {
            getPublicOrder.mockResolvedValue({ data: { id: 'o1', order_number: 88, tracking_code: 'TRACK-1', status: 'enviado_cocina', order_type: 'local', items: [], payment_state: 'no_requerido' } });
        });
        expect($(host, 'tracking-root')).not.toBeNull();
    });

    it('el seguimiento sí dice «Pedido no encontrado» ante un 404', async () => {
        getPublicRestaurant.mockResolvedValue({ data: {} });
        getPublicOrderTable.mockResolvedValue({ data: null });
        getPublicOrder.mockRejectedValue({ response: { status: 404, data: { detail: 'Pedido no encontrado' } } });
        const { host } = await mount(<PedidoTracking />);

        expect(host.textContent).toContain('Pedido no encontrado');
        expect($(host, 'tracking-error')).toBeNull();
        expect($(host, 'tracking-reintentar')).toBeNull();
    });
});

describe('T11 · los avisos de eliminar dicen que falló eliminar', () => {
    const lastToast = () => String(toast.error.mock.calls.at(-1)?.[0] ?? '');
    const confirmDelete = () => [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Eliminar');

    it('una categoría que no se pudo eliminar no dice «guardar»', async () => {
        listCategories.mockResolvedValue({ data: [{ id: 'c1', name: 'Postres', description: '', sort_order: 1 }] });
        deleteCategory.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<Categorias />);

        await click(host.querySelector('[aria-label="Eliminar Postres"]'));
        await click(confirmDelete());

        expect(deleteCategory).toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
        expect(lastToast()).toMatch(/eliminar/i);
        expect(lastToast()).not.toMatch(/guardar/i);
    });

    it('un usuario que no se pudo eliminar no dice «guardar»', async () => {
        listUsers.mockResolvedValue({ data: [{ id: 'u2', full_name: 'Rosa Mozo', email: 'rosa@x.pe', role: 'mozo', status: 'active', functions: ['atencion'] }] });
        listBranches.mockResolvedValue({ data: [] });
        deleteUser.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<Usuarios />);

        await click(host.querySelector('[aria-label="Eliminar Rosa Mozo"]'));
        await click(confirmDelete());

        expect(deleteUser).toHaveBeenCalled();
        expect(lastToast()).toMatch(/eliminar/i);
        expect(lastToast()).not.toMatch(/guardar/i);
    });

    it('una mesa que no se pudo eliminar explica qué falló en vez de decir «Error»', async () => {
        listTables.mockResolvedValue({ data: [{ id: 't1', number: 1, name: 'Mesa 1', capacity: 4, area: 'Salón', status: 'disponible', branch_id: 'b1' }] });
        listZones.mockResolvedValue({ data: [] });
        listBranches.mockResolvedValue({ data: [] });
        deleteTable.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<TablesManager />);

        await click(host.querySelector('[aria-label="Eliminar Mesa 1"]'));
        await click(confirmDelete());

        expect(deleteTable).toHaveBeenCalled();
        expect(lastToast()).toMatch(/eliminar/i);
        expect(lastToast()).not.toMatch(/guardar/i);
    });

    it('una zona que no se pudo eliminar no dice «guardar»', async () => {
        listZones.mockResolvedValue({ data: [{ id: 'z1', name: 'Terraza', branch_id: null }] });
        listBranches.mockResolvedValue({ data: [] });
        listTables.mockResolvedValue({ data: [] });
        deleteZone.mockRejectedValue(NETWORK_ERROR);
        const { host } = await mount(<ZonasPanel />);

        await click(host.querySelector('[aria-label="Eliminar Terraza"]'));
        await click(confirmDelete());

        expect(deleteZone).toHaveBeenCalled();
        expect(lastToast()).toMatch(/eliminar/i);
        expect(lastToast()).not.toMatch(/guardar/i);
    });
});
