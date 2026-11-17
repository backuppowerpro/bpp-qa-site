/* Guide engagement is a reading signal. Inquiry/booking authority remains server-owned. */
(function () {
  'use strict';
  function capture(event, properties) {
    try { if (window.BPPAnalytics) window.BPPAnalytics.capture(event, properties || {}); } catch (_) {}
  }
  capture('power_guide_viewed');
  document.querySelectorAll('[data-guide-download]').forEach(function (link) {
    link.addEventListener('click', function () {
      var edition = link.getAttribute('data-guide-download');
      if (edition === 'color' || edition === 'bw') capture('power_guide_download_clicked', { edition: edition });
    });
  });
})();
