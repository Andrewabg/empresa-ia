


export const IDENTITY_MARKER = 'Este é o seu nome atual e vale sobre qualquer outro'


function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}


function regexDoNome(nome: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaparRegex(nome)}(?![\\p{L}\\p{N}_])`, 'gu')
}


export function renomearNaPersona(prompt: string, de: string, para: string): string {
  const origem = de.trim()
  const destino = para.trim()
  if (!origem || !destino || origem === destino) return prompt
  return prompt.replace(regexDoNome(origem), () => destino)
}


function mencionaNome(texto: string, nome: string): boolean {
  return regexDoNome(nome).test(texto)
}


export function personaWithIdentity(base: string, nome: string): string {
  const n = nome.trim()
  if (!n) return base
  if (base.includes(IDENTITY_MARKER)) return base
  if (mencionaNome(base, n)) return base
  return `Seu nome é ${n}. ${IDENTITY_MARKER} nome que apareça no texto abaixo: se alguma linha te chamar por outro nome, ela está desatualizada — o operador te renomeou. Apresente-se, assine e se refira a si mesmo SEMPRE como ${n}, tanto por escrito quanto falando.

${base}`
}
