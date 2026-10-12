/**
 * Turns whatever the API (or the network) returned into one readable sentence.
 * FastAPI answers 422 with an array of `{ type, loc, msg, ctx }`; rendering that
 * raw crashes React, so every error path goes through this helper.
 */

const NETWORK_MESSAGE = 'Sin conexión con el servidor. Reintentar.';

const FIELD_LABELS = {
    password: 'Contraseña',
    email: 'Correo',
    name: 'Nombre',
    full_name: 'Nombre',
    username: 'Usuario',
    phone: 'Teléfono',
    price: 'Precio',
    quantity: 'Cantidad',
    amount: 'Monto',
    total: 'Total',
    notes: 'Notas',
    note: 'Nota',
    description: 'Descripción',
    address: 'Dirección',
    role: 'Rol',
    category_id: 'Categoría',
    product_id: 'Producto',
    table_id: 'Mesa',
    branch_id: 'Sucursal',
    method: 'Método de pago',
    number: 'Número',
    capacity: 'Capacidad',
    tip: 'Propina',
    discount: 'Descuento',
};

const SKIPPED_LOC = new Set(['body', 'query', 'path', 'header', 'cookie']);

const humanize = (key) => {
    const text = String(key).replace(/_/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

const fieldLabel = (loc) => {
    if (!Array.isArray(loc)) return '';
    const parts = loc.filter((part) => !SKIPPED_LOC.has(part) && typeof part !== 'number');
    const key = parts[parts.length - 1];
    if (key === undefined) return '';
    return FIELD_LABELS[key] || humanize(key);
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const describeProblem = (entry) => {
    const ctx = entry.ctx || {};
    switch (entry.type) {
        case 'missing':
            return 'es obligatorio';
        case 'string_too_short':
            return `debe tener al menos ${ctx.min_length} caracteres`;
        case 'string_too_long':
            return `debe tener como máximo ${ctx.max_length} caracteres`;
        case 'greater_than_equal':
            return `debe ser como mínimo ${firstDefined(ctx.ge, ctx.limit_value)}`;
        case 'greater_than':
            return `debe ser mayor que ${firstDefined(ctx.gt, ctx.limit_value)}`;
        case 'less_than_equal':
            return `debe ser como máximo ${firstDefined(ctx.le, ctx.limit_value)}`;
        case 'less_than':
            return `debe ser menor que ${firstDefined(ctx.lt, ctx.limit_value)}`;
        default:
            return 'valor no válido';
    }
};

const describeEntry = (entry) => {
    if (typeof entry === 'string') return entry.trim();
    if (!entry || typeof entry !== 'object') return '';
    const label = fieldLabel(entry.loc);
    const problem = describeProblem(entry);
    if (!label) return problem.charAt(0).toUpperCase() + problem.slice(1);
    return `${label}: ${problem}`;
};

const asSentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);

const isNetworkError = (error) => Boolean(error) && (
    Boolean(error.request)
    || error.code === 'ERR_NETWORK'
    || error.code === 'ECONNABORTED'
    || /network error|timeout/i.test(String(error.message || ''))
);

export function apiErrorMessage(error, fallback) {
    const response = error && error.response;
    if (!response) {
        return isNetworkError(error) ? NETWORK_MESSAGE : fallback;
    }
    const detail = response.data && response.data.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (Array.isArray(detail)) {
        const sentences = detail.map(describeEntry).filter(Boolean).map(asSentence);
        return sentences.length ? sentences.join(' ') : fallback;
    }
    if (detail && typeof detail === 'object' && typeof detail.message === 'string' && detail.message.trim()) {
        return detail.message;
    }
    return fallback;
}
