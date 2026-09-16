/* Optional helpful examples, one gallery and an explicit immutable review submission. */
(function () {
  'use strict';
  var MAX_ORIGINAL_BYTES = 32 * 1024 * 1024;
  var MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
  var MAX_IMAGES = 10;
  var MIME = ['image/jpeg', 'image/png', 'image/webp'];
  var INPUT_MIME = MIME.concat(['image/heic', 'image/heif']);
  function sameSet(a, b) { return JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort()); }
  window.BPPGuidedPhotos = {
    mount: async function (ctx) {
      var element = BPPGuidedSaved.element;
      var local = [];
      var queue = Promise.resolve();
      var mutation = false;
      var submitOperation = null;
      var submitAuthorization = null;
      var recoveryController = null;
      var replacing = null;
      var textLaterBusy = false;
      var textLaterDone = false;
      var textLaterMessage = '';
      var fileInput = element('input'); fileInput.type = 'file'; fileInput.accept = INPUT_MIME.join(',') + ',.jpg,.jpeg,.png,.webp,.heic,.heif'; fileInput.multiple = true; fileInput.hidden = true;
      ctx.main.appendChild(fileInput);
      var preview = element('dialog', '', 'guided-preview');
      preview.setAttribute('aria-label', 'Your setup photo');
      preview.innerHTML = '<img alt="Your selected setup photo"><button type="button">Close photo</button>';
      document.body.appendChild(preview);
      var previewOpener;
      function closePreview() { preview.close(); if (previewOpener && previewOpener.isConnected) previewOpener.focus(); }
      preview.querySelector('button').onclick = closePreview;
      preview.addEventListener('cancel', function (event) { event.preventDefault(); closePreview(); });
      function showPreview(url, button) { previewOpener = button; preview.querySelector('img').src = url; preview.showModal(); preview.querySelector('button').focus(); }
      function review() { return ctx.review(); }
      function media() { return review().draft_media || ctx.state().media || []; }
      function pending() { return review().pending_uploads || ctx.state().pending_media_uploads || []; }
      function received() { return media().filter(function (item) { return MIME.indexOf(item.mime_type) !== -1; }); }
      function busyFiles() { return local.some(function (item) { return item.status === 'queued' || item.status === 'uploading'; }); }
      function hasUnsavedLocal() { return local.length > 0; }
      function accepted() { var state = ctx.state(); var id = state.current_range_snapshot_id || state.current_range_snapshot && state.current_range_snapshot.snapshot_id; return Boolean(id && state.accepted_range_snapshot_id === id); }
      function button(label, callback, className) { var control = element('button', label, className || 'guided-link'); control.type = 'button'; control.onclick = callback; return control; }
      function latestResponse() { var correction = review().current_correction; var submission = review().latest_submission; return Boolean(correction && submission && correction.response_submission_id === submission.id && submission.correction_request_id === correction.id && submission.correction_revision === correction.revision); }
      function submittedReceipt() {
        var followup = review().followup || {};
        var last4 = /^\d{4}$/.test(followup.phone_last4 || '') ? followup.phone_last4 : '';
        var status = followup.status || 'unconfirmed';
        var destination = last4 ? 'the number ending in ' + last4 : 'your saved mobile number';
        var later = ctx.kind === 'photos-later';
        ctx.content.replaceChildren(element('h1', later ? "Send your photos when you're ready." : "You're all set."));
        var message = status === 'sent' ? 'Check your messages at ' + destination + '.'
          : status === 'pending' ? 'Expect a text soon at ' + destination + '.'
          : status === 'unavailable' ? 'Your request is saved, but we could not send a text to ' + destination + '.'
          : 'Your request is saved. We could not confirm the text yet. Check your messages at ' + destination + '.';
        ctx.content.appendChild(element('p', message));
        if (later) ctx.content.appendChild(element('p', status === 'unavailable'
          ? 'When you have your photos, text them to the number below.'
          : 'When you have your photos, reply to our text with them.'));
        var from = element('p'); from.appendChild(element('span', 'Our texting number: '));
        var number = element('a', '(864) 863-7800', 'guided-link'); number.href = 'sms:+18648637800'; from.appendChild(number);
        ctx.content.appendChild(from);
        ctx.focus();
      }
      function photoCard(item, readOnly) {
        var card = element('article', '', 'guided-photo');
        card.dataset.mediaId = item.id || '';
        var thumbnail = button('', null); thumbnail.dataset.preview = ''; thumbnail.setAttribute('aria-label', 'View received photo');
        var image = element('img'); image.src = item.preview_href || ''; image.alt = 'Your received setup photo';
        image.onerror = function () {
          thumbnail.setAttribute('aria-label', 'Photo preview unavailable'); image.removeAttribute('src');
          if (!card.querySelector('[data-refresh-preview]')) { var retry = button('Reload photo', reload); retry.dataset.refreshPreview = ''; card.appendChild(retry); }
        };
        thumbnail.appendChild(image); thumbnail.onclick = function () { if (item.preview_href) showPreview(item.preview_href, thumbnail); };
        card.appendChild(thumbnail);
        if (readOnly) card.appendChild(element('p', 'Submitted for review'));
        if (!readOnly) {
          var controls = element('div', '', 'guided-photo-actions');
          controls.appendChild(button('Replace', function () { if (mutation || busyFiles()) return; replacing = item.id; fileInput.multiple = false; fileInput.click(); }));
          controls.appendChild(button('Remove', function () { return remove(item.id); }));
          controls.querySelectorAll('button').forEach(function (control) { control.disabled = mutation || busyFiles() || Boolean(submitOperation); });
          var removeButton = controls.lastElementChild; removeButton.classList.add('guided-photo-remove'); removeButton.setAttribute('aria-label', 'Remove'); removeButton.innerHTML = '<span aria-hidden="true">×</span>';
          card.appendChild(controls);
        }
        return card;
      }
      function helpful() {
        var guidance = element('section', '', 'guided-photo-guidance');
        guidance.setAttribute('aria-label', 'Helpful photo examples');
        var examples = element('div', '', 'photo-examples unified-examples');
        [
          ['/img/panel-example.jpg', 'Panel with outer door open'],
          ['/walk-v2/outdoor-area-path-to-panel.jpg', 'Outdoor area and path to panel']
        ].forEach(function (tip) {
          var example = element('div', '', 'photo-example');
          var img = element('img'); img.src = tip[0]; img.alt = tip[1] + ' example';
          example.append(img, element('span', tip[1])); examples.appendChild(example);
        });
        guidance.appendChild(examples);
        guidance.appendChild(element('p', 'Open only the hinged outer panel door if safe. Never remove screws or the inner cover.', 'guided-photo-safety'));
        if (ctx.state().panel_inventory_status === 'multiple_unsure_main') guidance.appendChild(element('p', 'Photos of additional panels can help Key understand your setup.'));
        return guidance;
      }
      function render() {
        if (!ctx.guard()) return;
        if (!accepted()) { WALK.go('range.html', ctx.token, null, true); return; }
        if (ctx.kind === 'thankyou' || ctx.kind === 'photos-later') {
          if (!(review().followup && review().followup.current === true) && review().manual_review_current !== true && (review().newer_photo_draft || review().submission_current !== true || !review().latest_submission)) { WALK.go('photos.html', ctx.token, null, true); return; }
          submittedReceipt(); return;
        }
        var correction = review().current_correction;
        var activeCorrection = correction && !correction.resolved_at && !correction.response_submission_id;
        ctx.content.replaceChildren(element('h1', activeCorrection ? 'Key needs another look at your setup' : 'Show me your setup.'));
        ctx.content.appendChild(element('p', activeCorrection ? String(correction.request_text || '') : 'Photos of your generator outlets, panel and outdoor connection area help us prepare your firm proposal. Add whichever photos you have.'));
        ctx.content.appendChild(helpful());
        var add = button('Add photos', function () { replacing = null; fileInput.multiple = true; fileInput.click(); }, 'guided-upload-action add-photo-tile');
        add.setAttribute('aria-label', 'Add photos'); var addLabel = element('span', '', 'guided-add-label'); addLabel.append(element('span', '+'), element('span', 'Add photos')); addLabel.firstChild.setAttribute('aria-hidden', 'true'); add.replaceChildren(addLabel);
        add.disabled = mutation || busyFiles() || Boolean(submitOperation) || received().length + local.length >= MAX_IMAGES;
        var gallery = element('div', '', 'guided-gallery guided-photo-gallery'); gallery.setAttribute('aria-label', 'Your photos');
        received().forEach(function (item) { gallery.appendChild(photoCard(item, false)); });
        local.forEach(function (item) {
          var card = element('article', '', 'guided-photo ' + item.status);
          if (item.preview) { var image = element('img'); image.src = item.preview; image.alt = 'Selected photo, upload not yet confirmed'; card.appendChild(image); }
          card.appendChild(element('p', item.status === 'uploading' || item.status === 'queued' ? (item.replacement ? 'Uploading replacement...' : 'Uploading...') : item.status === 'received' ? 'Received. Check your current gallery.' : item.tooLarge ? 'This photo is too large to upload here. Remove it and choose a smaller photo, or text it to Key.' : item.decodeError ? 'Your browser could not open this photo. Remove it and choose another photo, or text it to Key.' : 'This photo did not finish uploading. Try again.'));
          if (item.status === 'received') {
            card.appendChild(button('Check saved photo', reload));
          }
          if (item.status === 'failed') {
            var controls = element('div', '', 'guided-photo-actions');
            if (!item.historyLimit && !item.tooLarge) controls.appendChild(button(item.terminal || item.stale ? 'Start a new upload attempt' : 'Retry upload', function () { if (item.terminal || item.stale) { item.operation = null; item.terminal = item.stale = false; } enqueue(item); }));
            else if (item.historyLimit) card.appendChild(element('p', 'The retained photo history is full. Contact Key for help adding another photo.'));
            controls.appendChild(button('Remove', function () {
              if (pending().length) { ctx.error('Check or remove the unfinished upload before removing this selected file.'); return; }
              local = local.filter(function (value) { return value !== item; }); URL.revokeObjectURL(item.preview); render();
            })); card.appendChild(controls);
          }
          gallery.appendChild(card);
        });
        gallery.appendChild(add);
        ctx.content.appendChild(gallery);
        ctx.content.appendChild(element('p', received().length ? received().length + ' of 10 photos received.' : 'Add at least one photo. You can add up to 10.', 'guided-photo-count'));
        pending().forEach(function (item) {
          var row = element('div', '', 'guided-photo-pending'); row.appendChild(element('p', 'An unfinished upload needs checking.'));
          row.appendChild(button('Check upload', reconcile));
          row.appendChild(button('Remove unfinished upload', function () { cancel(item.reservation_id || item.id); }));
          ctx.content.appendChild(row);
        });
        if (review().newer_photo_draft) ctx.content.appendChild(element('p', "You have photo changes that haven't been sent for review."));
        else if (review().latest_submission && review().submission_current !== true) ctx.content.appendChild(element('p', 'Your previous photo submission belongs to an earlier estimate. Review these photos, then send them for your current request.'));
        else if (review().latest_submission) ctx.content.appendChild(element('p', latestResponse() ? "Your updates were sent for Key's review." : "Your previous photos were sent for Key's review."));
        var send = button(submitOperation ? 'Check photo submission' : 'Send photos for review', submitOperation ? reconcileSubmission : submit, 'cta qw-primary-action');
        send.dataset.sendPhotos = '';
        send.disabled = mutation || busyFiles() || (!submitOperation && (hasUnsavedLocal() || pending().length > 0 || received().length < 1));
        ctx.content.appendChild(send);
        var later = button(textLaterBusy ? 'Sending photo instructions...' : textLaterDone ? 'Photo instructions texted' : 'Text the photos later', textPhotosLater, 'guided-link');
        later.dataset.textPhotosLater = '';
        later.disabled = textLaterBusy || textLaterDone || mutation || busyFiles() || Boolean(submitOperation);
        var textAction = element('div', '', 'guided-range-utilities'); textAction.appendChild(later);
        if (textLaterMessage) {
          var status = element('p', textLaterMessage); status.setAttribute('role', 'status'); status.tabIndex = -1; status.dataset.textLaterStatus = ''; textAction.appendChild(status);
          if (!textLaterDone && !textLaterBusy) {
            var messages = element('a', 'Text Key directly', 'guided-link'); messages.href = 'sms:+18648637800'; textAction.appendChild(messages);
          }
        }
        ctx.content.appendChild(textAction);
      }
      async function textPhotosLater() {
        if (textLaterBusy || textLaterDone || mutation || busyFiles() || submitOperation) return;
        textLaterBusy = true; textLaterMessage = ''; render();
        try {
          // Reuse the current handoff and its one-opener provider claim.
          var correction = review().current_correction;
          var fields = { photo_followup: 'text_later', packet_revision: review().packet_revision, correction_request_id: correction && !correction.resolved_at ? correction.id : null, correction_revision: correction && !correction.resolved_at ? correction.revision : null };
          var expected = typeof WALK.guidedReceiptContext === 'function' ? WALK.guidedReceiptContext(ctx.state()) : null;
          var receipt = await ctx.action('handoff', fields);
          if (typeof WALK.guidedReceiptMatches === 'function' && WALK.guidedReceiptMatches(receipt, expected, fields)) {
            WALK.go('photos-later.html', ctx.token, null, true); return;
          }
          await ctx.load();
          if (review().followup && review().followup.current === true) {
            WALK.go('photos-later.html', ctx.token, null, true); return;
          }
          textLaterMessage = 'Your request could not be confirmed. Try again to check the same request.';
        } catch (error) {
          if (error && error.code === 'stale_customer_authorization') {
            try { await ctx.load(); } catch (_) {}
            textLaterMessage = 'Your saved request changed. Review your setup before trying again.';
          } else textLaterMessage = 'The text could not be confirmed. Check your messages before trying again.';
        } finally {
          textLaterBusy = false; render();
          var statusNode = ctx.content.querySelector('[data-text-later-status]'); if (statusNode) statusNode.focus({ preventScroll: true });
        }
      }
      async function reload() {
        if (mutation || busyFiles()) return;
        try { await ctx.load(); ctx.error(''); reconcileReceivedLocal(); render(); }
        catch (_) { ctx.error('Your saved photos could not load. Try again.'); }
      }
      function reconcileReceivedLocal() {
        var changed = false;
        local = local.filter(function (item) {
          if (!item.mediaId) return true;
          var present = received().some(function (media) { return media.id === item.mediaId; });
          var superseded = Number.isFinite(item.receiptRevision) && Number(review().packet_revision) > item.receiptRevision;
          if (!present && !superseded) return true;
          if (!present) changed = true;
          URL.revokeObjectURL(item.preview); return false;
        });
        if (changed) ctx.error('Your saved photos changed. Review the current photos before sending.');
      }
      function enqueue(item) {
        if (item.status === 'queued' || item.status === 'uploading') return;
        item.status = 'queued'; render();
        queue = queue.then(async function () {
          if (local.indexOf(item) === -1) return;
          item.status = 'uploading'; render(); ctx.error('');
          try {
            if (!item.data) {
              try {
                var normalized = await WALK.resizeImage(item.file, 1600);
                if (typeof normalized !== 'string' || !/^data:image\/jpeg;base64,/.test(normalized)) throw new Error('unusable_image');
                var encoded = normalized.split(',')[1];
                var decodedSize = encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
                if (decodedSize > MAX_UPLOAD_BYTES) { item.tooLarge = true; throw new Error('guided_photo_too_large'); }
                item.data = normalized; item.preview = normalized; item.decodeError = false;
              } catch (error) { item.decodeError = !item.tooLarge; throw error; }
            }
            if (!item.operation) item.operation = { role: 'setup_photo', packet_revision: review().packet_revision, attempt_id: crypto.randomUUID(), replacement_media_id: item.replacement || null, replacement_attempt_id: item.replacement ? crypto.randomUUID() : null, frozen_request: {} };
            var receipt = await WALK.photo(ctx.token, item.data, Math.min(MAX_IMAGES, received().length + 1), item.operation);
            if (!receipt || receipt.receipt_settled !== true || !receipt.media_receipt_id) throw new Error('unconfirmed_media');
            item.mediaId = receipt.media_receipt_id; item.status = 'received';
            item.receiptRevision = Number((receipt.photo_review || receipt.quote_walk_v2 && receipt.quote_walk_v2.photo_review || {}).packet_revision);
            await ctx.load();
            reconcileReceivedLocal();
          } catch (error) {
            var code = error && error.body && error.body.error || '';
            item.tooLarge = item.tooLarge || code === 'guided_photo_too_large';
            item.terminal = code === 'media_upload_attempt_terminal';
            item.historyLimit = code === 'media_limit_history';
            item.stale = code === 'stale_photo_draft' || code === 'idempotency_conflict';
            if (item.status !== 'received') item.status = 'failed';
            try { await ctx.load(); } catch (_) {}
            ctx.error(item.tooLarge ? 'This photo is too large to upload here. Choose a smaller photo, or text it to Key.' : item.decodeError ? 'Your browser could not open this photo. Choose another photo, or text it to Key.' : item.status === 'received' ? 'This photo was received. Choose Check saved photo to reload your gallery.' : item.historyLimit ? 'The retained photo history is full. Contact Key for help adding another photo.' : item.terminal || item.stale ? 'This upload could not finish. Choose Start a new upload attempt.' : 'This photo could not be confirmed. Choose Retry upload to check this same upload.');
          }
          render();
        }).catch(function () { item.status = 'failed'; render(); ctx.error('This photo did not finish uploading. Try again.'); });
      }
      fileInput.addEventListener('change', function () {
        var files = Array.from(fileInput.files || []); fileInput.value = '';
        if (!files.length) { replacing = null; return; }
        files.forEach(function (file) {
          var knownType = INPUT_MIME.indexOf(file.type) !== -1 || (!file.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name));
          if (!knownType || !file.size || file.size > MAX_ORIGINAL_BYTES) { ctx.error('This file could not be used. Choose a phone photo, JPEG, PNG or WebP up to 32 MB.'); return; }
          if (received().length + local.length - (replacing ? 1 : 0) >= MAX_IMAGES) { ctx.error('You can add up to 10 photos. Remove one before adding another.'); return; }
          // Decode one original at a time; show only the smaller, normalized preview.
          var item = { file: file, preview: '', replacement: replacing, status: 'selected', operation: null, mediaId: null };
          local.push(item); enqueue(item);
        });
        replacing = null;
      });
      async function remove(id) {
        if (mutation || busyFiles() || submitOperation) return;
        mutation = true; render();
        try { await ctx.action('remove_guided_photo', { packet_revision: review().packet_revision, media_id: id }); await ctx.load(); ctx.error(''); }
        catch (_) { try { await ctx.load(); } catch (_) {} ctx.error('Check your current gallery before trying to remove this photo again.'); }
        finally { mutation = false; render(); }
      }
      async function cancel(id) {
        if (mutation || !id) return;
        if (recoveryController) recoveryController.abort();
        mutation = true; render();
        try { await ctx.action('cancel_guided_upload', { packet_revision: review().packet_revision, reservation_id: id }); await ctx.load(); ctx.error(''); }
        catch (_) { try { await ctx.load(); } catch (_) {} ctx.error('The unfinished upload could not be removed. Refresh and try again.'); }
        finally { mutation = false; render(); }
      }
      async function reconcile() {
        if (mutation || busyFiles()) return;
        if (recoveryController) recoveryController.abort();
        recoveryController = new AbortController();
        ctx.error('Checking your unfinished upload...');
        try { var result = await WALK.reconcilePendingUploads(ctx.token, ctx.view, { signal: recoveryController.signal }); ctx.view = result.state; render(); ctx.error(pending().length ? 'This upload is still unfinished. Check again, or remove it to continue.' : ''); }
        catch (_) { ctx.error('The upload could not be checked. Try again.'); }
      }
      function submissionMatches() {
        var latest = review().latest_submission;
        return review().submission_current === true && latest && submitOperation && submitAuthorization && latest.snapshot_id === submitAuthorization.snapshotId && sameSet(latest.media_ids, submitOperation.media_ids) && (latest.correction_request_id || null) === submitOperation.correction_request_id && (latest.correction_revision || null) === submitOperation.correction_revision && latest.snapshot_id === ctx.state().accepted_range_snapshot_id;
      }
      async function reconcileSubmission() {
        if (mutation || !submitOperation) return;
        mutation = true; render();
        try {
          await ctx.load();
          if (submissionMatches()) { submitOperation = null; WALK.go('thankyou.html', ctx.token, null, true); return; }
          if (!submitAuthorization || Number(ctx.state().version) !== submitAuthorization.version || ctx.state().accepted_range_snapshot_id !== submitAuthorization.snapshotId) {
            var changed = new Error('stale_customer_authorization'); changed.code = 'stale_customer_authorization'; throw changed;
          }
          // Keep the exact submitted media set and correction context for deliberate retry.
          var expected = typeof WALK.guidedReceiptContext === 'function' ? WALK.guidedReceiptContext(ctx.state()) : null;
          var receipt = await ctx.action('submit_photos', submitOperation);
          if (typeof WALK.guidedPhotoReceiptMatches === 'function' && WALK.guidedPhotoReceiptMatches(receipt, expected, submitOperation)) {
            submitOperation = null; WALK.go('thankyou.html', ctx.token, null, true); return;
          }
          await ctx.load();
          if (!submissionMatches()) throw new Error('submission_not_confirmed');
          submitOperation = null; WALK.go('thankyou.html', ctx.token, null, true);
        } catch (error) {
          try { await ctx.load(); } catch (_) {}
          if (submissionMatches()) { submitOperation = null; WALK.go('thankyou.html', ctx.token, null, true); return; }
          if (!submitAuthorization || Number(ctx.state().version) !== submitAuthorization.version || ctx.state().accepted_range_snapshot_id !== submitAuthorization.snapshotId) {
            submitOperation = null; submitAuthorization = null; WALK.go('range.html', ctx.token, null, true); return;
          }
          if (error && error.code === 'stale_customer_authorization' || review().packet_revision !== submitOperation.packet_revision) {
            submitOperation = null; ctx.error('Your saved photos have changed. Review the current gallery before sending.');
          } else ctx.error('Your photo submission could not be confirmed. Check the same submission before trying again.');
        } finally { mutation = false; render(); }
      }
      async function submit() {
        if (mutation || busyFiles() || hasUnsavedLocal() || pending().length || !received().length) return;
        var correction = review().current_correction;
        submitAuthorization = { version: Number(ctx.state().version), snapshotId: ctx.state().accepted_range_snapshot_id };
        submitOperation = { packet_revision: review().packet_revision, media_ids: received().map(function (item) { return item.id; }).sort(), correction_request_id: correction && !correction.resolved_at ? correction.id : null, correction_revision: correction && !correction.resolved_at ? correction.revision : null };
        await reconcileSubmission();
      }
      ctx.reload = reload;
      render(); ctx.focus();
      window.addEventListener('pagehide', function () { if (recoveryController) recoveryController.abort(); });
    }
  };
})();
