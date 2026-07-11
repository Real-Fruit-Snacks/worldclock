/* Quality-of-life extras: scrubber UI, shortcuts, sharing, nicknames,
   copy, kiosk, ambient title/favicon. Pure helpers first (tests load
   this file without the page DOM). */
(function () {
  "use strict";
  window.WC = window.WC || {};
  WC.qol = {};

  /* ---------- UI (only on index.html) ---------- */
  if (!document.getElementById("clock-grid")) return;

  /* ---------- time scrubber ---------- */
  var range = document.getElementById("scrub-range");
  var label = document.getElementById("scrub-label");
  var nowBtn = document.getElementById("scrub-now");

  function syncScrubUI() {
    var m = WC.scrub.minutes;
    range.value = m;
    label.textContent = WC.scrubLabel(m);
    nowBtn.hidden = m === 0;
  }
  WC.qol.scrubBy = function (delta) { WC.setScrub(WC.scrub.minutes + delta); };
  WC.qol.resetScrub = function () { WC.setScrub(0); };

  range.addEventListener("input", function () { WC.setScrub(parseInt(this.value, 10) || 0); });
  nowBtn.addEventListener("click", WC.qol.resetScrub);
  window.addEventListener("wc:scrub", function () {
    syncScrubUI();
    WC.clocks.tick();                 /* immediate refresh; map follows via onSecond */
  });
  syncScrubUI();
})();
