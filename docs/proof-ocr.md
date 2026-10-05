# Lectura de comprobantes con IA (OCR de Yape/Plin)

Un proceso que **lee las capturas** de Yape/Plin subidas contra una cuenta, extrae
**monto, método, fecha y N° de operación**, y entrega un **reporte diario** con lo cobrado
y las diferencias contra lo registrado en el sistema.

**Regla de oro:** la IA **propone**, el humano **confirma**. Nunca se registra un pago por OCR.

**Estado:** diseño. No hay código de esta feature todavía.

---

## Camino rápido (las 6 decisiones que importan)

1. **Nunca auto-cobrar**: la lectura es una *sugerencia* que el cajero confirma con un tap.
2. **Proveedores enchufables**: `ProofReader` con dos implementaciones — **Tesseract local** y **Vision-LLM**. Se decide con precisión real medida.
3. **Flag en Ajustes** (`proof_ocr`), **apagado por defecto**: apagado no se procesa nada ni se gasta.
4. **Job en el servidor**: procesa pendientes aunque nadie tenga el navegador abierto.
5. **La sugerencia vive en el pedido**, en campos propios; el pago sigue siendo un acto humano.
6. **Conciliación diaria**: leído vs registrado, con las diferencias a la vista.

---

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Autoridad | La sugerencia nunca mueve dinero | Un OCR que lee mal = cobro mal |
| Ejecución | Job server-side sobre pendientes | El reporte del día no depende de una tablet prendida |
| Almacenamiento | Campos `proof_ai_*` en el pedido | Trazabilidad sin tocar el modelo de pagos |
| Idempotencia | Se procesa cada comprobante **una vez**; reintento manual | Evita costo y lecturas duplicadas |
| Duplicados | N° de operación + ventana de tiempo | Dos capturas del mismo pago |
| Privacidad | Proveedor local por defecto; nube solo con aviso | La captura tiene datos personales |
| Activación | Flag `proof_ocr` en Ajustes → Funciones | Coherente con el resto de módulos |

---

## Arquitectura

```
 Captura (base64, ya guardada en el pedido)
              │
      Job de pendientes  ──►  ProofReader (proveedor enchufable)
      (server-side)                 │
                          ┌─────────┴──────────┐
                    Tesseract local       Vision-LLM
                   (sin costo, no         (preciso, costo
                    sale del server)       por imagen, sale a la nube)
                          │
                          ▼
             { monto, método, fecha, operación, titular, confianza }
                          │
                 se guarda en el pedido como SUGERENCIA
                          │
        ┌─────────────────┴──────────────────┐
   UI Comprobantes                    Reporte diario
   ("leído vs esperado")              (conciliación)
                          │
                 el humano confirma ──► pago registrado (flujo actual)
```

### Componentes

| Componente | Responsabilidad | No hace |
|---|---|---|
| `ProofReader` (interfaz) | Imagen → datos leídos + confianza | No decide ni cobra |
| `TesseractReader` | Implementación local | — |
| `VisionReader` | Implementación nube | — |
| `proof_job` (server) | Toma pendientes, llama al proveedor, guarda | No registra pagos |
| UI Comprobantes | Muestra leído vs esperado, permite re-leer | No auto-confirma |
| Reporte diario | Agrupa y concilia | No modifica datos |

---

## Datos extraídos

| Campo | Ejemplo | Para qué se usa |
|---|---|---|
| Monto | `45.00` | Pre-carga el cobro y se compara con el total de la cuenta |
| Método | `yape` / `plin` | Valida contra el método declarado al subir |
| Fecha y hora | `2026-10-04 21:14` | Ubica el comprobante en el turno correcto |
| N° de operación | `0012345` | Detecta la **misma captura subida dos veces** |
| Titular | `J. Pérez` | Verificación visual del cajero |
| Confianza | `0.0 – 1.0` | Por debajo del umbral: se marca "revisar a mano" |

---

## Cómo lo ve el cajero

En **Comprobantes**, cada fila suma una línea:

> Pedido #12 · Mesa 7 · **Leído: S/ 45,00** · Esperado: S/ 45,00 · **Coincide** ✅

- **Coincide** → el cobro se pre-carga con ese monto; el cajero confirma.
- **No coincide** → se resalta la diferencia y el cajero decide.
- **No legible / confianza baja** → no se sugiere nada (nunca inventar un monto).

---

## Reporte diario y conciliación

`GET /reports/proofs?period=day` (admin/cajero, con scope de sucursal).

| Método | Comprobantes | Leído por IA | Registrado | Diferencia | Coinciden |
|---|---|---|---|---|---|
| Yape | 12 | S/ 1,240.00 | S/ 1,240.00 | S/ 0.00 | 11 / 12 |
| Plin | 4 | S/ 380.00 | S/ 340.00 | S/ 40.00 | 3 / 4 |

Y los casos que el dueño quiere ver, explícitos:
- **Leído ≠ registrado** (posible error de cobro o de tipeo).
- **Duplicados** (mismo N° de operación en dos pedidos).
- **Sin leer** (pendientes, o ilegibles).

---

## Proveedores: cuál elegir

| Criterio | Tesseract local | Vision-LLM |
|---|---|---|
| Costo | $0 | Por imagen |
| Privacidad | La captura **no sale** del servidor | La captura **sale** a la nube |
| Precisión en capturas de app | Media (fuentes, fondos, logos) | Alta |
| Dependencia | Ninguna | API key y conexión |
| Ideal para | Volumen alto, datos sensibles | Precisión primero |

**Recomendación honesta:** implementar **ambos** con la misma interfaz, medir con
comprobantes reales del local y elegir por dato, no por intuición. Empezar por el local
para no mandar datos personales afuera sin decidirlo explícitamente.

---

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Lectura incorrecta del monto | Cobro mal hecho | El humano confirma; nunca automático |
| Misma captura en dos pedidos | Doble conteo | N° de operación + ventana de tiempo |
| Imagen ilegible | Sugerencia inventada | Umbral de confianza; se marca para revisión |
| Datos personales a la nube | Privacidad | Proveedor local por defecto; aviso al activar la nube |
| Costo por imagen | Factura inesperada | Solo pendientes, una vez cada uno, resultado cacheado |
| Texto de la captura manipulado | Fraude | El OCR **no** confirma: sigue el control humano y la auditoría ya existente |

---

## Fases

| Fase | Entrega | Verificación |
|---|---|---|
| 1 | Interfaz `ProofReader` + campos `proof_ai_*` + botón **"Leer ahora"** en Comprobantes | Unit con imágenes mockeadas; E2E: flag off no muestra nada |
| 2 | Job de pendientes automático | Unit del job; idempotencia (no re-lee ya leído) |
| 3 | Reporte diario + conciliación (`/reports/proofs`) | Unit de la agregación; E2E del reporte |
| 4 | (opcional) Pre-carga del monto en el diálogo de cobro | E2E del cobro sugerido |

**Pruebas**: nada de llamadas reales en CI — el proveedor se **mockea**. La suite actual
(Jest + Playwright) debe seguir verde en cada fase.

---

## Fuera de alcance

- **Auto-confirmar** pagos o cerrar cuentas por OCR.
- Leer comprobantes ajenos al local.
- Facturación electrónica / validación fiscal.
- Reconocimiento de capturas de otros métodos (transferencia bancaria) en la Fase 1.

---

## Checklist antes de implementar

- [ ] Flag `proof_ocr` visible en Ajustes → Funciones
- [ ] Umbral de confianza definido con el usuario
- [ ] Proveedor local como default; nube solo con aviso explícito
- [ ] La sugerencia **no** altera pagos ni saldos
- [ ] Re-leer es manual y queda en auditoría
- [ ] Tests con proveedor mockeado; suite existente verde

## Próximo paso

Fase 1: interfaz `ProofReader` + almacenamiento de la sugerencia + botón "Leer ahora"
en Comprobantes, con el flag apagado por defecto.
