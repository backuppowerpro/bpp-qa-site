const MAPBOX_REFERER = 'https://qa.backuppowerpro.com/'
const MAX_BODY_BYTES = 512
const MAX_QUERY_LENGTH = 160
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS })
}

function allowedHostname(hostname) {
  return hostname === 'backuppowerpro.com'
    || hostname === 'qa.backuppowerpro.com'
    || hostname === 'www.backuppowerpro.com'
    || hostname === 'bpp-site.pages.dev'
    || hostname === 'bpp-qa-site.pages.dev'
    || hostname.endsWith('.bpp-site.pages.dev')
    || hostname.endsWith('.bpp-qa-site.pages.dev')
}

function allowedOrigin(request) {
  const requestUrl = new URL(request.url)
  const origin = request.headers.get('Origin') || ''
  let originUrl
  try { originUrl = new URL(origin) } catch (_) { return false }
  return allowedHostname(requestUrl.hostname) && originUrl.origin === requestUrl.origin
}

function safeQuery(value) {
  const query = String(value || '').replace(/\s+/g, ' ').trim()
  if (query.length < 3 || query.length > MAX_QUERY_LENGTH) return ''
  if (/[\u0000-\u001f\u007f]/.test(query)) return ''
  return query
}

function stateAwareQuery(query) {
  // Qualify only a bare street or its initial street-name fragment. Keep any
  // supplied locality intact; this search hint never establishes eligibility.
  if (!/^\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+\S/.test(query)
      || query.includes(',') || /\b\d{5}(?:-\d{4})?\b/.test(query)) return query
  const streetSuffix = '(?:aly|alley|ave|avenue|blvd|boulevard|cir|circle|ct|court|dr|drive|expy|expressway|hwy|highway|ln|lane|pkwy|parkway|pl|place|rd|road|route|rte|st|street|ter|terrace|trl|trail|way)'
  const bareStreet = new RegExp(`\\b${streetSuffix}\\.?(?:\\s+(?:n|ne|e|se|s|sw|w|nw))?(?:\\s+(?:apt|apartment|unit|suite|ste|lot|floor|fl|#)\\s*[a-z0-9-]+)?$`, 'i')
  const finalSuffix = bareStreet.exec(query)
  const firstSuffix = new RegExp(`\\b${streetSuffix}\\.?(?=\\s|$)`, 'i').exec(query)
  // Multiple suffix-like words are ambiguous, such as a full street plus CT.
  if (finalSuffix && firstSuffix && finalSuffix.index === firstSuffix.index) return `${query}, South Carolina`
  // A completed street followed by more text can include a city or state,
  // even without commas. Never discard or contradict that trailing locality.
  if (new RegExp(`\\b${streetSuffix}\\.?\\s+`, 'i').test(query)) return query
  const fragment = query.replace(/^\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+/, '')
  if (!/^[a-z'-]{3,}$/i.test(fragment)) return query
  const stateName = /^(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|ohio|oklahoma|oregon|pennsylvania|tennessee|texas|utah|vermont|virginia|washington|wisconsin|wyoming)$/i
  return stateName.test(fragment) ? query : `${query}, South Carolina`
}

function southCarolinaFeature(feature) {
  const regions = Array.isArray(feature && feature.context)
    ? feature.context.filter(item => /^region\./i.test(String(item && item.id || '')))
    : []
  return regions.length > 0 && regions.every(region => {
    const code = String(region && region.short_code || '').trim().toUpperCase()
    return code ? code === 'US-SC'
      : String(region && region.text || '').trim().toUpperCase() === 'SOUTH CAROLINA'
  })
}

function boundedFeature(feature) {
  const context = Array.isArray(feature && feature.context)
    ? feature.context.slice(0, 12).map((item) => ({
      id: String(item && item.id || '').slice(0, 100),
      text: String(item && item.text || '').slice(0, 160),
      short_code: String(item && item.short_code || '').slice(0, 24),
    }))
    : []
  const center = Array.isArray(feature && feature.center) && feature.center.length === 2
    ? feature.center.map(Number)
    : []
  return {
    id: String(feature && feature.id || '').slice(0, 120),
    place_name: String(feature && feature.place_name || '').slice(0, 300),
    center: center.every(Number.isFinite) ? center : [],
    context,
  }
}

export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request)) return json({ error: 'forbidden' }, 403)
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'unsupported_content_type' }, 415)
  }
  const length = Number(request.headers.get('Content-Length') || '0')
  if (length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413)

  let body
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large' }, 413)
    }
    body = JSON.parse(raw)
  } catch (_) {
    return json({ error: 'invalid_json' }, 400)
  }

  const query = safeQuery(body && body.query)
  if (!query) return json({ error: 'invalid_query' }, 400)
  const accessToken = String(env && env.MAPBOX_PUBLIC_TOKEN || '')
  if (!/^pk\.[a-zA-Z0-9._-]{40,300}$/.test(accessToken)) {
    return json({ error: 'provider_unavailable' }, 503)
  }

  const providerUrl = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(stateAwareQuery(query))}.json`,
  )
  providerUrl.searchParams.set('access_token', accessToken)
  providerUrl.searchParams.set('country', 'us')
  providerUrl.searchParams.set('types', 'address')
  providerUrl.searchParams.set('autocomplete', 'true')
  providerUrl.searchParams.set('limit', '10')

  try {
    const provider = await fetch(providerUrl, {
      headers: {
        Accept: 'application/json',
        Referer: MAPBOX_REFERER,
      },
    })
    if (!provider.ok) return json({ error: 'provider_unavailable' }, 502)
    const payload = await provider.json().catch(() => ({}))
    const features = Array.isArray(payload && payload.features)
      ? payload.features.slice(0, 10).filter(southCarolinaFeature).map(boundedFeature)
      : []
    return json({ features }, 200)
  } catch (_) {
    return json({ error: 'provider_unavailable' }, 502)
  }
}

export function onRequestGet() {
  return json({ error: 'method_not_allowed' }, 405)
}
