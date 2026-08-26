(function () {
  "use strict";

  window.__BPP_UNIFIED_PHOTOS__ = true;
  var t = WALK.requireToken();
  if (!t) return;

  var MAX_ITEMS = 10;
  var MAX_BYTES = 15 * 1024 * 1024;
  var main = document.getElementById("mainPage");
  main.querySelectorAll(".rv").forEach(function (element) {
    element.classList.add("in");
  });
  var slots = main.querySelector("[data-slots]");
  var cta = main.querySelector("[data-cta]");
  var ctaInner = main.querySelector("[data-cta-inner]");
  var hint = main.querySelector("[data-hint]");
  var later = main.querySelector("[data-photo-later]");
  var preview = main.querySelector("[data-photo-preview]");
  var previewImage = main.querySelector("[data-preview-image]");
  var previewVideo = main.querySelector("[data-preview-video]");
  var previewClose = main.querySelector("[data-preview-close]");
  var previewReplace = main.querySelector("[data-preview-replace]");
  var photos = [];
  var nextIndex = 1;
  var sending = false;
  var previewPhoto = null;
  var uploadQueue = Promise.resolve();
  var statusMessage = "";
  var pendingUploads = [];
  var reconciliationController = null;
  var reconciliationPromise = null;
  var reconciliationRunId = 0;

  var file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*,video/*";
  file.multiple = true;
  file.hidden = true;
  document.body.appendChild(file);

  var replacementFile = document.createElement("input");
  replacementFile.type = "file";
  replacementFile.accept = "image/*,video/*";
  replacementFile.hidden = true;
  document.body.appendChild(replacementFile);

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  function isVideoItem(item) {
    return Boolean(item && (item.kind === "video" || (item.mimeType || "").indexOf("video/") === 0));
  }

  function hasBusyUpload() {
    return pendingUploads.length > 0 || photos.some(function (photo) {
      return photo.status === "uploading" || photo.replacementPending === true;
    });
  }

  function hasSavedMedia() {
    return photos.some(function (photo) { return photo.status === "done"; });
  }

  function guidanceHint() {
    if (!photos.length) {
      return "Add at least one photo or short video to continue. You can add up to 10.";
    }
    if (photos.length >= MAX_ITEMS) {
      return "That's 10. Remove one to add another, or continue.";
    }
    if (hasSavedMedia()) {
      return "Saved. Add more if they help, or continue.";
    }
    return "Finish saving at least one photo or short video to continue.";
  }

  function render() {
    var html = "";
    photos.forEach(function (photo) {
      var video = isVideoItem(photo);
      html += '<article class="slot unified-photo ' + escapeHtml(photo.status) + (video ? " is-video" : "") + '" data-local-id="' + escapeHtml(photo.localId) + '">' +
        '<button class="thumb" type="button" data-preview="' + escapeHtml(photo.localId) + '" aria-label="' + (video ? "Preview uploaded video" : "Preview uploaded photo") + '">' +
          (photo.dataUrl
            ? (video
              ? '<video src="' + escapeHtml(photo.dataUrl) + '" muted playsinline preload="metadata"></video>'
              : '<img src="' + escapeHtml(photo.dataUrl) + '" alt="" />')
            : (video ? '<span class="video-mark" aria-hidden="true"></span>' : "")) +
          (video ? '<span class="video-badge">Video</span>' : "") +
          (photo.status === "uploading" ? '<span class="tag">Saving</span>' : "") +
          (photo.replacementPending === true ? '<span class="tag">Saving replacement</span>' : "") +
          (photo.status === "failed" ? '<span class="tag">Upload failed</span>' : "") +
        '</button>' +
        '<button class="remove" type="button" data-remove="' + escapeHtml(photo.localId) + '" aria-label="Remove uploaded item"' + (photo.status === "uploading" || photo.replacementPending ? ' disabled' : '') + '></button>' +
        (photo.status === "failed" ? '<button class="retry" type="button" data-retry="' + escapeHtml(photo.localId) + '">Retry upload</button>' : '') +
      '</article>';
    });
    if (photos.length < MAX_ITEMS && !pendingUploads.length) {
      html += '<button class="add-photo-tile" type="button" data-add-more aria-label="Add photo or video">' +
        '<span aria-hidden="true">+</span><span>Add</span></button>';
    }
    slots.className = "slots unified-photo-list";
    slots.innerHTML = html;
    cta.disabled = hasBusyUpload() || !hasSavedMedia();
    later.hidden = hasSavedMedia();
    later.disabled = hasBusyUpload();
    ctaInner.textContent = hasSavedMedia() ? "Continue" : "Add a photo or video to continue";
    hint.textContent = statusMessage || guidanceHint();
  }

  function revokePreview(photo) {
    if (photo && photo.objectUrl) {
      URL.revokeObjectURL(photo.objectUrl);
      photo.objectUrl = "";
    }
  }

  function removeServerPhoto(photo) {
    if (!photo.mediaId) return Promise.resolve();
    return WALK.stateAction(t, "supersede_media", { media_id: photo.mediaId });
  }

  function send(photo) {
    photo.status = "uploading";
    statusMessage = "";
    render();
    var source = photo.file || photo.dataUrl;
    return WALK.photo(t, source, photo.idx, {
      role: "setup_photo",
      panel_id: null,
      synthetic_name: photo.name
    }).then(function (value) {
      photo.mediaId = value && value.media_receipt_id || null;
      photo.status = "done";
      WALK.ph("walk_v2_photo_uploaded", { kind: photo.kind });
      render();
    }).catch(function () {
      photo.status = "failed";
      WALK.ph("walk_v2_photo_upload_failed", { kind: photo.kind });
      render();
    });
  }

  function enqueue(photo) {
    uploadQueue = uploadQueue.then(function () {
      if (photo.cancelled) return null;
      return send(photo);
    }, function () {
      if (photo.cancelled) return null;
      return send(photo);
    });
    return uploadQueue;
  }

  function sendReplacement(photo, next, selected, kind) {
    photo.replacementPending = true;
    statusMessage = "";
    render();
    var source = next.file || next.dataUrl;
    var replacementAttemptId = "replace:" + crypto.randomUUID();
    return WALK.photo(t, source, nextIndex++, {
      role: "setup_photo",
      panel_id: null,
      replacement_media_id: photo.mediaId,
      replacement_attempt_id: replacementAttemptId,
      synthetic_name: selected.name || "replacement"
    }).then(function (value) {
      var previousObjectUrl = photo.objectUrl;
      photo.idx = nextIndex - 1;
      photo.name = selected.name || (kind === "video" ? "video" : "photo");
      photo.kind = kind;
      photo.mimeType = next.mimeType;
      photo.dataUrl = next.dataUrl;
      photo.objectUrl = kind === "video" ? next.dataUrl : "";
      photo.file = next.file;
      photo.mediaId = value && value.media_receipt_id || null;
      photo.status = "done";
      photo.replacementPending = false;
      statusMessage = "";
      if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
      WALK.ph("walk_v2_photo_replaced", { kind: kind });
      render();
    }).catch(function () {
      if (next.objectUrl) URL.revokeObjectURL(next.objectUrl);
      photo.replacementPending = false;
      photo.status = "done";
      statusMessage = "The replacement did not save. Your original item is still available.";
      WALK.ph("walk_v2_photo_replace_failed", { kind: kind });
      render();
    });
  }

  function kindForFile(selected) {
    var type = String(selected && selected.type || "");
    if (type.indexOf("video/") === 0) return "video";
    if (type.indexOf("image/") === 0) return "image";
    return "";
  }

  function addFile(selected) {
    if (!selected) return;
    if (photos.length >= MAX_ITEMS) {
      hint.textContent = "That's 10. Remove one to add another, or continue.";
      return;
    }
    var kind = kindForFile(selected);
    if (!kind) {
      hint.textContent = "Choose a photo or a short video.";
      return;
    }
    if (selected.size > MAX_BYTES) {
      hint.textContent = kind === "video"
        ? "That video is too large. Choose a shorter clip."
        : "That photo is too large. Choose a smaller image.";
      return;
    }
    if (kind === "video") {
      var objectUrl = URL.createObjectURL(selected);
      var video = {
        localId: "media-" + Date.now() + "-" + nextIndex,
        idx: nextIndex++,
        name: selected.name || "video",
        kind: "video",
        mimeType: selected.type || "video/mp4",
        dataUrl: objectUrl,
        objectUrl: objectUrl,
        file: selected,
        mediaId: null,
        cancelled: false,
        status: "uploading"
      };
      photos.push(video);
      enqueue(video);
      return;
    }
    WALK.resizeImage(selected, 1600).then(function (dataUrl) {
      if (photos.length >= MAX_ITEMS) return;
      var photo = {
        localId: "media-" + Date.now() + "-" + nextIndex,
        idx: nextIndex++,
        name: selected.name || "photo",
        kind: "image",
        mimeType: "image/jpeg",
        dataUrl: dataUrl,
        file: null,
        mediaId: null,
        cancelled: false,
        status: "uploading"
      };
      photos.push(photo);
      enqueue(photo);
    }).catch(function () {
      hint.textContent = "That photo would not open. Choose another image.";
    });
  }

  file.addEventListener("change", function () {
    var selected = Array.from(file.files || []);
    file.value = "";
    if (!selected.length) return;
    selected.forEach(function (item) { addFile(item); });
  });

  slots.addEventListener("click", function (event) {
    var retry = event.target.closest("[data-retry]");
    var remove = event.target.closest("[data-remove]");
    var previewButton = event.target.closest("[data-preview]");
    if (event.target.closest("[data-add-more]")) {
      file.multiple = true;
      file.click();
      return;
    }
    var id = (retry || remove || previewButton) && (retry || remove || previewButton).getAttribute(
      retry ? "data-retry" : remove ? "data-remove" : "data-preview"
    );
    var photo = photos.find(function (item) { return item.localId === id; });
    if (!photo) return;
    if (photo.status === "uploading" || photo.replacementPending) {
      statusMessage = photo.replacementPending
        ? "Wait for the replacement to finish saving."
        : "Wait for this item to finish saving before removing it.";
      render();
      return;
    }
    if (retry) {
      photo.cancelled = false;
      enqueue(photo);
      return;
    }
    if (previewButton) {
      previewPhoto = photo;
      previewReplace.disabled = photo.status === "uploading" || photo.replacementPending === true;
      if (isVideoItem(photo) && previewVideo) {
        previewImage.hidden = true;
        previewVideo.hidden = false;
        previewVideo.src = photo.dataUrl || "";
      } else {
        if (previewVideo) {
          previewVideo.removeAttribute("src");
          previewVideo.hidden = true;
        }
        previewImage.hidden = false;
        previewImage.src = photo.dataUrl;
      }
      preview.showModal();
      return;
    }
    photo.cancelled = true;
    removeServerPhoto(photo).then(function () {
      revokePreview(photo);
      photos = photos.filter(function (item) { return item !== photo; });
      render();
    }).catch(function () {
      hint.textContent = "That item could not be removed. Try again.";
    });
  });

  previewClose.addEventListener("click", function () {
    preview.close();
  });

  previewReplace.addEventListener("click", function () {
    if (!previewPhoto || previewPhoto.status === "uploading" || previewPhoto.replacementPending) return;
    replacementFile.click();
  });

  replacementFile.addEventListener("change", function () {
    var selected = replacementFile.files && replacementFile.files[0];
    replacementFile.value = "";
    var photo = previewPhoto;
    if (!selected || !photo) return;
    var kind = kindForFile(selected);
    if (!kind) {
      hint.textContent = "Choose a photo or a short video.";
      return;
    }
    if (selected.size > MAX_BYTES) {
      hint.textContent = kind === "video"
        ? "That video is too large. Choose a shorter clip."
        : "That photo is too large. Choose a smaller image.";
      return;
    }
    var prepare = kind === "video"
      ? (function () {
          var objectUrl = URL.createObjectURL(selected);
          return Promise.resolve({ dataUrl: objectUrl, objectUrl: objectUrl, file: selected, mimeType: selected.type || "video/mp4" });
        })()
      : WALK.resizeImage(selected, 1600).then(function (dataUrl) {
        return { dataUrl: dataUrl, objectUrl: "", file: null, mimeType: "image/jpeg" };
      });
    prepare.then(function (next) {
      preview.close();
      return sendReplacement(photo, next, selected, kind);
    }).catch(function () {
      hint.textContent = "That replacement could not be prepared. Your original item is still available.";
    });
  });

  preview.addEventListener("close", function () {
    previewImage.removeAttribute("src");
    if (previewVideo) {
      previewVideo.pause();
      previewVideo.removeAttribute("src");
      previewVideo.hidden = true;
    }
    previewImage.hidden = false;
    previewPhoto = null;
  });

  cta.addEventListener("click", function () {
    if (cta.disabled || sending) return;
    if (!hasSavedMedia()) {
      hint.textContent = "Add at least one photo or short video before continuing.";
      render();
      return;
    }
    sending = true;
    WALK.view(t).then(function (latest) {
      var state = latest.quote_walk_v2 || {};
      if (reconciliationController) reconciliationController.abort();
      if (Array.isArray(state.blockers) && state.blockers.length) WALK.go("incomplete.html", t);
      else WALK.go("range.html", t);
    }).catch(function () {
      sending = false;
      hint.textContent = "Your saved items could not be checked. Try again.";
    });
  });

  later.addEventListener("click", function () {
    if (sending || hasSavedMedia() || hasBusyUpload()) return;
    sending = true;
    WALK.confirm(t, { photos_pending: true }).then(function () {
      if (reconciliationController) reconciliationController.abort();
      WALK.go("incomplete.html", t);
    }).catch(function () {
      sending = false;
      hint.textContent = "Your progress did not save. Try again.";
    });
  });

  var back = main.querySelector("[data-back]");
  if (back) back.addEventListener("click", function () {
    if (reconciliationController) reconciliationController.abort();
    WALK.back("distance.html", t);
  });

  function hydrateFromView(value) {
    var state = value.quote_walk_v2 || {};
    pendingUploads = (Array.isArray(state.pending_media_uploads) ? state.pending_media_uploads : []).filter(function (upload) {
      return upload && upload.status === "uploading";
    });
    var activeReplacementIds = {};
    pendingUploads.forEach(function (upload) {
      if (upload.replacement_media_id) activeReplacementIds[String(upload.replacement_media_id)] = true;
    });
    var sequentialEntry = new URLSearchParams(window.location.search).get("sequence") === "1";
    var connectionAnswered = (Array.isArray(state.observed_connections) && state.observed_connections.length)
      || value.connection_status === "pending_access";
    if (!sequentialEntry && (!connectionAnswered || !value.confirmed_panel_room || !state.distance_band)) {
      WALK.routeFromState(t, value);
      return;
    }
    photos = (Array.isArray(state.media) ? state.media : []).slice(0, MAX_ITEMS).map(function (media, index) {
      var mimeType = String(media.mime_type || media.mimeType || "");
      var kind = mimeType.indexOf("video/") === 0 ? "video" : "image";
      return {
        localId: "saved-" + media.id,
        idx: index + 1,
        name: kind === "video" ? "Saved video" : "Saved photo",
        kind: kind,
        mimeType: mimeType,
        dataUrl: media.preview_href || "",
        file: null,
        mediaId: media.id,
        cancelled: false,
        status: "done",
        replacementPending: activeReplacementIds[String(media.id)] === true
      };
    });
    nextIndex = photos.length + 1;
    render();
  }

  function renderReconciliationStatus(status) {
    if (!status || !status.upload) return;
    var replacement = Boolean(status.upload.replacement_media_id);
    if (status.type === "waiting") {
      var seconds = Number(status.retry_in_seconds || 0);
      var waitCopy = seconds === 1 ? "1 second" : seconds + " seconds";
      statusMessage = replacement
        ? "Your original item is safe. Checking the replacement again in " + waitCopy + "."
        : "Checking your upload again in " + waitCopy + ".";
    } else if (status.type === "checking") {
      statusMessage = replacement
        ? "Your original item is safe. Checking the replacement now."
        : "Checking your upload now.";
    } else if (status.type === "retry_ready") {
      statusMessage = replacement
        ? "The replacement did not reach us. Your original item is still available. Try the replacement again."
        : "That upload did not reach us. Add it again.";
    } else if (status.type === "action_required") {
      statusMessage = replacement
        ? "The replacement could not be confirmed. Your original item is still available. Try again."
        : "That upload could not be confirmed. Add it again.";
    } else if (status.type === "finalized") {
      statusMessage = replacement ? "Replacement confirmed. Loading it now." : "Upload confirmed. Loading it now.";
    }
    render();
  }

  function stopReconciliation() {
    if (reconciliationController) reconciliationController.abort();
  }

  function startReconciliation() {
    if (
      reconciliationPromise
      && reconciliationController
      && !reconciliationController.signal.aborted
    ) return reconciliationPromise;
    var runId = ++reconciliationRunId;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    reconciliationController = controller;
    reconciliationPromise = WALK.view(t).then(function (value) {
      if (runId !== reconciliationRunId || (controller && controller.signal.aborted)) return null;
      hydrateFromView(value);
      return WALK.reconcilePendingUploads(t, value, {
        signal: controller && controller.signal,
        onStatus: function (status) {
          if (runId === reconciliationRunId && !(controller && controller.signal.aborted)) {
            renderReconciliationStatus(status);
          }
        }
      });
    }).then(function (reconciliation) {
      if (
        !reconciliation
        || runId !== reconciliationRunId
        || (controller && controller.signal.aborted)
      ) return;
      var value = reconciliation.state || {};
      var results = reconciliation.results || [];
      if (results.some(function (result) { return result.cancelled === true; })) return;
      hydrateFromView(value);
      if (results.length && results.every(function (result) { return result.terminal === "finalized"; })) {
        statusMessage = "";
        render();
      }
    }).catch(function () {
      if (runId !== reconciliationRunId || (controller && controller.signal.aborted)) return;
      statusMessage = hasSavedMedia()
        ? "Your saved items could not be checked. Try again."
        : "Your upload could not be checked. Add it again or try again.";
      render();
    }).finally(function () {
      if (runId === reconciliationRunId) reconciliationPromise = null;
    });
    return reconciliationPromise;
  }

  window.addEventListener("pagehide", stopReconciliation);
  window.addEventListener("beforeunload", stopReconciliation);
  window.addEventListener("pageshow", function (event) {
    if (
      event.persisted
      || !reconciliationController
      || reconciliationController.signal.aborted
    ) startReconciliation();
  });

  startReconciliation();
})();
