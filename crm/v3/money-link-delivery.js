const PROMOTION_SPEC = {
  proposal: {
    table: 'proposals',
    statuses: ['Created', 'Draft', 'draft', 'Copied', 'copied', 'Sent', 'sent'],
    localStatuses: new Set(['created', 'draft', 'copied', 'sent', 'viewed']),
    values(nowIso, currentStatus) {
      return {
        status: currentStatus === 'viewed' ? 'Viewed' : 'Sent',
        sent_at: nowIso,
      }
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

const PROPOSAL_COPY_STATUS_RANK = new Map([
  ['created', 0],
  ['draft', 0],
  ['copied', 1],
  ['sent', 2],
  ['viewed', 3],
  ['approved', 4],
  ['signed', 4],
])

const PROPOSAL_COPY_STATUS_LABEL = new Map([
  ['created', 'Created'],
  ['draft', 'Draft'],
  ['copied', 'Copied'],
  ['sent', 'Sent'],
  ['viewed', 'Viewed'],
  ['approved', 'Approved'],
  ['signed', 'Signed'],
])

const PROPOSAL_COPY_RECOVERY_SCHEMA = 'bpp.proposal-copy-recovery'
const PROPOSAL_COPY_RECOVERY_VERSION = 2
const PROPOSAL_COPY_RECOVERY_KEY_PREFIX = 'bpp:proposal-copy-recovery:v2:'
const PROPOSAL_COPY_RECOVERY_FIELDS = new Set([
  'schema',
  'version',
  'proposal_id',
  'expected_revision',
  'copy_operation_id',
  'phase',
  'copied_locally_at',
])

function proposalCopyRecoveryKey(proposalId) {
  return `${PROPOSAL_COPY_RECOVERY_KEY_PREFIX}${encodeURIComponent(String(proposalId || ''))}`
}

function proposalCopyRecoveryStorage(storage) {
  if (storage) return storage
  try {
    return globalThis.sessionStorage || null
  } catch (_) {
    return null
  }
}

function validProposalCopyRecovery(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false
  if (Object.keys(receipt).some(field => !PROPOSAL_COPY_RECOVERY_FIELDS.has(field))) return false
  if (receipt.schema !== PROPOSAL_COPY_RECOVERY_SCHEMA
    || receipt.version !== PROPOSAL_COPY_RECOVERY_VERSION) return false
  if (!receipt.proposal_id || typeof receipt.proposal_id !== 'string') return false
  if (!Number.isInteger(receipt.expected_revision) || receipt.expected_revision < 1) return false
  if (typeof receipt.copy_operation_id !== 'string'
    || receipt.copy_operation_id.length < 8
    || receipt.copy_operation_id.length > 200) return false
  if (receipt.phase === 'attempting') return receipt.copied_locally_at === null
  if (receipt.phase !== 'clipboard_succeeded') return false
  return typeof receipt.copied_locally_at === 'string'
    && Number.isFinite(Date.parse(receipt.copied_locally_at))
}

function removeProposalCopyRecovery(storage, key) {
  try {
    storage?.removeItem?.(key)
    return true
  } catch (_) {
    return false
  }
}

function readProposalCopyRecovery(storage, proposalId, expectedRevision) {
  const key = proposalCopyRecoveryKey(proposalId)
  if (!storage?.getItem) return { key, receipt: null }
  try {
    const raw = storage.getItem(key)
    if (!raw) return { key, receipt: null }
    const receipt = JSON.parse(raw)
    if (!validProposalCopyRecovery(receipt)
      || receipt.proposal_id !== String(proposalId)
      || receipt.expected_revision !== expectedRevision) {
      removeProposalCopyRecovery(storage, key)
      return { key, receipt: null, mismatch: true }
    }
    return { key, receipt }
  } catch (_) {
    removeProposalCopyRecovery(storage, key)
    return { key, receipt: null, mismatch: true }
  }
}

export function proposalCopyRecoveryPending(proposal, storage) {
  if (!proposal?.id || Number.isFinite(Date.parse(String(proposal.sent_at || '')))) return false
  const revision = Number(proposal.signature_revision)
  if (!Number.isInteger(revision) || revision < 1) return false
  const recoveryStorage = proposalCopyRecoveryStorage(storage)
  return Boolean(readProposalCopyRecovery(recoveryStorage, proposal.id, revision).receipt)
}

function newProposalCopyOperationId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  } catch (_) {
    // A random identifier is useful for local diagnosis, but not required for RPC idempotency.
  }
  return `copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function writeProposalCopyRecovery(storage, key, receipt) {
  try {
    if (!storage?.setItem || !storage?.getItem) return false
    const serialized = JSON.stringify(receipt)
    storage.setItem(key, serialized)
    return storage.getItem(key) === serialized
  } catch (_) {
    return false
  }
}

export async function copyProposalWithRecovery({
  copyText,
  linkUrl,
  db,
  proposalId,
  expectedRevision,
  currentStatus,
  storage,
  nowIso = new Date().toISOString(),
  operationId = null,
  testMode = false,
}) {
  const revision = Number(expectedRevision)
  if (!proposalId || !Number.isInteger(revision) || revision < 1) {
    return { ok: false, error: 'Copy failed' }
  }

  const recoveryStorage = proposalCopyRecoveryStorage(storage)
  const pending = readProposalCopyRecovery(recoveryStorage, proposalId, revision)
  let receipt = pending.receipt
  const reconcilingCompletedCopy = receipt?.phase === 'clipboard_succeeded'
  let recoveryStored = reconcilingCompletedCopy

  if (!reconcilingCompletedCopy) {
    const attempt = {
      schema: PROPOSAL_COPY_RECOVERY_SCHEMA,
      version: PROPOSAL_COPY_RECOVERY_VERSION,
      proposal_id: String(proposalId),
      expected_revision: revision,
      copy_operation_id: typeof operationId === 'string' && operationId.length >= 8
        ? operationId
        : newProposalCopyOperationId(),
      phase: 'attempting',
      copied_locally_at: null,
    }
    if (!writeProposalCopyRecovery(recoveryStorage, pending.key, attempt)) {
      return { ok: false, error: 'Copy recovery is unavailable. Nothing was copied.' }
    }

    let copied = false
    try {
      copied = typeof copyText === 'function' && await copyText(linkUrl)
    } catch (_) {
      copied = false
    }
    if (!copied) {
      removeProposalCopyRecovery(recoveryStorage, pending.key)
      return { ok: false, error: 'Copy failed' }
    }

    receipt = {
      ...attempt,
      phase: 'clipboard_succeeded',
      copied_locally_at: nowIso,
    }
    recoveryStored = writeProposalCopyRecovery(recoveryStorage, pending.key, receipt)
    if (!recoveryStored) {
      return {
        ok: false,
        copied: true,
        syncFailed: true,
        recoveryPending: false,
        error: 'Link copied, but copy recovery could not be secured. Copy again to sync CRM status.',
      }
    }
  }

  const sync = await recordProposalCopy({
    db,
    proposalId,
    expectedRevision: revision,
    currentStatus,
    nowIso: receipt.copied_locally_at,
    testMode,
  })
  if (!sync.ok) {
    return {
      ...sync,
      copied: true,
      recoveryPending: recoveryStored,
    }
  }

  if (recoveryStored) removeProposalCopyRecovery(recoveryStorage, pending.key)
  return {
    ...sync,
    copied: true,
    reconciled: reconcilingCompletedCopy,
  }
}

export async function recordProposalCopy({
  db,
  proposalId,
  expectedRevision,
  currentStatus,
  nowIso = new Date().toISOString(),
  testMode = false,
}) {
  const revision = Number(expectedRevision)
  if (!proposalId || !Number.isInteger(revision) || revision < 1) {
    return syncFailure('invalid proposal copy identity')
  }
  const normalizedStatus = String(currentStatus || '').trim().toLowerCase()
  if (testMode) {
    const currentRank = PROPOSAL_COPY_STATUS_RANK.get(normalizedStatus) ?? 0
    const copied = currentRank < 1
    return {
      ok: true,
      changed: copied,
      row: {
        id: proposalId,
        status: copied ? 'Copied' : (PROPOSAL_COPY_STATUS_LABEL.get(normalizedStatus) || 'Copied'),
        copied_at: copied ? nowIso : null,
        sent_at: null,
        communication_state: currentRank >= 2 ? 'sent' : 'link_copied',
      },
    }
  }
  if (!db || typeof db.rpc !== 'function') return syncFailure('database unavailable')

  try {
    const { data, error } = await db.rpc(
      'native_operator_confirm_proposal_copy_v1',
      {
        p_proposal_id: proposalId,
        p_expected_revision: revision,
      },
    )
    if (error) return syncFailure(error.message)
    if (!data || data.ok !== true) return syncFailure(data?.error || 'copy receipt missing')
    if (data.document_type !== 'proposal' || String(data.document_id || '') !== String(proposalId)) {
      return syncFailure('copy receipt identity invalid')
    }
    if (data.communication_state !== 'link_copied' && data.communication_state !== 'sent') {
      return syncFailure('copy receipt state invalid')
    }
    const receiptStatus = String(data.status || '').trim().toLowerCase()
    if (!PROPOSAL_COPY_STATUS_RANK.has(receiptStatus)) {
      return syncFailure('copy receipt status invalid')
    }
    const currentRank = PROPOSAL_COPY_STATUS_RANK.get(normalizedStatus) ?? 0
    const receiptRank = PROPOSAL_COPY_STATUS_RANK.get(receiptStatus)
    const resultStatus = currentRank > receiptRank ? normalizedStatus : receiptStatus
    const resultRank = Math.max(currentRank, receiptRank)
    const copied = resultRank === 1
    return {
      ok: true,
      changed: copied && currentRank < 1,
      row: {
        id: proposalId,
        status: PROPOSAL_COPY_STATUS_LABEL.get(resultStatus) || data.status,
        copied_at: copied && currentRank < 1 ? nowIso : null,
        sent_at: null,
        communication_state: data.communication_state,
      },
      receipt: data,
    }
  } catch (error) {
    return syncFailure(error && error.message ? error.message : error)
  }
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
  currentSentAt = null,
  nowIso = new Date().toISOString(),
  testMode = false,
}) {
  const spec = PROMOTION_SPEC[kind]
  if (!spec) return syncFailure('unknown document kind')
  const normalizedStatus = String(currentStatus || '').trim().toLowerCase()
  const alreadyAuthoritativelySent = kind === 'proposal' && Boolean(currentSentAt)
  const needsPromotion = !alreadyAuthoritativelySent
    && (!normalizedStatus || spec.localStatuses.has(normalizedStatus))

  if (!token) return needsPromotion ? syncFailure('missing document token') : { ok: true, changed: false, row: null }
  if (alreadyAuthoritativelySent) return { ok: true, changed: false, row: null }
  if (testMode) {
    return {
      ok: true,
      changed: needsPromotion,
      row: needsPromotion ? { ...spec.values(nowIso, normalizedStatus) } : null,
    }
  }
  if (!db) return needsPromotion ? syncFailure('database unavailable') : { ok: true, changed: false, row: null }

  try {
    const statuses = kind === 'proposal' && normalizedStatus === 'viewed'
      ? ['Viewed', 'viewed']
      : spec.statuses
    let query = db.from(spec.table)
      .update(spec.values(nowIso, normalizedStatus))
      .eq('token', token)
      .in('status', statuses)
    if (kind === 'proposal') query = query.is('sent_at', null)
    const { data, error } = await query.select(spec.select)
    if (error) return syncFailure(error.message)
    const rows = Array.isArray(data) ? data : []
    if (rows.length === 1) return { ok: true, changed: true, row: rows[0] }
    if (needsPromotion) return syncFailure(rows.length ? 'ambiguous status receipt' : 'status row not updated')
    return { ok: true, changed: false, row: null }
  } catch (error) {
    return syncFailure(error && error.message ? error.message : error)
  }
}

export async function reconcileProposalEmailReceipt({
  db,
  proposal,
  serverReceipt,
  expectedRevision = Number(proposal?.signature_revision),
}) {
  const proposalId = String(proposal?.id || '')
  const revision = Number(expectedRevision)
  if (!proposalId || !Number.isSafeInteger(revision) || revision < 1) {
    return syncFailure('invalid proposal delivery identity')
  }

  const receiptMatches = serverReceipt
    && String(serverReceipt.id || '') === proposalId
    && Number(serverReceipt.signature_revision) === revision
    && serverReceipt.communication_state === 'email_sent'
    && Number.isFinite(Date.parse(String(serverReceipt.sent_at || '')))
  if (receiptMatches) {
    return { ok: true, changed: !proposal?.sent_at, row: serverReceipt, source: 'receipt' }
  }
  if (!db) return syncFailure('database unavailable')

  try {
    const { data, error } = await db
      .from('proposals')
      .select('id, status, sent_at, copied_at, signature_revision')
      .eq('id', proposalId)
      .eq('signature_revision', revision)
      .maybeSingle()
    if (error) return syncFailure(error.message)
    if (!data || String(data.id || '') !== proposalId
        || Number(data.signature_revision) !== revision
        || !Number.isFinite(Date.parse(String(data.sent_at || '')))) {
      return syncFailure('proposal delivery receipt unavailable')
    }
    return { ok: true, changed: !proposal?.sent_at, row: data, source: 'readback' }
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
