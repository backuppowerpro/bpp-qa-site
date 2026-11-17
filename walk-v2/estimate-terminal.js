/* Presentation follows a fresh server receipt; this module grants no authority. */
(function () {
  'use strict';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function signature(snapshot) {
    if (!snapshot) return '';
    return JSON.stringify([snapshot.low_cents, snapshot.high_cents, snapshot.pricing_basis, snapshot.cord_included,
      snapshot.calculator_version, snapshot.pricing_context && snapshot.pricing_context.estimate_kind,
      (snapshot.scope_rows || []).map(function (row) { return [row.key, row.included, row.offer_policy ? [row.offer_policy.version, row.offer_policy.name, row.offer_policy.guarantee_title, row.offer_policy.guarantee_text] : null]; }).sort(function (a, b) { return a[0].localeCompare(b[0]); })]);
  }
  function confirmed(view, expected) {
    var v = view && view.quote_walk_v2 || {}, s = v.current_range_snapshot || {}, r = v.readiness || {}, h = v.handoff_receipt || {};
    return v.intake_contract === 'guided-quote-walk-v1' && v.status === 'active'
      && Number.isSafeInteger(v.version) && v.version > 0 && v.range_fit_answer === 'yes'
      && v.initial_panel_photo_saved === true && UUID.test(v.initial_panel_photo_media_id || '')
      && window.BPPGuidedEstimate.usable(s) && UUID.test(s.snapshot_id || '')
      && v.current_range_snapshot_id === s.snapshot_id && v.accepted_range_snapshot_id === s.snapshot_id
      && r.journey_version === v.version && r.snapshot_id === s.snapshot_id && UUID.test(r.acceptance_id || '')
      && /^[a-f0-9]{64}$/.test(s.scope_hash || '') && r.scope_hash === s.scope_hash
      && v.handoff_recorded === true && UUID.test(h.id || '') && ['ready', 'claimed', 'completed'].indexOf(h.status) !== -1
      && h.journey_version === v.version && h.snapshot_id === s.snapshot_id
      && (!expected || (!expected.snapshotId || expected.snapshotId === s.snapshot_id)
        && (!expected.mediaId || expected.mediaId === v.initial_panel_photo_media_id)
        && (!expected.signature || expected.signature === signature(s)));
  }
  window.BPPEstimateTerminal = { version: 1, signature: signature, confirmed: confirmed };
})();
