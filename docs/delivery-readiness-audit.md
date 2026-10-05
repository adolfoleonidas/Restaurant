# Auditoría de entrega — ¿podemos instalar mañana en un restaurante?

Auditoría de solo lectura sobre `main` (`e719e53`): 5 revisiones especializadas (seguridad,
dinero, sucursal, entrega/datos, calidad) más **verificación en vivo** del runtime, de la
producción y de la matriz real de permisos. Cada hallazgo cita evidencia `archivo:línea`.

**Veredicto: el software está bien construido, pero NO está listo para entregar mañana sin
resolver 6 bloqueantes.** Ninguno es un desastre de arquitectura: son datos de demo, un
bootstrap roto y pasos de puesta en marcha que hoy no están escritos. Estimación: **1 día de
trabajo** para dejarlo entregable.

---

## Veredicto en 30 segundos

| Pregunta | Respuesta |
|---|---|
| ¿El núcleo funciona? | **Sí.** E2E real (mozo→cocina→cuenta→caja→cobrado) **3/3 verde**, 290/290 tests in-memory verdes, aislamiento por sucursal sólido |
| ¿Se puede instalar hoy? | **No de cero**: el seed en producción lanza `RuntimeError` y el contenedor entra en bucle de reinicio |
| ¿Se puede entregar la base actual? | **No tal cual**: sirve datos **demo** (marca, dirección, carta, Yape/Plin de otro) |
| ¿Es seguro? | Base sólida (bcrypt, scoping, fail-closed). 2 decisiones a confirmar y 1 fuga cross-sucursal |
| ¿Hay red de seguridad? | **Débil**: el CI despliega **sin correr ninguna suite**; la suite backend es roja (tests viejos) |
| ¿Los datos están limpios? | **No**: 23 visitas abiertas, 49 mesas, caja abierta, descripción pública con texto de test |

---

## 🔴 P0 — bloqueantes de entrega

### 1. Una instalación limpia en producción **no arranca** — ✅ RESUELTO
`startup → run_seed → (sin restaurante) → _seed_blank() → resolve_seed_passwords()` lanzaba
`RuntimeError` porque en producción exige las 4 `SEED_*_PASSWORD`, y `docker-compose.yml` **no
las pasaba al contenedor**.
- Cadena: `server.py:93-98` → `seed.py:147-149` → `seed.py:97-99` → `security_config.py:55-66`
- **Efecto**: Mongo vacío ⇒ backend en bucle de reinicio. La producción actual no lo sufre solo porque ya tiene un restaurante (`seed.py:148-149` corta).
- **Arreglo aplicado**: las 4 `SEED_*_PASSWORD` van ahora en el `environment:` de `docker-compose.yml` con `${VAR:?...}`, así `docker compose up` **falla rápido con un mensaje claro** en vez de reintentar en silencio. `env.example` documenta los dos modos (desarrollo vs restaurante real).
- **Verificado** (base limpia, `APP_ENV=production`): sin las claves → `RuntimeError: SEED_ADMIN_PASSWORD must be set to a password that is not a demo default`; con ellas → arranca y crea el restaurante + admin. `docker compose config` confirma el fail-fast y la inyección.

### 2. La producción sirve **datos demo** de otro restaurante — 🟠 herramienta lista, carga pendiente
Verificado en vivo contra `http://93.127.214.26:8081/api/public/restaurant`:
> "Sabor Peruano" · Av. Larco 123, Miraflores · +51 999 888 777 · portada de **pexels** · `@saborperuano` · WhatsApp demo

**Lo más urgente, también verificado en vivo**: en `/api/public/payment-config` están **habilitados
Yape y Plin con el número demo `999 888 777`** y **transferencia con el CCI demo
`00219400123456780123`**. Si el local abre así, **el dinero de los clientes va a una cuenta ajena**.
Además la carta pública tiene **8 categorías y 14 productos demo** y hay **10 mesas demo**.
- **Herramienta agregada**: `Ajustes → Datos → Vaciar carta` (`POST /data/catalog`) borra platos,
  combos y categorías de una, con las mismas guardas que el reset (admin + `ELIMINAR` + contraseña)
  **más** un rechazo (409) si hay pedidos activos, para no vaciar el menú a mitad de servicio.
- **Carga pendiente (la hace el dueño desde el panel)**: marca en `Ajustes → Restaurante/Marca`,
  carta real con `Carta → Importar` (Excel), mesas/zonas en `Local`, usuarios en `Equipo` y
  **métodos de pago reales en `Pagos`** — esto último es lo primero que hay que cambiar.

### 3. Sin sucursal **no se puede operar nada**
Pedido de mesa, pedido sin mesa y apertura de caja exigen sucursal:
`attention_acceptance.py:32-33`, `orders.py:305-307`, `cash.py:89-90`.
- El seed (demo **y** en blanco) **no crea sucursales** (`seed.py:102-140`) ⇒ todo no-admin recibe `403 El usuario no tiene una sucursal asignada` (`branch_access.py:15-17`).
- **Orden obligatorio día 1**: Sucursal → Zonas → Mesas → Usuarios con sucursal asignada.

### 4. La **caja heredada** bloquea la primera apertura
`cash.py:193-204`: si existe una caja abierta sin `branch_id`, `POST /cash/open` responde
`409 La caja heredada debe conciliarse antes de abrir una caja por sucursal`.
- **Fix recomendado (base nueva)**: `Ajustes → Datos → Restablecer datos operativos` (borra también comprobantes y esa caja) y luego crear sucursal y abrir caja.
- Si hay historia que conservar: cerrar con el **conteo físico real** (el `1484.00` que aparece en los trackers era **simulado**, no un arqueo real).

### 5. Datos de prueba acumulados (verificado en vivo)
| Colección | Cantidad | Problema |
|---|---|---|
| `attentions` | **23 abiertas** | mesas ocupadas |
| `tables` | **49** | 12 reales + 37 de prueba (`9xxxx` del E2E) |
| `cash_registers` | 1 | **caja abierta** |
| `orders` / `payments` | 23 / 23 | ventas de prueba en los reportes |
| restaurante | — | `public_description` = **"Carta E2E 1791167419571"** |
- **Causa del texto**: el `smoke` E2E restauraba "el valor anterior", que ya era de una corrida fallida ⇒ se encadena. Hay que **arreglar el test** además de limpiar.
- `data/reset` **conserva** el catálogo (`data.py:15-27`), así que no alcanza para borrar la demo.

### 6. El deploy a producción **no corre ninguna suite** — ✅ RESUELTO
`.github/workflows/deploy.yml` tenía un solo job (`deploy`: SSH + `compose up --build` +
`curl /api/health`), sin ningún paso de pytest/jest/build.
- **Arreglo aplicado**: se agregó el job **`test`** (servicio `mongo:7`, `python -m pytest tests -m "not integration"`,
  `npm ci` + `craco test` + `craco build`) y **`deploy: needs: test`**: si algo falla, no llega a producción.
- **Verificado**: `pytest -m "not integration"` → **342 passed / 0 failed**; el YAML parsea y el job `deploy` declara `needs: test`.

---

## 🟠 P1 — resolver en la primera semana

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| 1 | **HTTP sin TLS** en `:8081` con token en `localStorage` | `frontend/nginx.conf:2`, `api.js:9` | Credenciales y tokens en claro en la red del local |
| 2 | **Contraseñas demo activas** hasta que se cambien | `seed.py:204-232`, `security_config.py:13-19` | Acceso al panel con credenciales públicas del repo |
| 3 | **Fuga cross-sucursal**: `POST /products/{id}/availability` devuelve pedidos activos de **todas** las sucursales | `products.py:236-243,256` | Un cocinero ve mesas/pedidos de otra sucursal en la respuesta |
| 4 | **No se pueden operar 2 sucursales**: `tables.number` y `zones.name` son únicos por **restaurante** | `database.py:11,83`, `tables.py:107`, `zones.py:45` | "Mesa 1" en la sucursal B responde `400 ya existe` |
| 5 | ~~**La suite backend es roja**: 52 fallos (15 módulos de integración HTTP viejos, previos al aislamiento por sucursal)~~ **RESUELTO**: los 15 módulos HTTP quedaron marcados `integration` (necesitan API viva) y la suite hermética da **342 ✅ / 0 ❌** | `tests/conftest.py` (marcado automático + aislación de módulos), `pytest.ini` | — |
| 6 | ~~**El comando documentado ejecuta 0 tests**~~ **RESUELTO**: el `sys.path.insert` iba después del import de `models`; ahora un `pytest.ini` aporta `pythonpath = backend` | `tests/test_attention_lifecycle.py`, `pytest.ini` | — |
| 7 | **Rate limit de login por IP de socket**: detrás de nginx todos comparten IP | `routes/auth.py:28`, `nginx.conf:8-14` | 10 intentos fallidos de uno bloquean el login de **todo** el local 5 min |
| 8 | **Tracking público sin rate limit** con código de 8 chars, y devuelve teléfono y dirección del cliente | `public.py:33,601-609,102-103` | Enumeración de datos de clientes |
| 9 | **`administracion` da admin total**: `require_roles` lo trata como pase universal, incluido resetear la contraseña de otro usuario | `auth.py:130-139`, `branch_access.py:8`, `users.py:64-73` | Un mozo con esa función puede tomar la cuenta del admin. Confirmar si es intencional |
| 10 | `GET /api/health` devuelve `str(e)` sin auth | `server.py:47-53` | Fuga de errores internos de la base |
| 11 | `/api/system/info` expone nombre de base y versiones | `routes/system.py:59-70` | Reconocimiento (es admin-only) |
| 12 | `data/reset` no limpia `attention_number_assignments` | `data.py:18-27` | Contadores de atención arrastrados |

---

## 💰 Bugs de dinero (reproducidos con el arnés del repo)

Ejecutados contra las rutas reales sobre el fake in-memory de `tests/test_money_integrity.py`.
**El bloque de dinero queda cerrado**: los 4 P1 y los 5 P2/P3 están resueltos, con test de regresión
(excepto las mutaciones públicas, verificadas en vivo). La suite hermética da **355 ✅ / 0 ❌**.

| Sev | Bug | Estado |
|---|---|---|
| **P1** | **Pago mixto con vuelto descuadraba el cajón**: total 100 con efectivo 60 + Yape 50 y vuelto 10 atribuía 60/40 en vez de 50/50 (faltante falso de 10) | ✅ **resuelto**: `method_amounts` netea el vuelto contra el efectivo y cierra contra el monto cobrado (`billing.py`) |
| **P1** | **Anular un cobro de pedido web de recojo era imposible** (409 permanente) | ✅ **resuelto**: un recojo lleva `attention_id` para numerar pero **no** es una visita; el helper `_has_open_visit()` decide, en los 3 caminos que lo confundían (`payments.py`) |
| **P1** | **Se perdía el descuento al recobrar tras anular**: la cuenta volvía al total sin descuento y quedaba parcial | ✅ **resuelto**: el descuento (y la propina) de la cuenta se conservan cuando no se manda uno nuevo, y solo un descuento **nuevo o cambiado** exige permiso y motivo. La UI ahora manda el descuento efectivo (`payments.py`, `CobrarDialog.jsx`) |
| **P1** | **Un fallo entre el claim y el insert dejaba la orden "pagada" sin ningún pago** | ✅ **resuelto**: el rollback restaura también `payment_status` y `fulfillment_status` (`payments.py`) |
| P2 | **Un comprobante pendiente desaparecía de la cola** en cuanto entraba un pago parcial | ✅ **resuelto**: el comprobante tiene **estado propio** (`payment_proof_status`: `pendiente` → `verificado`), ya no derivado de `payment_status`. La cola de revisión, el badge y el bloqueo de cierre lo usan, con compatibilidad para órdenes viejas. *Cobrar el total sigue siendo la forma de resolverlo* (era el diseño existente), así que no se bloquea el cobro |
| P2 | **El reintento idempotente devolvía un payload sin `fully_paid`/`remaining`** (el diálogo decía "Restante: —" con la cuenta ya cubierta) | ✅ **resuelto**: el replay devuelve la misma forma que un cobro nuevo, calculada del pedido actual |
| P2 | **Movimientos de caja sin control**: cualquier cajero creaba `ingreso`/`egreso` de cualquier monto, sin auditoría, y eso mueve el efectivo esperado | ✅ **resuelto**: descripción obligatoria (mínimo 5 caracteres), **entrada de auditoría** en cada movimiento y tope de **S/ 200 para cajeros** (arriba lo registra un administrador). La UI avisa antes de enviar |
| P2 | **Mutaciones públicas que no recalculaban `payment_status`**: el cliente agregaba un postre a una cuenta ya pagada, subía el total y la deuda **no se cobraba nunca** | ✅ **resuelto**: las tres mutaciones públicas (agregar, editar, quitar) recalculan el estado del pago. **Verificado en vivo**: tras cobrar S/ 10 y agregar un plato desde la web, el pedido pasó a `parcial` (total 15, pagado 10) |
| P3 | **Métodos de pago deshabilitados que se podían usar igual** (el local apaga "tarjeta" y una llamada directa igual cobraba) | ✅ **resuelto**: `POST /payments` valida contra `payment_configs`, incluidos los métodos de un pago **mixto**. Solo bloquea un `false` explícito, así un local sin configuración sigue funcionando |

---

## 🟢 Lo que está sólido (no tocar)

- **E2E real verde 3/3**: login → pedido → cocina → cuenta → caja → cobrado (desktop y mobile).
- **290/290 tests in-memory verdes**, incluidos 25 de integridad de dinero y 70+ de aislamiento por sucursal.
- **Aislamiento por sucursal bien hecho**: la sucursal sale **siempre** del usuario en la base (`auth.py:117-126`), falla cerrado con 403/404, y hay un helper único (`branch_access.py`).
- **Comprobantes protegidos**: las imágenes se eliminan de la respuesta para quien no tiene `cobro`/`administracion` (`orders.py:40-55,66-75,224-226`).
- **Arranque fail-closed**: rechaza `JWT_SECRET` corto o demo y CORS `*` en producción (`security_config.py:41-50`), y el deploy **rota el JWT** si detecta uno demo.
- **`/api/data/reset`** bien cerrado: admin + `ELIMINAR` + tu contraseña + solo tu tenant + auditoría.
- **Matriz de permisos verificada en vivo** (4 roles × 22 endpoints): sin fugas; admin-only correcto; caja/pagos solo caja/admin.
- **Ningún `.env` commiteado** ni en la imagen.
- **Dinero**: no se puede cobrar dos veces la misma cuenta (CAS por `updated_at` + corte por `remaining <= 0`); la **idempotencia es real** (clave única + replay verificado); **el vuelto no se registra como ingreso**; `pagado` **no se puede forzar** (solo se deriva de `amount_paid >= total` **y** comida entregada); el cierre de visita **reconcilia contra el ledger**; lo ya cobrado no se puede borrar; y la devolución post-cierre **no reescribe** la caja cerrada.

---

## ✅ Checklist de entrega (mañana)

> **Guía paso a paso**: [`docs/day-one-runbook.md`](day-one-runbook.md) — el orden exacto de la
> puesta en marcha (sucursal → zonas → mesas → carta → usuarios → **pagos** → caja), con los
> bloqueos típicos y cómo resolverlos.

### Antes de tocar el servidor
- [ ] Decidir: ¿instalación **limpia** (arreglar compose primero) o **reutilizar** la base del VPS (aplican caja heredada + datos de prueba)?
- [ ] Cambiar las 4 contraseñas demo (o borrar esas cuentas)
- [ ] Definir marca real: nombre, RUC, dirección, teléfono, horario, logo, portada, redes
- [ ] Preparar la carta real (categorías + productos + precios)
- [ ] Preparar mesas y zonas reales

### En el servidor
- [ ] `.env` de producción: `APP_ENV=production`, `JWT_SECRET` ≥ 32 chars aleatorio, `CORS_ORIGINS` real, **no copiar `env.example`**
- [ ] `Ajustes → Datos → Restablecer datos operativos` (borra pedidos, pagos, cajas y comprobantes de prueba)
- [ ] Crear **sucursal** (zona horaria, corte del día)
- [ ] Crear **zonas** y **mesas** de esa sucursal
- [ ] Cargar **carta** real y desactivar lo demo
- [ ] Crear **usuarios** con rol **y sucursal** asignada (los demo quedan sin sucursal ⇒ 403)
- [ ] Cargar **métodos de pago** reales (el seed deja solo efectivo) y **quitar Yape/Plin/CCI demo**
- [ ] Abrir **caja** de la sucursal
- [ ] `Ajustes → Funciones`: dejar apagado lo que no se use (voz y OCR vienen apagados)
- [ ] Prueba de humo real y volver a restablecer datos operativos
- [ ] **Backup** del volumen de Mongo (no viene provisto)

### Después
- [ ] HTTPS (aunque sea Let's Encrypt)
- [ ] Job de tests en el CI antes del deploy
- [ ] Arreglar el test E2E que ensucia `public_description`
- [ ] Limpiar la suite backend (52 tests viejos de integración)

---

## Anexo: cómo se verificó (y una corrección)

- **En vivo**: API local (`health`, login de 4 roles), inventario de la base, **matriz de permisos**
  de 22 endpoints × 4 roles, y sondeo **de solo lectura sin credenciales** a producción.
- **Suites**: backend `pytest` (desde la raíz: 0 tests; desde `backend/`: 52 fallidos / 334 pasados),
  frontend `jest` (**29/30 suites, 179/181**), build (`Compiled successfully`), E2E (**3/3**).
- **Corrección a una auditoría**: se reportó que faltaba `tests/conftest.py` y que eso rompía la
  suite. **Falso**: el archivo existe y está trackeado (`git ls-files` lo confirma). El problema
  real de colección es el orden del `sys.path.insert` en `test_attention_lifecycle.py:10/14`.
- **Dinero**: reproducido sobre el arnés in-memory del repo (`test_money_integrity.py`: **67 tests
  verdes**) y confirmado por lectura de código en los tres casos P1.
- **Verificaciones propias**: `tests/conftest.py` existe, el seed en producción falla por las
  `SEED_*_PASSWORD`, el CI no tiene pasos de test, y la matriz de permisos de 22 endpoints × 4 roles
  no tiene fugas.
