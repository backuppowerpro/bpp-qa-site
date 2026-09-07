/* External financing only. Opening Acorn never changes BPP payment state. */
(function (root) {
  'use strict';
  function url(amount) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
    var cents = Math.round(amount * 100);
    if (!Number.isSafeInteger(cents) || cents < 100000 || cents > 10000000) return null;
    var link = new URL('https://www.acornfinance.com/pre-qualify/');
    link.searchParams.set('d', 'PSVOF');
    link.searchParams.set('utm_medium', 'web_pre_qual_link');
    link.searchParams.set('loanAmount', String(cents / 100));
    return link.href;
  }
  function markup(amount, preview) {
    var link = preview ? null : url(amount);
    if (!link) return '';
    return '<div class="bpp-financing">'
      + '<a href="' + link.replace(/&/g, '&amp;') + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Check financing options with Acorn</a>'
      + '<p>Subject to credit approval. Once funded, return here to pay BPP.</p></div>';
  }
  root.BPPFinancing = {
    url: url,
    markup: markup,
    render: function (element, amount, preview) {
      if (element) element.innerHTML = markup(amount, preview);
    }
  };
})(typeof window === 'undefined' ? globalThis : window);
