# PRD 1.0 — SaaS operativo para restaurantes

**Estado:** final aprobado para modelado de dominio  
**Mercado inicial:** restaurantes pequeños de menú; piloto en Ica, Perú  
**Alcance:** operación diaria; facturación electrónica fuera del MVP

**Enmienda aprobada:** se actualizan las reglas de atención, cuentas, ocupación física y acceso por QR en las secciones 6, 7, 8, 11, 12 y 21. La decisión de producto está aprobada y los borradores de modelo y funcionalidad están alineados con esta enmienda; ambos siguen siendo borradores y no constituyen aprobación técnica. La implementación en código está pendiente. La numeración de atención se asigna una sola vez al confirmarse el primer pedido válido y usa una secuencia compartida por sucursal y día de negocio local. El corte debe configurarse según el horario del restaurante; no se fija una hora predeterminada. La identidad técnica interna es distinta del número visible.

## 1. Visión

Construir una plataforma SaaS multi-restaurante que reduzca tiempo, errores y trabajo manual desde la toma del pedido hasta cocina, entrega, cobro y cierre diario.

El piloto se concentrará en el servicio de almuerzo tipo menú, pero admitirá otras jornadas configurables.

## 2. Problema

El restaurante opera con notas manuales, mesas móviles y alta demanda. El mozo repite información a cocina; resulta difícil controlar disponibilidad, responsabilidades, ventas, anulaciones y mermas; y las cuentas grupales aumentan el riesgo de errores.

## 3. Objetivos del MVP

- Unificar pedidos del mozo y del cliente por QR.
- Mantener trazabilidad de atención, productos, cocina, entrega, pagos y correcciones.
- Reducir tiempo y errores sin exigir hardware costoso.
- Validar el producto en un restaurante pequeño.
- Preparar una base multiempresa y multisucursal sin complejidad prematura.

## 4. Métricas provisionales

Primero se medirá la operación manual. Metas iniciales:

- Registrar al menos el 90 % de los pedidos en el sistema.
- Reducir un 30 % el tiempo desde la toma del pedido hasta su envío a cocina.
- Evitar pedidos perdidos y cobros duplicados.
- Conciliar correctamente el cierre diario de caja.

Estos porcentajes se ajustarán después de medir la situación real.

## 5. Usuarios y permisos

### Roles de plataforma

- Propietario de plataforma.
- Administrador o soporte de plataforma con acceso restringido y auditado.

### Roles del restaurante

- Propietario del restaurante.
- Administrador o encargado.
- Mozo.
- Cocina.
- Caja.
- Repartidor de platos, opcional.

### Reglas

- Cada usuario se identifica mediante correo.
- Los roles funcionan como plantillas de permisos.
- Una persona puede tener varias capacidades.
- Los permisos para registrar pagos, verificar medios digitales, cerrar atenciones y cerrar la caja diaria se asignan por separado.
- Los permisos se validan en el servidor.
- Ningún restaurante puede asignar roles de plataforma.
- Cada trabajador operativo pertenece a una sucursal activa.
- Un traslado conserva el historial de la sucursal anterior.
- El propietario puede ver todo su negocio y realizar funciones operativas.

## 6. Modelo operativo

- La unidad principal es una **atención numerada**.
- Tipos iniciales: **En mesa** y **Para llevar**.
- En mesa vincula una o varias mesas. Una mesa es una ubicación física, independiente de las atenciones y cuentas que la utilizan.
- Para llevar usa un número de retiro y no ocupa mesa.
- En mesa admite un nombre o alias de servicio opcional. No se exige nombre legal, usuario registrado ni identificación personal.
- Para llevar permite un nombre o alias opcional.
- Una atención cerrada no se reabre ni se elimina ni admite pedidos nuevos; las sesiones vinculadas no pueden enviar pedidos a ese contexto.
- Los errores se corrigen mediante un ajuste o devolución vinculada.
- Una atención representa la visita numerada de una persona o de un grupo expresamente asociado; puede tener varias cuentas independientes, individuales o deliberadamente compartidas. No se exige una atención ni una cuenta por persona.
- El número de atención permanece estable durante la visita. Repetir pedidos no crea otra atención; cada pedido nuevo se asocia a la atención y a una cuenta abierta elegida.
- Una cuenta cerrada no recibe nuevos consumos. Si la atención permanece abierta, el consumo posterior se registra en otra cuenta abierta; una atención cerrada no se reabre.
- En cada sucursal, En mesa y Para llevar comparten una secuencia visible por día de negocio local. La numeración comienza en 1 para nuevas atenciones elegibles del día y no se reinicia dentro del día ni al abrir/cerrar caja, agregar pedidos, dividir cuentas o mover mesas; no hay umbral cíclico de 100/1000.
- El número se asigna una sola vez al confirmarse el primer pedido válido conforme a la política de aceptación aplicable; escanear QR, crear una atención provisional o recibir una solicitud web aún no aceptada no consume número. Cada contexto conserva desde el inicio una identidad interna distinta del número visible.
- El día de negocio usa la hora local de la sucursal y un corte configurado según su horario operativo; es distinto de la apertura o cierre del turno de caja. El corte se debe validar para el piloto; no se presupone medianoche ni una hora fija. Una atención conserva su número y día de origen al cruzar el corte; el reinicio solo afecta nuevas atenciones elegibles. La combinación sucursal+día de origen+ número desambigua números visibles repetidos y nunca autoriza acceso ni acredita identidad.
- Los reintentos de asignación no crean un segundo número ni duplicados dentro de sucursal+día. Esta regla no promete numeración legal/fiscal ni ausencia de huecos.
- Una visita cerrada que requiera consumo posterior utiliza una nueva atención; no se modifica una cuenta ya cerrada ni se reasignan pagos confirmados.
- Ejemplo: en la Mesa 7, la Atención 35 puede corresponder a Ana y Luis con cuentas separadas, mientras la Atención 36 corresponde a otra persona sin relación con ellos. Ana puede pagar y retirarse; esto no cierra la cuenta de Luis ni libera la mesa mientras Luis u otra persona siga ocupándola. Una familia también puede pagar en conjunto o por separado sin perder el detalle por producto.

## 7. Mesas y códigos QR

- Cada mesa tiene un número visible y un QR estable.
- El QR utiliza un identificador no predecible.
- Todos los códigos abren la misma aplicación.
- El identificador determina restaurante, sucursal y mesa.
- El sistema genera automáticamente el identificador y el código QR al configurar la mesa.
- Un usuario autorizado puede descargar el QR desde la aplicación para imprimirlo o compartirlo.
- El QR puede reimprimirse si se daña sin cambiar su identidad.
- Si el QR se pierde o queda comprometido, un usuario autorizado puede cancelar su identificador desde la aplicación. El QR anterior queda inválido inmediatamente y no puede originar nuevos pedidos.
- Después de la cancelación, el sistema puede generar un nuevo identificador y QR para la misma mesa, conservando su número y su historial.
- Una atención puede agregar, liberar o cambiar mesas.
- Una mesa puede alojar más de una atención independiente al mismo tiempo, incluso de personas o grupos sin relación.
- Agrupar, desagrupar, mover o liberar mesas es una acción operativa; no consolida cuentas ni transfiere consumos o pagos anteriores.
- El cierre financiero no libera automáticamente una mesa ocupada. La disponibilidad física se confirma mediante el proceso operativo del personal autorizado, después de comprobar que no quedan ocupantes ni atenciones activas asociadas.
- Cada movimiento queda registrado.

## 8. Pedidos del mozo y del cliente

Todos los canales utilizan el mismo sistema interno, pero cada uno tiene un mecanismo de acceso e identificación diferente.

### Acceso del mozo

- El mozo ingresa al área operativa de la aplicación web con su propia cuenta autenticada.
- El sistema reconoce al mozo, sus permisos y su sucursal activa mediante su sesión; no necesita escanear el QR de la mesa.
- Para iniciar una atención **En mesa**, el mozo selecciona internamente una o varias mesas por sus números visibles.
- Cada pedido conserva el usuario que lo creó y el origen **Mozo**.
- Cada pedido En mesa tiene una mesa destino específica, aunque la atención abarque varias mesas, y puede incluir un alias opcional para llamarlo o entregarlo. El alias puede repetirse o cambiar; no identifica, autentica ni determina titularidad financiera. Las referencias existentes de atención y pedido conservan la trazabilidad.

### Acceso del cliente mediante QR de mesa

- El cliente escanea el QR físico de la mesa.
- La URL contiene un identificador seguro que permite resolver el restaurante, la sucursal y la mesa sin pedirle al cliente que escriba el número.
- Cada pedido conserva el origen **Cliente por QR**.

### Modos configurables para pedidos QR

1. El mozo aprueba cada pedido. Será el modo predeterminado del piloto.
2. El mozo aprueba el primer pedido y los siguientes pasan directamente.
3. El pedido va directo a cocina usando un código temporal de jornada y límites de seguridad.

### Reglas

- Escanear el QR de una mesa libre puede crear una atención provisional.
- La atención se activa al confirmar el primer pedido válido conforme a la política de aceptación aplicable.
- El QR identifica la ubicación, no una persona, grupo ni cuenta. Escanear una mesa ocupada no incorpora silenciosamente al cliente a la atención o cuenta de otra persona.
- El cliente puede iniciar una atención independiente o asociarse explícitamente a una atención/cuenta existente si está autorizado. La asociación nunca se infiere por compartir mesa, dispositivo o navegador.
- La sesión es privada y vinculada al contexto autorizado de la persona, no al dispositivo como identidad. Solo muestra sus consumos y saldos autorizados; no expone información de terceros.
- Una sesión no puede enviar pedidos a una atención cerrada ni a una cuenta cerrada. Cerrar una cuenta no impide usar otras cuentas o atenciones abiertas para las que la persona ya tiene acceso autorizado.
- El mozo, cocina y caja visualizan la atención completa según sus permisos.
- Si varias mesas están unidas, todos sus QR continúan funcionando. El movimiento operativo no une automáticamente clientes, atenciones o cuentas ni revela información de terceros.
- Agrupar mesas no mezcla la información visible entre sesiones de clientes; solo consolida la operación física para el personal.
- La sesión del cliente permanece vinculada con la atención aunque la mesa se mueva o el grupo agregue otra mesa.
- Cerrar una cuenta o atención no invalida las sesiones de otras personas o grupos con cuentas o atenciones activas en las mismas mesas. Una sesión permanece asociada a su contexto autorizado aunque las mesas se muevan.
- Antes del primer pedido, la web muestra claramente la mesa o conjunto de mesas y solicita confirmación al cliente.
- Un pedido pendiente de aprobación no llega a cocina.
- Cocina ve el origen del pedido: **Mozo**, **Cliente por QR** o **Web pública**.
- También se registra quién confirmó el pedido.
- El código temporal reduce abusos, pero no garantiza seguridad absoluta.

### Identificación del servicio y destino

El alias opcional puede usarse En mesa y Para llevar; no es identificador único, prueba de identidad ni autorización. Un alias repetido se distingue por referencias de atención/pedido/retiro. Mostrar una referencia no autoriza acceso a pedidos o pagos de terceros.

Cada pedido En mesa tiene un destino físico concreto (una mesa específica), separado del origen histórico y del grupo de mesas de la atención. Personal autorizado puede cambiar destino de pedidos no entregados; se conservan destino anterior/nuevo, actor y momento, y el destino vigente se muestra al responsable y a cocina. No se reescriben pedidos entregados ni historial financiero. Mover/agrupar mesas no redirige pedidos automáticamente ni cambia su atención, cuenta o deuda.

Starbucks documenta nombres elegidos para pedidos de cafetería; KFC UK describe el retiro de pedidos realizados en su aplicación; Burger King New Zealand indica comunicar el número al recoger un pedido móvil anticipado. Son ejemplos específicos de canal/mercado, no evidencia sobre pedidos ordinarios en mostrador, quioscos ni todas las sucursales peruanas, y no son prueba de identidad. La adaptación mantiene alias opcional, referencias y destino explícito, sin check-in, drive-through ni políticas regionales. [Starbucks](https://about.starbucks.com/press/2025/customer-names-and-messages-on-orders/), [KFC UK](https://help.kfc.co.uk/hc/en-gb/articles/360018467939-PICKING-UP-MY-ORDER), [Burger King NZ](https://burgerkingnz.zendesk.com/hc/en-us/articles/6987086128015-How-do-I-place-a-mobile-pre-order).

### Acceso desde la web pública



Cuando una persona llega desde Google, SEO, redes sociales o un enlace general, la aplicación no asume ninguna mesa. La web pública permite consultar el catálogo y crear:

- **Para llevar inmediato:** el cliente solicita recoger el pedido lo antes posible.
- **Para llevar programado:** el cliente solicita recoger el pedido en una fecha y hora determinadas.

Ambos pedidos quedan sujetos a confirmación del restaurante y conservan el origen **Web pública**. Para crear una atención **En mesa**, el cliente debe escanear el QR físico de la mesa; no puede asignarse una mesa escribiendo manualmente su número desde la web pública.

### Gestión de pedidos de la web pública

- Los pedidos nuevos aparecen en una bandeja compartida para los mozos autorizados de la sucursal.
- El primer mozo que toma el pedido se convierte en su responsable.
- El mozo revisa productos, disponibilidad y hora solicitada antes de aceptar o rechazar.
- Solo un pedido aceptado pasa a cocina y recibe su número de retiro.
- Un rechazo requiere motivo y queda registrado.
- Mientras nadie lo tome, el pedido permanece visible para el equipo y genera una alerta operativa.
- El sistema conserva el mozo responsable, la decisión y el tiempo de respuesta.

## 9. Catálogo, precios y menú

- Existe un catálogo maestro por negocio.
- Cada sucursal configura disponibilidad y precio.
- Los precios pueden ser iguales o diferentes entre sucursales.
- Una sucursal puede tener productos exclusivos.

### Menú compuesto

- **Menú** es un producto compuesto.
- Puede incluir entrada, segundo, refresco y postre.
- Los componentes se controlan individualmente para disponibilidad y reportes.
- El menú se cobra una sola vez.
- Un componente incluido lleva precio aplicado cero y motivo **Incluido en menú**.
- Si se vende por separado, utiliza su precio normal.
- Una cortesía lleva precio cero, motivo y usuario autorizador.
- No se duplican productos gratuitos y pagados.

### Personalización

- Las opciones estructuradas pueden modificar precio o disponibilidad.
- Cada producto admite una nota breve.
- Una nota libre no modifica el precio automáticamente.

### Administración masiva del catálogo

- El panel administrativo ofrece una vista tabular similar a una hoja de cálculo, optimizada para computadora y tablet.
- Permite buscar por nombre, código o SKU y filtrar por categoría, estado y sucursal.
- Incluye edición rápida y acciones masivas para activar, archivar, categorizar o asignar productos a sucursales.
- Un producto utilizado en una operación histórica no se elimina físicamente; se archiva para preservar la trazabilidad.
- La exportación puede incluir todo el catálogo o solamente los resultados filtrados.

### Importación y exportación

- La importación y exportación del catálogo forman parte del MVP para acelerar la carga inicial de productos.
- El formato principal es Excel `.xlsx`; CSV se admite como alternativa.
- El sistema proporciona una plantilla descargable con instrucciones, ejemplos e identificadores estables.
- Los productos existentes se actualizan mediante su identificador interno o SKU; el nombre no se utiliza como única clave para evitar duplicados.
- Antes de aplicar una importación, el sistema valida los datos y presenta una vista previa de registros nuevos, modificados, archivados y rechazados.
- Los errores indican la fila, el campo y el motivo, y pueden descargarse para corregirlos.
- La importación solo se confirma después de la revisión de un usuario autorizado y queda registrada en auditoría.
- Antes de una modificación masiva se conserva una versión recuperable del catálogo para permitir la reversión.
- El catálogo maestro pertenece al negocio; cada sucursal importa o modifica únicamente su habilitación, precio y disponibilidad local cuando corresponda.

## 10. Jornadas y disponibilidad

- Las jornadas son configurables.
- Pueden llamarse Almuerzo, Desayuno, Cena, Merienda u otro nombre.
- El piloto validará inicialmente **Almuerzo**.
- En el MVP, cada sucursal configura o confirma manualmente el menú de la jornada actual; la programación semanal automática queda como evolución avanzada.

Estados de disponibilidad:

- Disponible sin conteo.
- Cantidad limitada.
- Agotado.

Cocina puede agregar varios lotes durante la jornada. El cierre registra porciones vendidas, sobrantes y mermas.

El inventario completo de ingredientes, recetas, compras y almacenes queda fuera del MVP.

## 11. Cocina y entrega

### Tablero de cocina (KDS)

El tablero de cocina es obligatorio en el MVP y puede utilizarse desde una tablet, computadora o pantalla compatible con la aplicación web.

- Organiza los pedidos activos en **Pendiente**, **En preparación** y **Listo**.
- Cada tarjeta muestra referencias de atención/pedido, destino específico vigente o número de retiro, alias opcional, productos, cantidades, opciones, notas y espera.
- El origen **Mozo**, **Cliente por QR** o **Web pública** aparece como información secundaria.
- Cocina dispone de acciones grandes y rápidas para cambiar estados.
- Un pedido **Listo** permanece visible hasta que un mozo autorizado lo tome y marque **Entregado**.
- Al marcarlo **Entregado**, desaparece del tablero activo, pero permanece en el historial.
- Marcar un pedido como listo o entregado no libera ninguna mesa. La disponibilidad física depende de la ocupación y las atenciones aún presentes, no solo del estado del pedido o su cierre financiero.
- Origen histórico, grupo de mesas y destino actual son datos distintos. Personal autorizado cambia destino de pedidos no entregados con auditoría del destino anterior/nuevo, actor y momento.

Estados mínimos:

- Pendiente.
- En preparación.
- Listo.
- Entregado.

Por defecto, cocina controla cada producto pedido como una unidad. Un menú puede marcarse completo.

Opcionalmente, una sucursal puede activar seguimiento separado para entrada, segundo, refresco y postre.

También existirán acciones rápidas para actualizar toda la atención.

### Responsabilidad del mozo

- Cada atención tiene un mozo responsable.
- Otro mozo autorizado puede intervenir.
- Cuando cocina marca un pedido como listo, el responsable recibe una alerta.
- El aviso visual siempre aparece.
- Sonido y vibración son configurables.
- El pedido permanece visible para el equipo.
- Otro mozo puede pulsar **Me encargo**.
- El sistema evita que dos personas recojan el mismo pedido.
- Se registra quién realizó la entrega.

## 12. Pagos y caja

Métodos iniciales:

- Efectivo.
- Yape.
- Plin.
- Tarjeta.

En el MVP, el sistema registra y controla estos pagos, pero no procesa directamente el dinero ni se integra con bancos, billeteras o adquirentes.

Cada cuenta mantiene sus consumos y asignaciones, saldo, pagos y cierre financiero independientes. Los pedidos adicionales se asocian a una cuenta abierta elegida de la atención; los estados de cocina/preparación son independientes del pago. Los clientes pueden pagar una cuenta o dividir consumos por comensal, producto o monto y combinar métodos. Los productos compartidos pueden asignarse explícitamente; toda asignación conserva trazabilidad y evita doble cobro, sin prescribir un algoritmo de redondeo.

La agrupación o movimiento de mesas no fusiona cuentas ni reasigna consumos o pagos. Un cobro conjunto registra la distribución entre cuentas originales sin fusionar automáticamente sus deudas. Divisiones, asignaciones compartidas y fusiones deliberadas quedan auditadas; una cuenta liquidada no se altera retroactivamente.

Una cuenta puede pagarse:

- Completa por una persona.
- Dividida por comensal.
- Dividida por productos.
- Dividida por monto.
- Combinando varios métodos.

### Pago digital mediante QR

La aplicación web es el medio principal para presentar las instrucciones de pago con Yape, Plin u otra billetera compatible.

Al pulsar **Pagar**, el cliente visualiza:

- Monto exacto pendiente únicamente de la cuenta para la que tiene autorización.
- QR de pago configurado para la sucursal o caja.
- Número de Yape o Plin con acción **Copiar**.
- Nombre del receptor.
- Número de atención y referencia de la cuenta.
- Acción **Ya pagué**.

Reglas:

- Cada cliente solo consulta los consumos y saldos de sus contextos autorizados; el personal visualiza el detalle según sus permisos.
- Si una persona desea pagar varias cuentas, el mozo o caja con el permiso correspondiente las selecciona expresamente y conserva la asignación del pago.
- El número copiable permite pagar desde el mismo celular en el que se abrió la aplicación web.
- El restaurante puede utilizar un QR físico como respaldo, claramente identificado y separado del **QR para pedir**.
- No se utiliza un QR de pago diferente por mesa; puede configurarse uno por sucursal o por caja.
- Al pulsar **Ya pagué**, el pago queda **Por verificar** y no reduce todavía el saldo.
- Caja o un mozo con permiso **Verificar Yape o Plin** comprueba el ingreso en la aplicación o portal oficial del receptor.
- Una captura de pantalla enviada por el cliente no se considera confirmación suficiente.
- Cuando el medio proporcione un código o identificador de seguridad, puede registrarse como apoyo para la verificación.
- Solo después de la comprobación, el usuario autorizado marca el pago **Confirmado**.
- Las tarjetas se cobran mediante un POS externo y se registran manualmente en el sistema durante el MVP.
- Una futura integración automática con proveedores de pago queda fuera del MVP.

### Modos de caja

- **Caja controlada:** apertura, monto inicial, cierre y conciliación.
- **Caja simple:** solamente registra pagos y advierte que ofrece menos control.

Caja controlada será el modo predeterminado.

### Cobro y cierre de una atención

Cerrar una atención y cerrar la caja diaria son operaciones independientes.

El cierre de una cuenta, el cierre de una atención, la liberación física de una mesa y el cierre de la caja diaria son operaciones distintas. Un flujo autorizado puede completar pasos financieros compatibles, pero no presume la salida física ni cierra otras cuentas o atenciones.

Una cuenta solo se cierra cuando sus pedidos están entregados o correctamente anulados, su saldo confirmado es cero y no tiene pagos pendientes o por verificar. Una cuenta cerrada no acepta nuevos consumos; si la atención sigue abierta, el consumo posterior requiere otra cuenta abierta. La atención solo se cierra cuando todos sus pedidos están resueltos, todas sus cuentas están cerradas y no quedan pagos pendientes o por verificar.

Una atención puede cerrarse únicamente cuando:

- Todos sus pedidos están entregados o anulados correctamente.
- El saldo confirmado es cero.
- No existen pagos pendientes o por verificar.

Reglas operativas:

- Cualquier usuario con el permiso **Cerrar atención** puede cerrarla.
- En el piloto, el mozo tendrá este permiso de manera predeterminada para evitar que caja se convierta en un cuello de botella.
- Los permisos **Registrar efectivo**, **Verificar Yape o Plin**, **Registrar tarjeta**, **Cerrar atención** y **Cerrar caja diaria** son independientes.
- Un mozo con permisos suficientes puede usar la acción **Cobrar y cerrar** para confirmar el pago y cerrar las cuentas y atención correspondientes. No libera físicamente una mesa si quedan personas, otras atenciones u ocupantes; la liberación se confirma mediante el proceso operativo autorizado.
- Si el cliente paga en caja, caja confirma el pago y cierra las cuentas/atención autorizadas; el mozo no debe repetir la acción.
- Un mozo sin permiso para el medio de pago utilizado selecciona **Solicitar cobro** para derivar la atención a caja.
- Una atención con total gratuito puede cerrarse con saldo cero, pero exige motivo y usuario autorizador.
- El cierre diario de caja advierte y se bloquea mientras existan atenciones abiertas o pagos pendientes de verificación.
- Cerrar una atención no concede permiso para conciliar caja, devolver pagos ni modificar configuraciones administrativas.

### Estados de un pago

- Pendiente.
- Confirmado.
- Fallido.
- Por verificar.

Solo un pago confirmado reduce la deuda.

Si la conexión se interrumpe:

- No se vuelve a cobrar automáticamente.
- El pago queda por verificar.
- Reintentar no puede duplicarlo.
- La cuenta y, por consecuencia, la atención no se cierran hasta cubrir el total confirmado.
- Caja o administración concilia el caso con motivo y auditoría.

### Descuentos

- Por producto o por cuenta.
- Porcentaje o monto fijo.
- Requieren permiso, motivo y auditoría.
- Promociones automáticas y cupones quedan para después.

## 13. Correcciones y anulaciones

Política predeterminada:

- Antes de enviar a cocina: el mozo puede editar.
- Enviado, pero no preparado: puede anularse con permiso y motivo.
- Preparando o listo: no se borra; se registra anulación o merma.
- Después del pago: solo caja o administración puede corregir o devolver.
- Siempre se conserva el registro original.
- Cada restaurante puede aplicar reglas más estrictas.

## 14. Pedidos programados y reserva de comida

El MVP no reserva mesas. Durante horas de alta demanda, el restaurante no debe mantener una mesa vacía esperando a un cliente.

El sistema permite reservar comida o programar un pedido con:

- Fecha y hora solicitadas.
- Productos y cantidades.
- Nombre o alias.
- Contacto opcional.
- Modalidad prevista: **Para llevar** o posible consumo **En mesa**.
- Nota y estado de confirmación.

El restaurante confirma la disponibilidad de los productos y la hora. Si el cliente recoge el pedido, se crea una atención **Para llevar**. Si decide comer en el local, se crea una atención **En mesa** solamente cuando llegue y exista una mesa disponible; el pedido programado no bloquea ni garantiza una mesa.

Quedan para después:

- Reserva anticipada de mesas.
- Recordatorios automáticos.
- Pagos anticipados.
- Gestión avanzada de capacidad y horarios.

## 15. Reportes

Reportes básicos diarios por sucursal:

- Ventas.
- Número de atenciones.
- Ticket promedio.
- Productos vendidos.
- Totales por medio de pago.
- Descuentos.
- Anulaciones.
- Cortesías.
- Producción.
- Sobrantes.
- Mermas.

Los comparativos avanzados quedan para fases posteriores.

## 16. Alta y configuración

- El piloto utiliza alta asistida.
- La plataforma crea el negocio, su primera sucursal y la cuenta del propietario.
- El propietario configura usuarios, mesas, QR, catálogo, precios, jornadas y modos operativos.

Estados de una sucursal:

- En configuración.
- Activa.

Para activarse necesita:

- Datos básicos.
- Usuarios responsables.
- Mesas y QR.
- Catálogo con precios.
- Al menos una jornada.
- Configuración de caja y pedidos.

El registro automático y las suscripciones quedan para después.

## 17. Conectividad

- El MVP funciona principalmente con internet.
- No utilizará Bluetooth ni un servidor local.
- Durante un corte breve, el dispositivo del mozo guarda pedidos pendientes.

Estados visibles:

- Guardado en el dispositivo.
- Pendiente de sincronización.
- Recibido por cocina.

Al regresar internet, el pedido se sincroniza una sola vez.

Los pedidos QR y la comunicación digital con cocina requieren conexión. Durante un corte se utiliza comunicación manual como respaldo.

## 18. Constancia de consumo

- Se genera una constancia digital interna sin valor tributario.
- Muestra atención, sucursal, productos, totales, pagos y fecha.
- Puede visualizarse o descargarse.
- La impresión integrada queda para después.
- Un problema con la impresora nunca modifica un pago confirmado.

## 19. Requisitos de calidad

- Aislamiento estricto entre restaurantes.
- Permisos validados en el servidor.
- Auditoría de acciones sensibles.
- Recolección mínima de datos personales.
- Los movimientos financieros no se eliminan físicamente.
- Copias automáticas recuperables.
- Aplicación web instalable.
- Optimización para celulares Android económicos.
- Compatibilidad con tablet y computadora.
- Botones grandes, lenguaje sencillo y alto contraste.
- Pocos pasos para las acciones frecuentes.
- Actualizaciones casi inmediatas con conexión normal.
- Protección contra pagos y sincronizaciones duplicadas.
- Los plazos legales de conservación se validarán antes de producción.

## 20. Fuera del MVP

- Facturación electrónica SUNAT.
- Delivery con domicilio y repartidor.
- Inventario completo de ingredientes.
- Suscripciones y registro automático.
- Promociones automáticas.
- Impresión integrada.
- Operación completa sin internet.
- Analítica avanzada.
- Reserva anticipada de mesas y automatizaciones avanzadas.
- Restablecimiento completo y recuperable de una sucursal.

### Planificación avanzada de menús

Una fase posterior incorporará un calendario de menús por sucursal para reducir la configuración repetitiva:

- Plantillas semanales recurrentes por día y jornada.
- Copia de semanas o días anteriores.
- Programación anticipada de productos, componentes y precios.
- Excepciones para una fecha concreta sin modificar automáticamente la plantilla recurrente.
- Estados de borrador, publicado, activo y finalizado.
- Confirmación diaria de productos realmente preparados y sus cantidades antes de habilitar pedidos.
- Configuraciones independientes para **Visible para clientes** y **Disponible para pedir**.
- Presentación anticipada con etiquetas como **Disponible mañana** o la fecha correspondiente.
- Pedidos futuros únicamente cuando la sucursal los habilite y dentro del periodo permitido.
- Los cambios de disponibilidad y agotados durante la jornada prevalecen sobre la planificación.

La plantilla representa lo planificado; la jornada diaria representa lo realmente preparado y disponible.

### Restablecimiento seguro de una sucursal

Una fase posterior incorporará la función **Restablecer configuración de la sucursal**. No eliminará silenciosamente todos los datos ni afectará a otras sucursales.

Requisitos previos:

- Solo el propietario o un usuario con permiso explícito podrá ejecutarla.
- El usuario deberá volver a autenticarse, indicar un motivo y escribir el nombre de la sucursal para confirmar.
- No podrá haber atenciones, jornadas, cajas, pagos ni sincronizaciones pendientes.
- El sistema generará una exportación descargable y una copia interna recuperable antes de continuar; si la copia falla, el restablecimiento no se ejecutará.

Efectos previstos:

- La sucursal volverá al estado **En configuración**.
- Se archivarán sus asignaciones de productos, precios locales, disponibilidad, mesas, QR, jornadas y asignaciones operativas de usuarios.
- Los QR anteriores quedarán desactivados.
- Se conservarán las ventas, pagos, devoluciones, correcciones, anulaciones y registros de auditoría como historial de solo lectura.
- No se eliminará el catálogo maestro del negocio ni se modificará ninguna otra sucursal.
- La copia previa podrá restaurarse durante el periodo de recuperación definido por la plataforma.

La eliminación permanente de un negocio completo será un proceso distinto, gestionado a nivel de plataforma y sujeto a las políticas de conservación de datos.

## 21. Criterios de aceptación

- Una mesa representa ocupación física y puede estar asociada a más de una atención independiente.
- La atención puede abarcar una persona o grupo expresamente asociado, varias cuentas y una o más mesas; Para llevar no ocupa mesa.
- Repetir pedidos durante una visita conserva la atención y su número; el número se asigna al confirmar el primer pedido válido, no al escanear QR ni al crear una atención provisional.
- En una sucursal y día de negocio local, la secuencia compartida En mesa/Para llevar inicia en 1 para nuevas atenciones elegibles; no se reinicia durante el día ni por eventos de caja, pedidos, cuentas o mesas.
- La atención conserva el número y día de origen después del corte; el número visible no autoriza acceso y se desambigua mediante sucursal y día de origen.
- Cada cuenta conserva consumos, asignaciones, pagos y cierre propios; no se alteran pagos confirmados ni cuentas cerradas.
- Una atención cerrada no se reabre ni acepta nuevos pedidos; cerrar una cuenta no bloquea otras cuentas o atenciones abiertas autorizadas. Si la atención sigue abierta, el consumo posterior se registra en una cuenta abierta nueva.
- Pedidos del mozo y del QR utilizan el mismo flujo.
- Todo pedido En mesa muestra una mesa destino específica; el alias es opcional y no reemplaza referencias ni autoriza acceso.
- El origen del pedido siempre queda registrado.
- Los QR de mesas agrupadas siguen funcionando, sin unir automáticamente clientes, atenciones o cuentas.
- El sistema permite generar, descargar, cancelar y reemplazar el QR de una mesa sin eliminar su historial.
- El QR identifica la ubicación, no una persona o cuenta; asociarse a una cuenta existente requiere una acción explícita y autorizada. Cada cliente solo ve consumos y saldos de sus contextos autorizados.
- El pago iniciado desde QR solo utiliza el saldo de una cuenta autorizada; el personal autorizado puede seleccionar expresamente varias cuentas y conservar su asignación.
- El menú se cobra una sola vez y conserva componentes trazables.
- Cocina gestiona los pedidos desde el tablero KDS y actualiza estados según la configuración elegida.
- Un pedido listo permanece activo hasta marcarse entregado, y la entrega no libera la mesa.
- El sistema evita entregas duplicadas.
- Los pagos parciales no pueden duplicar ni superar el saldo.
- Un pago incierto no cierra la cuenta ni la atención.
- Pulsar **Ya pagué** no reduce el saldo hasta que un usuario autorizado verifique y confirme el ingreso.
- Cerrar una cuenta o atención no libera una mesa ocupada; el personal autorizado confirma su disponibilidad física por separado y se conserva el historial.
- Un mozo autorizado puede cobrar y cerrar las cuentas/atención permitidas sin intervención adicional de caja, pero no libera físicamente una mesa ocupada ni cierra cuentas ajenas.
- El cierre diario de caja permanece separado y se bloquea si existen atenciones o pagos sin resolver.
- Un pedido guardado durante un corte se sincroniza sin duplicarse.
- Los permisos bloquean acciones no autorizadas.
- El propietario puede consultar reportes diarios y conciliar caja.
- Una importación masiva muestra una vista previa y errores antes de modificar el catálogo.

### Referencias comparadas y adaptación del producto


Estas fuentes documentan capacidades concretas, no una norma universal ni una equivalencia directa con los conceptos de este PRD. La separación entre ubicación, atención, cuenta y sesión QR es una decisión de producto; las fuentes no prueban reglas de privacidad QR ni liberación física.

- Toast documenta identidades distintas para órdenes, cuentas y selecciones, pagos separados por cuenta y consumo agregado a órdenes existentes; artículos añadidos después del envío pueden originar un nuevo ticket de cocina. [Order object](https://doc.toasttab.com/doc/devguide/apiOrdersOrderObjectSummary.html), [órdenes y cuentas](https://doc.toasttab.com/doc/devguide/portalOrdersApiOverview.html), [agregar artículos](https://doc.toasttab.com/doc/devguide/apiAddingItemsToACheck.html).
- Lightspeed Restaurant L-Series documenta división por asiento, artículos o partes iguales y comprobantes restantes; transferir a una mesa ocupada puede pedir fusionar cuentas. [Dividir una cuenta](https://resto-support.lightspeedhq.com/hc/en-us/articles/226405708-Splitting-a-bill), [transferir y fusionar](https://resto-support.lightspeedhq.com/hc/en-us/articles/226405488-Transferring-and-merging-orders).
- Square documenta cuentas individuales para un comensal que se retira antes y reparto de productos compartidos; algunas capacidades avanzadas dependen del plan. [Administrar puestos](https://squareup.com/help/us/en/article/8583-manage-seats-in-your-restaurant).
- Oracle Simphony documenta varias cuentas abiertas por mesa y mesas agrupadas con relación padre/hija; esto no prueba por sí solo las reglas de privacidad de QR definidas aquí. [Estado de mesas TMS](https://docs.oracle.com/en/industries/food-beverage/simphony/sipou/c_tms_host_dining_table_status.htm).

- Square documenta reinicios de números de ticket según horario configurado o umbral; Toast distingue identificadores de orden, cuenta y selección, pero no prueba un corte de día de negocio ni una regla de reinicio de Atención; Lightspeed L-Series describe secuencias impresas con umbrales y Oracle Simphony números de cuenta por centro de ingresos. Son comportamientos de productos concretos, no un estándar ni equivalentes a Atención. La adaptación aprobada usa una secuencia compartida por sucursal y día local, sin ciclos intradía ni hora predeterminada. [Square](https://squareup.com/us/en/release-notes/release-notes-may-21st), [Toast: identificadores](https://doc.toasttab.com/doc/devguide/apiOrdersOrderObjectSummary.html), [Lightspeed](https://resto-support.lightspeedhq.com/hc/en-us/articles/360035363894-Advanced-printer-template-settings), [Oracle Simphony](https://docs.oracle.com/en/industries/food-beverage/simphony/19.7/simcg/c_transactions_check_numbers.htm).

## 22. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Demasiada configuración | Valores predeterminados seguros |
| Mala conexión | Guardado local y estados visibles |
| Pedidos QR falsos | Confirmación predeterminada y límites |
| Cobros duplicados | Estados de pago y reintentos seguros |
| Menú demasiado complejo | Separar precio, disponibilidad y seguimiento |
| Baja adopción | Interfaz sencilla y capacitación breve |

## 23. Siguientes pasos

- Elaborar el modelo de dominio.
- Diseñar los flujos y prototipos de experiencia.
- Definir arquitectura y despliegue.
- Medir la operación actual del restaurante piloto.
- Convertir requisitos en escenarios de prueba.
- Preparar el plan incremental de implementación.

