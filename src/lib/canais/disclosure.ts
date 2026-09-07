







export const REPETIR_APOS_DIAS = 30

export function disclosurePadrao(empresa: string): string {
  const nome = (empresa ?? '').trim()
  return nome
    ? `Oi! Sou o assistente virtual (IA) da ${nome}. Se preferir, é só pedir "falar com atendente" que eu chamo alguém do time.`
    : 'Oi! Sou o assistente virtual (IA) da empresa. Se preferir, é só pedir "falar com atendente" que eu chamo alguém do time.'
}


export function precisaDisclosure(input: {
  
  saidasNaConversa: number
  
  ultimaSaidaEm: string | null
  agora: string
  repetirAposDias?: number
}): boolean {
  if (input.saidasNaConversa <= 0) return true
  if (!input.ultimaSaidaEm) return true
  const t = Date.parse(input.ultimaSaidaEm)
  const agora = Date.parse(input.agora)
  
  
  if (!Number.isFinite(t) || !Number.isFinite(agora)) return false
  const dias = (agora - t) / 86_400_000
  return dias >= (input.repetirAposDias ?? REPETIR_APOS_DIAS)
}


const JA_SE_IDENTIFICA = /\b(sou (o |a )?(assistente|atendente) (virtual|de ia)|assistente virtual|sou uma ia|sou um rob[ôo])\b/i


export function aplicarDisclosure(bolhas: string[], linha: string | null): string[] {
  if (!linha || !linha.trim()) return bolhas
  if (!bolhas.length) return bolhas
  const primeira = bolhas[0] ?? ''
  if (JA_SE_IDENTIFICA.test(primeira)) return bolhas
  const juntas = `${linha.trim()}\n\n${primeira}`.trim()
  return [juntas, ...bolhas.slice(1)]
}
