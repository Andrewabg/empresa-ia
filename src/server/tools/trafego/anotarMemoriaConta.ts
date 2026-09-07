
import { runAction as runActionDefault } from '../../actions/actions'
import { discoverAccountId as discoverAccountIdDefault } from './buscarMetricas'
import { getAccountMemory as getMemDefault, upsertAccountMemory as upsertMemDefault } from '@/data/accountMemory'
import { mergeAccountMemory } from '@/lib/trafego/accountMemory'

export interface AnotarMemoriaContaCtx { operatorId?: string; actingAgentId?: string }
export interface AnotarMemoriaContaDeps {
  runAction?: typeof runActionDefault
  getAccountId?: (ctx: { operatorId?: string; actingAgentId?: string }, run: typeof runActionDefault) => Promise<string | null>
  getAccountMemory?: typeof getMemDefault
  upsertAccountMemory?: typeof upsertMemDefault
  now?: () => string
}

export async function anotarMemoriaConta(
  input: { texto: string }, ctx: AnotarMemoriaContaCtx, deps: AnotarMemoriaContaDeps = {},
): Promise<{ ok: boolean; message: string }> {
  const texto = input.texto?.trim()
  if (!texto) return { ok: false, message: 'Nada pra anotar.' }
  if (!ctx.operatorId) return { ok: false, message: 'Sem operador no contexto.' }
  const run = deps.runAction ?? runActionDefault
  const getAccountId = deps.getAccountId ?? discoverAccountIdDefault
  const getMem = deps.getAccountMemory ?? getMemDefault
  const upsertMem = deps.upsertAccountMemory ?? upsertMemDefault
  const now = deps.now ?? (() => new Date().toISOString())

  const accountId = await getAccountId({ operatorId: ctx.operatorId, actingAgentId: ctx.actingAgentId }, run)
  if (!accountId) return { ok: false, message: 'Não encontrei a conta de anúncios conectada.' }
  const mem = await getMem(ctx.operatorId, accountId)
  const next = mergeAccountMemory(mem, { aprendizados: [texto] }, { origem: 'rui', at: now() })
  await upsertMem(ctx.operatorId, accountId, next)
  return { ok: true, message: `Anotei na ficha da conta: "${texto}".` }
}
