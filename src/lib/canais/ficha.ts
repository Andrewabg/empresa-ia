

export interface FichaPerfil { nome?: string; observacoes?: string }
export interface FichaFato { texto: string; origem: 'agente' | 'operador' | 'reflector'; at: string }
export interface FichaContato { perfil: FichaPerfil; aprendizados: FichaFato[] }
export interface FichaPatch { nome?: string; observacoes?: string; aprendizados?: string[] }

export const FICHA_FATOS_CAP = 20
const norm = (s: string): string => s.trim().toLowerCase()

export function mergeFicha(
  atual: FichaContato, patch: FichaPatch, ctx: { origem: FichaFato['origem']; at: string },
): FichaContato {
  const p = atual.perfil ?? {}
  const nome = patch.nome?.trim() ? patch.nome.trim() : p.nome
  const observacoes = patch.observacoes?.trim() ? patch.observacoes.trim() : p.observacoes

  let aprendizados = [...(atual.aprendizados ?? [])]
  const seen = new Set(aprendizados.map((f) => norm(f.texto)))
  for (const raw of patch.aprendizados ?? []) {
    const t = raw.trim()
    if (!t || seen.has(norm(t))) continue
    seen.add(norm(t))
    aprendizados.push({ texto: t, origem: ctx.origem, at: ctx.at })
  }
  if (aprendizados.length > FICHA_FATOS_CAP) aprendizados = aprendizados.slice(aprendizados.length - FICHA_FATOS_CAP)

  return { perfil: { ...(nome ? { nome } : {}), ...(observacoes ? { observacoes } : {}) }, aprendizados }
}


export function renderFicha(m: FichaContato): string {
  const linhas: string[] = []
  if (m.perfil?.nome) linhas.push(`Nome: ${m.perfil.nome}`)
  if (m.perfil?.observacoes) linhas.push(`Observações: ${m.perfil.observacoes}`)
  for (const f of m.aprendizados ?? []) linhas.push(`- ${f.texto}`)
  return linhas.join('\n')
}
