/**
 * SpeechQueue — serializes announcements so they never overlap.
 *
 * Framework-free and dependency-injected (`speak`/`cancel`/`now`) so it can be
 * unit tested without audio. Guarantees:
 *   - one utterance at a time,
 *   - highest priority first,
 *   - no duplicate key while queued,
 *   - a key is not repeated inside `minRepeatMs`,
 *   - `cancel()` empties the queue and stops the current utterance.
 */
export class SpeechQueue {
    constructor({ speak, cancel, now = () => Date.now(), minRepeatMs = 60000 } = {}) {
        this.speak = speak;
        this.cancelSpeech = cancel;
        this.now = now;
        this.minRepeatMs = minRepeatMs;
        this.items = [];
        this.speaking = false;
        this.current = null;
        this.spokenAt = new Map();
        this.onCaption = null;
        this.onIdle = null;
    }

    /** @returns {boolean} whether the item was accepted. */
    enqueue(item) {
        if (!item || !item.text || !item.key) return false;
        const last = this.spokenAt.get(item.key);
        if (last != null && this.now() - last < this.minRepeatMs) return false;
        if (this.items.some((queued) => queued.key === item.key)) return false;
        this.items.push(item);
        this.items.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        this._drain();
        return true;
    }

    cancel() {
        this.items = [];
        this.current = null;
        this.speaking = false;
        try { this.cancelSpeech?.(); } catch { /* ignore */ }
        this._caption(null);
    }

    get pending() {
        return this.items.length;
    }

    _caption(text) {
        try { this.onCaption?.(text); } catch { /* ignore */ }
    }

    _drain() {
        if (this.speaking) return;
        const next = this.items.shift();
        if (!next) {
            try { this.onIdle?.(); } catch { /* ignore */ }
            return;
        }
        this.speaking = true;
        this.current = next;
        this.spokenAt.set(next.key, this.now());
        this._caption(next.text);

        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            this.speaking = false;
            this.current = null;
            this._caption(null);
            this._drain();
        };

        try {
            this.speak(next.text, { onDone: done, onError: done });
        } catch {
            done();
        }
    }
}
