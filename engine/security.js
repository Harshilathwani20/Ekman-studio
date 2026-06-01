// Client-side password verification and redirect
// Edit `clients/registry.json` to add/remove clients and their config paths.
// Edit `clients/<slug>/client.json` to change branding and password→tour mappings.
// For production, prefer using `sha256` entries over plaintext.
import { fetchJson, sha256Hex, redirect } from './utils.js';

/**
 * Load the clients registry (lists available clients and their config paths).
 */
async function loadClients() {
    try {
        const registry = await fetchJson('clients/registry.json');
        console.log('[security] Loaded registry:', registry);
        const list = registry.clients || [];
        console.log('[security] Clients:', list.map(c => c.slug));
        return list;
    } catch (e) {
        throw new Error('Failed to load clients registry');
    }
}

/**
 * Check a password against a client's config.
 * Supports entries like { plain:"demo123", tour:"showroom" } or { sha256:"...", tour:"..." }.
 */
async function checkClientPassword(client, password) {
    let cfg;
    try {
        cfg = await fetchJson(client.config);
        console.log(`[security] Loaded client config for ${client.slug}:`, cfg);
    } catch (e) {
        throw new Error(`Failed to load client config for ${client.slug}`);
    }
    const methods = cfg.passwords || [];
    const hash = await sha256Hex(password);
    for (const entry of methods) {
        // Support either plaintext or sha256 entries
        if (entry.plain && entry.plain === password) {
            return { client: client.slug, tour: entry.tour };
        }
        if (entry.sha256 && entry.sha256.toLowerCase() === hash.toLowerCase()) {
            return { client: client.slug, tour: entry.tour };
        }
    }
    return null;
}

/**
 * Attempt verification against all clients and redirect to the matched tour.
 * Returns true on redirect, false otherwise.
 */
export async function verifyPasswordAndRedirect(password, onError) {
    try {
        const clients = await loadClients();
        for (const c of clients) {
            const match = await checkClientPassword(c, password);
            if (match) {
                const url = `clients/${match.client}/tours/${match.tour}/`;
                console.log('[security] Redirecting to:', url);
                redirect(url);
                return true;
            }
        }
        if (onError) onError('Invalid password.');
        return false;
    } catch (e) {
        console.error(e);
        if (onError) onError(e.message || 'Verification failed.');
        return false;
    }
}

/**
 * Attach submit handler to the landing form (#login-form).
 * Edits needed: none; this reads the password field and calls verification.
 */
export function wireLandingForm() {
    const form = document.querySelector('#login-form');
    const input = document.querySelector('#password');
    const status = document.querySelector('#status');
    if (!form || !input) return;
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        status.textContent = '';
        const pwd = input.value.trim();
        if (!pwd) {
            status.textContent = 'Enter a password.';
            return;
        }
        form.querySelector('button[type="submit"]').disabled = true;
        const ok = await verifyPasswordAndRedirect(pwd, (msg) => status.textContent = msg);
        if (!ok) form.querySelector('button[type="submit"]').disabled = false;
    });
}
