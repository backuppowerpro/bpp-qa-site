// crm-permit-portals.jsx, 32×32 icon button with downward popover.
// Rendered inline in panel headers (e.g. Contacts) via PanelHeader's `right` slot.
//
// Source of truth is the permit_jurisdictions table (DB-backed, editable).
// Falls back to the CRM.jurisdictions JS seed if the query returns nothing
// (offline / RLS hiccup) so the popover always shows the 4 portals.

// Columns we read. Selected defensively, the live table has
// id/name/portal_url/username/password/notes/phone today; a pending
// migration adds dept_phone/county/is_city/address. We only ask for the
// confirmed columns so a missing column never errors the whole query.
const PJ_READ_COLS = 'id, name, portal_url, username, notes, password_enc';
// Free-text columns the inline editor writes directly to the table. The
// password is NOT here: it is encrypted at rest (password_enc, key in Supabase
// Vault) and written only via the set_permit_password RPC, read back on demand
// via the get_permit_password RPC. Both RPCs are granted to authenticated only.
const PJ_EDIT_COLS = ['portal_url', 'username', 'notes'];

// Ordering (Key 2026-06-25): Greenville County is BPP's home jurisdiction (most
// installs), so it pins to the TOP of the list; everything else stays
// alphabetical. Used wherever the list renders so the order is consistent.
const HOME_JURISDICTION = 'Greenville County';
function jurisdictionCmp(a, b) {
  const an = (a && a.name) || '', bn = (b && b.name) || '';
  if (an === HOME_JURISDICTION && bn !== HOME_JURISDICTION) return -1;
  if (bn === HOME_JURISDICTION && an !== HOME_JURISDICTION) return 1;
  return an.localeCompare(bn);
}

function PermitPortalsButton({ asHost = false } = {}) {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState(null); // null = not yet loaded
  const [editingId, setEditingId] = React.useState(null);
  const [adding, setAdding] = React.useState(false);
  // Per-row loading flag for the password-copy RPC: gives <100ms feedback and
  // blocks a double-tap from firing two get_permit_password round-trips.
  const [pwLoadingId, setPwLoadingId] = React.useState(null);
  // Reveal fallback for the password Copy: on iOS the clipboard write is refused
  // because the async get_permit_password RPC breaks the tap gesture, so a silent
  // copy can never work there. Rather than dead-end on "Copy failed", reveal the
  // cleartext in a tap-to-select field (auto re-masks after 30s) so Key always
  // has a path. revealId = which row is currently revealed.
  const [revealId, setRevealId] = React.useState(null);
  const [revealVal, setRevealVal] = React.useState('');
  const revealTimer = React.useRef(null);
  const wrapRef = React.useRef(null);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 480;

  // Normalize a DB row or a seed row into the shape the popover renders.
  const norm = (r) => ({
    id: r.id,
    name: r.name || '',
    portal_url: r.portal_url || '',
    username: r.username || '',
    // password is never read into the browser; we only track whether one
    // exists (ciphertext present) and fetch the cleartext on demand via RPC.
    has_password: !!r.password_enc || !!r.password,
    notes: r.notes || '',
  });

  const loadRows = React.useCallback(async () => {
    const seed = (window.CRM?.jurisdictions || []).map(norm).sort(jurisdictionCmp);
    if (!window.CRM?.__db) { setRows(seed); return; }
    try {
      const { data, error } = await window.CRM.__db
        .from('permit_jurisdictions')
        .select(PJ_READ_COLS)
        .order('name', { ascending: true });
      if (error || !data || data.length === 0) { setRows(seed); return; }
      setRows(data.map(norm).sort(jurisdictionCmp));
    } catch {
      setRows(seed);
    }
  }, []);

  // Host mode (Key 2026-06-19): when mounted at app root as `asHost`, this
  // instance has no trigger pill and opens on the tab-bar long-press of the
  // Contacts icon (the 'crm-tab-hold' permits event).
  React.useEffect(() => {
    if (!asHost) return;
    const onHold = e => { if (e.detail?.action === 'permits') setOpen(true); };
    window.addEventListener('crm-tab-hold', onHold);
    return () => window.removeEventListener('crm-tab-hold', onHold);
  }, [asHost]);

  React.useEffect(() => {
    if (!open) return;
    if (rows === null) loadRows();
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, rows, loadRows]);

  const copy = async (text, label) => {
    try {
      const ok = await window.copyText(text);
      window.showToast?.(ok ? label + ' copied' : 'Copy failed');
    } catch {
      window.showToast?.('Copy failed');
    }
  };

  // Persist edits to the four free-text fields. Optimistic update + revert
  // on error, same pattern as the permit/installer save flows.
  const saveEdit = async (id, patch) => {
    // Split the password out of the table patch: it is encrypted-at-rest and
    // only the set_permit_password RPC may write it. A blank password means
    // "leave the current one unchanged" (so editing notes never wipes a pw).
    const { password: newPw, ...tablePatch } = patch;
    const pwChanged = typeof newPw === 'string' && newPw.length > 0;
    const prev = rows;
    const next = rows.map(r => r.id === id ? { ...r, ...tablePatch, ...(pwChanged ? { has_password: true } : {}) } : r);
    setRows(next);
    setEditingId(null);
    if (!window.CRM?.__db) { window.showToast?.('Supabase not loaded, not saved'); return; }
    const { error } = await window.CRM.__db
      .from('permit_jurisdictions')
      .update(tablePatch)
      .eq('id', id);
    if (error) {
      setRows(prev);
      window.showToast?.('Save failed: ' + error.message);
      return;
    }
    if (pwChanged) {
      const { error: pwErr } = await window.CRM.__db.rpc('set_permit_password', { p_id: id, p_password: newPw });
      if (pwErr) {
        setRows(prev);
        window.showToast?.('Password save failed: ' + pwErr.message);
        return;
      }
    }
    window.showToast?.('Jurisdiction updated');
  };

  // Insert a new jurisdiction row.
  const addJurisdiction = async (fields) => {
    if (!fields.name) { window.showToast?.('Name is required'); return; }
    if (!window.CRM?.__db) { window.showToast?.('Supabase not loaded, not saved'); return; }
    const insertRow = { name: fields.name };
    PJ_EDIT_COLS.forEach(c => { if (fields[c]) insertRow[c] = fields[c]; });
    const { data, error } = await window.CRM.__db
      .from('permit_jurisdictions')
      .insert(insertRow)
      .select(PJ_READ_COLS)
      .single();
    if (error) { window.showToast?.('Add failed: ' + error.message); return; }
    // Password (if provided) goes through the encrypting RPC, never the table.
    let added = norm(data);
    if (fields.password && String(fields.password).length > 0) {
      const { error: pwErr } = await window.CRM.__db.rpc('set_permit_password', { p_id: data.id, p_password: fields.password });
      if (pwErr) { window.showToast?.('Added, but password save failed: ' + pwErr.message); }
      else added = { ...added, has_password: true };
    }
    setRows([...(rows || []), added].sort(jurisdictionCmp));
    setAdding(false);
    window.showToast?.('Jurisdiction added');
  };

  // Courthouse icon, 3 vertical pillars + roof line + base, navy stroke 1.5
  const courthouseIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5 L8 2 L14 5" />
      <line x1="2" y1="13.5" x2="14" y2="13.5" />
      <line x1="4.5" y1="6" x2="4.5" y2="13" />
      <line x1="8" y1="6" x2="8" y2="13" />
      <line x1="11.5" y1="6" x2="11.5" y2="13" />
    </svg>
  );

  return (
    <div ref={wrapRef} style={{ position:'relative' }}>
      {/* Trigger pill, only when NOT in host mode (host opens via the tab-bar
          long-press of the Contacts icon). */}
      {!asHost && (
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Permit portals"
        title="Permit portals"
        style={{
          flex:'0 0 auto', height:44, padding:'0 10px', borderRadius:100,
          background: open ? '#F0F4FF' : 'white',
          border:'1px solid #e5e5e5',
          cursor:'pointer',
          display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap',
          fontSize:13, fontWeight:600, color:'#5a6478', fontFamily:'inherit',
          transition:'border-color 180ms cubic-bezier(0.16,1,0.3,1), color 180ms cubic-bezier(0.16,1,0.3,1)',
          WebkitTapHighlightColor:'transparent',
        }}
      >
        Permits
      </button>
      )}

      {open && (
        <div style={(isMobile || asHost) ? {
          // Mobile: full-screen-width drawer, mirroring the Subs popover. The
          // mobile-panel ancestor has `transform`, which makes it the containing
          // block for position:fixed, so we anchor with vw width + left (never
          // right:N, which would track the 200%-wide swiping parent).
          position:'fixed',
          top:'calc(env(safe-area-inset-top) + 96px)',
          left:8,
          width:'calc(100vw - 16px)',
          background:'white',
          border:'1px solid rgba(27,43,75,0.12)',
          borderRadius:12,
          boxShadow:'0 12px 32px rgba(27,43,75,0.22)',
          padding:14, zIndex:50,
          maxHeight:'calc(var(--vvh, 100vh) - 96px - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px)',
          overflowY:'auto',
        } : {
          position:'absolute', right:0, top:'calc(100% + 6px)',
          width:280,
          background:'white',
          border:'1px solid rgba(27,43,75,0.12)',
          borderRadius:12,
          boxShadow:'0 8px 24px rgba(27,43,75,0.16)',
          padding:14, zIndex:50,
          maxHeight:'70vh', overflowY:'auto',
        }}>
          <div style={{ fontSize:13, fontWeight:600, color:NAVY, marginBottom:10 }}>Permit portals</div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {rows === null ? (
              <div style={{ fontSize:12, color:'#999' }}>Loading…</div>
            ) : rows.length === 0 ? (
              <div style={{ fontSize:12, color:'#999', lineHeight:1.4 }}>No permit portals yet. Add one below.</div>
            ) : rows.map((j, i) => (
              editingId === j.id ? (
                <JurisdictionEditRow
                  key={j.id}
                  row={j}
                  topBorder={i > 0}
                  onSave={patch => saveEdit(j.id, patch)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div key={j.id} style={{ paddingTop: i ? 12 : 0, borderTop: i ? '1px solid rgba(27,43,75,0.06)' : 'none', display:'flex', flexDirection:'column', gap:6 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:13, fontWeight:500, color:NAVY, flex:1, minWidth:0 }}>{j.name}</span>
                    <button
                      onClick={() => setEditingId(j.id)}
                      style={{ background:'white', border:'1px solid rgba(27,43,75,0.15)', borderRadius:4, minHeight:44, padding:'0 12px', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:500, color:NAVY, fontFamily:'inherit', cursor:'pointer' }}
                    >Edit</button>
                    <button
                      onClick={() => window.open(j.portal_url, '_blank', 'noopener,noreferrer,width=1024,height=768')}
                      disabled={!j.portal_url}
                      style={{ background:j.portal_url?GOLD:'#E5E5E5', color:j.portal_url?NAVY:'#999', border:'none', borderRadius:4, minHeight:44, padding:'0 14px', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:600, fontFamily:'inherit', cursor:j.portal_url?'pointer':'not-allowed' }}
                    >Open</button>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:12, fontWeight:600, color:'#999', textTransform:'uppercase', letterSpacing:'0.05em', width:30 }}>User</span>
                    <span style={{ fontFamily:'DM Mono, monospace', fontSize:12, color:NAVY, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{j.username || 'Not set'}</span>
                    <button
                      onClick={() => copy(j.username, 'Username')}
                      disabled={!j.username}
                      style={{ background:'white', border:'1px solid rgba(27,43,75,0.15)', borderRadius:4, minHeight:44, padding:'0 12px', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:500, color:j.username?NAVY:'#999', fontFamily:'inherit', cursor:j.username?'pointer':'not-allowed' }}
                    >Copy</button>
                  </div>
                  {/* Password row: the password now lives in the DB row, so we
                      offer a real Copy-password button. The clipboard never
                      renders the value on screen, Copy puts it straight on the
                      clipboard so it is not shoulder-surfed. */}
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:12, fontWeight:600, color:'#999', textTransform:'uppercase', letterSpacing:'0.05em', width:30 }}>Pwd</span>
                    {revealId === j.id ? (
                      <span
                        onClick={(e) => {
                          try {
                            const r = document.createRange(); r.selectNodeContents(e.currentTarget);
                            const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
                          } catch {}
                        }}
                        title="Tap to select, then use the Copy that appears"
                        style={{ fontFamily:'DM Mono, monospace', fontSize:12, color:NAVY, flex:1, minWidth:0, userSelect:'all', WebkitUserSelect:'all', cursor:'text', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                      >{revealVal}</span>
                    ) : (
                      <span style={{ fontFamily:'DM Mono, monospace', fontSize:12, color:'#999', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{j.has_password ? '••••••••' : 'not set'}</span>
                    )}
                    <button
                      onClick={async () => {
                        if (pwLoadingId) return;
                        if (!window.CRM?.__db) { window.showToast?.('Supabase not loaded'); return; }
                        setPwLoadingId(j.id);
                        try {
                          const { data, error } = await window.CRM.__db.rpc('get_permit_password', { p_id: j.id });
                          if (error || data == null || data === '') { window.showToast?.('Could not load password'); return; }
                          const ok = await window.copyText(String(data));
                          if (ok) {
                            window.showToast?.('Password copied');
                            setRevealId(null); setRevealVal('');
                          } else {
                            // iOS refuses the clipboard write here because the async RPC
                            // above broke the tap gesture. No dead end: reveal the cleartext
                            // in a tap-to-select field so Key can copy it via the native
                            // callout. Auto re-masks after 30s.
                            setRevealId(j.id); setRevealVal(String(data));
                            window.showToast?.('Tap the password to select, then Copy');
                            if (revealTimer.current) clearTimeout(revealTimer.current);
                            revealTimer.current = setTimeout(() => { setRevealId(null); setRevealVal(''); }, 30000);
                          }
                        } finally {
                          setPwLoadingId(null);
                        }
                      }}
                      disabled={!j.has_password || pwLoadingId === j.id}
                      style={{ background:'white', border:'1px solid rgba(27,43,75,0.15)', borderRadius:4, minHeight:44, padding:'0 12px', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:500, color:j.has_password?NAVY:'#999', fontFamily:'inherit', cursor:j.has_password?'pointer':'not-allowed' }}
                    >{pwLoadingId === j.id ? '…' : 'Copy'}</button>
                  </div>
                  {j.notes && (
                    <div style={{ fontSize:11, color:'#666', lineHeight:1.4 }}>{j.notes}</div>
                  )}
                </div>
              )
            ))}
          </div>

          {/* Add-jurisdiction affordance, dashed button matching the
              "+ Add permit" button in PermitsCard. */}
          {rows !== null && (adding ? (
            <JurisdictionEditRow
              row={{ name:'', portal_url:'', username:'', password:'', notes:'' }}
              topBorder={true}
              isNew={true}
              onSave={fields => addJurisdiction(fields)}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button onClick={() => setAdding(true)} style={{
              marginTop:12, width:'100%', height:44, borderRadius:6,
              background:'white', border:'1px dashed rgba(27,43,75,0.25)',
              color:NAVY, fontSize:13, fontWeight:500, fontFamily:'inherit', cursor:'pointer',
            }}>+ Add jurisdiction</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline edit form for one jurisdiction row (or a new one when isNew).
// Reuses the input style from InstallerAssignmentRow (height 38, 1.5px
// #EBEBEA border, radius 6, fontSize 16) and the gold/ghost button styles
// from the permit status actions.
function JurisdictionEditRow({ row, topBorder, isNew, onSave, onCancel }) {
  const [name, setName] = React.useState(row.name || '');
  const [portalUrl, setPortalUrl] = React.useState(row.portal_url || '');
  const [username, setUsername] = React.useState(row.username || '');
  const [password, setPassword] = React.useState(row.password || '');
  const [notes, setNotes] = React.useState(row.notes || '');

  const inputStyle = {
    width:'100%', height:44, padding:'0 10px', border:'1.5px solid #EBEBEA',
    borderRadius:6, fontSize:16, color:NAVY, fontFamily:'inherit', outline:'none', boxSizing:'border-box',
  };
  const labelStyle = { fontSize:12, fontWeight:600, color:'#999', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:3, display:'block' };

  const submit = () => {
    const patch = { portal_url: portalUrl.trim(), username: username.trim(), password: password, notes: notes.trim() };
    if (isNew) onSave({ name: name.trim(), ...patch });
    else onSave(patch);
  };

  return (
    <div style={{ paddingTop: topBorder ? 12 : 0, marginTop: topBorder ? 12 : 0, borderTop: topBorder ? '1px solid rgba(27,43,75,0.06)' : 'none', display:'flex', flexDirection:'column', gap:8 }}>
      {isNew ? (
        <div>
          <span style={labelStyle}>Name</span>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Jurisdiction name" style={inputStyle} />
        </div>
      ) : (
        <span style={{ fontSize:13, fontWeight:600, color:NAVY }}>{row.name}</span>
      )}
      <div>
        <span style={labelStyle}>Portal URL</span>
        <input value={portalUrl} onChange={e=>setPortalUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
      </div>
      <div>
        <span style={labelStyle}>Username</span>
        <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Username" style={inputStyle} />
      </div>
      <div>
        <span style={labelStyle}>Password</span>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" style={inputStyle} />
      </div>
      <div>
        <span style={labelStyle}>Notes</span>
        <input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notes" style={inputStyle} />
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={submit} style={{ flex:1, height:44, background:GOLD, color:NAVY, border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Save</button>
        <button onClick={onCancel} style={{ flex:1, height:44, background:'white', color:NAVY, border:'1px solid rgba(27,43,75,0.15)', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
      </div>
    </div>
  );
}

// Contact-scoped portal (Key 2026-06-26): same portal access as the global picker
// above, but pinned to ONE jurisdiction inside a contact's permit section (the
// global picker stays). Reuses the identical Open + username/password-copy +
// iOS reveal-fallback mechanics. Opening it logs a permit_portal_visit , the
// recency signal so a permit email arriving soon after suggests this contact.
function ContactJurisdictionPortal({ contactId, jurisdictionName }) {
  const [row, setRow] = React.useState(undefined); // undefined=loading, null=none
  const [reveal, setReveal] = React.useState(false);
  const [revealVal, setRevealVal] = React.useState('');
  const [pwLoading, setPwLoading] = React.useState(false);
  const revealTimer = React.useRef(null);
  const name = (jurisdictionName || '').trim();

  React.useEffect(() => {
    let alive = true;
    setReveal(false); setRevealVal('');
    if (!name) { setRow(null); return; }
    (async () => {
      const seed = (window.CRM?.jurisdictions || []).find(r => (r.name || '') === name);
      const fromSeed = seed ? { id: seed.id, name, portal_url: seed.portal_url || '', username: seed.username || '', has_password: !!seed.password_enc || !!seed.password, notes: seed.notes || '' } : null;
      if (!window.CRM?.__db) { if (alive) setRow(fromSeed); return; }
      try {
        const { data } = await window.CRM.__db.from('permit_jurisdictions')
          .select('id, name, portal_url, username, notes, password_enc').eq('name', name).maybeSingle();
        if (!alive) return;
        setRow(data ? { id: data.id, name: data.name || name, portal_url: data.portal_url || '', username: data.username || '', has_password: !!data.password_enc, notes: data.notes || '' } : fromSeed);
      } catch { if (alive) setRow(fromSeed); }
    })();
    return () => { alive = false; if (revealTimer.current) clearTimeout(revealTimer.current); };
  }, [name]);

  if (!name || row === null) return null;

  const openPortal = () => {
    // window.open MUST be synchronous in the click (popup blockers); fire the
    // recency-log RPC right after (fire-and-forget, never blocks the open).
    if (row?.portal_url) window.open(row.portal_url, '_blank', 'noopener,noreferrer,width=1024,height=768');
    try { window.CRM?.__db?.rpc('permit_log_portal_visit', { p_contact_id: contactId, p_jurisdiction: name }); } catch {}
  };
  const copyUser = async () => {
    try { const ok = await window.copyText(row.username); window.showToast?.(ok ? 'Username copied' : 'Copy failed'); }
    catch { window.showToast?.('Copy failed'); }
  };
  const copyPw = async () => {
    if (pwLoading || !row?.id || !window.CRM?.__db) return;
    setPwLoading(true);
    try {
      const { data, error } = await window.CRM.__db.rpc('get_permit_password', { p_id: row.id });
      if (error || data == null || data === '') { window.showToast?.('Could not load password'); return; }
      const ok = await window.copyText(String(data));
      if (ok) { window.showToast?.('Password copied'); setReveal(false); setRevealVal(''); }
      else {
        setReveal(true); setRevealVal(String(data));
        window.showToast?.('Tap the password to select, then Copy');
        if (revealTimer.current) clearTimeout(revealTimer.current);
        revealTimer.current = setTimeout(() => { setReveal(false); setRevealVal(''); }, 30000);
      }
    } finally { setPwLoading(false); }
  };

  const ghost = { background:'white', border:'1px solid rgba(27,43,75,0.15)', borderRadius:4, minHeight:44, padding:'0 12px', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:500, fontFamily:'inherit' };
  const lbl = { fontSize:12, fontWeight:600, color:'#999', textTransform:'uppercase', letterSpacing:'0.05em', width:30 };

  return (
    <div style={{ background:'#f8f8f6', border:'1px solid rgba(27,43,75,0.08)', borderRadius:8, padding:10, marginBottom:12, display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ ...lbl, width:'auto' }}>Portal</span>
        <span style={{ fontSize:13, fontWeight:600, color:NAVY, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
        <button onClick={openPortal} disabled={!row?.portal_url}
          style={{ background:row?.portal_url?GOLD:'#E5E5E5', color:row?.portal_url?NAVY:'#999', border:'none', borderRadius:4, minHeight:44, padding:'0 14px', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:600, fontFamily:'inherit', cursor:row?.portal_url?'pointer':'not-allowed' }}>Open</button>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={lbl}>User</span>
        <span style={{ fontFamily:'DM Mono, monospace', fontSize:12, color:NAVY, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row?.username || 'Not set'}</span>
        <button onClick={copyUser} disabled={!row?.username} style={{ ...ghost, color:row?.username?NAVY:'#999', cursor:row?.username?'pointer':'not-allowed' }}>Copy</button>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={lbl}>Pwd</span>
        {reveal ? (
          <span onClick={(e)=>{ try { const r=document.createRange(); r.selectNodeContents(e.currentTarget); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch{} }}
            title="Tap to select, then Copy"
            style={{ fontFamily:'DM Mono, monospace', fontSize:12, color:NAVY, flex:1, minWidth:0, userSelect:'all', WebkitUserSelect:'all', cursor:'text', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{revealVal}</span>
        ) : (
          <span style={{ fontFamily:'DM Mono, monospace', fontSize:12, color:'#999', flex:1, minWidth:0 }}>{row?.has_password ? '••••••••' : 'not set'}</span>
        )}
        <button onClick={copyPw} disabled={!row?.has_password || pwLoading} style={{ ...ghost, color:row?.has_password?NAVY:'#999', cursor:row?.has_password?'pointer':'not-allowed' }}>{pwLoading ? '…' : 'Copy'}</button>
      </div>
      {row?.notes && <div style={{ fontSize:11, color:'#666', lineHeight:1.4 }}>{row.notes}</div>}
    </div>
  );
}

Object.assign(window, { PermitPortalsButton, ContactJurisdictionPortal });
