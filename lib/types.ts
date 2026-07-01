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
}

export type VwPlanCorteDetalle = {
  registro_id: number
  fecha: string | null
  semana: number | null
  no_origen: number | null
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
  | "corte_origen"
  | "fase_actual"
  | "fecha_aprobacion_diseno"
> & {
  /** Raw maquilero name from the Excel; resolved to idmaquilero on upload. */
  maquilero_nombre: string | null
}
