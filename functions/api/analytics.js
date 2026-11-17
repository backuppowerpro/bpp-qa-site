// Controlled analytics fields are projected per event. Submitted text is never a category.
var ANALYTICS_SCREEN_RULE = { enum: ["unknown", "landing", "location", "connection", "distance",
  "generator_needed", "incomplete", "range", "photos", "photos-later", "thankyou", "contact",
  "recovery", "guided_connection", "guided_location", "guided_distance", "guided_contact",
  "guided_estimate_contact", "guided_recovery", "guided_range", "guided_photos",
  "guided_photos-later", "guided_thankyou", "guided_outlet", "help", "guided_help"] };
var ANALYTICS_TIME_RULE = { enum: [10, 30, 60, 120, 300] };
var ANALYTICS_COMMON = {
  surface: { enum: ["quote_walk", "proposal", "invoice", "receipt", "website"] },
  document_variant: { enum: ["default", "comp", "v4"] },
  funnel: { enum: ["walkv2"] },
  channel: { enum: ["direct", "meta", "google", "organic", "social", "referral", "local",
    "neighbor", "get-quote", "lsa"] },
  walk_entry: { enum: ["direct", "home", "city", "paid"] },
  walk_src: { enum: ["none", "home", "meta", "google", "lp", "quote", "city-hub",
    "city_boiling-springs", "city_clemson", "city_duncan", "city_easley", "city_fountain-inn",
    "city_greenville", "city_greer", "city_inman", "city_mauldin", "city_pickens",
    "city_simpsonville", "city_spartanburg", "city_taylors"] },
  traffic_scope: { enum: ["production", "qa", "preview", "synthetic"] },
  environment: { enum: ["production", "qa", "preview", "test"] },
  is_qa: { boolean: true },
  device_class: { enum: ["mobile", "desktop"] },
  referrer_class: { enum: ["direct", "same_site", "search", "social", "referral"] },
};
var ANALYTICS_SCHEMAS = {
  "$pageview": {},
  "walk_v2_owner_test_classified": {},
  "walk_v2_hero_shown": {
    variant: { enum: ["guided-outlet-v4"] },
  },
  "walk_v2_screen_view": {
    screen: ANALYTICS_SCREEN_RULE,
    blocker_count: { integer: [0, 4] },
    entry_reason: { enum: ["no_generator", "no_compatible_generator_connection"] },
  },
  "walk_v2_confirm_tap": {
    field: { enum: ["panel_room", "distance_band", "connection_status"] },
    connection_count: { integer: [0, 2] },
    pricing_basis: { enum: ["30A", "50A", "30", "50"], optionalNull: true },
  },
  "walk_v2_back_tap": {
    from: { enum: ["location", "connection", "distance"] },
  },
  "walk_v2_return_link_copied": {
    screen: { enum: ["incomplete", "range", "guided_outlet"] },
  },
  "walk_v2_address_lookup_result": {
    outcome: { enum: ["success", "empty", "timeout", "http_error", "network_error"] },
    duration_bucket: { enum: ["under_250ms", "250_to_999ms", "1_to_2999ms", "3s_or_more"] },
    suggestion_count: { integer: [0, 5] },
    input_method: { enum: ["typed", "paste", "autofill_or_unknown", "unknown"] },
    trigger: { enum: ["typing", "focus", "submit_backfill", "formatted_address_recovery", "unknown"] },
  },
  "walk_v2_address_suggestion_selected": {
    rank: { integer: [1, 5] },
    service_area_group: { enum: ["authorized", "other_sc", "out_of_state", "unknown"] },
    input_method: { enum: ["typed", "paste", "autofill_or_unknown", "unknown"] },
  },
  "walk_v2_address_fallback_used": {
    reason: { enum: ["manual_escape", "complete_unselected"] },
    input_method: { enum: ["typed", "paste", "autofill_or_unknown", "unknown"] },
  },
  "walk_v2_form_started": {},
  "walk_v2_consent_checked": {},
  "walk_v2_sms_reminder_shown": {
    source: { enum: ["pre_submit_reminder"], required: true },
    version: { enum: ["bpp-pre-submit-sms-2026-10-16-v1"], required: true },
  },
  "walk_v2_sms_reminder_decided": {
    source: { enum: ["pre_submit_reminder"], required: true },
    version: { enum: ["bpp-pre-submit-sms-2026-10-16-v1"], required: true },
    decision: { enum: ["allow", "continue_without_texts"], required: true },
  },
  "walk_v2_sms_reminder_dismissed": {
    source: { enum: ["pre_submit_reminder"], required: true },
    version: { enum: ["bpp-pre-submit-sms-2026-10-16-v1"], required: true },
  },
  "walk_v2_generator_needed_return_tap": {},
  "walk_v2_generator_needed_back_tap": {},
  "walk_v2_price_shown": {
    state: { enum: ["range"] },
    has_range: { boolean: true },
  },
  "lead_submit_failed": {
    status: { integer: [0, 599] },
    method: { enum: ["fetch", "xhr", "xhr-threw"] },
    form: { enum: ["neighbor", "lsa", "landing_comp"] },
  },
  "walk_v2_photo_uploaded": {
    kind: { enum: ["image", "video"] },
  },
  "walk_v2_photo_upload_failed": {
    kind: { enum: ["image", "video"] },
  },
  "walk_v2_photo_replaced": {
    kind: { enum: ["image", "video"] },
  },
  "walk_v2_photo_replace_failed": {
    kind: { enum: ["image", "video"] },
  },
  "save_for_later_opened": {
    screen: ANALYTICS_SCREEN_RULE,
  },
  "share_invoked": {
    screen: ANALYTICS_SCREEN_RULE,
  },
  "share_cancelled_or_unavailable": {
    screen: ANALYTICS_SCREEN_RULE,
  },
  "share_failed": {
    screen: ANALYTICS_SCREEN_RULE,
  },
  "copy_link_succeeded": {
    screen: ANALYTICS_SCREEN_RULE,
  },
  "copy_link_failed": {
    screen: ANALYTICS_SCREEN_RULE,
  },
  "proposal_viewed": {},
  "proposal_scrolled_to_bottom": {},
  "proposal_time_on_page": {
    seconds: ANALYTICS_TIME_RULE,
  },
  "proposal_action_clicked": {
    action: { enum: ["recovery_text", "recovery_call", "decline", "accept_or_pay"] },
  },
  "invoice_viewed": {},
  "invoice_scrolled_to_bottom": {},
  "invoice_time_on_page": {
    seconds: ANALYTICS_TIME_RULE,
  },
  "invoice_action_clicked": {
    action: { enum: ["recovery_text", "recovery_call", "checkout", "checkout_bank", "checkout_card"] },
  },
  "receipt_viewed": {},
  "receipt_scrolled_to_bottom": {},
  "receipt_time_on_page": {
    seconds: ANALYTICS_TIME_RULE,
  },
  "receipt_action_clicked": {
    action: { enum: ["recovery_text", "recovery_call", "download", "print"] },
  },
  "power_guide_viewed": {},
  "power_guide_download_clicked": { edition: { enum: ["color", "bw"] } },
  "walk_v2_analytics_smoke": {},
};
var ANALYTICS_CONFIRM_PAIRS = {
  panel_room: ["garage", "basement", "outside", "closet", "laundry", "other", "more_than_one_panel",
    "not_sure"],
  distance_band: ["about_5", "5_10", "10_20", "20_40", "over_40", "not_sure"],
  connection_status: ["confirmed_30", "confirmed_50", "pending_access",
    "no_compatible_generator_connection", "no_generator"],
};
var ANALYTICS_SAFE_PATHS = ["/power-guide/", "/power-guide/index.html", "/__qa__/analytics-smoke", "/invoice", "/invoice-comp",
  "/invoice-comp.html", "/invoice-v4", "/invoice-v4.html", "/invoice.html", "/proposal",
  "/proposal-comp", "/proposal-comp.html", "/proposal.html", "/receipt", "/receipt-comp",
  "/receipt-comp.html", "/receipt.html", "/walk-v2/", "/walk-v2/connection",
  "/walk-v2/connection.html", "/walk-v2/connection/", "/walk-v2/distance", "/walk-v2/distance.html",
  "/walk-v2/distance/", "/walk-v2/generator-needed", "/walk-v2/generator-needed.html",
  "/walk-v2/generator-needed/", "/walk-v2/incomplete", "/walk-v2/incomplete.html",
  "/walk-v2/incomplete/", "/walk-v2/index.html", "/walk-v2/location", "/walk-v2/location.html",
  "/walk-v2/location/", "/walk-v2/outlet", "/walk-v2/outlet.html", "/walk-v2/outlet/",
  "/walk-v2/photos", "/walk-v2/photos-later", "/walk-v2/photos-later.html", "/walk-v2/photos-later/",
  "/walk-v2/photos.html", "/walk-v2/photos/", "/walk-v2/range", "/walk-v2/range.html",
  "/walk-v2/range/", "/walk-v2/thankyou", "/walk-v2/thankyou.html", "/walk-v2/thankyou/"];
var ANALYTICS_QA_RUN_LABELS = ["privacy-contract-001", "qa-range-contract-001", "private-run"];
function projectAnalyticsEvent(event, input, origin) {
  if (typeof event !== 'string' || !Object.prototype.hasOwnProperty.call(ANALYTICS_SCHEMAS, event)) return null;
  var schema = ANALYTICS_SCHEMAS[event];
  var output = {};
  if (typeof input.distinct_id !== 'string') return null;
  var identity = input.distinct_id;
  var uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  var ordinary = uuid.test(identity) || /^anon-[a-z0-9]{8,12}-[a-z0-9]{1,12}$/i.test(identity);
  var smoke = event === 'walk_v2_analytics_smoke' && identity.indexOf('analytics-smoke-') === 0 && uuid.test(identity.slice(16));
  if (!ordinary && !smoke) return null;
  var path = input.$pathname;
  if (ANALYTICS_SAFE_PATHS.indexOf(path) === -1 || input.$current_url !== origin + path) return null;
  output.distinct_id = identity;
  output.$pathname = path;
  output.$current_url = origin + path;
  output.$process_person_profile = false;
  if (input.field !== undefined || input.value !== undefined) {
    if (event !== 'walk_v2_confirm_tap' || typeof input.field !== 'string' || typeof input.value !== 'string'
        || !Object.prototype.hasOwnProperty.call(ANALYTICS_CONFIRM_PAIRS, input.field)
        || ANALYTICS_CONFIRM_PAIRS[input.field].indexOf(input.value) === -1) return null;
    output.field = input.field;
    output.value = input.value;
  }
  var keys = Object.keys(ANALYTICS_COMMON).concat(Object.keys(schema));
  for (var index = 0; index < keys.length; index += 1) {
    var key = keys[index];
    if (key === 'field') continue;
    var value = input[key];
    var rule = ANALYTICS_COMMON[key] || schema[key];
    if (value === undefined) { if (rule.required === true) return null; else continue; }
    if (value === null && rule.optionalNull === true) continue;
    var valid = rule.enum ? rule.enum.indexOf(value) !== -1
      : rule.integer ? Number.isInteger(value) && value >= rule.integer[0] && value <= rule.integer[1]
        : rule.boolean ? typeof value === 'boolean' : false;
    if (!valid) {
      // These entry labels originate in query attribution. Unknown labels are omitted.
      if (['channel', 'walk_entry', 'walk_src'].indexOf(key) !== -1) continue;
      return null;
    }
    output[key] = value;
  }
  var runId = input.qa_run_id;
  if (input.is_qa === true && typeof runId === 'string'
      && (uuid.test(runId) || /^live-readonly-[0-9]{13}$/.test(runId)
        || ANALYTICS_QA_RUN_LABELS.indexOf(runId) !== -1)) output.qa_run_id = runId;
  return output;
}

const POSTHOG_PROJECT_KEY = 'phc_qoA51lePZqXYtPJYkrIpdA4U8iMDJ79L1kje7r4pD4O'
const POSTHOG_CAPTURE_URL = 'https://us.i.posthog.com/capture/'
const MAX_BODY_BYTES = 4096
const RATE_LIMIT_PER_MINUTE = 30
const RATE_RETENTION_MINUTES = 1440
const RATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS public_analytics_rate_buckets (
    bucket_minute INTEGER NOT NULL,
    actor_hash TEXT NOT NULL CHECK (length(actor_hash) = 64),
    request_count INTEGER NOT NULL CHECK (request_count > 0),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (bucket_minute, actor_hash)
  )
`
const RATE_PRUNE_SQL = `
  DELETE FROM public_analytics_rate_buckets
  WHERE bucket_minute < ?
`
const RATE_CLAIM_SQL = `
  INSERT INTO public_analytics_rate_buckets (
    bucket_minute,
    actor_hash,
    request_count,
    updated_at
  ) VALUES (?, ?, 1, ?)
  ON CONFLICT (bucket_minute, actor_hash) DO UPDATE SET
    request_count = public_analytics_rate_buckets.request_count + 1,
    updated_at = excluded.updated_at
  RETURNING request_count
`
const SERVER_OWNED_RANGE_EVENTS = new Set([
  'walk_v2_range_presented',
  'walk_v2_range_accepted_view',
  'walk_v2_range_accepted_lead',
  'walk_v2_range_non_yes_reason_saved',
])
const GUIDED_SAVE_EVENTS = new Set([
  'save_for_later_opened', 'share_invoked', 'share_cancelled_or_unavailable',
  'share_failed', 'copy_link_succeeded', 'copy_link_failed',
])
const SAFE_KEYS = new Set([
  'edition', 'surface', 'document_variant', 'funnel', 'screen', 'blocker_count',
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
  'edition', 'surface', 'document_variant', 'funnel', 'screen', 'field', 'value',
  'from', 'state', 'role', 'kind', 'entry_reason', 'pricing_basis',
  'method', 'form', 'connection_status', 'variant', 'walk_entry',
  'walk_src', 'channel', 'action', 'outcome', 'error_class',
  'duration_bucket', 'input_method', 'trigger', 'service_area_group', 'reason'
])
const OPERATIONAL_ENUMS = {
  duration_bucket: new Set(['under_250ms', '250_to_999ms', '1_to_2999ms', '3s_or_more']),
  input_method: new Set(['typed', 'paste', 'autofill_or_unknown', 'unknown']),
  trigger: new Set(['typing', 'focus', 'submit_backfill', 'formatted_address_recovery', 'unknown']),
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

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...RESPONSE_HEADERS, ...extraHeaders },
  })
}

function allowedOrigin(request) {
  const origin = request.headers.get('Origin') || ''
  const requestUrl = new URL(request.url)
  const originUrl = (() => { try { return new URL(origin) } catch (_) { return null } })()
  if (!originUrl || originUrl.origin !== requestUrl.origin) return false
  return originUrl.hostname === 'backuppowerpro.com'
    || originUrl.hostname === 'www.backuppowerpro.com'
    || originUrl.hostname === 'qa.backuppowerpro.com'
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

function requestTrafficContext(request) {
  const originUrl = new URL(request.headers.get('Origin'))
  const hostname = originUrl.hostname.toLowerCase()
  const trafficScope = hostname === 'backuppowerpro.com' || hostname === 'www.backuppowerpro.com'
    ? 'production'
    : hostname === 'qa.backuppowerpro.com' || hostname.endsWith('.bpp-qa-site.pages.dev') ? 'qa' : 'preview'
  return {
    traffic_scope: trafficScope,
    environment: trafficScope,
    is_qa: trafficScope !== 'production',
  }
}

async function rateActorHash(clientIp, nowMs) {
  const daySalt = new Date(nowMs).toISOString().slice(0, 10)
  const subtle = globalThis.crypto && globalThis.crypto.subtle
  if (!subtle) return ''
  const digest = await subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${daySalt}:${clientIp}`),
  )
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

async function claimAnalyticsRateSlot(env, request) {
  const db = env && env.ANALYTICS_RATE_DB
  if (!db || typeof db.prepare !== 'function') return null
  const clientIp = String(request.headers.get('CF-Connecting-IP') || '')
  if (!/^[0-9a-fA-F:.]{3,80}$/.test(clientIp)) return null
  const nowMs = Date.now()
  const bucketMinute = Math.floor(nowMs / 60000)
  try {
    const actorHash = await rateActorHash(clientIp, nowMs)
    if (!/^[a-f0-9]{64}$/.test(actorHash)) return null
    await db.prepare(RATE_TABLE_SQL).run()
    await db.prepare(RATE_PRUNE_SQL)
      .bind(bucketMinute - RATE_RETENTION_MINUTES)
      .run()
    const row = await db.prepare(RATE_CLAIM_SQL)
      .bind(bucketMinute, actorHash, bucketMinute)
      .first()
    const count = Number(row && row.request_count)
    if (!Number.isInteger(count) || count < 1) return null
    return {
      allowed: count <= RATE_LIMIT_PER_MINUTE,
      retryAfter: Math.max(1, 60 - Math.floor((nowMs % 60000) / 1000)),
    }
  } catch (_) {
    return null
  }
}

function sanitizeProperties(input, origin, request) {
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
  const requestContext = requestTrafficContext(request)
  output.traffic_scope = requestContext.traffic_scope
  output.environment = requestContext.environment
  output.is_qa = requestContext.is_qa
  if (!output.is_qa) delete output.qa_run_id
  return output
}

async function forward(payload) {
  const response = await fetch(POSTHOG_CAPTURE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({
      api_key: POSTHOG_PROJECT_KEY,
      event: payload.event,
      uuid: payload.uuid,
      timestamp: payload.timestamp,
      properties: payload.properties,
    }),
  })
  if (!response.ok) throw new Error(`analytics provider returned ${response.status}`)
}

export async function onRequestPost(context) {
  const { request, env } = context
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  // Some embedded browsers omit Fetch Metadata. Exact Origin and JSON remain
  // mandatory; an explicitly cross-origin context is still rejected.
  if (!allowedOrigin(request) || (fetchSite !== null && fetchSite !== 'same-origin')) {
    return json({ error: 'forbidden' }, 403)
  }
  if (request.headers.get('Sec-GPC') === '1' || /^(1|yes)$/i.test(request.headers.get('DNT') || '')) {
    return json({ accepted: false, excluded: true }, 200)
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

  const event = body && typeof body.event === 'string' ? body.event : ''
  if (!GUIDED_SAVE_EVENTS.has(event)
    && !/^(?:\$pageview|lead_submit_failed|power_guide_viewed|power_guide_download_clicked|(?:walk_v2_|proposal_|invoice_|receipt_)[a-z0-9_]{1,70})$/.test(event)) {
    return json({ error: 'invalid_event' }, 400)
  }
  if (SERVER_OWNED_RANGE_EVENTS.has(event)) {
    return json({ error: 'server_owned_measurement' }, 410)
  }
  const origin = new URL(request.url).origin
  const sanitized = sanitizeProperties(body.properties, origin, request)
  const properties = sanitized && projectAnalyticsEvent(event, Object.assign({}, body.properties, {
    $current_url: sanitized.$current_url,
    $process_person_profile: false,
    traffic_scope: sanitized.traffic_scope,
    environment: sanitized.environment,
    is_qa: sanitized.is_qa,
  }), origin)
  if (!properties) return json({ error: 'invalid_properties' }, 400)
  const uuid = body.uuid === undefined ? crypto.randomUUID() : body.uuid
  const timestamp = body.timestamp === undefined ? new Date().toISOString() : body.timestamp
  if (typeof uuid !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(uuid)
    || typeof timestamp !== 'string' || timestamp.length > 32
    || !Number.isFinite(Date.parse(timestamp))) {
    return json({ error: 'invalid_event_identity' }, 400)
  }

  const rate = await claimAnalyticsRateSlot(env, request)
  if (!rate) return json({ error: 'measurement_unavailable' }, 503)
  if (!rate.allowed) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rate.retryAfter) })
  }

  try {
    await forward({ event, properties, uuid, timestamp })
    return json({ accepted: true }, 202)
  } catch (_) {
    console.warn('analytics_provider_unavailable')
    return json({ error: 'provider_unavailable' }, 502)
  }
}
