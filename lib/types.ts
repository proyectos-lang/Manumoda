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
