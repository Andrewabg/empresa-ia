import { serverDb } from '../server/supabase'
import type { BlocoType } from '../lib/trafego/types'

export interface SnapshotRow {
  id: string
  operator_id: string
  source: string
  level: 'account' | 'campaign' | 'adset' | 'ad'
  entity_id: string
  entity_name: string | null
  period_start: string
  period_end: string
  metrics: Record<string, unknown>
  fetched_at: string
  
  granularity?: 'day' | 'window'
}

export interface BlocoRow {
  id: string
  operator_id: string
  agent_id: string
  type: BlocoType
  config: Record<string, unknown>
  snapshot_id: string | null
  annotation: string | null
  position: number
  status: 'active' | 'done'
  created_at: string
  updated_at: string
}


export async function createSnapshot(
  input: Omit<SnapshotRow, 'id' | 'fetched_at'>,
): Promise<SnapshotRow> {
  const { data, error } = await serverDb()
    .from('metric_snapshots')
    .insert({
      operator_id: input.operator_id,
      source: input.source,
      level: input.level,
      entity_id: input.entity_id,
      entity_name: input.entity_name ?? null,
      period_start: input.period_start,
      period_end: input.period_end,
      metrics: input.metrics ?? {},
    })
    .select()
    .single()
  if (error) throw new Error(`createSnapshot: ${error.message}`)
  return data as SnapshotRow
}


export async function listLatestSnapshots(
  operatorId: string,
  level: SnapshotRow['level'],
  limit = 20,
  granularity: 'day' | 'window' = 'window',
): Promise<SnapshotRow[]> {
  const { data, error } = await serverDb()
    .from('metric_snapshots')
    .select()
    .eq('operator_id', operatorId)
    .eq('level', level)
    .eq('granularity', granularity)
    .order('fetched_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listLatestSnapshots: ${error.message}`)
  return (data ?? []) as SnapshotRow[]
}


export async function getUltimoSnapshotDaEntidade(
  operatorId: string,
  level: SnapshotRow['level'],
  entityId: string,
): Promise<SnapshotRow | null> {
  const { data, error } = await serverDb()
    .from('metric_snapshots')
    .select()
    .eq('operator_id', operatorId)
    .eq('level', level)
    .eq('entity_id', entityId)
    .order('fetched_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`getUltimoSnapshotDaEntidade: ${error.message}`)
  return ((data ?? [])[0] as SnapshotRow | undefined) ?? null
}


export async function listDailySnapshots(
  operatorId: string,
  level: SnapshotRow['level'],
  sinceISO: string,
  untilISO: string,
  entityId?: string,
): Promise<SnapshotRow[]> {
  let query = serverDb()
    .from('metric_snapshots')
    .select()
    .eq('operator_id', operatorId)
    .eq('level', level)
    .eq('granularity', 'day')
    .gte('period_start', sinceISO)
    .lte('period_start', untilISO)
  if (entityId) query = query.eq('entity_id', entityId)
  const { data, error } = await query.order('period_start', { ascending: true })
  if (error) throw new Error(`listDailySnapshots: ${error.message}`)
  return (data ?? []) as SnapshotRow[]
}


export async function listOperadoresComTrafego(desdeISO: string): Promise<string[]> {
  const { data, error } = await serverDb().from('metric_snapshots')
    .select('operator_id').eq('level', 'account').eq('granularity', 'day').gte('period_start', desdeISO)
  if (error) throw new Error(`listOperadoresComTrafego: ${error.message}`)
  return [...new Set((data ?? []).map((r) => (r as { operator_id: string }).operator_id))]
}


export async function upsertDailySnapshot(
  input: Omit<SnapshotRow, 'id' | 'fetched_at' | 'granularity'>,
): Promise<void> {
  const db = serverDb()
  const { data: existing } = await db
    .from('metric_snapshots')
    .select('id')
    .eq('operator_id', input.operator_id)
    .eq('source', input.source)
    .eq('level', input.level)
    .eq('entity_id', input.entity_id)
    .eq('period_start', input.period_start)
    .eq('granularity', 'day')
    .maybeSingle()
  if (existing) {
    const { error } = await db
      .from('metric_snapshots')
      .update({
        metrics: input.metrics ?? {},
        entity_name: input.entity_name ?? null,
        period_end: input.period_end,
        fetched_at: new Date().toISOString(),
      })
      .eq('id', (existing as { id: string }).id)
    if (error) throw new Error(`upsertDailySnapshot(update): ${error.message}`)
  } else {
    const { error } = await db
      .from('metric_snapshots')
      .insert({ ...input, granularity: 'day' })
    if (error) throw new Error(`upsertDailySnapshot(insert): ${error.message}`)
  }
}


export async function getSnapshotsByIds(
  operatorId: string,
  ids: string[],
): Promise<SnapshotRow[]> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (unique.length === 0) return []
  const { data, error } = await serverDb()
    .from('metric_snapshots')
    .select()
    .eq('operator_id', operatorId)
    .in('id', unique)
  if (error) throw new Error(`getSnapshotsByIds: ${error.message}`)
  return (data ?? []) as SnapshotRow[]
}


export async function upsertBloco(
  input: Partial<BlocoRow> & { operator_id: string; type: BlocoType },
): Promise<BlocoRow> {
  const db = serverDb()
  if (input.id) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.agent_id !== undefined) patch.agent_id = input.agent_id
    if (input.type !== undefined) patch.type = input.type
    if (input.config !== undefined) patch.config = input.config
    if (input.snapshot_id !== undefined) patch.snapshot_id = input.snapshot_id
    if (input.annotation !== undefined) patch.annotation = input.annotation
    if (input.position !== undefined) patch.position = input.position
    if (input.status !== undefined) patch.status = input.status
    const { data, error } = await db
      .from('painel_blocos')
      .update(patch)
      .eq('id', input.id)
      .eq('operator_id', input.operator_id)
      .select()
      .single()
    if (error) throw new Error(`upsertBloco(update): ${error.message}`)
    return data as BlocoRow
  }
  const { data, error } = await db
    .from('painel_blocos')
    .insert({
      operator_id: input.operator_id,
      agent_id: input.agent_id ?? 'gestor-trafego',
      type: input.type,
      config: input.config ?? {},
      snapshot_id: input.snapshot_id ?? null,
      annotation: input.annotation ?? null,
      position: input.position ?? 0,
      status: input.status ?? 'active',
    })
    .select()
    .single()
  if (error) throw new Error(`upsertBloco(insert): ${error.message}`)
  return data as BlocoRow
}


export async function removeBloco(id: string, operatorId: string): Promise<void> {
  const { error } = await serverDb()
    .from('painel_blocos')
    .delete()
    .eq('id', id)
    .eq('operator_id', operatorId)
  if (error) throw new Error(`removeBloco: ${error.message}`)
}


export async function clearBlocos(operatorId: string, agentId: string): Promise<string[]> {
  const { data, error } = await serverDb()
    .from('painel_blocos')
    .delete()
    .eq('operator_id', operatorId)
    .eq('agent_id', agentId)
    .select('id')
  if (error) throw new Error(`clearBlocos: ${error.message}`)
  return (data ?? []).map((r) => (r as { id: string }).id)
}


export async function getBlocoById(operatorId: string, id: string): Promise<BlocoRow | null> {
  const { data, error } = await serverDb()
    .from('painel_blocos')
    .select()
    .eq('id', id)
    .eq('operator_id', operatorId)
    .maybeSingle()
  if (error) throw new Error(`getBlocoById: ${error.message}`)
  return (data as BlocoRow | null) ?? null
}


export async function listBlocos(operatorId: string, agentId: string): Promise<BlocoRow[]> {
  const { data, error } = await serverDb()
    .from('painel_blocos')
    .select()
    .eq('operator_id', operatorId)
    .eq('agent_id', agentId)
    .order('position', { ascending: true })
  if (error) throw new Error(`listBlocos: ${error.message}`)
  return (data ?? []) as BlocoRow[]
}


export async function setBlocoStatus(
  id: string,
  operatorId: string,
  status: 'active' | 'done',
): Promise<BlocoRow> {
  const { data, error } = await serverDb()
    .from('painel_blocos')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('operator_id', operatorId)
    .select()
    .single()
  if (error) throw new Error(`setBlocoStatus: ${error.message}`)
  return data as BlocoRow
}
