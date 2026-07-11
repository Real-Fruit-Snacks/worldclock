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
    homeDelta: function (date, zone, home) {
      var d = WC.time.offsetMinutes(date, zone) - WC.time.offsetMinutes(date, home);
      var label;
      if (d === 0) label = "±0h";
      else {
        var sign = d > 0 ? "+" : "-", a = Math.abs(d);
        var h = Math.floor(a / 60), rem = a % 60;
        label = sign + h + (rem ? fracLabel(rem) : "") + "h";
      }
      var zd = dateFmt(zone).format(date), hd = dateFmt(home).format(date);
      var dayRel = "today";
      if (zd > hd) dayRel = "tomorrow";
      else if (zd < hd) dayRel = "yesterday";
      return { minutes: d, label: label, dayRel: dayRel };
    },
    format12: function (h) {
      return { h12: (h % 12) || 12, ampm: h < 12 ? "AM" : "PM" };
    }
  };
})();
