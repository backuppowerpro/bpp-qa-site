/* One visual wait across intake and the authoritative estimate read. No answers are cached. */
(function () {
  'use strict';
  var root = document.documentElement;
  var active = /\/walk-v2\/range(?:\.html)?\/?$/.test(location.pathname);
  var panel;
  function mount() {
    if (!active || !document.body || panel) return;
    panel = document.createElement('div');
    panel.className = 'qw-estimate-wait';
    panel.innerHTML = '<div class="qw-estimate-wait-shell"><header><img src="/assets/images/logo-white-v2.png" alt="Backup Power Pro"></header><div class="qw-estimate-wait-card" role="status" aria-live="polite"><h1>Preparing your estimate...</h1><p>This may take a few seconds.</p></div></div>';
    document.body.appendChild(panel);
  }
  function show() { active = true; root.classList.add('qw-estimate-waiting'); mount(); }
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
