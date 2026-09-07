
import { AsyncLocalStorage } from 'node:async_hooks'
import type { PainelBlocoPatch } from '@/lib/trafego/types'
import type { EstudioPatch } from '@/lib/estudio/types'
import type { JuridicoPatch } from '@/lib/juridico/types'
import type { Papel } from '@/lib/equipe'
import type { RecusaDeAtoDeDono } from '@/lib/turno/papelDoTurno'
import type { NotaCitada } from '../tools/buscarCerebro'

export interface TurnContext {
  conversationId?: string | null
  
  conversaExternaId?: string | null
  actingAgentId?: string
  operatorId?: string
  
  papel?: Papel
  
  terceiroIngerido?: boolean
  
  recusasSemPessoa?: RecusaDeAtoDeDono[]
  
  taskId?: string
  
  falaDoDono?: string
  
  campanhaId?: string
  planoIndex?: number
  
  origemSolicitante?: string
  
  painelSink?: PainelBlocoPatch[]
  
  estudioSink?: EstudioPatch[]
  
  juridicoSink?: JuridicoPatch[]
  
  citationsSink?: NotaCitada[]
}

const storage = new AsyncLocalStorage<TurnContext>()


export function runWithTurnContext<T>(ctx: TurnContext, fn: () => Promise<T>): Promise<T> {
  const pai = storage.getStore()
  const terceiroIngerido = ctx.terceiroIngerido === true || pai?.terceiroIngerido === true
  return storage.run({ ...ctx, terceiroIngerido }, fn)
}

export function getTurnContext(): TurnContext {
  return storage.getStore() ?? {}
}


export function marcarTerceiroIngerido(): void {
  const atual = storage.getStore()
  if (atual) atual.terceiroIngerido = true
}
