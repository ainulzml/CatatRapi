/*
 * CatatRapi Privacy V2 crypto core.
 * Runs only in the user's browser. No passphrase, Recovery Key, private key,
 * or unwrapped book key is sent to Apps Script/Google Sheets.
 */
window.CatatRapiVault = (() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const PBKDF2_ITERATIONS = 310000;
  const VERSION = 'cr-vault-v1';

  function randomBytes(size = 32) { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return bytes; }
  function bytesToB64(bytes) { let binary=''; bytes.forEach(byte=>binary+=String.fromCharCode(byte)); return btoa(binary); }
  function b64ToBytes(value) { const binary=atob(value); return Uint8Array.from(binary, char=>char.charCodeAt(0)); }
  function bytesToB64Url(bytes) { return bytesToB64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  function b64UrlToBytes(value) { const normal=value.replace(/-/g,'+').replace(/_/g,'/'), padded=normal+'='.repeat((4-normal.length%4)%4); return b64ToBytes(padded); }
  function newId(prefix='id') { return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : bytesToB64Url(randomBytes(16))}`; }
  function aad(value) { return encoder.encode(typeof value==='string'?value:JSON.stringify(value)); }

  async function importPbkdf2Secret(secret) { return crypto.subtle.importKey('raw',encoder.encode(secret),'PBKDF2',false,['deriveKey']); }
  async function derivePassphraseKey(secret,salt,context) {
    const base=await importPbkdf2Secret(secret);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:PBKDF2_ITERATIONS,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function sealBytes(key,bytes,context) {
    const iv=randomBytes(12), ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(context)},key,bytes);
    return {ciphertext:bytesToB64(new Uint8Array(ciphertext)),iv:bytesToB64(iv)};
  }
  async function openBytes(key,packet,context) {
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(packet.iv),additionalData:aad(context)},key,b64ToBytes(packet.ciphertext));
    return new Uint8Array(bytes);
  }
  async function sealJson(key,payload,context) { return sealBytes(key,encoder.encode(JSON.stringify(payload)),context); }
  async function openJson(key,packet,context) { return JSON.parse(decoder.decode(await openBytes(key,packet,context))); }

  async function encryptPrivateJwk(privateJwk,secret,kind) {
    const salt=randomBytes(16), key=await derivePassphraseKey(secret,salt,`private-key:${kind}`), packet=await sealJson(key,privateJwk,{version:VERSION,kind});
    return {...packet,salt:bytesToB64(salt),iterations:PBKDF2_ITERATIONS};
  }
  async function decryptPrivateJwk(wrapped,secret,kind) {
    const key=await derivePassphraseKey(secret,b64ToBytes(wrapped.salt),`private-key:${kind}`);
    return openJson(key,wrapped,{version:VERSION,kind});
  }

  async function createIdentity(vaultPassphrase) {
    if(typeof vaultPassphrase!=='string'||vaultPassphrase.length<12) throw new Error('Kunci Privasi minimal 12 karakter.');
    const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
    const privateJwk=await crypto.subtle.exportKey('jwk',pair.privateKey), publicJwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
    const recoveryKey=bytesToB64Url(randomBytes(32));
    const byPassphrase=await encryptPrivateJwk(privateJwk,vaultPassphrase,'passphrase');
    const byRecovery=await encryptPrivateJwk(privateJwk,recoveryKey,'recovery');
    return {identity:{privateKey:pair.privateKey,publicKey:pair.publicKey,publicJwk},recoveryKey,vault:{version:VERSION,publicKey:JSON.stringify(publicJwk),privateByPassphrase:JSON.stringify(byPassphrase),privateByRecovery:JSON.stringify(byRecovery)}};
  }
  async function unlockIdentity(vault,vaultPassphrase) {
    try {
      const privateJwk=await decryptPrivateJwk(JSON.parse(vault.privateByPassphrase),vaultPassphrase,'passphrase');
      const publicJwk=JSON.parse(vault.publicKey);
      return {privateKey:await crypto.subtle.importKey('jwk',privateJwk,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']),publicKey:await crypto.subtle.importKey('jwk',publicJwk,{name:'ECDH',namedCurve:'P-256'},true,[]),publicJwk};
    } catch { throw new Error('Kunci Privasi salah atau vault tidak dapat dibuka.'); }
  }
  async function recoverIdentity(vault,recoveryKey) {
    try {
      const privateJwk=await decryptPrivateJwk(JSON.parse(vault.privateByRecovery),recoveryKey,'recovery');
      const publicJwk=JSON.parse(vault.publicKey);
      return {privateKey:await crypto.subtle.importKey('jwk',privateJwk,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']),publicKey:await crypto.subtle.importKey('jwk',publicJwk,{name:'ECDH',namedCurve:'P-256'},true,[]),publicJwk};
    } catch { throw new Error('Recovery Key tidak valid.'); }
  }

  async function createBookKey() { return crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']); }
  async function envelopeKey(privateKey,otherPublicJwk,salt) {
    const publicKey=await crypto.subtle.importKey('jwk',otherPublicJwk,{name:'ECDH',namedCurve:'P-256'},false,[]);
    const shared=await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},privateKey,256);
    const hkdf=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:encoder.encode('CatatRapi book-key envelope v1')},hkdf,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function wrapBookKey(bookKey,recipientPublicJwk) {
    const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
    const salt=randomBytes(16), wrappingKey=await envelopeKey(ephemeral.privateKey,recipientPublicJwk,salt), rawBookKey=new Uint8Array(await crypto.subtle.exportKey('raw',bookKey)), packet=await sealBytes(wrappingKey,rawBookKey,{version:VERSION,purpose:'book-key'});
    return {version:VERSION,ephemeralPublicKey:await crypto.subtle.exportKey('jwk',ephemeral.publicKey),salt:bytesToB64(salt),...packet};
  }
  async function unwrapBookKey(envelope,identity) {
    const wrappingKey=await envelopeKey(identity.privateKey,envelope.ephemeralPublicKey,b64ToBytes(envelope.salt)), raw=await openBytes(wrappingKey,envelope,{version:VERSION,purpose:'book-key'});
    return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},true,['encrypt','decrypt']);
  }
  async function encryptRecord(bookKey,bookId,recordId,recordType,payload) { return {...await sealJson(bookKey,payload,{version:VERSION,bookId,recordId,recordType}),version:VERSION}; }
  async function decryptRecord(bookKey,bookId,record) { return openJson(bookKey,record,{version:record.version||VERSION,bookId,recordId:record.id,recordType:record.recordType}); }

  return {VERSION,newId,createIdentity,unlockIdentity,recoverIdentity,createBookKey,wrapBookKey,unwrapBookKey,encryptRecord,decryptRecord,bytesToB64Url,b64UrlToBytes};
})();
