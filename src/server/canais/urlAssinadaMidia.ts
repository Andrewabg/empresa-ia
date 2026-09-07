
import { BUCKET_MIDIA } from './media'
import {
  VALIDADE_URL_S, urlAindaServe, podarCache, type UrlAssinadaEmCache,
} from '@/lib/inbox/urlAssinada'


export interface StorageAssinador {
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl?: string } | null }>
    }
  }
}

const cache = new Map<string, UrlAssinadaEmCache>()


export function limparCacheDeUrls(): void { cache.clear() }


export async function urlAssinadaDeMidia(
  db: StorageAssinador,
  storagePath: string,
  agoraMs: number = Date.now(),
): Promise<string | undefined> {
  const emCache = cache.get(storagePath)
  if (urlAindaServe(emCache, agoraMs)) return emCache?.url
  try {
    const { data } = await db.storage.from(BUCKET_MIDIA).createSignedUrl(storagePath, VALIDADE_URL_S)
    const url = data?.signedUrl
    if (!url) return undefined
    cache.set(storagePath, { url, expiraEmMs: agoraMs + VALIDADE_URL_S * 1000 })
    podarCache(cache, agoraMs)
    return url
  } catch {
    return undefined
  }
}
