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
      function primary(label, callback, parent) { var button = element('button', label, 'cta qw-primary-action'); button.type = 'button'; button.onclick = callback; (parent || ctx.content).appendChild(button); return button; }
      function link(label, callback, parent) { var button = element('button', label, 'guided-link'); button.type = 'button'; button.onclick = callback; (parent || ctx.content).appendChild(button); return button; }
      function save(parent) { var container = element('div'); container.innerHTML = BPPGuidedSaved.saveMarkup; (parent || ctx.content).appendChild(container); ctx.save(container.querySelector('[data-save-for-later]'), parent ? function () { return 'Keep your private link to return here.'; } : undefined); }
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
        var layout = element('div', '', 'guided-range-layout');
        ctx.content.replaceChildren(layout);
        var estimate = element('section', '', 'guided-estimate-card');
        estimate.setAttribute('aria-label', 'Your installation estimate');
        estimate.appendChild(element('h1', 'Your installation estimate'));
        var starting = snapshot.pricing_context.estimate_kind === 'starting_at';
        var amount = (starting ? 'Starting at ' : '') + money(snapshot.low_cents) + (!starting && snapshot.high_cents !== snapshot.low_cents ? ' to ' + money(snapshot.high_cents) : '');
        estimate.appendChild(element('div', amount, 'guided-amount'));
        var basis = String(snapshot.pricing_basis || '').replace('A', '');
        estimate.appendChild(element('p', basis + ' Amp recommended connection', 'guided-range-basis'));
        estimate.appendChild(element('p', 'Based on your setup answers.', 'guided-range-caption'));
        if (state.panel_inventory_status === 'multiple_unsure_main') estimate.appendChild(element('p', "Panel arrangement still needs Key's review.", 'guided-range-condition'));
        if (starting) estimate.appendChild(element('p', 'This starting estimate allows for 45 feet of wiring. Key will review your longer route and ask for measurements if needed before quoting the exact price.', 'guided-range-condition'));
        layout.appendChild(estimate);

        var next = element('section', '', 'guided-range-next guided-range-card');
        next.appendChild(element('h2', 'Next: add your setup photos'));
        next.appendChild(element('p', 'Key will review your photos before preparing your firm proposal.'));
        var button = primary('Continue to photos', request, next); button.dataset.requestProposal = '';
        next.appendChild(element('p', 'No payment is due here.', 'guided-range-payment'));
        layout.appendChild(next);

        var scope = element('section', '', 'guided-range-included guided-range-card');
        scope.appendChild(element('h2', "What's included"));
        if (offer(snapshot)) scope.appendChild(element('p', offer(snapshot).name, 'guided-range-caption'));
        var list = element('ul', '', 'guided-scope');
        var rows = {};
        snapshot.scope_rows.forEach(function (row) { rows[row.key] = row; });
        function scopeRow(key, description, artwork, title) {
          var item = element('li', '', 'guided-scope-row');
          item.dataset.scopeKey = key;
          if (artwork && (basis === '30' || basis === '50')) {
            var img = element('img'); img.src = '/assets/product-images/' + artwork + '-' + basis + 'amp.jpg'; img.alt = ''; img.width = 60; img.height = 60; item.appendChild(img);
          } else {
            var icon = element('span', '', 'guided-scope-icon'); icon.setAttribute('aria-hidden', 'true');
            var paths = {
              installation: '<path d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z"/>',
              panel_guide: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>',
              permit_and_required_inspection: '<path d="M7 4H4v17h16V4h-3M8 2h8v5H8zM8 14l3 3 5-6"/>',
              one_year_workmanship_support: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6zM8 12l3 3 5-6"/>'
            };
            icon.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="1.7">' + (paths[key] || paths.installation) + '</svg>'; item.appendChild(icon);
          }
          var copy = element('div'); copy.appendChild(element('strong', title || scopeText(rows[key])[0])); copy.appendChild(element('span', description)); item.appendChild(copy); list.appendChild(item); return item;
        }
        scopeRow('metal_outdoor_connection_box', 'A permanent, weather-rated outdoor connection.', 'inlet');
        scopeRow('heavy_duty_compatible_cord', 'Matched to your generator and connection box.', 'cord');
        scopeRow('installation', 'Panel-matched wiring, testing, and cleanup.');
        scopeRow('panel_guide', 'A system test with you is offered. A step guide stays inside your panel.', null, 'Practice and a panel guide');
        scopeRow('permit_and_required_inspection', 'Application, permit fee, scheduling, and follow-through.');
        var guarantee = scopeRow('one_year_workmanship_support', scopeText(rows.one_year_workmanship_support)[1]); guarantee.classList.add('guided-range-guarantee');
        scope.appendChild(list);
        var scopeDetails = element('details', '', 'guided-range-details'); scopeDetails.appendChild(element('summary', 'Installation details'));
        snapshot.scope_rows.forEach(function (row) { var description = element('p'); description.appendChild(element('strong', scopeText(row)[0] + ': ')); description.appendChild(document.createTextNode(scopeText(row)[1])); scopeDetails.appendChild(description); });
        scope.appendChild(scopeDetails);
        layout.appendChild(scope);

        var utilities = element('div', '', 'guided-range-utilities');
        save(utilities);
        if (accepted(state)) { utilities.appendChild(element('p', 'Mobile number: ' + String(ctx.view.phone || ''))); link('Edit mobile number', phoneForm, utilities); }
        layout.appendChild(utilities);
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
