(function () {
  var root = document.documentElement;
  // Entry scripts load after the static hero. A healthy boot is not a failed
  // controller, and its temporary status must not push that hero down the page.
  var booting = document.readyState === 'loading' && /^\/walk-v2\/(?:index\.html)?$/.test(location.pathname) && root.classList.contains('no-js');
  var bootStatus, bootObserver;
  function mountBootStatus() {
    if (!booting || !document.body) return;
    var notice = document.querySelector('.qw-script-recovery');
    if (notice) notice.hidden = true;
    if (!bootStatus) {
      bootStatus = document.createElement('p');
      bootStatus.className = 'qw-boot-status';
      bootStatus.setAttribute('role', 'status');
      bootStatus.setAttribute('aria-live', 'polite');
      bootStatus.setAttribute('aria-atomic', 'true');
      bootStatus.textContent = 'Loading Quote Walk...';
      document.body.appendChild(bootStatus);
    }
  }
  function finishBoot(ready) {
    if (!booting) return;
    booting = false;
    root.classList.remove('qw-booting');
    if (bootObserver) bootObserver.disconnect();
    if (bootStatus) { bootStatus.remove(); bootStatus = null; }
    var notice = document.querySelector('.qw-script-recovery');
    if (notice) notice.hidden = ready;
  }
  if (booting) {
    root.classList.add('qw-booting');
    mountBootStatus();
    bootObserver = new MutationObserver(mountBootStatus);
    bootObserver.observe(root, { childList: true, subtree: true });
  }
  window.BPPQuoteWalkMarkReady = function () {
    finishBoot(true);
    root.classList.remove('no-js');
    root.classList.add('js');
  };
  function reloadTarget() {
    var target = new URL(location.href);
    if (window.__BPP_INVALID_CAPABILITY_ENTRY) target.searchParams.set('t', 'invalid');
    else if (/^[a-zA-Z0-9_-]{32,160}$/.test(window.__BPP_WALK_TOKEN || '')) target.searchParams.set('t', window.__BPP_WALK_TOKEN);
    else if (typeof window.__BPP_WALK_TOKEN !== 'string' && window.__BPP_CAPABILITY_ENTRY && !target.searchParams.has('t')) return null;
    return target.href;
  }
  window.BPPQuoteWalkReloadTarget = reloadTarget;
  function recoveryControl() {
    var notice = document.querySelector('.qw-script-recovery');
    // An initialized entry controller may already have supplied this control.
    if (!notice || notice.querySelector('button') || !reloadTarget()) return;
    var reload = document.createElement('button'); reload.type = 'button';
    reload.className = 'qw-secondary-action'; reload.textContent = 'Reload Quote Walk';
    reload.onclick = function () {
      var target = reloadTarget();
      if (target === location.href) location.reload();
      else if (target) location.replace(target);
      else { reload.disabled = true; reload.textContent = 'Reopen your original saved link'; }
    };
    notice.appendChild(reload);
  }
  function documentLoaded() {
    // Controller dependencies have finished by DOMContentLoaded. If
    // they did not signal readiness, show the existing safe reload/help path.
    finishBoot(root.classList.contains('js'));
    recoveryControl();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', documentLoaded, { once: true });
  else recoveryControl();
})();
