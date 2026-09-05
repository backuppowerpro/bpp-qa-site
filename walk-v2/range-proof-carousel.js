(function () {
  "use strict";

  function init(carousel) {
    if (!carousel || carousel.dataset.carouselReady === "true") return;
    var track = carousel.querySelector("[data-proof-track]");
    if (!track) return;
    var previousButton = carousel.querySelector("[data-proof-prev]");
    var nextButton = carousel.querySelector("[data-proof-next]");
    var originals = Array.prototype.slice.call(track.querySelectorAll("[data-proof-slide]"));
    if (originals.length < 2) return;
    carousel.dataset.carouselReady = "true";

    originals.slice().reverse().forEach(function (slide) {
      var clone = slide.cloneNode(true);
      clone.removeAttribute("data-proof-slide");
      clone.setAttribute("aria-hidden", "true");
      clone.setAttribute("data-proof-clone", "before");
      track.insertBefore(clone, track.firstChild);
    });
    originals.forEach(function (slide) {
      var clone = slide.cloneNode(true);
      clone.removeAttribute("data-proof-slide");
      clone.setAttribute("aria-hidden", "true");
      clone.setAttribute("data-proof-clone", "after");
      track.appendChild(clone);
    });

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var dragging = false;
    var startX = 0;
    var startScroll = 0;

    function slides() { return Array.prototype.slice.call(track.querySelectorAll(".proof-slide")); }
    function centeredIndex() {
      var center = track.scrollLeft + track.clientWidth / 2;
      var list = slides();
      var best = 0;
      var distance = Infinity;
      list.forEach(function (slide, index) {
        var delta = Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - center);
        if (delta < distance) { distance = delta; best = index; }
      });
      return best;
    }
    function centerSlide(slide, behavior) {
      if (!slide) return;
      track.scrollTo({
        left: slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2,
        behavior: behavior || "smooth"
      });
    }
    function settle() {
      var list = slides();
      var index = centeredIndex();
      var count = originals.length;
      if (index < count) centerSlide(list[index + count], "auto");
      if (index >= count * 2) centerSlide(list[index - count], "auto");
    }
    function advance(direction) {
      var list = slides();
      var index = centeredIndex() + direction;
      centerSlide(list[Math.max(0, Math.min(list.length - 1, index))], reduceMotion ? "auto" : "smooth");
      window.setTimeout(settle, reduceMotion ? 0 : 500);
    }
    track.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      advance(event.key === "ArrowRight" ? 1 : -1);
    });
    if (previousButton) previousButton.addEventListener("click", function () { advance(-1); });
    if (nextButton) nextButton.addEventListener("click", function () { advance(1); });
    track.addEventListener("pointerdown", function (event) {
      dragging = true;
      startX = event.clientX;
      startScroll = track.scrollLeft;
      track.classList.add("is-dragging");
      track.setPointerCapture(event.pointerId);
    });
    track.addEventListener("pointermove", function (event) {
      if (dragging) track.scrollLeft = startScroll - (event.clientX - startX);
    });
    function endDrag(event) {
      if (!dragging) return;
      dragging = false;
      track.classList.remove("is-dragging");
      if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
      centerSlide(slides()[centeredIndex()], reduceMotion ? "auto" : "smooth");
      window.setTimeout(settle, reduceMotion ? 0 : 500);
    }
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        centerSlide(originals[0], "auto");
        track.setAttribute("data-autoplay-paused", "true");
      });
    });
  }

  window.BPPRangeProofCarousel = { init: init };
})();
