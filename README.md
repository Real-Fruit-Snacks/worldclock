# World Clock

A fully offline world clock in the
[terminal-workbench](https://github.com/Real-Fruit-Snacks/terminal-workbench-design-system)
style. Auto-detects your timezone, shows clocks for any IANA zone, and draws
a live day/night terminator on a world map. Includes the pet ghost.

**No network, no dependencies, no build step.** All timezone math is the
browser's own `Intl` database; map and coordinates are committed data
(Natural Earth + tzdb, both public domain).

## Run

Open `index.html`. That's it — works from `file://`.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Source: `main` branch, `/ (root)`.

## Develop

- `tests.html` — in-browser test suite (open it; expect `FAIL 0`).
- `tools/gen_zones.py` / `tools/gen_map.py` — one-time generators for
  `js/zones.js` and `js/mapdata.js`; re-run only to refresh source data in
  `tools/reference/`.

## Credits

- Design tokens: [terminal-workbench-design-system](https://github.com/Real-Fruit-Snacks/terminal-workbench-design-system) (MIT)
- Pet ghost: ported from [vault](https://github.com/Real-Fruit-Snacks/vault) (MIT)
- Land polygons: Natural Earth via world-atlas (public domain)
- Zone coordinates: IANA tzdb `zone1970.tab` (public domain)
