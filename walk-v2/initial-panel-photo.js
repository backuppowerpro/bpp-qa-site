/* Required pre-contact panel photo. Uses the existing WALK.resizeImage decoder
 * from d4cb7a102504c29353260492e821cffb3ef5d80d and the prior photo-page
 * camera/file and confirmed-save pattern, without the old later option. */
(function () {
  'use strict';
  var STORAGE_KEY = 'bpp_initial_panel_photo_v1';
  var LEGACY_DISCLOSURE_VERSION = 'panel-photo-private-review-2026-10-12-v1';
  var PREVIOUS_UPLOAD_VERSION = 'panel-photo-upload-action-2026-10-15-v2';
  var PREVIOUS_POLICY_VERSION = 'bpp-photo-privacy-2026-10-15-v1';
  var DISCLOSURE_VERSION = 'panel-media-upload-action-2026-10-15-v3';
  var POLICY_VERSION = 'bpp-media-privacy-2026-10-15-v2';
  var MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
  var MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
  var MAX_PHOTOS = 10;
  var INITIAL_PHOTO_WINDOW_MS = 24 * 60 * 60 * 1000;
  var WARNING_MS = 2 * 60 * 1000;
  var MAX_EXTENSIONS = 10;
  var VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
  var ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.webm';
  var instances = 0;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HASH = /^[a-f0-9]{64}$/;

  function element(tag, text, className) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function randomToken() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
  }
  function imageByteSize(data) {
    var body = data.split(',')[1] || '';
    return Math.floor(body.length * 3 / 4) - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0);
  }
  function storedPhoto(value) {
    return value && UUID.test(value.id || '') && HASH.test(value.sha256 || '')
      && HASH.test(value.preview_hash || '') && ['image/jpeg', 'image/png', 'image/webp'].concat(VIDEO_TYPES).indexOf(value.content_type) !== -1
      && Number.isSafeInteger(value.byte_size) && value.byte_size > 0 && value.byte_size <= MAX_UPLOAD_BYTES;
  }
  function uploadEvidence(value, legacyCache) {
    if (value && value.consent_version === DISCLOSURE_VERSION && value.evidence_kind === 'upload_action' && value.policy_version === POLICY_VERSION)
      return Object.freeze({ consent_version: DISCLOSURE_VERSION, evidence_kind: 'upload_action', policy_version: POLICY_VERSION });
    if (value && value.consent_version === PREVIOUS_UPLOAD_VERSION && value.evidence_kind === 'upload_action' && value.policy_version === PREVIOUS_POLICY_VERSION)
      return Object.freeze({ consent_version: PREVIOUS_UPLOAD_VERSION, evidence_kind: 'upload_action', policy_version: PREVIOUS_POLICY_VERSION });
    // Old pending requests predate evidence fields. Preserve their original
    // disclosure rather than claiming that the new upload action occurred.
    if (value && value.policy_version == null && (value.consent_version === LEGACY_DISCLOSURE_VERSION && (value.evidence_kind == null || value.evidence_kind === 'checkbox_review')
      || legacyCache && value.consent_version == null && value.evidence_kind == null))
      return Object.freeze({ consent_version: LEGACY_DISCLOSURE_VERSION });
    return null;
  }
  function selectedFileEvidence() {
    return Object.freeze({ consent_version: DISCLOSURE_VERSION, evidence_kind: 'upload_action', policy_version: POLICY_VERSION });
  }
  function removedAttempt(result, photoId) {
    return result && result.upload_attempt && result.upload_attempt.id === photoId
      && ['removed', 'cleaning', 'cleaned', 'dead_letter'].indexOf(result.upload_attempt.status) !== -1
      && !(Array.isArray(result.initial_photos) ? result.initial_photos : result.initial_photo ? [result.initial_photo] : []).some(function (photo) { return photo.id === photoId; });
  }
  async function formatFor(file) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 1) throw new Error('empty_photo');
    var type = String(file.type || '').toLowerCase();
    var videoType = VIDEO_TYPES.indexOf(type) !== -1 ? type : !type && /\.(mp4|mov|webm)$/i.test(file.name || '')
      ? /\.mov$/i.test(file.name) ? 'video/quicktime' : /\.webm$/i.test(file.name) ? 'video/webm' : 'video/mp4' : '';
    if (videoType) {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error('large_video');
      return videoType;
    }
    if (file.size > MAX_ORIGINAL_BYTES) throw new Error('large_photo');
    if (type && ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'].indexOf(type) === -1) throw new Error('unsupported_photo');
    var bytes = new Uint8Array(await file.slice(0, 80).arrayBuffer());
    function ascii(start, end) { return String.fromCharCode.apply(null, Array.from(bytes.slice(start, end))); }
    var kind = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg'
      : bytes[0] === 137 && ascii(1, 4) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 ? 'png'
      : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'webp'
      : ascii(4, 8) === 'ftyp' && /(?:heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(ascii(8, 80)) ? 'heic' : '';
    if (!kind) throw new Error('unsupported_photo');
    if (type && (kind === 'jpeg' && type !== 'image/jpeg' || kind === 'png' && type !== 'image/png' || kind === 'webp' && type !== 'image/webp' || kind === 'heic' && !/^image\/hei[cf](?:-sequence)?$/.test(type))) throw new Error('unsupported_photo');
    return kind;
  }
  function isVideo(value) { return Boolean(value && VIDEO_TYPES.indexOf(value.content_type) !== -1); }
  function videoData(file, contentType) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('video_read_failed')); };
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.readAsDataURL(new Blob([file], { type: contentType }));
    });
  }
  async function prepareVideo(file, contentType) {
    // Decode a frame locally before accepting a browser/codec combination.
    // The server independently validates the container and stores raw bytes.
    var video = document.createElement('video'), url = URL.createObjectURL(file);
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    try {
      await new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(new Error('video_unplayable')); }, 12000), settled = false;
        function finish(error) { if (settled) return; settled = true; clearTimeout(timer); video.onloadeddata = video.onerror = null; error ? reject(error) : resolve(); }
        video.onerror = function () { finish(new Error('video_unplayable')); };
        video.onloadeddata = function () {
          if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) { finish(new Error('video_unplayable')); return; }
          finish();
        };
        video.src = url; video.load();
      });
      return await videoData(file, contentType);
    } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
  }

  window.BPPInitialPanelPhoto = {
    timeExtensions: true,
    photoRecovery: true,
    localDiscard: true,
    multiPhotoAppend: true,
    mount: function (root, options) {
      options = options || {};
      var prefix = 'initial-photo-' + (++instances);
      var state = { token: '', revision: 0, photo: null, photos: [], images: new Map(), photoLimit: MAX_PHOTOS, attemptsRemaining: 12, batchBusy: false, rejectedPhotoIds: [], expires: '', pending: null, busy: false, locked: false, needsCheck: false, writerPending: false, rejectedPhotoId: '', image: '', imageEvidence: null, message: '', error: '',
        timeRevision: 0, extensionCount: 0, extensionPending: null, extensionBusy: false, holdingExpiry: false, timeCheckHeld: false, clockOffset: 0, timeMessage: '', timeOpen: false };
      var generation = 0, destroyed = false, expiryTimer = null, warningTimer = null, lastNotice = '', restoreActionFocus = false, actionFocusOrigin = null, feedbackOrigin = null, feedbackNotice = '', warningFrame = null;
      var observedPhotoIds = new Set();
      var previewNodes = new Map(), selectionGeneration = 0, lastServerRevision = -1, lastServerIds = '', removeFocusIndex = -1, batchSize = 0;
      var previewLoads = new Map(), previewRunning = false, previewScheduled = false;
      var automaticTimeCheck = false;
      var heading = element('h2', 'For an accurate quote,\nplease add one panel photo');
      heading.style.whiteSpace = 'pre-line';
      heading.tabIndex = -1;
      heading.id = 'initial-photo-heading';
      var introduction = element('p', 'Extra views of the panel area or inlet spot can help. Extras are optional.', 'initial-photo-guidance');
      introduction.id = prefix + '-guidance';
      var examples = element('div', '', 'initial-photo-examples');
      function example(src, alt, caption) {
        var figure = element('figure');
        var image = element('img');
        image.loading = 'lazy'; image.src = src; image.alt = alt; image.width = image.height = 900; image.decoding = 'async';
        image.addEventListener('error', function () { image.hidden = true; });
        figure.appendChild(image); figure.appendChild(element('figcaption', caption)); examples.appendChild(figure);
      }
      example('/walk-v2/panel-door-open-example.webp', 'Electrical panel with its outer door open and breakers visible', 'Regular panel');
      example('/walk-v2/meter-panel-latest-example.webp', 'Meter above an electrical panel with its outer door open on a brick wall', 'Meter + panel');
      var exampleLabel = element('p', 'Photo examples', 'initial-photo-examples-label');
      var exampleGroup = element('div', '', 'initial-photo-reference');
      exampleGroup.append(exampleLabel, examples);
      var controls = element('div', '', 'initial-photo-controls');
      function button(label, attr) {
        var node = element('button', label, 'initial-photo-button'); node.type = 'button'; node.setAttribute(attr, '');
        node.setAttribute('aria-describedby', introduction.id + ' ' + prefix + '-status ' + prefix + '-error'); controls.appendChild(node); return node;
      }
      var choose = button('Upload a photo', 'data-initial-photo-file');
      var primaryControls = element('div', '', 'initial-photo-controls initial-photo-primary-controls');
      primaryControls.appendChild(choose);
      var retry = button('Retry saving photo', 'data-initial-photo-retry');
      var remove = button('Remove photo', 'data-initial-photo-remove');
      var status = element('p', '', 'initial-photo-status'); status.id = prefix + '-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true'); status.dataset.initialPhotoStatus = '';
      var error = element('p', '', 'initial-photo-error'); error.id = prefix + '-error'; error.setAttribute('role', 'alert'); error.dataset.initialPhotoError = '';
      var timeWarning = element('div', '', 'initial-photo-time'); timeWarning.dataset.initialPhotoTimeWarning = '';
      var timeStatus = element('p', '', 'initial-photo-time-status'); timeStatus.id = prefix + '-time-status'; timeStatus.setAttribute('role', 'alert'); timeStatus.setAttribute('aria-live', 'assertive'); timeStatus.setAttribute('aria-atomic', 'true'); timeStatus.dataset.initialPhotoTimeStatus = '';
      var timeSummary = element('div', '', 'initial-photo-time-summary'); timeSummary.setAttribute('role', 'group');
      var timePrimary = element('p'); timePrimary.id = prefix + '-time-primary'; timePrimary.dataset.initialPhotoTimePrimary = ''; var timeCount = element('span'); timeCount.id = prefix + '-time-count'; timeSummary.appendChild(timePrimary); timeSummary.appendChild(timeCount);
      timeSummary.setAttribute('aria-labelledby', timePrimary.id); timeSummary.setAttribute('aria-describedby', timeCount.id);
      var extend = element('button', 'Extend photo time', 'initial-photo-button'); extend.type = 'button'; extend.dataset.initialPhotoExtend = ''; extend.setAttribute('aria-describedby', timeStatus.id);
      timeWarning.appendChild(timeStatus); timeWarning.appendChild(timeSummary); timeWarning.appendChild(extend);
      var pickerGenerations = new WeakMap();
      function fileInput(attribute) {
        var input = element('input'); input.type = 'file'; input.accept = ACCEPT; input.multiple = true; input.hidden = true; input.setAttribute(attribute, '');
        input.setAttribute('aria-label', 'Choose panel photos or optional videos');
        input.addEventListener('change', function () {
          var selected = Array.from(input.files || []), pickedAt = pickerGenerations.get(input);
          pickerGenerations.delete(input); input.value = '';
          if (selected.length && !destroyed && (pickedAt == null || pickedAt === generation)) selectFiles(selected, choose);
        });
        return input;
      }
      var chooseInput = fileInput('data-initial-photo-file-input');
      root.classList.add('initial-panel-photo');
      root.setAttribute('aria-labelledby', heading.id);
      var feedback = element('div', '', 'initial-photo-feedback'); feedback.appendChild(error); feedback.appendChild(status);
      var savedResult = element('div', '', 'initial-photo-result');
      exampleGroup.appendChild(savedResult);
      root.replaceChildren(heading, introduction, primaryControls, feedback, controls, exampleGroup, timeWarning, chooseInput);
      if (options.timeWarningRoot) options.timeWarningRoot.appendChild(timeWarning);

      function currentHash() { return String(options.previewHash ? options.previewHash() || '' : ''); }
      function hasPhoto(id) { return state.photos.some(function (photo) { return photo.id === id; }); }
      function photoRejected(photo) { return photo.id === state.rejectedPhotoId || state.rejectedPhotoIds.indexOf(photo.id) !== -1; }
      function photosMatch() { return Boolean(state.photo && !isVideo(state.photo)) && state.photos.every(function (photo) { return !photoRejected(photo) && photo.preview_hash === currentHash(); }); }
      function remainingTime() { return state.expires ? Date.parse(state.expires) - (Date.now() + state.clockOffset) : Infinity; }
      function expired() { return remainingTime() <= 0; }
      function timeHeld() {
        return Boolean(photosMatch()
          && (expired() || state.holdingExpiry && (state.extensionPending || state.timeCheckHeld)));
      }
      function ready() { return !destroyed && !state.busy && !state.batchBusy && !state.pending && !state.needsCheck && !state.writerPending && (!expired() || timeHeld()) && photosMatch(); }
      function submissionReady() { return ready() && !expired() && !state.extensionBusy && !state.extensionPending && !state.holdingExpiry && !state.timeCheckHeld; }
      function receipt() {
        return ready() ? { contract: 'panel-photo-before-contact-v1', stageToken: state.token, photoId: state.photo.id, photoIds: state.photos.map(function (photo) { return photo.id; }), stageRevision: state.revision, previewHash: state.photo.preview_hash } : null;
      }
      function persist() {
        try {
          if (!state.token) { sessionStorage.removeItem(STORAGE_KEY); return; }
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stageToken: state.token, revision: state.revision, photo: state.photo, photos: state.photos, photoLimit: state.photoLimit, attemptsRemaining: state.attemptsRemaining, expires: state.expires, rejectedPhotoId: state.rejectedPhotoId, rejectedPhotoIds: state.rejectedPhotoIds,
            timeRevision: state.timeRevision, extensionCount: state.extensionCount, clockOffset: state.clockOffset, extensionPending: state.extensionPending,
            pending: state.pending ? { kind: state.pending.kind, request_key: state.pending.request_key, expected_revision: state.pending.expected_revision, photo_id: state.pending.photo_id || null, preview_hash: state.pending.preview_hash || '', cancelUpload: state.pending.cancelUpload === true, reconcile: state.pending.reconcile === true,
              awaitingChoice: state.pending.awaitingChoice === true, limitRecovery: state.pending.limitRecovery === true,
              consent_version: state.pending.evidence && state.pending.evidence.consent_version, evidence_kind: state.pending.evidence && state.pending.evidence.evidence_kind, policy_version: state.pending.evidence && state.pending.evidence.policy_version,
              cleanup: state.pending.cleanup ? { request_key: state.pending.cleanup.request_key, photo_id: state.pending.cleanup.photo_id, expected_revision: state.pending.cleanup.expected_revision, reconcile: state.pending.cleanup.reconcile === true } : null } : null }));
        } catch (_) { /* Storage is optional; raw images and contact fields never enter it. */ }
      }
      function notify() {
        var signature = JSON.stringify([ready(), submissionReady(), state.photos.map(function (photo) { return photo.id; }), state.revision, state.busy, state.batchBusy, state.pending && state.pending.kind, currentHash(), state.needsCheck, state.rejectedPhotoIds, state.extensionCount, state.extensionPending && state.extensionPending.request_key]);
        if (signature === lastNotice) return;
        lastNotice = signature;
        if (typeof options.onChange === 'function') options.onChange();
      }
      function ownActionFocus(node) {
        if (node && (document.activeElement === node || document.activeElement === document.body)) { restoreActionFocus = true; actionFocusOrigin = node; feedbackOrigin = node; }
      }
      function showInitiatedFeedback() {
        if (!feedbackOrigin || !root.getClientRects().length) return;
        // Progress and saved receipts must not pull the page away from the
        // control the person just used. Bring a new recovery message into view once.
        if (state.busy || state.batchBusy || !state.error && !state.pending) { feedbackNotice = ''; return; }
        var notice = state.error + ':' + state.message;
        if (notice === feedbackNotice) return;
        feedbackNotice = notice;
        var active = document.activeElement;
        if (active !== document.body && active !== feedbackOrigin && active !== chooseInput) { feedbackOrigin = null; return; }
        var bounds = feedback.getBoundingClientRect(), viewport = window.visualViewport;
        var top = viewport ? viewport.offsetTop : 0, bottom = top + (viewport ? viewport.height : innerHeight);
        var focusBounds = active !== document.body && active.getClientRects().length ? active.getBoundingClientRect() : bounds;
        var first = Math.min(bounds.top, focusBounds.top), last = Math.max(bounds.bottom, focusBounds.bottom);
        if (last - first <= bottom - top - 24) {
          if (first < top + 12) window.scrollBy({ top: first - top - 12, behavior: 'instant' });
          else if (last > bottom - 12) window.scrollBy({ top: last - bottom + 12, behavior: 'instant' });
        } else if (bounds.top < top + 12 || bounds.bottom > bottom - 12) feedback.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
      function releasePreview(nodes) {
        if (nodes.image.tagName === 'VIDEO') nodes.image.pause();
        nodes.image.removeAttribute('src');
        if (nodes.image.tagName === 'VIDEO') nodes.image.load();
      }
      function pausePreviews() {
        previewNodes.forEach(function (nodes) { if (nodes.image.tagName === 'VIDEO') nodes.image.pause(); });
      }
      var previewVisibility = new MutationObserver(function () { if (root.closest('[hidden]')) pausePreviews(); });
      for (var ancestor = root; ancestor; ancestor = ancestor.parentElement) previewVisibility.observe(ancestor, { attributes: true, attributeFilter: ['hidden'] });
      function privatePreviewsEnabled() { return typeof WALK !== 'undefined' && WALK.initialPhotoPreviews === true; }
      function previewAuthority() {
        return privatePreviewsEnabled() && !destroyed && lastServerRevision >= 0 && Boolean(state.token) && !expired()
          && !state.busy && !state.batchBusy && !state.pending && !state.needsCheck && !state.writerPending
          && !state.extensionBusy && !state.extensionPending && !state.timeCheckHeld;
      }
      function previewKey(photo) {
        return JSON.stringify([state.token, generation, selectionGeneration, state.revision, state.expires, currentHash(),
          photo.id, photo.sha256, photo.content_type, photo.byte_size, photo.preview_hash]);
      }
      function previewIdentity(photo) { return JSON.stringify([state.token, photo.id, photo.sha256, photo.content_type, photo.byte_size, photo.preview_hash]); }
      function currentPreview(photo, key) {
        var current = state.photos.find(function (item) { return item.id === photo.id; });
        return previewAuthority() && current && !photoRejected(current) && current.preview_hash === currentHash() && previewKey(current) === key;
      }
      async function checkedPreview(result, photo) {
        if (!result || result.ok !== true || result.photo_id !== photo.id || result.sha256 !== photo.sha256
          || result.content_type !== photo.content_type || result.byte_size !== photo.byte_size || typeof result.preview_data_url !== 'string'
          || result.preview_data_url.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 80) throw new Error('invalid_private_preview');
        var match = /^data:(image\/(?:jpeg|png|webp)|video\/(?:mp4|quicktime|webm));base64,([A-Za-z0-9+/]+={0,2})$/.exec(result.preview_data_url);
        if (!match || match[1] !== photo.content_type || match[2].length % 4 || imageByteSize(result.preview_data_url) !== photo.byte_size) throw new Error('invalid_private_preview');
        var decoded = atob(match[2]);
        if (decoded.length !== photo.byte_size || btoa(decoded) !== match[2]) throw new Error('invalid_private_preview');
        var bytes = Uint8Array.from(decoded, function (character) { return character.charCodeAt(0); });
        var digest = await crypto.subtle.digest('SHA-256', bytes);
        var sha256 = Array.from(new Uint8Array(digest), function (value) { return value.toString(16).padStart(2, '0'); }).join('');
        if (sha256 !== photo.sha256) throw new Error('invalid_private_preview');
        return result.preview_data_url;
      }
      function paintPrivatePreviews() { renderPreviews(state.busy || state.batchBusy || state.locked || state.extensionBusy); }
      function queuePrivatePreviews() {
        if (!previewAuthority() || previewRunning || previewScheduled) return;
        previewScheduled = true;
        Promise.resolve().then(async function () {
          previewScheduled = false;
          if (!previewAuthority() || previewRunning) return;
          previewRunning = true;
          try {
            // One read at a time, at most the retained collection's ten files.
            // Preview reads never change upload authority, receipts or consent.
            for (var count = 0; count < MAX_PHOTOS && previewAuthority(); count++) {
              var photo = state.photos.find(function (item) {
                var load = previewLoads.get(item.id);
                return !state.images.has(item.id) && !photoRejected(item) && item.preview_hash === currentHash()
                  && (!load || load.key !== previewKey(item) || load.phase === 'queued');
              });
              if (!photo) break;
              var key = previewKey(photo), load = { key: key, phase: 'loading', manual: false };
              var previous = previewLoads.get(photo.id);
              if (previous && previous.manual) load.manual = true;
              previewLoads.set(photo.id, load); paintPrivatePreviews();
              try {
                var result = await WALK.initialPhoto('preview', { stage_token: state.token, photo_id: photo.id });
                if (!currentPreview(photo, key)) continue;
                var src = await checkedPreview(result, photo);
                if (!currentPreview(photo, key)) continue;
                var nodes = previewNodes.get(photo.id), focused = nodes && document.activeElement === nodes.previewRetry && root.getClientRects().length;
                state.images.set(photo.id, { src: src, evidence: null, hydrated: true, identity: previewIdentity(photo) }); previewLoads.delete(photo.id);
                paintPrivatePreviews();
                if (focused && !nodes.remove.disabled && nodes.remove.getClientRects().length) nodes.remove.focus({ preventScroll: true });
              } catch (_) {
                if (currentPreview(photo, key)) { load.phase = 'failed'; paintPrivatePreviews(); }
              } finally {
                if (previewLoads.get(photo.id) === load && !currentPreview(photo, key)) previewLoads.delete(photo.id);
              }
            }
          } finally { previewRunning = false; }
          // A generation may have changed while an older read was in flight.
          if (previewAuthority() && state.photos.some(function (photo) {
            var load = previewLoads.get(photo.id);
            return !state.images.has(photo.id) && !photoRejected(photo) && photo.preview_hash === currentHash() && (!load || load.key !== previewKey(photo) || load.phase === 'queued');
          })) queuePrivatePreviews();
        });
      }
      function retryPrivatePreview(id) {
        var photo = state.photos.find(function (item) { return item.id === id; });
        var load = previewLoads.get(id);
        if (!photo || !currentPreview(photo, previewKey(photo)) || state.locked || state.images.has(id)
          || !load || load.key !== previewKey(photo) || load.phase !== 'failed') return;
        previewLoads.set(id, { key: previewKey(photo), phase: 'queued', manual: true }); paintPrivatePreviews(); queuePrivatePreviews();
      }
      function renderPreviews(unavailable) {
        var pending = state.pending && state.pending.kind === 'upload' ? state.pending : null;
        var items = state.photos.slice();
        if (pending && pending.image && !hasPhoto(pending.request_key)) items.push({ id: pending.request_key, selected: true, content_type: /^data:([^;]+);/.exec(pending.image)[1] });
        var keep = new Set(items.map(function (photo) { return photo.id; }));
        previewNodes.forEach(function (nodes, id) { if (!keep.has(id)) { releasePreview(nodes); nodes.figure.remove(); previewNodes.delete(id); } });
        items.forEach(function (photo, index) {
          var nodes = previewNodes.get(photo.id);
          if (!nodes) {
            var figure = element('figure', '', 'initial-photo-preview'); figure.dataset.initialPhotoPreview = ''; figure.dataset.photoId = photo.id;
            var image = element(isVideo(photo) ? 'video' : 'img'); image.width = image.height = 200;
            if (isVideo(photo)) { image.controls = true; image.playsInline = true; image.preload = 'metadata'; }
            var placeholder = element('div', '', 'initial-photo-preview-placeholder'); placeholder.setAttribute('aria-hidden', 'true');
            var previewStatus = element('span'); previewStatus.setAttribute('role', 'status'); previewStatus.setAttribute('aria-live', 'polite'); previewStatus.setAttribute('aria-atomic', 'true');
            var previewRetry = element('button', 'Retry', 'initial-photo-button'); previewRetry.type = 'button'; previewRetry.dataset.initialPhotoPreviewRetry = ''; previewRetry.dataset.photoId = photo.id; previewRetry.hidden = true;
            previewRetry.addEventListener('click', function () { retryPrivatePreview(photo.id); });
            placeholder.append(previewStatus, previewRetry);
            var caption = element('figcaption');
            var corner = element('button', '\u00d7', 'initial-photo-button initial-photo-corner-remove'); corner.type = 'button'; corner.dataset.initialPhotoRemove = ''; corner.dataset.photoId = photo.id;
            corner.addEventListener('click', function () { removePhoto(photo.id, corner); });
            figure.append(image, placeholder, caption, corner);
            nodes = { figure: figure, image: image, placeholder: placeholder, previewStatus: previewStatus, previewRetry: previewRetry, caption: caption, remove: corner }; previewNodes.set(photo.id, nodes);
            image.addEventListener('error', function () {
              var cached = state.images.get(photo.id), current = state.photos.find(function (item) { return item.id === photo.id; });
              if (!cached || !cached.hydrated || image.getAttribute('src') !== cached.src || !current || destroyed || expired()
                || lastServerRevision < 0 || photoRejected(current) || current.preview_hash !== currentHash() || cached.identity !== previewIdentity(current)) return;
              state.images.delete(photo.id); previewLoads.set(photo.id, { key: previewKey(current), phase: 'failed', manual: false }); paintPrivatePreviews();
            });
          }
          var selected = Boolean(pending && pending.request_key === photo.id);
          var cached = state.images.get(photo.id), src = cached && cached.src || selected && pending.image || '';
          var mediaName = isVideo(photo) ? 'video' : 'photo';
          if (isVideo(photo)) nodes.image.setAttribute('aria-label', 'Your uploaded video ' + (index + 1));
          else nodes.image.alt = photo.selected ? 'Your selected panel photo' : 'Your uploaded panel photo ' + (index + 1);
          nodes.image.hidden = !src; nodes.placeholder.hidden = Boolean(src);
          var load = previewLoads.get(photo.id), activeLoad = load && load.key === previewKey(photo), failedPreview = activeLoad && load.phase === 'failed';
          var privateMissing = !src && !selected && privatePreviewsEnabled() && !photoRejected(photo) && photo.preview_hash === currentHash();
          var previewText = privateMissing ? failedPreview ? 'Unavailable' : activeLoad && load.manual ? 'Loading...' : lastServerRevision < 0 || state.needsCheck ? 'Checking saved file...' : 'Loading preview...' : isVideo(photo) ? 'Video attached' : 'Photo attached';
          if (nodes.previewStatus.textContent !== previewText) nodes.previewStatus.textContent = previewText;
          nodes.previewStatus.setAttribute('aria-label', failedPreview ? 'Preview unavailable' : previewText);
          nodes.placeholder.setAttribute('aria-hidden', privateMissing ? 'false' : 'true');
          // Keep recovery inside the existing square, below the remove control.
          nodes.placeholder.style.boxSizing = 'border-box';
          nodes.placeholder.style.padding = privateMissing ? '44px 4px 4px' : '';
          nodes.placeholder.style.gridTemplateRows = privateMissing ? 'minmax(0, 1fr) auto' : '';
          nodes.placeholder.style.rowGap = privateMissing ? '2px' : '';
          nodes.previewStatus.style.fontSize = privateMissing ? '14px' : '';
          nodes.previewStatus.style.lineHeight = privateMissing ? '1.2' : '';
          nodes.previewStatus.style.textAlign = 'center';
          nodes.previewRetry.style.minHeight = '44px'; nodes.previewRetry.style.padding = '6px 10px';
          nodes.previewRetry.hidden = !privateMissing || !failedPreview && !(activeLoad && load.manual);
          // aria-disabled keeps keyboard focus on an explicitly retried preview
          // while its read is pending. The retry handler also guards its phase.
          nodes.previewRetry.disabled = unavailable || !previewAuthority();
          nodes.previewRetry.setAttribute('aria-disabled', failedPreview && !nodes.previewRetry.disabled ? 'false' : 'true');
          nodes.previewRetry.textContent = activeLoad && load.manual && !failedPreview ? 'Loading...' : 'Retry';
          nodes.previewRetry.setAttribute('aria-label', (failedPreview ? 'Retry ' : 'Loading ') + mediaName + ' ' + (index + 1) + ' preview');
          if (src && nodes.image.getAttribute('src') !== src) nodes.image.src = src;
          if (!src) nodes.image.removeAttribute('src');
          var label = selected ? pending.awaitingChoice ? 'Discard selected ' + mediaName : 'Cancel this upload' : 'Remove ' + mediaName + ' ' + (index + 1);
          nodes.remove.setAttribute('aria-label', label); nodes.remove.title = label;
          nodes.remove.disabled = unavailable || Boolean(state.pending && !selected) || Boolean(pending && pending.limitRecovery && pending.cleanup) || state.writerPending && !state.pending;
          nodes.caption.hidden = !selected && !photoRejected(photo) && photo.preview_hash === currentHash();
          nodes.caption.textContent = selected ? pending.awaitingChoice ? 'Selected ' + mediaName + '. Save it before continuing.' : 'Selected ' + mediaName + '.' : photoRejected(photo) ? 'This ' + mediaName + ' needs to be removed.' : photo.preview_hash !== currentHash() ? 'This ' + mediaName + ' belongs to the earlier estimate. Remove it before continuing.' : isVideo(photo) ? 'Video ' + (index + 1) + ' attached.' : items.length === 1 ? 'Your panel photo is attached.' : 'Photo ' + (index + 1) + ' attached.';
          if (savedResult.children[index] !== nodes.figure) savedResult.insertBefore(nodes.figure, savedResult.children[index] || null);
        });
        savedResult.hidden = !items.length; examples.hidden = Boolean(items.length);
        exampleLabel.textContent = !items.length ? 'Photo examples' : items.some(isVideo) ? 'Your photos and videos' : items.length === 1 ? 'Your panel photo' : 'Your photos';
        remove.hidden = !pending || pending.image || hasPhoto(pending.request_key);
        remove.textContent = pending && pending.awaitingChoice ? 'Discard selected photo' : 'Cancel this upload';
        remove.setAttribute('aria-label', remove.textContent); remove.title = remove.textContent;
        remove.disabled = unavailable || Boolean(pending && pending.limitRecovery && pending.cleanup);
      }
      function render() {
        if (destroyed) return;
        // A delayed warning can run before the expiry callback after a return
        // from the background. Hold the known identity until time is checked.
        if (expired() && state.photo) {
          state.holdingExpiry = true; state.timeCheckHeld = true;
          if (!state.extensionBusy) state.timeMessage = 'Your photo time needs confirmation. Check photo time before submitting your details.';
        }
        var mismatch = state.photos.some(function (photo) { return photo.preview_hash !== currentHash(); });
        var rejected = state.photos.some(photoRejected);
        var retainedPhoto = lastServerRevision >= 0 && Boolean(state.photo) && !mismatch && !rejected;
        var unavailable = state.busy || state.batchBusy || state.locked || state.extensionBusy;
        var unsentChoice = Boolean(state.pending && state.pending.awaitingChoice);
        var full = state.photos.length >= state.photoLimit, exhausted = state.attemptsRemaining <= 0;
        var videoOnly = state.photos.length > 0 && !state.photo;
        choose.disabled = unavailable || full || exhausted || mismatch || rejected || Boolean(state.pending && !unsentChoice) || state.needsCheck || state.writerPending || Boolean(state.extensionPending);
        choose.hidden = false;
        choose.textContent = state.photos.length ? 'Upload another photo' : 'Upload a photo';
        retry.hidden = state.busy || state.batchBusy || !state.pending && !state.needsCheck && !(exhausted && !state.photos.length);
        retry.disabled = unavailable || unsentChoice && (!state.pending.image || !state.pending.evidence);
        retry.textContent = exhausted && !state.photos.length && !state.pending && !state.needsCheck ? 'Start a new photo session' : state.pending && state.pending.limitRecovery ? state.photos.length ? 'Check saved photos' : 'Start a new photo session' : unsentChoice ? state.pending.image ? 'Save selected photo' : 'Choose a photo again' : state.pending && state.pending.kind === 'remove' ? 'Retry removing photo' : state.pending && state.pending.reconcile ? 'Check photo before retrying' : state.needsCheck || state.pending && !state.pending.image ? 'Check saved photo' : 'Retry saving photo';
        renderPreviews(unavailable);
        controls.hidden = !Array.from(controls.children).some(function (node) { return !node.hidden; });
        var settledLimit = !state.pending && !state.needsCheck && !state.writerPending && !unavailable && !state.extensionPending && !state.timeCheckHeld && !expired() && !mismatch && !rejected;
        var limitMessage = exhausted ? state.photos.length ? 'This photo session reached its save limit. Your saved photos are kept. You can continue with them.' : 'This photo session reached its save limit. Start a new photo session to add a photo.' : full ? 'That is 10 photos. Remove one to add another, or continue with your saved photos.' : '';
        if (videoOnly && exhausted) limitMessage = 'This session reached its save limit. Remove the saved videos, then start a new photo session and add a panel photo.';
        else if (videoOnly && full) limitMessage = 'That is 10 files. Remove a video to make room for the required panel photo.';
        else if (state.photos.some(isVideo)) limitMessage = limitMessage.replace(/photos/g, 'files');
        status.textContent = settledLimit && limitMessage ? limitMessage : videoOnly && !state.pending && !unavailable && !state.needsCheck && !state.writerPending && !mismatch && !rejected && !expired() ? 'Your video is attached. Add one panel photo before continuing.' : state.message || (state.writerPending ? 'Another photo is still saving in this session. Check the saved photo again before continuing.' : timeHeld() ? 'Your photo time needs confirmation before you can submit your details.' : expired() ? 'Your photo expired. Attach a photo again before continuing.' : mismatch ? 'Your estimate changed. Remove the photos from the earlier estimate before adding photos for this range.' : limitMessage || (ready() ? 'Panel photo saved. You can accept your estimate range.' : ''));
        error.textContent = state.error || (rejected ? 'Your photo could not be verified. Choose a replacement or remove it and try again.' : '');
        status.hidden = Boolean(state.error && state.pending && /unconfirmed/.test(state.message) && !state.writerPending && !timeHeld());
        var expiryError = !state.photo && !state.pending && /expired|no longer available/.test(state.error);
        root.classList.toggle('has-saved-photo', retainedPhoto);
        var warning = Boolean(state.photo && !rejected && remainingTime() > 0 && remainingTime() <= WARNING_MS);
        timeWarning.hidden = !state.photo || rejected || !(warning || state.timeOpen || state.extensionPending || state.timeCheckHeld);
        timeStatus.textContent = timeWarning.hidden ? '' : state.timeMessage || (state.extensionPending ? 'We could not confirm whether photo time was extended. Retry or check photo time before submitting your details.' : state.timeCheckHeld ? 'Your photo time needs confirmation. Check photo time before submitting your details.' : warning ? state.extensionCount < MAX_EXTENSIONS ? 'Your saved photo expires in under 2 minutes. Extend photo time adds 15 minutes and keeps your estimate and entered details here.' : 'Your saved photo expires in under 2 minutes. You have used all 10 extensions. Submit your details before expiry, or attach a new photo after it expires.' : 'Photo time confirmed. You can extend it ' + (MAX_EXTENSIONS - state.extensionCount) + ' more times.');
        extend.textContent = state.extensionBusy ? 'Checking photo time...' : state.timeCheckHeld || timeHeld() ? 'Check photo time' : state.extensionPending ? state.extensionPending.needsSync ? 'Check photo time' : 'Retry extending photo time' : 'Extend photo time';
        var checkingTime = state.timeCheckHeld || timeHeld() || Boolean(state.extensionPending);
        extend.disabled = unavailable || !state.photo || rejected || state.needsCheck && !checkingTime || Boolean(state.pending) || !checkingTime && (expired() || state.extensionCount >= MAX_EXTENSIONS);
        timePrimary.textContent = state.extensionBusy ? 'Checking time' : state.extensionPending || state.timeCheckHeld ? 'Time unconfirmed' : warning ? 'Under 2 min' : state.timeMessage.indexOf('Photo time extended') === 0 ? 'Photo time extended' : 'Photo time confirmed';
        timeCount.textContent = warning && state.extensionCount >= MAX_EXTENSIONS ? 'No extensions left' : (MAX_EXTENSIONS - state.extensionCount) + ' extensions left';
        root.setAttribute('aria-busy', state.busy ? 'true' : 'false');
        root.dataset.photoState = state.busy ? 'busy' : state.pending || state.needsCheck ? 'unconfirmed' : ready() ? 'saved' : 'required';
        root.dataset.photoPhase = state.busy ? /^Preparing/.test(state.message) ? 'preparing' : /Checking/.test(state.message) ? 'checking' : /Removing/.test(state.message) ? 'removing' : 'saving' : state.pending || state.needsCheck || state.writerPending || state.error ? 'recovery' : ready() ? 'saved' : 'required';
        root.dataset.photoAction = !retry.hidden ? 'retry' : state.photos.length ? 'append' : 'add';
        root.dataset.photoCount = String(state.photos.length); root.dataset.photoLimitReached = full || exhausted ? 'true' : 'false';
        heading.textContent = retainedPhoto ? 'Panel photo saved' : 'For an accurate quote,\nplease add one panel photo';
        if (restoreActionFocus && !state.busy && !state.batchBusy) {
          var remaining = Array.from(previewNodes.values());
          var target = expiryError ? heading : state.pending || state.needsCheck ? retry : removeFocusIndex >= 0 && remaining.length ? remaining[Math.min(removeFocusIndex, remaining.length - 1)].remove : choose;
          if (target.disabled || target.hidden) target = heading;
          var active = document.activeElement;
          if (active !== document.body && active !== actionFocusOrigin && active !== chooseInput) restoreActionFocus = false;
          else if (!target.hidden && !target.disabled && target.getClientRects().length) { target.focus({ preventScroll: true }); feedbackOrigin = target; restoreActionFocus = false; removeFocusIndex = -1; }
        }
        persist(); notify();
        queuePrivatePreviews();
        showInitiatedFeedback();
        cancelAnimationFrame(warningFrame); warningFrame = requestAnimationFrame(function () { syncWarningLayout(true); });
      }
      function syncWarningLayout(protectFocus) {
        if (destroyed) return;
        var html = document.documentElement;
        if (timeWarning.hidden || !timeWarning.getClientRects().length) { html.classList.remove('bpp-photo-time-visible'); html.style.removeProperty('--bpp-photo-time-reserved'); return; }
        var viewport = window.visualViewport;
        var width = viewport ? viewport.width : window.innerWidth, height = viewport ? viewport.height : window.innerHeight;
        var top = viewport ? viewport.offsetTop : 0, left = viewport ? viewport.offsetLeft : 0;
        var safeStyle = getComputedStyle(timeWarning), bottomMargin = Math.max(12, (parseFloat(safeStyle.getPropertyValue('--photo-time-safe-bottom')) || 0) + 8);
        var leftMargin = Math.max(12, (parseFloat(safeStyle.getPropertyValue('--photo-time-safe-left')) || 0) + 8), rightMargin = Math.max(12, (parseFloat(safeStyle.getPropertyValue('--photo-time-safe-right')) || 0) + 8);
        var panelWidth = Math.max(1, Math.min(620, width - leftMargin - rightMargin));
        timeWarning.style.width = panelWidth + 'px'; timeWarning.style.maxHeight = Math.max(48, height * 0.6) + 'px';
        timeWarning.dataset.timeCompact = width < 280 ? 'true' : 'false';
        var panelHeight = timeWarning.getBoundingClientRect().height;
        timeWarning.style.left = left + leftMargin + (width - leftMargin - rightMargin - panelWidth) / 2 + 'px';
        timeWarning.style.top = top + Math.max(0, height - panelHeight - bottomMargin) + 'px';
        html.classList.add('bpp-photo-time-visible'); html.style.setProperty('--bpp-photo-time-reserved', panelHeight + bottomMargin + 16 + 'px');
        var active = document.activeElement;
        if (!protectFocus || !active || active === document.body || timeWarning.contains(active) || active.closest('dialog[open]')) return;
        var focused = active.getBoundingClientRect(), panel = timeWarning.getBoundingClientRect();
        if (focused.bottom > panel.top - 8 && focused.top < panel.bottom && focused.right > panel.left && focused.left < panel.right) {
          window.scrollBy({ top: focused.bottom - panel.top + 12, behavior: 'instant' });
        }
      }
      function updateWarningViewport() { syncWarningLayout(true); }
      function trackWarningScroll() { syncWarningLayout(false); }
      function restoreExtensionFocus(wasFocused) {
        if (!wasFocused || destroyed || document.activeElement !== document.body && document.activeElement !== extend) return;
        function visible(node) { return Boolean(node && node.isConnected && !node.disabled && !node.closest('[hidden]') && node.getClientRects().length && getComputedStyle(node).visibility === 'visible'); }
        if (!extend.disabled && visible(extend)) extend.focus({ preventScroll: true });
        else if (visible(timeSummary) && state.extensionCount >= MAX_EXTENSIONS && !state.locked) { timeSummary.tabIndex = -1; timeSummary.focus({ preventScroll: true }); }
        else if (!state.locked) {
          var flow = root.closest('[data-guided-flow]');
          var activeScreen = flow && Array.from(flow.querySelectorAll('[data-screen]')).find(visible);
          var logical = visible(heading) ? heading : activeScreen && Array.from(activeScreen.querySelectorAll('h1,h2,h3,button,a,input,textarea,summary')).find(visible);
          if (logical) { if (/^H[1-6]$/.test(logical.tagName)) logical.tabIndex = -1; logical.focus(); }
        }
      }
      function expireTimer() {
        clearTimeout(expiryTimer); clearTimeout(warningTimer);
        if (!state.expires || timeHeld()) return;
        var remaining = remainingTime();
        if (remaining > WARNING_MS) warningTimer = setTimeout(function () { if (!destroyed) { if (!state.extensionPending && !state.extensionBusy) state.timeMessage = ''; render(); } }, remaining - WARNING_MS + 10);
        expiryTimer = setTimeout(function () {
          if (destroyed || !expired()) return;
          if (state.photo) {
            state.holdingExpiry = true; state.timeCheckHeld = true;
            if (document.visibilityState === 'hidden') return;
            if (!state.extensionBusy && !state.busy && !state.locked) checkExtension(); else render();
            return;
          }
          ++generation; state.busy = false; clearExpired(); state.message = ''; state.error = 'Your photo expired. Attach a photo again before continuing.'; render();
        }, Math.max(0, remaining) + 10);
      }
      function setReceipt(result, allowUnreserved, requestStarted, fullStage) {
        if (result && result.expired === true) throw new Error('stage_expired');
        if (result && result.consumed === true) throw new Error('initial_photo_session_unavailable');
        var unreserved = allowUnreserved && result && result.initial_photo == null && result.stage_revision === 0 && result.stage_expires_at == null && result.upload_attempt == null;
        if (!result || result.ok !== true || !Number.isSafeInteger(result.stage_revision) || result.stage_revision < 0 || !unreserved && !Number.isFinite(Date.parse(result.stage_expires_at))) throw new Error('unconfirmed_photo');
        if (result.initial_photo != null && (!storedPhoto(result.initial_photo) || isVideo(result.initial_photo))) throw new Error('unconfirmed_photo');
        if (result.initial_photos !== undefined && !Array.isArray(result.initial_photos)) throw new Error('unconfirmed_photo_set');
        if (result.upload_attempt != null && (!UUID.test(result.upload_attempt.id || '') || ['uploading', 'ready', 'consumed', 'removed', 'cleaning', 'cleaned', 'dead_letter'].indexOf(result.upload_attempt.status) === -1 || fullStage && result.upload_attempt.status !== 'uploading')) throw new Error('unconfirmed_photo_attempt');
        if (result.stage_time_revision != null && (!Number.isSafeInteger(result.stage_time_revision) || result.stage_time_revision < 0 || !Number.isSafeInteger(result.extension_count) || result.extension_count < 0 || result.extension_count > MAX_EXTENSIONS || result.extensions_remaining !== MAX_EXTENSIONS - result.extension_count)) throw new Error('unconfirmed_photo_time');
        var photos = Array.isArray(result.initial_photos) ? result.initial_photos.slice() : result.initial_photo ? [result.initial_photo] : [];
        if (photos.length > MAX_PHOTOS || photos.some(function (photo) { return !storedPhoto(photo); }) || new Set(photos.map(function (photo) { return photo.id; })).size !== photos.length
          || (result.initial_photo ? !photos.length || result.initial_photo.id !== photos[0].id : photos.some(function (photo) { return !isVideo(photo); }))) throw new Error('unconfirmed_photo_set');
        if (!Array.isArray(result.initial_photos) && state.pending && state.pending.kind === 'upload' && state.photos.length && !hasPhoto(state.pending.request_key)) throw new Error('unconfirmed_photo_collection');
        var ids = JSON.stringify(photos);
        if (lastServerRevision >= 0 && (result.stage_revision < lastServerRevision || result.stage_revision === lastServerRevision && ids !== lastServerIds)) throw new Error('unconfirmed_photo_revision');
        if (result.photo_limit != null && result.photo_limit !== MAX_PHOTOS || result.photos_remaining != null && result.photos_remaining !== MAX_PHOTOS - photos.length
          || result.upload_attempts_remaining != null && (!Number.isSafeInteger(result.upload_attempts_remaining) || result.upload_attempts_remaining < 0 || result.upload_attempts_remaining > 12)) throw new Error('unconfirmed_photo_limits');
        var previousIds = new Set(state.photos.map(function (photo) { return photo.id; }));
        photos = photos.map(function (photo) { return { id: photo.id, sha256: photo.sha256, content_type: photo.content_type, byte_size: photo.byte_size, preview_hash: photo.preview_hash }; });
        state.photos = photos; state.photo = photos.find(function (photo) { return !isVideo(photo); }) || null; state.revision = result.stage_revision;
        lastServerRevision = result.stage_revision; lastServerIds = ids;
        state.photoLimit = MAX_PHOTOS;
        if (result.upload_attempts_remaining != null) state.attemptsRemaining = result.upload_attempts_remaining;
        state.expires = unreserved ? state.expires || new Date(Date.now() + INITIAL_PHOTO_WINDOW_MS).toISOString() : result.stage_expires_at;
        if (Number.isFinite(Date.parse(result.stage_server_now))) state.clockOffset = Date.parse(result.stage_server_now) - Date.now() + (Number.isFinite(requestStarted) ? Math.max(0, Date.now() - requestStarted) : 0);
        if (result.stage_time_revision != null) { state.timeRevision = result.stage_time_revision; state.extensionCount = result.extension_count; }
        if (fullStage) state.writerPending = Boolean(result.upload_attempt);
        state.rejectedPhotoIds = state.rejectedPhotoIds.filter(hasPhoto);
        if (state.rejectedPhotoId && !hasPhoto(state.rejectedPhotoId)) state.rejectedPhotoId = '';
        if (state.pending && state.pending.kind === 'upload' && hasPhoto(state.pending.request_key) && state.pending.image)
          state.images.set(state.pending.request_key, { src: state.pending.image, evidence: state.pending.evidence });
        state.images.forEach(function (_, id) { if (!hasPhoto(id)) state.images.delete(id); });
        previewLoads.forEach(function (_, id) { if (!hasPhoto(id)) previewLoads.delete(id); });
        photos.forEach(function (photo) {
          if (!expired() && !previousIds.has(photo.id) && !observedPhotoIds.has(photo.id)) {
            observedPhotoIds.add(photo.id); if (typeof WALK.ph === 'function') WALK.ph('walk_v2_photo_uploaded', { kind: 'image' });
          }
        });
        expireTimer();
      }
      function clearExpired() {
        state.message = '';
        automaticTimeCheck = false;
        ++selectionGeneration; state.batchBusy = false; state.photos = []; state.images.clear(); previewLoads.clear(); state.rejectedPhotoIds = []; state.attemptsRemaining = 12; lastServerRevision = -1; lastServerIds = '';
        state.token = ''; state.photo = null; state.pending = null; state.revision = 0; state.expires = ''; state.image = ''; state.imageEvidence = null; state.needsCheck = false; state.writerPending = false; state.rejectedPhotoId = '';
        state.timeRevision = 0; state.extensionCount = 0; state.extensionPending = null; state.extensionBusy = false; state.holdingExpiry = false; state.timeCheckHeld = false; state.clockOffset = 0; state.timeMessage = ''; state.timeOpen = false;
        clearTimeout(expiryTimer); clearTimeout(warningTimer); persist();
      }
      function errorText(value, kind) {
        var code = String(value && (value.code || value.message) || '');
        if (/large_photo/.test(code)) return 'That photo is over 20 MB. Choose a smaller photo.';
        if (/large_video/.test(code)) return 'That video is over 4 MB. Choose a shorter or smaller video.';
        if (/video_unplayable|invalid_video|video_type_mismatch|video_read_failed/.test(code)) return 'This video could not be played or verified. Choose a playable MP4, MOV or WebM video up to 4 MB.';
        if (/unsupported_photo/.test(code)) return 'Choose a JPEG, PNG, WebP or HEIC photo, or an MP4, MOV or WebM video up to 4 MB. Screenshots saved as JPEG or PNG also work.';
        if (/empty_photo/.test(code)) return 'That file is empty. Choose another photo.';
        if (/large_normalized/.test(code)) return 'That photo could not be reduced enough to upload. Choose a smaller photo.';
        if (/bad_image|image_decode|canvas_|image_encoding/.test(code)) return kind === 'heic' ? 'This browser cannot read that HEIC photo. Export it as JPEG or PNG, then choose it again.' : 'This browser could not read that photo. Choose another image or save it as JPEG or PNG.';
        if (/expired|stage_expired|initial_photo_session_unavailable/.test(code)) return 'Your saved photo is no longer available. Attach a photo again before continuing.';
        return 'We could not confirm that your photo saved. Retry using the same photo. Your contact details have not been submitted.';
      }
      async function readPhoto(key) {
        var started = Date.now(), payload = { stage_token: state.token };
        if (key) payload.request_key = key;
        var result = await WALK.initialPhoto('status', payload);
        return { result: result, started: started };
      }
      function selectedChoice(image, message, evidence) {
        state.needsCheck = false; state.error = ''; state.message = message;
        state.pending = image && evidence ? { kind: 'upload', request_key: crypto.randomUUID(), expected_revision: state.revision, preview_hash: currentHash(), image: image, evidence: evidence, awaitingChoice: true } : null;
        if (!image) state.message = 'Choose your photo again. Only its attachment details can be restored after reload.';
      }
      async function reconcileUpload() {
        var pending = state.pending;
        if (!pending || pending.kind !== 'upload') return;
        state.busy = true; state.error = ''; state.message = 'Checking the changed photo before retrying...'; render();
        var run = ++generation;
        try {
          var checked = await readPhoto(pending.request_key);
          if (destroyed || run !== generation) return;
          setReceipt(checked.result, true, checked.started);
          var ownAttempt = checked.result.upload_attempt;
          // Keyed replies describe that attempt, not a different current writer.
          checked = await readPhoto();
          if (destroyed || run !== generation) return;
          setReceipt(checked.result, true, checked.started, true); state.needsCheck = state.writerPending;
          if (state.writerPending && (!ownAttempt || ownAttempt.id !== pending.request_key || checked.result.upload_attempt.id !== pending.request_key)) {
            pending.reconcile = true; state.message = 'Another photo is still saving in this session. Check again before saving your selected photo.';
          } else if (!state.writerPending && hasPhoto(pending.request_key) && state.photos.some(function (photo) { return photo.id === pending.request_key && photo.preview_hash === pending.preview_hash; })) {
            state.image = pending.image || ''; state.imageEvidence = state.image ? pending.evidence : null; state.pending = null; state.message = 'Panel photo saved. You can accept your estimate range.';
          } else if (state.writerPending && checked.result.upload_attempt.id === pending.request_key) {
            pending.reconcile = false; state.needsCheck = false; state.message = 'This save is still in progress. Retry the same save or cancel it.';
          } else {
            selectedChoice(pending.image, 'The saved photo changed. Your selected photo is still here. Choose Save selected photo to attach it to this range.', pending.evidence);
          }
        } catch (value) {
          if (destroyed || run !== generation) return;
          state.error = 'The changed photo could not be checked. Try checking again before continuing.'; state.message = '';
          if (/expired|stage_expired|initial_photo_session_unavailable/.test(String(value && (value.code || value.message) || ''))) { clearExpired(); state.error = 'Your saved photo is no longer available. Attach a photo again before continuing.'; }
        } finally { if (!destroyed && run === generation) { state.busy = false; render(); } }
      }
      async function restartPhotoSession() {
        var pending = state.pending;
        if (!pending || !pending.limitRecovery) return;
        if (state.photos.length) return reconcileLimit();
        state.busy = true; state.error = ''; state.message = 'Checking and clearing this photo session before starting again...'; render();
        var run = ++generation;
        try {
          for (var step = 0; step < 4; step++) {
            var checked = await readPhoto();
            if (destroyed || run !== generation) return;
            setReceipt(checked.result, true, checked.started, true);
            if (state.photos.length) { state.busy = false; return reconcileLimit(); }
            var writer = checked.result.upload_attempt && checked.result.upload_attempt.status === 'uploading' ? checked.result.upload_attempt.id : null;
            if (!pending.cleanup) {
              var target = writer || state.photo && state.photo.id;
              if (!target) {
                var image = pending.image, evidence = pending.evidence;
                clearExpired();
                if (image && evidence) { state.token = randomToken(); state.expires = new Date(Date.now() + INITIAL_PHOTO_WINDOW_MS).toISOString(); selectedChoice(image, 'The previous photo session is cleared. Save your selected photo to continue.', evidence); expireTimer(); }
                else state.message = 'The previous photo session is cleared. Choose a photo again.';
                return;
              }
              pending.cleanup = { photo_id: target, request_key: crypto.randomUUID(), expected_revision: state.revision };
            }
            var cleanup = pending.cleanup;
            if (cleanup.reconcile) {
              checked = await readPhoto(cleanup.photo_id);
              if (destroyed || run !== generation) return;
              setReceipt(checked.result, true, checked.started);
              if (removedAttempt(checked.result, cleanup.photo_id)) { pending.cleanup = null; continue; }
              cleanup.request_key = crypto.randomUUID(); cleanup.expected_revision = state.revision; cleanup.reconcile = false;
            }
            var started = Date.now();
            var result = await WALK.initialPhoto('remove', { stage_token: state.token, request_key: cleanup.request_key, expected_revision: cleanup.expected_revision, photo_id: cleanup.photo_id });
            if (destroyed || run !== generation) return;
            setReceipt(result, true, started, true);
            if (hasPhoto(cleanup.photo_id) || result.upload_attempt && result.upload_attempt.id === cleanup.photo_id && result.upload_attempt.status === 'uploading') throw new Error('unconfirmed_removal');
            pending.cleanup = null;
          }
          state.message = 'This photo session changed while it was being cleared. Choose Start a new photo session to check it again.';
        } catch (value) {
          if (destroyed || run !== generation) return;
          var code = String(value && (value.code || value.message) || '');
          if (pending.cleanup && /stale|conflict|revision|selection_changed/.test(code)) pending.cleanup.reconcile = true;
          state.error = 'The previous photo session could not be confirmed cleared. Try starting again; your selected photo is still here.'; state.message = '';
          if (/expired|stage_expired|initial_photo_session_unavailable/.test(code)) { clearExpired(); state.error = 'Your saved photo is no longer available. Attach a photo again before continuing.'; }
        } finally { if (!destroyed && run === generation) { state.busy = false; render(); } }
      }
      async function reconcileLimit() {
        var pending = state.pending;
        if (!pending || !pending.limitRecovery) return;
        state.busy = true; state.error = ''; state.message = 'Checking your saved photos...'; render();
        var run = ++generation;
        try {
          var checked = await readPhoto(pending.request_key);
          if (destroyed || run !== generation) return;
          setReceipt(checked.result, true, checked.started);
          var ownAttempt = checked.result.upload_attempt;
          checked = await readPhoto();
          if (destroyed || run !== generation) return;
          setReceipt(checked.result, true, checked.started, true); state.needsCheck = state.writerPending;
          if (state.writerPending || ownAttempt && ownAttempt.status === 'uploading') {
            state.message = 'A photo save is still unconfirmed. Check again before continuing.';
          } else if (hasPhoto(pending.request_key) || state.photos.length) {
            state.pending = null;
            state.message = state.attemptsRemaining <= 0 ? 'This photo session reached its save limit. Your saved photos are kept. You can continue with them.' : state.photos.length >= state.photoLimit ? 'That is 10 photos. Remove one to add another, or continue with your saved photos.' : 'Your saved photos are kept. You can add another photo or continue.';
          } else {
            state.error = 'This empty photo session reached its save limit. Start a new photo session to save your selected photo.'; state.message = '';
          }
        } catch (_) {
          if (destroyed || run !== generation) return;
          state.error = 'Your saved photos could not be checked. Check again before continuing.'; state.message = '';
        } finally { if (!destroyed && run === generation) { state.busy = false; render(); } }
      }
      async function sendPending() {
        if (state.busy || state.locked || state.extensionBusy) return;
        if ([retry, remove].indexOf(document.activeElement) !== -1) ownActionFocus(document.activeElement);
        if (!state.pending) return state.needsCheck ? refresh() : state.attemptsRemaining <= 0 && !state.photos.length ? restartEmptySession() : undefined;
        if (state.pending.limitRecovery) return restartPhotoSession();
        if (state.pending.kind === 'upload' && state.pending.reconcile) return reconcileUpload();
        if (state.pending.awaitingChoice) {
          if (!state.pending.image || !state.pending.evidence || !HASH.test(currentHash())) return;
          state.pending.awaitingChoice = false; state.pending.preview_hash = currentHash();
        }
        if (state.needsCheck && state.pending.kind === 'upload') return refresh();
        if (expired()) { clearExpired(); state.error = 'Your photo expired. Attach a photo again before continuing.'; render(); return; }
        if (state.pending.kind === 'remove' && state.pending.reconcile) return reconcileRemoval();
        if (state.pending.kind === 'upload' && (!state.pending.image || !state.pending.evidence)) return refresh();
        state.busy = true; state.error = ''; state.message = state.pending.kind === 'remove' ? 'Removing your photo...' : 'Saving your panel photo...'; render();
        var run = ++generation, pending = state.pending, requestStarted = Date.now();
        try {
          var payload = { stage_token: state.token, request_key: pending.request_key, expected_revision: pending.expected_revision };
          if (pending.kind === 'upload') { payload.image = pending.image; payload.content_type = /^data:([^;]+);/.exec(pending.image)[1]; payload.preview_hash = pending.preview_hash; Object.assign(payload, pending.evidence); }
          else payload.photo_id = pending.photo_id;
          var result = await WALK.initialPhoto(pending.kind, payload);
          if (destroyed || run !== generation) return;
          setReceipt(result, false, requestStarted, pending.kind === 'remove');
          if (pending.kind === 'upload' && (!state.photos.some(function (photo) { return photo.id === pending.request_key && photo.preview_hash === pending.preview_hash; }))) throw new Error('unconfirmed_photo');
          if (pending.kind === 'upload') {
            // A complete finalize receipt already follows stored-byte/SHA
            // verification and the locked collection update. Avoid spending a
            // second upload-rate token on that same authoritative snapshot.
            // Sparse/uncertain replies still require the recovery read below.
            var finalized = state.batchBusy && batchSize > 1 && Array.isArray(result.initial_photos) && result.upload_attempt
              && result.upload_attempt.id === pending.request_key && result.upload_attempt.status === 'ready';
            if (finalized) { state.writerPending = false; state.needsCheck = false; }
            else {
              pending.reconcile = true; state.message = 'Checking your saved photo...'; render();
              var checked = await readPhoto();
              if (destroyed || run !== generation) return;
              setReceipt(checked.result, true, checked.started, true);
            }
            if (state.writerPending) throw new Error('initial_photo_upload_in_progress');
            if (!state.photos.some(function (photo) { return photo.id === pending.request_key && photo.preview_hash === pending.preview_hash; })) throw new Error('initial_photo_selection_changed');
          }
          if (pending.kind === 'remove' && (hasPhoto(pending.photo_id) || result.upload_attempt && result.upload_attempt.id === pending.photo_id && result.upload_attempt.status === 'uploading')) throw new Error('unconfirmed_removal');
          state.pending = null; state.error = ''; state.message = ''; state.needsCheck = state.writerPending;
          if (pending.kind === 'remove' && pending.photo_id === state.rejectedPhotoId && !hasPhoto(pending.photo_id)) state.rejectedPhotoId = '';
          if (pending.kind === 'upload') { state.image = pending.image; state.imageEvidence = pending.evidence; state.images.set(pending.request_key, { src: pending.image, evidence: pending.evidence }); }
          else if (!state.photo) { state.image = ''; state.imageEvidence = null; state.extensionPending = null; state.holdingExpiry = false; state.timeCheckHeld = false; state.timeMessage = ''; state.timeOpen = false; expireTimer(); }
          else state.message = pending.cancelUpload ? 'The unsaved photo was canceled. Your saved photos are still attached.' : 'Photo removed. Your other saved photos are still attached.';
        } catch (value) {
          if (destroyed || run !== generation) return;
          state.error = pending.kind === 'remove' ? 'We could not confirm the photo was removed. Retry removing it before continuing.' : errorText(value);
          state.message = pending.kind === 'remove' ? 'Photo removal is still unconfirmed. Retry before continuing.' : 'Your photo has an unconfirmed save. Check or retry before continuing.';
          var code = String(value && (value.code || value.message) || '');
          if (pending.kind === 'upload' && state.photos.length && !hasPhoto(pending.request_key)) { state.error = 'We could not confirm the extra photo saved. Retry it, or cancel this upload to keep your saved photos.'; state.message = 'The extra photo save is unconfirmed. Your saved photos are kept and your contact details have not been submitted.'; }
          if (pending.kind === 'remove' && /stale|conflict|revision|selection_changed|unconfirmed_removal/.test(code)) pending.reconcile = true;
          if (pending.kind === 'upload' && /attempt_terminal|selection_changed|stale_initial_photo_revision|initial_photo_operation_conflict|initial_photo_upload_in_progress/.test(code)) { pending.reconcile = true; state.needsCheck = false; state.error = 'That save needs a fresh photo check. Your selected photo is still here.'; }
          if (pending.kind === 'upload' && /initial_photo_attempt_limit|initial_photo_limit/.test(code)) {
            pending.limitRecovery = true; state.needsCheck = false;
            if (/initial_photo_attempt_limit/.test(code)) state.attemptsRemaining = 0;
            state.error = 'This photo session reached its limit. Check your saved photos before continuing.'; state.message = '';
          }
          if (/expired|stage_expired|initial_photo_session_unavailable/.test(code)) { clearExpired(); state.message = ''; state.error = 'Your saved photo is no longer available. Attach a photo again before continuing.'; }
        } finally {
          if (!destroyed && run === generation) { state.busy = false; render(); }
        }
      }
      async function restartEmptySession() {
        if (state.photos.length || state.pending || state.writerPending || state.needsCheck) return;
        state.busy = true; state.error = ''; state.message = 'Checking the empty photo session...'; render();
        var run = ++generation;
        try {
          var checked = await readPhoto();
          if (destroyed || run !== generation) return;
          setReceipt(checked.result, true, checked.started, true);
          if (state.photos.length || state.writerPending) { state.needsCheck = state.writerPending; state.message = 'This session has saved or saving photos. Check them before continuing.'; }
          else { clearExpired(); state.error = ''; state.message = 'Choose a photo to start your new session.'; }
        } catch (_) { if (!destroyed && run === generation) { state.error = 'The empty photo session could not be checked. Try again.'; state.message = ''; } }
        finally { if (!destroyed && run === generation) { state.busy = false; render(); } }
      }
      async function uploadImage(image, evidence) {
        if (state.busy || state.locked || state.extensionBusy || state.extensionPending || state.pending || state.needsCheck || !image || !evidence) return;
        var hash = currentHash();
        if (!HASH.test(hash)) { state.error = 'Refresh your estimate before attaching a photo.'; render(); return; }
        if (state.photos.length >= state.photoLimit || state.attemptsRemaining <= 0 || state.photos.some(function (photo) { return photo.preview_hash !== hash || photoRejected(photo); })) {
          state.error = state.attemptsRemaining <= 0 ? 'This photo session reached its save limit. Your saved photos are kept.' : state.photos.length >= state.photoLimit ? 'You can attach up to 10 photos. Remove one to add another, or continue.' : 'Remove the photos from the earlier estimate before adding photos for this range.'; render(); return;
        }
        if (expired()) clearExpired();
        if (!state.token) { state.token = randomToken(); state.expires = new Date(Date.now() + INITIAL_PHOTO_WINDOW_MS).toISOString(); expireTimer(); }
        if (!state.photo) { state.image = image; state.imageEvidence = evidence; }
        state.pending = { kind: 'upload', request_key: crypto.randomUUID(), expected_revision: state.revision, image: image, evidence: evidence, preview_hash: hash };
        await sendPending();
      }
      async function selectFiles(files, origin) {
        if (destroyed || state.batchBusy || state.busy || state.locked || state.extensionBusy || state.extensionPending || state.pending && !state.pending.awaitingChoice || state.needsCheck || state.writerPending) return;
        if (expired() && state.token) {
          if (state.photos.length) { state.error = 'Check photo time before adding another photo. Your saved photos are kept until their time is confirmed.'; render(); return; }
          clearExpired();
        }
        var available = Math.min(state.photoLimit - state.photos.length, state.attemptsRemaining);
        if (files.length > available) { state.error = state.attemptsRemaining <= 0 ? state.photos.length ? 'This photo session reached its save limit. Your saved photos are kept. You can continue with them.' : 'This empty photo session reached its save limit. Start a new photo session to add a photo.' : available > 0 ? 'Choose up to ' + available + ' more photos. Your saved photos are kept.' : 'This photo session is full. Your saved photos are kept; remove one or continue.'; render(); return; }
        var batch = ++selectionGeneration;
        state.batchBusy = true; batchSize = files.length;
        try {
          for (var index = 0; index < files.length; index++) {
            var before = state.photos.length;
            await select(files[index], origin);
            if (destroyed || batch !== selectionGeneration) return;
            if (state.pending || state.error || state.photos.length <= before) {
              if (index + 1 < files.length) state.error = (state.error || 'This photo could not be saved.') + ' The remaining selected photos were not uploaded. Choose them again after resolving this photo.';
              break;
            }
          }
          // Recheck the complete batch before exposing Continue. Individual
          // appends retain their immediate read, while a multi-file selection
          // uses one final read instead of one redundant read per file.
          if (batchSize > 1 && !state.pending && state.token && state.photos.length) {
            var priorMessage = state.message;
            state.needsCheck = true; state.message = 'Checking your saved photos...'; render();
            try {
              var checked = await readPhoto();
              if (destroyed || batch !== selectionGeneration) return;
              setReceipt(checked.result, true, checked.started, true);
              state.needsCheck = state.writerPending;
              state.message = state.writerPending ? 'Another photo is still saving. Check your saved photos before continuing.' : priorMessage;
            } catch (_) {
              if (destroyed || batch !== selectionGeneration) return;
              state.needsCheck = true; state.error = 'Your saved photos could not be checked. Check again before continuing.'; state.message = '';
            }
          }
        } finally { if (!destroyed && batch === selectionGeneration) { state.batchBusy = false; batchSize = 0; render(); } }
      }
      async function select(file, origin) {
        if (state.busy || state.locked || state.extensionBusy || state.extensionPending || state.pending && !state.pending.awaitingChoice || state.needsCheck) return;
        if (state.pending && state.pending.awaitingChoice) state.pending = null;
        ownActionFocus(origin);
        state.busy = true; state.error = ''; state.message = 'Preparing your photo...'; render();
        var run = ++generation, kind = '';
        try {
          kind = await formatFor(file);
          var video = VIDEO_TYPES.indexOf(kind) !== -1;
          var image = video ? await prepareVideo(file, kind) : await WALK.resizeImage(file, 1600);
          if (!(video ? /^data:video\/(?:mp4|quicktime|webm);base64,/ : /^data:image\/jpeg;base64,/).test(image)) throw new Error('image_encoding_failed');
          if (imageByteSize(image) > MAX_UPLOAD_BYTES) throw new Error('large_normalized');
          if (destroyed || run !== generation) return;
          state.busy = false; state.message = '';
          await uploadImage(image, selectedFileEvidence());
        } catch (value) {
          if (destroyed || run !== generation) return;
          state.error = errorText(value, kind); state.message = '';
          if (state.photo && state.photo.id !== state.rejectedPhotoId && state.photo.preview_hash === currentHash() && !expired() && !state.pending && !state.needsCheck && !state.writerPending) state.error += ' Your previously confirmed panel photo is still attached.';
        } finally {
          if (!destroyed && run === generation && !state.pending) { state.busy = false; render(); }
        }
      }
      async function removePhoto(targetId, origin) {
        if (state.busy || state.locked || state.extensionBusy || state.pending && state.pending.limitRecovery && state.pending.cleanup) return;
        if (targetId && typeof targetId !== 'string') targetId = null;
        var pendingTarget = state.pending && state.pending.kind === 'upload' && (!targetId || targetId === state.pending.request_key);
        if (state.pending && !pendingTarget && state.pending.kind !== 'remove') return;
        if (origin || document.activeElement === remove) { ownActionFocus(origin || remove); removeFocusIndex = state.photos.findIndex(function (photo) { return photo.id === targetId; }); }
        if (pendingTarget && state.pending.awaitingChoice) { state.pending = null; if (!state.photo) { state.image = ''; state.imageEvidence = null; } state.error = ''; state.message = state.photo ? 'The selected photo was discarded. Your saved photos are still attached.' : ''; render(); return; }
        if (!state.photos.length && !state.pending) { state.image = ''; state.imageEvidence = null; render(); return; }
        if (state.pending && state.pending.kind === 'remove') return sendPending();
        var attempt = pendingTarget ? state.pending : null, photoId = attempt ? attempt.request_key : targetId || (state.photo || state.photos[0]).id;
        state.busy = true; state.error = ''; state.message = 'Checking your photo before removing it...'; render();
        var run = ++generation, requestStarted = Date.now();
        try {
          var result = await WALK.initialPhoto('status', { stage_token: state.token, request_key: photoId });
          if (destroyed || run !== generation) return;
          setReceipt(result, true, requestStarted); state.needsCheck = false;
          state.pending = { kind: 'remove', request_key: crypto.randomUUID(), expected_revision: state.revision, photo_id: photoId, cancelUpload: Boolean(attempt) };
          state.busy = false;
          await sendPending();
        } catch (value) {
          if (destroyed || run !== generation) return;
          state.error = 'Your photo could not be checked for removal. Try removing it again.'; state.message = '';
          state.needsCheck = true;
          if (/expired|stage_expired|initial_photo_session_unavailable/.test(String(value && (value.code || value.message) || ''))) { clearExpired(); state.error = 'Your saved photo is no longer available. Attach a photo again before continuing.'; }
        } finally { if (!destroyed && run === generation) { state.busy = false; render(); } }
      }
      async function reconcileRemoval() {
        var pending = state.pending;
        state.busy = true; state.error = ''; state.message = 'Checking your photo before retrying removal...'; render();
        var run = ++generation, requestStarted = Date.now();
        try {
          var result = await WALK.initialPhoto('status', { stage_token: state.token, request_key: pending.photo_id });
          if (destroyed || run !== generation) return;
          setReceipt(result, true, requestStarted);
          var checked = await readPhoto();
          if (destroyed || run !== generation) return;
          setReceipt(checked.result, true, checked.started, true); state.needsCheck = state.writerPending;
          if (removedAttempt(result, pending.photo_id)) {
            if (pending.photo_id === state.rejectedPhotoId) state.rejectedPhotoId = '';
            state.pending = null; state.message = ''; if (!state.photo) { state.image = ''; state.imageEvidence = null; state.extensionPending = null; state.holdingExpiry = false; state.timeCheckHeld = false; state.timeMessage = ''; state.timeOpen = false; expireTimer(); } state.busy = false; render();
          } else if (state.writerPending && checked.result.upload_attempt.id !== pending.photo_id) {
            state.message = 'Another photo is still saving in this session. Check again before removing this photo.';
          } else {
            state.pending = { kind: 'remove', request_key: crypto.randomUUID(), expected_revision: state.revision, photo_id: pending.photo_id, cancelUpload: pending.cancelUpload };
            state.busy = false; await sendPending();
          }
        } catch (value) {
          if (destroyed || run !== generation) return;
          state.error = 'Your photo could not be checked for removal. Retry removing it before continuing.'; state.message = '';
          if (/expired|stage_expired|initial_photo_session_unavailable/.test(String(value && (value.code || value.message) || ''))) { clearExpired(); state.error = 'Your saved photo is no longer available. Attach a photo again before continuing.'; }
        } finally { if (!destroyed && run === generation) { state.busy = false; render(); } }
      }
      async function refresh() {
        if (destroyed || state.busy || state.locked || state.extensionBusy || !state.token) { render(); return; }
        if (state.pending && state.pending.kind === 'upload' && state.pending.reconcile && !state.pending.limitRecovery) return reconcileUpload();
        if (state.extensionPending) return checkExtension();
        if (expired() && state.photo) return checkExtension();
        if (expired()) { clearExpired(); state.error = 'Your photo expired. Attach a photo again before continuing.'; render(); return; }
        state.busy = true; state.needsCheck = true; state.message = 'Checking your saved photo...'; state.error = ''; render();
        var run = ++generation, requestStarted = Date.now();
        try {
          var key = state.pending ? state.pending.kind === 'upload' ? state.pending.request_key : state.pending.photo_id : undefined;
          var result = await WALK.initialPhoto('status', { stage_token: state.token, request_key: key });
          if (destroyed || run !== generation) return;
          setReceipt(result, true, requestStarted, !key);
          if (key) {
            var checked = await readPhoto();
            if (destroyed || run !== generation) return;
            setReceipt(checked.result, true, checked.started, true);
          }
          state.needsCheck = state.writerPending;
          if (state.pending && state.pending.kind === 'upload' && state.writerPending && checked.result.upload_attempt.id === state.pending.request_key) state.needsCheck = false;
          if (state.pending && state.pending.kind === 'upload' && !state.writerPending && hasPhoto(state.pending.request_key)) state.pending = null;
          if (state.pending && state.pending.kind === 'upload' && removedAttempt(result, state.pending.request_key)) {
            state.pending.reconcile = true;
            state.error = state.pending.image ? 'That save can no longer finish. Your selected photo is still here. Check the current photo before saving it again.' : 'That save can no longer finish. Selected photo bytes are not kept after reload. Check the current photo, then choose your photo again.';
          }
          if (state.pending && state.pending.kind === 'remove' && removedAttempt(result, state.pending.photo_id)) { if (state.pending.photo_id === state.rejectedPhotoId) state.rejectedPhotoId = ''; state.pending = null; }
          if (!state.pending) { state.message = state.writerPending ? 'Another photo is still saving in this session. Check the saved photo again before continuing.' : ''; if (!state.photo) { state.image = ''; state.imageEvidence = null; state.extensionPending = null; state.holdingExpiry = false; state.timeCheckHeld = false; state.timeMessage = ''; state.timeOpen = false; expireTimer(); } }
          else state.message = state.pending.awaitingChoice ? state.pending.image ? 'Your selected photo is still here. Save it before continuing.' : 'Choose your photo again. Selected photo bytes are not kept after reload.' : state.pending.limitRecovery ? state.photos.length ? 'This photo session reached its save limit. Check your saved photos before continuing.' : 'This empty photo session reached its save limit. Start a new photo session to continue.' : state.pending.reconcile ? 'The photo changed. Check it before retrying the selected save.' : 'The latest save is still unconfirmed. Retry it or remove the photo before continuing.';
        } catch (value) {
          if (destroyed || run !== generation) return;
          state.error = 'Your saved photo could not be checked. Try again before continuing.'; state.message = '';
          if (/expired|stage_expired|initial_photo_session_unavailable/.test(String(value && (value.code || value.message) || ''))) { clearExpired(); state.error = 'Your saved photo is no longer available. Attach a photo again before continuing.'; }
        } finally { if (!destroyed && run === generation) { state.busy = false; render(); } }
      }
      async function checkExtension(automatic) {
        if (destroyed || state.busy || state.locked || state.extensionBusy || !state.token) return;
        var pending = state.extensionPending, wasFocused = document.activeElement === extend;
        if (automatic === true && !pending && !state.timeOpen && !state.timeCheckHeld && !state.holdingExpiry) automaticTimeCheck = true;
        else if (!state.timeCheckHeld || pending) automaticTimeCheck = false;
        var quiet = automaticTimeCheck && !pending && !state.timeOpen && !state.timeCheckHeld && !state.holdingExpiry && !expired() && remainingTime() > WARNING_MS;
        // extensionBusy still guards submission during a healthy background
        // check. Only a warning or uncertain result needs the floating panel.
        if (!quiet) state.timeCheckHeld = true;
        if (expired() && state.photo) { state.holdingExpiry = true; state.timeCheckHeld = true; }
        state.extensionBusy = true; if (!quiet) state.timeOpen = true; state.timeMessage = 'Checking your saved photo time...'; render();
        var run = ++generation, requestStarted = Date.now();
        try {
          var result = await WALK.initialPhoto('status', { stage_token: state.token, request_key: pending ? pending.request_key : undefined });
          if (destroyed || run !== generation) return;
          setReceipt(result, true, requestStarted, !pending);
          if (pending) {
            var checked = await readPhoto();
            if (destroyed || run !== generation) return;
            setReceipt(checked.result, true, checked.started, true);
          }
          state.needsCheck = state.writerPending;
          if (pending && (result.extension_request_key === pending.request_key || pending.needsSync || result.stage_time_revision > pending.expected_time_revision)) state.extensionPending = null;
          if (!state.photo) { state.extensionPending = null; state.holdingExpiry = false; state.timeCheckHeld = false; state.image = ''; state.imageEvidence = null; }
          if (!expired()) { state.holdingExpiry = false; state.timeCheckHeld = state.writerPending; }
          state.timeMessage = state.writerPending ? 'Another photo is still saving in this session. Check photo time again before continuing.' : state.extensionPending ? 'More photo time is still unconfirmed. Retry extending photo time before submitting your details.' : 'Photo time confirmed. Your saved photo and entered details stay here.';
          if (!state.extensionPending && remainingTime() <= WARNING_MS) state.timeMessage = '';
          if (automaticTimeCheck && !state.timeCheckHeld && !state.extensionPending && !state.writerPending && !expired()) {
            state.timeOpen = false; state.timeMessage = ''; automaticTimeCheck = false;
          }
          expireTimer();
        } catch (value) {
          if (destroyed || run !== generation) return;
          state.timeCheckHeld = true; state.timeOpen = true;
          state.timeMessage = 'We could not check photo time. Try again before submitting your details.';
          if (/expired|stage_expired|initial_photo_session_unavailable/.test(String(value && (value.code || value.message) || ''))) { clearExpired(); state.error = 'Your photo expired or is no longer available. Attach a photo again before continuing.'; }
        } finally { if (!destroyed && run === generation) { state.extensionBusy = false; render(); restoreExtensionFocus(wasFocused); } }
      }
      async function extendTime() {
        if (destroyed || state.busy || state.locked || state.extensionBusy || state.pending || !state.photo || state.photo.id === state.rejectedPhotoId) return;
        if (state.timeCheckHeld || timeHeld() || state.extensionPending && state.extensionPending.needsSync) return checkExtension();
        if (state.needsCheck) return;
        if (expired()) { expireTimer(); return; }
        if (!state.extensionPending && state.extensionCount >= MAX_EXTENSIONS) return;
        if (!state.extensionPending) state.extensionPending = { request_key: crypto.randomUUID(), expected_time_revision: state.timeRevision, expected_count: state.extensionCount,
          photo_id: state.photo.id, photo_revision: state.revision, preview_hash: state.photo.preview_hash, previous_expires: state.expires, needsSync: false };
        var pending = state.extensionPending, wasFocused = document.activeElement === extend;
        automaticTimeCheck = false;
        state.extensionBusy = true; state.timeOpen = true; state.timeMessage = 'Adding 15 minutes to your photo time...'; render();
        var run = ++generation, requestStarted = Date.now();
        try {
          var result = await WALK.initialPhoto('extend', { stage_token: state.token, request_key: pending.request_key, expected_time_revision: pending.expected_time_revision });
          if (destroyed || run !== generation) return;
          if (!result || result.extension_request_key !== pending.request_key || !result.initial_photo || result.initial_photo.id !== pending.photo_id || result.initial_photo.preview_hash !== pending.preview_hash || result.stage_revision !== pending.photo_revision
            || !Number.isSafeInteger(result.stage_time_revision) || result.stage_time_revision <= pending.expected_time_revision || !Number.isSafeInteger(result.extension_count) || result.extension_count <= pending.expected_count
            || Date.parse(result.stage_expires_at) <= Date.parse(pending.previous_expires)) throw new Error('unconfirmed_photo_time');
          setReceipt(result, false, requestStarted);
          state.extensionPending = null; state.holdingExpiry = false; state.timeCheckHeld = false;
          state.timeMessage = 'Photo time extended by 15 minutes. Your saved photo, estimate and entered details stay here. ' + (MAX_EXTENSIONS - state.extensionCount) + ' extensions remain.';
          expireTimer();
        } catch (value) {
          if (destroyed || run !== generation) return;
          var code = String(value && (value.code || value.message) || '');
          state.timeMessage = 'We could not confirm whether photo time was extended. Retry extending photo time before submitting your details.';
          if (/stale_initial_photo_time_revision|initial_photo_extension_limit|initial_photo_extension_unavailable|initial_photo_operation_conflict|unconfirmed_photo_time/.test(code)) { pending.needsSync = true; state.timeMessage = 'Photo time needs a fresh check. Choose Check photo time before continuing.'; }
          if (/expired|stage_expired|initial_photo_session_unavailable/.test(code)) { clearExpired(); state.error = 'Your photo expired or is no longer available. Attach a photo again before continuing.'; }
        } finally { if (!destroyed && run === generation) { state.extensionBusy = false; render(); restoreExtensionFocus(wasFocused); if (timeHeld() && state.extensionPending && !state.locked) checkExtension(); } }
      }
      function syncVisibleTime() {
        if (document.visibilityState === 'hidden') pausePreviews();
        if (destroyed || document.visibilityState === 'hidden' || state.locked || state.busy || state.extensionBusy || !state.token || !state.photo) return;
        checkExtension(true);
      }
      choose.addEventListener('click', function () { if (!choose.disabled) { pickerGenerations.set(chooseInput, generation); chooseInput.click(); } });
      retry.addEventListener('click', sendPending);
      remove.addEventListener('click', removePhoto);
      extend.addEventListener('click', function () { if (!extend.disabled) extendTime(); });
      document.addEventListener('visibilitychange', syncVisibleTime);
      window.addEventListener('pageshow', syncVisibleTime);
      document.addEventListener('focusin', updateWarningViewport);
      window.addEventListener('resize', updateWarningViewport);
      window.addEventListener('scroll', trackWarningScroll, { passive: true });
      if (window.visualViewport) { window.visualViewport.addEventListener('resize', updateWarningViewport); window.visualViewport.addEventListener('scroll', trackWarningScroll, { passive: true }); }
      try {
        var saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
        if (saved && HASH.test(saved.stageToken || '') && Number.isSafeInteger(saved.revision) && saved.revision >= 0 && (!saved.photo || storedPhoto(saved.photo))) {
          var cachedPhotos = saved.photos === undefined ? saved.photo ? [saved.photo] : [] : saved.photos;
          if (!Array.isArray(cachedPhotos) || cachedPhotos.length > MAX_PHOTOS || cachedPhotos.some(function (photo) { return !storedPhoto(photo); }) || new Set(cachedPhotos.map(function (photo) { return photo.id; })).size !== cachedPhotos.length) throw new Error('invalid_cached_photo_set');
          state.photos = cachedPhotos.map(function (photo) { return { id: photo.id, sha256: photo.sha256, content_type: photo.content_type, byte_size: photo.byte_size, preview_hash: photo.preview_hash }; });
          state.token = saved.stageToken; state.revision = saved.revision; state.photo = state.photos.find(function (photo) { return !isVideo(photo); }) || null; state.expires = saved.expires || ''; state.needsCheck = true;
          if (Number.isSafeInteger(saved.attemptsRemaining) && saved.attemptsRemaining >= 0 && saved.attemptsRemaining <= 12) state.attemptsRemaining = saved.attemptsRemaining;
          if (Array.isArray(saved.rejectedPhotoIds)) state.rejectedPhotoIds = saved.rejectedPhotoIds.filter(function (id) { return UUID.test(id || '') && hasPhoto(id); });
          if (UUID.test(saved.rejectedPhotoId || '')) state.rejectedPhotoId = saved.rejectedPhotoId;
          if (Number.isSafeInteger(saved.timeRevision) && saved.timeRevision >= 0 && Number.isSafeInteger(saved.extensionCount) && saved.extensionCount >= 0 && saved.extensionCount <= MAX_EXTENSIONS) { state.timeRevision = saved.timeRevision; state.extensionCount = saved.extensionCount; }
          if (Number.isFinite(saved.clockOffset)) state.clockOffset = saved.clockOffset;
          if (saved.extensionPending && UUID.test(saved.extensionPending.request_key || '') && UUID.test(saved.extensionPending.photo_id || '') && Number.isSafeInteger(saved.extensionPending.expected_time_revision) && saved.extensionPending.expected_time_revision >= 0
            && Number.isSafeInteger(saved.extensionPending.expected_count) && saved.extensionPending.expected_count >= 0 && saved.extensionPending.expected_count < MAX_EXTENSIONS && Number.isSafeInteger(saved.extensionPending.photo_revision) && HASH.test(saved.extensionPending.preview_hash || '') && Number.isFinite(Date.parse(saved.extensionPending.previous_expires))) {
            state.extensionPending = { request_key: saved.extensionPending.request_key, expected_time_revision: saved.extensionPending.expected_time_revision, expected_count: saved.extensionPending.expected_count, photo_id: saved.extensionPending.photo_id,
              photo_revision: saved.extensionPending.photo_revision, preview_hash: saved.extensionPending.preview_hash, previous_expires: saved.extensionPending.previous_expires, needsSync: saved.extensionPending.needsSync === true };
            state.holdingExpiry = expired();
          }
          if (saved.pending && ['upload', 'remove'].indexOf(saved.pending.kind) !== -1 && (saved.pending.kind !== 'remove' || UUID.test(saved.pending.photo_id || '')) && UUID.test(saved.pending.request_key || '') && Number.isSafeInteger(saved.pending.expected_revision) && saved.pending.expected_revision >= 0) {
            state.pending = { kind: saved.pending.kind, request_key: saved.pending.request_key, expected_revision: saved.pending.expected_revision,
              photo_id: UUID.test(saved.pending.photo_id || '') ? saved.pending.photo_id : null, preview_hash: HASH.test(saved.pending.preview_hash || '') ? saved.pending.preview_hash : '',
              evidence: saved.pending.kind === 'upload' ? uploadEvidence(saved.pending, saved.consent === true) : null,
              cancelUpload: saved.pending.cancelUpload === true, reconcile: saved.pending.reconcile === true, awaitingChoice: saved.pending.kind === 'upload' && saved.pending.awaitingChoice === true, limitRecovery: saved.pending.kind === 'upload' && saved.pending.limitRecovery === true };
            if (state.pending.limitRecovery && saved.pending.cleanup && UUID.test(saved.pending.cleanup.request_key || '') && UUID.test(saved.pending.cleanup.photo_id || '') && Number.isSafeInteger(saved.pending.cleanup.expected_revision) && saved.pending.cleanup.expected_revision >= 0)
              state.pending.cleanup = { request_key: saved.pending.cleanup.request_key, photo_id: saved.pending.cleanup.photo_id, expected_revision: saved.pending.cleanup.expected_revision, reconcile: saved.pending.cleanup.reconcile === true };
          }
        }
      } catch (_) { /* A denied or malformed session store starts a fresh upload. */ }
      render();
      if (state.token) refresh();
      return { ready: ready, submissionReady: submissionReady, receipt: receipt, refresh: refresh, pausePreviews: pausePreviews,
        discardLocal: function () {
          if (destroyed) return;
          ++generation;
          if (state.pending) delete state.pending.image;
          state.busy = false; state.locked = false; clearExpired(); state.message = ''; state.error = '';
          restoreActionFocus = false; actionFocusOrigin = null; feedbackOrigin = null;
          lastNotice = '';
          chooseInput.value = ''; render();
        },
        invalidate: function () { if (!state.busy) state.message = ''; render(); },
        rejectReceipt: function (message) { if (state.photo) { state.rejectedPhotoId = state.photo.id; state.rejectedPhotoIds = state.photos.map(function (photo) { return photo.id; }); } state.needsCheck = false; state.message = ''; state.error = message || 'Your photo could not be verified. Choose a replacement or remove it and try again.'; render(); },
        lock: function (value) { state.locked = value === true; render(); },
        consume: function () { ++generation; state.busy = false; clearExpired(); state.message = ''; state.error = ''; render(); },
        destroy: function () { destroyed = true; ++generation; previewVisibility.disconnect(); clearTimeout(expiryTimer); clearTimeout(warningTimer); cancelAnimationFrame(warningFrame); document.removeEventListener('visibilitychange', syncVisibleTime); window.removeEventListener('pageshow', syncVisibleTime);
          document.removeEventListener('focusin', updateWarningViewport); window.removeEventListener('resize', updateWarningViewport); window.removeEventListener('scroll', trackWarningScroll); if (window.visualViewport) { window.visualViewport.removeEventListener('resize', updateWarningViewport); window.visualViewport.removeEventListener('scroll', trackWarningScroll); }
          document.documentElement.classList.remove('bpp-photo-time-visible'); document.documentElement.style.removeProperty('--bpp-photo-time-reserved'); state.image = ''; state.imageEvidence = null; if (state.pending) delete state.pending.image; state.images.clear(); previewLoads.clear(); previewNodes.forEach(releasePreview); if (options.timeWarningRoot) timeWarning.remove(); }
      };
    }
  };
})();
