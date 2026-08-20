/* =============================================================================
   BPP VOICE , browser calling for the CRM (comms platform Phase 5, 2026-06-10)
   Twilio Voice SDK 2.18.3 (vendored at vendor/twilio-voice-sdk-2.18.3.min.js,
   global window.Twilio). Token from the twilio-token edge fn; TwiML app routes
   outbound via twilio-voice (dual-channel recorded, logged to calls, then
   Gemini-transcribed + summarized automatically).

   CALL HUD (2026-06-10, per Key's standing design+implement CRM permission):
   the string-concat innerHTML banner is replaced by a React-rendered HUD in
   the v3 design language (navy call card, gold accept, danger hang-up,
   JetBrains Mono tabular timer, 44px targets, reduced-motion honored).
   React escapes all interpolated text, so the stored-XSS class the old esc()
   guarded (names from the public lead form) is handled by the renderer
   itself. Call/device logic below is UNCHANGED; only the surface moved.
   States: incoming (name + number + Accept + Send to phone), in-call
   (pulsing red dot + name + mm:ss + Mute/Unmute + Hang up). Render-preview
   hook: window.BPPVoice.__previewHUD('incoming'|'incall'|null) exercises the
   states without a live call (design QA; harmless in prod, renders only).
   ============================================================================= */

(function () {
  const V = (window.BPPVoice = window.BPPVoice || {});
  const BROWSER_OUTBOUND_CALLS_RELEASED = false;
  V.outboundReleased = BROWSER_OUTBOUND_CALLS_RELEASED;
  let device = null;
  let activeCall = null;
  let registerPromise = null;
  // Re-render hook for the live call's HUD, set by wireCall, cleared by its
  // terminal handlers. Lets the incoming-call banner hand the screen back to
  // a still-live call after a decline/cancel (second-call guard, 2026-06-10).
  let restoreInCallHUD = null;

  // ── Call HUD (React-rendered, fixed top center) ───────────────────────────
  const HUD_NAVY = '#1B2B4B', HUD_GOLD = '#ffba00', HUD_DANGER = '#EF4444';

  // mm:ss ticker as its own component: only this text node re-renders each
  // second, so Mute/Hang-up button nodes are never destroyed mid-tap (the
  // innerHTML rebuild used to swallow taps that straddled a tick).
  function HudTimer({ startedAt }) {
    const [, force] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => {
      const t = setInterval(force, 1000);
      return () => clearInterval(t);
    }, []);
    const elapsed = Math.max(0, Date.now() - startedAt);
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    return (
      <span style={{ fontFamily: "'JetBrains Mono','DM Mono',monospace", fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
        {mins}:{String(secs).padStart(2, '0')}
      </span>
    );
  }

  function hudBtn(primaryBg, fg, extra = {}) {
    return {
      minHeight: 44, minWidth: 44, padding: '0 16px', borderRadius: 10,
      background: primaryBg, color: fg, border: 'none',
      fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      whiteSpace: 'nowrap', flexShrink: 0,
      ...extra,
    };
  }

  // CM-21 in-call DTMF keypad (Claude Design comp eb4ed14c, gate-passed). The
  // familiar phone-keypad letter sublabels mirror the CRM dialer (crm-app.jsx).
  const KEY_LETTERS = { '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ' };

  // Expanded in-call panel: a bottom sheet that lets Key punch an IVR phone
  // tree mid-call. Additive , Mute + Hang up stay reachable here too, and
  // "Hide" returns to the compact top banner. Reuses the dialer key visual
  // (white key face, navy digit, grey letter sublabel, reserved baseline so
  // every numeral shares one phone-keypad baseline).
  function CallKeypadSheet({ s }) {
    const sheetRef = React.useRef(null);
    // HUD-2: Esc closes the keypad sheet (back to the compact banner) without
    // touching the call, matching the dialog affordance. Scoped to while the
    // sheet is mounted (it only renders when keypadOpen is true).
    React.useEffect(() => {
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); s.onToggleKeypad && s.onToggleKeypad(); } };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [s]);
    // HUD-3: move focus INTO the sheet (role="dialog") on open so keyboard and
    // screen-reader users land in it and Tab cycles the keys + controls. Mount-
    // only ([]), so the per-second HudTimer re-render can never steal focus back
    // to the page. (Restore-focus-to-opener on close is banked: the "Keypad"
    // button unmounts when this sheet replaces the compact banner, so the return
    // target needs a CallHUD-level ref + a real-device call test.)
    React.useEffect(() => {
      const t = setTimeout(() => { if (sheetRef.current) sheetRef.current.focus(); }, 0);
      return () => clearTimeout(t);
    }, []);
    return (
      <div ref={sheetRef} tabIndex={-1} role="dialog" aria-label="In-call keypad" className="bpp-sheet-in" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: HUD_NAVY, color: '#fff', borderRadius: '16px 16px 0 0',
        boxShadow: '0 -12px 40px rgba(11,31,59,.4)', maxWidth: 480, margin: '0 auto',
        padding: '10px 16px calc(env(safe-area-inset-bottom, 0px) + 14px)',
        fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
      }}>
        <div aria-hidden="true" style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.25)', margin: '2px auto 12px' }} />
        {/* header: live dot + name + timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span aria-hidden="true" className="bpp-hud-pulse" style={{ width: 9, height: 9, borderRadius: '50%', background: HUD_DANGER, flexShrink: 0 }} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span title={s.name} style={{ display: 'block', fontWeight: 700, fontSize: 14, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
            <span style={{ display: 'block', fontSize: 12, opacity: 0.7 }}>On call</span>
          </span>
          <span aria-hidden="true" style={{ flexShrink: 0 }}><HudTimer startedAt={s.startedAt} /></span>
          <span style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>Call in progress, keypad open</span>
        </div>
        {/* tone display: digits sent so far (mono, right-aligned) + backspace */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, minHeight: 40, borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', padding: '0 14px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontFamily: "'JetBrains Mono','DM Mono',monospace", fontSize: 18, letterSpacing: '2px', minWidth: 0, overflow: 'hidden' }}>
            <span aria-live="polite" style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{s.dialedDigits || ''}</span>
          </div>
          <button onClick={s.onBackspace} aria-label="Backspace" disabled={!s.dialedDigits} style={{ width: 48, minHeight: 44, borderRadius: 10, border: 'none', background: '#33415C', color: s.dialedDigits ? '#fff' : 'rgba(255,255,255,0.4)', cursor: s.dialedDigits ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
          </button>
        </div>
        {/* 3x4 DTMF grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
          {['1','2','3','4','5','6','7','8','9','*','0','#'].map(k => (
            <button key={k} onClick={() => s.onKey(k)} aria-label={`Send ${k}`}
              style={{ minHeight: 52, borderRadius: 10, border: 'none', background: '#fff', color: HUD_NAVY, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, lineHeight: 1 }}>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{k}</span>
              <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.8px', color: '#4B5563', visibility: KEY_LETTERS[k] ? 'visible' : 'hidden' }}>{KEY_LETTERS[k] || ' '}</span>
            </button>
          ))}
        </div>
        {/* Mute (neutral) | Hide (neutral) | Hang up (the one danger control) */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={s.onMute} aria-pressed={!!s.muted} style={{ ...hudBtn(s.muted ? '#fff' : '#33415C', s.muted ? HUD_NAVY : '#fff'), flex: 1 }}>{s.muted ? 'Unmute' : 'Mute'}</button>
          <button onClick={s.onToggleKeypad} style={{ ...hudBtn('#33415C', '#fff'), flex: 1 }}>Hide</button>
          <button onClick={s.onHang} style={{ ...hudBtn(HUD_DANGER, '#fff'), flex: 1 }}>Hang up</button>
        </div>
      </div>
    );
  }

  function CallHUD({ s }) {
    if (!s) return null;
    const isIncoming = s.mode === 'incoming';
    // CM-21: in-call with the keypad open -> the expanded bottom sheet REPLACES
    // the compact top banner (so the HUD is never duplicated). Never on the ring.
    if (!isIncoming && s.keypadOpen) return <CallKeypadSheet s={s} />;
    // role="alert" only for the incoming ring (a real interruption worth
    // announcing). The in-call HUD is role="status": with alert, the ticking
    // timer re-announced the whole HUD to screen readers every second for
    // the entire call (audit 2026-06-10). The timer itself is aria-hidden;
    // a visually-hidden static label announces the call state once.
    return (
      <div role={isIncoming ? 'alert' : 'status'} className="bpp-hud-in" style={{
        position: 'fixed', top: 'max(12px, env(safe-area-inset-top))', left: '50%', transform: 'translateX(-50%)',
        zIndex: 9999, background: HUD_NAVY, color: '#fff', borderRadius: 14,
        boxShadow: '0 12px 32px rgba(11,31,59,.35)', padding: '12px 14px',
        fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 14,
        maxWidth: '94vw', boxSizing: 'border-box',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {isIncoming ? (
            <span aria-hidden="true" className="bpp-hud-pulse" style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,186,0,0.16)', border: `1.5px solid ${HUD_GOLD}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={HUD_GOLD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            </span>
          ) : (
            <span aria-hidden="true" className="bpp-hud-pulse" style={{ width: 9, height: 9, borderRadius: '50%', background: HUD_DANGER, flexShrink: 0 }} />
          )}
          <span style={{ minWidth: 0 }}>
            <span title={s.name} style={{ display: 'block', fontWeight: 700, fontSize: 14, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{s.name}</span>
            {isIncoming ? (
              s.number ? <span style={{ display: 'block', fontSize: 12, opacity: 0.7, fontFamily: "'JetBrains Mono','DM Mono',monospace" }}>{s.number}</span> : null
            ) : (
              <>
                <span aria-hidden="true"><HudTimer startedAt={s.startedAt} /></span>
                <span style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>Call in progress</span>
              </>
            )}
          </span>
        </span>
        {isIncoming ? (
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <button onClick={s.onAccept} style={hudBtn(HUD_GOLD, HUD_NAVY)}>Accept</button>
            <button onClick={s.onDecline} style={hudBtn('transparent', '#fff', { border: '1px solid rgba(255,255,255,0.35)' })}>Send to phone</button>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <button onClick={s.onToggleKeypad} aria-label="Open keypad" style={hudBtn('#33415C', '#fff', { padding: '0 12px' })}>Keypad</button>
            <button onClick={s.onMute} aria-pressed={!!s.muted} style={hudBtn(s.muted ? '#fff' : '#33415C', s.muted ? HUD_NAVY : '#fff', { padding: '0 12px', minWidth: 80 })}>{s.muted ? 'Unmute' : 'Mute'}</button>
            <button onClick={s.onHang} style={hudBtn(HUD_DANGER, '#fff', { padding: '0 12px' })}>Hang up</button>
          </span>
        )}
      </div>
    );
  }

  let hudRoot = null;
  function renderHUD(state) {
    if (!hudRoot) {
      const host = document.createElement('div');
      host.id = 'bpp-voice-hud';
      document.body.appendChild(host);
      // Gentle 2s pulse on the incoming ring / live dot; stilled entirely
      // under prefers-reduced-motion.
      const style = document.createElement('style');
      style.textContent =
        '@keyframes bppHudPulse{0%,100%{opacity:1}50%{opacity:.45}}' +
        '.bpp-hud-pulse{animation:bppHudPulse 2s ease-in-out infinite}' +
        // CM-29: the HUD slides + fades in once when it first appears. The container
        // centers via translateX(-50%), so EVERY keyframe keeps the -50% or centering
        // would break mid-animation (an opacity-only path is the safe fallback).
        '@keyframes bppHudIn{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}' +
        '.bpp-hud-in{animation:bppHudIn 240ms cubic-bezier(0.2,0.8,0.3,1) both}' +
        // CM-21: the in-call keypad sheet slides up from the bottom edge. It is
        // NOT translateX(-50%) centered (it spans the width), so it needs its own
        // translateY keyframe; reusing bppHudIn would shove it 50% off-screen.
        '@keyframes bppSheetIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}' +
        '.bpp-sheet-in{animation:bppSheetIn 200ms cubic-bezier(0.2,0.8,0.3,1) both}' +
        '@media (prefers-reduced-motion: reduce){.bpp-hud-pulse,.bpp-hud-in,.bpp-sheet-in{animation:none}}';
      document.head.appendChild(style);
      hudRoot = ReactDOM.createRoot(host);
    }
    hudRoot.render(<CallHUD s={state} />);
  }
  function banner(state) { renderHUD(state); }

  // Render-only preview of the HUD states for design QA without a live call.
  V.__previewHUD = function (mode) {
    if (mode === 'incoming') {
      renderHUD({ mode: 'incoming', name: 'Preview Caller', number: '(864) 555-0123', onAccept: () => {}, onDecline: () => V.__previewHUD(null) });
    } else if (mode === 'incall') {
      // Interactive preview closure so the CM-21 keypad is fully testable
      // without a live call: toggle, key taps (no real sendDigits), backspace.
      let pMuted = false, pKeypadOpen = false, pDigits = '';
      const draw = () => renderHUD({
        mode: 'incall', name: 'Preview Caller', startedAt: Date.now() - 65000,
        muted: pMuted, keypadOpen: pKeypadOpen, dialedDigits: pDigits,
        onMute: () => { pMuted = !pMuted; draw(); },
        onHang: () => V.__previewHUD(null),
        onToggleKeypad: () => { pKeypadOpen = !pKeypadOpen; draw(); },
        onKey: (k) => { pDigits = (pDigits + k).slice(-20); draw(); },
        onBackspace: () => { pDigits = pDigits.slice(0, -1); draw(); },
      });
      draw();
    } else {
      renderHUD(null);
    }
  };

  async function fetchToken() {
    const r = await window.CRM.__invokeFn('twilio-token', {
      action: 'register_browser_inbound',
    });
    const tok = r?.token || r?.data?.token;
    if (!tok) throw new Error('no token in twilio-token response');
    return tok;
  }

  function contactLabel(phone) {
    const d = String(phone || '').replace(/\D/g, '').slice(-10);
    const c = (window.CRM.contacts || []).find(x => String(x.phone || '').replace(/\D/g, '').slice(-10) === d);
    return c ? c.name : (window.formatPhone ? formatPhone(phone) : phone);
  }

  function wireCall(call, label, direction) {
    activeCall = call;
    const started = Date.now();
    let muted = false;
    let keypadOpen = false;   // CM-21: expanded DTMF keypad sheet open?
    let dialedDigits = '';    // CM-21: tones sent this call (tone display, last 20)
    // The HUD's timer ticks inside its own React component, so the
    // Mute/Hang-up nodes are never destroyed mid-tap (the old innerHTML
    // rebuild swallowed taps that straddled a tick, review 2026-06-10).
    function inCallUI() {
      banner({
        mode: 'incall', name: label, startedAt: started, muted, keypadOpen, dialedDigits,
        onMute: () => { muted = !muted; call.mute(muted); inCallUI(); },
        onHang: () => call.disconnect(),
        onToggleKeypad: () => { keypadOpen = !keypadOpen; inCallUI(); },
        // CM-21: play the DTMF tone down the live call, then mirror it in the
        // tone display. sendDigits is wrapped so a tone failure never breaks
        // the call or blanks the HUD.
        onKey: (k) => { try { call.sendDigits(k); } catch (e) { console.warn('[bpp-voice] sendDigits failed:', e); } dialedDigits = (dialedDigits + k).slice(-20); inCallUI(); },
        onBackspace: () => { dialedDigits = dialedDigits.slice(0, -1); inCallUI(); },
      });
    }
    restoreInCallHUD = inCallUI;
    call.on('accept', inCallUI);
    // Terminal handlers only clear the shared state when it still belongs to
    // THIS call object, so a stray event from an old or second call can never
    // blank the HUD of the live one (second-call guard, audit 2026-06-10).
    call.on('disconnect', () => { if (activeCall === call) { activeCall = null; restoreInCallHUD = null; banner(null); } });
    call.on('cancel', () => { if (activeCall === call) { activeCall = null; restoreInCallHUD = null; banner(null); } });
    call.on('error', (e) => { console.error('[bpp-voice] call error:', e); if (activeCall === call) { activeCall = null; restoreInCallHUD = null; banner(null); window.showToast?.('Call dropped, try again.'); } });
    if (direction === 'out') inCallUI();
  }

  // Lazily create + register the Device. Must be called from a user gesture
  // the first time (mic permission prompt). Safe to call repeatedly.
  V.ensureDevice = async function () {
    if (device) return device;
    // Concurrent callers share the in-flight registration instead of getting
    // null (which sent the second caller to the tel: fallback mid-register).
    if (registerPromise) return registerPromise;
    registerPromise = (async () => {
      let d = null;
      try {
        if (!window.Twilio || !window.Twilio.Device) throw new Error('Voice SDK not loaded');
        const token = await fetchToken();
        d = new Twilio.Device(token, { logLevel: 'error' });
        d.on('tokenWillExpire', async () => {
          // One retry after 5s: a single transient edge-fn blip used to kill
          // incoming calls for the rest of the session.
          try { d.updateToken(await fetchToken()); return; }
          catch (e) { console.warn('[bpp-voice] token refresh failed, retrying in 5s:', e.message); }
          setTimeout(async () => {
            try { d.updateToken(await fetchToken()); }
            catch (e) { console.error('[bpp-voice] token refresh retry failed:', e); }
          }, 5000);
        });
        d.on('error', (e) => console.error('[bpp-voice] device error:', e));
        d.on('incoming', (call) => {
          const from = call.parameters?.From || '';
          const label = contactLabel(from);
          banner({
            mode: 'incoming', name: label,
            number: window.formatPhone ? formatPhone(from) : from,
            onAccept: () => {
              // Second-call guard: accepting while another call is live would
              // overwrite the shared HUD/activeCall state and cross the legs.
              if (activeCall) { window.showToast?.('Already on a call. Hang up before accepting.'); return; }
              call.accept(); wireCall(call, label, 'in');
            },
            // Decline lets the TwiML action fall through to Key's cell, honest copy.
            // If a call is already live, hand the screen back to its HUD
            // instead of blanking it.
            // CM-12: name the result so "Send to phone" gives feedback within ~100ms
            // (the TwiML action falls through to Key's cell on reject).
            onDecline: () => { call.reject(); window.showToast?.('Ringing your cell'); if (activeCall && restoreInCallHUD) restoreInCallHUD(); else banner(null); },
          });
          call.on('cancel', () => { if (activeCall && restoreInCallHUD) restoreInCallHUD(); else banner(null); });
        });
        await d.register();
        console.log('[bpp-voice] device registered for incoming calls');
        device = d;
        return d;
      } catch (e) {
        console.warn('[bpp-voice] inbound device registration failed:', e.message);
        // Release the half-built Device so a later retry starts clean.
        try { d?.destroy?.(); } catch (_) { /* already dead */ }
        device = null;
        return null;
      } finally {
        registerPromise = null;
      }
    })();
    return registerPromise;
  };

  // Place an outbound browser call. Returns true if the browser leg started,
  // false if the caller should fall back to tel:. DNC is gated by the caller.
  V.call = async function (e164, label) {
    if (!BROWSER_OUTBOUND_CALLS_RELEASED) {
      window.showToast?.('Calling is not released yet.');
      return false;
    }
    // Second-call guard (audit 2026-06-10): placing a call while one is live
    // crossed the shared HUD/activeCall state. Return true (handled), NOT
    // false: false sends the caller to the tel: fallback, which would place
    // the second call anyway through the phone app.
    if (activeCall) {
      window.showToast?.('Already on a call. Hang up before placing another.');
      return true;
    }
    const d = await V.ensureDevice();
    if (!d) return false;
    try {
      const call = await d.connect({ params: { To: e164 } });
      wireCall(call, label || contactLabel(e164), 'out');
      return true;
    } catch (e) {
      console.error('[bpp-voice] connect failed:', e);
      return false;
    }
  };

  V.isActive = () => !!activeCall;
})();
