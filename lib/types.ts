export type OrdenProduccion = {
  id?: number | string
  idempresa: number
  folio: string
  num_pedido: string | null
  modelo: string | null
  familia: string | null
  categoria: string | null
  maquilero: string | null
  cliente: string | null
  fecha_pedido: string | null
  fecha_cancelacion: string | null
  tipo_pedido: string | null
  piezas: number | null
  /** Piezas cortadas según el Excel (columna PIEZAS_CORTADAS). */
  piezas_cortadas?: number | null
  corte_origen: string | null
  fase_actual: string
  idmaquilero?: number | null
  idcompradora?: number | null
  fecha_s1?: string | null
  fecha_s2?: string | null
  fecha_s3?: string | null
  fecha_s4?: string | null
  fecha_s5?: string | null
  fecha_s6?: string | null
  fecha_s7?: string | null
  calidad?: number | null
  tipo_revision?: string | null
  habilitaciones_insumos?: string | null
  comentarios_generales?: string | null
  fecha_ultima_revision?: string | null
  diseno_programado?: boolean | null
  fecha_aprobacion_diseno?: string | null
  no_requiere_diseno?: boolean | null
  no_requiere_corte?: boolean | null
  corte_programado?: boolean | null
  fecha_limite_confirmacion?: string | null
  fecha_contra_muestra?: string | null
  /** Si tiene valor, la orden está entregada: no cuenta como vencida ni alerta. */
  fecha_facturacion?: string | null
  // ── Dinero (script 027). Todos POR PIEZA, tal como vienen del Excel ──
  /** Lo que se le paga al maquilero por pieza. */
  costo_maquila?: number | null
  /** Lo que cobra la lavandería por pieza; se paga a un tercero. */
  costo_lavanderia?: number | null
  /** Servicios externos, todos por pieza (script 032). */
  costo_estampado?: number | null
  costo_bordado?: number | null
  costo_corte_externo?: number | null
  costo_otro?: number | null
  /** Precio de venta por pieza. Base del cálculo de penalizaciones. */
  precio_venta?: number | null
  /** Precio al público por pieza. Informativo. */
  precio_publico?: number | null
}

/**
 * Vista `vw_seguimiento_integrado`: un folio de punta a punta por las tres
 * etapas (Diseño → Corte → Maquila). Incluye TODAS las órdenes, a diferencia
 * de `vw_resumen_operacion` que excluye 'Por Programar' y 'S7'.
 */
export type SeguimientoRow = {
  id: number | string
  idempresa: number
  folio: string
  modelo: string | null
  familia: string | null
  cliente: string | null
  maquilero_nombre: string | null
  piezas: number | null
  fase_actual: string
  // fechas de la orden
  fecha_pedido: string | null
  fecha_limite_confirmacion: string | null
  fecha_contra_muestra: string | null
  fecha_cancelacion: string | null
  fecha_ultima_revision: string | null
  // etapa 1: diseño
  fecha_diseno: string | null
  nombre_disenador: string | null
  cumplimiento_diseno: boolean | null
  fecha_aprobacion_diseno: string | null
  no_requiere_diseno: boolean | null
  // etapa 2: corte
  fecha_corte: string | null
  nombre_cortador: string | null
  cumplimiento_corte: string | null
  no_requiere_corte: boolean | null
  // etapa 3: maquila
  fecha_s1: string | null
  fecha_s2: string | null
  fecha_s3: string | null
  fecha_s4: string | null
  fecha_s5: string | null
  fecha_s6: string | null
  fecha_s7: string | null
  calidad: number | null
  tipo_revision: string | null
  habilitaciones_insumos: string | null
  comentarios_generales: string | null
  // riesgo calculado en la vista
  riesgo_entrega: string | null
  dias_restantes: number | null
  /** Si tiene valor, la orden está entregada: no cuenta como vencida ni alerta. */
  fecha_facturacion: string | null
}

export type VwPlanCorteDetalle = {
  registro_id: number
  fecha: string | null
  semana: number | null
  no_origen: string | null
  folio: string
  piezas_orden: number | null
  familia: string | null
  categoria: string | null
  tipo_tela: string | null
  metros_utilizar: number | null
  complejidad_de_tela: string | null
  combinacion: boolean | null
  no_piezas: number | null
  idcortador: number | null
  cortador_nombre: string | null
  idapoyo: number | null
  apoyo_nombre: string | null
  mesa: string | null
  trazos: number | null
  variable_subjetiva: number | null
  cumplimiento_corte: string | null
  horas_plan_corte: number | null
  horas_plan_final: number | null
  horas_cumplimiento_corte: number | null
  // New fields from multiplicative system
  idfamilia_corte: number | null
  categoria_corte: string | null
  categoria_tela: string | null
  tendidos: number | null
  comp_entretela: boolean | null
  comp_poquetin: boolean | null
  comp_forro: boolean | null
  calificacion: number | null
  comentarios: string | null
  piezas_cortadas: number | null
  /** Fecha de entrega del pedido — la vista la lee fresca desde ordenes_produccion (script 013). */
  fecha_cancelacion: string | null
  idempresa: number
}

export type VwBonosCorte = {
  registro: number
  anio: number | null
  semana: number | null
  nombre: string | null
  area: string | null
  horas_semana: number | null
  horas_cumplidas: number | null
  horas_fuera_area: number | null
  ausentismos: number | null
  porcentaje_eficiencia: number | null
  criterio_aceptacion: string | null
  bono_semanal: string | null
  monto: number | null
  estatus_colaborador: string | null
  porcentaje_productividad_directa: number | null
}

/**
 * Vista `vw_pago_maquilas` (script 028): el libro mayor de cuentas por
 * pagar a maquileros, una fila por folio.
 *
 * Los importes se derivan del costo vigente de la orden; lo único guardado
 * son los pagos. PostgREST devuelve `numeric` como número en JS, pero
 * conviene pasarlo por `Number()` antes de operar.
 */
export type VwPagoMaquilas = {
  id: number
  idempresa: number
  folio: string
  modelo: string | null
  familia: string | null
  cliente: string | null
  /** Texto tal como vino del Excel. */
  maquilero_nombre: string | null
  idmaquilero: number | null
  /** Nombre del catálogo, null si el texto no resolvió. */
  maquilero_catalogo: string | null
  /** Catálogo si resolvió, si no el texto. Es la clave de agrupación. */
  beneficiario: string | null
  fase_actual: string | null
  /** Fecha en que se levantó el pedido. */
  fecha_pedido: string | null
  fecha_cancelacion: string | null
  fecha_facturacion: string | null
  /** Arranque de maquila. De aquí corren los 45 días de plazo. */
  fecha_s1: string | null
  /** fecha_s1 + 45 días: hasta cuándo puede entregar sin penalización. */
  fecha_limite_maquilero: string | null
  /** Lo que dijo el Excel en FECHA_STATUS5. */
  fecha_entrega_s5: string | null
  /** Corrección manual desde Pago Maquilas; manda sobre la del Excel. */
  fecha_entrega_corregida: string | null
  /** Fecha de la ÚLTIMA parcialidad recibida. */
  fecha_ultima_entrega: string | null
  /** La que manda para la demora: la corregida, si no la última parcialidad. */
  fecha_entrega_maquilero: string | null
  /** true = no hay ninguna parcialidad ni corrección: cuenta como no entregado. */
  sin_entrega: boolean
  piezas_orden: number | null
  /** Lo que se le entregó al maquilero para confeccionar. */
  piezas_cortadas: number
  costo_maquila: number | null
  precio_venta: number | null
  precio_publico: number | null
  /** Costos de servicios externos, informativos. El saldo vive en VwServicioPago. */
  costo_lavanderia: number | null
  costo_estampado: number | null
  costo_bordado: number | null
  costo_corte_externo: number | null
  costo_otro: number | null
  /** Ajuste manual si existe, si no la suma de las entregas. */
  piezas_recibidas: number
  /** Lo que suman los registros de entrega. */
  piezas_recibidas_entregas: number
  /** Valor fijado a mano; null = se usa la suma de entregas. */
  piezas_recibidas_ajuste: number | null
  ultima_recepcion: string | null
  /** Automático: piezas de la orden − recibidas. Se descuentan a precio de venta. */
  piezas_no_entregadas: number
  valor_no_entregadas: number
  /** Piezas recibidas × costo unitario total (maquila + procesos). */
  costo_final: number
  /** Semanas completas de atraso sobre la fecha de entrega. */
  semanas_demora: number
  /** 1.5% por semana, sin tope. */
  demora_pct: number
  valor_demora: number
  /** costo_maquila + los cinco costos de proceso. */
  costo_unitario_total: number
  /** Solo los cinco costos de proceso, sin la maquila. */
  costo_unitario_servicios: number
  /** Piezas recibidas × costo_maquila. */
  valor_maquila: number
  /** Piezas recibidas × costo unitario de los procesos. */
  valor_servicios: number
  /** Cuántas veces entregó el maquilero (registros de recepción). */
  parcialidades: number
  /** Las que pasan de 3; cada una penaliza. */
  parcialidades_excedentes: number
  /** Monto por parcialidad excedente, del catálogo. */
  monto_parcialidad: number
  /** parcialidades_excedentes × monto_parcialidad. */
  valor_parcialidades: number
  /** Penalizaciones de monto fijo marcadas a mano en la gestión del folio. */
  valor_penalizaciones_fijas: number
  /** Cuántos conceptos fijos tiene marcados. */
  penalizaciones_fijas: number
  /** no entregadas + demora + fijas. Todo lo que se le descuenta al folio. */
  valor_penalizaciones: number
  /** costo_final − valor_penalizaciones. */
  valor_a_pagar: number
  valor_pagado: number
  /** Parte de lo pagado que se marcó como adelanto. */
  valor_adelantos: number
  ultimo_pago: string | null
  saldo: number
  /** false = la orden no tiene costo capturado; no es lo mismo que $0. */
  costo_capturado: boolean
  /** true = alguien corrigió la fecha de entrega a mano. */
  entrega_corregida: boolean
  /** true = las piezas recibidas se fijaron a mano. */
  recibidas_ajustadas: boolean
  estado_pago:
    | "Anticipo"
    | "Sin costo"
    | "Sin recepción"
    | "Sobrepagado"
    | "Saldado"
    | "Parcial"
    | "Pendiente"
}

/** Los cinco servicios externos que se pagan por pieza (script 032). */
export type ServicioExterno =
  | "Lavandería"
  | "Estampado"
  | "Bordado"
  | "Corte Externo"
  | "Otro"

/** Tipos de lavado. Solo aplican al servicio Lavandería. */
export type ProcesoLavanderia =
  | "Blinch"
  | "Acid wash"
  | "Stone"
  | "Stone medio"
  | "Stone alto"

export const PROCESOS_LAVANDERIA: ProcesoLavanderia[] = [
  "Blinch",
  "Acid wash",
  "Stone",
  "Stone medio",
  "Stone alto",
]

export const SERVICIOS_EXTERNOS: ServicioExterno[] = [
  "Lavandería",
  "Estampado",
  "Bordado",
  "Corte Externo",
  "Otro",
]

/**
 * Fila de `vw_servicios_pago`: un folio y un servicio.
 *
 * Sin saldo propio: desde el script 036 los servicios se le reembolsan al
 * maquilero, así que su valor entra en `VwPagoMaquilas.valor_servicios`.
 */
export type VwServicioPago = {
  idempresa: number
  folio: string
  modelo: string | null
  familia: string | null
  cliente: string | null
  maquilero_nombre: string | null
  piezas_orden: number | null
  /** Lo que se le entregó al maquilero, de referencia. */
  piezas_cortadas: number
  /** Precio de venta del folio, informativo. */
  precio_venta: number | null
  servicio: ServicioExterno
  costo_unitario: number | null
  /** Tipo de lavado. Solo se usa cuando servicio = Lavandería. */
  proceso: ProcesoLavanderia | null
  /** Las que devolvió el maquilero. */
  piezas_recibidas: number
  /** Las que este proceso trabajó. Base de su costo. */
  piezas_procesadas: number
  /** true = las procesadas se capturaron a mano; false = se asumen las recibidas. */
  procesadas_capturadas: boolean
  valor: number
}

/**
 * Pago a un proveedor de servicio externo.
 *
 * OBSOLETO desde el script 036: los servicios se le pagan al maquilero. Se
 * conserva el tipo por si el criterio cambia.
 */
export type ServicioPago = {
  id: number
  idempresa: number
  folio: string
  servicio: ServicioExterno
  fecha: string
  monto: number
  referencia: string | null
  es_adelanto: boolean
  comentarios: string | null
  capturado_por: string | null
}

/** Movimiento hijo de un folio en Pago Maquilas. */
export type MaquilaRecepcion = {
  id: number
  idempresa: number
  folio: string
  fecha: string
  piezas: number
  comentarios: string | null
  capturado_por: string | null
}

export type MaquilaPenalizacion = MaquilaRecepcion & { motivo: string }

/**
 * Concepto de penalización de monto fijo (script 043).
 *
 * Se administra desde Pago Maquilas: los montos cambian y hay conceptos
 * por definir, así que vive en catálogo y no en columnas.
 */
export type CatPenalizacionMaquila = {
  id: number
  idempresa: number
  clave: string
  nombre: string
  monto: number
  orden: number
  /** Un concepto retirado se desactiva; los folios que ya lo tienen lo conservan. */
  activo: boolean
}

/**
 * Penalización fija aplicada a un folio. Que la fila exista es lo que la
 * hace aplicar: desmarcarla es borrarla.
 */
export type MaquilaPenalizacionFija = {
  id: number
  idempresa: number
  folio: string
  idpenalizacion: number
  /** Monto del catálogo congelado al marcarla. */
  monto_aplicado: number
  comentarios: string | null
  capturado_por: string | null
}

/** Fila de `vw_historial_pagos`: maquila y lavandería en una línea de tiempo. */
export type HistorialPago = {
  /** Identificador único entre las dos tablas ("M-12", "L-4"). */
  clave: string
  tipo: "Maquila" | "Lavandería"
  idempresa: number
  folio: string
  fecha: string
  monto: number
  es_adelanto: boolean
  referencia: string | null
  comentarios: string | null
  capturado_por: string | null
  created_at: string
  modelo: string | null
  cliente: string | null
  beneficiario: string | null
}

export type MaquilaPago = {
  id: number
  idempresa: number
  folio: string
  fecha: string
  monto: number
  referencia: string | null
  /** El pago se hizo antes de recibir la mercancía. */
  es_adelanto: boolean
  costo_maquila_aplicado: number | null
  comentarios: string | null
  capturado_por: string | null
}

export type SessionUser = {
  id: number
  nombre: string
  username: string
  es_admin: boolean
  /** Ve sus módulos pero no puede modificar nada. Excluyente con es_admin. */
  solo_lectura: boolean
  permisos: string[]
}

export type ParsedRow = Pick<
  OrdenProduccion,
  | "idempresa"
  | "folio"
  | "num_pedido"
  | "modelo"
  | "familia"
  | "categoria"
  | "cliente"
  | "fecha_pedido"
  | "fecha_cancelacion"
  | "tipo_pedido"
  | "piezas"
  | "piezas_cortadas"
  | "corte_origen"
  | "fase_actual"
  | "fecha_aprobacion_diseno"
  | "fecha_s5"
  | "costo_maquila"
  | "costo_lavanderia"
  | "costo_estampado"
  | "costo_bordado"
  | "costo_corte_externo"
  | "costo_otro"
  | "precio_venta"
  | "precio_publico"
> & {
  /** Nombre del maquilero tal como viene del Excel; el uploader lo escribe
   *  en la columna de texto `maquilero`. */
  maquilero_nombre: string | null
}
