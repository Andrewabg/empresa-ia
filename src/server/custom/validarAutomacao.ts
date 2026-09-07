// src/server/custom/validarAutomacao.ts — PURO. Validação dos 3 registros novos, reusando
// os validadores de forma existentes (custom-registry-validate) + a regra do prefixo custom_.
import { validarSlugsCustom, validarToolsCustom } from '@/lib/custom-registry-validate'
import type { WebhookCustom, RotinaCustom, ConfigCustom } from './contrato'

export function validarWebhooks(itens: WebhookCustom[]): string[] {
  return validarSlugsCustom(itens.map((w) => ({ slug: w.slug })), 'webhook')
}
export function validarRotinas(itens: RotinaCustom[]): string[] {
  return validarToolsCustom(itens.map((r) => ({ id: r.id })))
}
export function validarConfigs(itens: ConfigCustom[]): string[] {
  const erros: string[] = []
  const vistos = new Set<string>()
  for (const c of itens) {
    if (vistos.has(c.chave)) { erros.push(`config custom "${c.chave}": chave duplicada`); continue }
    vistos.add(c.chave)
    if (!c.chave.startsWith('custom_')) erros.push(`config custom "${c.chave}": a chave precisa começar com "custom_"`)
  }
  return erros
}
