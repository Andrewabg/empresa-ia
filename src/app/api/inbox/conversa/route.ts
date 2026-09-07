
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { requireOperatorApi } from '@/server/auth/apiAuth'
import { getConversa, setConversaStatus, cancelarProximaAcao, type ConversaStatus } from '@/data/conversasExternas'

const ACOES = ['assumir', 'devolver', 'fechar', 'cancelar_followup'] as const
type Acao = typeof ACOES[number]

const STATUS_MAP: Record<Exclude<Acao, 'cancelar_followup'>, ConversaStatus> = {
  assumir: 'assumida',
  devolver: 'aberta',
  fechar: 'fechada',
}

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const auth = await requireOperatorApi(cookieStore)
  if (auth instanceof Response) return auth

  
  let conversaId = ''
  let acao: Acao | '' = ''
  try {
    const body = (await request.json().catch(() => ({}))) as { conversaId?: unknown; acao?: unknown }
    if (typeof body.conversaId === 'string') conversaId = body.conversaId.trim()
    if (typeof body.acao === 'string' && (ACOES as readonly string[]).includes(body.acao)) acao = body.acao as Acao
  } catch {
    
  }
  if (!conversaId || !acao) return NextResponse.json({ ok: false, reason: 'bad_request' as const }, { status: 400 })

  try {
    const conversa = await getConversa(conversaId)
    if (!conversa) return NextResponse.json({ ok: false, reason: 'bad_request' as const }, { status: 400 })
    if (acao === 'cancelar_followup') {
      await cancelarProximaAcao(conversa.id)
      return NextResponse.json({ ok: true })
    }
    await setConversaStatus(conversa.id, STATUS_MAP[acao])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/inbox/conversa]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
