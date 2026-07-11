/* Prefs store (sole localStorage owner) + settings panel + add-zone modal. */
(function () {
  "use strict";
  window.WC = window.WC || {};

  var mem = {};
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] !== undefined ? mem[k] : null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }
  function fire(name) { window.dispatchEvent(new Event(name)); }

  WC.prefs = {
    get: function (k, d) { var v = lsGet(k); return v === null ? d : v; },
    set: function (k, v) { lsSet(k, String(v)); fire("wc:prefs"); },
    remove: function (k) { lsDel(k); fire("wc:prefs"); },
    getZones: function () {
      var raw = lsGet("wc-zones");
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },
    setZones: function (arr) { lsSet("wc-zones", JSON.stringify(arr)); fire("wc:zones"); }
  };

  WC.search = function (query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    var out = [], seen = {};
    function push(zone) {
      if (!seen[zone] && out.length < 30) { seen[zone] = 1; out.push({ zone: zone, name: WC.cityName(zone) }); }
    }
    if (WC.ALIASES[q]) push(WC.ALIASES[q]);
    for (var alias in WC.ALIASES)
      if (alias.indexOf(q) === 0) push(WC.ALIASES[alias]);
    var zones = WC.allZones();
    var qU = q.replace(/ /g, "_");
    for (var i = 0; i < zones.length; i++) {           /* city-segment prefix */
      var city = zones[i].split("/").pop().toLowerCase();
      if (city.indexOf(qU) === 0) push(zones[i]);
    }
    for (var j = 0; j < zones.length; j++)             /* anywhere in the id */
      if (zones[j].toLowerCase().indexOf(qU) > -1) push(zones[j]);
    return out;
  };

  /* ---------- UI (only on index.html) ---------- */
  if (!document.getElementById("btn-settings")) return;

  function currentZones() {
    return WC.prefs.getZones() || WC.DEFAULT_ZONES.slice();
  }

  /* theme toggle: dark -> light -> dark (explicit; system remains a settings choice) */
  document.getElementById("btn-theme").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    var next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    WC.prefs.set("wc-theme", next);
  });

  /* ---------- settings panel ---------- */
  var panel = document.createElement("aside");
  panel.id = "settings-panel";
  panel.innerHTML =
    '<div class="panel-header"><span class="manifest-label">SETTINGS</span>' +
    '<button class="icon-btn" id="settings-close" aria-label="Close settings">&times;</button></div>' +
    '<div class="settings-body">' +
    settingRow("HOURS", '<span class="seg" data-pref="wc-hours">' +
      '<button data-val="24">24H</button><button data-val="12">12H</button></span>') +
    settingRow("SECONDS", '<span class="seg" data-pref="wc-seconds">' +
      '<button data-val="on">ON</button><button data-val="off">OFF</button></span>') +
    settingRow("THEME", '<span class="seg" data-pref="wc-theme">' +
      '<button data-val="dark">DARK</button><button data-val="light">LIGHT</button>' +
      '<button data-val="system">SYSTEM</button></span>') +
    settingRow("ACCENT", '<span class="seg accent-seg" data-pref="wc-accent">' +
      '<button data-val="0" style="color:#63f2ab">&#9632;</button>' +
      '<button data-val="1" style="color:#6bdcff">&#9632;</button>' +
      '<button data-val="2" style="color:#f0c674">&#9632;</button>' +
      '<button data-val="3" style="color:#b78cff">&#9632;</button>' +
      '<button data-val="4" style="color:#f7a35c">&#9632;</button>' +
      '<button data-val="5" style="color:#ff6e7a">&#9632;</button></span>') +
    settingRow("HOME ZONE", '<button id="home-picker" class="text-btn mono"></button>') +
    '<div id="pet-settings"></div>' +
    "</div>";
  document.body.appendChild(panel);

  function settingRow(label, controlHTML) {
    return '<div class="setting-row"><span class="manifest-label">' + label +
      "</span>" + controlHTML + "</div>";
  }

  function refreshSeg() {
    var segs = panel.querySelectorAll(".seg");
    for (var i = 0; i < segs.length; i++) {
      var key = segs[i].getAttribute("data-pref");
      var defaults = { "wc-hours": "24", "wc-seconds": "on", "wc-theme": "system", "wc-accent": "0" };
      var cur = WC.prefs.get(key, defaults[key]);
      var btns = segs[i].querySelectorAll("button");
      for (var j = 0; j < btns.length; j++)
        btns[j].classList.toggle("seg-active", btns[j].getAttribute("data-val") === cur);
    }
    document.getElementById("home-picker").textContent = WC.clocks.state().home;
  }

  panel.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".seg button") : null;
    if (!b) return;
    var key = b.parentNode.getAttribute("data-pref");
    var val = b.getAttribute("data-val");
    if (key === "wc-theme") {
      if (val === "system") { WC.prefs.remove("wc-theme"); document.documentElement.removeAttribute("data-theme"); }
      else { WC.prefs.set("wc-theme", val); document.documentElement.setAttribute("data-theme", val); }
    } else if (key === "wc-accent") {
      if (val === "0") { WC.prefs.remove("wc-accent"); document.documentElement.removeAttribute("data-accent"); }
      else { WC.prefs.set("wc-accent", val); document.documentElement.setAttribute("data-accent", val); }
    } else {
      WC.prefs.set(key, val);
    }
    refreshSeg();
  });

  document.getElementById("btn-settings").addEventListener("click", function () {
    panel.classList.toggle("open");
    refreshSeg();
  });
  document.getElementById("settings-close").addEventListener("click", function () {
    panel.classList.remove("open");
  });

  /* ---------- add-zone modal (also used as home picker) ---------- */
  var modal = document.createElement("div");
  modal.id = "add-modal";
  modal.innerHTML =
    '<div class="modal-box panel">' +
    '<div class="panel-header"><span class="manifest-label" id="add-title">ADD TIMEZONE</span>' +
    '<button class="icon-btn" id="add-close" aria-label="Close">&times;</button></div>' +
    '<input id="add-search" class="mono" type="text" placeholder="search city or zone…" autocomplete="off">' +
    '<div id="add-results"></div>' +
    '<div class="panel-header"><span class="manifest-label">SUGGESTED</span></div>' +
    '<div id="add-suggested"></div></div>';
  document.body.appendChild(modal);

  var pickingHome = false;

  function openModal(forHome) {
    pickingHome = !!forHome;
    document.getElementById("add-title").textContent = pickingHome ? "SET HOME ZONE" : "ADD TIMEZONE";
    modal.classList.add("open");
    renderSuggested();
    renderResults([]);
    var inp = document.getElementById("add-search");
    inp.value = ""; inp.focus();
  }
  function closeModal() { modal.classList.remove("open"); }

  function choose(zone) {
    if (pickingHome) {
      WC.prefs.set("wc-home", zone);
      fire("wc:zones");
    } else {
      var zones = currentZones();
      if (zones.indexOf(zone) === -1 && zone !== WC.clocks.state().home) {
        zones.push(zone);
        WC.prefs.setZones(zones);
      }
    }
    closeModal();
  }

  function zoneRow(zone) {
    return '<button class="zone-row mono" data-zone="' + zone + '">' +
      '<span>' + WC.cityName(zone) + '</span><span class="zone-id">' + zone + "</span></button>";
  }
  function renderResults(matches) {
    var host = document.getElementById("add-results");
    var html = "";
    for (var i = 0; i < matches.length; i++) html += zoneRow(matches[i].zone);
    host.innerHTML = html || '<div class="zone-empty mono">no matches</div>';
  }
  function renderSuggested() {
    var host = document.getElementById("add-suggested");
    var html = "";
    for (var i = 0; i < WC.SUGGESTED.length; i++) html += zoneRow(WC.SUGGESTED[i]);
    host.innerHTML = html;
  }

  document.getElementById("btn-add").addEventListener("click", function () { openModal(false); });
  document.getElementById("home-picker").addEventListener("click", function () {
    panel.classList.remove("open");
    openModal(true);
  });
  document.getElementById("add-close").addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeModal();
    var row = e.target.closest ? e.target.closest(".zone-row") : null;
    if (row) choose(row.getAttribute("data-zone"));
  });
  document.getElementById("add-search").addEventListener("input", function () {
    renderResults(WC.search(this.value));
  });
  document.getElementById("add-search").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var first = document.querySelector("#add-results .zone-row");
      if (first) choose(first.getAttribute("data-zone"));
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeModal(); panel.classList.remove("open"); }
  });

  /* ---------- remove card ---------- */
  document.getElementById("clock-grid").addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".card-remove") : null;
    if (!btn) return;
    var zone = btn.closest(".clock-card").getAttribute("data-zone");
    var zones = currentZones();
    var i = zones.indexOf(zone);
    if (i > -1) { zones.splice(i, 1); WC.prefs.setZones(zones); }
  });
})();
