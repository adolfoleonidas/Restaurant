/**
 * Respuesta inmediata al toque: un pulso visual y, si el mozo lo activó, un clic
 * seco. El sonido es opcional y se recuerda entre sesiones; nunca debe romper la
 * pantalla si el navegador no lo permite.
 */

const SOUND_KEY = 'restaurant_order_sound_v1';

export function soundEnabled() {
    try {
        return localStorage.getItem(SOUND_KEY) === 'on';
    } catch {
        return false;
    }
}

export function setSoundEnabled(enabled) {
    try {
        localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off');
    } catch {
        /* sin almacenamiento: el sonido queda sólo para esta pantalla */
    }
}

let context = null;

/** Un clic corto y discreto, generado en el momento (no hay archivo que cargar). */
export function tick() {
    if (!soundEnabled()) return;
    try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        context = context || new Ctor();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.05, context.currentTime + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.07);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.08);
    } catch {
        /* el sonido es un extra: si falla, la acción ya se hizo igual */
    }
}
