/* Saved requests reuse the same estimate and offer as anonymous entry. */
(function () {
  'use strict';
  function accepted(state) { return Boolean(state.accepted_range_snapshot_id && state.current_range_snapshot && state.accepted_range_snapshot_id === state.current_range_snapshot.snapshot_id); }
  function usable(snapshot) { return window.BPPGuidedEstimate && BPPGuidedEstimate.usable(snapshot); }
  window.BPPGuidedRange = {
    mount: async function (ctx) {
      var element = BPPGuidedSaved.element;
      var presented = '';
      function primary(label, callback, parent) { var button = element('button', label, 'cta qw-primary-action'); button.type = 'button'; button.onclick = callback; (parent || ctx.content).appendChild(button); return button; }
      function link(label, callback, parent) { var button = element('button', label, 'guided-link'); button.type = 'button'; button.onclick = callback; (parent || ctx.content).appendChild(button); return button; }
      function save(parent) { var container = element('div'); container.innerHTML = BPPGuidedSaved.saveMarkup; (parent || ctx.content).appendChild(container); ctx.save(container.querySelector('[data-save-for-later]'), parent ? function () { return 'Keep your private link to return here.'; } : undefined); }
      function failure() {
        ctx.content.replaceChildren(element('h1', 'Your details are saved, but your estimate could not load.'));
        primary('Try again', load); save(); ctx.focus();
      }
      async function request() {
        if (ctx.busy) return;
        if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.show('saving');
        if (accepted(ctx.state())) { WALK.go('photos-later.html', ctx.token, null, true); return; }
        var displayed = ctx.state().current_range_snapshot.snapshot_id;
        ctx.busy = true;
        var button = ctx.content.querySelector('[data-request-proposal]'); button.disabled = true; button.textContent = 'Saving your request...';
        try {
          var expected = typeof WALK.guidedReceiptContext === 'function' ? WALK.guidedReceiptContext(ctx.state()) : null;
          var receipt = await ctx.action('accept_range', {});
          if (typeof WALK.guidedReceiptMatches === 'function' && WALK.guidedReceiptMatches(receipt, expected)) {
            WALK.ph('walk_v2_range_accepted_lead', { event_schema_version: 1, surface_state: 'range_accepted', entry_path: 'new_intake', result: 'accepted', pricing_basis: String(ctx.state().current_range_snapshot.pricing_basis || '') });
            WALK.go('photos-later.html', ctx.token, null, true); return;
          }
          await ctx.load();
          if (accepted(ctx.state()) && ctx.state().accepted_range_snapshot_id === displayed) {
            WALK.ph('walk_v2_range_accepted_lead', { event_schema_version: 1, surface_state: 'range_accepted', entry_path: 'new_intake', result: 'accepted', pricing_basis: String(ctx.state().current_range_snapshot.pricing_basis || '') });
            WALK.routeFromState(ctx.token, ctx.view, true); return;
          }
          throw new Error('acceptance_not_confirmed');
        } catch (_) {
          button.textContent = 'Checking your saved request...';
          try {
            await ctx.load();
            if (accepted(ctx.state()) && ctx.state().accepted_range_snapshot_id === displayed) { WALK.routeFromState(ctx.token, ctx.view, true); return; }
            if (!ctx.guard()) return;
            render(); ctx.error('Your proposal request was not confirmed. Review your current estimate, then try again.');
          } catch (_) {
            ctx.content.replaceChildren(element('h1', 'Checking your saved request...'), element('p', 'Your response did not arrive. Check the saved request before trying again.'));
            primary('Check saved request', load); save(); ctx.focus();
          }
        } finally { ctx.busy = false; }
      }
      function render() {
        if (!ctx.guard()) return;
        var state = ctx.state(), snapshot = state.current_range_snapshot;
        if (!usable(snapshot)) { failure(); return; }
        ctx.error('');
        var layout = element('div', '', 'guided-range-layout');
        ctx.content.replaceChildren(layout);
        var cards = BPPGuidedEstimate.cards(snapshot, state);
        layout.appendChild(cards.estimate);

        var next = element('section', '', 'guided-range-next guided-range-card');
        next.appendChild(element('h2', 'Next: check your text messages'));
        next.appendChild(element('p', 'Accept your range and Key will text you to request setup photos. Reply with your photos when you are ready.'));
        var button = primary('Accept my range', request, next); button.dataset.requestProposal = '';
        next.appendChild(element('p', 'No payment is due here.', 'guided-range-payment'));
        layout.appendChild(next);

        var scope = cards.scope;
        layout.appendChild(scope);

        var utilities = element('div', '', 'guided-range-utilities');
        save(utilities);
        layout.insertBefore(utilities, scope);
        var key = WALK.rangePresentationKey(ctx.token, snapshot, state.version);
        if (key !== presented) { presented = key; WALK.ph('walk_v2_range_presented', { event_schema_version: 1, surface_state: 'range_available', entry_path: 'new_intake', result: 'presented', pricing_basis: String(snapshot.pricing_basis || '') }); }
        ctx.focus();
      }
      async function load(useInitialView) {
        if (ctx.busy) return;
        ctx.busy = true;
        if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.show('estimate');
        ctx.content.replaceChildren(element('h1', 'Preparing your estimate...'));
        try {
          if (useInitialView !== true) await ctx.load();
          if (!ctx.guard()) return;
          if (!ctx.state().current_range_snapshot || (ctx.state().current_range_snapshot.status === 'unavailable' && ctx.state().current_range_snapshot.reason === 'not_created')) { await ctx.action('create_range', { revision_reason: 'initial' }); await ctx.load(); }
          render();
        } catch (_) { failure(); }
        finally { ctx.busy = false; }
      }
      ctx.reload = function () { return load(); };
      await load(true);
    }
  };
})();
