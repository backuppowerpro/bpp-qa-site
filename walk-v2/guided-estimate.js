/* One current server estimate and one deliberate proposal-interest action. */
(function () {
  'use strict';
  var SCOPE = {
    installation: ['Generator connection installation', 'Installation matched to your panel, including breaker wiring, testing, and cleanup.'],
    metal_outdoor_connection_box: ['Outdoor connection box', 'A permanent, weather-rated outdoor connection for your portable generator.'],
    heavy_duty_compatible_cord: ['Matching generator cord', 'A factory-made cord matched to your generator and connection box.'],
    system_walkthrough: ['Practice before you need it', 'We show you how to connect your portable generator and select circuits within its capacity. We offer to test the system with you.'],
    panel_guide: ['Steps where you need them', 'A step-by-step sticker stays inside your panel for outages.'],
    permit_and_required_inspection: ['Permit and inspection handled', 'We handle the application, permit fee, inspection scheduling, and follow-through.'],
    one_year_workmanship_support: ['One-year workmanship support', 'If an issue comes from our installation work during the first year, we return and correct it at no charge.']
  };
  function offer(snapshot) {
    var row = (snapshot.scope_rows || []).find(function (item) { return item.key === 'one_year_workmanship_support'; });
    return row && row.offer_policy;
  }
  function scopeText(row) {
    if (row.key === 'one_year_workmanship_support' && row.offer_policy) return [row.offer_policy.guarantee_title, row.offer_policy.guarantee_text];
    return SCOPE[row.key];
  }
  function money(cents) { return '$' + Math.round(cents / 100).toLocaleString('en-US'); }
  function summary(snapshot) {
    var rows = snapshot && Array.isArray(snapshot.scope_rows) ? snapshot.scope_rows : [];
    function included(key) { return rows.filter(function (row) { return row && row.key === key; }).length === 1 && rows.some(function (row) { return row && row.key === key && row.included === true; }); }
    var parts = [];
    if (snapshot && snapshot.cord_included === true && included('heavy_duty_compatible_cord')) parts.push('matching generator cord');
    if (included('permit_and_required_inspection')) parts.push('permit and required inspection');
    if (included('system_walkthrough')) parts.push('a system walkthrough');
    if (!parts.length) return '';
    var text = parts.length === 1 ? parts[0] : parts.length === 2 ? parts.join(' and ') : parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
    return text.charAt(0).toUpperCase() + text.slice(1) + (parts.length === 1 && parts[0] !== 'permit and required inspection' ? ' is included.' : ' are included.');
  }
  function accepted(state) { return Boolean(state.accepted_range_snapshot_id && state.current_range_snapshot && state.accepted_range_snapshot_id === state.current_range_snapshot.snapshot_id); }
  function usable(snapshot) {
    if (!snapshot || snapshot.status !== 'available' || !Number.isInteger(snapshot.low_cents) || snapshot.low_cents <= 0 || !Number.isInteger(snapshot.high_cents) || snapshot.high_cents < snapshot.low_cents) return false;
    var context = snapshot.pricing_context;
    if (snapshot.calculator_version !== 'quote_walk_catalog_1' || !context || context.low_cents !== snapshot.low_cents || context.high_cents !== snapshot.high_cents || ['starting_at', 'single', 'bounded'].indexOf(context.estimate_kind) === -1) return false;
    var policy = offer(snapshot);
    if (policy && (policy.version !== 'generator-home-connection-2026-09-15' || typeof policy.guarantee_title !== 'string' || typeof policy.guarantee_text !== 'string' || policy.name !== 'BPP Generator Home Connection')) return false;
    var rows = snapshot.scope_rows || [];
    return snapshot.cord_included === true && rows.length === Object.keys(SCOPE).length && new Set(rows.map(function (row) { return row.key; })).size === rows.length && rows.every(function (row) { return SCOPE[row.key] && row.included === true; });
  }
  function element(tag, text, className) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function cards(snapshot, state, options) {
    if (!usable(snapshot)) throw new Error('invalid_estimate');
    var estimate = element('section', '', 'guided-estimate-card guided-estimate-summary');
    estimate.setAttribute('aria-label', 'Your installation estimate');
    estimate.appendChild(element('h1', 'Your installation estimate'));
    var starting = snapshot.pricing_context.estimate_kind === 'starting_at';
    var amount = (starting ? 'Starting at ' : '') + money(snapshot.low_cents) + (!starting && snapshot.high_cents !== snapshot.low_cents ? ' to ' + money(snapshot.high_cents) : '');
    var priceRow = element('div', '', 'guided-range-price-row');
    priceRow.appendChild(element('div', amount, 'guided-amount'));
    var basis = String(snapshot.pricing_basis || '').replace('A', '');
    priceRow.appendChild(element('p', basis + ' Amp recommended connection', 'guided-range-basis'));
    estimate.appendChild(priceRow);
    estimate.appendChild(element('p', 'This range reflects your answers. We’ll review your photos and confirm your price in a firm proposal. You decide whether to proceed after reviewing it.', 'guided-range-caption guided-range-explanation'));
    var openingGuide = typeof document.querySelector === 'function' && document.querySelector('[data-power-guide-opening]');
    var guideNote;
    if (openingGuide) {
      guideNote = openingGuide.cloneNode(true);
      guideNote.removeAttribute('data-power-guide-opening');
      guideNote.removeAttribute('data-power-guide-reveal');
      guideNote.classList.remove('power-guide-revealing');
      guideNote.classList.add('guided-power-guide-teaser');
    } else {
      guideNote = element('p', '', 'guided-power-guide-teaser');
      var guideLink = element('a', 'Your Guide to Home Generator Power', 'guided-link');
      guideLink.href = '/generator-guide/';
      guideNote.appendChild(guideLink);
      guideNote.appendChild(element('span', ' helps you plan your outage essentials.'));
    }
    guideNote.dataset.powerGuideTeaser = '';
    estimate.appendChild(guideNote);
    if (state.panel_inventory_status === 'multiple_unsure_main') estimate.appendChild(element('p', "Panel arrangement still needs Key's review.", 'guided-range-condition'));
    if (starting) estimate.appendChild(element('p', 'This starting estimate allows for 45 feet of wiring. Key will review your longer route and ask for measurements if needed before quoting the exact price.', 'guided-range-condition'));
    
    var scope = element('section', '', 'guided-range-included guided-range-card guided-scope-always-visible');
    scope.appendChild(element('h2', "What's included"));
    scope.appendChild(element('p', summary(snapshot), 'guided-package-summary'));
    var list = element('ul', '', 'guided-scope guided-scope-always-visible');
    var rows = {};
    snapshot.scope_rows.forEach(function (row) { rows[row.key] = row; });
    function scopeRow(key, description, artwork, title, image) {
      var item = element('li', '', 'guided-scope-row');
      item.dataset.scopeKey = key;
      var scopeImages = {
        installation: '/assets/images/work-full-install.jpg',
        system_walkthrough: '/assets/product-images/system-walkthrough.jpg',
        panel_guide: '/assets/product-images/panel-operating-guide.jpg',
        permit_and_required_inspection: '/assets/product-images/permit-inspection-photo.jpg',
        one_year_workmanship_support: '/assets/product-images/workmanship-support.jpg'
      };
      var imageSrc = image || scopeImages[key] || (artwork && (basis === '30' || basis === '50') ? '/assets/product-images/' + artwork + '-' + basis + 'amp.jpg' : null);
      if (imageSrc) {
        var img = element('img'); img.loading = 'lazy'; img.decoding = 'async'; img.width = 60; img.height = 60; img.alt = ''; img.src = imageSrc; item.appendChild(img);
      } else {
        var icon = element('span', '', 'guided-scope-icon'); icon.setAttribute('aria-hidden', 'true');
        var paths = {
          installation: '<path d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z"/>',
          panel_guide: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>',
          permit_and_required_inspection: '<path d="M7 4H4v17h16V4h-3M8 2h8v5H8zM8 14l3 3 5-6"/>',
          one_year_workmanship_support: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6zM8 12l3 3 5-6"/>'
        };
        icon.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="1.7">' + (paths[key] || paths.installation) + '</svg>'; item.appendChild(icon);
      }
      var copy = element('div'); copy.appendChild(element('strong', title || scopeText(rows[key])[0])); copy.appendChild(element('span', description || scopeText(rows[key])[1])); item.appendChild(copy); list.appendChild(item); return item;
    }
    scopeRow('metal_outdoor_connection_box', null, 'inlet');
    scopeRow('heavy_duty_compatible_cord', null, 'cord');
    scopeRow('installation');
    var transfer = scopeRow('installation', 'A panel-matched safety interlock prevents utility and generator power from feeding the panel at the same time.', null, 'Panel-matched power transfer system', '/assets/product-images/generator-interlock-closeup.webp');
    transfer.children[0].alt = 'Gold generator interlock mounted on an electrical panel';
    transfer.dataset.scopeDetail = 'power_transfer';
    scopeRow('system_walkthrough', null, null, 'System walkthrough');
    scopeRow('panel_guide', null, null, 'Step-by-step panel guide');
    scopeRow('permit_and_required_inspection');
    var guarantee = scopeRow('one_year_workmanship_support', scopeText(rows.one_year_workmanship_support)[1]); guarantee.classList.add('guided-range-guarantee');
    scope.appendChild(list);
    
    return { estimate: estimate, scope: scope };
  }
  window.BPPGuidedEstimate = { alwaysVisibleScope: true, usable: usable, cards: cards, summary: summary };
})();
