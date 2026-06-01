export default {
  async fetch(request, env) {

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ── Guard: R2 binding must exist ────────────────────────────────────────
    if (!env.ASSETS) {
      return new Response(
        'Misconfiguration: R2 binding "ASSETS" is missing.\n' +
        'Workers → ekman-studio → Settings → Bindings → Add R2 bucket named ASSETS.',
        { status: 500, headers: { 'Content-Type': 'text/plain' } }
      );
    }

    const url = new URL(request.url);
    let key = url.pathname.slice(1); // strip leading /

    // Trailing-slash → serve index.html
    if (!key || key === '') key = 'index.html';
    if (key.endsWith('/')) key = key + 'index.html';

    // ── 1. Try exact key first ──────────────────────────────────────────────
    let object = await env.ASSETS.get(key);

    // ── 2. Directory fallback (path with no extension → try /index.html) ───
    if (!object && !key.includes('.')) {
      object = await env.ASSETS.get(key + '/index.html');
      if (object) key = key + '/index.html';
    }

    // ── 3. Media remap ──────────────────────────────────────────────────────
    // Panos and products are stored at root-level in R2:
    //   panos/entrance.jpeg
    //   products/block1/...
    // But the viewer requests them relative to the tour page, so the full key is:
    //   clients/neelkanth/tours/showroom/panos/entrance.jpeg
    // Strip everything before panos/ or products/ and retry.
    if (!object) {
      const mediaMatch = key.match(/(?:^|\/)(panos(?:_high_quality)?\/.*|products\/.*)$/);
      if (mediaMatch) {
        const remappedKey = mediaMatch[1];
        object = await env.ASSETS.get(remappedKey);
        if (object) key = remappedKey;
      }
    }

    // ── 4. SPA fallback ─────────────────────────────────────────────────────
    if (!object) {
      const fallback = await env.ASSETS.get('index.html');
      if (!fallback) {
        return new Response(`Not found: /${key}`, { status: 404, headers: corsHeaders() });
      }
      return new Response(fallback.body, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() }
      });
    }

    const ext = key.split('.').pop().toLowerCase();
    return new Response(object.body, {
      status: 200,
      headers: { 'Content-Type': mimeType(ext), ...corsHeaders() }
    });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function mimeType(ext) {
  return {
    html:  'text/html; charset=utf-8',
    css:   'text/css; charset=utf-8',
    js:    'application/javascript; charset=utf-8',
    json:  'application/json; charset=utf-8',
    jpg:   'image/jpeg',
    jpeg:  'image/jpeg',
    png:   'image/png',
    webp:  'image/webp',
    gif:   'image/gif',
    svg:   'image/svg+xml',
    ico:   'image/x-icon',
    woff:  'font/woff',
    woff2: 'font/woff2',
    ttf:   'font/ttf',
  }[ext] ?? 'application/octet-stream';
}