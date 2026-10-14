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
12. **Backup** automático de Mongo y cómo restaurarlo.

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

## 12. Backup y restauración

`docker compose up -d` también levanta el servicio **`backup`**: cada `BACKUP_INTERVAL_HOURS`
(24 por defecto) ejecuta `mongodump --archive --gzip` y guarda un archivo
`<DB_NAME>-<fecha>.archive.gz` en `BACKUP_DIR` (por defecto `./backups`, junto al
`docker-compose.yml`). Conserva solo los últimos `BACKUP_KEEP` (7 por defecto). Se configura en el `.env`
(ver `env.example`).

- Revisá que funcione: `docker compose logs backup` debe mostrar `backup ok: ...` y el archivo debe
  aparecer en `backups/`.
- **Copiá esa carpeta fuera del servidor** (otro disco o un servicio en la nube): un backup en el mismo
  disco no protege de una falla del disco.
- Probá una restauración en un equipo de prueba antes de abrir el local.

**Restaurar** (reemplaza el contenido actual de la base; detené el backend antes):

```bash
docker compose stop backend
docker compose exec -T mongo mongorestore --archive --gzip --drop --nsInclude='restaurant_db.*'   < backups/restaurant_db-20260101T030000Z.archive.gz
docker compose start backend
```

Cambiá `restaurant_db` por tu `DB_NAME` y el nombre del archivo por el que quieras recuperar. En
Windows ejecutá el comando del medio desde `cmd` (PowerShell no pasa binarios con `<`).

---

## 13. Actualizar una instalación que ya está corriendo

El camino normal es un push a `main`: el workflow `.github/workflows/deploy.yml`
corre los tests y después entra por SSH, hace `git merge --ff-only` y
`docker compose up -d --build`.

**Si GitHub Actions no está disponible** —hoy está bloqueado por facturación— hay
un camino equivalente desde tu máquina, que hace exactamente los mismos pasos en
el servidor:

```powershell
# 1. Ver qué se va a desplegar, sin tocar nada
powershell -ExecutionPolicy Bypass -File scripts\deploy-ssh.ps1 -DryRun

# 2. Desplegar (corre la verja local, pide confirmación, despliega y verifica)
powershell -ExecutionPolicy Bypass -File scripts\deploy-ssh.ps1
```

Qué hace `scripts\deploy-ssh.ps1`:

1. **Verja local** (`scripts\pre-deploy-check.ps1`): los mismos comandos que el
   trabajo `test` de CI — `pytest -m "not integration"`, la suite de Jest y el
   build de producción. Si algo está en rojo, no despliega.
   - Con `-SkipGate` se salta, a sabiendas. No hay que usarlo salvo emergencia.
   - **No corre `npm ci`** (borra y reinstala `node_modules`): una deriva entre
     `package.json` y el lockfile no se detecta en local, solo en CI.
2. **Se niega a desplegar algo que no esté en `origin/main`**, para que el VPS
   corra siempre lo mismo que está publicado.
3. **Entra por SSH** (`root@179.236.76.74`, llave `~/.ssh/gh-deploy`) y ejecuta
   `scripts\deploy-remote.sh`: comprueba que el servidor esté en `main` y con el
   árbol limpio, trae el commit, `git merge --ff-only`, `docker compose up -d
   --build` y espera el `/api/health` hasta 2 minutos.
   La reconstrucción va **desacoplada de la conexión**: si se corta el SSH a
   mitad, termina igual y los contenedores vuelven solos. Sin eso, un corte deja
   el sitio caído — pasó una vez y por eso está así.
4. **Verifica desde fuera**: imprime el hash del bundle servido y el health,
   desde la misma URL que usa el restaurante. La salida del servidor puede decir
   «listo» mientras el proxy sigue sirviendo el bundle viejo.

### Dos cosas que el script NO hace, a propósito

- **No toca el `.env`.** El workflow rota `JWT_SECRET` si lo considera débil, y
  eso **desconecta a todos los usuarios**: rotarlo tiene que ser una decisión
  explícita, no un efecto colateral de desplegar.
- **No vuelve atrás.** Solo avanza. `git merge --ff-only` con un commit anterior
  responde «Already up to date» con éxito, así que el script comprueba que el
  servidor haya quedado **exactamente** en el commit pedido y falla si no. Volver
  atrás es una operación aparte: `git log --oneline -5` en el servidor para
  elegir el commit bueno, `git reset --hard <sha>`, `docker compose up -d
  --build`, y verificar el health. Hacelo con el local cerrado.

### Después de desplegar

- Mirá el bundle y el health que imprime el script: si el health está verde y el
  bundle cambió, quedó.
- Tu otro worktree (`C:\Users\adolf\Downloads\cobro-restaurante`) tiene `main`
  en el commit viejo: ahí toca `git pull`.

## Si algo falla

| Síntoma | Causa | Arreglo |
|---|---|---|
| El backend se reinicia en bucle | falta `JWT_SECRET`, `CORS_ORIGINS` o alguna `SEED_*_PASSWORD` en producción | mirá los logs: la variable faltante se nombra |
| `403 El usuario no tiene una sucursal asignada` | el usuario no tiene sucursal | asignala en **Equipo** |
| `409 La caja heredada debe conciliarse…` | hay una caja vieja sin sucursal | **Casa → Datos → Restablecer** o cerrarla con el conteo real |
| `409 Hay N pedido(s) activo(s)` al vaciar la carta | hay pedidos abiertos | cerralos o restablecé los datos operativos |
| La carta pública muestra platos demo | la base traía el seed | **Vaciar carta** y volver a importar |
| Un mozo no ve su mesa | mesa de otra sucursal o sin sucursal | revisá la sucursal de la mesa y del usuario |
| El pedido muestra «Sin guardar» y no deja enviar a cocina | el celular no llega al servidor; lo tocado está guardado en el celular | que el mozo no cierre sesión ni borre los datos del navegador: al volver la señal se guarda solo. Si no vuelve, revisá la red del local |
| Tras una actualización la cuenta tiene productos que el mozo no recuerda | un lote que no había llegado se guardó al reabrir la app (es idempotente: no duplica) | nada que hacer; revisá la cuenta y quitá lo que sobre antes de enviar |
| El log del backend dice `ERROR orders: 2 id values repeated across 5 documents…` al arrancar | la base trae dos documentos con el mismo `id` en esa colección (por ejemplo, datos copiados o restaurados a mano). El sistema **arrancó igual**: busca por `id` con un índice normal y no toca ningún dato, pero no impide repetidos | corregí los repetidos y reiniciá, como se explica abajo |

### Ids repetidos al arrancar

Cada colección que el sistema consulta por `id` (pedidos, mesas, productos, usuarios, pagos, cajas, categorías, zonas, aprobaciones, restaurantes, visitas, sucursales y grupos de mesas) tiene un índice **único** por `id`: sin él, cada búsqueda recorre todos los documentos y se vuelve más lenta cada día. Si al arrancar la base ya trae `id` repetidos, ese índice no se puede crear. El backend **no se detiene**: crea en su lugar un índice normal (`order_id_lookup` para `orders`, y así `<colección>_id_lookup`), deja los datos como están y avisa con un `ERROR` que nombra la colección y cuántos `id` se repiten. Hasta que lo arregles nada impide crear otro documento con un `id` ya usado.

Para dejarlo como corresponde:

```bash
docker compose exec mongo mongosh restaurant_db
```

```js
// 1. Qué ids se repiten (cambiá orders por la colección del log)
db.orders.aggregate([{ $group: { _id: "$id", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])
// 2. Corregí o borrá los repetidos con cuidado, después de comprobar que tenés un backup (sección 12)
// 3. Quitá el índice normal para que el próximo arranque cree el único
db.orders.dropIndex("order_id_lookup")
```

Después `docker compose restart backend`. Mientras el índice normal siga ahí, cada arranque lo recuerda en el log: con un `ERROR` si todavía hay repetidos y con un `WARNING` si ya no los hay y solo falta quitarlo. Cambiá `restaurant_db` por tu `DB_NAME`.

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
- [ ] Backup automático funcionando, copiado fuera del servidor y restauración probada
