/**
 * An id the client makes up for something before the server has seen it (a
 * draft line). The server dedupes on it, so what matters is that two lines never
 * share one; it is not a secret. It always fits `[A-Za-z0-9._:-]{1,64}`, the
 * shape the batch endpoint accepts.
 */
const uuidFromBytes = (source) => {
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export function newClientId(source = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined) {
    try {
        if (typeof source?.randomUUID === 'function') return source.randomUUID();
        if (typeof source?.getRandomValues === 'function') return uuidFromBytes(source);
    } catch {
        // A browser that blocks crypto still gets an id: uniqueness is all it needs.
    }
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 8)}`;
}
