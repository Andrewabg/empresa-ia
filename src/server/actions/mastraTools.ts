

import { MastraProvider } from '@composio/mastra'
import type { Tool, ExecuteToolFn } from '@composio/core'
import { listAvailableActions, runAction } from './actions'
import { getComposioClient, type ComposioClient } from './composio'
import { getTurnContext } from '../agent/turnContext'
import { COMPOSIO_TOOLS_LIMIT } from '@/lib/toolkit-gating'






const WRAP_TTL_MS = 60_000
let _wrapCache: { key: string; tools: Record<string, unknown>; expiresAt: number } | null = null

export function invalidateComposioToolsCache(): void { _wrapCache = null }


function wrapCacheKey(userId: string, toolkits?: string[] | null, limit?: number): string {
  const norm = (toolkits && toolkits.length)
    ? [...new Set(toolkits.map((t) => t.toLowerCase()))].sort().join(',')
    : '*'
  return `${userId}::${norm}::${limit ?? ''}`
}

export async function buildComposioMastraTools(
  ctx: { userId: string; toolkits?: string[] | null; limit?: number },
  composio?: ComposioClient | null,
  makeExecuteFn?: (toolkitBySlug: Map<string, string>) => ExecuteToolFn,
): Promise<Record<string, unknown>> {
  const useDefault = composio === undefined
  const limit = ctx.limit ?? COMPOSIO_TOOLS_LIMIT
  const key = wrapCacheKey(ctx.userId, ctx.toolkits, limit)
  
  if (useDefault && makeExecuteFn === undefined && _wrapCache && _wrapCache.key === key && _wrapCache.expiresAt > Date.now()) {
    return _wrapCache.tools
  }

  const c = useDefault ? await getComposioClient() : composio
  if (!c) return {}   

  
  
  
  
  const raw = await listAvailableActions({ userId: ctx.userId, limit, toolkits: ctx.toolkits }, c)

  
  let tools: Record<string, unknown> = {}
  if (raw.length > 0) {
    const provider = new MastraProvider()
    
    
    
    
    
    
    
    
    
    
    
    
    const toolkitBySlug = new Map<string, string>()
    for (const t of raw as Tool[]) if (t.toolkit?.slug) toolkitBySlug.set(t.slug, t.toolkit.slug)
    const executeFn = makeExecuteFn
      ? makeExecuteFn(toolkitBySlug)
      : (async (toolSlug: string, input: Record<string, unknown>) => {
          
          
          const turno = getTurnContext()
          return runAction(
            { slug: toolSlug, args: input ?? {}, userId: ctx.userId, agent: turno.actingAgentId ?? 'jarvis', conversationId: turno.conversationId ?? null },
            c,
          )
        }) as ExecuteToolFn
    
    
    
    
    
    
    
    
    
    
    const rawForWrap = (raw as Tool[]).map((t) => ({ ...t, outputParameters: undefined }))
    
    tools = provider.wrapTools(rawForWrap as Tool[], executeFn) as unknown as Record<string, unknown>
  }

  
  
  
  
  
  
  
  
  if (useDefault && makeExecuteFn === undefined && raw.length > 0) _wrapCache = { key, tools, expiresAt: Date.now() + WRAP_TTL_MS }
  return tools
}
