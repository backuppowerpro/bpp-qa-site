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
  function go(page, t, extra) {
    insideWalkNav = true;
    var retained = setToken(t);
    var params = new URLSearchParams();
    Object.keys(extra || {}).forEach(function (key) {
      if (extra[key] != null) params.set(key, String(extra[key]));
    });
    var carried = retained;
    if (retained !== t) {
      carried = /^[a-zA-Z0-9_-]{32,160}$/.test(String(t || '')) ? String(t) : retained;
    }
    if (carried) params.set('t', carried);
    var query = params.toString();
    var target = '/walk-v2/' + page + (query ? '?' + query : '');
    if (window.__QW_NAVIGATE__) window.__QW_NAVIGATE__(target);
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
    try { window.posthog && posthog.capture(event, Object.assign({ funnel: 'walkv2' }, props || {})); } catch (_) {}
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
  function connectionTruthKey(t) {
    return 'bpp:qwv2:connection-truth:' + tokenScope(t);
  }
  function journeyStateKey(t) {
    return 'bpp:qwv2:journey-state:' + tokenScope(t);
  }
  function readJourneyState(t) {
    try { return JSON.parse(sessionStorage.getItem(journeyStateKey(t)) || 'null') || {}; } catch (_) { return {}; }
  }
  function rememberJourneyState(t, value) {
    var current = readJourneyState(t);
    var v2 = value && value.quote_walk_v2 || {};
    var version = Number(value && value.expected_version || value && value.version || v2.version || current.version || 0);
    var next = {
      version: version || null,
      panels: Array.isArray(v2.panels) ? v2.panels : (current.panels || []),
      blockers: Array.isArray(v2.blockers) ? v2.blockers : (Array.isArray(value && value.blockers) ? value.blockers : (current.blockers || [])),
      media: Array.isArray(v2.media) ? v2.media : (current.media || [])
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
    var current = String(progress.getAttribute('data-qw-step') || '').toLowerCase();
    var truth = progressTruth(view);
    var labels = [];
    var steps = Array.from(progress.querySelectorAll('.pstep'));
    var currentIndex = steps.findIndex(function (step) {
      var labelNode = step.querySelector('.pl');
      return String(labelNode && labelNode.textContent || '').trim().toLowerCase() === current;
    });
    steps.forEach(function (step, index) {
      var labelNode = step.querySelector('.pl');
      var key = String(labelNode && labelNode.textContent || '').trim().toLowerCase();
      var complete = truth[key] === true && currentIndex >= 0 && index < currentIndex;
      step.classList.toggle('done', complete);
      step.classList.toggle('on', key === current);
      step.classList.toggle('reached', currentIndex >= 0 && index < currentIndex);
      step.toggleAttribute('data-complete', complete);
      if (key === current) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
      labels.push((key === current ? 'Current ' : '') + key + (complete ? ' complete' : ' incomplete'));
    });
    var rail = progress.querySelector('.qw-progress-rail');
    if (rail) rail.setAttribute('aria-label', labels.join('. ') + '.');
    return truth;
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
  function getJson(url, timeoutMs) {
    return fetchWithTimeout(url, {}, timeoutMs || 12000).then(function (r) {
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

  window.WALK = {
    token: token,
    setToken: setToken,
    go: go,
    back: back,
    ph: ph,
    normalizeConnectionSet: normalizeConnectionSet,
    pricingBasis: pricingBasis,
    saveConnectionTruth: saveConnectionTruth,
    readConnectionTruth: readConnectionTruth,
    progressTruth: progressTruth,
    paintProgress: paintProgress,
    view: function (t) {
      return getJson(BASE + '/pre-read-view?token=' + encodeURIComponent(t)).then(function (value) {
        rememberJourneyState(t, value);
        if (typeof document !== 'undefined') paintProgress(document, value);
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
        && payloadKeys.length <= 1
        && payloadKeys.every(function (key) { return key === 'revision_reason'; })
        && (
          !payloadKeys.length
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
      var validEmpty = ['accept_range', 'handoff'].indexOf(action) !== -1
        && payloadKeys.length === 0;
      if (!validCreateRange && !validSupersedeMedia && !validUpdatePhone && !validEmpty) {
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
        return {
          journey_version: state.version || null,
          role: role,
          panel_id: null,
          image: digest
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
              payload.expected_version = state.version;
              payload.request_key = requestKey(t, 'register_media', identity, state.version);
            }
            return postJson(BASE + '/pre-read-photo', payload, 30000).then(function (signed) {
              if (!signed || !signed.upload_url) throw new Error('media_sign_failed');
              return fetch(signed.upload_url, {
                method: 'PUT',
                headers: { 'Content-Type': mimeType },
                body: file
              }).then(function (uploaded) {
                if (!uploaded.ok) throw new Error('media_upload_failed');
                return postJson(BASE + '/pre-read-photo', {
                  token: t,
                  mode: 'complete',
                  reservation_id: signed.reservation_id,
                  lease_id: signed.lease_id
                }, 30000);
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
      function sendImage(retried) {
        var state = readJourneyState(t);
        var identity = identityFor(state, fingerprint(dataUrl));
        var payload = { token: t, image: dataUrl, idx: idx };
        if (state.version) {
          payload.role = identity.role;
          payload.panel_id = identity.panel_id;
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
    /* address auto-suggest via Mapbox Geocoding, the same provider the rest of
       BPP uses (quote.html, m/, pre-read). Publishable pk. token, US addresses,
       biased to Greenville. Returns {description} so the dropdown render is shared. */
    addrSuggest: function (q, timeoutMs) {
      var MB = 'qa-mapbox-disabled';
      var url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(q)
        + '.json?access_token=' + MB + '&country=us&types=address&autocomplete=true&limit=5&proximity=-82.3940,34.8526';
      return getJson(url, timeoutMs || 8000)
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
        .catch(function () { return []; });
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
    /* require a token or bounce to the start (no dead ends) */
    requireToken: function () {
      var t = token();
      if (!t) { window.location.replace('/walk-v2/'); return null; }
      if (!window.__BPP_WALK_ABANDON_ARMED__) {
        window.__BPP_WALK_ABANDON_ARMED__ = true;
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
    routeFromState: function (t, v) {
      var v2 = v.quote_walk_v2;
      if (v2 && Array.isArray(v2.blockers)) {
        if (v2.service_area_status === 'verified_out_of_area') {
          go('index.html', t, { area: 'out' });
          return;
        }
        if (v2.blockers.indexOf('generator_connection') !== -1) return go('connection.html', t);
        if (v2.blockers.indexOf('panel_location') !== -1) return go('location.html', t);
        if (v2.blockers.indexOf('distance') !== -1) return go('distance.html', t);
        if (
          v2.blockers.indexOf('generator_connection_photo') !== -1
          || v2.blockers.indexOf('panel_photo') !== -1
          || v2.blockers.indexOf('panel_context_photo') !== -1
        ) return go('photos.html', t);
        if (v2.blockers.indexOf('service_area') !== -1) return go('range.html', t);
        return go('range.html', t);
      }
      var status = v.connection_status || '';
      if (v.generator_ownership_status === 'not_owned' ||
          status === 'no_compatible_generator_connection') return go('generator-needed.html', t);
      if (!status && v.amperage == null) return go('connection.html', t);
      if (status === 'unanswered') return go('connection.html', t);
      if (!v.confirmed_panel_room) return go('location.html', t);
      if (!v.distance_band) return go('distance.html', t);
      if (!v.photo_count && !v.photo_received) return go('photos.html', t);
      return go('thankyou.html', t);
    },
    /* Recovery is task-directed. It re-opens only the first truly unresolved
       requirement, then skips every answer that is already complete. */
    routeRecoveryFromState: function (t, v) {
      var state = v && v.quote_walk_v2 || {};
      var blockers = Array.isArray(state.blockers)
        ? state.blockers
        : state.readiness && Array.isArray(state.readiness.input_blockers)
          ? state.readiness.input_blockers
          : [];
      if (state.service_area_status === 'verified_out_of_area') {
        go('index.html', t, { area: 'out' });
        return;
      }
      if (blockers.indexOf('service_area') !== -1) return go('incomplete.html', t);
      if (blockers.indexOf('generator_connection') !== -1) {
        if (v.generator_ownership_status === 'not_owned'
            || v.connection_status === 'no_generator'
            || v.connection_status === 'no_compatible_generator_connection') {
          return go('generator-needed.html', t);
        }
        return go('connection.html', t, { recovery: '1', edit: '1' });
      }
      if (blockers.indexOf('panel_location') !== -1 || blockers.indexOf('panel_inventory') !== -1) {
        return go('location.html', t, { recovery: '1', edit: '1' });
      }
      if (blockers.indexOf('distance') !== -1) {
        return go('distance.html', t, { recovery: '1', edit: '1' });
      }
      if (
        blockers.indexOf('generator_connection_photo') !== -1
        || blockers.indexOf('panel_photo') !== -1
        || blockers.indexOf('panel_context_photo') !== -1
      ) return go('photos.html', t, { recovery: '1' });
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
    if (available < 96) {
      var addressInput = document.querySelector('#fAddr');
      if (addressInput) addressInput.scrollIntoView({ block: 'start' });
      viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      available = Math.floor(viewportBottom - addressDrop.getBoundingClientRect().top - 12);
    }
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
  if (typeof window.BPPQuoteWalkMarkReady === 'function') {
    window.BPPQuoteWalkMarkReady();
  }
})();
