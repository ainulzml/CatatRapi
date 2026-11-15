/*
 * CatatRapi — Google Apps Script API
 * 1) Buat Google Spreadsheet kosong.
 * 2) Extensions > Apps Script, ganti isi Code.gs dengan file ini.
 * 3) Project Settings > Script properties: set SPREADSHEET_ID ke ID spreadsheet.
 *    Optional: set PIN_PEPPER to a long random secret only you know.
 * 4) Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 5) Copy URL /exec to Pengaturan data in CatatRapi.
 */
const NK = {
  USERS: ['id','name','username','salt','verifier','active','createdAt'],
  BOOKS: ['id','ownerId','name','type','year','currency','createdAt'],
  MEMBERS: ['id','bookId','userId','role','addedAt'],
  ACCOUNTS: ['id','bookId','code','name','type','active','createdAt'],
  JOURNALS: ['id','bookId','date','reference','description','status','createdBy','createdAt','reversalOfId','correctsJournalId','replacedById','voidReason','voidedAt'],
  JOURNAL_LINES: ['id','journalId','bookId','accountId','debit','credit','memo'],
  BUDGETS: ['id','bookId','accountId','month','amount','note','createdAt'],
  SESSIONS: ['id','tokenHash','userId','expiresAt','createdAt'],
  AUDIT_LOG: ['id','at','userId','action','detail']
};
const NK_DEFAULT_ACCOUNTS = [
  ['1100','Kas','asset'],['1110','Bank','asset'],['1120','Piutang Usaha','asset'],['1130','Persediaan','asset'],['1210','Peralatan','asset'],
  ['2100','Utang Usaha','liability'],['2200','Utang Bank','liability'],['3100','Modal Pemilik','equity'],['3200','Saldo Laba','equity'],
  ['4100','Pendapatan Usaha','income'],['4200','Pendapatan Lainnya','income'],['5100','Harga Pokok Penjualan','expense'],['6100','Beban Sewa','expense'],['6200','Beban Utilitas','expense'],['6300','Beban Gaji','expense'],['6400','Beban Transportasi','expense'],['6500','Beban Lainnya','expense'],['6600','Beban Pajak','expense']
];

function doGet() { return json_({ok:true,data:{mode:'CatatRapi Apps Script API',version:'1.0'}}); }
function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const result = route_(req);
    return json_({ok:true,data:result || {}});
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_({ok:false,error:err && err.message ? err.message : 'Terjadi kesalahan pada server.'});
  }
}
function route_(r) {
  setup_();
  const action = String(r.action || '');
  if (action === 'health') return {mode:'Google Sheets + Apps Script'};
  if (action === 'register') return register_(r);
  if (action === 'login') return login_(r);
  const session = requireSession_(r.token);
  if (action === 'bootstrap') return bootstrap_(session.user);
  if (action === 'logout') return logout_(session);
  if (action === 'createBook') return createBook_(session.user, r);
  if (action === 'createAccount') return createAccount_(session.user, r);
  if (action === 'createJournal') return createJournal_(session.user, r);
  if (action === 'voidJournal') return voidJournal_(session.user, r);
  if (action === 'correctJournal') return correctJournal_(session.user, r);
  if (action === 'createBudget') return createBudget_(session.user, r);
  if (action === 'shareBook') return shareBook_(session.user, r);
  throw new Error('Aksi API tidak dikenal.');
}

function setup_() {
  const ss = spreadsheet_();
  Object.keys(NK).forEach(function(name) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = NK[name];
    const current = sheet.getRange(1,1,1,headers.length).getValues()[0];
    if (headers.some(function(h,i){ return current[i] !== h; })) {
      sheet.getRange(1,1,1,headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#dbeafe');
    }
  });
}
function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Script property SPREADSHEET_ID belum diatur.');
  return SpreadsheetApp.openById(id);
}
function sheet_(name) { return spreadsheet_().getSheetByName(name); }
function rows_(name) {
  const sheet = sheet_(name), headers = NK[name], last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2,1,last-1,headers.length).getValues().map(function(row,index) {
    const obj = {_row:index+2}; headers.forEach(function(h,i){obj[h]=row[i];}); return obj;
  });
}
function append_(name,obj) {
  const headers=NK[name], row=headers.map(function(h){return obj[h] !== undefined ? obj[h] : '';});
  sheet_(name).appendRow(row); return obj;
}
function update_(name,row,obj) {
  const headers=NK[name]; sheet_(name).getRange(row,1,1,headers.length).setValues([headers.map(function(h){return obj[h] !== undefined ? obj[h] : '';})]); return obj;
}
function now_() { return new Date().toISOString(); }
function id_(prefix) { return prefix + '_' + Utilities.getUuid().replace(/-/g,''); }
function number_(value) { const n=Number(value); return isFinite(n) ? Math.round(n) : 0; }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function publicUser_(u) { return {id:String(u.id),name:String(u.name),username:String(u.username)}; }

// A server-side salt plus optional private pepper mean that no raw PIN is written to a sheet.
function salt_() { return Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,''); }
function hex_(bytes) { return bytes.map(function(b){const x=(b+256)%256;return ('0'+x.toString(16)).slice(-2);}).join(''); }
function hash_(text) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)); }
function pinVerifier_(pin,salt) {
  const pepper=PropertiesService.getScriptProperties().getProperty('PIN_PEPPER') || '';
  let value=salt + ':' + String(pin) + ':' + pepper;
  // Deliberately slow iterative hash. Apps Script does not expose a native password-hash API.
  for (let i=0;i<12000;i++) value=hash_(value);
  return value;
}
function same_(a,b) { if (String(a).length !== String(b).length) return false; let diff=0; for(let i=0;i<String(a).length;i++) diff|=String(a).charCodeAt(i)^String(b).charCodeAt(i); return diff===0; }
function tokenHash_(token) { return hash_(String(token)); }
function validUsername_(value) { return /^[a-z0-9._-]{3,32}$/.test(String(value)); }
function validPin_(value) { return /^\d{6,16}$/.test(String(value)); }

function register_(r) {
  const name=String(r.name||'').trim(), username=String(r.username||'').trim().toLowerCase(), pin=String(r.pin||'');
  if (!name || name.length>60) throw new Error('Nama lengkap wajib diisi (maksimal 60 karakter).');
  if (!validUsername_(username)) throw new Error('Nama pengguna hanya boleh huruf kecil, angka, titik, garis bawah, atau tanda minus.');
  if (!validPin_(pin)) throw new Error('PIN harus terdiri dari 6–16 angka.');
  if (rows_('USERS').some(function(u){return String(u.username).toLowerCase()===username;})) throw new Error('Nama pengguna ini sudah digunakan.');
  const user={id:id_('usr'),name:name,username:username,salt:salt_(),verifier:'',active:true,createdAt:now_()};
  user.verifier=pinVerifier_(pin,user.salt); append_('USERS',user);
  const book=makeBook_(user, name.split(/\s+/)[0]+' — Pribadi','personal',new Date().getFullYear());
  audit_(user.id,'REGISTER','Akun dan buku awal dibuat: '+book.id);
  return {user:publicUser_(user),book:book};
}
function login_(r) {
  const username=String(r.username||'').trim().toLowerCase(), pin=String(r.pin||'');
  const user=rows_('USERS').find(function(u){return String(u.username).toLowerCase()===username;});
  if (!user || String(user.active).toLowerCase()==='false' || !same_(pinVerifier_(pin,user.salt),user.verifier)) throw new Error('Nama pengguna atau PIN tidak sesuai.');
  const token=Utilities.getUuid()+Utilities.getUuid(), session={id:id_('ses'),tokenHash:tokenHash_(token),userId:user.id,expiresAt:new Date(Date.now()+1000*60*60*12).toISOString(),createdAt:now_()};
  append_('SESSIONS',session); audit_(user.id,'LOGIN','Sesi baru dibuat');
  return {token:token,user:publicUser_(user)};
}
function requireSession_(token) {
  if (!token) throw new Error('Sesi tidak ditemukan.');
  const session=rows_('SESSIONS').find(function(s){return same_(s.tokenHash,tokenHash_(token));});
  if (!session || new Date(session.expiresAt).getTime()<Date.now()) throw new Error('Sesi berakhir. Silakan masuk kembali.');
  const user=rows_('USERS').find(function(u){return u.id===session.userId && String(u.active).toLowerCase()!=='false';});
  if (!user) throw new Error('Akun tidak aktif.'); return {session:session,user:user};
}
function logout_(access) { const row=access.session._row; sheet_('SESSIONS').deleteRow(row); audit_(access.user.id,'LOGOUT','Sesi diakhiri'); return {}; }

function allowedBookIds_(userId) {
  const ids={}; rows_('BOOKS').filter(function(b){return b.ownerId===userId;}).forEach(function(b){ids[b.id]=true;}); rows_('MEMBERS').filter(function(m){return m.userId===userId;}).forEach(function(m){ids[m.bookId]=true;}); return Object.keys(ids);
}
function role_(userId,bookId) { const book=rows_('BOOKS').find(function(b){return b.id===bookId;}); if(!book) return ''; if(book.ownerId===userId)return 'owner'; const member=rows_('MEMBERS').find(function(m){return m.bookId===bookId&&m.userId===userId;});return member?String(member.role):''; }
function assertEdit_(userId,bookId) { if (!['owner','editor'].includes(role_(userId,bookId))) throw new Error('Anda hanya memiliki akses baca untuk buku ini.'); }
// Pemilik dapat mengoreksi seluruh jurnal. Editor hanya dapat mengoreksi jurnal yang dibuatnya sendiri.
function assertCorrectJournal_(user,journal) { const role=role_(user.id,journal.bookId); if(role==='owner') return; if(role==='editor'&&journal.createdBy===user.id) return; throw new Error('Anda hanya dapat mengoreksi transaksi yang Anda buat sendiri.'); }
function assertOwner_(userId,bookId) { if (role_(userId,bookId)!=='owner') throw new Error('Hanya pemilik buku yang dapat mengatur akses.'); }
function bootstrap_(user) {
  const ids=allowedBookIds_(user.id), inBook=function(x){return ids.includes(x.bookId);}, books=rows_('BOOKS').filter(function(b){return ids.includes(b.id);}), members=rows_('MEMBERS').filter(inBook), accounts=rows_('ACCOUNTS').filter(inBook), journals=rows_('JOURNALS').filter(inBook), lines=rows_('JOURNAL_LINES').filter(inBook), budgets=rows_('BUDGETS').filter(inBook);
  const visible={}; visible[user.id]=true; books.forEach(function(b){visible[b.ownerId]=true;});members.forEach(function(m){visible[m.userId]=true;});
  const users=rows_('USERS').filter(function(u){return visible[u.id];}).map(publicUser_);
  [books,members,accounts,journals,lines,budgets].forEach(function(arr){arr.forEach(function(o){delete o._row;});});
  return {user:publicUser_(user),books:books,members:members,accounts:accounts,journals:journals,journalLines:lines,budgets:budgets,users:users};
}
function makeBook_(owner,name,type,year) {
  if (!String(name||'').trim() || String(name).length>70) throw new Error('Nama buku wajib diisi (maksimal 70 karakter).');
  const book={id:id_('book'),ownerId:owner.id,name:String(name).trim(),type:String(type||'other'),year:number_(year),currency:'IDR',createdAt:now_()}; append_('BOOKS',book);
  NK_DEFAULT_ACCOUNTS.forEach(function(def){append_('ACCOUNTS',{id:id_('acc'),bookId:book.id,code:def[0],name:def[1],type:def[2],active:true,createdAt:now_()});});
  return book;
}
function createBook_(user,r) { const book=makeBook_(user,r.name,r.type,r.year);audit_(user.id,'CREATE_BOOK',book.id);const accounts=rows_('ACCOUNTS').filter(function(a){return a.bookId===book.id;});accounts.forEach(function(a){delete a._row;});return {book:book,accounts:accounts}; }
function createAccount_(user,r) {
  assertEdit_(user.id,r.bookId);const code=String(r.code||'').trim(),name=String(r.name||'').trim(),type=String(r.type||'');
  if(!code||!name||!['asset','liability','equity','income','expense'].includes(type))throw new Error('Data akun tidak lengkap atau tidak valid.');
  if(rows_('ACCOUNTS').some(function(a){return a.bookId===r.bookId&&String(a.code)===code;}))throw new Error('Kode akun sudah digunakan dalam buku ini.');
  const account={id:id_('acc'),bookId:r.bookId,code:code,name:name,type:type,active:true,createdAt:now_()};append_('ACCOUNTS',account);audit_(user.id,'CREATE_ACCOUNT',account.id);return {account:account};
}
function validateJournalRequest_(bookId,r) {
  const date=String(r.date||''),description=String(r.description||'').trim(),lines=Array.isArray(r.lines)?r.lines:[];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!description||description.length>160)throw new Error('Tanggal atau deskripsi transaksi tidak valid.');
  if(lines.length<2)throw new Error('Jurnal memerlukan minimal dua baris.');
  const allowed={};rows_('ACCOUNTS').filter(function(a){return a.bookId===bookId&&String(a.active).toLowerCase()!=='false';}).forEach(function(a){allowed[a.id]=true;});let debit=0,credit=0;
  lines.forEach(function(line){const d=number_(line.debit),c=number_(line.credit);if(!allowed[line.accountId])throw new Error('Salah satu akun jurnal tidak valid.');if(d<0||c<0||(d>0&&c>0))throw new Error('Setiap baris jurnal harus berisi debit atau kredit saja.');debit+=d;credit+=c;});
  if(debit<=0||debit!==credit)throw new Error('Total debit dan kredit harus sama dan lebih dari nol.');
  return {date:date,description:description,lines:lines};
}
function createJournal_(user,r) {
  assertEdit_(user.id,r.bookId);const valid=validateJournalRequest_(r.bookId,r);
  const journal={id:id_('jrn'),bookId:r.bookId,date:valid.date,reference:String(r.reference||'').slice(0,40),description:valid.description,status:'posted',createdBy:user.id,createdAt:now_(),reversalOfId:'',correctsJournalId:'',replacedById:'',voidReason:'',voidedAt:''};append_('JOURNALS',journal);
  const created=valid.lines.map(function(line){const row={id:id_('line'),journalId:journal.id,bookId:r.bookId,accountId:line.accountId,debit:number_(line.debit),credit:number_(line.credit),memo:String(line.memo||'').slice(0,160)};append_('JOURNAL_LINES',row);return row;});audit_(user.id,'CREATE_JOURNAL',journal.id);return {journal:journal,lines:created};
}
function voidJournal_(user,r) {
  const journal=rows_('JOURNALS').find(function(j){return j.id===r.journalId&&j.bookId===r.bookId;});
  if(!journal)throw new Error('Transaksi tidak ditemukan.');
  if(String(journal.status)!=='posted')throw new Error('Hanya transaksi yang masih dibukukan dapat dibatalkan.');
  assertCorrectJournal_(user,journal);const reason=String(r.reason||'').trim();if(reason.length<3)throw new Error('Isi alasan pembatalan minimal 3 karakter.');
  const sourceLines=rows_('JOURNAL_LINES').filter(function(line){return line.journalId===journal.id;});const timestamp=now_();
  const reversal={id:id_('jrn'),bookId:journal.bookId,date:journal.date,reference:('VOID-'+String(journal.reference||journal.id)).slice(0,40),description:('Pembatalan: '+journal.description).slice(0,160),status:'reversal',createdBy:user.id,createdAt:timestamp,reversalOfId:journal.id,correctsJournalId:'',replacedById:'',voidReason:'',voidedAt:''};append_('JOURNALS',reversal);
  const reversalLines=sourceLines.map(function(line){const row={id:id_('line'),journalId:reversal.id,bookId:journal.bookId,accountId:line.accountId,debit:number_(line.credit),credit:number_(line.debit),memo:'Jurnal pembalik '+journal.id};append_('JOURNAL_LINES',row);return row;});
  journal.status='voided';journal.voidReason=reason;journal.voidedAt=timestamp;update_('JOURNALS',journal._row,journal);delete journal._row;audit_(user.id,'VOID_JOURNAL',journal.id+': '+reason);
  return {journal:journal,reversal:reversal,reversalLines:reversalLines};
}
function correctJournal_(user,r) {
  const original=rows_('JOURNALS').find(function(j){return j.id===r.journalId&&j.bookId===r.bookId;});
  if(!original)throw new Error('Transaksi yang akan dikoreksi tidak ditemukan.');
  if(String(original.status)!=='posted')throw new Error('Transaksi ini sudah dibatalkan atau dikoreksi.');
  assertCorrectJournal_(user,original);const reason=String(r.reason||'').trim();if(reason.length<3)throw new Error('Isi alasan koreksi minimal 3 karakter.');
  assertEdit_(user.id,r.bookId);validateJournalRequest_(r.bookId,r);
  const voidResult=voidJournal_(user,{bookId:r.bookId,journalId:r.journalId,reason:'Koreksi: '+reason});
  const replacement=createJournal_(user,r);const storedOriginal=rows_('JOURNALS').find(function(j){return j.id===original.id;});storedOriginal.replacedById=replacement.journal.id;update_('JOURNALS',storedOriginal._row,storedOriginal);delete storedOriginal._row;
  const storedReplacement=rows_('JOURNALS').find(function(j){return j.id===replacement.journal.id;});storedReplacement.correctsJournalId=original.id;update_('JOURNALS',storedReplacement._row,storedReplacement);delete storedReplacement._row;audit_(user.id,'CORRECT_JOURNAL',original.id+' -> '+replacement.journal.id+': '+reason);
  return {original:storedOriginal,reversal:voidResult.reversal,reversalLines:voidResult.reversalLines,journal:storedReplacement,lines:replacement.lines};
}
function createBudget_(user,r) {
  assertEdit_(user.id,r.bookId);const account=rows_('ACCOUNTS').find(function(a){return a.id===r.accountId&&a.bookId===r.bookId&&a.type==='expense';});if(!account)throw new Error('Akun beban tidak valid.');if(!/^\d{4}-\d{2}$/.test(String(r.month||''))||number_(r.amount)<=0)throw new Error('Bulan atau nilai anggaran tidak valid.');
  let row=rows_('BUDGETS').find(function(b){return b.bookId===r.bookId&&b.accountId===r.accountId&&b.month===r.month;});if(row){row.amount=number_(r.amount);row.note=String(r.note||'').slice(0,100);update_('BUDGETS',row._row,row);}else{row={id:id_('bud'),bookId:r.bookId,accountId:r.accountId,month:r.month,amount:number_(r.amount),note:String(r.note||'').slice(0,100),createdAt:now_()};append_('BUDGETS',row);}audit_(user.id,'UPSERT_BUDGET',row.id);const budgets=rows_('BUDGETS').filter(function(b){return b.bookId===r.bookId;});budgets.forEach(function(b){delete b._row;});return {budgets:budgets};
}
function shareBook_(user,r) {
  assertOwner_(user.id,r.bookId);const username=String(r.username||'').trim().toLowerCase(),role=String(r.role||'');if(!['editor','viewer'].includes(role))throw new Error('Peran yang dipilih tidak valid.');const target=rows_('USERS').find(function(u){return String(u.username).toLowerCase()===username&&String(u.active).toLowerCase()!=='false';});if(!target)throw new Error('Nama pengguna tujuan belum terdaftar.');if(target.id===user.id)throw new Error('Anda sudah menjadi pemilik buku ini.');
  let member=rows_('MEMBERS').find(function(m){return m.bookId===r.bookId&&m.userId===target.id;});if(member){member.role=role;update_('MEMBERS',member._row,member);}else{member={id:id_('mem'),bookId:r.bookId,userId:target.id,role:role,addedAt:now_()};append_('MEMBERS',member);}delete member._row;audit_(user.id,'SHARE_BOOK',r.bookId+':'+target.id);return {member:member,user:publicUser_(target)};
}
function audit_(userId,action,detail) { append_('AUDIT_LOG',{id:id_('aud'),at:now_(),userId:userId,action:action,detail:String(detail||'')}); }
