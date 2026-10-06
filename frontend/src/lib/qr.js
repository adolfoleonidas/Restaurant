/**
 * Codificador QR mínimo (modelo 2), sin dependencias.
 *
 * El panel administrativo necesita dibujar el QR de cada mesa y el proyecto no
 * trae ninguna librería de QR. En vez de sumar un paquete (y su cadena de
 * dependencias) se implementa lo justo: modo byte, nivel de corrección M,
 * versiones 1–10 (hasta 271 caracteres), máscara elegida por penalty.
 *
 * La matriz que devuelve `qrMatrix` es un arreglo de arreglos de 0/1: la fila 0
 * es la de arriba. El llamador decide cómo pintarla (SVG, canvas, etc.).
 */

// Capacidad en codewords de datos por versión y nivel M (ISO/IEC 18004, tabla 7).
const DATA_CODEWORDS_M = { 1: 16, 2: 28, 3: 44, 4: 64, 5: 86, 6: 108, 7: 124, 8: 154, 9: 182, 10: 216 };
// Bloques [cantidad, codewords de datos por bloque, codewords de corrección por bloque].
const BLOCKS_M = {
    1: [[1, 16, 10]],
    2: [[1, 28, 16]],
    3: [[1, 44, 26]],
    4: [[2, 32, 18]],
    5: [[2, 43, 24]],
    6: [[4, 27, 16]],
    7: [[4, 31, 18]],
    8: [[2, 38, 22], [2, 39, 22]],
    9: [[3, 36, 22], [2, 37, 22]],
    10: [[4, 43, 26], [1, 44, 26]],
};
// Centro de los patrones de alineación por versión.
const ALIGNMENT_CENTERS = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// Tabla de Galois (GF(256), polinomio 0x11d).
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generatorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i += 1) {
        const next = new Array(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j += 1) {
            next[j] ^= poly[j];
            next[j + 1] ^= gfMul(poly[j], EXP[i]);
        }
        poly = next;
    }
    return poly;
}

function reedSolomon(data, ecLength) {
    const gen = generatorPoly(ecLength);
    const remainder = new Array(ecLength).fill(0);
    for (const byte of data) {
        const factor = byte ^ remainder[0];
        remainder.shift();
        remainder.push(0);
        for (let i = 0; i < ecLength; i += 1) {
            remainder[i] ^= gfMul(gen[i + 1], factor);
        }
    }
    return remainder;
}

function bytesOf(text) {
    // UTF-8: los identificadores de mesa son ASCII, pero el nombre del negocio
    // puede llevar tildes y no queremos romper el QR por eso.
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    return Array.from(unescape(encodeURIComponent(text))).map((ch) => ch.charCodeAt(0));
}

function pickVersion(byteLength) {
    for (let version = 1; version <= 10; version += 1) {
        const capacityBits = DATA_CODEWORDS_M[version] * 8;
        // 4 bits de modo + longitud (8 bits hasta la versión 9, 16 desde la 10).
        const lengthBits = version <= 9 ? 8 : 16;
        if (4 + lengthBits + byteLength * 8 <= capacityBits) return version;
    }
    throw new Error('El texto es demasiado largo para el QR (máximo 271 caracteres)');
}

function buildCodewords(bytes, version) {
    const bits = [];
    const push = (value, length) => {
        for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
    };
    push(0b0100, 4); // modo byte
    push(bytes.length, version <= 9 ? 8 : 16);
    for (const byte of bytes) push(byte, 8);

    const capacityBits = DATA_CODEWORDS_M[version] * 8;
    const terminator = Math.min(4, capacityBits - bits.length);
    push(0, terminator);
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
        codewords.push(byte);
    }
    // Relleno alternado 0xEC / 0x11 hasta completar la capacidad de datos.
    let padIndex = 0;
    while (codewords.length < DATA_CODEWORDS_M[version]) {
        codewords.push(padIndex % 2 === 0 ? 0xec : 0x11);
        padIndex += 1;
    }
    return codewords;
}

function interleave(codewords, version) {
    const groups = BLOCKS_M[version];
    const blocks = [];
    let offset = 0;
    for (const [count, dataLength, ecLength] of groups) {
        for (let i = 0; i < count; i += 1) {
            const data = codewords.slice(offset, offset + dataLength);
            offset += dataLength;
            blocks.push({ data, ec: reedSolomon(data, ecLength) });
        }
    }
    const out = [];
    const maxData = Math.max(...blocks.map((b) => b.data.length));
    for (let i = 0; i < maxData; i += 1) {
        for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
    }
    const ecLength = blocks[0].ec.length;
    for (let i = 0; i < ecLength; i += 1) {
        for (const block of blocks) if (i < block.ec.length) out.push(block.ec[i]);
    }
    return out;
}

function newMatrix(size) {
    const modules = [];
    const reserved = [];
    for (let i = 0; i < size; i += 1) {
        modules.push(new Array(size).fill(0));
        reserved.push(new Array(size).fill(false));
    }
    return { modules, reserved, size };
}

function placeFinder(grid, row, col) {
    for (let r = -1; r <= 7; r += 1) {
        for (let c = -1; c <= 7; c += 1) {
            const y = row + r;
            const x = col + c;
            if (y < 0 || x < 0 || y >= grid.size || x >= grid.size) continue;
            const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
            const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            grid.modules[y][x] = inRing || inCore ? 1 : 0;
            grid.reserved[y][x] = true;
        }
    }
}

function placeAlignment(grid, version) {
    const centers = ALIGNMENT_CENTERS[version];
    const last = centers[centers.length - 1];
    for (const row of centers) {
        for (const col of centers) {
            // Los tres centros de las esquinas ya los cubre el patrón de posición.
            if ((row === 6 && col === 6) || (row === 6 && col === last) || (row === last && col === 6)) continue;
            for (let r = -2; r <= 2; r += 1) {
                for (let c = -2; c <= 2; c += 1) {
                    const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
                    grid.modules[row + r][col + c] = dark ? 1 : 0;
                    grid.reserved[row + r][col + c] = true;
                }
            }
        }
    }
}

function placeTiming(grid) {
    for (let i = 8; i < grid.size - 8; i += 1) {
        const dark = i % 2 === 0 ? 1 : 0;
        grid.modules[6][i] = dark;
        grid.reserved[6][i] = true;
        grid.modules[i][6] = dark;
        grid.reserved[i][6] = true;
    }
}

// Zonas de formato y versión: se reservan ahora y se rellenan al final.
function reserveFixedAreas(grid, version) {
    for (let i = 0; i <= 8; i += 1) {
        grid.reserved[8][i] = true;
        grid.reserved[i][8] = true;
    }
    for (let i = 0; i < 8; i += 1) {
        grid.reserved[8][grid.size - 1 - i] = true;
        grid.reserved[grid.size - 1 - i][8] = true;
    }
    grid.modules[grid.size - 8][8] = 1; // módulo oscuro fijo
    grid.reserved[grid.size - 8][8] = true;
    if (version >= 7) {
        for (let i = 0; i < 6; i += 1) {
            for (let j = 0; j < 3; j += 1) {
                grid.reserved[grid.size - 11 + j][i] = true;
                grid.reserved[i][grid.size - 11 + j] = true;
            }
        }
    }
}

function placeData(grid, codewords) {
    const bits = [];
    for (const byte of codewords) {
        for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
    }
    let index = 0;
    let upward = true;
    for (let right = grid.size - 1; right > 0; right -= 2) {
        // La columna 6 es la barra de sincronización: se salta.
        if (right === 6) right = 5;
        for (let step = 0; step < grid.size; step += 1) {
            const row = upward ? grid.size - 1 - step : step;
            for (const col of [right, right - 1]) {
                if (grid.reserved[row][col]) continue;
                grid.modules[row][col] = index < bits.length ? bits[index] : 0;
                index += 1;
            }
        }
        upward = !upward;
    }
}

const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(grid, maskIndex) {
    const fn = MASKS[maskIndex];
    for (let row = 0; row < grid.size; row += 1) {
        for (let col = 0; col < grid.size; col += 1) {
            if (!grid.reserved[row][col] && fn(row, col)) {
                grid.modules[row][col] ^= 1;
            }
        }
    }
}

// Los 5 bits de datos del formato son nivel de corrección (2 bits) + máscara
// (3 bits), que en el nivel M quedan en las posiciones 0–2. Se protegen con un
// BCH(15,5) de resto de 10 bits y se enmascaran con 101010000010010: así el
// símbolo siempre empieza con `10`, que es lo que exige la norma.
function formatBits(maskIndex) {
    const data = (0b00 << 3) | maskIndex;
    let remainder = data << 10;
    for (let i = 14; i >= 10; i -= 1) {
        if ((remainder >> i) & 1) remainder ^= 0b10100110111 << (i - 10);
    }
    return (((data << 10) | (remainder & 0b1111111111)) ^ 0b101010000010010) & 0b111111111111111;
}

function versionBits(version) {
    let value = version << 12;
    for (let i = 17; i >= 12; i -= 1) {
        if ((value >> i) & 1) value ^= 0b1111100100101 << (i - 12);
    }
    return (version << 12) | value;
}

// Los 15 bits de formato van escritos en dos copias: una alrededor de la esquina
// superior izquierda y otra repartida entre la fila 8 (derecha) y la columna 8
// (abajo). El bit i es `(bits >> i) & 1`, con el bit 0 en la posición baja.
function formatBit(bits, index) {
    return (bits >> index) & 1;
}

function placeFormat(grid, maskIndex) {
    const bits = formatBits(maskIndex);
    const size = grid.size;
    for (let i = 0; i < 15; i += 1) {
        const bit = formatBit(bits, i);
        if (i < 6) grid.modules[i][8] = bit;
        else if (i < 8) grid.modules[i + 1][8] = bit;
        else grid.modules[size - 15 + i][8] = bit;
    }
    for (let i = 0; i < 15; i += 1) {
        const bit = formatBit(bits, i);
        if (i < 8) grid.modules[8][size - i - 1] = bit;
        else if (i < 9) grid.modules[8][15 - i] = bit;
        else grid.modules[8][15 - i - 1] = bit;
    }
    grid.modules[size - 8][8] = 1;
}

function placeVersionInfo(grid, version) {
    if (version < 7) return;
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
        const bit = (bits >> i) & 1;
        const row = Math.floor(i / 3);
        const col = i % 3;
        grid.modules[grid.size - 11 + col][row] = bit;
        grid.modules[row][grid.size - 11 + col] = bit;
    }
}

// Puntaje de máscara. La ISO/IEC 18004 describe la regla 1 como rachas de cinco
// o más módulos iguales; aquí se cuenta, como en las implementaciones clásicas
// (qrcodejs, qrcode-generator), cuántos vecinos de la ventana 3×3 comparten el
// color. La penalización resultante elige la misma máscara que esas librerías,
// así que la salida se puede comparar módulo a módulo contra ellas.
function penalty(grid) {
    const size = grid.size;
    const m = grid.modules;
    let score = 0;

    for (let r = 0; r < size; r += 1) {
        for (let c = 0; c < size; c += 1) {
            const dark = m[r][c];
            let neighbours = 0;
            for (let dr = -1; dr <= 1; dr += 1) {
                for (let dc = -1; dc <= 1; dc += 1) {
                    if (dr === 0 && dc === 0) continue;
                    const y = r + dr;
                    const x = c + dc;
                    if (y < 0 || y >= size || x < 0 || x >= size) continue;
                    if (m[y][x] === dark) neighbours += 1;
                }
            }
            if (neighbours > 5) score += 3 + neighbours - 5;
        }
    }

    // Regla 2: bloques 2×2 del mismo color.
    for (let r = 0; r < size - 1; r += 1) {
        for (let c = 0; c < size - 1; c += 1) {
            const block = m[r][c] + m[r + 1][c] + m[r][c + 1] + m[r + 1][c + 1];
            if (block === 0 || block === 4) score += 3;
        }
    }

    // Regla 3: patrón 1:1:3:1:1 con cuatro módulos claros a un lado.
    for (let r = 0; r < size; r += 1) {
        for (let c = 0; c <= size - 7; c += 1) {
            if (m[r][c] && !m[r][c + 1] && m[r][c + 2] && m[r][c + 3] && m[r][c + 4] && !m[r][c + 5] && m[r][c + 6]) score += 40;
        }
    }
    for (let c = 0; c < size; c += 1) {
        for (let r = 0; r <= size - 7; r += 1) {
            if (m[r][c] && !m[r + 1][c] && m[r + 2][c] && m[r + 3][c] && m[r + 4][c] && !m[r + 5][c] && m[r + 6][c]) score += 40;
        }
    }

    // Regla 4: proporción de módulos oscuros.
    let dark = 0;
    for (const row of m) for (const v of row) dark += v;
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
}

/**
 * Devuelve la matriz de módulos del QR (1 = oscuro) para el texto dado.
 * @param {string} text
 * @returns {number[][]}
 */
export function qrMatrix(text) {
    const value = String(text ?? '');
    if (!value) throw new Error('El QR necesita un texto');
    const bytes = bytesOf(value);
    const version = pickVersion(bytes.length);
    const size = version * 4 + 17;

    const base = newMatrix(size);
    placeFinder(base, 0, 0);
    placeFinder(base, 0, size - 7);
    placeFinder(base, size - 7, 0);
    placeAlignment(base, version);
    placeTiming(base);
    reserveFixedAreas(base, version);

    const codewords = interleave(buildCodewords(bytes, version), version);
    placeData(base, codewords);

    let best = null;
    let bestScore = Infinity;
    for (let maskIndex = 0; maskIndex < 8; maskIndex += 1) {
        const candidate = newMatrix(size);
        candidate.modules = base.modules.map((row) => row.slice());
        candidate.reserved = base.reserved;
        applyMask(candidate, maskIndex);
        placeFormat(candidate, maskIndex);
        placeVersionInfo(candidate, version);
        const score = penalty(candidate);
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    return best.modules;
}
