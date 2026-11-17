(function () {
  'use strict';

  function privacyBlocked() {
    return navigator.globalPrivacyControl === true
      || [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack].some(function (value) {
        var dnt = String(value || '').trim().toLowerCase();
        return dnt === '1' || dnt === 'yes';
      });
  }

  function ownerTestMode() {
    if (window.__BPP_OWNER_TEST === true) return true;
    try { return sessionStorage.getItem('bpp:owner-test') === '1'; } catch (_) { return false; }
  }

  function productionEntry(continuationToken) {
    var host = String(window.location.hostname || '').toLowerCase();
    var params = new URLSearchParams(window.location.search || '');
    var verifiedToken = typeof continuationToken === 'string' ? continuationToken : verifiedContinuationToken;
    return (host === 'backuppowerpro.com' || host === 'www.backuppowerpro.com')
      && (!params.has('t') || verifiedToken && params.get('t') === verifiedToken)
      && params.get('preview') !== '1' && params.get('analytics_test') !== '1';
  }

  var trackedEventIds = Object.create(null);
  var verifiedContinuationToken = '';
  var capabilityEntryAtBoot = window.__BPP_CAPABILITY_ENTRY === true;
  var ownerBlockedAtBoot = ownerTestMode();
  var ownerReceiptAuthorizations = Object.create(null);
  var initialized = false;
  var sdkScriptNeeded = false;
  var sdkScriptInserted = false;
  var sdkScript = null;
  window.BPPMeta = {
    enabled: false,
    authorizeVerifiedOwnerReceipt: function () { return false; },
    trackQuoteWalkStarted: function () {},
    trackLead: function () {}
  };

  if (capabilityEntryAtBoot || !productionEntry() || privacyBlocked()) return;

  function capabilityAllowsTracking(continuationToken) {
    var verifiedToken = typeof continuationToken === 'string' ? continuationToken : verifiedContinuationToken;
    return !capabilityEntryAtBoot && (window.__BPP_CAPABILITY_ENTRY !== true
      || verifiedToken && window.__BPP_WALK_TOKEN === verifiedToken);
  }

  function entryAllowsTracking() {
    return capabilityAllowsTracking()
      && productionEntry() && !privacyBlocked() && !ownerTestMode();
  }

  function initialize(eventName, eventId) {
    if (!entryAllowsTracking()
        || ownerBlockedAtBoot && !ownerReceiptAuthorizations[eventName + ':' + eventId]) return false;
    if (initialized) return true;
    try {
      if (!window.fbq) {
        var fbq = window.fbq = function () {
          fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
        };
        if (!window._fbq) window._fbq = fbq;
        fbq.push = fbq;
        fbq.loaded = true;
        fbq.version = '2.0';
        fbq.queue = [];
        sdkScriptNeeded = true;
      }
      if (sdkScriptNeeded && !sdkScriptInserted) {
        if (!sdkScript) {
          sdkScript = document.createElement('script');
          sdkScript.async = true;
          sdkScript.src = 'https://connect.facebook.net/en_US/fbevents.js';
        }
        if (!sdkScript.isConnected) {
          var firstScript = document.getElementsByTagName('script')[0];
          if (firstScript && firstScript.parentNode) firstScript.parentNode.insertBefore(sdkScript, firstScript);
          else document.head.appendChild(sdkScript);
        }
        sdkScriptInserted = true;
      }
    } catch (_) { return false; }

    initialized = true;
    try {
      window.fbq('init', '1389648775800936');
      window.fbq('track', 'PageView');
      window.fbq('track', 'ViewContent', {
        content_name: 'quote-walk',
        content_category: 'generator-installation'
      });
    } catch (_) {}
    meta.enabled = true;
    return true;
  }

  var meta = window.BPPMeta = {
    enabled: false,
    authorizeVerifiedOwnerReceipt: function (receipt, ownerTest, continuationToken) {
      var verifiedToken = typeof continuationToken === 'string' && /^[a-zA-Z0-9_-]{32,160}$/.test(continuationToken) ? continuationToken : '';
      if (ownerTest !== false || !receipt || receipt.eligible !== true
          || ['QuoteWalkStarted', 'Lead'].indexOf(receipt.eventName) === -1
          || typeof receipt.eventId !== 'string' || !/^wv2-[a-zA-Z0-9-]{8,100}$/.test(receipt.eventId)
          || !capabilityAllowsTracking(verifiedToken)
          || !productionEntry(verifiedToken) || privacyBlocked() || ownerTestMode()) return false;
      if (verifiedToken) verifiedContinuationToken = verifiedToken;
      ownerReceiptAuthorizations[receipt.eventName + ':' + receipt.eventId] = true;
      return true;
    },
    trackQuoteWalkStarted: function (eventId) {
      try {
        if (typeof eventId !== 'string') return;
        var safeId = eventId;
        if (!/^wv2-[a-zA-Z0-9-]{8,100}$/.test(safeId) || trackedEventIds['start:' + safeId]) return;
        if (!initialize('QuoteWalkStarted', safeId)) return;
        window.fbq('trackCustom', 'QuoteWalkStarted', {
          content_name: 'generator-inlet-quote-walk',
          content_category: 'generator-installation'
        }, { eventID: safeId });
        trackedEventIds['start:' + safeId] = true;
      } catch (_) {}
    },
    trackLead: function (eventId) {
      try {
        if (!entryAllowsTracking()) return;
        if (typeof eventId !== 'string') return;
        var safeId = eventId;
        if (!/^wv2-[a-zA-Z0-9-]{8,100}$/.test(safeId) || trackedEventIds['lead:' + safeId]) return;
        var receiptKey = 'bpp:meta:lead:' + safeId;
        try { if (sessionStorage.getItem(receiptKey) === '1') return; } catch (_) {}
        if (!initialize('Lead', safeId)) return;
        window.fbq('track', 'Lead', {
          content_name: 'generator-inlet-quote',
          content_category: 'generator-installation'
        }, { eventID: safeId });
        trackedEventIds['lead:' + safeId] = true;
        try { sessionStorage.setItem(receiptKey, '1'); } catch (_) {}
      } catch (_) {}
    }
  };
  if (!ownerBlockedAtBoot) initialize();
})();
