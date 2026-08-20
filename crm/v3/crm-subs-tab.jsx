// crm-subs-tab.jsx , the 6th CRM tab: Subs command center (operator only).
//
// Replaces the old window.SubsButton popover (crm-subs.jsx) as a full tab.
// Source of the visual/markup: docs/redesign-comps/sub-crm-tab-v2.html
// (Claude Design comp, gate-passed 2026-07-03). This file translates that
// comp's Roster + Jobs segmented views, sub PROFILE sheet, and JOB DETAIL
// write surface into Babel-in-browser JSX wired to the PARKED sub backend.
//
// CONTROL PRINCIPLE: the CRM writes sub_job_offers (via sub-offer-edit); the
// four sub-facing pages are LIVE READS of that row. Sub pages never edit
// Key-owned fields. This is Key's operator screen, so the internal
// perf_*/sub_feedback ARE shown here (never on any sub-facing surface).
//
// Endpoints (all pinned verify_jwt=false, reached with the publishable key
// via CRM.__invokeFn; the in-code requireServiceRole is the real wall):
//   sub-admin-list     view=roster | jobs | profile   (GAP-3a reads)
//   sub-offer-edit     control-principle per-field edits (GAP-2)
//   sub-doc-access     mode=signed_url | verify        (GAP-3b + GAP-4)
//   sub-approve-payout the ONE gold, at pass_submitted
//   sub-feedback       add | list                      (ranking)
//   sub-rank           recompute -> perf_* + AI summary
//   sub-suggest        best-sub ranking (contact_id)
//   sub-offer-create   creates the offer -> copy job link
//   sub-offer-withdraw withdraws offered|accepted
//
// window globals it exposes: SubsTab (the tab body) + SubCard (the compact
// contact-panel card). Both render from CRM.__invokeFn results only.

(function () {
  const NAVY = '#1B2B4B';
  const DEEP = '#0b1f3b';
  const GOLD = '#ffba00';
  const MUTED = '#566072';
  const FAINT = '#7c8698';
  const LINE = '#e2e6ee';
  const LINE_SOFT = '#edf0f5';
  const CARD = '#ffffff';
  const SUNKEN = '#f5f7fa';
  const INK = '#14213d';
  const GREEN = '#067a4e', GREEN_BG = '#e9f7f0', GREEN_LINE = '#b6e2ce';
  const AMBER = '#9a6a00', AMBER_BG = '#fff5da', AMBER_LINE = '#f0dd9c';
  const RED = '#c0271f', RED_BG = '#fdeeee', RED_LINE = '#f2c4c1';
  const MONO = "'JetBrains Mono','DM Mono',ui-monospace,monospace";
  const SHADOW = '0 1px 2px rgba(27,43,75,.05), 0 6px 20px rgba(27,43,75,.08)';

  const R = React;

  // ── small helpers ────────────────────────────────────────────────
  const money = (n) => {
    if (n == null || n === '' || isNaN(Number(n))) return '$0';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };
  const parseMoney = (s) => {
    const n = Number(String(s == null ? '' : s).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  };

  const fmtDate = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
  };
  const initials = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  };
  const toast = (m) => window.showToast?.(m);

  // Unwrap an edge-fn error into readable text (mirrors crm-subs.jsx pattern).
  async function fnErr(error) {
    let detail = error?.message || 'unknown';
    try { const body = await error.context?.json?.(); if (body?.error) detail = body.error; } catch {}
    return detail;
  }
  async function callFn(name, body) {
    if (!window.CRM?.__invokeFn) return { error: { message: 'not connected' } };
    const res = await window.CRM.__invokeFn(name, { body: body || {} });
    return res;
  }

  // Offer lifecycle -> stepper geometry.
  // Offer, Accept, Photos, Inspect, Paid. Declined/withdrawn/expired
  // are terminal at the Accept slot.
  const STEP_LABELS = ['Offer', 'Accept', 'Photos', 'Inspect', 'Paid'];
  function stepStateFor(status) {
    // returns an array of 5: 'done' | 'now' | 'term' | ''
    const s = String(status || '');
    const set = (doneUpTo, nowIdx, termIdx) => {
      const out = ['', '', '', '', ''];
      for (let i = 0; i < 5; i++) {
        if (termIdx != null && i === termIdx) out[i] = 'term';
        else if (i < doneUpTo) out[i] = 'done';
        else if (i === nowIdx) out[i] = 'now';
      }
      return out;
    };
    switch (s) {
      case 'offered':          return set(0, 0, null);
      case 'accepted':         return set(2, 2, null);
      case 'permit_submitted': return set(2, 2, null);
      case 'install_submitted':return set(3, 3, null);
      case 'pass_submitted':   return set(4, 4, null);
      case 'approved_paid':    return set(5, -1, null); // all done
      case 'declined':         return set(1, -1, 1);
      case 'withdrawn':        return set(1, -1, 1);
      case 'expired':          return set(1, -1, 1);
      default:                 return set(0, 0, null);
    }
  }
  const STEP_TERM_LABEL = { declined: 'Declined', withdrawn: 'Withdrawn', expired: 'Expired' };

  // ── shared SVGs (kept tiny, from the comp) ───────────────────────
  const svg = (d, extra) => (
    <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: 'none', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', ...(extra || {}) }}>{d}</svg>
  );
  const CheckPath = <path d="M5 12.5l4 4 10-10" />;
  const TriPath = <React.Fragment><path d="M12 4l9 15H3z" /><path d="M12 10v4M12 16h.01" /></React.Fragment>;
  const XCirclePath = <React.Fragment><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></React.Fragment>;

  // Compliance chip (roster + suggest). value: 'ready' | 'gaps' | 'expired'
  function ComplianceChip({ value }) {
    const map = {
      ready:   { c: GREEN, bg: GREEN_BG, ln: GREEN_LINE, label: 'Ready', d: CheckPath },
      gaps:    { c: AMBER, bg: AMBER_BG, ln: AMBER_LINE, label: 'Gaps',  d: TriPath },
      expired: { c: RED,   bg: RED_BG,   ln: RED_LINE,   label: 'Expired', d: XCirclePath },
    };
    const m = map[value] || map.gaps;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '4px 8px', color: m.c, background: m.bg, border: `1px solid ${m.ln}`, whiteSpace: 'nowrap' }}>
        {svg(m.d, { stroke: m.c })} {m.label}
      </span>
    );
  }

  // Sub status pill (real enum, sub-upsert's STATUSES = pending/active/inactive;
  // 'paused' never exists in the schema, a prior version of this file checked
  // for it and so every pending or fired sub silently rendered green "Active").
  function SubStatusChip({ status }) {
    const map = {
      active:   { c: GREEN, bg: GREEN_BG, ln: GREEN_LINE, label: 'Active' },
      pending:  { c: AMBER, bg: AMBER_BG, ln: AMBER_LINE, label: 'Pending' },
      inactive: { c: RED,   bg: RED_BG,   ln: RED_LINE,   label: 'Inactive' },
    };
    const m = map[status] || map.pending;
    return (
      <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 700, letterSpacing: '0.02em', borderRadius: 100, padding: '4px 10px', whiteSpace: 'nowrap', color: m.c, background: m.bg, border: `1px solid ${m.ln}` }}>{m.label}</span>
    );
  }

  // Internal rank chip (operator only, amber never alarm-red for a low score).
  function RankChip({ tier, score }) {
    if (tier == null && score == null) return null;
    const t = String(tier || '').toLowerCase();
    const styleMap = {
      a: { c: GREEN, bg: GREEN_BG, ln: GREEN_LINE },
      b: { c: NAVY, bg: '#e8eefb', ln: '#cfddf6' },
      c: { c: AMBER, bg: AMBER_BG, ln: AMBER_LINE },
    };
    const m = styleMap[t] || styleMap.b;
    return (
      <span title="Internal rank, operator only" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '4px 8px', color: m.c, background: m.bg, border: `1px solid ${m.ln}` }}>
        {tier ? <span style={{ fontFamily: MONO, fontWeight: 700 }}>{String(tier).toUpperCase()}</span> : null}
        {score != null ? ` ${score}` : ''}
      </span>
    );
  }

  // Compact offer stepper (reused by job row + sub card + job detail).
  function OfferStepper({ status, small }) {
    const states = stepStateFor(status);
    const termLabel = STEP_TERM_LABEL[status];
    const dot = 14;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: small ? 12 : 12, paddingTop: 11, borderTop: `1px solid ${LINE_SOFT}` }}>
        {STEP_LABELS.map((lb, i) => {
          const st = states[i];
          const isDone = st === 'done', isNow = st === 'now', isTerm = st === 'term';
          const bg = isDone ? GREEN : isNow ? NAVY : isTerm ? RED : '#dfe4ec';
          const connectorDone = (isDone || isNow);
          const label = isTerm && termLabel ? termLabel : lb;
          const labColor = (isDone || isNow) ? NAVY : isTerm ? RED : FAINT;
          return (
            <div key={i} style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, position: 'relative' }}>
              {i > 0 && (
                <span style={{ content: '""', position: 'absolute', top: 7, left: '-50%', width: '100%', height: 2, background: connectorDone ? GREEN : '#dfe4ec', zIndex: 1 }} />
              )}
              <span style={{ width: dot, height: dot, borderRadius: '50%', background: bg, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: isNow ? '0 0 0 3px rgba(27,43,75,.16)' : 'none' }}>
                {(isDone) && <svg viewBox="0 0 24 24" style={{ width: 8, height: 8, fill: 'none', stroke: '#fff', strokeWidth: 3.4, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M5 12l5 5L20 7" /></svg>}
                {(isTerm) && <svg viewBox="0 0 24 24" style={{ width: 8, height: 8, fill: 'none', stroke: '#fff', strokeWidth: 3.4, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M6 6l12 12M18 6L6 18" /></svg>}
              </span>
              <span style={{ fontSize: 9.5, fontWeight: 600, color: labColor, textAlign: 'center', lineHeight: 1.1 }}>{label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // ── generic sheet ────────────────────────────────────────────────
  function Sheet({ open, title, onClose, children, foot }) {
    // Portal to body (fixed-overlay-transform scar: the mobile CRM pane has a
    // transform, which re-roots position:fixed. Rendering into document.body
    // keeps the sheet viewport-anchored).
    // ALL hooks run unconditionally at the top of the component per Rules of
    // Hooks. The SSR guard (typeof document === 'undefined') moved below the
    // hook calls so React never sees a different hook count between renders
    // (the previous position sat ABOVE the hooks and, on a hypothetical SSR
    // render, would have returned null and skipped every hook). Behavior is
    // identical: SSR path still returns null; browser path still runs hooks.
    const [mounted, setMounted] = R.useState(false);
    const dragStartY = R.useRef(null);  // 2026-07-04 audit: make the grabber honest (swipe-down to dismiss)
    R.useEffect(() => {
      if (open) { const t = setTimeout(() => setMounted(true), 10); return () => clearTimeout(t); }
      setMounted(false);
    }, [open]);
    R.useEffect(() => {
      if (!open) return;
      const onKey = (e) => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);
    if (typeof document === 'undefined') return null;
    if (!open) return null;
    const node = (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9000 }}>
        <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(11,31,59,.44)', opacity: mounted ? 1 : 0, transition: 'opacity .2s' }} />
        <div role="dialog" aria-modal="true" aria-label={title} style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9001, maxWidth: 640, margin: '0 auto',
          // Bug (2026-07-04 sim audit): plain 94vh let tall content (e.g. a fully
          // loaded sub profile) push the header into the status bar/Dynamic Island,
          // making the close button an unreachable dead tap. Subtract the safe area
          // like the sibling sheets already do (crm-right.jsx, crm-subs.jsx).
          maxHeight: 'calc(var(--vvh, 94vh) - 24px - env(safe-area-inset-top, 0px))', background: '#eef1f6', borderRadius: '20px 20px 0 0', boxShadow: '0 -8px 40px rgba(11,31,59,.28)',
          transform: mounted ? 'none' : 'translateY(100%)', transition: 'transform .28s cubic-bezier(.16,1,.3,1)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div
            onTouchStart={(e) => { dragStartY.current = e.touches[0].clientY; }}
            onTouchEnd={(e) => { if (dragStartY.current != null) { const dy = e.changedTouches[0].clientY - dragStartY.current; dragStartY.current = null; if (dy > 70) onClose(); } }}
            style={{ flex: '0 0 auto', padding: '12px 0 8px', display: 'flex', justifyContent: 'center', cursor: 'grab', touchAction: 'none' }}>
            <span style={{ width: 40, height: 5, borderRadius: 3, background: '#c6cedb' }} />
          </div>
          <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 18px 12px', borderBottom: `1px solid ${LINE}` }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: NAVY, letterSpacing: '-0.01em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, borderRadius: 12, border: `1px solid ${LINE}`, background: '#fff', color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg viewBox="0 0 24 24" style={{ width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div style={{ flex: '1 1 auto', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 18px calc(30px + env(safe-area-inset-bottom))' }}>
            {children}
          </div>
          {foot}
        </div>
      </div>
    );
    return ReactDOM.createPortal(node, document.body);
  }

  const SubLabel = ({ children, right }) => (
    <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: FAINT, margin: '20px 2px 9px', display: 'flex', alignItems: 'center' }}>
      {children}{right}
    </p>
  );
  const Card2 = ({ children, pad, style }) => (
    <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden', boxShadow: SHADOW, ...(pad ? { padding: '14px 15px' } : {}), ...(style || {}) }}>{children}</div>
  );
  const KV = ({ k, v, mono, first }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, padding: '12px 15px', borderTop: first ? 'none' : `1px solid ${LINE_SOFT}` }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: FAINT, flex: '0 0 auto' }}>{k}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: NAVY, textAlign: 'right', lineHeight: 1.4, fontFamily: mono ? MONO : 'inherit' }}>{v}</span>
    </div>
  );

  // A save-confirming inline text/textarea editor (control-principle field).
  // Confirms "Saved" on success; for a post-accept payout change opens a
  // reason confirm (the DB payout-revision trigger requires payout_revised_reason).
  // `jsonField` + `jsonKey` route this editor into a nested jsonb column: instead
  // of posting {field: value}, it reads the current object (jsonSource), merges
  // {[jsonKey]: value}, and posts {jsonField: mergedObject}. Used by Scope notes,
  // which lives at scope_json.description (sub-offer-edit whitelists scope_json,
  // NOT scope_notes, so a flat {scope_notes} post 400s and loses the note).
  function EditField({ label, aiTag, value, kind, offerId, field, jsonField, jsonKey, jsonSource, textarea, money: isMoney, locked, lockNote, onSaved }) {
    const [val, setVal] = R.useState(value == null ? '' : String(value));
    const [saved, setSaved] = R.useState(false);
    const [savedLabel, setSavedLabel] = R.useState('Saved');
    const [busy, setBusy] = R.useState(false);
    R.useEffect(() => { setVal(value == null ? '' : String(value)); }, [value, offerId]);

    const doSave = async () => {
      if (busy) return;
      setBusy(true);
      const patch = {};
      if (jsonField) {
        const base = (jsonSource && typeof jsonSource === 'object') ? jsonSource : {};
        patch[jsonField] = { ...base, [jsonKey]: val };
      } else if (isMoney) {
        const amt = parseMoney(val);
        if (amt == null) { toast('Enter a dollar amount'); setBusy(false); return; }
        patch[field] = amt;
        if (locked) {
          const reason = window.prompt(`The sub already accepted ${money(value)}. Type a short reason for changing the payout. The sub will see this.`);
          if (!reason || !reason.trim()) { toast('Payout unchanged'); setBusy(false); return; }
          patch.payout_revised_reason = reason.trim();
        }
      } else {
        patch[field] = val;
      }
      const { data, error } = await callFn('sub-offer-edit', { offer_id: offerId, ...patch });
      if (error) { toast('Save failed: ' + (await fnErr(error))); setBusy(false); return; }
      if (data && data.error) { toast('Save failed: ' + data.error); setBusy(false); return; }
      const cal = data && data.calendar && data.calendar.action;
      const onCal = field === 'firm_install_date' && ['created', 'updated', 'adopted'].includes(cal);
      const msg = locked && isMoney ? 'Payout updated' : (onCal ? 'On calendar' : (field === 'firm_install_date' && cal === 'left_alone' ? 'Date cleared' : 'Saved'));
      setSavedLabel(msg);
      setSaved(true);
      toast(msg);
      if (onCal) window.dispatchEvent(new CustomEvent('crm-data-changed', { detail: { table: 'calendar_events' } }));
      setBusy(false);
      onSaved?.(data);
      setTimeout(() => setSaved(false), 1600);
    };

    const inputStyle = {
      flex: '1 1 auto', minWidth: 0, width: textarea ? '100%' : undefined,
      fontFamily: isMoney ? MONO : 'inherit', fontSize: 16, fontWeight: isMoney ? 700 : 500, color: NAVY,
      background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 9, padding: '11px 12px', outline: 'none',
      boxSizing: 'border-box', minHeight: textarea ? 74 : undefined, resize: textarea ? 'vertical' : undefined, lineHeight: textarea ? 1.5 : undefined,
    };
    const saveBtn = (
      <button onClick={doSave} disabled={busy} style={{
        flex: '0 0 auto', minHeight: 46, padding: '0 16px', width: textarea ? '100%' : undefined,
        background: saved ? GREEN_BG : NAVY, color: saved ? GREEN : '#fff', border: saved ? `1px solid ${GREEN_LINE}` : 0,
        borderRadius: 9, fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      }}>
        {saved && <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M5 12.5l4 4 10-10" /></svg>}
        {saved ? savedLabel : (busy ? '...' : 'Save')}
      </button>
    );
    return (
      <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 12, boxShadow: SHADOW, padding: '13px 15px', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: FAINT }}>{label}</span>
          {aiTag && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.02em', color: '#7a5a00', background: AMBER_BG, border: `1px solid ${AMBER_LINE}`, borderRadius: 100, padding: '2px 8px' }}>
              <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, fill: GOLD, stroke: 'none' }}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg> AI draft
            </span>
          )}
        </div>
        {textarea ? (
          <React.Fragment>
            <textarea value={val} onChange={(e) => setVal(e.target.value)} style={inputStyle} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>{saveBtn}</div>
          </React.Fragment>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input type={field === 'firm_install_date' ? 'date' : 'text'} value={val} onChange={(e) => setVal(e.target.value)} style={inputStyle} />
            {saveBtn}
          </div>
        )}
        {locked && lockNote && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: AMBER, marginTop: 9, lineHeight: 1.45 }}>
            <svg viewBox="0 0 24 24" style={{ flex: '0 0 auto', width: 14, height: 14, marginTop: 1, fill: 'none', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round', strokeLinejoin: 'round' }}><rect x="4.5" y="11" width="15" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            <span>{lockNote}</span>
          </div>
        )}
      </div>
    );
  }

  // Materials ship status (to_ship → shipped → received, or na). Server already
  // whitelists these on sub-offer-edit; CRM was display-only before. Reuses the
  // same segmented-choice + Card2 language as PermitControl (no net-new design).
  function MaterialsShipControl({ job, offerId, onSaved }) {
    const status = job.materials_ship_status || (Array.isArray(job.materials) && job.materials.some((m) => (m.supplied_by || m.suppliedBy) === 'bpp') ? 'to_ship' : 'na');
    const [busy, setBusy] = R.useState(null);
    const [savedMode, setSavedMode] = R.useState(null);
    const OPTIONS = [
      { key: 'to_ship', label: 'To ship', sub: 'Parts still at the shop' },
      { key: 'shipped', label: 'Shipped', sub: 'On the way to the sub' },
      { key: 'received', label: 'Received', sub: 'Sub confirmed parts arrived' },
      { key: 'na', label: 'N/A', sub: 'Nothing for BPP to ship' },
    ];
    const choose = async (next) => {
      if (busy || next === status) return;
      setBusy(next);
      const { data, error } = await callFn('sub-offer-edit', { offer_id: offerId, materials_ship_status: next });
      if (error) { toast('Save failed: ' + (await fnErr(error))); setBusy(null); return; }
      if (data && data.error) { toast('Save failed: ' + data.error); setBusy(null); return; }
      setBusy(null);
      setSavedMode(next);
      toast('Saved');
      onSaved?.(data);
      setTimeout(() => setSavedMode(null), 1600);
    };
    return (
      <React.Fragment>
        <Card2 style={{ padding: '13px 15px', marginBottom: 10, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: FAINT }}>Materials ship status</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {OPTIONS.map((o) => {
              const on = status === o.key;
              const saving = busy === o.key;
              const justSaved = savedMode === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => choose(o.key)}
                  disabled={busy != null}
                  aria-pressed={on}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
                    minHeight: 54, padding: '10px 13px', borderRadius: 10, cursor: busy != null ? 'default' : 'pointer',
                    border: `1.5px solid ${on ? NAVY : LINE}`, background: on ? '#eef2fb' : '#fff',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ flex: '0 0 auto', width: 20, height: 20, borderRadius: '50%', border: `2px solid ${on ? NAVY : '#c3cbd6'}`, background: on ? NAVY : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
                  </span>
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: NAVY, lineHeight: 1.25 }}>{o.label}</span>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: FAINT, marginTop: 1 }}>{o.sub}</span>
                  </span>
                  {saving && <span style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 700, color: MUTED }}>...</span>}
                  {justSaved && !saving && (
                    <svg viewBox="0 0 24 24" style={{ flex: '0 0 auto', width: 17, height: 17, fill: 'none', stroke: GREEN, strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M5 12.5l4 4 10-10" /></svg>
                  )}
                </button>
              );
            })}
          </div>
        </Card2>
        {(status === 'shipped' || status === 'received' || job.materials_tracking) && (
          <EditField label="Tracking / ship note" offerId={offerId} field="materials_tracking" value={job.materials_tracking || ''} onSaved={onSaved} />
        )}
      </React.Fragment>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  //  PROFILE SHEET (roster row -> full sub profile, incl. internal perf)
  // ══════════════════════════════════════════════════════════════════
  // variant='modal' renders the bottom sheet (legacy); variant='pane' renders
  // the SAME body as a full detail pane (IosNavBar + scroll), so a selected sub
  // opens on the right like a contact does (Key 2026-07-10).
  function ProfileSheet({ subId, open, onClose, onChanged, variant = 'modal', onBack, name }) {
    const [data, setData] = R.useState(null);
    const [loading, setLoading] = R.useState(false);
    const [fbChoice, setFbChoice] = R.useState(null);
    const [fbNote, setFbNote] = R.useState('');
    const [fbJob, setFbJob] = R.useState('');
    const [recomputing, setRecomputing] = R.useState(false);
    const [payoutBusy, setPayoutBusy] = R.useState(null);
    // Edit details (Key 2026-07-10): the operator can correct a sub's info any
    // time from the CRM. sub-upsert's edit path (id + whitelisted fields) already
    // exists; this opens the reused sub form pre-filled from the loaded profile.
    const [editOpen, setEditOpen] = R.useState(false);
    // Logo / profile picture (Key 2026-07-10): operator uploads an image; it
    // lands in the public sub-logos bucket and becomes the sub's avatar.
    const [logoPreview, setLogoPreview] = R.useState(null);
    const [logoBusy, setLogoBusy] = R.useState(false);
    const logoFileRef = R.useRef(null);
    const logoInitials = (nm) => (String(nm || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase();
    const fileToBase64 = (file) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = reject; r.readAsDataURL(file);
    });
    const onPickLogo = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';   // let the same file be re-picked
      if (!file) return;
      if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { toast('PNG, JPG, or WebP only'); return; }
      if (file.size > 2 * 1024 * 1024) { toast('Logo must be under 2 MB'); return; }
      setLogoPreview(URL.createObjectURL(file));   // instant local preview
      setLogoBusy(true);
      try {
        const b64 = await fileToBase64(file);
        const { data: res, error } = await callFn('sub-logo-upload', { sub_id: subId, contentType: file.type, dataBase64: b64 });
        if (error) { toast('Logo upload failed: ' + (await fnErr(error))); setLogoPreview(null); return; }
        if (res && res.error) { toast('Logo upload failed: ' + res.error); setLogoPreview(null); return; }
        toast('Logo updated');
        onChanged && onChanged();   // refresh the roster row
        load();                     // refetch this profile -> new logo_url
      } catch (_err) { toast('Logo upload failed'); setLogoPreview(null); }
      finally { setLogoBusy(false); }
    };

    const load = R.useCallback(async () => {
      if (!subId) return;
      setLoading(true);
      const { data: res, error } = await callFn('sub-admin-list', { view: 'profile', sub_id: subId });
      if (error) { toast('Profile did not load: ' + (await fnErr(error))); setLoading(false); return; }
      setData(res || null);
      setLoading(false);
    }, [subId]);
    R.useEffect(() => { if (subId && (variant === 'pane' || open)) load(); }, [open, subId, variant, load]);

    const sub = data?.sub || data?.profile || {};
    const contacts = data?.contacts || [];
    const docs = data?.documents || [];
    const agreement = data?.agreement || null;
    const payouts = data?.payouts || [];
    const perf = data?.performance || (sub.perf_score != null ? { score: sub.perf_score, metrics: sub.perf_metrics, summary: sub.perf_summary, computed_at: sub.perf_computed_at } : null);
    const feedback = data?.feedback || [];
    const jobsForTie = data?.jobs || [];

    // FIX (production bug, caught while porting to Ionic): sub-doc-access
    // (index.ts:86-87) reads doc_id/upload_id, never document_id, and
    // mode='verify' (index.ts:153-157) also requires a status in
    // VERIFY_STATUSES. Both calls below sent neither correctly, so Mark
    // verified and View both 400 in production today. Fixed here so the
    // bespoke and the Ionic port agree on the same, correct, param shape.
    const markVerified = async (docId) => {
      const { data: res, error } = await callFn('sub-doc-access', { mode: 'verify', doc_id: docId, status: 'verified' });
      if (error) { toast('Verify failed: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast('Verify failed: ' + res.error); return; }
      toast('Marked verified'); load(); onChanged?.();
    };
    const viewDoc = async (docId) => {
      const { data: res, error } = await callFn('sub-doc-access', { mode: 'signed_url', doc_id: docId });
      if (error) { toast('Could not open: ' + (await fnErr(error))); return; }
      const url = res?.url || res?.signed_url;
      if (!url) { toast('No file to open'); return; }
      window.open(url, '_blank', 'noopener');
    };
    const recompute = async () => {
      if (recomputing) return;
      setRecomputing(true);
      const { data: res, error } = await callFn('sub-rank', { sub_id: subId });
      setRecomputing(false);
      if (error) { toast('Recompute failed: ' + (await fnErr(error))); return; }
      toast('Recomputed just now'); load();
    };
    // FIX (production bug, caught while porting to Ionic): sub-feedback
    // reads body.action (not body.mode, `const action = typeof b?.action
    // === 'string' ? b.action : ''`), so this call 400'd "unknown action" in
    // production; and the 'add' handler reads body.job_offer_id, not
    // body.offer_id, so the job tie was silently dropped even once action
    // was right. Both fixed here.
    const saveFeedback = async () => {
      if (!fbChoice) { toast('Pick went well or needs work'); return; }
      const { data: res, error } = await callFn('sub-feedback', {
        action: 'add', sub_id: subId, sentiment: fbChoice === 'up' ? 'positive' : 'negative',
        note: fbNote.trim() || null, job_offer_id: fbJob || null,
      });
      if (error) { toast('Save failed: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast('Save failed: ' + res.error); return; }
      toast('Saved'); setFbChoice(null); setFbNote(''); setFbJob(''); load();
    };

    // Copy the sub's live onboarding link (same link + same expiry if one is still
    // inside its 7-day window; a fresh one if none is live). Issue new = kill the
    // current link and start a new 7-day window (a link sent to the wrong number).
    const copyOnboard = async () => {
      const { data: res, error } = await callFn('sub-upsert', { action: 'copy_onboard', sub_id: subId });
      if (error) { toast('Could not get link: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast(res.error); return; }
      const link = res?.onboard_link;
      if (!link) { toast('No onboarding link'); return; }
      try { await navigator.clipboard.writeText(link); toast(res.reused ? 'Onboarding link copied (same link, same expiry)' : 'New onboarding link copied, good for 7 days'); }
      catch { toast('Copy failed'); }
    };
    const reissueOnboard = async () => {
      if (!window.confirm('Issue a new onboarding link? The current link stops working right away and a fresh 7-day window starts.')) return;
      const { data: res, error } = await callFn('sub-upsert', { action: 'reissue_onboard', sub_id: subId });
      if (error) { toast('Could not issue link: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast(res.error); return; }
      const link = res?.onboard_link;
      if (!link) { toast('No onboarding link'); return; }
      try { await navigator.clipboard.writeText(link); toast('New onboarding link copied, good for 7 days'); }
      catch { toast('Copy failed'); }
    };

    // Deactivate is the security-relevant one (fired subs lose portal + job-offer
    // access the moment sub-offer-view/sub-offer-action see status !== 'active');
    // confirm on the way in, no confirm needed reactivating (the safe direction).
    const toggleActive = async () => {
      const goingInactive = sub.status !== 'inactive';
      if (goingInactive && !window.confirm('Deactivate ' + (sub.business_name || sub.name || 'this sub') + '? They lose access to job offers and their portal right away, until reactivated.')) return;
      const { data: res, error } = await callFn('sub-upsert', { id: subId, status: goingInactive ? 'inactive' : 'active' });
      if (error) { toast('Could not update status: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast(res.error); return; }
      toast(goingInactive ? 'Deactivated' : 'Reactivated'); load(); onChanged?.();
    };
    const markPayoutPaid = async (payout) => {
      if (!payout?.id || payoutBusy) return;
      if (!window.confirm(`Mark ${money((payout.amount_cents != null ? payout.amount_cents / 100 : payout.amount))} paid offline?`)) return;
      setPayoutBusy(payout.id);
      const { data: res, error } = await callFn('sub-upsert', {
        action: 'mark_payout_paid', payout_id: payout.id, method: 'offline',
      });
      setPayoutBusy(null);
      if (error) { toast('Mark paid failed: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast('Mark paid failed: ' + res.error); return; }
      toast(res?.already_paid ? 'Already marked paid' : 'Marked paid'); load(); onChanged?.();
    };

    // The endpoint emits the compliance booleans on data.sub AND at the top level;
    // prefer the top level (data), fall back to sub.
    const complianceValue = complianceValueOf({
      compliance_ready: data?.compliance_ready != null ? data.compliance_ready : sub.compliance_ready,
      compliance_expired: data?.compliance_expired != null ? data.compliance_expired : sub.compliance_expired,
      compliance: data?.compliance != null ? data.compliance : sub.compliance,
    });
    const tier = perf?.tier || sub.rank_tier;
    const scoreVal = perf?.score != null ? perf.score : sub.perf_score;
    const scoreClass = tier ? String(tier).toLowerCase() : (scoreVal >= 85 ? 'a' : scoreVal >= 70 ? 'b' : 'c');
    const scoreStyle = { a: { c: GREEN, bg: GREEN_BG, ln: GREEN_LINE }, b: { c: NAVY, bg: '#e8eefb', ln: '#cfddf6' }, c: { c: AMBER, bg: AMBER_BG, ln: AMBER_LINE } }[scoreClass] || { c: NAVY, bg: '#e8eefb', ln: '#cfddf6' };

    const docStatusColor = (st) => ({ pending: FAINT, received: AMBER, verified: GREEN, expired: RED, missing: FAINT, rejected: RED }[st] || FAINT);
    const docStatusLabel = (st) => ({ pending: 'Pending', received: 'Received, not verified', verified: 'Verified', expired: 'Expired', missing: 'Not added yet', rejected: 'Rejected' }[st] || (st || 'Pending'));

    const body = (
      <React.Fragment>
        {loading && !data && <div style={{ fontSize: 13, color: MUTED, padding: '20px 2px' }}>Loading profile...</div>}
        {data && (
          <React.Fragment>
            {/* Logo / profile picture , tap to upload (public sub-logos bucket). */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '2px 0 16px' }}>
              <button type="button" onClick={() => logoFileRef.current && logoFileRef.current.click()}
                aria-label={(logoPreview || sub.logo_url) ? 'Change logo' : 'Upload logo'}
                style={{ position: 'relative', width: 92, height: 92, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer', background: '#eef1f6', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {(logoPreview || sub.logo_url)
                  ? <img src={logoPreview || sub.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 32, fontWeight: 800, color: NAVY }}>{logoInitials(sub.business_name || sub.name)}</span>}
                <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(27,43,75,0.72)', color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', padding: '3px 0' }}>{logoBusy ? '...' : ((logoPreview || sub.logo_url) ? 'CHANGE' : 'ADD LOGO')}</span>
              </button>
              <input ref={logoFileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onPickLogo} style={{ display: 'none' }} />
            </div>
            {/* Business */}
            <SubLabel>Business</SubLabel>
            <Card2>
              <KV first k="Company" v={sub.business_name || '(none)'} />
              <KV k="Mailing" v={sub.mailing_address || '(none)'} />
              <KV k="Website" v={sub.website_url || '(none)'} />
              <KV k="Facebook" v={sub.facebook_url || '(none)'} />
              <KV k="Status" v={<span style={{ color: complianceValue === 'ready' ? GREEN : complianceValue === 'expired' ? RED : AMBER }}>{sub.status === 'inactive' ? 'Inactive' : sub.status === 'pending' ? 'Pending' : 'Active'}{complianceValue === 'ready' ? ', Ready' : complianceValue === 'expired' ? ', Expired' : ', Gaps'}</span>} />
            </Card2>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={copyOnboard} style={{ minHeight: 44, flex: 1, padding: '0 14px', border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Copy onboarding link</button>
              <button onClick={reissueOnboard} style={{ minHeight: 44, padding: '0 14px', border: `1px solid ${LINE_SOFT}`, background: '#fff', color: MUTED, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Issue new</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {sub.status === 'inactive'
                ? <button onClick={toggleActive} style={{ minHeight: 44, width: '100%', padding: '0 14px', border: `1px solid ${GREEN_LINE}`, background: '#fff', color: GREEN, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Reactivate this sub</button>
                : <button onClick={toggleActive} style={{ minHeight: 44, width: '100%', padding: '0 14px', border: `1px solid ${RED_LINE}`, background: '#fff', color: RED, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Deactivate this sub</button>}
            </div>
            {/* Legacy modal variant only: the pane variant puts Edit in the nav bar
                (no duplicate affordance). */}
            {variant !== 'pane' && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => setEditOpen(true)} style={{ minHeight: 44, width: '100%', padding: '0 14px', border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Edit details</button>
              </div>
            )}

            {/* Contacts */}
            {contacts.length > 0 && (
              <React.Fragment>
                <SubLabel>Contacts</SubLabel>
                <Card2>
                  {contacts.map((c, i) => (
                    <div key={c.id || i} style={{ padding: '13px 15px', borderTop: i === 0 ? 'none' : `1px solid ${LINE_SOFT}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700, color: NAVY }}>
                        {c.name}{c.is_primary && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#8a6a00', background: AMBER_BG, border: `1px solid ${AMBER_LINE}`, borderRadius: 100, padding: '2px 7px' }}>Primary</span>}
                      </div>
                      {c.role && <div style={{ fontSize: 13, color: FAINT, fontWeight: 600, marginTop: 1 }}>{c.role}</div>}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 7 }}>
                        {c.phone && <a href={`tel:${String(c.phone).replace(/\D/g, '')}`} style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: MUTED, textDecoration: 'none' }}>{c.phone}</a>}
                        {c.email && <a href={`mailto:${c.email}`} style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: MUTED, textDecoration: 'none' }}>{c.email}</a>}
                      </div>
                    </div>
                  ))}
                </Card2>
              </React.Fragment>
            )}

            {/* License and insurance */}
            <SubLabel>License and insurance</SubLabel>
            <Card2>
              <KV first k="License" v={<span style={{ fontFamily: MONO }}>{[sub.license_state, sub.license_number].filter(Boolean).join(' ') || '(none)'}{sub.license_expiration ? ` · exp ${String(sub.license_expiration).slice(0, 7)}` : ''}</span>} />
              <KV k="Liability" v={<span style={{ fontFamily: MONO }}>{sub.gl_expiration ? `exp ${String(sub.gl_expiration).slice(0, 7)}` : '(none)'}</span>} />
              <KV k="Workers comp" v={<span style={{ fontFamily: MONO }}>{sub.wc_expiration ? `exp ${String(sub.wc_expiration).slice(0, 7)}` : (sub.wc_status || '(none)')}</span>} />
            </Card2>

            {/* Documents */}
            <SubLabel>Documents</SubLabel>
            <Card2>
              {docs.length === 0 && <div style={{ fontSize: 13, color: MUTED, padding: '13px 15px' }}>No documents on file yet.</div>}
              {docs.map((d, i) => {
                const missing = d.status === 'missing' || !d.id;
                return (
                  <div key={d.id || d.doc_type || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 15px', borderTop: i === 0 ? 'none' : `1px solid ${LINE_SOFT}`, background: missing ? 'repeating-linear-gradient(135deg,#fbfcfe 0 8px,#f6f8fb 8px 16px)' : 'transparent' }}>
                    <span style={{ flex: '0 0 auto', width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: missing ? '#fff' : '#eef1f6', border: missing ? `1.5px dashed ${LINE}` : 'none', color: missing ? FAINT : NAVY }}>
                      <svg viewBox="0 0 24 24" style={{ width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }}>{missing ? <path d="M12 5v14M5 12h14" /> : <React.Fragment><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /></React.Fragment>}</svg>
                    </span>
                    <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: NAVY, lineHeight: 1.25 }}>{d.label || d.doc_type}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: docStatusColor(d.status) }}>{docStatusLabel(d.status)}</span>
                    </span>
                    <span style={{ flex: '0 0 auto', display: 'flex', gap: 6 }}>
                      {!missing && <button onClick={() => viewDoc(d.id)} style={{ minHeight: 38, padding: '0 12px', border: `1px solid ${LINE}`, background: '#fff', color: NAVY, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>View</button>}
                      {!missing && d.status === 'received' && <button onClick={() => markVerified(d.id)} style={{ minHeight: 38, padding: '0 12px', border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Mark verified</button>}
                    </span>
                  </div>
                );
              })}
            </Card2>

            {/* Agreement */}
            <SubLabel>Agreement</SubLabel>
            <Card2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 15px' }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: '#eef1f6', color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                  <svg viewBox="0 0 24 24" style={{ width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 13h5M10 17h5" /></svg>
                </span>
                <span style={{ flex: '1 1 auto' }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: NAVY }}>Master agreement</span>
                  <span style={{ fontSize: 12, color: agreement?.signed_at ? GREEN : AMBER, fontWeight: 600, marginTop: 1 }}>
                    {agreement?.signed_at ? `Signed v${agreement.version} by ${agreement.signer_name || 'sub'} on ${fmtDate(agreement.signed_at)}` : 'Not signed yet'}
                  </span>
                </span>
              </div>
            </Card2>

            {/* Payout history */}
            {payouts.length > 0 && (
              <React.Fragment>
                <SubLabel>Payout history</SubLabel>
                <Card2>
                  {payouts.map((p, i) => {
                    const paid = !!p.paid_at;
                    return (
                      <div key={p.id || i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 15px', borderTop: i === 0 ? 'none' : `1px solid ${LINE_SOFT}` }}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: NAVY }}>{p.client_name || p.contact_name || 'Job'}<small style={{ display: 'block', fontFamily: MONO, fontSize: 11, color: FAINT, fontWeight: 500, marginTop: 1 }}>{p.job_code || ''}{p.completed_at ? ` · ${fmtDate(p.completed_at)}` : ''}</small></span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: paid ? GREEN : RED }}>{money((p.amount_cents != null ? p.amount_cents / 100 : p.amount))}</span>
                          <span style={{ fontSize: 11, color: paid ? GREEN : MUTED, fontWeight: 700 }}>{paid ? 'Paid' : 'Owed'}</span>
                          {!paid && <button type="button" onClick={() => markPayoutPaid(p)} disabled={payoutBusy === p.id} style={{ minHeight: 44, padding: '0 11px', border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{payoutBusy === p.id ? 'Saving...' : 'Mark paid'}</button>}
                        </span>
                      </div>
                    );
                  })}
                </Card2>
              </React.Fragment>
            )}

            {/* ── INTERNAL ONLY: performance + feedback. Never shown to a sub. ── */}
            <SubLabel right={<span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.03em', color: MUTED, background: '#eef1f6', border: `1px solid ${LINE}`, borderRadius: 100, padding: '3px 9px' }}><svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: 'none', stroke: MUTED, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><rect x="4.5" y="11" width="15" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg> Operator only</span>}>Performance</SubLabel>
            <Card2>
              {!perf || scoreVal == null ? (
                <div style={{ fontSize: 13, color: MUTED, padding: '15px', lineHeight: 1.5 }}>Not enough data yet. This sub needs a few completed jobs before a score is meaningful.</div>
              ) : (
                <React.Fragment>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 66, height: 66, borderRadius: 12, flex: '0 0 auto', background: scoreStyle.bg, border: `1px solid ${scoreStyle.ln}`, color: scoreStyle.c }}>
                      <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{scoreVal}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, marginTop: 2, opacity: .75 }}>of 100</span>
                    </div>
                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Tier {String(tier || scoreClass).toUpperCase()}{scoreClass === 'a' ? ', strong' : scoreClass === 'c' ? ', watch' : ''}</div>
                      {perf.trend && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, marginTop: 3, color: perf.trend_dir === 'up' ? GREEN : perf.trend_dir === 'down' ? AMBER : MUTED }}>{perf.trend}</span>
                      )}
                    </div>
                  </div>
                  {(perf.metrics || []).map((m, i) => {
                    const pct = Math.max(0, Math.min(100, Number(m.pct) || 0));
                    const barColor = pct >= 85 ? GREEN : pct >= 65 ? '#5b7fd1' : AMBER;
                    return (
                      <div key={m.key || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 15px', borderTop: `1px solid ${LINE_SOFT}` }}>
                        <span style={{ flex: '1 1 auto', fontSize: 13, fontWeight: 600, color: MUTED }}>{m.label}</span>
                        <span style={{ flex: '0 0 84px', height: 6, borderRadius: 3, background: '#e6ebf2', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', borderRadius: 3, width: pct + '%', background: barColor }} /></span>
                        <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: NAVY }}>{m.value}</span>
                      </div>
                    );
                  })}
                  {perf.summary && (
                    <div style={{ padding: '13px 15px', borderTop: `1px solid ${LINE_SOFT}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#7a5a00', marginBottom: 6 }}>
                        <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: GOLD, stroke: 'none' }}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg> Why this score
                      </div>
                      <p style={{ fontSize: 13, lineHeight: 1.55, color: INK, margin: 0 }}>{perf.summary}</p>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 15px', borderTop: `1px solid ${LINE_SOFT}` }}>
                    <button onClick={recompute} disabled={recomputing} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 40, padding: '0 12px', background: 'transparent', border: 0, color: NAVY, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2" /><path d="M18 4v5h-5M6 20v-5h5" /></svg> {recomputing ? 'Recomputing...' : 'Recompute'}
                    </button>
                  </div>
                </React.Fragment>
              )}
            </Card2>

            {/* Add feedback */}
            <SubLabel>Add feedback</SubLabel>
            <Card2 style={{ padding: '14px 15px' }}>
              <div style={{ display: 'flex', gap: 9, marginBottom: 11 }}>
                {[['up', 'Went well', GREEN, GREEN_BG, GREEN_LINE], ['down', 'Needs work', AMBER, AMBER_BG, AMBER_LINE]].map(([k, lbl, c, bg, ln]) => {
                  const on = fbChoice === k;
                  return (
                    <button key={k} type="button" onClick={() => setFbChoice(on ? null : k)} style={{ flex: '1 1 0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, border: `1.5px solid ${on ? ln : LINE}`, background: on ? bg : '#fff', borderRadius: 10, fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: on ? c : MUTED, cursor: 'pointer' }}>
                      <svg viewBox="0 0 24 24" style={{ width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>{k === 'up' ? <path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v3h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7" /> : <path d="M17 13V4h3v9zM17 13l-4 8a2 2 0 0 1-2-2v-3H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17" />}</svg> {lbl}
                    </button>
                  );
                })}
              </div>
              <input type="text" value={fbNote} onChange={(e) => setFbNote(e.target.value)} placeholder="Short note, optional" style={{ width: '100%', minHeight: 46, fontFamily: 'inherit', fontSize: 16, fontWeight: 500, color: NAVY, background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 9, padding: '11px 12px', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />
              <select value={fbJob} onChange={(e) => setFbJob(e.target.value)} aria-label="Tie to a job, optional" style={{ width: '100%', minHeight: 46, fontFamily: 'inherit', fontSize: 16, fontWeight: 500, color: NAVY, background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 9, padding: '11px 12px', outline: 'none', marginBottom: 10, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}>
                <option value="">Tie to a job, optional</option>
                {jobsForTie.map((j) => <option key={j.offer_id || j.id} value={j.offer_id || j.id}>{j.client_name || j.contact_name || 'Job'}{j.job_code ? `, ${j.job_code}` : ''}</option>)}
              </select>
              <button onClick={saveFeedback} style={{ minHeight: 46, padding: '0 18px', background: NAVY, color: '#fff', border: 0, borderRadius: 9, fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Save</button>
            </Card2>

            {/* Feedback log */}
            {feedback.length > 0 && (
              <React.Fragment>
                <SubLabel>Feedback log</SubLabel>
                <Card2>
                  {feedback.map((f, i) => {
                    const up = (f.sentiment || '').startsWith('pos');
                    return (
                      <div key={f.id || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 15px', borderTop: i === 0 ? 'none' : `1px solid ${LINE_SOFT}` }}>
                        <span style={{ flex: '0 0 auto', width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1, background: up ? GREEN_BG : AMBER_BG }}>
                          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: 'none', stroke: up ? GREEN : AMBER, strokeWidth: 2.3, strokeLinecap: 'round', strokeLinejoin: 'round' }}>{up ? <path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v3h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7" /> : <path d="M17 13V4h3v9zM17 13l-4 8a2 2 0 0 1-2-2v-3H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17" />}</svg>
                        </span>
                        <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: NAVY, lineHeight: 1.4 }}>{f.note || (up ? 'Marked as went well.' : 'Marked as needs work.')}</span>
                          <span style={{ display: 'block', fontFamily: MONO, fontSize: 11, color: FAINT, fontWeight: 500, marginTop: 2 }}>{[f.job_code, fmtDate(f.created_at)].filter(Boolean).join(' · ')}</span>
                        </span>
                      </div>
                    );
                  })}
                </Card2>
              </React.Fragment>
            )}
          </React.Fragment>
        )}
      </React.Fragment>
    );
    // iOS-native "Edit" (top-right) on the pane; a matching body button on the
    // legacy modal variant so the affordance is never orphaned. Both open the
    // same reused sub form, pre-filled; saving refetches the profile + roster.
    const editAction = data ? (
      <button type="button" onClick={() => setEditOpen(true)}
        style={{ background: 'none', border: 0, color: NAVY, fontFamily: 'inherit', fontSize: 16, fontWeight: 600, cursor: 'pointer', padding: '6px 8px', minHeight: 44 }}>Edit</button>
    ) : null;
    const editSheet = data ? (
      <EditSubSheet open={editOpen} sub={sub} onClose={() => setEditOpen(false)}
        onSaved={() => { setEditOpen(false); load(); onChanged && onChanged(); }} />
    ) : null;
    if (variant === 'pane') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#fff' }}>
          {window.IosNavBar ? <window.IosNavBar title={sub.business_name || sub.name || name || 'Sub'} onBack={onBack} right={editAction} /> : null}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 18px calc(24px + env(safe-area-inset-bottom))' }}>
            {body}
          </div>
          {editSheet}
        </div>
      );
    }
    return (
      <React.Fragment>
        <Sheet open={open} title={sub.business_name || sub.name || 'Sub profile'} onClose={onClose}>
          {body}
        </Sheet>
        {editSheet}
      </React.Fragment>
    );
  }

  // A selected sub opens as a first-class detail pane on the right (like a
  // contact), reusing the ProfileSheet body via variant='pane'.
  function SubDetailPane({ subId, name, onBack, onChanged }) {
    return <ProfileSheet variant="pane" subId={subId} name={name} onBack={onBack} onChanged={onChanged} open />;
  }

  // ══════════════════════════════════════════════════════════════════
  //  JOB DETAIL SHEET (the control-principle write surface)
  // ══════════════════════════════════════════════════════════════════
  function JobSheet({ offerId, contactId, open, onClose, onChanged }) {
    const [data, setData] = R.useState(null);
    const [loading, setLoading] = R.useState(false);
    const [approving, setApproving] = R.useState(false);
    const [approved, setApproved] = R.useState(false);
    const [suggestions, setSuggestions] = R.useState(null);
    const [copiedId, setCopiedId] = R.useState(null);
    const [drafting, setDrafting] = R.useState(false);
    const [draft, setDraft] = R.useState(null);   // labor and timeframe pre-fill, not yet saved

    const load = R.useCallback(async () => {
      if (!offerId && !contactId) return;
      setLoading(true);
      const { data: res, error } = await callFn('sub-admin-list', { view: 'jobs', offer_id: offerId || null, contact_id: contactId || null });
      if (error) { toast('Job did not load: ' + (await fnErr(error))); setLoading(false); return; }
      // jobs view returns { jobs:[...] } or a single { job }.
      const job = res?.job || (Array.isArray(res?.jobs) ? res.jobs.find(j => (offerId ? (j.offer_id || j.id) === offerId : j.contact_id === contactId)) || res.jobs[0] : res);
      setData(job || null);
      setLoading(false);
      return job;
    }, [offerId, contactId]);
    R.useEffect(() => { if (open) { setApproved(false); setDraft(null); load(); } }, [open, load]);

    const job = data || {};
    const status = job.status || (job.offer_id ? 'offered' : 'needs');
    const needsSub = !job.offer_id && !job.sub_id;
    const oid = job.offer_id || job.id || offerId;
    const cid = job.contact_id || contactId;
    const payoutLocked = ['accepted', 'permit_submitted', 'install_submitted', 'pass_submitted', 'approved_paid'].includes(status);
    const showFoot = status === 'pass_submitted';

    const cust = job.customer || {};
    const scope = job.scope || {};
    const materials = (job.scope_json && job.scope_json.materials) || job.materials || [];
    const shipMats = materials.filter(m => (m.supplied_by || m.suppliedBy) === 'bpp');
    const supplyMats = materials.filter(m => (m.supplied_by || m.suppliedBy) === 'sub');
    const photoSlots = job.photo_slots || [];
    const damage = job.pre_existing_damage || job.damage || [];

    const loadSuggestions = async () => {
      if (!cid) return;
      const { data: res, error } = await callFn('sub-suggest', { contact_id: cid });
      if (error) { toast('Suggest failed: ' + (await fnErr(error))); return; }
      setSuggestions(res?.suggestions || []);
    };
    R.useEffect(() => { if (open && needsSub && cid) loadSuggestions(); }, [open, needsSub, cid]);

    const copyJobLink = async (subId) => {
      const { data: res, error } = await callFn('sub-offer-create', { contact_id: cid, sub_id: subId });
      if (error) { toast('Create failed: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast('Create failed: ' + res.error); return; }
      const link = res?.link;
      setCopiedId(subId);
      if (link) { try { await navigator.clipboard.writeText(link); } catch {} }
      toast('Job link copied, offer created');
      setTimeout(() => setCopiedId(null), 1600);
      onChanged?.();
      load();
    };
    // Draft labor and timeframe with AI. sub-draft-scope reads the
    // proposal + install notes and returns a draft (it does NOT persist); we
    // pre-fill the EditFields so Key can review and Save each one (each
    // Save goes through sub-offer-edit). Nothing is written until Key saves.
    const draftScope = async () => {
      if (drafting) return;
      if (!cid) { toast('No contact on this job yet'); return; }
      setDrafting(true);
      const { data: res, error } = await callFn('sub-draft-scope', { contact_id: cid });
      setDrafting(false);
      if (error) { toast('Draft failed: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast('Draft failed: ' + res.error); return; }
      const d = res?.draft || res || {};
      setDraft({
        est_labor_hours: d.est_labor_hours,
        timeframe_estimate: d.timeframe_estimate,
      });
      toast('AI draft ready, review and Save each field');
    };

    const withdraw = async () => {
      const ok = await window.confirmAction?.({ title: 'Withdraw this offer?', body: 'The sub loses access to the job. You can offer it to someone else.', confirmLabel: 'Withdraw', destructive: true });
      if (ok === false) return;
      const { data: res, error } = await callFn('sub-offer-withdraw', { offer_id: oid });
      if (error) { toast('Withdraw failed: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast('Withdraw failed: ' + res.error); return; }
      toast('Offer withdrawn'); onChanged?.(); load();
    };
    const approvePayout = async () => {
      if (approving) return;
      setApproving(true);
      const { data: res, error } = await callFn('sub-approve-payout', { offer_id: oid });
      setApproving(false);
      if (error) { toast('Approve failed: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast('Approve failed: ' + res.error); return; }
      setApproved(true); toast('Payout obligation recorded'); onChanged?.(); load();
    };
    const recordInspectionFailure = async () => {
      if (!oid || !job.sub_id || !cid) return;
      const detail = window.prompt('What failed inspection? This reopens the job for correction and blocks payout until new pass proof is uploaded.');
      if (detail == null) return;
      const { data: res, error } = await callFn('sub-feedback', {
        action: 'add_incident', kind: 'failed_inspection', sub_id: job.sub_id,
        contact_id: cid, offer_id: oid, detail: detail.trim() || null,
      });
      if (error) { toast('Could not reopen job: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast('Could not reopen job: ' + res.error); return; }
      toast('Inspection failed, job reopened for correction'); onChanged?.(); load();
    };
    // Server records payout_agreed_amount (frozen at accept), not a later edit of payout_amount.
    const owedDollars = job.payout_agreed_amount != null ? job.payout_agreed_amount : job.payout_amount;
    const owedDiffers = job.payout_agreed_amount != null
      && job.payout_amount != null
      && Number(job.payout_agreed_amount) !== Number(job.payout_amount);

    return (
      <Sheet
        open={open}
        title={cust.name || job.client_name || 'Job detail'}
        onClose={onClose}
        foot={showFoot ? (
          <div style={{ flex: '0 0 auto', padding: '12px 18px calc(14px + env(safe-area-inset-bottom))', borderTop: `1px solid ${LINE}`, background: '#eef1f6' }}>
            {approved ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 54, borderRadius: 12, background: GREEN_BG, border: `1px solid ${GREEN_LINE}`, color: GREEN, fontWeight: 800, fontSize: 16 }}>
                <svg viewBox="0 0 24 24" style={{ width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M4 12.5l5 5 11-12" /></svg> Obligation recorded
              </div>
            ) : (
              <React.Fragment>
                <button onClick={recordInspectionFailure} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 46, marginBottom: 9, background: '#fff', color: RED, border: `1px solid ${RED}`, borderRadius: 10, fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  Inspection failed
                </button>
                <button onClick={approvePayout} disabled={approving} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', minHeight: 54, background: GOLD, color: DEEP, border: 0, borderRadius: 12, fontFamily: 'inherit', fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', cursor: approving ? 'default' : 'pointer', boxShadow: '0 8px 22px rgba(255,186,0,.32)' }}>
                  <svg viewBox="0 0 24 24" style={{ width: 19, height: 19, fill: 'none', stroke: DEEP, strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M12 3v18M8 8a3 3 0 0 1 3-2.5h2a3 3 0 0 1 0 6h-2a3 3 0 0 0 0 6h2a3 3 0 0 0 3-2.5" /></svg>
                  {approving ? 'Approving...' : `Record owed, ${money(owedDollars)}`}
                </button>
                <p style={{ fontSize: 12, color: FAINT, textAlign: 'center', margin: '8px 0 0' }}>
                  {owedDiffers
                    ? `Records the accepted amount (${money(owedDollars)}), not the edited figure (${money(job.payout_amount)}). You still pay offline, then mark paid in the payout tracker.`
                    : 'Records the owed amount only. You still pay the sub offline, then mark paid in the payout tracker.'}
                </p>
              </React.Fragment>
            )}
          </div>
        ) : null}
      >
        {loading && !data && <div style={{ fontSize: 13, color: MUTED, padding: '20px 2px' }}>Loading job...</div>}
        {data && (
          <React.Fragment>
            {/* Suggested subs (needs-a-sub) */}
            {needsSub && (
              <React.Fragment>
                <SubLabel>Suggested subs, best first</SubLabel>
                {suggestions == null && <div style={{ fontSize: 13, color: MUTED, padding: '4px 2px 10px' }}>Ranking subs...</div>}
                {suggestions && suggestions.length === 0 && <div style={{ fontSize: 13, color: MUTED, padding: '4px 2px 10px' }}>No eligible subs found for this area yet.</div>}
                {(suggestions || []).map((s, i) => (
                  <div key={s.sub_id || i} style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 11, boxShadow: SHADOW, padding: '12px 14px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: NAVY, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{i + 1}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{s.name || s.business_name}</span>
                        <RankChip tier={s.rank_tier} score={s.perf_score} />
                      </span>
                      <ComplianceChip value={s.compliance || (s.eligible ? 'ready' : 'gaps')} />
                    </div>
                    {(s.why || (s.warnings && s.warnings.length)) && <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.45, margin: '8px 0 0' }}>{s.why}{s.warnings && s.warnings.length ? ` ${s.warnings.join(' ')}` : ''}</p>}
                    <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
                      <button onClick={() => copyJobLink(s.sub_id)} style={{ minHeight: 40, padding: '0 13px', border: `1px solid ${copiedId === s.sub_id ? GREEN_LINE : NAVY}`, background: copiedId === s.sub_id ? GREEN_BG : '#fff', color: copiedId === s.sub_id ? GREEN : NAVY, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>{copiedId === s.sub_id ? <path d="M5 12.5l4 4 10-10" /> : <React.Fragment><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></React.Fragment>}</svg>
                        {copiedId === s.sub_id ? 'Copied' : 'Copy job link'}
                      </button>
                    </div>
                  </div>
                ))}
              </React.Fragment>
            )}

            {/* Assigned sub + withdraw (has an offer) */}
            {!needsSub && (job.sub_name || job.sub_id) && (
              <React.Fragment>
                <SubLabel>Assigned sub</SubLabel>
                <Card2 pad style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <span style={{ width: 38, height: 38, borderRadius: '50%', background: NAVY, color: '#fff', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{initials(job.sub_name)}</span>
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{job.sub_contact_name || job.sub_name}</div>
                    <div style={{ fontSize: 13, color: FAINT, fontWeight: 600 }}>{job.sub_name}</div>
                  </div>
                  {['offered', 'accepted'].includes(status) && (
                    <button onClick={withdraw} style={{ minHeight: 40, padding: '0 13px', border: `1px solid ${RED_LINE}`, background: '#fff', color: RED, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Withdraw offer</button>
                  )}
                </Card2>
              </React.Fragment>
            )}

            {/* Client, for the installation (revealed post-accept) */}
            {cust && (cust.name || cust.address) && (
              <React.Fragment>
                <SubLabel>Client, for the installation</SubLabel>
                <Card2>
                  <KV first k="Name" v={cust.name || '(none)'} />
                  <KV k="Address" v={cust.address ? <React.Fragment>{cust.address}<br /><a href={`https://maps.apple.com/?q=${encodeURIComponent(cust.address)}`} target="_blank" rel="noopener" style={{ color: NAVY, textDecoration: 'underline', textDecorationColor: GOLD, textDecorationThickness: 2, textUnderlineOffset: 2 }}>Open in Maps</a></React.Fragment> : '(none)'} />
                  {cust.phone && <KV k="Phone" v={cust.phone} mono />}
                </Card2>
                <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: SUNKEN, border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 13px', marginTop: 9 }}>
                  <svg viewBox="0 0 24 24" style={{ flex: '0 0 auto', width: 15, height: 15, marginTop: 1, fill: 'none', stroke: FAINT, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M4 5h16v11H9l-4 4z" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
                  <p style={{ fontSize: 13, lineHeight: 1.45, color: MUTED, margin: 0 }}><b style={{ color: INK, fontWeight: 700 }}>The sub must not contact the customer.</b> Key handles all scheduling and messages.</p>
                </div>
              </React.Fragment>
            )}

            {/* Editable control-principle fields (only once there is an offer row) */}
            {oid && (
              <React.Fragment>
                <SubLabel right={cid ? (
                  <button onClick={draftScope} disabled={drafting} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34, padding: '0 11px', border: `1px solid ${AMBER_LINE}`, background: AMBER_BG, color: '#7a5a00', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'none', cursor: drafting ? 'default' : 'pointer' }}>
                    <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: GOLD, stroke: 'none' }}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
                    {drafting ? 'Drafting...' : 'Draft with AI'}
                  </button>
                ) : null}>Job setup</SubLabel>
                {draft && <p style={{ fontSize: 12, color: '#7a5a00', margin: '0 2px 10px', lineHeight: 1.45 }}>AI drafted the labor and timeframe below. Review each and tap Save to send it to the sub. Nothing is saved until you do.</p>}
                <EditField label="Timeframe estimate" aiTag offerId={oid} field="timeframe_estimate" value={draft && draft.timeframe_estimate != null ? draft.timeframe_estimate : job.timeframe_estimate} onSaved={load} />
                <EditField label="Firm install date" offerId={oid} field="firm_install_date" value={job.firm_install_date ? String(job.firm_install_date).slice(0, 10) : ''} onSaved={load} />
                <EditField label="Payout amount" offerId={oid} field="payout_amount" money value={job.payout_amount} locked={payoutLocked} lockNote={`The sub already accepted ${money(job.payout_agreed_amount != null ? job.payout_agreed_amount : job.payout_amount)}. Changing it needs a reason and shows the sub what changed.`} onSaved={load} />
                <EditField label="Labor hours" aiTag offerId={oid} field="est_labor_hours" value={draft && draft.est_labor_hours != null ? draft.est_labor_hours : job.est_labor_hours} onSaved={load} />

                {/* Materials (read-only snapshot, two groups) */}
                {(shipMats.length > 0 || supplyMats.length > 0) && (
                  <React.Fragment>
                    <SubLabel>Materials</SubLabel>
                    {shipMats.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, margin: '0 2px 7px', color: GREEN }}>
                          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2.3, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M4 7l8-4 8 4v10l-8 4-8-4z" /><path d="M4 7l8 4 8-4" /></svg> We ship this
                        </div>
                        {shipMats.map((m, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', background: '#fff', border: `1px solid ${LINE_SOFT}`, borderRadius: 9, marginBottom: 6, fontSize: 15, fontWeight: 600, color: NAVY }}><span style={{ width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: GREEN }} /> {m.label}</div>)}
                      </div>
                    )}
                    {supplyMats.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, margin: '0 2px 7px', color: MUTED }}>
                          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2.3, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M4 7h16M4 12h16M4 17h10" /></svg> You supply
                        </div>
                        {supplyMats.map((m, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', background: '#fff', border: `1px solid ${LINE_SOFT}`, borderRadius: 9, marginBottom: 6, fontSize: 15, fontWeight: 600, color: NAVY }}><span style={{ width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: '#c3cbd6' }} /> {m.label}</div>)}
                      </div>
                    )}
                  </React.Fragment>
                )}

                {/* Ship status: server already supports these fields via sub-offer-edit;
                    CRM was read-only before. Reuses PermitControl segmented pattern. */}
                {oid && (
                  <MaterialsShipControl job={job} offerId={oid} onSaved={load} />
                )}

                <EditField label="Scope notes" textarea offerId={oid} jsonField="scope_json" jsonKey="description" jsonSource={job.scope_json} value={(job.scope_json && job.scope_json.description) || job.scope_notes} onSaved={load} />
              </React.Fragment>
            )}

            {/* QC photo gallery (read-only, named slots) */}
            {photoSlots.length > 0 && (
              <React.Fragment>
                <SubLabel>Job photos</SubLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {photoSlots.map((s, i) => {
                    const filled = !!s.filled;
                    return (
                      <div key={s.code || i} onClick={() => { if (filled && s.id) viewSlot(s.id); }} style={{ position: 'relative', aspectRatio: '1', borderRadius: 11, overflow: 'hidden', cursor: filled ? 'pointer' : 'default', background: filled ? 'linear-gradient(135deg,#c9d4e2,#e6ebf2)' : SUNKEN, border: filled ? `1px solid ${LINE}` : `1.5px dashed ${LINE}`, display: filled ? 'block' : 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT }}>
                        {filled ? (
                          <span style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, width: 20, height: 20, borderRadius: '50%', background: GREEN, border: '1.5px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg viewBox="0 0 24 24" style={{ width: 11, height: 11, fill: 'none', stroke: '#fff', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M5 12.5l4 4 10-10" /></svg></span>
                        ) : (
                          <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }}><rect x="3" y="6" width="18" height="14" rx="2" /><circle cx="12" cy="13" r="3.4" /></svg>
                        )}
                        <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2, fontSize: 9.5, fontWeight: 600, color: filled ? '#fff' : FAINT, background: filled ? 'linear-gradient(to top, rgba(11,20,38,.85), rgba(11,20,38,0))' : 'transparent', padding: '12px 7px 5px', lineHeight: 1.15 }}>{s.label}{!s.is_required ? ', optional' : ''}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: MUTED, marginTop: 10, lineHeight: 1.45 }}>
                  <svg viewBox="0 0 24 24" style={{ flex: '0 0 auto', width: 14, height: 14, marginTop: 1, fill: 'none', stroke: FAINT, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                  Key reviews photos manually. Photos never gate the payout.
                </div>
              </React.Fragment>
            )}

            {/* Pre-existing damage documented by the sub (read-only, informational) */}
            {damage.length > 0 && (
              <React.Fragment>
                <SubLabel>Pre-existing damage documented by the sub</SubLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {damage.map((d, i) => (
                    <div key={d.id || i} onClick={() => { if (d.id) viewSlot(d.id); }} style={{ borderRadius: 11, overflow: 'hidden', cursor: d.id ? 'pointer' : 'default' }}>
                      <div style={{ position: 'relative', aspectRatio: '1', background: 'linear-gradient(135deg,#c7bfb0,#ded7c9)', border: `1px solid ${LINE}` }} />
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: MUTED, marginTop: 5, lineHeight: 1.25 }}>{d.note || 'Documented'}<span style={{ display: 'block', fontFamily: MONO, fontSize: 10, color: FAINT, fontWeight: 500, marginTop: 2 }}>{fmtDate(d.uploaded_at || d.created_at)}</span></span>
                    </div>
                  ))}
                </div>
              </React.Fragment>
            )}
          </React.Fragment>
        )}
      </Sheet>
    );

    // View a private QC / damage file via a signed URL (operator only).
    async function viewSlot(uploadId) {
      const { data: res, error } = await callFn('sub-doc-access', { mode: 'signed_url', upload_id: uploadId });
      if (error) { toast('Could not open: ' + (await fnErr(error))); return; }
      const url = res?.url || res?.signed_url;
      if (url) window.open(url, '_blank', 'noopener'); else toast('No file');
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  ROSTER + JOBS LISTS
  // ══════════════════════════════════════════════════════════════════
  // Map the endpoint's compliance state to the chip's vocabulary. The endpoint emits
  // compliance booleans (compliance_ready/compliance_expired) AND a state string
  // ('green'|'amber'|'red'); the ComplianceChip speaks 'ready'|'gaps'|'expired'.
  // Prefer the booleans; fall back to translating the state string (never pass a raw
  // 'green'/'amber'/'red' through, which the chip would render as 'Gaps').
  function complianceValueOf(o) {
    if (!o) return 'gaps';
    if (o.compliance_ready) return 'ready';
    if (o.compliance_expired) return 'expired';
    const st = o.compliance;
    if (st === 'green' || st === 'ready') return 'ready';
    if (st === 'red' || st === 'expired') return 'expired';
    return 'gaps';
  }

  // ══════════════════════════════════════════════════════════════════
  //  NEW SUB SHEET (onboard a subcontractor from scratch; sub-upsert's
  //  create path already exists server-side, this was the missing CRM action)
  // ══════════════════════════════════════════════════════════════════
  function NewSubSheet({ open, onClose, onCreated, initial = '' }) {
    const [name, setName] = R.useState('');
    const [businessName, setBusinessName] = R.useState('');
    const [phone, setPhone] = R.useState('');
    const [email, setEmail] = R.useState('');
    const [saving, setSaving] = R.useState(false);
    // Seed from the search query (Key 2026-07-10): a pure phone-shaped seed lands
    // in Phone, anything else in Name (the required field). Matches the Contacts
    // search-to-create behavior. Re-seeds each time the sheet opens.
    R.useEffect(() => {
      if (!open) return;
      const seed = String(initial || '').trim();
      const isPhone = !!seed && /^[+\d\s().\-]+$/.test(seed);
      setName(isPhone ? '' : seed);
      setBusinessName('');
      setPhone(isPhone ? seed : '');
      setEmail('');
    }, [open, initial]);

    const fieldStyle = { width: '100%', minHeight: 46, fontFamily: 'inherit', fontSize: 16, fontWeight: 500, color: NAVY, background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 9, padding: '11px 12px', outline: 'none', marginBottom: 12, boxSizing: 'border-box' };

    const create = async () => {
      const trimmed = name.trim();
      if (!trimmed) { toast('Name is required'); return; }
      setSaving(true);
      const { data: res, error } = await callFn('sub-upsert', {
        name: trimmed,
        business_name: businessName.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      setSaving(false);
      if (error) { toast('Could not create sub: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast(res.error); return; }
      toast('Sub added, pending onboarding');
      onCreated?.(res?.sub_id);
      onClose();
    };

    return (
      <Sheet open={open} title="New sub" onClose={onClose}>
        <SubLabel>Identity</SubLabel>
        <p style={{ fontSize: 13, color: FAINT, margin: '0 2px 12px' }}>Name is the only thing required to get started. Add the rest now or later from their profile. Copy the onboarding link once they are ready.</p>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (required)" style={fieldStyle} autoFocus />
        <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Business name" style={fieldStyle} />
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" style={fieldStyle} />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={fieldStyle} />
        <button onClick={create} disabled={saving || !name.trim()} style={{ minHeight: 48, width: '100%', padding: '0 14px', border: 0, background: (saving || !name.trim()) ? '#c6cedb' : NAVY, color: '#fff', borderRadius: 10, fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: (saving || !name.trim()) ? 'default' : 'pointer', marginTop: 4 }}>{saving ? 'Adding...' : 'Add sub'}</button>
      </Sheet>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  //  EDIT SUB SHEET , correct a sub's details any time (Key 2026-07-10).
  //  Reuses the same Sheet + input style + SubLabel headers as the New sub
  //  form (no net-new design language). sub-upsert's edit path (id + a
  //  whitelisted field set) already exists server-side; this was the only
  //  missing piece of "edit the details anytime in my CRM." Covers the core
  //  Business / License / Insurance fields (a few whitelisted-but-secondary
  //  columns like gl_carrier / base_address / notes are intentionally left out).
  //  Prefilled from the loaded profile (PROFILE_COLS returns all of these), so an
  //  untouched field is never wiped; clearing a field on purpose does clear it.
  // ══════════════════════════════════════════════════════════════════
  function EditSubSheet({ open, sub, onClose, onSaved }) {
    const [name, setName] = R.useState('');
    const [businessName, setBusinessName] = R.useState('');
    const [phone, setPhone] = R.useState('');
    const [email, setEmail] = R.useState('');
    const [mailing, setMailing] = R.useState('');
    const [licState, setLicState] = R.useState('');
    const [licNumber, setLicNumber] = R.useState('');
    const [licExp, setLicExp] = R.useState('');
    const [glExp, setGlExp] = R.useState('');
    const [wcExp, setWcExp] = R.useState('');
    const [desiredJobs, setDesiredJobs] = R.useState('');
    const [saving, setSaving] = R.useState(false);
    const d10 = (v) => (v ? String(v).slice(0, 10) : '');
    R.useEffect(() => {
      if (!open || !sub) return;
      setName(sub.name || '');
      setBusinessName(sub.business_name || '');
      setPhone(sub.phone || '');
      setEmail(sub.email || '');
      setMailing(sub.mailing_address || '');
      setLicState(sub.license_state || '');
      setLicNumber(sub.license_number || '');
      setLicExp(d10(sub.license_expiration));
      setGlExp(d10(sub.gl_expiration));
      setWcExp(d10(sub.wc_expiration));
      setDesiredJobs(sub.desired_jobs_per_month != null ? String(sub.desired_jobs_per_month) : '');
      // Key on [open, sub.id], NOT [open, sub]: `sub` is recomputed each parent
      // render, so depending on the object would re-prefill (clobbering the
      // operator's in-progress edits) on any incidental refetch while the sheet
      // is open. Prefill should fire only when the sheet opens or the sub changes.
    }, [open, sub.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const fieldStyle = { width: '100%', minHeight: 46, fontFamily: 'inherit', fontSize: 16, fontWeight: 500, color: NAVY, background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 9, padding: '11px 12px', outline: 'none', marginBottom: 12, boxSizing: 'border-box' };
    const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: FAINT, margin: '2px 2px 5px' };

    const save = async () => {
      const trimmed = name.trim();
      if (!trimmed) { toast('Name is required'); return; }
      // Phone honesty guard: sub-upsert's normalizePhone returns null for anything
      // that isn't 10 digits (or 11 starting with 1), and pickFields would then
      // write that null, silently WIPING a phone the operator was mid-editing while
      // still toasting success. Mirror the server's accepted shapes and block with
      // real feedback instead. Empty is allowed (a deliberate clear).
      const rawPhone = phone.trim();
      if (rawPhone) {
        const digits = rawPhone.replace(/\D/g, '');
        if (!(digits.length === 10 || (digits.length === 11 && digits[0] === '1'))) {
          toast('Enter a valid 10-digit phone, or clear it'); return;
        }
      }
      setSaving(true);
      const { data: res, error } = await callFn('sub-upsert', {
        id: sub.id,
        name: trimmed,
        business_name: businessName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        mailing_address: mailing.trim(),
        license_state: licState.trim(),
        license_number: licNumber.trim(),
        license_expiration: licExp || null,
        gl_expiration: glExp || null,
        wc_expiration: wcExp || null,
        desired_jobs_per_month: desiredJobs.trim() === '' ? null : Number(desiredJobs),
      });
      setSaving(false);
      if (error) { toast('Could not save: ' + (await fnErr(error))); return; }
      if (res && res.error) { toast(res.error); return; }
      toast('Details saved');
      onSaved && onSaved();
    };

    return (
      <Sheet open={open} title="Edit sub" onClose={onClose}>
        <SubLabel>Identity</SubLabel>
        <label style={labelStyle}>Primary contact name (required)</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={fieldStyle} />
        <label style={labelStyle}>Business name</label>
        <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Business name" style={fieldStyle} />
        <label style={labelStyle}>Phone</label>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" style={fieldStyle} />
        <label style={labelStyle}>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={fieldStyle} />

        <SubLabel>Shipping</SubLabel>
        <label style={labelStyle}>Mailing address (ship-to for the inlet, interlock, and cord)</label>
        <input type="text" value={mailing} onChange={(e) => setMailing(e.target.value)} placeholder="Mailing address" style={fieldStyle} />

        <SubLabel>License</SubLabel>
        <label style={labelStyle}>License state</label>
        <input type="text" value={licState} onChange={(e) => setLicState(e.target.value)} placeholder="e.g. SC" maxLength={4} style={fieldStyle} />
        <label style={labelStyle}>License number</label>
        <input type="text" value={licNumber} onChange={(e) => setLicNumber(e.target.value)} placeholder="License number" style={fieldStyle} />
        <label style={labelStyle}>License expiration</label>
        <input type="date" value={licExp} onChange={(e) => setLicExp(e.target.value)} style={fieldStyle} />

        <SubLabel>Insurance</SubLabel>
        <label style={labelStyle}>General liability expiration</label>
        <input type="date" value={glExp} onChange={(e) => setGlExp(e.target.value)} style={fieldStyle} />
        <label style={labelStyle}>Workers comp expiration</label>
        <input type="date" value={wcExp} onChange={(e) => setWcExp(e.target.value)} style={fieldStyle} />

        <SubLabel>Capacity</SubLabel>
        <label style={labelStyle}>Desired jobs per month</label>
        <input type="number" inputMode="numeric" min="0" value={desiredJobs} onChange={(e) => setDesiredJobs(e.target.value)} placeholder="e.g. 8" style={fieldStyle} />

        <button onClick={save} disabled={saving || !name.trim()} style={{ minHeight: 48, width: '100%', padding: '0 14px', border: 0, background: (saving || !name.trim()) ? '#c6cedb' : NAVY, color: '#fff', borderRadius: 10, fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: (saving || !name.trim()) ? 'default' : 'pointer', marginTop: 4 }}>{saving ? 'Saving...' : 'Save details'}</button>
      </Sheet>
    );
  }

  function RosterRow({ sub, onOpen }) {
    const compliance = complianceValueOf(sub);
    const owed = sub.owed_amount != null ? sub.owed_amount : (sub.owed_cents != null ? sub.owed_cents / 100 : 0);
    const counties = sub.counties || sub.jurisdiction_counties || [];
    return (
      // iOS Phase 1 Pass 2 (Key 2026-07-09): sub bubbles become hairline
      // rows. Transparent surface + hairline bottom divider (same token the
      // Contacts list uses), no per-row card, no drop shadow. Every signal
      // preserved: business name, primary contact, status chip, compliance
      // chip, rank chip, counties, and the This month / Installs / Owed
      // stats stripe. The metrics-row's own top divider stays as a lighter
      // inset separator so the two info tiers still read distinct.
      <div onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} style={{
        background: 'transparent',
        border: 0,
        borderBottom: '1px solid rgba(27,43,75,0.085)',
        padding: '14px 22px', minHeight: 60,
        cursor: 'pointer',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
            {/* Sub logo / profile picture (initials fallback), set on the detail. */}
            <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: '#eef1f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {sub.logo_url
                ? <img src={sub.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>{(String(sub.business_name || sub.name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase()}</span>}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.business_name || sub.name}</div>
              {sub.primary_contact_name && <div style={{ fontSize: 13, fontWeight: 500, color: FAINT, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.primary_contact_name}</div>}
            </div>
          </div>
          <SubStatusChip status={sub.status} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
          <ComplianceChip value={compliance} />
          <RankChip tier={sub.rank_tier} score={sub.perf_score} />
          {counties.map((c, i) => <span key={i} style={{ fontSize: 11, fontWeight: 600, borderRadius: 6, padding: '4px 8px', whiteSpace: 'nowrap', color: MUTED, background: '#eef1f6', border: `1px solid ${LINE_SOFT}` }}>{c}</span>)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 12, paddingTop: 11, borderTop: `1px solid ${LINE_SOFT}` }}>
          {[['This month', `${sub.jobs_this_month != null ? sub.jobs_this_month : 0}${sub.desired_jobs_per_month ? ` / ${sub.desired_jobs_per_month}` : ''}`, null],
            ['Installs', String(sub.installs_total != null ? sub.installs_total : 0), null],
            ['Owed', money(owed), owed > 0 ? RED : GREEN]].map(([mk, mv, col], i, arr) => (
            <div key={mk} style={{ flex: '1 1 0', textAlign: i === 0 ? 'left' : i === arr.length - 1 ? 'right' : 'center', borderLeft: i === 0 ? 'none' : `1px solid ${LINE_SOFT}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: FAINT }}>{mk}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: col || NAVY, marginTop: 2, fontFamily: mk === 'Owed' ? MONO : 'inherit', fontVariantNumeric: 'tabular-nums' }}>{mv}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function JobRow({ job, onOpen }) {
    const needsSub = !job.sub_id && !job.offer_id || ['declined', 'withdrawn', 'expired'].includes(job.status);
    const declinedTail = ['declined', 'withdrawn', 'expired'].includes(job.status);
    const payLabel = job.payout_locked || ['accepted', 'permit_submitted', 'install_submitted', 'pass_submitted', 'approved_paid'].includes(job.status) ? 'payout, frozen' : 'payout';
    return (
      // Same hairline row treatment as RosterRow so any list of jobs reads
      // consistent with the Contacts / Subs list language.
      <div onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} style={{
        background: 'transparent',
        border: 0,
        borderBottom: '1px solid rgba(27,43,75,0.085)',
        padding: '14px 22px', minHeight: 60,
        cursor: 'pointer',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, lineHeight: 1.2 }}>{job.client_name || job.contact_name || 'Client'}</div>
            {(needsSub || declinedTail) ? (
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 6, color: AMBER }}>
                <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' }}><path d="M12 5v14M5 12h14" /></svg>
                {declinedTail ? 'Needs a sub, last offer declined' : 'Needs a sub'}
              </div>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 6, color: MUTED }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: NAVY, color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initials(job.sub_contact_name || job.sub_name)}</span>
                {job.sub_contact_name || job.sub_name}
              </div>
            )}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: NAVY, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(job.payout_amount)}<span style={{ display: 'block', fontFamily: 'inherit', fontSize: 10, fontWeight: 600, color: FAINT, letterSpacing: '0.03em' }}>{payLabel}</span></div>
        </div>
        <OfferStepper status={job.status || 'offered'} />
      </div>
    );
  }

  // Renamed from EmptyState (2026-07-04 audit): crm-left.jsx has a top-level
  // EmptyState with a different prop shape (icon/text/helper/actionLabel). This
  // one is nested so there is no live collision, but the shared name was a
  // footgun if ever lifted out. SubEmptyState is unambiguous.
  function SubEmptyState({ title, body }) {
    return (
      <div style={{ textAlign: 'center', padding: '56px 24px' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#e7ebf2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: FAINT }}>
          <svg viewBox="0 0 24 24" style={{ width: 26, height: 26, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="8" r="3.2" /><path d="M19 8v6M22 11h-6" /></svg>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: NAVY, margin: '0 0 6px' }}>{title}</h3>
        <p style={{ fontSize: 13, color: MUTED, margin: '0 auto', maxWidth: '34ch', lineHeight: 1.5 }}>{body}</p>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  //  SubsTab , the tab body (Roster / Jobs segmented views)
  // ══════════════════════════════════════════════════════════════════
  function SubsTab() {
    // LEFT command center = the ROSTER (every sub, compliance + payout at a
    // glance). Jobs are NOT here anymore: a contact's job lives on THAT
    // contact's right-pane Subs tab (SubTabView), mirroring the CRM's
    // browse-left / this-contact-right split (Key, 2026-07-04). Tap a sub to
    // open the full profile sheet.
    const [roster, setRoster] = R.useState(null);
    const [loading, setLoading] = R.useState(false);
    const [addingSub, setAddingSub] = R.useState(false);
    // Create-a-sub-from-search seed (Key 2026-07-10): mirrors the Contacts search,
    // whatever was typed seeds the New sub sheet (name vs phone by shape).
    const [addingSubSeed, setAddingSubSeed] = R.useState('');
    // The sub detail now opens in the right pane (SubDetailPane), not a modal.
    // When it changes a sub (verify doc, feedback, rank) it fires crm-sub-changed
    // so the roster on the left refetches.
    R.useEffect(() => {
      const refresh = () => setRoster(null);
      window.addEventListener('crm-sub-changed', refresh);
      return () => window.removeEventListener('crm-sub-changed', refresh);
    }, []);
    // Roster search via the shared bottom dock (Key 2026-07-10): the tab-bar
    // Search bubble opens the glass dock above the keyboard. Text-only (no
    // category filters) over business name, primary contact, and counties.
    const [search, setSearch] = R.useState('');
    const useSearchDock = window.useSearchDock, SearchDock = window.SearchDock;
    const { searchOpen, closeSearch, dockVisible } = useSearchDock('bpp-sub-search', { onExit: () => setSearch('') });

    // ── Recruiting applicants (Key 2026-07-21) ────────────────────────
    // The public /subs/ form writes sub_candidates; surface the OPEN ones
    // (applied -> screened -> test_install) right here on the Subs toggle so a
    // posted apply link is never a dead end. Direct authenticated reads/writes
    // (RLS sub_candidates_authenticated_all); reuses the retired bench's stage
    // ladder. Terminal stages (active/declined/benched) drop off this list.
    const [applicants, setApplicants] = R.useState(null);
    const loadApplicants = R.useCallback(async () => {
      const db = window.CRM?.__db;
      if (!db) return;
      const { data, error } = await db.from('sub_candidates')
        .select('id, created_at, name, phone, email, business_name, sc_license, license_verified, insurance_status, years_experience, service_areas, capacity_per_month, source, stage')
        .in('stage', ['applied', 'screened', 'test_install'])
        .order('created_at', { ascending: false });
      if (!error) setApplicants(data || []);
    }, []);
    R.useEffect(() => { if (applicants == null) loadApplicants(); }, [applicants, loadApplicants]);

    const CAND_NEXT = { applied: 'screened', screened: 'test_install', test_install: 'active' };
    const CAND_LABEL = { applied: 'Mark screened', screened: 'Start test install', test_install: 'Make active sub' };
    const STAGE_TXT = { applied: 'Applied', screened: 'Screened', test_install: 'Test install' };
    const patchApplicant = async (cand, patch, okMsg) => {
      const db = window.CRM?.__db;
      if (!db) return;
      const { error } = await db.from('sub_candidates').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', cand.id);
      if (error) { toast('Update did not save'); return; }
      toast(okMsg);
      loadApplicants();
    };
    const addApplicantLicense = (cand) => {
      const entered = window.prompt('SC license number', cand.sc_license || '');
      if (entered == null) return;
      const license = entered.trim();
      if (!license) { toast('Enter the SC license number before verifying it'); return; }
      patchApplicant(cand, { sc_license: license, license_verified: false }, `${cand.name}: license added`);
    };
    const advanceApplicant = async (cand) => {
      const next = CAND_NEXT[cand.stage];
      if (!next) return;
      if (next !== 'active') {
        await patchApplicant(cand, { stage: next }, `${cand.name}: ${next.replace('_', ' ')}`);
        return;
      }
      const { data: res, error } = await callFn('sub-upsert', {
        action: 'graduate_candidate', candidate_id: cand.id,
      });
      if (error || !res?.ok) {
        const reason = res?.error === 'license_number_required'
          ? 'Add the SC license number before making this applicant active'
          : res?.error === 'license_not_verified'
            ? 'Verify the license before making this applicant active'
          : res?.error === 'insurance_not_verified'
            ? 'Verify insurance before making this applicant active'
            : 'Could not create the subcontractor record';
        toast(reason);
        return;
      }
      toast(`${cand.name} is now in the subcontractor roster`);
      setRoster(null);
      loadApplicants();
    };
    const declineApplicant = (cand) => patchApplicant(cand, { stage: 'declined' }, `${cand.name} moved to past candidates`);
    const copyApplyLink = async () => {
      try { await navigator.clipboard.writeText('https://qa.backuppowerpro.com/subs/'); toast('Apply link copied. Post it to candidates.'); }
      catch { toast('Apply link: backuppowerpro.com/subs/'); }
    };

    const loadRoster = R.useCallback(async () => {
      setLoading(true);
      const { data: res, error } = await callFn('sub-admin-list', { view: 'roster' });
      setLoading(false);
      if (error) { toast('Roster did not load: ' + (await fnErr(error))); return; }
      setRoster(res?.subs || res?.roster || []);
    }, []);

    R.useEffect(() => { if (roster == null) loadRoster(); }, [roster, loadRoster]);

    const refreshRoster = () => { setRoster(null); loadRoster(); };
    const rosterCount = roster?.length || 0;
    const q = search.trim();
    const filteredRoster = !q ? (roster || []) : (roster || []).filter((s) => {
      const hay = [s.business_name, s.name, s.primary_contact_name, ...(s.counties || s.jurisdiction_counties || [])].filter(Boolean).join('  ');
      return window.smartMatch ? window.smartMatch(q, hay) : hay.toLowerCase().includes(q.toLowerCase());
    });

    return (
      // iOS Phase 1 Pass 2 (Key 2026-07-09): the odd navy "Sub roster" header
      // (different length from every other tab's header) is gone. The tab now
      // reads like every other primary tab: shell LargeTitleHeader paints
      // "Subs" up top; a compact meta+action row sits below it; the roster
      // renders as clean hairline rows via RosterRow. Container background
      // matches #f4f5f8 (the shell's near-white) so the rows don't sit on a
      // conflicting gray.
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f4f5f8' }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          // iOS-26 scroll-edge fade while searching: the meta row is hidden so the
          // roster rides to the top; dissolve it under the status bar.
          WebkitMaskImage: searchOpen ? 'linear-gradient(to bottom, transparent 0, #000 calc(env(safe-area-inset-top, 0px) + 18px))' : 'none',
          maskImage: searchOpen ? 'linear-gradient(to bottom, transparent 0, #000 calc(env(safe-area-inset-top, 0px) + 18px))' : 'none' }}>
          {/* Copy the ONE public apply link to post to candidates, + the new
              applicants that link produced. Both hidden while searching so the
              roster rides to the top. (Key 2026-07-21) */}
          {!searchOpen && (
            <div style={{ padding: '4px 22px 0' }}>
              <button onClick={copyApplyLink} style={{
                width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                border: `1.5px solid ${NAVY}`, background: '#fff', color: NAVY, borderRadius: 12,
                fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>
                <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                Copy application link
              </button>
              <div style={{ fontSize: 12, color: FAINT, textAlign: 'center', marginTop: 6 }}>backuppowerpro.com/subs/ , the one link you post to candidates</div>
            </div>
          )}

          {!searchOpen && applicants && applicants.length > 0 && (
            <div style={{ padding: '16px 22px 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: FAINT, letterSpacing: '0.06em', textTransform: 'uppercase' }}>New applicants</span>
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: NAVY, background: '#eaecf1', borderRadius: 100, padding: '2px 10px' }}>{applicants.length}</span>
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {applicants.map((a) => (
                  <div key={a.id} style={{ background: '#fff', borderRadius: 14, boxShadow: 'inset 0 0 0 1px rgba(27,43,75,0.10)', padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{a.name || 'Applicant'}</span>
                      {a.business_name ? <span style={{ fontSize: 13, color: MUTED }}>{a.business_name}</span> : null}
                      <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: AMBER, background: AMBER_BG, border: `1px solid ${AMBER_LINE}`, borderRadius: 100, padding: '2px 9px' }}>{STAGE_TXT[a.stage] || a.stage}</span>
                    </div>
                    <div style={{ fontSize: 13, color: MUTED, marginTop: 5, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {a.phone ? <a href={`tel:${a.phone}`} style={{ color: NAVY, textDecoration: 'none', fontWeight: 600 }}>{a.phone}</a> : null}
                      {a.service_areas ? <span>{a.service_areas}</span> : null}
                      {a.sc_license ? <span>Lic {a.sc_license}</span> : null}
                      {a.capacity_per_month ? <span>wants {a.capacity_per_month}/mo</span> : null}
                      {a.license_verified ? <span>License verified</span> : null}
                      {a.insurance_status === 'verified' ? <span>Insurance verified</span> : null}
                    </div>
                    {(!a.license_verified || a.insurance_status !== 'verified') && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        {!a.sc_license && <button onClick={() => addApplicantLicense(a)} style={{ minHeight: 40, padding: '0 12px', border: `1.5px solid ${LINE_SOFT}`, background: '#fff', color: NAVY, borderRadius: 10, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Add license</button>}
                        {a.sc_license && !a.license_verified && <button onClick={() => patchApplicant(a, { license_verified: true }, `${a.name}: license verified`)} style={{ minHeight: 40, padding: '0 12px', border: `1.5px solid ${LINE_SOFT}`, background: '#fff', color: NAVY, borderRadius: 10, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Verify license</button>}
                        {a.insurance_status !== 'verified' && <button onClick={() => patchApplicant(a, { insurance_status: 'verified' }, `${a.name}: insurance verified`)} style={{ minHeight: 40, padding: '0 12px', border: `1.5px solid ${LINE_SOFT}`, background: '#fff', color: NAVY, borderRadius: 10, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Verify insurance</button>}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button onClick={() => advanceApplicant(a)} style={{ flex: '1 1 auto', minHeight: 44, border: 0, background: NAVY, color: '#fff', borderRadius: 10, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{CAND_LABEL[a.stage] || 'Advance'}</button>
                      <button onClick={() => declineApplicant(a)} style={{ flex: '0 0 auto', minHeight: 44, padding: '0 14px', border: `1.5px solid ${LINE_SOFT}`, background: '#fff', color: MUTED, borderRadius: 10, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meta row: count + "New sub" action. Sub-uppercase caps signal
              "list context", not a duplicate title. Hidden while searching. */}
          {!searchOpen && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 10, padding: '4px 22px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: FAINT, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Roster</span>
                {roster != null && (
                  <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: NAVY, background: '#eaecf1', borderRadius: 100, padding: '2px 10px' }}>{rosterCount}</span>
                )}
              </div>
              <button onClick={() => setAddingSub(true)} style={{
                flex: '0 0 auto', minHeight: 36, padding: '0 14px',
                border: 0, background: NAVY, color: '#fff', borderRadius: 100,
                fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>+ New sub</button>
            </div>
          )}

          <div style={{ paddingBottom: searchOpen ? 24 : 120 }}>
            {loading && roster == null && <div style={{ fontSize: 13, color: MUTED, padding: '12px 22px' }}>Loading roster...</div>}
            {roster && roster.length === 0 && !searchOpen && <SubEmptyState title="No subs yet" body="Once you approve a contractor they show up here with their compliance and payout at a glance." />}
            {/* Create-sub-from-search (Key 2026-07-10): while searching, a Create row
                leads the results seeded with what was typed (name or phone by shape),
                so a no-match search is never a dead end. Mirrors the Contacts search. */}
            {searchOpen && q && (
              <button onClick={() => { setAddingSubSeed(q); setAddingSub(true); }} aria-label={`Create sub ${q}`}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px', border: 'none', borderBottom: '1px solid rgba(27,43,75,0.085)', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', minHeight: 56, WebkitTapHighlightColor: 'transparent' }}>
                <span style={{ flex: '0 0 auto', width: 40, height: 40, borderRadius: '50%', background: '#FFF8E0', color: NAVY, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 400, lineHeight: 1 }}>+</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: NAVY }}>Create sub</span>
                  <span style={{ display: 'block', fontSize: 13, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>&ldquo;{q}&rdquo;</span>
                </span>
              </button>
            )}
            {filteredRoster.map((s) => <RosterRow key={s.id} sub={s} onOpen={() => window.dispatchEvent(new CustomEvent('crm-open-sub', { detail: { subId: s.id, name: s.business_name || s.name } }))} />)}
          </div>
        </div>

        {dockVisible && (
          <SearchDock
            exiting={!searchOpen}
            inputId="bpp-sub-search"
            value={search}
            placeholder="Search subs by name, contact, county"
            onChange={(v) => setSearch(v)}
            onClear={() => setSearch('')}
            onClose={closeSearch}
          />
        )}

        <NewSubSheet open={addingSub} initial={addingSubSeed}
          onClose={() => { setAddingSub(false); setAddingSubSeed(''); }}
          onCreated={(newId) => { setAddingSubSeed(''); setSearch(''); if (searchOpen) closeSearch(); refreshRoster(); if (newId) window.dispatchEvent(new CustomEvent('crm-open-sub', { detail: { subId: newId } })); }} />
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  //  SubCard , compact card for the contact detail panel
  // ══════════════════════════════════════════════════════════════════
  function SubCard({ contact }) {
    const [job, setJob] = R.useState(undefined);   // undefined=loading, null=none
    const [openJob, setOpenJob] = R.useState(false);
    const contactId = contact?.id;

    const load = R.useCallback(async () => {
      if (!contactId) return;
      const { data: res, error } = await callFn('sub-admin-list', { view: 'jobs', contact_id: contactId });
      if (error) { setJob(null); return; }
      const j = res?.job || (Array.isArray(res?.jobs) ? res.jobs.find(x => x.contact_id === contactId) || null : null);
      setJob(j || null);
    }, [contactId]);
    R.useEffect(() => { load(); }, [load]);

    if (job === undefined) return null;  // quiet while loading, no empty shell

    const hasOffer = job && (job.offer_id || job.sub_id);

    return (
      <React.Fragment>
        {hasOffer ? (
          // iOS Phase 1 Pass 2 (Key 2026-07-09): SubCard on the contact-detail
          // right pane joins the .bpp-ios-card language (white surface, 16px
          // radius, 1px inset hairline, no drop shadow) so it reads as one of
          // the sibling detail cards. Same click target + JobSheet route.
          <div onClick={() => setOpenJob(true)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenJob(true); }} style={{
            background: '#ffffff',
            border: 0, borderRadius: 16,
            boxShadow: 'inset 0 0 0 1px rgba(27,43,75,0.085)',
            padding: 18, marginTop: 12, cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{ width: 38, height: 38, borderRadius: '50%', background: NAVY, color: '#fff', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{initials(job.sub_contact_name || job.sub_name)}</span>
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: FAINT }}>Assigned sub</span>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: NAVY, marginTop: 1 }}>{job.sub_contact_name || job.sub_name}</span>
              </div>
              <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: NAVY, textAlign: 'right' }}>{money(job.payout_amount)}<span style={{ display: 'block', fontFamily: 'inherit', fontSize: 10, fontWeight: 600, color: FAINT }}>payout</span></span>
            </div>
            <OfferStepper status={job.status || 'offered'} />
          </div>
        ) : (
          // The empty "assign a sub" state: same white/hairline card language,
          // dashed inset border replaces the solid to signal "empty slot".
          <div onClick={() => setOpenJob(true)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenJob(true); }} style={{
            background: '#ffffff',
            border: 0, borderRadius: 16,
            boxShadow: 'inset 0 0 0 1px rgba(27,43,75,0.14)',
            padding: 18, marginTop: 12, cursor: 'pointer', textAlign: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, color: AMBER, fontWeight: 700, fontSize: 15, padding: '6px 0' }}>
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M12 5v14M5 12h14" /></svg> Assign a sub to this job
            </div>
          </div>
        )}
        <JobSheet offerId={hasOffer ? (job.offer_id || null) : null} contactId={contactId} open={openJob} onClose={() => setOpenJob(false)} onChanged={load} />
      </React.Fragment>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  //  SubTabView , the RIGHT-pane "Subs" tab body (this contact's sub + job)
  // ══════════════════════════════════════════════════════════════════
  // The dual-nav split (Key, 2026-07-04): the LEFT Subs tab is the whole
  // roster; THIS right tab is the ONE job for the open contact. Reuses SubCard
  // (assigned sub + compact stepper + payout, taps into the full JobSheet;
  // shows the "assign a sub" CTA when none), framed as a full-height tab body.
  // SubCard self-fetches and stays silent while loading, so this never flashes
  // an empty shell.
  function SubTabView({ contact }) {
    if (!contact) {
      return <div style={{ padding: '48px 24px', textAlign: 'center', color: MUTED, fontSize: 15, lineHeight: 1.5 }}>Open a contact to see its assigned sub and job.</div>;
    }
    return (
      <div style={{ height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#eef1f6', padding: '4px 14px 40px' }}>
        <SubCard contact={contact} />
      </div>
    );
  }

  Object.assign(window, { SubsTab, SubCard, SubTabView, SubDetailPane });
})();
