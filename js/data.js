/* Static site data: aliases, curated suggestions, name helpers. */
(function () {
  "use strict";
  window.WC = window.WC || {};

  /* Common shorthand people type -> IANA zone. Keys lowercase. */
  WC.ALIASES = {
    "nyc": "America/New_York", "new york city": "America/New_York",
    "la": "America/Los_Angeles", "sf": "America/Los_Angeles",
    "san francisco": "America/Los_Angeles", "seattle": "America/Los_Angeles",
    "dc": "America/New_York", "boston": "America/New_York",
    "miami": "America/New_York", "atlanta": "America/New_York",
    "dallas": "America/Chicago", "houston": "America/Chicago",
    "gmt": "UTC", "zulu": "UTC", "z": "UTC",
    "beijing": "Asia/Shanghai", "peking": "Asia/Shanghai",
    "mumbai": "Asia/Kolkata", "delhi": "Asia/Kolkata",
    "bangalore": "Asia/Kolkata", "calcutta": "Asia/Kolkata",
    "osaka": "Asia/Tokyo", "kyoto": "Asia/Tokyo",
    "melbourne": "Australia/Melbourne", "canberra": "Australia/Sydney",
    "sao paulo": "America/Sao_Paulo", "rio": "America/Sao_Paulo",
    "cdmx": "America/Mexico_City", "mexico city": "America/Mexico_City",
    "moscow": "Europe/Moscow", "st petersburg": "Europe/Moscow",
    "frankfurt": "Europe/Berlin", "munich": "Europe/Berlin",
    "milan": "Europe/Rome", "barcelona": "Europe/Madrid",
    "manchester": "Europe/London", "edinburgh": "Europe/London",
    "geneva": "Europe/Zurich", "vienna": "Europe/Vienna",
    "tel aviv": "Asia/Jerusalem", "abu dhabi": "Asia/Dubai",
    "hanoi": "Asia/Ho_Chi_Minh", "saigon": "Asia/Ho_Chi_Minh"
  };

  WC.SUGGESTED = [
    "UTC", "America/New_York", "America/Chicago", "America/Denver",
    "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin",
    "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Hong_Kong",
    "Asia/Tokyo", "Australia/Sydney"
  ];

  WC.DEFAULT_ZONES = [
    "UTC", "America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney"
  ];

  WC.cityName = function (zone) {
    var seg = zone.split("/").pop();
    return seg.replace(/_/g, " ");
  };

  WC.allZones = function () {
    var zones = [];
    if (typeof Intl.supportedValuesOf === "function") {
      try { zones = Intl.supportedValuesOf("timeZone"); }
      catch (e) { /* fall through */ }
    }
    if (!zones.length) zones = Object.keys(WC.ZONES);
    var seen = {};
    for (var i = 0; i < zones.length; i++) seen[zones[i]] = 1;
    var zoneKeys = Object.keys(WC.ZONES);
    for (var j = 0; j < zoneKeys.length; j++)
      if (!seen[zoneKeys[j]]) zones.push(zoneKeys[j]);
    if (!seen["UTC"]) zones.push("UTC");
    return zones;
  };
})();
