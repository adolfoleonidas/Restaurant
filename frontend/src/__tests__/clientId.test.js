import { newClientId } from '@/lib/clientId';

// What the server accepts as a line id (backend `DraftLineUpsert.client_line_id`).
const SERVER_ID = /^[A-Za-z0-9._:-]{1,64}$/;

describe('newClientId', () => {
    it('uses randomUUID when the browser has it', () => {
        const source = { randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001') };
        expect(newClientId(source)).toBe('00000000-0000-4000-8000-000000000001');
        expect(source.randomUUID).toHaveBeenCalledTimes(1);
    });

    it('builds a version 4 uuid from random bytes when randomUUID is missing', () => {
        const source = {
            getRandomValues: jest.fn((bytes) => {
                bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
                return bytes;
            }),
        };
        expect(newClientId(source)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    });

    it('still works without any crypto, and never repeats', () => {
        const ids = new Set(Array.from({ length: 2000 }, () => newClientId({})));
        expect(ids.size).toBe(2000);
        ids.forEach((id) => expect(id).toMatch(SERVER_ID));
    });

    it('falls back when the browser throws instead of giving random values', () => {
        const source = { getRandomValues: () => { throw new Error('blocked'); } };
        expect(newClientId(source)).toMatch(SERVER_ID);
    });

    it('works with no source at all (the test environment has no crypto)', () => {
        expect(newClientId()).toMatch(SERVER_ID);
    });

    it('always produces an id the server accepts', () => {
        const real = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : {};
        for (let i = 0; i < 50; i += 1) expect(newClientId(real)).toMatch(SERVER_ID);
    });
});
