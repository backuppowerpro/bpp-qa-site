const PROMOTION_SPEC = {
  proposal: {
    table: 'proposals',
    statuses: ['Created', 'Draft', 'draft'],
    localStatuses: new Set(['created', 'draft']),
    values(nowIso) {
      return { status: 'Sent', copied_at: nowIso, sent_at: nowIso }
    },
    select: 'id,status,copied_at,sent_at',
  },
  invoice: {
    table: 'invoices',
    statuses: ['draft', 'Draft'],
    localStatuses: new Set(['draft']),
    values(nowIso) {
      return { status: 'unpaid', sent_at: nowIso }
    },
    select: 'id,status,sent_at',
  },
}

function syncFailure(reason) {
  return {
    ok: false,
    syncFailed: true,
    error: 'CRM status did not sync. Refresh and retry status sync.',
    reason: String(reason || 'status receipt missing'),
  }
}

export async function promoteDocumentAfterDelivery({
  db,
  kind,
  token,
  currentStatus,
  nowIso = new Date().toISOString(),
  testMode = false,
}) {
  const spec = PROMOTION_SPEC[kind]
  if (!spec) return syncFailure('unknown document kind')
  const normalizedStatus = String(currentStatus || '').trim().toLowerCase()
  const needsPromotion = !normalizedStatus || spec.localStatuses.has(normalizedStatus)

  if (!token) return needsPromotion ? syncFailure('missing document token') : { ok: true, changed: false, row: null }
  if (testMode) {
    return {
      ok: true,
      changed: needsPromotion,
      row: needsPromotion ? { ...spec.values(nowIso) } : null,
    }
  }
  if (!db) return needsPromotion ? syncFailure('database unavailable') : { ok: true, changed: false, row: null }

  try {
    const { data, error } = await db.from(spec.table)
      .update(spec.values(nowIso))
      .eq('token', token)
      .in('status', spec.statuses)
      .select(spec.select)
    if (error) return syncFailure(error.message)
    const rows = Array.isArray(data) ? data : []
    if (rows.length === 1) return { ok: true, changed: true, row: rows[0] }
    if (needsPromotion) return syncFailure(rows.length ? 'ambiguous status receipt' : 'status row not updated')
    return { ok: true, changed: false, row: null }
  } catch (error) {
    return syncFailure(error && error.message ? error.message : error)
  }
}

export function deliverySyncMessage(channel) {
  if (channel === 'clipboard') return 'Link copied, but CRM status did not sync. Refresh and retry status sync.'
  if (channel === 'email') return 'Email sent, but CRM status did not sync. Refresh and retry status sync.'
  return 'SMS sent, but CRM status did not sync. Refresh and retry status sync.'
}

const PREVIEW_PATH_PARAMS = new Map([
  ['/proposal.html', 'token'],
  ['/proposal-comp.html', 'token'],
  ['/proposal-customer-mvp.html', 'token'],
  ['/invoice.html', 'token'],
  ['/invoice-comp.html', 'token'],
  ['/invoice-v4.html', 'token'],
  ['/receipt.html', null],
])

export function operatorDocumentPreviewUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''))
    if (url.protocol !== 'https:' || url.hostname !== 'backuppowerpro.com'
      || url.port || url.username || url.password || url.hash) return null
    const requiredParam = PREVIEW_PATH_PARAMS.get(url.pathname)
    if (requiredParam === undefined) return null
    const identityParams = requiredParam
      ? [requiredParam]
      : ['receipt', 'token'].filter(param => url.searchParams.getAll(param).length === 1 && url.searchParams.get(param))
    if (identityParams.length !== 1) return null
    if (url.searchParams.getAll(identityParams[0]).length !== 1) return null
    const allowed = new Set([identityParams[0], 'preview'])
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key)) return null
    }
    url.searchParams.set('preview', '1')
    return url.toString()
  } catch (_) {
    return null
  }
}
