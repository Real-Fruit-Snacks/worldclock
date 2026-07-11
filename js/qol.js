/* Quality-of-life extras: scrubber UI, shortcuts, sharing, nicknames,
   copy, kiosk, ambient title/favicon. Pure helpers first (tests load
   this file without the page DOM). */
(function () {
  "use strict";
  window.WC = window.WC || {};
  WC.qol = {};

  function validZone(z) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; }
    catch (e) { return false; }
  }

  WC.sortZonesByTime = function (zones, date) {
    return zones.slice().sort(function (a, b) {
      return (WC.time.offsetMinutes(date, a) - WC.time.offsetMinutes(date, b)) ||
        WC.cityName(a).localeCompare(WC.cityName(b));
    });
  };

  WC.share = {
    encode: function (zones, home) {
      var h = "#z=" + zones.map(encodeURIComponent).join(",");
      if (home) h += "&h=" + encodeURIComponent(home);
      return h;
    },
    decode: function (hash) {
      if (!hash) return null;
      var m = /[#&]z=([^&]*)/.exec(hash);
      if (!m) return null;
      function dec(s) { try { return decodeURIComponent(s); } catch (e) { return null; } }
      var zones = m[1].split(",").map(dec).filter(function (z) {
        return z && validZone(z);
      });
      var hm = /[#&]h=([^&]*)/.exec(hash);
      var home = hm ? dec(hm[1]) : null;
      if (home && !validZone(home)) home = null;
      return { zones: zones, home: home };
    }
  };

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

  /* ---------- help overlay ---------- */
  var help = document.createElement("div");
  help.id = "help-modal";
  help.innerHTML =
    '<div class="modal-box panel"><div class="panel-header">' +
    '<span class="manifest-label">KEYBOARD</span>' +
    '<button class="icon-btn" id="help-close" aria-label="Close help">&times;</button></div>' +
    '<div class="help-body mono">' +
    helpRow("/", "search timezones") +
    helpRow("s", "settings") +
    helpRow("t", "toggle theme") +
    helpRow("f", "kiosk mode") +
    helpRow("← →", "scrub time ±1h (shift: 15m)") +
    helpRow("n", "back to now") +
    helpRow("?", "this help") +
    helpRow("esc", "close / exit") +
    "</div></div>";
  document.body.appendChild(help);
  function helpRow(key, what) {
    return '<div class="help-row"><kbd>' + key + "</kbd><span>" + what + "</span></div>";
  }
  function toggleHelp(force) {
    help.classList.toggle("open", force);
  }
  document.getElementById("help-close").addEventListener("click", function () { toggleHelp(false); });
  help.addEventListener("click", function (e) { if (e.target === help) toggleHelp(false); });

  /* ---------- kiosk mode ---------- */
  var kioskHintAt = 0;
  function toggleKiosk(force) {
    var on = force !== undefined ? force :
      document.documentElement.getAttribute("data-kiosk") !== "on";
    if (on) {
      document.documentElement.setAttribute("data-kiosk", "on");
      var now = Date.now();
      if (now - kioskHintAt > 5000) {
        kioskHintAt = now;
        var hint = document.createElement("div");
        hint.className = "kiosk-hint mono";
        hint.textContent = "F OR ESC TO EXIT";
        document.body.appendChild(hint);
        setTimeout(function () { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 2600);
      }
    } else {
      document.documentElement.removeAttribute("data-kiosk");
    }
  }

  /* ---------- global shortcuts ---------- */
  function typing(e) {
    var t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") { toggleHelp(false); toggleKiosk(false); return; }
    if (typing(e)) return;
    switch (e.key) {
      case "/": e.preventDefault(); document.getElementById("btn-add").click(); break;
      case "s": document.getElementById("btn-settings").click(); break;
      case "t": document.getElementById("btn-theme").click(); break;
      case "f": toggleKiosk(); break;
      case "n": WC.qol.resetScrub(); break;
      case "?": toggleHelp(); break;
      case "ArrowLeft": e.preventDefault(); WC.qol.scrubBy(e.shiftKey ? -15 : -60); break;
      case "ArrowRight": e.preventDefault(); WC.qol.scrubBy(e.shiftKey ? 15 : 60); break;
    }
  });

  /* ---------- sort by time ---------- */
  document.getElementById("btn-sort").addEventListener("click", function () {
    var zones = WC.prefs.getZones() || WC.DEFAULT_ZONES.slice();
    WC.prefs.setZones(WC.sortZonesByTime(zones, WC.now()));
  });

  /* ---------- clipboard helper (also used by card copy) ---------- */
  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) { /* best effort */ }
      document.body.removeChild(ta); done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  /* ---------- shareable URL ---------- */
  function currentShareHash() {
    var st = WC.clocks.state();
    return WC.share.encode(st.zones, st.home);
  }
  function syncHash() {
    try { history.replaceState(null, "", location.pathname + location.search + currentShareHash()); }
    catch (e) { /* file:// may refuse */ }
  }
  var imported = WC.share.decode(location.hash);
  if (imported && imported.zones.length) {
    if (imported.home) WC.prefs.set("wc-home", imported.home);
    WC.prefs.setZones(imported.zones);   /* fires wc:zones -> re-render */
  }
  window.addEventListener("wc:zones", syncHash);
  syncHash();

  /* copy-link row in the settings panel */
  var shareRow = document.createElement("div");
  shareRow.className = "setting-row";
  shareRow.innerHTML = '<span class="manifest-label">SHARE</span>' +
    '<button id="copy-link" class="text-btn mono">COPY LINK</button>';
  var settingsBody = document.querySelector("#settings-panel .settings-body");
  settingsBody.insertBefore(shareRow, document.getElementById("pet-settings"));
  document.getElementById("copy-link").addEventListener("click", function () {
    var btn = this;
    copyText(location.origin === "null" ? currentShareHash() : location.href.split("#")[0] + currentShareHash(), function () {
      btn.textContent = "COPIED";
      setTimeout(function () { btn.textContent = "COPY LINK"; }, 1500);
    });
  });
})();
