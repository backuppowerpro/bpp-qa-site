import { parseSmsSendEligibility } from '../../supabase/functions/_shared/sms-send-eligibility.mjs';

export const SMS_ELIGIBILITY_TTL_MS = 60_000;
const REASONS = Object.freeze({
  checking:'Checking text permission...',
  consent_missing:'Text permission is not recorded.',
  consent_unknown:'Text permission is unknown.',
  permission_unapproved:'Text choice is recorded. Sending is not enabled.',
  consent_declined:'Text updates were not selected.',
  consent_revoked:'Text permission was withdrawn.',
  phone_suppressed:'Texting is blocked by STOP or suppression.',
  recipient_changed:'The phone changed. Text permission must be checked again.',
  contact_unavailable:'This contact is not available for texting.',
  purpose_unapproved:'Permission for this type of text is not verified.',
  eligibility_unavailable:'Text permission could not be checked.',
});
export function smsPermissionMessage(reason) {
  return Object.hasOwn(REASONS,reason)?REASONS[reason]:REASONS.eligibility_unavailable;
}
export function normalizeSmsRecipient(value) {
  if(typeof value!=='string'||value.length>40||!/^\+?[0-9() .-]+$/.test(value))return null;
  let digits=value.replace(/\D/g,'');
  if(digits.length===11&&digits.startsWith('1'))digits=digits.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)?'+1'+digits:null;
}
function blocked(reason='eligibility_unavailable') {
  return {allowed:false,reason,message:smsPermissionMessage(reason),recipientPhone:null,checkedAt:null,expiresAt:0};
}
export function smsSendEligibility(data,{contactId,phone,purpose='quote_install',now=Date.now()}={}) {
  const recipient=normalizeSmsRecipient(phone),proof=data?.sms_send_eligibility;
  if(!recipient||typeof contactId!=='string'||!contactId)return blocked('contact_unavailable');
  if(data?.schema!=='native_operator_exact_message_recipient_v1'||data.requested_contact_id!==contactId
    ||data.contact_id!==contactId||data.recipient_phone!==recipient||data.eligible!==true
    ||proof?.contract!=='bpp-operator-sms-eligibility-v1'||proof.contact_id!==contactId||proof.recipient_phone!==recipient)return blocked();
  const parsed=parseSmsSendEligibility(proof,{contactId,phone:recipient,purpose,now});
  if(parsed.eligible!==true)return blocked(parsed.reason);
  const checked=Date.parse(parsed.checked_at);
  return {allowed:true,reason:'current',message:'',recipientPhone:recipient,checkedAt:checked,expiresAt:checked+SMS_ELIGIBILITY_TTL_MS,revision:parsed.revision};
}
export async function readSmsSendEligibility({contactId,phone,purpose='quote_install',db=globalThis.window?.CRM?.__db,now=Date.now,timeoutMs=8_000}={}) {
  const finish=result=>{
    if(!result.allowed && typeof globalThis.window?.dispatchEvent==='function' && typeof globalThis.CustomEvent==='function') {
      window.dispatchEvent(new CustomEvent('crm-sms-eligibility-denied',{detail:{contactId,phone:normalizeSmsRecipient(phone),purpose,result}}));
    }
    return result;
  };
  if(globalThis.navigator?.onLine===false)return finish(blocked());
  const recipient=normalizeSmsRecipient(phone);
  if(!recipient||typeof contactId!=='string'||!contactId)return finish(blocked('contact_unavailable'));
  if(typeof db?.rpc!=='function')return finish(blocked());
  const localContact=()=>globalThis.window?.CRM?.contacts?.find(c=>c.id===contactId);
  const knownLocal=localContact();
  const localBlock=()=>{
    const current=localContact();
    if(knownLocal && (!current || current.archived))return blocked('contact_unavailable');
    if(current?.do_not_contact)return blocked('phone_suppressed');
    if(current && normalizeSmsRecipient(current.phone)!==recipient)return blocked('recipient_changed');
    return null;
  };
  const before=localBlock();if(before)return finish(before);
  let timer;
  try {
    const request=db.rpc('native_operator_exact_message_recipient',{p_contact_id:contactId,p_expected_phone:recipient,p_expected_revision:null});
    const boundedMs=Number.isFinite(timeoutMs)?Math.min(8_000,Math.max(1,timeoutMs)):8_000;
    const result=await Promise.race([request,new Promise(resolve=>{timer=setTimeout(()=>resolve({error:{message:'eligibility_timeout'}}),boundedMs);})]);
    if(result?.error) {
      const message=String(result.error.message||'');
      return finish(blocked(/recipient_do_not_contact|phone_suppressed/.test(message)?'phone_suppressed':/recipient_stale|recipient_changed/.test(message)?'recipient_changed':'eligibility_unavailable'));
    }
    const after=localBlock();if(after)return finish(after);
    return finish(smsSendEligibility(result?.data,{contactId,phone:recipient,purpose,now:now()}));
  }catch(_){return finish(blocked());}finally{clearTimeout(timer);}
}
