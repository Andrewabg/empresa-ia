

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getMembro } from '@/server/auth/membro'
import { requireDonoApi } from '@/server/auth/apiAuth'
import { setSecret, getSecret, getConfigStatus, invalidateSecretsCache, SECRET_KEYS } from '@/server/secrets'
import { webhookUrl } from '@/server/config/setup'
import { invalidateComposioClientCache } from '@/server/actions/composio'
import { invalidateJarvisAgentCache } from '@/server/agent/jarvis'
import { invalidateActionsCache } from '@/server/actions/actions'
import { invalidateComposioToolsCache } from '@/server/actions/mastraTools'
import { invalidateComposioHealthCache } from '@/server/config/health'
import { invalidateConnectionsCache } from '@/server/config/connections'
import { invalidateMetaHealthCache } from '@/server/config/metaHealth'
import { invalidateCompanyProfileCache, getCompanyProfile } from '@/data/settings'
import { getBranding } from '@/server/config/branding'

export async function GET(request: Request) {
  const cookieStore = await cookies()
  const membro = await getMembro(cookieStore)
  if (!membro) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  
  
  
  
  const [openai, github_token, github_repo, webhook, composio, cron] = await Promise.all([
    getSecret(SECRET_KEYS.openai_api_key),
    getSecret(SECRET_KEYS.github_token),
    getSecret(SECRET_KEYS.github_repo),
    getSecret(SECRET_KEYS.webhook_secret),
    getSecret(SECRET_KEYS.composio_api_key),
    getSecret(SECRET_KEYS.cron_secret),
  ])

  
  
  let webhookSecret = webhook
  let cronSecret = cron
  const toPersist: Promise<void>[] = []
  if (!webhookSecret) {
    webhookSecret = randomBytes(32).toString('hex')
    toPersist.push(setSecret(SECRET_KEYS.webhook_secret, webhookSecret))
  }
  if (!cronSecret) {
    cronSecret = randomBytes(32).toString('hex')
    toPersist.push(setSecret(SECRET_KEYS.cron_secret, cronSecret))
  }
  if (toPersist.length) await Promise.all(toPersist)

  const status = {
    openai_api_key: !!openai,
    github_token: !!github_token,
    github_repo: !!github_repo,
    webhook_secret: !!webhookSecret,
    composio_api_key: !!composio,
    cron_secret: !!cronSecret,
  }

  
  
  const companyProfile = await getCompanyProfile()
  
  
  const { assistantName } = await getBranding()

  return NextResponse.json({
    status,
    webhookUrl: webhookUrl(request),
    
    
    webhookSecret: membro.papel === 'dono' ? webhookSecret : null,
    
    
    githubRepo: github_repo ?? null,
    
    
    isDono: membro.papel === 'dono',
    
    
    companyName: membro.papel === 'dono' ? (companyProfile.companyName ?? '') : '',
    
    assistantName,
  })
}

export async function POST(request: Request) {
  const auth = await requireDonoApi(await cookies())
  if (auth instanceof Response) return auth

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const allowed = [
    SECRET_KEYS.openai_api_key,
    SECRET_KEYS.github_repo,
    SECRET_KEYS.github_token,
    SECRET_KEYS.composio_api_key,
  ] as const

  
  await Promise.all(
    allowed.flatMap((key) => {
      const value = body[key]
      return typeof value === 'string' && value.trim().length > 0
        ? [setSecret(key, value.trim())]
        : []
    }),
  )

  
  
  
  
  invalidateSecretsCache() 
  invalidateComposioClientCache()
  invalidateJarvisAgentCache()
  invalidateActionsCache() 
  invalidateComposioToolsCache() 
  invalidateComposioHealthCache() 
  invalidateConnectionsCache() 
  invalidateMetaHealthCache() 
  invalidateCompanyProfileCache() 

  const status = await getConfigStatus()

  
  return NextResponse.json({ ok: true, status })
}
