import { apiErrorMessage } from '@/lib/apiError';

const withDetail = (detail, status = 422) => ({ response: { status, data: { detail } } });

describe('apiErrorMessage', () => {
    it('returns a string detail as is', () => {
        expect(apiErrorMessage(withDetail('Mesa ocupada', 409), 'x')).toBe('Mesa ocupada');
    });

    it('turns a FastAPI 422 array into one readable sentence, never an object', () => {
        const message = apiErrorMessage(withDetail([
            { type: 'string_too_short', loc: ['body', 'password'], msg: 'String should have at least 8 characters', ctx: { min_length: 8 } },
        ]), 'x');
        expect(typeof message).toBe('string');
        expect(message).toBe('Contraseña: debe tener al menos 8 caracteres.');
        expect(message).not.toMatch(/object/i);
    });

    it('joins several entries', () => {
        const message = apiErrorMessage(withDetail([
            { type: 'missing', loc: ['body', 'email'], msg: 'Field required' },
            { type: 'string_too_long', loc: ['body', 'name'], msg: 'x', ctx: { max_length: 50 } },
            { type: 'greater_than_equal', loc: ['body', 'price'], msg: 'x', ctx: { ge: 0 } },
            { type: 'less_than_equal', loc: ['body', 'quantity'], msg: 'x', ctx: { le: 99 } },
        ]), 'x');
        expect(message).toBe(
            'Correo: es obligatorio. Nombre: debe tener como máximo 50 caracteres. '
            + 'Precio: debe ser como mínimo 0. Cantidad: debe ser como máximo 99.',
        );
    });

    it('falls back to a generic sentence for unknown entries', () => {
        const message = apiErrorMessage(withDetail([{ type: 'weird', loc: ['body', 'zzz'], msg: 'bad' }]), 'No se pudo guardar');
        expect(message).toBe('Zzz: valor no válido.');
    });

    it('uses the fallback when the array has no usable entry', () => {
        expect(apiErrorMessage(withDetail([]), 'No se pudo guardar')).toBe('No se pudo guardar');
    });

    it('reads message from an object detail', () => {
        expect(apiErrorMessage(withDetail({ code: 'x', message: 'Cuenta cambiada' }, 409), 'f')).toBe('Cuenta cambiada');
    });

    it('reports a network error when there is no response', () => {
        const message = apiErrorMessage(new Error('Network Error'), 'x');
        expect(message).toBe('Sin conexión con el servidor. Reintentar.');
    });

    it('uses the fallback for a response without detail', () => {
        expect(apiErrorMessage({ response: { status: 500, data: {} } }, 'No se pudo guardar')).toBe('No se pudo guardar');
    });

    it('survives null and undefined', () => {
        expect(apiErrorMessage(undefined, 'fb')).toBe('fb');
        expect(apiErrorMessage(null, 'fb')).toBe('fb');
    });
});
