
export type StatusMensagem =
  'recebida' | 'rascunho' | 'enviada' | 'entregue' | 'lida' | 'falhou' | 'descartada'
export type StatusMetaEntrega = 'sent' | 'delivered' | 'read' | 'failed'

const JANELA_MS = 24 * 60 * 60 * 1000


export function podeEnviarLivre(ultimaMsgInAt: string | null, agoraIso: string): boolean {
  if (!ultimaMsgInAt) return false
  return Date.parse(agoraIso) - Date.parse(ultimaMsgInAt) < JANELA_MS
}


export function precisaJanela(janela24h: boolean, ultimaMsgInAt: string | null, agora: string): boolean {
  return janela24h ? !podeEnviarLivre(ultimaMsgInAt, agora) : false
}

const ORDEM: Partial<Record<StatusMensagem, number>> = { enviada: 1, entregue: 2, lida: 3 }


export function aplicarStatusEntrega(atual: StatusMensagem, evento: StatusMetaEntrega): StatusMensagem {
  const pos = ORDEM[atual]
  if (pos === undefined) return atual
  if (evento === 'failed') return 'falhou'
  const alvo: StatusMensagem = evento === 'read' ? 'lida' : evento === 'delivered' ? 'entregue' : 'enviada'
  return (ORDEM[alvo] ?? 0) > pos ? alvo : atual
}
