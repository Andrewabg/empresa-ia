
import { ZodError } from 'zod'
import { recordCost as recordCostImpl } from '@/data/cost'
import { listContratos as listContratosImpl } from '@/data/contratos'
import { getFichaJuridica as getFichaImpl, upsertFichaJuridica as upsertFichaImpl } from '@/data/fichaJuridica'
import { mergeFichaJuridica, renderFichaJuridica } from '@/lib/juridico/ficha'
import { resumoParecer } from '@/lib/juridico/parecer'
import { toContratoView, type ContratoView } from '@/lib/juridico/types'
import { FichaPatchSchema, toFichaPatch } from '@/server/tools/juridico/fichaSchema'
import { generateBackgroundObject, type BgGenResult } from '../cost/backgroundLLM'
import { BACKGROUND_MAX_OUTPUT } from '@/lib/llm-tuning'


function montarGrounding(contratos: ContratoView[]): string {
  if (!contratos.length) return '(sem contratos ainda)'
  return contratos.map((c) => {
    const parecer = resumoParecer(c.parecer) || '—'
    return `- "${c.titulo}" (${c.tipo}, ${c.kind}, ${c.status}; pendências: ${c.pendencias.length}; parecer: ${parecer})`
  }).join('\n')
}

function buildPrompt(memoriaAtual: string, grounding: string): string {
  return `Você mantém a FICHA JURÍDICA da empresa. Com base na ficha atual e nos contratos recentes,
ATUALIZE só o conhecimento DURÁVEL (posturas recorrentes, padrões de cláusula, foro preferido,
aprendizados). NÃO repita o que já está na ficha; use '' / [] quando não houver nada novo — NÃO
invente; um único contrato NÃO é padrão durável.

FICHA ATUAL:
${memoriaAtual || '(vazia — primeira reflexão)'}

CONTRATOS RECENTES:
${grounding}

Devolva JSON com: razaoSocial, cnpj, endereco, representante, foro, observacoes (strings '' quando
nada), posturas (array []), aprendizados (array [] — frases curtas de padrão durável).`
}

async function defaultGenerate({ prompt }: { prompt: string }): Promise<BgGenResult> {
  return generateBackgroundObject({ schema: FichaPatchSchema, prompt, maxOutputTokens: BACKGROUND_MAX_OUTPUT })
}

export interface ReflectJuridicoDeps {
  listContratos?: typeof listContratosImpl
  getFicha?: typeof getFichaImpl
  upsertFicha?: typeof upsertFichaImpl
  generate?: (args: { prompt: string }) => Promise<BgGenResult>
  recordCost?: typeof recordCostImpl
  now?: () => string
}

export interface ReflectJuridicoResult { reflected: boolean; error?: boolean; permanent?: boolean }

export async function reflectJuridico(ref: string, deps: ReflectJuridicoDeps = {}): Promise<ReflectJuridicoResult> {
  try {
    const operatorId = ref.trim()
    if (!operatorId) return { reflected: false }

    const listContratos = deps.listContratos ?? listContratosImpl
    const getFicha = deps.getFicha ?? getFichaImpl
    const upsertFicha = deps.upsertFicha ?? upsertFichaImpl
    const generate = deps.generate ?? defaultGenerate
    const recordCost = deps.recordCost ?? recordCostImpl
    const now = deps.now ?? (() => new Date().toISOString())

    const contratos = (await listContratos(operatorId, 'juridico')).map(toContratoView).slice(0, 10)
    const grounding = montarGrounding(contratos)

    const raw = await generate({ prompt: buildPrompt(renderFichaJuridica(await getFicha(operatorId)), grounding) })
    try {
      await recordCost({ kind: 'chat', model: raw.model, promptTokens: raw.usage.inputTokens ?? 0, completionTokens: raw.usage.outputTokens ?? 0, cachedTokens: raw.usage.cachedInputTokens ?? 0, agent: 'juridico', tool: 'reflectJuridico' })
    } catch {  }
    const patch = toFichaPatch(FichaPatchSchema.parse(raw.object))

    const next = mergeFichaJuridica(await getFicha(operatorId), patch, { origem: 'reflector', at: now() })
    await upsertFicha(operatorId, next)
    return { reflected: true }
  } catch (e) {
    console.warn('[reflectJuridico] fail-open:', e)
    return { reflected: false, error: true, permanent: e instanceof ZodError }
  }
}
