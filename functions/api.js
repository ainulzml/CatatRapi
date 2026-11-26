// Cloudflare Pages Function — same-origin API proxy for CatatRapi
const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin'
};
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed.' }), { status: 405, headers: { ...HEADERS, allow: 'POST' } });
  }
  const upstreamUrl = env.GAS_WEB_APP_URL;
  if (!upstreamUrl || !/^https:\/\/script\.google\.com\//.test(upstreamUrl)) {
    return new Response(JSON.stringify({ ok: false, error: 'Server belum dikonfigurasi.' }), { status: 503, headers: HEADERS });
  }
  const raw = await request.text();
  if (!raw || raw.length > 250000) {
    return new Response(JSON.stringify({ ok: false, error: 'Permintaan tidak valid.' }), { status: 400, headers: HEADERS });
  }
  try { JSON.parse(raw); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Format data harus JSON.' }), { status: 400, headers: HEADERS });
  }
  try {
    const response = await fetch(upstreamUrl, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: raw, redirect: 'follow' });
    const body = await response.text();
    return new Response(body, { status: response.ok ? 200 : response.status, headers: HEADERS });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Koneksi ke layanan data sedang bermasalah.' }), { status: 502, headers: HEADERS });
  }
}
