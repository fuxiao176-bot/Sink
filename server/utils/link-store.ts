import type { LinkSchema } from '#shared/schemas/link'
import type { H3Event } from 'h3'
import type { z } from 'zod'
import { parseURL, stringifyParsedURL } from 'ufo'

type Link = z.infer<typeof LinkSchema>

export function withoutQuery(url: string): string {
  const parsed = parseURL(url)
  return stringifyParsedURL({ ...parsed, search: '' })
}

export function normalizeSlug(event: H3Event, slug: string): string {
  const { caseSensitive } = useRuntimeConfig(event)
  return caseSensitive ? slug : slug.toLowerCase()
}

export function buildShortLink(event: H3Event, slug: string): string {
  return `${getRequestProtocol(event)}://${getRequestHost(event)}/${slug}`
}

export async function putLink(event: H3Event, link: Link): Promise<void> {
  const { cloudflare } = event.context
  const { KV } = cloudflare.env
  const expiration = getExpiration(event, link.expiration)

  await KV.put(`link:${link.slug}`, JSON.stringify(link), {
    expiration,
    metadata: {
      expiration,
      url: withoutQuery(link.url),
      comment: link.comment,
    },
  })
}

export async function getLink(event: H3Event, slug: string, cacheTtl?: number): Promise<Link | null> {
  const { cloudflare } = event.context
  const { KV } = cloudflare.env
  return await KV.get(`link:${slug}`, { type: 'json', cacheTtl }) as Link | null
}

export async function getLinkWithMetadata(event: H3Event, slug: string): Promise<{ link: Link | null, metadata: Record<string, unknown> | null }> {
  const { cloudflare } = event.context
  const { KV } = cloudflare.env
  const { metadata, value: link } = await KV.getWithMetadata(`link:${slug}`, { type: 'json' })
  return { link: link as Link | null, metadata: metadata as Record<string, unknown> | null }
}

export async function deleteLink(event: H3Event, slug: string): Promise<void> {
  const { cloudflare } = event.context
  const { KV } = cloudflare.env
  await KV.delete(`link:${slug}`)
  // Also clean up round-robin counter and stats if exists
  await KV.delete(`link-roundrobin:${slug}`).catch(() => {})
  await KV.delete(`link-roundrobin-stats:${slug}`).catch(() => {})
}

export interface RoundRobinStats {
  [index: string]: number
}

/**
 * Get click statistics for each URL index in round-robin redirect.
 */
export async function getRoundRobinStats(event: H3Event, slug: string): Promise<RoundRobinStats> {
  const { cloudflare } = event.context
  const { KV } = cloudflare.env
  try {
    const raw = await KV.get(`link-roundrobin-stats:${slug}`, { cacheTtl: 0 })
    if (raw) {
      return JSON.parse(raw) as RoundRobinStats
    }
  }
  catch {
    // ignore parse errors
  }
  return {}
}

/**
 * Increment the click count for a specific URL index.
 * Uses waitUntil to avoid blocking the redirect response.
 */
export function incrementRoundRobinStats(event: H3Event, slug: string, index: number): void {
  const { cloudflare } = event.context
  const { KV } = cloudflare.env
  cloudflare.context.waitUntil(
    (async () => {
      try {
        const raw = await KV.get(`link-roundrobin-stats:${slug}`, { cacheTtl: 0 })
        const stats: RoundRobinStats = raw ? JSON.parse(raw) : {}
        stats[String(index)] = (stats[String(index)] || 0) + 1
        await KV.put(`link-roundrobin-stats:${slug}`, JSON.stringify(stats))
      }
      catch (err) {
        console.error('Failed to increment round-robin stats:', err)
      }
    })(),
  )
}

/**
 * Get the current round-robin index for a link's multi-URL rotation.
 * Returns 0 if no counter exists yet.
 */
export async function getRoundRobinIndex(event: H3Event, slug: string): Promise<number> {
  const { cloudflare } = event.context
  const { KV } = cloudflare.env
  const value = await KV.get(`link-roundrobin:${slug}`, { cacheTtl: 0 })
  return value ? Number.parseInt(value, 10) || 0 : 0
}

/**
 * Increment the round-robin counter for a link, wrapping to 0 when exceeding max.
 * Uses cacheTtl: 0 to avoid stale counter reads across edge locations.
 */
export async function incrementRoundRobinIndex(event: H3Event, slug: string, max: number): Promise<void> {
  const { cloudflare } = event.context
  const { KV } = cloudflare.env
  const current = await getRoundRobinIndex(event, slug)
  const next = (current + 1) % max
  await KV.put(`link-roundrobin:${slug}`, String(next))
}

export async function linkExists(event: H3Event, slug: string): Promise<boolean> {
  const link = await getLink(event, slug)
  return link !== null
}

interface ListLinksOptions {
  limit: number
  cursor?: string
}

interface ListLinksResult {
  links: (Link | null)[]
  list_complete: boolean
  cursor?: string
}

export async function listLinks(event: H3Event, options: ListLinksOptions): Promise<ListLinksResult> {
  const { cloudflare } = event.context
  const { KV } = cloudflare.env
  const list = await KV.list({
    prefix: 'link:',
    limit: options.limit,
    cursor: options.cursor || undefined,
  })

  const links = await Promise.all(
    (list.keys || []).map(async (key: { name: string }) => {
      const { metadata, value: link } = await KV.getWithMetadata(key.name, { type: 'json' }) as { metadata: Record<string, unknown> | null, value: Link | null }
      if (link) {
        return {
          ...(metadata ?? {}),
          ...link,
        }
      }
      return link
    }),
  )

  return {
    links,
    list_complete: list.list_complete,
    cursor: 'cursor' in list ? list.cursor : undefined,
  }
}
