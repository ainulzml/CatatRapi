/*
 * CatatRapi Privacy V2 — encrypted-record backend for Google Apps Script.
 *
 * DEPLOYMENT:
 * - Use a NEW, empty Google Spreadsheet for Privacy V2.
 * - Replace the old Code.gs contents with this file when the Privacy V2 frontend
 *   has been deployed. Do NOT keep two doPost/doGet functions in one GAS project.
 * - This code deliberately never accepts plaintext journal amounts, accounts,
 *   descriptions, budgets, or report data.
 */
const V = {
  USERS: ['id','name','username','pinSalt','pinVerifier','publicKey','privateByPassphrase','privateByRecovery','active','createdAt'],
  BOOKS: ['id','ownerId','createdAt','active'],
  MEMBERS: ['id','bookId','userId','role','addedAt','active'],
  BOOK_KEYS: ['id','bookId','userId','envelope','createdAt','rotatedAt'],
  RECORDS: ['id','bookId','recordType','ciphertext','iv','version','parentRecordId','createdBy','createdAt'],
  SESSIONS: ['id','tokenHash','userId','expiresAt','createdAt'],
  AUDIT_LOG: ['id','at','userId','action','bookId','recordId','detail']
};
const V_PIN_ITERATIONS = 12000;

function doGet() { return vaultJson_({ok:true,data:{mode:'CatatRapi Privacy V2',version:'2.0',plaintextFinancialData:false}}); }
function doPost(e) {
  try {
    const request=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
    return vaultJson_({ok:true,data:vaultRoute_(request)||{}});
  } catch(error) {
    console.error(error&&error.stack?error.stack:error);
    return vaultJson_({ok:false,error:error&&error.message?error.message:'Terjadi kesalahan pada server vault.'});
  }
}
function vaultRoute_(r) {
  vaultSetup_();
  const action=String(r.action||'');
  if(action==='health') return {mode:'Google Sheets encrypted vault',version:'2.0'};
  if(action==='vaultRegister') return vaultLocked_(function(){return vaultRegister_(r);});
  if(action==='vaultLogin') return vaultLocked_(function(){return vaultLogin_(r);});
  const access=vaultSession_(r.token);
  if(action==='vaultBootstrap') return vaultBootstrap_(access.user);
  if(action==='vaultLogout') return vaultLocked_(function(){return vaultLogout_(access);});
  if(action==='vaultCreateBook') return vaultLocked_(function(){return vaultCreateBook_(access.user,r);});
  if(action==='vaultWriteRecord') return vaultLocked_(function(){return vaultWriteRecord_(access.user,r);});
  if(action==='vaultLookupUser') return vaultLookupUser_(access.user,r);
  if(action==='vaultShareBook') return vaultLocked_(function(){return vaultShareBook_(access.user,r);});
  throw new Error('Aksi Privacy V2 tidak dikenal.');
}

function vaultSetup_() {
  const ss=vaultSpreadsheet_();
  Object.keys(V).forEach(function(name){
    let sheet=ss.getSheetByName(name); if(!sheet) sheet=ss.insertSheet(name);
    const headers=V[name], current=sheet.getRange(1,1,1,headers.length).getValues()[0];
    if(headers.some(function(h,i){return current[i]!==h;})) {
      sheet.getRange(1,1,1,headers.length).setValues([headers]);
      sheet.setFrozenRows(1); sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#dbeafe');
    }
  });
}
function vaultSpreadsheet_() { const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'); if(!id) throw new Error('Script property SPREADSHEET_ID belum diatur.'); return SpreadsheetApp.openById(id); }
function vaultSheet_(name) { return vaultSpreadsheet_().getSheetByName(name); }
function vaultRows_(name) { const sheet=vaultSheet_(name), headers=V[name], last=sheet.getLastRow(); if(last<2)return []; return sheet.getRange(2,1,last-1,headers.length).getValues().map(function(row,index){const object={_row:index+2};headers.forEach(function(h,i){object[h]=row[i];});return object;}); }
function vaultAppend_(name,obj) { const headers=V[name];vaultSheet_(name).appendRow(headers.map(function(h){return obj[h]!==undefined?obj[h]:'';}));return obj; }
function vaultUpdate_(name,row,obj) { const headers=V[name];vaultSheet_(name).getRange(row,1,1,headers.length).setValues([headers.map(function(h){return obj[h]!==undefined?obj[h]:'';})]);return obj; }
function vaultLocked_(fn) { const lock=LockService.getScriptLock(); if(!lock.tryLock(30000))throw new Error('Server sedang memproses transaksi lain. Coba kembali beberapa detik.');try{return fn();}finally{lock.releaseLock();} }
function vaultJson_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function vaultId_(prefix) { return prefix+'_'+Utilities.getUuid().replace(/-/g,''); }
function vaultNow_() { return new Date().toISOString(); }
function vaultHash_(text) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(text),Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join(''); }
function vaultSalt_() { return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''); }
function vaultPinVerifier_(pin,salt) { const pepper=PropertiesService.getScriptProperties().getProperty('PIN_PEPPER')||'';let value=salt+':'+String(pin)+':'+pepper;for(let i=0;i<V_PIN_ITERATIONS;i++)value=vaultHash_(value);return value; }
function vaultSame_(a,b) { a=String(a);b=String(b);if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0; }
function vaultTokenHash_(token) { return vaultHash_(String(token)); }
function vaultValidUsername_(value) { return /^[a-z0-9._-]{3,32}$/.test(String(value)); }
function vaultValidPin_(value) { return /^\d{6,16}$/.test(String(value)); }
function vaultOpaqueId_(value,prefix) { return new RegExp('^'+prefix+'_[A-Za-z0-9_-]{12,100}$').test(String(value)); }
function vaultJsonString_(value,label,max) { const text=String(value||'');if(!text||text.length>max)throw new Error(label+' tidak valid.');try{JSON.parse(text);}catch(error){throw new Error(label+' harus berupa JSON valid.');}return text; }
function vaultPublicUser_(user) { return {id:String(user.id),name:String(user.name),username:String(user.username),publicKey:String(user.publicKey)}; }
function vaultAudit_(userId,action,bookId,recordId,detail) { vaultAppend_('AUDIT_LOG',{id:vaultId_('audit'),at:vaultNow_(),userId:userId,action:action,bookId:bookId||'',recordId:recordId||'',detail:String(detail||'').slice(0,200)}); }

function vaultRegister_(r) {
  const name=String(r.name||'').trim(),username=String(r.username||'').trim().toLowerCase(),pin=String(r.pin||'');
  if(!name||name.length>60)throw new Error('Nama lengkap wajib diisi.');
  if(!vaultValidUsername_(username))throw new Error('Nama pengguna tidak valid.');
  if(!vaultValidPin_(pin))throw new Error('PIN harus terdiri dari 6–16 angka.');
  if(vaultRows_('USERS').some(function(u){return String(u.username).toLowerCase()===username;}))throw new Error('Nama pengguna ini sudah digunakan.');
  const user={id:vaultId_('user'),name:name,username:username,pinSalt:vaultSalt_(),pinVerifier:'',publicKey:vaultJsonString_(r.publicKey,'Public key',12000),privateByPassphrase:vaultJsonString_(r.privateByPassphrase,'Vault passphrase bundle',30000),privateByRecovery:vaultJsonString_(r.privateByRecovery,'Vault recovery bundle',30000),active:true,createdAt:vaultNow_()};
  user.pinVerifier=vaultPinVerifier_(pin,user.pinSalt);vaultAppend_('USERS',user);vaultAudit_(user.id,'VAULT_REGISTER','','','Encrypted vault account created');return {user:vaultPublicUser_(user)};
}
function vaultLogin_(r) {
  const username=String(r.username||'').trim().toLowerCase(),pin=String(r.pin||''),user=vaultRows_('USERS').find(function(u){return String(u.username).toLowerCase()===username;});
  if(!user||String(user.active).toLowerCase()==='false'||!vaultSame_(vaultPinVerifier_(pin,user.pinSalt),user.pinVerifier))throw new Error('Nama pengguna atau PIN tidak sesuai.');
  const token=Utilities.getUuid()+Utilities.getUuid();vaultAppend_('SESSIONS',{id:vaultId_('session'),tokenHash:vaultTokenHash_(token),userId:user.id,expiresAt:new Date(Date.now()+1000*60*60*12).toISOString(),createdAt:vaultNow_()});vaultAudit_(user.id,'VAULT_LOGIN','','','Session created');return {token:token,user:vaultPublicUser_(user)};
}
function vaultSession_(token) {
  if(!token)throw new Error('Sesi tidak ditemukan.');const session=vaultRows_('SESSIONS').find(function(s){return vaultSame_(s.tokenHash,vaultTokenHash_(token));});
  if(!session||new Date(session.expiresAt).getTime()<Date.now())throw new Error('Sesi berakhir. Silakan masuk kembali.');
  const user=vaultRows_('USERS').find(function(u){return u.id===session.userId&&String(u.active).toLowerCase()!=='false';});if(!user)throw new Error('Akun tidak aktif.');return {session:session,user:user};
}
function vaultLogout_(access) { vaultSheet_('SESSIONS').deleteRow(access.session._row);vaultAudit_(access.user.id,'VAULT_LOGOUT','','','Session removed');return {}; }
function vaultBookRole_(userId,bookId) { const book=vaultRows_('BOOKS').find(function(item){return item.id===bookId&&String(item.active).toLowerCase()!=='false';});if(!book)return '';if(book.ownerId===userId)return 'owner';const member=vaultRows_('MEMBERS').find(function(item){return item.bookId===bookId&&item.userId===userId&&String(item.active).toLowerCase()!=='false';});return member?String(member.role):''; }
function vaultRequireRole_(user,bookId,allowed) { const role=vaultBookRole_(user.id,bookId);if(!allowed.includes(role))throw new Error('Anda tidak memiliki hak akses pada buku ini.');return role; }
function vaultAccessibleBookIds_(userId) { const ids={};vaultRows_('BOOKS').filter(function(book){return book.ownerId===userId&&String(book.active).toLowerCase()!=='false';}).forEach(function(book){ids[book.id]=true;});vaultRows_('MEMBERS').filter(function(member){return member.userId===userId&&String(member.active).toLowerCase()!=='false';}).forEach(function(member){ids[member.bookId]=true;});return Object.keys(ids); }

function vaultBootstrap_(user) {
  const ids=vaultAccessibleBookIds_(user.id),inside=function(item){return ids.includes(item.bookId);},books=vaultRows_('BOOKS').filter(function(book){return ids.includes(book.id);}),members=vaultRows_('MEMBERS').filter(inside),keys=vaultRows_('BOOK_KEYS').filter(function(key){return key.userId===user.id&&ids.includes(key.bookId);}),records=vaultRows_('RECORDS').filter(inside),visible={};visible[user.id]=true;books.forEach(function(book){visible[book.ownerId]=true;});members.forEach(function(member){visible[member.userId]=true;});
  const users=vaultRows_('USERS').filter(function(candidate){return visible[candidate.id];}).map(vaultPublicUser_);
  [books,members,keys,records].forEach(function(items){items.forEach(function(item){delete item._row;});});
  const vault={publicKey:user.publicKey,privateByPassphrase:user.privateByPassphrase,privateByRecovery:user.privateByRecovery};
  return {user:vaultPublicUser_(user),vault:vault,books:books,members:members,bookKeys:keys,records:records,users:users};
}
function vaultCreateBook_(user,r) {
  const bookId=String(r.bookId||'');if(!vaultOpaqueId_(bookId,'book'))throw new Error('ID buku tidak valid.');if(vaultRows_('BOOKS').some(function(book){return book.id===bookId;}))throw new Error('ID buku sudah ada.');
  const envelope=vaultJsonString_(r.ownerEnvelope,'Key envelope',30000),now=vaultNow_();const book={id:bookId,ownerId:user.id,createdAt:now,active:true};vaultAppend_('BOOKS',book);vaultAppend_('MEMBERS',{id:vaultId_('member'),bookId:bookId,userId:user.id,role:'owner',addedAt:now,active:true});vaultAppend_('BOOK_KEYS',{id:vaultId_('key'),bookId:bookId,userId:user.id,envelope:envelope,createdAt:now,rotatedAt:now});vaultAudit_(user.id,'VAULT_CREATE_BOOK',bookId,'','Encrypted book created');return {book:book};
}
function vaultWriteRecord_(user,r) {
  const bookId=String(r.bookId||''),recordId=String(r.recordId||''),type=String(r.recordType||''),parentId=String(r.parentRecordId||'');const role=vaultRequireRole_(user,bookId,['owner','editor']);
  if(!vaultOpaqueId_(recordId,'record'))throw new Error('ID record tidak valid.');if(!['book_meta','account','journal','budget'].includes(type))throw new Error('Tipe record tidak valid.');if(vaultRows_('RECORDS').some(function(record){return record.id===recordId;}))throw new Error('Record sudah ada.');
  if(parentId){const parent=vaultRows_('RECORDS').find(function(record){return record.id===parentId&&record.bookId===bookId;});if(!parent)throw new Error('Record induk tidak ditemukan.');if(role==='editor'&&parent.createdBy!==user.id)throw new Error('Editor hanya dapat mengoreksi transaksi yang dibuat sendiri.');}
  const record={id:recordId,bookId:bookId,recordType:type,ciphertext:String(r.ciphertext||''),iv:String(r.iv||''),version:String(r.version||''),parentRecordId:parentId,createdBy:user.id,createdAt:vaultNow_()};
  if(!record.ciphertext||record.ciphertext.length>50000||!record.iv||record.iv.length>500||!record.version)throw new Error('Payload terenkripsi tidak valid.');vaultAppend_('RECORDS',record);vaultAudit_(user.id,'VAULT_WRITE_RECORD',bookId,recordId,type);return {record:{id:record.id,bookId:record.bookId,recordType:record.recordType,parentRecordId:record.parentRecordId,createdBy:record.createdBy,createdAt:record.createdAt}};
}
function vaultLookupUser_(user,r) { const username=String(r.username||'').trim().toLowerCase(),target=vaultRows_('USERS').find(function(item){return String(item.username).toLowerCase()===username&&String(item.active).toLowerCase()!=='false';});if(!target)throw new Error('Pengguna tujuan belum terdaftar.');return {user:vaultPublicUser_(target)}; }
function vaultShareBook_(user,r) {
  const bookId=String(r.bookId||''),role=String(r.role||''),targetId=String(r.userId||'');vaultRequireRole_(user,bookId,['owner']);if(!['editor','viewer'].includes(role))throw new Error('Peran tidak valid.');if(!targetId||targetId===user.id)throw new Error('Pengguna tujuan tidak valid.');const target=vaultRows_('USERS').find(function(item){return item.id===targetId&&String(item.active).toLowerCase()!=='false';});if(!target)throw new Error('Pengguna tujuan tidak ditemukan.');const envelope=vaultJsonString_(r.envelope,'Key envelope',30000),now=vaultNow_();let member=vaultRows_('MEMBERS').find(function(item){return item.bookId===bookId&&item.userId===targetId;});if(member){member.role=role;member.active=true;vaultUpdate_('MEMBERS',member._row,member);}else{member={id:vaultId_('member'),bookId:bookId,userId:targetId,role:role,addedAt:now,active:true};vaultAppend_('MEMBERS',member);}let key=vaultRows_('BOOK_KEYS').find(function(item){return item.bookId===bookId&&item.userId===targetId;});if(key){key.envelope=envelope;key.rotatedAt=now;vaultUpdate_('BOOK_KEYS',key._row,key);}else{key={id:vaultId_('key'),bookId:bookId,userId:targetId,envelope:envelope,createdAt:now,rotatedAt:now};vaultAppend_('BOOK_KEYS',key);}delete member._row;delete key._row;vaultAudit_(user.id,'VAULT_SHARE_BOOK',bookId,'','Role: '+role);return {member:member,key:key,user:vaultPublicUser_(target)};
}
