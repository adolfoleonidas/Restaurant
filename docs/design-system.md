# Sistema de Diseño - Guía Completa

## 📋 Tabla de Contenidos
1. [Arquitectura del Sistema](#arquitectura-del-sistema)
2. [Tokens de Diseño](#tokens-de-diseño)
3. [Temas Disponibles](#temas-disponibles)
4. [Cómo Cambiar el Tema](#cómo-cambiar-el-tema)
5. [Cómo Crear un Nuevo Tema](#cómo-crear-un-nuevo-tema)
6. [Buenas Prácticas](#buenas-prácticas)
7. [Componentes y Estados](#componentes-y-estados)
8. [No motion](#no-motion)

---

## 🏗️ Arquitectura del Sistema

El sistema de diseño está compuesto por tres capas:

### 1. Tokens Base (`tokens.css`)
Variables CSS semánticas que definen la base del diseño:
- **Colores**: `--color-brand`, `--color-bg-page`, `--color-text-primary`, etc.
- **Tipografía**: `--font-sans`, `--text-sm`, `--font-medium`, etc.
- **Espaciados**: `--space-1` a `--space-20`
- **Bordes**: `--radius-sm`, `--radius-base`, `--radius-lg`, etc.
- **Sombras**: `--shadow-sm`, `--shadow-base`, `--shadow-lg`, etc.
- **Movimiento**: ninguno. No hay tokens de transición ni de animación (ver [No motion](#no-motion)).

### 2. Temas (`public/themes/theme-*.css`)
Cada tema define valores específicos para las variables:
- `theme-fresco.css` - Azul/Blanco (default)
- `theme-restaurante.css` - Verde moderno
- `theme-calido.css` - Naranja/Marrón tradicional

### 3. Componentes
Todos los componentes usan las variables de tokens, no valores hardcodeados.

---

## 🎨 Tokens de Diseño

### Colores Semánticos

```css
/* Colores de marca */
--color-brand          /* Color principal */
--color-brand-hover    /* Estado hover */
--color-brand-active   /* Estado active */
--color-brand-soft     /* Versión suave (10% opacidad) */
--color-on-brand       /* Texto sobre color de marca */

/* Fondos */
--color-bg-page        /* Fondo de página */
--color-bg-card        /* Fondo de tarjetas */
--color-bg-surface     /* Fondo de superficies elevadas */
--color-bg-elevated    /* Fondo de modales/popovers */
--color-bg-input       /* Fondo de inputs */

/* Textos */
--color-text-primary   /* Texto principal */
--color-text-secondary /* Texto secundario */
--color-text-tertiary  /* texto terciario */
--color-text-disabled  /* Texto deshabilitado */
--color-text-inverse   /* Texto sobre fondos oscuros */
--color-text-link      /* Texto de enlaces */

/* Bordes */
--color-border         /* Borde estándar */
--color-border-strong  /* Borde más fuerte */
--color-border-weak    /* Borde más sutil */
--color-border-focus   /* Borde de focus */

/* Estados */
--color-success        /* Éxito */
--color-warning        /* Advertencia */
--color-error          /* Error */
--color-info           /* Información */
```

### Tipografía

```css
/* Familias */
--font-sans      /* Instrument Sans (cuerpo) */
--font-display   /* Bricolage Grotesque (títulos) */
--font-mono      /* IBM Plex Mono (código) */

/* Tamaños */
--text-xs: 0.75rem    /* 12px */
--text-sm: 0.875rem   /* 14px */
--text-base: 1rem     /* 16px */
--text-lg: 1.125rem   /* 18px */
--text-xl: 1.25rem    /* 20px */
--text-2xl: 1.5rem    /* 24px */
--text-3xl: 1.875rem  /* 30px */
--text-4xl: 2.25rem   /* 36px */

/* Pesos */
--font-normal: 400
--font-medium: 500
--font-semibold: 600
--font-bold: 700
```

### Espaciados

```css
--space-1: 0.25rem   /* 4px */
--space-2: 0.5rem    /* 8px */
--space-3: 0.75rem   /* 12px */
--space-4: 1rem      /* 16px */
--space-5: 1.25rem   /* 20px */
--space-6: 1.5rem    /* 24px */
--space-8: 2rem      /* 32px */
--space-10: 2.5rem   /* 40px */
--space-12: 3rem     /* 48px */
--space-16: 4rem     /* 64px */
```

### Bordes y Sombras

```css
/* Radios */
--radius-sm: 0.25rem    /* 4px */
--radius-base: 0.5rem   /* 8px */
--radius-md: 0.625rem   /* 10px */
--radius-lg: 0.75rem    /* 12px */
--radius-xl: 1rem       /* 16px */
--radius-full: 9999px   /* Circular */

/* Sombras */
--shadow-sm      /* Sutil */
--shadow-base    /* Estándar */
--shadow-md      /* Media */
--shadow-lg      /* Grande */
--shadow-xl      /* Extra grande */
```

---

## 🎭 Temas Disponibles

### 1. Fresco (Default)
- **Estilo**: Profesional y limpio
- **Colores**: Azul/Blanco
- **Uso**: Restaurantes modernos, cafeterías
- **ID**: `fresco`

### 2. Restaurante
- **Estilo**: Moderno y fresco
- **Colores**: Verde esmeralda/Azul
- **Uso**: Restaurantes contemporáneos
- **ID**: `restaurante`

### 3. Cálido
- **Estilo**: Acogedor tradicional
- **Colores**: Naranja/Marrón/Púrpura
- **Uso**: Restaurantes tradicionales, fondas
- **ID**: `calido`

---

## 🔄 Cómo Cambiar el Tema

### Para Administradores

1. Ve a **Configuración** → **Tema de la interfaz**
2. Selecciona el tema deseado
3. El cambio se aplica inmediatamente para **todos los usuarios**

### Para Pruebas Locales

Puedes forzar un tema local sin afectar a los demás usuarios:

```javascript
// En la consola del navegador
localStorage.setItem('restaurant-theme', 'calido');
location.reload();
```

Para restaurar el tema del restaurante:

```javascript
localStorage.removeItem('restaurant-theme');
location.reload();
```

O usa el botón "Restaurar tema del restaurante" en la configuración.

---

## 🎨 Cómo Crear un Nuevo Tema

### Paso 1: Crear el archivo CSS

Crea `frontend/public/themes/theme-mi-tema.css`:

```css
/* ============================================================
   TEMA: Mi Tema Personalizado
   Descripción del estilo
   ============================================================ */

:root {
  /* Colores base */
  --page: #f5f5f5;
  --paper: #ffffff;
  --surface: #f0f0f0;
  --line: #e0e0e0;
  --ink: #1a1a1a;
  --muted: #666666;
  --soft: #999999;
  
  /* Color principal */
  --brand: #ff6b6b;
  --brand-hover: #ee5a5a;
  --brand-soft: #ffe0e0;
  
  /* Color secundario */
  --accent: #4ecdc4;
  --accent-hover: #3dbdb4;
  --accent-soft: #d4f4f0;
  
  /* Colores semánticos */
  --green: #51cf66;
  --green-soft: #d3f9d8;
  --red: #ff6b6b;
  --red-soft: #ffe3e3;
  --amber: #ffd43b;
  --amber-soft: #fff3bf;
  
  /* Sombras */
  --shadow: 0 10px 20px rgba(0,0,0,0.1);
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.05);
  
  /* Bordes */
  --radius: 12px;
}

.dark {
  /* Ajustes para dark mode */
  --page: #1a1a1a;
  --paper: #2d2d2d;
  --surface: #3d3d3d;
  --line: #4d4d4d;
  --ink: #f5f5f5;
  --muted: #b0b0b0;
  --soft: #808080;
  
  --brand: #ff8787;
  --brand-hover: #ffa8a8;
  --brand-soft: #4d2020;
  
  /* ... más variables ... */
}

/* Aplicación del tema */
body.theme-mi-tema {
  background: var(--page);
  color: var(--ink);
}

/* Ajustes específicos si son necesarios */
body.theme-mi-tema .font-display {
  font-family: 'Tu Fuente', sans-serif;
}
```

### Paso 2: Registrar el tema

Edita `frontend/src/contexts/ThemeContext.jsx`:

```javascript
const themes = [
  { id: 'fresco', name: 'Fresco', description: 'Azul/Blanco - Profesional y limpio' },
  { id: 'restaurante', name: 'Restaurante', description: 'Verde moderno - Estilo restaurante' },
  { id: 'calido', name: 'Cálido', description: 'Naranja/Marrón - Acogedor tradicional' },
  { id: 'mi-tema', name: 'Mi Tema', description: 'Descripción de mi tema personalizado' },
];
```

### Paso 3: Actualizar la configuración

Ve a **Configuración** → **Tema de la interfaz** y selecciona tu nuevo tema.

---

## ✅ Buenas Prácticas

### Para Desarrolladores

#### ✅ CORRECTO: Usar tokens

```jsx
// ✅ BIEN
<Button 
  style={{ 
    background: 'var(--color-brand)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-base)'
  }}
>
  Click me
</Button>

// ✅ MEJOR: Usar clases de Tailwind que usan tokens
<Button className="bg-primary p-4 rounded-base">
  Click me
</Button>
```

#### ❌ INCORRECTO: Valores hardcodeados

```jsx
// ❌ MAL
<Button 
  style={{ 
    background: '#059669',
    padding: '16px',
    borderRadius: '8px'
  }}
>
  Click me
</Button>
```

### Para Diseñadores

1. **Usa siempre variables CSS** en lugar de valores fijos
2. **Respeta la escala de espaciados** (4, 8, 12, 16, 20, 24, 32, 40, 48...)
3. **Usa colores semánticos** (--color-success, no --green)
4. **Prueba en dark mode** todos los componentes nuevos
5. **Mantén el contraste** accesible (WCAG AA mínimo)

---

## 🎯 Componentes y Estados

### Estados de Interacción

Todos los componentes interactivos deben tener estos estados:

```css
/* Normal */
background: var(--color-brand);

/* Hover */
:hover {
  background: var(--color-brand-hover);
}

/* Active/Pressed: an instant colour change, never a move or a scale */
:active {
  background: var(--color-brand-active);
}

/* Focus */
:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

/* Disabled */
:disabled {
  background: var(--color-bg-surface);
  color: var(--color-text-disabled);
  cursor: not-allowed;
  opacity: 0.5;
}

/* Loading */
.loading {
  opacity: 0.7;
  cursor: wait;
  pointer-events: none;
}
```

### Estados de Validación

```css
/* Error */
.error {
  border-color: var(--color-error);
  background: var(--color-error-soft);
}

/* Success */
.success {
  border-color: var(--color-success);
  background: var(--color-success-soft);
}

/* Warning */
.warning {
  border-color: var(--color-warning);
  background: var(--color-warning-soft);
}
```

---

## 🚫 No motion

**Nothing in the interface animates.** No keyframes, no transitions, no smooth scrolling and no script-driven animation. Decided on 2026-10-12.

### Why

- The staff use low-end phones. A pulsing late-table border kept the main thread 98-99 % busy on the Salón floor with five late tables (5.8 % with it off, 1.1 % with all animation off). Composer animations cost up to ~40 ms per tap, and the header "En vivo" dot cost ~4 points of idle CPU.
- Library animations (Radix dialogs, sheets and menus through `tailwindcss-animate`, sonner toasts) ran on every open and close.
- A service tool should answer at once: a state change is information, not a show.

### What replaces motion

Visual states still exist (hover, pressed, focus, selected, disabled, late). They switch instantly.

| Before | Now |
| --- | --- |
| Late table: pulsing `box-shadow` (`.floor-late`) | Static destructive border and ring, plus the word "Atrasada" inside the card, so the signal is not colour only |
| "En vivo" and loading dot (`.pulse-dot`) | A static dot (the class keeps its name) |
| Pressed feedback with `transform: scale(...)`, `active:scale-*`, `active:translate-y-px` | An instant background, border or tone change (`:active { background: ... }`, `active:brightness-90`). Pressed never moves or scales |
| Skeletons with `animate-pulse` | Static blocks |
| Spinners with `animate-spin` | Text such as "Cargando…", or a static icon next to text. Keep `role="status"` where it exists |
| Radix dialogs, sheets, menus, popovers, tooltips (`animate-in/out`, `fade-*`, `zoom-*`, `slide-*`, `duration-*`) | They appear and disappear at once. Radix unmounts immediately when no animation is defined |
| Accordion height animation and chevron easing | Instant open and close. The chevron rotates as a state, not as an animation |
| sonner toasts | Same component. The global rule below removes its transitions |
| `window.scrollTo({ behavior: 'smooth' })` | `behavior: 'instant'` |
| recharts bars, slices and tooltip | `isAnimationActive={false}` on every animated part |

### How it is enforced

- **One global safety rule** in `src/index.css`: `*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }`. It catches third-party and future markup. It is the only `animation` or `transition` declaration allowed in the source.
- **A guard test**, `src/__tests__/NoMotion.test.js`, scans `frontend/src` (tests excluded), `frontend/public` and `tailwind.config.js`. It fails on: `@keyframes`; `animation`, `transition` or `scroll-behavior` declarations other than the safety rule; `--transition-*` tokens; `animate-*`, `transition*`, `duration-*`, `ease-*` and `delay-*` utilities; Radix `fade`, `zoom`, `slide` and `spin` `in/out` utilities; pressed (`:active`, `active:`) moves and scales; smooth scrolling; `element.animate()`; animation libraries; and recharts parts without `isAnimationActive={false}`. It also requires the safety rule to exist.
- **Tailwind** loads no animation plugin, defines no `keyframes` or `animation` extension, and skips test files when it scans for classes, so the class names a test quotes do not end up as CSS.
- **Toasts**: use `toast.success`, `toast.error` and `toast.info`. The result icon of sonner's `toast.promise` appears through a keyframe, so under the safety rule it would stay invisible.

### When you add UI

- Express hover, pressed, focus, selected, disabled and late states with colour, border, ring or text. Do not reach for `transform`, `opacity` easing or `@keyframes`.
- Say it with words as well as colour (for example "Atrasada"), and keep `role="status"` text for loading.
- If the guard fails, remove the motion. Do not add an exception: the safety rule is the only one.

---

## 🔧 Mantenimiento

### Agregar un Nuevo Token

1. Añade la variable en `tokens.css`
2. Documenta su uso en este README
3. Actualiza los temas si es necesario

### Modificar un Tema Existente

1. Edita el archivo del tema en `public/themes/`
2. Prueba en light y dark mode
3. Verifica que todos los componentes se ven correctos

### Deprecar un Token

1. Marca el token como `@deprecated` en `tokens.css`
2. Busca todos sus usos en el código
3. Reemplázalos con el token nuevo
4. Elimina el token deprecado

---

## 📚 Recursos Adicionales

- [Tokens.css](../src/styles/tokens.css) - Definición completa de tokens
- [Temas](../public/themes/) - Archivos de temas
- [ThemeContext](../src/contexts/ThemeContext.jsx) - Lógica de temas
- [Configuración](../src/pages/Configuracion.jsx) - UI de selección de tema

---

## 🆘 Soporte

Si tienes dudas o necesitas ayuda:

1. Revisa este README
2. Consulta los temas existentes como referencia
3. Pregunta en el canal de desarrollo

---

**Última actualización**: 2026-10-02  
**Versión**: 2.0.0
