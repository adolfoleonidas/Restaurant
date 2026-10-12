/**
 * WCAG contrast of the design tokens. Reads the real CSS (index.css and every
 * theme in public/themes) so a token change that breaks readability fails here.
 *   text >= 4.5:1 (AA), focus ring >= 3:1 (non-text contrast).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const FILES = [
    path.join(ROOT, 'src', 'index.css'),
    ...fs.readdirSync(path.join(ROOT, 'public', 'themes'))
        .filter((name) => /^theme-.*\.css$/.test(name))
        .map((name) => path.join(ROOT, 'public', 'themes', name)),
];

function hslToRgb(h, s, l) {
    const sat = s / 100;
    const light = l / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
}

const luminance = ([r, g, b]) => {
    const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export const ratio = (fg, bg) => {
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
};

function parse(file) {
    const text = fs.readFileSync(file, 'latin1');
    const blocks = { root: {}, dark: {} };
    for (const match of text.matchAll(/(:root|\.dark)\s*\{([\s\S]*?)\n\s*\}/g)) {
        const target = match[1] === ':root' ? blocks.root : blocks.dark;
        for (const variable of match[2].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) target[variable[1]] = variable[2].trim();
    }
    return blocks;
}

function colour(value) {
    const m = /(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/.exec(value || '');
    return m ? hslToRgb(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

const NAME = (file) => path.basename(file);

describe.each(FILES.map((file) => [NAME(file), file]))('%s dark mode', (_name, file) => {
    const { root, dark } = parse(file);
    const tokens = { ...root, ...dark };
    const get = (key) => colour(tokens[key]);
    const surfaces = ['background', 'card'];

    it('has an AA muted text colour on every surface', () => {
        if (!dark['muted-foreground']) return;
        [...surfaces, 'muted'].forEach((surface) => {
            expect(ratio(get('muted-foreground'), get(surface))).toBeGreaterThanOrEqual(4.5);
        });
    });

    it('has AA destructive text on the page and on cards, and readable text on the destructive fill', () => {
        if (!dark.destructive) return;
        surfaces.forEach((surface) => {
            expect(ratio(get('destructive'), get(surface))).toBeGreaterThanOrEqual(4.5);
        });
        expect(ratio(get('destructive-foreground'), get('destructive'))).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the focus ring at 3:1 or better', () => {
        if (!dark.ring) return;
        surfaces.forEach((surface) => {
            expect(ratio(get('ring'), get(surface))).toBeGreaterThanOrEqual(3);
        });
    });

    it('has AA success text when the theme defines it', () => {
        if (!dark.green || !colour(dark.green)) return;
        surfaces.forEach((surface) => {
            expect(ratio(colour(dark.green), get(surface))).toBeGreaterThanOrEqual(4.5);
        });
        if (colour(dark['green-soft'])) {
            expect(ratio(colour(dark.green), colour(dark['green-soft']))).toBeGreaterThanOrEqual(4.5);
        }
    });
});

describe('light mode focus ring', () => {
    it.each(FILES.map((file) => [NAME(file), file]))('%s', (_name, file) => {
        const { root } = parse(file);
        if (!root.ring) return;
        ['background', 'card'].forEach((surface) => {
            expect(ratio(colour(root.ring), colour(root[surface]))).toBeGreaterThanOrEqual(3);
        });
    });
});

describe('one focus ring for links and card buttons', () => {
    it('index.css declares a shared :focus-visible rule on the ring token', () => {
        const css = fs.readFileSync(path.join(ROOT, 'src', 'index.css'), 'utf8');
        expect(css).toMatch(/:focus-visible[\s\S]{0,120}\{[^}]*outline:[^;}]*hsl\(var\(--ring\)\)/);
    });
});
