
import {
  consumeQuoteWalkV2HandoffReceipt,
  fetchQuoteWalkV2OperatorReceipt,
  fetchQuoteWalkV2ReceiptMap,
  markQuoteWalkV2OperatorNotificationSeen,
  quoteWalkV2OperatorDisplay,
  quoteWalkV2OperatorProjection,
  quoteWalkV2QuoteDeskState,
  quoteWalkV2ReceiptMode,
  quoteWalkV2ReceiptVerdict,
} from '../v3-app/src/quote-walk-v2-receipts.js';
import { createOperatorCommunicationsStateClient } from './operator-communications-state.js';
import {
  createDomainStatusMap,
  startProgressiveDomains,
} from './progressive-domain-load.js';

// One contact column list for BOTH fetch paths (initial + refresh). The two
// lists drifted on 2026-06-10 (refresh lacked ai_summary) and the AI summary
// card silently vanished after any data refresh; never maintain two copies.
var CONTACT_COLS = 'id, name, phone, email, address, stage, status, do_not_contact, pricing_tier, created_at, notes, archived, pinned, tags, assigned_installer, installer_pay, install_date, ai_summary, ai_summary_updated_at, panel_location, amperage, availability_notes, generator, stripe_customer_id, stripe_payment_method_id, card_brand, card_last4, pom_inspection, run_ft_estimate, subdivision, current_line, lead_channel, lead_source';
// crm-data.js, Live data layer.
// Initializes window.CRM with empty arrays, then asynchronously fetches
// from Supabase and dispatches 'crm-data-ready' so crm-app.jsx can re-render.
//
// Schema translation: v2 Supabase schema (numeric stages, no jurisdiction
// column, status='Archived') → v3 visual contract (string stages,
// jurisdiction inferred from address, archived boolean).

const SUPABASE_URL = 'https://hfatblrcwytxvijjhpal.supabase.co';
// Same publishable key as proposal.html / invoice.html / crm/v2, RLS-scoped.
const SUPABASE_ANON_KEY = 'sb_publishable_kBXthY-Han29JLqcT514RQ_RtwxXLZ-';

// ── Local TEST MODE (Key 2026-06-15) ─────────────────────────────────────
// A localhost-only harness that boots the REAL CRM shell (the sliding panels,
// the real components) with synthetic fixture data, so layout/shell bugs (the
// 2026-06-15 transform job-sheet glitch) are testable WITHOUT signing into the
// live CRM. Triple-safe:
//   (1) Only on localhost / 127.0.0.1 (the hostname check). On
//       backuppowerpro.com this is ALWAYS false, so SignInGate is the only
//       path in production.
//   (2) Requires an explicit ?test=1 flag, so it never fires by accident.
//   (3) FAIL-SAFE: in test mode __db is a no-op STUB with no production session
//       and no network unless a test installs the explicit property-image fetch
//       seam. Even if it ever mis-activated, it exposes ZERO real
//       data and can fire ZERO real sends/charges. It shows fixtures only.
const TEST_MODE = (function () {
  try {
    var h = location.hostname;
    // ONLY localhost / 127.0.0.1. backuppowerpro.com can never match, so
    // production always falls through to the real Supabase client + SignInGate.
    var local = (h === 'localhost' || h === '127.0.0.1');
    var browserFixture = new URLSearchParams(location.search).get('test') === '1';
    // The native simulator has no useful query-string entry point. Its test
    // build sets this flag before Ionic imports crm-data.js, and remains
    // triple-contained: compile-time opt-in, Capacitor's localhost origin,
    // and the capacitor protocol. A normal native build cannot reach it.
    var simulatorFixture = window.__BPP_SIM_TEST__ === true && location.protocol === 'capacitor:';
    return local && (browserFixture || simulatorFixture);
  } catch (e) { return false; }
})();

// Test-only failure seam. It is usable only with the localhost-only
// `?test=1` harness and proves that a cached operator list never renders as
// a fake new account when the live contacts read is unavailable.
const TEST_CONTACTS_FAILURE = (function () {
  if (!TEST_MODE) return false;
  try { return new URLSearchParams(location.search).get('contacts-fail') === '1'; }
  catch (_) { return false; }
})();

// Native Simulator fixtures need renderable local media. A public Storage URL
// is useful for browser interception, but it deliberately does not exist in a
// side-effect-free simulator build. Keep these data URLs behind the explicit
// simulator flag so a normal CRM session can never display fixture media.
var SIM_FIXTURE_MEDIA = window.__BPP_SIM_TEST__ === true ? {
  first: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect width="240" height="160" fill="#e5e7eb"/><rect x="78" y="14" width="84" height="132" rx="6" fill="#374151"/><rect x="89" y="28" width="62" height="34" fill="#9ca3af"/><path d="M89 83h62M89 105h62M110 62v72M130 62v72" stroke="#f9fafb" stroke-width="5"/></svg>'),
  second: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect width="240" height="160" fill="#f5f0e6"/><path d="M38 32h164M38 58h164M38 84h164M38 110h164M38 136h164" stroke="#c7b48a" stroke-width="3"/><path d="M62 30v110M126 30v110" stroke="#9b7b45" stroke-width="3"/><text x="74" y="79" font-size="16" fill="#374151">Panel notes</text></svg>'),
} : null;

// No-op Supabase stub: every query chain resolves to {data:[],error:null} so
// writes succeed silently, realtime channels are inert, edge fns no-op, and
// the session always "exists". NEVER touches the network.
function __makeStubDb() {
  var result = Promise.resolve({ data: [], error: null });
  var chain = new Proxy(function () {}, {
    get: function (_t, prop) {
      if (prop === 'then') return result.then.bind(result);
      if (prop === 'catch') return result.catch.bind(result);
      if (prop === 'finally') return result.finally.bind(result);
      return function () { return chain; }; // from/select/insert/update/delete/eq/order/limit/single/maybeSingle/... all chain
    },
    apply: function () { return chain; },
  });
  var channel = { on: function () { return channel; }, subscribe: function () { return channel; }, unsubscribe: function () { return channel; } };
  // One synthetic sub so ?test=1 can exercise the roster + the sub detail pane
  // (fictitious, no real PII). sub-admin-list is the only edge fn the subs UI
  // reads; every other fn stays a no-op.
  var TEST_SUB = {
    id: 't-sub-1', business_name: 'Palmetto Powerworks', name: 'Marcus Webb',
    primary_contact_name: 'Marcus Webb', primary_contact_phone: '(864) 555-0148',
    phone: '(864) 555-0148', email: 'marcus@palmettopower.example',
    mailing_address: '118 Trade St, Greer SC 29650', role: 'Electrical contractor',
    // License + insurance so the Edit form's prefill path is exercisable under ?test=1.
    license_state: 'SC', license_number: 'M-118432', license_expiration: '2027-03-31',
    gl_carrier: 'Cedar Mutual', gl_expiration: '2026-11-30', wc_status: 'active', wc_expiration: '2026-12-15',
    status: 'active', compliance: 'ready', rank_tier: 'A', perf_score: 92,
    counties: ['Greenville', 'Spartanburg'], jobs_this_month: 2, desired_jobs_per_month: 4,
    installs_total: 23, owed_cents: 0, owed_amount: 0,
    // A stand-in logo so the avatar (profile picture) path is exercisable under
    // ?test=1 (real uploads go through sub-logo-upload -> the public sub-logos bucket).
    logo_url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%231B2B4B'/%3E%3Ctext x='48' y='63' font-size='42' fill='%23ffba00' text-anchor='middle' font-family='sans-serif' font-weight='800'%3EPP%3C/text%3E%3C/svg%3E",
  };
  // One compliance document, real shape (sub-admin-list buildProfile
  // ~614-622: id, doc_type, label, status, expiration_date, is_current,
  // is_required). status:'received' (not 'pending') on purpose so BOTH new
  // Ionic doc actions are exercisable under ?test=1: the bespoke's own gate
  // (crm-subs-tab.jsx:728) only offers Mark verified at status 'received';
  // a 'pending' doc would exercise View but never Mark verified.
  var TEST_SUB_DOC = {
    id: 't-doc-1', doc_type: 'gl_certificate', label: 'General liability certificate',
    status: 'received', expiration_date: '2026-11-30', is_current: true, is_required: true,
  };
  // Ionic Increment T2: synthetic sub_job_offers in the full buildJobs shape
  // (sub-admin-list/index.ts buildJobs). Mutable so create/edit/withdraw/
  // approve stubs can update what view:'jobs' returns on the next load.
  // Statuses spread across offered / accepted / pass_submitted / approved_paid
  // plus a special attest-409 id for the approve-payout attestation gate.
  function __jobRow(partial) {
    var status = partial.status || 'offered';
    var ACCEPTED = ['accepted', 'permit_submitted', 'install_submitted', 'pass_submitted', 'approved_paid'];
    var client = partial.client || {
      name: partial.client_name || null,
      install_address: partial.client_address || null,
      phone: partial.client_phone || null,
      email: null,
      subdivision: null,
    };
    return Object.assign({
      id: partial.offer_id || partial.id,
      offer_id: partial.offer_id || partial.id,
      contact_id: partial.contact_id,
      proposal_id: null,
      sub_id: partial.sub_id || 't-sub-1',
      status: status,
      permit_owner: 'bpp',
      permit_required: true,
      permit_description: null,
      scope_json: partial.scope_json || { description: '' },
      client: client,
      customer: { name: client.name, address: client.install_address, phone: client.phone, email: client.email },
      client_name: client.name,
      client_address: client.install_address,
      client_phone: client.phone,
      client_email: client.email,
      sub: { id: 't-sub-1', name: 'Marcus Webb', business_name: 'Palmetto Powerworks', phone: '(864) 555-0148', email: 'marcus@palmettopower.example', status: 'active' },
      sub_name: 'Palmetto Powerworks',
      sub_contact_name: 'Marcus Webb',
      payout_amount: partial.payout_amount != null ? partial.payout_amount : 314,
      payout_pct: 0.20,
      payout_permit_flat: 0,
      payout_job_price: 1197,
      payout_agreed_amount: partial.payout_agreed_amount != null ? partial.payout_agreed_amount : (ACCEPTED.indexOf(status) >= 0 ? (partial.payout_amount != null ? partial.payout_amount : 314) : null),
      payout_revised_reason: partial.payout_revised_reason || null,
      payout_changed_after_accept_at: null,
      payout_locked: ACCEPTED.indexOf(status) >= 0,
      est_labor_hours: partial.est_labor_hours != null ? partial.est_labor_hours : 4,
      timeframe_estimate: partial.timeframe_estimate || 'Same day',
      firm_install_date: partial.firm_install_date || null,
      firm_install_date_set_at: null,
      materials: [],
      materials_ship_status: null,
      materials_shipped_at: null,
      materials_received_at: null,
      materials_tracking: null,
      client_info_ack_at: null,
      client_approval_confirmed_at: partial.client_approval_confirmed_at || null,
      work_done_tested_confirmed_at: partial.work_done_tested_confirmed_at || null,
      permit_reminder_last_at: null,
      milestones: { offered_at: null, responded_at: null, permit_submitted_at: null, install_submitted_at: null, pass_submitted_at: null, approved_at: null, paid_at: null, expires_at: null },
      uploads: { total: 0, by_kind: {}, by_slot: {} },
      photo_slots: [],
      pre_existing_damage: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, partial);
  }
  var TEST_JOBS = [
    __jobRow({
      id: 't-offer-dana', offer_id: 't-offer-dana', contact_id: 't-dana',
      status: 'offered', payout_amount: 314, payout_agreed_amount: null, payout_locked: false,
      client: { name: 'Dana Whitfield', install_address: '412 Oakmont Dr Greenville SC 29615', phone: '+18645550102', email: 'dana@example.test', subdivision: null },
      client_name: 'Dana Whitfield', client_address: '412 Oakmont Dr Greenville SC 29615', client_phone: '+18645550102',
    }),
    __jobRow({
      id: 't-offer-hank', offer_id: 't-offer-hank', contact_id: 't-hank',
      status: 'accepted', payout_amount: 314, payout_agreed_amount: 314, payout_locked: true,
      client: { name: 'Hank Waters', install_address: '415 Dogwood Trl Greer SC 29651', phone: '+18645550107', email: 'hank@example.test', subdivision: null },
      client_name: 'Hank Waters', client_address: '415 Dogwood Trl Greer SC 29651', client_phone: '+18645550107',
    }),
    __jobRow({
      id: 't-offer-eric', offer_id: 't-offer-eric', contact_id: 't-eric',
      status: 'pass_submitted', payout_amount: 314, payout_agreed_amount: 314, payout_locked: true,
      client_approval_confirmed_at: '2026-07-10T12:00:00Z',
      work_done_tested_confirmed_at: '2026-07-10T12:05:00Z',
      client: { name: 'Eric Lutz', install_address: '107 Arlen Ave Simpsonville SC 29681', phone: '+18645550101', email: 'eric@example.test', subdivision: null },
      client_name: 'Eric Lutz', client_address: '107 Arlen Ave Simpsonville SC 29681', client_phone: '+18645550101',
    }),
    // Special row: pass_submitted but missing attestations. approve-payout stub
    // returns 409 so the Ionic client can exercise the "waiting on the sub" path.
    __jobRow({
      id: 't-offer-attest-409', offer_id: 't-offer-attest-409', contact_id: 't-glenn',
      status: 'pass_submitted', payout_amount: 314, payout_agreed_amount: 314, payout_locked: true,
      client_approval_confirmed_at: null,
      work_done_tested_confirmed_at: null,
      client: { name: 'Glenn Parker', install_address: '33 Maple St Greenville SC 29601', phone: '+18645550105', email: 'glenn@example.test', subdivision: null },
      client_name: 'Glenn Parker', client_address: '33 Maple St Greenville SC 29601', client_phone: '+18645550105',
    }),
  ];
  var TEST_PAYOUTS = [{
    id: 't-payout-1', sub_id: 't-sub-1', offer_id: 't-offer-eric',
    amount_cents: 31400, client_name: 'Eric Lutz', job_code: 'TOFFER',
    completed_at: '2026-07-10T12:30:00Z', paid_at: null, method: null,
  }];
  var subAdminList = function (opts) {
    var view = (opts && opts.body && opts.body.view) || 'roster';
    if (view === 'roster') return Promise.resolve({ data: { subs: [TEST_SUB] }, error: null });
    if (view === 'profile') return Promise.resolve({ data: {
      sub: TEST_SUB, contacts: [], documents: [TEST_SUB_DOC], agreement: null, payouts: TEST_PAYOUTS.slice(),
      performance: { score: 92, metrics: null, summary: 'Reliable, fast permits.', computed_at: null },
      feedback: [], jobs: TEST_JOBS.filter(function (j) { return j.sub_id === 't-sub-1'; }),
    }, error: null });
    // view:'jobs' ignores filter params (real buildJobs does too); client filters.
    if (view === 'jobs') return Promise.resolve({ data: { view: 'jobs', jobs: TEST_JOBS.slice() }, error: null });
    return Promise.resolve({ data: null, error: null });
  };

  // ── Ionic Increment U: permit portals + Vault credentials ────────────────
  // Mutable so the modal's edit/add/set-password flows read back what they
  // just wrote on the next load (?test=1 exercises the real component logic,
  // not just a render). Greenville County (9001) ships WITH a password so the
  // reveal/copy path is exercisable without first setting one.
  var TEST_JURISDICTIONS = [
    { id: 9001, name: 'Greenville County', portal_url: 'https://aca.greenvillecounty.org/ACA/', username: 'AEC001822', password_enc: 'x', notes: '' },
    { id: 9002, name: 'Spartanburg County', portal_url: 'https://civicaccess.spartanburgcounty.gov/energov_prod/selfservice#/home', username: 'Google SSO (backuppowerpro@gmail.com)', password_enc: null, notes: '' },
    { id: 9003, name: 'Pickens County', portal_url: 'https://energovweb.pickenscountysc.us/EnerGovProd/SelfService', username: 'Google SSO (backuppowerpro@gmail.com)', password_enc: null, notes: '' },
    { id: 9004, name: 'City of Greenville', portal_url: 'https://grvl-egov.aspgov.com/grvlc2gbp/index.html', username: 'Google SSO (backuppowerpro@gmail.com)', password_enc: null, notes: '' },
  ];
  // Cleartext store standing in for the Vault RPC round-trip. Only the seeded
  // Greenville County row has a value, matching password_enc: 'x' above.
  var TEST_PW_STORE = { 9001: 'test-portal-pw' };
  var TEST_PORTAL_VISITS = [];

  // A small chainable query builder over TEST_JURISDICTIONS, just enough of
  // the supabase-js surface for the permit-portals directory: select/order
  // (list), select/eq/limit (S1's existing name lookup, must keep working),
  // select/eq/maybeSingle|single (name/id lookup), update/eq (edit), and
  // insert/select/single (add). Every intermediate call returns the same
  // chain object (mutating internal state); the chain itself is thenable so
  // callers can `await` at ANY point in the chain, same as real supabase-js.
  function makeJurisdictionChain() {
    var state = { op: 'select', cols: null, filters: {}, patch: null, insertRow: null, limitN: null, wantSingle: false };
    function resolve() {
      try {
        if (state.op === 'update') {
          var idx = TEST_JURISDICTIONS.findIndex(function (r) { return String(r.id) === String(state.filters.id); });
          if (idx >= 0) TEST_JURISDICTIONS[idx] = Object.assign({}, TEST_JURISDICTIONS[idx], state.patch);
          return { data: null, error: null };
        }
        if (state.op === 'insert') {
          var newRow = Object.assign({ id: Date.now() }, state.insertRow);
          TEST_JURISDICTIONS.push(newRow);
          return { data: state.wantSingle ? newRow : [newRow], error: null };
        }
        // select (default)
        var rows = TEST_JURISDICTIONS.slice();
        if (state.filters.name != null) rows = rows.filter(function (r) { return r.name === state.filters.name; });
        if (state.filters.id != null) rows = rows.filter(function (r) { return String(r.id) === String(state.filters.id); });
        if (state.limitN != null) rows = rows.slice(0, state.limitN);
        if (state.cols === 'id') rows = rows.map(function (r) { return { id: r.id }; });
        if (state.wantSingle) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      } catch (e) {
        return { data: null, error: { message: String((e && e.message) || e) } };
      }
    }
    var chain = {
      select: function (cols) { state.cols = cols; return chain; },
      order: function () { return chain; }, // client re-sorts (Greenville pinned first); stub returns unsorted
      eq: function (col, val) { state.filters[col] = val; return chain; },
      limit: function (n) { state.limitN = n; return chain; },
      maybeSingle: function () { state.wantSingle = true; return Promise.resolve(resolve()); },
      single: function () { state.wantSingle = true; return Promise.resolve(resolve()); },
      update: function (patch) { state.op = 'update'; state.patch = patch; return chain; },
      insert: function (row) { state.op = 'insert'; state.insertRow = row; return chain; },
      then: function (onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); },
      catch: function (onRejected) { return Promise.resolve(resolve()).catch(onRejected); },
      finally: function (onFinally) { return Promise.resolve(resolve()).finally(onFinally); },
    };
    return chain;
  }

  // job_readiness: the generic `chain` always resolves {data:[],error:null},
  // which breaks advanceJobVerifyPermit's `if (!res.data.length) return
  // {ok:false}` guard (crm-data.js ~848), so under ?test=1 the Permits
  // section's "Mark verified" button always silently no-ops (found while
  // building Increment V-min's order_parts route test). The bulk SELECT on
  // load stays [] on purpose, TEST_MODE fixtures own the initial readiness
  // rows (crm-data.js ~2118); this chain only needs to make the WRITE calls
  // (upsert/update) echo back a non-empty row so advanceJobVerifyPermit/
  // UnverifyPermit's own in-memory window.CRM.readiness update (which is
  // what the UI actually reads) is reached.
  function makeReadinessChain() {
    var state = { op: 'select', filters: {}, upsertRow: null };
    function resolve() {
      try {
        if (state.op === 'upsert') {
          return { data: [Object.assign({}, state.upsertRow)], error: null };
        }
        if (state.op === 'update') {
          var cid = state.filters.contact_id;
          return { data: cid ? [{ contact_id: cid }] : [], error: null };
        }
        return { data: [], error: null };
      } catch (e) {
        return { data: null, error: { message: String((e && e.message) || e) } };
      }
    }
    var rchain = {
      select: function () { return rchain; },
      eq: function (col, val) { state.filters[col] = val; return rchain; },
      limit: function () { return rchain; },
      order: function () { return rchain; },
      upsert: function (row) { state.op = 'upsert'; state.upsertRow = row; return rchain; },
      update: function (patch) { state.op = 'update'; state.patch = patch; return rchain; },
      single: function () { return rchain; },
      maybeSingle: function () { return rchain; },
      then: function (onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); },
      catch: function (onRejected) { return Promise.resolve(resolve()).catch(onRejected); },
      finally: function (onFinally) { return Promise.resolve(resolve()).finally(onFinally); },
    };
    return rchain;
  }

  return {
    from: function (table) {
      if (table === 'permit_jurisdictions') return makeJurisdictionChain();
      if (table === 'job_readiness') return makeReadinessChain();
      return chain;
    },
    channel: function () { return channel; },
    removeChannel: function () {},
    // Ionic Increment U: the three permit-portal RPCs. Real RPC names/args
    // per docs/qa/CRM-IONIC-U-SPEC.md. Never echoes the cleartext password
    // back in an error string, matching the floor rule.
    rpc: function (name, args) {
      args = args || {};
      if (name === 'native_operator_set_communications_state') {
        var confirmedState = {
          mark_thread_read: 'read',
          mark_thread_unread: 'unread',
          mark_voicemail_listened: 'listened',
          mark_voicemail_unlistened: 'unlistened',
        }[args.p_action];
        if (!confirmedState || !args.p_target_id || !args.p_operation_key) {
          return Promise.resolve({ data: null, error: { message: 'invalid communications state request' } });
        }
        return Promise.resolve({
          data: {
            schema: 'native_operator_communications_state_v1',
            result: 'updated',
            action: args.p_action,
            target_id: args.p_target_id,
            operation_key: args.p_operation_key,
            confirmed_state: confirmedState,
            changed_count: 1,
            applied_at: new Date().toISOString(),
          },
          error: null,
        });
      }
      if (name === 'set_permit_password') {
        var pid = args.p_id;
        var pw = args.p_password;
        var jRow = TEST_JURISDICTIONS.find(function (r) { return String(r.id) === String(pid); });
        if (!pw) {
          delete TEST_PW_STORE[pid];
          if (jRow) jRow.password_enc = null;
        } else {
          TEST_PW_STORE[pid] = pw;
          if (jRow) jRow.password_enc = 'x';
        }
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      if (name === 'get_permit_password') {
        return Promise.resolve({ data: TEST_PW_STORE[args.p_id] || null, error: null });
      }
      if (name === 'permit_log_portal_visit') {
        TEST_PORTAL_VISITS.push({ contact_id: args.p_contact_id, jurisdiction: args.p_jurisdiction, visited_at: new Date().toISOString() });
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    functions: { invoke: function (name, opts) {
      if (name === 'sub-admin-list') return subAdminList(opts);
      // Edit-details / onboarding-link actions: echo an ok so the Save + copy
      // flows complete under ?test=1 (real writes go through sub-upsert).
      // The onboard actions return a fake link, the field the client reads;
      // without it the copy/reissue flows error "No onboarding link" in test.
      if (name === 'sub-upsert') {
        var subAction = (opts && opts.body && opts.body.action) || '';
        if (subAction === 'copy_onboard' || subAction === 'reissue_onboard') return Promise.resolve({
          data: { ok: true, onboard_link: 'https://qa.backuppowerpro.com/subs/apply/?token=test-token', reused: subAction === 'copy_onboard' },
          error: null,
        });
        if (subAction === 'mark_payout_paid') {
          var payoutBody = (opts && opts.body) || {};
          var payout = TEST_PAYOUTS.find(function (p) { return p.id === payoutBody.payout_id; });
          if (!payout) return Promise.resolve({ data: { error: 'payout not found' }, error: null });
          var alreadyPaid = !!payout.paid_at;
          if (!alreadyPaid) {
            payout.paid_at = new Date().toISOString();
            payout.method = payoutBody.method || 'other';
          }
          return Promise.resolve({ data: { ok: true, payout: Object.assign({}, payout), already_paid: alreadyPaid }, error: null });
        }
        return Promise.resolve({ data: { ok: true, sub_id: 't-sub-1' }, error: null });
      }
      // Sub doc actions (Ionic Increment T1): view/verify a compliance
      // document. mode is read off opts.body, same convention subAdminList
      // uses for view above.
      if (name === 'sub-doc-access') {
        var docMode = (opts && opts.body && opts.body.mode) || '';
        if (docMode === 'signed_url') return Promise.resolve({
          data: { ok: true, url: 'https://hfatblrcwytxvijjhpal.supabase.co/storage/v1/object/sign/test-doc.pdf' },
          error: null,
        });
        if (docMode === 'verify') return Promise.resolve({ data: { ok: true }, error: null });
        return Promise.resolve({ data: null, error: null });
      }
      // Recompute the internal perf snapshot (Ionic Increment T1).
      if (name === 'sub-rank') return Promise.resolve({ data: { ok: true, perf_score: 82 }, error: null });
      // Add/list sub feedback (Ionic Increment T1).
      if (name === 'sub-feedback') {
        var feedbackBody = (opts && opts.body) || {};
        if (feedbackBody.action === 'add_incident' && feedbackBody.kind === 'failed_inspection') {
          var reworkJob = TEST_JOBS.find(function (j) { return j.offer_id === feedbackBody.offer_id || j.id === feedbackBody.offer_id; });
          if (!reworkJob) return Promise.resolve({ data: { error: 'offer not found' }, error: null });
          reworkJob.status = 'install_submitted';
          reworkJob.pass_submitted_at = null;
          reworkJob.approved_at = null;
          reworkJob.client_approval_confirmed_at = null;
          reworkJob.work_done_tested_confirmed_at = null;
          reworkJob.updated_at = new Date().toISOString();
          return Promise.resolve({ data: { ok: true, status: 'install_submitted' }, error: null });
        }
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      // Sub logo upload (Ionic Increment T1): echo a fake public url so the
      // upload flow completes under ?test=1 without a real storage write.
      // Field is logo_url, matching the real fn (sub-logo-upload/index.ts:102)
      // and what uploadSubLogo reads; a bare `url` here makes every test
      // upload fail with "no logo url returned".
      if (name === 'sub-logo-upload') return Promise.resolve({
        data: { ok: true, logo_url: 'https://hfatblrcwytxvijjhpal.supabase.co/storage/v1/object/public/sub-logos/test.png' },
        error: null,
      });
      // Ionic Increment T2: offer lifecycle stubs. Mutate TEST_JOBS so a
      // subsequent view:'jobs' load reflects the write (create/edit/withdraw/
      // approve). Without these, __invokeFn fall-through returns {data:null}
      // which reads as a SILENT false success.
      if (name === 'sub-offer-create') {
        var createBody = (opts && opts.body) || {};
        var existingActive = TEST_JOBS.find(function (j) {
          return j.contact_id === createBody.contact_id
            && ['offered', 'accepted', 'permit_submitted', 'install_submitted', 'pass_submitted'].indexOf(j.status) >= 0;
        });
        if (existingActive) {
          return Promise.resolve({
            data: { error: 'An active offer already exists for this contact. Withdraw it first, or refresh.' },
            error: null,
          });
        }
        var newId = 't-offer-' + Date.now();
        var created = __jobRow({
          id: newId, offer_id: newId,
          contact_id: createBody.contact_id,
          sub_id: createBody.sub_id || 't-sub-1',
          status: 'offered',
          permit_owner: 'bpp',
          permit_required: true,
          payout_amount: 314, payout_agreed_amount: null, payout_locked: false,
        });
        TEST_JOBS.unshift(created);
        return Promise.resolve({
          data: {
            ok: true, offer_id: newId, token: 'test-token',
            link: 'https://qa.backuppowerpro.com/subs/job/?t=test-token',
            payout_amount: created.payout_amount,
            payout_agreed_amount: null,
            permit_owner: created.permit_owner,
            permit_required: created.permit_required,
            sub_name: created.sub_name,
          },
          error: null,
        });
      }
      if (name === 'sub-offer-edit') {
        var editBody = (opts && opts.body) || {};
        var editJob = TEST_JOBS.find(function (j) { return j.offer_id === editBody.offer_id || j.id === editBody.offer_id; });
        if (!editJob) return Promise.resolve({ data: { error: 'offer not found' }, error: null });
        var ACCEPTED_EDIT = ['accepted', 'permit_submitted', 'install_submitted', 'pass_submitted', 'approved_paid'];
        if (editBody.payout_amount != null && ACCEPTED_EDIT.indexOf(editJob.status) >= 0
            && !(editBody.payout_revised_reason && String(editBody.payout_revised_reason).trim())) {
          return Promise.resolve({ data: { error: 'payout_revised_reason required after accept' }, error: null });
        }
        if (editBody.permit_owner != null || editBody.permit_required != null
            || editBody.permit_description != null || editBody.payout_permit_flat != null) {
          return Promise.resolve({ data: { error: 'Permit fields are managed by BPP and are not part of the subcontractor offer.' }, error: null });
        }
        Object.keys(editBody).forEach(function (k) {
          if (k === 'offer_id') return;
          if (k === 'scope_json' && editBody.scope_json && typeof editBody.scope_json === 'object') {
            editJob.scope_json = Object.assign({}, editJob.scope_json || {}, editBody.scope_json);
            return;
          }
          editJob[k] = editBody[k];
        });
        editJob.payout_locked = ACCEPTED_EDIT.indexOf(editJob.status) >= 0;
        editJob.updated_at = new Date().toISOString();
        return Promise.resolve({ data: { ok: true, offer: Object.assign({}, editJob) }, error: null });
      }
      if (name === 'sub-offer-withdraw') {
        var wBody = (opts && opts.body) || {};
        var wJob = TEST_JOBS.find(function (j) { return j.offer_id === wBody.offer_id || j.id === wBody.offer_id; });
        if (!wJob) return Promise.resolve({ data: { error: 'offer not found' }, error: null });
        if (['offered', 'accepted'].indexOf(wJob.status) < 0) {
          return Promise.resolve({ data: { error: 'offer changed, refresh and retry' }, error: null });
        }
        wJob.status = 'withdrawn';
        wJob.payout_locked = false;
        wJob.updated_at = new Date().toISOString();
        return Promise.resolve({ data: { ok: true, status: 'withdrawn' }, error: null });
      }
      if (name === 'sub-approve-payout') {
        var aBody = (opts && opts.body) || {};
        if (aBody.offer_id === 't-offer-attest-409') {
          return Promise.resolve({
            data: { error: 'Waiting on the sub to confirm client approval and work tested before payout can be approved.' },
            error: null,
          });
        }
        var aJob = TEST_JOBS.find(function (j) { return j.offer_id === aBody.offer_id || j.id === aBody.offer_id; });
        if (!aJob) return Promise.resolve({ data: { error: 'offer not found' }, error: null });
        var okStatus = aJob.status === 'pass_submitted';
        if (!okStatus) return Promise.resolve({ data: { error: 'offer is not ready for payout approval' }, error: null });
        aJob.status = 'approved_paid';
        aJob.payout_locked = true;
        aJob.updated_at = new Date().toISOString();
        var cents = Math.round(Number(aJob.payout_agreed_amount != null ? aJob.payout_agreed_amount : aJob.payout_amount) * 100);
        return Promise.resolve({ data: { ok: true, payout_cents: cents, status: 'approved_paid' }, error: null });
      }
      // Ionic Increment V-min: "Draft with AI" on ContactSubs job setup.
      // Deterministic fixture draft, never mutates TEST_JOBS (the draft is a
      // PRE-FILL only; Save still goes through sub-offer-edit, V-SPEC trap 5).
      if (name === 'sub-draft-scope') return Promise.resolve({
        data: {
          draft: {
            est_labor_hours: 4,
            timeframe_estimate: 'Half day',
          },
        },
        error: null,
      });
      // Ionic Increment V-min: manual "Send review request" on the Next-step
      // card. The real edge fn only sends the SMS; the __review_asked stamp
      // is applied client-side by advanceJobSendReview itself (crm-data.js
      // ~962), so this stub must NOT also stamp notes, doing so double-wrote
      // the marker (found scouting: two stamped lines from one tap).
      if (name === 'auto-review-ask') {
        return Promise.resolve({ data: { sent: true }, error: null });
      }
      // MMS attach flows (Ionic Increment Q): echo a fake public URL so the
      // attach-and-send / attach-and-schedule paths are harness-testable
      // without a real upload. No real storage write, no real contact check.
      if (name === 'crm-media-upload') return Promise.resolve({
        data: {
          ok: true,
          url: 'https://hfatblrcwytxvijjhpal.supabase.co/storage/v1/object/public/message-media/test-' + Date.now() + '.jpg',
          path: 'test',
        },
        error: null,
      });
      return Promise.resolve({ data: null, error: null });
    } },
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: { access_token: 'test-operator-token', user: { id: 'test-operator' } } } }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return Promise.resolve({ error: null }); },
    },
  };
}

const __db = TEST_MODE
  ? __makeStubDb()
  : (window.supabase
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null);

// window.db exposure removed 2026-07-01: its only consumer was the retired
// bpp_todos system (TodosButton/QuickCaptureFAB). Components reach the client
// through CRM.__db.

// Edge-function invoker. Forces the publishable anon key as Authorization
// because the user's session JWT (ES256) is rejected by edge functions
// configured for the legacy HS256 anon key. Same pattern as crm/v2/app.jsx.
function __invokeFn(name, opts = {}) {
  if (!__db) return Promise.resolve({ error: { message: 'supabase-js not loaded' } });
  // v10.1.30 fix: do NOT force Authorization: Bearer with the publishable
  // key. After Key disabled legacy JWT API keys (2026-04-23), Supabase's
  // gateway rejects any Authorization header that isn't a real JWT, with
  // UNAUTHORIZED_INVALID_JWT_FORMAT. The publishable key must travel via
  // the apikey header only, supabase-js sets that automatically when we
  // call functions.invoke. We were stomping on the working setup.
  return __db.functions.invoke(name, opts);
}

// ── Stage mapping (v2 numeric ↔ v3 string) ───────────────────────────────
const STAGE_NUM_TO_STR = {
  1: 'new',
  2: 'quoted',
  3: 'booked',
  4: 'permit_submit',
  5: 'permit_waiting',
  6: 'permit_approved',
  7: 'install',
  8: 'install',
  9: 'done',
};
const STAGE_STR_TO_NUM = { new:1, quoted:2, booked:3, permit_submit:4, permit_waiting:5, permit_approved:6, install:7, done:9 };

const STAGE_ORDER = ['new','quoted','booked','permit_submit','permit_waiting','permit_approved','install','done'];
const STAGE_LABELS = {
  new:'New', quoted:'Quoted', booked:'Booked',
  permit_submit:'Permit submit', permit_waiting:'Permit waiting', permit_approved:'Permit approved',
  install:'Install', done:'Done',
};

// Record a pipeline transition so the StageHistory / Pipeline card reflects
// reality. Only sub-mark-complete wrote stage_history before this; every
// in-CRM stage write (advanceStage, permit machine, addPermit, completeEvent)
// silently skipped it, so the Pipeline card under-records back-half motion.
// Best-effort, fire-and-forget; never blocks the stage UX. fromNum/toNum are
// numeric (v2 numbering) to match the stage_history schema (from_stage,
// to_stage; changed_at has a DB default). Mirrors sub-mark-complete's insert.
async function recordStageTransition(contactId, fromNum, toNum) {
  // NO-OP as of 2026-06-09. The DB trigger contacts_stage_change_record
  // (fn_record_stage_change) records EVERY contacts.stage change into
  // stage_history automatically, so the client-side insert this used to do was
  // a DUPLICATE (verified: a back-half walk produced 3->4, 3->4, 4->6, 4->6,
  // 6->9, 6->9). Kept as a no-op so the many callers (advanceStage,
  // PermitStatusActions, addPermit, AddEventInline, markInstalled,
  // completeEvent, the advanceJob* helpers) need no change and so the next
  // person who reaches for "record a transition" lands here and learns the
  // trigger owns it. Do NOT re-insert from the client.
  return;
}

// ── Back-half "advance the job" derivation engine (LOGIC ONLY, no visual) ──
// The pure state machine behind the banked advance-job card (brief:
// docs/design-briefs/back-half-job-flow.md). Derives the ONE next back-half
// action for a contact from DATA FIRST (permit rows, install events,
// install_date, invoices), with stage as the tiebreak, so out-of-order steps
// and skipped permits never force a dead step and already-done steps read as
// done. The approved Claude Design comp will consume this verbatim; until
// Key signs the comp off, NOTHING renders from it (no registry entry, no
// JSX here, per the net-new-visual hard rule).
//
// Inputs are the CRM's mapped shapes: contact {stage, install_date},
// data { permits:[{status, submitted_at, approved_at}], events:[{kind,
// start_at, completed_at?}], invoices:[{status, total}] }.
// Returns { state, label, sublabel, doneSteps:[...], stageNum } where state is
// one of: submit_permit | mark_approved | schedule_install | install_upcoming
// | mark_installed | record_payment | complete | front_half (stage < booked).
function advanceJobNext(contact, data) {
  var d = data || {};
  var stageNum = (STAGE_STR_TO_NUM[contact && contact.stage] != null)
    ? STAGE_STR_TO_NUM[contact.stage] : 0;
  if (!contact || stageNum < 3) return { state: 'front_half', label: null, sublabel: null, doneSteps: [], stageNum: stageNum };

  var permits = d.permits || [];
  var events = d.events || [];
  var invoices = d.invoices || [];
  var now = Date.now();

  // Newest permit gates the flow. CRM.permits is fetched created_at ASCENDING,
  // so pick by max created_at when present, else the LAST element (critic
  // 2026-06-09: permits[0] was the OLDEST row, which gated on a stale permit
  // whenever a job had a resubmitted/second permit).
  var permit = null;
  for (var pi = 0; pi < permits.length; pi++) {
    var cand = permits[pi];
    if (!permit) { permit = cand; continue; }
    if (cand.created_at && permit.created_at) {
      if (new Date(cand.created_at) >= new Date(permit.created_at)) permit = cand;
    } else {
      permit = cand; // no created_at: ascending fetch order, later wins
    }
  }
  var permitApproved = !!(permit && (permit.status === 'approved' || permit.approved_at));
  // Pending means actually IN the county's hands: submitted (or blocked mid
  // review). A not_started row exists before submission (the permit-start
  // reminder trigger creates one), and must yield submit_permit, not
  // mark_approved (critic 2026-06-09).
  var permitSubmitted = !!(permit && (permit.submitted_at || permit.status === 'submitted' || permit.status === 'blocked' || permitApproved));
  var permitPending = !!(permit && permitSubmitted && !permitApproved);
  // Cancelled events are dead; every other consumer filters them out too
  // (critic 2026-06-09: a cancelled install read as "scheduled").
  var installEvents = events.filter(function (e) { return e.kind === 'install' && e.start_at && e.status !== 'cancelled'; });
  var futureInstall = installEvents.filter(function (e) { return new Date(e.start_at).getTime() > now; })
    .sort(function (a, b) { return new Date(a.start_at) - new Date(b.start_at); })[0] || null;
  var pastInstall = installEvents.filter(function (e) { return new Date(e.start_at).getTime() <= now; })
    .sort(function (a, b) { return new Date(b.start_at) - new Date(a.start_at); })[0] || null;
  var installed = stageNum >= 9
    || (contact.install_date && new Date(contact.install_date).getTime() <= now && stageNum >= 7);
  var paidInvoice = invoices.some(function (i) { return i.status === 'paid'; });
  // Closed statuses follow the CRM's canon (FINAL_INVOICE uses 'voided' and
  // 'refunded'; the void handler writes 'voided'). Critic 2026-06-09: the
  // old list checked 'void', so a voided-then-reissued-then-paid job stuck
  // at record_payment forever.
  var CLOSED_INVOICE = { paid: 1, voided: 1, refunded: 1, declined: 1, void: 1, cancelled: 1 };
  var openInvoice = invoices.some(function (i) { return i.status && !CLOSED_INVOICE[i.status]; });

  // Readiness row for this contact, resolved once (used by the permit_verified
  // doneStep AND gate 1 below, so they can never read different rows). d.readiness
  // is the SINGLE row when a caller passes it; otherwise filter window.CRM.
  var readinessRow = d.readiness !== undefined ? d.readiness
    : ((window.CRM && window.CRM.readiness || []).filter(function (r) { return r.contact_id === contact.id; })[0] || null);
  var permitVerifiedAt = readinessRow && readinessRow.permit_verified_at;

  var doneSteps = [];
  if (permit && permitSubmitted) doneSteps.push({ step: 'permit_submitted', at: permit.submitted_at || null });
  if (permitApproved) doneSteps.push({ step: 'permit_approved', at: permit.approved_at || null });
  // Verified is a durable done fact (its only inverse used to be a 5s toast).
  if (permitVerifiedAt) doneSteps.push({ step: 'permit_verified', at: permitVerifiedAt });
  if (futureInstall || pastInstall || contact.install_date) doneSteps.push({ step: 'install_scheduled', at: (futureInstall || pastInstall || {}).start_at || contact.install_date });
  if (installed) doneSteps.push({ step: 'installed', at: contact.install_date || (pastInstall && pastInstall.start_at) || null });
  if (paidInvoice) doneSteps.push({ step: 'paid', at: null });

  // The event a "mark installed" action operates on (the past install if any,
  // else the upcoming one); the gating permit drives "mark approved".
  var actionEvent = pastInstall || futureInstall || null;
  function out(state, label, sublabel) {
    return { state: state, label: label, sublabel: sublabel || null, doneSteps: doneSteps, stageNum: stageNum, permit: permit, installEvent: actionEvent };
  }

  // Walk backwards from the end of the job so already-done later steps win
  // over undone earlier ones (the brief's skip rule: never force a prior step).
  if (installed) {
    if (paidInvoice && !openInvoice) return out('complete', 'Job complete', 'Installed + paid');
    return out('record_payment', 'Record payment', openInvoice ? 'Invoice outstanding' : 'No invoice yet');
  }
  if (pastInstall || (contact.install_date && new Date(contact.install_date).getTime() <= now)) {
    return out('mark_installed', 'Mark installed', 'Install date has passed');
  }
  if (futureInstall) {
    var days = Math.ceil((new Date(futureInstall.start_at).getTime() - now) / 86400000);
    return out('install_upcoming', 'Install scheduled', days <= 0 ? 'Today' : 'In ' + days + ' day' + (days === 1 ? '' : 's'));
  }
  if (permitApproved || stageNum >= 6) {
    // ── Readiness gates (Operating Model 2026 build #2) ──────────────
    // Between permit-approved and schedule_install, two gates must clear:
    // (1) Key VERIFIES the county approval (job_readiness.permit_verified_at,
    //     the state the permit table never had); (2) the specialty parts
    //     (inlet, interlock, breaker) are ordered and in hand, derived from
    //     the LIVE materials rows. Both resolve from window.CRM when the
    //     caller does not pass them, so all existing call sites keep working.
    var mats = d.materials !== undefined ? d.materials
      : (window.CRM && window.CRM.materials || []).filter(function (m) { return m.contact_id === contact.id; });
    // Gate 1: verify the permit. Only when a real approved permit exists;
    // a manually stage-advanced job with no permit row has nothing to verify.
    // permitVerifiedAt was resolved once above (shared with the done trail).
    if (permitApproved && !permitVerifiedAt) {
      return out('verify_permit', 'Verify the permit',
        (permit && permit.permit_number && permit.permit_number !== 'PENDING') ? ('#' + permit.permit_number + ' approved, look it over') : 'County says approved, confirm it');
    }
    // Gate 2: specialty parts. Newest row per kind wins (same rule as permits).
    // MUST match InstallSpecCard's PERMANENT placeholder rows (crm-right.jsx:
    // inlet/interlock/cord), because a missing row counts as not_ordered and
    // the routed "Open parts list" surface only lets Key clear the kinds it
    // shows as permanent. Listing 'breaker' here (an EXTRA_KINDS pick behind a
    // collapsed picker) dead-ended every job at order_parts: the gate wanted a
    // received breaker row the card never created (adversarial review 2026-07-02,
    // confirmed high, two lenses). readiness-buzz/index.ts SPECIALTY mirrors this.
    // The twin-breaker as a 4th gated specialty part (operating model R4) is
    // PARKED until it becomes a permanent card row (see docs/PARKED-WORK.md).
    var SPECIALTY = ['inlet', 'interlock', 'cord'];
    var notOrdered = [], onOrder = [];
    for (var si = 0; si < SPECIALTY.length; si++) {
      var kindRows = mats.filter(function (m) { return m.kind === SPECIALTY[si]; });
      var newest = null;
      for (var ki = 0; ki < kindRows.length; ki++) {
        // Mirror the permits loop: a row missing created_at wins by array order
        // (materials are fetched created_at ASC + local pushes append), so a
        // just-inserted cache row without a stamp still displaces an older one.
        if (!newest) { newest = kindRows[ki]; continue; }
        if (kindRows[ki].created_at && newest.created_at) {
          if (new Date(kindRows[ki].created_at) >= new Date(newest.created_at)) newest = kindRows[ki];
        } else {
          newest = kindRows[ki];
        }
      }
      if (!newest || newest.status === 'not_ordered') notOrdered.push(SPECIALTY[si]);
      else if (newest.status === 'ordered') onOrder.push(SPECIALTY[si]);
      // received / installed = in hand, gate clear for that kind
    }
    if (notOrdered.length) {
      return out('order_parts', 'Order parts', notOrdered.join(', ') + ' not ordered yet');
    }
    if (onOrder.length) {
      return out('parts_in_transit', 'Parts on the way', onOrder.join(', ') + ' ordered, not in hand');
    }
    // Gates clear: surface the AI-suggested date on the card (suggest,
    // never ask); the accept tap pre-fills the add-event form with it.
    var sug = suggestInstallDate(window.CRM && window.CRM.events);
    var ready = out('schedule_install', 'Schedule install',
      sug ? ('Suggested: ' + sug.label + (permitApproved ? ', permit verified, parts in hand' : ''))
          : (permitApproved ? 'Permit verified, parts in hand' : null));
    if (sug) ready.suggestedDate = sug.date;
    return ready;
  }
  // A blocked or rejected permit is NOT "awaiting the county" , the county
  // kicked it back and the operator must resolve it (the Permits card below has
  // the "Resolve blocker" control). Surface that truthfully with the blocker
  // reason instead of the misleading "Mark permit approved". No action button:
  // the Permits card owns the status controls, so a route/button here would be
  // redundant. Catches blocked + rejected; 'waiting'/'submitted' stay pending.
  if (permit && !permitApproved && (permit.status === 'blocked' || permit.status === 'rejected')) {
    var blockedLabel = permit.status === 'rejected' ? 'Permit rejected' : 'Permit blocked';
    var blockedSub = permit.blocker_note ? permit.blocker_note : 'Resolve in Permits below';
    return out('permit_blocked', blockedLabel, blockedSub);
  }
  if (permitPending) {
    var waitDays = permit.submitted_at ? Math.floor((now - new Date(permit.submitted_at).getTime()) / 86400000) : null;
    return out('mark_approved', 'Mark permit approved', waitDays != null ? 'Waiting ' + waitDays + ' day' + (waitDays === 1 ? '' : 's') : 'Awaiting the county');
  }
  return out('submit_permit', 'Submit permit', 'Start the back half');
}

// ── Advance-job ONE-TAP write actions (consumed by the AdvanceJobCard) ──────
// Each mirrors the existing control's write EXACTLY so the new card and the
// legacy controls (PermitStatusActions.advance, addPermit, markInstalled) stay
// consistent: same fields, same forward-only stage guard, same
// recordStageTransition. Optimistic in-memory update + DB write + revert on
// error. Returns { ok, error?, skipped? }. (Convergence follow-up: route the
// legacy controls through these too, then there is one write path per action.)
const _STAGE_NUM_TO_STR = { 1:'new', 2:'quoted', 3:'booked', 4:'permit_submit', 5:'permit_waiting', 6:'permit_approved', 7:'install', 9:'done' };

async function _advanceContactStage(contact, toNum) {
  if (!window.CRM?.__db || !contact || toNum == null) return { ok:false, error:'no db/contact' };
  var curNum = (STAGE_STR_TO_NUM[contact.stage] != null) ? STAGE_STR_TO_NUM[contact.stage] : 0;
  if (toNum <= curNum) return { ok:true, skipped:true }; // forward-only, never drag a job back
  var prev = contact.stage;
  contact.stage = _STAGE_NUM_TO_STR[toNum] || contact.stage;
  var res = await window.CRM.__db.from('contacts').update({ stage: toNum }).eq('id', contact.id);
  if (res && res.error) { contact.stage = prev; return { ok:false, error: res.error.message }; }
  await recordStageTransition(contact.id, curNum, toNum);
  return { ok:true };
}

// submit_permit: mark the permit submitted today + advance Booked -> Permit
// submit. CRITICAL (both critics 2026-06-09): the trg_proposal_approved_permit_start
// trigger auto-creates a 'not_started' permit row the instant a proposal is
// approved, so the common sold-job already HAS a permit row. If we always
// inserted (the old behavior) we would litter every job with a duplicate. So:
// UPDATE an existing not_started row in place (mirrors PermitStatusActions.
// advance('submitted')); only INSERT when there genuinely is no permit row.
// existingPermit is the engine's gating permit (next.permit).
async function advanceJobSubmitPermit(contact, existingPermit) {
  if (!window.CRM?.__db || !contact) return { ok:false, error:'no db/contact' };
  var today = new Date().toISOString().slice(0, 10);

  // Path A: advance the existing not_started row (the normal sold-job case).
  if (existingPermit && existingPermit.id && existingPermit.status === 'not_started') {
    var prev = { status: existingPermit.status, submitted_at: existingPermit.submitted_at };
    existingPermit.status = 'submitted'; existingPermit.submitted_at = today;
    var upd = await window.CRM.__db.from('permits').update({ status: 'submitted', submitted_at: today }).eq('id', existingPermit.id);
    if (upd && upd.error) { existingPermit.status = prev.status; existingPermit.submitted_at = prev.submitted_at; return { ok:false, error: upd.error.message }; }
    return await _advanceContactStage(contact, 4);
  }

  // Path B: no permit row yet -> insert a submitted one (jurisdiction predicted).
  var pred = (typeof predictJurisdiction === 'function' && contact.address) ? predictJurisdiction(contact.address) : null;
  var jname = (pred && pred.jurisdiction) || contact.jurisdiction || null;
  var jurisdiction_id = null;
  try {
    if (jname) { var jr = await window.CRM.__db.from('permit_jurisdictions').select('id').eq('name', jname).limit(1); if (jr && jr.data && jr.data[0]) jurisdiction_id = jr.data[0].id; }
  } catch (e) {}
  var ins = await window.CRM.__db.from('permits').insert({
    contact_id: contact.id, jurisdiction_id: jurisdiction_id, jurisdiction_name: jname,
    status: 'submitted', submitted_at: today, permit_number: 'PENDING', cost_cents: 0,
  }).select().single();
  if (ins && ins.error) return { ok:false, error: ins.error.message };
  var row = (ins && ins.data) || {};
  (window.CRM.permits = window.CRM.permits || []).push({
    id: row.id, contact_id: contact.id, jurisdiction: row.jurisdiction_name || jname,
    jurisdiction_name: row.jurisdiction_name || jname, jurisdiction_id: row.jurisdiction_id || null,
    permit_number: row.permit_number || 'PENDING', status: 'submitted', submitted_at: today,
    approved_at: null, cost_cents: 0, blocker_note: null, created_at: row.created_at || new Date().toISOString(),
  });
  return await _advanceContactStage(contact, 4);
}

// mark_approved: stamp the gating permit approved + advance to Permit approved.
async function advanceJobMarkApproved(contact, permit) {
  if (!window.CRM?.__db || !permit) return { ok:false, error:'no permit' };
  var today = new Date().toISOString().slice(0, 10);
  var prev = { status: permit.status, approved_at: permit.approved_at };
  permit.status = 'approved'; permit.approved_at = today;
  var res = await window.CRM.__db.from('permits').update({ status: 'approved', approved_at: today }).eq('id', permit.id);
  if (res && res.error) { permit.status = prev.status; permit.approved_at = prev.approved_at; return { ok:false, error: res.error.message }; }
  return await _advanceContactStage(contact, 6);
}

// Suggest an install date (Operating Model 2026 build #2, slice B).
// CLIENT-SIDE v1: pure derivation from the calendar the CRM already holds
// (90 days of events), zero stored state so nothing can drift. Picks the
// first weekday, starting two days out, that has NO scheduled install on
// it anywhere on the calendar. Per-sub capacity refinement is the
// post-sitting server-side upgrade (subcontractors table is PARKED);
// docs/JOB-READINESS-DESIGN-INPUT.md section 4 has the full design.
// Suggest, never book: the date only pre-fills the add-event form; Key
// confirms with the client personally and the write path is unchanged.
function suggestInstallDate(allEvents) {
  var events = allEvents || (window.CRM && window.CRM.events) || [];
  var busy = {};
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (e.kind !== 'install' || e.status === 'cancelled' || !e.start_at) continue;
    var d = new Date(e.start_at);
    busy[d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()] = true;
  }
  var DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (var off = 2; off <= 21; off++) {
    var cand = new Date(Date.now() + off * 86400000);
    var dow = cand.getDay();
    if (dow === 0 || dow === 6) continue; // weekdays only
    var key = cand.getFullYear() + '-' + (cand.getMonth() + 1) + '-' + cand.getDate();
    if (busy[key]) continue;
    return {
      date: cand.getFullYear() + '-' + String(cand.getMonth() + 1).padStart(2, '0') + '-' + String(cand.getDate()).padStart(2, '0'),
      label: DAY[dow] + ' ' + MON[cand.getMonth()] + ' ' + cand.getDate(),
    };
  }
  return null; // calendar packed 3 weeks out: no suggestion, default stands
}

// verify_permit: Key confirms the county approval (Operating Model 2026
// build #2). UPSERTs the contact's job_readiness row (rows are lazy) and
// patches the local cache so the card advances before realtime lands.
// No stage change: verification is a readiness gate, not a lifecycle step.
async function advanceJobVerifyPermit(contact) {
  if (!window.CRM?.__db || !contact) return { ok:false, error:'no db/contact' };
  var nowIso = new Date().toISOString();
  var res = await window.CRM.__db.from('job_readiness')
    .upsert({ contact_id: contact.id, permit_verified_at: nowIso, updated_at: nowIso }, { onConflict: 'contact_id' })
    .select('contact_id');
  if (res && res.error) return { ok:false, error: res.error.message };
  if (!res || !res.data || !res.data.length) return { ok:false, error: 'no row written' };
  var list = (window.CRM.readiness = window.CRM.readiness || []);
  var row = list.filter(function (r) { return r.contact_id === contact.id; })[0];
  if (row) row.permit_verified_at = nowIso;
  else list.push({ contact_id: contact.id, permit_verified_at: nowIso });
  // Bump the array ref (the standing scar): React consumers compare refs; an
  // in-place mutate is invisible to useMemo/useState equality. The bespoke
  // tolerated the mutation; the Ionic verify row did not (found in S1).
  window.CRM.readiness = list.slice();
  window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'job_readiness' } }));
  // Same inverse the durable "Permit verified , Undo" control uses, so the
  // 5s toast and the persistent affordance can never diverge (review 2026-07-02).
  return { ok:true, undo: function () { return advanceJobUnverifyPermit(contact); } };
}

// The durable inverse of advanceJobVerifyPermit. The 5s undo toast was the ONLY
// way to un-verify a mistaken tap; after it expired the fact was invisible and
// permanent without SQL (adversarial review 2026-07-02, confirmed med). This is
// surfaced as a quiet "Permit verified <date> , Undo" line on the AdvanceJobCard
// once the permit is verified, so the write always has a visible inverse.
async function advanceJobUnverifyPermit(contact) {
  if (!window.CRM?.__db || !contact) return { ok:false, error:'no db/contact' };
  var u = await window.CRM.__db.from('job_readiness')
    .update({ permit_verified_at: null, updated_at: new Date().toISOString() })
    .eq('contact_id', contact.id).select('contact_id');
  if (u && u.error) return { ok:false, error: u.error.message };
  var r2 = (window.CRM.readiness || []).filter(function (r) { return r.contact_id === contact.id; })[0];
  if (r2) r2.permit_verified_at = null;
  window.CRM.readiness = (window.CRM.readiness || []).slice(); // ref bump, same scar as verify
  window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'job_readiness' } }));
  return { ok:true };
}

// mark_installed: complete the install event (if any) + stamp install_date
// (when missing) + advance to Done. ONE contacts update {stage:9, install_date?}
// matching markInstalled (crm-todos) + completeEvent (crm-left) exactly.
async function advanceJobMarkInstalled(contact, installEvent) {
  if (!window.CRM?.__db || !contact) return { ok:false, error:'no db/contact' };
  if (installEvent && installEvent.id && installEvent.status !== 'completed') {
    var ev = await window.CRM.__db.from('calendar_events').update({ status: 'completed' }).eq('id', installEvent.id);
    if (!(ev && ev.error)) installEvent.status = 'completed';
  }
  var prevNum = (STAGE_STR_TO_NUM[contact.stage] != null) ? STAGE_STR_TO_NUM[contact.stage] : 0;
  var patch = { stage: 9 };
  if (!contact.install_date) patch.install_date = (installEvent && installEvent.start_at) || new Date().toISOString();
  var prev = { stage: contact.stage, install_date: contact.install_date };
  contact.stage = 'done'; if (patch.install_date) contact.install_date = patch.install_date;
  var res = await window.CRM.__db.from('contacts').update(patch).eq('id', contact.id);
  if (res && res.error) { contact.stage = prev.stage; contact.install_date = prev.install_date; return { ok:false, error: res.error.message }; }
  if (prevNum < 9) await recordStageTransition(contact.id, prevNum, 9);
  return { ok:true };
}

// Manual "Send review request" from the Next-step card. Calls auto-review-ask
// in SINGLE mode: it sends the SAME review SMS the nightly bot sends AND
// stamps the __review_asked marker, which is exactly what makes the bot skip
// this contact. So a manual tap auto-disables the bot fallback for this one
// customer with no second system to keep in sync.
async function advanceJobSendReview(contact) {
  if (!window.CRM?.__db || !contact) return { ok:false, error:'no db/contact' };
  if (contact.do_not_contact) return { ok:false, error:'on do-not-contact' };
  if (!contact.phone) return { ok:false, error:'no phone on file' };
  if ((contact.notes || '').includes('__review_asked:')) return { ok:false, error:'already asked' };
  const { data, error } = await window.CRM.__invokeFn('auto-review-ask', { body: { contact_id: contact.id } });
  if (error) return { ok:false, error: (error.message || String(error)) };
  if (!data || !data.sent) {
    const reason = (data && data.result && (data.result.skip || data.result.error)) || 'not sent';
    return { ok:false, error: reason };
  }
  // Optimistic local stamp so the button hides immediately and the bot-skip is
  // reflected without waiting for a refetch.
  contact.notes = (contact.notes ? contact.notes + '\n' : '') + '__review_asked: ' + new Date().toISOString();
  return { ok:true };
}

// ── Draft-proposal generator (quote-coverage build, savant audit #1) ───────
// On a flat-rate product the quote conversation is a deleted step: this
// generates the standard-configuration DRAFT so Key's action collapses to
// review + send. NOTHING here sends anything; the row lands as status
// 'Created' (renders as the Draft pill) exactly like a hand-created draft
// from NewProposalModal, and the Send button on the FinanceRow stays the
// only dispatch trigger.
//
// Write-shape parity is the contract: the payload below mirrors
// NewProposalModal.submit() column-for-column (legacy mirrors included)
// with confirmed amperage and run distance, cord+inlet+permit included, no
// line items, no discount, PoM not offered, and the required deposit. The
// total comes through quoteV3Total so pricing changes propagate.
// Returns { ok:true, proposal } (proposal = mapProposal shape, already
// pushed into window.CRM.proposals) or { ok:false, error }.
const _DEAD_PROPOSAL_STATUSES = ['cancelled', 'declined', 'expired'];

function _hasLiveProposalLocal(contactId) {
  // Same live-proposal canon as the Ready-to-quote lens: any non-superseded
  // proposal whose mapped (lowercased) status isn't dead counts, drafts
  // included.
  return (window.CRM?.proposals || []).some(function (p) {
    return p.contact_id === contactId && !p.superseded_at
      && _DEAD_PROPOSAL_STATUSES.indexOf(p.status) === -1;
  });
}

// Synchronous in-flight guard. React-state busy flags can't stop a fast
// double/triple tap (state updates are async, so every synchronous click
// reads the same pre-update state), and the DB re-check below races when
// two generations are in flight at once (both selects resolve before
// either insert commits). This Set is mutated synchronously, so the
// second tap is refused before any await. Verified by the triple-tap
// harness (2026-06-11): without this, 3 taps = 3 inserts.
const _draftGenInFlight = new Set();

// Flow C: latest pre-read for a contact (the Price Brief row's data).
// Read-only via the operator policy; returns null when none exists, so
// callers render nothing for pre-Flow-C contacts. Cache both completed and
// in-flight reads for this app session: contact siblings must share one stable
// answer, not visibly fill themselves in after an operator pans to a tab.
var _preReadCache = new Map();

function fetchPreRead(contactId) {
  var key = String(contactId || '');
  if (!key) return Promise.resolve(null);
  if (_preReadCache.has(key)) return Promise.resolve(_preReadCache.get(key));
  var request = fetchPreReadFresh(contactId).then(function (data) {
    _preReadCache.set(key, data || null);
    return data || null;
  }).catch(function () {
    _preReadCache.set(key, null);
    return null;
  });
  _preReadCache.set(key, request);
  return request;
}

function peekPreRead(contactId) {
  var cached = _preReadCache.get(String(contactId || ''));
  return cached && typeof cached.then !== 'function' ? cached : null;
}

async function fetchPreReadFresh(contactId) {
  // TEST_MODE serves the synthetic fixture for this contact (the detail page's
  // walk verdict + quote-desk read); production falls through to the real query.
  if (TEST_MODE) return (window.CRM && window.CRM.__testPreReads && window.CRM.__testPreReads[contactId]) || null;
  if (!window.CRM?.__db || !contactId) return null;
  try {
    var q = await window.CRM.__db
      .from('property_pre_reads')
      .select('id, token, confidence, subdivision, predicted_panel_room, clone_contact_id, confirmed_panel_room, confirmed_generator_spot, customer_run_ft_estimate, distance_band, photo_received_at, photo_read, save_later_requested_at, first_viewed_at, view_count, range_low_cents, range_high_cents, gift_requested_at, thankyou_at, completion_notified_at, connection_status, generator_ownership_status, generator_needed_active')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (q.error) return null;
    return q.data || null;
  } catch (_) { return null; }
}

// Bulk funnel-state read for the native MVP contact list (walkVerdict in
// ionic-data.js). Returns a plain object keyed by contact_id -> the latest
// pre-read's walk-progress fields, so the list can render each lead's walk
// verdict and filter finished/unfinished without an N+1 per-row fetch. Only
// the native Ionic list calls this; the bespoke CRM boot path is untouched.
// Read-only via the operator policy; any failure yields {} (rows just show no
// walk verdict). Latest-per-contact wins via the created_at desc order.
var _preReadsBulkCache = null;
var _preReadsBulkPromise = null;

function fetchPreReadsBulk(force) {
  if (!force && _preReadsBulkCache) return Promise.resolve(_preReadsBulkCache);
  if (!force && _preReadsBulkPromise) return _preReadsBulkPromise;
  var request = fetchPreReadsBulkFresh().then(function (map) {
    _preReadsBulkCache = map || {};
    return _preReadsBulkCache;
  }).catch(function () {
    _preReadsBulkCache = {};
    return _preReadsBulkCache;
  }).finally(function () {
    if (_preReadsBulkPromise === request) _preReadsBulkPromise = null;
  });
  _preReadsBulkPromise = request;
  return request;
}

function peekPreReadsBulk() {
  return _preReadsBulkCache;
}

async function fetchPreReadsBulkFresh() {
  // TEST_MODE serves synthetic fixtures (the real per-contact query is stubbed
  // to [] by __makeStubDb); production always falls through to the real query.
  if (TEST_MODE) return (window.CRM && window.CRM.__testPreReads) || {};
  if (!window.CRM?.__db) return {};
  try {
    var q = await window.CRM.__db
      .from('property_pre_reads')
      .select('id, contact_id, confirmed_panel_room, confirmed_generator_spot, customer_run_ft_estimate, distance_band, photo_received_at, gift_requested_at, thankyou_at, completion_notified_at, connection_status, generator_ownership_status, generator_needed_active, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (q.error || !q.data) return {};
    var byContact = {};
    for (var i = 0; i < q.data.length; i++) {
      var r = q.data[i];
      if (r && r.contact_id && !(r.contact_id in byContact)) byContact[r.contact_id] = r;
    }
    return byContact;
  } catch (_) { return {}; }
}

var _quoteWalkV2ReceiptPromise = null;

async function fetchQuoteWalkV2Receipts(force) {
  if (!force && _quoteWalkV2ReceiptPromise) return _quoteWalkV2ReceiptPromise;
  var request = fetchPreReadsBulk(force).then(function (preReads) {
    return fetchQuoteWalkV2ReceiptMap(window.CRM && window.CRM.__db, preReads);
  }).then(function (receipts) {
    window.CRM.quoteWalkV2Receipts = receipts || {};
    window.dispatchEvent(new CustomEvent('crm-data-changed', {
      detail: { table: 'quote_walk_v2_operator_receipt' },
    }));
    return window.CRM.quoteWalkV2Receipts;
  }).catch(function () {
    window.CRM.quoteWalkV2Receipts = {};
    return window.CRM.quoteWalkV2Receipts;
  }).finally(function () {
    if (_quoteWalkV2ReceiptPromise === request) _quoteWalkV2ReceiptPromise = null;
  });
  _quoteWalkV2ReceiptPromise = request;
  return request;
}

async function fetchQuoteWalkV2ReceiptForContact(contactId, force) {
  var contactKey = String(contactId || '');
  if (!contactKey) return { error: 'contact_id_missing' };
  if (!force && window.CRM.quoteWalkV2Receipts
      && window.CRM.quoteWalkV2Receipts[contactKey]) {
    return window.CRM.quoteWalkV2Receipts[contactKey];
  }
  var receipt;
  try {
    var preRead = await fetchPreRead(contactKey);
    receipt = preRead && preRead.id
      ? await fetchQuoteWalkV2OperatorReceipt(
          window.CRM && window.CRM.__db,
          preRead.id
        )
      : { error: 'not_found' };
  } catch (error) {
    receipt = {
      error: error && error.message
        ? String(error.message)
        : 'operator_receipt_failed',
    };
  }
  window.CRM.quoteWalkV2Receipts = Object.assign(
    {},
    window.CRM.quoteWalkV2Receipts || {},
    { [contactKey]: receipt }
  );
  window.dispatchEvent(new CustomEvent('crm-data-changed', {
    detail: { table: 'quote_walk_v2_operator_receipt', contact_id: contactKey },
  }));
  return receipt;
}

async function markQuoteWalkV2NotificationSeen(contactId) {
  var contactKey = String(contactId || '');
  if (!contactKey) return { ok: false, error: 'contact_id_missing' };
  var receipt = window.CRM.quoteWalkV2Receipts
    ? window.CRM.quoteWalkV2Receipts[contactKey]
    : null;
  if (!receipt || receipt.error) {
    receipt = await fetchQuoteWalkV2ReceiptForContact(contactKey, true);
  }
  var result = await markQuoteWalkV2OperatorNotificationSeen(
    window.CRM && window.CRM.__db,
    receipt
  );
  if (!result.ok || result.skipped) return result;
  var refreshed = await fetchQuoteWalkV2ReceiptForContact(contactKey, true);
  return { ok: true, notification: result.notification, receipt: refreshed };
}

async function claimQuoteWalkV2Handoff(contact) {
  if (!contact || !contact.id) return { ok: false, error: 'No contact selected' };
  if (contact.do_not_contact) {
    return { ok: false, error: 'Quote Desk claim is blocked by do not contact.' };
  }
  if (contact.archived) {
    return { ok: false, error: 'Quote Desk claim is blocked for an archived contact.' };
  }
  var receipt = await fetchQuoteWalkV2ReceiptForContact(contact.id, true);
  var verdict = quoteWalkV2ReceiptVerdict(receipt);
  if (!verdict.ready) {
    return { ok: false, error: verdict.message, verdict: verdict };
  }
  var result = await consumeQuoteWalkV2HandoffReceipt(
    window.CRM && window.CRM.__db,
    receipt
  );
  if (result.ok) {
    var refreshed = await fetchQuoteWalkV2ReceiptForContact(contact.id, true);
    if (refreshed && refreshed.error) {
      window.CRM.quoteWalkV2Receipts = Object.assign(
        {},
        window.CRM.quoteWalkV2Receipts || {},
        {
          [String(contact.id)]: Object.assign({}, receipt, {
            handoff_status: 'claimed',
            handoff: Object.assign({}, receipt.handoff || {}, {
              status: 'claimed',
              claimed_at: result.claimed_at || null,
              read_only_history: true,
            }),
          }),
        }
      );
      window.dispatchEvent(new CustomEvent('crm-data-changed', {
        detail: { table: 'quote_walk_v2_quote_handoffs', contact_id: contact.id },
      }));
    }
  }
  return result;
}

// ── Quote Desk (lead → firm quote speed, 2026-07-13) ───────────────────
// Walk shows a ballpark RANGE; Key still texts the FIRM number by hand.
// These helpers draft the SMS + feed draft proposals from walk / pre-read
// facts. NOTHING sends. sessionStorage 'draft:<id>' is the established
// composer prefill key (Rescue / Work queue / ContactMessages).

function _quoteDeskFirstName(contact) {
  var raw = (contact && contact.name) ? String(contact.name).trim() : '';
  if (!raw) return '';
  return raw.split(/\s+/)[0] || '';
}

function _quoteDeskAmp(contact, preRead) {
  var amp = contact && contact.amperage != null ? String(contact.amperage) : '';
  if (amp === '30' || amp === '50') return amp;
  // photo_read occasionally carries amperage; prefer contact column.
  var photo = preRead && preRead.photo_read;
  if (photo && (photo.amperage === 30 || photo.amperage === 50 || photo.amperage === '30' || photo.amperage === '50')) {
    return String(photo.amperage);
  }
  return null;
}

function _quoteDeskRunFt(contact, preRead) {
  var runFt = contact && contact.run_ft_estimate != null ? Number(contact.run_ft_estimate) : NaN;
  if (!(isFinite(runFt) && runFt > 0) && preRead && preRead.customer_run_ft_estimate != null) {
    runFt = Number(preRead.customer_run_ft_estimate);
  }
  if (!(isFinite(runFt) && runFt > 0)) return { lengthFt: null, runFt: null, distanceUnconfirmed: true };
  var lengthFt = Math.min(100, Math.max(5, Math.ceil(runFt / 5) * 5));
  return { lengthFt: lengthFt, runFt: runFt, distanceUnconfirmed: false };
}

// Suggested firm dollars for Key's thumb. Prefer the live pricing engine
// (same inputs as generateDraftProposal). Fall back to walk range midpoint
// when the engine is unavailable. Always a SUGGESTION; Key edits before send.
function suggestFirmQuote(contact, preRead) {
  if (!preRead || preRead.generator_needed_active
      || (preRead.connection_status !== 'confirmed_30' && preRead.connection_status !== 'confirmed_50')) {
    return {
      ready: false,
      missingFacts: ['generator connection'],
      dollars: null,
      amp: null,
      lengthFt: null,
      runFt: null,
      distanceUnconfirmed: true,
      rangeLow: null,
      rangeHigh: null,
      source: null,
      hasPhoto: !!(preRead && preRead.photo_received_at),
      distanceBand: (preRead && preRead.distance_band) || null,
    };
  }
  var amp = _quoteDeskAmp(contact, preRead);
  var run = _quoteDeskRunFt(contact, preRead);
  var missingFacts = [];
  if (!amp) missingFacts.push('amperage');
  if (run.distanceUnconfirmed || !run.lengthFt) missingFacts.push('distance');
  if (missingFacts.length) {
    return {
      ready: false,
      missingFacts: missingFacts,
      dollars: null,
      amp: amp,
      lengthFt: run.lengthFt,
      runFt: run.runFt,
      distanceUnconfirmed: run.distanceUnconfirmed,
      rangeLow: preRead && preRead.range_low_cents != null ? Math.round(Number(preRead.range_low_cents) / 100) : null,
      rangeHigh: preRead && preRead.range_high_cents != null ? Math.round(Number(preRead.range_high_cents) / 100) : null,
      source: null,
      hasPhoto: !!(preRead && preRead.photo_received_at),
      distanceBand: (preRead && preRead.distance_band) || null,
    };
  }
  var dollars = null;
  var source = 'default';
  if (typeof window.quoteV3Total === 'function') {
    dollars = window.quoteV3Total({
      amp: amp, lengthFt: run.lengthFt,
      includeCord: true, includeInlet: true, includePermit: true,
      lineItems: [],
    });
    source = 'engine';
  }
  // property_pre_reads stores range_low_cents / range_high_cents (not price_*).
  // Wrong names silently null'd Quote Desk ballpark context (audit 2026-07-13).
  var rangeLow = preRead && preRead.range_low_cents != null ? Math.round(Number(preRead.range_low_cents) / 100) : null;
  var rangeHigh = preRead && preRead.range_high_cents != null ? Math.round(Number(preRead.range_high_cents) / 100) : null;
  if ((dollars == null || !isFinite(dollars)) && rangeLow != null && rangeHigh != null && rangeHigh >= rangeLow) {
    dollars = Math.round((rangeLow + rangeHigh) / 2);
    source = 'range_mid';
  }
  if (dollars == null || !isFinite(dollars) || dollars <= 0) {
    dollars = amp === '50' ? 1497 : 1197;
    source = 'fallback';
  }
  return {
    ready: true,
    missingFacts: [],
    dollars: Math.round(dollars),
    amp: amp,
    lengthFt: run.lengthFt,
    runFt: run.runFt,
    distanceUnconfirmed: run.distanceUnconfirmed,
    rangeLow: rangeLow,
    rangeHigh: rangeHigh,
    source: source,
    hasPhoto: !!(preRead && preRead.photo_received_at),
    distanceBand: (preRead && preRead.distance_band) || null,
  };
}

// Firm-quote SMS body for Key to edit + send. Honesty: walk showed a range;
// this text carries Key's firm number. No auto-send. No opener flip.
function buildFirmQuoteSmsDraft(contact, preRead, opts) {
  opts = opts || {};
  var sug = (opts.suggestion && typeof opts.suggestion === 'object')
    ? opts.suggestion
    : suggestFirmQuote(contact, preRead);
  if (!sug.ready) return null;
  var first = _quoteDeskFirstName(contact);
  var greet = first ? ('Hey ' + first + ', ') : 'Hey, ';
  var dollars = (opts.dollars != null && isFinite(Number(opts.dollars)))
    ? Math.round(Number(opts.dollars))
    : sug.dollars;
  var money = '$' + Number(dollars).toLocaleString('en-US');
  var rangeBit = '';
  if (sug.rangeLow != null && sug.rangeHigh != null) {
    rangeBit = ' (inside the ballpark I showed you)';
  }
  var body = greet
    + 'I reviewed your setup. Your exact price is '
    + money
    + ' all in'
    + rangeBit
    + ': inlet, interlock, cord, permit, and county inspection, done in one day. That number is locked. Want me to send the written proposal next?';
  if (opts.proposalUrl) {
    body = greet
      + 'I reviewed your setup. Your exact price is '
      + money
      + ' all in'
      + rangeBit
      + ': inlet, interlock, cord, permit, and county inspection, done in one day. That number is locked. Here it is in writing: '
      + opts.proposalUrl
      + ' A 20% deposit holds your date.';
  }
  return body;
}

// Prefill Messages composer only. NEVER sends. Returns { ok, text, suggestion }.
function prefillFirmQuoteSms(contact, preRead, opts) {
  if (!contact || !contact.id) return { ok: false, error: 'no contact' };
  if (contact.do_not_contact) return { ok: false, error: 'Marked do not contact' };
  if (contact.archived) return { ok: false, error: 'Contact is archived' };
  var suggestion = suggestFirmQuote(contact, preRead);
  if (!suggestion.ready) return { ok: false, error: 'Confirm ' + suggestion.missingFacts.join(' and ') + ' before drafting a firm quote.', suggestion: suggestion };
  var text = buildFirmQuoteSmsDraft(contact, preRead, Object.assign({}, opts || {}, { suggestion: suggestion }));
  try {
    sessionStorage.setItem('draft:' + contact.id, text);
    // Context strip at Send time (operator-messages M1): walk facts beside composer.
    var bits = [];
    if (suggestion) {
      bits.push('Suggest $' + suggestion.dollars);
      if (suggestion.amp) bits.push(suggestion.amp + 'A');
      if (!suggestion.distanceUnconfirmed && suggestion.lengthFt) bits.push('~' + suggestion.lengthFt + ' ft');
      else if (suggestion.distanceUnconfirmed) bits.push('run unconfirmed');
      if (suggestion.rangeLow != null && suggestion.rangeHigh != null) {
        bits.push('walk $' + suggestion.rangeLow + ' to $' + suggestion.rangeHigh);
      }
      if (suggestion.hasPhoto) bits.push('photo in');
      else bits.push('photo missing');
      if (preRead && preRead.confirmed_panel_room) bits.push(String(preRead.confirmed_panel_room));
    }
    sessionStorage.setItem('quoteContext:' + contact.id, JSON.stringify({
      bits: bits,
      warn: !!(suggestion && suggestion.distanceUnconfirmed),
      at: Date.now(),
    }));
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'sessionStorage failed', text: text, suggestion: suggestion };
  }
  return { ok: true, text: text, suggestion: suggestion };
}

// ── Desk clear batch (bold bet #3, 2026-07-13) ─────────────────────────
// One tap prefills firm-quote drafts for every Ready-to-quote contact,
// stacks them in sessionStorage, opens the first. Key still hits Send per
// thread. NOTHING auto-sends. TCPA: skip do_not_contact every time.
var DESK_CLEAR_QUEUE_KEY = 'bpp_qd_desk_clear_queue';

function _deskClearContactName(contact) {
  if (!contact) return 'lead';
  var raw = (contact.name || '').trim();
  if (!raw) return 'lead';
  return raw.split(/\s+/)[0] || 'lead';
}

function readDeskClearQueue() {
  try {
    var raw = JSON.parse(sessionStorage.getItem(DESK_CLEAR_QUEUE_KEY) || 'null');
    if (!raw || !Array.isArray(raw.ids)) return { ids: [], startedAt: null, total: 0 };
    return {
      ids: raw.ids.map(String).filter(Boolean),
      startedAt: raw.startedAt || null,
      total: Number(raw.total) || raw.ids.length,
    };
  } catch (_) {
    return { ids: [], startedAt: null, total: 0 };
  }
}

function writeDeskClearQueue(ids, total) {
  var clean = (ids || []).map(String).filter(Boolean);
  try {
    if (!clean.length) {
      sessionStorage.removeItem(DESK_CLEAR_QUEUE_KEY);
      return { ids: [], startedAt: null, total: 0 };
    }
    var payload = {
      ids: clean,
      startedAt: Date.now(),
      total: Number(total) > 0 ? Number(total) : clean.length,
    };
    sessionStorage.setItem(DESK_CLEAR_QUEUE_KEY, JSON.stringify(payload));
    return payload;
  } catch (_) {
    return { ids: clean, startedAt: Date.now(), total: clean.length };
  }
}

function clearDeskClearQueue() {
  try { sessionStorage.removeItem(DESK_CLEAR_QUEUE_KEY); } catch (_) {}
  try {
    window.dispatchEvent(new CustomEvent('crm-desk-clear-changed', { detail: { ids: [], remaining: 0, done: true } }));
  } catch (_) {}
  return { ids: [], remaining: 0, done: true };
}

// Peek for sticky stack UI. Resolves next name from live CRM.contacts when possible.
function peekDeskClearQueue() {
  var q = readDeskClearQueue();
  var nextId = q.ids.length ? q.ids[0] : null;
  var nextName = 'lead';
  if (nextId && window.CRM && Array.isArray(window.CRM.contacts)) {
    var c = window.CRM.contacts.find(function (x) { return x && String(x.id) === String(nextId); });
    nextName = _deskClearContactName(c);
  }
  return {
    ids: q.ids,
    remaining: q.ids.length,
    total: q.total || q.ids.length,
    nextId: nextId,
    nextName: nextName,
    active: q.ids.length > 0,
  };
}

// After Key Sends (or Skip): drop the current id, surface the next.
// NEVER sends. Returns { done, remaining, nextId, nextName, sentCount }.
function advanceDeskClearQueue(justFinishedContactId, opts) {
  var q = readDeskClearQueue();
  var finished = justFinishedContactId != null ? String(justFinishedContactId) : '';
  var ids = q.ids.filter(function (id) { return String(id) !== finished; });
  // If the finished id was not head (Key jumped), still drop it; keep order.
  if (!finished && ids.length) ids = ids.slice(1);
  var total = q.total || (ids.length + (finished ? 1 : 0));
  writeDeskClearQueue(ids, total);
  var nextId = ids.length ? ids[0] : null;
  var nextName = 'lead';
  if (nextId && window.CRM && Array.isArray(window.CRM.contacts)) {
    var c = window.CRM.contacts.find(function (x) { return x && String(x.id) === String(nextId); });
    nextName = _deskClearContactName(c);
  }
  var sentCount = Math.max(0, total - ids.length);
  var detail = {
    done: ids.length === 0,
    remaining: ids.length,
    nextId: nextId,
    nextName: nextName,
    sentCount: sentCount,
    total: total,
    skipped: !!(opts && opts.skipped),
  };
  try { window.dispatchEvent(new CustomEvent('crm-desk-clear-changed', { detail: detail })); } catch (_) {}
  return detail;
}

// Prefill firm-quote drafts for every contact in the list. NEVER sends.
// contacts: array of contact objects (Ready-to-quote order preferred).
// Returns { ok, queued, skipped, firstId, firstName, remaining }.
async function deskClearBatchDraft(contacts) {
  var list = Array.isArray(contacts) ? contacts : [];
  var queued = [];
  var skipped = [];
  for (var i = 0; i < list.length; i++) {
    var contact = list[i];
    if (!contact || !contact.id) {
      skipped.push({ id: null, name: 'unknown', reason: 'no contact' });
      continue;
    }
    if (contact.do_not_contact) {
      skipped.push({ id: contact.id, name: _deskClearContactName(contact), reason: 'do not contact' });
      continue;
    }
    if (contact.archived) {
      skipped.push({ id: contact.id, name: _deskClearContactName(contact), reason: 'archived' });
      continue;
    }
    if (!(contact.phone || '').replace(/\D/g, '')) {
      skipped.push({ id: contact.id, name: _deskClearContactName(contact), reason: 'no phone' });
      continue;
    }
    var pr = null;
    try { pr = await fetchPreRead(contact.id); } catch (_) { pr = null; }
    var res = prefillFirmQuoteSms(contact, pr);
    if (!res || !res.ok) {
      skipped.push({
        id: contact.id,
        name: _deskClearContactName(contact),
        reason: (res && res.error) ? res.error : 'prefill failed',
      });
      continue;
    }
    queued.push({
      id: contact.id,
      name: _deskClearContactName(contact),
      dollars: res.suggestion && res.suggestion.dollars != null ? res.suggestion.dollars : null,
    });
  }
  if (!queued.length) {
    clearDeskClearQueue();
    return {
      ok: false,
      error: skipped.length ? 'Nothing to draft (all skipped)' : 'No contacts',
      queued: queued,
      skipped: skipped,
      firstId: null,
      firstName: null,
      remaining: 0,
    };
  }
  writeDeskClearQueue(queued.map(function (q) { return q.id; }), queued.length);
  try {
    window.dispatchEvent(new CustomEvent('crm-desk-clear-changed', {
      detail: {
        done: false,
        remaining: queued.length,
        nextId: queued[0].id,
        nextName: queued[0].name,
        sentCount: 0,
        total: queued.length,
        prepped: true,
      },
    }));
  } catch (_) {}
  return {
    ok: true,
    queued: queued,
    skipped: skipped,
    firstId: queued[0].id,
    firstName: queued[0].name,
    remaining: queued.length,
  };
}

// True when a completed (or far-enough) walk / pre-read should surface the
// Quote Desk (firm SMS + draft proposal) instead of a bare "Send proposal".
function isQuoteDeskReady(contact, preRead, proposals) {
  if (!contact || contact.archived || contact.do_not_contact) return false;
  if (contact.stage !== 'new' && contact.stage !== 'quoted') return false;
  var receipt = window.CRM && window.CRM.quoteWalkV2Receipts
    ? window.CRM.quoteWalkV2Receipts[String(contact.id)]
    : null;
  var legacyReady = Boolean(preRead && suggestFirmQuote(contact, preRead).ready === true);
  if (!quoteWalkV2QuoteDeskState(receipt, legacyReady).actionable) return false;
  var DEAD = ['cancelled', 'declined', 'expired'];
  var list = proposals || (window.CRM && window.CRM.proposals) || [];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (p.contact_id !== contact.id) continue;
    if (p.superseded_at) continue;
    if (DEAD.indexOf(String(p.status || '').toLowerCase()) !== -1) continue;
    return false; // live proposal already exists
  }
  return true;
}

function proposalHasFirmFacts(proposal) {
  if (!proposal) return false;
  var amp = String(proposal.selected_amp || proposal.amp_type || '');
  var lengthFt = Number(proposal.length_ft);
  return (amp === '30' || amp === '50') && isFinite(lengthFt) && lengthFt > 0;
}

async function generateDraftProposal(contact) {
  if (!window.CRM?.__db) return { ok: false, error: 'Supabase not loaded' };
  if (!contact || !contact.id) return { ok: false, error: 'no contact' };
  if (contact.do_not_contact) return { ok: false, error: 'Marked do not contact' };
  if (contact.archived) return { ok: false, error: 'Contact is archived' };
  if (_draftGenInFlight.has(contact.id)) return { ok: false, error: 'Draft generation already in progress' };
  if (_hasLiveProposalLocal(contact.id)) return { ok: false, error: 'Live proposal already exists' };
  _draftGenInFlight.add(contact.id);
  try {
    var preRead = null;
    try { preRead = await fetchPreRead(contact.id); } catch (_) { preRead = null; }
    var receipt = await fetchQuoteWalkV2ReceiptForContact(contact.id, true);
    var legacyReady = Boolean(preRead && suggestFirmQuote(contact, preRead).ready === true);
    var deskState = quoteWalkV2QuoteDeskState(receipt, legacyReady);
    if (deskState.mode === 'legacy') {
      if (typeof window.quoteV3Total !== 'function') {
        return { ok: false, error: 'pricing engine not loaded' };
      }
      if (!deskState.actionable) {
        return { ok: false, error: deskState.verdict.message, verdict: deskState.verdict };
      }
      return await _generateDraftProposalInner(contact);
    }
    if (deskState.mode !== 'v2') {
      return { ok: false, error: deskState.verdict.message, verdict: deskState.verdict };
    }
    var claimed = await claimQuoteWalkV2Handoff(contact);
    if (!claimed.ok) return claimed;
    return {
      ok: true,
      handoffClaimed: true,
      claim: claimed.claim,
      message: 'Quote Walk handoff claimed. Proposal creation requires the authoritative handoff payload.',
    };
  } finally {
    _draftGenInFlight.delete(contact.id);
  }
}

async function _generateDraftProposalInner(contact) {
  // Prefer walk / pre-read facts when contacts.run_ft_estimate is empty
  // (some Flow C paths stamp the pre-read row first). Key still reviews.
  var preRead = null;
  try { preRead = await fetchPreRead(contact.id); } catch (_) { preRead = null; }
  var sug = suggestFirmQuote(contact, preRead);
  if (!sug.ready) return { ok: false, error: 'Confirm ' + sug.missingFacts.join(' and ') + ' before creating a firm proposal.' };
  var amp = sug.amp;
  var lengthFt = sug.lengthFt;
  var draftNote = '';
  if (sug.rangeLow != null && sug.rangeHigh != null) {
    draftNote = 'Walk ballpark was $' + sug.rangeLow + ' to $' + sug.rangeHigh
      + '; firm number still needs Key\'s send.';
  }
  var total = window.quoteV3Total({
    amp: amp, lengthFt: lengthFt,
    includeCord: true, includeInlet: true, includePermit: true,
    lineItems: [],
  });

  // Idempotency re-check against the DB right before insert: a double-tap,
  // a second device, or a stale client must not produce a second draft.
  // Statuses in the DB are title-case; apply the same lowercase canon
  // mapProposal uses rather than trusting case in a filter string.
  try {
    var liveQ = await window.CRM.__db.from('proposals')
      .select('id, status, superseded_at')
      .eq('contact_id', contact.id);
    if (liveQ.error) return { ok: false, error: liveQ.error.message };
    var hasLive = (liveQ.data || []).some(function (r) {
      var s = (r.status || '').toLowerCase();
      return !r.superseded_at && _DEAD_PROPOSAL_STATUSES.indexOf(s) === -1;
    });
    if (hasLive) return { ok: false, error: 'Live proposal already exists' };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }

  var payload = {
    contact_id:      contact.id,
    contact_name:    contact.name    || '',
    contact_email:   contact.email   || '',
    contact_phone:   contact.phone   || '',
    contact_address: contact.address || '',
    creator_version: 'v3',
    amp_type:        amp,
    selected_amp:    amp,
    length_ft:       lengthFt,
    run_ft:          lengthFt,                // legacy mirror
    include_cord:    true,
    cord_included:   true,                    // legacy mirror
    include_inlet:   true,
    include_permit:  true,
    include_surge:   false,
    pom_offered:     false,
    pom_accepted:    false,
    include_pom:     false,                   // never auto-included; opt-in on client page
    selected_pom:    false,
    pom_price:       (window.V3_PRICING?.pom) || 447,
    // Deposit required by default (Key 2026-07-11), matching the modal's new
    // default; the per-proposal toggle remains the opt-out.
    require_deposit: true,
    discount_type:   null,
    discount_value:  null,
    discount_amount: 0,
    extra_line_items: [],
    custom_items:    [],                      // legacy mirror
    total:           total,
    price_base:      total,
    price_cord:      0, price_surge: 0,
    notes:           draftNote,
  };

  var ins = await window.CRM.__db.from('proposals')
    .insert([{ ...payload, deposit_rate: 0.20, status: 'Created' }])
    .select().single();
  if (ins.error || !ins.data) return { ok: false, error: ins.error?.message || 'insert failed' };

  // Optimistic push via the SAME mapper the refetch path uses so the row
  // can never drift from the canonical shape (mirrors NewProposalModal).
  var mapped = mapProposal(ins.data);
  var arr = (window.CRM.proposals = window.CRM.proposals || []);
  var idx = arr.findIndex(function (p) { return p.id === mapped.id; });
  if (idx >= 0) arr[idx] = mapped; else arr.unshift(mapped);

  // Stage bump NEW -> QUOTED on first proposal create, mirroring the modal:
  // awaited, rolled back in memory on failure, but non-fatal to the draft
  // (the proposal row exists either way).
  if (contact.stage === 'new') {
    var numQuoted = STAGE_STR_TO_NUM.quoted;
    var prevStage = contact.stage;
    contact.stage = 'quoted';
    try {
      var stageRes = await window.CRM.__db.from('contacts').update({ stage: numQuoted }).eq('id', contact.id);
      if (stageRes.error) {
        contact.stage = prevStage;
        window.showToast?.('Stage update failed: ' + stageRes.error.message, { kind: 'error' });
      }
    } catch (err) {
      contact.stage = prevStage;
      window.showToast?.('Stage update failed: ' + (err?.message || err), { kind: 'error' });
    }
  }

  window.dispatchEvent(new CustomEvent('crm-data-changed'));
  return { ok: true, proposal: mapped };
}

// Spartanburg/Greenville/Pickens county → city mapping. Used both to
// classify a contact's permit jurisdiction AND to display only the city
// on the address line (no state, no zip) per design spec.
const SPARTANBURG_CITIES = /spartanburg|inman|boiling springs|woodruff|moore|wellford|chesnee|cowpens|landrum|duncan/i;
const GREENVILLE_CITIES = /greenville|greer|mauldin|simpsonville|fountain inn|travelers rest|taylors|piedmont/i;
const PICKENS_CITIES = /pickens|easley|liberty|six mile|central|clemson|sunset|dacusville/i;

function jurisdictionFromAddress(addr) {
  if (!addr) return null;
  if (SPARTANBURG_CITIES.test(addr)) return 'Spartanburg';
  if (GREENVILLE_CITIES.test(addr)) return 'Greenville';
  if (PICKENS_CITIES.test(addr)) return 'Pickens';
  return null;
}

// Self-permitting municipalities inside the three service counties. Each
// runs its OWN building department, so an address inside one of these
// city limits is NOT permitted by the county. City of Greenville is
// handled separately below (it IS a directory entry).
const SELF_PERMIT_CITIES = /\b(greer|mauldin|simpsonville|fountain inn|travelers rest|easley|clemson|liberty|city of spartanburg)\b/i;

// Of the cities above, these ARE now real permit_jurisdictions rows (added
// 2026-07, has a stored portal/jurisdiction_id). Map the matched address
// token to the directory's exact `name` value. The rest (Travelers Rest,
// Easley, Clemson, Liberty, City of Spartanburg) are genuinely not yet
// catalogued, prediction keeps flagging those "verify, not in your directory".
const SELF_PERMIT_IN_DIRECTORY = {
  greer: 'City of Greer',
  mauldin: 'City of Mauldin',
  simpsonville: 'City of Simpsonville',
  'fountain inn': 'Fountain Inn',
};

// Address -> precise permitting jurisdiction prediction. Returns
// { jurisdiction, county, confidence:'confident'|'verify', note }.
// Built on the rule (verified across all three counties): a county
// building dept permits ONLY unincorporated land; inside a city limit
// the city self-permits. City-limit status cannot be read from an
// address string, so most predictions return 'verify' with a note on
// what to confirm. Unlike jurisdictionFromAddress (county string only)
// this maps to the exact jurisdiction name Key acts on, and detects
// City of Greenville + the self-permitting cities. jurisdictionFromAddress
// stays as-is for its existing callers; this lives alongside it.
function predictJurisdiction(addr) {
  if (!addr) return null;
  const county = jurisdictionFromAddress(addr);
  if (!county) return null; // no recognized city token -> nothing to predict

  // 1) Self-permitting municipality (not the county, not City of Greenville).
  const selfMatch = addr.match(SELF_PERMIT_CITIES);
  if (selfMatch) {
    const inDirectory = SELF_PERMIT_IN_DIRECTORY[selfMatch[0].toLowerCase()];
    if (inDirectory) {
      // Already a real directory entry, city-limit status from an address
      // string alone is still not certain, so this stays 'verify', but the
      // note no longer claims it is missing from the directory.
      return {
        jurisdiction: inDirectory,
        county,
        confidence: 'verify',
        note: 'this city permits separately, confirm address is inside city limits',
      };
    }
    // Title-case the matched city token for display.
    const city = selfMatch[0].replace(/\b\w/g, ch => ch.toUpperCase());
    return {
      jurisdiction: city,
      county,
      confidence: 'verify',
      note: 'this city permits separately, not yet in your directory, verify',
    };
  }

  // 2) City of Greenville, sits inside Greenville County but has its own
  //    portal. A "greenville" city token inside Greenville County could be
  //    the city OR unincorporated county; always confirm against county GIS.
  if (county === 'Greenville' && /\bgreenville\b/i.test(addr)) {
    return {
      jurisdiction: 'City of Greenville',
      county,
      confidence: 'verify',
      note: 'confirm address is inside city limits (county GIS)',
    };
  }

  // 3) Otherwise default to the county jurisdiction (unincorporated). The
  //    city-limit status is unknown from the address alone, so verify
  //    unincorporated-vs-city before relying on it.
  return {
    jurisdiction: `${county} County`,
    county,
    confidence: 'verify',
    note: 'confirm unincorporated vs city limits',
  };
}

// Single source of truth for the manual jurisdiction picker (the 4
// counties/City of Greenville plus the 4 self-permitting cities that are now
// real permit_jurisdictions rows: Greer, Mauldin, Simpsonville, Fountain
// Inn), matching predictJurisdiction's SELF_PERMIT_IN_DIRECTORY map above.
// Was hand-duplicated as a local const in crm-right.jsx (a documented
// hand-sync risk); both the bespoke CRM and the Ionic CRM now read this one
// array off window so a directory addition only needs one edit.
window.BPP_JURISDICTIONS = ['Spartanburg County', 'Greenville County', 'Pickens County', 'City of Greenville', 'City of Greer', 'City of Mauldin', 'City of Simpsonville', 'Fountain Inn'];

// Pull the first city-looking token from "{street}, {city}, {state} {zip}".
function cityFromAddress(addr) {
  if (!addr) return null;
  const parts = addr.split(',').map(s => s.trim());
  // [street, city, "state zip"] or [street, "city state zip"] etc.
  if (parts.length >= 2) return parts[1].replace(/\b(SC|South Carolina)\b\s*\d*$/i, '').trim() || null;
  return null;
}

function avatarFromName(name) {
  // Trim, a name of `'   '` was truthy and produced an empty initials
  // string, leaving the avatar circle blank.
  const n = (name || '').trim();
  if (!n) return null;
  const parts = n.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
}

// "{street}, {city}, SC {zip}" → "{street}, {city}". Drops state/zip everywhere.
// shortAddress is for DISPLAY only, never persist its output back to
// the DB. Strips state/zip so the row reads clean. The full address is
// kept on contact.address; the display helper runs at render time.
function shortAddress(addr) {
  if (!addr) return '';
  const parts = addr.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    return `${parts[0]}, ${parts[1].replace(/\b(SC|South Carolina)\b\s*\d*$/i, '').trim()}`;
  }
  return addr;
}

// ── Supabase row → v3 shape transformers ─────────────────────────────────
// Multi-line messaging (2026-06-20): map a BPP line phone (contacts.current_line
// or a message's bpp_line) to its registry color for the avatar ring. Matches on
// last-10 digits so a +1 prefix or formatting never breaks the lookup. Returns
// null when there are fewer than 2 active lines (a single line needs no per-line
// cue) or there is no match, so the ring is a graceful no-op until Key registers
// a second number.
window.lineColorFor = function(linePhone) {
  if (!linePhone) return null;
  const lines = ((window.CRM && window.CRM.lines) || []).filter(l => l && l.active !== false);
  if (lines.length < 2) return null;
  const want = String(linePhone).replace(/\D/g, '').slice(-10);
  if (!want) return null;
  const m = lines.find(l => String(l.phone || '').replace(/\D/g, '').slice(-10) === want);
  return m ? (m.color || null) : null;
};

function mapContact(r) {
  const jurisdiction = jurisdictionFromAddress(r.address) || cityFromAddress(r.address) || null;
  return {
    id: r.id,
    name: r.name || null,
    phone: r.phone || '',
    email: r.email || '',
    // Keep the FULL address on the in-memory contact so the edit form
    // round-trips losslessly. Display sites that want a clean street+city
    // view should call shortAddress(contact.address) at render time.
    // Previously this stored the truncated form and saving the edit form
    // wrote that back, silently destroying state/zip on every edit.
    address: r.address || '',
    address_short: shortAddress(r.address),
    jurisdiction,
    pricing_tier: r.pricing_tier || 'standard',
    stage: STAGE_NUM_TO_STR[r.stage] || 'new',
    do_not_contact: !!r.do_not_contact,
    // Read both `archived` (column added 2026-05-09) and the legacy
    // `status='Archived'` signal so old rows stay correct during the
    // migration window. Once every row has been touched, drop the OR.
    archived: !!r.archived || r.status === 'Archived',
    // contacts.pinned column (migration 20260509140000). Replaces the
    // localStorage-only pin set so stars sync between desktop and
    // mobile via realtime. Falls back to false if the SELECT didn't
    // pull the column (defensive, usePinned uses this as source of
    // truth so missing it would silently de-star everyone).
    pinned: !!r.pinned,
    // contacts.tags column (migration 20260509150000). Replaces the
    // localStorage tag map so labels sync between desktop and mobile.
    // Default to empty array if missing.
    tags: Array.isArray(r.tags) ? r.tags : [],
    // generator_model / panel_amps were PHANTOM columns (never existed in the
    // contacts table, verified against information_schema 2026-06-10), so the
    // old projections were always null. The real columns are `generator` and
    // `amperage` below; the proposal-creator default reads `amperage` now.
    // Comms platform fields (2026-06-10): the enrichment bot's living summary
    // + the whitelist fields it fills. mapContact is an explicit projection,
    // so every new contact column must be added HERE too or the UI never
    // sees it (the AI summary card shipped blank twice before this line).
    ai_summary: r.ai_summary || null,
    ai_summary_updated_at: r.ai_summary_updated_at || null,
    panel_location: r.panel_location || null,
    amperage: r.amperage || null,
    availability_notes: r.availability_notes || null,
    generator: r.generator || null,
    // POM inspection results (saved from the POM card's inspection modal).
    // Was write-only before 2026-06-10: saves landed in the DB but vanished
    // from the UI on refetch because this projection omitted the column.
    pom_inspection: r.pom_inspection || null,
    // Flow C (2026-06-11): the customer-stated run distance (Pre-Read page
    // mirror, also Key-typable) + the clone-match key. Both feed the draft
    // proposal and the Price Brief row.
    run_ft_estimate: r.run_ft_estimate != null ? Number(r.run_ft_estimate) : null,
    subdivision: r.subdivision || null,
    // Multi-line messaging (2026-06-20): the BPP Twilio line this contact's most
    // recent message is on (the customer-facing "To" of inbound / "From" of
    // outbound). Drives the colored avatar ring (Calls + Messaging tabs only)
    // via window.lineColorFor. Null = legacy/default single-line history.
    current_line: r.current_line || null,
    // Attribution (audit 2026-07-13): written by quo-ai-new-lead; must be in
    // CONTACT_COLS + this projection or CRM never sees channel/source.
    lead_channel: r.lead_channel || null,
    lead_source: r.lead_source || null,
    // Card-on-file (#115). Presence + display only; the raw Stripe ids are
    // deliberately NOT projected into window.CRM (the charge fn re-reads them
    // server-side from the proposal's contact, the client never needs them).
    has_card_on_file: !!(r.stripe_customer_id && r.stripe_payment_method_id),
    card_brand: r.card_brand || null,
    card_last4: r.card_last4 || null,
    notes: r.notes || '',
    // Sub workflow fields. Surface on Contact view + Calendar event card
    // so Key can see who's assigned + how much he's paying out at a glance.
    assigned_installer: r.assigned_installer || null,
    installer_pay: r.installer_pay != null ? Number(r.installer_pay) : null,
    install_date: r.install_date || null,
    avatar: avatarFromName(r.name),
    // Always derive a short ref_id from the UUID so any view/log line that
    // wants a human-readable handle has one even for named contacts.
    ref_id: (r.id || '').slice(0, 4).toUpperCase() || null,
    // Pass through created_at, buildContactSignals uses it as a fallback
    // for daysInStage when stage_history has no transitions for the
    // contact (i.e., still in their initial 'new' stage).
    created_at: r.created_at || null,
  };
}

function mapEvent(r) {
  // Real DB column is `event_type`, not `kind`. `status` column added
  // 2026-05-09 (migration 20260509120000) to support cancel-event flow.
  // `notes` surfaced 2026-05-26 for install prep details.
  return {
    id: r.id,
    contact_id: r.contact_id,
    kind: r.kind || r.event_type || 'follow_up',
    start_at: r.start_at,
    end_at: r.end_at || null,
    title: r.title || 'Event',
    status: r.status || 'scheduled',
    notes: r.notes || null,
    // Per-event installer + sub-confirm lifecycle (migration 20260615000000).
    // Without these in the map, the day-board's installer write succeeds in
    // Postgres but the realtime re-map wipes it from memory (looks like a
    // failed save of the headline feature). Nullable; null falls back to
    // contacts.assigned_installer in the UI.
    assigned_installer: r.assigned_installer || null,
    installer_notified_at: r.installer_notified_at || null,
    installer_confirmed_at: r.installer_confirmed_at || null,
  };
}

// Three tables added 2026-05-09 (migration 20260509130000). Mappers
// preserve the in-memory shape the UI was already using so the
// component code reads identically to before this migration.

function mapPermit(r) {
  return {
    id: r.id,
    contact_id: r.contact_id,
    jurisdiction_id: r.jurisdiction_id || null,
    // Denormalized name for the UI (matches the prior in-memory shape
    // where `permit.jurisdiction` was a plain string).
    jurisdiction: r.jurisdiction_name || '',
    jurisdiction_name: r.jurisdiction_name || '',
    permit_number: r.permit_number || 'PENDING',
    status: r.status || 'not_started',
    submitted_at: r.submitted_at || null,
    approved_at: r.approved_at || null,
    cost_cents: r.cost_cents || 0,
    blocker_note: r.blocker_note || null,
    created_at: r.created_at || null,
    updated_at: r.updated_at || null,
  };
}

function mapMaterial(r) {
  return {
    id: r.id,
    contact_id: r.contact_id,
    kind: r.kind,
    status: r.status || 'not_ordered',
    ordered_at: r.ordered_at || null,
    received_at: r.received_at || null,
    installed_at: r.installed_at || null,
    notes: r.notes || null,
    created_at: r.created_at || null,
    updated_at: r.updated_at || null,
  };
}

function mapCall(r) {
  // Direction normalize: Twilio writes 'inbound'/'outbound'; UI uses
  // 'in'/'out'/'missed'. Same convention as mapMessage.
  const dirRaw = r.direction || 'in';
  const dir = dirRaw === 'outbound' ? 'out' : dirRaw === 'inbound' ? 'in' : dirRaw;
  return {
    id: r.id,
    contact_id: r.contact_id,
    direction: dir,
    started_at: r.started_at,
    ended_at: r.ended_at || null,
    duration_sec: r.duration_sec ?? null,
    voicemail_url: r.voicemail_url || null,
    voicemail_duration: r.voicemail_duration || null,
    voicemail_transcript: r.voicemail_transcript || null,
    listened_at: r.listened_at || null,
    twilio_call_sid: r.twilio_call_sid || null,
    from_phone: r.from_phone || null,
    to_phone: r.to_phone || null,
    status: r.status || null,
    notes: r.notes || null,
    created_at: r.created_at || null,
    // Comms platform call fields (2026-06-10): recording playback + the
    // Gemini transcript + Haiku summary (transcribe-call writes these), and
    // answered_by (browser|cell) so the post-call card can say where it rang.
    recording_url: r.recording_url || null,
    transcript: r.transcript || null,
    ai_summary: r.ai_summary || null,
    answered_by: r.answered_by || null,
  };
}

// BPP proposals schema uses dollars (total), pricing_tier, amp_type ('30'/'50'),
// copied_at as send timestamp, and signed_at as signature evidence only.
// Approval requires raw Approved status plus authoritative accepted truth. Status is
// title-case ('Copied'/'Signed'/'Viewed'/'Expired'/'Declined') so we lowercase
// and remap to the v3 visual contract ('sent'/'approved'/'viewed'/'expired'/'declined').
// Schema-tolerant amount reader. The DB has shifted: legacy rows store `total`
// in dollars; current rows store `amount` in cents. Read whichever is present
// and normalize to cents so the rest of the app sees a single shape.
// `| 0` truncates anything > 2^31 - 1 cents (~$21.4M) to garbage. Use Number()
// so a single ridiculously-large invoice doesn't silently corrupt. We keep
// floor semantics since cents are integral.
function readCents(r) {
  if (r.amount_cents != null) return Math.floor(Number(r.amount_cents) || 0);
  if (r.amount != null) return Math.floor(Number(r.amount) || 0);
  return Math.round((Number(r.total) || 0) * 100);
}
function readDollars(r) {
  if (r.amount_cents != null) return (Number(r.amount_cents) || 0) / 100;
  if (r.amount != null) return (Number(r.amount) || 0) / 100;
  return Number(r.total) || 0;
}

// Per-invoice paid-so-far (CENTS), net of refunds, COMPLETED payments only.
// Mirrors record-payment's balance math (sum(amount - refunded_amount)) so the
// Money Card can show a remaining balance after a partial instead of the full
// invoice total. Module-scoped so mapInvoice (a pure mapper) can read it;
// refreshed before every invoices map below. payments.amount is in DOLLARS
// (record-payment compares it to invoice.total directly), so convert to cents.
let __paidByInvoice = {}; // { [invoice_id]: paidCents }
// Individual COMPLETED payment rows per invoice, so the operator Refund action can
// target a SPECIFIC payment (refund-payment takes a payment_id). { [invoice_id]: [rows] }.
let __paymentsByInvoice = {};
function applyPaidRows(data) {
  const next = {};
  const rows = {};
  for (const p of (data || [])) {
    if (!p.invoice_id) continue;
    if (String(p.status || '').toLowerCase() === 'completed') {
      const net = (Number(p.amount) || 0) - (Number(p.refunded_amount) || 0);
      next[p.invoice_id] = (next[p.invoice_id] || 0) + Math.round(net * 100);
    }
    (rows[p.invoice_id] = rows[p.invoice_id] || []).push({
      id: p.id, proposal_id: p.proposal_id || null,
      amount: Number(p.amount) || 0, refunded_amount: Number(p.refunded_amount) || 0,
      status: p.status, receipt_token: p.receipt_token || null,
      document_number: p.receipt_document_number || null,
      received_at: p.received_at || null, method: p.method || null,
      record_source: p.record_source || null,
    });
  }
  __paidByInvoice = next;
  __paymentsByInvoice = rows;
}
async function fetchPaidRows() {
  try {
    // NOTE: select ONLY live columns here. pay_method/discount_amount come from the
    // parked 20260630000000 migration; selecting them before it applies would error
    // this query and zero out paid_cents across the live CRM. The refund email derives
    // its method from invoice.payment_method (a live column the webhook sets) instead.
    // Load completed (paid), processing (ACH clearing), and failed (ACH returned) so
    // the CRM can surface an honest "bank transfer retry" affordance, but only COMPLETED
    // rows count toward paid_cents.
    const { data, error } = await __db.from('payments')
      .select('id, invoice_id, proposal_id, amount, refunded_amount, status, receipt_token, receipt_document_number, received_at, method, record_source')
      .in('status', ['completed', 'processing', 'failed']).limit(5000);
    if (error) {
      console.warn('[CRM] payments sum load failed:', error.message);
      return { ok: false, error };
    }
    return { ok: true, data: data || [] };
  } catch (e) {
    console.warn('[CRM] payments sum load error:', e.message);
    return { ok: false, error: e };
  }
}
async function loadPaidByInvoice() {
  const result = await fetchPaidRows();
  if (result.ok) applyPaidRows(result.data);
  return result;
}

function mapProposal(r) {
  const rawStatus = (r.status || 'sent').toLowerCase();
  // 'signed' is its OWN bucket (deposit-gate enforcement 2026-06-08): the
  // customer signed but has NOT paid the deposit, so it must not render or
  // count as 'approved' (paid + booked). stripe-webhook is the sole grantor
  // of Approved. Folding signed into approved here was the old misleading
  // behavior (#114).
  const status =
    rawStatus === 'copied' || rawStatus === 'sent' ? 'sent' :
    rawStatus === 'signed' ? 'signed' :
    rawStatus === 'approved' ? 'approved' :
    rawStatus === 'created' ? 'draft' :
    rawStatus;
  const dollars = readDollars(r);
  return {
    id: r.id,
    token: r.token || null,
    document_number: r.document_number || null,
    contact_id: r.contact_id,
    tier: r.pricing_tier || (dollars >= 1497 ? 'premium_plus' : dollars >= 1297 ? 'premium' : 'standard'),
    amount_cents: readCents(r),
    // Normalize: trim + reject empty/whitespace strings so we never render
    // "undefinedA" or " A" when amp_type is the empty string.
    amp_spec: (() => {
      const a = (r.amp_type || r.selected_amp || '').toString().trim();
      return a ? a + 'A' : null;
    })(),
    status,
    // Frozen signed total (CENTS). signed_total is the dollar amount the
    // customer authorized at signing and the ONLY number charge-saved-card
    // will accept (the live editable `total`/amount_cents can drift after the
    // sign). Null until signed. The money UI prefers this over the live total
    // for the "Signed total" label + balance estimate on signed/approved deals
    // so Key never sees or charges a number the customer did not authorize.
    signed_total_cents: r.signed_total != null && Number(r.signed_total) > 0
      ? Math.round(Number(r.signed_total) * 100) : null,
    // 2026-05-26 audit: sent_at MUST be null on unsent drafts. Previously
    // fell back to created_at, which meant every Created/draft proposal
    // got a truthy sent_at and silently matched stale-quote filters.
    // Real semantic: sent_at = the timestamp we put the proposal in
    // front of the customer (sent_at column when present, else copied_at
    // from the Copy-link path). Null = never sent.
    sent_at: r.sent_at || r.copied_at || null,
    // Mirror raw DB columns so signal logic can disambiguate.
    copied_at: r.copied_at || null,
    superseded_at: r.superseded_at || null,
    superseded_by: r.superseded_by || null,
    viewed_at: r.viewed_at || null,
    signed_at: r.signed_at || null,
    // A signature timestamp is not approval truth. Deposit-required attempts
    // remain unapproved until the paid webhook atomically grants Approved.
    approved_at: rawStatus === 'approved'
      ? (r.approved_at || r.accepted_at || r.signed_at || null)
      : null,
    signature_revision: Number(r.signature_revision || 1),
    lifecycle_revision: Number(r.lifecycle_revision || 1),
    approval_source: r.approval_source || null,
    accepted_at: r.accepted_at || null,
    approval_channel: r.approval_channel || null,
    label: r.amp_type ? `Generator inlet, ${r.amp_type}A` : 'Generator inlet',
    // V3 fields, exposed so the editor can rehydrate without a refetch.
    creator_version: r.creator_version || 'v2',
    length_ft:       r.length_ft != null ? Number(r.length_ft) : null,
    include_cord:    r.include_cord    !== false,
    include_inlet:   r.include_inlet   !== false,
    include_permit:  r.include_permit  !== false,
    pom_offered:     !!r.pom_offered,
    pom_accepted:    !!r.pom_accepted,
    require_deposit: r.require_deposit !== false,
    deposit_rate: r.deposit_rate != null ? Number(r.deposit_rate) : null,
    extra_line_items: Array.isArray(r.extra_line_items) ? r.extra_line_items : [],
    discount_type:   r.discount_type   || null,
    discount_value:  r.discount_value != null ? Number(r.discount_value) : null,
    notes:           r.notes || '',
    amp_type:        r.amp_type || null,
  };
}

function mapInvoice(r) {
  const rawStatus = (r.status || 'sent').toLowerCase();
  // BPP DB uses 'unpaid' for invoices that have been sent but not paid yet;
  // the v3 design expects 'sent' for this state. 'paid'/'overdue'/'voided'
  // /'refunded' map through unchanged. 'draft' = not yet sent.
  const status =
    rawStatus === 'unpaid' || rawStatus === 'open' ? 'sent' :
    rawStatus;
  const cents = readCents(r);
  // Kind picker: explicit `kind` column wins. Heuristic fallback was
  // mislabeling any $1000+ deposit as 'final'. Better: if a proposal_id
  // exists we treat the invoice as 'final' only when it covers ≥ 90% of
  // the proposal total, anything smaller is a 'deposit'. With no
  // proposal_id we keep a permissive cutoff at $1500 (most BPP deposits
  // fall well below this).
  let kind = r.kind;
  if (!kind) {
    if (r.proposal_id) {
      // Cross-ref via the global once it's loaded; on first map pass
      // CRM.proposals may not be populated yet, fall back to size cutoff.
      const prop = (window.CRM?.proposals || []).find(p => p.id === r.proposal_id);
      if (prop && prop.amount_cents > 0) {
        kind = (cents / prop.amount_cents >= 0.9) ? 'final' : 'deposit';
      } else {
        kind = cents >= 150000 ? 'final' : 'deposit';
      }
    } else {
      kind = cents >= 150000 ? 'final' : 'deposit';
    }
  }
  return {
    id: r.id,
    token: r.token || null,
    document_number: r.document_number || null,
    contact_id: r.contact_id,
    proposal_id: r.proposal_id || null,
    amount_cents: cents,
    // Paid-so-far (cents, net of refunds, completed only) so the Money Card can
    // show the REMAINING balance after a partial instead of the full total. 0
    // when no payments / not yet loaded. Refreshed by loadPaidByInvoice().
    paid_cents: __paidByInvoice[r.id] || 0,
    // Completed payment rows for this invoice (id + proposal_id + amount +
    // refunded_amount) so the operator Refund action can target a specific payment.
    payments: __paymentsByInvoice[r.id] || [],
    kind,
    status,
    sent_at: r.sent_at || r.created_at,
    viewed_at: r.viewed_at || null,
    paid_at: r.paid_at || null,
    // payment_method exposed so the Money Card paid state can read "Cash · Jun 12".
    payment_method: r.payment_method || null,
    // V3 invoice fields, line_items + creator_version exposed so editor can rehydrate.
    line_items: Array.isArray(r.line_items) ? r.line_items : [],
    creator_version: r.creator_version || 'v2',
    due_at: r.due_at || null,
    payment_terms: r.payment_terms || (String(r.creator_version || '').toLowerCase() === 'v4' ? 'Due upon receipt' : null),
  };
}

// One messages column list for ALL three fetch paths (initial, realtime
// refetch, light refetch). Comms-platform columns (kind, delivery state,
// scheduled, error) added 2026-06-10 for the Messages-page wiring; keep the
// three SELECTs reading this constant so they never drift (the CONTACT_COLS
// lesson). comm_attachments are fetched per-thread lazily, not bulk-joined.
var MSG_COLS = 'id, contact_id, direction, body, created_at, read_at, sender, status, kind, delivered_at, status_updated_at, scheduled_at, error_code, error_message, twilio_sid';

function mapMessage(r) {
  // Real DB columns: id, contact_id, direction, body, created_at,
  // sender, read_at, status. NOTE: there is no `sent_at` or
  // `sender_role` column, the mapper synthesizes them so the rest of
  // the app can read familiar names without caring about schema.
  // Normalize direction at the boundary. Twilio/edge functions write
  // 'outbound'/'inbound' to DB; the rest of the app reads/filters with
  // 'out'/'in'. Until 2026-05-08 this mismatch silently nulled
  // `daysSinceTouch` on every contact whose only activity was an outbound
  // SMS, so "Rotting" + "Silent leads" chips undercounted dramatically.
  const dirRaw = r.direction || 'in';
  const dir = dirRaw === 'outbound' ? 'out' : dirRaw === 'inbound' ? 'in' : dirRaw;
  // sender_role discriminates "key vs Alex bot vs raw customer" so the
  // suggest-reply prompt can label voice samples correctly. The DB
  // column is named `sender` (NOT `sender_role`); the prior mapper
  // referenced the wrong name and the fallback always fired, erasing
  // bot-vs-human distinctions in the inbox.
  const senderRaw = r.sender || r.sender_role;
  // kind discriminates sms | mms | voicemail | call | note | system. Default
  // to 'sms' when null so legacy rows render as plain texts (the safe shape).
  // 'note' = operator-only annotation (never sent); 'system' = event marker.
  const kind = r.kind || 'sms';
  return {
    id: r.id,
    contact_id: r.contact_id,
    direction: dir,
    sender_role: senderRaw || (dir === 'out' ? 'key' : 'customer'),
    body: r.body || '',
    sent_at: r.sent_at || r.created_at,
    read_at: r.read_at || null,
    // Comms-platform fields (2026-06-10). status carries the Twilio delivery
    // lifecycle (sending|sent|delivered|failed|canceled|scheduled); the rest
    // drive the thread/inbox upgrades. Null-safe so legacy rows render clean.
    status: r.status || null,
    kind,
    delivered_at: r.delivered_at || null,
    scheduled_at: r.scheduled_at || null,
    error_code: r.error_code || null,
    error_message: r.error_message || null,
    twilio_sid: r.twilio_sid || null,
  };
}

function applyLocalReads(msgs) {
  // Retained as the mapping seam used by the initial, realtime, and focus
  // loaders. Read state is now server-authored, so no local override applies.
  return msgs;
}

function applyLocalListened(calls) {
  // Same survival contract for call NOTES (increment R critic): a save's
  // optimistic value must outlive a wholesale realtime refetch, or the closed
  // editor flashes the old text until a later refetch. __localNotes (id -> text)
  // re-applies until the DB row reports the same text, then self-clears.
  var n = window.CRM && window.CRM.__localNotes;
  if (n && n.size > 0) {
    for (var j = 0; j < calls.length; j++) {
      var c2 = calls[j];
      if (!n.has(c2.id)) continue;
      if (c2.notes === n.get(c2.id)) n.delete(c2.id); // DB caught up
      else c2.notes = n.get(c2.id);                    // keep the local value
    }
  }
  return calls;
}

// ── Bootstrap: empty shell + async fill ──────────────────────────────────
// User's home base, drive-time origin. Hardcoded for the single-user app
// today; could move to a settings panel later. Used by DriveTimeBadge in
// the right pane to show "≈22 min from home" on every contact.
const HOME_ADDRESS = window.__BPP_HOME_ADDRESS__ || '22 Kimbell Ct Greenville SC';

// Geocode + driving-route via free OSM-stack (Nominatim + OSRM). Both are
// public, fair-use limited (Nominatim: 1 req/sec, OSRM demo: not for prod).
// To stay polite:
//   1. Aggressive 30-day cache for geocodes; 24h for drive results.
//   2. Serial queue, one network call at a time, 1.1s minimum gap.
//   3. In-flight de-dupe, same address requested twice returns the same Promise.
//   4. Identifying User-Agent / Referer (browser sets Referer automatically).
//   5. Bail to null on any error; UI hides the badge cleanly.
const __geoQueue = (function makeQueue() {
  let last = 0;
  // chain is a CHAIN OF SUCCESSES, never rejected. Without the .catch,
  // a single Nominatim 503 (or any thrown error inside fn()) would reject
  // the chain and every subsequent geocode/drive would fail until reload.
  let chain = Promise.resolve();
  return (fn) => {
    const next = chain.then(async () => {
      const wait = Math.max(0, 1100 - (Date.now() - last));
      if (wait) await new Promise(r => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    // Keep the chain itself unrejected; surface errors to the caller as null.
    chain = next.then(() => undefined, () => undefined);
    return next.catch(() => null);
  };
})();

const __geoInflight = new Map();

async function geocodeAddress(address) {
  if (!address || typeof address !== 'string') return null;
  const key = 'bpp_v3_geocode:' + address.trim().toLowerCase();
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && cached.expiresAt > Date.now()) return cached.coord;
  } catch {}
  if (__geoInflight.has(key)) return __geoInflight.get(key);
  const promise = __geoQueue(async () => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
        { headers: { 'Accept': 'application/json' } });
      if (!r.ok) return null;
      const data = await r.json();
      if (!data[0]) return null;
      const coord = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      window.safeSetItem?.(key, JSON.stringify({ coord, expiresAt: Date.now() + 30*24*3600*1000 }));
      return coord;
    } catch { return null; }
  }).finally(() => __geoInflight.delete(key));
  __geoInflight.set(key, promise);
  return promise;
}

async function driveBetween(originCoord, destCoord) {
  if (!originCoord || !destCoord) return null;
  return __geoQueue(async () => {
    try {
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${originCoord.lng},${originCoord.lat};${destCoord.lng},${destCoord.lat}?overview=false`);
      if (!r.ok) return null;
      const data = await r.json();
      if (!data?.routes?.[0]) return null;
      const route = data.routes[0];
      return {
        minutes: Math.round(route.duration / 60),
        miles: route.distance / 1609.34,
      };
    } catch { return null; }
  });
}

// Pre-resolve home coordinate once at startup.
let __homeCoord = null;
geocodeAddress(HOME_ADDRESS).then(c => { __homeCoord = c; });

async function driveTimeToContactAddress(contactAddress, contactId) {
  if (!__homeCoord) __homeCoord = await geocodeAddress(HOME_ADDRESS);
  if (!__homeCoord || !contactAddress) return null;
  // Cache per-contact (24h), re-check daily so a fresh address update flows.
  const key = 'bpp_v3_drive:' + contactId;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && cached.expiresAt > Date.now()) return cached.result;
  } catch {}
  const dest = await geocodeAddress(contactAddress);
  const result = await driveBetween(__homeCoord, dest);
  if (result) {
    window.safeSetItem?.(key, JSON.stringify({ result, expiresAt: Date.now() + 24*3600*1000 }));
  }
  return result;
}

window.CRM = {
  contacts: [],
  events: [],
  proposals: [],
  invoices: [],
  messages: [],
  calls: [],
  permits: [],
  materials: [],
  readiness: [],
  quoteWalkV2Receipts: {},
  stageHistory: [],
  jurisdictions: [
    // The 4 BPP service-area jurisdictions, matching BPP_JURISDICTIONS in
    // crm-right.jsx (single source of truth). Spartanburg + Pickens counties
    // run on EnerGov (Tyler) via Google SSO with keyelectricupstate@gmail.com.
    // Greenville County uses Accela (eTRAKiT) with username AEC001822.
    // City of Greenville sits inside Greenville County but has its own portal.
    { id: 'j-1', name: 'Spartanburg County', portal_url: 'https://civicaccess.spartanburgcounty.gov/energov_prod/selfservice#/home', username: 'Google SSO · keyelectricupstate@gmail.com', sso: true },
    { id: 'j-2', name: 'Greenville County',  portal_url: 'https://aca.greenvillecounty.org/ACA/',                                    username: 'AEC001822' },
    { id: 'j-3', name: 'Pickens County',     portal_url: 'https://energovweb.pickenscountysc.us/energov_prod/selfservice#/home',     username: 'Google SSO · keyelectricupstate@gmail.com', sso: true },
    { id: 'j-4', name: 'City of Greenville', portal_url: 'https://www.greenvillesc.gov/164/Building-Safety',                        username: 'keyelectricupstate@gmail.com' },
  ],
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_NUM_TO_STR,
  STAGE_STR_TO_NUM,
  recordStageTransition,
  advanceJobNext,
  advanceJobSendReview,
  advanceJobSubmitPermit,
  advanceJobMarkApproved,
  advanceJobVerifyPermit,
  advanceJobUnverifyPermit,
  advanceJobMarkInstalled,
  suggestInstallDate,
  generateDraftProposal,
  suggestFirmQuote,
  buildFirmQuoteSmsDraft,
  prefillFirmQuoteSms,
  deskClearBatchDraft,
  peekDeskClearQueue,
  advanceDeskClearQueue,
  clearDeskClearQueue,
  readDeskClearQueue,
  isQuoteDeskReady,
  proposalHasFirmFacts,
  fetchPreRead,
  peekPreRead,
  fetchPreReadsBulk,
  peekPreReadsBulk,
  fetchQuoteWalkV2Receipts,
  fetchQuoteWalkV2ReceiptForContact,
  markQuoteWalkV2NotificationSeen,
  claimQuoteWalkV2Handoff,
  quoteWalkV2ReceiptVerdict,
  quoteWalkV2QuoteDeskState,
  quoteWalkV2ReceiptMode,
  quoteWalkV2OperatorProjection,
  quoteWalkV2OperatorDisplay,
  now: new Date(),
  loaded: false,
  authed: false,
  // Data arrays and data truth are separate. Consumers must check a domain's
  // state before treating [] as a verified empty result.
  domainStatus: createDomainStatusMap([
    'contacts', 'proposals', 'money', 'messages', 'workspace', 'operatorMetadata',
  ]),
  criticalLoadFailed: false,
  __testMode: TEST_MODE,
  __db,
  __invokeFn,
  // Exposed for binary fetches. CallAudio combines the public API key with
  // Key's current operator session token before fetching a recording blob.
  __url: SUPABASE_URL,
  __anonKey: SUPABASE_ANON_KEY,
};

// Keep local synonym so existing components (which read `CRM.foo`) continue to work
const CRM = window.CRM;
CRM.operatorCommunicationsState = createOperatorCommunicationsStateClient({ getCRM: () => CRM });

// Bare-identifier bridge for cross-file callers. These functions live inside
// window.CRM (above) AND are reached bare from crm-left.jsx and crm-right.jsx
// (e.g. `mapProposal(data)`, `mapInvoice(data)`, `predictJurisdiction(addr)`,
// `driveTimeToContactAddress(...)`). Under classic-script loading top-level
// `function` declarations attached to window automatically; under the Vite
// ES module bundle they don't. Without this Object.assign, the two mapper
// calls crash their surrounding realtime handlers on any invoice / proposal
// update; the two typeof-guarded calls silently no-op the drive-time and
// jurisdiction-prediction features. Purely additive: values are identical
// to the CRM.* members already exposed, so behavior is unchanged.
Object.assign(window, {
  predictJurisdiction,
  mapProposal,
  mapInvoice,
  driveTimeToContactAddress,
});

// ── Auth gate + fetch ───────────────────────────────────────────────────
// Audit-2026-05-09 H12: realtime channels live forever once subscribed;
// if loadLiveData() ever runs twice (e.g., transient auth failure → retry,
// hot-reload during dev), every channel doubles up and refetches twice on
// each event. Track subscription state at module level + tear down before
// re-subscribing.
let __realtimeChannels = [];
let __loadInFlight = null;

// Synthetic fixtures for TEST_MODE only (no real PII, fictitious 555 numbers).
// Mapped shapes match what the live fetch + map* produce, so the components
// read them identically to production. Populates the in-memory arrays, flips
// authed/loaded, and fires the same 'crm-data-ready' event the real load uses,
// so the real shell renders with zero app-side changes.
function __phoneSafetyKey(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^1/, '').slice(-10);
  return digits.length === 10 ? '+1' + digits : null;
}

function __dncPhoneSet(rows) {
  return [...new Set((rows || [])
    .filter(row => row && row.do_not_contact)
    .map(row => __phoneSafetyKey(row.phone))
    .filter(Boolean))];
}

async function __fetchDncPhoneSet(db) {
  const rows = [];
  const pageSize = 1000;
  for (let page = 0; page < 100; page++) {
    const from = page * pageSize;
    const { data, error } = await db.from('contacts')
      .select('phone, do_not_contact')
      .eq('do_not_contact', true)
      .not('phone', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return { data: __dncPhoneSet(rows), error: null };
  }
  return { data: null, error: { message: 'DNC safety list exceeded pagination guard' } };
}

// A temporary iOS network failure must never make a real operator account
// look like a genuinely empty account. Keep the last verified contact and
// DNC snapshot for read-only continuity. While it is displayed,
// contactsLoadFailed remains true, so customer actions remain fail-closed
// until the live safety read succeeds again.
const CONTACT_SNAPSHOT_KEY = 'bpp_v3_contacts_snapshot_v1';

function __readContactSnapshot() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONTACT_SNAPSHOT_KEY) || 'null');
    if (!saved || saved.version !== 1 || !Array.isArray(saved.contacts) || saved.contacts.length === 0) return null;
    if (!saved.contacts.every(c => c && c.id)) return null;
    return {
      contacts: saved.contacts,
      dncPhones: Array.isArray(saved.dncPhones) ? saved.dncPhones : [],
    };
  } catch (_) {
    return null;
  }
}

function __saveContactSnapshot(contacts, dncPhones) {
  try {
    localStorage.setItem(CONTACT_SNAPSHOT_KEY, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      contacts: Array.isArray(contacts) ? contacts : [],
      dncPhones: Array.isArray(dncPhones) ? dncPhones : [],
    }));
  } catch (_) {
    // Snapshot storage is a continuity improvement, never a hard dependency.
  }
}

function __showCachedContacts(snapshot, detail) {
  if (!snapshot) return false;
  CRM.contacts = snapshot.contacts;
  CRM.dncPhones = snapshot.dncPhones;
  CRM.contactsFromSnapshot = true;
  CRM.contactsLoadFailed = true;
  CRM.authed = true;
  // During a normal boot this snapshot is useful continuity, but it is not
  // enough to declare the CRM ready: proposals, messages, and invoices plus
  // payments still need to settle before their empty states are truthful.
  if (!detail || detail.deferReady !== true) {
    CRM.loaded = true;
    window.dispatchEvent(new CustomEvent('crm-data-ready', { detail: Object.assign({ authed: true, cached: true }, detail || {}) }));
  }
  return true;
}

function __markFixtureDomainsReady() {
  const syntheticSettledAt = Date.now();
  for (const name of Object.keys(CRM.domainStatus || {})) {
    CRM.domainStatus[name] = {
      state: 'ready', error: null, attempts: 1,
      startedAt: syntheticSettledAt, settledAt: syntheticSettledAt,
      source: 'synthetic-fixture',
    };
  }
  CRM.criticalLoadFailed = false;
}

function __loadTestFixtures() {
  var nowMs = Date.now();
  var iso = function (d, h, m) { var x = new Date(nowMs); x.setDate(x.getDate() + d); x.setHours(h || 9, m || 0, 0, 0); return x.toISOString(); };
  var ago = function (mins) { return new Date(nowMs - mins * 60000).toISOString(); };
  CRM.contacts = [
    { id:'t-eric',   name:'Eric Lutz',      phone:'+18645550101', email:'eric@example.test',  address:'107 Arlen Ave Simpsonville SC 29681', stage:'install', amperage:'50', assigned_installer:'You',     do_not_contact:false, archived:false, channel:'meta',      created_at: ago(60*24*9), pinned:true },
    { id:'t-dana',   name:'Dana Whitfield', phone:'+18645550102', email:'dana@example.test',  address:'412 Oakmont Dr Greenville SC 29615',  stage:'booked',  amperage:'30', assigned_installer:'Eric T.', do_not_contact:false, archived:false, channel:'direct',    created_at: ago(60*24*5) },
    { id:'t-marcus', name:'Marcus Reyes',   phone:'+18645550103', email:'',                   address:'88 Cedar Ln Greer SC 29651',          stage:'quoted',  amperage:'',   assigned_installer:'',         do_not_contact:false, archived:false, channel:'get-quote', created_at: ago(60*24*2) },
    { id:'t-priya',  name:'Priya Shah',     phone:'+18645550104', email:'priya@example.test', address:'',                                    stage:'new',     amperage:'',   assigned_installer:'',         do_not_contact:false, archived:false, channel:'neighbor',  created_at: ago(60*6), notes:'__review_asked: 2026-07-10\nCalled twice, no answer. Wants to compare against a whole-home unit before deciding. Follow up after the next storm.' },
    // Ionic S1 (critic fix): Hank is the DEDICATED verify_permit fixture, so
    // Glenn keeps his purpose-built single-submitted-permit story (the
    // Permits-lens chip-count-1 invariant, CRM-TAP-OPT-EXECUTION-PLAN).
    { id:'t-hank',   name:'Hank Waters',    phone:'+18645550107', email:'hank@example.test',  address:'415 Dogwood Trl Greer SC 29651',      stage:'booked',  amperage:'30', assigned_installer:'',         do_not_contact:false, archived:false, channel:'direct',    created_at: ago(60*24*12) },
    { id:'t-glenn',  name:'Glenn Parker',   phone:'+18645550105', email:'glenn@example.test', address:'33 Maple St Greenville SC 29601',     stage:'booked',  amperage:'50', assigned_installer:'',         do_not_contact:false, archived:false, channel:'meta',      created_at: ago(60*24*7) },
    // Ionic increment N fixtures (stage advance + archive/restore/DNC/soft
    // delete): no existing fixture exercised an archived OR a do-not-contact
    // contact, both states this increment's action sheet needs to gate on.
    { id:'t-wanda',  name:'Wanda Ellis',    phone:'+18645550106', email:'wanda@example.test', address:'21 Birchwood Ct Taylors SC 29687',    stage:'booked',  amperage:'30', assigned_installer:'',         do_not_contact:false, archived:true,  channel:'direct',    created_at: ago(60*24*30) },
    { id:'t-carl',   name:'Carl Rhodes',    phone:'+18645550107', email:'carl@example.test',  address:'14 Pineview Rd Duncan SC 29334',      stage:'quoted',  amperage:'',   assigned_installer:'',         do_not_contact:true,  archived:false, channel:'meta',      created_at: ago(60*24*12) },
  ];
  CRM.contactsLoadFailed = false;
  CRM.contactsFromSnapshot = false;
  CRM.dncPhones = __dncPhoneSet(CRM.contacts);
  // Synthetic property_pre_reads (TEST_MODE only) so the walk-verdict badges +
  // the Active-lens walk filter are visually exercisable without real walk
  // data. One per verdict-ladder rung; the other contacts have NO pre-read so
  // their rows show no badge (non-walk leads). fetchPreReadsBulk returns this
  // map under TEST_MODE (the real per-contact query is stubbed to []).
  CRM.__testPreReads = {
    // stage 5 completed: room + distance + photo + the server completion stamp
    't-marcus': { contact_id:'t-marcus', confirmed_panel_room:'Garage, right of the door', confirmed_generator_spot:null, customer_run_ft_estimate:null, distance_band:'20_40', photo_received_at: ago(60*24*2), gift_requested_at: ago(60*24*2), completion_notified_at: ago(60*24*2) },
    // stage 4 stopped at the photo step: room + distance, no photo, did not finish
    't-priya':  { contact_id:'t-priya', confirmed_panel_room:'Basement, north wall', confirmed_generator_spot:null, customer_run_ft_estimate:null, distance_band:'10_20', photo_received_at:null, gift_requested_at:null, completion_notified_at:null },
    // stage 3 stopped at the distance step: room only
    't-glenn':  { contact_id:'t-glenn', confirmed_panel_room:'Exterior east wall', confirmed_generator_spot:null, customer_run_ft_estimate:null, distance_band:null, photo_received_at:null, gift_requested_at:null, completion_notified_at:null },
    // stage 1 only started (landing): a row exists, nothing answered past the form
    't-hank':   { contact_id:'t-hank', confirmed_panel_room:null, confirmed_generator_spot:null, customer_run_ft_estimate:null, distance_band:null, photo_received_at:null, gift_requested_at:null, completion_notified_at:null },
  };
  CRM.events = [
    { id:'t-ev1', contact_id:'t-eric',   kind:'install',    status:'scheduled', start_at: iso(0,11),    end_at: iso(0,14), title:null, notes:'200A panel, garage right wall.', assigned_installer:null, installer_notified_at:null, installer_confirmed_at:null },
    { id:'t-ev2', contact_id:'t-dana',   kind:'install',    status:'scheduled', start_at: iso(2,9),     end_at: iso(2,12), title:'Panel swap + inlet', notes:null, assigned_installer:'Eric T.', installer_notified_at: ago(60*20), installer_confirmed_at:null },
    { id:'t-ev3', contact_id:'t-marcus', kind:'inspection', status:'scheduled', start_at: iso(0,15,30), end_at:null, title:null, notes:null, assigned_installer:null, installer_notified_at:null, installer_confirmed_at:null },
    // Ionic Calendar increment F fixtures (read-only agenda exercise):
    // t-ev4 is a completed install from YESTERDAY, exercising the Done-check
    // + dimmed row under a non-today day divider. t-ev5 is a cancelled
    // install TODAY, exercising the "cancelled never renders" rule (it must
    // never show up in the agenda or count toward the badge). t-ev6 is a
    // scheduled 'walk' (a kind with no CAL_KIND entry, same _other/grey
    // fallback quirk as t-ev3's 'inspection') TODAY 13:00-15:00, overlapping
    // t-ev1's 11:00-14:00 window, exercising the Conflict chip (the bespoke's
    // hasConflict predicate has no contact scoping, see the increment
    // report Decisions, so t-ev1 and t-ev6 both flag Conflict despite being
    // different contacts).
    { id:'t-ev4', contact_id:'t-eric',   kind:'install', status:'completed', start_at: iso(-1,10),   end_at: iso(-1,13), title:null, notes:null, assigned_installer:null, installer_notified_at:null, installer_confirmed_at:null },
    { id:'t-ev5', contact_id:'t-marcus', kind:'install', status:'cancelled', start_at: iso(0,9),     end_at: iso(0,10),  title:null, notes:null, assigned_installer:null, installer_notified_at:null, installer_confirmed_at:null },
    { id:'t-ev6', contact_id:'t-priya',  kind:'walk',    status:'scheduled', start_at: iso(0,13),    end_at: iso(0,15),  title:null, notes:null, assigned_installer:null, installer_notified_at:null, installer_confirmed_at:null },
  ];
  CRM.proposals = [
    // Ionic increment S2 fixture: pom_accepted:true added so Dana is the
    // dedicated POM-inspection fixture (an Approved, not superseded proposal,
    // exercising POMSection's gate under ?test=1). Her existing proposals-
    // focused story (t-pr1 Signed + t-pr7 superseded draft) is untouched,
    // this is additive only.
    { id:'t-pr1', contact_id:'t-dana',   token:'tok-dana', status:'Approved', total:1447, amp_type:'50', selected_amp:'50', length_ft:25, created_at: ago(60*24*4), sent_at: ago(60*24*4), viewed_at: ago(60*24*3), signed_at: ago(60*24*2), approved_at: ago(60*24*2), creator_version:3, pricing_tier:'pom', pom_accepted:true },
    { id:'t-pr2', contact_id:'t-marcus', token:'tok-marc', status:'Sent',   total:1197, amp_type:'30', selected_amp:'30', length_ft:25, created_at: ago(60*24*1), sent_at: ago(60*24*1), viewed_at: ago(60*8), signed_at:null, creator_version:3, pricing_tier:'pom' },
    // Approved (not just Signed), production reality per Key 2026-07-11: the
    // deposit payment (t-in3 below) is what GRANTS approved, mirroring
    // mapProposal's deposit-gate rule (crm-data.js:1113-1125, bug #114): a
    // proposal cannot sit 'Signed' once its deposit has already been paid,
    // that combination is impossible in production (stripe-webhook is the
    // sole grantor of Approved and only fires after a real charge). Expected
    // side effect: Glenn's money-status pill on ContactDetailPage moves from
    // 'Awaiting deposit' to the unbilled branch ('Send invoice', $1,358 =
    // $1,697 approved minus $339 invoiced, >= 20% unbilled threshold).
    { id:'t-pr3', contact_id:'t-glenn',  token:'tok-glen', status:'Approved', total:1697, amp_type:'50', selected_amp:'50', length_ft:25, created_at: ago(60*24*6), sent_at: ago(60*24*6), viewed_at: ago(60*24*6), signed_at: ago(60*24*5), creator_version:3, pricing_tier:'pom' },
    // Ionic Finance increment G fixture: a DECLINED proposal for Priya
    // (raw status 'Declined', mapProposal passes non-listed statuses through
    // lowercase unchanged, so mapped status stays 'declined') so the
    // Proposals sub-tab has a struck-through pill to exercise. amount_cents
    // set directly (bypassing the dollars-denominated `total` field the
    // other fixtures use) so the mapped total is unambiguous at $899.
    { id:'t-pr4', contact_id:'t-priya',  token:'tok-priya', status:'Declined', amount_cents:89900, amp_type:'30', selected_amp:'30', length_ft:25, created_at: ago(60*24*10), sent_at: ago(60*24*10), viewed_at:null, signed_at:null, creator_version:3, pricing_tier:'pom' },
    // Ionic increment O fixtures (proposal composer + per-status actions):
    // t-pr5 is a fresh 'Created' draft for Eric (a second proposal alongside
    // his existing paid deal, exercises Send/Copy/Edit/Delete). t-pr6 is an
    // 'expired' proposal for Carl (do_not_contact:true, quoted stage)
    // exercising Revive/Delete only, proving revive/delete never gate on
    // do_not_contact (only Send/Copy do). t-pr7 is a SUPERSEDED 'Created'
    // draft for Dana (superseded_at set, created 30 minutes before t-pr1
    // superseded it), proving contactMoneyDocs still lists a superseded row
    // instead of silently hiding it, superseded is a column, not a status.
    { id:'t-pr5', contact_id:'t-eric',  token:'tok-eric-2', status:'Created', total:1197, amp_type:'30', selected_amp:'30', length_ft:25, created_at: ago(60*3), sent_at:null, viewed_at:null, signed_at:null, creator_version:3, pricing_tier:'standard' },
    { id:'t-pr6', contact_id:'t-carl',  token:'tok-carl',   status:'expired', total:1297, amp_type:'30', selected_amp:'30', length_ft:25, created_at: ago(60*24*20), sent_at: ago(60*24*20), viewed_at: ago(60*24*19), signed_at:null, creator_version:3, pricing_tier:'standard' },
    { id:'t-pr7', contact_id:'t-dana',  token:'tok-dana-2', status:'Created', total:1447, amp_type:'50', selected_amp:'50', length_ft:25, created_at: ago(60*24*4+30), sent_at:null, viewed_at:null, signed_at:null, creator_version:3, pricing_tier:'pom', superseded_at: ago(60*24*4), superseded_by:'t-pr1' },
  ];
  CRM.invoices = [
    { id:'t-in1', contact_id:'t-eric', status:'sent', amount_cents:144700, created_at: ago(60*24*1), sent_at: ago(60*24*1), due_at: iso(7,9), paid_at:null, invoice_num:'BPP-T-0001', line_items:[], token:'tok-inv-eric' },
    // Ionic Finance increment G fixtures (read-only dashboard/list exercise):
    // t-in2 is Marcus's invoice sent 20 days ago, still raw status 'sent'
    // (the DB never flips the status column, crm-shared.jsx:1867-1896), so
    // it exercises the DERIVED isInvoiceOverdue path, this pushes Marcus
    // past the 14-day threshold and lights his Contacts-list due badge too
    // (expected side effect, not a regression). t-in3 is Glenn's deposit
    // invoice already paid 2 days ago, exercising the Paid tile + month
    // pulse (this calendar month).
    { id:'t-in2', contact_id:'t-marcus', status:'sent', amount_cents:59900, created_at: ago(60*24*20), sent_at: ago(60*24*20), due_at: iso(-13,9), paid_at:null, invoice_num:'BPP-T-0002', line_items:[], token:'tok-inv-marcus' },
    { id:'t-in3', contact_id:'t-glenn', kind:'deposit', status:'paid', amount_cents:33900, created_at: ago(60*24*5), sent_at: ago(60*24*5), paid_at: ago(60*24*2), invoice_num:'BPP-T-0003', line_items:[], token:'tok-inv-glenn' },
    // Dana has a scheduled install, so her required deposit is already paid.
    // This keeps the synthetic business state possible and prevents a false
    // Booked + Install scheduled + Awaiting deposit combination in both CRMs.
    { id:'t-in9', contact_id:'t-dana', proposal_id:'t-pr1', kind:'deposit', status:'paid', amount_cents:28900, created_at: ago(60*24*2), sent_at: ago(60*24*2), paid_at: ago(60*24*2), invoice_num:'BPP-T-0009', line_items:[], token:'tok-inv-dana-deposit' },
    // Ionic Increment L (invoice quick actions) coverage: a draft (Edit-price
    // -only action-sheet gate, never sent so never Void/Mark paid/Record
    // payment) and a voided invoice (Revive-only gate). Neither status
    // existed in the fixture set before this increment. Contacts picked from
    // the existing 5 with no invoice yet (t-dana, t-priya) so neither
    // collides with an existing Money documents row.
    { id:'t-in4', contact_id:'t-dana', kind:'final', status:'draft', amount_cents:80000, created_at: ago(60*3), sent_at:null, paid_at:null, invoice_num:'BPP-T-0004', line_items:[], token:'tok-inv-dana' },
    { id:'t-in5', contact_id:'t-priya', kind:'final', status:'voided', amount_cents:50000, created_at: ago(60*24*8), sent_at: ago(60*24*8), paid_at:null, invoice_num:'BPP-T-0005', line_items:[], token:'tok-inv-priya' },
    // Ionic increment P fixtures (invoice CRUD + ALL send-email flows):
    // t-in1..t-in5 above had NO token, making Send/Copy/Email untestable
    // under ?test=1 (every real invoice gets a token at insert time, tokens
    // added above, additive only). t-in6/7/8 are new, all on t-wanda (an
    // existing archived-contact fixture with zero prior proposals/invoices,
    // picked deliberately so adding them can never perturb any other
    // fixture's already-documented billedSum/unbilled/dashboard numbers).
    // t-in6 is a PARTIALLY paid invoice (paid_cents > 0 < amount_cents),
    // exercising isPartial -> "Send deposit receipt" / "Send receipt for
    // what is paid". t-in7 is PAID with a partial refund on its one
    // completed payment, exercising "Email refund receipt". t-in8 is unpaid
    // with one FAILED payment attempt, exercising "Email bank-transfer
    // retry". All three are standalone (no proposal_id), matching the
    // bespoke's own orphan-invoice concept.
    { id:'t-in6', contact_id:'t-wanda', kind:'final', status:'sent', amount_cents:120000, created_at: ago(60*24*2), sent_at: ago(60*24*2), paid_at:null, invoice_num:'BPP-T-0006', line_items:[], token:'tok-inv-wanda-partial' },
    { id:'t-in7', contact_id:'t-wanda', kind:'final', status:'paid', amount_cents:60000, created_at: ago(60*24*10), sent_at: ago(60*24*10), paid_at: ago(60*24*9), invoice_num:'BPP-T-0007', line_items:[], token:'tok-inv-wanda-refund' },
    { id:'t-in8', contact_id:'t-wanda', kind:'deposit', status:'sent', amount_cents:70000, created_at: ago(60*24*1), sent_at: ago(60*24*1), paid_at:null, invoice_num:'BPP-T-0008', line_items:[], token:'tok-inv-wanda-achfail' },
  ];
  CRM.messages = [
    { id:'t-m1', contact_id:'t-eric', direction:'inbound',  body:'Sounds good, see you then!', created_at: ago(60*4), sender_role:'customer', read_at: ago(60*2) },
    { id:'t-m2', contact_id:'t-eric', direction:'outbound', body:'Confirmed for 11am, I will text when I am on the way.', created_at: ago(60*3), sender_role:'key' },
    { id:'t-m3', contact_id:'t-dana', direction:'inbound',  body:'Can we move to next week?', created_at: ago(60*30), sender_role:'customer' },
    // Ionic Messages increment E fixtures (read-only thread/list exercise):
    // a failed outbound so the failed-bubble + inbox "Not delivered" states
    // are exercisable under ?test=1, plus a note + system row on Eric's
    // thread so the non-bubble timeline rows render too.
    { id:'t-m4', contact_id:'t-dana', direction:'outbound', body:'Running behind, can we do 2pm instead of 9am?', created_at: ago(30), sender_role:'key', status:'failed', error_message:'Carrier rejected: unreachable handset' },
    { id:'t-m5', contact_id:'t-eric', direction:'outbound', body:'Note to self: gate code 4471', created_at: ago(60*3), sender_role:'key', kind:'note' },
    { id:'t-m6', contact_id:'t-eric', direction:'outbound', body:'Proposal signed, $1,677', created_at: ago(60*24), sender_role:'key', kind:'system' },
    // Inbound MMS with no body and (in the test stub) no comm_attachments
    // row: exercises the honest "Photo unavailable" placeholder path in both
    // apps rather than leaving the MMS branch untested (critic, increment E).
    { id:'t-m7', contact_id:'t-eric', direction:'inbound', body:'', created_at: ago(60*5), sender_role:'customer', kind:'mms', read_at: ago(60*2) },
  ];
  CRM.__testMmsAttachments = {
    't-m7': [{
      storage_path: null,
      content_type: 'image/jpeg',
      size_bytes: 1024,
      source_url: SIM_FIXTURE_MEDIA ? SIM_FIXTURE_MEDIA.first : 'https://hfatblrcwytxvijjhpal.supabase.co/storage/v1/object/public/message-media/mms/fixture-customer-photo.jpg',
    }],
  };
  // A second customer photo that is only present in the durable gallery
  // exercises the receiver handoff: it must appear beside the thread
  // attachment rather than disappearing because it has no attached fixture
  // message in this test session.
  CRM.contactPhotos = [
    { id:'t-cp1', contact_id:'t-eric', url:SIM_FIXTURE_MEDIA ? SIM_FIXTURE_MEDIA.first : 'https://hfatblrcwytxvijjhpal.supabase.co/storage/v1/object/public/message-media/mms/fixture-customer-photo-gallery.jpg', caption:'Texted in by customer' },
    // Same object through a query-decorated URL, the production shape when a
    // receiver and a refreshed gallery disagree on URL form. It must not add
    // a second tile.
    { id:'t-cp2', contact_id:'t-eric', url:SIM_FIXTURE_MEDIA ? SIM_FIXTURE_MEDIA.first + '#receiver-copy' : 'https://hfatblrcwytxvijjhpal.supabase.co/storage/v1/object/public/message-media/mms/fixture-customer-photo-gallery.jpg?download=1', caption:'Duplicate transport row' },
    // A legacy double-copy can occupy two different storage paths. The gallery
    // must compare image bytes as a last display-only safety net, not merely
    // the URL or filename.
    { id:'t-cp3', contact_id:'t-eric', url:SIM_FIXTURE_MEDIA ? SIM_FIXTURE_MEDIA.first + '#legacy-copy' : 'https://hfatblrcwytxvijjhpal.supabase.co/storage/v1/object/public/message-media/mms/legacy-copy/fixture-customer-photo-gallery.jpg', caption:'Duplicate legacy copy' },
    { id:'t-cp4', contact_id:'t-eric', url:SIM_FIXTURE_MEDIA ? SIM_FIXTURE_MEDIA.second : 'https://hfatblrcwytxvijjhpal.supabase.co/storage/v1/object/public/message-media/mms/fixture-customer-photo-second.jpg', caption:'A different customer photo' },
  ];
  CRM.calls = [
    { id:'t-c1', contact_id:'t-eric', direction:'inbound', started_at: ago(60*26), duration_sec:184, status:'completed', from_phone:'+18645550101', to_phone:'+18648637800', notes:null, ai_summary:'Confirmed install time and asked about cord length.' },
    // Ionic Calls increment F fixtures (read-only exercise): t-c2 is a
    // missed inbound from Dana with no later outbound call, exercising the
    // Callback Queue banner. t-c3 is Glenn's unanswered call that rolled to
    // voicemail (raw shape mirrors the real twilio-voice write: direction
    // stays 'missed', status becomes 'voicemail', duration_sec is never set
    // on that path, see supabase/functions/twilio-voice/index.ts:181,219-234),
    // exercising the purple voicemail row + quoted transcript.
    { id:'t-c2', contact_id:'t-dana',  direction:'missed', started_at: ago(180), duration_sec:0, status:'missed', from_phone:'+18645550102', to_phone:'+18648637800', notes:null, ai_summary:null },
    { id:'t-c3', contact_id:'t-glenn', direction:'missed', started_at: ago(300), status:'voicemail', from_phone:'+18645550105', to_phone:'+18648637800', notes:null, ai_summary:null,
      voicemail_url:'https://hfatblrcwytxvijjhpal.supabase.co/functions/v1/get-recording?sid=t-fixture', voicemail_duration:22,
      voicemail_transcript:'Hey this is Glenn, just wondering about the quote you sent over. Give me a call back.' },
    // Ionic per-contact Calls segment fixture (increment R): an already-heard
    // voicemail with a filled note, so the no-dot (heard) state and the
    // filled-note closed-editor render are both exercisable under ?test=1,
    // alongside t-c3's unheard+empty-note state above.
    { id:'t-c4', contact_id:'t-eric', direction:'missed', started_at: ago(60*40), status:'voicemail', from_phone:'+18645550101', to_phone:'+18648637800', notes:'Asked about crawlspace access', ai_summary:null,
      voicemail_url:'https://hfatblrcwytxvijjhpal.supabase.co/functions/v1/get-recording?sid=t-fixture-2', voicemail_duration:15,
      voicemail_transcript:'Hey it is Eric again, quick question about the crawlspace access for install day.',
      listened_at: ago(60*38) },
  ];
  // The fixtures above are in RAW DB shape; the live loader runs each list
  // through its mapper so the UI reads familiar names (direction 'in'/'out',
  // sent_at, etc.). Run the same pass here so the Inbox + Finance tabs
  // populate under ?test=1. Order matters: proposals before invoices
  // (mapInvoice cross-references CRM.proposals).
  // Glenn's permit sits submitted with the county (not yet approved), so his
  // next job step is 'mark_approved' , exercises the permit fast-path lens +
  // rail (tap-audit #3). He is booked with a signed proposal and NO install
  // event, so nothing masks the permit step.
  // Ionic increment S1 fixture (critic fix): t-pm2 belongs to HANK, the
  // dedicated verify_permit fixture (approved permit + unverified readiness
  // row below), leaving Glenn's single-submitted-permit story untouched (the
  // Permits-lens chip-count-1 invariant depends on it).
  CRM.permits = [
    { id:'t-pm1', contact_id:'t-glenn', jurisdiction_name:'Greenville County', permit_number:'GVL-2026-0042', status:'submitted', submitted_at: ago(60*24*3), approved_at:null, cost_cents:12500, created_at: ago(60*24*3) },
    { id:'t-pm2', contact_id:'t-hank', jurisdiction_name:'Greenville County', permit_number:'ELE-26-4410', status:'approved', submitted_at: ago(60*24*2), approved_at: ago(60*24*1), cost_cents:12500, created_at: ago(60*24*1) },
  ];
  // Ionic increment P fixtures: __paidByInvoice/__paymentsByInvoice back
  // mapInvoice's paid_cents/.payments fields (crm-data.js:1219-1222) and are
  // normally populated by loadPaidByInvoice() querying the real `payments`
  // table, never called in TEST_MODE. Set directly here, BEFORE the
  // CRM.invoices map below reads them, so t-in6/7/8 (added above) render as
  // partially-paid / refunded / failed-payment invoices under ?test=1.
  __paidByInvoice = { 't-in6': 48000, 't-in7': 40000 };
  __paymentsByInvoice = {
    't-in6': [{ id:'t-pay-6a', proposal_id:null, amount:480, refunded_amount:0, status:'completed' }],
    't-in7': [{ id:'t-pay-7a', proposal_id:null, amount:600, refunded_amount:200, status:'completed' }],
    't-in8': [{ id:'t-pay-8a', proposal_id:null, amount:700, refunded_amount:0, status:'failed' }],
  };
  CRM.events    = CRM.events.map(mapEvent);
  CRM.messages  = CRM.messages.map(mapMessage);
  CRM.proposals = CRM.proposals.map(mapProposal);
  CRM.invoices  = CRM.invoices.map(mapInvoice);
  CRM.calls     = CRM.calls.map(mapCall);
  CRM.permits   = CRM.permits.map(mapPermit);
  // Ionic increment S1 fixtures: Eric has an in-flight specialty part (inlet
  // ordered) plus one EXTRA (breaker, not yet ordered) so the InstallSpecCard
  // remove/undo affordance (extras only, never the 3 permanent kinds) is
  // exercisable under ?test=1. Neither gates Eric's own next-step card (his
  // install event iso(0,11) above already gates it before the materials
  // check ever runs), so this cannot perturb his existing fixture story.
  CRM.materials = [
    { id:'t-mat1', contact_id:'t-eric', kind:'inlet',   status:'ordered',     ordered_at: ago(60*24*2), received_at:null, installed_at:null, created_at: ago(60*24*2) },
    { id:'t-mat2', contact_id:'t-eric', kind:'breaker', status:'not_ordered', ordered_at:null,          received_at:null, installed_at:null, created_at: ago(60*24*1) },
  ].map(mapMaterial);
  CRM.stageHistory = [];
  // Hank's readiness row exists but is unverified (permit_verified_at:
  // null), pairing with t-pm2 above: his gating permit is approved, so
  // advanceJobNext's next step becomes 'verify_permit', exercising the Ionic
  // PermitsCard's "Mark permit verified" row under ?test=1 without touching
  // Glenn's mark_approved story (critic fix).
  CRM.readiness = [
    { contact_id:'t-hank', permit_verified_at: null },
  ];
  // Ionic increment S2 fixtures: job_photos ships in RAW db shape already
  // (no mapper, window.CRM.jobPhotos = jobPhotosR.data direct, crm-data.js:
  // 1909), so these are the final shape, not run through a map* call. Two
  // rows on Eric (an installing contact, so PhotosSection's "stage >= booked"
  // door is already open regardless) exercise the non-empty grid + full-
  // screen viewer + Remove-with-confirm under ?test=1. URLs are supabase-
  // shaped so isTrustedJobPhotoUrl's allowlist passes them; they will 404 in
  // a real browser (no such objects exist in storage), which is DELIBERATE,
  // same honest-fallback precedent as t-m7 (crm-data.js above): the img's
  // onError -> "Photo unavailable" tile is the thing being exercised, not a
  // live image byte-for-byte match.
  CRM.jobPhotos = [
    { id:'t-jp1', contact_id:'t-eric', url:'https://hfatblrcwytxvijjhpal.supabase.co/storage/v1/object/public/message-media/crm-job-photos/t-eric/panel-before.jpg', storage_path:'crm-job-photos/t-eric/panel-before.jpg', caption:null, uploaded_by:'key', uploaded_at: ago(60*24*1), annotated:false, photo_kind:'panel_before' },
    { id:'t-jp2', contact_id:'t-eric', url:'https://hfatblrcwytxvijjhpal.supabase.co/storage/v1/object/public/message-media/crm-job-photos/t-eric/inlet-installed.jpg', storage_path:'crm-job-photos/t-eric/inlet-installed.jpg', caption:null, uploaded_by:'key', uploaded_at: ago(60*23), annotated:false, photo_kind:'other' },
  ];
  // Known sub roster (live loader fills this from installer_tokens); seed it so
  // the JobSheet installer chips (tap-audit #5) have something to render.
  CRM.installers = ['Eric T.', 'Marcus B.'];
  // Multi-line fixtures (2026-06-20): two registered BPP lines + a current_line
  // on two contacts so the colored avatar ring (Calls + Messaging) is
  // exercisable under ?test=1. Eric on the Main line, Dana on the Ads line.
  CRM.lines = [
    { id:'t-l1', phone:'+18648637800', label:'Main', color:'#2563eb', is_default:true,  active:true, sort_order:0 },
    { id:'t-l2', phone:'+18644005302', label:'Ads',  color:'#ffba00', is_default:false, active:true, sort_order:1 },
  ];
  { const byId = id => CRM.contacts.find(c => c.id === id);
    const e = byId('t-eric');  if (e) e.current_line = '+18648637800';
    const d = byId('t-dana');  if (d) d.current_line = '+18644005302'; }
  CRM.now = new Date();
  __markFixtureDomainsReady();
  CRM.loaded = true;
  CRM.authed = true;
  console.log('[CRM] TEST MODE active: real shell + ' + CRM.contacts.length + ' fixture contacts. NO live data, NO real sends/charges.');
  window.dispatchEvent(new CustomEvent('crm-data-ready', { detail: { authed: true } }));
  window.dispatchEvent(new CustomEvent('crm-data-changed'));
}

async function loadLiveData() {
  if (TEST_MODE) {
    if (TEST_CONTACTS_FAILURE) {
      __markFixtureDomainsReady();
      CRM.domainStatus.contacts = {
        state: 'error', error: 'Synthetic contacts failure', attempts: 1,
        startedAt: Date.now(), settledAt: Date.now(), source: 'synthetic-fixture',
      };
      if (!__showCachedContacts(__readContactSnapshot(), { testContactsFailure: true })) {
        CRM.contacts = [];
        CRM.dncPhones = [];
        CRM.contactsFromSnapshot = false;
        CRM.contactsLoadFailed = true;
        CRM.authed = true;
        CRM.loaded = true;
        window.dispatchEvent(new CustomEvent('crm-data-ready', { detail: { authed: true, testContactsFailure: true } }));
      }
      return;
    }
    __loadTestFixtures();
    return;
  }
  if (__loadInFlight) return __loadInFlight;
  __loadInFlight = (async () => {
    try { await _loadLiveDataInner(); } finally { __loadInFlight = null; }
  })();
  return __loadInFlight;
}

async function _loadLiveDataInner() {
  window.__bppBootMark?.('live data load started');
  if (!__db) {
    console.warn('[CRM] supabase-js not loaded, staying in empty state');
    return;
  }
  // Tear down any pre-existing channels from a prior call. Safe no-op on
  // first run (array is empty).
  for (const ch of __realtimeChannels) {
    try { await __db.removeChannel(ch); } catch (_) { /* ignore */ }
  }
  __realtimeChannels = [];

  // A Capacitor WebView can occasionally leave session restoration pending
  // forever after the OS suspends the app. Bound this one bootstrap boundary
  // so the operator gets a recoverable signed-out state instead of an endless
  // loading spinner. The table reads below already have their own timeouts.
  const sessionResult = await Promise.race([
    __db.auth.getSession(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Session restoration timed out after 8000ms')), 8000)),
  ]);
  const { data: { session } } = sessionResult;
  window.__bppBootMark?.('session available');
  if (!session) {
    window.CRM.authed = false;
    window.CRM.loaded = true;
    window.dispatchEvent(new CustomEvent('crm-data-ready', { detail: { authed: false } }));
    return;
  }
  window.CRM.authed = true;

  // Restore a previously verified list while the fresh live read runs. This
  // is deliberately read-only: the normal safety gate remains closed until
  // contacts and the DNC list both arrive from the server.
  const cachedContacts = __readContactSnapshot();
  if (cachedContacts) {
    __showCachedContacts(cachedContacts, { deferReady: true });
  }

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days back

  // Contacts plus the phone-wide DNC safety set are the only first-paint reads.
  // Quote, money, message, photo, and project tables start after the Contacts
  // ready event and a render opportunity, so a slow optional table cannot hold
  // the operator behind the full-screen loader. Calls are outside Version 6 and
  // do not take part in boot at all.
  const contactsProgressive = startProgressiveDomains({
    domains: {
      contacts: {
        tasks: {
          contacts: () => __db.from('contacts')
            .select(CONTACT_COLS)
            .order('created_at', { ascending: false })
            .limit(500),
          dnc: () => __fetchDncPhoneSet(__db),
        },
      },
    },
    criticalNames: ['contacts'],
    statuses: window.CRM.domainStatus,
    timeoutMs: 4000,
    maxAttempts: 2,
    retryDelayMs: 150,
  });

  const critical = await contactsProgressive.critical;
  window.__bppBootMark?.('Contacts safety domain settled');
  const contactsDomain = critical.domains.contacts;

  const contactsLive = contactsDomain.ok;
  window.CRM.contactsLoadFailed = !contactsLive;
  if (contactsLive) {
    const contactsR = contactsDomain.results.contacts;
    const dncR = contactsDomain.results.dnc;
    window.CRM.dncPhones = dncR.data || [];
    window.CRM.contacts = (contactsR.data || []).map(mapContact).filter(c => !c.archived);
    window.CRM.contactsFromSnapshot = false;
    __saveContactSnapshot(window.CRM.contacts, window.CRM.dncPhones);
  } else if (cachedContacts) {
    __showCachedContacts(cachedContacts, { deferReady: true, partialLoadFailure: true });
  } else {
    window.CRM.dncPhones = [];
    window.CRM.contacts = [];
    window.CRM.contactsFromSnapshot = false;
  }

  // Optional domains have their own localized readiness and error surfaces.
  // They must never hold an otherwise usable Contacts list behind a global
  // error page or let their untouched arrays pose as verified empty results.
  window.CRM.criticalLoadFailed = !contactsLive && !cachedContacts;
  window.CRM.loaded = true;
  console.log(`[CRM] Contacts ready with ${CRM.contacts.length} contacts; secondary domains are loading progressively`);
  window.dispatchEvent(new CustomEvent('crm-data-ready', {
    detail: { authed: true, criticalLoadFailed: window.CRM.criticalLoadFailed },
  }));
  window.__bppBootMark?.('CRM ready');

  // Realtime, re-fetch the whole table on any change. The lists are small
  // enough (under 500 rows) that a full refresh is simpler than a delta
  // merge and avoids drift bugs. Components re-render via crm-data-changed.
  __realtimeChannels.push(__db.channel('v3-contacts')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, async () => {
      try {
        const [contactsResult, dncResult] = await Promise.all([
          __db.from('contacts').select(CONTACT_COLS)
            .order('created_at', { ascending: false }).limit(500),
          __fetchDncPhoneSet(__db),
        ]);
        const { data, error } = contactsResult;
        if (error || dncResult.error) {
          window.CRM.contactsLoadFailed = true;
          console.warn('[CRM] realtime contacts refetch failed:',
            (error && error.message) || (dncResult.error && dncResult.error.message));
          return;
        }
        window.CRM.contactsLoadFailed = false;
        window.CRM.dncPhones = dncResult.data || [];
        window.CRM.contacts = (data || []).map(mapContact).filter(c => !c.archived);
        window.CRM.contactsFromSnapshot = false;
        __saveContactSnapshot(window.CRM.contacts, window.CRM.dncPhones);
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'contacts' } }));
      } catch (e) {
        window.CRM.contactsLoadFailed = true;
        console.warn('[CRM] realtime contacts handler error:', e.message);
      }
    })
    .subscribe());

  let __messagesRealtimeGeneration = 0;
  let __proposalsRealtimeGeneration = 0;
  let __moneyRealtimeGeneration = 0;
  let __messagesRealtimeRequest = 0;
  let __proposalsRealtimeRequest = 0;
  let __moneyRealtimeRequest = 0;
  __realtimeChannels.push(__db.channel('v3-messages')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async () => {
      const request = ++__messagesRealtimeRequest;
      try {
        const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        // SELECT must include `read_at` and `sender`, without read_at,
        // a realtime fire after the user marks a thread read clobbers
        // the local read_at back to null and re-lights the unread badge.
        // Without sender, the bot-vs-key distinction in the inbox is
        // erased and the suggest-reply prompt mislabels voice samples.
        const { data, error } = await __db.from('messages')
          .select(MSG_COLS)
          .gte('created_at', since).order('created_at', { ascending: false }).limit(2000);
        if (error) { console.warn('[CRM] realtime messages refetch failed:', error.message); return; }
        if (request !== __messagesRealtimeRequest) return;
        window.CRM.messages = applyLocalReads((data || []).map(mapMessage));
        __messagesRealtimeGeneration += 1;
        window.CRM.domainStatus.messages = {
          state: 'ready', error: null, attempts: 1, startedAt: null, settledAt: Date.now(),
        };
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'messages' } }));
      } catch (e) { console.warn('[CRM] realtime messages handler error:', e.message); }
    })
    .subscribe());

  // Invoices + proposals realtime, without these, Mark paid in one tab
  // doesn't propagate to another tab, and a freshly-created proposal sits
  // in stale state until the next online/visibility reconcile.
  __realtimeChannels.push(__db.channel('v3-invoices')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, async () => {
      const request = ++__moneyRealtimeRequest;
      try {
        const { data, error } = await __db.from('invoices')
          .select(// Schema notes (verified empirically 2026-05-01): the invoices table has
// NO `kind` / `sent_at` / `viewed_at` columns. mapInvoice derives them:
// kind from a $-amount heuristic, sent_at from created_at, viewed_at = null.
// If those columns ever get added, expand the SELECT and the mapper.
'id, token, document_number, contact_id, proposal_id, total, status, created_at, due_at, payment_terms, paid_at, payment_method, line_items, creator_version')
          .order('created_at', { ascending: false }).limit(500);
        if (error) { console.warn('[CRM] realtime invoices refetch failed:', error.message); return; }
        const paymentsResult = await fetchPaidRows();
        if (!paymentsResult?.ok) return;
        if (request !== __moneyRealtimeRequest) return;
        applyPaidRows(paymentsResult.data);
        window.CRM.invoices = (data || []).map(mapInvoice);
        __moneyRealtimeGeneration += 1;
        window.CRM.domainStatus.money = {
          state: 'ready', error: null, attempts: 1, startedAt: null, settledAt: Date.now(),
        };
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'invoices' } }));
      } catch (e) { console.warn('[CRM] realtime invoices handler error:', e.message); }
    })
    .subscribe());

  // A partial payment writes ONLY a payments row (the invoice stays unpaid), so
  // the invoices channel above never fires for it. Subscribe to payments too and
  // re-map paid_cents in place so the Money Card's remaining balance updates live.
  __realtimeChannels.push(__db.channel('v3-payments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, async () => {
      const request = ++__moneyRealtimeRequest;
      try {
        const { data, error } = await __db.from('invoices')
          .select('id, token, document_number, contact_id, proposal_id, total, status, created_at, due_at, payment_terms, paid_at, payment_method, line_items, creator_version')
          .order('created_at', { ascending: false }).limit(500);
        if (error) { console.warn('[CRM] realtime payment invoice refetch failed:', error.message); return; }
        const paymentsResult = await fetchPaidRows();
        if (!paymentsResult?.ok) return;
        if (request !== __moneyRealtimeRequest) return;
        applyPaidRows(paymentsResult.data);
        window.CRM.invoices = (data || []).map(mapInvoice);
        __moneyRealtimeGeneration += 1;
        window.CRM.domainStatus.money = {
          state: 'ready', error: null, attempts: 1, startedAt: null, settledAt: Date.now(),
        };
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'payments' } }));
      } catch (e) { console.warn('[CRM] realtime payments handler error:', e.message); }
    })
    .subscribe());

  __realtimeChannels.push(__db.channel('v3-proposals')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'proposals' }, async () => {
      const request = ++__proposalsRealtimeRequest;
      try {
        // SELECT must match the initial bulk loader (line 569). Earlier
        // version omitted creator_version + 10 V3 creator columns
        // (length_ft, include_cord/inlet/permit, pom_*, require_deposit,
        // extra_line_items, discount_*, notes). When ANY proposal changed
        // (status flip, sent_at update, etc.) the realtime refetch
        // blanked all those fields in memory, the proposal modal
        // re-rendered with default values, and Key's customizations
        // appeared to vanish until full reload.
        const { data, error } = await __db.from('proposals')
          .select('id, token, document_number, contact_id, pricing_tier, total, signed_total, amp_type, selected_amp, status, copied_at, created_at, viewed_at, signed_at, sent_at, approved_at, creator_version, length_ft, include_cord, include_inlet, include_permit, pom_offered, pom_accepted, require_deposit, deposit_rate, extra_line_items, discount_type, discount_value, notes, superseded_at, superseded_by, signature_revision, lifecycle_revision, approval_source, accepted_at, approval_channel')
          .order('created_at', { ascending: false }).limit(500);
        if (error) { console.warn('[CRM] realtime proposals refetch failed:', error.message); return; }
        if (request !== __proposalsRealtimeRequest) return;
        window.CRM.proposals = (data || []).map(mapProposal);
        __proposalsRealtimeGeneration += 1;
        window.CRM.domainStatus.proposals = {
          state: 'ready', error: null, attempts: 1, startedAt: null, settledAt: Date.now(),
        };
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'proposals' } }));
      } catch (e) { console.warn('[CRM] realtime proposals handler error:', e.message); }
    })
    .subscribe());

  // Workspace subscriptions wait until the initial workspace snapshot has
  // settled. This prevents a slower initial read from overwriting a newer
  // realtime refetch, while the critical Contacts/Messages/money channels
  // above are already live.
  const installWorkspaceRealtime = () => {
  // calendar_events realtime, without this, an install scheduled in
  // tab A stays invisible in tab B until a hard refresh, and a cancel
  // in tab A leaves a stale "scheduled" event in tab B's calendar.
  __realtimeChannels.push(__db.channel('v3-calendar-events')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, async () => {
      try {
        const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await __db.from('calendar_events')
          .select('id, contact_id, start_at, end_at, title, event_type, status, notes, assigned_installer, installer_notified_at, installer_confirmed_at, created_at')
          .gte('start_at', since)
          .order('start_at', { ascending: true })
          .limit(500);
        if (error) { console.warn('[CRM] realtime calendar refetch failed:', error.message); return; }
        window.CRM.events = (data || []).map(mapEvent);
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'calendar_events' } }));
      } catch (e) { console.warn('[CRM] realtime calendar handler error:', e.message); }
    })
    .subscribe());

  // permits / materials realtime channels, needed because each
  // mutation in the right pane (PermitStatusActions, MaterialRow, etc.)
  // immediately optimistically mutates `CRM.permits[i]` then awaits the
  // DB write. A second tab open on the same contact needs the change
  // to propagate.
  __realtimeChannels.push(__db.channel('v3-permits')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'permits' }, async () => {
      try {
        const { data, error } = await __db.from('permits')
          .select('id, contact_id, jurisdiction_id, jurisdiction_name, permit_number, status, submitted_at, approved_at, cost_cents, blocker_note, created_at, updated_at')
          .order('created_at', { ascending: true }).limit(500);
        if (error) { console.warn('[CRM] realtime permits refetch failed:', error.message); return; }
        window.CRM.permits = (data || []).map(mapPermit);
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'permits' } }));
      } catch (e) { console.warn('[CRM] realtime permits handler error:', e.message); }
    })
    .subscribe());

  __realtimeChannels.push(__db.channel('v3-materials')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, async () => {
      try {
        const { data, error } = await __db.from('materials')
          .select('id, contact_id, kind, status, ordered_at, received_at, installed_at, notes, created_at, updated_at')
          .order('created_at', { ascending: true }).limit(500);
        if (error) { console.warn('[CRM] realtime materials refetch failed:', error.message); return; }
        window.CRM.materials = (data || []).map(mapMaterial);
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'materials' } }));
      } catch (e) { console.warn('[CRM] realtime materials handler error:', e.message); }
    })
    .subscribe());

  // Monotonic token serializes the whole-table refetch: verify_permit then
  // Undo within the 5s toast fire two events → two async refetches with no
  // ordering. Without this, a slow first SELECT could resolve AFTER the second
  // and durably re-show "verified" past a successful un-verify (review 2026-07-02,
  // confirmed med). Capture the seq before the SELECT; apply only if still latest.
  let __readinessSeq = 0;
  __realtimeChannels.push(__db.channel('v3-readiness')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'job_readiness' }, async () => {
      const mySeq = ++__readinessSeq;
      try {
        const { data, error } = await __db.from('job_readiness')
          .select('contact_id, opened_at, permit_verified_at, permit_verified_note, parts_shipped_at, suggested_install_at, suggested_sub, suggestion_reason, suggestion_notified_at, date_confirmed_at')
          .limit(500);
        if (mySeq !== __readinessSeq) return;   // a newer refetch superseded this one
        if (error) { console.warn('[CRM] realtime job_readiness refetch failed:', error.message); return; }
        window.CRM.readiness = (data || []);
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'job_readiness' } }));
      } catch (e) { console.warn('[CRM] realtime job_readiness handler error:', e.message); }
    })
    .subscribe());

  // job_photos realtime, needed so a sub uploading a photo on /sub/
  // shows up in Key's CRM PhotosSection without a manual refresh, AND
  // so Key uploading on his laptop syncs to his phone within seconds.
  __realtimeChannels.push(__db.channel('v3-job-photos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'job_photos' }, async () => {
      try {
        const { data, error } = await __db.from('job_photos')
          .select('id, contact_id, url, storage_path, caption, uploaded_by, uploaded_at, annotated, photo_kind')
          .order('uploaded_at', { ascending: false }).limit(1000);
        if (error) { console.warn('[CRM] realtime job_photos refetch failed:', error.message); return; }
        window.CRM.jobPhotos = data || [];
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'job_photos' } }));
      } catch (e) { console.warn('[CRM] realtime job_photos handler error:', e.message); }
    })
    .subscribe());

  // New customer images arrive through the webhook after Twilio has already
  // acknowledged the text. Refresh this gallery independently so an open
  // contact gains every copied image without an app restart.
  __realtimeChannels.push(__db.channel('v3-contact-photos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_photos' }, async () => {
      try {
        const { data, error } = await __db.from('contact_photos')
          .select('id, contact_id, url, caption').limit(1000);
        if (error) { console.warn('[CRM] realtime contact_photos refetch failed:', error.message); return; }
        window.CRM.contactPhotos = data || [];
        window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'contact_photos' } }));
      } catch (e) { console.warn('[CRM] realtime contact_photos handler error:', e.message); }
    })
    .subscribe());
  };

  // Yield a render opportunity before asking the database for secondary
  // domains. This is a real start-order boundary, not just a later await: none
  // of these task functions is invoked until after the Contacts ready event.
  await new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });

  // Every secondary read shares one three-request scheduler. Domains retain
  // separate readiness/error truth, but the database no longer receives the
  // old burst of sixteen simultaneous table reads after sign-in.
  const secondaryProgressive = startProgressiveDomains({
    domains: {
      proposals: {
        taskConcurrency: 1,
        tasks: {
          proposals: () => __db.from('proposals')
            .select('id, token, document_number, contact_id, pricing_tier, total, signed_total, amp_type, selected_amp, status, copied_at, created_at, viewed_at, signed_at, sent_at, approved_at, creator_version, length_ft, include_cord, include_inlet, include_permit, pom_offered, pom_accepted, require_deposit, deposit_rate, extra_line_items, discount_type, discount_value, notes, superseded_at, superseded_by, signature_revision, lifecycle_revision, approval_source, accepted_at, approval_channel')
            .order('created_at', { ascending: false })
            .limit(500),
        },
      },
      messages: {
        taskConcurrency: 1,
        tasks: {
          messages: () => __db.from('messages')
            .select(MSG_COLS)
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(2000),
        },
      },
      money: {
        // Invoices and payments are one atomic domain. mapInvoice reads the
        // paid-row projection, so neither array may become visible first.
        taskConcurrency: 2,
        tasks: {
          invoices: () => __db.from('invoices')
            .select('id, token, document_number, contact_id, proposal_id, total, status, created_at, due_at, payment_terms, paid_at, payment_method, line_items, creator_version')
            .order('created_at', { ascending: false })
            .limit(500),
          payments: () => __db.from('payments')
            .select('id, invoice_id, proposal_id, amount, refunded_amount, status, receipt_token, receipt_document_number, received_at, method, record_source')
            .in('status', ['completed', 'processing', 'failed'])
            .limit(5000),
        },
      },
      workspace: {
        taskConcurrency: 2,
        tasks: {
          events: () => __db.from('calendar_events')
            .select('id, contact_id, start_at, end_at, title, event_type, status, notes, assigned_installer, installer_notified_at, installer_confirmed_at, created_at')
            .gte('start_at', since)
            .order('start_at', { ascending: true })
            .limit(500),
          stageHistory: () => __db.from('stage_history')
            .select('id, contact_id, from_stage, to_stage, changed_at')
            .order('changed_at', { ascending: true })
            .limit(2000),
          permits: () => __db.from('permits')
            .select('id, contact_id, jurisdiction_id, jurisdiction_name, permit_number, status, submitted_at, approved_at, cost_cents, blocker_note, created_at, updated_at')
            .order('created_at', { ascending: true })
            .limit(500),
          materials: () => __db.from('materials')
            .select('id, contact_id, kind, status, ordered_at, received_at, installed_at, notes, created_at, updated_at')
            .order('created_at', { ascending: true })
            .limit(500),
          jobPhotos: () => __db.from('job_photos')
            .select('id, contact_id, url, storage_path, caption, uploaded_by, uploaded_at, annotated, photo_kind')
            .order('uploaded_at', { ascending: false })
            .limit(1000),
          contactPhotos: () => __db.from('contact_photos')
            .select('id, contact_id, url, caption')
            .limit(1000),
          readiness: () => __db.from('job_readiness')
            .select('contact_id, opened_at, permit_verified_at, permit_verified_note, parts_shipped_at, suggested_install_at, suggested_sub, suggestion_reason, suggestion_notified_at, date_confirmed_at')
            .limit(500),
        },
      },
      operatorMetadata: {
        taskConcurrency: 1,
        tasks: {
          installers: () => __db.from('installer_tokens')
            .select('installer_name').is('revoked_at', null),
          lines: () => __db.from('twilio_lines')
            .select('id, phone, label, color, is_default, active, sort_order')
            .order('sort_order', { ascending: true }),
        },
      },
    },
    criticalNames: ['proposals', 'money', 'messages', 'workspace', 'operatorMetadata'],
    statuses: window.CRM.domainStatus,
    timeoutMs: 4000,
    maxAttempts: 2,
    retryDelayMs: 150,
    taskConcurrency: 3,
  });

  const proposalsApplied = secondaryProgressive.domains.proposals.then(domain => {
    if (domain.ok && __proposalsRealtimeGeneration === 0) {
      window.CRM.proposals = (domain.results.proposals.data || []).map(mapProposal);
    }
    if (!domain.ok && __proposalsRealtimeGeneration > 0) {
      window.CRM.domainStatus.proposals = {
        state: 'ready', error: null, attempts: domain.results.proposals.attempts || 1,
        startedAt: null, settledAt: Date.now(),
      };
      domain = { ...domain, ok: true, error: null, recoveredByRealtime: true };
    }
    window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'proposals' } }));
    return domain;
  });

  const moneyApplied = secondaryProgressive.domains.money.then(domain => {
    if (domain.ok && __moneyRealtimeGeneration === 0) {
      applyPaidRows(domain.results.payments.data || []);
      window.CRM.invoices = (domain.results.invoices.data || []).map(mapInvoice);
    }
    if (!domain.ok && __moneyRealtimeGeneration > 0) {
      window.CRM.domainStatus.money = {
        state: 'ready', error: null,
        attempts: Math.max(domain.results.invoices?.attempts || 0, domain.results.payments?.attempts || 0),
        startedAt: null, settledAt: Date.now(),
      };
      domain = { ...domain, ok: true, error: null, recoveredByRealtime: true };
    }
    window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'money' } }));
    return domain;
  });

  const messagesApplied = secondaryProgressive.domains.messages.then(domain => {
    if (domain.ok && __messagesRealtimeGeneration === 0) {
      window.CRM.messages = applyLocalReads((domain.results.messages.data || []).map(mapMessage));
    }
    if (!domain.ok && __messagesRealtimeGeneration > 0) {
      window.CRM.domainStatus.messages = {
        state: 'ready', error: null, attempts: domain.results.messages.attempts || 1,
        startedAt: null, settledAt: Date.now(),
      };
      domain = { ...domain, ok: true, error: null, recoveredByRealtime: true };
    }
    window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'messages' } }));
    return domain;
  });

  const workspaceApplied = secondaryProgressive.domains.workspace.then(domain => {
    if (domain.ok) {
      window.CRM.events = (domain.results.events.data || []).map(mapEvent);
      window.CRM.stageHistory = domain.results.stageHistory.data || [];
      window.CRM.permits = (domain.results.permits.data || []).map(mapPermit);
      window.CRM.materials = (domain.results.materials.data || []).map(mapMaterial);
      window.CRM.jobPhotos = domain.results.jobPhotos.data || [];
      window.CRM.contactPhotos = domain.results.contactPhotos.data || [];
      window.CRM.readiness = domain.results.readiness.data || [];
    }
    window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'workspace' } }));
    installWorkspaceRealtime();
    return domain;
  });

  const metadataApplied = secondaryProgressive.domains.operatorMetadata.then(domain => {
    const installers = domain.results.installers;
    const lines = domain.results.lines;
    if (installers && !installers.error) {
      window.CRM.installers = [...new Set((installers.data || []).map(r => r.installer_name).filter(Boolean))].sort();
    }
    if (lines && !lines.error) window.CRM.lines = lines.data || [];
    window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'operatorMetadata' } }));
    return domain;
  });

  const background = await Promise.all([
    proposalsApplied, moneyApplied, messagesApplied, workspaceApplied, metadataApplied,
  ]);
  const backgroundErrors = background.filter(domain => !domain.ok).map(domain => `${domain.name}: ${domain.error}`);
  if (backgroundErrors.length) console.warn('[CRM] background partial load:', backgroundErrors);
  window.__bppBootMark?.('background data domains settled');

}

// Lightweight critical refetch (no resubscribing) for online/focus
// reconciliation. Workspace tables have their own realtime channels and are
// intentionally excluded here, so every tab focus does not reread photos,
// events, and project rows that the visible Contacts home does not need.
async function refetchAll() {
  if (!__db || !window.CRM.authed) return;
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const reconciliation = startProgressiveDomains({
      domains: {
        contacts: { tasks: {
          // THIRD fetch path: use CONTACT_COLS or refresh can erase fields.
          contacts: () => __db.from('contacts').select(CONTACT_COLS).order('created_at', { ascending: false }).limit(500),
          dnc: () => __fetchDncPhoneSet(__db),
        } },
        proposals: { tasks: {
          proposals: () => __db.from('proposals').select('id, token, document_number, contact_id, pricing_tier, total, signed_total, amp_type, selected_amp, status, copied_at, created_at, viewed_at, signed_at, sent_at, approved_at, creator_version, length_ft, include_cord, include_inlet, include_permit, pom_offered, pom_accepted, require_deposit, deposit_rate, extra_line_items, discount_type, discount_value, notes, superseded_at, superseded_by, signature_revision, lifecycle_revision, approval_source, accepted_at, approval_channel').order('created_at', { ascending: false }).limit(500),
        } },
        money: { taskConcurrency: 2, tasks: {
          invoices: () => __db.from('invoices').select('id, token, document_number, contact_id, proposal_id, total, status, created_at, due_at, payment_terms, paid_at, payment_method, line_items, creator_version').order('created_at', { ascending: false }).limit(500),
          payments: () => __db.from('payments').select('id, invoice_id, proposal_id, amount, refunded_amount, status, receipt_token, receipt_document_number, received_at, method, record_source').in('status', ['completed', 'processing', 'failed']).limit(5000),
        } },
        messages: { tasks: {
          messages: () => __db.from('messages').select(MSG_COLS).gte('created_at', since).order('created_at', { ascending: false }).limit(2000),
        } },
      },
      criticalNames: ['contacts', 'proposals', 'money', 'messages'],
      // Reconciliation keeps the last verified UI visible while it reads. A
      // private status map prevents a routine focus refresh from flashing every
      // row back to loading.
      statuses: createDomainStatusMap(['contacts', 'proposals', 'money', 'messages']),
      timeoutMs: 4000,
      maxAttempts: 1,
      taskConcurrency: 3,
    });
    const result = await reconciliation.critical;
    const contactsDomain = result.domains.contacts;
    const proposalsDomain = result.domains.proposals;
    const moneyDomain = result.domains.money;
    const messagesDomain = result.domains.messages;
    if (!contactsDomain.ok) {
      window.CRM.contactsLoadFailed = true;
      console.warn('[CRM] contacts reconciliation failed:', contactsDomain.error);
    } else {
      const c = contactsDomain.results.contacts;
      const dnc = contactsDomain.results.dnc;
      window.CRM.contactsLoadFailed = false;
      window.CRM.dncPhones = dnc.data || [];
      window.CRM.contacts = c.data.map(mapContact).filter(x => !x.archived);
      window.CRM.contactsFromSnapshot = false;
      __saveContactSnapshot(window.CRM.contacts, window.CRM.dncPhones);
    }
    if (proposalsDomain.ok) {
      window.CRM.proposals = (proposalsDomain.results.proposals.data || []).map(mapProposal);
      window.CRM.domainStatus.proposals = {
        state: 'ready', error: null, attempts: 1, startedAt: null, settledAt: Date.now(),
      };
    }
    if (moneyDomain.ok) {
      applyPaidRows(moneyDomain.results.payments.data || []);
      window.CRM.invoices = (moneyDomain.results.invoices.data || []).map(mapInvoice);
      window.CRM.domainStatus.money = {
        state: 'ready', error: null, attempts: 1, startedAt: null, settledAt: Date.now(),
      };
    }
    if (messagesDomain.ok) {
      window.CRM.messages = applyLocalReads((messagesDomain.results.messages.data || []).map(mapMessage));
      window.CRM.domainStatus.messages = {
        state: 'ready', error: null, attempts: 1, startedAt: null, settledAt: Date.now(),
      };
    }
    window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'critical' } }));
  } catch (err) {
    window.CRM.contactsLoadFailed = true;
    console.warn('[CRM] refetch failed:', err.message);
  }
}

// Reconcile when the page comes back online or the tab regains focus.
// Supabase realtime auto-reconnects, but a direct refetch closes the gap
// for events that fired while the socket was disconnected.
let _reconcileInflight = false;
let _lastReconcile = 0; // 0 = never reconciled; first focus/online triggers
const _reconcile = async () => {
  // TEST MODE: the fixtures are static and the stub __db returns [], so a
  // reconcile would wipe the synthetic data. No-op here so ?test=1 stays
  // populated (the preview harness fires visibilitychange on every eval, which
  // was silently clearing contacts mid-test). Inert on production (TEST_MODE
  // is false there, so the real reconcile runs normally).
  if (TEST_MODE) return;
  if (_reconcileInflight) return;
  _reconcileInflight = true;
  try {
    await refetchAll();
    _lastReconcile = Date.now(); // only count successful reconciles
  } finally {
    _reconcileInflight = false;
  }
};
// Expose for pull-to-refresh and any other manual sync gesture.
window.CRM.__refetch = _reconcile;
window.addEventListener('online', _reconcile);
// 'focus' fires too aggressively (every alt-tab); use 'visibilitychange' +
// only refetch if it's been more than 30s since the last successful load.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - _lastReconcile > 30000) {
    _reconcile();
  }
});

// Kick off load (non-blocking).
loadLiveData().catch(err => {
  console.error('[CRM] load failed:', err);
  window.CRM.contactsLoadFailed = true;
  window.CRM.dncPhones = [];
  window.CRM.loaded = true; // unblock render anyway
  window.dispatchEvent(new CustomEvent('crm-data-ready', { detail: { authed: false, error: err.message } }));
});

// ── Operator presence heartbeat (Key directive 2026-06-22) ──────────────────
// While the CRM is FOREGROUND/visible, stamp operator_presence.last_seen_at so
// the comms webhooks (twilio-voice missed call, twilio-webhook inbound text)
// know Key is here and SKIP the "you're away" SMS to his cell. Stops when the
// tab is backgrounded or the phone locks (visibilitychange -> hidden), so it
// goes stale within ~90s and the alerts start firing. Best-effort: every write
// error is swallowed (a heartbeat miss just means Key might get a redundant
// alert, never a missed one). In TEST_MODE __db is a stub, so beat() no-ops.
(function operatorPresenceHeartbeat() {
  if (typeof document === 'undefined') return;
  var HEARTBEAT_MS = 45000;
  var timer = null;
  function beat() {
    try {
      if (!__db || typeof __db.from !== 'function') return;
      var q = __db.from('operator_presence');
      if (!q || typeof q.upsert !== 'function') return;
      var r = q.upsert({ id: 'key', last_seen_at: new Date().toISOString() }, { onConflict: 'id' });
      if (r && typeof r.then === 'function') r.then(function () {}, function () {});
    } catch (e) { /* best-effort, never throw into the app */ }
  }
  function start() {
    if (timer) return;
    beat();
    timer = setInterval(function () {
      if (document.visibilityState === 'visible') beat();
    }, HEARTBEAT_MS);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') start(); else stop();
  });
  if (document.visibilityState === 'visible') start();
})();
