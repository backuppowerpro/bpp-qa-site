/* Privacy-safe analytics for Quote Walk and customer money documents.
 * Range funnel facts come from server-owned journey records, never from a
 * browser analytics claim. Other events use an anonymous browser ID. */
(function () {
  'use strict';

  var CAPTURE_URL = '/api/analytics';
  var STORAGE_KEY = 'bpp:analytics:id';
  var SERVER_OWNED_RANGE_EVENTS = new Set([
    'walk_v2_range_presented',
    'walk_v2_range_accepted_view',
    'walk_v2_range_accepted_lead',
    'walk_v2_range_non_yes_reason_saved'
  ]);
  var SAFE_KEYS = new Set([
    'surface', 'document_variant', 'funnel', 'screen', 'blocker_count',
    'field', 'value', 'from', 'state', 'has_range', 'unsure_count',
    'journey_version', 'count', 'required_count', 'idx', 'role', 'kind',
    'entry_reason', 'connection_count', 'pricing_basis', 'status', 'method',
    'form', 'delivered', 'connection_status', 'variant', 'walk_entry',
    'walk_src', 'channel', 'action', 'seconds', 'seconds_open', 'outcome',
    'error_class', 'duration_bucket', 'suggestion_count', 'input_method',
    'trigger', 'rank', 'service_area_group', 'reason', 'traffic_scope',
    'device_class', 'referrer_class', 'environment', 'is_qa', 'qa_run_id'
  ]);
  var SLUG_KEYS = new Set([
    'surface', 'document_variant', 'funnel', 'screen', 'field', 'value',
    'from', 'state', 'role', 'kind', 'entry_reason', 'pricing_basis',
    'method', 'form', 'connection_status', 'variant', 'walk_entry',
    'walk_src', 'channel', 'action', 'outcome', 'error_class',
    'duration_bucket', 'input_method', 'trigger', 'service_area_group', 'reason'
  ]);
  var OPERATIONAL_ENUMS = {
    duration_bucket: new Set(['under_250ms', '250_to_999ms', '1_to_2999ms', '3s_or_more']),
    input_method: new Set(['typed', 'paste', 'autofill_or_unknown', 'unknown']),
    trigger: new Set(['typing', 'focus', 'submit_backfill', 'unknown']),
    service_area_group: new Set(['authorized', 'other_sc', 'out_of_state', 'unknown']),
    reason: new Set(['manual_escape', 'complete_unselected']),
    traffic_scope: new Set(['production', 'qa', 'preview', 'synthetic']),
    environment: new Set(['production', 'qa', 'preview', 'test']),
    device_class: new Set(['mobile', 'desktop']),
    referrer_class: new Set(['direct', 'same_site', 'search', 'social', 'referral'])
  };

  function privacyBlocked() {
    return navigator.globalPrivacyControl === true
      || navigator.doNotTrack === '1'
      || window.doNotTrack === '1';
  }

  function analyticsTestMode() {
    try {
      return new URLSearchParams(window.location.search || '').get('analytics_test') === '1';
    } catch (_) {
      return false;
    }
  }

  function randomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'anon-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
  }

  function distinctId() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (/^(?:anon-)?[a-zA-Z0-9-]{20,80}$/.test(saved || '')) return saved;
      var next = randomId();
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    } catch (_) {
      return randomId();
    }
  }

  function safeString(value) {
    var text = String(value || '').slice(0, 64);
    if (!/^[a-zA-Z0-9_.:/ -]{1,64}$/.test(text)) return '';
    if (/@/.test(text) || (text.match(/\d/g) || []).length >= 6) return '';
    if (/^\d+\s+.*\b(?:street|road|drive|lane|avenue|court|highway|boulevard|circle|way)\b/i.test(text)) return '';
    return text;
  }

  function safeProps(input) {
    var output = {};
    Object.keys(input || {}).forEach(function (key) {
      if (!SAFE_KEYS.has(key)) return;
      var value = input[key];
      if (OPERATIONAL_ENUMS[key]) {
        if (OPERATIONAL_ENUMS[key].has(value)) output[key] = value;
      } else if (key === 'suggestion_count') {
        if (Number.isInteger(value) && value >= 0 && value <= 5) output[key] = value;
      } else if (key === 'rank') {
        if (Number.isInteger(value) && value >= 1 && value <= 5) output[key] = value;
      } else if (key === 'qa_run_id') {
        if (/^[a-zA-Z0-9_-]{8,80}$/.test(String(value || ''))) output[key] = String(value);
      } else if (typeof value === 'boolean') {
        output[key] = value;
      } else if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000) {
        output[key] = value;
      } else if (SLUG_KEYS.has(key)) {
        var clean = safeString(value);
        if (clean) output[key] = clean;
      }
    });
    return output;
  }

  function surfaceContext() {
    var path = window.location.pathname || '/';
    var filename = path.split('/').pop() || 'index.html';
    var surface = path.indexOf('/walk-v2/') === 0 ? 'quote_walk'
      : filename.indexOf('proposal') === 0 ? 'proposal'
        : filename.indexOf('invoice') === 0 ? 'invoice'
          : filename.indexOf('receipt') === 0 ? 'receipt' : 'website';
    var variant = /-comp\.html$/.test(filename) ? 'comp'
      : /-v4\.html$/.test(filename) ? 'v4' : 'default';
    return { surface: surface, document_variant: variant };
  }

  function trafficScope() {
    var host = String(window.location.hostname || '').toLowerCase();
    if (host === 'backuppowerpro.com' || host === 'www.backuppowerpro.com') return 'production';
    if (host === 'qa.backuppowerpro.com' || host.indexOf('bpp-qa-site.pages.dev') !== -1) return 'qa';
    var params = new URLSearchParams(window.location.search || '');
    if (params.get('analytics_test') === '1' || params.get('preview') === '1') return 'synthetic';
    return 'preview';
  }

  function deviceClass() {
    var width = Number(window.innerWidth || document.documentElement.clientWidth || 0);
    return width > 0 && width <= 767 ? 'mobile' : 'desktop';
  }

  function referrerClass() {
    if (!document.referrer) return 'direct';
    try {
      var host = new URL(document.referrer).hostname.toLowerCase();
      var current = String(window.location.hostname || '').toLowerCase();
      if (host === current || host === 'backuppowerpro.com' || host === 'www.backuppowerpro.com') return 'same_site';
      if (/^(?:www\.)?(?:google|bing|yahoo|duckduckgo)\./.test(host)) return 'search';
      if (/(?:facebook|instagram|threads|tiktok|linkedin|youtube)\./.test(host)) return 'social';
      return 'referral';
    } catch (_) {
      return 'referral';
    }
  }

  function baseProperties() {
    var path = window.location.pathname || '/';
    var context = surfaceContext();
    var scope = trafficScope();
    var base = {
      distinct_id: distinctId(),
      $process_person_profile: false,
      $current_url: (window.location.origin || '') + path,
      $pathname: path,
      surface: context.surface,
      document_variant: context.document_variant,
      channel: safeString(window.__WALK_CHANNEL || ''),
      walk_entry: safeString(window.__WALK_ENTRY || ''),
      walk_src: safeString(window.__WALK_SRC || ''),
      traffic_scope: scope,
      environment: scope === 'synthetic' ? 'test' : scope,
      is_qa: scope !== 'production',
      device_class: deviceClass(),
      referrer_class: referrerClass()
    };
    if (scope === 'synthetic') {
      var runId = new URLSearchParams(window.location.search || '').get('qa_run_id') || '';
      if (/^[a-zA-Z0-9_-]{8,80}$/.test(runId)) base.qa_run_id = runId;
    }
    return base;
  }

  function capture(event, properties) {
    if (privacyBlocked() || analyticsTestMode()) return false;
    if (!/^\$pageview$|^[a-z][a-z0-9_]{2,80}$/.test(String(event || ''))) return false;
    if (SERVER_OWNED_RANGE_EVENTS.has(event)) return false;
    var payload = {
      event: event,
      properties: Object.assign(baseProperties(), safeProps(properties))
    };
    try {
      fetch(CAPTURE_URL, {
        method: 'POST',
        mode: 'same-origin',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function () {});
      return true;
    } catch (_) {
      return false;
    }
  }

  function moneyAction(surface, text, href) {
    if (/^sms:/i.test(href)) return 'recovery_text';
    if (/^tel:/i.test(href)) return 'recovery_call';
    if (surface === 'proposal') {
      if (/decline|reject|not interested/.test(text)) return 'decline';
      if (/approve|accept|pay|lock in/.test(text)) return 'accept_or_pay';
    }
    if (surface === 'invoice' && /pay|checkout|continue to stripe/.test(text)) {
      if (/bank|ach/.test(text)) return 'checkout_bank';
      if (/card|credit|debit/.test(text)) return 'checkout_card';
      return 'checkout';
    }
    if (surface === 'receipt') {
      if (/download|save.*pdf/.test(text)) return 'download';
      if (/print/.test(text)) return 'print';
    }
    return '';
  }

  function startMoneyDocumentTracking(surface) {
    capture(surface + '_viewed');
    [10, 30, 60, 120, 300].forEach(function (seconds) {
      setTimeout(function () { capture(surface + '_time_on_page', { seconds: seconds }); }, seconds * 1000);
    });

    var bottomSeen = false;
    window.addEventListener('scroll', function () {
      if (bottomSeen) return;
      var page = document.documentElement;
      if (!page.scrollHeight || (page.scrollTop + page.clientHeight) / page.scrollHeight <= 0.9) return;
      bottomSeen = true;
      capture(surface + '_scrolled_to_bottom');
    }, { passive: true });

    document.addEventListener('click', function (event) {
      var target = event.target && typeof event.target.closest === 'function'
        ? event.target.closest('button, a') : null;
      if (!target) return;
      var action = moneyAction(
        surface,
        String(target.textContent || '').trim().toLowerCase(),
        String(target.getAttribute('href') || '')
      );
      if (action) capture(surface + '_action_clicked', { action: action });
    }, { capture: true });
  }

  window.BPPAnalytics = Object.freeze({ capture: capture });
  window.addEventListener('bpp:walk-event', function (event) {
    var detail = event && event.detail || {};
    capture(detail.event, detail);
  });

  function ready() {
    if (new URLSearchParams(window.location.search).get('preview') === '1') return;
    var context = surfaceContext();
    capture('$pageview', context);
    if (context.surface === 'proposal' || context.surface === 'invoice' || context.surface === 'receipt') {
      startMoneyDocumentTracking(context.surface);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
