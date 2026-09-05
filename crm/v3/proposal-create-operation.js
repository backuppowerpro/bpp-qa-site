const RECEIPT_SCHEMA = 'bpp_crm_proposal_create_recovery_v1';
const RECEIPT_PREFIX = 'bpp-crm-proposal-create:';
const RECOVERY_MAX_AGE_MS = 15 * 60 * 1000;

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableJson(value[key]);
    }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function fallbackHash(text) {
  var first = 2166136261;
  var second = 2246822519;
  for (var i = 0; i < text.length; i += 1) {
    first = Math.imul(first ^ text.charCodeAt(i), 16777619);
    second = Math.imul(second ^ text.charCodeAt(i), 3266489917);
  }
  return [first, second].map(function (part) {
    return (part >>> 0).toString(16).padStart(8, '0');
  }).join('');
}

async function payloadHash(payload, cryptoApi) {
  var text = stableJson(payload);
  var api = cryptoApi || globalThis.crypto;
  if (api && api.subtle && typeof TextEncoder !== 'undefined') {
    var digest = await api.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }
  return fallbackHash(text);
}

function randomRequestKey(cryptoApi) {
  var api = cryptoApi || globalThis.crypto;
  if (api && typeof api.randomUUID === 'function') {
    return 'crm_create_' + api.randomUUID().replace(/-/g, '');
  }
  if (api && typeof api.getRandomValues === 'function') {
    var bytes = new Uint8Array(16);
    api.getRandomValues(bytes);
    return 'crm_create_' + Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }
  return 'crm_create_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 18);
}

function safeStorage(storage) {
  if (storage) return storage;
  try { return globalThis.sessionStorage || null; } catch (_) { return null; }
}

function readReceipt(storage, key) {
  if (!storage) return null;
  try {
    var value = JSON.parse(storage.getItem(key) || 'null');
    return value && value.schema === RECEIPT_SCHEMA ? value : null;
  } catch (_) {
    return null;
  }
}

function writeReceipt(storage, key, value) {
  if (!storage) return;
  try { storage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

function clearReceipt(storage, key) {
  if (!storage) return;
  try { storage.removeItem(key); } catch (_) {}
}

function currentProposalConflict(error) {
  if (!error || String(error.message || '').indexOf('current_proposal_exists') === -1) {
    return null;
  }
  var detail = error.details || error.detail || null;
  if (typeof detail === 'string') {
    try { detail = JSON.parse(detail); } catch (_) { detail = null; }
  }
  return {
    ok: false,
    code: 'current_proposal_exists',
    error: 'A current draft already exists. Open and edit that draft instead.',
    currentProposalId: detail && detail.current_proposal_id
      ? String(detail.current_proposal_id)
      : null,
    currentProposal: detail && detail.current_proposal
      ? detail.current_proposal
      : null,
  };
}

function proposalIsUntouchedDraft(proposal) {
  var status = String(proposal && proposal.status || '').toLowerCase();
  return (status === 'created' || status === 'draft')
    && !proposal.sent_at
    && !proposal.copied_at
    && !proposal.viewed_at
    && !proposal.signed_at
    && !proposal.approved_at
    && !proposal.accepted_at
    && !proposal.superseded_at
    && !proposal.superseded_by
    && proposal.is_locked !== true;
}

export function proposalCreationPayload(row) {
  var source = row || {};
  return {
    creator_version: String(source.creator_version || 'v4'),
    amp: String(source.selected_amp || source.amp_type || ''),
    length_ft: Number(source.length_ft),
    include_cord: source.include_cord !== false,
    include_inlet: source.include_inlet !== false,
    include_permit: source.include_permit !== false,
    pom_offered: source.pom_offered === true,
    pom_price: Number(source.pom_price == null ? 447 : source.pom_price),
    require_deposit: source.require_deposit !== false,
    show_property_image: source.show_property_image !== false,
    discount_type: source.discount_type || null,
    discount_value: source.discount_value == null ? null : Number(source.discount_value),
    extra_line_items: Array.isArray(source.extra_line_items) ? source.extra_line_items : [],
    total: Number(source.total),
    notes: String(source.notes || ''),
  };
}

export async function createCrmProposalWithRecovery(options) {
  var db = options && options.db;
  var contactId = options && options.contactId;
  if (!db || typeof db.rpc !== 'function') {
    return { ok: false, error: 'Proposal service is unavailable' };
  }
  if (!contactId) return { ok: false, error: 'No contact' };

  var payload = proposalCreationPayload(options && options.payload);
  var hash = await payloadHash(payload, options && options.cryptoApi);
  var storage = safeStorage(options && options.storage);
  var storageKey = RECEIPT_PREFIX + String(contactId);
  var now = options && typeof options.now === 'function' ? options.now() : Date.now();
  var receipt = readReceipt(storage, storageKey);
  var staleMatchingReceipt = receipt
    && receipt.contactId === String(contactId)
    && receipt.payloadHash === hash
    && receipt.state === 'pending'
    && Number(receipt.createdAt) > 0
    && now - Number(receipt.createdAt) > RECOVERY_MAX_AGE_MS;
  if (staleMatchingReceipt) {
    clearReceipt(storage, storageKey);
    return {
      ok: false,
      code: 'proposal_create_recovery_expired',
      error: 'This draft request is old. Refresh and check current proposals before trying again.',
    };
  }
  var reusable = receipt
    && receipt.contactId === String(contactId)
    && receipt.payloadHash === hash
    && Number(receipt.createdAt) > 0
    && receipt.state === 'pending'
    && typeof receipt.requestKey === 'string';

  if (!reusable) {
    receipt = {
      schema: RECEIPT_SCHEMA,
      contactId: String(contactId),
      payloadHash: hash,
      requestKey: randomRequestKey(options && options.cryptoApi),
      createdAt: now,
      state: 'pending',
    };
    writeReceipt(storage, storageKey, receipt);
  }

  var result = await db.rpc('operator_create_crm_proposal_v1', {
    p_contact_id: contactId,
    p_request_key: receipt.requestKey,
    p_payload: payload,
  });
  if (result && result.error) {
    var conflict = currentProposalConflict(result.error);
    if (conflict) {
      conflict.requestKey = receipt.requestKey;
      return conflict;
    }
    return {
      ok: false,
      error: result.error.message || String(result.error),
      requestKey: receipt.requestKey,
    };
  }

  var response = result && result.data;
  var proposal = response && response.proposal;
  if (!response || response.ok !== true || !proposal || !proposal.id) {
    return {
      ok: false,
      error: (response && response.error) || 'Proposal service returned no proposal',
      requestKey: receipt.requestKey,
    };
  }

  if (response.outcome === 'duplicate' && !proposalIsUntouchedDraft(proposal)) {
    clearReceipt(storage, storageKey);
    return {
      ok: false,
      code: 'proposal_create_replay_changed',
      error: 'This recovered proposal changed. Refresh and use the current proposal.',
      currentProposalId: String(proposal.id),
      currentProposal: proposal,
      requestKey: receipt.requestKey,
    };
  }

  clearReceipt(storage, storageKey);
  var parsedContactStage = Number(response.contact_stage);
  return {
    ok: true,
    proposal: proposal,
    outcome: response.outcome,
    contactStage: Number.isSafeInteger(parsedContactStage) && parsedContactStage >= 1
      ? parsedContactStage
      : null,
    supersededProposalIds: response.superseded_proposal_ids || [],
    requestKey: receipt.requestKey,
  };
}
