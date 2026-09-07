

import { runAgentRound, type HeadlessAgentLike } from '@/server/agent/executor/headlessRun'
import { getConversa as getConversaDefault, setConversaStatus, setConversaAgente as setConversaAgenteDefault, setConversaDossie as setConversaDossieDefault, touchConversaOut as touchOutDefault, claimToqueFollowup as claimToqueDefault, type ConversaExternaRow } from '@/data/conversasExternas'
import { getCanal as getCanalDefault, type CanalRow } from '@/data/canais'
import { getAgentRow as getAgentRowDefault, type AgentRow } from '@/data/agents'
import { getContato as getContatoDefault, updateFichaContato } from '@/data/contatos'
import { listMensagensConversa as listMsgDefault, insertMensagemExterna as insertMsgDefault, descartarRascunhosPendentes as descartarRascunhosDefault, contarSaidasEntregues as contarSaidasDefault, type MensagemExternaRow } from '@/data/mensagensExternas'
import { getAtendimentoJob, claimAtendimentoJob, finishAtendimentoJob, concluirSeIntacto, requeueAtendimentoJob, tocarHeartbeatJob, marcaDe } from '@/data/atendimentoJobs'
import { getDirectives as getDirectivesDefault } from '@/data/agentDirectives'
import { getSecret, SECRET_KEYS } from '@/server/secrets'
import { recordCost as recordCostDefault } from '@/data/cost'
import { recordEvent as recordEventDefault } from '@/data/events'
import { cortadoPeloPrazo, idDoFimAnormal, rotuloDoFimAnormal } from '@/lib/conversa/fechamentoDoTurno'
import { EVENTO_SEM_RESPOSTA, KIND_SEM_RESPOSTA, MARCA_SEM_RESPOSTA } from '@/lib/canais/semResposta'
import { notificarAtendimentoSemResposta as notificarSemRespostaDefault } from '@/server/proativo/producers'
import { precisaJanela } from '@/lib/canais/janela'
import { agenteDaConversa } from '@/lib/canais/agenteDaConversa'
import { lerRoteador, rotearPorSinal, deveTransferir, turnosDesdeTransferencia, marcaTransferencia, KIND_TRANSFERENCIA } from '@/lib/canais/roteamento'
import { decidirRetry } from '@/lib/canais/politicaRetry'
import { registrarSeAcionavel, limparAlertaDoModelo } from '@/server/modelo/alerta'
import type { AcaoFalha } from '@/lib/canais/erroMeta'
import { renderFicha } from '@/lib/canais/ficha'
import { enviarTexto, enviarTextoEmBolhas, enviarMidia as enviarMidiaDispatch, enviarInterativo as enviarInterativoDispatch, sinalizarDigitando as sinalizarDigitandoDispatch, type BolhaEnviada } from './dispatch'
import { listCanalMidia, getCanalMidiaBySlug, type CanalMidiaRow } from '@/data/canalMidia'
import { baixarDoBucket } from './media'
import { resolverSlug } from '@/lib/canais/midiaPublica'
import { validarInterativo, interativoParaTexto } from '@/lib/canais/interativo'
import { textoDoRascunho } from '@/lib/canais/rascunhoInterativo'
import { gatilhoEscalacao, AVISO_ESCALACAO, type GatilhoEscalacao, type SinalTurno } from '@/lib/canais/escalacao'
import { runWithTurnContext } from '@/server/agent/turnContext'
import { montarDossie, type DossieHandoff } from '@/lib/canais/dossie'
import { precisaDisclosure, aplicarDisclosure, disclosurePadrao } from '@/lib/canais/disclosure'
import { decidirFollowup, configFollowup, notaFollowup, ACAO_FOLLOWUP } from '@/lib/canais/followup'
import type { CasoEscalado } from './loadout'
import { prepararArquivoCatalogo, enviarPreparado, kindDoArquivo, type PreparoArquivo } from './arquivoCatalogo'
import { deveRenovarTyping } from '@/lib/canais/typing'
import { decidirPreSend } from '@/lib/canais/presend'
import { rotularAutor } from '@/lib/canais/autorHistorico'
import { prefixarCitacao } from '@/lib/canais/citacao'
import { adiarPorMidia } from '@/lib/canais/midiaPendente'
import { getProvider } from './registry'
import { buildCanalAgent, modeloDoCanal } from './agent'
import { searchBase } from '@/data/baseConhecimento'
import { embedTexto } from './embed'
import { recuperarEInjetar } from './recuperar'
import { notificarEscalacao } from '@/server/proativo/producers'
import { inserirCasoEscalacao } from '@/server/treino/casoProducer'
import { blocoRelogio, tzSegura, comContextoNaUltimaMsg, TZ_FALLBACK } from '@/lib/relogio'
import { getSetting as getSettingDefault } from '@/data/settings'
import { carregarPersonaBlock } from '@/server/treino/personaLoad'
import { getComposioClient, composioUserId, type ComposioClient } from '@/server/actions/composio'
import { buildComposioMastraTools } from '@/server/actions/mastraTools'
import { runActionCanal } from '@/server/canais/acaoCanal'
import type { ExecuteToolFn } from '@composio/core'
import type { EnvioResultado, EnvioFalha, MidiaSaida, Interativo } from './types'
import { legendaSemRetentativa } from '@/lib/canais/erroMeta'

const MAX_STEPS = 6
const POLL_MS = 5_000
const LOOP_CAP = 60 










const INATIVIDADE_MS = 60_000
const INATIVIDADE_TOOL_MS = 120_000
const TURNO_MAX_MS = 180_000

const PAUSA_ENTRE_PERGUNTAS_MS = 500

type Msg = { role: 'user' | 'assistant'; content: string }

interface AnexoDoTurno { linha: CanalMidiaRow; legenda: string }


async function disclosureDoCanal(canal: CanalRow): Promise<string> {
  const custom = typeof canal.config?.disclosure === 'string' ? canal.config.disclosure.trim() : ''
  if (custom) return custom
  try {
    return disclosurePadrao((await getSettingDefault('company_name')) ?? '')
  } catch {
    return disclosurePadrao('')
  }
}


async function comDisclosure(texto: string, conversaId: string, canal: CanalRow, d: ProcessarDeps): Promise<string> {
  if (!texto || !d.contarSaidas || !d.resolverDisclosure) return texto
  try {
    const { total, ultimaEm } = await d.contarSaidas(conversaId)
    if (!precisaDisclosure({ saidasNaConversa: total, ultimaSaidaEm: ultimaEm, agora: d.now() })) return texto
    return aplicarDisclosure([texto], await d.resolverDisclosure(canal))[0] ?? texto
  } catch (err) {
    console.warn('[canais/runtime] disclosure fail-open:', err)
    try {
      return aplicarDisclosure([texto], await d.resolverDisclosure(canal))[0] ?? texto
    } catch { return texto }
  }
}


const MOTIVO_GATILHO: Record<NonNullable<GatilhoEscalacao>, string> = {
  pedido_explicito: 'O cliente pediu para falar com uma pessoa.',
  loop_improdutivo: 'A conversa travou — a mesma pergunta se repetiu sem avanço.',
  frustracao: 'O cliente demonstrou irritação.',
}


function textoDoTurno(m: MensagemExternaRow): string {
  return (m.texto || m.midia?.texto_estruturado || m.midia?.transcricao || m.midia?.descricao || '').trim()
}


export function sinaisDoHistorico(msgs: MensagemExternaRow[]): SinalTurno[] {
  return msgs
    .filter((m) => m.status !== 'rascunho' && m.status !== 'descartada')
    .map((m) => ({ autor: m.autor, texto: m.texto || m.midia?.texto_estruturado || m.midia?.transcricao || '' }))
    .filter((s) => s.texto.trim().length > 0)
}


function escalouDepois(conversa: ConversaExternaRow, agoraIso: string): boolean {
  const em = conversa.dossie?.em
  if (!em) return false
  const inbound = conversa.ultima_msg_in_at
  if (!inbound) return true
  const tEsc = Date.parse(em)
  const tIn = Date.parse(inbound)
  if (!Number.isFinite(tEsc) || !Number.isFinite(tIn)) return false
  void agoraIso
  return tEsc >= tIn
}

export interface ProcessarFalha { erro: true; acao: AcaoFalha; retryAfterMs: number | null }

export type ProcessarOutcome = 'done' | 'requeue' | 'erro' | 'perdido' | ProcessarFalha

export interface ProcessarDeps {
  getConversa: typeof getConversaDefault
  getCanal: typeof getCanalDefault
  getAgentRow: typeof getAgentRowDefault
  getContato: typeof getContatoDefault
  listMensagens: typeof listMsgDefault
  getDirectives: typeof getDirectivesDefault
  getApiKey: () => Promise<string | null>
  buildAgent: typeof buildCanalAgent
  runRound: typeof runAgentRound
  
  registrarErroDoModelo?: (erro: unknown) => void
  limparErroDoModelo?: () => Promise<void>
  insertMensagemExterna: typeof insertMsgDefault
  descartarRascunhosPendentes: typeof descartarRascunhosDefault
  touchConversaOut: typeof touchOutDefault
  sendText: (canal: CanalRow, para: string, texto: string) => Promise<EnvioResultado | EnvioFalha>
  
  enviarEmBolhas: (canal: CanalRow, para: string, texto: string) => Promise<BolhaEnviada[]>
  
  sinalizarDigitando?: (canal: CanalRow, refExternalId: string) => Promise<void>
  
  listarMidiaPublica?: (canalId: string) => Promise<CanalMidiaRow[]>
  
  getMidiaPublica?: (canalId: string, slug: string) => Promise<CanalMidiaRow | null>
  
  baixarMidiaPublica?: (bucket: string, path: string) => Promise<{ bytes: Uint8Array; mime: string } | null>
  
  enviarMidia?: (canal: CanalRow, para: string, m: MidiaSaida) => Promise<EnvioResultado | EnvioFalha>
  
  setConversaStatus?: typeof setConversaStatus
  
  setConversaDossie?: typeof setConversaDossieDefault
  
  contarSaidas?: typeof contarSaidasDefault
  
  resolverDisclosure?: (canal: CanalRow) => Promise<string>
  
  claimToque?: typeof claimToqueDefault
  
  setConversaAgente?: typeof setConversaAgenteDefault
  
  enviarInterativo?: (canal: CanalRow, para: string, i: Interativo) => Promise<{ res: EnvioResultado | EnvioFalha; comoTexto: boolean }>
  recordCost: typeof recordCostDefault
  recordEvent: typeof recordEventDefault
  now: () => string
  
  getTz?: () => Promise<string>
  carregarPersonaBlock?: typeof carregarPersonaBlock
  recuperar?: typeof recuperarEInjetar
  
  getComposio?: () => Promise<ComposioClient | null>
}
async function defaultDeps(): Promise<ProcessarDeps> {
  return {
    getConversa: getConversaDefault, getCanal: getCanalDefault, getAgentRow: getAgentRowDefault,
    getContato: getContatoDefault, listMensagens: listMsgDefault, getDirectives: getDirectivesDefault,
    getApiKey: () => getSecret(SECRET_KEYS.openai_api_key),
    buildAgent: buildCanalAgent, runRound: runAgentRound,
    insertMensagemExterna: insertMsgDefault, descartarRascunhosPendentes: descartarRascunhosDefault,
    touchConversaOut: touchOutDefault,
    sendText: (canal, para, texto) => enviarTexto(canal, para, texto),
    enviarEmBolhas: (canal, para, texto) => enviarTextoEmBolhas(canal, para, texto),
    sinalizarDigitando: (canal, ref) => sinalizarDigitandoDispatch(canal, ref),
    
    listarMidiaPublica: (canalId) => listCanalMidia(canalId, true),
    getMidiaPublica: (canalId, slug) => getCanalMidiaBySlug(canalId, slug, true),
    baixarMidiaPublica: baixarDoBucket,
    enviarMidia: (canal, para, m) => enviarMidiaDispatch(canal, para, m),
    enviarInterativo: (canal, para, i) => enviarInterativoDispatch(canal, para, i),
    setConversaStatus,
    setConversaDossie: setConversaDossieDefault,
    contarSaidas: contarSaidasDefault,
    resolverDisclosure: disclosureDoCanal,
    claimToque: claimToqueDefault,
    setConversaAgente: setConversaAgenteDefault,
    recordCost: recordCostDefault, recordEvent: recordEventDefault,
    now: () => new Date().toISOString(),
    getTz: async () => tzSegura(await getSettingDefault('operator_timezone').catch(() => null)),
    carregarPersonaBlock,
    recuperar: recuperarEInjetar,
    getComposio: getComposioClient,
  }
}


const MIDIA_PT: Record<string, string> = {
  image: 'imagem',
  audio: 'áudio',
  video: 'vídeo',
  document: 'documento',
  sticker: 'figurinha',
  location: 'localização',
  contacts: 'um contato',
  interactive: 'uma resposta de botão',
  button: 'uma resposta de botão',
  order: 'um pedido do carrinho',
  reaction: 'uma reação',
}


export function historicoParaMensagens(msgs: MensagemExternaRow[]): Msg[] {
  
  
  const porExternalId = new Map<string, MensagemExternaRow>()
  for (const m of msgs) if (m.external_id) porExternalId.set(m.external_id, m)

  const out: Msg[] = []
  for (const m of msgs) {
    
    
    
    
    const ehMarca = m.midia?.kind === KIND_TRANSFERENCIA
    if (!ehMarca && (m.status === 'rascunho' || m.status === 'descartada' || m.status === 'falhou')) continue
    const midiaLabel = m.midia ? (MIDIA_PT[m.midia.kind] ?? m.midia.kind) : ''
    
    
    const texto =
      m.midia?.transcricao ??
      m.midia?.descricao ??
      m.midia?.texto_estruturado ??
      (m.midia && !m.texto ? `[cliente enviou ${midiaLabel}]` : m.texto)
    if (!texto) continue
    
    
    const alvo = m.midia?.resposta_a ? porExternalId.get(m.midia.resposta_a) : undefined
    const comCitacao = prefixarCitacao(
      texto,
      alvo ? { autor: alvo.autor, texto: alvo.texto || alvo.midia?.texto_estruturado || '' } : null,
    )
    
    
    out.push({ role: m.direcao === 'in' ? 'user' : 'assistant', content: rotularAutor(m.autor, comCitacao) })
  }
  return out
}


export async function processarConversa(
  conversa: ConversaExternaRow,
  deps?: ProcessarDeps,
  onStep?: () => Promise<void>,
  
  ciclo?: { descartesSeguidos: number },
  
  aindaMeu?: () => Promise<boolean>,
): Promise<ProcessarOutcome> {
  const d = deps ?? (await defaultDeps())
  const snapshotInAt = conversa.ultima_msg_in_at

  
  const fresca = await d.getConversa(conversa.id)
  if (!fresca) return 'done'
  if (fresca.status !== 'aberta') return 'done' 

  const canal: CanalRow | null = await d.getCanal(conversa.canal_id)
  if (!canal || !canal.enabled) return 'done'
  
  
  const agenteBase = agenteDaConversa(fresca.agent_id, canal.agent_id)
  const contato = await d.getContato(conversa.contato_id)
  if (!contato) return 'done'

  
  
  
  
  const janela24h = getProvider(canal.provider)?.adapter.capabilities.janela24h ?? true
  if (precisaJanela(janela24h, fresca.ultima_msg_in_at, d.now())) {
    await d.descartarRascunhosPendentes(conversa.id) 
    return 'done'
  }

  
  
  
  const podeArquivo = Boolean(
    d.listarMidiaPublica && d.getMidiaPublica && d.baixarMidiaPublica && d.enviarMidia,
  )
  
  
  
  const [historico, apiKey, catalogo] = await Promise.all([
    d.listMensagens(conversa.id, 30), d.getApiKey(),
    
    podeArquivo ? d.listarMidiaPublica!(canal.id).catch(() => [] as CanalMidiaRow[]) : Promise.resolve([] as CanalMidiaRow[]),
  ])
  if (!apiKey) return 'done' 

  
  
  
  const adiarMs = adiarPorMidia(historico, d.now())
  if (adiarMs > 0) return 'requeue'

  
  
  
  
  
  const ultimaContada = [...historico].reverse().find(
    (m) => m.status !== 'rascunho' && m.status !== 'descartada' && m.status !== 'falhou',
  )

  
  
  
  
  
  const gatilho = escalouDepois(fresca, d.now())
    ? null
    : gatilhoEscalacao(sinaisDoHistorico(historico))

  
  
  
  let agenteId = agenteBase
  let rowRoteado: AgentRow | null = null
  let marcaDoTurno: string | null = null
  const roteador = lerRoteador(canal.config, canal.agent_id)
  
  
  if (roteador && !gatilho && ultimaContada?.direcao === 'in') {
    try {
      const sugerido = rotearPorSinal(textoDoTurno(ultimaContada), roteador)
      const transferir = deveTransferir({
        atual: agenteBase,
        sugerido,
        turnosDesdeTransferencia: turnosDesdeTransferencia(historico),
      })
      if (sugerido && transferir) {
        
        
        
        const destino = await d.getAgentRow(sugerido)
        if (destino?.enabled) {
          const nomeDe = roteador.cargos.find((c) => c.agentId === agenteBase)?.nome ?? agenteBase
          const nomePara = roteador.cargos.find((c) => c.agentId === sugerido)?.nome ?? destino.name
          await (d.setConversaAgente ?? setConversaAgenteDefault)(conversa.id, sugerido)
          agenteId = sugerido
          rowRoteado = destino
          marcaDoTurno = marcaTransferencia(nomeDe, nomePara)
          
          
          
          try {
            await d.insertMensagemExterna({
              conversa_id: conversa.id, direcao: 'out', autor: 'agente',
              texto: marcaDoTurno, status: 'descartada',
              midia: { kind: KIND_TRANSFERENCIA, texto_estruturado: marcaDoTurno, dados: { de: agenteBase, para: sugerido } },
            })
          } catch (e) { console.warn('[canais/runtime] marca de transferência fail-open:', e) }
        }
      }
    } catch (err) {
      
      console.warn('[canais/runtime] roteamento fail-open:', err)
    }
  }

  
  
  const [rowLido, dirRow, personaBlock] = await Promise.all([
    rowRoteado ? Promise.resolve(rowRoteado) : d.getAgentRow(agenteId),
    d.getDirectives(agenteId),
    (d.carregarPersonaBlock ?? carregarPersonaBlock)(agenteId),
  ])
  const row: AgentRow | null = rowLido
  if (!row || !row.enabled) return 'done'

  
  
  const origem = { agentId: row.id, conversaId: conversa.id, contatoId: contato.id, canalId: canal.id }

  
  
  
  
  
  
  let opcoesOferecidas: Interativo | null = null
  const opcoesDoTurno = (): Interativo | null => opcoesOferecidas

  
  const escalar = async (
    conversaId: string,
    motivo: string,
    gatilho: GatilhoEscalacao | 'tool',
    caso?: CasoEscalado,
  ): Promise<void> => {
    
    
    
    try { await d.descartarRascunhosPendentes(conversaId) } catch {  }

    const freshConv = await d.getConversa(conversaId)
    const janela = getProvider(canal.provider)?.adapter.capabilities.janela24h ?? true
    if (freshConv && !precisaJanela(janela, freshConv.ultima_msg_in_at, d.now())) {
      
      
      
      
      
      
      const aviso = await comDisclosure(AVISO_ESCALACAO, conversaId, canal, d)
      const envio = await d.sendText(canal, contato.external_id, aviso)
      if (envio.ok) {
        await d.insertMensagemExterna({ conversa_id: conversaId, direcao: 'out', autor: 'agente', texto: aviso, status: 'enviada', external_id: envio.externalId })
      } else {
        
        await d.insertMensagemExterna({ conversa_id: conversaId, direcao: 'out', autor: 'agente', texto: aviso, status: 'falhou' })
      }
    }

    
    
    let dossie: DossieHandoff | null = null
    try {
      const hist = await d.listMensagens(conversaId, 30)
      dossie = montarDossie({
        historico: sinaisDoHistorico(hist),
        ficha: contato?.ficha ?? { perfil: {}, aprendizados: [] },
        gatilho, motivo, agora: d.now(),
        ...(caso?.resumo ? { resumo: caso.resumo } : {}),
        ...(caso?.sabemos ? { sabemos: caso.sabemos } : {}),
        ...(caso?.falta ? { falta: caso.falta } : {}),
      })
      await (d.setConversaDossie ?? setConversaDossieDefault)(conversaId, dossie)
    } catch (e) { console.warn('[canais] dossiê fail-open:', e) }

    try { await d.recordEvent({ id: `escala:${conversaId}:${d.now()}`, type: 'action', label: `Atendimento: ${row.name} escalou pra humano (${motivo})`, agent: row.id }) } catch {  }
    
    
    void notificarEscalacao({
      contatoNome: contato.nome || 'Um cliente', motivo, conversaId,
      ...(dossie ? { resumo: dossie.resumo, sentimento: dossie.sentimento } : {}),
    })
    
    try {
      const hist = await d.listMensagens(conversaId, 30)
      await inserirCasoEscalacao({
        agentId: row.id, canalId: canal.id, conversaId,
        mensagens: historicoParaMensagens(hist),
        ficha: contato?.ficha ?? { perfil: {}, aprendizados: [] },
        agora: d.now(), motivo,
      })
    } catch (e) { console.warn('[treino] caso escalação fail-open:', e) }
  }

  
  
  
  if (gatilho) {
    await (d.setConversaStatus ?? setConversaStatus)(conversa.id, 'aguardando_humano')
    await escalar(conversa.id, MOTIVO_GATILHO[gatilho], gatilho)
    return 'done'
  }

  
  
  
  
  const cfgFollowup = configFollowup(canal.config)
  let toqueMs: number | null = null
  if (cfgFollowup.ligado) {
    const decisao = decidirFollowup(
      {
        status: fresca.status, ultimaMsgInAt: fresca.ultima_msg_in_at, ultimaMsgAt: fresca.ultima_msg_at,
        proximaAcao: fresca.proxima_acao, proximaAcaoEm: fresca.proxima_acao_em,
        toques: fresca.toques ?? 0, ligado: true, janela24h,
      },
      d.now(),
      { esperaMs: cfgFollowup.esperaMs },
    )
    if (decisao.acao === 'tocar') {
      const claim = await (d.claimToque ?? claimToqueDefault)(conversa.id, ACAO_FOLLOWUP, fresca.toques ?? 0)
      if (!claim) return 'done'
      toqueMs = Date.parse(d.now()) - Date.parse(fresca.ultima_msg_in_at ?? d.now())
    }
  }

  
  
  
  
  if (toqueMs === null && ultimaContada && ultimaContada.direcao !== 'in') return 'done'

  let arquivoAnexado: AnexoDoTurno | null = null
  
  
  const anexoDoTurno = (): AnexoDoTurno | null => arquivoAnexado
  const temArquivos = podeArquivo && catalogo.length > 0
  const canalEnviaMidia = getProvider(canal.provider)?.adapter.capabilities.enviaMidia ?? false

  
  
  
  let composioTools: Record<string, unknown> = {}
  try {
    const composio = await (d.getComposio ?? getComposioClient)()
    if (composio) {
      const modes = row.tools?.composio_action_modes ?? null
      const toolkits = row.tools?.composio_toolkits ?? null
      const makeExecuteFn = (toolkitBySlug: Map<string, string>) =>
        (async (slug: string, input: Record<string, unknown>) =>
          runActionCanal(
            { slug, args: input ?? {}, toolkit: toolkitBySlug.get(slug) ?? null, userId: composioUserId() },
            origem,
            { composio, modes },
          )) as ExecuteToolFn
      composioTools = await buildComposioMastraTools({ userId: composioUserId(), toolkits }, composio, makeExecuteFn)
    }
  } catch (err) {
    console.warn('[processarConversa] Composio do atendente indisponível (fail-open):', err)
    composioTools = {}
  }

  const agent = d.buildAgent({
    row, apiKey, diretrizes: dirRow.diretrizes ?? [], fichaTexto: renderFicha(contato.ficha), personaBlock,
    ctx: origem,
    composioTools,
    toolDeps: {
      
      
      
      
      embed: (t) => embedTexto(t, undefined, row.id),
      searchBase, getContato: d.getContato, updateFichaContato,
      setConversaStatus,
      onEscalar: (ctx, motivo, caso) => escalar(ctx.conversaId, motivo, 'tool', caso),
      
      
      
      ...(toqueMs !== null
        ? {
            escalacaoBloqueada:
              'Você não pode escalar num toque de follow-up: o cliente não perguntou nada e ninguém está esperando resposta. Se não houver algo útil e concreto a dizer, responda uma linha em branco — nada será enviado, e está tudo bem.',
          }
        : {}),
      
      
      ...(temArquivos && canalEnviaMidia
        ? {
            
            listarMidiaPublica: async () =>
              catalogo.map((a) => ({ slug: a.slug, rotulo: a.rotulo, descricao: a.descricao })),
            enviarArquivo: async (_ctx: typeof origem, slug: string, legenda?: string) => {
              if (arquivoAnexado) return { ok: false as const, motivo: 'ja_anexado' as const }
              
              const canonico = resolverSlug(catalogo.map((a) => a.slug), slug)
              if (!canonico) return { ok: false as const, motivo: 'slug_desconhecido' as const }
              
              
              const linha = await d.getMidiaPublica!(canal.id, canonico)
              if (!linha) return { ok: false as const, motivo: 'slug_desconhecido' as const }
              arquivoAnexado = { linha, legenda: (legenda ?? '').trim() }
              return { ok: true as const }
            },
          }
        : {}),
      
      
      ...(d.enviarInterativo
        ? {
            oferecerOpcoes: async (_ctx: typeof origem, bruto: unknown) => {
              if (opcoesOferecidas) {
                return { ok: false as const, erros: ['Você já ofereceu opções nesta resposta — mande só um conjunto.'] }
              }
              const v = validarInterativo(bruto)
              if (!v.ok) return { ok: false as const, erros: v.erros }
              opcoesOferecidas = v.valor
              
              
              const comoTexto = !(getProvider(canal.provider)?.adapter.capabilities.enviaInterativo ?? false)
              return { ok: true as const, comoTexto }
            },
          }
        : {}),
      now: d.now,
    },
  })

  
  
  
  
  const tzTurno = d.getTz ? await d.getTz().catch(() => TZ_FALLBACK) : TZ_FALLBACK
  const historicoMsgs = historicoParaMensagens(historico)
  
  
  const blocoConhecimento = await (d.recuperar ?? recuperarEInjetar)(row.id, historicoMsgs)
  
  
  
  
  
  
  
  
  
  
  
  
  const extras: Msg[] = []
  if (marcaDoTurno) extras.push({ role: 'assistant', content: marcaDoTurno })
  if (toqueMs !== null) extras.push({ role: 'user', content: notaFollowup(toqueMs) })
  const comNota: Msg[] = extras.length === 0 ? historicoMsgs : [...historicoMsgs, ...extras]
  const suffix = [blocoRelogio(d.now(), tzTurno), blocoConhecimento].filter((s) => s.trim()).join('\n\n')
  const mensagens = comContextoNaUltimaMsg(comNota, suffix)

  
  
  const ancora = [...historico].reverse().find((m) => m.direcao === 'in' && m.external_id)?.external_id ?? null
  let typingUltimoMs: number | null = null
  let typingRenovacoes = 0
  const pulsarTyping = async () => {
    if (!ancora) return
    const agoraMs = Date.parse(d.now())
    if (!deveRenovarTyping({ ultimoEnvioMs: typingUltimoMs, agoraMs, renovacoes: typingRenovacoes })) return
    typingUltimoMs = agoraMs
    typingRenovacoes += 1
    await (d.sinalizarDigitando ?? sinalizarDigitandoDispatch)(canal, ancora)
  }
  await pulsarTyping()

  const passo = async () => {
    
    
    
    if (onStep) await onStep()    
    await pulsarTyping()          
  }
  
  
  
  
  let houveTool = false
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const round = await runWithTurnContext({ conversaExternaId: conversa.id, actingAgentId: row.id, terceiroIngerido: true }, () =>
    d.runRound(agent as HeadlessAgentLike, mensagens, {
      maxSteps: MAX_STEPS, onStep: passo,
      onToolCall: () => { houveTool = true },
      
      
      
      onErroDoModelo: d.registrarErroDoModelo ?? registrarSeAcionavel,
      inatividadeMs: INATIVIDADE_MS, inatividadeToolMs: INATIVIDADE_TOOL_MS, rodadaMaxMs: TURNO_MAX_MS,
      
      
      
      fechamento: true,
    }),
  )
  try {
    await d.recordCost({ kind: 'chat', model: modeloDoCanal(row), promptTokens: round.inputTokens, completionTokens: round.outputTokens, cachedTokens: round.cachedTokens, agent: row.id })
  } catch {  }

  
  
  
  
  
  
  
  
  
  
  if (cortadoPeloPrazo(round)) {
    console.warn(`[canais/runtime] turno cortado pelo prazo — agente=${row.id} conversa=${conversa.id}`)
    try {
      await d.recordEvent({
        id: idDoFimAnormal(row.id, 'prazo', Date.parse(d.now())),
        type: 'tool',
        label: rotuloDoFimAnormal('prazo'),
        agent: row.id,
      })
    } catch (e) { console.warn('[canais/runtime] rastro do fim anormal falhou (fail-open):', e) }
  }

  if (!round.finished) return 'erro' 

  
  const posRun = await d.getConversa(conversa.id)
  const textoBruto = round.text.trim()
  
  
  
  
  
  
  
  
  
  
  
  
  
  const nadaProduzido = !textoBruto && !anexoDoTurno() && !opcoesDoTurno()
  const conversaSaiu = Boolean(posRun && posRun.status !== 'aberta')
  if (nadaProduzido && !houveTool && !conversaSaiu) {
    console.warn(`[canais/runtime] rodada vazia sem ferramenta — agente=${row.id} conversa=${conversa.id}`)
    return 'erro'
  }
  
  
  
  void (d.limparErroDoModelo ?? limparAlertaDoModelo)()
  if (conversaSaiu || nadaProduzido) {
    return novoInboundChegou(posRun, snapshotInAt) ? 'requeue' : 'done'
  }

  
  
  
  
  const preSend = decidirPreSend({
    snapshotInAt,
    atualInAt: posRun?.ultima_msg_in_at ?? null,
    descartesSeguidos: ciclo?.descartesSeguidos ?? 0,
  })
  if (preSend.acao === 'descartar') {
    if (ciclo) ciclo.descartesSeguidos += 1
    return 'requeue' 
  }
  if (ciclo) ciclo.descartesSeguidos = 0

  
  
  
  
  
  const texto = await comDisclosure(textoBruto, conversa.id, canal, d)

  if (canal.modo === 'autonomo' && !precisaJanela(janela24h, posRun?.ultima_msg_in_at ?? snapshotInAt, d.now())) {
    
    
    
    
    
    
    
    
    
    const bruto = anexoDoTurno()
    const anexo: AnexoDoTurno | null = bruto ? { linha: bruto.linha, legenda: texto ? '' : bruto.legenda } : null
    
    
    
    
    
    
    
    
    if (bruto && !(await aindaTenhoOTrabalho())) return 'perdido'
    const preparo = anexo
      ? await prepararArquivoCatalogo(anexo.linha, anexo.legenda, d.baixarMidiaPublica!).catch(
          () => ({ ok: false as const, motivo: 'sumiu' as const, legenda: 'Não consegui ler o arquivo.' }),
        )
      : null

    
    
    
    if (!(await aindaTenhoOTrabalho())) return 'perdido'

    let falhou: EnvioFalha | null = null
    
    
    let algoJaChegou = false
    if (texto) {
      const bolhas = await d.enviarEmBolhas(canal, contato.external_id, texto)
      for (const b of bolhas) {
        if (b.res.ok) {
          algoJaChegou = true
          await d.insertMensagemExterna({ conversa_id: conversa.id, direcao: 'out', autor: 'agente', texto: b.texto, status: 'enviada', external_id: b.res.externalId })
        } else {
          falhou = b.res
          
          await d.insertMensagemExterna({ conversa_id: conversa.id, direcao: 'out', autor: 'agente', texto: b.texto, status: 'falhou', erro: b.res.erro })
        }
      }
    }
    if (falhou) {
      return falhou.acao
        ? { erro: true, acao: falhou.acao, retryAfterMs: falhou.retryAfterMs ?? null }
        : 'erro' 
    }
    
    
    
    if (anexo && preparo) {
      
      
      
      
      if (!(await posseParaOProximoBloco(algoJaChegou))) return 'perdido'
      await entregarAnexo(conversa.id, canal, contato.external_id, anexo, preparo, d)
      algoJaChegou = true
    }
    
    
    const opcoes = opcoesDoTurno()
    if (opcoes) {
      if (!(await posseParaOProximoBloco(algoJaChegou))) return 'perdido'
      await entregarOpcoes(conversa.id, canal, contato.external_id, opcoes, d)
      algoJaChegou = true
    }
    await d.touchConversaOut(conversa.id, d.now())
  } else {
    
    
    
    if (!(await aindaTenhoOTrabalho())) return 'perdido'
    
    await d.descartarRascunhosPendentes(conversa.id)
    const proposta = anexoDoTurno()
    const opcoes = opcoesDoTurno()
    
    
    const textoParaOperador = textoDoRascunho(texto, opcoes ? opcoes.corpo : null)
    await d.insertMensagemExterna({
      conversa_id: conversa.id, direcao: 'out', autor: 'agente',
      texto: textoParaOperador, texto_rascunho: textoParaOperador, status: 'rascunho',
      
      
      
      
      ...(proposta
        ? {
            midia: {
              kind: kindDoArquivo(proposta.linha.mime),
              mime: proposta.linha.mime,
              storage_path: proposta.linha.storage_path,
              slug: proposta.linha.slug,
              rotulo: proposta.linha.rotulo,
            },
          }
        : opcoes
          ? { midia: { kind: 'interativo', dados: opcoes as unknown as Record<string, unknown>, texto_estruturado: interativoParaTexto(opcoes) } }
          : {}),
    })
  }

  
  const final = await d.getConversa(conversa.id)
  return novoInboundChegou(final, snapshotInAt) ? 'requeue' : 'done'

  
  async function aindaTenhoOTrabalho(): Promise<boolean> {
    if (!aindaMeu) return true
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        if (await aindaMeu()) return true
        console.warn(`[canais/runtime] o trabalho já é de outro runner; parando antes de responder — conversa=${conversa.id}`)
        return false
      } catch (e) {
        console.warn('[canais/runtime] portão de posse não respondeu:', e)
        if (tentativa === 0) await sleep(PAUSA_ENTRE_PERGUNTAS_MS)
      }
    }
    return true
  }

  
  async function posseParaOProximoBloco(algoJaChegou: boolean): Promise<boolean> {
    if (!algoJaChegou) return aindaTenhoOTrabalho()
    await renovarORelogio()
    return true
  }

  
  async function renovarORelogio(): Promise<void> {
    if (!aindaMeu) return
    try {
      if (!(await aindaMeu())) {
        console.warn(`[canais/runtime] o trabalho já é de outro runner; entregando o que o texto prometeu — conversa=${conversa.id}`)
      }
    } catch (e) { console.warn('[canais/runtime] renovação do relógio entre os blocos falhou:', e) }
  }
}


async function entregarAnexo(
  conversaId: string,
  canal: CanalRow,
  para: string,
  anexo: AnexoDoTurno,
  preparo: PreparoArquivo,
  d: ProcessarDeps,
): Promise<void> {
  const base = {
    conversa_id: conversaId, direcao: 'out' as const, autor: 'agente' as const, texto: anexo.legenda,
    midia: {
      kind: kindDoArquivo(anexo.linha.mime), mime: anexo.linha.mime,
      storage_path: anexo.linha.storage_path, slug: anexo.linha.slug, rotulo: anexo.linha.rotulo,
    },
  }
  try {
    if (!preparo.ok) {
      await d.insertMensagemExterna({ ...base, status: 'falhou', erro: legendaSemRetentativa(preparo.legenda) })
      return
    }
    const ent = await enviarPreparado(canal, para, preparo, d.enviarMidia!)
    if (ent.ok) {
      await d.insertMensagemExterna({ ...base, midia: { ...base.midia, kind: ent.kind, mime: ent.mime }, status: 'enviada', external_id: ent.externalId })
    } else {
      await d.insertMensagemExterna({ ...base, status: 'falhou', erro: legendaSemRetentativa(ent.legenda) })
    }
  } catch (err) {
    console.warn('[canais/runtime] entrega de arquivo falhou (não-fatal):', err)
    try { await d.insertMensagemExterna({ ...base, status: 'falhou', erro: 'Não consegui enviar o arquivo.' }) } catch {  }
  }
}


async function entregarOpcoes(
  conversaId: string,
  canal: CanalRow,
  para: string,
  i: Interativo,
  d: ProcessarDeps,
): Promise<void> {
  try {
    const { res, comoTexto } = await d.enviarInterativo!(canal, para, i)
    const base = {
      conversa_id: conversaId, direcao: 'out' as const, autor: 'agente' as const,
      texto: interativoParaTexto(i),
      midia: {
        kind: 'interativo', dados: i as unknown as Record<string, unknown>,
        texto_estruturado: interativoParaTexto(i), como_texto: comoTexto,
      },
    }
    if (res.ok) await d.insertMensagemExterna({ ...base, status: 'enviada', external_id: res.externalId })
    else await d.insertMensagemExterna({ ...base, status: 'falhou', erro: legendaSemRetentativa(res.erro) })
  } catch (err) {
    console.warn('[canais/runtime] entrega de opções falhou (não-fatal):', err)
  }
}


export interface AnuncioSemRespostaDeps {
  insertMensagemExterna?: typeof insertMsgDefault
  getContato?: typeof getContatoDefault
  notificar?: typeof notificarSemRespostaDefault
  recordEvent?: typeof recordEventDefault
}


export async function anunciarConversaSemResposta(
  conversa: { id: string; contato_id: string },
  jobId: string,
  deps: AnuncioSemRespostaDeps = {},
): Promise<void> {
  const inserir = deps.insertMensagemExterna ?? insertMsgDefault
  const buscarContato = deps.getContato ?? getContatoDefault
  const avisar = deps.notificar ?? notificarSemRespostaDefault
  const evento = deps.recordEvent ?? recordEventDefault

  
  
  try {
    await inserir({
      conversa_id: conversa.id, direcao: 'out', autor: 'agente',
      texto: MARCA_SEM_RESPOSTA, status: 'descartada',
      midia: { kind: KIND_SEM_RESPOSTA, texto_estruturado: MARCA_SEM_RESPOSTA },
    })
  } catch (e) { console.warn('[canais/runtime] marca de sem-resposta fail-open:', e) }

  try {
    await evento({ id: `atendimento_job:${jobId}:dead`, type: 'action', label: EVENTO_SEM_RESPOSTA, agent: 'jarvis' })
  } catch (e) { console.warn('[canais/runtime] evento de sem-resposta fail-open:', e) }

  
  
  try {
    const contato = await buscarContato(conversa.contato_id).catch(() => null)
    await avisar({ contatoNome: contato?.nome ?? '', conversaId: conversa.id })
  } catch (e) { console.warn('[canais/runtime] aviso de sem-resposta fail-open:', e) }
}

function novoInboundChegou(conv: ConversaExternaRow | null, snapshotInAt: string | null): boolean {
  if (!conv?.ultima_msg_in_at) return false
  if (!snapshotInAt) return true
  return Date.parse(conv.ultima_msg_in_at) > Date.parse(snapshotInAt)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))


export interface RunAtendimentoJobDeps {
  
  processar?: typeof processarConversa
}

export async function runAtendimentoJob(id: string, deps: RunAtendimentoJobDeps = {}): Promise<void> {
  const processar = deps.processar ?? processarConversa
  try {
    
    
    const ciclo = { descartesSeguidos: 0 }
    for (let i = 0; i < LOOP_CAP; i++) {
      const job = await getAtendimentoJob(id)
      if (!job || (job.status !== 'queued' && job.status !== 'running')) return
      if (job.status === 'running') return 
      const waitMs = Date.parse(job.nao_antes) - Date.now()
      if (waitMs > 0) { await sleep(Math.min(waitMs, POLL_MS)); continue }

      const claimed = await claimAtendimentoJob(id, ['queued'])
      if (!claimed) return
      
      if (Date.parse(claimed.nao_antes) > Date.now()) {
        await requeueAtendimentoJob(id, claimed.attempts, 'debounce empurrado no claim', marcaDe(claimed))
        continue
      }
      const conversa = await getConversaDefault(claimed.conversa_id)
      if (!conversa) { await finishAtendimentoJob(id, 'done', marcaDe(claimed)); return } 

      let outcome: ProcessarOutcome = 'erro'
      try {
        outcome = await processar(conversa, undefined, async () => {
          try { await tocarHeartbeatJob(id, marcaDe(claimed)) } catch {  }
        }, ciclo, () => tocarHeartbeatJob(id, marcaDe(claimed)))
      } catch (err) {
        console.warn('[canais/runtime] processarConversa lançou:', err)
      }

      
      
      if (outcome === 'perdido') return

      if (outcome === 'done') {
        const intacto = await concluirSeIntacto(id, claimed.nao_antes, marcaDe(claimed))
        if (intacto) return
        
        
        await requeueAtendimentoJob(id, claimed.attempts, 'inbound durante o run', marcaDe(claimed))
        continue
      }
      if (outcome === 'requeue') { 
        await requeueAtendimentoJob(id, claimed.attempts, 'novo inbound durante o run', marcaDe(claimed))
        continue
      }
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      const falha = typeof outcome === 'object' ? outcome : null
      const decisao = decidirRetry({
        acao: falha?.acao ?? null,
        retryAfterMs: falha?.retryAfterMs ?? null,
        attempts: claimed.attempts + 1,
        maxAttempts: claimed.max_attempts,
        agoraMs: Date.now(),
      })
      if (decisao.tipo === 'dead') {
        
        
        const morto = await finishAtendimentoJob(id, 'dead', marcaDe(claimed), decisao.motivo)
        if (morto) {
          
          
          
          
          await anunciarConversaSemResposta(conversa, id)
        }
        return
      }
      await requeueAtendimentoJob(id, decisao.attempts, decisao.motivo, marcaDe(claimed), decisao.naoAntesIso)
      continue
    }
  } catch (err) {
    console.warn('[canais/runtime] runAtendimentoJob falhou (backstop do heartbeat recupera):', err)
  }
}
