
import { minutosLocais, dentroDoQuiet, type NotifPrefs } from './politica'

const ROTULO: Record<string, string> = {
  tarefa_concluida: 'Concluído', plano_concluido: 'Concluído',
  tarefa_falhou: 'Precisa de atenção', plano_falhou: 'Precisa de atenção',
  aprovacao: 'Aguardando você', atendimento_escalado: 'Atendimento', lembrete: 'Lembretes',
  prazo_juridico: 'Prazos',
}
const MAX_ITENS = 10

export interface BriefingPushInput {
  narrativa: string
  digest: { tipo: string; titulo: string }[]
  aprovacoesAbertas: string[]
  
  gastoDoDiaUsd?: number
}

export function montarBriefingPush(i: BriefingPushInput): string {
  const partes: string[] = [`☀️ ${i.narrativa}`]
  if (i.digest.length > 0) {
    const grupos = new Map<string, string[]>()
    for (const d of i.digest) {
      const g = ROTULO[d.tipo] ?? 'Outros'
      grupos.set(g, [...(grupos.get(g) ?? []), d.titulo])
    }
    for (const [rotulo, titulos] of grupos) {
      const mostra = titulos.slice(0, MAX_ITENS)
      const resto = titulos.length - mostra.length
      partes.push(`${rotulo}:\n${mostra.map((t) => `• ${t}`).join('\n')}${resto > 0 ? `\n• …e mais ${resto}` : ''}`)
    }
  }
  if (i.aprovacoesAbertas.length > 0) {
    partes.push(`⏳ Ainda aguardando sua aprovação:\n${i.aprovacoesAbertas.slice(0, MAX_ITENS).map((t) => `• ${t}`).join('\n')}`)
  }
  
  
  if (i.gastoDoDiaUsd !== undefined) {
    partes.push(`Gasto do dia com IA: US$ ${i.gastoDoDiaUsd.toFixed(2)}`)
  }
  return partes.join('\n\n')
}


export type ResultadoDoBriefing =
  | 'enviado'
  | 'sem_noticia'
  | 'fora_da_hora'
  | 'freio_de_checagem'
  | 'sem_canal'
  | 'insumos_falharam'
  | 'envio_falhou'
  | 'braco_falhou'
  | 'nao_rodou'

const RE_HORA_ALVO = /^([01]?\d|2[0-3]):[0-5]\d$/


export function deveBriefarAgora(
  agoraIso: string,
  tz: string,
  horaAlvo: string,
  lastDate: string | null,
  quietHours?: NotifPrefs['quietHours'],
): boolean {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(agoraIso))
  if (lastDate === hoje) return false
  if (dentroDoQuiet(agoraIso, tz, quietHours)) return false
  const horaEfetiva = RE_HORA_ALVO.test(horaAlvo) ? horaAlvo : '07:00'
  const [h, m] = horaEfetiva.split(':').map(Number)
  return minutosLocais(agoraIso, tz) >= h * 60 + m
}
