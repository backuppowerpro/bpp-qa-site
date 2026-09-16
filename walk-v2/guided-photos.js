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
      var textOpen = false;
      var textOptions = null;
      var textPreparing = false;
      var textPreparedOnce = false;
      var textMessage = '';
      var textImport = null;
      var skippedTextImages = new Set();
      var copyReferenceFallback = false;
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
      function save(root) { return ctx.save(root, function () { return busyFiles() || pending().length ? 'Your received photos are saved. An unfinished upload may need to be retried when you return.' : 'Your details and received photos are saved.'; }); }
      function button(label, callback, className) { var control = element('button', label, className || 'guided-link'); control.type = 'button'; control.onclick = callback; return control; }
      function latestResponse() { var correction = review().current_correction; var submission = review().latest_submission; return Boolean(correction && submission && correction.response_submission_id === submission.id && submission.correction_request_id === correction.id && submission.correction_revision === correction.revision); }
      function submittedReceipt() {
        var submission = review().latest_submission;
        if (review().manual_review_current === true) {
          ctx.content.replaceChildren(element('h1', 'Key has reviewed your photos'));
          ctx.content.appendChild(element('p', 'Key reviewed the photos from your text conversation and is preparing your firm proposal. No payment is due now.'));
          ctx.content.appendChild(element('p', 'Next: Key prepares your firm proposal'));
          ctx.content.appendChild(button('Add or change photos', function () { WALK.go('photos.html', ctx.token, { edit: 'photos' }); }));
          ctx.focus(); return;
        }
        if (!submission || !submission.id || review().submission_current !== true) { WALK.go('photos.html', ctx.token, null, true); return; }
        var correctionResponse = latestResponse();
        ctx.content.replaceChildren(element('h1', correctionResponse ? "Your updates were sent for Key's review." : "Your photos have been sent for Key's review."));
        ctx.content.appendChild(element('p', "Key will review your setup before preparing your firm proposal. If another detail would help, he'll let you know. No payment is due now."));
        ctx.content.appendChild(element('p', 'Next: Key reviews your setup'));
        var estimate = ctx.state().current_range_snapshot;
        if (estimate && estimate.status === 'available' && estimate.snapshot_id === submission.snapshot_id) {
          var starting = estimate.pricing_context && estimate.pricing_context.estimate_kind === 'starting_at';
          ctx.content.appendChild(element('p', 'For your estimate: ' + (starting ? 'Starting at ' : '') + '$' + Math.round(estimate.low_cents / 100).toLocaleString('en-US') + (!starting && estimate.high_cents !== estimate.low_cents ? ' to $' + Math.round(estimate.high_cents / 100).toLocaleString('en-US') : '')));
        }
        var receiptPhotos = review().submitted_media || [];
        var gallery = element('div', '', 'guided-gallery');
        receiptPhotos.forEach(function (item) { gallery.appendChild(photoCard(item, true)); });
        ctx.content.appendChild(gallery);
        ctx.content.appendChild(element('p', String(submission.media_ids.length) + (submission.media_ids.length === 1 ? ' photo submitted.' : ' photos submitted.')));
        ctx.content.appendChild(button('Add or change photos', function () { WALK.go('photos.html', ctx.token, { edit: 'photos' }); }));
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
        if (ctx.kind === 'thankyou') {
          if (review().manual_review_current !== true && (review().newer_photo_draft || review().submission_current !== true || !review().latest_submission)) { WALK.go('photos.html', ctx.token, null, true); return; }
          submittedReceipt(); return;
        }
        var correction = review().current_correction;
        var activeCorrection = correction && !correction.resolved_at && !correction.response_submission_id;
        ctx.content.replaceChildren(element('h1', activeCorrection ? 'Key needs another look at your setup' : 'Show me your setup.'));
        ctx.content.appendChild(element('p', activeCorrection ? String(correction.request_text || '') : 'Photos of your generator outlets, panel and outdoor connection area help Key prepare your firm proposal. Add whichever photos you have.'));
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
        send.disabled = mutation || busyFiles() || (!submitOperation && (Boolean(textImport) || hasUnsavedLocal() || pending().length > 0 || received().length < 1));
        ctx.content.appendChild(send);
        var saved = element('div'); saved.innerHTML = BPPGuidedSaved.saveMarkup; ctx.content.appendChild(saved); save(saved.querySelector('[data-save-for-later]'));
        renderTextFallback();
      }
      function renderTextFallback() {
        var fallback = element('details', '', 'guided-helpful'); fallback.open = textOpen;
        fallback.appendChild(element('summary', 'Having trouble uploading?'));
        fallback.appendChild(element('p', 'You can text the photos to Key instead.'));
        fallback.appendChild(element('p', 'Choose photos up to 32 MB each. JPEG, PNG, WebP and phone photos are supported when your browser can open them.'));
        fallback.appendChild(element('p', 'Key can review them in your text conversation. If you return here, you can check which photos have been received.'));
        var textActions = element('div', '', 'guided-photo-actions');
        if (textPreparing) fallback.appendChild(element('p', 'Preparing your text options...'));
        if (textOptions) {
          fallback.appendChild(element('p', 'Include this reference with your photos so they can be matched to this request.'));
          var reference = element('input'); reference.type = 'text'; reference.readOnly = true; reference.value = textOptions.request_reference; reference.setAttribute('aria-label', 'Your photo request reference'); reference.dataset.textReference = ''; var referenceField = element('div', '', 'guided-phone'); referenceField.appendChild(reference); fallback.appendChild(referenceField);
          textActions.appendChild(button('Copy reference', async function () {
            try { if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('unavailable'); await navigator.clipboard.writeText(textOptions.request_reference); textMessage = 'Reference copied. Include it with your photos.'; }
            catch (_) { copyReferenceFallback = true; textMessage = 'Select and copy the reference, then include it with your photos.'; }
            render(); if (copyReferenceFallback) { var field = ctx.content.querySelector('[data-text-reference]'); if (field) { field.focus(); field.select(); } }
          }));
        }
        if (textPreparedOnce && !textPreparing && !textOptions) textActions.appendChild(button('Try loading the reference again', prepareTextOptions));
        var messages = element('a', 'Open Messages', 'guided-link');
        messages.href = 'sms:+18648637800' + (textOptions ? '?body=' + encodeURIComponent(textOptions.sms_body) : '');
        messages.dataset.openTextPhotos = ''; textActions.appendChild(messages); fallback.appendChild(textActions);
        if (textMessage) { var status = element('p', textMessage); status.setAttribute('role', 'status'); fallback.appendChild(status); }
        var recoveryActions = element('div', '', 'guided-photo-actions');
        var check = button(mutation ? 'Checking texted photos...' : 'Check again', checkTextPhotos); check.dataset.checkTextPhotos = ''; check.disabled = mutation || busyFiles() || Boolean(submitOperation); recoveryActions.appendChild(check);
        recoveryActions.appendChild(button('Back to photo upload', function () { textOpen = false; render(); ctx.content.querySelector('.guided-upload-action').focus(); }));
        fallback.appendChild(recoveryActions);
        fallback.addEventListener('toggle', function () { if (!fallback.isConnected) return; textOpen = fallback.open; if (textOpen && !textOptions && !textPreparing && !textPreparedOnce) prepareTextOptions(); });
        ctx.content.appendChild(fallback);
      }
      async function prepareTextOptions() {
        if (textPreparing || textOptions) return;
        textPreparing = true; textPreparedOnce = true; render();
        try {
          var value = await WALK.textPhotoAction(ctx.token, 'prepare_text_photos');
          if (!value || value.ok !== true || !/^QW-[A-F0-9]{32}$/.test(value.request_reference || '') || value.sms_recipient !== '+18648637800' || typeof value.sms_body !== 'string' || value.sms_body.length > 500 || value.sms_body.indexOf(value.request_reference) === -1 || value.sms_body.indexOf(ctx.token) !== -1) throw new Error('invalid_text_options');
          textOptions = value; textMessage = '';
        } catch (_) { textMessage = 'The request reference could not load. Key can still review photos you text him.'; }
        finally { textPreparing = false; render(); }
      }
      async function checkTextPhotos() {
        if (mutation || busyFiles() || submitOperation) return;
        mutation = true; textOpen = true; textMessage = 'Checking for received photos...'; render();
        var imported = 0;
        var skipped = 0;
        function definitiveImageFailure(error) {
          var code = error && (error.code || error.body && error.body.error);
          return ['invalid_image', 'image_dimensions_too_large', 'not_an_image', 'image_type_mismatch', 'unsupported_image', 'unsupported_text_photo'].indexOf(code) !== -1;
        }
        async function importOrSkip(operation) {
          try { await importTextPhoto(operation); imported++; }
          catch (error) {
            if (!definitiveImageFailure(error)) throw error;
            // Only definitive pre-reservation image rejection can be skipped here.
            skippedTextImages.add(operation.text_import_id); textImport = null; skipped++;
          }
        }
        try {
          // Retry only the same frozen import if its previous response was lost.
          if (textImport) await importOrSkip(textImport);
          var result = await WALK.textPhotoAction(ctx.token, 'check_text_photos');
          if (!result || result.ok !== true || !Array.isArray(result.text_photos)) throw new Error('invalid_text_check');
          for (var item of result.text_photos) {
            if (item.status !== 'available') continue;
            if (skippedTextImages.has(item.id)) { skipped++; continue; }
            await ctx.load();
            if (!ctx.guard() || !accepted()) return;
            textImport = { text_import_id: item.id, expected_version: Number(ctx.state().version), packet_revision: Number(review().packet_revision), request_key: crypto.randomUUID() };
            await importOrSkip(textImport);
          }
          await ctx.load();
          if (imported) textMessage = imported === 1 ? 'A texted photo was received. Review your photos, then send them for review when ready.' : 'Texted photos were received. Review your photos, then send them for review when ready.';
          else if (result.text_photos.some(function (item) { return item.status === 'pending'; })) textMessage = 'A texted photo is still being received. Check again in a moment.';
          else if (result.text_photos.some(function (item) { return item.status === 'unsupported'; })) textMessage = 'Some texted files cannot be added here. Key can still review them in your text conversation.';
          else textMessage = 'No new texted photos are available yet.';
          if (skipped) textMessage = (imported ? textMessage + ' ' : '') + 'Some texted files could not be added here. Key can still review them in your text conversation.';
        } catch (error) {
          var code = error && (error.code || error.body && error.body.error);
          if (code === 'media_limit' || code === 'media_limit_history') { textImport = null; textMessage = code === 'media_limit' ? 'Your photo gallery is full. You can send the photos already received, or remove one and check again.' : 'The retained photo history is full. You can send the photos already received. Key can review additional photos in your text conversation.'; }
          else if (['stale_photo_draft', 'stale_journey_version', 'media_upload_attempt_terminal', 'idempotency_conflict', 'text_photo_removed', 'text_photo_import_removed', 'text_photo_unavailable', 'invalid_text_photo_request', 'text_import_conflict', 'unsupported_text_photo'].indexOf(code) !== -1) { textImport = null; textMessage = 'Your saved photos changed. Check again to load the current photos.'; }
          else if (code === 'rate limited' || code === 'rate_limited') textMessage = 'Too many tries too quickly. Wait one minute, then check again.';
          else textMessage = 'Texted photos could not be confirmed. Check again to check the same request.';
        } finally { mutation = false; render(); }
      }
      async function importTextPhoto(operation) {
        var value = await WALK.textPhotoAction(ctx.token, 'import_text_photo', operation);
        if (!value || value.receipt_settled !== true || !value.media_receipt_id) throw new Error('unconfirmed_text_receipt');
        textImport = null;
        await ctx.load();
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
          await ctx.action('submit_photos', submitOperation); await ctx.load();
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
        if (mutation || busyFiles() || textImport || hasUnsavedLocal() || pending().length || !received().length) return;
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
