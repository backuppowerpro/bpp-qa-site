import { deliverySyncMessage, operatorDocumentPreviewUrl, promoteDocumentAfterDelivery } from './money-link-delivery.js';
import { applyProposalLifecycleReceipt, mutateProposalLifecycle } from './proposal-lifecycle.js';
import { applyInvoiceLifecycleReceipt, mutateInvoiceLifecycle } from './invoice-lifecycle.js';
import { deleteDraftMoneyDocument } from './money-document-operation.js';
import { sendManualSmsWithReceipt } from './manual-sms-operation.js';

// crm-right.jsx - Right panel: contact detail, 5 fully-featured tabs.
// Consumes canonical DB-shape arrays directly. Each tab filters by contact_id inline.

function RightPanel({ contactId, tab, dncSet = new Set(), toggleDnc = () => {}, highlightId, bumpData, onOpenTab, onBack }) {
  const { contacts, events, proposals, invoices, messages, calls, permits, materials } = CRM;
  const contact = contacts.find(c => c.id === contactId);
  const workspaceStatus = CRM.domainStatus?.workspace || { state:'idle', error:null };
  const proposalsStatus = CRM.domainStatus?.proposals || { state:'idle', error:null };
  const moneyStatus = CRM.domainStatus?.money || { state:'idle', error:null };
  const messagesStatus = CRM.domainStatus?.messages || { state:'idle', error:null };
  const commercialReady = proposalsStatus.state === 'ready' && moneyStatus.state === 'ready';
  const overviewReady = workspaceStatus.state === 'ready' && commercialReady && messagesStatus.state === 'ready';
  const overviewError = workspaceStatus.state === 'error' || proposalsStatus.state === 'error'
    || moneyStatus.state === 'error' || messagesStatus.state === 'error';

  if (!contact) return <EmptyHero />;

  // Per-tab filtered slices (derived inline)
  const cEvents    = events.filter(e => e.contact_id === contactId);
  const cProposals = proposals.filter(p => p.contact_id === contactId);
  const cInvoices  = invoices.filter(i => i.contact_id === contactId);
  const cMessages  = messages.filter(m => m.contact_id === contactId);
  const cCalls     = calls.filter(cl => cl.contact_id === contactId);
  const cPermits   = permits.filter(p => p.contact_id === contactId);
  const cMaterials = (materials || []).filter(m => m.contact_id === contactId);

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:BG, minHeight:0 }}>
      <ContactStrip contact={contact} isDnc={dncSet.has(contactId)} toggleDnc={() => toggleDnc(contactId)} bumpData={bumpData} onOpenTab={onOpenTab} tab={tab} onBack={onBack} />
      {tab==='contacts' && (overviewReady
        ? <ContactOverview contact={contact} events={cEvents} permits={cPermits} proposals={cProposals} invoices={cInvoices} materials={cMaterials} messages={cMessages} calls={cCalls} bumpData={bumpData} onOpenTab={onOpenTab} />
        : <div style={{ flex:1, overflowY:'auto', minHeight:0, padding:'0 16px var(--tabbar-clear, calc(env(safe-area-inset-bottom, 0px) + 92px))', display:'flex', flexDirection:'column' }}>
            <ContactHero contact={contact} proposals={[]} nextItem={null} statusReady={false} />
            <DomainTruthPane error={overviewError} loadingText="Loading current project details..." errorText="Project details could not fully load" helper="Quotes, balances, messages, permits, readiness, and photos stay hidden until their source reads settle." />
          </div>)}
      {tab==='calendar' && (workspaceStatus.state === 'ready'
        ? <ContactCalendar contact={contact} events={cEvents} highlightId={highlightId} bumpData={bumpData} onOpenTab={onOpenTab} />
        : <DomainTruthPane error={workspaceStatus.state === 'error'} loadingText="Loading current calendar..." errorText="Calendar could not load" helper="Appointments stay hidden until project data is current." />)}
      {tab==='finance'  && (commercialReady
        ? <ContactFinance contact={contact} proposals={cProposals} invoices={cInvoices} highlightId={highlightId} />
        : <DomainTruthPane error={proposalsStatus.state === 'error' || moneyStatus.state === 'error'} loadingText="Checking quote and balance..." errorText="Money documents could not load" helper="Documents and balances stay hidden until proposals, invoices, and payments agree." />)}
      {tab==='messages' && (messagesStatus.state === 'ready'
        ? <ContactMessages contact={contact} thread={cMessages} isDnc={dncSet.has(contactId)} />
        : <DomainTruthPane error={messagesStatus.state === 'error'} loadingText="Loading current conversation..." errorText="Messages could not load" helper="The conversation stays hidden so missing messages cannot look like an empty thread." />)}
      {tab==='calls'    && <ContactCalls    contact={contact} calls={cCalls} isDnc={dncSet.has(contactId)} />}
      {/* Right-pane Subs tab = THIS contact's assigned sub + job (Key, 2026-07-04).
          The left Subs tab is the whole roster; this is the one job. Reuses the
          SubTabView/SubCard from crm-subs-tab.jsx, which self-fetches and shows
          the "assign a sub" CTA when none. */}
      {tab==='subs'     && (window.SubTabView ? <window.SubTabView contact={contact} /> : <div style={{ padding: 24, fontSize: 13, color: MUTED }}>Loading sub...</div>)}
    </div>
  );
}

function DomainTruthPane({ error, loadingText, errorText, helper }) {
  return (
    <div role={error ? 'alert' : 'status'} style={{ flex:1, padding:28, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', color:MUTED, lineHeight:1.45 }}>
      <div style={{ fontSize:16, fontWeight:700, color:NAVY }}>{error ? errorText : loadingText}</div>
      <div style={{ marginTop:7, maxWidth:420, fontSize:13 }}>{helper}</div>
      {error && <button type="button" onClick={() => window.location.reload()} style={{ marginTop:16, minHeight:44, padding:'0 16px', borderRadius:8, border:'1px solid rgba(27,43,75,.2)', background:'white', color:NAVY, fontFamily:'inherit', fontWeight:700, cursor:'pointer' }}>Try again</button>}
    </div>
  );
}

// ── Contact Strip ─────────────────────────────────────────────────
// Compact strip - keeps the navigation context (name + ••• menu) sticky at
// the top of the right pane. The richer hero (with house image, big name
// overlay, status pill) lives inside ContactInfoSection on the Contact tab.
function ContactStrip({ contact, isDnc, toggleDnc, bumpData, onOpenTab, tab, onBack }) {
  const isPremium = contact.pricing_tier === 'premium' || contact.pricing_tier === 'premium_plus';
  const [auditBusy, setAuditBusy] = React.useState(false);

  const runMoneyAudit = async () => {
    if (auditBusy || !CRM.__invokeFn) return;
    setAuditBusy(true);
    try {
      const { data, error } = await CRM.__invokeFn('record-payment', { body: { action:'reconciliation_report' } });
      if (error || !data?.ok) {
        window.alert('Money audit failed. Try again.');
        return;
      }
      const issues = Array.isArray(data.issues) ? data.issues.slice(0, 8) : [];
      if (!issues.length) {
        window.alert('Money audit complete. No reconciliation issues found.');
        return;
      }
      const lines = issues.map(item => `${item.invoice_document_number || 'Invoice'}: ${String(item.reconciliation_state || 'review required').replaceAll('_', ' ')}`);
      window.alert(`Money audit found ${data.issue_count || issues.length} issue${Number(data.issue_count || issues.length) === 1 ? '' : 's'}.\n\n${lines.join('\n')}`);
    } finally {
      setAuditBusy(false);
    }
  };

  // Pin state shares CRM.contacts as the source of truth (column added
  // 2026-05-09 via migration 20260509140000). Pins now sync between
  // desktop and mobile via the contacts realtime channel; before this
  // change the star lived only in localStorage and never crossed devices.
  const pinned = window.usePinned ? window.usePinned() : new Set();
  const isPinned = pinned.has(contact.id);
  const togglePin = async () => {
    const wasOn = isPinned;
    // Optimistic flip on the live row, then persist + revert on error.
    const live = (CRM.contacts || []).find(c => c.id === contact.id) || contact;
    live.pinned = !wasOn;
    window.dispatchEvent(new CustomEvent('crm-pin-changed'));
    window.dispatchEvent(new CustomEvent('crm-data-changed'));
    if (CRM.__db) {
      const { error } = await CRM.__db.from('contacts')
        .update({ pinned: !wasOn })
        .eq('id', contact.id);
      if (error) {
        live.pinned = wasOn;
        window.dispatchEvent(new CustomEvent('crm-pin-changed'));
        window.dispatchEvent(new CustomEvent('crm-data-changed'));
        window.showToast?.('Pin save failed: ' + error.message);
        return;
      }
    }
    window.showToast?.(wasOn ? 'Unpinned' : 'Pinned to top');
  };

  return (
    <div style={{
      // iOS Phase 1 (Key 2026-07-09): 52px height (comp/HIG-SPEC), near-white
      // background, hairline bottom divider, back chevron on the left when
      // onBack is passed (mobile push view). Kept every existing control:
      // avatar (smaller), name, pin star, per-messages search + templates,
      // overflow menu. Zero action removed.
      // Clear the status bar + Dynamic Island: 52px control row sits BELOW the
      // safe-area inset (this nav bar is at the very top of every pushed view).
      boxSizing:'border-box',
      height:'calc(52px + env(safe-area-inset-top, 0px))',
      paddingTop:'env(safe-area-inset-top, 0px)',
      background:'#f4f5f8',
      borderBottom:'1px solid rgba(27,43,75,0.085)',
      paddingLeft:8, paddingRight:8, display:'flex', alignItems:'center', gap:8,
      flexShrink:0,
    }}>
      {onBack && (
        <button onClick={onBack} aria-label="Back to contacts" type="button"
          className="bpp-ios-navbar-btn">
          <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      )}
      <ContactAvatar contact={contact} size={28} lazy={false} ringColor={(tab === 'messages' || tab === 'calls') && window.lineColorFor ? window.lineColorFor(contact.current_line) : null} />
      <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:8 }}>
        {isPremium && window.tweaksGlobal?.premiumDots !== false && <GoldDot />}
        <span style={{ fontSize:17, fontWeight:700, letterSpacing:'-0.2px', color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', minWidth:0, flex:1 }}>{contactName(contact)}</span>
        <button onClick={togglePin}
          aria-label={isPinned ? 'Unpin contact' : 'Pin contact to top'}
          title={isPinned ? 'Unpin' : 'Pin to top'}
          style={{
            background:'none', border:'none', cursor:'pointer', flexShrink:0,
            width:44, height:44, display:'flex', alignItems:'center', justifyContent:'center',
            color: isPinned ? GOLD : '#D1D5DB', padding:0,
          }}>
          <svg viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </button>
        {isDnc && <span style={{ fontSize:12,fontWeight:700,color:'#991B1B',background:'#FEF2F2',padding:'1px 6px',borderRadius:20, flexShrink:0 }}>DO NOT CONTACT</span>}
      </div>
      {/* In-thread search (CM-2: the search state existed but had no entry
          point, so it was dead code). Magnifier dispatches crm-open-search to
          the ContactMessages listener; shown for DNC too (finding a gate code
          a customer texted is read-only). */}
      {tab === 'messages' && (
        <button onClick={() => window.dispatchEvent(new CustomEvent('crm-open-search', { detail: { contactId: contact.id } }))}
          aria-label="Search conversation" title="Search this conversation"
          style={{ background:'none', border:'none', cursor:'pointer', flexShrink:0, width:44, height:44, display:'flex', alignItems:'center', justifyContent:'center', color:'#5a6478', padding:0 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
      )}
      {/* Quick replies trigger (Key 2026-06-20: moved the Templates button to the
          header next to the star + ... menu, and merged Suggest into it). Shown
          on the messages tab where it inserts into the composer. Dispatches to the
          ContactMessages listener; onOpenTab('messages') keeps the bridge robust. */}
      {tab === 'messages' && !isDnc && (
        <button onClick={() => { onOpenTab?.('messages'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm-open-quickreplies', { detail: { contactId: contact.id } })), 60); }}
          aria-label="Quick replies" title="Quick replies (suggestions + templates)"
          style={{ background:'none', border:'none', cursor:'pointer', flexShrink:0, width:44, height:44, display:'flex', alignItems:'center', justifyContent:'center', color:'#5a6478', padding:0 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M8 10h8M8 13.5h5"/></svg>
        </button>
      )}
      {tab === 'finance' && (
        <button onClick={runMoneyAudit} disabled={auditBusy} type="button"
          className="bpp-ios-navbar-btn" aria-label="Audit money records" title="Audit money records"
          style={{ width:'auto', minWidth:44, padding:'0 8px', fontSize:12, fontWeight:700 }}>
          {auditBusy ? 'Auditing...' : 'Audit money'}
        </button>
      )}
      <ContactOverflowMenu contact={contact} isDnc={isDnc} toggleDnc={toggleDnc} bumpData={bumpData} onOpenTab={onOpenTab} />
    </div>
  );
}

// ── Overflow Menu (right-aligned dropdown anchored to the 3-dots button) ─
function ContactOverflowMenu({ contact, isDnc, toggleDnc, bumpData, onOpenTab }) {
  const [open, setOpen] = React.useState(false);
  const [openSubmenu, setOpenSubmenu] = React.useState(null); // label of open submenu
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setOpenSubmenu(null); } };
    const onKey = e => { if (e.key === 'Escape') { setOpen(false); setOpenSubmenu(null); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => { setOpen(false); setOpenSubmenu(null); };

  const editContact = () => {
    close();
    // Make sure the contacts tab is active before dispatching - otherwise
    // the listener (in ContactInfoSection on the contacts tab) isn't
    // mounted and the event falls into the void.
    onOpenTab?.('contacts');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('crm-edit-contact', { detail: { contactId: contact.id } }));
    }, 60);
  };

  const openInMaps = () => {
    close();
    window.open(`https://maps.apple.com/?q=${encodeURIComponent(contact.address)}`, '_blank', 'noopener,noreferrer');
  };

  const copyPhone = async () => {
    close();
    try {
      const ok = await window.copyText(contact.phone);
      window.showToast?.(ok ? 'Phone copied' : 'Copy failed');
    } catch {
      window.showToast?.('Copy failed');
    }
  };

  // Sweep all per-contact local caches so an archive doesn't leak its
  // drive-time, geocode, job-photos, or pinned status forward indefinitely.
  // Wrapped here so archive + delete share the cleanup.
  const sweepContactLocal = (contactId) => {
    try {
      localStorage.removeItem('bpp_v3_drive:' + contactId);
      localStorage.removeItem('bpp_v3_job_photos:' + contactId);
      // Drop the message-compose draft for this contact too - otherwise
      // a soft-archived contact can resurface their old draft if the
      // status flips back to Active.
      sessionStorage.removeItem('draft:' + contactId);
      // Pinned contacts moved to contacts.pinned column 2026-05-09 -
      // localStorage backfill drains itself on first load. This sweep
      // is now defensive only: if a stale entry sat in some browser,
      // strip it so the migration completes cleanly. Will be deleted
      // entirely after a few weeks.
      try {
        const pinRaw = localStorage.getItem('bpp_v3_pinned_contacts');
        if (pinRaw) {
          const pinned = JSON.parse(pinRaw).filter(id => id !== contactId);
          if (pinned.length === 0) localStorage.removeItem('bpp_v3_pinned_contacts');
          else localStorage.setItem('bpp_v3_pinned_contacts', JSON.stringify(pinned));
        }
      } catch (_) {}
      // Stop any pending scheduled texts for this contact. An archived or
      // deleted contact must NOT receive a real SMS hours later: archived is
      // not do_not_contact, so the server would not block the send, and the
      // inbox scheduled-clock pill already vanished (archived rows are filtered
      // out of the inbox), so the queued send is invisible until it fires.
      // cancelScheduledMessage tombstones (honored even mid-fire by the runner)
      // and fires crm-scheduled-msg-changed, clearing the strip + pill now.
      // Re-schedulable if the archive is undone (audit 2026-06-23).
      try {
        (window.readSchedQueue?.() || [])
          .filter(it => it && it.contactId === contactId)
          .forEach(it => window.cancelScheduledMessage?.(it.id));
      } catch (_) {}
    } catch {}
  };

  const archiveJob = async () => {
    close();
    const ok = await window.confirmAction?.({
      title: 'Archive ' + contactName(contact) + '?',
      body: 'Moves this contact out of the active list. Use Undo within 5 seconds if it was a mistake.',
      confirmLabel: 'Archive',
      destructive: false,
    });
    if (!ok) return;
    // Optimistic-first, then await + revert on error. Yesterday these
    // were fire-and-forget so a failed write would leave the in-memory
    // state diverged from the DB (and on TCPA-sensitive paths like DNC,
    // that's an actual federal-violation risk). Now: optimistic flip,
    // await the write, revert + toast on error.
    contact.archived = true;
    bumpData?.();
    sweepContactLocal(contact.id);
    if (CRM.__db) {
      const { error } = await CRM.__db.from('contacts')
        .update({ status: 'Archived', archived: true })
        .eq('id', contact.id);
      if (error) {
        contact.archived = false;
        bumpData?.();
        window.showToast?.('Archive failed: ' + error.message);
        return;
      }
    }
    window.showToast?.('Job archived', {
      undo: async () => {
        const live = (CRM.contacts || []).find(x => x.id === contact.id) || contact;
        live.archived = false;
        bumpData?.();
        if (CRM.__db) {
          const { error } = await CRM.__db.from('contacts')
            .update({ status: 'Active', archived: false })
            .eq('id', contact.id);
          if (error) {
            live.archived = true;
            bumpData?.();
            window.showToast?.('Undo failed: ' + error.message);
          }
        }
      },
      duration: 5000,
    });
  };

  const markDnc = async () => {
    close();
    if (isDnc) return;
    const ok = await window.confirmAction?.({
      title: 'Stop all comms with ' + contactName(contact) + '?',
      body: 'Messages and calls will be disabled until the flag is removed.',
      confirmLabel: 'Mark do not contact',
      destructive: true,
    });
    if (!ok) return;
    // TCPA-critical: must NOT diverge from DB. Optimistic flip, await,
    // revert on error so a silent failure doesn't leave Key thinking
    // the contact is DNC'd when the DB says otherwise.
    contact.do_not_contact = true;
    toggleDnc?.(contact.id);
    if (CRM.__db) {
      const { error } = await CRM.__db.from('contacts')
        .update({ do_not_contact: true, dnc_at: new Date().toISOString(), dnc_source: 'crm_manual' })
        .eq('id', contact.id);
      if (error) {
        contact.do_not_contact = false;
        toggleDnc?.(contact.id);
        window.showToast?.('DNC failed, contact NOT marked: ' + error.message);
        return;
      }
    }
    // A DNC contact's queued sends would 403 at fire time and surprise Key with
    // a late "not sent" toast, while the strip + inbox pill keep claiming a send
    // is pending. Purge them now so every comms surface tells the truth at once
    // (audit 2026-06-23).
    try {
      (window.readSchedQueue?.() || [])
        .filter(it => it && it.contactId === contact.id)
        .forEach(it => window.cancelScheduledMessage?.(it.id));
    } catch (_) {}
    // Single truthful success toast, fired only after the DB write confirms.
    window.showToast?.('Marked do-not-contact');
  };

  // Symmetric "allow contact again" - without this, removing the DNC flag
  // required Supabase Studio access. Confirm-gated so it's a deliberate
  // action; TCPA-sensitive enough to make Key pause.
  const unmarkDnc = async () => {
    close();
    if (!isDnc) return;
    const ok = await window.confirmAction?.({
      title: 'Allow ' + contactName(contact) + ' to be contacted again?',
      body: 'Make sure they\'ve actually agreed to receive messages again. Removes the DNC flag.',
      confirmLabel: 'Allow again',
    });
    if (!ok) return;
    contact.do_not_contact = false;
    toggleDnc?.(contact.id);
    if (CRM.__db) {
      const { error } = await CRM.__db.from('contacts')
        .update({ do_not_contact: false })
        .eq('id', contact.id);
      if (error) {
        contact.do_not_contact = true;
        toggleDnc?.(contact.id);
        window.showToast?.('Allow-again failed, flag still set: ' + error.message);
        return;
      }
    }
    window.showToast?.(contactName(contact) + ' can be contacted again');
  };

  const deleteContact = async () => {
    close();
    const ok = await window.confirmAction?.({
      title: 'Delete ' + contactName(contact) + '?',
      body: 'Soft-deletes (archives) this contact. Recoverable from the Archived filter chip on the contact list.',
      confirmLabel: 'Delete contact',
      destructive: true,
    });
    if (!ok) return;
    // Soft-delete via archived flag. Mirror the archive flow exactly so
    // restoring works through the same Archived lens.
    contact.archived = true;
    bumpData?.();
    sweepContactLocal(contact.id);
    if (CRM.__db) {
      const { error } = await CRM.__db.from('contacts')
        .update({ status: 'Archived', archived: true })
        .eq('id', contact.id);
      if (error) {
        contact.archived = false;
        bumpData?.();
        window.showToast?.('Delete failed: ' + error.message);
        return;
      }
    }
    window.showToast?.('Contact archived (recoverable from Archived lens)');
  };

  // Snooze - hide a contact for N days. Stored in localStorage so this is
  // a per-device gesture (no DB migration). Snooze auto-clears at the
  // until-date; the overflow menu offers preset durations + a custom date.
  const snooze = async (days) => {
    close();
    const until = new Date(Date.now() + days * 86400000);
    window.snoozeContact?.(contact.id, until.toISOString());
    bumpData?.();
    const niceDate = until.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
    window.showToast?.('Snoozed until ' + niceDate, {
      undo: () => { window.unsnoozeContact?.(contact.id); bumpData?.(); },
      duration: 5000,
    });
  };
  const snoozeCustom = async () => {
    close();
    const default14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0,10);
    const v = window.prompt('Snooze until (YYYY-MM-DD):', default14);
    if (!v) return;
    const parsed = new Date(v + 'T08:00:00');
    if (isNaN(parsed.getTime()) || parsed.getTime() < Date.now()) {
      window.showToast?.('Pick a future date');
      return;
    }
    window.snoozeContact?.(contact.id, parsed.toISOString());
    bumpData?.();
    window.showToast?.('Snoozed until ' + parsed.toLocaleDateString(), {
      undo: () => { window.unsnoozeContact?.(contact.id); bumpData?.(); },
      duration: 5000,
    });
  };
  const unsnooze = () => {
    close();
    window.unsnoozeContact?.(contact.id);
    bumpData?.();
    window.showToast?.('Unsnoozed');
  };
  const snoozedTs = window.snoozedUntil?.(contact.id);
  const snoozedLabel = snoozedTs
    ? new Date(snoozedTs).toLocaleDateString(undefined, { month:'short', day:'numeric' })
    : '';

  // Overflow menu - pruned to actions you can't already do inline. Open in
  // Maps and Copy phone live on their own rows in CONTACT INFO; duplicating
  // them here makes the menu noisy for no benefit. Delete copy now reflects
  // the actual behavior (soft-archive - recoverable, no orphaned records).
  const items = [
    { kind:'item', icon:OFI.pencil, label:'Edit contact', onClick: editContact },
    // Mailing slip lives here too (not only in the Permits card), so it's
    // reachable for ANY contact with an address, not just booked/permit-stage
    // ones (Key 2026-06-15: could not print a slip for a New lead because the
    // Permits card, and its slip button, are hidden until booked). The slip
    // only needs an address; reuses generateMailingInsertPDF.
    { kind:'item',
      icon:(<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M2 4.2l6 4.3 6-4.3"/></svg>),
      label:'Mailing slip (PDF)',
      sub: contact?.address ? 'Print an envelope insert' : 'Add an address first',
      disabled: !contact?.address,
      onClick: () => { setOpen(false); if (contact?.address) generateMailingInsertPDF(contact); } },
    { kind:'divider' },
    snoozedTs
      ? { kind:'item', icon:OFI.clock, label:'Unsnooze', sub:'Currently hidden until ' + snoozedLabel, onClick: unsnooze }
      : { kind:'submenu', icon:OFI.clock, label:'Snooze',
          children: [
            { label:'1 day',     onClick:() => snooze(1) },
            { label:'3 days',    onClick:() => snooze(3) },
            { label:'1 week',    onClick:() => snooze(7) },
            { label:'2 weeks',   onClick:() => snooze(14) },
            { label:'1 month',   onClick:() => snooze(30) },
            { label:'Pick date…', onClick: snoozeCustom },
          ],
        },
    { kind:'item', icon:OFI.archive, label:'Archive job', sub:'Move out of active list', onClick: archiveJob },
    isDnc
      ? { kind:'item', icon:OFI.ban, label:'Allow contact again', onClick: unmarkDnc }
      : { kind:'item', icon:OFI.ban, label:'Mark do not contact', danger:true, onClick: markDnc },
    { kind:'divider' },
    { kind:'item', icon:OFI.trash,  label:'Delete contact', sub:'Hides from the list. Restore from the Archived lens.', danger:true, onClick: deleteContact },
  ];

  return (
    <div ref={wrapRef} style={{ position:'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="More"
        aria-label="More actions"
        style={{
          // 44×44 hit area meets iOS HIG; visual icon stays small.
          width:44, height:44, borderRadius:6,
          background: open ? '#F0F4FF' : 'transparent',
          border:'none',
          color:MUTED, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}
      >
        <div style={{width:14,height:14}}>{Icons.more}</div>
      </button>

      {open && (
        <div style={{
          position:'absolute', right:0, top:'calc(100% + 6px)',
          width:200,
          background:'white',
          border:'1px solid rgba(27,43,75,0.12)',
          borderRadius:12,
          boxShadow:'0 8px 24px rgba(27,43,75,0.16)',
          padding:6, zIndex:60,
        }}>
          {items.map((it, i) => {
            if (it.kind === 'divider') {
              return <div key={'d'+i} style={{ height:1, background:'rgba(27,43,75,0.08)', margin:'4px 4px' }} />;
            }
            const color = it.danger ? '#dc2626' : NAVY;
            // Submenu: clicking the parent toggles an inline-expanded list
            // of choices. Keeps the menu visually contained - no flying
            // side-panels that fall off-screen on narrow CRM panes.
            if (it.kind === 'submenu') {
              const isOpen = openSubmenu === it.label;
              return (
                <React.Fragment key={it.label}>
                  <button
                    onClick={() => setOpenSubmenu(isOpen ? null : it.label)}
                    style={{
                      width:'100%', display:'flex', alignItems:'center', gap:10,
                      minHeight:44, padding:'8px 10px', borderRadius:8,
                      background: isOpen ? '#F0F4FF' : 'none', border:'none', textAlign:'left',
                      cursor:'pointer', fontFamily:'inherit', color: NAVY,
                    }}
                    onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = '#F8F8F6'; }}
                    onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = 'none'; }}
                  >
                    <span style={{ width:14, height:14, flexShrink:0, color: NAVY }}>{it.icon}</span>
                    <span style={{ flex:1, fontSize:13, fontWeight:500 }}>{it.label}</span>
                    <span style={{
                      fontSize:12, color: MUTED,
                      transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
                      transition:'transform 0.12s', display:'inline-block',
                    }}>▶</span>
                  </button>
                  {isOpen && it.children.map((c, ci) => (
                    <button
                      key={c.label}
                      onClick={c.onClick}
                      style={{
                        width:'100%', display:'flex', alignItems:'center',
                        minHeight:44, padding:'6px 10px 6px 34px', borderRadius:8,
                        background:'none', border:'none', textAlign:'left',
                        cursor:'pointer', fontFamily:'inherit', color: NAVY,
                        fontSize:12, lineHeight:1.3,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#F8F8F6'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >{c.label}</button>
                  ))}
                </React.Fragment>
              );
            }
            return (
              <button
                key={it.label}
                onClick={it.onClick}
                disabled={it.disabled}
                style={{
                  width:'100%', display:'flex', alignItems:'center', gap:10,
                  minHeight:44, padding:'8px 10px', borderRadius:8,
                  background:'none', border:'none', textAlign:'left',
                  cursor: it.disabled ? 'not-allowed' : 'pointer',
                  fontFamily:'inherit', color, opacity: it.disabled ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (!it.disabled) e.currentTarget.style.background = '#F8F8F6'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ width:14, height:14, flexShrink:0, marginTop:1, color }}>{it.icon}</span>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:'block', fontSize:13, fontWeight:500, lineHeight:1.3 }}>{it.label}</span>
                  {it.sub && <span style={{ display:'block', fontSize:11, color: it.danger ? 'rgba(220,38,38,0.75)' : '#666', marginTop:1, lineHeight:1.3 }}>{it.sub}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Overflow icons (matched to Icons.* style: 1.5 stroke, currentColor)
const OFI = {
  pencil: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>,
  pin:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-7.58 8-13a8 8 0 1 0-16 0c0 5.42 8 13 8 13z"/><circle cx="12" cy="9" r="2.5"/></svg>,
  copy:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  archive:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><line x1="10" y1="13" x2="14" y2="13"/></svg>,
  ban:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>,
  trash:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  clock:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>,
};

// ── POM Panel Inspection ──────────────────────────────────────────────
// Key sells the $447 Peace of Mind manual. Every install includes a 20-point
// panel safety inspection; this is where Key RECORDS it (Pass/Fail/N/A + an
// optional note per point + the date), and one tap generates the customer's
// POM PDF with the real results filled in (pom-guide/index.html?insp=...).
// Gated to POM-paid contacts only (a proposal with pom_accepted === true),
// per Key 2026-06-05. The 20 points + their order MATCH the PDF exactly so
// the insp string maps 1:1 to the grid. Persists to contacts.pom_inspection
// (jsonb, live in prod); falls back to localStorage if the write fails.
// Ported from staging 2026-06-10 (audited there: blank-start seed so an
// untouched Save can never emit a fake perfect inspection; PDF gated until
// all 20 answered).
const POM_POINTS = [
  'Panel is easily accessible',
  'Panel doors open and close easily',
  'Free from corrosion or damage',
  'Breakers clearly labeled',
  'Cable sheathing properly removed',
  'Breakers match the panel',
  'All breaker spaces properly filled',
  'Free from overcrowding',
  'All knockouts, bushings, screws present',
  'Wires properly colored or marked',
  'Neutral wires properly installed',
  'Proper grounding inside the panel',
  'Smoke alarms under 10 years and working',
  'One wire per lug on each breaker',
  'GFCI/AFCI breakers trip properly',
  'No signs of overheating',
  'Wire in good condition',
  'Main breaker functioning properly',
  'Breakers output correct voltage',
  'Wires secure to breakers and lugs',
];

function SysInput({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display:'block', minWidth:0 }}>
      <span style={{ display:'block', fontSize:11, color:MUTED, marginBottom:3 }}>{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width:'100%', boxSizing:'border-box', fontSize:16, padding:'8px 10px', border:'1px solid #E5E7EB', borderRadius:6, fontFamily:'inherit', color:NAVY }} />
    </label>
  );
}

function POMInspectionModal({ contact, amp, existing, onClose }) {
  // Fresh inspection starts UNANSWERED (blank), never pre-marked Pass, so an
  // untouched Save can never emit a fake "perfect" inspection on the paid PDF.
  const seed = existing && Array.isArray(existing.results) && existing.results.length === POM_POINTS.length
    ? existing.results.slice() : POM_POINTS.map(function(){ return ''; });
  const [results, setResults] = React.useState(seed);
  const [notes, setNotes] = React.useState((existing && existing.notes) || {});
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const [date, setDate] = React.useState((existing && existing.idate) || today);
  const [sys, setSys] = React.useState((existing && existing.sys) || { panel:'', inlet:'', gen:'', interlock:'', circuits:'' });
  const [saving, setSaving] = React.useState(false);

  // Escape closes the modal, matching every other modal in the CRM.
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setSysField = (k, v) => setSys(prev => Object.assign({}, prev, { [k]: v }));
  const setOne  = (i, v) => setResults(prev => prev.map((x, idx) => idx === i ? v : x));
  const setNote = (i, v) => setNotes(prev => Object.assign({}, prev, { [i]: v }));
  const insp = results.join('');
  const passCount = results.filter(r => r === 'P').length;
  const failCount = results.filter(r => r === 'F').length;
  const naCount   = results.filter(r => r === 'N').length;
  const answeredCount = results.filter(r => r === 'P' || r === 'F' || r === 'N').length;
  const complete = answeredCount === POM_POINTS.length;
  const name = (contact.name || '').trim() || 'Customer';
  const sysParams = [['panel_loc', sys.panel], ['inlet_loc', sys.inlet], ['gen', sys.gen], ['interlock', sys.interlock], ['circuits', sys.circuits]]
    .filter(function(pair){ return (pair[1] || '').trim(); })
    .map(function(pair){ return '&' + pair[0] + '=' + encodeURIComponent(pair[1].trim()); }).join('');
  const pdfUrl = `/pom-guide/index.html?amp=${amp}&name=${encodeURIComponent(name)}&insp=${insp}&idate=${encodeURIComponent(date)}` + sysParams;

  const persist = async () => {
    const payload = { results: results, notes: notes, idate: date, sys: sys, saved_at: new Date().toISOString() };
    setSaving(true);
    let dbOk = false;
    try {
      if (CRM.__db) {
        const { error } = await CRM.__db.from('contacts').update({ pom_inspection: payload }).eq('id', contact.id);
        if (!error) { dbOk = true; contact.pom_inspection = payload; }
      }
    } catch (e) {}
    let localOk = false;
    if (dbOk) {
      // DB is now the source of truth; clear the on-device fallback so a stale copy never shadows it.
      try { localStorage.removeItem('bpp_pom_insp_' + contact.id); } catch (e) {}
    } else {
      try { localStorage.setItem('bpp_pom_insp_' + contact.id, JSON.stringify(payload)); localOk = true; } catch (e) {}
    }
    setSaving(false);
    return dbOk ? 'db' : (localOk ? 'local' : false);
  };
  const onSave = async () => {
    const saved = await persist();
    window.showToast?.(saved === 'db' ? 'Inspection saved' : saved === 'local' ? 'Saved on this device only' : 'Save failed');
  };
  const onGenerate = async () => {
    if (!complete) return;
    const saved = await persist();
    if (!saved) window.showToast?.('PDF generated, but the save failed');
    window.open(pdfUrl, '_blank', 'noopener,noreferrer');
  };

  const TOGGLES = [['P', 'Pass', '#065f46', '#D1FAE5'], ['F', 'Fail', '#dc2626', '#FEF2F2'], ['N', 'N/A', '#6b7280', '#F3F4F6']];

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(11,31,59,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'white', borderRadius:14, boxShadow:SHADOW.xl, width:'100%', maxWidth:560, maxHeight:'88vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'16px 18px', borderBottom:'1px solid #EEE', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:NAVY }}>Panel Inspection</div>
            <div style={{ fontSize:12, color:MUTED }}>{name} · 20-point POM checklist</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background:'none', border:'none', fontSize:22, color:MUTED, cursor:'pointer', lineHeight:1, minHeight:44, minWidth:44 }}>×</button>
        </div>
        <div style={{ padding:'10px 18px', borderBottom:'1px solid #F3F4F6', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {complete
            ? <Pill tone={failCount ? 'danger' : 'success'}>{passCount} of {POM_POINTS.length} pass</Pill>
            : <Pill tone="neutral">{answeredCount} of {POM_POINTS.length} answered</Pill>}
          {failCount > 0 && <Pill tone="danger">{failCount} fail</Pill>}
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6 }}>
            <label style={{ fontSize:11, color:MUTED }}>Date</label>
            <input value={date} onChange={e => setDate(e.target.value)} style={{ fontSize:16, padding:'7px 9px', border:'1px solid #E5E7EB', borderRadius:6, width:160, fontFamily:'inherit' }} />
          </div>
        </div>
        <div style={{ overflowY:'auto', padding:'4px 18px', flex:1 }}>
          <div style={{ padding:'10px 0 6px', borderBottom:'1px solid #F6F6F4', marginBottom:6 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase', color:MUTED, marginBottom:8 }}>System details (fills the manual)</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:8 }}>
              <SysInput label="Breaker panel location" value={sys.panel} onChange={v => setSysField('panel', v)} placeholder="e.g. garage, right of door" />
              <SysInput label="Inlet box location" value={sys.inlet} onChange={v => setSysField('inlet', v)} placeholder="e.g. right exterior wall" />
              <SysInput label="Generator make / model" value={sys.gen} onChange={v => setSysField('gen', v)} placeholder="e.g. Generac GP8000E" />
              <SysInput label="Interlock kit" value={sys.interlock} onChange={v => setSysField('interlock', v)} placeholder="e.g. Reliance Controls" />
            </div>
            <div style={{ marginTop:8 }}>
              <SysInput label="Circuits on the interlock (comma separated)" value={sys.circuits} onChange={v => setSysField('circuits', v)} placeholder="Refrigerator, Furnace, Well pump, Kitchen, Sump pump" />
            </div>
          </div>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase', color:MUTED, margin:'2px 0 4px' }}>20-point inspection</div>
          {POM_POINTS.map((pt, i) => (
            <div key={i} style={{ padding:'9px 0', borderBottom: i < POM_POINTS.length - 1 ? '1px solid #F6F6F4' : 'none' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ flex:1, fontSize:13, color:NAVY, minWidth:0, lineHeight:1.3 }}>{i + 1}. {pt}</span>
                <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                  {TOGGLES.map(([code, label, fg, bg]) => (
                    <button key={code} onClick={() => setOne(i, code)} style={{
                      height:44, padding:'0 13px', borderRadius:7, cursor:'pointer', fontFamily:'inherit', fontSize:13, fontWeight:700,
                      border: results[i] === code ? `1.5px solid ${fg}` : '1px solid transparent',
                      background: results[i] === code ? bg : 'white',
                      color: results[i] === code ? fg : '#9ca3af',
                    }}>{label}</button>
                  ))}
                </div>
              </div>
              {(results[i] === 'F' || results[i] === 'N') && (
                <input value={notes[i] || ''} onChange={e => setNote(i, e.target.value)} placeholder="Internal note (stays in the CRM, not on the customer PDF)"
                  style={{ marginTop:6, width:'100%', boxSizing:'border-box', fontSize:16, padding:'8px 10px', border:'1px solid #E5E7EB', borderRadius:6, fontFamily:'inherit', color:NAVY }} />
              )}
            </div>
          ))}
        </div>
        <div style={{ padding:'10px 18px calc(12px + env(safe-area-inset-bottom, 0px))', borderTop:'1px solid #EEE' }}>
          <div style={{ fontSize:11, color:MUTED, marginBottom:8, lineHeight:1.4 }}>The PDF includes a scope and liability note: we verify the panel but are not responsible for equipment we did not install.</div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onClose} style={{ flex:'0 0 auto', height:44, padding:'0 16px', borderRadius:8, border:'1px solid #E5E7EB', background:'white', color:NAVY, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
            <button onClick={onSave} disabled={saving} style={{ flex:'1 1 0', height:44, borderRadius:8, border:'1px solid rgba(11,31,59,0.15)', background:'white', color:NAVY, fontWeight:600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily:'inherit' }}>{saving ? 'Saving' : 'Save'}</button>
            <button onClick={onGenerate} disabled={!complete} title={complete ? '' : 'Answer all 20 points before generating the PDF'} style={{ flex:'1 1 0', height:44, borderRadius:8, border:'none', background: complete ? GOLD : '#E5E7EB', color: complete ? NAVY : '#9ca3af', fontWeight:700, cursor: complete ? 'pointer' : 'not-allowed', fontFamily:'inherit' }}>Save + Generate PDF</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function POMInspectionButton({ contact, proposals }) {
  const [open, setOpen] = React.useState(false);
  // Gate: only contacts who bought POM (a proposal with pom_accepted === true).
  const pomProposal = (proposals || []).find(p => p.pom_accepted && !p.superseded_at);
  const amp = pomProposal ? (String(pomProposal.amp_spec || pomProposal.amp_type || '30').indexOf('50') >= 0 ? '50' : '30') : '30';
  // Read: prefer whichever of the DB copy and the on-device fallback has the newer saved_at.
  let local = null;
  try { local = JSON.parse(localStorage.getItem('bpp_pom_insp_' + contact.id) || 'null'); } catch (e) { local = null; }
  let existing = contact.pom_inspection;
  const localIsNewer = !!(local && (!existing || String(local.saved_at || '') > String(existing.saved_at || '')));
  if (localIsNewer) existing = local;
  // A newer on-device copy means the original DB write failed; retry it best-effort.
  React.useEffect(() => {
    if (!localIsNewer || !CRM.__db) return;
    CRM.__db.from('contacts').update({ pom_inspection: local }).eq('id', contact.id).then(({ error }) => {
      if (!error) {
        contact.pom_inspection = local;
        try { localStorage.removeItem('bpp_pom_insp_' + contact.id); } catch (e) {}
      }
    });
  }, [contact.id, localIsNewer]);
  if (!pomProposal) return null;
  const cardResults = existing && Array.isArray(existing.results) && existing.results.length === 20 ? existing.results : null;
  const answered = cardResults ? cardResults.filter(r => r === 'P' || r === 'F' || r === 'N').length : 0;
  const pass = cardResults ? cardResults.filter(r => r === 'P').length : null;
  return (
    <InfoSection title="POM Panel Inspection">
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ flex:1, minWidth:160 }}>
          {existing
            ? <div style={{ fontSize:13, color:NAVY }}>{answered === 20 ? `${pass} of 20 passed` : `${answered} of 20 answered`}{existing.idate ? ' · ' + existing.idate : ''}</div>
            : <div style={{ fontSize:13, color:MUTED }}>Paid for the Peace of Mind manual. Run the 20-point panel inspection, it auto-fills their PDF.</div>}
        </div>
        <GoldActionBtn onClick={() => setOpen(true)}>{existing ? 'Edit / regenerate' : 'Do inspection'}</GoldActionBtn>
      </div>
      {open && <POMInspectionModal contact={contact} amp={amp} existing={existing} onClose={() => setOpen(false)} />}
    </InfoSection>
  );
}

// ── Contact-card overhaul (2026-06-24, brief: contact-card-overhaul) ──
// A 2-second human+job briefing at the top of the panel: HERO (who + where),
// BRIEF (ai_summary, how Key KNOWS them), then the existing Right-Now action,
// a Setup-at-a-glance tile block, and the demoted Contact rows. These three
// helpers are the only net-new visual; everything below the Setup block reuses
// the existing components/logic unchanged.

// Short, human status word derived from stage + latest proposal status. Drives
// the small pill on the hero. Prefers an approved/booked/installed read over the
// raw stage label so the word matches where the JOB actually is.
function shortStatusLabel(contact, proposals = []) {
  const stage = contact.stage;
  // Installed / done first (terminal, most informative).
  if (stage === 'done') return 'Installed';
  if (stage === 'install') return 'Installing';
  if (stage === 'permit_approved') return 'Permit OK';
  if (stage === 'permit_waiting' || stage === 'permit_submit') return 'Permitting';
  if (stage === 'booked') return 'Booked';
  // Only authoritative Approved truth may report acceptance. Historical
  // unpaid Signed rows remain visible in Documents as Not accepted.
  const hasApproved = proposals.some(p => p.status === 'approved');
  if (hasApproved) return 'Approved';
  if (stage === 'quoted') return 'Quoted';
  if (stage === 'new') return 'New lead';
  // Fallback to the canonical stage label so the pill is never blank.
  return (CRM.STAGE_LABELS && CRM.STAGE_LABELS[stage]) || 'Lead';
}

// HERO , full-width property image with a name/city overlay + status pill.
// Property bytes come only from the authenticated, address-bound gateway.
// Missing or unverifiable imagery uses the neutral navy fallback. The hero used
// to live INSIDE
// ContactInfoSection; the overhaul promotes it to its own top block so the
// demoted Contact section renders rows only (no duplicate hero).
function ContactHero({ contact, proposals = [], nextItem = null, statusReady = true }) {
  const propertyImage = useContactPropertyImage(contact);
  const heroUrl = propertyImage.status === 'ready' ? propertyImage.url : null;

  // City = the segment after the street in the address ("123 Main St, Inman, SC"
  // -> "Inman"). Falls back to nothing rather than echoing the street.
  const city = (contact.address || '').split(',').slice(1, 2).join('').trim();
  const statusWord = shortStatusLabel(contact, proposals);
  const isPremium = contact.pricing_tier === 'premium' || contact.pricing_tier === 'premium_plus';
  const name = (typeof contactName === 'function') ? contactName(contact) : (contact.name || 'Contact');
  // Zone-1 recognition hero (Comp B slice 3, Key 2026-07-01): the home photo grows
  // into a real memory anchor carrying the 2-3 glance facts. Amperage joins the
  // city line; drive-time moves onto the hero (off its wasted contact-card row);
  // the image stays INERT and the ONLY tappable element is the map-pin chip.
  const amp = contact.amperage ? String(contact.amperage).trim() : '';
  const canMap = isAddressableStreet(contact.address);

  return (
    <div style={{
      position:'relative', marginTop:12, height:220, borderRadius:16, overflow:'hidden',
      background:'linear-gradient(160deg, #243a63 0%, #1B2B4B 55%, #14223d 100%)',
      boxShadow:'0 1px 3px rgba(27,43,75,.10)',
    }}>
      {heroUrl && (
        <img
          src={heroUrl}
          alt=""
          data-property-image-identity={propertyImage.propertyImageIdentity}
          loading="lazy"
          decoding="async"
          onError={propertyImage.reportPropertyImageFailure}
          style={{
            position:'absolute', inset:0, width:'100%', height:'100%',
            objectFit:'cover', objectPosition:'50% 35%',
            filter:'saturate(1.15) contrast(1.04)', display:'block',
          }}
        />
      )}
      {/* Bottom-up dark scrim so white text stays AA-legible over any image. */}
      <div style={{
        position:'absolute', inset:0,
        background:'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.45) 70%, rgba(0,0,0,0.82) 100%)',
        pointerEvents:'none',
      }} />
      {/* Status pill, top-right (premium gets the gold treatment). */}
      <div style={{ position:'absolute', top:12, right:12, display:'flex', gap:6, alignItems:'center' }}>
        {isPremium && (
          <span style={{
            fontSize:11, fontWeight:700, color:NAVY, background:GOLD, padding:'3px 9px',
            borderRadius:20, letterSpacing:'0.04em', whiteSpace:'nowrap',
          }}>{contact.pricing_tier === 'premium_plus' ? 'PREMIUM+' : 'PREMIUM'}</span>
        )}
        {statusReady && <span style={{
          fontSize:12, fontWeight:700, color:'white', background:'rgba(0,0,0,0.45)',
          backdropFilter:'blur(4px)', WebkitBackdropFilter:'blur(4px)',
          border:'1px solid rgba(255,255,255,0.35)', padding:'4px 11px', borderRadius:20,
          letterSpacing:'0.02em', whiteSpace:'nowrap', textShadow:'0 1px 2px rgba(0,0,0,0.4)',
        }}>{statusWord}</span>}
      </div>
      {/* Name + city + amperage, bottom-left (right edge leaves room for the
          drive-time chip so a long name ellipsizes rather than colliding). */}
      <div style={{ position:'absolute', left:16, right:150, bottom: nextItem ? 50 : 14 }}>
        <div style={{
          fontSize:22, fontWeight:800, color:'white', lineHeight:1.12,
          textShadow:'0 1px 5px rgba(0,0,0,0.55)',
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>{name}</div>
        {(city || amp) && (
          <div style={{
            fontSize:13, color:'rgba(255,255,255,0.85)', marginTop:2,
            textShadow:'0 1px 3px rgba(0,0,0,0.5)',
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
          }}>{[city, amp ? amp + 'A panel' : ''].filter(Boolean).join('  ·  ')}</div>
        )}
      </div>
      {/* Drive-time, bottom-right (lifted above the NEXT strip when present so it
          never collides with the name or the strip; returns null while loading /
          when unknown, so no stale number). */}
      <div style={{ position:'absolute', right:16, bottom: nextItem ? 50 : 16, maxWidth:180 }}>
        <DriveTimeBadge contact={contact} dark />
      </div>
      {/* NEXT signpost strip (slice 1, Comp v2): the single next action pinned to
          the very bottom edge of the hero over its own darker gradient. INERT , a
          signpost, not a control (eyebrow + plain text, no pill/underline/chevron);
          the real gold action lives in the DO NEXT card below. Renders nothing for
          terminal/complete + archived + do-not-contact-with-no-verb (nextItem null). */}
      {nextItem && (
        <div style={{
          position:'absolute', left:0, right:0, bottom:0, zIndex:2,
          display:'flex', alignItems:'baseline', gap:9, padding:'9px 16px 11px',
          background:'linear-gradient(to top, rgba(7,15,30,.94) 0%, rgba(7,15,30,.55) 100%)',
        }}>
          <span style={{ flexShrink:0, fontSize:10.5, fontWeight:700, letterSpacing:'0.14em', textTransform:'uppercase', color:'#8195b4' }}>Next</span>
          <span style={{ fontSize:15, fontWeight:600, color:'#fff', lineHeight:1.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', minWidth:0 }}>{nextItem}</span>
        </div>
      )}
      {/* The ONE tappable element on the hero: an explicit Open-in-Maps pin chip.
          The image itself is inert (no Norman door, mustFix N1). */}
      {canMap && (
        <button onClick={(e) => { e.stopPropagation(); window.open('https://maps.apple.com/?q=' + encodeURIComponent((contact.address || '').trim()), '_blank', 'noopener,noreferrer'); }}
          aria-label="Open in Maps"
          style={{
            position:'absolute', top:12, left:12, display:'inline-flex', alignItems:'center', gap:5,
            fontSize:12, fontWeight:700, color:'white', background:'rgba(0,0,0,0.5)',
            backdropFilter:'blur(4px)', WebkitBackdropFilter:'blur(4px)',
            border:'1px solid rgba(255,255,255,0.3)', borderRadius:20, padding:'6px 11px',
            cursor:'pointer', WebkitTapHighlightColor:'transparent',
          }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
          Open in Maps
        </button>
      )}
      {propertyImage.status === 'error' && (
        <button
          type="button"
          aria-label="Retry property image"
          onClick={propertyImage.retryPropertyImage}
          style={{
            position:'absolute', top:52, left:12, minHeight:44, padding:'8px 12px',
            border:'1px solid rgba(255,255,255,0.35)', borderRadius:20,
            color:'white', background:'rgba(0,0,0,0.55)', fontSize:12,
            fontWeight:700, cursor:'pointer',
          }}
        >Retry image</button>
      )}
    </div>
  );
}

// SETUP AT A GLANCE , the technical job facts as tiles, not a vertical list.
// amperage + generator as a 2-up responsive grid (auto-fit, min 140px, so the
// grid stays clean from ~340px to ~520px), panel_location as a full-width tile
// below, availability_notes as a quiet line under the tiles. Each tile renders
// ONLY when its value exists; the whole card renders only when there is at
// least one fact (else returns null, no empty card). These values used to live
// as three InfoLineRows inside ContactInfoRows (now removed there).
function JobSetupCard({ contact }) {
  const amperage = contact.amperage ? String(contact.amperage).trim() : '';
  const generator = contact.generator ? String(contact.generator).trim() : '';
  const panel = contact.panel_location
    ? String(contact.panel_location).replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()).trim()
    : '';
  const availability = contact.availability_notes ? String(contact.availability_notes).trim() : '';
  if (!amperage && !generator && !panel && !availability) return null;

  const ICON_BOLT = (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
  );
  const ICON_GEN = (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="12" rx="2"/><path d="M7 7V5h10v2M8 12h4M16 11v2"/></svg>
  );
  const ICON_PANEL = (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h3"/></svg>
  );

  const Tile = ({ icon, label, value, full }) => (
    <div style={{
      gridColumn: full ? '1 / -1' : 'auto',
      background:'#f7f8fa', border:'1px solid #eef0f4', borderRadius:10, padding:'10px 12px',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:5, color:MUTED, marginBottom:3 }}>
        {icon}
        <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>{label}</span>
      </div>
      <div style={{ fontSize:16, fontWeight:600, color:NAVY, lineHeight:1.25, wordBreak:'break-word' }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      background:'white', marginTop:12, padding:'12px 14px',
      border:0, borderRadius:16, boxShadow:'inset 0 0 0 1px rgba(27,43,75,0.085)',
    }}>
      <div style={{ fontSize:11, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Setup</div>
      {(amperage || generator) && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:8 }}>
          {amperage && <Tile icon={ICON_BOLT} label="Amperage" value={amperage} />}
          {generator && <Tile icon={ICON_GEN} label="Generator" value={generator} />}
        </div>
      )}
      {panel && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8, marginTop:(amperage || generator) ? 8 : 0 }}>
          <Tile icon={ICON_PANEL} label="Panel location" value={panel} full />
        </div>
      )}
      {availability && (
        <div style={{ fontSize:13, color:MUTED, marginTop:10, lineHeight:1.45 }}>
          <span style={{ fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.06em', fontSize:11, marginRight:6 }}>Availability</span>
          {availability}
        </div>
      )}
    </div>
  );
}

function qwv2OperatorText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value).replace(/_/g, ' ').trim();
}

function qwv2ObjectLine(value, keys) {
  if (!value || typeof value !== 'object') return '';
  return keys.map(key => qwv2OperatorText(value[key])).filter(Boolean).join(' · ');
}

function QuoteWalkOperatorCard({ contact, receipt, bumpData }) {
  const projection = window.CRM?.quoteWalkV2OperatorProjection?.(receipt);
  const display = window.CRM?.quoteWalkV2OperatorDisplay?.(projection);
  const [claiming, setClaiming] = React.useState(false);
  const [claimError, setClaimError] = React.useState('');
  const claimInFlightRef = React.useRef(false);
  if (!projection || projection.availability !== 'available') return null;

  const claim = async () => {
    if (claimInFlightRef.current || !projection.actionable || contact.do_not_contact) return;
    claimInFlightRef.current = true;
    setClaiming(true);
    setClaimError('');
    let result;
    try {
      result = window.CRM?.claimQuoteWalkV2Handoff
        ? await window.CRM.claimQuoteWalkV2Handoff(contact)
        : { ok: false, error: 'Quote Desk claim is unavailable.' };
    } catch (error) {
      result = { ok: false, error: error?.message || 'Quote Desk claim failed.' };
    } finally {
      claimInFlightRef.current = false;
      setClaiming(false);
    }
    if (!result.ok) {
      setClaimError(result.error || 'Quote Desk claim failed.');
      return;
    }
    bumpData?.();
  };

  const setup = projection.setup || {};
  const address = projection.address || {};
  const range = projection.range || {};
  const acceptance = projection.acceptance || {};
  const guide = projection.guide || {};
  const handoff = projection.handoff || {};
  const reminder = projection.reminder || {};
  const track = reminder.track || {};
  const latest = reminder.latestReceipt || {};
  const suppression = reminder.suppression || {};

  return (
    <InfoSection title="Quote Walk">
      <InfoLineRow
        label="Current step"
        value={[
          qwv2OperatorText(projection.journey.stage),
          qwv2OperatorText(projection.journey.status),
          qwv2OperatorText(projection.journey.currentStep),
        ].filter(Boolean).join(' · ') || 'Quote Walk'}
      />
      <InfoLineRow label="Last activity" value={qwv2OperatorText(projection.journey.lastActivityAt) || 'Not recorded'} />
      {!projection.history && <InfoLineRow label="Next action" value={qwv2OperatorText(display?.nextAction) || 'None'} />}
      <InfoLineRow
        label="Readiness blockers"
        value={projection.blockers.all.length
          ? projection.blockers.all.map(qwv2OperatorText).join(', ')
          : 'None'}
      />
      <InfoLineRow
        label="Observed connections"
        value={setup.observedConnections.map(qwv2OperatorText).join(' + ') || 'Not recorded'}
      />
      <InfoLineRow label="Pricing basis" value={qwv2OperatorText(setup.pricingBasis) || 'Not available'} />
      <InfoLineRow
        label="Panel and distance"
        value={[
          qwv2OperatorText(setup.panelLocation),
          qwv2OperatorText(setup.panelLocationStatus),
          qwv2OperatorText(setup.distanceBand),
        ].filter(Boolean).join(' · ') || 'Not complete'}
      />
      <InfoLineRow label="Setup source" value={qwv2OperatorText(setup.provenance) || 'Not recorded'} />
      <InfoLineRow
        label="Verified address"
        value={qwv2ObjectLine(address, ['formatted_address', 'address', 'county', 'service_area_status', 'verification_status']) || 'Not verified'}
      />
      {projection.panels.map((panel, index) => (
        <InfoLineRow
          key={'qwv2-panel-' + (panel.id || index)}
          label={'Panel ' + (index + 1)}
          value={qwv2ObjectLine(panel, ['label', 'location', 'status', 'provenance']) || 'Recorded'}
        />
      ))}
      {projection.media.map((media, index) => (
        <InfoLineRow
          key={'qwv2-media-' + (media.id || index)}
          label={'Photo ' + (index + 1)}
          value={qwv2ObjectLine(media, ['kind', 'panel_id', 'status', 'provenance']) || 'Recorded'}
        />
      ))}
      <InfoLineRow label="Current range" value={qwv2ObjectLine(range, ['display', 'range_label', 'low', 'high', 'pricing_basis', 'status']) || 'Not generated'} />
      <InfoLineRow label="Range acceptance" value={qwv2ObjectLine(acceptance, ['status', 'accepted_at', 'snapshot_id']) || 'Not accepted'} />
      <InfoLineRow label="Guide" value={qwv2ObjectLine(guide, ['status', 'title', 'bound_at']) || 'Not earned'} />
      <InfoLineRow label="Quote Desk handoff" value={qwv2ObjectLine(handoff, ['status', 'claimed_at', 'completed_at']) || 'Not ready'} />
      <InfoLineRow label="Reminder track" value={qwv2ObjectLine(track, ['state', 'track', 'slot', 'due_at', 'next_due_at']) || 'None'} />
      <InfoLineRow label="Reminder result" value={qwv2ObjectLine(latest, ['result', 'status', 'attempted_at', 'retry_at', 'error']) || 'None'} />
      <InfoLineRow label="Reminder suppression" value={qwv2ObjectLine(suppression, ['state', 'reason', 'suppressed_at']) || 'None'} />
      {projection.history && <InfoLineRow label="Quote Desk" value="Read-only history" />}
      {!projection.history && projection.actionable && (
        <InfoLineRow
          label="Quote Desk"
          value={contact.do_not_contact ? 'Blocked by do not contact' : 'Current accepted journey is ready'}
          actions={!contact.do_not_contact ? (
            <GoldActionBtn onClick={claim}>{claiming ? 'Claiming...' : 'Claim'}</GoldActionBtn>
          ) : null}
        />
      )}
      {claimError && <InfoLineRow label="Claim recovery" value={claimError + ' Try again when the issue is resolved.'} />}
    </InfoSection>
  );
}

// ── Contact Overview ──────────────────────────────────────────────
function ContactOverview({ contact, events, permits = [], proposals = [], materials = [], invoices = [], messages = [], calls = [], bumpData, onOpenTab }) {
  const [note, setNote] = React.useState(contact.notes || '');
  const [noteSaving, setNoteSaving] = React.useState(false);
  const [noteSaved, setNoteSaved] = React.useState(false);
  // Track which contact our `note` state was loaded for - guards the
  // auto-save against a 1-frame race where a contact switch reseeds
  // `note` from the new contact but the auto-save effect still has the
  // OLD contact's text in its closure. Without this, switching contacts
  // mid-typing could overwrite the new contact's notes with the prior
  // contact's text.
  const loadedForContactId = React.useRef(contact.id);
  React.useEffect(() => {
    setNote(contact.notes || '');
    setNoteSaved(false);
    loadedForContactId.current = contact.id;
  }, [contact.id]);
  // Debounced auto-save: 800ms after the last keystroke, persist to contacts.notes.
  React.useEffect(() => {
    if (loadedForContactId.current !== contact.id) return; // race guard
    if (note === (contact.notes || '')) return;
    const timer = setTimeout(async () => {
      if (!CRM.__db) return;
      // Re-check at fire time - a contact switch could have happened
      // during the 800ms debounce.
      if (loadedForContactId.current !== contact.id) return;
      setNoteSaving(true);
      const { error } = await CRM.__db.from('contacts').update({ notes: note }).eq('id', contact.id);
      setNoteSaving(false);
      if (error) { window.showToast?.(`Notes save failed: ${error.message}`); return; }
      contact.notes = note;
      setNoteSaved(true);
      // Audit-2026-05-09 H11: capture the contact id at the time the
      // saved-flag was set; if user switches contacts before the 1800ms
      // tick fires, only clear the flag when we're still on the original
      // contact (otherwise the new contact's render briefly flickers).
      const savedFor = contact.id;
      setTimeout(() => {
        if (loadedForContactId.current === savedFor) setNoteSaved(false);
      }, 1800);
    }, 800);
    return () => clearTimeout(timer);
  }, [note, contact.id]);

  // Pre-read lifted into ContactOverview (slice 5) so the KNOW card can gate on its
  // EXISTENCE , PreReadRow used to self-fetch; it now takes the fetched result as a
  // prop so there is ONE fetch and the KNOW card can render even when a pre-read is
  // its only content. Mirrors PreReadRow's old effect exactly.
  const [preRead, setPreRead] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    setPreRead(null);
    if (window.CRM?.fetchPreRead) window.CRM.fetchPreRead(contact.id).then(r => { if (alive) setPreRead(r); });
    return () => { alive = false; };
  }, [contact.id]);

  const sortedEvents = [...events].filter(e => e.status === 'scheduled').sort((a,b) => (a.start_at||'').localeCompare(b.start_at||''));
  const todayEvent = sortedEvents.find(e => dayKey(e.start_at) === TODAY);
  const nextEvent  = sortedEvents.find(e => dayKey(e.start_at) >  TODAY);

  // Install spec ALWAYS comes from the latest signed proposal - sorting by
  // signed-at (mapped to approved_at) descending. If the freshest signed
  // proposal has no amp_spec, the InstallSpec card shows "-" rather than
  // falling back to a stale older proposal's amp.
  const latestSigned = proposals
    .filter(p => p.status === 'approved')
    .sort((a,b) => (b.approved_at || '').localeCompare(a.approved_at || ''))[0];
  const ampSpec = latestSigned?.amp_spec || null;

  // InstallSpecCard's extra door (adversarial review 2026-07-02): the parts
  // list used to render ONLY when a proposal was signed, but the AdvanceJobCard's
  // order_parts state fires for any booked+ job, so on a manually-staged job the
  // "Open parts list" route hit a null #materials-anchor and showed a misleading
  // toast. Mirror PermitsCard's extra door: also render for a booked+ stage OR
  // when materials rows already exist, so the anchor is present wherever
  // order_parts can show. The card's own "Awaiting signed proposal" state covers
  // the no-spec case, keeping the pre-deal view clean.
  const _stageNum = (window.CRM?.STAGE_STR_TO_NUM?.[contact.stage]) ?? 0;
  const _bookedNum = (window.CRM?.STAGE_STR_TO_NUM?.booked) ?? 3;
  const showInstallSpec = !!latestSigned || _stageNum >= _bookedNum || (materials && materials.length > 0);

  const cPermit = permits[0] || null;

  // Money status - what does Key need to know about money on this contact
  // RIGHT NOW? Surfaces unpaid invoices and signed-but-unsent proposals so
  // payment-chase moments aren't buried one tab away. The single most
  // valuable line of data on a Booked-or-later contact.
  // Key's billing rule: customers don't owe anything until after the
  // install. Pre-install sent invoices are "Pending install" (blue,
  // quiet); post-install sent invoices are "Awaiting payment" (amber).
  // Overdue stays red regardless.
  // Use the same shared inference as the global Today panel: stage check
  // OR past install event OR (signed proposal + invoice >= 7d) means
  // installed. Without inference #3 the single-contact view would still
  // miss every Key-didn't-advance-stage installed customer. Pass an
  // array of [contact] so buildInstalledSet's contact loop sees them.
  const __installedSet = React.useMemo(
    () => buildInstalledSet([contact], events, proposals, invoices),
    [contact, events, proposals, invoices]
  );
  const installed = __installedSet.has(contact.id);
  const unpaidInvoices = invoices.filter(i => i.status === 'sent' && !isInvoiceOverdue(i, __installedSet));
  const overdueInvoices = invoices.filter(i => isInvoiceOverdue(i, __installedSet));
  const moneyOwed = [...overdueInvoices, ...unpaidInvoices].reduce((s,i) => s + (i.amount_cents || 0), 0);
  const hasOverdue = overdueInvoices.length > 0;
  // 2026-05-26 audit: signed proposals with no matching invoice were
  // invisible. Phyllis case: signed $1197 18d ago, no invoice at all.
  // Compute unbilled = max(signed proposal total, 0) - total invoiced;
  // surface as the pill when there's no normal balance to chase but
  // money is still on the table.
  // A legacy unpaid Signed proposal must not trigger booked revenue or payment
  // actions. It remains preserved for an explicit audit/reset.
  const liveSignedProposals = proposals
    .filter(p => p.approved_at && !p.superseded_at && p.status !== 'cancelled' && p.status !== 'signed')
    .sort((a, b) => (b.approved_at || '').localeCompare(a.approved_at || ''));
  const latestSignedTotalCents = liveSignedProposals[0]?.amount_cents || 0;
  const totalInvoicedCents = invoices
    .filter(i => i.status !== 'cancelled' && i.status !== 'voided' && i.status !== 'refunded')
    .reduce((s, i) => s + (i.amount_cents || 0), 0);
  const unbilledCents = latestSignedTotalCents - totalInvoicedCents;
  const hasUnbilled = liveSignedProposals.length > 0 && unbilledCents >= latestSignedTotalCents * 0.2;
  const unbilledDays = hasUnbilled
    ? Math.floor((Date.now() - new Date(liveSignedProposals[0].approved_at).getTime()) / 86400000)
    : 0;
  const moneyStatus = moneyOwed > 0 ? (
    installed
      ? {
          cents: moneyOwed,
          label: hasOverdue ? 'Owed (overdue)' : 'Awaiting payment',
          color: hasOverdue ? '#991B1B' : '#92400E',
          bg:    hasOverdue ? '#FEF2F2' : '#FFFBEB',
          border:hasOverdue ? '#FECACA' : '#FDE68A',
        }
      : {
          cents: moneyOwed,
          label: 'Pending install',
          color: '#1E40AF',
          bg: '#EFF6FF',
          border: '#BFDBFE',
        }
  ) : hasUnbilled ? {
    cents: unbilledCents,
    label: unbilledDays >= 14 ? `Unbilled · ${unbilledDays}d` : 'Send invoice',
    color: '#7C2D12',
    bg: '#FEF2F2',
    border: '#FECACA',
    isUnbilled: true,
  } : null;

  // Hierarchy (Key decision 2026-06-09 Q10, action-first): the advance-job
  // "Next step" card renders at the TOP of the panel, so the one thing to do
  // on a job in flight is the first thing seen. The old "No install scheduled"
  // pill is deleted (fully redundant: that state IS the card's schedule_install,
  // which also auto-opens the add-event form). The money pill survives but is
  // suppressed when the card already says Record payment.
  const nextStep = (typeof window.CRM?.advanceJobNext === 'function')
    ? window.CRM.advanceJobNext(contact, { permits, events, invoices })
    : null;
  const showNextStepCard = nextStep && nextStep.state !== 'front_half';

  // Hero NEXT signpost (slice 1, Comp v2): the single next action surfaced on the
  // recognition hero so the one thing to do stays visible at the top even though
  // the full DO NEXT card now sits below Contact. Reuses the SAME nextStep engine
  // the DO NEXT card uses, so the hero line and the card can never disagree.
  // Terminal 'complete' -> no line; blocked -> "Resolve permit blocker"; front-half
  // prefers a needs-reply nudge (NEVER for a do-not-contact contact, TCPA; archived
  // front-half has no next action) over the bare stage verb.
  const heroNext = React.useMemo(() => {
    if (nextStep && nextStep.state === 'complete') return null;
    if (nextStep && nextStep.state !== 'front_half') {
      if (nextStep.state === 'permit_blocked' || nextStep.state === 'permit_rejected') return 'Resolve permit blocker';
      return nextStep.label || null;
    }
    // front-half
    if (contact.archived) return null;
    if (!contact.do_not_contact) {
      const talk = (messages || []).filter(m => m.kind !== 'note' && m.kind !== 'system');
      if (talk.length) {
        const sorted = talk.slice().sort((a, b) => (a.sent_at || '').localeCompare(b.sent_at || ''));
        const last = sorted[sorted.length - 1];
        if (last && last.direction === 'in') {
          const rel = (typeof formatRelative === 'function') ? formatRelative(last.sent_at) : '';
          return rel ? `Reply · ${rel}` : 'Reply';
        }
      }
    }
    const v = (typeof stageActionVerbFor === 'function') ? stageActionVerbFor(contact.stage) : null;
    return (v && v !== 'Move forward') ? v : null;
  }, [contact, nextStep, messages]);

  // Quote Desk (2026-07-13): when a walk / pre-read is ready and there is no
  // live proposal, promote firm-quote SMS + one-tap draft proposal into DO NEXT
  // instead of the bare "Send proposal" stage verb (which only opened the
  // empty creator). Walk showed a range; Key still sends the firm number.
  const quoteWalkReceipt = window.CRM?.quoteWalkV2Receipts?.[String(contact.id)];
  const quoteWalkMode = window.CRM?.quoteWalkV2ReceiptMode?.(quoteWalkReceipt) || 'unavailable';
  const legacyQuoteReady = quoteWalkMode === 'legacy'
    && typeof window.CRM?.isQuoteDeskReady === 'function'
    && window.CRM.isQuoteDeskReady(contact, preRead, proposals);
  const quoteDeskState = window.CRM?.quoteWalkV2QuoteDeskState?.(
    quoteWalkReceipt,
    legacyQuoteReady
  );
  const showQuoteDesk = !!(
    nextStep && nextStep.state === 'front_half'
    && !contact.archived
    && quoteDeskState?.actionable
  );
  const frontHalfVerb = (!showQuoteDesk && nextStep && nextStep.state === 'front_half' && !contact.archived && typeof stageActionVerbFor === 'function')
    ? stageActionVerbFor(contact.stage) : null;
  const frontHalfPrimary = !!(frontHalfVerb && frontHalfVerb !== 'Move forward');

  // RIGHT NOW context line: surface today's event as one quiet line folded into
  // that zone (replaces the standalone amber Today banner) so the zone has one
  // primary action + at most one context line, never competing colored cards.
  const rightNowHasContent = showNextStepCard
    || showQuoteDesk
    || frontHalfPrimary
    || todayEvent
    || (moneyStatus && nextStep?.state !== 'record_payment');

  // KNOW card data (slice 4, Comp v2): the reference/intelligence members , Brief,
  // Setup facts (rendered as compact chips), and the predicted jurisdiction , each
  // independently gated so the card renders NOTHING when a bare lead has no facts
  // (no empty shell). Pre-read + installer + AI suggestions join this card in slices
  // 5-6. This is the consolidation that ends the "scattered AI".
  const briefText = (contact.ai_summary && String(contact.ai_summary).trim()) || '';
  const kAmp = contact.amperage ? String(contact.amperage).trim() : '';
  const kGen = contact.generator ? String(contact.generator).trim() : '';
  const kPanel = contact.panel_location ? String(contact.panel_location).replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()).trim() : '';
  const kAvail = contact.availability_notes ? String(contact.availability_notes).trim() : '';
  const hasSetup = !!(kAmp || kGen || kPanel || kAvail);
  const kPred = (contact.address && typeof predictJurisdiction === 'function') ? predictJurisdiction(contact.address) : null;
  const hasJurisdiction = !!(kPred && kPred.jurisdiction && !latestSigned);
  // Sub/Installer row shows only when there is a real job to install (booked+) OR an
  // installer is already assigned (so a pre-assigned front-half job never goes
  // invisible) , never "Unassigned" noise on a bare lead (slice 5, Comp subDecision).
  const kStageNum = (window.CRM?.STAGE_STR_TO_NUM?.[contact.stage]) ?? 0;
  const showInstaller = kStageNum >= 3 || !!contact.assigned_installer;
  const knowHasContent = !!(briefText || hasSetup || hasJurisdiction || preRead || showInstaller);
  const KNOW_CHIP = { display:'inline-flex', alignItems:'center', padding:'6px 11px', background:'#f7f8fa', border:'1px solid #eef0f4', borderRadius:100, fontSize:13, fontWeight:600, color:NAVY };

  return (
    <div style={{ flex:1, overflowY:'auto', minHeight:0, padding:'0 16px var(--tabbar-clear, calc(env(safe-area-inset-bottom, 0px) + 92px))' }}>
      {/* 1. HERO , who + where, the 2-second recognition. */}
      <ContactHero contact={contact} proposals={proposals} nextItem={heroNext} />

      {/* BRIEF (ai_summary) moved into the KNOW card below (slice 4) so all the
          reference/intelligence lives in one place; it is no longer a standalone
          card above the action. */}

      {/* 3. RIGHT NOW , the one primary action for this job + quiet context.
          The standalone amber Today banner is folded in here as a quiet line.
          Exactly one gold money-colored primary on the whole card lives in this
          zone (the AdvanceJobCard's advance/record-payment action). */}
      {rightNowHasContent && (
        <div style={{ fontSize:11, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.1em', marginTop:16, marginBottom:-4 }}>Do next</div>
      )}
      {todayEvent && (
        <div style={{ marginTop:12, background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8, padding:'9px 13px', display:'flex', alignItems:'center', gap:9 }}>
          <div style={{ width:8,height:8,borderRadius:'50%',background:'#D97706',flexShrink:0,animation:'pulse 2s infinite' }} />
          <span style={{ fontSize:12, color:'#92400E', fontWeight:600 }}>{capitalize(todayEvent.kind)} today · {formatTime(todayEvent.start_at)}</span>
        </div>
      )}
      {/* The one next action for this job, first thing on the panel. */}
      {showNextStepCard && (
        <AdvanceJobCard
          contact={contact}
          data={{ permits, events, invoices }}
          bumpData={bumpData}
          onOpenTab={onOpenTab}
        />
      )}
      {/* Quote Desk: completed walk → firm SMS draft + draft proposal.
          Replaces the bare "Send proposal" head when pre-read is ready.
          Navy Text = navigate/prefill (not money); gold Draft = create draft
          for review (still not a charge). Nothing auto-sends. */}
      {showQuoteDesk && (
        <QuoteDeskCard
          contact={contact}
          preRead={preRead}
          onOpenTab={onOpenTab}
          bumpData={bumpData}
        />
      )}
      {/* Front-half primary (slice 2): the promoted stage action as a NAVY signpost
          head (Comp .next-head), tappable. 'Send quote' opens the New Proposal modal;
          'Mark booked' bumps the stage. Reuses performContactStageAction , the SAME
          write the Contact Stage CTA fires (suppressed below whenever this shows), so
          the two can never diverge. Navy, NOT gold (it navigates/advances, it does not
          commit money , Comp R1 + one-gold-per-screen). The chevron signifies the tap.
          Suppressed when Quote Desk owns this contact. */}
      {frontHalfPrimary && (
        <button
          onClick={() => performContactStageAction(contact, { onOpenTab, bumpData })}
          style={{
            marginTop:12, width:'100%', display:'flex', alignItems:'center', gap:10,
            padding:'13px 15px', background:NAVY, color:'#fff', border:'none', borderRadius:12,
            fontFamily:'inherit', cursor:'pointer', textAlign:'left', minHeight:48,
          }}
        >
          <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:'#9db0d0', flexShrink:0 }}>Next</span>
          <span style={{ fontSize:15, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{frontHalfVerb}</span>
          <svg viewBox="0 0 24 24" width="17" height="17" style={{ marginLeft:'auto', flexShrink:0 }} fill="none" stroke="#9db0d0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      )}
      {/* Blocked-permit route (slice 3, M1): permit_blocked/rejected render the
          AdvanceJobCard blocker reason above but NO action button (kind:'none'), so
          DO NEXT gets an actionable NAVY route head that scrolls to the Permits card's
          "Resolve blocker" control , never a dead end (matters most after the reorder
          moves Permits to the bottom). */}
      {nextStep && (nextStep.state === 'permit_blocked' || nextStep.state === 'permit_rejected') && (
        <button
          onClick={() => {
            // Stable id anchor on the Permits card (survives relabeling the eyebrow)
            // instead of a fragile whole-DOM textContent scan for the word "Permits".
            const eb = document.getElementById('permits-anchor');
            if (eb) eb.scrollIntoView({ behavior: 'smooth', block: 'center' });
            else window.showToast?.('Permits section is below');
          }}
          style={{
            marginTop:12, width:'100%', display:'flex', alignItems:'center', gap:10,
            padding:'13px 15px', background:NAVY, color:'#fff', border:'none', borderRadius:12,
            fontFamily:'inherit', cursor:'pointer', textAlign:'left', minHeight:48,
          }}
        >
          <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:'#9db0d0', flexShrink:0 }}>Next</span>
          <span style={{ fontSize:15, fontWeight:700 }}>Resolve permit blocker</span>
          <svg viewBox="0 0 24 24" width="17" height="17" style={{ marginLeft:'auto', flexShrink:0 }} fill="none" stroke="#9db0d0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      )}
      {/* Money status - only renders when there's an actual unpaid balance
          AND the Next-step card is not already saying Record payment.
          Tap → switches to the Finance tab to chase payment. */}
      {moneyStatus && nextStep?.state !== 'record_payment' && (
        <button
          onClick={() => onOpenTab?.('finance')}
          style={{
            marginTop:12, width:'100%', textAlign:'left',
            background: moneyStatus.bg, border: `1px solid ${moneyStatus.border}`, borderRadius:8,
            padding:'10px 13px', display:'flex', alignItems:'center', gap:10, cursor:'pointer',
            fontFamily:'inherit',
          }}
        >
          <span style={{ fontSize:18 }}>💰</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:11, fontWeight:600, color: moneyStatus.color, letterSpacing:'0.04em', textTransform:'uppercase' }}>{moneyStatus.label}</div>
            <div style={{ fontSize:18, fontWeight:700, color: moneyStatus.color, letterSpacing:'-0.02em', fontVariantNumeric:'tabular-nums' }}>{formatMoneyCents(moneyStatus.cents)}</div>
          </div>
          <span style={{ fontSize:13, color: moneyStatus.color, fontWeight:700, padding:'4px 0', flexShrink:0 }}>View →</span>
        </button>
      )}
      {quoteWalkMode === 'v2' && (
        <QuoteWalkOperatorCard contact={contact} receipt={quoteWalkReceipt} bumpData={bumpData} />
      )}
      {/* The old "No install scheduled" pill lived here. Deleted (Key Q10
          2026-06-09): that state is exactly the Next-step card's
          schedule_install, which now sits at the TOP and also auto-opens the
          add-event form on tap, strictly better than the pill it replaced. */}

      {/* 4. KNOW , the consolidated reference/intelligence card (slice 4, Comp v2).
          Gathers the Brief, Setup facts (compact chips), and the predicted permit
          jurisdiction into ONE home , the fix for "scattered AI". Pre-read, installer,
          and AI enrichment suggestions join this card in slices 5-6. The whole card
          (and its "Know" eyebrow) render only when a member has content, so a bare
          new lead never sees an empty shell. */}
      {knowHasContent && (
        <>
          <div style={{ fontSize:11, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.1em', marginTop:16, marginBottom:-4 }}>Know</div>
          <div style={{ background:'white', marginTop:12, padding:'14px', border:0, borderRadius:16, boxShadow:'inset 0 0 0 1px rgba(27,43,75,0.085)', display:'flex', flexDirection:'column', gap:14 }}>
            {briefText && (
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:5 }}>
                  <span style={{ fontSize:13 }}>✦</span>
                  <span style={{ fontSize:11, fontWeight:700, color:GOLD, textTransform:'uppercase', letterSpacing:'0.06em' }}>Brief</span>
                </div>
                <div style={{ fontSize:14, color:NAVY, lineHeight:1.5 }}>{briefText}</div>
              </div>
            )}
            {hasSetup && (
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>Setup</div>
                {/* Atomic facts (amperage, generator) read well as compact chips; the
                    descriptive facts (panel location, availability) are prose and can be
                    long, so they render as plain labeled lines , a chip full of a wrapped
                    sentence looks wrong. */}
                {(kAmp || kGen) && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                    {kAmp && <span style={KNOW_CHIP}>{kAmp}A</span>}
                    {kGen && <span style={KNOW_CHIP}>{kGen}</span>}
                  </div>
                )}
                {kPanel && (
                  <div style={{ fontSize:13, color:NAVY, lineHeight:1.45, marginTop:(kAmp || kGen) ? 8 : 0 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.05em', marginRight:6 }}>Panel</span>{kPanel}
                  </div>
                )}
                {kAvail && (
                  <div style={{ fontSize:13, color:MUTED, lineHeight:1.45, marginTop:(kAmp || kGen || kPanel) ? 6 : 0 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.05em', marginRight:6 }}>Availability</span>{kAvail}
                  </div>
                )}
              </div>
            )}
            {hasJurisdiction && (
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:10.5, fontWeight:700, color:'#2647a8', textTransform:'uppercase', letterSpacing:'0.05em', flexShrink:0 }}>Predicted permit</span>
                <span style={{ fontSize:14, fontWeight:700, color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flex:1, minWidth:0 }}>{kPred.jurisdiction}</span>
                <span title={kPred.note || ''} style={{ fontSize:10.5, fontWeight:700, color:'#92400E', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:20, padding:'2px 8px', flexShrink:0, textTransform:'uppercase', letterSpacing:'0.03em' }}>{kPred.confidence}</span>
              </div>
            )}
            {/* Pre-read (property-walk intelligence) + Sub/Installer , relocated from
                the Contact section (slice 5) so all reference/intelligence lives in
                KNOW. Pre-read takes the lifted fetch result (self-nulls when empty);
                the installer row is gated to booked+/assigned. */}
            {preRead && <PreReadRow contact={contact} pr={preRead} />}
            {showInstaller && <InstallerAssignmentRow contact={contact} bumpData={bumpData} />}
            {/* Compact sub card (crm-subs-tab.jsx): the sub_job_offers model for
                this contact, assigned sub + compact stepper + payout, taps into
                the full job detail sheet; "Assign a sub" when none. Self-fetches
                from sub-admin-list and stays SILENT (renders null) while loading
                or if the PARKED sub backend is not reachable yet, so it never
                shows an empty shell or breaks the panel. Gated to booked+/assigned
                exactly like the installer row above. */}
            {showInstaller && window.SubCard && <window.SubCard contact={contact} />}
          </div>
        </>
      )}

      {/* AI enrichment suggestions (slice 6) , promoted OUT of the bottom registry
          into the intelligence zone, right after the KNOW card and before Contact, so
          proposed field values sit with the other AI/reference content instead of
          buried at the bottom. Self-nulls when there are no pending suggestions (no
          empty shell). Its Confirm is navy per R2 so it never competes for the one
          gold; its own card + "AI suggestion" badge keep it visually distinct from the
          confirmed KNOW facts (a suggestion is not a fact). */}
      <AISuggestionsCard contact={contact} bumpData={bumpData} />

      {/* 5. CONTACT , the existing identity rows, demoted below Setup. Every
          action (copy/call/mail, ghost-add, stage advance, AI confirm) is
          preserved; only the hero moved up to the top block and the three
          enrichment rows moved into Setup. */}
      <div style={{ fontSize:11, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.1em', marginTop:16, marginBottom:-4 }}>Contact</div>
      <ContactInfoSection contact={contact} bumpData={bumpData} onOpenTab={onOpenTab} hideStageCta={showNextStepCard || showQuoteDesk || frontHalfPrimary} />
      {/* Install spec + Permits cards only render once a proposal is
          signed. Before that, the contact view stays clean - Inlet/
          Interlock + permit workflow are noise until there's a real
          deal to install. Same gate Key uses mentally. (Permits has one
          extra door: a contact that already HAS permit rows always sees
          the Permits card, so existing permits never go invisible.) */}
      {showInstallSpec && (
        <div id="materials-anchor"><InstallSpecCard ampSpec={ampSpec} contact={contact} materials={materials} bumpData={bumpData} /></div>
      )}
      {/* POM inspection card: renders ONLY for POM-paid contacts (gate inside). */}
      <POMInspectionButton contact={contact} proposals={proposals} />
      {nextEvent && (
        <NextJobCard contact={contact} event={nextEvent} permit={cPermit} materials={materials} onOpenTab={onOpenTab} />
      )}
      {/* Notes before Photos - Key references notes more often than
          photos when re-opening a contact. */}
      <NotesWithMarkdownPreview
        note={note}
        setNote={setNote}
        noteSaving={noteSaving}
        noteSaved={noteSaved}
      />
      {/* Card-architecture migration (Key 2026-06-09): the trailing sections
          (Photos, Next step, Stage history, Activity, Permits) render FROM the
          card registry (crm-cards.js -> window.renderCardColumn), same
          components, same order, same gates (the Permits signed-gate travels
          as data.latestSigned). Photos was carved in here on 2026-06-09 as
          registry entry #0 so the order stays byte-identical (it was the inline
          section directly above this block). The registry is now the source of
          what renders here; adding a future card = one registry entry. The
          fallback keeps the legacy direct renders if crm-cards.js ever fails to
          load (cache mismatch), so these sections can never silently vanish
          from Key's daily tool. */}
      {typeof window.renderCardColumn === 'function' ? (
        window.renderCardColumn({
          contact,
          data: { permits, latestSigned: !!latestSigned || permits.length > 0, messages, calls, proposals, invoices, events },
          bumpData,
          onOpenTab,
          // advance-job renders at the TOP of this panel now (Key Q10); skip
          // it here so the card never appears twice. ai-summary likewise has its
          // canonical home in the inline BRIEF zone above (gold "Brief" eyebrow),
          // so exclude the registry copy or the same summary prints twice (the
          // "wall of text" smell). Fallback branch below never rendered it anyway.
          exclude: ['advance-job', 'ai-summary', 'ai-suggestions'],
        })
      ) : (
        <>
          <PhotosSection contact={contact} />
          <StageHistoryCard contact={contact} />
          <ActivityTimelineCard contact={contact} messages={messages} calls={calls} proposals={proposals} invoices={invoices} events={events} onOpenTab={onOpenTab} />
          {(latestSigned || permits.length > 0) && <div id="permits-anchor"><PermitsCard permits={permits} contact={contact} bumpData={bumpData} /></div>}
        </>
      )}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}

// ── MediaCard (CRM revamp 2026-06-10, B3) ─────────────────────────────
// One "Media" card hosting two labeled sub-sections instead of two
// back-to-back photo cards: Job photos (installer/private uploads + SMS-
// attached images, the upload surface, always shown) and Customer photos
// (texted-in MMS, shown only when images exist). CustomerPhotosCard returns
// null when empty AND owns its own top divider, so the card never shows an
// empty Customer-photos gap. Reuses the existing InfoSection primitive +
// both existing galleries; no new design language.
function MediaCard({ contact }) {
  const CustomerPhotos = window.CustomerPhotosCard;
  return (
    <InfoSection title="Media" editAction={null}>
      <PhotosSection contact={contact} bare />
      {CustomerPhotos ? <CustomerPhotos contact={contact} bare /> : null}
    </InfoSection>
  );
}
window.MediaCard = MediaCard;

// ── PhotoAnnotateModal ────────────────────────────────────────────────
// Full-screen modal: photo + canvas overlay. Pen draws red strokes;
// undo pops the last stroke; clear wipes everything; save composites
// the strokes onto the original image at full resolution and returns
// a PNG blob via onSave. Pointer-events handle mouse/touch/pen alike.
function PhotoAnnotateModal({ photo, onClose, onSave }) {
  const imgRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [strokes, setStrokes] = React.useState([]); // [[{x,y},...]]
  const [drawing, setDrawing] = React.useState(false);
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const [color, setColor] = React.useState('#dc2626');
  const [thickness, setThickness] = React.useState(4);
  const [saving, setSaving] = React.useState(false);

  // Audit-2026-05-09 H5: Escape-to-close was missing. On phone the canvas
  // sometimes ate tap-to-close events and Key was locked into the modal
  // until he hit the tiny X. Mirrors every other modal in the app.
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // Resize canvas to match the displayed image whenever the image loads
  // or the window resizes.
  React.useEffect(() => {
    if (!imgLoaded) return;
    const sync = () => {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      if (!img || !canvas) return;
      const rect = img.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      redraw();
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [imgLoaded, strokes, color, thickness]);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.thickness;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
  };

  const xy = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture?.(e.pointerId);
    setDrawing(true);
    const p = xy(e);
    setStrokes(s => [...s, { color, thickness, points: [p] }]);
  };
  const onPointerMove = (e) => {
    if (!drawing) return;
    const p = xy(e);
    setStrokes(s => {
      if (!s.length) return s;
      const last = s[s.length - 1];
      const next = { ...last, points: [...last.points, p] };
      return [...s.slice(0, -1), next];
    });
  };
  const onPointerUp = (e) => {
    setDrawing(false);
    try { canvasRef.current?.releasePointerCapture?.(e.pointerId); } catch {}
  };

  const undo = () => setStrokes(s => s.slice(0, -1));
  const clear = () => setStrokes([]);

  // Save: composite strokes onto the original image at full resolution.
  // Scale stroke coords by (naturalWidth/displayedWidth) so annotations
  // look correct at any export size. Resulting PNG is sent to onSave.
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const img = imgRef.current;
      if (!img) { setSaving(false); return; }
      const W = img.naturalWidth || img.width;
      const H = img.naturalHeight || img.height;
      const dRect = img.getBoundingClientRect();
      const sx = W / dRect.width;
      const sy = H / dRect.height;
      // Use a separate offscreen canvas so we don't pollute the live one.
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const ctx = out.getContext('2d');
      // Draw the original image; if it errored as cross-origin, we'll
      // fall through and just export the strokes on a transparent BG -
      // strokes alone are still useful as an overlay.
      try {
        ctx.drawImage(img, 0, 0, W, H);
      } catch (e) {
        console.warn('[CRM] photo draw failed (likely CORS):', e?.message);
      }
      for (const stroke of strokes) {
        if (stroke.points.length < 2) continue;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.thickness * Math.max(sx, sy);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x * sx, stroke.points[0].y * sy);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x * sx, stroke.points[i].y * sy);
        }
        ctx.stroke();
      }
      out.toBlob(blob => {
        setSaving(false);
        if (!blob) { window.showToast?.('Nothing to save'); return; }
        onSave?.(blob);
      }, 'image/png');
    } catch (e) {
      setSaving(false);
      window.showToast?.('Save failed: ' + (e.message || e));
    }
  };

  // Portal to body: the mobile shell's 200%-wide transformed slider re-roots
  // position:fixed, so inset/center overlays render off-screen (the 2026-06-15
  // job-sheet glitch). Portaling escapes the transform. Matches ModalShell.
  return ReactDOM.createPortal((
    <div onClick={onClose} style={{
      position:'fixed', top:0, left:0, right:0, height:'var(--vvh, 100dvh)',
      background:'rgba(11,31,59,0.85)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:'white', borderRadius:12, maxWidth:'90vw', maxHeight:'calc(var(--vvh, 92vh) - 48px - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
        display:'flex', flexDirection:'column', overflow:'hidden',
      }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderBottom:'1px solid #EBEBEA' }}>
          <div style={{ fontSize:13, fontWeight:700, color:NAVY }}>Annotate photo</div>
          <button onClick={onClose} style={{ fontSize:14, background:'none', border:'none', color:MUTED, cursor:'pointer' }}>✕</button>
        </div>
        {/* Image + canvas overlay */}
        <div style={{ position:'relative', overflow:'auto', minHeight:0, flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#0b1f3b' }}>
          <img
            ref={imgRef}
            src={photo.url}
            alt=""
            crossOrigin="anonymous"
            onLoad={() => setImgLoaded(true)}
            style={{ maxWidth:'80vw', maxHeight:'70vh', display:'block', userSelect:'none', pointerEvents:'none' }}
          />
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%, -50%)', cursor:'crosshair', touchAction:'none' }}
          />
        </div>
        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderTop:'1px solid #EBEBEA', flexWrap:'wrap' }}>
          {[{c:'#dc2626',l:'Red'},{c:'#facc15',l:'Yellow'},{c:'#0b1f3b',l:'Navy'},{c:'#ffffff',l:'White'}].map(swatch => (
            <button key={swatch.c} onClick={() => setColor(swatch.c)} title={swatch.l}
              style={{
                width:44, height:44, padding:0, background:'none', border:'none',
                display:'flex', alignItems:'center', justifyContent:'center',
                cursor:'pointer', flexShrink:0,
              }}>
              <span style={{
                width:24, height:24, borderRadius:'50%', display:'block', boxSizing:'border-box',
                background: swatch.c,
                border: color === swatch.c ? '2px solid #0b1f3b' : '1px solid #EBEBEA',
              }} />
            </button>
          ))}
          <span style={{ fontSize:11, color:MUTED, marginLeft:4 }}>Size</span>
          {[2, 4, 8, 14].map(t => (
            <button key={t} onClick={() => setThickness(t)} style={{
              width:44, height:44, borderRadius:6,
              border: thickness === t ? '2px solid #0b1f3b' : '1px solid #EBEBEA',
              background:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              flexShrink:0,
            }}>
              <span style={{ width:t, height:t, borderRadius:'50%', background: NAVY, display:'block' }} />
            </button>
          ))}
          <div style={{ flex:1 }} />
          <button onClick={undo} disabled={strokes.length === 0} style={{
            padding:'6px 10px', minHeight:44, fontSize:12, fontWeight:600, color:NAVY,
            background:'white', border:'1px solid #EBEBEA', borderRadius:6,
            cursor: strokes.length === 0 ? 'not-allowed' : 'pointer', opacity: strokes.length === 0 ? 0.5 : 1,
            fontFamily:'inherit',
          }}>Undo</button>
          <button onClick={clear} disabled={strokes.length === 0} style={{
            padding:'6px 10px', minHeight:44, fontSize:12, fontWeight:600, color:'#991B1B',
            background:'white', border:'1px solid #FECACA', borderRadius:6,
            cursor: strokes.length === 0 ? 'not-allowed' : 'pointer', opacity: strokes.length === 0 ? 0.5 : 1,
            fontFamily:'inherit',
          }}>Clear</button>
          <button onClick={save} disabled={saving || strokes.length === 0} style={{
            padding:'6px 14px', minHeight:44, fontSize:13, fontWeight:700, color:NAVY,
            background:'#ffba00', border:'none', borderRadius:6,
            cursor: (saving || strokes.length === 0) ? 'not-allowed' : 'pointer', opacity: (saving || strokes.length === 0) ? 0.6 : 1,
            fontFamily:'inherit',
          }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  ), document.body);
}

// ── NotesWithMarkdownPreview ──────────────────────────────────────────
// Internal notes textarea with a Preview tab showing rendered markdown
// (bold, italic, headings, links, bullets, code). Voice memo button on
// the meta row. Light markdown only - no HTML, no XSS surface; all
// transforms produce plain text + safe React elements.
function NotesWithMarkdownPreview({ note, setNote, noteSaving, noteSaved }) {
  const [mode, setMode] = React.useState('edit'); // 'edit' | 'preview'
  return (
    <InfoSection title="Notes" editAction={null}>
      {/* Tiny tab strip - Edit / Preview */}
      <div style={{ display:'flex', gap:4, marginBottom:8 }}>
        {['edit','preview'].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              fontSize:11, fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase',
              padding:'7px 12px', borderRadius:6,
              background: mode === m ? NAVY : 'transparent',
              color: mode === m ? 'white' : MUTED,
              border: '1px solid ' + (mode === m ? NAVY : 'rgba(11,31,59,0.12)'),
              cursor:'pointer', fontFamily:'inherit', minHeight:44,
            }}
          >{m}</button>
        ))}
      </div>
      {mode === 'edit' ? (
        <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Internal notes (auto-saves)… Markdown supported."
          style={{ width:'100%',minHeight:68,border:'1.5px solid #EBEBEA',borderRadius:8,background:BG,padding:'10px 12px',fontSize:16,color:NAVY,resize:'vertical',outline:'none',fontFamily:'inherit',lineHeight:1.5,boxSizing:'border-box' }} />
      ) : (
        // remake-2 (approved comp, .note-item p): 15px/1.5 ink note text.
        // The edit textarea below stays 16px, the iOS no-zoom floor wins there.
        <div style={{ width:'100%', minHeight:68, border:'1.5px solid #EBEBEA', borderRadius:8, background:'white', padding:'10px 14px', fontSize:15, color:NAVY, lineHeight:1.5, boxSizing:'border-box' }}>
          {note.trim()
            ? <MarkdownRender text={note} />
            : <span style={{ color: MUTED, fontStyle:'italic' }}>(empty)</span>}
        </div>
      )}
      <div style={{ marginTop:6, display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
        {/* remake-2: 11px mono meta, comp .nd spec. */}
        <div style={{ fontSize:11, fontFamily:"'JetBrains Mono', monospace", color:'#8a93a6', minHeight:14 }}>
          {noteSaving ? 'Saving…' : noteSaved ? 'Saved' : ' '}
        </div>
        <VoiceMemoButton onTranscript={(text) => {
          const stamp = new Date().toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
          const existing = note ? note + '\n\n' : '';
          setNote(existing + `[Voice ${stamp}] ${text}`);
        }} />
      </div>
    </InfoSection>
  );
}

// Tiny markdown renderer: blocks (headings, bullets, blockquotes,
// fenced code) + inline (bold, italic, code, links). Splits on blank
// lines into blocks; each block rendered as the appropriate element.
// All output is plain text + React elements - no innerHTML, no
// dangerouslySetInnerHTML. Links open in a new tab with rel=noopener.
function MarkdownRender({ text }) {
  const blocks = React.useMemo(() => {
    const out = [];
    const lines = text.split(/\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith('```')) {
        const code = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          code.push(lines[i]);
          i++;
        }
        i++; // skip closing fence
        out.push({ kind:'code', value: code.join('\n') });
      } else if (/^#{1,3}\s/.test(line)) {
        const m = line.match(/^(#{1,3})\s+(.*)$/);
        out.push({ kind:'heading', level: m[1].length, value: m[2] });
        i++;
      } else if (/^>\s/.test(line)) {
        const quote = [line.replace(/^>\s?/, '')];
        i++;
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push({ kind:'quote', value: quote.join('\n') });
      } else if (/^[-*]\s/.test(line)) {
        const items = [line.replace(/^[-*]\s+/, '')];
        i++;
        while (i < lines.length && /^[-*]\s/.test(lines[i])) {
          items.push(lines[i].replace(/^[-*]\s+/, ''));
          i++;
        }
        out.push({ kind:'list', items });
      } else if (line.trim() === '') {
        i++;
      } else {
        const para = [line];
        i++;
        while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|>\s|[-*]\s|```)/.test(lines[i])) {
          para.push(lines[i]);
          i++;
        }
        out.push({ kind:'p', value: para.join(' ') });
      }
    }
    return out;
  }, [text]);

  // Inline transform: returns an array of strings + React nodes.
  const renderInline = (s) => {
    if (!s) return null;
    // Order matters: code first (claims its content), then links, then
    // bold, then italic. Each pass walks the array looking for plain
    // strings to split.
    let parts = [s];
    const passes = [
      // inline code
      { re: /`([^`]+)`/g, wrap: (m, _i) => <code key={'c'+_i} style={{ background:'#F0F0EE', padding:'1px 5px', borderRadius:4, fontFamily:"'DM Mono', monospace", fontSize:'90%' }}>{m[1]}</code> },
      // links: [label](url)
      { re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, wrap: (m, _i) => <a key={'a'+_i} href={m[2]} target="_blank" rel="noopener noreferrer" style={{ color: NAVY, textDecoration:'underline' }}>{m[1]}</a> },
      // bold **x**
      { re: /\*\*([^*]+)\*\*/g, wrap: (m, _i) => <strong key={'b'+_i}>{m[1]}</strong> },
      // italic *x*
      { re: /\*([^*]+)\*/g, wrap: (m, _i) => <em key={'i'+_i}>{m[1]}</em> },
    ];
    let counter = 0;
    for (const { re, wrap } of passes) {
      const next = [];
      for (const part of parts) {
        if (typeof part !== 'string') { next.push(part); continue; }
        re.lastIndex = 0;
        let lastIdx = 0;
        let m;
        while ((m = re.exec(part)) !== null) {
          if (m.index > lastIdx) next.push(part.slice(lastIdx, m.index));
          next.push(wrap(m, counter++));
          lastIdx = m.index + m[0].length;
        }
        if (lastIdx < part.length) next.push(part.slice(lastIdx));
      }
      parts = next;
    }
    return parts;
  };

  return (
    <div>
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          const sz = b.level === 1 ? 18 : b.level === 2 ? 16 : 14;
          return <div key={i} style={{ fontSize:sz, fontWeight:700, color:NAVY, marginTop: i === 0 ? 0 : 8, marginBottom:4 }}>{renderInline(b.value)}</div>;
        }
        if (b.kind === 'list') {
          return (
            <ul key={i} style={{ margin:'4px 0 4px 20px', padding:0, color:NAVY }}>
              {b.items.map((it, j) => <li key={j} style={{ marginBottom:2 }}>{renderInline(it)}</li>)}
            </ul>
          );
        }
        if (b.kind === 'quote') {
          return (
            <div key={i} style={{ borderLeft:'3px solid #EBEBEA', padding:'4px 12px', color:'#555', margin:'6px 0', whiteSpace:'pre-line' }}>
              {renderInline(b.value)}
            </div>
          );
        }
        if (b.kind === 'code') {
          return (
            <pre key={i} style={{ background:'#F0F0EE', padding:'8px 12px', borderRadius:6, fontFamily:"'DM Mono', monospace", fontSize:12, overflowX:'auto', margin:'6px 0' }}>{b.value}</pre>
          );
        }
        return <p key={i} style={{ margin: i === 0 ? 0 : '6px 0 0', color:NAVY }}>{renderInline(b.value)}</p>;
      })}
    </div>
  );
}

// ── InfoSection (unified card shell) ──────────────────────────────────
function InfoSection({ title, editAction, children }) {
  return (
    <div style={{
      // CRM revamp T2-1: unified card shell , matches the Key-validated AI-card
      // treatment (radius 12, soft navy shadow, #F3F4F6 border) so the right
      // panel reads as one design language instead of flat-8 vs soft-12.
      background:'white', marginTop:12, padding:'12px 14px',
      border:0, borderRadius:16, boxShadow:'inset 0 0 0 1px rgba(27,43,75,0.085)',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        {/* remake-2: card-head label metrics from the comp (11px/700 caps,
            0.1em tracking, #9ca3af); shell border/shadow stays T2-1. */}
        <span style={{ fontSize:11,fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.1em' }}>{title}</span>
        {editAction && (
          <button
            aria-label="Edit"
            onClick={editAction}
            style={{
              fontSize:12, color:'#666', background:'none', border:'none',
              cursor:'pointer', fontFamily:'inherit',
              // 32-tall hit zone - visual size unchanged but touch is reachable.
              minHeight:44, padding:'14px 10px', margin:'-14px -10px',
            }}
          >Edit</button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Contact Info Rows (Phone / Address / Stage / Tier) ──────────
const SMALL_COPY_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

// ── Action buttons ────────────────────────────────────────────────
// Two-tier system:
//   1. GoldActionBtn - text pill for VERB actions ("Pull permit",
//      "Send quote"). The text is part of the meaning.
//   2. IconActionBtn - 32×32 circle for UTILITY actions ("Call", "Map",
//      "Copy"). Glyph carries the meaning; saves horizontal space so
//      every InfoLineRow fits cleanly on one line at any width.
// Apple Contacts / Stripe Dashboard pattern. No more text-pill buttons
// wrapping below the value with awkward whitespace gaps.
function GoldActionBtn({ onClick, href, target, children }) {
  const style = {
    height:44, padding:'0 14px', borderRadius:8,
    background: GOLD, color:NAVY, border:'none',
    fontSize:13, fontWeight:600, fontFamily:'inherit',
    cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6,
    textDecoration:'none', whiteSpace:'nowrap',
  };
  if (href) return <a href={href} target={target} rel={target ? 'noopener noreferrer' : undefined} style={style}>{children}</a>;
  return <button onClick={onClick} style={style}>{children}</button>;
}

// remake-2: 16px @ 1.8 stroke per the comp's .iact svg spec.
const ICON_PHONE = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
);
const ICON_PIN = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
  </svg>
);
const ICON_COPY = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const ICON_CHAT = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);
const ICON_MAIL = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 6-10 7L2 6"/>
  </svg>
);
const ICON_NEIGHBORS = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

function IconActionBtn({ icon, onClick, href, target, ariaLabel }) {
  // CRM remake-2 (approved comp, the .iact atom): quiet 44x44 square,
  // radius 8, transparent bg, muted icon (#5b6576, ~5:1 = WCAG AA, was #8a93a6
  // at ~3:1) that wakes to navy on a sunken hover. The 44px tap target IS the
  // visible affordance now, no inner dot, no gold fill; one quiet utility action per row.
  const style = {
    width:44, height:44, borderRadius:8, background:'transparent', border:'none',
    cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center',
    color:'#5b6576', textDecoration:'none', flexShrink:0, fontFamily:'inherit', padding:0,
  };
  const hoverOn  = e => { e.currentTarget.style.background = '#eef1f6'; e.currentTarget.style.color = NAVY; };
  const hoverOff = e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#5b6576'; };
  if (href) return <a href={href} target={target} rel={target ? 'noopener noreferrer' : undefined} aria-label={ariaLabel} title={ariaLabel} style={style} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>{icon}</a>;
  return <button onClick={onClick} aria-label={ariaLabel} title={ariaLabel} style={style} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>{icon}</button>;
}

const CallIconBtn = ({ href, onClick }) => <IconActionBtn icon={ICON_PHONE} href={href} onClick={onClick} ariaLabel="Call" />;
const TextIconBtn = ({ onClick }) => <IconActionBtn icon={ICON_CHAT} onClick={onClick} ariaLabel="Text" />;
const MapIconBtn = ({ onClick }) => <IconActionBtn icon={ICON_PIN} onClick={onClick} ariaLabel="Open in maps" />;
const MailIconBtn = ({ href, onClick }) => <IconActionBtn icon={ICON_MAIL} href={href} onClick={onClick} ariaLabel="Compose email" />;
const CopyBtn = ({ onClick }) => <IconActionBtn icon={ICON_COPY} onClick={onClick} ariaLabel="Copy" />;
// Opens the neighbor-finder tool with this contact's address prefilled, so after
// an install Key can pull the ~10 homes to mail in one tap. Tool auto-runs on ?address=.
const NeighborsIconBtn = ({ onClick }) => <IconActionBtn icon={ICON_NEIGHBORS} onClick={onClick} ariaLabel="Find neighbors to mail" />;

function InfoLineRow({ label, value, valueColor, mono, actions }) {
  // CRM remake-2 (approved comp comps/contact-panel-v2.html, the .irow atom):
  // label OVER value. 11px caps #9ca3af label, 15px ink value (JetBrains Mono
  // for numerics via `mono`), min-height 52, hairline navy divider, 44px
  // action(s) pinned right. String values truncate on one line (comp shows
  // the long-address truncation state); JSX values (tag chips, inline
  // editors) keep normal flow so they can wrap.
  const isPlain = typeof value === 'string' || typeof value === 'number';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'6px 0', borderTop:'1px solid rgba(27,43,75,0.08)', minHeight:52 }}>
      <span style={{ flex:1, minWidth:0 }}>
        <span style={{ display:'block', fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.1em' }}>{label}</span>
        <span style={{
          display:'block', fontSize:15, color: valueColor || NAVY, marginTop:1,
          whiteSpace: isPlain ? 'nowrap' : 'normal', overflow:'hidden', textOverflow:'ellipsis',
          ...(mono ? { fontFamily:"'JetBrains Mono', monospace", fontVariantNumeric:'tabular-nums' } : {}),
        }}>{value}</span>
      </span>
      {actions && (
        <div style={{ display:'inline-flex', gap:6, flexShrink:0, alignItems:'center' }}>
          {actions}
        </div>
      )}
    </div>
  );
}

// HouseHero - wide Street View image of the contact's address. Helps Key
// recognize jobs visually ("oh, the white ranch with the carport"). Falls
// back gracefully when no address is set. Click → Maps + Street View link.
// DriveTimeBadge - async OSRM lookup, shows minutes + miles from Key's home
// to the contact's address. Cached in localStorage for 24h per contact.
// Renders nothing if address can't be geocoded.
function DriveTimeBadge({ contact, dark }) {
  const [info, setInfo] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setInfo(null);
    if (!isAddressableStreet(contact.address) || typeof driveTimeToContactAddress !== 'function') {
      setLoading(false);
      return () => { alive = false; };
    }
    driveTimeToContactAddress(contact.address, contact.id).then(r => {
      if (alive) { setInfo(r); setLoading(false); }
    });
    return () => { alive = false; };
  }, [contact.id, contact.address]);
  if (loading) return null;
  if (!info) return null;
  const txt = info.minutes < 60
    ? `≈ ${info.minutes} min from home`
    : `≈ ${Math.floor(info.minutes/60)} hr ${info.minutes%60} min from home`;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      fontSize:11, fontWeight:600,
      color: dark ? 'white' : '#666',
      textShadow: dark ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
      // On the hero (dark), carry a legible pill background (Comp B slice 3).
      ...(dark ? { background:'rgba(0,0,0,0.45)', backdropFilter:'blur(4px)', WebkitBackdropFilter:'blur(4px)', border:'1px solid rgba(255,255,255,0.3)', borderRadius:20, padding:'4px 10px', whiteSpace:'nowrap' } : {}),
    }}>
      <span style={{ fontSize:13, lineHeight:1 }}>🚗</span>
      <span>{txt} · {info.miles.toFixed(1)} mi</span>
    </span>
  );
}

// Photos section - combined gallery of:
//   1. Photos auto-extracted from this contact's SMS thread (Twilio MMS)
//   2. Job photos Key uploads directly (stored in Supabase Storage,
//      indexed in localStorage per contact)
// Job photos are PRIVATE - they never go to the customer. Click [Upload]
// to add - opens a file picker, uploads to the message-media bucket,
// thumbnail appears immediately.
function PhotosSection({ contact, bare = false }) {
  // URL allowlist: parse the URL and check the actual hostname rather than a
  // regex (which can be bypassed by `https://attacker.com/.twilio.com/x.png`
  // because `.*` doesn't anchor at a host boundary). hostname.endsWith()
  // requires the dot to make `xtwilio.com` not match `twilio.com`.
  const isTrustedMediaUrl = (raw) => {
    if (!raw || typeof raw !== 'string') return false;
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:') return false;
      const h = u.hostname.toLowerCase();
      return h === 'api.twilio.com' || h.endsWith('.twilio.com') || h.endsWith('.supabase.co');
    } catch { return false; }
  };
  // 2026-05-26: jobPhotos moved from localStorage (per-device, lost on
  // sub workflow) to the job_photos table (synced via realtime so Key's
  // phone + laptop + subs on /sub/ all see the same set).
  const [tick, forceTick] = React.useState(0);
  React.useEffect(() => {
    const onChange = (e) => {
      if (!e.detail?.table || e.detail.table === 'job_photos' || e.detail.table === 'all') {
        forceTick(t => t + 1);
      }
    };
    window.addEventListener('crm-data-changed', onChange);
    return () => window.removeEventListener('crm-data-changed', onChange);
  }, []);
  const jobPhotos = React.useMemo(() => {
    return (window.CRM?.jobPhotos || [])
      .filter(p => p.contact_id === contact.id)
      .filter(p => isTrustedMediaUrl(p.url))
      .map(p => ({
        id: p.id, url: p.url, path: p.storage_path, uploaded_at: p.uploaded_at,
        annotated: !!p.annotated, photo_kind: p.photo_kind || 'other',
        uploaded_by: p.uploaded_by || 'key',
      }));
  }, [contact.id, tick]);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef(null);

  // One-time migration: any leftover bpp_v3_job_photos:{id} localStorage
  // entries from before the DB cutover get inserted into job_photos so
  // Key doesn't lose photos he uploaded in the old system. Idempotent
  // because we delete the localStorage key after upserting + dedupe by
  // storage_path on the DB side (path is contact+timestamp scoped).
  React.useEffect(() => {
    if (!CRM.__db) return;
    const key = `bpp_v3_job_photos:${contact.id}`;
    let legacy;
    try { legacy = JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { legacy = []; }
    if (!Array.isArray(legacy) || legacy.length === 0) return;
    const rows = legacy
      .filter(p => p && p.url && isTrustedMediaUrl(p.url))
      .map(p => ({
        contact_id: contact.id,
        url: p.url,
        storage_path: p.path || null,
        uploaded_at: p.uploaded_at || new Date().toISOString(),
        annotated: !!p.annotated,
        photo_kind: 'other',
        uploaded_by: 'key',
      }));
    if (rows.length === 0) {
      try { localStorage.removeItem(key); } catch {}
      return;
    }
    (async () => {
      const { error } = await CRM.__db.from('job_photos').insert(rows);
      if (!error) {
        try { localStorage.removeItem(key); } catch {}
        console.log(`[CRM] migrated ${rows.length} legacy job photos for contact ${contact.id}`);
      } else {
        console.warn('[CRM] job photo legacy migration failed:', error.message);
      }
    })();
  }, [contact.id]);

  const smsPhotos = React.useMemo(() => {
    const out = [];
    for (const m of CRM.messages) {
      if (m.contact_id !== contact.id) continue;
      const match = /^\[media:([^\]]+)\]\s*(.*)$/s.exec(m.body || '');
      if (!match) continue;
      const url = match[1];
      if (isTrustedMediaUrl(url)) {
        out.push({ id: m.id, url, caption: match[2] || '', sent_at: m.sent_at, source: 'sms' });
      }
    }
    return out;
  }, [contact.id, CRM.messages]);

  // Newest first across both sources.
  const allPhotos = React.useMemo(() => {
    const tagged = [
      ...jobPhotos.map(p => ({ ...p, source: 'job', sent_at: p.uploaded_at })),
      ...smsPhotos,
    ];
    return tagged.sort((a,b) => (b.sent_at||'').localeCompare(a.sent_at||'')).slice(0, 48);
  }, [jobPhotos, smsPhotos]);

  const onPick = () => fileInputRef.current?.click();
  const onFileChange = async (e) => {
    // ⚠️ KNOWN SURFACE - message-media bucket is fully public (per
    // F12 of 2026-05-01 security audit). Anyone with the URL can view
    // forever. Mitigation today: contact-id-scoped paths are UUID-
    // unguessable, but the URL leaks via Twilio MMS carrier logs and
    // ends up in message_body for the lifetime of the thread. See
    // wiki/Operations/Message Media Bucket.md for the migration plan
    // (private bucket + signed URLs at render time).
    //
    // Multi-file: Key picks several install photos at once from his library.
    // Validate all first, then upload sequentially (the 4-byte random suffix
    // keeps paths unique even on same-millisecond uploads, same guard as the
    // sub-photo-upload edge fn). One summary toast at the end.
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    for (const f of files) {
      if (!f.type.startsWith('image/')) { window.showToast?.('Only image files'); return; }
      if (f.size > 10 * 1024 * 1024) { window.showToast?.(`"${f.name}" is too large (10 MB max)`); return; }
    }
    if (!CRM.__db) { window.showToast?.('Supabase not loaded'); return; }
    setUploading(true);
    let ok = 0, fail = 0;
    try {
      for (const file of files) {
        try {
          const safeName = file.name.replace(/[^\w.-]/g, '_').slice(0, 60);
          const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(16).padStart(2, '0')).join('');
          const path = `crm-job-photos/${contact.id}/${Date.now()}-${rnd}-${safeName}`;
          const { error: upErr } = await CRM.__db.storage.from('message-media').upload(path, file, { contentType: file.type });
          if (upErr) throw upErr;
          const { data: pub } = CRM.__db.storage.from('message-media').getPublicUrl(path);
          const url = pub?.publicUrl;
          if (!url) throw new Error('No public URL returned');
          // Insert row to job_photos so realtime fans out to every other
          // device viewing this contact. The realtime handler in
          // crm-data.js refetches the table and the photo appears.
          const { error: insErr } = await CRM.__db.from('job_photos').insert({
            contact_id: contact.id,
            url, storage_path: path,
            uploaded_by: 'key',
            photo_kind: 'other',
          });
          if (insErr) throw insErr;
          ok++;
        } catch (err) {
          fail++;
          console.warn('[job-photo upload] failed:', err && err.message || err);
        }
      }
      window.showToast?.(fail === 0
        ? `${ok} photo${ok === 1 ? '' : 's'} added`
        : `${ok} added, ${fail} failed`);
    } finally {
      setUploading(false);
    }
  };

  const removeJobPhoto = async (id) => {
    const removed = jobPhotos.find(p => p.id === id);
    if (!removed) return;
    if (!CRM.__db) { window.showToast?.('Supabase not loaded'); return; }
    // Confirm first; the blob delete below is permanent, no undo.
    const ok = await window.confirmAction?.({
      title: 'Remove this photo?',
      body: 'Deletes the photo and its stored file permanently. This cannot be undone.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    // Delete the DB row first; realtime will fan out to other devices.
    const { error: delErr } = await CRM.__db.from('job_photos').delete().eq('id', id);
    if (delErr) { window.showToast?.(`Remove failed: ${delErr.message}`); return; }
    // Best-effort blob delete so storage doesn't keep paying for it.
    if (removed.path && CRM.__db.storage) {
      try {
        const { error } = await CRM.__db.storage.from('message-media').remove([removed.path]);
        if (error) console.warn('[CRM] photo blob delete failed:', error.message);
      } catch (e) {
        console.warn('[CRM] photo blob delete threw:', e?.message);
      }
    }
    window.showToast?.('Photo removed');
  };

  // Photo annotation: click the pencil → opens overlay where Key can
  // draw on the photo (red pen, undo, clear). Save uploads the
  // annotated copy as a NEW jobPhoto so the original is preserved.
  const [annotating, setAnnotating] = React.useState(null); // photo object
  const finishAnnotation = async (annotatedBlob) => {
    setAnnotating(null);
    if (!annotatedBlob || !CRM.__db) return;
    setUploading(true);
    try {
      const rnd2 = Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(16).padStart(2, '0')).join('');
      const path = `crm-job-photos/${contact.id}/${Date.now()}-${rnd2}-annotated.png`;
      const { error: upErr } = await CRM.__db.storage.from('message-media').upload(path, annotatedBlob, { contentType: 'image/png' });
      if (upErr) throw upErr;
      const { data: pub } = CRM.__db.storage.from('message-media').getPublicUrl(path);
      const url = pub?.publicUrl;
      if (!url) throw new Error('No public URL');
      const { error: insErr } = await CRM.__db.from('job_photos').insert({
        contact_id: contact.id,
        url, storage_path: path,
        annotated: true,
        uploaded_by: 'key',
        photo_kind: 'other',
      });
      if (insErr) throw insErr;
      window.showToast?.('Annotated photo saved');
    } catch (err) {
      window.showToast?.(`Save failed: ${err.message || 'unknown'}`);
    } finally {
      setUploading(false);
    }
  };

  const photosBody = (
    <>
      {/* No `capture` attr on purpose: Key's workflow is to add the install
          photos he ALREADY took, so the picker must offer Photo Library (iOS
          shows Photo Library / Take Photo / Choose File). `capture="environment"`
          forced the camera and hid the library, which made it feel like he
          could not add his own pics. `multiple` lets him grab several at once. */}
      <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={onFileChange} style={{ display:'none' }} />
      {allPhotos.length === 0 ? (
        <div style={{ fontSize:13, color:MUTED, padding:'4px 0', marginBottom:8 }}>
          Add job photos here, or send/receive photos in the SMS thread. Note: anyone with the photo URL can view it, don't include sensitive info in filenames.
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(84px, 1fr))', gap:8, marginBottom:10 }}>
          {allPhotos.map(p => (
            <div key={p.id} style={{ position:'relative' }}>
              <MmsImg url={p.url} title={p.source === 'job' ? 'Job photo (private)' : (p.caption || 'From SMS')} />
              {/* Annotate pencil - top-left so the remove × stays
                  visible in its top-right corner without overlap. */}
              <button onClick={(e) => { e.preventDefault(); setAnnotating(p); }}
                title="Annotate" aria-label="Annotate photo"
                style={{
                  position:'absolute', top:0, left:0, width:44, height:44, padding:0,
                  background:'none', border:'none', cursor:'pointer',
                  display:'flex', alignItems:'flex-start', justifyContent:'flex-start',
                }}>
                <span style={{
                  width:20, height:20, borderRadius:'50%', margin:'4px 0 0 4px',
                  background:'rgba(11,31,59,0.7)', color:'white', fontSize:11,
                  lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center',
                }}>✎</span>
              </button>
              {p.source === 'job' && (
                <button onClick={() => removeJobPhoto(p.id)} title="Remove photo" aria-label="Remove photo" style={{
                  position:'absolute', top:0, right:0, width:44, height:44, padding:0,
                  background:'none', border:'none', cursor:'pointer',
                  display:'flex', alignItems:'flex-start', justifyContent:'flex-end',
                }}>
                  <span style={{
                    width:20, height:20, borderRadius:'50%', margin:'4px 4px 0 0',
                    background:'rgba(11,31,59,0.7)', color:'white', fontSize:12,
                    lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center',
                  }}>×</span>
                </button>
              )}
              {p.source === 'sms' && (
                <span title="From SMS" style={{
                  position:'absolute', bottom:4, left:4, padding:'1px 5px', borderRadius:4,
                  background:'rgba(11,31,59,0.7)', color:'white', fontSize:12, fontWeight:600,
                }}>SMS</span>
              )}
              {/* Sub-uploaded badge: shows installer name on photos a sub
                  uploaded from the /sub/ portal. Lets Key spot at a glance
                  which photos came from the job site vs his own uploads. */}
              {p.source === 'job' && p.uploaded_by && p.uploaded_by !== 'key' && (
                <span title={`Uploaded by ${p.uploaded_by}`} style={{
                  position:'absolute', bottom:4, left:4, padding:'1px 6px', borderRadius:4,
                  background:'rgba(91,33,182,0.85)', color:'white', fontSize:12, fontWeight:700,
                  maxWidth:'70%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                }}>{p.uploaded_by}</span>
              )}
              {/* Photo kind badge (panel_before, etc) so Key can see at a
                  glance which step each thumbnail captures. Hidden for
                  generic 'other' kind to reduce noise. */}
              {p.source === 'job' && p.photo_kind && p.photo_kind !== 'other' && (
                <span title={p.photo_kind} style={{
                  position:'absolute', top:4, right:30, padding:'1px 5px', borderRadius:4,
                  background:'rgba(11,31,59,0.85)', color:'white', fontSize:12, fontWeight:700,
                  textTransform:'uppercase', letterSpacing:'0.04em',
                  maxWidth:'60%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                }}>{p.photo_kind.replace(/_/g,' ')}</span>
              )}
              {p.annotated && (
                <span title="Annotated" style={{
                  position:'absolute', bottom:4, right:4, padding:'1px 5px', borderRadius:4,
                  background:'rgba(220,38,38,0.85)', color:'white', fontSize:12, fontWeight:700,
                }}>✎</span>
              )}
            </div>
          ))}
        </div>
      )}
      {annotating && (
        <PhotoAnnotateModal photo={annotating} onClose={() => setAnnotating(null)} onSave={finishAnnotation} />
      )}
      <div style={{ display:'flex', justifyContent:'flex-end' }}>
        <button onClick={onPick} disabled={uploading} style={{
          height:44, padding:'0 14px', borderRadius:8,
          background:'#fff', color:NAVY, border:'1px solid #1B2B4B',
          fontSize:13, fontWeight:600, fontFamily:'inherit',
          cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1,
          display:'inline-flex', alignItems:'center', gap:6,
        }}>
          {uploading ? 'Uploading…' : <><span style={{ fontSize:15, lineHeight:1 }}>＋</span> Add photo</>}
        </button>
      </div>
    </>
  );

  // CRM revamp 2026-06-10 (B3): in `bare` mode PhotosSection renders as a
  // sub-section (a small "Job photos" label + its content, no card chrome) so
  // MediaCard can host it beside Customer photos inside ONE card. Non-bare
  // (the crm-cards.js fallback path) keeps the standalone InfoSection.
  if (bare) {
    return (
      <div>
        <div style={{ fontSize:11, fontWeight:600, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:8 }}>Job photos</div>
        {photosBody}
      </div>
    );
  }
  return (
    <InfoSection title="Photos" editAction={null}>
      {photosBody}
    </InfoSection>
  );
}

// Wraps ContactInfoRows with a real edit form. Click "Edit" → inline form
// with name + phone + address fields. Submit → updates contacts table.
function ContactInfoSection({ contact, bumpData, onOpenTab, hideStageCta }) {
  const [editing, setEditing] = React.useState(false);
  // Listen for the overflow menu's "Edit contact" action.
  React.useEffect(() => {
    const onEdit = (e) => { if (e.detail?.contactId === contact.id) setEditing(true); };
    window.addEventListener('crm-edit-contact', onEdit);
    return () => window.removeEventListener('crm-edit-contact', onEdit);
  }, [contact.id]);
  const [name, setName] = React.useState(contact.name || '');
  const [phone, setPhone] = React.useState(contact.phone || '');
  const [email, setEmail] = React.useState(contact.email || '');
  const [address, setAddress] = React.useState(contact.address || '');
  const [saving, setSaving] = React.useState(false);
  // Reset state AND exit edit mode whenever the contact changes - otherwise
  // a half-edited form for contact A leaks the typed name into contact B's
  // form when Key bounces between contacts mid-edit.
  React.useEffect(() => {
    setEditing(false);
    setName(contact.name || '');
    setPhone(contact.phone || '');
    setEmail(contact.email || '');
    setAddress(contact.address || '');
  }, [contact.id]);

  const save = async () => {
    if (!CRM.__db) { window.showToast?.('Supabase not loaded'); return; }
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    const trimmedAddress = address.trim();
    if (trimmedPhone && !/^\+?[\d\s().-]{7,}$/.test(trimmedPhone)) {
      window.showToast?.('Phone looks invalid');
      return;
    }
    // 2026-05-26: email is optional but if provided must look real.
    // Validation matches the regex used in twilio-webhook smart-extract.
    if (trimmedEmail && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmedEmail)) {
      window.showToast?.('Email looks invalid');
      return;
    }
    setSaving(true);
    const corePatch = {
      name: trimmedName || null,
      phone: trimmedPhone,
      email: trimmedEmail || null,
      address: trimmedAddress,
    };
    const { error } = await CRM.__db.from('contacts').update(corePatch).eq('id', contact.id);
    if (error) { setSaving(false); window.showToast?.(`Save failed: ${error.message}`); return; }

    // Proposal, invoice, and receipt contact fields are immutable document
    // evidence. Their home photo resolves the current contacts.address through
    // the protected gateway, so this edit updates the visual without rewriting
    // the customer's issued document.
    contact.name = corePatch.name;
    contact.phone = corePatch.phone;
    contact.email = corePatch.email;
    contact.address = corePatch.address;
    setSaving(false);
    setEditing(false);
    bumpData?.();
    window.showToast?.('Contact updated');
  };

  if (!editing) {
    // CONTACT-CARD OVERHAUL (2026-06-24): the Street-View HERO that used to live
    // here was PROMOTED to a standalone top-of-panel block (ContactHero) so the
    // image/name/city/status read first. This demoted Contact section now renders
    // rows only , a compact name + premium pill + Copy-name action (the action is
    // preserved) + drive-time, the "Contact info" eyebrow, then the rows. No hero
    // image here (it would duplicate the top block). Every row action is unchanged.
    const isPremium = contact.pricing_tier === 'premium' || contact.pricing_tier === 'premium_plus';

    const copyName = async () => {
      const ok = await window.copyText(contactName(contact));
      window.showToast?.(ok ? 'Name copied' : 'Copy failed');
    };

    return (
      <div style={{ background:'white', marginTop:12, border:0, borderRadius:16, boxShadow:'inset 0 0 0 1px rgba(27,43,75,0.085)', overflow:'hidden' }}>
        <div style={{ padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', minWidth:0 }}>
              {/* remake-2: comp .id-name = 16px/700, one priority pill max. */}
              <span style={{ fontSize:16, fontWeight:700, color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{contactName(contact)}</span>
              {/* T1-4: read-only stage pill removed (duplicate of the Stage row). */}
              {isPremium && <span style={{ fontSize:12, fontWeight:700, color:NAVY, background:GOLD, padding:'2px 8px', borderRadius:20, letterSpacing:'0.05em' }}>{contact.pricing_tier === 'premium_plus' ? 'PREMIUM+' : 'PREMIUM'}</span>}
            </div>
            <button onClick={copyName} title="Copy name" style={{
              // Edit-button pattern: 44-tall hit zone, same 30px visual chip.
              minHeight:44, padding:'7px 0', margin:'-7px 0',
              background:'none', border:'none', fontFamily:'inherit', cursor:'pointer',
              display:'inline-flex', alignItems:'center', flexShrink:0,
            }}>
              <span style={{
                height:30, padding:'0 10px', borderRadius:6,
                background:'white', color:NAVY, border:'1px solid rgba(11,31,59,0.15)',
                fontSize:12, fontWeight:600,
                display:'inline-flex', alignItems:'center', gap:5,
              }}>{SMALL_COPY_ICON}<span>Copy</span></span>
            </button>
          </div>
          {/* Drive-time now lives ON the recognition hero (Comp B slice 3), so it is
              removed from this card to avoid duplication. */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <span style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.1em' }}>Contact info</span>
            <button
              aria-label="Edit contact"
              onClick={() => setEditing(true)}
              style={{
                background:'none', border:'none', color:'#666', fontSize:12,
                cursor:'pointer', fontFamily:'inherit',
                // 32-tall hit zone - same visual size, reachable on touch.
                minHeight:44, padding:'14px 10px', margin:'-14px -10px',
              }}
            >Edit</button>
          </div>
          <ContactInfoRows contact={contact} bumpData={bumpData} onOpenTab={onOpenTab} hideStageCta={hideStageCta} />
        </div>
      </div>
    );
  }

  // fontSize 16 prevents iOS Safari auto-zoom on focus.
  const inputStyle = { width:'100%', padding:'10px 12px', fontSize:16, fontFamily:'inherit', border:'1px solid rgba(11,31,59,0.15)', borderRadius:6, background:'white', color:NAVY, boxSizing:'border-box' };
  // Audit-2026-05-09 a11y M5: wrapping each input in a <label> gives the
  // sibling `<div>` text its proper accessible role, makes tap-on-label
  // focus the input on phones, and lets screen readers announce
  // "Phone, edit text" instead of "edit text, blank".
  const labelStyle = { display:'block', cursor:'text' };
  const labelTextStyle = { fontSize:11, fontWeight:600, color:'#666', letterSpacing:'0.04em', marginBottom:4 };
  return (
    <InfoSection title="Contact info">
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <label style={labelStyle}>
          <div style={labelTextStyle}>Name</div>
          <input value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            placeholder="Full name" autoCapitalize="words" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <div style={labelTextStyle}>Phone</div>
          <input value={phone} onChange={e => setPhone(formatPhoneInput(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            placeholder="(864) 555-0192" type="tel" inputMode="tel" autoComplete="tel" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <div style={labelTextStyle}>Email</div>
          <input value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            placeholder="name@example.com" type="email" inputMode="email" autoComplete="email"
            autoCapitalize="off" autoCorrect="off" spellCheck={false} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          <div style={labelTextStyle}>Address</div>
          <AddressAutocomplete value={address} onChange={setAddress} placeholder="123 Main St, Spartanburg" style={inputStyle} />
        </label>
        <div style={{ display:'flex', gap:8, marginTop:6 }}>
          <button onClick={() => {
            // Reset form state to the current contact's persisted values
            // before closing - without this, typing "JUNK" then Cancel
            // leaves the dirty value behind and the next time Edit
            // opens, "JUNK" is still there.
            setName(contact.name || '');
            setPhone(contact.phone || '');
            setEmail(contact.email || '');
            setAddress(contact.address || '');
            setEditing(false);
          }} disabled={saving} style={{
            flex:1, height:44, borderRadius:8, background:'white', color:NAVY,
            border:'1px solid rgba(27,43,75,0.15)', fontSize:13, fontWeight:600, fontFamily:'inherit', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
          }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{
            flex:1, height:44, borderRadius:8, background:'#ffba00', color:NAVY, border:'none',
            fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer', opacity:saving?0.6:1,
          }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </InfoSection>
  );
}

// Stage-action verbs in tradesman language, not Salesforce-speak. Each verb
// describes the literal physical action that moves the deal forward.
function stageActionVerbFor(stage) {
  return {
    new:              'Send proposal',
    quoted:           'Mark booked',
    booked:           'Pull permit',
    permit_submit:    'Mark waiting',
    permit_waiting:   'Mark approved',
    permit_approved:  'Schedule install',
    install:          'Mark done',
  }[stage] || 'Move forward';
}

// Shared stage-action write (slice 2, Comp v2): the forward-only "advance this
// contact's stage" used by the promoted DO-NEXT front-half head. Mirrors EXACTLY the
// ContactInfoRows Stage-CTA handler (handleStageAction + advanceStage): 'new' opens the
// New Proposal modal (the modal bumps 1->2 on insert, so no double-bump);
// 'permit_approved' jumps to Schedule; every other stage is a forward-only bump with
// optimistic update + rollback + recordStageTransition. The Stage-CTA path is left
// byte-identical on purpose , it is a live write Key relies on that cannot be
// click-tested here , so this is a faithful copy, not a refactor. Keep the two in
// sync; converge to one path in a dedicated pass.
const _stageActionInFlight = new Set();
async function performContactStageAction(contact, opts) {
  if (!contact) return;
  const { onOpenTab, bumpData } = opts || {};
  const C = window.CRM || {};
  if (contact.stage === 'new') {
    window.__pendingOpenProposal = contact.id;
    onOpenTab?.('finance');
    setTimeout(() => window.dispatchEvent(new CustomEvent('crm-open-new-proposal', { detail: { contactId: contact.id } })), 300);
    return;
  }
  if (contact.stage === 'permit_approved') {
    window.__pendingAddEvent = contact.id;
    onOpenTab?.('calendar');
    setTimeout(() => window.dispatchEvent(new CustomEvent('crm-open-add-event', { detail: { contactId: contact.id } })), 300);
    return;
  }
  if (_stageActionInFlight.has(contact.id)) return;
  const order = C.STAGE_ORDER || [];
  const idx = order.indexOf(contact.stage);
  const nextStage = (idx >= 0 && idx < order.length - 1) ? order[idx + 1] : null;
  if (!nextStage) return;
  _stageActionInFlight.add(contact.id);
  const nextLabel = C.STAGE_LABELS ? C.STAGE_LABELS[nextStage] : nextStage;
  const previous = contact.stage;
  contact.stage = nextStage;
  bumpData?.();
  window.showToast?.(`Advanced to ${nextLabel}`);
  const numericStage = C.STAGE_STR_TO_NUM ? C.STAGE_STR_TO_NUM[nextStage] : null;
  try {
    if (C.__db && numericStage != null) {
      const { error } = await C.__db.from('contacts').update({ stage: numericStage }).eq('id', contact.id);
      if (error) { contact.stage = previous; bumpData?.(); window.showToast?.(`Couldn't save: ${error.message}`); }
      else if (C.recordStageTransition) C.recordStageTransition(contact.id, (C.STAGE_STR_TO_NUM ? C.STAGE_STR_TO_NUM[previous] : null) ?? null, numericStage);
    }
  } finally { _stageActionInFlight.delete(contact.id); }
}

function ContactInfoRows({ contact, bumpData, onOpenTab, hideStageCta }) {
  const phoneFmt = formatPhone(contact.phone);
  // Show the full address as it was entered. The previous "Street · Jurisdiction"
  // form (e.g. "109 Suzanna Drive · Spartanburg") truncated City/State/ZIP - and
  // worse, it conflated jurisdiction (county for permitting) with city, so a
  // contact in Inman, SC inside Spartanburg County rendered as "Spartanburg".
  // Fall back to a cleaned-up street if the full address is missing.
  const fullAddress = (contact.address || '').trim();
  const street = fullAddress.split(',')[0].trim();
  const addressDisplay = fullAddress || street;
  const addressForCopy = addressDisplay;
  const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(addressDisplay)}`;
  // Only offer Map / Neighbors when the address is a real street (not a
  // city-only fragment), so the icons never open Maps on "Spartanburg".
  // Copy stays unconditional so a fragment can still be copied. Matches the
  // mailing-slip path's existing validity gate.
  const addressMappable = isAddressableStreet(contact.address);

  // Stage advance
  const stageIdx = CRM.STAGE_ORDER.indexOf(contact.stage);
  const nextStage = stageIdx >= 0 && stageIdx < CRM.STAGE_ORDER.length - 1
    ? CRM.STAGE_ORDER[stageIdx + 1] : null;
  const nextStageLabel = nextStage ? CRM.STAGE_LABELS[nextStage] : null;
  const advancingRef = React.useRef(false);
  const advanceStage = async () => {
    if (!nextStage) return;
    if (advancingRef.current) return;
    advancingRef.current = true;
    const previous = contact.stage;
    contact.stage = nextStage;
    bumpData?.();
    window.showToast?.(`Advanced to ${nextStageLabel}`);
    const numericStage = CRM.STAGE_STR_TO_NUM?.[nextStage];
    try {
      if (CRM.__db && numericStage != null) {
        const { error } = await CRM.__db.from('contacts').update({ stage: numericStage }).eq('id', contact.id);
        if (error) {
          contact.stage = previous;
          bumpData?.();
          window.showToast?.(`Couldn't save: ${error.message}`);
        } else {
          CRM.recordStageTransition?.(contact.id, CRM.STAGE_STR_TO_NUM?.[previous] ?? null, numericStage);
        }
      }
    } finally {
      advancingRef.current = false;
    }
  };

  // Some stage verbs are an actual feature, not just a stage flip:
  // - "Send quote" should open the New Proposal modal (and the modal will
  //   bump stage 1→2 on insert anyway, so don't double-bump here).
  // - "Schedule install" should jump to Schedule tab + open Add Event.
  // - "Pull permit" jumps to Permits affordance.
  // Anything else (Mark booked / waiting / approved / done) is a pure stage
  // bump and goes through advanceStage as before.
  const handleStageAction = () => {
    if (contact.stage === 'new') {
      // Handshake: stash the pending contact on window so the destination
      // component can pick it up in its own mount effect, no timer race.
      // The delayed dispatch stays as a belt-and-suspenders for the case
      // where the tab is already mounted.
      window.__pendingOpenProposal = contact.id;
      onOpenTab?.('finance');
      setTimeout(() => window.dispatchEvent(new CustomEvent('crm-open-new-proposal', { detail: { contactId: contact.id } })), 300);
      return;
    }
    if (contact.stage === 'permit_approved') {
      window.__pendingAddEvent = contact.id;
      onOpenTab?.('calendar');
      setTimeout(() => window.dispatchEvent(new CustomEvent('crm-open-add-event', { detail: { contactId: contact.id } })), 300);
      return;
    }
    advanceStage();
  };

  const tier = contact.pricing_tier;
  const tierLabel = tier === 'premium_plus' ? '★ Premium+' : tier === 'premium' ? '★ Premium' : 'Standard';
  const tierColor = tier !== 'standard' ? GOLD : NAVY;

  const copy = async (text, label) => {
    const ok = await window.copyText(text);
    window.showToast?.(ok ? label + ' copied' : 'Copy failed');
  };

  // remake-2 (approved comp): the .ghost-row atom for missing email/address.
  // Full-width quiet row, 48px tall, 13px/700 faint, plus glyph. Same
  // crm-edit-contact handler as before, only the presentation changed.
  const GhostAddRow = ({ children, onClick }) => (
    <button
      onClick={onClick}
      style={{
        display:'flex', alignItems:'center', gap:8, width:'100%', minHeight:48,
        padding:0, border:'none', borderTop:'1px solid rgba(27,43,75,0.08)',
        background:'none', fontSize:13, fontWeight:700, color:'#8a93a6',
        textAlign:'left', cursor:'pointer', fontFamily:'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#eef1f6'; e.currentTarget.style.color = NAVY; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#8a93a6'; }}
    >
      <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1v10M1 6h10" /></svg>
      {children}
    </button>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      {/* remake-2 dropped Copy from these rows ("one action per row"); Key
          rejected that deviation 2026-06-11 ("i also lost the copy buttons
          on the contact page"). Copy restored on phone/email/address using
          the same CopyBtn atom as before, Text stays dropped (Messages tab
          owns it). */}
      <InfoLineRow
        label="Phone"
        value={phoneFmt}
        mono
        actions={<>
          <CopyBtn onClick={() => copy(contact.phone, 'Phone')} />
        </>}
      />
      {contact.email ? (
        <InfoLineRow
          label="Email"
          value={contact.email}
          actions={<>
            <CopyBtn onClick={() => copy(contact.email, 'Email')} />
            <MailIconBtn href={`mailto:${contact.email}`} />
          </>}
        />
      ) : (
        <GhostAddRow onClick={() => window.dispatchEvent(new CustomEvent('crm-edit-contact', { detail: { contactId: contact.id } }))}>
          Add email
        </GhostAddRow>
      )}
      {contact.address ? (
        <InfoLineRow
          label="Address"
          value={addressDisplay}
          actions={<>
            <CopyBtn onClick={() => copy(addressDisplay, 'Address')} />
            {addressMappable && <MapIconBtn onClick={() => window.open(mapsUrl, '_blank', 'noopener,noreferrer')} />}
            {addressMappable && <NeighborsIconBtn onClick={() => window.open(`/tools/neighbor-finder/?address=${encodeURIComponent(addressDisplay)}`, '_blank', 'noopener,noreferrer')} />}
          </>}
        />
      ) : (
        <GhostAddRow onClick={() => window.dispatchEvent(new CustomEvent('crm-edit-contact', { detail: { contactId: contact.id } }))}>
          Add address
        </GhostAddRow>
      )}
      <InfoLineRow
        label="Stage"
        value={CRM.STAGE_LABELS[contact.stage]}
        // Hide the Stage CTA for "Pull permit" - the Permits card below
        // has its own "Start permit" button which is the canonical place
        // to start one. Two buttons that do the same thing was confusing.
        // remake-2: the advance CTA wears the comp's .btn-advance (gold pill,
        // 44px, soft gold glow). handleStageAction untouched.
        actions={(nextStageLabel && contact.stage !== 'booked' && !hideStageCta) ? (
          <button onClick={handleStageAction} style={{
            height:44, padding:'0 18px', borderRadius:100,
            background:GOLD, color:NAVY, border:'none',
            fontSize:13, fontWeight:700, fontFamily:'inherit', cursor:'pointer',
            whiteSpace:'nowrap', flexShrink:0,
            boxShadow:'0 2px 10px rgba(255,186,0,0.3)',
          }}>{stageActionVerbFor(contact.stage)}</button>
        ) : null}
      />
      {/* Enrichment facts (panel_location / generator / availability_notes) used
          to render as three InfoLineRows HERE (the 2026-06-24 interim fix so the
          AI Confirm had a visible home). The contact-card overhaul PROMOTED them
          into the "Setup at a glance" tile block (JobSetupCard) above this Contact
          section, so they are intentionally NOT rendered here anymore (no
          duplicate). The Confirm still works: contact-enrich writes those columns,
          realtime refetches, and the in-memory optimistic update on confirm makes
          the Setup tiles fill instantly. The columns are unchanged in CONTACT_COLS
          / mapContact. */}
      {/* Pre-read + Installer/Sub rows RELOCATED into the KNOW card above (slice 5)
          so all reference/intelligence lives in one place; the Contact section is now
          pure identity. */}
      {/* Tags row removed per user - not needed today. The TagsRow
          component + localStorage persistence is left in place so
          re-enabling later is a one-line revert. */}
      {/* Tier row dropped - the Premium / Premium+ pill already sits in the
          hero overlay, so a duplicate row here is redundant. */}
    </div>
  );
}

// Picker for who's doing this install + how much they get paid. Saves
// to contacts.assigned_installer + contacts.installer_pay so the sub
// portal /sub/?token= filters the job onto that installer's schedule
// and the per-job pay shows on their card. Defaults to Key when unset.
// Quote Desk card (2026-07-13): firm-quote SMS prefill + one-tap draft
// proposal from a completed walk / pre-read. Reuses navy + gold button
// language already on Ready-to-quote rows. NOTHING auto-sends SMS.
function QuoteDeskCard({ contact, preRead, onOpenTab, bumpData }) {
  const sug = React.useMemo(() => {
    if (typeof window.CRM?.suggestFirmQuote === 'function') {
      return window.CRM.suggestFirmQuote(contact, preRead);
    }
    return null;
  }, [contact, preRead]);

  const onTextQuote = async () => {
    if (contact.do_not_contact) {
      window.showToast?.('Marked do not contact');
      return;
    }
    const res = window.CRM?.prefillFirmQuoteSms
      ? window.CRM.prefillFirmQuoteSms(contact, preRead)
      : { ok: false, error: 'quote desk not loaded' };
    if (!res.ok) {
      window.showToast?.('Could not draft: ' + (res.error || 'unknown'));
      return;
    }
    onOpenTab?.('messages');
  };

  return (
    <div style={{
      marginTop:12, width:'100%', background:'#fff', border:'1px solid rgba(11,31,59,0.12)',
      borderRadius:12, padding:'12px 15px', boxSizing:'border-box',
    }}>
      <button
        type="button"
        onClick={onTextQuote}
        aria-label={`Draft a firm-quote text for ${contact.name || 'contact'}`}
        style={{
          width:'100%', minHeight:48, background:NAVY, color:'#fff', border:'none', borderRadius:10,
          fontSize:15, fontWeight:700, fontFamily:'inherit', cursor:'pointer',
        }}
      >{sug ? ('Text $' + sug.dollars) : 'Text quote'}</button>
    </div>
  );
}

// Flow C Price Brief row: what the pre-read knows about this property +
// what the customer confirmed on their Pre-Read page. Pure InfoLineRow
// reuse (no new visual language); renders nothing when no pre-read
// exists, so every pre-Flow-C contact is untouched.
function PreReadRow({ contact, pr: prProp }) {
  // Backward-compatible: if a parent supplies the fetched pre-read as `pr`, use it and
  // skip the self-fetch (slice 5, ContactOverview now owns the single fetch so the
  // KNOW card can gate on the pre-read's existence). Absent the prop, self-fetch as
  // before.
  const selfFetch = prProp === undefined;
  const [prState, setPrState] = React.useState(null);
  React.useEffect(() => {
    if (!selfFetch) return;
    let alive = true;
    setPrState(null);
    if (window.CRM?.fetchPreRead) {
      window.CRM.fetchPreRead(contact.id).then(r => { if (alive) setPrState(r); });
    }
    return () => { alive = false; };
  }, [contact.id, selfFetch]);
  const pr = selfFetch ? prState : prProp;
  if (!pr) return null;
  const tc = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  // Distance band labels, mirrored from walk-v2/thankyou.html so the CRM shows
  // the SAME words the customer picked. 'not_sure' has no midpoint (server
  // stores customer_run_ft_estimate = null), so before this fix the whole
  // distance answer was invisible to Key. Show the band either way.
  const BAND_LABEL = { about_5: 'about 5 ft', '5_10': 'about 5-10 ft', '10_20': 'about 10-20 ft', '20_40': 'about 20-40 ft', over_40: 'over 40 ft', not_sure: 'not sure' };
  const bits = [tc(pr.confidence) + ' confidence'];
  if (pr.subdivision) bits.push(tc(pr.subdivision));
  if (contact.amperage) bits.push('Outlet: ' + contact.amperage + 'A');
  if (pr.confirmed_panel_room) bits.push('Panel: ' + pr.confirmed_panel_room.replace(/_/g, ' '));
  if (pr.confirmed_generator_spot) bits.push('Spot tapped');
  // Distance: prefer the midpoint estimate AND name the band the customer
  // chose; when there is no midpoint (the 'not sure' answer) still surface the
  // band so Key knows to confirm the run on the call.
  const bandLabel = pr.distance_band ? BAND_LABEL[pr.distance_band] : null;
  if (pr.customer_run_ft_estimate != null) {
    bits.push('Run ~' + Math.round(pr.customer_run_ft_estimate) + ' ft' + (bandLabel ? ' (' + bandLabel + ')' : ''));
  } else if (bandLabel) {
    bits.push('Distance: ' + bandLabel);
  } else if (pr.distance_band) {
    bits.push('Distance noted');
  }
  if (pr.clone_contact_id) bits.push('Prior install in this subdivision');
  if (pr.photo_received_at) {
    const verdict = pr.photo_read && pr.photo_read.subject;
    bits.push(verdict && verdict !== 'unsure' ? 'Photo in (' + verdict.replace(/_/g, ' ') + ')' : 'Photo in');
  } else if (pr.first_viewed_at) bits.push('Page viewed');
  if (pr.save_later_requested_at) bits.push('Saved for later');
  if (pr.range_low_cents != null && pr.range_high_cents != null) {
    bits.push('Walk $' + Math.round(pr.range_low_cents / 100) + ' to $' + Math.round(pr.range_high_cents / 100));
  }
  // Cutover (Key 2026-06-15): the walk link Key copies/sends now points at the
  // live 5-page walk-v2 (resume guard routes the token forward), not the
  // retired single-page pre-read.
  const walkUrl = pr.token ? ('https://qa.backuppowerpro.com/walk-v2/?t=' + pr.token) : null;
  return (
    <InfoLineRow label="Pre-read" value={
      <span>
        {bits.join(' · ')}
        {walkUrl && <>
          {' · '}
          <a href={walkUrl} target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline' }}>View walk</a>
        </>}
      </span>
    } />
  );
}

function InstallerAssignmentRow({ contact, bumpData }) {
  const [editing, setEditing] = React.useState(false);
  const installers = React.useMemo(() => {
    const list = window.CRM?.installers || [];
    if (list.length === 0) return ['Key'];
    return list;
  }, []);
  const [name, setName] = React.useState(contact.assigned_installer || '');
  const [pay,  setPay]  = React.useState(contact.installer_pay != null ? String(contact.installer_pay) : '');
  React.useEffect(() => {
    setName(contact.assigned_installer || '');
    setPay(contact.installer_pay != null ? String(contact.installer_pay) : '');
  }, [contact.id, contact.assigned_installer, contact.installer_pay]);

  const save = async () => {
    const cleanName = (name || '').trim() || null;
    const cleanPay = pay === '' ? null : Number(pay);
    if (cleanPay != null && (isNaN(cleanPay) || cleanPay < 0)) {
      window.showToast?.('Pay must be a non-negative number');
      return;
    }
    const prevName = contact.assigned_installer;
    const prevPay  = contact.installer_pay;
    contact.assigned_installer = cleanName;
    contact.installer_pay = cleanPay;
    bumpData?.();
    setEditing(false);
    if (!CRM.__db) return;
    const { error } = await CRM.__db.from('contacts')
      .update({ assigned_installer: cleanName, installer_pay: cleanPay })
      .eq('id', contact.id);
    if (error) {
      contact.assigned_installer = prevName;
      contact.installer_pay = prevPay;
      bumpData?.();
      window.showToast?.(`Save failed: ${error.message}`);
      return;
    }
    window.showToast?.(cleanName ? `Assigned to ${cleanName}` : 'Unassigned');
  };

  if (!editing) {
    const display = contact.assigned_installer
      ? `${contact.assigned_installer}${contact.installer_pay ? ` · $${Number(contact.installer_pay).toLocaleString()}` : ''}`
      : 'Unassigned';
    return (
      <InfoLineRow
        label="Installer"
        value={display}
        valueColor={contact.assigned_installer ? NAVY : MUTED}
        actions={
          <button onClick={() => setEditing(true)} style={{
            background:'transparent', border:'1px solid rgba(11,31,59,0.15)', color:NAVY,
            borderRadius:6, padding:'4px 10px', fontSize:12, fontWeight:600, minHeight:44,
            cursor:'pointer', fontFamily:'inherit',
          }}>{contact.assigned_installer ? 'Change' : 'Assign'}</button>
        }
      />
    );
  }
  return (
    <div style={{ display:'flex', gap:6, alignItems:'center', padding:'10px 14px', borderBottom:'1px solid #F0EFEA', flexWrap:'wrap' }}>
      <span style={{ width:80, flexShrink:0, fontSize:12, fontWeight:600, color:MUTED, textTransform:'uppercase', letterSpacing:'0.04em' }}>Installer</span>
      <input
        list="bpp-installer-list"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Key"
        style={{ flex:'2 1 110px', minWidth:0, height:44, padding:'0 10px', border:'1.5px solid #EBEBEA', borderRadius:6, fontSize:16, color:NAVY, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}
      />
      <datalist id="bpp-installer-list">
        {installers.map(i => <option key={i} value={i} />)}
      </datalist>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="25"
        value={pay}
        onChange={e => setPay(e.target.value)}
        placeholder="Pay $"
        style={{ flex:'1 1 80px', minWidth:0, height:44, padding:'0 10px', border:'1.5px solid #EBEBEA', borderRadius:6, fontSize:16, color:NAVY, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}
      />
      <button onClick={save} style={{ height:44, padding:'0 14px', background:GOLD, color:NAVY, border:'none', borderRadius:6, fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>Save</button>
      <button onClick={() => { setEditing(false); setName(contact.assigned_installer || ''); setPay(contact.installer_pay != null ? String(contact.installer_pay) : ''); }} style={{ height:44, padding:'0 10px', background:'transparent', color:MUTED, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:13 }}>Cancel</button>
    </div>
  );
}

// ── Tags ────────────────────────────────────────────────────────────
// Custom labels per-contact. Source of truth = contacts.tags column
// (migration 20260509150000). Synced via the contacts realtime channel.
// localStorage was the previous home; backfill in crm-app.jsx migrates
// any leftover entries and the helper below reads from CRM.contacts so
// every device sees the same labels.
function tagsFor(contactId) {
  const c = (window.CRM?.contacts || []).find(x => x.id === contactId);
  return Array.isArray(c?.tags) ? c.tags : [];
}

function TagsRow({ contactId }) {
  const [tags, setTags] = React.useState(() => tagsFor(contactId));
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  React.useEffect(() => { setTags(tagsFor(contactId)); }, [contactId]);
  React.useEffect(() => {
    const refresh = () => setTags(tagsFor(contactId));
    window.addEventListener('crm-tags-changed', refresh);
    window.addEventListener('crm-data-changed', refresh);
    return () => {
      window.removeEventListener('crm-tags-changed', refresh);
      window.removeEventListener('crm-data-changed', refresh);
    };
  }, [contactId]);

  // Optimistic flip + DB write + revert on error. Same pattern as
  // togglePin / DNC: in-memory mutation first so the chip reflects
  // immediately, then persist.
  const commit = async (next) => {
    const live = (CRM.contacts || []).find(c => c.id === contactId);
    const prev = live?.tags ? [...live.tags] : [];
    if (live) live.tags = [...next];
    setTags(next);
    window.dispatchEvent(new CustomEvent('crm-tags-changed'));
    window.dispatchEvent(new CustomEvent('crm-data-changed'));
    if (CRM.__db) {
      const { error } = await CRM.__db.from('contacts')
        .update({ tags: next })
        .eq('id', contactId);
      if (error) {
        if (live) live.tags = prev;
        setTags(prev);
        window.dispatchEvent(new CustomEvent('crm-tags-changed'));
        window.dispatchEvent(new CustomEvent('crm-data-changed'));
        window.showToast?.('Tag save failed: ' + error.message);
      }
    }
  };
  const removeTag = (t) => commit(tags.filter(x => x !== t));
  const addTag = () => {
    const v = draft.trim().slice(0, 24);
    if (!v) { setAdding(false); return; }
    if (tags.includes(v)) { setDraft(''); setAdding(false); return; }
    commit([...tags, v]);
    setDraft('');
    setAdding(false);
  };

  return (
    <InfoLineRow
      label="Tags"
      value={
        <div style={{ display:'flex', flexWrap:'wrap', gap:5, alignItems:'center' }}>
          {tags.map(t => (
            // Audit-2026-05-09 a11y L2: explicit aria-label so the button's
            // accessible name is "Remove tag VIP" instead of just "VIP".
            // Screen readers couldn't tell that tapping removed the tag.
            <button key={t} onClick={() => removeTag(t)} title="Remove tag" aria-label={`Remove tag ${t}`} style={{
              // Edit-button pattern: 44-tall hit zone, same 22px visual pill.
              minHeight:44, padding:'11px 0', margin:'-11px 0',
              background:'none', border:'none', cursor:'pointer', fontFamily:'inherit',
              display:'inline-flex', alignItems:'center',
            }}>
              <span style={{
                height:22, padding:'0 8px', borderRadius:11,
                background:'#EEF2FF', color:'#3730A3', fontSize:11, fontWeight:600,
                display:'inline-flex', alignItems:'center', gap:4,
              }}>{t}<span aria-hidden="true" style={{ opacity:0.5, fontSize:12 }}>✕</span></span>
            </button>
          ))}
          {adding ? (
            <input value={draft} onChange={e => setDraft(e.target.value)}
              onBlur={addTag}
              onKeyDown={e => { if (e.key === 'Enter') addTag(); if (e.key === 'Escape') { setAdding(false); setDraft(''); } }}
              autoFocus placeholder="VIP, Refer, Slow…"
              style={{ height:44, padding:'0 12px', borderRadius:22, border:'1px solid rgba(11,31,59,0.2)', background:'white', fontSize:16, fontFamily:'inherit', color:NAVY, outline:'none', width:150 }}
            />
          ) : (
            <button onClick={() => setAdding(true)} aria-label="Add tag" style={{
              // Edit-button pattern: 44-tall hit zone, same 22px visual pill.
              minHeight:44, padding:'11px 0', margin:'-11px 0',
              background:'none', border:'none', cursor:'pointer', fontFamily:'inherit',
              display:'inline-flex', alignItems:'center',
            }}>
              <span style={{
                height:22, padding:'0 8px', borderRadius:11, border:'1px dashed rgba(11,31,59,0.25)', background:'white',
                color:MUTED, fontSize:11, fontWeight:600,
                display:'inline-flex', alignItems:'center',
              }}>+ tag</span>
            </button>
          )}
          {tags.length === 0 && !adding && (
            <span style={{ fontSize:11, color:MUTED }}>None</span>
          )}
        </div>
      }
    />
  );
}

// ── Permits Card ──────────────────────────────────────────────────
const PERMIT_PILL = {
  approved:    { bg:'#16a34a', color:'white', label:'Approved' },
  submitted:   { bg:'#f59e0b', color:'white', label:'Submitted' },
  waiting:     { bg:'#2563eb', color:'white', label:'Waiting' },
  blocked:     { bg:'#dc2626', color:'white', label:'Blocked' },
  not_started: { bg:'#999',    color:'white', label:'Not started' },
};

function CardShell({ eyebrow, children }) {
  // iOS Phase 1 (Key 2026-07-09): shared detail-card wrapper. Light/flat
  // shape matching docs/redesign-comps/ios-nav-shell.html .ncard: white
  // surface, 16px radius, 1px INSET hairline via box-shadow (no outer
  // border to leak past selection states), no drop shadow, generous
  // padding for calm reading rhythm. Same recipe as the shared
  // .bpp-ios-card CSS class in index.html.
  return (
    <div style={{ background:'#ffffff', marginTop:12, padding:'18px 18px', border:0, borderRadius:16, boxShadow:'inset 0 0 0 1px rgba(27,43,75,0.085)' }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#8a93a6', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>{eyebrow}</div>
      {children}
    </div>
  );
}

function PermitPill({ status }) {
  const p = PERMIT_PILL[status] || PERMIT_PILL.not_started;
  return <span style={{ background:p.bg, color:p.color, padding:'4px 8px', borderRadius:6, fontSize:11, fontWeight:500, whiteSpace:'nowrap' }}>{p.label}</span>;
}

// Compact horizontal stepper for the happy path not_started -> submitted
// -> waiting -> approved. Composed from PERMIT_PILL colors + the same pill
// geometry as PermitPill (padding/radius/fontSize/fontWeight), joined by a
// thin connector line. Reached + current steps render in their PERMIT_PILL
// color; upcoming steps render muted gray. Off-path statuses (blocked,
// rejected) keep their position on the path they branched from. The
// status pill above already shows the branch, so the stepper just shows
// where on the happy path the permit got to.
const PERMIT_STEP_ORDER = ['not_started', 'submitted', 'waiting', 'approved'];
function PermitStepper({ status }) {
  // blocked/rejected branch off after submitted, so treat their reached
  // index as "submitted" for the stepper position.
  const effective = PERMIT_STEP_ORDER.includes(status) ? status : 'submitted';
  const reachedIdx = PERMIT_STEP_ORDER.indexOf(effective);
  return (
    <div style={{ display:'flex', alignItems:'center', gap:0, marginBottom:10, flexWrap:'wrap' }}>
      {PERMIT_STEP_ORDER.map((s, i) => {
        const done = i <= reachedIdx;
        const p = PERMIT_PILL[s];
        return (
          <React.Fragment key={s}>
            {i > 0 && (
              <span style={{ width:12, height:2, background: i <= reachedIdx ? p.bg : '#E5E5E5', flexShrink:0 }} />
            )}
            <span style={{
              background: done ? p.bg : '#F3F4F6',
              color: done ? p.color : '#999',
              padding:'4px 8px', borderRadius:4, fontSize:11, fontWeight:500, whiteSpace:'nowrap',
            }}>{p.label}</span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Secondary-action pill (was gold; toned to navy-outline in the contact-page v2
// gold-density pass so the ONE gold on a screen is the DO NEXT primary action, not a
// workflow affordance like "Start permit"). Same size/behavior, color only.
function GoldPillButton({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ background:'#fff', color:NAVY, border:'1px solid #1B2B4B', borderRadius:6, padding:'8px 14px', minHeight:44, fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>{children}</button>
  );
}

// Single source of truth moved to crm-data.js (window.BPP_JURISDICTIONS,
// next to predictJurisdiction): this used to be a hand-duplicated local
// const (2026-07-04 fix note below, kept for history) that had to be kept in
// sync with the live permit_jurisdictions table by hand. Both this file and
// the Ionic CRM now read the one shared array so a directory addition is a
// single edit. Before the 2026-07-04 fix Key could not manually pick any of
// the 4 self-permitting cities from this list even though they existed in
// the directory; that fix lives on in the shared array's own comment.
const BPP_JURISDICTIONS = window.BPP_JURISDICTIONS;

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
    </svg>
  );
}

function JurisdictionEditor({ permit, contact, bumpData }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  // Address -> jurisdiction suggestion. predictJurisdiction is a pure helper in
  // crm-data.js; surface its result as a one-tap pick when it differs from the
  // current value, always flagged "verify" so the operator confirms city limits.
  const pred = (contact && contact.address && typeof predictJurisdiction === 'function')
    ? predictJurisdiction(contact.address) : null;
  const showPred = pred && pred.jurisdiction && pred.jurisdiction !== permit.jurisdiction;

  React.useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = async (name) => {
    setOpen(false);
    if (permit.jurisdiction === name) return;
    const prev = { jurisdiction: permit.jurisdiction, jurisdiction_name: permit.jurisdiction_name };
    // Optimistic flip
    permit.jurisdiction = name;
    permit.jurisdiction_name = name;
    bumpData?.();
    // Persist + revert on error. Look up the jurisdiction_id from the
    // existing permit_jurisdictions table by name so the FK stays valid.
    if (!CRM.__db) return;
    let jurisdictionId = null;
    try {
      const { data } = await CRM.__db.from('permit_jurisdictions').select('id').eq('name', name).limit(1);
      if (data?.[0]?.id) jurisdictionId = data[0].id;
    } catch (_) {}
    const { error } = await CRM.__db.from('permits')
      .update({ jurisdiction_name: name, jurisdiction_id: jurisdictionId })
      .eq('id', permit.id);
    if (error) {
      permit.jurisdiction = prev.jurisdiction;
      permit.jurisdiction_name = prev.jurisdiction_name;
      bumpData?.();
      window.showToast?.('Jurisdiction save failed: ' + error.message);
      return;
    }
    permit.jurisdiction_id = jurisdictionId;
    window.showToast?.('Jurisdiction updated');
  };

  return (
    <span ref={wrapRef} style={{ position:'relative', display:'inline-flex', alignItems:'center', gap:6, flex:1, minWidth:0 }}>
      <span style={{ fontSize:15, fontWeight:600, color:NAVY, minWidth:0 }}>{permit.jurisdiction}</span>
      <button onClick={()=>setOpen(o=>!o)} aria-label="Edit jurisdiction" style={{
        background:'none', border:'none', padding:2, cursor:'pointer',
        color:'#999', display:'inline-flex', alignItems:'center', justifyContent:'center',
      }}><PencilIcon /></button>
      {open && (
        <div style={{
          position:'absolute', left:0, top:'calc(100% + 4px)', zIndex:50,
          width:200, background:'white', border:'1px solid rgba(27,43,75,0.12)',
          borderRadius:8, boxShadow:'0 8px 24px rgba(27,43,75,0.16)', padding:4,
        }}>
          {showPred && (
            <div style={{ padding:'2px 2px 6px', borderBottom:'1px solid rgba(27,43,75,0.08)', marginBottom:4 }}>
              <div style={{ fontSize:12, fontWeight:700, letterSpacing:'.04em', textTransform:'uppercase', color:'#9ca3af', padding:'0 8px 3px' }}>Suggested from address</div>
              <button onClick={()=>pick(pred.jurisdiction)} style={{
                width:'100%', textAlign:'left', padding:'7px 10px', background:'rgba(255,186,0,0.14)',
                border:'none', borderRadius:6, color:NAVY, fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
              }}>
                {pred.jurisdiction}
                <span style={{ display:'block', fontSize:11, fontWeight:400, color:'#6b7280', marginTop:1 }}>{pred.note}</span>
              </button>
            </div>
          )}
          {BPP_JURISDICTIONS.map(name => (
            <button key={name} onClick={()=>pick(name)} style={{
              width:'100%', textAlign:'left', padding:'7px 10px',
              background: permit.jurisdiction===name ? '#F0F4FF' : 'none',
              border:'none', borderRadius:6, color:NAVY,
              fontSize:13, fontWeight:500, fontFamily:'inherit', cursor:'pointer',
            }}
              onMouseEnter={e=>{ if (permit.jurisdiction!==name) e.currentTarget.style.background='#F8F8F6'; }}
              onMouseLeave={e=>{ if (permit.jurisdiction!==name) e.currentTarget.style.background='none'; }}
            >{name}</button>
          ))}
        </div>
      )}
    </span>
  );
}

// permits.status -> contact.stage map. The 3 permit-phase pipeline stages
// (4/5/6) mirror the permit machine: submitted->permit_submit,
// waiting->permit_waiting, approved->permit_approved. not_started/blocked
// don't move the pipeline (blocked is a side-state, not a stage).
const PERMIT_STATUS_TO_STAGE = {
  submitted: 'permit_submit',
  waiting: 'permit_waiting',
  approved: 'permit_approved',
};

function PermitStatusActions({ permit, contact, bumpData }) {
  // Optimistic + await + revert on error. Persists the new status +
  // any timestamp stamps (submitted_at, approved_at) and the
  // blocker_note when transitioning to/from blocked.
  const advance = async (toStatus, stamps = {}) => {
    const prev = {
      status: permit.status,
      submitted_at: permit.submitted_at,
      approved_at: permit.approved_at,
      blocker_note: permit.blocker_note,
    };
    permit.status = toStatus;
    Object.assign(permit, stamps);
    bumpData?.();
    if (!CRM.__db) return;
    const patch = { status: toStatus, ...stamps };
    const { error } = await CRM.__db.from('permits').update(patch).eq('id', permit.id);
    if (error) {
      Object.assign(permit, prev);
      bumpData?.();
      window.showToast?.('Permit save failed: ' + error.message);
      return;
    }
    window.showToast?.(`Permit: ${capitalize(toStatus)}`);
    // Sync contact.stage to follow the permit status (submitted->4,
    // waiting->5, approved->6). Mirrors addPermit's optimistic-update +
    // rollback pattern. Only advance forward, never drag a contact back
    // (e.g. a later "Mark waiting" correction shouldn't undo install).
    const targetStage = PERMIT_STATUS_TO_STAGE[toStatus];
    if (contact && targetStage && contact.stage !== targetStage
        && CRM.STAGE_STR_TO_NUM?.[targetStage] != null) {
      const targetNum = CRM.STAGE_STR_TO_NUM[targetStage];
      const currentNum = CRM.STAGE_STR_TO_NUM?.[contact.stage] ?? 0;
      if (targetNum > currentNum) {
        const previousStage = contact.stage;
        contact.stage = targetStage;
        bumpData?.();
        const { error: stageErr } = await CRM.__db.from('contacts')
          .update({ stage: targetNum })
          .eq('id', contact.id);
        if (stageErr) {
          contact.stage = previousStage;
          bumpData?.();
          window.showToast?.('Stage save failed: ' + stageErr.message);
        } else {
          CRM.recordStageTransition?.(contact.id, CRM.STAGE_STR_TO_NUM?.[previousStage] ?? null, targetNum);
        }
      }
    }
  };
  // Compute the date at CLICK time, not at render/module load: the module-level
  // TODAY is captured once, so a tab left open past midnight would stamp
  // yesterday on submitted_at/approved_at (bug hunt 2026-06-20).
  const freshToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  const baseBtn = {
    height:44, borderRadius:8, padding:'0 12px',
    fontSize:12, fontWeight:600, fontFamily:'inherit',
    cursor:'pointer', whiteSpace:'nowrap',
    display:'inline-flex', alignItems:'center', justifyContent:'center',
  };
  const goldBtn   = { ...baseBtn, background:'#ffba00', color:NAVY, border:'none', flex:1 };
  const ghostBtn  = { ...baseBtn, background:'white', color:NAVY, border:'1px solid rgba(27,43,75,0.15)', flex:1 };
  const dangerBtn = { ...baseBtn, background:'white', color:'#dc2626', border:'1px solid rgba(220,38,38,0.3)', flex:1 };
  const dangerSolidBtn = { ...baseBtn, background:'#dc2626', color:'white', border:'none', flex:1 };

  if (permit.status === 'not_started') {
    return (
      <button onClick={()=>advance('submitted', { submitted_at: freshToday() })} style={{ ...goldBtn, width:'100%' }}>Submit permit</button>
    );
  }
  if (permit.status === 'submitted') {
    return (
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={()=>advance('waiting')} style={ghostBtn}>Mark waiting</button>
        <button onClick={()=>advance('approved', { approved_at: freshToday() })} style={goldBtn}>Mark approved</button>
      </div>
    );
  }
  if (permit.status === 'waiting') {
    return (
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={()=>advance('approved', { approved_at: freshToday() })} style={goldBtn}>Mark approved</button>
        <button onClick={()=>advance('blocked', { blocker_note: permit.blocker_note || 'Awaiting reviewer feedback' })} style={dangerBtn}>Mark blocked</button>
      </div>
    );
  }
  if (permit.status === 'approved') {
    // Approved permits don't need an inline action - the row already shows
    // the approved date. The actual letter PDF lives in the jurisdiction
    // portal (use the Permit portals popover at the top of the contacts list
    // to log in and download). Showing a button here would be a stub.
    return null;
  }
  if (permit.status === 'blocked') {
    return (
      <div>
        <button onClick={()=>advance('waiting', { blocker_note: null })} style={{ ...dangerSolidBtn, width:'100%' }}>Resolve blocker</button>
        {permit.blocker_note && (
          <div style={{ fontSize:12, color:'#666', marginTop:6 }}>{permit.blocker_note}</div>
        )}
      </div>
    );
  }
  return null;
}

// Mailing slip generator - ported from v2 crm.html generateMailingInsert.
// 8.5x11 single sheet that folds into #10 window envelope:
//   - top window shows Key's return address
//   - bottom window shows customer's address
//   - middle panel is the permit letter
// Renders a TRUE 8.5x11 PDF (jsPDF) at calibrated inch coordinates, then
// opens it to print. We do NOT print an HTML page: the browser print
// dialog's default scaling/margins shrink and shift HTML, walking the
// addresses out of the envelope windows (the bug Key hit). The PDF bakes
// the geometry into the file, so it lines up when printed at "Actual
// size". Address-block coords are measured-equal (<=0.01in) to the
// physically-validated standalone PDFs that fit the #10 window envelope.
const MAILING_RETURN_ADDRESS = {
  name: 'Key Goodson',
  company: 'Backup Power Pro',
  line1: '22 Kimbell Ct',
  city: 'Greenville, SC 29617',
  phone: '(864) 863-7800',
};
// 2026-05-26 test-battery findings: naive comma-split breaks the
// mailing slip on real-world addresses. Fixes:
//   (a) Strip ", United States" / ", USA" suffix that Google Maps
//       autocomplete appends. None of our customers need it on a
//       mailing envelope.
//   (b) Convert "South Carolina"/"North Carolina"/"Georgia" full
//       state names to USPS 2-letter codes. Saves ~10 chars per
//       line so the bottom window doesn't wrap.
//   (c) Collapse extra commas - if the address has 3+ segments after
//       cleanup, fold city + state + zip onto one bottom line.
//   (d) If the address has no commas at all, try splitting before
//       the street type abbreviation (Rd, St, Ave, Dr, Ln, Ct, Way).
const ADDR_STATE_MAP = {
  'south carolina': 'SC', 'north carolina': 'NC', 'georgia': 'GA',
  'tennessee': 'TN', 'florida': 'FL', 'alabama': 'AL',
};
function normalizeMailingAddress(raw) {
  let s = String(raw || '').trim();
  if (!s) return { line1: '', line2: '', valid: false };
  // (a) Strip country suffixes
  s = s.replace(/,\s*united states\s*$/i, '')
       .replace(/,\s*usa\s*$/i, '')
       .replace(/,\s*u\.s\.a?\.?\s*$/i, '');
  // (b) Long state name → short. Match within the string so the zip stays attached.
  for (const [long, short] of Object.entries(ADDR_STATE_MAP)) {
    const re = new RegExp(`\\b${long}\\b`, 'gi');
    s = s.replace(re, short);
  }
  s = s.replace(/\s{2,}/g, ' ').trim();
  // Split on commas, drop empties.
  let parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return { line1: '', line2: '', valid: false };
  // No commas? Try to split at the street suffix (e.g. "123 Main St Greenville SC 29601").
  if (parts.length === 1) {
    const m = parts[0].match(/^(.+?\b(?:Rd|Road|St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Ter|Terrace|Hwy|Highway|Pkwy|Parkway|Cir|Circle|Trl|Trail)\.?)\s+(.+)$/i);
    if (m) parts = [m[1].trim(), m[2].trim()];
  }
  const line1 = parts[0] || '';
  const line2 = parts.slice(1).join(', ').trim();
  // Minimum viability for actually-deliverable mail:
  //   - street line has a number + is reasonably long
  //   - city/state/zip line is present + has at least a state-ish or zip-ish token
  const streetOk = /\d/.test(line1) && line1.length >= 5;
  const cityLineOk = line2.length >= 4 && (
    /\b[A-Z]{2}\b/.test(line2) ||      // 2-letter state code
    /\b\d{5}\b/.test(line2)            // 5-digit zip
  );
  return { line1, line2, valid: streetOk && cityLineOk };
}

// Lazy-load jsPDF (UMD) from cdnjs with SRI pinning; cached after first use.
let __jspdfPromise = null;
function loadJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (__jspdfPromise) return __jspdfPromise;
  __jspdfPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.integrity = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
    s.crossOrigin = 'anonymous';
    s.referrerPolicy = 'no-referrer';
    s.onload = () => (window.jspdf && window.jspdf.jsPDF)
      ? resolve(window.jspdf.jsPDF)
      : reject(new Error('jsPDF global missing after load'));
    s.onerror = () => { __jspdfPromise = null; reject(new Error('jsPDF failed to load')); };
    document.head.appendChild(s);
  });
  return __jspdfPromise;
}

// Build the insert as an 8.5x11 PDF at calibrated inch coordinates. The two
// address blocks are positioned measured-equal (<=0.01in) to the validated
// standalone PDFs that fit the #10 double-window envelope. Letter copy is the
// comma-only (no em-dash) house version; bold lead-ins preserved via a small
// run-based word-wrapper.
function buildMailerDoc(JsPDFCtor, data) {
  const doc = new JsPDFCtor({ unit: 'in', format: 'letter' });
  const PAGE_W = 8.5;
  const ra = data.ret;

  doc.setFont('times', 'normal'); doc.setTextColor(0, 0, 0);
  // Return address -> top window. Calibrated x=0.70, top=0.397, step 0.159.
  doc.setFontSize(8.5);
  [ra.name, ra.company, ra.line1, ra.city].forEach((ln, i) =>
    doc.text(String(ln || ''), 0.70, 0.397 + i * 0.159, { baseline: 'top' }));
  // Customer address -> bottom window. Calibrated x=0.70, top=2.042, step 0.224.
  doc.setFontSize(10.5);
  [data.mailName, data.mailLine1, data.mailLine2].filter(Boolean).forEach((ln, i) =>
    doc.text(String(ln), 0.70, 2.042 + i * 0.224, { baseline: 'top' }));

  // Fold guides (dashed gray) + subtle labels.
  doc.setDrawColor(187, 187, 187); doc.setLineWidth(0.0104);
  doc.setLineDashPattern([0.03, 0.03], 0);
  doc.line(0.15, 3.667, PAGE_W - 0.15, 3.667);
  doc.line(0.15, 7.333, PAGE_W - 0.15, 7.333);
  doc.setLineDashPattern([], 0);
  doc.setFontSize(5.5); doc.setTextColor(170, 170, 170);
  doc.text('. fold .', PAGE_W / 2, 3.695, { align: 'center', baseline: 'top' });
  doc.text('. fold .', PAGE_W / 2, 7.361, { align: 'center', baseline: 'top' });
  doc.setTextColor(0, 0, 0);

  // Letter body. x=0.85, width 6.8, start 4.05, line step 0.252, para gap 0.16.
  doc.setFontSize(11);
  const LX = 0.85, LW = 6.8, STEP = 0.252, GAP = 0.16;
  let y = 4.05;
  const fn = data.firstName;
  const paras = [
    [{ t: 'Hey ' + fn + '!' }],
    [{ t: 'Enclosed is your permit documentation for the generator connection system we installed at your home. Please keep this document for your records, it is your official proof that the work was permitted and officially approved.' }],
    [{ t: 'About your upcoming inspection:', b: true }, { t: ' You will most likely need to be home when the inspector arrives to verify the work. Unfortunately, we are not able to choose a specific time of day, only the weekday.' }],
    [{ t: 'We recommend', b: true }, { t: ' placing the enclosed permit copy inside your electrical panel door. When the inspector opens the panel, they will find it immediately, this keeps things moving smoothly with no delays on your end.' }],
    [{ t: "If you have any questions before or after the inspection, don't hesitate to reach out. It was great working with you!" }],
  ];
  const drawPara = (runs) => {
    const words = [];
    runs.forEach(r => String(r.t).split(/\s+/).filter(Boolean).forEach(w => words.push({ w, b: !!r.b })));
    let x = LX;
    words.forEach(word => {
      doc.setFont('times', word.b ? 'bold' : 'normal');
      const ww = doc.getTextWidth(word.w);
      if (x + ww > LX + LW && x > LX) { y += STEP; x = LX; }
      doc.text(word.w, x, y, { baseline: 'top' });
      x += ww + doc.getTextWidth(' ');
    });
    y += STEP + GAP;
    doc.setFont('times', 'normal');
  };
  paras.forEach(drawPara);

  y += 0.05;
  doc.text('Best,', LX, y, { baseline: 'top' }); y += STEP;
  doc.text(String(ra.name || ''), LX, y, { baseline: 'top' }); y += STEP;
  doc.text(String(ra.company || ''), LX, y, { baseline: 'top' }); y += STEP;
  doc.text(String(ra.phone || ''), LX, y, { baseline: 'top' });
  return doc;
}

async function generateMailingInsertPDF(contact) {
  if (!contact) { window.showToast?.('No contact'); return; }
  if (!contact.address) { window.showToast?.('Add an address first'); return; }
  const norm = normalizeMailingAddress(contact.address);
  if (!norm.valid) {
    window.showToast?.(`Address "${contact.address}" looks incomplete, edit before mailing`);
    return;
  }
  let JsPDFCtor;
  try { JsPDFCtor = await loadJsPDF(); }
  catch (e) { window.showToast?.('Could not load the PDF engine, check your connection'); return; }
  const doc = buildMailerDoc(JsPDFCtor, {
    ret: MAILING_RETURN_ADDRESS,
    mailName: contact.name || '',
    mailLine1: norm.line1,
    mailLine2: norm.line2,
    firstName: String(contact.name || 'Homeowner').split(' ')[0],
  });
  const safe = String(contact.name || 'customer').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  try {
    const url = doc.output('bloburl');
    const w = window.open(url, '_blank');
    if (!w) { doc.save(`mailing-insert-${safe}.pdf`); window.showToast?.('Saved PDF to downloads. Print at Actual size (100%).'); return; }
    window.showToast?.('Print at Actual size (100%), no scaling, so it lines up with the envelope window.');
  } catch (e) {
    doc.save(`mailing-insert-${safe}.pdf`);
    window.showToast?.('Saved PDF to downloads. Print at Actual size (100%).');
  }
}

// AdvanceJobCard , the one-tap back-half "what's next" control (the adoption
// gap: signed jobs went dark after Booked). Reads the pure advanceJobNext
// engine (crm-data.js) for the single next action + done-trail, and performs
// it via the shared advanceJob* write helpers (which mirror the legacy controls
// exactly). Net-new operator-facing block, designed in Claude Code per Key's
// 2026-06-09 directive ("use claude code for designing the blocks, dont wait on
// me"). Additive: the Permits card + calendar + finance controls all remain.
// ── Completion Packet flow (docs/qa/COMPLETION-PACKET-PLAN.md stage 5) ──
// Module-level and self-contained ON PURPOSE: ContactFinance's emailDoc lives
// in a different component tree, and reusing it would put the packet flow on
// the same code path as the live invoice/receipt emails Key sends daily.
// This duplicates the #202 preview shape (~40 lines) to keep the blast radius
// at zero; consolidating the two into one module-level sender is a conscious
// future candidate (noted in the migration ledger).
// The flow: reuse the newest issued packet if one exists (a second tap means
// resend, never an accidental duplicate certificate) -> otherwise issue via
// the completion-packet fn (the fn refuses without a real inspection PASS;
// Key can attest via a second, explicit confirm, which writes a permanent
// permit_trail record) -> then the email preview + Key's send tap.
let __packetBusy = false;
const __manualEmailClientKeys = new Map();
const __MANUAL_EMAIL_INTENT_PREFIX = 'bpp:manual-email-intent:v1:';
function __manualEmailStableJson(value) {
  if (value === undefined) return '"__undefined__"';
  if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(__manualEmailStableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + __manualEmailStableJson(value[key])).join(',') + '}';
}
async function __manualEmailStorageKey(signature) {
  try {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
    const hash = Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    return __MANUAL_EMAIL_INTENT_PREFIX + hash;
  } catch (_) {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let i = 0; i < signature.length; i += 1) {
      first = Math.imul(first ^ signature.charCodeAt(i), 0x01000193);
      second = Math.imul(second ^ signature.charCodeAt(i), 0x85ebca6b);
    }
    return __MANUAL_EMAIL_INTENT_PREFIX + (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
  }
}
async function __manualEmailIntentLocation(intent) {
  const signature = __manualEmailStableJson(intent);
  const storageKey = await __manualEmailStorageKey(signature);
  return { signature, storageKey, intentKey: storageKey.slice(__MANUAL_EMAIL_INTENT_PREFIX.length) };
}
function __manualEmailIntentIdentity(payload) {
  const vars = payload.variables || {};
  return {
    template: payload.template,
    contact_id: payload.contact_id,
    to_email: payload.to_email,
    subject: payload.subject,
    resource_id: vars.proposal_url || vars.invoice_url || vars.receipt_url
      || vars.certificate_url || vars.owner_guide_url || vars.retry_url
      || vars.quote_num || vars.invoice_num || vars.receipt_num || payload.subject,
  };
}
function __manualEmailStoredRecord(signature, storageKey) {
  let record = __manualEmailClientKeys.get(signature) || null;
  if (!record) {
    try { record = JSON.parse(globalThis.sessionStorage?.getItem(storageKey) || 'null'); } catch (_) { record = null; }
  }
  if (!record || !/^[A-Za-z0-9_-]{16,100}$/.test(String(record.key || '')) || !record.payload || typeof record.payload !== 'object') {
    return null;
  }
  return record;
}
async function __manualEmailRememberedPayload(intent) {
  const { signature, storageKey } = await __manualEmailIntentLocation(intent);
  return __manualEmailStoredRecord(signature, storageKey)?.payload || null;
}
async function __manualEmailAttempt(intent, confirmedPayload) {
  const { signature, storageKey, intentKey } = await __manualEmailIntentLocation(intent);
  let record = __manualEmailStoredRecord(signature, storageKey);
  if (!record) {
    const nonce = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID().replace(/-/g, '')
      : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    record = {
      key: 'manual_email_' + nonce,
      payload: JSON.parse(JSON.stringify(confirmedPayload)),
    };
  }
  __manualEmailClientKeys.set(signature, record);
  try { globalThis.sessionStorage?.setItem(storageKey, JSON.stringify(record)); } catch (_) {}
  return { signature, storageKey, intentKey, key: record.key, payload: record.payload };
}
function __finishManualEmailAttempt(attempt) {
  if (!attempt) return;
  if (__manualEmailClientKeys.get(attempt.signature)?.key === attempt.key) {
    __manualEmailClientKeys.delete(attempt.signature);
  }
  try {
    const stored = JSON.parse(globalThis.sessionStorage?.getItem(attempt.storageKey) || 'null');
    if (stored?.key === attempt.key) {
      globalThis.sessionStorage.removeItem(attempt.storageKey);
    }
  } catch (_) {}
}
async function runCompletionPacket(contact) {
  if (__packetBusy) { window.showToast?.('Completion packet already in progress.'); return; }
  __packetBusy = true;
  try {
    let packet = null;
    const { data: existing } = await CRM.__db.from('completion_packets')
      .select('id,token,status,permit_required,jurisdiction_name,inspection_passed_at,issued_at')
      .eq('contact_id', contact.id).eq('status', 'issued')
      .order('issued_at', { ascending: false }).limit(1);
    if (existing && existing[0]) packet = existing[0];

    if (!packet) {
      const ok = await window.confirmAction?.({
        title: `Issue completion certificate for ${(contact.name || '').trim() || 'this contact'}?`,
        body: "This freezes today's facts (name, address, install date, permit record) into a permanent certificate. Corrections later mean void and reissue, never edits.",
        confirmLabel: 'Issue certificate',
      });
      if (!ok) return;
      let { data, error } = await CRM.__invokeFn('completion-packet', {
        body: { action: 'issue', contact_id: contact.id },
      });
      if (error) {
        let body = null;
        try { body = await error.context?.json?.(); } catch (_) {}
        if (body?.error === 'no_inspection_pass') {
          const attest = await window.confirmAction?.({
            title: 'No inspection PASS on file',
            body: 'The county inspection is not in the permit record yet. Attest that it passed? This writes a permanent record in your name. Only confirm if the inspection really passed.',
            confirmLabel: 'Attest and issue',
          });
          if (!attest) return;
          const retry = await CRM.__invokeFn('completion-packet', {
            body: { action: 'issue', contact_id: contact.id, attest_inspection_pass: true },
          });
          data = retry.data; error = retry.error;
          if (error) {
            let b2 = null;
            try { b2 = await error.context?.json?.(); } catch (_) {}
            window.showToast?.('Issue failed: ' + (b2?.detail || b2?.error || error.message), { kind: 'error' });
            return;
          }
        } else {
          window.showToast?.('Issue failed: ' + (body?.detail || body?.error || error.message), { kind: 'error' });
          return;
        }
      }
      packet = data?.packet;
      if (!packet) { window.showToast?.('Issue failed: no packet returned', { kind: 'error' }); return; }
      window.showToast?.('Certificate issued');
    }

    await sendCompletionEmail(contact, packet);
  } finally { __packetBusy = false; }
}

async function sendCompletionEmail(contact, packet) {
  if (!contact.email) { window.showToast?.('No email address on file for this contact.', { kind: 'error' }); return; }
  const certUrl = 'https://qa.backuppowerpro.com/certificate.html?token=' + packet.token;
  const guideUrl = 'https://qa.backuppowerpro.com/owner-guide.html?token=' + packet.token;
  const passDate = packet.inspection_passed_at ? formatDate(packet.inspection_passed_at, { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  // permit_line mirrors certificate.html's honest branching: the inspection
  // sentence only when a permit was required, the no-permit line otherwise.
  const permitLine = packet.permit_required === false
    ? 'No county permit was required for your installation. Your certificate below is the permanent record.'
    : 'The county inspection is done' + (packet.jurisdiction_name ? ': ' + packet.jurisdiction_name + ' signed off' : '') + (passDate ? ' on ' + passDate : '') + '. Your certificate below is the permanent record.';
  const firstName = (contact.name || '').trim().split(/\s+/)[0] || 'there';
  const subject = "You're all set, backup power confirmed";
  const variables = {
    first_name: firstName,
    certificate_url: certUrl,
    owner_guide_url: guideUrl,
    permit_line: permitLine,
  };
  const currentPayload = { template: 'completion', contact_id: contact.id, subject, variables, trigger_source: 'crm_v3_finance_action' };
  const emailIntent = __manualEmailIntentIdentity({ ...currentPayload, to_email: contact.email });
  const sendPayload = await __manualEmailRememberedPayload(emailIntent) || currentPayload;

  // #202 preview: dry-run render first so Key reviews the exact email body.
  let emailPreviewUrl = null;
  let dryRunWarning = null;
  try {
    const { data: dry } = await CRM.__invokeFn('send-email', {
      body: { ...sendPayload, dry_run: true },
    });
    if (dry?.html) emailPreviewUrl = URL.createObjectURL(new Blob([dry.html], { type: 'text/html' }));
    if (dry?.would_block) {
      dryRunWarning = dry.sample_hit
        ? `This email still contains sample data ("${dry.sample_hit}") and would be REFUSED on send.`
        : `This email has unresolved placeholders (${(dry.unresolved_placeholders || []).slice(0, 3).join(', ')}) and would be REFUSED on send.`;
    }
  } catch (_) { /* preview is an enhancement, never blocks the flow */ }

  const pvLabel = { fontSize: 11, fontWeight: 700, color: MUTED, minWidth: 54, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 };
  const pvVal = { fontSize: 13, color: NAVY, wordBreak: 'break-word' };
  const ok = await window.confirmAction?.({
    title: `Send completion packet to ${firstName}?`,
    body: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.45 }}>Review before it sends. This goes out by email via Resend.</div>
        {dryRunWarning && <div style={{ background: '#FDEEEE', border: '1px solid #F2C4C1', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#8A241D', lineHeight: 1.4 }}>{dryRunWarning}</div>}
        <div style={{ background: '#F8F8F6', border: '1px solid #EBEBEA', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', gap: 8 }}><span style={pvLabel}>To</span><span style={{ ...pvVal, fontWeight: 600 }}>{contact.email}</span></div>
          <div style={{ display: 'flex', gap: 8 }}><span style={pvLabel}>Subject</span><span style={pvVal}>{sendPayload.subject}</span></div>
        </div>
        {emailPreviewUrl && <a href={emailPreviewUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 700, color: '#1e40af', textDecoration: 'none' }}>Preview the exact email body ›</a>}
        <a href={certUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 700, color: '#1e40af', textDecoration: 'none' }}>Preview the certificate this email links to ›</a>
      </div>
    ),
    confirmLabel: 'Send email',
  });
  if (!ok) return;

  const dispatchAttempt = await __manualEmailAttempt(emailIntent, sendPayload);
  const { data, error } = await CRM.__invokeFn('send-email', {
    body: { ...dispatchAttempt.payload, idempotency_key: dispatchAttempt.key, manual_intent_key: dispatchAttempt.intentKey },
  });
  if (error) {
    let detail = error.message || 'unknown';
    try {
      const body = await error.context?.json?.();
      if (body?.error) detail = body.error + (body.need ? ` (needs: ${(body.need || []).join(', ')})` : '');
    } catch (_) {}
    window.showToast?.(`Email failed: ${detail}`, { kind: 'error' });
    return;
  }
  if (data?.ok === false) {
    if (data.retry_same_intent !== true) __finishManualEmailAttempt(dispatchAttempt);
    window.showToast?.(`Email failed: ${data.error || 'send_failed'}`, { kind: 'error' });
    return;
  }
  if (data?.skipped) {
    __finishManualEmailAttempt(dispatchAttempt);
    const skipMsg = {
      dnc: 'Not sent, this contact is marked do not contact.',
      no_email_on_file: 'Not sent, no email address on file for this contact.',
      marketing_opt_out: 'Not sent, this contact opted out of marketing emails.',
    }[data.skipped] || `Not sent: ${data.skipped}`;
    window.showToast?.(skipMsg, { kind: 'error' });
    return;
  }
  if (data?.ok !== true || typeof data?.sent !== 'string' || !data.sent.trim()) {
    window.showToast?.('Email status is unclear. Retry the same send or reconcile it before creating another.', { kind: 'error' });
    return;
  }
  __finishManualEmailAttempt(dispatchAttempt);
  window.showToast?.(`Completion packet sent to ${contact.email}`);
  window.dispatchEvent(new CustomEvent('crm-email-logged', { detail: { contact_id: contact.id } }));
}

function AdvanceJobCard({ contact, data, bumpData, onOpenTab }) {
  const [busy, setBusy] = React.useState(false);
  const C = window.CRM || {};
  const next = (typeof C.advanceJobNext === 'function') ? C.advanceJobNext(contact, data || {}) : null;
  if (!next || next.state === 'front_half') return null;

  const run = async (fn, okMsg) => {
    if (busy || typeof fn !== 'function') return;
    setBusy(true);
    try {
      const r = await fn();
      if (r && r.error) window.showToast?.("Couldn't save: " + r.error);
      // A helper may hand back an undo fn (verify_permit does); surface it
      // on the toast so the heavy write gets the same 5s forgiveness as
      // delete/cancel elsewhere in the CRM.
      else if (r && typeof r.undo === 'function') window.showToast?.(okMsg || 'Job advanced', { undo: async () => { await r.undo(); bumpData?.(); }, duration: 5000 });
      else window.showToast?.(okMsg || 'Job advanced');
      bumpData?.();
    } catch (e) { window.showToast?.("Couldn't save: " + (e && e.message || e)); }
    finally { setBusy(false); }
  };

  const STEP_LABEL = { permit_submitted:'Permit', permit_approved:'Approved', permit_verified:'Verified', install_scheduled:'Scheduled', installed:'Installed', paid:'Paid' };
  const done = (next.doneSteps || []).map(s => STEP_LABEL[s.step]).filter(Boolean);
  // Durable inverse for verify_permit (adversarial review 2026-07-02): the 5s
  // undo toast was the only un-verify path. Surface a quiet, always-available
  // "Undo verify" line whenever the permit is verified and the job is not yet
  // installed, so a mistaken verify is never invisible/permanent. Reuses run().
  const verifiedStep = (next.doneSteps || []).find(s => s.step === 'permit_verified');
  const showUnverify = !!verifiedStep && next.state !== 'complete' && !(next.doneSteps || []).some(s => s.step === 'installed');

  // One primary action per state. run = inline write (verified helper);
  // route = one tap to the surface that needs more input (date / payment method).
  const ACTIONS = {
    submit_permit:    { kind:'run',   label:'Submit permit',        okMsg:'Permit submitted', go:() => C.advanceJobSubmitPermit(contact, next.permit) },
    mark_approved:    { kind:'run',   label:'Mark permit approved', okMsg:'Permit approved', go:() => C.advanceJobMarkApproved(contact, next.permit) },
    // Mirror handleStageAction's permit_approved path: jump to the calendar
    // tab AND dispatch crm-open-add-event so AddEventInline auto-expands with
    // this contact already known (no hunting for "+ Add event", no re-pick).
    // The 300ms delay lets the calendar tab mount its listener first.
    schedule_install: { kind:'route', label:'Schedule install', go:() => {
      // Handshake: AddEventInline checks window.__pendingAddEvent on mount,
      // so a slow mount can never miss the timed dispatch below. The AI-
      // suggested date (build #2 slice B) rides along and pre-fills the
      // form; Key still confirms with the client, nothing auto-books.
      window.__pendingAddEvent = contact.id;
      window.__pendingAddEventDate = next.suggestedDate || null;
      if (onOpenTab) onOpenTab('calendar');
      setTimeout(() => window.dispatchEvent(new CustomEvent('crm-open-add-event', { detail: { contactId: contact.id, date: next.suggestedDate || null } })), 300);
    } },
    // Readiness gates (Operating Model 2026 build #2): verify sits between
    // permit-approved and schedule; parts route to the spec card below.
    verify_permit:    { kind:'run',   label:'Mark permit verified', okMsg:'Permit verified', go:() => C.advanceJobVerifyPermit(contact) },
    order_parts:      { kind:'route', label:'Open parts list', go:() => {
      const el = document.getElementById('materials-anchor');
      if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
      else window.showToast?.('Parts list is on this page under Install spec');
    } },
    parts_in_transit: { kind:'none' },
    mark_installed:   { kind:'run',   label:'Mark installed',       okMsg:'Marked installed', go:() => C.advanceJobMarkInstalled(contact, next.installEvent) },
    record_payment:   { kind:'route', label:'Record payment',       go:() => onOpenTab && onOpenTab('finance') },
    install_upcoming: { kind:'none' },
    // Permit kicked back by the county. Informational only , no button here:
    // the Permits card below owns the "Resolve blocker" control, so the card
    // states the problem (+ the blocker reason via sublabel) without a
    // redundant/misleading action.
    permit_blocked:   { kind:'none' },
    complete:         { kind:'none' },
  };
  const act = ACTIONS[next.state] || { kind:'none' };

  // Gold discipline (Key 2026-07-09, iOS Phase 1 restyle): exactly ONE
  // gold money-colored primary per screen. On the contact-detail body,
  // the OWED card + record_payment are the money actions; every other
  // primary in AdvanceJobCard (submit permit, mark installed, verify,
  // schedule install, etc.) is a commit, not a money move, and gets a
  // lower-weight navy pill. Never two bold golds in view.
  const isMoneyPrimary = next.state === 'record_payment';
  const primaryBtn = {
    width:'100%', minHeight:44, borderRadius:100, border:'none', cursor:'pointer',
    background: isMoneyPrimary ? '#ffba00' : NAVY,
    color: isMoneyPrimary ? NAVY : '#ffffff',
    fontFamily:'inherit', fontSize:15, fontWeight:700,
    display:'flex', alignItems:'center', justifyContent:'center', gap:8,
    opacity: busy ? 0.6 : 1,
  };
  const ghostBtn = {
    width:'100%', minHeight:44, marginTop:8, borderRadius:10, cursor:'pointer',
    background:'white', color:NAVY, border:'1px solid rgba(27,43,75,0.15)',
    fontFamily:'inherit', fontSize:13, fontWeight:600,
  };

  // "Send review request": a manual tap that sends the same Google-review SMS
  // the nightly bot sends AND stamps the suppression marker, so the bot will
  // skip this customer (no double-text). Shows once the job is installed and
  // hides the moment they have been asked (by Key here OR the bot).
  const askedReview = (contact.notes || '').includes('__review_asked:');
  const isInstalled = (next.doneSteps || []).some(s => s.step === 'installed');
  const canAskReview = isInstalled && !askedReview && !contact.do_not_contact && !!contact.phone;
  const reviewBtn = canAskReview ? (
    <button style={ghostBtn} disabled={busy}
      onClick={() => run(() => C.advanceJobSendReview(contact), 'Review request sent')}>
      {busy ? 'Sending...' : 'Send review request'}
    </button>
  ) : null;

  // Completion packet (certificate + owner's guide): shows once installed,
  // stays available after (a second tap reuses the issued certificate and
  // offers a resend, never mints a duplicate). Email refusals (DNC, no email
  // on file) surface honestly from send-email's own gates.
  const packetBtn = isInstalled ? (
    <button style={ghostBtn} disabled={busy} onClick={() => runCompletionPacket(contact)}>
      Completion packet
    </button>
  ) : null;

  return (
    <CardShell eyebrow="Next step">
      {done.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
          {done.map((d, i) => (
            <span key={i} style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:600, color:'#16a34a', background:'#f0fdf4', border:'1px solid #bbf7d0', padding:'3px 8px', borderRadius:999 }}>
              <span aria-hidden="true">✓</span>{d}
            </span>
          ))}
        </div>
      )}

      {next.state === 'complete' ? (
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ width:32, height:32, borderRadius:'50%', background:'#16a34a', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }} aria-hidden="true">✓</span>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:NAVY }}>Job complete</div>
            <div style={{ fontSize:12.5, color:'#6b7280' }}>Installed and paid</div>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize:16, fontWeight:700, color:NAVY, letterSpacing:'-0.01em' }}>{next.label}</div>
          {next.sublabel && <div style={{ fontSize:12.5, color:'#6b7280', marginTop:3, marginBottom:12 }}>{next.sublabel}</div>}
          {!next.sublabel && <div style={{ height:12 }} />}
          {(act.kind === 'run') && (
            <button style={primaryBtn} disabled={busy} onClick={() => run(act.go, act.okMsg)}>
              {busy ? 'Saving...' : act.label}
            </button>
          )}
          {(act.kind === 'route') && (
            <button style={primaryBtn} onClick={act.go}>{act.label}<span aria-hidden="true">→</span></button>
          )}
          {next.state === 'install_upcoming' && (
            <button style={ghostBtn} disabled={busy} onClick={() => run(() => C.advanceJobMarkInstalled(contact, next.installEvent), 'Marked installed')}>
              {busy ? 'Saving...' : 'Mark installed early'}
            </button>
          )}
        </div>
      )}
      {showUnverify && (
        <div style={{ marginTop:10, fontSize:11.5, color:'#9aa3b2', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
          <span>Permit verified{verifiedStep.at ? ' ' + formatDate(verifiedStep.at, { month:'short', day:'numeric' }) : ''}.</span>
          <button
            onClick={() => run(() => C.advanceJobUnverifyPermit(contact), 'Verification undone')}
            disabled={busy}
            style={{ background:'none', border:'none', padding:0, color:'#6b7280', font:'inherit', fontSize:11.5, textDecoration:'underline', cursor:'pointer' }}>
            Undo
          </button>
        </div>
      )}
      {reviewBtn}
      {packetBtn}
    </CardShell>
  );
}

function PermitsCard({ permits, contact, bumpData }) {
  const fmtDay = iso => iso ? formatDate(iso, { month:'short', day:'numeric' }) : null;

  const addPermit = async () => {
    if (!contact) return;
    const j = contact.jurisdiction
      ? BPP_JURISDICTIONS.find(n => n.toLowerCase().includes(contact.jurisdiction.toLowerCase())) || BPP_JURISDICTIONS[0]
      : BPP_JURISDICTIONS[0];
    if (!CRM.__db) {
      window.showToast?.('Supabase not loaded, permit not saved');
      return;
    }
    // Resolve jurisdiction_id from the name so the FK is valid. If the
    // lookup fails we proceed with a null FK rather than blocking - the
    // jurisdiction_name still drives the UI.
    let jurisdictionId = null;
    try {
      const { data: jdata } = await CRM.__db.from('permit_jurisdictions')
        .select('id').eq('name', j).limit(1);
      if (jdata?.[0]?.id) jurisdictionId = jdata[0].id;
    } catch (_) {}
    const { data, error } = await CRM.__db.from('permits').insert({
      contact_id: contact.id,
      jurisdiction_id: jurisdictionId,
      jurisdiction_name: j,
      status: 'not_started',
      permit_number: 'PENDING',
      cost_cents: 0,
    }).select().single();
    if (error) {
      window.showToast?.('Permit save failed: ' + error.message);
      return;
    }
    // Optimistically push the mapped row into local state. Realtime
    // will reconcile from the channel a moment later.
    CRM.permits.push({
      id: data.id,
      contact_id: data.contact_id,
      jurisdiction_id: data.jurisdiction_id || null,
      jurisdiction: data.jurisdiction_name || j,
      jurisdiction_name: data.jurisdiction_name || j,
      permit_number: data.permit_number || 'PENDING',
      status: data.status || 'not_started',
      submitted_at: data.submitted_at || null,
      approved_at: data.approved_at || null,
      cost_cents: data.cost_cents || 0,
      blocker_note: data.blocker_note || null,
    });
    bumpData?.();
    // Advance the contact stage from "Booked" → "Permit submit" since
    // starting a permit IS that transition.
    if (contact.stage === 'booked' && CRM.STAGE_STR_TO_NUM?.permit_submit != null) {
      const previous = contact.stage;
      contact.stage = 'permit_submit';
      bumpData?.();
      try {
        const { error: stageErr } = await CRM.__db.from('contacts')
          .update({ stage: CRM.STAGE_STR_TO_NUM.permit_submit })
          .eq('id', contact.id);
        if (stageErr) {
          contact.stage = previous;
          bumpData?.();
          window.showToast?.(`Permit added, stage save failed: ${stageErr.message}`);
          return;
        }
        CRM.recordStageTransition?.(contact.id, CRM.STAGE_STR_TO_NUM?.[previous] ?? null, CRM.STAGE_STR_TO_NUM.permit_submit);
      } catch (e) {
        contact.stage = previous;
        bumpData?.();
      }
    }
    window.showToast?.('Permit started');
  };

  return (
    <CardShell eyebrow="Permits">
      {/* Contact-scoped portal (Key 2026-06-26): the global picker stays in the
          header; this pins the contact's own jurisdiction's portal + saved login
          right here, and opening it logs the recency signal. */}
      {(() => {
        const CJP = window.ContactJurisdictionPortal;
        const cj = (permits.find(p => p && p.jurisdiction)?.jurisdiction) || contact?.jurisdiction || null;
        return (cj && CJP) ? React.createElement(CJP, { contactId: contact?.id, jurisdictionName: cj }) : null;
      })()}
      {permits.length === 0 ? (
        <div>
          {/* Empty state. The "not started" at-a-glance signal lives on the
              contact's LIST row (crm-left amber NO PERMIT badge); repeating it
              here above "No permit yet / Start permit" was redundant, so the
              detail card shows just the one clear next action. */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
            <span style={{ color:'#999', fontSize:13 }}>No permit yet</span>
            <GoldPillButton onClick={addPermit}>Start permit</GoldPillButton>
          </div>
        </div>
      ) : (
        permits.map((p, i) => {
          const timeline = p.approved_at
            ? `Submitted ${fmtDay(p.submitted_at)} → Approved ${fmtDay(p.approved_at)}`
            : (p.submitted_at ? `Submitted ${fmtDay(p.submitted_at)}` : null);
          return (
            <div key={p.id} style={{ paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0, borderTop: i ? '1px solid rgba(11,31,59,0.06)' : 'none' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <JurisdictionEditor permit={p} contact={contact} bumpData={bumpData} />
                <PermitStatusPill status={p.status} />
                <span style={{ fontFamily:'DM Mono, monospace', fontSize:13, color:NAVY, marginLeft:'auto', flexShrink:0 }}>{p.cost_cents > 0 ? formatMoneyCents(p.cost_cents) : '-'}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                <span style={{ fontFamily:'DM Mono, monospace', fontSize:12, color:'#666' }}>{p.permit_number}</span>
                {timeline && <span style={{ fontSize:12, color:'#666' }}>· {timeline}</span>}
                <PermitAgeChip permit={p} />
              </div>
              <PermitStepper status={p.status} />
              <PermitStatusActions permit={p} contact={contact} bumpData={bumpData} />
            </div>
          );
        })
      )}
      {permits.length > 0 && (
        <button onClick={addPermit} style={{
          marginTop:12, width:'100%', minHeight:44, borderRadius:6,
          background:'white', border:'1px dashed rgba(27,43,75,0.25)',
          color:NAVY, fontSize:13, fontWeight:500, fontFamily:'inherit', cursor:'pointer',
        }}>+ Add permit</button>
      )}
      {/* Mailing slip generator - 2026-05-26 ported from v2. Auto-fills
          contact name + address into the #10 window envelope insert and
          triggers a print dialog so Key can Save as PDF. Renders once
          there's a permit (we only mail when a permit is in play). */}
      {permits.length > 0 && (
        <button onClick={() => generateMailingInsertPDF(contact)} disabled={!contact?.address} title={contact?.address ? 'Open mailing slip + print dialog' : 'Add an address first'} style={{
          marginTop:8, width:'100%', height:44, borderRadius:6,
          background: contact?.address ? NAVY : '#E5E5E5',
          color: contact?.address ? GOLD : '#999',
          border:'none', fontSize:13, fontWeight:700, fontFamily:'inherit',
          cursor: contact?.address ? 'pointer' : 'not-allowed',
          display:'flex', alignItems:'center', justifyContent:'center', gap:6,
        }}>
          <span style={{ fontSize:14 }}>✉</span>
          <span>Generate mailing slip (PDF)</span>
        </button>
      )}
    </CardShell>
  );
}

// Renamed inline alias to avoid colliding with old PermitPill (still used elsewhere if any)
const PermitStatusPill = PermitPill;

// Permit aging chip - typical SC city turnaround is ~14 days. Gold once
// past 7d submitted, red once past the 14d SLA. Hidden if approved or
// not yet submitted.
function PermitAgeChip({ permit }) {
  if (!permit?.submitted_at || permit.status === 'approved') return null;
  const days = Math.floor((Date.now() - new Date(permit.submitted_at).getTime()) / 86400000);
  const SLA = 14;
  const overdue = days > SLA;
  const aging = days >= 7;
  const bg = overdue ? '#FEE2E2' : aging ? '#FEF3C7' : '#F0F4FF';
  const color = overdue ? '#991B1B' : aging ? '#92400E' : '#1E40AF';
  const label = overdue ? `Day ${days} · over SLA` : `Day ${days} of ${SLA}`;
  return (
    <span title={overdue ? 'Past typical SLA, call the city.' : 'Day-count since submission.'} style={{
      fontSize:12, fontWeight:700, color, background:bg,
      padding:'2px 7px', borderRadius:20, fontFamily:'DM Mono, monospace',
    }}>{label}</span>
  );
}

// ── Install Spec Card ─────────────────────────────────────────────
const MAT_STATUS = {
  not_ordered: { icon: '○', color: '#999',    label: 'Not ordered' },
  ordered:     { icon: '◐', color: '#f59e0b', label: 'Ordered' },
  received:    { icon: '●', color: '#2563eb', label: 'Received' },
  installed:   { icon: '✓', color: '#16a34a', label: 'Installed' },
};
const MAT_NEXT = {
  not_ordered: { next:'ordered',   label:'Mark ordered',   gold:true,  stamp:'ordered_at' },
  ordered:     { next:'received',  label:'Mark received',  gold:false, stamp:'received_at' },
  received:    { next:'installed', label:'Mark installed', gold:false, stamp:'installed_at' },
  installed:   null,
};
const MAT_KIND_LABEL = k => k.charAt(0).toUpperCase() + k.slice(1);

function MaterialRow({ mat, contact, bumpData, isPlaceholder }) {
  const st = MAT_STATUS[mat.status] || MAT_STATUS.not_ordered;
  const next = MAT_NEXT[mat.status];
  const fmtMmDd = iso => iso ? formatDate(iso, { month:'short', day:'numeric' }) : '';
  const statusText =
    mat.status === 'ordered'   ? `Ordered ${fmtMmDd(mat.ordered_at)}` :
    mat.status === 'received'  ? `Received ${fmtMmDd(mat.received_at)}` :
    mat.status === 'installed' ? 'Installed' :
    'Not ordered';

  const advance = async () => {
    if (!next) return;
    if (!CRM.__db) {
      window.showToast?.('Supabase not loaded');
      return;
    }
    // Fresh LOCAL date computed at write time; the module-level TODAY is
    // computed once at page load and goes stale if the tab stays open past
    // midnight, stamping yesterday's date on the row.
    const _d = new Date();
    const stampDate = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
    if (isPlaceholder) {
      // First advance on a permanent row (inlet/interlock/cord) → INSERT.
      const stamps = {
        ordered_at: next.stamp === 'ordered_at' ? stampDate : null,
        received_at: next.stamp === 'received_at' ? stampDate : null,
        installed_at: next.stamp === 'installed_at' ? stampDate : null,
      };
      const { data, error } = await CRM.__db.from('materials').insert({
        contact_id: contact.id,
        kind: mat.kind,
        status: next.next,
        ...stamps,
      }).select().single();
      if (error) {
        window.showToast?.(`${MAT_KIND_LABEL(mat.kind)} save failed: ${error.message}`);
        return;
      }
      CRM.materials.push({
        id: data.id,
        contact_id: data.contact_id,
        kind: data.kind,
        status: data.status,
        ordered_at: data.ordered_at,
        received_at: data.received_at,
        installed_at: data.installed_at,
        created_at: data.created_at,   // newest-per-kind selection in advanceJobNext sorts on this
      });
      bumpData?.();
      window.showToast?.(`${MAT_KIND_LABEL(mat.kind)}: ${next.label.toLowerCase()}`);
      return;
    }
    // UPDATE path for an existing row. Optimistic + revert on error.
    const prev = { status: mat.status, [next.stamp]: mat[next.stamp] };
    mat.status = next.next;
    mat[next.stamp] = stampDate;
    bumpData?.();
    const { error } = await CRM.__db.from('materials')
      .update({ status: next.next, [next.stamp]: stampDate })
      .eq('id', mat.id);
    if (error) {
      mat.status = prev.status;
      mat[next.stamp] = prev[next.stamp];
      bumpData?.();
      window.showToast?.(`${MAT_KIND_LABEL(mat.kind)} save failed: ${error.message}`);
      return;
    }
    window.showToast?.(`${MAT_KIND_LABEL(mat.kind)}: ${next.label.toLowerCase()}`);
  };

  // Reset back to "Not ordered" - the only escape hatch from an
  // accidental "Mark installed". Wipes the date stamps.
  const reset = async () => {
    if (isPlaceholder) return;
    if (!CRM.__db) return;
    const prev = {
      status: mat.status,
      ordered_at: mat.ordered_at,
      received_at: mat.received_at,
      installed_at: mat.installed_at,
    };
    mat.status = 'not_ordered';
    mat.ordered_at = null;
    mat.received_at = null;
    mat.installed_at = null;
    bumpData?.();
    const { error } = await CRM.__db.from('materials')
      .update({ status: 'not_ordered', ordered_at: null, received_at: null, installed_at: null })
      .eq('id', mat.id);
    if (error) {
      Object.assign(mat, prev);
      bumpData?.();
      window.showToast?.(`Reset failed: ${error.message}`);
      return;
    }
    window.showToast?.(`${MAT_KIND_LABEL(mat.kind)}: reset`);
  };

  // Delete an ad-hoc extra (not the 3 permanent kinds: inlet,
  // interlock, cord - those always render as part of the install).
  const PERMANENT = new Set(['inlet','interlock','cord']);
  const canDelete = !isPlaceholder && !PERMANENT.has(mat.kind);
  const remove = async () => {
    if (!canDelete) return;
    if (!CRM.__db) return;
    // Snapshot before delete so undo can re-insert
    const snap = { ...mat };
    const i = (CRM.materials || []).findIndex(m => m.id === mat.id);
    if (i >= 0) CRM.materials.splice(i, 1);
    bumpData?.();
    const { error } = await CRM.__db.from('materials').delete().eq('id', mat.id);
    if (error) {
      // Re-insert into local array on persist failure
      if (i >= 0) CRM.materials.splice(i, 0, snap);
      bumpData?.();
      window.showToast?.(`Remove failed: ${error.message}`);
      return;
    }
    window.showToast?.(`${MAT_KIND_LABEL(mat.kind)} removed`, {
      undo: async () => {
        const { id, created_at, updated_at, ...rest } = snap;
        const { data, error: e2 } = await CRM.__db.from('materials').insert(rest).select().single();
        if (e2) {
          window.showToast?.(`Undo failed: ${e2.message}`);
          return;
        }
        CRM.materials.push({
          id: data.id,
          contact_id: data.contact_id,
          kind: data.kind,
          status: data.status,
          ordered_at: data.ordered_at,
          received_at: data.received_at,
          installed_at: data.installed_at,
          created_at: data.created_at,   // keep newest-per-kind ordering correct after undo
        });
        bumpData?.();
      },
      duration: 5000,
    });
  };

  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0' }}>
      <span style={{ width:16, fontSize:14, color:st.color, flexShrink:0, textAlign:'center', lineHeight:1, fontWeight:700 }}>{st.icon}</span>
      <span style={{ flex:1, fontSize:14, color:NAVY }}>{MAT_KIND_LABEL(mat.kind)}</span>
      <span style={{ fontSize:12, color:'#666', whiteSpace:'nowrap' }}>{statusText}</span>
      {/* Status === installed → show a Reset button instead of nothing.
          Without an undo it was easy to accidentally tap "Mark installed"
          and have no way to walk it back. */}
      {!next && mat.status === 'installed' && !isPlaceholder && (
        <button onClick={reset} aria-label="Reset to not ordered" title="Reset" style={{
          height:44, padding:'0 12px', borderRadius:8,
          background:'transparent', color:'#666',
          border:'1px solid rgba(27,43,75,0.15)',
          fontSize:12, fontWeight:600, fontFamily:'inherit',
          cursor:'pointer', whiteSpace:'nowrap', flexShrink:0,
        }}>Reset</button>
      )}
      {next && (
        <button onClick={advance} style={{
          height:44, padding:'0 12px', borderRadius:8,
          // Gold-density pass (contact-page v2): the material's next-step action
          // (was gold) is now navy-OUTLINE , the ONE gold on a screen is the DO NEXT
          // job primary, not a per-material tracking button. The two-tier hierarchy
          // survives: the next action gets a navy border, later ones a light border.
          background: '#fff',
          color: NAVY,
          border: next.gold ? '1px solid #1B2B4B' : '1px solid rgba(27,43,75,0.15)',
          fontSize:12, fontWeight:600, fontFamily:'inherit',
          cursor:'pointer', whiteSpace:'nowrap', flexShrink:0,
        }}>{next.label}</button>
      )}
      {/* Delete affordance - only on extras (Surge, Whip, Breaker,
          Other), never on the 3 permanent rows. Small × so it doesn't
          compete with the primary action. */}
      {canDelete && (
        <button onClick={remove} aria-label={`Remove ${MAT_KIND_LABEL(mat.kind)}`} title="Remove" style={{
          width:44, height:44, borderRadius:8,
          background:'transparent', color:'#991B1B',
          border:'none',
          fontSize:14, fontWeight:600, fontFamily:'inherit',
          cursor:'pointer', flexShrink:0,
        }}>✕</button>
      )}
    </div>
  );
}

function InstallSpecCard({ ampSpec, contact, materials = [], bumpData }) {
  const hasSpec = !!ampSpec;
  const big = hasSpec ? ampSpec : '-';
  const sub = hasSpec ? `${ampSpec.replace(/A$/,'').toLowerCase()} amp installation` : 'Awaiting signed proposal';

  // Ordering rows: inlet + interlock + cord always (placeholders if missing).
  // Cord is bundled by default - included on every install - so we
  // surface it as a permanent line alongside Inlet and Interlock.
  const inletMat = materials.find(m => m.kind === 'inlet') || { kind:'inlet', status:'not_ordered', contact_id:contact.id, _placeholder:true };
  const interlockMat = materials.find(m => m.kind === 'interlock') || { kind:'interlock', status:'not_ordered', contact_id:contact.id, _placeholder:true };
  const cordMat = materials.find(m => m.kind === 'cord') || { kind:'cord', status:'not_ordered', contact_id:contact.id, _placeholder:true };
  const extras = materials.filter(m => !['inlet','interlock','cord'].includes(m.kind));
  const rows = [inletMat, interlockMat, cordMat, ...extras];

  const [showAddPicker, setShowAddPicker] = React.useState(false);
  const EXTRA_KINDS = ['breaker','whip','surge','other'];

  const addExtra = async (kind) => {
    setShowAddPicker(false);
    if (!CRM.__db) {
      window.showToast?.('Supabase not loaded');
      return;
    }
    const { data, error } = await CRM.__db.from('materials').insert({
      contact_id: contact.id,
      kind,
      status: 'not_ordered',
    }).select().single();
    if (error) {
      window.showToast?.(`Add ${MAT_KIND_LABEL(kind)} failed: ${error.message}`);
      return;
    }
    CRM.materials.push({
      id: data.id,
      contact_id: data.contact_id,
      kind: data.kind,
      status: data.status,
      ordered_at: data.ordered_at,
      received_at: data.received_at,
      installed_at: data.installed_at,
      created_at: data.created_at,   // newest-per-kind selection in advanceJobNext sorts on this
    });
    bumpData?.();
    window.showToast?.(`${MAT_KIND_LABEL(kind)} added`);
  };

  // Tighter header: amp value + subtitle inline on one row, with the
  // ORDERING section's count chip on the right (e.g. "2/3 ordered"). Saves
  // ~40px of vertical space and uses the wide-column whitespace meaningfully.
  const orderedCount = rows.filter(m => m.status === 'ordered' || m.status === 'received' || m.status === 'installed').length;
  const totalCount = rows.length;

  return (
    <div style={{ background:'white', marginTop:12, padding:'12px 14px', border:0, borderRadius:16, boxShadow:'inset 0 0 0 1px rgba(27,43,75,0.085)' }}>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:10, minWidth:0 }}>
          <span style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.06em' }}>Install spec</span>
          <span style={{ fontFamily:'JetBrains Mono, DM Mono, monospace', fontSize:20, fontWeight:700, color:NAVY, lineHeight:1 }}>{big}</span>
          <span style={{ fontSize:13, color:'#666' }}>{sub}</span>
        </div>
        {/* Only show the count chip once ordering has actually started.
            Showing "0/2 ordered" before any work began reads as a debt. */}
        {hasSpec && totalCount > 0 && orderedCount > 0 && (
          <span style={{ fontSize:12, fontWeight:600, color: orderedCount === totalCount ? '#16a34a' : '#999' }}>
            {orderedCount}/{totalCount} ordered
          </span>
        )}
      </div>

      <div>
        {rows.map((m, i) => (
          <MaterialRow key={m.id || ('ph-'+m.kind)} mat={m} contact={contact} bumpData={bumpData} isPlaceholder={!!m._placeholder} />
        ))}
      </div>

      {showAddPicker ? (
        <div style={{ marginTop:8, display:'flex', gap:6, flexWrap:'wrap' }}>
          {EXTRA_KINDS.map(k => (
            <button key={k} onClick={()=>addExtra(k)} style={{
              height:28, padding:'0 10px', borderRadius:6,
              background:'white', border:'1px solid rgba(27,43,75,0.15)',
              color:NAVY, fontSize:12, fontWeight:600, fontFamily:'inherit', cursor:'pointer', minHeight:44,
            }}>{MAT_KIND_LABEL(k)}</button>
          ))}
          <button onClick={()=>setShowAddPicker(false)} style={{
            height:28, padding:'0 10px', borderRadius:6,
            background:'none', border:'none', color:'#999', fontSize:12, fontFamily:'inherit', cursor:'pointer', minHeight:44,
          }}>Cancel</button>
        </div>
      ) : (
        <button onClick={()=>setShowAddPicker(true)} style={{
          marginTop:8, width:'100%', height:44, borderRadius:6,
          background:'white', border:'1px dashed rgba(27,43,75,0.25)',
          color:NAVY, fontSize:13, fontWeight:500, fontFamily:'inherit', cursor:'pointer',
        }}>+ Add extra</button>
      )}
    </div>
  );
}

// ── Next Job Card (expanded) ──────────────────────────────────────
function NextJobCard({ contact, event, permit, materials = [], onOpenTab }) {
  const startMs = new Date(event.start_at).getTime();
  // Local midnight, NOT UTC midnight - `TODAY` is already a local-TZ date
  // string, so re-parsing it as UTC (the 'Z' suffix did) produces an
  // off-by-one day for early-morning and late-evening hours.
  const nowMs = new Date(TODAY + 'T00:00:00').getTime();
  const dayMs = 24*60*60*1000;
  const diffDays = Math.round((startMs - nowMs) / dayMs);
  const relText = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : diffDays > 0 ? `in ${diffDays} days` : `${-diffDays} days ago`;

  const street = (contact.address || '').split(',')[0].trim();
  const jurisdiction = contact.jurisdiction || '';

  const PERMIT_COLORS = { approved:'#16a34a', submitted:'#f59e0b', waiting:'#2563eb', blocked:'#dc2626', not_started:'#999' };

  const total = materials.length;
  const ready = materials.filter(m => m.status === 'received' || m.status === 'installed').length;
  // Always at least 2 (inlet + interlock placeholders)
  const totalForReadiness = Math.max(total, 2);
  const readinessFull = totalForReadiness > 0 && ready === totalForReadiness;

  // Trim before split-or-default so a name of "  " doesn't render
  // "Hey , here's your quote" - guards against whitespace-only DB rows.
  const firstName = ((contact.name || '').trim().split(/\s+/)[0] || 'there');

  const PinIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-7.58 8-13a8 8 0 1 0-16 0c0 5.42 8 13 8 13z"/><circle cx="12" cy="9" r="2.5"/>
    </svg>
  );
  const DocIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/>
    </svg>
  );
  const PlugIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 7V2"/><path d="M15 7V2"/><path d="M6 11V7h12v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z"/><path d="M12 15v7"/>
    </svg>
  );
  const MapIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
    </svg>
  );
  const ChatIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
  const ClockIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );

  const openMaps = () => window.open(`https://maps.apple.com/?daddr=${encodeURIComponent(contact.address)}`, '_blank', 'noopener');
  const textCustomer = () => onOpenTab?.('messages');
  // Jump to Schedule tab - the AddEventInline form there is the closest
  // we have to a reschedule UI today (until a per-event edit modal ships).
  const reschedule = () => onOpenTab?.('calendar');

  return (
    <div style={{ background:'white', marginTop:12, padding:'12px 14px', border:0, borderRadius:16, boxShadow:'inset 0 0 0 1px rgba(27,43,75,0.085)' }}>
      <div style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Next job</div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
        <div style={{ fontSize:14, fontWeight:600, color:NAVY }}>{event.title}</div>
        <StatusPill status={event.kind} />
      </div>
      <div style={{ fontSize:12, color:'#666', marginTop:2 }}>
        {formatDate(event.start_at)} · {formatTime(event.start_at)} · {relText}
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10, fontSize:13, color:NAVY, fontFamily:'inherit', fontWeight:500 }}>
        <span style={{ color:NAVY, display:'inline-flex' }}>{PinIcon}</span>
        <span>{street}{jurisdiction ? ' · ' + jurisdiction : ''}</span>
      </div>

      {permit && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6, fontSize:12, color:'#666' }}>
          <span style={{ color:PERMIT_COLORS[permit.status] || '#666', display:'inline-flex' }}>{DocIcon}</span>
          <span>Permit <span style={{ color:PERMIT_COLORS[permit.status] || '#666', fontWeight:600 }}>{capitalize(permit.status)}</span> · <span style={{ fontFamily:"'DM Mono', monospace" }}>{permit.permit_number}</span></span>
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6, fontSize:12, color:'#666' }}>
        <span style={{ color:NAVY, display:'inline-flex' }}>{PlugIcon}</span>
        <span>Parts ready {ready}/{totalForReadiness}</span>
        <span style={{ width:8, height:8, borderRadius:'50%', background: readinessFull ? '#16a34a' : '#f59e0b', display:'inline-block', marginLeft:2 }} />
      </div>

      <div style={{ display:'flex', gap:8, marginTop:12 }}>
        <button onClick={openMaps} style={{
          /* 2026-07-04 audit: was money-gold (#ffba00) for a pure navigation
             action. Gold is reserved for the one money/commit control per screen
             (same rule as AdvanceJobCard + ccNavyBtn). Filled NAVY keeps it the
             visual primary of the three without lying that it moves money. */
          flex:1, height:44, borderRadius:8,
          background:NAVY, color:'#fff', border:'none',
          fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
          display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6,
        }}>{MapIcon}<span>Get directions</span></button>
        <button onClick={textCustomer} style={{
          flex:1, height:44, borderRadius:8,
          background:'white', color:NAVY, border:'1px solid rgba(27,43,75,0.15)',
          fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
          display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6,
        }}>{ChatIcon}<span>Text {firstName}</span></button>
        <button onClick={reschedule} style={{
          flex:1, height:44, borderRadius:8,
          background:'white', color:NAVY, border:'1px solid rgba(27,43,75,0.15)',
          fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
          display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6,
        }}>{ClockIcon}<span>Open calendar</span></button>
      </div>
    </div>
  );
}


// ── Contact Calendar ──────────────────────────────────────────────
// CC = the per-contact calendar token set, taken VERBATIM from the approved
// Claude Design comp "crm-contact-calendar.html" (:root). Same family as the
// Day Board so the two calendars read as one app.
const CC_TOK = {
  navy:'#1B2B4B', ink:'#1b2233', muted:'#5b6475', faint:'#8a92a1',
  green:'#2e9e6b', blue:'#3b76d6', gray:'#b3b9c4',
  amber:'#d99413', amberTint:'#fbf2dd', amberInk:'#8a5e10',
  gold:'#ffba00', card:'#f8f8f6', page:'#f4f6f9',
  hair:'rgba(27,43,75,0.10)', hairSoft:'rgba(27,43,75,0.07)',
  shSm:'0 1px 2px rgba(27,43,75,0.05), 0 2px 6px rgba(27,43,75,0.05)',
  mono:"'JetBrains Mono','DM Mono',monospace",
};
const ccGoldBtn = (minHeight = 48, fontSize = 15) => ({
  display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8,
  width:'100%', minHeight, border:'none', borderRadius:100, background:CC_TOK.gold,
  color:CC_TOK.navy, fontWeight:700, fontSize, fontFamily:'inherit', cursor:'pointer',
  boxShadow:'0 4px 16px rgba(255,186,0,0.28)',
});
// Navy sibling of ccGoldBtn: a lower-weight primary for actions that do NOT
// commit or move money (gold stays reserved for the real commit). Used when a
// readiness gate is still open, so the nudge cannot present a gold "Schedule"
// the job is not ready for (no Norman door).
const ccNavyBtn = (minHeight = 48, fontSize = 15) => ({
  display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8,
  width:'100%', minHeight, border:'none', borderRadius:100, background:CC_TOK.navy,
  color:'#fff', fontWeight:700, fontSize, fontFamily:'inherit', cursor:'pointer',
});

// ContactCalendar, wired from the approved Claude Design comp
// "crm-contact-calendar.html" (2026-06-16), the quieter single-customer
// sibling of the Calendar Day Board: green-edge install / blue-edge
// inspection card, gold countdown chip, big mono date, a past-events
// timeline, and ONE gold primary per state (Mark done when due / Schedule
// install when nothing booked). The contact strip the comp drew at its top
// is OMITTED here, the contact panel header already shows the avatar + name
// (removing a duplicate affordance, First-Time-Right gate item 3). Every
// reschedule / mark-done / cancel / add-event handler is reused unchanged.
function ContactCalendar({ contact, events, highlightId, bumpData, onOpenTab }) {
  const sorted = [...events].sort((a,b) => (a.start_at||'').localeCompare(b.start_at||''));
  // A cancelled/completed event is never the actionable "upcoming" card.
  const isDead = e => { const s = String(e.status||'').toLowerCase(); return s === 'cancelled' || s === 'completed'; };
  // Upcoming = the soonest ACTIVE event that is future-dated, OR any active
  // install regardless of date (a past-due install is an action item, not
  // history, so it surfaces as the Mark-done card instead of hiding in the
  // timeline). Sorted ascending, so an overdue install (earlier) wins [0].
  const upcoming = sorted.filter(e => !isDead(e) && (dayKey(e.start_at) >= TODAY || e.kind === 'install'))[0];
  // Past timeline = history: anything dead, or genuinely past-dated, that is
  // not the chosen upcoming card. (A just-completed install lands here.)
  const past = sorted.filter(e => e !== upcoming && (isDead(e) || dayKey(e.start_at) < TODAY)).slice(-3).reverse();

  // 60-min default when end_at is null so the card never renders "NaN hr".
  const durMin = ev => {
    if (!ev.end_at || !ev.start_at) return 60;
    const m = Math.round((new Date(ev.end_at) - new Date(ev.start_at)) / 60000);
    return Number.isFinite(m) && m > 0 ? m : 60;
  };
  const durLabel = m => m >= 60 ? `${Math.round(m/60*10)/10}h`.replace('.0','') : `${m}m`;

  const secH = { display:'flex', alignItems:'center', gap:8, fontWeight:700, fontSize:11, letterSpacing:'0.13em', textTransform:'uppercase', color:CC_TOK.faint, margin:'0 2px 10px' };

  // Signed/booked but nothing on the calendar -> the "schedule it" nudge
  // (comp State D). Truly empty (new lead, no history) -> the calm empty
  // state (comp State C). Both lead with one gold "Schedule install".
  const stageNum = window.CRM?.STAGE_STR_TO_NUM?.[contact.stage] ?? 0;
  const bookedNum = window.CRM?.STAGE_STR_TO_NUM?.booked ?? 3;
  // The "No install scheduled yet" nudge fires ONLY for a live signed job
  // with no active install on the books. A lost job is archived (not a stage),
  // so gate on archived/DNC too, else a dead booked contact would read as an
  // active job needing scheduling. A completed install (not cancelled) counts
  // as "has an install" so a finished job never nags to schedule one.
  const hasActiveInstall = events.some(e => e.kind === 'install' && String(e.status||'').toLowerCase() !== 'cancelled');
  const showNudge = stageNum >= bookedNum && !contact.archived && !contact.do_not_contact && !hasActiveInstall;

  // Readiness gate on the nudge (adversarial review 2026-07-02, confirmed high):
  // the gold "Schedule install" fires for any booked+ job, but advanceJobNext
  // may still be waiting on Key (verify the permit / order the specialty parts).
  // A gold button that says "Schedule install" when the job is not ready to
  // schedule is a Norman door, so when a readiness gate is open we swap it for
  // a navy "Finish the last step first" that routes to the Next-step card (the
  // contact overview, where the one-tap gate action lives). The manual "Add
  // event" ghost row below stays as Key's deliberate override, so nothing is a
  // hard block. Reuses advanceJobNext with per-contact arrays like the rail.
  const C = window.CRM || {};
  const nextState = (showNudge && typeof C.advanceJobNext === 'function')
    ? (C.advanceJobNext(contact, {
        permits: (C.permits || []).filter(p => p.contact_id === contact.id),
        events: events,
        invoices: (C.invoices || []).filter(i => i.contact_id === contact.id),
      }) || {}).state
    : null;
  const READINESS_GATE = { verify_permit: 'Verify the permit', order_parts: 'Order the specialty parts', parts_in_transit: 'Parts are still on the way' };
  const gateLabel = READINESS_GATE[nextState] || null;

  // Gold primary in empty/nudge expands the existing AddEventInline form via
  // its crm-open-add-event handshake (no new add path; reuse).
  const scheduleInstall = () => {
    window.__pendingAddEvent = contact.id;
    window.dispatchEvent(new CustomEvent('crm-open-add-event', { detail:{ contactId: contact.id } }));
  };
  const goToReadiness = () => { if (onOpenTab) onOpenTab('contacts'); };

  return (
    <div style={{ flex:1, overflowY:'auto', minHeight:0, padding:'12px 16px var(--tabbar-clear, calc(env(safe-area-inset-bottom, 0px) + 92px))' }}>
      {upcoming ? (
        <>
          <div style={secH}>Upcoming</div>
          <UpcomingEventCard event={upcoming} contact={contact} durLabel={durLabel} durMin={durMin} bumpData={bumpData} />
        </>
      ) : showNudge ? (
        // Nudge: signed, no install booked (comp State D). When a readiness
        // gate is still open (verify permit / order parts / parts in transit),
        // the gold "Schedule install" would be a Norman door, so the copy names
        // the blocking step and the primary goes navy + routes to the Next-step
        // card. Manual "Add event" below stays as Key's deliberate override.
        <div style={{ position:'relative', background:'#fff', borderRadius:16, boxShadow:CC_TOK.shSm+', inset 0 0 0 1px '+CC_TOK.hairSoft, padding:'18px 18px 16px', overflow:'hidden' }}>
          <span style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:CC_TOK.amber }} />
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
            <span style={{ width:34, height:34, flex:'0 0 auto', borderRadius:'50%', background:CC_TOK.amberTint, color:CC_TOK.amberInk, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4" width="13" height="11" rx="1.8"/><path d="M2.5 7.5h13M6 1.8v3M12 1.8v3"/><path d="M9 9.5v3M7.5 11h3"/></svg>
            </span>
            <span style={{ fontWeight:700, fontSize:15.5, letterSpacing:'-0.01em', color:CC_TOK.navy }}>No install scheduled yet</span>
          </div>
          {gateLabel ? (
            <>
              <p style={{ fontSize:13.5, lineHeight:1.5, color:CC_TOK.muted, margin:'0 0 14px' }}>One step first before this goes on the calendar: <strong style={{ color:CC_TOK.navy }}>{gateLabel.toLowerCase()}</strong>.</p>
              <button onClick={goToReadiness} style={ccNavyBtn(48)}>
                Finish the last step
                <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h10M9.5 4.5L14 9l-4.5 4.5"/></svg>
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize:13.5, lineHeight:1.5, color:CC_TOK.muted, margin:'0 0 14px' }}>This job is signed. Get the install on the calendar so the crew can plan the day.</p>
              <button onClick={scheduleInstall} style={ccGoldBtn(48)}>
                <svg viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3.5v11M3.5 9h11"/></svg>
                Schedule install
              </button>
            </>
          )}
        </div>
      ) : past.length === 0 ? (
        // Calm empty state (comp State C).
        <div style={{ background:'#fff', borderRadius:16, boxShadow:CC_TOK.shSm+', inset 0 0 0 1px '+CC_TOK.hairSoft, padding:'30px 22px 24px', textAlign:'center' }}>
          <div style={{ width:56, height:56, margin:'0 auto 14px', borderRadius:16, background:CC_TOK.card, boxShadow:'inset 0 0 0 1px '+CC_TOK.hairSoft, display:'flex', alignItems:'center', justifyContent:'center', color:CC_TOK.navy }}>
            <svg viewBox="0 0 26 26" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="19" height="17" rx="2.4"/><path d="M3.5 9.5h19M8.5 2.5v5M17.5 2.5v5"/><path d="M9.5 15l2.4 2.4 4.6-5"/></svg>
          </div>
          <h3 style={{ fontWeight:700, fontSize:17, letterSpacing:'-0.01em', color:CC_TOK.navy, margin:'0 0 6px' }}>Nothing scheduled</h3>
          <p style={{ fontSize:13.5, lineHeight:1.5, color:CC_TOK.muted, margin:'0 auto 18px', maxWidth:'30ch' }}>When this job is ready, put the install or a site visit on the calendar.</p>
          <button onClick={scheduleInstall} style={ccGoldBtn(50, 15.5)}>
            <svg viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3.5v11M3.5 9h11"/></svg>
            Schedule install
          </button>
        </div>
      ) : null}

      {past.length > 0 && (
        <div style={{ marginTop:22 }}>
          <div style={secH}>Past events</div>
          <div style={{ position:'relative', paddingLeft:22 }}>
            <span style={{ position:'absolute', left:4, top:6, bottom:6, width:2, background:CC_TOK.hair, borderRadius:2 }} />
            {past.map((ev, i) => (
              <div key={ev.id} style={{ position:'relative', padding:'9px 0', borderTop: i>0 ? '1px solid '+CC_TOK.hairSoft : 'none' }}>
                <span style={{ position:'absolute', left:-22, top:15, width:9, height:9, borderRadius:'50%', background:CC_TOK.page, boxShadow:'inset 0 0 0 2px '+CC_TOK.gray }} />
                <div style={{ fontFamily:CC_TOK.mono, fontWeight:500, fontSize:11.5, color:CC_TOK.faint, letterSpacing:'0.01em' }}>{formatDate(ev.start_at, { month:'short', day:'numeric', year:'numeric' })}</div>
                <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10, marginTop:2 }}>
                  <span style={{ fontWeight:600, fontSize:14.5, color:CC_TOK.muted, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ev.title || 'Event'}</span>
                  <span style={{ fontFamily:CC_TOK.mono, fontSize:12, color:CC_TOK.faint, whiteSpace:'nowrap', flex:'0 0 auto' }}>{durLabel(durMin(ev))}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add-event ghost (comp .add-ev). Suppressed in the pure-empty state,
          where the empty card's gold "Schedule install" is the one add path. */}
      <AddEventInline contact={contact} bumpData={bumpData} hasUpcoming={!!upcoming} quiet={!upcoming && past.length === 0} />
    </div>
  );
}

// ── UpcomingEventCard ─────────────────────────────────────────────────
// Hosts the next-up event row + quick reschedule controls. Click the
// time to expand inline date/time pickers. Save shifts the event and
// fires a toast with Undo. Avoids the "open a modal to move a meeting"
// friction - most reschedules are 1 day or 1 hour off.
function UpcomingEventCard({ event, contact, durLabel, durMin, bumpData }) {
  const [editing, setEditing] = React.useState(false);
  // Seed pickers from event.start_at in LOCAL time so the date+time
  // round-trip cleanly through `<input type=date|time>`.
  const initial = React.useMemo(() => {
    const d = new Date(event.start_at);
    const pad = n => String(n).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }, [event.start_at, event.id]);
  const [date, setDate] = React.useState(initial.date);
  const [time, setTime] = React.useState(initial.time);
  React.useEffect(() => { setDate(initial.date); setTime(initial.time); }, [initial.date, initial.time]);

  // Audit-2026-05-09 H4: rapid +1d / +1d clicks shared the same `event`
  // reference; the second click read event.start_at AFTER the first
  // mutation, the first DB write hadn't landed, both updates collided,
  // and the undo reverted to the post-click-1 state instead of the true
  // original. busyRef serializes; origRef captures the true pre-shift
  // value once per UI session and re-resets after the toast window. On
  // DB failure we revert in memory + alert.
  const busyRef = React.useRef(false);
  const origRef = React.useRef(null);
  const shiftBy = async (ms) => {
    if (busyRef.current) return;
    busyRef.current = true;
    if (origRef.current === null) origRef.current = event.start_at;
    const trueOrig = origRef.current;
    const fromAt = event.start_at;
    const newStart = new Date(new Date(fromAt).getTime() + ms).toISOString();
    const prevEnd = event.end_at;
    event.start_at = newStart;
    if (prevEnd) {
      const dur = new Date(prevEnd).getTime() - new Date(fromAt).getTime();
      event.end_at = new Date(new Date(newStart).getTime() + dur).toISOString();
    }
    bumpData?.();
    let dbErr = null;
    if (CRM.__db) {
      const patch = { start_at: newStart };
      if (event.end_at) patch.end_at = event.end_at;
      const { error } = await CRM.__db.from('calendar_events').update(patch).eq('id', event.id);
      dbErr = error;
    }
    busyRef.current = false;
    if (dbErr) {
      // Revert in-memory mutation; the DB write didn't land.
      event.start_at = fromAt;
      if (prevEnd) event.end_at = prevEnd;
      bumpData?.();
      window.showToast?.(`Reschedule failed: ${dbErr.message}`, { kind:'error', duration: 4000 });
      return;
    }
    // Reset origRef after the undo window (5s) so the next "session" of
    // shifts starts fresh. Prevents undo from reaching back two sessions.
    setTimeout(() => { origRef.current = null; }, 5200);
    window.showToast?.('Rescheduled to ' + new Date(newStart).toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }), {
      undo: async () => {
        event.start_at = trueOrig;
        if (prevEnd) event.end_at = prevEnd;
        origRef.current = null;
        bumpData?.();
        if (CRM.__db) {
          const patch = { start_at: trueOrig };
          if (prevEnd) patch.end_at = prevEnd;
          await CRM.__db.from('calendar_events').update(patch).eq('id', event.id);
        }
      },
      duration: 5000,
    });
  };

  const saveCustom = async () => {
    if (!date || !time) { window.showToast?.('Pick date and time'); return; }
    const newStart = new Date(`${date}T${time}:00`);
    if (isNaN(newStart.getTime())) { window.showToast?.('Invalid date'); return; }
    const ms = newStart.getTime() - new Date(event.start_at).getTime();
    if (ms === 0) { setEditing(false); return; }
    setEditing(false);
    await shiftBy(ms);
  };

  // ── Presentation, wired from the approved comp crm-contact-calendar.html ──
  // Reschedule shifts via saveCustom (same undo + serialized writes the chips
  // used); Mark done calls the canonical advanceJobMarkInstalled engine;
  // Cancel-this-event keeps its confirm + 5s undo, demoted to a quiet link.
  const T = CC_TOK;
  const isInstall = event.kind === 'install';
  const isInspect = event.kind === 'inspect';
  const edge = isInstall ? T.green : isInspect ? T.blue : T.gray;
  const KIND_LABEL = { install:'Install', inspect:'Inspection', follow_up:'Follow-up', pickup:'Pickup', meeting:'Meeting' };
  const kindLabel = KIND_LABEL[event.kind] || (event.kind || 'Event');
  // Calendar-day difference (robust to the start time of day, unlike a raw
  // ms/86400000 round which flips "tomorrow" on at the 12h mark).
  const _sd = new Date(event.start_at); _sd.setHours(0,0,0,0);
  const _td = new Date(); _td.setHours(0,0,0,0);
  const dayDiff = Math.round((_sd.getTime() - _td.getTime()) / 86400000);
  const countdown = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : dayDiff > 1 ? `In ${dayDiff} days` : `${Math.abs(dayDiff)}d overdue`;
  const whenLabel = `${formatDate(event.start_at, { weekday:'short', month:'short', day:'numeric' })} · ${formatTime(event.start_at)}`;
  const dueNow = isInstall && dayDiff <= 0;   // install today or past-due -> Mark done becomes the primary
  const addr = contact?.address || '';

  const [marking, setMarking] = React.useState(false);
  const markDone = async () => {
    if (marking) return;
    setMarking(true);
    try {
      // advanceJobMarkInstalled RETURNS { ok:false, error } on failure (it does
      // not throw) and reverts its in-memory mutation; surface that, and on
      // success bumpData so the just-completed install leaves the upcoming slot.
      const r = await window.CRM?.advanceJobMarkInstalled?.(contact, event);
      if (r && r.ok === false) { window.showToast?.('Mark done failed: ' + (r.error || 'unknown')); }
      else { window.showToast?.('Marked installed'); bumpData?.(); }
    } catch (e) { window.showToast?.('Mark done failed: ' + (e?.message || 'unknown')); }
    finally { setMarking(false); }
  };
  const openDirections = () => {
    if (!addr) { window.showToast?.('No address on file'); return; }
    window.open('https://maps.apple.com/?daddr=' + encodeURIComponent(addr), '_blank', 'noopener');
  };
  const cancelEvent = async () => {
    const ok = await window.confirmAction?.({
      title: 'Cancel this ' + (event.kind || 'event') + '?',
      body: 'Removes it from the schedule. Use Undo within 5 seconds if it was a mistake.',
      confirmLabel: 'Cancel event', destructive: true,
    });
    if (!ok) return;
    const prev = event.status;
    event.status = 'cancelled'; bumpData?.();
    if (CRM.__db) {
      const { error } = await CRM.__db.from('calendar_events').update({ status: 'cancelled' }).eq('id', event.id);
      if (error) { event.status = prev; bumpData?.(); window.showToast?.('Cancel failed: ' + error.message); return; }
    }
    window.showToast?.('Event cancelled', {
      undo: async () => { event.status = prev; bumpData?.(); if (CRM.__db) await CRM.__db.from('calendar_events').update({ status: prev }).eq('id', event.id); },
      duration: 5000,
    });
  };

  const iconGhost = { width:48, height:48, flex:'0 0 auto', borderRadius:12, background:'transparent', boxShadow:'inset 0 0 0 1.5px '+T.hair, color:T.muted, display:'inline-flex', alignItems:'center', justifyContent:'center', cursor:'pointer', border:'none' };
  const btnGhost = { flex:'1 1 auto', minHeight:48, borderRadius:100, background:'transparent', boxShadow:'inset 0 0 0 1.5px '+T.hair, color:T.navy, fontWeight:600, fontSize:15, fontFamily:'inherit', display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8, cursor:'pointer', border:'none' };
  const dtField = { display:'flex', alignItems:'center', gap:9, height:50, padding:'0 13px', background:T.card, borderRadius:12, boxShadow:'inset 0 0 0 1.5px '+T.hair };
  const dtInput = { width:'100%', minWidth:0, fontFamily:T.mono, fontWeight:500, fontSize:16, color:T.navy, background:'transparent', border:'none', outline:'none', padding:0 };
  const calSvg = <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3.5" width="11" height="10" rx="1.6"/><path d="M2.5 6.5h11M5.5 1.8v2.6M10.5 1.8v2.6"/></svg>;
  const pinSvg = <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.7"/></svg>;

  return (
    <div style={{ position:'relative', background:'#fff', borderRadius:16, boxShadow:T.shSm+', inset 0 0 0 1px '+T.hairSoft, padding:'16px 16px 14px', overflow:'hidden' }}>
      <span style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:edge }} />
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:6, height:26, padding:'0 11px', borderRadius:100, background:T.gold, color:T.navy, fontWeight:700, fontSize:12, letterSpacing:'0.01em', boxShadow:'0 2px 10px rgba(255,186,0,0.30)', whiteSpace:'nowrap', flex:'0 0 auto' }}>
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="4.6"/><path d="M6 3.6V6l1.6 1"/></svg>
          {countdown}
        </span>
        <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontWeight:600, fontSize:11.5, letterSpacing:'0.04em', textTransform:'uppercase', color:T.faint, whiteSpace:'nowrap' }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:edge, flex:'0 0 auto' }} />{kindLabel}
        </span>
      </div>
      <div style={{ fontFamily:T.mono, fontWeight:600, fontSize:27, lineHeight:1.1, letterSpacing:'-0.01em', color:T.navy, marginTop:14 }}>{whenLabel}</div>
      <div style={{ fontWeight:600, fontSize:16, letterSpacing:'-0.01em', color:T.ink, marginTop:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{event.title || kindLabel}</div>
      <div style={{ display:'flex', alignItems:'center', gap:7, fontSize:13.5, color:T.muted, marginTop:3, minWidth:0 }}>
        <span style={{ fontFamily:T.mono, fontWeight:500, fontSize:12.5, color:T.muted, flex:'0 0 auto' }}>{durLabel(durMin(event))}</span>
        {isInstall && <><span style={{ color:'rgba(27,43,75,0.22)' }}>·</span><span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{contactName(contact)}'s residence</span></>}
      </div>
      {event.notes && (
        <div style={{ margin:'12px 0 0', fontSize:12.5, color:'#5D4A1F', background:'#FFFBEB', padding:'7px 9px', borderRadius:8, borderLeft:'2px solid '+T.gold, lineHeight:1.4, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{event.notes}</div>
      )}

      {!editing && (
        <div style={{ display:'flex', alignItems:'center', gap:9, marginTop:16 }}>
          {dueNow ? (
            <button onClick={markDone} disabled={marking} style={{ ...ccGoldBtn(48), opacity: marking ? 0.65 : 1 }}>
              <svg viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 9.5l3.5 3.5 7.5-9"/></svg>
              {marking ? 'Saving...' : 'Mark done'}
            </button>
          ) : (
            <button onClick={() => setEditing(true)} style={btnGhost}>{calSvg}Reschedule</button>
          )}
          {dueNow && <button onClick={() => setEditing(true)} aria-label="Reschedule" style={iconGhost}>{calSvg}</button>}
          {addr && <button onClick={openDirections} aria-label="Directions" style={iconGhost}>{pinSvg}</button>}
        </div>
      )}

      {editing && (
        <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid '+T.hairSoft }}>
          <div style={{ fontWeight:700, fontSize:11, letterSpacing:'0.12em', textTransform:'uppercase', color:T.faint, marginBottom:9 }}>Reschedule</div>
          <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:9 }}>
            <label style={dtField}>
              <span style={{ flex:'0 0 auto', color:T.faint, display:'inline-flex' }}>{calSvg}</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={dtInput} />
            </label>
            <label style={dtField}>
              <span style={{ flex:'0 0 auto', color:T.faint, display:'inline-flex' }}><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.3 1.4"/></svg></span>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={dtInput} />
            </label>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:9, marginTop:11 }}>
            <button onClick={saveCustom} style={{ flex:'1 1 auto', minHeight:46, borderRadius:100, background:T.navy, color:'#fff', fontWeight:700, fontSize:14.5, display:'inline-flex', alignItems:'center', justifyContent:'center', gap:7, border:'none', cursor:'pointer', fontFamily:'inherit' }}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.5 3.5 6.5-8"/></svg>
              Save time
            </button>
            <button onClick={() => setEditing(false)} style={{ minHeight:46, padding:'0 16px', fontWeight:600, fontSize:14.5, color:T.faint, background:'transparent', border:'none', cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Cancel-this-event, demoted to a quiet guarded link (the comp omits
          it; kept here, confirm + 5s undo, so a real booking is still
          cancellable in context without a trip to the Day Board). */}
      <div style={{ marginTop:12, paddingTop:10, borderTop:'1px solid '+T.hairSoft, textAlign:'right' }}>
        <button onClick={cancelEvent} style={{ minHeight:44, padding:'0 4px', background:'none', border:'none', color:T.faint, fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Cancel this {isInstall ? 'install' : isInspect ? 'inspection' : 'event'}</button>
      </div>
    </div>
  );
}

// Inline event creator. Opens a small form pinned below the event list with
// kind / date / time / title; on save inserts into calendar_events table and
// optimistically pushes the row into CRM.events so the list updates.
// scheduleInstallSideEffects: scheduling an install is the booked->scheduled
// transition. Stamp contacts.install_date (so install-gated signals + the
// metric spine work) and advance the contact to the install stage if it is
// behind. Shared by every install-event creator (AddEventInline + NewEventModal)
// so the logic can't drift again (CAL-20; the drift is what made NewEventModal
// silently skip notes + this stamp). Mutates the passed contact in place to
// mirror the DB write. Best-effort, never blocks the schedule UX; only forward,
// never drag a stage back.
async function scheduleInstallSideEffects(contact, startIso, tag) {
  if (!contact?.id || !CRM.__db) return;
  const patch = {};
  if (!contact.install_date) patch.install_date = startIso;
  const installNum = CRM.STAGE_STR_TO_NUM?.install;
  const curNum = CRM.STAGE_STR_TO_NUM?.[contact.stage] ?? 0;
  if (installNum != null && curNum < installNum) patch.stage = installNum;
  if (!Object.keys(patch).length) return;
  const { error: cErr } = await CRM.__db.from('contacts').update(patch).eq('id', contact.id);
  if (cErr) { console.warn(`[${tag}] install capture failed:`, cErr.message); return; }
  if (patch.install_date) contact.install_date = patch.install_date;
  if (patch.stage != null) {
    contact.stage = 'install';
    CRM.recordStageTransition?.(contact.id, curNum, installNum);
  }
}

function AddEventInline({ contact, bumpData, hasUpcoming, quiet }) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState('install');
  // Cross-tab trigger: Contact tab's "Schedule install" gold button on
  // stage=permit_approved dispatches `crm-open-add-event` to expand this
  // form without forcing Key to manually tap "+ Add event".
  React.useEffect(() => {
    const onOpen = (e) => {
      if (e.detail?.contactId === contact.id) {
        setOpen(true);
        // Suggested-date prefill (build #2 slice B): valid YYYY-MM-DD only,
        // and never a past date; otherwise the tomorrow default stands.
        if (e.detail.date && /^\d{4}-\d{2}-\d{2}$/.test(e.detail.date) && new Date(e.detail.date + 'T23:59:00') > new Date()) setDate(e.detail.date);
        // Consume the handshake globals here too (adversarial review 2026-07-02):
        // the calendar's own buttons dispatch while this form is ALREADY mounted,
        // so only this listener runs and the mount handshake never clears them.
        // Left set, they auto-open the form unprompted on a later contact visit.
        if (window.__pendingAddEvent === contact.id) window.__pendingAddEvent = null;
        window.__pendingAddEventDate = null;
      }
    };
    window.addEventListener('crm-open-add-event', onOpen);
    // Mount handshake: if the dispatcher fired before this listener existed
    // (tab still mounting), the pending id is stashed on window. Check and
    // clear it so the form still auto-expands, no timer race.
    if (window.__pendingAddEvent === contact.id) {
      window.__pendingAddEvent = null;
      setOpen(true);
      const d = window.__pendingAddEventDate;
      window.__pendingAddEventDate = null;
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T23:59:00') > new Date()) setDate(d);
    }
    return () => window.removeEventListener('crm-open-add-event', onOpen);
  }, [contact.id]);
  // Default to tomorrow in LOCAL time. toISOString() returns UTC which
  // ticks to the day-after-tomorrow after 8 PM EDT.
  const [date, setDate] = React.useState(() => {
    const d = new Date(Date.now() + 24*3600*1000);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const [time, setTime] = React.useState('09:00');
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const KIND_OPTIONS = [
    { v:'install',   label:'Install' },
    { v:'inspect',   label:'Inspection' },
    { v:'follow_up', label:'Follow-up call' },
    { v:'pickup',    label:'Pickup' },
    { v:'meeting',   label:'Meeting' },
  ];

  const defaultTitleFor = (k) => ({ install:'Install', inspect:'Inspection', follow_up:'Follow-up call', pickup:'Pickup', meeting:'Meeting' }[k] || 'Event');

  const save = async () => {
    if (!CRM.__db) { window.showToast?.('Supabase not loaded'); return; }
    if (!date || !time) { window.showToast?.('Pick a date and time'); return; }
    setSaving(true);
    const startIso = new Date(`${date}T${time}:00`).toISOString();
    // Default 1-hour duration; install runs 3 hours.
    const durMin = kind === 'install' ? 180 : kind === 'inspect' ? 30 : 60;
    const endIso = new Date(new Date(startIso).getTime() + durMin*60*1000).toISOString();
    // DB has `event_type`, not `kind`; no `status` column. Don't insert
    // those, the prior INSERT silently 422'd because of the schema gap.
    const row = {
      contact_id: contact.id,
      event_type: kind,
      title: defaultTitleFor(kind),
      start_at: startIso,
      end_at: endIso,
      notes: notes.trim() || null,
    };
    const { data, error } = await CRM.__db.from('calendar_events').insert(row).select().single();
    if (error) { setSaving(false); window.showToast?.(`Save failed: ${error.message}`); return; }
    CRM.events.push({
      id: data.id, contact_id: data.contact_id, kind: data.event_type || kind,
      start_at: data.start_at, end_at: data.end_at, title: data.title, notes: data.notes, status: 'scheduled',
    });
    // Scheduling an install stamps the contact + advances the stage; shared
    // helper so the creators can't drift again (CAL-20).
    if (kind === 'install') await scheduleInstallSideEffects(contact, startIso, 'AddEventInline');
    setSaving(false);
    setOpen(false);
    setTitle('');
    setNotes('');
    bumpData?.();
    window.showToast?.('Event scheduled');
  };

  if (!open) {
    // In the pure-empty calendar state the empty card's gold "Schedule
    // install" is the single add path; suppress the duplicate ghost row
    // (it still mounts to catch the crm-open-add-event dispatch).
    if (quiet) return null;
    // Collapsed ghost row (comp .add-collapsed): quiet by default, the
    // calendar's one obvious "create" affordance without shouting gold.
    return (
      <div style={{ marginTop:12, background:'white', border:'1px solid #e5e5e5', borderRadius:12, overflow:'hidden' }}>
        <button onClick={() => setOpen(true)} style={{
          display:'flex', alignItems:'center', gap:8, width:'100%', minHeight:48, padding:'0 16px',
          fontSize:13, fontWeight:700, color:'#8a93a6', textAlign:'left',
          background:'transparent', border:'none', cursor:'pointer', fontFamily:'inherit',
          transition:'background 180ms, color 180ms',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = '#eef1f6'; e.currentTarget.style.color = NAVY; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8a93a6'; }}
        >
          <svg viewBox="0 0 12 12" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1v10M1 6h10"/></svg>
          New event
        </button>
      </div>
    );
  }

  // ── Expanded form mapped from comps/calendar-surface-v2.html section D ──
  // Kind picker is now comp kchips (same setKind state the <select> drove);
  // date keeps the DatePresetRow presets + the custom date/time pickers;
  // fontSize 16 on every input prevents iOS Safari auto-zoom on focus.
  const afLabel = { display:'block', fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'#9ca3af', margin:'0 0 6px' };
  const afInput = { width:'100%', height:44, fontFamily:'inherit', fontSize:16, color:NAVY, background:'#eef1f6', border:'1px solid transparent', borderRadius:8, padding:'0 10px', boxSizing:'border-box' };
  // "Schedule · Tomorrow 9:00" CTA label, derived from the picked date+time.
  const schedDay = (() => {
    const fmtKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    if (date === fmtKey(today)) return 'Today';
    if (date === fmtKey(tomorrow)) return 'Tomorrow';
    const d = new Date(`${date}T00:00:00`);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
  })();
  const schedTime = (() => {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
  })();

  return (
    <div style={{ marginTop:12, background:'white', border:'1px solid #e5e5e5', borderRadius:12, padding:'14px 16px' }}>
      <span style={afLabel}>Kind</span>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
        {KIND_OPTIONS.map(o => {
          const active = kind === o.v;
          return (
            <button key={o.v} onClick={() => setKind(o.v)} aria-pressed={active} style={{
              minHeight:44, padding:'0 14px', borderRadius:100,
              background: active ? NAVY : 'white',
              border: active ? '1px solid '+NAVY : '1px solid #e5e5e5',
              fontSize:13, fontWeight: active ? 700 : 600, color: active ? 'white' : '#5a6478',
              cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap',
              transition:'background 180ms, border-color 180ms, color 180ms',
            }}>{o.label}</button>
          );
        })}
      </div>
      <span style={afLabel}>Date</span>
      {/* Quick-pick date chips above the pickers. 80% of installs are
          scheduled <14 days out, so these absorb the common case. */}
      <DatePresetRow value={date} onChange={setDate} />
      {/* Equal-width date + time. `flex:1 1 0; min-width:0` forces a true
          50/50 split regardless of the date input's intrinsic width
          (which is wider than time on Chrome because of mm/dd/yyyy + the
          calendar picker icon). */}
      <div style={{ display:'flex', gap:8, margin:'10px 0 14px' }}>
        <input
          type="date"
          aria-label="Date"
          value={date}
          min={(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })()}
          max="2099-12-31"
          onChange={e=>setDate(e.target.value)}
          style={{ ...afInput, flex:'1 1 0', minWidth:0, width:'auto' }}
        />
        <input
          type="time"
          aria-label="Time"
          value={time}
          step="900"
          onChange={e=>setTime(e.target.value)}
          style={{ ...afInput, flex:'1 1 0', minWidth:0, width:'auto' }}
        />
      </div>
      {/* Prep notes for the install: panel brand, gen amps, access
          instructions. Optional, saves to calendar_events.notes. */}
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder={kind === 'install' ? 'Panel brand, gen amps, gate code, access notes…' : 'Notes (optional)'}
        rows={2}
        style={{ ...afInput, height:'auto', minHeight:54, padding:'10px 10px', resize:'vertical' }}
      />
      {/* durationMin mirrors the save path's kind-derived durations
          (install 180, inspect 30, else 60) so the pre-save hint and the
          post-save Conflict chip agree. */}
      <ScheduleConflictHint date={date} time={time} durationMin={kind === 'install' ? 180 : kind === 'inspect' ? 30 : 60} contactId={contact.id} />
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12 }}>
        <button onClick={() => setOpen(false)} disabled={saving} style={{
          minHeight:44, padding:'0 16px', borderRadius:100, background:'#eef1f6', color:'#5a6478',
          fontSize:13, fontWeight:600, border:'none', cursor:'pointer', fontFamily:'inherit',
        }}>Cancel</button>
        <button onClick={save} disabled={saving} style={{
          minHeight:44, padding:'0 18px', borderRadius:100, background:'#ffba00', color:NAVY, border:'none',
          fontSize:13, fontWeight:700, fontFamily:'inherit', cursor:'pointer', whiteSpace:'nowrap',
          boxShadow:'0 2px 10px rgba(255,186,0,0.3)', opacity: saving ? 0.6 : 1,
        }}>{saving ? 'Saving…' : `Schedule${schedDay ? ' · ' + schedDay + (schedTime ? ' ' + schedTime : '') : ''}`}</button>
      </div>
    </div>
  );
}

// ── Contact Finance ───────────────────────────────────────────────
// ── Charge card on file (#115, BUILD ONLY until the supervised session) ──
// Key-initiated off-session balance charge against the card saved at proposal
// approval. The edge fns (charge-saved-card + request-charge-code) are
// committed but NOT deployed; until Key's supervised session activates them,
// every call here fails closed with an honest toast. The fn is authoritative
// for every money invariant (frozen signed_total, mandate row, balance match,
// idempotency); this panel only collects proposal_id + the operator's expected
// amount + the two-factor headers.
// Provenance: assembled entirely from existing primitives in this file (the
// full-width in-card CTA, ghost buttons, DM Mono inputs, inline composer
// pattern); no net-new visual language, so no fresh Claude Design comp.
//
// Operator secret: memory-only, module scope. Never localStorage (persistent
// XSS target) and never sessionStorage; Key re-enters it after a reload.
let __chargeOperatorSecret = '';

function ChargeCardPanel({ contact, proposal, onClose }) {
  const [amount, setAmount] = React.useState('');
  const [code, setCode]     = React.useState('');
  const [secret, setSecret] = React.useState(__chargeOperatorSecret);
  const [busy, setBusy]     = React.useState(false);
  const [codeSent, setCodeSent] = React.useState(false);

  // Estimate ONLY (shown as a hint). Paid invoices tied to this proposal net
  // against its total; the edge fn computes the authoritative balance from the
  // payments ledger and refuses on any mismatch with the typed amount.
  const paidCents = (CRM.invoices || [])
    .filter(i => i.proposal_id === proposal.id && i.status === 'paid')
    .reduce((s, i) => s + (i.amount_cents || 0), 0);
  // Base the "Signed total" label + balance estimate on the FROZEN
  // signed_total (the only number charge-saved-card accepts), not the live
  // editable total. On a signed/approved deal the two can diverge; showing the
  // live total would let Key type a balance the server then refuses. Falls back
  // to the live amount when there is no frozen signed total (unsigned drafts).
  const signedBaseCents = proposal.signed_total_cents != null
    ? proposal.signed_total_cents : (proposal.amount_cents || 0);
  const estCents = Math.max(0, signedBaseCents - paidCents);

  const saveSecret = (v) => { setSecret(v); __chargeOperatorSecret = v; };

  // Parse the fn's JSON error body when there is one; fall back honestly.
  // An UNDEPLOYED fn surfaces as a FunctionsFetchError ("Failed to send a
  // request...", the preflight never finds the function) or a gateway 404;
  // both mean the same true thing until the supervised session activates it.
  async function describeError(error) {
    const status = error?.context?.status;
    if (status === 404 || /failed to send a request/i.test(error?.message || '')) {
      return 'Charge system not activated yet (deploy happens in the supervised session with Key)';
    }
    try {
      const j = await error.context.json();
      return `${j.error || 'error'}${j.detail ? `: ${j.detail}` : ''}`;
    } catch (_) {
      return error?.message || 'unknown error';
    }
  }

  const opHeaders = () => ({ 'x-charge-operator': secret.trim() });

  async function textCode() {
    if (busy) return;
    if (!secret.trim()) { window.showToast?.('Enter the operator passphrase first'); return; }
    setBusy(true);
    try {
      const { error } = await CRM.__invokeFn('request-charge-code', {
        body: { proposal_id: proposal.id },
        headers: opHeaders(),
      });
      if (error) { window.showToast?.(`Code request failed: ${await describeError(error)}`); return; }
      setCodeSent(true);
      window.showToast?.('Code texted to your phone (expires in 5 minutes)');
    } finally { setBusy(false); }
  }

  async function charge() {
    if (busy) return;
    const amt = Number(amount);
    if (!(amt > 0)) { window.showToast?.('Enter the exact dollar amount to charge'); return; }
    if (!/^\d{6}$/.test(code.trim())) { window.showToast?.('Enter the 6-digit code from the text'); return; }
    if (!secret.trim()) { window.showToast?.('Enter the operator passphrase'); return; }
    setBusy(true);
    try {
      const { data, error } = await CRM.__invokeFn('charge-saved-card', {
        body: { proposal_id: proposal.id, expected_amount: amt },
        headers: { ...opHeaders(), 'x-charge-code': code.trim() },
      });
      if (error) { window.showToast?.(`Charge refused: ${await describeError(error)}`); return; }
      window.showToast?.(`Charge submitted: $${amt.toFixed(2)}. Stripe will confirm the payment in a moment.`);
      onClose();
    } finally { setBusy(false); }
  }

  const fieldStyle = {
    width:'100%', height:44, borderRadius:8, border:'1.5px solid #EBEBEA',
    padding:'0 12px', fontSize:16, background:'#f8f8f6', outline:'none',
    color:NAVY, boxSizing:'border-box', fontFamily:"'DM Mono', monospace",
  };
  const labelStyle = { fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4, marginTop:10 };

  return (
    <div style={{ border:'1px solid rgba(11,31,59,0.10)', borderRadius:8, padding:'12px 14px', background:'#fcfcfb' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:13, fontWeight:700, color:NAVY }}>Charge card on file</span>
        <span style={{ fontSize:12, color:'#666', fontFamily:"'DM Mono', monospace" }}>
          {(contact.card_brand || 'Card')} &bull;&bull;&bull;&bull; {contact.card_last4 || '????'}
        </span>
      </div>
      <div style={labelStyle}>Amount (exact balance)</div>
      <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder={(estCents / 100).toFixed(2)} inputMode="decimal" type="text" style={{ ...fieldStyle, fontFamily:"'JetBrains Mono','DM Mono',monospace" }} />
      <div style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>
        Signed total <span style={{ fontFamily:"'JetBrains Mono','DM Mono',monospace" }}>{formatMoneyCents(signedBaseCents)}</span>, {paidCents > 0 && <><span style={{ fontFamily:"'JetBrains Mono','DM Mono',monospace" }}>{formatMoneyCents(paidCents)}</span> paid, </>}estimated balance <span style={{ fontFamily:"'JetBrains Mono','DM Mono',monospace" }}>{formatMoneyCents(estCents)}</span>. The server refuses any mismatch.
      </div>
      <div style={labelStyle}>Operator passphrase</div>
      <input value={secret} onChange={e => saveSecret(e.target.value)} type="password"
        autoComplete="off" placeholder="Held by Key" style={fieldStyle} />
      <div style={labelStyle}>One-time code</div>
      <div style={{ display:'flex', gap:6 }}>
        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="6 digits" inputMode="numeric" type="text" style={{ ...fieldStyle, flex:1, width:'auto' }} />
        <button onClick={textCode} disabled={busy} style={{
          minHeight:44, padding:'0 14px', borderRadius:8, background:'transparent', color:NAVY,
          border:'1px solid rgba(11,31,59,0.20)', fontSize:13, fontWeight:600, fontFamily:'inherit',
          cursor:'pointer', whiteSpace:'nowrap', opacity: busy ? .6 : 1 }}>
          {codeSent ? 'Re-text code' : 'Text me the code'}
        </button>
      </div>
      <div style={{ display:'flex', gap:6, marginTop:12 }}>
        <button onClick={charge} disabled={busy} style={{
          flex:1, height:44, borderRadius:8, background:GOLD, color:NAVY, border:'none',
          fontSize:13, fontWeight:700, fontFamily:'inherit', cursor:'pointer', opacity: busy ? .6 : 1 }}>
          {busy ? 'Working' : `Charge ${Number(amount) > 0 ? '$' + Number(amount).toFixed(2) : 'card'}`}
        </button>
        <button onClick={onClose} disabled={busy} style={{
          minHeight:44, padding:'0 14px', borderRadius:8, background:'transparent', color:'#666',
          border:'1px solid rgba(11,31,59,0.15)', fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// RefundPanel , operator-gated refund of a specific COMPLETED payment. The inverse
// of ChargeCardPanel and assembled from the SAME primitives: the memory-only
// operator passphrase (__chargeOperatorSecret), the Text-me-the-code request-charge-code
// 2FA flow, the describeError() deployed-fn gate + honest "not activated yet" toast,
// and the identical field/label styles. The only deltas are an amount field (capped at
// the payment's still-refundable remaining) and the refund-payment call. The edge fn
// owns every money invariant (per-row ceiling, proposal binding, webhook-sole-writer);
// this panel only collects payment_id + proposal_id + the operator's amount + the
// two-factor headers. The primary uses the EXISTING danger-red token (#dc2626, the same
// FinanceOverflowMenu danger items use) because a refund returns money (destructive),
// distinct from the gold collect/charge primary. Provenance: reuse of the ChargeCardPanel
// primitive + the danger token; no net-new visual language, so no fresh Claude Design comp.
function RefundPanel({ payment, onClose }) {
  const remaining = Math.max(0, (Number(payment.amount) || 0) - (Number(payment.refunded_amount) || 0));
  const [amount, setAmount] = React.useState('');
  const [code, setCode]     = React.useState('');
  const [secret, setSecret] = React.useState(__chargeOperatorSecret);
  const [busy, setBusy]     = React.useState(false);
  const [codeSent, setCodeSent] = React.useState(false);
  const saveSecret = (v) => { setSecret(v); __chargeOperatorSecret = v; };

  async function describeError(error) {
    const status = error?.context?.status;
    if (status === 404 || /failed to send a request/i.test(error?.message || '')) {
      return 'Refund system not activated yet (deploy happens in the supervised session with Key)';
    }
    try {
      const j = await error.context.json();
      return `${j.error || 'error'}${j.detail ? `: ${j.detail}` : ''}`;
    } catch (_) {
      return error?.message || 'unknown error';
    }
  }
  const opHeaders = () => ({ 'x-charge-operator': secret.trim() });

  async function textCode() {
    if (busy) return;
    if (!secret.trim()) { window.showToast?.('Enter the operator passphrase first'); return; }
    if (!payment.proposal_id) { window.showToast?.('This payment has no proposal to authorize against'); return; }
    setBusy(true);
    try {
      const { error } = await CRM.__invokeFn('request-charge-code', {
        body: { proposal_id: payment.proposal_id },
        headers: opHeaders(),
      });
      if (error) { window.showToast?.(`Code request failed: ${await describeError(error)}`); return; }
      setCodeSent(true);
      window.showToast?.('Code texted to your phone (expires in 5 minutes)');
    } finally { setBusy(false); }
  }

  async function refund() {
    if (busy) return;
    const amt = Number(amount);
    if (!(amt > 0)) { window.showToast?.('Enter the exact dollar amount to refund'); return; }
    if (amt > remaining + 0.005) { window.showToast?.(`Refund cannot exceed the $${remaining.toFixed(2)} still refundable`); return; }
    if (!/^\d{6}$/.test(code.trim())) { window.showToast?.('Enter the 6-digit code from the text'); return; }
    if (!secret.trim()) { window.showToast?.('Enter the operator passphrase'); return; }
    setBusy(true);
    try {
      const { data, error } = await CRM.__invokeFn('refund-payment', {
        body: { payment_id: payment.id, proposal_id: payment.proposal_id, expected_amount: amt },
        headers: { ...opHeaders(), 'x-charge-code': code.trim() },
      });
      if (error) { window.showToast?.(`Refund refused: ${await describeError(error)}`); return; }
      if (data && data.ok === false) { window.showToast?.(`Refund not completed: ${data.detail || data.status || 'check Stripe'}`); return; }
      window.showToast?.(`Refund submitted: $${amt.toFixed(2)}. Stripe will confirm in a moment.`);
      onClose();
    } finally { setBusy(false); }
  }

  const fieldStyle = {
    width:'100%', height:44, borderRadius:8, border:'1.5px solid #EBEBEA',
    padding:'0 12px', fontSize:16, background:'#f8f8f6', outline:'none',
    color:NAVY, boxSizing:'border-box', fontFamily:"'DM Mono', monospace",
  };
  const labelStyle = { fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4, marginTop:10 };

  return (
    <div style={{ border:'1px solid rgba(220,38,38,0.20)', borderRadius:8, padding:'12px 14px', background:'#fffafa' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:13, fontWeight:700, color:NAVY }}>Refund payment</span>
        <span style={{ fontSize:12, color:'#666', fontFamily:"'DM Mono', monospace" }}>
          ${(Number(payment.amount) || 0).toFixed(2)} paid{Number(payment.refunded_amount) > 0 ? `, $${Number(payment.refunded_amount).toFixed(2)} refunded` : ''}
        </span>
      </div>
      <div style={labelStyle}>Amount to refund</div>
      <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder={remaining.toFixed(2)} inputMode="decimal" type="text" style={{ ...fieldStyle, fontFamily:"'JetBrains Mono','DM Mono',monospace" }} />
      <div style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>
        Up to <span style={{ fontFamily:"'JetBrains Mono','DM Mono',monospace" }}>${remaining.toFixed(2)}</span> still refundable on this payment. The server refuses any overage.
      </div>
      <div style={labelStyle}>Operator passphrase</div>
      <input value={secret} onChange={e => saveSecret(e.target.value)} type="password"
        autoComplete="off" placeholder="Held by Key" style={fieldStyle} />
      <div style={labelStyle}>One-time code</div>
      <div style={{ display:'flex', gap:6 }}>
        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="6 digits" inputMode="numeric" type="text" style={{ ...fieldStyle, flex:1, width:'auto' }} />
        <button onClick={textCode} disabled={busy} style={{
          minHeight:44, padding:'0 14px', borderRadius:8, background:'transparent', color:NAVY,
          border:'1px solid rgba(11,31,59,0.20)', fontSize:13, fontWeight:600, fontFamily:'inherit',
          cursor:'pointer', whiteSpace:'nowrap', opacity: busy ? .6 : 1 }}>
          {codeSent ? 'Re-text code' : 'Text me the code'}
        </button>
      </div>
      <div style={{ display:'flex', gap:6, marginTop:12 }}>
        <button onClick={refund} disabled={busy} style={{
          flex:1, height:44, borderRadius:8, background:'#dc2626', color:'white', border:'none',
          fontSize:13, fontWeight:700, fontFamily:'inherit', cursor:'pointer', opacity: busy ? .6 : 1 }}>
          {busy ? 'Working' : `Refund ${Number(amount) > 0 ? '$' + Number(amount).toFixed(2) : ''}`}
        </button>
        <button onClick={onClose} disabled={busy} style={{
          minHeight:44, padding:'0 14px', borderRadius:8, background:'transparent', color:'#666',
          border:'1px solid rgba(11,31,59,0.15)', fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Overflow action menu (CRM revamp 2026-06-10, validated crm-finance-row.html
// comp). A 44px "⋯" that opens a popover of secondary actions; closes on
// outside-click or Esc. items = [{label, onClick, tone?:'default'|'good'|'danger'}]
// or {divider:true}. Keeps the finance row to ONE primary action + this menu
// instead of a wall of up-to-7 ghost buttons.
function FinanceOverflowMenu({ items }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [open]);
  const live = items.filter(Boolean);
  if (live.filter(i => !i.divider).length === 0) return null;
  const toneColor = (t) => t === 'danger' ? '#991B1B' : t === 'good' ? '#16a34a' : NAVY;
  return (
    <div ref={ref} style={{ position:'relative', flexShrink:0 }}>
      <button onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }} aria-label="More actions" title="More actions"
        style={{ width:44, height:44, borderRadius:8, background:'transparent', border:'none', cursor:'pointer', color:'#6b7280', fontSize:20, fontWeight:700, fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>
        &#8943;
      </button>
      {open && (
        <div style={{ position:'absolute', top:46, right:0, zIndex:40, minWidth:168, background:'white', border:'1px solid rgba(11,31,59,0.12)', borderRadius:10, boxShadow:'0 8px 24px rgba(27,43,75,.16)', padding:'4px 0', overflow:'hidden' }}>
          {live.map((it, i) => {
            if (it.divider) return <div key={'d'+i} style={{ height:1, background:'#f0f0ee', margin:'4px 0' }} />;
            // finance-overflow: danger rows get a perceivable resting signifier
            // (left accent + faint tint, the same #fef2f2 the QR del menu uses)
            // instead of red text alone; both tones get a desktop row-hover to
            // match the ContactOverflowMenu sibling.
            const isDanger = it.tone === 'danger';
            const restBg = isDanger ? '#fef2f2' : 'none';
            return (
              <button key={it.label} disabled={it.disabled} aria-busy={it.disabled ? true : undefined}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick && it.onClick(); }}
                onMouseEnter={e => { if (!it.disabled) e.currentTarget.style.background = isDanger ? '#fde2e2' : '#F8F8F6'; }}
                onMouseLeave={e => { e.currentTarget.style.background = restBg; }}
                style={{ display:'block', width:'100%', textAlign:'left', background:restBg, border:'none', borderLeft: isDanger ? '3px solid #dc2626' : '3px solid transparent', cursor: it.disabled ? 'wait' : 'pointer', fontFamily:'inherit', fontSize:13, fontWeight:600, color:toneColor(it.tone), padding:'11px 14px', minHeight:44, boxSizing:'border-box', opacity: it.disabled ? 0.6 : 1 }}>
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── MoneyCard (Claude Design comp "crm-money-card.html", 2026-06-13) ──
// The dead-simple post-sign money surface Key asked for: a signed deal reads
// as AMOUNT DUE -> (Record payment: Cash/Card/Check/Paid elsewhere) -> PAID IN
// FULL -> Send receipt. No "draft", no "Generate invoice", no deposit math in
// his face. Self-contained (brand hex inline, reuses FinanceOverflowMenu). It
// RECORDS an external payment via the parent's onRecord (record-payment edge
// fn); it never charges a card (that is the Key-gated charge flow).
function MoneyCard({ firstName, tierText, dueAmount, totalAmount, paidAmount, partial, signedWhen, paid, paidMethod, paidDate, onRecord, onEdit, onSendReceipt, onSendPartialReceipt, sending, overflow, awaitingDeposit, depositAmount, depositOfTotal, depositRate, onSendDepositLink }) {
  const NV = '#0b1f3b', GD = '#ffba00', INK = '#1a2a42', MUT = '#6b7280';
  const [sheet, setSheet] = React.useState(false);
  const [method, setMethod] = React.useState('Cash');
  const [amt, setAmt] = React.useState(String(dueAmount ?? ''));
  const [editing, setEditing] = React.useState(false);
  const [editVal, setEditVal] = React.useState(String(totalAmount ?? dueAmount ?? ''));
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (!sheet) setAmt(String(dueAmount ?? '')); }, [dueAmount, sheet]);

  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const moneyBig = { fontFamily: "'JetBrains Mono','DM Mono',monospace", fontWeight: 800, letterSpacing: '-.02em', color: NV, fontVariantNumeric: 'tabular-nums' };
  const eyebrow = (color) => ({ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color });
  const navyBtn = { width: '100%', minHeight: 48, borderRadius: 12, background: NV, color: '#fff', border: 'none', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 };
  const card = { background: '#fff', border: 0, borderRadius: 16, padding: '18px 18px 18px', marginBottom: 14, boxShadow: 'inset 0 0 0 1px rgba(27,43,75,0.085), 0 1px 2px rgba(27,43,75,0.04)' };

  // PAID state
  if (paid) {
    return (
      <div data-card style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={eyebrow('#16a34a')}>&#10003; Paid in full</span>
          {overflow && overflow.length > 0 && <FinanceOverflowMenu items={overflow} />}
        </div>
        <div style={{ ...moneyBig, fontSize: 40, lineHeight: 1.05, margin: '8px 0 2px' }}>{money(dueAmount)}</div>
        <div style={{ fontSize: 13, color: MUT, marginBottom: 16 }}>{[paidMethod, paidDate].filter(Boolean).join('  ·  ')}</div>
        <button style={{ ...navyBtn, opacity: sending ? 0.6 : 1, cursor: sending ? 'wait' : 'pointer' }} disabled={sending} aria-busy={sending ? true : undefined} onClick={onSendReceipt}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          {sending ? 'Sending…' : 'Send receipt'}
        </button>
      </div>
    );
  }

  // RECORD PAYMENT sheet
  if (sheet) {
    const methods = ['Cash', 'External card payment', 'Check', 'Other external payment'];
    const icons = { Cash: '💵', 'External card payment': '💳', Check: '🧾', 'Other external payment': '💸' };
    const chip = (m) => ({
      minHeight: 48, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      border: method === m ? '1.5px solid ' + NV : '1.5px solid #e5e5e5',
      background: method === m ? NV : '#fff', color: method === m ? '#fff' : INK,
    });
    const amtNum = Number(String(amt).replace(/[^0-9.]/g, '')) || 0;
    return (
      <div data-card style={card}>
        <div style={{ fontSize: 16, fontWeight: 800, color: NV, marginBottom: 12 }}>How did {firstName || 'they'} pay?</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {methods.map(m => (
            <button key={m} style={chip(m)} onClick={() => setMethod(m)}>
              <span style={{ color: method === m ? GD : MUT }}>{icons[m]}</span>{m}
            </button>
          ))}
        </div>
        <div style={eyebrow(MUT)}>Amount received</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1.5px solid #e5e5e5', borderRadius: 10, padding: '0 12px', margin: '6px 0 14px', background: '#f8f8f6' }}>
          <span style={{ ...moneyBig, fontSize: 18, color: MUT }}>$</span>
          <input type="text" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)}
            style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontFamily: "'JetBrains Mono','DM Mono',monospace", fontSize: 18, fontWeight: 700, color: INK, padding: '13px 0', minWidth: 0 }} />
        </div>
        <button style={{ ...navyBtn, opacity: busy || amtNum <= 0 ? 0.6 : 1 }} disabled={busy || amtNum <= 0}
          onClick={async () => { setBusy(true); const ok = await onRecord(amtNum, method); setBusy(false); if (ok) setSheet(false); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {busy ? 'Recording...' : 'Record ' + money(amtNum) + ' payment'}
        </button>
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button onClick={() => setSheet(false)} style={{ background: 'none', border: 'none', color: MUT, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', minHeight: 44, padding: '0 16px' }}>Cancel</button>
        </div>
      </div>
    );
  }

  // AWAITING DEPOSIT state, a signed deposit-required deal with no money in yet.
  // It is NOT paid and NOT approved (only a cleared deposit approves it via Stripe).
  // Lead with the deposit owed + the one honest action: send the customer their
  // deposit link. This is the Curtis case, so it must never read as a plain
  // "Amount due -> Record payment" approved-paid deal. A cash/check deposit can
  // still be recorded as a secondary path (some customers pay the deposit in person).
  if (awaitingDeposit) {
    const pct = depositRate ? Math.round(depositRate * 100) : 20;
    return (
      <div data-card style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={eyebrow('#92400e')}>Deposit owed</span>
          {overflow && overflow.length > 0 && <FinanceOverflowMenu items={overflow} />}
        </div>
        <div style={{ ...moneyBig, fontSize: 40, lineHeight: 1.05, margin: '6px 0 2px' }}>{money(depositAmount)}</div>
        <div style={{ fontSize: 13, color: MUT, marginBottom: 16 }}>{[`${pct}% deposit on ` + money(depositOfTotal), signedWhen, 'not booked until paid'].filter(Boolean).join('  ·  ')}</div>
        <button style={{ ...navyBtn, background: GD, color: NV }} onClick={onSendDepositLink}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Send deposit link
        </button>
        <button onClick={() => { setMethod('Cash'); setAmt(String(depositAmount ?? '')); setSheet(true); }}
          style={{ width: '100%', minHeight: 44, marginTop: 10, borderRadius: 12, background: '#fff', color: NV, border: '1.5px solid #e5e5e5', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          Paid the deposit another way? Record it
        </button>
      </div>
    );
  }

  // AMOUNT DUE state (default)
  return (
    <div data-card style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={eyebrow(partial ? '#92400e' : GD)}>{partial ? 'Partially paid' : 'Balance due'}</span>
        {overflow && overflow.length > 0 && <FinanceOverflowMenu items={overflow} />}
      </div>
      {editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 2px' }}>
          <span style={{ ...moneyBig, fontSize: 28, color: MUT }}>$</span>
          <input autoFocus type="text" inputMode="decimal" value={editVal} onChange={e => setEditVal(e.target.value)}
            style={{ flex: 1, minWidth: 0, maxWidth: 160, border: '1.5px solid ' + NV, borderRadius: 8, background: '#fff', outline: 'none', fontFamily: "'JetBrains Mono','DM Mono',monospace", fontSize: 24, fontWeight: 800, color: INK, padding: '6px 8px' }} />
          <button onClick={() => {
              const v = Number(String(editVal).replace(/[^0-9.]/g, '')) || 0;
              if (v > 0 && (!paidAmount || v >= paidAmount)) { onEdit(v); setEditing(false); }
              else if (paidAmount && v < paidAmount) { window.showToast?.('Price can\'t be below the ' + money(paidAmount) + ' already collected. Refund first, then edit.'); }
              else { setEditing(false); }
            }}
            style={{ minHeight: 44, padding: '0 14px', borderRadius: 8, background: NV, color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
          <button onClick={() => { setEditVal(String(totalAmount ?? dueAmount ?? '')); setEditing(false); }}
            style={{ minHeight: 44, padding: '0 10px', background: 'none', border: 'none', color: MUT, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 2px' }}>
          <span style={{ ...moneyBig, fontSize: 40, lineHeight: 1.05 }}>{money(dueAmount)}</span>
          {onEdit && <button onClick={() => { setEditVal(String(totalAmount ?? dueAmount ?? '')); setEditing(true); }} aria-label="Edit price" title="Edit price"
            style={{ width: 44, height: 44, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: MUT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>}
        </div>
      )}
      <div style={{ fontSize: 13, color: MUT, marginBottom: 16 }}>{[partial ? (money(paidAmount) + ' of ' + money(totalAmount) + ' paid') : null, tierText, signedWhen].filter(Boolean).join('  ·  ')}</div>
      <button style={navyBtn} onClick={() => { setMethod('Cash'); setAmt(String(dueAmount ?? '')); setSheet(true); }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Record payment
      </button>
      {/* Once a deposit/partial is in, Key can send the customer a receipt that
          shows the HONEST remaining balance (never $0). The booking-tone
          "Send deposit receipt" lives in the overflow menu. */}
      {partial && onSendPartialReceipt && (
        <button onClick={onSendPartialReceipt} disabled={sending} aria-busy={sending ? true : undefined}
          style={{ width:'100%', minHeight:44, marginTop:10, borderRadius:12, background:'#fff', color:NV, border:'1.5px solid #e5e5e5', fontSize:14, fontWeight:700, fontFamily:'inherit', cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.6 : 1, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          {sending ? 'Sending…' : 'Send receipt'}
        </button>
      )}
    </div>
  );
}

function ContactFinance({ contact, proposals, invoices, highlightId }) {
  // 2026-05-26 audit: sort by sent_at desc with created_at fallback so
  // drafts (sent_at=null) still get ordered by recency relative to other
  // drafts. Previously sent_at fell back to created_at in the mapper,
  // making this sort hide drafts behind sent ones; that fallback was
  // removed because it broke the rotting-quote signal.
  const proposal = [...proposals].sort((a,b) => {
    const tb = b.sent_at || b.approved_at || '';
    const ta = a.sent_at || a.approved_at || '';
    if (tb !== ta) return tb.localeCompare(ta);
    // Same send timestamp (or both null) → break ties on id (UUIDv7-ish ordering).
    return (b.id || '').localeCompare(a.id || '');
  })[0];
  const sortedInvoices = [...invoices].sort((a,b) => (a.sent_at||'').localeCompare(b.sent_at||''));

  // P1 modals - proposal/invoice builders. State lives at this level so the
  // modals stay open across re-renders from realtime updates.
  const [proposalModalOpen, setProposalModalOpen] = React.useState(false);
  const [invoiceModalOpen,  setInvoiceModalOpen]  = React.useState(false);
  const [receiptModalOpen,  setReceiptModalOpen]  = React.useState(false);
  // V3: edit-mode targets (id only - we look up the row at render time so
  // realtime updates flow through automatically).
  const [editingProposalId, setEditingProposalId] = React.useState(null);
  const [editingInvoiceId,  setEditingInvoiceId]  = React.useState(null);
  // If the row being edited disappears (deleted via realtime), close the
  // modal - but do it in an effect, not during render. setState during
  // render triggers a re-render warning and can briefly thrash.
  React.useEffect(() => {
    if (editingProposalId && !(CRM.proposals || []).some(p => p.id === editingProposalId)) {
      setEditingProposalId(null);
    }
  }, [editingProposalId, proposals]);
  React.useEffect(() => {
    if (editingInvoiceId && !(CRM.invoices || []).some(i => i.id === editingInvoiceId)) {
      setEditingInvoiceId(null);
    }
  }, [editingInvoiceId, invoices]);

  // Cross-tab triggers - Contact tab's "Send quote" gold button on stage=NEW
  // dispatches `crm-open-new-proposal` to skip the user manually navigating
  // to Finance + tapping "+ New proposal".
  React.useEffect(() => {
    const onOpen = (e) => {
      if (e.detail?.contactId === contact.id) setProposalModalOpen(true);
    };
    window.addEventListener('crm-open-new-proposal', onOpen);
    // Mount handshake: if the dispatcher fired before this listener existed
    // (tab still mounting), the pending id is stashed on window. Check and
    // clear it so the composer still opens, no timer race.
    if (window.__pendingOpenProposal === contact.id) {
      window.__pendingOpenProposal = null;
      setProposalModalOpen(true);
    }
    return () => window.removeEventListener('crm-open-new-proposal', onOpen);
  }, [contact.id]);

  const markingRef = React.useRef(new Set());

  const tierLabel = t => t === 'premium_plus' ? 'Premium+' : t === 'premium' ? 'Premium' : 'Standard';

  // Cancel and Undo are row-locked, revisioned server actions. Local truth
  // changes only after an exact receipt, so a stale tab cannot overwrite a
  // customer signature or a newer operator transition.
  const cancelProposal = async (prop) => {
    if (!CRM.__invokeFn) return;
    if (prop?.superseded_at || prop?.superseded_by) {
      window.showToast?.('This proposal was replaced. Use the current proposal.');
      return;
    }
    if (markingRef.current.has('cancel:' + prop.id)) return;
    markingRef.current.add('cancel:' + prop.id);
    const live = (CRM.proposals || []).find(x => x.id === prop.id) || prop;
    try {
      const receipt = await mutateProposalLifecycle({
        invoke: CRM.__invokeFn,
        proposal: live,
        action: 'cancel',
      });
      if (!receipt.ok) {
        window.showToast?.(receipt.statusChanged
          ? 'This proposal changed. Refresh before cancelling it.'
          : `Cancel failed: ${receipt.error}`);
        return;
      }
      applyProposalLifecycleReceipt(live, receipt);
      window.dispatchEvent(new CustomEvent('crm-data-changed'));
      window.showToast?.('Proposal cancelled', {
        undo: async () => {
          const liveNow = (CRM.proposals || []).find(x => x.id === prop.id) || live;
          const undoReceipt = await mutateProposalLifecycle({
            invoke: CRM.__invokeFn,
            proposal: liveNow,
            action: 'undo_cancel',
            relatedCancelKey: receipt.operationKey,
          });
          if (!undoReceipt.ok) {
            window.showToast?.(`Undo failed: ${undoReceipt.error}`);
            return;
          }
          applyProposalLifecycleReceipt(liveNow, undoReceipt);
          window.dispatchEvent(new CustomEvent('crm-data-changed'));
        },
        duration: 5000,
      });
    } finally {
      markingRef.current.delete('cancel:' + prop.id);
    }
    // The 14-day auto-re-engagement todo that used to queue here was retired
    // 2026-07-01 with the rest of the bpp_todos system (Key: "i dont use the
    // todo list anymore"); nothing displayed the rows it wrote.
  };

  // Void an invoice - same pattern as cancelProposal. Flips to "voided"
  // (or "cancelled" if your schema uses that). Uses 'voided' to align
  // with the FIN_PILL palette below.
  const voidInvoice = async (inv) => {
    if (!CRM.__invokeFn) return;
    if (markingRef.current.has('void:' + inv.id)) return;
    markingRef.current.add('void:' + inv.id);
    const live = (CRM.invoices || []).find(x => x.id === inv.id) || inv;
    try {
      const receipt = await mutateInvoiceLifecycle({ invoke: CRM.__invokeFn, invoice: live, action: 'void' });
      if (!receipt.ok) {
        window.showToast?.(`Void failed: ${receipt.error}`);
        return;
      }
      applyInvoiceLifecycleReceipt(live, receipt);
      window.dispatchEvent(new CustomEvent('crm-data-changed'));
      window.showToast?.('Invoice voided');
    } finally {
      markingRef.current.delete('void:' + inv.id);
    }
  };

  const recordOfflineApproval = async (proposal) => {
    if (!CRM.__invokeFn || !proposal) return;
    if (proposal.superseded_at || proposal.superseded_by) {
      window.showToast?.('This proposal was replaced. Use the current proposal.');
      return;
    }
    if (proposal.require_deposit !== false) {
      window.showToast?.('Deposit-required proposals must be accepted through customer checkout.');
      return;
    }
    const rawChannel = window.prompt('How did the customer approve? Enter phone, text, email, or in person.', 'phone');
    if (rawChannel == null) return;
    const channelMap = { phone:'phone', text:'text', email:'email', 'in person':'in_person', in_person:'in_person' };
    const channel = channelMap[String(rawChannel).trim().toLowerCase()];
    if (!channel) { window.showToast?.('Use phone, text, email, or in person'); return; }
    const note = window.prompt('Approval note or reference. Optional.', '') || '';
    const ok = await window.confirmAction?.({
      title:'Record customer approval?',
      body:'This records an offline approval. It is not an electronic signature, card authorization, or payment.',
      confirmLabel:'Record approval',
    });
    if (!ok) return;
    const storageKey = `bpp-offline-approval:${proposal.id}:${proposal.signature_revision || 1}:${channel}:${note}`;
    let idempotencyKey = '';
    try { idempotencyKey = localStorage.getItem(storageKey) || ''; } catch (_) {}
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      try { localStorage.setItem(storageKey, idempotencyKey); } catch (_) {}
    }
    const { data, error } = await CRM.__invokeFn('proposal-mutate', { body: {
      action:'record_offline_approval', proposal_id:proposal.id,
      proposal_revision:Number(proposal.signature_revision || 1),
      approval_channel:channel, note, idempotency_key:idempotencyKey,
    } });
    if (error || !data?.ok) {
      window.showToast?.(`Approval failed: ${error?.message || data?.error || 'unknown'}`);
      return;
    }
    try { localStorage.removeItem(storageKey); } catch (_) {}
    proposal.status = String(data.status || 'Signed').toLowerCase();
    proposal.approval_source = 'operator_recorded';
    window.dispatchEvent(new CustomEvent('crm-data-changed'));
    window.showToast?.('Customer approval recorded');
  };

  // V3: bring a cancelled proposal back to life. The 5-second undo on
  // cancelProposal handles same-tab mistakes; Revive handles "I cancelled
  // this last week and now I want to follow up after all" - a real case
  // when a customer goes silent and then circles back.
  const reviveProposal = async (prop) => {
    if (!CRM.__invokeFn) return;
    if (prop?.superseded_at || prop?.superseded_by) {
      window.showToast?.('This proposal was replaced. Use the current proposal.');
      return;
    }
    if (markingRef.current.has('revive:'+prop.id)) return;
    markingRef.current.add('revive:'+prop.id);
    const live = (CRM.proposals || []).find(x => x.id === prop.id) || prop;
    try {
      const receipt = await mutateProposalLifecycle({
        invoke: CRM.__invokeFn,
        proposal: live,
        action: 'revive',
      });
      if (!receipt.ok) {
        window.showToast?.(receipt.statusChanged
          ? 'This proposal changed. Refresh before reviving it.'
          : `Revive failed: ${receipt.error}`);
        return;
      }
      applyProposalLifecycleReceipt(live, receipt);
      window.dispatchEvent(new CustomEvent('crm-data-changed'));
      window.showToast?.('Proposal revived');
    } finally {
      markingRef.current.delete('revive:'+prop.id);
    }
  };
  const reviveInvoice = async (inv) => {
    if (!CRM.__invokeFn) return;
    if (markingRef.current.has('revive:'+inv.id)) return;
    markingRef.current.add('revive:'+inv.id);
    const live = (CRM.invoices || []).find(x => x.id === inv.id) || inv;
    try {
      const receipt = await mutateInvoiceLifecycle({ invoke: CRM.__invokeFn, invoice: live, action: 'reopen' });
      if (!receipt.ok) {
        window.showToast?.(`Revive failed: ${receipt.error}`);
        return;
      }
      applyInvoiceLifecycleReceipt(live, receipt);
      window.dispatchEvent(new CustomEvent('crm-data-changed'));
      window.showToast?.('Invoice revived');
    } finally {
      markingRef.current.delete('revive:'+inv.id);
    }
  };

  // Hard delete is reserved for untouched drafts. The service RPC row-locks
  // and refuses any issued document or document with money history.
  const deleteProposal = async (prop) => {
    if (!CRM.__invokeFn) return;
    if (prop?.superseded_at || prop?.superseded_by) {
      window.showToast?.('This proposal was replaced. Use the current proposal.');
      return;
    }
    const ok = await window.confirmAction?.({
      title: 'Delete this proposal?',
      body: 'This permanently removes an untouched draft. Issued proposals must be cancelled so their history stays intact.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    const receipt = await deleteDraftMoneyDocument({
      invoke: CRM.__invokeFn, documentType: 'proposal', document: prop,
    });
    if (!receipt.ok) { window.showToast?.(`Delete refused: ${receipt.error}`); return; }
    const arr = CRM.proposals || [];
    const idx = arr.findIndex(x => x.id === prop.id);
    if (idx >= 0) arr.splice(idx, 1);
    window.dispatchEvent(new CustomEvent('crm-data-changed'));
    window.showToast?.('Proposal deleted');
  };
  const deleteInvoice = async (inv) => {
    if (!CRM.__invokeFn) return;
    const ok = await window.confirmAction?.({
      title: 'Delete this invoice?',
      body: 'This permanently removes an untouched draft. Issued invoices must be voided so their history stays intact.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    const receipt = await deleteDraftMoneyDocument({
      invoke: CRM.__invokeFn, documentType: 'invoice', document: inv,
    });
    if (!receipt.ok) { window.showToast?.(`Delete refused: ${receipt.error}`); return; }
    const arr = CRM.invoices || [];
    const idx = arr.findIndex(x => x.id === inv.id);
    if (idx >= 0) arr.splice(idx, 1);
    window.dispatchEvent(new CustomEvent('crm-data-changed'));
    window.showToast?.('Invoice deleted');
  };
  // V3: email send via the send-email edge function with the proposal/invoice
  // template. Confirms before firing because email is more permanent than SMS.
  // The function REQUIRES `subject` (validated server-side) and a brain-token
  // header - otherwise it 401s or 400s with a generic non-2xx wrapper.
  // Subject is templated per template type; brain-token wiring is tracked
  // as a follow-up (function returns 401 without it today).
  const sendingEmailRef = React.useRef(false); // comms-day: double-send guard for irreversible customer email
  // [19]: a parallel STATE (the ref stays the synchronous double-fire guard) so
  // the visible email controls (MoneyCard "Send receipt", the overflow "Email"
  // items) can show a "Sending…" busy state and go non-interactive during the
  // in-flight window, matching callBack. Without it an honest double-tap got the
  // misleading "An email is already in progress" toast that reads like a failure
  // while the first send proceeds fine (audit 2026-06-22 [19]).
  const [sendingEmail, setSendingEmail] = React.useState(false);
  const emailDoc = async ({ template, contact_id, proposal, invoice, payment }) => {
    if (proposal?.superseded_at || proposal?.superseded_by) {
      window.showToast?.('This proposal was replaced. Use the current proposal.');
      return;
    }
    if (!contact?.email) { window.showToast?.('No email on contact, add one first'); return; }
    // In-flight guard: a double-tap must not fire two identical customer emails
    // (irreversible). Set before the confirm so a second tap is blocked at once;
    // cleared in finally on every exit (including cancel).
    if (sendingEmailRef.current) { window.showToast?.('An email is already in progress.'); return; }
    sendingEmailRef.current = true;
    setSendingEmail(true);
    try {
    // #202: the Key-confirm is a real preview, built AFTER subject/url/amount
    // resolve (just before the send below), so Key reviews exactly what is
    // going out (recipient, subject, amount, doc number, the linked page),
    // not a generic string. Nothing sends until the preview is confirmed.
    // 'receipt' points the customer at the receipt VIEW page, not the invoice
    // page (which carries a Pay button, wrong for an already-paid invoice).
    // 'receipt-deposit'/'receipt-partial' are pure records of a NOT-fully-paid
    // invoice: no view page (receipt.html only renders 'paid'), no pay button,
    // so url=null (the templates carry no link var for them).
    const isBalanceReceipt = template === 'receipt-deposit' || template === 'receipt-partial';
    const url = template === 'receipt'
      ? (payment?.receipt_token
        ? `https://qa.backuppowerpro.com/receipt.html?receipt=${encodeURIComponent(payment.receipt_token)}`
        : (invoice?.token ? `https://qa.backuppowerpro.com/receipt.html?token=${invoice.token}` : null))
      : isBalanceReceipt ? null
      : (proposal ? proposalUrl(proposal) : (invoice ? invoiceUrl(invoice) : null));
    const total = (proposal?.amount_cents || invoice?.amount_cents || 0) / 100;
    const firstName = (contact.name || '').trim().split(/\s+/)[0] || 'there';
    // Subjects mirror the email templates so the inbox preview reads
    // naturally - Key's voice, customer's first name, no corporate fluff.
    const SUBJECTS = {
      proposal:    `Your generator inlet quote from Backup Power Pro`,
      invoice:     `Invoice from Backup Power Pro`,
      receipt:     `Payment receipt from Backup Power Pro`,
      'receipt-deposit': `Deposit received, your install is booked`,
      'receipt-partial': `Payment received, your updated balance`,
      'refund-receipt': `Your refund from Backup Power Pro`,
      'ach-failed': `Your bank transfer did not clear, here's how to finish`,
      'permit-approved': `Permit approved, install scheduling next`,
      completion:  `You're all set, backup power confirmed`,
      review:      `Quick favor, Google review for Backup Power Pro?`,
    };
    const subject = SUBJECTS[template] || `Update from Backup Power Pro for ${firstName}`;
    const variables = {
      [`${template}_url`]: url,
      total: '$' + total.toLocaleString(),
      amp_type: proposal?.amp_type || '30',
      first_name: firstName,
    };
    // Prefer the server-assigned public number. Historical documents retain a
    // short legacy reference without altering their stored bytes.
    if (template === 'invoice' && invoice) {
      variables.invoice_num = invoice.document_number || (invoice.id || '').slice(0, 8).toUpperCase();
      // Balance-aware total: once money is in (paid_cents > 0, cumulative net
      // of refunds, loaded in crm-data.js), the invoice email's "Pay {{total}}
      // securely" carries the REMAINING balance, never the full job price
      // again. A deposit-paid customer must never open an email demanding the
      // entire amount. Same clamp the balance receipts below use.
      const totalC = invoice.amount_cents || 0;
      const paidC = Math.min(invoice.paid_cents || 0, totalC);
      if (paidC > 0) {
        const fmtC = c => '$' + (Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        variables.total = fmtC(Math.max(0, totalC - paidC));
      }
    }
    if (template === 'proposal' && proposal) variables.quote_num = proposal.document_number || (proposal.id || '').slice(0, 8).toUpperCase();
    // Receipt-specific facts the receipt template binds. Derived from the
    // invoice row exactly as receipt-comp.html does, so the email matches the
    // view page (receipt number = first 8 of the id, uppercased).
    if (template === 'receipt' && invoice) {
      const receiptToken = payment?.receipt_token ? String(payment.receipt_token).replace(/-/g, '') : '';
      variables.receipt_num = payment?.document_number || (receiptToken
        ? receiptToken.slice(0, 8).toUpperCase()
        : (invoice.id || '').slice(0, 8).toUpperCase());
      variables.paid_date = payment?.received_at
        ? formatDate(payment.received_at, { month:'long', day:'numeric', year:'numeric' })
        : (invoice.paid_at ? formatDate(invoice.paid_at, { month:'long', day:'numeric', year:'numeric' }) : '');
      variables.payment_method = payment?.method || invoice.payment_method || '';
      variables.receipt_url = url || '';
      if (payment) {
        const paymentC = Math.round((Number(payment.amount) || 0) * 100);
        const remaining = payment.remaining_after != null
          ? Number(payment.remaining_after)
          : Math.max(0, ((invoice.amount_cents || 0) - (invoice.paid_cents || 0)) / 100);
        variables.total = '$' + (paymentC / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        variables.balance_remaining = '$' + Number(remaining).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      } else {
        const remainingC = Math.max(0, (invoice.amount_cents || 0) - (invoice.paid_cents || 0));
        variables.balance_remaining = '$' + (remainingC / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      }
    }
    // Deposit/partial receipts show the HONEST remaining balance, never $0.
    // All numbers come from the invoice aggregate: amount_cents (job total) and
    // paid_cents (cumulative collected, net of refunds, loaded in crm-data.js).
    // balance_remaining = total - paid, clamped >=0. These invoices are not
    // fully 'paid' so paid_at is null; date the receipt today (the send date).
    if (isBalanceReceipt && invoice) {
      const totalC = invoice.amount_cents || 0;
      const paidC = Math.min(invoice.paid_cents || 0, totalC);
      const balC = Math.max(0, totalC - paidC);
      const fmtC = c => '$' + (Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      variables.total = fmtC(totalC);
      variables.amount_paid = fmtC(paidC);
      variables.paid_to_date = fmtC(paidC);
      variables.balance_remaining = fmtC(balC);
      variables.receipt_num = invoice.document_number || (invoice.id || '').slice(0, 8).toUpperCase();
      variables.paid_date = formatDate(invoice.paid_at || new Date().toISOString(), { month:'long', day:'numeric', year:'numeric' });
      variables.payment_method = invoice.payment_method || '';
    }
    // Refund-receipt facts. refund_amount = sum of refunds across this invoice's
    // payments; net_paid = job total minus refunds; method from the invoice's
    // payment_method (a LIVE column the webhook sets, so no parked column needed).
    // Refund date = the send date (today). The fn already issued the Stripe refund;
    // this email is the record Key sends after.
    if (template === 'refund-receipt' && invoice) {
      const totalC = invoice.amount_cents || 0;
      const refundedC = (invoice.payments || []).reduce((s, p) => s + Math.round((Number(p.refunded_amount) || 0) * 100), 0);
      const netC = Math.max(0, totalC - refundedC);
      const fmtC = c => '$' + (Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      variables.refund_amount = fmtC(refundedC);
      variables.net_paid = fmtC(netC);
      variables.total = fmtC(totalC);
      variables.refund_date = formatDate(new Date().toISOString(), { month: 'long', day: 'numeric', year: 'numeric' });
      variables.refund_method = /bank/i.test(invoice.payment_method || '') ? 'bank account' : 'card';
    }
    // ACH-failed retry facts. amount = the balance still due on this invoice;
    // retry_url = the invoice payment link (url, computed above for non-receipt
    // templates). Key sends this after the webhook flips the ACH row to 'failed'.
    if (template === 'ach-failed' && invoice) {
      const totalC = invoice.amount_cents || 0;
      const paidC = Math.min(invoice.paid_cents || 0, totalC);
      const dueC = Math.max(0, totalC - paidC);
      const fmtC = c => '$' + (Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      variables.amount = fmtC(dueC);
      variables.retry_url = url || invoiceUrl(invoice) || '';
    }
    const currentPayload = { template, contact_id, subject, variables, trigger_source: 'crm_v3_finance_action' };
    const emailIntent = __manualEmailIntentIdentity({ ...currentPayload, to_email: contact.email });
    const sendPayload = await __manualEmailRememberedPayload(emailIntent) || currentPayload;
    const sendVariables = sendPayload.variables || {};
    const sendUrl = sendVariables[`${template}_url`] || sendVariables.certificate_url || sendVariables.invoice_url || sendVariables.receipt_url || null;
    // #202 preview: show Key exactly what is going out, then send only on
    // confirm. Recipient + real subject + amount + doc number catch the
    // catastrophic mistakes (wrong email, wrong amount, wrong document); the
    // link opens the customer page the email mirrors for a full-content check.
    const TPL_LABEL = {
      proposal: 'quote', invoice: 'invoice', receipt: 'payment receipt',
      'receipt-deposit': 'deposit receipt', 'receipt-partial': 'balance receipt',
      'refund-receipt': 'refund receipt', 'ach-failed': 'bank-transfer retry notice',
      'permit-approved': 'permit-approved note', completion: 'completion note', review: 'review request',
    };
    const isRefundReceipt = template === 'refund-receipt';
    const isAchFailed = template === 'ach-failed';
    const docNum = sendVariables.invoice_num || sendVariables.quote_num || sendVariables.receipt_num || null;
    const amountLabel = isRefundReceipt ? 'Refund' : isAchFailed ? 'Due' : isBalanceReceipt ? 'Balance' : 'Amount';
    // 'invoice' routes through variables.total, not a fresh total computation,
    // so the confirm modal's Amount row matches the same balance-aware value
    // the outbound email carries (variables.total is the remaining balance
    // once paid_cents > 0, the full total otherwise). The number Key confirms
    // must be the number the customer reads.
    const amountVal = isRefundReceipt ? sendVariables.refund_amount
      : isAchFailed ? sendVariables.amount
      : isBalanceReceipt ? sendVariables.balance_remaining
      : template === 'receipt' ? sendVariables.total
      : template === 'invoice' ? sendVariables.total
      : (total ? '$' + total.toLocaleString() : null);
    // #202 durable half: fetch the exact rendered email HTML via dry_run
    // (never sends via Resend, never logs to messages_email, read-only
    // diagnostics) so Key can open the real email body in a new tab before
    // confirming, not just the metadata box below. Best-effort: if the
    // dry-run call fails, the preview still shows without the HTML link
    // rather than blocking the whole send flow.
    let emailPreviewUrl = null;
    let dryRunWarning = null;
    try {
      const { data: dry } = await CRM.__invokeFn('send-email', {
        body: { ...sendPayload, dry_run: true },
      });
      if (dry?.html) {
        emailPreviewUrl = URL.createObjectURL(new Blob([dry.html], { type: 'text/html' }));
      }
      if (dry?.would_block) {
        dryRunWarning = dry.sample_hit
          ? `This email still contains sample data ("${dry.sample_hit}") and would be REFUSED on send.`
          : `This email has unresolved placeholders (${(dry.unresolved_placeholders || []).slice(0, 3).join(', ')}) and would be REFUSED on send.`;
      }
    } catch (_) { /* dry-run is a preview enhancement, never blocks the send flow */ }
    const pvLabel = { fontSize:11, fontWeight:700, color:MUTED, minWidth:54, textTransform:'uppercase', letterSpacing:'0.04em', flexShrink:0 };
    const pvVal = { fontSize:13, color:NAVY, wordBreak:'break-word' };
    const safePagePreviewUrl = operatorDocumentPreviewUrl(sendUrl);
    const previewBody = (
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ fontSize:12.5, color:MUTED, lineHeight:1.45 }}>Review before it sends. This goes out by email via Resend.</div>
        {dryRunWarning && <div style={{ background:'#FDEEEE', border:'1px solid #F2C4C1', borderRadius:8, padding:'8px 10px', fontSize:12, color:'#8A241D', lineHeight:1.4 }}>{dryRunWarning}</div>}
        <div style={{ background:'#F8F8F6', border:'1px solid #EBEBEA', borderRadius:8, padding:'10px 12px', display:'flex', flexDirection:'column', gap:7 }}>
          <div style={{ display:'flex', gap:8 }}><span style={pvLabel}>To</span><span style={{ ...pvVal, fontWeight:600 }}>{contact.email}</span></div>
          <div style={{ display:'flex', gap:8 }}><span style={pvLabel}>Subject</span><span style={pvVal}>{sendPayload.subject}</span></div>
          {amountVal && <div style={{ display:'flex', gap:8 }}><span style={pvLabel}>{amountLabel}</span><span style={{ ...pvVal, fontFamily:"'JetBrains Mono','DM Mono',monospace" }}>{amountVal}</span></div>}
          {docNum && <div style={{ display:'flex', gap:8 }}><span style={pvLabel}>Doc #</span><span style={{ ...pvVal, fontFamily:"'JetBrains Mono','DM Mono',monospace" }}>{docNum}</span></div>}
        </div>
        {emailPreviewUrl && <a href={emailPreviewUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:12.5, fontWeight:700, color:'#1e40af', textDecoration:'none' }}>Preview the exact email body ›</a>}
        {safePagePreviewUrl
          ? <a href={safePagePreviewUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:12.5, fontWeight:700, color:'#1e40af', textDecoration:'none' }}>Preview the page this email links to ›</a>
          : <div style={{ fontSize:12, color:MUTED }}>Record only. No customer page link.</div>}
      </div>
    );
    const ok = await window.confirmAction?.({
      title: `Send ${TPL_LABEL[template] || 'email'} to ${firstName}?`,
      body: previewBody,
      confirmLabel: 'Send email',
    });
    if (!ok) return;
    const dispatchAttempt = await __manualEmailAttempt(emailIntent, sendPayload);
    const { data, error } = await CRM.__invokeFn('send-email', {
      body: {
        ...dispatchAttempt.payload,
        idempotency_key: dispatchAttempt.key,
        manual_intent_key: dispatchAttempt.intentKey,
      },
    });
    if (error) {
      // Surface the real error body - supabase-js wraps non-2xx as a
      // generic "Edge Function returned a non-2xx status code" otherwise.
      let detail = error.message || 'unknown';
      try {
        const body = await error.context?.json?.();
        if (body?.error) detail = body.error + (body.need ? ` (needs: ${(body.need || []).join(', ')})` : '');
      } catch (_) {}
      window.showToast?.(`Email failed: ${detail}`);
      return;
    }
    if (data?.ok === false) {
      if (data.retry_same_intent !== true) __finishManualEmailAttempt(dispatchAttempt);
      window.showToast?.(`Email failed: ${data.error || 'send_failed'}`, { kind: 'error' });
      return;
    }
    if (data?.skipped) {
      __finishManualEmailAttempt(dispatchAttempt);
      // Plain-language, error-tone feedback so Key clearly sees the email did
      // NOT go out (the raw enum read as jargon; audit 2026-06-22). No em-dashes.
      const skipMsg = {
        dnc: 'Not sent, this contact is marked do not contact.',
        no_email_on_file: 'Not sent, no email address on file for this contact.',
        marketing_opt_out: 'Not sent, this contact opted out of marketing emails.',
      }[data.skipped] || `Not sent: ${data.skipped}`;
      window.showToast?.(skipMsg, { kind: 'error' });
      return;
    }
    if (data?.ok !== true || typeof data?.sent !== 'string' || !data.sent.trim()) {
      window.showToast?.('Email status is unclear. Retry the same send or reconcile it before creating another.', { kind: 'error' });
      return;
    }
    const promotion = await promoteDeliveredLink(sendUrl);
    __finishManualEmailAttempt(dispatchAttempt);
    // #213: send-email already logged this to messages_email; tell the open
    // thread to refetch so the internal "Email sent" note appears right away.
    window.dispatchEvent(new CustomEvent('crm-email-logged', { detail: { contact_id } }));
    if (!promotion.ok) {
      window.showToast?.(deliverySyncMessage('email'), { kind:'error', duration:4200 });
      return;
    }
    window.showToast?.(`Email sent to ${contact.email}`);
    } finally {
      sendingEmailRef.current = false;
      setSendingEmail(false);
    }
  };

  // remake-2 (approved comp, the .spill tint families): quiet tinted pills
  // instead of solid blocks. Draft gray, Sent blue, Viewed purple, legacy
  // unpaid signatures as Not accepted, Approved/Paid green,
  // Cancelled gray + struck. Red tint reserved for Overdue, the one state
  // where money is actually at risk. Status KEYS + labels unchanged (the
  // left-pane lens mirrors these labels; logic reads keys only).
  const FIN_PILL = {
    paid:      { bg:'#f0fdf4', color:'#16a34a', label:'Paid' },
    sent:      { bg:'#eff6ff', color:'#2563eb', label:'Sent' },
    viewed:    { bg:'#f5f3ff', color:'#7c3aed', label:'Viewed' },
    overdue:   { bg:'#fef2f2', color:'#991b1b', label:'Overdue' },
    approved:  { bg:'#f0fdf4', color:'#16a34a', label:'Approved' },
    signed:    { bg:'#fff8e1', color:'#8a5a00', label:'Not accepted' },
    approved_offline: { bg:'#f0fdf4', color:'#16a34a', label:'Offline approved' },
    accepted_offline: { bg:'#fff8e1', color:'#8a5a00', label:'Not accepted' },
    declined:  { bg:'#f3f4f6', color:'#6b7280', label:'Cancelled', struck:true },
    // Some legacy v1/v2 rows write `cancelled` instead of `declined`
    // (proposals) or `voided` (invoices). Treat them as the same surface
    // so 11 production records stop rendering as gray "Draft".
    cancelled: { bg:'#f3f4f6', color:'#6b7280', label:'Cancelled', struck:true },
    voided:    { bg:'#f3f4f6', color:'#6b7280', label:'Voided' },
    refunded:  { bg:'#f3f4f6', color:'#6b7280', label:'Refunded' },
    expired:   { bg:'#f3f4f6', color:'#6b7280', label:'Expired' },
    replaced:  { bg:'#f3f4f6', color:'#6b7280', label:'Replaced', struck:true },
    draft:     { bg:'#f3f4f6', color:'#6b7280', label:'Draft' },
  };
  const Pill = ({ status }) => {
    const p = FIN_PILL[status] || FIN_PILL.draft;
    return <span style={{
      background:p.bg, color:p.color, height:22, padding:'0 9px', borderRadius:100,
      fontSize:11, fontWeight:700, display:'inline-flex', alignItems:'center',
      whiteSpace:'nowrap', flexShrink:0, textDecoration: p.struck ? 'line-through' : 'none',
    }}>{p.label}</span>;
  };

  const Eyebrow = ({ children }) => (
    <div style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.06em', marginTop:14, marginBottom:8 }}>{children}</div>
  );

  const fmtShort = iso => iso ? formatDate(iso, { month:'short', day:'numeric' }) : null;
  // Trim before split-or-default so a name of "  " doesn't render
  // "Hey , here's your quote" - guards against whitespace-only DB rows.
  const firstName = ((contact.name || '').trim().split(/\s+/)[0] || 'there');

  // Both proposal.html and invoice.html parse `?token=<uuid>` from the query
  // string - verified against proposal.html:403 and invoice.html:189.
  const proposalUrl = (p) => p?.token && !p.superseded_at && !p.superseded_by
    ? `https://qa.backuppowerpro.com/proposal.html?token=${p.token}`
    : null;
  const invoiceUrl  = (i) => i?.token ? `https://qa.backuppowerpro.com/invoice.html?token=${i.token}`  : null;
  const proposalHasFirmFacts = (p) => window.CRM?.proposalHasFirmFacts
    ? window.CRM.proposalHasFirmFacts(p)
    : false;

  const propActivity = p => {
    const verbByStatus = { approved:'Approved', signed:'Signed', declined:'Declined', sent:null, viewed:null, draft:null };
    const respondedVerb = verbByStatus[p.status];
    const parts = [];
    if (p.sent_at)     parts.push(`Sent ${fmtShort(p.sent_at)}`);
    if (p.viewed_at)   parts.push(`Viewed ${fmtShort(p.viewed_at)}`);
    if (respondedVerb && p.approved_at) parts.push(`${respondedVerb} ${fmtShort(p.approved_at)}`);
    return parts.join(' → ');
  };
  const invActivity = i => {
    const parts = [];
    if (i.sent_at)   parts.push(`Sent ${fmtShort(i.sent_at)}`);
    if (i.viewed_at) parts.push(`Viewed ${fmtShort(i.viewed_at)}`);
    if (i.paid_at)   parts.push(`Paid ${fmtShort(i.paid_at)}`);
    return parts.join(' → ');
  };

  const SendIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  );
  const CopyIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
  const EyeIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  );

  // sendingRef prevents double-fire on rapid taps. The idempotency key uses
  // the linkUrl + contact.id (NOT Date.now()), so even if the click DOES land
  // twice, the server de-dupes the SMS.
  // Lock keyed by contact-id + URL - prevents the rare-but-real case where
  // two contacts share a token (data bug or migration race) from one
  // accidentally suppressing the other's send.
  const sendingRef = React.useRef(new Set());
  const promoteDeliveredLink = async (linkUrl) => {
    const tokenMatch = String(linkUrl).match(/[?&]token=([0-9a-f-]{8,})/i);
    const token = tokenMatch?.[1];
    const kind = linkUrl.includes('/invoice.html') ? 'invoice' : linkUrl.includes('/proposal.html') ? 'proposal' : null;
    if (!token || !kind) return { ok:true, changed:false, row:null };
    const collection = kind === 'proposal' ? (CRM.proposals || []) : (CRM.invoices || []);
    const live = collection.find(row => row.token === token) || null;
    const result = await promoteDocumentAfterDelivery({
      db: CRM.__db,
      kind,
      token,
      currentStatus: live?.status,
      testMode: CRM.__testMode === true,
    });
    if (result.ok && result.changed && live) {
      live.status = 'sent';
      live.sent_at = result.row?.sent_at || live.sent_at;
      if (kind === 'proposal') live.copied_at = result.row?.copied_at || live.copied_at;
      window.dispatchEvent(new CustomEvent('crm-data-changed'));
    }
    return result;
  };
  // depositAsk: a Signed (awaiting deposit) proposal sends deposit-chase copy
  // instead of the generic update line (#114). Same link, same dedupe, the
  // promote-to-Sent block below cannot touch it (status guard excludes Signed).
  const sendLink = async (linkUrl, depositAsk = false, proposal = null) => {
    if (proposal?.superseded_at || proposal?.superseded_by) {
      window.showToast?.('This proposal was replaced. Use the current proposal.');
      return;
    }
    // Guard: a draft proposal or invoice that hasn't been issued a token
    // yet has linkUrl=null. Sending "null" as a URL would deliver the
    // literal word to the customer. Refuse + tell Key why.
    if (!linkUrl) {
      window.showToast?.('No link yet, save the draft first');
      return;
    }
    if (proposal && !proposalHasFirmFacts(proposal)) {
      window.showToast?.('Confirm amperage and run distance before sending this proposal');
      return;
    }
    const lockKey = `${contact.id}::${linkUrl}`;
    if (contact.do_not_contact) {
      window.showToast?.('Marked do not contact, cannot send');
      return;
    }
    if (!CRM.__invokeFn) {
      window.showToast?.('Supabase not loaded');
      return;
    }
    if (sendingRef.current.has(lockKey)) return;
    sendingRef.current.add(lockKey);
    const body = depositAsk
      ? `Here's the deposit link for your signed proposal from Backup Power Pro: ${linkUrl}`
      : `Here's your update from Backup Power Pro: ${linkUrl}`;
    const linkKind = linkUrl.includes('/invoice.html') ? 'inv' : linkUrl.includes('/proposal.html') ? 'prop' : 'link';
    window.showToast?.(`Sending to ${firstName}…`);
    try {
      const sent = await sendManualSmsWithReceipt({
        invoke: CRM.__invokeFn,
        scope: linkKind === 'inv' ? 'invoice-link' : linkKind === 'prop' ? 'proposal-link' : 'money-link',
        contactId: contact.id,
        body,
        semanticId: proposal?.id || linkKind,
        testMode: CRM.__testMode === true,
      });
      if (!sent.ok) {
        window.showToast?.(sent.error, { kind:'error', duration:4200 });
        return;
      }
      const promotion = await promoteDeliveredLink(linkUrl);
      if (!promotion.ok) {
        window.showToast?.(`${firstName}, ${deliverySyncMessage('sms')}`, { kind:'error', duration:4200 });
        return;
      }
      window.showToast?.(`SMS sent to ${firstName}`);
    } finally {
      // Release the lock after 2s so a second click within that window
      // is silently ignored.
      setTimeout(() => sendingRef.current.delete(lockKey), 2000);
    }
  };
  const copyLink = async (linkUrl, proposal = null) => {
    if (proposal?.superseded_at || proposal?.superseded_by) {
      window.showToast?.('This proposal was replaced. Use the current proposal.');
      return;
    }
    if (!linkUrl) { window.showToast?.('No link yet, save the draft first'); return; }
    if (proposal && !proposalHasFirmFacts(proposal)) {
      window.showToast?.('Confirm amperage and run distance before copying this proposal');
      return;
    }
    const ok = await window.copyText(linkUrl);
    if (!ok) {
      window.showToast?.('Copy failed');
      return;
    }
    // 2026-05-26: stamp copied_at + sent_at + flip to 'Sent' status when
    // Key copies a draft proposal link, because the act of copying means
    // he's about to paste it to the customer via iMessage/email/etc.
    // Without this, every proposal sent via Copy stayed in 'Created'
    // (draft) - rotting signal silent, no follow-up reminders, no audit
    // trail of who got which quote. The Send button does the same DB
    // updates AND fires Twilio; Copy does the same DB updates without
    // the Twilio fire so Key can use any channel.
    const promotion = await promoteDeliveredLink(linkUrl);
    if (!promotion.ok) {
      window.showToast?.(deliverySyncMessage('clipboard'), { kind:'error', duration:4200 });
      return;
    }
    window.showToast?.('Link copied');
  };
  const viewAsCustomer = (linkUrl) => {
    if (!linkUrl) { window.showToast?.('No link yet, save the draft first'); return; }
    // 2026-05-26: append ?preview=1 so:
    //   (a) the "PREVIEW MODE" watermark + top banner render
    //   (b) trackView() does NOT fire - Key's own view shouldn't
    //       increment view_count or stamp viewed_at, otherwise the
    //       Hot Pipeline / Viewed-no-sign lenses become lies the
    //       moment Key checks his own work.
    const sep = linkUrl.includes('?') ? '&' : '?';
    window.open(linkUrl + sep + 'preview=1', '_blank', 'noopener,noreferrer');
  };

  const FinanceRow = ({ left, money, status, pillStatus, activity, linkUrl, proposal, paymentReceipts, onRecordReversal, onEmailPaymentReceipt, onMarkPaid, onOfflineApprove, onCancel, onVoid, onEdit, onDelete, onEmail, onRevive, onRefund, divided, kind = 'head', paidDate }) => {
    // 40px on touch (Apple HIG = 44; 40 keeps the row visually compact
    // while staying above the "frustration threshold" Material flags at
    // 48px). Cursor-driven desktop is fine at 32 - but the inline style
    // doesn't have a media query, so we pick a single accommodating size.
    // Status-aware button gating. Send/Copy must NEVER appear once the
    // doc is finalized (paid invoice, approved proposal, voided/declined
    // anything) - re-sending an approved Premium+ proposal looks
    // unprofessional and confuses the customer. View link still shows
    // for everything except voided/refunded so Key can re-open the
    // customer's view.
    // Legacy Signed deposit rows are closed to Send. Their old authorization
    // cannot be reused, and the customer page stays fail closed until audit/reset.
    const FINAL_PROPOSAL = ['signed', 'approved', 'declined', 'expired', 'replaced'];
    // 'cancelled' = legacy v1 word for a killed invoice (and a cancelled proposal);
    // treat it as a closed/final state so a cancelled row never offers Send/Copy/View.
    const FINAL_INVOICE = ['paid', 'voided', 'refunded', 'cancelled'];
    const isProposal = !FIN_PILL[status] || ['draft','sent','viewed','signed','approved','declined','expired'].includes(status);
    // Loose heuristic: presence of `kind` field would indicate invoice,
    // but we only have status - use the strict invoice-only set check.
    const isFinalInvoice = FINAL_INVOICE.includes(status);
    const isFinalProposal = FINAL_PROPOSAL.includes(status);
    const showSend = !isFinalInvoice && !isFinalProposal;
    const showCopy = !['voided','refunded','cancelled','replaced'].includes(status);
    const showView = !['voided','refunded','cancelled','replaced'].includes(status);
    // CRM revamp 2026-06-10 (validated crm-finance-row.html): collapse the
    // old two button rows (up to 7 ghosts) into ONE primary action + a "⋯"
    // overflow menu, all on the header row. Same handlers + guards, fewer
    // competing signals; the next money action is unmistakable.
    // 2026-07-04 audit: the primary button always renders navy (primaryBtn
    // hardcodes it, correctly per the one-gold-per-screen rule). The old
    // tone:'good'/'gold' keys were dead + misleading, so they are dropped , the
    // code now states the truth. Overflow items keep their tones (the menu
    // renderer reads them).
    const primary = onMarkPaid
      ? { label:'Mark paid', onClick:onMarkPaid }
      : (showSend && linkUrl)
          ? { label:'Send', onClick:() => sendLink(linkUrl, false, proposal), icon:SendIcon }
          : null;
    const confirmThen = (cfg, fn) => async () => { const ok = await window.confirmAction?.(cfg); if (ok) fn(); };
    const overflowItems = [
      // When Mark paid takes the primary slot (an unpaid invoice), Send got
      // displaced , keep the SMS-resend reachable here so Key can still re-text
      // an unpaid invoice's link, exactly like the old two-row layout offered.
      (showSend && linkUrl && onMarkPaid) && { label:'Send link', onClick:() => sendLink(linkUrl, false, proposal) },
      (showCopy && linkUrl) && { label:'Copy link', onClick:() => copyLink(linkUrl, proposal) },
      (showView && linkUrl) && { label:'View as customer', onClick:() => viewAsCustomer(linkUrl) },
      ...(paymentReceipts || []).map(payment => ({
        label:`Open ${formatMoneyCents(Math.round(Number(payment.amount || 0) * 100))} payment receipt`,
        onClick:() => {
          const receiptUrl = `https://qa.backuppowerpro.com/receipt.html?receipt=${encodeURIComponent(payment.receipt_token)}`;
          window.open(operatorDocumentPreviewUrl(receiptUrl), '_blank', 'noopener,noreferrer');
        },
      })),
      ...(paymentReceipts || []).map(payment => ({
        label:`Copy ${formatMoneyCents(Math.round(Number(payment.amount || 0) * 100))} payment receipt link`,
        onClick:async () => {
          const receiptUrl = `https://qa.backuppowerpro.com/receipt.html?receipt=${encodeURIComponent(payment.receipt_token)}`;
          const copied = await window.copyText(receiptUrl);
          window.showToast?.(copied ? 'Payment receipt link copied' : 'Copy failed');
        },
      })),
      ...(paymentReceipts || []).map(payment => ({
        label:`Email ${formatMoneyCents(Math.round(Number(payment.amount || 0) * 100))} payment receipt`,
        onClick:() => onEmailPaymentReceipt?.(payment),
      })),
      ...(paymentReceipts || []).filter(payment => payment.record_source === 'operator_recorded'
        && Number(payment.amount || 0) - Number(payment.refunded_amount || 0) > 0.005)
        .map(payment => ({
          label:`Record reversal for ${formatMoneyCents(Math.round(Number(payment.amount || 0) * 100))} payment`,
          tone:'danger', onClick:() => onRecordReversal?.(payment),
        })),
      onEmail && { label: sendingEmail ? 'Sending…' : 'Email', onClick:onEmail, disabled: sendingEmail },
      onOfflineApprove && { label:'Record customer approval', onClick:onOfflineApprove },
      onEdit && { label:'Edit', onClick:onEdit },
      onRevive && { label:'Revive', onClick:onRevive, tone:'good' },
      (onCancel || onVoid || onRefund || onDelete) && { divider:true },
      onCancel && { label:'Cancel proposal', tone:'danger', onClick: confirmThen({ title:'Cancel this proposal?', body:'The customer\'s link will show "Cancelled". You can undo within 5 seconds.', confirmLabel:'Cancel proposal', destructive:true }, onCancel) },
      onVoid && { label:'Void invoice', tone:'danger', onClick: confirmThen({ title:'Void this invoice?', body:'The customer\'s link will show "Voided". Invoices with collected funds cannot be voided.', confirmLabel:'Void invoice', destructive:true }, onVoid) },
      // Refund opens the RefundPanel (amount + 6-digit 2FA before any money returns),
      // so no pre-confirm here, the panel IS the gate.
      onRefund && { label:'Refund payment', tone:'danger', onClick: onRefund },
      onDelete && { label:'Delete', tone:'danger', onClick:onDelete },
    ].filter(Boolean);
    // remake-2 (approved comp): two row shapes inside the DealCard shell.
    //   head (.deal-head): proposal tier 15px/700 + JetBrains Mono 15px money
    //     + tint pill on ONE line; the sent→viewed chain as a quiet 12px note
    //     below; the single primary action right-aligned in a foot line.
    //   inv (.inv-row): indented one line, kind 13px/600 muted + 13px mono
    //     money + tint pill + 11px mono paid date. Cancelled-family money is
    //     struck. Handlers + gating logic untouched.
    const dead = ['declined', 'cancelled', 'voided', 'refunded'].includes(status);
    const moneyStyle = (size) => ({
      fontFamily:"'JetBrains Mono', monospace", fontSize:size, fontWeight:600,
      color: dead ? '#8a93a6' : NAVY, fontVariantNumeric:'tabular-nums', flexShrink:0,
      textDecoration: dead ? 'line-through' : 'none',
    });
    // green = paid (Key's rule): the "Mark paid" success action renders green to
    // match crm-left's Mark paid; Send-type primaries stay navy secondary so the
    // screen's one gold (the top "+ New proposal") is never challenged.
    const isPaidAction = primary && primary.label === 'Mark paid';
    const primaryBtn = primary && (
      <button onClick={primary.onClick} aria-label={primary.label}
        style={{ height:44, padding:'0 18px', borderRadius:100, flexShrink:0,
          background: isPaidAction ? '#10b981' : NAVY, color:'white', border:'none',
          fontSize:13, fontWeight:700, fontFamily:'inherit', cursor:'pointer', whiteSpace:'nowrap',
          display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6 }}>
        {primary.icon}{primary.label}
      </button>
    );
    if (kind === 'inv') {
      return (
        <div style={{
          minHeight:48, padding:'4px 14px 4px 28px',
          borderTop: divided ? '1px solid rgba(27,43,75,0.08)' : 'none',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <span style={{ flex:1, minWidth:0, fontSize:13, fontWeight:600, color:'#5a6478', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{left}</span>
          <span style={moneyStyle(13)}>{money}</span>
          <Pill status={pillStatus || status} />
          {paidDate && <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:11, color:'#8a93a6', flexShrink:0 }}>{paidDate}</span>}
          {primaryBtn}
          <FinanceOverflowMenu items={overflowItems} />
        </div>
      );
    }
    return (
      // FinanceRow is always rendered inside DealCard which already provides
      // the white bg + border + radius; rows separate with a hairline top
      // divider via the `divided` prop.
      <div style={{
        padding:'14px 14px 12px',
        borderTop: divided ? '1px solid rgba(27,43,75,0.08)' : 'none',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
          <span style={{ flex:1, minWidth:0, fontSize:15, fontWeight:700, color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{left}</span>
          <span style={moneyStyle(15)}>{money}</span>
          <Pill status={pillStatus || status} />
          <FinanceOverflowMenu items={overflowItems} />
        </div>
        {activity && (
          <div style={{ marginTop:6, fontSize:12, color:'#8a93a6', fontFamily:"'DM Mono', monospace", whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{activity}</div>
        )}
        {primaryBtn && (
          <div style={{ display:'flex', justifyContent:'flex-end', marginTop:10 }}>
            {primaryBtn}
          </div>
        )}
      </div>
    );
  };

  // Group every proposal with its invoices into one DealCard. Invoices
  // that don't reference a proposal (legacy / standalone billing) get
  // their own card so they stay visible. The deal-lifecycle box evolves:
  //   compose → sent → viewed → approved → invoiced → paid
  // ...all inside the SAME card. No popups, no context-switch.
  const sortedProposals = [...proposals].sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
  const dealCards = sortedProposals.map(p => ({
    key: 'p-' + p.id,
    proposal: p,
    invoices: sortedInvoices.filter(i => i.proposal_id === p.id),
  }));
  const orphanInvoices = sortedInvoices.filter(i => !i.proposal_id);
  for (const i of orphanInvoices) {
    dealCards.push({ key: 'i-' + i.id, proposal: null, invoices: [i] });
  }

  // Per-DealCard "compose invoice" toggle (key = proposal.id). Lives at
  // the parent so realtime updates don't reset the open/closed state.
  const [composeInvoiceFor, setComposeInvoiceFor] = React.useState(null);
  // Per-DealCard charge-card panel (#115), same lifetime rationale.
  const [chargeCardFor, setChargeCardFor] = React.useState(null);
  // The specific completed payment the operator is refunding (opens RefundPanel).
  const [refundFor, setRefundFor] = React.useState(null);
  const manualReversalInFlight = React.useRef(new Set());

  const recordManualReversal = async (payment) => {
    if (manualReversalInFlight.current.has(payment.id)) return;
    const available = Math.max(0, Number(payment.amount || 0) - Number(payment.refunded_amount || 0));
    const amount = Number(window.prompt(`Amount already reversed outside BPP, up to $${available.toFixed(2)}`));
    if (!(amount > 0) || amount > available + 0.005) { window.showToast?.('Enter a valid reversal amount'); return; }
    const reason = String(window.prompt('Reason for the reversal') || '').trim();
    if (reason.length < 3) { window.showToast?.('A reason is required'); return; }
    const externalReference = String(window.prompt('External reference, optional') || '').trim();
    const confirmed = await window.confirmAction?.({
      title:'Confirm external reversal',
      body:'Confirm the cash return, check cancellation, or external card refund was already completed. BPP will only record it.',
      confirmLabel:'Record reversal', destructive:true,
    });
    if (!confirmed) return;
    const semantic = JSON.stringify([payment.id, amount, reason, externalReference]);
    const storageKey = `bpp-payment-adjustment:${semantic}`;
    let key = null;
    try { key = localStorage.getItem(storageKey); } catch (_) {}
    if (!key) {
      key = crypto.randomUUID();
      try { localStorage.setItem(storageKey, key); } catch (_) {}
    }
    manualReversalInFlight.current.add(payment.id);
    try {
      const { data, error } = await CRM.__invokeFn('record-payment', { body: {
        action:'adjust_payment', payment_id:payment.id, amount,
        adjustment_type:'reversal', reason, external_reference:externalReference || null,
        external_action_confirmed:true, idempotency_key:key,
      } });
      if (error || !data?.ok) { window.showToast?.(`Reversal failed: ${error?.message || data?.error || 'unknown'}`); return; }
      try { localStorage.removeItem(storageKey); } catch (_) {}
      window.dispatchEvent(new CustomEvent('crm-data-changed'));
      window.showToast?.('Payment reversal recorded');
    } finally {
      manualReversalInFlight.current.delete(payment.id);
    }
  };

  const DealCard = ({ proposal, invoices, moneyManaged }) => {
    const proposalReplaced = !!(proposal?.superseded_at || proposal?.superseded_by);
    const showInvoiceComposer = proposal && composeInvoiceFor === proposal.id;
    // Approved proposal with no invoice yet → surface "Generate invoice"
    // CTA right inside the card. Approved proposal that already has
    // invoices but isn't fully invoiced → smaller secondary trigger.
    const billedSum = invoices
      .filter(i => !['voided', 'refunded', 'draft', 'declined'].includes(i.status))
      .reduce((s,i) => s + (i.amount_cents || 0), 0);
    const propTotal = proposal?.amount_cents || 0;
    const fullyBilled = propTotal > 0 && billedSum >= propTotal;
    // When the Money Card manages this deal, IT is the collect surface (Record
    // payment). Suppress the old "Generate deposit/next invoice" CTA here so the
    // signed deal never shows competing money machinery (the 2026-06-12 scar).
    const canGenerateInvoice = proposal?.status === 'approved' && !proposalReplaced && !fullyBilled && !moneyManaged;

    return (
      <div data-card style={{
        // remake-2: comp .card shell, 12px radius, #e5e5e5 hairline edge.
        // overflow VISIBLE (not hidden): the FinanceOverflowMenu's absolute
        // dropdown ("..." -> Copy link / View as customer) was being clipped
        // by the card edge (Key 2026-06-12 "the menus are cut off"). No child
        // has a contrasting bg, so the 12px corners render fine without a clip.
        background:'white', border:'1px solid #e5e5e5', borderRadius:12,
        marginBottom:14, overflow:'visible',
      }}>
        {proposal && (
          <FinanceRow
            left={[proposal.document_number, tierLabel(proposal.tier)].filter(Boolean).join(' · ')}
            money={formatMoneyCents(proposal.amount_cents)}
            status={proposalReplaced ? 'replaced' : proposal.status}
            pillStatus={proposalReplaced ? 'replaced' : proposal.approval_source === 'operator_recorded'
              ? (proposal.status === 'approved' ? 'approved_offline' : (proposal.status === 'signed' ? 'accepted_offline' : proposal.status))
              : proposal.status}
            activity={propActivity(proposal)}
            linkUrl={proposalUrl(proposal)}
            proposal={proposal}
            onOfflineApprove={!proposalReplaced && proposal.require_deposit === false && ['sent','viewed'].includes(proposal.status) ? () => recordOfflineApproval(proposal) : null}
            onCancel={!proposalReplaced && (proposal.status === 'sent' || proposal.status === 'viewed') ? () => cancelProposal(proposal) : null}
            onRevive={!proposalReplaced && ['declined','cancelled','expired'].includes(proposal.status) ? () => reviveProposal(proposal) : null}
            onEdit={!proposalReplaced && ['draft','created'].includes(String(proposal.status || '').toLowerCase()) ? () => { setProposalModalOpen(false); setEditingProposalId(proposal.id); } : null}
            onDelete={!proposalReplaced && ['draft','created'].includes(String(proposal.status || '').toLowerCase()) ? () => deleteProposal(proposal) : null}
            // send-email is built + deployed; emailDoc gates each send behind
            // a Key-confirm modal and passes trigger_source crm_v3_*. Only
            // offer the button on a proposal that actually has a customer
            // link to send. Superseded gate is on the superseded_at COLUMN:
            // 'superseded' is never a status VALUE anywhere in this codebase
            // (superseding sets superseded_at and leaves status untouched),
            // so a status-array literal would let a replaced ghost draft
            // still be emailed to a customer as if it were live.
            onEmail={(proposalUrl(proposal) && proposalHasFirmFacts(proposal) && !proposalReplaced && !['declined','cancelled','expired'].includes(proposal.status)) ? () => emailDoc({ template: 'proposal', contact_id: contact.id, proposal }) : null}
          />
        )}

        {/* Approved → CTA to start the invoice composer right inside
            this card. Once clicked, the composer slides in below. */}
        {canGenerateInvoice && !showInvoiceComposer && (
          // remake-2 (approved comp, .deal-foot + .btn-deal): the card's one
          // primary money action is a right-aligned navy pill above a
          // hairline, not a full-width gold bar. Same onClick.
          <div style={{ display:'flex', justifyContent:'flex-end', padding:'10px 12px 12px', borderTop:'1px solid rgba(27,43,75,0.08)' }}>
            <button
              onClick={() => setComposeInvoiceFor(proposal.id)}
              style={{
                height:44, padding:'0 18px', borderRadius:100,
                background:NAVY, color:'white', border:'none',
                fontSize:13, fontWeight:700, fontFamily:'inherit', cursor:'pointer',
                display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6,
                whiteSpace:'nowrap',
              }}
            >
              {invoices.length === 0 ? 'Generate deposit invoice' : 'Generate next invoice'}
            </button>
          </div>
        )}

        {/* Inline invoice composer - renders inside the same card so the
            user stays in context. Once sent, the composer collapses and
            the new invoice row materialises below via realtime. */}
        {showInvoiceComposer && (
          <div style={{ padding:'0 14px 12px' }}>
            <NewInvoiceModal
              contact={contact}
              latestSignedProposal={proposal}
              invoices={invoices}
              onClose={() => setComposeInvoiceFor(null)}
              inline
            />
          </div>
        )}

        {/* Charge card on file (#115): approved proposal + saved card. The
            edge fns are NOT deployed yet; the panel fails closed with an
            honest toast until the Key-gated supervised session activates
            them. Ghost styling: rarer + heavier action than invoicing. */}
        {!moneyManaged && proposal?.status === 'approved' && contact.has_card_on_file && chargeCardFor !== proposal.id && (
          <div style={{ padding:'0 14px 12px' }}>
            <button
              onClick={() => setChargeCardFor(proposal.id)}
              style={{
                width:'100%', height:44, borderRadius:8,
                background:'transparent', color:NAVY, border:'1px solid rgba(11,31,59,0.20)',
                fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
              }}
            >
              Charge card on file{contact.card_last4 ? ` (${contact.card_brand || 'card'} ${contact.card_last4})` : ''}
            </button>
          </div>
        )}
        {proposal && chargeCardFor === proposal.id && (
          <div style={{ padding:'0 14px 12px' }}>
            <ChargeCardPanel contact={contact} proposal={proposal} onClose={() => setChargeCardFor(null)} />
          </div>
        )}

        {invoices.length > 0 && invoices.map(inv => (
          <FinanceRow
            key={inv.id}
            kind="inv"
            left={[inv.document_number, capitalize(inv.kind)].filter(Boolean).join(' · ')}
            money={formatMoneyCents(inv.amount_cents)}
            status={inv.status}
            activity={invActivity(inv)}
            paidDate={inv.paid_at ? fmtShort(inv.paid_at) : null}
            paymentReceipts={(inv.payments || []).filter(payment => payment.receipt_token && payment.status === 'completed')}
            onRecordReversal={recordManualReversal}
            onEmailPaymentReceipt={(payment) => emailDoc({ template:'receipt', contact_id:contact.id, invoice:inv, payment })}
            linkUrl={invoiceUrl(inv)}
            divided
            onMarkPaid={null}
            onVoid={['sent','viewed','overdue'].includes(inv.status) ? () => voidInvoice(inv) : null}
            onRevive={['voided','cancelled'].includes(inv.status) ? () => reviveInvoice(inv) : null}
            onRefund={(() => {
              // Only a PAID invoice with a completed, not-fully-refunded payment that
              // carries a proposal_id (the 2FA code is issued per proposal) can refund.
              if (inv.status !== 'paid') return null;
              const p = (inv.payments || []).find(pp => pp.status === 'completed' && pp.id && pp.proposal_id
                && ((Number(pp.amount) || 0) - (Number(pp.refunded_amount) || 0)) > 0.005);
              return p ? () => setRefundFor(p) : null;
            })()}
            onEdit={String(inv.status || '').toLowerCase() === 'draft' ? () => { setInvoiceModalOpen(false); setEditingInvoiceId(inv.id); } : null}
            onDelete={String(inv.status || '').toLowerCase() === 'draft' ? () => deleteInvoice(inv) : null}
            // send-email is built; emailDoc confirms with Key + passes
            // trigger_source crm_v3_*. Function 503s until RESEND_API_KEY set.
            // A PAID invoice gets a receipt instead of an invoice email (the
            // invoice email carries a Pay button, wrong for an already-paid
            // invoice). Drafts with no token offer no Email.
            onEmail={!invoiceUrl(inv) ? null : (inv.status === 'paid'
              ? (String(inv.creator_version || '').toLowerCase() === 'v4' ? null : () => emailDoc({ template:'receipt', contact_id:contact.id, invoice:inv }))
              : (['voided','refunded','cancelled'].includes(inv.status) ? null : () => emailDoc({ template:'invoice', contact_id:contact.id, invoice:inv })))}
          />
        ))}
        {refundFor && (
          <div style={{ padding:'0 14px 12px' }}>
            <RefundPanel payment={refundFor} onClose={() => setRefundFor(null)} />
          </div>
        )}
      </div>
    );
  };

  // ── MoneyCard wiring (2026-06-13): the primary post-sign deal becomes the
  // dead-simple money surface. Only an approved proposal reads as AMOUNT DUE
  // -> Record payment -> PAID; the document rows demote into "Documents" below.
  const isPostSign = s => String(s || '').toLowerCase() === 'approved';
  const primaryDeal = dealCards.find(d => d.proposal && isPostSign(d.proposal.status)) || null;
  const moneyProposal = primaryDeal?.proposal || null;
  const moneyInvoices = primaryDeal?.invoices || [];
  const paidInv = moneyInvoices.find(i => i.status === 'paid') || null;
  const liveInv = paidInv || moneyInvoices.find(i => !['voided', 'refunded', 'cancelled', 'draft'].includes(i.status)) || moneyInvoices[0] || null;
  const moneyPaid = !!paidInv;
  // Balance-aware due: a partial leaves the invoice unpaid (record-payment only
  // flips to 'paid' at full cover), so subtract paid-so-far (payments-ledger sum
  // net of refunds, loaded in crm-data.js as paid_cents) to show the REMAINING
  // balance, not the full price. PAID shows the full total. Clamped, never negative.
  // Frozen signed total wins over the live editable proposal total when there is
  // no invoice yet: signed_total is the number the customer authorized (and the
  // only one the off-session charge path accepts), while the live `total` can
  // drift after signing. Once an INVOICE exists it stays the collectible source
  // of truth (Key can intentionally edit it via editMoneyPrice), so it wins.
  const proposalBaseCents = (moneyProposal?.signed_total_cents != null)
    ? moneyProposal.signed_total_cents : (moneyProposal?.amount_cents || 0);
  const totalCents = (liveInv?.amount_cents) || proposalBaseCents || 0;
  const paidCents = Math.min(liveInv?.paid_cents || 0, totalCents);
  const remainingCents = moneyPaid ? 0 : Math.max(0, totalCents - paidCents);
  const dueAmount = Math.round(moneyPaid ? totalCents : remainingCents) / 100;
  const totalAmount = Math.round(totalCents) / 100;
  const paidAmount = Math.round(paidCents) / 100;
  const isPartial = !moneyPaid && paidCents > 0 && remainingCents > 0;
  const receiptUrl = liveInv?.token ? `https://qa.backuppowerpro.com/receipt.html?token=${liveInv.token}` : null;

  // Awaiting-deposit: a SIGNED (not Approved) deposit-required proposal with no
  // money in yet owes a deposit and is NOT booked. Surface it as "Deposit owed
  // $X / Send deposit link" instead of a plain "Amount due / Record payment", so a
  // signed-but-unpaid deal (Curtis) can never be mistaken for an approved-paid one.
  const mpRequireDeposit = moneyProposal ? (moneyProposal.require_deposit !== false) : false;
  const mpDepositRate = Number(moneyProposal?.deposit_rate) || 0.20;
  // Deposit is a % of the price the customer authorized at signing, so prefer
  // the frozen signed total (matches the figure proposal.html showed them).
  const mpFullCents = proposalBaseCents || totalCents || 0;
  // Round DOLLARS (not cents) so the operator's deposit figure matches what the
  // customer sees on proposal.html (Math.round(total*rate)); rounding cents gave
  // $313.40 vs the customer's $313 for the same 20% of $1,567.
  const depositDueCents = Math.round((mpFullCents / 100) * mpDepositRate) * 100;
  const isAwaitingDeposit = !!moneyProposal
    && String(moneyProposal.status || '').toLowerCase() === 'signed'
    && mpRequireDeposit && !moneyPaid && paidCents <= 0;

  // Record an external payment (cash/card-keyed/check/elsewhere) via the
  // record-payment edge fn. Never charges a card; reversible (void in Documents).
  const recordPaymentNow = async (amountDollars, method) => {
    if (!moneyProposal) return false;
    const methodApi = method;
    const attemptId = `${liveInv?.id || moneyProposal.id}:${amountDollars}:${methodApi}`;
    const storageKey = `bpp-payment:${attemptId}`;
    let attempt = null;
    try { attempt = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) {}
    if (!attempt) {
      attempt = {
        key: crypto.randomUUID ? crypto.randomUUID() : `payment_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        receivedAt: new Date().toISOString(),
      };
      try { localStorage.setItem(storageKey, JSON.stringify(attempt)); } catch (_) {}
    }
    try {
      const { data, error } = await CRM.__invokeFn('record-payment', {
        body: {
          proposal_id: moneyProposal.id, invoice_id: liveInv?.id || undefined,
          amount: amountDollars, method: methodApi,
          received_at: attempt.receivedAt, idempotency_key: attempt.key,
        },
      });
      if (error || (data && data.ok === false)) { window.showToast?.(`Record failed: ${error?.message || data?.error || 'unknown'}`); return false; }
      try { localStorage.removeItem(storageKey); } catch (_) {}
      window.showToast?.(`Recorded ${method} payment`);
      window.dispatchEvent(new CustomEvent('crm-data-changed'));
      return true;
    } catch (e) { window.showToast?.(`Record failed: ${e.message}`); return false; }
  };
  // Change the price being collected. The INVOICE total is the source of truth
  // the card reads (dueCents). When no invoice exists yet, lazily create one at
  // the new price, never write proposals.signed_total here: that is the frozen
  // number the off-session charge path authorizes against, and editing it could
  // mischarge a card. The signed terms stay locked; the invoice carries the
  // amount Key collects. Reversible (void the invoice in Documents).
  const editMoneyPrice = async (newDollars) => {
    // Defense-in-depth: never let the collectible total drop below money already
    // taken (would render a false "Amount due $0"). Compare against RAW
    // liveInv.paid_cents, not the Math.min-clamped paidCents, so the guard can
    // actually see an over-collected balance. money() is local to MoneyCard, so
    // the outer scope formats with the module-level formatMoneyCents.
    const rawPaidCents = liveInv?.paid_cents || 0;
    if (newDollars * 100 < rawPaidCents) {
      window.showToast?.('Price below amount already collected (' + formatMoneyCents(rawPaidCents) + '). Refund first.');
      return;
    }
    try {
      if (liveInv?.id) {
        const items = Array.isArray(liveInv.line_items) && liveInv.line_items.length
          ? liveInv.line_items.map((x, i) => i === 0 ? { ...x, amount: newDollars } : x)
          : [{ id: 'li_' + Math.random().toString(36).slice(2, 8), kind: 'item', name: 'Final balance', amount: newDollars, checked: true }];
        const semantic = JSON.stringify([liveInv.id, newDollars, items, liveInv.due_at || null, liveInv.payment_terms || 'Due upon receipt']);
        const storageKey = `bpp-draft-invoice-update:${semantic}`;
        let key = localStorage.getItem(storageKey);
        if (!key) { key = crypto.randomUUID(); localStorage.setItem(storageKey, key); }
        const { data, error } = await CRM.__invokeFn('record-payment', { body: {
          action: 'update_draft_invoice', invoice_id: liveInv.id,
          amount: newDollars, line_items: items, due_at: liveInv.due_at || null,
          payment_terms: liveInv.payment_terms || 'Due upon receipt', idempotency_key: key,
        } });
        if (error || !data?.ok) { window.showToast?.(`Price update refused: ${error?.message || data?.error || 'unknown'}`); return; }
        localStorage.removeItem(storageKey);
      } else if (moneyProposal?.id) {
        const { error } = await CRM.__db.from('invoices').insert({
          contact_id: contact.id,
          proposal_id: moneyProposal.id,
          contact_name: contact.name || null,
          contact_email: contact.email || null,
          contact_phone: contact.phone || null,
          contact_address: contact.address || null,
          line_items: [{ id: 'li_' + Math.random().toString(36).slice(2, 8), kind: 'item', name: 'Final balance', amount: newDollars, checked: true }],
          total: newDollars,
          status: 'unpaid',
          creator_version: 'v4',
        });
        if (error) { window.showToast?.(`Price update failed: ${error.message}`); return; }
      }
      window.showToast?.('Price updated');
      window.dispatchEvent(new CustomEvent('crm-data-changed'));
    } catch (e) { window.showToast?.(`Price update failed: ${e.message}`); }
  };
  const moneyOverflow = moneyProposal ? (moneyPaid
    ? [
        receiptUrl && { label: 'View receipt', onClick: () => viewAsCustomer(receiptUrl) },
        liveInv && { label: sendingEmail ? 'Sending…' : 'Resend receipt', onClick: () => emailDoc({ template: 'receipt', contact_id: contact.id, invoice: liveInv }), disabled: sendingEmail },
        // Refund receipt: only when this invoice carries a refund (a completed
        // payment with refunded_amount > 0). Key sends it after refund-payment runs.
        liveInv && (liveInv.payments || []).some(p => (Number(p.refunded_amount) || 0) > 0) && { label: sendingEmail ? 'Sending…' : 'Email refund receipt', onClick: () => emailDoc({ template: 'refund-receipt', contact_id: contact.id, invoice: liveInv }), disabled: sendingEmail },
      ].filter(Boolean)
    : [
        { label: 'View proposal', onClick: () => viewAsCustomer(proposalUrl(moneyProposal)) },
        liveInv && invoiceUrl(liveInv) && { label: 'Send payment link', onClick: () => sendLink(invoiceUrl(liveInv), false) },
        liveInv && invoiceUrl(liveInv) && { label: sendingEmail ? 'Sending…' : 'Email invoice', onClick: () => emailDoc({ template: 'invoice', contact_id: contact.id, invoice: liveInv }), disabled: sendingEmail },
        // Booking-tone deposit receipt, only once a deposit/partial is actually in
        // (isPartial = paid > 0 but balance remains). Shows the honest remaining balance.
        liveInv && isPartial && String(liveInv.creator_version || '').toLowerCase() !== 'v4' && { label: sendingEmail ? 'Sending…' : 'Send deposit receipt', onClick: () => emailDoc({ template: 'receipt-deposit', contact_id: contact.id, invoice: liveInv }), disabled: sendingEmail },
        // Bank-transfer retry: ONLY when this invoice has a status='failed' payment
        // (the webhook flips the ACH row to failed). Never offered otherwise, so it can
        // never tell a customer their transfer failed when none did.
        liveInv && invoiceUrl(liveInv) && (liveInv.payments || []).some(p => String(p.status || '').toLowerCase() === 'failed') && { label: sendingEmail ? 'Sending…' : 'Email bank-transfer retry', onClick: () => emailDoc({ template: 'ach-failed', contact_id: contact.id, invoice: liveInv }), disabled: sendingEmail },
      ].filter(Boolean)
  ) : [];

  return (
    <div style={{ flex:1, overflowY:'auto', minHeight:0, padding:'12px 16px var(--tabbar-clear, calc(env(safe-area-inset-bottom, 0px) + 92px))' }}>
      {/* Post-sign money surface: the one card Key acts on in the field. */}
      {moneyProposal && (
        <MoneyCard
          firstName={firstName}
          tierText={tierLabel(moneyProposal.tier)}
          dueAmount={dueAmount}
          totalAmount={totalAmount}
          paidAmount={paidAmount}
          partial={isPartial}
          signedWhen={moneyProposal.approved_at ? ('signed ' + fmtShort(moneyProposal.approved_at)) : 'signed'}
          paid={moneyPaid}
          paidMethod={liveInv?.payment_method || null}
          paidDate={liveInv?.paid_at ? fmtShort(liveInv.paid_at) : null}
          onRecord={recordPaymentNow}
          onEdit={!liveInv || String(liveInv.status || '').toLowerCase() === 'draft' ? editMoneyPrice : null}
          onSendReceipt={() => liveInv && emailDoc({ template: 'receipt', contact_id: contact.id, invoice: liveInv })}
          onSendPartialReceipt={liveInv && String(liveInv.creator_version || '').toLowerCase() !== 'v4'
            ? () => emailDoc({ template: 'receipt-partial', contact_id: contact.id, invoice: liveInv })
            : null}
          sending={sendingEmail}
          overflow={moneyOverflow}
          awaitingDeposit={isAwaitingDeposit}
          depositAmount={Math.round(depositDueCents) / 100}
          depositOfTotal={Math.round(mpFullCents) / 100}
          depositRate={mpDepositRate}
          onSendDepositLink={() => moneyProposal && sendLink(proposalUrl(moneyProposal), true, moneyProposal)}
        />
      )}
      {/* Top create buttons. Either creates a new inline composer at the
          top of the list - no modal overlay. + New invoice falls back to
          standalone invoice (no proposal link) if no approved proposal
          is in scope; if there IS one, the per-card "Generate invoice"
          button inside that DealCard is the better path. */}
      {!proposalModalOpen && !invoiceModalOpen && !receiptModalOpen && (
        <div style={{ display:'flex', gap:8, marginBottom:12 }}>
          <button onClick={() => { setInvoiceModalOpen(false); setReceiptModalOpen(false); setProposalModalOpen(true); }} style={{
            flex:1, height:44, borderRadius:8,
            background:GOLD, color:NAVY, border:'none',
            fontSize:13, fontWeight:700, fontFamily:'inherit', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          }}>+ New proposal</button>
          <button onClick={() => { setProposalModalOpen(false); setReceiptModalOpen(false); setInvoiceModalOpen(true); }} style={{
            flex:1, height:44, borderRadius:8,
            background:'white', color:NAVY, border:'1px solid rgba(11,31,59,0.15)',
            fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          }}>+ New invoice</button>
          <button onClick={() => { setProposalModalOpen(false); setInvoiceModalOpen(false); setReceiptModalOpen(true); }} style={{
            flex:1, height:44, borderRadius:8,
            background:'white', color:NAVY, border:'1px solid rgba(11,31,59,0.15)',
            fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          }}>+ New receipt</button>
        </div>
      )}

      {/* Inline proposal composer - sits at the top of the deal list. */}
      {proposalModalOpen && (
        <NewProposalModal contact={contact} onClose={() => setProposalModalOpen(false)} inline />
      )}

      {/* Inline standalone-invoice composer - for billing without a
          proposal on file. If there IS an approved proposal, the
          per-card Generate invoice button is the primary path. */}
      {invoiceModalOpen && (
        <NewInvoiceModal
          contact={contact}
          latestSignedProposal={proposals.find(p => p.status === 'approved')}
          invoices={invoices}
          onClose={() => setInvoiceModalOpen(false)}
          inline
        />
      )}

      {receiptModalOpen && (
        <NewInvoiceModal
          contact={contact}
          latestSignedProposal={null}
          invoices={invoices}
          onClose={() => setReceiptModalOpen(false)}
          inline
          receiptMode
        />
      )}

      {/* Documents: the proposal + invoice records. Demoted below the Money
          Card so the signed deal reads as AMOUNT DUE / PAID first, and the
          paperwork (send links, history) is one glance down, not in the way. */}
      {moneyProposal && dealCards.length > 0 && <Eyebrow>Documents</Eyebrow>}
      {dealCards.map(d => <DealCard key={d.key} proposal={d.proposal} invoices={d.invoices} moneyManaged={!!(moneyProposal && d.proposal && d.proposal.id === moneyProposal.id)} />)}

      {/* Edit modals - mounted at this level so they overlay the deal list.
          Cleanup of editingProposalId/editingInvoiceId when the underlying
          row disappears (deleted by realtime mid-edit) lives in a useEffect
          below - calling setState during render warns and re-renders. */}
      {editingProposalId && (() => {
        const ep = (CRM.proposals || []).find(p => p.id === editingProposalId);
        if (!ep) return null;
        return (
          <NewProposalModal
            contact={contact}
            editingProposal={ep}
            onClose={() => setEditingProposalId(null)}
          />
        );
      })()}
      {editingInvoiceId && (() => {
        const ei = (CRM.invoices || []).find(i => i.id === editingInvoiceId);
        if (!ei) return null;
        return (
          <NewInvoiceModal
            contact={contact}
            latestSignedProposal={proposals.find(p => p.id === ei.proposal_id) || null}
            invoices={invoices}
            editingInvoice={ei}
            onClose={() => setEditingInvoiceId(null)}
          />
        );
      })()}

      {dealCards.length === 0 && !proposalModalOpen && !invoiceModalOpen && !receiptModalOpen && (
        <div style={{ padding:'48px 24px', textAlign:'center', color:MUTED, fontSize:13 }}>Use the buttons above to send a proposal or invoice.</div>
      )}
    </div>
  );
}

// ── Contact Messages ──────────────────────────────────────────────
// Editable templates library. Persists in localStorage so Key can edit
// his own canned replies without touching code. Seeded with the most
// common solo-electrician scenarios. {firstName} expands at insert time.
const TEMPLATES_KEY = 'bpp_v3_message_templates';
const DEFAULT_TEMPLATES = [
  'Hey {firstName}! Confirming the install for tomorrow.',
  'Running about 15 min late, be there shortly.',
  'On my way!',
  'Reminder: install is set for tomorrow morning, 9am.',
  'Wrapped up, looks great. Mind dropping a quick Google review when you have a sec? Thanks!',
  'Permit just landed. Scheduling install now.',
  'Got a question on the panel, quick photo when you can?',
];
function loadTemplates() {
  try {
    const stored = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || 'null');
    if (Array.isArray(stored) && stored.length > 0) return stored;
  } catch {}
  return DEFAULT_TEMPLATES;
}

// ── StarredExamplesManager ──────────────────────────────────────────
// Lists every row in reply_suggestion_stars with body + created_at +
// contact name. Each row has an unstar (delete) action with confirm.
// Without this, a typo'd star permanently weights future suggest-reply
// calls - there was no escape hatch from the CRM until 2026-05-09.
function StarredExamplesManager({ onClose }) {
  const [rows, setRows] = React.useState(null); // null = loading, [] = empty, [...] = loaded
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!CRM.__db) { setErr('Supabase not loaded'); return; }
    setErr('');
    const { data, error } = await CRM.__db
      .from('reply_suggestion_stars')
      .select('id, body, contact_id, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      setErr('Load failed: ' + error.message);
      setRows([]);
      return;
    }
    setRows(data || []);
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  // ESC closes
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lookupContactName = (cid) => {
    const c = (CRM.contacts || []).find(x => x.id === cid);
    if (!c) return '-';
    return contactName(c) || (c.phone || c.id || '').slice(0, 12);
  };

  const remove = async (row) => {
    const ok = await window.confirmAction?.({
      title: 'Unstar this example?',
      body: `It will no longer weight future reply suggestions:\n\n"${row.body}"`,
      confirmLabel: 'Unstar',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const snap = { ...row };
    setRows(prev => (prev || []).filter(r => r.id !== row.id));
    const { error } = await CRM.__db.from('reply_suggestion_stars').delete().eq('id', row.id);
    setBusy(false);
    if (error) {
      setRows(prev => [snap, ...(prev || [])]);
      window.showToast?.('Unstar failed: ' + error.message);
      return;
    }
    window.showToast?.('Unstarred', {
      undo: async () => {
        const { id, created_at, ...rest } = snap;
        const { data, error: e2 } = await CRM.__db
          .from('reply_suggestion_stars')
          .insert(rest)
          .select()
          .single();
        if (e2) {
          window.showToast?.('Undo failed: ' + e2.message);
          return;
        }
        setRows(prev => [data, ...(prev || [])]);
      },
      duration: 5000,
    });
  };

  const fmtWhen = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Portal to body: the mobile shell's 200%-wide transformed slider re-roots
  // position:fixed, so inset/center overlays render off-screen (the 2026-06-15
  // job-sheet glitch). Portaling escapes the transform. Matches ModalShell.
  return ReactDOM.createPortal((
    <div onClick={onClose} style={{
      position:'fixed', top:0, left:0, right:0, height:'var(--vvh, 100dvh)',
      background:'rgba(11,31,59,0.45)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:'white', borderRadius:12, width:'100%', maxWidth:560,
        // Use --vvh so the modal shrinks when the iOS keyboard opens
        // instead of getting clipped at the viewport top. Fallback to 88vh.
        // Subtract the notch + home-indicator insets so the header close and
        // footer never sit in the unsafe zone on a notched phone.
        maxHeight:'calc(var(--vvh, 100dvh) - 40px - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
        display:'flex', flexDirection:'column', overflow:'hidden',
        border:'1px solid rgba(11,31,59,0.12)',
      }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid #EBEBEA' }}>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:NAVY }}>Starred reply examples</div>
            <div style={{ fontSize:11, color:MUTED, marginTop:2 }}>These shape how the AI suggests replies in your voice.</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width:44, height:44, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:8,
            fontSize:18, background:'none', border:'none', color:MUTED, cursor:'pointer', lineHeight:1,
          }}>×</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'8px 0' }}>
          {rows == null && (
            <div style={{ padding:'24px 16px', textAlign:'center', fontSize:13, color:MUTED }}>Loading…</div>
          )}
          {err && (
            <div style={{ padding:'12px 18px', fontSize:12, color:'#991B1B', background:'#FEF2F2' }}>{err}</div>
          )}
          {Array.isArray(rows) && rows.length === 0 && !err && (
            <div style={{ padding:'40px 24px', textAlign:'center' }}>
              <div style={{ fontSize:13, color:NAVY, fontWeight:600, marginBottom:6 }}>No starred examples yet</div>
              <div style={{ fontSize:12, color:MUTED, lineHeight:1.5 }}>
                Tap the star next to a Suggest result to save it as a high-weight example. Your AI suggestions will sound more like you over time.
              </div>
            </div>
          )}
          {Array.isArray(rows) && rows.map(r => (
            <div key={r.id} style={{
              display:'flex', alignItems:'flex-start', gap:10,
              padding:'12px 18px',
              borderBottom:'1px solid #F5F5F3',
            }}>
              <span style={{
                width:20, height:20, borderRadius:'50%',
                background:'#FEF3C7', color:'#92400E',
                display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1,
              }}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
              </span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, color:NAVY, lineHeight:1.45, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{r.body}</div>
                <div style={{ fontSize:11, color:MUTED, marginTop:4, display:'flex', gap:8, flexWrap:'wrap' }}>
                  <span>{fmtWhen(r.created_at)}</span>
                  {r.contact_id && <span>· {lookupContactName(r.contact_id)}</span>}
                </div>
              </div>
              <button
                onClick={() => remove(r)}
                disabled={busy}
                title="Unstar (delete)"
                aria-label="Unstar"
                style={{
                  // 44×44 tap target (WCAG 2.5.5 / iOS HIG floor), matching
                  // the template-delete button. Visual glyph stays 13×13.
                  width:44, height:44, borderRadius:6, flexShrink:0,
                  background:'transparent', color:'#dc2626',
                  border:'1px solid rgba(220,38,38,0.22)', cursor: busy ? 'wait' : 'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              </button>
            </div>
          ))}
        </div>
        <div style={{ padding:'10px 18px', borderTop:'1px solid #EBEBEA', fontSize:11, color:MUTED, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>{Array.isArray(rows) ? `${rows.length} starred` : ''}</span>
          <button onClick={refresh} style={{
            minHeight:44, display:'inline-flex', alignItems:'center',
            fontSize:11, fontWeight:600, color:NAVY, background:'none',
            border:'1px solid rgba(11,31,59,0.12)', borderRadius:6,
            padding:'0 14px', cursor:'pointer', fontFamily:'inherit',
          }}>Refresh</button>
        </div>
      </div>
    </div>
  ), document.body);
}

// QuickRepliesSheet , the merged Suggest + Templates popup (Claude Design comp
// "crm-quick-replies-sheet", 2026-06-20). Key: the old Templates modal was an
// editor pretending to be a picker, and Suggest lived in a separate strip. This
// is ONE calm popup: a SUGGESTED zone (AI replies, tap to insert, star to save)
// + a TEMPLATES zone (saved replies, tap to insert, quiet trash, add-input),
// gold Save + Cancel + a secondary Reset. Picking any row inserts into compose
// and closes (never auto-sends). Reuses ModalShell (bottom-sheet + the new
// background scroll-lock + safe-area). Opened from the contact header.
// QuickRepliesSheet visual language (Claude Design comp "crm-quick-replies-
// sheet", approved by Key 2026-06-21 after 6 rounds; comp at crm/v3/comps/
// quick-replies-redesign.html). Premium soft WHITE cards on a light-gray sheet
// (not spreadsheet rows), every reply rendered with its {} variables RESOLVED.
// TAP a card inserts it. PRESS-AND-HOLD opens an iOS-style context menu (the full
// message + actions the finger drags onto: Duplicate / Edit / Delete on templates,
// Save as example on suggestions). Variable chips when adding a template, and
// standard premium motion. Scoped .qr- prefix; keyframes + transitions live here
// because inline styles can't express them. Reduced-motion users get instant.
const QR_CSS = `
.qr-sheet { margin:-14px -18px calc(-14px - env(safe-area-inset-bottom,0px)); padding:14px 16px calc(10px + env(safe-area-inset-bottom,0px)); background:#eceef2; }
.qr-zhead { display:flex; align-items:center; gap:10px; margin:8px 2px 11px; }
.qr-zlabel { font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#5a6478; flex-shrink:0; }
.qr-zrule { flex:1; height:1px; background:rgba(27,43,75,0.10); }
.qr-suggest { min-height:44px; padding:0 16px; border-radius:100px; border:none; background:#fff; color:#5a6478; font-family:inherit; font-size:13px; font-weight:600; display:inline-flex; align-items:center; gap:6px; flex-shrink:0; cursor:pointer; box-shadow:0 1px 5px rgba(11,31,59,0.06); transition:transform .09s ease; }
.qr-suggest:active { transform:scale(0.96); }
.qr-suggest:disabled { cursor:wait; opacity:0.7; }
.qr-row { position:relative; border-radius:16px; margin-bottom:10px; }
.qr-face { position:relative; z-index:1; display:block; width:100%; min-height:54px; box-sizing:border-box; text-align:left; padding:15px 50px 15px 16px; background:#fff; border:none; border-radius:16px; color:#0b1f3b; font-family:inherit; font-size:15px; line-height:1.35; cursor:pointer; box-shadow:0 2px 10px rgba(11,31,59,0.06); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; transition:transform .12s ease; -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }
.qr-face:active { transform:scale(0.985); }
/* QR-1 (Claude Design comp 2026-06-22): a quiet, always-visible kebab so the
   Edit/Duplicate/Delete actions are discoverable at rest, not only via the
   hidden long-press (the long-press stays as a power-user shortcut). 44px tap
   target, low-contrast 3-dot glyph, right edge; the face text is right-padded
   so it never collides. */
.qr-kebab { position:absolute; z-index:2; top:50%; right:5px; transform:translateY(-50%); width:44px; height:44px; display:flex; align-items:center; justify-content:center; border:none; background:none; cursor:pointer; color:#9ca3af; border-radius:10px; -webkit-tap-highlight-color:transparent; }
.qr-kebab:active { background:#eef1f6; }
.qr-rise { animation:qr-rise .34s cubic-bezier(.2,.8,.3,1) both; }
@keyframes qr-rise { from { opacity:0; transform:translateY(7px); } to { opacity:1; transform:translateY(0); } }
.qr-empty { font-size:13px; color:#5a6478; padding:4px 4px 8px; line-height:1.45; }
.qr-add { display:flex; gap:8px; align-items:center; background:#fff; border-radius:16px; padding:7px 7px 7px 14px; box-shadow:0 2px 10px rgba(11,31,59,0.06); }
.qr-inwrap { position:relative; flex:1; min-width:0; display:flex; align-items:center; }
.qr-input { flex:1; min-width:0; min-height:24px; max-height:120px; overflow-y:auto; border:none; background:transparent; padding:10px 0; font-family:inherit; font-size:16px; line-height:1.25; color:#0b1f3b; outline:none; white-space:pre-wrap; word-break:break-word; -webkit-user-select:text; user-select:text; }
.qr-ph { position:absolute; left:0; top:50%; transform:translateY(-50%); font-size:16px; color:#6b7385; pointer-events:none; }
.qr-addbtn { min-height:44px; padding:0 18px; border:none; border-radius:12px; background:#1b2b4b; color:#fff; font-family:inherit; font-size:14px; font-weight:700; cursor:pointer; flex-shrink:0; transition:transform .09s ease; }
.qr-addbtn:active { transform:scale(0.96); }
.qr-chips { display:flex; gap:8px; margin:0 2px 9px; align-items:center; animation:qr-rise .2s ease both; }
.qr-chiplabel { font-size:12px; color:#5a6478; flex-shrink:0; }
.qr-chip { min-height:44px; padding:8px 14px; border-radius:100px; border:1px solid rgba(27,43,75,0.14); background:#fff; color:#1b2b4b; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; transition:transform .09s ease; }
.qr-chip:active { transform:scale(0.95); }
.qr-editbar { display:flex; align-items:center; gap:10px; margin:0 2px 9px; animation:qr-rise .2s ease both; }
.qr-editlabel { font-size:12px; font-weight:600; color:#1b2b4b; flex:1; }
.qr-cancel { background:none; border:none; color:#5a6478; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer; min-height:44px; display:inline-flex; align-items:center; padding:0 8px; }
/* Press-and-hold context menu: full message + actions the finger drags onto */
.qr-scrim { position:fixed; inset:0; z-index:10000; background:rgba(11,31,59,0.22); animation:qr-fade .16s ease both; touch-action:none; }
.qr-menu { position:fixed; left:18px; right:18px; z-index:10001; display:flex; flex-direction:column; gap:10px; transform-origin:center top; animation:qr-pop .17s cubic-bezier(.2,.8,.3,1) both; }
.qr-menu-text { background:#fff; border-radius:16px; padding:15px 16px; color:#0b1f3b; font-size:15px; line-height:1.4; box-shadow:0 16px 46px rgba(11,31,59,0.28); max-height:40vh; overflow:auto; }
.qr-menu-acts { background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 16px 46px rgba(11,31,59,0.28); }
.qr-menu-btn { display:flex; align-items:center; gap:13px; width:100%; min-height:54px; padding:0 18px; border:none; background:#fff; color:#0b1f3b; font-family:inherit; font-size:16px; font-weight:600; text-align:left; cursor:pointer; -webkit-user-select:none; user-select:none; }
.qr-menu-btn + .qr-menu-btn { border-top:1px solid rgba(27,43,75,0.08); }
.qr-menu-btn svg { flex-shrink:0; }
.qr-menu-btn.del { color:#dc2626; }
.qr-menu-btn.active { background:#eef1f6; }
.qr-menu-btn.del.active { background:#fef2f2; }
/* qr-menu-fullwidth-desktop: the actions menu is left:18/right:18 (full-width,
   correct for the mobile sheet). On desktop that spans the whole monitor while
   the sheet itself caps at ~440px, so cap + center it to a compact popup. The
   inline top (menu.top) is kept; we center via margin (not transform, which the
   qr-pop animation owns). */
@media (min-width:900px){
  .qr-menu { left:50%; right:auto; width:360px; max-width:360px; margin-left:-180px; }
}
/* qr-no-hover-states-desktop: pointer-scoped hover feedback so the QR controls
   respond to a desktop mouse; (hover:hover) keeps touch devices free of sticky
   hover. Mirrors each control's :active resting cue. */
@media (hover:hover){
  .qr-face:hover { box-shadow:0 4px 14px rgba(11,31,59,0.12); }
  .qr-kebab:hover { background:#eef1f6; }
  .qr-suggest:hover:not(:disabled) { box-shadow:0 2px 10px rgba(11,31,59,0.12); }
  .qr-addbtn:hover { filter:brightness(1.08); }
  .qr-chip:hover { border-color:rgba(27,43,75,0.30); }
  .qr-menu-btn:hover { background:#f4f6f9; }
  .qr-menu-btn.del:hover { background:#fef2f2; }
}
@keyframes qr-fade { from { opacity:0; } to { opacity:1; } }
@keyframes qr-pop { from { opacity:0; transform:scale(0.92) translateY(6px); } to { opacity:1; transform:scale(1) translateY(0); } }
@keyframes bpp-qr-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) {
  .qr-rise,.qr-chips,.qr-editbar,.qr-scrim,.qr-menu { animation:none !important; }
  .qr-face,.qr-suggest,.qr-addbtn,.qr-chip,.qr-kebab { transition:none !important; }
  .qr-suggest svg { animation:none !important; }
}
`;

// One reply card. TAP inserts the reply (and closes the sheet). PRESS-AND-HOLD
// (430ms, no real move) opens the context menu via onHold() with the card's
// rect + the press point; the parent then tracks the SAME continuous press so
// the finger can keep sliding onto Duplicate / Edit / Delete (templates) or Save
// (suggestions) and release to fire (drag-to-select). A move > 8px cancels the
// hold (so scrolling the list never opens a menu), and the trailing click is
// suppressed after a hold so it never also inserts.
function QRCard({ display, onTap, onHold, delay }) {
  const ref = React.useRef(null);
  const g = React.useRef({ x0:0, y0:0, held:false });
  const holdRef = React.useRef(null);
  const clearHold = () => { if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; } };
  const start = (e) => {
    const t = e.touches ? e.touches[0] : e;
    const cx = t.clientX, cy = t.clientY; // capture now; the synthetic event may be pooled by 430ms
    g.current = { x0:cx, y0:cy, held:false };
    holdRef.current = setTimeout(() => {
      g.current.held = true;
      const r = ref.current ? ref.current.getBoundingClientRect() : null;
      onHold({ rect:r, x:cx, y:cy });
    }, 430);
  };
  const move = (e) => {
    const t = e.touches ? e.touches[0] : e;
    if (Math.abs(t.clientX - g.current.x0) > 8 || Math.abs(t.clientY - g.current.y0) > 8) clearHold();
  };
  const end = () => clearHold();
  // Clear any pending hold timer on unmount so a card removed mid-press (sheet
  // closed, or the list re-rendered after a delete) can't fire onHold afterward
  // and pop a stray menu.
  React.useEffect(() => () => clearHold(), []);
  return (
    <div className="qr-row qr-rise" style={{ animationDelay: (delay || 0) + 'ms' }}>
      <button ref={ref} className="qr-face"
        onClick={() => { if (g.current.held) { g.current.held = false; return; } onTap(); }}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={clearHold}>
        {display}
      </button>
      {/* QR-1: the visible kebab opens the SAME actions menu the long-press
          does, synthesizing the {rect,x,y} contract openMenu expects so the
          menu positions identically. The long-press stays as a shortcut. */}
      <button className="qr-kebab" aria-label="Reply actions"
        onClick={(e) => { e.stopPropagation(); const r = ref.current ? ref.current.getBoundingClientRect() : null; onHold({ rect:r, x: r ? r.right - 22 : 0, y: r ? r.top + r.height/2 : 0 }); }}>
        <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="2"/><circle cx="2" cy="8" r="2"/><circle cx="2" cy="14" r="2"/></svg>
      </button>
    </div>
  );
}

function QuickRepliesSheet({ onClose, onInsertTemplate, onInsertSuggestion,
                            suggestions, suggestionsLoading, suggestionsErr, onSuggest, onStar,
                            templates, onOpenStarred, resolve, isDnc }) {
  const [list, setList] = React.useState(templates);
  const [draft, setDraft] = React.useState('');
  const [adding, setAdding] = React.useState(false);        // input focused -> variable chips
  const [editingIdx, setEditingIdx] = React.useState(null); // template index being edited inline
  const [starred, setStarred] = React.useState(() => new Set());
  const [menu, setMenu] = React.useState(null);             // press-and-hold context menu
  const [activeAct, setActiveAct] = React.useState(null);   // action under the dragging finger
  const draftRef = React.useRef(null);
  const qrTypingRef = React.useRef(false);                  // true while the user types -> skip the innerText sync (no caret jump)
  const activeActRef = React.useRef(null); activeActRef.current = activeAct;
  const consumedRef = React.useRef(false);                  // guards against double-fire (drag + click)

  // Resolve {} variables for DISPLAY only; the raw template (with tokens) is what
  // gets stored + inserted (the composer expands it the same way on send).
  const rv = (t) => { try { return resolve ? resolve(t) : t; } catch (_) { return t; } };

  // Keep the contentEditable add-field in sync when `draft` changes from OUTSIDE
  // typing (tapping a {var} chip, or loading a template to edit). We skip the write
  // while the user is typing so the caret never jumps. Using contentEditable instead
  // of a native input is what suppresses the iOS form-accessory bar (the orphaned
  // chevrons + done bar Key saw on his phone), the same trick the composer uses.
  React.useEffect(() => {
    const el = draftRef.current; if (!el) return;
    if (qrTypingRef.current) { qrTypingRef.current = false; return; }
    if ((el.innerText || '') === draft) return;
    el.innerText = draft;
    if (draft) { try { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (_) {} }
  }, [draft]);

  // Auto-save: every edit persists instantly. commit() is the single write path.
  const commit = (next) => {
    setList(next);
    window.safeSetItem?.(TEMPLATES_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('crm-templates-changed'));
  };
  // Add a template, or in edit mode replace the one at editingIdx.
  const submitDraft = () => {
    const v = draft.trim();
    if (!v) { if (editingIdx != null) { setEditingIdx(null); setDraft(''); } return; }
    if (editingIdx != null) { commit(list.map((x, j) => j === editingIdx ? v : x)); setEditingIdx(null); }
    else commit([...list, v]);
    setDraft('');
  };
  const cancelEdit = () => { setEditingIdx(null); setDraft(''); };
  const addVar = (tok) => { setDraft(d => d + tok); setTimeout(() => draftRef.current && draftRef.current.focus(), 0); };

  // Press-and-hold opens the context menu for that card. Clamp it on-screen.
  // QR-3: clamp against the VISUAL viewport (correct with the keyboard up) and
  // reserve the menu's real footprint , the message text block (up to 40vh) plus
  // its action rows (54px each: a template has 3, a suggestion 1) plus gaps ,
  // instead of a flat 320px off window.innerHeight, so a long message held near
  // the bottom never pushes the Delete/Save row below the fold.
  const openMenu = (kind, idx, full) => (info) => {
    const VH = (typeof window !== 'undefined' && window.visualViewport ? window.visualViewport.height
      : (typeof window !== 'undefined' ? window.innerHeight : 800));
    const reserve = Math.min(VH * 0.4, 240) + (kind === 'template' ? 3 : 1) * 55 + 24;
    const anchor = ((info && info.rect ? info.rect.top : (info && info.y) || 200)) - 8;
    const top = Math.max(12, Math.min(VH - reserve, anchor));
    consumedRef.current = false; setActiveAct(null);
    setMenu({ kind, idx, full, top });
  };
  const closeMenu = () => { setMenu(null); setActiveAct(null); };
  const fireAct = (act) => {
    if (consumedRef.current) return; consumedRef.current = true;
    const m = menu;
    if (m && m.kind === 'template') {
      if (act === 'dup') commit([...list.slice(0, m.idx + 1), list[m.idx], ...list.slice(m.idx + 1)]);
      else if (act === 'edit') { setEditingIdx(m.idx); setDraft(list[m.idx]); setTimeout(() => draftRef.current && draftRef.current.focus(), 60); }
      else if (act === 'del') {
        // QR-2: template delete is the only destructive action in this file
        // without an undo; snapshot the prior list so a mis-dragged release
        // over Delete is recoverable (mirrors starSuggestion's 5s undo).
        const prev = list;
        commit(list.filter((_, j) => j !== m.idx));
        window.showToast?.('Template deleted', { undo: () => commit(prev), duration: 5000 });
      }
    } else if (m && m.kind === 'suggestion' && act === 'save') {
      // Only mark the suggestion saved if the insert actually succeeded; a
      // failed save used to mark it saved AND block any retry (the !starred.has
      // guard), so the example was silently lost (audit 2026-06-22).
      const s = suggestions[m.idx];
      if (s && !starred.has(s)) {
        Promise.resolve(onStar(s)).then(ok => { if (ok) setStarred(p => new Set(p).add(s)); });
      }
    }
    closeMenu();
  };

  // Drag-to-select: while the menu is open and the press continues, track the
  // action under the finger (highlight it); releasing over an action fires it.
  // Releasing off the menu leaves it open in tap mode (tap an action, or the
  // scrim, to choose / dismiss). consumedRef stops the trailing click double-firing.
  React.useEffect(() => {
    if (!menu) return;
    const hit = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const btn = el && el.closest ? el.closest('[data-qract]') : null;
      setActiveAct(btn ? btn.getAttribute('data-qract') : null);
    };
    const onMove = (e) => { const t = e.touches ? e.touches[0] : e; if (t) hit(t.clientX, t.clientY); };
    const onUp = () => {
      const act = activeActRef.current;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      if (act) fireAct(act);
    };
    // Esc closes ONLY this menu, not the whole QuickRepliesSheet. Capture phase
    // + stopPropagation so it beats the shared __modalEscapeStack bubble listener
    // (which would otherwise close the parent sheet too), audit 2026-06-22.
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onUp);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps

  const ICON = {
    dup:  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>,
    edit: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>,
    del:  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>,
    save: <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15 8.5 22 9.3 17 14 18.2 21 12 17.5 5.8 21 7 14 2 9.3 9 8.5 12 2"/></svg>,
  };
  const menuActs = menu && menu.kind === 'template'
    ? [{ act:'dup', label:'Duplicate' }, { act:'edit', label:'Edit' }, { act:'del', label:'Delete', del:true }]
    : [{ act:'save', label:'Save as example' }];

  return (
    <ModalShell open={true} onClose={onClose} title="Quick replies" hideClose={true}
      headerRight={onOpenStarred ? (
        <button onClick={onOpenStarred} style={{ flexShrink:0, background:'none', border:'none', color:'#5a6478', fontSize:12.5, fontFamily:'inherit', cursor:'pointer', padding:'14px 4px', margin:'-10px 0', textDecoration:'underline', textUnderlineOffset:'2px', whiteSpace:'nowrap' }}>Manage saved examples</button>
      ) : null}>
      <style>{QR_CSS}</style>
      <div className="qr-sheet">
        {/* CM-23: a do-not-contact thread cannot receive a reply, so the picker
            body is replaced by a plain notice (Suggest + insert are not rendered,
            so nothing here can fire a send). */}
        {isDnc ? (
          <div className="qr-empty" style={{ padding:'24px 8px', textAlign:'center', lineHeight:1.5 }}>This contact opted out of texts. Replies can't be sent.</div>
        ) : (<>
        {/* SUGGESTED , AI replies in Key's voice, behind one calm Suggest action */}
        <div className="qr-zhead">
          <span className="qr-zlabel">Suggested</span>
          <span className="qr-zrule" />
          {/* CM-34: show the "Thinking..." word in exactly ONE place (the in-list
              status below). The button just spins its sparkle + disables while
              loading, so the word does not appear twice. */}
          <button className="qr-suggest" onClick={onSuggest} disabled={suggestionsLoading} aria-busy={suggestionsLoading} aria-label="Suggest new replies">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: suggestionsLoading ? 'bpp-qr-spin 0.9s linear infinite' : 'none' }}><path d="M8 1.5l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z"/></svg>
            Suggest
          </button>
        </div>
        {suggestionsErr
          ? <div className="qr-empty" style={{ color:'#991B1B', fontStyle:'italic' }}>{suggestionsErr}</div>
          : (suggestionsLoading && suggestions.length === 0)
            ? <div className="qr-empty" style={{ fontStyle:'italic' }}>Thinking…</div>
            : suggestions.length === 0
              ? <div className="qr-empty">Tap Suggest for AI replies in your voice. If you sent the last message, there is nothing to reply to yet.</div>
              : suggestions.map((s, i) => (
                  <QRCard key={'s'+i} display={rv(s)} delay={Math.min(i,6)*32}
                    onTap={() => onInsertSuggestion(s)} onHold={openMenu('suggestion', i, rv(s))} />
                ))
        }

        {/* TEMPLATES , saved reusable replies */}
        <div className="qr-zhead" style={{ marginTop:18 }}>
          <span className="qr-zlabel">Templates</span>
          <span className="qr-zrule" />
        </div>
        {list.length === 0
          ? <div className="qr-empty">No templates yet. Add one below.</div>
          : list.map((t, i) => (
              <QRCard key={'t'+i} display={rv(t)} delay={Math.min(i,6)*32}
                onTap={() => onInsertTemplate(t)} onHold={openMenu('template', i, rv(t))} />
            ))
        }

        {/* Edit bar while editing a template; else variable chips while adding */}
        {editingIdx != null
          ? <div className="qr-editbar"><span className="qr-editlabel">Editing template</span><button type="button" className="qr-cancel" onMouseDown={e => e.preventDefault()} onClick={cancelEdit}>Cancel</button></div>
          : adding && (
              <div className="qr-chips">
                <span className="qr-chiplabel">Insert a name:</span>
                <button type="button" className="qr-chip" onMouseDown={e => e.preventDefault()} onClick={() => addVar('{firstName}')}>{'{firstName}'}</button>
                <button type="button" className="qr-chip" onMouseDown={e => e.preventDefault()} onClick={() => addVar('{lastName}')}>{'{lastName}'}</button>
              </div>
            )}
        <div className="qr-add">
          <div className="qr-inwrap">
            <div ref={draftRef} className="qr-input" contentEditable="plaintext-only" suppressContentEditableWarning
              role="textbox" aria-label={editingIdx != null ? 'Edit template' : 'New template'}
              enterKeyHint="done" autoCorrect="on" autoCapitalize="sentences" spellCheck={true}
              onInput={e => { qrTypingRef.current = true; const el = e.currentTarget; setDraft(el.textContent === '' ? '' : el.innerText); }}
              onPaste={e => { e.preventDefault(); const t = ((e.clipboardData || window.clipboardData) && (e.clipboardData || window.clipboardData).getData('text/plain')) || ''; try { document.execCommand('insertText', false, t); } catch (_) {} }}
              onFocus={(e) => {
                setAdding(true);
                // The iOS keyboard occludes the bottom of the sheet, where this
                // add-field + the Add button live, so on a phone they sit behind
                // the keyboard (audit 2026-06-22, iOS-keyboard sim). The ModalShell
                // card scrolls (maxHeight var(--vvh)), so scroll the field into the
                // keyboard-adjusted viewport once the keyboard has opened + the card
                // re-laid-out. Verified: field + Add both ride above the keyboard.
                const el = e.currentTarget;
                setTimeout(() => { try { el.scrollIntoView({ block: 'center' }); } catch (_) {} }, 320);
              }} onBlur={() => setTimeout(() => setAdding(false), 150)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitDraft(); } }} />
            {draft.length === 0 && <div className="qr-ph" aria-hidden="true">{editingIdx != null ? 'Edit template…' : 'New template…'}</div>}
          </div>
          <button className="qr-addbtn" onClick={submitDraft}>{editingIdx != null ? 'Save' : 'Add'}</button>
        </div>
        </>)}
      </div>
      {/* Press-and-hold context menu, portaled to body so it is truly viewport-fixed
          (ModalShell's card has a transform). Full message + the actions the finger
          drags onto. */}
      {menu && ReactDOM.createPortal(
        <div className="qr-scrim" onClick={closeMenu} onContextMenu={e => e.preventDefault()}>
          <div className="qr-menu" style={{ top: menu.top }} onClick={e => e.stopPropagation()}>
            <div className="qr-menu-text">{menu.full}</div>
            <div className="qr-menu-acts">
              {menuActs.map(a => (
                <button key={a.act} data-qract={a.act}
                  className={'qr-menu-btn' + (a.del ? ' del' : '') + (activeAct === a.act ? ' active' : '')}
                  onClick={() => fireAct(a.act)}>
                  {ICON[a.act]}{a.label}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </ModalShell>
  );
}

// ── ScheduledMessagesStrip ────────────────────────────────────────────
// Shows queued scheduled messages for the active contact above the
// compose bar. Each row shows the body preview + "in 2h" + cancel.
// Subscribes to crm-scheduled-msg-changed so toggles update without a
// full re-render.
function ScheduledMessagesStrip({ contactId }) {
  const [queue, setQueue] = React.useState(() => window.readSchedQueue?.() || []);
  React.useEffect(() => {
    const refresh = () => setQueue(window.readSchedQueue?.() || []);
    window.addEventListener('crm-scheduled-msg-changed', refresh);
    window.addEventListener('storage', refresh);
    // Refresh every 30s so "in 1h" countdowns stay fresh.
    const tick = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener('crm-scheduled-msg-changed', refresh);
      window.removeEventListener('storage', refresh);
      clearInterval(tick);
    };
  }, []);
  const mine = queue.filter(m => m.contactId === contactId).sort((a, b) => new Date(a.at) - new Date(b.at));
  if (mine.length === 0) return null;

  const niceTime = (iso) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms < 0) return 'sending now…';
    if (ms < 3600 * 1000) return `in ${Math.max(1, Math.round(ms / 60000))} min`;
    if (ms < 86400 * 1000) return `in ${Math.round(ms / 3600000)} hr`;
    return new Date(iso).toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  };

  return (
    <div style={{ margin:'8px 16px 0', display:'flex', flexDirection:'column', gap:6, flexShrink:0 }}>
      {mine.map(m => (
        <div key={m.id} style={{
          display:'flex', alignItems:'center', gap:10,
          padding:'8px 10px',
          background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:8,
          fontSize:12, color:'#1E40AF',
        }}>
          <span style={{ fontSize:13 }}>⏰</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700 }}>Scheduled · {niceTime(m.at)}</div>
            <div style={{ color:'#1E3A8A', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginTop:1 }}>{m.body || '(media-only)'}</div>
          </div>
          <button
            onClick={() => {
              // Snapshot the whole queue item so a mis-tapped Cancel is
              // recoverable: a queued customer text destroyed with no undo is a
              // comms-trust failure (audit 2026-06-22). 5s undo re-queues the
              // exact message, matching this file's established undo pattern.
              const snap = m;
              window.cancelScheduledMessage?.(m.id);
              window.showToast?.('Scheduled message cancelled', {
                duration: 5000,
                undo: () => window.scheduleMessage?.({
                  contactId: snap.contactId, body: snap.body, atIso: snap.at,
                  mediaUrls: snap.mediaUrls || [], fileLinks: snap.fileLinks || [],
                }),
              });
            }}
            aria-label="Cancel scheduled message"
            style={{
              fontSize:11, fontWeight:700, color:'#991B1B',
              background:'white', border:'1px solid #FECACA', borderRadius:6,
              padding:'4px 10px', minHeight:44, display:'inline-flex', alignItems:'center', justifyContent:'center',
              flexShrink:0, cursor:'pointer', fontFamily:'inherit',
            }}
          >Cancel</button>
        </div>
      ))}
    </div>
  );
}

// ── SendButton (single arrow: tap = send now, hold = schedule later) ──
// Key 2026-06-20: the split chevron is gone. One gold send arrow. A short
// tap sends now; pressing and HOLDING (~450ms) opens the schedule menu with
// presets (1hr, 4hr, tomorrow 9am/7pm) + a custom datetime. pointerdown
// preventDefault keeps the compose textarea focused so the mobile keyboard
// never drops on send. Scheduled sends survive reload via the localStorage
// queue + 60s poller in crm-shared.jsx.
function SendButton({ onSend, onSchedule, sending }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  // CM-31: explicit press-scale on the single most-tapped control. The global
  // button:active scale could be suppressed here by touchAction:none + the
  // pointerdown preventDefault, so Send drives its own pressed state to
  // guarantee the tactile confirmation. reduced-motion skips the scale.
  const [pressed, setPressed] = React.useState(false);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrapRef = React.useRef(null);
  const holdTimer = React.useRef(null);
  const openedByHold = React.useRef(false);
  const dtRef = React.useRef(null); // QR-5: hidden datetime-local for custom schedule
  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    // pointerdown (not mousedown) so a finger tap on empty space dismisses the
    // schedule menu on a phone , iOS does not synthesize mousedown from touch,
    // which left the long-press menu with no outside-tap close (audit 2026-06-22).
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);
  React.useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  const tomorrowAt = (hour, minute = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };
  const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

  const presets = [
    { label:'In 1 hour',         at: inHours(1) },
    { label:'In 4 hours',        at: inHours(4) },
    { label:'Tomorrow 9 AM',     at: tomorrowAt(9, 0) },
    { label:'Tomorrow 7 PM',     at: tomorrowAt(19, 0) },
  ];

  // QR-5: open the native datetime wheel/calendar instead of a window.prompt
  // that demanded a hand-typed "YYYY-MM-DD HH:MM" 24-hour string (an old-person
  // floor failure). min blocks past values; the local string (NOT toISOString,
  // which is UTC) keeps the floor on the operator's clock.
  const pad = n => String(n).padStart(2, '0');
  const toLocalDT = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const customSchedule = () => {
    const el = dtRef.current;
    if (!el) return;
    el.min = toLocalDT(new Date());
    el.value = toLocalDT(new Date(Date.now() + 3600 * 1000));
    try { el.showPicker ? el.showPicker() : el.focus(); } catch (_) { el.focus(); }
  };
  const onSchedulePicked = (e) => {
    const v = e.target.value;
    if (!v) return;
    const at = new Date(v); // datetime-local value is local time
    if (isNaN(at.getTime()) || at.getTime() < Date.now()) {
      window.showToast?.('Pick a future date and time');
      return;
    }
    setMenuOpen(false);
    onSchedule?.(at.toISOString());
  };

  const clearHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };
  const onPointerDown = (e) => {
    // preventDefault keeps the compose textarea focused (no keyboard drop).
    e.preventDefault();
    setPressed(true);
    openedByHold.current = false;
    clearHold();
    holdTimer.current = setTimeout(() => {
      openedByHold.current = true;
      setMenuOpen(true);
      window.bppHaptic && window.bppHaptic('light');
    }, 450);
  };
  const onPointerUp = () => {
    clearHold();
    setPressed(false);
    // Short press (released before the hold fired, menu not already open) = send.
    if (!openedByHold.current && !menuOpen) onSend?.();
  };
  // Pointer left/cancelled before release: drop the hold timer AND the press.
  const onPressCancel = () => { clearHold(); setPressed(false); };

  return (
    <div ref={wrapRef} style={{ position:'relative', display:'flex', flexShrink:0 }}>
      {/* QR-5: the hidden datetime-local that 'Pick date + time…' opens via
          showPicker(); kept 1px/opacity:0 (not display:none) so showPicker works. */}
      <input ref={dtRef} type="datetime-local" onChange={onSchedulePicked} aria-hidden="true" tabIndex={-1}
        style={{ position:'absolute', bottom:0, left:0, width:1, height:1, opacity:0, pointerEvents:'none', border:0, padding:0 }} />
      <button
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPressCancel}
        onPointerCancel={onPressCancel}
        onContextMenu={(e) => e.preventDefault()}
        /* sms-05: pointer events drive tap+hold, but a keyboard-only operator who
           Tabs onto Send and presses Enter/Space fires a synthesized click with
           detail===0 and NO pointer events. Route that to send so the focused
           button is not a dead control. detail>=1 (mouse/touch click) already
           sent via onPointerUp, so the guard prevents a double-send. */
        onClick={(e) => { if (e.detail === 0 && !menuOpen && !openedByHold.current) onSend?.(); }}
        aria-label={sending ? 'Sending message' : 'Send (hold to schedule)'}
        aria-busy={sending ? true : undefined}
        title="Tap to send · hold to schedule"
        style={{
          position:'relative',
          width:44, minHeight:44, borderRadius:8,
          background:GOLD, color:NAVY, border:'none', cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          touchAction:'none', userSelect:'none', WebkitUserSelect:'none',
          transform: (pressed && !reduceMotion) ? 'scale(0.94)' : 'scale(1)',
          transition: reduceMotion ? 'none' : 'transform 90ms ease',
        }}>
        {/* CM-32: while a message uploads + dispatches, the arrow becomes a
            spinning ring so the async window is acknowledged (the composer
            already cleared, so without this the button looked idle mid-send). */}
        {sending ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ animation:'bpp-spin 0.7s linear infinite' }}>
            <path d="M12 3a9 9 0 1 0 9 9" opacity="0.9"/>
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        )}
        {/* CM-11: a quiet resting clock so hold-to-schedule is discoverable at
            rest (not a hidden gesture), mirroring the nav-tab-hold dot cue.
            Hidden mid-send (CM-32) since hold-to-schedule is irrelevant then. */}
        {!sending && (
          <span aria-hidden="true" style={{ position:'absolute', top:2, right:2, width:11, height:11, color:NAVY, opacity:0.5, pointerEvents:'none' }}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/></svg>
          </span>
        )}
      </button>
      {menuOpen && (
        <div style={{
          position:'absolute', bottom:'calc(100% + 6px)', right:0,
          width:180, background:'white',
          border:'1px solid rgba(27,43,75,0.12)', borderRadius:10,
          boxShadow:'0 8px 24px rgba(27,43,75,0.16)',
          padding:6, zIndex:60,
          // Rise + fade in from the send button instead of popping (Key
          // 2026-06-21 polish). transform-origin anchors it to the corner it
          // grows from; reduced-motion collapses it via the global media rule.
          transformOrigin:'bottom right',
          animation:'bpp-fade-up 140ms cubic-bezier(0.2,0.8,0.3,1) both',
        }}>
          <div style={{ padding:'4px 10px 6px', fontSize:12, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.06em' }}>Send later</div>
          {presets.map(p => (
            <button
              key={p.label}
              onClick={() => { setMenuOpen(false); onSchedule?.(p.at); }}
              style={{
                width:'100%', textAlign:'left',
                minHeight:44, display:'flex', alignItems:'center', padding:'0 12px', fontSize:14, fontWeight:500, color:NAVY,
                background:'none', border:'none', borderRadius:6,
                cursor:'pointer', fontFamily:'inherit',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#F8F8F6'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >{p.label}</button>
          ))}
          <div style={{ height:1, background:'rgba(27,43,75,0.08)', margin:'4px 4px' }} />
          <button
            onClick={customSchedule}
            style={{
              width:'100%', textAlign:'left',
              minHeight:44, display:'flex', alignItems:'center', padding:'0 12px', fontSize:14, fontWeight:500, color:NAVY,
              background:'none', border:'none', borderRadius:6,
              cursor:'pointer', fontFamily:'inherit',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#F8F8F6'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >Pick date + time…</button>
        </div>
      )}
    </div>
  );
}

// Upload a File/Blob to the public message-media bucket via the crm-media-upload
// edge function. The CRM holds only the anon/publishable key, and the bucket
// grants INSERT to authenticated/service_role ONLY (the hardening locked anon
// writes since the bucket is publicly readable and the key ships in the
// frontend). So the function does the SERVICE-ROLE write and hands back the
// public URL. scope picks the path prefix (message | job-photo | annotation).
// Throws with the server's reason on failure so callers can show a real toast.
async function uploadCrmMedia(fileOrBlob, contactId, scope, contentTypeOverride) {
  const contentType = contentTypeOverride || fileOrBlob.type || 'application/octet-stream';
  const dataBase64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error('could not read file'));
    r.readAsDataURL(fileOrBlob);
  });
  const { data, error } = await CRM.__invokeFn('crm-media-upload', {
    body: { contactId, contentType, scope, dataBase64 },
  });
  if (error || !data || data.ok === false || !data.url) {
    let detail = data?.error || error?.message || 'upload failed';
    try { const eb = error?.context ? await error.context.json() : null; if (eb?.error) detail = eb.error; } catch (_) {}
    throw new Error(detail);
  }
  return data.url;
}

function ContactMessages({ contact, thread, isDnc }) {
  const draftKey = 'draft:' + contact.id;
  const quoteCtxKey = 'quoteContext:' + contact.id;
  const [quoteCtx, setQuoteCtx] = React.useState(() => {
    try {
      const raw = sessionStorage.getItem(quoteCtxKey);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  });
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(quoteCtxKey);
      setQuoteCtx(raw ? JSON.parse(raw) : null);
    } catch (_) { setQuoteCtx(null); }
  }, [contact.id, quoteCtxKey]);
  const dismissQuoteCtx = () => {
    try { sessionStorage.removeItem(quoteCtxKey); } catch (_) {}
    setQuoteCtx(null);
  };
  // Desk clear stack sticky (bold bet #3). Prefill only; Send advances.
  const [deskStack, setDeskStack] = React.useState(() =>
    (window.CRM?.peekDeskClearQueue ? window.CRM.peekDeskClearQueue() : { active: false, remaining: 0 })
  );
  React.useEffect(() => {
    const sync = () => {
      setDeskStack(window.CRM?.peekDeskClearQueue
        ? window.CRM.peekDeskClearQueue()
        : { active: false, remaining: 0 });
    };
    sync();
    window.addEventListener('crm-desk-clear-changed', sync);
    return () => window.removeEventListener('crm-desk-clear-changed', sync);
  }, [contact.id]);
  const openDeskClearNext = (advance) => {
    if (!advance || advance.done || !advance.nextId) return;
    window.dispatchEvent(new CustomEvent('crm-open-contact', {
      detail: { contactId: advance.nextId, tab: 'messages' },
    }));
  };
  // Sort thread chronologically (DB is unordered)
  const sortedThread = React.useMemo(
    () => [...thread].sort((a,b) => (a.sent_at||'').localeCompare(b.sent_at||'')),
    [thread]
  );

  const [msg, setMsg] = React.useState(() => sessionStorage.getItem(draftKey) || '');
  // The composer is message-only (Key 2026-06-15: the internal-note compose
  // toggle was removed, he does not write notes from the SMS box). Existing
  // kind='note' rows still RENDER in the thread as the yellow note bubble.
  const [localMsgs, setLocalMsgs] = React.useState([]); // optimistic-sent messages
  const [attachments, setAttachments] = React.useState([]);
  const [templates, setTemplates] = React.useState(loadTemplates);
  const [editingTemplates, setEditingTemplates] = React.useState(false);
  // Auto-reply suggestions - Claude reads thread + Key's last 20 outbound
  // replies + starred examples → 3 short replies in his voice. Tap to
  // drop into compose. Star (⭐) the ones you actually send to weight
  // them as gold-standard for future calls.
  const [suggestions, setSuggestions] = React.useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = React.useState(false);
  const [suggestionsErr, setSuggestionsErr] = React.useState('');
  const [starredManagerOpen, setStarredManagerOpen] = React.useState(false);
  const fetchSuggestions = async () => {
    if (suggestionsLoading) return;
    setSuggestionsLoading(true);
    setSuggestionsErr('');
    try {
      const { data, error } = await CRM.__invokeFn('suggest-reply', { body: { contactId: contact.id } });
      if (error || !data) {
        // supabase-js wraps non-2xx as a generic "Edge Function returned a
        // non-2xx status code". The actual error JSON lives on
        // `error.context` (a Response) - read it so Key sees what broke.
        let detail = error?.message || 'unknown';
        try {
          const body = await error?.context?.json?.();
          if (body?.error) detail = body.error + (body.detail ? `: ${body.detail}` : '');
        } catch (_) {}
        setSuggestionsErr(`Couldn't get suggestions (${detail}). Tap Suggest to try again.`);
        setSuggestions([]);
      } else if (data.error) {
        setSuggestionsErr(data.error);
        setSuggestions([]);
      } else {
        setSuggestions(data.suggestions || []);
      }
    } catch (e) {
      setSuggestionsErr(e.message || String(e));
    } finally {
      setSuggestionsLoading(false);
    }
  };
  // Star a suggestion - saves it to reply_suggestion_stars so future
  // suggest-reply calls weight it heavily. Toast offers a 5s undo so a
  // mis-tapped star isn't a permanent vote on the prompt's voice corpus.
  const starSuggestion = async (body) => {
    try {
      const { data, error } = await CRM.__db?.from('reply_suggestion_stars')
        .insert({ body, contact_id: contact.id })
        .select()
        .single();
      if (error) {
        window.showToast?.(`Star failed: ${error.message}`, { kind: 'error' });
        return false;
      }
      window.showToast?.('Saved as example', {
        undo: async () => {
          if (!data?.id) return;
          await CRM.__db?.from('reply_suggestion_stars').delete().eq('id', data.id);
          window.showToast?.('Star removed');
        },
        duration: 5000,
      });
      return true;
    } catch (e) {
      window.showToast?.(`Star failed: ${e.message || e}`, { kind: 'error' });
      return false;
    }
  };
  // Reset suggestions when contact changes - they're per-thread.
  React.useEffect(() => {
    setSuggestions([]);
    setSuggestionsErr('');
  }, [contact.id]);
  const containerRef = React.useRef(null);
  // CM-38: only stick-to-bottom when the reader is ALREADY near the bottom (or
  // it's Key's own send), so an inbound text never yanks him off a spot he
  // scrolled up to read. wasNearBottom is sampled on scroll BEFORE new content
  // commits (an effect reads scrollHeight too late). forceScroll is set by
  // send() so his own message always pins to the bottom.
  const wasNearBottomRef = React.useRef(true);
  const forceScrollRef = React.useRef(false);
  // CM-38 recovery pill (Claude Design comp 2026-06-22): when a new message
  // lands while Key is scrolled up reading history (the guard correctly does
  // NOT yank him), show a "New message" pill so he knows + can jump down.
  const [showNewMsgPill, setShowNewMsgPill] = React.useState(false);
  const prevMsgCountRef = React.useRef(0);
  // Inbound-only count for the "New message" pill (audit [11]): allMsgs also
  // grows on Key's own outbound echoes + logged emails, which are not a new
  // message he needs to react to.
  const prevInboundRef = React.useRef(0);
  // Thread time display (Key 2026-06-22): no per-message timestamp; a session
  // header (date + time) only at the start of a new conversation session (a gap
  // > SESSION_GAP_MS or a new day); long-press a bubble to reveal just that
  // message's full timestamp. revealedId = the bubble currently showing its time.
  const SESSION_GAP_MS = 60 * 60 * 1000; // 1h gap opens a new session header
  const [revealedId, setRevealedId] = React.useState(null);
  const bubbleHoldRef = React.useRef(null);
  const bubbleHoldStart = React.useRef({ x:0, y:0, fired:false });
  const imgRef = React.useRef(null);
  const fileRef = React.useRef(null);
  const taRef = React.useRef(null); // compose box (contentEditable), for keep-keyboard-up refocus
  // True for one render after the user types into the compose box, so the DOM
  // sync effect below knows NOT to rewrite innerText (which would jump the
  // caret). External setMsg (send-clear, template insert, draft restore) leaves
  // it false, so those DO get written into the contentEditable div.
  const typingRef = React.useRef(false);
  // Bumps ONLY when a send fails, so a deliberate retry of the same text in the
  // same minute gets a fresh idempotency key instead of a 409 "duplicate"
  // (audit 2026-06-20). Double-clicks are already blocked by sendingRef, so the
  // minute-bucket key still dedupes those.
  const sendRetryRef = React.useRef(0);

  // Live-refresh templates when the editor saves them.
  React.useEffect(() => {
    const refresh = () => setTemplates(loadTemplates());
    window.addEventListener('crm-templates-changed', refresh);
    return () => window.removeEventListener('crm-templates-changed', refresh);
  }, []);

  // Open the Quick Replies sheet from the contact-header button. The header
  // (ContactStrip) is always mounted but this composer only mounts on the
  // messages tab, so the trigger dispatches an event + onOpenTab('messages')
  // first (mirrors the crm-edit-contact bridge). Guard on contact id.
  React.useEffect(() => {
    const open = (e) => { if (!e.detail || e.detail.contactId === contact.id) setEditingTemplates(true); };
    window.addEventListener('crm-open-quickreplies', open);
    return () => window.removeEventListener('crm-open-quickreplies', open);
  }, [contact.id]);

  // {firstName} expansion at insert time so Key can save one template
  // and have it personalize per contact.
  const expandTemplate = (t) => {
    const parts = (contact.name || '').trim().split(/\s+/);
    const first = parts[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1] : '';
    return String(t)
      .replace(/\{firstName\}/g, first)
      .replace(/\{lastName\}/g, last);
  };

  // Track every blob URL we mint so we can revoke on cleanup. Without this,
  // each photo attachment leaks its blob until the page unloads - and Key
  // adds attachments hundreds of times a day.
  const blobUrlsRef = React.useRef(new Set());
  const revokeAndForget = (url) => {
    if (url && blobUrlsRef.current.has(url)) {
      try { URL.revokeObjectURL(url); } catch {}
      blobUrlsRef.current.delete(url);
    }
  };

  // Reset locals when contact changes - also revoke any in-flight blob URLs
  // so switching contacts mid-attachment doesn't leak.
  React.useEffect(() => {
    setMsg(sessionStorage.getItem(draftKey) || '');
    setLocalMsgs([]);
    setAttachments(prev => { prev.forEach(a => revokeAndForget(a.url)); return []; });
  }, [contact.id]);

  // Key that changes whenever THIS contact's set of UNREAD inbound messages
  // changes, so a realtime full-refetch that swaps the message set without
  // changing the total count (a fresh inbound arriving as an old message rolls
  // off the 90-day / 2000-row window) still re-fires the mark-as-read. The old
  // [thread.length] dep missed that case and the inbox badge lingered on a
  // thread Key was staring at (logic audit 2026-06-22 [10]).
  const unreadInboundKey = React.useMemo(
    () => (thread || []).filter(m => m.direction === 'in' && m.read_at == null).map(m => m.id).sort().join(','),
    [thread]
  );
  // Mark inbound messages read when this exact thread opens. The shared
  // operator RPC owns the mutation and local badges move only after its exact
  // receipt, so an outage cannot silently erase triage work.
  React.useEffect(() => {
    const state = CRM.operatorCommunicationsState;
    if (!state) return;
    let active = true;
    state.markThreadRead(contact.id).then(result => {
      if (active && !result.ok) {
        window.showToast?.('Read status could not update. Reopen the thread to retry.');
      }
    });
    return () => { active = false; };
  }, [contact.id, unreadInboundKey]);

  // Revoke any remaining blob URLs on unmount.
  React.useEffect(() => () => {
    blobUrlsRef.current.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    blobUrlsRef.current.clear();
  }, []);

  // Persist draft
  React.useEffect(() => {
    if (msg) sessionStorage.setItem(draftKey, msg);
    else sessionStorage.removeItem(draftKey);
  }, [msg, draftKey]);

  // Keep the contentEditable compose box's text in sync with msg when msg
  // changes for a reason OTHER than the user typing (send-clear, template /
  // suggestion insert, scheduled-edit load, draft restore on contact switch).
  // During typing, onInput set typingRef true + msg = innerText already, so we
  // skip the rewrite and the caret stays put. We use a contentEditable div
  // (not a textarea) specifically so iOS does NOT draw its form-accessory bar
  // (the gray prev/next/Done strip) above the keyboard, letting the compose
  // bar sit directly on the keyboard.
  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (typingRef.current) { typingRef.current = false; return; }
    if (el.innerText === msg) return;
    el.innerText = msg;
    if (msg) {
      // caret to end so an inserted template lets Key keep typing
      try {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (_) {}
    }
  }, [msg]);

  // Combined view = persisted + optimistic. Dedupe by body+minute-bucket
  // so once realtime delivers the persisted row, the optimistic bubble
  // collapses into it instead of the user seeing the same message twice
  // until they switch contacts. (Server-side message ids are uuids that
  // don't match the local 'n' + Date.now() id, so id-based dedupe alone
  // doesn't work - body + minute-bucket of the persisted row is a
  // reliable match for an optimistic row Key just sent.)
  // Sent-email log (Key 2026-06-21: "every email I send gets in the chat, as
  // an internal note, different color, so I can see an email was sent + when").
  // send-email durably logs every manual send to messages_email; we read it
  // per-contact and render each as an internal "Email sent" bubble the customer
  // never sees (it lives only in the CRM thread). emailLogs are synthetic
  // render-only items (kind='email_log'), merged into allMsgs by time below.
  const [emailLogs, setEmailLogs] = React.useState([]);
  // Outbound MMS persists the photo Key texts as one or more leading
  // [media:<publicUrl>] tokens on the body (send-sms), with NO comm_attachments
  // row, so the inbound mmsAtt gallery never covers it. Two helpers fix the
  // resulting "empty navy bubble + duplicate" (audit 2026-06-22, Group 1):
  //   stripMediaTokens normalizes the persisted body to its plain text so the
  //     optimistic bubble (which carries the plain body) dedupes against it
  //     instead of both rendering; and
  //   bodyMediaUrls pulls the renderable public URLs back out for the bubble.
  // Dead api.twilio.com links (inbound tokens) are skipped; those render from
  // comm_attachments instead.
  const stripMediaTokens = (s) => (s || '').replace(/^(?:\[media:[^\]]*\]\s*)+/i, '').trim();
  const bodyMediaUrls = (s) => {
    const out = []; const re = /\[media:([^\]]+)\]/gi; let mm;
    while ((mm = re.exec(s || ''))) {
      const u = (mm[1] || '').trim();
      // Hostname ALLOWLIST, not a scheme-only check. An inbound MMS body is
      // attacker-controlled free text, so a literal [media:https://attacker/
      // beacon.gif] typed by a customer would otherwise render as an <img> and
      // beacon Key's browser (IP/timing/read-receipt) the moment he opens the
      // thread. Parse the URL and match the host exactly (the endsWith('.x')
      // requires the dot, so xtwilio.com can't spoof twilio.com), mirroring
      // isTrustedMediaUrl. Only our supabase message-media copy + twilio render;
      // api.twilio.com tokens are dead auth-gated links and render from
      // comm_attachments instead. Audit 2026-06-23.
      try {
        const url = new URL(u);
        if (url.protocol !== 'https:') continue;
        const h = url.hostname.toLowerCase();
        if (h === 'api.twilio.com') continue;
        if (h.endsWith('.supabase.co') || h.endsWith('.twilio.com')) out.push(u);
      } catch { /* not a parseable URL, skip */ }
    }
    return out;
  };
  const allMsgs = React.useMemo(() => {
    // Persisted outbound rows for optimistic-bubble dedup. Collect their ids
    // (exact match once send-sms returns the row, stamped as serverId) plus
    // (plainBody, time) pairs for a 90s tolerance fallback. The old key was a
    // minute bucket floor(ts/60000) computed from the CLIENT press time on the
    // optimistic side and the SERVER insert time on the persisted side; when
    // the two clocks straddled a minute boundary the buckets differed, dedup
    // missed, and the same outbound text rendered twice (audit 2026-06-22 [1]).
    const persistedIds = new Set();
    const persistedOut = [];
    for (const m of sortedThread) {
      if (m.id != null) persistedIds.add(String(m.id));
      if (m.direction !== 'out') continue;
      persistedOut.push({ body: stripMediaTokens(m.body), t: new Date(m.sent_at).getTime() });
    }
    const live = localMsgs.filter(m => {
      if (m.serverId != null && persistedIds.has(String(m.serverId))) return false;
      const body = stripMediaTokens(m.body);
      const t = new Date(m.sent_at).getTime();
      return !persistedOut.some(p => p.body === body && Math.abs(p.t - t) <= 90000);
    });
    // Sort the combined set by time so an email logged earlier today sits in
    // its true chronological slot, not appended after the texts.
    return [...sortedThread, ...live, ...emailLogs]
      .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
  }, [sortedThread, localMsgs, emailLogs]);

  // Fetch the contact's sent-email log; refetch when a new email is sent (the
  // emailDoc success path fires 'crm-email-logged'). messages_email is readable
  // by the CRM client and carries no realtime channel, hence the explicit event.
  const emailLogSeq = React.useRef(0);
  React.useEffect(() => {
    const seq = ++emailLogSeq.current;
    if (!CRM.__invokeFn || !contact.id) { setEmailLogs([]); return; }
    // messages_email is anon-locked, so read it through the contact-email-log
    // edge fn (service-role, contact-scoped) rather than the table directly.
    const load = () => {
      CRM.__invokeFn('contact-email-log', { body: { contact_id: contact.id } })
        .then(({ data, error }) => {
          if (seq !== emailLogSeq.current) return;
          if (error) { console.warn('[email-log] fetch failed:', error.message || error); return; }
          const rows = (data && data.logs) || [];
          setEmailLogs(rows.filter(r => r.sent_at).map(r => ({
            id: 'eml-' + r.id,
            kind: 'email_log',
            direction: 'out',
            sent_at: r.sent_at,
            email_template: r.template,
            email_subject: r.subject,
            email_to: r.to_email,
          })));
        });
    };
    load();
    const onLogged = (e) => { if (!e.detail || e.detail.contact_id === contact.id) load(); };
    window.addEventListener('crm-email-logged', onLogged);
    return () => window.removeEventListener('crm-email-logged', onLogged);
  }, [contact.id]);

  // MMS in-thread gallery (comms wiring 2026-06-10, mapped from messages-page).
  // Inbound MMS images already copy to the PUBLIC message-media bucket at
  // mms/<storage_path> (twilio-webhook). Lazily fetch comm_attachments for the
  // thread's mms messages, keyed by message_id, and render thumbnails in-bubble.
  // Only fires when the contact actually has mms; request-seq guards a slow
  // response landing after a contact switch.
  const [mmsAtt, setMmsAtt] = React.useState({});
  const mmsSeq = React.useRef(0);
  // Stable key = the sorted MMS message ids. Depending the effect on this
  // (not sortedThread.length) means a plain non-MMS text landing in an active
  // thread no longer re-fires the fetch + blanks the loaded thumbnails
  // (review 2026-06-10). Only clears mmsAtt when there genuinely are no MMS.
  const mmsIdsKey = React.useMemo(
    () => sortedThread.filter(m => m.kind === 'mms').map(m => m.id).filter(Boolean).sort().join(','),
    [sortedThread]
  );
  React.useEffect(() => {
    const seq = ++mmsSeq.current;
    const mmsIds = mmsIdsKey ? mmsIdsKey.split(',') : [];
    if (!CRM.__db || mmsIds.length === 0) { setMmsAtt({}); return; }
    CRM.__db.from('comm_attachments')
      .select('message_id, storage_path, content_type, size_bytes, source_url')
      .in('message_id', mmsIds)
      .then(({ data, error }) => {
        if (seq !== mmsSeq.current) return;
        if (error) { console.warn('[mms] attachment fetch failed:', error.message); return; }
        const map = {};
        for (const a of (data || [])) (map[a.message_id] = map[a.message_id] || []).push(a);
        setMmsAtt(map);
      });
  }, [contact.id, mmsIdsKey]);
  // Resolve a usable image URL for an attachment: prefer the public
  // message-media copy (images), else a non-Twilio https source_url, else null.
  const attImageUrl = (a) => {
    const ct = a.content_type || '';
    if (ct.startsWith('image/') && a.storage_path) {
      try { return CRM.__db.storage.from('message-media').getPublicUrl('mms/' + a.storage_path).data.publicUrl; } catch { /* fall through */ }
    }
    // source_url is the carrier-supplied Twilio MediaUrl, which is
    // attacker-influenceable on a crafted inbound-MMS row. The legit Twilio
    // media host is api.twilio.com (auth-walled: it 401s in a bare <img>, so it
    // is excluded here and the image renders from the storage_path copy above).
    // Use the SAME parsed-host allowlist the body-media + job-photo paths use,
    // NOT an inverted blocklist, so a source_url of https://attacker/beacon.gif
    // can never render an <img>/<a> beacon in Key's browser when he opens the
    // thread (audit 2026-06-23, sibling of the a313567 isTrustedMediaUrl fix).
    const su = a.source_url || '';
    if (su) {
      try {
        const u = new URL(su);
        const h = u.hostname.toLowerCase();
        if (u.protocol === 'https:' && h !== 'api.twilio.com' && (h.endsWith('.twilio.com') || h.endsWith('.supabase.co'))) return su;
      } catch (_) { /* not a valid URL, reject */ }
    }
    return null;
  };

  // Garbage-collect optimistic bubbles that the realtime channel has now
  // mirrored into sortedThread. Without this, localMsgs grows unbounded
  // for a long-lived contact session and the dedupe runs against ever-
  // larger arrays. Tied to sortedThread.length so it fires on every
  // realtime push without a separate effect.
  React.useEffect(() => {
    if (localMsgs.length === 0) return;
    const persistedIds = new Set();
    const persistedOut = [];
    for (const m of sortedThread) {
      if (m.id != null) persistedIds.add(String(m.id));
      if (m.direction !== 'out') continue;
      persistedOut.push({ body: stripMediaTokens(m.body), t: new Date(m.sent_at).getTime() });
    }
    const surviving = localMsgs.filter(m => {
      if (m.serverId != null && persistedIds.has(String(m.serverId))) return false;
      const body = stripMediaTokens(m.body);
      const t = new Date(m.sent_at).getTime();
      return !persistedOut.some(p => p.body === body && Math.abs(p.t - t) <= 90000);
    });
    if (surviving.length !== localMsgs.length) setLocalMsgs(surviving);
  }, [sortedThread.length]);

  // Stick-to-bottom for the message thread. Fires on:
  // 1. New messages arriving (allMsgs change)
  // 2. The compose textarea growing (msg change → re-layout)
  // 3. visualViewport resizing (iOS keyboard open/close shrinks --vvh
  //    which shrinks the container; without re-scrolling, the latest
  //    bubble can slide off the bottom edge)
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // CM-38 pill: fire ONLY on a new INBOUND (audit [11]). allMsgs also grows on
    // Key's own outbound echoes (a text he sent from his phone) and logged
    // emails, neither of which is a "new message" he needs to jump down for.
    // Count inbound alone so the pill matches its own contract.
    const inboundCount = allMsgs.filter(m => m.direction === 'in').length;
    const grew = inboundCount > prevInboundRef.current;
    prevInboundRef.current = inboundCount;
    prevMsgCountRef.current = allMsgs.length;
    // Only pin to the bottom if Key was already there, or this is his own
    // optimistic send. If he scrolled up to read, leave his place alone.
    if (forceScrollRef.current || wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowNewMsgPill(false);
    } else if (grew) {
      setShowNewMsgPill(true); // a message arrived while he's reading history
    }
    forceScrollRef.current = false;
  }, [allMsgs, msg]);
  // Opening a thread always starts at the newest message (reset the guard so a
  // scrolled-up position in a prior thread doesn't carry over).
  React.useEffect(() => {
    wasNearBottomRef.current = true;
    forceScrollRef.current = true;
    prevMsgCountRef.current = 0;
    prevInboundRef.current = 0;
    setShowNewMsgPill(false);
    setRevealedId(null); // a revealed timestamp doesn't carry to another thread
  }, [contact.id]);
  // Clear any pending long-press timer on unmount so it can't fire after.
  React.useEffect(() => () => { if (bubbleHoldRef.current) clearTimeout(bubbleHoldRef.current); }, []);
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined' || !window.visualViewport) return;
    const onResize = () => {
      // Use rAF so the layout finishes settling before we measure scrollHeight.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight;
      });
    };
    window.visualViewport.addEventListener('resize', onResize);
    return () => window.visualViewport.removeEventListener('resize', onResize);
  }, []);

  // Shared SMS preflight used by BOTH immediate send() and scheduled onSchedule
  // so the two guards can't drift (scheduled send used to bypass both, audit
  // 2026-06-22 Group 2/3). Returns false to block after showing a toast, true
  // to proceed. Covers the TCPA do-not-contact gate and the
  // provider's actual 1,600-character ceiling. Carrier segmenting is an
  // implementation detail and should not interrupt a normal conversation.
  const smsPreflight = async (body, extraLen = 0) => {
    if (contact.do_not_contact) {
      window.showToast?.('Marked do not contact, cannot send');
      return false;
    }
    // Count the REAL outbound length: the composer text plus the file-link URLs
    // send() appends per non-image attachment.
    const _len = (body || '').length + (extraLen || 0);
    if (_len > 1600) {
      window.showToast?.('Text is over the 1,600-character limit');
      return false;
    }
    return true;
  };
  const sendingRef = React.useRef(false);
  // Double-fire guard for the SCHEDULE path, mirroring sendingRef. onSchedule
  // is async (it awaits attachment uploads) and had no guard, so a fast
  // double-tap of a preset could enqueue two copies of the same message, each
  // with its own sched id the runner can't dedup (audit 2026-06-22 [4]/[8]).
  const schedulingRef = React.useRef(false);
  // CM-32: a parallel STATE (the ref stays the synchronous double-fire guard)
  // so the Send button can show an in-flight spinner while the message uploads
  // + dispatches. Set true alongside the ref, cleared everywhere the ref is.
  const [sending, setSending] = React.useState(false);
  const send = async () => {
    const body = msg.trim();
    // Snapshot attachments up front: the compose clears immediately (optimistic),
    // so the upload loop below + a failure-rollback both need the originals.
    const atts = [...attachments];
    if (!body && !atts.length) return;
    if (sendingRef.current) return;
    // Set the synchronous double-fire guard BEFORE any await so a fast double
    // tap can't slip two sends past the async preflight.
    sendingRef.current = true;
    setSending(true);
    // DNC gate + provider length ceiling, shared with onSchedule. Estimate the
    // file-link length (each non-image attachment appends a ~120-char public
    // URL) so the segment confirm reflects what actually goes out (audit [3]).
    const _extraLen = atts.filter(a => a.type !== 'image').length * 120;
    if (!(await smsPreflight(body, _extraLen))) { sendingRef.current = false; setSending(false); return; }
    // Optimistic bubble + clear compose immediately so Key feels the action.
    const tempId = 'n' + Date.now();
    forceScrollRef.current = true; // Key's own send always pins to the bottom
    setLocalMsgs(m => [...m, {
      id: tempId,
      contact_id: contact.id,
      direction: 'out',
      sender_role: 'key',
      body,
      attachments: atts,
      // CM-9: in-flight state so the bubble shows the ○ "sending" pulse within
      // ~100ms (feedback that names the action), then realtime swaps in the
      // persisted row carrying the real sent/delivered status (✓ / ✓✓).
      status: 'sending',
      sent_at: new Date().toISOString(),
      read_at: new Date().toISOString(),
    }]);
    setMsg('');
    // Don't revoke URLs here - the bubble preview still references them. They
    // get cleaned on contact change / unmount via blobUrlsRef.
    setAttachments([]);
    sessionStorage.removeItem(draftKey);
    // Keep the mobile keyboard up after sending: re-focus the compose box
    // synchronously inside the send gesture so iOS doesn't dismiss it (Key
    // 2026-06-20 "when I send a message the keyboard disappears").
    try { taRef.current && taRef.current.focus({ preventScroll: true }); } catch (_) {}
    if (!CRM.__invokeFn) {
      window.showToast?.('Supabase not loaded, message not sent');
      sendingRef.current = false;
      setSending(false);
      return;
    }
    try {
      // Upload any attachments to the PUBLIC message-media bucket so Twilio can
      // fetch them (same bucket inbound MMS lands in). Images go out as true
      // MMS via mediaUrls; non-image files (a permit PDF, a receipt) ride as a
      // tappable https link appended to the text, which delivers reliably over
      // SMS without depending on carrier MMS support for arbitrary file types.
      const mediaUrls = [];
      const fileLinks = [];
      for (const a of atts) {
        if (!a.file) continue;
        // The anon CRM client cannot write to message-media directly (bucket is
        // authenticated/service-only); uploadCrmMedia routes through the
        // service-role crm-media-upload fn and returns the public URL.
        const url = await uploadCrmMedia(a.file, contact.id, 'message');
        if (a.type === 'image') mediaUrls.push(url); else fileLinks.push(url);
      }
      const finalBody = body + (fileLinks.length ? (body ? '\n' : '') + fileLinks.join('\n') : '');
      const sent = await sendManualSmsWithReceipt({
        invoke: CRM.__invokeFn,
        scope: 'conversation',
        contactId: contact.id,
        body: finalBody,
        mediaUrls,
        testMode: CRM.__testMode === true,
      });
      if (!sent.ok) {
        // Rollback the optimistic bubble + restore the compose AND attachments
        // so Key can retry. Better than silently leaving a phantom "sent"
        // message or losing the photo he just attached. Peek at
        // error.context.json() so failures show the real reason (Twilio code,
        // DNC block, rate-limit) instead of the wrapper's generic message.
        setLocalMsgs(m => m.filter(x => x.id !== tempId));
        setMsg(body);
        if (atts.length) setAttachments(atts);
        window.showToast?.(`Send failed: ${sent.error}`);
        return;
      }
      window.showToast?.('Sent');
      sendRetryRef.current = 0; // clean send, reset the retry nonce
      // Stamp the optimistic bubble with the persisted row's id + server time so
      // it dedups against the realtime copy by EXACT id (and an agreeing
      // timestamp), not a minute bucket that can straddle a boundary and
      // double-render the same text (audit 2026-06-22 [1]).
      const _saved = sent.data && sent.data.message;
      if (_saved && _saved.id != null) {
        setLocalMsgs(ms => ms.map(x => x.id === tempId
          ? { ...x, serverId: _saved.id, sent_at: _saved.created_at || _saved.sent_at || x.sent_at }
          : x));
      }
      // Desk clear stack: after Key Sends, open the next prefilled draft.
      // NOTHING auto-sends the next thread.
      try {
        const peek = window.CRM?.peekDeskClearQueue ? window.CRM.peekDeskClearQueue() : null;
        if (peek && peek.active && peek.ids && peek.ids.some(x => String(x) === String(contact.id))) {
          const adv = window.CRM.advanceDeskClearQueue
            ? window.CRM.advanceDeskClearQueue(contact.id)
            : { done: true };
          if (adv.done) {
            window.showToast?.(adv.sentCount > 1
              ? ('Stack clear · ' + adv.sentCount + ' firm texts out')
              : 'Stack clear. That draft is gone.');
            try { window.bppHaptic && window.bppHaptic('success'); } catch (_) {}
          } else if (adv.nextId) {
            window.showToast?.('Next draft · ' + (adv.nextName || 'lead') + ' (' + adv.remaining + ' left)');
            setTimeout(() => openDeskClearNext(adv), 350);
          }
        }
      } catch (_) {}
    } catch (e) {
      setLocalMsgs(m => m.filter(x => x.id !== tempId));
      setMsg(body);
      if (atts.length) setAttachments(atts);
      // Ambiguous throw (attachment upload, or an unexpected error): do NOT bump
      // the nonce , if a send did slip out, the same key lets the idempotency
      // guard suppress a duplicate on retry (audit 2026-06-22).
      window.showToast?.(`Send failed: ${e.message || e}`);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleFile = e => {
    // CM-20: cap size (5 MB, the Twilio MMS practical ceiling) + count (10) up
    // front, with a clear toast, so a too-big photo fails fast here instead of
    // hanging the send (the edge fn enforces 15 MB as a hard backstop).
    const MAX_FILE_BYTES = 5 * 1024 * 1024;
    const MAX_ATTACHMENTS = 10;
    const incoming = Array.from(e.target.files);
    e.target.value = '';
    const accepted = [];
    let tooBig = 0, overCount = 0, slots = MAX_ATTACHMENTS - attachments.length;
    for (const f of incoming) {
      if (f.size > MAX_FILE_BYTES) { tooBig++; continue; }
      if (slots <= 0) { overCount++; continue; }
      slots--;
      // Keep the File object itself (`file`) so send() can upload it to
      // message-media. Images also get a local blob URL for the instant
      // preview thumbnail; non-image files show a paperclip chip.
      if (f.type.startsWith('image/')) {
        const url = URL.createObjectURL(f);
        blobUrlsRef.current.add(url);
        accepted.push({ type:'image', name:f.name, url, file:f });
      } else {
        accepted.push({ type:'file', name:f.name, size:(f.size/1024).toFixed(0)+'KB', file:f });
      }
    }
    if (accepted.length) setAttachments(a => [...a, ...accepted]);
    if (tooBig) window.showToast?.(`${tooBig === 1 ? 'That file is' : tooBig + ' files are'} over 5 MB and can't be texted. Try a smaller one.`);
    if (overCount) window.showToast?.(`You can attach up to ${MAX_ATTACHMENTS} at a time.`);
  };

  // In-thread search - finds the gate code / panel photo / permit number
  // a customer texted weeks ago without scrolling 60 messages of install
  // chatter. Hidden behind a magnifier toggle so it doesn't claim header
  // real estate every session.
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [threadQuery, setThreadQuery] = React.useState('');
  const searchInputRef = React.useRef(null);
  // CM-2: open in-thread search when the header magnifier fires. Focus the
  // field so Key can type immediately. Esc / Done closes + clears.
  React.useEffect(() => {
    const onOpen = () => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 60); };
    window.addEventListener('crm-open-search', onOpen);
    return () => window.removeEventListener('crm-open-search', onOpen);
  }, []);
  const closeSearch = () => { setSearchOpen(false); setThreadQuery(''); };
  const matchesQuery = (m) => {
    if (!threadQuery.trim()) return true;
    return (m.body || '').toLowerCase().includes(threadQuery.toLowerCase());
  };

  // Group by day for the date dividers; respects active search.
  const grouped = allMsgs.filter(matchesQuery).reduce((acc, m) => {
    const d = dayKey(m.sent_at);
    (acc[d] = acc[d] || []).push(m);
    return acc;
  }, {});
  const matchCount = threadQuery.trim() ? Object.values(grouped).reduce((s, a) => s + a.length, 0) : 0;

  // CM-29 entrance motion: fade-rise ONLY the single newest bubble, keyed off
  // the global last message id (NOT the list), so a realtime delivery-tick or
  // any re-render never re-animates the whole thread. At most one bubble ever
  // carries the animation, it plays once on that node's mount (thread open or a
  // new arrival), and the global reduced-motion rule collapses it to instant.
  const lastMsgId = allMsgs.length ? allMsgs[allMsgs.length - 1].id : null;

  // Relative-day prefix shared by the session header + the long-press reveal.
  const relDay = (iso) => {
    const k = dayKey(iso);
    return k === dayKey(new Date()) ? 'Today'
      : k === dayKey(new Date(Date.now() - 86400000)) ? 'Yesterday'
      : formatDate(iso, { weekday:'short', month:'short', day:'numeric' });
  };
  // Session header text (date + time): seen at all times at every session start.
  const sessionLabel = (m) => relDay(m.sent_at) + ' · ' + formatTime(m.sent_at);
  // Full timestamp revealed on long-press (date + time + delivery state for out).
  const revealLabel = (m) => {
    const base = relDay(m.sent_at) + ' · ' + formatTime(m.sent_at);
    if ((m.direction === 'out' || m.sender_role === 'key') && m.status) {
      const st = m.status === 'delivered' ? 'Delivered' : m.status === 'sending' ? 'Sending' : m.status === 'failed' || m.status === 'undelivered' ? 'Not delivered' : m.status === 'canceled' ? 'Canceled' : 'Sent';
      return base + ' · ' + st;
    }
    return base;
  };
  // Long-press a bubble to toggle its revealed timestamp. Movement > 8px cancels
  // (a scroll, not a hold); the click guard stops the trailing tap from also
  // toggling. Mirrors the QRCard hold pattern.
  const clearBubbleHold = () => { if (bubbleHoldRef.current) { clearTimeout(bubbleHoldRef.current); bubbleHoldRef.current = null; } };
  const startBubbleHold = (id) => (e) => {
    const t = e.touches ? e.touches[0] : e;
    bubbleHoldStart.current = { x:t.clientX, y:t.clientY, fired:false };
    clearBubbleHold();
    bubbleHoldRef.current = setTimeout(() => {
      bubbleHoldStart.current.fired = true;
      setRevealedId(prev => prev === id ? null : id);
      window.bppHaptic && window.bppHaptic('selection');
    }, 430);
  };
  const moveBubbleHold = (e) => {
    const t = e.touches ? e.touches[0] : e;
    if (Math.abs(t.clientX - bubbleHoldStart.current.x) > 8 || Math.abs(t.clientY - bubbleHoldStart.current.y) > 8) clearBubbleHold();
  };

  // Retry a failed outbound: prefill the composer with the same body + focus,
  // so Key reviews and taps Send. Real-customer SMS should ride his deliberate
  // tap (autonomy boundary), so this is prefill-not-auto-resend, "no modal".
  const retryFailed = (m) => {
    setMsg(m.body || '');
    sessionStorage.setItem(draftKey, m.body || '');
    window.showToast?.('Retry ready, tap Send');
    try { containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight }); } catch {}
  };
  // Delivery-status meta for an outbound bubble (comms wiring 2026-06-10,
  // mapped from messages-page.html). Quiet metadata: ticks answer "did it
  // land" at a glance; failed shows the friendly reason + Retry. status comes
  // from twilio-status-callback (already friendly in error_message).
  const DeliveryMeta = ({ m }) => {
    // Key 2026-06-22: the per-message TIME is gone (long-press a bubble to see
    // it). This meta now carries only the delivery STATUS , the failed-send
    // error + Retry (always), or a quiet tick for sent/delivered.
    const s = m.status;
    // CM-15: meta color #5b6576 (~5:1 on the #F8F8F6 thread bg = WCAG AA) so
    // timestamps/ticks/dividers are legible in sunlight. Was #999 (2.7:1).
    const tickStyle = { fontFamily:"'DM Mono', monospace", fontSize:11, color:'#5b6576' };
    if (s === 'failed' || s === 'undelivered') {
      return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', marginTop:3, gap:2 }}>
          {/* CM-40: honest truncation , add an ellipsis when the carrier
              reason is chopped, and keep the full text on title so the dropped
              actionable tail is still recoverable on hover/long-press. */}
          {(() => {
            const em = m.error_message ? String(m.error_message) : 'Not delivered';
            const shown = em.length > 60 ? em.slice(0, 60).trimEnd() + '…' : em;
            return <span title={em} style={{ fontSize:11, color:'#991B1B', fontWeight:600 }}>{shown}</span>;
          })()}
          {/* CM-13: Retry is the recovery control, so it gets a 44px filled
              chip that reads as tappable at rest (was a ~17px bare link). */}
          <button onClick={() => retryFailed(m)} style={{ minHeight:44, padding:'0 14px', display:'inline-flex', alignItems:'center', background:'rgba(30,64,175,0.08)', border:'none', borderRadius:8, color:'#1E40AF', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>Retry</button>
        </div>
      );
    }
    if (s === 'canceled') {
      return <div style={{ ...tickStyle, marginTop:3 }}><span style={{ textDecoration:'line-through' }}>canceled</span></div>;
    }
    // delivered = quiet double tick green; sent = single gray; sending = pulse.
    // CM-28: the ○/✓/✓✓ ticks get accessible labels so they are not cryptic
    // to a screen reader or a non-WhatsApp user.
    const mark = s === 'delivered' ? <span style={{ color:'#16a34a' }} role="img" aria-label="Delivered" title="Delivered">✓✓</span>
      : s === 'sending' ? <span style={{ color:'#bbb' }} role="img" aria-label="Sending" title="Sending">○</span>
      : <span style={{ color:'#5b6576' }} role="img" aria-label="Sent" title="Sent">✓</span>;
    return <div style={{ ...tickStyle, marginTop:3, display:'flex', alignItems:'center', gap:5 }}>{mark}</div>;
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0, position:'relative', background:'#F8F8F6' }}>
      {/* sms-01 desktop reading column (Claude Design comp 099b4334-5531-4e2a,
          chosen columnWidth 640, comfortable density). On a wide desktop panel
          the thread + composer stretched full-width so outbound bubbles ran
          800px+ and broke the reading measure. This centers the message list,
          composer, and search bar to a 640px column. The max() self-guards:
          when the panel is narrower than ~672px (the 390px mobile frame, narrow
          laptops) it resolves to the 16px full-bleed padding, so the verified
          mobile thread is untouched; the @media(min-width:900px) is a second
          belt so mobile never even sees the override. */}
      <style>{`@media (min-width:900px){ .bpp-thread-col{ padding-left:max(16px,calc((100% - 640px)/2))!important; padding-right:max(16px,calc((100% - 640px)/2))!important; } }`}</style>
      {/* v10.1.29: dedicated search row removed (Key feedback 2026-05-04) -
          the gray bar took valuable mobile vertical space for a feature
          rarely used. When search is active (toggled from contact-header
          magnifier), the compose input swaps to a search input below. */}
      <div ref={containerRef} className="bpp-thread-col"
        onScroll={() => { const el = containerRef.current; if (el) { const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120; wasNearBottomRef.current = near; if (near && showNewMsgPill) setShowNewMsgPill(false); } }}
        style={{ flex:1, overflowY:'auto', minHeight:0, padding:'12px 16px', display:'flex', flexDirection:'column' }}>
        {/* Bottom-anchor a short conversation (iOS Messages): this spacer eats
            free space above the messages so they sit just above the composer;
            when the thread overflows it collapses to 0 and scrolls normally. */}
        <div style={{ marginTop: 'auto' }} aria-hidden="true" />
        {Object.entries(grouped).map(([day, dayMsgs]) => (
          <div key={day}>
            {/* Day separator (comp: messages-page-v2 .day-mark): quiet mono
                label centered between two 1px hairlines, matching the
                system-event rows already in this timeline. */}
            {/* Session header at the day's start = date + time of the first
                message (Key 2026-06-22: only session starts show the date+time,
                always). CM-39: Today/Yesterday in plain words. */}
            <div style={{ display:'flex', alignItems:'center', gap:12, margin:'8px 0 14px', fontFamily:"'DM Mono', monospace", fontSize:11, color:'#5b6576' }}>
              <span style={{ flex:1, height:1, background:'#eceae6' }} />
              <span style={{ whiteSpace:'nowrap' }}>{sessionLabel(dayMsgs[0])}</span>
              <span style={{ flex:1, height:1, background:'#eceae6' }} />
            </div>
            {dayMsgs.map((m, mi) => {
              // Cluster math (comp: messages-page-v2). Consecutive same-
              // direction bubbles cluster: 4px apart inside a cluster, a
              // 14px gap opens a new one. Notes/system rows and failed/
              // undelivered/canceled sends are their own cluster boundary
              // so their meta (Retry, canceled strike) always shows.
              const clusterGroupOf = (x) => {
                if (!x || x.kind === 'note' || x.kind === 'system') return null;
                const dir = (x.direction === 'out' || x.sender_role === 'key') ? 'out' : 'in';
                const solo = (x.status === 'failed' || x.status === 'undelivered' || x.status === 'canceled') ? ':' + x.id : '';
                return dir + solo;
              };
              // System event row (kind='system'): a quiet centered timeline
              // marker, NOT a bubble , makes the thread the one true timeline
              // of the relationship ("Proposal signed, $1,677").
              if (m.kind === 'system') {
                return (
                  <div key={m.id} style={{ display:'flex', alignItems:'center', gap:10, margin:'10px 0', color:'#5b6576' }}>
                    <span style={{ flex:1, height:1, background:'#eceae6' }} />
                    <span style={{ fontSize:11, fontWeight:600, whiteSpace:'nowrap' }}>{m.body}</span>
                    <span style={{ flex:1, height:1, background:'#eceae6' }} />
                  </div>
                );
              }
              // Email log (kind='email_log'): an email Key sent, shown ONLY in
              // his thread (the customer never sees this row, only their email).
              // Distinct indigo + envelope so it never reads as a real SMS, with
              // which email + when. Centered like the note (an internal event).
              if (m.kind === 'email_log') {
                const EMAIL_LBL = { proposal:'Proposal', invoice:'Invoice', receipt:'Paid-in-full receipt', 'receipt-deposit':'Deposit receipt', 'receipt-partial':'Balance receipt', 'permit-approved':'Permit-approved note', completion:'Completion note', review:'Review request' };
                const lbl = EMAIL_LBL[m.email_template] || (m.email_subject || 'Email');
                return (
                  <div key={m.id} style={{ display:'flex', flexDirection:'column', alignItems:'center', marginBottom:10 }}>
                    <div style={{ maxWidth:'85%', display:'flex', alignItems:'center', gap:8, padding:'8px 13px', background:'#eef2ff', border:'1px solid #c7d2fe', borderRadius:10 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
                      <span style={{ fontSize:13, lineHeight:1.4, color:'#3730a3' }}><span style={{ fontWeight:700 }}>Email sent</span>{' · ' + lbl}</span>
                    </div>
                    <div style={{ fontSize:11, color:'#5b6576', fontFamily:"'DM Mono', monospace", marginTop:3 }}>{formatTime(m.sent_at)}{m.email_to ? ' · ' + m.email_to : ''}</div>
                  </div>
                );
              }
              // Internal note (kind='note'): operator-only, never sent. Yellow
              // paper tone, unmistakable from real messages, "Note" label.
              if (m.kind === 'note') {
                return (
                  <div key={m.id} style={{ display:'flex', flexDirection:'column', alignItems:'center', marginBottom:10 }}>
                    <div style={{ maxWidth:'85%', padding:'8px 12px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, fontSize:13, lineHeight:1.45, color:'#92400e' }}>
                      <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:'#b45309', marginBottom:3 }}>Note</div>
                      <span style={{ whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{linkify(m.body)}</span>
                    </div>
                    <div style={{ fontSize:11, color:'#5b6576', fontFamily:"'DM Mono', monospace", marginTop:3 }}>{formatTime(m.sent_at)}</div>
                  </div>
                );
              }
              const isOut = m.direction === 'out' || m.sender_role === 'key';
              const clusterG = clusterGroupOf(m);
              const newCluster = mi > 0 && clusterGroupOf(dayMsgs[mi - 1]) !== clusterG;
              const lastOfCluster = clusterGroupOf(dayMsgs[mi + 1]) !== clusterG;
              // A >1h gap within the day opens a new session header (date+time).
              const sessGap = mi > 0 && (new Date(m.sent_at).getTime() - new Date(dayMsgs[mi - 1].sent_at).getTime()) > SESSION_GAP_MS;
              return (
                <React.Fragment key={m.id}>
                {sessGap && (
                  <div style={{ display:'flex', alignItems:'center', gap:12, margin:'14px 0', fontFamily:"'DM Mono', monospace", fontSize:11, color:'#5b6576' }}>
                    <span style={{ flex:1, height:1, background:'#eceae6' }} />
                    <span style={{ whiteSpace:'nowrap' }}>{sessionLabel(m)}</span>
                    <span style={{ flex:1, height:1, background:'#eceae6' }} />
                  </div>
                )}
                <div style={{ display:'flex', flexDirection:'column', alignItems: isOut ? 'flex-end' : 'flex-start', marginBottom:4, marginTop: sessGap ? 0 : (newCluster ? 14 : 0),
                  animation: m.id === lastMsgId ? 'bpp-fade-up 200ms cubic-bezier(0.2,0.8,0.3,1) both' : undefined }}>
                  {/* Long-press a bubble to reveal its full timestamp (Key
                      2026-06-22: per-message time is hidden by default). */}
                  <div
                    onTouchStart={startBubbleHold(m.id)} onTouchMove={moveBubbleHold} onTouchEnd={clearBubbleHold}
                    onMouseDown={startBubbleHold(m.id)} onMouseMove={moveBubbleHold} onMouseUp={clearBubbleHold} onMouseLeave={clearBubbleHold}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{
                    maxWidth:'78%', padding: m.attachments?.length ? '7px' : '10px 14px',
                    fontSize:16, lineHeight:1.4,
                    borderRadius: isOut ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    // iOS Messages: received bubbles are a system-gray FILL (no
                    // border/shadow), sent bubbles are the brand navy.
                    background: isOut ? NAVY : '#E9E9EB',
                    color: isOut ? 'white' : NAVY,
                    border: 'none',
                    boxShadow: (m.status === 'failed' || m.status === 'undelivered') ? 'inset 0 0 0 1.5px rgba(220,38,38,0.55)' : 'none',
                    opacity: m.status === 'canceled' ? 0.45 : 1,
                  }}>
                    {m.attachments?.map((a,i) => a.type==='image'
                      ? <img key={i} src={a.url} alt={a.name} style={{ width:'100%', maxWidth:200, borderRadius:8, display:'block', marginBottom: m.body?5:0 }}/>
                      : <div key={i} style={{ background:'rgba(255,255,255,0.15)', borderRadius:6, padding:'5px 9px', fontSize:11, display:'flex', alignItems:'center', gap:5, marginBottom: m.body?5:0 }}>📎 {a.name} <span style={{opacity:0.6}}>{a.size}</span></div>
                    )}
                    {/* Inbound MMS attachments fetched from comm_attachments:
                        images as thumbnails (1 large, 2-4 grid), non-images as
                        a file chip. Tap an image to open full-size in a tab. */}
                    {m.kind === 'mms' && (mmsAtt[m.id] || []).length > 0 && (() => {
                      const atts = mmsAtt[m.id];
                      // Keep every image-type attachment even when its URL won't
                      // resolve safely (no storage copy + an untrusted source_url):
                      // MmsImg renders a "Photo unavailable" tile for a null url so
                      // the photo never silently vanishes (audit 2026-06-23).
                      const imgs = atts.filter(a => (a.content_type || '').startsWith('image/')).map(a => ({ a, url: attImageUrl(a) }));
                      const files = atts.filter(a => !(a.content_type || '').startsWith('image/'));
                      return (
                        <div style={{ marginBottom: m.body ? 6 : 0 }}>
                          {imgs.length > 0 && (
                            <div style={{ display:'grid', gridTemplateColumns: imgs.length === 1 ? '1fr' : 'repeat(2, 1fr)', gap:4 }}>
                              {imgs.map(({ url }, i) => (
                                <MmsImg key={i} url={url} single={imgs.length === 1} />
                              ))}
                            </div>
                          )}
                          {files.map((a, i) => {
                            // Make the file actually openable. A non-image MMS (a
                            // PDF panel label, a vCard) used to render a chip that
                            // LOOKED openable but had no link, no tap target, no way
                            // to view it (audit 2026-06-23, the dead-URL sibling of
                            // MmsImg). Resolve the public storage copy the same way
                            // images do; if none resolves, label it honestly instead
                            // of faking an openable file.
                            let furl = null;
                            if (a.storage_path) {
                              try { furl = CRM.__db.storage.from('message-media').getPublicUrl('mms/' + a.storage_path).data.publicUrl; } catch (_) {}
                            }
                            const label = (a.content_type || 'file').split('/').pop();
                            const size = a.size_bytes ? Math.round(a.size_bytes / 1024) + 'KB' : '';
                            const base = { background: isOut ? 'rgba(255,255,255,0.15)' : '#F4F6F9', borderRadius:6, fontSize:11, display:'flex', alignItems:'center', gap:5, marginTop:4 };
                            return furl
                              ? <a key={'f'+i} href={furl} target="_blank" rel="noopener noreferrer" style={{ ...base, minHeight:44, padding:'0 10px', color: isOut ? 'white' : NAVY, textDecoration:'none', cursor:'pointer' }}>
                                  📎 {label} <span style={{ opacity:0.6 }}>{size}</span>
                                </a>
                              : <div key={'f'+i} style={{ ...base, padding:'7px 9px', color:'#991B1B', fontWeight:600 }}>
                                  📎 {label} <span style={{ opacity:0.7, fontWeight:500 }}>can't open here</span>
                                </div>;
                          })}
                        </div>
                      );
                    })()}
                    {/* Outbound MMS: the photo Key texts persists only as a
                        leading [media:URL] body prefix (send-sms writes no
                        comm_attachments row), so when the inbound gallery above
                        found nothing, render the public image URLs straight from
                        the body. Reuses the inbound MMS <img> treatment. */}
                    {m.kind === 'mms' && (mmsAtt[m.id] || []).length === 0 && (() => {
                      const urls = bodyMediaUrls(m.body);
                      if (!urls.length) return null;
                      const _txt = stripMediaTokens(m.body);
                      return (
                        <div style={{ marginBottom: _txt ? 6 : 0, display:'grid', gridTemplateColumns: urls.length === 1 ? '1fr' : 'repeat(2, 1fr)', gap:4 }}>
                          {urls.map((url, i) => (
                            <MmsImg key={i} url={url} single={urls.length === 1} />
                          ))}
                        </div>
                      );
                    })()}
                    {(() => {
                      // Strip the leading [media:URL] tokens twilio-webhook prepends to
                      // inbound MMS bodies: the photo renders from comm_attachments above,
                      // so the raw token (a dead api.twilio.com link) must not show as text
                      // (audit 2026-06-20). The token stays in storage for PhotosSection.
                      const _db = (m.body || '').replace(/^(?:\[media:[^\]]*\]\s*)+/i, '').trim();
                      return _db ? <span style={{ padding: m.attachments?.length ? '0 5px' : 0, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{linkify(_db)}</span> : null;
                    })()}
                    {(() => {
                      // Guard a fully-empty bubble: an mms whose attachments did not
                      // resolve with no media token and no text, or a blank-body sms,
                      // otherwise renders as an empty padded box with no clue what it
                      // is (audit 2026-06-23). Show a quiet placeholder instead.
                      const hasAtt = (m.attachments?.length || 0) > 0;
                      const hasGallery = m.kind === 'mms' && (mmsAtt[m.id] || []).length > 0;
                      const hasBodyMedia = m.kind === 'mms' && (mmsAtt[m.id] || []).length === 0 && bodyMediaUrls(m.body).length > 0;
                      const txt = (m.body || '').replace(/^(?:\[media:[^\]]*\]\s*)+/i, '').trim();
                      if (hasAtt || hasGallery || hasBodyMedia || txt) return null;
                      return <span style={{ fontStyle:'italic', opacity:0.55, fontSize:13 }}>{m.kind === 'mms' ? 'Photo unavailable' : '(no message text)'}</span>;
                    })()}
                  </div>
                  {/* Time display (Key 2026-06-22): NO per-message time line.
                      A long-press reveals this bubble's full timestamp. The
                      last outbound of a cluster still shows its delivery TICK
                      (status, not a time) + the always-on failed/Retry meta;
                      inbound shows nothing unless long-pressed. */}
                  {revealedId === m.id
                    ? <div style={{ fontSize:11, color:'#5b6576', fontFamily:"'DM Mono', monospace", marginTop:3 }}>{revealLabel(m)}</div>
                    : (lastOfCluster && isOut && m.status ? <DeliveryMeta m={m} /> : null)}
                </div>
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </div>

      {/* Suggested replies + Templates moved into the QuickRepliesSheet,
          opened from the contact-header Quick-replies button (Key 2026-06-20:
          merge Suggest into the Templates popup + move the trigger to the
          header). The old inline suggestions strip and the composer aux strip
          (Suggest + Templates pills) are gone, so the composer below is just
          the textarea + send. */}
      {editingTemplates && <QuickRepliesSheet
        onClose={() => setEditingTemplates(false)}
        onInsertTemplate={(t) => { const t2 = expandTemplate(t); setMsg(prev => { const p = prev || ''; return p ? ((p.endsWith(' ') || p.endsWith('\n')) ? p + t2 : p + ' ' + t2) : t2; }); setEditingTemplates(false); setTimeout(() => taRef.current?.focus({ preventScroll: true }), 0); }}
        onInsertSuggestion={(s) => { setMsg(prev => { const p = prev || ''; return p ? ((p.endsWith(' ') || p.endsWith('\n')) ? p + s : p + ' ' + s) : s; }); setEditingTemplates(false); setTimeout(() => taRef.current?.focus({ preventScroll: true }), 0); }}
        suggestions={suggestions}
        suggestionsLoading={suggestionsLoading}
        suggestionsErr={suggestionsErr}
        onSuggest={fetchSuggestions}
        onStar={starSuggestion}
        templates={templates}
        resolve={expandTemplate}
        onOpenStarred={() => { setEditingTemplates(false); setStarredManagerOpen(true); }}
        isDnc={isDnc}
      />}
      {starredManagerOpen && <StarredExamplesManager onClose={() => setStarredManagerOpen(false)} />}

      {/* Attachment preview */}
      {attachments.length > 0 && (
        <div style={{ padding:'6px 12px 0', background:'transparent', display:'flex', gap:5, flexWrap:'wrap', flexShrink:0 }}>
          {attachments.map((a,i) => (
            <div key={i} style={{ position:'relative' }}>
              {a.type==='image'
                ? <img src={a.url} alt={a.name} style={{ width:52, height:52, borderRadius:6, objectFit:'cover' }}/>
                : <div style={{ width:52, height:52, borderRadius:6, background:'white', border:'1px solid rgba(11,31,59,0.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📎</div>}
              {/* CM-18: keep the 16px red dot, but the clickable area is a 44px
                  transparent hit-slop (the dot is an inner span positioned to the
                  same top-right corner) so a shaky thumb can remove a wrong photo. */}
              <button onClick={()=>setAttachments(a => a.filter((_,j) => j !== i))} aria-label="Remove attachment" style={{ position:'absolute', top:-14, right:-14, width:44, height:44, borderRadius:'50%', background:'transparent', border:'none', padding:0, cursor:'pointer', display:'flex', alignItems:'flex-start', justifyContent:'flex-end', fontFamily:'inherit' }}>
                <span aria-hidden="true" style={{ width:16, height:16, marginTop:10, marginRight:10, borderRadius:'50%', background:'#dc2626', border:'2px solid white', color:'white', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>✕</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {isDnc && (
        <div style={{ margin:'8px 16px 12px', padding:'12px 14px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, flexShrink:0 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#991B1B', marginBottom:3 }}>Compose disabled</div>
          <div style={{ fontSize:11, color:'#991B1B', lineHeight:1.5 }}>This contact is marked do-not-contact. Remove the flag to message them.</div>
        </div>
      )}

      {deskStack && deskStack.active && deskStack.remaining > 0 && (
        <div style={{
          margin: '0 16px 8px', padding: '12px 14px', flexShrink: 0,
          background: NAVY, borderRadius: 10, color: '#fff', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.25 }}>
              {(() => {
                const total = deskStack.total || deskStack.remaining;
                const done = Math.max(0, total - deskStack.remaining);
                const step = Math.min(total, done + 1);
                return step + ' of ' + total;
              })()}
            </div>
            <div style={{ fontSize: 12, opacity: 0.72, marginTop: 3 }}>
              Send. Next opens. Nothing auto-sends.
            </div>
          </div>
          <button type="button"
            aria-label="Skip this draft and open the next stacked draft"
            onClick={() => {
              const adv = window.CRM?.advanceDeskClearQueue
                ? window.CRM.advanceDeskClearQueue(contact.id, { skipped: true })
                : { done: true };
              if (adv.done) window.showToast?.('Stack ended');
              else openDeskClearNext(adv);
            }}
            style={{
              minHeight: 44, minWidth: 56, padding: '0 12px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.35)', background: 'transparent',
              color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            }}>Skip</button>
          <button type="button"
            aria-label="Cancel the desk clear stack"
            onClick={() => {
              if (window.CRM?.clearDeskClearQueue) window.CRM.clearDeskClearQueue();
              window.showToast?.('Stack cancelled. Drafts stay in composers.');
            }}
            style={{
              minHeight: 44, minWidth: 44, padding: '0 10px', borderRadius: 8,
              border: 'none', background: 'rgba(255,255,255,0.1)',
              color: '#fff', fontSize: 18, fontFamily: 'inherit', cursor: 'pointer',
            }}>×</button>
        </div>
      )}

      {!isDnc && quoteCtx && Array.isArray(quoteCtx.bits) && quoteCtx.bits.length > 0 && (
        <div style={{ margin:'0 16px 8px', padding:'10px 12px', background:'#FFF8E0', border:'1px solid rgba(255,186,0,0.45)', borderRadius:10, flexShrink:0, display:'flex', gap:10, alignItems:'flex-start' }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:'#8a5a00', marginBottom:4 }}>Walk at send</div>
            <div style={{ fontSize:13, color:NAVY, lineHeight:1.35 }}>{quoteCtx.bits.join(' · ')}</div>
            {quoteCtx.warn ? (
              <div style={{ fontSize:12, color:'#92400e', marginTop:4, fontWeight:600 }}>Confirm the cord run before you lock the number.</div>
            ) : null}
          </div>
          <button type="button" onClick={dismissQuoteCtx} aria-label="Dismiss walk context"
            style={{ minWidth:44, minHeight:44, border:'none', background:'transparent', color:MUTED, cursor:'pointer', fontSize:18, fontFamily:'inherit', flexShrink:0 }}>×</button>
        </div>
      )}

      <ScheduledMessagesStrip contactId={contact.id} />

      {/* Compose. v10.1.27: padding-bottom uses --vvs which collapses to 0
          when the keyboard is open (visualViewport.height < 600), restoring
          to env(safe-area-inset-bottom) when keyboard closed. Eliminates
          the chin gap below compose when keyboard is up. */}
      {/* Message | Note toggle now lives in the aux strip above (comp:
          messages-page-v2 .mode-toggle). Note mode still writes an internal
          annotation (never sent). */}
      {/* CM-2: in-thread search bar swaps in for the composer while active.
          The thread above filters live; Done / Esc / backdrop-tap closes. */}
      {searchOpen && threadQuery.trim() && (
        <div style={{ padding:'0 18px 4px', fontSize:11, color:'#5b6576', fontWeight:600, textAlign:'right', flexShrink:0 }}>{matchCount} {matchCount === 1 ? 'match' : 'matches'}</div>
      )}
      {searchOpen && (
        <div className="bpp-thread-col" style={{ padding:'10px 16px calc(14px + var(--vvs, env(safe-area-inset-bottom, 0px)))', display:'flex', gap:8, alignItems:'center', flexShrink:0, borderTop:'1px solid #EBEBEA', background:'white' }}>
          <div style={{ flex:1, position:'relative', display:'flex', alignItems:'center' }}>
            <svg style={{ position:'absolute', left:12, pointerEvents:'none' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6576" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input ref={searchInputRef} value={threadQuery} onChange={e => setThreadQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') closeSearch(); }}
              placeholder="Search this conversation" aria-label="Search this conversation" enterKeyHint="search"
              style={{ flex:1, minHeight:44, width:'100%', borderRadius:8, border:'1px solid rgba(11,31,59,0.15)', padding:'0 40px 0 38px', fontSize:16, fontFamily:'inherit', color:NAVY, outline:'none', background:'white', boxSizing:'border-box' }} />
            {threadQuery && (
              <button onClick={() => { setThreadQuery(''); searchInputRef.current?.focus(); }} aria-label="Clear search"
                style={{ position:'absolute', right:0, top:'50%', transform:'translateY(-50%)', width:44, height:44, border:'none', background:'none', color:'#5b6576', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, lineHeight:1, fontFamily:'inherit' }}>×</button>
            )}
          </div>
          <button onClick={closeSearch} aria-label="Close search" style={{ minHeight:44, padding:'0 14px', borderRadius:8, border:'none', background:'#1b2b4b', color:'white', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>Done</button>
        </div>
      )}
      {/* CM-38 recovery pill (Claude Design comp 2026-06-22): floats just above
          the composer when a message arrived while Key is scrolled up; tap jumps
          to the newest. Zero-height wrapper so it never shifts layout; the
          global reduced-motion rule collapses the fade. */}
      {showNewMsgPill && !searchOpen && (
        <div style={{ position:'relative', height:0, flexShrink:0, zIndex:5 }}>
          <button onClick={() => { const el = containerRef.current; if (el) el.scrollTop = el.scrollHeight; wasNearBottomRef.current = true; setShowNewMsgPill(false); }}
            aria-label="Jump to newest message"
            style={{ position:'absolute', bottom:8, left:0, right:0, margin:'0 auto', width:'fit-content', display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:9999, background:'#fff', color:'#1B2B4B', border:'1px solid #e5e7eb', boxShadow:'0 4px 14px rgba(11,31,59,0.16)', fontFamily:'inherit', fontSize:13, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', animation:'bpp-fade-up 180ms ease both' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
            New message
          </button>
        </div>
      )}
      {!isDnc && !searchOpen && (
        <div className="bpp-thread-col" style={{ padding:'10px 16px calc(14px + var(--vvs, env(safe-area-inset-bottom, 0px)))', display:'flex', gap:8, alignItems:'flex-end', flexShrink:0 }}>
          {/* Attach photo or file (Key 2026-06-21: "I don't see a way to send
              them files or images"). The + opens the native picker; handleFile
              stages the file(s), send() uploads to message-media and sends
              images as MMS / files as a tappable link. Neutral styling, the
              gold primary stays reserved for money/commit controls. */}
          {/* The native iOS file picker ("Photo Library / Take Photo / Choose
              Files") appears where iOS decides, NOT where the input lives: tested
              2026-06-23 on a real iPhone 17 / iOS 26.5 standalone PWA, a
              <label>-wrapped input filling the + button did NOT move the picker
              (it still rendered upper-middle), so the picker position is
              iOS-controlled and not adjustable from web code. Kept as a plain
              display:none input + button for correct a11y semantics. */}
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={handleFile} style={{ display:'none' }} />
          <button type="button" onClick={() => fileRef.current && fileRef.current.click()}
            aria-label="Attach photo or file" title="Attach photo or file"
            style={{ width:44, height:44, flexShrink:0, borderRadius:8, border:'1px solid rgba(11,31,59,0.15)', background:'white', color:NAVY, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit', padding:0 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          {/* Compose box is a contentEditable div, NOT a <textarea>, so iOS
              does not draw its form-accessory bar (the gray prev/next/Done
              strip) above the keyboard - the compose bar sits straight on the
              keyboard. msg stays the source of truth: onInput writes it, the
              [msg] effect above writes the DOM back on external changes (send-
              clear, template insert). Grows 44->92px via CSS min/max-height
              then scrolls (no manual height math). plaintext-only drops paste
              formatting and keeps Enter a clean newline. */}
          <div style={{ flex:1, position:'relative', display:'flex' }}>
            <div
              ref={(el) => {
                taRef.current = el;
                if (!el) return;
                // Desktop autofocus on first mount so Key can type immediately
                // when navigating to Messages - saves a tap-to-focus per visit.
                // Skip on mobile to avoid forcing the keyboard up.
                if (window.innerWidth >= 768 && !el.dataset.bppAutofocused) {
                  el.dataset.bppAutofocused = '1';
                  setTimeout(() => el.focus({ preventScroll: true }), 50);
                }
              }}
              contentEditable="plaintext-only"
              suppressContentEditableWarning={true}
              // role/aria kept for a11y. NOTE (Key 2026-06-23): on iOS 26.5
              // standalone, Safari draws its keyboard form-accessory bar (the
              // up/down/Done strip) above the keyboard for ANY editable box,
              // contentEditable included, regardless of this role. Tested live
              // (v282, role removed) , the bar persisted, so it is Apple's
              // system keyboard toolbar and not removable from a web app. The
              // role removal bought nothing, so it stays for correct semantics.
              role="textbox"
              aria-multiline="true"
              aria-label="Message"
              onInput={e => {
                typingRef.current = true;
                const el = e.currentTarget;
                // A visually-empty contentEditable can still hold a stray <br>
                // whose innerText is "\n"; textContent is '' in that case, so
                // treat it as empty (placeholder returns, no "\n" draft saved).
                setMsg(el.textContent === '' ? '' : el.innerText);
              }}
              onPaste={e => {
                // Belt-and-suspenders plain-text paste (plaintext-only already
                // strips formatting where supported; this covers older engines).
                e.preventDefault();
                const text = ((e.clipboardData || window.clipboardData)?.getData('text/plain')) || '';
                try { document.execCommand('insertText', false, text); } catch (_) {}
              }}
              onKeyDown={e=>{
                // Desktop: Enter sends, Shift+Enter newline. Mobile: Return
                // ALWAYS newlines. Send button is the only way to send on mobile.
                const isMobile = window.innerWidth < 768;
                if (e.key==='Enter' && !e.shiftKey && !isMobile) { e.preventDefault(); send(); }
              }}
              enterKeyHint="send"
              autoCorrect="on"
              autoCapitalize="sentences"
              spellCheck={true}
              style={{
                flex:1, minHeight:44, maxHeight:92,
                borderRadius:8, border:'1px solid rgba(11,31,59,0.15)',
                padding:'10px 12px', fontSize:16, fontFamily:'inherit', outline:'none',
                color:NAVY, lineHeight:1.35, boxSizing:'border-box', background:'white',
                overflowY:'auto', whiteSpace:'pre-wrap', wordBreak:'break-word',
              }}
            />
            {msg.length === 0 && (
              <div aria-hidden="true" style={{
                position:'absolute', left:13, top:11, fontSize:16, color:MUTED,
                lineHeight:1.35, pointerEvents:'none', userSelect:'none',
              }}>Message…</div>
            )}
          </div>
          <SendButton
            sending={sending}
            onSend={send}
            onSchedule={async (atIso) => {
              const body = msg.trim();
              const atts = [...attachments];
              if (!body && !atts.length) return;
              // In-flight guard mirroring send()'s sendingRef: a fast double-tap
              // of a schedule preset must not enqueue two copies (each gets its
              // own sched id the runner can't dedup) (audit 2026-06-22 [4]/[8]).
              if (schedulingRef.current) return;
              schedulingRef.current = true;
              try {
                // Same DNC gate + provider length ceiling send() runs, so a
                // scheduled message can't bypass them and surface as a silent
                // drop 60s later when it comes due (audit 2026-06-22 Group 2/3).
                // Include the projected file-link length in the total.
                const _extraLen = atts.filter(a => a.type !== 'image').length * 120;
                if (!(await smsPreflight(body, _extraLen))) return;
                // Clear the composer optimistically (mirrors send()).
                setMsg('');
                setAttachments([]);
                sessionStorage.removeItem(draftKey);
                // Upload attachments NOW, at schedule time, to durable public URLs.
                // File objects do not survive JSON.stringify into the localStorage
                // queue, so we store plain URL strings the runner can send later.
                // Same image/file split as send(): images go MMS, files ride as links.
                let mediaUrls = [], fileLinks = [];
                try {
                  for (const a of atts) {
                    if (!a.file) continue;
                    const url = await uploadCrmMedia(a.file, contact.id, 'message');
                    if (a.type === 'image') mediaUrls.push(url); else fileLinks.push(url);
                  }
                } catch (e) {
                  // Upload failed: restore the composer so nothing is lost; do not schedule.
                  setMsg(body); setAttachments(atts);
                  window.showToast?.(`Couldn't attach for scheduling: ${e.message || e}`);
                  return;
                }
                window.scheduleMessage?.({ contactId: contact.id, body, atIso, mediaUrls, fileLinks });
                const niceTime = new Date(atIso).toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
                window.showToast?.('Scheduled for ' + niceTime);
              } finally {
                schedulingRef.current = false;
              }
            }}
          />
        </div>
      )}

      {allMsgs.length === 0 && !isDnc && !searchOpen && (
        <div style={{ position:'absolute', top:'40%', left:0, right:0, textAlign:'center', color:MUTED, pointerEvents:'none' }}>
          <div style={{ fontSize:13, fontWeight:500 }}>Quiet thread.</div>
          <div style={{ fontSize:12, marginTop:2 }}>{contactName(contact)} hasn't messaged yet.</div>
        </div>
      )}
      {/* CM-2: no-results state so a search that matches nothing doesn't read
          as a blank/broken thread. */}
      {searchOpen && threadQuery.trim() && matchCount === 0 && (
        <div style={{ position:'absolute', top:'40%', left:0, right:0, textAlign:'center', color:MUTED, pointerEvents:'none' }}>
          <div style={{ fontSize:13, fontWeight:500 }}>No messages match.</div>
          <div style={{ fontSize:12, marginTop:2 }}>Try a different word.</div>
        </div>
      )}
    </div>
  );
}

// ── Contact Calls ─────────────────────────────────────────────────
// Inline editable note on a call row (post-call card, comms wiring 2026-06-10,
// mapped from call-hud.html). Writes calls.notes; optimistic + revert on error.
function CallNote({ call }) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(call.notes || '');
  const [busy, setBusy] = React.useState(false);
  // Only re-sync from the prop when NOT editing , the calls realtime channel
  // refetches wholesale on any change, and an unguarded reset wiped a note Key
  // was mid-typing (audit 2026-06-22).
  React.useEffect(() => { if (!editing) setVal(call.notes || ''); }, [call.id, call.notes, editing]);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const prev = call.notes || '';
    const next = val.trim();
    call.notes = next; // optimistic
    try {
      const { error } = await CRM.__db.from('calls').update({ notes: next || null }).eq('id', call.id);
      if (error) { call.notes = prev; window.showToast?.('Note save failed: ' + error.message, { kind: 'error' }); setVal(prev); }
      else { window.showToast?.(next ? 'Note saved' : 'Note cleared'); setEditing(false); window.dispatchEvent(new CustomEvent('crm-data-changed')); }
    } finally { setBusy(false); }
  };
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} aria-label={call.notes ? 'Edit call note' : 'Add call note'} style={{ marginTop:8, background:'none', border:'none', padding:0, cursor:'pointer', fontFamily:'inherit', textAlign:'left', width:'100%', minHeight:44, display:'flex', alignItems:'center', gap:8 }}>
        {call.notes
          ? (<>
              <span style={{ fontSize:12, color:'#374151', lineHeight:1.5, flex:1, minWidth:0 }}>{call.notes}</span>
              {/* CALL-2: a persistent low-weight 'Edit' cue so a saved note
                  advertises that it is editable at rest (self-evident design,
                  no hover/instruction needed). */}
              <span aria-hidden="true" style={{ fontSize:11, color:'#9ca3af', fontWeight:600, flexShrink:0 }}>Edit</span>
            </>)
          : <span style={{ fontSize:12, color:'#6B7280' }}>+ Add note</span>}
      </button>
    );
  }
  return (
    <div style={{ marginTop:8 }}>
      <textarea value={val} onChange={e => setVal(e.target.value)} rows={2} autoFocus
        /* CALL-3: match every other inline editor in the file, Esc cancels,
           Cmd/Ctrl+Enter saves, plain Enter stays a newline. */
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); setVal(call.notes || ''); setEditing(false); }
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
        }}
        style={{ width:'100%', boxSizing:'border-box', borderRadius:8, border:'1px solid #EBEBEA', padding:'8px 10px', fontSize:16, fontFamily:'inherit', color:NAVY, resize:'vertical' }} />
      <div style={{ display:'flex', gap:8, marginTop:6 }}>
        <button onClick={save} disabled={busy} style={{ minHeight:44, padding:'0 14px', borderRadius:8, background:GOLD, color:NAVY, border:'none', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit', opacity:busy?.6:1 }}>Save</button>
        <button onClick={() => { setVal(call.notes || ''); setEditing(false); }} style={{ minHeight:44, padding:'0 12px', borderRadius:8, background:'transparent', color:MUTED, border:'none', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
      </div>
    </div>
  );
}

// CM-4: voicemail/recording audio with honest loading + error states. The
// src is a permanent Supabase get-recording proxy URL, so a failure is a non-2xx
// proxy response (expired Twilio media, rate-limit), not a stale URL. A bare
// <audio> just plays nothing silently; this names the failure. Control height
// raised to 44px (folds in CM-33).
function CallAudio({ src, onPlayback }) {
  // A native audio element cannot attach Key's operator session. On Play,
  // fetch the protected bytes with that session and hand audio a blob URL.
  // Lazy (only on tap, so the calls list never eager-fetches every recording)
  // and authenticated. Blob is revoked on src-change + unmount.
  const [state, setState] = React.useState('idle'); // idle | loading | ready | error
  const [blobUrl, setBlobUrl] = React.useState(null);
  const blobRef = React.useRef(null);
  const revoke = () => { if (blobRef.current) { try { URL.revokeObjectURL(blobRef.current); } catch (_) {} blobRef.current = null; } };
  React.useEffect(() => { setState('idle'); setBlobUrl(null); revoke(); }, [src]);
  React.useEffect(() => () => revoke(), []);
  const load = async () => {
    if (!src) { setState('error'); return; }
    setState('loading');
    try {
      const db = window.CRM && window.CRM.__db;
      const key = (window.CRM && window.CRM.__anonKey) || '';
      const sessionResult = db ? await db.auth.getSession() : null;
      const token = sessionResult?.data?.session?.access_token || '';
      if (!token) throw new Error('operator session required');
      const res = await fetch(src, { headers: { apikey: key, Authorization: 'Bearer ' + token } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const url = URL.createObjectURL(await res.blob());
      revoke(); blobRef.current = url; setBlobUrl(url); setState('ready');
    } catch (e) { setState('error'); }
  };
  if (state === 'error') {
    return (
      <div style={{ fontSize:12, color:'#991B1B', padding:'8px 0', fontWeight:600, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <span>Recording unavailable.</span>
        <button onClick={() => { setState('idle'); setBlobUrl(null); revoke(); }}
          style={{ minHeight:44, padding:'0 14px', borderRadius:8, border:'1px solid rgba(11,31,59,0.18)', background:'#fff', color:NAVY, fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>Try again</button>
      </div>
    );
  }
  if (state === 'ready' && blobUrl) {
    return (
      <div>
        <audio controls autoPlay src={blobUrl} style={{ width:'100%', height:44 }}
          onPlay={() => onPlayback?.()} onError={() => setState('error')} />
      </div>
    );
  }
  return (
    <button onClick={load} disabled={state === 'loading'} aria-label="Play recording"
      style={{ minHeight:44, padding:'0 16px', borderRadius:8, border:'1px solid rgba(11,31,59,0.18)', background:'#fff', color:NAVY, fontSize:13, fontWeight:700, cursor: state === 'loading' ? 'wait' : 'pointer', fontFamily:'inherit', display:'inline-flex', alignItems:'center', gap:8, opacity: state === 'loading' ? 0.6 : 1 }}>
      <span aria-hidden="true">&#9654;</span>{state === 'loading' ? 'Loading…' : 'Play recording'}
    </button>
  );
}

// MMS thumbnail with a graceful fallback. A dead or expired media URL (an aged
// api.twilio.com link, a removed storage object) would otherwise render the
// browser's broken-image glyph inside the bubble, so the operator sees a
// jagged-mountain icon instead of "the customer sent a photo we can't show."
// On error, swap to a "Photo unavailable" tile in the shared error-state
// treatment (mirrors CallAudio's "Recording unavailable"). When it fails we
// also drop the wrapping link, since the target URL is the thing that 404'd.
// Resets when the url changes (a thread switch reuses the same component).
function MmsImg({ url, single, title }) {
  // A falsy url (no safe URL resolved, e.g. only an untrusted source_url that
  // the allowlist rejected) starts failed, so the photo shows the fallback tile
  // instead of silently vanishing or rendering a src-less <img>.
  const [failed, setFailed] = React.useState(!url);
  React.useEffect(() => { setFailed(!url); }, [url]);
  if (failed) {
    return (
      <div role="img" aria-label="Photo unavailable" title={title} style={{
        width:'100%', maxWidth: single ? 220 : '100%', aspectRatio: single ? '4 / 3' : '1',
        borderRadius:8, display:'flex', flexDirection:'column', alignItems:'center',
        justifyContent:'center', gap:4, background:'#F4F6F9', border:'1px solid #e5e5e5',
        color:'#991B1B', fontSize:12, fontWeight:600, textAlign:'center', padding:8, boxSizing:'border-box',
      }}>
        <span aria-hidden="true" style={{ fontSize:18, lineHeight:1 }}>&#9888;</span>
        Photo unavailable
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={title} style={{ display:'block', borderRadius:8, overflow:'hidden' }}>
      <img src={url} alt="Texted photo" loading="lazy" onError={() => setFailed(true)}
        style={{ width:'100%', maxWidth: single ? 220 : '100%', aspectRatio: single ? 'auto' : '1', objectFit:'cover', borderRadius:8, display:'block' }} />
    </a>
  );
}

// CM-5: the full call transcript is captured + searchable but was never
// readable in the UI (a search match could open a call and find nothing).
// Collapsible disclosure, collapsed by default so the card stays calm.
function FullTranscript({ text }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ marginTop:8 }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ minHeight:44, padding:'0 2px', background:'none', border:'none', color:'#1E40AF', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit', display:'inline-flex', alignItems:'center', gap:6 }}>
        <span aria-hidden="true" style={{ display:'inline-block', transition:'transform .15s ease', transform: open ? 'rotate(90deg)' : 'none' }}>&#9656;</span>
        {open ? 'Hide transcript' : 'Full transcript'}
      </button>
      {open && <div style={{ fontSize:13, color:NAVY, lineHeight:1.5, fontStyle:'italic', marginTop:4, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{text}</div>}
    </div>
  );
}

function ContactCalls({ contact, calls, isDnc }) {
  const sorted = [...calls].sort((a,b) => (b.started_at||'').localeCompare(a.started_at||''));
  // CM-CALL-1: per-row in-flight state so the tap is acknowledged in <100ms
  // (BPPVoice.call awaits Twilio device registration, ~1s of silence on the
  // browser-dial path). Mirrors the dialer's setCalling, and closes the
  // missing double-tap guard at the same time.
  const [callingId, setCallingId] = React.useState(null);
  // Call back remains fail-closed until the durable browser rail is released.
  const callBack = async (cl) => {
    if (isDnc) { window.showToast?.('Marked do not contact, cannot call'); return; }
    if (callingId) return; // guard the async window against a double-tap = double call
    const num = contact?.phone || cl.from_phone;
    if (!num) { window.showToast?.('No number to call back'); return; }
    const e164 = '+1' + String(num).replace(/\D/g, '').replace(/^1/, '').slice(-10);
    setCallingId(cl.id);
    try {
      const ok = window.BPPVoice ? await window.BPPVoice.call(e164, contact?.name) : false;
      if (!ok) window.showToast?.('Calling is not released yet.');
    } catch (e) {
      console.warn('[callBack] browser call failed closed:', e?.message || e);
      window.showToast?.('Calling is not released yet.');
    } finally {
      setCallingId(null);
    }
  };

  const ICON_OUT = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/>
    </svg>
  );
  const ICON_IN = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="17" y1="7" x2="7" y2="17"/><polyline points="16 17 7 17 7 8"/>
    </svg>
  );
  const ICON_MISSED = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
    </svg>
  );
  const STYLES = {
    out:    { bg:'#dcfce7', color:'#16a34a', icon: ICON_OUT,    label:'Outgoing' },
    in:     { bg:'#dbeafe', color:'#2563eb', icon: ICON_IN,     label:'Incoming' },
    missed: { bg:'#fee2e2', color:'#dc2626', icon: ICON_MISSED, label:'Missed'   },
    // Likely-spam inbound (twilio-voice routes it straight to voicemail). Muted
    // grey so it does not compete with a real call; the reason shows below.
    spam:   { bg:'#f3f4f6', color:'#6b7280', icon: ICON_MISSED, label:'Spam'     },
    // Neutral fallback so an unknown direction never falsely asserts "Outgoing".
    call:   { bg:'#f3f4f6', color:'#6b7280', icon: ICON_IN,     label:'Call'     },
  };

  const fmtRow = iso => `${formatDate(iso, { month:'short', day:'numeric' })} · ${formatTime(iso)}`;

  return (
    <div style={{ flex:1, overflowY:'auto', minHeight:0, padding:'12px 16px var(--tabbar-clear, calc(env(safe-area-inset-bottom, 0px) + 92px))' }}>
      <button disabled style={{
        width:'100%', height:44, borderRadius:8,
        background:'#E5E7EB', color:MUTED,
        border:'none', cursor:'not-allowed',
        fontSize:14, fontWeight:600, fontFamily:'inherit',
        marginBottom:12, padding:'12px 16px',
      }}>{isDnc ? 'DNC, calls disabled' : 'Calling is not released yet'}</button>

      {sorted.map(cl => {
        const isSpam = cl.status === 'spam';
        const s = isSpam ? STYLES.spam : (STYLES[cl.direction] || STYLES.call);
        const dur = (cl.direction === 'missed' || isSpam) ? '-' : formatDuration(cl.duration_sec);
        const transcript = cl.voicemail_transcript || cl.voicemail_transcription || '';
        return (
          <div key={cl.id} style={{
            background:'white', border:'1px solid rgba(11,31,59,0.08)', borderRadius:8,
            padding:'12px 14px', marginBottom:8,
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{
                width:32, height:32, borderRadius:'50%',
                background: cl.voicemail_url ? '#EDE9FE' : s.bg, color: cl.voicemail_url ? '#7C3AED' : s.color,
                display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
              }}>{cl.voicemail_url ? <div style={{ width:14, height:14 }}>{Icons.voicemail}</div> : s.icon}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:600, color:NAVY, display:'flex', alignItems:'center', gap:6 }}>
                  {cl.voicemail_url ? 'Voicemail' : s.label}
                  {cl.voicemail_url && cl.listened_at == null && <span title="Unheard" style={{ width:7, height:7, borderRadius:'50%', background:'#7C3AED', flexShrink:0 }} />}
                </div>
                <div style={{ fontSize:12, color:'#666', marginTop:2, fontFamily:"'DM Mono', monospace" }}>
                  {fmtRow(cl.started_at)}{cl.answered_by ? ` · ${cl.answered_by === 'cell' ? 'on your cell' : 'in browser'}` : ''}
                </div>
              </div>
              <div style={{ fontSize:13, fontWeight:600, color:NAVY, fontFamily:"'DM Mono', monospace", flexShrink:0 }}>{dur}</div>
            </div>
            {/* Missed-call: one obvious next action. DNC-guarded real dial. */}
            {cl.direction === 'missed' && !cl.voicemail_url && !isDnc && (
              <button onClick={() => callBack(cl)} disabled={callingId === cl.id} aria-busy={callingId === cl.id ? true : undefined} style={{ marginTop:10, width:'100%', minHeight:44, borderRadius:8, background:'transparent', color:NAVY, border:'1px solid rgba(11,31,59,0.18)', fontSize:13, fontWeight:600, cursor: callingId === cl.id ? 'wait' : 'pointer', fontFamily:'inherit', opacity: callingId === cl.id ? 0.6 : 1 }}>{callingId === cl.id ? 'Calling…' : 'Call back'}</button>
            )}
            {/* Spam reason (twilio-voice routed it to voicemail). Muted so Key can
                see WHY a call was filtered, without it reading like a real call. */}
            {isSpam && cl.notes && (
              <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid rgba(11,31,59,0.06)', fontSize:12.5, color:'#6b7280', lineHeight:1.5 }}>
                {cl.notes}
              </div>
            )}
            {/* AI summary of the call (Haiku, written by transcribe-call). */}
            {cl.ai_summary && (
              <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid rgba(11,31,59,0.06)' }}>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:'#8A6D1A', marginBottom:4 }}>&#10022; Summary</div>
                <div style={{ fontSize:13, color:'#374151', lineHeight:1.5 }}>{cl.ai_summary}</div>
              </div>
            )}
            {/* Voicemail playback + transcription. Twilio's transcribe
                hands us the text; we render it below the row so Key
                doesn't need to listen while driving. */}
            {cl.voicemail_url && (
              <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid rgba(11,31,59,0.06)' }}>
                {transcript ? (
                  <div style={{ fontSize:13, color:NAVY, lineHeight:1.5, fontStyle:'italic', marginBottom:8 }}>
                    "{transcript}"
                  </div>
                ) : (
                  <div style={{ fontSize:11, color:MUTED, marginBottom:8 }}>{window.transcriptUnavailable?.(cl.started_at) ? 'Transcript unavailable' : 'Transcribing…'}</div>
                )}
                <CallAudio src={cl.voicemail_url} onPlayback={async () => {
                  const state = CRM.operatorCommunicationsState;
                  const result = state
                    ? await state.markVoicemailListened(cl.id)
                    : { ok: false };
                  if (!result.ok) {
                    window.showToast?.('Voicemail status was not saved. Play again to retry.');
                  }
                }} />
                {/* CM-24: a voicemail is the highest-intent inbound, so it gets the
                    same DNC-guarded one-tap Call back the missed-call card has. */}
                {!isDnc && (
                  <button onClick={() => callBack(cl)} disabled={callingId === cl.id} aria-busy={callingId === cl.id ? true : undefined} style={{ marginTop:10, width:'100%', minHeight:44, borderRadius:8, background:'transparent', color:NAVY, border:'1px solid rgba(11,31,59,0.18)', fontSize:13, fontWeight:600, cursor: callingId === cl.id ? 'wait' : 'pointer', fontFamily:'inherit', opacity: callingId === cl.id ? 0.6 : 1 }}>{callingId === cl.id ? 'Calling…' : 'Call back'}</button>
                )}
              </div>
            )}
            {/* Recording playback for an answered (non-voicemail) call. */}
            {cl.recording_url && !cl.voicemail_url && (
              <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid rgba(11,31,59,0.06)' }}>
                <div style={{ fontSize:11, color:MUTED, marginBottom:6, fontWeight:600 }}>Recording</div>
                <CallAudio src={cl.recording_url} />
                {cl.transcript && <FullTranscript text={cl.transcript} />}
              </div>
            )}
            <CallNote call={cl} />
          </div>
        );
      })}

      {sorted.length === 0 && (
        <div style={{ padding:'40px 24px', textAlign:'center', fontSize:13, color:MUTED }}>No calls yet</div>
      )}
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────
// Centered card on desktop, bottom-sheet on mobile (≤900px). Backdrop
// click closes; Escape key closes (top of stack only); focus traps
// inside the card while open. Renders via portal to body so the modal
// sits above all panes regardless of which subtree mounted it.
//
// Module-level scroll lock + escape stack so two stacked modals don't
// (a) leave the body permanently scroll-locked, or (b) close all-at-once
// on a single Escape keystroke.
let __modalLockCount = 0;
const __modalEscapeStack = [];
// Background-scroll lock. Toggling document.body.overflow is a NO-OP in this
// app: html/body/#root are all height:var(--vvh) + overflow:hidden, so body is
// not the scroll root. Real scrolling happens in the inner overflowY:auto panes
// (the message thread, the contact list), which keep touch-action:pan-y. So an
// open modal let the thread scroll behind it (Key 2026-06-20). Fix: add a class
// to <html> while ANY modal is open; the CSS freeze in index.html
// (html.crm-modal-open #root [overflowY]) hard-stops those inner panes. Modals
// portal OUTSIDE #root (to document.body), so their own scroll is unaffected.
// Ref-counted so stacked modals don't unlock early.
function __setModalLockClass(on) {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('crm-modal-open', on);
  }
}
function __pushModalLock(closeFn) {
  if (__modalLockCount === 0) __setModalLockClass(true);
  __modalLockCount += 1;
  if (closeFn) __modalEscapeStack.push(closeFn);
}
function __popModalLock(closeFn) {
  const i = __modalEscapeStack.indexOf(closeFn);
  if (i >= 0) __modalEscapeStack.splice(i, 1);
  __modalLockCount = Math.max(0, __modalLockCount - 1);
  if (__modalLockCount === 0) __setModalLockClass(false);
}
// Exposed so non-ModalShell overlays (ConfirmHost, sheets) can share the same
// ref-counted background-scroll lock instead of each re-implementing it.
if (typeof window !== 'undefined') {
  window.__crmPushModalLock = __pushModalLock;
  window.__crmPopModalLock = __popModalLock;
}
if (typeof document !== 'undefined' && !window.__modalEscapeBound) {
  window.__modalEscapeBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = __modalEscapeStack[__modalEscapeStack.length - 1];
    if (top) { e.stopPropagation(); top(); }
  });
}

function ModalShell({ open, onClose, title, footer, children, hideClose, headerRight }) {
  const overlayRef = React.useRef(null);
  const cardRef = React.useRef(null);

  // Keep the latest onClose in a ref so the lock effect can safely depend
  // ONLY on `open`. Otherwise an inline `() => setOpen(false)` parent prop
  // re-creates the function each render, the effect re-runs every realtime
  // tick, and the escape stack reorders incorrectly when modals stack.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  React.useEffect(() => {
    if (!open) return;
    const closeFn = () => beginCloseRef.current();
    __pushModalLock(closeFn);
    // Focus the card so subsequent Tab cycles inside it.
    setTimeout(() => cardRef.current?.focus(), 0);
    // Audit-2026-05-09 a11y M1: focus trap. Without this, a keyboard-
    // only user pressing Tab past the last focusable element in a modal
    // moves focus into the underlying contact list / message thread /
    // nav buttons. Cycle Tab inside the modal; Shift+Tab from the first
    // focusable wraps to the last.
    const onTab = (e) => {
      if (e.key !== 'Tab' || !cardRef.current) return;
      const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const els = Array.from(cardRef.current.querySelectorAll(FOCUSABLE))
        .filter((el) => el.offsetParent !== null /* visible */ );
      if (els.length === 0) { e.preventDefault(); cardRef.current.focus(); return; }
      const first = els[0];
      const last  = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !cardRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onTab);
    return () => {
      __popModalLock(closeFn);
      document.removeEventListener('keydown', onTab);
    };
  }, [open]);

  // Animate-out-then-close (Key 2026-06-21: "popups come and go instantly").
  // The modal already animates IN. But every consumer conditionally MOUNTS it
  // (the `cond && <Sheet/>` + `open={true}` pattern), so an open-driven exit
  // never fires , the parent yanks it from the tree the instant it closes.
  // Fix without touching consumers: intercept EVERY close path, play the
  // reverse animation, THEN call the parent onClose (which unmounts).
  // reduced-motion closes immediately.
  const [exiting, setExiting] = React.useState(false);
  const closeTimer = React.useRef(null);
  const beginClose = () => {
    if (closeTimer.current) return; // already animating out
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { onClose && onClose(); return; }
    setExiting(true);
    closeTimer.current = setTimeout(() => { onClose && onClose(); }, 195);
  };
  const beginCloseRef = React.useRef(beginClose);
  beginCloseRef.current = beginClose;
  React.useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  if (!open) return null;
  // 900px matches the app shell's mobile/desktop split (crm-app.jsx). iPad
  // Mini at 768px gets the bottom-sheet so the modal feels native, not a
  // tiny popup floating in the middle.
  const isMobile = (typeof window !== 'undefined' && window.innerWidth < 900);

  const overlay = (
    <div
      ref={overlayRef}
      onMouseDown={(e) => { if (e.target === overlayRef.current) beginClose(); }}
      style={{
        // Height tracks the VISUAL viewport (--vvh), not the full layout
        // viewport, so when the iOS keyboard opens the overlay ends at the
        // keyboard's top edge and the bottom-anchored sheet rides ABOVE the
        // keyboard instead of sliding behind it (Key 2026-06-22: the Quick
        // Replies input + footer were buried under the keyboard).
        position:'fixed', top:0, left:0, right:0, height:'var(--vvh, 100dvh)', zIndex:9999,
        background:'rgba(11,31,59,0.45)',
        display:'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent:'center',
        padding: isMobile ? 0 : 16,
        // Swallow touch-drags on the dimmed backdrop so they can't reach the
        // pane behind; the card's own content still scrolls (it sets pan-y).
        touchAction:'none', overscrollBehavior:'none',
        pointerEvents: exiting ? 'none' : 'auto',
        animation: exiting ? 'bpp-fade-up 160ms ease-in reverse both' : 'bpp-fade-up 180ms ease-out both',
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        style={{
          background:'white',
          borderRadius: isMobile ? '16px 16px 0 0' : 12,
          width: isMobile ? '100%' : 'min(440px, calc(100vw - 32px))',
          // --vvh tracks visualViewport.height (set by index.html). When the
          // iOS keyboard pops up, --vvh shrinks so the bottom sheet's footer
          // (Send button + content) stays visible above the keyboard. dvh
          // is a fallback for browsers without our visualViewport listener.
          // Subtract env(safe-area-inset-top) on mobile so the bottom-sheet's
          // top edge stops BELOW the Dynamic Island / notch instead of sliding
          // under it (Key 2026-06-21: "it hides behind the iPhone's Dynamic
          // Island"). --vvh is the full visual viewport (the island overlays
          // it), so the inset is what keeps the header reachable.
          maxHeight: isMobile ? 'calc(var(--vvh, 92dvh) - 24px - env(safe-area-inset-top, 0px))' : 'calc(var(--vvh, 88vh) - 80px)',
          display:'flex', flexDirection:'column',
          boxShadow:'0 20px 60px rgba(11,31,59,0.25)',
          outline:'none',
          paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : 0,
          animation: exiting
            ? (isMobile ? 'bpp-slide-up 190ms cubic-bezier(0.4,0,1,1) reverse both' : 'bpp-fade-up 160ms cubic-bezier(0.4,0,1,1) reverse both')
            : (isMobile ? 'bpp-slide-up 220ms cubic-bezier(0.2,0.8,0.3,1) both' : 'bpp-fade-up 220ms cubic-bezier(0.2,0.8,0.3,1) both'),
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ padding: hideClose ? '12px 18px 10px' : '10px 14px 10px 18px', borderBottom:'1px solid rgba(11,31,59,0.08)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexShrink:0 }}>
          <div style={{ flex:1, minWidth:0, fontSize:15, fontWeight:700, color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{title}</div>
          {/* Optional right-aligned header action (Key 2026-06-22: moved the
              "Manage saved examples" link up here, across from the title). */}
          {headerRight}
          {/* hideClose (Key 2026-06-21): drop the X for sheets that auto-save +
              dismiss by tapping the dimmed backdrop, so there is one obvious way
              out instead of four competing controls. Esc + backdrop tap still
              close (both call beginClose). */}
          {!hideClose && (
            <button onClick={beginClose} aria-label="Close" style={{
              width:44, height:44, borderRadius:6, border:'none', background:'transparent',
              color:'#666', fontSize:24, lineHeight:1, cursor:'pointer', fontFamily:'inherit',
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
            }}>×</button>
          )}
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'14px 18px' }}>
          {children}
        </div>
        {footer && (
          // safe-area-inset-bottom keeps the action buttons clear of the
          // iPhone home indicator on the bottom-sheet variant.
          <div style={{
            padding:'12px 18px calc(14px + env(safe-area-inset-bottom, 0px))',
            borderTop:'1px solid rgba(11,31,59,0.08)', flexShrink:0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}

// ── Creator v2 shared styles (comp: comps/creator-modal-v2.html) ───────
// Claude Design comp "CRM Proposal Creator v3" (2026-06-11), mapped 1:1.
// One zone grammar for both money tools: 11px caps labels with a hairline,
// 26px breathing room between zones, mono money everywhere, and a sticky
// bottom number bar so the total never leaves the screen. Class-based (a
// <style> tag rendered by each creator) because :focus / :hover /
// aria-pressed states can't be expressed in inline styles. cm2- prefix
// keeps it scoped to the two creators only.
const CM2_CSS = `
.cm2-zone { margin-bottom: 26px; }
.cm2-zlabel { display:flex; align-items:center; gap:10px; font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#9ca3af; margin:0 0 10px; }
.cm2-zlabel::after { content:""; flex:1; height:1px; background:rgba(27,43,75,0.08); }
.cm2-amp-row { display:flex; gap:8px; margin-bottom:14px; }
.cm2-amp { flex:1; min-height:48px; border-radius:12px; border:1px solid #e5e5e5; background:#fff; font-size:15px; font-weight:700; color:#5a6478; display:inline-flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; font-family:inherit; transition:border-color 180ms, background 180ms, color 180ms; }
.cm2-bp { font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:11px; font-weight:500; color:#8a93a6; }
.cm2-amp[aria-pressed="true"] { background:#1B2B4B; border-color:#1B2B4B; color:#fff; }
.cm2-amp[aria-pressed="true"] .cm2-bp { color:rgba(255,255,255,0.65); }
.cm2-cord-row { display:flex; align-items:center; gap:14px; min-height:48px; margin-bottom:6px; }
.cm2-cl { font-size:13px; font-weight:600; color:#5a6478; flex:0 0 auto; }
.cm2-range { flex:1; min-width:0; height:44px; -webkit-appearance:none; appearance:none; background:transparent; outline:0; }
.cm2-range::-webkit-slider-runnable-track { height:4px; border-radius:2px; background:linear-gradient(to right, #ffba00 0%, #ffba00 var(--fill, 0%), #eef1f6 var(--fill, 0%)); }
.cm2-range::-webkit-slider-thumb { -webkit-appearance:none; width:24px; height:24px; border-radius:50%; background:#fff; border:2px solid #1B2B4B; margin-top:-10px; box-shadow:0 2px 8px rgba(27,43,75,0.07); }
.cm2-range::-moz-range-track { height:4px; border-radius:2px; background:#eef1f6; }
.cm2-range::-moz-range-progress { height:4px; border-radius:2px; background:#ffba00; }
.cm2-range::-moz-range-thumb { width:20px; height:20px; border-radius:50%; background:#fff; border:2px solid #1B2B4B; }
.cm2-cv { flex:0 0 56px; text-align:right; font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:15px; font-weight:600; color:#1B2B4B; font-variant-numeric:tabular-nums; }
.cm2-scope-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px; }
.cm2-scope { min-width:0; min-height:48px; border-radius:12px; border:1px solid #e5e5e5; background:#fff; padding:0 12px; font-size:13px; font-weight:600; color:#8a93a6; display:inline-flex; align-items:center; gap:8px; text-align:left; cursor:pointer; font-family:inherit; transition:border-color 180ms, color 180ms, background 180ms; }
.cm2-chk { flex:0 0 auto; width:20px; height:20px; border-radius:6px; border:1.5px solid rgba(27,43,75,0.25); display:inline-flex; align-items:center; justify-content:center; color:transparent; transition:background 180ms, border-color 180ms, color 180ms; }
.cm2-chk svg { width:11px; height:11px; }
.cm2-scope[aria-pressed="true"] { color:#1B2B4B; }
.cm2-scope[aria-pressed="true"] .cm2-chk { background:#1B2B4B; border-color:#1B2B4B; color:#fff; }
.cm2-sp { margin-left:auto; font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:11px; color:#8a93a6; }
.cm2-adders { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.cm2-adder { min-width:0; min-height:56px; border-radius:12px; border:1.5px dashed rgba(27,43,75,0.12); background:#fff; padding:8px 12px; text-align:left; display:flex; flex-direction:column; justify-content:center; gap:2px; cursor:pointer; font-family:inherit; transition:border-color 180ms, opacity 180ms; }
.cm2-adder:hover { border-color:#ffba00; }
.cm2-an { font-size:13px; font-weight:600; line-height:1.3; color:#1B2B4B; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cm2-ap { font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:11px; color:#5a6478; }
.cm2-adder[disabled] { opacity:0.5; border-style:solid; cursor:default; }
.cm2-li { display:flex; align-items:center; gap:6px; min-height:52px; padding:2px 0; }
.cm2-li + .cm2-li { border-top:1px solid rgba(27,43,75,0.08); }
.cm2-grip { flex:0 0 auto; width:24px; height:44px; display:inline-flex; align-items:center; justify-content:center; color:rgba(27,43,75,0.22); cursor:grab; }
.cm2-grip svg { width:11px; height:15px; }
.cm2-grip svg circle { fill:currentColor; stroke:none; }
.cm2-inc { flex:0 0 auto; width:44px; height:44px; display:inline-flex; align-items:center; justify-content:center; }
.cm2-nm { flex:1; min-width:0; height:44px; font-size:16px; background:transparent; border:0; outline:0; border-radius:8px; padding:0 6px; color:#1B2B4B; font-family:inherit; }
.cm2-nm:focus { background:#eef1f6; }
.cm2-excluded .cm2-nm, .cm2-excluded .cm2-amt-w { opacity:0.45; text-decoration:line-through; }
.cm2-amt-w { flex:0 0 auto; display:inline-flex; align-items:center; font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:16px; color:#1B2B4B; }
.cm2-cur { color:#8a93a6; font-size:13px; }
.cm2-amt { width:72px; height:44px; font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:16px; text-align:right; background:transparent; border:0; outline:0; border-radius:8px; padding:0 4px; color:#1B2B4B; font-variant-numeric:tabular-nums; -moz-appearance:textfield; }
.cm2-amt::-webkit-outer-spin-button, .cm2-amt::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
.cm2-amt:focus { background:#eef1f6; }
.cm2-rm { flex:0 0 auto; width:44px; height:44px; border-radius:12px; border:0; background:none; display:inline-flex; align-items:center; justify-content:center; color:#8a93a6; cursor:pointer; font-family:inherit; transition:background 180ms, color 180ms; }
.cm2-rm:hover { background:#eef1f6; color:#1B2B4B; }
.cm2-rm svg { width:12px; height:12px; }
.cm2-li.cm2-disc { background:#fff8e1; border-radius:12px; border-top:0; margin-top:6px; padding:2px 6px 2px 0; }
.cm2-dl { flex:1; min-width:0; font-size:13px; font-weight:700; color:#8a5a00; padding-left:12px; }
.cm2-dnm { font-weight:700; color:#8a5a00; padding-left:12px; }
.cm2-dseg { flex:0 0 auto; display:inline-flex; background:#fff; border:1px solid #e5e5e5; border-radius:8px; padding:2px; gap:2px; }
.cm2-dseg button { width:44px; height:44px; border-radius:6px; border:0; background:none; font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:14px; color:#8a93a6; cursor:pointer; }  /* 2026-07-04 audit: was 38x36, below the 44px tap floor in the proposal/invoice discount editor */
.cm2-dseg button[aria-pressed="true"] { background:#1B2B4B; color:#fff; }
.cm2-add-pair { display:flex; gap:8px; margin-top:10px; }
.cm2-ghost { min-height:44px; padding:0 14px; border-radius:100px; border:1.5px dashed rgba(27,43,75,0.12); background:none; font-size:13px; font-weight:700; color:#5a6478; display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-family:inherit; transition:border-color 180ms, color 180ms; }
.cm2-ghost:hover { border-color:#ffba00; color:#1B2B4B; }
.cm2-ghost[disabled] { opacity:0.45; cursor:not-allowed; }
.cm2-ghost svg { width:12px; height:12px; }
.cm2-dep-seg { display:flex; gap:6px; }
.cm2-dep { flex:1; min-height:48px; border-radius:12px; border:1px solid #e5e5e5; background:#fff; display:inline-flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; font-size:13px; font-weight:700; color:#5a6478; cursor:pointer; font-family:inherit; transition:background 180ms, border-color 180ms, color 180ms; }
.cm2-dv { font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:11px; font-weight:500; color:#8a93a6; }
.cm2-dep[aria-pressed="true"] { background:#1B2B4B; border-color:#1B2B4B; color:#fff; }
.cm2-dep[aria-pressed="true"] .cm2-dv { color:rgba(255,255,255,0.65); }
.cm2-type-row { display:flex; gap:6px; }
.cm2-typ { flex:1; min-height:56px; border-radius:12px; border:1px solid #e5e5e5; background:#fff; display:inline-flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; font-size:13px; font-weight:700; color:#5a6478; cursor:pointer; font-family:inherit; transition:background 180ms, border-color 180ms, color 180ms; }
.cm2-tv { font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:12px; font-weight:600; color:#8a93a6; }
.cm2-typ[aria-pressed="true"] { background:#1B2B4B; border-color:#1B2B4B; color:#fff; }
.cm2-typ[aria-pressed="true"] .cm2-tv { color:#ffba00; }
.cm2-balance-note { margin:10px 0 0; font-size:12px; color:#8a93a6; }
.cm2-mono { font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; color:#5a6478; }
.cm2-note { width:100%; min-height:56px; resize:vertical; border-radius:12px; border:1px solid #e5e5e5; background:#fff; padding:10px 12px; font-family:inherit; font-size:16px; line-height:1.5; color:#1B2B4B; outline:0; box-sizing:border-box; transition:border-color 180ms; }
.cm2-note:focus { border-color:#ffba00; }
.cm2-note::placeholder { color:#8a93a6; }
.cm2-numbar { display:flex; align-items:center; gap:12px; background:#fff; }
.cm2-numbar.cm2-inline { position:sticky; bottom:0; z-index:2; border-top:1px solid rgba(27,43,75,0.12); padding:12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); box-shadow:0 -4px 16px rgba(27,43,75,0.08); border-radius:0 0 8px 8px; }
.cm2-numbar.cm2-flat { background:transparent; }
.cm2-nw { flex:1; min-width:0; }
.cm2-total { display:block; font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:18px; font-weight:600; letter-spacing:-0.01em; color:#1B2B4B; font-variant-numeric:tabular-nums; }
.cm2-depline { display:block; font-family:'JetBrains Mono','DM Mono',ui-monospace,monospace; font-size:13px; color:#5a6478; margin-top:1px; }
.cm2-pomline { display:block; font-size:12px; color:#8a93a6; margin-top:2px; }
.cm2-cta { flex:0 0 auto; height:48px; padding:0 20px; border-radius:100px; border:0; background:#ffba00; color:#1B2B4B; font-size:15px; font-weight:700; font-family:inherit; box-shadow:0 2px 10px rgba(255,186,0,0.3); white-space:nowrap; cursor:pointer; transition:background 180ms, transform 180ms; }
.cm2-cta:hover { background:#ffc519; }
.cm2-cta:active { transform:scale(0.97); }
.cm2-cta[disabled] { background:#E5E5E5; color:#999; box-shadow:none; cursor:not-allowed; transform:none; }
`;

// ── New Proposal Modal / Inline Composer (V3, sketch 2026-05-08) ───────
// Single creator: amp pills → length slider → 4 toggle pills (cord, inlet,
// permit, peace of mind) → +Line Item / +Discount with drag-reorder →
// total + deposit toggle → Send. PoM is creator-side only; when offered,
// the client sees an opt-in checkbox on proposal.html (NOT pre-checked,
// NOT in displayed total). Cord/inlet/permit are creator-only toggles -
// flipping off subtracts from total + adds a discreet "customer providing
// own X" line on the rendered proposal (price decrease never shown).
//
// Edit mode: passing editingProposal rehydrates the form. v2 proposals
// lift cleanly into v3 fields; saving rewrites as creator_version='v3'.
function NewProposalModal({ contact, onClose, inline = false, editingProposal = null }) {
  const isEdit = !!editingProposal;
  const ep = editingProposal || {};

  // One-shot prefill from a QuickQuote -> proposal handoff (tap-audit #4):
  // read + CLEAR the stashed selections so they seed THIS fresh create exactly
  // once (never an edit, never the next proposal). Mount-only useMemo. The
  // line-item names below match the Quick Add QA names verbatim so the QA tiles
  // dim (the dedup in addQuickItem keys on lowercased name) instead of letting
  // Key double-add an adapter / breaker.
  const pf = React.useMemo(() => {
    if (isEdit) return null;
    const p = window.__pendingProposalPrefill || null;
    // Clear it either way (one-shot), but only APPLY it when it was stamped for
    // THIS contact, so a stale/mismatched prefill can never seed an unrelated
    // proposal (money surface, regression review 2026-06-16).
    if (p) window.__pendingProposalPrefill = null;
    return (p && p.contactId === contact.id) ? p : null;
  }, []);

  // Default amp from existing proposal, otherwise the contact's panel spec.
  const [amp, setAmp] = React.useState(() => {
    if (isEdit && ['30','50'].includes(String(ep.amp_type))) return String(ep.amp_type);
    if (pf && ['30','50'].includes(String(pf.amp))) return String(pf.amp);
    // contacts.amperage is the real column (enrichment whitelist); the old
    // contact.panel_amps was a phantom that never existed in the DB.
    return ['30','50'].includes(String(contact.amperage)) ? String(contact.amperage) : '30';
  });
  const [lengthFt,       setLengthFt]      = React.useState(() => isEdit ? (Number(ep.length_ft) || 5) : (pf ? (Number(pf.lengthFt) || 5) : 5));
  const [includeCord,    setIncludeCord]   = React.useState(() => isEdit ? ep.include_cord    !== false : (pf ? pf.includeCord   !== false : true));
  const [includeInlet,   setIncludeInlet]  = React.useState(() => isEdit ? ep.include_inlet   !== false : (pf ? pf.includeInlet  !== false : true));
  const [includePermit,  setIncludePermit] = React.useState(() => isEdit ? ep.include_permit  !== false : (pf ? pf.includePermit !== false : true));
  const [pomOffered,     setPomOffered]    = React.useState(() => isEdit ? !!ep.pom_offered : (pf ? !!pf.pomOffered : false));
  // Deposit REQUIRED by default on new proposals (Key 2026-07-11: "I do
  // require a deposit now"). The toggle is the opt-out for the rare
  // exception; edits keep whatever the existing proposal says.
  const [requireDeposit, setRequireDeposit]= React.useState(() => isEdit ? !!ep.require_deposit : true);
  const [notes,          setNotes]         = React.useState(() => isEdit ? (ep.notes || '') : '');
  // Line items: { id, kind: 'item'|'discount', name, amount, checked, discountType }.
  const [lineItems, setLineItems] = React.useState(() => {
    if (!isEdit) {
      // QuickQuote handoff seeds the matching adder rows (names match the QA
      // tiles verbatim so they dim, no double-add). Everything else stays
      // hand-editable exactly like a normal create.
      if (pf && Array.isArray(pf.lineItems)) {
        return pf.lineItems.map(li => ({
          id: 'qa_' + Math.random().toString(36).slice(2,8),
          kind: 'item', name: li.name, amount: Number(li.amount) || 0, checked: true,
        }));
      }
      return [];
    }
    const items = (Array.isArray(ep.extra_line_items) ? ep.extra_line_items : []).map(li => ({
      id: li.id || ('i_' + Math.random().toString(36).slice(2,8)),
      kind: 'item',
      name: li.name || '',
      amount: Number(li.amount) || 0,
      checked: li.checked !== false,
    }));
    if (ep.discount_type && Number(ep.discount_value) > 0) {
      items.push({
        id: 'd_' + Math.random().toString(36).slice(2,8),
        kind: 'discount', name: 'Discount',
        discountType: ep.discount_type,
        amount: Number(ep.discount_value),
        checked: true,
      });
    }
    return items;
  });
  const [busy, setBusy] = React.useState(false);
  const [dragIdx, setDragIdx] = React.useState(null);
  // ref shadow so onDrop reads the live value, not the stale closure value.
  // React state updates from onDragStart aren't visible to onDrop's render
  // when the events fire close together - the ref bypasses that race.
  const dragIdxRef = React.useRef(null);

  const total = React.useMemo(() => quoteV3Total({
    amp, lengthFt, includeCord, includeInlet, includePermit, lineItems,
  }), [amp, lengthFt, includeCord, includeInlet, includePermit, lineItems]);

  const hasDiscount = lineItems.some(li => li.kind === 'discount');
  const addItem = () => setLineItems(prev => [...prev, {
    id: 'i_' + Math.random().toString(36).slice(2,8),
    kind: 'item', name: '', amount: 0, checked: true,
  }]);
  const addDiscount = () => {
    if (hasDiscount) return;
    setLineItems(prev => [...prev, {
      id: 'd_' + Math.random().toString(36).slice(2,8),
      kind: 'discount', name: 'Discount', discountType: 'dollar', amount: 0, checked: true,
    }]);
  };
  // 2026-05-09: Quick Add - one-click pre-filled line items for the most
  // common adders (panel work, surge, adapter). Sourced from V3_PRICING
  // so the dollar amounts stay in sync with QuickQuoteModal. The user
  // can edit name/amount/checked on the resulting row exactly like a
  // hand-typed line item - these rows aren't system-locked.
  const QA_PRICES = (window.V3_PRICING) || {};
  // Standalone surge RETIRED from Quick Add (Key decision 2026-06-09): surge
  // is part of the $447 Peace of Mind package (the SCOPE toggle above), not a
  // separate add-on. A one-off surge-only job can still be quoted via
  // + Line Item.
  const QA = [
    { key:'mainBreaker', name:'Main breaker replacement',  amount: QA_PRICES.mainBreaker || 225, show: true },
    { key:'twinQuad',    name:'Panel space (twin / quad)', amount: QA_PRICES.twinQuad    || 125, show: true },
    { key:'adapter',     name:'30→50A cord adapter',       amount: QA_PRICES.adapter     || 150, show: amp === '50' },
  ];
  // Hide a Quick Add tile (dim to 'added' state) if a row with the same
  // name already exists, so Key doesn't double-add by accident.
  const lineItemNames = new Set(lineItems.filter(li => li.kind === 'item').map(li => (li.name || '').toLowerCase()));
  const addQuickItem = (qa) => {
    if (lineItemNames.has(qa.name.toLowerCase())) return;
    setLineItems(prev => [...prev, {
      id: 'qa_' + Math.random().toString(36).slice(2,8),
      kind: 'item', name: qa.name, amount: qa.amount, checked: true,
    }]);
  };
  // (The surge/PoM combo-discount auto-adjust effect lived here; removed with
  // the standalone surge retirement, surge is inside the PoM package now.)
  const updateItem = (i, patch) => setLineItems(prev => prev.map((li, idx) => idx === i ? { ...li, ...patch } : li));
  const removeItem = (i) => setLineItems(prev => prev.filter((_, idx) => idx !== i));
  const moveItem = (from, to) => setLineItems(prev => {
    if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
    const next = [...prev];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });

  const submit = async () => {
    if (busy) return;
    if (!isEdit && contact.do_not_contact) {
      window.showToast?.('Marked do not contact, cannot send');
      return;
    }
    if (!CRM.__db) {
      window.showToast?.('Supabase not loaded');
      return;
    }
    setBusy(true);
    try {
      const discountItem = lineItems.find(li => li.kind === 'discount');
      const extraLI = lineItems.filter(li => li.kind !== 'discount').map(li => ({
        id: li.id, name: li.name || '', amount: Number(li.amount) || 0, checked: li.checked !== false,
      }));
      const payload = {
        contact_id:      contact.id,
        contact_name:    contact.name    || '',
        contact_email:   contact.email   || '',
        contact_phone:   contact.phone   || '',
        contact_address: contact.address || '',
        creator_version: isEdit ? (ep.creator_version || 'v3') : 'v4',
        amp_type:        amp,
        selected_amp:    amp,
        length_ft:       lengthFt,
        run_ft:          lengthFt,                // legacy mirror
        include_cord:    !!includeCord,
        cord_included:   !!includeCord,           // legacy mirror
        include_inlet:   !!includeInlet,
        include_permit:  !!includePermit,
        include_surge:   false,
        pom_offered:     !!pomOffered,
        // Audit-2026-05-09 M9: in edit mode `ep` was captured at modal
        // mount; if the customer accepts PoM via the proposal page
        // (realtime flips proposals.pom_accepted) WHILE the modal is
        // open, saving any tweak silently overwrites the customer's
        // choice with the stale false. Re-resolve from the live
        // CRM.proposals row at submit time so we always merge in the
        // latest server value.
        pom_accepted:    (() => {
          if (!isEdit) return false;
          const live = (window.CRM?.proposals || []).find(p => p.id === ep.id);
          if (live && typeof live.pom_accepted === 'boolean') return live.pom_accepted;
          return !!ep.pom_accepted;
        })(),
        include_pom:     false,                    // never auto-included; opt-in on client page
        selected_pom:    false,
        pom_price:       (window.V3_PRICING?.pom) || 447,
        require_deposit: !!requireDeposit,
        discount_type:   discountItem ? discountItem.discountType : null,
        discount_value:  discountItem ? Number(discountItem.amount) || 0 : null,
        discount_amount: discountItem && discountItem.discountType === 'dollar' ? Number(discountItem.amount) || 0 : 0,
        extra_line_items: extraLI,
        custom_items:    extraLI.map(li => ({ title: li.name, price: li.amount })), // legacy mirror
        total,
        price_base:      total,
        price_cord:      0, price_surge: 0,
        notes:           notes.trim(),
      };
      let data, error;
      if (isEdit) {
        ({ data, error } = await CRM.__db.from('proposals').update(payload).eq('id', ep.id)
          .in('status', ['Created', 'Draft', 'draft']).select().single());
      } else {
        // Initial status 'Created' (renders as Draft pill via mapProposal). The
        // Send button on the FinanceRow is the trigger for SMS dispatch - Create
        // just saves the document, leaving Key in control of cadence.
        ({ data, error } = await CRM.__db.from('proposals').insert([{ ...payload, deposit_rate: 0.20, status: 'Created' }]).select().single());
        // 2026-05-26: when creating a NEW proposal for a contact who has
        // pre-existing un-sent un-superseded drafts, supersede those so
        // the rotting/staleViewed signals + the DealCard don't show
        // ghost drafts. Replays the Will Gribble case (two same-day
        // drafts, only one was ever sent - the older one lingered).
        if (!error && data) {
          try {
            await CRM.__db.from('proposals')
              .update({ superseded_at: new Date().toISOString(), superseded_by: data.id })
              .eq('contact_id', contact.id)
              .is('signed_at', null)
              .is('sent_at', null)
              .is('copied_at', null)
              .is('superseded_at', null)
              .neq('id', data.id);
          } catch (_) { /* non-fatal - supersede is a hygiene win, not critical */ }
        }
      }
      if (error || !data || data.ok === false) {
        window.showToast?.(`${isEdit ? 'Update' : 'Create'} failed: ${error?.message || data?.error || 'unknown'}`);
        setBusy(false);
        return;
      }
      // Optimistically push the new proposal into CRM.proposals so the
      // row renders immediately. Realtime would do this eventually, but
      // there's a perceptible gap where the modal closes and the user
      // sees an empty / stale list. Use the SAME mapper the refetch path
      // uses (mapProposal, global from crm-data.js) so the optimistic row
      // can never drift from the canonical shape (the hand-rolled copy
      // here back-dated sent_at on fresh drafts and dropped the
      // copied_at/superseded mirrors).
      const mapped = mapProposal(data);
      const arr = (window.CRM.proposals = window.CRM.proposals || []);
      const idx = arr.findIndex(p => p.id === mapped.id);
      if (idx >= 0) arr[idx] = mapped; else arr.unshift(mapped);
      // Bump contact stage NEW → QUOTED on first proposal create.
      // Audit-2026-05-09 H7: this was fire-and-forget - submit() called
      // onClose() before the stage write resolved, so a failure toast
      // landed after the modal had closed AND a subsequent close+open
      // could race with the original write. Now awaited + rolled back
      // before onClose so the user actually sees the failure feedback.
      if (!isEdit && contact.stage === 'new') {
        const numQuoted = CRM.STAGE_STR_TO_NUM?.quoted ?? 2;
        contact.stage = 'quoted';
        try {
          const { error: stageErr } = await CRM.__db.from('contacts').update({ stage: numQuoted }).eq('id', contact.id);
          if (stageErr) {
            contact.stage = 'new';
            window.dispatchEvent(new CustomEvent('crm-data-changed'));
            window.showToast?.(`Stage update failed: ${stageErr.message}`, { kind:'error' });
          }
        } catch (err) {
          contact.stage = 'new';
          window.dispatchEvent(new CustomEvent('crm-data-changed'));
          window.showToast?.(`Stage update failed: ${err?.message || err}`, { kind:'error' });
        }
      }
      window.dispatchEvent(new CustomEvent('crm-data-changed'));
      window.showToast?.(isEdit ? 'Proposal updated' : 'Proposal created');
      onClose();
    } catch (e) {
      window.showToast?.(`Failed: ${e.message || e}`);
      setBusy(false);
    }
  };

  // ── UI: comp-mapped composition (Claude Design comp at
  // comps/creator-modal-v2.html, "CRM Proposal Creator v3", 2026-06-11).
  // Zone grammar: BUILD / LINE ITEMS / TERMS / CUSTOMER NOTE + the sticky
  // number bar (THE NUMBER, total never leaves the screen). Composition and
  // rhythm only; every computation, payload field, save path, and default
  // above this line is untouched.
  const fmt$ = (n) => '$' + (Number(n) || 0).toLocaleString();
  // Display-only deposit math for the Terms pills + number bar. Same
  // V3_PRICING.depositRate expression the old label used; the persisted
  // deposit_rate write in submit() (known-deferred hardcode) is untouched.
  const depRate = (window.V3_PRICING?.depositRate) || 0.2;
  const depPct  = Math.round(depRate * 100);
  const depAmt  = Math.round(total * depRate);
  const fillPct = Math.round(((lengthFt - 5) / 95) * 100);

  const CHECK_SVG = (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-6" /></svg>
  );
  const GRIP_SVG = (
    <svg viewBox="0 0 12 16" aria-hidden="true">
      <circle cx="4" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" />
      <circle cx="4" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" />
      <circle cx="4" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" />
    </svg>
  );
  const PLUS_SVG = (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1v10M1 6h10" /></svg>
  );
  const X_SVG = (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 2.5l9 9M11.5 2.5l-9 9" /></svg>
  );

  const Scope = ({ on, onClick, label, price }) => (
    <button type="button" className="cm2-scope" aria-pressed={on} onClick={onClick}>
      <span className="cm2-chk">{CHECK_SVG}</span>
      {label}
      <span className="cm2-sp">{price}</span>
    </button>
  );

  const renderLineRow = (li, i) => {
    const isDiscount = li.kind === 'discount';
    return (
      <div
        key={li.id}
        className={'cm2-li' + (isDiscount ? ' cm2-disc' : '') + (!isDiscount && li.checked === false ? ' cm2-excluded' : '')}
        draggable
        onDragStart={() => { dragIdxRef.current = i; setDragIdx(i); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          const from = dragIdxRef.current;
          if (from != null) moveItem(from, i);
          dragIdxRef.current = null;
          setDragIdx(null);
        }}
        onDragEnd={() => { dragIdxRef.current = null; setDragIdx(null); }}
        style={{ opacity: dragIdx === i ? 0.5 : 1, cursor: dragIdx === i ? 'grabbing' : 'default' }}
      >
        <span className="cm2-grip" title="Drag to reorder">{GRIP_SVG}</span>
        {isDiscount ? (
          <React.Fragment>
            {/* Static label, not an input: the typed name was never persisted
                (the discount row is filtered out of extra_line_items; only
                type/value/amount survive) and the customer page hardcodes
                "Your discount", so an editable field here threw input away. */}
            <span className="cm2-dl">{li.name || 'Discount'}</span>
            <span className="cm2-dseg">
              <button type="button" aria-pressed={li.discountType === 'dollar'} onClick={() => updateItem(i, { discountType: 'dollar' })}>$</button>
              <button type="button" aria-pressed={li.discountType === 'percent'} onClick={() => updateItem(i, { discountType: 'percent' })}>%</button>
            </span>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <span className="cm2-inc">
              <input
                type="checkbox"
                checked={li.checked !== false}
                onChange={(e) => updateItem(i, { checked: e.target.checked })}
                title="Pre-checked for client (client can uncheck)"
                style={{ width:20, height:20, accentColor: NAVY, cursor:'pointer', margin:0 }}
              />
            </span>
            <input
              className="cm2-nm"
              type="text"
              value={li.name}
              onChange={(e) => updateItem(i, { name: e.target.value })}
              placeholder="Service name"
              aria-label="Line item name"
            />
          </React.Fragment>
        )}
        <span className="cm2-amt-w">
          {!isDiscount && <span className="cm2-cur">$</span>}
          <input
            className="cm2-amt"
            type="number"
            inputMode="decimal"
            min="0" step="1"
            value={li.amount}
            onChange={(e) => updateItem(i, { amount: parseFloat(e.target.value) || 0 })}
            aria-label={isDiscount ? 'Discount value' : 'Amount'}
          />
        </span>
        <button type="button" className="cm2-rm" onClick={() => removeItem(i)} aria-label="Remove">{X_SVG}</button>
      </div>
    );
  };

  const formBody = (
    <div>
      <style>{CM2_CSS}</style>

      {/* BUILD: amp, run length, scope, quick adders. One zone, one decision set. */}
      <div className="cm2-zone">
        <p className="cm2-zlabel">Build</p>
        <div className="cm2-amp-row">
          <button type="button" className="cm2-amp" aria-pressed={amp === '30'} onClick={() => setAmp('30')}>
            30A <span className="cm2-bp">{fmt$((QA_PRICES.base || {})['30'] || 1197)}</span>
          </button>
          <button type="button" className="cm2-amp" aria-pressed={amp === '50'} onClick={() => setAmp('50')}>
            50A <span className="cm2-bp">{fmt$((QA_PRICES.base || {})['50'] || 1497)}</span>
          </button>
        </div>
        <div className="cm2-cord-row">
          <span className="cm2-cl">Length</span>
          <input
            type="range" min="5" max="100" step="5" value={lengthFt}
            onChange={(e) => setLengthFt(parseInt(e.target.value, 10) || 5)}
            className="cm2-range"
            style={{ '--fill': fillPct + '%' }}
            aria-label="Run length"
          />
          <span className="cm2-cv">{lengthFt} ft</span>
        </div>
        <div className="cm2-scope-grid">
          <Scope on={includeCord}   onClick={() => setIncludeCord(v => !v)}   label="Cord"   price={fmt$((QA_PRICES.cordOff  || {})[amp] || 0)} />
          <Scope on={includeInlet}  onClick={() => setIncludeInlet(v => !v)}  label="Inlet"  price={fmt$((QA_PRICES.inletOff || {})[amp] || 0)} />
          <Scope on={includePermit} onClick={() => setIncludePermit(v => !v)} label="Permit" price={fmt$(QA_PRICES.permitOff || 125)} />
          <Scope on={pomOffered}    onClick={() => setPomOffered(v => !v)}    label="Peace of Mind" price={fmt$(QA_PRICES.pom || 447)} />
        </div>
        {pomOffered && (
          <div style={{
            fontSize:11, color:'#92400E', fontStyle:'italic', margin:'0 0 14px',
            padding:'8px 12px', background:'#FFFBEB', border:'1px solid #FDE68A',
            borderLeft:`3px solid ${GOLD}`, borderRadius:6,
          }}>
            Visible to client as opt-in (not pre-checked, not in displayed total).
          </div>
        )}
        <div className="cm2-adders">
          {QA.filter(qa => qa.show).map(qa => {
            const added = lineItemNames.has(qa.name.toLowerCase());
            return (
              <button
                key={qa.key} type="button" className="cm2-adder"
                onClick={() => addQuickItem(qa)}
                disabled={added}
                title={added ? 'Already on this proposal' : `Add "${qa.name}" line item`}
              >
                <span className="cm2-an">{qa.name}</span>
                <span className="cm2-ap">{added ? 'Added' : '+' + fmt$(qa.amount)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* LINE ITEMS: rows first, ghost adders below (comp order). */}
      <div className="cm2-zone">
        <p className="cm2-zlabel">Line items</p>
        {lineItems.length > 0 && (
          <div>{lineItems.map((li, i) => renderLineRow(li, i))}</div>
        )}
        <div className="cm2-add-pair">
          <button type="button" className="cm2-ghost" onClick={addItem}>{PLUS_SVG}Line item</button>
          <button type="button" className="cm2-ghost" onClick={addDiscount} disabled={hasDiscount}>{PLUS_SVG}Discount</button>
        </div>
      </div>

      {/* TERMS: same requireDeposit boolean as before, presented as the
          comp's two-state segment. The to-book amounts are display only. */}
      <div className="cm2-zone">
        <p className="cm2-zlabel">Terms</p>
        <div className="cm2-dep-seg">
          <button type="button" className="cm2-dep" aria-pressed={!requireDeposit} onClick={() => setRequireDeposit(false)}>
            None<span className="cm2-dv">$0 to book</span>
          </button>
          <button type="button" className="cm2-dep" aria-pressed={requireDeposit} onClick={() => setRequireDeposit(true)}>
            {depPct}%<span className="cm2-dv">{fmt$(depAmt)} to book</span>
          </button>
        </div>
      </div>

      {/* CUSTOMER NOTE */}
      <div className="cm2-zone" style={{ marginBottom: 0 }}>
        <p className="cm2-zlabel">Customer note</p>
        <textarea
          className="cm2-note"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Special instructions, access notes…"
          rows={2}
        />
        <div style={{ display:'inline-flex', alignItems:'center', gap:5, marginTop:5, fontSize:11, color:'#9CA3AF' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          Visible to customer
        </div>
      </div>
    </div>
  );

  // THE NUMBER: all-in total (18px mono) + deposit-today + single gold CTA.
  // CTA labels stay honest: Create saves a draft (Send lives on the
  // FinanceRow), so the comp's "Create + Send" label is deliberately not
  // adopted. Disabled logic identical to the old footer button.
  const ctaDisabled = busy || (!isEdit && contact.do_not_contact);
  const numberBar = (flat) => (
    <div className={'cm2-numbar' + (flat ? ' cm2-flat' : ' cm2-inline')}>
      <span className="cm2-nw">
        <span className="cm2-total">{fmt$(total)}</span>
        {requireDeposit && <span className="cm2-depline">{fmt$(depAmt)} deposit today</span>}
        {pomOffered && <span className="cm2-pomline">+${(window.V3_PRICING?.pom) || 447} if client opts into Peace of Mind</span>}
      </span>
      <button type="button" className="cm2-cta" onClick={submit} disabled={ctaDisabled}>
        {busy ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save changes' : 'Create proposal')}
      </button>
    </div>
  );

  if (inline) {
    return (
      <div data-card style={{
        background:'white', border:'1px solid rgba(11,31,59,0.12)', borderRadius:8,
        marginBottom:12,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px 12px', borderBottom:'1px solid rgba(27,43,75,0.08)' }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:800, letterSpacing:'-0.01em', color:NAVY }}>{isEdit ? 'Edit proposal' : 'New proposal'}</div>
            <div style={{ fontSize:12, color:'#5a6478', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{contact.name || formatPhone(contact.phone)}</div>
          </div>
          <button onClick={onClose} aria-label="Cancel" style={{
            width:44, height:44, borderRadius:12, border:'none', background:'transparent',
            color:'#5a6478', fontSize:22, lineHeight:1, cursor:'pointer', fontFamily:'inherit',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
          }}>×</button>
        </div>
        <div style={{ padding:'18px 16px 16px' }}>{formBody}</div>
        {numberBar(false)}
      </div>
    );
  }

  return (
    <ModalShell
      open={true}
      onClose={onClose}
      title={`${isEdit ? 'Edit proposal' : 'New proposal'}: ${contact.name || formatPhone(contact.phone)}`}
      footer={numberBar(true)}
    >
      {formBody}
    </ModalShell>
  );
}

// ── New Invoice Modal (V3, sketch 2026-05-08) ─────────────────────────
// Same line-items + discount editing model as the proposal creator, but
// no deposit toggle (per Key's spec). Type picker (Deposit/Final/Balance)
// is a one-click preset that pre-fills line items; Key can then add /
// remove / reorder / discount before sending.
function NewInvoiceModal({ contact, latestSignedProposal, invoices, onClose, inline = false, editingInvoice = null, receiptMode = false }) {
  const isEdit = !!editingInvoice;
  const ei = editingInvoice || {};
  const usesV4Terms = !isEdit || String(ei.creator_version || '').toLowerCase() === 'v4';

  const proposalTotal = (latestSignedProposal?.amount_cents || 0) / 100;
  const billedSum = invoices
    // In edit mode the invoice being edited is still in the list; counting
    // it would shrink `remaining` by its own amount and break the Final
    // preset (it would suggest $0 even when room exists). Exclude self.
    .filter(i => i.id !== ei.id && !['voided', 'refunded', 'draft', 'declined'].includes(i.status))
    .reduce((s,i) => s + (i.amount_cents || 0), 0) / 100;
  const remaining = Math.max(0, proposalTotal - billedSum);

  const [lineItems, setLineItems] = React.useState(() => {
    if (isEdit) {
      const items = (Array.isArray(ei.line_items) ? ei.line_items : []).map(li => ({
        id: li.id || ('i_' + Math.random().toString(36).slice(2,8)),
        kind: li.kind || (li.discountType ? 'discount' : 'item'),
        name: li.name || '',
        amount: Number(li.amount) || 0,
        checked: li.checked !== false,
        discountType: li.discountType || null,
      }));
      return items;
    }
    // Default preset: the live deposit rate (20%, Key cutover 2026-06-09) if
    // there's an approved proposal, otherwise empty. Was hardcoded 50% after
    // the policy moved to 20% (walkthrough finding #17).
    if (proposalTotal > 0) {
      const _dr = (window.V3_PRICING?.depositRate) || 0.2;
      return [{
        id: 'i_' + Math.random().toString(36).slice(2,8),
        kind: 'item', name: Math.round(_dr * 100) + '% deposit', amount: Math.round(proposalTotal * _dr), checked: true,
      }];
    }
    return [];
  });
  const [busy, setBusy] = React.useState(false);
  const [paymentMethod, setPaymentMethod] = React.useState('Cash');
  const [paymentNote, setPaymentNote] = React.useState('');
  const [dueAt, setDueAt] = React.useState(() => {
    if (isEdit && ei.due_at) return String(ei.due_at).slice(0, 10);
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  });
  const [paymentTerms, setPaymentTerms] = React.useState(() => (
    isEdit && ei.payment_terms ? ei.payment_terms : 'Due upon receipt'
  ));
  const [receivedAt, setReceivedAt] = React.useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [dragIdx, setDragIdx] = React.useState(null);
  // ref shadow so onDrop reads the live value, not the stale closure value.
  // React state updates from onDragStart aren't visible to onDrop's render
  // when the events fire close together - the ref bypasses that race.
  const dragIdxRef = React.useRef(null);

  const total = React.useMemo(() => {
    let t = 0;
    for (const li of lineItems) {
      if (li.kind === 'discount') {
        if (li.discountType === 'percent') t -= t * (Number(li.amount) || 0) / 100;
        else                                 t -= Number(li.amount) || 0;
      } else {
        t += Number(li.amount) || 0;
      }
    }
    return Math.max(0, Math.round(t * 100) / 100);
  }, [lineItems]);

  const hasDiscount = lineItems.some(li => li.kind === 'discount');
  const addItem = () => setLineItems(prev => [...prev, {
    id: 'i_' + Math.random().toString(36).slice(2,8),
    kind: 'item', name: '', amount: 0, checked: true,
  }]);
  const addDiscount = () => {
    if (hasDiscount) return;
    setLineItems(prev => [...prev, {
      id: 'd_' + Math.random().toString(36).slice(2,8),
      kind: 'discount', name: 'Discount', discountType: 'dollar', amount: 0, checked: true,
    }]);
  };
  const updateItem = (i, patch) => setLineItems(prev => prev.map((li, idx) => idx === i ? { ...li, ...patch } : li));
  const removeItem = (i) => setLineItems(prev => prev.filter((_, idx) => idx !== i));
  const moveItem = (from, to) => setLineItems(prev => {
    if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
    const next = [...prev]; const [m] = next.splice(from, 1); next.splice(to, 0, m); return next;
  });

  // Quick presets - replace current line items with the preset.
  const applyPreset = (kind) => {
    const id = () => 'i_' + Math.random().toString(36).slice(2,8);
    if (kind === 'deposit' && proposalTotal > 0) {
      const _dr = (window.V3_PRICING?.depositRate) || 0.2;
      setLineItems([{ id: id(), kind: 'item', name: Math.round(_dr * 100) + '% deposit', amount: Math.round(proposalTotal * _dr), checked: true }]);
    } else if (kind === 'final') {
      setLineItems([{ id: id(), kind: 'item', name: 'Final balance', amount: Math.round(remaining), checked: true }]);
    } else if (kind === 'balance') {
      setLineItems([{ id: id(), kind: 'item', name: 'Balance due', amount: 0, checked: true }]);
    }
  };

  const submit = async () => {
    if (busy) return;
    if (total <= 0) {
      window.showToast?.('Total must be greater than 0');
      return;
    }
    if (receiptMode && (!receivedAt || Number.isNaN(new Date(receivedAt).getTime()))) {
      window.showToast?.('Choose when the payment was received');
      return;
    }
    if (!isEdit && !receiptMode && contact.do_not_contact) {
      window.showToast?.('Marked do not contact, cannot send');
      return;
    }
    if (!CRM.__db) {
      window.showToast?.('Supabase not loaded');
      return;
    }
    setBusy(true);
    try {
      // Stored line_items keep the kind/discountType so editor can rehydrate.
      const storedItems = lineItems.map(li => ({
        id: li.id, kind: li.kind, name: li.name || '',
        amount: Number(li.amount) || 0,
        checked: li.checked !== false,
        discountType: li.discountType || undefined,
      }));
      const payload = {
        contact_id: contact.id,
        proposal_id: latestSignedProposal?.id || (isEdit ? ei.proposal_id || null : null),
        contact_name:    contact.name    || '',
        contact_email:   contact.email   || '',
        contact_phone:   contact.phone   || '',
        contact_address: contact.address || '',
        creator_version: isEdit ? (ei.creator_version || 'v3') : 'v4',
        line_items: storedItems,
        total,
      };
      if (!receiptMode && usesV4Terms) {
        payload.due_at = dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null;
        payload.payment_terms = paymentTerms.trim() || 'Due upon receipt';
      }
      let data, error;
      if (receiptMode) {
        const receivedAtIso = new Date(receivedAt).toISOString();
        const semantic = JSON.stringify([contact.id, storedItems, total, paymentMethod, paymentNote, receivedAtIso]);
        const storageKey = `bpp-standalone-receipt:${semantic}`;
        let attempt = null;
        try { attempt = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) {}
        if (!attempt) {
          attempt = { key: crypto.randomUUID() };
          try { localStorage.setItem(storageKey, JSON.stringify(attempt)); } catch (_) {}
        }
        ({ data, error } = await CRM.__invokeFn('record-payment', { body: {
          standalone: {
            contact_id:contact.id, contact_name:contact.name || '', contact_email:contact.email || '',
            contact_phone:contact.phone || '', contact_address:contact.address || '', line_items:storedItems,
          },
          amount:total, method:paymentMethod, note:paymentNote,
          received_at:receivedAtIso, idempotency_key:attempt.key,
        } }));
        if (!error && data?.ok) {
          try { localStorage.removeItem(storageKey); } catch (_) {}
        }
      } else if (isEdit) {
        const semantic = JSON.stringify([ei.id, payload.total, payload.line_items, payload.due_at || null, payload.payment_terms || null]);
        const storageKey = `bpp-draft-invoice-update:${semantic}`;
        let key = localStorage.getItem(storageKey);
        if (!key) { key = crypto.randomUUID(); localStorage.setItem(storageKey, key); }
        ({ data, error } = await CRM.__invokeFn('record-payment', { body: {
          action: 'update_draft_invoice', invoice_id: ei.id, amount: payload.total,
          line_items: payload.line_items, due_at: payload.due_at || null,
          payment_terms: payload.payment_terms || 'Due upon receipt', idempotency_key: key,
        } }));
        if (!error && data?.ok) {
          try { localStorage.removeItem(storageKey); } catch (_) {}
          data = { ...ei, ...payload, ...data };
        }
      } else {
        // Initial status 'draft' so the invoice doesn't surface as a live
        // bill before Key actually sends it. The Send button on the
        // FinanceRow flips status='unpaid' and dispatches SMS.
        ({ data, error } = await CRM.__db.from('invoices').insert([{ ...payload, status: 'draft' }]).select().single());
      }
      if (error || !data) {
        window.showToast?.(`${isEdit ? 'Update' : 'Create'} failed: ${error?.message || 'unknown'}`);
        setBusy(false);
        return;
      }
      // Optimistically push the new invoice into CRM.invoices so it shows
      // up immediately. Realtime would do this eventually but there's a
      // gap where the modal closes and the row hasn't materialized yet.
      // Use the SAME mapper the refetch path uses (mapInvoice, global from
      // crm-data.js) so the optimistic row can never drift from the
      // canonical shape (the hand-rolled copy here used a $1,500 kind
      // cutoff that diverged from mapInvoice's 90%-of-proposal rule).
      const mapped = receiptMode ? null : mapInvoice(data);
      const arr = (window.CRM.invoices = window.CRM.invoices || []);
      if (mapped) {
        const idx = arr.findIndex(i => i.id === mapped.id);
        if (idx >= 0) arr[idx] = mapped; else arr.unshift(mapped);
      }
      window.dispatchEvent(new CustomEvent('crm-data-changed'));
      window.showToast?.(receiptMode ? 'Payment receipt created' : (isEdit ? 'Invoice updated' : 'Invoice created'));
      onClose();
    } catch (e) {
      window.showToast?.(`Failed: ${e.message || e}`);
      setBusy(false);
    }
  };

  // ── UI: comp-mapped composition (Claude Design comp at
  // comps/creator-modal-v2.html, 2026-06-11). Zone grammar: TYPE /
  // LINE ITEMS + the sticky number bar, identical grammar to
  // NewProposalModal. Composition only; the preset math, billedSum /
  // remaining (known-deferred defects included), and the save payload
  // are untouched.
  const fmt$ = (n) => '$' + (Number(n) || 0).toLocaleString();
  const depRate = (window.V3_PRICING?.depositRate) || 0.2;

  const GRIP_SVG = (
    <svg viewBox="0 0 12 16" aria-hidden="true">
      <circle cx="4" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" />
      <circle cx="4" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" />
      <circle cx="4" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" />
    </svg>
  );
  const PLUS_SVG = (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1v10M1 6h10" /></svg>
  );
  const X_SVG = (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 2.5l9 9M11.5 2.5l-9 9" /></svg>
  );

  const renderLineRow = (li, i) => {
    const isDiscount = li.kind === 'discount';
    return (
      <div
        key={li.id}
        className={'cm2-li' + (isDiscount ? ' cm2-disc' : '') + (!isDiscount && li.checked === false ? ' cm2-excluded' : '')}
        draggable
        onDragStart={() => { dragIdxRef.current = i; setDragIdx(i); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          const from = dragIdxRef.current;
          if (from != null) moveItem(from, i);
          dragIdxRef.current = null;
          setDragIdx(null);
        }}
        onDragEnd={() => { dragIdxRef.current = null; setDragIdx(null); }}
        style={{ opacity: dragIdx === i ? 0.5 : 1, cursor: dragIdx === i ? 'grabbing' : 'default' }}
      >
        <span className="cm2-grip" title="Drag to reorder">{GRIP_SVG}</span>
        {isDiscount ? (
          /* Unlike the proposal's discount (label only), the invoice stores
             the full row, name included, in line_items, so the name stays
             editable here. */
          <input
            className="cm2-nm cm2-dnm"
            type="text"
            value={li.name}
            onChange={(e) => updateItem(i, { name: e.target.value })}
            placeholder="Discount label"
            aria-label="Discount label"
          />
        ) : (
          <React.Fragment>
            <span className="cm2-inc">
              <input
                type="checkbox"
                checked={li.checked !== false}
                onChange={(e) => updateItem(i, { checked: e.target.checked })}
                title="Pre-checked for client"
                style={{ width:20, height:20, accentColor: NAVY, cursor:'pointer', margin:0 }}
              />
            </span>
            <input
              className="cm2-nm"
              type="text"
              value={li.name}
              onChange={(e) => updateItem(i, { name: e.target.value })}
              placeholder="Line item"
              aria-label="Line item name"
            />
          </React.Fragment>
        )}
        {isDiscount && (
          <span className="cm2-dseg">
            <button type="button" aria-pressed={li.discountType === 'dollar'} onClick={() => updateItem(i, { discountType: 'dollar' })}>$</button>
            <button type="button" aria-pressed={li.discountType === 'percent'} onClick={() => updateItem(i, { discountType: 'percent' })}>%</button>
          </span>
        )}
        <span className="cm2-amt-w">
          {!isDiscount && <span className="cm2-cur">$</span>}
          <input
            className="cm2-amt"
            type="number" inputMode="decimal" min="0" step="1"
            value={li.amount}
            onChange={(e) => updateItem(i, { amount: parseFloat(e.target.value) || 0 })}
            aria-label={isDiscount ? 'Discount value' : 'Amount'}
          />
        </span>
        <button type="button" className="cm2-rm" onClick={() => removeItem(i)} aria-label="Remove">{X_SVG}</button>
      </div>
    );
  };

  const formBody = (
    <div>
      <style>{CM2_CSS}</style>

      {/* Reference proposal */}
      {latestSignedProposal ? (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', background:BG, borderRadius:8, marginBottom:18 }}>
          <span style={{ fontSize:12, color:'#666' }}>Linked to approved proposal</span>
          <span style={{ fontSize:12, fontWeight:600, color:NAVY, fontFamily:"'JetBrains Mono','DM Mono',monospace" }}>{fmt$(proposalTotal)}</span>
        </div>
      ) : !isEdit && !receiptMode && (
        <div style={{ padding:'8px 12px', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8, fontSize:12, color:'#92400E', marginBottom:18 }}>
          No approved proposal. Use Balance preset for custom amount.
        </div>
      )}

      {/* TYPE: one-tap presets that pre-fill line items (skip on edit).
          The pill amounts mirror applyPreset's math expression-for-
          expression so what the pill says is exactly what the tap fills.
          No pressed state: presets are momentary actions, not a stored
          invoice field. */}
      {!isEdit && !receiptMode && (
        <div className="cm2-zone">
          <p className="cm2-zlabel">Type</p>
          <div className="cm2-type-row">
            <button type="button" className="cm2-typ" onClick={() => applyPreset('deposit')}>
              Deposit<span className="cm2-tv">{proposalTotal > 0 ? fmt$(Math.round(proposalTotal * depRate)) : Math.round(depRate * 100) + '%'}</span>
            </button>
            <button type="button" className="cm2-typ" onClick={() => applyPreset('final')}>
              Final<span className="cm2-tv">{fmt$(Math.round(remaining))}</span>
            </button>
            <button type="button" className="cm2-typ" onClick={() => applyPreset('balance')}>
              Balance<span className="cm2-tv">Custom</span>
            </button>
          </div>
          {proposalTotal > 0 && billedSum > 0 && (
            <p className="cm2-balance-note">
              Billed so far <span className="cm2-mono">{fmt$(billedSum)}</span> of <span className="cm2-mono">{fmt$(proposalTotal)}</span>. Remaining <span className="cm2-mono">{fmt$(remaining)}</span>.
            </p>
          )}
        </div>
      )}

      {/* LINE ITEMS: rows first, ghost adders below (comp order). */}
      <div className="cm2-zone" style={{ marginBottom: 0 }}>
        <p className="cm2-zlabel">Line items</p>
        {lineItems.length > 0 && (
          <div>{lineItems.map((li, i) => renderLineRow(li, i))}</div>
        )}
        <div className="cm2-add-pair">
          <button type="button" className="cm2-ghost" onClick={addItem}>{PLUS_SVG}Line item</button>
          {!receiptMode && <button type="button" className="cm2-ghost" onClick={addDiscount} disabled={hasDiscount}>{PLUS_SVG}Discount</button>}
        </div>
      </div>
      {!receiptMode && usesV4Terms && (
        <div className="cm2-zone" style={{ marginTop:18 }}>
          <p className="cm2-zlabel">Payment terms</p>
          <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} maxLength={160}
            placeholder="Due upon receipt" aria-label="Payment terms"
            style={{ width:'100%', minHeight:44, border:'1px solid #d9dee8', borderRadius:8, padding:'0 12px', fontSize:16, boxSizing:'border-box', marginBottom:10 }} />
          <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} aria-label="Invoice due date"
            style={{ width:'100%', minHeight:44, border:'1px solid #d9dee8', borderRadius:8, padding:'0 12px', fontSize:16, boxSizing:'border-box' }} />
        </div>
      )}
      {receiptMode && (
        <div className="cm2-zone" style={{ marginTop:18 }}>
          <p className="cm2-zlabel">Payment</p>
          <div style={{ padding:'10px 12px', background:'#f5f7fa', borderRadius:8, color:'#5a6478', fontSize:12, lineHeight:1.45, marginBottom:10 }}>
            This records money already received and creates a receipt. It does not charge or collect payment.
          </div>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
            style={{ width:'100%', minHeight:44, border:'1px solid #d9dee8', borderRadius:8, padding:'0 12px', fontSize:16, background:'white', marginBottom:10 }}>
            {['Cash','External card payment','Check','Other external payment'].map(method => <option key={method}>{method}</option>)}
          </select>
          <input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)}
            aria-label="Payment received at"
            style={{ width:'100%', minHeight:44, border:'1px solid #d9dee8', borderRadius:8, padding:'0 12px', fontSize:16, boxSizing:'border-box', marginBottom:10 }} />
          <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)}
            placeholder="Payment note or reference (optional)" aria-label="Payment note"
            style={{ width:'100%', minHeight:44, border:'1px solid #d9dee8', borderRadius:8, padding:'0 12px', fontSize:16, boxSizing:'border-box' }} />
        </div>
      )}
    </div>
  );

  // THE NUMBER: total (18px mono) + single gold CTA. Disabled logic
  // identical to the old footer button (busy / DNC / non-positive total).
  const ctaDisabled = busy || (!isEdit && !receiptMode && contact.do_not_contact) || total <= 0
    || (receiptMode && !receivedAt) || (!receiptMode && usesV4Terms && (!dueAt || !paymentTerms.trim()));
  const numberBar = (flat) => (
    <div className={'cm2-numbar' + (flat ? ' cm2-flat' : ' cm2-inline')}>
      <span className="cm2-nw">
        <span className="cm2-total">{fmt$(total)}</span>
      </span>
      <button type="button" className="cm2-cta" onClick={submit} disabled={ctaDisabled}>
        {busy ? (isEdit ? 'Saving…' : 'Creating…') : (receiptMode ? 'Create payment receipt' : (isEdit ? 'Save changes' : 'Create invoice'))}
      </button>
    </div>
  );

  if (inline) {
    return (
      <div data-card style={{
        background:'white', border:'1px solid rgba(11,31,59,0.12)', borderRadius:8,
        marginBottom:12,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px 12px', borderBottom:'1px solid rgba(27,43,75,0.08)' }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:800, letterSpacing:'-0.01em', color:NAVY }}>
              {receiptMode ? 'New receipt' : (isEdit ? 'Edit invoice' : (latestSignedProposal ? 'Generate invoice' : 'New invoice'))}
            </div>
            <div style={{ fontSize:12, color:'#5a6478', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{contact.name || formatPhone(contact.phone)}</div>
          </div>
          <button onClick={onClose} aria-label="Cancel" style={{
            width:44, height:44, borderRadius:12, border:'none', background:'transparent',
            color:'#5a6478', fontSize:22, lineHeight:1, cursor:'pointer', fontFamily:'inherit',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
          }}>×</button>
        </div>
        <div style={{ padding:'18px 16px 16px' }}>{formBody}</div>
        {numberBar(false)}
      </div>
    );
  }

  return (
    <ModalShell
      open={true}
      onClose={onClose}
      title={`${receiptMode ? 'New receipt' : (isEdit ? 'Edit invoice' : 'New invoice')}: ${contact.name || formatPhone(contact.phone)}`}
      footer={numberBar(true)}
    >
      {formBody}
    </ModalShell>
  );
}

// ── StageHistoryCard ──────────────────────────────────────────────────
// Compact timeline: "New → Quoted (4d) → Booked (12d) → here for 3d".
// Auditor: "Solo ops live or die by knowing why a deal stalled."
function StageHistoryCard({ contact }) {
  const all = window.CRM?.stageHistory || [];
  const rows = all.filter(r => r.contact_id === contact.id);
  if (rows.length === 0) return null;

  // Build a chronological list of stages including the implicit "created"
  // entry. Compute days-in-stage for each transition. The DB column is
  // `changed_at` not `created_at` - wrong field name silently produced
  // NaN on every transition and the card rendered with empty pills.
  const sorted = [...rows].sort((a,b) => new Date(a.changed_at) - new Date(b.changed_at));
  const startTs = new Date(sorted[0].changed_at).getTime();

  const segments = [];
  let prevTs = startTs;
  let prevStage = sorted[0].from_stage;
  if (prevStage != null) {
    const days = Math.max(0, Math.floor((new Date(sorted[0].changed_at).getTime() - prevTs) / 86400000));
    segments.push({ stage: prevStage, days, transitionAt: sorted[0].changed_at });
  }
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const next = sorted[i + 1];
    const ts = new Date(t.changed_at).getTime();
    const endTs = next ? new Date(next.changed_at).getTime() : Date.now();
    const days = Math.max(0, Math.floor((endTs - ts) / 86400000));
    segments.push({ stage: t.to_stage, days, transitionAt: t.changed_at, current: !next });
  }

  const labelFor = (n) => (window.CRM?.STAGE_LABELS?.[window.CRM?.STAGE_NUM_TO_STR?.[n]] || `Stage ${n}`);

  return (
    <InfoSection title="Pipeline" editAction={null}>
      <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:6, fontSize:12, color:NAVY }}>
        {segments.map((s, i) => (
          <React.Fragment key={i}>
            <span style={{
              padding:'3px 8px', borderRadius:20, fontWeight:600,
              background: s.current ? '#FFFBEB' : '#F0F4FF',
              color: s.current ? '#92400E' : NAVY,
              border: s.current ? '1px solid #FDE68A' : '1px solid rgba(11,31,59,0.08)',
              fontSize:11,
              whiteSpace:'nowrap',
            }}>{labelFor(s.stage)}{s.days > 0 ? ` · ${s.days}d` : ''}{s.current ? ' (here)' : ''}</span>
            {i < segments.length - 1 && <span style={{ color:MUTED, fontSize:11 }}>→</span>}
          </React.Fragment>
        ))}
      </div>
    </InfoSection>
  );
}

// ── ActivityTimelineCard ──────────────────────────────────────────────
// Unified chronological feed: every message, call, proposal change,
// invoice change, calendar event, and stage transition for a contact -
// in one timeline. Lets Key reconstruct a deal's full history without
// hopping between tabs. Collapsed-by-default, expand on click.
// CRM revamp T2-3: monochrome line-glyph set for the activity timeline,
// replacing the OS emoji. Keyed by the emoji each item already uses, so the
// icon: values in the items builder stay untouched; each renders in the item's
// existing semantic-tint color via currentColor. Universal utility glyphs on
// the documented v3 tints , inlined like the T1-3 zap, no comp.
const TL_SVG = (paths) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);
const TL_GLYPH = {
  '\u{1F4E5}': TL_SVG(<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />),
  '\u{1F4E4}': TL_SVG(<path d="M12 20V9m0 0l-4 4m4-4l4 4M5 5h14" />),
  '\u{1F4DE}': TL_SVG(<path d="M5 4h3l2 5-2 1a11 11 0 005 5l1-2 5 2v3a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />),
  '\u{1F4F5}': TL_SVG(<><path d="M5 4h3l2 5-2 1a11 11 0 005 5l1-2 5 2v3a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /><path d="M3 3l18 18" /></>),
  '\u{1F4DD}': TL_SVG(<path d="M4 20h4L19 9l-4-4L4 16v4z" />),
  '\u{1F440}': TL_SVG(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  '✅': TL_SVG(<path d="M20 6L9 17l-5-5" />),
  '❌': TL_SVG(<path d="M6 6l12 12M18 6L6 18" />),
  '\u{1F4C4}': TL_SVG(<><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4" /></>),
  '\u{1F4E8}': TL_SVG(<><path d="M3 6h18v12H3z" /><path d="M3 7l9 7 9-7" /></>),
  '\u{1F4B0}': TL_SVG(<path d="M12 2v20M16 6H9.5a3 3 0 000 6h5a3 3 0 010 6H7" />),
  '\u{1F6AB}': TL_SVG(<><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></>),
  '\u{1F4C5}': TL_SVG(<><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>),
  '\u{1F501}': TL_SVG(<path d="M4 9h11l-3-3m3 3l-3 3M20 15H9l3-3m-3 3l3 3" />),
};

function ActivityTimelineCard({ contact, messages = [], calls = [], proposals = [], invoices = [], events = [], onOpenTab }) {
  const [expanded, setExpanded] = React.useState(false);
  const stageHistory = (window.CRM?.stageHistory || []).filter(r => r.contact_id === contact.id);

  // Build a flat list of {at, type, label, meta, color, action}.
  const items = React.useMemo(() => {
    const out = [];
    // Messages
    for (const m of messages) {
      const at = m.created_at || m.sent_at || m.received_at;
      if (!at) continue;
      const dir = m.direction === 'in' ? 'in' : 'out';
      out.push({
        at, type:'message',
        label: dir === 'in' ? 'Inbound message' : 'Outbound message',
        meta: (m.body || '').slice(0, 70) + ((m.body || '').length > 70 ? '…' : ''),
        color: dir === 'in' ? '#1E40AF' : '#065F46',
        icon: dir === 'in' ? '📥' : '📤',
        onClick: () => onOpenTab?.('messages'),
      });
    }
    // Calls
    for (const c of calls) {
      const at = c.created_at || c.started_at;
      if (!at) continue;
      const direction = c.direction || 'unknown';
      const isMissed = direction === 'missed' || c.status === 'missed';
      out.push({
        at, type:'call',
        label: isMissed ? 'Missed call' : direction === 'in' ? 'Inbound call' : direction === 'out' ? 'Outbound call' : 'Call',
        meta: c.duration_sec > 0 ? formatDuration(c.duration_sec) : (c.status || ''),
        color: isMissed ? '#991B1B' : '#065F46',
        icon: isMissed ? '📵' : '📞',
        onClick: () => onOpenTab?.('calls'),
      });
    }
    // Proposals
    for (const p of proposals) {
      if (p.created_at) out.push({
        at: p.created_at, type:'proposal',
        label: 'Quote drafted',
        meta: p.amp_spec ? `${p.amp_spec}A` : '',
        color: '#666',
        icon: '📝',
        onClick: () => onOpenTab?.('finance'),
      });
      if (p.sent_at) out.push({
        at: p.sent_at, type:'proposal',
        label: 'Quote sent',
        meta: p.amp_spec ? `${p.amp_spec}A` : '',
        color: '#1E40AF',
        icon: '📤',
        onClick: () => onOpenTab?.('finance'),
      });
      if (p.viewed_at) out.push({
        at: p.viewed_at, type:'proposal',
        label: 'Quote viewed',
        meta: 'Customer opened proposal',
        color: '#1E40AF',
        icon: '👀',
        onClick: () => onOpenTab?.('finance'),
      });
      if (p.approved_at) out.push({
        at: p.approved_at, type:'proposal',
        label: 'Quote approved',
        meta: '',
        color: '#065F46',
        icon: '✅',
        onClick: () => onOpenTab?.('finance'),
      });
      if (p.cancelled_at || p.cancellation_at) out.push({
        at: p.cancelled_at || p.cancellation_at, type:'proposal',
        label: 'Quote cancelled',
        meta: p.cancellation_reason || '',
        color: '#991B1B',
        icon: '❌',
        onClick: () => onOpenTab?.('finance'),
      });
    }
    // Invoices
    for (const inv of invoices) {
      if (inv.created_at) out.push({
        at: inv.created_at, type:'invoice',
        label: 'Invoice drafted',
        meta: formatMoneyCents(inv.amount_cents || 0),
        color: '#666',
        icon: '📄',
        onClick: () => onOpenTab?.('finance'),
      });
      if (inv.sent_at) out.push({
        at: inv.sent_at, type:'invoice',
        label: 'Invoice sent',
        meta: formatMoneyCents(inv.amount_cents || 0),
        color: '#1E40AF',
        icon: '📨',
        onClick: () => onOpenTab?.('finance'),
      });
      if (inv.paid_at) out.push({
        at: inv.paid_at, type:'invoice',
        label: 'Invoice paid',
        meta: formatMoneyCents(inv.amount_cents || 0),
        color: '#065F46',
        icon: '💰',
        onClick: () => onOpenTab?.('finance'),
      });
      if (inv.voided_at) out.push({
        at: inv.voided_at, type:'invoice',
        label: 'Invoice voided',
        meta: '',
        color: '#991B1B',
        icon: '🚫',
        onClick: () => onOpenTab?.('finance'),
      });
    }
    // Calendar events
    for (const e of events) {
      if (!e.start_at) continue;
      out.push({
        at: e.created_at || e.start_at, type:'event',
        label: capitalize(e.kind || 'event') + (e.status === 'cancelled' ? ' cancelled' : ' scheduled'),
        meta: formatDate(e.start_at) + ' ' + (e.start_at ? formatTime(e.start_at) : ''),
        color: e.status === 'cancelled' ? '#991B1B' : '#92400E',
        icon: e.status === 'cancelled' ? '🚫' : '📅',
        onClick: () => onOpenTab?.('calendar'),
      });
    }
    // Stage transitions
    for (const r of stageHistory) {
      if (!r.changed_at) continue;
      const fromLbl = (window.CRM?.STAGE_LABELS || {})[(window.CRM?.STAGE_NUM_TO_STR || {})[r.from_stage]] || `Stage ${r.from_stage}`;
      const toLbl = (window.CRM?.STAGE_LABELS || {})[(window.CRM?.STAGE_NUM_TO_STR || {})[r.to_stage]] || `Stage ${r.to_stage}`;
      out.push({
        at: r.changed_at, type:'stage',
        label: 'Stage changed',
        meta: `${fromLbl} → ${toLbl}`,
        color: '#1E40AF',
        icon: '🔁',
      });
    }
    out.sort((a, b) => new Date(b.at) - new Date(a.at));
    return out;
  }, [messages, calls, proposals, invoices, events, stageHistory.length, contact.id]);

  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, 5);

  return (
    <InfoSection title={`Activity (${items.length})`} editAction={null}>
      {/* remake-2 (approved comp, .act-row metrics): 44px rows separated by
          hairline dividers, 18px icon column, 13px label in the item's
          semantic color, 11px mono time pinned right. The T2-3 SVG glyph
          set stays. The meta preview line survives below the label (the
          comp folds meta into the label; we keep the second quiet line so
          message previews stay readable). */}
      <div style={{ display:'flex', flexDirection:'column' }}>
        {visible.map((it, i) => (
          <button
            key={i}
            onClick={it.onClick}
            disabled={!it.onClick}
            style={{
              display:'flex', gap:12, alignItems:'center',
              background:'none', border:'none', textAlign:'left',
              borderTop: i > 0 ? '1px solid rgba(27,43,75,0.08)' : 'none',
              padding:'2px 0', minHeight:44, fontFamily:'inherit',
              cursor: it.onClick ? 'pointer' : 'default',
            }}
            onMouseEnter={e => { if (it.onClick) e.currentTarget.style.background = '#F8F8F6'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
          >
            <span style={{ flexShrink:0, width:18, height:18, display:'inline-flex', alignItems:'center', justifyContent:'center', color: it.color }}>{TL_GLYPH[it.icon] || null}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:500, color: it.color, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.label}</div>
              {it.meta && (
                <div style={{ fontSize:12, color:'#5a6478', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.meta}</div>
              )}
            </div>
            <span style={{ flexShrink:0, fontFamily:"'JetBrains Mono', monospace", fontSize:11, color:'#8a93a6', textAlign:'right' }}>{formatRelative(it.at)}</span>
          </button>
        ))}
      </div>
      {items.length > 5 && (
        // remake-2: comp .act-more expander, full-width centered 44px row
        // above a hairline, 13px/700 muted, chevron flips when open.
        <button
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          style={{
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            width:'100%', minHeight:44, marginTop:2,
            border:'none', borderTop:'1px solid rgba(27,43,75,0.08)',
            fontSize:13, fontWeight:700, color:'#5a6478',
            background:'none', cursor:'pointer', fontFamily:'inherit', padding:0,
          }}
        >
          <span>{expanded ? 'Show less' : `Show ${items.length - 5} more`}</span>
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition:'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)' }}><path d="M2.5 4.5L6 8l3.5-3.5" /></svg>
        </button>
      )}
    </InfoSection>
  );
}

// ── AddressAutocomplete ─────────────────────────────────────────────
// Search-as-you-type using Nominatim (the same OpenStreetMap geocoder
// we already use for drive-time). Free, no key. Suggestions appear in
// a dropdown beneath the input - tap to fill. 600ms debounce respects
// Nominatim's 1 req/sec fair-use policy. SC bias keeps results local.
function AddressAutocomplete({ value, onChange, placeholder, style }) {
  const [open, setOpen] = React.useState(false);
  const [hits, setHits] = React.useState([]);
  const [searching, setSearching] = React.useState(false);
  const debounceRef = React.useRef(null);
  const lastQueriedRef = React.useRef('');

  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = (value || '').trim();
    if (q.length < 4) {
      setHits([]);
      lastQueriedRef.current = '';
      return;
    }
    if (q === lastQueriedRef.current) {
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      lastQueriedRef.current = q;
      try {
        // SC bounding box biases Nominatim toward our service area.
        // viewbox=west,south,east,north (BPP services Greenville,
        // Spartanburg, Pickens - approx -83.4..-78.5, 32.0..35.2).
        // bounded=0 keeps the bias soft so out-of-state matches still
        // appear if Key types a long-distance address.
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&countrycodes=us&addressdetails=1&viewbox=-83.4,35.2,-78.5,32.0&bounded=0&q=${encodeURIComponent(q)}`;
        const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!r.ok) { setHits([]); setSearching(false); return; }
        const data = await r.json();
        // City extraction. For Greenville County addresses where
        // Nominatim returns a CDP/neighborhood (e.g. "Sans Souci",
        // "Wade Hampton") we prefer "Greenville" because that's the
        // postal city Key uses. Same for Spartanburg County.
        const cityFor = (a) => {
          if (a.city) return a.city;
          if (a.town) return a.town;
          // CDP override: ANY address in our 4-jurisdiction area maps
          // to the canonical city when Nominatim picks a less-known
          // village/CDP/suburb.
          const county = (a.county || '').toLowerCase();
          if (county.includes('greenville')) return 'Greenville';
          if (county.includes('spartanburg')) return 'Spartanburg';
          if (county.includes('pickens')) return 'Pickens';
          return a.village || a.hamlet || a.suburb || a.county || '';
        };
        // Bias SC results to top - sort with SC matches first, then
        // by Nominatim's importance (display order). Keep cap at 5.
        const ranked = (data || [])
          .map((row, i) => ({ row, i, isSC: (row.address?.state || '').toLowerCase() === 'south carolina' }))
          .sort((a, b) => (b.isSC - a.isSC) || (a.i - b.i))
          .slice(0, 5)
          .map(({ row }) => row);
        const suggestions = ranked.map(row => {
          const a = row.address || {};
          const street = [a.house_number, a.road].filter(Boolean).join(' ');
          const city = cityFor(a);
          const stateAbbr = a.state ? (a['ISO3166-2-lvl4'] || '').replace('US-', '') : '';
          const short = [street, city].filter(Boolean).join(', ');
          return {
            label: short || row.display_name.split(',').slice(0, 3).join(','),
            full: short ? `${short}${stateAbbr ? ' ' + stateAbbr : ''}${a.postcode ? ' ' + a.postcode : ''}` : row.display_name,
          };
        }).filter(s => s.label);
        setHits(suggestions);
        setOpen(suggestions.length > 0);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 600);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [value]);

  // The dropdown is portaled to document.body with position:fixed so it
  // can extend beyond a modal's scroll boundary (parent has overflow:auto).
  // Recompute coordinates on scroll (capture phase catches modal scroll
  // too) + resize. Outside-click closes when the click is neither on the
  // input nor the dropdown itself.
  const inputRef = React.useRef(null);
  const dropdownRef = React.useRef(null);
  const [rect, setRect] = React.useState(null);

  // Smart placement: prefer below the input, but flip above when there's
  // not enough room (e.g. mobile bottom-sheet modal where the input sits
  // near the viewport floor). Always cap maxHeight to whatever fits in
  // the chosen direction so the dropdown is never clipped by the
  // viewport edge.
  const updateRect = React.useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const spaceBelow = vh - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const desired = 240;
    if (spaceBelow >= 140 || spaceBelow >= spaceAbove) {
      // Below.
      setRect({ top: r.bottom + 4, left: r.left, width: r.width, maxHeight: Math.min(desired, Math.max(120, spaceBelow)) });
    } else {
      // Flip above. `bottom` anchors so the dropdown grows upward as it
      // gets taller, instead of clipping at top:0.
      setRect({ bottom: vh - r.top + 4, left: r.left, width: r.width, maxHeight: Math.min(desired, Math.max(120, spaceAbove)) });
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open, updateRect]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (
        (inputRef.current && inputRef.current.contains(e.target)) ||
        (dropdownRef.current && dropdownRef.current.contains(e.target))
      ) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div style={{ position:'relative' }}>
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="street-address"
        style={style}
      />
      {searching && (
        <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', fontSize:11, color:MUTED }}>…</div>
      )}
      {open && hits.length > 0 && rect && ReactDOM.createPortal(
        <div ref={dropdownRef} style={{
          position:'fixed',
          ...(rect.top != null ? { top: rect.top } : { bottom: rect.bottom }),
          left: rect.left, width: rect.width, zIndex:10000,
          background:'white', border:'1px solid rgba(11,31,59,0.15)', borderRadius:8,
          boxShadow:'0 8px 24px rgba(11,31,59,0.16)',
          maxHeight: rect.maxHeight || 240, overflowY:'auto',
        }}>
          {hits.map((h, i) => (
            <button
              key={i}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(h.full); setOpen(false); }}
              style={{
                width:'100%', minHeight:44, display:'flex', alignItems:'center',
                padding:'10px 12px', textAlign:'left', background:'white', border:'none',
                borderBottom: i < hits.length - 1 ? '1px solid #F5F5F3' : 'none',
                cursor:'pointer', fontFamily:'inherit', fontSize:14, color:NAVY,
              }}
            >{h.full}</button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// Map a raw save error to plain, recoverable language; the raw PostgREST
// string stays in the console only (audit #25). No em-dashes.
function friendlyContactSaveError(err) {
  const raw = String((err && err.message) || err || '').toLowerCase();
  if (/42501|permission|rls|jwt|expired|not authorized|unauthorized/.test(raw)) {
    return 'Could not save. You may be signed out. Refresh and try again.';
  }
  if (/network|fetch|timeout|connection|offline|failed to fetch/.test(raw)) {
    return 'No connection. Check signal and try again.';
  }
  if (/23505|duplicate|already exists/.test(raw)) {
    return 'That contact already exists.';
  }
  return 'Could not save. Try again.';
}

// ── New Contact Modal ─────────────────────────────────────────────────
// Walk-ins, referrals, inbound callers - Key needs to capture a lead
// in <10s. Minimum viable: name + phone + address. Stage defaults to
// 'new' (1). Insert is direct - Contacts realtime channel will pick it
// up and ContactsList will re-render with the row at top.
function NewContactModal({ onClose, onCreated, initial = '' }) {
  // The contacts search bar doubles as "create contact": whatever Key typed
  // (initial) seeds the right field (Key 2026-06-19), classified by shape:
  //   ADDRESS  a leading street number + a word ("76 kimbe", "1600 pennsylvania")
  //            -> the address field, which fires the autocomplete dropdown.
  //   PHONE    only phone characters, even an incomplete number ("864561")
  //            -> the phone field (no digit-count floor, so a partial seeds too).
  //   NAME     anything else ("john s") -> the name field.
  const seedStr = String(initial || '').trim();
  const seedIsAddress = /^\d+\s+[a-zA-Z]/.test(seedStr);
  const seedIsPhone = !seedIsAddress && !!seedStr && /^[+\d\s().\-]+$/.test(seedStr);
  // A MIXED "name + number" seed ("Bob 864-555-1234") used to dump the whole
  // string into name (phone empty). Split it: the first run of >=7 phone chars
  // (>=7 actual digits) goes to phone, the remaining words to name.
  const seedPhoneRun = (!seedIsAddress && !seedIsPhone) ? (seedStr.match(/[+\d\s().\-]{7,}/) || [])[0] : null;
  const seedPhonePart = (seedPhoneRun && seedPhoneRun.replace(/\D/g, '').length >= 7) ? seedPhoneRun.trim() : '';
  const seedNamePart = seedPhonePart ? seedStr.replace(seedPhoneRun, ' ').replace(/\s+/g, ' ').trim() : '';
  const seedIsName = !!seedStr && !seedIsAddress && !seedIsPhone && !seedPhonePart;
  const [name, setName] = React.useState(() => seedIsName ? seedStr : (seedNamePart || ''));
  const [phone, setPhone] = React.useState(() => seedIsPhone ? seedStr : (seedPhonePart ? formatPhoneInput(seedPhonePart) : ''));
  const [email, setEmail] = React.useState('');
  const [address, setAddress] = React.useState(() => seedIsAddress ? seedStr : '');
  const [busy, setBusy] = React.useState(false);

  // Save is enabled once minimum-viable contact info is present -
  // either a name or a complete US phone (10 digits). Keeps Key from
  // saving rows with just "Bob" that he can't actually call.
  const phoneDigits = phone.replace(/\D/g, '');
  const canSave = !!name.trim() || phoneDigits.length === 10;
  // Inline email validation hint - empty is OK, anything that looks
  // wrong shows a red border so Key catches typos before save.
  const emailLooksValid = !email.trim() || /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email.trim());
  // Phone hint: empty is OK; a too-short/garbled number shows inline text
  // so Key catches it before save (matches the Save-regex so it never nags
  // mid-typing of a valid in-progress number).
  const phoneLooksValid = !phone.trim() || /^\+?[\d\s().\-]{7,}$/.test(phone.trim());

  // 2026-05-26 dedupe guard: if a contact already exists with the same
  // last-10 phone digits, surface it inline so Key opens that one
  // instead of creating a duplicate. The earlier Tom merge mess
  // (one customer's conversation split across 2 contact rows because
  // of a fast double-add) is exactly what this prevents going forward.
  // Extended (Tom-split scar): an email-only walk-in with no phone now
  // dedupes on an exact normalized-email match too.
  const duplicateMatch = React.useMemo(() => {
    const all = window.CRM?.contacts || [];
    if (phoneDigits.length >= 10) {
      const target = phoneDigits.slice(-10);
      const byPhone = all.find(c => {
        const d = String(c.phone || '').replace(/\D/g, '').slice(-10);
        return d.length === 10 && d === target;
      });
      if (byPhone) return byPhone;
    }
    const em = email.trim().toLowerCase();
    if (em && emailLooksValid) {
      const byEmail = all.find(c => String(c.email || '').trim().toLowerCase() === em);
      if (byEmail) return byEmail;
    }
    return null;
  }, [phoneDigits, email, emailLooksValid]);

  const submit = async () => {
    if (busy || !canSave) return;
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName && !trimmedPhone) {
      window.showToast?.('Need at least a name or phone');
      return;
    }
    if (trimmedPhone && !/^\+?[\d\s().\-]{7,}$/.test(trimmedPhone)) {
      window.showToast?.('Phone looks invalid');
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmedEmail)) {
      window.showToast?.('Email looks invalid');
      return;
    }
    if (!CRM.__db) {
      window.showToast?.('Supabase not loaded');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        // contacts.name is NOT NULL. canSave allows a phone-only add
        // (name blank, 10-digit phone), so fall back to the phone, then
        // a literal, instead of writing null and getting a cryptic
        // not-null rejection that looks like a save that silently failed.
        name: trimmedName || trimmedPhone || 'New contact',
        phone: trimmedPhone || '',
        email: trimmedEmail || null,
        address: address.trim() || null,
        stage: 1,           // new lead
        status: 'Active',
        do_not_contact: false,
        // IR-1 (docs/CRM-INTERFACE-REQUESTS.md): operator adds are the
        // 'manual' channel; without this every non-web lead lands with
        // NULL attribution. Inbound auto-create sets 'phone' server-side.
        lead_channel: 'manual',
      };
      const { data, error } = await CRM.__db.from('contacts').insert([payload]).select().single();
      if (error || !data) {
        console.error('[new-contact] save failed:', error);
        window.showToast?.(friendlyContactSaveError(error));
        setBusy(false);
        return;
      }
      window.showToast?.(`${trimmedName || trimmedPhone || 'Contact'} added`);
      onCreated?.(data.id);
      onClose();
    } catch (e) {
      console.error('[new-contact] save threw:', e);
      window.showToast?.(friendlyContactSaveError(e));
      setBusy(false);
    }
  };

  // fontSize 16 prevents iOS Safari auto-zoom on focus.
  const inputStyle = { width:'100%', height:44, padding:'0 12px', fontSize:16, fontFamily:'inherit', border:'1px solid rgba(11,31,59,0.15)', borderRadius:8, background:'white', color:NAVY, outline:'none', boxSizing:'border-box' };

  return (
    <ModalShell
      open={true}
      onClose={onClose}
      title="New contact"
      footer={(
        <div>
          {!canSave && <div style={{ fontSize:11, color:MUTED, lineHeight:1.4, marginBottom:8 }}>Add a name, or a full 10-digit phone, to save.</div>}
          <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} disabled={busy} style={{
            flex:'1 1 0', minWidth:0, height:44, borderRadius:8, background:'white', color:NAVY,
            border:'1px solid rgba(27,43,75,0.15)', fontSize:14, fontWeight:600, fontFamily:'inherit', cursor: busy?'not-allowed':'pointer',
          }}>Cancel</button>
          <button onClick={submit} disabled={busy || !canSave} style={{
            flex:'1 1 0', minWidth:0, height:44, borderRadius:8,
            background: (busy || !canSave) ? '#E5E5E5' : '#ffba00', color: (busy || !canSave) ? '#999' : NAVY,
            border:'none', fontSize:14, fontWeight:700, fontFamily:'inherit',
            cursor: (busy || !canSave) ? 'not-allowed' : 'pointer',
          }}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    >
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        {/* Audit-2026-05-09 a11y M5: each input wrapped in <label> so
            tap-on-label focuses the input and screen readers associate
            them. Same pattern as ContactNotesSection edit form. */}
        <label style={{ display:'block', cursor:'text' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Name</div>
          <input value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && canSave) { e.preventDefault(); submit(); } }}
            placeholder="Full name" autoComplete="name" autoCapitalize="words" autoFocus style={inputStyle} />
        </label>
        <label style={{ display:'block', cursor:'text' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Phone</div>
          <input value={phone} onChange={e=>setPhone(formatPhoneInput(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter' && canSave) { e.preventDefault(); submit(); } }}
            placeholder="(864) 555-0192" type="tel" inputMode="tel" autoComplete="tel" style={inputStyle} />
          {phone.trim() && !phoneLooksValid && <div style={{ fontSize:12, color:'#B91C1C', marginTop:6 }}>That phone number looks incomplete.</div>}
        </label>
        {duplicateMatch && (
          <div style={{
            background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:8,
            padding:'10px 12px', display:'flex', alignItems:'center', gap:10,
          }}>
            <span style={{ fontSize:18, flexShrink:0 }}>⚠️</span>
            <div style={{ flex:1, minWidth:0, fontSize:12, color:'#92400E' }}>
              This contact may already exist as <b>{duplicateMatch.name || '(unnamed)'}</b>
              {duplicateMatch.archived ? ' (archived)' : ''}.
            </div>
            <button
              type="button"
              onClick={() => { onCreated?.(duplicateMatch.id); onClose(); }}
              style={{
                flexShrink:0, minHeight:44, padding:'0 12px', borderRadius:6,
                background:NAVY, color:GOLD, border:'none', cursor:'pointer',
                fontSize:11, fontWeight:700, fontFamily:'inherit',
              }}
            >
              Open instead
            </button>
          </div>
        )}
        <label style={{ display:'block', cursor:'text' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Email (optional)</div>
          <input value={email} onChange={e=>setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && canSave) { e.preventDefault(); submit(); } }}
            placeholder="name@example.com" type="email" inputMode="email" autoComplete="email"
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            style={{ ...inputStyle, borderColor: emailLooksValid ? 'rgba(11,31,59,0.15)' : '#FCA5A5' }} />
          {email.trim() && !emailLooksValid && <div style={{ fontSize:12, color:'#B91C1C', marginTop:6 }}>That email looks off. Check the spelling.</div>}
        </label>
        <label style={{ display:'block', cursor:'text' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Address (optional)</div>
          <AddressAutocomplete value={address} onChange={setAddress} placeholder="123 Main St, Spartanburg" style={inputStyle} />
        </label>
        <div style={{ fontSize:11, color:MUTED, lineHeight:1.5 }}>
          New leads land at stage 1 (New). You can advance the stage from the contact's overview after creating.
        </div>
      </div>
    </ModalShell>
  );
}

// ── New Event Modal ──────────────────────────────────────────────────
// Global "Add event" - pick a contact, kind, date, time, save. Mirrors
// AddEventInline (per-contact) but with a contact picker on top.
function NewEventModal({ contacts = [], onClose, defaultDate = null }) {
  const [contactId, setContactId] = React.useState('');
  const [kind, setKind] = React.useState('install');
  // Seed the date from the day the operator is looking at (the calendar
  // day-board passes its selected day). Natural mapping: tapping + while
  // viewing Thursday should pre-fill Thursday, not silently jump to tomorrow.
  // Fall back to tomorrow when opened with no day context.
  const [date, setDate] = React.useState(() => {
    if (defaultDate && /^\d{4}-\d{2}-\d{2}$/.test(defaultDate)) return defaultDate;
    const d = new Date(Date.now() + 24*3600*1000);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const [time, setTime] = React.useState('09:00');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // Sort contacts alphabetically for the picker. Filter out archived.
  const pickable = (contacts || []).filter(c => !c.archived).sort((a,b) => (a.name||'').localeCompare(b.name||''));

  const KIND_OPTIONS = [
    { v:'install',   label:'Install' },
    { v:'inspect',   label:'Inspection' },
    { v:'follow_up', label:'Follow-up call' },
    { v:'pickup',    label:'Pickup' },
    { v:'meeting',   label:'Meeting' },
  ];

  const submit = async () => {
    if (busy) return;
    if (!contactId) { window.showToast?.('Pick a contact'); return; }
    if (!date || !time) { window.showToast?.('Pick a date and time'); return; }
    if (!CRM.__db) { window.showToast?.('Supabase not loaded'); return; }
    setBusy(true);
    const startIso = new Date(`${date}T${time}:00`).toISOString();
    const durMin = kind === 'install' ? 180 : kind === 'inspect' ? 30 : 60;
    const endIso = new Date(new Date(startIso).getTime() + durMin*60*1000).toISOString();
    const titleFor = ({ install:'Install', inspect:'Inspection', follow_up:'Follow-up call', pickup:'Pickup', meeting:'Meeting' })[kind] || 'Event';
    // DB column is `event_type`; no `status` column. Insert via the
    // real schema, alias back to `kind` in our in-memory row.
    const row = {
      contact_id: contactId,
      event_type: kind,
      title: titleFor,
      start_at: startIso,
      end_at: endIso,
      notes: notes.trim() || null,
    };
    const { data, error } = await CRM.__db.from('calendar_events').insert(row).select().single();
    if (error || !data) {
      setBusy(false);
      window.showToast?.(`Save failed: ${error?.message || 'unknown'}`);
      return;
    }
    CRM.events.push({
      id: data.id, contact_id: data.contact_id, kind: data.event_type || kind,
      start_at: data.start_at, end_at: data.end_at, title: data.title, notes: data.notes, status: 'scheduled',
    });
    // Scheduling an install stamps the contact + advances the stage; shared
    // helper so the creators can't drift again (CAL-20).
    const c = (CRM.contacts || []).find(x => x.id === contactId) || (contacts || []).find(x => x.id === contactId);
    if (kind === 'install') await scheduleInstallSideEffects(c, startIso, 'NewEventModal');
    window.dispatchEvent(new CustomEvent('crm-data-changed'));
    window.showToast?.(`${titleFor} scheduled`);
    onClose();
  };

  // Match NewContactModal: grey the primary until a contact is picked, so
  // the affordance reads the same across both creators (the early-return
  // toast at submit() stays as a backstop).
  const canSave = !!contactId;
  const inputStyle = { width:'100%', height:44, padding:'0 12px', fontSize:16, fontFamily:'inherit', border:'1px solid rgba(11,31,59,0.15)', borderRadius:8, background:'white', color:NAVY, outline:'none', boxSizing:'border-box' };
  const todayMin = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();

  return (
    <ModalShell
      open={true}
      onClose={onClose}
      title="New event"
      footer={(
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} disabled={busy} style={{
            flex:'1 1 0', minWidth:0, height:44, borderRadius:8, background:'white', color:NAVY,
            border:'1px solid rgba(27,43,75,0.15)', fontSize:14, fontWeight:600, fontFamily:'inherit', cursor: busy?'not-allowed':'pointer',
          }}>Cancel</button>
          <button onClick={submit} disabled={busy || !canSave} style={{
            flex:'1 1 0', minWidth:0, height:44, borderRadius:8,
            background: (busy || !canSave) ? '#E5E5E5' : '#ffba00', color: (busy || !canSave) ? '#999' : NAVY,
            border:'none', fontSize:14, fontWeight:700, fontFamily:'inherit',
            cursor: (busy || !canSave) ? 'not-allowed' : 'pointer',
          }}>{busy ? 'Saving…' : 'Schedule'}</button>
        </div>
      )}
    >
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        {/* Audit-2026-05-09 a11y M5: <label> wrap on each form control. */}
        <label style={{ display:'block', cursor:'pointer' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Contact</div>
          <select value={contactId} onChange={e => setContactId(e.target.value)} style={inputStyle}>
            <option value="">- pick a contact -</option>
            {pickable.map(c => <option key={c.id} value={c.id}>{c.name || formatPhone(c.phone) || c.id.slice(0,4)}</option>)}
          </select>
        </label>
        <label style={{ display:'block', cursor:'pointer' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Kind</div>
          <select value={kind} onChange={e => setKind(e.target.value)} style={inputStyle}>
            {KIND_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <DatePresetRow value={date} onChange={setDate} />
        <div style={{ display:'flex', gap:8 }}>
          <input type="date" aria-label="Event date" value={date} min={todayMin} max="2099-12-31" onChange={e => setDate(e.target.value)} style={{ ...inputStyle, flex:'1 1 0', minWidth:0 }} />
          <input type="time" aria-label="Event time" value={time} step="900" onChange={e => setTime(e.target.value)} style={{ ...inputStyle, flex:'1 1 0', minWidth:0 }} />
        </div>
        {/* Prep notes, mirrors AddEventInline so the top-level Add path no
            longer silently drops them (CAL-04). Saves to calendar_events.notes. */}
        <label style={{ display:'block', cursor:'text' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>Notes (optional)</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={kind === 'install' ? 'Panel brand, gen amps, gate code, access notes…' : 'Notes (optional)'}
            rows={2}
            style={{ ...inputStyle, height:'auto', minHeight:54, padding:'10px 12px', resize:'vertical' }} />
        </label>
        {/* durationMin mirrors submit()'s kind-derived durations (install 180,
            inspect 30, else 60) so the pre-save hint and the post-save
            Conflict chip agree. */}
        {contactId && <ScheduleConflictHint date={date} time={time} durationMin={kind === 'install' ? 180 : kind === 'inspect' ? 30 : 60} contactId={contactId} />}
      </div>
    </ModalShell>
  );
}

// Schedule-conflict hint. Validates a proposed slot against existing
// events for the same day. Flags time overlap and back-to-back same-day
// events with insufficient drive-time buffer. Drive-time is a heuristic
// (same city = 5min, different = 25min, unknown = 15min) - solid enough
// for the truck-dispatch-fitness check without a routing API call.
function ScheduleConflictHint({ date, time, durationMin = 60, contactId }) {
  if (!date || !time) return null;
  const events = window.CRM?.events || [];
  const contacts = window.CRM?.contacts || [];
  const contact = contacts.find(c => c.id === contactId);
  // Build the slot start/end Date objects in local TZ.
  const [yy, mm, dd] = date.split('-').map(Number);
  const [hh, mn] = time.split(':').map(Number);
  const start = new Date(yy, mm - 1, dd, hh, mn);
  const end = new Date(start.getTime() + durationMin * 60000);

  const myCity = (contact?.address || '').split(',').slice(1, 2).join('').trim().toLowerCase();
  const sameDay = events.filter(e => {
    if (!e.start_at || e.status !== 'scheduled') return false;
    const d = new Date(e.start_at);
    return d.getFullYear() === yy && d.getMonth() === mm - 1 && d.getDate() === dd;
  });

  let issue = null;
  for (const e of sameDay) {
    const eStart = new Date(e.start_at);
    const eEnd = e.end_at ? new Date(e.end_at) : new Date(eStart.getTime() + 60 * 60000);
    // Overlap?
    if (eStart < end && eEnd > start) {
      issue = { kind: 'overlap', other: e };
      break;
    }
    // Back-to-back tightness - gap between earlier-end and later-start.
    const otherC = contacts.find(c => c.id === e.contact_id);
    const otherCity = (otherC?.address || '').split(',').slice(1, 2).join('').trim().toLowerCase();
    const driveMin = !myCity || !otherCity ? 15 : (myCity === otherCity ? 5 : 25);
    if (eEnd <= start) {
      const gapMin = (start - eEnd) / 60000;
      if (gapMin < driveMin) {
        issue = { kind: 'tight', other: e, gapMin: Math.round(gapMin), driveMin };
        break;
      }
    } else if (start <= eStart) {
      const gapMin = (eStart - end) / 60000;
      if (gapMin < driveMin) {
        issue = { kind: 'tight', other: e, gapMin: Math.round(gapMin), driveMin };
        break;
      }
    }
  }

  if (!issue) return null;
  const otherName = contacts.find(c => c.id === issue.other.contact_id)?.name || 'Another event';
  return (
    <div style={{
      background: issue.kind === 'overlap' ? '#FEE2E2' : '#FEF3C7',
      border: `1px solid ${issue.kind === 'overlap' ? '#FECACA' : '#FDE68A'}`,
      borderRadius:8, padding:'8px 10px', marginTop:6,
      fontSize:11, color: issue.kind === 'overlap' ? '#991B1B' : '#92400E', lineHeight:1.4,
    }}>
      <div style={{ fontWeight:700, marginBottom:2 }}>
        {issue.kind === 'overlap' ? '⚠ Overlaps with another event' : '⚠ Tight schedule'}
      </div>
      {issue.kind === 'overlap' ? (
        <span>{otherName} is already booked at {formatTime(issue.other.start_at)}.</span>
      ) : (
        <span>Only {issue.gapMin} min between this and {otherName} ({formatTime(issue.other.start_at)}). Drive estimate: {issue.driveMin} min.</span>
      )}
    </div>
  );
}

// Date quick-pick chips. Today / Tomorrow / Friday / Next week. Tapping
// a chip writes the YYYY-MM-DD into the date input. The active chip
// highlights gold so Key knows what's currently selected.
function DatePresetRow({ value, onChange }) {
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const friday = new Date(today);
  // 0=Sun, 5=Fri. If today is Friday, jump to next Friday.
  const daysToFri = ((5 - today.getDay() + 7) % 7) || 7;
  friday.setDate(today.getDate() + daysToFri);
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
  const presets = [
    { label:'Today',    iso: fmt(today) },
    { label:'Tomorrow', iso: fmt(tomorrow) },
    { label:'Friday',   iso: fmt(friday) },
    { label:'Next week', iso: fmt(nextWeek) },
  ];
  return (
    <div className="hide-scrollbar" style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:2 }}>
      {presets.map(p => {
        const active = value === p.iso;
        return (
          <button key={p.label} onClick={() => onChange(p.iso)} style={{
            height:44, padding:'0 12px', borderRadius:22, fontFamily:'inherit', fontSize:12, fontWeight:600,
            background: active ? GOLD : 'white', color: NAVY,
            border: active ? 'none' : '1px solid rgba(11,31,59,0.15)',
            cursor:'pointer', whiteSpace:'nowrap', flexShrink:0,
          }}>{p.label}</button>
        );
      })}
    </div>
  );
}

Object.assign(window, { RightPanel, NewProposalModal, NewInvoiceModal, NewContactModal, NewEventModal, ModalShell, DatePresetRow });
// Card components consumed bare by crm-cards.js. Under classic-script loading
// top-level `function` declarations attached to window automatically; under the
// Vite ES module bundle they don't, so they're bridged explicitly here. Values
// are identical; behavior is unchanged.
Object.assign(window, { AdvanceJobCard, StageHistoryCard, ActivityTimelineCard, PermitsCard });
