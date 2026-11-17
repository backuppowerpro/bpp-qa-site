/* Existing ending shell, with server-owned text receipts and no web uploader. */
(function () {
  'use strict';
  window.BPPGuidedPhotos = {
    textReplyOnly: true,
    inlineEstimate: true,
    mount: async function (ctx) {
      var element = ctx.element || BPPGuidedSaved.element;
      function render() {
        if (!ctx.guard()) return;
        var state = ctx.state(), review = ctx.review();
        var snapshot = state.current_range_snapshot || {};
        var accepted = Boolean(snapshot.status === 'available' && snapshot.snapshot_id && state.accepted_range_snapshot_id === snapshot.snapshot_id);
        var correction = review.current_correction;
        var activeCorrection = correction && !correction.resolved_at && !correction.response_submission_id;
        var guided = WALK.isGuidedJourney(ctx.view, ctx.token);
        var initialPanelSaved = state.initial_panel_photo_saved === true;
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
        var compactEnding = guided && initialPanelSaved && !photosReady && !activeCorrection;
        var guideView = ctx.currentView ? ctx.currentView() : ctx.view;
        var minimalEnding = Boolean(ctx.inlineEstimate && compactEnding && window.BPPEstimateTerminal && BPPEstimateTerminal.confirmed(guideView));
        ctx.content.setAttribute('data-confirmation-layout', minimalEnding ? 'minimal' : 'standard');
        if (minimalEnding) {
          var receivedHeading = element('h2', '', 'guided-received-title');
          var receivedCheck = element('span', '\u2713', 'guided-received-check'); receivedCheck.setAttribute('aria-hidden', 'true');
          receivedHeading.append(receivedCheck, element('span', 'Request received'));
          var receivedOwner = element('div', '', 'guided-received-owner');
          var receivedPortrait = element('img', '', 'guided-received-owner-photo');
          receivedPortrait.src = '/assets/images/key-headshot.jpg'; receivedPortrait.alt = ''; receivedPortrait.width = receivedPortrait.height = 40;
          receivedPortrait.setAttribute('aria-hidden', 'true'); receivedPortrait.decoding = 'async';
          var receivedOwnerCopy = element('div', '', 'guided-received-owner-copy');
          var receivedFirstName = typeof ctx.acceptedFirstName === 'function' ? ctx.acceptedFirstName() : '';
          receivedFirstName = typeof receivedFirstName === 'string' ? receivedFirstName.trim() : '';
          receivedOwnerCopy.append(element('p', 'Key Goodson', 'guided-received-owner-name'), element('p', receivedFirstName ? 'Thanks, ' + receivedFirstName + '.' : 'Thanks.', 'guided-received-thanks'));
          receivedOwner.append(receivedPortrait, receivedOwnerCopy);
          var receivedPreferences = guideView.communication_preferences || {};
          var receivedFollowup = (guideView.quote_walk_v2.photo_review || {}).followup || {};
          var receivedTextExpected = receivedPreferences.sms_effective === true && receivedFollowup.current === true
            && ['sent', 'pending', 'unconfirmed'].indexOf(receivedFollowup.status) !== -1;
          ctx.content.replaceChildren(receivedHeading, receivedOwner, element('p', receivedTextExpected ? 'Watch for a text from me asking when you\u2019d like your installation. Just reply there and we\u2019ll take it from here.' : 'I\u2019ll review your panel photo before preparing your firm price.', 'guided-received-next'));
          var promotionalChoice = guideView.communication_preferences && guideView.communication_preferences.email_promotions_choice;
          var promotionsOnly = promotionalChoice && promotionalChoice.version === 'bpp-email-promotions-2026-11-11'
            && typeof promotionalChoice.promotions === 'boolean' && promotionalChoice.dispatch_enabled === false;
          var retiredGuide = guideView.quote_walk_v2.power_guide_delivery;
          var guideRetired = retiredGuide && retiredGuide.contract === 'bpp-power-guide-delivery-v1'
            && retiredGuide.status === 'unavailable' && retiredGuide.providerAccepted === false && retiredGuide.reason === 'guide_delivery_retired';
          var receivedGuideChoice = promotionsOnly || guideRetired ? false : ctx.guideChoice ? ctx.guideChoice() : undefined;
          if (window.BPPPowerGuideReceipt && typeof BPPPowerGuideReceipt.renderCompact === 'function') BPPPowerGuideReceipt.renderCompact(ctx.content, guideView, receivedGuideChoice);
          else if (receivedGuideChoice === true) {
            ctx.content.appendChild(element('p', 'Your guide email is not confirmed yet.', 'guided-received-guide'));
            var pendingGuideLink = element('a', 'View your guide', 'guided-link guided-received-guide-link'); pendingGuideLink.href = '/generator-guide/';
            ctx.content.appendChild(pendingGuideLink);
          }
          else if (receivedGuideChoice === false) {
            var receivedGuideLink = element('a', 'View your guide', 'guided-link guided-received-guide-link'); receivedGuideLink.href = '/generator-guide/';
            ctx.content.appendChild(receivedGuideLink);
          }
          ctx.focus();
          return;
        }
        ctx.content.replaceChildren(element(ctx.inlineEstimate ? 'h2' : 'h1', activeCorrection ? 'Key needs another look at your setup' : complete ? "You're all set." : photosReady ? 'Your photos are saved.' : guided ? initialPanelSaved ? 'Your photo and details are received.' : 'Text one panel photo to start.' : accepted ? "Send your photos when you're ready." : 'Your saved setup needs photos.'));
        if (activeCorrection && correction.request_text) ctx.content.appendChild(element('p', String(correction.request_text)));
        var acceptanceMessage = accepted ? 'Your estimate range is accepted. No payment is due now.' : 'Your answers are saved. Key still needs photos before completing the setup review.';
        if (compactEnding) ctx.content.appendChild(element('p', (accepted ? 'No further action is needed now. ' : 'You do not need to send it again. ') + acceptanceMessage, 'guided-panel-receipt'));
        else ctx.content.appendChild(element('p', acceptanceMessage));
        if (compactEnding) {
          var preferences = ctx.view.communication_preferences || {};
          ctx.content.appendChild(element('p', preferences.sms_effective === true ? 'Key will review your setup and text your firm price or any questions.' : 'Key will review your setup before preparing your firm price.', 'guided-review-expectation'));
          var packageCopy = window.BPPGuidedEstimate && typeof BPPGuidedEstimate.summary === 'function' ? BPPGuidedEstimate.summary(snapshot) : '';
          if (packageCopy && !ctx.inlineEstimate) ctx.content.appendChild(element('p', packageCopy, 'guided-package-summary'));
        }
        if (ctx.inlineEstimate) {
          if (window.BPPPowerGuideReceipt) BPPPowerGuideReceipt.render(ctx.content, guideView, ctx.guideChoice ? ctx.guideChoice() : undefined);
          else if (guideView.quote_walk_v2.power_guide_delivery && guideView.quote_walk_v2.power_guide_delivery.reason === 'guide_delivery_retired'
              && window.BPPEstimateTerminal && BPPEstimateTerminal.confirmed(guideView)) {
            var retiredGuideLink = element('a', 'View your guide', 'guided-link'); retiredGuideLink.href = '/generator-guide/';
            ctx.content.appendChild(retiredGuideLink);
          }
          else if (ctx.guideChoice && ctx.guideChoice() === true && window.BPPEstimateTerminal && BPPEstimateTerminal.confirmed(guideView)) {
            var guideFallback = element('p', 'Your guide email is not confirmed yet. ');
            var guideLink = element('a', 'View your guide', 'guided-link'); guideLink.href = '/generator-guide/';
            guideFallback.appendChild(guideLink); ctx.content.appendChild(guideFallback);
          }
        }
        var supportingContent = ctx.content;
        var message = status === 'sent' ? 'Check your messages at ' + destination + '.'
          : status === 'pending' ? 'The photo request is still pending for ' + destination + '.'
          : status === 'unavailable' ? 'Text updates to ' + destination + ' are unavailable right now. Your request is still saved.'
          : 'Your request is saved. We could not confirm the text yet. Check your messages at ' + destination + '.';
        if (compactEnding) message = status === 'sent' ? 'A text was sent to ' + destination + '.'
          : status === 'pending' ? 'A text to ' + destination + ' is still pending.'
          : status === 'unavailable' ? 'Text updates to ' + destination + ' are unavailable right now. Your request is still saved.'
          : 'Your request is saved. The text to ' + destination + ' has not been confirmed yet.';
        if (compactEnding && preferences.sms_effective !== true && status !== 'sent') message = 'Your request is saved. Text updates are not enabled for your current contact preferences.';
        if (numberChanged) message += compactEnding && preferences.sms_effective !== true && status !== 'sent' ? ' Your saved mobile number now ends in ' + currentLast4 + '.' : ' That is your previous number. Your saved mobile number now ends in ' + currentLast4 + '.';
        supportingContent.appendChild(element('p', message));
        if (photosReady) ctx.content.appendChild(element('p', 'Your existing photos are saved for Key to review. You do not need to send them again.'));
        else if (!activeCorrection && guided && !initialPanelSaved) {
          ctx.content.appendChild(element('p', "Reply to Key's text with one photo of the outside of your closed electrical panel. Include the whole panel and any model label already visible. If you do not see a text, use the number below."));
          var example = element('figure', '', 'guided-outlet-reference'); example.dataset.panelPhotoExample = '';
          var image = element('img'); image.addEventListener('error', function () { example.hidden = true; }); image.src = '/walk-v2/closed-panel-example.jpg'; image.alt = 'Illustration of a closed electrical panel on a plain wall'; image.width = image.height = 900; image.decoding = 'async';
          example.appendChild(image); example.appendChild(element('figcaption', 'Example illustration: keep the whole panel closed.')); ctx.content.appendChild(example);
        } else if (!guided) ctx.content.appendChild(element('p', "Reply to Key's text with photos of generator outlets and labels, if you have one, while it's off and cool; the outside of your closed electrical panel and any model label already visible; and a wide view of the inlet spot, surroundings and path to the panel. If you do not see a text, send them to the number below."));
        if (!photosReady && !compactEnding) ctx.content.appendChild(element('p', guided ? "Keep everything closed. Don't remove screws or covers. Need help or can't take a photo safely? Tell Key." : "Only take photos you can get safely. Don't open electrical equipment or remove covers. Can't get a photo safely? Tell Key."));
        var from = element('p'); from.appendChild(element('span', 'Our texting number: '));
        var number = element('a', '(864) 863-7800', 'guided-link'); number.href = 'sms:+18648637800'; from.appendChild(number);
        if (guided && initialPanelSaved && !photosReady && !activeCorrection) {
          from.firstChild.remove(); number.textContent = 'Text Key (optional)'; number.className = 'guided-link qw-secondary-action';
          number.setAttribute('aria-label', 'Text Key at (864) 863-7800 (optional)');
        }
        if (compactEnding) supportingContent.appendChild(from);
        else ctx.content.appendChild(from);
        if (status !== 'sent' || numberChanged) {
          var edit = element('button', 'Check or change mobile number', 'guided-link'); edit.type = 'button';
          edit.onclick = function () { if (ctx.inlineEstimate && ctx.editDetails) ctx.editDetails(); else WALK.go('index.html', ctx.token, { edit: 'details' }); };
          if (compactEnding) supportingContent.appendChild(edit);
          else ctx.content.appendChild(edit);
        }
        if (!compactEnding) ctx.content.appendChild(element('p', !photosReady && guided && !activeCorrection ? 'Key will check compatibility and review your estimate. He may ask for another view before preparing your firm proposal.' : 'Key will review your photos before preparing your firm proposal.', 'guided-review-expectation'));
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
