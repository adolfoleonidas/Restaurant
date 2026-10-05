# Asistente de voz para Cocina, Salón y Caja

Un asistente que **anuncia en voz** lo que pasa en el local (pedido nuevo, pase listo, cuenta
solicitada, comprobante por revisar) y, más adelante, **acepta comandos hablados**
("pasalo a preparación", "finalizá el 12") y **responde consultas** ("¿qué falta?").

La prioridad del diseño es **no tocar el flujo actual**: el asistente es un **consumidor** del
bus de eventos y de los endpoints que ya existen. Nunca escribe en la base ni saltea reglas.

**Estado:** diseño. No hay código de esta feature todavía.

---

## Camino rápido (las 6 decisiones que importan)

1. **Aditivo y con interruptor**: todo detrás de un flag, **apagado por defecto**. Si no se usa, el sistema se comporta igual que hoy.
2. **Reutiliza el bus existente**: `emit_order` / `emit_notice` → SSE `GET /api/notifications/stream` (ya filtra por restaurante y **sucursal**).
3. **Los comandos usan los MISMOS endpoints** (`/orders/{id}/bump`, `/orders/{id}/status`, …) → mismos permisos, reglas y scope de sucursal.
4. **Proveedores enchufables**: TTS, STT y "cerebro" detrás de interfaces; se puede cambiar navegador ↔ nube sin tocar la app.
5. **Degradación, no falla**: sin soporte de voz en el navegador → subtítulos/avisos visuales.
6. **Tres fases**: anuncios (TTS) → comandos (STT) → consultas. Una por commit.

---

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Acoplamiento | Consumidor del bus + APIs existentes | Cero riesgo para pedidos/cocina/caja |
| Activación | Flag por dispositivo (localStorage) en Fase 1; setting por restaurante después | Fase 1 sin tocar backend |
| Mutaciones | Siempre por endpoint, **con confirmación** e idempotencia | Respeta RBAC, sucursal y reglas de negocio |
| TTS | `window.speechSynthesis` (Fase 1) | Gratis, offline, sin API keys |
| STT | `SpeechRecognition` navegador (Fase 2) o Whisper | Chrome/Edge; alternativa si hay requisito de privacidad |
| Cerebro | Reglas (Fase 2) → LLM opcional (Fase 3) | Empezar sin dependencias externas |
| Cola de voz | `SpeechQueue` con prioridad y "silencio" | Evita solapamientos y saturación |
| Alcance | Cocina · Salón · Caja | Definido por producto |

---

## Arquitectura

```
   Eventos backend                          Comandos de voz
 emit_order / emit_notice                     🎤 micrófono
          │                                         │
   SSE /notifications/stream                SpeechRecognition (STT)
          │                                         │
          └───────────►   AssistantCore   ◄─────────┘
                              │
         ┌────────────────────┼─────────────────────┐
     SpeechQueue         IntentRouter          AnswerEngine
   (habla en cola,      (texto → intención     (consultas, solo
    prioridad,           → endpoint)            lectura)
    cancelable)
                              │
                      api.post(...)   ← MISMOS endpoints (RBAC + sucursal + reglas)
```

### Componentes (todos aislados, ninguno dentro de Cocina/Salón/Caja)

| Componente | Responsabilidad | No hace |
|---|---|---|
| `AssistantProvider` | Estado, flag on/off, elección de proveedores | No conoce reglas de negocio |
| `useAnnouncements` | Se cuelga del stream/señal y **encola frases** | No habla ni muta |
| `SpeechQueue` | Habla **de a una**, con prioridad, `cancel()` ("silencio") | No decide contenido |
| `IntentRouter` | Texto → intención estructurada → endpoint | No escribe en la base |
| `AnswerEngine` | Responde consultas con datos de endpoints GET | Solo lectura |
| `AssistantBar` | UI: micrófono, subtítulos, encendido/apagado | No vive en las páginas hijas |

`AssistantBar` se monta una sola vez en el `AppShell`, al lado de `KitchenAlerts`.

---

## Anuncios (Fase 1)

Fuente: el **mismo bus** que ya usa `KitchenAlerts` (SSE + polling de respaldo).

| Área | Evento | Frase |
|---|---|---|
| Cocina | Pedido nuevo (`enviado_cocina`) | "Nuevo pedido, mesa 5, tres platos" |
| Cocina | Pase completo | "Mesa 5 completa, a retirar" |
| Salón | `listo` | "Mesa 5 lista para entregar" |
| Salón | `pendiente_pago` | "Mesa 5 pidió la cuenta" |
| Caja | Cuenta solicitada | "Cuenta solicitada, mesa 5" |
| Caja | `comprobante_subido` | "Comprobante nuevo por revisar" |

**Reglas de la cola**

- **Coalescing**: si entran 3 pedidos juntos → "3 pedidos nuevos: mesas 5, 6 y 7".
- **Prioridad**: cobro/cuenta > pedido nuevo > informativo.
- **Anti-spam**: por mesa, no repetir el mismo anuncio en < 60 s.
- **Silencio**: comando o botón corta la cola en curso.

---

## Comandos (Fase 2) — todos por endpoints existentes

| Frase | Intención | Endpoint | Permiso que aplica el backend |
|---|---|---|---|
| "pasalo a preparación" | `bump.ready` | `POST /orders/{id}/bump` | cocina/admin |
| "marcalo listo" | `bump.done` | `POST /orders/{id}/bump` | cocina/admin |
| "entregalo" | `serve` | `POST /orders/{id}/serve` | mozo/admin |
| "finalizá la mesa 5" | `close_attention` | `POST /orders/{id}/attention/close` | admin/mozo/cajero |
| "confirmá el comprobante" | `confirm_payment` | `POST /orders/{id}/confirm-payment` | admin/cajero |
| "repetí" | `repeat` | — (voz) | — |
| "silencio" | `mute` | — (voz) | — |

**Reglas de seguridad de comandos**

1. **Se resuelve el pedido antes de actuar**: "el 12", "la mesa 5", "el último". Si hay ambigüedad → **pregunta**, no adivina.
2. **Confirmación hablada** para mutaciones: *"¿Paso el pedido 12 a preparación? Decí sí o no"*.
3. **El backend manda**: si el rol no alcanza, se responde "no tenés permiso" y no pasa nada.
4. **Idempotencia**: reintentos seguros (los endpoints ya tienen guardas de versión).
5. **La cola se respeta**: "el siguiente" toma el pedido más antiguo en ese estado.

---

## Consultas (Fase 3)

| Pregunta | Fuente (solo lectura) |
|---|---|
| "¿Qué pedidos faltan?" | `GET /orders/kitchen` + `GET /orders?active_only=true` |
| "¿Cuánto lleva la mesa 5?" | tiempo desde `created_at` del pedido activo |
| "¿Hay comprobantes por revisar?" | `GET /payments/proofs?pending=true` |
| "¿Cómo va la caja?" | `GET /cash/current` + totales del turno |

Con reglas alcanza para Fase 3a. Un **LLM** (Fase 3b) solo aporta si se quiere lenguaje libre;
se enchufa como proveedor y **solo recibe datos ya filtrados por permisos**, nunca acceso a la base.

---

## Proveedores enchufables

| Interfaz | Fase 1 | Alternativas |
|---|---|---|
| `TtsProvider` | `speechSynthesis` | ElevenLabs, Azure TTS, Piper local |
| `SttProvider` | `SpeechRecognition` | Whisper (API o local), Deepgram |
| `BrainProvider` | Reglas | LLM (OpenAI/Claude/local) |

Se eligen por configuración; la app no cambia. Si un proveedor falla, se cae al anterior y,
en el peor caso, a **subtítulos**.

---

## Escalabilidad (sin reescribir)

- **TTS del lado servidor**: si mañana se quiere una **bocina fija en cocina** (sin navegador),
  se agrega un servicio que **consume el mismo bus** (`subscribe()`) y sintetiza audio. El
  frontend no cambia.
- **Multi-sucursal**: los eventos ya vienen filtrados por sucursal; cada cocina anuncia solo lo suyo.
- **Multi-idioma**: las frases salen de un **catálogo de plantillas** (no strings sueltos).
- **Muchas tablets**: los anuncios son por dispositivo; no hay estado compartido en el servidor.

---

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| STT del navegador manda audio a Google | Privacidad | Avisar en la UI; alternativa Whisper |
| STT solo en Chrome/Edge | Compatibilidad | Degradar a texto; documentar navegador soportado |
| Falsos positivos de voz | Acción no deseada | Confirmación hablada + permisos del backend |
| Ruido de cocina | Mala transcripción | Push-to-talk, vocabulario acotado, confirmación |
| Anuncios solapados | Ininteligible | `SpeechQueue` con prioridad y coalescing |
| Audio bloqueado por el navegador | No suena | Desbloqueo en el primer toque (ya lo hace `KitchenAlerts`) |

---

## Fases y verificación

| Fase | Entrega | Commit | Cómo se verifica |
|---|---|---|---|
| 1 | Anuncios TTS + `AssistantBar` (flag off por defecto) | `feat(assistant): voice announcements` | Unit de `SpeechQueue`/plantillas; E2E: flag off no cambia nada |
| 2 | Comandos STT con confirmación | `feat(assistant): voice commands` | Unit de `IntentRouter`; integración: comando → endpoint correcto |
| 3 | Consultas (reglas, luego LLM opcional) | `feat(assistant): voice queries` | Unit de `AnswerEngine` con datos mockeados |

**Pruebas** — nada de audio real en CI: se **mockean** `speechSynthesis` y `SpeechRecognition`.
La suite actual (Jest + Playwright) debe seguir verde en cada fase.

---

## Fuera de alcance (por ahora)

- Wake word continua siempre-escuchando (consume batería y red).
- Voz personalizada por usuario / clonación.
- Reconocimiento de voz de los **clientes** en la carta web.
- Comandos sobre configuración (precios, altas) — solo operación.

---

## Checklist antes de implementar

- [ ] Alcance confirmado: Cocina · Salón · Caja
- [ ] Fase 1 sin cambios de backend (flag por dispositivo)
- [ ] Frases en catálogo de plantillas (no strings sueltos)
- [ ] Toda mutación pasa por endpoint + confirmación
- [ ] Degradación a texto definida
- [ ] Tests con audio mockeado; suite existente verde

## Próximo paso

Implementar la **Fase 1** (anuncios) en una rama propia, con el flag apagado por defecto.
