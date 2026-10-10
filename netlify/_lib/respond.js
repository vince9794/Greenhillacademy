/* ============================================================
   Netlify Functions — response + request helpers
   Every handler returns { statusCode, headers, body }.
   ============================================================ */

function json(status, body, headers) {
  return {
    statusCode: status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      headers || {}
    ),
    body: JSON.stringify(body)
  };
}

/* Binary response (uploaded images) — base64 + long cache. */
function imageResponse(status, buf, contentType, headers) {
  return {
    statusCode: status,
    headers: Object.assign(
      {
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Netlify-Cdn-Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      },
      headers || {}
    ),
    body: Buffer.from(buf).toString('base64'),
    isBase64Encoded: true
  };
}

/* Raw request body as a Buffer.
   Netlify base64-encodes binary content types (isBase64Encoded=true);
   if a proxy ever passes binary as text we fall back to latin1, which
   round-trips byte values exactly. */
function rawBody(event) {
  if (!event.body) return Buffer.alloc(0);
  if (event.isBase64Encoded) return Buffer.from(event.body, 'base64');
  const ct = String((event.headers || {})['content-type'] || '');
  if (/octet-stream|image\/|multipart\//i.test(ct)) return Buffer.from(event.body, 'latin1');
  return Buffer.from(event.body, 'utf8');
}

/* Parsed JSON body ({} when empty/invalid). */
function bodyJSON(event) {
  const buf = rawBody(event);
  if (!buf || !buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { return {}; }
}

function query(event, name) {
  const q = event.queryStringParameters || {};
  return q[name] !== undefined && q[name] !== null ? String(q[name]) : '';
}

function getIP(event) {
  const h = event.headers || {};
  const forwarded = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return h['x-nf-client-connection-ip'] || forwarded || h['x-real-ip'] || 'unknown';
}

/* Wrap a handler so any thrown error becomes a readable JSON 500
   (instead of Netlify's opaque 502 page) and is written to the
   function logs. */
function wrapHandler(handler) {
  return async function wrapped(event, context) {
    try {
      return await handler(event, context);
    } catch (e) {
      const msg = String((e && e.message) || e);
      console.error('function error:', (e && e.stack) || e);
      let hint = '';
      if (e && e.name === 'MissingBlobsEnvironmentError') {
        hint = ' Netlify Blobs is not available in this deployment — the site was most likely uploaded by drag-and-drop, which cannot run functions. Redeploy with "npm run deploy" (Netlify CLI) or a Git-based deploy.';
      }
      return json(500, { error: 'Server error: ' + msg + '.' + hint });
    }
  };
}

module.exports = { json, imageResponse, rawBody, bodyJSON, query, getIP, wrapHandler };
