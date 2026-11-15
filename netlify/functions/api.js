// Netlify Function — same-origin API proxy for CatatRapi.
// Add GAS_WEB_APP_URL in Netlify: Project configuration > Environment variables.
// The value is a secret and must never be written to app.js, HTML, or GitHub.

const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin'
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {statusCode:405, headers:{...HEADERS, allow:'POST'}, body:JSON.stringify({ok:false,error:'Method not allowed.'})};
  }

  const upstreamUrl = process.env.GAS_WEB_APP_URL;
  if (!upstreamUrl || !/^https:\/\/script\.google\.com\//.test(upstreamUrl)) {
    return {statusCode:503, headers:HEADERS, body:JSON.stringify({ok:false,error:'Server belum dikonfigurasi.'})};
  }

  const raw = event.body || '';
  if (!raw || raw.length > 250000) {
    return {statusCode:400, headers:HEADERS, body:JSON.stringify({ok:false,error:'Permintaan tidak valid.'})};
  }
  try { JSON.parse(raw); }
  catch { return {statusCode:400, headers:HEADERS, body:JSON.stringify({ok:false,error:'Format data harus JSON.'})}; }

  try {
    // Netlify calls Apps Script server-to-server. Browser calls only same-origin /api.
    const response = await fetch(upstreamUrl, {
      method:'POST',
      headers:{'content-type':'text/plain;charset=utf-8'},
      body:raw,
      redirect:'follow'
    });
    const body = await response.text();
    return {statusCode:response.ok ? 200 : response.status, headers:HEADERS, body};
  } catch {
    return {statusCode:502, headers:HEADERS, body:JSON.stringify({ok:false,error:'Koneksi ke layanan data sedang bermasalah.'})};
  }
};
