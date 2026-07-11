/* World map: land, graticule, day/night terminator, sun, city markers. */
(function () {
  "use strict";
  window.WC = window.WC || {};

  var W = 1000, H = 500;
  var RAD = Math.PI / 180, DEG = 180 / Math.PI;

  /* --- solar position (low-precision NOAA-style; << 1 deg error) --- */
  function solar(date) {
    var n = (date.getTime() - 946728000000) / 86400000; /* days since J2000 */
    var L = (280.460 + 0.9856474 * n) % 360; if (L < 0) L += 360;
    var g = ((357.528 + 0.9856003 * n) % 360) * RAD;
    var lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    var eps = (23.439 - 0.0000004 * n) * RAD;
    var decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    var raDeg = ra * DEG; if (raDeg < 0) raDeg += 360;
    var eot = L - raDeg;                     /* degrees */
    if (eot > 180) eot -= 360; if (eot < -180) eot += 360;
    return { decl: decl * DEG, eot: eot * 4 /* minutes */ };
  }

  WC.sun = {
    declination: function (date) { return solar(date).decl; },
    subsolar: function (date) {
      var s = solar(date);
      var utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
      var lon = -15 * (utcH - 12 + s.eot / 60);
      if (lon < -180) lon += 360; if (lon > 180) lon -= 360;
      return { lat: s.decl, lon: lon };
    },
    elevation: function (lat, lon, date) {
      var ss = WC.sun.subsolar(date);
      var sinEl = Math.sin(lat * RAD) * Math.sin(ss.lat * RAD) +
        Math.cos(lat * RAD) * Math.cos(ss.lat * RAD) * Math.cos((lon - ss.lon) * RAD);
      return Math.asin(Math.max(-1, Math.min(1, sinEl))) * DEG;
    }
  };

  function px(lon) { return (lon + 180) / 360 * W; }
  function py(lat) { return (90 - lat) / 180 * H; }

  /* Night polygon: terminator latitude per longitude column, closed along
     the dark pole's edge. */
  function nightPath(date) {
    var ss = WC.sun.subsolar(date);
    var declR = ss.lat * RAD;
    var pts = [];
    for (var lon = -180; lon <= 180; lon += 2) {
      var H_ = (lon - ss.lon) * RAD;
      var lat = Math.atan(-Math.cos(H_) / Math.tan(declR)) * DEG;
      pts.push(px(lon).toFixed(1) + " " + py(lat).toFixed(1));
    }
    var poleY = ss.lat >= 0 ? H : 0; /* north summer -> south pole dark */
    return "M" + pts.join("L") + "L" + W + " " + poleY + "L0 " + poleY + "Z";
  }

  var svg = null, nightEl = null, sunEl = null, markersEl = null, tipEl = null;
  var connEl = null, snapEl = null, chipEl = null, cdrag = null, conn = null;

  function el(name, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function build() {
    var host = document.getElementById("map-host");
    if (!host) return;
    svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "worldmap",
      role: "img", "aria-label": "World map with day/night terminator" });
    /* graticule every 30 deg */
    var grat = el("g", { "class": "map-graticule" });
    for (var lon = -150; lon <= 150; lon += 30)
      grat.appendChild(el("line", { x1: px(lon), y1: 0, x2: px(lon), y2: H }));
    for (var lat = -60; lat <= 60; lat += 30)
      grat.appendChild(el("line", { x1: 0, y1: py(lat), x2: W, y2: py(lat) }));
    svg.appendChild(grat);
    svg.appendChild(el("path", { "class": "map-land", d: WC.MAP_PATH }));
    nightEl = el("path", { "class": "map-night", d: "" });
    svg.appendChild(nightEl);
    sunEl = el("g", { "class": "map-sun" });
    sunEl.appendChild(el("circle", { r: 7, "class": "map-sun-core" }));
    sunEl.appendChild(el("circle", { r: 12, "class": "map-sun-halo" }));
    svg.appendChild(sunEl);
    markersEl = el("g", { "class": "map-markers" });
    svg.appendChild(markersEl);
    connEl = el("g", { "class": "map-conn" });
    svg.appendChild(connEl);
    snapEl = el("circle", { r: 9, "class": "conn-snap", visibility: "hidden" });
    svg.appendChild(snapEl);
    host.appendChild(svg);
    tipEl = document.createElement("div");
    tipEl.className = "map-tip mono";
    tipEl.setAttribute("hidden", "");
    host.appendChild(tipEl);
    chipEl = document.createElement("div");
    chipEl.className = "conn-chip mono";
    chipEl.hidden = true;
    host.appendChild(chipEl);
    svg.style.touchAction = "none";
    svg.addEventListener("pointerdown", connStart);
    svg.addEventListener("pointermove", connMove);
    window.addEventListener("pointerup", connEnd);
    window.addEventListener("resize", function () { if (conn) updateChip(); });
    host.addEventListener("mousemove", onHover);
    host.addEventListener("mouseleave", function () { tipEl.setAttribute("hidden", ""); syncCards(null); });
  }

  function markerHTML(zone, home) {
    var c = WC.ZONES[zone];
    if (!c) return null;
    var g = el("g", { "class": "map-marker" + (home ? " map-marker-home" : ""),
      "data-zone": zone, transform: "translate(" + px(c[1]).toFixed(1) + "," + py(c[0]).toFixed(1) + ")" });
    if (home) g.appendChild(el("circle", { r: 7, "class": "marker-ring" }));
    g.appendChild(el("circle", { r: 3, "class": "marker-dot" }));
    return g;
  }

  function onHover(e) {
    if (cdrag && cdrag.moved) return;
    var t = e.target.closest ? e.target.closest(".map-marker") : null;
    if (!t) { tipEl.setAttribute("hidden", ""); syncCards(null); return; }
    var zone = t.getAttribute("data-zone");
    var p = WC.time.parts(WC.now(), zone);
    var timeStr;
    if (WC.prefs.get("wc-hours", "24") === "12") {
      var f = WC.time.format12(p.h);
      timeStr = f.h12 + ":" + p.mm + " " + f.ampm;
    } else {
      timeStr = p.hh + ":" + p.mm;
    }
    tipEl.textContent = ((WC.names && WC.names.display) ? WC.names.display(zone) : WC.cityName(zone)) + " · " + timeStr +
      " · " + p.abbr;
    tipEl.removeAttribute("hidden");
    var host = document.getElementById("map-host").getBoundingClientRect();
    tipEl.style.left = (e.clientX - host.left + 12) + "px";
    tipEl.style.top = (e.clientY - host.top - 10) + "px";
    syncCards(zone);
  }

  function syncCards(zone) {
    var cards = document.querySelectorAll(".clock-card");
    for (var i = 0; i < cards.length; i++)
      cards[i].classList.toggle("card-hilite", zone !== null &&
        cards[i].getAttribute("data-zone") === zone);
  }

  /* --- measure connector: drag between two points, ends snap to cities --- */
  function eventLatLon(e) {
    var r = svg.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width * W;
    var y = (e.clientY - r.top) / r.height * H;
    return { lat: 90 - y / H * 180, lon: x / W * 360 - 180 };
  }
  function connStart(e) {
    if (e.button !== undefined && e.button !== 0) return;
    var ll = eventLatLon(e);
    var near = WC.nearestZone(ll.lat, ll.lon);
    if (!near) return;
    cdrag = { sx: e.clientX, sy: e.clientY, startZone: near.zone, moved: false };
  }
  function connMove(e) {
    if (!cdrag) return;
    var dx = e.clientX - cdrag.sx, dy = e.clientY - cdrag.sy;
    if (!cdrag.moved && dx * dx + dy * dy < 36) return;
    cdrag.moved = true;
    var ll = eventLatLon(e);
    var near = WC.nearestZone(ll.lat, ll.lon);
    var A = WC.ZONES[cdrag.startZone];
    connEl.innerHTML = "";
    connEl.appendChild(el("line", { x1: px(A[1]).toFixed(1), y1: py(A[0]).toFixed(1),
      x2: px(ll.lon).toFixed(1), y2: py(ll.lat).toFixed(1), "class": "conn-line" }));
    connEl.appendChild(el("circle", { cx: px(A[1]).toFixed(1), cy: py(A[0]).toFixed(1), r: 4, "class": "conn-dot" }));
    if (near) {
      snapEl.setAttribute("cx", px(near.lon).toFixed(1));
      snapEl.setAttribute("cy", py(near.lat).toFixed(1));
      snapEl.setAttribute("visibility", "visible");
    }
    chipEl.hidden = true;
    tipEl.setAttribute("hidden", "");
  }
  function connEnd(e) {
    if (!cdrag) return;
    var d = cdrag; cdrag = null;
    snapEl.setAttribute("visibility", "hidden");
    if (!d.moved) { WC.map.clearConnector(); return; }  /* plain click clears */
    var ll = eventLatLon(e);
    var near = WC.nearestZone(ll.lat, ll.lon);
    if (!near || near.zone === d.startZone) { WC.map.clearConnector(); return; }
    conn = { a: d.startZone, b: near.zone };
    drawConn();
  }
  function drawConn() {
    connEl.innerHTML = "";
    if (!conn) { chipEl.hidden = true; return; }
    var A = WC.ZONES[conn.a], B = WC.ZONES[conn.b];
    connEl.appendChild(el("line", { x1: px(A[1]).toFixed(1), y1: py(A[0]).toFixed(1),
      x2: px(B[1]).toFixed(1), y2: py(B[0]).toFixed(1), "class": "conn-line" }));
    connEl.appendChild(el("circle", { cx: px(A[1]).toFixed(1), cy: py(A[0]).toFixed(1), r: 4, "class": "conn-dot" }));
    connEl.appendChild(el("circle", { cx: px(B[1]).toFixed(1), cy: py(B[0]).toFixed(1), r: 4, "class": "conn-dot" }));
    updateChip();
  }
  function connName(z) {
    return ((WC.names && WC.names.display) ? WC.names.display(z) : WC.cityName(z));
  }
  function updateChip() {
    if (!conn) return;
    var now = WC.now();
    var diff = WC.time.offsetMinutes(now, conn.b) - WC.time.offsetMinutes(now, conn.a);
    chipEl.innerHTML = "";
    var span = document.createElement("span");
    span.textContent = connName(conn.a).toUpperCase() + " → " +
      connName(conn.b).toUpperCase() + " " + WC.time.deltaLabel(diff);
    var pa = WC.time.parts(now, conn.a), pb = WC.time.parts(now, conn.b);
    chipEl.title = connName(conn.a) + " " + pa.hh + ":" + pa.mm + " · " +
      connName(conn.b) + " " + pb.hh + ":" + pb.mm;
    var x = document.createElement("button");
    x.className = "conn-x";
    x.setAttribute("aria-label", "Clear measurement");
    x.textContent = "×";
    x.addEventListener("click", function () { WC.map.clearConnector(); });
    chipEl.appendChild(span);
    chipEl.appendChild(x);
    chipEl.hidden = false;
    var A = WC.ZONES[conn.a], B = WC.ZONES[conn.b];
    var r = svg.getBoundingClientRect();
    var hostR = svg.parentNode.getBoundingClientRect();
    var mx = ((px(A[1]) + px(B[1])) / 2) / W * r.width + (r.left - hostR.left);
    var my = ((py(A[0]) + py(B[0])) / 2) / H * r.height + (r.top - hostR.top);
    chipEl.style.left = mx + "px";
    chipEl.style.top = my + "px";
  }

  var lastMinute = -1;

  WC.map = {
    render: function () {
      if (!svg) return;
      markersEl.innerHTML = "";
      var st = WC.clocks.state();
      var all = [st.home].concat(st.zones);
      for (var i = 0; i < all.length; i++) {
        var m = markerHTML(all[i], i === 0);
        if (m) markersEl.appendChild(m);
      }
      WC.map.refresh(WC.now(), true);
    },
    refresh: function (date, force) {
      if (!svg) return;
      var min = date.getUTCMinutes();
      if (!force && min === lastMinute) return;
      lastMinute = min;
      nightEl.setAttribute("d", nightPath(date));
      var ss = WC.sun.subsolar(date);
      sunEl.setAttribute("transform",
        "translate(" + px(ss.lon).toFixed(1) + "," + py(ss.lat).toFixed(1) + ")");
      var info = document.getElementById("map-sun-info");
      if (info) info.textContent =
        "SUN " + ss.lat.toFixed(1) + "°, " + ss.lon.toFixed(1) + "°";
      if (conn) updateChip();
    },
    clearConnector: function () {
      conn = null;
      if (connEl) connEl.innerHTML = "";
      if (chipEl) chipEl.hidden = true;
    }
  };

  /* Card hover highlights its marker. */
  document.addEventListener("mouseover", function (e) {
    var card = e.target.closest ? e.target.closest(".clock-card") : null;
    var markers = document.querySelectorAll(".map-marker");
    for (var i = 0; i < markers.length; i++)
      markers[i].classList.toggle("marker-hilite", card !== null &&
        markers[i].getAttribute("data-zone") === card.getAttribute("data-zone"));
  });

  if (document.getElementById("map-host")) {
    build();
    WC.map.render();
    if (WC.onSecond) WC.onSecond(function (date) { WC.map.refresh(date); });
    window.addEventListener("wc:zones", WC.map.render);
    window.addEventListener("wc:prefs", WC.map.render);
  }
})();
