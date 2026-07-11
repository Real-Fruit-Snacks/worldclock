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

  WC.names = {
    all: function () {
      try { return JSON.parse(WC.prefs.get("wc-names", "{}")) || {}; }
      catch (e) { return {}; }
    },
    get: function (zone) {
      var n = WC.names.all()[zone];
      return n ? n : null;
    },
    set: function (zone, name) {
      var all = WC.names.all();
      name = String(name || "").trim().slice(0, 24);
      if (name) all[zone] = name; else delete all[zone];
      if (Object.keys(all).length) WC.prefs.set("wc-names", JSON.stringify(all));  /* fires wc:prefs -> re-render */
      else WC.prefs.remove("wc-names");
    },
    display: function (zone) {
      return WC.names.get(zone) || (zone === "UTC" ? "UTC" : WC.cityName(zone));
    }
  };

  WC.nearestZone = function (lat, lon) {
    var RAD = Math.PI / 180, best = null, bestD = Infinity;
    var sinLat = Math.sin(lat * RAD), cosLat = Math.cos(lat * RAD);
    for (var zone in WC.ZONES) {
      var c = WC.ZONES[zone];
      var d = Math.acos(Math.max(-1, Math.min(1,
        sinLat * Math.sin(c[0] * RAD) +
        cosLat * Math.cos(c[0] * RAD) * Math.cos((lon - c[1]) * RAD))));
      if (d < bestD) { bestD = d; best = zone; }
    }
    return best ? { zone: best, lat: WC.ZONES[best][0], lon: WC.ZONES[best][1], deg: bestD * 180 / Math.PI } : null;
  };

  WC.connLabel = function (a, b, date) {
    var la = WC.ZONES[a] ? WC.ZONES[a][1] : 0, lb = WC.ZONES[b] ? WC.ZONES[b][1] : 0;
    var ta = WC.ZONES[a] ? WC.ZONES[a][0] : 0, tb = WC.ZONES[b] ? WC.ZONES[b][0] : 0;
    var left = a, right = b;
    if (lb < la || (lb === la && tb > ta)) { left = b; right = a; }
    var diff = WC.time.offsetMinutes(date, right) - WC.time.offsetMinutes(date, left);
    var name = function (z) {
      return ((WC.names && WC.names.display) ? WC.names.display(z) :
        (z === "UTC" ? "UTC" : WC.cityName(z))).toUpperCase();
    };
    var compact = WC.time.deltaLabel(diff).toUpperCase();
    return {
      left: left, right: right,
      leftName: name(left), rightName: name(right),
      text: name(left) + " " + compact + " " + name(right),
      compact: compact,
      flow: diff > 0 ? 1 : (diff < 0 ? -1 : 0)
    };
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
    if (WC.map) WC.map.refresh(WC.now(), true);
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
    if (e.key === "Escape") { if (WC.map && WC.map.clearConnectors) WC.map.clearConnectors(); toggleHelp(false); toggleKiosk(false); return; }
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

  /* ---------- nicknames (dblclick a card title) ---------- */
  if (Object.keys(WC.names.all()).length) WC.clocks.render();

  document.getElementById("clock-grid").addEventListener("dblclick", function (e) {
    var city = e.target.closest ? e.target.closest(".card-city") : null;
    if (!city) return;
    var card = city.closest(".clock-card");
    var zone = card.getAttribute("data-zone");
    var inp = document.createElement("input");
    inp.type = "text"; inp.className = "card-name-input mono";
    inp.maxLength = 24;
    inp.value = WC.names.get(zone) || "";
    inp.placeholder = zone === "UTC" ? "UTC" : WC.cityName(zone);
    inp.setAttribute("aria-label", "Nickname for " + zone);
    city.replaceWith(inp);
    inp.focus(); inp.select();
    var doneEditing = false;
    function commit() {
      if (doneEditing) return;
      doneEditing = true;
      WC.names.set(zone, inp.value);   /* fires wc:prefs -> full re-render */
    }
    inp.addEventListener("keydown", function (ev) {
      ev.stopPropagation();            /* keep global shortcuts quiet */
      if (ev.key === "Enter") commit();
      else if (ev.key === "Escape") { doneEditing = true; WC.clocks.render(); }
    });
    inp.addEventListener("blur", commit);
  });

  /* ---------- click a time to copy it ---------- */
  document.getElementById("clock-grid").addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest(".card-time") : null;
    if (!t) return;
    var card = t.closest(".clock-card");
    var zone = card.getAttribute("data-zone");
    var p = WC.time.parts(WC.now(), zone);
    var h24 = WC.prefs.get("wc-hours", "24") === "24";
    var time = h24 ? p.hh + ":" + p.mm
      : WC.time.format12(p.h).h12 + ":" + p.mm + " " + WC.time.format12(p.h).ampm;
    var text = WC.names.display(zone) + " · " + time + " · " +
      WC.time.offsetLabel(WC.time.offsetMinutes(WC.now(), zone));
    copyText(text, function () {
      var old = card.querySelector(".copy-flash");
      if (old) old.parentNode.removeChild(old);
      var flash = document.createElement("span");
      flash.className = "copy-flash mono";
      flash.textContent = "copied";
      card.appendChild(flash);
      setTimeout(function () { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 1400);
    });
  });

  /* ---------- live title + day/night favicon (home zone) ---------- */
  var FAV_DAY = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Crect%20width='16'%20height='16'%20rx='3'%20fill='%23090c0d'/%3E%3Cpath%20d='M3.5%2014.5%20V7%20Q3.5%202.5%208%202.5%20Q12.5%202.5%2012.5%207%20V14.5%20L11%2013.3%20L9.5%2014.5%20L8%2013.3%20L6.5%2014.5%20L5%2013.3%20Z'%20fill='%2363f2ab'/%3E%3Crect%20x='6'%20y='6.5'%20width='1.4'%20height='2.4'%20fill='%23090c0d'/%3E%3Crect%20x='8.8'%20y='6.5'%20width='1.4'%20height='2.4'%20fill='%23090c0d'/%3E%3C/svg%3E";
  var FAV_NIGHT = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Crect%20width='16'%20height='16'%20rx='3'%20fill='%23090c0d'/%3E%3Cpath%20d='M3.5%2014.5%20V7%20Q3.5%202.5%208%202.5%20Q12.5%202.5%2012.5%207%20V14.5%20L11%2013.3%20L9.5%2014.5%20L8%2013.3%20L6.5%2014.5%20L5%2013.3%20Z'%20fill='%23b78cff'/%3E%3Crect%20x='5.6'%20y='7.6'%20width='2'%20height='1.2'%20fill='%23090c0d'/%3E%3Crect%20x='8.4'%20y='7.6'%20width='2'%20height='1.2'%20fill='%23090c0d'/%3E%3C/svg%3E";
  var favLink = document.querySelector('link[rel="icon"]');
  var lastAmbientMin = -1;
  function homeIsDay(date) {
    var home = WC.clocks.state().home;
    var c = WC.ZONES && WC.ZONES[home];
    if (c && WC.sun) return WC.sun.elevation(c[0], c[1], date) > -0.833;
    var p = WC.time.parts(date, home);
    return p.h >= 6 && p.h < 18;
  }
  function ambient(date) {
    if (date.getMinutes() === lastAmbientMin) return;
    lastAmbientMin = date.getMinutes();
    var home = WC.clocks.state().home;
    var p = WC.time.parts(date, home);
    var h24 = WC.prefs.get("wc-hours", "24") === "24";
    var t = h24 ? p.hh + ":" + p.mm
      : WC.time.format12(p.h).h12 + ":" + p.mm + " " + WC.time.format12(p.h).ampm;
    document.title = t + " — World Clock";
    if (favLink) favLink.href = homeIsDay(date) ? FAV_DAY : FAV_NIGHT;
  }
  WC.onSecond(ambient);
  ambient(WC.now());
  window.addEventListener("wc:scrub", function () {
    lastAmbientMin = -1;
    ambient(WC.now());
  });
})();
