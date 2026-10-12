/**
 * Touch layouts: the listed controls reach 44 px on coarse pointers (class
 * contract: `touch-target-coarse`, defined in index.css), and the quick notes
 * follow the category of the product they annotate.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { PersonOrderSummary } from '@/components/OrderSummary';
import FloorFilters from '@/pages/salon/FloorFilters';
import MesaCard from '@/components/MesaCard';
import { quickNotesFor, QUICK_NOTES } from '@/lib/orderDraft';

global.IS_REACT_ACT_ENVIRONMENT = true;

const categories = [
    { id: 'c-main', name: 'Platos principales' },
    { id: 'c-drink', name: 'Bebidas' },
    { id: 'c-dessert', name: 'Postres' },
    { id: 'c-chicken', name: 'Pollo a la brasa' },
];
const products = [
    { id: 'p-main', category_id: 'c-main' },
    { id: 'p-drink', category_id: 'c-drink' },
    { id: 'p-dessert', category_id: 'c-dessert' },
    { id: 'p-chicken', category_id: 'c-chicken' },
];
const draft = (id, productId) => ({ id, product_id: productId, product_name: `Item ${id}`, status: 'borrador', quantity: 1, subtotal: 10 });

describe('quickNotesFor', () => {
    it('offers notes that make sense for the category', () => {
        expect(quickNotesFor(draft('a', 'p-drink'), products, categories)).toEqual(['Sin hielo', 'Poco azúcar']);
        expect(quickNotesFor(draft('b', 'p-dessert'), products, categories)).toEqual([]);
        expect(quickNotesFor(draft('c', 'p-chicken'), products, categories)).toEqual(['Sin ensalada', 'Sin ají', 'Parte pierna', 'Parte pecho']);
        expect(quickNotesFor(draft('d', 'p-main'), products, categories)).toEqual(['Sin ensalada', 'Sin cebolla', 'Sin ají', 'Poco picante', 'Término medio']);
    });

    it('keeps the full list when the category is unknown', () => {
        expect(quickNotesFor(draft('e', 'missing'), products, categories)).toEqual(QUICK_NOTES);
        expect(quickNotesFor(draft('f', 'p-main'), [], [])).toEqual(QUICK_NOTES);
    });
});

describe('PersonOrderSummary', () => {
    let host;
    let root;
    beforeEach(async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
    });

    const render = (items) => act(async () => root.render(
        <PersonOrderSummary items={items} orderStatus="nuevo" canEdit products={products} categories={categories} testIdPrefix="t" />,
    ));

    it('shows only the notes of the product category', async () => {
        await render([draft('a', 'p-drink')]);
        const chips = [...host.querySelectorAll('[data-testid^="t-item-nota-rapida-a-"]')].map((n) => n.textContent);
        expect(chips).toEqual(['Sin hielo', 'Poco azúcar']);
    });

    it('renders no chip row for a category without notes', async () => {
        await render([draft('b', 'p-dessert')]);
        expect(host.querySelector('[data-testid="t-item-notas-rapidas-b"]')).toBeNull();
    });

    it('gives steppers and quick-note chips a coarse-pointer target', async () => {
        await render([draft('c', 'p-main')]);
        const targets = [
            host.querySelector('[data-testid="t-item-menos-c"]'),
            host.querySelector('[data-testid="t-item-mas-c"]'),
            ...host.querySelectorAll('[data-testid^="t-item-nota-rapida-c-"]'),
        ];
        expect(targets.length).toBeGreaterThan(3);
        targets.forEach((node) => expect(node.className).toContain('touch-target-coarse'));
    });
});

describe('filters and floor actions', () => {
    it('filter chips get the coarse-pointer target', () => {
        const markup = renderToStaticMarkup(
            <FloorFilters areaFilter="todas" areaLabel={(a) => a} areas={['todas']} setAreaFilter={() => {}}
                setStateFilter={() => {}} stateFilter="todas" stateCounts={{ todas: 1, libre: 0, activas: 0, listo: 0, cuenta: 1 }} />,
        );
        const chips = markup.match(/<button[^>]*data-testid="salon-filtro-[^"]+"[^>]*>/g);
        expect(chips).toHaveLength(5);
        chips.forEach((chip) => expect(chip).toContain('touch-target-coarse'));
    });

    it('the Cobrar action of a table card gets it too', () => {
        const order = { id: 'o1', status: 'pendiente_pago', total: 30, amount_paid: 0, items: [] };
        const item = {
            table: { id: 't1', number: 4, name: 'Mesa 4', status: 'esperando_pago', active_order: order },
            floor: { key: 'cuenta' }, displayOrder: order, serviceOrder: order, ready: 0, due: 30, billRequested: true,
            showVisitaActiva: false, group: null, groupBadge: null, groupNumbers: null,
        };
        const markup = renderToStaticMarkup(<MesaCard item={item} canCharge onCharge={() => {}} onOpen={() => {}} />);
        const cobrar = markup.match(/<button[^>]*data-testid="mesa-card-cobrar-4"[^>]*>/)[0];
        expect(cobrar).toContain('touch-target-coarse');
    });

    it('index.css defines the class for coarse pointers at 44 px', () => {
        const css = fs.readFileSync(path.resolve(__dirname, '..', 'index.css'), 'utf8');
        expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.touch-target-coarse\s*\{[^}]*min-height:\s*44px[^}]*min-width:\s*44px/);
    });
});
