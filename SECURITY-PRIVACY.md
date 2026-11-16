# Rancangan Privasi CatatRapi: E2EE (opsi lanjutan)

> **Status saat ini:** deployment baru sedang beralih ke model **Google Drive milik pengguna**, didokumentasikan pada [`GOOGLE-DRIVE-OWNED-DATA.md`](GOOGLE-DRIVE-OWNED-DATA.md). Model itu mencegah operator CatatRapi mengakses file pengguna secara normal, tetapi **bukan E2EE**—Google menyimpan file plaintext milik pengguna.
>
> Dokumen ini menjelaskan rancangan E2EE alternatif yang sudah memiliki fondasi kode (`vault-crypto.js` dan `VaultCode.gs`) namun **belum terintegrasi/aktif**. Jangan menyatakan CatatRapi E2EE berdasarkan berkas ini.

## Janji privasi bila E2EE kelak dipilih

CatatRapi akan memakai model **enkripsi end-to-end (E2EE) per Buku Pencatatan**.

Tujuannya adalah agar pengelola Google Sheets, Apps Script, Netlify, maupun admin CatatRapi **tidak dapat membaca**:

- nominal transaksi;
- akun, kategori, debit, dan kredit;
- deskripsi transaksi;
- tanggal transaksi;
- anggaran dan laporan;
- nama akun/chart of accounts.

Google Sheets hanya menyimpan ciphertext/teks terenkripsi dan metadata operasional minimal.

## Kondisi versi saat ini

Versi Apps Script/Google Sheets saat ini masih menyimpan jurnal dalam bentuk plaintext. Dengan demikian, versi saat ini **belum boleh diklaim sebagai zero-knowledge atau private dari pengelola**.

Fitur E2EE bukan sekadar menambahkan kolom hash. Ia membutuhkan perubahan format data, alur pendaftaran, penyimpanan kunci, pencatatan, laporan, pencarian, serta berbagi buku.

## Alur yang direkomendasikan

### 1. Dua rahasia dengan fungsi berbeda

| Rahasia | Fungsi | Dikirim ke server? |
|---|---|---|
| PIN masuk | Membuktikan akun dapat menggunakan aplikasi | Ya, hanya dalam bentuk verifier hash |
| Kunci Privasi | Membuka data keuangan terenkripsi | **Tidak pernah** |
| Recovery Key | Memulihkan Kunci Privasi pada perangkat baru/lupa perangkat | **Tidak pernah** |

PIN 6–16 digit tidak cukup untuk dijadikan kunci enkripsi data finansial. Pengguna perlu membuat **Kunci Privasi** berupa passphrase minimal 12 karakter atau beberapa kata unik. Kunci tersebut hanya diproses di browser.

### 2. Pembuatan akun

1. Browser membuat pasangan kunci kriptografi milik pengguna.
2. Browser membuat `Recovery Key` acak yang hanya ditampilkan sekali kepada pengguna.
3. Kunci privat pengguna disimpan sebagai blob terenkripsi; Apps Script tidak menerima rahasia pembukanya.
4. Pengguna mengunduh/menyalin Recovery Key ke password manager.

### 3. Pembuatan buku

1. Browser membuat kunci acak AES-256 untuk buku tersebut.
2. Kunci buku dibungkus/dienkripsi untuk pemilik buku.
3. Google Sheets menyimpan hanya envelope/encrypted book key, bukan kunci asli.

### 4. Pencatatan transaksi

1. Pengguna mengisi pemasukan, pengeluaran, transfer, atau jurnal manual.
2. Browser membuat jurnal double-entry dan memvalidasi debit = kredit secara lokal.
3. Seluruh payload transaksi dienkripsi dengan kunci buku menggunakan AES-GCM.
4. Apps Script menyimpan `ciphertext`, `nonce/IV`, versi skema, ID buku, ID pengguna, dan timestamp audit minimal.
5. Saat dibuka, browser mengambil ciphertext lalu mendekripsinya secara lokal.

### 5. Berbagi buku terenkripsi

Agar Editor/Pembaca tetap dapat mengakses buku tanpa admin melihat kunci:

1. Setiap pengguna memiliki public key.
2. Pemilik membungkus kunci buku khusus untuk public key anggota yang diundang.
3. Encrypted key envelope anggota disimpan di sheet `BOOK_KEYS`.
4. Anggota mendekripsi envelope itu dengan private key miliknya sendiri.
5. Menghapus anggota berarti menghapus aksesnya dan, untuk keamanan maksimum, merotasi kunci buku.

## Struktur data baru

Struktur plaintext seperti `JOURNAL_LINES` tidak dipakai untuk data produksi E2EE. Model baru yang disarankan:

| Sheet | Isi yang boleh terlihat server |
|---|---|
| `USERS` | ID, username, verifier PIN, public encryption key, status |
| `BOOKS` | ID opaque, pemilik, metadata minimum/status |
| `BOOK_MEMBERS` | ID buku, ID anggota, peran |
| `BOOK_KEYS` | encrypted book-key envelope untuk setiap anggota |
| `ENCRYPTED_RECORDS` | ID record, ID buku, ciphertext, IV/nonce, versi, pembuat, timestamp |
| `AUDIT_LOG` | jenis aksi, ID opaque, timestamp; tanpa nominal/deskripsi |

Nominal, akun, kategori, tanggal, referensi, deskripsi, dan isi laporan berada di payload terenkripsi.

## Dampak pada laporan dan pencarian

Karena server tidak mengetahui nominal atau kategori:

- laporan laba rugi, posisi keuangan, arus kas, dan anggaran dihitung di browser pengguna setelah dekripsi;
- pencarian transaksi juga berjalan di browser;
- Google Sheets tidak dapat lagi membuat formula laporan dari data mentah;
- admin tidak dapat membantu menelusuri nominal transaksi pengguna.

## Recovery dan konsekuensi

Recovery Key harus menjadi tanggung jawab pengguna. Jika pengguna kehilangan Kunci Privasi, Recovery Key, dan seluruh perangkat yang masih login, maka data terenkripsi tidak dapat dipulihkan oleh CatatRapi maupun pengelola. Ini adalah konsekuensi langsung dari janji bahwa pengelola tidak dapat membaca data.

## Batas kepercayaan yang perlu jujur disampaikan

E2EE melindungi data yang tersimpan di Google Sheets dari pengelola yang sekadar ingin mengintip data. Namun operator yang menguasai hosting/frontend secara jahat dapat mengganti JavaScript untuk meminta Kunci Privasi pengguna.

Agar janji privasi kredibel:

- gunakan GitHub private dengan review perubahan;
- publikasikan kebijakan privasi dan arsitektur enkripsi;
- hindari tracker pihak ketiga pada halaman vault;
- aktifkan Content Security Policy yang ketat;
- gunakan release/tag dan audit kode;
- jangan pernah meminta Recovery Key melalui dukungan/admin.

## Migrasi

Data lama plaintext tidak berubah menjadi privat dengan sendirinya. Pilihan paling aman adalah mulai dengan buku terenkripsi baru, lalu pengguna mengimpor/mencatat ulang data yang diperlukan dan mengarsipkan atau menghapus data plaintext sesuai kebijakan.

## Tahap implementasi

1. Tambah Kunci Privasi dan Recovery Key pada onboarding.
2. Tambah public/private key management di browser.
3. Ganti API Google Apps Script dari plaintext journal ke encrypted records.
4. Bangun vault lokal untuk dekripsi, laporan, dan pencarian.
5. Tambahkan encrypted sharing via per-member key envelope.
6. Uji kehilangan perangkat, recovery, koreksi, akses Editor/Pembaca, dan rotasi key.
7. Audit keamanan sebelum janji privasi dipublikasikan.
