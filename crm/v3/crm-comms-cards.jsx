/* =============================================================================
   COMMS CARDS , contact-page AI additions (comms platform Phase 5, 2026-06-10)
   Mapped from the approved Claude Design comp `contact-additions.html`
   (validated by Key 2026-06-10: "the claude designs look great").
   Three cards, registered in crm-cards.js:
     1. AISummaryCard      , contacts.ai_summary, the bot's living setup note
     2. CustomerPhotosCard , contact_photos (texted-in MMS images)
     3. AISuggestionsCard  , contact_field_provenance pending suggestions
        (applied=false, undone_at null). Confirm writes the field + applied=true;
        Dismiss sets undone_at. Address is the primary confirm-only case.
   Provenance note: card chrome (radius/shadow/spacing) reuses the existing
   approved card primitives; the gold AI badge, tinted suggestion panel, photo
   grid + caption overlay come from the comp. One naming deviation, the comp's
   "Photos" header renders as "Customer photos" because the contact panel
   already has a job-photos card titled Photos (sibling-name collision).
   ============================================================================= */

const COMMS_GOLD_BG   = '#FFF7E0';
const COMMS_GOLD_EDGE = '#F5E3A8';
const COMMS_GOLD_INK  = '#8A6D1A';

// Relative "Updated Xm ago" label. Coarse on purpose; matches the comp copy.
function commsAgoLabel(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'Updated just now';
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Updated ${hrs}h ago`;
  return `Updated ${Math.round(hrs / 24)}d ago`;
}

// Small gold "AI" eyebrow badge from the comp (used by summary + suggestions).
function CommsAiBadge({ label }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4,
      background:COMMS_GOLD_BG, border:`1px solid ${COMMS_GOLD_EDGE}`, color:COMMS_GOLD_INK,
      fontSize:12, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase',
      borderRadius:6, padding:'3px 8px',
    }}>
      <span aria-hidden="true">&#10022;</span>{label}
    </span>
  );
}

// 1 ── AI SUMMARY ─────────────────────────────────────────────────────────────
// The enrichment bot's living note (contacts.ai_summary). Renders nothing when
// the bot has not written one yet; never confused with Key's manual notes.
function AISummaryCard({ contact }) {
  if (!contact || !contact.ai_summary) return null;
  return (
    <div style={{ marginTop:12, background:'#fff', border:0, borderRadius:16, padding:'14px 16px', boxShadow:'inset 0 0 0 1px rgba(27,43,75,0.085)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <CommsAiBadge label="AI summary" />
        <span style={{ fontSize:11, color:'#9CA3AF' }}>{commsAgoLabel(contact.ai_summary_updated_at)}</span>
      </div>
      <div style={{ fontSize:13, color:'#374151', lineHeight:1.55 }}>{contact.ai_summary}</div>
    </div>
  );
}

// 2 ── CUSTOMER PHOTOS ────────────────────────────────────────────────────────
// Scheme-guard for texted-in media URLs: only https: may reach href/img src, so a
// malformed or hostile contact_photos.url (javascript:/data:) can never execute.
function safeMediaUrl(u) {
  if (typeof u !== 'string') return null;
  try { const parsed = new URL(u, window.location.origin); return parsed.protocol === 'https:' ? parsed.href : null; }
  catch (_) { return null; }
}

// Texted-in MMS images (contact_photos, auto-attached by twilio-webhook).
function CustomerPhotosCard({ contact, bare = false }) {
  const [photos, setPhotos] = React.useState(null);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    let dead = false;
    setPhotos(null);
    if (!contact?.id) { setPhotos([]); return; }
    CRM.__db.from('contact_photos')
      .select('id, url, caption, created_at')
      .eq('contact_id', contact.id)
      .order('created_at', { ascending: false })
      .limit(60)
      .then(({ data, error }) => {
        if (dead) return;
        if (error) { console.error('[customer-photos] fetch failed:', error.message); setPhotos([]); return; }
        setPhotos(data || []);
      });
    return () => { dead = true; };
  }, [contact?.id]);

  if (!photos || photos.length === 0) return null;
  const shown = expanded ? photos : photos.slice(0, 9);

  // CRM revamp 2026-06-10 (B3): in `bare` mode render as a sub-section of the
  // merged Media card (a muted "Customer photos" sub-label + its own top
  // divider, no standalone card chrome). The divider lives here so it only
  // appears when there ARE customer photos (we already returned null above
  // when empty), never as an orphaned gap under Job photos.
  const containerStyle = bare
    ? { marginTop:16, paddingTop:14, borderTop:'1px solid rgba(11,31,59,0.08)' }
    : { marginTop:12, background:'#fff', border:0, borderRadius:16, padding:'14px 16px', boxShadow:'inset 0 0 0 1px rgba(27,43,75,0.085)' };
  return (
    <div style={containerStyle}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
        <span style={bare
          ? { fontSize:11, fontWeight:600, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'0.05em' }
          : { fontSize:13, fontWeight:700, color:'#1B2B4B' }}>Customer photos</span>
        <span style={{ fontSize:11, fontWeight:700, color:'#6B7280', background:'#F4F6F9', borderRadius:10, padding:'1px 8px' }}>{photos.length}</span>
        {photos.length > 9 && (
          <button onClick={() => setExpanded(!expanded)} style={{ marginLeft:'auto', background:'none', border:'none', color:'#6B7280', fontSize:12, cursor:'pointer', minHeight:44, padding:'6px 4px', fontFamily:'inherit' }}>
            {expanded ? 'Show less' : 'View all'}
          </button>
        )}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
        {shown.map(p => {
          const safe = safeMediaUrl(p.url);
          if (!safe) return null;
          return (
          <a key={p.id} href={safe} target="_blank" rel="noopener noreferrer"
             style={{ position:'relative', display:'block', aspectRatio:'1', borderRadius:10, overflow:'hidden', background:'#F4F6F9' }}>
            <img src={safe} alt={p.caption || 'Customer photo'} loading="lazy"
                 style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
            {p.caption && (
              <span style={{ position:'absolute', left:0, right:0, bottom:0, fontSize:12, color:'#fff', background:'rgba(27,43,75,.55)', padding:'3px 6px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {p.caption}
              </span>
            )}
          </a>
          );
        })}
      </div>
    </div>
  );
}

// 3 ── AI SUGGESTIONS ─────────────────────────────────────────────────────────
// Pending enrichment suggestions awaiting Key's one-tap confirm. The trust
// model lives here: address is NEVER auto-applied, so this card is where it
// gets confirmed. The field whitelist mirrors contact-enrich exactly.
const COMMS_SUGGEST_FIELDS = {
  address:            'Address',
  email:              'Email',
  panel_location:     'Panel location',
  amperage:           'Amperage',
  availability_notes: 'Availability',
  generator:          'Generator',
};

function AISuggestionsCard({ contact, bumpData }) {
  const [rows, setRows] = React.useState(null);
  const [openId, setOpenId] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  // Monotonic request seq: a slow response for contact A must never land
  // after a faster one for contact B (the card instance persists across
  // contact switches; without this, A's suggestions rendered on B's page
  // and Confirm could write A's value onto B, review 2026-06-10).
  const reqSeq = React.useRef(0);
  const load = React.useCallback(() => {
    const seq = ++reqSeq.current;
    setRows(null);
    if (!contact?.id) { setRows([]); return; }
    CRM.__db.from('contact_field_provenance')
      .select('id, field, value, confidence, created_at')
      .eq('contact_id', contact.id)
      .eq('applied', false)
      .is('undone_at', null)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (seq !== reqSeq.current) return;
        if (error) { console.error('[ai-suggestions] fetch failed:', error.message); setRows([]); return; }
        // Address first (the confirm-only, money-critical field), then the rest
        // newest-first; same-timestamp inserts otherwise order nondeterministically.
        const prio = { address: 0 };
        const list = (data || []).filter(r => COMMS_SUGGEST_FIELDS[r.field]);
        list.sort((a, b) => ((prio[a.field] ?? 1) - (prio[b.field] ?? 1)) || (new Date(b.created_at) - new Date(a.created_at)));
        setRows(list);
      });
  }, [contact?.id]);

  React.useEffect(() => { load(); }, [load]);

  // Keep the latest load in a ref so a delayed Dismiss-toast Undo (which can
  // fire AFTER the operator switched contacts) refreshes the CURRENTLY viewed
  // contact's card, never repainting the prior contact's suggestions onto it
  // (the same cross-contact bleed reqSeq guards, reached here via the toast
  // closure capturing the dismiss-time load; audit 2026-06-23 round 2). The
  // DB un-dismiss still targets the row id, so the undo itself stays correct.
  const liveLoadRef = React.useRef(load);
  React.useEffect(() => { liveLoadRef.current = load; });

  if (!rows || rows.length === 0) return null;
  const primary = rows[0];
  const rest = rows.slice(1);
  const dateLabel = (iso) => {
    const d = new Date(iso);
    return `from the ${d.toLocaleDateString('en-US', { month:'short', day:'numeric' })} conversation`;
  };

  async function confirm(row) {
    if (busy) return;
    // Defense-in-depth: never write a non-whitelisted column even if a poisoned
    // provenance.field slipped the render filter. The contacts UPDATE policy is
    // authenticate-only (not column-scoped), so a crafted field could otherwise
    // reach stripe_* / do_not_contact. Mirror the render whitelist exactly.
    if (!COMMS_SUGGEST_FIELDS[row.field]) { console.warn('[ai-suggestions] blocked non-whitelisted confirm field:', row.field); return; }
    setBusy(true);
    try {
      const { error: cErr } = await CRM.__db.from('contacts')
        .update({ [row.field]: row.value }).eq('id', contact.id);
      // Write failures were silent (audit 2026-06-10): a failed confirm left
      // the suggestion on screen with the field unwritten and zero signal,
      // worst on address, the money-critical confirm-only field.
      if (cErr) { console.error('[ai-suggestions] confirm failed:', cErr.message); window.showToast?.('Could not save: ' + cErr.message, { kind: 'error' }); return; }
      // Optimistically reflect the confirmed value in the in-memory contact so its
      // display row updates INSTANTLY on bumpData (matches the stage-advance
      // pattern), instead of only after the realtime contacts refetch. Without
      // this AND a display row for the field, a confirmed value (e.g. panel
      // location) saved into the DB and showed nowhere, so Confirm read as broken.
      try { contact[row.field] = row.value; } catch (_) {}
      const { error: pErr } = await CRM.__db.from('contact_field_provenance')
        .update({ applied: true }).eq('id', row.id);
      if (pErr) { console.error('[ai-suggestions] applied-flag update failed:', pErr.message); window.showToast?.('Saved, but the suggestion did not clear. Refresh if it lingers.', { kind: 'error' }); return; }
      // Confirm and Dismiss both make the row vanish; without a toast they look
      // identical (saved vs discarded). Name the outcome so the field that was
      // written is unambiguous, critical on the address (money/scope) field.
      window.showToast?.('Saved ' + COMMS_SUGGEST_FIELDS[row.field]);
      load();
      bumpData?.();
    } finally { setBusy(false); }
  }

  // Inverse of dismiss(): re-surface a dismissed suggestion (soft, reversible).
  async function undismiss(row) {
    const { error } = await CRM.__db.from('contact_field_provenance')
      .update({ undone_at: null }).eq('id', row.id);
    if (error) { console.error('[ai-suggestions] undismiss failed:', error.message); window.showToast?.('Could not undo: ' + error.message, { kind: 'error' }); return; }
    // Refresh the CURRENT contact's card via the live ref, not the load this
    // closure captured at dismiss time (which may belong to a now-switched-away
    // contact). The un-dismissed row reappears when the operator returns to it.
    (liveLoadRef.current || load)();
  }

  async function dismiss(row) {
    if (busy) return;
    setBusy(true);
    try {
      const { error: dErr } = await CRM.__db.from('contact_field_provenance')
        .update({ undone_at: new Date().toISOString() }).eq('id', row.id);
      if (dErr) { console.error('[ai-suggestions] dismiss failed:', dErr.message); window.showToast?.('Could not save: ' + dErr.message, { kind: 'error' }); return; }
      load();
      window.showToast?.('Dismissed ' + COMMS_SUGGEST_FIELDS[row.field], { undo: () => undismiss(row) });
    } finally { setBusy(false); }
  }

  // isPrimary gates the gold fill: only the leading suggestion gets the gold
  // Confirm; an expanded rest-row (which renders through this same fn) gets a
  // navy outline so two gold Confirms never paint at once.
  const renderSuggestion = (row, isPrimary) => (
    <div key={row.id} style={{ background:COMMS_GOLD_BG, border:`1px solid ${COMMS_GOLD_EDGE}`, borderRadius:10, padding:'10px 12px', marginTop:8 }}>
      <div style={{ fontSize:13, color:'#374151' }}>
        <span style={{ fontWeight:700, color:'#1B2B4B' }}>{COMMS_SUGGEST_FIELDS[row.field]}:</span> {row.value}
        {/* Confidence surfaced (contact-page v2) so a guess reads as a guess , the
            enrichment is a suggestion, not a confirmed fact. */}
        {row.confidence != null && (
          <span style={{ marginLeft:8, fontFamily:"'JetBrains Mono', monospace", fontSize:11, fontWeight:600, color:COMMS_GOLD_INK, whiteSpace:'nowrap' }}>
            {Math.round(row.confidence <= 1 ? row.confidence * 100 : row.confidence)}% conf
          </span>
        )}
      </div>
      <div style={{ fontSize:11, fontStyle:'italic', color:COMMS_GOLD_INK, marginTop:3 }}>{dateLabel(row.created_at)}</div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:9 }}>
        {/* AIS-4: this confirm writes a money/scope field (e.g. address), so the
            in-flight window names itself (Saving…) + reads as not-actionable
            (not-allowed cursor) instead of just dimming, matching the SendButton
            convention. */}
        <button onClick={() => confirm(row)} disabled={busy} aria-busy={busy ? true : undefined}
          style={{ ...(isPrimary ? { background:'#FFBA00', border:'none', color:'#1B2B4B' } : { background:'transparent', border:'1px solid #1B2B4B', color:'#1B2B4B' }), borderRadius:8, fontWeight:700, fontSize:12, padding:'9px 16px', minHeight:44, cursor: busy ? 'not-allowed' : 'pointer', fontFamily:'inherit', opacity: busy ? .6 : 1 }}>
          {busy ? 'Saving…' : '✓ Confirm'}
        </button>
        <button onClick={() => dismiss(row)} disabled={busy}
          style={{ background:'none', border:'none', color:'#6B7280', fontSize:12, fontWeight:600, cursor: busy ? 'not-allowed' : 'pointer', minHeight:44, padding:'9px 6px', fontFamily:'inherit', opacity: busy ? .6 : 1 }}>
          Dismiss
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ marginTop:12, background:'#fff', border:0, borderRadius:16, padding:'14px 16px', boxShadow:'inset 0 0 0 1px rgba(27,43,75,0.085)' }}>
      <CommsAiBadge label="AI suggestion" />
      {/* R2 (contact-page v2): the Confirm is ALWAYS navy-outline (isPrimary false)
          , gold is reserved for the DO NEXT primary action on the page, so the
          enrichment Confirm never competes for the single gold. */}
      {renderSuggestion(primary, false)}
      {rest.map(row => (
        openId === row.id ? (
          // AIS-1: the expand action now has an inverse (Show less), so a row
          // opened just to read it can be re-collapsed instead of being stuck.
          <div key={row.id}>
            {renderSuggestion(row, false)}
            <button onClick={() => setOpenId(null)} aria-label="Collapse suggestion"
              style={{ background:'none', border:'none', color:'#6B7280', fontSize:11, fontWeight:600, cursor:'pointer', padding:'0 2px', fontFamily:'inherit', minHeight:44, display:'inline-flex', alignItems:'center' }}>
              Show less
            </button>
          </div>
        ) : (
          // AIS-2: announce the collapsed state + name the control. AIS-3: a
          // title so a desktop hover reveals a clipped value without expanding.
          <button key={row.id} onClick={() => setOpenId(row.id)} aria-expanded={false}
            aria-label={`Show ${COMMS_SUGGEST_FIELDS[row.field]} suggestion`}
            style={{ width:'100%', display:'flex', alignItems:'center', gap:8, background:'none', border:'none', borderTop:'1px solid #F3F4F6', marginTop:10, minHeight:44, padding:'10px 2px 4px', cursor:'pointer', fontFamily:'inherit', textAlign:'left' }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:'#FFBA00', flexShrink:0 }} />
            <span title={`${COMMS_SUGGEST_FIELDS[row.field]}: ${row.value}`} style={{ fontSize:12, color:'#374151', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              <span style={{ fontWeight:600 }}>{COMMS_SUGGEST_FIELDS[row.field]}:</span> {row.value}
            </span>
            <span style={{ color:'#9CA3AF', fontSize:12 }}>&#9662;</span>
          </button>
        )
      ))}
    </div>
  );
}

window.AISummaryCard = AISummaryCard;
window.CustomerPhotosCard = CustomerPhotosCard;
window.AISuggestionsCard = AISuggestionsCard;
