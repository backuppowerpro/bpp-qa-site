const KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/
const ACTIVE_STATUSES = new Set(['created', 'draft', 'sent', 'viewed', 'copied'])

function storage() {
  try {
    return globalThis.localStorage || globalThis.window?.localStorage || null
  } catch (_) {
    return null
  }
}

function operationStorageKey(proposal, action, revision, relatedKey) {
  return [
    'bpp-proposal-lifecycle-v2',
    String(proposal?.id || ''),
    String(action || ''),
    String(revision || ''),
    String(relatedKey || ''),
  ].join(':')
}

function newOperationKey() {
  const value = globalThis.crypto?.randomUUID?.()
  if (!value || !KEY_PATTERN.test(value)) throw new Error('secure operation identity unavailable')
  return value
}

function readOrCreateOperationKey(key) {
  const store = storage()
  if (!store) throw new Error('secure operation identity unavailable')
  try {
    const existing = store.getItem(key)
    if (existing && KEY_PATTERN.test(existing)) return existing
  } catch (_) {
    throw new Error('secure operation identity unavailable')
  }
  const created = newOperationKey()
  try {
    store.setItem(key, created)
    if (store.getItem(key) !== created) throw new Error('secure operation identity unavailable')
  } catch (_) {
    throw new Error('secure operation identity unavailable')
  }
  return created
}

function clearOperationKey(key, value) {
  const store = storage()
  try {
    if (store?.getItem(key) === value) store.removeItem(key)
  } catch (_) {}
}

export function lifecycleRevision(proposal) {
  const value = Number(proposal?.lifecycle_revision)
  return Number.isSafeInteger(value) && value >= 1 ? value : 1
}

function expectedStatus(action, value) {
  const status = String(value || '').trim()
  const normalized = status.toLowerCase()
  if (action === 'cancel') return normalized === 'cancelled'
  if (action === 'revive') return normalized === 'sent'
  return ACTIVE_STATUSES.has(normalized)
}

export async function mutateProposalLifecycle({ invoke, proposal, action, relatedCancelKey = null }) {
  if (typeof invoke !== 'function' || !proposal?.id) {
    return { ok: false, error: 'Proposal lifecycle service is unavailable.' }
  }
  if (!['cancel', 'revive', 'undo_cancel'].includes(action)) {
    return { ok: false, error: 'Unsupported proposal action.' }
  }
  if (action === 'undo_cancel' && !KEY_PATTERN.test(String(relatedCancelKey || ''))) {
    return { ok: false, error: 'The cancellation receipt is unavailable.' }
  }

  const expectedRevision = lifecycleRevision(proposal)
  const storageKey = operationStorageKey(proposal, action, expectedRevision, relatedCancelKey)
  let operationKey
  try {
    operationKey = readOrCreateOperationKey(storageKey)
  } catch (error) {
    return { ok: false, error: error?.message || 'Secure operation identity is unavailable.' }
  }

  let response
  try {
    response = await invoke('record-payment', { body: {
      action: 'mutate_proposal_lifecycle',
      proposal_id: proposal.id,
      proposal_action: action,
      expected_lifecycle_revision: expectedRevision,
      related_idempotency_key: action === 'undo_cancel' ? relatedCancelKey : null,
      idempotency_key: operationKey,
    } })
  } catch (error) {
    return { ok: false, error: error?.message || 'Proposal action did not receive a receipt.' }
  }

  const data = response?.data
  const error = response?.error
  if (error || !data?.ok) {
    return {
      ok: false,
      statusChanged: ['proposal_lifecycle_changed', 'proposal_status_changed'].includes(data?.error),
      error: error?.message || data?.error || 'Proposal action did not receive a receipt.',
    }
  }
  const nextRevision = Number(data.lifecycle_revision)
  if (String(data.proposal_id || '') !== String(proposal.id)
    || !Number.isSafeInteger(nextRevision)
    || nextRevision !== expectedRevision + 1
    || !expectedStatus(action, data.status)) {
    return { ok: false, error: 'Proposal action receipt did not match the displayed proposal.' }
  }

  clearOperationKey(storageKey, operationKey)
  return {
    ok: true,
    duplicate: data.duplicate === true,
    operationKey,
    status: String(data.status),
    lifecycleRevision: nextRevision,
  }
}

export function applyProposalLifecycleReceipt(proposal, receipt) {
  if (!proposal || !receipt?.ok) return proposal
  proposal.status = String(receipt.status || proposal.status)
  proposal.lifecycle_revision = Number(receipt.lifecycleRevision)
  return proposal
}
