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
  fecha_cancelacion: string | null
  fecha_facturacion: string | null
  piezas_orden: number | null
  /** Suma de lo cortado: lo que se le entregó al maquilero. */
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
  piezas_recibidas: number
  ultima_recepcion: string | null
  /** Automático: piezas de la orden − recibidas. Se descuentan a precio de venta. */
  piezas_no_entregadas: number
  valor_no_entregadas: number
  /** Piezas recibidas × costo unitario: la base del cálculo. */
  costo_final: number
  /** Semanas completas de atraso sobre la fecha de entrega. */
  semanas_demora: number
  /** 1.5% por semana, sin tope. */
  demora_pct: number
  valor_demora: number
  /** precio_final − no entregadas − demora. */
  valor_a_pagar: number
  valor_pagado: number
  /** Parte de lo pagado que se marcó como adelanto. */
  valor_adelantos: number
  ultimo_pago: string | null
  saldo: number
  /** false = la orden no tiene costo capturado; no es lo mismo que $0. */
  costo_capturado: boolean
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

export const SERVICIOS_EXTERNOS: ServicioExterno[] = [
  "Lavandería",
  "Estampado",
  "Bordado",
  "Corte Externo",
  "Otro",
]

/** Fila de `vw_servicios_pago`: un folio y un servicio. */
export type VwServicioPago = {
  idempresa: number
  folio: string
  modelo: string | null
  familia: string | null
  cliente: string | null
  maquilero_nombre: string | null
  piezas_orden: number | null
  servicio: ServicioExterno
  costo_unitario: number | null
  /** Precio de venta del folio, informativo. */
  precio_venta: number | null
  piezas_enviadas: number
  piezas_recibidas: number
  merma: number
  valor: number
  pagado: number
  adelantos: number
  ultimo_pago: string | null
  saldo: number
  estado:
    | "Anticipo"
    | "Sin valor"
    | "Sin recepción"
    | "Sobrepagado"
    | "Saldado"
    | "Parcial"
    | "Pendiente"
}

/** Pago a un proveedor de servicio externo. */
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
