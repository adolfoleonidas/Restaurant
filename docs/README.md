# Documentación

Este directorio mezcla dos tipos de documentos y conviene no confundirlos:

- **Contrato del producto** (`spec/`, `estados-y-flujo.md`, `design-system.md`): describe cómo *debe* comportarse el sistema. Si el código y estos documentos discrepan, es un bug (del código o del documento).
- **Fotografías del momento** (`audit/`, `ui-ux-audit.md`, `delivery-readiness-audit.md`): auditorías con fecha. No se actualizan; sirven como evidencia histórica de lo que se encontró y se corrigió.

## Por dónde empezar

| Quiero… | Empieza en |
|---|---|
| Verlo funcionando en 5 minutos | [recorrido-demo.md](recorrido-demo.md) |
| Instalarlo o desplegarlo en un restaurante real | [day-one-runbook.md](day-one-runbook.md) |
| Entender el problema, el alcance y las decisiones de producto | [spec/PRD-restaurante-saas-v1.0.md](spec/PRD-restaurante-saas-v1.0.md) |
| Entender el negocio: entidades, ciclos de vida, reglas | [spec/modelo-de-dominio-restaurante-saas-v0.1.md](spec/modelo-de-dominio-restaurante-saas-v0.1.md) |
| Saber qué estados existen y qué transiciones son válidas | [estados-y-flujo.md](estados-y-flujo.md) |
| Tocar una pantalla sin improvisar su diseño | [spec/especificacion-ui-ux-pantallas-v0.1.md](spec/especificacion-ui-ux-pantallas-v0.1.md) y [design-system.md](design-system.md) |
| Ver qué está implementado y qué falta | [spec/analisis-de-brecha.md](spec/analisis-de-brecha.md) |
| Revisar lo entregado, funcionalidad por funcionalidad | [releases/](releases/) |
| Saber cómo se comporta en móvil | [mobile-adaptation.md](mobile-adaptation.md) |
| Ver el historial de auditorías y sus hallazgos | [audit/](audit/), [ui-ux-audit.md](ui-ux-audit.md) |

El índice de la especificación, con el orden de lectura recomendado y las reglas para mantenerla, está en [spec/README.md](spec/README.md).

## Funcionalidades con documento propio

| Tema | Documento |
|---|---|
| Menú del día | [menu-del-dia.md](menu-del-dia.md) |
| Modo «solo pedidos» (sin validar cobro al liberar mesa) | [modo-solo-pedidos.md](modo-solo-pedidos.md) |
| Asistente de voz | [voice-assistant.md](voice-assistant.md) |
| OCR de comprobantes | [proof-ocr.md](proof-ocr.md) |
| QR de mesa y prepago | [releases/mesa-qr-prepago.md](releases/mesa-qr-prepago.md), [releases/table-qr-access.md](releases/table-qr-access.md) |
| Recojos de días anteriores | [releases/prior-day-pickups.md](releases/prior-day-pickups.md) |

## Convenciones

1. **Un cambio de comportamiento actualiza el documento de nivel más alto que aplique**: PRD → modelo de dominio → especificación funcional → UI/UX. Después se propaga hacia abajo.
2. **Los documentos llevan su estado en el encabezado** (`Borrador`, `Final aprobado`, `Vivo`). No se borra el historial: si el cambio es grande, se crea `v0.2`, `v1.1`.
3. **Las auditorías no se editan.** Un hallazgo corregido se marca en el documento de la auditoría siguiente, no reescribiendo la anterior.
4. **Los enlaces son relativos al repositorio**, para que funcionen igual en GitHub y en un clon local.
