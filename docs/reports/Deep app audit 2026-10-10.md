# Audit mendalam Monday

Tanggal: 10 Oktober 2026, Asia/Jakarta. Repository: `/Users/yoga/Projects/mondaynad`. Acuan commit: `d157a662e75972ae261c7a6204ab6fa7f676ed53`, termasuk perubahan lokal yang sudah ada saat audit. Temuan ini berlaku untuk snapshot tersebut.

**Kesimpulan**

Monday sudah memiliki alur produk yang berjalan. Namun kontrol darurat masih memiliki dua kegagalan yang berhasil direproduksi, angka analytics dapat terlihat lengkap ketika cakupannya parsial, dan beberapa keadaan gagal tidak memberi pengguna jalan keluar. Prioritas pertama adalah keandalan kontrol dan kebenaran data, lalu struktur tampilan mobile dan penyederhanaan terminal. Merapikan warna dan jarak saja belum menyelesaikan masalah utama.

Ada 16 temuan yang perlu ditindaklanjuti: 4 berprioritas P1 dan 12 berprioritas P2. P1 berarti perlu diperbaiki sebelum mengandalkan aplikasi untuk penggunaan dana nyata atau menyajikan analytics sebagai histori lengkap. P2 berarti bug atau hambatan penggunaan yang perlu dituntaskan pada siklus berikutnya. Temuan melalui pembacaan kode ditandai secara eksplisit; tidak semuanya diuji dengan transaksi nyata.

**Cara audit dan batasnya**

1. Membaca implementasi runner, API, indexer, perhitungan analytics, autentikasi, publikasi policy, onboarding, terminal, halaman policy, analytics, compare, wallet, dan evidence.
2. Memeriksa UI desktop 1365 × 900 dan mobile 390 × 844. Menggunakan DOM dan screenshot untuk membedakan data hilang dengan data yang sekadar berada di luar layar.
3. Membaca API analytics mainnet dan SQLite dalam mode baca saja. Konfigurasi aktif menunjukkan `realFunds: true`, sehingga pengujian tindakan dilakukan pada salinan terpisah dengan venue simulator, database aplikasi di memori, dan tanpa menyalin berkas environment atau kunci pengguna.
4. Menjalankan onboarding simulator, validasi jenis token, Start, Stop, Kill, kegagalan API, pembatasan request, dan reproduksi konkurensi runner dengan venue tiruan.
5. `npm test` lulus: 7 berkas, 66 pengujian. `npm run typecheck` lulus. `forge test -q` selesai dengan kode keluar 0. Production build lulus pada salinan audit dengan konfigurasi Next asli. Build tersebut membuktikan kompilasi, bukan koneksi deployment produksi.

Tidak ada transaksi mainnet, penandatanganan wallet, penghapusan kredensial nyata, atau perubahan implementasi aplikasi dalam audit ini. Tidak dilakukan uji beban produksi, audit formal smart contract, pengujian penetrasi menyeluruh, atau pengujian semua kombinasi wallet dan perangkat. Tidak ada klaim bahwa seluruh bug telah ditemukan.

## 1. Temuan P1

### A01. Start dapat membatalkan efek Kill yang datang saat koneksi belum selesai

**Bukti:** berhasil direproduksi menggunakan kelas Runner asli dan koneksi venue tiruan yang sengaja ditunda.

`start()` memeriksa kewajiban flatten sebelum `await this.open()`. Ketika koneksi masih menunggu, `kill()` mengubah status menjadi killed dan menyimpan kewajiban flatten. Setelah koneksi selesai, kelanjutan Start menghapus kewajiban tersebut dan mengubah status kembali menjadi quoting.

Hasil reproduksi: sesudah Kill, status `killed`, `owes: flatten`, posisi `0.01`. Sesudah Start terselesaikan, status `quoting`, `owes: null`, posisi tetap `0.01`. Ini menunjukkan risiko pada permintaan bersamaan, misalnya dua tab atau retry. Penguncian tombol pada satu halaman tidak melindungi runner di server.

Lokasi: [runner.ts:288](/Users/yoga/Projects/mondaynad/apps/server/src/runner.ts:288), khususnya kelanjutan setelah baris 292, dan [kill:332](/Users/yoga/Projects/mondaynad/apps/server/src/runner.ts:332).

**Perbaikan:** serialisasikan transisi lifecycle per runner atau gunakan penanda generasi yang diperiksa kembali setelah setiap operasi asynchronous. Kill harus membatalkan Start yang masih menunggu, dan kewajiban flatten tidak boleh dihapus oleh kelanjutan yang sudah kedaluwarsa.

**Syarat selesai:** pengujian Start tertunda → Kill → koneksi selesai tetap menghasilkan status killed sampai cleanup tuntas. Tambahkan variasi Stop, penggantian key, dan kegagalan koneksi pada mekanisme yang sama.

Bukti tersimpan: [hasil reproduksi](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/start-kill-race.json>) dan [kode reproduksi](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/start-kill-repro.ts>).

### A02. Kuota request biasa dapat memblokir tombol darurat Kill

**Bukti:** berhasil direproduksi melalui HTTP pada server simulator.

Hook API memberikan satu anggaran 60 request per menit untuk seluruh endpoint dalam sesi. Setelah setup dan Start berhasil, request baca menghabiskan anggaran. Request baca ke 58 pada fase probe mendapat 429, lalu `POST /api/agent/kill` juga mendapat 429. Handler Kill tidak dijalankan. Aktivitas beberapa tab, polling, atau retry dapat bersaing dengan perintah darurat.

Lokasi: [api.ts:128](/Users/yoga/Projects/mondaynad/apps/server/src/api.ts:128).

**Perbaikan:** pisahkan anggaran request baca dari tindakan darurat, sediakan kapasitas khusus untuk cancel dan Kill, serta pertahankan autentikasi dan idempotensi. Sertakan informasi waktu retry pada endpoint biasa.

**Syarat selesai:** setelah kuota baca habis, Kill yang sah tetap diterima dan dijalankan. Pengulangan Kill tidak membuka trading kembali atau menggandakan efek samping.

Bukti: [rate-limit-kill.json](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/rate-limit-kill.json>).

### A03. Status live dan kelengkapan histori tidak dibedakan dengan benar

**Bukti:** teramati pada API, UI, dan database aktif.

Indexer mengikuti head terbaru dan API menyatakan `live: true`. Namun agregasi `px_day` tidak memiliki baris untuk 11 Agustus sampai 5 Oktober, rentang 56 hari. Ada juga celah pada 17 sampai 18 Februari, 21 Februari, dan 7 Oktober. Pada snapshot pukul sekitar 13.36 WIB, rentang 30 hari memiliki hanya 4 hari dengan fee terisi, sedangkan rentang 90 hari memiliki 33. Fee 7 hari dan 30 hari sama sama sekitar $7,112.43; trader aktif keduanya 402.

UI mengatakan histori diindeks dari genesis. Grafik fee membuang tanggal kosong lalu menyusun bar yang tersisa dengan jarak seragam. Akibatnya, pengguna tidak dapat melihat panjang celah sebenarnya. Label live sendiri menunjukkan posisi cursor terkini, bukan bukti semua histori sudah tercakup.

Lokasi: [historyComplete:233](/Users/yoga/Projects/mondaynad/apps/server/src/stats/indexer.ts:233), [cursor RPC:202](/Users/yoga/Projects/mondaynad/apps/server/src/stats/indexer.ts:202), [History:85](/Users/yoga/Projects/mondaynad/apps/web/app/analytics/page.tsx:85), [overview:103](/Users/yoga/Projects/mondaynad/apps/server/src/stats/routes.ts:103).

**Perbaikan:** simpan rentang blok yang benar benar selesai dibaca, bedakan freshness dengan coverage, lakukan rekonsiliasi agregasi terhadap log mentah, dan tampilkan cakupan per metrik. Pertahankan tanggal kosong pada sumbu waktu. Jangan mengubah data yang belum tersedia menjadi nol.

Penggunaan cursor bersama oleh HyperSync dan RPC merupakan jalur yang dapat meninggalkan celah setelah perpindahan sumber. Riwayat proses belum membuktikan bahwa itulah penyebab database sekarang. Ketiadaan agregasi juga belum membuktikan semua log mentah pada tanggal tersebut hilang.

**Syarat selesai:** fixture dengan awal dan akhir histori tersedia tetapi bagian tengah kosong tetap dinyatakan parsial. Total dan leaderboard menampilkan batas cakupan yang sama. Backfill dapat diulang tanpa menggandakan data.

Bukti: [cakupan database](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/indexed-coverage.json>) dan [snapshot overview](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/live-overview-summary.json>).

### A04. Statistik wallet dipotong pada 100.000 fills tetapi tetap dinyatakan lengkap

**Bukti:** teramati pada akun publik 10 dan implementasi API.

API mengambil paling banyak 100.000 fills terbaru, menghitung seluruh statistik dari subset itu, lalu mengisi `historyComplete` dari status indexer global. Akun 10 memiliki lebih dari 1,35 juta fills menurut agregasi database, tetapi respons memberikan `performance.trades: 100000` dan `historyComplete: true`. Pengguna tidak menerima peringatan pemotongan. Perbandingan wallet akhirnya dapat memakai rentang waktu berbeda tanpa penjelasan.

Lokasi: [routes.ts:162](/Users/yoga/Projects/mondaynad/apps/server/src/stats/routes.ts:162), terutama query baris 172 dan flag baris 188.

**Perbaikan:** hitung statistik penuh dari agregasi yang benar, atau tampilkan periode eksplisit beserta `truncated`, jumlah fills tersedia, dan batas awal. Kelengkapan wallet harus memperhitungkan pemotongan query serta coverage indexer.

**Syarat selesai:** akun dengan lebih dari 100.000 fills tidak boleh mengklaim statistik penuh jika masih memakai subset. Compare harus memperlihatkan periode masing masing akun atau menggunakan periode bersama.

Bukti: [wallet-summary.json](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/wallet-summary.json>).

## 2. Temuan P2

### A05. Publikasi policy dua transaksi dapat meninggalkan status parsial yang sulit dipulihkan

**Bukti:** jalur kode, belum diuji dengan tanda tangan wallet nyata.

Frontend menyelesaikan `setPolicy`, lalu memanggil `/policy/confirm` yang mengaktifkan policy dan menghapus pending. Setelah itu baru meminta `authorizeAgent`. Jika pengguna menolak transaksi kedua, pesan di Policy mengatakan batas lama tetap berlaku, padahal policy baru sudah dikonfirmasi. Penyimpanan ulang policy dengan hash sama tidak menghasilkan pending baru sehingga jalur otorisasi dapat terlewati.

Lokasi: [wallet.tsx:153](/Users/yoga/Projects/mondaynad/apps/web/lib/wallet.tsx:153), [policy error:44](/Users/yoga/Projects/mondaynad/apps/web/app/app/policy/page.tsx:44), [mustSign:335](/Users/yoga/Projects/mondaynad/apps/server/src/api.ts:335).

**Perbaikan dan syarat selesai:** simpan status publikasi policy dan otorisasi agent secara terpisah. Setelah transaksi pertama berhasil dan kedua ditolak, UI harus menyebut policy sudah aktif tetapi otorisasi logging belum selesai, dengan tombol melanjutkan tahap kedua. Uji menggunakan provider tiruan sebelum transaksi nyata.

### A06. Urutan fills dalam blok yang sama terbalik saat menghitung performance

**Bukti:** reproduksi fungsi core dengan dua fills pada timestamp dan blok sama.

Query menghasilkan urutan `block desc, idx desc`. Fungsi performance hanya mengurutkan timestamp dan blok, sehingga urutan idx tetap terbalik. Contoh open dengan biaya $1 di idx 1 dan close untung $10 di idx 3 menghasilkan kurva `[10, 9]` serta hold time null. Urutan kejadian yang benar menghasilkan `[-1, 9]` dan hold time 0. Total akhir sama, tetapi perjalanan PnL dan pengenalan posisi salah. Streak dan drawdown juga bergantung pada urutan.

Lokasi: [perpl.ts:152](/Users/yoga/Projects/mondaynad/packages/core/src/perpl.ts:152).

**Perbaikan dan syarat selesai:** urutkan dengan identitas kejadian yang lengkap, termasuk log index. Fixture open, increase, close, dan invert dalam blok sama harus memberi hasil identik meskipun input datang terbalik.

Bukti: [hasil perhitungan](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/wallet-math-result.json>) dan [reproduksi](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/wallet-math-repro.ts>).

### A07. Profit factor tanpa kerugian berubah menjadi n/a

**Bukti:** fungsi menghasilkan `Infinity`, serialisasi JSON mengubahnya menjadi null, dan UI akun 424 menampilkan n/a meskipun ada satu penutupan untung dan tidak ada penutupan rugi.

Lokasi: [perpl.ts:200](/Users/yoga/Projects/mondaynad/packages/core/src/perpl.ts:200).

**Perbaikan dan syarat selesai:** gunakan representasi API yang eksplisit, misalnya nilai numerik beserta status `no_losses`, sehingga kasus tanpa kerugian dapat dibedakan dari belum ada transaksi. Uji dari perhitungan sampai serialisasi dan tampilan.

### A08. Metrik 7 hari dan 30 hari memakai batas waktu berbeda

**Bukti:** implementasi query.

Volume menyaring timestamp harian dengan `d.t >= now minus durasi`, sedangkan fee dan trader membulatkan cutoff ke awal hari UTC. Pada tengah hari, volume mengecualikan hari batas tetapi fee dan trader memasukkannya. Label periode yang sama tidak berarti periode agregasi yang sama.

Lokasi: [routes.ts:77](/Users/yoga/Projects/mondaynad/apps/server/src/stats/routes.ts:77).

**Perbaikan dan syarat selesai:** tetapkan definisi periode kalender atau durasi bergerak untuk semua metrik. Uji pada tengah hari UTC, tepat pergantian hari, dan kejadian pada batas periode. Jelaskan apakah hari berjalan termasuk.

### A09. Kegagalan pemuatan dapat terlihat seperti loading abadi atau akun tidak ditemukan

**Bukti:** HTTP 503 disuntikkan pada `/api/perpl/account` di simulator. Onboarding bertahan pada skeleton tanpa penjelasan dan tanpa tombol retry yang terlihat. Pembacaan kode menemukan pola serupa pada Policy. Compare mengubah semua error query menjadi teks `not found`, termasuk gangguan server.

Lokasi: [AccountStep:89](/Users/yoga/Projects/mondaynad/apps/web/app/app/onboarding/page.tsx:89), [Policy:30](/Users/yoga/Projects/mondaynad/apps/web/app/app/policy/page.tsx:30), [Compare:107](/Users/yoga/Projects/mondaynad/apps/web/app/analytics/compare/page.tsx:107).

**Perbaikan dan syarat selesai:** buat keadaan loading, kosong, gagal, dan data lama yang terpisah. Tampilkan penjelasan singkat, Retry, serta data terakhir jika tersedia. 404 boleh berarti akun tidak ditemukan; 429, 503, dan masalah jaringan harus dijelaskan sesuai penyebabnya. Setelah layanan pulih, pengguna dapat melanjutkan tanpa kehilangan input.

Bukti: [onboarding saat API gagal](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/onboarding-account-error.jpg>).

### A10. Disconnect gagal tanpa pesan dan menutup dialog terlalu cepat

**Bukti:** HTTP 503 disuntikkan pada DELETE credentials di simulator. Setelah konfirmasi, dialog tertutup, halaman tetap menunjukkan akun terhubung, dan tidak ada penjelasan kegagalan. Console mencatat `unhandledRejection` dari fungsi remove.

Lokasi: [remove:49](/Users/yoga/Projects/mondaynad/apps/web/app/app/policy/page.tsx:49) dan [dialog:106](/Users/yoga/Projects/mondaynad/apps/web/app/app/policy/page.tsx:106).

**Perbaikan dan syarat selesai:** tangani pending, sukses, dan gagal secara eksplisit. Jangan gunakan submit dialog untuk langsung menutup sebelum request selesai. Cegah pengiriman ganda dan pertahankan pesan error serta tombol Retry. UI baru menyatakan terputus setelah server mengonfirmasi.

Bukti: [log kegagalan](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/disconnect-error.json>).

### A11. Compare mobile menyembunyikan seluruh nilai pada posisi awal

**Bukti:** pada viewport 390 piksel dengan satu akun, label metrik terlihat tetapi semua nilainya berada di sisi kanan di luar layar. Data ada dalam DOM dan dapat ditemukan dengan menggulir horizontal. Pengguna melihat tabel yang seolah kosong.

Lokasi: [compare table:92](/Users/yoga/Projects/mondaynad/apps/web/app/analytics/compare/page.tsx:92). Minimum lebar 640 piksel dan perataan kanan memindahkan isi kolom pertama keluar viewport.

**Perbaikan dan syarat selesai:** satu wallet harus memakai tata letak yang muat pada layar. Untuk beberapa wallet, gunakan kartu atau kolom dengan lebar terukur, label metrik tetap terlihat, dan petunjuk gulir. Pada lebar 360 dan 390 piksel, nilai wallet pertama terlihat tanpa gestur tambahan.

![Nilai Compare tersembunyi pada mobile](/Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/compare-mobile-hidden-values.jpg)

### A12. Tombol langkah onboarding kehilangan nama aksesibel pada mobile

**Bukti:** DOM mobile menampilkan tombol langkah selesai tanpa nama. Label langkah yang tidak aktif memakai `hidden md:inline`, sedangkan nomor langkah selesai diganti ikon dekoratif. Pengguna screen reader tidak mendapat nama tujuan tombol tersebut.

Lokasi: [onboarding:54](/Users/yoga/Projects/mondaynad/apps/web/app/app/onboarding/page.tsx:54).

**Perbaikan dan syarat selesai:** berikan nama langkah permanen lewat `aria-label` atau teks khusus pembaca layar, serta status langkah aktif dan selesai. Semua tombol tetap bernama pada setiap breakpoint. Periksa navigasi keyboard dan pembacaan urutan langkah, bukan hanya tampilan visual.

### A13. Informasi network dan freshness analytics disembunyikan pada mobile

**Bukti:** status indexer tidak ditampilkan di bawah breakpoint md dan badge network tidak ditampilkan di bawah sm. Screenshot mobile tidak memiliki keduanya. Informasi ini penting ketika data dapat tertinggal atau hanya sebagian tersedia.

Lokasi: [analytics layout:50](/Users/yoga/Projects/mondaynad/apps/web/app/analytics/layout.tsx:50).

**Perbaikan dan syarat selesai:** sediakan ringkasan network dan waktu pembaruan di area konten yang selalu terlihat. Status coverage dari A03 harus tersedia pada mobile juga, dengan detail yang dapat dibuka lewat tap atau keyboard.

### A14. Klaim logging onchain tidak mengikuti kemampuan konfigurasi aktif

**Bukti:** API konfigurasi aktif menunjukkan mainnet dengan `registry: null`; health menunjukkan `chainLog: false`. Landing menyatakan wallet mempublikasikan policy pada registry Monad dan agent mencatat hash setiap keputusan. Footer mengulang klaim logging tersebut tanpa menyebut fitur sedang tidak aktif.

Lokasi: [landing claim:29](/Users/yoga/Projects/mondaynad/apps/web/app/page.tsx:29). Bukti konfigurasi: [live-config-summary.json](</Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/live-config-summary.json>).

**Perbaikan dan syarat selesai:** teks produk dan evidence harus mengikuti kapabilitas runtime. Nyatakan konfigurasi yang belum aktif secara jelas, atau selesaikan deployment dan verifikasi transaksi sebelum menyebut fitur berjalan. Submission harus membedakan implementasi tersedia dari fitur yang aktif pada demo.

### A15. Halaman wallet mentransfer kurva sangat besar berulang kali

**Bukti:** respons akun 10 berukuran 4.389.807 byte dan membawa 100.000 titik kurva. Halaman mengambil ulang setiap 15 detik, kemudian baru memangkas kurva di browser menjadi sekitar 600 titik. Compare mengambil data serupa setiap 30 detik dan memangkas setelah menerima respons.

Lokasi: [wallet polling:22](/Users/yoga/Projects/mondaynad/apps/web/app/analytics/wallet/[q]/page.tsx:22), [pemangkasan:107](/Users/yoga/Projects/mondaynad/apps/web/app/analytics/wallet/[q]/page.tsx:107), [server:186](/Users/yoga/Projects/mondaynad/apps/server/src/stats/routes.ts:186).

**Perbaikan dan syarat selesai:** pisahkan statistik ringkas, kurva yang sudah diringkas, dan riwayat paginasi. Ringkas kurva di server dengan menjaga ekstrem dan titik akhir, cache berdasarkan versi indexer, serta kurangi polling data historis yang tidak berubah. Respons ringkas tidak bertambah linear mengikuti jumlah fills. Ukur byte transfer dan waktu respons sebelum dan sesudah; ukuran payload di atas adalah body teramati, bukan pengukuran pemakaian jaringan setelah kompresi.

### A16. Candle aktif diperbarui dengan mark sementara volume menunggu refresh

**Bukti:** kode chart mengganti high, low, dan close candle dari `m.mark`, membuat candle baru dengan `v: 0`, sementara histori candle dimuat ulang setiap 60 detik. Indikator memakai seri yang sedang berubah tersebut. Ini mencampur sumber pembaruan harga dan volume tanpa penjelasan yang cukup pada tampilan.

Lokasi: [price-chart.tsx:211](/Users/yoga/Projects/mondaynad/apps/web/components/price-chart.tsx:211) dan [live candle:505](/Users/yoga/Projects/mondaynad/apps/web/components/price-chart.tsx:505).

**Perbaikan dan syarat selesai:** tentukan secara eksplisit apakah chart menampilkan mark atau harga transaksi. Gunakan pembaruan yang konsisten untuk seri tersebut, atau beri label candle berjalan sebagai estimasi dan tampilkan waktu pembaruan volume. Uji transisi menit dan pembaruan histori agar candle tidak berganti makna secara diam diam. Audit ini belum melakukan rekonsiliasi numerik terhadap semua tick upstream.

## 3. Evaluasi UI dan UX

Bagian ini berisi penilaian desain berdasarkan tampilan yang diuji. Penilaian tersebut tidak dihitung sebagai bug tambahan.

**Terminal terlalu padat untuk pengguna baru.** Pada mobile, status agent, equity, PnL, sesi, batas harian, inventory, harga order, penjelasan strategi, tiga indikator, dan label chart muncul berdekatan. Banyak teks memakai ukuran sekitar 10 sampai 12 piksel. Warna redup, kepadatan angka, dan label order yang menutupi chart membuat pengguna harus mencari sendiri informasi yang penting.

Urutan yang disarankan adalah status agent dan kondisi koneksi, exposure serta PnL, tindakan Stop dan Kill, lalu chart. Rincian inventory, indikator, order book, dan alasan keputusan dapat dibuka dari bagian tersendiri. Pada layar kecil, tampilkan hanya indikator pilihan pengguna dan ringkas penjelasan strategi menjadi satu kalimat dengan akses ke detail. Kontrol darurat harus tetap jelas tanpa menutupi konten.

![Terminal simulator pada mobile](/Users/yoga/Projects/mondaynad/reports/assets/deep-audit-2026-10-10/terminal-mobile.jpg)

**Policy menawarkan dua cara mengatur risiko sekaligus.** Preset Balanced yang aktif dapat tampil berdekatan dengan kalkulator margin 10x yang belum berlaku. Copy sudah menjelaskan hal itu, tetapi pengguna tetap harus memahami dua model konfigurasi pada satu layar. Gunakan pilihan yang jelas antara preset, margin, dan custom. Tampilkan ringkasan batas efektif yang selalu sama dengan payload yang akan disimpan.

**Analytics perlu menjelaskan data sebelum menambah kepadatan.** Metrik utama harus memperlihatkan periode dan kelengkapan. Data belum tersedia, nol, dan API gagal harus memiliki tampilan berbeda. Tooltip saja tidak cukup untuk mobile. Compare perlu menampilkan periode statistik agar angka antarwallet dapat ditafsirkan dengan benar.

**Onboarding membutuhkan pemulihan yang terlihat.** Setiap langkah perlu menyebut apa yang sedang diperiksa, apa hasilnya, dan tindakan berikutnya. Pertahankan input saat request gagal. Setelah memeriksa akun dan key, ringkasan sebelum Start harus menyebut network, apakah dana nyata, market, batas risiko efektif, serta dampak Stop dan Kill.

**Evidence sudah memiliki beberapa keputusan komunikasi yang baik.** Halaman menampilkan interval kepercayaan, jumlah sampel, asumsi replay, dan keputusan mematikan lean ketika interval mencakup nol. Pertahankan keterbukaan ini. Hasil replay tidak boleh dipresentasikan sebagai bukti profit trading nyata, dan status logging harus mengikuti A14.

## 4. Hal yang sudah berjalan dan tidak perlu dilaporkan ulang sebagai bug lama

1. Alur normal simulator dari masuk, mendeteksi akun, memasang key demo, memilih policy, memulai agent, menghentikan, hingga Kill berhasil dijalankan.
2. Key dengan scope yang salah ditolak pada alur yang diuji.
3. Stop kini menjelaskan bahwa posisi tetap terbuka dan tidak lagi diawasi Monday.
4. Dialog Kill menjelaskan cakupan penutupan posisi. Pada pengujian simulator normal, posisi ditutup dan order dibatalkan.
5. Start setelah kewajiban flatten sudah tercatat memiliki guard. A01 merupakan celah konkurensi ketika kewajiban itu baru muncul setelah pemeriksaan awal, bukan ketiadaan guard sama sekali.
6. Perubahan lokal sudah memperbaiki beberapa masalah audit sebelumnya, termasuk informasi preset mobile, label mark, penanganan cleanup pada take profit, dan akses keyboard pada baris agent. Temuan lama harus direproduksi kembali sebelum dibuka ulang.
7. Pengujian otomatis dan build lulus. Temuan di atas menunjukkan masih ada kondisi gagal dan interaksi yang belum dicakup pengujian tersebut.

## 5. Hal yang masih memerlukan investigasi

**Definisi volume ETH.** Pada snapshot yang sama, ticker 24 jam sekitar $766,988.93, sedangkan candle hari UTC berjalan sekitar $1,123,395.68. Selisih ini perlu ditelusuri melalui timestamp, satuan, definisi agregasi, dan konsistensi upstream. Jangan langsung memilih salah satu sebagai angka benar atau menyebut upstream rusak. Catatan lebih rinci tersedia pada [laporan analytics sebelumnya](</Users/yoga/Projects/mondaynad/reports/Analytics findings and agent handoff 2026-10-10.md>).

**Penyebab celah agregasi.** Periksa apakah log mentah tersedia, apakah timestamp nol pernah tersimpan, apakah ABI historis berubah, dan bagaimana cursor berpindah antarprovider. Setelah akar masalah terbukti, lakukan backfill dengan pencatatan coverage yang dapat diverifikasi.

**Wallet dan koneksi nyata.** Tahap penolakan tanda tangan, pergantian akun, pergantian network, reconnect WebSocket, dan restart proses saat transaksi masih menunggu perlu diuji pada lingkungan khusus. Audit ini tidak memakai wallet nyata untuk menguji tahapan tersebut.

## 6. Urutan pengerjaan untuk agent

1. Selesaikan A01 dan A02 beserta pengujian regresinya. Pastikan Kill memiliki prioritas pada server dan tidak memakai anggaran polling biasa.
2. Kerjakan A03 dan A04 bersama. Tambahkan metadata coverage, betulkan status kelengkapan, dan tampilkan data parsial secara jujur sebelum memulihkan histori.
3. Betulkan A06, A07, dan A08 dengan fixture kecil yang hasilnya dapat dihitung manual. Samakan definisi dan rentang metrik sebelum mempercantik chart.
4. Pulihkan alur gagal melalui A05, A09, dan A10. Uji 404, 429, 503, koneksi putus, serta transaksi tahap kedua ditolak. Tiap kegagalan harus memiliki penjelasan dan jalan lanjut.
5. Perbaiki mobile melalui A11, A12, dan A13, lalu sederhanakan terminal dan policy sesuai bagian UX. Verifikasi setidaknya pada 360, 390, 768, dan 1365 piksel serta navigasi keyboard.
6. Tuntaskan A14, A15, dan A16. Sesuaikan klaim dengan runtime, kecilkan payload analytics, dan jelaskan sumber candle berjalan.
7. Jalankan ulang pengujian otomatis, typecheck, build, serta alur simulator normal dan gagal. Simpan bukti sebelum dan sesudah untuk tiap temuan. Jangan menutup temuan hanya karena build berhasil.

**Syarat demo dianggap siap:** seluruh P1 selesai, kesalahan server memiliki pemulihan yang terlihat, nilai Compare pertama terbaca pada mobile, seluruh langkah onboarding dapat dikenali pembaca layar, klaim onchain sesuai deployment, dan statistik historis menyebut coverage sebenarnya. Detail implementasi dan status fitur yang masih parsial harus konsisten dengan submission hackathon.

**Catatan reproduksi:** berkas `start-kill-repro.ts` dibuat untuk diletakkan pada salinan sementara `apps/server` dengan database di memori, dependency tiruan, dan tanpa berkas environment produksi. Berkas `wallet-math-repro.ts` dapat dijalankan melalui tsx pada salinan workspace. Keduanya merupakan bukti audit, bukan perubahan suite pengujian aplikasi.


**Lanjutan audit alur pengguna**

[Audit user flow dan fungsi](</Users/yoga/Projects/mondaynad/reports/User flow and feature audit 2026-10-10.md>) menambahkan temuan kendali akun yang berbeda antar tab, pemeriksaan 67 kelompok fungsi, serta langkah reproduksi dan kriteria perbaikan. Temuan tambahan paling mendesak adalah F01: Stop pada tab akun lama dapat mengenai akun yang baru masuk melalui tab lain. Laporan lanjutan juga memisahkan snapshot pengujian dari perubahan kode yang berlangsung selama audit.
