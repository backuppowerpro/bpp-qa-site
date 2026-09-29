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
        if (window.BPPQuoteWalkEstimateLoading) BPPQuoteWalkEstimateLoading.show('photos');
        if (accepted(ctx.state())) { WALK.go('photos.html', ctx.token); return; }
        var displayed = ctx.state().current_range_snapshot.snapshot_id;
        ctx.busy = true;
        ctx.content.querySelector('[data-text-photos-later]').disabled = true;
        var button = ctx.content.querySelector('[data-request-proposal]'); button.disabled = true; button.textContent = 'Saving your request...';
        try {
          var expected = typeof WALK.guidedReceiptContext === 'function' ? WALK.guidedReceiptContext(ctx.state()) : null;
          var receipt = await ctx.action('accept_range', {});
          if (typeof WALK.guidedReceiptMatches === 'function' && WALK.guidedReceiptMatches(receipt, expected)) {
            WALK.ph('walk_v2_range_accepted_lead', { event_schema_version: 1, surface_state: 'range_accepted', entry_path: 'new_intake', result: 'accepted', pricing_basis: String(ctx.state().current_range_snapshot.pricing_basis || '') });
            WALK.go('photos.html', ctx.token, null, true); return;
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
      async function textPhotosLater() {
        if (ctx.busy) return;
        var displayed = ctx.state().current_range_snapshot.snapshot_id;
        var wasAccepted = accepted(ctx.state());
        ctx.busy = true; ctx.error('');
        ctx.content.querySelector('[data-request-proposal]').disabled = true;
        var button = ctx.content.querySelector('[data-text-photos-later]');
        button.disabled = true; button.textContent = 'Sending photo instructions...';
        function sameEstimate() { return accepted(ctx.state()) && ctx.state().accepted_range_snapshot_id === displayed; }
        try {
          if (!wasAccepted) {
            // A lost acknowledgement is reconciled before the separate text request.
            try { await ctx.action('accept_range', {}); } catch (_) {}
          }
          await ctx.load();
          if (!ctx.guard()) return;
          if (!sameEstimate()) throw new Error('estimate_changed');
          if (!wasAccepted) WALK.ph('walk_v2_range_accepted_lead', { event_schema_version: 1, surface_state: 'range_accepted', entry_path: 'new_intake', result: 'accepted', pricing_basis: String(ctx.state().current_range_snapshot.pricing_basis || '') });
          var destination = WALK.guidedDestination(ctx.token, ctx.view);
          if (destination.reason === 'deeper' || destination.reason === 'submitted') { WALK.routeFromState(ctx.token, ctx.view, true); return; }
          var review = ctx.review(), correction = review.current_correction;
          var fields = { photo_followup: 'text_later', packet_revision: review.packet_revision, correction_request_id: correction && !correction.resolved_at ? correction.id : null, correction_revision: correction && !correction.resolved_at ? correction.revision : null };
          var expected = WALK.guidedReceiptContext(ctx.state());
          var receipt = await ctx.action('handoff', fields);
          if (WALK.guidedReceiptMatches(receipt, expected, fields)) { WALK.go('photos-later.html', ctx.token, null, true); return; }
          await ctx.load();
          if (sameEstimate() && ctx.review().followup && ctx.review().followup.current === true) { WALK.go('photos-later.html', ctx.token, null, true); return; }
          throw new Error('photo_followup_not_confirmed');
        } catch (_) {
          try {
            await ctx.load();
            if (!ctx.guard()) return;
            if (sameEstimate() && ctx.review().followup && ctx.review().followup.current === true) { WALK.go('photos-later.html', ctx.token, null, true); return; }
            render();
            var status = element('p', sameEstimate() ? 'The text could not be confirmed. Check your messages, then try again to check the same request.' : 'Your estimate changed or could not be confirmed. Review it before trying again.');
            status.setAttribute('role', 'alert'); status.tabIndex = -1; status.dataset.textLaterStatus = '';
            ctx.content.querySelector('[data-text-photos-later]').parentNode.appendChild(status);
            status.focus();
          } catch (_) {
            ctx.content.replaceChildren(element('h1', 'Your request could not be confirmed.'), element('p', 'Check your messages, then reload your saved estimate before trying again.'));
            primary('Check saved estimate', load); save(); ctx.focus();
          }
        } finally { ctx.busy = false; }
      }
      function phoneForm() {
        var existing = ctx.content.querySelector('.guided-phone');
        if (existing) { existing.querySelector('input').focus(); return; }
        var form = element('form', '', 'guided-phone');
        form.innerHTML = '<label for="guided-phone-number">Mobile number</label><input id="guided-phone-number" type="tel" autocomplete="tel" inputmode="tel"><p>By saving, you agree to texts from Backup Power Pro about your project at this mobile number. Msg and data rates may apply. Reply STOP anytime.</p><button type="submit" class="cta">Save mobile number</button><button type="button" class="guided-link" data-cancel-phone>Cancel</button><p role="alert" data-phone-error></p>';
        var input = form.querySelector('input'); input.value = ctx.view.phone || '';
        form.querySelector('[data-cancel-phone]').onclick = render;
        form.onsubmit = async function (event) {
          event.preventDefault(); if (ctx.busy) return;
          var digits = input.value.replace(/\D/g, ''); if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
          if (!/^\d{10}$/.test(digits)) { form.querySelector('[data-phone-error]').textContent = 'Enter a 10-digit phone number.'; input.focus(); return; }
          ctx.busy = true; form.querySelector('[type=submit]').disabled = true;
          try { await ctx.action('update_phone', { phone: digits }); await ctx.load(); render(); ctx.error(''); ctx.content.appendChild(element('p', 'Mobile number saved')); }
          catch (_) { form.querySelector('[data-phone-error]').textContent = 'Your mobile number did not save. Try again.'; }
          finally { ctx.busy = false; if (form.isConnected) form.querySelector('[type=submit]').disabled = false; }
        };
        ctx.content.appendChild(form); input.focus();
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
        next.appendChild(element('h2', 'Next: add your setup photos'));
        next.appendChild(element('p', 'Key will review your photos before preparing your firm proposal.'));
        var button = primary('Continue to photos', request, next); button.dataset.requestProposal = '';
        var textAction = element('div', '', 'guided-range-utilities');
        link('Text the photos later', textPhotosLater, textAction).dataset.textPhotosLater = '';
        next.appendChild(textAction);
        next.appendChild(element('p', 'No payment is due here.', 'guided-range-payment'));
        layout.appendChild(next);

        var scope = cards.scope;
        layout.appendChild(scope);

        var utilities = element('div', '', 'guided-range-utilities');
        save(utilities);
        if (accepted(state)) { utilities.appendChild(element('p', 'Mobile number: ' + String(ctx.view.phone || ''))); link('Edit mobile number', phoneForm, utilities); }
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
