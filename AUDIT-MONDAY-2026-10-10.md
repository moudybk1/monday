# Audit Monday: logika, UI, UX, dan perbandingan dengan Tread

**Tanggal audit:** 10 Oktober 2026, WIB  
**Aplikasi:** http://localhost:3000/  
**Pembanding:** https://app.tread.fi/  
**Workspace:** `/Users/yoga/Projects/mondaynad`  
**Status:** laporan audit; perbaikan kode utama belum dilakukan.

## Ringkasan penilaian

Monday sudah memiliki identitas visual yang jelas dan fondasi terminal yang cukup baik. Prioritas perbaikannya adalah konsistensi risk control, kebenaran angka, dan kejelasan status operasi. Ada beberapa perilaku engine yang berbeda dari janji yang ditampilkan UI.

Hal yang sudah baik dan perlu dipertahankan:

- Warna bid/ask konsisten, angka monospaced, dan penanda quote `MONDAY` mudah dikenali.
- Agent menyediakan alasan tindakan dalam bahasa biasa.
- Kontrol Agent diprioritaskan sebelum chart pada layar mobile.
- Kill memiliki langkah konfirmasi.
- Evidence mengungkap asumsi pengujian dan keterbatasannya.
- Decision record memungkinkan pengguna menghitung ulang hash parameter dan evidence.
- Backend menolak policy tertentu yang tidak valid dan onboarding menolak key tanpa trade scope.

Temuan paling mendesak berkaitan dengan Resume setelah Kill gagal, batas policy yang tidak konsisten dengan order aktual, validasi stop loss, proteksi posisi saat Pause, pesan hasil flatten, dan freshness analytics.

## Cakupan dan metode

Audit dilakukan melalui:

1. Inspeksi browser pada aplikasi localhost dan terminal Tread.
2. Pembacaan alur frontend, API, runner, strategi, analytics, serta adapter venue.
3. Pengujian alur aplikasi menggunakan salinan proyek dengan simulator terpisah pada port 3100/3101.
4. Reproduksi deterministik untuk kasus batas strategi dan lifecycle runner.
5. Unit test existing, pemeriksaan TypeScript, dan production build.
6. Pemeriksaan desktop dan mobile 390 px, serta inspeksi tema terang pada Evidence.

Halaman yang diperiksa: landing, onboarding, terminal, policy, analytics overview, wallet detail, compare, My Monday, Evidence, dan decision record.

**Batas pengujian:**

- Aksi trading hanya dilakukan di simulator, bukan akun live.
- Perbandingan Tread berdasarkan terminal dan kontrol yang tersedia tanpa login. Fitur akun yang membutuhkan autentikasi tidak diuji.
- Wallet signing, eksekusi venue riil, dan transaksi registry on-chain belum diuji end-to-end.
- Audit ini bukan sertifikasi keamanan atau bukti bahwa seluruh kemungkinan kegagalan telah tertutup.
- Angka pasar, kondisi layanan, dan hasil Evidence merupakan snapshot saat audit.
- Perubahan lokal yang sudah ada di workspace dipertahankan. Kode utama tidak diubah oleh audit ini.

## Arti prioritas dan bukti

- **P1:** perlu dibereskan sebelum memperluas penggunaan dana riil; berkaitan dengan kontrol risiko, status operasi, atau informasi yang dapat memengaruhi keputusan pengguna.
- **P2:** penting untuk akurasi, keandalan, aksesibilitas, dan pengalaman pengguna.
- **Browser:** perilaku diamati melalui penggunaan UI.
- **Reproduksi terisolasi:** perilaku dibuktikan melalui simulator atau probe/test deterministik.
- **Review kode:** jalur implementasi menunjukkan masalah, tetapi skenario tersebut belum dipicu pada venue riil.

## Temuan P1

### P1-01 — Resume dapat membatalkan kewajiban menyelesaikan Kill yang gagal

**Bukti:** reproduksi terisolasi dan review kode.

Ketika Kill gagal menutup posisi karena venue terputus, engine menyimpan pekerjaan `flatten` untuk dicoba kembali. Namun `start()` langsung menghapus pekerjaan tersebut dan mengubah status menjadi `quoting`.

Reproduksi menunjukkan urutan berikut:

1. Agent berjalan dan memiliki posisi.
2. Venue terputus.
3. Kill gagal menyelesaikan flatten; pekerjaan cleanup tetap tersimpan.
4. Venue kembali tersedia.
5. Resume mengubah status menjadi quoting dan menghapus kewajiban cleanup, sementara posisi lama masih terbuka.

Tombol Resume juga belum dinonaktifkan berdasarkan kondisi `closing`.

**Dampak:** pengguna dapat mengira siklus Kill sudah selesai, padahal posisi yang semestinya ditutup masih ada dan agent kembali beroperasi.

**Rekomendasi:**

- Blokir Resume selama cleanup belum selesai.
- Rekonsiliasi order dan posisi sebelum mengizinkan Start.
- Tampilkan status “Closing positions — retrying” beserta posisi yang tersisa.
- Serialisasikan perubahan lifecycle agar Start, Pause, dan Kill tidak saling mendahului.
- Tambahkan regression test untuk Resume ketika `owed = flatten`, cleanup sedang berjalan, serta kegagalan close parsial.

**Referensi:** [`apps/server/src/runner.ts`](apps/server/src/runner.ts), terutama `start()` sekitar baris 288; [`apps/web/components/agent.tsx`](apps/web/components/agent.tsx).

### P1-02 — Min half-spread bukan batas minimum quote aktual

**Bukti:** reproduksi deterministik dan review kode.

UI menjelaskan Min half-spread sebagai jarak terdekat quote terhadap fair price. Namun aturan mendekati best bid/ask dapat mempersempit quote melewati batas tersebut.

| Parameter | Hasil reproduksi |
|---|---:|
| Minimum half-spread policy | 6 bps |
| Half-spread model setelah fee | 6,45 bps |
| Fair price | 100.000 |
| Bid aktual | 99.995,5 |
| Ask aktual | 100.004,5 |
| Jarak aktual masing-masing sisi | **0,45 bps** |

**Dampak:** pengguna tidak dapat mengandalkan angka yang dipresentasikan sebagai batas policy untuk memahami jarak quote sebenarnya.

**Rekomendasi:** tentukan kontrak produk yang jelas. Jika angka tersebut batas keras, terapkan pada harga final setelah seluruh penyesuaian. Jika hanya spread dasar model, ubah namanya dan sediakan pengaturan terpisah untuk mendekati harga terbaik. Tampilkan spread model dan jarak quote aktual secara terpisah.

**Referensi:** [`packages/core/src/strategy.ts`](packages/core/src/strategy.ts), aturan mendekati best bid/ask sekitar baris 201; [`apps/web/components/policy-form.tsx`](apps/web/components/policy-form.tsx).

### P1-03 — Quote size policy dapat dilampaui governor

**Bukti:** reproduksi deterministik dan review kode.

Policy `$25 per side` dapat menghasilkan order sekitar `$37` ketika `size_mult = 1.5`. Pemeriksaan risiko mengizinkan hingga `1.5 × quoteSizeUsd`, selama tidak melampaui batas operator.

Probe menghasilkan order sekitar `$36,998335` setelah pembulatan ukuran, dan risk gate menerima order tersebut.

**Dampak:** perilaku ini berbeda dari bahasa UI “Your limits bind every order”. Batas operator tetap dapat berlaku, tetapi angka policy pengguna tidak menjadi batas maksimum order yang dipahami dari UI.

**Rekomendasi:** pisahkan **base quote size** dan **maximum order size**, atau jadikan angka policy sebagai batas final yang tidak boleh dilampaui governor. Tampilkan ukuran efektif sebelum Start dan pastikan frontend, engine, serta risk gate memakai definisi yang sama.

**Referensi:** [`packages/core/src/strategy.ts`](packages/core/src/strategy.ts), perhitungan ukuran sekitar baris 215; [`apps/server/src/runner.ts`](apps/server/src/runner.ts), parameter `maxOrderUsd` untuk risk gate.

### P1-04 — Stop loss negatif menjadi tanpa stop loss

**Bukti:** browser simulator dan review kode.

Session stop loss diisi `-5`, kemudian Resume ditekan. Agent tetap berjalan tanpa session stop loss. Nilai yang tidak positif dikonversi menjadi `null`.

**Dampak:** input yang salah secara diam-diam mematikan proteksi yang mungkin dimaksudkan pengguna.

**Rekomendasi:**

- Hanya input kosong yang berarti tidak dipasang.
- Nilai negatif atau tidak valid harus menghasilkan error pada field dan memblokir Start.
- Setelah Start, tampilkan status eksplisit: `Session stop loss: off` atau nominal aktif.
- Gunakan aturan validasi bersama antara frontend dan backend.

**Referensi:** [`apps/web/app/app/page.tsx`](apps/web/app/app/page.tsx), `usdOrNull` sekitar baris 38; [`apps/web/components/agent.tsx`](apps/web/components/agent.tsx).

### P1-05 — Pause mempertahankan posisi tetapi menghentikan pemeriksaan risiko agent

**Bukti:** perilaku Pause diamati di simulator; penghentian pemeriksaan risiko ditemukan melalui review kode.

Pause membatalkan order dan mempertahankan posisi. Pause juga mengakhiri session. Pemeriksaan daily loss, margin, dan session stop loss hanya berjalan ketika status `quoting`.

**Dampak:** posisi tetap terpapar perubahan harga, sementara pengguna belum mendapat penjelasan setara bahwa proteksi agent tersebut tidak lagi berjalan. Proteksi atau likuidasi yang disediakan venue merupakan mekanisme berbeda.

**Rekomendasi:** pisahkan “berhenti memasang quote” dari “berhenti mengawasi risiko”. Idealnya risk monitoring tetap aktif selama ada posisi. Jika proteksi memang dinonaktifkan, tampilkan kondisi itu secara eksplisit di status paused.

**Referensi:** [`apps/server/src/runner.ts`](apps/server/src/runner.ts), `pause()` dan `riskAndBooks()` sekitar baris 1133.

### P1-06 — Take profit dapat mengirim pesan sukses setelah flatten gagal

**Bukti:** review kode; kegagalan ini tidak dipicu pada venue riil.

Jalur `takeProfit()` mengirim peringatan ketika cleanup gagal, lalu tetap mengirim pesan “Orders cancelled and positions closed”.

**Dampak:** pengguna menerima dua informasi yang bertentangan mengenai apakah posisi sudah ditutup.

**Rekomendasi:** gunakan status bertahap: target tercapai → membatalkan order → menutup posisi → selesai. Pesan sukses hanya boleh muncul setelah venue mengonfirmasi posisi tertutup. Tampilkan retry dan sisa posisi ketika close hanya selesai sebagian.

**Referensi:** [`apps/server/src/runner.ts`](apps/server/src/runner.ts), `takeProfit()` sekitar baris 353–359.

### P1-07 — Sebagian analytics terlihat live ketika indexer tidak aktif

**Bukti:** browser, respons API deployment asli, dan review kode.

Saat diperiksa, deployment asli menggunakan mainnet dan dana riil. Respons analytics menunjukkan indexer `source: off`, dengan data indexed tertinggal sekitar **5,8 jam**. Panel Latest liquidations tetap menampilkan label `live`.

Header menampilkan “catching up”, tetapi istilah tersebut kurang tepat untuk indexer yang dimatikan. Angka API Perpl yang segar juga bercampur dengan angka hasil indexing yang lama.

**Dampak:** pengguna dapat menganggap metrik memiliki freshness dan cakupan waktu yang setara, padahal tidak.

**Rekomendasi:**

- Tampilkan freshness per sumber dan per metrik.
- Bedakan `live`, `delayed`, `offline`, dan `partial coverage`.
- Gunakan heartbeat atau kemajuan indexer untuk menilai kesehatan; waktu transaksi terakhir saja tidak cukup karena market dapat sepi.
- Jalankan indexer sebagai proses terpisah. Kode mencatat bahwa batch indexing dalam proses trading dapat mengganggu koneksi venue.
- Hindari menyajikan rasio dari pembilang dan penyebut yang memiliki freshness atau cakupan berbeda tanpa penjelasan.

**Referensi:** [`apps/server/src/index.ts`](apps/server/src/index.ts), sekitar baris 64–69; [`apps/server/src/stats/routes.ts`](apps/server/src/stats/routes.ts); [`apps/web/app/analytics/layout.tsx`](apps/web/app/analytics/layout.tsx); [`apps/web/app/analytics/page.tsx`](apps/web/app/analytics/page.tsx).

## Temuan P2: akurasi angka dan market data

### P2-01 — Ukuran order sendiri berpotensi dihitung dua kali dalam order book

**Bukti:** review kode.

UI menambahkan ukuran quote Monday ke level pasar. Pada feed live, level tersebut sudah mencakup order sendiri; implementasi perhitungan depth di core juga mengakui hal ini.

**Rekomendasi:** tandai porsi milik Monday tanpa menambah total kembali. Bedakan perilaku feed live dari simulator atau paper mode yang mungkin memang belum memasukkan order sendiri.

**Referensi:** [`apps/web/components/book.tsx`](apps/web/components/book.tsx), fungsi `ladder()`; [`packages/core/src/strategy.ts`](packages/core/src/strategy.ts), `depthAhead()`.

### P2-02 — Harga tengah order book tidak diberi label sebagai mark

**Bukti:** browser dan review kode.

Angka di pemisah bid/ask adalah mark. Mark dapat berada di luar best bid/ask sehingga pengguna dapat mengira urutan atau data book salah.

**Rekomendasi:** labeli `Mark`, dan bedakan dari `Mid` serta `Last`. Gunakan definisi yang konsisten pada chart, book, dan ringkasan market.

### P2-03 — Candle historis dicampur dengan update mark

**Bukti:** review kode dan inspeksi chart.

Candle historis dari API dilanjutkan menggunakan mark pada setiap tick. Volume candle baru dimulai dari nol tanpa agregasi trade yang setara.

**Dampak:** OHLC, volume, dan indikator berbasis volume dapat menggunakan semantik yang tidak konsisten.

**Rekomendasi:** gunakan satu definisi harga yang jelas. Jika chart menampilkan trade candles, bangun pembaruan dari trade yang relevan. Jika menampilkan mark candles, beri label dan gunakan histori mark. Agregasi volume harus mengikuti transaksi yang benar.

**Referensi:** [`apps/web/components/price-chart.tsx`](apps/web/components/price-chart.tsx), pembaruan candle sekitar baris 349.

### P2-04 — Win rate mengabaikan closing fill dengan realized PnL nol

**Bukti:** probe deterministik dan review kode.

Kondisi `if (r.realized)` menganggap hanya realized PnL nonnol sebagai closing fill. Close yang impas sebelum fee tetapi rugi setelah fee hilang dari penyebut win rate.

**Rekomendasi:** simpan jenis transaksi atau jumlah posisi yang ditutup. Gunakan informasi tersebut untuk menentukan closing fill, lalu hitung hasil bersih setelah fee. Jangan menyimpulkan aktivitas penutupan dari truthiness PnL.

**Referensi:** [`packages/core/src/analytics.ts`](packages/core/src/analytics.ts), sekitar baris 55.

### P2-05 — By quoted half-spread memakai spread model

**Bukti:** review kode.

Spread yang disimpan untuk analisis fill berasal dari model. Harga quote final dapat berbeda setelah penyesuaian ke best price atau penyesuaian lain.

**Rekomendasi:** simpan jarak quote aktual terhadap reference saat order dipasang dan saat fill, dengan nama metrik yang membedakannya dari spread model.

**Referensi:** [`apps/server/src/runner.ts`](apps/server/src/runner.ts), pencatatan fill; [`packages/core/src/analytics.ts`](packages/core/src/analytics.ts).

### P2-06 — Definisi PnL berbeda antarlayar

**Bukti:** browser dan review kode.

Terminal menampilkan perubahan equity akun. My Monday menghitung realized PnL setelah fee dari fill Monday. Kedua pendekatan dapat masuk akal, tetapi tidak memiliki cakupan identik.

**Rekomendasi:** gunakan label eksplisit seperti account PnL dan Monday realized PnL. Sediakan rekonsiliasi yang menjelaskan funding, unrealized PnL, deposit/withdrawal, fee, dan transaksi manual.

## Perbandingan dengan Tread

Perbandingan berikut berfokus pada UI dan kontrol yang terlihat tanpa login. Keberadaan kontrol tidak berarti seluruh fitur akun tersebut telah diuji.

| Aspek | Yang terlihat di Tread | Improve untuk Monday |
|---|---|---|
| Sebelum login | Terminal pasar dapat dieksplorasi | Sediakan terminal read-only dan jalur demo yang mudah ditemukan dari deployment live |
| Sebelum eksekusi | Area pre-trade menampilkan order value, margin, liquidation price, dan parameter eksekusi | Buat ringkasan sebelum Start: exposure maksimum, collateral, ukuran efektif, batas kerugian, dan proteksi aktif |
| Pengaturan | Parameter utama dipisahkan dari advanced settings | Pisahkan pengaturan dasar agent dari parameter strategi lanjutan |
| Layout | Pilihan Default, Advanced, Simple, Perp, dan pengaturan panel | Tambahkan Simple/Advanced, panel yang dapat diciutkan, dan ukuran panel yang dapat disesuaikan |
| Blotter | Filter account/pair dan pengaturan kolom terlihat jelas | Tambahkan filter market/session, pilihan kolom, pencarian, dan ekspor |
| Chart | Interval, indikator, drawing tools, replay, dan zona waktu eksplisit | Dahulukan konsistensi data dan zona waktu; tambahkan alat chart sesuai kebutuhan pengguna Monday |
| Kontrol risiko | Constraint seperti reduce-only dan passive-only diberi penjelasan | Tampilkan batas yang benar-benar aktif beserta efeknya pada quote dan posisi |

Pola yang paling layak diadaptasi adalah cara Tread membantu pengguna memahami konfigurasi dan konsekuensinya sebelum bertindak. Monday tetap dapat mempertahankan fokus pada pengawasan agent otomatis, dengan kontrol manual yang sesuai kebutuhan produknya.

## Temuan P2: UI dan UX

### P2-07 — Form policy memiliki dua ringkasan yang dapat berbeda

Saat Balanced aktif, policy menampilkan `$50 per side`, sementara margin sizer menampilkan hasil berbeda seperti `$300 per side`. Pengguna harus menebak konfigurasi mana yang berlaku.

**Rekomendasi:** jadikan Preset dan Size from margin sebagai pilihan mode yang jelas. Hanya satu konfigurasi aktif, dengan satu ringkasan final yang selalu sinkron. Perubahan mode harus langsung memperbarui seluruh angka terkait.

### P2-08 — Pembeda penting preset hilang di mobile

Pada layar 390 px, kartu preset tidak menampilkan leverage dan minimum spread. Balanced dan High leverage dapat terlihat mempunyai ringkasan angka yang sama.

Badge simulator juga hilang pada mobile. Badge mainnet real funds sudah dipertahankan oleh kode.

**Rekomendasi:** tampilkan ukuran quote, inventory cap, leverage, spread, dan daily loss untuk setiap preset. Pertahankan penanda demo/paper/live pada seluruh ukuran layar.

### P2-09 — Terminal terlalu padat pada lebar laptop

Pada lebar 1280 px, tab blotter dan teks penjelasan queue saling berdesakan. Tabel open orders memerlukan lebar minimum 720 px, sementara panelnya lebih sempit.

**Rekomendasi:** pindahkan penjelasan queue ke tooltip atau baris terpisah, prioritaskan kolom utama, dan sediakan pengaturan kolom. Tampilkan indikator horizontal scroll yang jelas. Panel yang bisa diubah ukuran akan membantu pengguna dengan layar laptop.

### P2-10 — Halaman mobile membutuhkan perjalanan scroll panjang

Penempatan Agent sebelum chart sudah tepat. Setelah itu, chart, blotter, order book, dan smart-money panel membuat halaman panjang.

**Rekomendasi:** gunakan tab utama seperti Monitor, Positions, dan Activity. Pertahankan akses cepat ke Pause/Kill ketika pengguna berada jauh di bawah halaman. Hindari menyembunyikan status risiko penting dalam panel yang jauh dari kontrolnya.

### P2-11 — Scope tindakan belum cukup eksplisit

Stop BTC, Pause, Kill, dan Disconnect mempunyai konsekuensi berbeda. Konfirmasi Kill mengatakan semua posisi, sementara implementasi venue hanya mengurus market yang dilacak Monday dan dapat mencakup posisi manual pada market tersebut.

**Rekomendasi:** tampilkan market, order, dan posisi yang terdampak; jelaskan apakah posisi dipertahankan atau ditutup; jelaskan siapa yang mengawasi risiko setelah tindakan. Nama tombol harus sesuai tindakan sebenarnya.

### P2-12 — Validasi form terlalu terlambat dan kurang spesifik

Quote size `0` dapat disubmit melalui UI. Backend menolaknya dengan pesan “Too small: expected number to be >=1”. Penolakan backend sudah benar, tetapi feedback belum membantu pengguna memperbaiki field yang salah.

**Rekomendasi:** tampilkan error spesifik seperti “Quote size minimum $1” di field terkait. Validasi juga perlu mencakup leverage, hubungan quote size–inventory, dan batas operator. Gunakan `aria-invalid` dan hubungan field–error yang sesuai.

### P2-13 — Error, loading, dan data kosong perlu dibedakan

Beberapa jalur dapat terus menampilkan skeleton atau menyamakan kegagalan API dengan tidak adanya data. Pada Compare, input `abc` menghasilkan “not found” berulang pada setiap baris tabel.

**Rekomendasi:**

- Validasi address/account sebelum request.
- Bedakan wallet tidak ditemukan, server gagal, rate limit, dan belum ada transaksi.
- Tampilkan Retry dan waktu update terakhir.
- Gunakan error state per panel agar satu kegagalan tidak mengaburkan seluruh halaman.
- Hindari pesan teknis pengembangan di alur pengguna produk ketika layanan tidak tersedia.

### P2-14 — Preview tetap berlabel Live saat koneksi terputus

Backend simulator dimatikan untuk pengujian. Preview landing tetap menyebut dirinya Live sambil mempertahankan data terakhir. Hook menyediakan status koneksi, tetapi preview tidak menggunakannya untuk label tersebut.

**Rekomendasi:** tampilkan “Disconnected — last update …”, tandai harga yang sudah membeku, dan hubungkan label Live dengan kesehatan aliran data sebenarnya.

**Referensi:** [`apps/web/components/landing.tsx`](apps/web/components/landing.tsx), sekitar baris 17; [`apps/web/lib/live.ts`](apps/web/lib/live.ts).

### P2-15 — Riwayat belum cukup mudah ditelusuri

Fills dan Decisions membutuhkan filter market, rentang waktu, sumber keputusan, dan session. Wallet detail menyediakan sebagian riwayat tanpa alur pagination yang memadai.

**Rekomendasi:** tambahkan ekspor CSV/JSON, pagination, pencarian, dan hubungan yang mudah diikuti: keputusan → perubahan quote → order → fill → hasil/markout. Tampilkan kapan sampel markout masih menunggu horizon pengukuran.

### P2-16 — Batas filter waktu analytics kurang jelas

Filter bagian atas, chart, dan beberapa metrik memakai jendela waktu berbeda. Sebagian sudah berlabel, tetapi susunannya mudah dipahami sebagai satu filter global.

**Rekomendasi:** pisahkan secara visual filter global dan lokal. Tampilkan rentang tanggal aktual, zona waktu, cakupan data, serta metrik mana yang berubah ketika filter dipilih.

### P2-17 — Aksesibilitas interaksi dan kontras perlu diperbaiki

Baris market yang dapat diklik belum menyediakan interaksi keyboard setara. Semantik tab, table order book, dialog, serta hubungan field–error perlu dirapikan.

Perhitungan warna menunjukkan teks putih pada latar danger `#e0633f` memiliki kontras sekitar **3,48:1**. Ini di bawah kebutuhan **4,5:1** untuk teks ukuran normal pada WCAG Level AA.

**Rekomendasi:**

- Sediakan fokus dan aktivasi keyboard pada seluruh kontrol interaktif.
- Lengkapi perilaku tab, termasuk navigasi keyboard dan relasi dengan panel.
- Gunakan nama aksesibel untuk dialog serta struktur tabel yang konsisten.
- Perbaiki kombinasi warna notice dan hover tombol danger.
- Tingkatkan keterbacaan dan ukuran target sentuh kontrol kecil di mobile.

**Referensi:** [WCAG 2.2 — Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html); [`apps/web/components/ui.tsx`](apps/web/components/ui.tsx); [`apps/web/components/agent.tsx`](apps/web/components/agent.tsx).

### P2-18 — Klaim on-chain tidak selalu sesuai kemampuan deployment

Footer dan beberapa penjelasan menyatakan keputusan dicatat di Monad. Deployment yang diperiksa memiliki chain log off dan registry belum dikonfigurasi. Halaman decision detail sudah memberikan penjelasan yang lebih tepat.

**Rekomendasi:** gunakan status yang konsisten di landing, onboarding, terminal, dan decision record: hashed locally, pending anchor, failed anchor, atau confirmed on-chain. Klaim kemampuan perlu mengikuti konfigurasi deployment aktif.

### P2-19 — Payload realtime cukup besar

Tiga pesan public WebSocket yang diukur berukuran sekitar **67 KB per update**. Server mengirim snapshot setiap detik. Jika ukuran dan frekuensinya tetap, ini setara sekitar **240 MB per jam sebelum kompresi**; angka tersebut bukan pengukuran transfer jaringan setelah kompresi.

**Rekomendasi:** kirim perubahan data, pisahkan history dari update harga, hindari mengirim ulang data yang tidak berubah, dan batasi update UI pada tab background. Frekuensi pengawasan risiko engine tetap dipertahankan.

**Referensi:** [`apps/server/src/runner.ts`](apps/server/src/runner.ts), penyusunan dashboard state; [`apps/web/lib/live.ts`](apps/web/lib/live.ts).

## Evaluasi Evidence dan klaim strategi

Pada snapshot BTC yang diperiksa:

| Ukuran | Hasil |
|---|---:|
| Korelasi flow dengan return berikutnya | 0,02 |
| Interval kepercayaan 95% | −0,07 sampai 0,10 |
| Sampel independen | 575 |
| Periode replay | Sekitar 6 hari |
| Net PnL Monday | −$3,99 |
| Net PnL baseline | −$4,71 |

Sebagian ukuran adverse selection membaik, tetapi hasil tersebut belum menunjukkan profitabilitas. Interval korelasi mencakup nol. Pengungkapan asumsi dan keputusan `lean off` sudah baik.

**Rekomendasi:**

- Gunakan periode pengujian lebih panjang dan pengujian pada data di luar periode pengembangan.
- Perbaiki model queue, partial fill, biaya, dan asumsi eksekusi.
- Tampilkan versi strategi, versi dataset, waktu komputasi, serta perbedaan replay dengan runtime live.
- Bedakan perbaikan relatif terhadap baseline dari profit absolut.
- Sesuaikan klaim landing dengan tingkat bukti yang tersedia.

## Hasil verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Unit test existing | **63 tes lulus** |
| TypeScript | **Lulus** |
| Production build pada salinan terisolasi | **Lulus** |
| Onboarding demo | Berhasil |
| Key tanpa trade scope | Ditolak dengan pesan yang relevan |
| Start agent | Berhasil di simulator |
| Pause | Order dibatalkan, posisi dipertahankan |
| Resume dengan stop loss negatif | Agent berjalan tanpa session stop loss; menjadi temuan audit |
| Respons terhadap burst | Respons reflex terlihat di simulator |
| Kill | Ketiga posisi simulator berhasil ditutup |
| Policy tidak valid: quote size 0 | Backend menolak; feedback frontend perlu diperbaiki |
| Penyimpanan policy valid | Berhasil |
| Recompute hash decision | Hash parameter dan evidence cocok |
| Resume setelah Kill gagal | Celah cleanup direproduksi melalui tes terisolasi |
| Preview setelah backend simulator mati | Tetap berlabel Live; menjadi temuan audit |
| Wallet signing dan transaksi on-chain | Belum diuji end-to-end |
| Eksekusi venue dengan dana riil | Tidak dilakukan |

Kelulusan tes existing dan build tidak menutup temuan di atas. Beberapa kasus batas yang direproduksi belum tercakup oleh suite existing.

## Urutan pengerjaan yang disarankan

### Tahap 1 — Risk control

- Perbaiki cleanup–Resume dan serialisasi lifecycle.
- Selaraskan batas policy dengan harga dan ukuran order final.
- Perbaiki validasi session stop loss/take profit.
- Tentukan dan implementasikan proteksi saat Pause.
- Pastikan status flatten hanya sukses setelah konfirmasi venue.
- Tambahkan regression test untuk kegagalan koneksi, partial close, dan aksi yang tumpang tindih.

### Tahap 2 — Kebenaran data

- Perbaiki freshness dan status indexer.
- Koreksi penggabungan order sendiri pada book.
- Selaraskan definisi candle dan volume.
- Koreksi win rate serta pencatatan spread aktual.
- Perjelas cakupan dan rekonsiliasi PnL.

### Tahap 3 — UX utama

- Gunakan satu ringkasan konfigurasi aktif.
- Lengkapi pembeda preset di mobile.
- Perbaiki kepadatan blotter dan akses kontrol pada layar kecil.
- Bedakan loading, empty, error, offline, dan stale.
- Tambahkan filter, pagination, ekspor, serta jejak keputusan-ke-fill.
- Perbaiki aksesibilitas dan kontras.

### Tahap 4 — Pengembangan produk

- Sediakan demo publik dan terminal read-only.
- Tambahkan layout Simple/Advanced.
- Tambahkan ringkasan risiko sebelum Start.
- Optimalkan realtime dan render UI.
- Perkuat pengujian Evidence dan konsistensi klaim produk.

## Sumber dan konteks

- [Monday localhost](http://localhost:3000/) — aplikasi yang diaudit.
- [Tread](https://app.tread.fi/) — pembanding UI terminal tanpa login.
- Source code pada workspace Monday — referensi relatif tersedia pada tiap temuan.
- [WCAG 2.2: Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) — acuan kontras teks.

Nomor baris mengacu pada snapshot kode saat audit dan dapat berubah setelah implementasi berikutnya.
