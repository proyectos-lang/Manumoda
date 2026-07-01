export type CatFamiliaCorte = {
  id: number
  nombre: string
  grupo: string
  horas_base: number
}

export type CatCategoriaCorte = {
  id: number
  nombre: string
  multiplicador: number
}

export type CatTelaCorte = {
  id: number
  nombre: string
  multiplicador: number
}

export type CatTrazosCorte = {
  id: number
  cantidad: number
  multiplicador: number
}

export type CatTendidosCorte = {
  id: number
  cantidad: number
  multiplicador: number
}

export type CatComplementoCorte = {
  id: number
  nombre: string
  clave: string
  multiplicador: number
}

export interface CalcCorteParams {
  horasBase: number
  catMult: number
  telaMult: number
  trazosMult: number
  tendidosMult: number
  compCombinacion: boolean
  compEntretela: boolean
  compPoquetin: boolean
  compForro: boolean
  complementos: CatComplementoCorte[]
}

export function calcHorasCorte(p: CalcCorteParams): number {
  let compMult = 1
  if (p.compCombinacion) compMult *= p.complementos.find(c => c.clave === "comp_combinacion")?.multiplicador ?? 1
  if (p.compEntretela)   compMult *= p.complementos.find(c => c.clave === "comp_entretela")?.multiplicador ?? 1
  if (p.compPoquetin)    compMult *= p.complementos.find(c => c.clave === "comp_poquetin")?.multiplicador ?? 1
  if (p.compForro)       compMult *= p.complementos.find(c => c.clave === "comp_forro")?.multiplicador ?? 1

  return Math.round(
    p.horasBase * p.catMult * p.telaMult * p.trazosMult * p.tendidosMult * compMult * 100
  ) / 100
}
