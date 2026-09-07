


import type { CausaCriativo } from '@/lib/trafego/criativo'

export interface ObjetivoRuiParaTeoInput {
  diagnostico: string
  nomeAnuncio?: string
  
  criativo?: { tipo: 'imagem' | 'video'; descricao: string }
  
  causa?: CausaCriativo
}


const DIRECAO_POR_CAUSA: Partial<Record<CausaCriativo, string>> = {
  hook: 'O problema é o HOOK: refaça os primeiros 3s / o thumbnail — é o topo do funil de atenção (o que para o scroll).',
  hold: 'O problema é o HOLD: refaça o corpo (3–10s) / o ritmo — prende no início mas perde no meio.',
  ctr_cta: 'O problema é o clique: reforce o CTA / a oferta visual — chama atenção mas não converte o interesse.',
}

export function objetivoRuiParaTeo({ diagnostico, nomeAnuncio, criativo, causa }: ObjetivoRuiParaTeoInput): string {
  const alvo = nomeAnuncio ? `O anúncio "${nomeAnuncio}"` : 'Um anúncio de tráfego'
  const linhas = [`${alvo} precisa de um criativo NOVO. Diagnóstico do Rui: ${diagnostico}.`]
  const direcao = causa ? DIRECAO_POR_CAUSA[causa] : undefined
  if (direcao) linhas.push(direcao)
  if (criativo && criativo.descricao.trim()) {
    const d = criativo.descricao.trim()
    linhas.push(criativo.tipo === 'imagem'
      ? `A arte atual é uma IMAGEM que mostra: ${d}. Crie um conceito NOVO — não repita esse visual.`
      : `O criativo atual é um VÍDEO. Transcrição: "${d}". Crie um conceito visual NOVO — não repita.`)
  }
  linhas.push('Produza um criativo novo (arte de meta-ad). Use as tools iniciarBriefing e gerarCriativo; não responda em texto.')
  return linhas.join(' ')
}
