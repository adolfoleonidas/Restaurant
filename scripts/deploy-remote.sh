#!/usr/bin/env bash
#
# Despliegue en el VPS. Se ejecuta EN el servidor, no en tu máquina.
#
# Espeja, paso por paso, el bloque que `.github/workflows/deploy.yml` corre por
# SSH cuando hay un push a main. **El workflow sigue siendo la referencia**: si
# cambia allí, hay que cambiarlo aquí. Se mantiene el mismo orden y las mismas
# guardas a propósito, para que comparar los dos ficheros sea directo.
#
# Uso, desde la máquina del operador:
#   pwsh -File scripts/deploy-ssh.ps1                 # lo normal
#   ssh root@<host> 'bash -s <sha>' < scripts/deploy-remote.sh
#
# No toca el `.env`. El workflow rota JWT_SECRET si lo considera débil, y eso
# desconecta a todos los usuarios: rotarlo tiene que ser una decisión explícita,
# no un efecto colateral de desplegar.
#
set -eu

TARGET="${1:-}"
if ! printf '%s' "$TARGET" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "DEPLOY_FAIL motivo=sha_invalido"
  exit 1
fi

cd /docker/restaurant

# --- Guardas: mismas que el workflow -----------------------------------------
if [ "$(git symbolic-ref --short -q HEAD 2>/dev/null || true)" != "main" ]; then
  echo "DEPLOY_FAIL motivo=servidor_no_esta_en_main"
  exit 1
fi
if ! tracked=$(git status --porcelain --untracked-files=no); then
  echo "DEPLOY_FAIL motivo=no_se_pudo_leer_el_arbol"
  exit 1
fi
if [ -n "$tracked" ]; then
  echo "DEPLOY_FAIL motivo=worktree_sucio"
  echo "$tracked" | head -10
  exit 1
fi

echo "--- antes"
echo "head: $(git rev-parse --short HEAD)"

# --- Traer el commit y avanzar solo si es fast-forward ------------------------
# `--ff-only` es la red de seguridad: si el servidor tuviera trabajo propio
# encima, esto falla en vez de inventar un merge en producción.
if ! git fetch --quiet origin "$TARGET"; then
  echo "DEPLOY_FAIL motivo=no_se_pudo_traer_el_commit"
  exit 1
fi
if ! git merge --ff-only "$TARGET"; then
  echo "DEPLOY_FAIL motivo=no_es_fast_forward"
  exit 1
fi
echo "head ahora: $(git rev-parse --short HEAD)"

# --- El servidor tiene que quedar EXACTAMENTE en el commit pedido -------------
# Si se pide un commit anterior, `git merge --ff-only` responde "Already up to
# date" y sale con 0: sin esta comprobación el script diría "desplegado" sin
# haber movido nada. Con ella, un retroceso se rechaza en vez de simularse, que
# es lo correcto: volver atrás es una operación aparte y deliberada.
if [ "$(git rev-parse HEAD)" != "$TARGET" ]; then
  echo "DEPLOY_FAIL motivo=head_no_coincide_con_el_pedido"
  echo "pedido: $TARGET"
  echo "actual: $(git rev-parse HEAD)"
  exit 1
fi

# --- Reconstruir y levantar ---------------------------------------------------
# Esto es lo lento: reconstruye las imágenes en el VPS. Con las capas cacheadas
# suele ser ~1 min; en frío, bastante más.
if ! docker compose up -d --build; then
  echo "DEPLOY_FAIL motivo=compose_fallo"
  docker compose ps
  exit 1
fi

# --- Salud: hasta 2 minutos --------------------------------------------------
ok=0
i=0
while [ "$i" -lt 24 ]; do
  i=$((i + 1))
  if curl -sf --max-time 10 http://127.0.0.1:8081/api/health >/dev/null; then ok=1; break; fi
  sleep 5
done
if [ "$ok" != 1 ]; then
  echo "DEPLOY_FAIL motivo=health_no_responde"
  docker compose ps
  docker compose logs --tail 40 backend
  exit 1
fi

echo "--- contenedores"
docker compose ps --format '{{.Service}} {{.State}}'

# Ultima linea legible por la máquina: el orquestador la busca para no dar por
# bueno un despliegue que en realidad falló.
echo "DEPLOY_OK head=$(git rev-parse --short HEAD)"
