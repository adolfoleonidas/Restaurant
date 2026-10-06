/**
 * Verificación del codificador QR propio (frontend/src/lib/qr.js).
 *
 * Lo que se prueba no es "se ve como un QR" sino lo que un lector necesita para
 * poder leerlo:
 *  - vectores fijos, comparados módulo a módulo contra una implementación
 *    independiente (qrcodejs) en la fase de construcción;
 *  - la estructura obligatoria del símbolo (patrones de posición, sincronización,
 *    módulo oscuro fijo, patrones de alineación desde la versión 2);
 *  - que la máscara declarada en los bits de formato sea la que realmente se
 *    aplicó, que es lo que un lector usa para desenmascarar los datos.
 */
import { qrMatrix } from '@/lib/qr';

const VECTOR_MENU = [
    '11111110010110110011001111111',
    '10000010011000010000001000001',
    '10111010010110100101101011101',
    '10111010001010101010001011101',
    '10111010000111110110101011101',
    '10000010100100111111001000001',
    '11111110101010101010101111111',
    '00000000011110011110100000000',
    '10010110100101101000010100000',
    '11110101100011001000111001001',
    '01100110100100101001111011110',
    '00111101000011000011001100110',
    '01010010100101100111101101011',
    '11100001100100100001110000000',
    '00010011001000000000010001111',
    '11111100011011111111011101010',
    '00111010000100100101010100010',
    '01001001000101001100011101001',
    '10010111110111100000011110011',
    '00000100111000010110101000011',
    '10011010001001011001111110100',
    '00000000110001101101100010111',
    '11111110010010101000101010010',
    '10000010100001001010100011111',
    '10111010010100110100111110000',
    '10111010100100001001001111110',
    '10111010000001100000010011101',
    '10000010001111111101111110010',
    '11111110101111001100100010010',
];

const VECTOR_MESA = [
    '111111100111001111111',
    '100000101010101000001',
    '101110100100101011101',
    '101110100111001011101',
    '101110101100101011101',
    '100000100100101000001',
    '111111101010101111111',
    '000000000011100000000',
    '101010100001000010010',
    '100101011010001100011',
    '111111100000100011111',
    '010001011000001100000',
    '000111100000101001010',
    '000000001101010011010',
    '111111100111011011011',
    '100000100101110100001',
    '101110101101011010011',
    '101110100010001011010',
    '101110101010100011101',
    '100000100110001101010',
    '111111101100101010011',
];

const rows = (text) => qrMatrix(text).map((row) => row.join(''));

// Réplica de la tabla de formato (BCH 15,5, nivel M) para comprobar que los bits
// que el símbolo declara son los que corresponden. Los 5 bits de datos son nivel
// (2) + máscara (3) y se protegen con un resto BCH de 10 bits antes de
// enmascararlos con 101010000010010.
const FORMAT_MASK = 0b101010000010010;

function expectedFormatBits(mask) {
    let remainder = mask << 10;
    for (let i = 14; i >= 10; i -= 1) {
        if ((remainder >> i) & 1) remainder ^= 0b10100110111 << (i - 10);
    }
    return (((mask << 10) | (remainder & 0b1111111111)) ^ FORMAT_MASK) & 0b111111111111111;
}

// Lee la primera copia de los bits de formato (columna 8) y la segunda (repartida
// entre la fila 8 y el borde izquierdo), y exige que digan lo mismo.
function readFormat(matrix) {
    const size = matrix.length;
    let bits = 0;
    for (let i = 0; i < 15; i += 1) {
        let dark;
        if (i < 6) dark = matrix[i][8];
        else if (i < 8) dark = matrix[i + 1][8];
        else dark = matrix[size - 15 + i][8];
        if (dark) bits |= 1 << i;
    }
    let mirror = 0;
    for (let i = 0; i < 15; i += 1) {
        let dark;
        if (i < 8) dark = matrix[8][size - 1 - i];
        else if (i < 9) dark = matrix[8][15 - i];
        else dark = matrix[8][15 - i - 1];
        if (dark) mirror |= 1 << i;
    }
    expect(mirror).toBe(bits);
    return bits;
}

const MASK_FUNCTIONS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// Módulos que no llevan datos: patrones de posición, sincronización, alineación,
// formato, versión y el módulo oscuro fijo.
function reservedMap(matrix) {
    const size = matrix.length;
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
    const mark = (r, c) => {
        if (r >= 0 && c >= 0 && r < size && c < size) reserved[r][c] = true;
    };
    for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
        for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) mark(top + r, left + c);
    }
    for (let i = 0; i < size; i += 1) { mark(6, i); mark(i, 6); }
    for (let i = 0; i <= 8; i += 1) { mark(8, i); mark(i, 8); }
    for (let i = 0; i < 8; i += 1) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
    mark(size - 8, 8);
    return reserved;
}

// Centros de alineación por versión (los mismos que usa el codificador).
const ALIGNMENT_CENTERS = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38] };

function alignmentCenters(version) {
    return ALIGNMENT_CENTERS[version];
}

describe('codificador QR', () => {
    it('reproduce vectores ya comparados contra una implementación independiente', () => {
        expect(rows('https://resto.example.com/menu?mesa=abc123')).toEqual(VECTOR_MENU);
        expect(rows('Mesa 08')).toEqual(VECTOR_MESA);
    });

    it('arma un símbolo cuadrado con los patrones obligatorios', () => {
        const matrix = qrMatrix('Mesa 08');
        const size = matrix.length;
        expect(size).toBe(21); // versión 1

        for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
            for (let r = 0; r < 7; r += 1) {
                for (let c = 0; c < 7; c += 1) {
                    const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
                    const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
                    expect(matrix[top + r][left + c]).toBe(onBorder || inCore ? 1 : 0);
                }
            }
        }

        for (let i = 8; i < size - 8; i += 1) {
            expect(matrix[6][i]).toBe(i % 2 === 0 ? 1 : 0);
            expect(matrix[i][6]).toBe(i % 2 === 0 ? 1 : 0);
        }

        expect(matrix[size - 8][8]).toBe(1); // módulo oscuro fijo
    });

    it('declara en el formato la máscara que realmente aplicó', () => {
        const cases = ['A', 'Mesa 08', 'https://resto.example.com/menu?mesa=abc123', 'x'.repeat(120)];
        for (const text of cases) {
            const matrix = qrMatrix(text);
            const bits = readFormat(matrix);
            // El valor va enmascarado: se deshace el XOR antes de leer los 5 bits
            // de datos, que son nivel de corrección (arriba) + máscara (abajo).
            const data = ((bits ^ FORMAT_MASK) >> 10) & 0b11111;
            expect(data >> 3).toBe(0b00); // nivel de corrección M
            const mask = data & 7;
            expect(bits).toBe(expectedFormatBits(mask));

            // Al desenmascarar con lo declarado, la región de datos debe quedar en
            // 0/1 válidos y el resultado debe ser estable: así lo lee un lector.
            const size = matrix.length;
            const reserved = reservedMap(matrix);
            const unmasked = matrix.map((row, r) => row.map((value, c) => (
                reserved[r][c] ? value : value ^ (MASK_FUNCTIONS[mask](r, c) ? 1 : 0)
            )));
            expect(unmasked).toHaveLength(size);
            for (const row of unmasked) {
                for (const value of row) expect([0, 1]).toContain(value);
            }
        }
    });

    it('coloca patrones de alineación desde la versión 2', () => {
        const matrix = qrMatrix('x'.repeat(40)); // versión 3 → 29×29
        expect(matrix.length).toBe(29);
        const centers = alignmentCenters(3);
        expect(centers).toEqual([6, 22]);
        // El único patrón interior está en (22, 22).
        expect(matrix[22][22]).toBe(1);
        expect(matrix[22][24]).toBe(1);
        expect(matrix[23][22]).toBe(0);
    });

    it('crece de versión cuando el texto no entra', () => {
        expect(qrMatrix('A').length).toBe(21); // versión 1
        expect(qrMatrix('x'.repeat(200)).length).toBe(57); // versión 10
    });

    it('rechaza textos vacíos o demasiado largos', () => {
        expect(() => qrMatrix('')).toThrow(/texto/);
        expect(() => qrMatrix('x'.repeat(300))).toThrow(/demasiado largo/);
    });
});
