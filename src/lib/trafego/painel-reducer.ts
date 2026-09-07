




import type { PainelBloco, PainelBlocoPatch } from '@/lib/trafego/types'


function ordenar(blocos: PainelBloco[]): PainelBloco[] {
  return [...blocos].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function applyPatch(state: PainelBloco[], patch: PainelBlocoPatch): PainelBloco[] {
  if (patch.op === 'remove') {
    const id = patch.bloco.id
    return ordenar(state.filter((b) => b.id !== id))
  }
  
  const exists = state.some((b) => b.id === patch.bloco.id)
  const next = exists
    ? state.map((b) => (b.id === patch.bloco.id ? patch.bloco : b))
    : [...state, patch.bloco]
  return ordenar(next)
}
