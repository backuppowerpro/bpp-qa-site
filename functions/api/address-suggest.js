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
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
  )
  providerUrl.searchParams.set('access_token', accessToken)
  providerUrl.searchParams.set('country', 'us')
  providerUrl.searchParams.set('types', 'address')
  providerUrl.searchParams.set('autocomplete', 'true')
  providerUrl.searchParams.set('limit', '10')
  providerUrl.searchParams.set('proximity', '-82.3940,34.8526')

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
      ? payload.features.slice(0, 10).map(boundedFeature)
      : []
    return json({ features }, 200)
  } catch (_) {
    return json({ error: 'provider_unavailable' }, 502)
  }
}

export function onRequestGet() {
  return json({ error: 'method_not_allowed' }, 405)
}
