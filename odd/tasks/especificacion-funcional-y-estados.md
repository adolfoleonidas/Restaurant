# Trabajo: especificación funcional y de estados

## Objetivo

Convertir el PRD aprobado y el modelo de dominio en flujos funcionales, máquinas de estados y criterios de aceptación verificables para el MVP.

## Problema y propósito

El producto ya define qué resolver y cuáles son sus conceptos principales, pero todavía falta documentar cómo progresa cada operación, qué actor puede ejecutarla y qué condiciones impiden transiciones inválidas. Esta especificación será la base para UX, arquitectura, pruebas e implementación.

## Alcance autorizado

- Crear `especificacion-funcional-y-estados-v0.1.md`.
- Derivar el contenido únicamente de `PRD-restaurante-saas-v1.0.md` y `modelo-de-dominio-restaurante-saas-v0.1.md`.
- No diseñar base de datos, endpoints, infraestructura, pantallas finales ni código.

## Restricciones

- Documento en español profesional y neutral.
- Mantener separados los estados de atención, pedido, preparación, pago, jornada, caja y solicitud externa.
- No introducir reservas de mesas, facturación electrónica, delivery ni inventario avanzado en el MVP.
- El proyecto no está dentro de un repositorio Git; no es posible registrar commits.
- El espejo de Engram queda pendiente porque la identidad de sesión no está disponible.

## Ruta de trabajo

- Ruta: ejecución directa documental.
- Evidencia: dos documentos fuente y un único artefacto principal.
- TDD: no aplicable a documentación; se utiliza validación estructural y trazabilidad de requisitos.

## Tareas

- [x] EF-01 — Revisar el PRD y el modelo de dominio vigentes.
- [x] EF-02 — Definir actores, permisos funcionales y flujo operativo principal.
- [x] EF-03 — Documentar máquinas de estados y condiciones de transición.
- [x] EF-04 — Especificar flujos alternativos, errores y concurrencia.
- [x] EF-05 — Redactar criterios de aceptación trazables por capacidad.
- [x] EF-06 — Verificar consistencia, alcance y estructura del documento.

## Criterios de aceptación

- Cada estado tiene entradas, salidas y transiciones permitidas.
- Ningún flujo contradice el PRD ni el modelo de dominio.
- Los permisos sensibles se expresan como capacidades, no como simples botones ocultos.
- Los flujos de QR, web pública, cocina, pagos y cierre contemplan errores y reintentos.
- Cada capacidad del MVP posee criterios de aceptación comprobables.

## Verificación prevista

- Lectura estructural de encabezados y diagramas.
- Validación de enlaces y referencias locales.
- Comparación de conceptos y estados con los documentos fuente.
- Confirmación de que los elementos fuera del MVP permanecen explícitamente excluidos.

## Progreso y evidencia

- EF-01 completada mediante lectura de los dos documentos fuente.
- EF-02 a EF-05 completadas en `especificacion-funcional-y-estados-v0.1.md`.
- EF-06 verificada: 827 líneas, 82 encabezados, 19 requisitos funcionales, 8 diagramas Mermaid con cercas balanceadas y referencias locales existentes.
- EF-07 completada: se fijó en 15 minutos la expiración de una atención provisional sin pedido válido.
- EF-08 completada: la numeración visible de atención y retiro reinicia diariamente por sucursal; la identidad técnica nunca se reutiliza.
- EF-09 completada: los pedidos programados utilizan por defecto 30 minutos de anticipación y una ventana de retiro de 15 minutos, configurables por sucursal.
- EF-10 completada: el modo QR directo limita por defecto a 20 unidades por envío y 3 envíos en 5 minutos por sesión; los excesos pasan a aprobación del mozo.
- EF-11 completada: una solicitud web sin responsable escala a urgente y repite la alerta después de 2 minutos.
- EF-12 completada: límites predeterminados de descuento de 10 % para mozo y 15 % para caja; propietario y administrador sin tope predeterminado, siempre con permiso, motivo y auditoría.
- EF-13 completada: la cola local admite hasta 8 horas y 500 operaciones pendientes por dispositivo, con advertencia al 80 % y sin eliminación silenciosa.
- EF-14 completada: se definieron conservación tributaria, trazabilidad mínima, anonimización de contactos, copias diarias y mensuales y pruebas trimestrales de recuperación.
- Los ocho parámetros pendientes quedaron resueltos y consolidados en una tabla operativa.
- Verificación final: 896 líneas, 20 requisitos funcionales, 8 diagramas Mermaid, cercas balanceadas y políticas normativas enlazadas; todos los controles estructurales finalizaron en PASS.
- Verificaciones estructurales y reglas críticas: PASS.
- No existe repositorio Git en el directorio, por lo que no se generó commit.
- Espejo Engram pendiente por falta de identidad de sesión disponible.
- Siguiente paso: validación del documento con el usuario y posterior especificación UX.
