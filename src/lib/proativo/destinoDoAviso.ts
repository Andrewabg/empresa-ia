


export const CHAVE_SEM_CANAL = 'proativo_sem_canal_desde'


export const AVISO_LEMBRETE_SEM_CANAL =
  'Ainda não tenho por onde te avisar na hora, mas deixo o lembrete marcado: quando chegar a hora ele aparece no seu painel, e conectando o Telegram em Configuração o aviso passa a chegar direto no seu celular.'


export const AVISO_ROTINA_SEM_CANAL =
  'Ainda não tenho canal para te avisar na hora, mas crio a rotina mesmo assim: o resultado aparece em Tarefas. Conecte o Telegram em Configuração para o aviso chegar direto.'


export function temDestino(ownerRaw: string | null): boolean {
  if (!ownerRaw || !ownerRaw.trim()) return false
  try {
    const o = JSON.parse(ownerRaw) as { chatId?: unknown }
    return typeof o?.chatId === 'string' && o.chatId.trim().length > 0
  } catch {
    return false
  }
}


export const TETO_AVISOS_NO_PAINEL = 5


export interface AvisoPreso {
  titulo: string
  corpo: string
  created_at: string
}


export function avisosParaOPainel(
  presos: readonly AvisoPreso[],
  total: number = presos.length,
  teto: number = TETO_AVISOS_NO_PAINEL,
): { mostrados: AvisoPreso[]; restantes: number } {
  const limite = Number.isFinite(teto) && teto > 0 ? Math.floor(teto) : 0
  const mostrados = presos.slice(0, limite)
  
  
  const real = Number.isFinite(total) ? Math.max(total, mostrados.length) : mostrados.length
  return { mostrados, restantes: Math.max(0, real - mostrados.length) }
}


export function restantesNoPainel(restantes: number): string {
  if (!Number.isFinite(restantes) || restantes <= 0) return ''
  return restantes === 1
    ? 'E mais 1 aviso esperando.'
    : `E mais ${restantes} avisos esperando.`
}

const DIA_MS = 86_400_000


export function avisoDeSemCanal(desdeIso: string | null, agoraIso: string): string {
  const desde = desdeIso ? Date.parse(desdeIso) : NaN
  const agora = Date.parse(agoraIso)
  const dias = Number.isFinite(desde) && Number.isFinite(agora)
    ? Math.floor(Math.max(0, agora - desde) / DIA_MS)
    : null
  const quanto =
    dias === null ? 'Existem avisos esperando' :
    dias >= 2 ? `Existem avisos esperando há ${dias} dias` :
    dias === 1 ? 'Existem avisos esperando há 1 dia' :
    'Existem avisos esperando desde hoje'
  return `${quanto} e não tenho por onde te mandar. Conecte o Telegram em Configuração para receber lembretes, resultados de rotina e pedidos de aprovação.`
}
