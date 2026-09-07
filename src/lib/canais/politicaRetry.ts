



import type { AcaoFalha } from './erroMeta'


export const RETRY_PADRAO_MS = 30_000


const PERMANENTES: ReadonlySet<AcaoFalha> = new Set<AcaoFalha>([
  'dead', 'exige_template', 'contato_inalcancavel', 'avisar_dono',
])

export type DecisaoRetry =
  | { tipo: 'dead'; motivo: string }
  | { tipo: 'requeue'; naoAntesIso: string; attempts: number; motivo: string }

export function decidirRetry(input: {
  
  acao?: AcaoFalha | null
  retryAfterMs?: number | null
  
  attempts: number
  maxAttempts: number
  agoraMs: number
}): DecisaoRetry {
  const { acao, retryAfterMs, attempts, maxAttempts, agoraMs } = input

  if (acao && PERMANENTES.has(acao)) {
    return { tipo: 'dead', motivo: `falha permanente no envio (${acao}) — re-tentar não resolve` }
  }
  if (attempts >= maxAttempts) {
    return { tipo: 'dead', motivo: 'processarConversa falhou repetidamente' }
  }

  const pedido = typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : null
  const espera = acao === 'backoff' && pedido !== null ? pedido : RETRY_PADRAO_MS
  return {
    tipo: 'requeue',
    naoAntesIso: new Date(agoraMs + espera).toISOString(),
    attempts,
    motivo: acao === 'backoff' ? `limite do provider — aguardando ${Math.round(espera / 1000)}s` : 'erro no processamento',
  }
}
