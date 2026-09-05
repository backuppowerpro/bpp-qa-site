(function () {
  'use strict';

  function privacyBlocked() {
    var dnt = String(navigator.doNotTrack || window.doNotTrack || '').toLowerCase();
    return navigator.globalPrivacyControl === true || dnt === '1' || dnt === 'yes';
  }

  var trackedEventIds = Object.create(null);
  window.BPPMeta = {
    enabled: false,
    trackQuoteWalkStarted: function () {},
    trackLead: function () {}
  };

  if (window.__BPP_CAPABILITY_ENTRY === true || privacyBlocked()) return;

  if (!window.fbq) {
    var fbq = window.fbq = function () {
      fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
    };
    if (!window._fbq) window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    var firstScript = document.getElementsByTagName('script')[0];
    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
  }

  window.fbq('init', '1389648775800936');
  window.fbq('track', 'PageView');
  window.fbq('track', 'ViewContent', {
    content_name: 'quote-walk',
    content_category: 'generator-installation'
  });

  window.BPPMeta = {
    enabled: true,
    trackQuoteWalkStarted: function (eventId) {
      var safeId = String(eventId || '');
      if (!/^wv2-[a-zA-Z0-9-]{8,100}$/.test(safeId) || trackedEventIds['start:' + safeId]) return;
      trackedEventIds['start:' + safeId] = true;
      window.fbq('trackCustom', 'QuoteWalkStarted', {
        content_name: 'generator-inlet-quote-walk',
        content_category: 'generator-installation'
      }, { eventID: safeId });
    },
    trackLead: function (eventId) {
      var safeId = String(eventId || '');
      if (!/^wv2-[a-zA-Z0-9-]{8,100}$/.test(safeId) || trackedEventIds['lead:' + safeId]) return;
      trackedEventIds['lead:' + safeId] = true;
      window.fbq('track', 'Lead', {
        content_name: 'generator-inlet-quote',
        content_category: 'generator-installation'
      }, { eventID: safeId });
    }
  };
})();
