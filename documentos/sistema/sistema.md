Sí. Podemos hacerlo como un **ejercicio real para diseñar un sistema desde cero**, pensando primero en personas y procesos y recién después en pantallas o código.

Vamos a usar un ejemplo pequeño: **Sistema de pedidos de un restaurante**.

La regla del ejercicio será:

> Primero definimos qué necesita hacer la persona. Después definimos qué debe hacer el sistema. Al final recién pensamos en interfaz, base de datos y programación.

## Ejercicio 1 — Definir el sistema

### Problema

Un restaurante actualmente trabaja así:

Un cliente se sienta → llama al mozo → pide platos → el mozo comunica el pedido a cocina → cocina prepara → el mozo entrega → finalmente cobran.

Queremos digitalizar ese proceso.

Nuestro objetivo inicial será solamente:

> **Permitir que un mozo registre un pedido de una mesa y que cocina pueda recibirlo y procesarlo.**

Nada de QR, división de cuenta, promociones, inventario, delivery, etc. todavía.

---

## Paso 1 — Identificar los actores

Preguntamos:

**¿Quién utiliza o participa en este proceso?**

Para nuestra primera versión:

| Actor | Qué necesita hacer |
|---|---|
| Mozo | Registrar pedidos |
| Cocina | Recibir y preparar pedidos |
| Cliente | Solicitar alimentos |
| Sistema | Coordinar todo |

El cliente todavía no toca directamente el sistema.

---

# Paso 2 — Flujo del usuario

Ahora escribimos solamente lo que hace el **mozo**.

### Flujo del mozo

```text
1. Abre la aplicación.
2. Ve las mesas.
3. Selecciona una mesa.
4. Pulsa "+ Pedido".
5. Selecciona productos.
6. Puede escribir observaciones.
7. Revisa el pedido.
8. Pulsa "Enviar a cocina".
9. Recibe confirmación.
```

Observa algo importante:

Todavía **no estamos diciendo cómo programarlo**.

Solo describimos la experiencia humana.

---

# Paso 3 — Flujo del sistema

Ahora hacemos la misma historia desde el punto de vista del software.

```text
1. El sistema muestra las mesas disponibles.

2. El usuario selecciona Mesa 08.

3. El sistema comprueba:
   ¿Existe una atención activa para Mesa 08?

4. Si NO existe:
   crea una atención.

5. El mozo selecciona productos.

6. El sistema mantiene temporalmente esos productos
   en un borrador.

7. El mozo pulsa "Enviar a cocina".

8. El sistema valida:
   - Existe al menos un producto.
   - La mesa sigue disponible/activa.
   - Los productos siguen disponibles.

9. El sistema crea un pedido.

10. El pedido recibe:
    Estado = RECIBIDO.

11. Se guarda el pedido.

12. El pedido aparece en Cocina.

13. El sistema confirma al mozo:
    "Pedido enviado".
```

Aquí ya estamos entrando en **lógica del sistema**.

---

# Paso 4 — Juntar Usuario + Sistema

Ahora hacemos una tabla que es probablemente la herramienta que más te va a servir.

### Flujo de interacción Usuario–Sistema

| # | Usuario | Sistema |
|---|---|---|
| 1 | Abre Salón | Muestra las mesas |
| 2 | Selecciona Mesa 08 | Busca la atención de esa mesa |
| 3 | Pulsa `+ Pedido` | Crea un borrador |
| 4 | Selecciona Lomo | Agrega Lomo al borrador |
| 5 | Selecciona Chicha | Agrega Chicha |
| 6 | Escribe “sin cebolla” | Guarda observación |
| 7 | Pulsa `Enviar a cocina` | Valida el pedido |
| 8 | — | Crea Pedido #1052 |
| 9 | — | Estado = `RECIBIDO` |
| 10 | — | Envía el pedido a Cocina |
| 11 | Ve confirmación | Muestra “Pedido enviado” |

Esto ya podría entregarse a un desarrollador.

---

# Paso 5 — Estados

Ahora preguntamos:

> ¿Qué puede pasarle a un pedido durante su vida?

Definimos:

```text
RECIBIDO
   ↓
EN_PREPARACION
   ↓
LISTO
   ↓
ENTREGADO
```

Esto se llama una **máquina de estados**.

Y ahora definimos quién puede hacer cada cambio:

| Estado actual | Acción | Nuevo estado | Actor |
|---|---|---|---|
| Recibido | Iniciar preparación | En preparación | Cocina |
| En preparación | Terminar | Listo | Cocina |
| Listo | Entregar | Entregado | Mozo |

Ahora el sistema empieza a estar muy bien definido.

---

# Paso 6 — Reglas de negocio

Aquí escribimos cosas que **el sistema debe respetar siempre**.

Por ejemplo:

```text
R01.
Un pedido no puede enviarse vacío.

R02.
Cada vez que el mozo pulsa "Enviar a cocina"
se crea un nuevo pedido.

R03.
Un pedido ya enviado no debe modificarse
silenciosamente.

R04.
Si el cliente quiere algo adicional,
se crea un nuevo pedido.

R05.
Cocina solamente ve pedidos confirmados.

R06.
Un pedido LISTO puede pasar a ENTREGADO.

R07.
La mesa puede tener varios pedidos activos.
```

Estas reglas son importantísimas.

---

# Paso 7 — Casos excepcionales

Ahora hacemos preguntas incómodas.

Por ejemplo:

### ¿Qué pasa si pulsa dos veces “Enviar”?

Respuesta:

```text
El sistema debe evitar pedidos duplicados.
```

### ¿Qué pasa si quiere agregar otra gaseosa?

```text
Se crea un nuevo pedido.
No se modifica el anterior.
```

### ¿Qué pasa si cocina ya comenzó pero el cliente quiere cancelar?

Aquí debemos decidir una regla.

Por ejemplo:

```text
RECIBIDO → puede cancelarse.
EN_PREPARACION → requiere autorización.
LISTO → no puede cancelarse normalmente.
```

Eso después se convierte en programación.

---

# Paso 8 — Ahora sí pensamos en pantallas

Recién después de definir lo anterior.

Necesitamos inicialmente solo:

```text
Pantalla 1
SALÓN / MESAS

Pantalla 2
DETALLE DE MESA

Pantalla 3
NUEVO PEDIDO

Pantalla 4
COCINA

Pantalla 5
CUENTA
```

Nada más.

---

# Paso 9 — Modelo de datos básico

Después preguntamos:

> ¿Qué información necesita guardar el sistema?

### Mesa

```text
id
numero
estado
capacidad
```

### Atención

```text
id
mesa_id
fecha_inicio
fecha_fin
estado
```

### Pedido

```text
id
atencion_id
fecha
estado
registrado_por
```

### DetallePedido

```text
id
pedido_id
producto_id
cantidad
observacion
precio
```

### Producto

```text
id
nombre
precio
categoria
activo
```

Y ya tenemos la base conceptual.

---

# Paso 10 — Convertirlo a comportamiento casi programable

Ahora usamos Gherkin:

```text
ESCENARIO:
Mozo envía un pedido a cocina.

DADO
que la Mesa 08 está disponible

Y
el mozo seleccionó:
- 1 Lomo saltado
- 1 Chicha morada

CUANDO
pulsa "Enviar a cocina"

ENTONCES
el sistema debe crear un pedido

Y
asociarlo con Mesa 08

Y
establecer su estado como RECIBIDO

Y
mostrarlo en Cocina

Y
confirmar al mozo que el pedido fue enviado.
```

Esto ya está muy cerca de algo que una IA puede convertir en código.

---

## Y aquí viene la parte interesante

Después hacemos una **segunda iteración**.

V1:

**Mesa → Pedido → Cocina**

Luego detectamos:

> “No sabemos quién pidió cada plato.”

Entonces agregamos solamente:

**Comensal opcional**

Y actualizamos nuestro flujo.

Después:

> “Hay mesas que se juntan.”

Agregamos:

**Atención → puede tener varias mesas**

Después:

> “Quieren pagar separado.”

Agregamos:

**Pago / división de cuenta**

Así evolucionas el sistema **sin intentar diseñarlo entero desde el primer día**.

---

## Tu primer ejercicio

Imagínate ahora que estamos empezando completamente desde cero.

Necesitamos diseñar:

> **Sistema para una barbería.**

El cliente llega, espera, un barbero lo atiende, realiza uno o varios servicios y finalmente paga.

Tu tarea inicial sería escribir solamente esto:

```text
ACTORES:

1.
2.
3.

FLUJO DEL USUARIO:

1.
2.
3.
4.
5.

RESULTADO FINAL:

...
```

Y desde ahí podemos construir juntos **flujo del usuario → flujo del sistema → estados → reglas → pantallas → datos → casos de uso**, hasta tener una especificación lista para programar.