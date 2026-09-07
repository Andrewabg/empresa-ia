'use client'



import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence } from 'motion/react'
import { ApprovalCard, type ApprovalDecision } from '@/components/cards/ApprovalCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { OfflineBanner } from '@/components/ui/OfflineBanner'
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton'
import { ToolErrorCard } from '@/components/cards/ToolErrorCard'
import { parseUxState } from '@/lib/uxState'
import { useApprovalAction } from './useApprovalAction'
import { formatarOrigem, type OrigemLabels } from '@/lib/aprovacoes/origem'
import { COPY_FALHA_GENERICA } from '@/lib/aprovacoes/falhaPermanente'
import { humanizarAto } from '@/lib/aprovacoes/humanizarAto'
import type { Approval } from '@/data/approvals'
import type { MockApproval } from '@/mock/types'







function montarLaunchArgs(args: Record<string, unknown> | null): MockApproval['launchArgs'] {
  const a = (args ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
  const headline = str(a.headline)
  return {
    message: str(a.message),
    ...(headline ? { headline } : {}),
    cta: str(a.cta),
    link: str(a.link),
    artifactId: str(a.artifactId),
  }
}


function montarAvisos(args: Record<string, unknown> | null): MockApproval['avisos'] {
  const raw = (args ?? {}) as Record<string, unknown>
  const lista = Array.isArray(raw.avisos) ? raw.avisos : []
  const out = lista
    .map((a) => {
      const o = (a ?? {}) as Record<string, unknown>
      const texto = typeof o.texto === 'string' ? o.texto.trim() : ''
      const tipo = typeof o.tipo === 'string' ? o.tipo : ''
      return texto ? { tipo, texto } : null
    })
    .filter((x): x is { tipo: string; texto: string } => x !== null)
  return out.length ? out : undefined
}

function toMockApproval(a: Approval, origem?: OrigemLabels): MockApproval {
  const base = {
    id: a.id,
    kind: a.kind,
    title: a.title ?? '(sem título)',
    agent: a.agent ?? 'jarvis',
    reason: a.reason ?? '',
    createdAt: a.created_at,
    
    origem: origem ? formatarOrigem(origem) ?? undefined : undefined,
  }

  
  
  
  
  if (a.kind === 'tool_action' || a.kind === 'directive' || a.kind === 'custom_tool') {
    const { principais, detalhes } = humanizarAto(a.action_slug, a.action_args)
    
    const semCampos = principais.length === 0 && detalhes.length === 0
    const principaisFinal =
      semCampos && a.action_slug ? [{ label: 'Ação', valor: a.action_slug }] : principais
    
    const ehLancamento =
      a.kind === 'tool_action' && a.action_slug === 'AWAVE_META_LAUNCH_CREATIVE'
    const launchArgs = ehLancamento ? montarLaunchArgs(a.action_args) : undefined
    
    const avisos = ehLancamento ? montarAvisos(a.action_args) : undefined
    return {
      ...base,
      kind: 'tool_action',
      action: {
        sentence: a.title ?? a.action_slug ?? '(ação sem descrição)',
        principais: principaisFinal,
        detalhes,
      },
      ...(launchArgs ? { launchArgs } : {}),
      ...(avisos ? { avisos } : {}),
    }
  }

  
  
  if (a.kind === 'plan') {
    return {
      ...base,
      kind: 'plan',
      diff: a.diff ?? '',
    }
  }

  
  
  
  return {
    ...base,
    kind: 'brain_pr',
    diff: a.diff ?? '',
    ...(a.pr_url ? { prUrl: a.pr_url } : {}),
    ...(a.path ? { path: a.path } : {}),
  }
}



function AllClearGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M3.5 9.5l3.5 3.5L14.5 5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}



function ApprovalSkeleton() {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-lg)',
        padding: 'clamp(20px, 2.4vw, 28px)',
      }}
      aria-label="Carregando aprovação"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Skeleton width={130} height={11} />
        <Skeleton width={48} height={11} />
      </div>
      <Skeleton width="64%" height={22} radius="var(--radius-sm)" style={{ marginBottom: 18 }} />
      <SkeletonText lines={3} lineHeight={13} gap={9} />
      <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
        <Skeleton width={104} height={34} radius="var(--radius-sm)" />
        <Skeleton width={104} height={34} radius="var(--radius-sm)" />
      </div>
    </div>
  )
}



interface AprovacoesBodyProps {
  initialApprovals: Approval[]
  origens: Record<string, OrigemLabels>
  
  ehDono: boolean
  
  nomesDeAgente?: Record<string, string>
}

function AprovacoesBody({ initialApprovals, origens, ehDono, nomesDeAgente }: AprovacoesBodyProps) {
  const params = useSearchParams()
  const ux = parseUxState(params.get('state'))
  const forcedEmpty = ux === 'empty'
  const loading = ux === 'loading'
  const error = ux === 'error'

  const router = useRouter()
  const { run } = useApprovalAction()

  const [items, setItems] = useState<Approval[]>(() =>
    forcedEmpty || loading ? [] : initialApprovals,
  )

  
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})

  
  
  const [tentativas, setTentativas] = useState<Record<string, number>>({})

  
  const [isOffline, setIsOffline] = useState(false)
  useEffect(() => {
    setIsOffline(!navigator.onLine)
    const onOnline = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  
  const nowRef = useRef<number>(Date.now())

  
  
  const inFlightRef = useRef<Set<string>>(new Set())

  function removeCard(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id))
    setCardErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setTentativas((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    inFlightRef.current.delete(id)
  }

  function setCardError(id: string, message: string) {
    setCardErrors((prev) => ({ ...prev, [id]: message }))
    inFlightRef.current.delete(id)
  }

  
  function remontarCard(id: string) {
    setTentativas((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
  }

  function clearCardError(id: string) {
    setCardErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  
  const handleResolved = useCallback(
    async (id: string, decision: ApprovalDecision, correcao?: string) => {
      if (inFlightRef.current.has(id)) return
      inFlightRef.current.add(id)

      
      clearCardError(id)

      
      
      const originalItem = items.find((a) => a.id === id)

      
      const { desfecho: outcome, mensagem } = await run(id, decision, correcao)

      if (outcome === 'needsConfig') {
        
        
        
        inFlightRef.current.delete(id)
        
        
        if (originalItem) {
          setItems((prev) => prev.find((a) => a.id === id) ? prev : [originalItem, ...prev])
        }
        router.push('/config')
        return
      }

      if (outcome === 'error') {
        
        
        
        if (originalItem) {
          setItems((prev) =>
            prev.find((a) => a.id === id) ? prev : [originalItem, ...prev],
          )
        }
        
        
        
        
        
        remontarCard(id)
        setCardError(id, mensagem ?? COPY_FALHA_GENERICA)
        return
      }

      
      removeCard(id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    
    
    
    [items, router, run],
  )

  
  const onEditLaunch = useCallback(
    async (id: string, fields: { message: string; headline?: string; cta: string; link: string }): Promise<boolean> => {
      try {
        const res = await fetch(`/api/approvals/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fields }),
        })
        if (!res.ok) return false
        setItems((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  action_args: {
                    ...(a.action_args ?? {}),
                    message: fields.message,
                    ...(fields.headline ? { headline: fields.headline } : {}),
                    cta: fields.cta,
                    link: fields.link,
                  },
                }
              : a,
          ),
        )
        return true
      } catch {
        return false
      }
    },
    [],
  )

  const mockItems = useMemo(() => items.map((a) => toMockApproval(a, origens[a.id])), [items, origens])
  const isEmpty = items.length === 0
  const pendingLabel = useMemo(() => {
    if (items.length === 0) return ''
    return items.length === 1 ? '1 pendência' : `${items.length} pendências`
  }, [items.length])

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: 'clamp(32px, 5vw, 64px) clamp(24px, 5vw, 48px) 96px',
      }}
    >
      {}
      {isOffline && <OfflineBanner />}

      {}
      <header style={{ marginBottom: 'clamp(28px, 4vw, 44px)' }}>
        <p
          style={{
            margin: 0,
            marginBottom: 8,
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
          }}
        >
          Aprovações
        </p>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(24px, 3vw, 32px)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Os freios, visíveis
          </h1>
          {!isEmpty && (
            <span
              style={{
                fontSize: 12.5,
                color: 'var(--text-tertiary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {pendingLabel}
            </span>
          )}
        </div>
        {!isEmpty && (
          <p
            style={{
              margin: 0,
              marginTop: 10,
              fontSize: 14,
              lineHeight: 1.55,
              color: 'var(--text-secondary)',
              maxWidth: 540,
            }}
          >
            Você é o portão humano. Veja o ato cru — o que de fato aconteceria — e decida com intenção.
          </p>
        )}
      </header>

      {}
      {loading ? (
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(16px, 2vw, 24px)' }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <ApprovalSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(16px, 2vw, 24px)' }}>
          <ToolErrorCard
            title="Erro ao processar aprovação"
            tool="GitHub · Serviço de aprovações"
            message="A ação não foi concluída. O cérebro não foi tocado — a aprovação permanece pendente e pode ser tentada de novo."
          />
          <AnimatePresence mode="popLayout" initial={false}>
            {mockItems.map((mock) => (
              <ApprovalCard
                key={mock.id}
                approval={mock}
                now={nowRef.current}
                onResolved={handleResolved}
                onEditLaunch={onEditLaunch}
                podeDecidir={ehDono}
                nomesDeAgente={nomesDeAgente}
              />
            ))}
          </AnimatePresence>
        </div>
      ) : isEmpty ? (
        
        <div
          style={{
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--surface)',
          }}
        >
          <EmptyState
            icon={<AllClearGlyph />}
            headline="Tudo em dia"
            sub="Nada precisa de você agora. O Nathan avisa quando uma decisão sua for necessária."
          />
        </div>
      ) : (
        
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(16px, 2vw, 24px)',
          }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {mockItems.map((mock) => {
              const err = cardErrors[mock.id]
              
              return (
                <div key={mock.id}>
                  {}
                  {err && (
                    <p
                      role="alert"
                      style={{
                        margin: 0,
                        marginBottom: 10,
                        padding: '9px 14px',
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: 'var(--text-secondary)',
                        background: 'var(--surface)',
                        border: '1px solid var(--border-hairline)',
                        borderLeft: '2px solid var(--reject)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {err}
                    </p>
                  )}
                  <ApprovalCard
                    
                    
                    key={`${mock.id}:${tentativas[mock.id] ?? 0}`}
                    approval={mock}
                    now={nowRef.current}
                    onResolved={handleResolved}
                    onEditLaunch={onEditLaunch}
                    podeDecidir={ehDono}
                    nomesDeAgente={nomesDeAgente}
                  />
                </div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}



interface AprovacoesClientProps {
  initialApprovals: Approval[]
  origens: Record<string, OrigemLabels>
  
  ehDono: boolean
  
  nomesDeAgente?: Record<string, string>
}

export function AprovacoesClient({ initialApprovals, origens, ehDono, nomesDeAgente }: AprovacoesClientProps) {
  return (
    <Suspense fallback={null}>
      <AprovacoesBody initialApprovals={initialApprovals} origens={origens} ehDono={ehDono} nomesDeAgente={nomesDeAgente} />
    </Suspense>
  )
}
