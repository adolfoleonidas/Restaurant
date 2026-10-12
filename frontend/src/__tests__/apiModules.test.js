import { api } from '@/lib/api';
import * as request from '@/lib/api/request';
import * as orders from '@/lib/api/orders';
import * as tables from '@/lib/api/tables';
import * as branches from '@/lib/api/branches';
import * as zones from '@/lib/api/zones';
import * as payments from '@/lib/api/payments';
import * as cash from '@/lib/api/cash';
import * as products from '@/lib/api/products';
import * as categories from '@/lib/api/categories';
import * as users from '@/lib/api/users';
import * as restaurant from '@/lib/api/restaurant';
import * as reports from '@/lib/api/reports';
import * as auth from '@/lib/api/auth';
import * as publicApi from '@/lib/api/public';

jest.mock('@/lib/api', () => ({
    api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const P = { params: { a: 1 } };
const CFG = { onUploadProgress: () => {} };

// [label, call, method, expected axios arguments]
const CASES = [
    // orders
    ['getOrder', () => orders.getOrder('o1'), 'get', ['/orders/o1']],
    ['getOrder with config', () => orders.getOrder('o1', P), 'get', ['/orders/o1', P]],
    ['listOrders', () => orders.listOrders({ active_only: true }), 'get', ['/orders', { params: { active_only: true } }]],
    ['getKitchenOrders', () => orders.getKitchenOrders(), 'get', ['/orders/kitchen']],
    ['createOrder', () => orders.createOrder({ x: 1 }), 'post', ['/orders', { x: 1 }]],
    ['addOrderItems', () => orders.addOrderItems('o1', [{ product_id: 'p' }]), 'post', ['/orders/o1/items', [{ product_id: 'p' }]]],
    ['updateOrderItem', () => orders.updateOrderItem('o1', 'i1', { quantity: 2 }), 'patch', ['/orders/o1/items/i1', { quantity: 2 }]],
    ['removeOrderItem', () => orders.removeOrderItem('o1', 'i1'), 'delete', ['/orders/o1/items/i1']],
    ['voidOrderItem', () => orders.voidOrderItem('o1', 'i1', { reason: 'r' }), 'post', ['/orders/o1/items/i1/void', { reason: 'r' }]],
    ['setOrderItemStatus', () => orders.setOrderItemStatus('o1', 'i1', { status: 'listo' }), 'post', ['/orders/o1/items/i1/status', { status: 'listo' }]],
    ['moveOrderItem', () => orders.moveOrderItem('o1', 'i1', { target_order_id: 'o2' }), 'post', ['/orders/o1/items/i1/move', { target_order_id: 'o2' }]],
    ['sendOrderToKitchen', () => orders.sendOrderToKitchen('o1'), 'post', ['/orders/o1/send-to-kitchen']],
    ['bumpOrder', () => orders.bumpOrder('o1', { from_status: 'nuevo' }), 'post', ['/orders/o1/bump', { from_status: 'nuevo' }]],
    ['mergeOrder', () => orders.mergeOrder('o1', { source_order_id: 'o2' }), 'post', ['/orders/o1/merge', { source_order_id: 'o2' }]],
    ['moveOrder', () => orders.moveOrder('o1', { target_table_id: 't' }), 'post', ['/orders/o1/move', { target_table_id: 't' }]],
    ['splitOrder', () => orders.splitOrder('o1', { parts: 2 }), 'post', ['/orders/o1/split', { parts: 2 }]],
    ['setOrderAlias', () => orders.setOrderAlias('o1', { alias: 'A' }), 'patch', ['/orders/o1/alias', { alias: 'A' }]],
    ['serveOrder', () => orders.serveOrder('o1'), 'post', ['/orders/o1/serve']],
    ['closeOrderAttention', () => orders.closeOrderAttention('o1'), 'post', ['/orders/o1/attention/close']],
    ['setOrderStatus', () => orders.setOrderStatus('o1', { status: 'cancelado' }), 'post', ['/orders/o1/status', { status: 'cancelado' }]],
    ['reassignOrder', () => orders.reassignOrder('o1', { waiter_id: 'w' }), 'post', ['/orders/o1/reassign', { waiter_id: 'w' }]],
    ['confirmOrderPayment', () => orders.confirmOrderPayment('o1'), 'post', ['/orders/o1/confirm-payment']],
    // tables
    ['listTables', () => tables.listTables(), 'get', ['/tables']],
    ['listTables scoped', () => tables.listTables({ branch_id: 'b' }), 'get', ['/tables', { params: { branch_id: 'b' } }]],
    ['createTable', () => tables.createTable({ n: 1 }), 'post', ['/tables', { n: 1 }]],
    ['updateTable', () => tables.updateTable('t1', { n: 2 }), 'patch', ['/tables/t1', { n: 2 }]],
    ['deleteTable', () => tables.deleteTable('t1'), 'delete', ['/tables/t1']],
    ['releaseTable', () => tables.releaseTable('t1'), 'post', ['/tables/t1/release']],
    ['transferTable', () => tables.transferTable('t1', { target_table_id: 't2' }), 'post', ['/tables/t1/transfer', { target_table_id: 't2' }]],
    ['getTableGuestLink', () => tables.getTableGuestLink('t1'), 'get', ['/tables/t1/guest-link']],
    ['rotateTableQr', () => tables.rotateTableQr('t1'), 'post', ['/tables/t1/qr/rotate']],
    ['revokeTableQr', () => tables.revokeTableQr('t1'), 'post', ['/tables/t1/qr/revoke']],
    ['createTableGroup', () => tables.createTableGroup({ table_ids: ['a'] }), 'post', ['/table-groups', { table_ids: ['a'] }]],
    ['deleteTableGroup', () => tables.deleteTableGroup('g1'), 'delete', ['/table-groups/g1']],
    ['removeTableGroupMember', () => tables.removeTableGroupMember('g1', 't1'), 'delete', ['/table-groups/g1/tables/t1']],
    // zones and branches
    ['listZones', () => zones.listZones(), 'get', ['/zones']],
    ['createZone', () => zones.createZone({ n: 1 }), 'post', ['/zones', { n: 1 }]],
    ['updateZone', () => zones.updateZone('z1', { n: 1 }), 'patch', ['/zones/z1', { n: 1 }]],
    ['deleteZone', () => zones.deleteZone('z1'), 'delete', ['/zones/z1']],
    ['listBranches', () => branches.listBranches(), 'get', ['/branches']],
    ['createBranch', () => branches.createBranch({ n: 1 }), 'post', ['/branches', { n: 1 }]],
    ['updateBranch', () => branches.updateBranch('b1', { n: 1 }), 'patch', ['/branches/b1', { n: 1 }]],
    // payments, approvals, prepay
    ['createPayment', () => payments.createPayment({ amount: 1 }), 'post', ['/payments', { amount: 1 }]],
    ['uploadPaymentProof', () => payments.uploadPaymentProof('o1', { payment_proof: 'x' }), 'post', ['/payments/o1/proof', { payment_proof: 'x' }]],
    ['voidPayment', () => payments.voidPayment('p1', { kind: 'void' }), 'post', ['/payments/p1/void', { kind: 'void' }]],
    ['listPayments', () => payments.listPayments({ period: 'day' }), 'get', ['/payments', { params: { period: 'day' } }]],
    ['listPaymentsByOrder', () => payments.listPaymentsByOrder('o 1', P), 'get', ['/payments/by-order/o 1', P]],
    ['listPaymentProofs', () => payments.listPaymentProofs({ pending: true }), 'get', ['/payments/proofs', { params: { pending: true } }]],
    ['getPaymentConfig', () => payments.getPaymentConfig(), 'get', ['/payment-config']],
    ['getCollectionConfig', () => payments.getCollectionConfig(), 'get', ['/payment-config/collection']],
    ['updatePaymentConfig', () => payments.updatePaymentConfig({ a: 1 }), 'patch', ['/payment-config', { a: 1 }]],
    ['listPendingPrepay', () => payments.listPendingPrepay(), 'get', ['/public-prepay/pending']],
    ['runPrepayAction', () => payments.runPrepayAction('o1', 'confirm'), 'post', ['/public-prepay/o1/confirm']],
    ['createApproval', () => payments.createApproval({ kind: 'void' }), 'post', ['/approvals', { kind: 'void' }]],
    ['decideApproval', () => payments.decideApproval('a1', { action: 'approve' }), 'post', ['/approvals/a1/decide', { action: 'approve' }]],
    // cash
    ['getCash', () => cash.getCash(), 'get', ['/cash']],
    ['getCurrentCash', () => cash.getCurrentCash(), 'get', ['/cash/current']],
    ['openCash', () => cash.openCash({ opening_amount: 1 }), 'post', ['/cash/open', { opening_amount: 1 }]],
    ['closeCash', () => cash.closeCash({ closing_amount: 1 }), 'post', ['/cash/close', { closing_amount: 1 }]],
    ['addCashMovement', () => cash.addCashMovement({ amount: 1 }), 'post', ['/cash/movements', { amount: 1 }]],
    ['listCashHistory', () => cash.listCashHistory({ period: 'day' }), 'get', ['/cash/history', { params: { period: 'day' } }]],
    // catalog
    ['listProducts', () => products.listProducts(), 'get', ['/products']],
    ['importProducts', () => products.importProducts({ items: [] }), 'post', ['/products/import', { items: [] }]],
    ['createProduct', () => products.createProduct({ n: 1 }), 'post', ['/products', { n: 1 }]],
    ['updateProduct', () => products.updateProduct('p1', { n: 1 }), 'patch', ['/products/p1', { n: 1 }]],
    ['deleteProduct', () => products.deleteProduct('p1'), 'delete', ['/products/p1']],
    ['setProductAvailability', () => products.setProductAvailability('p1', { is_available: false }), 'post', ['/products/p1/availability', { is_available: false }]],
    ['listCategories', () => categories.listCategories(), 'get', ['/categories']],
    ['createCategory', () => categories.createCategory({ n: 1 }), 'post', ['/categories', { n: 1 }]],
    ['updateCategory', () => categories.updateCategory('c1', { n: 1 }), 'patch', ['/categories/c1', { n: 1 }]],
    ['deleteCategory', () => categories.deleteCategory('c1'), 'delete', ['/categories/c1']],
    // users, restaurant, reports, auth
    ['listUsers', () => users.listUsers(), 'get', ['/users']],
    ['createUser', () => users.createUser({ n: 1 }), 'post', ['/users', { n: 1 }]],
    ['updateUser', () => users.updateUser('u1', { n: 1 }), 'patch', ['/users/u1', { n: 1 }]],
    ['deleteUser', () => users.deleteUser('u1'), 'delete', ['/users/u1']],
    ['getRestaurant', () => restaurant.getRestaurant(), 'get', ['/restaurants/current']],
    ['updateRestaurant', () => restaurant.updateRestaurant({ a: 1 }), 'patch', ['/restaurants/current', { a: 1 }]],
    ['getSystemInfo', () => restaurant.getSystemInfo(), 'get', ['/system/info']],
    ['resetData', () => restaurant.resetData({ confirm: 'x' }), 'post', ['/data/reset', { confirm: 'x' }]],
    ['resetCatalog', () => restaurant.resetCatalog({ confirm: 'x' }), 'post', ['/data/catalog', { confirm: 'x' }]],
    ['getSalesReport', () => reports.getSalesReport({ a: 1 }), 'get', ['/reports/sales', { params: { a: 1 } }]],
    ['getProductsReport', () => reports.getProductsReport({ a: 1 }), 'get', ['/reports/products', { params: { a: 1 } }]],
    ['getTodayReport', () => reports.getTodayReport(), 'get', ['/reports/today']],
    ['getTodayReport scoped', () => reports.getTodayReport({ branch_id: 'b' }), 'get', ['/reports/today', { params: { branch_id: 'b' } }]],
    ['login', () => auth.login('a@b.c', 'pw'), 'post', ['/auth/login', { email: 'a@b.c', password: 'pw' }]],
    // public
    ['getPublicRestaurant', () => publicApi.getPublicRestaurant(), 'get', ['/public/restaurant']],
    ['getPublicCategories', () => publicApi.getPublicCategories(), 'get', ['/public/categories']],
    ['getPublicProducts', () => publicApi.getPublicProducts(), 'get', ['/public/products']],
    ['getPublicTables', () => publicApi.getPublicTables(), 'get', ['/public/tables']],
    ['getPublicPaymentConfig', () => publicApi.getPublicPaymentConfig(), 'get', ['/public/payment-config']],
    ['resolvePublicTable', () => publicApi.resolvePublicTable('tok'), 'get', ['/public/tables/resolve', { params: { token: 'tok' } }]],
    ['getPublicTableSession', () => publicApi.getPublicTableSession('tok'), 'get', ['/public/tables/session', { params: { token: 'tok' } }]],
    ['listPickupBranches', () => publicApi.listPickupBranches(), 'get', ['/public/pickup-branches']],
    ['listDeliveryBranches', () => publicApi.listDeliveryBranches(), 'get', ['/public/delivery-branches']],
    ['getPublicOrder', () => publicApi.getPublicOrder('c1'), 'get', ['/public/orders/c1']],
    ['getPublicOrderTable', () => publicApi.getPublicOrderTable('c1'), 'get', ['/public/orders/c1/table']],
    ['createPublicOrder', () => publicApi.createPublicOrder({ a: 1 }), 'post', ['/public/orders', { a: 1 }]],
    ['uploadPublicOrderProof', () => publicApi.uploadPublicOrderProof('c1', { payment_proof: 'x' }), 'post', ['/public/orders/c1/proof', { payment_proof: 'x' }]],
    ['uploadPublicOrderProof with config', () => publicApi.uploadPublicOrderProof('c1', { payment_proof: 'x' }, CFG), 'post', ['/public/orders/c1/proof', { payment_proof: 'x' }, CFG]],
    ['addPublicOrderItem', () => publicApi.addPublicOrderItem('c1', { a: 1 }), 'post', ['/public/orders/c1/items', { a: 1 }]],
    ['updatePublicOrderItem', () => publicApi.updatePublicOrderItem('c1', 'l1', { quantity: 1 }), 'patch', ['/public/orders/c1/items/l1', { quantity: 1 }]],
    ['removePublicOrderItem', () => publicApi.removePublicOrderItem('c1', 'l1'), 'delete', ['/public/orders/c1/items/l1']],
];

describe('api modules forward the exact axios call', () => {
    beforeEach(() => {
        Object.values(api).forEach((fn) => fn.mockReset().mockResolvedValue({ data: 'ok' }));
    });

    test.each(CASES)('%s', async (_label, call, method, expected) => {
        const result = await call();
        expect(result).toEqual({ data: 'ok' });
        expect(api[method]).toHaveBeenCalledTimes(1);
        expect(api[method].mock.calls[0]).toEqual(expected);
        Object.keys(api).filter((m) => m !== method).forEach((m) => expect(api[m]).not.toHaveBeenCalled());
    });
});

describe('request helpers', () => {
    beforeEach(() => {
        Object.values(api).forEach((fn) => fn.mockReset().mockResolvedValue({ data: 'ok' }));
    });

    test('drop trailing undefined arguments so call shapes match plain axios usage', () => {
        request.get('/x', undefined);
        request.post('/x', undefined, undefined);
        request.patch('/x', { a: 1 }, undefined);
        request.del('/x', undefined);
        expect(api.get.mock.calls[0]).toEqual(['/x']);
        expect(api.post.mock.calls[0]).toEqual(['/x']);
        expect(api.patch.mock.calls[0]).toEqual(['/x', { a: 1 }]);
        expect(api.delete.mock.calls[0]).toEqual(['/x']);
    });

    test('keep an undefined body when a config follows it', () => {
        request.post('/x', undefined, CFG);
        expect(api.post.mock.calls[0]).toEqual(['/x', undefined, CFG]);
        expect(api.post.mock.calls[0]).toHaveLength(3);
    });
});
