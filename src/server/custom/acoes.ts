// src/server/custom/acoes.ts — monta a fachada CustomAcoes: 3 thin-wraps fail-safe sobre serviços
// do core. É o caminho recomendado pra a zona custom tocar o sistema (em vez de SQL cru service-role).
import { notificar } from '@/server/proativo/notificar'
import { createTask } from '@/data/tasks'
import { getAgentBySlugOuRole } from '@/data/agents'
import { createCustomToolApproval } from '@/server/approvals/customTool'
import type { CustomAcoes } from './contrato'

export function construirAcoes(): CustomAcoes {
  return {
    async notificar({ titulo, corpo, urgencia, dedupKey }) {
      return notificar({ tipo: 'custom', titulo, corpo, urgencia: urgencia ?? 'imediata', dedupKey })
    },
    async criarTarefa({ agente, descricao, operadorId }) {
      const row = await getAgentBySlugOuRole(agente)
      if (!row) throw new Error(`criarTarefa: agente "${agente}" não existe no roster`)
      // operadorId é OPT-IN do CHAMADOR (custom/) — nunca inferido daqui. Ver o comentário
      // no contrato: um webhook de entrada não pode virar concessão de ato de dono sozinho.
      const task = await createTask({ agent_id: row.id, objective: descricao, operator_id: operadorId })
      return { id: task.id }
    },
    async criarAprovacao({ tool, titulo, args }) {
      const apr = await createCustomToolApproval({ toolId: tool, titulo, args, agentId: null })
      return { id: apr.id }
    },
  }
}
