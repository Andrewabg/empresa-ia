

import { z } from 'zod'
import { getSecret, SECRET_KEYS } from '../../secrets'
import { NotConfiguredError } from '../../brain/runtime'
import { recordCost as recordCostImpl } from '@/data/cost'
import { generateBackgroundObject } from '../../cost/backgroundLLM'
import { EXTRACTION_MAX_OUTPUT } from '@/lib/llm-tuning'
import { getSetting } from '@/data/settings'
import { ensureDefaultBrand as ensureBrandImpl } from '@/data/brands'
import { getBrandVoice as getVoiceImpl, upsertBrandVoice as upsertVoiceImpl } from '@/data/brandVoice'
import { mergeBrandVoice, type BrandVoicePatch } from '@/lib/estudio/brandVoice'
import { serverDb } from '@/server/supabase'
import { TOPICS, topicTag } from '@/server/interview/topics'
import { escolherNotasDaMarca, renderNotasDaMarca } from '@/lib/estudio/notasDaMarca'
import type { EstudioPatch } from '@/lib/estudio/types'

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.1'


const DnaSchema = z.object({
  negocio: z.string(),
  ofertas: z.array(z.object({ nome: z.string(), promessa: z.string() })),
  publicoDores: z.array(z.string()), publicoDesejos: z.array(z.string()), publicoObjecoes: z.array(z.string()),
  provas: z.array(z.string()),
  personalidade: z.string(), vocabularioUsar: z.array(z.string()), nuncaDizer: z.array(z.string()),
})

interface GenUsage { inputTokens?: number; outputTokens?: number }
export interface IngerirMarcaCtx { operatorId?: string; actingAgentId?: string }
export interface IngerirMarcaDeps {
  getCompanyName?: () => Promise<string | null>
  ensureDefaultBrand?: typeof ensureBrandImpl
  getBrandVoice?: typeof getVoiceImpl
  upsertBrandVoice?: typeof upsertVoiceImpl
  lerNotasEmpresa?: (operatorId: string) => Promise<string>
  generate?: (args: { prompt: string }) => Promise<{ object: unknown; usage: GenUsage; model?: string }>
  recordCost?: typeof recordCostImpl
  now?: () => string
}
export interface IngerirMarcaResult { output: string; patch: EstudioPatch | null }





const TETO_NOTAS = 300
async function defaultLerNotas(_operatorId: string): Promise<string> {
  const { data, error } = await serverDb()
    .from('notes')
    .select('path, title, tags, note_chunks(content, chunk_index)')
    .limit(TETO_NOTAS)
  if (error) { console.warn('[ingerirMarca] lerNotas:', error.message); return '' }
  type Row = { path?: string; title?: string; tags?: string[]; note_chunks?: { content: string; chunk_index: number }[] }
  const notas = (data as Row[] ?? []).map((n) => ({
    path: n.path ?? n.title ?? '',
    titulo: n.title ?? n.path ?? '',
    corpo: (n.note_chunks ?? []).sort((a, b) => a.chunk_index - b.chunk_index).map((c) => c.content).join('\n'),
    tags: n.tags ?? [],
  }))
  return renderNotasDaMarca(escolherNotasDaMarca(notas, TOPICS.map((t) => topicTag(t.id))))
}

async function defaultGenerate({ prompt }: { prompt: string }): Promise<{ object: unknown; usage: GenUsage; model: string }> {
  const apiKey = await getSecret(SECRET_KEYS.openai_api_key)
  if (!apiKey) throw new NotConfiguredError(['openai_api_key'])
  const { object, usage, model } = await generateBackgroundObject({ schema: DnaSchema, prompt, maxOutputTokens: EXTRACTION_MAX_OUTPUT })
  return { object, usage, model }
}

function toPatch(o: z.infer<typeof DnaSchema>): BrandVoicePatch {
  return {
    dna: {
      negocio: o.negocio || undefined,
      ofertas: o.ofertas.filter((x) => x.nome).map((x) => ({ nome: x.nome, ...(x.promessa ? { promessa: x.promessa } : {}) })),
      publico: { dores: o.publicoDores, desejos: o.publicoDesejos, objecoes: o.publicoObjecoes },
      provas: o.provas,
    },
    voz_mae: { personalidade: o.personalidade || undefined, vocabularioUsar: o.vocabularioUsar, nuncaDizer: o.nuncaDizer },
  }
}

export async function ingerirMarca(_input: Record<string, never>, ctx: IngerirMarcaCtx, deps: IngerirMarcaDeps = {}): Promise<IngerirMarcaResult> {
  if (!ctx.operatorId) return { output: 'Sem operador no contexto.', patch: null }
  const getCompanyName = deps.getCompanyName ?? (() => getSetting('company_name'))
  const ensureBrand = deps.ensureDefaultBrand ?? ensureBrandImpl
  const getVoice = deps.getBrandVoice ?? getVoiceImpl
  const upsert = deps.upsertBrandVoice ?? upsertVoiceImpl
  const lerNotas = deps.lerNotasEmpresa ?? defaultLerNotas
  const generate = deps.generate ?? defaultGenerate
  const recordCost = deps.recordCost ?? recordCostImpl
  const now = deps.now ?? (() => new Date().toISOString())
  const agentId = ctx.actingAgentId ?? 'copywriter'

  const nome = (await getCompanyName())?.trim() || 'Minha marca'
  const brand = await ensureBrand(ctx.operatorId, nome)

  const notas = await lerNotas(ctx.operatorId)
  if (!notas) {
    return { output: `Ainda não achei muito sobre a ${nome} no Cérebro. Vamos construir juntos — me conta em uma frase o que a marca faz e pra quem?`, patch: null }
  }

  const prompt = `Você é copywriter conhecendo uma marca nova. Com base nas notas da empresa abaixo, extraia o DNA da marca (não invente — use '' / [] quando não houver).\n\nNOTAS DA EMPRESA:\n${notas}\n\nDevolva: negocio, ofertas[{nome,promessa}], publicoDores/Desejos/Objecoes[], provas[], personalidade (como a marca soa), vocabularioUsar[], nuncaDizer[].`
  const { object, usage, model } = await generate({ prompt })
  try { await recordCost({ kind: 'chat', model: model ?? MODEL, promptTokens: usage.inputTokens ?? 0, completionTokens: usage.outputTokens ?? 0, agent: agentId, tool: 'ingerirMarca' }) } catch {  }

  const patch = toPatch(DnaSchema.parse(object))
  const atual = await getVoice(ctx.operatorId, brand.id)
  const next = mergeBrandVoice(atual, patch, { origem: 'entrevista', at: now() })
  await upsert(ctx.operatorId, brand.id, next)

  const dnaPatch: EstudioPatch = { op: 'upsert', entidade: 'dna', voice: next }
  const output = `Dei uma boa olhada na marca ${nome}. Entendi que ${next.dna.negocio ?? 'a marca'} — atualizei a Ficha com o que captei. Confere pra mim se peguei o essencial?`
  return { output, patch: dnaPatch }
}
