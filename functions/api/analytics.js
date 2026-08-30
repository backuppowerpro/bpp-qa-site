const POSTHOG_PROJECT_KEY = 'phc_qoA51lePZqXYtPJYkrIpdA4U8iMDJ79L1kje7r4pD4O'
const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/'
const MAX_BODY_BYTES = 4096
const SAFE_KEYS = new Set([
  'surface', 'document_variant', 'funnel', 'screen', 'blocker_count',
  'field', 'value', 'from', 'state', 'has_range', 'unsure_count',
  'journey_version', 'count', 'required_count', 'idx', 'role', 'kind',
  'entry_reason', 'connection_count', 'pricing_basis', 'status', 'method',
  'form', 'delivered', 'connection_status', 'variant', 'walk_entry',
  'walk_src', 'channel', 'action', 'seconds', 'seconds_open', 'outcome',
  'error_class', 'duration_bucket', 'suggestion_count', 'input_method',
  'trigger', 'rank', 'service_area_group', 'reason', 'distinct_id',
  'traffic_scope', 'device_class', 'referrer_class',
  'environment', 'is_qa', 'qa_run_id',
  '$process_person_profile', '$pathname'
])
const SLUG_KEYS = new Set([
  'surface', 'document_variant', 'funnel', 'screen', 'field', 'value',
  'from', 'state', 'role', 'kind', 'entry_reason', 'pricing_basis',
  'method', 'form', 'connection_status', 'variant', 'walk_entry',
  'walk_src', 'channel', 'action', 'outcome', 'error_class',
  'duration_bucket', 'input_method', 'trigger', 'service_area_group', 'reason'
])
const OPERATIONAL_ENUMS = {
  duration_bucket: new Set(['under_250ms', '250_to_999ms', '1_to_2999ms', '3s_or_more']),
  input_method: new Set(['typed', 'paste', 'autofill_or_unknown', 'unknown']),
  trigger: new Set(['typing', 'focus', 'submit_backfill', 'unknown']),
  service_area_group: new Set(['authorized', 'other_sc', 'out_of_state', 'unknown']),
  reason: new Set(['manual_escape', 'complete_unselected']),
  traffic_scope: new Set(['production', 'qa', 'preview', 'synthetic']),
  environment: new Set(['production', 'qa', 'preview', 'test']),
  device_class: new Set(['mobile', 'desktop']),
  referrer_class: new Set(['direct', 'same_site', 'search', 'social', 'referral']),
}
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS })
}

function allowedOrigin(request) {
  const origin = request.headers.get('Origin') || ''
  const requestUrl = new URL(request.url)
  const originUrl = (() => { try { return new URL(origin) } catch (_) { return null } })()
  if (!originUrl || originUrl.origin !== requestUrl.origin) return false
  return originUrl.hostname === 'backuppowerpro.com'
    || originUrl.hostname === 'www.backuppowerpro.com'
    || originUrl.hostname.endsWith('.bpp-site.pages.dev')
    || originUrl.hostname.endsWith('.bpp-qa-site.pages.dev')
}

function safeSlug(value) {
  const text = String(value || '').slice(0, 64)
  if (!/^[a-zA-Z0-9_.:/ -]{1,64}$/.test(text)) return ''
  if (/@/.test(text) || (text.match(/\d/g) || []).length >= 6) return ''
  if (/^\d+\s+.*\b(?:street|road|drive|lane|avenue|court|highway|boulevard|circle|way)\b/i.test(text)) return ''
  return text
}

function sanitizeProperties(input, origin) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const output = {}
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_KEYS.has(key)) continue
    if (key === 'distinct_id') {
      if (!/^(?:anon-)?[a-zA-Z0-9-]{20,80}$/.test(String(value || ''))) return null
      output.distinct_id = String(value)
    } else if (key === '$process_person_profile') {
      output.$process_person_profile = false
    } else if (key === '$pathname') {
      const pathname = String(value || '')
      if (!/^\/[a-zA-Z0-9_./-]{0,160}$/.test(pathname) || pathname.includes('..')) return null
      output.$pathname = pathname
      output.$current_url = origin + pathname
    } else if (OPERATIONAL_ENUMS[key]) {
      if (OPERATIONAL_ENUMS[key].has(value)) output[key] = value
    } else if (key === 'suggestion_count') {
      if (Number.isInteger(value) && value >= 0 && value <= 5) output[key] = value
    } else if (key === 'rank') {
      if (Number.isInteger(value) && value >= 1 && value <= 5) output[key] = value
    } else if (key === 'qa_run_id') {
      if (/^[a-zA-Z0-9_-]{8,80}$/.test(String(value || ''))) output[key] = String(value)
    } else if (typeof value === 'boolean') {
      output[key] = value
    } else if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000) {
      output[key] = value
    } else if (SLUG_KEYS.has(key)) {
      const clean = safeSlug(value)
      if (clean) output[key] = clean
    }
  }
  if (!output.distinct_id || !output.$pathname) return null
  output.$process_person_profile = false
  const scope = output.traffic_scope || 'preview'
  output.environment = scope === 'synthetic' ? 'test' : scope
  output.is_qa = scope !== 'production'
  if (!output.is_qa) delete output.qa_run_id
  return output
}

async function forward(payload) {
  const response = await fetch(POSTHOG_CAPTURE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: POSTHOG_PROJECT_KEY,
      event: payload.event,
      properties: payload.properties,
    }),
  })
  if (!response.ok) throw new Error(`analytics provider returned ${response.status}`)
}

export async function onRequestPost(context) {
  const { request, waitUntil } = context
  if (!allowedOrigin(request) || request.headers.get('Sec-Fetch-Site') !== 'same-origin') {
    return json({ error: 'forbidden' }, 403)
  }
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'unsupported_content_type' }, 415)
  }
  const length = Number(request.headers.get('Content-Length') || '0')
  if (length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413)

  let body
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413)
    body = JSON.parse(raw)
  } catch (_) {
    return json({ error: 'invalid_json' }, 400)
  }

  const event = String(body && body.event || '')
  if (!/^(?:\$pageview|lead_submit_failed|(?:walk_v2_|proposal_|invoice_|receipt_)[a-z0-9_]{1,70})$/.test(event)) {
    return json({ error: 'invalid_event' }, 400)
  }
  const origin = new URL(request.url).origin
  const properties = sanitizeProperties(body.properties, origin)
  if (!properties) return json({ error: 'invalid_properties' }, 400)

  const task = forward({ event, properties }).catch(() => {})
  if (typeof waitUntil === 'function') waitUntil(task)
  else await task
  return json({ accepted: true }, 202)
}
