const REQUEST_ID_KEY = 'public_order_request_id_v1';
const REQUEST_FINGERPRINT_KEY = 'public_order_request_fingerprint_v1';
let completedRequestId = null;

function createRequestId(cryptoSource) {
    if (typeof cryptoSource?.randomUUID === 'function') return cryptoSource.randomUUID();
    if (typeof cryptoSource?.getRandomValues !== 'function') {
        throw new Error('Secure randomness is required to submit an order.');
    }

    const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getOrderRequestId(storage, cryptoSource, fingerprint) {
    const currentId = storage.getItem(REQUEST_ID_KEY);
    const currentFingerprint = storage.getItem(REQUEST_FINGERPRINT_KEY);
    if (currentId && currentFingerprint === fingerprint && currentId !== completedRequestId) return currentId;

    const requestId = createRequestId(cryptoSource);
    storage.setItem(REQUEST_ID_KEY, requestId);
    storage.setItem(REQUEST_FINGERPRINT_KEY, fingerprint);
    return requestId;
}

export function clearOrderRequestId(storage) {
    storage.removeItem(REQUEST_ID_KEY);
    storage.removeItem(REQUEST_FINGERPRINT_KEY);
}

export async function submitPublicOrder({ storage, cryptoSource, fingerprint, payload, post, onConfirmed }) {
    const requestId = getOrderRequestId(storage, cryptoSource, fingerprint);
    const { data } = await post({ ...payload, request_id: requestId });
    if (onConfirmed) onConfirmed(data);
    completedRequestId = requestId;
    try {
        clearOrderRequestId(storage);
    } catch {
        // Confirmation is already retained in UI state; storage cleanup is best effort.
    }
    return data;
}
