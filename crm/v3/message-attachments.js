import { smsPermissionMessage } from './sms-send-eligibility.js'

// Stable message intent only. Provider access is created by the server at dispatch.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'])
const DRAFT_PREFIX = 'bpp-message-attachment-draft-v1:'
const KNOWN_UNSENT = new Set(['message_attachment_configuration_unavailable','message_attachment_issuer_unavailable',
  'message_attachment_claim_unavailable','message_attachment_dispatch_unavailable','message_attachment_callback_unavailable',
  'message_attachment_unavailable','message_attachment_rate_limited','sms_eligibility_unavailable']
  .map(reason=>'message_attachment_unsent_v1:'+reason))
const draftStorageKey = (contactId, operatorId) => DRAFT_PREFIX + operatorId + ':' + contactId
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const fail = () => { throw Error('Attachment could not be verified. Keep this draft and try again.') }
export const privateMessageMediaMarker = id => UUID.test(id || '') ? 'bpp-private-media:v1:' + id : ''
// Presentation only. Send/retry decisions continue to use the original receipt.
export function messageAttachmentOperatorError(reason, { retrySafe=false }={}) {
  const text=String(reason || '')
  const code=text.replace(/^message_attachment_unsent_v1:/,'').split(':',1)[0]
  if(['message_attachment_configuration_unavailable','message_attachment_delivery_disabled','message_attachments_disabled','private_media_delivery_unavailable'].includes(code))
    return 'Attachment sending is not available yet. Your draft was kept. Ask for it to be enabled.'
  if(['message_attachment_issuer_unavailable','message_attachment_claim_unavailable','message_attachment_dispatch_unavailable',
    'message_attachment_callback_unavailable','message_attachment_authority_unavailable','message_attachment_registration_failed',
    'message_attachment_rate_limited','private_media_upload_failed','sms_eligibility_unavailable'].includes(code))
    return 'Attachment sending is temporarily unavailable. Your draft was kept. '+(retrySafe ? 'Try again shortly.' : 'Check delivery before trying again.')
  if(/^sms_[a-z_]+$/.test(code))
    return smsPermissionMessage(code.slice(4))+" Your draft was kept. Review the contact's text permission."
  if(['do_not_contact','recipient_do_not_contact','phone_suppressed','consent_missing','consent_unknown','permission_unapproved',
    'consent_declined','consent_revoked','recipient_changed','contact_unavailable','purpose_unapproved','eligibility_unavailable'].includes(code))
    return smsPermissionMessage(['do_not_contact','recipient_do_not_contact'].includes(code)?'phone_suppressed':code)+" Your draft was kept. Review the contact's text permission."
  if(['operator_identity_required','operator_required'].includes(code))
    return 'Your operator identity could not be verified. Your draft was kept. Sign in again before sending.'
  if(code==='unsupported_attachment_format')
    return 'This file type cannot be attached. Your draft was kept. Choose a JPEG, PNG, GIF or PDF.'
  if(['message_attachment_mms_unsupported','message_attachment_format_or_size_unsupported'].includes(code))
    return 'This file cannot be sent as a picture message. Your draft was kept. Choose a supported image or a smaller PDF.'
  if(['message_attachment_mms_too_large','message_attachment_aggregate_too_large'].includes(code))
    return 'These attachments are too large to text. Your draft was kept. Choose smaller files.'
  if(code==='message_attachment_transport_too_long')
    return 'This text and its file links are too long. Your draft was kept. Shorten the text and try again.'
  if(code==='legacy_line_media_unavailable')
    return 'This phone line cannot send picture attachments. Your draft was kept. Use a supported text line.'
  if(code==='message_attachment_provider_opted_out')
    return 'Texting is blocked for this number. Your draft was kept. Use another agreed contact method.'
  if(code==='message_attachment_provider_rejected')
    return 'The text provider refused this message. Your draft was kept. Review the contact and file details.'
  if(/^[a-z][a-z0-9_]+$/.test(code))
    return 'Attachment delivery could not be confirmed. Your draft was kept. Check delivery before trying again.'
  return text
}
export function messageAttachmentPreviewText(body) {
  return typeof body==='string' && /^\[attachment-intent:v1:[a-f0-9]{64}\]$/.test(body) ? 'Attachment' : body
}
function allowedLegacyUrl(value) {
  try {
    const url=new URL(value)
    let storageHost=''
    try{storageHost=new URL(globalThis.window?.CRM?.__url || '').host}catch(_){}
    const allowedPath=url.host===storageHost && /^\/storage\/v1\/object\/public\/(?:message-media|job-photos|walk-photos)\//.test(url.pathname)
      || ['backuppowerpro.com','www.backuppowerpro.com'].includes(url.host)
        && (/^\/(?:img|assets)\//.test(url.pathname) || url.pathname==='/walk-v2/closed-panel-example.jpg')
    return url.protocol==='https:' && !url.username && !url.password && !url.hash && !url.search && allowedPath
  }catch(_){return false}
}
export function messageAttachmentFiles(body) {
  return [...String(body||'').matchAll(/\[file:([^\]]+)\]/g)].map(match=>match[1])
    .filter(value=>value.startsWith('bpp-private-media:v1:') ? UUID.test(value.slice(21)) : allowedLegacyUrl(value))
}

export function validateMessageAttachmentIntent(value) {
  if (!exactKeys(value, ['schema', 'draft_id', 'items']) || value.schema !== 'bpp_message_attachments_v1'
    || !UUID.test(value.draft_id || '') || !Array.isArray(value.items) || !value.items.length || value.items.length > 10) fail()
  const seen = new Set()
  const items = value.items.map(item => {
    if (!['mms', 'customer_link'].includes(item?.delivery)) fail()
    let key, normalized
    if (item.source === 'private' && exactKeys(item, ['source', 'media_id', 'delivery']) && UUID.test(item.media_id || '')) {
      key = 'private:' + item.media_id
      normalized = { source: 'private', media_id: item.media_id, delivery: item.delivery }
    } else if (item.source === 'legacy' && exactKeys(item, ['source', 'url', 'delivery']) && typeof item.url === 'string') {
      if (!allowedLegacyUrl(item.url)) fail()
      key = 'legacy:' + item.url
      normalized = { source: 'legacy', url: item.url, delivery: item.delivery }
    } else fail()
    if (seen.has(key)) fail()
    seen.add(key)
    return normalized
  })
  return { schema: 'bpp_message_attachments_v1', draft_id: value.draft_id, items }
}

export function messageAttachmentReceiptMatches(receipt, { contactId, recipientPhone, operatorId, body, attachmentIntent, allowCanonicalContact=false }) {
  try {
    const expected = validateMessageAttachmentIntent(attachmentIntent)
    const sourceMatches=allowCanonicalContact ? receipt?.source_contact_id===contactId && UUID.test(receipt?.canonical_contact_id || '')
      && receipt?.contact_id===receipt.canonical_contact_id
      : receipt?.contact_id===contactId && (receipt.source_contact_id===undefined || receipt.source_contact_id===contactId)
    return UUID.test(operatorId || '') && receipt?.operator_id===operatorId
      && sourceMatches && receipt?.frozen_phone === recipientPhone
      && receipt.logical_body === String(body || '')
      && JSON.stringify(validateMessageAttachmentIntent(receipt.attachment_intent)) === JSON.stringify(expected)
  } catch (_) { return false }
}
export function messageAttachmentMessageMatches(message, contactId, canonicalContactId) {
  return UUID.test(message?.id || '') && UUID.test(message?.contact_id || '')
    && (message.contact_id===contactId || UUID.test(canonicalContactId || '') && message.contact_id===canonicalContactId)
}
export function messageAttachmentKnownUnsent(receipt, expected) {
  const durable=KNOWN_UNSENT.has(receipt?.failure_code)
  const proof=expected.recovery ? receipt?.status==='failed' && durable
    : durable && receipt?.known_unsent_failure_code===receipt.failure_code
      && receipt?.definite_failure===true && receipt?.provider_contacted===false && receipt?.retry_safe===true
  return proof
    && receipt?.requested_idempotency_key===expected.idempotencyKey && messageAttachmentReceiptMatches(receipt,expected)
}

export async function messageAttachmentActorId() {
  const crm = globalThis.window?.CRM
  if (crm?.authed === false || !crm?.__db?.auth?.getSession) fail()
  const response = await crm.__db.auth.getSession()
  const id = response?.data?.session?.user?.id
  if (response?.error || !UUID.test(id || '')) fail()
  return id
}
function store() {
  try { return globalThis.localStorage || globalThis.window?.localStorage } catch (_) { return null }
}
function descriptor(value, contactId, draftId, file) {
  if (!exactKeys(value, ['schema', 'media_id', 'contact_id', 'draft_id', 'mime_type', 'byte_size'])
    || value.schema !== 'bpp_message_attachment_v1' || !UUID.test(value.media_id || '')
    || value.contact_id !== contactId || value.draft_id !== draftId || !MIME.has(value.mime_type)
    || !Number.isSafeInteger(value.byte_size) || value.byte_size <= 0 || value.byte_size > 15 * 1024 * 1024
    || file && (value.mime_type !== file.type || value.byte_size !== file.size)) fail()
  return { ...value }
}
function draftRow(attachment, contactId, draftId) {
  const ref = attachment.attachment ? descriptor(attachment.attachment, contactId, draftId) : null
  return { name: String(attachment.name || attachment.file?.name || 'attachment').slice(0, 160),
    type: attachment.type === 'image' ? 'image' : 'file',
    ...(ref ? { attachment: ref } : { needsSelection: true }) }
}
function writeDraft(contactId, operatorId, draftId, body, attachments) {
  if (!UUID.test(contactId || '') || !UUID.test(operatorId || '') || !UUID.test(draftId || '')) fail()
  const storage = store()
  if (!storage) fail()
  const record = { schema: 'bpp_message_attachment_draft_v1', contact_id: contactId,
    operator_id: operatorId, draft_id: draftId, body: String(body || ''),
    attachments: attachments.map(item => draftRow(item, contactId, draftId)) }
  const encoded = JSON.stringify(record)
  storage.setItem(draftStorageKey(contactId,operatorId), encoded)
  if (storage.getItem(draftStorageKey(contactId,operatorId)) !== encoded) fail()
}

export async function restoreMessageAttachmentDraft(contactId) {
  try {
    const operatorId = await messageAttachmentActorId()
    const record = JSON.parse(store()?.getItem(draftStorageKey(contactId,operatorId)) || 'null')
    if (!record || record.schema !== 'bpp_message_attachment_draft_v1' || record.contact_id !== contactId
      || record.operator_id !== operatorId || !UUID.test(record.draft_id || '') || typeof record.body !== 'string'
      || !Array.isArray(record.attachments) || !record.attachments.length || record.attachments.length > 10) return null
    const attachments = record.attachments.map(item => {
      const ref = item.attachment ? descriptor(item.attachment, contactId, record.draft_id) : null
      return { name: String(item.name || 'attachment'), type: item.type === 'image' ? 'image' : 'file',
        draftId: record.draft_id, ...(ref ? { attachment: ref, url: privateMessageMediaMarker(ref.media_id) } : { needsSelection: true }) }
    })
    if(await messageAttachmentActorId()!==operatorId)return null
    return { body: record.body, attachments, draftId: record.draft_id }
  } catch (_) { return null }
}

export function messageAttachmentDraftIntent(record) {
  if(!record?.attachments?.length || record.attachments.some(item=>!item.attachment)) return null
  return validateMessageAttachmentIntent({schema:'bpp_message_attachments_v1',draft_id:record.draftId,
    items:record.attachments.map(item=>({source:'private',media_id:item.attachment.media_id,
      delivery:item.type==='image'?'mms':'customer_link'}))})
}

export async function clearMessageAttachmentDraft(contactId, draftId, expected) {
  try {
    const operatorId = await messageAttachmentActorId(), storage = store()
    const record = JSON.parse(storage?.getItem(draftStorageKey(contactId,operatorId)) || 'null')
    if (record?.operator_id !== operatorId || record?.contact_id !== contactId || record?.draft_id !== draftId)return
    if(expected && (record.body!==expected.body || JSON.stringify(messageAttachmentDraftIntent({draftId,attachments:record.attachments}))!==JSON.stringify(validateMessageAttachmentIntent(expected.attachmentIntent))))return
    storage.removeItem(draftStorageKey(contactId,operatorId))
  } catch (_) {}
}

export async function retainMessageAttachmentDraft(contactId, body, attachments) {
  const draftId = attachments.find(item => item.attachment)?.attachment?.draft_id || attachments.find(item => item.draftId)?.draftId
  if (!draftId) return
  if (!attachments.length) return
  writeDraft(contactId, await messageAttachmentActorId(), draftId, body, attachments)
}

export async function prepareMessageAttachments({ contactId, body, attachments, upload }) {
  if (!Array.isArray(attachments) || attachments.length > 10 || typeof upload !== 'function') fail()
  if (!attachments.length) return null
  const operatorId = await messageAttachmentActorId()
  const draftId = attachments.find(item => item.attachment)?.attachment?.draft_id
    || attachments.find(item => item.draftId)?.draftId || globalThis.crypto?.randomUUID?.()
  if (!UUID.test(draftId || '')) fail()
  for (const item of attachments) {
    if (item.draftId && item.draftId !== draftId || item.attachment && item.attachment.draft_id !== draftId) fail()
    item.draftId = draftId
  }
  // Preserve pending file metadata too, so reload cannot silently downgrade a
  // partly uploaded attachment batch into a text-only message.
  writeDraft(contactId, operatorId, draftId, body, attachments)
  const items = []
  for (const item of attachments) {
    let ref
    if (item.attachment) ref = descriptor(item.attachment, contactId, draftId, item.file)
    else {
      if (!item.file || item.needsSelection || !MIME.has(item.file.type)) fail()
      const result = await upload(item.file, contactId, draftId)
      if(await messageAttachmentActorId()!==operatorId)fail()
      ref = descriptor(result?.attachment, contactId, draftId, item.file)
      if (result.url !== privateMessageMediaMarker(ref.media_id)
        || result.mediaRef?.schema !== 'bpp_private_media_ref_v1' || result.mediaRef.media_id !== ref.media_id
        || result.mediaRef.contact_id !== contactId) fail()
      item.attachment = ref
      writeDraft(contactId, operatorId, draftId, body, attachments)
    }
    if ((item.type === 'image') !== ref.mime_type.startsWith('image/')) fail()
    items.push({ source: 'private', media_id: ref.media_id,
      delivery: item.type === 'image' ? 'mms' : 'customer_link' })
  }
  if(await messageAttachmentActorId()!==operatorId)fail()
  return validateMessageAttachmentIntent({ schema: 'bpp_message_attachments_v1', draft_id: draftId, items })
}

export function messageAttachmentDisplayBody(body, attachmentIntent) {
  const intent = validateMessageAttachmentIntent(attachmentIntent)
  const tokens = intent.items.map(item => '[' + (item.delivery === 'mms' ? 'media' : 'file') + ':'
    + (item.source === 'private' ? privateMessageMediaMarker(item.media_id) : item.url) + ']')
  return tokens.join(' ') + (body ? ' ' + body : '')
}

export function useMessageAttachmentHistory(React, messages, contactId) {
  const [history, setHistory] = React.useState({})
  const [authEpoch,setAuthEpoch]=React.useState(0)
  React.useEffect(()=>{
    const clear=()=>{setHistory({});setAuthEpoch(value=>value+1)}
    window.addEventListener('bpp-private-media-cleared',clear)
    window.addEventListener('crm-data-ready',clear)
    return ()=>{window.removeEventListener('bpp-private-media-cleared',clear);window.removeEventListener('crm-data-ready',clear)}
  },[])
  const ids = (messages || []).filter(message => /^\[attachment-intent:v1:[a-f0-9]{64}\]$/.test(message.body || ''))
    .map(message => String(message.id)).join(',')
  React.useEffect(() => {
    let active = true
    setHistory({})
    if (!ids || !contactId || globalThis.window?.CRM?.authed===false || !globalThis.window?.CRM?.__db?.rpc) return
    Promise.all(ids.split(',').map(async id => {
      try {
        const operatorId=await messageAttachmentActorId()
        const result = await window.CRM.__db.rpc('bpp_operator_message_attachment_history_v1', { p_message_id: id })
        if(await messageAttachmentActorId()!==operatorId)return null
        const row = result?.data
        if (result?.error || row?.schema !== 'bpp_message_attachment_history_v1' || row.message_id !== id
          || row.contact_id !== contactId || typeof row.logical_body !== 'string') return null
        return [id, messageAttachmentDisplayBody(row.logical_body, row.attachment_intent)]
      } catch (_) { return null }
    })).then(rows => { if (active && window.CRM?.authed!==false) setHistory({contactId,ids,rows:Object.fromEntries(rows.filter(Boolean))}) })
    return () => { active = false }
  }, [ids, contactId,authEpoch])
  return (messages || []).map(message => /^\[attachment-intent:v1:[a-f0-9]{64}\]$/.test(message.body || '')
    ? { ...message, body: window.CRM?.authed!==false && history.contactId===contactId && history.ids===ids ? history.rows[message.id] || '' : '' } : message)
}
