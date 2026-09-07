








const RETICENCIAS = '…'


const RE_PONTUACAO_FINAL = /[\s,;:.\-–—/|]+$/


export function encurtarTitulo(texto: string, max: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  if (max <= 0) return ''
  if (limpo.length <= max) return limpo
  if (max === 1) return RETICENCIAS

  
  const orcamento = max - RETICENCIAS.length
  const janela = limpo.slice(0, orcamento)
  const ultimoEspaco = janela.lastIndexOf(' ')
  
  
  const base = ultimoEspaco > 0 ? janela.slice(0, ultimoEspaco) : janela
  return base.replace(RE_PONTUACAO_FINAL, '') + RETICENCIAS
}
