/**
 * NA-03: the interface has no motion.
 *
 * Decision of 2026-10-12: nothing in the app animates. No keyframes, no
 * transitions, no smooth scrolling and no script-driven animation. A pulsing
 * late-table border kept a low-end phone's main thread 98-99 % busy, composer
 * animations cost up to ~40 ms per tap, and library animations (Radix, sonner)
 * ran on every open and close.
 *
 * Visual states (hover, pressed, focus, selected, late) still exist; they
 * switch instantly. This guard scans the shipped source and fails on every way
 * of bringing motion back, so a regression is caught in review and not on a
 * waiter's phone. The only motion declaration allowed is the global safety rule
 * in src/index.css, which switches off whatever third-party or future markup
 * tries to animate.
 */
import fs from 'fs';
import path from 'path';

const FRONTEND = path.resolve(__dirname, '..', '..');
const SRC = path.join(FRONTEND, 'src');
const PUBLIC = path.join(FRONTEND, 'public');
const INDEX_CSS = path.join(SRC, 'index.css');
const TAILWIND_CONFIG = path.join(FRONTEND, 'tailwind.config.js');

// ── Files ──────────────────────────────────────────────────────────────────

const isTestFile = (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);

function walk(dir, accept) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '__tests__') files.push(...walk(full, accept));
        } else if (accept(entry.name)) {
            files.push(full);
        }
    }
    return files;
}

const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(FRONTEND, file).split(path.sep).join('/');

const cssFiles = [...walk(SRC, (n) => n.endsWith('.css')), ...walk(PUBLIC, (n) => n.endsWith('.css'))];
const htmlFiles = walk(PUBLIC, (n) => n.endsWith('.html'));
const scriptFiles = walk(SRC, (n) => /\.[cm]?[jt]sx?$/.test(n) && !isTestFile(n));

// ── Text preparation (comments may talk about motion, code may not) ───────

// Keeps line breaks so reported line numbers stay true.
const blank = (text) => text.replace(/[^\n]/g, ' ');
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, blank);
const stripHtmlComments = (text) => text.replace(/<!--[\s\S]*?-->/g, blank);
// `/*` right after a letter is a glob such as accept="image/*", not a comment.
const stripScriptComments = (text) => text
    .replace(/(^|[\s{(;,=])\/\*[\s\S]*?\*\//g, (match, lead) => lead + blank(match.slice(lead.length)))
    .replace(/(^|[\s;{}()])\/\/[^\n]*/gm, (match, lead) => lead + blank(match.slice(lead.length)));

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// ── The one allowed declaration ────────────────────────────────────────────

const SAFETY_RULE = /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{\s*animation\s*:\s*none\s*!important\s*;\s*transition\s*:\s*none\s*!important\s*;\s*scroll-behavior\s*:\s*auto\s*!important\s*;?\s*\}/g;

// ── Rules ──────────────────────────────────────────────────────────────────

const CSS_RULES = [
    ['keyframes', /@(?:-webkit-)?keyframes\b/],
    ['animation declaration', /(?:^|[;{\s])(?:-webkit-)?animation(?:-[a-z-]+)?\s*:/],
    ['transition declaration', /(?:^|[;{\s])(?:-webkit-)?transition(?:-[a-z-]+)?\s*:/],
    ['scroll-behavior declaration', /(?:^|[;{\s])scroll-behavior\s*:/],
    ['motion token', /--(?:transition|animation|duration|easing|ease)(?:-[a-z0-9-]+)?\s*:/],
];

const UTILITY_CHARS = '[\\w[\\]%.,/()-]*';
const SCRIPT_RULES = [
    ['animate utility', new RegExp(`(?<![\\w-])animate-${UTILITY_CHARS}`)],
    ['transition utility', new RegExp(`(?<![\\w-])transition(?:-${UTILITY_CHARS})?(?![\\w-])`)],
    ['duration utility', new RegExp(`(?<![\\w-])duration-(?:\\d|\\[)${UTILITY_CHARS}`)],
    ['ease utility', new RegExp(`(?<![\\w-])ease-(?:in|out|linear|\\[)${UTILITY_CHARS}`)],
    ['delay utility', new RegExp(`(?<![\\w-])delay-(?:\\d|\\[)${UTILITY_CHARS}`)],
    ['enter/exit effect utility', new RegExp(`(?<![\\w-])(?:fade|zoom|slide|spin)-(?:in|out)(?:-${UTILITY_CHARS})?(?![\\w-])`)],
    ['pressed move or scale utility', /(?<![\w-])(?:group-|peer-)?active:-?(?:scale|translate|rotate)-/],
    ['inline animation style', /(?<![\w-])animation(?:[A-Z]\w*)?\s*:/],
    ['inline transition style', /(?<![\w-])transition(?:[A-Z]\w*)?\s*:/],
    ['smooth scrolling', /behavior\s*:\s*['"`]smooth['"`]/],
    ['scroll-smooth utility', /(?<![\w-])scroll-smooth(?![\w-])/],
    ['element.animate()', /\.animate\(/],
    ['animation library', /(?:from\s+|require\(\s*)['"](?:framer-motion|motion(?:\/react)?|react-spring|@react-spring\/[\w-]+|gsap|animejs|popmotion|lottie-react|lottie-web|react-transition-group|react-smooth)['"]/],
];

const TAILWIND_RULES = [
    ['tailwindcss-animate plugin', /tailwindcss-animate/],
    ['keyframes extension', /\bkeyframes\s*:/],
    ['animation extension', /\banimation\s*:/],
    ['transition extension', /\btransition(?:Property|Duration|TimingFunction|Delay)\s*:/],
];

// recharts animates bars, slices, lines and the tooltip from script, so the
// global CSS rule cannot reach it: every animated part must opt out.
const ANIMATED_CHART_PARTS = ['Bar', 'Pie', 'Line', 'Area', 'Radar', 'RadialBar', 'Scatter', 'Funnel', 'Treemap', 'Sankey', 'Tooltip', 'ErrorBar'];

// ── Scanners ───────────────────────────────────────────────────────────────

function scan(rules, text, file) {
    const hits = [];
    for (const [rule, pattern] of rules) {
        const re = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g');
        let match = re.exec(text);
        while (match) {
            hits.push({ file, line: lineOf(text, match.index), rule, text: match[0].trim() });
            if (match[0].length === 0) re.lastIndex += 1;
            match = re.exec(text);
        }
    }
    return hits;
}

// An `:active` rule that moves, scales or rotates is pressed feedback with motion.
function pressedTransforms(text, file) {
    const hits = [];
    const block = /([^{}]+)\{([^{}]*)\}/g;
    let match = block.exec(text);
    while (match) {
        if (/:active\b/.test(match[1]) && /(?:^|[;\s])(?:transform|scale|translate|rotate)\s*:/.test(match[2])) {
            hits.push({ file, line: lineOf(text, match.index + match[0].indexOf('{')), rule: 'pressed move or scale rule', text: match[1].trim().replace(/\s+/g, ' ') });
        }
        match = block.exec(text);
    }
    return hits;
}

// Opening JSX tags, tolerant of `=>` and nested braces inside attributes.
function openingTags(text, names) {
    const tags = [];
    const start = new RegExp(`<(${names.join('|')})(?=[\\s/>])`, 'g');
    let match = start.exec(text);
    while (match) {
        let depth = 0;
        let quote = null;
        let end = match.index + match[0].length;
        for (; end < text.length; end += 1) {
            const ch = text[end];
            if (quote) {
                if (ch === quote && text[end - 1] !== '\\') quote = null;
            } else if (ch === '"' || ch === "'" || ch === '`') {
                quote = ch;
            } else if (ch === '{') {
                depth += 1;
            } else if (ch === '}') {
                depth -= 1;
            } else if (ch === '>' && depth === 0) {
                break;
            }
        }
        tags.push({ name: match[1], index: match.index, text: text.slice(match.index, end + 1) });
        match = start.exec(text);
    }
    return tags;
}

function animatedCharts(text, file) {
    if (!/from\s+['"]recharts['"]/.test(text)) return [];
    return openingTags(text, ANIMATED_CHART_PARTS)
        .filter((tag) => !/isAnimationActive=\{false\}/.test(tag.text))
        .map((tag) => ({ file, line: lineOf(text, tag.index), rule: 'recharts animation', text: tag.text.replace(/\s+/g, ' ') }));
}

function cssViolations(file, raw) {
    const text = stripCssComments(raw).replace(SAFETY_RULE, blank);
    return [...scan(CSS_RULES, text, file), ...pressedTransforms(text, file)];
}

function scriptViolations(file, raw) {
    const text = stripScriptComments(raw);
    return [...scan(SCRIPT_RULES, text, file), ...animatedCharts(text, file)];
}

function expectNone(hits, what) {
    if (hits.length === 0) return;
    const lines = hits.map((h) => `${h.file}:${h.line}  [${h.rule}]  ${h.text.slice(0, 70)}`);
    const shown = lines.slice(0, 15).join('\n  ');
    const more = lines.length > 15 ? `\n  ... and ${lines.length - 15} more` : '';
    throw new Error(`${what}\n${hits.length} violation(s) in ${new Set(hits.map((h) => h.file)).size} file(s):\n  ${shown}${more}`);
}

// ── The guard ──────────────────────────────────────────────────────────────

describe('no motion (NA-03)', () => {
    it('really scans the app: stylesheets, pages, components and the static pages, but no tests', () => {
        expect(cssFiles).toContain(INDEX_CSS);
        expect(cssFiles.map(rel)).toEqual(expect.arrayContaining([
            'src/styles/cobro.css', 'src/styles/tokens.css', 'public/themes/theme-fresco.css',
        ]));
        expect(htmlFiles.map(rel)).toContain('public/theme-preview.html');
        expect(scriptFiles.map(rel)).toEqual(expect.arrayContaining([
            'src/components/MesaCard.jsx', 'src/components/ui/dialog.jsx', 'src/pages/Reportes.jsx',
        ]));
        expect(scriptFiles.length).toBeGreaterThan(150);
        expect(scriptFiles.some((file) => rel(file).includes('__tests__'))).toBe(false);
    });

    it('keeps exactly one global safety rule, in src/index.css', () => {
        const count = (file) => (stripCssComments(read(file)).match(SAFETY_RULE) || []).length;
        expect(count(INDEX_CSS)).toBe(1);
        const elsewhere = cssFiles.filter((f) => f !== INDEX_CSS && count(f) > 0).map(rel);
        expect(elsewhere).toEqual([]);
    });

    it('declares no keyframes, animation, transition or scroll-behavior in CSS beyond the safety rule', () => {
        expectNone(cssFiles.flatMap((file) => cssViolations(rel(file), read(file))), 'CSS must not animate:');
    });

    it('declares no motion in the static HTML pages', () => {
        const hits = htmlFiles.flatMap((file) => cssViolations(rel(file), stripHtmlComments(read(file))));
        expectNone(hits, 'Static HTML must not animate:');
    });

    it('uses no motion utility, inline style, smooth scrolling or animation library in the app', () => {
        expectNone(scriptFiles.flatMap((file) => scriptViolations(rel(file), read(file))), 'Markup and scripts must not animate:');
    });

    it('defines no motion in the Tailwind config', () => {
        const text = stripScriptComments(read(TAILWIND_CONFIG));
        expectNone(scan(TAILWIND_RULES, text, rel(TAILWIND_CONFIG)), 'tailwind.config.js must not add motion:');
    });

    it('keeps tests out of the Tailwind content scan, so the class names they quote emit no CSS', () => {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const { content } = require(TAILWIND_CONFIG);
        expect(content).toEqual(expect.arrayContaining(['!./src/**/__tests__/**', '!./src/**/*.{test,spec}.{js,jsx,ts,tsx}']));
    });
});

// ── The scanner itself: a guard that never matches guards nothing ─────────

describe('no motion scanner', () => {
    const scriptRules = (code) => scriptViolations('sample.jsx', code).map((h) => h.rule);
    const cssRules = (code) => cssViolations('sample.css', code).map((h) => h.rule);

    it.each([
        ['<div className="flex transition-colors hover:bg-muted" />', 'transition utility'],
        ['<div className={`p-2 transition ${on ? "a" : "b"}`} />', 'transition utility'],
        ['<div className="data-[state=open]:animate-in" />', 'animate utility'],
        ['<Icon className="h-4 w-4 animate-spin" />', 'animate utility'],
        ['<div className="data-[state=closed]:fade-out-0" />', 'enter/exit effect utility'],
        ['<div className="data-[side=top]:slide-in-from-bottom-2" />', 'enter/exit effect utility'],
        ['<div className="zoom-in-95" />', 'enter/exit effect utility'],
        ['<div className="p-4 duration-200" />', 'duration utility'],
        ['<div className="data-[state=open]:duration-500" />', 'duration utility'],
        ['<div className="ease-in-out" />', 'ease utility'],
        ['<div className="delay-150" />', 'delay utility'],
        ['<button className="active:scale-[0.98]" />', 'pressed move or scale utility'],
        ['<button className="sm:active:scale-95" />', 'pressed move or scale utility'],
        ['<button className="group-active:translate-y-px" />', 'pressed move or scale utility'],
        ["<div style={{ transition: 'opacity .2s' }} />", 'inline transition style'],
        ["<div style={{ transitionDelay: '1s' }} />", 'inline transition style'],
        ["<div style={{ animation: 'spin 1s linear infinite' }} />", 'inline animation style'],
        ["window.scrollTo({ top: 0, behavior: 'smooth' });", 'smooth scrolling'],
        ['<html className="scroll-smooth" />', 'scroll-smooth utility'],
        ['node.animate([{ opacity: 0 }, { opacity: 1 }], 200);', 'element.animate()'],
        ["import { motion } from 'framer-motion';", 'animation library'],
    ])('flags %s', (code, rule) => {
        expect(scriptRules(code)).toContain(rule);
    });

    it.each([
        '<div className="hover:bg-secondary active:bg-secondary focus-visible:ring-2" />',
        "toast.success('Listo', { duration: 8000 });",
        "window.scrollTo({ top: 0, behavior: 'instant' });",
        '<input type="file" accept="image/*" className="w-full" />',
        '<div className="data-[state=open]:bg-accent translate-x-5" />',
        '// transition-colors was removed on purpose\nconst a = 1;',
        '/* animate-pulse is gone */\nconst b = 2;',
        '{/* duration-200 is gone */}',
        '<div data-testid="public-cover-skeleton" className="bg-secondary/50" />',
    ])('lets %s through', (code) => {
        expect(scriptRules(code)).toEqual([]);
    });

    it.each([
        ['.a { transition: opacity .2s; }', 'transition declaration'],
        ['.a { -webkit-transition: all 1s; }', 'transition declaration'],
        ['.a { transition-property: color; }', 'transition declaration'],
        ['.a { animation: spin 1s infinite; }', 'animation declaration'],
        ['.a { animation-delay: 1s; }', 'animation declaration'],
        ['@keyframes spin { to { opacity: 1; } }', 'keyframes'],
        ['html { scroll-behavior: smooth; }', 'scroll-behavior declaration'],
        [':root { --transition-fast: 150ms; }', 'motion token'],
        ['.b:active { transform: scale(.97); }', 'pressed move or scale rule'],
        ['@media (min-width: 1px) { .b:active { transform: translateY(1px); } }', 'pressed move or scale rule'],
    ])('flags CSS %s', (css, rule) => {
        expect(cssRules(css)).toContain(rule);
    });

    it.each([
        '.b:active { background: red; border-color: blue; }',
        'body { overscroll-behavior-y: none; }',
        '/* animation: none; transition: none; */ .a { color: red; }',
        '.a { transform: translateY(-50%); }',
        '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }',
    ])('lets CSS %s through', (css) => {
        expect(cssRules(css)).toEqual([]);
    });

    it('flags recharts parts that do not switch their animation off', () => {
        const chart = (inner) => `import { BarChart, Bar, Tooltip } from 'recharts';\nconst C = () => (<BarChart>${inner}</BarChart>);`;
        const flagged = (inner) => scriptRules(chart(inner)).filter((r) => r === 'recharts animation');
        expect(flagged('<Bar dataKey="a" />')).toHaveLength(1);
        expect(flagged('<Tooltip formatter={(v) => fmtMoney(v)} />')).toHaveLength(1);
        expect(flagged('<Bar dataKey="a" fill="#000"\n radius={[6, 6, 0, 0]} />')).toHaveLength(1);
        expect(flagged('<Bar dataKey="a" isAnimationActive={false} />')).toHaveLength(0);
        expect(flagged('<Tooltip formatter={(v) => fmtMoney(v)} isAnimationActive={false} />')).toHaveLength(0);
        // `<BarChart>` is a container, not an animated part.
        expect(flagged('')).toHaveLength(0);
        // Files that do not use recharts are not its business.
        expect(scriptRules('const t = <Tooltip content="x" />;')).toEqual([]);
    });
});
