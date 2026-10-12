import {
    fmtMoney, fmtMoneyNum, fmtTime, fmtDateTime, fmtDateFull, fmtDateTimeShort, fmtDayLabel,
} from '@/lib/format';

const ISO = '2026-03-04T15:07:09Z';

describe('format helpers', () => {
    test('money', () => {
        expect(fmtMoney(12.5)).toBe('S/ 12.50');
        expect(fmtMoney(null)).toBe('S/ 0.00');
        expect(fmtMoneyNum('3')).toBe('3.00');
    });

    test('time and date-time stay empty for missing values', () => {
        expect(fmtTime('')).toBe('');
        expect(fmtDateTime(null)).toBe('');
        expect(fmtTime(ISO)).toBe(new Date(ISO).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }));
    });

    test('fmtDateFull shares the single date-time format and accepts a Date', () => {
        expect(fmtDateFull(ISO)).toBe(fmtDateTime(ISO));
        const now = new Date();
        expect(fmtDateFull(now)).toBe(fmtDateTime(now));
    });

    test('fmtDateTimeShort shares the single date-time format, dash when empty', () => {
        expect(fmtDateTimeShort(ISO)).toBe(fmtDateTime(ISO));
        expect(fmtDateTimeShort(null)).toBe('—');
        expect(fmtDateTimeShort('')).toBe('—');
    });

    test('fmtDayLabel is a weekday heading, dash when empty', () => {
        expect(fmtDayLabel(ISO)).toBe(new Date(ISO).toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short' }));
        expect(fmtDayLabel(undefined)).toBe('—');
    });
});
