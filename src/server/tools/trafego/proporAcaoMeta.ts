
import { runAction as runActionDefault } from '../../actions/actions'
import { composioUserId } from '../../actions/composio'
import { createApproval as createApprovalDefault, listAcoesMetaRecentes as listAcoesMetaRecentesDefault } from '@/data/approvals'
import { listLatestSnapshots as listLatestSnapshotsDefault } from '@/data/trafego'
import { getSetting as getSettingDefault } from '@/data/settings'
import { validarAcaoMeta, type TipoAcaoMeta, type NivelMeta } from '@/lib/trafego/guardrails'
import { type AcaoMetaLedger } from '@/lib/trafego/estabilizacao'
import { JANELA_APRENDIZADO_MS } from '@/lib/trafego/atribuicao'
import { reaisParaCentavos } from '@/lib/trafego/normalize'
import { montarEstadoAntes, type EstadoAntes } from '@/lib/trafego/desfazer'
import {
  lerCampaignsEntity as lerCampaignsEntityDefault,
  lerAdsetsEntity as lerAdsetsEntityDefault,
  discoverAccountId,
  ACCOUNT_SETTING_KEY,
} from './buscarMetricas'

const SLUG_CAMPAIGN = 'METAADS_UPDATE_CAMPAIGN'
const SENTINELA_GRAPH_WRITE = 'AWAVE_META_GRAPH_WRITE'
const STATUS_DE: Record<string, string> = { pausar: 'PAUSED', reativar: 'ACTIVE' }






export type ExecPayload =
  | { kind: 'composio'; slug: string; args: Record<string, unknown>; estadoAntes?: EstadoAntes }
  | { kind: 'graph'; endpoint: string; body: Record<string, unknown>; estadoAntes?: EstadoAntes }


export interface MontarAcaoMetaDados {
  idsConhecidos: Set<string>
  nomePorId: Map<string, string>
  
  campaignEntity?: { dailyBudget?: number; lifetimeBudget?: number; cbo: boolean } | null
  
  adsetEntity?: { dailyBudget?: number; lifetimeBudget?: number; learning?: string } | null
  
  historicoEntidade?: AcaoMetaLedger[]
  
  agora?: number
}

export type MontarAcaoMetaResult =
  | { ok: true; exec: ExecPayload; title: string; aviso?: string }
  | { ok: false; motivo: string }


export function montarAcaoMeta(
  input: ProporEscritaMetaInput,
  dados: MontarAcaoMetaDados,
): MontarAcaoMetaResult {
  const nivel: NivelMeta = input.nivel ?? 'campaign'
  const { idsConhecidos, nomePorId } = dados

  if (!idsConhecidos.has(input.entityId)) {
    return { ok: false, motivo: 'Não reconheço essa entidade na leitura atual — puxe o relatório (gerarRelatorio) antes de propor uma ação.' }
  }

  
  if (nivel === 'campaign') {
    let valorAtual: number | undefined
    let budgetArg: Record<string, string> | undefined
    let unidade: 'daily' | 'lifetime' | undefined

    if (input.tipo === 'orcamento') {
      const campaignEntity = dados.campaignEntity ?? null
      if (!campaignEntity || campaignEntity.cbo === undefined) {
        return { ok: false, motivo: 'Não consegui identificar a conta pra ler o orçamento atual — selecione a conta em /trafego e tente de novo.' }
      }
      if (!campaignEntity.cbo) {
        return { ok: false, motivo: 'O orçamento não está na campanha — esta conta é ABO (orçamento fica no conjunto). Ajuste o orçamento no conjunto; isso chega na próxima versão.' }
      }
      if (campaignEntity.dailyBudget !== undefined) {
        valorAtual = campaignEntity.dailyBudget
        budgetArg = { daily_budget: reaisParaCentavos(input.valorNovo ?? 0) }
        unidade = 'daily'
      } else if (campaignEntity.lifetimeBudget !== undefined) {
        valorAtual = campaignEntity.lifetimeBudget
        budgetArg = { lifetime_budget: reaisParaCentavos(input.valorNovo ?? 0) }
        unidade = 'lifetime'
      }
    }

    const guard = validarAcaoMeta(
      { tipo: input.tipo, nivel: 'campaign', entityId: input.entityId, valorAtual, valorNovo: input.valorNovo, unidade },
      { idsConhecidos, agora: dados.agora ?? 0, historicoEntidade: dados.historicoEntidade ?? [] },
    )
    if (!guard.ok) return { ok: false, motivo: guard.motivo }

    
    
    
    
    
    
    const estadoAntes = (input.tipo === 'orcamento' || input.tipo === 'pausar' || input.tipo === 'reativar')
      ? montarEstadoAntes({
          tipo: input.tipo,
          ...(valorAtual !== undefined ? { valorAtual } : {}),
          ...(unidade ? { unidade: unidade === 'daily' ? 'daily_budget' : 'lifetime_budget' } : {}),
        })
      : null

    let args: Record<string, unknown>
    if (input.tipo === 'orcamento' && budgetArg) {
      args = { campaign_id: input.entityId, ...budgetArg }
    } else {
      args = { campaign_id: input.entityId, status: STATUS_DE[input.tipo] }
    }

    const nomeReal = nomePorId.get(input.entityId) ?? input.nome
    const verboCap =
      input.tipo === 'pausar' ? 'Pausar'
      : input.tipo === 'reativar' ? 'Reativar'
      : input.tipo === 'orcamento' ? 'Ajustar orçamento'
      : `Ajustar ${input.tipo}`
    const titulo = nomeReal
      ? `${verboCap} campanha "${nomeReal}" [${input.entityId}]`
      : `${verboCap} campanha [${input.entityId}]`

    const aviso = guard.ok && guard.aviso ? guard.aviso : undefined
    return { ok: true, exec: { kind: 'composio', slug: SLUG_CAMPAIGN, args, ...(estadoAntes ? { estadoAntes } : {}) }, title: titulo, aviso }
  }

  
  if (nivel === 'adset' || nivel === 'ad') {
    if (nivel === 'ad' && input.tipo === 'orcamento') {
      return { ok: false, motivo: 'Anúncios não têm orçamento próprio — ajuste o orçamento no conjunto (adset) ou na campanha.' }
    }

    let valorAtual: number | undefined
    let learningStage: string | undefined
    let budgetBody: Record<string, string> | undefined
    let unidade: 'daily' | 'lifetime' | undefined
    let adsetEncontradoSemBudget = false

    if (nivel === 'adset' && input.tipo === 'orcamento') {
      const adsetEntity = dados.adsetEntity ?? null
      if (adsetEntity) {
        valorAtual = adsetEntity.dailyBudget ?? adsetEntity.lifetimeBudget
        learningStage = adsetEntity.learning
        if (adsetEntity.dailyBudget !== undefined) {
          budgetBody = { daily_budget: reaisParaCentavos(input.valorNovo ?? 0) }
          unidade = 'daily'
        } else if (adsetEntity.lifetimeBudget !== undefined) {
          budgetBody = { lifetime_budget: reaisParaCentavos(input.valorNovo ?? 0) }
          unidade = 'lifetime'
        } else {
          adsetEncontradoSemBudget = true
        }
      }
    }

    if (adsetEncontradoSemBudget) {
      return { ok: false, motivo: 'Este conjunto não tem orçamento próprio — a conta usa orçamento de campanha (CBO). Ajuste o orçamento na CAMPANHA, não no conjunto.' }
    }

    const guard = validarAcaoMeta(
      { tipo: input.tipo, nivel, entityId: input.entityId, valorAtual, valorNovo: input.valorNovo, unidade },
      { idsConhecidos, agora: dados.agora ?? 0, orcamentoNoNivel: nivel === 'adset' ? 'adset' : undefined, learningStage, historicoEntidade: dados.historicoEntidade ?? [] },
    )
    if (!guard.ok) return { ok: false, motivo: guard.motivo }

    
    
    
    const estadoAntes = (input.tipo === 'orcamento' || input.tipo === 'pausar' || input.tipo === 'reativar')
      ? montarEstadoAntes({
          tipo: input.tipo,
          ...(valorAtual !== undefined ? { valorAtual } : {}),
          ...(unidade ? { unidade: unidade === 'daily' ? 'daily_budget' : 'lifetime_budget' } : {}),
        })
      : null

    let graphBody: Record<string, unknown>
    if (input.tipo === 'orcamento' && budgetBody) {
      graphBody = budgetBody
    } else {
      graphBody = { status: STATUS_DE[input.tipo] }
    }

    const nivelLabel = nivel === 'adset' ? 'conjunto' : 'anúncio'
    const nomeReal = nomePorId.get(input.entityId) ?? input.nome
    const verboCap =
      input.tipo === 'pausar' ? 'Pausar'
      : input.tipo === 'reativar' ? 'Reativar'
      : input.tipo === 'orcamento' ? 'Ajustar orçamento do'
      : `Ajustar ${input.tipo} do`
    const titulo = nomeReal
      ? `${verboCap} ${nivelLabel} "${nomeReal}" [${input.entityId}]`
      : `${verboCap} ${nivelLabel} [${input.entityId}]`

    const aviso = guard.ok && guard.aviso ? guard.aviso : undefined
    return { ok: true, exec: { kind: 'graph', endpoint: '/' + input.entityId, body: graphBody, ...(estadoAntes ? { estadoAntes } : {}) }, title: titulo, aviso }
  }

  return { ok: false, motivo: `Nível "${nivel}" não suportado — use campaign, adset ou ad.` }
}



export interface ProporEscritaMetaInput {
  tipo: TipoAcaoMeta
  entityId: string
  
  nivel?: NivelMeta
  
  valorNovo?: number
  nome?: string
  motivo?: string
}
export interface ProporEscritaMetaCtx { operatorId?: string; actingAgentId?: string }
export interface ProporEscritaMetaDeps {
  runAction?: typeof runActionDefault
  createApproval?: typeof createApprovalDefault
  listLatestSnapshots?: typeof listLatestSnapshotsDefault
  getSetting?: typeof getSettingDefault
  listAcoesMetaRecentes?: typeof listAcoesMetaRecentesDefault
  lerCampaignsEntity?: typeof lerCampaignsEntityDefault
  lerAdsetsEntity?: typeof lerAdsetsEntityDefault
  agora?: () => number
}


async function resolverContaParaAcao(
  agent: string,
  run: typeof runActionDefault,
  getSetting: typeof getSettingDefault,
): Promise<string | null> {
  const preferred = await getSetting(ACCOUNT_SETTING_KEY).catch(() => null)
  if (preferred) return preferred
  return discoverAccountId({ actingAgentId: agent }, run)
}



export async function proporEscritaMeta(
  input: ProporEscritaMetaInput,
  ctx: ProporEscritaMetaCtx,
  deps: ProporEscritaMetaDeps = {},
): Promise<{ output: string }> {
  if (!ctx.operatorId) return { output: 'Não consegui identificar o operador — recarregue a página e tente de novo.' }
  const nivel: NivelMeta = input.nivel ?? 'campaign'
  const run = deps.runAction ?? runActionDefault
  const doCreateApproval = deps.createApproval ?? createApprovalDefault
  const listLatest = deps.listLatestSnapshots ?? listLatestSnapshotsDefault
  const getSetting = deps.getSetting ?? getSettingDefault
  const lerCampaigns = deps.lerCampaignsEntity ?? lerCampaignsEntityDefault
  const lerAdsets = deps.lerAdsetsEntity ?? lerAdsetsEntityDefault
  const agora = (deps.agora ?? (() => Date.now()))()
  const agent = ctx.actingAgentId ?? 'gestor-trafego'

  
  const idsConhecidos = new Set<string>()
  const nomePorId = new Map<string, string>()
  
  const convPorId = new Map<string, number>()
  try {
    const snaps = await listLatest(ctx.operatorId, nivel, 200)
    for (const s of snaps) {
      idsConhecidos.add(s.entity_id)
      if (s.entity_name) nomePorId.set(s.entity_id, s.entity_name)
      const conv = Number((s.metrics as Record<string, unknown>)?.conversions)
      if (Number.isFinite(conv)) convPorId.set(s.entity_id, conv)
    }
  } catch (e) { console.warn('[proporEscritaMeta] listLatestSnapshots falhou (não-fatal):', e) }

  
  if (!idsConhecidos.has(input.entityId)) {
    return { output: 'Não reconheço essa entidade na leitura atual — puxe o relatório (gerarRelatorio) antes de propor uma ação.' }
  }

  
  const listAcoes = deps.listAcoesMetaRecentes ?? listAcoesMetaRecentesDefault
  const desdeAcoes = new Date(agora - JANELA_APRENDIZADO_MS).toISOString()
  const historicoEntidade = (await listAcoes(desdeAcoes).catch(() => [] as AcaoMetaLedger[]))
    .filter((a) => a.entityId === input.entityId)

  

  const convJanela = convPorId.get(input.entityId)

  if (nivel === 'campaign') {
    return proporEscritaCampanha(input, ctx, agent, agora, nomePorId, run, getSetting, lerCampaigns, idsConhecidos, historicoEntidade, convJanela)
  }
  if (nivel === 'adset' || nivel === 'ad') {
    return proporEscritaAdsetOuAd(input, nivel, ctx, agent, agora, nomePorId, getSetting, lerAdsets, run, doCreateApproval, idsConhecidos, historicoEntidade, convJanela)
  }
  return { output: `Nível "${nivel}" não suportado — use campaign, adset ou ad.` }
}



async function proporEscritaCampanha(
  input: ProporEscritaMetaInput,
  _ctx: ProporEscritaMetaCtx,
  agent: string,
  agora: number,
  nomePorId: Map<string, string>,
  run: typeof runActionDefault,
  getSetting: typeof getSettingDefault,
  lerCampaigns: typeof lerCampaignsEntityDefault,
  idsConhecidos: Set<string>,
  historicoEntidade: AcaoMetaLedger[],
  convJanela: number | undefined,
): Promise<{ output: string }> {
  
  let valorAtual: number | undefined
  let budgetArg: Record<string, string> | undefined
  let unidade: 'daily' | 'lifetime' | undefined
  if (input.tipo === 'orcamento') {
    const accountId = await resolverContaParaAcao(agent, run, getSetting)
    if (!accountId) {
      return { output: 'Não encontrei uma conta de anúncios conectada. Conecte o Meta Ads em /config (toolkit Meta Ads) e reconecte se a sessão tiver expirado.' }
    }
    let campaignEntity: { dailyBudget?: number; lifetimeBudget?: number; cbo: boolean } = { cbo: false }
    try {
      const campaigns = await lerCampaigns(accountId)
      campaignEntity = campaigns[input.entityId] ?? { cbo: false }
    } catch (e) {
      console.warn('[proporEscritaMeta] lerCampaignsEntity falhou (não-fatal):', e)
    }
    if (!campaignEntity.cbo) {
      return { output: 'O orçamento não está na campanha — esta conta é ABO (orçamento fica no conjunto). Ajuste o orçamento no conjunto; isso chega na próxima versão.' }
    }
    
    if (campaignEntity.dailyBudget !== undefined) {
      valorAtual = campaignEntity.dailyBudget
      budgetArg = { daily_budget: reaisParaCentavos(input.valorNovo ?? 0) }
      unidade = 'daily'
    } else if (campaignEntity.lifetimeBudget !== undefined) {
      valorAtual = campaignEntity.lifetimeBudget
      budgetArg = { lifetime_budget: reaisParaCentavos(input.valorNovo ?? 0) }
      unidade = 'lifetime'
    }
  }

  
  const guard = validarAcaoMeta(
    { tipo: input.tipo, nivel: 'campaign', entityId: input.entityId, valorAtual, valorNovo: input.valorNovo, unidade },
    { idsConhecidos, agora, historicoEntidade, convJanela },
  )
  if (!guard.ok) return { output: guard.motivo }

  
  
  
  
  
  
  
  
  
  

  
  let args: Record<string, unknown>
  if (input.tipo === 'orcamento' && budgetArg) {
    args = { campaign_id: input.entityId, ...budgetArg }
  } else {
    args = { campaign_id: input.entityId, status: STATUS_DE[input.tipo] }
  }

  
  const nomeReal = nomePorId.get(input.entityId) ?? input.nome
  const verboCap =
    input.tipo === 'pausar' ? 'Pausar'
    : input.tipo === 'reativar' ? 'Reativar'
    : input.tipo === 'orcamento' ? 'Ajustar orçamento'
    : `Ajustar ${input.tipo}`
  const titulo = nomeReal
    ? `${verboCap} campanha "${nomeReal}" [${input.entityId}]`
    : `${verboCap} campanha [${input.entityId}]`

  const res = await run({ slug: SLUG_CAMPAIGN, args, userId: composioUserId(), agent, title: titulo })
  if (!res.successful) {
    const msg = typeof res.data?.message === 'string' ? res.data.message : 'erro ao registrar a proposta'
    return { output: `Não consegui criar a proposta: ${msg}.` }
  }

  const nome = nomeReal ? ` "${nomeReal}"` : ''
  const verbo =
    input.tipo === 'pausar' ? 'pausar'
    : input.tipo === 'reativar' ? 'reativar'
    : input.tipo === 'orcamento' ? 'ajustar o orçamento de'
    : input.tipo
  const motivo = input.motivo ? ` — motivo: ${input.motivo}` : ''
  const aviso = guard.ok && guard.aviso ? ` ⚠ ${guard.aviso}` : ''
  return { output: `Proposta criada: ${verbo} a campanha${nome} [${input.entityId}]${motivo}. Aprove em /aprovações pra executar — eu não faço nada sem seu OK.${aviso}` }
}



async function proporEscritaAdsetOuAd(
  input: ProporEscritaMetaInput,
  nivel: 'adset' | 'ad',
  _ctx: ProporEscritaMetaCtx,
  agent: string,
  agora: number,
  nomePorId: Map<string, string>,
  getSetting: typeof getSettingDefault,
  lerAdsets: typeof lerAdsetsEntityDefault,
  run: typeof runActionDefault,
  doCreateApproval: typeof createApprovalDefault,
  idsConhecidos: Set<string>,
  historicoEntidade: AcaoMetaLedger[],
  convJanela: number | undefined,
): Promise<{ output: string }> {
  
  if (nivel === 'ad' && input.tipo === 'orcamento') {
    return { output: 'Anúncios não têm orçamento próprio — ajuste o orçamento no conjunto (adset) ou na campanha.' }
  }

  
  let valorAtual: number | undefined
  let learningStage: string | undefined
  let budgetBody: Record<string, string> | undefined
  let unidade: 'daily' | 'lifetime' | undefined
  let adsetEncontradoSemBudget = false

  if (nivel === 'adset' && input.tipo === 'orcamento') {
    const accountId = await resolverContaParaAcao(agent, run, getSetting)
    if (!accountId) {
      return { output: 'Não encontrei uma conta de anúncios conectada. Conecte o Meta Ads em /config (toolkit Meta Ads) e reconecte se a sessão tiver expirado.' }
    }
    try {
      const adsets = await lerAdsets(accountId, run, agent)
      const adsetEntity = adsets[input.entityId]
      if (adsetEntity) {
        valorAtual = adsetEntity.dailyBudget ?? adsetEntity.lifetimeBudget
        learningStage = adsetEntity.learning
        
        if (adsetEntity.dailyBudget !== undefined) {
          budgetBody = { daily_budget: reaisParaCentavos(input.valorNovo ?? 0) }
          unidade = 'daily'
        } else if (adsetEntity.lifetimeBudget !== undefined) {
          budgetBody = { lifetime_budget: reaisParaCentavos(input.valorNovo ?? 0) }
          unidade = 'lifetime'
        } else {
          
          
          adsetEncontradoSemBudget = true
        }
      }
    } catch (e) {
      console.warn('[proporEscritaMeta] lerAdsetsEntity falhou (não-fatal):', e)
    }
  }

  
  
  
  if (adsetEncontradoSemBudget) {
    return { output: 'Este conjunto não tem orçamento próprio — a conta usa orçamento de campanha (CBO). Ajuste o orçamento na CAMPANHA, não no conjunto.' }
  }

  
  const guard = validarAcaoMeta(
    { tipo: input.tipo, nivel, entityId: input.entityId, valorAtual, valorNovo: input.valorNovo, unidade },
    { idsConhecidos, agora, orcamentoNoNivel: nivel === 'adset' ? 'adset' : undefined, learningStage, historicoEntidade, convJanela },
  )
  if (!guard.ok) return { output: guard.motivo }

  
  let graphBody: Record<string, unknown>
  if (input.tipo === 'orcamento' && budgetBody) {
    graphBody = budgetBody
  } else {
    graphBody = { status: STATUS_DE[input.tipo] }
  }

  
  const nivelLabel = nivel === 'adset' ? 'conjunto' : 'anúncio'
  const nomeReal = nomePorId.get(input.entityId) ?? input.nome
  const verboCap =
    input.tipo === 'pausar' ? 'Pausar'
    : input.tipo === 'reativar' ? 'Reativar'
    : input.tipo === 'orcamento' ? 'Ajustar orçamento do'
    : `Ajustar ${input.tipo} do`
  const titulo = nomeReal
    ? `${verboCap} ${nivelLabel} "${nomeReal}" [${input.entityId}]`
    : `${verboCap} ${nivelLabel} [${input.entityId}]`

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const estadoAntes = (input.tipo === 'orcamento' || input.tipo === 'pausar' || input.tipo === 'reativar')
    ? montarEstadoAntes({
        tipo: input.tipo,
        ...(valorAtual !== undefined ? { valorAtual } : {}),
        ...(unidade ? { unidade: unidade === 'daily' ? 'daily_budget' : 'lifetime_budget' } : {}),
      })
    : null

  
  
  let approvalId: string
  try {
    const approval = await doCreateApproval({
      kind: 'tool_action',
      title: titulo,
      agent,
      action_slug: SENTINELA_GRAPH_WRITE,
      action_args: {
        endpoint: '/' + input.entityId,
        method: 'POST',
        body: graphBody,
        ...(estadoAntes ? { estadoAntes } : {}),
      },
    })
    approvalId = approval.id
  } catch (err) {
    return { output: 'Não consegui registrar a proposta de ação. Tente de novo.' }
  }

  const nomeOut = nomeReal ? ` "${nomeReal}"` : ''
  const verbo =
    input.tipo === 'pausar' ? `pausar o ${nivelLabel}`
    : input.tipo === 'reativar' ? `reativar o ${nivelLabel}`
    : `ajustar o orçamento do ${nivelLabel}`
  const motivo = input.motivo ? ` — motivo: ${input.motivo}` : ''
  const aviso = guard.ok && guard.aviso ? ` ⚠ Atenção: ${guard.aviso}` : ''
  void approvalId 
  return { output: `Proposta criada: ${verbo}${nomeOut} [${input.entityId}]${motivo}. Aprove em /aprovações pra executar — eu não faço nada sem seu OK.${aviso}` }
}




export interface ProporAcaoMetaInput {
  tipo: TipoAcaoMeta
  campaignId: string
  
  valor?: number
  nome?: string
  motivo?: string
}
export type ProporAcaoMetaCtx = ProporEscritaMetaCtx
export type ProporAcaoMetaDeps = ProporEscritaMetaDeps

export async function proporAcaoMeta(
  input: ProporAcaoMetaInput,
  ctx: ProporAcaoMetaCtx,
  deps: ProporAcaoMetaDeps = {},
): Promise<{ output: string }> {
  return proporEscritaMeta(
    { tipo: input.tipo, nivel: 'campaign', entityId: input.campaignId, valorNovo: input.valor, nome: input.nome, motivo: input.motivo },
    ctx,
    deps,
  )
}
