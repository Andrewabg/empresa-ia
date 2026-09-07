import {
  avisoDeSemCanal,
  avisosParaOPainel,
  restantesNoPainel,
  type AvisoPreso,
} from '@/lib/proativo/destinoDoAviso'


export function SemCanalBanner({
  desdeIso,
  agoraIso,
  presos = [],
  total,
}: {
  desdeIso: string
  agoraIso: string
  presos?: readonly AvisoPreso[]
  
  total?: number
}) {
  const { mostrados, restantes } = avisosParaOPainel(presos, total ?? presos.length)
  const sobra = restantesNoPainel(restantes)
  return (
    <div
      role="alert"
      style={{
        margin: '0 0 16px',
        padding: '11px 16px',
        fontSize: 13,
        lineHeight: 1.55,
        color: 'var(--text-secondary)',
        background: 'var(--surface)',
        border: '1px solid var(--border-hairline)',
        borderLeft: '2px solid var(--reject)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <p style={{ margin: 0 }}>{avisoDeSemCanal(desdeIso, agoraIso)}</p>
      {mostrados.length > 0 && (
        <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
          {mostrados.map((a, i) => (
            <li
              key={`${a.created_at}:${i}`}
              style={{
                paddingLeft: 12,
                borderLeft: '1px solid var(--border-hairline)',
              }}
            >
              <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{a.titulo}</strong>
              {a.corpo ? (
                <span style={{ display: 'block', marginTop: 2 }}>{a.corpo}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {sobra ? <p style={{ margin: '10px 0 0' }}>{sobra}</p> : null}
    </div>
  )
}
