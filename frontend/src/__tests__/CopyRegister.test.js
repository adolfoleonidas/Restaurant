/**
 * One voice (tuteo), one glossary, accents, plural agreement and one date
 * format across the UI copy. Source guards read the real files so a regression
 * (a voseo verb, a missing accent, "1 items") fails here.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CobroHeader from '@/components/cobro/CobroHeader';
import { GLOSSARY, ENVIRONMENT_LABELS, RECORD_LABELS } from '@/constants/glossary';
import { ORDER_STATUS_LABELS } from '@/constants/status';
import { tallyLabel } from '@/pages/salon/selectors';
import { fmtDateTime, fmtDateFull, fmtDateTimeShort, countOf } from '@/lib/format';
import { unpaidItemsLabel } from '@/lib/paymentForm';

const SRC = path.resolve(__dirname, '..');

function sources() {
    const out = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(full); return; }
        if (/\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
    });
    walk(SRC);
    return out.map((file) => ({
        file: path.relative(SRC, file),
        lines: fs.readFileSync(file, 'utf8').split(/\r?\n/),
    }));
}

const code = (line) => !/^\s*(\/\/|\*|\/\*)/.test(line);
const LETTER = 'A-Za-zÁÉÍÓÚáéíóúñÑ';
const standalone = (words) => new RegExp(`(?<![${LETTER}0-9_\\-./$#'"\`=:])(?:${words.join('|')})(?![${LETTER}0-9_\\-:=(])`);

function offenders(regex, { allow = () => false } = {}) {
    const found = [];
    sources().forEach(({ file, lines }) => lines.forEach((line, i) => {
        if (code(line) && regex.test(line) && !allow(file, line)) found.push(`${file}:${i + 1} ${line.trim().slice(0, 100)}`);
    }));
    return found;
}

describe('register: tuteo only', () => {
    const VOSEO = [
        'Abrí', 'Mirá', 'mirá', 'Usá', 'usá', 'Marcá', 'marcá', 'aceptás', 'Acercate', 'Activá', 'adjuntá', 'Agregá', 'Anulalo', 'anulalos', 'anulá', 'Asigná', 'avisá',
        'Cambialas', 'cerrala', 'cerralos', 'Cerrá', 'compartís', 'completá', 'Confirmá', 'Consultá', 'consultá', 'Copiá',
        'Creá', 'creá', 'dejá', 'Descargá', 'Devolvé', 'elegila', 'Elegí', 'elegí', 'Empezá', 'Escaneá', 'escribí', 'Esperá',
        'Finalizala', 'Hacé', 'Imprimí', 'Indicá', 'Ingresá', 'iniciá', 'Liberá', 'llevás', 'necesitás', 'Organizá', 'pagás',
        'pedí', 'Pedí', 'Pedile', 'pegalas', 'pegalo', 'Pegá', 'Permití', 'Podés', 'podés', 'Poné', 'Probá', 'querés',
        'Regeneralo', 'reintentá', 'Reintentá', 'restablecé', 'Revisá', 'revisá', 'Seguí', 'seguí', 'Seleccioná', 'Separala',
        'Separalas', 'separá', 'subí', 'tenés', 'tocá', 'Transferí', 'Verificá', 'volvé', 'Volvé',
    ];
    const USTED = ['Inténtelo', 'Vuelva', 'vuelva', 'Seleccione', 'Adjunte', 'Recargue', 'Puede reintentar'];

    it('has no voseo verbs in the UI copy', () => {
        expect(offenders(standalone(VOSEO))).toEqual([]);
    });

    it('has no usted verbs in the UI copy', () => {
        expect(offenders(standalone(USTED))).toEqual([]);
    });
});

describe('accents', () => {
    const WORDS = ['metodos?', 'descripcion', 'operacion', 'conexion', 'minimo', 'maximo', 'numero', 'codigo', 'ultimo', 'ultima',
        'tambien', 'accion', 'despues', 'opcion', 'direccion', 'telefono', 'categoria', 'atencion', 'sesion', 'informacion',
        'configuracion', 'aqui', 'cancelacion', 'anulacion', 'verificacion', 'contrasena', 'pagina', 'ademas'];

    it('writes Spanish words with their accent', () => {
        const regex = new RegExp(standalone(WORDS).source, 'i');
        // Identifiers and routes keep the plain spelling.
        const allow = (file, line) => /React\.lazy|<Configuracion|pages\/|\/configuracion|lib\/|testid|import /.test(line);
        expect(offenders(regex, { allow })).toEqual([]);
    });
});

describe('plural agreement', () => {
    it('countOf agrees with the number', () => {
        expect(countOf(1, 'ítem', 'ítems')).toBe('1 ítem');
        expect(countOf(0, 'ítem', 'ítems')).toBe('0 ítems');
        expect(countOf(2, 'ítem', 'ítems')).toBe('2 ítems');
    });

    it('the charge header says "1 ítem" and "2 ítems"', () => {
        const render = (n) => renderToStaticMarkup(
            <CobroHeader acct={{ items: Array.from({ length: n }, (_, i) => ({ id: i })), order_number: 1 }} onOpenChange={() => {}} paid={0} result={null} />,
        );
        expect(render(1)).toContain('1 ítem<');
        expect(render(2)).toContain('2 ítems<');
    });

    it('the item picker summary agrees too', () => {
        expect(unpaidItemsLabel(1, 1)).toBe('1 de 1 ítem');
        expect(unpaidItemsLabel(1, 3)).toBe('1 de 3 ítems');
    });

    it('no label uses the "(s)" shortcut', () => {
        expect(offenders(/[a-záéíóú]\(s\)/, { allow: (file, line) => /=>|function /.test(line) || /\.from\(s\)/.test(line) })).toEqual([]);
    });
});

describe('glossary', () => {
    it('fixes one word per concept', () => {
        expect(GLOSSARY.serve).toMatchObject({ action: 'Entregar', done: 'Entregado' });
        expect(GLOSSARY.kitchen).toBe('Cocina');
        expect(GLOSSARY.cancel).toMatchObject({ dismiss: 'Cancelar', void: 'Anular', voided: 'Anulado' });
        expect(GLOSSARY.shift).toBe('Turno');
        expect(GLOSSARY.menu).toBe('Carta');
        expect(GLOSSARY.team).toBe('Equipo');
    });

    it('an order that was voided reads "Anulado", an item that left the kitchen "Entregado"', () => {
        expect(ORDER_STATUS_LABELS.cancelado).toBe('Anulado');
        expect(tallyLabel({ ready: 2, drafts: 0, kitchen: 0, served: 0 })).toBe('Listo para entregar · 2');
        expect(tallyLabel({ ready: 0, drafts: 0, kitchen: 0, served: 3 })).toBe('Entregado · 3');
    });

    it('does not use the retired synonyms in labels', () => {
        const retired = /['"`>]\s*(Servir|Servido|Servidos|Cancelados?|Pedido cancelado|Listo para servir)\b/;
        expect(offenders(retired, { allow: (file, line) => /status ===|status !==|'cancelado'|"cancelado"|key: /.test(line) })).toEqual([]);
    });

    it('translates raw system values shown in Configuración', () => {
        expect(ENVIRONMENT_LABELS.production).toBe('Producción');
        expect(ENVIRONMENT_LABELS.development).toBe('Desarrollo');
        expect(RECORD_LABELS).toMatchObject({ tables: 'Mesas', products: 'Platos', orders: 'Pedidos', users: 'Usuarios' });
        const settings = fs.readFileSync(path.join(SRC, 'pages', 'Configuracion.jsx'), 'utf8');
        expect(settings).not.toMatch(/capitalize/);
    });
});

describe('one date format', () => {
    const ISO = '2026-03-04T15:07:09Z';
    it('every date helper prints day/month/year and hour:minute', () => {
        expect(fmtDateFull(ISO)).toBe(fmtDateTime(ISO));
        expect(fmtDateFull(new Date(ISO))).toBe(fmtDateTime(ISO));
        expect(fmtDateTimeShort(ISO)).toBe(fmtDateTime(ISO));
        expect(fmtDateTimeShort(null)).toBe('—');
    });
});
