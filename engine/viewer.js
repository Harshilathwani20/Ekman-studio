// Virtual Tour Viewer (Marzipano)
// Loads tour.json, renders scenes, wires link and product hotspots.
import { fetchJson, degToRad, radToDeg, isTypingIntoForm } from './utils.js';
import { createLinkHotspot, createProductHotspot, createBubbleHotspot } from './hotspot.js';
import { SmoothCamera } from './smoothMotion.js';
import { isAdminRequested, isAdminMode, initAdmin, getEffectiveLimits, getEffectiveInitials, getEffectiveHotspots, onSceneSwitch, onHotspotPositionCaptured } from './admin.js';

// Dev-helper config — only active in admin mode
const devConfig = {
    rollStepSmall: 0.01,  rollStepLarge: 0.1,
    yawStepSmall: 0.01,   yawStepLarge: 0.1,
    pitchStepSmall: 0.01, pitchStepLarge: 0.1,
    fovStepSmall: 0.01,    fovStepLarge: 0.1,
    overlayToggleKey: 'o'
};

// Resolve and load the tour.json next to the current tour page.
async function loadTourJson() {
    const { origin, pathname } = window.location;
                    // Use directory base (works whether URL ends with '/' or 'index.html')
    const baseDir = pathname.replace(/\/[^\/]*$/, '/');
    const href = origin + baseDir + 'tour.json';
    console.log('[viewer] Page:', pathname);
    console.log('[viewer] Fetching tour JSON from:', href);
    const tour = await fetchJson(href);
    // Attach base href for resolving relative resources (products/scene files)
    tour._baseHref = origin + baseDir;
    return tour;
}

// Render the tour: create viewer, show first scene, wire hotspots + zoom.
async function renderTour(tour) {
    const root = document.querySelector('#viewer-root');
    if (!root) return;

    // Prepare pano container
    const pano = document.createElement('div');
    pano.id = 'pano';
    pano.style.position = 'absolute';
    pano.style.inset = '0';
    pano.style.width = '100%';
    pano.style.height = '100%';
    pano.style.background = '#000';
    root.appendChild(pano);

    if (!window.Marzipano) {
        console.error('Marzipano not available on window.');
        root.textContent = 'Marzipano library not loaded.';
        return;
    }

        const spinner = document.createElement('div');
        spinner.id = 'scene-spinner';
        spinner.setAttribute('role', 'status');
        spinner.setAttribute('aria-live', 'polite');
        spinner.setAttribute('aria-hidden', 'true');
        spinner.innerHTML = `
            <div class="spinner-shell">
                <div class="spinner-ring"></div>
                <p class="spinner-label">Loading scene…</p>
            </div>
        `;
        root.appendChild(spinner);

        const transferNotice = document.createElement('div');
        transferNotice.id = 'transfer-guard';
        transferNotice.setAttribute('role', 'status');
        transferNotice.setAttribute('aria-live', 'assertive');
        root.appendChild(transferNotice);
        let transferNoticeTimer = null;
        function showTransferNotice(message) {
                transferNotice.textContent = message;
                transferNotice.classList.add('is-visible');
                if (transferNoticeTimer) clearTimeout(transferNoticeTimer);
                transferNoticeTimer = setTimeout(() => {
                        transferNotice.classList.remove('is-visible');
                        transferNoticeTimer = null;
                }, 2600);
        }

    let spinnerHideTimer = null;
    let spinnerFallbackTimer = null;
    function showSceneSpinner(text = 'Loading scene…') {
        if (spinnerHideTimer) {
            clearTimeout(spinnerHideTimer);
            spinnerHideTimer = null;
        }
        if (spinnerFallbackTimer) {
            clearTimeout(spinnerFallbackTimer);
            spinnerFallbackTimer = null;
        }
        const labelEl = spinner.querySelector('.spinner-label');
        if (labelEl) labelEl.textContent = text;
        spinner.classList.add('is-visible');
        spinner.setAttribute('aria-hidden', 'false');
    }
    function hideSceneSpinner(delay = 0) {
        if (spinnerFallbackTimer) {
            clearTimeout(spinnerFallbackTimer);
            spinnerFallbackTimer = null;
        }
        if (spinnerHideTimer) clearTimeout(spinnerHideTimer);
        const ms = Math.max(0, delay);
        spinnerHideTimer = setTimeout(() => {
            spinner.classList.remove('is-visible');
            spinner.setAttribute('aria-hidden', 'true');
            spinnerHideTimer = null;
        }, ms);
    }

    const viewer = new Marzipano.Viewer(pano);
    const toRad = degToRad;
    const toDeg = radToDeg;

    const guardDataTransfer = (event) => {
        const dt = event?.dataTransfer;
        if (!dt) return;
        const types = dt.types ? Array.from(dt.types) : [];
        const hasFiles = (dt.files && dt.files.length > 0) || types.includes('Files');
        if (!hasFiles) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'drop') {
            showTransferNotice('File drops are disabled inside the tour.');
        }
    };
    window.addEventListener('dragover', guardDataTransfer, { passive: false });
    window.addEventListener('drop', guardDataTransfer, { passive: false });

    // Handle WebGL context loss gracefully
    const canvas = pano.querySelector('canvas');
    if (canvas) {
        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.warn('[viewer] WebGL context lost. Attempting recovery...');
        });
        canvas.addEventListener('webglcontextrestored', () => {
            console.log('[viewer] WebGL context restored.');
            viewer.updateSize();
        });
    }

    // Combine multiple Marzipano view limiters into one.
    // Each limiter is a function (params → params); we chain them.
    function combineLimiters(...fns) {
        return function (params) {
            for (const fn of fns) params = fn(params);
            return params;
        };
    }

    // Geometry definitions (single equirectangular source; no cube faces)
    const EQUIRECT_GEOMETRY_LEVELS = [
        { width: 4096 },
        { width: 2048 }
    ];
    const createEquirectGeometry = () => new Marzipano.EquirectGeometry(EQUIRECT_GEOMETRY_LEVELS);

    let scenes = tour.scenes || {};
    let products = tour.products || {};
    const { origin, pathname } = window.location;
    const baseHref = tour._baseHref || (origin + pathname.replace(/\/[^\/]*$/, '/'));
    const baseUrl = new URL(baseHref, window.location.origin);
    const tourBasePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : baseUrl.pathname + '/';
    const blockedProtocols = /^(?:javascript|vbscript|data|blob|file):/i;

    function resolveSafeAssetUrl(rawPath, { label = 'asset', restrictToBase = true, allowCrossOrigin = false } = {}) {
        if (typeof rawPath !== 'string') return null;
        const trimmed = rawPath.trim();
        if (!trimmed) return null;
        if (blockedProtocols.test(trimmed)) {
            console.warn(`[viewer] Blocked unsafe ${label} URL: ${trimmed}`);
            return null;
        }
        let resolved;
        try {
            if (/^(https?:)?\/\//i.test(trimmed)) {
                resolved = new URL(trimmed, window.location.origin);
            } else if (trimmed.startsWith('/')) {
                resolved = new URL(trimmed, window.location.origin);
            } else {
                resolved = new URL(trimmed, baseUrl);
            }
        } catch (err) {
            console.warn(`[viewer] Invalid ${label} URL "${trimmed}":`, err);
            return null;
        }
        if (!allowCrossOrigin && resolved.origin !== window.location.origin) {
            console.warn(`[viewer] Blocked cross-origin ${label} URL: ${trimmed}`);
            return null;
        }
        if (restrictToBase) {
            const normalizedPath = resolved.pathname;
            if (!normalizedPath.startsWith(tourBasePath)) {
                console.warn(`[viewer] Blocked ${label} outside tour directory: ${trimmed}`);
                return null;
            }
        }
        return resolved.href;
    }

    function getSceneImageUrl(sceneKey) {
        const data = scenes[sceneKey];
        if (!data) return null;
        if (Object.prototype.hasOwnProperty.call(data, '_safeImageUrl')) {
            return data._safeImageUrl;
        }
        const safeUrl = resolveSafeAssetUrl(data.image, { label: `scene "${sceneKey}" panorama`, restrictToBase: true });
        if (!safeUrl) {
            console.warn(`[viewer] Scene "${sceneKey}" is missing a valid panorama image.`);
            data._safeImageUrl = null;
            return null;
        }
        data._safeImageUrl = safeUrl;
        return safeUrl;
    }

    function getSceneMediaDescriptor(sceneKey) {
        const data = scenes[sceneKey];
        if (!data) return null;
        if (Object.prototype.hasOwnProperty.call(data, '_mediaDescriptor')) {
            return data._mediaDescriptor;
        }
        const imageDef = data.image;
        let descriptor = null;
        if (!imageDef) {
            console.warn(`[viewer] Scene "${sceneKey}" is missing an image definition.`);
        } else if (typeof imageDef === 'string') {
            const url = getSceneImageUrl(sceneKey);
            if (url) {
                descriptor = { type: 'equirect', url };
            }
        } else if (typeof imageDef === 'object') {
            const inlineUrl = imageDef.url || imageDef.src || imageDef.path;
            if (typeof inlineUrl === 'string') {
                const safeUrl = resolveSafeAssetUrl(inlineUrl, { label: `scene "${sceneKey}" panorama`, restrictToBase: true });
                if (safeUrl) {
                    descriptor = { type: 'equirect', url: safeUrl };
                }
            }
            if (!descriptor) {
                const fallbackUrl = getSceneImageUrl(sceneKey);
                if (fallbackUrl) {
                    descriptor = { type: 'equirect', url: fallbackUrl };
                }
            }
        }
        if (!descriptor) {
            console.warn(`[viewer] Scene "${sceneKey}" is missing a valid panorama definition.`);
        }
        data._mediaDescriptor = descriptor;
        return descriptor;
    }

    // Support external resources: products and scene entries can be strings (relative paths)
    if (typeof products === 'string') {
        try {
            products = await fetchJson(baseHref + products);
        } catch (e) {
            console.warn('[viewer] Failed to load external products:', e);
            products = {};
        }
    }

    // Resolve external scene files (string path or { file, ...overrides })
    for (const key of Object.keys(scenes)) {
        const entry = scenes[key];
        if (typeof entry === 'string') {
            const ref = entry;
            try {
                scenes[key] = await fetchJson(baseHref + ref);
            } catch (e) {
                console.warn(`[viewer] Failed to load scene '${key}' from ${baseHref}${ref}:`, e);
            }
        } else if (entry && typeof entry === 'object' && typeof entry.file === 'string') {
            const { file, ...overrides } = entry;
            try {
                const loaded = await fetchJson(baseHref + file);
                scenes[key] = { ...loaded, ...overrides };
            } catch (e) {
                console.warn(`[viewer] Failed to load scene '${key}' from ${baseHref}${file}:`, e);
            }
        }
    }

    const originalScenes = JSON.parse(JSON.stringify(scenes));

    const firstKey = Object.keys(scenes)[0];
    if (!firstKey) {
        root.textContent = 'No scenes found in tour.json.';
        return;
    }
    const initialSceneData = scenes[firstKey];
    const initialSceneLimits = initialSceneData
        ? getEffectiveLimits(firstKey, initialSceneData, GLOBAL_MIN_PITCH, GLOBAL_MAX_PITCH)
        : { pitchMin: -90, pitchMax: 90, fovMin: 30, fovMax: 100, dragScale: 1 };

    let scenesMap = {};
    let activeHotspotRefs = [];

    function clearHotspots() {
        activeHotspotRefs.forEach(({ container, hotspot }) => {
            try { container.destroyHotspot(hotspot); } catch (_) { }
        });
        activeHotspotRefs = [];
    }

    function renderHotspots(scene, hotspots) {
        clearHotspots();
        const container = scene.hotspotContainer();
        (hotspots || []).forEach(h => {
            if (h.type === 'link' && h.target) {
                const hotspot = createLinkHotspot(scene, {
                    yaw: (typeof h.yaw === 'number') ? h.yaw : 0,
                    pitch: (typeof h.pitch === 'number') ? h.pitch : 0,
                    label: h.label || 'Go',
                    orientation: h.orientation || 'wall', // pass orientation, default to 'wall'
                    onClick: () => switchScene(h.target)
                });
                if (hotspot) activeHotspotRefs.push({ container, hotspot });
            } else if (h.type === 'product' && h.id) {
                const productMeta = products[h.id] || {};
                const hotspot = createProductHotspot(scene, {
                    yaw: (typeof h.yaw === 'number') ? h.yaw : 0,
                    pitch: (typeof h.pitch === 'number') ? h.pitch : 0,
                    label: h.label || productMeta.title || 'View',
                    onClick: (event, el) => showProduct(h.id, el || event?.currentTarget || event?.target)
                });
                if (hotspot) activeHotspotRefs.push({ container, hotspot });
            } else if (h.type === 'bubble') {
                const hotspot = createBubbleHotspot(scene, {
                    yaw: (typeof h.yaw === 'number') ? h.yaw : 0,
                    pitch: (typeof h.pitch === 'number') ? h.pitch : 0,
                    label: h.label || '',
                    onClick: (event, el) => {
                        if (h.id) showProduct(h.id, el || event?.currentTarget || event?.target);
                    }
                });
                if (hotspot) activeHotspotRefs.push({ container, hotspot });
            }
        });
    }

    function describeSceneLabel(sceneKey, data) {
        return data?.title || data?.label || data?.name || sceneKey || 'scene';
    }

    // Error timeout: show user-friendly message after 15 seconds
    const SCENE_LOAD_TIMEOUT_MS = 15000;
    let sceneLoadErrorTimer = null;

    function showSceneError(message) {
        hideSceneSpinner(0);
        const errEl = document.createElement('div');
        errEl.id = 'scene-error';
        Object.assign(errEl.style, {
            position: 'absolute', inset: '0', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
            background: 'rgba(0,0,0,0.85)', color: '#fff', fontSize: '18px',
            zIndex: '2500', textAlign: 'center', padding: '20px'
        });
        errEl.innerHTML = `<p style="margin:0 0 12px;">${message}</p>
            <button id="retry-scene" style="padding:10px 24px;font-size:16px;cursor:pointer;">Retry</button>`;
        root.appendChild(errEl);
        errEl.querySelector('#retry-scene').addEventListener('click', () => {
            errEl.remove();
            switchScene(_currentSceneKey);
        });
    }

    function activateScene(built, sceneKey, opts = {}) {
        if (!built) {
            hideSceneSpinner(0);
            return;
        }
        const label = opts.label || describeSceneLabel(sceneKey, built.data);
        if (opts.showSpinner !== false) {
            const message = label ? `Loading ${label}…` : 'Loading scene…';
            showSceneSpinner(message);
            // Fallback hide (short) in case transition callback fails
            const fallbackDelay = Math.max(0, opts.fallbackDelay ?? 7000);
            spinnerFallbackTimer = setTimeout(() => {
                spinnerFallbackTimer = null;
                hideSceneSpinner(0);
            }, fallbackDelay);
            // Error timeout: give up after 15s and show error
            sceneLoadErrorTimer = setTimeout(() => {
                sceneLoadErrorTimer = null;
                if (spinnerFallbackTimer) { clearTimeout(spinnerFallbackTimer); spinnerFallbackTimer = null; }
                showSceneError('Scene is taking too long to load. Please check your connection.');
            }, SCENE_LOAD_TIMEOUT_MS);
        }
        const finish = () => {
            if (sceneLoadErrorTimer) { clearTimeout(sceneLoadErrorTimer); sceneLoadErrorTimer = null; }
            if (spinnerFallbackTimer) { clearTimeout(spinnerFallbackTimer); spinnerFallbackTimer = null; }
            hideSceneSpinner(opts.hideDelay ?? 120);
            if (typeof opts.onComplete === 'function') {
                try { opts.onComplete(); } catch (_) {}
            }
        };
        try {
            built.scene.switchTo(opts.transition ?? undefined, finish);
        } catch (err) {
            if (sceneLoadErrorTimer) { clearTimeout(sceneLoadErrorTimer); sceneLoadErrorTimer = null; }
            if (spinnerFallbackTimer) { clearTimeout(spinnerFallbackTimer); spinnerFallbackTimer = null; }
            hideSceneSpinner(0);
            showSceneError('Failed to display scene.');
            console.error('[viewer] switchTo error:', err);
        }
    }

    function buildScene(key) {
        if (!key) {
            console.error('[viewer] buildScene called with undefined or empty key');
            return null;
        }
        if (scenesMap[key]) return scenesMap[key];
        const data = scenes[key];
        if (!data) {
            console.error(`[viewer] Scene "${key}" not found in tour data`);
            return null;
        }
        const media = getSceneMediaDescriptor(key);
        if (!media) return null;
        let source;
        let geometry;
        source = Marzipano.ImageUrlSource.fromString(media.url);
        geometry = createEquirectGeometry();

        // Get per-scene limits (admin overrides → tour.json → global defaults)
        const sl = getEffectiveLimits(key, data, GLOBAL_MIN_PITCH, GLOBAL_MAX_PITCH);
        const minFovRad = toRad(sl.fovMin);
        const maxFovRad = toRad(sl.fovMax);
        const yawMinRad = toRad(sl.yawMin ?? -180);
        const yawMaxRad = toRad(sl.yawMax ??  180);
        const limiters = [
            Marzipano.RectilinearView.limit.resolution(8192),
            Marzipano.RectilinearView.limit.vfov(minFovRad, maxFovRad),
            Marzipano.RectilinearView.limit.hfov(minFovRad, maxFovRad),
            Marzipano.RectilinearView.limit.pitch(toRad(sl.pitchMin), toRad(sl.pitchMax))
        ];
        // Only apply yaw limits if they are not the full ±180° range
        if (sl.yawMin > -180 || sl.yawMax < 180) {
            limiters.push(Marzipano.RectilinearView.limit.yaw(yawMinRad, yawMaxRad));
        }
        const limiter = combineLimiters(...limiters);

        const adminInit = getEffectiveInitials(key, data, toRad);
        const initial = {
            yaw:   adminInit.yaw,
            pitch: adminInit.pitch,
            roll:  adminInit.roll,
            fov:   adminInit.fov
        };
        if (isAdminMode()) {
            console.log(`[admin] Initial camera for "${key || 'undefined'}":`, initial);
        }

        const view = new Marzipano.RectilinearView(initial, limiter);
        const scene = viewer.createScene({
            source,
            geometry,
            view,
            pinFirstLevel: true
        });

        scenesMap[key] = { scene, view, data };
        return scenesMap[key];
    }

    // Track current scene key for DEV helpers
    let _currentSceneKey = firstKey;
    let _initialLoadDone = false; // spinner only on first load
    let _devRollRad = 0; // current roll in radians (synced with scene)
    let _devYawRad = 0;   // radians
    let _devPitchRad = 0; // radians
    let _devFovRad = Math.PI/2;  // radians
    let smoothCam = null; // created after first scene switch
    let _devOverlay = null; // admin/dev overlay element

    // Lazy warm-up: after scene is visible, preload link target images in background.
    const warmupCache = new Set();
    function warmupLinkTargets(hotspots) {
        (hotspots || []).forEach(h => {
            if (h && h.type === 'link' && typeof h.target === 'string') {
                const targetMedia = getSceneMediaDescriptor(h.target);
                if (targetMedia && targetMedia.url && !warmupCache.has(targetMedia.url)) {
                    warmupCache.add(targetMedia.url);
                    const img = new Image();
                    img.decoding = 'async';
                    img.src = targetMedia.url;
                }
            }
        });
    }

    // Destroy old scene to free memory (keep entrance alive).
    function disposeOldScene(oldKey) {
        if (!oldKey) return;
        if (oldKey === firstKey) return; // never destroy entrance
        const old = scenesMap[oldKey];
        if (!old) return;
        try {
            old.scene.destroy();
        } catch (_) {}
        delete scenesMap[oldKey];
    }

    function switchScene(key) {
        if (!key) {
            console.error('[viewer] switchScene called with undefined or empty key');
            return;
        }
        const previousKey = _currentSceneKey;
        _currentSceneKey = key;
        const built = buildScene(key);
        if (!built) {
            console.error(`[viewer] Failed to build scene "${key}"`);
            return;
        }
        activateScene(built, key, {
            showSpinner: !_initialLoadDone, // spinner only on first load
            onComplete: () => {
                // After transition completes: dispose old, warmup link targets
                _initialLoadDone = true;
                disposeOldScene(previousKey);
                warmupLinkTargets(getEffectiveHotspots(key, built.data));
            }
        });
        // Merge tour.json + admin hotspots
        const allHotspots = getEffectiveHotspots(key, built.data);
        renderHotspots(built.scene, allHotspots);

        // Sync DEV tracking vars from the view that was just switched to
        // (initial values already incorporate saved dev state if available)
        try {
            const params = built.view.parameters();
            _devRollRad  = params.roll  ?? 0;
            _devYawRad   = params.yaw   ?? 0;
            _devPitchRad = params.pitch ?? 0;
            _devFovRad   = params.fov   ?? toRad(90);
        } catch (err) {
            _devRollRad  = built.data.roll  ?? 0;
            _devYawRad   = built.data.yaw   ?? 0;
            _devPitchRad = built.data.pitch ?? 0;
            _devFovRad   = toRad(90);
        }

        // Update smooth camera config with per-scene limits + drag scale
        const sl = getEffectiveLimits(key, built.data, GLOBAL_MIN_PITCH, GLOBAL_MAX_PITCH);
        if (smoothCam) {
            const ds = sl.dragScale ?? 1.0;
            smoothCam.updateConfig(
                { inputScaleMouse: 0.8 * ds,
                                    inputScaleTouch: 0.35 * ds },
                                { minPitch: toRad(sl.pitchMin),
                                    maxPitch: toRad(sl.pitchMax),
                                    minFov: toRad(sl.fovMin),
                                    maxFov: toRad(sl.fovMax) }
            );
        }

        // Notify admin panel of scene change
        onSceneSwitch(key);
        updateDevOverlay();
    }

    // Start with first scene
    switchScene(firstKey);
    viewer.updateSize();
    window.addEventListener('resize', () => viewer.updateSize());

    // ─── Smooth camera (Kuula-like inertia + zoom) ───────────────────
    const initDragScale = initialSceneLimits.dragScale ?? 1.0;
    const initialCamCfg = {
        inputScaleMouse: 0.8 * initDragScale,
        inputScaleTouch: 0.35 * initDragScale,
    };
    const initialLimitRadians = {
        minPitch: toRad(initialSceneLimits.pitchMin ?? -90),
        maxPitch: toRad(initialSceneLimits.pitchMax ?? 90),
        minFov:   toRad(initialSceneLimits.fovMin  ?? 30),
        maxFov:   toRad(initialSceneLimits.fovMax  ?? 110),
    };
    smoothCam = new SmoothCamera(viewer, pano, initialCamCfg, initialLimitRadians);

    // Create / manage on-screen debug overlay
    function createDevOverlay() {
        if (_devOverlay) return;
        _devOverlay = document.createElement('div');
        _devOverlay.id = 'dev-overlay';
        Object.assign(_devOverlay.style, {
            position: 'fixed', right: '12px', top: '12px', zIndex: 20000,
            background: 'rgba(20,20,35,0.5)', color: '#fff',
            fontFamily: 'system-ui, sans-serif', fontSize: '20px',
            padding: '0', borderRadius: '12px',
            minWidth: '400px', maxWidth: '480px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.08)',
            userSelect: 'none'
        });
        _devOverlay.innerHTML = `
          <div id="dev-header" style="padding:12px 18px;display:flex;align-items:center;justify-content:space-between;
               border-bottom:1px solid rgba(255,255,255,0.08);cursor:move;">
            <span style="font-weight:700;font-size:21px;color:#fff;">🛠 DEV Panel</span>
            <div style="display:flex;gap:8px;">
              <button id="dev-minimize" style="background:none;border:none;color:#fff;cursor:pointer;font-size:24px;" title="Minimize">−</button>
              <button id="dev-close" style="background:none;border:none;color:#fff;cursor:pointer;font-size:24px;" title="Close">×</button>
            </div>
          </div>
          <div id="dev-body" style="padding:15px 18px;">
            <div style="margin-bottom:12px;font-size:16px;color:#fff;">
              Scene: <strong id="dev-scene" style="color:#6af;">—</strong>
            </div>

            <!-- Camera sliders -->
            <fieldset style="border:1px solid #333;border-radius:6px;padding:10px 12px;margin:0 0 10px;">
              <legend style="font-size:16px;color:#fff;padding:0 4px;">Camera controls</legend>
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
                <span style="font-size:16px;color:#fff;min-width:46px;">Yaw</span>
                <input id="dev-yaw" type="range" min="-3.14" max="3.14" step="0.01" style="flex:1;accent-color:#2a6cf6;height:6px;" />
                <span id="dev-yawVal" style="min-width:60px;text-align:right;font-size:18px;color:#fff;">0</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
                <span style="font-size:16px;color:#fff;min-width:46px;">Pitch</span>
                <input id="dev-pitch" type="range" min="-1.57" max="1.57" step="0.01" style="flex:1;accent-color:#2a6cf6;height:6px;" />
                <span id="dev-pitchVal" style="min-width:60px;text-align:right;font-size:18px;color:#fff;">0</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
                <span style="font-size:16px;color:#fff;min-width:46px;">Roll</span>
                <input id="dev-roll" type="range" min="-3.14" max="3.14" step="0.01" style="flex:1;accent-color:#2a6cf6;height:6px;" />
                <span id="dev-rollVal" style="min-width:60px;text-align:right;font-size:18px;color:#fff;">0</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <span style="font-size:16px;color:#fff;min-width:46px;">FOV</span>
                <input id="dev-fov" type="range" min="0.35" max="2.09" step="0.01" style="flex:1;accent-color:#2a6cf6;height:6px;" />
                <span id="dev-fovVal" style="min-width:60px;text-align:right;font-size:18px;color:#fff;">1.57</span>
              </div>
            </fieldset>

            <!-- Keyboard shortcuts -->
            <fieldset style="border:1px solid #333;border-radius:6px;padding:10px 12px;margin:0 0 10px;">
              <legend style="font-size:16px;color:#fff;padding:0 4px;">Keyboard shortcuts</legend>
              <div style="font-size:14px;line-height:1.8;color:#fff;">
                <span style="color:#6cf;">← →</span> yaw &nbsp;&nbsp; <span style="color:#6cf;">↑ ↓</span> pitch<br>
                <span style="color:#6cf;">[ ]</span> roll &nbsp;&nbsp; <span style="color:#6cf;">- =</span> fov<br>
                <span style="color:#6cf;">Shift</span> + key = large step<br>
                <span style="color:#6cf;">H</span> hotspot helper &nbsp; <span style="color:#6cf;">S</span> log values<br>
                <span style="color:#6cf;">C</span> copy JSON &nbsp; <span style="color:#6cf;">R</span> reset scene<br>
                <span style="color:#6cf;">O</span> toggle overlay
              </div>
            </fieldset>

            <!-- Action buttons -->
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button id="dev-copy" style="flex:1;padding:10px;border:1px solid #555;border-radius:6px;
                      background:transparent;color:#fff;cursor:pointer;font-size:18px;">📋 Copy</button>
              <button id="dev-log" style="flex:1;padding:10px;border:1px solid #555;border-radius:6px;
                      background:transparent;color:#fff;cursor:pointer;font-size:18px;">📝 Log</button>
              <button id="dev-reset" style="flex:1;padding:10px;border:1px solid #555;border-radius:6px;
                      background:transparent;color:#fff;cursor:pointer;font-size:18px;">🔄 Reset</button>
            </div>
            <div id="dev-status" style="margin-top:10px;font-size:16px;color:#4a4;min-height:1.3em;text-align:center;"></div>
          </div>
        `;
        document.body.appendChild(_devOverlay);

        // --- Wire minimize / close / drag ---
        const $d = (sel) => _devOverlay.querySelector(sel);
        let _devMin = false;
        $d('#dev-minimize').addEventListener('click', () => {
            _devMin = !_devMin;
            $d('#dev-body').style.display = _devMin ? 'none' : 'block';
            $d('#dev-minimize').textContent = _devMin ? '+' : '−';
        });
        $d('#dev-close').addEventListener('click', () => {
            _devOverlay.style.display = 'none';
        });
        // Make draggable
        const hdr = $d('#dev-header');
        let _dx = 0, _dy = 0, _mx = 0, _my = 0;
        hdr.addEventListener('mousedown', (e) => {
            e.preventDefault();
            _mx = e.clientX; _my = e.clientY;
            const onMove = (ev) => {
                _dx = _mx - ev.clientX; _dy = _my - ev.clientY;
                _mx = ev.clientX; _my = ev.clientY;
                _devOverlay.style.top  = (_devOverlay.offsetTop  - _dy) + 'px';
                _devOverlay.style.left = (_devOverlay.offsetLeft - _dx) + 'px';
                _devOverlay.style.right = 'auto';
            };
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // --- Wire camera sliders ---
        function _devApplySliders() {
            const built = scenesMap[_currentSceneKey];
            if (!built) return;
            const yawRad   = parseFloat($d('#dev-yaw').value);
            const pitchRad = parseFloat($d('#dev-pitch').value);
            const rollRad  = parseFloat($d('#dev-roll').value);
            const fovRad   = parseFloat($d('#dev-fov').value);
            built.view.setYaw(yawRad);
            built.view.setPitch(pitchRad);
            built.view.setRoll(rollRad);
            built.view.setFov(fovRad);
            _devYawRad   = yawRad;
            _devPitchRad = pitchRad;
            _devRollRad  = rollRad;
            _devFovRad   = fovRad;
            $d('#dev-yawVal').textContent   = yawRad.toFixed(2);
            $d('#dev-pitchVal').textContent = pitchRad.toFixed(2);
            $d('#dev-rollVal').textContent  = rollRad.toFixed(2);
            $d('#dev-fovVal').textContent   = fovRad.toFixed(2);
        }
        for (const id of ['#dev-yaw','#dev-pitch','#dev-roll','#dev-fov']) {
            $d(id).addEventListener('input', _devApplySliders);
        }

        // --- Wire action buttons ---
        $d('#dev-copy').addEventListener('click', () => {
            const built = scenesMap[_currentSceneKey];
            if (!built) return;
            const p = built.view.parameters();
            const json = JSON.stringify({
                yaw:   parseFloat(p.yaw.toFixed(6)),
                pitch: parseFloat(p.pitch.toFixed(6)),
                roll:  parseFloat(p.roll.toFixed(6)),
                fov:   parseFloat(p.fov.toFixed(6))
            }, null, 2);
            navigator.clipboard.writeText(json).then(() => {
                $d('#dev-status').textContent = 'Copied to clipboard ✓';
                setTimeout(() => { if ($d('#dev-status')) $d('#dev-status').textContent = ''; }, 2000);
            }).catch(() => { console.log('[DEV] clipboard failed'); });
        });
        $d('#dev-log').addEventListener('click', () => {
            const built = scenesMap[_currentSceneKey];
            if (!built) return;
            const p = built.view.parameters();
            console.log(`scene: "${_currentSceneKey}", roll: ${p.roll.toFixed(2)}, yaw: ${p.yaw.toFixed(2)}, pitch: ${p.pitch.toFixed(2)}, fov: ${p.fov.toFixed(2)}`);
            $d('#dev-status').textContent = 'Logged to console ✓';
            setTimeout(() => { if ($d('#dev-status')) $d('#dev-status').textContent = ''; }, 2000);
        });
        $d('#dev-reset').addEventListener('click', () => {
            delete scenesMap[_currentSceneKey];
            const rebuilt = buildScene(_currentSceneKey);
            activateScene(rebuilt, _currentSceneKey);
            const refreshedHotspots = getEffectiveHotspots(_currentSceneKey, rebuilt.data);
            renderHotspots(rebuilt.scene, refreshedHotspots);
            const p = rebuilt.view.parameters();
            _devRollRad  = p.roll;
            _devYawRad   = p.yaw;
            _devPitchRad = p.pitch;
            _devFovRad   = p.fov;
            updateDevOverlay();
            $d('#dev-status').textContent = 'Reset to defaults ✓';
            setTimeout(() => { if ($d('#dev-status')) $d('#dev-status').textContent = ''; }, 2000);
        });
    }
    function updateDevOverlay() {
        if (!_devOverlay) return;
        const $d = (sel) => _devOverlay.querySelector(sel);
        const scene = $d('#dev-scene');
        if (scene) scene.textContent = _currentSceneKey;
        // Sync sliders to current camera vals
        $d('#dev-yaw').value   = _devYawRad;
        $d('#dev-pitch').value = _devPitchRad;
        $d('#dev-roll').value  = _devRollRad;
        $d('#dev-fov').value   = _devFovRad;
        $d('#dev-yawVal').textContent   = _devYawRad.toFixed(2);
        $d('#dev-pitchVal').textContent = _devPitchRad.toFixed(2);
        $d('#dev-rollVal').textContent  = _devRollRad.toFixed(2);
        $d('#dev-fovVal').textContent   = _devFovRad.toFixed(2);
    }
    function showDevOverlay(show) {
        if (show) {
            createDevOverlay();
            _devOverlay.style.display = 'block';
            updateDevOverlay();
        } else if (_devOverlay) {
            _devOverlay.style.display = 'none';
        }
    }

    // Developer key handler — only active in admin mode
    // Uses offset* methods so we only touch the value being changed.
    // This avoids snapping the camera when the user drags to a new position
    // and then presses a dev key.
    document.addEventListener('keydown', (e) => {
        if (!isAdminMode()) return;
        if (isTypingIntoForm(e)) return;

        const rollStep = e.shiftKey ? devConfig.rollStepLarge : devConfig.rollStepSmall;
        const yawStep = e.shiftKey ? devConfig.yawStepLarge : devConfig.yawStepSmall;
        const pitchStep = e.shiftKey ? devConfig.pitchStepLarge : devConfig.pitchStepSmall;
        const fovStep = e.shiftKey ? devConfig.fovStepLarge : devConfig.fovStepSmall;
        let handled = false;

        const built = scenesMap[_currentSceneKey];
        if (!built) return;

        // ROLL
        if (e.key === '[') {
            built.view.offsetRoll(-rollStep);
            handled = true;
        } else if (e.key === ']') {
            built.view.offsetRoll(rollStep);
            handled = true;

        // YAW
        } else if (e.key === 'ArrowLeft') {
            built.view.offsetYaw(-yawStep);
            handled = true;
        } else if (e.key === 'ArrowRight') {
            built.view.offsetYaw(yawStep);
            handled = true;

        // PITCH
        } else if (e.key === 'ArrowUp') {
            built.view.offsetPitch(pitchStep);
            handled = true;
        } else if (e.key === 'ArrowDown') {
            built.view.offsetPitch(-pitchStep);
            handled = true;

        // FOV
        } else if (e.key === '-') {
            built.view.offsetFov(-fovStep);
            handled = true;
        } else if (e.key === '=' || (e.key === '+' && e.shiftKey)) {
            built.view.offsetFov(fovStep);
            handled = true;

        // overlay toggle
        } else if (e.key.toLowerCase() === (devConfig.overlayToggleKey || 'o')) {
            showDevOverlay(!(_devOverlay && _devOverlay.style.display !== 'none'));
            handled = true;

        // LOG all values
        } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
            const p = built.view.parameters();
            console.log(`scene: "${_currentSceneKey}", roll: ${p.roll.toFixed(2)}, yaw: ${p.yaw.toFixed(2)}, pitch: ${p.pitch.toFixed(2)}, fov: ${p.fov.toFixed(2)}`);
            return;

        // COPY current camera values as JSON to clipboard
        } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
            const p = built.view.parameters();
            const json = JSON.stringify({
                yaw:   parseFloat(p.yaw.toFixed(6)),
                pitch: parseFloat(p.pitch.toFixed(6)),
                roll:  parseFloat(p.roll.toFixed(6)),
                fov:   parseFloat(p.fov.toFixed(6))
            }, null, 2);
            navigator.clipboard.writeText(json).then(() => {
                console.log(`[DEV] Copied to clipboard:\n${json}`);
                if (_devOverlay) {
                    const flash = _devOverlay.querySelector('#dev-overlay-values');
                    if (flash) { flash.style.color = '#0f0'; setTimeout(() => flash.style.color = '#fff', 400); }
                }
            }).catch(err => console.warn('[DEV] Clipboard write failed:', err));
            e.preventDefault();
            return;

        // RESET scene camera to tour.json defaults (clear saved state)
        } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
            // Delete cached scene so it rebuilds with tour.json defaults
            delete scenesMap[_currentSceneKey];
            const rebuilt = buildScene(_currentSceneKey);
            activateScene(rebuilt, _currentSceneKey);
            const refreshedHotspots = getEffectiveHotspots(_currentSceneKey, rebuilt.data);
            renderHotspots(rebuilt.scene, refreshedHotspots);
            const p = rebuilt.view.parameters();
            _devRollRad  = p.roll;
            _devYawRad   = p.yaw;
            _devPitchRad = p.pitch;
            _devFovRad   = p.fov;
            updateDevOverlay();
            console.log(`[DEV] Reset "${_currentSceneKey}" to tour.json defaults`);
            e.preventDefault();
            return;
        }

        if (handled) {
            e.preventDefault();
            // Read back live state for overlay + console
            const p = built.view.parameters();
            _devRollRad  = p.roll;
            _devYawRad   = p.yaw;
            _devPitchRad = p.pitch;
            _devFovRad   = p.fov;
            updateDevOverlay();
            console.log(`[DEV cam] ${_currentSceneKey} — roll:${_devRollRad.toFixed(2)}, yaw:${_devYawRad.toFixed(2)}, pitch:${_devPitchRad.toFixed(2)}, fov:${_devFovRad.toFixed(2)}`);
        }
    });

    // ─── Admin mode ─────────────────────────────────────────────────────
    // Initialise admin module — shows login dialog if ?admin in URL
    initAdmin({
        viewer, scenesMap, scenes, originalScenes, tour, toRad, smoothCam,
        getCurrentKey: () => _currentSceneKey,
        GLOBAL_MIN_PITCH, GLOBAL_MAX_PITCH,
        buildScene, renderHotspots, switchScene,
        showDevOverlay
    }, (sceneKey, newLimits) => {
        // Admin changed limits for a scene → rebuild it
        delete scenesMap[sceneKey];
        if (sceneKey === _currentSceneKey) {
            const rebuilt = buildScene(sceneKey);
            activateScene(rebuilt, sceneKey);
            const allHotspots = getEffectiveHotspots(sceneKey, rebuilt.data);
            renderHotspots(rebuilt.scene, allHotspots);
            // Re-sync smooth camera
            const rl = getEffectiveLimits(sceneKey, rebuilt.data, GLOBAL_MIN_PITCH, GLOBAL_MAX_PITCH);
            if (smoothCam) {
                const ds = rl.dragScale ?? 1.0;
                smoothCam.updateConfig(
                    { inputScaleMouse: 0.8 * ds, inputScaleTouch: 0.35 * ds },
                    { minPitch: toRad(rl.pitchMin), maxPitch: toRad(rl.pitchMax), minFov: toRad(rl.fovMin), maxFov: toRad(rl.fovMax) }
                );
            }
            // Sync dev vars
            try {
                const p = rebuilt.view.parameters();
                _devRollRad  = p.roll  ?? 0;
                _devYawRad   = p.yaw   ?? 0;
                _devPitchRad = p.pitch  ?? 0;
                _devFovRad   = p.fov   ?? toRad(90);
            } catch (_) {}
            updateDevOverlay();
        }
    });
    // ─── END DEV camera helper ─────────────────────────────────────────────

    // Hotspot placement helper (admin mode only)
    let helperEnabled = false;
    let helperMarker = null;

    function toggleHelper() {
        helperEnabled = !helperEnabled;
        console.log(`Hotspot helper: ${helperEnabled ? 'ON' : 'OFF'}`);
        
        // Remove marker when turning helper off
        if (!helperEnabled && helperMarker) {
            helperMarker.remove();
            helperMarker = null;
        }
    }

    function createHelperMarker(x, y, coords) {
        // Remove previous marker
        if (helperMarker) {
            helperMarker.remove();
        }
        
        // Create marker container
        helperMarker = document.createElement('div');
        helperMarker.style.position = 'absolute';
        helperMarker.style.left = x + 'px';
        helperMarker.style.top = y + 'px';
        helperMarker.style.transform = 'translate(-50%, -50%)';
        helperMarker.style.zIndex = '1500';
        
        // Create red dot
        const dot = document.createElement('div');
        dot.style.width = '12px';
        dot.style.height = '12px';
        dot.style.background = '#ff0000';
        dot.style.border = '2px solid #ffffff';
        dot.style.borderRadius = '50%';
        dot.style.pointerEvents = 'auto'; // Enable clicking
        dot.style.cursor = 'pointer'; // Show it's clickable
        dot.style.boxShadow = '0 0 8px rgba(255, 0, 0, 0.8)';
        
        // Create label with coordinates
        const label = document.createElement('div');
        const jsonText = `"yaw": ${coords.yaw.toFixed(6)}, "pitch": ${coords.pitch.toFixed(6)}","`;
        label.textContent = 'Copy JSON';
        label.title = jsonText; // Show coordinates on hover
        label.style.position = 'absolute';
        label.style.top = '20px';
        label.style.left = '50%';
        label.style.transform = 'translateX(-50%)';
        label.style.background = 'rgba(0, 0, 0, 0.8)';
        label.style.color = '#ffffff';
        label.style.padding = '4px 8px';
        label.style.borderRadius = '4px';
        label.style.fontSize = '12px';
        label.style.fontWeight = 'bold';
        label.style.cursor = 'pointer';
        label.style.userSelect = 'none';
        label.style.whiteSpace = 'nowrap';
        label.style.border = '1px solid #ff0000';
        label.style.pointerEvents = 'auto';
        
        // Copy to clipboard functionality (works for both dot and label)
        const copyToClipboard = async () => {
            try {
                await navigator.clipboard.writeText(jsonText);
                const originalText = label.textContent;
                label.textContent = 'Copied!';
                label.style.background = 'rgba(0, 128, 0, 0.8)';
                setTimeout(() => {
                    label.textContent = originalText;
                    label.style.background = 'rgba(0, 0, 0, 0.8)';
                }, 1500);
            } catch (err) {
                console.warn('Failed to copy coordinates:', err);
                // Fallback: select text for manual copy
                label.style.background = 'rgba(255, 165, 0, 0.8)';
                label.textContent = jsonText;
                setTimeout(() => {
                    label.textContent = 'Copy JSON';
                    label.style.background = 'rgba(0, 0, 0, 0.8)';
                }, 3000);
            }
        };
        
        // Add click event to both dot and label
        dot.addEventListener('click', copyToClipboard);
        label.addEventListener('click', copyToClipboard);
        
        helperMarker.appendChild(dot);
        helperMarker.appendChild(label);
        pano.appendChild(helperMarker);
    }

    function handleHelperClick(event) {
        if (!helperEnabled) return;
        
        // Get click coordinates relative to pano container
        const rect = pano.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Convert screen coordinates to yaw/pitch
        try {
            const coords = viewer.view().screenToCoordinates({ x, y });
            if (coords) {
                console.log(`yaw: ${coords.yaw.toFixed(6)}, pitch: ${coords.pitch.toFixed(6)}`);
                
                // Create visual marker at click position with coordinates
                createHelperMarker(x, y, coords);
                
                // Send to admin panel if admin mode is active
                if (isAdminMode()) {
                    onHotspotPositionCaptured(coords.yaw, coords.pitch);
                }
                
                // Automatically copy to clipboard on click
                const jsonText = `"yaw": ${coords.yaw.toFixed(6)}, "pitch": ${coords.pitch.toFixed(6)}`;
                navigator.clipboard.writeText(jsonText).then(() => {
                    console.log('Coordinates copied to clipboard:', jsonText);
                }).catch(err => {
                    console.warn('Failed to copy coordinates:', err);
                });
            }
        } catch (error) {
            console.warn('Failed to get coordinates:', error);
        }
    }

    // Event listeners for helper functionality (admin mode only)
    document.addEventListener('keydown', (event) => {
        if (!isAdminMode()) return;
        if (isTypingIntoForm(event)) return;
        if (event.key.toLowerCase() === 'h') {
            event.preventDefault();
            toggleHelper();
        }
    });

    pano.addEventListener('click', handleHelperClick);

    const FOCUSABLE_SELECTORS = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    let _productModal = null;
    let _productLastFocus = null;
    let _productTrapHandler = null;
    let _productEscHandler = null;

    function getModalFocusable(modal) {
        if (!modal) return [];
        return Array.from(modal.querySelectorAll(FOCUSABLE_SELECTORS)).filter(el => el.offsetParent !== null);
    }

    function closeProductModal(options = {}) {
        const { restoreFocus = true } = options;
        if (!_productModal) return;
        const modalToRemove = _productModal;
        modalToRemove.style.opacity = '0';
        document.documentElement.classList.remove('modal-open');

        if (_productTrapHandler) modalToRemove.removeEventListener('keydown', _productTrapHandler);
        if (_productEscHandler) document.removeEventListener('keydown', _productEscHandler);
        _productTrapHandler = null;
        _productEscHandler = null;
        _productModal = null;

        setTimeout(() => {
            if (modalToRemove.parentNode) modalToRemove.remove();
        }, 300);

        if (restoreFocus && _productLastFocus && typeof _productLastFocus.focus === 'function') {
            requestAnimationFrame(() => {
                try { _productLastFocus.focus(); } catch (_) {}
            });
        }
        _productLastFocus = null;
    }

    function showProduct(id, triggerEl) {
        const p = products[id];
        if (!p) {
            console.warn('[viewer] Unknown product id:', id);
            return;
        }

        closeProductModal({ restoreFocus: false });
        _productLastFocus = triggerEl || document.activeElement;

        const stamp = Date.now();

        _productModal = document.createElement('div');
        _productModal.id = 'product-modal';
        _productModal.setAttribute('role', 'dialog');
        _productModal.setAttribute('aria-modal', 'true');
        _productModal.style.position = 'fixed';
        _productModal.style.inset = '0';
        _productModal.style.background = 'rgba(0, 0, 0, 0.92)';
        _productModal.style.zIndex = '3000';
        _productModal.style.display = 'flex';
        _productModal.style.alignItems = 'center';
        _productModal.style.justifyContent = 'center';
        _productModal.style.opacity = '0';
        _productModal.style.transition = 'opacity 0.3s ease';

        const content = document.createElement('div');
        content.style.position = 'relative';
        content.style.maxWidth = '90vw';
        content.style.maxHeight = '90vh';
        content.style.pointerEvents = 'auto';
        content.style.outline = 'none';
        content.tabIndex = -1;
        content.setAttribute('role', 'document');

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', 'Close product details');
        Object.assign(closeBtn.style, {
            position: 'absolute',
            top: '-40px',
            right: '-40px',
            fontSize: '48px',
            fontWeight: 'bold',
            color: '#fff',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            lineHeight: 1,
            padding: '0 10px',
            zIndex: 10
        });
        closeBtn.addEventListener('click', () => closeProductModal());
        content.appendChild(closeBtn);

        let labelledById = null;
        if (p.title) {
            const title = document.createElement('h2');
            title.textContent = p.title;
            labelledById = `product-title-${id}-${stamp}`;
            title.id = labelledById;
            Object.assign(title.style, {
                color: '#fff',
                fontSize: '1.4rem',
                fontWeight: '600',
                textAlign: 'center',
                margin: '0 0 12px',
                textShadow: '0 2px 8px rgba(0,0,0,0.8)'
            });
            content.appendChild(title);
        } else {
            _productModal.setAttribute('aria-label', 'Product details');
        }
        if (labelledById) {
            _productModal.setAttribute('aria-labelledby', labelledById);
        }

        const imgSrc = resolveSafeAssetUrl(p.image, {
            label: `product image (${id})`,
            restrictToBase: true
        });

        if (imgSrc) {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.alt = p.title || 'Product';
            Object.assign(img.style, {
                maxWidth: '90vw',
                maxHeight: '80vh',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.7)',
                display: 'block'
            });
            content.appendChild(img);
        } else {
            const noImg = document.createElement('div');
            noImg.textContent = 'No image available';
            noImg.style.color = '#aaa';
            noImg.style.padding = '40px';
            noImg.style.textAlign = 'center';
            content.appendChild(noImg);
        }

        if (p.description) {
            const descId = `product-desc-${id}-${stamp}`;
            const desc = document.createElement('p');
            desc.id = descId;
            desc.textContent = p.description;
            Object.assign(desc.style, {
                color: '#ddd',
                fontSize: '1rem',
                marginTop: '16px',
                textAlign: 'center',
                maxWidth: '80vw'
            });
            content.appendChild(desc);
            _productModal.setAttribute('aria-describedby', descId);
        }

        _productModal.appendChild(content);
        document.body.appendChild(_productModal);
        document.documentElement.classList.add('modal-open');

        requestAnimationFrame(() => {
            _productModal.style.opacity = '1';
            const focusables = getModalFocusable(_productModal);
            const first = focusables[0] || content;
            first.focus();
        });

        _productModal.addEventListener('click', (e) => {
            if (e.target === _productModal) {
                closeProductModal();
            }
        });

        _productTrapHandler = (event) => {
            if (event.key !== 'Tab') return;
            const focusables = getModalFocusable(_productModal);
            if (!focusables.length) {
                event.preventDefault();
                content.focus();
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        _productModal.addEventListener('keydown', _productTrapHandler);

        _productEscHandler = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeProductModal();
            }
        };
        document.addEventListener('keydown', _productEscHandler);
    }
}

export async function startViewer() {
    try {
        const tour = await loadTourJson();
        await renderTour(tour);
    } catch (e) {
        console.error('Failed to load tour:', e);
        const root = document.querySelector('#viewer-root');
        if (root) root.textContent = 'Failed to load tour.';
    }
}

const GLOBAL_MIN_PITCH = -Math.PI / 2;   // limit looking up   (-90°)
const GLOBAL_MAX_PITCH =  Math.PI / 2;   // limit looking down  (+90°)