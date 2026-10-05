/**
 * Browser TTS adapter (Web Speech API). Swap for a cloud or server provider
 * without touching the rest of the assistant.
 *
 * When the browser has no speech synthesis the adapter degrades to "silent but
 * working": it calls `onDone` immediately so the queue never stalls and the
 * caller can fall back to the on-screen caption.
 */
export function createBrowserTts() {
    const supported = typeof window !== 'undefined'
        && typeof window.speechSynthesis !== 'undefined'
        && typeof window.SpeechSynthesisUtterance !== 'undefined';

    return {
        supported,
        speak(text, { onDone, onError, lang = 'es-PE', rate = 1 } = {}) {
            if (!supported) { onDone?.(); return; }
            try {
                const utterance = new window.SpeechSynthesisUtterance(text);
                utterance.lang = lang;
                utterance.rate = rate;
                utterance.onend = () => onDone?.();
                utterance.onerror = () => (onError ? onError() : onDone?.());
                window.speechSynthesis.speak(utterance);
            } catch {
                onDone?.();
            }
        },
        cancel() {
            if (!supported) return;
            try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
        },
    };
}
