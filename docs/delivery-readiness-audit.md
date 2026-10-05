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

### 2. La producción sirve **datos demo** de otro restaurante
Verificado en vivo contra `http://93.127.214.26:8081/api/public/restaurant`:
> "Sabor Peruano" · Av. Larco 123, Miraflores · +51 999 888 777 · portada de **pexels** · `@saborperuano` · WhatsApp demo

Y el seed demo **habilita Yape/Plin/transferencia con números de teléfono y CCI demo**
(`seed.py:181-202`): si el restaurante no los cambia, **el dinero de sus clientes puede ir a una
cuenta ajena**. Además crea 4 cuentas con contraseñas conocidas (`seed.py:204-232`).
- **Fix**: cargar marca, carta, mesas, usuarios y métodos de pago reales antes de abrir.

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

### 6. El deploy a producción **no corre ninguna suite**
`.github/workflows/deploy.yml` tiene un solo job (`deploy`: SSH + `compose up --build` +
`curl /api/health`). **No hay paso de pytest/jest/build** ⇒ se puede romper cobro o caja y
llegar a producción. Verificado: cero coincidencias de `pytest|craco|jest|playwright`.

---

## 🟠 P1 — resolver en la primera semana

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| 1 | **HTTP sin TLS** en `:8081` con token en `localStorage` | `frontend/nginx.conf:2`, `api.js:9` | Credenciales y tokens en claro en la red del local |
| 2 | **Contraseñas demo activas** hasta que se cambien | `seed.py:204-232`, `security_config.py:13-19` | Acceso al panel con credenciales públicas del repo |
| 3 | **Fuga cross-sucursal**: `POST /products/{id}/availability` devuelve pedidos activos de **todas** las sucursales | `products.py:236-243,256` | Un cocinero ve mesas/pedidos de otra sucursal en la respuesta |
| 4 | **No se pueden operar 2 sucursales**: `tables.number` y `zones.name` son únicos por **restaurante** | `database.py:11,83`, `tables.py:107`, `zones.py:45` | "Mesa 1" en la sucursal B responde `400 ya existe` |
| 5 | **La suite backend es roja**: 52 fallos (15 módulos de integración HTTP viejos, previos al aislamiento por sucursal) | `tests/test_zones.py:27` (`403 sin sucursal`), `test_mozo_floor.py:17` | No hay verificación confiable; enmascara bugs reales |
| 6 | **El comando documentado ejecuta 0 tests**: `sys.path.insert` está en la línea 14 y el import de `models` en la 10 | `tests/test_attention_lifecycle.py:10` vs `:14` | 36 tests de cierre de atención nunca corren |
| 7 | **Rate limit de login por IP de socket**: detrás de nginx todos comparten IP | `routes/auth.py:28`, `nginx.conf:8-14` | 10 intentos fallidos de uno bloquean el login de **todo** el local 5 min |
| 8 | **Tracking público sin rate limit** con código de 8 chars, y devuelve teléfono y dirección del cliente | `public.py:33,601-609,102-103` | Enumeración de datos de clientes |
| 9 | **`administracion` da admin total**: `require_roles` lo trata como pase universal, incluido resetear la contraseña de otro usuario | `auth.py:130-139`, `branch_access.py:8`, `users.py:64-73` | Un mozo con esa función puede tomar la cuenta del admin. Confirmar si es intencional |
| 10 | `GET /api/health` devuelve `str(e)` sin auth | `server.py:47-53` | Fuga de errores internos de la base |
| 11 | `/api/system/info` expone nombre de base y versiones | `routes/system.py:59-70` | Reconocimiento (es admin-only) |
| 12 | `data/reset` no limpia `attention_number_assignments` | `data.py:18-27` | Contadores de atención arrastrados |

---

## 💰 Bugs de dinero (reproducidos con el arnés del repo)

Ejecutados contra las rutas reales sobre el fake in-memory de `tests/test_money_integrity.py`,
sin tocar datos. Los tres primeros están **confirmados leyendo el código**.

| Sev | Bug | Escenario real | Evidencia |
|---|---|---|---|
| **P1** | **Pago mixto con vuelto descuadra el cajón** | Total 100: efectivo 60 + Yape 50 ⇒ el cliente recibe 10 de vuelto. El sistema atribuye **efectivo 60 / Yape 40**; la realidad es **efectivo 50 / Yape 50** ⇒ el cierre muestra un **faltante falso de 10** | `billing.py:47-66` (reparte el monto aplicado y **no** descuenta el vuelto) + `payments.py:333-339` (`sum_splits` puede superar `remaining`) |
| **P1** | **Anular un cobro de pedido web de recojo es imposible** (409 permanente) | Pedido de recojo cobrado ⇒ `attention_id` sin `attention_state` ⇒ el void cae en la rama de visita y responde `409 La visita está cambiando` | `public.py:505,561-566` → `payments.py:703-704,760-761` |
| **P1** | **Se pierde el descuento al recobrar tras anular** | Cobro de 90 con descuento 10 ⇒ se anula ⇒ la UI muestra Total 90 y cobra 90, pero el servidor recalcula 100 ⇒ la cuenta queda **parcial con 10 pendientes** y la visita no cierra | `payments.py:294-300,797-800`, `CobrarDialog.jsx:169,305` |
| **P1** | **Un fallo entre el claim y el insert deja la orden "pagada" sin ningún pago** | El rollback restaura todo **menos** `payment_status` ⇒ queda `payment_status="pagado"` con `amount_paid=0` | `payments.py:401-404,462-463,447-460` |
| P2 | Un comprobante pendiente desaparece de la cola si entra un pago parcial | El cliente sube Yape por 100; el cajero cobra 10 en efectivo ⇒ pasa a `parcial` y se pueden cobrar 90 **encima** del Yape ya pagado | `order_flow.py:142-149`, `payments.py:217-218` |
| P2 | El reintento idempotente devuelve un payload sin `fully_paid`/`remaining` | Corte de red tras un cobro exitoso ⇒ el cajero reintenta ⇒ el diálogo dice "Restante: —" con la cuenta ya cubierta | `payments.py:53-56,267-273` vs `:498-500` |
| P2 | Movimientos de caja sin control | Un cajero saca 200 del cajón y registra un `ingreso` de 200 ⇒ cierra con `difference = 0`, sin aprobación ni `audit_logs` | `cash.py:261-277,55-61` |
| P2 | Mutaciones públicas no recalculan `payment_status` | Pedido web pagado y no entregado: el cliente agrega un postre ⇒ sube el total pero sigue `pagado` ⇒ la deuda no se cobra nunca | `public.py:619-623,652-654,682-684` |
| P3 | Métodos de pago deshabilitados se pueden usar igual | El local desactiva "tarjeta" y se cobra igual por API | `payments.py:264-353` nunca lee `payment_configs` |

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
