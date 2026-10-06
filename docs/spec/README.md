# Especificación del producto — SaaS operativo para restaurantes

Documentación fuente del producto. Estos tres documentos definen **qué** se construye
(PRD), **cómo se modela el negocio** (modelo de dominio) y **cómo debe comportarse**
(especificación funcional y de estados). Se mantienen como documentación viva: se actualizan
a medida que el producto avanza.

## Documentos

| Documento | Estado | Qué define |
|---|---|---|
| [PRD-restaurante-saas-v1.0.md](PRD-restaurante-saas-v1.0.md) | Final aprobado para modelado | Visión, problema, objetivos, usuarios/permisos, alcance y reglas del MVP. |
| [modelo-de-dominio-restaurante-saas-v0.1.md](modelo-de-dominio-restaurante-saas-v0.1.md) | Borrador | Conceptos del negocio, áreas del dominio, entidades, relaciones y reglas. |
| [especificacion-funcional-y-estados-v0.1.md](especificacion-funcional-y-estados-v0.1.md) | Borrador | Flujos funcionales, máquinas de estados, permisos y criterios de aceptación. |
| [especificacion-ui-ux-pantallas-v0.1.md](especificacion-ui-ux-pantallas-v0.1.md) | Borrador | Contrato de diseño por pantalla: objetivo, elementos, jerarquía de acciones e interacciones. |
| [recorte-mesa-pedido-cocina-v0.1.md](recorte-mesa-pedido-cocina-v0.1.md) | Borrador | La rebanada más pequeña con valor (mesa → pedido → cocina) especificada de punta a punta, lista para programar. |

## Orden de lectura

1. **PRD** → entender el problema, el alcance y las decisiones de producto.
2. **Modelo de dominio** → entender los conceptos y sus ciclos de vida.
3. **Especificación funcional** → traducir lo anterior a comportamientos comprobables.
4. **Especificación UI/UX** → traducir el comportamiento a pantallas, sin improvisar botón por botón.
5. **Recorte mesa → pedido → cocina** → ver el método aplicado a una sola rebanada, con criterios de aceptación.

## Cómo mantener esta documentación actualizada

Cuando un cambio de producto o de implementación afecte el comportamiento:

1. Actualiza primero el documento de nivel más alto que aplique (PRD → modelo → funcional),
   y luego propaga el cambio a los documentos que dependen de él.
2. Revisa que las referencias entre documentos sigan siendo válidas
   (la especificación cita al PRD y al modelo por nombre de archivo).
3. Actualiza el campo **Estado** del encabezado de cada documento y la columna de esta tabla.
4. Si el cambio es grande, crea una nueva versión (ej. `v1.1.md`, `v0.2.md`) en lugar de
   sobrescribir, para conservar trazabilidad.

## Tarea asociada

La tarea que produjo la especificación funcional vive en
[`odd/tasks/especificacion-funcional-y-estados.md`](../../odd/tasks/especificacion-funcional-y-estados.md).

## Análisis de brecha

[`analisis-de-brecha.md`](analisis-de-brecha.md) contrasta la especificación contra lo que ya
está implementado en el código (backend y frontend), indicando qué está cubierto, qué está
parcial y qué falta. Actualizarlo cuando la especificación o el código cambien de forma
relevante.
