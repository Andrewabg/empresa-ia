
import type { Ficha } from '@/lib/google-ads/ficha'
import type { ArquetipoConta } from '@/lib/trafego/perfilConta'

export interface AccountProfile {
  negocio?: string
  publicos?: { funcionam: string[]; falharam: string[] }
  criativos?: { funcionam: string[]; cansam: string[] }
  temporais?: string[]
  jaTestado?: string[]
  
  fichaGoogle?: Ficha
  
  perfilConta?: { arquetipo?: ArquetipoConta; nicho?: string; alvo?: number; ticket?: number }
}

export interface AccountLearning { texto: string; origem: 'reflector' | 'operador' | 'rui' | 'gael'; at: string }
export interface AccountMemory { perfil: AccountProfile; aprendizados: AccountLearning[] }


export interface MemoryPatch {
  negocio?: string
  publicosFuncionam?: string[]; publicosFalharam?: string[]
  criativosFuncionam?: string[]; criativosCansam?: string[]
  temporais?: string[]; jaTestado?: string[]
  aprendizados?: string[]
  
  fichaGoogle?: Ficha
  
  perfilConta?: { arquetipo?: ArquetipoConta; nicho?: string; alvo?: number; ticket?: number }
}

export const PERFIL_CAP = 8
export const APRENDIZADOS_CAP = 30
const norm = (s: string): string => s.trim().toLowerCase()


function ehLixo(t: string): boolean {
  return !/[\p{L}\p{N}]/u.test(t)
}


function mergeArr(atual: string[] | undefined, novos: string[] | undefined, cap: number): string[] {
  const out = (atual ?? []).filter((t) => !ehLixo(t))
  const seen = new Set(out.map(norm))
  for (const raw of novos ?? []) {
    const t = raw.trim()
    if (!t || ehLixo(t) || seen.has(norm(t))) continue
    seen.add(norm(t)); out.push(t)
  }
  return out.length > cap ? out.slice(out.length - cap) : out
}


function negocioLimpo(s: string | undefined): string | undefined {
  const t = s?.trim()
  return t && !ehLixo(t) ? t : undefined
}


export function mergeAccountMemory(
  atual: AccountMemory, patch: MemoryPatch, ctx: { origem: AccountLearning['origem']; at: string },
): AccountMemory {
  const p = atual.perfil ?? {}
  const negocio = negocioLimpo(patch.negocio) ?? negocioLimpo(p.negocio)
  const publicos = {
    funcionam: mergeArr(p.publicos?.funcionam, patch.publicosFuncionam, PERFIL_CAP),
    falharam: mergeArr(p.publicos?.falharam, patch.publicosFalharam, PERFIL_CAP),
  }
  const criativos = {
    funcionam: mergeArr(p.criativos?.funcionam, patch.criativosFuncionam, PERFIL_CAP),
    cansam: mergeArr(p.criativos?.cansam, patch.criativosCansam, PERFIL_CAP),
  }
  const temporais = mergeArr(p.temporais, patch.temporais, PERFIL_CAP)
  const jaTestado = mergeArr(p.jaTestado, patch.jaTestado, PERFIL_CAP)

  let aprendizados = [...(atual.aprendizados ?? [])].filter((l) => !ehLixo(l.texto))
  const seen = new Set(aprendizados.map((l) => norm(l.texto)))
  for (const raw of patch.aprendizados ?? []) {
    const t = raw.trim()
    if (!t || ehLixo(t) || seen.has(norm(t))) continue
    seen.add(norm(t))
    aprendizados.push({ texto: t, origem: ctx.origem, at: ctx.at })
  }
  if (aprendizados.length > APRENDIZADOS_CAP) aprendizados = aprendizados.slice(aprendizados.length - APRENDIZADOS_CAP)

  
  const fichaGoogle = patch.fichaGoogle ?? p.fichaGoogle
  
  const perfilConta = patch.perfilConta ?? p.perfilConta
  return { perfil: { ...(negocio ? { negocio } : {}), publicos, criativos, temporais, jaTestado, ...(fichaGoogle ? { fichaGoogle } : {}), ...(perfilConta ? { perfilConta } : {}) }, aprendizados }
}


export function renderAccountMemory(mem: AccountMemory): string {
  const p = mem.perfil ?? {}
  const linhas: string[] = []
  if (p.negocio) linhas.push(`Negócio: ${p.negocio}`)
  if (p.publicos?.funcionam?.length) linhas.push(`Públicos que funcionam: ${p.publicos.funcionam.join('; ')}`)
  if (p.publicos?.falharam?.length) linhas.push(`Públicos que falharam: ${p.publicos.falharam.join('; ')}`)
  if (p.criativos?.funcionam?.length) linhas.push(`Criativos que funcionam: ${p.criativos.funcionam.join('; ')}`)
  if (p.criativos?.cansam?.length) linhas.push(`Criativos que cansam: ${p.criativos.cansam.join('; ')}`)
  if (p.temporais?.length) linhas.push(`Padrões temporais: ${p.temporais.join('; ')}`)
  if (p.jaTestado?.length) linhas.push(`Já testado: ${p.jaTestado.join('; ')}`)
  for (const l of mem.aprendizados ?? []) linhas.push(`- ${l.texto}`)
  return linhas.join('\n')
}
