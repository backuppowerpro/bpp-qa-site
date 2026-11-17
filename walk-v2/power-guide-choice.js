/* Temporary same-tab form choices. This is not a durable consent record. */
(function () {
  'use strict';
  var KEY = 'bpp:qwv2:power-guide-choice';
  var CONTRACT = 'bpp-power-guide-choice-draft-v1';
  var MAX_AGE = 15 * 60 * 1000;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var memory;
  var LEGACY_COPY = 'bpp-guide-consent-2026-10-15';
  var COMPACT_COPY = 'bpp-guide-consent-2026-10-16';
  var CURRENT_COPY = 'bpp-guide-consent-2026-10-19';
  function renderedVersion() {
    var control = typeof document !== 'undefined' && document.querySelector('[data-power-guide-offer]');
    return control && control.getAttribute('data-consent-version') || LEGACY_COPY;
  }
  function read() {
    if (!memory) {
      try { memory = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
    }
    var age = memory && Date.now() - memory.updatedAt;
    if (!memory || memory.contract !== CONTRACT || !Number.isSafeInteger(memory.updatedAt) || age < 0 || age >= MAX_AGE
        || memory.copyVersion !== undefined && memory.copyVersion !== LEGACY_COPY && memory.copyVersion !== COMPACT_COPY && memory.copyVersion !== CURRENT_COPY
        || typeof memory.guideAndNewsletter !== 'boolean' || typeof memory.smsQuoteService !== 'boolean'
        || typeof memory.nonce !== 'string' || memory.nonce && !UUID.test(memory.nonce)
        || typeof memory.acceptanceId !== 'string' || memory.acceptanceId && !UUID.test(memory.acceptanceId)) return null;
    return memory;
  }
  function save(value) {
    memory = value;
    try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch (_) {}
  }
  function draft(guideAndNewsletter, smsQuoteService) {
    if (typeof guideAndNewsletter !== 'boolean' || typeof smsQuoteService !== 'boolean') return;
    save({contract:CONTRACT,copyVersion:renderedVersion(),updatedAt:Date.now(),guideAndNewsletter:guideAndNewsletter,smsQuoteService:smsQuoteService,nonce:'',acceptanceId:''});
  }
  // Unsent choices belong to the exact wording the visitor saw. Receipt reads
  // retain historical choice drafts, while a changed form starts unchecked.
  function readForForm(version) {
    var value = read();
    return value && !value.nonce && !value.acceptanceId
      && (value.copyVersion || LEGACY_COPY) === (version || LEGACY_COPY) ? value : null;
  }
  function bindRequest(nonce) {
    var value = read();
    if (!value || !UUID.test(nonce || '') || value.nonce && value.nonce !== nonce) return false;
    save(Object.assign({}, value, {nonce:nonce})); return true;
  }
  function bindReceipt(nonce, acceptanceId) {
    var value = read();
    if (!value || value.nonce !== nonce || !UUID.test(acceptanceId || '')) return false;
    save(Object.assign({}, value, {acceptanceId:acceptanceId})); return true;
  }
  function choice(view) {
    var value = read();
    if (!value || !window.BPPEstimateTerminal || !BPPEstimateTerminal.confirmed(view)
        || value.acceptanceId !== view.quote_walk_v2.readiness.acceptance_id) return undefined;
    return value.guideAndNewsletter;
  }
  function clear() {
    memory = null;
    try { sessionStorage.removeItem(KEY); } catch (_) {}
  }
  window.BPPPowerGuideChoice = {version:1,read:read,readForForm:readForForm,draft:draft,bindRequest:bindRequest,bindReceipt:bindReceipt,choice:choice,clear:clear};
})();
