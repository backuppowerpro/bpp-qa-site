(function () {
  'use strict';

  const productionProject = ['reow', 'tzedjflwmlptupbk'].join('');
  const qaProject = 'hfatblrcwytxvijjhpal';
  const qaHost = 'qa.backuppowerpro.com';

  function blockedUrl(value) {
    try {
      const url = new URL(String(value), window.location.href);
      return url.hostname === `${productionProject}.supabase.co`
        || (url.hostname.endsWith('.backuppowerpro.com') && url.hostname !== qaHost)
        || url.hostname === 'backuppowerpro.com';
    } catch (_error) {
      return false;
    }
  }

  function stopProductionRequest(value) {
    if (blockedUrl(value)) {
      throw new Error('QA safety guard blocked a production request.');
    }
  }

  function qaMapboxResponse(value) {
    try {
      const url = new URL(String(value), window.location.href);
      if (url.hostname !== 'api.mapbox.com') return null;
      if (!url.pathname.includes('/geocoding/v5/mapbox.places/')) {
        throw new Error('QA safety guard blocked a paid Mapbox request.');
      }
      const encodedQuery = url.pathname.split('/mapbox.places/')[1]?.replace(/\.json$/, '') || '';
      const query = decodeURIComponent(encodedQuery).trim() || '123 QA Test Drive';
      const features = [
        {
          id: 'address.qa-greenville',
          place_name: `${query}, Greenville, South Carolina 29601, United States`,
          center: [-82.394, 34.8526],
          context: [
            { id: 'postcode.qa', text: '29601' },
            { id: 'place.qa', text: 'Greenville' },
            { id: 'district.qa', text: 'Greenville County' },
            { id: 'region.qa', text: 'South Carolina', short_code: 'US-SC' },
          ],
        },
        {
          id: 'address.qa-spartanburg',
          place_name: `${query}, Spartanburg, South Carolina 29306, United States`,
          center: [-81.932, 34.9496],
          context: [
            { id: 'postcode.qa', text: '29306' },
            { id: 'place.qa', text: 'Spartanburg' },
            { id: 'district.qa', text: 'Spartanburg County' },
            { id: 'region.qa', text: 'South Carolina', short_code: 'US-SC' },
          ],
        },
      ];
      return new Response(JSON.stringify({ type: 'FeatureCollection', features }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-BPP-QA-Mock': 'mapbox-geocoding' },
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('QA safety guard')) throw error;
      return null;
    }
  }

  function replaceMapboxImage(image) {
    if (!(image instanceof HTMLImageElement)) return;
    try {
      const url = new URL(image.src, window.location.href);
      const isMapbox = url.hostname === 'api.mapbox.com';
      const isQaStreetview = url.hostname === `${qaProject}.supabase.co`
        && url.pathname.includes('/functions/v1/streetview-hero');
      if (isMapbox || isQaStreetview) {
        image.src = '/assets/images/sample-home.jpg';
        image.dataset.bppQaMock = isMapbox ? 'mapbox-static-image' : 'streetview-hero';
      }
    } catch (_error) {}
  }

  function installQaMarker() {
    if (document.querySelector('[data-bpp-qa-marker]')) return;
    const marker = document.createElement('div');
    marker.dataset.bppQaMarker = 'true';
    marker.setAttribute('role', 'status');
    marker.setAttribute('aria-label', 'Quality assurance environment');
    marker.textContent = 'QA TEST';
    marker.style.cssText = [
      'position:fixed',
      'left:6px',
      'bottom:max(6px, env(safe-area-inset-bottom))',
      'z-index:2147483647',
      'padding:4px 8px',
      'border:1px solid rgba(7,27,53,.28)',
      'border-radius:999px',
      'background:#ffcc00',
      'color:#071b35',
      'box-shadow:0 2px 8px rgba(7,27,53,.18)',
      'font:800 11px/1.2 system-ui,-apple-system,sans-serif',
      'letter-spacing:.06em',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(marker);
  }

  window.__BPP_ENVIRONMENT__ = 'qa';
  document.documentElement.dataset.bppEnvironment = 'qa';
  if (!document.title.startsWith('[QA] ')) {
    document.title = `[QA] ${document.title}`;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installQaMarker, { once: true });
  } else {
    installQaMarker();
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const value = input instanceof Request ? input.url : input;
    const mapboxResponse = qaMapboxResponse(value);
    if (mapboxResponse) return Promise.resolve(mapboxResponse);
    stopProductionRequest(value);
    return originalFetch(input, init);
  };

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    stopProductionRequest(url);
    return originalXhrOpen.apply(this, arguments);
  };

  const originalSendBeacon = navigator.sendBeacon?.bind(navigator);
  if (originalSendBeacon) {
    navigator.sendBeacon = function (url, data) {
      stopProductionRequest(url);
      return originalSendBeacon(url, data);
    };
  }

  document.addEventListener('click', function (event) {
    const link = event.target.closest?.('a[href]');
    if (!link) return;

    const href = link.getAttribute('href') || '';
    if (/^(tel|sms|mailto):/i.test(href) || blockedUrl(href)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.alert('QA safety guard blocked this production contact or navigation action.');
    }
  }, true);

  document.addEventListener('submit', function (event) {
    const form = event.target;
    if (form instanceof HTMLFormElement && blockedUrl(form.action)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.alert('QA safety guard blocked a production form submission.');
    }
  }, true);

  const imageObserver = new MutationObserver(function (mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLImageElement) replaceMapboxImage(node);
        if (node instanceof Element) node.querySelectorAll('img').forEach(replaceMapboxImage);
      }
    }
  });
  imageObserver.observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('img').forEach(replaceMapboxImage);
})();
