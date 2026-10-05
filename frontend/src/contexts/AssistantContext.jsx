import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createBrowserTts } from '@/lib/assistant/tts';
import { SpeechQueue } from '@/lib/assistant/speechQueue';

/**
 * AssistantProvider — owns the on/off flag, the speech queue and the caption.
 *
 * The flag is per device (localStorage) and OFF by default: with it off the
 * assistant enqueues nothing and the rest of the app behaves exactly as before.
 * The provider never talks to the API; announcements and commands are driven by
 * consumers that reuse the existing event bus and endpoints.
 */

const STORAGE_KEY = 'assistant-voice-enabled';

const fallback = {
    enabled: false,
    setEnabled: () => {},
    supported: false,
    caption: null,
    announce: () => false,
    cancel: () => {},
};

const AssistantContext = createContext(fallback);

function readFlag() {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
}

export function AssistantProvider({ children }) {
    const tts = useMemo(() => createBrowserTts(), []);
    const [enabled, setEnabledState] = useState(readFlag);
    const [caption, setCaption] = useState(null);

    const queue = useMemo(() => new SpeechQueue({
        speak: (text, options) => tts.speak(text, options),
        cancel: () => tts.cancel(),
    }), [tts]);

    useEffect(() => {
        queue.onCaption = setCaption;
        return () => {
            queue.onCaption = null;
            queue.cancel();
        };
    }, [queue]);

    const setEnabled = useCallback((value) => {
        setEnabledState(value);
        try { localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false'); } catch { /* ignore */ }
        if (!value) queue.cancel();
    }, [queue]);

    const announce = useCallback((item) => {
        if (!enabled) return false;
        return queue.enqueue(item);
    }, [enabled, queue]);

    const cancel = useCallback(() => queue.cancel(), [queue]);

    const value = useMemo(() => ({
        enabled,
        setEnabled,
        supported: tts.supported,
        caption,
        announce,
        cancel,
    }), [enabled, setEnabled, tts.supported, caption, announce, cancel]);

    return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export const useAssistant = () => useContext(AssistantContext);
