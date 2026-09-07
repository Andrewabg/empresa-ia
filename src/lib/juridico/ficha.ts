


export interface FichaLearning {
  texto: string
  origem: 'entrevista' | 'revisao' | 'reflector' | 'operador'
  at: string
}
export interface FichaJuridica {
  razaoSocial?: string
  cnpj?: string
  endereco?: string
  representante?: string
  foro?: string              
  posturas?: string[]        
  observacoes?: string       
  aprendizados: FichaLearning[]
}

export const EMPTY_FICHA_JURIDICA: FichaJuridica = Object.freeze({ aprendizados: [] }) as FichaJuridica
export const APRENDIZADOS_JURIDICOS_CAP = 40
const POSTURAS_CAP = 30
const norm = (s: string): string => s.trim().toLowerCase()


export interface FichaJuridicaPatch {
  razaoSocial?: string
  cnpj?: string
  endereco?: string
  representante?: string
  foro?: string
  posturas?: string[]
  observacoes?: string
  aprendizados?: { texto: string }[]
}

function mergeStrArr(atual: string[] | undefined, novos: string[] | undefined, cap: number): string[] {
  const out = [...(atual ?? [])]
  const seen = new Set(out.map(norm))
  for (const raw of novos ?? []) {
    const t = raw.trim()
    if (!t || seen.has(norm(t))) continue
    seen.add(norm(t)); out.push(t)
  }
  return out.length > cap ? out.slice(out.length - cap) : out
}

export function mergeFichaJuridica(
  atual: FichaJuridica, patch: FichaJuridicaPatch,
  ctx: { origem: FichaLearning['origem']; at: string },
): FichaJuridica {
  let aprendizados = [...(atual.aprendizados ?? [])]
  const seen = new Set(aprendizados.map((l) => norm(l.texto)))
  for (const raw of patch.aprendizados ?? []) {
    const t = raw.texto.trim()
    if (!t || seen.has(norm(t))) continue
    seen.add(norm(t))
    aprendizados.push({ texto: t, origem: ctx.origem, at: ctx.at })
  }
  if (aprendizados.length > APRENDIZADOS_JURIDICOS_CAP) {
    aprendizados = aprendizados.slice(aprendizados.length - APRENDIZADOS_JURIDICOS_CAP)
  }
  return {
    razaoSocial: patch.razaoSocial?.trim() || atual.razaoSocial,
    cnpj: patch.cnpj?.trim() || atual.cnpj,
    endereco: patch.endereco?.trim() || atual.endereco,
    representante: patch.representante?.trim() || atual.representante,
    foro: patch.foro?.trim() || atual.foro,
    posturas: mergeStrArr(atual.posturas, patch.posturas, POSTURAS_CAP),
    observacoes: patch.observacoes?.trim() || atual.observacoes,
    aprendizados,
  }
}


export function removerAprendizadoJuridico(f: FichaJuridica, texto: string): FichaJuridica {
  return { ...f, aprendizados: (f.aprendizados ?? []).filter((a) => a.texto !== texto) }
}


export function renderFichaJuridica(f: FichaJuridica): string {
  const L: string[] = []
  if (f.razaoSocial) L.push(`Razão social: ${f.razaoSocial}`)
  if (f.cnpj) L.push(`CNPJ: ${f.cnpj}`)
  if (f.endereco) L.push(`Endereço: ${f.endereco}`)
  if (f.representante) L.push(`Representante legal: ${f.representante}`)
  if (f.foro) L.push(`Foro de eleição da casa: ${f.foro}`)
  if (f.posturas?.length) L.push(`Posturas da casa (SEMPRE seguir): ${f.posturas.join('; ')}`)
  if (f.observacoes) L.push(`Observações: ${f.observacoes}`)
  for (const a of f.aprendizados ?? []) L.push(`- ${a.texto}`)
  return L.join('\n')
}
