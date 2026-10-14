/**
 * Nada de desenfoque de fondo en las barras.
 *
 * `backdrop-filter: blur()` obliga al navegador a recomponer la capa cada vez que
 * algo cambia detrás del elemento. En una laptop no se nota; en la GPU de un
 * celular de gama baja es de lo más caro que hay, y estas barras son fijas o
 * pegajosas: se repintan con cada toque.
 *
 * Se midió en el Salón, en el teléfono del local: en horizontal (≥820 px, donde
 * las reglas de escritorio apagan el efecto) los toques eran instantáneos; en
 * vertical, donde el efecto vive, se demoraban. Y el efecto casi no se veía: esas
 * barras son 90-95 % opacas (`bg-background/95`, `bg-card/95`).
 *
 * Es el mismo tipo de costo que ya se quitó con `NoMotion.test.js` (animaciones
 * que dejaban el hilo principal al 98 % en un teléfono flojo). Este guard escanea
 * el código que se publica y falla en cuanto el desenfoque vuelve, para que la
 * regresión se vea en revisión y no en el celular de un mozo.
 *
 * Si algún día hace falta de verdad —sobre una superficie translúcida, donde sí
 * se vea—, se justifica aquí y se añade la excepción a conciencia.
 */
import fs from 'fs';
import path from 'path';

const FRONTEND = path.resolve(__dirname, '..', '..');
const SRC = path.join(FRONTEND, 'src');

const isTestFile = (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);

function walk(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '__tests__') files.push(...walk(full));
        } else if (entry.name.endsWith('.css') || /\.[cm]?[jt]sx?$/.test(entry.name)) {
            files.push(full);
        }
    }
    return files;
}

const rel = (file) => path.relative(FRONTEND, file).split(path.sep).join('/');

/** La mención en un comentario no cuenta: aquí se explica la regla. */
const isComment = (line) => {
    const text = line.trim();
    return text.startsWith('//') || text.startsWith('*') || text.startsWith('/*');
};

const BACKDROP_BLUR = /backdrop-blur|backdrop-filter/;

/** Cada lugar del código publicado que trae el desenfoque, como `archivo:línea`. */
function backdropBlurOffenders() {
    const found = [];
    for (const file of walk(SRC)) {
        if (isTestFile(file)) continue;
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
            if (!isComment(line) && BACKDROP_BLUR.test(line)) found.push(`${rel(file)}:${index + 1}`);
        });
    }
    return found;
}

describe('sin desenfoque de fondo en las barras', () => {
    it('ninguna barra fija o pegajosa lo usa', () => {
        expect(backdropBlurOffenders()).toEqual([]);
    });
});

describe('el detector reconoce lo que tiene que reconocer', () => {
    it('encuentra las formas en que vuelve', () => {
        expect(BACKDROP_BLUR.test('className="fixed bottom-0 z-40 bg-card/95 backdrop-blur"')).toBe(true);
        expect(BACKDROP_BLUR.test('backdrop-blur-md')).toBe(true);
        expect(BACKDROP_BLUR.test('min-[820px]:backdrop-blur-none')).toBe(true);
        expect(BACKDROP_BLUR.test('backdrop-filter: blur(8px);')).toBe(true);
    });

    it('no confunde una barra opaca con una desenfocada', () => {
        expect(BACKDROP_BLUR.test('className="fixed bottom-0 z-40 bg-background/95 border-t"')).toBe(false);
        expect(BACKDROP_BLUR.test('background-color: hsl(var(--card) / 0.95);')).toBe(false);
    });

    it('ignora lo que se explica en un comentario', () => {
        expect(isComment('// Sin desenfoque a propósito: era backdrop-filter: blur()')).toBe(true);
        expect(isComment(' * backdrop-blur costaba la GPU entera')).toBe(true);
        expect(isComment('className="backdrop-blur"')).toBe(false);
    });
});
