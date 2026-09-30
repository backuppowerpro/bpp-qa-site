/* Existing ending shell, with server-owned text receipts and no web uploader. */
(function () {
  'use strict';
  window.BPPGuidedPhotos = {
    textReplyOnly: true,
    mount: async function (ctx) {
      var element = BPPGuidedSaved.element;
      function render() {
        if (!ctx.guard()) return;
        var state = ctx.state(), review = ctx.review();
        var snapshot = state.current_range_snapshot || {};
        var accepted = Boolean(snapshot.status === 'available' && snapshot.snapshot_id && state.accepted_range_snapshot_id === snapshot.snapshot_id);
        var correction = review.current_correction;
        var activeCorrection = correction && !correction.resolved_at && !correction.response_submission_id;
        var guided = WALK.isGuidedJourney(ctx.view, ctx.token);
        var readiness = state.readiness || {};
        var legacyBlockers = state.blockers || readiness.input_blockers || [];
        var currentMedia = Array.isArray(state.media) && state.media.some(function (media) {
          return media && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(media.id || '')
            && /^trusted:media:[a-f0-9]{64}$/.test(media.receipt_key || '')
            && ['generator_connection', 'main_panel', 'panel_context', 'setup_photo'].indexOf(media.role) !== -1
            && Number.isSafeInteger(media.created_version) && media.created_version > 0 && media.created_version <= state.version
            && media.superseded_version == null;
        });
        var legacyPhotosSaved = !guided && accepted
          && readiness.ready_for_handoff === true && readiness.snapshot_id === snapshot.snapshot_id
          && readiness.journey_version === state.version && /^[a-f0-9]{64}$/.test(snapshot.scope_hash || '') && readiness.scope_hash === snapshot.scope_hash
          && currentMedia
          && !legacyBlockers.some(function (blocker) { return /_photo$/.test(String(blocker)); });
        var photosReady = !activeCorrection && (legacyPhotosSaved || review.manual_review_current === true || review.submission_current === true && review.latest_submission && review.newer_photo_draft !== true && review.packet_status === 'submitted');
        var legacyDelivery = !guided && accepted && state.handoff_recorded === true ? state.opener_delivery || {} : {};
        var followup = review.followup && review.followup.current === true ? review.followup
          : legacyDelivery.result === 'sent' && /^\d{4}$/.test(legacyDelivery.destination_last4 || '')
            ? { status: 'sent', phone_last4: legacyDelivery.destination_last4 } : {};
        var last4 = /^\d{4}$/.test(followup.phone_last4 || '') ? followup.phone_last4 : '';
        var destination = last4 ? 'the number ending in ' + last4 : 'your saved mobile number';
        var status = followup.status || 'unconfirmed';
        var currentDigits = String(ctx.view.phone || '').replace(/\D/g, '');
        var currentLast4 = /^1?\d{10}$/.test(currentDigits) ? currentDigits.slice(-4) : '';
        var numberChanged = Boolean(last4 && currentLast4 && last4 !== currentLast4);
        var complete = photosReady && (!legacyPhotosSaved || state.handoff_recorded === true);
        ctx.content.replaceChildren(element('h1', activeCorrection ? 'Key needs another look at your setup' : complete ? "You're all set." : photosReady ? 'Your photos are saved.' : accepted ? "Send your photos when you're ready." : 'Your saved setup needs photos.'));
        if (activeCorrection && correction.request_text) ctx.content.appendChild(element('p', String(correction.request_text)));
        ctx.content.appendChild(element('p', accepted ? 'Your range is accepted. No payment is due now.' : 'Your answers are saved. Key still needs photos before completing the setup review.'));
        var message = status === 'sent' ? 'Check your messages at ' + destination + '.'
          : status === 'pending' ? 'The photo request is pending at ' + destination + '. Check your messages.'
          : status === 'unavailable' ? 'Your request is saved, but we could not send a text to ' + destination + '.'
          : 'Your request is saved. We could not confirm the text yet. Check your messages at ' + destination + '.';
        if (numberChanged) message += ' That is your previous number. Your saved mobile number now ends in ' + currentLast4 + '.';
        ctx.content.appendChild(element('p', message));
        if (photosReady) ctx.content.appendChild(element('p', 'Your existing photos are saved for Key to review. You do not need to send them again.'));
        else ctx.content.appendChild(element('p', "Reply to Key's text with photos of your generator outlets, the panel with its hinged outer door open, and the outdoor connection area and path back to the panel. If you do not see a text, send them to the number below."));
        if (!photosReady) ctx.content.appendChild(element('p', 'Open only the hinged outer panel door if safe. Never remove screws or the inner cover.'));
        var from = element('p'); from.appendChild(element('span', 'Our texting number: '));
        var number = element('a', '(864) 863-7800', 'guided-link'); number.href = 'sms:+18648637800'; from.appendChild(number);
        ctx.content.appendChild(from);
        if (status !== 'sent' || numberChanged) {
          var edit = element('button', 'Check or change mobile number', 'guided-link'); edit.type = 'button';
          edit.onclick = function () { WALK.go('index.html', ctx.token, { edit: 'details' }); };
          ctx.content.appendChild(edit);
        }
        ctx.content.appendChild(element('p', 'Key will review your photos before preparing your firm proposal.'));
        ctx.focus();
      }
      ctx.reload = async function () {
        if (ctx.busy) return;
        ctx.busy = true;
        try { await ctx.load(); render(); ctx.error(''); }
        catch (_) { ctx.error('Your saved request could not refresh. Reload to check the current next step.'); }
        finally { ctx.busy = false; }
      };
      render();
    }
  };
})();
