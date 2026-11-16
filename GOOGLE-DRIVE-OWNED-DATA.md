# CatatRapi — Data di Google Drive Pengguna

## Status implementasi

CatatRapi sekarang memiliki mode **Google Drive Pribadi**.

- Username, verifier PIN, dan sesi masih memakai layanan akun CatatRapi (`Code.gs` + `/api`).
- **Data keuangan tidak dikirim ke layanan akun tersebut.**
- Setelah pengguna menekan **Hubungkan Google Drive**, browser memakai OAuth Google dan langsung membuat/membaca satu Google Spreadsheet di Google Drive milik pengguna.
- Spreadsheet menggunakan scope OAuth `https://www.googleapis.com/auth/drive.file`, yaitu akses terbatas pada file yang dipakai aplikasi, bukan seluruh Drive.

File internal yang dibuat bernama `CatatRapi — Data Keuangan`, dengan tab:

```text
CR_META
CR_BOOKS
CR_ACCOUNTS
CR_JOURNALS
CR_JOURNAL_LINES
CR_BUDGETS
CR_AUDIT_LOG
```

Setiap baris data disimpan sebagai JSON pada file yang dimiliki pengguna. Ini membuat integrasi dengan aplikasi saat ini sederhana; pengguna tidak dianjurkan mengubah tab internal secara manual.

## Yang pengelola dapat dan tidak dapat lihat

| Data | Layanan akun CatatRapi / operator |
|---|---|
| Nama, username, verifier PIN, sesi | Dapat menyimpan untuk autentikasi |
| Nominal, akun, jurnal, deskripsi, tanggal, anggaran | **Tidak dikirim dan tidak disimpan** |
| Laporan | Dihitung di browser dari file Drive pengguna |
| File Spreadsheet keuangan | Milik akun Google pengguna |

Model ini bukan E2EE. Google sebagai penyedia Drive dapat menyimpan file plaintext pengguna. Yang dicegah adalah operator CatatRapi membaca atau menulis file keuangan tersebut tanpa pengguna membagikannya.

## Konfigurasi Google Cloud sekali saja

OAuth Client ID web yang tertanam pada source:

```text
488094698080-6fmo08qtnva9lk83nmuo3ccnm5go3kdc.apps.googleusercontent.com
```

Client ID web bersifat publik. **Jangan pernah** memasukkan Google OAuth Client Secret ke HTML, JavaScript, GitHub, Apps Script, Netlify, atau Cloudflare.

Di Google Cloud Console project yang sama:

1. Aktifkan **Google Drive API**.
2. Aktifkan **Google Sheets API**.
3. Pada **Google Auth Platform → Branding/Audience**, isi nama aplikasi, email support, dan email developer.
4. Pada OAuth Client tersebut, masukkan setiap origin frontend yang benar di **Authorized JavaScript origins**. Format harus persis, termasuk `https://`, tanpa path dan tanpa slash akhir. Misalnya:

   ```text
   https://crp.byzamil.web.id
   http://localhost:8080
   ```

   Jangan menambah domain yang tidak dipakai. Produksi harus HTTPS; `localhost` boleh HTTP untuk pengujian.
5. Di halaman Data Access/Scopes, pastikan scope `drive.file` tersedia. Jangan meminta `drive` atau `spreadsheets` penuh kecuali ada alasan baru yang terdokumentasi.
6. Selama tahap uji, tambahkan akun Google penguji pada daftar **Test users**. Sebelum rilis untuk umum, lengkapi proses publikasi/verification yang diwajibkan Google untuk consent screen Anda.

Jika muncul `origin_mismatch`, origin yang dibuka pengguna belum sama persis dengan daftar ini.

## Batas “hubungkan sekali”

Implementasi tidak menyimpan Google refresh token pada server, karena token itu dapat digunakan operator untuk membuka Drive pengguna dan akan merusak tujuan privasi.

Konsekuensinya:

- Pada browser dan sesi Google yang masih aktif, pengguna biasanya cukup masuk dengan username + PIN CatatRapi; akses Drive sesi pendek dapat digunakan kembali.
- Saat access token Google kedaluwarsa, browser berubah, mode private digunakan, cookies Google dibersihkan, atau akses dicabut, pengguna perlu menekan **Hubungkan/Perbarui akses Google Drive**.
- Google biasanya menggunakan sesi Google yang telah aktif, sehingga pengguna sering tidak perlu mengetik email/PIN Google lagi. Namun aplikasi tidak dapat menjanjikan akses Drive permanen tanpa interaksi Google sambil tetap menjamin operator tidak memegang token jangka panjang.
- Pengguna yang pindah perangkat harus menghubungkan akun Google pada perangkat baru.

Ini adalah kompromi yang jujur: tidak ada refresh token Google milik pengguna di Apps Script, Netlify, atau database CatatRapi.

## Kolaborasi

Mode awal memakai **satu Spreadsheet untuk semua buku milik satu pengguna**. Karena izin Google Drive berlaku per file, membagikan file berarti memberi akses ke semua buku di dalam file tersebut.

Karena itu tombol undang anggota tidak diaktifkan pada mode Drive ini. Untuk kolaborasi yang aman, implementasi berikutnya harus membuat **satu file Drive per buku yang dibagikan** dan mengatur permission Google Drive berdasarkan email anggota. Jangan mengklaim Editor/Viewer sudah bekerja di mode Google Drive sampai implementasi tersebut selesai.

## Penggantian backend lama

`google-apps-script/Code.gs` sudah diubah menjadi **layanan akun saja**. Ia tidak lagi menerima operasi `createJournal`, `createBudget`, atau operasi keuangan lainnya.

1. Buat spreadsheet kosong khusus layanan akun CatatRapi, atau arsipkan spreadsheet plaintext lama.
2. Pasang `Code.gs` yang baru ke Apps Script project dan deploy version Web App baru.
3. Atur `SPREADSHEET_ID` dan `PIN_PEPPER` seperti sebelumnya.
4. Pertahankan URL `/exec` di secret Netlify `GAS_WEB_APP_URL`.
5. Jangan memasang `VaultCode.gs` bersama `Code.gs`; keduanya sama-sama mendeklarasikan handler Web App.

## Migrasi data lama

Data yang sebelumnya sudah tersimpan di spreadsheet pusat tetap dapat dibaca oleh pemilik spreadsheet pusat. Data itu **tidak otomatis menjadi privat** hanya dengan deploy versi ini.

Untuk migrasi yang aman:

1. Backup/export data lama untuk pengguna terkait.
2. Deploy mode Google Drive Pribadi.
3. Pengguna menghubungkan Drive dan mencatat/impor data yang diperlukan ke file Drive mereka.
4. Setelah masa transisi dan sesuai kebijakan retensi, arsipkan atau hapus data plaintext pusat.

## Batas ancaman

Model ini membuat operator tidak memiliki izin normal untuk file finansial pengguna. Namun operator yang menguasai kode frontend/deployment secara jahat dapat mencoba meminta pengguna memberi izin lain atau mengirim data yang sedang terbuka di browser.

Untuk menjaga kepercayaan pengguna:

- gunakan review perubahan di GitHub dan release tag;
- pertahankan Content Security Policy ketat;
- jangan menambah analytics/tracker pada layar pencatatan;
- dokumentasikan setiap scope OAuth yang diminta;
- jangan pernah meminta akses file pengguna lewat email atau support kecuali pengguna memilih membagikan file secara eksplisit.
