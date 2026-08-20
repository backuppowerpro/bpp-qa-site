const KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/

function storage() {
  try {
    return globalThis.localStorage || globalThis.window?.localStorage || null
  } catch (_) {
    return null
  }
}

function storageKey(documentType, document) {
  return [
    'bpp-money-document-operation-v1',
    documentType,
    String(document?.id || ''),
    'delete-draft',
    String(document?.status || '').trim().toLowerCase(),
  ].join(':')
}

function operationKeyFor(key) {
  const store = storage()
  if (!store) throw new Error('secure operation identity unavailable')
  try {
    const existing = store.getItem(key)
    if (existing && KEY_PATTERN.test(existing)) return existing
  } catch (_) {
    throw new Error('secure operation identity unavailable')
  }
  const created = globalThis.crypto?.randomUUID?.()
  if (!created || !KEY_PATTERN.test(created)) throw new Error('secure operation identity unavailable')
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

export async function deleteDraftMoneyDocument({ invoke, documentType, document }) {
  if (typeof invoke !== 'function' || !document?.id || !['proposal', 'invoice'].includes(documentType)) {
    return { ok: false, error: 'Draft deletion service is unavailable.' }
  }
  const key = storageKey(documentType, document)
  let operationKey
  try {
    operationKey = operationKeyFor(key)
  } catch (error) {
    return { ok: false, error: error?.message || 'Secure operation identity is unavailable.' }
  }

  let response
  try {
    response = await invoke('record-payment', { body: {
      action: 'delete_draft',
      document_type: documentType,
      document_id: document.id,
      idempotency_key: operationKey,
    } })
  } catch (error) {
    return { ok: false, error: error?.message || 'Delete did not receive a receipt.' }
  }

  const data = response?.data
  const error = response?.error
  if (error || !data?.ok) {
    return { ok: false, error: error?.message || data?.error || 'Delete did not receive a receipt.' }
  }
  if (String(data.document_type || '') !== documentType
    || String(data.document_id || '') !== String(document.id)) {
    return { ok: false, error: 'Delete receipt did not match the displayed document.' }
  }

  clearOperationKey(key, operationKey)
  return { ok: true, duplicate: data.duplicate === true, operationKey }
}
