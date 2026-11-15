# CatatRapi

> **Keuangan rapi, keputusan lebih pasti.**
>
> CatatRapi adalah aplikasi pencatatan keuangan multi-pengguna untuk pribadi, usaha, proyek, dan keluarga. Aplikasi menggunakan jurnal double-entry, peran akses, laporan dasar, Google Sheets sebagai penyimpanan awal, serta Google Apps Script sebagai backend.

## Arsitektur

```text
catatrapi.byzamil.web.id
        │
        ├─ Cloudflare: domain dan DNS
        │
        └─ Netlify: hosting website + Function /api
                      │
                      └─ Google Apps Script: autentikasi dan API
                                   │
                                   └─ Google Sheets: database
```

- **GitHub** menyimpan source code private dan memicu deployment otomatis.
- **Netlify** menjalankan website dan meneruskan `/api` ke Apps Script tanpa memperlihatkan URL Apps Script pada browser.
- **Cloudflare** tetap mengelola domain/DNS `byzamil.web.id`.
- **Google Apps Script + Sheets** menangani pengguna, buku pencatatan, jurnal, anggaran, hak akses, dan audit log.

---

## Isi proyek

```text
CatatRapi/
├── index.html                        # Tampilan utama aplikasi
├── styles.css                         # Desain responsif dan branding
├── app.js                             # Logika aplikasi frontend
├── assets/
│   ├── catatrapi-crp-logo-web.png     # Logo CRp transparan untuk website
│   └── catatrapi-crp-web-base64.txt   # Logo sebagai Data URI/Base64
├── google-apps-script/
│   └── Code.gs                        # Backend Google Apps Script
├── netlify/
│   └── functions/
│       └── api.js                     # Proxy aman Netlify ke GAS
├── netlify.toml                       # Konfigurasi Netlify, /api dan headers
├── .gitignore                         # File yang tidak boleh di-push
└── README.md                          # Panduan ini
```

> Tidak ada secret di dalam proyek ini. Jangan memasukkan `PIN_PEPPER`, `SPREADSHEET_ID`, atau URL Apps Script `/exec` ke GitHub.

---

# Tutorial lengkap deployment

## A. Prasyarat

Siapkan:

- akun Google;
- akun GitHub;
- akun Netlify;
- domain `byzamil.web.id` yang DNS-nya dikelola Cloudflare;
- Git terinstal di komputer;
- file ZIP CatatRapi ini.

Periksa Git di terminal:

```bash
git --version
```

Jika belum ada, unduh Git dari [git-scm.com](https://git-scm.com/).

---

## B. Buat database Google Sheets

1. Buka Google Drive dan buat spreadsheet baru.
2. Beri nama, misalnya:

   ```text
   CatatRapi Production
   ```

3. Salin ID spreadsheet dari URL berikut:

   ```text
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
   ```

4. Jangan membuat spreadsheet sebagai public editor dan jangan membagikannya kepada pengguna aplikasi biasa.

---

## C. Pasang backend Google Apps Script

1. Dari spreadsheet, buka **Extensions → Apps Script**.
2. Hapus kode default.
3. Buka file `google-apps-script/Code.gs` dari folder proyek ini.
4. Salin seluruh isinya ke editor Apps Script, lalu klik **Save**.
5. Buka **Project Settings → Script properties**.
6. Tambahkan dua Script Property berikut:

| Nama property | Nilai |
|---|---|
| `SPREADSHEET_ID` | ID spreadsheet CatatRapi Production Anda |
| `PIN_PEPPER` | Nilai rahasia acak panjang |

Buat `PIN_PEPPER` melalui terminal Mac/Linux:

```bash
openssl rand -hex 32
```

Tempel hasilnya sebagai Value `PIN_PEPPER` tanpa tanda kutip. Simpan nilainya di password manager.

> Jangan mengganti `PIN_PEPPER` setelah pengguna mulai mendaftar. Menggantinya akan membuat PIN lama tidak cocok lagi.

### Deploy Apps Script

1. Klik **Deploy → New deployment**.
2. Pilih jenis **Web app**.
3. Atur:

| Pengaturan | Nilai |
|---|---|
| Execute as | **Me** |
| Who has access | **Anyone** |

4. Klik **Deploy**, selesaikan izin Google, lalu salin URL yang berakhiran `/exec`.
5. Simpan URL itu. Jangan tulis ke source code atau commit ke GitHub.

Netlify membutuhkan URL `/exec` tersebut sebagai secret pada tahap berikutnya.

---

## D. Buat repository GitHub dan upload via terminal

### 1. Buat repository kosong

Di GitHub, pilih **New repository** dan atur:

```text
Repository name: catatrapi
Visibility: Private
Initialize with README: jangan dipilih
```

Jangan membuat README, `.gitignore`, atau license dari GitHub agar proses push pertama tidak konflik.

### 2. Ekstrak ZIP dan masuk ke folder proyek

Contoh Mac/Linux:

```bash
unzip CatatRapi-deploy.zip
cd CatatRapi
```

Di Windows PowerShell:

```powershell
Expand-Archive -Path .\CatatRapi-deploy.zip -DestinationPath .\CatatRapi
cd .\CatatRapi
```

### 3. Inisialisasi Git dan push

Ganti `USERNAME` dengan username GitHub Anda:

```bash
git init
git add -A
git status
git commit -m "Initial CatatRapi application"
git branch -M main
git remote add origin https://github.com/USERNAME/catatrapi.git
git push -u origin main
```

Jika Git meminta identitas Anda, jalankan sekali saja:

```bash
git config --global user.name "Nama Anda"
git config --global user.email "email-anda@example.com"
```

Lalu ulangi perintah `git commit` dan `git push`.

---

## E. Deploy ke Netlify

1. Buka Netlify.
2. Pilih **Add new project → Import an existing project**.
3. Hubungkan GitHub dan pilih repository `catatrapi`.
4. Netlify akan membaca `netlify.toml` otomatis. Pastikan nilainya:

| Pengaturan | Nilai |
|---|---|
| Build command | kosong |
| Publish directory | `.` |
| Functions directory | `netlify/functions` |
| Node version | `20` |

5. Jalankan deploy awal.
6. Setelah project dibuat, buka:

   ```text
   Project configuration → Environment variables
   ```

7. Tambahkan environment variable bertipe secret:

| Nama | Nilai |
|---|---|
| `GAS_WEB_APP_URL` | URL Apps Script yang berakhiran `/exec` |

Buat untuk environment **Production**. Tambahkan juga untuk Deploy Previews jika preview harus terhubung ke database.

8. Jalankan deploy ulang. Cara paling mudah adalah push commit kosong dari terminal:

```bash
git commit --allow-empty -m "Configure Netlify production API"
git push
```

Di website yang sudah di-deploy, aplikasi otomatis memakai `/api`. Jangan mengisi URL Apps Script lewat menu **Pengaturan data** aplikasi pada produksi.

---

## F. Hubungkan domain dari Cloudflare

Rekomendasi subdomain:

```text
catatrapi.byzamil.web.id
```

### Di Netlify

1. Buka project CatatRapi → **Domain management**.
2. Pilih **Add a domain**.
3. Masukkan `catatrapi.byzamil.web.id`.
4. Catat target DNS yang diberikan Netlify. Biasanya hostname Netlify Anda, namun gunakan nilai persis dari dashboard Netlify.

### Di Cloudflare

1. Buka zone `byzamil.web.id` → **DNS**.
2. Tambahkan record:

| Type | Name | Target |
|---|---|---|
| CNAME | `catatrapi` | target yang ditampilkan Netlify |

3. Saat setup pertama, pilih **DNS only** (awan abu-abu).
4. Tunggu domain aktif dan sertifikat HTTPS Netlify selesai.
5. Buka:

   ```text
   https://catatrapi.byzamil.web.id
   ```

Setelah stabil, Cloudflare proxy/awan oranye boleh diuji jika ingin WAF atau proteksi tambahan. Jika memakai proxy Cloudflare, gunakan SSL/TLS mode **Full (strict)**. Jangan gunakan **Flexible**.

---

## G. Uji aplikasi sebelum publikasi

Gunakan browser incognito untuk pengujian bersih.

1. Daftarkan akun pertama.
2. Buat buku pencatatan baru.
3. Tambahkan transaksi dengan nilai debit dan kredit yang sama.
4. Periksa laporan laba rugi, posisi keuangan, dan neraca saldo.
5. Periksa spreadsheet: sheet `USERS`, `BOOKS`, `ACCOUNTS`, `JOURNALS`, dan `JOURNAL_LINES` harus terisi.
6. Daftarkan akun kedua lalu uji undangan peran **Editor** dan **Pembaca**.
7. Pastikan Pembaca tidak bisa mencatat transaksi.

---

## H. Menjalankan mode demo secara lokal

Untuk memeriksa tampilan sebelum upload, jalankan dari folder proyek:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

Lalu buka:

```text
http://localhost:8080
```

Pilih **Coba ruang demo**. Mode lokal menyimpan data demo di browser dan tidak menggunakan Google Sheets.

---

## I. Keamanan sebelum diumumkan

Sebelum domain dibagikan ke publik:

- gunakan PIN 8–12 digit atau lebih untuk akun nyata;
- simpan `PIN_PEPPER` hanya pada Script Properties dan password manager;
- jangan bagikan spreadsheet sebagai editor kepada pengguna biasa;
- jangan menyimpan URL Apps Script di GitHub;
- aktifkan backup/version history Google Drive;
- tambahkan Cloudflare Turnstile dan rate limiting untuk pendaftaran/login bila pengguna mulai banyak;
- pantau `AUDIT_LOG` di spreadsheet.

## Mengubah website di masa depan

Setiap perubahan file kemudian cukup di-push:

```bash
git add -A
git commit -m "Deskripsi perubahan"
git push
```

Netlify akan membangun dan menerbitkan versi baru secara otomatis.

---

## Koreksi transaksi yang salah

Transaksi yang telah dibukukan tidak dihapus permanen agar laporan dan jejak audit tetap dapat dipertanggungjawabkan.

Di halaman **Jurnal transaksi** tersedia aksi berikut untuk transaksi berstatus **Dibukukan**:

- **Ubah** — membuka jurnal koreksi. CatatRapi membuat jurnal pembalik untuk transaksi lama, lalu menyimpan jurnal pengganti yang sudah diperbaiki.
- **Batal** — meminta alasan pembatalan dan membuat jurnal pembalik otomatis.

Dengan cara ini, transaksi lama tetap terlihat berstatus **Dibatalkan**, alasan tersimpan, dan laporan keuangan tetap netral karena jurnal pembalik membalik debit/kredit transaksi lama.

Hak koreksi mengikuti kebijakan berikut:

| Peran | Hak koreksi |
|---|---|
| Pemilik | Seluruh transaksi dalam buku |
| Editor | Hanya transaksi yang dibuat sendiri |
| Pembaca | Tidak dapat mengoreksi atau membatalkan |

Setelah memperbarui `google-apps-script/Code.gs`, deploy ulang Apps Script sebagai **New version** agar endpoint API mengenali aksi koreksi dan pembatalan.
