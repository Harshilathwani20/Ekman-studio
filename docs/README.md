# Ekman Studios — Static Virtual Tour Platform ✅

**Developer guide:** See `DEVELOPER.md` for a comprehensive developer workflow, scripts, scaffolding steps, schema validation, and CI examples.

## Overview
This repository contains a lightweight, **static-friendly** virtual tour platform designed to host multiple client tours without a complex backend. The codebase is structured so `engine/` contains reusable viewer logic, and each client has a self-contained folder in `clients/` with one or more tours.

---

## Project layout

```
engine/                 # shared viewer and utilities (never client-specific)
  marzipano.js          # placeholder (use real library or CDN) — replaceable
  viewer.js             # viewer bootstrap + scene loader
  hotspot.js            # hotspot helpers
  security.js           # password handling and redirect logic
  utils.js              # common fetch/hash/redirect helpers

clients/                # client-specific data and tours
  registry.json         # central list of active clients
  <client-slug>/
    client.json         # metadata, branding, passwords -> tours
    tours/
      <tour-slug>/
        index.html      # viewer shell that loads <tour-slug>/tour.json
        tour.json       # tour definition (scenes, products, order)
        products.json   # optional product catalogue used by the tour
        panoramas/      # optional local panoramas & tiles
        assets/         # product images, UI assets

assets/                 # site-wide assets (global CSS, fonts)
  css/

index.html              # optional site landing (password entry -> client redirect)
scripts/                # helpful tooling (e.g. tile compressor)
  compress_panos.py
```

---

## Quick start — run locally (Windows / PowerShell)

Use a static server from the project root so client paths resolve correctly.

- Using http-server (no install required):

```powershell
npx http-server -p 8080
# open: http://localhost:8080/
```

- Alternative: `serve` or `live-server`

```powershell
npx serve . -p 8080
npx live-server --port=8080
```

Visit `http://localhost:8080/` and follow the landing page to open a client tour.

---

## How to add a new client (step-by-step) 💡

1. Create a client folder: `clients/<client-slug>/`
2. Add a `client.json` (example below)
3. Create a `tours/<tour-slug>/` folder with `index.html` and `tour.json`
4. Add assets (panoramas, product images) into the tour folder or use shared assets
5. Add the client to `clients/registry.json` using the same `<client-slug>`
6. Run a local static server and test by visiting the landing page or direct path

Example `client.json`:

```json
{
  "name": "Acme Showroom",
  "brand": {
    "logo": "/clients/acme/assets/logo.png",
    "primaryColor": "#0275d8"
  },
  "passwords": [
    { "plain": "demo123", "tour": "showroom" },
    { "sha256": "<hex-sha256>", "tour": "vip-showroom" }
  ]
}
```

Example `tour.json` (minimal):

```json
{
  "slug": "showroom",
  "title": "Main Showroom",
  "scenes": [
    { "id": "entrance", "pano": "panoramas/entrance/tiles.json" },
    { "id": "floor1", "pano": "panoramas/floor1/tiles.json" }
  ],
  "products": "products.json"
}
```

Notes:
- For production, prefer storing password entries with a `sha256` key (hex string) instead of `plain`.
- The viewer (`clients/<slug>/tours/<slug>/index.html`) should load `/clients/<slug>/tours/<slug>/tour.json` and initialize the engine.

---

## Password handling & security 🔒

- Development: `plain` passwords are acceptable for quick testing.
- Production: use `{ "sha256": "<hex>", "tour": "..." }` — compute SHA-256 in your admin tooling and only store the hash.
- The `engine/security.js` file contains helpers to validate hashed/plain passwords and route to the correct tour.
- Always serve over HTTPS in production and set appropriate cache headers on static assets.

---

## Asset pipeline & panoramas

- Panoramas can be stored as tiled image sets (see `scenes/.../tiles/`) or full-resolution panorama images.
- Use `scripts/compress_panos.py` to create tile sets for large panoramas. Example usage:

```powershell
# python 3 required
python scripts/compress_panos.py --input panoramas/acme_main.jpg --output clients/acme/tours/showroom/panoramas/acme_main
```

- Prefer using efficient image formats and cache-friendly headers when deploying to a CDN.

---

## Developer options & where to extend 🔧

- Replace `engine/marzipano.js` with an actual Marzipano build or use a CDN reference.
- `engine/viewer.js` is the single entry point for viewer initialization — hook scene parsing and UI here.
- Hotspots: extend `engine/hotspot.js` to add custom interactions (link to product pages, open modal galleries).
- Add analytics hooks (e.g., track scene changes, hotspot clicks) in `engine/utils.js` or `viewer.js`.
- Add unit tests for JSON validation and `security` helpers using your preferred test runner (Jest, Mocha, etc.).

---

## Developer aids & scripts 🧰

This section lists small CLI snippets and helper scripts that make it fast to develop, test, and publish tours. You can add the example npm scripts below to `package.json` or copy the snippet you need into your shell.

### Recommended npm scripts (example)

Add these under `scripts` in `package.json`:

```json
"scripts": {
  "start": "npx http-server -p 8080",
  "serve": "npx http-server -p 8080",
  "dev:tiles": "python scripts/compress_panos.py --input",
  "hash:pass": "node -e \"console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))\" \"your-password\"",
  "validate:schema": "npx ajv validate -s schemas/tour.schema.json -d clients/*/tours/*/tour.json",
  "scaffold:client": "node scripts/scaffold_client.js"
}
```

Notes:
- `start` / `serve` use a static server so you don't need to globally install anything.
- `dev:tiles` should be combined with the required arguments in local usage (see `scripts/compress_panos.py` docs).
- `hash:pass` prints a SHA-256 hex for storing in `client.json`.

### Quick developer commands

- Run the local site:

```powershell
npx http-server -p 8080
# or
npm run start
```

- Generate SHA-256 of a password (Node):

```bash
node -e "console.log(require('crypto').createHash('sha256').update('demo123').digest('hex'))"
```

- Generate SHA-256 in PowerShell:

```powershell
[System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes('demo123'))).Replace('-','').ToLower()
```

- Build panorama tiles (example):

```powershell
python scripts/compress_panos.py --input panoramas/acme_main.jpg --output clients/acme/tours/showroom/panoramas/acme_main
```

- Validate JSON against schemas (using `ajv`):

```bash
npx ajv validate -s schemas/tour.schema.json -d clients/*/tours/*/tour.json
```

### Developer keyboard helpers (in-viewer tools)

These lightweight dev tools run in the browser viewer and speed up hotspot placement and scene alignment. Configuration now lives in `engine/developer.js` (keyboard mappings, step sizes, overlay defaults). Use `?dev=cam` in the URL or set `window.__DEV_ROLL_HELPER__ = true` to enable the helpers.

- Camera / Roll helper (per-scene roll + camera tweaker)
  - Enable: open browser console and run `window.__DEV_ROLL_HELPER__ = true`
  - Keys (when helper enabled):
    - Roll: `[` / `]` — adjust roll by 0.1° (hold Shift for 1°)
    - Yaw: `ArrowLeft` / `ArrowRight` — adjust yaw by 0.5° (Shift = 5°)
    - Pitch: `ArrowUp` / `ArrowDown` — adjust pitch by 0.5° (Shift = 5°)
    - FOV: `-` / `=` (or `+`) — decrease / increase field of view by 1° (Shift = 5°)
    - `S` — log current scene + roll/yaw/pitch/fov to console
  - Behaviour: updates the active scene's view in real time (roll/yaw/pitch in degrees, FOV in degrees). Values are printed to the console with a short `[DEV cam]` summary.
  - Example console usage:

```js
// enable camera helper
window.__DEV_ROLL_HELPER__ = true;
// then use Arrow keys, [, ], - / = in the viewer
```

- Hotspot placement helper (get yaw/pitch & copy JSON)
  - Toggle: press `h` in the viewer (or call `toggleHelper()` from console if needed)
  - While ON: click anywhere in the panorama to
    1. show a red marker at the clicked location,
    2. log `yaw` and `pitch` to the console (6 decimal places), and
    3. copy a JSON snippet to clipboard like: `"yaw": 0.123456, "pitch": -0.012345`
  - Click the red dot or its `Copy JSON` label to re-copy coordinates.
  - Marker is removed when helper is toggled off.
  - Example workflow:

```text
1. Press `h` → helper ON
2. Click a feature in the pano → coordinates appear and are copied
3. Paste into your `tour.json` hotspot entry
4. Press `h` again to turn helper OFF
```

> Tip: coordinates are printed to the console and copied with 6-decimal precision — paste them directly into the `yaw`/`pitch` fields of your hotspot JSON.

### Helpful helper scripts (examples)

- `scripts/scaffold_client.js` (proposed): create a new client skeleton and add an entry to `clients/registry.json`.

```js
// simple example (sketch)
const fs = require('fs');
const path = require('path');
const slug = process.argv[2];
if (!slug) throw new Error('Usage: node scaffold_client.js <client-slug>');
const base = path.join(__dirname, '..', 'clients', slug);
fs.mkdirSync(path.join(base, 'tours', 'example'), { recursive: true });
fs.writeFileSync(path.join(base, 'client.json'), JSON.stringify({ name: slug }, null, 2));
fs.writeFileSync(path.join(base, 'tours', 'example', 'tour.json'), JSON.stringify({ slug: 'example', title: 'Example Tour', scenes: [] }, null, 2));
console.log('Scaffolded client:', slug);
```

- `scripts/hash_password.js` (one-liner alternative):

```js
// usage: node hash_password.js demo123
console.log(require('crypto').createHash('sha256').update(process.argv[2] || '').digest('hex'));
```

### JSON schema & tests

- Add `schemas/tour.schema.json` and `schemas/client.schema.json` to codify the structure of `tour.json` and `client.json`.
- Use `ajv` or similar in CI to validate every PR for schema compliance.
- Add unit tests (Jest/Mocha) to cover `engine/security.js` and any JSON parsing/validation logic.

### CI / Automation tips

- Create a GitHub Action that runs:
  1. `npm ci` (install dev dependencies)
  2. `npm run validate:schema`
  3. `npm test` (and lint if configured)
  4. Optionally run `scripts/compress_panos.py` on new panoramas in a test job.

### Developer checklist (quick)

- [ ] scaffold a client (or use `clients/example/`)
- [ ] generate SHA-256 passwords and add to `client.json`
- [ ] add panoramas and run tile generator
- [ ] validate JSON with schema validator
- [ ] run local server and test
- [ ] add tests and open a PR

---

## Roadmap (short → long term) 🛣️

---

## Roadmap (short → long term) 🛣️

1. Short term (0–2 weeks) ✅
   - Add a `start` npm script to package.json (e.g., `npx http-server -p 8080`).
   - Add example `clients/example/` that works out-of-the-box.
   - Document `client.json` and `tour.json` schema and validation rules.
2. Medium term (2–8 weeks) ⚙️
   - Add a build pipeline to generate tiles and optimize images automatically.
   - Add a small admin UI for creating clients/tours and producing hashed passwords.
   - Add automated tests and a CI workflow to validate JSON schemas and build steps.
3. Long term (3–6 months) 🚀
   - Publish to S3/CloudFront or serve from a CDN with cache invalidation and versioned assets.
   - Add user authentication + admin roles (optional small backend or serverless functions).
   - Consider a plugin system for different viewer libraries and custom hotspot types.

---

## Troubleshooting & tips

- 404s? Verify the local server root is the project root and that `clients/<slug>/...` paths exist.
- Browser caching: use `Ctrl+F5` or disable cache in DevTools when testing changes.
- JSON schema errors: validate `tour.json` and `client.json` with a JSON linter/validator before testing.

---

## Contributing

- Fork, add features or fix bugs, and open a PR. Provide sample client data for each new feature.

---

## Credits & License

Add license information here (MIT or whichever you prefer).

---

We can also:
1. Add a ready-to-use `clients/example/` with working tour assets and a demo password. ✅
2. Add an npm `start` script to `package.json` to simplify running `npx` commands. ✅

Whats next.
engine/                 # shared, never client-specific
	marzipano.js          # placeholder (use real library or CDN)
	viewer.js             # minimal viewer loader
	hotspot.js            # hotspot helpers (stub)
	security.js           # password verification + redirect
	utils.js              # fetch + hashing + redirects

clients/
	registry.json         # list of available clients
	client-a/
		client.json         # branding + passwords → tours
		tours/
			showroom/
				index.html      # viewer shell
				tour.json       # tour data (scenes/products)

assets/
	css/

index.html              # landing page (password → redirect)
```

Existing assets under `tour/` (e.g., `panoramas/`, `assets/product-images/`) are referenced via absolute paths for now. You can later move them under each tour folder.

### Try It Locally

Use any static server from the project root (so paths like `/clients/...` resolve):

```bash
# Option A: Python 3
python -m http.server 8000

# Option B: Node (if installed)
npx serve . -p 8000
```

Open `http://localhost:8000/` and use password `demo123` to be redirected to the Client A showroom tour.

### Customize
- Add more clients: create `clients/<slug>/client.json` and add entry to `clients/registry.json`.
- Map passwords to tours: in `client.json`, add entries under `passwords`.
- Prefer hashed passwords for production: store `{ "sha256": "<hex>", "tour": "..." }` and remove `plain`.
- Viewer: expand `engine/viewer.js` to use Marzipano or your preferred library.
# ekmanstudios1
