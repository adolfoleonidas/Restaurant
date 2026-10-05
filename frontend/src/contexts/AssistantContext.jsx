import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createBrowserTts } from '@/lib/assistant/tts';
import { SpeechQueue } from '@/lib/assistant/speechQueue';
import useRestaurantFeatures from '@/hooks/useRestaurantFeatures';

/**
 * AssistantProvider — owns the on/off flags, the speech queue and the caption.
 *
 * Two levels, by design:
 *   - the venue flag (`features.voice_assistant`, Ajustes) decides whether the
 *     module exists at all;
 *   - the per-device flag (localStorage) decides whether THIS device speaks,
 *     and defaults to off so no tablet starts talking on its own.
 *
 * With either level off the assistant enqueues nothing and the rest of the app
 * behaves exactly as before.
 */

const STORAGE_KEY = 'assistant-voice-enabled';

const fallback = {
    enabled: false,
    available: false,
    setEnabled: () => {},
    supported: false,
    caption: null,
    announce: () => false,
    cancel: () => {},
};

const AssistantContext = createContext(fallback);

function readDeviceFlag() {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
}

export function AssistantProvider({ children }) {
    const tts = useMemo(() => createBrowserTts(), []);
    const features = useRestaurantFeatures();
    const available = Boolean(features.voice_assistant);
    const [deviceEnabled, setDeviceEnabled] = useState(readDeviceFlag);
    const [caption, setCaption] = useState(null);
    const enabled = available && deviceEnabled;

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

    // Turning the venue module off must silence any device immediately.
    useEffect(() => {
        if (!available) queue.cancel();
    }, [available, queue]);

    const setEnabled = useCallback((value) => {
        setDeviceEnabled(value);
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
        available,
        setEnabled,
        supported: tts.supported,
        caption,
        announce,
        cancel,
    }), [enabled, available, setEnabled, tts.supported, caption, announce, cancel]);

    return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export const useAssistant = () => useContext(AssistantContext);
