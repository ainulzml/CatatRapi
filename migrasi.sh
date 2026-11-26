#!/bin/bash
# JALANKAN DI CODESPACES - ROOT REPO ainulzml/CatatRapi (branch main)
set -e
git checkout main
git pull origin main

echo "1. Buat functions/api.js (Cloudflare Pages)"
mkdir -p functions
cat > functions/api.js <<'EOF'
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
EOF
echo "✓ functions/api.js dibuat"

echo "2. Buat _headers (pengganti netlify.toml headers)"
cat > _headers <<'EOF'
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; connect-src 'self' https://www.googleapis.com https://accounts.google.com; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; frame-src https://accounts.google.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
EOF
echo "✓ _headers dibuat"

echo "3. Buat _redirects (blokir akses backend)"
cat > _redirects <<'EOF'
/google-apps-script/*  /404  404
/netlify/*  /404  404
/DEPLOY-*  /404  404
EOF
echo "✓ _redirects dibuat"

echo ""
git add functions/api.js _headers _redirects
git status
git commit -m "Migrasi Cloudflare Pages: functions/api + _headers/_redirects"
git push origin main
echo ""
echo "Selesai — Cloudflare Pages akan auto-deploy"
echo "Jangan lupa di Cloudflare Pages → Variables: GAS_WEB_APP_URL = https://script.google.com/macros/s/XXXX/exec (copy dari Netlify)"

