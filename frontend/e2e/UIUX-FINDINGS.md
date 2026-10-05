# UI/UX Findings — MVP Flow Validation (Playwright)

Basado en la ejecución real del flujo **mozo → cocina → cuenta → caja → cobro**
contra el stack local con datos seed (desktop + mobile emulado). Los hallazgos
provienen de la ejecución E2E y de la inspección de las pantallas recorridas;
los artefactos de cada paso quedan en `e2e/artifacts/`.

## Resumen

El flujo core funciona de punta a punta sin errores de bloqueo. La app es
táctil y rápida, con estados por color bien definidos en el piso (Libre,
Preparando, Listo, Cuenta, Pagada). No se encontró ningún **P0** (bloqueante).

## P1 — Fricción mayor

1. **La mesa no se libera sola al pagar.**
   Tras registrar el pago, la mesa queda en estado "Cuenta pagada" con una
   *visita/atención abierta* y exige un paso extra en otra pantalla:
   `Servicio → Finalizar mesa` (`POST /orders/:id/attention/close`).
   El sheet de Mesas lo dice explícitamente: *"La visita sigue abierta.
   Finalizala en Servicio"*. Para un mozo/cajero en hora pico esto es un paso
   manual fácil de olvidar y la mesa queda "ocupada" aunque ya cobró.
   - Sugerencia: ofrecer un botón "Liberar mesa" directamente desde el cobro
     exitoso o desde el sheet de Mesas cuando la cuenta ya está pagada, o al
     menos un recordatorio visible.

## P2 — Fricción moderada

2. **La raíz de la app no es el login del personal.**
   `/` renderiza la carta pública (Landing). El personal debe ir explícitamente
   a `/login`. El smoke test original asumía que `/` era el login y fallaba.
   - Sugerencia: si el visitante no está autenticado, redirigir `/` al login
     para el personal, o mostrar un acceso claro "Entrar al salón" en el
     landing público.

3. **El cobro en efectivo exige doble confirmación.**
   El CobrarDialog pide "Efectivo recibido" → "Registrar efectivo" → checkbox
   *"Recibí el efectivo y comprobé el vuelto"* → "Registrar". Es una red de
   seguridad contra errores, pero añade taps en un cobro rutinario.
   - Sugerencia: mantener la verificación por defecto, pero permitir un modo
     "cobro rápido" configurable para efectivo exacto.

## P3 — Menor / positivo

4. **Mobile funciona muy bien.** El teclado numérico en pantalla, el botón
   "Exacto" y la grilla de 6 métodos hacen el cobro táctil rápido y sin
   teclado físico. (Verificado en el spec `flow.mobile.spec.ts`.)

5. **Estados con color y prioridad.** El piso ordena las mesas por prioridad
   (Cuenta → Listo → Atención → …) y usa colores consistentes; el pase de
   cocina muestra "Llegan / Al fuego / Esperando retiro / Retirado" con
   tiempos transcurridos. Bien resuelto para operar de un vistazo.

6. **Copy profesional en español neutro** (sin voseo) en los textos
   principales; consistente entre módulos.

## Qué necesita el mozo mañana (checklist operativo)

- Iniciar sesión en `/login` (las cuentas demo están en la pantalla de login).
- Tomar mesa → armar pedido → **Enviar a cocina**.
- Cocina avanza con **Pasar a fuego** → **Avanzar pedido**.
- Al tener la comida, **Solicitar cuenta** en el detalle del pedido.
- Cajero abre caja y cobra desde **Cuentas solicitadas**.
- **No olvidar** `Servicio → Finalizar mesa` después de cobrar (P1).
