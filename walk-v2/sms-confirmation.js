/* A second explicit choice records permission; it does not authorize sending. */
(function () {
  'use strict';
  var CONTRACT = 'bpp-confirmation-sms-v1';
  var DISCLOSURE = 'bpp-confirmation-sms-2026-10-16-v1';
  var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  var memory = Object.create(null), sequence = 0;
  function phone(value) {
    var digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? '+1' + digits : '';
  }
  function projection(view) {
    if (!view || !window.BPPEstimateTerminal || !BPPEstimateTerminal.confirmed(view)) return null;
    var preferences = view.communication_preferences || {}, value = preferences.sms_confirmation;
    if (!value || value.contract !== CONTRACT || ['show', 'recorded', 'dismissed', 'unavailable'].indexOf(value.state) === -1
      || !Number.isSafeInteger(value.preference_revision) || value.preference_revision < 0
      || value.preference_revision !== preferences.revision || value.disclosure_version !== DISCLOSURE
      || value.permission_effective !== false || !phone(value.recipient_phone)
      || value.recipient_phone !== phone(view.phone) || value.recipient_phone !== preferences.recipient_phone) return null;
    return value;
  }
  function sameRequest(before, after) {
    var a = before && before.quote_walk_v2 || {}, b = after && after.quote_walk_v2 || {};
    return phone(before && before.phone) === phone(after && after.phone)
      && before.id === after.id && before.pre_read_id === after.pre_read_id && before.contact_id === after.contact_id
      && a.pre_read_id === b.pre_read_id && a.version === b.version
      && a.accepted_range_snapshot_id === b.accepted_range_snapshot_id && a.initial_panel_photo_media_id === b.initial_panel_photo_media_id
      && (a.readiness || {}).acceptance_id === (b.readiness || {}).acceptance_id
      && (a.handoff_receipt || {}).id === (b.handoff_receipt || {}).id;
  }
  function storageKey(token) { return 'bpp:sms-confirmation:v1:' + token; }
  function pending(token) {
    var value = memory[token];
    try { value = JSON.parse(sessionStorage.getItem(storageKey(token))) || value; } catch (_) {}
    if (!value || !UUID.test(value.request_key || '') || !Number.isSafeInteger(value.expected_version) || value.expected_version < 1
      || !value.payload || !Number.isSafeInteger(value.payload.expected_preference_revision) || value.payload.expected_preference_revision < 0
      || !value.payload.sms_confirmation || ['grant', 'dismiss'].indexOf(value.payload.sms_confirmation.decision) === -1
      || !phone(value.payload.sms_confirmation.recipient_phone)
      || value.payload.sms_confirmation.disclosure_version !== DISCLOSURE) return null;
    return value;
  }
  function remember(token, value) {
    if (value) memory[token] = value; else delete memory[token];
    try { if (value) sessionStorage.setItem(storageKey(token), JSON.stringify(value)); else sessionStorage.removeItem(storageKey(token)); } catch (_) {}
  }
  function mount(container, options) {
    options = options || {};
    var view = options.view, selected = projection(view), token = options.token;
    if (!container || !selected || !/^[a-zA-Z0-9_-]{32,160}$/.test(token || '')
      || !window.WALK || typeof WALK.smsConfirmation !== 'function' || typeof WALK.view !== 'function') return null;
    if (selected.state === 'unavailable' || selected.state === 'dismissed') { if (selected.state === 'dismissed') remember(token, null); return null; }
    var element = function (tag, text, className) { var node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
    var root = element('div', '', 'guided-sms-confirmation'); root.dataset.smsConfirmation = selected.state;
    container.appendChild(root);
    var busy = false, destroyed = false, error = '', saved = false, choice = false, operation = pending(token);
    // This checked value is only a retry of the customer's prior explicit grant.
    if (operation && operation.payload.sms_confirmation.decision === 'grant') choice = true;
    if (operation && (operation.payload.sms_confirmation.recipient_phone !== selected.recipient_phone
      || operation.payload.expected_preference_revision !== selected.preference_revision
      || operation.expected_version !== view.quote_walk_v2.version) && selected.state === 'show') selected = { state: 'unavailable' };
    var status, checkbox, save, dismiss;
    function active() { return !destroyed && (!options.guard || options.guard()); }
    function focusStatus() { if (status && typeof status.focus === 'function') status.focus({ preventScroll: true }); }
    function render(focus) {
      if (!active()) return;
      root.replaceChildren(); root.dataset.smsConfirmation = busy ? 'pending' : selected.state;
      root.setAttribute('aria-busy', busy ? 'true' : 'false');
      status = element('p', '', error ? 'guided-error' : 'guided-sms-status');
      status.dataset.smsConfirmationStatus = ''; status.setAttribute('role', error ? 'alert' : 'status');
      status.setAttribute('aria-live', error ? 'assertive' : 'polite'); status.setAttribute('aria-atomic', 'true'); status.tabIndex = -1;
      if (selected.state === 'recorded') {
        status.textContent = 'Your text preference is recorded.'; root.appendChild(status);
        remember(token, null); if (focus) focusStatus(); return;
      }
      if (selected.state === 'dismissed') {
        status.textContent = 'No change to your text preference.'; root.appendChild(status);
        remember(token, null); if (focus) focusStatus(); return;
      }
      if (selected.state !== 'show') {
        status.textContent = 'Text preferences are unavailable right now. Your quote request is still saved.';
        root.appendChild(status); if (focus) focusStatus(); return;
      }
      if (operation && operation.payload.sms_confirmation.decision === 'dismiss') {
        dismiss = element('button', busy ? 'Saving Not now...' : 'Retry Not now', 'guided-link'); dismiss.type = 'button'; dismiss.dataset.confirmationSmsDismiss = ''; dismiss.disabled = busy;
        dismiss.onclick = function () { if (!busy) commit('dismiss'); };
        root.append(status, dismiss);
        status.textContent = busy ? 'Saving Not now...' : error || 'Not now is not confirmed yet.';
        if (focus) focusStatus(); return;
      }
      var fieldset = element('fieldset', '', 'guided-communication-choices');
      fieldset.appendChild(element('legend', 'Text updates (optional)'));
      var id = 'confirmation-sms-' + (++sequence), label = element('label', '', 'guided-communication-choice');
      checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = choice; checkbox.disabled = busy || Boolean(operation);
      checkbox.dataset.confirmationSmsChoice = ''; checkbox.setAttribute('aria-describedby', id + '-details ' + id + '-optional');
      label.append(checkbox, element('span', 'Text me quote and installation updates from Backup Power Pro, including automated texts.'));
      fieldset.appendChild(label);
      var details = element('p', 'Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. ', 'guided-choice-note'); details.id = id + '-details';
      var terms = element('a', 'SMS Terms'); terms.href = '/terms.html';
      var privacy = element('a', 'Privacy Policy'); privacy.href = '/privacy.html';
      details.append(terms, document.createTextNode(' · '), privacy, document.createTextNode('.'));
      fieldset.appendChild(details);
      var optional = element('p', 'Optional. No purchase required.', 'guided-choice-note'); optional.id = id + '-optional'; fieldset.appendChild(optional);
      var actions = element('div', '', 'guided-sms-actions');
      save = element('button', busy ? 'Saving preference...' : operation ? 'Retry saving preference' : 'Save text preference', 'initial-photo-button qw-secondary-action'); save.type = 'button'; save.dataset.confirmationSmsSave = '';
      dismiss = element('button', operation && operation.payload.sms_confirmation.decision === 'dismiss' ? 'Retry Not now' : 'Not now', 'guided-link'); dismiss.type = 'button'; dismiss.dataset.confirmationSmsDismiss = '';
      save.disabled = busy || (!operation && !choice) || Boolean(operation && operation.payload.sms_confirmation.decision === 'dismiss');
      dismiss.disabled = busy || Boolean(operation && operation.payload.sms_confirmation.decision === 'grant');
      checkbox.onchange = function () { choice = checkbox.checked === true; save.disabled = !choice; };
      save.onclick = function () { if (!busy && (operation || checkbox.checked === true)) commit('grant'); };
      dismiss.onclick = function () { if (!busy) commit('dismiss'); };
      actions.append(save, dismiss); root.append(fieldset, actions, status);
      status.textContent = busy ? operation.payload.sms_confirmation.decision === 'dismiss' ? 'Saving Not now...' : 'Saving your text preference...'
        : error || (operation ? 'Your text preference save is not confirmed. Retry the same choice to check it.' : '');
      if (focus) focusStatus();
    }
    async function commit(decision) {
      if (!active() || busy || selected.state !== 'show') return;
      if (!operation) {
        if (decision === 'grant' && (!checkbox || checkbox.checked !== true)) return;
        var requestKey;
        try { requestKey = window.crypto.randomUUID(); } catch (_) {}
        if (!UUID.test(requestKey || '')) { error = 'We could not save a text preference in this browser. Your quote request is still saved.'; render(true); return; }
        operation = { expected_version: view.quote_walk_v2.version, request_key: requestKey, payload: { expected_preference_revision: selected.preference_revision,
          sms_confirmation: { decision: decision, recipient_phone: selected.recipient_phone, disclosure_version: DISCLOSURE } } };
        remember(token, operation);
      }
      busy = true; error = ''; render(true);
      try {
        await WALK.smsConfirmation(token, operation);
        var fresh = await WALK.view(token), freshProjection = projection(fresh);
        if (!freshProjection || !sameRequest(view, fresh)) throw new Error('stale_recipient');
        view = fresh; selected = freshProjection;
        if (selected.state === 'show') throw new Error('unconfirmed_sms_preference');
        if (selected.state === 'recorded' || selected.state === 'dismissed') remember(token, null);
        saved = selected.state === 'recorded';
      } catch (failure) {
        var code = String(failure && failure.body && failure.body.error || failure && failure.message || '');
        if (/^(sms_confirmation_unavailable|sms_confirmation_decided|stale_preference_revision|stale_journey_version|stale_recipient|project_contact_payload_conflict|invalid_or_expired_return)$/.test(code)) {
          try {
            var refreshed = await WALK.view(token), refreshedProjection = projection(refreshed);
            if (refreshedProjection && sameRequest(view, refreshed) && refreshedProjection.state !== 'show') { view = refreshed; selected = refreshedProjection; }
            else selected = { state: 'unavailable' };
          } catch (_) { selected = { state: 'unavailable' }; }
        } else error = 'We could not confirm your text preference. Your quote request is still saved. Try again.';
      } finally { busy = false; render(true); }
    }
    render(false);
    return { destroy: function () { destroyed = true; }, recorded: function () { return saved; } };
  }
  window.BPPSmsConfirmation = { version: 1, contract: CONTRACT, disclosureVersion: DISCLOSURE, projection: projection, mount: mount };
})();
