/**
 * El router real: qué rutas declara la app, y que ninguna tape a otra.
 *
 * La suite certificaba la TABLA de rutas (`permissions.js`) pero nunca las rutas
 * declaradas en `App.js`. Por eso nadie vio que `/menu` estaba dos veces —la carta
 * pública y la pantalla de menú del día— y que React Router resolvía siempre la
 * pública, que se declara primero: «Menú de hoy» quedó inalcanzable para todos y
 * su guarda de rol nunca llegó a ejecutarse.
 *
 * Esto lee las declaraciones del propio `App.js`, así que si mañana alguien vuelve
 * a registrar dos rutas con el mismo path, o una que otra ya captura, falla.
 */
import fs from 'fs';
import path from 'path';

const APP_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', 'App.js'),
    'utf8',
);

beforeEach(() => {
    window.history.pushState({}, '', '/');
});

/**
 * Cada `<Route>` con `path`, con el nombre del componente que monta.
 *
 * Se extrae de a uno y con una sola pasada: contar las rutas con guarda por
 * separado las duplicaba, porque también declaran `path`.
 */
function declaredRoutes() {
    const routes = [];
    const chunk = /<Route\b[^>]*\/>/g;
    let match;
    while ((match = chunk.exec(APP_SOURCE)) !== null) {
        const tag = match[0];
        const pathMatch = tag.match(/path="([^"]+)"/);
        if (!pathMatch) continue; // rutas de layout, sin path propio
        const component = tag.match(/<([A-Z]\w+)\s*\/>/);
        const guarded = tag.match(/guard\('([^']+)'/);
        routes.push({
            path: pathMatch[1],
            component: component ? component[1] : null,
            guardPath: guarded ? guarded[1] : null,
        });
    }
    return routes;
}

describe('las rutas declaradas en App.js', () => {
    it('la carta pública del cliente vive en /menu', () => {
        const declared = declaredRoutes().find((r) => r.path === '/menu');
        expect(declared).toBeDefined();
        expect(declared.component).toBe('Landing');
    });

    it('«Menú de hoy» vive en /gestion/menu, no en /menu', () => {
        const menu = declaredRoutes().find((r) => r.component === 'GestionarMenu');
        expect(menu).toBeDefined();
        expect(menu.path).toBe('/gestion/menu');
    });

    it('la guarda de una ruta usa el mismo path que la ruta', () => {
        // `guard(path, element)` lee los roles de ESE path en `permissions.js`. Si
        // los dos paths se separan, la guarda no encuentra roles y la pantalla
        // queda sin permiso (o con el de otra ruta).
        const mismatched = declaredRoutes()
            .filter((r) => r.guardPath && r.guardPath !== r.path)
            .map((r) => `${r.path} vs guard('${r.guardPath}')`);
        expect(mismatched).toEqual([]);
    });

    it('ningún path está declarado dos veces', () => {
        const paths = declaredRoutes().map((r) => r.path);
        const duplicated = paths.filter((p, i) => paths.indexOf(p) !== i);
        expect(duplicated).toEqual([]);
    });

    it('las rutas admin no cuelgan del prefijo de una pública', () => {
        // La carta pública se declara primero, así que un path admin bajo `/menu`
        // moriría igual que murió «Menú de hoy».
        const adminUnderMenu = declaredRoutes()
            .filter((r) => r.component === 'GestionarMenu' && r.path.startsWith('/menu/'))
            .map((r) => r.path);
        expect(adminUnderMenu).toEqual([]);
    });

    it('cada destino de la navegación existe como ruta declarada', () => {
        // El enlace roto del bug: «Menú de hoy» apuntaba a un path que el router
        // resolvía a otra pantalla. Aquí se comprueba que todo destino del menú
        // esté declarado de verdad.
        const navSource = fs.readFileSync(
            path.join(__dirname, '..', 'lib', 'permissions.js'), 'utf8',
        );
        const navPaths = [...navSource.matchAll(/\{\s*to:\s*'([^']+)'/g)].map((m) => m[1]);
        const declared = new Set(declaredRoutes().map((r) => r.path));
        const missing = navPaths.filter((navPath) => !declared.has(navPath));
        expect(missing).toEqual([]);
    });
});
