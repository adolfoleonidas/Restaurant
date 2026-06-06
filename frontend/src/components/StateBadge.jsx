import React from 'react';
import { TABLE_STATUS_LABELS, ORDER_STATUS_LABELS } from '@/lib/format';

const tableClass = {
    disponible: 'state-disponible',
    ocupada: 'state-ocupada',
    esperando_pago: 'state-esperando',
    reservada: 'state-reservada',
    inactiva: 'state-inactiva',
};

const orderClass = {
    nuevo: 'state-nuevo',
    enviado_cocina: 'state-enviado',
    en_preparacion: 'state-preparacion',
    listo: 'state-listo',
    entregado: 'state-entregado',
    pendiente_pago: 'state-esperando',
    pagado: 'state-pagado',
    cancelado: 'state-cancelada',
};

const tableDot = {
    disponible: '#22C55E', ocupada: '#EF4444', esperando_pago: '#F59E0B',
    reservada: '#8B5CF6', inactiva: '#71717A',
};

const orderDot = {
    nuevo: '#3B82F6', enviado_cocina: '#F59E0B', en_preparacion: '#F59E0B',
    listo: '#3B82F6', entregado: '#0EA5E9', pendiente_pago: '#F59E0B',
    pagado: '#22C55E', cancelado: '#71717A',
};

export const StateBadge = ({ status, type = 'table', testId, className = '' }) => {
    const isTable = type === 'table';
    const labels = isTable ? TABLE_STATUS_LABELS : ORDER_STATUS_LABELS;
    const klass = isTable ? tableClass[status] : orderClass[status];
    const dotColor = isTable ? tableDot[status] : orderDot[status];
    return (
        <span
            data-testid={testId || `${type}-estado-badge`}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium border ${klass || ''} ${className}`}
        >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} data-testid={`${type}-estado-dot`} />
            {labels[status] || status}
        </span>
    );
};
