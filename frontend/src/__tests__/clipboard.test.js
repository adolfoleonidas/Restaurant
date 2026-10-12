import { copyToClipboard } from '@/lib/clipboard';

const setClipboard = (value) => {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
};

afterEach(() => {
    setClipboard(undefined);
    delete document.execCommand;
    document.body.innerHTML = '';
});

describe('copyToClipboard', () => {
    test('uses the async clipboard when it is available', async () => {
        const writeText = jest.fn().mockResolvedValue();
        setClipboard({ writeText });
        await expect(copyToClipboard('999 888 777')).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith('999 888 777');
    });

    test('falls back to a hidden textarea when the async clipboard rejects', async () => {
        setClipboard({ writeText: jest.fn().mockRejectedValue(new Error('denied')) });
        document.execCommand = jest.fn().mockReturnValue(true);
        await expect(copyToClipboard('abc')).resolves.toBe(true);
        expect(document.execCommand).toHaveBeenCalledWith('copy');
        expect(document.querySelector('textarea')).toBeNull();
    });

    test('falls back when there is no async clipboard at all', async () => {
        setClipboard(undefined);
        document.execCommand = jest.fn().mockReturnValue(true);
        await expect(copyToClipboard('abc')).resolves.toBe(true);
    });

    test('reports failure when both ways fail', async () => {
        setClipboard({ writeText: jest.fn().mockRejectedValue(new Error('denied')) });
        document.execCommand = jest.fn(() => { throw new Error('blocked'); });
        await expect(copyToClipboard('abc')).resolves.toBe(false);
        expect(document.querySelector('textarea')).toBeNull();
    });
});
