
import type { SupabaseClient } from '@supabase/supabase-js'
import { pendingCandidates, resolveCandidate } from '@/brain/curator/candidates'
import { podeVirarMemoriaDuravel } from '@/lib/memory/origemDaCandidata'
import {
  CHAVE_ORIGENS_RECUSADAS_AVISADAS,
  EXEMPLOS_NO_AVISO,
  agruparRecusasPorFato,
  deveAvisarOrigemRecusada,
  deveResincronizarMarcador,
  novasDesdeOAviso,
  resumoDaOrigemRecusada,
  trechoDaRecusa,
  type RecusaDeOrigem,
} from '@/lib/memory/avisoDeOrigemRecusada'
import { serverDb } from '@/server/supabase'
import { getSetting, setSetting } from '@/data/settings'
import { insertNotificacao } from '@/data/notificacoes'

interface CandidataOrigem {
  id: number
  origin_class?: string | null
  raw_content?: string | null
}


export const MOTIVO_ORIGEM_RECUSADA = 'origem não durável'


export const TIPO_AVISO_ORIGEM_RECUSADA = 'origem_recusada'

export interface ResultadoDoPortao {
  
  leu: boolean
  
  marcadas: number
  
  recusas: RecusaDeOrigem[]
}


export async function marcarInelegiveisComoDescartadas(db: SupabaseClient): Promise<ResultadoDoPortao> {
  const { data, error } = await pendingCandidates(db)
  
  
  if (error || !data) return { leu: false, marcadas: 0, recusas: [] }
  const inelegiveis = (data as CandidataOrigem[]).filter((c) => !podeVirarMemoriaDuravel(c.origin_class))
  let marcadas = 0
  const recusas: RecusaDeOrigem[] = []
  for (const c of inelegiveis) {
    
    recusas.push({
      id: c.id,
      classe: String(c.origin_class ?? ''),
      trecho: trechoDaRecusa(c.raw_content),
    })
    const { error: err } = await resolveCandidate(db, c.id, 'descartada', { motivo: MOTIVO_ORIGEM_RECUSADA })
    if (!err) marcadas++
  }
  return { leu: true, marcadas, recusas }
}


export function portaoFechou(r: ResultadoDoPortao): boolean {
  return r.leu && r.marcadas >= r.recusas.length
}


export const CLAIM_FRIO_MS = 15 * 60_000


export async function reivindicarCandidata(
  db: SupabaseClient,
  id: number,
  agoraIso: string,
  frioAntesDeIso: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from('memory_candidates')
    .update({ claimed_at: agoraIso })
    .eq('id', id)
    .eq('status', 'pending')
    .or(`claimed_at.is.null,claimed_at.lt.${frioAntesDeIso}`)
    .select()
  if (error) throw new Error(`reivindicarCandidata ${id}: ${error.message}`)
  return data && data.length === 1 ? (data[0] as Record<string, unknown>) : null
}

export interface MedidaDoPortao {
  
  total: number
  
  maiorId: number
}


export async function medirRecusasPorOrigem(db: SupabaseClient): Promise<MedidaDoPortao> {
  const { data, count, error } = await db
    .from('memory_candidates')
    .select('id', { count: 'exact' })
    .eq('status', 'descartada')
    .order('id', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  return { total: count ?? 0, maiorId: Number((data ?? [])[0]?.id ?? 0) }
}

export interface AvisoDeOrigemRecusada {
  
  total: number
  
  novas: number
  
  avisou: boolean
  
  falhou: boolean
}

export interface AvisarRecusasDeps {
  medirRecusas?: () => Promise<MedidaDoPortao>
  ultimasRecusadas?: (limite: number) => Promise<RecusaDeOrigem[]>
  lerMarcador?: () => Promise<string | null>
  gravarMarcador?: (valor: string) => Promise<void>
  inserirAviso?: typeof insertNotificacao
}


export async function ultimasRecusadasPorOrigem(
  db: SupabaseClient,
  limite = EXEMPLOS_NO_AVISO,
): Promise<RecusaDeOrigem[]> {
  const { data, error } = await db
    .from('memory_candidates')
    .select('id, origin_class, raw_content')
    .eq('status', 'descartada')
    .order('processed_at', { ascending: false, nullsFirst: false })
    .limit(limite)
  if (error) throw new Error(error.message)
  return (data ?? []).map((c: CandidataOrigem) => ({
    id: c.id,
    classe: String(c.origin_class ?? ''),
    trecho: trechoDaRecusa(c.raw_content),
  }))
}


export const TETO_DE_AGRUPAMENTO = 60


export async function avisarRecusasDeOrigem(
  deps: AvisarRecusasDeps = {},
): Promise<AvisoDeOrigemRecusada> {
  const medir = deps.medirRecusas ?? (() => medirRecusasPorOrigem(serverDb()))
  const buscarLinhas = deps.ultimasRecusadas ?? ((limite: number) => ultimasRecusadasPorOrigem(serverDb(), limite))
  const ler = deps.lerMarcador ?? (() => getSetting(CHAVE_ORIGENS_RECUSADAS_AVISADAS))
  const gravar = deps.gravarMarcador ?? ((v: string) => setSetting(CHAVE_ORIGENS_RECUSADAS_AVISADAS, v))
  const inserir = deps.inserirAviso ?? insertNotificacao

  const { total, maiorId } = await medir()
  const bruto = await ler()
  const jaAvisadas = bruto === null ? null : Number(bruto)

  
  
  if (deveResincronizarMarcador(total, jaAvisadas)) {
    await gravar(String(total))
    return { total, novas: 0, avisou: false, falhou: false }
  }
  if (!deveAvisarOrigemRecusada(total, jaAvisadas)) return { total, novas: 0, avisou: false, falhou: false }

  const novas = novasDesdeOAviso(total, jaAvisadas)
  
  
  
  
  
  
  
  
  
  
  
  let exemplos: RecusaDeOrigem[] = []
  let mostrar = novas
  let porFato = false
  try {
    const linhas = await buscarLinhas(novas <= TETO_DE_AGRUPAMENTO ? novas : EXEMPLOS_NO_AVISO)
    exemplos = linhas
    if (novas <= TETO_DE_AGRUPAMENTO && linhas.length >= novas) {
      const fatos = agruparRecusasPorFato(linhas)
      if (fatos.length > 0) {
        mostrar = fatos.length
        exemplos = fatos.map((f) => f.representante)
        porFato = true
      }
    }
  } catch (e) { console.warn('[candidatasElegiveis] exemplos fail-open:', e) }
  const resumo = resumoDaOrigemRecusada(mostrar, exemplos, porFato)
  if (!resumo) return { total, novas, avisou: false, falhou: false }

  const r = await inserir({
    tipo: TIPO_AVISO_ORIGEM_RECUSADA,
    urgencia: 'imediata',
    titulo: resumo.titulo,
    corpo: resumo.corpo,
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    dedupKey: `${TIPO_AVISO_ORIGEM_RECUSADA}:${maiorId}:${total}`,
  })
  await gravar(String(total))
  return { total, novas, avisou: r.created, falhou: false }
}
