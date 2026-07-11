/* Time engine. All timezone math delegated to Intl; no libraries. */
(function () {
  "use strict";
  window.WC = window.WC || {};

  var partsCache = {};   /* zone -> DateTimeFormat */
  var offsetCache = {};  /* zone -> DateTimeFormat with shortOffset */
  var dateCache = {};    /* zone -> DateTimeFormat y-m-d only */

  function partsFmt(zone) {
    if (!partsCache[zone]) {
      partsCache[zone] = new Intl.DateTimeFormat("en-US", {
        timeZone: zone, hourCycle: "h23",
        year: "numeric", month: "short", day: "2-digit", weekday: "short",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        timeZoneName: "short"
      });
    }
    return partsCache[zone];
  }
  function offsetFmt(zone) {
    if (!offsetCache[zone]) {
      offsetCache[zone] = new Intl.DateTimeFormat("en-US", {
        timeZone: zone, hour: "2-digit", timeZoneName: "shortOffset"
      });
    }
    return offsetCache[zone];
  }
  function dateFmt(zone) {
    if (!dateCache[zone]) {
      dateCache[zone] = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit"
      });
    }
    return dateCache[zone];
  }
  function collect(fmt, date) {
    var out = {}, arr = fmt.formatToParts(date);
    for (var i = 0; i < arr.length; i++) out[arr[i].type] = arr[i].value;
    return out;
  }
  function fracLabel(rem) {
    return rem === 30 ? ".5" : ":" + (rem < 10 ? "0" : "") + rem;
  }

  WC.time = {
    parts: function (date, zone) {
      var p = collect(partsFmt(zone), date);
      return {
        h: parseInt(p.hour, 10), m: parseInt(p.minute, 10), s: parseInt(p.second, 10),
        hh: p.hour, mm: p.minute, ss: p.second,
        weekday: p.weekday, month: p.month, day: p.day, year: p.year,
        abbr: p.timeZoneName
      };
    },
    offsetMinutes: function (date, zone) {
      var name = collect(offsetFmt(zone), date).timeZoneName; /* "GMT+9", "GMT-4:30", "GMT" */
      var m = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(name);
      if (!m) return 0; /* plain "GMT" or "UTC" */
      var h = parseInt(m[1], 10);
      var mins = m[2] ? parseInt(m[2], 10) : 0;
      return h * 60 + (h < 0 ? -mins : mins);
    },
    offsetLabel: function (min) {
      if (min === 0) return "UTC±0";
      var sign = min > 0 ? "+" : "-", a = Math.abs(min);
      var h = Math.floor(a / 60), frac = a % 60;
      return "UTC" + sign + h + (frac ? fracLabel(frac) : "");
    },
    deltaLabel: function (min) {
      if (min === 0) return "±0h";
      var sign = min > 0 ? "+" : "-", a = Math.abs(min);
      var h = Math.floor(a / 60), rem = a % 60;
      return sign + h + (rem ? fracLabel(rem) : "") + "h";
    },
    homeDelta: function (date, zone, home, refDate) {
      var d = WC.time.offsetMinutes(date, zone) - WC.time.offsetMinutes(date, home);
      var label = WC.time.deltaLabel(d);
      var zd = dateFmt(zone).format(date);
      var hd = dateFmt(home).format(refDate || date);
      var diff = Math.round((Date.parse(zd) - Date.parse(hd)) / 86400000);
      var dayRel = diff === 0 ? "today" : diff === 1 ? "tomorrow" :
        diff === -1 ? "yesterday" : (diff > 0 ? "+" + diff + "d" : diff + "d");
      return { minutes: d, label: label, dayRel: dayRel };
    },
    format12: function (h) {
      return { h12: (h % 12) || 12, ampm: h < 12 ? "AM" : "PM" };
    }
  };

  /* Time scrubbing: every display reads WC.now(); the scrubber shifts it. */
  WC.scrub = { minutes: 0 };
  WC.now = function () {
    return new Date(Date.now() + WC.scrub.minutes * 60000);
  };
  WC.setScrub = function (min) {
    min = Math.max(-1440, Math.min(1440, min | 0));
    WC.scrub.minutes = min;
    if (min) document.documentElement.setAttribute("data-scrub", "on");
    else document.documentElement.removeAttribute("data-scrub");
    window.dispatchEvent(new Event("wc:scrub"));
  };
  WC.scrubLabel = function (min) {
    if (!min) return "NOW";
    var sign = min > 0 ? "+" : "-", a = Math.abs(min);
    var h = Math.floor(a / 60), m = a % 60;
    return sign + (h ? h + "H" : "") + (m ? m + "M" : "");
  };
})();

/* Card rendering + 1 s tick. */
(function () {
  "use strict";
  window.WC = window.WC || {};

  var subscribers = [];
  WC.onSecond = function (fn) { subscribers.push(fn); };

  function pref(k, d) { return WC.prefs ? WC.prefs.get(k, d) : d; }

  function detectHome() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
    catch (e) { return "UTC"; }
  }

  var state = { zones: [], home: detectHome() };

  function loadState() {
    state.home = pref("wc-home", detectHome());
    try { new Intl.DateTimeFormat("en-US", { timeZone: state.home }); }
    catch (e) { console.warn("worldclock: invalid home zone, re-detecting", state.home); state.home = detectHome(); }
    var raw = pref("wc-zones", null);
    var zones = null;
    if (raw) { try { zones = JSON.parse(raw); } catch (e) { zones = null; } }
    if (!zones || !zones.length) zones = WC.DEFAULT_ZONES.slice();
    /* Drop zones this browser no longer knows; keep home out of the list. */
    var ok = [];
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      if (z === state.home) continue;
      try { new Intl.DateTimeFormat("en-US", { timeZone: z }); ok.push(z); }
      catch (e) { console.warn("worldclock: dropping unknown zone", z); }
    }
    state.zones = ok;
  }

  function dayNightIcon(isDay) {
    return isDay
      ? '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="var(--twb-warm)"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="var(--twb-warm)" stroke-width="1.2" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M12.5 9.5A5 5 0 1 1 6.5 3.5 4 4 0 0 0 12.5 9.5Z" fill="var(--twb-text-faint)"/></svg>';
  }

  /* Day if the sun is up at the zone's coords; 06-18 fallback without coords. */
  function isDaylight(date, zone, p) {
    var c = WC.ZONES && WC.ZONES[zone];
    if (c && WC.sun) return WC.sun.elevation(c[0], c[1], date) > -0.833;
    return p.h >= 6 && p.h < 18;
  }

  function escapeHTML(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function timeText(p) {
    var secs = pref("wc-seconds", "on") === "on";
    var h24 = pref("wc-hours", "24") === "24";
    var t;
    if (h24) t = p.hh + ":" + p.mm + (secs ? ":" + p.ss : "");
    else {
      var f = WC.time.format12(p.h);
      t = f.h12 + ":" + p.mm + (secs ? ":" + p.ss : "") +
          '<span class="card-ampm">' + f.ampm + "</span>";
    }
    return t;
  }

  function chipsHTML(zone, date, isHome) {
    /* refDate is intentionally the real, unscrubbed present */
    var d = WC.time.homeDelta(date, zone, state.home, new Date());
    var dayChip = d.dayRel === "today" ? "" :
      '<span class="chip mono chip-otherday">' + d.dayRel + "</span>";
    if (isHome) {
      return '<span class="chip chip-offset mono">your time</span>' + dayChip;
    }
    var todayChip = d.dayRel === "today" ?
      '<span class="chip mono chip-today">today</span>' : dayChip;
    return '<span class="chip chip-offset mono">' + d.label + "</span>" + todayChip;
  }

  function cardHTML(zone, isHome, date) {
    var p = WC.time.parts(date, zone);
    var off = WC.time.offsetMinutes(date, zone);
    var name = escapeHTML((WC.names && WC.names.display) ? WC.names.display(zone) : (zone === "UTC" ? "UTC" : WC.cityName(zone)));
    var html = '<article class="clock-card' + (isHome ? " clock-card-home" : "") +
      '" data-zone="' + zone + '" draggable="' + (isHome ? "false" : "true") + '">' +
      '<div class="card-top"><span class="card-city" title="' + zone + '">' + name + "</span>" +
      '<span class="card-daynight">' + dayNightIcon(isDaylight(date, zone, p)) + "</span>";
    if (!isHome) html += '<button class="card-remove" title="Remove" aria-label="Remove ' + name + '">&times;</button>';
    else html += '<span class="card-home-tag manifest-label">HOME</span>';
    html += "</div>" +
      '<div class="card-time mono">' + timeText(p) + "</div>" +
      '<div class="card-zoneline mono">' + p.abbr + " &middot; " + WC.time.offsetLabel(off) + "</div>";
    html += '<div class="card-chips">' + chipsHTML(zone, date, isHome) + "</div>";
    var dayPct = ((p.h + p.m / 60) / 24 * 100).toFixed(1);
    html += '<div class="card-daybar" aria-hidden="true"><span class="daybar-work"></span>' +
      '<span class="daybar-now" style="left:' + dayPct + '%"></span></div>';
    html += '<div class="card-date mono">' + p.weekday + ", " + p.month + " " + p.day + "</div></article>";
    return html;
  }

  WC.clocks = {
    state: function () { return state; },
    render: function () {
      loadState();
      var grid = document.getElementById("clock-grid");
      if (!grid) return;
      var date = WC.now();
      var html = cardHTML(state.home, true, date);
      for (var i = 0; i < state.zones.length; i++) html += cardHTML(state.zones[i], false, date);
      grid.innerHTML = html;
    },
    tick: function () {
      var date = WC.now();
      var utc = document.getElementById("utc-clock");
      if (utc) {
        var u = WC.time.parts(date, "UTC");
        utc.textContent = u.hh + ":" + u.mm + ":" + u.ss;
      }
      var cards = document.querySelectorAll(".clock-card");
      for (var i = 0; i < cards.length; i++) {
        var zone = cards[i].getAttribute("data-zone");
        var isHome = cards[i].classList.contains("clock-card-home");
        var p = WC.time.parts(date, zone);
        var off = WC.time.offsetMinutes(date, zone);
        cards[i].querySelector(".card-time").innerHTML = timeText(p);
        cards[i].querySelector(".card-date").textContent =
          p.weekday + ", " + p.month + " " + p.day;
        cards[i].querySelector(".card-daynight").innerHTML = dayNightIcon(isDaylight(date, zone, p));
        cards[i].querySelector(".card-zoneline").innerHTML = p.abbr + " &middot; " + WC.time.offsetLabel(off);
        cards[i].querySelector(".card-chips").innerHTML = chipsHTML(zone, date, isHome);
        var bar = cards[i].querySelector(".daybar-now");
        if (bar) bar.style.left = ((p.h + p.m / 60) / 24 * 100).toFixed(1) + "%";
      }
      for (var j = 0; j < subscribers.length; j++) subscribers[j](date);
    }
  };

  window.addEventListener("wc:zones", WC.clocks.render);
  window.addEventListener("wc:prefs", WC.clocks.render);

  if (document.getElementById("clock-grid")) {   /* not on tests.html */
    WC.clocks.render();
    WC.clocks.tick();
    setInterval(WC.clocks.tick, 1000);
  }
})();
