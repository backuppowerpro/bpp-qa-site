/* Existing Quote Walk contact and address controller, extracted for the guided order.
 * The host owns identity, frozen submission recovery and navigation. */
(function () {
  'use strict';
  var entryURL = new URL(window.location.href);
  entryURL.searchParams.delete('t');
  var marketingEntryTime = new Date().toISOString();
  /* channel attribution for the first-party event stream + payload.leadChannel.
     Server deriveLeadChannel also reads ?src= / fbclid / gclid from pageUrl
     (audit 2026-07-13). Keep client labels in the contacts whitelist where
     possible: meta, google, organic, local, neighbor, get-quote, direct. */
  function attribution() {
    var p = new URLSearchParams(entryURL.search);
    var us = (p.get('utm_source') || '').toLowerCase();
    var ref = (document.referrer || '').toLowerCase();
    var src = (p.get('src') || '').toLowerCase();
    var ch = 'direct';
    if (p.get('fbclid') || us === 'meta' || us === 'facebook' || us === 'instagram' || src === 'meta' || src === 'lp') ch = 'meta';
    else if (p.get('gclid') || p.get('gbraid') || p.get('wbraid') || (us === 'google' && /cpc|ppc|paid/.test((p.get('utm_medium') || '').toLowerCase())) || src === 'google') ch = 'google';
    else if (us) ch = (/google|bing|yahoo|duckduckgo/.test(us) ? 'organic' : (/fb|facebook|insta|meta|tiktok|linkedin|youtube|snap/.test(us) ? 'social' : 'referral'));
    /* src=city_<slug> -> local (matches /city/ path channel on the server).
       NOTE: never write a glob path containing star-slash inside this comment; that exact
       sequence closes the comment and killed this whole script block Jul 4-11 2026. */
    else if (/^city_/.test(src) || src === 'city-hub' || src.indexOf('city') === 0) ch = 'local';
    else if (src === 'quote') ch = 'get-quote';
    else if (src === 'neighbor') ch = 'neighbor';
    /* src=home|guide|learn|service: internal hop; contacts taxonomy = direct
       (local events still get walk_entry / walk_src properties separately). */
    else if (src) ch = 'direct';
    else if (/google\.|bing\.|duckduckgo\.|yahoo\./.test(ref)) ch = 'organic';
    else if (ref && ref.indexOf(location.hostname) === -1) ch = 'referral';
    return { channel: ch, source: p.get('utm_source') || '', medium: p.get('utm_medium') || '', campaign: p.get('utm_campaign') || '' };
  }

  function currentMarketingTouch() {
    var p = new URLSearchParams(entryURL.search);
    var attr = attribution();
    return {
      occurredAt: marketingEntryTime,
      sourceUrl: entryURL.href,
      referrer: document.referrer || '',
      channel: attr.channel,
      utmSource: p.get('utm_source') || '',
      utmMedium: p.get('utm_medium') || '',
      utmCampaign: p.get('utm_campaign') || '',
      utmContent: p.get('utm_content') || '',
      utmId: p.get('utm_id') || '',
      campaignId: p.get('utm_id') || p.get('campaign_id') || '',
      adsetId: p.get('utm_adset_id') || p.get('adset_id') || '',
      adId: p.get('utm_ad_id') || p.get('ad_id') || '',
      placement: p.get('utm_placement') || p.get('placement') || '',
      siteSourceName: p.get('utm_site_source') || p.get('site_source_name') || '',
      fbclid: p.get('fbclid') || '',
      gclid: p.get('gclid') || '',
      gbraid: p.get('gbraid') || '',
      wbraid: p.get('wbraid') || '',
      fbp: (document.cookie.match(/(?:^|;\s*)_fbp=([^;]*)/) || [])[1] || '',
      fbc: (document.cookie.match(/(?:^|;\s*)_fbc=([^;]*)/) || [])[1] || ''
    };
  }

  function savedMarketingTouch(key) {
    try {
      var touch = JSON.parse(localStorage.getItem(key) || 'null');
      var age = Date.now() - new Date(touch && touch.occurredAt).getTime();
      var url = new URL(touch.sourceUrl);
      if (age >= 0 && age <= 90 * 24 * 60 * 60 * 1000
          && ['backuppowerpro.com', 'www.backuppowerpro.com'].indexOf(url.hostname) !== -1
          && !url.searchParams.has('t') && !url.searchParams.has('analytics_test')
          && !url.searchParams.has('preview')) return touch;
    } catch (_) {}
    return null;
  }

  function savedMarketingTouches() {
    var host = String(location.hostname || '').toLowerCase();
    var params = new URLSearchParams(entryURL.search);
    var dnt = String(navigator.doNotTrack || window.doNotTrack || '').toLowerCase();
    // Attribution cannot turn a private return, QA visit, or privacy opt-out
    // into an advertising touch. Keep contact capture independent of storage.
    if (window.__BPP_CAPABILITY_ENTRY || window.__BPP_OWNER_TEST
        || (host !== 'backuppowerpro.com' && host !== 'www.backuppowerpro.com')
        || navigator.globalPrivacyControl === true || dnt === '1' || dnt === 'yes'
        || params.get('preview') === '1' || params.get('analytics_test') === '1') {
      return { first: null, current: null };
    }
    try { if (sessionStorage.getItem('bpp:owner-test') === '1') return { first: null, current: null }; } catch (_) {}
    var current = currentMarketingTouch();
    var first = savedMarketingTouch('bpp_meta_first_touch');
    var latest = savedMarketingTouch('bpp_meta_latest_touch');
    // A clean saved-link return keeps the last known marketing touch, including
    // its original timestamp and the existing seven-day channel window. A new
    // non-direct visit replaces it. This is CRM
    // attribution evidence, not a claim about Meta's ad attribution window.
    if (current.channel === 'direct' && latest
        && Date.now() - new Date(latest.occurredAt).getTime() <= 7 * 24 * 60 * 60 * 1000
        && ['meta', 'google', 'organic', 'social', 'referral', 'local', 'neighbor', 'get-quote'].indexOf(latest.channel) !== -1) {
      current = Object.assign({}, latest, { fbp: current.fbp || latest.fbp || '' });
    }
    if (!first) {
      first = current;
      try { localStorage.setItem('bpp_meta_first_touch', JSON.stringify(first)); } catch (_) {}
    }
    try { localStorage.setItem('bpp_meta_latest_touch', JSON.stringify(current)); } catch (_) {}
    return { first: first, current: current };
  }

  // Capture the public ad entry before any questions or contact form mount.
  // The clean Save for later link intentionally contains no tracking identity.
  savedMarketingTouches();

  window.BPPContactDetails = {
    mount: function (main, options) {
  options = options || {};
  var entryURL = new URL(options.entryURL || window.location.href);
  var nameIn = main.querySelector('[data-f="name"]');
  var phoneIn = main.querySelector('[data-f="phone"]');
  var addrIn = main.querySelector('[data-f="addr"]');
  var resumeT = options.token || '';
  var editDetails = Boolean(resumeT);
  var areaBoundary = false;
  function persistDraft() {} // Ordinary anonymous fields intentionally remain only in memory.
  var activeOption = -1;
  var addressAnnouncement = main.querySelector('[data-address-announcement]');
  var phoneField = main.querySelector('[data-phone-field]');
  var nameField = nameIn ? nameIn.closest('.field') : null;
  var addrField = main.querySelector('[data-addr-field]');
  var drop = main.querySelector('[data-addr-drop]');
  var cta = main.querySelector('[data-cta]');
  var ctaLabelEl = cta.querySelector('[data-cta-label]');
  var ctaHint = main.querySelector('[data-cta-hint]');
  var processCopy = main.querySelector('.hero .process');
  var unconfirmedAddressNote = main.querySelector('[data-unconfirmed-address]');
  var submitting = false;
  var okSvg = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.6 2.6L10 3.5"></path></svg>';
  function ensureOkMark(field) {
    if (!field || field.querySelector('.ok-mark')) return;
    var m = document.createElement('span');
    m.className = 'ok-mark';
    m.setAttribute('aria-hidden', 'true');
    m.innerHTML = okSvg;
    field.appendChild(m);
  }
  [nameField, phoneField, addrField].forEach(ensureOkMark);
  function paintFieldOk() {
    if (nameField) nameField.classList.toggle('ok', nameIn.value.trim().length > 0);
    if (phoneField) phoneField.classList.toggle('ok', phoneValid(phoneIn.value));
    if (addrField) addrField.classList.toggle('ok', addrOk());
  }
  /* funnel step events, each at most once per visit (drop-off tracking) */
  var fired = {};
  function once(event, props) { if (fired[event]) return; fired[event] = true; WALK.ph(event, props); }

  /* Address suggestions use the same-site lookup. A selected result fills
     structured geography, while the explicit escape still lets a real address
     continue if the provider cannot find it. */
  var addrTimer = null, addrLookupSequence = 0, addrPicked = false, addrSel = { city: '', state: '', zip: '' }, lastAddrPreds = [];
  var lastDropSignature = '', viewportFitTimer = null;
  var lastAddressInputMethod = 'unknown';
  var lastAddressLookupTrigger = 'unknown';
  /* Soft-block (Key 2026-07-21): the Next gate requires a VALIDATED address, a real
     picked suggestion OR the explicit "not listed" escape, not just >=6 chars, so a
     lazy fake free-text address can no longer pass. addrValidatedValue pins the exact
     string that was validated; editing it re-invalidates. addrUnverified marks an
     escape pick so the lead can be flagged for review. */
  var addrValidated = false, addrValidatedValue = '', addrUnverified = false;
  var addrSvg = '<svg viewBox="0 0 16 16"><path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14z"></path><circle cx="8" cy="6.5" r="1.6"></circle></svg>';
  var addrEditSvg = '<svg viewBox="0 0 16 16"><path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"></path></svg>';
  function fitDropToViewport() {
    if (!drop.classList.contains('open')) return;
    var viewport = window.visualViewport;
    var viewportTop = viewport ? viewport.offsetTop : 0;
    var viewportBottom = viewportTop + (viewport ? viewport.height : window.innerHeight);
    var anchor = addrField.getBoundingClientRect();
    var below = Math.floor(viewportBottom - anchor.bottom - 6 - 10);
    var above = Math.floor(anchor.top - viewportTop - 6 - 10);
    var firstOption = drop.querySelector('.addr-opt');
    var listStyle = window.getComputedStyle(drop);
    var minimumHeight = (firstOption ? firstOption.getBoundingClientRect().height : 0)
      + parseFloat(listStyle.paddingTop || '0') + parseFloat(listStyle.paddingBottom || '0');
    // Use the rendered option and responsive padding, not a stale CSS minimum.
    // Flip the existing dropdown above its field when there is no room below;
    // do not scroll the page or move the typing caret to manufacture space.
    var opensAbove = below < Math.ceil(minimumHeight) && above > below;
    drop.style.top = opensAbove ? 'auto' : 'calc(100% + 6px)';
    drop.style.bottom = opensAbove ? 'calc(100% + 6px)' : 'auto';
    var nextHeight = Math.max(0, opensAbove ? above : below) + 'px';
    if (drop.style.maxHeight !== nextHeight) drop.style.maxHeight = nextHeight;
  }
  function scheduleDropFit() {
    if (viewportFitTimer) clearTimeout(viewportFitTimer);
    viewportFitTimer = setTimeout(fitDropToViewport, 120);
  }
  function closeDrop() {
    if (viewportFitTimer) clearTimeout(viewportFitTimer);
    viewportFitTimer = null;
    lastDropSignature = '';
    activeOption = -1;
    addrIn.setAttribute('aria-expanded', 'false');
    addrIn.removeAttribute('aria-activedescendant');
    drop.classList.remove('open'); drop.innerHTML = ''; drop.style.maxHeight = ''; drop.style.top = ''; drop.style.bottom = '';
  }
  function renderDrop(preds) {
    lastAddrPreds = preds || [];
    var q = addrIn.value.trim();
    var showEscape = addressLooksComplete();
    var nextSignature = (preds || []).map(function (p) {
      return String(p && (p.id || p.description) || '');
    }).join('|') + '|escape:' + String(showEscape);
    if (drop.classList.contains('open') && nextSignature === lastDropSignature) {
      scheduleDropFit();
      return;
    }
    var html = (preds || []).map(function (p) {
      var d = String(p.description || '');
      return '<button type="button" class="addr-opt" data-addr-pick="' + encodeURIComponent(d) + '">' +
        addrSvg + '<span class="lines"><span class="a1"></span><span class="a2"></span></span></button>';
    }).join('');
    /* Deliberate escape (soft-block): a real address Mapbox does not know still gets
       through, but only by an explicit tap, and it rides as flagged. Shown once the
       typed address looks complete, and it is the ONLY row when Mapbox returns nothing. */
    if (showEscape) {
      html += '<button type="button" class="addr-opt addr-escape" data-addr-escape="1">' +
        addrEditSvg + '<span class="lines"><span class="a1">My address isn\'t listed</span>' +
        '<span class="a2">Use what I typed</span></span></button>';
    }
    if (!html) { closeDrop(); return; }
    lastDropSignature = nextSignature;
    drop.innerHTML = html;
    /* set suggestion text via textContent (never innerHTML on the address string) */
    var opts = drop.querySelectorAll('.addr-opt[data-addr-pick]');
    (preds || []).forEach(function (p, k) {
      if (!opts[k]) return;
      var d = String(p.description || ''); var i = d.indexOf(',');
      opts[k].querySelector('.a1').textContent = i > -1 ? d.slice(0, i) : d;
      opts[k].querySelector('.a2').textContent = i > -1 ? d.slice(i + 1).trim() : '';
    });
    activeOption = -1;
    drop.querySelectorAll('.addr-opt').forEach(function (option, index) {
      option.id = 'guided-address-option-' + index;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.tabIndex = -1;
    });
    addrIn.setAttribute('aria-expanded', 'true');
    addressAnnouncement.textContent = String(drop.querySelectorAll('.addr-opt').length) + ' address options available. Use the arrow keys to choose.';
    drop.classList.add('open');
    requestAnimationFrame(fitDropToViewport);
  }
  function invalidateAddressEdit() {
    if (addrPicked) { addrPicked = false; return; }
    addrSel = { city: '', state: '', zip: '' }; // editing after a pick invalidates the structured parts
    addrValidated = false; addrUnverified = false; // and re-locks Next until a fresh pick
  }
  function canonicalStreetLine(value) {
    return String(value || '').split(',')[0].toLowerCase()
      .replace(/[^a-z0-9-]+/g, ' ')
      .replace(/\b(north|n)\b/g, 'n')
      .replace(/\b(south|s)\b/g, 's')
      .replace(/\b(east|e)\b/g, 'e')
      .replace(/\b(west|w)\b/g, 'w')
      .replace(/\b(northeast|ne)\b/g, 'ne')
      .replace(/\b(northwest|nw)\b/g, 'nw')
      .replace(/\b(southeast|se)\b/g, 'se')
      .replace(/\b(southwest|sw)\b/g, 'sw')
      .replace(/\b(street|st)\b/g, 'st')
      .replace(/\b(road|rd)\b/g, 'rd')
      .replace(/\b(avenue|ave)\b/g, 'ave')
      .replace(/\b(court|ct)\b/g, 'ct')
      .replace(/\b(lane|ln)\b/g, 'ln')
      .replace(/\b(drive|dr)\b/g, 'dr')
      .replace(/\b(circle|cir)\b/g, 'cir')
      .replace(/\b(boulevard|blvd)\b/g, 'blvd')
      .replace(/\b(highway|hwy)\b/g, 'hwy')
      .replace(/\b(place|pl)\b/g, 'pl')
      .replace(/\b(parkway|pkwy)\b/g, 'pkwy')
      .replace(/\b(terrace|ter)\b/g, 'ter')
      .replace(/\s+/g, ' ').trim();
  }
  /* Chrome can concatenate multiple saved street lines into this one-line field.
     Collapse only a repeated house-number pair whose two street names are equivalent,
     so ordinary apartment, unit, rural-route, and hyphenated addresses stay untouched. */
  function normalizeBrowserStreetAddress(value) {
    var trimmed = String(value || '').replace(/\s+/g, ' ').trim();
    var repeated = trimmed.match(/^(\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?)\s+(.+?)\s+\1\s+(.+)$/i);
    if (!repeated) return trimmed;
    var first = repeated[1] + ' ' + repeated[2];
    var second = repeated[1] + ' ' + repeated[3];
    return canonicalStreetLine(first) === canonicalStreetLine(second) ? second : trimmed;
  }
  function cleanAddressLookupValue(value) {
    var cleaned = String(value || '')
      .replace(/[\r\n\t|;]+/g, ', ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/(?:,\s*){2,}/g, ', ')
      .replace(/^(?:(?:home|work|shipping|billing|mailing|delivery|residential|residence|primary|current|street|contact|other)(?:\s*address)?|my\s*address|address(?:\s*line\s*[12])?)\s*(?:(?:[:=,-]\s*)|(?=\d))/i, '')
      .replace(/^,\s*|,\s*$/g, '')
      .trim();
    return normalizeBrowserStreetAddress(cleaned);
  }
  function addressLookupQueries(value) {
    var full = cleanAddressLookupValue(value);
    var queries = [];
    function add(query) {
      var cleaned = String(query || '').trim();
      if (!cleaned) return;
      var key = cleaned.toLowerCase();
      for (var i = 0; i < queries.length; i++) {
        if (queries[i].toLowerCase() === key) return;
      }
      queries.push(cleaned);
    }
    add(full);
    var street = full.split(',')[0].trim();
    if (/^\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+\S/.test(street)) add(street);
    return queries.slice(0, 3);
  }
  function mergeAddressPredictions(current, incoming) {
    var merged = (current || []).slice();
    (incoming || []).forEach(function (prediction) {
      var key = String(prediction && (prediction.id || prediction.description) || '').toLowerCase();
      var duplicate = merged.some(function (existing) {
        return String(existing && (existing.id || existing.description) || '').toLowerCase() === key;
      });
      if (!duplicate) merged.push(prediction);
    });
    return merged;
  }
  function matchingExactPrediction(query, predictions) {
    /* Safari can label saved-contact autofill as ordinary insertText. A unique exact
       street match is safe to accept for every input method. Ambiguous same-street
       results still stay visible for the customer to choose. */
    var wanted = canonicalStreetLine(query);
    if (!/^\d/.test(wanted)) return null;
    var queryParts = String(query || '').split(',');
    var localityTokens = queryParts.slice(1).join(' ').toLowerCase()
      .replace(/[^a-z0-9-]+/g, ' ').trim().split(/\s+/).filter(Boolean)
      .filter(function (token) { return ['us', 'usa', 'united', 'states'].indexOf(token) === -1; });
    var matches = [];
    for (var i = 0; i < (predictions || []).length; i++) {
      if (canonicalStreetLine(predictions[i].description) === wanted) {
        matches.push({ prediction: predictions[i], rank: i + 1 });
      }
    }
    if (localityTokens.length) {
      matches = matches.filter(function (entry) {
        var prediction = entry.prediction || {};
        var locationText = [
          String(prediction.description || '').split(',').slice(1).join(' '),
          prediction.city || '', prediction.state || '', prediction.zip || ''
        ].join(' ').toLowerCase().replace(/[^a-z0-9-]+/g, ' ');
        var predictionTokens = locationText.split(/\s+/).filter(Boolean);
        return localityTokens.every(function (token) { return predictionTokens.indexOf(token) !== -1; });
      });
    }
    return matches.length === 1 ? matches[0] : null;
  }
  function acceptAddressPrediction(match, selectedRank) {
    if (!match) return;
    var picked = String(match.description || '');
    addrPicked = true;
    addrIn.value = picked;
    addrSel = { city: match.city || '', state: match.state || '', zip: match.zip || '' };
    addrValidated = true; addrUnverified = false; addrValidatedValue = picked;
    lastSyncedAddress = picked;
    persistDraft();
    var serviceAreaGroup = ['Greenville', 'Spartanburg', 'Pickens'].indexOf(match.county || '') !== -1
      ? 'authorized'
      : (String(match.state || '').toUpperCase() === 'SC'
        ? 'other_sc'
        : (match.state ? 'out_of_state' : 'unknown'));
    WALK.ph('walk_v2_address_suggestion_selected', {
      rank: selectedRank || 1,
      service_area_group: serviceAreaGroup,
      input_method: lastAddressInputMethod
    });
    closeDrop(); refresh();
  }
  function suggest(trigger) {
    invalidateAddressEdit();
    var q = addrIn.value.trim();
    var matchQuery = cleanAddressLookupValue(q);
    var lookupQueries = addressLookupQueries(q);
    var lookupSequence = ++addrLookupSequence;
    lastAddressLookupTrigger = trigger || 'unknown';
    if (addrTimer) clearTimeout(addrTimer);
    if (q.length < 3 || !lookupQueries.length) { closeDrop(); return; }
    var lookupDelay = trigger === 'typing' && lastAddressInputMethod === 'typed' ? 900 : 120;
    addrTimer = setTimeout(function () {
      function lookupNext(index, predictions) {
        if (index >= lookupQueries.length) return Promise.resolve(predictions);
        return WALK.addrSuggest(lookupQueries[index], 8000, {
          input_method: lastAddressInputMethod,
          trigger: index === 0 ? lastAddressLookupTrigger : 'formatted_address_recovery'
        }).then(function (nextPredictions) {
          var merged = mergeAddressPredictions(predictions, nextPredictions);
          if (matchingExactPrediction(matchQuery, merged)) return merged;
          return lookupNext(index + 1, merged);
        });
      }
      lookupNext(0, []).then(function (predictions) {
        if (lookupSequence !== addrLookupSequence || addrIn.value.trim() !== q) return;
        var exactMatch = matchingExactPrediction(matchQuery, predictions);
        /* Never rewrite a field while a person is typing. On iPhone Safari that
           moves the caret, scrolls the viewport, and can append later keystrokes
           to the provider's longer address. Browser autofill and paste are one
           complete replacement, so a unique exact result is safe to accept. */
        if (exactMatch && lastAddressInputMethod !== 'typed') {
          acceptAddressPrediction(exactMatch.prediction, exactMatch.rank);
          return;
        }
        renderDrop(predictions);
      }).catch(function () {
        if (lookupSequence !== addrLookupSequence || addrIn.value.trim() !== q) return;
        renderDrop([]);
        addressAnnouncement.textContent = "Address suggestions could not load. Use My address isn't listed if your address is complete.";
      });
    }, lookupDelay);
  }
  drop.addEventListener('click', function (e) {
    /* explicit "my address isn't listed" escape: validate the typed text, but flag it */
    var esc = e.target.closest('[data-addr-escape]');
    if (esc) {
      addrPicked = true; addrValidated = true; addrUnverified = true;
      addrValidatedValue = addrIn.value.trim();
      addrSel = { city: '', state: '', zip: '' };
      WALK.ph('walk_v2_address_fallback_used', {
        reason: 'manual_escape',
        input_method: lastAddressInputMethod
      });
      closeDrop(); refresh();
      return;
    }
    var b = e.target.closest('[data-addr-pick]'); if (!b) return;
    var picked = decodeURIComponent(b.getAttribute('data-addr-pick'));
    /* copy the picked prediction's structured parts so the lead carries city/state/zip */
    var match = null;
    for (var mi = 0; mi < lastAddrPreds.length; mi++) {
      if (String(lastAddrPreds[mi].description) === picked) { match = lastAddrPreds[mi]; break; }
    }
    var selectedRank = Array.prototype.indexOf.call(drop.querySelectorAll('[data-addr-pick]'), b) + 1;
    acceptAddressPrediction(match, selectedRank);
  });
  addrIn.addEventListener('blur', function () {
    syncBrowserFilledValues('blur');
    setTimeout(function () { if (!drop.contains(document.activeElement)) closeDrop(); }, 150);
  });
  /* Re-open the list on focus when the address is typed but not yet validated, so
     "Pick your address from the list" is never a dead end with no visible list. */
  addrIn.addEventListener('focus', function () {
    setTimeout(function () {
      syncBrowserFilledValues('focus');
      if (!addrOk() && addrIn.value.trim().length >= 3) suggest('focus');
    }, 0);
  });
  window.addEventListener('resize', scheduleDropFit);
  window.addEventListener('scroll', scheduleDropFit, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleDropFit);
    window.visualViewport.addEventListener('scroll', scheduleDropFit, { passive: true });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrop(); });

  function digits(v) { return (v || '').replace(/\D/g, ''); }
  /* the 10 national digits. A US number is 10 digits; a leading 1 is the country code
     (no US area code starts with 1), so strip it BEFORE taking 10. Without this, autofill
     or a paste of "+1 864 555 0192" kept the 1 and chopped the real last digit, recording
     (186) 455-5019 instead of (864) 555-0192. */
  function natDigits(v) { var d = digits(v); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.slice(0, 10); }
  function phoneValid(v) { var d = digits(v); return d.length === 10 || (d.length === 11 && d[0] === '1'); }
  function formatPhone(v) {
    var d = natDigits(v);
    if (d.length > 6) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    if (d.length > 3) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
    return d;
  }
  /* Continue unlocks only after a provider result is selected or the customer taps the
     explicit unmatched-address option. Looking complete is not the same as confirmed. */
  function addrOk() { return addrValidated && addrIn.value.trim() === addrValidatedValue; }
  function addressLooksComplete() {
    var value = cleanAddressLookupValue(addrIn.value);
    if (value.length < 8 || !/^\d+[A-Za-z]?(?:-[A-Za-z0-9]+)?\s+\S/.test(value)) return false;
    var streetLine = value.split(',')[0].toLowerCase().replace(/[.]/g, '').trim();
    var streetSuffix = /\b(?:aly|alley|ave|avenue|blvd|boulevard|cir|circle|ct|court|dr|drive|expy|expressway|hwy|highway|ln|lane|pkwy|parkway|pl|place|rd|road|route|rte|st|street|ter|terrace|trl|trail|way)(?:\s+(?:apt|apartment|unit|suite|ste|lot|floor|fl|#)\s*[a-z0-9-]+)?$/i;
    var includesPostalLocality = value.indexOf(',') !== -1 && /\b\d{5}(?:-\d{4})?\b/.test(value);
    return streetSuffix.test(streetLine) || includesPostalLocality;
  }
  function addrLooksReady() {
    return addrOk();
  }
  function part1Done() {
    return nameIn.value.trim().length > 0 && phoneValid(phoneIn.value) && addrLooksReady();
  }
  /* names the one thing still missing so the disabled gold button is never a silent dead
     end. A disabled button cannot be tapped for feedback, so the hint is always-visible once
     they have begun. Ruth (78) fills her name, stumbles on the phone, and now sees why. */
  function missingMsg() {
    if (!nameIn.value.trim()) return 'Add your name to continue.';
    if (!phoneValid(phoneIn.value)) return 'Enter a 10-digit phone number.';
    if (addrIn.value.trim().length < 3) return 'Add your address to continue.';
    if (!addrLooksReady()) return "Choose your address, or use My address isn't listed.";;
    return '';
  }
  function sizeAddrBox() {
    if (!addrIn) return;
    addrIn.style.height = '52px';
    var next = addrIn.scrollHeight;
    if (next < 52) next = 52;
    addrIn.style.height = next + 'px';
  }
  function refresh() {
    if (areaBoundary) {
      if (ctaHint) {
        ctaHint.textContent = '';
        ctaHint.style.display = 'none';
      }
      return;
    }
    // Dismiss any stale "didn't go through" error once the user edits/retries.
    if (!submitting) {
      var _se = main.querySelector('[data-submit-error]');
      if (
        _se
        && !_se.hasAttribute('data-return-recovery')
        && !_se.hasAttribute('data-area-boundary')
        && _se.style.display !== 'none'
      ) _se.style.display = 'none';
    }
    paintFieldOk();
    sizeAddrBox();
    ctaLabelEl.textContent = options.submitLabel || 'See my estimate';
    var ready = part1Done();
    cta.disabled = submitting || !ready;
    if (ready && !submitting) closeDrop();
    if (unconfirmedAddressNote) {
      unconfirmedAddressNote.style.display = addrUnverified && ready ? '' : 'none';
    }
    if (ctaHint) {
      var begun = nameIn.value.trim() || phoneIn.value.trim() || addrIn.value.trim();
      var hasSpecificError = phoneField.classList.contains('has-error');
      if (!ready && !submitting && begun && !hasSpecificError) { ctaHint.textContent = missingMsg(); ctaHint.style.display = ''; }
      else { ctaHint.style.display = 'none'; }
    }
  }

  function capitalizeName(value) {
    return String(value || '').replace(/(^|[\s'-])([a-z])/g, function (_, lead, letter) {
      return lead + letter.toUpperCase();
    });
  }
  function splitNameForTracking(value) {
    var parts = String(value || '').trim().split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || '',
      lastName: parts.length > 1 ? parts[parts.length - 1] : ''
    };
  }
  var lastSyncedName = '';
  var lastSyncedPhone = '';
  var lastSyncedAddress = '';
  function inputMethod(event, previousValue, currentValue) {
    if (event && event.inputType === 'insertFromPaste') return 'paste';
    if (event && event.inputType === 'insertText'
        && typeof event.data === 'string' && event.data.length <= 1) return 'typed';
    if (event && event.inputType && event.inputType.indexOf('delete') === 0) return 'typed';
    /* iPhone Safari and XCUITest can report an ordinary keyboard keystroke as
       insertText with null data. A focused, one-character value change is still
       typing. Saved-contact autofill replaces several characters at once. */
    var before = String(previousValue || '');
    var after = String(currentValue || '');
    if (Math.abs(after.length - before.length) === 1) return 'typed';
    return 'autofill_or_unknown';
  }
  /* Browsers do not agree on how saved-contact autofill is announced. Chrome usually
     fires input, Safari may fire change, and password/contact helpers can update a value
     just before focus, blur, pageshow, or an autofill animation. Read the actual values
     at each of those safe points so a visibly complete form never leaves Continue stale. */
  function syncBrowserFilledValues(trigger, event) {
    if (main.hidden || submitting) return;
    var rawName = nameIn.value;
    var rawPhone = phoneIn.value;
    var rawAddress = addrIn.value;
    var changed = rawName !== lastSyncedName || rawPhone !== lastSyncedPhone || rawAddress !== lastSyncedAddress;

    var nameCursor = document.activeElement === nameIn ? nameIn.selectionStart : null;
    var capitalized = capitalizeName(rawName);
    if (capitalized !== rawName) {
      nameIn.value = capitalized;
      if (nameCursor !== null) nameIn.setSelectionRange(nameCursor, nameCursor);
    }
    var formattedPhone = formatPhone(rawPhone);
    if (formattedPhone !== rawPhone) phoneIn.value = formattedPhone;
    if (phoneValid(phoneIn.value)) phoneField.classList.remove('has-error');

    var addressChanged = rawAddress !== lastSyncedAddress;
    if (addressChanged) {
      lastAddressInputMethod = trigger === 'input'
        ? inputMethod(event, lastSyncedAddress, rawAddress)
        : 'autofill_or_unknown';
      if (lastAddressInputMethod === 'autofill_or_unknown') {
        var normalizedAddress = normalizeBrowserStreetAddress(rawAddress);
        if (normalizedAddress !== rawAddress) {
          addrIn.value = normalizedAddress;
          rawAddress = normalizedAddress;
        }
      }
      suggest(trigger === 'input' ? 'typing' : 'browser_autofill');
    }

    lastSyncedName = nameIn.value;
    lastSyncedPhone = phoneIn.value;
    lastSyncedAddress = addrIn.value;
    if (changed && (lastSyncedName.trim() || lastSyncedPhone.trim() || lastSyncedAddress.trim())) once('walk_v2_form_started');
    if (changed) {
      persistDraft();
      refresh();
    }
  }
  nameIn.addEventListener('input', function () {
    syncBrowserFilledValues('input');
  });
  nameIn.addEventListener('change', function () { syncBrowserFilledValues('change'); });
  phoneIn.addEventListener('input', function () {
    syncBrowserFilledValues('input');
  });
  phoneIn.addEventListener('change', function () { syncBrowserFilledValues('change'); });
  phoneIn.addEventListener('blur', function () {
    syncBrowserFilledValues('blur');
    if (phoneIn.value.trim() && !phoneValid(phoneIn.value)) phoneField.classList.add('has-error');
    refresh();
  });
  addrIn.addEventListener('input', function (event) {
    if (/[\n\r]/.test(addrIn.value)) {
      var caret = addrIn.selectionStart;
      addrIn.value = addrIn.value.replace(/[\n\r]+/g, ' ');
      if (typeof caret === 'number') try { addrIn.setSelectionRange(caret, caret); } catch (_) {}
    }
    syncBrowserFilledValues('input', event);
  });
  addrIn.addEventListener('keydown', function (event) {
    var opts = Array.from(drop.querySelectorAll('.addr-opt'));
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && opts.length) {
      event.preventDefault();
      activeOption = event.key === 'ArrowDown' ? (activeOption + 1) % opts.length : (activeOption <= 0 ? opts.length - 1 : activeOption - 1);
      opts.forEach(function (option, index) { option.setAttribute('aria-selected', String(index === activeOption)); });
      addrIn.setAttribute('aria-activedescendant', opts[activeOption].id);
      opts[activeOption].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption >= 0 && opts[activeOption]) opts[activeOption].click();
    } else if (event.key === 'Escape') { event.preventDefault(); closeDrop(); }
  });
  nameIn.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); phoneIn.focus(); } });
  phoneIn.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); addrIn.focus(); } });
  sizeAddrBox();
  addrIn.addEventListener('change', function (event) { syncBrowserFilledValues('change', event); });
  main.querySelector('form').addEventListener('focusin', function () {
    setTimeout(function () { syncBrowserFilledValues('focusin'); }, 0);
    setTimeout(function () { syncBrowserFilledValues('focusin_delayed'); }, 250);
  });
  main.querySelector('form').addEventListener('animationstart', function (event) {
    if (event.target && event.target.matches && event.target.matches('input, textarea')) {
      syncBrowserFilledValues('autofill_animation');
      if (event.target === addrIn && !addrOk() && addressLooksComplete()) {
        suggest('browser_autofill_animation');
      }
    }
  }, true);
  window.addEventListener('pageshow', function () { syncBrowserFilledValues('pageshow'); startBrowserFillProbe(); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) syncBrowserFilledValues('visibility');
  });
  [0, 100, 350, 1000].forEach(function (delay) {
    setTimeout(function () { syncBrowserFilledValues('initial_probe'); }, delay);
  });
  var browserFillProbe;
  function startBrowserFillProbe() {
    window.clearInterval(browserFillProbe);
    browserFillProbe = window.setInterval(function () { if (!document.hidden) syncBrowserFilledValues('periodic_probe'); }, 500);
  }
  startBrowserFillProbe();
  window.addEventListener('pagehide', function () { window.clearInterval(browserFillProbe); });
  /* single submit path: tapping the button submits AND grants SMS consent via the
     disclosure beneath it. The texts are about the customer's own requested quote;
     the disclosure is explicit and STOP + the by-phone DNC gate are honored on every
     send. (The prior separate no-consent "Continue without texts" link was removed
     per Key 2026-06-29; consent posture is confirmed at activation, TCPA.) */
  main.querySelector('form').addEventListener('submit', function (e) {
    e.preventDefault();
    closeDrop();
    doSubmit(true);
  });

  async function doSubmit(smsGiven) {
    if (submitting || !part1Done() || (options.canSubmit && !options.canSubmit())) return;
    if (smsGiven) once('walk_v2_consent_checked');
    submitting = true;
    if (options.onBusy) options.onBusy(true);
    [nameIn, phoneIn, addrIn].forEach(function (field) { field.disabled = true; });
    cta.disabled = true;
    /* Honest network wait only (Fresh Air: no fake beat). Copy names the real work. */
    ctaLabelEl.textContent = 'Saving your details...';

    var name = nameIn.value.trim();
    var attr = attribution();
    var touches = savedMarketingTouches();
    if (attr.channel === 'direct' && touches.current) {
      attr = { channel: touches.current.channel, source: touches.current.utmSource || '',
        medium: touches.current.utmMedium || '', campaign: touches.current.utmCampaign || '' };
    }
    var eventId = 'wv2-' + window.crypto.randomUUID();
    var intakeNonce = window.crypto.randomUUID();

    /* Structured city/state/zip come only from a picked Mapbox feature.
       An unselected type-in or the explicit escape stores the typed string
       and leaves state/ZIP empty. Never take the bbox-biased first hit. */
    function normAddr(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }
    function featureMatchesTyped(feature, typed) {
      var q = normAddr(typed);
      var place = normAddr(feature && feature.description);
      if (!q || !place) return false;
      if (place === q) return true;
      var qStreet = q.split(',')[0].trim();
      var pStreet = place.split(',')[0].trim();
      if (!qStreet || qStreet !== pStreet) return false;
      var extra = q.indexOf(',') > -1 ? q.slice(q.indexOf(',') + 1).trim() : '';
      if (!extra) return false;
      return extra.split(',').every(function (part) {
        part = part.trim();
        return !part || place.indexOf(part) !== -1;
      });
    }
    if (addrUnverified || !addrValidated) {
      addrSel = { city: '', state: '', zip: '' };
    } else if (!addrSel.state) {
      try {
        var bf = await WALK.addrSuggest(addrIn.value.trim(), 8000, {
          input_method: lastAddressInputMethod,
          trigger: 'submit_backfill'
        });
        var hit = null;
        for (var bi = 0; bf && bi < bf.length; bi++) {
          if (featureMatchesTyped(bf[bi], addrIn.value)) { hit = bf[bi]; break; }
        }
        if (hit) {
          addrSel = {
            city: hit.city || '',
            state: hit.state || '',
            zip: hit.zip || ''
          };
        } else {
          addrSel = { city: '', state: '', zip: '' };
        }
      } catch (_) { /* leave state empty */ }
    }

    var trackingName = splitNameForTracking(name);
    var trackingHost = String(window.location.hostname || '').toLowerCase();
    var trackingParams = new URLSearchParams(entryURL.search || '');
    var trackingDnt = String(navigator.doNotTrack || window.doNotTrack || '').toLowerCase();
    var analyticsOptOut = navigator.globalPrivacyControl === true || trackingDnt === '1' || trackingDnt === 'yes'
      || (trackingHost !== 'backuppowerpro.com' && trackingHost !== 'www.backuppowerpro.com')
      || trackingParams.get('preview') === '1' || trackingParams.get('analytics_test') === '1';
    var payload = {
      firstName: trackingName.firstName, lastName: trackingName.lastName, phone: natDigits(phoneIn.value), email: '',
      existingToken: editDetails ? resumeT : '',
      address: addrIn.value.trim(), addressStreet: '', addressCity: addrSel.city || '', addressCounty: '', addressState: addrSel.state || '', addressZip: addrSel.zip || '', addressCountry: 'US', addressUnverified: addrUnverified ? 'true' : '',
      leadChannel: attr.channel, utmSource: attr.source, utmMedium: attr.medium, utmCampaign: attr.campaign,
      hasCompatibleGenerator: 'Unanswered - connection check pending',
      outletAmps: [],
      outletUnsure: '',
      needsOutlet: false,
      connection_status: 'unanswered',
      smsConsent: smsGiven ? 'true' : '',
      submittedAt: new Date().toISOString(), eventTimestamp: Math.floor(Date.now() / 1000),
      source: 'walkv2-landing',
      actionSource: 'website', eventName: 'QuoteWalkStarted', eventId: eventId,
      intakeNonce: intakeNonce,
      analyticsOptOut: analyticsOptOut,
      journeyVersion: 'intake-no-upload-v1',
      journey_version: 'intake-no-upload-v1',
      clientUserAgent: navigator.userAgent || '',
      fbp: (document.cookie.match(/(?:^|;\s*)_fbp=([^;]*)/) || [])[1] || '',
      fbc: (document.cookie.match(/(?:^|;\s*)_fbc=([^;]*)/) || [])[1] || '',
      fbclid: new URLSearchParams(entryURL.search).get('fbclid') || '',
      gclid: new URLSearchParams(entryURL.search).get('gclid') || '',
      gbraid: new URLSearchParams(entryURL.search).get('gbraid') || '',
      wbraid: new URLSearchParams(entryURL.search).get('wbraid') || '',
      pageUrl: entryURL.href, referrer: document.referrer || '',
      firstTouch: touches.first,
      currentTouch: touches.current
    };


    if (options.walkDraft) {
      payload.walkDraft = options.walkDraft();
      payload.journeyVersion = payload.journey_version = 'guided-quote-walk-v1';
    }
    try { await options.onSubmit(payload); }
    catch (_) { showError('Your details did not save. Please try again.'); }
    finally {
      submitting = false;
      [nameIn, phoneIn, addrIn].forEach(function (field) { field.disabled = false; });
      if (options.onBusy) options.onBusy(false);
      refresh();
    }
  }
  function showError(message, field) {
    var error = main.querySelector('[data-submit-error]');
    error.textContent = message;
    error.style.display = '';
    error.setAttribute('data-return-recovery', 'submission');
    var input = field === 'phone' ? phoneIn : field === 'address' ? addrIn : field === 'name' ? nameIn : error;
    if (input === error) input.tabIndex = -1;
    input.focus();
  }
  refresh();
  return {
    setAuthority: function (token) { resumeT = token || ''; editDetails = Boolean(resumeT); if (editDetails) { options.walkDraft = null; options.submitLabel = 'Save my details'; } },
    refresh: function () { syncBrowserFilledValues('screen_visible'); refresh(); },
    closeSuggestions: closeDrop,
    showError: showError,
    hydrate: function (value) {
      nameIn.value = value.first_name || '';
      phoneIn.value = formatPhone(value.phone || '');
      addrIn.value = value.address || '';
      addrValidated = Boolean(addrIn.value.trim());
      addrValidatedValue = addrIn.value.trim();
      addrUnverified = value.service_area_status === 'pending_verification';
      lastSyncedName = nameIn.value; lastSyncedPhone = phoneIn.value; lastSyncedAddress = addrIn.value;
      refresh();
    }
  };
    }
  };
})();
