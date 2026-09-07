
import type { NotaCitada } from '../tools/buscarCerebro'
import type { ArtifactRow } from '../../data/artifacts'
import type { Papel } from '../../lib/equipe'
import type { MemoryDraft, PainelBlocoPatch, EstudioPatch, JuridicoPatch } from './wireTypes'
import type { TurnSink, ResumoTurno, ToolErroTurno } from './conselheiroEvents'
import type { MotivoDoFim, ResultadoDeTool } from '../../lib/conversa/fechamentoDoTurno'
import {
  avisoDeDemora,
  avisoDeFechamentoVazio,
  idDoFimAnormal,
  motivoDoFechamento,
  payloadDaMensagem,
  rotuloDoFimAnormal,
  LINHA_CORTADA,
  LINHA_DEMORA,
  precisaFechamento,
  renderBlocoDeFechamento,
} from '../../lib/conversa/fechamentoDoTurno'
import {
  correrContraORelogio,
  iterateChunks,
  orcamentoDeEspera,
  EXPIROU,
  INATIVIDADE_MS_PADRAO,
  INATIVIDADE_TOOL_MS_PADRAO,
  TURNO_MAX_MS_PADRAO,
  type ControleDePrazo,
  type PrazoDoTurno,
} from './relogioDoTurno'
import { registrarSeAcionavel, limparAlertaDoModelo as limparAlertaDoModeloReal } from '@/server/modelo/alerta'
import { runWithTurnContext } from './turnContext'
import { motivoSeguro } from '../../lib/sanitizarErro'
import { extractPendingApprovalId } from './executor/headlessRun'
import { appendMessage as realAppendMessage } from '../../data/messages'
import { recordCost as realRecordCost, type RecordCostInput } from '../../data/cost'
import { listArtifactsByConversation as realListArtifactsByConversation } from '../../data/artifacts'
import { recordEvent as realRecordEvent, type RecordEventInput } from '../../data/events'
import { isAnexoDeConversa } from '../../lib/artifacts'



const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.1'


const RETRY_BACKOFF_MS = 400


export interface ChatAgentLike {
  stream(messages: unknown, options?: unknown): Promise<{ fullStream: unknown }>
}


export interface RunTurnDeps {
  appendMessage: (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    toolPayload?: unknown,
  ) => Promise<unknown>
  recordCost: (input: RecordCostInput) => Promise<void>
  listArtifactsByConversation: (conversationId: string) => Promise<ArtifactRow[]>
  
  recordEvent: (input: RecordEventInput) => Promise<void>
  
  registrarErroDoModelo?: (erro: unknown) => void
  limparAlertaDoModelo?: () => void
}

const DEFAULT_DEPS: RunTurnDeps = {
  appendMessage: realAppendMessage,
  recordCost: realRecordCost,
  listArtifactsByConversation: realListArtifactsByConversation,
  recordEvent: realRecordEvent,
  registrarErroDoModelo: registrarSeAcionavel,
  limparAlertaDoModelo: () => { void limparAlertaDoModeloReal() },
}

export interface RunConversationTurnOpts {
  conversationId: string
  operatorId?: string
  
  papel?: Papel
  
  costAgentId?: string
  
  costModel?: string
  
  maxSteps: number
  
  emitConversationId?: boolean
  
  seenArtifactIds?: Set<string>
  
  falaDoDono?: string
  
  inatividadeMs?: number
  
  inatividadeToolMs?: number
  
  turnoMaxMs?: number
  
  fechamentoMaxMs?: number
}


function chunkType(chunk: unknown): string | undefined {
  return (chunk as { type?: unknown })?.type as string | undefined
}


function motivoDoErroDeTool(error: unknown): string {
  const bruto =
    error instanceof Error || typeof error === 'string'
      ? error
      : ((error as { message?: unknown })?.message ?? error)
  return motivoSeguro(bruto)
}


const FECHAMENTO_MAX_MS = 60_000


interface ResultadoDoFechamento {
  texto: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  expirou: boolean
}


async function rodarFechamento(args: {
  agent: ChatAgentLike
  messages: unknown
  resultados: ResultadoDeTool[]
  
  rodouFerramenta: boolean
  orcamentoMs: number
  contexto: { conversationId: string; actingAgentId: string; operatorId?: string; papel?: Papel }
  onTexto: (delta: string) => void
}): Promise<ResultadoDoFechamento> {
  const { agent, messages, resultados, rodouFerramenta, orcamentoMs, contexto, onTexto } = args
  const saida: ResultadoDoFechamento = {
    texto: '', inputTokens: 0, outputTokens: 0, cachedTokens: 0, expirou: false,
  }
  
  
  const controle: ControleDePrazo = { expirou: false, toolsEmVoo: 0 }
  const prazo: PrazoDoTurno = {
    inatividadeMs: orcamentoMs,
    inatividadeToolMs: orcamentoMs,
    turnoMaxMs: orcamentoMs,
    inicio: Date.now(),
  }

  await runWithTurnContext(
    {
      conversationId: contexto.conversationId,
      actingAgentId: contexto.actingAgentId,
      operatorId: contexto.operatorId,
      papel: contexto.papel,
      painelSink: [], estudioSink: [], juridicoSink: [], citationsSink: [],
    },
    async () => {
      const bloco = renderBlocoDeFechamento(resultados, rodouFerramenta)
      
      
      
      
      
      
      
      
      
      
      
      
      
      const msgs = Array.isArray(messages) ? [...messages, { role: 'user', content: bloco }] : messages
      const corte = new AbortController()
      const criacao = agent.stream(msgs, { maxSteps: 1, toolChoice: 'none', abortSignal: corte.signal })
      const criado = await correrContraORelogio(criacao, orcamentoMs)
      if (criado === EXPIROU) {
        saida.expirou = true
        corte.abort()
        
        
        void criacao.then((r) => (r.fullStream as ReadableStream).cancel()).catch(() => {  })
        return
      }
      for await (const chunk of iterateChunks(criado.fullStream, prazo, controle, () => corte.abort())) {
        const tipo = chunkType(chunk)
        if (tipo === 'text-delta') {
          const texto = (chunk as { payload?: { text?: string } }).payload?.text ?? ''
          if (texto) { saida.texto += texto; onTexto(texto) }
        } else if (tipo === 'step-finish') {
          
          
          const usage = (chunk as { payload?: { output?: { usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } } } })
            .payload?.output?.usage
          saida.inputTokens += usage?.inputTokens ?? 0
          saida.outputTokens += usage?.outputTokens ?? 0
          saida.cachedTokens += usage?.cachedInputTokens ?? 0
        }
        
        
      }
      saida.expirou = controle.expirou
    },
  )
  return saida
}


export async function runConversationTurn(
  agent: ChatAgentLike,
  messages: unknown,
  sink: TurnSink,
  opts: RunConversationTurnOpts,
  deps: RunTurnDeps = DEFAULT_DEPS,
): Promise<ResumoTurno> {
  const { conversationId, operatorId, papel, maxSteps, emitConversationId } = opts
  const costAgentId = opts.costAgentId ?? 'jarvis'
  const costModel = opts.costModel ?? OPENAI_MODEL
  const seenArtifactIds = opts.seenArtifactIds ?? new Set<string>()
  
  
  const registrarErro = deps.registrarErroDoModelo ?? registrarSeAcionavel
  const limparAlerta = deps.limparAlertaDoModelo ?? (() => { void limparAlertaDoModeloReal() })

  let assistantText = ''
  let citations: NotaCitada[] | null = null
  let persisted = false
  
  
  
  
  let messageIdPersistido: string | undefined
  let pendingApprovalId: string | null = null
  
  let inUsed = 0
  let outUsed = 0
  let cachedUsed = 0
  let finished = false
  
  
  
  let finishReason: string | undefined
  
  
  let fimAnormal: MotivoDoFim | undefined
  
  
  
  let textoDeSocorro = false
  
  
  
  let fechamentoUsado = false
  
  
  
  
  
  
  let algumChunkProcessado = false
  
  
  
  const toolErrors: ToolErroTurno[] = []
  
  
  
  const toolNames: string[] = []
  
  
  
  const resultadosDeTool: ResultadoDeTool[] = []
  const registrarToolName = (nome: string | undefined) => {
    if (nome && !toolNames.includes(nome)) toolNames.push(nome)
  }
  
  
  
  
  
  let rodouFerramenta = false
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  let algoVisivel = false

  
  const painelSink: PainelBlocoPatch[] = []
  const estudioSink: EstudioPatch[] = []
  const juridicoSink: JuridicoPatch[] = []
  
  const citationsSink: NotaCitada[] = []
  let drainedCitations = 0

  
  
  if (emitConversationId) sink.onConversationId?.(conversationId)

  const controlePrazo: ControleDePrazo = { expirou: false, toolsEmVoo: 0 }
  const prazo: PrazoDoTurno = {
    inatividadeMs: opts.inatividadeMs ?? INATIVIDADE_MS_PADRAO,
    inatividadeToolMs: opts.inatividadeToolMs ?? INATIVIDADE_TOOL_MS_PADRAO,
    turnoMaxMs: opts.turnoMaxMs ?? TURNO_MAX_MS_PADRAO,
    inicio: Date.now(),
  }

  try {
    
    
    
    await runWithTurnContext(
      { conversationId, actingAgentId: costAgentId, operatorId, papel, falaDoDono: opts.falaDoDono, painelSink, estudioSink, juridicoSink, citationsSink },
      async () => {
        
        
        const consumirStream = async () => {
        
        
        
        
        
        
        
        
        const orcamentoDeCriacao = orcamentoDeEspera(prazo, controlePrazo, Date.now())
        if (orcamentoDeCriacao <= 0) {
          controlePrazo.expirou = true
          return
        }
        
        
        
        const corte = new AbortController()
        const criacao = agent.stream(messages, { maxSteps, abortSignal: corte.signal })
        const criado = await correrContraORelogio(criacao, orcamentoDeCriacao)
        if (criado === EXPIROU) {
          controlePrazo.expirou = true
          corte.abort()
          
          
          
          void criacao.then((r) => (r.fullStream as ReadableStream).cancel()).catch(() => {  })
          return
        }
        const { fullStream } = criado
        for await (const chunk of iterateChunks(fullStream, prazo, controlePrazo, () => corte.abort())) {
          
          
          
          algumChunkProcessado = true
          const type = chunkType(chunk)

          if (type === 'text-delta') {
            const text = (chunk as { payload?: { text?: string } }).payload?.text ?? ''
            if (text) {
              assistantText += text
              sink.onText(text)
            }
          } else if (type === 'tool-call') {
            rodouFerramenta = true
            
            
            
            
            
            
            
            
            
            
            
            controlePrazo.toolsEmVoo++
            
            
            const toolName = (chunk as { payload?: { toolName?: string } }).payload?.toolName
            registrarToolName(toolName)
            if (toolName) sink.onProgresso?.({ tool: toolName, rotulo: toolName })
          } else if (type === 'tool-result') {
            rodouFerramenta = true
            
            
            controlePrazo.toolsEmVoo = Math.max(0, controlePrazo.toolsEmVoo - 1)
            const payload = (chunk as { payload?: { toolName?: string; result?: unknown } }).payload
            registrarToolName(payload?.toolName)
            if (payload?.toolName) resultadosDeTool.push({ toolName: payload.toolName, result: payload.result })

            
            if (pendingApprovalId == null) {
              const id = extractPendingApprovalId(payload?.result)
              if (id) pendingApprovalId = id
            }

            
            
            
            if (payload?.toolName === 'buscarCerebro' || payload?.toolName === 'buscarConversas') {
              
              
              
              const drained = citationsSink.slice(drainedCitations)
              drainedCitations = citationsSink.length
              const fallback = Array.isArray(payload.result) ? (payload.result as NotaCitada[]) : []
              const notes = drained.length ? drained : fallback
              
              citations = citations ? [...citations, ...notes] : notes
              sink.onCitacoes?.(notes)
            } else if (payload?.toolName === 'emitirArtefato' || payload?.toolName === 'gerarImagem') {
              
              
              
              
              
              
              
              
              try {
                const recentArtifacts = await deps.listArtifactsByConversation(conversationId)
                const fresh = recentArtifacts.find((x) => !seenArtifactIds.has(x.id) && !isAnexoDeConversa(x))
                if (fresh) {
                  seenArtifactIds.add(fresh.id)
                  if (sink.onArtefato) { sink.onArtefato(fresh); algoVisivel = true }
                }
              } catch (e) {
                console.warn('[runConversationTurn] emitir artefato falhou (não-fatal):', e)
              }
            } else if (payload?.toolName === 'rascunharMemoria') {
              
              const draft = payload.result as { título?: string; conteúdo?: string; tipo?: string; tags?: string[] } | undefined
              if (draft && draft.título) {
                const emitido: MemoryDraft = {
                  título: draft.título,
                  conteúdo: draft.conteúdo ?? '',
                  tipo: draft.tipo ?? 'semantic',
                  tags: draft.tags,
                }
                if (sink.onRascunhoMemoria) { sink.onRascunhoMemoria(emitido); algoVisivel = true }
              }
            } else if (payload?.toolName === 'transferir') {
              const r = payload.result as { agentId?: string; resumo?: string } | undefined
              if (r?.agentId && sink.onTransfer) { sink.onTransfer(r.agentId, r.resumo ?? ''); algoVisivel = true }
            } else if (
              payload?.toolName === 'montarBloco' ||
              payload?.toolName === 'removerBloco' ||
              payload?.toolName === 'recomendar'
            ) {
              
              const patch = (payload.result as { patch?: PainelBlocoPatch } | undefined)?.patch
              if (patch && sink.onPainel) { sink.onPainel(patch); algoVisivel = true }
            }

            
            
            
            
            
            
            for (const patch of painelSink.splice(0)) {
              if (sink.onPainel) { sink.onPainel(patch); algoVisivel = true }
            }
            for (const patch of estudioSink.splice(0)) {
              if (sink.onEstudio) { sink.onEstudio(patch); algoVisivel = true }
            }
            for (const patch of juridicoSink.splice(0)) {
              if (sink.onJuridico) { sink.onJuridico(patch); algoVisivel = true }
            }
          } else if (type === 'tool-error') {
            
            
            
            
            
            rodouFerramenta = true
            
            controlePrazo.toolsEmVoo = Math.max(0, controlePrazo.toolsEmVoo - 1)
            const payload = (chunk as { payload?: { toolName?: string; toolCallId?: string; error?: unknown } }).payload
            const tool = payload?.toolName ?? 'desconhecida'
            registrarToolName(payload?.toolName)
            const motivo = motivoDoErroDeTool(payload?.error)
            toolErrors.push({ tool, motivo })
            console.error(
              `[runConversationTurn] tool '${tool}' FALHOU — agent=${costAgentId} conversa=${conversationId} toolCallId=${payload?.toolCallId ?? '-'}: ${motivo}`,
            )
          } else if (type === 'step-finish') {
            
            
            const usage = (chunk as { payload?: { output?: { usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } } } })
              .payload?.output?.usage
            inUsed += usage?.inputTokens ?? 0
            outUsed += usage?.outputTokens ?? 0
            cachedUsed += usage?.cachedInputTokens ?? 0
          } else if (type === 'finish') {
            finished = true
            
            
            const reason = (chunk as { payload?: { stepResult?: { reason?: unknown } } }).payload?.stepResult?.reason
            if (typeof reason === 'string') {
              finishReason = reason
              
              
              
              if (reason !== 'stop') {
                console.warn(
                  `[runConversationTurn] turno terminou por '${reason}' (possível resposta incompleta) — agent=${costAgentId}`,
                )
              }
            }
          } else if (type === 'error') {
            
            
            
            
            registrarErro((chunk as { payload?: { error?: unknown } }).payload?.error)
          }
          
          
        }
        }

        
        
        
        
        
        
        try {
          await consumirStream()
        } catch (err) {
          registrarErro(err)
          if (algumChunkProcessado) throw err
          console.warn(
            `[runConversationTurn] stream caiu ANTES do 1º chunk — retry único — agent=${costAgentId}:`,
            err,
          )
          
          
          
          inUsed = 0
          outUsed = 0
          cachedUsed = 0
          pendingApprovalId = null
          citations = null
          finished = false
          finishReason = undefined
          
          
          
          
          controlePrazo.expirou = false
          controlePrazo.toolsEmVoo = 0
          drainedCitations = 0
          toolErrors.length = 0
          toolNames.length = 0
          resultadosDeTool.length = 0
          rodouFerramenta = false
          algoVisivel = false
          citationsSink.length = 0
          painelSink.length = 0
          estudioSink.length = 0
          juridicoSink.length = 0
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
          
          await consumirStream()
        }
      },
    )

    
    
    
    
    
    
    
    
    
    if (controlePrazo.expirou && !finished) {
      fimAnormal = 'prazo'
      
      
      
      
      const temParcial = assistantText.trim().length > 0
      const remate = temParcial ? LINHA_DEMORA : avisoDeDemora(rodouFerramenta)
      if (!temParcial) textoDeSocorro = true
      assistantText += remate
      sink.onText(remate)
    }

    
    
    
    
    
    
    
    
    
    
    
    if (finishReason === 'length' && assistantText.trim()) {
      if (!fimAnormal) fimAnormal = 'length'
      assistantText += LINHA_CORTADA
      sink.onText(LINHA_CORTADA)
    }

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    if (precisaFechamento({ texto: assistantText, pendingApprovalId, algoVisivel })) {
      fechamentoUsado = true
      if (!fimAnormal) fimAnormal = motivoDoFechamento({ finishReason, rodouFerramenta })
      
      
      let fechamentoExpirou = false
      try {
        const f = await rodarFechamento({
          agent,
          messages,
          resultados: resultadosDeTool,
          rodouFerramenta,
          orcamentoMs: opts.fechamentoMaxMs ?? FECHAMENTO_MAX_MS,
          contexto: { conversationId, actingAgentId: costAgentId, operatorId, papel },
          onTexto: (delta) => { assistantText += delta; sink.onText(delta) },
        })
        
        inUsed += f.inputTokens
        outUsed += f.outputTokens
        cachedUsed += f.cachedTokens
        fechamentoExpirou = f.expirou
        
        
        if (f.expirou && assistantText.trim()) {
          assistantText += LINHA_DEMORA
          sink.onText(LINHA_DEMORA)
        }
      } catch (e) {
        console.warn('[runConversationTurn] rodada de fechamento falhou (cai no aviso):', e)
      }
      if (!assistantText.trim()) {
        
        
        
        
        
        
        
        
        
        
        
        const demorou = controlePrazo.expirou || fechamentoExpirou
        fimAnormal = demorou ? 'prazo' : 'fechamento-vazio'
        const aviso = demorou ? avisoDeDemora(rodouFerramenta) : avisoDeFechamentoVazio(rodouFerramenta)
        assistantText = aviso
        textoDeSocorro = true
        sink.onText(aviso)
      }
    }

    
    
    if (inUsed > 0 || outUsed > 0) {
      try {
        await deps.recordCost({
          kind: 'chat',
          model: costModel,
          promptTokens: inUsed,
          completionTokens: outUsed,
          cachedTokens: cachedUsed,
          agent: costAgentId,
        })
      } catch {
        
      }
    } else if (controlePrazo.expirou) {
      
      
      
      console.warn(
        `[runConversationTurn] turno cortado pelo prazo antes de qualquer contagem de uso — o gasto que seguiu correndo NÃO entra no painel — agent=${costAgentId} conversa=${conversationId}`,
      )
    } else {
      console.warn('[runConversationTurn] usage zerado após o stream — os chunks step-finish podem não estar trazendo usage')
    }

    
    
    
    
    
    
    persisted = true
    
    
    
    const linha = (await deps.appendMessage(
      conversationId,
      'assistant',
      assistantText,
      payloadDaMensagem({ citations, socorro: textoDeSocorro }),
    )) as { id?: string } | undefined
    messageIdPersistido = typeof linha?.id === 'string' ? linha.id : undefined

    
    
    
    
    
    
    
    
    if (fimAnormal) {
      try {
        await deps.recordEvent({
          
          
          id: idDoFimAnormal(costAgentId, fimAnormal, Date.now()),
          
          type: 'tool',
          label: rotuloDoFimAnormal(fimAnormal),
          agent: costAgentId,
        })
      } catch (e) {
        console.warn('[runConversationTurn] registro do fim anormal falhou (fail-open):', e)
      }
    }
  } finally {
    
    
    
    
    if (!persisted && assistantText) {
      const linha = (await deps.appendMessage(
        conversationId,
        'assistant',
        assistantText,
        payloadDaMensagem({ citations, socorro: textoDeSocorro }),
      )) as { id?: string } | undefined
      messageIdPersistido = typeof linha?.id === 'string' ? linha.id : undefined
    }
  }

  
  
  
  
  if (assistantText.trim() && !textoDeSocorro) limparAlerta()

  return {
    finished,
    text: assistantText,
    inputTokens: inUsed,
    outputTokens: outUsed,
    cachedTokens: cachedUsed,
    pendingApprovalId,
    messageId: messageIdPersistido,
    finishReason,
    fimAnormal,
    textoDeSocorro,
    fechamentoUsado,
    toolErrors,
    toolNames,
    resultadosDeTool,
  }
}
