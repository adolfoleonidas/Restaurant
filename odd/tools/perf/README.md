# Arnés de medición del piso (`frontend/.tmp/audit-*.js` → acá)

Los scripts con los que se midió el rendimiento del salón en el teléfono del mozo.
**No son tests** (no los corre CI): se lanzan a mano contra un entorno real, porque lo
que hay que medir es el dispositivo, no el laboratorio.

Se corren desde `frontend/` (usan el Chromium de Playwright y las dependencias del
proyecto):

```bash
cd frontend
node ../odd/tools/perf/audit-lost-taps.js          # toques perdidos (el que encontró el bug)
AUDIT_CPU=6 node ../odd/tools/perf/audit-touch.js  # toques reales, por orientación
```

| Script | Qué mide |
|---|---|
| `audit-lost-taps.js` | Reproduce el flujo del mozo (mesa → nuevo pedido → productos) y **cuenta los toques que no registran**. Fue el que encontró que la mitad del área de la tarjeta no era botón. |
| `audit-touch.js` | Toques táctiles reales, alternando vertical y horizontal **dentro de la misma sesión**, para que el arranque en frío no se cargue a una orientación. |
| `audit-eventtiming.js` | `Event Timing`: separa *el hilo estaba ocupado* de *mi código tardó esto*. |
| `audit-trace.js` | Traza de Chrome: reparte el tiempo entre JavaScript, microtareas, despacho de eventos, pintado y layout. |
| `audit-profile.js` | Perfil de CPU por función (minificado: sirve para ver proporciones, no nombres). |
| `audit-mutations.js` | Cuántos nodos cambian por toque: dice si el trabajo de React es masivo o puntual. |
| `audit-bisect.js` | Apaga partes de la pantalla (barra inferior, cabecera, alto dinámico…) para atribuir el costo a cada una. |

## Trampas de medición que ya se cometieron (no repetirlas)

1. **Medir una orientación siempre primero.** El primer recorrido paga el arranque en
   frío (trozos, JIT) y aparecía una diferencia de 1,9× que no existía: con CPU libre,
   vertical y horizontal miden igual (70 vs 69 ms). Alternar dentro de la sesión.
2. **Promediar sobre una ventana larga.** Un toque de 800 ms entre cuarenta de 60 ms
   desaparece en un p50. Para lo intermitente hay que reportar **cada** caso lento.
3. **Observar el nodo equivocado.** La cantidad vive fuera del botón del nombre (son
   hermanos dentro de la fila): mirando el botón, todo toque parecía no hacer nada.
4. **Contar un gesto como toque.** Un scroll que empieza sobre una tarjeta no es un
   toque: si el dedo se movió más de 10 px, no cuenta.
5. **Suposición sin número.** Todo lo que se probó por intuición (desenfoque, piso
   desmontado, ventana de frescura) o no cambió nada o rompió algo. El registro está
   en `odd/tasks/salon-tap-cost.md`.

La contraparte en producción es el medidor en pantalla (`?diag=1`, ver
`frontend/src/lib/perfMeter.js`), que manda las muestras del dispositivo real a
`POST /api/diag/sample`.
