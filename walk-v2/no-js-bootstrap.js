(function () {
  var root = document.documentElement;
  window.BPPQuoteWalkMarkReady = function () {
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
      if (target) location.replace(target);
      else { reload.disabled = true; reload.textContent = 'Reopen your original saved link'; }
    };
    notice.appendChild(reload);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', recoveryControl, { once: true });
  else recoveryControl();
})();
