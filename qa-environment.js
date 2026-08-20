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

  function qaOpenMapResponse(value) {
    try {
      const url = new URL(String(value), window.location.href);
      if (url.hostname === 'nominatim.openstreetmap.org') {
        const query = (url.searchParams.get('q') || 'QA test address').trim();
        const isHome = /22\s+kimbell/i.test(query);
        const seed = Array.from(query).reduce((total, character) => total + character.charCodeAt(0), 0);
        const lat = isHome ? 34.8526 : 34.80 + ((seed % 120) / 1000);
        const lon = isHome ? -82.394 : -82.48 + ((seed % 140) / 1000);
        return new Response(JSON.stringify([{
          place_id: `qa-${seed}`,
          display_name: `${query}, synthetic QA result`,
          lat: String(lat),
          lon: String(lon),
        }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-BPP-QA-Mock': 'nominatim-geocode' },
        });
      }
      if (url.hostname === 'router.project-osrm.org') {
        return new Response(JSON.stringify({
          code: 'Ok',
          routes: [{ duration: 1320, distance: 28163.4 }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-BPP-QA-Mock': 'osrm-route' },
        });
      }
    } catch (_error) {}
    return null;
  }

  function externalMapProvider(value) {
    try {
      const hostname = new URL(String(value), window.location.href).hostname;
      return hostname === 'nominatim.openstreetmap.org'
        || hostname === 'router.project-osrm.org';
    } catch (_error) {
      return false;
    }
  }

  function safeImageSource(value) {
    try {
      const url = new URL(String(value || ''), window.location.href);
      const isMapbox = url.hostname === 'api.mapbox.com';
      const isQaStreetview = url.hostname === `${qaProject}.supabase.co`
        && url.pathname.includes('/functions/v1/streetview-hero');
      if (isMapbox || isQaStreetview) {
        return {
          source: '/assets/images/sample-home.jpg',
          mock: isMapbox ? 'mapbox-static-image' : 'streetview-hero',
        };
      }
    } catch (_error) {}
    return null;
  }

  const imageSourceDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (imageSourceDescriptor?.get && imageSourceDescriptor?.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: imageSourceDescriptor.configurable,
      enumerable: imageSourceDescriptor.enumerable,
      get: imageSourceDescriptor.get,
      set(value) {
        const replacement = safeImageSource(value);
        if (replacement) this.dataset.bppQaMock = replacement.mock;
        imageSourceDescriptor.set.call(this, replacement?.source || value);
      },
    });
  }

  function replaceMapboxImage(image) {
    if (!(image instanceof HTMLImageElement)) return;
    const replacement = safeImageSource(image.src);
    if (replacement) {
      image.dataset.bppQaMock = replacement.mock;
      image.src = replacement.source;
    }
  }

  function installQaMarker() {
    if (document.querySelector('[data-bpp-qa-marker]')) return;
    const marker = document.createElement('div');
    marker.dataset.bppQaMarker = 'true';
    marker.setAttribute('role', 'status');
    marker.setAttribute('aria-label', 'Quality assurance environment');
    marker.textContent = 'QA TEST';
    marker.style.cssText = [
      'position:sticky',
      'top:0',
      'z-index:2147483647',
      'width:max-content',
      'margin:0 auto',
      'padding:4px 8px',
      'border:1px solid rgba(7,27,53,.28)',
      'border-radius:0 0 9px 9px',
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
    const openMapResponse = qaOpenMapResponse(value);
    if (openMapResponse) return Promise.resolve(openMapResponse);
    stopProductionRequest(value);
    return originalFetch(input, init);
  };

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    stopProductionRequest(url);
    if (externalMapProvider(url)) {
      throw new Error('QA safety guard blocked an external map-provider request.');
    }
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
