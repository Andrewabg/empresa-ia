
import { Committer, type ApplyResult } from '../../brain/curator/commit'
import type { Decision } from '../../brain/curator/consolidate'
import type { Operation } from '../../brain/curator/classify'
import { encurtarTitulo } from '@/lib/encurtarTitulo'
import { exigeAprovacaoDoDono } from './sensibilidadeDaPasta'


export const MAX_REASON_PR = 200

export class CommitterTituloSeguro extends Committer {
  override async apply(decision: Decision, ctx: { operation: Operation; touched: number }): Promise<ApplyResult> {
    const reason = decision.reason
    const ajustado = typeof reason === 'string' && reason.length > MAX_REASON_PR
      ? { ...decision, reason: encurtarTitulo(reason, MAX_REASON_PR) }
      : decision
    return super.apply(ajustado, comAprovacaoQuandoSensivel(decision.path, ctx))
  }
}


export function comAprovacaoQuandoSensivel(
  path: string | undefined,
  ctx: { operation: Operation; touched: number },
): { operation: Operation; touched: number } {
  
  
  if (ctx.operation === 'delete') return ctx
  if (!path || !exigeAprovacaoDoDono(path)) return ctx
  return { ...ctx, operation: 'overwrite' }
}
