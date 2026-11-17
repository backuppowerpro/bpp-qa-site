/* One visual wait across each document handoff. No answers or authority are cached. */
(function () {
  'use strict';
  var root = document.documentElement;
  var mode = /\/walk-v2\/photos(?:\.html)?\/?$/.test(location.pathname) ? 'photos' : 'estimate';
  var active = /\/walk-v2\/(?:range|photos)(?:\.html)?\/?$/.test(location.pathname);
  var panel;
  var priorFocus;
  function label() { return mode === 'photos' ? 'Opening your next step...' : mode === 'saving' ? 'Saving your request...' : 'Preparing your estimate...'; }
  function explanation() { return mode === 'photos' ? 'We are opening your next step. Your saved request will appear here.' : mode === 'saving' ? 'We are saving your request. You will see the next step after the save is confirmed.' : 'We are preparing your estimate. The next step will appear here.'; }
  function mount() {
    if (!active || !document.body || panel) return;
    panel = document.createElement('div');
    panel.className = 'qw-estimate-wait';
    panel.innerHTML = '<div class="qw-estimate-wait-shell"><header><img src="/assets/images/logo-white-v2.png" alt="Backup Power Pro"></header><div class="qw-estimate-wait-card" role="status" aria-live="polite"><h1>Preparing your estimate...</h1><p></p></div></div>';
    var heading = panel.querySelector('h1');
    heading.textContent = label(); heading.tabIndex = -1;
    panel.querySelector('p').textContent = explanation();
    document.body.appendChild(panel);
    heading.focus({ preventScroll: true });
  }
  function show(nextMode) { if (nextMode) mode = ['photos', 'saving'].indexOf(nextMode) !== -1 ? nextMode : 'estimate'; if (!active || !panel) priorFocus = document.activeElement; active = true; root.classList.add('qw-estimate-waiting'); mount(); if (panel) { panel.querySelector('h1').textContent = label(); panel.querySelector('p').textContent = explanation(); } }
  function hide() {
    var restore = panel && (panel.contains(document.activeElement) || document.activeElement === document.body);
    active = false; root.classList.remove('qw-estimate-waiting'); if (panel) panel.remove(); panel = null;
    if (restore && priorFocus && priorFocus.isConnected && !priorFocus.disabled && priorFocus.getClientRects().length && getComputedStyle(priorFocus).visibility === 'visible') priorFocus.focus({ preventScroll: true });
    priorFocus = null;
  }
  window.BPPQuoteWalkEstimateLoading = { show: show, hide: hide, isActive: function () { return active; } };
  if (active) {
    show();
    if (!document.body) {
      var observer = new MutationObserver(function () { if (document.body) { observer.disconnect(); mount(); } });
      observer.observe(root, { childList: true, subtree: true });
    }
  }
  document.addEventListener('DOMContentLoaded', function () {
    // Missing controller dependencies must reveal the existing reload/help recovery.
    if (root.classList.contains('no-js')) hide(); else mount();
  }, { once: true });
})();
