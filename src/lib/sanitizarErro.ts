
export function sanitizarCredenciaisDeErro(msg: string): string {
  return msg.replace(/(https?:\/\/)[^/\s@]+@/g, '$1***@')
}


export function motivoSeguro(err: unknown): string {
  return sanitizarCredenciaisDeErro(err instanceof Error ? err.message : String(err))
}
