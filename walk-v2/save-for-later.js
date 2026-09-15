/* A link-saving control only. Never creates a lead, accepts a range or sends a message. */
(function () {
  'use strict';
  var PUBLIC_START = 'https://qa.backuppowerpro.com/walk-v2/';
  var TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,160}$/;
  var dialog;
  var opener;
  var dialogSession = 0;
  var sharePending = false;
  var controls = [];
  function refreshControls() {
    controls = controls.filter(function (control) { return control.root.isConnected; });
    controls.forEach(function (control) { control.refresh(); });
  }
  function report(event, screen) {
    if (window.WALK) WALK.ph(event, { screen: screen || 'unknown' });
  }
  function getDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'qw-save-dialog';
    dialog.setAttribute('aria-labelledby', 'qw-save-title');
    dialog.innerHTML = '<h2 id="qw-save-title">Save for later</h2><p data-save-explanation></p><label for="qw-save-link">Your link</label><input id="qw-save-link" type="text" readonly autocomplete="off" spellcheck="false"><p data-copy-message role="status"></p><button type="button" data-save-copy>Copy link</button><button type="button" data-save-close>Close</button>';
    document.body.appendChild(dialog);
    function close() {
      if (typeof dialog.close === 'function') dialog.close();
      else { dialog.hidden = true; dialog.removeAttribute('open'); }
      if (opener) opener.focus();
    }
    dialog.querySelector('[data-save-close]').addEventListener('click', close);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      var fields = Array.from(dialog.querySelectorAll('input, button'));
      var first = fields[0], last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    return dialog;
  }
  function copyLink(state, url, onCopied) {
    var writing;
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard_unavailable');
      writing = navigator.clipboard.writeText(url);
    } catch (_) { writing = Promise.reject(new Error('clipboard_unavailable')); }
    return Promise.resolve(writing).then(function () {
      onCopied();
      report('copy_link_succeeded', state.screen);
      return true;
    }, function () {
      report('copy_link_failed', state.screen);
      return false;
    });
  }
  function copyFallback(button, state, url, copying, copyAgain) {
    var modal = getDialog();
    var session = ++dialogSession;
    opener = button;
    var input = modal.querySelector('input');
    var message = modal.querySelector('[data-copy-message]');
    var copyButton = modal.querySelector('[data-save-copy]');
    input.value = url;
    modal.querySelector('[data-save-explanation]').textContent = state.mode === 'protected'
      ? 'Keep this private link to return to your saved request. Anyone with the link can open it.'
      : 'Keep this link somewhere you can find it when you are home. You will start with your generator outlet.';
    message.textContent = '';
    copyButton.textContent = 'Copy link';
    function result(copied) {
      if (session !== dialogSession || !modal.open) return;
      copyButton.textContent = copied ? 'Copied' : 'Copy link';
      message.textContent = copied ? 'Link copied' : 'Automatic copying is unavailable. Select and copy this link.';
      if (!copied) { input.focus(); input.select(); input.setSelectionRange(0, input.value.length); }
    }
    var lastCopy = 0;
    function watch(promise) {
      var attempt = ++lastCopy;
      copyButton.textContent = 'Copy link'; message.textContent = '';
      promise.then(function (copied) { if (attempt === lastCopy) result(copied); });
    }
    copyButton.onclick = function () { watch(copyAgain()); };
    if (typeof modal.showModal === 'function') { if (!modal.open) modal.showModal(); }
    else { modal.hidden = false; modal.setAttribute('open', ''); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); }
    copyButton.focus();
    watch(copying);
  }
  function preparedLink(state) {
    if (!state || state.pending || state.mode === 'unavailable') return '';
    if (state.mode === 'public') return PUBLIC_START;
    if (state.mode === 'protected' && state.verified === true && TOKEN_PATTERN.test(String(state.token || ''))) {
      return PUBLIC_START + '?t=' + encodeURIComponent(state.token);
    }
    return '';
  }
  window.BPPSaveForLater = {
    publicStartURL: PUBLIC_START,
    preparedLink: preparedLink,
    mount: function (root, getState) {
      var button = root.querySelector('[data-save-button]');
      var hint = root.querySelector('[data-save-hint]');
      var status = root.querySelector('[data-save-status]');
      var label = document.createElement('span');
      label.textContent = 'Save for later';
      Array.from(button.childNodes).forEach(function (node) { if (node.nodeType === 3) node.remove(); });
      button.appendChild(label);
      button.setAttribute('aria-live', 'polite');
      var copiedURL = '';
      var copyAttempt = 0;
      function refresh() {
        var state = getState();
        var url = preparedLink(state);
        button.disabled = !url;
        if (copiedURL !== url) copiedURL = '';
        label.textContent = copiedURL ? 'Copied' : 'Save for later';
        hint.textContent = state.pending ? "We're checking whether your details saved."
          : state.mode === 'protected' ? (state.hint || 'Keep your private link to return to your saved request.')
          : state.mode === 'public' ? 'Not near your generator? Save this link so you can start when you are home.'
          : 'Load your saved request to prepare its return link.';
      }
      button.type = 'button';
      button.addEventListener('click', function (event) {
        event.preventDefault();
        var state = getState();
        var url = preparedLink(state);
        if (!url) { refresh(); return; }
        status.textContent = '';
        report('save_for_later_opened', state.screen);
        function startCopy() {
          var attempt = ++copyAttempt;
          copiedURL = ''; refresh();
          return copyLink(state, url, function () {
            if (attempt === copyAttempt && preparedLink(getState()) === url) { copiedURL = url; refresh(); }
          });
        }
        // Start both APIs during the tap, without awaiting clipboard permission.
        var copying = startCopy();
        if (sharePending || typeof navigator.share !== 'function') {
          copyFallback(button, state, url, copying, startCopy);
          if (!sharePending) report('share_cancelled_or_unavailable', state.screen);
          return;
        }
        var shareAttempt = copyAttempt;
        function failedShare() {
          report('share_failed', state.screen);
          if (shareAttempt === copyAttempt && preparedLink(getState()) === url && button.isConnected && button.getClientRects().length) {
            copyFallback(button, state, url, copying, startCopy);
          }
        }
        sharePending = true;
        refreshControls();
        try {
          var sharing = navigator.share({ title: 'Backup Power Pro Quote Walk', url: url });
          report('share_invoked', state.screen);
          Promise.resolve(sharing).then(function () {
            // Share completion alone is never reported as a successful copy.
          }, function (error) {
            if (error && error.name === 'AbortError') report('share_cancelled_or_unavailable', state.screen);
            else failedShare();
          }).finally(function () { sharePending = false; refreshControls(); });
        } catch (_) {
          sharePending = false; refreshControls();
          failedShare();
        }
      });
      controls.push({ root: root, refresh: refresh });
      refresh();
      return { refresh: refresh };
    }
  };
})();
