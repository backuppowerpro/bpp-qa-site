(function () {
  'use strict';
  var API = 'https://hfatblrcwytxvijjhpal.supabase.co/functions/v1/unsubscribe';
  var heading = document.getElementById('unsubscribe-heading');
  var status = document.getElementById('unsubscribe-status');
  var controls = document.getElementById('unsubscribe-controls');
  var action = document.getElementById('unsubscribe-action');
  var retry = document.getElementById('unsubscribe-retry');
  var preferences = document.getElementById('unsubscribe-preferences');
  if (!heading || !status || !controls || !action || !retry || !preferences) return;
  var tokens = new URL(window.location.href).searchParams.getAll('token');
  var token = tokens.length === 1 ? tokens[0] : '';
  var busy = false;
  var retryMethod = 'GET';
  var completed = false;

  function show(title, message, options) {
    options = options || {};
    heading.textContent = title;
    status.textContent = message;
    action.hidden = !options.action;
    action.disabled = !options.action || busy;
    retry.hidden = !options.retry;
    retry.disabled = busy;
    controls.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (options.focus) heading.focus();
  }
  function invalid(expired, moveFocus) {
    show(expired ? 'This email link has expired.' : 'This email link isn’t valid.',
      'We can’t confirm your current email preference with this link. Open a recent BPP email for a new link, or call BPP for help.', { focus: moveFocus });
    preferences.hidden = true;
  }
  function saved(already, focus) {
    completed = true;
    show(already ? 'You’re already unsubscribed.' : 'You’re unsubscribed.',
      already ? 'BPP marketing email is already turned off. You don’t need to do anything else.'
        : 'BPP tips, promotional offers and guide emails are turned off.', { focus: focus });
  }
  async function request(method, moveFocus) {
    if (busy || completed) return;
    busy = true;
    retryMethod = method;
    show(method === 'POST' ? 'Saving your choice…' : 'Checking your email link…',
      method === 'POST' ? 'Please wait while we confirm your preference was saved.' : 'This will only check your current preference.', { focus: moveFocus });
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () { if (controller) controller.abort(); reject(new Error('timeout')); }, 12000);
    });
    try {
      var response = await Promise.race([timeout, fetch(API + '?token=' + encodeURIComponent(token), {
        method: method, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        signal: controller ? controller.signal : undefined
      })]);
      var body = await Promise.race([timeout, response.json()]);
      busy = false;
      if (response.status === 400 || response.status === 404 || response.status === 410) {
        invalid(response.status === 410 || (body && body.error === 'expired_token'), moveFocus);
        return;
      }
      if (!response.ok || !body || body.ok !== true || typeof body.unsubscribed !== 'boolean'
        || (method === 'POST' && body.unsubscribed !== true)) throw new Error('unconfirmed');
      preferences.hidden = false;
      preferences.href = '/preferences/?token=' + encodeURIComponent(token);
      if (body.unsubscribed) saved(method === 'GET', moveFocus);
      else show('Stop BPP marketing emails?', 'Choose Unsubscribe to stop BPP tips, promotional offers and guide emails.', { action: true, focus: moveFocus });
    } catch (_) {
      busy = false;
      show(method === 'POST' ? 'Your choice hasn’t been confirmed.' : 'We couldn’t check this link yet.',
        method === 'POST' ? 'We couldn’t confirm your preference was saved. Try again, or call BPP for help.'
          : 'Please try again, or call BPP for help.', { retry: true, focus: moveFocus });
    } finally {
      clearTimeout(timer);
    }
  }
  action.addEventListener('click', function () { request('POST', true); });
  retry.addEventListener('click', function () { request(retryMethod, true); });
  if (!/^bpp-eo[12]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length < 100 || token.length > 1200) {
    busy = false;
    invalid(false);
    return;
  }
  request('GET');
})();
