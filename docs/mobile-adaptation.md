# Adaptación a dispositivos (móvil primero)

Rama `feat/mobile-responsive`, creada desde `origin/main` (`3c275a4`).
Este documento es el contrato que siguen todas las pantallas: si un ajuste se
sale de aquí, tiene que justificarse en el propio código con un comentario.

## 1. Objetivo

Que el sistema completo —POS de salón, pase de cocina, caja, carta pública y
PWA— se pueda operar con el pulgar, en un teléfono de 360 px de ancho, sin
perder nada de lo que ya hace en escritorio.

Tamaños de referencia medidos en la auditoría (`docs/ui-ux-audit.md`):

| Nombre | Tamaño | Es el caso |
|---|---|---|
| Móvil chico | 360×640 | Android de gama baja, el peor caso real |
| Móvil | 390×844 | iPhone 14 / Pixel |
| Móvil apaisado | 844×390 | Mozo con el teléfono de lado |
| Tablet | 768×1024 | Tablet de salón |
| Escritorio | 1440×900 | Caja y administración |

## 2. Cimientos ya disponibles (no duplicar)

Añadidos en `frontend/src/index.css`, `frontend/tailwind.config.js` y
`frontend/src/components/ui/button.jsx`. Se usan tal cual:

| Utilidad | Qué resuelve |
|---|---|
| `min-h-dvh`, `h-dvh`, `max-h-[70dvh]` | Altura real del móvil (100vh no sigue a la barra de direcciones) |
| `app-header` | Cabecera fija con alto, notch (`env(safe-area-inset-top)`) y padding lateral |
| `has-bottom-nav` | Hueco inferior del contenido cuando hay barra de navegación |
| `app-bottom-nav` | Barra inferior con área segura de gestos |
| `pb-safe-bottom`, `p-safe-top`, `px-safe-left`… | Padding derivado de las áreas seguras (Tailwind `spacing.safe-*`) |
| `pb-[max(1rem,env(safe-area-inset-bottom))]` | El padding de una barra fija **con** su propio espacio. Ojo: `pb-safe-bottom` a secas **sustituye** el padding en vez de sumarse (`pb-safe-bottom` y `py-3` son la misma propiedad: gana la última del CSS), así que en una barra con relleno propio hay que usar la forma `max()` |
| `min-h-touch`, `min-w-touch` | Área táctil mínima de 44 px |
| `.touch-target` | Lo mismo desde CSS, para elementos sin Tailwind |
| `.scroll-x` | Scroll horizontal contenido (tablas y carriles anchos) en vez de desbordar |
| `.action-row` | Fila de acciones que se envuelve en móvil |
| Botón `default` / `icon` | Ya miden 44 px en móvil y recuperan la densidad en `sm:` |
| Regla `input/select/textarea { font-size:16px }` (solo móvil) | Evita el zoom automático de iOS al enfocar |

## 3. Reglas obligatorias

1. **Altura**: nunca `100vh`, `h-screen` ni `min-h-screen`. Usar `dvh`.
2. **Sin desborde horizontal**: a 360 px ninguna pantalla puede tener scroll
   horizontal de página. Tablas y carriles anchos van dentro de `.scroll-x` o
   con `overflow-x-auto` propio; los textos largos (números de cuenta, CCI,
   nombres) llevan `min-w-0` + `truncate` o `break-all`.
3. **Objetivo táctil ≥44 px** en todo lo que se pulsa en móvil: patrón
   `h-11 w-11 sm:h-9 sm:w-9` (o `min-h-11 sm:min-h-9`). Ojo con los contadores
   `+`/`-`, los cierres de diálogo y los cambios de modo: son los que más se
   erran con el dedo.
4. **Rejillas**: la base (sin prefijo) es el móvil. `grid-cols-2` como máximo
   para tarjetas de contenido; 3 columnas solo si cada celda es un botón corto
   (mesas, métodos de pago). Nunca `grid-cols-4` sin `md:`.
5. **Texto ≥12 px** (`text-xs`). No truncar lo que decide dinero o estado
   (precio, total, estado de la cuenta, número de mesa).
6. **Nada exclusivo de hover**: si algo solo se descubre o se activa con el
   puntero, en táctil no existe. Usar `onClick` y estados visibles
   (`active:`, color, `aria-pressed`).
7. **Diálogos y hojas**: el contenido debe caber a 640 px de alto con el
   teclado cerrado y las acciones principales tienen que quedar alcanzables.
   Los pies fijos llevan `pb-safe-bottom`.
8. **Escritorio intacto**: todo cambio de densidad va detrás de un breakpoint
   (`max-md:`, `sm:`, `md:`). Si el cambio mejora las dos cosas, aplícalo sin
   breakpoint, pero dilo en el comentario.
9. **No romper las pruebas**: no cambies ni dupliques `data-testid`
   existentes, ni los nombres accesibles, ni el texto de los botones que las
   pruebas buscan. Los elementos nuevos llevan testid propio.
10. **Sin dependencias nuevas** y sin tocar `craco.config.js`. Nada de
    reescribir pantallas: cambios incrementales.
11. **Barras fijas al pie de una pantalla**: la barra de navegación inferior
    ocupa `--bottom-nav-h` (60 px) más el área segura, así que cualquier
    `fixed bottom-0` propio de una página tiene que subir por encima:
    `bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))] md:bottom-0`.
    Si no, se solapan (las dos están en `z-40`) y tapan acciones como
    "Enviar a cocina" o "Cobrar".
12. **No pelear con los primitivos**: `ui/button.jsx`, `ui/input.jsx`,
    `ui/tabs.jsx` y `ui/switch.jsx` ya traen el tamaño móvil correcto (44 px) y
    recuperan la densidad en `sm:`. Si un llamador añade `h-8`, `h-9` o
    `max-h-[90vh]`, `twMerge` le da la razón y anula el default: hay que
    **quitar** esos overrides, no añadir otros.

## 4. Fuera de alcance de este trabajo

- Rediseño visual o cambio de tokens de color.
- Migración de framework o de Radix.
- `frontend/src/components/ui/*` (los primitivos) y `AppShell.jsx`: los lleva
  el integrador, para que no haya dos manos en el mismo archivo.
- Compilar (`npm run build`) o correr la suite: lo hace el integrador una sola
  vez, al final, para que tres agentes no peleen por `frontend/build`.

## 5. Cómo se verifica

1. `CI=true npx craco build` compila sin advertencias (CI las trata como
   errores, así que no puede quedar ni un import sin usar).
2. `npx craco test --watchAll=false --runInBand` sigue verde.
3. Arnés de auditoría (`frontend/e2e/audit/`): 0 banderas de axe, 0
   desbordamientos horizontales a 360/390/768/1024/1440, controles <44 px a la
   baja y CLS por debajo de 0,1 en la carta pública.

### Correr el arnés contra el build de este worktree

El arnés mide el build de producción, no el servidor de desarrollo. El puerto
`:3000` lo ocupa el servidor del checkout principal, así que el worktree se sirve
aparte, con el mismo reparto que nginx (`/api` proxeado al backend, mismo
origen, sin relajar CORS en el navegador de pruebas):

```powershell
cd frontend
$env:REACT_APP_BACKEND_URL=""; npx craco build
node e2e/audit/serve-build.mjs                 # http://127.0.0.1:3001
# en otra terminal (Windows bloquea los .ps1 sin firma: de ahí el bypass):
$env:AUDIT_BASE="http://127.0.0.1:3001"
powershell -NoProfile -ExecutionPolicy Bypass -File e2e/audit/run-audit.ps1 `
  -Roles admin -Viewports mobile360,mobile,mobile-landscape,tablet,desktop
node e2e/audit/analyze.mjs                     # escribe e2e/audit/out/summary.md
node e2e/audit/compare.mjs                     # contra out/report-baseline.json si existe
```

`capture.mjs` añade dos tamaños que antes no se medían y que escondían
hallazgos reales: `mobile360` (360×640, el Android más estrecho del local) y
`mobile-landscape` (844×390, donde el login y el pase de cocina se recortan).

## 6. PWA

El manifest, los iconos y el service worker convierten la app en una aplicación
instalable de verdad:

| Pieza | Archivo | Nota |
|---|---|---|
| Iconos | `frontend/public/icons/*.png`, `frontend/public/favicon.ico` | Se generan con `python frontend/scripts/generate-icons.py` desde la misma marca vectorial que dibuja `BrandSymbol`. Antes el manifest apuntaba a un `favicon.ico` que **no existía**. |
| Manifest | `frontend/public/manifest.json` | `id`, `scope`, `start_url`, iconos `any` y `maskable`, atajos a Salón/Cocina/Caja/Carta y colores coherentes con el tema real (`--background`, no el marrón del tema antiguo). |
| Service worker | `frontend/src/service-worker.js` | react-scripts lo compila con Workbox al detectar ese archivo: precache del build, `index.html` para las rutas de la SPA y caché de 5 minutos para la carta pública. **Ningún endpoint de dinero se cachea.** |
| Registro | `frontend/src/lib/serviceWorker.js` | Solo en producción. No fuerza `skipWaiting`: activar una versión nueva con la pestaña abierta rompería los trozos de código que aún no se han descargado. |
| Shell | `frontend/public/index.html` | `theme-color` claro/oscuro, `apple-touch-icon`, y una sola petición de fuentes (antes eran dos, una de ellas bloqueante). |
| Servidor | `frontend/nginx.conf`, `nginx.tls.conf` | gzip, caché inmutable para `/static/`, sin caché para el `index.html` y el service worker, y 404 real para `/favicon.ico`. |

Pendiente y deliberadamente no hecho: `screenshots` en el manifest. La UI de
instalación enriquecida los pide, pero hay que capturarlos del producto real
(no fabricarlos); se pueden tomar con el mismo Chromium del arnés cuando la app
esté desplegada.

## 7. Resultados medidos

Todo lo de abajo sale del arnés de auditoría contra el **build de producción**
servido en `:3001` (`serve-build.mjs`), con el backend real y 31 pedidos en la
base. No son estimaciones de código.

### Corrida completa: 118 visitas de pantalla en 5 tamaños

`admin` + público × 360×640, 390×844, 844×390, 1024×768 y 1440×900, más la
pasada de modo oscuro.

| Métrica | Antes de esta rama | Después |
|---|---|---|
| Desbordamiento horizontal de página | 0 (solo se medía desde 390 px) | **0 en los 5 tamaños, incluido 360 px y apaisado** |
| Nodos infractores de axe | 428 (línea base del informe) | **0** tras los arreglos de abajo |
| Texto por debajo de 12 px | 336 nodos | **0 visitas** |
| Controles por debajo de 24 px | 85 | **0** en la verificación a 360 px |
| CLS máximo | 0,846 | **0,2463** (`/configuracion` en escritorio); carta pública y menú en **0** |
| Ancho de la barra de scroll | 10 px en Android | 4 px en táctil |

### Lo que encontró la medición y ya está arreglado

Estos cinco hallazgos **no los introdujo esta rama**: venían de los merges
posteriores a la auditoría (`MesaCard`, `GroupCard` y `multi-cuenta` son
componentes nuevos que reintrodujeron patrones que el informe ya había cerrado).
La auditoría los destapó porque esta vez se midió con datos reales y a 360 px.

| Hallazgo | Dónde | Arreglo |
|---|---|---|
| Botones *Entregar* / *Cobrar* con blanco sobre el punto de color: 3,67:1 y 2,95:1 | `MesaCard.jsx` | El fondo vuelve a ser el tono oscuro del estado (`s.fg`, 11:1 y 7,5:1), como pedía el P1-7 del informe. Cada estado conserva su color |
| `aria-label` sobre un `<span>` sin rol (31 nodos por visita) | `MesaCard.jsx` | `role="img"` en el punto de atención |
| `opacity` sobre fondos pastel: 4,08:1 | `MesaCard.jsx`, `Salon.jsx` | Fuera el `opacity`; la jerarquía la da el token `text-muted-foreground`, que sí cumple AA |
| Interruptores de funciones sin nombre accesible | `Configuracion.jsx` | `aria-label` por función (la fila no puede ser un `<label>`: el navegador reenviaría el clic y apagaría el switch) |
| `SelectTrigger` sin nombre cuando el ajuste llega vacío | `Configuracion.jsx` | `aria-label="Seguimiento de preparación"` |
| Casillas y enlaces de 13-20 px en táctil | `Local.jsx`, `PublicLayout.jsx` | `h-6 w-6` en las casillas, `min-h-touch` en la fila y `min-h-8` en los enlaces de redes |
| Botones "Quitar" de 16 px de alto | `Configuracion.jsx` | `inline-flex min-h-touch` |
| Ítem activo de la barra inferior en modo oscuro: 3,33:1 (lo ve el rol cocina, que vive en oscuro) | `AppShell.jsx` | La etiqueta activa se aclara en oscuro (`dark:text-blue-300`), como ya hacía el pase con sus ámbar/azul claros |
| Enlace "Volver al salón" de `/unauthorized` de 20 px de alto | `Unauthorized.jsx` | `inline-flex min-h-touch` |

### Verificación de cierre

| Corrida | Visitas | axe | Desbordes | Controles <24 px |
|---|---|---|---|---|
| 360 px + escritorio (`admin` y público) | 49 | 2 → **0** tras los dos últimos arreglos | 0 | 2 → **0** |
| **360×640 (peor caso), `admin` y público** | **23** | **0** | **0** | **0** |
| **360×640, `cocina` y `cajero`** (incluye la pantalla de acceso denegado) | **17** | **0** | **0** | **0** |

Los cuatro roles quedan medidos al peor tamaño. Los únicos mensajes de
consola que quedan son el 404 intencional de `/pedido/ZZZZZZZZ`, el cierre
normal del stream de notificaciones al navegar y la descarga de fuentes de
Google, que en este entorno no tiene salida a internet.

`CI=true npx craco build` compila sin advertencias y
`npx craco test --watchAll=false --runInBand` pasa **39 suites / 240 pruebas**.

### Límites de esta medición (para no dar por medido lo que no lo está)

- **Las fuentes de Google no se pudieron descargar** en el entorno del arnés
  (`net::ERR_FAILED` en cada visita): la app midió con tipografías de respaldo.
  El layout y el contraste no dependen de eso, pero el aspecto exacto de la
  tipografía de marca no está verificado aquí.
- **El service worker está activo desde la segunda visita**, así que el CLS de
  esa corrida es el de un usuario que ya abrió la app antes; un primer acceso en
  frío puede dar un valor algo peor. La línea base del informe se midió sin
  service worker.
- Los enlaces de seguimiento con código inválido (`/pedido/ZZZZZZZZ`) siguen
  dando 404 y 3 mensajes de consola **a propósito**: es la pantalla de error.
- No se probó en iOS/Safari ni en hardware real: `dvh`, `env(safe-area-inset-*)`
  y el teclado sobre las hojas necesitan un dispositivo de verdad.
- Los controles de 36-40 px que quedan en escritorio son deliberados: el
  contrato pide 44 px **en móvil** y recupera la densidad de escritorio en `sm:`.

