



import { z, ZodError } from 'zod'
import { generateObject } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { getSecret, SECRET_KEYS } from '../secrets'
import { NotConfiguredError } from '../brain/runtime'
import { recordCost as recordCostImpl } from '@/data/cost'
import { lerPerformanceCopy as lerPerfImpl, type PerformanceCopy } from '../tools/trafego/lerPerformanceCopy'
import { getAccountMemory as getAccMemImpl } from '@/data/accountMemory'
import { renderAccountMemory } from '@/lib/trafego/accountMemory'
import { getDefaultBrand as getBrandImpl } from '@/data/brands'
import { getBrandVoice as getVoiceImpl, upsertBrandVoice as upsertVoiceImpl } from '@/data/brandVoice'
import { mergeBrandVoice, renderBrandVoice, type BrandVoicePatch } from '@/lib/estudio/brandVoice'
import { espelharVozNoCerebro as espelharImpl } from '../tools/estudio/espelhoCerebro'

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.1'

export const BrandPerfPatchSchema = z.object({
  aprendizados: z.array(z.string()), 
})

interface GenResult { object: unknown; usage: { inputTokens?: number; outputTokens?: number } }

function montarGrounding(perf: PerformanceCopy, memRui: string): string {
  const L: string[] = []
  if (perf.vencedores.length) {
    L.push('ANÚNCIOS QUE MAIS CONVERTEM (ROAS ↑):')
    for (const a of perf.vencedores) L.push(`• ${a.nome ?? a.id} — ROAS ${a.roas?.toFixed(2) ?? '?'}, CTR ${a.ctr?.toFixed(4) ?? '?'}${a.copy ? ` — copy: "${a.copy}"` : ''}`)
  }
  if (perf.cansando.length) {
    L.push('ANÚNCIOS QUE MENOS CONVERTEM (ROAS ↓):')
    for (const a of perf.cansando) L.push(`• ${a.nome ?? a.id} — ROAS ${a.roas?.toFixed(2) ?? '?'}${a.copy ? ` — copy: "${a.copy}"` : ''}`)
  }
  if (memRui) L.push(`O QUE O GESTOR DE TRÁFEGO JÁ SABE DA CONTA:\n${memRui}`)
  return L.join('\n')
}

function buildPrompt(grounding: string, aprendAtuais: string): string {
  return `Você é o copywriter estrategista. Olhando a PERFORMANCE REAL dos anúncios da conta, destile o que os
anúncios que MAIS convertem fazem bem NA COPY — os elementos vencedores (gancho/abertura, ângulo, ordem dos
argumentos, provas/autoridade, oferta, CTA, tom) — como aprendizado DURÁVEL pro DNA da marca. Isso vale MESMO
que os campeões usem uma copy parecida entre si: se eles compartilham uma FÓRMULA clara, CAPTURE-A (não exija
contraste com os piores). Se os que menos convertem revelarem algo a EVITAR, anote também. NÃO repita o que já
está nos aprendizados atuais; NÃO invente (não force padrão onde não há sinal). Frases curtas e acionáveis, ex.:
"CONVERTE: abre com contraste/indignação ('tá rolando um absurdo')"; "CONVERTE: lidera com autoridade (anos de
experiência + marcas conhecidas)"; "CANSOU: promessa de escassez". Use [] só se realmente não houver nada útil.

APRENDIZADOS ATUAIS DA MARCA:
${aprendAtuais || '(nenhum ainda)'}

PERFORMANCE REAL:
${grounding || '(sem dados suficientes)'}

Devolva JSON: aprendizados (array [] de frases curtas de padrão durável de copy).`
}

async function defaultGenerate({ prompt }: { prompt: string }): Promise<GenResult> {
  const apiKey = await getSecret(SECRET_KEYS.openai_api_key)
  if (!apiKey) throw new NotConfiguredError(['openai_api_key'])
  const openai = createOpenAI({ apiKey })
  const { object, usage } = await generateObject({ model: openai(MODEL), schema: BrandPerfPatchSchema, prompt })
  return { object, usage }
}

export interface ReflectBrandDeps {
  lerPerformanceCopy?: typeof lerPerfImpl
  getAccountMemory?: typeof getAccMemImpl
  getDefaultBrand?: typeof getBrandImpl
  getBrandVoice?: typeof getVoiceImpl
  upsertBrandVoice?: typeof upsertVoiceImpl
  espelhar?: typeof espelharImpl
  generate?: (args: { prompt: string }) => Promise<GenResult>
  recordCost?: typeof recordCostImpl
  now?: () => string
}

export async function reflectBrand(ref: string, deps: ReflectBrandDeps = {}): Promise<{ reflected: boolean; error?: boolean; permanent?: boolean }> {
  try {
    const sep = ref.indexOf(':')
    if (sep < 0) return { reflected: false }
    const operatorId = ref.slice(0, sep), accountId = ref.slice(sep + 1)
    if (!operatorId || !accountId) return { reflected: false }

    const lerPerf = deps.lerPerformanceCopy ?? lerPerfImpl
    const getAccMem = deps.getAccountMemory ?? getAccMemImpl
    const getBrand = deps.getDefaultBrand ?? getBrandImpl
    const getVoice = deps.getBrandVoice ?? getVoiceImpl
    const upsert = deps.upsertBrandVoice ?? upsertVoiceImpl
    const espelhar = deps.espelhar ?? espelharImpl
    const generate = deps.generate ?? defaultGenerate
    const recordCost = deps.recordCost ?? recordCostImpl
    const now = deps.now ?? (() => new Date().toISOString())

    const brand = await getBrand(operatorId)
    if (!brand) return { reflected: false }

    const perf = await lerPerf({ operatorId, accountId, actingAgentId: 'copywriter' })
    if (perf.vencedores.length === 0) return { reflected: false } 

    const memRui = renderAccountMemory(await getAccMem(operatorId, accountId))
    const voice = await getVoice(operatorId, brand.id)
    const raw = await generate({ prompt: buildPrompt(montarGrounding(perf, memRui), renderBrandVoice(voice)) })
    try { await recordCost({ kind: 'chat', model: MODEL, promptTokens: raw.usage.inputTokens ?? 0, completionTokens: raw.usage.outputTokens ?? 0, agent: 'copywriter', tool: 'reflectBrand' }) } catch {  }

    const parsed = BrandPerfPatchSchema.parse(raw.object)
    const patch: BrandVoicePatch = { aprendizados: parsed.aprendizados.map((t) => ({ texto: t, escopo: 'diretriz', canal: null })) }
    const next = mergeBrandVoice(voice, patch, { origem: 'reflector', at: now() })
    await upsert(operatorId, brand.id, next)
    try { await espelhar({ slug: brand.slug, nomeMarca: brand.nome, voice: next }) } catch {  }
    return { reflected: true }
  } catch (e) {
    console.warn('[reflectBrand] fail-open:', e)
    return { reflected: false, error: true, permanent: e instanceof ZodError }
  }
}
