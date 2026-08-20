// crm-subs.jsx, Subs admin popover.
// 36x36 icon button in the left panel header. Opens a popover listing
// every active installer with their unpaid-payout rollup, plus an Add
// button that opens a modal to create a new installer_token + welcome
// SMS via sub-create edge fn.
//
// Renders in the same chrome slot as Todos + Permit portals.

function SubsButton({ asHost = false } = {}) {
  const [open, setOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  // Prefill for AddSubModal when a candidate graduates (review 2026-07-01:
  // never re-ask what BPP knows). Cleared when the modal closes.
  const [addSeed, setAddSeed] = React.useState(null);
  // Terminal candidates (active/declined/benched) live behind a disclosure
  // instead of vanishing (review 2026-07-01: no black holes, decline gets
  // an exit path).
  const [pastOpen, setPastOpen] = React.useState(false);
  // Inline license add (uncontrolled by ref, same as the payout reference edit).
  const [licEditId, setLicEditId] = React.useState(null);
  const licInputRef = React.useRef(null);
  const [installers, setInstallers] = React.useState([]);
  // Recruiting bench (Operating Model 2026 build #1): sub_candidates rows
  // from the public sub-apply intake. Reuses the installer-row visual
  // grammar (name row + status pill + expand for actions), no new visual
  // language. Terminal stages (active/declined/benched) collapse away.
  const [candidates, setCandidates] = React.useState([]);
  const [candExpanded, setCandExpanded] = React.useState(null);
  const [payouts, setPayouts] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState(null);  // installer_name
  const [refEditId, setRefEditId] = React.useState(null); // payout id whose reference is being edited (tap-audit #9)
  const refInputRef = React.useRef(null);
  const wrapRef = React.useRef(null);
  // Per-installer "show all payouts" toggle (audit #17): the history capped at
  // 12 rows could hide an unpaid job counted in the red owed-total. We order
  // unpaid-first so money-owed is never the row that gets truncated, and offer
  // an honest "show all" when there are more than 12.
  const [showAllSubs, setShowAllSubs] = React.useState({});

  // Host mode (Key 2026-06-19): mounted at app root, no trigger pill, opens on
  // the tab-bar long-press of the Calendar icon (the 'crm-tab-hold' subs event).
  React.useEffect(() => {
    if (!asHost) return;
    const onHold = e => { if (e.detail?.action === 'subs') setOpen(true); };
    window.addEventListener('crm-tab-hold', onHold);
    return () => window.removeEventListener('crm-tab-hold', onHold);
  }, [asHost]);

  // Close on outside click + Escape.
  React.useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setAddOpen(false); } };
    const onKey = e => { if (e.key === 'Escape') { setOpen(false); setAddOpen(false); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Load installers + payouts when popover opens. Refreshes on the
  // sub_payouts realtime channel too so a fresh install-complete from
  // a sub bumps the unpaid count without manual reload.
  const refresh = React.useCallback(async () => {
    if (!CRM.__db) return;
    setLoading(true);
    try {
      const [instRes, payRes, candRes] = await Promise.all([
        CRM.__db.from('installer_tokens')
          .select('installer_name, installer_phone, revoked_at, created_at, notes')
          .order('created_at', { ascending: true }),
        CRM.__db.from('sub_payouts')
          .select('id, installer_name, contact_id, amount_cents, completed_at, paid_at, paid_method, paid_reference, notes')
          .order('completed_at', { ascending: false }),
        CRM.__db.from('sub_candidates')
          .select('id, created_at, name, phone, email, business_name, sc_license, license_verified, insurance_status, years_experience, service_areas, capacity_per_month, source, stage, notes')
          .order('created_at', { ascending: false }),
      ]);
      // A failed query must not silently empty the panel (review 2026-07-01):
      // surface it and keep whatever was already on screen.
      if (instRes.error) window.showToast?.('Subs did not load: ' + instRes.error.message);
      else {
        // De-dupe: one logical row per installer_name with the freshest
        // active token; show as 'revoked' if no active token remains.
        const byName = new Map();
        for (const r of (instRes.data || [])) {
          const existing = byName.get(r.installer_name);
          if (!existing || (!r.revoked_at && existing.revoked_at)) byName.set(r.installer_name, r);
        }
        setInstallers([...byName.values()].sort((a, b) => a.installer_name.localeCompare(b.installer_name)));
      }
      if (payRes.error) window.showToast?.('Payouts did not load: ' + payRes.error.message);
      else setPayouts(payRes.data || []);
      if (candRes.error) window.showToast?.('Candidates did not load: ' + candRes.error.message);
      else setCandidates(candRes.data || []);
    } catch (e) {
      console.warn('[subs] refresh failed:', e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { if (open) refresh(); }, [open, refresh]);
  React.useEffect(() => {
    if (!open || !CRM.__db) return;
    const ch = CRM.__db.channel('crm-subs-popover')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_payouts' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'installer_tokens' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_candidates' }, refresh)
      .subscribe();
    return () => { CRM.__db.removeChannel(ch); };
  }, [open, refresh]);

  // Per-installer rollups: count of unpaid jobs + total amount owed.
  const rollup = React.useMemo(() => {
    const m = new Map();
    for (const p of payouts) {
      const r = m.get(p.installer_name) || { unpaidCount: 0, unpaidCents: 0, paidCount: 0, paidCents: 0, rows: [] };
      if (p.paid_at) { r.paidCount++; r.paidCents += p.amount_cents; }
      else { r.unpaidCount++; r.unpaidCents += p.amount_cents; }
      r.rows.push(p);
      m.set(p.installer_name, r);
    }
    return m;
  }, [payouts]);

  // Wrench icon, represents trade work / installers
  const wrenchIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  );

  // Total unpaid across all subs, surface as a red dot on the icon if > 0.
  const totalUnpaidCents = React.useMemo(
    () => [...rollup.values()].reduce((s, r) => s + r.unpaidCents, 0),
    [rollup]
  );

  const fmtMoney = (cents) => '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const contactName = (id) => {
    const c = (CRM.contacts || []).find(x => x.id === id);
    return c?.name || (c?.phone ? c.phone : id?.slice(0, 6));
  };

  // 1099 tax report (Key 2026-07-01: "figure out sub 1099 payments and integrate
  // with the CRM"). Per-tax-year PAID totals per installer with the $600 1099-NEC
  // threshold flag and a copyable accountant summary. Reuses this popover's
  // existing row/pill primitives (a year-grouped rollup of data the panel already
  // shows), so no fresh Claude Design comp is needed. W-9 status becomes live once
  // the banked sub_documents system deploys; until then it reads "collect".
  const [taxOpen, setTaxOpen] = React.useState(false);
  const [taxYear, setTaxYear] = React.useState(new Date().getFullYear());
  const taxRollup = React.useMemo(() => {
    const m = new Map();
    for (const p of payouts) {
      if (!p.paid_at) continue;
      if (new Date(p.paid_at).getFullYear() !== taxYear) continue;
      const r = m.get(p.installer_name) || { paidCents: 0, count: 0 };
      r.paidCents += p.amount_cents; r.count++;
      m.set(p.installer_name, r);
    }
    return [...m.entries()].sort((a, b) => b[1].paidCents - a[1].paidCents);
  }, [payouts, taxYear]);
  const taxYearsAvailable = React.useMemo(() => {
    const ys = new Set([new Date().getFullYear()]);
    for (const p of payouts) if (p.paid_at) ys.add(new Date(p.paid_at).getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [payouts]);
  const copyTaxSummary = async () => {
    const lines = [`BPP sub payments, tax year ${taxYear} (1099-NEC threshold $600)`];
    for (const [name, r] of taxRollup) {
      lines.push(`${name}: ${fmtMoney(r.paidCents)} paid across ${r.count} job${r.count === 1 ? '' : 's'}${r.paidCents >= 60000 ? ' , 1099-NEC REQUIRED' : ''} , W-9: collect/verify`);
    }
    if (taxRollup.length === 0) lines.push('No payments recorded this year.');
    try { await navigator.clipboard.writeText(lines.join('\n')); window.showToast?.('Tax summary copied'); }
    catch { window.showToast?.('Copy failed'); }
  };

  const markPaid = async (payoutId, method) => {
    if (!CRM.__invokeFn) return;
    // One tap to mark a payout paid (tap-audit #9): no blocking window.prompt
    // for an optional reference, picking the method IS the action. The
    // paid_reference is captured separately + optionally via saveReference()
    // (the inline edit affordance on a paid row below), reusing this file's
    // existing input/button controls, so it needs no fresh Claude Design comp.
    const semantic = `mark:${payoutId}:${method}`;
    const storageKey = `bpp-sub-payout:${semantic}`;
    let key = localStorage.getItem(storageKey);
    if (!key) { key = crypto.randomUUID(); localStorage.setItem(storageKey, key); }
    const { data, error } = await CRM.__invokeFn('sub-upsert', { body: {
      action:'mark_payout_paid', payout_id:payoutId, method, idempotency_key:key,
    } });
    if (error || !data?.ok) { window.showToast?.(`Mark-paid failed: ${error?.message || data?.error || 'unknown'}`); return; }
    localStorage.removeItem(storageKey);
    window.showToast?.('Marked paid');
    refresh();
  };

  const unmarkPaid = async (payoutId) => {
    if (!CRM.__invokeFn) return;
    const ok = await window.confirmAction?.({
      title:'Reopen this payout?',
      body:'Use this only to correct a payout that was marked paid by mistake. The audit history stays intact.',
      confirmLabel:'Reopen payout', destructive:true,
    });
    if (!ok) return;
    const semantic = `reopen:${payoutId}`;
    const storageKey = `bpp-sub-payout:${semantic}`;
    let key = localStorage.getItem(storageKey);
    if (!key) { key = crypto.randomUUID(); localStorage.setItem(storageKey, key); }
    const { data, error } = await CRM.__invokeFn('sub-upsert', { body: {
      action:'reopen_payout', payout_id:payoutId,
      reason:'Operator corrected payout paid status', idempotency_key:key,
    } });
    if (error || !data?.ok) { window.showToast?.(`Reopen failed: ${error?.message || data?.error || 'unknown'}`); return; }
    localStorage.removeItem(storageKey);
    window.showToast?.('Marked unpaid');
    refresh();
  };

  // tap-audit #9: optionally record a Venmo/check/etc reference on an
  // already-paid row, replacing the old blocking window.prompt. Reads the
  // uncontrolled input by ref (only one row edits at a time, keyed by
  // refEditId), so a sub_payouts realtime refresh mid-edit cannot blur it.
  const saveReference = async (payoutId) => {
    if (!CRM.__invokeFn) return;
    const val = (refInputRef.current?.value || '').trim().slice(0, 120);
    const semantic = `reference:${payoutId}:${val}`;
    const storageKey = `bpp-sub-payout:${semantic}`;
    let key = localStorage.getItem(storageKey);
    if (!key) { key = crypto.randomUUID(); localStorage.setItem(storageKey, key); }
    const { data, error } = await CRM.__invokeFn('sub-upsert', { body: {
      action:'update_payout_reference', payout_id:payoutId,
      reference:val || null, idempotency_key:key,
    } });
    if (error || !data?.ok) { window.showToast?.(`Save failed: ${error?.message || data?.error || 'unknown'}`); return; }
    localStorage.removeItem(storageKey);
    window.showToast?.(val ? 'Reference saved' : 'Reference cleared');
    setRefEditId(null);
    refresh();
  };

  const revoke = async (name) => {
    if (!CRM.__db) return;
    const ok = await window.confirmAction?.({
      title: `Revoke ${name}'s access?`,
      body: `Their /sub/ link will stop working. Payout history stays.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
    try {
      const { data, error } = await CRM.__invokeFn('sub-revoke', { body: { name } });
      if (error) {
        let detail = error?.message || 'unknown';
        try { const body = await error.context?.json?.(); if (body?.error) detail = body.error; } catch {}
        window.showToast?.(`Revoke failed: ${detail}`); return;
      }
      window.showToast?.(`${name} revoked`);
      refresh();
    } catch (e) {
      window.showToast?.(`Revoke threw: ${e.message}`);
    }
  };

  // Revoke's inverse (audit rank 25): reactivate the most recently revoked
  // token so the sub's OLD bookmarked /sub/ link works again. Direct table
  // write only, no edge fn and NO SMS path anywhere (a token rotation with
  // a fresh link stays the sub-create flow). Older revoked rows stay dead.
  const restore = async (name) => {
    if (!CRM.__db) return;
    const ok = await window.confirmAction?.({
      title: `Restore ${name}'s access?`,
      body: `Their previous /sub/ link starts working again. No text is sent.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    try {
      const { data: active, error: aErr } = await CRM.__db.from('installer_tokens')
        .select('id').eq('installer_name', name).is('revoked_at', null).limit(1);
      if (aErr) { window.showToast?.(`Restore failed: ${aErr.message}`); return; }
      if (active && active.length) { window.showToast?.(`${name} already has an active link`); refresh(); return; }
      const { data: last, error: lErr } = await CRM.__db.from('installer_tokens')
        .select('id').eq('installer_name', name).not('revoked_at', 'is', null)
        .order('revoked_at', { ascending: false }).limit(1);
      if (lErr || !last || !last.length) { window.showToast?.(`Restore failed: ${lErr?.message || 'no revoked link found'}`); return; }
      const { error } = await CRM.__db.from('installer_tokens')
        .update({ revoked_at: null }).eq('id', last[0].id);
      if (error) { window.showToast?.(`Restore failed: ${error.message}`); return; }
      window.showToast?.(`${name} restored, previous link active`);
      refresh();
    } catch (e) {
      window.showToast?.(`Restore threw: ${e.message}`);
    }
  };

  // ── Recruiting bench mutators ─────────────────────────────────────
  // Direct authenticated writes to sub_candidates (RLS: authenticated_all;
  // the public path in is only the sub-apply edge fn). No sends anywhere.
  // Zero-row updates are failures too (review 2026-07-01): .select() makes
  // supabase return the touched rows, so a vanished id can't fake success.
  const patchCandidate = async (id, patch, toast, undoPatch) => {
    if (!CRM.__db) return false;
    const { data, error } = await CRM.__db.from('sub_candidates')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('id');
    if (error || !data || !data.length) { window.showToast?.(`Save failed: ${error ? error.message : 'row not found'}`); return false; }
    if (toast) {
      window.showToast?.(toast, undoPatch ? {
        undo: async () => {
          await CRM.__db.from('sub_candidates')
            .update({ ...undoPatch, updated_at: new Date().toISOString() }).eq('id', id);
          refresh();
        },
        duration: 5000,
      } : undefined);
    }
    refresh();
    return true;
  };
  const saveLicense = async (candId) => {
    const val = (licInputRef.current && licInputRef.current.value || '').trim().slice(0, 40);
    if (!val) { setLicEditId(null); return; }
    const ok = await patchCandidate(candId, { sc_license: val }, 'License added');
    if (ok) setLicEditId(null);
  };
  const declineCandidate = async (cand) => {
    const ok = await window.confirmAction?.({
      title: `Decline ${cand.name}?`,
      body: 'They move to Past candidates. No message is sent.',
      confirmLabel: 'Decline', destructive: true,
    });
    if (!ok) return;
    patchCandidate(cand.id, { stage: 'declined' }, `${cand.name} declined`, { stage: cand.stage });
  };
  // applied -> screened -> test_install -> active. 'active' marks the
  // recruiting record AND opens Add sub prefilled (review 2026-07-01: the
  // toast-only handoff dropped the baton and made Key re-type known data).
  // Token issue stays the explicit Add-sub submit, never a side effect.
  const CAND_NEXT = { applied: 'screened', screened: 'test_install', test_install: 'active' };
  const CAND_ADVANCE_LABEL = { applied: 'Mark screened', screened: 'Start test install', test_install: 'Make active sub' };
  const advanceCandidate = async (cand) => {
    const next = CAND_NEXT[cand.stage];
    if (!next) return;
    const wrote = await patchCandidate(cand.id, { stage: next },
      next === 'active' ? `${cand.name} is active` : `${cand.name}: ${next.replace('_', ' ')}`,
      { stage: cand.stage });
    if (wrote && next === 'active') {
      setAddSeed({ name: cand.name || '', phone: cand.phone || '', notes: [cand.sc_license ? `SC lic ${cand.sc_license}` : null, cand.capacity_per_month ? `wants ${cand.capacity_per_month}/mo` : null, cand.service_areas || null].filter(Boolean).join(' · ') });
      setAddOpen(true);
    }
  };
  // Insurance ladder: labels are the NEXT ACTION, every step toasts the new
  // state, and leaving 'verified' requires a confirm (review 2026-07-01: the
  // old cycle labeled the current state and silently wrapped verified->none).
  const INS_ADVANCE = {
    none:         { next: 'claimed',      label: 'Mark ins claimed',  toast: 'Insurance: claimed' },
    claimed:      { next: 'coi_received', label: 'Mark COI received', toast: 'Insurance: COI received' },
    coi_received: { next: 'verified',     label: 'Mark ins verified', toast: 'Insurance: verified' },
  };
  const advanceInsurance = async (cand) => {
    if (cand.insurance_status === 'verified') {
      const ok = await window.confirmAction?.({
        title: `Reset ${cand.name}'s insurance to none?`,
        body: 'Their COI was marked verified. Only reset if that was a mistake.',
        confirmLabel: 'Reset', destructive: true,
      });
      if (!ok) return;
      patchCandidate(cand.id, { insurance_status: 'none' }, 'Insurance reset to none', { insurance_status: 'verified' });
      return;
    }
    const step = INS_ADVANCE[cand.insurance_status] || INS_ADVANCE.none;
    patchCandidate(cand.id, { insurance_status: step.next }, step.toast, { insurance_status: cand.insurance_status });
  };

  // Same breakpoint as the todos popover (crm-todos.jsx): under 480px the
  // anchored 360px popover bleeds past the viewport edge, so it switches to
  // a viewport-locked drawer.
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 480;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Trigger pill, only when NOT in host mode (host opens via the tab-bar
          long-press of the Calendar icon). The red unpaid-payout dot lives on
          this pill; in host mode it is NOT shown (TODO follow-up: surface the
          unpaid-subs total as the Calendar tab badge so money-at-risk stays
          glanceable). The total is still visible inside the popover. */}
      {!asHost && (
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Subs"
        title="Subs"
        style={{
          flex: '0 0 auto', height: 44, padding: '0 10px', borderRadius: 100,
          background: open ? '#F0F4FF' : 'white',
          border: '1px solid #e5e5e5',
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
          fontSize: 13, fontWeight: 600, color: '#5a6478', fontFamily: 'inherit',
          transition: 'border-color 180ms cubic-bezier(0.16,1,0.3,1), color 180ms cubic-bezier(0.16,1,0.3,1)',
          WebkitTapHighlightColor: 'transparent',
          position: 'relative',
        }}
      >
        Subs
        {totalUnpaidCents > 0 && (
          <span title={`${fmtMoney(totalUnpaidCents)} owed across all subs`}
            style={{
              position: 'absolute', top: 4, right: 8, width: 10, height: 10,
              borderRadius: '50%', background: '#dc2626', border: '2px solid white',
            }}/>
        )}
      </button>
      )}

      {open && (
        <div style={(isMobile || asHost) ? {
          // Mobile: full-screen-width drawer, mirroring the todos popover
          // (crm-todos.jsx). CRITICAL: the mobile-panel ancestor has
          // `transform`, which makes it the containing block for
          // position:fixed (CSS spec). So we can't use right:N, that anchors
          // to the 200%-wide swiping parent, not the viewport. Use vw for
          // width + left for position so the popover stays viewport-locked.
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top) + 96px)',
          left: 8,
          width: 'calc(100vw - 16px)',
          background: 'white',
          border: '1px solid rgba(27,43,75,0.12)',
          borderRadius: 12,
          boxShadow: '0 12px 32px rgba(27,43,75,0.22)',
          padding: 14, zIndex: 50,
          maxHeight: 'calc(var(--vvh, 100vh) - 96px - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px)',
          display: 'flex', flexDirection: 'column',
        } : {
          // Desktop: original anchored popover
          position: 'absolute', right: 0, top: 'calc(100% + 6px)',
          width: 360,
          background: 'white',
          border: '1px solid rgba(27,43,75,0.12)',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(27,43,75,0.16)',
          padding: 14, zIndex: 50,
          maxHeight: 'calc(var(--vvh, 100vh) - 96px - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>
              Subs {installers.length > 0 ? `(${installers.filter(i => !i.revoked_at).length})` : ''}
            </span>
            <button
              onClick={() => setAddOpen(true)}
              style={{ background: GOLD, color: NAVY, border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >+ Add sub</button>
          </div>

          {loading && installers.length === 0 && <div style={{ fontSize: 12, color: MUTED, padding: '12px 0' }}>Loading…</div>}
          {!loading && installers.length === 0 && (
            <div style={{ fontSize: 12, color: MUTED, padding: '12px 0', lineHeight: 1.5 }}>
              No subs yet. Tap + Add sub to onboard your first installer.
            </div>
          )}

          <div style={{ overflowY: 'auto', flex: 1, marginRight: -4 }}>
            {installers.map(inst => {
              const r = rollup.get(inst.installer_name) || { unpaidCount: 0, unpaidCents: 0, paidCount: 0, paidCents: 0, rows: [] };
              const isExpanded = expanded === inst.installer_name;
              const revoked = !!inst.revoked_at;
              return (
                <div key={inst.installer_name} style={{
                  padding: '10px 0', borderTop: '1px solid #F0EFEA',
                  opacity: revoked ? 0.55 : 1,
                }}>
                  <div onClick={() => setExpanded(isExpanded ? null : inst.installer_name)} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    cursor: 'pointer', gap: 8,
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {inst.installer_name}
                        {revoked && <span style={{ fontSize: 9, fontWeight: 700, color: '#991B1B', background: '#FEF2F2', padding: '1px 5px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Revoked</span>}
                      </div>
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
                        {inst.installer_phone || 'no phone'} · {r.paidCount + r.unpaidCount} job{r.paidCount + r.unpaidCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {r.unpaidCents > 0 ? (
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#dc2626' }}>{fmtMoney(r.unpaidCents)}</div>
                      ) : (
                        <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>$0</div>
                      )}
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
                        {r.unpaidCount > 0 ? `${r.unpaidCount} unpaid` : 'all paid'}
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #E5E5E0' }}>
                      {r.rows.length === 0 && <div style={{ fontSize: 11, color: MUTED, padding: '4px 0' }}>No completed installs yet.</div>}
                      {[...r.rows].sort((a, b) => (a.paid_at ? 1 : 0) - (b.paid_at ? 1 : 0)).slice(0, showAllSubs[inst.installer_name] ? r.rows.length : 12).map(p => (
                        <div key={p.id} style={{ padding: '8px 0', borderTop: '1px solid #F2F2EF' }}>
                          {/* CRM revamp T1-7: two-line payout row , line1 name + date, line2 mono money + 44px pay control. Color carries paid (green) vs unpaid (red); dotted-underline link dropped. Folds in the T1-2-deferred control sizing. */}
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                            <a onClick={(e) => { e.stopPropagation(); window.location.search = `?c=${p.contact_id}`; }}
                              style={{ color: NAVY, fontWeight: 600, fontSize: 13, textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                              {contactName(p.contact_id)}
                            </a>
                            <span style={{ color: '#9ca3af', fontSize: 11, flexShrink: 0, fontFamily: "'DM Mono', monospace" }}>{fmtDate(p.completed_at)}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                              <span style={{ fontWeight: 700, fontSize: 14, color: p.paid_at ? '#16a34a' : '#dc2626', fontFamily: "'JetBrains Mono','DM Mono',monospace" }}>
                                {fmtMoney(p.amount_cents)}
                              </span>
                              {/* Surface the payout method inline (audit #42): it
                                  was only in a hover title, invisible on touch. */}
                              {p.paid_at && p.paid_method && (
                                <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>· {({ venmo: 'Venmo', cashapp: 'Cash App', cash: 'Cash', check: 'Check', other: 'Other' }[p.paid_method] || p.paid_method)}</span>
                              )}
                            </span>
                            {p.paid_at ? (
                              <button onClick={() => unmarkPaid(p.id)} title={`Paid ${p.paid_method || ''} ${p.paid_reference || ''}`}
                                style={{ minHeight: 44, background: 'transparent', border: '1px solid rgba(22,163,74,0.4)', color: '#16a34a', borderRadius: 8, padding: '0 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                                ✓ Paid
                              </button>
                            ) : (
                              <select onChange={(e) => { if (e.target.value) markPaid(p.id, e.target.value); e.target.value = ''; }}
                                style={{ minHeight: 44, background: GOLD, border: 'none', borderRadius: 8, padding: '0 12px', fontSize: 16, fontWeight: 700, color: NAVY, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0 }}>
                                <option value="">Pay…</option>
                                <option value="venmo">Venmo</option>
                                <option value="cashapp">Cash App</option>
                                <option value="cash">Cash</option>
                                <option value="check">Check</option>
                                <option value="other">Other</option>
                              </select>
                            )}
                          </div>
                          {/* tap-audit #9: optional reference on a paid row. Reuses this
                              file's input/button styling (44px control, 16px input) so it
                              needs no fresh comp. Trigger is a quiet text link by default to
                              keep the dense popover calm; it expands to an inline editor. */}
                          {p.paid_at && (
                            refEditId === p.id ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                                <input ref={refInputRef} defaultValue={p.paid_reference || ''} autoFocus
                                  placeholder="Reference (optional)"
                                  onKeyDown={(e) => { if (e.key === 'Enter') saveReference(p.id); if (e.key === 'Escape') setRefEditId(null); }}
                                  style={{ flex: 1, minWidth: 0, height: 44, fontSize: 16, border: '1px solid #e5e5e5', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', color: NAVY, background: 'white', boxSizing: 'border-box' }} />
                                <button onClick={() => saveReference(p.id)}
                                  style={{ height: 44, background: GOLD, color: NAVY, border: 'none', borderRadius: 8, padding: '0 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Save</button>
                              </div>
                            ) : (
                              <button onClick={() => setRefEditId(p.id)}
                                style={{ marginTop: 3, background: 'transparent', border: 'none', padding: '4px 0', fontSize: 11, color: p.paid_reference ? MUTED : '#9ca3af', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {p.paid_reference ? `Ref: ${p.paid_reference}` : '+ Add reference'}
                              </button>
                            )
                          )}
                        </div>
                      ))}
                      {r.rows.length > 12 && !showAllSubs[inst.installer_name] && (
                        <button onClick={() => setShowAllSubs(s => ({ ...s, [inst.installer_name]: true }))}
                          style={{ marginTop: 8, minHeight: 44, width: '100%', background: 'transparent', border: '1px dashed rgba(27,43,75,0.25)', color: NAVY, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Show all {r.rows.length} jobs ({r.rows.length - 12} more)
                        </button>
                      )}
                      {!revoked && (
                        <button onClick={() => revoke(inst.installer_name)} style={{
                          marginTop: 8, minHeight: 44, background: 'transparent', border: '1px solid rgba(220,38,38,0.4)',
                          color: '#dc2626', borderRadius: 8, padding: '0 14px',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>Revoke access</button>
                      )}
                      {revoked && (
                        <button onClick={() => restore(inst.installer_name)} style={{
                          marginTop: 8, minHeight: 44, background: 'transparent', border: '1px solid rgba(27,43,75,0.35)',
                          color: NAVY, borderRadius: 8, padding: '0 14px',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>Restore access</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Recruiting bench (Operating Model 2026 build #1): candidates from
                the public sub-apply intake, screened here. Reuses the installer
                row + pill + outline-button primitives, no fresh comp. Only
                non-terminal stages render; the section vanishes when empty. */}
            {(() => {
              const bench = candidates.filter(c => ['applied', 'screened', 'test_install'].includes(c.stage));
              if (!bench.length) return null;
              const STAGE_PILL = {
                applied:      { bg: '#EFF6FF', fg: '#1D4ED8', label: 'Applied' },
                screened:     { bg: '#FEF3C7', fg: '#92400E', label: 'Screened' },
                test_install: { bg: '#ECFDF5', fg: '#065F46', label: 'Test install' },
              };
              return (
                <div style={{ borderTop: '1px solid #F0EFEA', marginTop: 4, paddingTop: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 2 }}>
                    Candidates ({bench.length})
                  </div>
                  {bench.map(cand => {
                    const isExp = candExpanded === cand.id;
                    const pill = STAGE_PILL[cand.stage];
                    return (
                      <div key={cand.id} style={{ padding: '10px 0', borderTop: '1px solid #F2F2EF' }}>
                        <div onClick={() => setCandExpanded(isExp ? null : cand.id)} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                          cursor: 'pointer', gap: 8, minHeight: 44,
                        }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {cand.name}
                              <span style={{ fontSize: 9, fontWeight: 700, color: pill.fg, background: pill.bg, padding: '1px 5px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{pill.label}</span>
                            </div>
                            <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
                              {[cand.phone ? formatPhone(cand.phone) : 'no phone',
                                cand.capacity_per_month ? `wants ${cand.capacity_per_month}/mo` : null,
                                cand.service_areas || null].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        </div>
                        {isExp && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #E5E5E0' }}>
                            <div style={{ fontSize: 12, color: NAVY, lineHeight: 1.7 }}>
                              {cand.business_name && <div>Business: <strong>{cand.business_name}</strong></div>}
                              <div>License: <strong>{cand.sc_license || 'not given'}</strong>{cand.license_verified ? ' (verified)' : ''}</div>
                              {cand.years_experience && <div>Experience: <strong>{cand.years_experience}</strong></div>}
                              {cand.email && <div>Email: <strong>{cand.email}</strong></div>}
                              <div style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>
                                Applied {fmtDate(cand.created_at)} via {cand.source}
                              </div>
                              {cand.notes && <div style={{ marginTop: 4, fontSize: 11, color: MUTED }}>{cand.notes}</div>}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                              {cand.sc_license && (
                                <button onClick={() => patchCandidate(cand.id, { license_verified: !cand.license_verified }, cand.license_verified ? 'License unverified' : 'License marked verified')} style={{
                                  minHeight: 44, background: cand.license_verified ? '#ECFDF5' : 'transparent',
                                  border: `1px solid ${cand.license_verified ? '#065F46' : 'rgba(27,43,75,0.35)'}`,
                                  color: cand.license_verified ? '#065F46' : NAVY, borderRadius: 8, padding: '0 12px',
                                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                                }}>{cand.license_verified ? 'License verified' : 'Verify license'}</button>
                              )}
                              {!cand.sc_license && licEditId !== cand.id && (
                                <button onClick={() => setLicEditId(cand.id)} style={{
                                  minHeight: 44, background: 'transparent', border: '1px solid rgba(27,43,75,0.35)',
                                  color: NAVY, borderRadius: 8, padding: '0 12px',
                                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                                }}>+ Add license</button>
                              )}
                              {licEditId === cand.id && (
                                /* Inline add for a license that arrived after the
                                   application (review 2026-07-01: the verify checkpoint
                                   was unreachable with no editor). Same uncontrolled-
                                   input-by-ref pattern as the payout reference edit. */
                                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                  <input ref={licInputRef} autoFocus placeholder="SC license #"
                                    onKeyDown={e => { if (e.key === 'Escape') setLicEditId(null); if (e.key === 'Enter') saveLicense(cand.id); }}
                                    style={{ minHeight: 44, fontSize: 16, padding: '0 10px', border: '1px solid rgba(27,43,75,0.3)', borderRadius: 8, fontFamily: 'inherit', width: 140, color: NAVY }} />
                                  <button onClick={() => saveLicense(cand.id)} style={{
                                    minHeight: 44, background: NAVY, border: 'none', color: '#fff', borderRadius: 8,
                                    padding: '0 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                                  }}>Save</button>
                                </span>
                              )}
                              <button onClick={() => advanceInsurance(cand)} style={{
                                minHeight: 44, background: cand.insurance_status === 'verified' ? '#ECFDF5' : 'transparent',
                                border: `1px solid ${cand.insurance_status === 'verified' ? '#065F46' : 'rgba(27,43,75,0.35)'}`,
                                color: cand.insurance_status === 'verified' ? '#065F46' : NAVY, borderRadius: 8, padding: '0 12px',
                                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                              }}>{cand.insurance_status === 'verified' ? 'Ins verified (reset)' : (INS_ADVANCE[cand.insurance_status] || INS_ADVANCE.none).label}</button>
                              {CAND_NEXT[cand.stage] && (
                                <button onClick={() => advanceCandidate(cand)} style={{
                                  minHeight: 44, background: NAVY, border: 'none', color: '#fff',
                                  borderRadius: 8, padding: '0 14px', fontSize: 12, fontWeight: 700,
                                  cursor: 'pointer', fontFamily: 'inherit',
                                }}>{CAND_ADVANCE_LABEL[cand.stage]}</button>
                              )}
                              <button onClick={() => declineCandidate(cand)} style={{
                                minHeight: 44, background: 'transparent', border: '1px solid rgba(220,38,38,0.4)',
                                color: '#dc2626', borderRadius: 8, padding: '0 12px',
                                fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                              }}>Decline</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Past candidates (review 2026-07-01): terminal stages are not a
                black hole. Declined/benched get Reopen (back to screened);
                active rows point at Add sub. Reuses the 1099 disclosure
                pattern; hidden entirely when there is nothing past. */}
            {(() => {
              const past = candidates.filter(c => ['active', 'declined', 'benched'].includes(c.stage));
              if (!past.length) return null;
              return (
                <div style={{ borderTop: '1px solid #F0EFEA', marginTop: 4, paddingTop: 6, paddingBottom: 6 }}>
                  <button onClick={() => setPastOpen(!pastOpen)} style={{
                    width: '100%', minHeight: 44, background: 'transparent', border: 'none', padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>Past candidates ({past.length})</span>
                    <span style={{ fontSize: 11, color: MUTED }}>{pastOpen ? 'Hide' : 'Show'}</span>
                  </button>
                  {pastOpen && past.map(cand => (
                    <div key={cand.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid #F7F6F2' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cand.name}</div>
                        <div style={{ fontSize: 11, color: MUTED }}>{cand.stage === 'active' ? 'active, add them with Add sub if not done' : cand.stage}{cand.phone ? ' · ' + formatPhone(cand.phone) : ''}</div>
                      </div>
                      {cand.stage !== 'active' && (
                        <button onClick={() => patchCandidate(cand.id, { stage: 'screened' }, `${cand.name} back on the bench`, { stage: cand.stage })} style={{
                          minHeight: 44, background: 'transparent', border: '1px solid rgba(27,43,75,0.35)',
                          color: NAVY, borderRadius: 8, padding: '0 12px', flexShrink: 0,
                          fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        }}>Reopen</button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* 1099 tax report (Key 2026-07-01): year-grouped PAID rollup for the
                accountant. Collapsed by default to keep the popover calm; reuses
                the existing row/pill primitives, no fresh Claude Design comp. */}
            <div style={{ borderTop: '1px solid #F0EFEA', marginTop: 4, paddingTop: 6, paddingBottom: 6 }}>
              <button onClick={() => setTaxOpen(!taxOpen)} style={{
                width: '100%', minHeight: 44, background: 'transparent', border: 'none', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>1099 tax report</span>
                <span style={{ fontSize: 11, color: MUTED }}>{taxOpen ? 'Hide' : 'Show'}</span>
              </button>
              {taxOpen && (
                <div style={{ paddingTop: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: MUTED }}>Tax year</span>
                    <select value={taxYear} onChange={e => setTaxYear(Number(e.target.value))} style={{
                      fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: NAVY,
                      border: '1px solid rgba(27,43,75,0.2)', borderRadius: 6, padding: '4px 8px',
                      background: '#fff', minHeight: 32,
                    }}>
                      {taxYearsAvailable.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <button onClick={copyTaxSummary} style={{
                      marginLeft: 'auto', minHeight: 32, background: 'transparent',
                      border: '1px solid rgba(27,43,75,0.25)', color: NAVY, borderRadius: 6,
                      padding: '0 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    }}>Copy for accountant</button>
                  </div>
                  {taxRollup.length === 0 && (
                    <div style={{ fontSize: 12, color: MUTED, padding: '4px 0 8px' }}>No payments recorded in {taxYear}.</div>
                  )}
                  {taxRollup.map(([name, r]) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid #F7F6F2' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                        <div style={{ fontSize: 11, color: MUTED }}>{r.count} job{r.count === 1 ? '' : 's'} · W-9: collect</div>
                      </div>
                      {r.paidCents >= 60000 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 10, padding: '2px 8px', flexShrink: 0 }}>1099-NEC</span>
                      )}
                      <span style={{ fontSize: 12, fontWeight: 700, color: NAVY, flexShrink: 0 }}>{fmtMoney(r.paidCents)}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.5, paddingTop: 6 }}>
                    1099-NEC applies at $600+ paid per calendar year. File by Jan 31. Ask the accountant whether the $75 permit portion counts as a documented reimbursement.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {addOpen && <AddSubModal initial={addSeed} onClose={() => { setAddOpen(false); setAddSeed(null); refresh(); }} />}
    </div>
  );
}

function AddSubModal({ onClose, initial }) {
  const [name, setName] = React.useState((initial && initial.name) || '');
  const [phone, setPhone] = React.useState((initial && initial.phone) || '');
  const [notes, setNotes] = React.useState((initial && initial.notes) || '');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!name.trim()) { window.showToast?.('Name required'); return; }
    if (busy) return;
    setBusy(true);
    try {
      // Legacy path: sub-create + /sub/?token= schedule portal. The edge fn
      // was retired in the 2026-07 sub-offer rebuild (not deployed; 404). Prefer
      // the Subs tab (sub-upsert + /subs/apply/) for new contractors.
      const { data, error } = await CRM.__invokeFn('sub-create', {
        body: { name: name.trim(), phone: phone.trim(), notes: notes.trim() },
      });
      if (error) {
        let detail = error?.message || 'unknown';
        let status = error?.context?.status ?? error?.status;
        try {
          const body = await error.context?.json?.();
          if (body?.error) detail = body.error;
          if (body?.code === 'NOT_FOUND') status = 404;
        } catch {}
        if (status === 404 || /not found/i.test(String(detail))) {
          window.showToast?.('Legacy Add Sub is offline. Use the Subs tab to add a contractor (sends /subs/apply/ onboarding).');
        } else {
          window.showToast?.(`Add failed: ${detail}`);
        }
        setBusy(false); return;
      }
      setResult(data); setBusy(false);
    } catch (err) {
      window.showToast?.(`Add threw: ${err.message}`); setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!result?.token) return;
    // Still copies the legacy schedule URL if sub-create somehow returned a
    // token; live create is 404 so this path is unreachable until redeploy.
    const url = `https://qa.backuppowerpro.com/sub/?token=${result.token}`;
    try {
      await navigator.clipboard.writeText(url);
      window.showToast?.('Link copied (legacy schedule). Prefer Subs tab job links for new work.');
    } catch {
      window.showToast?.('Copy failed, scroll to read');
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      height: 'var(--vvh, 100dvh)',
      background: 'rgba(11,31,59,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 10000, padding: 'max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 400, maxWidth: '100%',
        maxHeight: 'calc(var(--vvh, 100dvh) - 40px - env(safe-area-inset-top) - env(safe-area-inset-bottom))', overflowY: 'auto',
        background: 'white', borderRadius: 12, padding: 20,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Add a sub</div>
        {!result ? (
          <form onSubmit={submit}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Name</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Marcus J."
              style={{ width: '100%', height: 44, padding: '0 12px', border: '1.5px solid #EBEBEA', borderRadius: 8, fontSize: 16, color: NAVY, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 12 }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Phone (welcome SMS sent here)</div>
            <input value={phone} onChange={e => setPhone(window.formatPhoneInput ? window.formatPhoneInput(e.target.value) : e.target.value)} placeholder="(864) 555-0123" type="tel" inputMode="tel" autoComplete="tel"
              style={{ width: '100%', height: 44, padding: '0 12px', border: '1.5px solid #EBEBEA', borderRadius: 8, fontSize: 16, color: NAVY, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 12 }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Notes (private)</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Licensed, insured, day rate $400, prefers afternoon installs"
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #EBEBEA', borderRadius: 8, fontSize: 16, color: NAVY, outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 14 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} disabled={busy}
                style={{ minHeight: 44, background: 'transparent', border: '1px solid rgba(11,31,59,0.15)', color: NAVY, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button type="submit" disabled={busy || !name.trim()}
                style={{ minHeight: 44, background: busy || !name.trim() ? '#E5E5E5' : GOLD, color: busy || !name.trim() ? '#999' : NAVY, border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: busy || !name.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {busy ? 'Adding…' : 'Add + send link'}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <div style={{ background: result.smsSent || !result.phone ? '#D1FAE5' : '#FEF3C7', border: '1px solid ' + (result.smsSent || !result.phone ? '#6EE7B7' : '#FCD34D'), color: result.smsSent || !result.phone ? '#065F46' : '#92400E', padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
              {result.name} added.{' '}
              {result.smsSent && `Welcome SMS sent to ${result.phone}.`}
              {!result.phone && '(No phone provided, hand-deliver the link below.)'}
              {result.phone && !result.smsSent && (
                <span>
                  Welcome SMS did NOT send{result.smsError ? ` (${result.smsError.slice(0, 80)})` : ''}.
                  {' '}Copy the link below and send it manually.
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Their portal link</div>
            <div style={{ background: '#F8F8F6', border: '1px solid #EBEBEA', borderRadius: 8, padding: '10px 12px', fontFamily: 'DM Mono, monospace', fontSize: 12, color: NAVY, wordBreak: 'break-all', marginBottom: 12 }}>
              https://qa.backuppowerpro.com/sub/?token={result.token}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={copyLink}
                style={{ minHeight: 44, background: GOLD, color: NAVY, border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Copy link</button>
              <button onClick={onClose}
                style={{ minHeight: 44, background: NAVY, color: 'white', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { SubsButton });
