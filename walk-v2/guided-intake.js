/* One document owns anonymous setup answers. Only an acknowledged contact operation
 * attaches them to a server-owned request. Ordinary reloads may restart. */
(function () {
  'use strict';
  var CONTRACT = 'guided-quote-walk-v1';
  var PENDING_KEY = 'bpp:qwv2:pending-guided-intake';
  var LEGACY_PENDING_KEY = 'bpp:qwv2:pending-intake';
  var MAX_REPLAY_AGE = 15 * 60 * 1000;
  var TOKEN = /^[a-zA-Z0-9_-]{32,160}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var ROOMS = { Garage: 'garage', Basement: 'basement', Outside: 'outside', Closet: 'closet', 'Utility area': 'laundry_room', 'Somewhere else': 'somewhere_else', 'More than one panel': 'more_than_one_panel', 'Not sure': 'not_sure' };
  var BANDS = { 'About 5 ft': 'about_5', '5-10 ft': '5_10', '10-20 ft': '10_20', '20-40 ft': '20_40', 'Over 40 ft': 'over_40', 'Not sure': null };
  var flow = document.querySelector('[data-guided-flow]');
  if (!flow) return;
  // An older cached core must not operate the current form or choose saved authority.
  if (!window.WALK || !window.BPPContactDetails || !window.BPPSaveForLater
      || typeof window.__BPP_WALK_TOKEN !== 'string'
      || ['submitLeadBody', 'isGuidedJourney', 'guidedDestination', 'rememberJourneyState'].some(function (name) { return typeof WALK[name] !== 'function'; })) {
    document.documentElement.classList.remove('js');
    document.documentElement.classList.add('no-js');
    flow.setAttribute('inert', '');
    var notice = document.querySelector('.qw-script-recovery');
    if (notice) {
      var reload = document.createElement('button'); reload.type = 'button';
      reload.className = 'qw-secondary-action'; reload.textContent = 'Reload Quote Walk';
      reload.onclick = function () {
        var target = new URL(location.href);
        // Use only the bootstrap's current document authority, never stale storage.
        if (window.__BPP_INVALID_CAPABILITY_ENTRY) target.searchParams.set('t', 'invalid');
        else if (/^[a-zA-Z0-9_-]{32,160}$/.test(window.__BPP_WALK_TOKEN || '')) target.searchParams.set('t', window.__BPP_WALK_TOKEN);
        if (typeof window.__BPP_WALK_TOKEN !== 'string' && window.__BPP_CAPABILITY_ENTRY && !target.searchParams.has('t')) {
          reload.disabled = true; reload.textContent = 'Reopen your original saved link'; return;
        }
        location.replace(target.href);
      };
      notice.appendChild(reload);
    }
    return;
  }
  var entryURL = new URL(location.href);
  entryURL.searchParams.delete('t');
  var instance = crypto.randomUUID();
  var screens = ['connection', 'location', 'distance', 'contact'];
  var state = { protectedEntry: Boolean(window.__BPP_CAPABILITY_ENTRY), screen: 'connection', outlets: [], room: '', distance: null, token: WALK.token(), view: null, verified: false, pending: '', busy: false, editing: false };
  // A separately reviewed static bridge release changes only new anonymous
  // admission. Protected requests and frozen possibly-successful retries retain
  // their existing contract. Query parameters cannot enable guided admission.
  function contactFirstAnonymous() { return flow.dataset.anonymousEntry === 'contact-first-compatible' && !state.token && !state.pending; }
  var retry;
  var helpOrigin = 'connection';
  var helpTrigger;
  var mountedContact;
  var activeScreen;
  var recoveryHeading = flow.querySelector('#recovery-heading');
  var recoveryCopy = flow.querySelector('[data-recovery-copy]');
  var retryButton = flow.querySelector('[data-recovery-retry]');
  var newButton = flow.querySelector('[data-recovery-new]');
  var callLink = flow.querySelector('[data-recovery-call]');
  var progress = flow.querySelector('[data-guided-progress]');
  var saveControls = Array.from(flow.querySelectorAll('[data-save-for-later]')).map(function (root) {
    return BPPSaveForLater.mount(root, function () {
      return { mode: state.token ? (state.verified ? 'protected' : 'unavailable') : state.protectedEntry ? 'unavailable' : 'public', token: state.token, verified: state.verified, pending: Boolean(state.pending), screen: state.screen };
    });
  });
  function refreshSaves() { saveControls.forEach(function (control) { control.refresh(); }); }
  function refreshChoices() {
    flow.querySelectorAll('[data-connection]').forEach(function (button) { button.setAttribute('aria-pressed', String(state.outlets.indexOf(button.dataset.connection) !== -1)); });
    flow.querySelectorAll('[data-room]').forEach(function (button) { button.setAttribute('aria-pressed', String(ROOMS[button.dataset.room] === state.room)); });
    flow.querySelectorAll('[data-dist]').forEach(function (button) { button.setAttribute('aria-pressed', String(state.distance !== null && BANDS[button.dataset.dist] === state.distance)); });
    flow.querySelector('[data-connection-echo]').textContent = state.outlets.length ? 'Selected: ' + state.outlets.map(function (value) { return value + ' Amp'; }).join(' and ') : '';
    flow.querySelector('[data-connection-echo]').hidden = !state.outlets.length;
    var room = Object.keys(ROOMS).find(function (key) { return ROOMS[key] === state.room; });
    flow.querySelector('[data-panel-echo]').textContent = room && state.room !== 'not_sure' ? 'Panel location: ' + room : '';
    var band = Object.keys(BANDS).find(function (key) { return BANDS[key] === state.distance; });
    flow.querySelector('[data-distance-echo]').textContent = state.distance ? 'Selected distance: ' + band : '';
    flow.querySelector('[data-distance-cue]').textContent = state.distance ? band : '?';
    flow.querySelector('[data-multiple-note]').hidden = state.room !== 'more_than_one_panel';
    flow.querySelector('[data-multiple-distance]').hidden = state.room !== 'more_than_one_panel';
    flow.querySelectorAll('[data-guided-next]').forEach(function (button) {
      var screen = button.closest('[data-screen]').dataset.screen;
      button.disabled = state.busy || Boolean(state.pending) || (screen === 'connection' ? !state.outlets.length : screen === 'location' ? !state.room || state.room === 'not_sure' : !state.distance);
      button.textContent = state.editing && screen === 'distance' ? 'Save setup answers' : 'Continue';
    });
  }
  function eligible() { return contactFirstAnonymous() || state.outlets.length > 0 && Boolean(state.room && state.room !== 'not_sure' && state.distance); }
  function draft() {
    var multi = state.room === 'more_than_one_panel';
    var unknown = !state.room || state.room === 'not_sure';
    return { schema: CONTRACT, observed_connections: state.outlets.slice().sort(), panel_location: state.room || 'not_sure', panel_inventory_status: multi ? 'multiple_unsure_main' : unknown ? 'incomplete' : 'single_complete', panels: multi || unknown ? [] : [{ stable_key: 'main-panel', label: 'Main panel' }], distance_band: state.distance };
  }
  function show(screen, options) {
    if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.hide();
    options = options || {};
    if (contactFirstAnonymous() && screens.indexOf(screen) !== -1) screen = 'contact';
    else if (screens.indexOf(screen) !== -1 && !state.editing && !state.token) {
      if (screens.indexOf(screen) > 0 && !state.outlets.length) screen = 'connection';
      else if (screens.indexOf(screen) > 1 && (!state.room || state.room === 'not_sure')) screen = 'location';
      else if (screen === 'contact' && !state.distance) screen = 'distance';
    }
    if (mountedContact) mountedContact.closeSuggestions();
    state.screen = screen;
    flow.hidden = false;
    flow.querySelectorAll('[data-screen]').forEach(function (node) { node.hidden = node.dataset.screen !== screen; });
    activeScreen = flow.querySelector('[data-screen="' + screen + '"]');
    document.body.dataset.activeScreen = screen;
    document.getElementById('mainPage').dataset.screenLabel = screen === 'connection' || contactFirstAnonymous() ? 'Landing page (interactive, mobile)' : 'Quote walk: guided details';
    progress.hidden = contactFirstAnonymous() || screen === 'connection' || screen === 'recovery' || screen === 'help';
    flow.querySelector('[data-guided-position]').textContent = { location: 'Panel', distance: 'Distance', contact: 'Details' }[screen] || '';
    refreshChoices(); refreshSaves();
    if (screen === 'contact') { contact(); mountedContact.refresh(); }
    if (!options.noHistory) {
      // Only a logical screen and instance marker enter history, never answers or identity.
      history[options.replace ? 'replaceState' : 'pushState']({ qwg: instance, screen: screen }, '', entryURL.pathname + entryURL.search);
    }
    if (!options.noFocus) {
      var heading = activeScreen.querySelector('h2');
      if (heading) heading.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    WALK.ph('walk_v2_screen_view', { screen: 'guided_' + screen });
  }
  function recovery(title, copy, callback, allowNew) {
    recoveryHeading.textContent = title;
    recoveryCopy.textContent = copy || '';
    retry = callback;
    retryButton.hidden = !callback;
    retryButton.disabled = false;
    retryButton.textContent = 'Try again';
    newButton.hidden = !allowNew;
    flow.querySelector('[data-screen="recovery"] [data-save-for-later]').hidden = Boolean(allowNew);
    callLink.hidden = !allowNew;
    show('recovery', { replace: true });
  }
  function clearPending() {
    state.pending = '';
    try { sessionStorage.removeItem(PENDING_KEY); sessionStorage.removeItem(LEGACY_PENDING_KEY); } catch (_) {}
  }
  function readPending() {
    var body;
    try { body = sessionStorage.getItem(PENDING_KEY) || sessionStorage.getItem(LEGACY_PENDING_KEY) || ''; } catch (_) { return null; }
    if (!body) return null;
    try {
      var payload = JSON.parse(body);
      if (payload.source !== 'walkv2-landing' || !UUID.test(payload.intakeNonce || '') || !UUID.test(String(payload.eventId || '').replace(/^wv2-/, ''))) return { expired: true };
      var date = Date.parse(payload.submittedAt);
      if (!Number.isFinite(date) || Date.now() - date > MAX_REPLAY_AGE || date > Date.now() + 60000) return { expired: true };
      return { body: body };
    } catch (_) { return { expired: true }; }
  }
  function contact() {
    if (mountedContact) { mountedContact.setAuthority(state.token); return; }
    if (contactFirstAnonymous()) {
      flow.querySelector('#contact-heading').textContent = "Let's start with a few details.";
      flow.querySelector('[data-screen="contact"] .helper').textContent = 'Add your details, then answer a few questions about your generator and home.';
    }
    mountedContact = BPPContactDetails.mount(flow.querySelector('[data-screen="contact"]'), {
      entryURL: entryURL.href,
      token: state.token,
      submitLabel: state.token ? 'Save my details' : contactFirstAnonymous() ? 'Continue' : 'See my estimate',
      canSubmit: function () { return !state.pending && !state.busy && (state.token ? state.verified : eligible()); },
      walkDraft: state.token || contactFirstAnonymous() ? null : draft,
      onBusy: function (busy) { state.busy = busy; refreshChoices(); },
      onSubmit: submitContact
    });
  }
  async function submitContact(payload) {
    if (state.pending) return retryIntake();
    if (!state.token && !eligible()) { show('connection'); return; }
    state.pending = JSON.stringify(payload);
    // Persist the complete immutable operation before its first transmission.
    try { sessionStorage.setItem(PENDING_KEY, state.pending); } catch (_) {}
    return retryIntake();
  }
  async function retryIntake() {
    if (!state.pending) return;
    var body = state.pending;
    state.busy = true;
    recovery("We're checking whether your details saved.", 'Keep this page open while we check your request.', null, false);
    if (JSON.parse(body).walkDraft && window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.show();
    var response;
    try { response = await WALK.submitLeadBody(body); }
    catch (_) { response = null; }
    state.busy = false;
    if (state.pending !== body) return;
    var result = response && response.body || {};
    var token = String(result.preReadToken || '');
    var original = JSON.parse(body);
    if (response && response.ok && TOKEN.test(token)) {
      if (original.walkDraft && result.intakeContract !== CONTRACT) {
        recovery('Your request needs a connection check.', 'Your details may already be saved. Please use your saved link or contact Backup Power Pro for help.', function () { return retryIntake(); }, false);
        return;
      }
      state.token = token;
      WALK.setToken(token);
      state.freshLegacy = !original.walkDraft && !original.existingToken && result.intakeContract !== CONTRACT;
      if (state.freshLegacy) WALK.markNewJourney(token);
      if (result.intakeContract === CONTRACT) WALK.rememberJourneyState(token, { quote_walk_v2: { intake_contract: CONTRACT, version: result.quoteWalkV2Version } });
      clearPending();
      if (original.existingToken) entryURL.searchParams.delete('edit');
      if (typeof window.BPPAnalytics?.setOwnerTestMode === 'function' && typeof result.ownerTest === 'boolean') BPPAnalytics.setOwnerTestMode(result.ownerTest);
      var meta = result.metaLeadEvent;
      if (meta && meta.eligible === true && window.BPPMeta) {
        if (meta.eventName === 'QuoteWalkStarted') BPPMeta.trackQuoteWalkStarted(meta.eventId);
        else if (meta.eventName === 'Lead') BPPMeta.trackLead(meta.eventId);
      }
      // The range bootstrap verifies the current server state and all route guards.
      // A new in-area guided intake does not need an extra read before that same check.
      if (original.walkDraft && !original.existingToken && result.intakeContract === CONTRACT && result.service_area_status === 'verified_in_area') {
        // Create from the committed intake version before the one fresh range read.
        // Uncertain creation is reconciled by that read and its existing retry path.
        if (Number.isSafeInteger(result.quoteWalkV2Version) && result.quoteWalkV2Version > 0) {
          state.busy = true;
          try { await WALK.stateAction(token, 'create_range', { revision_reason: 'initial' }); }
          catch (_) { /* The saved intake remains valid when range creation is uncertain. */ }
          finally { state.busy = false; }
        }
        WALK.go('range.html', token, null, true); return;
      }
      await loadProtected();
      return;
    }
    if (response && (response.status === 400 || response.status === 422) && result.error !== 'intake_replay_payload_mismatch') {
      clearPending();
      state.busy = false;
      if (original.walkDraft) hydrate({ quote_walk_v2: original.walkDraft });
      contact();
      mountedContact.hydrate({ first_name: [original.firstName, original.lastName].filter(Boolean).join(' '), phone: original.phone, address: original.address, service_area_status: original.addressUnverified ? 'pending_verification' : 'unconfirmed' });
      show('contact', { replace: true });
      mountedContact.showError('Your details did not save. Please check them and try again.', ['name', 'phone', 'address'].indexOf(result.field) !== -1 ? result.field : null);
      return;
    }
    var expired = response && (response.status === 410 || result.error === 'intake_retry_expired' || result.error === 'intake_payload_conflict');
    if (expired) {
      clearPending();
      recovery("We couldn't recover this submission.", 'Use a saved Quote Walk link if you have one, or contact Backup Power Pro before starting again.', null, true);
      return;
    }
    var message = response && response.status === 429 ? 'Too many tries too quickly. Wait one minute, then try again.' : 'The response did not arrive. Try again to check this same request. Your details will not be submitted as a new request.';
    recovery("We're checking whether your details saved.", message, function () { return retryIntake(); }, false);
  }
  function hydrate(view) {
    var v = view.quote_walk_v2 || {};
    state.outlets = WALK.normalizeConnectionSet(v.observed_connections || view.connection_answers).map(function (value) { return value.replace('A', ''); });
    state.room = v.panel_location || view.confirmed_panel_room || '';
    if (state.room === 'laundry') state.room = 'laundry_room';
    if (state.room === 'other') state.room = 'somewhere_else';
    state.distance = v.distance_band || view.distance_band || null;
    if (state.distance === 'not_sure') state.distance = null;
  }
  async function loadProtected() {
    state.verified = false;
    var preparingEstimate = window.BPPQuoteWalkEstimateLoading && BPPQuoteWalkEstimateLoading.isActive();
    recovery('Loading your saved request...', '', null, false);
    if (preparingEstimate) BPPQuoteWalkEstimateLoading.show();
    try {
      var currentToken = state.token;
      var view = await WALK.view(currentToken);
      if (currentToken !== state.token) return;
      state.view = view;
      state.verified = true;
      hydrate(view);
      var params = new URLSearchParams(entryURL.search);
      var edit = params.get('edit');
      if (WALK.isGuidedJourney(view, state.token)) {
        var destination = WALK.guidedDestination(state.token, view);
        if (destination.reason === 'deeper' || destination.reason === 'correction') { WALK.routeFromState(state.token, view, true); return; }
      }
      if (edit === 'details') {
        contact(); mountedContact.hydrate(view);
        show('contact', { replace: true });
        return;
      }
      if ((view.quote_walk_v2 || {}).service_area_status === 'verified_out_of_area' || view.service_area_status === 'verified_out_of_area') {
        recovery('Outside our current service area', 'We currently serve Greenville, Spartanburg and Pickens counties.', function () { entryURL.searchParams.set('edit', 'details'); contact(); mountedContact.hydrate(view); show('contact'); }, false);
        retryButton.textContent = 'Correct my address';
        flow.querySelector('[data-screen="recovery"] [data-save-for-later]').hidden = true;
        return;
      }
      if (WALK.isGuidedJourney(view, state.token) && ['connection', 'location', 'distance', 'outlet', 'panel', 'setup'].indexOf(edit) !== -1) {
        state.editing = true;
        show(edit === 'outlet' || edit === 'setup' ? 'connection' : edit === 'panel' ? 'location' : edit, { replace: true });
        return;
      }
      if (state.freshLegacy && !WALK.isGuidedJourney(view, state.token) && WALK.isUnansweredConnection(view)) {
        state.freshLegacy = false;
        WALK.go('connection.html', state.token, { sequence: '1' }, true);
        return;
      }
      WALK.routeFromState(state.token, view, true);
    } catch (error) {
      state.verified = false;
      var permanent = ['expired', 'missing'].indexOf(WALK.classifyRecoveryError(error)) !== -1;
      recovery(permanent ? "We couldn't open this saved request." : 'Your saved request could not load.', permanent ? 'Use your saved Quote Walk link, or start a new Quote Walk.' : 'Try again to open your saved answers.', permanent ? null : loadProtected, permanent);
    }
  }
  async function saveAnswers() {
    if (state.busy || !state.verified) return;
    state.busy = true; refreshChoices();
    if (eligible() && window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.show();
    try {
      await WALK.stateAction(state.token, 'save_guided_answers', { walkDraft: draft() });
      var view = await WALK.view(state.token);
      state.view = view;
      state.editing = false;
      WALK.routeFromState(state.token, view, true);
    } catch (error) {
      state.busy = false;
      if (error && error.code === 'stale_customer_authorization') {
        recovery('Your saved request has changed.', 'Load the current answers before making another change.', loadProtected, false);
      } else recovery('Your setup answers did not save.', 'Your selected answers are still here. Try again.', saveAnswers, false);
    }
  }
  function help(kind, trigger) {
    helpOrigin = state.screen;
    helpTrigger = trigger;
    var title = flow.querySelector('#help-heading');
    var copy = flow.querySelector('[data-help-copy]');
    var examples = flow.querySelector('[data-help-examples]');
    var back = flow.querySelector('[data-help-return]');
    var savedUnknown = flow.querySelector('[data-save-unknown]');
    if (!savedUnknown) {
      savedUnknown = document.createElement('button'); savedUnknown.type = 'button'; savedUnknown.className = 'cta qw-primary-action'; savedUnknown.dataset.saveUnknown = ''; savedUnknown.textContent = 'Save this answer';
      savedUnknown.addEventListener('click', saveAnswers); back.insertAdjacentElement('afterend', savedUnknown);
    }
    savedUnknown.hidden = !state.editing || kind === 'outlet';
    examples.replaceChildren();
    var texts = {
      outlet: ['Look at the outlets on the generator.', 'Compare the outlet shape and the markings beside it with these examples.', 'Choose my outlet'],
      mismatch: ['A compatible generator is needed for this service.', 'Use the outlet shape and label together. Save this link and return when you can check a compatible generator.', 'Back to outlet question'],
      'no-generator': ['A compatible generator is needed for this service.', 'Save this link and return when you can check a compatible generator.', 'Back to outlet question'],
      panel: ['Common places to look', 'Check the garage, basement, outside wall, closet or utility area. You may open the hinged outer door, but never remove screws or the inner cover.', 'I found it'],
      distance: ["Check the route when you're home.", 'You only need an approximate distance. If you cannot check now, save this link for later.', 'Back to distance question']
    };
    var words = texts[kind] || texts.outlet;
    title.textContent = words[0]; copy.textContent = words[1]; back.textContent = words[2];
    if (kind === 'outlet') {
      var choices = flow.querySelector('.choices').cloneNode(true);
      choices.querySelectorAll('button').forEach(function (button) { button.removeAttribute('data-connection'); button.disabled = true; button.setAttribute('aria-pressed', 'false'); });
      examples.appendChild(choices);
    }
    if (kind === 'mismatch' || kind === 'outlet') {
      var img = document.createElement('img'); img.src = '/walk-v2/connection-mistaken-outlets.png'; img.alt = 'Three similar-looking outlet shapes commonly mistaken for the supported generator outlets'; examples.appendChild(img);
      var explanation = document.createElement('p'); explanation.textContent = "These outlets are different. Some 120V outlets look similar. Don't choose a match by amperage alone."; examples.appendChild(explanation);
    }
    if (kind === 'panel') {
      var group = document.createElement('div'); group.className = 'panel-example-images';
      [['main-panel-example-breaker.jpg', 'Electrical breaker panel with its hinged outer door open'], ['main-panel-example-meter-combo.jpg', 'Outdoor electrical panel combined with an electric meter']].forEach(function (pair) { var image = document.createElement('img'); image.src = '/walk-v2/' + pair[0]; image.alt = pair[1]; image.width = image.height = 900; group.appendChild(image); });
      examples.appendChild(group);
    }
    show('help');
  }
  flow.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button || state.busy || state.pending) return;
    if (button.hasAttribute('data-connection')) {
      var amp = button.dataset.connection;
      state.outlets = state.outlets.indexOf(amp) === -1 ? state.outlets.concat(amp).sort() : state.outlets.filter(function (value) { return value !== amp; });
      refreshChoices();
    } else if (button.hasAttribute('data-room')) {
      state.room = ROOMS[button.dataset.room];
      refreshChoices();
      if (state.room === 'not_sure') help('panel', button);
    } else if (button.hasAttribute('data-dist')) {
      state.distance = BANDS[button.dataset.dist];
      refreshChoices();
      if (!state.distance) help('distance', button);
    } else if (button.hasAttribute('data-guided-next')) {
      if (state.screen === 'distance' && state.editing) saveAnswers();
      else show(screens[screens.indexOf(state.screen) + 1]);
    } else if (button.hasAttribute('data-help')) {
      if (state.editing && ['mismatch', 'no-generator'].indexOf(button.dataset.help) !== -1) state.outlets = [];
      help(button.dataset.help, button);
    }
    else if (button.hasAttribute('data-guided-back')) {
      var index = screens.indexOf(state.screen);
      if (index > 0) show(screens[index - 1]);
      else if (state.token) WALK.routeFromState(state.token, state.view);
    } else if (button.hasAttribute('data-help-return')) {
      show(helpOrigin);
      if (helpTrigger && !helpTrigger.closest('[hidden]')) helpTrigger.focus();
    }
  });
  retryButton.addEventListener('click', function () { if (retry && !state.busy) retry(); });
  newButton.addEventListener('click', function () {
    clearPending(); WALK.setToken(''); state.token = ''; state.view = null; state.verified = false;
    entryURL.search = ''; state.outlets = []; state.room = ''; state.distance = null;
    // A full navigation discards any previously authorized form instance.
    location.replace('/walk-v2/');
  });
  window.addEventListener('popstate', function (event) {
    if (state.pending) { recovery("We're checking whether your details saved.", 'Check this request before starting another.', retryIntake, false); return; }
    if (state.token && !state.editing) { loadProtected(); return; }
    if (event.state && event.state.qwg === instance && screens.indexOf(event.state.screen) !== -1) show(event.state.screen, { noHistory: true });
    else if (!state.token) show('connection', { noHistory: true });
  });
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    var token = WALK.token();
    if (token) { state.token = token; state.editing = false; loadProtected(); }
    else if (state.pending) retryIntake();
  });
  if (window.__BPP_INVALID_CAPABILITY_ENTRY) {
    recovery("We couldn't open this saved request.", 'Use a valid saved Quote Walk link, or start a new Quote Walk.', null, true);
  } else if (state.token) loadProtected();
  else {
    var pending = readPending();
    if (pending && pending.expired) { clearPending(); recovery("We couldn't recover this submission.", 'Use a saved Quote Walk link if you have one, or contact Backup Power Pro before starting again.', null, true); }
    else if (pending && pending.body) { state.pending = pending.body; retryIntake(); }
    else show('connection', { replace: true, noFocus: true });
  }
  if (typeof window.BPPQuoteWalkMarkReady === 'function') window.BPPQuoteWalkMarkReady();
})();
