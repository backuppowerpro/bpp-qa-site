/* =============================================================================
   BPP CRM CARD CONTRACT + REGISTRY   (Key directive 2026-06-09)
   -----------------------------------------------------------------------------
   "what about each element being a square or rectangle so it's easy to design
    separate and to add to the CRM"

   Every CRM element is a self-contained rectangle ("card"):
     - designed alone in Claude Design (one comp == one card),
     - registered here (one entry),
     - dropped into the CRM via the registry,
     - previewed + QA'd in isolation at /crm/v3/cards.html (no login).

   This was already the pattern that made the permit audit fast: each element
   was mounted as a standalone rectangle with mock data and looked at on its
   own. This file makes that permanent.

   ---------------------------------------------------------------------------
   THE CONTRACT
   ---------------------------------------------------------------------------
   A card COMPONENT renders a bounded rectangle and takes one ctx-shaped prop
   set:
       Card({ contact, data, bumpData })
         contact  : the active contact row (or null in tool/empty contexts)
         data     : this card's data slice, e.g. { permits: [...] }
         bumpData : () => void   refresh CRM data after a write
   NEW cards SHOULD follow this signature directly.

   A REGISTRY ENTRY adapts any component (even a legacy prop shape) to the
   contract so the host never needs to know a card's internal props:
       {
         id        : 'permits',             // stable key
         title     : 'Permits',             // human label (harness + docs)
         span      : 'full' | 'half',       // layout hint for the host grid
         showWhen  : (ctx) => boolean,      // render only when true
         render    : (ctx) => ReactElement, // adapt ctx -> the component
       }

   The live contact panel can LATER read this registry to render its card
   column. Today the registry + the /crm/cards harness are the foundation and
   the live panel is unchanged. Adding a future card = append one entry here
   (+ an approved Claude Design comp if it is net-new visual).
   ---------------------------------------------------------------------------
   Loaded as type="text/babel" AFTER the component files so bare component
   references (PermitsCard, PermitPortalsButton) resolve in the same scope.
   ============================================================================= */

(function () {
  var CRM = (window.CRM = window.CRM || {});

  function stageNum(stage) {
    var map = CRM.STAGE_STR_TO_NUM || {};
    return map[stage] != null ? map[stage] : 0;
  }
  // Prefer the card's own data slice (harness fixtures / host-provided), fall
  // back to the global CRM cache (live app today). Keeps the same render path
  // working in the isolated harness and in the real CRM.
  function permitsFor(ctx) {
    if (ctx && ctx.data && Array.isArray(ctx.data.permits)) return ctx.data.permits;
    var cid = ctx && ctx.contact && ctx.contact.id;
    return (CRM.permits || []).filter(function (p) { return p.contact_id === cid; });
  }

  // Registry order == the order these sections render in the live contact
  // panel's trailing block (Stage history, Activity, Permits). The live panel
  // calls renderCardColumn with ctx.data carrying each card's slice, so a
  // structural carve here must keep order + gates byte-identical to the old
  // direct JSX.
  window.CRM_CARDS = [
    {
      id: 'ai-summary',
      title: 'AI summary',
      span: 'full',
      // The enrichment bot's living setup note (contacts.ai_summary). Comms
      // platform Phase 5 (comp contact-additions.html, Key-validated
      // 2026-06-10). Renders nothing until the bot has written a summary.
      showWhen: function (ctx) { return !!(ctx && ctx.contact && ctx.contact.ai_summary); },
      render: function (ctx) {
        return React.createElement(window.AISummaryCard, { contact: ctx.contact });
      },
    },
    {
      id: 'media',
      title: 'Media',
      span: 'full',
      // CRM revamp 2026-06-10 (B3): one Media card replacing the two
      // back-to-back photo cards (photos + customer-photos). MediaCard hosts
      // two labeled sub-sections: Job photos (installer/private uploads +
      // SMS-attached images, the upload surface, always shown with its own
      // empty state) and Customer photos (texted-in MMS, shown only when
      // images exist). Keeps registry position #0 so the panel order is
      // unchanged (Media -> Next step -> ...). Reads window.CRM.jobPhotos +
      // message-media + contact_photos; the harness stub renders the empty
      // Job-photos state. MediaCard lives in crm-right.jsx (window.MediaCard).
      showWhen: function (ctx) { return !!(ctx && ctx.contact); },
      render: function (ctx) {
        return React.createElement(window.MediaCard, { contact: ctx.contact });
      },
    },
    {
      id: 'ai-suggestions',
      title: 'AI suggestion',
      span: 'full',
      // Pending enrichment suggestions (contact_field_provenance applied=false,
      // undone_at null). Confirm writes the field + applied=true; Dismiss sets
      // undone_at. The address confirm-only rule lands here. Renders nothing
      // when there are no pending suggestions.
      showWhen: function (ctx) { return !!(ctx && ctx.contact); },
      render: function (ctx) {
        return React.createElement(window.AISuggestionsCard, { contact: ctx.contact, bumpData: ctx.bumpData });
      },
    },
    {
      id: 'advance-job',
      title: 'Next step',
      span: 'full',
      // The one-tap back-half control. Shows for any booked+ job (stage >= 3).
      // Designed in Claude Code + wired to the advanceJob* helpers per Key's
      // 2026-06-09 directive (no Claude Design gate on CRM blocks). Renders
      // first in the trailing block so the next action is the top thing Key
      // sees on a booked job.
      showWhen: function (ctx) {
        var c = ctx && ctx.contact;
        if (!c) return false;
        var map = CRM.STAGE_STR_TO_NUM || {};
        var bookedNum = map.booked != null ? map.booked : 3;
        return stageNum(c.stage) >= bookedNum;
      },
      render: function (ctx) {
        return React.createElement(AdvanceJobCard, {
          contact: ctx.contact,
          data: ctx.data || {},
          bumpData: ctx.bumpData || function () {},
          onOpenTab: ctx.onOpenTab || function () {},
        });
      },
    },
    {
      id: 'stage-history',
      title: 'Stage history',
      span: 'full',
      // Ungated on the live panel (renders for every contact).
      showWhen: function (ctx) { return !!(ctx && ctx.contact); },
      render: function (ctx) {
        return React.createElement(StageHistoryCard, { contact: ctx.contact });
      },
    },
    {
      id: 'activity',
      title: 'Activity timeline',
      span: 'full',
      // Ungated on the live panel.
      showWhen: function (ctx) { return !!(ctx && ctx.contact); },
      render: function (ctx) {
        var d = (ctx && ctx.data) || {};
        return React.createElement(ActivityTimelineCard, {
          contact: ctx.contact,
          messages: d.messages || [],
          calls: d.calls || [],
          proposals: d.proposals || [],
          invoices: d.invoices || [],
          events: d.events || [],
          onOpenTab: ctx.onOpenTab || function () {},
        });
      },
    },
    {
      id: 'permits',
      title: 'Permits',
      span: 'full',
      // LIVE gate: the panel shows Permits once a proposal is signed (it
      // passes data.latestSigned) OR once the contact already HAS a permit
      // row (a permit created via AdvanceJobCard on a booked+ contact with
      // no signed proposal was otherwise unreachable, audit 2026-06-10).
      // Clean pre-deal contacts with no permits keep the signed gate.
      // Harness fixtures that do not pass latestSigned fall back to the
      // stage heuristic (booked+ OR a permit row exists) so the card
      // library still renders every state.
      showWhen: function (ctx) {
        var d = ctx && ctx.data;
        if (d && 'latestSigned' in d) return !!d.latestSigned || permitsFor(ctx).length > 0;
        var c = ctx && ctx.contact;
        if (!c) return false;
        var map = CRM.STAGE_STR_TO_NUM || {};
        var bookedNum = map.booked != null ? map.booked : 3;
        return stageNum(c.stage) >= bookedNum || permitsFor(ctx).length > 0;
      },
      render: function (ctx) {
        return React.createElement(PermitsCard, {
          permits: permitsFor(ctx),
          contact: ctx.contact,
          bumpData: ctx.bumpData || function () {},
        });
      },
    },
  ];

  // Global TOOLS (not per-contact cards). Rendered in the harness for design
  // and surfaced in the CRM toolbar, NOT in the contact card column.
  window.CRM_TOOLS = [
    {
      id: 'permit-portals',
      title: 'Permit portals directory',
      render: function () {
        return React.createElement(PermitPortalsButton);
      },
    },
  ];

  // Renders the applicable card column for a contact (the live panel's
  // trailing block consumes this). ctx.exclude: optional array of card ids
  // the host renders elsewhere (e.g. 'advance-job' now renders at the TOP of
  // the contact panel per Key's action-first decision 2026-06-09, so the
  // trailing block skips it to avoid a duplicate).
  window.renderCardColumn = function (ctx) {
    var excluded = (ctx && ctx.exclude) || [];
    return (window.CRM_CARDS || [])
      .filter(function (card) {
        if (excluded.indexOf(card.id) > -1) return false;
        try { return card.showWhen ? card.showWhen(ctx) : true; }
        catch (e) { return false; }
      })
      .map(function (card) {
        return React.createElement(
          'div',
          { key: card.id, 'data-card-id': card.id },
          card.render(ctx)
        );
      });
  };
})();
