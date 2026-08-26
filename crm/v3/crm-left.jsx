// crm-left.jsx, Left panel: 5 fully-featured list views
// All lenses consume the canonical DB-shape arrays directly. Views are derived
// inline via filter/sort. No legacy adapters.

// Today's date in YYYY-MM-DD form, LOCAL timezone (toISOString emits UTC, which
// would flip to "tomorrow" after 8 PM EDT). CAL-01: recompute on day rollover,
// not just at module load. A CRM left open across midnight (Key's phone, all
// day) otherwise keeps yesterday's "today", drifting calendar today-highlights
// and NextJobCard countdowns until a manual refresh.
function bppTodayStr(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
let TODAY = bppTodayStr();
function _bppRefreshToday(){ const t = bppTodayStr(); if (t !== TODAY){ TODAY = t; window.TODAY = t; window.dispatchEvent(new CustomEvent('crm-data-changed')); } }
setInterval(_bppRefreshToday, 60000);
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function(){ if (!document.hidden) _bppRefreshToday(); });

// ---- Smart search, typo-tolerant matching (Key 2026-06-18: "make all search
// smart so a typo doesnt derail it"). Shared by the Contacts list AND the Inbox
// full-text search. Exact substring is always the fast path, so behavior is
// unchanged for clean queries; a small bounded edit distance only kicks in when
// the substring misses, so one dropped/transposed/wrong letter still finds the
// row while unrelated queries stay empty (no garbage matches).
// Bounded Damerau-Levenshtein (optimal string alignment): like Levenshtein but
// an ADJACENT TRANSPOSITION ("panle" vs "panel") costs 1, not 2, so the single
// most common typo no longer derails a smart search (Key 2026-06-20).
function boundedLev(a, b, max) {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prevPrev = null;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = new Array(bl + 1);
    cur[0] = i;
    let rowMin = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const bc = b.charCodeAt(j - 1);
      const cost = ac === bc ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      // Transposition: a[i-1],a[i-2] swapped vs b[j-1],b[j-2] is one edit.
      if (i > 1 && j > 1 && ac === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bc) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already past the bound, bail early
    prevPrev = prev;
    prev = cur;
  }
  return prev[bl];
}
// Every whitespace token in the query must hit the text: as a substring (covers
// exact + mid-typing) OR within a tight edit distance of some word in the text
// (forgives a typo). AND across tokens keeps multi-word queries precise.
function smartMatch(query, text) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return true;
  const t = (text || '').toLowerCase();
  if (!t) return false;
  if (t.indexOf(q) !== -1) return true; // whole-query substring, fast path
  const qTokens = q.split(/\s+/).filter(Boolean);
  let words = null; // split the text into words lazily, only if a token needs fuzzing
  return qTokens.every(tok => {
    if (t.indexOf(tok) !== -1) return true;
    if (tok.length < 4) return false; // too short to fuzzy without false hits
    const max = tok.length <= 6 ? 1 : 2; // 1 typo for short words, 2 for longer
    if (words === null) words = t.split(/[^a-z0-9]+/).filter(Boolean);
    return words.some(w => Math.abs(w.length - tok.length) <= max && boundedLev(tok, w, max) <= max);
  });
}
if (typeof window !== 'undefined') { window.smartMatch = smartMatch; window.boundedLev = boundedLev; }

function LeftPanel({ tab, onOpen, dncSet = new Set(), activeContactId }) {
  const { contacts, events, proposals, invoices, messages, calls } = CRM;
  const messagesStatus = CRM.domainStatus?.messages || { state:'idle', error:null };
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background: BG, minHeight:0, position:'relative' }}>
      {tab === 'contacts' && <ContactsList contacts={contacts} messages={messages} calls={calls} proposals={proposals} invoices={invoices} events={events} onOpen={onOpen} dncSet={dncSet} activeContactId={activeContactId} />}
      {tab === 'calendar' && <CalendarList events={events} contacts={contacts} onOpen={onOpen} activeContactId={activeContactId} />}
      {tab === 'finance'  && <FinanceList proposals={proposals} invoices={invoices} contacts={contacts} events={events} onOpen={onOpen} activeContactId={activeContactId} />}
      {tab === 'messages' && <MessagesList messages={messages} calls={calls} contacts={contacts} onOpen={onOpen} dncSet={dncSet} activeContactId={activeContactId} domainStatus={messagesStatus} />}
      {tab === 'calls'    && <CallsList calls={calls} contacts={contacts} onOpen={onOpen} activeContactId={activeContactId} />}
      {/* Subs command center (crm-subs-tab.jsx), operator-only 6th tab, opened
          by the Calendar long-press. Self-fetches from sub-admin-list, so it
          takes no CRM slices. window.SubsTab may be undefined on a cold first
          paint before its script resolves, guard so the pane never crashes. */}
      {tab === 'subs'     && (window.SubsTab ? <window.SubsTab /> : <div style={{ padding: 24, fontSize: 13, color: MUTED }}>Loading subs...</div>)}
      {/* Quick-capture removed 2026-07-01 (Key: "i dont use the todo list
          anymore"); the whole bpp_todos write/read system is retired. */}
    </div>
  );
}

// ── Contact name resolver ────────────────────────────────────────
const contactName = c => {
  // Trim, a whitespace-only name (`'   '`) is truthy but renders blank.
  // Fall back to phone, then ref_id, then em-dash.
  const n = (c?.name || '').trim();
  if (n) return n;
  if (c?.phone) return c.phone;
  return c?.ref_id ? '#' + c.ref_id : '-';
};

// Hover preview, desktop-only peek card. Compact (200px), positioned to
// the right of the contact ROW (not the avatar), connected by a small
// arrow. Skipped on touch devices and when the contact has no real address.
function ContactAvatarHoverPreview({ contact, unread, dncSet, onOpen, size = 40 }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ left: 0, top: 0, arrowSide: 'left' });
  const wrapRef = React.useRef(null);
  const popupRef = React.useRef(null);
  const openTimerRef = React.useRef(null);
  const closeTimerRef = React.useRef(null);
  const isPremium = contact.pricing_tier === 'premium' || contact.pricing_tier === 'premium_plus';

  const startOpen = () => {
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) return;
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    openTimerRef.current = setTimeout(() => {
      // Anchor to the AVATAR, not the row. Anchoring to the row put
      // the popup on the far side of the list pane, the cursor had
      // to cross 200+ px of empty space and the close timer fired
      // before reaching it. Avatar-anchor keeps the popup ~12px from
      // the cursor's last position.
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popupW = 220;
      const popupH = 220;
      const margin = 12;
      const overflowsRight = rect.right + popupW + margin > window.innerWidth - 8;
      const left = overflowsRight ? rect.left - popupW - margin : rect.right + margin;
      const safePadding = 8;
      const wantTop = rect.top - 4;
      const maxTop = window.innerHeight - popupH - safePadding;
      const top = Math.max(safePadding, Math.min(maxTop, wantTop));
      const arrowTop = Math.max(12, Math.min(popupH - 12, (rect.top + rect.height/2) - top));
      setPos({ left, top, arrowSide: overflowsRight ? 'right' : 'left', arrowTop });
      setOpen(true);
    }, 450);
  };
  // 280ms close grace, was 120ms but with avatar-anchored popup the
  // cursor still needs comfortable bridging time to enter without it
  // disappearing mid-traversal.
  const cancelOpen = () => {
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpen(false), 280);
  };
  const keepOpen = () => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  };

  // Clean up pending timers on unmount so we don't fire setOpen() on a dead
  // component when a row scrolls out of the virtualized list mid-delay. Also
  // close the popup on Escape so keyboard users have an exit.
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && open) setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (openTimerRef.current)  clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [open]);

  const heroAddress = contact.address;
  const propertyImage = useContactPropertyImage(open ? contact : null, open);
  const heroUrl = propertyImage.status === 'ready' ? propertyImage.url : null;

  const handleOpenContact = (tab) => (e) => { e.stopPropagation(); cancelOpen(); onOpen(contact.id, tab); };

  return (
    <div
      ref={wrapRef}
      style={{ position:'relative', flexShrink:0 }}
      onMouseEnter={startOpen}
      onMouseLeave={cancelOpen}
    >
      <ContactAvatar contact={contact} size={size} />
      {unread && <div style={{ position:'absolute', top:0, right:0, width:9, height:9, borderRadius:'50%', background:'#dc2626', border:'2px solid white' }} />}
      {/* Portal the popup out of the row's button to avoid invalid
          button-inside-button nesting and to keep it on top of any
          stacking-context the row creates. */}
      {open && ReactDOM.createPortal(
        <div
          ref={popupRef}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={keepOpen}
          onMouseLeave={cancelOpen}
          style={{
            position:'fixed', left:pos.left, top:pos.top, zIndex:9999,
            width:220, background:'white', border:'1px solid rgba(11,31,59,0.12)',
            borderRadius:8, boxShadow:'0 8px 24px rgba(11,31,59,0.16)',
            overflow:'hidden',
            animation: 'bpp-fade-up 180ms cubic-bezier(0.2, 0.8, 0.3, 1) both',
          }}
        >
          {/* Connector arrow, points back at the hovered avatar's actual
              vertical position, even when the popup got clamped near a
              viewport edge. */}
          <div style={{
            position:'absolute', top:pos.arrowTop, marginTop:-6,
            ...(pos.arrowSide === 'left'
              ? { left:-6, borderRight:'6px solid white', borderTop:'6px solid transparent', borderBottom:'6px solid transparent' }
              : { right:-6, borderLeft:'6px solid white', borderTop:'6px solid transparent', borderBottom:'6px solid transparent' }),
            width:0, height:0, filter:'drop-shadow(0 0 0.5px rgba(11,31,59,0.12))',
          }} />
          {heroUrl && (
            <div style={{ position:'relative', height:100, background:'#EBEBEA' }}>
              <img
                src={heroUrl}
                alt=""
                data-property-image-identity={propertyImage.propertyImageIdentity}
                loading="lazy"
                onError={propertyImage.reportPropertyImageFailure}
                style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'50% 30%', filter:'saturate(1.18) contrast(1.04)', display:'block' }}
              />
              <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(0,0,0,0) 60%, rgba(0,0,0,0.72) 100%)', pointerEvents:'none' }} />
              <div style={{ position:'absolute', left:10, right:10, bottom:6, color:'white', fontSize:13, fontWeight:700, textShadow:'0 1px 2px rgba(0,0,0,0.6)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{contactName(contact)}</div>
            </div>
          )}
          <div style={{ padding: heroUrl ? '8px 12px 10px' : '12px 12px 10px' }}>
            {!heroUrl && (
              <div style={{ fontSize:14, fontWeight:700, color:NAVY, marginBottom:5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{contactName(contact)}</div>
            )}
            <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:6 }}>
              {isPremium && <span style={{ fontSize:12, fontWeight:700, color:NAVY, background:GOLD, padding:'1px 6px', borderRadius:20, letterSpacing:'0.04em' }}>{contact.pricing_tier === 'premium_plus' ? 'PREMIUM+' : 'PREMIUM'}</span>}
              <span style={{ fontSize:12, fontWeight:700, color:'#5B21B6', background:'#F5F3FF', padding:'1px 6px', borderRadius:20, letterSpacing:'0.04em' }}>{(window.CRM?.STAGE_LABELS?.[contact.stage] || '').toUpperCase()}</span>
              {(contact.do_not_contact || (dncSet && dncSet.has && dncSet.has(contact.id))) && <span style={{ fontSize:12, fontWeight:700, color:'#991B1B', background:'#FEF2F2', padding:'1px 6px', borderRadius:20 }}>DNC</span>}
            </div>
            {heroAddress && (
              <div style={{ fontSize:11, color:'#666', marginBottom:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{heroAddress}</div>
            )}
            <div style={{ marginBottom:8, minHeight:14 }}>
              <DriveTimeBadgeFromList address={heroAddress} contactId={contact.id} />
            </div>
            <div style={{ display:'flex', gap:5 }}>
              <button
                disabled
                aria-label={contact.phone ? 'Calling is not released yet' : 'No phone number on file'}
                style={{
                  flex:1, minHeight:44, borderRadius:6, background:'#EBEBEA',
                  color:NAVY, opacity:0.5, fontSize:12, fontWeight:600,
                  border:'none', cursor:'not-allowed', fontFamily:'inherit',
                }}
              >Call</button>
              <button
                onClick={handleOpenContact('messages')}
                style={{
                  flex:1, minHeight:44, borderRadius:6, background:'white', color:NAVY,
                  border:'1px solid rgba(11,31,59,0.15)', fontSize:12, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
                }}
              >Text</button>
              <button
                onClick={handleOpenContact('contacts')}
                style={{
                  flex:1, minHeight:44, borderRadius:6, background:'white', color:NAVY,
                  border:'1px solid rgba(11,31,59,0.15)', fontSize:12, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
                }}
              >Open</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Lightweight wrapper, DriveTimeBadge lives in crm-right.jsx; in left list
// hover preview we re-implement a bare version to avoid the import dance.
function DriveTimeBadgeFromList({ address, contactId }) {
  const [info, setInfo] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    setInfo(null);
    setLoading(true);
    if (!isAddressableStreet(address) || typeof driveTimeToContactAddress !== 'function') {
      setLoading(false);
      return () => { alive = false; };
    }
    driveTimeToContactAddress(address, contactId).then(r => {
      if (alive) { setInfo(r); setLoading(false); }
    });
    return () => { alive = false; };
  }, [contactId, address]);
  if (loading || !info) return null;
  const txt = info.minutes < 60 ? `≈ ${info.minutes} min` : `≈ ${Math.floor(info.minutes/60)}h ${info.minutes%60}m`;
  return <span style={{ fontSize:11, fontWeight:600, color:'#666' }}>🚗 {txt} · {info.miles.toFixed(1)} mi</span>;
}
// Local short-form variant, returns the second comma-segment unparsed
// (e.g. "Greenville SC 29615"). Renamed from cityFromAddress because it
// was shadowing the smarter version exported from crm-data.js, which the
// proposal modal relied on for its jurisdiction display.
const cityFromAddrShort = a => (a||'').split(',').slice(1,2).join('').trim();

// ── Panel Header ──────────────────────────────────────────────────
function PanelHeader({ title, action, onAction, count, right }) {
  return (
    // Fixed 60px height so the bottom border aligns with the right-pane
    // ContactStrip's bottom border across the desktop panel divider.
    // Vertical padding is 0, content centers via alignItems:center.
    <div style={{ height:60, padding:'0 18px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #EBEBEA', background:'white', flexShrink:0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:17, fontWeight:700, color: NAVY }}>{title}</span>
        {count != null && <span style={{ fontSize:12, color: MUTED }}>{count}</span>}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        {right}
        {action && (
          <button onClick={onAction} style={{ minHeight:44, background: NAVY, color:'white', border:'none', borderRadius:8, padding:'8px 14px', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', display:'inline-flex', alignItems:'center', gap:5 }}>
            <div style={{width:13,height:13}}>{Icons.plus}</div>{action}
          </button>
        )}
      </div>
    </div>
  );
}

function FilterChips({ options, value, onChange }) {
  const scrollRef = React.useRef(null);
  const handleClick = (optValue, el) => {
    onChange(optValue);
    if (el && scrollRef.current) {
      const c = scrollRef.current;
      const cRect = c.getBoundingClientRect();
      const bRect = el.getBoundingClientRect();
      const target = c.scrollLeft + bRect.left - cRect.left - (cRect.width / 2) + (bRect.width / 2);
      // 'auto' not 'smooth': rAF-driven smooth scrolls freeze in hidden tabs
      // and can abort when the same click's re-render mutates layout.
      c.scrollTo({ left: Math.max(0, target), behavior: 'auto' });
    }
  };
  return (
    <div ref={scrollRef} className="chip-row" style={{ display:'flex', gap:8, padding:'11px 18px 10px', background:'white', borderBottom:'1px solid #EBEBEA', overflowX:'auto', flexShrink:0, scrollbarWidth:'none', msOverflowStyle:'none', scrollSnapType:'x mandatory' }}>
      {options.map(o => {
        const active = value === (o.value||o);
        return (
          <button key={o.value||o} onClick={e => handleClick(o.value||o, e.currentTarget)} style={{
            height:44, padding:'0 14px', borderRadius:8, border: active ? 'none' : '1px solid rgba(11,31,59,0.15)',
            background: active ? NAVY : 'white', color: active ? 'white' : '#666',
            fontSize:13, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', fontFamily:'inherit', flexShrink:0,
            scrollSnapAlign:'start',
            transition:'background 0.15s, color 0.15s',
          }}>{o.label||o}{o.count != null && <span style={{marginLeft:5,opacity:0.7,fontWeight:500}}>({o.count})</span>}</button>
        );
      })}
    </div>
  );
}

// ── Contacts lens bar (CRM revamp 2026-06-10, remake 3) ──────────────
// Mapped from the validated Claude Design comp comps/lens-bar-v2.html.
// Five working lenses stay on the primary row; every other lens lives one
// tap away behind the More chip (mobile: bottom sheet, desktop: anchored
// popover). When the active lens is one of the hidden ones, it surfaces as
// a temporary navy chip after All with an x that resets to All. Used ONLY
// by ContactsList; the messages/calls lists keep FilterChips untouched.
const LENS_MONO = "'JetBrains Mono','DM Mono',monospace";
const LENS_FAINT = '#5b6576'; // comp --text-faint

// Lens picker (Key 2026-06-18): replaces the always-visible lens chip row. A
// funnel button INSIDE the search bar opens this popover; the active lens shows
// as a removable token (so Key can SEE which group he is filtered to, since he
// cannot remember the names). The group drives `stage` ONLY, never the
// free-text search, so the typo-tolerant matcher is never fed a group label.
// Reuses the approved lens-bar-v2 popover + grouped rows verbatim. Open state is
// controlled by ContactsList (the trigger lives in the search bar).
function ContactLensBar({ primary, groups, value, onChange, open = false, onOpenChange }) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 480;
  const setOpen = (v) => { if (onOpenChange) onOpenChange(v); };

  // Esc closes the popover/sheet.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const visibleGroups = groups.filter(g => g.rows.length > 0);
  // The popover is the ONLY lens UI now (no chip row), so it must also list the
  // primary lenses, folded in as a leading "Lenses" group.
  const primaryRows = primary.filter(o => o.value !== 'all');
  const listGroups = primaryRows.length ? [{ name: 'Lenses', rows: primaryRows }, ...visibleGroups] : visibleGroups;

  const pick = (v) => { onChange(v); setOpen(false); };

  // Shared list body (comp .lens-list): grouped 48px rows, zero-count rows muted
  // (still tappable), check on the active row, and the Reset-to-All bottom row.
  const lensRows = (
    <div style={{ padding: '4px 0 0' }}>
      {listGroups.map(g => (
        <React.Fragment key={g.name}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9ca3af', padding: '14px 20px 6px', margin: 0 }}>{g.name}</p>
          {g.rows.map(r => {
            const selected = r.value === value;
            const zero = r.count === 0;
            return (
              <button key={r.value} className="bpp-lens-row" onClick={() => pick(r.value)} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                minHeight: 48, padding: '0 20px', textAlign: 'left',
                fontSize: 15, fontWeight: selected ? 700 : (zero ? 400 : 500),
                color: zero ? LENS_FAINT : NAVY,
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background 180ms cubic-bezier(0.16,1,0.3,1)',
              }}>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                <span style={{ flexShrink: 0, fontFamily: LENS_MONO, fontSize: 12, color: zero ? '#9ca3af' : '#5a6478' }}>{r.count}</span>
                {selected && (
                  <span style={{ flexShrink: 0, width: 16, height: 16, color: NAVY, display: 'inline-flex' }}>
                    <svg viewBox="0 0 16 16" style={{ width: 16, height: 16 }}><path d="M3 8.5l3.5 3.5 6.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                )}
              </button>
            );
          })}
        </React.Fragment>
      ))}
      <button className="bpp-lens-reset" onClick={() => pick('all')} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%',
        minHeight: 44, marginTop: 6, border: 'none', borderTop: '1px solid rgba(27,43,75,0.08)',
        fontSize: 13, fontWeight: 700, color: '#5a6478',
        background: 'none', cursor: 'pointer', fontFamily: 'inherit',
        transition: 'background 180ms cubic-bezier(0.16,1,0.3,1), color 180ms cubic-bezier(0.16,1,0.3,1)',
      }}>Reset to All</button>
    </div>
  );

  const popover = open && (
    <>
      {/* Backdrop: tap closes. Scrim on mobile, transparent on desktop. */}
      <div onClick={() => setOpen(false)} style={{
        position: 'fixed', top: 0, left: 0, width: '100vw', height: 'var(--vvh, 100vh)',
        zIndex: 49, background: isMobile ? 'rgba(11,17,28,0.32)' : 'transparent',
      }} />
      {isMobile ? (
        /* Mobile bottom sheet. A full-viewport wrapper pinned with top/left/width
           bottom-aligns the sheet (a transform ancestor would otherwise capture
           position:fixed). */
        <div role="group" aria-label="Filter by group" style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: 'var(--vvh, 100vh)',
          zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          pointerEvents: 'none',
        }}>
          <div style={{
            pointerEvents: 'auto', width: '100%', maxHeight: 480, overflowY: 'auto',
            background: 'white', borderRadius: '16px 16px 0 0',
            boxShadow: '0 -12px 40px rgba(27,43,75,0.22)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 100, background: 'rgba(27,43,75,0.18)', margin: '10px auto 2px' }} />
            {lensRows}
          </div>
        </div>
      ) : (
        /* Desktop anchored popover under the search bar, right-aligned. */
        <div role="group" aria-label="Filter by group" style={{
          position: 'absolute', top: 'calc(100% + 2px)', right: 0, width: 300,
          background: 'white', border: '1px solid #e5e5e5', borderRadius: 12,
          boxShadow: '0 8px 28px rgba(27,43,75,0.12), 0 2px 8px rgba(27,43,75,0.06)',
          zIndex: 50, paddingBottom: 4, maxHeight: '70vh', overflowY: 'auto',
        }}>
          {lensRows}
        </div>
      )}
    </>
  );

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <style>{`
        .bpp-lens-row:hover { background: #eef1f6 !important; }
        .bpp-lens-reset:hover { background: #eef1f6 !important; color: #1B2B4B !important; }
        .bpp-lens-clearx:hover { background: rgba(255,255,255,0.14) !important; color: #fff !important; }
      `}</style>
      {/* Picker is the popover only (Key 2026-06-19): the picked group's label
          is pasted INTO the search box by ContactsList, so the active filter is
          visible there, not as a separate token chip here. */}
      {popover}
    </div>
  );
}

// ── Contacts List ─────────────────────────────────────────────────
// String stage → display palette
const STAGE_COLORS = {
  new:              { color:'#1E40AF', bg:'#EFF6FF', label:'New' },
  quoted:           { color:'#92400E', bg:'#FFF7ED', label:'Quoted' },
  booked:           { color:'#065F46', bg:'#ECFDF5', label:'Booked' },
  permit_submit:    { color:'#9A3412', bg:'#FFF7ED', label:'Permit submit' },
  permit_waiting:   { color:'#1E3A8A', bg:'#EFF6FF', label:'Permit waiting' },
  permit_approved:  { color:'#0E7490', bg:'#ECFEFF', label:'Permit approved' },
  install:          { color:'#5B21B6', bg:'#F5F3FF', label:'Install' },
  done:             { color:'#374151', bg:'#F3F4F6', label:'Done' },
};

// Unified contact-row PRIORITY PILL (CRM revamp 2026-06-10, mapped from the
// validated crm-contact-row.html comp). The row used to stack up to ~9
// competing chips; now exactly ONE pill shows , the single most important
// action by this ladder. Sentence case, semantic tint families, returns null
// when the deal is calm (empty is good). Reads only buildContactSignals fields
// + the two passed sets, so the source of truth stays shared.
function contactPriorityPill(c, sig, needsReply, noPermit) {
  if (!sig) return null;
  const DANGER  = { color:'#991B1B', bg:'#FEF2F2' };
  const WARN    = { color:'#92400E', bg:'#FEF3C7' };
  const INFO    = { color:'#1E40AF', bg:'#EFF6FF' };
  if (sig.outstandingCents > 0) return { ...DANGER, label: (window.formatMoneyCents ? formatMoneyCents(sig.outstandingCents) : '$' + Math.round(sig.outstandingCents/100)) + ' due' };
  if (sig.stuck && c.stage !== 'new') return { ...DANGER, label: `Stuck ${sig.daysInStage}d` };
  if (sig.veryStale) return { ...WARN, label: `Proposal ${sig.proposalAgeDays}d` };
  if (sig.stale) return { ...WARN, label: `Proposal ${sig.proposalAgeDays}d` };
  if (sig.staleViewed && !sig.recentlyViewedProposal && sig.staleViewedDays != null) return { ...WARN, label: `Viewed ${sig.staleViewedDays}d` };
  if (sig.recentlyViewedProposal) return { ...INFO, label: 'Viewed' };
  if (needsReply) return { ...INFO, label: 'Needs reply' };
  if (noPermit) return { ...WARN, label: 'No permit' };
  return null;
}

// ── Working On rail ───────────────────────────────────────────────────
// Key's daily frustration: he juggles a few active deals and returns to
// them many times a day. Stars are MANUAL (go stale) and Recent is just
// last-viewed. This rail AUTO-surfaces the 3-6 clients he's actively
// working, scored from real signals already in the data (money owed,
// proposal viewed, needs reply, recent two-way, stuck), and hands him the
// next move + one-tap actions per card. Pinned contacts are always in. No
// upkeep: a deal heats up -> it appears; it closes/cools -> it drops off.
// Ported from crm/v3-staging 2026-06-10 (designed via the Working On comp
// + the 2026-06-06 8-lens audit; Move-First Spine card). Reuses
// ContactAvatar + the shared next-action engine.

// ONE priority ladder (audit rank 30): every branch decides the row's sort tier,
// its move (hero label + reason), and its routed action TOGETHER, so the three can
// never disagree. Collapses deriveWorkingMove + triageRank + deriveWorkingAct,
// whose hand-mirrored branch orders were the desync risk (and deriveWorkingAct
// re-called window.permitNextAction per row; the caller's permitAct is used now).
// Tiers: money 0, install 1, permit/readiness 2, reply 3, nudge/stuck 4, follow-up 5.
function deriveRowModel(c, sig, nextAction, needsReply, permitAct) {
  const s = sig || {};
  const first = (contactName(c) || '').split(' ')[0] || 'them';
  const textAct = { tab: 'messages', label: 'Text ' + first };
  const k = nextAction && nextAction.kind;
  // A book_install is premature while a permit is still pending (you cannot
  // schedule before the county approves), so a pending permit suppresses it
  // and the permit branch below leads. mark_installed / mark_paid are
  // post-install and never co-occur with a pending permit.
  if (k === 'book_install' && !permitAct)
    return { tier: 1, move: { label: 'Schedule install', sub: nextAction.sub }, act: { tab: 'calendar', label: 'Schedule' } };
  if (k === 'mark_installed')
    return { tier: 1, move: { label: 'Confirm install', sub: nextAction.sub }, act: { tab: 'calendar', label: 'Confirm' } };
  if (k === 'mark_paid')
    return { tier: 0, move: { label: 'Collect payment', sub: nextAction.sub }, act: { tab: 'finance', label: 'Collect' } };
  if (s.outstandingCents > 0)
    return { tier: 0, move: { label: 'Collect ' + formatMoneyCents(s.outstandingCents), sub: s.outstandingOldestDays ? `owed ${s.outstandingOldestDays}d` : 'unpaid' }, act: { tab: 'finance', label: 'Collect' } };
  // Readiness moments (Operating Model build #3): the job is stalled on KEY
  // between county approval and install day. Same engine as the AdvanceJobCard
  // (advanceJobNext via computeNextActions), so the row verb, the card button,
  // and the readiness-buzz text all say the same thing. Navy, never gold
  // (nothing here moves money); the route lands on the contact detail where
  // the one-tap action lives (Mark verified / the materials rows / Schedule
  // pre-filled with the suggested date). Cannot co-occur with permitAct: both
  // read one advanceJobNext state per contact.
  if (k === 'verify_permit')
    return { tier: 2, move: { label: 'Verify permit', sub: nextAction.sub }, act: { tab: 'contacts', label: 'Verify' } };
  if (k === 'order_parts')
    return { tier: 2, move: { label: 'Order parts', sub: nextAction.sub }, act: { tab: 'contacts', label: 'Order' } };
  if (k === 'suggest_date')
    return { tier: 2, move: { label: 'Schedule install', sub: nextAction.sub }, act: { tab: 'contacts', label: 'Schedule' } };
  // A job sitting with the county beats a generic nudge and a premature
  // book_install, but yields to money. permitAct already carries the verb.
  if (permitAct)
    return { tier: 2, move: { label: permitAct.label, sub: permitAct.sublabel || 'with the county' }, act: { tab: 'contacts', label: permitAct.kind === 'submit_permit' ? 'Submit' : permitAct.kind === 'permit_blocked' ? 'Resolve' : 'Approve' } };
  if (needsReply)
    return { tier: 3, move: { label: 'Reply', sub: 'waiting on you' }, act: textAct };
  if (s.recentlyViewedProposal) return { tier: 4, move: { label: 'Nudge', sub: 'viewed your quote' }, act: textAct };
  if (s.veryStale)              return { tier: 4, move: { label: 'Nudge', sub: `quote out ${s.proposalAgeDays}d, quiet` }, act: textAct };
  if (s.stale)                  return { tier: 4, move: { label: 'Nudge', sub: `quote out ${s.proposalAgeDays}d` }, act: textAct };
  if (s.staleViewed && s.staleViewedDays != null) return { tier: 4, move: { label: 'Nudge', sub: `viewed ${s.staleViewedDays}d ago` }, act: textAct };
  if (s.stuck)                  return { tier: 4, move: { label: 'Move forward', sub: `stuck ${s.daysInStage}d` }, act: textAct };
  return { tier: 5, move: { label: 'Follow up', sub: s.daysSinceTouch != null ? `touched ${s.daysSinceTouch}d ago` : 'in progress' }, act: textAct };
}

// The move-type accent edge (Comp A): the 3px left glance signal, SAME mapping as
// ExpandedContactRow so thin + expanded rows read identically across a stack. Money
// = red, install = green, permit/reply = neutral hairline, else none. Active/open
// row overrides this with gold at the render site.
function moveAccent(act, move) {
  if (!act) return 'transparent';
  if (act.tab === 'finance') return '#dc2626';
  if (act.tab === 'calendar') return '#059669';
  if (act.tab === 'contacts') return 'rgba(11,31,59,0.16)';
  if (move && move.label === 'Reply') return 'rgba(11,31,59,0.16)';
  return 'transparent';
}

// Expanded starred row (Claude Design comp `crm-starred-contact-row`, Key
// 2026-06-19): a pinned contact renders as a taller, richer list row whose JOB
// is "show the one next move + do it in a tap". The MOVE (deriveRowModel .move) is
// the loud hero line; a quiet reason sits under it; a single left accent edge
// (money=red, install=green, permit/reply=neutral) is the glance signal across a
// stack; the routed action (deriveRowModel .act) is gold ONLY when it commits money,
// navy otherwise, with Text as the secondary. NO Call button (Key rarely calls).
// The row body opens the contact; the star + action buttons stop propagation.
// Rendered only outside bulk-select so multi-select stays intact.
function ExpandedContactRow({ c, sig, nextAction, nr, isPinned, active, dncSet, isGoldElected, onOpen, onTogglePin }) {
  const permitAct = window.permitNextAction ? window.permitNextAction(c) : null;
  const s = sig || {};
  const { move, act } = deriveRowModel(c, s, nextAction, nr, permitAct);
  const nm = contactName(c);
  const isMoney = act.tab === 'finance';          // gold is reserved for money
  const primaryIsText = act.tab === 'messages';   // the move itself is texting
  // DNC gate (Comp A slice 2, mustFix G3): a do-not-contact row never presents an
  // OUTBOUND affordance. The Text secondary is dropped; a messaging PRIMARY (Reply)
  // degrades to a view-only "Open thread". Non-contact primaries (Collect -> Finance,
  // Schedule -> Calendar, Submit -> permit) are kept: they don't message the customer.
  const isDnc = !!(c.do_not_contact || (dncSet && dncSet.has && dncSet.has(c.id)));
  const stageLabel = (STAGE_COLORS[c.stage] && c.stage !== 'new') ? STAGE_COLORS[c.stage].label : (c.stage === 'new' ? 'New' : '');
  const city = c.address ? cityFromAddrShort(c.address) : '';
  const identity = [stageLabel, city].filter(Boolean).join('  ·  ');
  const reason = (move.sub ? capitalize(move.sub) : '') + (isDnc ? ((move.sub ? '  ·  ' : '') + 'Do-not-contact') : '');
  const stop = (e) => e.stopPropagation();
  // The single quiet glance signal: a 3px left accent edge keyed to the move
  // type. Active (open) contact overrides it with the gold highlight.
  const accent = isMoney ? '#dc2626'
    : act.tab === 'calendar' ? '#059669'
    : act.tab === 'contacts' ? 'rgba(11,31,59,0.16)'
    : move.label === 'Reply' ? 'rgba(11,31,59,0.16)'
    : 'transparent';
  const txtIcon = <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3h12v8H6.5L3.5 13.2V11H2z"/></svg>;
  const primaryIcon = act.label === 'Confirm'
    ? <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.5"/></svg>
    : act.label === 'Submit'
    ? <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 12V3M4.5 6.5L8 3l3.5 3.5M3 13h10"/></svg>
    : null;
  // Button atoms from the comp: gold (money only), navy (primary move), ghost
  // (secondary / quiet). All 44px tall.
  const btnBase = { height:44, padding:'0 16px', display:'inline-flex', alignItems:'center', justifyContent:'center', gap:7, fontWeight:600, fontSize:14, borderRadius:12, whiteSpace:'nowrap', fontFamily:'inherit', cursor:'pointer', border:0, WebkitTapHighlightColor:'transparent' };
  const goldBtn = { ...btnBase, flex:1, background:GOLD, color:NAVY };
  const navyBtn = { ...btnBase, flex:1, background:NAVY, color:'#fff' };
  const ghostBtn = { ...btnBase, flex:'0 0 auto', minWidth:96, background:'transparent', color:NAVY, boxShadow:'inset 0 0 0 1.5px rgba(11,31,59,0.18)' };
  const navyWide = { ...navyBtn, flex:'0 0 auto', minWidth:128 };
  const ghostWide = { ...ghostBtn, minWidth:128 };
  return (
    <div role="button" tabIndex={0}
      aria-label={`Open ${nm || 'contact'}${move.label ? ', ' + move.label : ''}`}
      onClick={() => onOpen(c.id, 'contacts')}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c.id, 'contacts'); } }}
      style={{
        // iOS Phase 1 (Key 2026-07-09): expanded pinned rows also lose the
        // white card surface. Active row keeps its warm-gold wash so the
        // operator can find where they are; every other pinned row rides
        // the near-white shell background. Hairline divider only. The
        // expanded body (avatar, name, move headline, action buttons) is
        // otherwise unchanged; gold/navy/ghost button routing is preserved,
        // isGoldElected still gates the ONE bold gold Collect.
        position:'relative', width:'100%', boxSizing:'border-box', textAlign:'left',
        padding:'14px 14px 14px 18px', borderBottom:'1px solid rgba(27,43,75,0.085)',
        background: active ? '#FFFBEB' : 'transparent',
        boxShadow: 'inset 3px 0 0 ' + (active ? GOLD : accent),
        border:'none', cursor:'pointer', transition:'background 0.15s', outline:'none',
      }}>
      {/* head: avatar  ·  name/identity  ·  star */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
        <div style={{ flexShrink:0 }}>
          <ContactAvatarHoverPreview contact={c} unread={false} dncSet={dncSet} onOpen={onOpen} size={40} />
        </div>
        <div style={{ flex:1, minWidth:0, paddingTop:1 }}>
          <div style={{ fontSize:15, fontWeight:600, color:NAVY, lineHeight:1.25, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{nm}</div>
          {identity && <div style={{ marginTop:2, fontSize:12, color:'#828ca0', lineHeight:1.3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{identity}</div>}
        </div>
        <button onClick={(e) => { e.stopPropagation(); if (onTogglePin) onTogglePin(e, c.id); }}
          onKeyDown={stop} aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${nm}`} aria-pressed={isPinned}
          style={{ flex:'0 0 auto', width:44, height:44, margin:'-10px -8px -10px 0', display:'inline-flex', alignItems:'center', justifyContent:'center', borderRadius:12, border:0, background:'none', padding:0, cursor:'pointer', color: isPinned ? NAVY : 'rgba(11,31,59,0.25)', WebkitTapHighlightColor:'transparent' }}>
          <svg viewBox="0 0 18 18" width="18" height="18" fill={isPinned?'currentColor':'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 1.6l2.1 4.4 4.8.7-3.5 3.4.8 4.8L9 12.7l-4.2 2.4.8-4.8L2.1 6.7l4.8-.7z"/></svg>
        </button>
      </div>
      {/* the move: hero line (the loudest thing in the row) */}
      <div style={{ margin:'10px 0 0 52px', fontWeight:800, fontSize:18, letterSpacing:'-0.015em', lineHeight:1.15, color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{move.label}</div>
      {reason && <div style={{ margin:'3px 0 0 52px', fontSize:12.5, color:MUTED, lineHeight:1.35, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{reason}</div>}
      {/* actions: gold ONLY on the single elected money row (one gold per list),
          navy for every other money row; Text secondary; no Call. DNC hides the
          outbound Text and turns a messaging primary into a view-only Open thread. */}
      <div style={{ display:'flex', gap:8, margin:'12px 0 0 52px' }}>
        {primaryIsText ? (
          <button onClick={(e) => { e.stopPropagation(); onOpen(c.id, 'messages'); }} onKeyDown={stop}
            aria-label={isDnc ? `Open thread with ${nm}` : `Text ${nm}`}
            style={(isDnc || move.label === 'Reply') ? navyWide : ghostWide}>{txtIcon}{isDnc ? 'Open thread' : 'Text'}</button>
        ) : (
          <>
            <button onClick={(e) => { e.stopPropagation(); onOpen(c.id, act.tab); }} onKeyDown={stop}
              aria-label={`${act.label} ${nm}`} title={act.label}
              style={(isMoney && isGoldElected) ? goldBtn : navyBtn}>{primaryIcon}{act.label}</button>
            {!isDnc && (
              <button onClick={(e) => { e.stopPropagation(); onOpen(c.id, 'messages'); }} onKeyDown={stop} aria-label={`Text ${nm}`}
                style={ghostBtn}>{txtIcon}Text</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Shared iOS-26 bottom search dock (Key 2026-07-10) ────────────────
// One implementation for every searchable list (Contacts, Comms, Subs). The
// tab-bar Search bubble dispatches 'crm-open-list-search'; this reveals a glass
// dock docked above the keyboard, laid out as [filter bubble] [query pill]
// [x-close], each a DETACHED frosted piece (App Store style). The event is
// deliberately distinct from the in-thread 'crm-open-search' (crm-right's
// message-thread search) so the two never cross-fire.
//
// useSearchDock owns the open/close lifecycle + the three shell events:
//   crm-open-list-search  (in)  , tab-bar bubble asks a list to open its dock
//   crm-search-open       (out) , tell the shell to hide the tab bar + title
//   crm-search-close      (out) , tell the shell to bring them back
//   crm-force-close-search(in)  , navigation (open a contact) closes any dock
// onExit runs on the x-close (clear the query + filter); onForceClose runs on
// navigate-away (keep the filter, just hide the dock).
function useSearchDock(inputId, opts = {}) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  // dockVisible lags searchOpen on CLOSE so the dock can play a slide-down exit
  // before it unmounts (matching the tab bar's slide-in). On open it flips true
  // immediately. Reopening mid-exit cancels the pending hide.
  const [dockVisible, setDockVisible] = React.useState(false);
  const hideTimer = React.useRef(null);
  React.useEffect(() => {
    if (searchOpen) {
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      setDockVisible(true);
    } else {
      hideTimer.current = setTimeout(() => { setDockVisible(false); hideTimer.current = null; }, 280);
    }
    return () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  }, [searchOpen]);
  // Track the live open state so the unmount cleanup can tell the shell to
  // restore the tab bar/title if we're torn down WHILE open (e.g. a responsive
  // breakpoint swap remounts the list tree), instead of stranding searchOpen.
  const openRef = React.useRef(false);
  openRef.current = searchOpen;
  // Latest callbacks via a ref so the window listeners never go stale without
  // re-subscribing every render.
  const cb = React.useRef({});
  cb.current.onExit = opts.onExit;
  cb.current.onForceClose = opts.onForceClose;
  const closeSearch = React.useCallback(() => {
    setSearchOpen(false);
    if (cb.current.onExit) cb.current.onExit();
    const el = document.getElementById(inputId);
    if (el) el.blur();
    window.dispatchEvent(new CustomEvent('crm-search-close'));
  }, [inputId]);
  React.useEffect(() => {
    const onOpen = () => {
      setSearchOpen(true);
      window.dispatchEvent(new CustomEvent('crm-search-open'));
      // Focus after the dock paints so iOS attaches the caret + raises the kb.
      requestAnimationFrame(() => { const el = document.getElementById(inputId); if (el) el.focus(); });
    };
    const onForce = () => {
      setSearchOpen(false);
      if (cb.current.onForceClose) cb.current.onForceClose();
      const el = document.getElementById(inputId); if (el) el.blur();
    };
    window.addEventListener('crm-open-list-search', onOpen);
    window.addEventListener('crm-force-close-search', onForce);
    return () => {
      window.removeEventListener('crm-open-list-search', onOpen);
      window.removeEventListener('crm-force-close-search', onForce);
      // Unmounted while open (breakpoint swap / tab change mid-search): reset the
      // shell so it isn't left with the tab bar + title hidden and no dock.
      if (openRef.current) window.dispatchEvent(new CustomEvent('crm-search-close'));
    };
  }, [inputId]);
  return { searchOpen, setSearchOpen, closeSearch, dockVisible };
}

// The dock UI. Layout + material only; every behavior comes in as a prop so
// each list keeps its own query/filter logic. `filters` (optional) is an array
// of { value, label, count } , when present the filter bubble + upward pill
// stack render; omit for a pure text search (Subs).
function SearchDock({ inputId, value, onChange, onClear, onClose, onEnter, placeholder,
  filters = null, activeFilter = 'all', onFilter, filterOpen = false, setFilterOpen, exiting = false }) {
  const hasFilters = Array.isArray(filters) && filters.length > 0;
  return (
    <div className={'bpp-search-dock' + (exiting ? ' is-exiting' : '')}>
      {/* Upward stack of DETACHED frosted pills (Key 2026-07-10): grows UP from
          the search bar (column-reverse, first/most-used at the bottom),
          scrollable with a top gradient. */}
      {hasFilters && filterOpen && (
        <div className="bpp-filter-stack" role="listbox" aria-label="Filters">
          {filters.filter(Boolean).map(opt => {
            const active = activeFilter === opt.value;
            return (
              <button key={opt.value} type="button" role="option" aria-selected={active}
                className={'bpp-filter-pill bpp-glass' + (active ? ' is-active' : '')}
                onClick={() => onFilter(opt.value)}>
                <span>{opt.label}</span>
                {opt.count != null && <span className="bpp-filter-count">{opt.count}</span>}
              </button>
            );
          })}
        </div>
      )}
      {/* Three DETACHED glass pieces (App Store style), NOT fused in one box. */}
      {hasFilters && (
        <button className="bpp-dock-bubble bpp-glass" onClick={() => setFilterOpen(o => !o)}
          aria-haspopup="true" aria-expanded={filterOpen} aria-label="Filter" type="button">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3.5h12M4.5 8h7M7 12.5h2" /></svg>
          {activeFilter && activeFilter !== 'all' && <span className="bpp-dock-dot" />}
        </button>
      )}
      <div className="bpp-dock-pill bpp-glass">
        <span className="bpp-dock-pill-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M20.5 20.5l-4.2-4.2" /></svg></span>
        <input id={inputId} className="bpp-dock-input" value={value} type="search" inputMode="search" enterKeyHint="search"
          aria-label={placeholder} placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }} />
        {value && (
          <button className="bpp-dock-clear" onClick={() => { onClear(); const el = document.getElementById(inputId); if (el) el.focus(); }} aria-label="Clear search" type="button">
            <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>
      <button className="bpp-dock-bubble bpp-glass" onClick={onClose} aria-label="Close search" type="button">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

function ContactsList({ contacts, messages, calls, onOpen, dncSet = new Set(), activeContactId, proposals = [], invoices = [], events = [] }) {
  const proposalsStatus = CRM.domainStatus?.proposals || { state:'idle', error:null };
  const moneyStatus = CRM.domainStatus?.money || { state:'idle', error:null };
  const messagesStatus = CRM.domainStatus?.messages || { state:'idle', error:null };
  const workspaceStatus = CRM.domainStatus?.workspace || { state:'idle', error:null };
  const commercialReady = proposalsStatus.state === 'ready' && moneyStatus.state === 'ready';
  const messagesReady = messagesStatus.state === 'ready';
  const workspaceReady = workspaceStatus.state === 'ready';
  const rowFactsReady = commercialReady && messagesReady && workspaceReady;
  const quoteDeskDataReady = proposalsStatus.state === 'ready' && messagesReady;
  const commercialError = proposalsStatus.state === 'error' || moneyStatus.state === 'error';
  const commercialTruth = commercialReady
    ? ''
    : commercialError
      ? (proposalsStatus.state === 'error' && moneyStatus.state === 'error'
          ? 'Quote and balance unavailable'
          : proposalsStatus.state === 'error' ? 'Quote status unavailable' : 'Balance unavailable')
      : (proposalsStatus.state !== 'ready' && moneyStatus.state !== 'ready'
          ? 'Checking quote and balance...'
          : proposalsStatus.state !== 'ready' ? 'Checking quote...' : 'Checking balance...');
  const activityError = messagesStatus.state === 'error' || workspaceStatus.state === 'error';
  const rowTruth = rowFactsReady
    ? ''
    : !commercialReady
      ? commercialTruth
      : activityError
        ? 'Activity signals unavailable'
        : 'Checking current activity...';
  const [search, setSearch] = React.useState('');
  const [stage, setStage] = React.useState('all');
  const [quotePreReads, setQuotePreReads] = React.useState(() => window.CRM?.peekPreReadsBulk?.() || {});
  const [quoteWalkV2Receipts, setQuoteWalkV2Receipts] = React.useState(
    () => window.CRM?.quoteWalkV2Receipts || {}
  );
  React.useEffect(() => {
    let alive = true;
    window.CRM?.fetchPreReadsBulk?.().then(function (rows) {
      if (alive) setQuotePreReads(rows || {});
    }).catch(function () {});
    return () => { alive = false; };
  }, [contacts]);
  React.useEffect(() => {
    let alive = true;
    window.CRM?.fetchQuoteWalkV2Receipts?.().then(function (rows) {
      if (alive) setQuoteWalkV2Receipts(rows || {});
    }).catch(function () {});
    return () => { alive = false; };
  }, [quotePreReads]);
  React.useEffect(() => {
    const syncReceipts = (event) => {
      const table = event?.detail?.table || '';
      if (!String(table).startsWith('quote_walk_v2_')) return;
      setQuoteWalkV2Receipts({ ...(window.CRM?.quoteWalkV2Receipts || {}) });
    };
    window.addEventListener('crm-data-changed', syncReceipts);
    return () => window.removeEventListener('crm-data-changed', syncReceipts);
  }, []);
  const [newContactOpen, setNewContactOpen] = React.useState(false);
  const [newContactSeed, setNewContactSeed] = React.useState('');
  // Lens group picker (Key 2026-06-18): opened from the funnel button in the
  // search bar; ContactLensBar (now the picker) renders the popover.
  const [lensPickerOpen, setLensPickerOpen] = React.useState(false);
  // When a group is picked, its label is pasted INTO the search box (Key
  // 2026-06-19). lensQuery holds that injected label so the text filter knows
  // to step aside (the stage filter does the work, not a literal text match,
  // which would match no contact named "Work queue" and show an empty list).
  const [lensQuery, setLensQuery] = React.useState(null);
  // Bottom search dock (Key 2026-07-10): the tab-bar bubble dispatches
  // 'crm-open-search'; we reveal a glass dock above the keyboard, laid out as
  // [filter bubble] [search pill] [x-close bubble], and focus the field. The
  // old fixed top search bar is gone. Closing tells the shell to bring the tab
  // bar back (crm-search-close).
  // Bottom search dock lifecycle via the shared hook. onExit (x-close) clears
  // the query + filter; onForceClose (navigate to a contact) keeps the filter.
  const { searchOpen, setSearchOpen, closeSearch, dockVisible } = useSearchDock('bpp-contact-search', {
    onExit: () => { setSearch(''); setStage('all'); setLensQuery(null); setLensPickerOpen(false); },
    onForceClose: () => setLensPickerOpen(false),
  });
  const openCreateContact = () => { setNewContactSeed(search.trim()); setNewContactOpen(true); };
  // Bulk-select mode: long-press / shift-click on a contact row enters
  // multi-select. Action bar slides in at bottom-left with bulk SMS,
  // tag, archive, snooze. Holds a Set of selected contact ids.
  const [selected, setSelected] = React.useState(() => new Set());
  const [bulkMode, setBulkMode] = React.useState(false);
  const longPressTimer = React.useRef(null);
  const exitBulk = () => { setBulkMode(false); setSelected(new Set()); };
  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Saved searches, chip row above the list. localStorage-backed so it
  // syncs across desktop/iPhone via Safari iCloud Tabs but not across
  // accounts. ⌘S while typing a query saves the current search+stage as
  // a named smart-list. Click a chip to apply both filters at once.
  const SAVED_KEY = 'bpp_v3_saved_searches';
  const [savedSearches, setSavedSearches] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); }
    catch { return []; }
  });
  // EmptyHero "Stuck deals" tile fires this event with detail.stage so
  // ContactsList can pre-select the matching filter chip on mount.
  React.useEffect(() => {
    const onSet = (e) => { if (e?.detail?.stage) setStage(e.detail.stage); };
    window.addEventListener('crm-set-stage-filter', onSet);
    return () => window.removeEventListener('crm-set-stage-filter', onSet);
  }, []);
  // ⌘S while typing → save the current search+stage combo as a chip.
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && (search || stage !== 'all')) {
        e.preventDefault();
        const name = window.prompt('Name this search:', search || stage);
        if (!name) return;
        const next = [...savedSearches.filter(s => s.name !== name), { name, search, stage }].slice(-8);
        setSavedSearches(next);
        try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch {}
        window.showToast?.(`Saved "${name}"`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [search, stage, savedSearches]);
  const applySavedSearch = (s) => { setSearch(s.search || ''); setStage(s.stage || 'all'); };
  const removeSavedSearch = (name) => {
    const next = savedSearches.filter(s => s.name !== name);
    setSavedSearches(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch {}
  };
  // Cmd+K (Mac) / Ctrl+K (PC) / "/" focus-search shortcut moved to
  // crm-app.jsx 2026-05-26 so it works from any tab, not just when
  // ContactsList is mounted.
  // Recently-viewed contacts (max 5 chips). Stored by handleOpen in
  // crm-app.jsx, re-render when that fires crm-recent-changed.
  const RECENT_KEY = 'bpp_v3_recent_contacts';
  const [recentIds, setRecentIds] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
    catch { return []; }
  });
  React.useEffect(() => {
    const refresh = () => {
      try { setRecentIds(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')); }
      catch {}
    };
    window.addEventListener('crm-recent-changed', refresh);
    return () => window.removeEventListener('crm-recent-changed', refresh);
  }, []);
  // Tags now live on contacts.tags (column added 2026-05-09). The
  // search filter reads c.tags directly, so no cache invalidation
  // needed; the realtime contacts channel pushes updates and React
  // re-renders. crm-tags-changed is kept as a fast local signal.
  const recentContacts = recentIds
    .map(id => contacts.find(c => c.id === id && !c.archived))
    .filter(Boolean)
    .slice(0, 5);
  // Dwell-gated recency ranks (Key 2026-06-18). recentIds is ordered
  // most-recent-first (handleOpen in crm-app.jsx unshifts a contact only after
  // a >3s dwell, so a quick glance / accidental tap never promotes it). Rank
  // 0 = the last meaningfully-viewed contact. Used by the default sort to
  // float recently-viewed contacts to the TOP of the non-pinned section.
  const recentRankMap = React.useMemo(() => {
    const m = new Map();
    recentIds.forEach((id, i) => { if (!m.has(id)) m.set(id, i); });
    return m;
  }, [recentIds]);
  // Pinned contacts now persist on `contacts.pinned` (migration
  // 20260509140000) so pins sync between desktop and mobile via the
  // existing contacts realtime channel. The shared usePinned() hook
  // derives the set from CRM.contacts, which means any pin toggle
  // anywhere in the app rerenders every consumer once the realtime
  // (or local optimistic) update lands.
  const pinned = window.usePinned ? window.usePinned() : new Set();

  // Snooze map declared early, it's referenced by visibleContacts just
  // below and by the rottingSet and silentSet useMemos, and Babel-standalone
  // hoists destructured useState as `var` so a later declaration would
  // surface as `undefined` on first render. Source-of-truth is localStorage.
  const [snoozeMap, setSnoozeMap] = React.useState(() => window.readSnoozeMap?.() || {});
  React.useEffect(() => {
    const refresh = () => setSnoozeMap(window.readSnoozeMap?.() || {});
    window.addEventListener('crm-snooze-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('crm-snooze-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Counts for filter chips, every stage in the canonical order. Excludes
  // archived AND snoozed so chip counts match what the list actually shows
  // (the list hides snoozed in every lens except Snoozed).
  const visibleContacts = contacts.filter(c => !c.archived && !snoozeMap[c.id]);
  const stageCounts = CRM.STAGE_ORDER.reduce((acc,s) => ({ ...acc, [s]: visibleContacts.filter(c=>c.stage===s).length }), {});

  // "Needs reply" filter: an inbound message older than the most recent
  // outbound (or no outbound at all). One-glance answer to "who's
  // waiting on me?", the highest-leverage filter for a solo pipeline.
  const needsReplySet = React.useMemo(() => {
    const set = new Set();
    const byContact = new Map();
    for (const m of messages) {
      // Operator-only rows (internal notes, system events) are NOT a reply and
      // must not count as the "last message", else saving a note silently
      // clears the NEEDS REPLY pill on a customer still waiting (review
      // 2026-06-10, the recurring silent-signal class). Customer-facing kinds
      // (sms/mms/voicemail/call) all still count.
      if (m.kind === 'note' || m.kind === 'system') continue;
      if (!byContact.has(m.contact_id)) byContact.set(m.contact_id, []);
      byContact.get(m.contact_id).push(m);
    }
    for (const [cid, msgs] of byContact.entries()) {
      msgs.sort((a,b) => (a.sent_at||'').localeCompare(b.sent_at||''));
      const last = msgs[msgs.length - 1];
      if (!last || last.direction !== 'in') continue;
      // Intersect with live contacts: needs-reply on an archived / snoozed /
      // orphaned contact_id would inflate the chip past what the list shows.
      const c = contacts.find(x => x.id === cid);
      if (!c || c.archived || snoozeMap[cid]) continue;
      set.add(cid);
    }
    return set;
  }, [messages, contacts, snoozeMap]);

  // Recently-called: any call started in the last 24h (in/out/missed)
  const recentCallSet = React.useMemo(() => {
    const set = new Set();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const c of calls) {
      if (c.started_at && new Date(c.started_at).getTime() > cutoff) set.add(c.contact_id);
    }
    return set;
  }, [calls]);

  // Per-contact rot signals (stale quote, $owed, days-since-touch, etc.)
  const signalMap = React.useMemo(
    () => buildContactSignals({ contacts, messages, calls, proposals, invoices, events, stageHistory: window.CRM?.stageHistory || [] }),
    [contacts, messages, calls, proposals, invoices, events]
  );

  // "Rotting", anything Key should chase: stale quote, $owed, 7+ days
  // since last touch with an active stage, OR stage-stuck (over SLA for
  // its current stage). The stuck signal catches deals stalling in
  // booked/permit_submit/permit_approved/install, situations the prior
  // rot detector missed because it only watched touch-cadence.
  const rottingSet = React.useMemo(() => {
    const s = new Set();
    for (const [id, sig] of signalMap.entries()) {
      const c = contacts.find(x => x.id === id);
      if (!c || c.archived) continue;
      // Snoozed contacts don't count as "rotting", they're intentionally
      // hidden until their snooze date. Counting them inflates the rot
      // count and undoes the point of snoozing.
      if (snoozeMap[id]) continue;
      // Stage-new leads are excluded from Rotting entirely (2026-06-03 UX pass).
      // They piled up by the hundred and are already covered by Silent leads /
      // Work queue / Cold, drowning the genuinely-slipping deals. Rotting is now
      // a tight "deal slipping away" list: quoted-no-sign, booked-not-installed,
      // owes money, or stuck mid-pipeline.
      if (c.stage === 'new') continue;
      const isActiveStage = c.stage !== 'done';
      const hasRot = sig.stale || sig.outstandingCents > 0 || sig.stuck
        || (isActiveStage && sig.daysSinceTouch != null && sig.daysSinceTouch >= 7);
      if (hasRot) s.add(id);
    }
    return s;
  }, [signalMap, contacts, snoozeMap]);

  // "Cold": stage='new' leads that went 30+ days since our last outreach with
  // zero inbound reply, ever (2026-06-03 UX pass disposition bucket). These are
  // effectively dead stage-1 leads; giving them their own lens stops them
  // inflating Silent leads / Work queue / Rotting. Pure classification: nothing
  // is deleted or written to the DB. They keep stage='new', still appear in All
  // and the New chip, and stay fully reachable. A lead that ever replied, or
  // that we re-contacted in the last 30 days, is NOT cold (it re-warms itself).
  const coldSet = React.useMemo(() => {
    const replied = new Set();
    for (const m of (messages || [])) {
      if (m.direction === 'in' && m.contact_id) replied.add(m.contact_id);
    }
    const s = new Set();
    for (const [id, sig] of signalMap.entries()) {
      const c = contacts.find(x => x.id === id);
      if (!c || c.archived || c.stage !== 'new') continue;
      if (snoozeMap[id] || c.do_not_contact) continue;
      if (replied.has(id)) continue;
      if (sig.daysSinceTouch != null && sig.daysSinceTouch >= 30) s.add(id);
    }
    return s;
  }, [signalMap, contacts, messages, snoozeMap]);

  // "Silent leads", stage='new' contacts with no inbound reply in 2+ days.
  // The 2026-05-08 audit found 71 silent stage-1 contacts (Alex's initial
  // SMS fired but no reply, follow-up cron isn't running on them yet
  // because ALEX_TEST_MODE=true). This chip is the diagnostic surface so
  // Key can see who's stuck and re-engage manually.
  const silentSet = React.useMemo(() => {
    const s = new Set();
    for (const [id, sig] of signalMap.entries()) {
      const c = contacts.find(x => x.id === id);
      // Skip DNC: this lens exists to re-text quiet leads, so a do_not_contact
      // contact must never surface here (sibling outreach lenses skip it; TCPA).
      if (!c || c.archived || c.do_not_contact || c.stage !== 'new') continue;
      if (snoozeMap[id]) continue;
      // Cold leads (30d+, never replied) graduate out of Silent into their own
      // bucket, so Silent leads stays the recoverable "recently went quiet" set.
      if (coldSet.has(id)) continue;
      const days = sig.daysSinceTouch;
      if (days != null && days >= 2) s.add(id);
    }
    return s;
  }, [signalMap, contacts, snoozeMap, coldSet]);

  const snoozedCount = Object.keys(snoozeMap).filter(id => contacts.some(c => c.id === id && !c.archived)).length;
  const archivedCount = contacts.filter(c => c.archived).length;
  // Built from the same buildContactSignals output the rows use, so the
  // lens chip count + the per-row VIEWED Nd chip stay in lockstep.
  // Highest-leverage rescue category: customer engaged with the price
  // (viewed proposal page) but never signed, deal not dead. Surfaced
  // 2026-05-26 audit found 10 of these worth ~$13.5k in current pipe.
  const staleViewedSet = React.useMemo(() => {
    const s = new Set();
    for (const c of contacts) {
      if (c.archived || snoozeMap[c.id]) continue;
      const sig = signalMap.get(c.id);
      if (sig?.staleViewed && !sig.outstandingCents && !sig.recentlyViewedProposal) s.add(c.id);
    }
    return s;
  }, [signalMap, contacts, snoozeMap]);

  // Work queue: stage-1 follow-up list, priority-scored + bucketed, each with a
  // ready-to-copy message. Excludes archived / DNC / snoozed (courtesy filter).
  // Pure scoring lives in window.workQueueFor (crm-shared). The map is keyed by
  // contact id and used as both the lens set (.has) and per-row data (.get).
  const workQueueMap = React.useMemo(() => {
    const m = new Map();
    const now = Date.now();
    const byContact = new Map();
    for (const msg of (messages || [])) {
      if (!msg.contact_id) continue;
      const arr = byContact.get(msg.contact_id) || []; arr.push(msg); byContact.set(msg.contact_id, arr);
    }
    for (const c of contacts) {
      if (c.archived || c.do_not_contact || snoozeMap[c.id] || coldSet.has(c.id)) continue;
      const entry = window.workQueueFor ? window.workQueueFor(c, byContact.get(c.id) || [], now) : null;
      if (entry) m.set(c.id, entry);
    }
    return m;
  }, [contacts, messages, snoozeMap, coldSet]);

  // "Ready to quote": front-half contacts ('new'/'quoted') with NO live
  // proposal on file. The morning quoting queue, built because lead -> quote
  // is the funnel's lowest-converting stage (20%) with volume above it: open
  // the lens, tap Quote, send the price. A proposal in any non-dead state
  // removes the contact (draft included; chasing a signature is the Rotting /
  // Viewed-no-sign lenses' job). Cold keeps its own bucket.
  // INCLUDES fresh never-replied leads (Key 2026-06-16: "fresh ones are ready
  // to quote") , a brand-new form lead is ready to be quoted, not parked until
  // it replies. Sort key (the map value) is recency: last inbound timestamp
  // for engaged leads, else the contact's created_at for fresh ones, so the
  // queue stays freshest-first whether the recency comes from a reply or a
  // new lead arriving. Dead-status canon mirrors buildContactSignals
  // (mapProposal lowercases status).
  const readyToQuoteMap = React.useMemo(() => {
    const DEAD = ['cancelled', 'declined', 'expired'];
    const hasLiveProposal = new Set();
    for (const p of (proposals || [])) {
      if (p.contact_id && !p.superseded_at && !DEAD.includes(p.status)) hasLiveProposal.add(p.contact_id);
    }
    const lastIn = new Map();
    for (const m of (messages || [])) {
      if (m.direction !== 'in' || !m.contact_id || !m.sent_at) continue;
      if (m.sent_at > (lastIn.get(m.contact_id) || '')) lastIn.set(m.contact_id, m.sent_at);
    }
    const map = new Map();
    for (const c of contacts) {
      if (c.archived || c.do_not_contact || dncSet.has(c.id) || snoozeMap[c.id] || coldSet.has(c.id)) continue;
      if (c.stage !== 'new' && c.stage !== 'quoted') continue;
      if (hasLiveProposal.has(c.id)) continue;
      const receipt = quoteWalkV2Receipts[String(c.id)];
      const legacyReady = window.CRM?.isQuoteDeskReady?.(
        c, quotePreReads[c.id], proposals
      ) === true;
      const deskState = window.CRM?.quoteWalkV2QuoteDeskState?.(
        receipt, legacyReady
      );
      if (!deskState?.actionable) continue;
      // engaged -> sort by last reply; fresh never-replied -> sort by when the
      // lead came in. Skip only if neither timestamp exists (no sort key).
      const ts = lastIn.get(c.id) || c.created_at;
      if (!ts) continue;
      map.set(c.id, ts);
    }
    return map;
  }, [contacts, proposals, messages, dncSet, snoozeMap, coldSet, quotePreReads, quoteWalkV2Receipts]);

  const quoteDeskBlocked = React.useMemo(() => {
    const DEAD = ['cancelled', 'declined', 'expired'];
    const hasLiveProposal = new Set();
    for (const proposal of (proposals || [])) {
      const status = String(proposal.status || '').toLowerCase();
      if (proposal.contact_id && !proposal.superseded_at && !DEAD.includes(status)) {
        hasLiveProposal.add(proposal.contact_id);
      }
    }
    const rows = [];
    for (const contact of contacts) {
      if (contact.archived || contact.do_not_contact || dncSet.has(contact.id)) continue;
      if (contact.stage !== 'new' && contact.stage !== 'quoted') continue;
      if (hasLiveProposal.has(contact.id)) continue;
      if (!quotePreReads[contact.id]?.id) continue;
      const receipt = quoteWalkV2Receipts[String(contact.id)];
      const legacyReady = window.CRM?.isQuoteDeskReady?.(
        contact, quotePreReads[contact.id], proposals
      ) === true;
      const deskState = window.CRM?.quoteWalkV2QuoteDeskState?.(
        receipt, legacyReady
      );
      if (deskState?.mode !== 'legacy' && deskState?.visible
          && !deskState?.actionable) {
        rows.push({ contact, verdict: deskState.verdict });
      }
    }
    return rows;
  }, [contacts, proposals, dncSet, quotePreReads, quoteWalkV2Receipts]);

  const quoteDeskVisibleMap = React.useMemo(() => {
    const map = new Map(readyToQuoteMap);
    for (const row of quoteDeskBlocked) {
      map.set(row.contact.id, row.contact.created_at || '');
    }
    return map;
  }, [readyToQuoteMap, quoteDeskBlocked]);

  // In-flight guard for the Draft + review action: generateDraftProposal is
  // idempotent against the DB, but a fast double-tap could race two inserts
  // past each other's pre-insert check. One in-flight generation per contact.
  const [draftBusy, setDraftBusy] = React.useState(() => new Set());
  // Quote Desk (Musk + fresh air): focus + silent auto-arm. No Prep ceremony.
  const [qdFocusIdx, setQdFocusIdx] = React.useState(0);
  const quoteDeskPrimed = React.useRef(false);

  // "Rescue": the frozen one-tap re-engagement queue (savant audit #2).
  // Stage-1 leads captured BEFORE the call-ask opener went live (2026-06-09)
  // who never replied and have had zero outbound in 21+ days, nobody is
  // working them and nothing automatic touches them. Each row's Load button
  // pre-fills the composer (sessionStorage draft, the established
  // ContactMessages pattern); the SEND stays Key's tap, nothing here sends.
  // Unlike Ready to quote, cold contacts are INCLUDED, they are the target.
  // Map value = queue index in oldest-first order; the index drives the
  // alternating A/B framing (EXP-2026-06-11-012, pre-registered in
  // bot_experiments). ISO-string compares are safe here (same format).
  const rescueMap = React.useMemo(() => {
    const OPENER_LIVE = '2026-06-09'; // call-ask opener go-live (A2P approved)
    const cutoff21 = Date.now() - 21 * 86400000;
    const replied = new Set();
    const lastOut = new Map();
    for (const m of (messages || [])) {
      if (!m.contact_id) continue;
      if (m.direction === 'in') replied.add(m.contact_id);
      else if (m.direction === 'out' && m.sent_at) {
        const t = new Date(m.sent_at).getTime();
        if (t > (lastOut.get(m.contact_id) || 0)) lastOut.set(m.contact_id, t);
      }
    }
    const ids = [];
    for (const c of contacts) {
      if (c.stage !== 'new') continue;
      if (c.archived || c.do_not_contact || dncSet.has(c.id) || snoozeMap[c.id]) continue;
      if (!c.created_at || c.created_at >= OPENER_LIVE) continue;
      if (replied.has(c.id)) continue;
      if ((lastOut.get(c.id) || 0) > cutoff21) continue;
      ids.push(c);
    }
    ids.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    const map = new Map();
    ids.forEach((c, i) => map.set(c.id, i));
    return map;
  }, [contacts, messages, dncSet, snoozeMap]);

  // Permits lens (tap-audit #3): contacts whose NEXT job step is a permit
  // action (submit it / mark it approved / resolve a blocker). permitNextAction
  // reuses advanceJobNext, so a job sitting with the county finally has a
  // one-tap home instead of being buried at the bottom of the contact detail.
  // Map value = the { kind, label, sublabel } the row button + AdvanceJobCard
  // share. Sorted oldest-waiting-first (those rot the longest with the county).
  const permitQueueMap = React.useMemo(() => {
    const m = new Map();
    const arr = [];
    for (const c of contacts) {
      // Exclude snoozed too (the list filter hides snoozed contacts, so the
      // chip count must match or it reads N but shows 0; regression review).
      if (c.archived || c.do_not_contact || snoozeMap[c.id]) continue;
      const act = window.permitNextAction ? window.permitNextAction(c) : null;
      if (act) arr.push([c, act]);
    }
    arr.sort((a, b) => (a[0].created_at || '').localeCompare(b[0].created_at || ''));
    arr.forEach(([c, act]) => m.set(c.id, act));
    return m;
  }, [contacts, proposals, invoices, events, snoozeMap, window.CRM && window.CRM.permits]);

  // Highest-urgency next action per contact (money/install moves from the
  // shared engine). Feeds the expanded starred rows (ExpandedContactRow,
  // the next-move + routed gold action) and the row priority pills.
  const nextActionByContact = React.useMemo(() => {
    const m = new Map();
    const acts = window.computeNextActions ? window.computeNextActions({ contacts, proposals, invoices, events, messages }) : [];
    for (const a of acts) { if (a.contactId && !m.has(a.contactId)) m.set(a.contactId, a); }
    return m;
    // The window.CRM.* deps track the readiness rule's inputs: each realtime
    // handler REPLACES those arrays (new identity), and any crm-data-changed
    // bump re-renders this component so the memo re-checks them. Same pattern
    // as permitQueueMap's permits dep.
  }, [contacts, proposals, invoices, events, messages,
      window.CRM && window.CRM.permits, window.CRM && window.CRM.materials, window.CRM && window.CRM.readiness]);

  // Row model (Comp A wiring, Key 2026-07-01): compute the next-move + routed
  // action + triage tier ONCE per contact per data-change (mustFix G2: never call
  // window.permitNextAction/deriveRowModel per row per render frame at 60+ rows).
  // BOTH the default-lens triage sort AND the thin/expanded rows read this map, so
  // the sort tier and the row's move label are guaranteed to come from one source.
  const rowModelByContact = React.useMemo(() => {
    const m = new Map();
    for (const c of contacts) {
      const sig = signalMap.get(c.id) || {};
      const nextAction = nextActionByContact.get(c.id);
      const nr = needsReplySet.has(c.id);
      const permitAct = window.permitNextAction ? window.permitNextAction(c) : null;
      m.set(c.id, deriveRowModel(c, sig, nextAction, nr, permitAct));
    }
    return m;
  }, [contacts, signalMap, nextActionByContact, needsReplySet]);

  // Lens bar v2 (remake 3, comps/lens-bar-v2.html): the five working lenses
  // stay on the primary row; everything else is grouped behind More. Counts
  // come from the same live memos as before.
  // Finance-category filters (Key 2026-07-10): the retired Finance tab's money
  // view is reborn as SEARCH FILTERS. Per-contact membership + totals are built
  // from the SAME helpers as FinanceList (isInvoiceOverdue / invoiceOwedCents /
  // the unbilled rule), so a filter's total matches the old dashboard KPI to the
  // cent. Outstanding = unpaid, not overdue; Overdue = unpaid >14d; Unbilled =
  // approved proposal with no covering invoice; Paid = has a paid invoice.
  const financeMaps = React.useMemo(() => {
    const isUnpaid = i => !i.paid_at && (i.status === 'sent' || i.status === 'viewed' || i.status === 'overdue');
    const outstanding = new Map(), overdue = new Map(), unbilled = new Map(), paid = new Map();
    for (const i of invoices) {
      if (isUnpaid(i)) {
        const owed = (typeof invoiceOwedCents === 'function') ? invoiceOwedCents(i) : (i.amount_cents || 0);
        if (owed > 0) {
          const overdueInv = (typeof isInvoiceOverdue === 'function') ? isInvoiceOverdue(i) : false;
          const m = overdueInv ? overdue : outstanding;
          m.set(i.contact_id, (m.get(i.contact_id) || 0) + owed);
        }
      }
      if (i.status === 'paid') paid.set(i.contact_id, (paid.get(i.contact_id) || 0) + (i.amount_cents || 0));
    }
    const billed = new Set(invoices.filter(i => i.status !== 'voided' && i.status !== 'refunded').map(i => i.contact_id));
    for (const p of proposals) {
      if (p.approved_at && !p.superseded_at && p.status !== 'declined' && p.status !== 'cancelled' && !billed.has(p.contact_id)) {
        unbilled.set(p.contact_id, (unbilled.get(p.contact_id) || 0) + (p.amount_cents || 0));
      }
    }
    return { outstanding, overdue, unbilled, paid };
  }, [invoices, proposals]);
  const FINANCE_LENS = { outstanding: 'Outstanding', overdue: 'Overdue', unbilled: 'Unbilled', paid: 'Paid' };
  const financeMapFor = (v) => v === 'outstanding' ? financeMaps.outstanding
    : v === 'overdue' ? financeMaps.overdue
    : v === 'unbilled' ? financeMaps.unbilled
    : v === 'paid' ? financeMaps.paid : null;
  const isFinanceLens = Object.prototype.hasOwnProperty.call(FINANCE_LENS, stage);
  const financeLensTotal = isFinanceLens
    ? [...(financeMapFor(stage)?.values() || [])].reduce((a, b) => a + b, 0)
    : null;

  const primaryLensOpts = [
    { value:'all',         label:'All' },
    ...(rowFactsReady && workQueueMap.size > 0 ? [{ value:'work_queue', label:'Work queue', count: workQueueMap.size }] : []),
    // Quote Desk always visible (CEO 2026-07-13): morning habit even when empty.
    { value:'ready_to_quote', label:'Quote Desk', count: quoteDeskDataReady ? quoteDeskVisibleMap.size : null },
    ...(rowFactsReady && rescueMap.size > 0 ? [{ value:'rescue', label:'Rescue', count: rescueMap.size }] : []),
    ...(workspaceReady && permitQueueMap.size > 0 ? [{ value:'permits', label:'Permits', count: permitQueueMap.size }] : []),
    ...(messagesReady ? [{ value:'needs_reply', label:'Needs reply', count: needsReplySet.size }] : []),
    ...(rowFactsReady ? [{ value:'rotting', label:'Rotting', count: rottingSet.size }] : []),
  ];
  const moreLensGroups = [
    // Money (Key 2026-07-10): the retired Finance tab, as filters. Each row
    // only shows when it has at least one contact; the active filter puts its
    // total at the top of the list.
    { name:'Money', rows: commercialReady ? [
      ...(financeMaps.outstanding.size > 0 ? [{ value:'outstanding', label:'Outstanding', count: financeMaps.outstanding.size }] : []),
      ...(financeMaps.overdue.size    > 0 ? [{ value:'overdue',     label:'Overdue',     count: financeMaps.overdue.size }] : []),
      ...(financeMaps.unbilled.size   > 0 ? [{ value:'unbilled',    label:'Unbilled',    count: financeMaps.unbilled.size }] : []),
      ...(financeMaps.paid.size       > 0 ? [{ value:'paid',        label:'Paid',        count: financeMaps.paid.size }] : []),
    ] : []},
    // Viewed-no-sign/Cold only render with at least one, same as their old
    // conditional chips. Cold is the parking lot for dead stage-1 leads
    // (30d+, never replied).
    { name:'Signals', rows: rowFactsReady ? [
      { value:'silent_new', label:'Silent leads', count: silentSet.size },
      ...(staleViewedSet.size > 0 ? [{ value:'stale_viewed', label:'Viewed no sign', count: staleViewedSet.size }] : []),
      ...(coldSet.size > 0 ? [{ value:'cold', label:'Cold', count: coldSet.size }] : []),
    ] : []},
    { name:'Pipeline', rows: CRM.STAGE_ORDER.map(s => ({ value:s, label: STAGE_COLORS[s].label, count: stageCounts[s] })) },
    // Housekeeping rows only render with at least one; the whole group
    // disappears when both buckets are empty (ContactLensBar hides empty
    // groups).
    { name:'Housekeeping', rows: [
      ...(snoozedCount > 0 ? [{ value:'snoozed', label:'Snoozed', count: snoozedCount }] : []),
      ...(archivedCount > 0 ? [{ value:'archived', label:'Archived', count: archivedCount }] : []),
    ]},
  ];

  // Picking a group pastes its label INTO the search box (Key 2026-06-19) and
  // sets the lens. lensQuery marks that the search text IS a group label, so the
  // text filter steps aside and the stage filter does the work. 'all' clears all.
  const lensLabelFor = (val) => {
    const row = [...primaryLensOpts, ...moreLensGroups.flatMap(g => g.rows)].find(r => r.value === val);
    return row ? row.label : val;
  };
  const applyLens = (val) => {
    if (val === 'all') { setSearch(''); setStage('all'); setLensQuery(null); setLensPickerOpen(false); }
    else {
      const label = lensLabelFor(val); setSearch(label); setStage(val); setLensQuery(label);
      // Picking a filter closes the dock so the filtered list + its total header
      // are fully visible. This KEEPS the filter (unlike the x-close, which
      // clears + exits); the active-filter header carries the Clear control.
      setSearchOpen(false); setLensPickerOpen(false);
      const el = document.getElementById('bpp-contact-search'); if (el) el.blur();
      window.dispatchEvent(new CustomEvent('crm-search-close'));
    }
  };

  // Boot onto Quote Desk once per session.
  React.useEffect(() => {
    if (quoteDeskPrimed.current) return;
    if (!contacts.length && readyToQuoteMap.size === 0) return;
    quoteDeskPrimed.current = true;
    applyLens('ready_to_quote');
  }, [contacts.length, readyToQuoteMap.size]);

  React.useEffect(() => { setQdFocusIdx(0); }, [readyToQuoteMap.size, stage]);

  // Conditional lenses (work_queue, stale_viewed, cold, snoozed, archived)
  // drop out of the option set when their count hits 0. Quote Desk stays
  // visible at 0 so the morning habit remains discoverable.
  // If the selected one vanishes, reset to All so the list never sits behind
  // an invisible active filter showing a bare "No contacts match". Also clear
  // the injected label so the search box does not keep showing a dead group.
  const stageOptValues = [
    ...primaryLensOpts.map(o => o.value),
    ...moreLensGroups.flatMap(g => g.rows.map(r => r.value)),
  ].join(',');
  React.useEffect(() => {
    if (!stageOptValues.split(',').includes(stage)) { setStage('all'); setLensQuery(null); setSearch(''); }
  }, [stageOptValues, stage]);

  // A contact has unread if they have an unread inbound message
  const hasUnread = cid => messages.some(m => m.contact_id === cid && m.direction === 'in' && m.read_at == null);
  // Or a missed call we haven't responded to (treat missed as unread signal)
  const hasMissedCall = cid => calls.some(c => c.contact_id === cid && c.direction === 'missed');

  // Audit-2026-05-09 H1 + LEFT-06: the message search index was cached on
  // window once and never invalidated, so realtime SMS were invisible to
  // the full-text search until reload. Keying the memo on messages.length
  // caught new inbound (a new row) but NOT an in-place body edit/correction
  // (same array length), which left stale search hits. Key on a cheap
  // content signature instead: row count + summed body length. That moves
  // on inserts, deletes, AND any body edit that changes length, so a
  // corrected message re-indexes, while a status-only realtime update
  // (delivered/read, no body change) correctly skips the rebuild. O(n) over
  // count, far cheaper than rebuilding the index every render.
  const msgSig = (messages || []).reduce((acc, m) => acc + (m.body ? m.body.length : 0), (messages || []).length);
  const msgIdx = React.useMemo(() => {
    const m = new Map();
    for (const msg of (messages || [])) {
      if (!msg.body) continue;
      const arr = m.get(msg.contact_id) || [];
      arr.push(msg.body.toLowerCase());
      m.set(msg.contact_id, arr);
    }
    return m;
  }, [msgSig]);
  const searchDigits = (search || '').replace(/\D/g, '');

  // When free-text searching, a name/address/tag/phone (HEAD) match should rank
  // above a message-body-only match: typing a name surfaces that contact first,
  // not a recently-viewed contact whose body merely mentions the word (Key
  // 2026-06-20, the inbox "key"->"Key Goodson" report; same pattern here). Free
  // text implies no active lens (stage='all'), so this never disturbs the lens
  // sorts. Precompute the head-match set once; the sort floats those up.
  const contactsSearching = !!search && search !== lensQuery && search.trim().length > 0;
  const headHitSet = contactsSearching ? (() => {
    const s = new Set();
    const ql = search.toLowerCase();
    for (const c of contacts) {
      if (searchDigits && (c.phone || '').replace(/\D/g, '').includes(searchDigits)) { s.add(c.id); continue; }
      const tags = Array.isArray(c.tags) ? c.tags : [];
      if (smartMatch(ql, contactName(c) + ' ' + (c.address || '') + ' ' + tags.join(' '))) s.add(c.id);
    }
    return s;
  })() : null;

  const filtered = contacts
    // Archive filter: when stage='archived', show ONLY archived; in
    // every other lens, hide them. This is what makes the Archived chip
    // a recoverable view rather than a permanent eviction.
    .filter(c => stage === 'archived' ? !!c.archived : !c.archived)
    // Snoozed contacts hide from every view EXCEPT the "Snoozed" filter
    // (so a snoozed customer never shows up in Today / Stuck / etc.)
    .filter(c => stage === 'snoozed' ? !!snoozeMap[c.id] : !snoozeMap[c.id])
    .filter(c => stage === 'all' ? true
              : stage === 'work_queue' ? workQueueMap.has(c.id)
              : stage === 'ready_to_quote' ? quoteDeskVisibleMap.has(c.id)
              : stage === 'rescue' ? rescueMap.has(c.id)
              : stage === 'permits' ? permitQueueMap.has(c.id)
              : stage === 'needs_reply' ? needsReplySet.has(c.id)
              : stage === 'rotting' ? rottingSet.has(c.id)
              : stage === 'silent_new' ? silentSet.has(c.id)
              : stage === 'stale_viewed' ? staleViewedSet.has(c.id)
              : stage === 'cold' ? coldSet.has(c.id)
              : stage === 'outstanding' ? financeMaps.outstanding.has(c.id)
              : stage === 'overdue' ? financeMaps.overdue.has(c.id)
              : stage === 'unbilled' ? financeMaps.unbilled.has(c.id)
              : stage === 'paid' ? financeMaps.paid.has(c.id)
              : stage === 'snoozed' ? true
              : stage === 'archived' ? true
              : c.stage === stage)
    .filter(c => {
      // Empty, OR the search box is showing an injected group label (Key
      // 2026-06-19): in the lens case the stage filter above already constrains
      // to the group, so the text matcher steps aside (matching the label as
      // text would return nothing). Free text falls through to smartMatch.
      if (!search || search === lensQuery) return true;
      const q = search.toLowerCase();
      // Tag match, tags now live on `contacts.tags` (column added
      // 2026-05-09). Read straight from the contact row.
      const tags = Array.isArray(c.tags) ? c.tags : [];
      // Audit-2026-05-09 H2: phone is stored E.164 (`+18648638700`); the
      // user types `(864) 863-7800` or `8648637800` from a sticky note.
      // Strip non-digits on both sides if the query has any digits. Phone is
      // matched on raw digits (a typo'd number is not worth fuzzing).
      if (searchDigits && (c.phone || '').replace(/\D/g, '').includes(searchDigits)) return true;
      // Name + address + tags get typo-tolerant matching (Key 2026-06-18) so a
      // misspelled name or street still finds the contact; substring stays the
      // fast path so clean queries behave exactly as before.
      const head = contactName(c) + ' ' + (c.address || '') + ' ' + tags.join(' ');
      if (smartMatch(q, head)) return true;
      // Full-text fallback: search message bodies for queries ≥3 chars
      // (avoid single-letter matches firing scan on every keystroke).
      if (q.length < 3) return false;
      const bodies = msgIdx.get(c.id) || [];
      return bodies.some(b => smartMatch(q, b));
    })
    .sort((a,b) => {
      // Free-text search: float HEAD (name/address/tag/phone) matches above
      // message-body-only matches so a typed name surfaces that contact first
      // (Key 2026-06-20). headHitSet is null unless free-text searching, so the
      // lens sorts below are untouched.
      if (headHitSet) {
        const ra = headHitSet.has(a.id) ? 0 : 1;
        const rb = headHitSet.has(b.id) ? 0 : 1;
        if (ra !== rb) return ra - rb;
      }
      // Work queue sorts by priority score (repliers + freshest first); every
      // other lens keeps the pinned-to-top sort.
      if (stage === 'work_queue') {
        const sa = workQueueMap.get(a.id)?.score || 0;
        const sb = workQueueMap.get(b.id)?.score || 0;
        if (sb !== sa) return sb - sa;
      }
      // Ready to quote: freshest recency first (last reply for engaged leads,
      // lead-arrival time for fresh never-replied ones), the warmest/newest
      // quote opportunity floats to the top.
      if (stage === 'ready_to_quote') {
        const ta = quoteDeskVisibleMap.get(a.id) || '';
        const tb = quoteDeskVisibleMap.get(b.id) || '';
        if (tb !== ta) return tb.localeCompare(ta);
      }
      // Rescue: oldest-first (the precomputed queue index IS the sort key,
      // and it also drives the A/B framing assignment).
      if (stage === 'rescue') {
        const ia = rescueMap.get(a.id) ?? Infinity;
        const ib = rescueMap.get(b.id) ?? Infinity;
        if (ia !== ib) return ia - ib;
      }
      // Triage tier sort (Comp A, Key 2026-07-01), DEFAULT lens only: the most
      // urgent next-move floats to the top so the list reads as a to-do queue
      // (money > schedule/confirm install > permit > reply > nudge > follow up).
      // The 3 purpose-built lenses (work queue score / ready-to-quote recency /
      // rescue queue index) and free-text search keep their own sort above and are
      // untouched. Pinned + recently-viewed still float, but WITHIN the urgency band
      // (they no longer jump the whole queue) , see plan §2.4 / §7 (Key to confirm).
      const useTriage = rowFactsReady && !headHitSet && stage !== 'work_queue' && stage !== 'ready_to_quote' && stage !== 'rescue';
      if (useTriage) {
        const ma = rowModelByContact.get(a.id), mb = rowModelByContact.get(b.id);
        const ta = ma ? ma.tier : 5, tb = mb ? mb.tier : 5;
        if (ta !== tb) return ta - tb;
        const sa = signalMap.get(a.id) || {}, sb = signalMap.get(b.id) || {};
        if (ta === 0) {                                    // money band: biggest, then oldest
          const oa = sa.outstandingCents || 0, ob = sb.outstandingCents || 0;
          if (ob !== oa) return ob - oa;
          const da = sa.outstandingOldestDays || 0, db = sb.outstandingOldestDays || 0;
          if (db !== da) return db - da;
        } else if (ta <= 2) {                              // schedule/confirm/permit: most stuck first
          const da = sa.daysInStage || 0, db = sb.daysInStage || 0;
          if (db !== da) return db - da;
        } else {                                           // reply/nudge/follow: stalest first
          const da = sa.daysSinceTouch || 0, db = sb.daysSinceTouch || 0;
          if (db !== da) return db - da;
        }
      }
      // Default order (and the deep tiebreak under the lens sorts above):
      // pinned (starred) contacts float to the top of their band, then the most-
      // recently VIEWED contacts (Key 2026-06-18, replaces the Recent pill row),
      // then the existing order.
      const pa = pinned.has(a.id) ? 0 : 1, pb = pinned.has(b.id) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ra = recentRankMap.has(a.id) ? recentRankMap.get(a.id) : Infinity;
      const rb = recentRankMap.has(b.id) ? recentRankMap.get(b.id) : Infinity;
      if (ra !== rb) return ra - rb;
      return 0;
    });

  // Gold-density cap (Comp A slice 2, mustFix N2): exactly ONE gold primary in the
  // whole list. The gold button only appears on expanded (pinned) rows, so elect the
  // single highest-triage pinned MONEY contact; every other money row renders navy.
  // `filtered` is already triage-sorted, so the first pinned finance contact wins.
  let goldElectedId = null;
  for (const gc of filtered) {
    if (!pinned.has(gc.id)) continue;
    const grm = rowModelByContact.get(gc.id);
    if (grm && grm.act && grm.act.tab === 'finance') { goldElectedId = gc.id; break; }
  }

  const qdFocusContact = stage === 'ready_to_quote' && filtered.length
    ? filtered[Math.min(qdFocusIdx, filtered.length - 1)]
    : null;

  // Quote Desk keys: 1 Text, 2 Draft, 3 Next. Auto-arm owns batch. No send.
  const qdRitualRef = React.useRef({});
  qdRitualRef.current = {
    stage,
    filtered,
    qdFocusContact,
    draftBusy,
    onOpen,
    setDraftBusy,
    quotePreReads,
    proposals,
  };
  React.useEffect(() => {
    const onKey = async (e) => {
      const r = qdRitualRef.current;
      if (r.stage !== 'ready_to_quote' || !r.filtered.length) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = (t && t.tagName) ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
      const c = r.qdFocusContact;
      if (!c) return;
      if (e.key === '3') {
        e.preventDefault();
        setQdFocusIdx(i => (i + 1) % r.filtered.length);
        return;
      }
      if (e.key === '1') {
        e.preventDefault();
        const receipt = window.CRM?.quoteWalkV2Receipts?.[String(c.id)];
        const legacyReady = window.CRM?.isQuoteDeskReady?.(
          c, r.quotePreReads[c.id], r.proposals
        ) === true;
        const deskState = window.CRM?.quoteWalkV2QuoteDeskState?.(
          receipt, legacyReady
        );
        if (deskState?.mode === 'legacy') {
          if (c.do_not_contact) {
            window.showToast?.('Marked do not contact');
            return;
          }
          const preRead = r.quotePreReads[c.id] || null;
          const result = window.CRM?.prefillFirmQuoteSms
            ? window.CRM.prefillFirmQuoteSms(c, preRead)
            : { ok: false, error: 'quote desk not loaded' };
          if (!result.ok) {
            window.showToast?.('Could not draft: ' + (result.error || 'unknown'));
            return;
          }
          r.onOpen(c.id, 'messages');
          return;
        }
        window.showToast?.(
          deskState?.verdict?.message || 'Quote Walk readiness has not been verified.'
        );
        return;
      }
      if (e.key === '2') {
        e.preventDefault();
        const receipt = window.CRM?.quoteWalkV2Receipts?.[String(c.id)];
        const legacyReady = window.CRM?.isQuoteDeskReady?.(
          c, r.quotePreReads[c.id], r.proposals
        ) === true;
        const deskState = window.CRM?.quoteWalkV2QuoteDeskState?.(
          receipt, legacyReady
        );
        if (!deskState?.actionable) {
          window.showToast?.(
            deskState?.verdict?.message || 'Quote Walk readiness has not been verified.'
          );
          return;
        }
        if (r.draftBusy.has(c.id)) return;
        r.setDraftBusy(prev => new Set(prev).add(c.id));
        try {
          const res = window.CRM?.generateDraftProposal
            ? await window.CRM.generateDraftProposal(c)
            : { ok: false, error: 'generator not loaded' };
          if (res.ok && res.handoffClaimed) {
            window.showToast?.(res.message || 'Quote Walk handoff claimed.');
          } else if (res.ok) {
            r.onOpen(c.id, 'finance');
          } else if (/already exists/i.test(res.error || '')) {
            r.onOpen(c.id, 'finance');
          } else if (!/already in progress/i.test(res.error || '')) {
            window.showToast?.('Handoff blocked: ' + (res.error || 'unknown'));
          }
        } finally {
          r.setDraftBusy(prev => { const n = new Set(prev); n.delete(c.id); return n; });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const togglePin = async (e, id) => {
    e.stopPropagation();
    const wasOn = pinned.has(id);
    // Optimistic flip the local row so the UI updates instantly, then
    // persist to contacts.pinned. Realtime echoes back to other
    // tabs/devices via the contacts channel.
    const liveContact = (CRM.contacts || []).find(c => c.id === id);
    if (liveContact) liveContact.pinned = !wasOn;
    window.dispatchEvent(new CustomEvent('crm-pin-changed'));
    window.dispatchEvent(new CustomEvent('crm-data-changed'));
    if (CRM.__db) {
      const { error } = await CRM.__db.from('contacts')
        .update({ pinned: !wasOn })
        .eq('id', id);
      if (error) {
        // Revert on persist failure
        if (liveContact) liveContact.pinned = wasOn;
        window.dispatchEvent(new CustomEvent('crm-pin-changed'));
        window.dispatchEvent(new CustomEvent('crm-data-changed'));
        window.showToast?.('Pin save failed: ' + error.message);
        return;
      }
    }
    window.showToast?.(wasOn ? 'Unpinned' : 'Pinned to top');
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
      {/* ── Contacts top zone (remake 7, comps/left-panel-header-v2.html) ──
          Five bands become ONE composition on the app bg (#f4f6f9): the
          labeled tools share the title row, search is a white card, the
          Working On card is a tight horizontal row, recents shrink to one
          quiet pill row, and the lens bar (approved design, unchanged chips)
          closes the zone. The white contact list starts directly under it.
          PanelHeader is no longer used here; it stays the shared header for
          Calendar / Money / Inbox / Calls. */}
      <style>{`
        #bpp-contact-search:focus { border-color: ${GOLD} !important; }
        .bpp-z-tool:hover { border-color: rgba(27,43,75,0.3) !important; color: ${NAVY} !important; }
        .bpp-z-rpill:hover { border-color: rgba(27,43,75,0.3) !important; color: ${NAVY} !important; }
        .bpp-z-add:hover { background: #ffc519 !important; }
        .bpp-z-add:active { transform: scale(0.95); }
        .bpp-z-cancel:hover { background: #eef1f6 !important; color: ${NAVY} !important; }
      `}</style>
      <div style={{ background:'#f4f6f9', padding:'12px 12px 0', flexShrink:0 }}>
        {/* iOS Phase 1 (Key 2026-07-09): the internal "Contacts" title strip
            was removed here because the shell now paints a single large-title
            "Contacts" (bpp-lg-title, 34px/700) at the top of the tab. Two
            titles on one screen was the "double title" bug this pass fixes.
            The search field below stays; it's the row-directly-below-the-large-title
            slot the comp shows. The Permits + Subs long-presses on the bottom
            pill still cover what the old title row's icons used to. */}
        {newContactOpen && (
          <NewContactModal
            initial={newContactSeed}
            onClose={() => { setNewContactOpen(false); setNewContactSeed(''); }}
            onCreated={(id) => { setNewContactOpen(false); setNewContactSeed(''); setSearch(''); onOpen(id, 'contacts'); }}
          />
        )}
        {/* Search moved OFF the top (Key 2026-07-10): the fixed top search bar
            is gone. Search is now the detached tab-bar bubble, which opens a
            glass dock above the keyboard ([filter][pill][x]) rendered at the
            bottom of this column (see the bpp-search-dock block below the list).
            #bpp-contact-search keeps the same id (Cmd-K / "/" focus target). */}
        {/* The fused Working On deck was removed (Key 2026-06-18): starred
            (pinned) contacts now carry their next-move + gold action AS an
            expanded row in the list itself, and the most-recently-viewed
            contacts float to the top of the non-pinned section (the sort).
            One list, no separate deck band. See ExpandedContactRow + the
            recency sort above. */}
        {/* Saved searches, chip row, ⌘S to save the current search+stage
            combo. Right-click / long-press a chip to remove it. Visible
            below the search box once at least one is saved. (Kept from the
            existing surface; the comp doesn't restyle it.) */}
        {savedSearches.length > 0 && (
          <div className="hide-scrollbar" style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af', alignSelf:'center', whiteSpace:'nowrap', letterSpacing:'0.1em', textTransform:'uppercase' }}>Saved</div>
            {savedSearches.map(s => (
              <button key={s.name}
                onClick={() => applySavedSearch(s)}
                onContextMenu={(e) => { e.preventDefault(); if (window.confirm(`Remove "${s.name}"?`)) removeSavedSearch(s.name); }}
                title={`${s.search ? `"${s.search}"` : ''}${s.search && s.stage !== 'all' ? ' + ' : ''}${s.stage !== 'all' ? s.stage : ''} (right-click to remove)`}
                style={{
                  height:44, padding:'0 12px', borderRadius:22, fontFamily:'inherit',
                  background: '#fff8e0', color: NAVY, border: '1px solid rgba(255,186,0,0.4)',
                  fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0,
                }}>{s.name}</button>
            ))}
          </div>
        )}
        {/* Filter picker is now the detached upward pill stack inside the search
            dock (Key 2026-07-10), so the old ContactLensBar bottom-sheet is gone
            from the Contacts header. lensPickerOpen still drives it, toggled from
            the dock's filter bubble. */}
      </div>
      {/* v10.1.16 (Key feedback 2026-05-04): "Clear filter" pill removed.
          Tapping the "All" chip already clears the filter; the extra pill
          was redundant and visually noisy on both desktop and mobile. */}
      <PullToRefreshList style={{ flex:1, overflowY:'auto', minHeight:0, background:'white', borderTop: searchOpen ? 'none' : '1px solid #e5e5e5', paddingBottom:'calc(20px + env(safe-area-inset-bottom))',
        // iOS-26 scroll-edge effect (Key 2026-07-10, HIG-endorsed): content
        // dissolves as it passes the top edge instead of hard-clipping. The
        // fade grows to clear the status bar / Dynamic Island while searching
        // (the large title is hidden then, so the list rides to the very top).
        WebkitMaskImage: searchOpen
          ? 'linear-gradient(to bottom, transparent 0, #000 calc(env(safe-area-inset-top, 0px) + 18px))'
          : 'none',
        maskImage: searchOpen
          ? 'linear-gradient(to bottom, transparent 0, #000 calc(env(safe-area-inset-top, 0px) + 18px))'
          : 'none',
      }} onRefresh={() => window.CRM?.__refetch?.()}>
        {!commercialReady && stage === 'all' && (
          <div role={commercialError ? 'alert' : 'status'} style={{ padding:'9px 16px', background:'#F8F8F6', borderBottom:'1px solid #e5e5e5', fontSize:12, fontWeight:600, color:MUTED }}>
            {commercialTruth}. Contact names and addresses are ready now; quote and balance signals will appear only after they are current.
          </div>
        )}
        {stage === 'ready_to_quote' && !quoteDeskDataReady && (
          <div role={(proposalsStatus.state === 'error' || messagesStatus.state === 'error') ? 'alert' : 'status'} style={{ padding:'24px 16px', textAlign:'center', color:MUTED, lineHeight:1.45 }}>
            <div style={{ fontSize:15, fontWeight:700, color:NAVY }}>{proposalsStatus.state === 'error' || messagesStatus.state === 'error' ? 'Quote Desk could not load' : 'Quote Desk is loading current quotes and messages...'}</div>
            <div style={{ marginTop:6, fontSize:13 }}>The queue stays hidden until its quote and conversation facts are current.</div>
            {(proposalsStatus.state === 'error' || messagesStatus.state === 'error') && <button type="button" onClick={() => window.location.reload()} style={{ marginTop:14, minHeight:44, padding:'0 16px', borderRadius:8, border:'1px solid rgba(27,43,75,.2)', background:'white', color:NAVY, fontFamily:'inherit', fontWeight:700, cursor:'pointer' }}>Try again</button>}
          </div>
        )}
        {isFinanceLens && !commercialReady && (
          <div role={commercialError ? 'alert' : 'status'} style={{ padding:'24px 16px', textAlign:'center', color:MUTED, lineHeight:1.45 }}>
            <div style={{ fontSize:15, fontWeight:700, color:NAVY }}>{commercialTruth}</div>
            <div style={{ marginTop:6, fontSize:13 }}>Money filters stay hidden until invoices, payments, and proposals agree.</div>
          </div>
        )}
        {stage === 'ready_to_quote' && quoteDeskDataReady && quoteDeskBlocked.length > 0 && (
          <div style={{ padding:'10px 16px', background:'#FFFBEB', borderBottom:'1px solid #FDE68A' }}>
            <div style={{ fontSize:12, fontWeight:700, color:NAVY }}>
              {quoteDeskBlocked.length} {quoteDeskBlocked.length === 1 ? 'walk is' : 'walks are'} not ready
            </div>
            <div style={{ marginTop:2, fontSize:12, lineHeight:1.4, color:MUTED }}>
              {quoteDeskBlocked[0].verdict?.message || 'Authoritative readiness is unavailable.'}
            </div>
          </div>
        )}
        {/* Active-filter header (Key 2026-07-10): whenever a lens/filter is on
            and the dock is closed, this names the filter so the list is never
            mysteriously narrowed (no Norman door). For a MONEY filter it also
            carries the TOTAL at the top, the retired Finance dashboard KPI. The
            Clear pill drops back to All. */}
        {stage !== 'all' && stage !== 'ready_to_quote' && !searchOpen && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'11px 16px 10px', background:'white', borderBottom:'1px solid #f0f1f4' }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.05em' }}>{lensLabelFor(stage)}</div>
              <div style={{ fontSize:15, fontWeight:700, color:NAVY, marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {isFinanceLens && financeLensTotal != null
                  ? <><span style={{ fontFamily: LENS_MONO }}>{formatMoneyCents(financeLensTotal)}</span>{'  ·  '}{filtered.length} {filtered.length === 1 ? 'client' : 'clients'}</>
                  : <>{filtered.length} {filtered.length === 1 ? 'contact' : 'contacts'}</>}
              </div>
            </div>
            <button onClick={() => applyLens('all')} aria-label="Clear filter" type="button"
              style={{ flexShrink:0, minHeight:36, padding:'0 14px', borderRadius:100, border:'1px solid rgba(27,43,75,0.15)', background:'white', color:NAVY, fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer' }}>Clear</button>
          </div>
        )}
        {quoteDeskDataReady && filtered.length === 0 && (!search.trim() || search === lensQuery) && stage === 'ready_to_quote' && (
          <div style={{ margin: '64px 20px', padding: '24px 16px', textAlign: 'center', color: MUTED }}>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color: NAVY }}>Clear</div>
            <div style={{ fontSize: 15, marginTop: 10, lineHeight: 1.4 }}>Walks land here.</div>
            <button type="button" onClick={() => applyLens('all')}
              style={{
                marginTop: 18, minHeight: 44, padding: '0 16px', borderRadius: 8,
                border: 'none', background: 'transparent', color: MUTED,
                fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              }}>All contacts</button>
          </div>
        )}
        {filtered.length === 0 && (!search.trim() || search === lensQuery) && stage !== 'ready_to_quote' && !(isFinanceLens && !commercialReady) && (
          // Audit 2026-06-19: an empty group/filter is no longer a dead-end , it
          // offers a one-tap way back to All so the operator is never stuck.
          <EmptyState icon="contacts"
            text={search === lensQuery && search ? 'No contacts in this group' : 'No contacts match'}
            actionLabel={(search === lensQuery && search) || stage !== 'all' ? 'Show all contacts' : null}
            onAction={() => { setSearch(''); setStage('all'); setLensQuery(null); }} />
        )}
        {/* Create-contact row (Key 2026-06-18): the search bar doubles as create.
            The moment Key types, a Create row leads the list; tapping it (or
            pressing Enter with no match) opens the new-contact modal seeded with
            what he typed. Suppressed when the search box is showing a group label
            (Key 2026-06-19), so a picked group never offers "Create Work queue". */}
        {search.trim() && search !== lensQuery && (
          <button onClick={openCreateContact} aria-label={`Create contact ${search.trim()}`}
            style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'13px 18px', border:'none', borderBottom:'1px solid #F5F5F3', background:'white', cursor:'pointer', textAlign:'left', fontFamily:'inherit', minHeight:56, WebkitTapHighlightColor:'transparent' }}>
            <span style={{ flex:'0 0 auto', width:40, height:40, borderRadius:'50%', background:'#FFF8E0', color:NAVY, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
              <div style={{ width:18, height:18 }}>{Icons.plus}</div>
            </span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:700, color:NAVY }}>Create contact</div>
              <div style={{ fontSize:13, color:MUTED, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>&ldquo;{search.trim()}&rdquo;</div>
            </div>
          </button>
        )}
        {filtered.map(c => {
          const sc = STAGE_COLORS[c.stage];
          const unread = messagesReady && (hasUnread(c.id) || hasMissedCall(c.id));
          const isPinned = pinned.has(c.id);
          const isPremium = c.pricing_tier === 'premium' || c.pricing_tier === 'premium_plus';
          const sig = signalMap.get(c.id) || {};
          const rm = rowModelByContact.get(c.id) || {};   // Comp A: next-move + accent
          const quoteDeskReceipt = quoteWalkV2Receipts[String(c.id)];
          const quoteDeskLegacyReady = quoteDeskDataReady && window.CRM?.isQuoteDeskReady?.(
            c, quotePreReads[c.id], proposals
          ) === true;
          const quoteDeskState = window.CRM?.quoteWalkV2QuoteDeskState?.(
            quoteDeskReceipt, quoteDeskLegacyReady
          );
          // Last-message preview: prefer most recent inbound, else outbound.
          // Truncated; relative time. Hidden when DNC pill or other signals
          // would already overflow the row.
          const last = sig.lastMsg;
          const lastPreview = last && last.body
            ? `${last.direction === 'out' ? 'You: ' : ''}${last.body.slice(0, 48)}${last.body.length > 48 ? '…' : ''}`
            : null;
          // Starred (pinned) contacts render as an EXPANDED row carrying the
          // next-move + gold action (Key 2026-06-18, replaces the Working On
          // deck). Suppressed in bulk-select so the checkbox/long-press row
          // stays available for multi-select.
          if (isPinned && !bulkMode && rowFactsReady) {
            return <ExpandedContactRow key={c.id} c={c} sig={sig} nextAction={nextActionByContact.get(c.id)} nr={needsReplySet.has(c.id)} isPinned={isPinned} active={activeContactId === c.id} dncSet={dncSet} isGoldElected={c.id === goldElectedId} onOpen={onOpen} onTogglePin={togglePin} />;
          }
          return (
            // div role=button (not <button>), the hover preview portals
            // action buttons (Call/Text/Open), and React's validateDOMNesting
            // walks the React tree (not the DOM tree), so portaled buttons
            // inside a <button> still warn. Switching to a div skips the
            // warning while keeping click + keyboard activation intact.
            <div key={c.id} role="button" tabIndex={0}
              aria-label={`Open ${contactName(c) || 'contact'}${c.stage ? ', stage ' + ((window.CRM?.STAGE_LABELS||{})[c.stage] || c.stage) : ''}${c.phone ? ', ' + formatPhone(c.phone) : ''}${unread ? ', unread' : ''}`}
              onClick={(e) => {
                if (bulkMode) { toggleSelect(c.id); return; }
                if (e.shiftKey) { setBulkMode(true); toggleSelect(c.id); return; }
                onOpen(c.id,'contacts');
              }}
              onKeyDown={(e) => {
                // Only the row itself opens on Enter/Space. Without this guard a
                // keydown on an inner action button (Draft+review / Load / Reply /
                // Submit / Restore) bubbles here and fires a SECOND, wrong nav on
                // one keypress (the button's own click + the row open). One guard
                // covers every current and future inner control (audit 2026-06-23).
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c.id,'contacts'); }
              }}
              onPointerDown={() => {
                if (bulkMode) return;
                longPressTimer.current = setTimeout(() => {
                  setBulkMode(true);
                  toggleSelect(c.id);
                  // Mild haptic for the device-feel; ignored on desktop.
                  window.bppHaptic && window.bppHaptic('selection');
                }, 500);
              }}
              onPointerUp={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
              onPointerLeave={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
              style={{
                width:'100%',
                // iOS Phase 1 (Key 2026-07-09): row background transparent so
                // the near-white shell shows through; hairline divider only,
                // no per-row card. Active/bulk-selected states still paint
                // their tinted background over the top so the operator can
                // spot the active row. Min-height 60 preserves the 44px tap
                // target floor even after the row shrinks visually.
                // Quote Desk ritual: focused row (keyboard 1/2 target) gets
                // the warm edge so Key sees which lead 1/2 will hit.
                background: bulkMode && selected.has(c.id)
                  ? '#EFF6FF'
                  : (stage === 'ready_to_quote' && qdFocusContact && qdFocusContact.id === c.id)
                    ? '#FFFBEB'
                  : activeContactId===c.id ? '#FFFBEB' : 'transparent',
                border:'none', cursor:'pointer',
                display:'flex', alignItems:'center', gap:10,
                padding:'14px 18px', minHeight:60,
                borderBottom:'1px solid rgba(27,43,75,0.085)', textAlign:'left',
                boxShadow: bulkMode && selected.has(c.id)
                  ? 'inset 3px 0 0 #2563EB'
                  : (stage === 'ready_to_quote' && qdFocusContact && qdFocusContact.id === c.id)
                    ? 'inset 3px 0 0 ' + NAVY
                  : activeContactId===c.id ? 'inset 3px 0 0 '+GOLD : ('inset 3px 0 0 ' + moveAccent(rm.act, rm.move)),
                transition:'background 0.15s',
                outline:'none',
            }}>
              {/* Checkbox slides in when bulk-mode is active. Visual lane
                  of consistent width prevents the row from jumping when
                  bulk-mode toggles on/off. */}
              {bulkMode && (
                <span style={{
                  width:18, height:18, flexShrink:0,
                  borderRadius:4,
                  border: '1.5px solid ' + (selected.has(c.id) ? '#2563EB' : '#CBD5E1'),
                  background: selected.has(c.id) ? '#2563EB' : 'white',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  color:'white', fontSize:12, fontWeight:700,
                }}>{selected.has(c.id) ? '✓' : ''}</span>
              )}
              <ContactAvatarHoverPreview contact={c} unread={unread} dncSet={dncSet} onOpen={onOpen} />
              <div style={{ flex:1, minWidth:0 }}>
                {/* CRM revamp 2026-06-10 (validated crm-contact-row.html comp):
                    name + at most ONE priority pill. The old 9-chip pileup
                    (premium dot, DNC, owed/quote/viewed/stuck/needs-reply/
                    no-permit, snooze, work-queue tone, recent-call, stage chip,
                    preview line) collapsed to a single contactPriorityPill +
                    a calm muted "stage , city" line. Cadence + pin moved to the
                    row-end column; the message preview lives on avatar hover. */}
                <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
                  <span style={{ fontWeight:600, fontSize:14, color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', minWidth:0 }}>{contactName(c)}</span>
                  {(() => {
                    const pill = c.do_not_contact
                      ? { label:'DNC', color:'#991B1B', bg:'#FEF2F2' }
                      : rowFactsReady ? contactPriorityPill(c, sig, needsReplySet.has(c.id), permitNotStarted(c)) : null;
                    if (!pill) return null;
                    return <span style={{ fontSize:12, fontWeight:700, color:pill.color, background:pill.bg, padding:'1px 7px', borderRadius:20, flexShrink:0, whiteSpace:'nowrap' }}>{pill.label}</span>;
                  })()}
                </div>
                {/* Comp A (Key 2026-07-01): the thin row's line 2 is the NEXT-ACTION
                    MOVE VERB (deriveRowModel .move), not the muted stage/city, so every
                    row acts-or-skips without expanding. NAVY for actionable moves,
                    MUTED for a calm "Follow up". Stage/city moved to avatar-hover +
                    the detail page. The .sub reason shows only on the expanded row. */}
                <div style={{ fontSize:13, fontWeight:600, color: (rm.tier != null && rm.tier <= 4) ? NAVY : MUTED, marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {rowTruth || ((rm.move && rm.move.label) || 'Follow up')}
                </div>
              </div>
              {/* Cadence column: days since last touch, quiet mono number.
                  Orthogonal to the priority pill (rot vs cadence are two
                  facts); lives in its own right-edge lane per the comp.
                  Red discipline (UI/UX remake 4): a quiet contact is a
                  warning, not an emergency; red is reserved for money at
                  risk (the OWED pill). 14d+ carries severity through
                  weight, not a third color. */}
              {!c.archived && stage !== 'work_queue' && sig && sig.daysSinceTouch != null && sig.daysSinceTouch >= (c.stage === 'new' ? 2 : 7) && (
                <span title={`Last contact ${sig.daysSinceTouch}d ago`} style={{
                  flexShrink:0, fontSize:12, fontFamily:"'DM Mono', monospace",
                  fontWeight: sig.daysSinceTouch >= 14 ? 700 : 600,
                  color: sig.daysSinceTouch >= 7 ? '#92400E' : '#9CA3AF',
                }}>{sig.daysSinceTouch}d</span>
              )}
              {/* Restore button replaces the pin slot when viewing the
                  Archived lens, surfaces the unarchive action where
                  Key's eye is already trained for row-end actions. */}
              {c.archived ? (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    c.archived = false;
                    if (CRM.__db) await CRM.__db.from('contacts').update({ status: 'Active', archived: false }).eq('id', c.id);
                    window.dispatchEvent(new CustomEvent('crm-data-changed'));
                    window.showToast?.('Restored', {
                      undo: async () => {
                        c.archived = true;
                        window.dispatchEvent(new CustomEvent('crm-data-changed'));
                        if (CRM.__db) {
                          const { error } = await CRM.__db.from('contacts').update({ status: 'Archived', archived: true }).eq('id', c.id);
                          if (error) {
                            c.archived = false;
                            window.dispatchEvent(new CustomEvent('crm-data-changed'));
                            window.showToast?.('Undo failed: ' + error.message);
                          }
                        }
                      },
                      duration: 5000,
                    });
                  }}
                  style={{
                    background:'#D1FAE5', border:'1px solid #6EE7B7',
                    color:'#065F46', fontSize:11, fontWeight:700,
                    padding:'6px 10px', borderRadius:6, cursor:'pointer',
                    fontFamily:'inherit', flexShrink:0, minHeight:44,
                    display:'inline-flex', alignItems:'center',
                  }}
                >Restore</button>
              ) : stage === 'ready_to_quote' ? (
                <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0, alignItems:'stretch' }}
                  onClick={e => e.stopPropagation()}>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (quoteDeskState?.mode === 'legacy') {
                        if (c.do_not_contact) {
                          window.showToast?.('Marked do not contact');
                          return;
                        }
                        const preRead = quotePreReads[c.id] || null;
                        const result = window.CRM?.prefillFirmQuoteSms
                          ? window.CRM.prefillFirmQuoteSms(c, preRead)
                          : { ok: false, error: 'quote desk not loaded' };
                        if (!result.ok) {
                          window.showToast?.('Could not draft: ' + (result.error || 'unknown'));
                          return;
                        }
                        onOpen(c.id, 'messages');
                        return;
                      }
                      window.showToast?.(
                        quoteDeskState?.verdict?.message
                          || 'Quote Walk readiness has not been verified.'
                      );
                    }}
                    aria-label={quoteDeskState?.mode === 'legacy'
                      ? `Draft a firm-quote text for ${contactName(c) || 'contact'}`
                      : `Show Quote Walk readiness for ${contactName(c) || 'contact'}`}
                    title={quoteDeskState?.mode === 'legacy'
                      ? 'Text firm quote'
                      : 'Show authoritative readiness'}
                    style={{
                      background: NAVY, border:'none', color: '#fff', fontSize:11, fontWeight:700,
                      padding:'9px 14px', borderRadius:6, cursor:'pointer',
                      fontFamily:'inherit', minHeight:44,
                    }}
                  >{quoteDeskState?.mode === 'legacy' ? 'Text' : 'Status'}</button>
                  {quoteDeskState?.actionable && (
                    <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (draftBusy.has(c.id)) return;
                      setDraftBusy(prev => new Set(prev).add(c.id));
                      try {
                        const res = window.CRM?.generateDraftProposal
                          ? await window.CRM.generateDraftProposal(c)
                          : { ok: false, error: 'generator not loaded' };
                        if (res.ok && res.handoffClaimed) {
                          window.showToast?.(res.message || 'Quote Walk handoff claimed.');
                        } else if (res.ok) {
                          onOpen(c.id, 'finance');
                        } else if (/already in progress/i.test(res.error || '')) {
                        } else if (/already exists/i.test(res.error || '')) {
                          onOpen(c.id, 'finance');
                        } else {
                          window.showToast?.('Handoff blocked: ' + (res.error || 'unknown'));
                        }
                      } finally {
                        setDraftBusy(prev => { const n = new Set(prev); n.delete(c.id); return n; });
                      }
                    }}
                    aria-label={quoteDeskState?.mode === 'legacy'
                      ? `Create a draft proposal for ${contactName(c) || 'contact'}`
                      : `Claim the Quote Walk handoff for ${contactName(c) || 'contact'}`}
                    title={quoteDeskState?.mode === 'legacy'
                      ? 'Create draft and review'
                      : 'Claim the authoritative Quote Walk handoff'}
                    disabled={draftBusy.has(c.id)}
                    style={{
                      background: 'transparent', border:'1.5px solid rgba(11,31,59,0.22)', color: NAVY, fontSize:11, fontWeight:700,
                      padding:'9px 14px', borderRadius:6, cursor:'pointer',
                      fontFamily:'inherit', minHeight:44,
                      opacity: draftBusy.has(c.id) ? 0.6 : 1,
                    }}
                  >{draftBusy.has(c.id)
                      ? (quoteDeskState?.mode === 'legacy' ? 'Creating' : 'Claiming')
                      : (quoteDeskState?.mode === 'legacy' ? 'Draft + review' : 'Claim handoff')}</button>
                  )}
                </div>
              ) : stage === 'rescue' ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // One-tap rescue (savant audit #2): pre-fill the Messages
                    // composer via the established sessionStorage draft key
                    // (ContactMessages reads 'draft:<id>' on mount / contact
                    // switch) and open the thread. NOTHING sends here, Key
                    // sees the prefilled text, can edit, and the send is his
                    // tap. Framing alternates A/B by queue position
                    // (EXP-2026-06-11-012); the variant breadcrumb key lets a
                    // future send path attribute without guessing.
                    const idx = rescueMap.get(c.id) ?? 0;
                    const variant = idx % 2 === 0 ? 'A' : 'B';
                    const first = (c.name || '').trim().split(/\s+/)[0] || '';
                    const greet = first ? `Hey ${first}, ` : 'Hey, ';
                    const text = variant === 'A'
                      ? greet + "still want your all-in price for the generator inlet? Reply YES and I'll put it together after I review your setup. No pressure either way."
                      : greet + "checking in once. If you still want your home outage-ready, reply YES and I'll put your all-in price together after I review.";
                    try {
                      sessionStorage.setItem('draft:' + c.id, text);
                      sessionStorage.setItem('draft_variant:' + c.id, 'EXP-2026-06-11-012:' + variant);
                    } catch {}
                    onOpen(c.id, 'messages');
                  }}
                  aria-label={`Load a re-engagement message for ${contactName(c) || 'contact'}`}
                  title="Pre-fill the composer with a re-engagement message, you review + send"
                  style={{
                    background: GOLD, border:'none', color: NAVY, fontSize:11, fontWeight:700,
                    padding:'9px 14px', borderRadius:6, cursor:'pointer',
                    fontFamily:'inherit', flexShrink:0, minHeight:44,
                  }}
                >Load</button>
              ) : stage === 'work_queue' ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // One-tap follow-up (workflow-click audit #2): seed the
                    // Messages composer via the established 'draft:<id>' key
                    // (ContactMessages reads it on mount, clears on send) and
                    // open the thread, instead of copy-to-clipboard then paste
                    // into Quo (two apps, four taps). NOTHING sends here, Key
                    // sees the prefilled text, edits, and the send is his tap.
                    const entry = workQueueMap.get(c.id);
                    if (!entry) return;
                    try { sessionStorage.setItem('draft:' + c.id, entry.message); } catch {}
                    onOpen(c.id, 'messages');
                  }}
                  aria-label={`Open a follow-up message for ${contactName(c) || 'contact'}`}
                  title="Pre-fill the composer with a ready follow-up, you review + send"
                  style={{
                    background: GOLD, border:'none', color: NAVY, fontSize:11, fontWeight:700,
                    padding:'9px 14px', borderRadius:6, cursor:'pointer',
                    fontFamily:'inherit', flexShrink:0, minHeight:44,
                  }}
                >Reply</button>
              ) : stage === 'permits' ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // One-tap permit jump (tap-audit #3): open the contact's
                    // AdvanceJobCard, which carries the matching one-tap permit
                    // action (submit / mark approved / resolve). NOTHING fires
                    // here, the act is the operator's tap on that card.
                    onOpen(c.id, 'contacts');
                  }}
                  aria-label={`${(permitQueueMap.get(c.id) || {}).label || 'Permit step'} for ${contactName(c) || 'contact'}`}
                  title="Open the job to act on the permit"
                  style={{
                    background: GOLD, border:'none', color: NAVY, fontSize:11, fontWeight:700,
                    padding:'9px 14px', borderRadius:6, cursor:'pointer',
                    fontFamily:'inherit', flexShrink:0, minHeight:44,
                  }}
                >{(() => { const a = permitQueueMap.get(c.id); return a && a.kind === 'submit_permit' ? 'Submit' : a && a.kind === 'permit_blocked' ? 'Resolve' : 'Approve'; })()}</button>
              ) : (
                <div onClick={e=>togglePin(e,c.id)} role="button" tabIndex={0}
                  aria-label={isPinned ? 'Unpin contact' : 'Pin contact'}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); togglePin(e, c.id); } }}
                  style={{
                    // 44×44 hit area meets iOS HIG even though the visible icon
                    // stays a 14px pixel-art star. Centered via flex.
                    background:'none', cursor:'pointer', flexShrink:0,
                    width:44, height:44, display:'flex', alignItems:'center', justifyContent:'center',
                    // Resting star darkened to gray-400 so the pin affordance is
                    // perceivable at rest on touch (no hover); gray-300 was near-invisible.
                    color: isPinned ? GOLD : '#9CA3AF',
                  }}>
                  <svg viewBox="0 0 24 24" fill={isPinned?'currentColor':'none'} stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                </div>
              )}
            </div>
          );
        })}
      </PullToRefreshList>
      {/* Bulk action bar, slides up from the bottom when bulkMode is on.
          Position:sticky inside the scrolling list keeps it visible
          regardless of scroll position; on mobile the iOS home-indicator
          gets safe-area padding via env(). */}
      {bulkMode && (
        <BulkActionBar
          count={selected.size}
          ids={[...selected]}
          onCancel={exitBulk}
          onSnooze={async (days) => {
            const until = new Date(Date.now() + days * 86400000).toISOString();
            for (const id of selected) window.snoozeContact?.(id, until);
            window.showToast?.(`Snoozed ${selected.size} contact${selected.size === 1 ? '' : 's'}`);
            exitBulk();
          }}
          onArchive={async () => {
            const ok = await window.confirmAction?.({
              title: `Archive ${selected.size} contact${selected.size === 1 ? '' : 's'}?`,
              body: 'Moves these contacts out of the active list.',
              confirmLabel: 'Archive all',
              destructive: false,
            });
            if (!ok) return;
            const ids = [...selected];
            // Optimistic flip for every selected, then a single bulk
            // update with .in() so we get one round-trip + one error
            // path instead of N silent failures. Revert on error.
            for (const id of ids) {
              const c = contacts.find(x => x.id === id);
              if (c) c.archived = true;
            }
            window.dispatchEvent(new CustomEvent('crm-data-changed'));
            if (CRM.__db) {
              const { error } = await CRM.__db.from('contacts')
                .update({ status: 'Archived', archived: true })
                .in('id', ids);
              if (error) {
                for (const id of ids) {
                  const c = contacts.find(x => x.id === id);
                  if (c) c.archived = false;
                }
                window.dispatchEvent(new CustomEvent('crm-data-changed'));
                window.showToast?.(`Archive failed: ${error.message}`);
                return;
              }
            }
            window.showToast?.(`Archived ${ids.length}`);
            exitBulk();
          }}
          onTag={async () => {
            const tag = window.prompt('Add tag to selected contacts:');
            if (!tag || !tag.trim()) return;
            const t = tag.trim().slice(0, 24);
            // Tags live on `contacts.tags` (column added 2026-05-09).
            // Per-contact array_append via PostgREST isn't ergonomic, so
            // we compute the new array client-side and write each row.
            // Done inside Promise.all for one round-trip set.
            if (!CRM.__db) { window.showToast?.('Supabase not loaded'); return; }
            const ids = [...selected];
            const writes = ids.map(async (id) => {
              const live = (CRM.contacts || []).find(c => c.id === id);
              const cur = Array.isArray(live?.tags) ? live.tags : [];
              if (cur.includes(t)) return null;
              const next = [...cur, t];
              if (live) live.tags = next; // optimistic
              return CRM.__db.from('contacts').update({ tags: next }).eq('id', id);
            });
            const results = await Promise.all(writes);
            const failed = results.filter(r => r && r.error);
            if (failed.length) {
              // Best-effort revert: realtime channel will reconcile
              // any rows that did persist; surface the count to Key.
              window.showToast?.(`Tag failed on ${failed.length} of ${ids.length}: ${failed[0].error.message}`);
            } else {
              window.showToast?.(`Tagged ${ids.length} with "${t}"`);
            }
            window.dispatchEvent(new CustomEvent('crm-data-changed'));
            window.dispatchEvent(new CustomEvent('crm-tags-changed'));
            exitBulk();
          }}
        />
      )}
      {/* Bottom search dock (Key 2026-07-10): [filter bubble] [search pill]
          [x-close bubble], glass, docked above the keyboard as a flex child of
          this --vvh column (same trick as the message composer, no fixed-pos
          re-root inside the translateX swap panel). Opened by the tab-bar
          search bubble via 'crm-open-search'. */}
      {dockVisible && (
        <SearchDock
          exiting={!searchOpen}
          inputId="bpp-contact-search"
          value={search}
          placeholder="Search name, phone, address"
          onChange={v => { setSearch(v); if (lensQuery !== null && v !== lensQuery) { setLensQuery(null); if (stage !== 'all') setStage('all'); } }}
          onClear={() => { setSearch(''); setStage('all'); setLensQuery(null); }}
          onClose={closeSearch}
          onEnter={() => { if (search.trim() && search !== lensQuery) { if (filtered.length > 0) { onOpen(filtered[0].id, 'contacts'); closeSearch(); } else openCreateContact(); } }}
          filters={[primaryLensOpts[0], ...(moreLensGroups.find(g => g.name === 'Money')?.rows || []), ...primaryLensOpts.slice(1), ...moreLensGroups.filter(g => g.name !== 'Money').flatMap(g => g.rows)].filter(Boolean)}
          activeFilter={stage}
          onFilter={applyLens}
          filterOpen={lensPickerOpen}
          setFilterOpen={setLensPickerOpen}
        />
      )}
    </div>
  );
}

// ── BulkActionBar ────────────────────────────────────────────────────
// Bottom-anchored bar that appears when bulk-select mode is active.
// 4 actions: Tag (add tag), Snooze 7d, Archive, Cancel. Bulk SMS is
// intentionally NOT here, sending the same SMS to N people is
// usually a mistake (TCPA + per-recipient personalization), and a
// confirm-before-send modal would defeat the point of bulk speed.
function BulkActionBar({ count, ids, onCancel, onSnooze, onArchive, onTag }) {
  const btnStyle = (color, bg) => ({
    padding:'8px 14px', borderRadius:8, border:'none',
    background: bg, color, fontSize:12, fontWeight:700,
    fontFamily:'inherit', cursor:'pointer', minHeight:44,
    display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap',
  });
  return (
    <div style={{
      position:'sticky', bottom:0, left:0, right:0,
      background:'white', borderTop:'1px solid rgba(11,31,59,0.12)',
      boxShadow:'0 -4px 12px rgba(11,31,59,0.06)',
      padding:'10px 14px', paddingBottom:'calc(10px + env(safe-area-inset-bottom))',
      display:'flex', alignItems:'center', gap:10,
      zIndex:5,
    }}>
      <span style={{ fontSize:12, fontWeight:700, color:NAVY, flexShrink:0 }}>{count} selected</span>
      <div style={{ flex:1, display:'flex', gap:6, overflowX:'auto', justifyContent:'flex-end' }} className="hide-scrollbar">
        <button onClick={onTag} style={btnStyle(NAVY, '#F0F4FF')}>+ Tag</button>
        <button onClick={() => onSnooze(7)} style={btnStyle(NAVY, '#F0F4FF')}>Snooze 7d</button>
        <button onClick={onArchive} style={btnStyle('#92400E', '#FEF3C7')}>Archive</button>
        <button onClick={onCancel} style={btnStyle('#666', 'transparent')}>Cancel</button>
      </div>
    </div>
  );
}

// Pull-to-refresh wrapper. Detects a downward drag from scroll-top and,
// past a 60px threshold, fires onRefresh and shows a quick spinner banner.
// Only the scroll container is gesture-handled, inner content renders
// untouched. iOS Safari already has overscroll bounce; this layers the
// refresh on top without fighting the native gesture.
function PullToRefreshList({ children, onRefresh, style }) {
  const ref = React.useRef(null);
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const startY = React.useRef(null);
  const armed = React.useRef(false);

  const onTouchStart = (e) => {
    if (!ref.current) return;
    if (ref.current.scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
      armed.current = true;
    } else {
      armed.current = false;
    }
  };
  const onTouchMove = (e) => {
    if (!armed.current || startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) {
      setPull(Math.min(80, dy * 0.5));
      // Don't preventDefault, that breaks normal scroll on a slight drag.
    }
  };
  const onTouchEnd = async () => {
    if (!armed.current) return;
    armed.current = false;
    startY.current = null;
    if (pull >= 80 && !refreshing) {
      setRefreshing(true);
      try { await onRefresh?.(); } catch {}
      // Brief settle so the spinner is perceptible before snap-back.
      setTimeout(() => { setRefreshing(false); setPull(0); }, 600);
    } else {
      setPull(0);
    }
  };

  return (
    <div ref={ref} style={style} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div style={{
        height: refreshing ? 36 : pull, transition: refreshing ? 'none' : 'height 180ms ease-out',
        display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden',
        color: MUTED, fontSize:11, fontWeight:600, fontFamily:'inherit',
      }}>
        {refreshing ? (
          <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: 'pulse 1s ease-in-out infinite' }}><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 4 21 10 15 10"/></svg>
            Refreshing…
          </span>
        ) : pull >= 80 ? 'Release to refresh' : pull > 0 ? 'Pull to refresh' : ''}
      </div>
      {children}
    </div>
  );
}

// ── Calendar List ─────────────────────────────────────────────────
// Event kinds → display palette
const KIND_COLORS = {
  install:   { accent:'#16A34A', bg:'#F0FDF4', label:'Install' },
  inspect:   { accent:'#7C3AED', bg:'#F5F3FF', label:'Inspect' },
  follow_up: { accent:'#EA580C', bg:'#FFF7ED', label:'Follow-up' },
  pickup:    { accent:'#16A34A', bg:'#F0FDF4', label:'Pickup' },
  meeting:   { accent:'#7C3AED', bg:'#F5F3FF', label:'Meeting' },
};

// Calendar-surface palette (CRM revamp remake 5, mapped from the validated
// comp comps/calendar-surface-v2.html). Kind reads as a 3px colored edge +
// a whispered uppercase tag: install gold, inspect blue, everything else
// quiet navy/gray. KIND_COLORS above keeps the old palette for the labels
// and any other consumer.
const CAL_MONO = "'JetBrains Mono','DM Mono',monospace";
const CAL_KIND = {
  install: { edge: '#ffba00',           ink: '#8a5a00' },
  inspect: { edge: '#2563eb',           ink: '#2563eb' },
  _other:  { edge: 'rgba(27,43,75,0.18)', ink: '#6b7280' },
};
// 180 → "3h", 90 → "1h 30m", 30 → "30m" (comp .etime .du)
const calDurLabel = m => m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;

function CalendarList({ events, contacts, onOpen, activeContactId }) {
  // ── Calendar Day Board (Key directive 2026-06-15, Claude Design comp
  // "Calendar Day Board"). Replaces the Today|Upcoming|All|Done flat list +
  // per-row buttons that Key disliked ("too many buttons I never use, missing
  // features I want"). New shape: a week strip (glance the week's load) -> a
  // single day's agenda -> tap a job to open ONE job sheet that holds every
  // action (reschedule, set installer, set duration, name the job, mark done,
  // message, directions, cancel). Job rows carry no buttons. One gold primary
  // per surface (the + to create, and Mark done inside the sheet). Every tested
  // handler from the old list survives verbatim: the install-stamp on complete,
  // the 5s undo, cancel-as-soft-delete, conflict + needs-invoice detection,
  // pinned-first sorting. New per-EVENT writes (installer/duration/title/
  // reschedule) hit the additive calendar_events columns from the 2026-06-15
  // migration and are all optimistic + revert-on-error. ──
  const getContact = id => contacts.find(c => c.id === id);
  const [mode, setMode] = React.useState('day');       // 'day' | 'week'
  const [selectedDay, setSelectedDay] = React.useState(TODAY);
  const [addOpen, setAddOpen] = React.useState(false);
  const [sheetId, setSheetId] = React.useState(null);  // open job-sheet event id
  // Main-calendar search (Key 2026-07-10): the tab-bar bubble opens the dock;
  // searching swaps the day/week calendar for a flat list of matching events
  // across all dates. Only the LEFT/main calendar , the per-contact right-side
  // calendar never mounts this (no bubble on the detail side).
  const [calSearch, setCalSearch] = React.useState('');
  const { searchOpen, closeSearch, dockVisible } = useSearchDock('bpp-cal-search', { onExit: () => setCalSearch('') });
  const pinned = window.usePinned ? window.usePinned() : new Set();
  const db = window.CRM?.__db;
  const refresh = () => window.dispatchEvent(new CustomEvent('crm-data-changed'));

  const invoices = window.CRM?.invoices || [];
  const installNeedsInvoiceContactIds = React.useMemo(() => {
    const s = new Set();
    const sig = buildContactSignals({ contacts, messages: [], calls: [], proposals: [], invoices, events });
    for (const [id, signal] of sig.entries()) if (signal.installNeedsInvoice) s.add(id);
    return s;
  }, [events, invoices, contacts]);

  // ── local-time date helpers (noon anchor dodges DST edges) ──
  const pad = n => String(n).padStart(2, '0');
  const addDays = (dk, n) => { const d = new Date(dk + 'T12:00'); d.setDate(d.getDate() + n); return dayKey(d.toISOString()); };
  const mondayOf = dk => { const d = new Date(dk + 'T12:00'); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return dayKey(d.toISOString()); };
  const dateNum = dk => new Date(dk + 'T12:00').getDate();
  const [weekAnchor, setWeekAnchor] = React.useState(mondayOf(TODAY));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i));
  const WEEKDAY = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  // Scheduled jobs, pinned-contact first then chronological (the standing
  // "starred contacts at the top of every left list" rule).
  const scheduled = events
    .filter(e => e.status === 'scheduled')
    .sort((a, b) => {
      const ap = pinned.has(a.contact_id) ? 1 : 0;
      const bp = pinned.has(b.contact_id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (a.start_at || '').localeCompare(b.start_at || '');
    });
  const completedAll = events.filter(e => e.status === 'completed');
  const countOn = dk => scheduled.filter(e => dayKey(e.start_at) === dk).length;
  const schedOn = dk => scheduled.filter(e => dayKey(e.start_at) === dk)
    .sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''));
  const doneOn = dk => completedAll.filter(e => dayKey(e.start_at) === dk)
    .sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''));

  // Nothing hides: count jobs outside the visible week so the operator is told
  // they exist (the old All/Upcoming views showed everything; the day board
  // must not silently bury a job three weeks out).
  const weekEnd = weekDays[6];
  const aheadCount = scheduled.filter(e => dayKey(e.start_at) > weekEnd).length;

  const durMin = ev => {
    if (!ev.end_at || !ev.start_at) return 60;
    const m = Math.round((new Date(ev.end_at) - new Date(ev.start_at)) / 60000);
    return Number.isFinite(m) && m > 0 ? m : 60;
  };
  const hasConflict = (ev, all) => {
    const aStart = new Date(ev.start_at).getTime();
    const aEnd = aStart + durMin(ev) * 60000;
    return all.some(o => {
      if (o.id === ev.id || dayKey(o.start_at) !== dayKey(ev.start_at)) return false;
      const bStart = new Date(o.start_at).getTime();
      const bEnd = bStart + durMin(o) * 60000;
      return aEnd > bStart && bEnd > aStart;
    });
  };

  // Plan-route for the SELECTED day (was Today-only; now follows the agenda).
  const dayList = schedOn(selectedDay);
  const dayWithAddr = dayList
    .map(ev => ({ ev, contact: getContact(ev.contact_id) }))
    .filter(({ contact }) => contact && (contact.address || '').trim().length > 5);
  const planRouteUrl = dayWithAddr.length > 0
    ? `https://www.google.com/maps/dir/${dayWithAddr.map(({ contact }) => encodeURIComponent(contact.address)).join('/')}`
    : null;

  // ── optimistic event field write, revert + toast on error ──
  const writeEvent = async (ev, patch, toast) => {
    const prev = {};
    Object.keys(patch).forEach(k => { prev[k] = ev[k]; });
    Object.assign(ev, patch);
    refresh();
    if (db) {
      const { error } = await db.from('calendar_events').update(patch).eq('id', ev.id);
      if (error) {
        Object.assign(ev, prev);
        refresh();
        window.showToast?.(`Save failed: ${error.message}`);
        return false;
      }
    }
    if (toast) window.showToast?.(toast);
    return true;
  };
  const setDuration = (ev, minutes) =>
    writeEvent(ev, { end_at: new Date(new Date(ev.start_at).getTime() + minutes * 60000).toISOString() }, `Duration set to ${calDurLabel(minutes)}`);
  const setInstaller = (ev, name) => {
    const val = name && name.trim() ? name.trim() : null;
    return writeEvent(ev, { assigned_installer: val }, val ? `Installer set to ${val}` : 'Installer cleared');
  };
  const setTitle = (ev, title) =>
    writeEvent(ev, { title: title.trim() || null }, title.trim() ? 'Job named' : 'Name cleared');
  const reschedule = async (ev, localVal) => {
    const newStart = new Date(localVal);
    if (isNaN(newStart.getTime())) return;
    const oldStartIso = ev.start_at;
    const delta = newStart.getTime() - new Date(oldStartIso).getTime();
    if (delta === 0) return;
    const patch = { start_at: newStart.toISOString() };
    if (ev.end_at) patch.end_at = new Date(new Date(ev.end_at).getTime() + delta).toISOString();
    const ok = await writeEvent(ev, patch, `Moved to ${formatDate(newStart.toISOString(), { weekday: 'short', month: 'short', day: 'numeric' })} ${formatTimeShort(newStart.toISOString())}`);
    // Keep the contact's install_date in lock-step only when it was synced from
    // this exact slot (same day), so a reschedule does not leave the contact
    // reading an install on the old date. Never clobbers a hand-set date.
    if (ok && ev.kind === 'install' && db) {
      const c = getContact(ev.contact_id);
      if (c && c.install_date && dayKey(c.install_date) === dayKey(oldStartIso)) {
        c.install_date = patch.start_at;
        refresh();
        await db.from('contacts').update({ install_date: patch.start_at }).eq('id', ev.contact_id);
      }
    }
    setSelectedDay(dayKey(patch.start_at));
    if (dayKey(patch.start_at) < weekAnchor || dayKey(patch.start_at) > weekDays[6]) setWeekAnchor(mondayOf(dayKey(patch.start_at)));
  };

  // Mark an event complete. Preserved verbatim from the old list: install
  // events stamp the contact (install_date + stage 9) and the whole thing is
  // 5s-undoable. DB CHECK permits scheduled/cancelled/completed only.
  const completeEvent = async (ev) => {
    if (ev.status === 'completed') return;
    const c = getContact(ev.contact_id);
    const prevStatus = ev.status;
    const prevContact = c ? { stage: c.stage, install_date: c.install_date } : null;
    let contactPatched = false;
    let installDateStamped = false;
    let stampError = null;
    ev.status = 'completed';
    refresh();
    if (db) {
      const { error } = await db.from('calendar_events').update({ status: 'completed' }).eq('id', ev.id);
      if (error) {
        ev.status = prevStatus;
        refresh();
        window.showToast?.(`Could not mark done: ${error.message}`);
        return;
      }
      if (ev.kind === 'install' && ev.contact_id) {
        const prevStageNum = window.CRM?.STAGE_STR_TO_NUM?.[c?.stage] ?? null;
        const patch = { stage: 9 };
        if (!(c && c.install_date)) { patch.install_date = ev.start_at || new Date().toISOString(); installDateStamped = true; }
        const { error: cErr } = await db.from('contacts').update(patch).eq('id', ev.contact_id);
        if (cErr) { console.warn('[completeEvent] install stamp failed:', cErr.message); stampError = cErr.message; }
        else {
          contactPatched = true;
          if (c) { c.stage = 'done'; if (patch.install_date) c.install_date = patch.install_date; }
          window.CRM?.recordStageTransition?.(ev.contact_id, prevStageNum, 9);
        }
      }
    }
    // If the event marked done but the install-stamp on the contact failed, the
    // job LOOKS complete while the contact never reached Installed (stage 9),
    // silently breaking the post-install loop (review-ask, payout, pipeline).
    // Surface it loudly instead of swallowing the error (bug hunt 2026-06-20).
    if (stampError) {
      window.showToast?.(`Marked done, but the contact didn't move to Installed. Set the stage manually.`, { kind: 'error', duration: 5500 });
      return;
    }
    window.showToast?.(`Marked ${ev.kind || 'event'} done`, {
      undo: async () => {
        ev.status = prevStatus;
        if (contactPatched && prevContact && c) {
          c.stage = prevContact.stage;
          if (installDateStamped) c.install_date = prevContact.install_date;
        }
        refresh();
        if (db) {
          await db.from('calendar_events').update({ status: prevStatus }).eq('id', ev.id);
          if (contactPatched && prevContact) {
            const prevNum = window.CRM?.STAGE_STR_TO_NUM?.[prevContact.stage];
            const revertPatch = {};
            if (prevNum != null) revertPatch.stage = prevNum;
            if (installDateStamped) revertPatch.install_date = prevContact.install_date ?? null;
            if (Object.keys(revertPatch).length) await db.from('contacts').update(revertPatch).eq('id', ev.contact_id);
          }
        }
      },
      duration: 5000,
    });
  };

  // Cancel = canonical soft-delete (status='cancelled' preserves the row for
  // audit/undo). Key uses this for the 30-second day-shuffle, hard-preserved.
  const cancelEvent = async (ev) => {
    const c = getContact(ev.contact_id);
    const ok = await window.confirmAction?.({
      title: `Cancel ${ev.kind || 'event'}?`,
      body: `${contactName(c) || 'Contact'} · ${formatDate(ev.start_at, { month: 'short', day: 'numeric' })} · ${formatTime(ev.start_at)}`,
      confirmLabel: 'Cancel event',
      destructive: true,
    });
    if (!ok) return;
    const prevStatus = ev.status;
    ev.status = 'cancelled';
    refresh();
    if (db) {
      const { error } = await db.from('calendar_events').update({ status: 'cancelled' }).eq('id', ev.id);
      if (error) {
        ev.status = prevStatus;
        refresh();
        window.showToast?.(`Cancel failed: ${error.message}`);
        return;
      }
    }
    window.showToast?.('Event cancelled', {
      undo: async () => {
        ev.status = prevStatus;
        refresh();
        if (db) await db.from('calendar_events').update({ status: prevStatus }).eq('id', ev.id);
      },
      duration: 5000,
    });
  };

  // ── one job block (no buttons; the whole block opens its sheet) ──
  const JobBlock = ({ ev, topDivider }) => {
    const c = getContact(ev.contact_id);
    const done = ev.status === 'completed';
    const conflict = !done && hasConflict(ev, scheduled);
    const isPastInstall = ev.kind === 'install' && new Date(ev.start_at).getTime() < Date.now();
    const needsInvoice = !done && isPastInstall && installNeedsInvoiceContactIds.has(ev.contact_id);
    const ks = CAL_KIND[ev.kind] || CAL_KIND._other;
    const kindLabel = (KIND_COLORS[ev.kind] || KIND_COLORS.meeting).label;
    // Per-EVENT installer wins; fall back to the contact's default installer.
    const inst = ev.assigned_installer || (ev.kind === 'install' ? c?.assigned_installer : null);
    const subName = inst && inst !== 'Key' ? inst : null;
    const chip = conflict
      ? { bg: '#fdf2f2', ink: '#dc2626', label: 'Conflict', icon: (
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1.5L11 10H1z" /><path d="M6 5v2.2M6 8.8v.2" /></svg>) }
      : needsInvoice
      ? { bg: '#fff8e1', ink: '#8a5a00', label: 'Needs invoice', title: 'No invoice yet, bill before this slips', icon: (
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 1.5h6v9l-1.5-.8-1.5.8-1.5-.8-1.5.8z" /></svg>) }
      : subName
      ? { bg: '#eff6ff', ink: '#2563eb', label: subName, title: subName, max: 96, icon: (
          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="6" cy="4" r="2.2" /><path d="M1.8 10.5c.7-2.2 2.3-3.3 4.2-3.3s3.5 1.1 4.2 3.3" /></svg>) }
      : null;
    const addr = (c?.address || '').trim();
    const open = () => done ? onOpen(ev.contact_id, 'calendar', ev.id) : setSheetId(ev.id);
    const title = (ev.title || '').trim();
    return (
      <div role="button" tabIndex={0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        style={{
          // iOS Phase 1 Pass 4: JobBlock rides transparent by default so it
          // sits calmly on the day-agenda card surface. Active row keeps its
          // warm-gold wash. Hairline top-divider between rows is the standard
          // hairline token so every list in the CRM reads the same.
          position: 'relative', display: 'flex', alignItems: 'center', gap: 12,
          minHeight: 64, padding: '12px 12px 12px 0',
          background: activeContactId === ev.contact_id ? '#FFFBEB' : 'transparent',
          borderTop: topDivider ? '1px solid rgba(27,43,75,0.085)' : 'none',
          cursor: 'pointer', textAlign: 'left', outline: 'none', opacity: done ? 0.6 : 1,
        }}>
        <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: '0 2px 2px 0', background: done ? '#cbd2dc' : ks.edge }} />
        <span style={{ flex: '0 0 64px', paddingLeft: 14, fontFamily: CAL_MONO }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: NAVY, fontVariantNumeric: 'tabular-nums' }}>{formatTimeShort(ev.start_at)}</span>
          <span style={{ display: 'block', fontSize: 11, color: '#5b6576', marginTop: 1 }}>{calDurLabel(durMin(ev))}</span>
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, textDecoration: done ? 'line-through' : 'none' }}>{contactName(c)}</span>
            {pinned.has(ev.contact_id) && (
              <svg viewBox="0 0 16 16" width="13" height="13" fill={GOLD} stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
              </svg>
            )}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, minWidth: 0 }}>
            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: done ? '#9ca3af' : ks.ink }}>{title || kindLabel}</span>
            {done ? (
              <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 7.5l3 3 6-7" /></svg>Done
              </span>
            ) : chip ? (
              <span title={chip.title} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 9px', borderRadius: 100, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', background: chip.bg, color: chip.ink, ...(chip.max ? { maxWidth: chip.max + 24, overflow: 'hidden' } : {}) }}>
                {chip.icon}
                <span style={chip.max ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : null}>{chip.label}</span>
              </span>
            ) : addr ? (
              <span style={{ flex: '0 1 auto', fontSize: 12, color: '#5b6576', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addr}</span>
            ) : (
              <span style={{ flex: '0 1 auto', fontSize: 12, color: '#b4451f', fontStyle: 'italic' }}>Address needed</span>
            )}
          </span>
        </span>
        {/* chevron: the row opens a sheet; the affordance says so (no Norman door) */}
        {!done && (
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#c2c8d2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: 2 }}><path d="M6 3l5 5-5 5" /></svg>
        )}
      </div>
    );
  };

  // The day's agenda (scheduled, then a quiet "done" run so completed jobs keep
  // a home, the CAL-13 scar; tapping a done job opens its contact, not a sheet).
  const DayAgenda = ({ dk }) => {
    const sched = schedOn(dk);
    const done = doneOn(dk);
    const nextUp = scheduled.find(e => dayKey(e.start_at) > dk);
    if (sched.length === 0 && done.length === 0) {
      const nextLabel = nextUp ? `${formatDate(nextUp.start_at, { weekday: 'short', month: 'short', day: 'numeric' })} at ${formatTimeShort(nextUp.start_at)}` : null;
      return (
        // iOS Phase 1 Pass 4: empty-day card in the light/flat language.
        // White surface + 16px radius + inset hairline (no drop shadow),
        // matching the .bpp-ios-card recipe used by the detail cards.
        <div style={{ background: '#ffffff', border: 0, borderRadius: 16, boxShadow: 'inset 0 0 0 1px rgba(27,43,75,0.085)', padding: '28px 20px 24px', textAlign: 'center', marginTop: 2 }}>
          <div style={{ width: 44, height: 44, margin: '0 auto 10px', borderRadius: '50%', background: '#eef1f6', color: '#5b6576', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8.5h14M7 2.5v3.5M13 2.5v3.5" /></svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 3 }}>No jobs {dk === TODAY ? 'today' : 'this day'}</div>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 14, lineHeight: 1.5 }}>{nextLabel ? `Open day. Next job ${nextLabel}.` : 'Open day.'}</div>
          <button onClick={() => setAddOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 44, padding: '0 18px', borderRadius: 100, border: '1.5px dashed rgba(27,43,75,0.12)', background: 'transparent', fontSize: 13, fontWeight: 700, color: MUTED, cursor: 'pointer', fontFamily: 'inherit' }}>
            <svg viewBox="0 0 12 12" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1v10M1 6h10" /></svg>
            New job
          </button>
        </div>
      );
    }
    return (
      // iOS Phase 1 Pass 4: day agenda in the same light/flat card language.
      // White surface + 16px radius + inset hairline, no drop shadow. JobBlock
      // rows inside use their own hairline top-dividers (topDivider prop) so
      // adjacent jobs still read as separate rows.
      <div style={{ background: '#ffffff', border: 0, borderRadius: 16, boxShadow: 'inset 0 0 0 1px rgba(27,43,75,0.085)', overflow: 'hidden' }}>
        {sched.map((e, i) => <JobBlock key={e.id} ev={e} topDivider={i > 0} />)}
        {done.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 6px', fontFamily: CAL_MONO, fontSize: 11, letterSpacing: '0.06em', color: '#9ca3af', borderTop: sched.length ? '1px solid rgba(27,43,75,0.085)' : 'none', background: 'transparent' }}>
            <span>DONE</span><span style={{ flex: 1, height: 1, background: 'rgba(27,43,75,0.085)' }} />
          </div>
        )}
        {done.map((e, i) => <JobBlock key={e.id} ev={e} topDivider={false} />)}
      </div>
    );
  };

  // Week-mark separator (reuses the SMS-thread mono-between-hairlines look).
  const dayLabel = dk => dk === TODAY ? `Today, ${formatDate(dk, { month: 'short', day: 'numeric' })}`
    : dk === addDays(TODAY, 1) ? `Tomorrow, ${formatDate(dk, { month: 'short', day: 'numeric' })}`
    : formatDate(dk, { weekday: 'long', month: 'short', day: 'numeric' });

  const goPrev = () => {
    if (mode === 'week') { setWeekAnchor(addDays(weekAnchor, -7)); }
    else { const d = addDays(selectedDay, -1); setSelectedDay(d); if (d < weekAnchor) setWeekAnchor(mondayOf(d)); }
  };
  const goNext = () => {
    if (mode === 'week') { setWeekAnchor(addDays(weekAnchor, 7)); }
    else { const d = addDays(selectedDay, 1); setSelectedDay(d); if (d > weekDays[6]) setWeekAnchor(mondayOf(d)); }
  };
  const headerLabel = mode === 'day'
    ? formatDate(selectedDay, { weekday: 'short', month: 'short', day: 'numeric' })
    : `Week of ${formatDate(weekAnchor, { month: 'short', day: 'numeric' })}`;

  const sheetEv = sheetId ? events.find(e => e.id === sheetId) : null;
  // close the sheet automatically if its event leaves the scheduled state
  React.useEffect(() => { if (sheetEv && sheetEv.status !== 'scheduled') setSheetId(null); }, [sheetEv && sheetEv.status]);

  const navBtnStyle = { width: 44, height: 44, borderRadius: 12, border: '1px solid #e5e5e5', background: 'white', color: NAVY, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

  // Flat event-search results across ALL dates when the dock is open.
  const eventMatches = React.useMemo(() => {
    const q = calSearch.trim();
    if (!q) return [];
    return events
      .filter(e => e.status !== 'cancelled')
      .map(e => ({ e, c: getContact(e.contact_id) }))
      .filter(({ e, c }) => {
        const hay = [contactName(c), e.title, (KIND_COLORS[e.kind] || {}).label, c && c.address].filter(Boolean).join('  ');
        return window.smartMatch ? window.smartMatch(q, hay) : hay.toLowerCase().includes(q.toLowerCase());
      })
      .sort((a, b) => (b.e.start_at || '').localeCompare(a.e.start_at || ''));
  }, [events, contacts, calSearch]);

  return (
    // iOS Phase 1 Pass 4 (Key 2026-07-09): container background matches the
    // shell's near-white (#f4f5f8) so the day nav / week strip / agenda flow
    // as one calm surface instead of stacked cards. Shell paints the single
    // "Calendar" title above; the day nav row below is the DYNAMIC day
    // label (e.g. "Today, Wed Sep 15"), a functional strip not a duplicate
    // heading.
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#f4f5f8' }}>
      {/* Search mode (Key 2026-07-10): the day/week calendar gives way to a flat
          list of matching events across every date; the dock docks at the bottom. */}
      {searchOpen && (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 12px calc(20px + env(safe-area-inset-bottom))',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 calc(env(safe-area-inset-top, 0px) + 18px))',
          maskImage: 'linear-gradient(to bottom, transparent 0, #000 calc(env(safe-area-inset-top, 0px) + 18px))' }}>
          {!calSearch.trim() && (
            <div style={{ padding: '26px 20px', textAlign: 'center', color: MUTED, fontSize: 13 }}>Search jobs by name, title, or address , across every date.</div>
          )}
          {calSearch.trim() && eventMatches.length === 0 && (
            <EmptyState icon="calendar" text="No events match your search" actionLabel="Clear search" onAction={() => setCalSearch('')} />
          )}
          {eventMatches.map(({ e, c }) => (
            <button key={e.id} onClick={() => { if (e.contact_id) onOpen(e.contact_id, 'calendar'); else setSheetId(e.id); closeSearch(); }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 6px', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(27,43,75,0.07)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <span style={{ flex: '0 0 52px', textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: dayKey(e.start_at) === TODAY ? '#8a5a00' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{formatDate(e.start_at, { month: 'short' })}</span>
                <span style={{ display: 'block', fontSize: 18, fontWeight: 800, color: NAVY, fontFamily: CAL_MONO, lineHeight: 1 }}>{dateNum(dayKey(e.start_at))}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contactName(c) || e.title || (KIND_COLORS[e.kind] || {}).label || 'Event'}</span>
                <span style={{ display: 'block', fontSize: 12, color: MUTED, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[(KIND_COLORS[e.kind] || {}).label, e.title, formatTimeShort(e.start_at)].filter(Boolean).join(' · ')}</span>
              </span>
              {e.status === 'completed' && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#16a34a' }}>Done</span>}
            </button>
          ))}
        </div>
      )}
      {!searchOpen && (
        <React.Fragment>
      {/* Day nav + the one gold creator (the "+" add-job button). Kept the
          shape; softened the surrounding to sit calmly under the shell
          title. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px 10px', flexShrink: 0 }}>
        <button onClick={goPrev} aria-label="Previous" style={navBtnStyle}>
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5" /></svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{headerLabel}</div>
          {selectedDay !== TODAY && mode === 'day' && (
            <button onClick={() => { setSelectedDay(TODAY); setWeekAnchor(mondayOf(TODAY)); }} style={{ marginTop: 1, padding: 0, border: 'none', background: 'transparent', fontSize: 11, fontWeight: 700, color: '#8a5a00', cursor: 'pointer', fontFamily: 'inherit' }}>Back to today</button>
          )}
        </div>
        <button onClick={goNext} aria-label="Next" style={navBtnStyle}>
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>
        <button onClick={() => setAddOpen(true)} aria-label="New job" title="New job" style={{ width: 44, height: 44, borderRadius: 12, border: 'none', background: GOLD, color: NAVY, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 8px rgba(255,186,0,0.35)' }}>
          <svg viewBox="0 0 14 14" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1.5v11M1.5 7h11" /></svg>
        </button>
      </div>
      {addOpen && window.NewEventModal && (
        <window.NewEventModal contacts={contacts} defaultDate={selectedDay} onClose={() => setAddOpen(false)} />
      )}
      {/* Week strip: glance the week's load. Date in the circle (the universal
          week-strip affordance); a gold dot carries the job count so a busy day
          reads at a glance. Selected day = filled navy circle. */}
      <div style={{ display: 'flex', gap: 4, padding: '0 8px 8px', flexShrink: 0 }}>
        {weekDays.map((dk, i) => {
          const sel = dk === selectedDay && mode === 'day';
          const n = countOn(dk);
          const isToday = dk === TODAY;
          return (
            <button key={dk} onClick={() => { setSelectedDay(dk); setMode('day'); }} aria-pressed={sel} style={{
              flex: 1, minWidth: 0, padding: '6px 0 5px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: sel ? 'rgba(27,43,75,0.06)' : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.03em', color: isToday ? '#8a5a00' : '#9ca3af' }}>{WEEKDAY[i]}</span>
              <span style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, fontFamily: CAL_MONO,
                background: sel ? NAVY : 'transparent', color: sel ? 'white' : (isToday ? NAVY : '#4B5563'),
                border: isToday && !sel ? `1.5px solid ${GOLD}` : '1.5px solid transparent' }}>{dateNum(dk)}</span>
              <span style={{ height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {/* Audit 2026-06-19: was an 8px count (below the 11px type floor).
                    One job = a 6px gold dot; multiple = an 11px count pill. */}
                {n > 1
                  ? <span style={{ minWidth: 16, height: 16, borderRadius: 8, padding: '0 4px', background: GOLD, fontSize: 11, fontWeight: 800, color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontFamily: CAL_MONO }}>{n}</span>
                  : (n === 1 ? <span style={{ width: 6, height: 6, borderRadius: 3, background: GOLD, display: 'block' }} /> : null)}
              </span>
            </button>
          );
        })}
      </div>
      {/* Day | Week toggle + Plan route (selected day). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 10px', flexShrink: 0 }}>
        <div role="group" aria-label="View" style={{ display: 'flex', background: '#eef1f6', borderRadius: 12, padding: 3, gap: 3 }}>
          {[['day', 'Day'], ['week', 'Week']].map(([v, label]) => {
            const active = mode === v;
            return (
              <button key={v} onClick={() => setMode(v)} aria-pressed={active} style={{
                minHeight: 44, padding: '0 18px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: active ? 700 : 600, color: active ? NAVY : MUTED,
                background: active ? 'white' : 'transparent',
                boxShadow: active ? '0 2px 8px rgba(27,43,75,0.07)' : 'none',
              }}>{label}</button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        {mode === 'day' && dayList.length > 0 && (planRouteUrl ? (
          <a href={planRouteUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 44, padding: '0 16px', borderRadius: 100, background: 'white', border: '1px solid #e5e5e5', fontSize: 12, fontWeight: 700, color: NAVY, textDecoration: 'none', flexShrink: 0 }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M8 14.5s4.5-4.4 4.5-7.8a4.5 4.5 0 0 0-9 0c0 3.4 4.5 7.8 4.5 7.8z" /><circle cx="8" cy="6.5" r="1.8" /></svg>
            Route <span style={{ fontFamily: CAL_MONO, fontSize: 11, color: '#5b6576' }}>{dayWithAddr.length}</span>
          </a>
        ) : (
          // Jobs today but none have a mappable address: a non-tappable hint in
          // the Route slot (a Route-shaped button that opened a contact would be
          // a Norman door). Names the fix instead of silently vanishing.
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 44, padding: '0 16px', fontSize: 12, fontWeight: 600, color: '#5b6576', flexShrink: 0 }}>Add addresses to map a route</span>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 12px calc(20px + env(safe-area-inset-bottom))' }}>
        {mode === 'day' ? (
          <DayAgenda dk={selectedDay} />
        ) : (
          weekDays.filter(dk => countOn(dk) > 0 || doneOn(dk).length > 0).length === 0 ? (
            <div style={{ background: '#ffffff', border: 0, borderRadius: 16, boxShadow: 'inset 0 0 0 1px rgba(27,43,75,0.085)', padding: '28px 20px', textAlign: 'center', marginTop: 2 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 3 }}>Nothing this week</div>
              {/* Key found live 2026-07-02: this card said "tap › to find them" but
                  carried no onClick of its own, the real tap target is the dashed
                  button below (aheadCount > 0). A hint describing a DIFFERENT
                  element's action is a Norman door; state the fact here, let the
                  real button own the only "tap ›" language. */}
              <div style={{ fontSize: 13, color: MUTED }}>{aheadCount > 0 ? `${aheadCount} job${aheadCount === 1 ? '' : 's'} booked further out.` : 'Booked jobs land here.'}</div>
            </div>
          ) : (
            weekDays.filter(dk => countOn(dk) > 0 || doneOn(dk).length > 0).map(dk => (
              <div key={dk}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 8px', fontFamily: CAL_MONO, fontSize: 11, color: '#9ca3af' }}>
                  <span style={{ flex: 1, height: 1, background: '#eceae6' }} />
                  <button onClick={() => { setSelectedDay(dk); setMode('day'); }} style={{ border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 11, color: '#9ca3af', cursor: 'pointer', whiteSpace: 'nowrap' }}>{dayLabel(dk)}</button>
                  <span style={{ flex: 1, height: 1, background: '#eceae6' }} />
                </div>
                <DayAgenda dk={dk} />
              </div>
            ))
          )
        )}
        {aheadCount > 0 && (
          <button onClick={goNext} style={{ display: 'block', width: '100%', marginTop: 14, padding: '12px', borderRadius: 12, border: '1.5px dashed rgba(27,43,75,0.12)', background: 'transparent', fontSize: 12, fontWeight: 700, color: MUTED, cursor: 'pointer', fontFamily: 'inherit' }}>
            {aheadCount} job{aheadCount === 1 ? '' : 's'} booked after this week ›
          </button>
        )}
      </div>
        </React.Fragment>
      )}
      {sheetEv && (
        <JobSheet
          /* Remount when any edited field changes so the inline editors
             re-seed from the live event. JobSheet seeds timeVal/nameVal/
             instVal via useState (mount-only); without this, reopening an
             editor after a save shows the stale pre-edit value. */
          key={`${sheetEv.id}|${sheetEv.start_at}|${sheetEv.end_at || ''}|${sheetEv.title || ''}|${sheetEv.assigned_installer || ''}`}
          ev={sheetEv}
          contact={getContact(sheetEv.contact_id)}
          durMin={durMin}
          onClose={() => setSheetId(null)}
          onReschedule={reschedule}
          onSetInstaller={setInstaller}
          onSetDuration={setDuration}
          onSetTitle={setTitle}
          onMarkDone={async (ev) => { await completeEvent(ev); setSheetId(null); }}
          onCancel={async (ev) => { await cancelEvent(ev); }}
          onOpen={onOpen}
        />
      )}
      {dockVisible && (
        <SearchDock
          exiting={!searchOpen}
          inputId="bpp-cal-search"
          value={calSearch}
          placeholder="Search jobs by name, title, address"
          onChange={v => setCalSearch(v)}
          onClear={() => setCalSearch('')}
          onClose={closeSearch}
          onEnter={() => { const first = eventMatches[0]; if (calSearch.trim() && first) { if (first.e.contact_id) onOpen(first.e.contact_id, 'calendar'); else setSheetId(first.e.id); closeSearch(); } }}
        />
      )}
    </div>
  );
}

// ── Job Sheet ─────────────────────────────────────────────────────
// The single surface that holds every per-job action (Key directive
// 2026-06-15: rows lose their buttons, one sheet does it all). Bottom sheet,
// thumb-reachable. ONE gold primary (Mark done). Reschedule / set installer /
// set duration / name expand inline editors. Message routes to the thread (NO
// auto-send, the standing manual-send rule); Directions opens Maps; Cancel is a
// quiet destructive row. Every action behaves how it appears (no Norman door).
function JobSheet({ ev, contact, durMin, onClose, onReschedule, onSetInstaller, onSetDuration, onSetTitle, onMarkDone, onCancel, onOpen }) {
  const [open, setOpen] = React.useState(null); // 'time' | 'installer' | 'duration' | 'name'
  const pad = n => String(n).padStart(2, '0');
  const toLocalInput = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const [timeVal, setTimeVal] = React.useState(toLocalInput(ev.start_at));
  const [nameVal, setNameVal] = React.useState(ev.title || '');
  const [instVal, setInstVal] = React.useState(ev.assigned_installer && ev.assigned_installer !== 'Key' ? ev.assigned_installer : '');
  const kindLabel = (KIND_COLORS[ev.kind] || KIND_COLORS.meeting).label;
  const addr = (contact?.address || '').trim();
  const first = (contactName(contact) || '').split(' ')[0] || 'them';
  const curInstaller = ev.assigned_installer || (ev.kind === 'install' ? contact?.assigned_installer : null) || 'You';
  const mins = durMin(ev);
  const DURS = [['30m', 30], ['1h', 60], ['1.5h', 90], ['2h', 120], ['3h', 180], ['4h', 240]];
  const sub = `${ev.title ? ev.title + ' · ' : ''}${kindLabel} · ${formatDate(ev.start_at, { weekday: 'short', month: 'short', day: 'numeric' })} ${formatTimeShort(ev.start_at)} · ${calDurLabel(mins)}`;

  const rowStyle = { width: '100%', display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, padding: '0 14px', background: 'white', border: 'none', borderTop: '1px solid #f1f1ef', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' };
  const Row = ({ id, icon, label, value }) => (
    <button onClick={() => setOpen(open === id ? null : id)} style={rowStyle} aria-expanded={open === id}>
      <span style={{ flexShrink: 0, color: '#6b7280', display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: NAVY }}>{label}</span>
      {value ? <span style={{ fontSize: 13, color: MUTED, fontFamily: CAL_MONO, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span> : null}
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="#c2c8d2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: open === id ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}><path d="M6 3l5 5-5 5" /></svg>
    </button>
  );
  const editorWrap = { background: '#f8f9fb', borderTop: '1px solid #f1f1ef', padding: '12px 14px' };
  const inputStyle = { width: '100%', minHeight: 44, padding: '0 12px', fontSize: 16, fontFamily: 'inherit', color: NAVY, border: '1px solid #d8dce3', borderRadius: 10, background: 'white', boxSizing: 'border-box' };
  const saveBtn = { minHeight: 44, padding: '0 18px', borderRadius: 10, border: 'none', background: NAVY, color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
  const chipBtn = (active) => ({ minHeight: 44, padding: '0 16px', borderRadius: 100, border: active ? `1.5px solid ${NAVY}` : '1.5px solid #d8dce3', background: active ? 'rgba(27,43,75,0.06)' : 'white', color: NAVY, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' });

  // Portal to document.body: the mobile shell wraps both panels in a
  // 200%-wide container with a CSS transform (the slide animation), and a
  // transformed ancestor becomes the containing block for position:fixed.
  // Rendered inline, this sheet's inset:0 covered the DOUBLE-width container
  // and justify-center pushed it to the seam (shoved right + clipped off the
  // edge, the 2026-06-15 live glitch Key hit). Portaling to body escapes the
  // transform so position:fixed is viewport-relative again. Matches how
  // ToastHost/ConfirmHost mount.
  return ReactDOM.createPortal((
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1400, background: 'rgba(11,31,59,0.34)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'white', borderRadius: '20px 20px 0 0', boxShadow: '0 -8px 40px rgba(11,31,59,0.28)', maxHeight: '88vh', overflowY: 'auto', paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
          <span style={{ width: 36, height: 4, borderRadius: 100, background: '#dfe3ea' }} />
        </div>
        <div style={{ padding: '10px 16px 14px' }}>
          <div style={{ fontSize: 19, fontWeight: 700, color: NAVY }}>{contactName(contact) || 'Job'}</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3, lineHeight: 1.4 }}>{sub}</div>
          {addr ? <div style={{ fontSize: 12.5, color: '#5b6576', marginTop: 2 }}>{addr}</div> : <div style={{ fontSize: 12.5, color: '#b4451f', fontStyle: 'italic', marginTop: 2 }}>Address needed</div>}
        </div>

        {/* Reschedule */}
        <Row id="time" label="Reschedule" value={null} icon={<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3.5" width="13" height="12" rx="2" /><path d="M2.5 7h13M6 1.8v3M12 1.8v3" /></svg>} />
        {open === 'time' && (
          <div style={editorWrap}>
            <input type="datetime-local" value={timeVal} onChange={e => setTimeVal(e.target.value)} style={inputStyle} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button style={saveBtn} onClick={async () => { await onReschedule(ev, timeVal); setOpen(null); }}>Save time</button>
            </div>
          </div>
        )}

        {/* Set installer */}
        <Row id="installer" label="Installer" value={curInstaller} icon={<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="6" r="3" /><path d="M3 15.5c.9-3 3.3-4.5 6-4.5s5.1 1.5 6 4.5" /></svg>} />
        {open === 'installer' && (
          <div style={editorWrap}>
            {/* One-tap chips for the known sub roster (tap-audit #5), so assigning
                an installer is a single tap instead of typing the name. Active
                state reads curInstaller (the row's own source of truth) so the
                highlight always matches the row. The free-text input below stays
                the fallback for a brand-new sub. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <button style={chipBtn(curInstaller === 'You')} onClick={async () => { setInstVal(''); await onSetInstaller(ev, ''); setOpen(null); }}>You</button>
              {((window.CRM && window.CRM.installers) || []).map(name => (
                <button key={name} style={chipBtn(curInstaller === name)} onClick={async () => { setInstVal(name); await onSetInstaller(ev, name); setOpen(null); }}>{name}</button>
              ))}
            </div>
            <input value={instVal} onChange={e => setInstVal(e.target.value)} placeholder="Or type a new sub's name" style={inputStyle} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button style={saveBtn} onClick={async () => { await onSetInstaller(ev, instVal); setOpen(null); }}>Save installer</button>
            </div>
          </div>
        )}

        {/* Set duration */}
        <Row id="duration" label="Duration" value={calDurLabel(mins)} icon={<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="7" /><path d="M9 5v4l2.5 1.5" /></svg>} />
        {open === 'duration' && (
          <div style={editorWrap}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {DURS.map(([lbl, m]) => (
                <button key={m} style={chipBtn(m === mins)} onClick={async () => { await onSetDuration(ev, m); setOpen(null); }}>{lbl}</button>
              ))}
            </div>
          </div>
        )}

        {/* Name this job */}
        <Row id="name" label="Name this job" value={ev.title || null} icon={<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11.5 2.5l4 4-9 9-4 1 1-4z" /></svg>} />
        {open === 'name' && (
          <div style={editorWrap}>
            <input value={nameVal} onChange={e => setNameVal(e.target.value)} placeholder="e.g. Panel swap + inlet" style={inputStyle} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button style={saveBtn} onClick={async () => { await onSetTitle(ev, nameVal); setOpen(null); }}>Save name</button>
            </div>
          </div>
        )}

        {/* Mark done = the one gold primary */}
        <div style={{ padding: '14px 16px 6px' }}>
          <button onClick={() => onMarkDone(ev)} style={{ width: '100%', minHeight: 52, borderRadius: 16, border: 'none', background: GOLD, color: NAVY, fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 4px 14px rgba(255,186,0,0.35)' }}>
            <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5l4 4 8-9" /></svg>
            Mark done
          </button>
        </div>

        {/* secondary actions */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 16px 4px' }}>
          <button onClick={() => { onOpen(contact?.id, 'messages'); onClose(); }} disabled={!contact} style={{ flex: 1, minHeight: 46, borderRadius: 12, border: '1px solid #e5e5e5', background: 'white', color: contact ? NAVY : '#b4b9c2', fontSize: 13.5, fontWeight: 700, cursor: contact ? 'pointer' : 'default', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4.5h13v8h-7l-3.5 2.5v-2.5h-2.5z" /></svg>
            Message {first}
          </button>
          {addr ? (
            <a href={`https://maps.apple.com/?daddr=${encodeURIComponent(addr)}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minHeight: 46, borderRadius: 12, border: '1px solid #e5e5e5', background: 'white', color: NAVY, fontSize: 13.5, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 16s5-4.9 5-8.7A5 5 0 0 0 4 7.3C4 11.1 9 16 9 16z" /><circle cx="9" cy="7" r="2" /></svg>
              Directions
            </a>
          ) : (
            <span style={{ flex: 1, minHeight: 46, borderRadius: 12, border: '1px solid #eee', background: '#fafafa', color: '#b4b9c2', fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>Directions</span>
          )}
        </div>

        {/* open full contact + quiet cancel */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px 4px' }}>
          <button onClick={() => { onOpen(ev.contact_id, 'calendar', ev.id); onClose(); }} style={{ border: 'none', background: 'transparent', color: '#6b7280', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Open contact</button>
          <button onClick={async () => { await onCancel(ev); onClose(); }} style={{ border: 'none', background: 'transparent', color: '#dc2626', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel job</button>
        </div>
      </div>
    </div>
  ), document.body);
}

// ── Finance List ──────────────────────────────────────────────────
// Mixed list of proposals + invoices, sorted by sent_at desc.
function FinanceList({ proposals, invoices, contacts, events = [], onOpen, activeContactId }) {
  const [view, setView] = React.useState('all'); // 'all' | 'invoices' | 'proposals'
  const [reconBusy, setReconBusy] = React.useState(false);
  const getContact = id => contacts.find(c=>c.id===id);
  const pinned = window.usePinned ? window.usePinned() : new Set();

  // Per Key's billing rule: don't count an invoice as Outstanding/Overdue
  // until the contact has actually had their install. Pre-install sent
  // invoices are "Pending install" and shown separately.
  // Use the shared inference so this lens matches the Today panel +
  // moneyStatus pill (signed proposal + invoice >= 7d also = installed).
  const installedSet = buildInstalledSet(contacts, events, proposals, invoices);

  // KPI cards, split by post-install status.
  const sumByStatus = (arr, statuses, filter = () => true) => arr
    .filter(i => statuses.includes(i.status) && filter(i))
    .reduce((s,i) => s + i.amount_cents, 0);

  // Overdue is derived: a sent/viewed invoice with installed=true and
  // age >14 days. The DB never flips invoice.status to 'overdue' on
  // its own, so the prior sumByStatus(['overdue']) was always $0.
  // Now use the shared isInvoiceOverdue helper for consistency with the
  // Today panel + contact moneyStatus pill.
  const isOverdue = inv => isInvoiceOverdue(inv);
  // 2026-05-28: AR is install-independent (see isInvoiceOverdue). Outstanding
  // = any unpaid sent/viewed invoice not yet overdue; Overdue = unpaid >14d.
  // The old install-gate hid real receivables because installs live in Key's
  // head, not the calendar.
  const isUnpaid = i => !i.paid_at && (i.status === 'sent' || i.status === 'viewed' || i.status === 'overdue');
  // 2026-07-04 audit: net partial payments (invoiceOwedCents) so the dashboard
  // tiles match the per-contact OWED pill + MoneyCard. Raw amount_cents overstated
  // AR whenever a customer paid part in cash and the invoice stayed 'sent'.
  const outstanding   = invoices.filter(i => isUnpaid(i) && !isOverdue(i)).reduce((s,i)=>s+invoiceOwedCents(i),0);
  const overdue       = invoices.filter(isOverdue).reduce((s,i)=>s+invoiceOwedCents(i),0);
  const paidWeek      = sumByStatus(invoices, ['paid']);
  // Unbilled = signed proposals with no covering invoice (money won but not
  // yet billed). Replaces the old "Pending / pre-install" tile, which is
  // meaningless now that AR no longer depends on install tracking.
  const __billedContactIds = new Set(
    invoices.filter(i => i.status !== 'voided' && i.status !== 'refunded').map(i => i.contact_id)
  );
  const unbilled = proposals
    .filter(p => p.approved_at && !p.superseded_at && p.status !== 'declined' && p.status !== 'cancelled' && !__billedContactIds.has(p.contact_id))
    .reduce((s,p)=>s+(p.amount_cents||0),0);

  // Top owed, only contacts past install. Pre-install contacts go in
  // the "Pending install" pile, not Top Owed.
  const owedByContact = invoices
    .filter(i => isUnpaid(i))
    .reduce((m, i) => {
      m.set(i.contact_id, (m.get(i.contact_id) || 0) + invoiceOwedCents(i));  // 2026-07-04 audit: net partials for Top-owed
      return m;
    }, new Map());
  // Top-owed contacts. When an aged bucket is selected (clickable buckets
  // below), filter to only contacts whose oldest overdue invoice falls in
  // that bucket, turns the dashboard into a one-click triage list.
  const topOwedAll = [...owedByContact.entries()].sort((a, b) => b[1] - a[1]);

  // Aged receivables, bucket outstanding (post-install) invoices by
  // age in days. 90+ day items signal write-off risk. Also build a
  // contact→bucket map (uses the OLDEST outstanding invoice per contact)
  // so clicking a bucket can drill the Top-owed list.
  const [agedFilter, setAgedFilter] = React.useState(null);
  const aged = {};
  const contactBucket = new Map(); // contact_id → bucket of oldest overdue invoice
  for (const i of invoices) {
    if (!isUnpaid(i)) continue;
    const t = i.sent_at || i.created_at;
    if (!t) continue;
    const days = Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86400000));
    const bucket = days <= 30 ? '0_30' : days <= 60 ? '31_60' : days <= 90 ? '61_90' : '90p';
    aged[bucket] = (aged[bucket] || 0) + invoiceOwedCents(i);  // 2026-07-04 audit: net partials in aged buckets
    // Track oldest bucket per contact (90p > 61_90 > 31_60 > 0_30)
    const rank = { '0_30':0, '31_60':1, '61_90':2, '90p':3 };
    const prev = contactBucket.get(i.contact_id);
    if (prev == null || rank[bucket] > rank[prev]) contactBucket.set(i.contact_id, bucket);
  }

  // Counts for sub-tab pills
  const invCounts = invoices.reduce((acc,i)=>({...acc,[i.status]:(acc[i.status]||0)+1}),{});
  const proCounts = proposals.reduce((acc,p)=>({...acc,[p.status]:(acc[p.status]||0)+1}),{});

  // This-month revenue pulse, total of paid invoices this calendar
  // month vs the prior month. Single number; the trend arrow is the
  // signal Key is looking for ("am I trending up?").
  const monthRevenue = React.useMemo(() => {
    const now = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthKey = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`;
    let curr = 0, last = 0;
    for (const inv of invoices) {
      if (inv.status !== 'paid') continue;
      const t = inv.paid_at || inv.sent_at || inv.created_at;
      if (!t) continue;
      const k = t.slice(0, 7);
      if (k === thisMonthKey) curr += inv.amount_cents || 0;
      else if (k === prevMonthKey) last += inv.amount_cents || 0;
    }
    const pct = last > 0 ? Math.round(((curr - last) / last) * 100) : (curr > 0 ? null : 0);
    const monthLabel = now.toLocaleDateString('en-US', { month:'long' });
    const prevLabel = prev.toLocaleDateString('en-US', { month:'short' });
    return { curr, last, pct, monthLabel, prevLabel };
  }, [invoices]);

  // Build mixed display list. Pinned-first: any proposal/invoice belonging
  // to a starred contact rises to the top of every view. Within each pin
  // bucket the existing sent_at-desc order is preserved.
  const tagged = [
    ...proposals.map(p => ({ ...p, _kind:'proposal' })),
    ...invoices.map(i => ({ ...i, _kind:'invoice' })),
  ].sort((a, b) => {
    const ap = pinned.has(a.contact_id) ? 1 : 0;
    const bp = pinned.has(b.contact_id) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.sent_at || '').localeCompare(a.sent_at || '');
  });

  const visible = view === 'all' ? tagged
                : view === 'invoices' ? tagged.filter(x => x._kind === 'invoice')
                : tagged.filter(x => x._kind === 'proposal');

  const exportCSV = () => {
    const rows = [
      ['Type','Contact','Label','Amount','Status','Sent'],
      ...invoices.map(i => { const c = getContact(i.contact_id); return ['Invoice',contactName(c),capitalize(i.kind)+' invoice',(i.amount_cents/100).toFixed(2),i.status,dayKey(i.sent_at||'')]; }),
      ...proposals.map(p => { const c = getContact(p.contact_id); return ['Proposal',contactName(c),p.label,(p.amount_cents/100).toFixed(2),p.status,dayKey(p.sent_at||'')]; }),
    ];
    // CSV cell escaping: every cell quoted, embedded quotes doubled, and
    // formula-prefix chars (=,+,-,@,tab,CR) get a leading single-quote so
    // Excel/Sheets don't auto-execute "=cmd|/c calc" or split a "Smith,
    // Bob" into two columns.
    const escapeCell = (val) => {
      let s = (val == null ? '' : String(val));
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    // UTF-8 BOM (﻿) so Excel + Numbers don't render accented
    // characters as garbage. Decoders auto-detect from the BOM.
    const csv = '﻿' + rows.map(r => r.map(escapeCell).join(',')).join('\n');
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download = 'key-finance.csv'; a.click();
  };

  const exportReconciliation = async () => {
    if (reconBusy || !window.CRM?.__invokeFn) return;
    setReconBusy(true);
    try {
      const { data, error } = await window.CRM.__invokeFn('record-payment', { body: { action:'reconciliation_report' } });
      if (error || !data?.ok) {
        window.showToast?.('Money audit failed: ' + (error?.message || data?.error || 'unknown'));
        return;
      }
      if (!data.issue_count) {
        window.showToast?.('Money audit passed. No ledger mismatches found.');
        return;
      }
      const rows = [
        ['Invoice','Contact','Invoice status','Invoice total','Net paid','Raw remaining','Issue'],
        ...data.issues.map(i => [i.invoice_document_number || i.invoice_id, i.contact_name || '', i.invoice_status,
          i.invoice_total, i.net_paid, i.raw_remaining, i.reconciliation_state]),
      ];
      const escapeCell = (val) => {
        let s = val == null ? '' : String(val);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
      };
      const csv = '\ufeff' + rows.map(row => row.map(escapeCell).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'bpp-money-reconciliation.csv';
      a.click();
      window.showToast?.(`${data.issue_count} money audit issue${data.issue_count === 1 ? '' : 's'} exported.`);
    } finally {
      setReconBusy(false);
    }
  };

  const [quickQuoteOpen, setQuickQuoteOpen] = React.useState(false);

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0, background:'#f4f5f8' }}>
      {/* iOS Phase 1 Pass 3 (Key 2026-07-09): the internal "Money" title
          strip is gone; the shell LargeTitleHeader now paints the single
          "Finance" title on this tab. Compact meta+actions row sits below,
          same shape as the Subs tab's "Roster + New sub" strip. Export CSV
          stays a light ghost; "Quick quote" keeps its gold primary (one
          money-move per screen). */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        gap:10, padding:'4px 22px 12px', flexShrink:0,
      }}>
        <span style={{ fontSize:12, fontWeight:700, color:'#8a93a6', letterSpacing:'0.06em', textTransform:'uppercase' }}>Money</span>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={exportReconciliation} disabled={reconBusy} style={{
            minHeight:36, padding:'0 12px', border:'1px solid rgba(27,43,75,0.15)',
            background:'transparent', color:NAVY, borderRadius:100,
            fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:reconBusy?'wait':'pointer',
            opacity:reconBusy?0.6:1,
          }}>{reconBusy ? 'Auditing...' : 'Audit money'}</button>
          <button onClick={exportCSV} style={{
            minHeight:36, padding:'0 12px', border:'1px solid rgba(27,43,75,0.15)',
            background:'transparent', color:NAVY, borderRadius:100,
            fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer',
          }}>Export CSV</button>
          <button onClick={()=>setQuickQuoteOpen(true)} style={{
            minHeight:36, padding:'0 14px', background:'#ffba00', color:NAVY,
            border:'none', borderRadius:100, fontFamily:'inherit', fontSize:13,
            fontWeight:700, cursor:'pointer',
          }}>Quick quote</button>
        </div>
      </div>
      {/* This-month revenue pulse, single number with trend arrow vs
          last month. Hidden when both months are $0 (fresh account). */}
      {(monthRevenue.curr > 0 || monthRevenue.last > 0) && (
        <div style={{ background:'#F0FDF4', borderBottom:'1px solid #BBF7D0', padding:'10px 18px', flexShrink:0, display:'flex', alignItems:'baseline', gap:8 }}>
          <span style={{ fontSize:11, fontWeight:700, color:'#065F46', letterSpacing:'0.05em', textTransform:'uppercase' }}>{monthRevenue.monthLabel}</span>
          <span style={{ fontSize:18, fontWeight:700, color:NAVY, letterSpacing:'-0.5px' }}>{formatMoneyCents(monthRevenue.curr)}</span>
          {monthRevenue.pct != null && monthRevenue.last > 0 && (
            <span style={{ fontSize:11, fontWeight:600, color: monthRevenue.pct >= 0 ? '#15803D' : '#991B1B' }}>
              {monthRevenue.pct >= 0 ? '↑' : '↓'} {Math.abs(monthRevenue.pct)}% vs {monthRevenue.prevLabel}
            </span>
          )}
          {monthRevenue.pct == null && monthRevenue.last === 0 && (
            <span style={{ fontSize:11, color:MUTED }}>· first month with sales</span>
          )}
        </div>
      )}
      {/* iOS Phase 1 Pass 3: KPI tiles adopt the light/flat language,
          hairline dividers between tiles instead of borders; container
          bottom becomes the same hairline token so the row nests calmly
          into the tab body. Every number, color coding, and secondary
          label preserved. */}
      <div style={{ display:'flex', background:'transparent', borderBottom:'1px solid rgba(27,43,75,0.085)', flexShrink:0 }}>
        {[
          { label:'Outstanding', val:outstanding,    color:'#1E40AF', sub:'unpaid' },
          { label:'Overdue',     val:overdue,        color:'#991B1B', sub:'14d+' },
          { label:'Unbilled',    val:unbilled,       color:'#0F766E', sub:'signed, no invoice' },
          { label:'Paid',        val:paidWeek,       color:'#065F46' },
        ].map((k,i)=>(
          <div key={k.label} style={{ flex:1, padding:'12px 14px', borderRight:i<3?'1px solid rgba(27,43,75,0.085)':'none' }}>
            <div style={{ fontSize:11, color:'#8a93a6', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:3 }}>{k.label}</div>
            <div style={{ fontSize:16, fontWeight:700, color:k.color, letterSpacing:'-0.5px' }}>{formatMoneyCents(k.val)}</div>
            {k.sub && <div style={{ fontSize:12, color:MUTED, marginTop:1, fontWeight:500 }}>{k.sub}</div>}
          </div>
        ))}
      </div>
      {/* Aged receivables, only renders when there's any outstanding
          (post-install) balance. Helps Key prioritize: 90+ days = call
          today, 60-90 = remind, 30-60 = monitor. */}
      {(aged['0_30'] || aged['31_60'] || aged['61_90'] || aged['90p']) && (
        <div style={{ background:'white', borderBottom:'1px solid #EBEBEA', flexShrink:0, padding:'10px 18px' }}>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:8 }}>
            <div style={{ fontSize:12, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.08em' }}>Aged receivables</div>
            {agedFilter && (
              <button onClick={() => setAgedFilter(null)} style={{
                background:'transparent', border:'none', color:NAVY, fontSize:11, fontWeight:600,
                cursor:'pointer', padding:0, fontFamily:'inherit', textDecoration:'underline',
              }}>Show all</button>
            )}
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {[
              { key:'0_30',  label:'0-30',  val: aged['0_30']  || 0, color:'#0F766E' },
              { key:'31_60', label:'31-60', val: aged['31_60'] || 0, color:'#92400E' },
              { key:'61_90', label:'61-90', val: aged['61_90'] || 0, color:'#B45309' },
              { key:'90p',   label:'90+',   val: aged['90p']   || 0, color:'#991B1B' },
            ].map(b => {
              const active = agedFilter === b.key;
              const clickable = b.val > 0;
              return (
                <button
                  key={b.key}
                  onClick={() => clickable && setAgedFilter(active ? null : b.key)}
                  disabled={!clickable}
                  style={{
                    flex:1, padding:'6px 8px',
                    background: active ? b.color : (clickable ? `${b.color}10` : '#F5F5F3'),
                    color: active ? 'white' : (clickable ? b.color : MUTED),
                    border: 'none', borderRadius:6, textAlign:'center', fontFamily:'inherit',
                    cursor: clickable ? 'pointer' : 'default',
                    transition:'background 120ms, color 120ms',
                  }}
                >
                  <div style={{ fontSize:12, fontWeight:700, letterSpacing:'0.05em', color:'inherit' }}>{b.label}d</div>
                  <div style={{ fontSize:13, fontWeight:700, fontFamily:"'DM Mono', monospace", marginTop:2, color:'inherit' }}>{formatMoneyCents(b.val)}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* Top owed, only renders when ≥1 contact has unpaid balance.
          Tap a row to jump to that contact's Finance tab to chase.
          When an aged bucket is active, list is filtered to that bucket. */}
      {(() => {
        const topOwed = (agedFilter
          ? topOwedAll.filter(([cid]) => contactBucket.get(cid) === agedFilter)
          : topOwedAll
        ).slice(0, agedFilter ? 50 : 5); // show all matches when bucket-filtered
        if (topOwed.length === 0) return null;
        return (
        <div style={{ background:'white', borderBottom:'1px solid #EBEBEA', flexShrink:0 }}>
          <div style={{ padding:'10px 18px 6px', fontSize:12, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.08em' }}>
            {agedFilter ? `${{ '0_30':'0-30', '31_60':'31-60', '61_90':'61-90', '90p':'90+' }[agedFilter]}d outstanding (${topOwed.length})` : 'Top owed'}
          </div>
          {topOwed.map(([contactId, cents]) => {
            const c = getContact(contactId);
            const isOver = invoices.some(i => i.contact_id === contactId && isInvoiceOverdue(i, installedSet));
            return (
              <button key={contactId} onClick={() => onOpen(contactId, 'finance')} style={{
                width:'100%', display:'flex', alignItems:'center', gap:10,
                padding:'8px 18px', borderTop:'1px solid #F5F5F3',
                background:'white', border:'none', cursor:'pointer', fontFamily:'inherit', textAlign:'left',
              }}>
                <span style={{ flex:1, minWidth:0, fontSize:13, fontWeight:600, color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{contactName(c)}</span>
                {isOver && <span style={{ fontSize:12, fontWeight:700, color:'#991B1B', background:'#FEF2F2', padding:'1px 6px', borderRadius:20, letterSpacing:'0.04em' }}>OVERDUE</span>}
                <span style={{ fontSize:13, fontWeight:700, color: isOver ? '#991B1B' : NAVY, fontFamily:"'DM Mono', monospace", flexShrink:0 }}>{formatMoneyCents(cents)}</span>
              </button>
            );
          })}
        </div>
        );
      })()}
      {/* Sub-tabs */}
      <div style={{ display:'flex', padding:'11px 18px 8px', gap:6, background:BG, borderBottom:'1px solid #EBEBEA', flexShrink:0 }}>
        {[
          { v:'all',       label:'All',       counts:{} },
          { v:'invoices',  label:'Invoices',  counts:invCounts },
          { v:'proposals', label:'Proposals', counts:proCounts },
        ].map(({v,label,counts})=>(
          <button key={v} onClick={()=>setView(v)} style={{ height:44, padding:'0 14px', borderRadius:8, border:'none', cursor:'pointer', background:view===v?NAVY:'white', color:view===v?'white':MUTED, fontWeight:600, fontSize:13, fontFamily:'inherit', display:'flex', alignItems:'center', gap:6 }}>
            {label}
            <div style={{ display:'flex', gap:3 }}>
              {Object.entries(counts).map(([s,n]) => <span key={s} style={{ fontSize:12, fontWeight:700, color:view===v?'rgba(255,255,255,0.7)':MUTED, background:view===v?'rgba(255,255,255,0.15)':'#F0F0EE', borderRadius:20, padding:'0 5px' }}>{n}</span>)}
            </div>
          </button>
        ))}
      </div>
      <div style={{ flex:1, overflowY:'auto', minHeight:0, paddingBottom:'calc(16px + env(safe-area-inset-bottom))' }}>
        {visible.length === 0 && <EmptyState icon="finance" text="No finance records" />}
        {visible.map(item => {
          const c = getContact(item.contact_id);
          // Subline omits the word "invoice": the row already renders a standalone
          // INVOICE pill, so "Deposit invoice" next to [INVOICE] read it twice.
          const itemLabel = item._kind === 'proposal' ? item.label : capitalize(item.kind);
          // Payment truth is ledger-backed. This shortcut opens the contact's
          // money controls, where amount and method are recorded atomically.
          const isUnpaidInvoice = item._kind !== 'proposal'
            && (item.status === 'sent' || item.status === 'viewed' || isInvoiceOverdue(item, installedSet));
          const onRecordPayment = (e) => {
            e.stopPropagation();
            onOpen(item.contact_id, 'finance', item.id);
          };
          return (
            <div key={item.id} role="button" tabIndex={0}
              onClick={()=>onOpen(item.contact_id,'finance',item.id)}
              onKeyDown={(e)=>{ if (e.key === 'Enter' || e.key === ' ') onOpen(item.contact_id,'finance',item.id); }}
              style={{
                // iOS Phase 1 Pass 3: hairline invoice/proposal rows match
                // the Contacts list. Transparent surface, hairline divider,
                // 60px min-height keeps tap target >=44px. Active row keeps
                // its warm-gold wash + inset gold accent.
                width:'100%',
                background: activeContactId===item.contact_id?'#FFFBEB':'transparent',
                border:'none', cursor:'pointer',
                display:'flex', alignItems:'center', gap:10,
                padding:'14px 22px', minHeight:60,
                borderBottom:'1px solid rgba(27,43,75,0.085)', textAlign:'left',
                boxShadow: activeContactId===item.contact_id?'inset 2px 0 0 '+GOLD:'none',
              }}
            >
              <ContactAvatar contact={c} size={36} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  {pinned.has(item.contact_id) && (
                    <svg viewBox="0 0 24 24" fill={GOLD} stroke={GOLD} strokeWidth="2" width="11" height="11" style={{ flexShrink:0 }}>
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  )}
                  <span style={{ fontWeight:600, fontSize:14, color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{contactName(c)}</span>
                  <StatusPill status={item.status} />
                  <span style={{ fontSize:12, fontWeight:700, color:MUTED, background:BG, padding:'1px 5px', borderRadius:20, textTransform:'uppercase', letterSpacing:'0.04em' }}>{item._kind === 'proposal' ? 'Proposal' : 'Invoice'}</span>
                </div>
                <div style={{ fontSize:11, color:MUTED, marginTop:1 }}>{itemLabel}</div>
              </div>
              <div style={{ fontWeight:700, fontSize:14, color:NAVY, flexShrink:0 }}>{formatMoneyCents(item.amount_cents)}</div>
              {isUnpaidInvoice && (
                <button
                  type="button"
                  onClick={onRecordPayment}
                  title="Open payment controls"
                  style={{
                    flexShrink:0, minHeight:44, padding:'0 12px', borderRadius:8,
                    background:'#10b981', color:'white', border:'none',
                    cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                    fontFamily:'inherit', fontSize:13, fontWeight:700, whiteSpace:'nowrap',
                  }}
                >
                  Record payment
                </button>
              )}
            </div>
          );
        })}
      </div>
      {quickQuoteOpen && <QuickQuoteModal onClose={()=>setQuickQuoteOpen(false)} onOpen={onOpen} contacts={contacts} />}
    </div>
  );
}

// ── Quick Quote Modal (ephemeral price calculator, no save/send/DB) ────
// Wired to the v3 proposal-creator pricing engine (window.quoteV3Total)
// so the modal's total matches dollar-for-dollar what the customer will
// see on the proposal page. The old quickQuoteTotal engine had the
// 50A cord stuck at $198 while v3 bumped it to $249 (2026-05-08), which
// made Quick Quote disagree with the real proposal builder, Key
// flagged this 2026-05-09. Length defaults to 5' (no extra-foot adder).
//
// Add-on chips correspond to the v3 toggles, all default-on. Toggling
// off subtracts the listed value from the base. PoM is rendered as an
// optional extra (added on top, since v3 explicitly excludes it from
// the base total, same way the proposal page shows it).
const QQ_V3_BASE = () => window.V3_PRICING?.base || { 30: 1197, 50: 1497 };
const QQ_V3_OFFS = () => ({
  base:        window.V3_PRICING?.base          || { 30: 1197, 50: 1497 },
  cord:        window.V3_PRICING?.cordOff       || { 30: 129, 50: 249 },
  inlet:       window.V3_PRICING?.inletOff      || { 30: 129, 50: 179 },
  permit:      window.V3_PRICING?.permitOff     || 150,
  pom:         window.V3_PRICING?.pom           || 447,
  // 2026-05-09: surge bumped 375→446 to match Key's quote-calculator design.
  // Surge gets −$25 when PoM is also active (combo discount).
  surge:         window.V3_PRICING?.surge         || 446,
  surgeDiscount: window.V3_PRICING?.surgeDiscount || 25,
  mainBreaker:   window.V3_PRICING?.mainBreaker   || 225,
  twinQuad:      window.V3_PRICING?.twinQuad      || 125,
  adapter:       window.V3_PRICING?.adapter       || 150,
});

function QuickQuoteModal({ onClose, onOpen, contacts = [] }) {
  const [amp, setAmp] = React.useState('30');
  // Turn-into-proposal handoff (tap-audit #4): on-call quote becomes a real
  // proposal in a couple taps instead of being re-keyed into the creator.
  const [picking, setPicking] = React.useState(false);
  const [pickedId, setPickedId] = React.useState('');
  // v3 toggles: cord, inlet, permit are all DEFAULT-ON (folded into base
  // price, toggling off discounts). surge & pom are optional ADD-ONS
  // (default off). length defaults to 5' (no extra-foot adder).
  // Tier was REMOVED 2026-05-09: the v3 proposal page (proposal.html)
  // does not apply tier uplift, so showing $300/$600 here would have
  // Key quoting a higher price on the phone than what the customer
  // sees on the proposal, a guaranteed trust break.
  const [includeCord,   setIncludeCord]   = React.useState(true);
  const [includeInlet,  setIncludeInlet]  = React.useState(true);
  const [includePermit, setIncludePermit] = React.useState(true);
  const [includePom,    setIncludePom]    = React.useState(false);
  // Run length (cord distance, panel to inlet). Feeds the SAME per-foot adder
  // in quoteV3Total that the real proposal creator's slider does, so the quick
  // number tracks the real quote maker. 5ft = base (no adder). Was hardcoded
  // to 5 with no slider (Key 2026-06-15: "it doesnt even have the slider").
  const [lengthFt, setLengthFt] = React.useState(5);
  // 2026-05-09: panel-work + adapter quick-adds from Key's calculator
  // design. All default off, toggle on to add to total. Adapter chip
  // only renders when amp === '50' (it's a 30→50A passthrough piece;
  // makes no sense for a 30A inlet).
  const [includeMainBreaker, setIncludeMainBreaker] = React.useState(false);
  const [includeTwinQuad,    setIncludeTwinQuad]    = React.useState(false);
  const [includeAdapter,     setIncludeAdapter]     = React.useState(false);

  // Auto-clear adapter when amp drops to 30 (it's 50A-only).
  React.useEffect(() => {
    if (amp !== '50' && includeAdapter) setIncludeAdapter(false);
  }, [amp, includeAdapter]);

  React.useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reset = () => {
    setAmp('30');
    setLengthFt(5);
    setIncludeCord(true); setIncludeInlet(true); setIncludePermit(true);
    setIncludePom(false);
    setIncludeMainBreaker(false); setIncludeTwinQuad(false); setIncludeAdapter(false);
  };

  // v3 engine: subtracts cord/inlet/permit if toggled off; adds line items
  // (panel work, adapter) on top. PoM is shown separately and explicitly NOT
  // folded into the customer-facing total, same as proposal.html.
  // Standalone surge RETIRED (Key decision 2026-06-09): surge is part of the
  // $447 Peace of Mind package, not a separate add-on. A one-off surge-only
  // job can still be quoted via a custom line item in the proposal builder.
  const offs = QQ_V3_OFFS();
  // Adder NAMES must match NewProposalModal's Quick Add tiles VERBATIM (the
  // creator dedups on lowercased name, so a mismatch lets Key double-add). The
  // adapter name is the full QA name '30->50A cord adapter' (with the arrow),
  // NOT the shorter '30->50A adapter' chip label.
  const QQ_ADDER_NAMES = { mainBreaker: 'Main breaker replacement', twinQuad: 'Panel space (twin / quad)', adapter: '30→50A cord adapter' };
  const pickable = (contacts || []).filter(c => !c.archived && !c.do_not_contact)
    .sort((a, b) => (contactName(a) || '').localeCompare(contactName(b) || ''));
  const turnIntoProposal = (contactId) => {
    if (!contactId) { window.showToast?.('Pick a contact first'); return; }
    const items = [];
    if (includeMainBreaker) items.push({ name: QQ_ADDER_NAMES.mainBreaker, amount: offs.mainBreaker });
    if (includeTwinQuad)    items.push({ name: QQ_ADDER_NAMES.twinQuad,    amount: offs.twinQuad });
    if (includeAdapter && amp === '50') items.push({ name: QQ_ADDER_NAMES.adapter, amount: offs.adapter });
    // NOTHING sends, this only seeds the proposal creator; Key reviews + sends.
    // contactId is stamped into the payload so the consumer can confirm the
    // prefill is for THIS contact (defense against a stale prefill leaking to
    // the next proposal). Navigate to 'finance', NOT 'contacts': the proposal
    // modal + its open-handshake live in ContactFinance, which only mounts on
    // the finance tab (regression review 2026-06-16; the proven Send-quote /
    // Ready-to-Quote call sites also use 'finance').
    window.__pendingProposalPrefill = {
      contactId, amp, lengthFt, includeCord, includeInlet, includePermit,
      pomOffered: includePom, lineItems: items,
    };
    window.__pendingOpenProposal = contactId;
    onOpen && onOpen(contactId, 'finance');
    window.dispatchEvent(new CustomEvent('crm-open-new-proposal', { detail: { contactId } }));
    onClose();
  };
  const lineItems = [
    includeMainBreaker && { kind:'item', amount: offs.mainBreaker,checked:true },
    includeTwinQuad    && { kind:'item', amount: offs.twinQuad,   checked:true },
    includeAdapter     && amp === '50' && { kind:'item', amount: offs.adapter,    checked:true },
  ].filter(Boolean);
  const baseTotal = window.quoteV3Total
    ? window.quoteV3Total({
        amp,
        lengthFt,
        includeCord, includeInlet, includePermit,
        lineItems,
      }) || 0
    : 0;
  const totalDollars = baseTotal + (includePom ? offs.pom : 0);
  const total = totalDollars * 100;

  const Eyebrow = ({ children }) => (
    <div style={{ fontSize:11, fontWeight:600, color:'#666', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>{children}</div>
  );

  const segBtn = (active) => ({
    flex:1, height:44, borderRadius:8,
    background: active ? NAVY : 'white',
    color: active ? 'white' : NAVY,
    border: active ? 'none' : '1px solid rgba(27,43,75,0.15)',
    fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
    display:'inline-flex', alignItems:'center', justifyContent:'center',
  });

  const chipBtn = (active) => ({
    minHeight:44, padding:'0 12px', borderRadius:12,
    background: active ? '#ffba00' : 'white',
    color: NAVY,
    border: active ? 'none' : '1px solid rgba(27,43,75,0.15)',
    fontSize:12, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
    display:'inline-flex', alignItems:'center', gap:5,
    whiteSpace:'nowrap',
  });

  // Scope toggle, mirrors the real proposal creator's scope grid: a check +
  // label + price, gold-outlined when on. Used for cord/inlet/permit/PoM so
  // Quick Quote reads like a copy of the main quote calc.
  const scopeBtn = (on) => ({
    display:'flex', alignItems:'center', gap:8, minHeight:48, padding:'0 12px',
    borderRadius:10, cursor:'pointer', fontFamily:'inherit', width:'100%',
    background: on ? '#FFFBEB' : 'white',
    border: on ? '1.5px solid #ffba00' : '1px solid rgba(27,43,75,0.15)',
  });

  // Portal to body: the mobile shell's 200%-wide transformed slider re-roots
  // position:fixed, so inset/center overlays render off-screen (the 2026-06-15
  // job-sheet glitch). Portaling escapes the transform. Matches ModalShell.
  return ReactDOM.createPortal((
    <div onClick={onClose} style={{
      // height = --vvh: overlay shrinks with iOS keyboard so the centered
      // modal card doesn't get hidden behind it when an input is focused.
      position:'fixed', top:0, left:0, right:0, height:'var(--vvh, 100dvh)',
      background:'rgba(11,31,59,0.4)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:200,
      padding:16,
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        width:380, maxWidth:'100%', maxHeight:'calc(var(--vvh, 100dvh) - 32px)',
        overflowY:'auto', background:'white',
        border:'1px solid rgba(11,31,59,0.12)', borderRadius:12,
        padding:20, fontFamily:'inherit',
      }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <span style={{ fontSize:18, fontWeight:600, color:NAVY }}>Quick quote</span>
          <button onClick={onClose} aria-label="Close" style={{
            width:44, height:44, borderRadius:6, border:'none', background:'none',
            color:'#666', fontSize:18, cursor:'pointer', fontFamily:'inherit', lineHeight:1,
            display:'inline-flex', alignItems:'center', justifyContent:'center',
          }}>×</button>
        </div>

        <Eyebrow>Amp</Eyebrow>
        <div style={{ display:'flex', gap:8, marginBottom:14 }}>
          {['30','50'].map(a => (
            <button key={a} onClick={()=>setAmp(a)} style={{ ...segBtn(amp===a), flexDirection:'column', gap:2, height:'auto', minHeight:54, padding:'8px 0' }}>
              <span style={{ fontSize:14, fontWeight:700 }}>{a}A</span>
              <span style={{ fontSize:11, fontWeight:600, fontFamily:"'DM Mono', monospace", color: amp===a ? 'rgba(255,255,255,0.85)' : '#5b6576' }}>{formatMoneyCents((QQ_V3_OFFS().base[a] || 0) * 100)}</span>
            </button>
          ))}
        </div>

        <Eyebrow>Run length (panel to inlet)</Eyebrow>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
          <input type="range" min="5" max="100" step="5" value={lengthFt}
            onChange={e => setLengthFt(parseInt(e.target.value, 10) || 5)}
            aria-label="Run length in feet from panel to inlet"
            style={{ flex:1, height:24, accentColor:'#ffba00', cursor:'pointer' }} />
          <span style={{ fontFamily:"'JetBrains Mono','DM Mono',monospace", fontSize:15, fontWeight:700, color:NAVY, minWidth:54, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{lengthFt} ft</span>
        </div>

        {/* Scope grid, mirrors the main quote calc: cord/inlet/permit are
            included in base (toggle off to discount), Peace of Mind adds on.
            Same toggles, same prices, same engine as the proposal creator. */}
        <Eyebrow>Scope</Eyebrow>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
          {[
            { id:'cord',   label:'Cord',          on: includeCord,   set: setIncludeCord,   price: offs.cord[amp],  kind:'incl' },
            { id:'inlet',  label:'Inlet',         on: includeInlet,  set: setIncludeInlet,  price: offs.inlet[amp], kind:'incl' },
            { id:'permit', label:'Permit',        on: includePermit, set: setIncludePermit, price: offs.permit,     kind:'incl' },
            { id:'pom',    label:'Peace of mind', on: includePom,    set: setIncludePom,    price: offs.pom,        kind:'add'  },
          ].map(s => (
            <button key={s.id} onClick={() => s.set(v => !v)} style={scopeBtn(s.on)} aria-pressed={s.on}>
              <span style={{ width:18, height:18, borderRadius:6, flexShrink:0, display:'inline-flex', alignItems:'center', justifyContent:'center', background: s.on ? '#ffba00' : 'transparent', border: s.on ? 'none' : '1.5px solid rgba(27,43,75,0.22)' }}>
                {s.on && <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke={NAVY} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 7.5l3 3 6-7" /></svg>}
              </span>
              <span style={{ flex:1, textAlign:'left', fontSize:13, fontWeight:600, color:NAVY, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</span>
              <span style={{ fontSize:11, fontWeight:600, fontFamily:"'DM Mono', monospace", flexShrink:0, color: s.kind==='add' ? (s.on ? '#15803D' : '#5b6576') : (s.on ? '#5b6576' : '#dc2626') }}>
                {s.kind==='add' ? `+${formatMoneyCents(s.price * 100)}` : (s.on ? 'incl.' : `−${formatMoneyCents(s.price * 100)}`)}
              </span>
            </button>
          ))}
        </div>

        <Eyebrow>Panel work + cord adapter</Eyebrow>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:18 }}>
          {[
            { id:'mainBreaker', label:'Main breaker', on: includeMainBreaker, set: setIncludeMainBreaker, add: offs.mainBreaker, show:true },
            { id:'twinQuad',    label:'Twin / quad',  on: includeTwinQuad,    set: setIncludeTwinQuad,    add: offs.twinQuad,    show:true },
            { id:'adapter',     label:'30→50A adapter', on: includeAdapter,   set: setIncludeAdapter,     add: offs.adapter,     show: amp === '50' },
          ].filter(a => a.show).map(a => (
            <button key={a.id} onClick={() => a.set(v => !v)} style={chipBtn(a.on)}>
              <span>{a.label}</span>
              <span style={{ color: a.on ? NAVY : '#666', fontSize:11, fontFamily:"'DM Mono', monospace" }}>
                +{formatMoneyCents(a.add * 100)}
              </span>
            </button>
          ))}
        </div>

        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:16, paddingTop:14, borderTop:'1px solid rgba(11,31,59,0.08)' }}>
          <span style={{ fontSize:13, color:'#666', fontWeight:500 }}>Total</span>
          <span style={{ fontFamily:"'JetBrains Mono', 'DM Mono', monospace", fontSize:28, fontWeight:700, color:NAVY }}>{formatMoneyCents(total)}</span>
        </div>

        {picking ? (
          <div>
            <select value={pickedId} onChange={e => setPickedId(e.target.value)} aria-label="Pick a contact for the proposal" style={{
              width:'100%', height:44, borderRadius:8, border:'1px solid rgba(27,43,75,0.15)',
              padding:'0 12px', fontSize:16, fontFamily:'inherit', color:NAVY, background:'white', marginBottom:10,
            }}>
              <option value="">Pick a contact...</option>
              {pickable.map(c => <option key={c.id} value={c.id}>{contactName(c)}</option>)}
            </select>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setPicking(false)} style={{
                flex:1, height:44, borderRadius:8, background:'white', color:NAVY,
                border:'1px solid rgba(27,43,75,0.15)', fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
              }}>Back</button>
              <button onClick={() => turnIntoProposal(pickedId)} disabled={!pickedId} style={{
                flex:2, height:44, borderRadius:8, background: pickedId ? '#ffba00' : '#e5e7eb',
                color:NAVY, border:'none', fontSize:13, fontWeight:700, fontFamily:'inherit', cursor: pickedId ? 'pointer' : 'default',
              }}>Use on this contact</button>
            </div>
          </div>
        ) : (
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={reset} style={{
              flex:1, height:44, borderRadius:8,
              background:'white', color:NAVY, border:'1px solid rgba(27,43,75,0.15)',
              fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
            }}>Reset</button>
            <button onClick={() => setPicking(true)} style={{
              flex:2, height:44, borderRadius:8,
              background:'#ffba00', color:NAVY, border:'none',
              fontSize:13, fontWeight:700, fontFamily:'inherit', cursor:'pointer',
            }}>Turn into proposal</button>
            <button onClick={onClose} style={{
              flex:1, height:44, borderRadius:8,
              background:'white', color:NAVY, border:'1px solid rgba(27,43,75,0.15)',
              fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
            }}>Close</button>
          </div>
        )}
      </div>
    </div>
  ), document.body);
}

// ── Messages List ─────────────────────────────────────────────────
// One row per contact = latest message for that contact, sorted by sent_at desc.
function MessagesList({ messages, calls, contacts, onOpen, dncSet = new Set(), activeContactId, domainStatus = { state:'idle', error:null } }) {
  // click-audit #7: when the inbox opens with unread inbound messages, default
  // to the Waiting filter so the operator lands on the threads that need a
  // reply instead of the full list. Lazy init (runs once per mount; the inbox
  // remounts each time the messages tab opens). Fully reversible, the operator
  // can switch back to All; with zero unread it defaults to All as before.
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [markingAll, setMarkingAll] = React.useState(false);
  // Filter chips folded into a search-bar funnel picker (Key 2026-06-20),
  // reusing the Contacts pattern. filterQuery marks a pasted filter label so
  // the name/body matcher steps aside; pickerOpen drives the ContactLensBar.
  const [filterQuery, setFilterQuery] = React.useState(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // Bottom search dock (Key 2026-07-10): the tab-bar Search bubble opens the
  // glass dock above the keyboard. x-close clears the query + filter; navigate-
  // away keeps the filter.
  const { searchOpen, setSearchOpen, closeSearch, dockVisible } = useSearchDock('bpp-msg-search', {
    onExit: () => { setSearch(''); setFilter('all'); setFilterQuery(null); setPickerOpen(false); },
    onForceClose: () => setPickerOpen(false),
  });
  const pinned = window.usePinned ? window.usePinned() : new Set();

  // Re-render the inbox when the localStorage scheduled-send queue changes so
  // the "Scheduled" pill appears/clears live (the queue is the only source of
  // truth for a pending scheduled send; audit 2026-06-20).
  const [schedTick, setSchedTick] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setSchedTick(t => t + 1);
    window.addEventListener('crm-scheduled-msg-changed', bump);
    window.addEventListener('storage', bump);
    return () => { window.removeEventListener('crm-scheduled-msg-changed', bump); window.removeEventListener('storage', bump); };
  }, []);

  // Mark all is explicit, but each thread still receives its own authenticated
  // server receipt. Local badges do not move ahead of durable truth.
  const markAllRead = async () => {
    if (markingAll) return;
    const state = CRM.operatorCommunicationsState;
    if (!state) {
      window.showToast?.('Messages could not update. Try again.');
      return;
    }
    setMarkingAll(true);
    try {
      const result = await state.markAllThreadsRead();
      if (result.total === 0) return;
      if (result.ok) {
        window.showToast?.('All marked read');
      } else if (result.succeeded > 0) {
        window.showToast?.(`${result.succeeded} threads updated. ${result.failed} could not update. Tap again to retry.`);
      } else {
        window.showToast?.('Messages could not update. Try again.');
      }
    } finally {
      setMarkingAll(false);
    }
  };

  // Index messages by contact_id once so building entries is O(messages)
  // instead of O(contacts × messages). Same trick for calls.
  const msgsByContact = React.useMemo(() => {
    const m = new Map();
    for (const x of messages) {
      if (!m.has(x.contact_id)) m.set(x.contact_id, []);
      m.get(x.contact_id).push(x);
    }
    for (const arr of m.values()) arr.sort((a,b) => (a.sent_at||'').localeCompare(b.sent_at||''));
    return m;
  }, [messages]);
  const callsByContact = React.useMemo(() => {
    const m = new Map();
    for (const x of calls) {
      if (!m.has(x.contact_id)) m.set(x.contact_id, []);
      m.get(x.contact_id).push(x);
    }
    return m;
  }, [calls]);
  // Full-text search index (Key 2026-06-18: "make the search... a full search
  // even of any text sent or recived"). Every message body per contact,
  // lowercased and joined, so the inbox search matches the actual text of any
  // message in the thread, inbound or outbound, not just the contact name.
  // Memoized on messages so it rebuilds only when a message changes.
  const bodyTextByContact = React.useMemo(() => {
    const m = new Map();
    for (const x of messages) {
      if (!x.body) continue;
      const prev = m.get(x.contact_id);
      m.set(x.contact_id, prev ? prev + '\n' + x.body.toLowerCase() : x.body.toLowerCase());
    }
    return m;
  }, [messages]);

  // Build entries: contacts.map(c => latest message for c.id).filter(present).sort
  const nowMs = Date.now();
  // Contact ids with a pending scheduled send (localStorage queue, not DB).
  const schedContactIds = React.useMemo(() => {
    const s = new Set();
    try { for (const it of (window.readSchedQueue?.() || [])) if (it && it.contactId) s.add(it.contactId); } catch (_) {}
    return s;
  }, [schedTick]);
  // Exclude archived contacts from the inbox + the unread badge (audit
  // 2026-06-22: an archived contact with messages/calls still appeared in the
  // inbox and inflated totalUnread, unlike the Contacts list which filters
  // archived). DNC stays visible , you still want to see a thread you stopped.
  const entries = contacts.filter(c => !c.archived).map(c => {
    const cMsgs = msgsByContact.get(c.id) || [];
    const last = cMsgs[cMsgs.length - 1];
    const cCalls = callsByContact.get(c.id) || [];
    // Voicemail badge clears when listened_at is set, same pattern as
    // messages.read_at clearing the unread badge. Without this filter
    // the purple voicemail dot stayed lit forever after Key heard it.
    const hasVm = cCalls.some(cl => cl.voicemail_url && cl.listened_at == null);
    const unread = cMsgs.filter(m => m.direction === 'in' && m.read_at == null).length;
    // Comms inbox upgrades (2026-06-10, mapped from messages-page.html):
    // a failed latest-outbound must NEVER hide on the inbox; a pending
    // scheduled send earns a quiet clock; auto-created "Unknown (...)"
    // rows get a New tag until renamed.
    const lastFailed = !!(last && last.direction === 'out' && (last.status === 'failed' || last.status === 'undelivered'));
    // Scheduled sends live ONLY in the localStorage queue (no messages row is
    // written until they fire), so the old messages.status==='scheduled' check
    // was dead and the pill never showed (audit 2026-06-20). Derive from the
    // same queue the detail-pane ScheduledMessagesStrip reads.
    const scheduled = schedContactIds.has(c.id);
    const isUnknownNew = /^Unknown\s/i.test(c.name || '');
    // CM-39/40 (inbox): a call/voicemail-only contact (no messages) is kept by
    // the filter below but had a null `last`, so its row showed a blank preview
    // + blank time AND sorted to the very bottom. lastCall = the newest call
    // (order-independent max of started_at); lastActivity = the most recent of
    // message-or-call so the row reads + sorts by real recency.
    const lastCall = cCalls.length ? cCalls.reduce((x, y) => (y.started_at || '') > (x.started_at || '') ? y : x) : null;
    const lastActivity = [last && last.sent_at, lastCall && lastCall.started_at].filter(Boolean).sort().pop() || '';
    return { contact: c, last, lastCall, lastActivity, cCalls, hasVm, unread, lastFailed, scheduled, isUnknownNew, searchBodies: bodyTextByContact.get(c.id) || '' };
  })
    .filter(e => e.last || e.cCalls.length > 0)
    // Pinned-first, then most-recent-ACTIVITY-first (message OR call) within each
    // group, so a fresh voicemail no longer sinks below stale text threads.
    .sort((a, b) => {
      const ap = pinned.has(a.contact.id) ? 1 : 0;
      const bp = pinned.has(b.contact.id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (b.lastActivity || '').localeCompare(a.lastActivity || '');
    });

  const totalUnread = entries.reduce((s,e) => s + e.unread, 0);

  // Boilerplate stripping for previews (UI/UX remake 1, 2026-06-10). The
  // templated openers carry a compliance footer and a long fixed body, so an
  // inbox full of fresh leads read as a wall of identical legal text. The
  // preview's job is "what happened last", so known templates summarize to a
  // short human clause and the footer never shows. Thread view still renders
  // full bodies; this is presentation only.
  const TEMPLATE_SUMMARIES = [
    [/this is Key with Backup Power Pro\. Got your message\. To put together an accurate quote/i, 'asked for a panel photo'],
    [/just checking in\. Did you get a chance to send over a photo/i, 'nudged for the panel photo'],
    [/deposit is confirmed for your generator inlet installation/i, 'confirmed the deposit'],
    [/thanks for reaching out to Backup Power Pro\..*will follow up/i, 'sent the welcome text'],
  ];
  const cleanBody = (body, isOut) => {
    if (!body) return '';
    if (isOut) {
      for (const [re, summary] of TEMPLATE_SUMMARIES) {
        if (re.test(body)) return summary;
      }
    }
    // Strip leading [media:URL] tokens (inbound MMS bodies carry them; the
    // inbox shows a "Photo" glyph already, audit 2026-06-20) + the compliance
    // footer + opt-out line wherever they ride along.
    return body
      .replace(/^(?:\[media:[^\]]*\]\s*)+/i, '')
      .replace(/\s*Licensed electrician serving Greenville[^]*$/i, '')
      .replace(/\s*Reply STOP to opt out\.?\s*$/i, '')
      .trim();
  };

  // Kind-aware one-line preview (mapped from messages-page.html, glyphs
  // upgraded to the comp's inline SVGs in messages-page-v2). mms/note/
  // system get a glyph or label instead of raw body; plain sms shows the
  // cleaned body. "You: " prefix preserved for outbound.
  const glyphStyle = { flexShrink:0, verticalAlign:'-2px', marginRight:3 };
  const PreviewGlyph = ({ kind }) => kind === 'camera'
    ? <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={glyphStyle} aria-hidden="true"><rect x="1.5" y="4" width="13" height="9" rx="2" /><circle cx="8" cy="8.5" r="2.5" /><path d="M5.5 4l1-1.5h3l1 1.5" /></svg>
    // CM-38 (inbox): a voicemail preview gets the real voicemail mark (matching
    // the avatar badge + the calls list), not the generic chat-bubbles glyph.
    : kind === 'voicemail'
    ? <span style={glyphStyle} aria-hidden="true"><span style={{ display:'inline-block', width:12, height:12, verticalAlign:'-2px' }}>{Icons.voicemail}</span></span>
    : <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={glyphStyle} aria-hidden="true"><circle cx="4.5" cy="8" r="2.5" /><circle cx="11.5" cy="8" r="2.5" /><path d="M4.5 10.5h7" /></svg>;
  const previewFor = (last) => {
    if (!last) return '';
    const isOut = last.direction === 'out';
    const pre = isOut ? 'You: ' : '';
    if (last.kind === 'mms')    return <>{pre}<PreviewGlyph kind="camera" />Photo{last.body ? ' ' + cleanBody(last.body, isOut) : ''}</>;
    if (last.kind === 'note')   return 'Note: ' + (last.body || '');
    if (last.kind === 'system') return last.body || '';
    if (last.kind === 'voicemail') return <><PreviewGlyph kind="voicemail" />Voicemail</>;
    return pre + cleanBody(last.body, isOut);
  };

  const filterOpts = [
    { value:'all',       label:'All',            count: entries.length },
    { value:'waiting',   label:'Waiting',        count: entries.filter(e => e.unread > 0).length },
    { value:'me',        label:'Awaiting reply', count: entries.filter(e => e.last?.direction === 'out').length },
    { value:'voicemail', label:'Voicemail',      count: entries.filter(e => e.hasVm).length },
  ];
  const msgFilterLabel = (val) => (filterOpts.find(o => o.value === val) || {}).label || val;
  const applyMsgFilter = (val) => {
    if (val === 'all') { setSearch(''); setFilter('all'); setFilterQuery(null); setPickerOpen(false); }
    else {
      const l = msgFilterLabel(val); setSearch(l); setFilter(val); setFilterQuery(l);
      // Picking a filter closes the dock so the filtered list + its header show;
      // the active-filter header carries the Clear (KEEPS the filter, unlike x).
      setSearchOpen(false); setPickerOpen(false);
      const el = document.getElementById('bpp-msg-search'); if (el) el.blur();
      window.dispatchEvent(new CustomEvent('crm-search-close'));
    }
  };
  // The lazy default may land on a non-All filter (unread -> waiting); show its
  // label in the box so the active filter is visible, matching a manual pick.
  React.useEffect(() => {
    if (filter !== 'all' && !search) { const l = msgFilterLabel(filter); setSearch(l); setFilterQuery(l); }
  }, []);

  const searchingText = !!search && search !== filterQuery;
  const filtered = (() => {
    // Full + typo-tolerant (Key 2026-06-18): match the contact name OR the text
    // of any message sent or received in the thread. A pasted filter label
    // (search === filterQuery) is NOT a search, the predicate below does the work.
    const base = entries
      .filter(e => !searchingText || smartMatch(search, contactName(e.contact)) || smartMatch(search, e.searchBodies))
      .filter(e => {
        if (filter === 'waiting')   return e.unread > 0;
        if (filter === 'me')        return e.last?.direction === 'out';
        if (filter === 'voicemail') return e.hasVm;
        return true;
      });
    if (!searchingText) return base;
    // Float CONTACT-NAME matches above body-only matches: typing a name should
    // surface that person even when a more-recent thread merely MENTIONS the word
    // in its body (Key 2026-06-20: "key" buried "Key Goodson" under threads whose
    // bodies contained "key"). Stable sort preserves the recency order within each
    // tier; the name-match is computed once per entry.
    return base
      .map(e => ({ e, rank: smartMatch(search, contactName(e.contact)) ? 0 : 1 }))
      .sort((a, b) => a.rank - b.rank)
      .map(x => x.e);
  })();

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
      {!searchOpen && (
        <PanelHeader title="Inbox" count={totalUnread > 0 ? `${totalUnread} unread` : null}
          right={totalUnread > 0 ? <button onClick={markAllRead} disabled={markingAll} aria-busy={markingAll ? true : undefined}
            style={{ fontSize:12, fontWeight:600, color:NAVY, background:'white', border:'1px solid rgba(11,31,59,0.15)', borderRadius:6, padding:'8px 12px', minHeight:44, cursor:markingAll?'wait':'pointer', opacity:markingAll?.65:1, fontFamily:'inherit' }}>{markingAll ? 'Updating...' : 'Mark all read'}</button> : null}
        />
      )}
      {/* Search moved OFF the top (Key 2026-07-10): the fixed top search bar is
          gone. Search is the detached tab-bar bubble, opening the glass dock
          above the keyboard (rendered at the bottom of this column). Its filter
          pills replace the old ContactLensBar bottom-sheet. */}
      <div style={{ flex:1, overflowY:'auto', minHeight:0, paddingBottom:'calc(16px + env(safe-area-inset-bottom))',
        // iOS-26 scroll-edge fade while searching: the header is hidden so the
        // list rides to the very top; dissolve it under the status bar.
        WebkitMaskImage: searchOpen ? 'linear-gradient(to bottom, transparent 0, #000 calc(env(safe-area-inset-top, 0px) + 18px))' : 'none',
        maskImage: searchOpen ? 'linear-gradient(to bottom, transparent 0, #000 calc(env(safe-area-inset-top, 0px) + 18px))' : 'none' }}>
        {/* Active-filter header (Key 2026-07-10): names the active filter with the
            dock closed so the list is never mysteriously narrowed (no Norman door). */}
        {filter !== 'all' && !searchOpen && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'11px 16px 10px', background:'white', borderBottom:'1px solid #f0f1f4' }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.05em' }}>{msgFilterLabel(filter)}</div>
              <div style={{ fontSize:15, fontWeight:700, color:NAVY, marginTop:1 }}>{filtered.length} {filtered.length === 1 ? 'thread' : 'threads'}</div>
            </div>
            <button onClick={() => applyMsgFilter('all')} aria-label="Clear filter" type="button"
              style={{ flexShrink:0, minHeight:36, padding:'0 14px', borderRadius:100, border:'1px solid rgba(27,43,75,0.15)', background:'white', color:NAVY, fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer' }}>Clear</button>
          </div>
        )}
        {(domainStatus.state === 'idle' || domainStatus.state === 'loading') && (
          <div role="status" style={{ padding:'34px 20px', textAlign:'center', color:MUTED, lineHeight:1.45 }}>
            <div style={{ fontSize:15, fontWeight:700, color:NAVY }}>Loading current conversations...</div>
            <div style={{ marginTop:6, fontSize:13 }}>Unread counts and threads will appear together when they are current.</div>
          </div>
        )}
        {domainStatus.state === 'error' && (
          <div role="alert" style={{ padding:'34px 20px', textAlign:'center', color:MUTED, lineHeight:1.45 }}>
            <div style={{ fontSize:15, fontWeight:700, color:NAVY }}>Messages could not load</div>
            <div style={{ marginTop:6, fontSize:13 }}>The inbox is hidden so missing messages cannot look like no conversations.</div>
            <button type="button" onClick={() => window.location.reload()} style={{ marginTop:14, minHeight:44, padding:'0 16px', borderRadius:8, border:'1px solid rgba(27,43,75,.2)', background:'white', color:NAVY, fontFamily:'inherit', fontWeight:700, cursor:'pointer' }}>Try again</button>
          </div>
        )}
        {domainStatus.state === 'ready' && filtered.length === 0 && (
          // Filter-aware empty state (Key 2026-06-19 walk): the inbox auto-selects
          // "Waiting" when there are unread, then auto-marks-read, so the operator
          // can land on an empty Waiting filter. A bare "No threads match" reads as
          // a dead-end; give a positive message + a one-tap way back to All.
          filter !== 'all'
            ? <EmptyState icon="messages"
                text={filter === 'waiting' ? "You're all caught up" : filter === 'me' ? 'Nothing from you yet' : 'No voicemails'}
                helper={filter === 'waiting' ? 'No one is waiting on a reply right now.' : null}
                actionLabel="View all threads" onAction={() => { setFilter('all'); setSearch(''); setFilterQuery(null); }} />
            : search
              ? <EmptyState icon="messages" text="No messages match your search" actionLabel="Clear search" onAction={() => setSearch('')} />
              : <EmptyState icon="messages" text="No conversations yet" />
        )}
        {domainStatus.state === 'ready' && filtered.map(({contact, last, lastCall, hasVm, unread, lastFailed, scheduled, isUnknownNew}, i) => (
          // CM-29: gentle entrance cascade capped to the first 6 rows. `backwards`
          // fill (NOT `both`) so after the rise the row reverts to its own style and
          // the global button:active press-scale still works; the delay lives in the
          // shorthand. Gated off while searching so it never re-animates per keystroke.
          <button key={contact.id} onClick={()=>onOpen(contact.id,'messages')} style={{ width:'100%', background: activeContactId===contact.id?'#FFFBEB':'white', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:10, padding:'13px 18px', borderBottom:'1px solid #F5F5F3', textAlign:'left', boxShadow: activeContactId===contact.id?'inset 2px 0 0 '+GOLD:'none',
            animation: (!search && i < 6) ? `bpp-fade-up 200ms cubic-bezier(0.2,0.8,0.3,1) ${i * 32}ms backwards` : undefined }}>
            <div style={{ position:'relative', flexShrink:0 }}>
              <ContactAvatar contact={contact} size={42} ringColor={window.lineColorFor ? window.lineColorFor(contact.current_line) : null} />
              {hasVm && <div style={{ position:'absolute',bottom:0,right:0,width:14,height:14,borderRadius:'50%',background:'#7C3AED',border:'2px solid white',display:'flex',alignItems:'center',justifyContent:'center',color:'white' }}><div style={{width:7,height:7}}>{Icons.voicemail}</div></div>}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:2, gap:6 }}>
                <span style={{ display:'flex', alignItems:'center', gap:5, minWidth:0, flex:1 }}>
                  {pinned.has(contact.id) && (
                    <svg viewBox="0 0 24 24" fill={GOLD} stroke={GOLD} strokeWidth="2" width="11" height="11" style={{ flexShrink:0 }}>
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  )}
                  <span style={{ fontWeight:unread > 0 ? 700 : 500, fontSize:15, color:NAVY, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{contactName(contact)}</span>
                  {isUnknownNew && <span style={{ flexShrink:0, fontSize:11, fontWeight:700, color:'#1E40AF', background:'#EFF6FF', padding:'1px 6px', borderRadius:20, letterSpacing:'0.04em' }}>New</span>}
                  {/* CM-22: DNC surfaced at rest in the inbox (was only discovered at
                      the bottom of the thread), reusing the red Not-delivered pill style. */}
                  {dncSet.has(contact.id) && <span style={{ flexShrink:0, fontSize:11, fontWeight:700, color:'#991B1B', background:'#FEF2F2', padding:'1px 6px', borderRadius:20 }}>DNC</span>}
                </span>
                <span style={{ display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
                  {scheduled && <span style={{ flexShrink:0, fontSize:11, fontWeight:700, color:'#1E40AF', background:'#EFF6FF', padding:'1px 6px', borderRadius:20, letterSpacing:'0.04em', whiteSpace:'nowrap' }}>Scheduled</span>}
                  <span title={(last && last.sent_at) ? new Date(last.sent_at).toLocaleString() : ((lastCall && lastCall.started_at) ? new Date(lastCall.started_at).toLocaleString() : undefined)} style={{ fontSize:11, color:MUTED, fontFamily:"'DM Mono', monospace" }}>{last ? formatRelative(last.sent_at) : (lastCall ? formatRelative(lastCall.started_at) : '')}</span>
                </span>
              </div>
              <div style={{ fontSize:13, color: lastFailed ? '#991B1B' : (unread > 0 ? NAVY : MUTED), whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontWeight:unread > 0 ? 500 : 400, display:'flex', alignItems:'center', gap:6 }}>
                {lastFailed && <span style={{ flexShrink:0, fontSize:11, fontWeight:700, color:'#991B1B', background:'#FEF2F2', padding:'1px 6px', borderRadius:20, whiteSpace:'nowrap' }}>Not delivered</span>}
                {/* CM-39 (inbox): a call/voicemail-only row has no `last`, so
                    fall back to naming the call instead of a blank line. */}
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>{last ? previewFor(last) : (lastCall ? (lastCall.voicemail_url ? <><PreviewGlyph kind="voicemail" />Voicemail</> : (lastCall.direction === 'out' ? 'Outgoing call' : lastCall.direction === 'missed' ? 'Missed call' : 'Incoming call')) : '')}</span>
              </div>
            </div>
            {unread > 0 && <div aria-label={`${unread} unread`} style={{ minWidth:20,height:20,borderRadius:9999,padding:'0 5px',background:NAVY,color:'white',fontSize:12,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>{unread}</div>}
          </button>
        ))}
      </div>
      {dockVisible && (
        <SearchDock
          exiting={!searchOpen}
          inputId="bpp-msg-search"
          value={search}
          placeholder="Search names + message text"
          onChange={v => { setSearch(v); if (filterQuery !== null && v !== filterQuery) { setFilterQuery(null); if (filter !== 'all') setFilter('all'); } }}
          onClear={() => { setSearch(''); setFilter('all'); setFilterQuery(null); }}
          onClose={closeSearch}
          onEnter={() => { if (searchingText && filtered.length > 0) { onOpen(filtered[0].contact.id, 'messages'); closeSearch(); } }}
          filters={filterOpts}
          activeFilter={filter}
          onFilter={applyMsgFilter}
          filterOpen={pickerOpen}
          setFilterOpen={setPickerOpen}
        />
      )}
    </div>
  );
}

// ── Calls List ────────────────────────────────────────────────────
const CALL_PALETTE = {
  in:     { color:'#065F46', bg:'#ECFDF5', label:'Incoming' },
  out:    { color:'#1E40AF', bg:'#EFF6FF', label:'Outgoing' },
  missed: { color:'#991B1B', bg:'#FEF2F2', label:'Missed'   },
};

function CallsList({ calls, contacts, onOpen, activeContactId }) {
  const getContact = id => contacts.find(c => c.id === id);
  const pinned = window.usePinned ? window.usePinned() : new Set();
  const [selectedCall, setSelectedCall] = React.useState(null);
  const callTriggerRef = React.useRef(null);
  const openCallDetail = (call, trigger) => {
    callTriggerRef.current = trigger || document.activeElement;
    setSelectedCall(call);
  };
  const closeCallDetail = () => {
    setSelectedCall(null);
    requestAnimationFrame(() => callTriggerRef.current?.focus?.());
  };

  // Pinned-first: contacts you've starred surface to the top of every
  // calls slice (today / missed / voicemails / all). Within each pin
  // bucket the existing started_at-desc order is preserved.
  const sorted = [...calls].sort((a, b) => {
    const ap = pinned.has(a.contact_id) ? 1 : 0;
    const bp = pinned.has(b.contact_id) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.started_at || '').localeCompare(a.started_at || '');
  });
  const todayCalls   = sorted.filter(c => dayKey(c.started_at) === TODAY);
  const callbackQueue = sorted.filter(c => c.direction === 'missed');
  // Callback banner rows: a missed call drains once a LATER outbound call to
  // the same contact exists; dedupe to one row per contact (keep newest).
  // The Missed chip stays the full unfiltered view; only the banner drains.
  const callbackBannerAll = (() => {
    const lastOut = new Map();
    for (const cl of calls) {
      if (cl.direction !== 'out' || !cl.contact_id || !cl.started_at) continue;
      if (cl.started_at > (lastOut.get(cl.contact_id) || '')) lastOut.set(cl.contact_id, cl.started_at);
    }
    const seen = new Set();
    const rows = [];
    for (const cl of callbackQueue) {
      if (!cl.contact_id || seen.has(cl.contact_id)) continue;
      seen.add(cl.contact_id);
      const out = lastOut.get(cl.contact_id);
      if (out && cl.started_at && out > cl.started_at) continue;
      rows.push(cl);
    }
    return rows;
  })();
  // Cap visible banner rows at 3 so it cannot crowd out the list.
  const callbackBanner = callbackBannerAll.slice(0, 3);
  // Voicemails filter: surface unheard voicemails first (listened_at==null).
  // Once heard, they stay in the All view but drop out of this chip, same
  // pattern as the inbox unread filter clearing on read.
  const voicemails   = sorted.filter(c => c.voicemail_url && c.listened_at == null);

  const [filter, setFilter] = React.useState('all');
  const [dial, setDial] = React.useState('');
  // The dialer is now a POPUP hosted at app root (crm-app DialerPopup), opened
  // by the long-press Calls icon or the "Open in dialer" row (both via the
  // crm-open-keypad event). This list is search-only. The filter chips folded
  // into a search-bar picker (Key 2026-06-20): filterQuery marks that the
  // search box is showing a pasted filter label, so the transcript matcher
  // steps aside; pickerOpen drives the ContactLensBar picker.
  const [filterQuery, setFilterQuery] = React.useState(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // Bottom search dock (Key 2026-07-10): the tab-bar Search bubble opens the
  // glass dock above the keyboard. x-close clears the query + filter.
  const { searchOpen, setSearchOpen, closeSearch, dockVisible } = useSearchDock('bpp-call-search', {
    onExit: () => { setDial(''); setFilter('all'); setFilterQuery(null); setPickerOpen(false); },
    onForceClose: () => setPickerOpen(false),
  });

  const filterOpts = [
    { value:'all',        label:'All',         count: sorted.length },
    { value:'missed',     label:'Missed',      count: callbackQueue.length },
    { value:'voicemails', label:'Voicemails',  count: voicemails.length },
    { value:'today',      label:'Today',       count: todayCalls.length },
  ];

  const visible = filter === 'missed'     ? callbackQueue
                : filter === 'voicemails' ? voicemails
                : filter === 'today'      ? todayCalls
                : sorted;

  // The Calls search box (Key 2026-06-20): whatever is typed filters the call
  // log by contact name, phone digits, AND the call transcript / AI summary /
  // voicemail (typo-tolerant via smartMatch). The dialer/Call logic moved to
  // the app-root DialerPopup (crm-app); this list never dials.
  const dialDigits = (dial || '').replace(/\D/g, '');
  const dialHasLetters = /[a-zA-Z]/.test(dial || '');
  // Live US formatting for the "Open in dialer" row display.
  const fmtDial = (() => {
    if (dialHasLetters) return dial;
    const d = dialDigits.startsWith('1') && dialDigits.length > 10 ? dialDigits.slice(1) : dialDigits;
    if (d.length === 0) return '';
    if (d.length < 4) return '(' + d;
    if (d.length < 7) return `(${d.slice(0,3)}) ${d.slice(3)}`;
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,10)}`;
  })();
  // Normalize any phone shape to bare 10 digits so the digit-match in search
  // never depends on how the number was stored or typed.
  const norm10 = (s) => {
    const d = String(s || '').replace(/\D/g, '');
    return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  };
  const dialNorm = norm10(dialDigits);
  const callQuery = (dial || '').trim();
  // A pasted filter label (filterQuery) is NOT a search: the filter enum below
  // already sliced the list, so the transcript matcher steps aside and the
  // callback banner + voicemails stay visible (else picking "Missed" would
  // hide them, the inversion bug).
  const searchingCalls = callQuery.length > 0 && callQuery !== filterQuery;
  const searchedVisible = (() => {
    if (!searchingCalls) return visible;
    const nameHitOf = (c) => window.smartMatch ? window.smartMatch(callQuery, contactName(c) || '') : (contactName(c) || '').toLowerCase().includes(callQuery.toLowerCase());
    const matched = visible.map(cl => {
      const c = getContact(cl.contact_id);
      const phoneHit = dialDigits.length >= 3 && norm10(c && c.phone).includes(dialNorm);
      const nameHit = nameHitOf(c);
      if (phoneHit || nameHit) return { cl, rank: 0 };
      const hay = [cl.transcript, cl.ai_summary, cl.voicemail_transcript].filter(Boolean).join('  •  ');
      const bodyHit = window.smartMatch ? window.smartMatch(callQuery, hay) : hay.toLowerCase().includes(callQuery.toLowerCase());
      return bodyHit ? { cl, rank: 1 } : null;
    }).filter(Boolean);
    // Float identity matches (contact name or phone) above transcript-only hits,
    // so typing a name/number surfaces that contact's calls first, not a recent
    // call whose transcript merely mentions the word (Key 2026-06-20). Stable
    // sort keeps the recency order within each tier.
    return matched.sort((a, b) => a.rank - b.rank).map(x => x.cl);
  })();
  // Filter picker (reuses the Contacts funnel-in-search lensQuery mechanic):
  // picking a filter pastes its label into the search box + sets the marker so
  // the label is shown but not text-searched; 'all' clears everything.
  const callFilterLabel = (val) => (filterOpts.find(o => o.value === val) || {}).label || val;
  const applyCallFilter = (val) => {
    if (val === 'all') { setDial(''); setFilter('all'); setFilterQuery(null); setPickerOpen(false); }
    else {
      const l = callFilterLabel(val); setDial(l); setFilter(val); setFilterQuery(l);
      // Picking a filter closes the dock; the active-filter header carries Clear.
      setSearchOpen(false); setPickerOpen(false);
      const el = document.getElementById('bpp-call-search'); if (el) el.blur();
      window.dispatchEvent(new CustomEvent('crm-search-close'));
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
      {!searchOpen && (
        <PanelHeader title="Calls" right={<span style={{ fontSize:12, color:MUTED, fontWeight:500 }}>{todayCalls.length} today</span>} />
      )}
      {/* Search moved OFF the top (Key 2026-07-10): the fixed call-history search
          bar is gone. Search is the detached tab-bar bubble, opening the glass
          dock above the keyboard; its filter pills replace the funnel picker.
          The dialer stays a POPUP (crm-app DialerPopup), opened by the long-press
          Calls icon or the "Open in dialer" row. */}
      {!searchingCalls && !searchOpen && callbackBanner.length > 0 && (
        <div style={{ background:'#FEF2F2', borderBottom:'1px solid #FEE2E2', padding:'8px 16px', flexShrink:0, maxHeight:200, overflowY:'auto' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#991B1B', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Callback Queue · {callbackBannerAll.length}</div>
          {callbackBanner.map(cl => {
            const c = getContact(cl.contact_id);
            return (
              <div key={cl.id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <span style={{ fontSize:13, fontWeight:600, color:'#991B1B', flex:1 }}>{contactName(c)} · {formatPhone(c?.phone)}</span>
                <button onClick={(e)=>openCallDetail(cl,e.currentTarget)} style={{ fontSize:11, fontWeight:700, color:'white', background:'#991B1B', border:'none', borderRadius:6, padding:'4px 10px', minHeight:44, cursor:'pointer', fontFamily:'inherit' }}>Open</button>
              </div>
            );
          })}
        </div>
      )}
      {!searchingCalls && !searchOpen && filter !== 'voicemails' && voicemails.length > 0 && (
        <>
          <SectionHeader label={`Voicemails (${voicemails.length})`} badge={voicemails.length} />
          {voicemails.map(cl => {
            const c = getContact(cl.contact_id);
            return (
              <button key={cl.id} data-call-event-id={cl.id} onClick={(e)=>openCallDetail(cl,e.currentTarget)} style={{ width:'100%', minHeight:44, background:'white', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:10, padding:'13px 18px', borderBottom:'1px solid #F5F5F3', textAlign:'left' }}>
                <div style={{ width:40,height:40,borderRadius:'50%',background:'#EDE9FE',display:'flex',alignItems:'center',justifyContent:'center',color:'#7C3AED',flexShrink:0 }}><div style={{width:18,height:18}}>{Icons.voicemail}</div></div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{ fontWeight:600, fontSize:13, color:NAVY }}>{contactName(c)}</span>
                  </div>
                  <div style={{ fontSize:11, color:MUTED, marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cl.voicemail_transcript ? `\u201C${cl.voicemail_transcript}\u201D` : <em style={{ color:'#9CA3AF' }}>{window.transcriptUnavailable?.(cl.started_at) ? 'Transcript unavailable' : 'Transcribing\u2026'}</em>}</div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:NAVY }}>{formatDuration(cl.voicemail_duration || cl.duration_sec)}</div>
                  <div title={cl.started_at ? new Date(cl.started_at).toLocaleString() : undefined} style={{ fontSize:12, color:MUTED }}>{formatRelative(cl.started_at)}</div>
                </div>
              </button>
            );
          })}
        </>
      )}
      <div style={{ flex:1, overflowY:'auto', minHeight:0, paddingBottom:'calc(16px + env(safe-area-inset-bottom))',
        WebkitMaskImage: searchOpen ? 'linear-gradient(to bottom, transparent 0, #000 calc(env(safe-area-inset-top, 0px) + 18px))' : 'none',
        maskImage: searchOpen ? 'linear-gradient(to bottom, transparent 0, #000 calc(env(safe-area-inset-top, 0px) + 18px))' : 'none' }}>
        {/* Active-filter header (Key 2026-07-10): names the active filter with the
            dock closed so the list is never mysteriously narrowed, with a Clear. */}
        {filter !== 'all' && !searchOpen && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'11px 16px 10px', background:'white', borderBottom:'1px solid #f0f1f4' }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.05em' }}>{callFilterLabel(filter)}</div>
              <div style={{ fontSize:15, fontWeight:700, color:NAVY, marginTop:1 }}>{searchedVisible.length} {searchedVisible.length === 1 ? 'call' : 'calls'}</div>
            </div>
            <button onClick={() => applyCallFilter('all')} aria-label="Clear filter" type="button"
              style={{ flexShrink:0, minHeight:36, padding:'0 14px', borderRadius:100, border:'1px solid rgba(27,43,75,0.15)', background:'white', color:NAVY, fontSize:13, fontWeight:600, fontFamily:'inherit', cursor:'pointer' }}>Clear</button>
          </div>
        )}
        {/* When a number (not words) is typed in search, offer to take it into
            the dialer (Key 2026-06-20): tap -> open the dialer with the number
            typed so far, ready to call. */}
        {searchingCalls && !dialHasLetters && dialDigits.length >= 1 && (
          <button onClick={() => window.dispatchEvent(new CustomEvent('crm-open-keypad', { detail: { seedDial: dial } }))} aria-label={`Open the dialer with ${fmtDial}`}
            style={{ width:'100%', background:'white', border:'none', borderBottom:'1px solid #F5F5F3', cursor:'pointer', display:'flex', alignItems:'center', gap:10, padding:'13px 18px', textAlign:'left' }}>
            <div style={{ width:40, height:40, borderRadius:'50%', background:'#EEF1F6', display:'flex', alignItems:'center', justifyContent:'center', color:NAVY, flexShrink:0 }}>
              <div style={{ width:18, height:18 }}>{Icons.calls}</div>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:13, color:NAVY }}>Open in dialer</div>
              <div style={{ fontSize:12, color:MUTED, marginTop:1 }}>{fmtDial}</div>
            </div>
            <span style={{ fontSize:16, color:'#9CA3AF', flexShrink:0 }}>&#8250;</span>
          </button>
        )}
        <SectionHeader label={searchingCalls ? `Matches (${searchedVisible.length})` : filterQuery ? `${searchedVisible.length} shown` : (filter === 'all' ? 'Recent calls' : filterOpts.find(o => o.value===filter)?.label || '')} />
        {searchedVisible.length === 0 && (
          <EmptyState
            icon="calls"
            text={searchingCalls ? 'No calls match your search' : (filter === 'all' ? 'No call history yet' : filter === 'missed' ? 'No missed calls' : filter === 'voicemails' ? 'No voicemails' : 'No calls today')}
            helper={searchingCalls ? 'Searches names, numbers, and call transcripts.' : (filter === 'all' ? `Customer calls to ${formatPhone(window.BPP_MAIN_LINE)} land here automatically.` : undefined)}
            actionLabel={searchingCalls ? 'Clear search' : undefined}
            onAction={searchingCalls ? () => setDial('') : undefined}
          />
        )}
        {searchedVisible.map((cl, i) => {
          const c = getContact(cl.contact_id);
          const p = CALL_PALETTE[cl.direction] || CALL_PALETTE.out;
          const hasVm = !!cl.voicemail_url;
          // Bug (2026-07-04 sim audit): a call with no matched contact AND no
          // resolvable c?.phone rendered a bare "-" title and a dangling
          // "· Jun 10" subtitle (leading separator, no number). Fall back to
          // the call log's own to/from number before giving up, and only
          // print the separator when there is actually a number to pair it with.
          const rawNum = cl.direction === 'out' ? cl.to_phone : cl.from_phone;
          const callTitle = c ? contactName(c) : (rawNum ? formatPhone(rawNum) : 'Unknown number');
          const callNumber = formatPhone(c?.phone || rawNum);
          // A SHAKEN/STIR-failed or Nomorobo robocall is logged status:'spam'
          // with no voicemail. Without this it rendered the green "Incoming"
          // pill, presenting a blocked robocall as a real customer call (the
          // contact-panel already shows grey "Spam"; audit 2026-06-23 round 2).
          const isSpam = cl.status === 'spam' && !hasVm;
          return (
            // CM-29: same capped entrance cascade as the inbox; `backwards` fill keeps
            // the press-scale, gated off during an active call search.
            <button key={cl.id} data-call-event-id={cl.id} onClick={(e)=>openCallDetail(cl,e.currentTarget)} style={{ width:'100%', minHeight:44, background:'white', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:10, padding:'13px 18px', borderBottom:'1px solid #F5F5F3', textAlign:'left',
              animation: (!searchingCalls && i < 6) ? `bpp-fade-up 200ms cubic-bezier(0.2,0.8,0.3,1) ${i * 32}ms backwards` : undefined }}>
              <div style={{ position:'relative', flexShrink:0 }}>
                <div style={{ width:40,height:40,borderRadius:'50%',background: hasVm?'#EDE9FE':isSpam?'#f3f4f6':p.bg,display:'flex',alignItems:'center',justifyContent:'center',color: hasVm?'#7C3AED':isSpam?'#6b7280':p.color }}>
                  <div style={{width:18,height:18}}>{hasVm ? Icons.voicemail : Icons.calls}</div>
                </div>
                {/* CM-CALL-4: an unheard voicemail gets the purple unheard dot
                    here too (the inbox avatar + detail card already show it), so
                    the All/search list can be triaged at a glance. */}
                {hasVm && cl.listened_at == null && <div style={{ position:'absolute', bottom:0, right:0, width:13, height:13, borderRadius:'50%', background:'#7C3AED', border:'2px solid white' }} />}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  {pinned.has(cl.contact_id) && (
                    <svg viewBox="0 0 24 24" fill={GOLD} stroke={GOLD} strokeWidth="2" width="11" height="11" style={{ flexShrink:0 }}>
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  )}
                  <span style={{ fontWeight:600, fontSize:13, color:NAVY }}>{callTitle}</span>
                  {/* CM-CALL-2: a voicemail is self-evidently inbound, so the
                      green "Incoming" pill is noise AND clashes with the purple
                      voicemail identity. Show a single purple "Voicemail" tag
                      instead, keeping the row in one color language. */}
                  {hasVm
                    ? <span style={{ fontSize:12, fontWeight:700, color:'#7C3AED', background:'#EDE9FE', padding:'1px 6px', borderRadius:20 }}>Voicemail</span>
                    : isSpam
                      ? <span style={{ fontSize:12, fontWeight:700, color:'#6b7280', background:'#f3f4f6', padding:'1px 6px', borderRadius:20 }}>Spam</span>
                      : <span style={{ fontSize:12, fontWeight:700, color:p.color, background:p.bg, padding:'1px 6px', borderRadius:20 }}>{p.label}</span>}
                </div>
                <div style={{ fontSize:11, color:MUTED, marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {hasVm ? (cl.voicemail_transcript ? `"${cl.voicemail_transcript}"` : (window.transcriptUnavailable?.(cl.started_at) ? 'Voicemail, transcript unavailable' : 'Voicemail, transcribing…')) : (callNumber ? `${callNumber} · ${formatRelative(cl.started_at)}` : formatRelative(cl.started_at))}
                </div>
              </div>
              {/* CM-CALL-3: a voicemail row stacks duration over its time (like
                  the dedicated Voicemails section) so it no longer loses its
                  "when"; non-voicemail rows keep the subtitle-time + duration. */}
              {hasVm
                ? <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:NAVY, fontVariantNumeric:'tabular-nums' }}>{formatDuration(cl.voicemail_duration || cl.duration_sec)}</div>
                    <div title={cl.started_at ? new Date(cl.started_at).toLocaleString() : undefined} style={{ fontSize:12, color:MUTED, fontVariantNumeric:'tabular-nums' }}>{formatRelative(cl.started_at)}</div>
                  </div>
                : (cl.direction !== 'missed' && <div style={{ fontSize:12, color:MUTED, flexShrink:0, fontVariantNumeric:'tabular-nums' }}>{formatDuration(cl.duration_sec)}</div>)}
            </button>
          );
        })}

        {/* CRM revamp T2-7: the Calls footer was a full settings card (main
            line + Call, a stale Quo/porting row, a Manage link, a 3-line
            helper) pinned to the bottom of the call log. Reduced to one quiet
            footer line , the main number + a single Manage-in-Twilio link.
            Dropped the stale Quo/porting row, the redundant call-your-own-line
            button, and the helper paragraph (settings genuinely live in the
            Twilio console; calls land back here automatically). */}
        <div style={{ padding:'12px 18px 22px', borderTop:'1px solid #EBEBEA', marginTop:8, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
          <span style={{ fontSize:12, color:MUTED }}>
            Main line <span style={{ fontFamily:"'DM Mono', monospace", fontWeight:700, color:NAVY }}>{formatPhone(window.BPP_MAIN_LINE)}</span>
          </span>
          <div style={{ display:'inline-flex', alignItems:'center', gap:18, flexWrap:'wrap' }}>
            <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener noreferrer"
               style={{ display:'inline-flex', alignItems:'center', gap:5, minHeight:44, fontSize:12, fontWeight:600, color:NAVY, textDecoration:'none' }}>
              Manage greeting + routing in Twilio ↗
            </a>
            {/* 2026-06-29: real Sign out (the CRM had none; signOut was only a test stub).
                Reuses this footer's quiet link style; MUTED so it stays secondary. */}
            <button
              onClick={async () => {
                try { await window.CRM?.__db?.auth?.signOut(); } catch (e) {}
                try { Object.keys(localStorage).forEach((k) => { if (k.startsWith('sb-')) localStorage.removeItem(k); }); } catch (e) {}
                window.location.reload();
              }}
              style={{ display:'inline-flex', alignItems:'center', minHeight:44, padding:'0 4px', background:'none', border:'none', cursor:'pointer', fontSize:12, fontWeight:600, color:MUTED, fontFamily:'inherit' }}>
              Sign out
            </button>
          </div>
        </div>
      </div>
      {dockVisible && (
        <SearchDock
          exiting={!searchOpen}
          inputId="bpp-call-search"
          value={dial}
          placeholder="Number, name, or words in a call"
          onChange={v => { setDial(v); if (filterQuery !== null && v !== filterQuery) { setFilterQuery(null); if (filter !== 'all') setFilter('all'); } }}
          onClear={() => { setDial(''); setFilter('all'); setFilterQuery(null); }}
          onClose={closeSearch}
          onEnter={() => { const first = searchedVisible[0]; if (searchingCalls && first) { openCallDetail(first, document.activeElement); closeSearch(); } }}
          filters={filterOpts}
          activeFilter={filter}
          onFilter={applyCallFilter}
          filterOpen={pickerOpen}
          setFilterOpen={setPickerOpen}
        />
      )}
      {selectedCall && window.ModalShell && (() => {
        const cl = selectedCall;
        const c = getContact(cl.contact_id);
        const direction = cl.direction === 'out' ? 'Outgoing' : cl.direction === 'missed' ? 'Missed' : 'Incoming';
        const source = cl.from_phone ? formatPhone(cl.from_phone) : 'Not available';
        const destination = cl.to_phone ? formatPhone(cl.to_phone) : 'Not available';
        const callbackPhone = cl.direction === 'out' ? cl.to_phone : cl.from_phone;
        const detailRows = [
          ['Contact', c ? contactName(c) : 'Unknown contact'],
          ['Direction', direction],
          ['Status', cl.status || 'Not available'],
          ['Time', cl.started_at ? new Date(cl.started_at).toLocaleString() : 'Not available'],
          ['Duration', formatDuration(cl.voicemail_duration || cl.duration_sec)],
          ['From', source],
          ['To', destination],
        ];
        const openDialer = () => {
          const returnFocus = callTriggerRef.current;
          setSelectedCall(null);
          setTimeout(() => window.dispatchEvent(new CustomEvent('crm-open-keypad', {
            detail: { seedDial: callbackPhone || '', returnFocus },
          })), 0);
        };
        return (
          <window.ModalShell
            open={true}
            onClose={closeCallDetail}
            title="Call details"
            footer={callbackPhone ? (
              <button type="button" onClick={openDialer} style={{ width:'100%', minHeight:44, border:0, borderRadius:8, background:GOLD, color:NAVY, fontSize:14, fontWeight:700, fontFamily:'inherit', cursor:'pointer' }}>
                Call back
              </button>
            ) : null}
          >
            <div data-call-detail-id={cl.id} role="dialog" aria-label="Call details">
              {detailRows.map(([label, value]) => (
                <div key={label} style={{ display:'grid', gridTemplateColumns:'92px minmax(0,1fr)', gap:12, padding:'9px 0', borderBottom:'1px solid #F1F2F4', fontSize:13 }}>
                  <span style={{ color:MUTED, fontWeight:600 }}>{label}</span>
                  <span style={{ color:NAVY, overflowWrap:'anywhere' }}>{value}</span>
                </div>
              ))}
              {(cl.transcript || cl.voicemail_transcript) && (
                <div style={{ paddingTop:14 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:MUTED, marginBottom:5 }}>Transcript</div>
                  <div style={{ fontSize:13, lineHeight:1.5, color:NAVY, whiteSpace:'pre-wrap' }}>{cl.transcript || cl.voicemail_transcript}</div>
                </div>
              )}
              {cl.ai_summary && (
                <div style={{ paddingTop:14 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:MUTED, marginBottom:5 }}>AI summary</div>
                  <div style={{ fontSize:13, lineHeight:1.5, color:NAVY, whiteSpace:'pre-wrap' }}>{cl.ai_summary}</div>
                </div>
              )}
              {cl.notes && (
                <div style={{ paddingTop:14 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:MUTED, marginBottom:5 }}>Notes</div>
                  <div style={{ fontSize:13, lineHeight:1.5, color:NAVY, whiteSpace:'pre-wrap' }}>{cl.notes}</div>
                </div>
              )}
            </div>
          </window.ModalShell>
        );
      })()}
    </div>
  );
}

// ── Shared ────────────────────────────────────────────────────────
function SectionHeader({ label, badge }) {
  return (
    <div style={{ padding:'10px 18px 6px', fontSize:12, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.08em', background:BG, display:'flex', alignItems:'center', gap:6, borderBottom:'1px solid #EBEBEA', flexShrink:0 }}>
      {label}
      {badge>0 && <span style={{ background:NAVY, color:'white', borderRadius:20, fontSize:12, fontWeight:700, padding:'1px 5px' }}>{badge}</span>}
    </div>
  );
}

function EmptyState({ icon, text, helper, actionLabel, onAction }) {
  // CRM revamp T2-5: one canonical left-rail empty state for all 5 lenses.
  // Variants by prop: text only / + helper (external-dependency line, e.g.
  // "webhook not wired") / + actionLabel (empty-with-action CTA). One icon
  // size + opacity + padding so the lenses stop drifting (was 28/32/36px,
  // 0.25/0.3 opacity, 32/36/40/48px padding hand-rolled per lens).
  return (
    <div style={{ padding:'40px 24px', textAlign:'center', color:MUTED }}>
      <div style={{ width:32,height:32,margin:'0 auto 12px',opacity:0.3,color:MUTED }}>{Icons[icon]||Icons.contacts}</div>
      <div style={{ fontSize:13, fontWeight:500, color:NAVY }}>{text}</div>
      {helper && <div style={{ fontSize:12, color:MUTED, lineHeight:1.5, maxWidth:280, margin:'6px auto 0' }}>{helper}</div>}
      {actionLabel && onAction && (
        <button onClick={onAction} style={{
          marginTop:14, minHeight:44, padding:'0 14px', fontSize:12, fontWeight:600, color:NAVY,
          background:'white', border:'1px solid rgba(11,31,59,0.15)', borderRadius:8, cursor:'pointer', fontFamily:'inherit',
        }}>{actionLabel}</button>
      )}
    </div>
  );
}

// Note: cityFromAddrShort is intentionally NOT exported, the smarter
// cityFromAddress lives in crm-data.js and stays the global one.
Object.assign(window, { LeftPanel, SectionHeader, EmptyState, PanelHeader, KIND_COLORS, FilterChips, contactName, TODAY, QuickQuoteModal, SearchDock, useSearchDock });
