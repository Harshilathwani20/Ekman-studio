Admin.js Core Tasks
1. Authentication System
Detects ?admin parameter in URL
Shows password dialog with SHA-256/plaintext verification against client.json
Maintains session state in sessionStorage (ekadmin_session)
Auto-activates on return visits during same session
2. Real-Time Settings Panel
Scene limits: Pitch/yaw/FOV ranges, drag sensitivity sliders
Initial camera: Starting yaw/pitch/roll/FOV for each scene
Live preview: Changes apply instantly to active scene
Validation: Auto-corrects invalid ranges (min>max, out-of-bounds)
3. Hotspot Placement System
Interactive capture: Press H + click to get yaw/pitch coordinates
Types: Link (scene navigation), Product, Bubble (info)
Management: Add/delete admin hotspots separate from JSON hotspots
Live rendering: New hotspots appear immediately in viewer
4. Data Persistence (localStorage)
ekadmin_limits_<sceneKey>: Per-scene limit overrides
ekadmin_initials_<sceneKey>: Initial camera positions
ekadmin_hotspots_<sceneKey>: Admin-added hotspots
Layer priority: Admin overrides → tour.json → global defaults
5. Export & Development Tools
Data export: Copy all scenes to clipboard or download JSON
Dev-server sync: Auto-saves to tour.json files (localhost only, safe for production)
Developer integration: Automatically enables all DEV keyboard helpers
6. Key Public Functions
initAdmin(ctx, onLimitsChanged) — Initialize with viewer context
getEffectiveLimits/Initials/Hotspots() — Merge admin + JSON data
onSceneSwitch() — Update panel when scenes change
onHotspotPositionCaptured() — Receive H+click coordinates
The admin system provides a complete GUI for tour configuration without requiring file system access, making it perfect for client-side tour management with optional development server integration.