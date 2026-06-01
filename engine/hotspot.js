// Hotspot Helpers
// Exports: createLinkHotspot, createProductHotspot, createBubbleHotspot

export function createLinkHotspot(scene, cfg = {}) {
    const container = scene.hotspotContainer();
    const el = document.createElement('div');
    
    // Main hotspot element handles positioning only
    el.className = 'mz-hotspot';
    
    // Create inner wrapper for visual orientation
    const inner = document.createElement('div');
    const orientation = cfg.orientation || 'wall';
    const orientationClass = orientation === 'floor' ? 'hotspot-floor' : 'hotspot-wall';
    inner.className = `ring-hotspot ${orientationClass}`;
    
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.title = cfg.label || '';

    const span = document.createElement('span');
    inner.appendChild(span);
    
    // Append the inner wrapper to the main element
    el.appendChild(inner);

    const activate = (evt) => {
        if (!cfg.onClick) return;
        cfg.onClick(evt, el);
    };

    el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activate(e);
    });
    el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            activate(ev);
        }
    });

    return container.createHotspot(el, { yaw: (typeof cfg.yaw === 'number') ? cfg.yaw : 0, pitch: (typeof cfg.pitch === 'number') ? cfg.pitch : 0 });
}

export function createProductHotspot(scene, cfg = {}) {
    const container = scene.hotspotContainer();
    const el = document.createElement('div');
    el.className = 'mz-hotspot ring-hotspot product-ring';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.title = cfg.label || '';

    const span = document.createElement('span');
    el.appendChild(span);

    if (cfg.label) {
        const labelEl = document.createElement('div');
        labelEl.className = 'mz-label';
        labelEl.textContent = cfg.label;
        el.appendChild(labelEl);
    }

    const activate = (evt) => {
        if (!cfg.onClick) return;
        cfg.onClick(evt, el);
    };

    el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activate(e);
    });
    el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            activate(ev);
        }
    });

    return container.createHotspot(el, { yaw: (typeof cfg.yaw === 'number') ? cfg.yaw : 0, pitch: (typeof cfg.pitch === 'number') ? cfg.pitch : 0 });
}

export function createBubbleHotspot(scene, cfg = {}) {
    const container = scene.hotspotContainer();
    const el = document.createElement('div');
    el.className = 'hotspot bubble';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.title = cfg.label || '';

    const icon = document.createElement('span');
    icon.className = 'bubble-icon';
    icon.textContent = 'i';
    el.appendChild(icon);

    if (cfg.label) {
        const labelEl = document.createElement('div');
        labelEl.className = 'mz-label';
        labelEl.textContent = cfg.label;
        el.appendChild(labelEl);
    }

    const activate = (evt) => {
        if (!cfg.onClick) return;
        cfg.onClick(evt, el);
    };

    el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activate(e);
    });
    el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            activate(ev);
        }
    });

    return container.createHotspot(el, { yaw: (typeof cfg.yaw === 'number') ? cfg.yaw : 0, pitch: (typeof cfg.pitch === 'number') ? cfg.pitch : 0 });
}