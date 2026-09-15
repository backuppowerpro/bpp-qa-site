/* One current server estimate and one deliberate proposal-interest action. */
(function () {
  'use strict';
  var SCOPE = {
    installation: ['Generator connection installation', 'Panel-matched installation, breaker wiring, testing, and cleanup.'],
    metal_outdoor_connection_box: ['Outdoor connection box', 'A permanent, weather-rated connection point for your portable generator.'],
    heavy_duty_compatible_cord: ['Matching generator cord', 'A factory-manufactured cord assembly matched to your portable generator and connection box.'],
    system_walkthrough: ['Practice before you need it', 'We offer to test the system with you.'],
    panel_guide: ['Steps where you need them', 'An operating-guide sticker stays inside your panel for reference during an outage.'],
    permit_and_required_inspection: ['Permit and inspection handled', 'We handle the application, permit fee, inspection scheduling, and follow-through.'],
    one_year_workmanship_support: ['One-year workmanship support', 'If an issue comes from our installation work during the first year, we return and correct it at no charge.']
  };
  function offer(snapshot) {
    var row = (snapshot.scope_rows || []).find(function (item) { return item.key === 'one_year_workmanship_support'; });
    return row && row.offer_policy;
  }
  function scopeText(row) {
    if (row.key === 'one_year_workmanship_support' && row.offer_policy) return [row.offer_policy.guarantee_title, row.offer_policy.guarantee_text];
    return SCOPE[row.key];
  }
  function money(cents) { return '$' + Math.round(cents / 100).toLocaleString('en-US'); }
  function accepted(state) { return Boolean(state.accepted_range_snapshot_id && state.current_range_snapshot && state.accepted_range_snapshot_id === state.current_range_snapshot.snapshot_id); }
  function usable(snapshot) {
    if (!snapshot || snapshot.status !== 'available' || !Number.isInteger(snapshot.low_cents) || snapshot.low_cents <= 0 || !Number.isInteger(snapshot.high_cents) || snapshot.high_cents < snapshot.low_cents) return false;
    var context = snapshot.pricing_context;
    if (snapshot.calculator_version !== 'quote_walk_catalog_1' || !context || context.low_cents !== snapshot.low_cents || context.high_cents !== snapshot.high_cents || ['starting_at', 'single', 'bounded'].indexOf(context.estimate_kind) === -1) return false;
    var policy = offer(snapshot);
    if (policy && (policy.version !== 'generator-home-connection-2026-09-15' || typeof policy.guarantee_title !== 'string' || typeof policy.guarantee_text !== 'string' || policy.name !== 'BPP Generator Home Connection')) return false;
    var rows = snapshot.scope_rows || [];
    return snapshot.cord_included === true && rows.length === Object.keys(SCOPE).length && new Set(rows.map(function (row) { return row.key; })).size === rows.length && rows.every(function (row) { return SCOPE[row.key] && row.included === true; });
  }
  window.BPPGuidedRange = {
    mount: async function (ctx) {
      var element = BPPGuidedSaved.element;
      var presented = '';
      function primary(label, callback) { var button = element('button', label, 'cta qw-primary-action'); button.type = 'button'; button.onclick = callback; ctx.content.appendChild(button); return button; }
      function link(label, callback) { var button = element('button', label, 'guided-link'); button.type = 'button'; button.onclick = callback; ctx.content.appendChild(button); return button; }
      function save() { var container = element('div'); container.innerHTML = BPPGuidedSaved.saveMarkup; ctx.content.appendChild(container); ctx.save(container.querySelector('[data-save-for-later]')); }
      function pause() {
        ctx.content.replaceChildren(element('h1', accepted(ctx.state()) ? 'Your saved request is still available.' : 'Your estimate is saved.'));
        ctx.content.appendChild(element('p', accepted(ctx.state()) ? 'Keep your link if you want to return.' : 'No proposal has been requested. Keep your link if you want to return.'));
        save(); link('Back to my estimate', render); ctx.focus();
      }
      function failure() {
        ctx.content.replaceChildren(element('h1', 'Your details are saved, but your estimate could not load.'));
        primary('Try again', load); save(); ctx.focus();
      }
      async function request() {
        if (ctx.busy) return;
        if (accepted(ctx.state())) { WALK.go('photos.html', ctx.token); return; }
        var displayed = ctx.state().current_range_snapshot.snapshot_id;
        ctx.busy = true;
        var button = ctx.content.querySelector('[data-request-proposal]'); button.disabled = true; button.textContent = 'Saving your request...';
        try {
          await ctx.action('accept_range', {});
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
        ctx.content.replaceChildren(element('h1', 'Your installation estimate'));
        var starting = snapshot.pricing_context.estimate_kind === 'starting_at';
        var amount = (starting ? 'Starting at ' : '') + money(snapshot.low_cents) + (!starting && snapshot.high_cents !== snapshot.low_cents ? ' to ' + money(snapshot.high_cents) : '');
        ctx.content.appendChild(element('div', amount, 'guided-amount'));
        var basis = String(snapshot.pricing_basis || '').replace('A', '');
        ctx.content.appendChild(element('p', 'Recommended connection: ' + basis + ' Amp'));
        ctx.content.appendChild(element('p', 'A matching generator cord is included.'));
        if (state.panel_inventory_status === 'multiple_unsure_main') ctx.content.appendChild(element('p', "Panel arrangement still needs Key's review."));
        if (starting) ctx.content.appendChild(element('p', 'This starting estimate allows for 45 feet of wiring. Key will review your longer route and ask for measurements if needed before quoting the exact price.'));
        ctx.content.appendChild(element('h2', offer(snapshot) ? offer(snapshot).name : "What's included"));
        var list = element('ul', '', 'guided-scope');
        snapshot.scope_rows.forEach(function (row) { var item = element('li'); item.appendChild(element('strong', scopeText(row)[0])); list.appendChild(item); });
        ctx.content.appendChild(list);
        var scopeDetails = element('details', '', 'guided-helpful'); scopeDetails.appendChild(element('summary', 'Installation details'));
        snapshot.scope_rows.forEach(function (row) { var description = element('p'); description.appendChild(element('strong', scopeText(row)[0] + ': ')); description.appendChild(document.createTextNode(scopeText(row)[1])); scopeDetails.appendChild(description); });
        ctx.content.appendChild(scopeDetails);
        ctx.content.appendChild(element('p', 'This estimate is based on your answers. Key will review your photos before preparing a firm proposal. No payment is due here.'));
        var button = primary(accepted(state) ? 'Continue to photos' : 'Request my firm proposal', request); button.dataset.requestProposal = '';
        ctx.content.appendChild(element('p', 'Next, add photos to help Key review your setup.'));
        save(); link('Not ready yet', pause); link('Correct my setup answers', function () { WALK.go('index.html', ctx.token, { edit: 'setup' }); });
        if (accepted(state)) { ctx.content.appendChild(element('p', 'Mobile number: ' + String(ctx.view.phone || ''))); link('Edit mobile number', phoneForm); }
        var key = WALK.rangePresentationKey(ctx.token, snapshot, state.version);
        if (key !== presented) { presented = key; WALK.ph('walk_v2_range_presented', { event_schema_version: 1, surface_state: 'range_available', entry_path: 'new_intake', result: 'presented', pricing_basis: String(snapshot.pricing_basis || '') }); }
        ctx.focus();
      }
      async function load() {
        if (ctx.busy) return;
        ctx.busy = true;
        ctx.content.replaceChildren(element('h1', 'Your details are saved. Preparing your estimate...'));
        try {
          await ctx.load(); if (!ctx.guard()) return;
          if (!ctx.state().current_range_snapshot || (ctx.state().current_range_snapshot.status === 'unavailable' && ctx.state().current_range_snapshot.reason === 'not_created')) { await ctx.action('create_range', { revision_reason: 'initial' }); await ctx.load(); }
          render();
        } catch (_) { failure(); }
        finally { ctx.busy = false; }
      }
      ctx.reload = load;
      await load();
    }
  };
})();
