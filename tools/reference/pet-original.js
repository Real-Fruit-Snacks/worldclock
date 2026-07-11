(function () {
  "use strict";
  var root = document.documentElement;
  var pet = document.getElementById("site-pet");
  if (!pet) return;
  function petOn() { return root.getAttribute("data-pet") !== "off"; }
  function petMode() {
    var a = root.getAttribute("data-pet");
    return a === "off" ? "off" : (a === "float" ? "float" : "cursor");
  }
  var tilt = pet.querySelector(".pet-tilt");
  var sprite = pet.querySelector(".pet-sprite");
  // The pet intentionally animates regardless of the OS "reduce motion"
  // setting; readers who don't want it can turn the pet off entirely.
  var reduced = false;

  var QUIPS = {
    idle:  ["> idle", "$ _", "hi", "just vibing", "boop me?", "^_^", "> uptime"],
    peek:  ["whatcha reading?", "ooh", "> peek", "nice note"],
    read:  ["reading...", "go on", "> tail -f", "good line"],
    nap:   ["zzz", "> sleep 60", "afk", "5 more min"],
    boop:  ["boop!", "yay", "<3", "again!", ":D"],
    spook: ["!", "eek", "> ^C", "yikes"],
    fling: ["wheee", "whoa", "> yeet"]
  };
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  var lastQuip = 0, QUIP_GAP = 12000;
  function say(text, kind, force) {
    if (!cfgSpeech) return;
    if (reduced && !force) return;
    var now = Date.now();
    if (!force && now - lastQuip < QUIP_GAP) return;
    lastQuip = now;
    var old = pet.querySelector(".pet-bubble");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var b = document.createElement("div");
    b.className = "pet-bubble" + (kind ? " pet-bubble-" + kind : "");
    b.textContent = text;
    pet.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 2600);
  }

  var SIZE_MIN = 16, SIZE_MAX = 64, SIZE_DEFAULT = 28;
  function readSize() {
    var s = parseInt(localStorage.getItem("twb-pet-size"), 10);
    if (!(s >= SIZE_MIN && s <= SIZE_MAX)) s = SIZE_DEFAULT;
    return s;
  }
  var SIZE = readSize(), MARGIN = 8, TOP_CLAMP = 88;
  var TRAIL = 44;            // cursor mode: resting distance behind the pointer
  var EASE = 0.06;           // cursor mode: follow ease
  var NAP_AFTER = 60000;     // idle this long with no input -> nap
  var BORED_AFTER = 22000;   // no startle this long while drifting -> spin
  var SPOOK_DIST = 50;       // pointer within this many px -> startled
  var SPOOK_COOLDOWN = 2600; // minimum gap between startles

  // Eased "core" position; roam mode renders a drifting bob on top of it.
  var x = window.innerWidth - SIZE - 16;
  var y = window.innerHeight - SIZE - 16;
  var mx = null, my = null;
  var lean = 0;
  var raf = null;

  // cursor-mode nap bookkeeping (kept separate from the roam machine)
  var lastMove = Date.now();
  var lastZ = 0;
  var napping = false;
  var petting = false;
  var lastMode = petMode();

  // --- roam ("float") state machine ---
  // drift: jellyfish wander | peek: hide at an element edge | read: bob
  // beside the paragraph in view | spook: startled zip | nap: idle corner.
  var roamPhase = "drift";
  var phaseUntil = 0;                // when the current timed phase ends
  var tgt = { x: x, y: y };          // navigation target for the phase
  var tgtEase = 0.02;               // how hard we chase tgt (per phase)
  var bobT = Math.random() * 6.28;   // bob / weave accumulator
  var lastActive = Date.now();       // last real user activity (any input)
  var lastStartle = Date.now();      // last startle (drives the bored spin)
  var lastRead = 0;                  // last reading-along anchor
  var readEl = null;                 // paragraph being read along
  var spinning = false;
  var holdUntil = 0;                 // hover-in-place ("take a break") timer
  var OFF = SIZE + 40;               // how far past an edge to park when hidden
  var DRIFT_EASE = 0.013, PEEK_EASE = 0.09, READ_EASE = 0.08, SPOOK_EASE = 0.22;
  var VANISH_EASE = 0.06, ARRIVE_EASE = 0.05;

  // Body color: an index into the six-token theme palette (0 = accent, the
  // default). Booping the ghost advances it; the choice is remembered.
  var COLOR_COUNT = 6;
  var petColor = 0;
  try { petColor = parseInt(localStorage.getItem("twb-pet-color"), 10) || 0; }
  catch (e) { /* private mode */ }
  if (!(petColor >= 1 && petColor < COLOR_COUNT)) petColor = 0;
  function applyPetColor() {
    if (petColor) pet.setAttribute("data-color", petColor);
    else pet.removeAttribute("data-color");
  }
  function cyclePetColor() {
    petColor = (petColor + 1) % COLOR_COUNT;
    applyPetColor();
    try {
      if (petColor) localStorage.setItem("twb-pet-color", String(petColor));
      else localStorage.removeItem("twb-pet-color");
    } catch (e) { /* private mode */ }
  }

  // Per-quirk flags + appearance, read from localStorage (default on; speech off).
  var cfgNap = true, cfgFlee = true, cfgRead = true, cfgTricks = true, cfgSpeech = false;
  function boolKey(k, dflt) {
    try {
      var v = localStorage.getItem(k);
      if (v === "on") return true;
      if (v === "off") return false;
    } catch (e) { /* private mode */ }
    return dflt;
  }
  function applySize() {
    SIZE = readSize();
    document.documentElement.style.setProperty("--pet-size", SIZE + "px");
    clampCore();
    apply();
  }
  function applyOpacity() {
    var o = parseInt(localStorage.getItem("twb-pet-opacity"), 10);
    if (!(o >= 15 && o <= 100)) o = 70;
    document.documentElement.style.setProperty("--pet-base-opacity", (o / 100).toFixed(3));
  }
  function readCfg() {
    cfgNap = boolKey("twb-pet-nap", true);
    cfgFlee = boolKey("twb-pet-flee", true);
    cfgRead = boolKey("twb-pet-read", true);
    cfgTricks = boolKey("twb-pet-tricks", true);
    cfgSpeech = boolKey("twb-pet-speech", false);
    var c = parseInt(localStorage.getItem("twb-pet-color"), 10);
    petColor = (c >= 1 && c < COLOR_COUNT) ? c : 0;
    applyPetColor();
    applySize();
    applyOpacity();
  }

  // --- geometry helpers ---
  function maxX() { return window.innerWidth - SIZE - MARGIN; }
  function maxY() { return window.innerHeight - SIZE - MARGIN; }
  function clampX(v) { return Math.max(MARGIN, Math.min(maxX(), v)); }
  function clampY(v) { return Math.max(TOP_CLAMP, Math.min(maxY(), v)); }
  function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function clampCore() {
    if (x < MARGIN) x = MARGIN;
    if (y < TOP_CLAMP) y = TOP_CLAMP;
    if (x > maxX()) x = maxX();
    if (y > maxY()) y = maxY();
  }
  function renderAt(px, py) {
    pet.style.transform = "translate(" + px.toFixed(1) + "px," + py.toFixed(1) + "px)";
    tilt.style.transform = "rotate(" + lean.toFixed(1) + "deg)";
  }
  function apply() { renderAt(x, y); }
  // Ease the core toward tgt and bank the lean into the motion.
  function ease() {
    var vx = (tgt.x - x) * tgtEase, vy = (tgt.y - y) * tgtEase;
    x += vx; y += vy;
    lean += (vx * 1.5 - lean) * 0.12;
    if (lean > 12) lean = 12;
    if (lean < -12) lean = -12;
  }

  function spawnParticle(ch, cls) {
    var s = document.createElement("span");
    s.className = "pet-particle " + cls;
    s.textContent = ch;
    pet.appendChild(s);
    setTimeout(function () {
      if (s.parentNode) s.parentNode.removeChild(s);
    }, 1400);
  }
  // Only accept clicks while the ghost is holding still enough to boop; this
  // also stops a wandering ghost from stealing clicks on the text beneath it.
  function setBoopable(on) { sprite.style.pointerEvents = on ? "auto" : "none"; }

  // --- cursor-mode nap (dim in place) ---
  function setNap(on) {
    if (napping === on) return;
    napping = on;
    pet.className = on ? "pet-nap" : "";
  }

  function scheduleBlink() {
    setTimeout(function () {
      if (!napping && !petting && !spinning && roamPhase !== "nap") {
        sprite.className = "pet-sprite pet-blink";
        setTimeout(function () {
          if (!petting && !spinning) sprite.className = "pet-sprite";
        }, 160);
      }
      scheduleBlink();
    }, 4000 + Math.random() * 3000);
  }

  // --- activity + input ---
  function markActivity() {
    lastActive = Date.now();
    if (petMode() === "float" && roamPhase === "nap") wakeFromNap();
  }
  document.addEventListener("mousemove", function (e) {
    mx = e.clientX; my = e.clientY;
    lastMove = Date.now();
    markActivity();
    if (napping) setNap(false);
    if (petMode() === "float") maybeSpook();
    schedule();
  });
  document.addEventListener("scroll", function () {
    markActivity();
    if (petMode() === "float") maybeRead();
    schedule();
  }, true);  // capture so inner scrollers count too
  document.addEventListener("keydown", markActivity);
  document.addEventListener("click", markActivity, true);
  document.addEventListener("touchstart", markActivity, true);

  // Boop: happy scale-bounce, a heart or a "!", then zip away.
  function boop() {
    markActivity();
    cyclePetColor();
    if (petting) return;
    petting = true;
    setNap(false);
    sprite.className = "pet-sprite pet-happy";
    if (Math.random() < 0.5) spawnParticle("♥", "pet-heart");
    else spawnParticle("!", "pet-bang");
    say(pick(QUIPS.boop), "boop", true);
    if (petMode() === "float") { wakeFromNap(); zipAway(false); }
    setTimeout(function () {
      if (!spinning) sprite.className = "pet-sprite";
      petting = false;
    }, 1100);
  }

  // --- drag & fling ---
  var drag = null, flingVX = 0, flingVY = 0;
  function beginDrag() {
    clearPeek(); pet.style.opacity = ""; pet.className = "";
    napping = false; readEl = null; roamPhase = "drag";
    sprite.style.cursor = "grabbing"; setBoopable(true);
  }
  function endDrag(vx, vy) {
    sprite.style.cursor = ""; markActivity();
    if (petMode() === "float" && !reduced) {
      flingVX = Math.max(-42, Math.min(42, vx));
      flingVY = Math.max(-42, Math.min(42, vy));
      if (Math.abs(flingVX) + Math.abs(flingVY) > 6) say(pick(QUIPS.fling), "good", true);
      roamPhase = "fling";
    } else if (petMode() === "float") {
      enterDrift(Date.now());
    } else {
      lastMove = Date.now();
    }
    schedule();
  }
  function flingStep(now) {
    x += flingVX; y += flingVY;
    flingVX *= 0.90; flingVY *= 0.90;
    if (x < MARGIN) { x = MARGIN; flingVX = -flingVX * 0.5; }
    if (x > maxX()) { x = maxX(); flingVX = -flingVX * 0.5; }
    if (y < TOP_CLAMP) { y = TOP_CLAMP; flingVY = -flingVY * 0.5; }
    if (y > maxY()) { y = maxY(); flingVY = -flingVY * 0.5; }
    lean += (flingVX * 1.2 - lean) * 0.2;
    if (lean > 16) lean = 16;
    if (lean < -16) lean = -16;
    renderAt(x, y);
    if (Math.abs(flingVX) + Math.abs(flingVY) < 1.2) { lean = 0; enterDrift(now); }
  }

  sprite.addEventListener("pointerdown", function (e) {
    if (e.button != null && e.button !== 0) return;
    markActivity();
    drag = { sx: e.clientX, sy: e.clientY, moved: false,
             gx: e.clientX - x, gy: e.clientY - y,
             lx: e.clientX, ly: e.clientY,
             lt: (window.performance ? performance.now() : Date.now()), vx: 0, vy: 0 };
    try { sprite.setPointerCapture(e.pointerId); } catch (err) {}
  });
  window.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && (dx * dx + dy * dy) > 25) { drag.moved = true; beginDrag(); }
    if (!drag.moved) return;
    x = clampX(e.clientX - drag.gx);
    y = clampY(e.clientY - drag.gy);
    var t = (window.performance ? performance.now() : Date.now());
    var dt = Math.max(1, t - drag.lt);
    drag.vx = (e.clientX - drag.lx) / dt * 16;
    drag.vy = (e.clientY - drag.ly) / dt * 16;
    drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = t;
    lean = Math.max(-16, Math.min(16, drag.vx * 0.5));
    renderAt(x, y);
    schedule();
  });
  function endPointer(e) {
    if (!drag) return;
    var moved = drag.moved, vx = drag.vx, vy = drag.vy;
    try { sprite.releasePointerCapture(e.pointerId); } catch (err) {}
    drag = null;
    if (moved) endDrag(vx, vy); else boop();
  }
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);

  // --- startle (#3) and zip ---
  function opposite() {
    var cx = x + SIZE / 2;
    var farX = cx < window.innerWidth / 2
      ? maxX() - Math.random() * 90
      : MARGIN + Math.random() * 90;
    tgt = { x: clampX(farX), y: clampY(TOP_CLAMP + Math.random() * (maxY() - TOP_CLAMP)) };
  }
  function zipAway(scared) {
    clearPeek();
    pet.style.opacity = "";   // always visible for the zip
    opposite();
    tgtEase = SPOOK_EASE;
    roamPhase = "spook";
    phaseUntil = Date.now() + 750;
    lastStartle = Date.now();
    readEl = null;
    setBoopable(false);
    if (scared) {
      sprite.className = "pet-sprite pet-spook";  // vertical squash-and-stretch
      pet.className = "pet-startled";             // brief opacity dip
      say(pick(QUIPS.spook), "boop");
    }
  }
  function maybeSpook() {
    if (reduced || mx === null || !cfgFlee) return;
    if (roamPhase === "spook" || roamPhase === "nap") return;
    if (Date.now() - lastStartle < SPOOK_COOLDOWN) return;
    if (dist(x + SIZE / 2, y + SIZE / 2, mx, my) <= SPOOK_DIST) zipAway(true);
  }
  function spookStep(now) {
    ease();
    renderAt(x, y);
    if ((now > phaseUntil && dist(x, y, tgt.x, tgt.y) < 8) || now > phaseUntil + 1200)
      endSpook(now);
  }
  function endSpook(now) {
    sprite.className = petting ? "pet-sprite pet-happy" : "pet-sprite";
    pet.className = "";
    enterDrift(now);
  }

  // --- peek-a-boo (#2) ---
  function clearPeek() {
    sprite.style.clipPath = "";
    sprite.style.webkitClipPath = "";
  }
  function peekCandidates() {
    var note = document.querySelector("article.note");
    if (!note) return [];
    var els = note.querySelectorAll("h1,h2,h3,h4,pre,blockquote,table,img");
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > SIZE && r.height > SIZE &&
          r.bottom > TOP_CLAMP + SIZE && r.top < window.innerHeight - SIZE) {
        out.push(els[i]);
      }
    }
    return out;
  }
  function enterPeek(now) {
    var pool = peekCandidates();
    if (!pool.length) { enterDrift(now); return; }
    var r = pool[Math.floor(Math.random() * pool.length)].getBoundingClientRect();
    var edge = Math.floor(Math.random() * 3), clip;
    if (edge === 0) {           // peek over the top edge
      tgt = { x: clampX(r.left + Math.random() * Math.max(1, r.width - SIZE)),
              y: clampY(r.top - SIZE / 2) };
      clip = "inset(0 0 46% 0)";
    } else if (edge === 1) {    // cling to the left edge
      tgt = { x: clampX(r.left - SIZE / 2),
              y: clampY(r.top + Math.random() * Math.max(1, r.height - SIZE)) };
      clip = "inset(0 50% 0 0)";
    } else {                    // cling to the right edge
      tgt = { x: clampX(r.right - SIZE / 2),
              y: clampY(r.top + Math.random() * Math.max(1, r.height - SIZE)) };
      clip = "inset(0 0 0 50%)";
    }
    tgtEase = PEEK_EASE;
    roamPhase = "peek";
    phaseUntil = now + 3200 + Math.random() * 2400;
    sprite.style.clipPath = clip;
    sprite.style.webkitClipPath = clip;
    setBoopable(true);
    say(pick(QUIPS.peek));
  }
  function peekStep(now) {
    ease();
    bobT += 0.05;
    renderAt(clampX(x + Math.sin(bobT) * 2.5), clampY(y + Math.sin(bobT * 1.3) * 2.5));
    if (now > phaseUntil) { clearPeek(); enterDrift(now); }
  }

  // --- reading along (#5) ---
  function paragraphNearCenter() {
    var note = document.querySelector("article.note");
    if (!note) return null;
    var ps = note.querySelectorAll("p,li,h2,h3,blockquote");
    var mid = window.innerHeight / 2, best = null, bestD = 1e9;
    for (var i = 0; i < ps.length; i++) {
      var r = ps[i].getBoundingClientRect();
      if (r.height < 10 || r.bottom < TOP_CLAMP || r.top > window.innerHeight) continue;
      var d = Math.abs((r.top + r.height / 2) - mid);
      if (d < bestD) { bestD = d; best = ps[i]; }
    }
    return best;
  }
  function readAnchor() {
    if (!readEl || !document.contains(readEl)) return null;
    var r = readEl.getBoundingClientRect();
    if (r.bottom < TOP_CLAMP || r.top > window.innerHeight) return null;
    var rightX = r.right + 18, leftX = r.left - SIZE - 18;
    var x0 = rightX <= maxX() ? rightX : (leftX >= MARGIN ? leftX : rightX);
    return { x: clampX(x0), y: clampY(r.top + r.height / 2 - SIZE / 2) };
  }
  function maybeRead() {
    if (reduced || !cfgRead || petMode() !== "float" || roamPhase !== "drift") return;
    var now = Date.now();
    if (now - lastRead < 9000 || Math.random() > 0.5) return;
    var p = paragraphNearCenter();
    if (!p) return;
    readEl = p;
    lastRead = now;
    roamPhase = "read";
    phaseUntil = now + 4500 + Math.random() * 3500;
    tgtEase = READ_EASE;
    setBoopable(true);
    say(pick(QUIPS.read));
  }
  function readStep(now) {
    var a = readAnchor();
    if (!a) { enterDrift(now); return; }
    tgt = a;
    ease();
    bobT += 0.04;
    renderAt(clampX(x), clampY(y + Math.sin(bobT) * 4));
    if (now > phaseUntil) enterDrift(now);
  }

  // --- jellyfish drift (#1) + bored spin (#4) ---
  // Drift is deliberately lazy: a slow cruise to a waypoint, then a hover in
  // place, then a coin-flip over what to do next (rest again, wander on, peek,
  // or fade off an edge and pop back in elsewhere).
  function pickWaypoint() {
    tgt = { x: MARGIN + Math.random() * (maxX() - MARGIN),
            y: TOP_CLAMP + Math.random() * (maxY() - TOP_CLAMP) };
    tgtEase = DRIFT_EASE;
  }
  function enterDrift(now) {
    roamPhase = "drift";
    pickWaypoint();
    holdUntil = now + 1500 + Math.random() * 2500;  // settle before wandering
    clearPeek();
    setBoopable(false);
    readEl = null;
    pet.style.opacity = "";
  }
  function nextDriftAction(now) {
    var r = Math.random();
    if (r < 0.22) enterVanish(now);                        // fade off an edge
    else if (r < 0.40) enterPeek(now);                     // hide on a block
    else if (r < 0.72) holdUntil = now + 2600 + Math.random() * 3800;  // rest
    else pickWaypoint();                                   // amble somewhere new
  }
  function doSpin(now) {
    spinning = true;
    lastStartle = now;
    sprite.className = "pet-sprite " + (Math.random() < 0.5 ? "pet-spin" : "pet-flip");
    setTimeout(function () {
      spinning = false;
      if (!petting) sprite.className = "pet-sprite";
    }, 740);
  }
  function driftStep(now) {
    var resting = holdUntil && now < holdUntil;
    if (resting) {
      /* hovering in place — barely a sway */
      if (Math.random() < 0.02) say(pick(QUIPS.idle));
    } else {
      holdUntil = 0;
      if (dist(x, y, tgt.x, tgt.y) < 20) nextDriftAction(now);
      else ease();  // slow cruise
    }
    // Calm idle sway while resting; a touch livelier while cruising.
    bobT += resting ? 0.014 : 0.024;
    var amp = resting ? 2.2 : 4.2;
    renderAt(clampX(x + Math.sin(bobT * 0.7) * amp),
             clampY(y + Math.sin(bobT * 1.0 + 1.3) * amp * 0.8));
    if (cfgTricks && !spinning && now - lastStartle > BORED_AFTER) doSpin(now);
  }

  // --- fade off an edge, wait unseen, drift back in (#pop-in) ---
  function edgePoint(ax, ay) {
    var W = window.innerWidth, H = window.innerHeight;
    switch (Math.floor(Math.random() * 4)) {
      case 0: return { x: ax, y: -OFF };      // top
      case 1: return { x: ax, y: H + OFF };   // bottom
      case 2: return { x: -OFF, y: ay };      // left
      default: return { x: W + OFF, y: ay };  // right
    }
  }
  function enterVanish(now) {
    roamPhase = "vanish";
    tgt = edgePoint(x, y);   // slip out the nearest-aligned edge
    tgtEase = VANISH_EASE;
    pet.style.opacity = "0"; // CSS transitions the fade over 0.9s
    phaseUntil = now + 1200;
    clearPeek();
    setBoopable(false);
    readEl = null;
  }
  function vanishStep(now) {
    ease();
    renderAt(x, y);
    if (dist(x, y, tgt.x, tgt.y) < 10 || now > phaseUntil) {
      roamPhase = "gone";
      phaseUntil = now + 600 + Math.random() * 1700;  // stay hidden a beat
    }
  }
  function goneStep(now) {
    if (now > phaseUntil) beginArrive(now);
  }
  function beginArrive(now) {
    var w = { x: MARGIN + Math.random() * (maxX() - MARGIN),
              y: TOP_CLAMP + Math.random() * (maxY() - TOP_CLAMP) };
    var s = edgePoint(w.x, w.y);   // teleport just off an edge, still invisible
    x = s.x; y = s.y; lean = 0;
    renderAt(x, y);
    pet.style.opacity = "";        // fade back in while sliding on
    tgt = w;
    tgtEase = ARRIVE_EASE;
    roamPhase = "arrive";
    phaseUntil = now + 4500;
  }
  function arriveStep(now) {
    ease();
    bobT += 0.03;
    renderAt(clampX(x + Math.sin(bobT * 0.8) * 4), clampY(y + Math.sin(bobT * 1.1) * 3));
    if (dist(x, y, tgt.x, tgt.y) < 16 || now > phaseUntil) enterDrift(now);
  }

  // --- nap (#6) ---
  function enterNap(now) {
    roamPhase = "nap";
    clearPeek();
    pet.style.opacity = "";          // visible while it settles (napStep dims it)
    tgt = { x: maxX(), y: maxY() };  // settle into the bottom corner
    tgtEase = 0.06;
    pet.className = "pet-nap";       // sleepy closed eyes
    setBoopable(true);
    say(pick(QUIPS.nap));
  }
  function napStep(now) {
    ease();
    renderAt(x, y);
    if (dist(x, y, tgt.x, tgt.y) < 3) {
      pet.style.opacity = "0.2";
      if (now - lastZ > 3200) { lastZ = now; spawnParticle("z", "pet-z"); }
    }
  }
  function wakeFromNap() {
    if (roamPhase !== "nap") return;
    pet.style.opacity = "";
    pet.className = "";
    lastStartle = Date.now();  // don't spin the instant it wakes
    enterDrift(Date.now());
  }

  function stepRoam(now) {
    // Only a settled ghost naps; let transient animations finish first.
    if (cfgNap && (roamPhase === "drift" || roamPhase === "peek" || roamPhase === "read") &&
        now - lastActive > NAP_AFTER)
      enterNap(now);
    switch (roamPhase) {
      case "drift":  driftStep(now);  break;
      case "peek":   peekStep(now);   break;
      case "read":   readStep(now);   break;
      case "spook":  spookStep(now);  break;
      case "nap":    napStep(now);    break;
      case "vanish": vanishStep(now); break;
      case "gone":   goneStep(now);   break;
      case "arrive": arriveStep(now); break;
      case "fling":  flingStep(now);  break;
      case "drag":   /* positioned by pointermove */ break;
    }
  }

  function tick() {
    raf = null;
    var now = Date.now();
    if (drag && drag.moved) { schedule(); return; }
    if (petMode() === "float") {
      if (reduced) renderAt(x, y);  // static in the corner
      else stepRoam(now);
      schedule();
      return;
    }
    // ---- cursor mode: trail behind the pointer, dim-nap when idle ----
    if (cfgNap && !napping && now - lastMove > NAP_AFTER) setNap(true);
    if (napping && now - lastZ > 3000) { lastZ = now; spawnParticle("z", "pet-z"); }
    if (!reduced && !napping && mx !== null) {
      var cx = x + SIZE / 2, cy = y + SIZE / 2;
      var dx = cx - mx, dy = cy - my;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var txp = mx + (dx / d) * TRAIL - SIZE / 2;
      var typ = my + (dy / d) * TRAIL - SIZE / 2;
      var vx = (txp - x) * EASE, vy = (typ - y) * EASE;
      if (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05) { x += vx; y += vy; }
      lean += (vx * 1.6 - lean) * 0.1;
      if (lean > 10) lean = 10;
      if (lean < -10) lean = -10;
      clampCore();
      apply();
    }
    schedule();
  }
  function schedule() {
    if (!document.hidden && petOn() && raf === null) {
      raf = window.requestAnimationFrame(tick);
    }
  }

  // --- mode transitions ---
  function enterRoam() {
    pet.className = "";
    pet.style.opacity = "";
    lastActive = Date.now();
    lastStartle = Date.now();
    if (reduced) { x = maxX(); y = maxY(); renderAt(x, y); return; }
    enterDrift(Date.now());
  }
  function leaveRoam() {
    clearPeek();
    pet.style.opacity = "";
    pet.className = napping ? "pet-nap" : "";
    sprite.style.pointerEvents = "";  // restore the CSS default for cursor mode
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) { lastMove = Date.now(); markActivity(); schedule(); }
  });
  window.addEventListener("twb:pet", function () {
    readCfg();                         // apply size/opacity/quirks live
    var m = petMode();
    if (m === "off") { lastMode = m; return; }   // schedule() parks itself
    // If a quirk toggle turned napping off mid-nap, wake up.
    if (!cfgNap && (napping || roamPhase === "nap")) {
      setNap(false);
      if (roamPhase === "nap") wakeFromNap();
    }
    if (m !== lastMode) {              // only reset the machine on a real mode change
      setNap(false);
      if (m === "float") enterRoam();
      else { leaveRoam(); lastMove = Date.now(); }
    }
    lastMode = m;
    schedule();
  });
  window.addEventListener("resize", function () { clampCore(); apply(); });

  clampCore();
  applyPetColor();
  scheduleBlink();
  if (petMode() === "float") enterRoam();
  else apply();
  readCfg();
  schedule();
})();
