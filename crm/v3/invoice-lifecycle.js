const KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/

function storage() {
  try {
    return globalThis.localStorage || globalThis.window?.localStorage || null
  } catch (_) {
    return null
  }
}

function normalizedStatus(invoice) {
  return String(invoice?.status || '').trim().toLowerCase()
}

function operationStorageKey(invoice, action) {
  return [
    'bpp-invoice-lifecycle-v1',
    String(invoice?.id || ''),
    String(action || ''),
    normalizedStatus(invoice),
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

function expectedReceiptStatus(action, value) {
  const status = String(value || '').trim().toLowerCase()
  return action === 'void' ? status === 'voided' : status === 'unpaid'
}

export async function mutateInvoiceLifecycle({ invoke, invoice, action }) {
  if (typeof invoke !== 'function' || !invoice?.id) {
    return { ok: false, error: 'Invoice lifecycle service is unavailable.' }
  }
  if (!['void', 'reopen'].includes(action)) {
    return { ok: false, error: 'Unsupported invoice action.' }
  }

  const storageKey = operationStorageKey(invoice, action)
  let operationKey
  try {
    operationKey = readOrCreateOperationKey(storageKey)
  } catch (error) {
    return { ok: false, error: error?.message || 'Secure operation identity is unavailable.' }
  }

  let response
  try {
    response = await invoke('record-payment', { body: {
      action: action === 'void' ? 'void_invoice' : 'reopen_invoice',
      invoice_id: invoice.id,
      reason: action === 'void' ? 'Operator voided invoice' : 'Operator reopened invoice',
      idempotency_key: operationKey,
    } })
  } catch (error) {
    return { ok: false, error: error?.message || 'Invoice action did not receive a receipt.' }
  }

  const data = response?.data
  const error = response?.error
  if (error || !data?.ok) {
    return { ok: false, error: error?.message || data?.error || 'Invoice action did not receive a receipt.' }
  }
  if (String(data.invoice_id || '') !== String(invoice.id)
    || !expectedReceiptStatus(action, data.status)) {
    return { ok: false, error: 'Invoice action receipt did not match the displayed invoice.' }
  }

  clearOperationKey(storageKey, operationKey)
  return {
    ok: true,
    duplicate: data.duplicate === true,
    operationKey,
    status: String(data.status),
    displayStatus: action === 'void' ? 'voided' : 'sent',
  }
}

export function applyInvoiceLifecycleReceipt(invoice, receipt) {
  if (!invoice || !receipt?.ok) return invoice
  invoice.status = String(receipt.displayStatus || receipt.status || invoice.status)
  return invoice
}
