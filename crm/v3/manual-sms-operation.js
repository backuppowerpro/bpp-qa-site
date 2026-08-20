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

function operationStorageKey({ scope, contactId, body, mediaUrls, semanticId }) {
  const payload = JSON.stringify({
    scope: String(scope || ''),
    contactId: String(contactId || ''),
    body: String(body || ''),
    mediaUrls: Array.isArray(mediaUrls) ? mediaUrls.map(String) : [],
    semanticId: String(semanticId || ''),
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

async function definitiveError(error, data) {
  let detail = data?.error || error?.message || 'Message send did not receive a receipt.'
  let definitive = data?.success === false
  try {
    const body = error?.context ? await error.context.json() : null
    if (body?.error) {
      detail = body.error + (body.detail ? `: ${body.detail}` : '')
      definitive = true
    }
  } catch (_) {}
  return { detail, definitive }
}

export async function sendManualSmsWithReceipt({
  invoke,
  scope,
  contactId,
  body,
  mediaUrls = [],
  semanticId = '',
  testMode = false,
}) {
  if (typeof invoke !== 'function' || !contactId || (!String(body || '').trim() && !mediaUrls.length)) {
    return { ok: false, error: 'Message send service is unavailable.' }
  }
  const storageKey = operationStorageKey({ scope, contactId, body, mediaUrls, semanticId })
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
    if (failure.definitive) clearOperationKey(storageKey, operationKey)
    return {
      ok: false,
      ambiguous: !failure.definitive,
      operationKey,
      error: failure.definitive
        ? failure.detail
        : 'Delivery confirmation was interrupted. Retry checks the same send and will not create another message.',
    }
  }

  if (data?.accepted_ambiguous === true || data?.persistence_pending === true) {
    return {
      ok: false,
      ambiguous: true,
      delivered: true,
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

  clearOperationKey(storageKey, operationKey)
  return { ok: true, operationKey, data }
}
