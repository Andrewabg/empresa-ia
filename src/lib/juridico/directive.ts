
import type { FichaJuridica } from '@/lib/juridico/ficha'
import type { ContratoView } from '@/lib/juridico/types'
import { resumoParecer } from '@/lib/juridico/parecer'

export function fichaCoverage(f: FichaJuridica): { faltando: string[]; minDone: boolean } {
  const faltando: string[] = []
  if (!f.razaoSocial) faltando.push('razão social')
  if (!f.cnpj) faltando.push('CNPJ')
  if (!f.foro) faltando.push('foro de eleição')
  if (!f.representante) faltando.push('representante legal')
  return { faltando, minDone: !!f.razaoSocial && !!f.foro }
}


export function temFichaJuridica(f: FichaJuridica): boolean {
  return !!(f.razaoSocial || f.cnpj || f.foro || f.representante || f.endereco || f.posturas?.length || f.observacoes)
}


export function resumoMesa(cs: ContratoView[]): string {
  return cs.slice(0, 8)
    .map((c) => `- "${c.titulo}" (${c.tipo}, ${c.status}${c.parecer ? `, parecer: ${resumoParecer(c.parecer)}` : ''}) — id ${c.id}`)
    .join('\n')
}

export interface JuridicoDirectiveArgs {
  faltando: string[]
  temFicha: boolean
  mesa: string
  modelos: string
  
  foco?: { id: string; titulo: string } | null
}

export function juridicoDirective(a: JuridicoDirectiveArgs): string {
  const L: string[] = []
  
  if (a.foco) {
    L.push(
      `CONTRATO ABERTO NO PALCO AGORA: "${a.foco.titulo}" (id ${a.foco.id}). ` +
        'Quando o operador disser "esse/este contrato", "essa cláusula", "revisa isso", "finaliza", "salva como modelo" etc. SEM dizer qual, é ESTE — use este id na tool, NÃO pergunte qual. Só peça o id se ele claramente falar de outro contrato da Mesa.',
    )
  }
  if (!a.temFicha) {
    L.push('A Ficha Jurídica está vazia: conduza o ritual de abertura — chame ingerirFichaJuridica ANTES de perguntar, mostre o rascunho e pergunte só as lacunas.')
  } else if (a.faltando.length) {
    L.push(`Faltam na Ficha Jurídica: ${a.faltando.join(', ')} — pergunte com naturalidade quando fizer sentido.`)
  }
  if (a.mesa) L.push(`Mesa do escritório (contratos recentes — use o id nas tools):\n${a.mesa}`)
  if (a.modelos) L.push(`Modelos disponíveis:\n${a.modelos}`)
  return L.join('\n\n')
}
