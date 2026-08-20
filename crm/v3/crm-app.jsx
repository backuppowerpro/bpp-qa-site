// crm-app.jsx, Root component + mount

// SignInGate, direct email/password sign-in into the same Supabase
// project. Replaces the prior "go sign in on v2 first" splash since v2
// is being retired. After a successful sign-in the page reloads so the
// data loader runs from scratch with the new session.
function SignInGate() {
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setErr('');
    if (!email.trim() || !pw) { setErr('Email and password required'); return; }
    if (!window.CRM?.__db) { setErr('Supabase not loaded, refresh and try again'); return; }
    setBusy(true);
    try {
      const { error } = await window.CRM.__db.auth.signInWithPassword({
        email: email.trim(),
        password: pw,
      });
      if (error) {
        setErr(error.message || 'Sign in failed');
        setBusy(false);
        return;
      }
      // Fresh page so the data loader picks up the new session cleanly.
      window.location.reload();
    } catch (e2) {
      setErr(String(e2?.message || e2));
      setBusy(false);
    }
  };

  return (
    <div style={{ height:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f4f6f9', fontFamily:'DM Sans', padding:24 }}>
      <form onSubmit={submit} style={{
        background:'white', border:'1px solid rgba(11,31,59,0.10)', borderRadius:12,
        padding:'28px 24px', maxWidth:360, width:'100%',
        boxShadow:'0 8px 24px rgba(11,31,59,0.06)',
        display:'flex', flexDirection:'column', gap:14,
      }}>
        <div style={{ textAlign:'center', fontSize:22, fontWeight:700, color:'#0b1f3b', marginBottom:4 }}>
          BPP CRM
        </div>
        <div style={{ textAlign:'center', fontSize:13, color:'#6B7280', marginBottom:6 }}>
          Sign in to continue
        </div>
        <label style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <span style={{ fontSize:11, fontWeight:600, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>Email</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            style={{ height:44, padding:'0 12px', border:'1.5px solid #EBEBEA', borderRadius:8, fontSize:16, color:'#0b1f3b', outline:'none', fontFamily:'inherit', background:'white' }}
          />
        </label>
        <label style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <span style={{ fontSize:11, fontWeight:600, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={busy}
            style={{ height:44, padding:'0 12px', border:'1.5px solid #EBEBEA', borderRadius:8, fontSize:16, color:'#0b1f3b', outline:'none', fontFamily:'inherit', background:'white' }}
          />
        </label>
        {err && (
          <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#991B1B', padding:'8px 12px', borderRadius:8, fontSize:12 }}>
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          style={{
            height:46, marginTop:6, borderRadius:8,
            background: busy ? '#E5E5E5' : '#ffba00',
            color: busy ? '#999' : '#0b1f3b',
            border:'none', fontSize:15, fontWeight:700, fontFamily:'inherit',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// Hold-to-switch maps (Key 2026-07-10): the top Contacts/Subs + Messages/Calls
// toggles were removed; holding the merged tab flips its subtab instead. The
// BROWSE (left/list) bar flips Contacts<->Subs and Messages<->Calls. The DETAIL
// (right/record) bar flips only Messages<->Calls (Subs stays its own tab there);
// its Contacts + Calendar holds keep their existing tool actions. Distinct action
// names so the browse-comms and detail-comms holds route to different state.
const BROWSE_HOLD = { contacts: 'switch-contacts', comms: 'switch-comms', calendar: 'quickquote' };
const DETAIL_HOLD = { contacts: 'permits', comms: 'switch-comms-detail', calendar: 'quickquote' };

function Root() {
  // Live-data load state, flips true after crm-data.js dispatches 'crm-data-ready'.
  const [loaded, setLoaded] = React.useState(window.CRM?.loaded === true);
  const [authed, setAuthed] = React.useState(window.CRM?.authed === true);
  React.useEffect(() => {
    const onReady = (e) => {
      setLoaded(true);
      setAuthed(!!e.detail?.authed);
      // One-time backfill: migrate any localStorage tags map → contacts.tags
      // Same bug class as the pin backfill below, caught by audit-crm
      // 2026-05-09. Idempotent: subsequent loads find an empty key
      // and no-op.
      try {
        const tagRaw = localStorage.getItem('bpp_v3_tags');
        if (tagRaw) {
          const map = JSON.parse(tagRaw);
          if (map && typeof map === 'object') {
            const liveContacts = window.CRM?.contacts || [];
            const writes = [];
            for (const [cid, tags] of Object.entries(map)) {
              if (!Array.isArray(tags) || tags.length === 0) continue;
              const c = liveContacts.find(x => x.id === cid);
              if (!c) continue;
              const merged = Array.from(new Set([...(c.tags || []), ...tags]));
              if (merged.length === (c.tags || []).length) continue;
              c.tags = merged; // optimistic
              writes.push(window.CRM?.__db?.from('contacts').update({ tags: merged }).eq('id', cid));
            }
            if (writes.length > 0) {
              Promise.all(writes).then((results) => {
                const failed = results.filter(r => r && r.error);
                if (failed.length === 0) {
                  localStorage.removeItem('bpp_v3_tags');
                  console.log(`[CRM] migrated tags on ${writes.length} contacts from localStorage to DB`);
                } else {
                  console.warn('[CRM] tags backfill partial:', failed.length, 'of', writes.length, 'failed');
                }
                window.dispatchEvent(new CustomEvent('crm-data-changed'));
                window.dispatchEvent(new CustomEvent('crm-tags-changed'));
              });
            } else {
              localStorage.removeItem('bpp_v3_tags');
            }
          } else {
            localStorage.removeItem('bpp_v3_tags');
          }
        }
      } catch (err) {
        console.warn('[CRM] tags backfill error:', err?.message || err);
      }

      // One-time backfill: migrate any localStorage pins → contacts.pinned
      // so users who starred contacts before the column existed don't
      // lose their pins. Runs once at first load after this ships;
      // subsequent loads find an empty localStorage and no-op.
      try {
        const raw = localStorage.getItem('bpp_v3_pinned_contacts');
        if (!raw) return;
        const ids = JSON.parse(raw);
        if (!Array.isArray(ids) || ids.length === 0) {
          localStorage.removeItem('bpp_v3_pinned_contacts');
          return;
        }
        // Only backfill ids whose live contact row isn't already pinned.
        const liveContacts = window.CRM?.contacts || [];
        const toUpdate = ids.filter(id => {
          const c = liveContacts.find(x => x.id === id);
          return c && !c.pinned;
        });
        if (toUpdate.length > 0 && window.CRM?.__db) {
          window.CRM.__db.from('contacts')
            .update({ pinned: true })
            .in('id', toUpdate)
            .then(({ error }) => {
              if (error) {
                console.warn('[CRM] pinned backfill failed (will retry next load):', error.message);
                return;
              }
              // Mirror into local state so the UI updates immediately
              for (const id of toUpdate) {
                const c = liveContacts.find(x => x.id === id);
                if (c) c.pinned = true;
              }
              window.dispatchEvent(new CustomEvent('crm-pin-changed'));
              window.dispatchEvent(new CustomEvent('crm-data-changed'));
              localStorage.removeItem('bpp_v3_pinned_contacts');
              console.log(`[CRM] migrated ${toUpdate.length} pinned contacts from localStorage to DB`);
            });
        } else {
          // Either nothing to migrate or every id was already pinned in
          // DB. Either way, drop the localStorage record so we don't
          // keep retrying.
          localStorage.removeItem('bpp_v3_pinned_contacts');
        }
      } catch (err) {
        console.warn('[CRM] pinned backfill error:', err?.message || err);
      }
    };
    window.addEventListener('crm-data-ready', onReady);
    return () => window.removeEventListener('crm-data-ready', onReady);
  }, []);
  // Realtime: bump on any data change (contacts/messages) so derived views re-render.
  React.useEffect(() => {
    const onChange = () => setBump(n => n + 1);
    window.addEventListener('crm-data-changed', onChange);
    return () => window.removeEventListener('crm-data-changed', onChange);
  }, []);

  // Left panel has its own tab state
  const [leftTab, setLeftTab] = React.useState('contacts');
  // iOS Phase 1 (Key 2026-07-09): the bottom floating pill has 5 primary
  // tabs (Contacts, Comms, Finance, Calendar, Subs). Old Messages + Calls
  // merge into Comms. The underlying leftTab/rightTab stays 6-valued so
  // LeftPanel + RightPanel don't need to know about the merge; they still
  // render one of contacts/messages/calls/finance/calendar/subs. This
  // subtab state remembers which side of Comms was last active, so the
  // segmented control shows the right selection when Comms is returned to.
  const [commsSubtab, setCommsSubtab] = React.useState('messages');
  // Subs merged into Contacts (Key 2026-07-10): same shape as commsSubtab. The
  // Contacts pill hosts a Contacts/Subs toggle; this remembers the last side.
  const [contactsSubtab, setContactsSubtab] = React.useState('contacts');

  // EmptyHero (right-pane "Today" dashboard) dispatches navigation
  // events when a tile is clicked. Route them to the matching left-pane
  // lens here at the Root level since EmptyHero doesn't have direct
  // access to setLeftTab.
  React.useEffect(() => {
    const onAction = (e) => {
      const lens = e?.detail?.lens;
      if (lens === 'today')   setLeftTab('calendar');
      else if (lens === 'inbox') setLeftTab('messages');
      else if (lens === 'finance') setLeftTab('finance');
      else if (lens === 'rotting') {
        setLeftTab('contacts');
        // Defer so ContactsList re-mounts with the chip selected.
        setTimeout(() => window.dispatchEvent(new CustomEvent('crm-set-stage-filter', { detail: { stage: 'rotting' } })), 30);
      }
      else if (lens === 'stale_viewed') {
        // 2026-05-26: Hot pipeline tile → contacts list with the
        // staleViewed chip preselected. Dispatch pattern matches rotting.
        setLeftTab('contacts');
        setTimeout(() => window.dispatchEvent(new CustomEvent('crm-set-stage-filter', { detail: { stage: 'stale_viewed' } })), 30);
      }
      else if (lens === 'silent_new') {
        // 2026-05-28: cold-leads Next Action → Silent leads lens.
        setLeftTab('contacts');
        setTimeout(() => window.dispatchEvent(new CustomEvent('crm-set-stage-filter', { detail: { stage: 'silent_new' } })), 30);
      }
    };
    window.addEventListener('crm-empty-hero-action', onAction);
    return () => window.removeEventListener('crm-empty-hero-action', onAction);
  }, []);

  // 2026-05-26: global Cmd+K / Ctrl+K / "/" → switch to Contacts tab
  // (if not already there) and focus the search input. Previously the
  // listener was scoped to ContactsList, so pressing Cmd+K from
  // Messages/Today/Finance was a no-op.
  React.useEffect(() => {
    const onKey = (e) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      const isSlash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!isCmdK && !isSlash) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      const inField = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      if (isSlash && inField) return; // let "/" type into other fields
      e.preventDefault();
      setLeftTab('contacts');
      // Defer focus until after the Contacts list mounts. setTimeout 50ms
      // is the same defer pattern the EmptyHero dispatch uses.
      setTimeout(() => {
        const el = document.getElementById('bpp-contact-search');
        if (el) { el.focus(); el.select?.(); }
      }, 50);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // v10.1.16 mobile fix: when the user navigates between tabs, blur any
  // active text input so the iOS keyboard dismisses. Without this, leaving
  // Messages while a textarea has focus leaves the keyboard floating over
  // the next tab. Affects keyboard, autoFocus, AND helps when accessibility
  // services have stuck focus.
  // v10.1.17: blur on mobileView change too, not just leftTab. The keyboard
  // was sticking when swiping from Messages (right pane) back to Contacts
  // (left pane) because the textarea retained focus across the pane swap.

  // URL state: hydrate active contact + right-tab from query string on
  // first load. Pull-to-refresh on iOS Safari, accidental tab close, or
  // a shared link can then restore the prior context. Format:
  //   ?c=<contactId>&t=<rightTab>&lt=<leftTab>
  // Match the NavBar order, Contact, Messages, Finance, Calendar, Phone.
  // 'subs' is the operator-only Subs command center (crm-subs-tab.jsx), reached
  // by long-pressing the Calendar icon. It is a valid URL tab so a shared/hydrated
  // link can deep-link back into it, but it has no customer-facing NavBar icon.
  const VALID_TABS = ['contacts','messages','finance','calendar','calls','subs'];
  const initialQuery = React.useMemo(() => {
    if (typeof window === 'undefined') return {};
    const p = new URLSearchParams(window.location.search);
    // Reject unknown tab values from URL, `?t=garbage` would render
    // a blank right pane otherwise.
    const t = p.get('t');
    const lt = p.get('lt');
    return {
      c: p.get('c'),
      t: VALID_TABS.includes(t) ? t : null,
      lt: VALID_TABS.includes(lt) ? lt : null,
    };
  }, []);
  // Right panel has its own tab state, independent
  const [rightTab, setRightTab] = React.useState(() => initialQuery.t || 'contacts');
  const [activeContact, setActiveContact] = React.useState(() => initialQuery.c || null);
  // A selected sub opens in the SAME detail pane a contact does (Key 2026-07-10),
  // holding { id, name }. When set, the right pane renders SubDetailPane instead
  // of the contact RightPanel. Cleared by any nav that leaves the sub.
  const [activeSub, setActiveSub] = React.useState(null);
  // Mirror activeContact into a ref so the dwell timer can confirm the
  // operator is still on this contact before it promotes it to "recent"
  // (catches the archived-fallback that swaps activeContact out from under
  // an armed timer).
  const activeContactRef = React.useRef(activeContact);
  React.useEffect(() => { activeContactRef.current = activeContact; }, [activeContact]);
  React.useEffect(() => {
    if (initialQuery.lt) setLeftTab(initialQuery.lt);
  }, []);
  // Auto-pick the first contact once data lands. Skip if a contact is
  // already chosen via URL state.
  React.useEffect(() => {
    if (loaded && authed && !activeContact && CRM.contacts.length > 0) {
      setActiveContact(CRM.contacts[0].id);
    }
  }, [loaded, authed, activeContact]);
  // Validate the URL-provided contact id once data has loaded, if the
  // contact was archived or deleted, fall back to the first contact and
  // surface a toast so a stale shared link doesn't silently switch the
  // operator to a different contact mid-conversation.
  React.useEffect(() => {
    if (!loaded || !activeContact) return;
    const exists = CRM.contacts.some(c => c.id === activeContact);
    if (!exists) {
      // Only toast when the URL was hydrated from query string (vs the
      // auto-pick-first effect above writing to it), avoid noise on
      // first load when the contact list briefly empty-states.
      if (initialQuery.c === activeContact) {
        window.showToast?.('Contact not found, opened first instead');
      }
      setActiveContact(CRM.contacts[0]?.id || null);
    }
  }, [loaded, activeContact]);
  // Sync URL on every state change. Use replaceState to avoid clogging
  // history (back-button still navigates the underlying domain).
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    if (activeContact) p.set('c', activeContact); else p.delete('c');
    if (rightTab && rightTab !== 'contacts') p.set('t', rightTab); else p.delete('t');
    if (leftTab && leftTab !== 'contacts') p.set('lt', leftTab); else p.delete('lt');
    const qs = p.toString();
    const next = `${window.location.pathname}${qs ? '?' + qs : ''}`;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState({}, '', next);
    }
  }, [activeContact, rightTab, leftTab]);
  const [highlightId, setHighlightId] = React.useState(null);
  // Force re-render after in-place CRM mutations (archive / DNC / delete)
  const [bump, setBump] = React.useState(0);
  const bumpData = React.useCallback(() => setBump(n => n + 1), []);
  // Mobile: 'left' or 'right'
  const [mobileView, setMobileView] = React.useState('left');
  // The detached tab-bar bubble opens a bottom search dock (rendered by the
  // list itself, above the keyboard). The dock tells the shell to hide the
  // tab bar + bubble while it's open, the way iOS hides the tab bar on search.
  const [searchOpen, setSearchOpen] = React.useState(false);
  React.useEffect(() => {
    const open = () => setSearchOpen(true);
    const close = () => setSearchOpen(false);
    window.addEventListener('crm-search-open', open);
    window.addEventListener('crm-search-close', close);
    return () => {
      window.removeEventListener('crm-search-open', open);
      window.removeEventListener('crm-search-close', close);
    };
  }, []);
  // Ref on the mobile-panel container. Used by LargeTitleHeader to attach
  // a delegated (capture-phase) scroll listener that picks up scrolls from
  // any inner scroll container inside the current tab body. Declared HERE
  // (top level of Root, before any early return) because Rules of Hooks
  // requires unconditional call ordering; the previous placement inside
  // the `mobileApp` block sat AFTER `if (!loaded) return` and
  // `if (!authed) return <SignInGate />`, so the ref was skipped on the
  // loading / sign-in renders and called on the loaded one. Hook count
  // changed across renders, hitting React error #310 ("Rendered more
  // hooks than during the previous render") and white-screening the CRM
  // on real data. (TEST_MODE booted straight to loaded+authed, which is
  // why the fixture harness never surfaced it.)
  const mobilePanelRef = React.useRef(null);
  // v10.1.17 mobile fix: blur the focused input whenever the user changes
  // tab OR swaps panes, so the iOS keyboard dismisses. Without this, leaving
  // Messages while the textarea has focus leaves the keyboard floating over
  // the Contacts list (Key feedback 2026-05-04).
  React.useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [leftTab, mobileView]);
  const [dncSet, setDncSet] = React.useState(new Set());
  // Seed dncSet from the DB-flagged contacts so the UI's compose-bar lock,
  // DNC pill, and call-button gate match reality. Refresh on every realtime
  // tick because contact.do_not_contact can change from another tab/source.
  // This is TCPA-compliance-critical, without seeding, a do_not_contact
  // contact appears messageable in the UI even though sends are blocked.
  React.useEffect(() => {
    const sync = () => {
      const next = new Set((window.CRM?.contacts || []).filter(c => c.do_not_contact).map(c => c.id));
      setDncSet(prev => {
        // Same membership? skip, prevents needless re-renders.
        if (prev.size === next.size && [...prev].every(id => next.has(id))) return prev;
        return next;
      });
    };
    sync();
    const onChanged = () => sync();
    window.addEventListener('crm-data-changed', onChanged);
    window.addEventListener('crm-data-ready', onChanged);
    return () => {
      window.removeEventListener('crm-data-changed', onChanged);
      window.removeEventListener('crm-data-ready', onChanged);
    };
  }, []);
  // Responsive: pick a layout based on viewport. Re-renders on resize.
  const [vw, setVw] = React.useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  React.useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Pure state mirror: flips the local DNC set only. The toast is owned by the
  // caller (markDnc / unmarkDnc) and fires AFTER the awaited DB write, so the
  // operator never sees a "Marked do-not-contact" toast for a write that failed.
  const toggleDnc = id => {
    setDncSet(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // Recompute on every render so realtime updates flow through. Cheap, these
  // are tiny array filters over <500 rows. Hardcoded date string was a v1 demo
  // leftover; using TODAY (which is reset on every page load).
  // Local-timezone YYYY-MM-DD, toISOString() returns UTC and silently
  // shifts to "tomorrow" every evening after 8 PM EDT.
  const todayStr = React.useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }, []);
  // Left navbar shows GLOBAL counts across all contacts, that's the
  // inbox-style badge ("how much work is on my plate?").
  // Overdue is derived (DB doesn't store it), so we need the installed
  // set first. 2026-05-26: this badge had been silently 0 for the
  // entire CRM v3 lifetime because the DB never sets status='overdue'.
  const installedSet = React.useMemo(
    () => buildInstalledSet(CRM.contacts, CRM.events, CRM.proposals, CRM.invoices),
    [bump]
  );
  // Scope the unread-messages badge to NON-archived contacts so it matches the
  // inbox (crm-left filters archived out). Otherwise an archived contact's unread
  // inbound, or an orphan null-contact_id row, lights the badge permanently with
  // no inbox row to open and no Mark-all-read to clear it (audit 2026-06-23 r4).
  const liveContactIds = new Set(CRM.contacts.filter(c => !c.archived).map(c => c.id));
  const messagesReady = CRM.domainStatus?.messages?.state === 'ready';
  const moneyReady = CRM.domainStatus?.money?.state === 'ready';
  const badgeCounts = {
    messages: messagesReady
      ? CRM.messages.filter(m => m.direction === 'in' && m.read_at == null && liveContactIds.has(m.contact_id)).length
      : 0,
    // Calls badge = unheard voicemails (listened_at == null). Otherwise
    // the badge stays lit forever and loses signal value.
    calls: CRM.calls.filter(c => c.voicemail_url && c.listened_at == null).length,
    calendar: CRM.events.filter(e => (e.start_at || '').slice(0,10) === todayStr && e.status === 'scheduled').length,
    finance: moneyReady ? CRM.invoices.filter(i => isInvoiceOverdue(i, installedSet)).length : 0,
  };
  // Right navbar is per-contact, sharing the global object made every
  // contact's tab show 396 unread even when that contact had zero. Scope
  // each count to the active contact id; falls back to {} when no contact
  // is selected so we don't render misleading badges on the empty state.
  const contactBadgeCounts = React.useMemo(() => {
    if (!activeContact) return {};
    return {
      messages: messagesReady ? CRM.messages.filter(m =>
        m.contact_id === activeContact && m.direction === 'in' && m.read_at == null
      ).length : 0,
      calls: CRM.calls.filter(c =>
        c.contact_id === activeContact && c.voicemail_url && c.listened_at == null
      ).length,
      calendar: CRM.events.filter(e =>
        e.contact_id === activeContact && (e.start_at || '').slice(0,10) === todayStr && e.status === 'scheduled'
      ).length,
      finance: moneyReady ? CRM.invoices.filter(i =>
        i.contact_id === activeContact && isInvoiceOverdue(i, installedSet)
      ).length : 0,
    };
  }, [activeContact, bump, todayStr, installedSet, messagesReady, moneyReady]);

  // Tapping a row opens the contact on the right, switches right tab to match context
  // Tab-bar long-press: hold the Calls icon -> jump to the Calls dialer with the
  // keypad open (Key 2026-06-19). The dialer (number + keypad + DNC-gated Call,
  // via window.BPPVoice.call) already lives at the top of the Calls tab, so this
  // reuses it rather than a separate popup.
  React.useEffect(() => {
    const onHold = e => {
      if (e.detail?.action === 'dialpad') {
        setLeftTab('calls'); setRightTab('calls'); setMobileView('left');
        setTimeout(() => window.dispatchEvent(new CustomEvent('crm-open-keypad')), 80);
      } else if (e.detail?.action === 'subs') {
        // Long-press Calendar -> open the Subs command center as a full tab
        // (replaces the old SubsButton popover). Left pane only; the right
        // contact panel is untouched so a contact stays open behind it.
        setLeftTab('subs'); setMobileView('left');
      }
    };
    window.addEventListener('crm-tab-hold', onHold);
    return () => window.removeEventListener('crm-tab-hold', onHold);
  }, []);

  const handleOpen = (contactId, openTab, targetId) => {
    if (window.BPP && window.BPP.native) window.BPP.native.haptics.selection();
    // Opening a contact from a search result must close the dock (Key 2026-07-10)
    // so the detail shows its tab bar; otherwise searchOpen stays true and hides
    // it. ContactsList closes on this event; crm-search-close clears our mirror.
    setSearchOpen(false);
    window.dispatchEvent(new CustomEvent('crm-force-close-search'));
    setActiveSub(null);   // opening a contact leaves any open sub
    setActiveContact(contactId);
    if (openTab) setRightTab(openTab);
    setMobileView('right');
    // Recently-viewed: keep the last 6 in localStorage, most-recent first.
    // ContactsList renders a pill row from this so Key can re-open a
    // contact he just had open without re-searching.
    // Recently-viewed is DWELL-GATED (Key 2026-06-18, dwell raised to 5s
    // 2026-06-19, "the contacts go to the top way too quick"): a contact is only
    // recorded after it stays open ~5s, so a quick glance or an accidental tap
    // does NOT promote it. Opening another contact (or re-opening this one)
    // within 5s clears the pending timer, so only a contact actually dwelled on
    // lands in the recent list, which surfaces at the top of the contacts list.
    if (window.__recentDwellTimer) clearTimeout(window.__recentDwellTimer);
    window.__recentDwellTimer = setTimeout(() => {
      // Only promote if the operator is STILL on this contact. onBack and the
      // back-swipe also clear this timer, so a glance-then-leave within the 5s
      // window never lands in the recent list.
      if (activeContactRef.current !== contactId) return;
      try {
        const KEY = 'bpp_v3_recent_contacts';
        const prev = JSON.parse(localStorage.getItem(KEY) || '[]').filter(id => id !== contactId);
        const next = [contactId, ...prev].slice(0, 6);
        window.safeSetItem?.(KEY, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('crm-recent-changed'));
      } catch {}
    }, 5000);
    if (targetId) {
      setHighlightId(targetId);
      // React emits the kebab-case `overflow-y` attribute, so the old
      // `[style*="overflowY"]` closest() never matched and the manual
      // offset math ran against the wrong parent. scrollIntoView centers
      // the row in whatever scroll container actually holds it.
      setTimeout(() => {
        const el = document.querySelector(`[data-target-id="${targetId}"]`);
        if (el && el.scrollIntoView) el.scrollIntoView({ block:'center', behavior:'smooth' });
      }, 80);
      setTimeout(() => setHighlightId(null), 2200);
    }
  };

  // Navigating back to the list cancels any pending dwell-promotion: if the
  // operator leaves the contact before the 5s timer fires, it was a glance,
  // not a dwell, so it must not float to the top of the recent list.
  const backToLeft = React.useCallback(() => {
    if (window.__recentDwellTimer) { clearTimeout(window.__recentDwellTimer); window.__recentDwellTimer = null; }
    setActiveSub(null);   // back out of a sub detail returns to the roster
    setMobileView('left');
  }, []);
  // Open a selected sub in the detail pane (Key 2026-07-10), same surface a
  // contact opens in. Clears any open contact + the search dock, slides right.
  React.useEffect(() => {
    const onOpenSub = (e) => {
      const d = (e && e.detail) || {};
      if (!d.subId) return;
      setSearchOpen(false);
      window.dispatchEvent(new CustomEvent('crm-force-close-search'));
      setActiveSub({ id: d.subId, name: d.name || null });
      setMobileView('right');
    };
    window.addEventListener('crm-open-sub', onOpenSub);
    return () => window.removeEventListener('crm-open-sub', onOpenSub);
  }, []);

  // Desk clear stack advance (bold bet #3): Messages opens the next prefilled
  // contact without auto-sending. Same handleOpen path as tapping a row.
  React.useEffect(() => {
    const onOpenContact = (e) => {
      const d = (e && e.detail) || {};
      if (!d.contactId) return;
      handleOpen(d.contactId, d.tab || 'messages', d.targetId || null);
    };
    window.addEventListener('crm-open-contact', onOpenContact);
    return () => window.removeEventListener('crm-open-contact', onOpenContact);
  }, []);

  // Double-tap a top nav tab on MOBILE = jump to that tab's MAIN (list-level)
  // section, popping out of any open contact (Key 2026-06-23). The single tap is
  // unchanged and the back arrow stays; the double-tap is an extra "back out to
  // this tab's list" gesture. The double-tap is DETECTED INSIDE NavBar (so it
  // still fires when re-tapping the active tab, which the single-tap path turns
  // into a refresh). This callback is just the destination.
  const goToMainTab = React.useCallback((t) => {
    setLeftTab(t);
    setRightTab(t);
    backToLeft();
  }, [backToLeft]);

  // (contactName helper unused at root level; ContactStrip handles display)

  // ── iOS Phase 1 primary-tab helpers ─────────────────────────────
  // The 5-tab bottom pill uses these to route into the underlying
  // leftTab/rightTab state. Keeps the old panel contracts unchanged.
  const primaryTabFromUnderlying = (t) => {
    if (t === 'messages' || t === 'calls') return 'comms';
    if (t === 'subs') return 'contacts';
    return t || 'contacts';
  };
  // The DETAIL pill keeps Subs separate (that contact's sub/job, SubTabView), so
  // it does NOT fold subs into contacts the way the browse pill does.
  const detailTabFromUnderlying = (t) => {
    if (t === 'messages' || t === 'calls') return 'comms';
    return t || 'contacts';
  };
  const primaryTab = primaryTabFromUnderlying(leftTab);
  // Map the pill tabs onto the underlying tab id LeftPanel/RightPanel consume.
  // 'comms' resolves through commsSubtab, 'contacts' through contactsSubtab, so
  // each merged pill remembers which side (Messages/Calls, Contacts/Subs) was last.
  const primaryToUnderlying = React.useCallback((t) => {
    if (t === 'comms') return commsSubtab || 'messages';
    if (t === 'contacts') return contactsSubtab || 'contacts';
    return t;
  }, [commsSubtab, contactsSubtab]);
  const handlePrimaryTab = React.useCallback((t) => {
    if (window.BPP && window.BPP.native) window.BPP.native.haptics.selection();
    setActiveSub(null);   // any pill nav leaves an open sub
    const u = primaryToUnderlying(t);
    // Subs is a left-only operator view (opens sheets, no right-pane detail).
    if (u === 'subs') { setLeftTab('subs'); setMobileView('left'); return; }
    setLeftTab(u); setRightTab(u);
  }, [primaryToUnderlying]);
  // Comms segmented-control change: swap the underlying tab AND persist
  // the choice for the next Comms visit.
  const handleCommsSubtab = React.useCallback((next) => {
    setActiveSub(null);
    setCommsSubtab(next);
    setLeftTab(next); setRightTab(next);
  }, []);
  // Contacts segmented-control change (Contacts <-> Subs). Subs never touches
  // rightTab (no detail pane); Contacts restores the left list.
  const handleContactsSubtab = React.useCallback((next) => {
    // No haptic here: the only caller is the hold gesture, which already buzzed
    // in BottomTab.dispatchHold (matching handleCommsSubtab, which has none).
    setActiveSub(null);
    setContactsSubtab(next);
    if (next === 'subs') { setLeftTab('subs'); setMobileView('left'); }
    else { setLeftTab('contacts'); }
  }, []);
  // Sync the subtab state if some other code path (URL, EmptyHero, deep-link)
  // sets leftTab directly; the segmented controls then mirror what's rendering.
  React.useEffect(() => {
    if (leftTab === 'messages' || leftTab === 'calls') setCommsSubtab(leftTab);
    if (leftTab === 'contacts' || leftTab === 'subs') setContactsSubtab(leftTab);
  }, [leftTab]);
  // Hold-to-switch (Key 2026-07-10): the tab-hold gesture that replaced the top
  // toggles. Browse holds flip the left subtab (and persist it via the same
  // handlers the old segmented controls used); the detail-comms hold flips only
  // the right pane's Messages/Calls. Placed AFTER the subtab handlers so the deps
  // can reference them without a TDZ. The long-press already fires the haptic
  // (BottomTab.dispatchHold), so the handlers don't re-buzz here.
  React.useEffect(() => {
    const onSwitch = (e) => {
      const a = e.detail?.action;
      if (a === 'switch-contacts') handleContactsSubtab(contactsSubtab === 'subs' ? 'contacts' : 'subs');
      else if (a === 'switch-comms') handleCommsSubtab(commsSubtab === 'calls' ? 'messages' : 'calls');
      else if (a === 'switch-comms-detail') {
        // Keep the detail Comms tab honest: label + tap + hold must agree. The tab
        // resolves its tap target through commsSubtab, so flip THAT (not just
        // rightTab); and if the pane is actually showing comms right now, move it
        // live too. Basing "current" on the live pane (rightTab) when it's a comms
        // view, else on the remembered commsSubtab.
        const cur = (rightTab === 'messages' || rightTab === 'calls') ? rightTab : commsSubtab;
        const next = cur === 'calls' ? 'messages' : 'calls';
        setCommsSubtab(next);
        if (rightTab === 'messages' || rightTab === 'calls') setRightTab(next);
      }
    };
    window.addEventListener('crm-tab-hold', onSwitch);
    return () => window.removeEventListener('crm-tab-hold', onSwitch);
  }, [contactsSubtab, commsSubtab, rightTab, handleContactsSubtab, handleCommsSubtab]);
  // Comms unread signal for the tab-bar red dot: any unread inbound
  // messages OR any unheard voicemail on any contact. Same badge counts
  // the badge-count map computes; we OR them into a boolean here so an
  // exact count isn't needed when Finance already owns the count badge.
  const commsUnread = (badgeCounts.messages || 0) > 0 || (badgeCounts.calls || 0) > 0;
  // The pill-view double-tap gesture jumps to the primary tab's list.
  const goToPrimary = React.useCallback((t) => {
    if (window.BPP && window.BPP.native) window.BPP.native.haptics.impact('light');
    const u = primaryToUnderlying(t);
    setLeftTab(u);
    if (u !== 'subs') setRightTab(u);  // subs is left-only
    backToLeft();
  }, [primaryToUnderlying, backToLeft]);
  // In a record, the pill's Finance tab opens THIS client's finance (rightTab
  // only, never leftTab, which would resurrect the retired global money list).
  // Hooks, so they sit ABOVE the loading/auth early returns below.
  const handleDetailTab = React.useCallback((t) => {
    // Finance + Subs are per-record detail tabs (this client's money / this
    // client's sub-job); they switch the right pane, not the whole app.
    if (t === 'finance' || t === 'subs') { window.bppHaptic && window.bppHaptic('selection'); setRightTab(t); return; }
    handlePrimaryTab(t);
  }, [handlePrimaryTab]);
  // Desktop (Key 2026-07-10): two floating pills, one per column, with the same
  // behaviors as mobile. The RIGHT pill switches ONLY the right pane's tab so you
  // can browse the left list while viewing a contact's detail/finance on the
  // right (Finance is the per-record 5th pill; every other maps to its tab id).
  const handleDesktopRightTab = React.useCallback((t) => {
    window.bppHaptic && window.bppHaptic('selection');
    setRightTab(t === 'finance' ? 'finance' : primaryToUnderlying(t));
  }, [primaryToUnderlying]);

  // Loading splash, shown until crm-data.js fires the ready event.
  if (!loaded) {
    return (
      <div style={{ height:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f4f6f9', color:'#666', fontFamily:'DM Sans', fontSize:14 }}>
        Loading…
      </div>
    );
  }

  // Sign-in form, surfaced when no Supabase session is active.
  if (!authed) {
    return <SignInGate />;
  }

  // The global safety gate is reserved for Contacts plus the phone-wide DNC
  // list. Quote, money, Messages, and workspace failures are localized to the
  // surfaces that consume them so a usable contact roster is never held back.
  if (window.CRM?.criticalLoadFailed) {
    return (
      <div style={{ height:'100dvh', display:'flex', flexDirection:'column', gap:14, alignItems:'center', justifyContent:'center', background:'#f4f6f9', color:'#1B2B4B', fontFamily:'DM Sans', textAlign:'center', padding:24 }}>
        <div style={{ fontSize:18, fontWeight:700 }}>CRM data did not fully load</div>
        <div style={{ color:'#5b6576', fontSize:15, maxWidth:380, lineHeight:1.45 }}>
          Contacts and the do-not-contact safety list are unavailable. Customer actions stay closed until both recover.
        </div>
        <button type="button" onClick={() => window.location.reload()} style={{ minHeight:44, padding:'0 18px', borderRadius:10, border:'1px solid #1B2B4B', background:'#fff', color:'#1B2B4B', fontFamily:'inherit', fontSize:15, fontWeight:700, cursor:'pointer' }}>
          Try again
        </button>
      </div>
    );
  }

  // ?canvas=1 forces the side-by-side mobile+desktop preview (useful when
  // iterating on the design without two browser windows).
  const showCanvas = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('canvas') === '1';
  const isMobile = vw < 900;

  // ── Mobile production layout (full viewport, no device chrome) ──
  // v10.1.27: height: 100% rides on body which is sized to --vvh
  // (visualViewport.height) by index.html JS. When keyboard opens, body
  // shrinks → mobileApp shrinks → compose bar at panel bottom lands above
  // the keyboard automatically.
  // Which primary tab body drives the large-title label. Subs owns its
  // whole tab, so the shell doesn't paint a large title there.
  // The Contacts pill shows the ACTIVE subtab name (Contacts or Subs) so the big
  // title always matches the view; every other pill keeps its umbrella label.
  const largeTitleFor = primaryTab === 'contacts'
    ? (leftTab === 'subs' ? 'Subs' : 'Contacts')
    : { comms: leftTab === 'calls' ? 'Calls' : 'Messages', finance: 'Finance', calendar: 'Calendar' }[primaryTab];
  // Show the large-title header only on the LEFT view (list side). On the
  // pushed contact detail (mobileView === 'right'), the top slot is the
  // IosNavBar mounted from ContactStrip, not the large title.
  // Phase 1 Pass 2 (Key 2026-07-09): Subs now uses the shared shell title.
  // The old inline navy header inside SubsTab was removed in this pass, so
  // the tab now reads like every other primary tab (one "Subs" title from
  // the LargeTitleHeader, then the list below).
  // Hide the large title while searching (Key 2026-07-10): the keyboard + dock
  // own the screen, the "Contacts" bar at the very top is wasted space.
  const showLargeTitle = mobileView === 'left' && !searchOpen;

  // Detached tab-bar bubble (Key 2026-07-10): Search on a searchable list,
  // The detached bubble is SEARCH-only (Key 2026-07-10): on a searchable list
  // it separates out as Search; in a record it MERGES back into the pill as the
  // Finance tab (includeFinance below), so no detached bubble there.
  // Contacts (umbrella-covers the Subs subtab) + Comms + the main Calendar are
  // searchable; whichever LEFT list is mounted (ContactsList / SubsTab / Messages
  // / Calls / CalendarList) handles crm-open-list-search. The per-contact calendar
  // on the RIGHT detail is NOT searchable (Key 2026-07-10), which falls out for
  // free: the bubble only shows on the browse side (mobileView left).
  const SEARCHABLE_LISTS = ['contacts', 'comms', 'calendar'];
  const bubbleConfig = (!searchOpen && mobileView === 'left' && SEARCHABLE_LISTS.includes(primaryTab)) ? {
    mode: 'search',
    // Distinct from the in-thread 'crm-open-search' (crm-right) so the two never
    // cross-fire; the mounted left list's useSearchDock listens for this.
    onPress: () => { window.bppHaptic && window.bppHaptic('light'); window.dispatchEvent(new CustomEvent('crm-open-list-search')); },
  } : null;
  // handleDetailTab + handleDesktopRightTab are hooks, so they live ABOVE the
  // loading/auth early returns (with the other useCallbacks); see near goToPrimary.
  // Desktop LEFT pill Search bubble , same dock as mobile, not gated on mobileView.
  const desktopLeftBubble = (!searchOpen && SEARCHABLE_LISTS.includes(primaryTab)) ? {
    mode: 'search',
    onPress: () => { window.bppHaptic && window.bppHaptic('light'); window.dispatchEvent(new CustomEvent('crm-open-list-search')); },
  } : null;

  const mobileApp = (
    <div style={{ height:'100%', flex:1, display:'flex', flexDirection:'column', background:'#f4f5f8', overflow:'hidden', minHeight:0, position:'relative' }}>
      {/* iOS Phase 1: the top NavBar is gone from mobile. Navigation is the
          BOTTOM floating pill (mounted at the bottom of this container). The
          right pane (contact detail) mounts its own IosNavBar internally
          (back chevron + name title + star + overflow) via ContactStrip. */}
      {/* Not searching: the safe-area inset + large title. Searching (Key
          2026-07-10): this whole block drops out so the list rides up under the
          status bar, where the scroll-edge gradient (in ContactsList) dims the
          content so the clock/battery stay legible, Apple's separator. */}
      {showLargeTitle && (
        <div style={{
          flex: '0 0 auto',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: '#f4f5f8',
          position: 'relative',
          zIndex: 5,
        }}>
          {/* The Contacts/Subs + Messages/Calls toggles moved OFF this header
              (Key 2026-07-10): switching is now a hold on the bottom tab, and the
              large title itself names the current subtab (largeTitleFor). */}
          <LargeTitleHeader
            title={largeTitleFor}
            scrollRef={mobilePanelRef}
          />
        </div>
      )}
      <div style={{ flex:1, overflow:'hidden', position:'relative' }} className="mobile-panel"
        ref={mobilePanelRef}
        onTouchStart={e => {
          window._swipeX = e.touches[0].clientX;
          window._swipeY = e.touches[0].clientY;
          // 2026-05-28 (Key field bug): dragging the proposal length slider
          // accidentally fired the pane-back swipe. Block the back-swipe when
          // the gesture STARTS on any interactive control (slider, button,
          // input, link, anything tagged data-no-swipe). One guard fixes the
          // slider and every future control at once.
          const t = e.target;
          window._swipeBlocked = !!(t && t.closest && t.closest(
            'input,textarea,select,button,a,label,[role="slider"],[contenteditable],[data-no-swipe]'
          ));
        }}
        onTouchEnd={e => {
          const blocked = window._swipeBlocked;
          window._swipeBlocked = false;
          if (blocked) return;
          const dx = e.changedTouches[0].clientX - window._swipeX;
          const dy = e.changedTouches[0].clientY - (window._swipeY || 0);
          // Swipe-right on the RIGHT pane goes back to the contact list
          // (matches iOS Mail's natural back gesture). The LEFT pane is
          // intentionally swipe-disabled, Key found left-pane swipes
          // misfired during list scroll on iPhone, switching panes when
          // he was just trying to scroll the contacts list.
          // Require the gesture to be mostly horizontal (|dx| > |dy|) so a
          // diagonal scroll/drag doesn't read as a back-swipe.
          if (mobileView === 'right' && dx > 60 && Math.abs(dx) > Math.abs(dy)) backToLeft();
        }}
      >
        <div style={{
          position:'absolute', inset:0, display:'flex',
          transform: mobileView === 'right' ? 'translateX(-50%)' : 'translateX(0)',
          /* iOS push feel (Key 2026-07-10): the shell's spring instead of the flatter
             Material curve, slightly longer, so list<->detail glides in + settles. */
          transition: 'transform 0.34s cubic-bezier(0.32,0.72,0,1)',
          width:'200%',
          willChange:'transform',
        }}>
          <div style={{ width:'50%', height:'100%', overflow:'hidden', position:'relative', display:'flex', flexDirection:'column' }}>
            <LeftPanel tab={leftTab} onOpen={handleOpen} dncSet={dncSet} activeContactId={activeContact} />
          </div>
          <div style={{ width:'50%', height:'100%', overflow:'hidden', position:'relative', display:'flex', flexDirection:'column' }}>
            {activeSub && window.SubDetailPane
              ? <window.SubDetailPane subId={activeSub.id} name={activeSub.name} onBack={backToLeft} onChanged={() => window.dispatchEvent(new CustomEvent('crm-sub-changed'))} />
              : <RightPanel contactId={activeContact} tab={rightTab} dncSet={dncSet} toggleDnc={toggleDnc} highlightId={highlightId} bumpData={bumpData} onOpenTab={setRightTab} onBack={backToLeft} />}
          </div>
        </div>
      </div>
      {/* The bottom pill floats over the swap-panel content. Hidden on the
          open MESSAGE THREAD (mobileView right + comms), the way iOS Messages
          hides its tab bar inside a conversation, so the floating pill never
          covers the compose bar. The nav-bar back chevron returns to the list
          where the pill reappears. Every other view keeps the pill. */}
      {/* Kept MOUNTED during search (was unmounted) so it can tuck down + fade as
          the dock rises, instead of teleporting. hidden drives the .is-hidden
          slide-out; the bubble stays present while searching so it fades too. */}
      {!(mobileView === 'right' && primaryTab === 'comms') && !activeSub && (
        <BottomTabBar
          tab={mobileView === 'right' ? detailTabFromUnderlying(rightTab) : primaryTab}
          onTab={mobileView === 'right' ? handleDetailTab : handlePrimaryTab}
          onDoubleTab={goToPrimary}
          badgeCounts={badgeCounts}
          commsUnread={commsUnread}
          enableHold
          hidden={searchOpen}
          holdMap={mobileView === 'right' ? DETAIL_HOLD : BROWSE_HOLD}
          subtabs={mobileView === 'right'
            ? { comms: (rightTab === 'messages' || rightTab === 'calls') ? rightTab : commsSubtab }
            : { contacts: contactsSubtab, comms: commsSubtab }}
          bubble={bubbleConfig || (searchOpen && mobileView === 'left' && SEARCHABLE_LISTS.includes(primaryTab) ? { mode: 'search', onPress: () => {} } : null)}
          includeSubs={mobileView === 'right'}
          includeFinance={mobileView === 'right'}
        />
      )}
      <ToastHost />
      <ConfirmHost />
      <TabHoldHost onOpen={handleOpen} />
    </div>
  );

  // ── Desktop production layout (full viewport split) ──
  // Left column 400px fixed (room for name + status pill + jurisdiction).
  // Right column fills the rest of the viewport, no empty bars on either side.
  const desktopApp = (
    <div style={{ height:'100%', flex:1, display:'flex', flexDirection:'row', background:'#f4f6f9', overflow:'hidden', minHeight:0 }}>
      {/* Two floating pills, one per column (Key 2026-07-10): the desktop drops
          the old top navy NavBars for the same frosted pill language as mobile.
          LEFT pill drives the list + carries the Search bubble on searchable
          tabs; RIGHT pill drives the detail with Finance merged in. Each column
          is position:relative so its .bpp-tabdock centers within that column. */}
      <div style={{ width:480, borderRight:'1px solid rgba(11,31,59,0.12)', display:'flex', flexDirection:'column', overflow:'hidden', flexShrink:0, background:'#F8F8F6', position:'relative' }}>
        {/* The Contacts/Subs + Messages/Calls toggles were removed here too (Key
            2026-07-10); the left pill's Contacts + Comms tabs now hold-to-switch
            and morph to name the current subtab. */}
        <LeftPanel tab={leftTab} onOpen={handleOpen} dncSet={dncSet} activeContactId={activeContact} />
        {/* Kept mounted during search; the tabdock wrapper slides down + fades
            (its .is-hidden) as the dock rises, so the pill does not teleport. */}
        <div className={'bpp-tabdock' + (searchOpen ? ' is-hidden' : '')}>
          <BottomTabBar
            tab={primaryTab}
            onTab={handlePrimaryTab}
            onDoubleTab={goToPrimary}
            badgeCounts={badgeCounts}
            commsUnread={commsUnread}
            enableHold
            holdMap={BROWSE_HOLD}
            subtabs={{ contacts: contactsSubtab, comms: commsSubtab }}
            bubble={desktopLeftBubble || (searchOpen && SEARCHABLE_LISTS.includes(primaryTab) ? { mode: 'search', onPress: () => {} } : null)}
          />
        </div>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0, background:'#F8F8F6', position:'relative' }}>
        {/* The detail Messages/Calls toggle moved to a hold on the right pill's
            Comms tab (Key 2026-07-10); Subs stays a separate tab on the right. */}
        {activeSub && window.SubDetailPane
          ? <window.SubDetailPane subId={activeSub.id} name={activeSub.name} onBack={backToLeft} onChanged={() => window.dispatchEvent(new CustomEvent('crm-sub-changed'))} />
          : <RightPanel contactId={activeContact} tab={rightTab} dncSet={dncSet} toggleDnc={toggleDnc} highlightId={highlightId} bumpData={bumpData} onOpenTab={setRightTab} />}
        {/* RIGHT pill keeps Subs (this contact's sub/job) separate + Finance; a
            sub detail has its own back nav, so the detail pill is hidden then. */}
        {!activeSub && (
          <div className="bpp-tabdock">
            <BottomTabBar
              tab={detailTabFromUnderlying(rightTab)}
              onTab={handleDesktopRightTab}
              badgeCounts={contactBadgeCounts}
              commsUnread={commsUnread}
              enableHold
              holdMap={DETAIL_HOLD}
              subtabs={{ comms: (rightTab === 'messages' || rightTab === 'calls') ? rightTab : commsSubtab }}
              includeSubs
              includeFinance
            />
          </div>
        )}
      </div>
      <ToastHost />
      <ConfirmHost />
      <TabHoldHost onOpen={handleOpen} />
    </div>
  );

  if (showCanvas) {
    // Side-by-side preview canvas (for design iteration only). Wrapped in
    // device-frame chrome to make the comparison feel intentional.
    return (
      <div style={{ height:'100dvh', display:'flex', flexDirection:'column', background:'#f4f6f9', overflow:'hidden', maxWidth:'100vw' }}>
        <div style={{ flex:1, display:'flex', overflow:'hidden', padding:20, gap:32, alignItems:'center', justifyContent:'center', maxWidth:'100vw' }}>
          <div style={{
            width:390, height:'calc(100dvh - 40px)', maxHeight:844,
            borderRadius:16, overflow:'hidden',
            border:'1px solid rgba(11,31,59,0.12)',
            display:'flex', flexDirection:'column', flexShrink:0,
            background:'white', position:'relative',
          }}>
            <div style={{ background: NAVY, height:44, display:'flex', alignItems:'flex-end', justifyContent:'space-between', padding:'0 24px 8px', flexShrink:0 }}>
              <span style={{ color:'white', fontSize:13, fontWeight:600 }}>9:14</span>
              <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                <svg width="16" height="12" viewBox="0 0 16 12" fill="white"><rect x="0" y="3" width="3" height="9" rx="1"/><rect x="4.5" y="2" width="3" height="10" rx="1"/><rect x="9" y="0" width="3" height="12" rx="1"/><rect x="13.5" y="1" width="2.5" height="11" rx="1" opacity="0.3"/></svg>
                <svg width="15" height="12" viewBox="0 0 15 12" fill="white"><path d="M7.5 2C5 2 2.8 3.1 1.2 4.8L0 3.5C2 1.3 4.6 0 7.5 0s5.5 1.3 7.5 3.5L13.8 4.8C12.2 3.1 10 2 7.5 2z"/><path d="M7.5 5c-1.7 0-3.2.7-4.3 1.9L2 5.7C3.4 4.1 5.3 3 7.5 3s4.1 1.1 5.5 2.7L11.8 6.9C10.7 5.7 9.2 5 7.5 5z"/><circle cx="7.5" cy="10" r="2"/></svg>
                <svg width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="white" strokeOpacity="0.35"/><rect x="2" y="2" width="16" height="8" rx="2" fill="white"/><path d="M23 4v4a2 2 0 0 0 0-4z" fill="white" fillOpacity="0.4"/></svg>
              </div>
            </div>
            {mobileApp}
          </div>
          <div style={{
            flex:1, height:'calc(100dvh - 40px)', maxHeight:844, maxWidth:900, minWidth:0,
            borderRadius:12, overflow:'hidden',
            border:'1px solid rgba(11,31,59,0.12)',
            display:'flex',
          }}>
            {desktopApp}
          </div>
        </div>
      </div>
    );
  }

  // Production: render only the layout that fits the viewport.
  return isMobile ? mobileApp : desktopApp;
}

// Tab-bar long-press hosts (Key 2026-06-19): always-mounted at app ROOT,
// OUTSIDE the sliding-pane transform, so the popovers/calculator anchor to the
// viewport (a position:fixed inside the transformed pane would render off-screen,
// the known containing-block trap). Each listens for the 'crm-tab-hold'
// CustomEvent the NavBar dispatches: Contacts-hold -> Permits, Calendar-hold ->
// Subs, Money-hold -> a standalone Quick Quote calculator tied to no contact.

// The dialer is a POPUP overlay (Key 2026-06-20), not an inline panel mode.
// It is hosted in TabHoldHost (mounted at app root, OUTSIDE the sliding-pane
// transform, so a position:fixed sheet renders
// correctly, the transform-containing-block scar). It opens on the long-press
// Calls icon (crm-open-keypad, no seed) or the "Open in dialer" row (same event
// carrying the typed number as detail.seedDial). The dial state lives here,
// fully isolated from the Calls search box. Keypad + Call + match chip are the
// approved phone-page primitives (2026-06-10), moved verbatim into the sheet.
// Cap dialer entry at a full US number: 10 digits, or 11 when a leading 1 is
// the country code (fmtDial then strips it, so the displayed number stays
// <=10). Truncates extra digits while preserving formatting chars + any * / #
// already typed. Closes the silent-overflow bug where the keypad / typing /
// seed accepted unlimited digits but the display only showed the last 10
// (Key 2026-06-20).
function capDial(raw) {
  const s = String(raw || '');
  const dg = s.replace(/\D/g, '');
  const max = dg.startsWith('1') ? 11 : 10;
  if (dg.length <= max) return s;
  let n = 0, out = '';
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') { if (n >= max) continue; n++; }
    out += ch;
  }
  return out;
}

function DialerPopup({ onClose, seed }) {
  const NV = '#1B2B4B', GD = window.GOLD || '#ffba00', MT = window.MUTED || '#4B5563', BGC = window.BG || '#F8F8F6';
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 480;
  // Seed (from the "Open in dialer" row) comes from the uncapped Calls search
  // box; capDial truncates it so an over-long value can't re-hide digits on open.
  const [dial, setDial] = React.useState(() => capDial(seed));
  const [calling, setCalling] = React.useState(false);
  const callingRef = React.useRef(false);
  const contacts = (window.CRM && window.CRM.contacts) || [];

  // Animate-out-then-close (Key 2026-06-21: no instant-vanish popups). The
  // dialer had NO animation; it now slides up on open and reverses on a dismiss
  // (backdrop / Esc). Placing a call closes instantly since the call UI takes
  // over. reduced-motion closes at once.
  const [exiting, setExiting] = React.useState(false);
  const closeTimer = React.useRef(null);
  React.useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const beginClose = () => {
    if (closeTimer.current) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { onClose && onClose(); return; }
    setExiting(true);
    closeTimer.current = setTimeout(() => { onClose && onClose(); }, 190);
  };

  const dialDigits = (dial || '').replace(/\D/g, '');
  const dialHasLetters = /[a-zA-Z]/.test(dial || '');
  const dialValid = !dialHasLetters && (dialDigits.length === 10 || (dialDigits.length === 11 && dialDigits.startsWith('1')));
  const dialE164 = dialDigits.length === 10 ? '+1' + dialDigits : '+' + dialDigits;
  const fmtDial = (() => {
    if (dialHasLetters) return dial;
    const d = dialDigits.startsWith('1') && dialDigits.length > 10 ? dialDigits.slice(1) : dialDigits;
    if (d.length === 0) return '';
    if (d.length < 4) return '(' + d;
    if (d.length < 7) return `(${d.slice(0,3)}) ${d.slice(3)}`;
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,10)}`;
  })();
  const norm10 = (s) => {
    const d = String(s || '').replace(/\D/g, '');
    return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  };
  const dialNorm = norm10(dialDigits);
  // Contact match: by name when letters are typed, by digits otherwise.
  const dialMatch = (() => {
    const q = (dial || '').trim().toLowerCase();
    if (!q) return null;
    if (dialHasLetters) return contacts.find(c => (c.name || '').toLowerCase().includes(q)) || null;
    if (dialDigits.length >= 4) return contacts.find(c => norm10(c.phone).includes(dialNorm)) || null;
    return null;
  })();
  // A match is the CALL TARGET only when unambiguous (the wrong-customer scar):
  // a name hit with a complete phone, or a typed number that fully equals it.
  const matchPhone10 = dialMatch ? norm10(dialMatch.phone) : '';
  const matchIsTarget = !!dialMatch && matchPhone10.length === 10 && (dialHasLetters || matchPhone10 === dialNorm);
  const callTarget = matchIsTarget ? '+1' + matchPhone10 : (!dialHasLetters && dialValid ? dialE164 : null);
  // DNC gate on the ACTUAL target number, checked across ALL contacts: a
  // duplicate contact that shares the number (one of them do-not-contact) must
  // still block the call even when the first name/digit match was the non-DNC
  // twin (critic 2026-06-20, TCPA-relevant).
  const targetNorm = norm10(callTarget || '');
  const dncPhones = (window.CRM && Array.isArray(window.CRM.dncPhones)) ? window.CRM.dncPhones : [];
  const matchDnc = !!targetNorm && (
    contacts.some(c => c.do_not_contact && norm10(c.phone) === targetNorm)
    || dncPhones.some(phone => norm10(phone) === targetNorm)
  );
  const safetyUnavailable = !!(window.CRM && window.CRM.contactsLoadFailed);
  const outboundReleased = window.BPPVoice?.outboundReleased === true;
  const canCall = outboundReleased && !!callTarget && !matchDnc && !safetyUnavailable;

  React.useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') beginClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function placeCall() {
    const currentDncPhones = (window.CRM && Array.isArray(window.CRM.dncPhones)) ? window.CRM.dncPhones : [];
    const blockedNow = !!(window.CRM && window.CRM.contactsLoadFailed)
      || (!!targetNorm && (
        ((window.CRM && window.CRM.contacts) || []).some(c => c.do_not_contact && norm10(c.phone) === targetNorm)
        || currentDncPhones.some(phone => norm10(phone) === targetNorm)
      ));
    if (!canCall || blockedNow || callingRef.current) return;
    callingRef.current = true;
    setCalling(true);
    try {
      const ok = window.BPPVoice
        ? await window.BPPVoice.call(callTarget, matchIsTarget ? dialMatch.name : null)
        : false;
      if (ok) onClose();
      else window.showToast?.('Calling is not released yet.');
    } finally {
      callingRef.current = false;
      setCalling(false);
    }
  }

  // onMouseDown preventDefault on every key + Call so a tap never blurs the
  // input (a blur would drop the next typed digit).
  const keyBtn = { height: 52, borderRadius: 10, border: '1px solid #EBEBEA', background: 'white', fontSize: 19, fontWeight: 600, color: NV, cursor: 'pointer', fontFamily: 'inherit' };
  // CM-36: the familiar phone-keypad letter sublabels (older callers map a
  // number to its letters). Muted #4B5563 on white clears WCAG AA.
  const keyLetters = { '2':'ABC', '3':'DEF', '4':'GHI', '5':'JKL', '6':'MNO', '7':'PQRS', '8':'TUV', '9':'WXYZ' };
  return (
    <div onClick={beginClose} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(11,17,28,0.34)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', pointerEvents: exiting ? 'none' : 'auto', animation: exiting ? 'bpp-fade-up 160ms ease-in reverse both' : 'bpp-fade-up 180ms ease-out both' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Dialer" style={{
        width: isMobile ? '100%' : 360, maxWidth: '100%', background: 'white',
        borderRadius: isMobile ? '16px 16px 0 0' : 16, padding: 18,
        boxShadow: '0 -12px 40px rgba(27,43,75,0.22)',
        paddingBottom: isMobile ? 'calc(env(safe-area-inset-bottom, 0px) + 18px)' : 18,
        animation: exiting
          ? (isMobile ? 'bpp-slide-up 190ms cubic-bezier(0.4,0,1,1) reverse both' : 'bpp-fade-up 160ms cubic-bezier(0.4,0,1,1) reverse both')
          : (isMobile ? 'bpp-slide-up 220ms cubic-bezier(0.2,0.8,0.3,1) both' : 'bpp-fade-up 220ms cubic-bezier(0.2,0.8,0.3,1) both'),
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: NV }}>Dialer</span>
          <button onClick={beginClose} aria-label="Close dialer" style={{ width: 44, height: 44, margin: '-10px -10px -10px 0', border: 0, background: 'none', cursor: 'pointer', color: '#5a6478', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {/* Name/stage chip only when this contact IS the call target (a partial
            substring match is not who gets dialed, so showing it would lie). */}
        {dialMatch && matchIsTarget && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: matchDnc ? 4 : 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: NV }}>{dialMatch.name}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1E40AF', background: '#EFF6FF', padding: '2px 8px', borderRadius: 20, textTransform: 'capitalize' }}>{dialMatch.stage}</span>
          </div>
        )}
        {/* DNC line shows whenever the target number is do-not-contact, even if
            the contact above isn't the matched-target one, so a disabled Call
            always names its reason. */}
        {matchDnc && <div style={{ fontSize: 12, fontWeight: 600, color: '#991B1B', marginBottom: 10 }}>Marked Do Not Contact</div>}
        {safetyUnavailable && <div style={{ fontSize: 12, fontWeight: 600, color: '#991B1B', marginBottom: 10 }}>Calling unavailable until contacts finish loading</div>}
        {!outboundReleased && <div style={{ fontSize: 12, fontWeight: 600, color: '#5a6478', marginBottom: 10 }}>Calling is not released yet</div>}
        {/* DP-1: inputMode="none" so focusing the field never raises the native
            iOS keyboard on top of the custom keypad (the keypad is the single
            entry affordance). autoFocus keeps the caret; the keys' onMouseDown
            preventDefault preserves focus so the caret never blinks out. */}
        <input
          value={fmtDial} onChange={e => setDial(capDial(e.target.value))}
          placeholder="Number to dial" aria-label="Number to dial"
          type="text" inputMode="none" autoFocus
          style={{ width: '100%', height: 48, borderRadius: 8, border: '1.5px solid #EBEBEA', padding: '0 14px', fontSize: 20, fontWeight: 600, background: BGC, outline: 'none', fontFamily: 'inherit', color: NV, boxSizing: 'border-box', textAlign: 'center', marginBottom: 12 }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
          {/* A number to DIAL never contains * or #; those are DTMF tones that
              belong to the in-call CallKeypadSheet. Here they gave zero feedback
              (capDial/fmtDial strip them) and could jam digit entry, so they are
              empty spacers that keep 0 in its familiar bottom-center spot, every
              visible key now does something (audit 2026-06-23 r3). */}
          {['1','2','3','4','5','6','7','8','9','','0',''].map((k, i) => (k === '' ? <div key={'sp' + i} aria-hidden="true" /> : (
            <button key={k} onMouseDown={e => e.preventDefault()} onClick={() => setDial(capDial((dial || '') + k))}
              style={{ ...keyBtn, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, lineHeight: 1 }}>
              <span>{k}</span>
              {/* DP-3: render the letter row on EVERY key (an invisible
                  placeholder on the keys without letters) so all 12 numerals
                  share one baseline, like a real phone keypad; the empty row
                  just hangs below. */}
              <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.8px', color: MT, visibility: keyLetters[k] ? 'visible' : 'hidden' }}>{keyLetters[k] || ' '}</span>
            </button>
          )))}
          <button onMouseDown={e => e.preventDefault()} onClick={() => setDial((dial || '').slice(0, -1))} style={{ ...keyBtn, gridColumn: 'span 3', height: 44, fontSize: 13, fontWeight: 600, color: MT, background: '#F8F8F6' }}>Backspace</button>
        </div>
        <button onMouseDown={e => e.preventDefault()} onClick={placeCall} disabled={!canCall || calling} aria-label="Call"
          style={{ width: '100%', height: 50, borderRadius: 10, border: 0, background: (canCall && !calling) ? GD : '#E5E7EB', color: (canCall && !calling) ? NV : '#9aa3b2', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', cursor: (canCall && !calling) ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {window.Icons && window.Icons.calls && <span style={{ width: 18, height: 18, display: 'inline-flex' }}>{window.Icons.calls}</span>}
          {calling ? 'Calling…' : (outboundReleased ? 'Call' : 'Calling unavailable')}
        </button>
      </div>
    </div>
  );
}

function TabHoldHost({ onOpen }) {
  const [qq, setQq] = React.useState(false);
  const [dialer, setDialer] = React.useState(false);
  const [dialerSeed, setDialerSeed] = React.useState('');
  const dialerReturnFocus = React.useRef(null);
  React.useEffect(() => {
    const onHold = e => {
      if (e.detail?.action === 'quickquote') setQq(true);
    };
    window.addEventListener('crm-tab-hold', onHold);
    return () => window.removeEventListener('crm-tab-hold', onHold);
  }, []);
  // crm-open-keypad opens the dialer popup. Long-press Calls dispatches it with
  // no detail (empty dial); the "Open in dialer" row carries detail.seedDial.
  React.useEffect(() => {
    const onKeypad = e => {
      dialerReturnFocus.current = e.detail?.returnFocus || document.activeElement;
      setDialerSeed(e.detail?.seedDial || '');
      setDialer(true);
    };
    window.addEventListener('crm-open-keypad', onKeypad);
    return () => window.removeEventListener('crm-open-keypad', onKeypad);
  }, []);
  const Permits = window.PermitPortalsButton;
  const QQModal = window.QuickQuoteModal;
  // The old <Subs asHost/> popover (crm-subs.jsx) is retired: the Subs
  // command center is now the full 'subs' tab (crm-subs-tab.jsx), opened by
  // the Calendar long-press handler in Root. No popover host is mounted.
  return (
    <React.Fragment>
      {Permits && <Permits asHost />}
      {qq && QQModal && (
        <QQModal
          contacts={(window.CRM && window.CRM.contacts) || []}
          onClose={() => setQq(false)}
          onOpen={(id, tab) => { setQq(false); if (onOpen) onOpen(id, tab); }}
        />
      )}
      {dialer && <DialerPopup seed={dialerSeed} onClose={() => {
        setDialer(false);
        requestAnimationFrame(() => dialerReturnFocus.current?.focus?.());
      }} />}
    </React.Fragment>
  );
}

// Start the scheduled-SMS queue runner once at app load. Idempotent:
// re-mounting (React strict-mode, hot-reload) won't double-init the
// poller. Reads/sends every 60s after a 5s initial delay.
window.startScheduledQueueRunner?.();

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
