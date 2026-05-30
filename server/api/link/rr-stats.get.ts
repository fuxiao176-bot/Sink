import type { RoundRobinStats } from '../../utils/link-store'

export default eventHandler(async (event) => {
  const query = getQuery(event)
  const slug = query.slug as string

  if (!slug) {
    throw createError({ status: 400, statusText: 'Missing slug parameter' })
  }

  const stats: RoundRobinStats = await getRoundRobinStats(event, slug)
  return { stats }
})
