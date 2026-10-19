/**
 * Un doble toque en una pantalla de administración no puede mandar dos peticiones.
 *
 * Guardar y eliminar en Productos y Categorías, guardar en Pagos y el interruptor
 * de estado en Usuarios no tenían guarda: con red lenta, un segundo toque creaba
 * el registro dos veces o lo borraba dos veces. Cada control ahora se bloquea y
 * MUESTRA que está trabajando (aria-busy + etiqueta), no solo se queda inerte.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import Productos from '@/pages/Productos';
import Categorias from '@/pages/Categorias';
import Pagos from '@/pages/Pagos';
import Usuarios from '@/pages/Usuarios';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-router-dom', () => ({
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    useNavigate: () => jest.fn(),
}));
jest.mock('@/contexts/NotifyContext', () => ({ useRealtimeGeneration: () => 0 }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1', role: 'admin' } }) }));
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
jest.mock('@/lib/api/payments', () => ({ getPaymentConfig: jest.fn(), updatePaymentConfig: jest.fn() }));
jest.mock('@/lib/api/users', () => ({
    listUsers: jest.fn(),
    createUser: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
}));
jest.mock('@/lib/api/branches', () => ({ listBranches: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { listProducts, updateProduct, deleteProduct } = require('@/lib/api/products');
const { listCategories, updateCategory, deleteCategory } = require('@/lib/api/categories');
const { getPaymentConfig, updatePaymentConfig } = require('@/lib/api/payments');
const { listUsers, updateUser, deleteUser } = require('@/lib/api/users');
const { listBranches } = require('@/lib/api/branches');

const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const $ = (selector) => document.body.querySelector(selector);

/** A request that stays in flight until the test releases it. */
function held() {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    return { promise, release: () => act(async () => { release({ data: {} }); await promise; }) };
}

/** Two taps in the same tick, before React can re-render between them. */
const doubleTap = (node) => act(async () => { node.click(); node.click(); });

let view;
async function mount(element) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    view = { host, root };
    await act(async () => root.render(element));
    await flush();
}

afterEach(async () => {
    await act(async () => view.root.unmount());
    view.host.remove();
    document.body.innerHTML = '';
    jest.resetAllMocks();
});

const PRODUCT = { id: 'p1', name: 'Ceviche', price: 20, category_id: 'c1', preparation_time: 15, is_available: true, is_combo: false, code: '' };
const CATEGORY = { id: 'c1', name: 'Entradas', description: '', sort_order: 1, slug: 'entradas' };

describe('Productos', () => {
    beforeEach(() => {
        listProducts.mockResolvedValue({ data: [PRODUCT] });
        listCategories.mockResolvedValue({ data: [CATEGORY] });
    });

    it('sends one update for a double tap on Guardar and shows it is saving', async () => {
        const request = held();
        updateProduct.mockReturnValue(request.promise);
        await mount(<Productos />);
        await act(async () => $('[data-testid="producto-edit-p1"]').click());
        await flush();

        await doubleTap($('[data-testid="producto-form-save"]'));

        expect(updateProduct).toHaveBeenCalledTimes(1);
        const save = $('[data-testid="producto-form-save"]');
        expect(save.getAttribute('aria-busy')).toBe('true');
        expect(save.disabled).toBe(true);
        expect(save.textContent).toBe('Guardando…');

        await request.release();
        await flush();
        expect($('[data-testid="producto-form-save"]')).toBeNull();
    });

    it('sends one delete for a double tap on Eliminar and shows it is deleting', async () => {
        const request = held();
        deleteProduct.mockReturnValue(request.promise);
        await mount(<Productos />);
        await act(async () => $('[data-testid="producto-del-p1"]').click());
        await flush();

        const confirm = [...document.body.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === 'Eliminar');
        await doubleTap(confirm);

        expect(deleteProduct).toHaveBeenCalledTimes(1);
        const busy = document.body.querySelector('[role="alertdialog"] [aria-busy="true"]');
        expect(busy).not.toBeNull();
        expect(busy.disabled).toBe(true);
        expect(busy.textContent).toBe('Eliminando…');

        await request.release();
        await flush();
        expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    });
});

describe('Categorias', () => {
    beforeEach(() => {
        listCategories.mockResolvedValue({ data: [CATEGORY] });
    });

    it('sends one update for a double tap on Guardar and shows it is saving', async () => {
        const request = held();
        updateCategory.mockReturnValue(request.promise);
        await mount(<Categorias />);
        await act(async () => $('[aria-label="Editar Entradas"]').click());
        await flush();

        await doubleTap($('[data-testid="categoria-form-save"]'));

        expect(updateCategory).toHaveBeenCalledTimes(1);
        const save = $('[data-testid="categoria-form-save"]');
        expect(save.getAttribute('aria-busy')).toBe('true');
        expect(save.textContent).toBe('Guardando…');

        await request.release();
        await flush();
        expect($('[data-testid="categoria-form-save"]')).toBeNull();
    });

    it('sends one delete for a double tap on Eliminar and shows it is deleting', async () => {
        const request = held();
        deleteCategory.mockReturnValue(request.promise);
        await mount(<Categorias />);
        await act(async () => $('[aria-label="Eliminar Entradas"]').click());
        await flush();

        const confirm = [...document.body.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === 'Eliminar');
        await doubleTap(confirm);

        expect(deleteCategory).toHaveBeenCalledTimes(1);
        const busy = document.body.querySelector('[role="alertdialog"] [aria-busy="true"]');
        expect(busy.textContent).toBe('Eliminando…');

        await request.release();
        await flush();
        expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    });
});

describe('Pagos', () => {
    it('sends one update for a double tap on Guardar cambios and shows it is saving', async () => {
        const request = held();
        getPaymentConfig.mockResolvedValue({ data: { enable_efectivo: true, enable_yape: false } });
        updatePaymentConfig.mockReturnValue(request.promise);
        await mount(<Pagos />);

        await doubleTap($('[data-testid="pagos-save"]'));

        expect(updatePaymentConfig).toHaveBeenCalledTimes(1);
        const save = $('[data-testid="pagos-save"]');
        expect(save.getAttribute('aria-busy')).toBe('true');
        expect(save.disabled).toBe(true);
        expect(save.textContent).toBe('Guardando…');

        await request.release();
        await flush();
        expect($('[data-testid="pagos-save"]').getAttribute('aria-busy')).toBeNull();
    });
});

describe('Usuarios', () => {
    beforeEach(() => {
        listUsers.mockResolvedValue({ data: [{ id: 'u1', email: 'a@x.test', full_name: 'Ana Mozo', role: 'mozo', status: 'active', functions: ['atencion'] }] });
        listBranches.mockResolvedValue({ data: [] });
    });

    it('sends one status change for a double tap on the switch and shows it is working', async () => {
        const request = held();
        updateUser.mockReturnValue(request.promise);
        await mount(<Usuarios />);

        await doubleTap($('[role="switch"]'));

        expect(updateUser).toHaveBeenCalledTimes(1);
        const toggle = $('[role="switch"]');
        expect(toggle.disabled).toBe(true);
        expect(toggle.getAttribute('aria-busy')).toBe('true');
        expect(toggle.closest('label').textContent).toContain('Guardando…');

        await request.release();
        await flush();
        expect($('[role="switch"]').disabled).toBe(false);
    });

    it('sends one delete for a double tap on Eliminar', async () => {
        const request = held();
        deleteUser.mockReturnValue(request.promise);
        await mount(<Usuarios />);
        await act(async () => $('[aria-label="Eliminar Ana Mozo"]').click());
        await flush();

        const confirm = [...document.body.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === 'Eliminar');
        await doubleTap(confirm);

        expect(deleteUser).toHaveBeenCalledTimes(1);
        expect(document.body.querySelector('[role="alertdialog"] [aria-busy="true"]').textContent).toBe('Eliminando…');
        await request.release();
    });
});
