/**
 * Alcance por sucursal del salón.
 *
 * El mozo, la caja y la cocina ya están fijados a su sucursal por el servidor:
 * para ellos el salón no elige nada. La cuenta del dueño ve todo el negocio, así
 * que sí necesita decir qué piso está mirando — un salón es físico y no existe
 * "el piso de todas las sucursales".
 */

export const BRANCH_SCOPE_STORAGE_PREFIX = 'salon-branch-scope';

/** Clave de memoria por usuario: la elección de uno no cambia la del otro. */
export function branchScopeKey(userId) {
    return `${BRANCH_SCOPE_STORAGE_PREFIX}:${userId || 'anon'}`;
}

/**
 * Contexto inicial del salón: `null` (sin alcance, lo acota el servidor),
 * `branch:<id>` o `legacy` (mesas sin sucursal).
 *
 * Sin sucursales registradas no hay nada que elegir y se mantiene el salón sin
 * alcance, que es como venía funcionando un local de una sola sede. La sucursal
 * recordada manda; si ya no existe, se cae a la primera de la lista.
 */
export function resolveBranchScope({ isOwner, branches, remembered } = {}) {
    if (!isOwner) return null;
    const list = Array.isArray(branches) ? branches : [];
    if (list.length === 0) return null;
    if (remembered === 'legacy') return 'legacy';
    const hit = list.find((branch) => `branch:${branch.id}` === remembered);
    return `branch:${(hit || list[0]).id}`;
}

/** Parámetros de consulta del alcance; `null` deja que el servidor decida. */
export function branchScopeParams(context) {
    if (context === 'legacy') return { legacy_only: true };
    if (typeof context === 'string' && context.startsWith('branch:')) {
        const branchId = context.slice('branch:'.length);
        return branchId ? { branch_id: branchId } : null;
    }
    return null;
}

/** Etiqueta del contexto activo, para el selector y los avisos. */
export function branchScopeLabel(context, branches) {
    if (context === 'legacy') return 'Sin sucursal';
    const branchId = branchScopeParams(context)?.branch_id;
    return (branches || []).find((branch) => branch.id === branchId)?.name || 'Sucursal';
}

/** Lee la elección guardada; el navegador puede negarse (modo privado). */
export function readRememberedScope(userId) {
    try {
        return window.localStorage.getItem(branchScopeKey(userId));
    } catch {
        return null;
    }
}

export function rememberScope(userId, context) {
    try {
        window.localStorage.setItem(branchScopeKey(userId), context);
    } catch {
        /* sin memoria: la elección vale solo para esta sesión */
    }
}
