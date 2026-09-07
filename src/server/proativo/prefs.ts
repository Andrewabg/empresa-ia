

import { getSetting as getDefault, setSetting as setDefault } from '@/data/settings'
import type { NotifPrefs, PrefValor } from '@/lib/proativo/politica'
import { DEFAULTS_POR_TIPO } from '@/lib/proativo/politica'
import { TIPO_AVISO_LINT_ACERVO } from '@/lib/brain/lintDoAcervo'
import { TIPO_AVISO_ORIGEM_RECUSADA } from '@/server/brain/candidatasElegiveis'

export interface PrefsDeps { getSetting: typeof getDefault; setSetting: typeof setDefault }
export interface AjusteInput {
  porTipo?: Record<string, PrefValor>
  quietHours?: { inicio: string; fim: string }
  briefingHora?: string
  
  respostaVoz?: boolean
}
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

const VALORES_VALIDOS: PrefValor[] = ['imediata', 'briefing', 'off']

const TIPOS_SEM_DEFAULT = [TIPO_AVISO_LINT_ACERVO, TIPO_AVISO_ORIGEM_RECUSADA]
const TIPOS_VALIDOS = [...Object.keys(DEFAULTS_POR_TIPO), ...TIPOS_SEM_DEFAULT]

export async function aplicarAjusteNotificacoes(input: AjusteInput, deps?: PrefsDeps): Promise<{ ok: boolean; resumo: string }> {
  const d = deps ?? { getSetting: getDefault, setSetting: setDefault }
  
  const temAlgo = input.briefingHora || input.quietHours || input.respostaVoz !== undefined || (input.porTipo && Object.keys(input.porTipo).length > 0)
  if (!temAlgo) return { ok: true, resumo: 'Nada a ajustar.' }

  if (input.briefingHora && !RE_HORA.test(input.briefingHora)) return { ok: false, resumo: `Hora inválida: "${input.briefingHora}" (use HH:MM).` }
  if (input.quietHours && (!RE_HORA.test(input.quietHours.inicio) || !RE_HORA.test(input.quietHours.fim))) {
    return { ok: false, resumo: 'Quiet hours inválidas (use HH:MM).' }
  }
  
  
  if (input.porTipo) {
    const chavesInvalidas = Object.keys(input.porTipo).filter((k) => !TIPOS_VALIDOS.includes(k))
    if (chavesInvalidas.length > 0) {
      return { ok: false, resumo: `Tipo(s) desconhecido(s): ${chavesInvalidas.join(', ')}. Tipos válidos: ${TIPOS_VALIDOS.join(', ')}.` }
    }
    const valoresInvalidos = Object.entries(input.porTipo).filter(([, v]) => !VALORES_VALIDOS.includes(v))
    if (valoresInvalidos.length > 0) {
      return { ok: false, resumo: `Valor(es) inválido(s): ${valoresInvalidos.map(([k, v]) => `${k}="${v}"`).join(', ')}. Valores válidos: ${VALORES_VALIDOS.join(', ')}.` }
    }
    
    
    
    
    if ('aprovacao' in input.porTipo && input.porTipo.aprovacao !== 'imediata') {
      return { ok: false, resumo: 'Não posso silenciar nem adiar os avisos de APROVAÇÃO por aqui — é a sua supervisão. Se realmente quiser mudar isso, faça em /config.' }
    }
  }
  let atual: NotifPrefs = {}
  try { const raw = await d.getSetting('notificacao_prefs'); atual = raw ? JSON.parse(raw) : {} } catch {  }
  const novo: NotifPrefs = {
    ...atual,
    ...(input.porTipo ? { porTipo: { ...atual.porTipo, ...input.porTipo } } : {}),
    ...(input.quietHours ? { quietHours: input.quietHours } : {}),
    ...(input.respostaVoz !== undefined ? { respostaVoz: input.respostaVoz } : {}),
  }
  await d.setSetting('notificacao_prefs', JSON.stringify(novo))
  if (input.briefingHora) await d.setSetting('briefing_push_hora', input.briefingHora)
  const partes: string[] = []
  if (input.porTipo) partes.push(Object.entries(input.porTipo).map(([t, v]) => `${t} → ${v}`).join(', '))
  if (input.quietHours) partes.push(`silêncio ${input.quietHours.inicio}–${input.quietHours.fim}`)
  if (input.briefingHora) partes.push(`briefing às ${input.briefingHora}`)
  if (input.respostaVoz !== undefined) partes.push(`resposta em voz ${input.respostaVoz ? 'ligada' : 'desligada'}`)
  return { ok: true, resumo: `Ajustado: ${partes.join('; ')}.` }
}
