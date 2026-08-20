const RPC_NAME = 'native_operator_set_communications_state';
const RECEIPT_SCHEMA = 'native_operator_communications_state_v1';
const ACTION_STATE = Object.freeze({
  mark_thread_read: 'read',
  mark_thread_unread: 'unread',
  mark_voicemail_listened: 'listened',
  mark_voicemail_unlistened: 'unlistened',
});

function isIncoming(message) {
  return message?.direction === 'in' || message?.direction === 'inbound';
}

function normalizedReceipt(data) {
  if (Array.isArray(data) && data.length === 1) return data[0];
  return data;
}

function receiptMatches(receipt, action, targetID, operationKey) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (receipt.schema !== RECEIPT_SCHEMA) return false;
  if (receipt.action !== action) return false;
  if (String(receipt.target_id) !== String(targetID)) return false;
  if (String(receipt.operation_key) !== String(operationKey)) return false;
  if (receipt.confirmed_state !== ACTION_STATE[action]) return false;
  if (receipt.result !== 'updated' && receipt.result !== 'unchanged') return false;
  if (!Number.isInteger(receipt.changed_count) || receipt.changed_count < 0) return false;
  if (!receipt.applied_at || !Number.isFinite(Date.parse(receipt.applied_at))) return false;
  return true;
}

function defaultDispatchChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('crm-data-changed', {
    detail: { table: 'operator_communications_state' },
  }));
}

function defaultRandomUUID() {
  const generator = globalThis.crypto?.randomUUID;
  if (typeof generator !== 'function') return null;
  return generator.call(globalThis.crypto);
}

export function createOperatorCommunicationsStateClient({
  getCRM = () => globalThis.window?.CRM,
  randomUUID = defaultRandomUUID,
  dispatchChanged = defaultDispatchChanged,
} = {}) {
  const inFlight = new Map();

  async function mutate({ action, targetID, snapshotIDs }) {
    const crm = getCRM();
    const db = crm?.__db;
    if (!ACTION_STATE[action] || !targetID || !db || typeof db.rpc !== 'function') {
      return { ok: false, reason: 'unavailable' };
    }
    const operationKey = randomUUID();
    if (!operationKey) return { ok: false, reason: 'unavailable' };
    const claimKey = [action, targetID, ...(snapshotIDs || [])].join(':');
    if (inFlight.has(claimKey)) return inFlight.get(claimKey);

    const operation = (async () => {
      let response;
      try {
        response = await db.rpc(RPC_NAME, {
          p_action: action,
          p_target_id: targetID,
          p_operation_key: operationKey,
        });
      } catch (_) {
        return { ok: false, reason: 'unavailable' };
      }
      if (response?.error) return { ok: false, reason: 'unavailable' };
      const receipt = normalizedReceipt(response?.data);
      if (!receiptMatches(receipt, action, targetID, operationKey)) {
        return { ok: false, reason: 'invalid_receipt' };
      }

      const appliedAt = receipt.applied_at;
      let localChanged = false;
      if (action === 'mark_thread_read') {
        const confirmedIDs = new Set(snapshotIDs || []);
        for (const message of crm.messages || []) {
          if (!confirmedIDs.has(message.id)) continue;
          if (String(message.contact_id) !== String(targetID) || !isIncoming(message)) continue;
          if (message.read_at == null) {
            message.read_at = appliedAt;
            localChanged = true;
          }
        }
        if (localChanged) crm.messages = (crm.messages || []).slice();
      } else if (action === 'mark_thread_unread') {
        const latest = (crm.messages || [])
          .filter(message => String(message.contact_id) === String(targetID) && isIncoming(message))
          .sort((left, right) => String(right.sent_at || right.created_at || '')
            .localeCompare(String(left.sent_at || left.created_at || '')))[0];
        if (latest?.read_at != null) {
          latest.read_at = null;
          crm.messages = (crm.messages || []).slice();
          localChanged = true;
        }
      } else if (action === 'mark_voicemail_listened') {
        const call = (crm.calls || []).find(row => String(row.id) === String(targetID));
        if (call && call.listened_at == null) {
          call.listened_at = appliedAt;
          crm.calls = (crm.calls || []).slice();
          localChanged = true;
        }
      }
      if (localChanged) dispatchChanged();
      return { ok: true, receipt };
    })();

    inFlight.set(claimKey, operation);
    try {
      return await operation;
    } finally {
      if (inFlight.get(claimKey) === operation) inFlight.delete(claimKey);
    }
  }

  async function markThreadRead(contactID) {
    const crm = getCRM();
    const snapshotIDs = (crm?.messages || [])
      .filter(message => String(message.contact_id) === String(contactID)
        && isIncoming(message)
        && message.read_at == null)
      .map(message => message.id);
    if (snapshotIDs.length === 0) return { ok: true, skipped: true };
    return mutate({ action: 'mark_thread_read', targetID: contactID, snapshotIDs });
  }

  async function markVoicemailListened(callID) {
    const crm = getCRM();
    const call = (crm?.calls || []).find(row => String(row.id) === String(callID));
    if (!call || (!call.voicemail_url && call.status !== 'voicemail')) {
      return { ok: false, reason: 'target_unavailable' };
    }
    if (call.listened_at != null) return { ok: true, skipped: true };
    return mutate({ action: 'mark_voicemail_listened', targetID: callID, snapshotIDs: [callID] });
  }

  async function markThreadUnread(contactID) {
    const crm = getCRM();
    const inbound = (crm?.messages || []).filter(message =>
      String(message.contact_id) === String(contactID) && isIncoming(message));
    if (inbound.length === 0) return { ok: false, reason: 'target_unavailable' };
    return mutate({
      action: 'mark_thread_unread',
      targetID: contactID,
      snapshotIDs: inbound.map(message => message.id),
    });
  }

  async function markAllThreadsRead() {
    const crm = getCRM();
    const contactIDs = [...new Set((crm?.messages || [])
      .filter(message => isIncoming(message) && message.read_at == null && message.contact_id)
      .map(message => message.contact_id))];
    if (contactIDs.length === 0) return { ok: true, succeeded: 0, failed: 0, total: 0 };
    const results = await Promise.all(contactIDs.map(contactID => markThreadRead(contactID)));
    const succeeded = results.filter(result => result.ok).length;
    const failed = results.length - succeeded;
    return { ok: failed === 0, succeeded, failed, total: results.length };
  }

  return Object.freeze({
    markThreadRead,
    markThreadUnread,
    markVoicemailListened,
    markAllThreadsRead,
  });
}
