






















import {
  listPendentes as listPendentesDefault, claimNotificacao, marcarEnviada as marcarEnviadaDefault,
  falhouOuRequeue as falhouOuRequeueDefault, marcarStatus as marcarStatusDefault,
  listColdEnviando, insertNotificacao, type NotificacaoRow,
} from '@/data/notificacoes'
import { decidir, minutosAteQuietComecar, type NotifPrefs } from '@/lib/proativo/politica'
import { renderNotificacao } from '@/lib/proativo/render'
import { mdParaHtmlTelegram } from '@/lib/telegram/mdParaHtml'
import { montarBriefingPush, deveBriefarAgora, type ResultadoDoBriefing } from '@/lib/proativo/briefingPush'



import type { NarrativeInput } from '@/server/briefing/narrative'
import { getSetting, setSetting } from '@/data/settings'
import { TZ_DEFAULT, validarTz } from '@/lib/tempo/fusoDoDono'
import { CHAVE_SEM_CANAL } from '@/lib/proativo/destinoDoAviso'
import { getSecret, SECRET_KEYS } from '@/server/secrets'
import { sendText, sendPhoto, sendDocument, editMessageText, type BotaoInline, type SendResultado } from '@/server/canais/telegram'
import { criarTelegramSink, type TelegramSinkDeps, type TelegramSink } from '@/server/canais/telegramSink'
import type { OwnerChat } from '@/server/canais/telegramTurno'
import { listArtifactsByTask, listArtifactsByPlan, type ArtifactRow } from '@/data/artifacts'
import { serverDb } from '@/server/supabase'
import { listVencidos, marcarDisparado, reagendar } from '@/data/lembretes'
import { proximaOcorrenciaAte } from '@/lib/proativo/recorrencia'
import { corpoDoLembrete } from '@/lib/proativo/contextoDoLembrete'

export const COLD_MS = 15 * 60_000







export const CHECAGEM_MIN_INTERVALO_MS = 20 * 60_000





export const PERTO_DO_QUIET_MIN = 20


export { TZ_DEFAULT, validarTz }

export interface DispatchDeps {
  listPendentes: typeof listPendentesDefault
  claim: typeof claimNotificacao
  marcarEnviada: typeof marcarEnviadaDefault
  falhouOuRequeue: typeof falhouOuRequeueDefault
  marcarStatus: typeof marcarStatusDefault
  listCold: typeof listColdEnviando
  getPrefs: () => Promise<NotifPrefs>
  getTz: () => Promise<string>
  getOwner: () => Promise<OwnerChat | null>
  getAppUrl: () => Promise<string | null>
  getSemCanalDesde: () => Promise<string | null>
  setSemCanalDesde: (iso: string) => Promise<void>
  limparSemCanal: () => Promise<void>
  
  enviar: (chatId: string, texto: string, teclado?: BotaoInline[][]) => Promise<SendResultado>
  now: () => string
  
  getBriefingState: () => Promise<{ horaAlvo: string; lastDate: string | null }>
  setBriefingLast: (date: string) => Promise<void>
  getNarrativa: () => Promise<string>
  
  getInsumosDaNarrativa: () => Promise<NarrativeInput>
  
  gerarNarrativaDeInsumos: (insumos: NarrativeInput) => Promise<string>
  
  getUltimaChecagem: () => Promise<string | null>
  setUltimaChecagem: (iso: string) => Promise<void>
  
  getGastoDoDiaUsd: () => Promise<number>
  listAprovacoesAbertas: () => Promise<string[]>
  
  listVencidos: typeof listVencidos
  marcarDisparado: typeof marcarDisparado
  reagendarFn: typeof reagendar
  
  
  inserirNotificacao: typeof insertNotificacao
  
  getApprovalStatus: (id: string) => Promise<string | null>
  
  entregarArtefatosTarefa: (taskId: string, chatId: string) => Promise<void>
  
  entregarArtefatosPlano: (planId: string, chatId: string) => Promise<void>
}

export async function lerPrefs(): Promise<NotifPrefs> {
  try { const raw = await getSetting('notificacao_prefs'); return raw ? (JSON.parse(raw) as NotifPrefs) : {} } catch { return {} }
}

export interface EntregarArtefatosDeps {
  listArtifactsByTask: (taskId: string) => Promise<ArtifactRow[]>
  criarSink: (chatId: string) => Pick<TelegramSink, 'onArtefato'>
}


export async function entregarArtefatosViaSink(
  taskId: string,
  chatId: string,
  deps: EntregarArtefatosDeps,
): Promise<void> {
  try {
    const arts = await deps.listArtifactsByTask(taskId)
    if (!arts.length) return
    const sink = deps.criarSink(chatId)
    for (const a of arts) await sink.onArtefato?.(a)
  } catch (e) {
    console.warn('[proativo/dispatcher] entregarArtefatosTarefa fail-open:', e)
  }
}

export async function defaultDispatchDeps(): Promise<DispatchDeps> {
  const token = (await getSecret(SECRET_KEYS.telegram_bot_token)) ?? ''
  
  const criarSinkTelegram = (cid: string): Pick<TelegramSink, 'onArtefato'> => {
    const sinkDeps: TelegramSinkDeps = {
      sendText: (c, t, o) => sendText(token, c, t, o),
      sendPhoto: (c, url, cap) => sendPhoto(token, c, url, cap),
      sendDocument: (c, bytes, filename, cap) => sendDocument(token, c, bytes, filename, cap),
      editMessageText: (c, id, t, o) => editMessageText(token, c, id, t, o),
      signArtifactUrl: async (storageRef) => {
        const { data, error } = await serverDb().storage.from('artifacts').createSignedUrl(storageRef, 3600)
        if (error || !data?.signedUrl) { console.warn('[proativo/dispatcher] createSignedUrl falhou (pulo a foto):', error?.message); return null }
        return data.signedUrl
      },
    }
    return criarTelegramSink(cid, sinkDeps)
  }
  
  
  
  
  
  
  const montarInsumosNarrativa = async (): Promise<NarrativeInput> => {
    const { getBriefing, getFatosNegocio } = await import('@/data/briefing')
    const { ASSISTANT_NAME } = await import('@/lib/brand')
    const { getCompanyProfile } = await import('@/data/settings')
    const operatorName = (await getCompanyProfile()).operatorName?.trim() || 'você'
    const tz = validarTz((await getSetting('operator_timezone')) ?? TZ_DEFAULT)
    const now = new Date()
    const [b, fatos] = await Promise.all([
      getBriefing(operatorName, now, tz),
      getFatosNegocio(now, tz),
    ])
    return {
      operatorName,
      assistantName: ASSISTANT_NAME,
      memCount: b.memCount,
      desfechosRecentes: b.desfechosRecentes,
      dateStr: b.date,
      periodo: b.periodo,
      tarefasConcluidas: fatos.tarefasConcluidas,
      tarefasFalhadas: fatos.tarefasFalhadas,
      atendimentosAguardando: fatos.atendimentosAguardando,
      rotinasQueRodaram: fatos.rotinasQueRodaram,
      prazosNaJanela: fatos.prazosNaJanela,
      leiturasFalharam: fatos.leiturasFalharam,
    }
  }
  return {
    listPendentes: listPendentesDefault, claim: claimNotificacao, marcarEnviada: marcarEnviadaDefault,
    falhouOuRequeue: falhouOuRequeueDefault, marcarStatus: marcarStatusDefault, listCold: listColdEnviando,
    getPrefs: lerPrefs,
    getTz: async () => validarTz((await getSetting('operator_timezone')) ?? TZ_DEFAULT),
    getOwner: async () => { try { const r = await getSetting('telegram_owner_chat'); return r ? (JSON.parse(r) as OwnerChat) : null } catch { return null } },
    getAppUrl: () => getSetting('app_public_url'),
    getSemCanalDesde: () => getSetting(CHAVE_SEM_CANAL),
    setSemCanalDesde: (iso) => setSetting(CHAVE_SEM_CANAL, iso),
    limparSemCanal: () => setSetting(CHAVE_SEM_CANAL, ''),
    enviar: (chatId, texto, teclado) => sendText(token, chatId, texto, { ...(teclado ? { teclado } : {}), parseMode: 'HTML' }),
    now: () => new Date().toISOString(),
    getBriefingState: async () => ({
      horaAlvo: (await getSetting('briefing_push_hora')) ?? '07:00',
      lastDate: await getSetting('briefing_push_last'),
    }),
    setBriefingLast: (date) => setSetting('briefing_push_last', date),
    
    
    getNarrativa: async () => {
      const { generateBriefingNarrative } = await import('@/server/briefing/narrative')
      return generateBriefingNarrative(await montarInsumosNarrativa())
    },
    
    
    
    getInsumosDaNarrativa: montarInsumosNarrativa,
    gerarNarrativaDeInsumos: async (insumos) => {
      const { generateBriefingNarrative } = await import('@/server/briefing/narrative')
      return generateBriefingNarrative(insumos)
    },
    getUltimaChecagem: () => getSetting('briefing_push_last_check'),
    setUltimaChecagem: (iso) => setSetting('briefing_push_last_check', iso),
    
    
    getGastoDoDiaUsd: async () => {
      const { getGastoDoDiaUsd } = await import('@/data/briefing')
      const tz = validarTz((await getSetting('operator_timezone')) ?? TZ_DEFAULT)
      return getGastoDoDiaUsd(new Date(), tz)
    },
    listAprovacoesAbertas: async () => {
      const { listPending } = await import('@/data/approvals')
      return (await listPending()).map((a) => a.title ?? a.kind)
    },
    listVencidos, marcarDisparado, reagendarFn: reagendar, inserirNotificacao: insertNotificacao,
    
    
    getApprovalStatus: async (id) => (await import('@/data/approvals')).getApproval(id).then((a) => a?.status ?? null),
    entregarArtefatosTarefa: (taskId, chatId) => entregarArtefatosViaSink(taskId, chatId, { listArtifactsByTask, criarSink: criarSinkTelegram }),
    
    
    entregarArtefatosPlano: (planId, chatId) => entregarArtefatosViaSink(planId, chatId, { listArtifactsByTask: listArtifactsByPlan, criarSink: criarSinkTelegram }),
  }
}

export interface PassResultado { enviadas: number; seguradas: number; suprimidas: number; falhas: number; semCanal?: boolean }

export async function runDispatchPass(deps?: DispatchDeps): Promise<PassResultado> {
  const d = deps ?? (await defaultDispatchDeps())
  const out: PassResultado = { enviadas: 0, seguradas: 0, suprimidas: 0, falhas: 0 }

  
  
  
  
  
  
  
  
  
  const owner = await d.getOwner()
  if (!owner) {
    out.semCanal = true
    
    
    try {
      if (!(await d.getSemCanalDesde())) await d.setSemCanalDesde(d.now())
    } catch (e) { console.warn('[proativo] marcador semCanal fail-open:', e) }
  } else {
    
    
    
    
    
    try {
      if (await d.getSemCanalDesde()) await d.limparSemCanal()
    } catch {  }
  }

  
  
  const pendentes = await d.listPendentes()
  if (pendentes.length === 0 || !owner) return out 
  const [prefs, tz, appUrl] = await Promise.all([d.getPrefs(), d.getTz(), d.getAppUrl()])

  for (const n of pendentes) {
    try {
      const dec = decidir(n, prefs, d.now(), tz)
      if (dec === 'segurar_pro_briefing') { out.seguradas++; continue } 
      const claimed = await d.claim(n.id)
      if (!claimed) continue 
      if (dec === 'suprimir') { await d.marcarStatus(n.id, 'suprimida'); out.suprimidas++; continue }
      
      
      
      
      
      if (n.tipo === 'aprovacao') {
        const aid = typeof n.payload?.['approval_id'] === 'string' ? (n.payload['approval_id'] as string) : null
        if (aid) {
          let status: string | null = null
          try { status = await d.getApprovalStatus(aid) }
          catch (e) { console.warn('[proativo/dispatcher] checagem de aprovação falhou (fail-open, envia):', e) }
          if (status && status !== 'pending') {
            await d.marcarStatus(n.id, 'suprimida')
            out.suprimidas++
            continue
          }
        }
      }
      const msg = renderNotificacao(n, appUrl)
      
      
      
      
      
      
      
      const r = await d.enviar(owner.chatId, mdParaHtmlTelegram(msg.texto), msg.teclado)
      if (r.ok) {
        
        
        
        try { await d.marcarEnviada(n.id) }
        catch (e) { console.warn('[proativo/dispatcher] marcarEnviada falhou pós-envio (fica em enviando; cold recolhe):', e) }
        out.enviadas++ 
        
        
        
        if (n.tipo === 'tarefa_concluida') {
          const taskId = typeof n.payload?.['task_id'] === 'string' ? (n.payload['task_id'] as string) : null
          if (taskId) await d.entregarArtefatosTarefa(taskId, owner.chatId).catch(() => {})
        }
        
        
        if (n.tipo === 'plano_concluido') {
          const planId = typeof n.payload?.['plan_id'] === 'string' ? (n.payload['plan_id'] as string) : null
          if (planId) await d.entregarArtefatosPlano(planId, owner.chatId).catch(() => {})
        }
      }
      else { await d.falhouOuRequeue(n.id, n.tentativas + 1); out.falhas++ }
    } catch (err) {
      console.warn('[proativo/dispatcher] notificação falhou (fail-open):', err)
      try { await d.falhouOuRequeue(n.id, n.tentativas + 1) } catch {  }
      out.falhas++
    }
  }
  return out
}

export interface ProativoHeartbeatResultado extends PassResultado {
  revividas: number
  
  skipped?: 'em_curso'
  
  briefing: ResultadoDoBriefing
}







async function varrerLembretes(d: DispatchDeps): Promise<void> {
  try {
    const tz = await d.getTz()
    for (const l of await d.listVencidos(d.now())) {
      
      
      
      
      
      
      
      
      const novo = l.recorrencia
        ? proximaOcorrenciaAte(l.due_at, l.recorrencia, l.dia_ancora, tz, l.termina_em, d.now())
        : null
      const { titulo, corpo } = corpoDoLembrete({
        texto: l.texto, dueAtIso: l.due_at, tz, contexto: l.contexto,
        
        
        ultimoDaSerie: Boolean(l.recorrencia && l.termina_em && novo === null),
      })
      await d.inserirNotificacao({
        tipo: 'lembrete', urgencia: 'imediata',
        titulo, corpo,
        
        
        dedupKey: `lembrete:${l.id}:${l.due_at}`,
      })
      
      
      
      if (novo !== null) await d.reagendarFn(l.id, novo)
      else await d.marcarDisparado(l.id)
    }
  } catch (e) { console.warn('[proativo/heartbeat] lembretes fail-open:', e) }
}


export async function montarBriefingAgora(deps?: DispatchDeps): Promise<string> {
  const d = deps ?? (await defaultDispatchDeps())
  const [prefs, tz, pendentes] = await Promise.all([d.getPrefs(), d.getTz(), d.listPendentes()])
  const doBriefing = pendentes.filter((n) => decidir(n, prefs, d.now(), tz) === 'segurar_pro_briefing')
  return montarBriefingPush({
    narrativa: await d.getNarrativa(),
    digest: doBriefing.map((n) => ({ tipo: n.tipo, titulo: n.titulo })),
    aprovacoesAbertas: await d.listAprovacoesAbertas(),
    
    gastoDoDiaUsd: await d.getGastoDoDiaUsd().catch((e) => { console.warn('[proativo] getGastoDoDiaUsd falhou (fail-open; omite a linha):', e); return undefined }),
  })
}








async function runBriefingPush(d: DispatchDeps): Promise<ResultadoDoBriefing> {
  try {
    
    
    const [{ horaAlvo, lastDate }, tz, prefs] = await Promise.all([d.getBriefingState(), d.getTz(), d.getPrefs()])
    if (deveBriefarAgora(d.now(), tz, horaAlvo, lastDate, prefs.quietHours)) {
      const owner = await d.getOwner()
      if (owner) {
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        const pertoDoSilencio = minutosAteQuietComecar(d.now(), tz, prefs.quietHours) <= PERTO_DO_QUIET_MIN
        const ultimaChecagem = await d.getUltimaChecagem()
        if (!pertoDoSilencio && ultimaChecagem && Date.parse(d.now()) - Date.parse(ultimaChecagem) < CHECAGEM_MIN_INTERVALO_MS) return 'freio_de_checagem'
        try { await d.setUltimaChecagem(d.now()) }
        catch (e) { console.warn('[proativo/heartbeat] marcar checagem falhou (fail-open; próximo tique reavalia de novo):', e) }

        
        
        
        
        
        const pendentes = await d.listPendentes()
        const candidatosBriefing = pendentes.filter((n) => decidir(n, prefs, d.now(), tz) === 'segurar_pro_briefing')

        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        let insumos: NarrativeInput
        try {
          insumos = await d.getInsumosDaNarrativa()
        } catch (e) {
          console.warn('[proativo/heartbeat] getInsumosDaNarrativa falhou (o briefing NÃO sai neste tique; lastDate não é marcado, o próximo tique tenta de novo):', e)
          return 'insumos_falharam'
        }
        const leituraFalhou = (insumos.leiturasFalharam?.length ?? 0) > 0
        const { temAlgoADizer } = await import('@/server/briefing/narrative')
        if (!leituraFalhou && candidatosBriefing.length === 0 && !temAlgoADizer(insumos)) return 'sem_noticia'

        const doBriefing: NotificacaoRow[] = []
        for (const n of candidatosBriefing) {
          const claimed = await d.claim(n.id)
          if (claimed) doBriefing.push(claimed) 
        }
        const texto = montarBriefingPush({
          
          
          narrativa: await d.gerarNarrativaDeInsumos(insumos),
          digest: doBriefing.map((n) => ({ tipo: n.tipo, titulo: n.titulo })),
          aprovacoesAbertas: await d.listAprovacoesAbertas(),
          
          
          gastoDoDiaUsd: await d.getGastoDoDiaUsd().catch((e) => { console.warn('[proativo/heartbeat] getGastoDoDiaUsd falhou (fail-open; omite a linha):', e); return undefined }),
        })
        
        
        const r = await d.enviar(owner.chatId, mdParaHtmlTelegram(texto))
        if (r.ok) {
          
          
          
          const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(d.now()))
          for (const n of doBriefing) {
            try { await d.marcarStatus(n.id, 'agrupada_no_briefing') }
            catch (e) { console.warn('[proativo/heartbeat] marcarStatus falhou pós-briefing (linha pode reaparecer no digest):', e) }
          }
          try { await d.setBriefingLast(hoje) }
          catch (e) { console.warn('[proativo/heartbeat] setBriefingLast falhou pós-briefing (caminho 3: próximo tick pode duplicar narrativa):', e) }
          
          
          for (const n of doBriefing) {
            if (n.tipo === 'plano_concluido') {
              const planId = typeof n.payload?.['plan_id'] === 'string' ? (n.payload['plan_id'] as string) : null
              if (planId) await d.entregarArtefatosPlano(planId, owner.chatId).catch(() => {})
            } else if (n.tipo === 'tarefa_concluida') {
              const taskId = typeof n.payload?.['task_id'] === 'string' ? (n.payload['task_id'] as string) : null
              if (taskId) await d.entregarArtefatosTarefa(taskId, owner.chatId).catch(() => {})
            }
          }
          return 'enviado'
        } else {
          for (const n of doBriefing) await d.falhouOuRequeue(n.id, n.tentativas) 
          return 'envio_falhou'
        }
      }
      return 'sem_canal'
    }
    return 'fora_da_hora'
  } catch (e) {
    console.warn('[proativo/heartbeat] briefing fail-open:', e)
    return 'braco_falhou'
  }
}






let passeEmCurso = false

export async function runProativoHeartbeat(deps?: DispatchDeps): Promise<ProativoHeartbeatResultado> {
  if (passeEmCurso) {
    return { enviadas: 0, seguradas: 0, suprimidas: 0, falhas: 0, revividas: 0, skipped: 'em_curso', briefing: 'nao_rodou' }
  }
  passeEmCurso = true
  try {
    return await executarProativoHeartbeat(deps)
  } finally {
    passeEmCurso = false
  }
}

async function executarProativoHeartbeat(deps?: DispatchDeps): Promise<ProativoHeartbeatResultado> {
  const d = deps ?? (await defaultDispatchDeps())
  let revividas = 0
  
  
  
  try {
    const cutoff = new Date(Date.parse(d.now()) - COLD_MS).toISOString()
    for (const n of await d.listCold(cutoff)) { await d.falhouOuRequeue(n.id, n.tentativas); revividas++ }
  } catch (e) { console.warn('[proativo/heartbeat] cold fail-open:', e) }
  
  await varrerLembretes(d)
  
  const briefing = await runBriefingPush(d)
  const pass = await runDispatchPass(d)
  return { ...pass, revividas, briefing }
}
