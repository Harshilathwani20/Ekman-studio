// ─────────────────────────────────────────────────────────────────────
// smoothMotion.js – Kuula-like inertia & soft-clamping for Marzipano
// ─────────────────────────────────────────────────────────────────────
//
// Custom camera control with input attenuation, momentum, and soft pitch limits.
// Disables Marzipano's built-in drag and handles pointer events directly.
//
// How it works:
//   DURING DRAG  → intercept pointer/touch move events, scale deltas by
//                   inputScale, apply to camera, accumulate velocity.
//   ON RELEASE   → apply decaying momentum with exponential friction.
//   NEAR LIMITS  → soft-clamp spring zone progressively damps pitch velocity.
//
// ── Tuneable values ─────────────────────────────────────────────────
//
//   inputScaleMouse  0-1   Scale factor for mouse drag (default 0.5)
//   inputScaleTouch  0-1   Scale factor for touch drag (default 0.35)
//   friction         0-1   Higher = longer slide (0.96 = Kuula feel)
//   yawSpeed         >0    Multiplier on yaw momentum after release.
//   pitchSpeed       >0    Multiplier on pitch momentum after release.
//   maxYawVel        rad/ms Hard cap on yaw velocity.
//   maxPitchVel      rad/ms Hard cap on pitch velocity.
//   softClamp        bool  Enable spring-back near pitch limits.
//   softClampZone    rad   Width of the spring zone before the limit.
//   softClampK       >0    Spring stiffness (higher = harder resist).
// ─────────────────────────────────────────────────────────────────────

/** Wrap a yaw delta into [−π, π] to avoid velocity spikes at ±π. */
function wrapDelta(d) {
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// ── Defaults (tweak here for global feel) ────────────────────────────
const DEFAULTS = {
    inputScaleMouse: 0.8,     // input attenuation for mouse drag
    inputScaleTouch: 0.35,    // input attenuation for touch drag
    friction:        0.96,    // 0-1: exponential decay per 16.67ms frame
    yawSpeed:        1.0,     // multiplier on yaw momentum after release
    pitchSpeed:      1.0,     // multiplier on pitch momentum after release
    maxYawVel:       0.0014,  // rad/ms – hard cap
    maxPitchVel:     0.0010,  // rad/ms – hard cap
    softClamp:       true,    // enable spring-back near pitch limits
    softClampZone:   0.22,    // rad (~12.6°) – spring zone width
    softClampK:      4.0,     // spring stiffness
    zoomSpeedMouse:  0.0015,  // sensitivity for wheel / trackpad zoom
    zoomSpeedTouch:  0.45,    // exponent when converting pinch distance to zoom
};

export class SmoothCamera {
    /**
     * @param {Marzipano.Viewer} viewer
     * @param {HTMLElement}      panoEl  – the pano container div
     * @param {Object}           cfg     – camera behaviour (merged with DEFAULTS)
     * @param {Object}           limits  – { minPitch, maxPitch } in radians
     */
    constructor(viewer, panoEl, cfg = {}, limits = {}) {
        this.viewer = viewer;
        this.pano   = panoEl;
        this.cfg    = { ...DEFAULTS, ...cfg };
        this.limits = {
            minPitch: limits.minPitch ?? -Math.PI / 2,
            maxPitch: limits.maxPitch ??  Math.PI / 2,
        };
        this.fovLimits = {
            minFov: limits.minFov ?? 0.35,  // ~20°
            maxFov: limits.maxFov ?? 1.92,  // ~110°
        };

        // ── internal state ───────────────────────────────────────────
        this._dragging    = false;   // true while pointer/touch is down
        this._momentum    = false;   // true while velocity is decaying
        this._pointerType = 'mouse'; // 'mouse' or 'touch'
        this._velYaw      = 0;       // current yaw velocity (rad/ms)
        this._velPitch    = 0;       // current pitch velocity (rad/ms)
        this._lastX       = 0;       // last pointer X position
        this._lastY       = 0;       // last pointer Y position
        this._lastT       = 0;       // timestamp of last tick
        this._rafId       = null;
        this._pinching        = false;
        this._pinchStartDist  = 0;
        this._pinchStartFov   = 0;

        // Bind so we can remove them later
        this._onMouseDown  = this._onMouseDown.bind(this);
        this._onMouseMove  = this._onMouseMove.bind(this);
        this._onMouseUp    = this._onMouseUp.bind(this);
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchMove  = this._onTouchMove.bind(this);
        this._onTouchEnd   = this._onTouchEnd.bind(this);
        this._onWheel      = this._onWheel.bind(this);
        this._tick         = this._tick.bind(this);
        this._ensureLoop   = this._ensureLoop.bind(this);
        this._stopLoop     = this._stopLoop.bind(this);
        this._startPinch   = this._startPinch.bind(this);
        this._updatePinch  = this._updatePinch.bind(this);
        this._endPinch     = this._endPinch.bind(this);

        // Disable Marzipano's built-in drag controls
        this._disableMarzipanoDrag();

        this._attach();
    }

    /* ═══════════════════════ Public API ═══════════════════════ */

    /** Call on scene switch to apply the new scene's camera config. */
    updateConfig(cfg, limits) {
        Object.assign(this.cfg, cfg);
        if (limits) {
            if (limits.minPitch != null) this.limits.minPitch = limits.minPitch;
            if (limits.maxPitch != null) this.limits.maxPitch = limits.maxPitch;
            if (limits.minFov  != null) this.fovLimits.minFov = limits.minFov;
            if (limits.maxFov  != null) this.fovLimits.maxFov = limits.maxFov;
        }
        // Kill in-flight momentum so the new scene starts clean.
        this._momentum  = false;
        this._velYaw    = 0;
        this._velPitch  = 0;
        this._stopLoop();
    }

    /** Tear down listeners and stop the animation loop. */
    destroy() {
        this._stopLoop();
        this.pano.removeEventListener('mousedown',  this._onMouseDown);
        this.pano.removeEventListener('touchstart', this._onTouchStart);
        this.pano.removeEventListener('wheel',      this._onWheel);
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup',   this._onMouseUp);
        window.removeEventListener('touchmove', this._onTouchMove);
        window.removeEventListener('touchend',  this._onTouchEnd);
        window.removeEventListener('touchcancel', this._onTouchEnd);
    }

    /* ═══════════════════════ Private ══════════════════════════ */

    /** Disable Marzipano's default drag controls so we handle input ourselves */
    _disableMarzipanoDrag() {
        const controls = this.viewer.controls();
        if (controls) {
            // Disable mouse and touch drag (with fallbacks for different Marzipano versions)
            try { controls.disableMethod('mouseViewDrag'); } catch (_) {}
            try { controls.disableMethod('touchView'); } catch (_) {}
            try { controls.disableMethod('drag'); } catch (_) {}
        }
    }

    _attach() {
        // Mouse events
        this.pano.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);
        this.pano.addEventListener('wheel', this._onWheel, { passive: false });

        // Touch events
        this.pano.addEventListener('touchstart', this._onTouchStart, { passive: false });
        window.addEventListener('touchmove', this._onTouchMove, { passive: false });
        window.addEventListener('touchend', this._onTouchEnd);
        window.addEventListener('touchcancel', this._onTouchEnd);
    }

    _ensureLoop() {
        if (this._rafId != null) return;
        this._lastT = performance.now();
        this._rafId = requestAnimationFrame(this._tick);
    }

    _stopLoop() {
        if (this._rafId != null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /* ─── Mouse handlers ─────────────────────────────────────── */

    _onMouseDown(e) {
        if (e.button !== 0) return; // only left button
        e.preventDefault();
        this._dragging    = true;
        this._momentum    = false;
        this._stopLoop();
        this._pointerType = 'mouse';
        this._velYaw      = 0;
        this._velPitch    = 0;
        this._lastX       = e.clientX;
        this._lastY       = e.clientY;
        this._lastT       = performance.now();
    }

    _onMouseMove(e) {
        if (!this._dragging || this._pointerType !== 'mouse') return;
        this._handleMove(e.clientX, e.clientY);
    }

    _onMouseUp(e) {
        if (!this._dragging || this._pointerType !== 'mouse') return;
        this._handleUp();
    }

    /* ─── Touch handlers ─────────────────────────────────────── */

    _onTouchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            this._startPinch(e);
            return;
        }
        if (e.touches.length !== 1 || this._pinching) return;
        e.preventDefault();
        const touch = e.touches[0];
        this._dragging    = true;
        this._momentum    = false;
        this._stopLoop();
        this._pointerType = 'touch';
        this._velYaw      = 0;
        this._velPitch    = 0;
        this._lastX       = touch.clientX;
        this._lastY       = touch.clientY;
        this._lastT       = performance.now();
    }

    _onTouchMove(e) {
        if (this._pinching) {
            if (e.touches.length < 2) return;
            e.preventDefault();
            this._updatePinch(e);
            return;
        }
        if (!this._dragging || this._pointerType !== 'touch') return;
        if (e.touches.length !== 1) return;
        e.preventDefault();
        const touch = e.touches[0];
        this._handleMove(touch.clientX, touch.clientY);
    }

    _onTouchEnd(e) {
        if (this._pinching) {
            if (e.touches.length >= 2) return; // still pinching
            this._endPinch();
            return;
        }
        if (!this._dragging || this._pointerType !== 'touch') return;
        this._handleUp();
    }

    _startPinch(e) {
        if (e.touches.length < 2) return;
        this._pinching = true;
        this._dragging = false;
        this._momentum = false;
        this._stopLoop();
        const [a, b] = [e.touches[0], e.touches[1]];
        this._pinchStartDist = this._touchDistance(a, b) || 0;
        this._pinchStartFov  = this.viewer.view()?.fov() ?? 1.2;
        this._pointerType = 'touch';
    }

    _updatePinch(e) {
        if (!this._pinching || e.touches.length < 2) return;
        const view = this.viewer.view();
        if (!view) return;
        const dist = this._touchDistance(e.touches[0], e.touches[1]);
        if (!dist || !this._pinchStartDist) return;
        const ratio = dist / this._pinchStartDist;
        if (ratio <= 0) return;
        const exponent = this.cfg.zoomSpeedTouch;
        const scaled = Math.pow(ratio, exponent);
        const baseFov = this._pinchStartFov || view.fov();
        const targetFov = this._clampFov(baseFov / scaled);
        view.setFov(targetFov);
    }

    _endPinch() {
        this._pinching = false;
        this._pinchStartDist = 0;
        this._pinchStartFov = 0;
    }

    _touchDistance(a, b) {
        const dx = (a?.clientX ?? 0) - (b?.clientX ?? 0);
        const dy = (a?.clientY ?? 0) - (b?.clientY ?? 0);
        return Math.hypot(dx, dy);
    }

    _clampFov(value) {
        const minFov = this.fovLimits.minFov ?? 0.35;
        const maxFov = this.fovLimits.maxFov ?? 1.92;
        return clamp(value, minFov, maxFov);
    }

    _applyZoomFactor(factor) {
        if (!isFinite(factor) || factor <= 0) return;
        const view = this.viewer.view();
        if (!view) return;
        const current = view.fov();
        const target = this._clampFov(current * factor);
        if (Math.abs(target - current) < 0.00005) return;
        view.setFov(target);
    }

    _onWheel(e) {
        const view = this.viewer.view();
        if (!view) return;
        e.preventDefault();
        let deltaY = e.deltaY;
        if (e.deltaMode === 1) deltaY *= 40; // lines → pixels
        else if (e.deltaMode === 2) {
            const h = this.pano.clientHeight || window.innerHeight || 800;
            deltaY *= h;
        }
        deltaY = clamp(deltaY, -600, 600);
        if (!deltaY) return;
        const factor = Math.exp(deltaY * this.cfg.zoomSpeedMouse);
        this._applyZoomFactor(factor);
        // Stop any momentum so wheel zoom feels snappy
        this._momentum = false;
        this._velYaw = 0;
        this._velPitch = 0;
        this._stopLoop();
    }

    /* ─── Shared move/up logic ───────────────────────────────── */

    _handleMove(clientX, clientY) {
        const now = performance.now();
        const dt  = now - this._lastT;
        if (dt <= 0) return;

        const view = this.viewer.view();
        if (!view) return;

        // Raw pixel deltas
        const deltaX = clientX - this._lastX;
        const deltaY = clientY - this._lastY;

        // Select input scale based on pointer type
        const inputScale = this._pointerType === 'touch'
            ? this.cfg.inputScaleTouch
            : this.cfg.inputScaleMouse;

        // Convert pixel deltas to radians (approximate: depends on FOV/viewport)
        // Using a factor that feels natural at typical FOV
        const fov = view.fov();
        const width  = this.pano.clientWidth  || 1;
        const height = this.pano.clientHeight || 1;
        const pixToRad = fov / Math.max(width, height);

        // Apply input scale BEFORE physics (as specified)
        const dYaw   = -deltaX * pixToRad * inputScale;
        const dPitch = -deltaY * pixToRad * inputScale;

        // Apply scaled deltas to camera
        view.offsetYaw(dYaw);
        view.offsetPitch(dPitch);

        // Clamp pitch to limits during drag
        const { minPitch, maxPitch } = this.limits;
        const currentPitch = view.pitch();
        if (currentPitch < minPitch) view.setPitch(minPitch);
        if (currentPitch > maxPitch) view.setPitch(maxPitch);

        // Accumulate velocity for momentum (using scaled deltas)
        // Formula: velYaw += deltaX * inputScale * yawSpeed (effectively)
        const a = 0.3; // smoothing factor
        this._velYaw   = this._velYaw   * (1 - a) + (dYaw   / dt) * a * this.cfg.yawSpeed;
        this._velPitch = this._velPitch * (1 - a) + (dPitch / dt) * a * this.cfg.pitchSpeed;

        // Hard-cap velocity
        this._velYaw   = clamp(this._velYaw,   -this.cfg.maxYawVel,   this.cfg.maxYawVel);
        this._velPitch = clamp(this._velPitch, -this.cfg.maxPitchVel, this.cfg.maxPitchVel);

        this._lastX = clientX;
        this._lastY = clientY;
        this._lastT = now;
    }

    _handleUp() {
        if (!this._dragging) return;
        this._dragging = false;

        // Only kick off momentum if velocity is meaningful
        if (Math.abs(this._velYaw) > 0.00001 || Math.abs(this._velPitch) > 0.00001) {
            this._momentum = true;
            this._ensureLoop();
        }
        this._lastT = performance.now();
    }

    /** Runs every frame via requestAnimationFrame. */
    _tick() {
        const now  = performance.now();
        const view = this.viewer.view();
        const activeMomentum = this._momentum && !this._dragging;

        if (!view) {
            this._lastT = now;
            if (activeMomentum) this._rafId = requestAnimationFrame(this._tick);
            else this._rafId = null;
            return;
        }

        const dt = now - this._lastT;
        this._lastT = now;

        // Guard: skip enormous dt (tab hidden, debugger pause, etc.)
        if (dt <= 0 || dt > 200) {
            if (activeMomentum) this._rafId = requestAnimationFrame(this._tick);
            else this._rafId = null;
            return;
        }

        let keepLoop = activeMomentum;

        /* ─── Momentum phase: apply decaying velocity after drag release ─ */
        if (activeMomentum) {
            // Exponential friction normalised to 60 fps so the "feel"
            // is frame-rate-independent.
            const f = Math.pow(this.cfg.friction, dt / 16.667);
            this._velYaw   *= f;
            this._velPitch *= f;

            const dyaw   = this._velYaw * dt;
            let   dpitch = this._velPitch * dt;

            /* ── Soft pitch clamping ──────────────────────────────
             * Instead of a hard stop at the limit, a "spring zone"
             * progressively damps pitch velocity so the camera
             * decelerates naturally into the boundary.
             *
             *    maxPitch - zone ───── maxPitch
             *          ↑                  ↑
             *     spring starts      hard limit
             * ──────────────────────────────────────────────────── */
            if (this.cfg.softClamp) {
                const pitch = view.pitch();
                const { minPitch, maxPitch } = this.limits;
                const zone = this.cfg.softClampZone;
                const k    = this.cfg.softClampK;

                // Near upper limit and still moving upward
                if (pitch > maxPitch - zone && dpitch > 0) {
                    const t = (pitch - (maxPitch - zone)) / zone; // 0 → 1
                    dpitch *= Math.max(0, 1 - t * k * (dt / 16.667));
                    this._velPitch *= 0.9;  // extra damping near edge
                }
                // Near lower limit and still moving downward
                if (pitch < minPitch + zone && dpitch < 0) {
                    const t = ((minPitch + zone) - pitch) / zone; // 0 → 1
                    dpitch *= Math.max(0, 1 - t * k * (dt / 16.667));
                    this._velPitch *= 0.9;
                }
            }

            // Apply this frame's velocity to the view
            view.offsetYaw(dyaw);
            view.offsetPitch(dpitch);

            // Strictly clamp pitch to limits after offset
            const { minPitch, maxPitch } = this.limits;
            const clampedPitch = clamp(view.pitch(), minPitch, maxPitch);
            if (clampedPitch !== view.pitch()) {
                view.setPitch(clampedPitch);
                this._velPitch = 0; // kill velocity if limit hit
            }

            // Stop when velocity is negligible
            if (Math.abs(this._velYaw) < 0.000005 && Math.abs(this._velPitch) < 0.000005) {
                this._momentum = false;
                this._velYaw   = 0;
                this._velPitch = 0;
                keepLoop = false;
            }
        }

        if (keepLoop) this._rafId = requestAnimationFrame(this._tick);
        else this._rafId = null;
    }
}