

export function normalizarTelefone(id: string | null | undefined): string | null {
  if (!id) return null
  if (id.includes('@lid')) return null 
  const semSufixo = id.split('@')[0]
  const digitos = semSufixo.replace(/\D/g, '')
  return digitos.length >= 8 ? digitos : null 
}

const DDI_BR = '55'


function variantesBr(digitos: string): string[] {
  const formas = [digitos]
  if (digitos.startsWith(DDI_BR) && digitos.length === 13) {
    const local = digitos.slice(4)
    if (local.startsWith('9')) formas.push(digitos.slice(0, 4) + local.slice(1))
  } else if (digitos.startsWith(DDI_BR) && digitos.length === 12) {
    const local = digitos.slice(4)
    if (/^[6-9]/.test(local)) formas.push(digitos.slice(0, 4) + '9' + local)
  }
  return formas
}


export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizarTelefone(a)
  const nb = normalizarTelefone(b)
  if (!na || !nb) return false
  for (const va of variantesBr(na)) {
    for (const vb of variantesBr(nb)) {
      if (va === vb) return true
      if (va.length >= 8 && vb.endsWith(va)) return true
      if (vb.length >= 8 && va.endsWith(vb)) return true
    }
  }
  return false
}
