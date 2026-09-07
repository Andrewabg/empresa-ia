
export interface BriefAberto { id: string; titulo: string; pendentes: string[] }

export function designBriefsDirective(briefs: BriefAberto[]): string {
  if (!briefs.length) return ''
  const linhas = briefs.map((b) => {
    const falta = b.pendentes.length ? ` — ainda falta: ${b.pendentes.join(', ')}` : ' — pronto pra gerar'
    return `- "${b.titulo}" (pecaId ${b.id})${falta}`
  }).join('\n')
  return [
    'BRIEF(S) EM ABERTO (peça aguardando você gerar o anúncio):',
    linhas,
    'Conduza o briefing: pergunte UMA lacuna por vez, calorosa, e grave a resposta com `atualizarBrief` (pecaId + o campo). Quando o operador mandar gerar (e o essencial estiver preenchido), chame `gerarCriativo` com o pecaId ACIMA — não pergunte qual.',
  ].join('\n')
}
