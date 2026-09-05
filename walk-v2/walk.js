/* Walk v2 shared wiring (staging). The pages are the approved Claude Design
 * comps; this file only moves data: token plumbing, the four endpoints,
 * PostHog events. No visual decisions live here. */
(function () {
  /* Production keeps the canonical Supabase endpoint. The local release gate
     sets this before the shared script loads so the exact customer pages can
     exercise disposable functions and PostgreSQL without production access. */
  var BASE = window.BPP_QUOTE_WALK_FUNCTIONS_BASE
    || 'https://hfatblrcwytxvijjhpal.supabase.co/functions/v1';
  var TOKEN_STORAGE_KEY = 'bpp:qwv2:bearer';
  var CHANNEL_STORAGE_KEY = 'bpp:qwv2:channel';
  var VALID_CHANNEL = /^(?:direct|meta|google|organic|local|neighbor|get-quote|social|referral)$/;
  try {
    var pageChannel = String(window.__WALK_CHANNEL || '');
    if (VALID_CHANNEL.test(pageChannel)) {
      sessionStorage.setItem(CHANNEL_STORAGE_KEY, pageChannel);
    } else {
      var savedChannel = String(sessionStorage.getItem(CHANNEL_STORAGE_KEY) || '');
      if (VALID_CHANNEL.test(savedChannel)) window.__WALK_CHANNEL = savedChannel;
    }
  } catch (_) {}
  var NEW_JOURNEY_VERSION = 'intake-no-upload-v1';
  /* Public policy mirror for NEW_JOURNEY_VERSION. The server owns delivery and
     permits only the post-Yes photo opener. */
  var NEW_JOURNEY_OPENER_POLICY = Object.freeze({
    opener: "Hey {first name}, it’s Key. Text me a couple photos of the panel with the doors open and the path where you want the outlet. I’ll send your proposal once I have those. Reply STOP to opt out.",
    trigger: 'accepted_range',
    pre_yes_automated_sms: false,
    automated_follow_ups: false,
    proposal_auto_send: false
  });
  var AUTHORIZED_SERVICE_COUNTIES = ['Greenville', 'Spartanburg', 'Pickens'];
  var ADDRESS_LOOKUP_PATH = '/api/address-suggest';

  function setToken(value) {
    var next = /^[a-zA-Z0-9_-]{32,160}$/.test(String(value || '')) ? String(value) : '';
    try {
      if (next) {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, next);
        return sessionStorage.getItem(TOKEN_STORAGE_KEY) === next ? next : '';
      }
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      return '';
    } catch (_) {
      return '';
    }
  }
  function token() {
    var t = '';
    try { t = sessionStorage.getItem(TOKEN_STORAGE_KEY) || ''; } catch (_) {}
    if (!t) t = new URLSearchParams(window.location.search).get('t') || '';
    return /^[a-zA-Z0-9_-]{32,160}$/.test(t) ? t : '';
  }
  var insideWalkNav = false;
  var pendingUploadReconciliationCancels = [];
  function cancelPendingUploadReconciliations() {
    pendingUploadReconciliationCancels.slice().forEach(function (cancel) { cancel(); });
  }
  function go(page, t, extra, replaceHistory) {
    cancelPendingUploadReconciliations();
    insideWalkNav = true;
    var retained = setToken(t);
    var params = new URLSearchParams();
    Object.keys(extra || {}).forEach(function (key) {
      if (extra[key] != null) params.set(key, String(extra[key]));
    });
    params.delete('analytics_test');
    params.delete('qa_run_id');
    try {
      var currentParams = new URLSearchParams(window.location.search || '');
      if (currentParams.get('analytics_test') === '1') params.set('analytics_test', '1');
    } catch (_) {}
    var carried = retained;
    if (retained !== t) {
      carried = /^[a-zA-Z0-9_-]{32,160}$/.test(String(t || '')) ? String(t) : retained;
    }
    if (carried) params.set('t', carried);
    var njToken = carried || t;
    var extraNj = extra && extra.nj;
    var journeyAuthority = journeyContractAuthority(null, njToken);
    var nextIsNewJourney = journeyAuthority.loaded
      ? journeyAuthority.contract === NEW_JOURNEY_VERSION
      : isNewJourney(null, njToken) || extraNj === '1' || extraNj === 1;
    if (nextIsNewJourney) {
      params.set('nj', '1');
      markNewJourney(njToken);
    }
    var query = params.toString();
    var target = '/walk-v2/' + page + (query ? '?' + query : '');
    if (window.__QW_NAVIGATE__) window.__QW_NAVIGATE__(target);
    else if (replaceHistory === true) window.location.replace(target);
    else window.location.href = target;
  }
  /* explicit back-a-step, token preserved everywhere. With no prevPage we send
   * them to the landing WITH the token so the landing's resume guard routes them
   * to their first unanswered step (routeFromState), never a blank form and never
   * a dead-end. Not a forward loop: routeFromState targets the FIRST unanswered
   * step, and step pages do not redirect back to the landing on load. */
  function back(prevPage, t) {
    if (prevPage) { go(prevPage, t); return; }
    go('', t);
  }
  function ph(event, props) {
    try {
      window.dispatchEvent(new CustomEvent('bpp:walk-event', {
        detail: Object.assign({ event: event, funnel: 'walkv2' }, props || {})
      }));
    } catch (_) {}
  }
  function durationBucket(milliseconds) {
    if (milliseconds < 250) return 'under_250ms';
    if (milliseconds < 1000) return '250_to_999ms';
    if (milliseconds < 3000) return '1_to_2999ms';
    return '3s_or_more';
  }
  function hydrationGuard() {
    var revision = 0;
    return {
      begin: function () { return revision; },
      touch: function () { revision += 1; return revision; },
      accepts: function (startedAt) { return startedAt === revision; }
    };
  }
  function classifyRecoveryError(cause) {
    var code = String(cause && (cause.code || cause.body && cause.body.error || cause.message) || '');
    var status = Number(cause && cause.status || 0);
    if (status === 410 || /expired|retired|invalid_or_expired_return/.test(code)) return 'expired';
    if (status === 404 || /missing|not_found|not found|invalid token/.test(code)) return 'missing';
    if (/already_complete|completed/.test(code)) return 'complete';
    return 'temporary';
  }
  function renderRecovery(container, cause, options) {
    if (!container) return null;
    var config = options || {};
    var state = classifyRecoveryError(cause);
    var copy = {
      expired: 'This saved link has expired. Your saved record is still protected.',
      missing: 'This saved link is not available. No Quote Walk was marked complete.',
      complete: 'This Quote Walk is already complete.',
      temporary: 'Your saved Quote Walk could not be confirmed. Your answers and saved link are unchanged.'
    };
    container.replaceChildren();
    container.setAttribute('data-return-recovery', state);
    container.appendChild(document.createTextNode(config.message || copy[state]));
    var actions = document.createElement('div');
    actions.className = 'qw-recovery-actions';
    if (state === 'temporary' || config.allowRetry === true) {
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'qw-secondary-action';
      retry.setAttribute('data-retry-saved-link', '');
      retry.textContent = 'Try again';
      retry.addEventListener('click', function () {
        if (typeof config.onRetry === 'function') config.onRetry();
        else window.location.reload();
      });
      actions.appendChild(retry);
    }
    if (state !== 'complete') {
      var startOver = document.createElement('button');
      startOver.type = 'button';
      startOver.className = 'qw-secondary-action';
      startOver.setAttribute('data-start-over', '');
      startOver.textContent = 'Start a new Quote Walk';
      startOver.addEventListener('click', function () {
        setToken('');
        window.location.replace('/walk-v2/');
      });
      actions.appendChild(startOver);
    }
    var help = document.createElement('a');
    help.className = 'qw-secondary-action';
    help.href = 'tel:+18648637800';
    help.textContent = 'Call or text Key';
    actions.appendChild(help);
    container.appendChild(actions);
    container.style.display = '';
    return state;
  }
  function fingerprint(value) {
    var text = JSON.stringify(value || {});
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }
  function tokenScope(t) {
    return fingerprint(['quote-walk-v2-session', String(t || '')]);
  }
  function rangePresentationKey(t, snapshot, journeyVersion) {
    var current = snapshot || {};
    return [
      tokenScope(t),
      String(current.snapshot_id || ''),
      Number(current.journey_version || journeyVersion || 0),
      String(current.pricing_basis || ''),
      String(current.revision_reason || 'initial'),
      String(current.distance_band || ''),
      Number(current.low_cents || 0),
      Number(current.high_cents || 0),
      current.cord_included === false ? 'cord_out' : 'cord_in'
    ].join(':');
  }
  function connectionTruthKey(t) {
    return 'bpp:qwv2:connection-truth:' + tokenScope(t);
  }
  function journeyStateKey(t) {
    return 'bpp:qwv2:journey-state:' + tokenScope(t);
  }
  function newJourneyKey(t) {
    return 'bpp:qwv2:new-journey:' + tokenScope(t);
  }
  function markNewJourney(t) {
    try { sessionStorage.setItem(newJourneyKey(t), NEW_JOURNEY_VERSION); } catch (_) {}
  }
  function urlSaysNewJourney() {
    try { return new URLSearchParams(window.location.search).get('nj') === '1'; } catch (_) { return false; }
  }
  function journeyContractAuthority(value, t) {
    var v2 = value && value.quote_walk_v2;
    if (v2 && typeof v2 === 'object'
        && Object.prototype.hasOwnProperty.call(v2, 'intake_contract')) {
      return {
        loaded: true,
        contract: String(v2.intake_contract || '')
      };
    }
    var remembered = readJourneyState(t);
    if (remembered.intake_contract_loaded === true) {
      return {
        loaded: true,
        contract: String(remembered.intake_contract || '')
      };
    }
    return { loaded: false, contract: '' };
  }
  function isNewJourney(value, t) {
    var authority = journeyContractAuthority(value, t);
    if (authority.loaded) return authority.contract === NEW_JOURNEY_VERSION;
    if (urlSaysNewJourney()) return true;
    try { return sessionStorage.getItem(newJourneyKey(t)) === NEW_JOURNEY_VERSION; } catch (_) { return false; }
  }
  function connectionStatusOf(value) {
    var v2 = value && value.quote_walk_v2 || {};
    return String((value && value.connection_status) || v2.connection_status || '');
  }
  function isPendingAccess(value) {
    return connectionStatusOf(value) === 'pending_access';
  }
  function panelRoomOf(value) {
    var v2 = value && value.quote_walk_v2 || {};
    return String((value && value.confirmed_panel_room) || v2.panel_location || '');
  }
  function panelInventoryOf(value) {
    var v2 = value && value.quote_walk_v2 || {};
    return String(v2.panel_inventory_status || (value && value.panel_inventory_status) || '');
  }
  /* Not sure / I'll check later is a skip, not a room. Missing room is also
     unanswered. "More than one panel" is a real room answer and is not a skip. */
  function isPanelSkipped(value) {
    return panelRoomOf(value) === 'not_sure' || panelInventoryOf(value) === 'incomplete';
  }
  function isUnansweredPanel(value) {
    return isPanelSkipped(value) || !panelRoomOf(value);
  }
  function distanceBandOf(value) {
    var v2 = value && value.quote_walk_v2 || {};
    return String((value && value.distance_band) || v2.distance_band || '');
  }
  function isDistanceSkipped(value) {
    return distanceBandOf(value) === 'not_sure';
  }
  function isUnansweredDistance(value) {
    return isDistanceSkipped(value) || !distanceBandOf(value);
  }
  function isGeneratorNeeded(value) {
    var status = connectionStatusOf(value);
    return (value && value.generator_ownership_status === 'not_owned')
      || status === 'no_generator'
      || status === 'no_compatible_generator_connection';
  }
  function isUnansweredConnection(value) {
    if (isGeneratorNeeded(value)) return false;
    if (isPendingAccess(value)) return true;
    var status = connectionStatusOf(value);
    return !status || status === 'unanswered';
  }
  /* Any skipped / incomplete input (not generator-needed, not photos on new
     journey) must land on the unanswered-questions list, not the step. */
  function hasIncompleteInputs(value, t) {
    if (isGeneratorNeeded(value)) return false;
    if (isUnansweredConnection(value) || isPendingAccess(value)) return true;
    if (isUnansweredPanel(value) || isPanelSkipped(value)) return true;
    if (isUnansweredDistance(value) || isDistanceSkipped(value)) return true;
    var v2 = value && value.quote_walk_v2 || {};
    var blockers = Array.isArray(v2.blockers) ? v2.blockers : [];
    var readiness = v2.readiness || {};
    if (Array.isArray(readiness.input_blockers)) blockers = readiness.input_blockers;
    blockers = blockers.map(String).filter(function (blocker) {
      return blocker !== 'service_area' && !/_photo$/.test(blocker);
    });
    return blockers.some(function (blocker) {
      return blocker === 'generator_connection'
        || blocker === 'panel_location'
        || blocker === 'panel_inventory'
        || blocker === 'distance';
    });
  }
  function afterDistancePage(value, t) {
    if (isPendingAccess(value) || isUnansweredPanel(value) || isDistanceSkipped(value)) return 'incomplete.html';
    return isNewJourney(value, t) ? 'range.html' : 'photos.html';
  }
  function currentWalkPage() {
    try {
      return String(window.location.pathname || '').replace(/\/+$/, '').replace(/\.html$/, '').split('/').pop() || '';
    } catch (_) { return ''; }
  }
  function goIncompleteIfNeeded(t) {
    if (currentWalkPage() === 'incomplete') return;
    go('incomplete.html', t);
  }
  function applyNewJourneyProgress(t, value) {
    if (typeof document !== 'undefined') paintProgress(document, value);
  }
  function readJourneyState(t) {
    try { return JSON.parse(sessionStorage.getItem(journeyStateKey(t)) || 'null') || {}; } catch (_) { return {}; }
  }
  function rememberJourneyState(t, value) {
    var current = readJourneyState(t);
    var v2 = value && value.quote_walk_v2 || {};
    var receivedIntakeContract = value && value.quote_walk_v2
      && Object.prototype.hasOwnProperty.call(value.quote_walk_v2, 'intake_contract');
    var version = Number(value && value.expected_version || value && value.version || v2.version || current.version || 0);
    var next = {
      version: version || null,
      panels: Array.isArray(v2.panels) ? v2.panels : (current.panels || []),
      blockers: Array.isArray(v2.blockers) ? v2.blockers : (Array.isArray(value && value.blockers) ? value.blockers : (current.blockers || [])),
      media: Array.isArray(v2.media) ? v2.media : (current.media || []),
      intake_contract_loaded: receivedIntakeContract || current.intake_contract_loaded === true,
      intake_contract: receivedIntakeContract
        ? String(v2.intake_contract || '')
        : String(current.intake_contract || '')
    };
    try { sessionStorage.setItem(journeyStateKey(t), JSON.stringify(next)); } catch (_) {}
    return next;
  }
  function requestKey(t, action, payload, journeyVersion) {
    var version = Number(journeyVersion || 0);
    var storageKey = 'bpp:qwv2:req:' + fingerprint([t, action, version, payload]);
    try {
      var existing = sessionStorage.getItem(storageKey);
      if (existing) return existing;
      var random = '';
      if (window.crypto && crypto.getRandomValues) {
        var bytes = new Uint8Array(12);
        crypto.getRandomValues(bytes);
        random = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
      } else {
        random = String(Date.now()) + String(Math.random()).slice(2);
      }
      var key = 'qwv2:' + action + ':v' + version + ':' + fingerprint(payload) + ':' + random;
      sessionStorage.setItem(storageKey, key);
      return key;
    } catch (_) {
      return 'qwv2:' + action + ':v' + version + ':' + fingerprint([t, payload]) + ':fallback';
    }
  }
  function normalizeConnectionSet(values) {
    var seen = {};
    return (Array.isArray(values) ? values : []).map(function (value) {
      var text = String(value || '').toUpperCase();
      if (text === '30' || text === '30A' || text === 'CONFIRMED_30') return '30A';
      if (text === '50' || text === '50A' || text === 'CONFIRMED_50') return '50A';
      return '';
    }).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    }).sort();
  }
  function pricingBasis(values) {
    var set = normalizeConnectionSet(values);
    if (set.indexOf('50A') !== -1) return '50A';
    return set.length === 1 && set[0] === '30A' ? '30A' : null;
  }
  function saveConnectionTruth(t, values) {
    var set = normalizeConnectionSet(values);
    var record = {
      connection_answers: set,
      pricing_basis: pricingBasis(set),
      pricing_basis_rule_version: 'connection-set-v1',
      pricing_basis_authority: 'key_explicit_2026_07_28'
    };
    try { sessionStorage.setItem(connectionTruthKey(t), JSON.stringify(record)); } catch (_) {}
    return record;
  }
  function readConnectionTruth(t, view) {
    var direct = normalizeConnectionSet(
      view && view.quote_walk_v2 && view.quote_walk_v2.observed_connections
      || view && view.connection_answers
    );
    if (direct.length) {
      return {
        connection_answers: direct,
        pricing_basis: pricingBasis(direct),
        pricing_basis_rule_version: 'connection-set-v1',
        pricing_basis_authority: 'key_explicit_2026_07_28'
      };
    }
    if (!view || !view.quote_walk_v2) try {
      var saved = JSON.parse(sessionStorage.getItem(connectionTruthKey(t)) || 'null');
      if (saved && normalizeConnectionSet(saved.connection_answers).length) {
        saved.connection_answers = normalizeConnectionSet(saved.connection_answers);
        saved.pricing_basis = pricingBasis(saved.connection_answers);
        return saved;
      }
    } catch (_) {}
    var legacy = [];
    if (view && view.connection_status === 'confirmed_30') legacy = ['30A'];
    if (view && view.connection_status === 'confirmed_50') legacy = ['50A'];
    if (!legacy.length && view && String(view.amperage || '') === '30') legacy = ['30A'];
    if (!legacy.length && view && String(view.amperage || '') === '50') legacy = ['50A'];
    return {
      connection_answers: legacy,
      pricing_basis: pricingBasis(legacy),
      pricing_basis_rule_version: 'connection-set-v1',
      pricing_basis_authority: 'key_explicit_2026_07_28'
    };
  }
  function progressTruth(view) {
    var value = view || {};
    var state = value.quote_walk_v2 || {};
    var observed = normalizeConnectionSet(state.observed_connections || value.connection_answers);
    if (!observed.length && (value.connection_status === 'confirmed_30' || value.connection_status === 'confirmed_50')) {
      observed = [value.connection_status === 'confirmed_50' ? '50A' : '30A'];
    }
    var panelLocation = value.confirmed_panel_room || state.panel_location || '';
    var panelInventory = state.panel_inventory_status || value.panel_inventory_status || '';
    var distance = value.distance_band || state.distance_band || '';
    var blockers = Array.isArray(state.blockers)
      ? state.blockers
      : state.readiness && Array.isArray(state.readiness.input_blockers)
        ? state.readiness.input_blockers
        : null;
    var hasSavedPhoto = Array.isArray(state.media) && state.media.length > 0;
    return {
      generator: observed.length > 0,
      panel: Boolean(panelLocation && panelLocation !== 'not_sure' && panelInventory !== 'incomplete'),
      distance: Boolean(distance && distance !== 'not_sure'),
      photos: Boolean(hasSavedPhoto)
    };
  }
  function paintProgress(root, view) {
    var scope = root && root.querySelector ? root : document;
    var progress = scope.querySelector('.qw-progress');
    if (!progress) return progressTruth(view);
    var subject = progress.querySelector('[data-position-subject]');
    var count = progress.querySelector('[data-position-count]');
    if (!subject || !count) return progressTruth(view);
    var current = String(progress.getAttribute('data-qw-step') || '').toLowerCase();
    var state = view && view.quote_walk_v2;
    // Only this response can establish the step count. URL and storage hints
    // cannot briefly advertise a different journey during loading or recovery.
    var loaded = state && Object.prototype.hasOwnProperty.call(state, 'intake_contract');
    var steps = ['generator', 'panel', 'distance'];
    if (loaded && state.intake_contract !== NEW_JOURNEY_VERSION) steps.push('photos');
    var index = steps.indexOf(current);
    var ready = Boolean(loaded && index >= 0);
    count.textContent = ready ? 'Step ' + (index + 1) + ' of ' + steps.length + ' ·' : '';
    count.setAttribute('aria-hidden', ready ? 'false' : 'true');
    progress.setAttribute('data-position-ready', ready ? 'true' : 'false');
    return progressTruth(view);
  }
  function fetchWithTimeout(url, options, timeoutMs) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var requestOptions = Object.assign({}, options || {});
    if (ctrl) requestOptions.signal = ctrl.signal;
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (ctrl) ctrl.abort();
        var error = new Error('request_timeout');
        error.name = 'TimeoutError';
        reject(error);
      }, timeoutMs);
      fetch(url, requestOptions).then(function (value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, function (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  function getJson(url, timeoutMs, options) {
    return fetchWithTimeout(url, options || {}, timeoutMs || 12000).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) {
          var error = new Error(body && body.error || 'http_' + r.status);
          error.status = r.status;
          error.body = body;
          throw error;
        }
        return body;
      });
    });
  }
  function postJson(url, body, timeoutMs) {
    /* A weak rural signal can leave a POST (especially a photo upload) hanging
       forever, which froze the photo step on "uploading" with the CTA greyed out
       and no recovery. Abort after timeoutMs so the promise rejects and the
       caller's .catch (e.g. photos.html flips the entry to "failed" -> Retry)
       can recover instead of hanging. Default 30s. */
    return fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs || 30000).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) { var e = new Error(j && j.error || 'http_' + r.status); e.body = j; throw e; }
        return j;
      });
    });
  }

  function reconcilePendingUploads(t, value, options) {
    var config = options || {};
    var state = value && value.quote_walk_v2 || {};
    var pending = Array.isArray(state.pending_media_uploads)
      ? state.pending_media_uploads.slice(0, 10)
      : [];
    var valid = pending.filter(function (upload) {
      return upload
        && /^[a-f0-9-]{36}$/i.test(String(upload.reservation_id || ''))
        && /^[a-f0-9-]{36}$/i.test(String(upload.lease_id || ''))
        && upload.status === 'uploading';
    });
    if (!valid.length) return Promise.resolve({ state: value, results: [] });
    var cancelled = false;
    var retryTimer = null;
    var retryWaitCancel = null;
    var startedAt = Date.now();
    var maxAttempts = 120;
    var maxTransientFailures = 4;
    var maxElapsedMs = 6 * 60 * 1000;
    function emit(status) {
      if (typeof config.onStatus === 'function') {
        try { config.onStatus(status); } catch (_) {}
      }
    }
    function cancel() {
      cancelled = true;
      if (retryTimer != null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (retryWaitCancel) retryWaitCancel();
    }
    function removeCancel() {
      var index = pendingUploadReconciliationCancels.indexOf(cancel);
      if (index !== -1) pendingUploadReconciliationCancels.splice(index, 1);
      window.removeEventListener('pagehide', cancel);
      window.removeEventListener('beforeunload', cancel);
      if (config.signal && typeof config.signal.removeEventListener === 'function') {
        config.signal.removeEventListener('abort', cancel);
      }
    }
    pendingUploadReconciliationCancels.push(cancel);
    window.addEventListener('pagehide', cancel, { once: true });
    window.addEventListener('beforeunload', cancel, { once: true });
    if (config.signal && typeof config.signal.addEventListener === 'function') {
      if (config.signal.aborted) cancel();
      else config.signal.addEventListener('abort', cancel, { once: true });
    }
    function retrySeconds(input) {
      var numeric = Math.ceil(Number(input || 3));
      return Math.max(1, Math.min(30, Number.isFinite(numeric) ? numeric : 3));
    }
    function waitToRetry(upload, seconds, attempt, reason) {
      var remaining = retrySeconds(seconds);
      return new Promise(function (resolve) {
        function finish(value) {
          if (retryTimer != null) clearTimeout(retryTimer);
          retryTimer = null;
          retryWaitCancel = null;
          resolve(value);
        }
        retryWaitCancel = function () { finish(false); };
        function tick() {
          if (cancelled) { finish(false); return; }
          emit({
            type: 'waiting',
            upload: upload,
            attempt: attempt,
            reason: reason,
            retry_in_seconds: remaining
          });
          if (remaining === 0) { finish(true); return; }
          retryTimer = setTimeout(function () {
            remaining -= 1;
            tick();
          }, 1000);
        }
        tick();
      });
    }
    function cancelledResult(upload, attempts) {
      emit({ type: 'cancelled', upload: upload, attempt: attempts });
      return { ok: false, cancelled: true, reservation_id: upload.reservation_id, attempts: attempts };
    }
    function actionableResult(upload, attempts, code) {
      emit({ type: 'action_required', upload: upload, attempt: attempts, error: code });
      return {
        ok: false,
        action_required: true,
        reservation_id: upload.reservation_id,
        attempts: attempts,
        error: code
      };
    }
    function recoverUpload(upload) {
      var attempts = 0;
      var transientFailures = 0;
      function attempt() {
        if (cancelled) return Promise.resolve(cancelledResult(upload, attempts));
        if (attempts >= maxAttempts || Date.now() - startedAt >= maxElapsedMs) {
          return Promise.resolve(actionableResult(upload, attempts, 'media_recovery_timeout'));
        }
        attempts += 1;
        emit({ type: 'checking', upload: upload, attempt: attempts });
        return postJson(BASE + '/pre-read-photo', {
          token: t,
          mode: 'recover',
          reservation_id: upload.reservation_id,
          lease_id: upload.lease_id
        }, 30000).then(function (recovery) {
          if (cancelled) return cancelledResult(upload, attempts);
          if (recovery && recovery.receipt_settled === true) {
            emit({ type: 'finalized', upload: upload, attempt: attempts });
            return {
              ok: true,
              terminal: 'finalized',
              reservation_id: upload.reservation_id,
              attempts: attempts,
              recovery: recovery
            };
          }
          if (recovery && recovery.retry_ready === true) {
            emit({ type: 'retry_ready', upload: upload, attempt: attempts });
            return {
              ok: true,
              terminal: 'retry_ready',
              retry_ready: true,
              reservation_id: upload.reservation_id,
              attempts: attempts,
              recovery: recovery
            };
          }
          if (recovery && recovery.status === 'uploading') {
            transientFailures = 0;
            return waitToRetry(upload, recovery.retry_after_seconds, attempts, 'uploading').then(function (continueRetry) {
              return continueRetry ? attempt() : cancelledResult(upload, attempts);
            });
          }
          return actionableResult(upload, attempts, 'media_recovery_unexpected');
        }).catch(function (error) {
          if (cancelled) return cancelledResult(upload, attempts);
          var kind = classifyRecoveryError(error);
          if (kind !== 'temporary') return actionableResult(upload, attempts, kind);
          transientFailures += 1;
          if (transientFailures >= maxTransientFailures) {
            return actionableResult(upload, attempts, 'media_recovery_unavailable');
          }
          var seconds = error && error.body && error.body.retry_after_seconds;
          return waitToRetry(upload, seconds, attempts, 'temporary').then(function (continueRetry) {
            return continueRetry ? attempt() : cancelledResult(upload, attempts);
          });
        });
      }
      return attempt();
    }
    return valid.reduce(function (chain, upload) {
      return chain.then(function (results) {
        return recoverUpload(upload).then(function (result) {
          results.push(result);
          return results;
        });
      });
    }, Promise.resolve([])).then(function (results) {
      if (cancelled) return { state: value, results: results };
      return window.WALK.view(t).then(function (refreshed) {
        return { state: refreshed, results: results };
      });
    }).finally(function () {
      removeCancel();
    });
  }

  window.WALK = {
    copyReturnLink: function (t, screen) {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        return Promise.reject(new Error('Link copying is unavailable in this browser. Keep this tab open to return to your saved answers.'));
      }
      var returnURL = new URL('/walk-v2/incomplete.html', window.location.origin);
      returnURL.searchParams.set('t', t);
      return Promise.resolve().then(function () {
        return navigator.clipboard.writeText(returnURL.href);
      }).then(function () {
        window.WALK.ph('walk_v2_return_link_copied', { screen: screen });
      }, function () {
        throw new Error('The link could not be copied. Keep this tab open, or try copying again.');
      });
    },
    token: token,
    setToken: setToken,
    go: go,
    back: back,
    ph: ph,
    hydrationGuard: hydrationGuard,
    classifyRecoveryError: classifyRecoveryError,
    renderRecovery: renderRecovery,
    normalizeConnectionSet: normalizeConnectionSet,
    pricingBasis: pricingBasis,
    saveConnectionTruth: saveConnectionTruth,
    readConnectionTruth: readConnectionTruth,
    progressTruth: progressTruth,
    paintProgress: paintProgress,
    markNewJourney: markNewJourney,
    isNewJourney: isNewJourney,
    afterDistancePage: afterDistancePage,
    connectionStatusOf: connectionStatusOf,
    isPendingAccess: isPendingAccess,
    isPanelSkipped: isPanelSkipped,
    isUnansweredPanel: isUnansweredPanel,
    isDistanceSkipped: isDistanceSkipped,
    isUnansweredDistance: isUnansweredDistance,
    isUnansweredConnection: isUnansweredConnection,
    isGeneratorNeeded: isGeneratorNeeded,
    hasIncompleteInputs: hasIncompleteInputs,
    applyNewJourneyProgress: applyNewJourneyProgress,
    tokenScope: tokenScope,
    rangePresentationKey: rangePresentationKey,
    newJourneyVersion: NEW_JOURNEY_VERSION,
    newJourneyOpenerPolicy: NEW_JOURNEY_OPENER_POLICY,
    reconcilePendingUploads: reconcilePendingUploads,
    view: function (t) {
      return getJson(BASE + '/pre-read-view?token=' + encodeURIComponent(t)).then(function (value) {
        rememberJourneyState(t, value);
        applyNewJourneyProgress(t, value);
        var state = value && value.quote_walk_v2 || {};
        var path = String(window.location && window.location.pathname || '').replace(/\/index\.html$/, '/');
        if (state.service_area_status === 'verified_out_of_area' && path !== '/walk-v2/') {
          go('index.html', t, { area: 'out' });
        }
        return value;
      });
    },
    confirm: function (t, fields) {
      var stableRequestKey = null;
      function send(retried) {
        var state = readJourneyState(t);
        if (!state.version) {
          return getJson(BASE + '/pre-read-view?token=' + encodeURIComponent(t))
            .then(function (value) {
              rememberJourneyState(t, value);
              return send(retried);
            });
        }
        var payload = Object.assign({ token: t }, fields);
        payload.expected_version = state.version;
        stableRequestKey = stableRequestKey || requestKey(t, 'save_answers', fields, state.version);
        payload.request_key = stableRequestKey;
        return postJson(BASE + '/pre-read-confirm', payload).then(function (value) {
          rememberJourneyState(t, value);
          try {
            if (typeof document !== 'undefined') paintProgress(document, value);
          } catch (_) {}
          return value;
        }).catch(function (error) {
          if (!retried && error && error.body && error.body.error === 'stale_journey_version') {
            return getJson(BASE + '/pre-read-view?token=' + encodeURIComponent(t))
              .then(function (value) { rememberJourneyState(t, value); return send(true); });
          }
          throw error;
        });
      }
      return send(false);
    },
    stateAction: function (t, action, fields) {
      if (['create_range', 'accept_range', 'supersede_media', 'update_phone', 'handoff'].indexOf(action) === -1) {
        return Promise.reject(new Error('invalid_state_action'));
      }
      var payloadFields = fields || {};
      if (!payloadFields || typeof payloadFields !== 'object' || Array.isArray(payloadFields)) {
        return Promise.reject(new Error('invalid_state_payload'));
      }
      var payloadKeys = Object.keys(payloadFields);
      var validCreateRange = action === 'create_range'
        && payloadKeys.every(function (key) { return key === 'revision_reason'; })
        && (
          payloadKeys.indexOf('revision_reason') === -1
          || ['initial', 'both_to_30', 'shorter_distance', 'cord_removed', 'cord_restored', 'return_to_50']
            .indexOf(String(payloadFields.revision_reason || '')) !== -1
        );
      var validSupersedeMedia = action === 'supersede_media'
        && payloadKeys.length === 1
        && payloadKeys[0] === 'media_id'
        && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
          .test(String(payloadFields.media_id || ''));
      var updatePhoneDigits = String(payloadFields.phone || '').replace(/\D/g, '');
      if (updatePhoneDigits.length === 11 && updatePhoneDigits.charAt(0) === '1') {
        updatePhoneDigits = updatePhoneDigits.slice(1);
      }
      var validUpdatePhone = action === 'update_phone'
        && payloadKeys.length === 1
        && payloadKeys[0] === 'phone'
        && /^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(updatePhoneDigits);
      var validAccept = action === 'accept_range' && (payloadKeys.length === 0 || (
        payloadKeys.every(function (key) {
          return ['journey_version', 'lead_event', 'lead_event_id', 'range_low_cents', 'range_high_cents', 'gclid', 'gbraid', 'wbraid'].indexOf(key) !== -1;
        })
        && payloadFields.journey_version === NEW_JOURNEY_VERSION
        && payloadFields.lead_event === 'range_accepted_lead'));
      var validEmpty = action === 'handoff' && payloadKeys.length === 0;
      if (!validCreateRange && !validSupersedeMedia && !validUpdatePhone && !validAccept && !validEmpty) {
        return Promise.reject(new Error('invalid_state_payload'));
      }
      function send(retried) {
        var state = readJourneyState(t);
        if (!state.version) {
          return getJson(BASE + '/pre-read-view?token=' + encodeURIComponent(t))
            .then(function (value) {
              rememberJourneyState(t, value);
              return send(retried);
            });
        }
        var body = {
          action: action,
          credential: t,
          expected_version: state.version,
          request_key: requestKey(t, action, payloadFields, state.version),
          payload: payloadFields
        };
        return postJson(BASE + '/quote-walk-v2-state', body).then(function (value) {
          rememberJourneyState(t, value);
          return value;
        }).catch(function (error) {
          if (!retried && error && error.body && error.body.error === 'stale_journey_version') {
            return getJson(BASE + '/pre-read-view?token=' + encodeURIComponent(t))
              .then(function (value) {
                rememberJourneyState(t, value);
                if (action === 'accept_range' || action === 'handoff') {
                  var staleAuthorization = new Error('stale_customer_authorization');
                  staleAuthorization.code = 'stale_customer_authorization';
                  staleAuthorization.body = { error: 'stale_customer_authorization' };
                  staleAuthorization.currentState = value;
                  throw staleAuthorization;
                }
                return send(true);
              });
          }
          throw error;
        });
      }
      return send(false);
    },
    photo: function (t, dataUrl, idx, suppliedIdentity) {
      idx = Number(idx);
      if (!Number.isInteger(idx) || idx < 1 || idx > 10) {
        return Promise.reject(new Error('invalid_media_index'));
      }
      function identityFor(state, digest) {
        var role = suppliedIdentity && suppliedIdentity.role != null
          ? String(suppliedIdentity.role)
          : 'setup_photo';
        if (role !== 'setup_photo') {
          throw new Error('invalid_media_role');
        }
        if (suppliedIdentity && suppliedIdentity.panel_id != null) {
          throw new Error('invalid_media_panel');
        }
        var replacementMediaId = suppliedIdentity && suppliedIdentity.replacement_media_id != null
          ? String(suppliedIdentity.replacement_media_id)
          : '';
        var replacementAttemptId = suppliedIdentity && suppliedIdentity.replacement_attempt_id != null
          ? String(suppliedIdentity.replacement_attempt_id)
          : '';
        if (replacementMediaId && !/^[a-f0-9-]{36}$/i.test(replacementMediaId)) {
          throw new Error('invalid_replacement_media');
        }
        if ((replacementMediaId && !/^[a-zA-Z0-9:_-]{12,160}$/.test(replacementAttemptId))
            || (!replacementMediaId && replacementAttemptId)) {
          throw new Error('invalid_replacement_attempt');
        }
        return {
          journey_version: state.version || null,
          role: role,
          panel_id: null,
          image: digest,
          replacement_media_id: replacementMediaId || null,
          replacement_attempt_id: replacementAttemptId || null
        };
      }
      function hexFromBuffer(buffer) {
        return Array.from(new Uint8Array(buffer), function (byte) {
          return byte.toString(16).padStart(2, '0');
        }).join('');
      }
      function sendFile(file, retried) {
        var state = readJourneyState(t);
        var mimeType = String(file && file.type || '');
        if (mimeType.indexOf('video/') !== 0) {
          return Promise.reject(new Error('invalid_media_type'));
        }
        return file.arrayBuffer().then(function (bytes) {
          return crypto.subtle.digest('SHA-256', bytes).then(function (digest) {
            var identity = identityFor(state, hexFromBuffer(digest));
            var payload = {
              token: t,
              idx: idx,
              mode: 'sign',
              content_type: mimeType,
              byte_size: file.size,
              sha256: hexFromBuffer(digest)
            };
            if (state.version) {
              payload.role = identity.role;
              payload.panel_id = identity.panel_id;
              payload.replacement_media_id = identity.replacement_media_id;
              payload.replacement_attempt_id = identity.replacement_attempt_id;
              payload.expected_version = state.version;
              payload.request_key = requestKey(t, 'register_media', identity, state.version);
            }
            return postJson(BASE + '/pre-read-photo', payload, 30000).then(function (signed) {
              if (!signed || !signed.upload_url) throw new Error('media_sign_failed');
              return fetchWithTimeout(signed.upload_url, {
                method: 'PUT',
                headers: { 'Content-Type': mimeType },
                body: file
              }, 45000).then(function (uploaded) {
                if (!uploaded.ok) throw new Error('media_upload_failed');
                return postJson(BASE + '/pre-read-photo', {
                  token: t,
                  mode: 'complete',
                  reservation_id: signed.reservation_id,
                  lease_id: signed.lease_id
                }, 30000);
              }).catch(function () {
                return recoverReservedUpload(signed).then(function (recovery) {
                  if (recovery && recovery.receipt_settled === true) return recovery;
                  if (recovery && recovery.retry_ready === true && !retried) return sendFile(file, true);
                  var waiting = new Error('media_upload_state_unavailable');
                  waiting.body = recovery || {};
                  throw waiting;
                });
              });
            }).then(function (value) {
              if (state.version && (!value || value.receipt_settled !== true)) {
                throw new Error('media_receipt_unsettled');
              }
              rememberJourneyState(t, value);
              return value;
            });
          });
        }).catch(function (error) {
          if (!retried && error && error.body && error.body.error === 'stale_journey_version') {
            return getJson(BASE + '/pre-read-view?token=' + encodeURIComponent(t))
              .then(function (value) { rememberJourneyState(t, value); return sendFile(file, true); });
          }
          throw error;
        });
      }
      function recoverReservedUpload(signed) {
        if (!signed || !signed.reservation_id || !signed.lease_id) {
          return Promise.reject(new Error('media_reservation_missing'));
        }
        return postJson(BASE + '/pre-read-photo', {
          token: t,
          mode: 'recover',
          reservation_id: signed.reservation_id,
          lease_id: signed.lease_id
        }, 30000);
      }
      function sendImage(retried) {
        var state = readJourneyState(t);
        var identity = identityFor(state, fingerprint(dataUrl));
        var payload = { token: t, image: dataUrl, idx: idx };
        if (state.version) {
          payload.role = identity.role;
          payload.panel_id = identity.panel_id;
          payload.replacement_media_id = identity.replacement_media_id;
          payload.replacement_attempt_id = identity.replacement_attempt_id;
          payload.expected_version = state.version;
          payload.request_key = requestKey(t, 'register_media', identity, state.version);
        }
        return postJson(BASE + '/pre-read-photo', payload).then(function (value) {
          if (state.version && (!value || value.receipt_settled !== true)) {
            throw new Error('media_receipt_unsettled');
          }
          rememberJourneyState(t, value);
          return value;
        }).catch(function (error) {
          if (!retried && error && error.body && error.body.error === 'stale_journey_version') {
            return getJson(BASE + '/pre-read-view?token=' + encodeURIComponent(t))
              .then(function (value) { rememberJourneyState(t, value); return sendImage(true); });
          }
          throw error;
        });
      }
      function start() {
        try {
          if (dataUrl && typeof dataUrl !== 'string') return sendFile(dataUrl, false);
          return sendImage(false);
        } catch (error) {
          return Promise.reject(error);
        }
      }
      if (readJourneyState(t).version) return start();
      return getJson(BASE + '/pre-read-view?token=' + encodeURIComponent(t))
        .then(function (value) { rememberJourneyState(t, value); }, function () {})
        .then(function () { return start(); });
    },
    saveLater: function (t) { return postJson(BASE + '/pre-read-save-later', { token: t }); },
    emailCapture: function (t, email) { return postJson(BASE + '/walk-email-capture', { token: t, email: email }); },
    /* Address auto-suggest stays same-origin so iPhone privacy policy cannot
       strip the site identity required by the restricted provider token. */
    rankAddressSuggestions: function (features) {
      return (Array.isArray(features) ? features : []).map(function (feature, index) {
        var county = String(feature && feature.county || '').replace(/\s+County$/i, '');
        var state = String(feature && feature.state || '').toUpperCase();
        var countyRank = AUTHORIZED_SERVICE_COUNTIES.indexOf(county);
        return {
          feature: feature,
          index: index,
          rank: countyRank >= 0 ? countyRank : state === 'SC' ? 10 : 20
        };
      }).sort(function (left, right) {
        return left.rank - right.rank || left.index - right.index;
      }).map(function (entry) { return entry.feature; });
    },
    addrSuggest: function (q, timeoutMs, telemetry) {
      var startedAt = Date.now();
      var context = telemetry || {};
      return fetchWithTimeout(ADDRESS_LOOKUP_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
        referrerPolicy: 'no-referrer'
      }, timeoutMs || 8000).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok) {
            var error = new Error(body && body.error || 'http_' + response.status);
            error.status = response.status;
            error.body = body;
            throw error;
          }
          return body;
        });
      })
        .then(function (d) { return (d.features || []).map(function (f) {
          /* pull structured city/state/zip from the Mapbox feature context so the
             contact + pre_read carry them (the every-detail rule), not just the
             free-text place_name. region.short_code is like "US-SC" -> "SC". */
          var ctx = f.context || [];
          function ctxText(prefix) {
            for (var i = 0; i < ctx.length; i++) {
              if (String(ctx[i].id || '').indexOf(prefix) === 0) return ctx[i].text || '';
            }
            return '';
          }
          function ctxState() {
            for (var i = 0; i < ctx.length; i++) {
              if (String(ctx[i].id || '').indexOf('region') === 0) {
                return (ctx[i].short_code || '').replace(/^US-/i, '') || ctx[i].text || '';
              }
            }
            return '';
          }
          function ctxCounty() {
            var county = ctxText('district');
            return county.replace(/\s+County$/i, '');
          }
          return {
            id: f.id || '',
            lng: (f.center && f.center[0]) || null,
            lat: (f.center && f.center[1]) || null,
            description: f.place_name || '',
            city: ctxText('place'),
            county: ctxCounty(),
            state: ctxState(),
            zip: ctxText('postcode'),
          };
        }); })
        .then(function (features) {
          var ranked = window.WALK.rankAddressSuggestions(features).slice(0, 5);
          ph('walk_v2_address_lookup_result', {
            outcome: ranked.length ? 'success' : 'empty',
            duration_bucket: durationBucket(Date.now() - startedAt),
            suggestion_count: ranked.length,
            input_method: context.input_method || 'unknown',
            trigger: context.trigger || 'unknown'
          });
          return ranked;
        })
        .catch(function (error) {
          var outcome = error && error.name === 'TimeoutError'
            ? 'timeout'
            : (Number(error && error.status || 0) ? 'http_error' : 'network_error');
          ph('walk_v2_address_lookup_result', {
            outcome: outcome,
            duration_bucket: durationBucket(Date.now() - startedAt),
            suggestion_count: 0,
            input_method: context.input_method || 'unknown',
            trigger: context.trigger || 'unknown'
          });
          return [];
        });
    },
    newLead: function (payload) { return postJson(BASE + '/quo-ai-new-lead', payload); },
    submitLead: function (payload, timeoutMs) {
      return fetchWithTimeout(BASE + '/quo-ai-new-lead', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, timeoutMs || 20000).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          return { ok: response.ok, status: response.status, body: body };
        });
      });
    },
    /* Thank-you finalize: tells the backend the customer finished the walk UI
       (including photo-deferred). Fires the opener when SMS_AUTO_ENABLED. */
    markThankyou: function (t) {
      return postJson(BASE + '/pre-read-confirm', { token: t, mark_thankyou: true });
    },
    touchActivity: function (t, keepalive) {
      return fetch(BASE + '/quote-walk-v2-state', {
        method: 'POST',
        keepalive: keepalive === true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'touch_activity',
          credential: t,
          expected_version: null,
          request_key: requestKey(t, 'touch_activity', {}, 0),
          payload: {}
        })
      }).then(function (response) {
        if (!response.ok) throw new Error('activity_touch_failed');
        return response.json();
      });
    },
    /* require a token or bounce to the start (no dead ends) */
    requireToken: function () {
      var t = token();
      if (!t) { window.location.replace('/walk-v2/'); return null; }
      if (!window.__BPP_WALK_ABANDON_ARMED__) {
        window.__BPP_WALK_ABANDON_ARMED__ = true;
        var lastActivityTouch = 0;
        var lastCustomerSignalAt = Date.now();
        var touchActivity = function (keepalive) {
          if (document.visibilityState === 'hidden' && keepalive !== true) return;
          var now = Date.now();
          if (!keepalive && now - lastActivityTouch < 45000) return;
          lastActivityTouch = now;
          window.WALK.touchActivity(t, keepalive).catch(function () {});
        };
        var recordCustomerSignal = function () {
          lastCustomerSignalAt = Date.now();
          touchActivity(false);
        };
        touchActivity(false);
        window.setInterval(function () {
          if (Date.now() - lastCustomerSignalAt <= 90000) touchActivity(false);
        }, 60000);
        window.addEventListener('focus', recordCustomerSignal);
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') recordCustomerSignal();
        });
        ['pointerdown', 'keydown', 'touchstart'].forEach(function (eventName) {
          document.addEventListener(eventName, recordCustomerSignal, { passive: true });
        });
        window.addEventListener('pagehide', function () {
          if (insideWalkNav) return;
          var path = String(window.location && window.location.pathname || '');
          if (/\/walk-v2\/thankyou\.html$/.test(path)) return;
          if (/\/walk-v2\/?$/.test(path) || /\/walk-v2\/index\.html$/.test(path)) return;
          try {
            fetch(BASE + '/pre-read-save-later', {
              method: 'POST',
              keepalive: true,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: t }),
            });
          } catch (_) {}
        });
      }
      return t;
    },
    /* Resume at the first unanswered step. New records always carry a
       connection_status. Amperage remains a legacy fallback for saved walks
       created before the connection step was separated from the lead form. */
    routeFromState: function (t, v, replaceHistory) {
      var v2 = v.quote_walk_v2 || {};
      var newJourney = isNewJourney(v, t);
      if (v2.service_area_status === 'verified_out_of_area') {
        go('index.html', t, { area: 'out' }, replaceHistory);
        return;
      }
      if (isGeneratorNeeded(v)) return go('generator-needed.html', t, null, replaceHistory);
      if (hasIncompleteInputs(v, t)) return goIncompleteIfNeeded(t);
      if (!newJourney && (
        (Array.isArray(v2.blockers) && v2.blockers.some(function (blocker) { return /_photo$/.test(String(blocker)); }))
        || (!v.photo_count && !v.photo_received)
      )) return go('photos.html', t, null, replaceHistory);
      return go(newJourney ? 'range.html' : (v2 && v2.blockers ? 'range.html' : 'thankyou.html'), t, null, replaceHistory);
    },
    /* Recovery is task-directed. It re-opens only the first truly unresolved
       requirement, then skips every answer that is already complete. */
    routeRecoveryFromState: function (t, v) {
      var state = v && v.quote_walk_v2 || {};
      if (state.service_area_status === 'verified_out_of_area') {
        go('index.html', t, { area: 'out' });
        return;
      }
      if (isGeneratorNeeded(v)) return go('generator-needed.html', t);
      if (hasIncompleteInputs(v, t)) return goIncompleteIfNeeded(t);
      if (!isNewJourney(v, t)) {
        var blockers = Array.isArray(state.blockers)
          ? state.blockers
          : state.readiness && Array.isArray(state.readiness.input_blockers)
            ? state.readiness.input_blockers
            : [];
        if (blockers.some(function (blocker) { return /_photo$/.test(String(blocker)); })) {
          return go('photos.html', t, { recovery: '1' });
        }
      }
      return go('range.html', t);
    },
    /* shrink a photo to a phone-friendly JPEG dataURL before upload */
    resizeImage: function (file, maxPx) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var scale = Math.min(1, maxPx / Math.max(img.width, img.height));
            var w = Math.max(1, Math.round(img.width * scale));
            var h = Math.max(1, Math.round(img.height * scale));
            var cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            resolve(cv.toDataURL('image/jpeg', 0.85));
          } catch (e) { reject(e); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad_image')); };
        img.src = url;
      });
    },
  };

  /* Keep the address result list inside the visible mobile viewport, including
     when the on-screen keyboard changes the visual viewport height. */
  var addressDrop = typeof document !== 'undefined'
    ? document.querySelector('[data-addr-drop]')
    : null;
  function syncAddressDropViewport() {
    if (!addressDrop || !addressDrop.classList.contains('open')) {
      if (addressDrop) addressDrop.style.removeProperty('--addr-drop-max-height');
      return;
    }
    var viewport = window.visualViewport;
    var viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    var available = Math.floor(viewportBottom - addressDrop.getBoundingClientRect().top - 12);
    available = Math.max(96, available);
    addressDrop.style.setProperty('--addr-drop-max-height', available + 'px');
  }
  if (addressDrop) {
    new MutationObserver(syncAddressDropViewport).observe(addressDrop, {
      attributes: true,
      attributeFilter: ['class']
    });
    window.addEventListener('resize', syncAddressDropViewport, { passive: true });
    window.addEventListener('scroll', syncAddressDropViewport, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncAddressDropViewport, { passive: true });
      window.visualViewport.addEventListener('scroll', syncAddressDropViewport, { passive: true });
    }
  }
  if (urlSaysNewJourney() && token()) markNewJourney(token());
  applyNewJourneyProgress(token(), null);
  if (typeof window.BPPQuoteWalkMarkReady === 'function') {
    window.BPPQuoteWalkMarkReady();
  }
})();
