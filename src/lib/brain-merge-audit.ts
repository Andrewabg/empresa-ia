

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()


export function mergeTrivialmenteAditivo(
  beforeBody: string | null | undefined,
  proposedBody: string,
): boolean {
  const before = norm(beforeBody ?? '')
  if (!before) return true
  return norm(proposedBody).includes(before)
}


export function deveAuditarMerge(args: {
  gateOk: boolean
  beforeBody: string | null | undefined
  proposedBody: string
}): boolean {
  if (!args.gateOk) return true
  return !mergeTrivialmenteAditivo(args.beforeBody, args.proposedBody)
}


export function clampBody(body: string, budget = 1200): string {
  const b = body ?? ''
  if (b.length <= budget) return b
  const head = Math.ceil(budget * 0.6)
  const tail = budget - head
  const cortado = b.length - budget
  return `${b.slice(0, head)}\n… [${cortado} chars omitidos] …\n${b.slice(b.length - tail)}`
}
