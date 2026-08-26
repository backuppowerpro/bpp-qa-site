// crm-shared.jsx, primitives, icons, nav bar
// Exports: NavBar, TabIcon, ContactAvatar, StatusPill, GoldDot, fmt

import {
  fetchOperatorPropertyImage,
  isCompletePropertyAddress,
  propertyImageIdentity,
} from '../v3-app/src/property-image.js';

// Haptic feedback, routed through the Capacitor native bridge on iOS (real
// Taptic Engine) with a navigator.vibrate fallback for the web/PWA. iOS
// WKWebView ignores navigator.vibrate entirely, so on-device the old calls
// were dead; window.BPP.native.haptics (Phase 2 bridge) is the real thing.
// kind: 'selection' (light tick) | 'light' | 'medium' | 'heavy'.
window.bppHaptic = function (kind) {
  try {
    if (window.BPP && window.BPP.native && window.BPP.native.isNative) {
      if (kind === 'selection') window.BPP.native.haptics.selection();
      else window.BPP.native.haptics.impact(kind || 'light');
      return;
    }
    if (navigator.vibrate) navigator.vibrate(kind === 'medium' ? 12 : kind === 'heavy' ? 18 : 8);
  } catch (_) { /* no-op */ }
};

const NAVY = '#1B2B4B';
// Brand gold per CLAUDE.md, same #ffba00 used on backuppowerpro.com.
// Was '#C9A048' (muted olive) which read sickly next to other yellow
// buttons that hardcoded the brand value.
const GOLD = '#ffba00';

// Corner-radius scale, every rounded surface in the app picks from this
// set so visual rhythm stays consistent. Anti-pattern: ad-hoc 5/7/9/14
// values that creep in over time.
const RADIUS = {
  xs: 4,    // tiny chips, tooltip arrows, kbd
  sm: 6,    // small ghost buttons, tag/kind chips
  md: 8,    // primary cards, buttons, inputs (most common)
  lg: 12,   // modals (desktop), hero cards
  xl: 16,   // bottom-sheet modals (mobile)
  pill: 20, // pills, status chips, FilterChips
  full: 9999, // avatars, dots, circular buttons
};
// Elevation scale, soft navy-tinted shadows. One token set so depth stays
// consistent instead of ad-hoc boxShadow literals (939 inline styles) creeping
// apart. Foundation for the visual-elevation revamp (Key 2026-06-04). Additive:
// nothing changes until a surface consumes these.
const SHADOW = {
  sm:   '0 1px 2px rgba(11,31,59,0.06), 0 1px 3px rgba(11,31,59,0.10)',
  md:   '0 4px 12px rgba(11,31,59,0.10)',
  lg:   '0 8px 24px rgba(11,31,59,0.16)',
  xl:   '0 20px 60px rgba(11,31,59,0.25)',     // modals / bottom sheets
  gold: '0 4px 16px rgba(255,186,0,0.45)',    // gold action buttons (#ffba00 brand gold, was olive #C9A048)
};
// Spacing scale (px). Same idea as RADIUS: one rhythm, no ad-hoc 5/7/9/14 gaps.
const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };
const BG   = '#F8F8F6';
const CARD = '#FFFFFF';
// Gray-500, 4.69:1 on white, passes WCAG AA for body text (was #8892A0
// at 3.15:1 which failed). Used pervasively for timestamps, eyebrow
// labels, address subtitles, FilterChip counts, etc, all communicate
// real info, so AA matters even for "muted" text.
const MUTED = '#4B5563'; // gray-600 (was gray-500 #6B7280). Darkened 2026-05-28 for
                         // bright-sun field readability: ~7:1 on white vs ~4.8:1,
                         // still clearly below NAVY in the hierarchy. One token = every
                         // muted label across the CRM gets more legible outdoors.

function fmt(obj) {
  if (!obj) return {};
  Object.assign(window, { NAVY, GOLD, BG, CARD, MUTED });
  return obj;
}

// ── SVG Icons ────────────────────────────────────────────────────
const Icons = {
  contacts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  ),
  calendar: (
    // Heroicons solid calendar, a SINGLE filled path. No strokes, no
    // intersections, no anti-aliased overlap brightening anywhere.
    // Previous attempts with stroked outlines + filled tabs all had some
    // version of the lighter-pixel artifact Key kept flagging. Going
    // fully filled kills the entire class of bug.
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M6.75 2.25A.75.75 0 0 1 7.5 3v1.5h9V3a.75.75 0 0 1 1.5 0v1.5h.75a3 3 0 0 1 3 3v11.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3H6V3a.75.75 0 0 1 .75-.75Zm13.5 9a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z"/>
    </svg>
  ),
  finance: (
    // Single combined path so the vertical $ stem and the S-curve render
    // as one stroke pass, no anti-aliased intersection brightening.
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  messages: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  calls: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.04 12.04 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.272.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"/>
    </svg>
  ),
  subs: (
    // Hard hat, the subcontractor / installer glyph. Four stroked subpaths:
    // a flat brim (bottom), the center ridge cap, and two side arcs forming the
    // dome. The brim + ridge are what make it read as a hard hat and not a dome
    // at 22px (the prior single-arc version looked like an umbrella). Key chose
    // this one, 2026-07-04. Rendered + compared against 3 alternatives at true
    // nav size before shipping.
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 18.5a1 1 0 0 0 1 1h17a1 1 0 0 0 1-1v-1.6a1 1 0 0 0-1-1h-17a1 1 0 0 0-1 1z"/>
      <path d="M10 10.2V5.4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4.8"/>
      <path d="M4.4 15.9v-3.4a6 6 0 0 1 6-6"/>
      <path d="M13.6 6.5a6 6 0 0 1 6 6v3.4"/>
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  ),
  search: (
    // Geometrically balanced, circle at (10.5, 10.5) and handle to
    // (19, 19) so the visual center of mass falls at (12, 12), the
    // exact midpoint of the 24×24 viewBox. Asymmetric original (cx=11,
    // handle to 21,21) rendered visibly above-left of the input baseline.
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10.5" cy="10.5" r="7"/><path d="m19 19-4.35-4.35"/>
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
  ),
  sparky: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  ),
  plus: (
    // Filled rects so the center crossing is a solid pixel, not a lighter
    // anti-aliased overlap.
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="11" y="5" width="2" height="14" rx="1"/>
      <rect x="5" y="11" width="14" height="2" rx="1"/>
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="m22 2-11 11"/>
    </svg>
  ),
  voicemail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="11.5" r="4.5"/><circle cx="18.5" cy="11.5" r="4.5"/><path d="M5.5 16h13"/>
    </svg>
  ),
  hash: (
    // Filled rects (not strokes) so the four bar intersections render solid
    // pixels instead of lighter anti-aliased overlaps.
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="9" y="3" width="2" height="18" rx="0.5"/>
      <rect x="14" y="3" width="2" height="18" rx="0.5"/>
      <rect x="3" y="9" width="18" height="2" rx="0.5"/>
      <rect x="3" y="14" width="18" height="2" rx="0.5"/>
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  ),
  zap: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  ),
};

// ── Top Nav Bar ───────────────────────────────────────────────────
// Long-press secondary actions on the tab bar (Key 2026-06-19): holding a tab
// icon opens a tool, Contacts->Permits, Money->Quick Quote, Calendar->Subs. Tap
// is unchanged (switch tab / refresh the active one). A quiet resting dot under
// the holdable icons is the discoverability signifier (so the hold is NOT a
// hidden gesture); a >10px move cancels (a scroll that starts on an icon never
// fires); on desktop a right-click is the accelerator. The action is dispatched
// as a window CustomEvent the app-root hosts listen for, so it works from any
// tab. Messages + Calls have no holdAction (tap-only). Decisions + adversarial
// critique: workflow wf_af35b51c-9e8.
const NAV_HOLD_ACTION = { contacts: 'permits', messages: 'compose', finance: 'quickquote', calendar: 'subs', calls: 'dialpad' };
const NAV_HOLD_LABEL = { permits: 'permits', compose: 'a new text', quickquote: 'quick quote', subs: 'subs', dialpad: 'the dial pad' };
function NavTabButton({ t, active, badge, onClick, holdAction }) {
  const ref = React.useRef({ timer: null, fired: false, x: 0, y: 0 });
  const [holding, setHolding] = React.useState(false);
  const HOLD_MS = 450;
  const dispatchHold = () => {
    window.bppHaptic && window.bppHaptic('selection');
    window.dispatchEvent(new CustomEvent('crm-tab-hold', { detail: { action: holdAction } }));
  };
  const cancel = () => { if (ref.current.timer) { clearTimeout(ref.current.timer); ref.current.timer = null; } setHolding(false); };
  const onPointerDown = (e) => {
    if (!holdAction) return;
    ref.current.fired = false; ref.current.x = e.clientX; ref.current.y = e.clientY;
    setHolding(true);
    ref.current.timer = setTimeout(() => { ref.current.timer = null; ref.current.fired = true; setHolding(false); dispatchHold(); }, HOLD_MS);
  };
  const onPointerMove = (e) => {
    if (!ref.current.timer) return;
    if (Math.abs(e.clientX - ref.current.x) > 10 || Math.abs(e.clientY - ref.current.y) > 10) cancel();
  };
  // Suppress the tap that follows a fired hold so a long-press does NOT also
  // switch/refresh the tab.
  const click = (e) => { if (ref.current.fired) { ref.current.fired = false; return; } onClick(e); };
  const onContextMenu = (e) => { if (holdAction) { e.preventDefault(); dispatchHold(); } };
  const label = (active ? `${t} (tap to refresh)` : t) + (holdAction ? `, hold for ${NAV_HOLD_LABEL[holdAction] || 'more'}` : '');
  return (
    <button onClick={click}
      onPointerDown={onPointerDown} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onPointerMove={onPointerMove}
      onContextMenu={onContextMenu}
      aria-label={label} title={active ? 'Refresh' : null}
      style={{
        background: active ? 'rgba(255,255,255,0.12)' : 'none', border: 'none',
        color: active ? 'white' : 'rgba(255,255,255,0.5)',
        width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', borderRadius: 8, position: 'relative', flexShrink: 0,
        transform: holding ? 'scale(0.86)' : 'none', transition: 'transform 120ms ease',
        touchAction: 'manipulation', WebkitTouchCallout: 'none', userSelect: 'none', WebkitUserSelect: 'none',
      }}>
      <div style={{ width: 22, height: 22 }}>{Icons[t]}</div>
      {badge > 0 && (() => {
        const lbl = badge > 99 ? '99+' : String(badge);
        const wide = lbl.length >= 2;
        return (<div style={{ position: 'absolute', top: 6, right: 6, background: '#dc2626', color: 'white', minWidth: 16, height: 16, padding: wide ? '0 4px' : 0, borderRadius: wide ? 8 : '50%', fontSize: wide ? 10 : 11, fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${NAVY}`, fontVariantNumeric: 'tabular-nums' }}>{lbl}</div>);
      })()}
      {/* No resting dot (Key 2026-06-19, "i dont like the dots below the tabs").
          The hold stays discoverable to assistive tech via the aria-label. */}
    </button>
  );
}

function NavBar({ tab, onTab, onDoubleTab, showBack, onBack, badgeCounts = {}, compact, contextLabel, enableHold, includeSubs }) {
  // Tab order, Key 2026-05-08: Contact → Messages → Finance → Calendar → Phone.
  // Reasoning: contact info is the entry point, then conversation
  // (most-used surface), then money, then schedule, then calls. Old
  // ordering put Calendar second which de-prioritized messaging.
  // includeSubs (Key 2026-07-04): the operator-only Subs command center used to be
  // hidden behind the Calendar long-press; Key wants it as a visible tab. Appended
  // (keeps the existing 5's muscle-memory positions) and ONLY on the left/operator
  // nav (the right/contact nav never passes includeSubs, since Subs is left-pane only).
  const tabs = includeSubs
    ? ['contacts','messages','finance','calendar','calls','subs']
    : ['contacts','messages','finance','calendar','calls'];
  // Double-tap detection for the mobile "jump to this tab's main section"
  // gesture (Key 2026-06-23). Per-NavBar ref; it survives the double because
  // neither single tap swaps the pane (an inactive tap switches the sub-tab, an
  // active tap refreshes), so both taps land on the same NavBar instance. Only
  // the mobile navbars pass onDoubleTab, so desktop is untouched.
  const lastTap = React.useRef({ t: null, at: 0 });
  return (
    <div style={{
      background: NAVY,
      display: 'flex',
      alignItems: 'center',
      // Add iOS safe-area top inset so the notch / Dynamic Island doesn't
      // overlap tab buttons when standalone PWA + viewport-fit=cover.
      // height stays 'auto' since paddingTop pushes the row down.
      minHeight: compact ? 52 : 60,
      padding: '0 4px',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      flexShrink: 0,
      gap: 0,
      flexDirection: 'column',
      justifyContent: 'flex-end',
    }}>
      {contextLabel && (
        <div style={{
          width: '100%',
          textAlign: 'center',
          fontSize: 11,
          color: 'rgba(255,255,255,0.55)',
          fontWeight: 600,
          letterSpacing: '0.04em',
          paddingBottom: 2,
          paddingTop: 6,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          padding: '4px 16px 0',
        }}>{contextLabel}</div>
      )}
      <div style={{ display:'flex', alignItems:'center', width:'100%', height: 48 }}>
        {showBack ? (
          <button onClick={onBack} style={{
            background: 'none', border: 'none', color: 'white',
            width: 44, height: 44, display:'flex', alignItems:'center', justifyContent:'center',
            cursor: 'pointer', flexShrink: 0, borderRadius: 8,
          }}><div style={{ width: 22, height: 22 }}>{Icons.back}</div></button>
        ) : (
          <div style={{ width: 44, flexShrink: 0 }} />
        )}

        <div style={{ flex: 1, display:'flex', justifyContent:'center', alignItems:'center', gap: 0 }}>
          {tabs.map(t => {
            const active = tab === t;
            const badge = badgeCounts[t] || 0;
            // Re-tapping the active tab triggers a manual refetch, same
            // gesture as pull-to-refresh on mobile, but reachable on
            // desktop where there's no pull gesture. Throttled inside
            // crm-data.js by _reconcileInflight, so spam clicks are safe.
            const handleClick = async (e) => {
              // Double-tap (two taps in quick succession on the same tab) = jump
              // to this tab's MAIN list section (Key 2026-06-23). Detected before
              // the active/refetch branch so it fires even on the already-active
              // tab. Uses the event's PHYSICAL timeStamp (not Date.now) so a slow
              // re-render between the two taps cannot push the second tap out of
              // the window. Single-tap behavior (switch tab, or refresh the active
              // tab) is unchanged. Only present when onDoubleTab is passed (mobile).
              if (onDoubleTab && e) {
                const now = e.timeStamp || Date.now();
                if (lastTap.current.at > 0 && lastTap.current.t === t && (now - lastTap.current.at) < 500) {
                  lastTap.current = { t: null, at: 0 };
                  onDoubleTab(t);
                  return;
                }
                lastTap.current = { t, at: now };
              }
              if (!active) { onTab(t); return; }
              if (typeof window.CRM?.__refetch !== 'function') { onTab(t); return; }
              try {
                await window.CRM.__refetch();
                window.showToast?.('Refreshed');
              } catch (e) {
                window.showToast?.('Refresh failed');
              }
            };
            // Hold actions only on the PRIMARY nav bars (enableHold), never on
            // the contact-context bar, so opening a contact's sub-tab can't fire
            // the global tools. Desktop primary bars are `compact` but still
            // enable holds (right-click / mouse-hold).
            return (
              <NavTabButton key={t} t={t} active={active} badge={badge} onClick={handleClick}
                holdAction={enableHold ? NAV_HOLD_ACTION[t] : undefined} />
            );
          })}
        </div>

        {/* v10.1.19: tiny version badge in the right slot so Key can
            confirm at a glance which build the PWA actually loaded.
            Reads BPP_VERSION from window (set by index.html). */}
        <div style={{ width: 44, flexShrink: 0, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{
            fontSize:12, fontWeight: 600,
            color: 'rgba(255,255,255,0.7)',
            fontFamily: 'DM Mono, monospace',
            letterSpacing: '0.04em',
          }}>v{window.BPP_VERSION || '?'}</span>
        </div>
      </div>
    </div>
  );
}

// ── iOS Phase 1 shell primitives ─────────────────────────────────
// Key directive 2026-07-09: turn the CRM into a native-iOS-feeling app.
// The shell is: bottom floating pill tab bar (navy glass, 5 tabs) + a
// large-title header per tab + an iOS-style top nav bar for the pushed
// contact detail + an iOS segmented control for the Comms tab. The
// visual target is docs/redesign-comps/ios-nav-shell.html. HIG numbers
// live in docs/ios-app/HIG-SPEC.md; the CSS class recipes for
// `.bpp-glass`, `.bpp-tabbar`, `.bpp-lg-*`, `.bpp-segmented`, and
// `.bpp-ios-navbar*` live in the head <style> block of index.html.

// The 5 primary tabs in the new shell. Order: Contacts -> Comms ->
// Finance -> Calendar -> Subs (Key, 2026-07-09). Merges the old
// Messages + Calls into a single Comms tab, and drops the tab count
// from 6 to 5 to meet HIG's "five or fewer" default.
// Finance is no longer a primary tab (Key 2026-07-10): money is handled
// per-client (the detail-context search bubble becomes a Finance bubble),
// and the old global money view lives as finance-category SEARCH FILTERS
// (Outstanding / Overdue / Unbilled / Paid) with a total at the top. So the
// bar is 4 fixed tabs + 1 detached, context-aware glass bubble (Search on a
// list, Finance on a record), matching the iOS 26 App Store layout.
// Subs merged INTO Contacts (Key 2026-07-10): the list pill is 3 tabs, and the
// Contacts tab hosts a Contacts/Subs segmented control the same way Comms hosts
// Messages/Calls. So 'subs' is no longer a bottom tab; it's a Contacts subtab.
const BOTTOM_TABS = ['contacts', 'comms', 'calendar'];
// Finance is NOT a list tab (the global money view is gone, it's filters now).
// It MERGES back into the pill only inside a record (Key 2026-07-10), where it
// means "this client's finance"; on a list the same slot separates out as the
// detached Search bubble. So its label lives here but it's appended to the pill
// only when includeFinance is set.
const BOTTOM_TAB_LABEL = {
  contacts: 'Contacts', comms: 'Comms',
  calendar: 'Calendar', subs: 'Subs', finance: 'Finance',
};
// The top Contacts/Subs + Messages/Calls toggles were removed (Key 2026-07-10);
// switching now happens by HOLDING the merged tab. With no visible toggle, the tab
// itself is the mode signifier: when a merged tab has a current subtab, its
// label + icon reflect THAT subtab (so the hidden hold-gesture has a perceivable
// resting state, and the flip is its own feedback). Umbrella label/icon is the
// fallback. Subs on the RIGHT detail pill stays a separate tab, so only 'comms'
// morphs there; 'contacts' morphs only on the left browse bar.
const SUBTAB_DISPLAY = {
  contacts: { contacts: { label: 'Contacts', icon: 'contacts' }, subs: { label: 'Subs', icon: 'subs' } },
  comms:    { messages: { label: 'Messages', icon: 'messages' }, calls: { label: 'Calls', icon: 'calls' } },
};
// Default hold-action set (fallback when a bar passes no holdMap). Every live bar
// now passes an explicit holdMap (BROWSE_HOLD / DETAIL_HOLD in crm-app), so this
// is just the safe default. Comms hold-to-compose was retired (Key 2026-07-10):
// a new text is started by making the contact first, so 'compose' is gone.
const BOTTOM_TAB_HOLD = {
  contacts: 'permits', comms: null,
  calendar: 'quickquote', subs: null,
};
const BOTTOM_TAB_HOLD_LABEL = {
  permits: 'permits', quickquote: 'quick quote',
  subs: 'subs', dialpad: 'the dial pad',
  // Hold-to-switch actions (Key 2026-07-10): hold a merged tab to flip its subtab.
  'switch-contacts': 'Contacts or Subs', 'switch-comms': 'Messages or Calls',
  'switch-comms-detail': 'Messages or Calls',
};

function BottomTab({ t, active, badge, dot, onClick, holdAction, displayLabel, displayIconKey }) {
  // Same long-press semantics as NavTabButton (450ms, 10px slop, dispatches
  // crm-tab-hold). Kept local so the pill has its own tuned press shape and
  // navy-glass color palette.
  const ref = React.useRef({ timer: null, fired: false, x: 0, y: 0 });
  const [holding, setHolding] = React.useState(false);
  const HOLD_MS = 450;
  const dispatchHold = () => {
    window.bppHaptic && window.bppHaptic('selection');
    window.dispatchEvent(new CustomEvent('crm-tab-hold', { detail: { action: holdAction } }));
  };
  const cancel = () => {
    if (ref.current.timer) { clearTimeout(ref.current.timer); ref.current.timer = null; }
    setHolding(false);
  };
  const onPointerDown = (e) => {
    if (!holdAction) return;
    ref.current.fired = false;
    ref.current.x = e.clientX; ref.current.y = e.clientY;
    setHolding(true);
    ref.current.timer = setTimeout(() => {
      ref.current.timer = null; ref.current.fired = true;
      setHolding(false); dispatchHold();
    }, HOLD_MS);
  };
  const onPointerMove = (e) => {
    if (!ref.current.timer) return;
    if (Math.abs(e.clientX - ref.current.x) > 10 || Math.abs(e.clientY - ref.current.y) > 10) cancel();
  };
  const click = (e) => {
    if (ref.current.fired) { ref.current.fired = false; return; }
    onClick(e);
  };
  const onContextMenu = (e) => { if (holdAction) { e.preventDefault(); dispatchHold(); } };
  // displayLabel / displayIconKey (Key 2026-07-10): when a merged tab has a
  // current subtab, it renders that subtab's label + icon (the mode signifier for
  // the hold-to-switch gesture). Both default to the umbrella label / tab icon.
  const label = displayLabel || BOTTOM_TAB_LABEL[t];
  const iconKey = displayIconKey || (t === 'comms' ? 'messages' : t);
  const holdSuffix = holdAction ? `, hold for ${BOTTOM_TAB_HOLD_LABEL[holdAction] || 'more'}` : '';
  const ariaLabel = `${label}${active ? ' (active)' : ''}${holdSuffix}`;
  const glyph = React.cloneElement(Icons[iconKey], {
    // Active state uses filled glyphs to match HIG "prefer filled symbols"
    // and the comp's active treatment. The base svg keeps its stroke; we
    // add a fill on the active state that only paints the currently-set
    // stroke color, which becomes gold via the .is-active parent color.
    fill: active ? 'currentColor' : (Icons[iconKey].props.fill || 'none'),
  });
  return (
    <button
      type="button"
      className={'bpp-tab' + (active ? ' is-active' : '')}
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      onClick={click}
      onPointerDown={onPointerDown}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onPointerMove={onPointerMove}
      onContextMenu={onContextMenu}
      style={holding ? { transform: 'scale(0.9)' } : undefined}
    >
      <span className="bpp-tab-glyph">{glyph}</span>
      <span className="bpp-tab-label">{label}</span>
      {badge > 0 && (
        <span className="bpp-tab-badge" aria-hidden="true">{badge > 99 ? '99+' : String(badge)}</span>
      )}
      {!badge && dot && <span className="bpp-tab-dot" aria-hidden="true" />}
    </button>
  );
}

// Search / Finance glyphs for the detached context bubble (iOS 26 App Store
// pattern). White on the navy glass so it reads as chrome, not a money primary.
const BUBBLE_GLYPH = {
  search: (
    <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="M20.5 20.5l-4.2-4.2" />
    </svg>
  ),
  finance: (
    <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="2" x2="12" y2="22" /><path d="M17 5.5H9.75a3.25 3.25 0 0 0 0 6.5h4.5a3.25 3.25 0 0 1 0 6.5H6.5" />
    </svg>
  ),
};

function BottomTabBar({ tab, onTab, onDoubleTab, badgeCounts = {}, commsUnread = false, enableHold = true, bubble = null, includeFinance = false, includeSubs = false, holdMap = null, subtabs = null, hidden = false }) {
  // Double-tap detection (Key 2026-06-23), same shape as NavBar: two taps
  // on the SAME tab within 500ms fires onDoubleTab. Kept per-instance
  // because the bar is mounted once.
  const lastTap = React.useRef({ t: null, at: 0 });
  const hasBubble = !!(bubble && bubble.mode);
  // Finance merges into the pill as a 5th tab only inside a record (Key
  // 2026-07-10); on a list the slot is the detached Search bubble instead.
  // The DETAIL pill keeps Subs as its own tab (that contact's sub/job, a
  // different thing from the left roster which merges into the Contacts toggle)
  // and Finance (that client's money). The list/browse pill has neither.
  const tabs = [...BOTTOM_TABS, ...(includeSubs ? ['subs'] : []), ...(includeFinance ? ['finance'] : [])];
  return (
    <>
    <nav className={'bpp-tabbar bpp-glass' + (hasBubble ? ' has-bubble' : '') + (hidden ? ' is-hidden' : '')} aria-label="Primary" role="tablist" aria-hidden={hidden ? 'true' : undefined}>
      {tabs.map(t => {
        const active = tab === t;
        // Comms rolls up the old Messages + Calls badge counts; Finance
        // keeps its own; Contacts + Calendar + Subs keep theirs.
        const badge = t === 'comms'
          ? ((badgeCounts.messages || 0) + (badgeCounts.calls || 0))
          : (badgeCounts[t] || 0);
        const handleClick = async (e) => {
          if (onDoubleTab && e) {
            const now = e.timeStamp || Date.now();
            if (lastTap.current.at > 0 && lastTap.current.t === t && (now - lastTap.current.at) < 500) {
              lastTap.current = { t: null, at: 0 };
              onDoubleTab(t);
              return;
            }
            lastTap.current = { t, at: now };
          }
          if (!active) { onTab(t); return; }
          // Re-tapping the active tab = manual refetch, same gesture as
          // pull-to-refresh, so users on desktop get the same escape hatch.
          if (typeof window.CRM?.__refetch !== 'function') { onTab(t); return; }
          try {
            await window.CRM.__refetch();
            window.showToast?.('Refreshed');
          } catch (err) {
            window.showToast?.('Refresh failed');
          }
        };
        // Mode signifier: if this tab has a current subtab, render that subtab's
        // label + icon (see SUBTAB_DISPLAY); else the umbrella.
        const sub = subtabs && subtabs[t];
        const disp = sub && SUBTAB_DISPLAY[t] && SUBTAB_DISPLAY[t][sub];
        return (
          <BottomTab
            key={t}
            t={t}
            active={active}
            badge={badge}
            dot={t === 'comms' && !badge && commsUnread}
            onClick={handleClick}
            holdAction={enableHold ? (holdMap || BOTTOM_TAB_HOLD)[t] : null}
            displayLabel={disp ? disp.label : undefined}
            displayIconKey={disp ? disp.icon : undefined}
          />
        );
      })}
    </nav>
    {hasBubble && (
      <button
        className={'bpp-searchbubble bpp-glass' + (bubble.mode === 'finance' ? ' is-finance' : '') + (hidden ? ' is-hidden' : '')}
        onClick={bubble.onPress}
        type="button"
        aria-label={bubble.mode === 'finance' ? 'Finances for this client' : 'Search'}
      >
        {BUBBLE_GLYPH[bubble.mode]}
      </button>
    )}
    </>
  );
}

// Large-title header. 34px/700 title collapsing to a 17px/600 centered
// inline title on scroll of the passed `scrollRef` container. `search`
// slot renders BELOW the title (Contacts tab). The collapse is a scroll
// transform, never a Norman-door tappable control per HIG.
function LargeTitleHeader({ title, scrollRef, search }) {
  const wrapRef = React.useRef(null);
  const titleRef = React.useRef(null);
  const collapsedRef = React.useRef(null);
  const searchRef = React.useRef(null);
  React.useEffect(() => {
    const container = scrollRef && scrollRef.current;
    if (!container || !titleRef.current || !collapsedRef.current) return;
    // Scroll events don't bubble, so listen on window in CAPTURE phase
    // and filter by whether the event target is inside the container.
    // That way we pick up scrolls from any nested scroll pane inside the
    // current tab body without every list needing to plumb its own ref.
    const onScroll = (e) => {
      const tgt = e.target;
      if (!tgt) return;
      // document dispatches a scroll on the document itself; skip that.
      if (tgt === document || tgt === window) return;
      if (typeof tgt.contains !== 'undefined' && !container.contains(tgt)) return;
      const y = (tgt && typeof tgt.scrollTop === 'number') ? tgt.scrollTop : 0;
      const k = Math.min(1, Math.max(0, y / 46));
      const tEl = titleRef.current;
      const cEl = collapsedRef.current;
      const sEl = searchRef.current;
      if (tEl) {
        tEl.style.opacity = String(1 - k);
        tEl.style.transform = 'scale(' + (1 - 0.18 * k) + ')';
      }
      if (cEl) {
        cEl.style.opacity = String(k);
        cEl.style.transform = 'translateY(' + (-4 + 4 * k) + 'px)';
      }
      if (sEl) sEl.style.opacity = String(1 - Math.min(1, y / 30));
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [scrollRef, title]);
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div className="bpp-lg-header">
        <h1 ref={titleRef} className="bpp-lg-title">{title}</h1>
        {search && <div ref={searchRef}>{search}</div>}
      </div>
      <div ref={collapsedRef} className="bpp-lg-collapsed" aria-hidden="true">{title}</div>
    </div>
  );
}

// iOS-style top nav bar (contact detail push). Back chevron on the left,
// centered title, optional star + right slot. Nothing about it moves; the
// large-title collapse pattern is for the list scrollers, not the detail.
function IosNavBar({ title, onBack, showStar, starred, onToggleStar, right }) {
  return (
    <div className="bpp-ios-navbar">
      <button className="bpp-ios-navbar-btn" onClick={onBack} aria-label="Back" type="button">
        <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <span className="bpp-ios-navbar-title">{title}</span>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {showStar && (
          <button className="bpp-ios-navbar-btn" onClick={onToggleStar}
            aria-label={starred ? 'Unstar' : 'Star'} aria-pressed={starred ? 'true' : 'false'} type="button"
            style={{ color: starred ? GOLD : '#8a93a6' }}>
            <svg viewBox="0 0 24 24" width="22" height="22"
              fill={starred ? 'currentColor' : 'none'}
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2.7 5.6 6 .8-4.4 4.2 1.1 6L12 17.9 6.6 19.6l1.1-6L3.3 9.4l6-.8z" />
            </svg>
          </button>
        )}
        {right}
      </div>
    </div>
  );
}

// iOS segmented control (used inside the Comms tab: Messages | Calls).
// `options`: [{ value, label, icon?, badge? }].
function SegmentedControl({ value, onChange, options, ariaLabel }) {
  return (
    <div className="bpp-segmented" role="tablist" aria-label={ariaLabel || 'Segmented control'}>
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value ? 'true' : 'false'}
          className={value === opt.value ? 'is-active' : ''}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon && <span style={{ display: 'inline-flex' }}>{opt.icon}</span>}
          {opt.label}
          {opt.badge > 0 && (
            <span style={{
              minWidth: 18, height: 18, padding: '0 5px',
              borderRadius: 100, background: '#ff5a52', color: '#fff',
              fontSize: 10, fontWeight: 700, lineHeight: 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginLeft: 4, fontVariantNumeric: 'tabular-nums',
            }}>{opt.badge > 99 ? '99+' : opt.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Contact Avatar and property image contract ───────────────────
// A customer's verified current-address home photo is also their profile
// picture. Initials remain the truthful fallback until protected bytes load,
// or when the address is incomplete, removed, or cannot be verified.
const isAddressableStreet = isCompletePropertyAddress;

// Curated avatar palette, Gmail/Material-style. Hand-picked rich
// 600-shade colors that all read cleanly with bold white text and avoid
// muddy or sickly tones. Hash → index keeps the same name on the same
// color across renders/sessions.
const AVATAR_PALETTE = [
  '#DC2626', // red
  '#EA580C', // orange
  '#D97706', // amber
  '#059669', // emerald
  '#0D9488', // teal
  '#0891B2', // cyan
  '#2563EB', // blue
  '#4F46E5', // indigo
  '#7C3AED', // violet
  '#9333EA', // purple
  '#DB2777', // pink
  '#E11D48', // rose
];
function colorFromString(s) {
  // FNV-1a, better distribution than `h*31+c` for short strings,
  // which clustered short first-name-only contacts on the same hue.
  const str = String(s || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function useContactPropertyImage(contact, enabled = true) {
  const contactID = contact?.id || '';
  const address = contact?.address || '';
  const eligible = enabled && isCompletePropertyAddress(address);
  const inputKey = eligible && contactID ? `${contactID}\n${address}` : null;
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState({
    status: eligible ? 'loading' : 'empty',
    url: null,
    propertyImageIdentity: null,
    inputKey,
  });

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectURL = null;
    if (!eligible || !contactID) {
      setState({ status: 'empty', url: null, propertyImageIdentity: null, inputKey: null });
      return () => controller.abort();
    }
    setState({ status: 'loading', url: null, propertyImageIdentity: null, inputKey });
    fetchOperatorPropertyImage({ contactID, address, signal: controller.signal, forceRefresh: attempt > 0 })
      .then(result => {
        if (!active) {
          if (result.url) URL.revokeObjectURL(result.url);
          return;
        }
        if (result.kind !== 'ready') {
          setState({ status: 'empty', url: null, propertyImageIdentity: result.identity, inputKey });
          return;
        }
        objectURL = result.url;
        setState({
          status: 'ready',
          url: result.url,
          propertyImageIdentity: result.identity,
          inputKey,
        });
      })
      .catch(error => {
        if (!active || error?.name === 'AbortError') return;
        setState({
          status: error?.retryable === false ? 'empty' : 'error',
          url: null,
          propertyImageIdentity: null,
          inputKey,
        });
      });
    return () => {
      active = false;
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [contactID, address, eligible, inputKey, attempt]);

  const retryPropertyImage = React.useCallback(() => setAttempt(value => value + 1), []);
  const reportPropertyImageFailure = React.useCallback(() => {
    setState(current => {
      if (current.url) URL.revokeObjectURL(current.url);
      return { status: 'error', url: null, propertyImageIdentity: null, inputKey };
    });
  }, [inputKey]);
  const currentState = state.inputKey === inputKey
    ? state
    : { status: eligible ? 'loading' : 'empty', url: null, propertyImageIdentity: null, inputKey };
  return { ...currentState, retryPropertyImage, reportPropertyImageFailure };
}

function useLazyAvatarVisibility() {
  const avatarRef = React.useRef(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const node = avatarRef.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '80px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { avatarRef, visible };
}

function ContactAvatar({ contact, size = 40, ringColor = null, lazy = true }) {
  // Defensive: contact can be null/undefined when a proposal/invoice references
  // a contact that's been archived or wasn't returned in the 500-row contacts
  // window. Show as anonymous in that case rather than crashing.
  const isAnon = !contact || !contact.name;
  const bg = isAnon ? '#E8EAF0' : colorFromString(contact.name || contact.id || 'X');
  const { avatarRef, visible } = useLazyAvatarVisibility();
  const propertyImage = useContactPropertyImage(contact, lazy ? visible : true);
  const homePhoto = propertyImage.status === 'ready' ? propertyImage.url : null;
  return (
    <div ref={avatarRef} style={{
      width: size, height: size, borderRadius: '50%',
      background: bg,
      color: isAnon ? MUTED : 'white',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
      letterSpacing: '0.02em',
      position:'relative', overflow:'hidden',
      // Multi-line messaging (2026-06-20): an optional 2px outset ring in the
      // contact's Twilio-line color (passed only from the Messaging inbox + the
      // thread header). overflow:hidden clips child imagery, NOT the box-shadow,
      // so the ring paints cleanly outside the circle. Null = no ring.
      boxShadow: ringColor
        ? `inset 0 0 0 1px rgba(0,0,0,0.05), 0 0 0 2px ${ringColor}`
        : 'inset 0 0 0 1px rgba(0,0,0,0.05)',
    }}>
      {homePhoto ? (
        <img
          src={homePhoto}
          alt=""
          loading="lazy"
          data-home-photo-avatar-identity={propertyImage.propertyImageIdentity}
          onError={propertyImage.reportPropertyImageFailure}
          style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}
        />
      ) : isAnon ? (
        <div style={{width: size*0.42, height: size*0.42}}>{Icons.hash}</div>
      ) : contact.avatar}
    </div>
  );
}

// ── Gold Dot (premium tier) ───────────────────────────────────────
function GoldDot() {
  return <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%', background: GOLD, marginRight: 5, flexShrink:0, marginTop:1 }} />;
}

// ── Status Pills ──────────────────────────────────────────────────
// DB-shape lowercase enums: proposals (draft/sent/viewed/approved/expired/declined),
// invoices (draft/sent/viewed/paid/overdue/refunded/voided), events (scheduled/done/cancelled),
// event kinds (install/inspect/follow_up/pickup/meeting).
const PILL_STYLES = {
  // Proposal statuses
  draft:      { bg:'#F3F4F6', color:'#374151' },
  sent:       { bg:'#EFF6FF', color:'#1E40AF' },
  viewed:     { bg:'#EEF2FF', color:'#3730A3' },
  approved:   { bg:'#ECFDF5', color:'#065F46' },
  expired:    { bg:'#F3F4F6', color:'#6B7280' },
  declined:   { bg:'#FEF2F2', color:'#991B1B' },
  // Invoice statuses (paid/overdue/sent shared with above)
  paid:       { bg:'#ECFDF5', color:'#065F46' },
  overdue:    { bg:'#FEF2F2', color:'#991B1B' },
  refunded:   { bg:'#F3F4F6', color:'#6B7280' },
  voided:     { bg:'#F3F4F6', color:'#6B7280' },
  // (declined is defined once above under Proposal statuses; the duplicate here was removed)
  // Event statuses. DB CHECK allows only scheduled/cancelled/completed,
  // so `completed` is the canonical done value; `done` kept as a render
  // alias for any legacy in-memory object.
  scheduled:  { bg:'#EFF6FF', color:'#1E40AF' },
  completed:  { bg:'#ECFDF5', color:'#065F46' },
  done:       { bg:'#ECFDF5', color:'#065F46' },
  cancelled:  { bg:'#FEF2F2', color:'#991B1B' },
  // Event kinds
  install:    { bg:'#F0FDF4', color:'#166534' },
  inspect:    { bg:'#F5F3FF', color:'#5B21B6' },
  follow_up:  { bg:'#FFF7ED', color:'#C2410C' },
  pickup:     { bg:'#F0FDF4', color:'#166534' },
  meeting:    { bg:'#F5F3FF', color:'#5B21B6' },
  // Misc
  today:      { bg:'#FFFBEB', color:'#92400E' },
  // Message delivery statuses (Twilio webhook). Default gray was making
  // failed messages disappear in the thread; now they stand out red.
  failed:     { bg:'#FEF2F2', color:'#991B1B' },
  undelivered:{ bg:'#FEF2F2', color:'#991B1B' },
  delivered:  { bg:'#ECFDF5', color:'#065F46' },
  read:       { bg:'#ECFDF5', color:'#065F46' },
  queued:     { bg:'#FFFBEB', color:'#92400E' },
  received:   { bg:'#EFF6FF', color:'#1E40AF' },
};

// Status → human label override map. Some DB statuses don't read well
// when capitalized verbatim ("Declined" sounds like a customer rejection,
// but in practice Key uses it to cancel a pending proposal, so we
// surface it as "Cancelled"). Used by both StatusPill (left pane) and
// the right-pane FIN_PILL so the two pane views show the SAME label
// for the same status.
const STATUS_LABELS = {
  declined: 'Cancelled',
  // Legacy v1/v2 paths write `cancelled` instead of `declined`/`voided`.
  // Render them as Cancelled so the operator sees "what they did" not
  // the underlying schema sprawl.
  cancelled: 'Cancelled',
  voided: 'Voided',
  refunded: 'Refunded',
  expired: 'Expired',
  permit_submit: 'Submitted',
  permit_waiting: 'Waiting',
  permit_approved: 'Approved',
  follow_up: 'Follow-up',
  // Message delivery, Twilio status callback updates these.
  failed: 'Send failed',
  undelivered: 'Undelivered',
  queued: 'Queued',
  delivered: 'Delivered',
};

// ── Pill, the one shared status-chip primitive ──────────────────────
// Ported from staging 2026-06-10 with geometry harmonized to the live
// StatusPill convention (11px/600, 2px 8px, radius 20) so the CRM keeps
// ONE chip system. Semantic TONE families carry hue intent; dynamic
// palettes (stage colors, message statuses) pass explicit bg/color
// which win over tone.
const PILL_TONES = {
  neutral:      { bg:'#F3F4F6', color:'#374151' },
  info:         { bg:'#DBEAFE', color:'#1E40AF' },  // viewed recently
  infoSoft:     { bg:'#DBEAFE', color:'#1E3A8A' },  // snoozed
  success:      { bg:'#D1FAE5', color:'#065F46' },  // called 24h
  warning:      { bg:'#FEF3C7', color:'#92400E' },  // stale quote / needs reply
  money:        { bg:'#FFEDD5', color:'#9A3412' },  // owed / viewed-then-cold
  danger:       { bg:'#FEE2E2', color:'#991B1B' },  // very stale quote
  dangerStrong: { bg:'#FEE2E2', color:'#7F1D1D' },  // stuck in stage
  dangerSoft:   { bg:'#FEF2F2', color:'#991B1B' },  // DNC
  special:      { bg:'#F5F3FF', color:'#5B21B6' },  // install / misc
};
function Pill({ tone, bg, color, title, children, style }) {
  const t = (bg || color)
    ? { bg: bg || '#F3F4F6', color: color || '#374151' }
    : (PILL_TONES[tone] || PILL_TONES.neutral);
  return (
    <span title={title} style={{
      display:'inline-flex', alignItems:'center', gap:3,
      background: t.bg, color: t.color,
      fontSize: 11, fontWeight: 600, lineHeight: 1.45,
      padding: '2px 8px', borderRadius: 20,
      whiteSpace:'nowrap', flexShrink:0, ...style,
    }}>{children}</span>
  );
}

function StatusPill({ status, label }) {
  // Renders through the shared Pill primitive so message-status chips share
  // the exact geometry of every other pill (one chip system, not two).
  const s = PILL_STYLES[status] || { bg:'#F3F4F6', color:'#374151' };
  return <Pill bg={s.bg} color={s.color}>{label || STATUS_LABELS[status] || capitalize(status)}</Pill>;
}

// ── Quick Capture FAB ─────────────────────────────────────────────
// Floating "+" on the left pane, Key on a job site hears "follow up
// with the Smith install Tuesday" and needs ONE tap to capture it.
// Old flow: navigate to a contact → open todos popover (top-right
// header) → type. New: tap the FAB anywhere → modal → save.
//
// This is the "always-available capture surface" pattern, the same
// reason iOS has a Lock-screen camera button. The capture is 5 seconds;
// triage happens later. Optional contact-link picker (pre-fills with
// active contact when one is open).
// ── VoiceMemoButton ────────────────────────────────────────────────
// Web Speech API → live transcript → appends text on stop. Browser
// support is good (Chrome desktop+Android, Safari iOS 14.5+, Edge);
// Firefox is the gap. If the API isn't available, the button hides
// itself rather than rendering a broken click target. Mic permission
// is requested via getUserMedia indirectly when recognition.start()
// fires, the browser-native prompt handles the consent flow, no
// custom approval UI needed.
function VoiceMemoButton({ onTranscript }) {
  const [recording, setRecording] = React.useState(false);
  const [interim, setInterim] = React.useState('');
  const recRef = React.useRef(null);
  const finalRef = React.useRef('');

  // The class is webkit-prefixed in Safari/Chrome, plain in newer specs.
  const SR = (typeof window !== 'undefined') &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  if (!SR) return null;

  const stop = () => {
    if (recRef.current) {
      try { recRef.current.stop(); } catch {}
      recRef.current = null;
    }
    setRecording(false);
    const text = finalRef.current.trim();
    setInterim('');
    if (text) onTranscript?.(text);
    finalRef.current = '';
  };

  const start = () => {
    finalRef.current = '';
    setInterim('');
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    r.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalRef.current += res[0].transcript + ' ';
        else interimText += res[0].transcript;
      }
      setInterim(interimText);
    };
    r.onerror = (e) => {
      const err = e.error || 'unknown';
      window.showToast?.('Voice memo: ' + err);
      stop();
    };
    r.onend = () => {
      // Browsers can auto-stop on long silence, only finalize if the
      // user explicitly stopped (recording flag still true means manual
      // stop already cleared it; here we treat auto-end as finalize).
      if (recRef.current) {
        recRef.current = null;
        const text = finalRef.current.trim();
        setRecording(false);
        setInterim('');
        if (text) onTranscript?.(text);
        finalRef.current = '';
      }
    };
    try {
      r.start();
      recRef.current = r;
      setRecording(true);
    } catch (e) {
      window.showToast?.('Voice memo failed: ' + e.message);
    }
  };

  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      {recording && interim && (
        <span style={{ fontSize:11, color:MUTED, fontStyle:'italic', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{interim}</span>
      )}
      <button
        onClick={recording ? stop : start}
        title={recording ? 'Stop recording' : 'Voice memo'}
        aria-label={recording ? 'Stop recording' : 'Voice memo'}
        style={{
          // Audit-2026-05-09 a11y M4: 32×32 → 44×44.
          width:44, height:44, borderRadius:8,
          background: recording ? '#FEF2F2' : '#F0F4FF',
          border:'1px solid ' + (recording ? '#FECACA' : 'rgba(11,31,59,0.08)'),
          color: recording ? '#991B1B' : NAVY,
          cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
          flexShrink:0,
          animation: recording ? 'bppMicPulse 1.4s ease-in-out infinite' : 'none',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={recording ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="12" rx="3"/>
          <path d="M5 10v2a7 7 0 0 0 14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
      </button>
      <style>{`@keyframes bppMicPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.7;transform:scale(0.92)} }`}</style>
    </div>
  );
}

// ── Toast system ──────────────────────────────────────────────────
function ToastHost() {
  const [toasts, setToasts] = React.useState([]);
  React.useEffect(() => {
    window.showToast = (msg, opts = {}) => {
      const id = 't' + Date.now() + Math.random();
      setToasts(t => [...t, { id, msg, kind: opts.kind || 'info', undo: opts.undo }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), opts.duration || 2600);
    };
  }, []);
  // Audit-2026-05-09 B2: zIndex was 1000 while ModalShell uses 9999, so
  // toasts fired from inside modal submit handlers were invisible.
  // Portal to document.body + bump zIndex above the modal layer so save-
  // failure / send-failure feedback reaches the user. ReactDOM is the
  // global one Babel-standalone exposes (see crm/v3/index.html).
  // Audit 2026-06-19: the live regions stay MOUNTED (no early return when
  // empty) so screen readers announce each toast; errors land in an assertive
  // region, info/success in a polite one. No visual change for sighted users.
  const renderToast = (t) => (
    <div key={t.id} style={{
      background: t.kind==='error'?'#991B1B':NAVY, color:'white',
      fontSize:12, fontWeight:600, padding:'8px 14px', borderRadius:20,
      boxShadow:'0 4px 16px rgba(0,0,0,0.25)', display:'flex', alignItems:'center', gap:10,
      pointerEvents:'auto', animation:'toastIn 0.24s cubic-bezier(0.16,1,0.3,1)',
      maxWidth:280,
    }}>
      <span style={{ minWidth:0, overflowWrap:'break-word', wordBreak:'break-word' }}>{t.msg}</span>
      {t.undo && <button aria-label="Undo" onClick={() => { t.undo(); setToasts(ts=>ts.filter(x=>x.id!==t.id)); }} style={{ background:'none',border:'none',color:GOLD,fontWeight:700,fontSize:12,cursor:'pointer',fontFamily:'inherit',padding:'0 8px',flexShrink:0,minHeight:44,minWidth:44,display:'inline-flex',alignItems:'center',justifyContent:'center',margin:'-8px -6px -8px 0' }}>Undo</button>}
    </div>
  );
  const col = { display:'flex', flexDirection:'column', gap:6, alignItems:'center' };
  return ReactDOM.createPortal(
    <div style={{ position:'fixed', bottom:'calc(20px + var(--kb-h, 0px) + var(--vvs, env(safe-area-inset-bottom, 0px)))', left:'50%', transform:'translateX(-50%)', zIndex:10030, pointerEvents:'none', ...col }}>
      <div role="status" aria-live="polite" aria-atomic="true" style={col}>{toasts.filter(t => t.kind !== 'error').map(renderToast)}</div>
      <div role="alert" aria-live="assertive" aria-atomic="true" style={col}>{toasts.filter(t => t.kind === 'error').map(renderToast)}</div>
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>,
    document.body,
  );
}

// ── Confirm modal ─────────────────────────────────────────────────
// Audit-2026-05-09 B1+M2: was position:'absolute' with zIndex:200.
// Result: confirm dialogs invoked from inside modals (deleteProposal,
// deleteInvoice, cancelEvent) were hidden behind the modal backdrop AND
// rendered inside the React tree, not at the viewport, clicks fell on
// the swipe container instead of the dialog. Now portals to body with
// position:'fixed' and zIndex above the modal layer.
function ConfirmHost() {
  const [c, setC] = React.useState(null);
  const [exiting, setExiting] = React.useState(false);
  const closeTimer = React.useRef(null);
  const cardRef = React.useRef(null);
  const dismissRef = React.useRef(() => {});
  React.useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  React.useEffect(() => {
    window.confirmAction = (opts) => new Promise(resolve => {
      // A new confirm arriving while the PREVIOUS one is animating out must
      // cancel the pending exit-clear: otherwise the old confirm's 170ms
      // closeTimer fires after this one mounts, setC(null) clobbers it, and
      // its promise never resolves (the caller hangs silently). Same shared-
      // singleton-vs-teardown family as the toast-drop trap. Found 2026-07-13
      // by the completion-packet chained confirms (issue -> attest).
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      setExiting(false);
      setC({ ...opts, resolve });
    });
  }, []);
  // Animate-out-then-unmount (Key 2026-06-21: no more instant-vanish popups).
  // Resolve the promise immediately so the action proceeds with zero added
  // latency, then play the reverse of the enter animation and unmount.
  // reduced-motion closes at once.
  const close = (v) => {
    if (closeTimer.current) return;
    c.resolve(v);
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setC(null); return; }
    setExiting(true);
    closeTimer.current = setTimeout(() => { setC(null); setExiting(false); closeTimer.current = null; }, 170);
  };
  // Stable "dismiss without confirming" for the shared Escape stack + Tab trap,
  // refreshed each render so it always resolves the CURRENT confirm.
  dismissRef.current = () => close(false);
  // Open lifecycle (a11y, audit 2026-06-22). Three things, mirroring ModalShell:
  //  1. Freeze the background panes via the same ref-counted lock (crm-right.jsx)
  //     so the thread/list cannot scroll behind the dialog.
  //  2. Register this confirm's dismiss on the shared __modalEscapeStack (the
  //     closeFn arg) so Escape closes ONLY this confirm, never a modal stacked
  //     underneath. The old local Escape listener fired alongside the modal's
  //     stack entry and double-closed both (shared-confirm-esc-double-close).
  //  3. Move focus INTO the dialog (the card) and trap Tab inside it. Focus
  //     lands on the CARD, never the affirmative button, ON PURPOSE: the
  //     customer email/SMS-send confirms are navy (destructive:false), so
  //     auto-arming Enter on the primary would let a stray keypress fire an
  //     irreversible client send (a trust-floor crossing). Keyboard users Tab
  //     to the affirmative deliberately.
  React.useEffect(() => {
    if (!c) return;
    const closeFn = () => dismissRef.current();
    window.__crmPushModalLock && window.__crmPushModalLock(closeFn);
    setTimeout(() => { if (cardRef.current) cardRef.current.focus(); }, 0);
    const onTab = (e) => {
      if (e.key !== 'Tab' || !cardRef.current) return;
      const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const els = Array.from(cardRef.current.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (els.length === 0) { e.preventDefault(); cardRef.current.focus(); return; }
      const first = els[0], last = els[els.length - 1], active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !cardRef.current.contains(active)) { e.preventDefault(); last.focus(); }
      } else if (active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onTab);
    return () => {
      window.__crmPopModalLock && window.__crmPopModalLock(closeFn);
      document.removeEventListener('keydown', onTab);
    };
  }, [!!c]);
  if (!c) return null;
  return ReactDOM.createPortal(
    <div onClick={() => close(false)} style={{ position:'fixed', top:0, left:0, right:0, height:'var(--vvh, 100dvh)', background:'rgba(15,26,46,0.55)', zIndex:10020, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents: exiting ? 'none' : 'auto', animation: exiting ? 'fadeIn 0.16s ease reverse both' : 'fadeIn 0.18s ease' }}>
      <div ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="bpp-confirm-title" aria-describedby="bpp-confirm-body" onClick={e=>e.stopPropagation()} style={{ background:'white', borderRadius:12, padding:'22px 22px 16px', maxWidth:300, width:'85%', boxShadow:'0 20px 60px rgba(0,0,0,0.4)', display:'flex', flexDirection:'column', maxHeight:'calc(var(--vvh, 100dvh) - 36px)', outline:'none', animation: exiting ? 'popIn 0.18s cubic-bezier(0.4,0,1,1) reverse both' : 'popIn 0.22s cubic-bezier(0.16,1,0.3,1)' }}>
        <div id="bpp-confirm-title" style={{ fontSize:16, fontWeight:700, color:NAVY, marginBottom:6, flexShrink:0 }}>{c.title}</div>
        {/* The body SCROLLS so a long confirm (the email preview, a 4-segment
            message warning) can never push Cancel/Confirm off-screen, which
            would strand the user. Backs every CRM confirm (audit 2026-06-22). */}
        <div id="bpp-confirm-body" style={{ fontSize:13, color:MUTED, lineHeight:1.5, marginBottom:16, overflowY:'auto', flex:'1 1 auto', minHeight:0, overflowWrap:'break-word', wordBreak:'break-word' }}>{c.body}</div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', flexShrink:0 }}>
          <button onClick={()=>close(false)} style={{ height:44, padding:'0 14px', borderRadius:8, background:'none', border:'1.5px solid #EBEBEA', color:MUTED, fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
          <button onClick={()=>close(true)} style={{ height:44, padding:'0 14px', borderRadius:8, background: c.destructive?'#991B1B':NAVY, border:'none', color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>{c.confirmLabel || 'Confirm'}</button>
        </div>
      </div>
      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes popIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>,
    document.body,
  );
}

// ── Empty Hero (no contact selected) ──────────────────────────────
// Steve-Jobs lens (Key 2026-05-08): a dead "select a contact" placeholder
// is the laziest possible thing this screen can be. Use the data we
// already have to show what NEEDS ACTION right now, today's events,
// stuck deals, unread inbox, missed calls. Each pill drills into the
// matching surface.
function EmptyHero() {
  const [data, setData] = React.useState({ contacts:[], events:[], messages:[], calls:[] });
  // Re-read CRM globals on mount + on data-changed events (initial load
  // can be empty on first render).
  React.useEffect(() => {
    const sync = () => setData({
      contacts: window.CRM?.contacts || [],
      events: window.CRM?.events || [],
      messages: window.CRM?.messages || [],
      calls: window.CRM?.calls || [],
      stageHistory: window.CRM?.stageHistory || [],
      proposals: window.CRM?.proposals || [],
      invoices: window.CRM?.invoices || [],
    });
    sync();
    window.addEventListener('crm-data-ready', sync);
    window.addEventListener('crm-data-changed', sync);
    return () => {
      window.removeEventListener('crm-data-ready', sync);
      window.removeEventListener('crm-data-changed', sync);
    };
  }, []);

  // Today's events, installs + inspections happening today.
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);
  const todays = (data.events || []).filter(e => {
    if (!e.start_at) return false;
    const t = new Date(e.start_at).getTime();
    return t >= todayStart.getTime() && t <= todayEnd.getTime();
  });

  // Stuck contacts, re-derive locally so the dashboard stays consistent
  // with the filter chip in the contact list.
  let stuckCount = 0;
  let hotPipelineCount = 0;          // viewed 3+ days ago, no sign, rescuable
  let moneyOnTableCents = 0;         // unbilled proposals + overdue invoices
  try {
    const sigs = (typeof buildContactSignals === 'function')
      ? buildContactSignals({
          contacts: data.contacts, messages: data.messages, calls: data.calls,
          proposals: data.proposals, invoices: data.invoices, events: data.events,
          stageHistory: data.stageHistory,
        })
      : null;
    if (sigs) {
      for (const sig of sigs.values()) {
        if (sig.stuck) stuckCount++;
        if (sig.staleViewed) hotPipelineCount++;
        if (sig.unbilledProposal && (sig.unbilledProposal.amount_cents || 0) > 0) {
          // Subtract any non-cancelled invoices to get the *net* unbilled.
          const proposedCents = sig.unbilledProposal.amount_cents || 0;
          moneyOnTableCents += proposedCents;
        }
        if (sig.outstandingCents) moneyOnTableCents += sig.outstandingCents;
      }
    }
  } catch (_) { /* signals helper unavailable on first paint, show 0 */ }

  // Unread inbox, inbound messages with no read_at + missed calls.
  const unreadInbound = (data.messages || []).filter(m => m.direction === 'in' && !m.read_at).length;
  const missedCalls   = (data.calls    || []).filter(c => c.direction === 'missed').length;
  const inboxCount    = unreadInbound + missedCalls;

  // CRM revamp T2-4: reuse this one tile primitive for ALL five stats incl
  // Money-on-table (was a separate red-bordered pill). `value` is the big
  // number/string (count or money), `active` enables the tap + full color,
  // `iconNode` is a v3 SVG (no emoji). Card chrome matches the unified v3
  // card (radius 12 + soft navy shadow, T2-1).
  const tile = (label, value, color, onClick, iconNode, active) => (
    <button onClick={onClick} disabled={!active} style={{
      flex:'1 1 130px', minWidth:130, padding:'14px 14px',
      background:'white', border:'1px solid #F3F4F6', borderRadius:12,
      cursor: active ? 'pointer' : 'default', fontFamily:'inherit',
      textAlign:'left', opacity: active ? 1 : 0.6,
      boxShadow:'0 1px 3px rgba(27,43,75,.06)',
      transition:'transform 120ms, box-shadow 120ms',
    }}
    onMouseEnter={e => { if (active) { e.currentTarget.style.boxShadow='0 4px 12px rgba(11,31,59,0.10)'; e.currentTarget.style.transform='translateY(-1px)'; } }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow='0 1px 3px rgba(27,43,75,.06)'; e.currentTarget.style.transform=''; }}
    >
      <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, color:'#666', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:6 }}>
        <span style={{ width:14, height:14, display:'inline-flex', alignItems:'center', justifyContent:'center', color:'#9CA3AF', flexShrink:0 }}>{iconNode}</span>{label}
      </div>
      <div style={{ fontSize:28, fontWeight:800, color: active ? color : '#9CA3AF', fontFamily:"'JetBrains Mono','DM Mono',monospace", letterSpacing:'-0.02em' }}>{value}</div>
    </button>
  );
  // Two glyphs the shared Icons set lacks (alert + flame), inlined on the v3
  // tints like the T1-3 / T2-3 approach.
  const AlertGlyph = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l9 16H3z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>;
  const FlameGlyph = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3c1 3-2 4-2 7a2 2 0 004 0c0-1 1-2 1-2 1 2 2 3 2 5a5 5 0 01-10 0c0-4 4-6 5-10z" /></svg>;
  const allClear = todays.length===0 && stuckCount===0 && hotPipelineCount===0 && inboxCount===0 && moneyOnTableCents===0;

  // Tile click handlers route to the appropriate left-pane lens. They
  // dispatch a custom event the LeftPanel listens for, since EmptyHero
  // doesn't have direct access to onTab/onOpen.
  const goTo = (lens) => () => {
    window.dispatchEvent(new CustomEvent('crm-empty-hero-action', { detail: { lens } }));
  };

  return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:BG, flexDirection:'column', gap:18, padding:24 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ width:36, height:36, borderRadius:8, background:NAVY, display:'flex', alignItems:'center', justifyContent:'center', color:GOLD, fontSize:14, fontWeight:800, letterSpacing:'-0.02em' }}>BPP</div>
        <div style={{ fontSize:18, fontWeight:700, color:NAVY, letterSpacing:'-0.01em' }}>Today</div>
      </div>
      {allClear ? (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, padding:'18px 0' }}>
          <span style={{ width:44, height:44, borderRadius:'50%', background:'#ECFDF5', color:'#16a34a', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
          </span>
          <div style={{ fontSize:15, fontWeight:700, color:NAVY }}>All clear</div>
          <div style={{ fontSize:12, color:MUTED }}>Nothing waiting on you right now.</div>
        </div>
      ) : (
        <div style={{ display:'flex', flexWrap:'wrap', gap:10, maxWidth:760, justifyContent:'center' }}>
          {tile("Today's events", todays.length,    NAVY,      goTo('today'),        Icons.calendar, todays.length > 0)}
          {tile('Stuck deals',    stuckCount,        '#991B1B', goTo('rotting'),      AlertGlyph,     stuckCount > 0)}
          {tile('Hot pipeline',   hotPipelineCount,  '#9A3412', goTo('stale_viewed'), FlameGlyph,     hotPipelineCount > 0)}
          {tile('Unread inbox',   inboxCount,        GOLD,      goTo('inbox'),        Icons.messages, inboxCount > 0)}
          {tile('Money on table', formatMoneyCents(moneyOnTableCents), '#991B1B', goTo('finance'), Icons.finance, moneyOnTableCents > 0)}
        </div>
      )}
      <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:20, background:'white', border:'1px solid #EBEBEA', fontSize:11, color:MUTED, fontWeight:600 }}>
        <kbd style={{ background:BG, border:'1px solid #EBEBEA', borderRadius:4, padding:'1px 5px', fontSize:12, fontFamily:'inherit', color:NAVY }}>⌘K</kbd>
        <span>to search</span>
      </div>
    </div>
  );
}

// ── Display helpers ───────────────────────────────────────────────
// Re-evaluated on every module load, i.e. on every page refresh. For Key's
// daily use on iPhone Safari + macOS Chrome this is fine; longer-running
// sessions will see "1m ago" times slowly drift to "1h ago" without ticking,
// which is the v1 behavior anyway.
const NOW = new Date();

// Capitalize a snake_case or lowercase enum: 'premium_plus' → 'Premium plus', 'sent' → 'Sent'
function capitalize(s) {
  if (!s) return '';
  return String(s).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

// E.164 (+18645550192) → "(864) 555-0192"
function formatPhone(e164) {
  if (!e164) return '';
  const d = String(e164).replace(/\D/g, '');
  // Strip leading "1" for US numbers
  const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (n.length !== 10) return e164;
  return `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;
}

// Robust clipboard write with execCommand fallback. The bare
// navigator.clipboard API requires a secure context AND document
// focus; in iframes or some Safari edges it silently rejects.
// Fallback to the legacy textarea-select approach when that happens
// so the Copy buttons actually copy instead of always toasting failure.
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = String(text || '');
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Live phone-input mask, "8648637" → "(864) 863-7", grows with input.
// US-format. Detects E.164 / international input (leading + or 11+
// digits with leading 1) and either strips the country prefix or
// passes the raw value through to avoid mangling international numbers
// into the wrong area code. Pasting "+18648637800" no longer yields
// "(186) 486-3780".
function formatPhoneInput(raw) {
  const s = String(raw || '');
  // Pass through international (anything with `+` that isn't +1<10 US
  // digits>). Strip non-digits otherwise, strip leading `1` if 11
  // digits, and format US-style.
  if (s.startsWith('+')) {
    const noPlus = s.slice(1).replace(/\D/g, '');
    if (noPlus.startsWith('1') && noPlus.length === 11) {
      const us = noPlus.slice(1);
      return `(${us.slice(0,3)}) ${us.slice(3,6)}-${us.slice(6)}`;
    }
    return s; // genuinely international, leave alone
  }
  let d = s.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`;
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
}

// Linkify a message body, URLs (target=_blank), and addresses. Phone numbers
// remain selectable text while outbound calling is not released.
// and addressable street references (Apple Maps deeplink). Returns an
// array of React nodes; pass into a span/div as children. The light
// regex set is tuned for SMS bodies, not arbitrary text.
function linkify(body) {
  if (!body || typeof body !== 'string') return body;
  // Combined pattern, order matters: URLs first (greedy), then phones,
  // then street-pattern addresses.
  const URL_RE = /\bhttps?:\/\/[^\s]+/g;
  // Phone match, the regex used to start with `\b` and the optional
  // `(` after the boundary. That left the opening paren outside the
  // match while the closing paren stayed inside, so "(864) 555-1234"
  // rendered as "( " + linkified "864) 555-1234". Drop the `\b`, allow
  // optional country code + paren wrappers symmetrically.
  const PHONE_RE = /(?:\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g;
  const ADDR_RE = /\b(\d{2,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+(?:St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Boulevard|Way|Hwy|Highway|Pkwy|Parkway|Cir|Circle|Trl|Trail|Pl|Place|Ter|Terrace|Loop)\b\.?(?:,?\s+[A-Z][A-Za-z]+){0,2}(?:,?\s+SC)?(?:\s+\d{5})?)/g;

  // Build a list of {start, end, kind, match} matches, sort by start,
  // then walk and emit text/link fragments. Overlap handling: take the
  // earliest start; if two start at the same offset, longest wins.
  const matches = [];
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(body)) !== null) matches.push({ start: m.index, end: m.index + m[0].length, kind: 'url', text: m[0] });
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(body)) !== null) matches.push({ start: m.index, end: m.index + m[0].length, kind: 'phone', text: m[0], digits: m[1]+m[2]+m[3] });
  ADDR_RE.lastIndex = 0;
  while ((m = ADDR_RE.exec(body)) !== null) matches.push({ start: m.index, end: m.index + m[0].length, kind: 'address', text: m[0] });
  matches.sort((a,b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  // Drop overlaps (keep the earlier-and-longer one).
  const clean = [];
  let lastEnd = 0;
  for (const x of matches) { if (x.start >= lastEnd) { clean.push(x); lastEnd = x.end; } }

  const out = [];
  let cursor = 0;
  clean.forEach((x, i) => {
    if (x.start > cursor) out.push(body.slice(cursor, x.start));
    const linkStyle = { color:'inherit', textDecoration:'underline', fontWeight:600 };
    if (x.kind === 'url') {
      out.push(<a key={'l'+i} href={x.text} target="_blank" rel="noopener noreferrer" style={linkStyle} onClick={e=>e.stopPropagation()}>{x.text}</a>);
    } else if (x.kind === 'phone') {
      out.push(<span key={'l'+i}>{x.text}</span>);
    } else {
      const q = encodeURIComponent(x.text);
      out.push(<a key={'l'+i} href={`https://maps.apple.com/?q=${q}`} target="_blank" rel="noopener noreferrer" style={linkStyle} onClick={e=>e.stopPropagation()}>{x.text}</a>);
    }
    cursor = x.end;
  });
  if (cursor < body.length) out.push(body.slice(cursor));
  return out;
}

// ISO timestamp → "12m" / "2h" / "Yesterday" / "Apr 27"
function formatRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // Absolute month/day, with the YEAR appended only when it isn't the current
  // year, so a date from a prior year ("Jan 5") can't be read as recent
  // (INBOX-1 a11y, audit 2026-06-22).
  const absDate = () => d.toLocaleDateString('en-US',
    d.getFullYear() === new Date(Date.now()).getFullYear()
      ? { month:'short', day:'numeric' }
      : { month:'short', day:'numeric', year:'numeric' });
  const diff = Date.now() - d;
  // Future dates: render as absolute (a scheduled event tomorrow
  // shouldn't say "now"). Renders as month/day if >7d out, "Tomorrow"
  // for ~24h ahead, otherwise the absolute time.
  if (diff < 0) {
    const futureDays = Math.floor(-diff / 86400000);
    if (futureDays === 0) return d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
    if (futureDays === 1) return 'Tomorrow';
    return absDate();
  }
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (hrs < 24) return `${hrs}h`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d`;
  return absDate();
}

// cents → "$1,497"
function formatMoneyCents(cents) {
  if (cents == null) return '';
  return (cents / 100).toLocaleString('en-US', { style:'currency', currency:'USD', maximumFractionDigits: 0 });
}

// ── Rot detection signals ───────────────────────────────────────────
// One pure function, called once per ContactsList render with the full
// data set, returns a Map<contactId, signals> the row renderer pulls from.
// Per-stage "should have moved by now" SLA in days. Catches deals that
// stall in a stage besides "stale quote" (the only signal previously
// tracked). Calibrated to BPP's typical lifecycle:
//   new            2d, Alex/Key reply within 2 days or it goes cold
//   quoted         5d, customers decide within a workweek; >5d = nudge
//   booked         7d, permit needs to file within a week of booking
//   permit_submit  14d, jurisdiction queue; warn but not aggressive
//   permit_waiting 14d, same
//   permit_approved 3d, once approved, schedule install fast
//   install        3d, installed-but-still-on-stage means invoice slipped
//   done           never (terminal)
const STAGE_SLA_DAYS = {
  new: 2, quoted: 5, booked: 7, permit_submit: 14, permit_waiting: 14,
  permit_approved: 3, install: 3, done: Infinity,
};

// Centralized here so the Money tab and Calendar can reuse the same
// definitions (no two-source-of-truth drift on what counts as "stale").
function buildContactSignals({ contacts, messages, calls, proposals, invoices, events, stageHistory, now = Date.now() }) {
  const out = new Map();
  // Index for O(1) lookups instead of O(N*M) per contact.
  const msgsByC = new Map();
  const callsByC = new Map();
  const propsByC = new Map();
  const invsByC = new Map();
  const eventsByC = new Map();
  // Stage-history index: latest changed_at per contact (DB column is
  // changed_at, not created_at, empirically verified). Used to compute
  // days-in-current-stage; falls back to contact.created_at for contacts
  // that never transitioned (i.e., still in their initial 'new' stage).
  const stageEntryByC = new Map();
  for (const h of stageHistory || []) {
    const prev = stageEntryByC.get(h.contact_id);
    if (!prev || (h.changed_at || '') > (prev.changed_at || '')) {
      stageEntryByC.set(h.contact_id, h);
    }
  }
  for (const m of messages || [])  (msgsByC.get(m.contact_id) || msgsByC.set(m.contact_id, []).get(m.contact_id)).push(m);
  for (const c of calls || [])     (callsByC.get(c.contact_id) || callsByC.set(c.contact_id, []).get(c.contact_id)).push(c);
  for (const p of proposals || []) (propsByC.get(p.contact_id) || propsByC.set(p.contact_id, []).get(p.contact_id)).push(p);
  for (const i of invoices || [])  (invsByC.get(i.contact_id) || invsByC.set(i.contact_id, []).get(i.contact_id)).push(i);
  for (const e of events || [])    (eventsByC.get(e.contact_id) || eventsByC.set(e.contact_id, []).get(e.contact_id)).push(e);

  for (const c of contacts || []) {
    if (c.archived) continue;
    const cMsgs = msgsByC.get(c.id) || [];
    const cCalls = callsByC.get(c.id) || [];
    const cProps = propsByC.get(c.id) || [];
    const cInvs = invsByC.get(c.id) || [];
    const cEvents = eventsByC.get(c.id) || [];

    // Last touch, most recent outbound activity from us.
    // Internal notes/system rows are saved as outbound but never reach the
    // customer, so they must not count as a touch (mirrors needsReplySet).
    const lastOutMsg = cMsgs.filter(m => (m.direction === 'out' || m.sender_role === 'key') && m.kind !== 'note' && m.kind !== 'system')
      .sort((a, b) => (b.sent_at || '').localeCompare(a.sent_at || ''))[0];
    const lastOutCall = cCalls.filter(c => c.direction === 'out')
      .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))[0];
    const lastTouchAt = [lastOutMsg?.sent_at, lastOutCall?.started_at].filter(Boolean)
      .sort().pop() || null;
    const daysSinceTouch = lastTouchAt
      ? Math.floor((now - new Date(lastTouchAt).getTime()) / 86400000)
      : null;

    // Last inbound message (for last-message preview on row).
    // Same note/system exclusion: previews show the conversation, not internals.
    const sortedMsgs = cMsgs.filter(m => m.kind !== 'note' && m.kind !== 'system')
      .sort((a, b) => (b.sent_at || '').localeCompare(a.sent_at || ''));
    const lastMsg = sortedMsgs[0] || null;

    // Aging quote, proposal sent, not yet signed, not in dead-state.
    // 2026-05-26 audit found this signal was completely silent: it
    // filtered on `status === 'sent'` (lowercase), but actual statuses
    // are title-case 'Copied'/'Created'/'Approved'/'Cancelled' etc.
    // No row ever matched. Result: the rotting-quote pill never fired
    // and the Rotting lens silently undercounted by hundreds of days.
    // Fix: accept any proposal that has a send timestamp + isn't
    // signed + isn't in a dead status + isn't superseded by a newer
    // version. Falls back to copied_at when sent_at is null (legacy
    // data path; backfilled 2026-05-26).
    // mapProposal lowercases p.status, so the filter array must too.
    // Title-case 'Cancelled' silently never matched, letting 3 cancelled
    // proposals slip into the rotting set (2026-05-26 audit).
    const DEAD_STATUSES = ['cancelled', 'declined', 'expired'];
    const sentProposals = cProps
      .filter(p => (p.sent_at || p.copied_at)
        && !p.approved_at
        && p.status !== 'signed' /* Legacy unpaid signatures require an explicit audit/reset, not an automated stale-proposal chase. */
        && !p.superseded_at
        && !DEAD_STATUSES.includes(p.status))
      .map(p => ({ ...p, _sentTs: p.sent_at || p.copied_at }))
      .sort((a, b) => (a._sentTs || '').localeCompare(b._sentTs || ''));
    const freshestStale = sentProposals[sentProposals.length - 1] || null;
    const proposalAgeDays = freshestStale
      ? Math.floor((now - new Date(freshestStale._sentTs).getTime()) / 86400000)
      : null;
    const stale = freshestStale && proposalAgeDays >= 3;
    const veryStale = freshestStale && proposalAgeDays >= 7;
    // Recently-viewed proposal, surface as a positive nudge.
    const recentlyViewedProposal = cProps
      .filter(p => p.viewed_at && (now - new Date(p.viewed_at).getTime()) < 24 * 3600 * 1000)
      .sort((a, b) => (b.viewed_at || '').localeCompare(a.viewed_at || ''))[0] || null;
    // Stale-viewed proposal, customer opened the page >3 days ago but
    // never signed AND not cancelled/declined/expired. The highest-
    // intent rescue category: they engaged enough to look at the price,
    // they didn't reject, they just got distracted. 2026-05-26 audit
    // surfaced 10 of these totaling ~$13.5k in unrealized revenue.
    const staleViewed = cProps
      .filter(p => p.viewed_at
        && !p.approved_at
        && p.status !== 'signed' /* Preserve legacy evidence without reporting or chasing it as acceptance. */
        && !p.superseded_at
        && (now - new Date(p.viewed_at).getTime()) >= 3 * 24 * 3600 * 1000
        && !DEAD_STATUSES.includes(p.status))
      .sort((a, b) => (a.viewed_at || '').localeCompare(b.viewed_at || ''))[0] || null;
    const staleViewedDays = staleViewed
      ? Math.floor((now - new Date(staleViewed.viewed_at).getTime()) / (24 * 3600 * 1000))
      : null;

    // Outstanding $, money the customer is holding unpaid. 2026-05-28:
    // de-coupled from install state. This block used to (a) gate on
    // `installed` (a calendar install event that 95% of jobs never get,
    // because Key tracks install dates in his head) and (b) sum `inv.total`,
    // a field mapInvoice does NOT return, so it added undefined -> 0 every
    // time. Net effect: the per-contact "OWED" pill and the dashboard
    // Money-on-Table tile were SILENTLY BLANK even with thousands truly
    // outstanding. That blankness is a big reason the money layer felt
    // untrustworthy. Now: any unpaid sent/viewed/overdue invoice counts,
    // read from amount_cents, regardless of whether the install was logged.
    let outstandingCents = 0;
    let outstandingOldestDays = null;
    for (const inv of cInvs) {
      if (inv.paid_at) continue;
      if (inv.status === 'sent' || inv.status === 'viewed' || inv.status === 'overdue') {
        // 2026-07-04 audit: net partial payments so the OWED pill matches the
        // MoneyCard's remaining balance. A fully-covered invoice adds 0 and
        // does not age the pill.
        const owed = invoiceOwedCents(inv);
        if (owed <= 0) continue;
        outstandingCents += owed;
        const age = Math.floor((now - new Date(inv.sent_at || inv.created_at).getTime()) / 86400000);
        if (outstandingOldestDays == null || age > outstandingOldestDays) outstandingOldestDays = age;
      }
    }

    // Install-done-but-not-invoiced, past install event, no invoice
    // since that install. Surface on Today/Calendar so Key invoices
    // before he forgets.
    const pastInstalls = cEvents
      .filter(e => e.kind === 'install' && e.status === 'scheduled' && new Date(e.start_at).getTime() < now);
    let installNeedsInvoice = false;
    if (pastInstalls.length > 0) {
      const latestInstall = pastInstalls.sort((a, b) => (b.start_at || '').localeCompare(a.start_at || ''))[0];
      const installTs = new Date(latestInstall.start_at).getTime();
      const invoiceAfterInstall = cInvs.some(inv => {
        const sentTs = new Date(inv.sent_at || inv.created_at || 0).getTime();
        return sentTs >= installTs;
      });
      installNeedsInvoice = !invoiceAfterInstall;
    }

    // Unbilled-revenue signal: signed proposal exists but no matching
    // invoice covers it. Catches the case where calendar_events doesn't
    // have the install row (95% of installs in production). Phyllis
    // surfaced this 2026-05-26: signed $1197 18 days ago, no invoice
    // at all.
    let unbilledProposal = null;
    let unbilledRevenueDays = null;
    // status !== 'signed': signed-awaiting-deposit is not booked revenue and
    // must not drive the unbilled "send invoice" signal; the deposit chase
    // surfaces on the contact panel instead (#114).
    const liveSigned = cProps
      .filter(p => p.approved_at && !p.superseded_at && p.status !== 'cancelled' && p.status !== 'signed')
      .sort((a, b) => (b.approved_at || '').localeCompare(a.approved_at || ''));
    if (liveSigned.length > 0) {
      const totalProposed = liveSigned[0].amount_cents || 0;
      const totalInvoiced = cInvs
        .filter(inv => inv.status !== 'cancelled' && inv.status !== 'voided' && inv.status !== 'refunded')
        .reduce((s, inv) => s + (inv.amount_cents || 0), 0);
      // 80% threshold lets a "deposit only" invoice not count as fully
      // billed without forcing exact-cent match (which fails on dynamic
      // discounts + manual adjustments).
      if (totalInvoiced < totalProposed * 0.8) {
        unbilledProposal = liveSigned[0];
        const signedTs = new Date(unbilledProposal.approved_at).getTime();
        unbilledRevenueDays = Math.floor((now - signedTs) / 86400000);
      }
    }

    // Days-in-current-stage. Latest stage_history.changed_at if available,
    // else fall back to contact.created_at (covers contacts that never
    // transitioned out of 'new'). Compared against STAGE_SLA_DAYS to flag
    // deals stalling in stages other than 'sent quote'.
    const stageEntry = stageEntryByC.get(c.id);
    const stageEnteredAt = stageEntry?.changed_at || c.created_at;
    const daysInStage = stageEnteredAt
      ? Math.floor((now - new Date(stageEnteredAt).getTime()) / 86400000)
      : null;
    const sla = STAGE_SLA_DAYS[c.stage];
    // Stage 'new' is intentionally excluded from "stuck" (2026-06-03 UX pass):
    // a fresh lead that never engaged is covered by Silent leads (2d) / Work
    // queue / the Cold bucket (30d), not by the "deal stalled mid-pipeline"
    // signal. The per-row stuck pill already guarded c.stage!=='new'; this
    // makes stuckCount + the Stuck-deals tile agree instead of being inflated
    // by hundreds of cold stage-1 leads.
    const stuck = (c.stage !== 'new' && daysInStage != null && sla != null && daysInStage > sla);

    out.set(c.id, {
      lastTouchAt, daysSinceTouch, lastMsg,
      stale, veryStale, proposalAgeDays, freshestStale,
      recentlyViewedProposal,
      staleViewed, staleViewedDays,
      outstandingCents, outstandingOldestDays,
      installNeedsInvoice,
      unbilledProposal, unbilledRevenueDays,
      daysInStage, stuck, stageSla: sla,
    });
  }
  return out;
}

// ISO → "Apr 30" or "Sat, May 3"
function formatDate(iso, opts = { weekday:'short', month:'short', day:'numeric' }) {
  if (!iso) return '';
  // Accept either "2026-05-03" or full ISO timestamps
  const d = iso.length === 10 ? new Date(iso + 'T12:00:00Z') : new Date(iso);
  return d.toLocaleDateString('en-US', opts);
}

// ISO → "9:00 AM"
function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true });
}

// ISO → "9:00 AM" but compact for densely-packed calendar rows ("9:00")
function formatTimeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  // Keep AM/PM: a calendar time without it ("3:30") is ambiguous. Compact the
  // meridiem to lowercase-no-space ("3:30pm") so it stays short but unambiguous.
  return d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true })
          .replace(/\s?(AM|PM)$/i, (_, mp) => mp.toLowerCase());
}

// Duration sec → "1:23", or "0:00" when there's no recorded duration
function formatDuration(sec) {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60), r = sec % 60;
  return m + ':' + String(r).padStart(2, '0');
}

// Date-only key for grouping in LOCAL time. Splitting an ISO timestamp
// on 'T' returns the UTC date portion, comparing that against TODAY
// (built from local-TZ Date components) goes off-by-one any time the
// UTC date is different from local. After ~8 PM EDT the UTC date is
// already tomorrow → tonight's installs grouped under the wrong day.
function dayKey(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Backwards-compat aliases (keep old names working during migration)
const relTime = formatRelative;
const fmtTime = formatTime;
const fmtDate = formatDate;

// ── Has-installed helper ──────────────────────────────────────────────
// Per Key's billing rule: customers don't owe anything until after the
// install. An invoice for a contact with no past install + stage < install
// is pre-billing (queued / pending), NOT outstanding.
function contactHasInstalled(contact, events = []) {
  if (!contact) return false;
  if (contact.stage === 'install' || contact.stage === 'done') return true;
  const now = Date.now();
  return events.some(e =>
    e.contact_id === contact.id &&
    e.kind === 'install' &&
    e.start_at &&
    new Date(e.start_at).getTime() < now
  );
}

// Overdue is DERIVED, not stored. The DB never flips invoice.status to
// 'overdue' on its own. A sent/viewed invoice is overdue when the
// contact has installed AND the invoice has been sitting in customer's
// hand for >14 days. Callers MUST pass an installed-set so we don't
// re-resolve install state per invoice.
// 2026-05-26: shared from crm-left so the Today panel + contact money
// pill compute the same answer instead of three drifting copies.
const INVOICE_OVERDUE_AGE_MS = 14 * 86400000;
function isInvoiceOverdue(inv, _installedSet) {
  // 2026-05-28: AR is no longer gated on install state. An invoice the
  // customer is holding unpaid becomes overdue based on its OWN age,
  // whether or not the install was logged on the calendar. The old
  // installed-gate meant that because Key tracks installs in his head
  // (not the calendar), this returned false for every real invoice and
  // the overdue badge / Top-Owed list were silently always $0.
  // `_installedSet` is retained only so existing call sites keep working;
  // it is intentionally unused.
  if (!inv) return false;
  if (inv.paid_at) return false;
  // 2026-07-04 audit: a sent invoice fully covered by partial payments
  // (paid_cents >= amount_cents) but never stamped paid_at is settled, not
  // overdue. Without this, a $1,500 invoice paid down to $0 via cash/partials
  // kept inflating the Overdue tile at full face value.
  if ((inv.amount_cents || 0) > 0 && (inv.paid_cents || 0) >= (inv.amount_cents || 0)) return false;
  if (inv.status === 'overdue') return true;
  if (inv.status !== 'sent' && inv.status !== 'viewed') return false;
  const t = inv.sent_at || inv.created_at;
  if (!t) return false;
  return (Date.now() - new Date(t).getTime()) > INVOICE_OVERDUE_AGE_MS;
}

// What a customer STILL owes on one invoice, net of partial payments.
// 2026-07-04 audit: every AR sum (per-contact OWED, dashboard Outstanding /
// Overdue / Aged / Top-owed) used raw amount_cents and ignored paid_cents, so a
// $1,197 invoice with a $600 cash partial showed $1,197 owed everywhere except
// the MoneyCard (which already netted it). Single source of truth so they agree.
function invoiceOwedCents(inv) {
  if (!inv) return 0;
  return Math.max(0, (inv.amount_cents || 0) - (inv.paid_cents || 0));
}

// Build the installed-set for a list of contacts. We accept ANY of:
//   1. stage === 'install' or 'done' (explicit user-advanced stage)
//   2. past calendar event with kind='install'
//   3. signed proposal + sent/unpaid invoice >= 7 days old (inference:
//      Key signed-and-installed but never advanced the stage)
// Discovered 2026-05-26: 95% of installed contacts in production never
// get their stage advanced past 'booked', and calendar_events has only
// 1 row total. Without #3 the overdue badge was silently always 0.
// Cheaper than calling contactHasInstalled per invoice, one pass over
// the inputs builds a lookup set.
function buildInstalledSet(contacts, events, proposals, invoices) {
  const s = new Set();
  if (!Array.isArray(contacts)) return s;
  const evByContact = new Map();
  for (const e of (events || [])) {
    if (e.kind !== 'install' || !e.start_at) continue;
    const list = evByContact.get(e.contact_id) || [];
    list.push(e);
    evByContact.set(e.contact_id, list);
  }
  // Index signed proposals by contact_id once.
  const signedByContact = new Map();
  for (const p of (proposals || [])) {
    if (!p.approved_at || p.superseded_at) continue;
    const t = new Date(p.approved_at).getTime();
    if (Number.isNaN(t)) continue;
    const prev = signedByContact.get(p.contact_id);
    if (!prev || t > prev) signedByContact.set(p.contact_id, t);
  }
  // Index oldest sent/unpaid invoice age by contact.
  const oldestSentInvByContact = new Map();
  const now = Date.now();
  for (const i of (invoices || [])) {
    if (i.status !== 'sent' && i.status !== 'viewed') continue;
    const t = new Date(i.sent_at || i.created_at || 0).getTime();
    if (!t) continue;
    const age = now - t;
    const prev = oldestSentInvByContact.get(i.contact_id);
    if (prev == null || age > prev) oldestSentInvByContact.set(i.contact_id, age);
  }
  const SEVEN_DAYS = 7 * 86400000;
  for (const c of contacts) {
    if (contactHasInstalled(c, evByContact.get(c.id) || [])) { s.add(c.id); continue; }
    // Heuristic #3: signed proposal + invoice in customer's hand >= 7d
    // means the install almost certainly happened.
    const signedAt = signedByContact.get(c.id);
    const oldestInvAge = oldestSentInvByContact.get(c.id);
    if (signedAt && oldestInvAge != null && oldestInvAge >= SEVEN_DAYS) {
      s.add(c.id);
    }
  }
  return s;
}

// ── localStorage with quota fallback ──────────────────────────────────
// Wraps setItem with eviction-on-quota. When localStorage hits its 5MB
// limit (typical browser limit), we evict any bpp_v3_geocode: or
// bpp_v3_drive: cache entries (which we can re-fetch) before retrying.
// Pinned-contacts and the like persist because they live under different
// prefixes the eviction sweep doesn't touch.
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') {
      try {
        const evictPrefixes = ['bpp_v3_geocode:', 'bpp_v3_drive:', 'bpp_v3_job_photos:'];
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (evictPrefixes.some(p => k.startsWith(p))) {
            localStorage.removeItem(k);
          }
        }
        localStorage.setItem(key, value);
        return true;
      } catch { return false; }
    }
    return false;
  }
}

// ── Scheduled SMS queue ────────────────────────────────────────────────
// Send-later: store messages locally with an `at` ISO timestamp; a single
// global poller (mounted once at app load) scans every 60s, sends due
// items via the existing send-sms edge function, and removes them from
// the queue. Survives page reload because state lives in localStorage.
// Tradeoff: requires the browser tab to be open within the minute the
// message is due. For BPP scale (single-user CRM) this is acceptable:
// Key has the CRM open most of the day. For real "send while I sleep"
// scheduling, we'd need a Supabase pg_cron job; deferred until needed.
const SCHED_KEY = 'bpp_v3_scheduled_msgs';
function readSchedQueue() {
  try { return JSON.parse(localStorage.getItem(SCHED_KEY) || '[]') || []; }
  catch { return []; }
}
function writeSchedQueue(q) {
  try { localStorage.setItem(SCHED_KEY, JSON.stringify(q || [])); } catch {}
  window.dispatchEvent(new CustomEvent('crm-scheduled-msg-changed'));
}
function scheduleMessage({ contactId, body, atIso, mediaUrls = [], fileLinks = [] }) {
  const q = readSchedQueue();
  q.push({
    id: 'sched_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    contactId, body,
    // Plain public-URL strings (uploaded at schedule time): images ride as MMS
    // mediaUrls, non-image files append to the body as links. JSON-safe, unlike
    // the old File-bearing `attachments` which silently became {} in storage.
    mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : [],
    fileLinks: Array.isArray(fileLinks) ? fileLinks : [],
    at: atIso,
    createdAt: new Date().toISOString(),
  });
  writeSchedQueue(q);
}
// [5]: a durable cancelled-id tombstone so Cancel is authoritative even when an
// item is already mid-fire inside a tick loop. Before this, cancelScheduledMessage
// only filtered the queue, but a due item already pulled into the in-flight loop
// was gone from the queue (the filter was a no-op) while its send still fired,
// and a transient requeue could even resurrect a cancelled message. The runner
// checks this set right before the irreversible send and before any requeue.
const SCHED_CANCEL_KEY = 'bpp_v3_sched_cancelled';
function readCancelledSched() {
  try { return new Set(JSON.parse(localStorage.getItem(SCHED_CANCEL_KEY) || '[]') || []); }
  catch { return new Set(); }
}
function tombstoneSched(id) {
  try {
    const s = readCancelledSched(); s.add(id);
    // Bound growth: keep the most recent 200 cancelled ids (ring buffer).
    localStorage.setItem(SCHED_CANCEL_KEY, JSON.stringify(Array.from(s).slice(-200)));
  } catch {}
}
function untombstoneSched(id) {
  try {
    const s = readCancelledSched(); if (!s.delete(id)) return;
    localStorage.setItem(SCHED_CANCEL_KEY, JSON.stringify(Array.from(s)));
  } catch {}
}
function cancelScheduledMessage(id) {
  tombstoneSched(id); // authoritative , honored even mid-fire by the runner
  writeSchedQueue(readSchedQueue().filter(x => x.id !== id));
}
// One-shot mount at app load: runs the queue every 60s. Idempotent:
// __schedRunning guards against double-init from React strict-mode
// double-invoke.
function startScheduledQueueRunner() {
  if (typeof window === 'undefined') return;
  if (window.__bppSchedRunning) return;
  window.__bppSchedRunning = true;
  // A queued message is removed from the queue BEFORE the send is confirmed
  // (so a slow send can't double-fire). Before 2026-06-22 a transient failure
  // (5xx, rate-limit, network blip) OR a contact that became DNC after
  // scheduling just toasted and the message was permanently dropped, silently.
  // Now: transient failures re-queue with a capped backoff so a blip never
  // loses Key's message; a PERMANENT failure (DNC / STOP / invalid recipient)
  // is surfaced and NOT re-queued, because retrying it can never succeed and a
  // blind re-queue would loop forever against a do-not-contact contact.
  const MAX_SCHED_TRIES = 3;
  // [6]: a due item is now KEPT in the queue (marked inFlightAt) for the
  // duration of its send and removed ONLY after a confirmed result, so closing
  // the tab before a send is dispatched no longer permanently drops the text.
  // A send that began but never resolved (tab closed/crashed mid-send) is
  // detected as a STALE inFlight on a later tick and SURFACED to Key, never
  // auto-resent: send-sms's idempotency guard is only a ~60s in-memory window,
  // so a silent resend minutes later could double-text the customer (durable
  // server-side idempotency is the Key-gated fix, docs/OPEN-DECISIONS.md). Key
  // checks the thread (ground truth) and resends only if it truly did not go.
  const STALE_INFLIGHT_MS = 3 * 60_000;
  // Per-tab guard so an overlapping tick (a send slower than the 60s interval)
  // can't pick the same id twice within this tab.
  const inProcess = new Set();
  const schedContactName = (id) => {
    const c = (window.CRM?.contacts || []).find(x => x.id === id);
    return c ? (c.name || c.first_name || 'contact') : 'contact';
  };
  const removeSched = (id) => writeSchedQueue(readSchedQueue().filter(x => x.id !== id));
  const releaseInFlight = (id) => writeSchedQueue(readSchedQueue().map(x => x.id === id ? { ...x, inFlightAt: null } : x));
  const requeueTransient = (m, reason) => {
    const tries = (m.tries || 0) + 1;
    // Drop this id's current (in-flight) copy first so a retry never leaves a
    // duplicate now that items live in the queue until confirmed.
    const base = readSchedQueue().filter(x => x.id !== m.id);
    if (tries >= MAX_SCHED_TRIES) {
      writeSchedQueue(base); // give up after the cap, never silently:
      window.showToast?.(`Scheduled text to ${schedContactName(m.contactId)} failed after ${tries} tries: ${reason}. Not retrying.`, { kind: 'error', duration: 14000 });
      return;
    }
    base.push({ ...m, tries, inFlightAt: null, at: new Date(Date.now() + tries * 2 * 60_000).toISOString() });
    writeSchedQueue(base);
    window.showToast?.(`Scheduled text to ${schedContactName(m.contactId)} didn't send, retrying (${tries}/${MAX_SCHED_TRIES}).`, { kind: 'error', duration: 7000 });
  };
  const failPermanent = (m, reason) => {
    // Permanent (DNC etc.): correct outcome is to NOT send; remove it and make
    // sure Key knows it didn't go out instead of dropping it in silence.
    removeSched(m.id);
    window.showToast?.(`Scheduled text to ${schedContactName(m.contactId)} not sent: ${reason}`, { kind: 'error', duration: 14000 });
  };
  const tick = async () => {
    const now = Date.now();
    let q = readSchedQueue();
    const cancelled = readCancelledSched();
    // [5] Drop any cancelled items up front (covers a cancel made in another
    // tab); their tombstone keeps them dead even if re-encountered below.
    const afterCancel = q.filter(m => !cancelled.has(m.id));
    if (afterCancel.length !== q.length) { writeSchedQueue(afterCancel); q = afterCancel; }
    // [6] Stale in-flight = a prior tick began sending but never confirmed (tab
    // closed/crashed). Surface to Key, do NOT auto-resend (double-send risk).
    const stale = q.filter(m => m.inFlightAt && (now - Date.parse(m.inFlightAt)) > STALE_INFLIGHT_MS);
    if (stale.length) {
      const staleIds = new Set(stale.map(m => m.id));
      writeSchedQueue(q.filter(m => !staleIds.has(m.id)));
      for (const m of stale) {
        untombstoneSched(m.id);
        window.showToast?.(`A scheduled text to ${schedContactName(m.contactId)} may not have finished sending. Check the thread and resend if it isn't there.`, { kind: 'error', duration: 16000 });
      }
      return; // resume normal sending next tick with a clean queue
    }
    const due = q.filter(m =>
      Date.parse(m.at) <= now &&
      !m.inFlightAt &&            // not already being sent
      !inProcess.has(m.id) &&     // not picked by this tab's current loop
      !cancelled.has(m.id)
    );
    if (due.length === 0) return;
    // [6] Mark the due items inFlight in-place (single write) instead of
    // removing them , a tab close mid-send now leaves a recoverable record.
    const nowIso = new Date().toISOString();
    const dueIds = new Set(due.map(m => m.id));
    writeSchedQueue(readSchedQueue().map(m => dueIds.has(m.id) ? { ...m, inFlightAt: nowIso } : m));
    for (const m of due) {
      inProcess.add(m.id);
      try {
        // [5] Honor a cancel that landed after we picked the item up, before the
        // irreversible send: drop it and clear its tombstone.
        if (readCancelledSched().has(m.id)) { removeSched(m.id); untombstoneSched(m.id); continue; }
        if (!window.CRM?.__invokeFn) { releaseInFlight(m.id); continue; } // data layer not ready: retry next tick, no try burned
        const idempotencyKey = `v3-sched-${m.id}`;
        // Media uploaded at schedule time: images send as MMS mediaUrls, files
        // append to the body as links (mirrors the immediate send() path).
        const mediaUrls = Array.isArray(m.mediaUrls) ? m.mediaUrls : [];
        const fileLinks = Array.isArray(m.fileLinks) ? m.fileLinks : [];
        const finalBody = (m.body || '') + (fileLinks.length ? ((m.body ? '\n' : '') + fileLinks.join('\n')) : '');
        const { data, error } = await window.CRM.__invokeFn('send-sms', {
          body: { contactId: m.contactId, body: finalBody, mediaUrls, idempotencyKey },
        });
        if (error || (data && data.success === false)) {
          // Classify the failure. A DNC/STOP/invalid-recipient is PERMANENT
          // (retrying can never succeed); a 5xx / rate-limit / network error is
          // TRANSIENT and worth a backed-off retry.
          let status = 0, reason = '';
          try { status = (error && error.context && error.context.status) || 0; } catch (_) {}
          try {
            if (data && data.success === false) reason = data.error || '';
            else if (error && error.context) { const b = await error.context.json(); reason = (b && b.error) || ''; }
          } catch (_) {}
          if (!reason) reason = (error && error.message) || 'unknown error';
          const permanent = status === 403 || status === 400 || status === 404 ||
            /do not contact|do_not_contact|unsubscrib|opted out|\bstop\b|21610|invalid|not found|no phone/i.test(reason);
          if (permanent) failPermanent(m, reason);
          else requeueTransient(m, reason);
        } else {
          removeSched(m.id); // [6] confirmed sent: now safe to drop from the queue
          window.showToast?.(`Scheduled text sent`);
        }
      } catch (e) {
        // Network/runtime error reaching the edge fn: transient, retry with backoff.
        requeueTransient(m, e.message || String(e));
      } finally {
        inProcess.delete(m.id);
      }
    }
  };
  // Test-only hook (localhost + ?test=1, the same gate as the TEST MODE shell):
  // lets the dojo drive one poll cycle synchronously instead of waiting 60s.
  // The condition is ALWAYS false on backuppowerpro.com, so production never
  // exposes it. Mirrors how __db / __invokeFn are exposed for the harness.
  try {
    if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') &&
        new URLSearchParams(location.search).get('test') === '1') {
      window.__bppSchedTick = tick;
    }
  } catch (_) {}
  // First tick after 5s (lets the data layer initialize), then every 60s.
  setTimeout(tick, 5000);
  setInterval(tick, 60_000);
}

// ── Pinned-contacts hook ──────────────────────────────────────────────
// Source of truth is `contacts.pinned` (migration 20260509140000). Pins
// sync between desktop and mobile via the existing contacts realtime
// channel. Before this migration, pins lived only in localStorage,
// per-device, no cross-device sync, Key noticed his phone's stars
// didn't show on desktop.
//
// readPinnedSet() returns the set derived from CRM.contacts; the legacy
// PIN_KEY_SHARED localStorage key is kept ONLY as a one-time backfill
// source on first load (cleared in `migrateLocalPinsToDb` in crm-app).
const PIN_KEY_SHARED = 'bpp_v3_pinned_contacts';
function readPinnedSet() {
  const set = new Set();
  for (const c of (window.CRM?.contacts || [])) {
    if (c.pinned) set.add(c.id);
  }
  return set;
}
function usePinned() {
  const [pinned, setPinned] = React.useState(() => readPinnedSet());
  React.useEffect(() => {
    const refresh = () => setPinned(readPinnedSet());
    // Pin state lives on contacts now, so any contacts data refresh
    // (realtime fire, manual refetch, optimistic local mutation)
    // triggers re-derivation. crm-pin-changed stays as a fast local
    // signal so toggling a pin doesn't wait for a realtime round-trip.
    window.addEventListener('crm-data-changed', refresh);
    window.addEventListener('crm-pin-changed', refresh);
    return () => {
      window.removeEventListener('crm-data-changed', refresh);
      window.removeEventListener('crm-pin-changed', refresh);
    };
  }, []);
  return pinned;
}

// ── Snooze ────────────────────────────────────────────────────────────
// Hide a contact from the active list until a date. Stored in localStorage
// so no DB migration is needed; this is a per-device intent anyway. Map
// shape: { [contactId]: ISO_TIMESTAMP }. Anything past now is auto-cleared
// at read time (so an unsnooze is just "let time pass").
const SNOOZE_KEY = 'bpp_v3_snoozed';
function readSnoozeMap() {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    const now = Date.now();
    const next = {};
    let dirty = false;
    for (const [id, ts] of Object.entries(obj)) {
      if (typeof ts !== 'string') { dirty = true; continue; }
      if (Date.parse(ts) > now) next[id] = ts;
      else dirty = true;
    }
    if (dirty) safeSetItem(SNOOZE_KEY, JSON.stringify(next));
    return next;
  } catch { return {}; }
}
function writeSnoozeMap(map) {
  safeSetItem(SNOOZE_KEY, JSON.stringify(map || {}));
  window.dispatchEvent(new CustomEvent('crm-snooze-changed'));
}
function snoozeContact(contactId, untilIso) {
  const m = readSnoozeMap();
  m[contactId] = untilIso;
  writeSnoozeMap(m);
}
function unsnoozeContact(contactId) {
  const m = readSnoozeMap();
  delete m[contactId];
  writeSnoozeMap(m);
}
function isSnoozed(contactId) {
  const m = readSnoozeMap();
  return !!m[contactId];
}
function snoozedUntil(contactId) {
  const m = readSnoozeMap();
  return m[contactId] || null;
}

// ── BPP pricing engine (mirrors v1/v2, keep in sync) ──────────────────
// QB_C = your real costs. QB_S = what the customer sees. Both in dollars.
// When v1 changes, mirror here.
const QB_C = {
  inlet30: 55, inlet50: 85, interlock: 25,
  permitActual: 75, permitCustomer: 150, licenseAmortized: 25,
  surgeProtector: 85, cord30Cost: 60, cord50Cost: 125,
  adCost: 150, minProfit: 500,
};
const QB_S = {
  base30: 1197, base50: 1497,
  longRun30perFt: 12, longRun50perFt: 14,
  surge: 446, pom: 447,
  cordValue30: 129, cordValue50: 198,
  permitCustomer: 150,
};
// Tier upgrades (additive, applied after base+addons). Standard is the floor.
const TIER_META = {
  standard:     { label: 'Standard',  uplift: 0,   tone: '#666' },
  premium:      { label: 'Premium',   uplift: 300, tone: '#0b1f3b' },
  premium_plus: { label: 'Premium+',  uplift: 600, tone: GOLD },
};
const TIER_IDS = ['standard', 'premium', 'premium_plus'];

// Total dollars for a given amp + addon set + tier.
function quickQuoteTotal({ amp, cordIncluded, includeSurge, includePom, includePermit, tier }) {
  const is50 = String(amp) === '50';
  const baseCordCost = is50 ? QB_C.cord50Cost : QB_C.cord30Cost;
  const cordValue = is50 ? QB_S.cordValue50 : QB_S.cordValue30;
  const yourSupplies =
    (is50 ? QB_C.inlet50 : QB_C.inlet30) + QB_C.interlock + QB_C.permitActual + QB_C.licenseAmortized +
    (cordIncluded ? baseCordCost : 0) +
    (includeSurge ? QB_C.surgeProtector : 0);
  const totalCost = yourSupplies + QB_C.adCost;
  const cordDiscount = cordIncluded ? 0 : cordValue;
  const addonSell =
    (includeSurge ? QB_S.surge : 0) +
    (includePom ? QB_S.pom : 0) +
    (includePermit ? QB_S.permitCustomer : 0);
  const standardSell = (is50 ? QB_S.base50 : QB_S.base30) + addonSell - cordDiscount;
  let totalSell = Math.round(Math.max(standardSell, totalCost + QB_C.minProfit));
  totalSell += (TIER_META[tier]?.uplift || 0);
  if (totalSell % 2 === 0) totalSell += 1;
  return totalSell;
}

// Build pricing_30 + pricing_50 line-item shapes that proposal.html consumes.
// Mirrors v2 quickQuoteCompute output minus the tier uplift (uplift lives on
// the top-level total field).
function quickQuoteCompute({ amp, cordIncluded, includeSurge, includePom, includePermit }) {
  const is50 = String(amp) === '50';
  const baseCordCost = is50 ? QB_C.cord50Cost : QB_C.cord30Cost;
  const cordValue = is50 ? QB_S.cordValue50 : QB_S.cordValue30;
  const yourSupplies =
    (is50 ? QB_C.inlet50 : QB_C.inlet30) + QB_C.interlock + QB_C.permitActual + QB_C.licenseAmortized +
    (cordIncluded ? baseCordCost : 0) +
    (includeSurge ? QB_C.surgeProtector : 0);
  const totalCost = yourSupplies + QB_C.adCost;
  const cordDiscount = cordIncluded ? 0 : cordValue;
  const addonSell =
    (includeSurge ? QB_S.surge : 0) +
    (includePom ? QB_S.pom : 0) +
    (includePermit ? QB_S.permitCustomer : 0);
  const standardSell = (is50 ? QB_S.base50 : QB_S.base30) + addonSell - cordDiscount;
  let totalSell = Math.round(Math.max(standardSell, totalCost + QB_C.minProfit));
  if (totalSell % 2 === 0) totalSell += 1;
  return {
    total: totalSell,
    base: is50 ? QB_S.base50 : QB_S.base30,
    cord: cordIncluded ? 0 : cordValue,
    cordIncluded: !!cordIncluded,
    mainBreaker: 0, twinQuad: 0,
    surge: includeSurge ? QB_S.surge : 0,
    pom: includePom ? QB_S.pom : 0,
    permit: includePermit ? QB_S.permitCustomer : 0,
    longRun: 0, permitInspection: 0, extraFt: 0,
    items: [],
  };
}

// ── V3 pricing engine (Key sketch 2026-05-08) ──────────────────────────
// Single consolidated total. Cord/inlet/permit included by default in
// base; toggling off subtracts the listed value. Length adds a per-foot
// adder beyond the standard 5'. Line items + discount applied last. PoM
// is opt-in only and never folded into the displayed total.
const V3_PRICING = {
  base:      { 30: 1197, 50: 1497 }, // includes 5' run, cord, inlet, permit
  perFt:     { 30: 12,   50: 14   }, // per-foot adder beyond 5'
  // Cord adders mirror the actual L14-30 vs CS6365/14-50 retail spread.
  // 30A 25ft cord ~$100-150 retail → $129. 50A 25ft cord ~$200-280 retail
  // → $249 (was $198, bumped 2026-05-08, Key flagged it as too close to
  // 30A given the underlying material differential). The base price ALSO
  // moves with this, when cord is included, the synthesizer surfaces
  // cord at this list price and backs it out of Installation, so the
  // total stays at $1,497 for 50A all-included.
  cordOff:   { 30: 129,  50: 249  }, // discount when cord toggled off
  inletOff:  { 30: 129,  50: 179  }, // discount when inlet toggled off
  permitOff: 150,                     // discount when permit toggled off
  pom:       447,                     // peace-of-mind add-on (not in total)
  // Quick-add adders, Key's calculator design (2026-05-09). These are NOT
  // baked into the base, they're optional one-click line items that get
  // splatted into extra_line_items when the toggle/chip is on. Keeps the
  // proposal page rendering them exactly like any custom line item; the
  // creator just makes them a single tap to add.
  mainBreaker:    225, // panel main breaker replacement
  twinQuad:       125, // making panel space (twin / quad breaker)
  // RETIRED as a standalone offer (Key 2026-06-09): surge is INSIDE the $447
  // Peace of Mind package now ("surge is POM"). Keys kept defined so any
  // stale reader gets a number instead of NaN; no UI offers them separately.
  surge:          446,
  surgeDiscount:  25,
  adapter:        150, // 30A→50A cord adapter (only when amp = 50)
  // Live deposit policy (Key cutover decision 2026-06-09: 20%). The proposals
  // table's deposit_rate column default writes the real rate; this constant
  // keeps OPERATOR-facing labels + invoice presets in sync with it. The
  // builder's toggle said "50% deposit" while every new proposal charged 20%
  // (2026-06-09 walkthrough finding #17).
  depositRate:    0.20,
};

// Compute the v3 customer-facing total. lineItems is an array of
// { kind: 'item'|'discount', amount, checked, discountType } where item
// uses checked-pre-fill (still added to total when creator saves it on)
// and discount has discountType: 'percent'|'dollar'.
function quoteV3Total({ amp, lengthFt, includeCord, includeInlet, includePermit, lineItems }) {
  const a = String(amp);
  let t = V3_PRICING.base[a] || 0;
  const extraFt = Math.max(0, (Number(lengthFt) || 5) - 5);
  t += extraFt * (V3_PRICING.perFt[a] || 0);
  if (!includeCord)   t -= V3_PRICING.cordOff[a]   || 0;
  if (!includeInlet)  t -= V3_PRICING.inletOff[a]  || 0;
  if (!includePermit) t -= V3_PRICING.permitOff;
  // Two-pass so a discount's POSITION among the rows never changes the math
  // (the creator lets Key reorder rows, and the saved total feeds the customer
  // page). Pass 1: add every checked ITEM to build the full subtotal. Item rows
  // respect `checked` , the customer page only adds an item when its toggle is
  // on, so the creator's "what the client sees" total must match. Pass 2: apply
  // discounts to that full subtotal (a percent discount reordered above an item
  // used to discount only a partial subtotal, over-quoting the customer , bug
  // hunt 2026-06-20). Only one discount is ever persisted, so order among
  // discounts is moot.
  for (const li of (lineItems || [])) {
    if (li.kind !== 'discount' && li.checked !== false) t += Number(li.amount) || 0;
  }
  for (const li of (lineItems || [])) {
    if (li.kind !== 'discount') continue;
    if (li.discountType === 'percent') t -= Math.round(t * (Number(li.amount) || 0) / 100);
    else                                 t -= Number(li.amount) || 0;
  }
  return Math.max(0, Math.round(t));
}

// ── Next Actions engine ───────────────────────────────────────────────
// Derived, never stored. Reads live CRM state and returns the things that
// need Key's attention right now, each with a one-tap resolution. This is
// the "when I get in, what needs me" engine (Key directive 2026-05-28):
// after a proposal is approved the CRM should ask Key to book the install,
// and similar state-driven nudges, each with the easiest way to resolve it.
//
// Rules are deliberately conservative: a nudge appears only when the data
// unambiguously shows the next step, so the list stays trustworthy. The
// CRM never asserts a fact it doesn't have (e.g. it does NOT claim an
// install happened, it ASKS Key to confirm). Returns a priority-sorted
// array of { id, kind, contactId, contactName, label, sub, urgency, ... }.
function computeNextActions(data, now = Date.now()) {
  const contacts  = (data && data.contacts)  || [];
  const proposals = (data && data.proposals) || [];
  const invoices  = (data && data.invoices)  || [];
  const events    = (data && data.events)    || [];
  const messages  = (data && data.messages)  || [];
  const DAY = 86400000;
  const byContact = new Map(contacts.map(c => [c.id, c]));
  const isPast = (c) => c && (c.stage === 'done' || c.archived || c.do_not_contact);

  // Latest live (approved, non-superseded) proposal per contact.
  const approvedByContact = new Map();
  for (const p of proposals) {
    if (!p.approved_at || p.superseded_at) continue;
    if (p.status === 'declined' || p.status === 'cancelled') continue;
    const t = new Date(p.approved_at).getTime();
    if (Number.isNaN(t)) continue;
    const prev = approvedByContact.get(p.contact_id);
    if (!prev || t > prev.t) approvedByContact.set(p.contact_id, { t, p });
  }
  // Contacts that already have an install on the calendar.
  const hasInstallEvent = new Set();
  for (const e of events) {
    if (e.kind === 'install' || e.event_type === 'install') hasInstallEvent.add(e.contact_id);
  }

  const actions = [];

  // RULE readiness (Operating Model 2026 build #3, the buzz layer's CRM face):
  // jobs stalled on KEY between county approval and install day. Reuses
  // advanceJobNext (the canonical job-state engine, the same gates the
  // AdvanceJobCard and the readiness-buzz digest read) per booked+ contact,
  // so the left rail, the contact card, and Key's phone all name the same
  // next step. verify_permit / order_parts are Key's moves; parts_in_transit
  // is the vendor's (no action, but it still OWNS the contact so a premature
  // book_install cannot fire while parts ship); schedule_install becomes
  // suggest_date carrying the AI-suggested day. Permits/materials/readiness
  // resolve from window.CRM like permitNextAction does (same staleness class;
  // the caller's memo lists those window arrays as deps).
  const jobEngineOwned = new Set();
  const advance = window.CRM && typeof window.CRM.advanceJobNext === 'function' ? window.CRM.advanceJobNext : null;
  if (advance) {
    const STAGE_NUM = (window.CRM && window.CRM.STAGE_STR_TO_NUM) || {};
    const permitsAll = (window.CRM && window.CRM.permits) || [];
    for (const c of contacts) {
      if (isPast(c)) continue;
      const stageNum = STAGE_NUM[c.stage] != null ? STAGE_NUM[c.stage] : 0;
      if (stageNum < 3 || stageNum >= 7) continue;       // same window as readiness-buzz
      const next = advance(c, {
        permits: permitsAll.filter(p => p.contact_id === c.id),
        events: events.filter(e => e.contact_id === c.id),
        invoices: invoices.filter(i => i.contact_id === c.id),
      });
      const st = next && next.state;
      if (st !== 'verify_permit' && st !== 'order_parts' && st !== 'parts_in_transit' && st !== 'schedule_install') continue;
      jobEngineOwned.add(c.id);
      if (st === 'parts_in_transit') continue;           // vendor's move, not Key's
      const kind = st === 'schedule_install' ? 'suggest_date' : st;
      const who = c.name || 'this customer';
      actions.push({
        id: kind + ':' + c.id,
        kind,
        contactId: c.id,
        contactName: c.name || 'Customer',
        label: st === 'verify_permit' ? `Verify ${who}'s permit`
             : st === 'order_parts' ? `Order parts for ${who}`
             : `Schedule ${who}'s install`,
        sub: next.sublabel || null,
        suggestedDate: next.suggestedDate || null,
        // Below mark_installed (180+) and aged book_install, above fresh
        // mark_paid (150 base): a gate stalled on Key blocks the whole job.
        urgency: st === 'verify_permit' ? 170 : st === 'order_parts' ? 165 : 160,
      });
    }
  }

  // RULE book_install: a proposal was approved but no install is booked and
  // no install date is set. The exact case Key named. One-tap: pick a date,
  // which creates the calendar event AND sets contacts.install_date (the
  // low-friction calendar path), so install-gated signals start working too.
  for (const [contactId, rec] of approvedByContact) {
    const c = byContact.get(contactId);
    if (!c || isPast(c)) continue;
    if (hasInstallEvent.has(contactId)) continue;
    if (c.install_date) continue;
    // The job engine already named this contact's next step (a readiness gate
    // or the readiness-aware suggest_date); a second generic nudge would be a
    // duplicate or, worse, premature (scheduling before parts are in hand).
    if (jobEngineOwned.has(contactId)) continue;
    const daysSince = Math.floor((now - rec.t) / DAY);
    actions.push({
      id: 'book_install:' + contactId,
      kind: 'book_install',
      contactId,
      contactName: c.name || 'Customer',
      label: `Book install for ${c.name || 'this customer'}`,
      sub: daysSince <= 0 ? 'proposal approved today' : `approved ${daysSince}d ago, not on calendar`,
      urgency: 200 + daysSince,
      amountCents: rec.p.amount_cents || 0,
    });
  }

  // RULE mark_installed: an install was scheduled in the past but never
  // confirmed done. The CRM ASKS (it does not assume completion, per Key:
  // "how do you know it was completed?"). One-tap confirm captures the fact
  // going forward. Mutually exclusive with book_install (that fires only
  // when nothing is booked; this fires only when a past install exists).
  const seenInstallAsk = new Set();
  for (const e of events) {
    if (!(e.kind === 'install' || e.event_type === 'install')) continue;
    // calendar_events_status_check allows only scheduled/cancelled/completed;
    // 'done' is dead vocabulary that can never match a real row (removed).
    if (e.status === 'completed' || e.status === 'cancelled') continue;
    const t = e.start_at ? new Date(e.start_at).getTime() : NaN;
    if (Number.isNaN(t) || t > now) continue;            // only past installs
    const c = byContact.get(e.contact_id);
    if (!c || c.archived) continue;
    if (seenInstallAsk.has(e.contact_id)) continue;
    seenInstallAsk.add(e.contact_id);
    const daysPast = Math.floor((now - t) / DAY);
    actions.push({
      id: 'mark_installed:' + e.contact_id,
      kind: 'mark_installed',
      contactId: e.contact_id,
      contactName: c.name || 'Customer',
      eventId: e.id,
      label: `Did ${c.name || 'this customer'}'s install happen?`,
      sub: daysPast <= 0 ? 'scheduled today' : `scheduled ${daysPast}d ago, not confirmed`,
      urgency: 180 + daysPast,
    });
  }

  // RULE mark_paid: an invoice was sent and is not marked paid. Key records
  // most payments in another app, so this is the nudge that makes the CRM's
  // "paid" number become true going forward. Not gated on install state
  // (the CRM doesn't reliably know completion, and the customer owes once
  // invoiced regardless). One-tap: pick the method.
  for (const inv of invoices) {
    if (inv.paid_at) continue;
    if (!(inv.status === 'sent' || inv.status === 'viewed' || inv.status === 'overdue')) continue;
    const c = byContact.get(inv.contact_id);
    if (!c || c.archived) continue;                      // skip archived/void contacts
    const t = inv.sent_at ? new Date(inv.sent_at).getTime() : NaN;
    const daysSince = Number.isNaN(t) ? 0 : Math.floor((now - t) / DAY);
    actions.push({
      id: 'mark_paid:' + inv.id,
      kind: 'mark_paid',
      contactId: inv.contact_id,
      contactName: c.name || 'Customer',
      invoiceId: inv.id,
      amountCents: inv.amount_cents || 0,
      label: `Mark ${c.name || 'this customer'} paid`,
      sub: `${formatMoneyCents(inv.amount_cents || 0)} unpaid` + (daysSince > 0 ? `, sent ${daysSince}d ago` : ''),
      urgency: 150 + Math.min(daysSince, 40),
    });
  }

  // RULE cold_leads: stage-1 leads that never replied and have sat quiet for
  // 7+ days. Emitted as ONE grouped nudge (not N rows) so it never drowns the
  // money/install actions, and it routes to the existing "Silent leads" lens
  // where the authoritative list lives. Resolution is manual: Key opens the
  // thread and texts. The CRM NEVER auto-sends (Key directive).
  const inboundSet = new Set();
  for (const m of messages) {
    if (m.direction === 'in' || m.direction === 'inbound') inboundSet.add(m.contact_id);
  }
  let coldCount = 0;
  for (const c of contacts) {
    if (c.archived || c.do_not_contact) continue;
    if (c.stage !== 'new') continue;
    const created = c.created_at ? new Date(c.created_at).getTime() : NaN;
    if (Number.isNaN(created) || (now - created) < 7 * DAY) continue;
    if (inboundSet.has(c.id)) continue;                  // they replied -> not cold
    coldCount++;
  }
  if (coldCount > 0) {
    actions.push({
      id: 'cold_leads',
      kind: 'cold_leads',
      count: coldCount,
      label: `Follow up with ${coldCount} cold lead${coldCount > 1 ? 's' : ''}`,
      sub: 'never replied, quiet 7+ days',
      urgency: 50,                                        // below money/install nudges
    });
  }

  actions.sort((a, b) => b.urgency - a.urgency);
  return actions;
}

// ── Work Queue ───────────────────────────────────────────────────────────────
// Stage-1 follow-up queue. Pure: given a 'new'-stage contact + its messages,
// return a priority score, a bucket, and a ready-to-COPY message (Key pastes it
// into Quo and sends it himself; the CRM never contacts a customer). Returns
// null for non-workable contacts. Bucket logic is reliable from `messages`
// alone: inbound = the customer replied (hottest), else age decides the touch.
// Full spec: docs/work-queue-design-brief.md.
const WORK_QUEUE_TEMPLATES = {
  replied: { label: 'REPLIED', tone: { color: '#065F46', bg: '#D1FAE5' },
    text: (n) => `Hey ${n}, Key with Backup Power Pro. We were talking about wiring your generator into your panel and I dropped the ball getting back to you, my fault. Still want me to put your exact all-in price together? Takes me two minutes.` },
  fresh: { label: 'NEW', tone: { color: '#1E40AF', bg: '#DBEAFE' },
    text: (n) => `Hi ${n}, Key with Backup Power Pro following up. You reached out about getting your generator connected to your panel. Want me to text you the all-in price, or is a quick call easier?` },
  aging: { label: 'AGING', tone: { color: '#92400E', bg: '#FEF3C7' },
    text: (n) => `${n}, checking in once. Still want your generator wired to the panel? I can put your all-in price together when you are ready. Want me to?` },
  cold: { label: 'COLD', tone: { color: '#6B7280', bg: '#F3F4F6' },
    text: (n) => `Hey ${n}, I do not want to keep bugging you. Should I close out your generator quote for now, or are you still thinking it over? Totally fine either way, just let me know.` },
};

function workQueueFor(contact, msgs, now = Date.now()) {
  if (!contact || contact.stage !== 'new' || contact.archived) return null;
  const created = contact.created_at ? new Date(contact.created_at).getTime() : now;
  const ageDays = Math.max(0, Math.floor((now - created) / 86400000));
  const hasInbound = (msgs || []).some(m => m.direction === 'in');
  const bucket = hasInbound ? 'replied' : ageDays <= 7 ? 'fresh' : ageDays <= 30 ? 'aging' : 'cold';
  const score = (hasInbound ? 1000 : 0) + Math.max(0, 60 - ageDays) * 3;
  const tpl = WORK_QUEUE_TEMPLATES[bucket];
  const firstName = ((contact.name || '').trim().split(/\s+/)[0]) || 'there';
  return { bucket, label: tpl.label, tone: tpl.tone, score, ageDays, hasInbound, message: tpl.text(firstName) };
}

// ── Permit-not-started signal ────────────────────────────────────────
// True when a contact is booked-or-approved (signed proposal OR stage past
// booked) but has not yet had a permit filed, and has not advanced past the
// permit-submit stage. Drives the amber "NO PERMIT" badge in the contact row
// and the contact detail Permits card. Self-contained: depends only on the
// window.CRM.* globals (STAGE_STR_TO_NUM, proposals, permits) which the data
// layer always populates.
function permitNotStarted(contact) {
  if (!contact) return false;
  const stageNum = (window.CRM?.STAGE_STR_TO_NUM || {})[contact.stage] ?? 0;
  const bookedNum = (window.CRM?.STAGE_STR_TO_NUM || {}).booked ?? 3;
  const submitNum = (window.CRM?.STAGE_STR_TO_NUM || {}).permit_submit ?? 4;
  if (stageNum >= submitNum) return false;
  const hasSignedProposal = (window.CRM?.proposals || []).some(
    p => p.contact_id === contact.id && p.status === 'approved');
  const isBookedOrApproved = stageNum >= bookedNum || hasSignedProposal;
  if (!isBookedOrApproved) return false;
  const permits = (window.CRM?.permits || []).filter(p => p.contact_id === contact.id);
  if (permits.length === 0) return true;
  return permits.every(p => p.status === 'not_started' || p.permit_number === 'PENDING');
}

// permitNextAction(contact): if THIS contact's next job step is a permit
// action (submit the permit / mark it approved / resolve a blocker), return a
// compact { kind, label, sublabel } for the Working On rail + a Permits lens;
// otherwise null (the next step is not about a permit). Permit fast-path,
// tap-audit #3: permits had no quick path, so a job sitting on the county was
// invisible until you opened the contact. Reuses advanceJobNext (the canonical
// job-state engine) pre-filtered to this contact, since advanceJobNext expects
// per-contact arrays. The kind mirrors advanceJobNext's permit states so the
// rail + the AdvanceJobCard speak the same verb.
function permitNextAction(contact) {
  if (!contact) return null;
  const C = window.CRM || {};
  const id = contact.id;
  if (contact.archived || contact.do_not_contact) return null;
  const next = (typeof C.advanceJobNext === 'function')
    ? C.advanceJobNext(contact, {
        permits: (C.permits || []).filter(p => p.contact_id === id),
        events: (C.events || []).filter(e => e.contact_id === id),
        invoices: (C.invoices || []).filter(i => i.contact_id === id),
      })
    : null;
  if (!next) return null;
  const PERMIT_STATES = { submit_permit: 1, mark_approved: 1, permit_blocked: 1 };
  if (!PERMIT_STATES[next.state]) return null;
  return { kind: next.state, label: next.label, sublabel: next.sublabel };
}

// ── useHScrollFade, one calm "there is more" affordance ─────────────
// A right-edge mask fade that appears only when a horizontal scroller
// actually overflows and is not scrolled to the end. Apply via
// className="bpp-hscroll" + ref={useHScrollFade()} to EVERY sideways
// scroller (the Working On rail, filter chips, recent/saved) so the
// affordance means the same thing everywhere (Key: the rail had none
// while another scroller faded).
function useHScrollFade() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    const upd = () => {
      const over = el.scrollWidth - el.clientWidth > 2;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      if (over && !atEnd) el.setAttribute('data-fade-r', ''); else el.removeAttribute('data-fade-r');
    };
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);
    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(upd); ro.observe(el); }
    return () => { el.removeEventListener('scroll', upd); window.removeEventListener('resize', upd); if (ro) ro.disconnect(); };
  });
  return ref;
}

// CM-25: the business inbound line (calls land here). Single source so the
// calls-tab helper copy can't drift from the real number. Matches the stub
// line in crm-data.js (+18648637800) and the dialer config.
const BPP_MAIN_LINE = '8648637800';

// CM-3: a transcript that never arrived. A voicemail/call older than ~5 min
// with no transcript is not still processing (transcribe-call / the Twilio
// transcription callback only write on success, so a null past that window is
// a failure/empty), so the UI shows a terminal "Transcript unavailable" rather
// than a forever "Transcribing..." spinner. Shared by the calls list + card.
function transcriptUnavailable(startedAt) {
  if (!startedAt) return false;
  const t = new Date(startedAt).getTime();
  if (isNaN(t)) return false;
  return (Date.now() - t) > 5 * 60 * 1000;
}

// Export everything
Object.assign(window, {
  transcriptUnavailable, BPP_MAIN_LINE,
  computeNextActions, workQueueFor, permitNotStarted, permitNextAction,
  NAVY, GOLD, BG, CARD, MUTED, NOW, RADIUS, SHADOW, SPACE, contactHasInstalled, isInvoiceOverdue, invoiceOwedCents, buildInstalledSet,
  Icons, NavBar, ContactAvatar, GoldDot, StatusPill, Pill,
  ToastHost, ConfirmHost, EmptyHero, VoiceMemoButton,
  capitalize, formatPhone, formatPhoneInput, linkify, formatRelative, formatMoneyCents, buildContactSignals,
  formatDate, formatTime, formatTimeShort, formatDuration, dayKey,
  relTime, fmtTime, fmtDate,
  QB_C, QB_S, TIER_META, TIER_IDS, quickQuoteTotal, quickQuoteCompute,
  V3_PRICING, quoteV3Total,
  safeSetItem, isAddressableStreet, copyText,
  useContactPropertyImage, propertyImageIdentity,
  readSnoozeMap, snoozeContact, unsnoozeContact, isSnoozed, snoozedUntil,
  readSchedQueue, scheduleMessage, cancelScheduledMessage, startScheduledQueueRunner,
  usePinned, readPinnedSet, useHScrollFade,
  // iOS Phase 1 shell primitives, consumed bare in crm-app.jsx and
  // (LargeTitleHeader / IosNavBar / SegmentedControl) in crm-left.jsx and
  // crm-right.jsx.
  BottomTabBar, LargeTitleHeader, IosNavBar, SegmentedControl,
});
