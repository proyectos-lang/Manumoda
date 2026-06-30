export const FACTOR_TELA: Record<string, number> = {
  "LIGERA":     1.0,
  "MEDIA":      1.2,
  "PESADA":     1.5,
  "MUY PESADA": 1.7,
}

const TRAZOS_SCALE: Record<string, [number, number][]> = {
  "LIGERA":     [[800,1],[1200,1],[1800,2],[2400,3],[3000,3],[3800,4],[4400,5],[Infinity,5]],
  "MEDIA":      [[800,1],[1200,1],[1800,2],[2400,3],[3000,4],[3800,5],[4400,6],[Infinity,6]],
  "PESADA":     [[800,1],[1200,2],[1800,3],[2400,4],[3000,5],[3800,6],[4400,7],[Infinity,7]],
  "MUY PESADA": [[800,1],[1200,3],[1800,4],[2400,6],[3000,7],[3800,8],[4400,8],[Infinity,8]],
}

export const COMPLEMENTOS_HORAS = {
  comp_combinacion: 3,
  comp_entretela:   2,
  comp_poquetin:    2,
  comp_forro:       2,
}

export function getValorTrazos(tipoTela: string, cantTrazos: number): number {
  const scale = TRAZOS_SCALE[tipoTela] ?? []
  return scale.find(([max]) => cantTrazos <= max)?.[1] ?? 0
}

export function calcHorasCostura(params: {
  horasBase: number
  tipoTela: string
  trazos: number
  comp_combinacion: boolean
  comp_entretela: boolean
  comp_poquetin: boolean
  comp_forro: boolean
}): number {
  const factorTela   = FACTOR_TELA[params.tipoTela] ?? 0
  const valorTrazos  = getValorTrazos(params.tipoTela, params.trazos)
  const complementos = (params.comp_combinacion ? 3 : 0)
                     + (params.comp_entretela   ? 2 : 0)
                     + (params.comp_poquetin    ? 2 : 0)
                     + (params.comp_forro       ? 2 : 0)
  return Math.round((params.horasBase + factorTela + valorTrazos + complementos) * 100) / 100
}
