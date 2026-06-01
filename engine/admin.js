// ─────────────────────────────────────────────────────────────────────
// admin.js – Admin mode for Ekman Studios virtual tour viewer
// ─────────────────────────────────────────────────────────────────────
//
// Provides:
//   1. Admin login (password prompt, SHA-256 verification against client.json)
//   2. Floating settings panel to adjust per-scene limits in real-time
//   3. Runtime scene config adjustments (no persistence)
//   4. Export / download of scene configs for pasting into tour.json
//   5. All DEV keyboard aids enabled automatically in admin mode
//
// Activation:
//   Append ?admin to the tour URL → password dialog shown → on success
//   admin mode is active for the session.
// ─────────────────────────────────────────────────────────────────────

import { fetchJson, sha256Hex, isTypingIntoForm } from './utils.js';

// ── State ────────────────────────────────────────────────────────────
let _authenticated = false;
let _panel = null;          // admin panel DOM element
let _viewer = null;         // { viewer, scenesMap, switchScene, getCurrentKey, tour, toRad, smoothCam, buildScene, renderHotspots }
let _originalScenes = null;
let _onLimitsChanged = null; // callback from viewer when limits are updated

// ── Public API ───────────────────────────────────────────────────────

/** Check if URL has ?admin param */
export function isAdminRequested() {
    try {
        return new URLSearchParams(window.location.search).has('admin');
    } catch (_) { return false; }
}

/** True if already authenticated this session */
export function isAdminMode() {
    return _authenticated;
}

/**
 * Initialise admin module. Call after tour loads.
 * @param {Object} ctx - context from viewer:
 *   { viewer, scenesMap, switchScene, getCurrentKey, tour, toRad, smoothCam,
 *     buildScene, renderHotspots, scenes, GLOBAL_MIN_PITCH, GLOBAL_MAX_PITCH }
 * @param {Function} onLimitsChanged - callback(sceneKey, limits) when admin edits limits
 */
export function initAdmin(ctx, onLimitsChanged) {
    _viewer = ctx;
    _originalScenes = ctx.originalScenes || null;
    _onLimitsChanged = onLimitsChanged;

    if (isAdminRequested()) {
        _showLoginDialog();
    } else {
        _authenticated = false;
    }
}

/** Get effective hotspots (tour data only) */
export function getEffectiveHotspots(sceneKey, sceneData) {
    void sceneKey;
    return sceneData?.hotspots || [];
}

/**
 * Get effective limits for a scene. Priority:
 *   1. tour.json scene.limits (mutated at runtime)
 *   2. Global defaults
 */
export function getEffectiveLimits(sceneKey, sceneData, globalMinPitch, globalMaxPitch) {
    const defaults = {
        pitchMin: globalMinPitch * 180 / Math.PI,   // degrees
        pitchMax: globalMaxPitch * 180 / Math.PI,
        yawMin: -180,
        yawMax:  180,
        fovMin: 30,
        fovMax: 100,
        dragScale: 1.0
    };

    // Layer 1: tour.json limits
    const tourLimits = sceneData?.limits || {};
    return { ...defaults, ...tourLimits };
}

/**
 * Get effective initial camera values for a scene.
 * Falls back to defaults if a scene omits them.
 */
export function getEffectiveInitials(sceneKey, sceneData, toRad) {
    const defaults = {
        yaw:   sceneData?.yaw   ?? 0,
        pitch: sceneData?.pitch ?? 0,
        roll:  sceneData?.roll  ?? 0,
        fov:   sceneData?.fov   ?? toRad(90) // radians in tour.json
    };
    void sceneKey;
    return defaults;
}

// ── Login dialog ─────────────────────────────────────────────────────

function _showLoginDialog() {
    const overlay = document.createElement('div');
    overlay.id = 'admin-login-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '30000',
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
        background: '#1e1e2e', borderRadius: '12px', padding: '32px 40px',
        color: '#fff', fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)', minWidth: '320px', textAlign: 'center'
    });

    box.innerHTML = `
      <h2 style="margin:0 0 8px;font-size:1.3rem;font-weight:700;">Admin Login</h2>
      <p style="margin:0 0 20px;font-size:0.85rem;color:#999;">Enter admin password to access settings panel</p>
      <input id="admin-pwd" type="password" placeholder="Password"
        style="width:100%;padding:10px 14px;border:1px solid #444;border-radius:6px;
               background:#111;color:#fff;font-size:1rem;outline:none;box-sizing:border-box;" />
      <div id="admin-err" style="color:#f66;font-size:0.8rem;margin-top:8px;min-height:1.2em;"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="admin-cancel" style="flex:1;padding:10px;border:1px solid #555;border-radius:6px;
                background:transparent;color:#aaa;cursor:pointer;font-size:0.9rem;">Cancel</button>
        <button id="admin-submit" style="flex:1;padding:10px;border:none;border-radius:6px;
                background:#2a6cf6;color:#fff;cursor:pointer;font-size:0.9rem;font-weight:600;">Login</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const pwdInput = box.querySelector('#admin-pwd');
    const errDiv = box.querySelector('#admin-err');
    const submitBtn = box.querySelector('#admin-submit');
    const cancelBtn = box.querySelector('#admin-cancel');

    pwdInput.focus();

    async function tryLogin() {
        const pwd = pwdInput.value.trim();
        if (!pwd) { errDiv.textContent = 'Enter a password.'; return; }
        errDiv.textContent = 'Verifying…';
        submitBtn.disabled = true;

        const ok = await _verifyAdminPassword(pwd);
        if (ok) {
            _authenticated = true;
            overlay.remove();
            _activateAdmin();
        } else {
            errDiv.textContent = 'Invalid admin password.';
            submitBtn.disabled = false;
            pwdInput.select();
        }
    }

    submitBtn.addEventListener('click', tryLogin);
    pwdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
    cancelBtn.addEventListener('click', () => overlay.remove());
}

async function _verifyAdminPassword(password) {
    try {
        // Determine client config path from current URL
        // URL pattern: /clients/<slug>/tours/<tour>/
        const parts = window.location.pathname.split('/');
        const clientsIdx = parts.indexOf('clients');
        if (clientsIdx < 0) return false;
        const slug = parts[clientsIdx + 1];

        const registry = await fetchJson('/clients/registry.json');
        const client = (registry.clients || []).find(c => c.slug === slug);
        if (!client) return false;

        const cfg = await fetchJson('/' + client.config);
        if (!cfg.adminPassword) return false;

        const hash = await sha256Hex(password);

        // Support { sha256: "..." } or { plain: "..." }
        if (cfg.adminPassword.sha256) {
            return cfg.adminPassword.sha256.toLowerCase() === hash.toLowerCase();
        }
        if (cfg.adminPassword.plain) {
            return cfg.adminPassword.plain === password;
        }
        return false;
    } catch (e) {
        console.error('[admin] Password verification failed:', e);
        return false;
    }
}

// ── Activate admin mode ──────────────────────────────────────────────

function _activateAdmin() {
    console.log('[admin] Admin mode activated');
    // Show DEV panel alongside admin panel
    if (_viewer.showDevOverlay) _viewer.showDevOverlay(true);
    // Build and show admin panel
    _createPanel();
}

// ── Admin settings panel ─────────────────────────────────────────────

function _createPanel() {
    if (_panel) return;

    _panel = document.createElement('div');
    _panel.id = 'admin-panel';
    Object.assign(_panel.style, {
        position: 'fixed', left: '12px', top: '12px', zIndex: '25000',
        background: 'rgba(20,20,35,0.5)', color: '#fff',
        fontFamily: 'system-ui, sans-serif', fontSize: '20px',
        padding: '0', borderRadius: '12px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
        minWidth: '300px', maxWidth: '360px',
        maxHeight: 'calc(100vh - 24px)', overflowY: 'auto',
        backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.08)',
        transition: 'opacity 0.2s', userSelect: 'none'
    });

    _panel.innerHTML = _buildPanelHTML();
    document.body.appendChild(_panel);

    _wirePanel();
    _updatePanelForScene(_viewer.getCurrentKey());
}

function _buildPanelHTML() {
    return `
      <div id="ap-header" style="padding:12px 18px;display:flex;align-items:center;justify-content:space-between;
           border-bottom:1px solid rgba(255,255,255,0.08);cursor:move;">
        <span style="font-weight:700;font-size:21px;color:#fff;">🔧 Admin Panel</span>
        <div style="display:flex;gap:8px;">
          <button id="ap-minimize" style="background:none;border:none;color:#fff;cursor:pointer;font-size:24px;"
                  title="Minimize">−</button>
          <button id="ap-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:24px;"
                  title="Close panel">×</button>
        </div>
      </div>
      <div id="ap-body" style="padding:15px 18px;">
        <div style="margin-bottom:12px;font-size:16px;color:#fff;">
          Scene: <strong id="ap-scene" style="color:#6af;">—</strong>
        </div>

        <!-- Pitch limits -->
        <fieldset style="border:1px solid #333;border-radius:6px;padding:10px 12px;margin:0 0 10px;">
          <legend style="font-size:16px;color:#fff;padding:0 4px;">Pitch limits (degrees)</legend>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:16px;color:#fff;min-width:38px;">Min</span>
            <input id="ap-pitchMin" type="range" min="-90" max="0" step="0.5" style="flex:1;accent-color:#2a6cf6;height:6px;" />
            <span id="ap-pitchMinVal" style="min-width:54px;text-align:right;font-size:18px;color:#fff;">-90°</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:16px;color:#fff;min-width:38px;">Max</span>
            <input id="ap-pitchMax" type="range" min="0" max="90" step="0.5" style="flex:1;accent-color:#2a6cf6;height:6px;" />
            <span id="ap-pitchMaxVal" style="min-width:54px;text-align:right;font-size:18px;color:#fff;">90°</span>
          </div>
        </fieldset>

        <!-- Yaw limits -->
        <fieldset style="border:1px solid #333;border-radius:6px;padding:10px 12px;margin:0 0 10px;">
          <legend style="font-size:16px;color:#fff;padding:0 4px;">Yaw limits (degrees)</legend>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:16px;color:#fff;min-width:38px;">Min</span>
            <input id="ap-yawMin" type="range" min="-180" max="0" step="1" style="flex:1;accent-color:#2a6cf6;height:6px;" />
            <span id="ap-yawMinVal" style="min-width:54px;text-align:right;font-size:18px;color:#fff;">-180°</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:16px;color:#fff;min-width:38px;">Max</span>
            <input id="ap-yawMax" type="range" min="0" max="180" step="1" style="flex:1;accent-color:#2a6cf6;height:6px;" />
            <span id="ap-yawMaxVal" style="min-width:54px;text-align:right;font-size:18px;color:#fff;">180°</span>
          </div>
        </fieldset>

        <!-- FOV limits -->
        <fieldset style="border:1px solid #333;border-radius:6px;padding:10px 12px;margin:0 0 10px;">
          <legend style="font-size:16px;color:#fff;padding:0 4px;">FOV / Zoom limits (degrees)</legend>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:16px;color:#fff;min-width:68px;">Zoom in</span>
            <input id="ap-fovMin" type="range" min="10" max="90" step="1" style="flex:1;accent-color:#2a6cf6;height:6px;" />
            <span id="ap-fovMinVal" style="min-width:46px;text-align:right;font-size:18px;color:#fff;">30°</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:16px;color:#fff;min-width:68px;">Zoom out</span>
            <input id="ap-fovMax" type="range" min="30" max="120" step="1" style="flex:1;accent-color:#2a6cf6;height:6px;" />
            <span id="ap-fovMaxVal" style="min-width:46px;text-align:right;font-size:18px;color:#fff;">100°</span>
          </div>
        </fieldset>

        <!-- Drag scale -->
        <fieldset style="border:1px solid #333;border-radius:6px;padding:10px 12px;margin:0 0 10px;">
          <legend style="font-size:16px;color:#fff;padding:0 4px;">Drag sensitivity</legend>
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="ap-dragSlider" type="range" min="0.2" max="3.0" step="0.1"
              style="flex:1;accent-color:#2a6cf6;height:6px;" />
            <span id="ap-dragVal" style="min-width:46px;text-align:right;font-size:18px;color:#fff;">1.0×</span>
          </div>
        </fieldset>

        <!-- Initial camera values -->
        <fieldset style="border:1px solid #333;border-radius:6px;padding:10px 12px;margin:0 0 10px;">
          <legend style="font-size:16px;color:#fff;padding:0 4px;">Initial camera (scene start)</legend>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:16px;color:#fff;min-width:46px;">Yaw</span>
            <input id="ap-initYaw" type="range" min="-3.14159" max="3.14159" step="0.01" style="flex:1;accent-color:#2a6cf6;height:6px;" />
            <span id="ap-initYawVal" style="min-width:60px;text-align:right;font-size:18px;color:#fff;">0</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:16px;color:#fff;min-width:46px;">Pitch</span>
            <input id="ap-initPitch" type="range" min="-1.5708" max="1.5708" step="0.01" style="flex:1;accent-color:#2a6cf6;height:6px;" />
            <span id="ap-initPitchVal" style="min-width:60px;text-align:right;font-size:18px;color:#fff;">0</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:16px;color:#fff;min-width:46px;">Roll</span>
                        <input id="ap-initRoll" type="range" min="-3.14159" max="3.14159" step="0.01" style="flex:1;accent-color:#2a6cf6;height:6px;" />
                        <span id="ap-initRollVal" style="min-width:60px;text-align:right;font-size:18px;color:#fff;">0°</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <span style="font-size:16px;color:#fff;min-width:46px;">FOV</span>
            <input id="ap-initFov" type="range" min="0.35" max="2.09" step="0.01" style="flex:1;accent-color:#2a6cf6;height:6px;" />
            <span id="ap-initFovVal" style="min-width:60px;text-align:right;font-size:18px;color:#fff;">1.571</span>
          </div>
          <button id="ap-useView" style="width:100%;padding:9px;border:1px solid #2a6cf6;border-radius:5px;
                  background:rgba(42,108,246,0.15);color:#6af;cursor:pointer;font-size:16px;font-weight:600;">
            📷 Use Current View</button>
        </fieldset>

        <!-- Action buttons -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="ap-apply" style="flex:1;padding:10px;border:none;border-radius:6px;
                  background:#2a6cf6;color:#fff;cursor:pointer;font-size:18px;font-weight:600;">
            Apply & Save</button>
          <button id="ap-reset" style="flex:1;padding:10px;border:1px solid #555;border-radius:6px;
                  background:transparent;color:#fff;cursor:pointer;font-size:18px;">
            Reset to JSON</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button id="ap-export" style="flex:1;padding:10px;border:1px solid #555;border-radius:6px;
                  background:transparent;color:#fff;cursor:pointer;font-size:18px;">
            📋 Copy All</button>
          <button id="ap-download" style="flex:1;padding:10px;border:1px solid #555;border-radius:6px;
                  background:transparent;color:#fff;cursor:pointer;font-size:18px;">
            💾 Download JSON</button>
        </div>

        <!-- Hotspot Placement -->
        <fieldset style="border:1px solid #333;border-radius:6px;padding:10px 12px;margin:10px 0 0;">
          <legend style="font-size:16px;color:#fff;padding:0 4px;">Hotspot Placement</legend>
          <div style="font-size:13px;color:#fff;opacity:0.6;margin-bottom:8px;">Press <span style='color:#6cf;'>H</span> then click on the pano to capture position</div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:14px;color:#fff;min-width:38px;">Yaw</span>
            <input id="ap-hsYaw" type="number" step="0.000001" style="flex:1;padding:5px 6px;background:#111;border:1px solid #444;border-radius:4px;color:#fff;font-size:14px;" value="0" />
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:14px;color:#fff;min-width:38px;">Pitch</span>
            <input id="ap-hsPitch" type="number" step="0.000001" style="flex:1;padding:5px 6px;background:#111;border:1px solid #444;border-radius:4px;color:#fff;font-size:14px;" value="0" />
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:14px;color:#fff;min-width:38px;">Type</span>
            <select id="ap-hsType" style="flex:1;padding:5px 6px;background:#111;border:1px solid #444;border-radius:4px;color:#fff;font-size:14px;">
              <option value="link">Link (go to scene)</option>
              <option value="product">Product</option>
              <option value="bubble">Bubble (info)</option>
            </select>
          </div>
          <div id="ap-hsTargetRow" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:14px;color:#fff;min-width:38px;">Target</span>
            <select id="ap-hsTarget" style="flex:1;padding:5px 6px;background:#111;border:1px solid #444;border-radius:4px;color:#fff;font-size:14px;"></select>
          </div>
          <div id="ap-hsOrientRow" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <span style="font-size:14px;color:#fff;min-width:38px;">Orient</span>
            <select id="ap-hsOrient" style="flex:1;padding:5px 6px;background:#111;border:1px solid #444;border-radius:4px;color:#fff;font-size:14px;">
              <option value="floor">Floor</option>
              <option value="wall">Wall</option>
            </select>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <span style="font-size:14px;color:#fff;min-width:38px;">Label</span>
            <input id="ap-hsLabel" type="text" placeholder="optional" style="flex:1;padding:5px 6px;background:#111;border:1px solid #444;border-radius:4px;color:#fff;font-size:14px;" />
          </div>
          <button id="ap-hsAdd" style="width:100%;padding:9px;border:none;border-radius:5px;
                  background:#2a6cf6;color:#fff;cursor:pointer;font-size:16px;font-weight:600;">
            ➕ Add Hotspot</button>
          <div id="ap-hsList" style="margin-top:8px;max-height:150px;overflow-y:auto;"></div>
        </fieldset>

        <div id="ap-status" style="margin-top:10px;font-size:16px;color:#4a4;min-height:1.3em;text-align:center;"></div>
        <div style="margin-top:8px;font-size:13px;color:#fff;text-align:center;opacity:0.6;">
          <span style="color:#6cf;">Ctrl+Shift+A</span> toggle panel
        </div>
      </div>
    `;
}

function _wirePanel() {
    const $ = (sel) => _panel.querySelector(sel);
    const radToDeg = (val) => (val * 180 / Math.PI);

    // Minimize
    let minimized = false;
    $('#ap-minimize').addEventListener('click', () => {
        minimized = !minimized;
        $('#ap-body').style.display = minimized ? 'none' : 'block';
        $('#ap-minimize').textContent = minimized ? '+' : '−';
    });

    // Close
    $('#ap-close').addEventListener('click', () => {
        _panel.style.display = 'none';
    });

    // Wire all sliders with live value display
    const _sliderPairs = [
        ['#ap-pitchMin',  '#ap-pitchMinVal',  v => v + '°'],
        ['#ap-pitchMax',  '#ap-pitchMaxVal',  v => v + '°'],
        ['#ap-yawMin',    '#ap-yawMinVal',    v => v + '°'],
        ['#ap-yawMax',    '#ap-yawMaxVal',    v => v + '°'],
        ['#ap-fovMin',    '#ap-fovMinVal',    v => v + '°'],
        ['#ap-fovMax',    '#ap-fovMaxVal',    v => v + '°'],
        ['#ap-dragSlider','#ap-dragVal',       v => parseFloat(v).toFixed(1) + '×'],
        ['#ap-initYaw',   '#ap-initYawVal',    v => parseFloat(v).toFixed(4)],
        ['#ap-initPitch',  '#ap-initPitchVal', v => parseFloat(v).toFixed(4)],
        ['#ap-initRoll',   '#ap-initRollVal',  v => radToDeg(parseFloat(v)).toFixed(1) + '°'],
        ['#ap-initFov',    '#ap-initFovVal',   v => parseFloat(v).toFixed(3)]
    ];
    for (const [slider, label, fmt] of _sliderPairs) {
        $(slider).addEventListener('input', () => {
            $(label).textContent = fmt($(slider).value);
        });
    }

    // Use Current View — grab live camera values into the initial sliders
    $('#ap-useView').addEventListener('click', () => {
        if (!_viewer) return;
        const key = _viewer.getCurrentKey();
        const built = _viewer.scenesMap[key];
        if (!built) return;
        const p = built.view.parameters();
        const toDeg = (r) => (r * 180 / Math.PI);
        _setSlider('#ap-initYaw',   p.yaw,            v => parseFloat(v).toFixed(4));
        _setSlider('#ap-initPitch',  p.pitch,          v => parseFloat(v).toFixed(4));
        _setSlider('#ap-initRoll',   p.roll,           v => radToDeg(parseFloat(v)).toFixed(1) + '°');
        _setSlider('#ap-initFov',    p.fov,            v => parseFloat(v).toFixed(3));
        _showStatus('Captured current view ✓');
    });

    function _setSlider(sliderSel, value, fmt) {
        const s = $(sliderSel);
        s.value = value;
        // find matching label from pairs
        const pair = _sliderPairs.find(p => p[0] === sliderSel);
        if (pair) $(pair[1]).textContent = fmt(value);
    }

    // Apply & Save
    $('#ap-apply').addEventListener('click', () => _applyLimits());

    // Reset to tour.json
    $('#ap-reset').addEventListener('click', () => _resetLimits());

    // Copy all limits
    $('#ap-export').addEventListener('click', () => _exportAll());

    // Download JSON
    $('#ap-download').addEventListener('click', () => _downloadAll());

    // ── Hotspot type change → show/hide target & orientation rows ─────
    const _hsType = $('#ap-hsType');
    const _hsTargetRow = $('#ap-hsTargetRow');
    const _hsOrientRow = $('#ap-hsOrientRow');
    function _syncHsTypeRows() {
        const t = _hsType.value;
        _hsTargetRow.style.display = (t === 'link') ? 'flex' : 'none';
        _hsOrientRow.style.display = (t === 'link') ? 'flex' : 'none';
    }
    _hsType.addEventListener('change', _syncHsTypeRows);
    _syncHsTypeRows();

    // Populate target scene dropdown
    _populateTargetScenes();

    // Add hotspot
    $('#ap-hsAdd').addEventListener('click', () => _addHotspot());

    // Render current hotspot list
    _renderHotspotList();

    // Make panel draggable
    _makeDraggable(_panel, $('#ap-header'));

    // Toggle with Ctrl+Shift+A
    document.addEventListener('keydown', (e) => {
        if (isTypingIntoForm(e)) return;
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a' && _authenticated) {
            e.preventDefault();
            const visible = _panel.style.display !== 'none';
            _panel.style.display = visible ? 'none' : 'block';
        }
    });
}

function _updatePanelForScene(sceneKey) {
    if (!_panel || !_viewer) return;
    const $ = (sel) => _panel.querySelector(sel);

    // Prefer the built scene data (if the scene has already been loaded/built),
    // otherwise fall back to the tour-level scene entry.
    const built = _viewer.scenesMap && _viewer.scenesMap[sceneKey];
    const sceneData = built?.data ?? _viewer.scenes[sceneKey];

    const limits = getEffectiveLimits(
        sceneKey, sceneData,
        _viewer.GLOBAL_MIN_PITCH, _viewer.GLOBAL_MAX_PITCH
    );
    const initials = getEffectiveInitials(sceneKey, sceneData, _viewer.toRad);

    $('#ap-scene').textContent = sceneKey;

    // Set all sliders + their displayed values
    _setSV('#ap-pitchMin',  '#ap-pitchMinVal',  limits.pitchMin,   v => v + '°');
    _setSV('#ap-pitchMax',  '#ap-pitchMaxVal',  limits.pitchMax,   v => v + '°');
    _setSV('#ap-yawMin',    '#ap-yawMinVal',    limits.yawMin,     v => v + '°');
    _setSV('#ap-yawMax',    '#ap-yawMaxVal',    limits.yawMax,     v => v + '°');
    _setSV('#ap-fovMin',    '#ap-fovMinVal',    limits.fovMin,     v => v + '°');
    _setSV('#ap-fovMax',    '#ap-fovMaxVal',    limits.fovMax,     v => v + '°');
    _setSV('#ap-dragSlider','#ap-dragVal',       limits.dragScale,  v => parseFloat(v).toFixed(1) + '×');

    // Initial camera values
    const iy = initials.yaw ?? 0;
    const ip = initials.pitch ?? 0;
    const ir = initials.roll ?? 0;
    const ifov = initials.fov ?? _viewer.toRad(90);
    _setSV('#ap-initYaw',   '#ap-initYawVal',   iy,   v => parseFloat(v).toFixed(4));
    _setSV('#ap-initPitch',  '#ap-initPitchVal', ip,   v => parseFloat(v).toFixed(4));
    _setSV('#ap-initRoll',   '#ap-initRollVal',  ir,   v => parseFloat(v).toFixed(1) + '°');
    _setSV('#ap-initFov',    '#ap-initFovVal',   ifov, v => parseFloat(v).toFixed(3));

    $('#ap-status').textContent = '';

    // Refresh hotspot list and target scenes dropdown
    _populateTargetScenes();
    _renderHotspotList();

    /** helper: set slider value + display label */
    function _setSV(sliderSel, labelSel, value, fmt) {
        $(sliderSel).value = value;
        $(labelSel).textContent = fmt(value);
    }
}

function _readPanelValues() {
    const $ = (sel) => _panel.querySelector(sel);

    function numOr(val, fallback) {
        const n = parseFloat(val);
        return Number.isFinite(n) ? n : fallback;
    }

    return {
        limits: {
            pitchMin:  numOr($('#ap-pitchMin').value, -90),
            pitchMax:  numOr($('#ap-pitchMax').value, 90),
            yawMin:    numOr($('#ap-yawMin').value, -180),
            yawMax:    numOr($('#ap-yawMax').value, 180),
            fovMin:    numOr($('#ap-fovMin').value, 30),
            fovMax:    numOr($('#ap-fovMax').value, 100),
            dragScale: numOr($('#ap-dragSlider').value, 1.0)
        },
        initials: {
            yaw:   numOr($('#ap-initYaw').value, 0),
            pitch: numOr($('#ap-initPitch').value, 0),
            roll:  numOr($('#ap-initRoll').value, 0),
            fov:   numOr($('#ap-initFov').value, 1.5708)  // ~90° in radians
        }
    };
}

function _applyLimits() {
    if (!_viewer) return;
    const key = _viewer.getCurrentKey();
    const { limits, initials } = _readPanelValues();
    const sceneData = _viewer.scenes[key];
    if (!sceneData) {
        _showStatus('Scene missing in tour data');
        return;
    }

    // --- Normalize & validate limits (prevent inverted ranges / out-of-bounds)
    let normalized = false;

    // Clamp pitch to [-90, 90]
    limits.pitchMin = Math.max(-90, Math.min(90, limits.pitchMin));
    limits.pitchMax = Math.max(-90, Math.min(90, limits.pitchMax));
    if (limits.pitchMin > limits.pitchMax) { const t = limits.pitchMin; limits.pitchMin = limits.pitchMax; limits.pitchMax = t; normalized = true; }

    // Yaw range
    limits.yawMin = Math.max(-180, Math.min(180, limits.yawMin));
    limits.yawMax = Math.max(-180, Math.min(180, limits.yawMax));
    if (limits.yawMin > limits.yawMax) { const t = limits.yawMin; limits.yawMin = limits.yawMax; limits.yawMax = t; normalized = true; }

    // FOV
    limits.fovMin = Math.max(10, Math.min(120, limits.fovMin));
    limits.fovMax = Math.max(10, Math.min(120, limits.fovMax));
    if (limits.fovMin > limits.fovMax) { const t = limits.fovMin; limits.fovMin = limits.fovMax; limits.fovMax = t; normalized = true; }

    // Drag scale reasonable bounds (matches slider)
    limits.dragScale = Math.max(0.2, Math.min(3.0, limits.dragScale));

    sceneData.limits = { ...limits };
    sceneData.yaw = initials.yaw;
    sceneData.pitch = initials.pitch;
    sceneData.roll = initials.roll;
    sceneData.fov = initials.fov;

    if (_viewer.scenesMap && _viewer.scenesMap[key]) {
        _viewer.scenesMap[key].data = sceneData;
    }

    // Notify viewer to rebuild scene with new limits + initials
    if (_onLimitsChanged) _onLimitsChanged(key, limits);

    _showStatus(normalized ? 'Applied (normalized) ✓' : 'Applied limits + initials ✓');
    console.log(`[admin] Applied for "${key}":`, { limits, initials, normalized });
}

function _resetLimits() {
    if (!_viewer) return;
    const key = _viewer.getCurrentKey();
    const snapshot = _originalScenes?.[key];
    if (!snapshot) {
        _showStatus('No baseline snapshot available');
        return;
    }

    const cloned = JSON.parse(JSON.stringify(snapshot));
    _viewer.scenes[key] = cloned;
    if (_viewer.scenesMap && _viewer.scenesMap[key]) {
        _viewer.scenesMap[key].data = cloned;
    }

    if (_onLimitsChanged) {
        _onLimitsChanged(key, cloned.limits || null);
    }

    _rerenderSceneHotspots(key);
    _updatePanelForScene(key);
    _showStatus('Reset to tour data ✓');
    console.log(`[admin] Reset "${key}" to original tour data`);
}

function _exportAll() {
    if (!_viewer) return;
    const allData = {};
    for (const key of Object.keys(_viewer.scenes)) {
        const sceneData = _viewer.scenes[key];
        const limits = getEffectiveLimits(
            key, sceneData,
            _viewer.GLOBAL_MIN_PITCH, _viewer.GLOBAL_MAX_PITCH
        );
        const initials = getEffectiveInitials(key, sceneData, _viewer.toRad);
        const hotspots = getEffectiveHotspots(key, sceneData);
        const toDeg = (r) => (r * 180 / Math.PI);
        allData[key] = {
            yaw:   parseFloat(initials.yaw.toFixed(6)),
            pitch: parseFloat(initials.pitch.toFixed(6)),
            roll:  parseFloat(initials.roll.toFixed(2)),
            fov:   parseFloat(initials.fov.toFixed(6)),
            limits,
            hotspots
        };
    }
    const json = JSON.stringify(allData, null, 2);
    navigator.clipboard.writeText(json).then(() => {
        _showStatus('All scenes copied to clipboard ✓');
        console.log('[admin] Exported all scenes:\n' + json);
    }).catch(() => {
        _showStatus('Clipboard failed – check console');
        console.log('[admin] Export:\n' + json);
    });
}

function _downloadAll() {
    if (!_viewer) return;
    // Build a tour.json-compatible scenes patch with limits + initials
    const patch = {};
    for (const key of Object.keys(_viewer.scenes)) {
        const sceneData = _viewer.scenes[key];
        const limits = getEffectiveLimits(
            key, sceneData,
            _viewer.GLOBAL_MIN_PITCH, _viewer.GLOBAL_MAX_PITCH
        );
        const initials = getEffectiveInitials(key, sceneData, _viewer.toRad);
        const hotspots = getEffectiveHotspots(key, sceneData);
        patch[key] = {
            yaw:   parseFloat(initials.yaw.toFixed(6)),
            pitch: parseFloat(initials.pitch.toFixed(6)),
            roll:  parseFloat(initials.roll.toFixed(2)),
            fov:   parseFloat(initials.fov.toFixed(6)),
            limits,
            hotspots
        };
    }
    const json = JSON.stringify(patch, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scene-config.json';
    a.click();
    URL.revokeObjectURL(url);
    _showStatus('Downloaded scene-config.json ✓');
}

function _showStatus(msg) {
    if (!_panel) return;
    const el = _panel.querySelector('#ap-status');
    if (el) {
        el.textContent = msg;
        setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
    }
}

// ── Draggable helper ─────────────────────────────────────────────────

function _makeDraggable(panel, handle) {
    let isDragging = false, startX, startY, startLeft, startTop;

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        panel.style.left = (startLeft + e.clientX - startX) + 'px';
        panel.style.top  = (startTop  + e.clientY - startY) + 'px';
    });

    window.addEventListener('mouseup', () => { isDragging = false; });
}

// ── Scene switch hook (called by viewer) ─────────────────────────────

/** Call when the active scene changes so the panel updates */
export function onSceneSwitch(sceneKey) {
    if (_authenticated && _panel) {
        _updatePanelForScene(sceneKey);
    }
}

/** Called by viewer when H-click captures a position */
export function onHotspotPositionCaptured(yaw, pitch) {
    if (!_authenticated || !_panel) return;
    const $ = (sel) => _panel.querySelector(sel);
    $('#ap-hsYaw').value   = parseFloat(yaw.toFixed(6));
    $('#ap-hsPitch').value = parseFloat(pitch.toFixed(6));
    _showStatus('Position captured — choose type & add');
}

// ── Hotspot helpers ──────────────────────────────────────────────────

function _populateTargetScenes() {
    if (!_panel || !_viewer) return;
    const sel = _panel.querySelector('#ap-hsTarget');
    sel.innerHTML = '';
    for (const key of Object.keys(_viewer.scenes)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = key;
        sel.appendChild(opt);
    }
}

function _addHotspot() {
    if (!_viewer) return;
    const $ = (sel) => _panel.querySelector(sel);
    const sceneKey = _viewer.getCurrentKey();
    const sceneData = _viewer.scenes[sceneKey];
    if (!sceneData) return;
    const type  = $('#ap-hsType').value;
    const yaw   = parseFloat($('#ap-hsYaw').value)   || 0;
    const pitch = parseFloat($('#ap-hsPitch').value) || 0;
    const label = $('#ap-hsLabel').value.trim();

    const h = { type, yaw, pitch };
    if (label) h.label = label;
    if (type === 'link') {
        h.target = $('#ap-hsTarget').value;
        h.orientation = $('#ap-hsOrient').value;
    }

    if (!Array.isArray(sceneData.hotspots)) {
        sceneData.hotspots = [];
    }
    sceneData.hotspots.push(h);

    if (_viewer.scenesMap && _viewer.scenesMap[sceneKey]) {
        _viewer.scenesMap[sceneKey].data = sceneData;
    }

    _rerenderSceneHotspots(sceneKey);
    _renderHotspotList();
    _showStatus(`Added ${type} hotspot ✓`);
    console.log(`[admin] Added hotspot to "${sceneKey}":`, h);
}

function _deleteHotspot(index) {
    if (!_viewer) return;
    const sceneKey = _viewer.getCurrentKey();
    const sceneData = _viewer.scenes[sceneKey];
    if (!sceneData || !Array.isArray(sceneData.hotspots)) return;

    if (index >= 0 && index < sceneData.hotspots.length) {
        sceneData.hotspots.splice(index, 1);
        _rerenderSceneHotspots(sceneKey);
        _renderHotspotList();
        _showStatus('Hotspot removed ✓');
    }
}

function _rerenderSceneHotspots(sceneKey) {
    if (!_viewer) return;
    const built = _viewer.scenesMap[sceneKey];
    if (!built) return;
    const allHotspots = getEffectiveHotspots(sceneKey, built.data);
    _viewer.renderHotspots(built.scene, allHotspots);
}

function _renderHotspotList() {
    if (!_panel || !_viewer) return;
    const container = _panel.querySelector('#ap-hsList');
    if (!container) return;
    const sceneKey = _viewer.getCurrentKey();
    const sceneData = _viewer.scenes[sceneKey];
    const hotspots = sceneData?.hotspots || [];

    if (hotspots.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#888;text-align:center;padding:4px;">No hotspots in this scene</div>';
        return;
    }

    let html = '';

    hotspots.forEach((h, i) => {
        const desc = h.type === 'link' ? `→ ${h.target}` : (h.label || h.type);
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #333;">
            <span style="font-size:13px;color:#fff;">${i + 1}. <strong>${h.type}</strong> ${desc} <span style="color:#888;">(${h.yaw.toFixed(3)}, ${h.pitch.toFixed(3)})</span></span>
            <button data-hs-del="${i}" style="background:#c33;border:none;color:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px;">✕</button>
        </div>`;
    });

    container.innerHTML = html;
    // Wire delete buttons
    container.querySelectorAll('[data-hs-del]').forEach(btn => {
        btn.addEventListener('click', () => _deleteHotspot(parseInt(btn.dataset.hsDel)));
    });
}
