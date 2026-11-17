/* Privacy-safe analytics for Quote Walk and customer money documents.
 * Range funnel facts come from server-owned journey records, never from a
 * browser analytics claim. Other events use an anonymous browser ID. */
(function () {
  'use strict';

  var CAPTURE_URL = '/api/analytics';
  var STORAGE_KEY = 'bpp:analytics:id';
  var pageDistinctId = '';
  var SERVER_OWNED_RANGE_EVENTS = new Set([
    'walk_v2_range_presented',
    'walk_v2_range_accepted_view',
    'walk_v2_range_accepted_lead',
    'walk_v2_range_non_yes_reason_saved'
  ]);
  var SAFE_KEYS = new Set([
    'edition', 'surface', 'document_variant', 'funnel', 'screen', 'blocker_count',
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
    'edition', 'surface', 'document_variant', 'funnel', 'screen', 'field', 'value',
    'from', 'state', 'role', 'kind', 'entry_reason', 'pricing_basis',
    'method', 'form', 'connection_status', 'variant', 'walk_entry',
    'walk_src', 'channel', 'action', 'outcome', 'error_class',
    'duration_bucket', 'input_method', 'trigger', 'service_area_group', 'reason'
  ]);
  var OPERATIONAL_ENUMS = {
    duration_bucket: new Set(['under_250ms', '250_to_999ms', '1_to_2999ms', '3s_or_more']),
    input_method: new Set(['typed', 'paste', 'autofill_or_unknown', 'unknown']),
    trigger: new Set(['typing', 'focus', 'submit_backfill', 'formatted_address_recovery', 'unknown']),
    service_area_group: new Set(['authorized', 'other_sc', 'out_of_state', 'unknown']),
    reason: new Set(['manual_escape', 'complete_unselected']),
    traffic_scope: new Set(['production', 'qa', 'preview', 'synthetic']),
    environment: new Set(['production', 'qa', 'preview', 'test']),
    device_class: new Set(['mobile', 'desktop']),
    referrer_class: new Set(['direct', 'same_site', 'search', 'social', 'referral'])
  };

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

  function privacyBlocked() {
    return navigator.globalPrivacyControl === true
      || [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack].some(function (value) {
        var dnt = String(value || '').trim().toLowerCase();
        return dnt === '1' || dnt === 'yes';
      });
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
    if (privacyBlocked() || analyticsTestMode()) return '';
    if (pageDistinctId) return pageDistinctId;
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (/^(?:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}|anon-[a-z0-9]{8,12}-[a-z0-9]{1,12})$/i.test(saved || '')) pageDistinctId = saved;
    } catch (_) {}
    if (!pageDistinctId) {
      pageDistinctId = randomId();
      try { localStorage.setItem(STORAGE_KEY, pageDistinctId); } catch (_) {}
    }
    return pageDistinctId;
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

  function ownerTestMode() {
    if (window.__BPP_OWNER_TEST === true) return true;
    try { return sessionStorage.getItem('bpp:owner-test') === '1'; } catch (_) { return false; }
  }

  function setOwnerTestMode(isTest) {
    try {
      if (isTest === true) sessionStorage.setItem('bpp:owner-test', '1');
      else sessionStorage.removeItem('bpp:owner-test');
    } catch (_) {}
    window.__BPP_OWNER_TEST = isTest === true;
    if (isTest === true) capture('walk_v2_owner_test_classified');
  }

  function trafficScope() {
    if (ownerTestMode()) return 'synthetic';
    var params = new URLSearchParams(window.location.search || '');
    if (params.get('analytics_test') === '1' || params.get('preview') === '1') return 'synthetic';
    var host = String(window.location.hostname || '').toLowerCase();
    if (host === 'backuppowerpro.com' || host === 'www.backuppowerpro.com') return 'production';
    if (host === 'qa.backuppowerpro.com' || host.indexOf('bpp-qa-site.pages.dev') !== -1) return 'qa';
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
    var projected = projectAnalyticsEvent(event, Object.assign({}, properties || {}, baseProperties()), window.location.origin || '');
    if (!projected) return false;
    var payload = {
      event: event,
      uuid: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
          var n = Math.floor(Math.random() * 16);
          return (char === 'x' ? n : ((n & 3) | 8)).toString(16);
        }),
      timestamp: new Date().toISOString(),
      properties: projected
    };
    function send(attempt) {
      if (privacyBlocked() || analyticsTestMode()) return;
      try { Promise.resolve(fetch(CAPTURE_URL, {
        method: 'POST',
        mode: 'same-origin',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })).then(function (response) {
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          setTimeout(function () { send(1); }, response.status === 429 ? 60000 : 1000);
        }
      }).catch(function () {
        if (attempt === 0) setTimeout(function () { send(1); }, 1000);
      }); } catch (_) {
        if (attempt === 0) setTimeout(function () { send(1); }, 1000);
      }
    }
    send(0);
    return true;
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

  window.BPPAnalytics = Object.freeze({ capture: capture, setOwnerTestMode: setOwnerTestMode,
    anonymousId: function () { return privacyBlocked() || analyticsTestMode() ? '' : distinctId(); } });
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
