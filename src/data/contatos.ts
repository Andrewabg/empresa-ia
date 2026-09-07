import { serverDb } from '../server/supabase'
import type { CanalTipo } from './canais'
import type { FichaContato } from '@/lib/canais/ficha'
import { nomeAGravar } from '@/lib/canais/nomeDoContato'


export type ContatoTipo = CanalTipo

export interface ContatoRow {
  id: string; tipo: ContatoTipo; external_id: string; nome: string
  ficha: FichaContato; created_at: string; updated_at: string
}


export async function getOrCreateContato(
  input: { tipo: ContatoTipo; external_id: string; nome: string; nomeProprio?: string | null },
): Promise<ContatoRow> {
  const db = serverDb()
  const { nomeProprio, ...linha } = input
  const { data: found, error: e1 } = await db.from('contatos').select()
    .eq('tipo', linha.tipo).eq('external_id', linha.external_id).maybeSingle()
  if (e1) throw new Error(`getOrCreateContato: ${e1.message}`)
  if (found) {
    const nome = nomeAGravar((found as ContatoRow).nome ?? '', linha.nome, nomeProprio)
    if (nome !== null) {
      const { error: eUpdate } = await db.from('contatos').update({ nome, updated_at: new Date().toISOString() }).eq('id', found.id)
      if (eUpdate) throw new Error(`getOrCreateContato (nome): ${eUpdate.message}`)
      return { ...(found as ContatoRow), nome }
    }
    return found as ContatoRow
  }
  const { data, error } = await db.from('contatos').insert(linha).select().single()
  if (error) {
    if (error.code === '23505') return getOrCreateContato(input) 
    throw new Error(`getOrCreateContato: ${error.message}`)
  }
  return data as ContatoRow
}
export async function getContato(id: string): Promise<ContatoRow | null> {
  const { data, error } = await serverDb().from('contatos').select().eq('id', id).maybeSingle()
  if (error) throw new Error(`getContato: ${error.message}`)
  return (data as ContatoRow) ?? null
}
export async function updateFichaContato(id: string, ficha: FichaContato): Promise<void> {
  const { error } = await serverDb().from('contatos')
    .update({ ficha, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(`updateFichaContato: ${error.message}`)
}
