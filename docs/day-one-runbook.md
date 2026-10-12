# Runbook día 1 — instalar el sistema en un restaurante real

Guía para dejar el sistema operativo en un local, **desde el panel**, en el orden correcto.
El orden importa: sin sucursal no se puede pedir ni abrir caja, y los pagos demo hay que
cambiarlos **antes** de que entre el primer cliente.

---

## Camino rápido

1. **Juntá los datos reales** (tabla de abajo).
2. **`.env` de producción** en el servidor (no copiar `env.example`).
3. **`docker compose up -d --build`**.
4. **Limpia** los datos demo y de prueba.
5. **Local → Sucursal → Zonas → Mesas**.
6. **Carta** (vaciar la demo + importar la tuya).
7. **Equipo**: usuarios con rol **y sucursal**.
8. **Datos de cobro**: Yape/Plin/transferencia reales ⚠️ **lo más urgente**.
9. **Casa (Ajustes)**: Restaurante + Marca + Tema + Funciones.
10. **Caja**: abrir caja.
11. **Prueba de humo** y volver a limpiar.
12. **Backup** del volumen de Mongo.

---

## Antes de tocar el servidor

| Dato | Dónde se carga después |
|---|---|
| Nombre, RUC, dirección, teléfono, horario | Casa → Restaurante |
| Logo, portada, descripción, Instagram/Facebook/WhatsApp | Casa → Marca |
| Costo de delivery | Casa → Restaurante |
| **N° de Yape y Plin + titular** | Datos de cobro ⚠️ |
| **Banco y CCI** para transferencias | Datos de cobro ⚠️ |
| Carta en CSV (`nombre;categoría;precio;descripción;tiempo;imagen;código`) | Carta → Importar |
| Zonas y mesas reales | Local → Zonas / Mesas |
| Emails y roles del personal | Equipo |

---

## 1. El `.env` de producción (en el servidor)

```
APP_ENV=production
DB_NAME=restaurant_db
JWT_SECRET=<48+ caracteres aleatorios, único>
CORS_ORIGINS=http://<IP-o-dominio>:8081
SEED_DEMO=false
SEED_ADMIN_PASSWORD=<contraseña real>
SEED_CAJERO_PASSWORD=<contraseña real>
SEED_MOZO_PASSWORD=<contraseña real>
SEED_COCINA_PASSWORD=<contraseña real>
```

- **No copies `env.example`**: está pensado para desarrollo (trae datos demo).
- En producción el sistema **rechaza** contraseñas demo, un `JWT_SECRET` corto y `CORS *`.
- Si falta alguna variable, **`docker compose up` te lo dice al instante** (no arranca a medias).

## 2. Primer arranque

```bash
docker compose up -d --build
```

Abrí `http://<IP-o-dominio>:8081` y entrá con `admin@resto.com` y la contraseña que pusiste en
`SEED_ADMIN_PASSWORD`. Cambiala después desde **Equipo**.

> **Un solo proceso.** Los avisos en tiempo real (cocina, salón, caja) viven en la memoria del
> proceso del backend (`backend/notify.py`). Con más de un worker, un aviso publicado en uno nunca
> llega a los clientes conectados al otro y las pantallas quedan desactualizadas sin error.
> Por eso el backend **se niega a arrancar** si `WEB_CONCURRENCY` o `UVICORN_WORKERS` es mayor que 1
> (el `Dockerfile` ya lanza un único proceso de uvicorn). No uses `--workers N` ni réplicas del
> backend detrás de un balanceador; escalar horizontalmente requiere antes un broker compartido
> (por ejemplo Redis pub/sub), que es una mejora pendiente.

## 3. Limpiar lo que trae la demo o las pruebas

> Si la base ya tenía datos (demo o de pruebas), hacelo **antes** de cargar lo real.

1. **Casa → Datos → Restablecer datos operativos**: borra pedidos, pagos, caja, movimientos,
   visitas y auditoría. Conserva menú, mesas, sucursales y usuarios.
2. **Casa → Datos → Vaciar carta**: borra platos, combos y categorías demo.
3. **Caja**: si aparece el bloqueo *"La caja heredada debe conciliarse antes de abrir una caja
   por sucursal"*, tenés dos caminos:
   - **Base nueva (recomendado)**: ya lo resolvió el paso 1.
   - **Conservar historia**: cerrá esa caja con el **conteo físico real** (nunca con un número inventado).

## 4. La sucursal primero (si no, nada funciona)

**Local → Sucursales → Crear sucursal**: nombre, **zona horaria** (`America/Lima`) y
**corte del día de negocio** (por ejemplo `05:00`, para que la madrugada cuente como el día anterior).
Marcá *recojo público* solo si vas a ofrecerlo.

> Sin sucursal: los pedidos y la caja fallan con *"El usuario no tiene una sucursal asignada"*.

## 5. Zonas y mesas

1. **Local → Zonas**: creá tus zonas (Salón, Terraza, Barra…).
2. **Local → Mesas**: creá las mesas. Verificá que digan **"Hereda: <tu sucursal>"**.

## 6. La carta

1. **Carta → Importar**: subí el CSV o pegá las filas. Encabezados:
   `nombre;categoría;precio;descripción;tiempo;imagen;código` (mínimo **nombre** y **precio**).
   - Excel: **Guardar como CSV** antes de subirlo. Las categorías que no existan se crean solas.
   - Si un plato ya existe por nombre, se omite (no se duplica).
2. Revisá precios, descripciones y **agotados** en Carta.
3. **Combos** y **Categorías** tienen su propia pantalla si querés ordenarlas.

## 7. Usuarios

**Equipo**: creá cada usuario con su **rol** (admin / cajero / mozo / cocina) **y su sucursal**.

> Un usuario **sin sucursal** no puede operar: da 403. Los usuarios demo (`mozo@resto.com`,
> etc.) no tienen sucursal: asignásela o borralos.

## 8. Datos de cobro ⚠️ (lo más urgente)

**Datos de cobro (Pagos)**: reemplazá **Yape**, **Plin** y la **transferencia** por los datos
reales (número, titular, banco, CCI) y **deshabilitá** lo que no uses.

> Esto viene con datos **demo** (`999 888 777`, CCI `00219400123456780123`). Si abrís así,
> **el dinero de tus clientes va a una cuenta ajena**.

## 9. Marca y datos del restaurante

1. **Casa → Restaurante**: nombre, RUC, dirección, teléfono, horario, moneda, delivery.
2. **Casa → Marca**: logo, portada, descripción y redes. Ahí mismo tenés la **URL pública**
   (con *Copiar* y *Ver mi web*); también está el acceso **"Mi página web"** en el panel.
3. **Casa → Temas**: elegí el tema del local.
4. **Casa → Funciones**: dejá apagado lo que no uses (asistente de voz y lectura de comprobantes
   vienen **apagados**).

## 10. Abrir caja y prueba de humo

1. **Caja → Abrir caja** con el monto inicial real.
2. Probá el ciclo completo: **Salón** → tomá una mesa → **Áreas de venta: Mesa** → agregá platos →
   enviar a cocina → **Cocina**: *Pasar a fuego* → *Avanzar pedido* → **Salón**: *Solicitar cuenta* →
   **Caja**: cobrar.
3. Mirá la carta pública (**"Mi página web"**) desde el celular.
4. Al terminar la prueba: **Casa → Datos → Restablecer datos operativos** para no dejar el pedido de prueba.

## 11. HTTPS (muy recomendado antes de abrir)

Sin TLS, **las credenciales y los tokens viajan en claro** por la red. El HTTPS es **opt-in**:
el deploy normal sigue funcionando por HTTP hasta que pongas los certificados.

1. Necesitás un **dominio** que apunte a la IP del servidor (por ejemplo `micentro.com`).
2. Sacá el certificado (Let's Encrypt, gratis):
   ```bash
   mkdir -p certs
   docker run --rm -p 80:80 -v "$PWD/certs:/etc/letsencrypt" certbot/certbot \
     certonly --standalone -d micentro.com --agree-tos -m tu@correo.com --non-interactive
   cp certs/live/micentro.com/fullchain.pem certs/fullchain.pem
   cp certs/live/micentro.com/privkey.pem   certs/privkey.pem
   ```
3. En `.env`, sumá el origen HTTPS:
   `CORS_ORIGINS=https://micentro.com`
4. Levantá con el override:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d
   ```
5. Abrí el puerto **443** en el firewall del servidor y entrá por `https://micentro.com`.

> Los certificados quedan en `certs/`, que está **ignorado por git**: una clave privada no se sube nunca.
> Si preferís probar sin dominio, podés generar un certificado **autofirmado**, pero el navegador
> va a mostrar una advertencia (no sirve para un local real).

## 12. Backup

El volumen `mongo-data` **no viene respaldado**. Programá un backup (por ejemplo
`docker run --rm -v restaurant_mongo-data:/data -v $(pwd):/backup mongo:7 mongodump ...`).

---

## Si algo falla

| Síntoma | Causa | Arreglo |
|---|---|---|
| El backend se reinicia en bucle | falta `JWT_SECRET`, `CORS_ORIGINS` o alguna `SEED_*_PASSWORD` en producción | mirá los logs: la variable faltante se nombra |
| `403 El usuario no tiene una sucursal asignada` | el usuario no tiene sucursal | asignala en **Equipo** |
| `409 La caja heredada debe conciliarse…` | hay una caja vieja sin sucursal | **Casa → Datos → Restablecer** o cerrarla con el conteo real |
| `409 Hay N pedido(s) activo(s)` al vaciar la carta | hay pedidos abiertos | cerralos o restablecé los datos operativos |
| La carta pública muestra platos demo | la base traía el seed | **Vaciar carta** y volver a importar |
| Un mozo no ve su mesa | mesa de otra sucursal o sin sucursal | revisá la sucursal de la mesa y del usuario |

## Lo que NO hay que hacer

- **No** pongas `SEED_DEMO=true` en el servidor real.
- **No** copies `env.example` a producción.
- **No** dejes Yape/Plin/transferencia con los datos demo.
- **No** corras los tests (Playwright/pytest) contra producción: crean pedidos y mesas reales.
- **No** cierres una caja con un monto inventado: siempre el conteo físico.
- **No** corras el backend con más de un worker ni más de una réplica: el tiempo real es en memoria.

## Checklist final

- [ ] `.env` de producción sin valores demo
- [ ] Datos demo/prueba limpiados
- [ ] Sucursal creada (con zona horaria y corte)
- [ ] Zonas y mesas creadas y heredando la sucursal
- [ ] Carta real cargada y revisada
- [ ] Usuarios con rol **y** sucursal
- [ ] **Pagos reales cargados y los demo deshabilitados**
- [ ] Marca, restaurante y tema configurados
- [ ] Caja abierta con el monto inicial real
- [ ] Prueba de humo completa y datos de prueba borrados
- [ ] Backup del volumen programado
