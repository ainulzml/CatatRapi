/*
 * CatatRapi — Google Drive milik pengguna
 *
 * Data keuangan berjalan langsung dari browser ke Google Sheets yang dibuat di
 * Google Drive pengguna. Tidak ada token Google jangka panjang atau payload
 * finansial yang dikirim ke Apps Script/Netlify.
 *
 * OAuth Client ID bersifat publik untuk aplikasi web; ini BUKAN client secret.
 * Jangan pernah menaruh Google OAuth Client Secret di proyek frontend.
 */
(function () {
  'use strict';

  const GOOGLE_CLIENT_ID = '488094698080-6fmo08qtnva9lk83nmuo3ccnm5go3kdc.apps.googleusercontent.com';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API_BASE = 'https://www.googleapis.com';
  const BINDING_PREFIX = 'catatrapi_drive_binding_v1_';
  const TOKEN_PREFIX = 'catatrapi_drive_token_v1_';
  const SHEET_NAMES = ['CR_META', 'CR_BOOKS', 'CR_ACCOUNTS', 'CR_JOURNALS', 'CR_JOURNAL_LINES', 'CR_BUDGETS', 'CR_AUDIT_LOG'];
  const FINANCIAL_ACTIONS = new Set(['bootstrap', 'createBook', 'createAccount', 'createJournal', 'voidJournal', 'correctJournal', 'createBudget', 'shareBook']);
  const DEFAULT_ACCOUNTS = [
    ['1100','Kas','asset'],['1110','Bank','asset'],['1120','Piutang Usaha','asset'],['1130','Persediaan','asset'],['1210','Peralatan','asset'],
    ['2100','Utang Usaha','liability'],['2200','Utang Bank','liability'],['3100','Modal Pemilik','equity'],['3200','Saldo Laba','equity'],
    ['4100','Pendapatan Usaha','income'],['4200','Pendapatan Lainnya','income'],['5100','Harga Pokok Penjualan','expense'],['6100','Beban Sewa','expense'],['6200','Beban Utilitas','expense'],['6300','Beban Gaji','expense'],['6400','Beban Transportasi','expense'],['6500','Beban Lainnya','expense'],['6600','Beban Pajak','expense']
  ];

  let activeUser = null;
  let spreadsheetId = '';
  let accessToken = '';
  let expiresAt = 0;
  let tokenClient = null;

  function id(prefix) {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Date.now().toString(36)}${Array.from(bytes, b => b.toString(36)).join('').slice(0,14)}`;
  }
  function now() { return new Date().toISOString(); }
  function bindingKey(userId) { return BINDING_PREFIX + userId; }
  function tokenKey(userId) { return TOKEN_PREFIX + userId; }
  function hasAccessToken() { return Boolean(activeUser && accessToken && Date.now() < expiresAt); }
  function isActive() { return Boolean(hasAccessToken() && spreadsheetId); }
  function activeFileId() { return spreadsheetId; }
  function clearToken(userId = activeUser?.id) {
    accessToken = '';
    expiresAt = 0;
    if (userId) sessionStorage.removeItem(tokenKey(userId));
  }
  function readRememberedToken(user) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(tokenKey(user.id)) || 'null');
      if (saved && saved.accessToken && Number(saved.expiresAt) > Date.now() + 15000) {
        accessToken = saved.accessToken;
        expiresAt = Number(saved.expiresAt);
        return true;
      }
    } catch (_) { /* invalid old session token */ }
    return false;
  }
  function rememberToken(user, response) {
    accessToken = response.access_token;
    expiresAt = Date.now() + Math.max(1, Number(response.expires_in || 3600) - 60) * 1000;
    sessionStorage.setItem(tokenKey(user.id), JSON.stringify({accessToken, expiresAt}));
  }
  function tokenErrorMessage(error) {
    const code = error?.code || error?.error || '';
    if (code === 'popup_closed' || code === 'popup_closed_by_user') return 'Penghubungan Google Drive dibatalkan.';
    if (code === 'access_denied') return 'Izin Google Drive diperlukan agar CatatRapi dapat menyimpan file Anda sendiri.';
    return 'Google Drive belum dapat dihubungkan. Pastikan Anda memakai browser biasa, bukan mode private, dan coba kembali.';
  }
  function requireGis() {
    if (!window.google?.accounts?.oauth2) throw new Error('Komponen Google sedang dimuat. Tunggu sebentar lalu klik Hubungkan Google Drive lagi.');
  }
  function authorize(user, interactive) {
    activeUser = user;
    if (hasAccessToken()) return Promise.resolve(accessToken);
    requireGis();
    return new Promise((resolve, reject) => {
      const callback = (response) => {
        if (response?.error) { reject(new Error(tokenErrorMessage(response))); return; }
        if (!response?.access_token) { reject(new Error('Google tidak memberikan izin akses Drive.')); return; }
        rememberToken(user, response);
        resolve(accessToken);
      };
      tokenClient = google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID, scope:DRIVE_SCOPE, callback, error_callback:(error) => reject(new Error(tokenErrorMessage(error)))});
      // Pertama kali akan membuka layar persetujuan. Pada akses berikutnya Google
      // biasanya memakai sesi Google yang masih aktif tanpa meminta email/PIN lagi.
      tokenClient.requestAccessToken(interactive ? {} : {prompt:''});
    });
  }
  async function api(path, options = {}) {
    if (!hasAccessToken()) throw new Error('Akses Google Drive perlu diperbarui. Klik Hubungkan Google Drive lalu coba lagi.');
    const headers = {...(options.headers || {}), Authorization:`Bearer ${accessToken}`};
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    let response;
    try { response = await fetch(API_BASE + path, {...options, headers}); }
    catch (_) { throw new Error('Tidak dapat menghubungi Google Drive. Periksa koneksi internet Anda.'); }
    if (response.status === 401 || response.status === 403) {
      clearToken();
      throw new Error('Akses Google Drive telah berakhir. Klik Hubungkan Google Drive untuk melanjutkan.');
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json?.error?.message || 'Google Drive menolak permintaan ini.');
    return json;
  }
  function bindingFor(user) {
    try { return JSON.parse(localStorage.getItem(bindingKey(user.id)) || 'null'); }
    catch (_) { return null; }
  }
  function rememberBinding(user, file) {
    spreadsheetId = file.id;
    localStorage.setItem(bindingKey(user.id), JSON.stringify({id:file.id, name:file.name || 'CatatRapi — Data Keuangan', savedAt:now()}));
  }
  async function findWorkbook(user) {
    const saved = bindingFor(user);
    if (saved?.id) {
      try {
        const file = await api(`/drive/v3/files/${encodeURIComponent(saved.id)}?fields=id,name,mimeType,trashed`);
        if (file?.id && !file.trashed && file.mimeType === 'application/vnd.google-apps.spreadsheet') return file;
      } catch (error) {
        // A stale local binding is normal after a file was removed or Drive access revoked.
        if (!/Akses Google Drive/.test(error.message)) localStorage.removeItem(bindingKey(user.id));
        if (/Akses Google Drive/.test(error.message)) throw error;
      }
    }
    const query = `appProperties has { key='catatrapiStorage' and value='v1' } and appProperties has { key='catatrapiOwner' and value='${String(user.id).replace(/'/g, "\\'")}' } and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const params = new URLSearchParams({q:query, spaces:'drive', pageSize:'10', orderBy:'modifiedTime desc', fields:'files(id,name,mimeType,modifiedTime)'});
    const result = await api('/drive/v3/files?' + params.toString());
    return result.files?.[0] || null;
  }
  async function tagWorkbook(user, fileId) {
    return api(`/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name`, {method:'PATCH', body:JSON.stringify({appProperties:{catatrapiStorage:'v1', catatrapiOwner:String(user.id)}})});
  }
  async function createWorkbook(user) {
    const body = {
      properties:{title:'CatatRapi — Data Keuangan'},
      sheets:SHEET_NAMES.map(title => ({properties:{title}}))
    };
    const file = await api('/v4/spreadsheets', {method:'POST', body:JSON.stringify(body)});
    await tagWorkbook(user, file.spreadsheetId);
    return {id:file.spreadsheetId, name:file.properties?.title || 'CatatRapi — Data Keuangan'};
  }
  function rows(items) { return (items || []).map(item => [JSON.stringify(item)]); }
  function fromRows(values, label) {
    return (values || []).map((row, index) => {
      try { return JSON.parse(row?.[0] || ''); }
      catch (_) { throw new Error(`Data ${label} pada baris ${index + 2} tidak dapat dibaca. Jangan ubah sheet internal CatatRapi secara manual.`); }
    }).filter(Boolean);
  }
  function initialData(user) {
    const book = {id:id('book'), ownerId:user.id, name:'Buku Pribadi', type:'personal', year:new Date().getFullYear(), currency:'IDR', createdAt:now()};
    const accounts = DEFAULT_ACCOUNTS.map(([code, name, type]) => ({id:id('acc'), bookId:book.id, code, name, type, active:true, createdAt:now()}));
    return {user:{id:user.id, name:user.name, username:user.username}, users:[{id:user.id,name:user.name,username:user.username}], books:[book], members:[], accounts, journals:[], journalLines:[], budgets:[], audit:[{id:id('aud'),at:now(),userId:user.id,action:'CREATE_STORAGE',detail:'Workbook Google Drive pribadi dibuat'}]};
  }
  async function readData(user) {
    const ranges = SHEET_NAMES.filter(name => name !== 'CR_META').map(name => `${name}!A2:A`);
    const params = new URLSearchParams();
    ranges.forEach(range => params.append('ranges', range));
    params.set('majorDimension', 'ROWS');
    const response = await api(`/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params.toString()}`);
    const maps = Object.fromEntries((response.valueRanges || []).map(item => [String(item.range || '').split('!')[0], item.values || []]));
    const data = {
      user:{id:user.id,name:user.name,username:user.username},
      users:[{id:user.id,name:user.name,username:user.username}],
      books:fromRows(maps.CR_BOOKS, 'buku'),
      members:[],
      accounts:fromRows(maps.CR_ACCOUNTS, 'akun'),
      journals:fromRows(maps.CR_JOURNALS, 'jurnal'),
      journalLines:fromRows(maps.CR_JOURNAL_LINES, 'baris jurnal'),
      budgets:fromRows(maps.CR_BUDGETS, 'anggaran'),
      audit:fromRows(maps.CR_AUDIT_LOG, 'audit')
    };
    return data.books.length ? data : null;
  }
  async function writeData(db, user = activeUser) {
    const clearRanges = SHEET_NAMES.filter(name => name !== 'CR_META').map(name => `${name}!A2:A`);
    await api(`/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`, {method:'POST', body:JSON.stringify({ranges:clearRanges})});
    const meta = [
      ['schemaVersion','1'],
      ['storage','CatatRapi user-owned Google Drive'],
      ['ownerId',String(user.id)],
      ['updatedAt',now()]
    ];
    const data = [{range:'CR_META!A1', values:meta}];
    const sections = [
      ['CR_BOOKS', db.books], ['CR_ACCOUNTS', db.accounts], ['CR_JOURNALS', db.journals],
      ['CR_JOURNAL_LINES', db.journalLines], ['CR_BUDGETS', db.budgets], ['CR_AUDIT_LOG', db.audit]
    ];
    sections.forEach(([sheet, list]) => { if (list?.length) data.push({range:`${sheet}!A2`, values:rows(list)}); });
    await api(`/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {method:'POST', body:JSON.stringify({valueInputOption:'RAW', data})});
  }
  async function connect(user) {
    activeUser = user;
    // A fresh explicit connection is a user gesture, so Google can present consent
    // only when required. It never shares an OAuth Client Secret with the browser.
    await authorize(user, true);
    let file = await findWorkbook(user);
    if (!file) file = await createWorkbook(user);
    rememberBinding(user, file);
    let data = await readData(user);
    if (!data) { data = initialData(user); await writeData(data, user); }
    return data;
  }
  async function resume(user) {
    activeUser = user;
    const binding = bindingFor(user);
    if (!binding?.id || !readRememberedToken(user)) return null;
    spreadsheetId = binding.id;
    try {
      const data = await readData(user);
      if (!data) return null;
      return data;
    } catch (error) {
      clearToken(user);
      return null;
    }
  }
  function handles(action) { return isActive() && FINANCIAL_ACTIONS.has(action); }
  async function handle(action, data, context) {
    if (action === 'bootstrap') return readData(activeUser);
    if (action === 'shareBook') throw new Error('Berbagi buku melalui Google Drive sedang disiapkan. Pada model satu spreadsheet, berbagi file akan memberi akses ke semua buku di dalamnya.');
    if (!context?.localApi || !context?.state?.db) throw new Error('Penyimpanan Google Drive belum siap.');
    const result = await context.localApi(action, data);
    await writeData(context.state.db, activeUser);
    // localApi is reused for its accounting and correction validation. Do not retain a
    // duplicate plaintext financial database in localStorage while Drive storage is active.
    if (context.dbKey) localStorage.removeItem(context.dbKey);
    return result;
  }
  function deactivate() {
    // End the in-memory association on CatatRapi logout, but keep the short-lived
    // browser-session Google access token. The same user can return without an
    // additional Google prompt while that token remains valid.
    activeUser = null;
    spreadsheetId = '';
    accessToken = '';
    expiresAt = 0;
  }
  function disconnectLocal(user = activeUser) {
    clearToken(user?.id);
    deactivate();
  }

  window.CatatRapiDriveStorage = Object.freeze({
    clientId:GOOGLE_CLIENT_ID,
    scope:DRIVE_SCOPE,
    connect,
    resume,
    handles,
    handle,
    isActive,
    activeFileId,
    deactivate,
    disconnectLocal,
    clearToken
  });
}());
