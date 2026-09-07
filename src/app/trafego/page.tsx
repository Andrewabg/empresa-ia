
import { cookies } from 'next/headers'
import { requireOperator } from '@/server/auth/session'
import { getAgentRow } from '@/data/agents'
import { roomConversation, listMessages } from '@/data/messages'
import { listBlocos, getSnapshotsByIds } from '@/data/trafego'
import { listCrew } from '@/data/crew'
import { getLatestAccountMemory } from '@/data/accountMemory'
import { checkMetaReadHealth, type MetaHealth } from '@/server/config/metaHealth'
import { TrafegoClient } from './TrafegoClient'
import type { ChatMessage } from '../conversa/useChatStream'
import type { NotaCitada } from '@/server/tools/buscarCerebro'
import type { PainelBlocoComDados } from '@/components/trafego/PainelCanvas'
import type { MetricShape } from '@/lib/trafego/types'
import type { CrewMember } from '@/data/crew'
import type { AccountMemory } from '@/lib/trafego/accountMemory'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Tráfego',
  description: 'Painel de tráfego do Rui — leitura do Meta Ads e diagnóstico.',
}

const AGENT_ID = 'gestor-trafego'

export default async function TrafegoPage() {
  const cookieStore = await cookies()
  const operator = await requireOperator(cookieStore)

  
  
  
  
  const [agentRow, blocoRows, crew, accountMemory, metaHealth] = await Promise.all([
    getAgentRow(AGENT_ID),
    listBlocos(operator.id, AGENT_ID),
    listCrew().catch((e: unknown) => {
      console.warn('[/trafego] listCrew falhou (fail-open):', e)
      return [] as CrewMember[]
    }),
    getLatestAccountMemory(operator.id).catch((e: unknown) => {
      console.warn('[/trafego] getLatestAccountMemory falhou (fail-open):', e)
      return null as { accountId: string; mem: AccountMemory } | null
    }),
    checkMetaReadHealth().catch((e: unknown) => {
      console.warn('[/trafego] checkMetaReadHealth falhou (fail-open):', e)
      return 'expired' as MetaHealth
    }),
  ])

  const agentInstalled = !!agentRow && agentRow.enabled
  const agentName = agentRow?.name ?? 'Rui'

  
  
  let conversationId: string | null = null
  const snapIds = blocoRows.map((b) => b.snapshot_id).filter((id): id is string => !!id)
  const roomP: Promise<Awaited<ReturnType<typeof listMessages>>> = agentInstalled
    ? roomConversation(operator.id, AGENT_ID).then((conv) => {
        conversationId = conv.id
        return listMessages(conv.id)
      })
    : Promise.resolve([])
  const [rows, snaps] = await Promise.all([roomP, getSnapshotsByIds(operator.id, snapIds)])

  const initialMessages: ChatMessage[] = []
  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue
    const citations = extractCitations(row.tool_payload)
    initialMessages.push({
      id: row.id,
      role: row.role,
      content: row.content ?? '',
      ...(citations ? { citations } : {}),
    })
  }

  
  const snapById = new Map(snaps.map((s) => [s.id, s]))
  const initialBlocos: PainelBlocoComDados[] = blocoRows.map((b) => {
    const snap = b.snapshot_id ? snapById.get(b.snapshot_id) : undefined
    return {
      id: b.id,
      type: b.type,
      config: b.config,
      snapshot_id: b.snapshot_id,
      annotation: b.annotation,
      position: b.position,
      status: b.status,
      ...(snap ? { metrics: snap.metrics as MetricShape } : {}),
    }
  })

  return (
    <TrafegoClient
      key={AGENT_ID}
      agentId={AGENT_ID}
      agentName={agentName}
      agentInstalled={agentInstalled}
      vozDesligada={agentRow?.voz_desligada ?? false}
      initialMessages={initialMessages}
      initialConversationId={conversationId}
      initialBlocos={initialBlocos}
      crew={crew}
      accountMemory={accountMemory}
      metaHealth={metaHealth}
    />
  )
}


function extractCitations(toolPayload: unknown): NotaCitada[] | undefined {
  if (!toolPayload || typeof toolPayload !== 'object') return undefined
  const notes = (toolPayload as { citations?: unknown }).citations
  if (Array.isArray(notes) && notes.length) return notes as NotaCitada[]
  return undefined
}
