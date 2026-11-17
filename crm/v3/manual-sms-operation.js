import { readSmsSendEligibility, normalizeSmsRecipient } from './sms-send-eligibility.js';
import { validateMessageAttachmentIntent, messageAttachmentReceiptMatches, messageAttachmentMessageMatches, messageAttachmentKnownUnsent, messageAttachmentActorId } from './message-attachments.js';

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

function operationStorageKey({ scope, contactId, recipientPhone, body, mediaUrls, attachmentIntent, operatorId, semanticId, proposalId, proposalRevision }) {
  const payload = JSON.stringify({
    scope: String(scope || ''),
    contactId: String(contactId || ''),
    ...(recipientPhone ? {recipientPhone:String(recipientPhone)} : {}),
    body: String(body || ''),
    mediaUrls: Array.isArray(mediaUrls) ? mediaUrls.map(String) : [],
    ...(attachmentIntent ? { attachmentIntent } : {}),
    ...(attachmentIntent ? { operatorId } : {}),
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

function attachmentAttemptStorageKey(operatorId,contactId,draftId) {
  return `bpp-message-attachment-attempt-v1:${operatorId}:${contactId}:${draftId}`
}
function readAttachmentAttempt(key,{operatorId,contactId,draftId}) {
  const encoded=storage()?.getItem(key)
  if(!encoded)return null
  const row=JSON.parse(encoded)
  const intent=validateMessageAttachmentIntent(row?.attachment_intent)
  const expectedStorageKey=operationStorageKey({scope:'conversation',contactId,recipientPhone:row?.frozen_phone,
    body:row?.logical_body,mediaUrls:[],attachmentIntent:intent,operatorId,semanticId:'',proposalId:'',proposalRevision:null})
  if(row?.schema!=='bpp_message_attachment_attempt_v1' || row.operator_id!==operatorId || row.contact_id!==contactId
    || row.draft_id!==draftId || intent.draft_id!==draftId || typeof row.logical_body!=='string'
    || normalizeSmsRecipient(row.frozen_phone)!==row.frozen_phone || !KEY_PATTERN.test(row.idempotency_key||'')
    || row.storage_key!==expectedStorageKey)throw Error('Attachment attempt could not be verified')
  return row
}
function writeAttachmentAttempt(key,row) {
  const encoded=JSON.stringify(row),store=storage()
  if(!store)throw Error('Attachment attempt could not be saved')
  store.setItem(key,encoded)
  if(store.getItem(key)!==encoded)throw Error('Attachment attempt could not be saved')
}
function clearAttachmentAttempt(key,operationKey) {
  try{
    const store=storage(),row=JSON.parse(store?.getItem(key)||'null')
    if(row?.idempotency_key===operationKey)store.removeItem(key)
  }catch(_){}
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
  let evidence=data
  try {
    const body = error?.context ? await error.context.json() : null
    if(body && typeof body==='object')evidence=body
    if (body?.error) {
      detail = body.error + (body.detail ? `: ${body.detail}` : '')
    }
    definitive = definitive || body?.definite_failure === true
    providerContacted = providerContacted || body?.provider_contacted === true
    retrySafe = retrySafe || body?.retry_safe === true
  } catch (_) {}
  return { detail, definitive, providerContacted, retrySafe, evidence }
}

export async function sendManualSmsWithReceipt({
  invoke,
  scope,
  contactId,
  recipientPhone,
  body,
  mediaUrls = [],
  attachmentIntent,
  semanticId = '',
  proposalId = '',
  proposalRevision = null,
  testMode = false,
  recoveryOnly = false,
}) {
  let intent
  try {
    if (attachmentIntent !== undefined) {
      intent = validateMessageAttachmentIntent(attachmentIntent)
      if (mediaUrls.length || proposalId || semanticId || scope!=='conversation') throw Error('Conflicting attachment intent')
    }
  } catch (_) { return { ok: false, error: 'Attachment could not be verified. Keep this draft and try again.' } }
  if (typeof invoke !== 'function' || !contactId || (!String(body || '').trim() && !mediaUrls.length && !intent)) {
    return { ok: false, error: 'Message send service is unavailable.' }
  }
  if (proposalId && (!Number.isSafeInteger(Number(proposalRevision)) || Number(proposalRevision) < 1)) {
    return { ok: false, error: 'Refresh this proposal before sending.' }
  }
  let operatorId;
  if(intent){try{operatorId=await messageAttachmentActorId();}catch(_){return {ok:false,error:'Attachment identity could not be verified. Keep this draft and try again.'};}}
  const payload = {scope,contactId,body,mediaUrls,...(intent ? {attachmentIntent:intent,operatorId} : {}),semanticId,proposalId,proposalRevision};
  const expectedRecipient=normalizeSmsRecipient(recipientPhone);
  const attachmentAttemptKey=intent ? attachmentAttemptStorageKey(operatorId,contactId,intent.draft_id) : null;
  if(intent){
    let boundAttempt;
    try{boundAttempt=readAttachmentAttempt(attachmentAttemptKey,{operatorId,contactId,draftId:intent.draft_id});}
    catch(_){return {ok:false,confirmationPending:true,error:'The earlier attachment attempt could not be verified. No new text was sent.'};}
    if(boundAttempt){
      const priorKey=boundAttempt.idempotency_key,priorStorageKey=boundAttempt.storage_key;
      let receiptTimer;
      try{
        const recovered=await Promise.race([
          globalThis.window?.CRM?.__db?.rpc?.('bpp_operator_manual_message_attachment_recovery_by_key',{p_idempotency_key:priorKey}),
          new Promise(resolve=>{receiptTimer=setTimeout(()=>resolve(null),8000);}),
        ]);
        if(await messageAttachmentActorId()!==operatorId)return {ok:false,identityChanged:true,operationKey:priorKey,ambiguous:true,
          error:'Attachment identity changed. The original draft was kept.'};
        const receipt=recovered?.data;
        if(!recovered?.error && receipt?.ok===true && receipt.found===true && receipt.requested_idempotency_key===priorKey
          && messageAttachmentReceiptMatches(receipt,{contactId,recipientPhone:boundAttempt.frozen_phone,operatorId,
            body:boundAttempt.logical_body,attachmentIntent:boundAttempt.attachment_intent,allowCanonicalContact:true})){
          if(receipt.status==='sent'){
            const recoveredMessage=receipt.message || {id:receipt.message_id,contact_id:receipt.contact_id};
            if(!messageAttachmentMessageMatches(recoveredMessage,contactId,receipt.canonical_contact_id))return {ok:false,confirmationPending:true,
              operationKey:priorKey,error:'Delivery confirmation was incomplete. No new text was sent.'};
            clearOperationKey(priorStorageKey,priorKey);clearAttachmentAttempt(attachmentAttemptKey,priorKey);
            const currentMatches=expectedRecipient===boundAttempt.frozen_phone && String(body||'')===boundAttempt.logical_body
              && JSON.stringify(intent)===JSON.stringify(boundAttempt.attachment_intent);
            if(!currentMatches)return {ok:false,delivered:true,recovered:true,recoveredDifferentIntent:true,operationKey:priorKey,
              error:'The earlier send is confirmed. No new text was sent. The current draft was kept.'};
            return {ok:true,operationKey:priorKey,recovered:true,data:{...receipt,success:true,message:recoveredMessage}};
          }
          if(messageAttachmentKnownUnsent(receipt,{contactId,recipientPhone:boundAttempt.frozen_phone,operatorId,
            body:boundAttempt.logical_body,attachmentIntent:boundAttempt.attachment_intent,idempotencyKey:priorKey,recovery:true,allowCanonicalContact:true})){
            clearOperationKey(priorStorageKey,priorKey);clearAttachmentAttempt(attachmentAttemptKey,priorKey);
            return {ok:false,recovered:true,knownUnsent:true,retrySafe:true,providerContacted:false,operationKey:priorKey,
              error:'The earlier send failed. No new text was sent.'};
          }
          return {ok:false,operationKey:priorKey,ambiguous:receipt.status!=='failed',confirmationPending:receipt.status!=='failed',
            error:receipt.status==='failed'?'The earlier send failed. No new text was sent.':'Delivery is still being confirmed. No new text was sent.'};
        }
        // A missing or mismatched read never authorizes a replacement send.
      }catch(_){}
      finally{clearTimeout(receiptTimer);}
      return {ok:false,operationKey:priorKey,ambiguous:true,confirmationPending:true,
        error:'Delivery is still being confirmed. No new text was sent.'};
    }
  }
  if(recoveryOnly)return {ok:false,noExistingAttempt:true,error:'No earlier send receipt is available. No new text was sent.'};
  const eligibility=await readSmsSendEligibility({contactId,phone:recipientPhone});
  if(!eligibility.allowed)return {ok:false,permissionBlocked:true,reason:eligibility.reason,error:eligibility.message};
  if(intent){
    try{
      if(await messageAttachmentActorId()!==operatorId)return {ok:false,identityChanged:true,error:'Attachment identity changed. The original draft was kept.'};
      if(readAttachmentAttempt(attachmentAttemptKey,{operatorId,contactId,draftId:intent.draft_id}))
        return sendManualSmsWithReceipt({invoke,scope,contactId,recipientPhone,body,attachmentIntent:intent,recoveryOnly:true});
    }catch(_){return {ok:false,confirmationPending:true,error:'The earlier attachment attempt could not be verified. No new text was sent.'};}
  }
  // An unresolved pre-upgrade intent must keep its original durable key.
  // Backend payload/phone binding remains authoritative when replaying it.
  const legacyKey=operationStorageKey(payload);
  let hasLegacy=false;
  try{hasLegacy=KEY_PATTERN.test(storage()?.getItem(legacyKey)||'')}catch(_){}
  const storageKey=!intent && hasLegacy ? legacyKey : operationStorageKey({...payload,recipientPhone:eligibility.recipientPhone})
  let operationKey
  try {
    operationKey = operationKeyFor(storageKey)
  } catch (error) {
    return { ok: false, error: error?.message || 'Secure send identity is unavailable.' }
  }

  let attachmentAttempt;
  if(intent){
    attachmentAttempt={schema:'bpp_message_attachment_attempt_v1',operator_id:operatorId,contact_id:contactId,draft_id:intent.draft_id,
      frozen_phone:eligibility.recipientPhone,logical_body:String(body||''),attachment_intent:intent,
      idempotency_key:operationKey,storage_key:storageKey};
    try{writeAttachmentAttempt(attachmentAttemptKey,attachmentAttempt);}
    catch(_){clearOperationKey(storageKey,operationKey);return {ok:false,error:'The attachment attempt could not be saved. The original draft was kept.'};}
  }
  let response
  try {
    if(intent && await messageAttachmentActorId()!==operatorId)return {ok:false,error:'Attachment identity changed. Keep this draft and try again.'};
    response = await invoke('send-sms', { body: {
      contactId,
      expectedPhone:eligibility.recipientPhone,
      body: String(body || ''),
      ...(intent ? { attachmentIntent: intent } : { mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : [] }),
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
  if(intent){
    try{if(await messageAttachmentActorId()!==operatorId)throw Error('identity changed');}
    catch(_){return {ok:false,identityChanged:true,ambiguous:true,operationKey,error:'Attachment identity changed. The original draft was kept.'};}
  }
  if (error || data?.success === false) {
    const failure = await definitiveError(error, data)
    if(intent){
      try{if(await messageAttachmentActorId()!==operatorId)throw Error('identity changed');}
      catch(_){return {ok:false,identityChanged:true,ambiguous:true,operationKey,error:'Attachment identity changed. The original draft was kept.'};}
    }
    const knownUnsent=intent ? messageAttachmentKnownUnsent(failure.evidence,{contactId,recipientPhone:eligibility.recipientPhone,
      operatorId,body,attachmentIntent:intent,idempotencyKey:operationKey}) : failure.definitive && !failure.providerContacted && failure.retrySafe;
    const boundFailure=!intent || failure.evidence?.requested_idempotency_key===operationKey
      && messageAttachmentReceiptMatches(failure.evidence,{contactId,recipientPhone:eligibility.recipientPhone,operatorId,body,attachmentIntent:intent});
    if (knownUnsent) {
      clearOperationKey(storageKey, operationKey)
      if(intent)clearAttachmentAttempt(attachmentAttemptKey,operationKey);
    }
    return {
      ok: false,
      ambiguous: !boundFailure || !failure.definitive,
      providerContacted: failure.providerContacted,
      retrySafe: intent ? knownUnsent : failure.retrySafe,
      operationKey,
      error: failure.definitive
        ? failure.detail
        : 'Delivery confirmation was interrupted. Retry checks the same send and will not create another message.',
    }
  }

  if (intent && data?.success === true && !messageAttachmentReceiptMatches(data, {
    contactId, recipientPhone: eligibility.recipientPhone, operatorId, body, attachmentIntent: intent,
  })) return { ok: false, ambiguous: true, confirmationPending: true, operationKey,
    error: 'Delivery confirmation was incomplete. Retry checks the same send and will not create another message.' }
  if (data?.accepted_ambiguous === true || data?.persistence_pending === true) {
    const recoveryKey = String(data?.recovery_idempotency_key || '')
    if (KEY_PATTERN.test(recoveryKey)) {
      try {
        storage()?.setItem(storageKey, recoveryKey);
        if(intent)writeAttachmentAttempt(attachmentAttemptKey,{...attachmentAttempt,idempotency_key:recoveryKey});
      } catch (_) {}
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

  if(intent){
    const recovery=data?.recovery;
    const canonicalContact=data?.duplicate===true && recovery?.requested_idempotency_key===operationKey
      && recovery?.source_contact_id===contactId && messageAttachmentReceiptMatches(recovery,{
        contactId,recipientPhone:eligibility.recipientPhone,operatorId,body,attachmentIntent:intent})
      ? recovery.canonical_contact_id : undefined;
    if(!messageAttachmentMessageMatches(data?.message,contactId,canonicalContact))return {ok:false,confirmationPending:true,
      operationKey,error:'Delivery confirmation was incomplete. Retry checks the same send and will not create another message.'};
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
  if(intent)clearAttachmentAttempt(attachmentAttemptKey,operationKey);
  return { ok: true, operationKey, data }
}
