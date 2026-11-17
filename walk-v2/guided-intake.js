/* Unsent answers can resume in this tab for 24 hours. Only an acknowledged
 * contact operation attaches them to a server-owned request. */
(function () {
  'use strict';
  var CONTRACT = 'guided-quote-walk-v1';
  var PENDING_KEY = 'bpp:qwv2:pending-guided-intake';
  var CONTINUATION_KEY = 'bpp:qwv2:guided-estimate-continuation';
  var LEGACY_PENDING_KEY = 'bpp:qwv2:pending-intake';
  var UNSENT_KEY = 'bpp:qwv2:unsent-guided-draft';
  var MAX_REPLAY_AGE = 15 * 60 * 1000;
  var UNSENT_DRAFT_MAX_AGE = 24 * 60 * 60 * 1000;
  var TOKEN = /^[a-zA-Z0-9_-]{32,160}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var ROOMS = { Garage: 'garage', Basement: 'basement', Outside: 'outside', Closet: 'closet', 'Utility area': 'laundry_room', 'Somewhere else': 'somewhere_else', 'More than one panel': 'more_than_one_panel', 'Not sure': 'not_sure' };
  var BANDS = { 'About 5 ft': 'about_5', '5-10 ft': '5_10', '10-20 ft': '10_20', '20-40 ft': '20_40', 'Over 40 ft': 'over_40', 'Not sure': null };
  var flow = document.querySelector('[data-guided-flow]');
  if (!flow) return;
  var panelExample = flow.querySelector('[data-panel-photo-example]');
  var panelExampleImage = panelExample && panelExample.querySelector('img');
  if (panelExampleImage) panelExampleImage.addEventListener('error', function () { panelExample.dataset.unavailable = 'true'; panelExample.hidden = true; });
  // An older cached core must not operate the current form or choose saved authority.
  if (!window.WALK || WALK.textReplyOnly !== true || WALK.initialPhotoTimeExtension !== true || WALK.wholeResponseDeadline !== true || WALK.savedReadMonotonic !== true || WALK.guidedAnswerVersionPinned !== true
      || !window.BPPContactDetails || BPPContactDetails.completeNameRecovery !== true || BPPContactDetails.anonymousAddressConfirmation !== true || BPPContactDetails.addressLookupDismissalSafe !== true || !window.BPPSaveForLater
      || !window.BPPGuidedEstimate || BPPGuidedEstimate.alwaysVisibleScope !== true || !window.BPPInitialPanelPhoto || BPPInitialPanelPhoto.timeExtensions !== true || BPPInitialPanelPhoto.photoRecovery !== true || BPPInitialPanelPhoto.localDiscard !== true || BPPInitialPanelPhoto.multiPhotoAppend !== true || typeof window.__BPP_WALK_TOKEN !== 'string'
      || window.BPPContactDetails.requiredEmailCapture !== true
      || flow.getAttribute('data-sms-submit-reminder-version') === 'bpp-pre-submit-sms-2026-10-16-v1' && BPPContactDetails.preSubmitSmsChoice !== true
      || (flow.querySelector('[data-power-guide-offer][data-consent-version="bpp-guide-consent-2026-10-16"]') || flow.querySelector('[data-power-guide-offer][data-consent-version="bpp-guide-consent-2026-10-19"]')) && BPPContactDetails.versionedConsentCapture !== true
      || flow.querySelector('[data-email-promotions-offer]') && (BPPContactDetails.emailPromotionsCapture !== true || !window.BPPEmailPromotionsChoice || BPPEmailPromotionsChoice.version !== 1)
      || !flow.querySelector('[data-request-card]') || !flow.querySelector('[data-email-error]')
      || !flow.querySelector('[data-estimate-confirmation]') || !flow.querySelector('[data-terminal-edit-cancel]')
      || !window.BPPEstimateTerminal || BPPEstimateTerminal.version !== 1
      || ['signature', 'confirmed'].some(function (name) { return typeof BPPEstimateTerminal[name] !== 'function'; })
      || !window.BPPGuidedPhotos || BPPGuidedPhotos.inlineEstimate !== true || typeof BPPGuidedPhotos.mount !== 'function'
      || ['initialPhoto', 'previewRange', 'acceptPreview', 'submitLeadBody', 'isGuidedJourney', 'guidedDestination', 'rememberJourneyState'].some(function (name) { return typeof WALK[name] !== 'function'; })) {
    document.documentElement.classList.remove('js');
    document.documentElement.classList.add('no-js');
    flow.setAttribute('inert', '');
    var notice = document.querySelector('.qw-script-recovery');
    if (notice) {
      // A cached core may have reported readiness before this guard ran.
      notice.hidden = false;
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
        if (target.href === location.href) location.reload();
        else location.replace(target.href);
      };
      notice.appendChild(reload);
    }
    return;
  }
  var entryURL = new URL(location.href);
  entryURL.searchParams.delete('t');
  var landing = document.querySelector('[data-first-phase-landing] [data-readiness-landing]');
  // The optional first-phase presentation must not replace the supported
  // contact-first bridge when that static admission mode is selected.
  if (landing && flow.dataset.anonymousEntry === 'contact-first-compatible') {
    landing.hidden = true;
    document.body.classList.remove('readiness-landing-active');
    landing = null;
  }
  var instance = crypto.randomUUID();
  var screens = ['connection', 'location', 'distance', 'contact'];
  var state = { protectedEntry: Boolean(window.__BPP_CAPABILITY_ENTRY), screen: 'connection', outlets: [], room: '', distance: null, token: WALK.token(), view: null, verified: false, pending: '', pendingNotSent: false, pendingUnknown: false, pendingConflict: false, busy: false, editing: false };
  // A separately reviewed static bridge release changes only new anonymous
  // admission. Protected requests and frozen possibly-successful retries retain
  // their existing contract. Query parameters cannot enable guided admission.
  function contactFirstAnonymous() { return flow.dataset.anonymousEntry === 'contact-first-compatible' && !state.token && !state.pending; }
  var retry;
  var helpOrigin = 'connection';
  var helpKind = 'outlet';
  var helpTrigger;
  var detailsSetupEditing = false;
  var detailsSetupOriginal = '';
  var detailsSetupVersion = null;
  var mountedContact;
  var activeScreen;
  var initialPhoto;
  var acceptedInitialRange = '';
  var restoredRangeIntent = '';
  var unsentUpdatedAt = 0;
  var unsentExpiryTimer;
  var restoringUnsent = false;
  var draftStorageAvailable = true;
  var contactCard = flow.querySelector('[data-contact-card]');
  var initialChoice = flow.querySelector('[data-initial-range-choice]');
  var initialPhotoRoot = flow.querySelector('[data-initial-panel-photo]');
  var initialPhotoTimeHost = flow.querySelector('[data-initial-photo-time-host]');
  var initialAccept = flow.querySelector('[data-accept-initial-range]');
  var initialHint = flow.querySelector('[data-initial-range-hint]');
  var estimatePreview = null;
  var shownEstimateHashes = new Set();
  var previewDraft = '';
  var previewRequest = 0;
  var acknowledgedToken = '';
  var requestCard = flow.querySelector('[data-request-card]');
  var terminalCard = flow.querySelector('[data-estimate-confirmation]');
  var guideOffer = flow.querySelector('[data-power-guide-offer]');
  var promotionsOffer = flow.querySelector('[data-email-promotions-offer]');
  var quoteSmsChoice = flow.querySelector('[data-quote-sms-consent]');
  if (!state.token && promotionsOffer && window.BPPEmailPromotionsChoice) {
    var promotionsDraft = BPPEmailPromotionsChoice.readForForm(promotionsOffer.getAttribute('data-consent-version'));
    if (promotionsDraft) {
      promotionsOffer.checked = promotionsDraft.promotions;
      if (quoteSmsChoice) quoteSmsChoice.checked = promotionsDraft.smsQuoteService;
    }
  }
  if (!state.token && guideOffer && window.BPPPowerGuideChoice) {
    var renderedConsentVersion = guideOffer && guideOffer.getAttribute('data-consent-version');
    var guideDraft = typeof BPPPowerGuideChoice.readForForm === 'function'
      ? BPPPowerGuideChoice.readForForm(renderedConsentVersion)
      : !renderedConsentVersion || renderedConsentVersion === 'bpp-guide-consent-2026-10-15' ? BPPPowerGuideChoice.read() : null;
    if (guideDraft && !guideDraft.nonce && !guideDraft.acceptanceId) {
      if (guideOffer) guideOffer.checked = guideDraft.guideAndNewsletter;
      if (quoteSmsChoice) quoteSmsChoice.checked = guideDraft.smsQuoteService;
    }
  }
  var recoveryPanel = flow.querySelector('[data-screen="recovery"]');
  var inlineEstimate = Boolean(state.token && entryURL.searchParams.get('estimate') === 'received');
  var inlineEditing = false;
  var inlineExpected = null;
  var inlineEndingViewed = false;
  var inlinePreviewGeneration = 0;
  function photoFirstOperation(original) {
    return Boolean(original && original.walkDraft && original.estimatePreviewHash && original.initialPanelPhoto && !original.existingToken);
  }
  function revealHeading(node) {
    var active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)) active.blur();
    node.tabIndex = -1; node.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function acceptedFirstName(view) {
    // Identity is presentation of this fresh accepted record, never the typed draft.
    if (!inlineEstimate || !state.token || !state.verified || state.pending || state.pendingUnknown || state.pendingConflict || inlineEditing
        || !view || view !== state.view || !WALK.isGuidedJourney(view, state.token)
        || !BPPEstimateTerminal.confirmed(view, inlineExpected) || typeof view.first_name !== 'string') return '';
    return view.first_name.trim();
  }
  function updateEstimateHeading(view) {
    var firstName = acceptedFirstName(view);
    flow.querySelector('[data-guided-position]').textContent = firstName ? firstName + '’s estimate' : 'Your estimate';
  }
  function inlineShell(view) {
    if (landing) { landing.hidden = true; document.body.classList.remove('readiness-landing-active'); }
    // A prior accepted receipt keeps its presentation through Back and read-only retry.
    if (entryURL.searchParams.get('estimate') === 'received') {
      history.replaceState({ qwg: instance, screen: 'confirmation' }, '', entryURL.pathname + entryURL.search);
    }
    if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.hide();
    if (mountedContact) mountedContact.closeSuggestions();
    state.screen = 'contact'; activeScreen = flow.querySelector('[data-screen="contact"]');
    flow.hidden = false;
    flow.querySelectorAll('[data-screen]').forEach(function (node) { node.hidden = node !== activeScreen; });
    document.body.dataset.activeScreen = 'contact';
    document.getElementById('mainPage').dataset.screenLabel = 'Quote walk: guided details';
    activeScreen.classList.add('guided-saved');
    activeScreen.setAttribute('aria-label', 'Your estimate and request');
    progress.hidden = false;
    updateEstimateHeading(view);
    flow.querySelector('[data-guided-back]').hidden = true;
    initialPhotoRoot.hidden = true; initialChoice.hidden = true; contactCard.hidden = true; terminalCard.hidden = true;
    if (initialPhotoTimeHost) initialPhotoTimeHost.hidden = true;
    requestCard.classList.add('guided-request-form');
    flow.querySelector('[data-estimate-layout]').hidden = false;
    flow.querySelector('[data-contact-reveal-announcement]').textContent = '';
    requestCard.appendChild(recoveryPanel); recoveryPanel.hidden = true;
    flow.querySelector('.guided-range-utilities').hidden = true;
    refreshSaves(); updateDraftNote();
  }
  function renderInlineEstimate(snapshot, savedState) {
    var layout = flow.querySelector('[data-estimate-layout]');
    if (!layout.querySelector('.guided-estimate-card')) {
      var cards = BPPGuidedEstimate.cards(snapshot, savedState || {}, { alwaysVisibleScope: true });
      layout.prepend(cards.estimate); layout.appendChild(cards.scope);
    }
    estimatePreview = snapshot;
    flow.querySelector('[data-estimate-status]').textContent = '';
    layout.hidden = false;
  }
  function prepareInlinePending(original) {
    if (!photoFirstOperation(original)) return;
    inlineEstimate = true; inlineEditing = false;
    if (estimatePreview) return;
    hydrate({ quote_walk_v2: original.walkDraft });
    var generation = ++inlinePreviewGeneration;
    flow.querySelector('[data-estimate-status]').textContent = 'Loading your saved estimate...';
    WALK.previewRange(original.walkDraft).then(function (snapshot) {
      if (generation !== inlinePreviewGeneration || !inlineEstimate || !state.pending) return;
      if (!BPPGuidedEstimate.usable(snapshot) || snapshot.preview_hash !== original.estimatePreviewHash) throw new Error('estimate_changed');
      renderInlineEstimate(snapshot, original.walkDraft);
    }).catch(function () {
      if (generation === inlinePreviewGeneration && inlineEstimate && state.pending) flow.querySelector('[data-estimate-status]').textContent = 'Your estimate could not refresh. We are checking the same saved request.';
    });
  }
  function editInlineDetails() {
    if (state.busy || state.pending) return;
    ++protectedReadGeneration; ++inlinePreviewGeneration;
    var savedState = state.view && state.view.quote_walk_v2 || {};
    if (!flow.querySelector('.guided-estimate-card')) {
      if (!BPPGuidedEstimate.usable(savedState.current_range_snapshot)) {
        recovery('Your saved estimate could not load.', 'Try again to check your saved estimate before changing your details.', function () { loadProtected(); }, false); return;
      }
      renderInlineEstimate(savedState.current_range_snapshot, savedState);
    }
    flow.querySelector('[data-screen="contact"]').classList.add('guided-saved');
    inlineEditing = true;
    recoveryPanel.hidden = true; terminalCard.hidden = true;
    contact(); mountedContact.hydrate(state.view);
    show('contact', { replace: true });
    flow.querySelector('[data-terminal-edit-cancel]').hidden = false;
    flow.querySelector('[data-terminal-edit-cancel]').textContent = entryURL.searchParams.get('estimate') === 'received' ? 'Back to confirmation' : 'Back to estimate';
    requestCard.dataset.requestPhase = 'form';
    revealHeading(flow.querySelector('#contact-heading'));
  }
  function terminalDestination(view) {
    var v = view.quote_walk_v2 || {}, correction = (v.photo_review || {}).current_correction;
    var destination = WALK.guidedDestination(state.token, view);
    return destination.url || destination.reason === 'area' || destination.reason === 'missing' || destination.reason === 'range'
      || correction && !correction.resolved_at && !correction.response_submission_id;
  }
  async function showInlineConfirmation(view) {
    if (terminalDestination(view)) { inlineEstimate = false; WALK.routeFromState(state.token, view, true); return; }
    if (!WALK.isGuidedJourney(view, state.token) || !BPPEstimateTerminal.confirmed(view, inlineExpected)) {
      recovery('Your saved request needs a check.', 'We could not confirm the current estimate and photo review request. Try again to check this saved request.', function () { loadProtected(); }, false);
      return;
    }
    entryURL.searchParams.delete('edit'); entryURL.searchParams.set('estimate', 'received');
    history.replaceState({ qwg: instance, screen: 'confirmation' }, '', entryURL.pathname + entryURL.search);
    ++inlinePreviewGeneration; inlineEditing = false;
    renderInlineEstimate(view.quote_walk_v2.current_range_snapshot, view.quote_walk_v2);
    inlineShell(view); terminalCard.hidden = false;
    flow.querySelector('.guided-range-utilities').hidden = false;
    requestCard.dataset.requestPhase = 'confirmed';
    var currentView = view, currentToken = state.token, generation = protectedReadGeneration;
    await BPPGuidedPhotos.mount({ inlineEstimate: true, token: currentToken, view: view, content: terminalCard,
      currentView: function () { return currentView; },
      acceptedFirstName: function () { return acceptedFirstName(currentView); },
      guideChoice: function () { return window.BPPPowerGuideChoice ? BPPPowerGuideChoice.choice(currentView) : undefined; },
      element: function (tag, text, className) { var n = document.createElement(tag); if (text) n.textContent = text; if (className) n.className = className; return n; },
      state: function () { return currentView.quote_walk_v2 || {}; },
      review: function () { return (currentView.quote_walk_v2 || {}).photo_review || {}; },
      guard: function () { return inlineEstimate && !inlineEditing && generation === protectedReadGeneration && currentToken === state.token && currentView === state.view; },
      focus: function () { var h = terminalCard.querySelector('h2'); if (h) revealHeading(h); },
      editDetails: editInlineDetails,
      load: async function () {
        var fresh = await WALK.view(currentToken);
        if (generation !== protectedReadGeneration || currentToken !== state.token || !inlineEstimate || inlineEditing
          || !BPPEstimateTerminal.confirmed(fresh, inlineExpected)
          || String(fresh.phone || '').replace(/\D/g, '').slice(-10) !== String(view.phone || '').replace(/\D/g, '').slice(-10)
          || fresh.id !== view.id || fresh.pre_read_id !== view.pre_read_id || fresh.contact_id !== view.contact_id
          || fresh.quote_walk_v2.pre_read_id !== view.quote_walk_v2.pre_read_id
          || fresh.quote_walk_v2.readiness.acceptance_id !== view.quote_walk_v2.readiness.acceptance_id
          || fresh.quote_walk_v2.handoff_receipt.id !== view.quote_walk_v2.handoff_receipt.id) throw new Error('stale_confirmation_read');
        currentView = fresh; state.view = fresh; updateEstimateHeading(fresh); return currentView;
      },
      error: function () {}
    });
    if (!inlineEndingViewed && !terminalCard.hidden && generation === protectedReadGeneration && currentToken === state.token && !inlineEditing) {
      inlineEndingViewed = true;
      WALK.ph('walk_v2_screen_view', { screen: 'guided_photos-later' });
    }
  }
  flow.querySelector('[data-terminal-edit-cancel]').addEventListener('click', function () { entryURL.searchParams.delete('edit'); inlineEditing = false; loadProtected(); });
  var protectedReadGeneration = 0;
  var intakeAttemptGeneration = 0;
  var recoveryHeading = flow.querySelector('#recovery-heading');
  var recoveryCopy = flow.querySelector('[data-recovery-copy]');
  var retryButton = flow.querySelector('[data-recovery-retry]');
  var newButton = flow.querySelector('[data-recovery-new]');
  var serviceAreaGuide = flow.querySelector('[data-service-area-guide]');
  var progress = flow.querySelector('[data-guided-progress]');
  var draftNote = flow.querySelector('[data-unsent-draft-note]');
  function updateDraftNote() {
    if (!draftNote) return;
    draftNote.hidden = Boolean(state.token || state.protectedEntry || state.pending || state.pendingUnknown || state.pendingConflict);
    var copy = draftStorageAvailable
      ? 'Reload this tab within 24 hours to restore unsent answers and details. This temporary copy is cleared when your details are saved.'
      : 'Keep this page open. This browser cannot keep your unsent answers after a reload.';
    if (draftNote.textContent !== copy) draftNote.textContent = copy;
  }
  function clearUnsent() {
    restoredRangeIntent = ''; unsentUpdatedAt = 0;
    clearTimeout(unsentExpiryTimer);
    unsentExpiryTimer = null;
    try { sessionStorage.removeItem(UNSENT_KEY); } catch (_) {}
    updateDraftNote();
  }
  function scheduleUnsentExpiry() {
    clearTimeout(unsentExpiryTimer);
    if (!unsentUpdatedAt) return;
    // An active timer does not extend retention if the system clock moves backward.
    unsentExpiryTimer = setTimeout(clearUnsent, Math.min(UNSENT_DRAFT_MAX_AGE, Math.max(1, UNSENT_DRAFT_MAX_AGE - (Date.now() - unsentUpdatedAt))));
  }
  function rememberUnsent(touch) {
    if (restoringUnsent || state.token || state.protectedEntry || state.pending || state.pendingUnknown || state.pendingConflict || window.__BPP_INVALID_CAPABILITY_ENTRY) return;
    if (touch) unsentUpdatedAt = Date.now();
    if (!unsentUpdatedAt) return;
    var fields = {};
    ['name', 'phone', 'email', 'addr'].forEach(function (key) {
      var input = flow.querySelector('[data-f="' + key + '"]');
      fields[key === 'addr' ? 'address' : key] = input ? input.value : '';
    });
    var saved = { schema: CONTRACT, updatedAt: unsentUpdatedAt, outlets: state.outlets.slice(), room: state.room, distance: state.distance,
      screen: landing && state.screen === 'landing' ? 'landing' : state.screen === 'help' ? 'help' : screens.indexOf(state.screen) !== -1 ? state.screen : 'contact',
      helpKind: helpKind, helpOrigin: helpOrigin, contact: fields, acceptedRange: acceptedInitialRange || restoredRangeIntent };
    try {
      // No image bytes, capability, tracking ID, URL, consent or request body enter this draft.
      sessionStorage.setItem(UNSENT_KEY, JSON.stringify(saved));
      draftStorageAvailable = sessionStorage.getItem(UNSENT_KEY) === JSON.stringify(saved);
    } catch (_) { draftStorageAvailable = false; }
    if (touch) scheduleUnsentExpiry();
    updateDraftNote();
  }
  function readUnsent() {
    if (state.token || state.protectedEntry || window.__BPP_INVALID_CAPABILITY_ENTRY) return null;
    try {
      var raw = sessionStorage.getItem(UNSENT_KEY);
      if (!raw) return null;
      var saved;
      try { saved = JSON.parse(raw); } catch (_) { clearUnsent(); return null; }
      var details = saved && saved.contact;
      if (details && details.email === undefined) details.email = ''; // Keep older unsent drafts recoverable.
      var age = saved && Date.now() - saved.updatedAt;
      if (!saved || saved.schema !== CONTRACT || !Number.isSafeInteger(saved.updatedAt) || age < 0 || age >= UNSENT_DRAFT_MAX_AGE
          || !Array.isArray(saved.outlets) || saved.outlets.length > 2 || new Set(saved.outlets).size !== saved.outlets.length || saved.outlets.some(function (value) { return value !== '30' && value !== '50'; })
          || typeof saved.room !== 'string' || saved.room !== '' && Object.values(ROOMS).indexOf(saved.room) === -1
          || saved.distance !== null && Object.values(BANDS).indexOf(saved.distance) === -1
          || screens.concat(landing ? ['help', 'landing'] : ['help']).indexOf(saved.screen) === -1 || !details
          || ['name', 'phone', 'email', 'address'].some(function (key) { return typeof details[key] !== 'string' || details[key].length > (key === 'address' ? 2048 : 256); })
          || typeof saved.acceptedRange !== 'string' || saved.acceptedRange !== '' && !/^[a-f0-9]{64}:[0-9a-f-]{36}:[0-9]+$/.test(saved.acceptedRange)
          || ['outlet', 'mismatch', 'no-generator', 'panel', 'distance'].indexOf(saved.helpKind) === -1 || screens.indexOf(saved.helpOrigin) === -1) {
        clearUnsent(); return null;
      }
      return saved;
    } catch (_) { draftStorageAvailable = false; updateDraftNote(); return null; }
  }
  function restoreUnsent(saved) {
    if (!saved) { updateDraftNote(); return false; }
    restoringUnsent = true;
    unsentUpdatedAt = saved.updatedAt;
    scheduleUnsentExpiry();
    state.outlets = saved.outlets.slice(); state.room = saved.room; state.distance = saved.distance;
    restoredRangeIntent = saved.acceptedRange;
    contact();
    mountedContact.hydrate({ contact_name: saved.contact.name, phone: saved.contact.phone, email: saved.contact.email, address: saved.contact.address }, { requiresAddressConfirmation: true });
    if (saved.screen === 'help') help(saved.helpKind, null, { origin: saved.helpOrigin });
    else show(saved.screen, { replace: true, noFocus: true });
    restoringUnsent = false;
    updateDraftNote();
    return true;
  }
  var saveControls = Array.from(flow.querySelectorAll('[data-save-for-later]')).map(function (root) {
    return BPPSaveForLater.mount(root, function () {
      return { mode: state.token ? (state.verified ? 'protected' : 'unavailable') : state.protectedEntry ? 'unavailable' : 'public', token: state.token, verified: state.verified, pending: Boolean(state.pending) || state.pendingUnknown || state.pendingConflict, pendingNotSent: state.pendingNotSent, screen: state.screen };
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
  // This optional presentation step does not change quote answers or backend contracts.
  function showLanding(options) {
    options = options || {};
    state.screen = 'landing';
    flow.hidden = true;
    landing.hidden = false;
    document.body.dataset.activeScreen = 'landing';
    document.body.classList.add('readiness-landing-active');
    document.getElementById('mainPage').dataset.screenLabel = 'Generator connection landing page';
    if (!options.noHistory) history[options.replace ? 'replaceState' : 'pushState']({ qwg: instance, screen: 'landing' }, '', entryURL.pathname + entryURL.search);
    if (!options.noFocus) { landing.querySelector('h1').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  }
  if (landing) landing.addEventListener('click', function (event) {
    if (!event.target.closest('[data-first-phase-start]') || state.busy || state.pending || state.token || state.protectedEntry) return;
    event.preventDefault();
    if (state.screen === 'landing') show('connection');
  });
  function show(screen, options) {
    if (landing && screen === 'landing' && !state.token && !state.pending && !state.protectedEntry) { showLanding(options); return; }
    if (landing) { landing.hidden = true; document.body.classList.remove('readiness-landing-active'); }

    if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.hide();
    options = options || {};
    if (recoveryPanel.parentElement === requestCard) flow.appendChild(recoveryPanel);
    terminalCard.hidden = true;
    flow.querySelector('[data-terminal-edit-cancel]').hidden = true;
    flow.querySelector('[data-guided-back]').hidden = false;
    flow.querySelector('.guided-range-utilities').hidden = false;
    if (screen === 'contact' && state.token && detailsSetupEditing && state.editing) {
      if (detailsSetupOriginal === JSON.stringify(draft())) { detailsSetupEditing = false; detailsSetupVersion = null; state.editing = false; }
      else screen = 'distance'; // History never silently discards or commits edited setup answers.
    }
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
    if (initialPhotoTimeHost) initialPhotoTimeHost.hidden = Boolean(state.token || contactFirstAnonymous());
    activeScreen = flow.querySelector('[data-screen="' + screen + '"]');
    document.body.dataset.activeScreen = screen;
    document.getElementById('mainPage').dataset.screenLabel = screen === 'connection' || contactFirstAnonymous() ? 'Landing page (interactive, mobile)' : 'Quote walk: guided details';
    progress.hidden = contactFirstAnonymous() || (screen === 'connection' && (!landing || state.token || state.protectedEntry)) || screen === 'recovery' || screen === 'help';
    flow.querySelector('[data-guided-position]').textContent = { connection: 'Outlets', location: 'Panel', distance: 'Distance', contact: inlineEstimate ? 'Your estimate' : state.token ? 'Details' : 'Your estimate' }[screen] || '';
    refreshChoices(); refreshSaves();
    updateDraftNote();
    if (screen === 'contact' && inlineEstimate && inlineEditing) { activeScreen.setAttribute('aria-label', 'Your estimate and contact details'); contact(); refreshInitialGate(); }
    else if (screen === 'contact') { activeScreen.removeAttribute('aria-labelledby'); activeScreen.setAttribute('aria-label', state.token ? 'Your contact details' : 'Your estimate and panel photo'); contact(); refreshInitialGate(); if (!state.token && !contactFirstAnonymous()) loadEstimate(); }
    flow.querySelector('[data-terminal-edit-cancel]').hidden = !(inlineEstimate && inlineEditing && screen === 'contact');
    if (!options.noHistory) {
      // Only a logical screen and instance marker enter history, never answers or identity.
      var navigationState = { qwg: instance, screen: screen };
      if (screen === 'help') { navigationState.helpKind = helpKind; navigationState.helpOrigin = helpOrigin; }
      history[options.replace ? 'replaceState' : 'pushState'](navigationState, '', entryURL.pathname + entryURL.search);
    }
    if (!options.noFocus) {
      var heading = activeScreen.querySelector('h1, h2');
      if (heading) heading.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    WALK.ph('walk_v2_screen_view', { screen: screen === 'contact' && !state.token && !contactFirstAnonymous() ? 'guided_estimate_contact' : 'guided_' + screen });
  }
  async function loadEstimate(force) {
    var selected = JSON.stringify(draft());
    var screen = flow.querySelector('[data-screen="contact"]');
    var layout = screen.querySelector('[data-estimate-layout]');
    var status = screen.querySelector('[data-estimate-status]');
    screen.classList.add('guided-saved');
    if (!force && previewDraft === selected && estimatePreview) { initialPhoto.invalidate(); refreshInitialGate(); return; }
    var request = ++previewRequest;
    estimatePreview = null; previewDraft = selected; acceptedInitialRange = '';
    refreshInitialGate();
    layout.querySelectorAll('.guided-estimate-card, .guided-range-included').forEach(function (node) { node.remove(); });
    status.textContent = 'Preparing your estimate...';
    layout.hidden = true;
    mountedContact.refresh();
    if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.show('estimate');
    try {
      var snapshot = await WALK.previewRange(JSON.parse(selected));
      if (request !== previewRequest || selected !== JSON.stringify(draft())) return;
      if (!BPPGuidedEstimate.usable(snapshot) || !/^[a-f0-9]{64}$/.test(snapshot.preview_hash || '')) throw new Error('invalid_estimate');
      estimatePreview = snapshot;
      var cards = BPPGuidedEstimate.cards(snapshot, { panel_inventory_status: draft().panel_inventory_status }, { alwaysVisibleScope: true });
      layout.prepend(cards.estimate); layout.appendChild(cards.scope);
      status.textContent = ''; layout.hidden = false;
      if (!shownEstimateHashes.has(snapshot.preview_hash)) {
        shownEstimateHashes.add(snapshot.preview_hash);
        WALK.ph('walk_v2_price_shown', { state: 'range', has_range: true });
      }
      initialPhoto.invalidate(); refreshInitialGate();
    } catch (_) {
      if (request !== previewRequest) return;
      status.textContent = 'Your estimate could not load. Your setup answers are still here.';
      var again = document.createElement('button'); again.type = 'button'; again.className = 'cta qw-primary-action'; again.textContent = 'Try again';
      again.onclick = function () { loadEstimate(true); }; status.appendChild(again);
    } finally {
      if (request === previewRequest && state.screen === 'contact' && !state.pending) {
        if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.hide();
        var heading = !layout.hidden && layout.querySelector('.guided-estimate-card h1');
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
        else { status.tabIndex = -1; status.focus({ preventScroll: true }); }
      }
    }
  }
  function initialRangeKey() {
    var receipt = initialPhoto && initialPhoto.receipt();
    return receipt && estimatePreview ? estimatePreview.preview_hash + ':' + receipt.photoId + ':' + receipt.stageRevision : '';
  }
  function initialContactAllowed() {
    return Boolean(initialPhoto && initialPhoto.ready() && initialRangeKey() && acceptedInitialRange === initialRangeKey());
  }
  function initialSubmissionAllowed() {
    return initialContactAllowed() && typeof initialPhoto.submissionReady === 'function' && initialPhoto.submissionReady();
  }
  function refreshInitialGate() {
    if (inlineEstimate) {
      initialPhotoRoot.hidden = true; initialChoice.hidden = true;
      var protectedPhotoEdit = contactCard.querySelector('[data-edit-initial-photo]');
      if (protectedPhotoEdit) protectedPhotoEdit.hidden = true;
      if (initialPhotoTimeHost) initialPhotoTimeHost.hidden = true;
      contactCard.hidden = !inlineEditing;
      requestCard.classList.add('guided-request-form');
      if (mountedContact) mountedContact.refresh();
      return;
    }
    var anonymous = !state.token && !contactFirstAnonymous();
    initialPhotoRoot.hidden = !anonymous;
    if (initialPhotoTimeHost) initialPhotoTimeHost.hidden = !anonymous;
    var ready = Boolean(estimatePreview && previewDraft === JSON.stringify(draft()) && initialPhoto && initialPhoto.ready());
    if (restoredRangeIntent && ready && initialPhoto.submissionReady()) {
      // A restored local choice becomes usable only after fresh server photo and estimate confirmation.
      if (restoredRangeIntent === initialRangeKey()) acceptedInitialRange = restoredRangeIntent;
      restoredRangeIntent = '';
    }
    if (!ready || acceptedInitialRange !== initialRangeKey()) acceptedInitialRange = '';
    var photoManage = initialPhotoRoot.querySelector('[data-initial-photo-manage]');
    var revisingPhoto = Boolean(anonymous && ready && photoManage && photoManage.open);
    // Keep the retained-photo action in place while its authority is checked;
    // the existing readiness gate below still disables submission.
    initialChoice.hidden = !anonymous || !initialPhotoRoot.classList.contains('has-saved-photo') || initialContactAllowed() || revisingPhoto;
    var contactWasVisible = !contactCard.hidden;
    var contactFocusLost = contactCard.contains(document.activeElement) || document.activeElement === document.body;
    contactCard.hidden = anonymous && (!initialContactAllowed() || revisingPhoto);
    // One task occupies the card at a time. Keep the same durable photo
    // controller mounted so returning to it never discards a saved photo.
    initialPhotoRoot.hidden = !anonymous || !contactCard.hidden;
    var editInitialPhoto = contactCard.querySelector('[data-edit-initial-photo]');
    if (editInitialPhoto) {
      editInitialPhoto.hidden = !anonymous || contactCard.hidden;
      editInitialPhoto.disabled = state.busy || Boolean(state.pending);
    }
    if (anonymous && !contactWasVisible && !contactCard.hidden) WALK.ph('walk_v2_screen_view', { screen: 'guided_contact' });
    if (requestCard) requestCard.classList.toggle('guided-request-form', anonymous && !contactCard.hidden);
    var revealAnnouncement = flow.querySelector('[data-contact-reveal-announcement]');
    var revealCopy = anonymous && !contactCard.hidden ? 'Estimate range selected. Contact form ready.' : revisingPhoto ? 'Photo controls are open. Your typed details are kept in this tab.' : '';
    if (revealAnnouncement && revealAnnouncement.textContent !== revealCopy) revealAnnouncement.textContent = revealCopy;
    flow.querySelector('[data-screen="contact"]').classList.toggle('guided-contact-revealed', anonymous && !contactCard.hidden);
    if (anonymous && !revisingPhoto && contactWasVisible && contactCard.hidden && contactFocusLost && state.screen === 'contact' && !initialPhotoRoot.hidden) {
      var photoHeading = initialPhotoRoot.querySelector('h2, h3');
      if (photoHeading) { photoHeading.tabIndex = -1; photoHeading.focus({ preventScroll: true }); photoHeading.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }
    }
    if (contactCard.hidden && mountedContact) mountedContact.closeSuggestions();
    initialAccept.disabled = !ready || !initialPhoto.submissionReady() || state.busy || Boolean(state.pending);
    initialAccept.hidden = anonymous && initialContactAllowed();
    initialAccept.textContent = 'Submit photos';
    var checkingPhoto = initialPhotoRoot.getAttribute('aria-busy') === 'true';
    initialHint.textContent = initialContactAllowed() ? 'Estimate range selected. Your panel photo is saved.' : checkingPhoto ? 'Wait for your photo to be confirmed before continuing.' : ready ? '' : 'Complete the photo step above to continue.';
    initialHint.hidden = !initialHint.textContent;
    if (mountedContact) mountedContact.refresh();
    rememberUnsent(false);
  }
  initialPhoto = BPPInitialPanelPhoto.mount(initialPhotoRoot, {
    previewHash: function () { return estimatePreview && estimatePreview.preview_hash || ''; },
    timeWarningRoot: initialPhotoTimeHost,
    onChange: refreshInitialGate
  });
  // Continue belongs at the bottom of the same photo card, without another
  // visual wrapper or an independently mounted submission operation.
  initialPhotoRoot.appendChild(initialChoice);
  contactCard.addEventListener('click', function (event) {
    var edit = event.target.closest('[data-edit-initial-photo]');
    if (!edit || !contactCard.contains(edit) || state.token || inlineEstimate || state.busy || state.pending) return;
    acceptedInitialRange = ''; restoredRangeIntent = '';
    refreshInitialGate();
    var photoHeading = initialPhotoRoot.querySelector('h2');
    if (photoHeading) revealHeading(photoHeading);
  });
  initialPhotoRoot.addEventListener('toggle', function (event) {
    if (event.target.matches('[data-initial-photo-manage]')) refreshInitialGate();
  }, true);
  initialAccept.addEventListener('click', function () {
    if (initialAccept.disabled || state.busy || state.pending || !initialPhoto.submissionReady()) return;
    acceptedInitialRange = initialRangeKey();
    refreshInitialGate();
    if (!contactCard.hidden) {
      var contactHeading = contactCard.querySelector('h2');
      contactHeading.tabIndex = -1;
      contactHeading.focus({ preventScroll: true });
      // Expand this same card naturally; reveal only as much as needed to read its heading.
      contactHeading.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  });
  function recovery(title, copy, callback, allowNew) {
    recoveryPanel.removeAttribute('data-service-area-review');
    if (serviceAreaGuide) serviceAreaGuide.hidden = true;
    retryButton.removeAttribute('data-service-area-edit');
    recoveryHeading.textContent = title;
    recoveryCopy.textContent = copy || '';
    retry = callback;
    retryButton.hidden = !callback;
    retryButton.disabled = false;
    retryButton.textContent = 'Try again';
    newButton.hidden = !allowNew;
    flow.querySelector('[data-screen="recovery"] [data-save-for-later]').hidden = Boolean(allowNew);
    if (inlineEstimate) {
      inlineShell(); recoveryPanel.hidden = false;
      recoveryPanel.querySelector('[data-save-for-later]').hidden = true;
      requestCard.dataset.requestPhase = state.busy ? 'saving' : 'recovery';
      revealHeading(recoveryHeading);
    } else show('recovery', { replace: true });
  }
  function serviceAreaReview(view) {
    // A server receipt is the only authority for the saved-review message.
    inlineEstimate = false;
    recovery('Your request is saved for address review.',
      'Key will review the address and contact details you submitted. Your installation area and quote are not confirmed, and the preliminary range has not been accepted. You do not need to keep trying the same address.',
      function () {
        entryURL.searchParams.set('edit', 'details');
        loadProtected();
      }, false);
    recoveryPanel.setAttribute('data-service-area-review', 'pending');
    retryButton.textContent = 'Edit address'; retryButton.setAttribute('data-service-area-edit', '');
    if (serviceAreaGuide) serviceAreaGuide.hidden = false;
    flow.querySelector('[data-screen="recovery"] [data-save-hint]').textContent = 'Save this link to return to your request.';
  }
  function outsideServiceArea(view) {
    inlineEstimate = false;
    recovery('This home is outside our installation area.',
      'We serve Greenville, Spartanburg, Pickens, Anderson, Laurens, Cherokee and Union counties in South Carolina. You can still use the free generator guide. If the address is wrong, you can edit it.',
      function () { contact(); mountedContact.hydrate(view); show('contact', { replace: true }); }, false);
    retryButton.textContent = 'Edit address'; retryButton.setAttribute('data-service-area-edit', '');
    if (serviceAreaGuide) serviceAreaGuide.hidden = false;
    flow.querySelector('[data-screen="recovery"] [data-save-for-later]').hidden = true;
  }
  function clearPending(expectedBody) {
    if (!expectedBody || state.pending === expectedBody) {
      state.pending = '';
      state.pendingNotSent = false;
      state.pendingUnknown = false;
      state.pendingConflict = false;
      acknowledgedToken = '';
    }
    // A late acknowledgement may clear only its own retained operation.
    [PENDING_KEY, LEGACY_PENDING_KEY].forEach(function (key) {
      try { if (!expectedBody || sessionStorage.getItem(key) === expectedBody) sessionStorage.removeItem(key); } catch (_) {}
    });
    try {
      if (!expectedBody) sessionStorage.removeItem(CONTINUATION_KEY);
      else {
        var continuation = JSON.parse(sessionStorage.getItem(CONTINUATION_KEY) || 'null');
        if (continuation && continuation.nonce === JSON.parse(expectedBody).intakeNonce) sessionStorage.removeItem(CONTINUATION_KEY);
      }
    } catch (_) {}
  }
  function pendingBelongsToCurrent(pending) {
    if (!pending || !pending.body || !state.token) return false;
    try { return JSON.parse(pending.body).existingToken === state.token || matchingContinuation(pending); }
    catch (_) { return false; }
  }
  function holdEarlierPending(pending) {
    ++protectedReadGeneration; ++intakeAttemptGeneration;
    state.verified = false;
    state.pendingConflict = true;
    state.busy = false;
    if (pending && pending.conflict) {
      recovery('Earlier requests need a check.', 'This tab has more than one unfinished request. Use their saved links or contact Backup Power Pro before saving another request.', null, false);
      return;
    }
    function openEarlierRequest() {
      // Reopen its exact retained body without another saved request's authority.
      WALK.setToken('');
      try {
        if (sessionStorage.getItem('bpp:qwv2:bearer')) throw new Error('different_saved_link_retained');
      } catch (_) {
        recovery('This tab could not open your earlier request.', 'This browser could not confirm that the other saved link was cleared. Your earlier request is still here. Keep this page open and try again, or call Backup Power Pro for help.', openEarlierRequest, false);
        retryButton.textContent = 'Try clearing the saved link';
        return;
      }
      location.replace('/walk-v2/');
    }
    recovery(pending && pending.expired ? 'An earlier request could not be recovered.' : 'An earlier request needs a check.', pending && pending.expired ? 'Use the saved link for your earlier request or contact Backup Power Pro. Review its recovery before starting another request.' : 'Check whether your earlier details saved before changing another request. We will check that same earlier request.', openEarlierRequest, false);
    retryButton.textContent = pending && (pending.expired || pending.conflict) ? 'Review earlier request recovery' : 'Check earlier request';
  }
  function recoverPendingStorage() {
    ++protectedReadGeneration; ++intakeAttemptGeneration;
    state.verified = false;
    state.pendingUnknown = true; state.busy = false;
    recovery('Your request needs a connection check.', 'This browser could not check for an earlier request. Keep this page open and try again before saving another request.', function () {
      if (state.pending) retryIntake(); else if (state.token) loadProtected(); else recoverPendingRead();
    }, false);
  }
  function checkProtectedPending() {
    var pending = readPending();
    if (pending && pending.unavailable) { recoverPendingStorage(); return false; }
    if (pending && (!pending.body || !pendingBelongsToCurrent(pending))) { holdEarlierPending(pending); return false; }
    state.pendingUnknown = false; state.pendingConflict = false;
    if (pending && pending.body) { state.pending = pending.body; retryIntake(); return false; }
    return true;
  }
  function readRetainedPending() {
    try {
      var primary = sessionStorage.getItem(PENDING_KEY) || '';
      var legacy = sessionStorage.getItem(LEGACY_PENDING_KEY) || '';
      if (primary && legacy && primary !== legacy) return { conflict: true };
      var body = primary || legacy;
      return body ? { body: body } : null;
    } catch (_) { return { unavailable: true }; }
  }
  function claimPendingBody(body) {
    var stored = readPending();
    if (stored && stored.unavailable) { recoverPendingStorage(); return false; }
    if (stored && (!stored.body || stored.body !== body)) { holdEarlierPending(stored); return false; }
    return true;
  }
  function matchingContinuation(pending) {
    if (!pending || !pending.body || !state.token) return false;
    try {
      var original = JSON.parse(pending.body);
      if (!original.estimatePreviewHash || original.existingToken) return false;
      if (pending.body === state.pending && acknowledgedToken === state.token) return true;
      var saved = JSON.parse(sessionStorage.getItem(CONTINUATION_KEY) || 'null');
      return Boolean(saved && saved.token === state.token && saved.nonce === original.intakeNonce && original.estimatePreviewHash && !original.existingToken);
    } catch (_) { return acknowledgedToken === state.token && Boolean(state.pending); }
  }
  function readPending(memoryBody) {
    var body = memoryBody || '';
    if (!body) {
      var retained = readRetainedPending();
      if (!retained || !retained.body) return retained;
      body = retained.body;
    }
    if (!body) return null;
    try {
      var payload = JSON.parse(body);
      if (payload.source !== 'walkv2-landing' || !UUID.test(payload.intakeNonce || '') || !UUID.test(String(payload.eventId || '').replace(/^wv2-/, ''))) return { expired: true };
      var date = Date.parse(payload.submittedAt);
      if (!Number.isFinite(date) || Date.now() - date > MAX_REPLAY_AGE || date > Date.now() + 60000) return { expired: true };
      return { body: body };
    } catch (_) { return { expired: true }; }
  }
  function recoverPendingRead() {
    var pending = readPending();
    if (pending && pending.conflict) { holdEarlierPending(pending); return; }
    if (pending && pending.unavailable) { recoverPendingStorage(); return; }
    state.pendingUnknown = false;
    if (pending && pending.body) {
      if (state.token && !pendingBelongsToCurrent(pending)) { holdEarlierPending(pending); return; }
      state.pending = pending.body; retryIntake(); return;
    }
    clearPending();
    recovery("We couldn't recover this submission.", 'Use a saved Quote Walk link if you have one, or contact Backup Power Pro before starting again.', null, true);
  }
  function contactActive() {
    return state.screen === 'contact' && !flow.hidden && !flow.querySelector('[data-screen="contact"]').hidden && !contactCard.hidden;
  }
  function contact() {
    // The minimal contact card has no redundant helper paragraph. Older
    // retained shells may still provide one for their existing entry paths.
    var contactHelper = flow.querySelector('[data-screen="contact"] .helper');
    var communicationChoices = flow.querySelector('[data-communication-choices]');
    if (communicationChoices) communicationChoices.hidden = Boolean(state.token);
    // Only the new guided intake has a durable guide-choice adapter. Retained
    // contact-first requests keep their existing quote/text controls and path.
    var guideOfferLabel = guideOffer && guideOffer.closest('label');
    if (guideOfferLabel) guideOfferLabel.hidden = Boolean(state.token) || contactFirstAnonymous();
    var promotionsLabel = promotionsOffer && promotionsOffer.closest('label');
    if (promotionsLabel) promotionsLabel.hidden = Boolean(state.token) || contactFirstAnonymous();
    // The first-photo example belongs to new estimate requests, not saved edits.
    if (panelExample) {
      if (panelExampleImage.complete && panelExampleImage.naturalWidth === 0) panelExample.dataset.unavailable = 'true';
      panelExample.hidden = Boolean(state.token) || contactFirstAnonymous() || panelExample.dataset.unavailable === 'true';
    }
    if (state.token) {
      flow.querySelector('#contact-heading').textContent = 'Your contact details';
      if (contactHelper) contactHelper.textContent = 'Update the details for your saved request.';
    }
    if (mountedContact) { mountedContact.setAuthority(state.token); return; }
    if (contactFirstAnonymous()) {
      flow.querySelector('#contact-heading').textContent = "Let's start with a few details.";
      if (contactHelper) contactHelper.textContent = 'Add your details, then answer a few questions about your generator and home.';
    }
    mountedContact = BPPContactDetails.mount(flow.querySelector('[data-screen="contact"]'), {
      requireEmail: true,
      entryURL: entryURL.href,
      token: state.token,
      submitLabel: state.token ? 'Save my details' : contactFirstAnonymous() ? 'Continue' : 'Send my quote request',
      canSubmit: function () { return contactActive() && !state.pendingUnknown && !state.pendingConflict && !state.pending && !state.busy && (state.token ? state.verified : eligible() && (contactFirstAnonymous() || Boolean(estimatePreview && previewDraft === JSON.stringify(draft()) && initialSubmissionAllowed()))); },
      walkDraft: state.token || contactFirstAnonymous() ? null : draft,
      estimatePreview: contactFirstAnonymous() ? null : function () { return estimatePreview && estimatePreview.preview_hash; },
      onBusy: function (busy) { state.busy = busy; refreshChoices(); refreshInitialGate(); },
      onSubmit: submitContact
    });
  }
  async function submitContact(payload) {
    if (!contactActive()) return;
    if (state.pendingConflict) { holdEarlierPending(); return; }
    if (state.pending) return retryIntake();
    if (!claimPendingBody(JSON.stringify(payload))) return;
    if (!state.token && !eligible()) { show('connection'); return; }
    if (!state.token && !contactFirstAnonymous()) {
      if (!initialSubmissionAllowed()) { refreshInitialGate(); return; }
      var photo = initialPhoto.receipt();
      payload.initialPanelPhoto = { stageToken: photo.stageToken, photoId: photo.photoId, stageRevision: photo.stageRevision };
      if (Array.isArray(photo.photoIds)) payload.initialPanelPhoto.photoCount = photo.photoIds.length;
      payload.photoChoice = 'initial_panel_photo';
      initialPhoto.lock(true);
    }
    state.pending = JSON.stringify(payload);
    if (!payload.existingToken && window.BPPPowerGuideChoice && guideOffer && quoteSmsChoice) {
      if (payload.powerGuideChoice && typeof payload.powerGuideChoice.guideAndNewsletter === 'boolean') {
        BPPPowerGuideChoice.draft(payload.powerGuideChoice.guideAndNewsletter, payload.smsConsent === 'true');
      }
      // Legacy-compatible capture also owns its temporary SMS choice, without adding guide enrollment.
      BPPPowerGuideChoice.bindRequest(payload.intakeNonce);
    }
    if (!payload.existingToken && payload.emailPromotionsChoice && window.BPPEmailPromotionsChoice && promotionsOffer && quoteSmsChoice) {
      BPPEmailPromotionsChoice.draft(payload.emailPromotionsChoice.promotions, payload.smsConsent === 'true');
      BPPEmailPromotionsChoice.bindRequest(payload.intakeNonce);
    }
    state.pendingNotSent = true;
    return retryIntake();
  }
  async function retryIntake() {
    if (!state.pending) return;
    var body = state.pending;
    prepareInlinePending(JSON.parse(body));
    if (state.token && !pendingBelongsToCurrent({ body: body })) { holdEarlierPending({ body: body }); return; }
    if (!claimPendingBody(body)) return;
    var attempt = ++intakeAttemptGeneration;
    var replayToken = state.token;
    function currentAttempt(allowCleared) {
      if (attempt !== intakeAttemptGeneration || state.pendingConflict || replayToken !== state.token
          || (!allowCleared && state.pending !== body)) return false;
      // The server owns an in-flight result; retain exact-byte authority across the local replay deadline.
      var retained = readRetainedPending();
      if (retained && retained.unavailable) { recoverPendingStorage(); return false; }
      if (retained && (!retained.body || retained.body !== body)) { holdEarlierPending(retained); return false; }
      if (!allowCleared && !retained) { holdEarlierPending({ expired: true }); return false; }
      return true;
    }
    state.pendingConflict = false;
    // Every transmission requires exact retained recovery authority, including retries.
    var retained = false;
    try {
      sessionStorage.setItem(PENDING_KEY, body);
      retained = sessionStorage.getItem(PENDING_KEY) === body;
    } catch (_) {}
    if (!retained) {
      state.busy = false;
      recovery(state.pendingNotSent ? 'Your request has not been sent.' : 'Your request needs a connection check.',
        state.pendingNotSent ? 'This browser could not keep your request for a safe retry. Keep this page open and try again.' : 'Your details may already be saved. This browser could not keep the same request for a safe retry. Keep this page open and try again.',
        retryIntake, false);
      return;
    }
    state.busy = true;
    state.pendingNotSent = false;
    recovery('Saving your request...', 'Keep this page open while we save your details.', null, false);
    if (!inlineEstimate && JSON.parse(body).walkDraft && window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.show('saving');
    var response;
    try { response = await WALK.submitLeadBody(body); }
    catch (_) { response = null; }
    if (!currentAttempt(false)) return;
    state.busy = false;
    var result = response && response.body || {};
    var token = String(result.preReadToken || '');
    var original = JSON.parse(body);
    if (response && response.ok && TOKEN.test(token)) {
      if (original.serviceAreaPolicy === 'bpp-seven-counties-2026-11-11-v1' && result.service_area_policy !== original.serviceAreaPolicy) {
        recovery('Your request needs a connection check.', 'Your details may already be saved. Keep this page open and try again to check this same request before continuing.', retryIntake, false);
        return;
      }
      if (original.emailPromotionsChoice && (result.emailPromotionsChoiceRecorded !== true
          || !result.emailPromotionsChoice || result.emailPromotionsChoice.version !== original.emailPromotionsChoice.version
          || result.emailPromotionsChoice.promotions !== original.emailPromotionsChoice.promotions
          || result.emailPromotionsChoice.dispatch_enabled !== false)) {
        recovery('Your request needs a connection check.', 'Your details may already be saved. Keep this page open and try again to check this same request before continuing.', retryIntake, false);
        return;
      }
      var expectedPhotos = original.initialPanelPhoto;
      var collectionAcknowledged = !expectedPhotos || expectedPhotos.photoCount === undefined || (
        Array.isArray(result.initialPanelPhotoIds) && Array.isArray(result.initialPanelPhotoMediaIds)
        && result.initialPanelPhotoIds.length === expectedPhotos.photoCount
        && result.initialPanelPhotoMediaIds.length === expectedPhotos.photoCount
        && result.initialPanelPhotoIds.every(function (id) { return UUID.test(id || ''); })
        && result.initialPanelPhotoMediaIds.every(function (id) { return UUID.test(id || ''); })
        && new Set(result.initialPanelPhotoIds).size === expectedPhotos.photoCount
        && new Set(result.initialPanelPhotoMediaIds).size === expectedPhotos.photoCount
        && result.initialPanelPhotoIds[0] === expectedPhotos.photoId
        && result.initialPanelPhotoMediaIds[0] === result.initialPanelPhotoMediaId
        && result.initialPanelPhotoStageRevision === expectedPhotos.stageRevision
      );
      if (original.walkDraft && (result.intakeContract !== CONTRACT || expectedPhotos && (result.initialPanelPhotoSaved !== true || result.initialPanelPhotoId !== expectedPhotos.photoId || !UUID.test(result.initialPanelPhotoMediaId || '') || !collectionAcknowledged))) {
        recovery('Your request needs a connection check.', 'Your details may already be saved. Please use your saved link or contact Backup Power Pro for help.', function () { return retryIntake(); }, false);
        return;
      }
      if (original.initialPanelPhoto) initialPhoto.consume();
      state.token = token; replayToken = token;
      clearUnsent();
      if (original.estimatePreviewHash) {
        acknowledgedToken = token;
        try { sessionStorage.setItem(CONTINUATION_KEY, JSON.stringify({ token: token, nonce: original.intakeNonce })); } catch (_) {}
      }
      WALK.setToken(token);
      state.freshLegacy = !original.walkDraft && !original.existingToken && result.intakeContract !== CONTRACT;
      if (state.freshLegacy) WALK.markNewJourney(token);
      if (result.intakeContract === CONTRACT) WALK.rememberJourneyState(token, { quote_walk_v2: { intake_contract: CONTRACT, version: result.quoteWalkV2Version } });
      if (!original.estimatePreviewHash) clearPending(body);
      if (original.existingToken) entryURL.searchParams.delete('edit');
      if (typeof result.ownerTest === 'boolean') {
        // Server classification survives an unavailable optional analytics hook.
        window.__BPP_OWNER_TEST = result.ownerTest;
        try {
          if (result.ownerTest) sessionStorage.setItem('bpp:owner-test', '1');
          else sessionStorage.removeItem('bpp:owner-test');
        } catch (_) {}
        try {
          if (typeof window.BPPAnalytics?.setOwnerTestMode === 'function') BPPAnalytics.setOwnerTestMode(result.ownerTest);
        } catch (_) {}
      }
      // Tracking cannot interrupt acceptance of the saved customer request.
      try {
        var meta = result.metaLeadEvent;
        if (meta && meta.eligible === true && window.BPPMeta) {
          if (typeof BPPMeta.authorizeVerifiedOwnerReceipt === 'function') BPPMeta.authorizeVerifiedOwnerReceipt(meta, result.ownerTest, token);
          if (meta.eventName === 'QuoteWalkStarted') BPPMeta.trackQuoteWalkStarted(meta.eventId);
          else if (meta.eventName === 'Lead') BPPMeta.trackLead(meta.eventId);
        }
      } catch (_) {}
      if (Number.isSafeInteger(result.quoteWalkV2Version) && result.quoteWalkV2Version > 0 && result.service_area_pending_review === true && result.service_area_policy === 'bpp-seven-counties-2026-11-11-v1' && result.service_area_status === 'unconfirmed') {
        clearPending(body);
        state.view = { contact_name: [original.firstName, original.lastName].filter(Boolean).join(' '), phone: original.phone, email: original.email, address: original.address,
          quote_walk_v2: { version: result.quoteWalkV2Version, intake_contract: result.intakeContract || CONTRACT, service_area_status: 'unconfirmed', service_area_policy: result.service_area_policy, service_area_pending_review: true } };
        WALK.rememberJourneyState(token, state.view);
        serviceAreaReview(state.view); return;
      }
      if (original.estimatePreviewHash && original.walkDraft && !original.existingToken && result.intakeContract === CONTRACT) {
        if (!Number.isSafeInteger(result.quoteWalkV2Version) || result.quoteWalkV2Version < 1 || result.service_area_status === 'verified_out_of_area') {
          clearPending(body); await loadProtected(); return;
        }
        try {
          var acceptance = await WALK.acceptPreview(token, result.quoteWalkV2Version, 'preview-submit:' + original.intakeNonce, original.estimatePreviewHash);
          if (!currentAttempt(false)) return;
          if (!acceptance || acceptance.ok !== true || acceptance.intake_contract !== CONTRACT
              || acceptance.preview_hash !== original.estimatePreviewHash || !acceptance.snapshot_id
              || acceptance.accepted_range_snapshot_id !== acceptance.snapshot_id
              || acceptance.handoff_recorded !== true) throw new Error('acceptance_not_confirmed');
          if (original.powerGuideChoice && window.BPPPowerGuideChoice) BPPPowerGuideChoice.bindReceipt(original.intakeNonce, acceptance.acceptance_id);
          // Tracking follows the validated acceptance and cannot block next steps.
          try {
            var acceptedMeta = acceptance.metaLeadEvent;
            if (acceptedMeta && acceptedMeta.eligible === true && acceptedMeta.eventName === 'Lead' && window.BPPMeta) {
              if (typeof BPPMeta.authorizeVerifiedOwnerReceipt === 'function') BPPMeta.authorizeVerifiedOwnerReceipt(acceptedMeta, result.ownerTest, token);
              BPPMeta.trackLead(acceptedMeta.eventId);
            }
          } catch (_) {}
          if (photoFirstOperation(original)) {
            inlineExpected = { snapshotId: acceptance.snapshot_id, mediaId: result.initialPanelPhotoMediaId,
              signature: estimatePreview ? BPPEstimateTerminal.signature(estimatePreview) : '' };
            clearPending(body);
            entryURL.searchParams.set('estimate', 'received');
            history.replaceState({ qwg: instance, screen: 'confirmation' }, '', entryURL.pathname + entryURL.search);
            await loadProtected(); return;
          }
          clearPending(body); WALK.go('photos-later.html', token, null, true); return;
        } catch (error) {
          if (!currentAttempt(false)) return;
          if (error && error.body && ['range_preview_changed', 'readiness_incomplete', 'stale_journey_version', 'range_not_current'].indexOf(error.body.error) !== -1) {
            clearPending(body); WALK.go('range.html', token, null, true); return;
          }
          recovery('Your details are saved.', 'The next step could not open. Try again to continue this same request.', retryIntake, false);
          return;
        }
      }
      // The range bootstrap verifies the current server state and all route guards.
      // Server range creation owns readiness, including pending service-area review.
      if (original.walkDraft && !original.existingToken && result.intakeContract === CONTRACT && Number.isSafeInteger(result.quoteWalkV2Version) && result.quoteWalkV2Version > 0 && ['verified_in_area', 'unconfirmed'].indexOf(result.service_area_status) !== -1) {
        // Create from the committed intake version before the one fresh range read.
        // Uncertain creation is reconciled by that read and its existing retry path.
        if (Number.isSafeInteger(result.quoteWalkV2Version) && result.quoteWalkV2Version > 0) {
          state.busy = true;
          try { await WALK.stateAction(token, 'create_range', { revision_reason: 'initial' }); }
          catch (_) { /* The saved intake remains valid when range creation is uncertain. */ }
          finally { if (attempt === intakeAttemptGeneration) state.busy = false; }
          if (!currentAttempt(true)) return;
        }
        WALK.go('range.html', token, null, true); return;
      }
      await loadProtected();
      return;
    }
    if (response && response.status === 422 && result.error === 'outside_service_area') {
      clearPending(body);
      if (initialPhoto) initialPhoto.lock(false);
      outsideServiceArea({ contact_name: [original.firstName, original.lastName].filter(Boolean).join(' '), phone: original.phone, email: original.email, address: original.address });
      return;
    }
    if (response && (response.status === 400 || response.status === 422) && result.error !== 'intake_replay_payload_mismatch') {
      clearPending(body);
      state.busy = false;
      if (!state.token) { inlineEstimate = false; ++inlinePreviewGeneration; }
      if (original.walkDraft) hydrate({ quote_walk_v2: original.walkDraft });
      if (initialPhoto) initialPhoto.lock(false);
      contact();
      mountedContact.hydrate({ contact_name: [original.firstName, original.lastName].filter(Boolean).join(' '), phone: original.phone, email: original.email, address: original.address, service_area_status: 'unconfirmed' });
      show('contact', { replace: true });
      if (original.initialPanelPhoto && ['initial_photo_required', 'initial_photo_unverified', 'range_preview_changed'].indexOf(result.error) !== -1) {
        acceptedInitialRange = '';
        if (result.error === 'range_preview_changed') loadEstimate(true);
        // The server checks the complete collection. Refresh its authoritative
        // list instead of blaming a valid first photo for another item's failure.
        else initialPhoto.refresh();
        refreshInitialGate();
        var photoHeading = initialPhotoRoot.querySelector('h2, h3');
        if (photoHeading) { photoHeading.tabIndex = -1; photoHeading.focus({ preventScroll: true }); }
        return;
      }
      mountedContact.showError(result.field === 'email' ? 'Enter an email like you@example.com.' : 'Your details did not save. Please check them and try again.', ['name', 'phone', 'email', 'address'].indexOf(result.field) !== -1 ? result.field : null);
      return;
    }
    var expired = response && (response.status === 410 || result.error === 'intake_retry_expired' || result.error === 'intake_payload_conflict');
    if (expired) {
      clearPending(body);
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
  async function loadProtected(options) {
    options = options || {};
    if (state.token && !checkProtectedPending()) return;
    if (inlineEstimate) inlineEditing = false;
    var readGeneration = ++protectedReadGeneration;
    var currentToken = state.token;
    var detailsDraft = options.preserveDetailsDraft && state.editing ? {
      outlets: state.outlets.slice(), room: state.room, distance: state.distance,
      version: detailsSetupVersion, screen: state.screen
    } : null;
    state.verified = false;
    var preparingEstimate = window.BPPQuoteWalkEstimateLoading && BPPQuoteWalkEstimateLoading.isActive();
    recovery('Loading your saved request...', '', null, false);
    if (preparingEstimate) BPPQuoteWalkEstimateLoading.show();
    try {
      var view = await WALK.view(currentToken);
      if (readGeneration !== protectedReadGeneration || currentToken !== state.token || state.pendingConflict || state.pendingUnknown) return;
      state.view = view;
      state.verified = true;
      if (!detailsDraft) hydrate(view);
      var params = new URLSearchParams(entryURL.search);
      var edit = params.get('edit');
      // A URL hint cannot select the new presentation for an older saved flow.
      if (inlineEstimate && !inlineExpected && (!WALK.isGuidedJourney(view, state.token)
          || (view.quote_walk_v2 || {}).initial_panel_photo_saved !== true
          || !UUID.test((view.quote_walk_v2 || {}).initial_panel_photo_media_id || ''))) {
        inlineEstimate = false; entryURL.searchParams.delete('estimate');
      }
      if (WALK.isGuidedJourney(view, state.token)) {
        var destination = WALK.guidedDestination(state.token, view);
        if (destination.reason === 'deeper' || (destination.reason === 'correction' && edit !== 'details')) { WALK.routeFromState(state.token, view, true); return; }
      }
      if (detailsDraft) {
        state.outlets = detailsDraft.outlets; state.room = detailsDraft.room; state.distance = detailsDraft.distance;
        if (!Number.isSafeInteger(detailsDraft.version) || detailsDraft.version !== (view.quote_walk_v2 || {}).version) {
          state.verified = false;
          recovery('Your saved request has changed.', 'Your unsaved setup answers are still here. Load the current saved answers before continuing; this replaces your unsaved setup changes.', reloadCurrentSetup, false);
          retryButton.textContent = 'Load current saved answers';
        } else show(['connection', 'location', 'distance'].indexOf(detailsDraft.screen) !== -1 ? detailsDraft.screen : 'distance', { replace: true });
        return;
      }
      if (edit === 'details') {
        if (inlineEstimate) { editInlineDetails(); return; }
        contact(); mountedContact.hydrate(view);
        show('contact', { replace: true });
        return;
      }
      if ((view.quote_walk_v2 || {}).service_area_status === 'verified_out_of_area' || view.service_area_status === 'verified_out_of_area') {
        outsideServiceArea(view);
        return;
      }
      if ((view.quote_walk_v2 || {}).service_area_pending_review === true) { serviceAreaReview(view); return; }
      if (inlineEstimate && !edit) { await showInlineConfirmation(view); return; }
      if (WALK.isGuidedJourney(view, state.token) && ['connection', 'location', 'distance', 'outlet', 'panel', 'setup'].indexOf(edit) !== -1) {
        state.editing = true;
        // Every setup editor binds its unsaved draft to this protected version.
        // The details-return flag remains exclusive to the contact Back path.
        detailsSetupOriginal = JSON.stringify(draft());
        detailsSetupVersion = (view.quote_walk_v2 || {}).version;
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
      if (readGeneration !== protectedReadGeneration || currentToken !== state.token || state.pendingConflict || state.pendingUnknown) return;
      state.verified = false;
      var permanent = ['expired', 'missing'].indexOf(WALK.classifyRecoveryError(error)) !== -1;
      recovery(permanent ? "We couldn't open this saved request." : 'Your saved request could not load.', permanent ? 'Use your saved Quote Walk link, or start a new Quote Walk.' : 'Try again to open your saved answers.', permanent ? null : function () { loadProtected(options); }, permanent);
    }
  }
  function reloadCurrentSetup() {
    detailsSetupEditing = false; detailsSetupVersion = null; state.editing = false;
    return loadProtected();
  }
  async function saveAnswers() {
    if (state.busy || state.pendingConflict || state.pendingUnknown) return;
    if (!state.verified) {
      if (state.token) {
        recovery('Check your current saved answers.', 'Your unsaved setup answers are still here. Load the current saved answers before saving; this replaces your unsaved setup changes.', reloadCurrentSetup, false);
        retryButton.textContent = 'Load current saved answers';
      }
      return;
    }
    if (!checkProtectedPending()) return;
    var readGeneration = ++protectedReadGeneration;
    var currentToken = state.token;
    state.busy = true; refreshChoices();
    if (eligible() && window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.show();
    try {
      await WALK.stateAction(currentToken, 'save_guided_answers', { walkDraft: draft() }, { expectedVersion: detailsSetupEditing ? detailsSetupVersion : state.view && (state.view.quote_walk_v2 || {}).version });
      if (readGeneration !== protectedReadGeneration || currentToken !== state.token || state.pendingConflict || state.pendingUnknown) { state.busy = false; return; }
      var view = await WALK.view(currentToken);
      if (readGeneration !== protectedReadGeneration || currentToken !== state.token || state.pendingConflict || state.pendingUnknown) { state.busy = false; return; }
      state.view = view;
      state.editing = false;
      if (detailsSetupEditing) {
        detailsSetupEditing = false; detailsSetupVersion = null; state.busy = false; state.verified = true;
        hydrate(view); contact(); mountedContact.hydrate(view);
        show('contact', { replace: true });
        return;
      }
      WALK.routeFromState(state.token, view, true);
    } catch (error) {
      state.busy = false;
      if (readGeneration !== protectedReadGeneration || currentToken !== state.token || state.pendingConflict || state.pendingUnknown) return;
      if (error && error.code === 'stale_customer_authorization') {
        state.verified = false;
        recovery('Your saved request has changed.', 'Load the current answers before making another change. This replaces your unsaved setup changes.', reloadCurrentSetup, false);
        retryButton.textContent = 'Load current saved answers';
      } else recovery('Your setup answers did not save.', 'Your selected answers are still here. Try again.', saveAnswers, false);
    }
  }
  function help(kind, trigger, options) {
    options = options || {};
    helpOrigin = options.origin || state.screen;
    helpKind = kind;
    helpTrigger = trigger || null;
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
      panel: ['Common places to look', "Check the garage, basement, outside wall, closet or utility area. This illustration is an identification example. Keep your electrical panel closed. Don't open electrical equipment or remove covers. If you cannot identify it safely, save this link and return when you can confirm the panel. We need its location to prepare your online estimate.", 'Back to panel choices'],
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
      var example = document.createElement('figure'); example.className = 'guided-outlet-reference';
      var image = document.createElement('img'); image.addEventListener('error', function () { example.hidden = true; }); image.src = '/walk-v2/closed-panel-example.jpg'; image.alt = 'Illustration of a closed electrical panel on a plain wall'; image.width = image.height = 900; image.decoding = 'async';
      var caption = document.createElement('figcaption'); caption.textContent = 'Example illustration: keep the whole panel closed.';
      example.appendChild(image); example.appendChild(caption); examples.appendChild(example);
    }
    show('help', { noHistory: options.noHistory === true });
  }
  flow.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button || button.disabled || button.closest('[hidden]') || state.busy || state.pending) return;
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
      if (inlineEstimate && state.token) { entryURL.searchParams.delete('edit'); inlineEditing = false; loadProtected(); return; }
      if (state.token && !state.editing && state.screen === 'contact') {
        // Back deliberately enters the saved-answer editor; Continue saves its changes.
        state.editing = true; detailsSetupEditing = true;
        detailsSetupOriginal = JSON.stringify(draft());
        detailsSetupVersion = state.view && (state.view.quote_walk_v2 || {}).version;
      }
      var index = screens.indexOf(state.screen);
      if (index > 0) show(screens[index - 1]);
      else if (state.token) WALK.routeFromState(state.token, state.view);
      else if (landing && !state.protectedEntry) show('landing');
    } else if (button.hasAttribute('data-help-return')) {
      show(helpOrigin);
      if (helpTrigger && !helpTrigger.closest('[hidden]')) helpTrigger.focus();
    }
  });
  retryButton.addEventListener('click', function () { if (retry && !state.busy) retry(); });
  newButton.addEventListener('click', function () {
    ++protectedReadGeneration; ++intakeAttemptGeneration;
    acceptedInitialRange = ''; inlineEstimate = false; inlineEditing = false; ++inlinePreviewGeneration;
    detailsSetupEditing = false; detailsSetupVersion = null;
    if (initialPhoto) initialPhoto.discardLocal();
    if (window.BPPPowerGuideChoice) BPPPowerGuideChoice.clear();
    if (window.BPPEmailPromotionsChoice) BPPEmailPromotionsChoice.clear();
    clearUnsent();
    clearPending(); WALK.setToken(''); state.token = ''; state.view = null; state.verified = false;
    updateEstimateHeading();
    entryURL.search = ''; state.outlets = []; state.room = ''; state.distance = null;
    // A failed or ignored storage removal must not import old authority after navigation.
    try {
      if ([UNSENT_KEY, PENDING_KEY, LEGACY_PENDING_KEY, CONTINUATION_KEY, 'bpp:qwv2:bearer', 'bpp_initial_panel_photo_v1', 'bpp:qwv2:power-guide-choice', 'bpp:qwv2:email-promotions-choice'].some(function (key) { return Boolean(sessionStorage.getItem(key)); })) throw new Error('earlier_work_retained');
    } catch (_) {
      state.pendingUnknown = true;
      recovery('Your earlier work could not be cleared.', 'This browser could not confirm a fresh start. Keep this page open and try again, or call Backup Power Pro for help.', null, true);
      newButton.textContent = 'Try clearing earlier work';
      return;
    }
    // A full navigation discards any previously authorized form instance.
    location.replace('/walk-v2/');
  });
  flow.addEventListener('input', function (event) { if (event.target.matches('[data-f="name"], [data-f="phone"], [data-f="email"], [data-f="addr"]')) rememberUnsent(true); });
  flow.addEventListener('change', function (event) { if (event.target.matches('[data-f="name"], [data-f="phone"], [data-f="email"], [data-f="addr"]')) rememberUnsent(true); });
  flow.addEventListener('change', function (event) {
    if (!state.token && !state.pending && !state.busy && window.BPPPowerGuideChoice && guideOffer && quoteSmsChoice
        && event.target.matches('[data-power-guide-offer], [data-quote-sms-consent]')) BPPPowerGuideChoice.draft(guideOffer.checked, quoteSmsChoice.checked);
    if (!state.token && !state.pending && !state.busy && window.BPPEmailPromotionsChoice && promotionsOffer && quoteSmsChoice
        && event.target.matches('[data-email-promotions-offer], [data-quote-sms-consent]')) BPPEmailPromotionsChoice.draft(promotionsOffer.checked, quoteSmsChoice.checked);
  });
  flow.addEventListener('click', function (event) {
    var control = event.target.closest('button');
    // Record the interaction before its handler disables or hides the control.
    if (control && !control.hasAttribute('data-recovery-new') && !control.disabled && !control.closest('[hidden]') && !state.busy && !state.pending) rememberUnsent(true);
  }, true);
  flow.addEventListener('click', function (event) {
    var control = event.target.closest('button');
    if (control && !control.hasAttribute('data-recovery-new') && !state.busy && !state.pending) rememberUnsent(false);
  });
  window.addEventListener('popstate', function (event) {
    if (state.pendingConflict) { holdEarlierPending(); return; }
    if (state.pendingUnknown && !state.token) { recoverPendingRead(); return; }
    if (state.pending) {
      recovery(state.pendingNotSent ? 'Your request has not been sent.' : "We're checking whether your details saved.",
        state.pendingNotSent ? 'Keep this page open and try again to send this same request.' : 'Check this request before starting another.', retryIntake, false);
      return;
    }
    if (inlineEstimate && state.token) { entryURL.searchParams.delete('edit'); inlineEditing = false; loadProtected(); return; }
    if (state.token && !state.editing) { loadProtected(); return; }
    if (event.state && event.state.qwg === instance && event.state.screen === 'help'
        && ['outlet', 'mismatch', 'no-generator', 'panel', 'distance'].indexOf(event.state.helpKind) !== -1
        && screens.indexOf(event.state.helpOrigin) !== -1) {
      help(event.state.helpKind, null, { origin: event.state.helpOrigin, noHistory: true });
    }
    else if (event.state && event.state.qwg === instance && screens.indexOf(event.state.screen) !== -1) show(event.state.screen, { noHistory: true });
    else if (!state.token) show(landing && !state.protectedEntry ? 'landing' : 'connection', { noHistory: true });
  });
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    updateEstimateHeading();
    var token = WALK.token();
    var preserveDetailsDraft = Boolean(token && token === state.token && state.editing && detailsSetupOriginal !== JSON.stringify(draft()));
    var pending = readPending();
    if (token) state.token = token;
    if (pending && pending.unavailable) { recoverPendingStorage(); return; }
    if (pending && pending.conflict) { holdEarlierPending(pending); return; }
    if (token && pending && !pendingBelongsToCurrent(pending)) { holdEarlierPending(pending); return; }
    if (pendingBelongsToCurrent(pending)) { state.pending = pending.body; retryIntake(); }
    else if (token) {
      state.token = token;
      if (!preserveDetailsDraft) { state.editing = false; detailsSetupEditing = false; detailsSetupVersion = null; }
      loadProtected({ preserveDetailsDraft: preserveDetailsDraft });
    }
    else if (pending && pending.body) { state.pending = pending.body; retryIntake(); }
    else if (pending && pending.unavailable) recoverPendingRead();
    else if (pending && pending.conflict) holdEarlierPending(pending);
    else if (pending && pending.expired) { clearPending(); recovery("We couldn't recover this submission.", 'Use a saved Quote Walk link if you have one, or contact Backup Power Pro before starting again.', null, true); }
  });
  var protectedPending = state.token ? readPending() : null;
  if (window.__BPP_INVALID_CAPABILITY_ENTRY) {
    recovery("We couldn't open this saved request.", 'Use a valid saved Quote Walk link, or start a new Quote Walk.', null, true);
  } else if (state.token && protectedPending && !pendingBelongsToCurrent(protectedPending)) {
    if (protectedPending.unavailable) recoverPendingStorage(); else holdEarlierPending(protectedPending);
  } else if (state.token && protectedPending && protectedPending.body) {
    state.pending = protectedPending.body; retryIntake();
  } else if (state.token) loadProtected();
  else {
    var pending = readPending();
    if (pending && pending.conflict) holdEarlierPending(pending);
    else if (pending && pending.unavailable) recoverPendingRead();
    else if (pending && pending.expired) { clearPending(); recovery("We couldn't recover this submission.", 'Use a saved Quote Walk link if you have one, or contact Backup Power Pro before starting again.', null, true); }
    else if (pending && pending.body) { state.pending = pending.body; retryIntake(); }
    else if (!restoreUnsent(readUnsent())) show(landing && !state.protectedEntry ? 'landing' : 'connection', { replace: true, noFocus: true });
  }
  if (typeof window.BPPQuoteWalkMarkReady === 'function') window.BPPQuoteWalkMarkReady();
  // Startup recovery was routed while the boot overlay still hid its heading.
  if (!recoveryPanel.hidden && recoveryHeading.getClientRects().length) revealHeading(recoveryHeading);
})();
