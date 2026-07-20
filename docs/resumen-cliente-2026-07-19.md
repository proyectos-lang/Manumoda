# Sistema de Producción Manumoda — Resumen de mejoras

**Fecha:** 19 de julio de 2026

Esta entrega convierte los módulos —que hasta ahora funcionaban de forma
independiente— en un sistema integrado donde se puede seguir un pedido de punta a
punta, y agrega alertas para que los vencimientos no pasen desapercibidos.

---

## 1. Seguimiento integrado del pedido

**Ficha completa del folio.** Al hacer clic en cualquier folio, en cualquier
pantalla del sistema, se abre una ficha con todo su ciclo de vida en un solo lugar:

- Datos del pedido, maquilero y fecha de entrega
- **Diseño**: fecha, diseñadora asignada, horas planeadas y cumplidas, aprobación del cliente
- **Corte**: fecha, cortador y ayudante, horas y calificación
- **Maquila**: avance visual de las 7 etapas (S1 a S7), calidad, insumos, última revisión y fotos de evidencia

Antes había que entrar a cuatro módulos distintos para reconstruir esta información.

**Buscador general.** Una barra de búsqueda en la parte superior permite localizar
cualquier folio o modelo desde cualquier pantalla —también con el atajo de teclado
`Ctrl + K`— y abre directamente su ficha.

**Vista de flujo Diseño → Corte → Maquila.** El módulo de Seguimiento de Órdenes
ahora muestra las tres etapas en una sola fila, agrupadas visualmente, con las
fechas y responsables de cada una. Las etapas que un pedido no requiere se marcan
como "N/A" en lugar de aparecer como pendientes.

---

## 2. Alertas de vencimiento

**Pantalla de inicio como centro de trabajo del día.** La página principal ahora
muestra seis indicadores accionables que llevan directo al módulo correspondiente:

| Indicador | Qué muestra |
|---|---|
| Vencidos | Pedidos cuya fecha de entrega ya pasó |
| Por vencer | Entrega en 7 días o menos, o que van a destiempo según su etapa |
| Sin programar | Órdenes cargadas que aún no se programan |
| Diseño por evaluar | Órdenes programadas en diseño pendientes de evaluación |
| Corte sin cumplir | Cortes programados sin marcar cumplimiento |
| Sin revisión +7 días | Órdenes en maquila sin visita reciente |

El último indicador detecta un problema que antes era invisible: pedidos que
técnicamente están "a tiempo" por fecha, pero llevan semanas sin que nadie los
revise.

**Avisos en cada módulo.** Diseño, Corte y Seguimiento Maquila muestran un aviso
en la parte superior cuando hay pedidos vencidos o próximos a vencer, con la lista
de folios afectados y los días de atraso o margen.

**Semáforo de riesgo.** Todas las tablas principales muestran el estado de cada
orden (Vencido / En Riesgo / A Tiempo) con los días restantes. Un botón
"¿Cómo se calcula el riesgo?" explica las reglas, incluyendo los días estándar
que requiere cada etapa.

---

## 3. Información para tomar decisiones

**Carga de trabajo al asignar.** Al programar una orden en Diseño, el listado de
diseñadoras y costureras muestra las horas que cada una ya tiene asignadas esa
semana sobre su capacidad (por ejemplo `38.2/45h`), con color verde, ámbar o rojo.
Lo mismo para cortadores en el módulo de Corte. Asignar deja de ser una estimación.

**Calidad del maquilero.** Al programar una orden, junto al maquilero se muestra
su calificación promedio histórica y en cuántas órdenes se basa
(por ejemplo `★ 8.2 · 12 órdenes`). El dato ahora aparece en el momento en que se
toma la decisión.

**Fecha proyectada de terminación.** La ficha del folio calcula, según la etapa
actual y los tiempos estándar, en qué fecha terminaría el pedido — y si esa fecha
cae antes o después del compromiso de entrega.

**Diagnóstico de cuellos de botella.** El Resumen de Operación identifica
automáticamente la transición entre etapas más lenta y cuántas órdenes están
detenidas ahí en este momento.

**Tendencia de eficiencia.** Los módulos de bonos incluyen una gráfica de las
últimas 12 semanas con la variación del período, para ver si el equipo mejora o
retrocede — no solo el dato de la semana en curso.

---

## 4. Carga de pedidos más segura

**Previsualización antes de aplicar.** Al subir el archivo de Excel, el sistema
ahora analiza el contenido y muestra un resumen antes de escribir nada:

- Cuántas órdenes son nuevas, cuántas se actualizarían y cuántas quedan sin cambios
- **Detalle de cada cambio**: qué campo se modifica, con el valor actual y el nuevo
- Folios repetidos dentro del mismo archivo
- Datos con formato inválido (fechas ilegibles, cantidades no numéricas), indicando la fila
- Compradores que no coinciden con el catálogo

Nada se guarda hasta confirmar. Antes, una carga podía sobrescribir información
capturada manualmente sin previo aviso.

**Reporte preciso de errores.** Si alguna fila falla, el sistema indica exactamente
qué folios no se pudieron cargar, en lugar de un conteo general.

---

## 5. Movimiento masivo entre semanas

En Diseño y en Corte se pueden seleccionar varias órdenes y moverlas a otra semana
en una sola operación, con confirmación previa.

**Las órdenes ya cumplidas quedan bloqueadas** —se muestran con un candado— porque
sus horas ya se contabilizaron en los bonos de su semana. Esto protege las
liquidaciones cerradas.

---

## 6. Mejoras de uso general

- **Exportación a Excel** del seguimiento de órdenes y del Master Tracking, respetando los filtros aplicados
- **Filtros visibles**: los filtros activos en Diseño se muestran como etiquetas que se pueden quitar individualmente
- **Fechas en lenguaje natural**: junto a "Última revisión" aparece "hace 9 días", resaltado cuando supera una semana
- **Indicadores de resumen** en Corte y Maquila, que antes no tenían
- **Vista Kanban con desplazamiento propio**: el tablero mantiene una altura fija y cada columna se desplaza internamente
- **Aviso de retroceso de etapa**: si al editar se borra una fecha intermedia y eso haría retroceder la fase del pedido, el sistema lo advierte antes de guardar
- **Protección contra guardados vacíos**: abrir un registro y guardar sin cambios ya no altera la fecha de última revisión
- **Adaptación a pantallas pequeñas**: las tablas ocultan columnas secundarias en tablets para uso en planta

---

## Resumen

| Área | Antes | Ahora |
|---|---|---|
| Seguir un pedido | Revisar 4 módulos | Una ficha con clic en el folio |
| Vencimientos | Sin alertas | Avisos en inicio y en cada módulo |
| Asignar personal | Sin referencia de carga | Carga semanal y calidad visibles |
| Cargar Excel | Escritura directa | Previsualización con detalle de cambios |
| Mover de semana | Uno por uno | Selección múltiple, con cumplidas protegidas |
| Analizar el proceso | Datos sueltos | Cuellos de botella y tendencias señalados |
