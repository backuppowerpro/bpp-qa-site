/* Temporary explicit form selections, never durable consent or send authority. */
(function () {
  'use strict';
  var KEY = 'bpp:qwv2:email-promotions-choice';
  var CONTRACT = 'bpp-email-promotions-draft-v1';
  var VERSION = 'bpp-email-promotions-2026-11-11';
  var MAX_AGE = 15 * 60 * 1000;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var memory;
  function read() {
    if (!memory) {
      try { memory = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
    }
    var age = memory && Date.now() - memory.updatedAt;
    if (!memory || memory.contract !== CONTRACT || memory.version !== VERSION
        || !Number.isSafeInteger(memory.updatedAt) || age < 0 || age >= MAX_AGE
        || typeof memory.promotions !== 'boolean' || typeof memory.smsQuoteService !== 'boolean'
        || typeof memory.nonce !== 'string' || memory.nonce && !UUID.test(memory.nonce)) return null;
    return memory;
  }
  function save(value) {
    memory = value;
    try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch (_) {}
  }
  function draft(promotions, smsQuoteService) {
    if (typeof promotions !== 'boolean' || typeof smsQuoteService !== 'boolean') return;
    save({ contract: CONTRACT, version: VERSION, updatedAt: Date.now(), promotions: promotions, smsQuoteService: smsQuoteService, nonce: '' });
  }
  function readForForm(version) {
    var value = read();
    return value && !value.nonce && value.version === version ? value : null;
  }
  function bindRequest(nonce) {
    var value = read();
    if (!value || !UUID.test(nonce || '') || value.nonce && value.nonce !== nonce) return false;
    save(Object.assign({}, value, { nonce: nonce })); return true;
  }
  function clear() {
    memory = null;
    try { sessionStorage.removeItem(KEY); } catch (_) {}
  }
  window.BPPEmailPromotionsChoice = { version: 1, read: read, readForForm: readForForm, draft: draft, bindRequest: bindRequest, clear: clear };
})();
