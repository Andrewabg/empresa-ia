
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { requireOperator } from '@/server/auth/session'
import { getAgentRow, listAgentsSummary } from '@/data/agents'
import { listCanais } from '@/data/canais'
import { roomConversation, listMessages } from '@/data/messages'
import { listTasksByAgent, type TaskListRow } from '@/data/tasks'
import { listArtifactsByAgent } from '@/data/artifacts'
import { listPending } from '@/data/approvals'
import { getDirectives } from '@/data/agentDirectives'
import { checkToolkitConnections } from '@/server/config/connections'
import { displayName } from '@/server/config/toolkitRegistry'
import { canonicalSlug } from '@/lib/brain-nav'
import { cockpitHref } from '@/lib/cockpit'
import { missaoCurta } from '@/lib/workspace/missao'
import type { ChatMessage } from '../../conversa/useChatStream'
import { AgenteWorkspaceClient, type EntregaView, type AprovacaoView, type IntegracaoView, type DiretrizView } from './AgenteWorkspaceClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Estação de trabalho',
  description: 'Workspace do agente.',
}

export default async function AgenteWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params
  
  let agentId: string
  try { agentId = decodeURIComponent(rawId) } catch { notFound() }

  const cookieStore = await cookies()
  const operator = await requireOperator(cookieStore)

  const agentRow = await getAgentRow(agentId)
  if (!agentRow) notFound()

  
  if (agentRow.is_primary) redirect('/conversa')
  const canais = await listCanais().catch(() => [] as Awaited<ReturnType<typeof listCanais>>)
  const temCanal = canais.some((c) => c.enabled && canonicalSlug(c.agent_id) === canonicalSlug(agentId))
  const bespoke = cockpitHref(agentRow.tools, temCanal)
  if (bespoke) redirect(bespoke)

  
  const conversation = await roomConversation(operator.id, agentId)

  
  const [msgsR, tasksR, artsR, pendR, dirR, connR, rosterR] = await Promise.allSettled([
    listMessages(conversation.id),
    listTasksByAgent(agentId, 8), 
    listArtifactsByAgent(agentId),
    listPending(),
    getDirectives(agentId),
    checkToolkitConnections(),
    
    agentRow.manager_id ? listAgentsSummary() : Promise.resolve([] as Awaited<ReturnType<typeof listAgentsSummary>>),
  ])
  const warn = (nome: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === 'rejected') console.warn(`[/agente/${agentId}] ${nome} falhou (fail-open):`, r.reason)
  }
  warn('listMessages', msgsR); warn('listTasksByAgent', tasksR); warn('listArtifactsByAgent', artsR)
  warn('listPending', pendR); warn('getDirectives', dirR); warn('checkToolkitConnections', connR)
  warn('listAgentsSummary', rosterR)

  const initialMessages: ChatMessage[] = []
  if (msgsR.status === 'fulfilled') {
    for (const row of msgsR.value) {
      if (row.role !== 'user' && row.role !== 'assistant') continue
      initialMessages.push({ id: row.id, role: row.role, content: row.content ?? '' })
    }
  }

  const tarefas: TaskListRow[] = tasksR.status === 'fulfilled' ? tasksR.value : []

  const entregas: EntregaView[] =
    artsR.status === 'fulfilled'
      ? artsR.value.map((a) => ({ id: a.id, kind: a.kind, title: a.title, created_at: a.created_at }))
      : []

  const slugCanon = canonicalSlug(agentId)
  const aprovacoes: AprovacaoView[] =
    pendR.status === 'fulfilled'
      ? pendR.value
          .filter((a) => canonicalSlug(a.agent ?? 'jarvis') === slugCanon)
          .map((a) => ({ id: a.id, kind: a.kind, title: a.title }))
      : []

  const diretrizes: DiretrizView[] =
    dirR.status === 'fulfilled'
      ? dirR.value.diretrizes.map((d) => ({ texto: d.texto, origem: d.origem, at: d.at }))
      : []

  
  const desejadas = [
    ...new Set([...(agentRow.tools.composio_toolkits ?? []), ...(agentRow.tools.required_toolkits ?? [])]),
  ].sort()
  const report = connR.status === 'fulfilled' ? connR.value : null
  const integracoes: IntegracaoView[] = desejadas.map((slug) => {
    const tk = report?.toolkits.find((t) => t.slug === slug)
    return {
      slug,
      name: tk?.name ?? displayName(slug),
      connected: tk?.connected ?? false,
      required: (agentRow.tools.required_toolkits ?? []).includes(slug),
    }
  })

  const gestorNome =
    rosterR.status === 'fulfilled'
      ? (rosterR.value.find((s) => s.id === agentRow.manager_id)?.name ?? null)
      : null

  return (
    <AgenteWorkspaceClient
      key={agentId}
      agentId={agentId}
      nome={agentRow.name}
      papel={agentRow.role}
      missao={missaoCurta(agentRow.system_prompt, agentRow.role)}
      ferias={!agentRow.enabled}
      gestorNome={gestorNome}
      initialMessages={initialMessages}
      initialConversationId={conversation.id}
      tarefas={tarefas}
      entregas={entregas}
      aprovacoes={aprovacoes}
      integracoes={integracoes}
      composioConfigured={report?.configured ?? false}
      diretrizes={diretrizes}
    />
  )
}
