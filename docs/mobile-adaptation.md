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

## 8. Salón: qué se toma del concepto «Salón Mozo»

Punto de partida: un prototipo funcional del dueño (`Salón Mozo.html`, fuera
del repositorio, 742 líneas con datos en memoria, arrastre de mesas, hojas,
mini-reproductor y flujo de cobro). Su lenguaje visual es "tipo Spotify"
(verde `#1ed760`, oscuro, Figtree). **Se adopta la estructura y las
interacciones, no el aspecto**: la app mantiene el sistema Fresco.

| Pieza del concepto | Decisión | Motivo |
|---|---|---|
| Mini-reproductor del pedido activo (`#mini`) | **Entra** | El mozo no pierde el hilo de la cuenta que está trabajando al moverse por el salón. No necesita backend |
| Banda "Ahora" con acciones inmediatas (`drawNow`) | **Entra** | Es lo que ahorra toques: platos listos → *Servir*; mesas por cobrar → *Cobrar*, sin abrir nada |
| Zonas como control segmentado (`#zs`) | **Entra** | Sustituye una fila de chips por un segmentado con `aria-pressed`: menos alto y más claro |
| Cuentas como tarjetas con estado y total (`.pcs`/`.pcd`) | **Entra** | Con multi-cuenta y mesas unidas, elegir cuenta es la decisión más frecuente de la hoja |
| Deshacer en el aviso (`#bUndo`) | **Entra acotado** | Solo donde la inversa existe de verdad en la API (unir mesas → separar). **Nunca** en dinero: un cobro no se "deshace", se anula con su flujo |
| Plano espacial con posiciones libres (`#plan`, `#tab`) | **No entra (aún)** | El modelo no tiene coordenadas: `TableCreate`/`TableUpdate` solo llevan number, name, capacity, area, status y branch_id. Necesita migración, endpoint y un editor que persista. El comportamiento a 360 px lo decidirá la medición |
| Lenguaje verde / oscuro / Figtree | **No entra** | Rompería el sistema de diseño único (hallazgo P2 ya cerrado) y, peor, el verde **ya significa "mesa libre"**: usarlo como color de marca y de acción mezclaría el estado con la identidad |
| Conmutador Mesas / Pedidos dentro del Salón | **No entra** | `/pedidos` ya es pantalla propia con su entrada en la barra inferior; duplicarla sería mantener dos veces lo mismo |
| Objetivos táctiles del prototipo (píldoras 36 px, steppers 30 px, selects 30 px) | **No se copian** | Están por debajo de los 44 px que el contrato fija y que la auditoría ya dejó en 0 incidencias |

Lo que el concepto **confirma** y la app ya tenía, así que no se reimplementa:
filtros de estado con contador, leyenda de estados, tarjetas de mesa, el flujo
de unir mesas con su barra de acciones, las hojas inferiores en móvil y el
multi-cuenta.

### 8.1 Qué se implementó y cómo se verificó

| Pieza | Dónde | Detalle |
|---|---|---|
| Mini-reproductor del pedido activo | `Salon.jsx` (`salon-mini`, `salon-mini-accion`) | Barra fija sobre la barra inferior (`bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))]`, `md:bottom-0`), `z-30` por debajo de hojas y diálogos. Muestra cuenta, mesa, estado agregado y total, con una sola acción contextual (*Servir* / *Enviar · N* / *Agregar*). Se oculta con la hoja abierta, el flujo de pedido nuevo, el traspaso, mover cuenta y en modo unir: no puede solaparse con la barra de "Unir mesas" |
| Banda "Ahora" | `Salon.jsx` (`salon-ahora`) | `role="region"` con carril `.scroll-x`: cuentas con platos listos → *Servir*; mesas por cobrar → *Cobrar*. Usa los tokens `FLOOR_STYLE`, no colores nuevos |
| Zonas segmentadas | `Salon.jsx` (`salon-zonas`) | `role="group"` + `aria-pressed`, conserva los `data-testid` de cada zona |
| Cuentas como tarjetas | `Salon.jsx` (`mesa-sheet-cuentas`) | Con más de una cuenta, carril de tarjetas con alias, total y estado de sus platos; la activa lleva `aria-pressed` |
| Deshacer | `pages/salon/useTableSelection.js` | Tras unir mesas y **solo si la API devuelve el id del grupo**, aviso con deshacer que disuelve con `DELETE /table-groups/:id`. Al **ampliar** un grupo la inversa es `DELETE /table-groups/:id/tables/:tableId` por cada mesa sumada. Sin inversa fiel no se promete: en dinero no se aplica (ver §9) |

Pruebas nuevas: `src/__tests__/SalonActiveOrderBar.test.js` (4 casos: reabrir la
cuenta desde la barra, servir desde ella, pintar la banda y no pintarla cuando
no hay nada que reclamar). Comprobación en vivo: `e2e/audit/verify-mini.mjs`
(que la barra no tape la última fila, no se solape con la navegación y no
produzca scroll horizontal a 360×640).

### 8.2 Densidad medida a 360×640 (y su límite)

El arnés mide ahora, en cada visita, a qué píxel cae la primera tarjeta de mesa
y cuántas asoma el primer pantallazo (`fold` en `lib.mjs`):

| Medida | Valor |
|---|---|
| Primera tarjeta de mesa | **500 px** de 640 |
| Tarjetas que asoman (admin / mozo) | 4 / 2 |
| Desbordamiento horizontal | 0 |
| Reparto del chrome | cabecera 56 · filtros 38 · zonas 54 · **leyenda 74** |

La leyenda se compactó (94 → 74 px) porque es una clave, no un control: se le
puede reducir el relleno sin romper el contrato táctil. Aun así, **el recorte
que falta no es de píxeles sino de filas**: con 8 estados y etiquetas como
"Cuenta pagada", los chips siguen ocupando tres líneas. Para que la primera mesa
suba de verdad hay que quitar una fila entera —fusionar filtros y zonas, o
llevar "Nuevo pedido" a la fila del buscador— y eso cambia decisiones de
producto (dónde vive la acción principal), así que queda para que lo decidas.

Dos avisos de honestidad sobre esta tabla: el instrumento `fold` se añadió en
este mismo cambio, así que **no hay una medición equivalente "antes"** con la que
comparar (la estimación de la captura anterior, ~450 px, sale de mirar una
imagen, no de medir). Y el mini-reproductor y la banda "Ahora" midieron 0 en esta
corrida porque la sesión de auditoría no tenía ningún pedido abierto: son
condicionales, y cuando aparecen suman ~56 px y ~90 px respectivamente.

---

## 9. "Unir mesas": una sola selección para dos operaciones

La primera versión unía mesas sueltas y nada más. Para sumar la mesa 5 al grupo
3 + 4 había que **separar el grupo y volver a unir las tres**, perdiendo la
identidad del grupo en el camino. La API ya tenía el endpoint
(`POST /table-groups/:id/tables`, probado en `tests/test_table_groups.py`) y la
interfaz no lo usaba.

Ahora la selección es un conjunto de elecciones —mesas, más **como mucho un grupo
ya unido**— y lo que esa selección significa se deduce, no se pregunta:

| Lo que el mozo elige | Lo que la app hace |
|---|---|
| Dos o más mesas sueltas | `POST /table-groups` — un grupo nuevo |
| Un grupo unido + una o más mesas | `POST /table-groups/:id/tables` por cada mesa — el grupo se amplía |
| Dos grupos unidos | Se rechaza: "Solo se puede ampliar un grupo a la vez" |
| Un grupo solo, sin mesas | Todavía no es una operación: la barra pide las mesas que se suman |

### 9.1 Qué cambió para el mozo

| Antes | Ahora |
|---|---|
| Elegir la mesa 5 para el grupo 3 + 4 obligaba a separar y reunir todo | Se toca el grupo (**la fiesta entera**, no una silla) y después la mesa libre |
| Lo elegido eran números en una frase, sin forma de deshacer un toque suelto | Fichas quitables de una en una: `Mesa 3 ✕`; quitar una no cancela la selección |
| La instrucción desaparecía justo al elegir la primera mesa, que es cuando falta una más | Una línea de guía que **nunca** se va: "Elige al menos una mesa más", "1 mesa se suma a Mesas 3 + 4" |
| El motivo de un rechazo vivía solo en la barra del fondo, lejos de la mesa tocada | La tarjeta lo dice en su sitio: borde discontinuo, `No` y el motivo (`mesa-card-motivo-N`) |
| Una mesa no elegible se veía igual que una elegible y fallaba al tocarla | `data-pick="blocked"` con `aria-disabled`: no se deja tocar y dice por qué |
| La tarjeta de un grupo se apagaba en modo unir y no respondía; sus mini-mesas sí abrían la hoja | La tarjeta del grupo se elige entero y sus mini-mesas eligen el grupo, no abren la hoja |
| El grupo tenía que ir a la hoja de la mesa para separarse | `Separar` en la propia tarjeta del grupo, con confirmación |
| La mesa principal del grupo la elegía siempre el servidor | Selector `Principal` cuando hay más de una candidata; solo se manda si el mozo cambia la que el servidor ya habría elegido |

La regla de la mesa principal sigue siendo la del servidor (`_resolve_anchor`):
si alguna mesa elegida ya tiene cuenta, la principal **tiene** que ser una de
ellas — una mesa libre no puede nombrar al grupo.

### 9.2 Lo que no cabe esperar

Unir mesas sigue siendo una **marca del salón**: no mueve ni fusiona cuentas.
Cada mesa conserva la suya y el grupo dice cuántas tiene. Fusionarlas es otra
capacidad que toca dinero, y sigue fuera de alcance
([issue #40](https://github.com/adolfoleonidas/Restaurant/issues/40)).

### 9.3 Pruebas

- `src/__tests__/tableGroups.test.js` — las reglas puras: qué mesa se puede
  elegir y por qué no, qué operación se deduce, la mesa principal, la guía.
- `src/__tests__/useTableSelection.test.js` — el hook: ampliar un grupo sin
  disolverlo, deshacer mesa por mesa, una elección que envejece y bloquea la
  confirmación, separar desde el piso.
- `src/__tests__/SalonTableGroups.test.js` — la pantalla: el motivo en la
  tarjeta, ampliar el grupo por su endpoint, separar con confirmación, las
  fichas, el selector de principal.
- `src/__tests__/MesaCardBorder.test.js` — el contorno sigue en el borde (ahora
  con los cuatro lados escritos uno por uno: mezclar el atajo `borderWidth` con
  `borderLeftWidth` hacía que React avisara en cada repintado).




