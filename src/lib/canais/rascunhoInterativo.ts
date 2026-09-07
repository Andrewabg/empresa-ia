












export function textoDoRascunho(texto: string, corpoDasOpcoes: string | null): string {
  const dele = texto.trim()
  if (dele) return dele
  return (corpoDasOpcoes ?? '').trim()
}


export interface PlanoDeEnvioDoRascunho {
  
  enviarTexto: boolean
  
  corpoFinal: string | null
}


export function planoDeEnvioDoRascunho(args: {
  textoAprovado: string
  textoOriginal: string
  corpoDasOpcoes: string | null
}): PlanoDeEnvioDoRascunho {
  const corpo = (args.corpoDasOpcoes ?? '').trim()
  if (!corpo) return { enviarTexto: true, corpoFinal: null }
  const veioDasOpcoes = args.textoOriginal.trim() === corpo
  if (veioDasOpcoes) return { enviarTexto: false, corpoFinal: args.textoAprovado.trim() }
  return { enviarTexto: true, corpoFinal: corpo }
}
