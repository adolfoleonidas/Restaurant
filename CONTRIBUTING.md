# Contribuir

Gracias por el interés. Este documento explica cómo está organizado el repositorio, qué se espera de un cambio y cómo comprobarlo antes de abrir un pull request.

Si solo quieres probarlo, empieza por el [recorrido de 5 minutos](docs/recorrido-demo.md). Si vas a tocar código, lee primero [docs/estados-y-flujo.md](docs/estados-y-flujo.md): casi todo lo que se rompe en un restaurante es una transición de estado que se permitió de más.

## Organización

| Ruta | Qué hay |
|---|---|
| `backend/` | API FastAPI: rutas en `routes/`, reglas de negocio en módulos sueltos (`billing.py`, `order_flow.py`, `payment_policy.py`, `attention*.py`), acceso a datos en `database.py`. |
| `frontend/src/` | React: `pages/` (una por pantalla), `components/` (incluido `cobro/`, el flujo de caja), `lib/permissions.js` (quién puede qué), `contexts/`. |
| `tests/` | Suite hermética de pytest. `pytest.ini` ya expone `backend/` en el path. |
| `frontend/e2e/` | Pruebas de extremo a extremo con Playwright. |
| `docs/` | Especificación y auditorías. Índice en [docs/README.md](docs/README.md). |

## Entorno

Los pasos completos están en el [README](README.md#desarrollo-local). En resumen: MongoDB en `localhost:27017`, backend con `uvicorn server:app --reload --port 8000` desde `backend/`, y frontend con `REACT_APP_BACKEND_URL=http://localhost:8000 npm start` desde `frontend/`.

Variables mínimas del backend: `MONGO_URL`, `DB_NAME`, `JWT_SECRET` (32+ caracteres), `CORS_ORIGINS`, `APP_ENV`, `SEED_DEMO`.

## Antes de abrir un pull request

```bash
python -m pytest tests -m "not integration"     # hermética, la que corre CI
cd frontend && CI=true npm test && npm run build
```

Las pruebas de integración (`python -m pytest tests` sin el `-m`) y las de Playwright necesitan el stack levantado; no son obligatorias para un PR pequeño, pero si tu cambio toca cobros, caja o cocina, corre al menos el recorrido manual de [docs/recorrido-demo.md](docs/recorrido-demo.md).

## Reglas que no se negocian

1. **Los permisos viven en un solo sitio.** Rutas, menú y acciones se deciden en [`frontend/src/lib/permissions.js`](frontend/src/lib/permissions.js) y en `require_roles` del backend. No añadas comprobaciones ad hoc por pantalla.
2. **Un estado nuevo necesita su transición documentada.** Si agregas un estado de pedido, mesa o pago, actualiza `docs/estados-y-flujo.md` en el mismo PR. El backend rechaza transiciones fuera de orden a propósito.
3. **El backend corre con un solo worker.** El hub de SSE vive en memoria (`backend/notify.py`); no cambies la concurrencia sin resolver antes el broker compartido.
4. **Nada de secretos en el repositorio.** Usa `.env` (ignorado) y `env.example` como plantilla.
5. **Los cambios de comportamiento actualizan la especificación.** `docs/spec/` es documentación viva: si el producto cambia y el documento no, el siguiente que llegue decide con información falsa.

## Convenciones de código y commits

- Commits en español, con prefijo de tipo y alcance: `fix(ux): …`, `fix(api): …`, `feat(caja): …`, `docs(readme): …`, `chore(deploy): …`. El mensaje dice **qué cambia para el usuario**, no qué archivo tocaste.
- Un PR, un cambio. Si el diff mezcla refactor y comportamiento, sepáralo: el historial de este repositorio está pensado para revisarse por unidades.
- En el frontend, el texto de interfaz va en español y los montos se formatean con el helper existente (`fmtMoney`), no con `toFixed`.
- En el backend, las reglas de dinero y estados no van en las rutas: van en los módulos de dominio, que son los que tienen pruebas.

## Cómo proponer algo

- **Bug**: describe el rol con el que ocurre, la pantalla, los pasos y qué esperabas. Si puedes, adjunta el pedido o la mesa de ejemplo.
- **Funcionalidad**: abre un issue explicando el problema del restaurante antes que la solución. Las propuestas que solo describen una pantalla nueva suelen necesitar más contexto.
- **Documentación**: los PRs de docs son bienvenidos, especialmente si corrigen algo que ya no coincide con el código.

## Licencia

Al contribuir aceptas que tu aporte se publique bajo la licencia [MIT](LICENSE) del proyecto.
