# Remove all animations

## Objective and problem

The user decided on 2026-10-12: no animations anywhere in the app. A Playwright bisect the same day measured that the late-table indicator (`.floor-late`, an infinite `box-shadow` animation, `index.css` ~243–251, `MesaCard.jsx`, `GroupCard.jsx`) keeps a low-end phone's main thread 98–99 % busy on the Salón floor with five late tables (5.8 % with it off, 1.1 % with all animation off), and that composer animations cost up to ~40 ms per tap. The header `pulse-dot` costs ~4.4 points of idle CPU. Library animations (Radix dialogs, sheets, menus via `tailwindcss-animate`; sonner toasts) also run on every open and close.

Footprint at the start: 19 animation/transition declarations in CSS, 49 source files using `animate-*`, `transition-*`, or `duration-*` utilities, and 1 smooth-scroll or `element.animate()` call.

## Scope and authority

- Branch: `perf/remove-animations` from origin/main `73bad50`.
- User authorized removing every animation and merging, in chat on 2026-10-12.
- Visual states stay, motion goes: hover, pressed, focus, selected, and late states change instantly. Pressed feedback must not move or scale (instant color/border change).
- The late-table indicator becomes static: destructive border/ring plus a visible "Atrasada" label, so it is not color-only.
- No package installs or removals (`package.json` and the lockfile stay unchanged); removing `tailwindcss-animate` from the Tailwind `plugins` list is allowed.
- UI copy Spanish tuteo; code, tests, docs, commits English.

## Implementation and checking

- Route: delegated direct, one bounded writer.
- TDD: **on** (global configuration). Guard and behavior tests first.
- Frontend: `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4` (baseline from the writer's first run) and `CI=true npx craco build`.
- Parent browser check on a rebuilt stack: `document.getAnimations().length === 0` on the main screens; dialogs, sheets, menus, selects, and toasts open and close correctly; late tables show the static indicator.

## Tasks

- [x] **NA-01 Remove app-owned motion at the source.** Delete every `@keyframes`, `animation`, and `transition` declaration in app CSS; make `.floor-late` a static indicator with an "Atrasada" label; make `.pulse-dot` static; replace the `.composer-card` scale press with an instant non-moving pressed state; remove `animate-*`, `transition-*`, `duration-*`, and `ease-*` utilities from app and `components/ui/*` markup (including Radix `data-[state=...]:animate-in/out`, `fade-*`, `zoom-*`, `slide-in-*` classes); static skeletons; spinners become static icons next to text (or text only); smooth scrolling and `element.animate()` become instant.
- [ ] **NA-02 Global safety net.** One rule in `index.css` that disables any remaining animation and transition (`animation: none`, `transition: none`, `scroll-behavior: auto`, with `!important`) for third-party and future markup; verify Radix presence unmount, sonner toasts, and the sheet/drawer open-close still work.
- [ ] **NA-03 Guard against regressions.** A test that scans `frontend/src` (excluding tests) and fails on `@keyframes`, `animation:`/`transition:` declarations other than the global safety rule, `animate-`/`transition-`/`duration-`/`ease-` utility classes, `behavior: 'smooth'`, and `.animate(` calls.
- [ ] **NA-04 Document the rule.** Add a "No motion" principle to `docs/design-system.md` (why, what replaces motion, how the guard enforces it).

## Progress and evidence

- 2026-10-12: document and branch created.
- 2026-10-12 writer start. Route: delegated direct, one writer. TDD on (global configuration), runner: Jest through CRA, `npx craco test`, from `frontend/`.
- Baseline before any change: `CI=true ENABLE_HEALTH_CHECK=false npx craco test --watchAll=false --maxWorkers=4`: 116 suites, 1002 tests passed (22 s).
- Starting footprint (counted with `rg` over `frontend/src`, tests excluded):
  - CSS: 4 `@keyframes`, 8 `animation*` and 7 `transition*` declarations (the 19 of the objective), 1 `scroll-behavior`, 3 `--transition-*` tokens, 5 `prefers-reduced-motion` blocks.
  - JSX: 49 files / 90 lines with a motion utility (25 `animate-*`, 63 `transition*`, 8 `duration-*`, 1 `ease-*`, 23 Radix `fade/zoom/slide-*`), 3 `active:scale-*`, 1 `behavior: 'smooth'`, 4 recharts parts that animate by default (2 `Tooltip`, `Bar`, `Pie`).
  - Tailwind: `keyframes` and `animation` extensions (accordion) and the `tailwindcss-animate` plugin.
  - Missed by the first inventory and caught by the guard: `active:translate-y-px` in 4 `ui/button.jsx` variants.
- RED (tests first): `... craco test ... src/__tests__/NoMotion.test.js src/__tests__/FloorLateIndicator.test.js src/__tests__/OrderComposerTapFeedback.test.js`: 3 suites failed, 10 tests failed, 51 passed.
  - `NoMotion`: no safety rule; CSS 27 violations in 3 files (`index.css`, `cobro.css`, `tokens.css`); `public/theme-preview.html` 1; app markup and scripts 256 violations in 50 files; Tailwind config 3. The scanner self-tests passed.
  - `FloorLateIndicator`: no "Atrasada" label on a late table or a late group card; `.floor-late` and `.pulse-dot` still animated.
  - `OrderComposerTapFeedback`: the updated assertion (press = background and border, no transform or transition) failed against the scale press.
- NA-01 done. What replaced each motion:
  - Late table (`.floor-late`, `MesaCard`, `GroupCard`): static destructive `border-color` and a 3 px `box-shadow` ring in `index.css`, plus an "Atrasada" pill inside the card (`mesa-card-atrasada-N`, `mesa-grupo-atrasada`). `isLate` logic untouched; no late label existed before.
  - `.pulse-dot` (AppShell "En vivo" dot and the route-loading dot): plain static dot, same class name.
  - Pressed feedback: `.composer-card:active` is `background-color` plus `border-color`; `Button`, `MesaCard` and `GroupCard` actions use `active:brightness-90` (cards add an inner ring); the card info area uses `active:bg-black/5`; cobro `:active` rules are one block that changes `background` and `border-color`. Nothing moves or scales.
  - Cobro: removed the `cobro-pop` and `cobro-nudge` keyframes (the `needs-attention` outline and the hint text stay), the input/button transition, the chevron, mixed-bar and toast transitions, and the reduced-motion block.
  - Skeletons and the public order dot: `animate-pulse` removed (static). There was no `animate-spin` spinner anywhere; loading is text (`Cargando…`, some with `role="status"`).
  - Radix and shadcn `ui/*` (49 files in all): every `animate-*`, `transition*`, `duration-*`, `ease-*`, `fade/zoom/slide-*` token removed; the accordion `keyframes` and `animation` extensions and the `tailwindcss-animate` plugin removed from `tailwind.config.js` (no remaining class needs it; `package.json` and the lockfile untouched).
  - `scrollTo({ behavior: 'smooth' })` in `Landing.jsx` is now `'instant'`; recharts `Bar`, `Pie` and both `Tooltip` use `isAnimationActive={false}`; `--transition-*` tokens and the `theme-preview.html` transition removed.
- Findings: (1) Tailwind scans test files, so the guard's sample class names made the production CSS emit `animate-spin`, `transition`, `scroll-smooth`...; fixed with negated `content` globs in `tailwind.config.js`. (2) Unused `ui/drawer.jsx` (vaul) and `ui/carousel.jsx` (embla) were left in place: nothing imports them.
- GREEN for NA-01: full suite with the guard ignored (`... --testPathIgnorePatterns NoMotion`): 117 suites, 1009 tests passed. The guard alone failed only on the missing safety rule (1 failed, 50 passed). `CI=true npx craco build`: compiled successfully, and the built CSS has 0 `@keyframes`, `animation`, `transition` and `scroll-behavior`.
- Tests changed: `OrderComposerTapFeedback.test.js` (the CSS assertion for the pressed card; docblock). New: `FloorLateIndicator.test.js`; `NoMotion.test.js` (committed with NA-03).

## Next step

NA-02 (global safety rule), NA-03 (guard test) and NA-04 (design-system section).
