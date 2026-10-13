/**
 * Qué build está corriendo esta pestaña.
 *
 * CRA nombra el bundle principal `main.<hash>.js` con el hash de su contenido, y
 * `index.html` se sirve sin caché, así que el nombre del archivo que el navegador
 * ya cargó ES la versión que se está viendo. No hay nada que configurar en el
 * build ni que el servidor tenga que contar: se lee de la propia página.
 *
 * Existe por un problema real: desde el servidor no se puede saber si el teléfono
 * del mozo sigue con una build vieja guardada por el service worker. Con esto se
 * mira la pantalla y se sabe.
 */
const MAIN_BUNDLE = /\/static\/js\/main\.([0-9a-f]+)\.js/;

/** The content hash of the running build, or '' when it cannot be read. */
export function buildHash(doc = typeof document === 'undefined' ? null : document) {
    const scripts = doc?.querySelectorAll?.('script[src]') || [];
    for (const script of scripts) {
        const src = script.getAttribute?.('src') || script.src || '';
        const found = MAIN_BUNDLE.exec(src);
        if (found) return found[1];
    }
    return '';
}

/** What to show a person: the hash, or a plain "no lo pude leer". */
export function buildLabel(doc) {
    const hash = buildHash(doc);
    return hash ? `Versión ${hash}` : 'Versión desconocida';
}

export default buildLabel;
