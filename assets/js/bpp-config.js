/*
  BPP shared config, the single place to update prices, phone, and other
  values that appear across customer surfaces. Change a value here and every
  page that loads this file updates on next load. No need to hunt through HTML.

  Usage in HTML:
    <span data-bpp="priceRange">$1,197 to $1,497</span>   (the inner text is a
        fallback for no-JS; this script overwrites it from the config)
    <a data-bpp-tel="phone" href="tel:18648637800">...</a>  (fills the tel: href)

  To update a price or the phone number in the future: edit ONLY the values
  below. Keep it dash-clean (no em or en dashes; use hyphens).
*/
window.BPP_CONFIG = {
  phone:          '(864) 863-7800',
  priceLow:       '$1,197',
  priceHigh:      '$1,497',
  priceRange:     'from $1,197',
  wholeHomeRange: '$12,000 to $20,000',
  license:        'SC Electrical Contractor LIC #2942',
  licenseShort:   'LIC #2942',
  counties:       'Greenville, Spartanburg & Pickens Counties',
  countiesShort:  'Greenville, Pickens & Spartanburg',
  url:            'backuppowerpro.com',
  guarantee:      'Passing the inspection is my job, not yours. Permit pulled under SC License 2942.',
  slotsPerWeek:   '5',
  entity:         'Backup Power Pro (Key Electric LLC, SC LIC #2942)',
  // Liability one-liner, the established BPP line (already on the quote
  // calculator). Use data-bpp="liabilityShort" anywhere a short disclaimer
  // fits. The fuller scope-and-liability paragraph lives on the POM PDF +
  // inlet-safety-instructions; this is the compact version.
  liabilityShort: 'We stand behind the equipment we install. We are not responsible for equipment or wiring we did not install.'
};

(function () {
  function fill() {
    var c = window.BPP_CONFIG || {};
    document.querySelectorAll('[data-bpp]').forEach(function (el) {
      var k = el.getAttribute('data-bpp');
      if (c[k] != null) el.textContent = c[k];
    });
    document.querySelectorAll('[data-bpp-tel]').forEach(function (el) {
      var k = el.getAttribute('data-bpp-tel');
      if (c[k] != null) el.setAttribute('href', 'tel:' + String(c[k]).replace(/[^0-9]/g, ''));
    });
  }
  if (document.readyState !== 'loading') fill();
  else document.addEventListener('DOMContentLoaded', fill);
})();
