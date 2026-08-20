/* Capture an opaque Quote Walk return credential before analytics or other
 * third-party scripts initialize. Keep it in this browser tab only and remove
 * it from the visible URL so it cannot be copied into analytics or referrers. */
(function () {
  var STORAGE_KEY = 'bpp:qwv2:bearer';
  var TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,160}$/;

  function valid(value) {
    return TOKEN_PATTERN.test(String(value || ''));
  }

  function readStored() {
    try {
      var value = sessionStorage.getItem(STORAGE_KEY) || '';
      return valid(value) ? value : '';
    } catch (_) {
      return '';
    }
  }

  function store(value) {
    var next = valid(value) ? String(value) : '';
    try {
      if (next) {
        sessionStorage.setItem(STORAGE_KEY, next);
        return sessionStorage.getItem(STORAGE_KEY) === next ? next : '';
      }
      sessionStorage.removeItem(STORAGE_KEY);
      return '';
    } catch (_) {
      return '';
    }
  }

  var current = new URL(window.location.href);
  var supplied = current.searchParams.get('t') || '';
  var stored = valid(supplied) ? store(supplied) : readStored();
  var canRemoveSupplied = !valid(supplied) || stored === supplied;

  if (current.searchParams.has('t') && canRemoveSupplied) {
    current.searchParams.delete('t');
    try {
      history.replaceState(history.state, document.title, current.pathname + current.search + current.hash);
    } catch (_) {}
  }
})();
