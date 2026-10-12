/**
 * Every visible label of a field must be tied to it (htmlFor/id) so that a screen
 * reader announces the field name and a click on the label focuses the field.
 * A label that wraps its control is already associated and is not flagged.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === 'ui') return [];
            return sourceFiles(full);
        }
        return /\.jsx$/.test(entry.name) ? [full] : [];
    });
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

describe('field labels', () => {
    const offenders = [];
    sourceFiles(SRC).forEach((file) => {
        const text = fs.readFileSync(file, 'utf8');
        // <Label ...> without htmlFor
        for (const match of text.matchAll(/<Label(?![A-Za-z])(?![^>]*htmlFor)[^>]*>/g)) {
            offenders.push(`${path.relative(SRC, file)}:${lineOf(text, match.index)} <Label> without htmlFor`);
        }
        // <label ...>plain text or expression only</label> that does not wrap a control
        for (const match of text.matchAll(/<label(?![^>]*htmlFor)([^>]*)>([^<]*(?:<(?:span|small|strong)[^>]*>[^<]*<\/(?:span|small|strong)>[^<]*)*)<\/label>/g)) {
            offenders.push(`${path.relative(SRC, file)}:${lineOf(text, match.index)} <label> without htmlFor`);
        }
    });

    it('has no unassociated labels', () => {
        expect(offenders).toEqual([]);
    });
});
