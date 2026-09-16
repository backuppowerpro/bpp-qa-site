/* One visual wait across each document handoff. No answers or authority are cached. */
(function () {
  'use strict';
  var root = document.documentElement;
  var mode = /\/walk-v2\/photos(?:\.html)?\/?$/.test(location.pathname) ? 'photos' : 'estimate';
  var active = /\/walk-v2\/(?:range|photos)(?:\.html)?\/?$/.test(location.pathname);
  var panel;
  function mount() {
    if (!active || !document.body || panel) return;
    panel = document.createElement('div');
    panel.className = 'qw-estimate-wait';
    panel.innerHTML = '<div class="qw-estimate-wait-shell"><header><img src="/assets/images/logo-white-v2.png" alt="Backup Power Pro"></header><div class="qw-estimate-wait-card" role="status" aria-live="polite"><h1>Preparing your estimate...</h1><p>This may take a few seconds.</p></div></div>';
    panel.querySelector('h1').textContent = mode === 'photos' ? 'Opening your photos...' : 'Preparing your estimate...';
    document.body.appendChild(panel);
  }
  function show(nextMode) { if (nextMode) mode = nextMode === 'photos' ? 'photos' : 'estimate'; active = true; root.classList.add('qw-estimate-waiting'); mount(); if (panel) panel.querySelector('h1').textContent = mode === 'photos' ? 'Opening your photos...' : 'Preparing your estimate...'; }
  function hide() { active = false; root.classList.remove('qw-estimate-waiting'); if (panel) panel.remove(); panel = null; }
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
