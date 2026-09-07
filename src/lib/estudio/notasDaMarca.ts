











export interface NotaDaMarca {
  path: string
  titulo: string
  corpo: string
  tags: readonly string[]
}


export const LIMITE_CHARS_PADRAO = 60_000


export function escolherNotasDaMarca(
  notas: readonly NotaDaMarca[],
  tagsPrioritarias: readonly string[],
  limiteChars: number = LIMITE_CHARS_PADRAO,
): NotaDaMarca[] {
  const prioritarias = new Set(tagsPrioritarias)
  const peso = (n: NotaDaMarca) => (n.tags.some((t) => prioritarias.has(t)) ? 0 : 1)
  const ordenadas = [...notas]
    .filter((n) => n.corpo.trim())
    .sort((a, b) => peso(a) - peso(b) || a.path.localeCompare(b.path))
  const saida: NotaDaMarca[] = []
  let usados = 0
  for (const n of ordenadas) {
    const custo = n.titulo.length + n.corpo.length
    
    
    if (saida.length && usados + custo > limiteChars) break
    saida.push(n)
    usados += custo
  }
  return saida
}


export function renderNotasDaMarca(notas: readonly NotaDaMarca[]): string {
  return notas.map((n) => `## ${n.titulo}\n${n.corpo}`).join('\n\n').trim()
}
