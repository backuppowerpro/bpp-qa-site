/* Shared shell for server-owned guided journeys. Existing contracts retain their controllers. */
(function () {
  'use strict';
  var START = '/walk-v2/';
  var saveMarkup = '<div class="guided-save" data-save-for-later><button type="button" data-save-button><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-3M9 14l6 3"/></svg>Save for later</button><p data-save-hint></p><p data-save-status aria-live="polite"></p></div>';
  function element(tag, text, className) { var node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
  function shell(kind) {
    document.body.classList.add('guided-walk', 'guided-saved'); document.body.dataset.activeScreen = kind;
    var stack = element('div', '', 'stack');
    var main = element('main', '', 'page'); main.id = 'guidedSavedPage'; main.dataset.screenLabel = 'Quote walk: saved request';
    main.innerHTML = '<header class="site-head"><a class="lockup" href="https://qa.backuppowerpro.com" aria-label="Backup Power Pro"><img src="/assets/images/logo-white-v2.png" alt="Backup Power Pro"></a></header><div class="guided-flow body"><div class="qw-progress"><button type="button" class="qw-back" data-saved-back aria-label="Back"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3-5 5 5 5"/></svg></button><p class="qw-position"><strong data-saved-position></strong></p></div><section class="guided-screen" data-saved-content></section><p class="guided-error" data-saved-error role="alert" hidden></p></div>';
    main.querySelector('[data-saved-position]').textContent = { range: 'Estimate', photos: 'Photos', thankyou: 'Next steps', 'photos-later': 'Next steps' }[kind] || 'Your request';
    var footer = document.querySelector('footer.foot'); if (footer) main.appendChild(footer.cloneNode(true));
    stack.appendChild(main); document.body.appendChild(stack);
    return main;
  }
  var mounted;
  window.BPPGuidedSaved = {
    saveMarkup: saveMarkup,
    element: element,
    start: function (kind, legacy) {
      var original = document.querySelector('.page') || document.getElementById('mainPage');
      var originalDisplay = original && original.style.display;
      if (original) { original.setAttribute('inert', ''); original.style.setProperty('display', 'none', 'important'); }
      var handler = kind === 'range' ? window.BPPGuidedRange : window.BPPGuidedPhotos;
      var compatibleCore = window.BPPSaveForLater && typeof BPPSaveForLater.mount === 'function'
        && handler && typeof handler.mount === 'function' && window.WALK && typeof window.__BPP_WALK_TOKEN === 'string'
        && ['isGuidedJourney', 'guidedDestination', 'rememberJourneyState'].every(function (name) { return typeof WALK[name] === 'function'; });
      var token = compatibleCore ? WALK.token() : '';
      var priorGuided = document.body.classList.contains('guided-walk');
      var priorSaved = document.body.classList.contains('guided-saved');
      var bootBusy = false;
      var boot = shell(kind);
      var loading = boot.querySelector('[data-saved-content]');
      function prepareBoot() {
        if (!boot.isConnected) {
          if (mounted) { mounted.remove(); mounted = null; }
          boot = shell(kind); loading = boot.querySelector('[data-saved-content]');
        }
        boot.querySelector('[data-saved-back]').onclick = function () { location.href = START; };
      }
      function clearBoot() { boot.closest('.stack').remove(); }
      prepareBoot();
      var status = element('p', 'Loading your saved request...'); status.setAttribute('role', 'status'); loading.appendChild(status);
      function recovery(error) {
        if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.hide();
        prepareBoot();
        var heading = element('h1', WALK.classifyRecoveryError(error) === 'temporary' ? 'Your saved request could not load. Try again.' : "We couldn't open this saved request.");
        heading.tabIndex = -1; loading.replaceChildren(heading);
        var retry = element('button', 'Try again', 'cta'); retry.type = 'button'; retry.dataset.bootRetry = ''; retry.onclick = load; loading.appendChild(retry);
        var start = element('a', 'Start a new Quote Walk', 'guided-link'); start.href = START; start.onclick = function () { WALK.setToken(''); }; loading.appendChild(start); heading.focus({ preventScroll: true });
      }
      async function load() {
        if (bootBusy) return;
        bootBusy = true;
        var retryButton = loading.querySelector('[data-boot-retry]');
        if (retryButton) retryButton.disabled = true;
        if (!compatibleCore) {
          if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.hide();
          loading.replaceChildren(element('h1', 'Your Quote Walk needs to reload before you can continue.'));
          var reload = element('button', 'Reload Quote Walk', 'cta'); reload.type = 'button';
          reload.onclick = function () {
            var target = new URL(location.href);
            // Reload must retain memory-only authority when browser storage is blocked.
            if (window.__BPP_INVALID_CAPABILITY_ENTRY) target.searchParams.set('t', 'invalid');
            else if (/^[a-zA-Z0-9_-]{32,160}$/.test(window.__BPP_WALK_TOKEN || '')) target.searchParams.set('t', window.__BPP_WALK_TOKEN);
            if (typeof window.__BPP_WALK_TOKEN !== 'string' && window.__BPP_CAPABILITY_ENTRY && !target.searchParams.has('t')) {
              reload.disabled = true; reload.textContent = 'Reopen your original saved link'; return;
            }
            location.replace(target.href);
          }; loading.appendChild(reload); reload.focus();
          bootBusy = false;
          return;
        }
        try {
          if (!token || window.__BPP_INVALID_CAPABILITY_ENTRY) { var invalid = new Error('invalid_or_expired_return'); invalid.status = 410; throw invalid; }
          var view = await WALK.view(token);
          if (!WALK.isGuidedJourney(view, token)) {
            if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.hide();
            clearBoot();
            if (!priorGuided) document.body.classList.remove('guided-walk');
            if (!priorSaved) document.body.classList.remove('guided-saved');
            if (original) { original.removeAttribute('inert'); original.style.removeProperty('display'); if (originalDisplay) original.style.display = originalDisplay; }
            legacy(); return;
          }
          clearBoot();
          if (mounted) mounted.remove();
          var main = shell(kind); mounted = main.closest('.stack');
          var ctx = {
            kind: kind, token: token, main: main, content: main.querySelector('[data-saved-content]'), view: view, busy: false,
            error: function (message) { var error = main.querySelector('[data-saved-error]'); error.textContent = message || ''; error.hidden = !message; },
            load: async function () { ctx.view = await WALK.view(token); return ctx.view; },
            state: function () { return ctx.view.quote_walk_v2 || {}; },
            review: function () { return ctx.state().photo_review || {}; },
            action: function (action, payload) { return WALK.stateAction(token, action, payload); },
            save: function (root, hint) { return BPPSaveForLater.mount(root, function () { return { mode: 'protected', verified: true, token: token, screen: kind, hint: typeof hint === 'function' ? hint() : hint }; }); },
            focus: function () { if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.hide(); var heading = ctx.content.querySelector('h1,h2'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } },
            guard: function () {
              var destination = WALK.guidedDestination(token, ctx.view);
              var editingReceivedPhotos = kind === 'photos' && new URLSearchParams(window.location.search).get('edit') === 'photos' && ctx.review().submission_current === true;
              var mustFollow = ['deeper', 'area', 'missing', 'correction', 'range'].indexOf(destination.reason) !== -1;
              if ((kind === 'thankyou' || kind === 'photos-later') && ['photos', 'submitted'].indexOf(destination.reason) !== -1) mustFollow = true;
              if (destination.reason === 'correction' && editingReceivedPhotos && destination.page === 'thankyou.html') mustFollow = false;
              if (mustFollow && destination.page !== kind + '.html') { WALK.routeFromState(token, ctx.view, true); return false; }
              return true;
            }
          };
          main.querySelector('[data-saved-back]').onclick = function () { WALK.go(kind === 'photos' || kind === 'thankyou' || kind === 'photos-later' ? 'range.html' : 'index.html', token, kind === 'range' ? { edit: 'setup' } : null); };
          if (!ctx.guard()) return;
          await handler.mount(ctx);
          WALK.ph('walk_v2_screen_view', { screen: 'guided_' + kind });
          window.addEventListener('pageshow', function (event) { if (event.persisted && ctx.reload) ctx.reload(); });
        } catch (error) {
          recovery(error);
        } finally {
          bootBusy = false;
          var retryButton = loading.querySelector('[data-boot-retry]');
          if (retryButton) retryButton.disabled = false;
        }
      }
      load();
      // This shell can now display either the saved journey or its own recovery.
      if (typeof window.BPPQuoteWalkMarkReady === 'function') window.BPPQuoteWalkMarkReady();
    }
  };
})();
