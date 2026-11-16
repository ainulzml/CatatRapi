# CatatRapi Privacy V2 — langkah implementasi kode

> Status: **fondasi kriptografi dan backend encrypted-record tersedia, tetapi ditunda dan belum aktif.**
> Implementasi aktif saat ini adalah model Google Drive milik pengguna; lihat `GOOGLE-DRIVE-OWNED-DATA.md`.
> Jangan klaim E2EE sebelum fase integrasi frontend selesai dan diaudit.

## Kode yang sudah tersedia

| Berkas | Peran |
|---|---|
| `vault-crypto.js` | Web Crypto API di browser: AES-GCM, PBKDF2, ECDH, envelope key, Recovery Key |
| `google-apps-script/VaultCode.gs` | Backend Apps Script yang hanya menerima ciphertext/IV/metadata minimal |
| `SECURITY-PRIVACY.md` | Threat model, konsekuensi Recovery Key, dan kebijakan privasi |
| `app.js` + `styles.css` | Versi aplikasi saat ini dan integrasi logo laporan |

## Fase implementasi

### Fase 0 — jangan migrasikan data finansial penting dulu

Aplikasi saat ini belum E2EE. Gunakan data saat ini hanya sebagai data uji sampai frontend Privacy V2 selesai.

### Fase 1 — backend vault baru

1. Buat **Google Spreadsheet baru** bernama misalnya `CatatRapi Vault Production`.
2. Buka **Extensions → Apps Script**.
3. Ganti seluruh script lama dengan isi `google-apps-script/VaultCode.gs`.
4. Isi Script Properties:

| Property | Nilai |
|---|---|
| `SPREADSHEET_ID` | ID spreadsheet vault baru |
| `PIN_PEPPER` | Secret acak panjang, contoh hasil `openssl rand -hex 32` |

5. Deploy sebagai Web App baru, Execute as: **Me**, Who has access: **Anyone**.
6. Simpan URL `/exec` baru sebagai environment secret Netlify, jangan pernah di frontend.

Backend ini membuat sheet berikut otomatis:

```text
VAULT_USERS
VAULT_BOOKS
VAULT_MEMBERS
VAULT_BOOK_KEYS
ENCRYPTED_RECORDS
SESSIONS
AUDIT_LOG
```

Tidak ada `JOURNALS`, `JOURNAL_LINES`, nominal, kategori, atau deskripsi plaintext pada model baru.

### Fase 2 — onboarding Kunci Privasi

Frontend harus diubah agar:

1. Saat daftar, pengguna membuat PIN untuk login dan **Kunci Privasi** minimal 12 karakter.
2. `vault-crypto.js` membuat public/private key browser-side.
3. Private key dibungkus dua kali:
   - oleh Kunci Privasi;
   - oleh Recovery Key.
4. Recovery Key hanya ditampilkan sekali dan pengguna diminta menyimpannya.
5. Saat login, browser mengunduh blob private-key terenkripsi lalu membuka dengan Kunci Privasi. Tidak ada secret itu yang dikirim ke Apps Script.

### Fase 3 — encrypted records

Frontend mengganti API plaintext menjadi endpoint Privacy V2:

```text
vaultRegister
vaultLogin
vaultBootstrap
vaultCreateBook
vaultWriteRecord
vaultLookupUser
vaultShareBook
```

Setiap akun, anggaran, metadata buku, dan jurnal menjadi JSON lokal yang dienkripsi menggunakan kunci AES-GCM buku sebelum dikirim sebagai `ENCRYPTED_RECORD`.

### Fase 4 — shared book E2EE

Saat pemilik mengundang anggota:

1. Frontend meminta public key anggota melalui `vaultLookupUser`.
2. Browser pemilik membungkus Book Key menggunakan ECDH key envelope.
3. Hanya envelope terenkripsi yang dikirim ke `vaultShareBook`.
4. Browser anggota membuka envelope dengan private key-nya.

### Fase 5 — perhitungan lokal dan audit

- Laporan dihitung di browser setelah dekripsi.
- Pencarian juga terjadi di browser.
- Koreksi transaksi memakai record pembalik terenkripsi.
- Server hanya mengaudit ID record, aksi, pengguna, dan waktu — tanpa nominal/deskripsi.

## Catatan wajib

- Jangan memakai `Code.gs` plaintext lama untuk Privacy V2.
- Jangan mengunggah Kunci Privasi atau Recovery Key ke Google Sheets, Netlify, GitHub, atau layanan support.
- Jangan menjanjikan admin tidak dapat membaca data sebelum fase frontend, laporan, sharing, recovery, dan testing selesai.
- Operator yang menguasai frontend tetap harus dipercaya untuk tidak menyisipkan JavaScript jahat. Lindungi proses deploy dengan review GitHub, tag rilis, CSP, dan audit kode.
