const KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/

function storage() {
  try {
    return globalThis.localStorage || globalThis.window?.localStorage || null
  } catch (_) {
    return null
  }
}

function payloadDigest(value) {
  const text = String(value || '')
  let first = 2166136261
  let second = 2246822507
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    first ^= code
    first = Math.imul(first, 16777619)
    second ^= code + index
    second = Math.imul(second, 3266489909)
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
}

function operationStorageKey({ scope, contactId, body, mediaUrls, semanticId, proposalId, proposalRevision }) {
  const payload = JSON.stringify({
    scope: String(scope || ''),
    contactId: String(contactId || ''),
    body: String(body || ''),
    mediaUrls: Array.isArray(mediaUrls) ? mediaUrls.map(String) : [],
    semanticId: String(semanticId || ''),
    proposalId: String(proposalId || ''),
    proposalRevision: proposalId ? Number(proposalRevision) : null,
  })
  return `bpp-manual-sms-v1:${payloadDigest(payload)}`
}

function operationKeyFor(storageKey) {
  const store = storage()
  if (!store) throw new Error('secure send identity unavailable')
  try {
    const existing = store.getItem(storageKey)
    if (existing && KEY_PATTERN.test(existing)) return existing
  } catch (_) {
    throw new Error('secure send identity unavailable')
  }
  const created = globalThis.crypto?.randomUUID?.()
  if (!created || !KEY_PATTERN.test(created)) throw new Error('secure send identity unavailable')
  try {
    store.setItem(storageKey, created)
    if (store.getItem(storageKey) !== created) throw new Error('secure send identity unavailable')
  } catch (_) {
    throw new Error('secure send identity unavailable')
  }
  return created
}

function clearOperationKey(storageKey, value) {
  const store = storage()
  try {
    if (store?.getItem(storageKey) === value) store.removeItem(storageKey)
  } catch (_) {}
}

export function proposalDeliveryPending(proposal, messages = []) {
  if (!proposal?.id) return false
  if (Number.isFinite(Date.parse(String(proposal.sent_at || '')))) return false
  if (proposal.delivery_confirmation_pending === true) return true
  const revision = Number(proposal.signature_revision)
  return (messages || []).some(message => (
    String(message?.proposal_id || '') === String(proposal.id)
    && Number(message?.proposal_signature_revision) === revision
    && !!message?.provider_attempted_at
    && ['sending', 'pending', 'sent', 'scheduled', 'delivered', 'read']
      .includes(String(message?.status || '').toLowerCase())
  ))
}

async function definitiveError(error, data) {
  let detail = data?.error || error?.message || 'Message send did not receive a receipt.'
  let definitive = data?.definite_failure === true
  let providerContacted = data?.provider_contacted === true
  let retrySafe = data?.retry_safe === true
  try {
    const body = error?.context ? await error.context.json() : null
    if (body?.error) {
      detail = body.error + (body.detail ? `: ${body.detail}` : '')
    }
    definitive = definitive || body?.definite_failure === true
    providerContacted = providerContacted || body?.provider_contacted === true
    retrySafe = retrySafe || body?.retry_safe === true
  } catch (_) {}
  return { detail, definitive, providerContacted, retrySafe }
}

export async function sendManualSmsWithReceipt({
  invoke,
  scope,
  contactId,
  body,
  mediaUrls = [],
  semanticId = '',
  proposalId = '',
  proposalRevision = null,
  testMode = false,
}) {
  if (typeof invoke !== 'function' || !contactId || (!String(body || '').trim() && !mediaUrls.length)) {
    return { ok: false, error: 'Message send service is unavailable.' }
  }
  if (proposalId && (!Number.isSafeInteger(Number(proposalRevision)) || Number(proposalRevision) < 1)) {
    return { ok: false, error: 'Refresh this proposal before sending.' }
  }
  const storageKey = operationStorageKey({
    scope, contactId, body, mediaUrls, semanticId, proposalId, proposalRevision,
  })
  let operationKey
  try {
    operationKey = operationKeyFor(storageKey)
  } catch (error) {
    return { ok: false, error: error?.message || 'Secure send identity is unavailable.' }
  }

  let response
  try {
    response = await invoke('send-sms', { body: {
      contactId,
      body: String(body || ''),
      mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : [],
      idempotencyKey: operationKey,
      ...(proposalId ? {
        proposalId: String(proposalId),
        expectedProposalRevision: Number(proposalRevision),
      } : {}),
    } })
  } catch (error) {
    return {
      ok: false,
      ambiguous: true,
      operationKey,
      error: 'Delivery confirmation was interrupted. Retry checks the same send and will not create another message.',
    }
  }

  const data = response?.data
  const error = response?.error
  if (error || data?.success === false) {
    const failure = await definitiveError(error, data)
    if (failure.definitive && !failure.providerContacted && failure.retrySafe) {
      clearOperationKey(storageKey, operationKey)
    }
    return {
      ok: false,
      ambiguous: !failure.definitive,
      providerContacted: failure.providerContacted,
      retrySafe: failure.retrySafe,
      operationKey,
      error: failure.definitive
        ? failure.detail
        : 'Delivery confirmation was interrupted. Retry checks the same send and will not create another message.',
    }
  }

  if (data?.accepted_ambiguous === true || data?.persistence_pending === true) {
    const recoveryKey = String(data?.recovery_idempotency_key || '')
    if (KEY_PATTERN.test(recoveryKey)) {
      try { storage()?.setItem(storageKey, recoveryKey) } catch (_) {}
    }
    return {
      ok: false,
      ambiguous: true,
      confirmationPending: true,
      operationKey,
      error: 'Delivery is still being confirmed. Retry checks the same send and will not create another message.',
      data,
    }
  }
  if (!testMode && data?.success !== true) {
    return {
      ok: false,
      ambiguous: true,
      operationKey,
      error: 'Delivery confirmation was incomplete. Retry checks the same send and will not create another message.',
    }
  }

  if (proposalId) {
    const proposal = data?.proposal
    if (proposal?.communication_state === 'sent_revision_changed') {
      clearOperationKey(storageKey, operationKey)
      return {
        ok: false,
        delivered: true,
        revisionChanged: true,
        operationKey,
        error: 'The earlier proposal version was delivered. Refresh before sending the current version.',
        data,
      }
    }
    const proposalSentAt = Date.parse(String(proposal?.sent_at || ''))
    if (String(proposal?.id || '') !== String(proposalId)
        || proposal?.communication_state !== 'sent'
        || !Number.isFinite(proposalSentAt)) {
      return {
        ok: false,
        ambiguous: true,
        delivered: true,
        syncFailed: true,
        operationKey,
        error: 'SMS delivery is confirmed, but proposal status is still syncing. Retry checks the same send and will not create another message.',
        data,
      }
    }
  }

  clearOperationKey(storageKey, operationKey)
  return { ok: true, operationKey, data }
}
