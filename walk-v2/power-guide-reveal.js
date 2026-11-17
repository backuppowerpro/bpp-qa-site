/* Optional first-visit motion. The guide card is always readable without this file. */
(function () {
  'use strict';
  if (window.BPPPowerGuideReveal) { window.BPPPowerGuideReveal.refresh(); return; }

  var SELECTOR = '[data-power-guide-opening]';
  var KEY = 'bpp:qwv2:power-guide-reveal:v1';
  var MARK = 'data-power-guide-reveal';
  var CLASS = 'power-guide-revealing';
  var seen = false;
  var storageRead = false;
  var observer;
  var visibilityObserver;
  var waiting;
  var media;
  var listening = false;
  var active;
  var observed = new Set();

  function cards() { return Array.prototype.slice.call(document.querySelectorAll(SELECTOR)); }
  function mark() {
    cards().forEach(function (card) {
      card.setAttribute(MARK, 'seen');
      if (!active || card !== active.card) card.classList.remove(CLASS);
    });
  }
  function disconnect() {
    if (observer) observer.disconnect();
    if (visibilityObserver) visibilityObserver.disconnect();
    waiting = null;
  }
  function remember() {
    seen = true; mark(); disconnect();
    try {
      sessionStorage.setItem(KEY, '1');
      return sessionStorage.getItem(KEY) === '1';
    } catch (_) { return false; }
  }
  function unlisten() {
    if (!listening) return;
    if (media.removeEventListener) media.removeEventListener('change', preferenceChanged);
    else if (media.removeListener) media.removeListener(preferenceChanged);
    listening = false;
  }
  function finish() {
    if (!active) { unlisten(); return; }
    var previous = active; active = null;
    clearTimeout(previous.timer);
    previous.card.classList.remove(CLASS);
    previous.animation.cancel();
    unlisten();
  }
  function skip() { remember(); finish(); }
  function preferenceChanged(event) { if (event.matches) skip(); }
  function visible(card) {
    if (!card.getClientRects().length || typeof window.getComputedStyle !== 'function') return false;
    for (var node = card; node; node = node.parentElement) {
      var style = window.getComputedStyle(node);
      if (style.visibility !== 'visible' || style.display === 'none' || style.opacity === '0') return false;
    }
    return true;
  }
  function attempt() {
    var card = waiting;
    if (!card || seen || cards().indexOf(card) < 0) return;
    if (!visible(card)) {
      // Boot visibility can change without crossing an intersection threshold.
      if (!visibilityObserver && typeof window.MutationObserver === 'function') {
        visibilityObserver = new MutationObserver(attempt);
        for (var node = card; node; node = node.parentElement) {
          visibilityObserver.observe(node, {attributes:true, attributeFilter:['class', 'style', 'hidden']});
        }
      }
      return;
    }
    if (media.matches || typeof card.animate !== 'function') { skip(); return; }
    // Persist before starting. Blocked/unverifiable storage deliberately gets no motion.
    if (!remember()) { unlisten(); return; }
    try {
      var animation = card.animate(
        [{opacity:0.9, transform:'translateY(4px)'}, {opacity:1, transform:'translateY(0)'}],
        {duration:400, easing:'cubic-bezier(.2,.65,.3,1)', iterations:1, fill:'none'}
      );
      active = {card:card, animation:animation, timer:setTimeout(finish, 500)};
      card.classList.add(CLASS);
      animation.addEventListener('finish', finish, {once:true});
      animation.addEventListener('cancel', finish, {once:true});
    } catch (_) { finish(); }
  }
  function refresh() {
    if (document.readyState === 'loading') return;
    var current = cards();
    if (!current.length) return;
    if (current.some(function (card) { return card.getAttribute(MARK) === 'seen'; })) seen = true;
    if (!storageRead) {
      storageRead = true;
      try { seen = seen || sessionStorage.getItem(KEY) === '1'; }
      catch (_) { skip(); return; }
    }
    if (seen) {
      mark();
      if (active && current.indexOf(active.card) < 0) finish();
      return;
    }
    if (typeof window.IntersectionObserver !== 'function' || typeof window.matchMedia !== 'function') { skip(); return; }
    if (!media) {
      try { media = window.matchMedia('(prefers-reduced-motion: reduce)'); }
      catch (_) { skip(); return; }
    }
    if (media.matches) { skip(); return; }
    if (!listening) {
      if (media.addEventListener) media.addEventListener('change', preferenceChanged);
      else if (media.addListener) media.addListener(preferenceChanged);
      else { skip(); return; }
      listening = true;
    }
    if (!observer) {
      try {
        observer = new IntersectionObserver(function (entries) {
          if (seen) return;
          entries.forEach(function (entry) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.15) { waiting = entry.target; attempt(); }
            else if (waiting === entry.target) waiting = null;
          });
        }, {threshold:0.15});
      } catch (_) { skip(); return; }
    }
    current.forEach(function (card) {
      if (!observed.has(card)) { observed.add(card); observer.observe(card); }
    });
  }
  function ready() { document.removeEventListener('DOMContentLoaded', ready); refresh(); }
  window.BPPPowerGuideReveal = {version:1, refresh:refresh};
  window.addEventListener('pagehide', finish);
  window.addEventListener('pageshow', refresh);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else refresh();
})();
