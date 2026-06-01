# Ekman Studios — Developer Guide (Static Virtual Tour Platform) ⚙️

> Developer-focused guide: quick setup, local dev commands, scaffolding, testing, schema validation, and CI snippets to help you add and maintain tours for multiple clients.

---

## Table of contents
1. Overview
2. Quick setup
3. Local development workflow
4. Scaffolding new clients & tours (scripts)
5. Password & security tooling
6. Panoramas & asset pipeline
7. JSON schemas & validation
8. Tests & CI
9. Architecture & extension points
10. Debugging checklist
11. Contributing & roadmap

---

## 1) Overview
This is a lightweight, static-first virtual tour platform. The `engine/` directory contains shared viewer logic and helpers; `clients/` holds client definitions and their tours. The project is intentionally backend-light so it can be served from any static host or CDN.

---

## 2) Quick setup (Windows / PowerShell)
Prerequisites:
- Node.js (14+)
- Python 3 (for tile tooling, optional)

Install dev tools (optional):

```powershell
npm ci
# or install ajv for validation when needed
npx npm-check-updates
```

Run locally (no global install required):

```powershell
# recommended static server
npx http-server -p 8080
# or (dev-mode with file-write support)
npm run start:dev   # serves + enables admin → write to tour.json (localhost only)
# or
npm run start  # if you add the start script
```
Open: `http://localhost:8080/`

---

## 3) Local development workflow (recommended)
1. Scaffold a client (see section below) or edit an existing client in `clients/<slug>/`.
2. Add/edit `tours/<tour-slug>/tour.json` and `index.html`.
3. Add panoramas to `tours/<tour-slug>/panoramas/` and produce tiles when needed.
4. Validate JSON and run unit tests.
5. Start a static server and test in-browser.

Helpful commands:

```powershell
# run local server
npm run start
# validate schemas (ajv)
npx ajv validate -s schemas/tour.schema.json -d clients/*/tours/*/tour.json
# generate tiles for a pano
python scripts/compress_panos.py --input path/to/pano.jpg --output clients/<slug>/tours/<tour>/panoramas/<pano>
```

---

## 4) Scaffolding new clients & tours (scripts)
Add a helper script `scripts/scaffold_client.js` to create a client skeleton and register it in `clients/registry.json`.

Example: `scripts/scaffold_client.js`

```js
// node scripts/scaffold_client.js <client-slug>
const fs = require('fs');
const path = require('path');
const slug = process.argv[2];
if (!slug) throw new Error('Usage: node scaffold_client.js <client-slug>');
const base = path.join(__dirname, '..', 'clients', slug);
fs.mkdirSync(path.join(base, 'tours', 'example'), { recursive: true });
const clientJson = {
  name: slug,
  brand: {},
  passwords: [ { plain: 'demo123', tour: 'example' } ]
};
fs.writeFileSync(path.join(base, 'client.json'), JSON.stringify(clientJson, null, 2));
fs.writeFileSync(path.join(base, 'tours', 'example', 'tour.json'), JSON.stringify({ slug: 'example', title: 'Example Tour', scenes: [] }, null, 2));

// Update registry.json (simple merge)
const registryPath = path.join(__dirname, '..', 'clients', 'registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
registry.clients.push({ slug, name: slug, config: `clients/${slug}/client.json` });
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
console.log('Scaffolded client:', slug);
```

Add to `package.json` scripts:

```json
"scaffold:client": "node scripts/scaffold_client.js"
```

Usage:

```powershell
npm run scaffold:client -- myclient
```

---

## 5) Password & security tooling
For production, only store SHA-256 password hashes in `client.json`.

Important (production readiness):
- `engine/utils.js` may include a temporary client-side SHA-256 fallback for local/insecure dev URLs where `crypto.subtle` is unavailable.
- This fallback is for development compatibility only.
- For production, remove/disable the fallback and require secure verification flow:
  1. run on HTTPS (secure context), and
  2. prefer server-side password verification (recommended) instead of client-only checks.

Quick hash helpers:

- Node one-liner

```bash
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" mypassword
```

- PowerShell

```powershell
[System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes('mypassword'))).Replace('-','').ToLower()
```

Optional helper script `scripts/hash_password.js`:

```js
// node scripts/hash_password.js <password>
console.log(require('crypto').createHash('sha256').update(process.argv[2] || '').digest('hex'));
```

Add to `package.json`:

```json
"hash:pass": "node scripts/hash_password.js"
```

---

## 6) Panoramas & asset pipeline
- Store panoramas as tiled sets for performance and lower memory usage.
- Use `scripts/compress_panos.py` to create tiles compatible with the viewer. Keep consistent naming (e.g. `panoramas/<name>/tiles.json`).
- Optimize images with `sharp` if needed (already present as dependency).

Example tile generation:

```powershell
python scripts/compress_panos.py --input panoramas/large.jpg --output clients/myclient/tours/showroom/panoramas/large
```

---

## 7) JSON schemas & validation
Create `schemas/client.schema.json` and `schemas/tour.schema.json` to enforce structure.

Example validation command (AJV):

```bash
npx ajv validate -s schemas/client.schema.json -d clients/*/client.json
npx ajv validate -s schemas/tour.schema.json -d clients/*/tours/*/tour.json
```

Add `validate:schema` to `package.json`:

```json
"validate:schema": "npx ajv validate -s schemas/tour.schema.json -d clients/*/tours/*/tour.json"
```

---

## 8) Tests & CI
- Use Jest or Mocha for unit tests focused on `engine/security.js`, JSON parsing, and utilities.
- Example GitHub Actions workflow (`.github/workflows/ci.yml`):

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: '18' }
      - run: npm ci
      - run: npm run validate:schema
      - run: npm test
```

---

## 9) Architecture & extension points 🧩
- `engine/viewer.js` — viewer bootstrap and scene loader (primary customization point).
- `engine/hotspot.js` — hotspots API and render helpers.
- `engine/security.js` — password validation and redirect helpers.
- `engine/utils.js` — small utilities and hooks (analytics, logging).

Contracts:
- `tour.json` should contain `slug`, `title`, `scenes[]` where each `scene` has an `id` and `pano` (tiles.json or image).
- `client.json` should contain `name`, `brand`, and `passwords[]` (plain or sha256).

---

## 10) Debugging checklist 🔎
- 404s: verify server root and file paths.
- Blank viewer: check DevTools console for JSON parse errors or missing assets.
- Password redirect issues: verify `client.json` passwords and `clients/registry.json` entries.
- Tile issues: ensure `tiles.json` exists and tiles are reachable.

> Tip: Use `curl -I http://localhost:8080/clients/myclient/tours/showroom/tour.json` to quickly inspect served JSON and headers.

---

## 11) Contributing & roadmap
- Keep changes small and add tests for logic changes.
- Short term: add `clients/example/` with a minimal working tour, add `start` script, provide schema files.
- Medium: add admin scaffolding UI and automated tile generation in CI.

---

## Recommended `package.json` scripts (quick)

```json
"scripts": {
  "start": "npx http-server -p 8080",
  "start:dev": "node scripts/dev-server.js",
  "scaffold:client": "node scripts/scaffold_client.js",
  "hash:pass": "node scripts/hash_password.js",
  "validate:schema": "npx ajv validate -s schemas/tour.schema.json -d clients/*/tours/*/tour.json",
  "test": "jest"
}
```

---

Developer configuration and on-screen overlay

- Location: `engine/developer.js` — central config for all in-viewer developer helpers.
- What it controls:
  - enable flag name (`__DEV_ROLL_HELPER__`), URL enable param (`?dev=cam`), default enable state
  - keyboard step sizes for roll / yaw / pitch / fov
  - overlay default visibility and overlay toggle key
- How to enable dev mode:
  - Console: `window.__DEV_ROLL_HELPER__ = true`
  - URL: add `?dev=cam` to the tour URL
  - Optionally `?devOverlay=1` to force the on-screen overlay
- On-screen overlay:
  - Toggle with `o` (configurable) while dev mode is active
  - Shows current `scene`, `roll`, `yaw`, `pitch`, and `fov`

---

## Keyboard developer helpers (camera + hotspot aids)
A concise developer-facing reference for the in-viewer keyboard controls and how to use them effectively.

How to enable
- Console: window.__DEV_ROLL_HELPER__ = true
- URL: append `?dev=cam` to the tour URL (e.g. `/clients/acme/tours/showroom/?dev=cam`)
- Optional: `?devOverlay=1` forces the on-screen overlay to be visible

Primary keys and behaviour
- Roll: `[` / `]` — adjust scene roll (0.1° small step, 1° with Shift by default)
- Yaw: `ArrowLeft` / `ArrowRight` — rotate camera yaw (0.5° small step, 5° with Shift)
- Pitch: `ArrowUp` / `ArrowDown` — change camera pitch (0.5° small step, 5° with Shift)
- FOV: `-` / `=` (or `+`) — decrease / increase field-of-view (1° small step, 5° with Shift)
- Overlay: `o` — toggle on-screen debug overlay
- Hotspot helper: `h` — toggle hotspot placement helper (click to copy yaw/pitch)
- S: log current scene + roll/yaw/pitch/fov to the console
- **C**: copy current camera values as JSON to clipboard (paste directly into `tour.json`)
- **R**: reset scene camera to `tour.json` defaults (clears saved state)

Persistence across reloads
- Every camera adjustment (roll/yaw/pitch/fov) is **automatically saved to `localStorage`** per scene.
- On reload, if dev mode is active (`?dev=cam`), saved values are restored instead of `tour.json` defaults — your tweaks survive page refreshes.
- Press **R** to discard saved values for the current scene and revert to `tour.json` originals.
- `localStorage` keys use the prefix `ekdev_cam_<sceneKey>`.

Workflow: tuning camera → saving to tour.json
1. Open tour with `?dev=cam`.
2. Use Arrow keys / `[` `]` / `-` `=` to fine-tune the camera.
3. Reload freely — your adjustments persist via `localStorage`.
4. When satisfied, press **C** → values are copied to clipboard as JSON.
5. Paste the JSON values into the scene entry in `tour.json`.
6. Press **R** to clear the saved state for that scene (optional cleanup).

Notes
- Values are applied using `offsetRoll`, `offsetYaw`, `offsetPitch`, `offsetFov` to avoid fighting with drag/inertia.
- On scene switch the helper reads from the Marzipano view so tweaks are continuous across scenes.

Config & customization
- All developer key mappings, step sizes and overlay defaults live in `engine/developer.js`.
- Change `devConfig` values to tweak step sizes or change the overlay toggle key.
- You can enable dev mode per-client by adding a `dev.json` later; ask and I can add that pattern for you.

Example workflow (placing a hotspot and aligning camera)
1. Open tour with `?dev=cam` or set `window.__DEV_ROLL_HELPER__ = true`.
2. Press `h` → click the pano where hotspot should be → coordinates are copied to clipboard.
3. Use Arrow keys / `[` `]` / `-` `=` to fine-tune yaw/pitch/roll/fov while watching the overlay.
4. Press **C** → paste the JSON into the `scene` entry in `tour.json`.
5. Press **R** if you want to discard saved state and start fresh.

---

## Admin Mode

Admin mode provides a GUI settings panel for adjusting per-scene limits (pitch, FOV, drag sensitivity) that apply to all viewers — both admin and customers.

### How it works

1. **Activation**: append `?admin` to any tour URL
2. **Login**: a password dialog appears — enter the admin password configured in `client.json`
3. **Panel**: a draggable settings panel appears (top-left) with controls for the current scene
4. **Persistence**: changes save to `localStorage` (admin key prefix: `ekadmin_limits_`)
5. **Export**: click "Copy All Limits" or "Download JSON" to get values for `tour.json`
6. **Customer view**: limits in `tour.json` apply automatically — no admin panel shown

### Password setup

In `clients/<slug>/client.json`, add:

```json
"adminPassword": {
  "sha256": "<sha256-hex-of-your-password>"
}
```

Generate the hash:
```powershell
node -e "const c=require('crypto');console.log(c.createHash('sha256').update('mypassword').digest('hex'))"
```

### Per-scene limits in tour.json

Each scene can have an optional `limits` block:

```json
{
  "entrance": {
    "image": "panos/entrance.jpeg",
    "roll": -1.3, "yaw": -6.58, "pitch": 1.65, "fov": 57.66,
    "limits": {
      "pitchMin": -1,
      "pitchMax": 3,
      "fovMin": 60,
      "fovMax": 80,
      "dragScale": 1.5
    },
    "hotspots": []
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `pitchMin` | -90 | Minimum pitch in degrees (looking up) |
| `pitchMax` | 90 | Maximum pitch in degrees (looking down) |
| `fovMin` | 30 | Minimum FOV in degrees (max zoom in) |
| `fovMax` | 100 | Maximum FOV in degrees (max zoom out) |
| `dragScale` | 1.0 | Multiplier on drag sensitivity (1.5 = 50% faster) |

### Priority order

1. Admin localStorage override (only when admin is authenticated)
2. `tour.json` scene `limits` block
3. Global defaults (`GLOBAL_MIN_PITCH`, `GLOBAL_MAX_PITCH`, FOV 30–100°)

### Admin panel shortcuts

- **Ctrl+Shift+A**: re-open the admin panel if closed
- All DEV keyboard aids (arrows, `[` `]`, `-` `=`, `h`, `o`, `c`, `r`, `s`) work automatically in admin mode

### Workflow: tuning limits for a client

1. Open tour with `?admin` → enter admin password
2. Navigate to a scene → adjust sliders/values in the panel → "Apply & Save"
3. Repeat for each scene
4. Click "Download JSON" → get `scene-limits.json`
5. Copy the `limits` blocks into each scene in `tour.json`
6. Commit updated `tour.json` — customers now see the tuned limits