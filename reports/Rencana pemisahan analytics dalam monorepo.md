# Rencana pemisahan analytics dalam monorepo

Untuk agent pengembang Monday. Disusun 10 Oktober 2026, Asia/Jakarta. Repository tetap `/Users/yoga/Projects/mondaynad`, remote [moudybk1/monday](https://github.com/moudybk1/monday).

**Keputusan yang sudah disepakati**

Monday tetap memakai satu repository. Analytics publik menjadi aplikasi dengan deployment dan subdomain sendiri. Pengolahan serta penyajian data analytics dipisahkan dari proses trading. Terminal, onboarding, policy, dan My Monday tetap berada dalam aplikasi utama.

Hasil yang diinginkan adalah analytics lebih cepat dibuka, beban kunjungan publik tidak menunda kontrol trading, dan pengguna memahami kapan mereka melihat data publik atau performa akun pribadi. Pergantian domain saja tidak cukup untuk mencapai hasil tersebut.

Dokumen ini merupakan spesifikasi implementasi. Nama folder baru, variabel tambahan, dan perintah baru di bawah adalah target pekerjaan. Migrasi belum diterapkan melalui penyusunan laporan ini.

## 1 Kondisi kode yang harus dipertahankan

Repository sudah memakai npm workspaces melalui `apps/*` dan `packages/*`. Tidak diperlukan perpindahan package manager atau penambahan Turborepo untuk menyelesaikan migrasi awal. [Konfigurasi workspace](/Users/yoga/Projects/mondaynad/package.json).

Saat ini frontend berada di `apps/web`. Halaman analytics publik dan My Monday sama sama berada di bawah `/analytics`. API statistik publik didaftarkan pada Fastify yang juga melayani runner, sesi, dan perintah agent. Query SQLite serta perhitungan performa wallet masih terjadi dalam proses API tersebut. [Registrasi API](/Users/yoga/Projects/mondaynad/apps/server/src/api.ts), [rute statistik](/Users/yoga/Projects/mondaynad/apps/server/src/stats/routes.ts).

Ada perubahan yang sudah masuk setelah audit terdahulu: kurva wallet dibatasi menjadi 600 titik, cache wallet tersedia, beberapa sumber memakai cache yang menyajikan hasil sebelumnya selama pembaruan, dan indexer berjalan terpisah ketika aplikasi menggunakan dana nyata. Pertahankan perbaikan tersebut. Temuan payload 4,39 MB dari snapshot audit lama tidak boleh dipakai sebagai ukuran kondisi terbaru tanpa pengukuran ulang.

Indexer masih mengimpor konfigurasi trading. Pada mode simulasi, server trading masih menjalankan indexer di dalam prosesnya. Database statistik dibuka dari `process.cwd()` dan modul indexer menyiapkan schema ketika diimpor. Pemisahan harus menangani ketergantungan ini, bukan hanya memindahkan pemanggilan `startIndexer()`. [Boot server](/Users/yoga/Projects/mondaynad/apps/server/src/index.ts), [indexer](/Users/yoga/Projects/mondaynad/apps/server/src/stats/indexer.ts), [entrypoint indexer](/Users/yoga/Projects/mondaynad/apps/server/src/stats/run.ts).

Konfigurasi Docker saat ini menjalankan `src/index.ts` secara langsung dan Compose belum mendefinisikan layanan indexer terpisah. Volume `/data` di Compose dikaitkan dengan `DATABASE_PATH` trading, sedangkan path statistik masih berasal dari folder proses. Kedua hal ini wajib diperbaiki dalam konfigurasi deployment baru. [Dockerfile](/Users/yoga/Projects/mondaynad/infra/Dockerfile), [Compose](/Users/yoga/Projects/mondaynad/infra/docker-compose.yml).

Kode sedang aktif berubah. Agent harus membaca versi workspace terbaru dan mempertahankan perubahan pengguna. Laporan audit sebelumnya merupakan sumber kasus regresi, bukan daftar kegagalan yang otomatis masih ada pada setiap versi baru.

## 2 Pembagian aplikasi dan kepemilikan

1. `apps/web`: aplikasi utama yang sudah ada. Tetap memiliki landing, onboarding, terminal, policy, My Monday, Evidence, dan record keputusan.
2. `apps/analytics`: frontend baru untuk overview Perpl, wallet publik, leaderboard, risiko likuidasi, Watch, dan Compare. Tidak membutuhkan koneksi wallet untuk fungsi utamanya.
3. `apps/server`: API trading, autentikasi, penyimpanan key, runner, feed trading, policy, log keputusan, dan performa pribadi. Tetap memiliki database trading sendiri.
4. `apps/stats`: satu package dengan dua entrypoint terpisah, yaitu API statistik dan worker indexer. Keduanya berbagi implementasi serta database statistik, tetapi berjalan sebagai proses terpisah.
5. `packages/core`: tipe data, validasi, konstanta publik, dan perhitungan murni yang sudah dipakai bersama. Modul browser tidak boleh menarik inisialisasi database atau konfigurasi rahasia.
6. `packages/ui`: dibuat hanya untuk komponen yang memang dibutuhkan kedua frontend, seperti token tampilan, tombol, panel, format angka, dan komponen chart umum. Hindari menyalin seluruh aplikasi atau memaksa semua komponen menjadi abstraksi bersama.

Jangan mengimpor source aplikasi lain menggunakan path relatif antarfolder `apps`. Bagian yang benar benar dipakai bersama masuk package dengan dependency eksplisit. API dan indexer tetap boleh berbagi modul internal karena keduanya berada dalam `apps/stats`.

Aliran layanan yang dituju:

```text
Browser aplikasi utama
    → frontend apps/web
    → API apps/server
    → runner dan database trading

Browser analytics publik
    → frontend apps/analytics
    → API apps/stats
    → database statistik dan pembacaan data publik Perpl

Worker indexer apps/stats
    → sumber event publik
    → database statistik
```

Tampilan boleh berbagi komponen. Layanan statistik tidak membutuhkan sesi pengguna, key Perpl pribadi, master key enkripsi trading, atau private key pencatat keputusan.

## 3 Domain dan perpindahan halaman

Gunakan origin aplikasi utama yang sudah aktif selama migrasi ini. Tambahkan origin analytics melalui konfigurasi. `analytics.example.com` hanyalah contoh subdomain; tidak ada domain nyata yang ditetapkan dalam laporan.

Jika nanti landing memakai domain utama dan terminal memakai `app.example.com`, lakukan perpindahan origin sesi sebagai pekerjaan tersendiri. Pemisahan analytics dapat selesai tanpa sekaligus memindahkan alamat terminal, cookie login, dan domain signature SIWE.

Pemetaan rute target:

1. `/analytics` pada aplikasi lama menuju `/` pada origin analytics.
2. `/analytics/wallet/:q` menuju `/wallet/:q` pada origin analytics.
3. `/analytics/compare` menuju `/compare` pada origin analytics. Pertahankan parameter `w` dan parameter yang memang didukung.
4. `/analytics/monday` tetap pada origin aplikasi utama dan diarahkan ke `/app/performance` dengan label My Monday.
5. `/app`, `/app/onboarding`, `/app/policy`, `/evidence`, dan `/decisions/:id` tetap dimiliki aplikasi utama.

Gunakan redirect sementara 307 selama rollout agar mudah dikembalikan. Pemetaan khusus My Monday harus diperiksa sebelum aturan umum analytics. Jangan membuat wildcard yang mengirim halaman pribadi ke website publik. Endpoint API diproxy pada server, bukan diarahkan ke halaman HTML.

Perhatikan gate pada layout aplikasi: saat ini pengecualian untuk melihat histori memakai prefix `/analytics`. Ketika My Monday pindah ke `/app/performance`, ubah pemeriksaan hak akses berdasarkan kebutuhan halaman. Pengguna yang sudah login harus bisa membaca histori tanpa harus memiliki key aktif, menyelesaikan onboarding baru, atau menjalankan agent. [Layout aplikasi](/Users/yoga/Projects/mondaynad/apps/web/app/app/layout.tsx), [My Monday](/Users/yoga/Projects/mondaynad/apps/web/app/analytics/monday/page.tsx).

Navigasi analytics publik memuat Overview, Wallet search, Compare, dan Open Monday. Tautan My Monday boleh mengarah ke aplikasi utama. Header terminal membedakan My Monday sebagai performa pribadi dan Analytics sebagai tujuan data publik. Gunakan origin konfigurasi untuk tautan lintas aplikasi dan perpindahan dokumen biasa, tanpa mengasumsikan router satu aplikasi dapat menangani route aplikasi lain.

## 4 Batas API dan sesi

Pindahkan lima keluarga endpoint berikut ke API statistik dengan respons yang tetap kompatibel selama tahap pertama:

```text
GET /api/stats/overview
GET /api/stats/risk
GET /api/stats/liquidations
GET /api/stats/traders
GET /api/stats/wallet/:q
```

`/api/analytics` adalah performa pribadi Monday. Endpoint tersebut tetap pada server trading, bersama `/api/auth/*`, `/api/me`, `/api/credentials`, `/api/policy`, `/api/agent/*`, `/api/state`, dan WebSocket akun. Endpoint Evidence serta record keputusan juga tetap pada pemilik semula untuk migrasi awal.

Frontend analytics memakai `/api/stats/*` pada origin miliknya. Proxy frontend meneruskannya hanya ke API statistik. Batasi daftar route proxy sehingga analytics tidak menjadi jalur alternatif menuju API key atau kontrol trading. Saat URL lama masih aktif, reverse proxy meneruskan keluarga statistik ke layanan baru tanpa menjalankan query SQLite pada proses trading.

Server trading pada akhirnya tidak mengimpor `stats/indexer`, mendaftarkan `registerStats`, membuka file statistik, atau menjalankan backfill pada mode apa pun. Pastikan penghapusan import menyelesaikan efek samping modul, bukan hanya menyembunyikan route.

Cookie sesi tetap terikat ke host aplikasi utama. Analytics publik tidak memerlukan perluasan cookie ke seluruh subdomain. Proxy statistik tidak meneruskan cookie, authorization, atau header identitas akun trading yang tidak dibutuhkan. Respons publik yang masuk cache harus bebas data sesi. My Monday dan API privat tidak memakai cache publik.

Pertahankan penanganan pergantian akun, header konteks akun, pencabutan stream saat logout, dan pengaman return path yang sudah ditambahkan. Uji ulang kasus dua akun dan dua tab dari audit sebelumnya; pemisahan website tidak otomatis memperbaiki atau membatalkan kasus tersebut.

## 5 Konfigurasi dan penyimpanan statistik

Pisahkan konfigurasi `apps/stats` dari konfigurasi trading. Pindahkan konstanta network publik ke modul yang tidak membaca secret atau menginisialisasi runner. Boot API statistik harus dapat berhasil tanpa `SESSION_SECRET`, `MONDAY_MASTER_KEY`, dan private key trading.

Konfigurasi target berikut perlu ditambahkan atau dipetakan secara eksplisit:

1. `STATS_API_URL`: alamat internal API statistik pada proxy frontend. Nilai ini merupakan konfigurasi server, bukan informasi yang harus dikirim ke browser.
2. `STATS_DATABASE_PATH`: path absolut file statistik yang persisten. API dan worker harus menunjuk file serta network yang sama.
3. `STATS_NETWORK`: identitas network statistik, tetap terpisah dari network trading.
4. `STATS_RPC_URL`: opsi endpoint RPC statistik tersendiri. Validasi chain yang dituju dan beri batas permintaan.
5. `ENVIO_API_TOKEN`: tersedia pada worker yang memerlukannya; tidak perlu disalin ke frontend.
6. `NEXT_PUBLIC_APP_ORIGIN` dan `NEXT_PUBLIC_ANALYTICS_ORIGIN`: origin publik untuk tautan dan konfigurasi navigasi. Validasi format dan jangan menerima tujuan dari input URL sembarang.

`API_URL` dan konfigurasi WebSocket aplikasi utama tetap menunjuk backend trading. Sesuaikan contoh environment dan dokumentasi; hindari membagikan satu kumpulan semua secret ke setiap layanan.

Untuk migrasi awal, pertahankan SQLite. Jalankan API statistik dan satu worker penulis pada host yang sama dengan volume lokal persisten. SQLite WAL memerlukan proses yang menggunakan file tersebut berada pada host yang sama dan tidak mendukung pembagian file WAL melalui filesystem jaringan. Karena itu, deployment frontend yang terpisah tidak berarti file SQLite dapat dibagi langsung antar mesin. [Dokumentasi SQLite WAL](https://sqlite.org/wal.html).

Pisahkan modul schema atau migrasi dari modul baca. Jalankan persiapan schema satu kali sebelum API dan worker aktif. Import modul pembacaan tidak boleh otomatis menjalankan DDL atau backfill. Uji izin file WAL serta shared memory pada konfigurasi container nyata; jangan memakai opsi immutable pada database yang masih diperbarui worker.

Migrasi database harus memakai backup SQLite yang konsisten atau prosedur checkpoint dan penghentian penulis yang terkontrol. Jangan menyalin hanya file utama dari database aktif karena transaksi yang sudah tersimpan dapat berada dalam WAL. [Ketentuan penyimpanan WAL](https://sqlite.org/wal.html#the_wal_file).

Pertahankan `px_ranges`, cursor, akun, fills, flows, liquidation, serta agregasi yang sudah ada. Sebelum dan sesudah perpindahan, cocokkan jumlah baris, rentang blok, identitas network, dan sampel hasil wallet. Startup production harus gagal dengan pesan jelas jika database yang diharapkan tidak ditemukan, kecuali bootstrap database baru memang diminta secara eksplisit.

## 6 Performa yang perlu diperbaiki

Pemisahan frontend membantu kepemilikan UI dan deployment. Next.js sendiri sudah mendukung pembagian kode menurut route, sehingga ukuran seluruh repository bukan ukuran JavaScript yang otomatis dimuat pada setiap halaman. Nilai manfaat migrasi melalui pengukuran respons data dan render halaman. [Panduan production Next.js](https://nextjs.org/docs/app/guides/production-checklist).

Pertahankan batas 600 titik kurva dan cache yang sudah tersedia. Setelah baseline, optimalkan bagian berikut sesuai hasil ukur:

1. Pisahkan pembaruan balance dan posisi live dari perhitungan histori wallet. Refresh posisi tidak perlu menghitung ulang hingga 100.000 fills.
2. Buat cache berdasarkan network, identitas akun kanonis, periode, serta versi data. Beberapa request untuk key yang sama harus berbagi pekerjaan yang sedang berjalan.
3. Sajikan histori dari ringkasan yang dipersistenkan atau pekerjaan background. Request HTTP tidak memulai pemindaian besar berulang ketika banyak pengguna membuka wallet berbeda.
4. Perbarui agregasi secara bertahap ketika fills baru masuk. Metrik seperti drawdown, holding time, dan streak bergantung urutan, sehingga tidak boleh dihitung hanya dengan menjumlahkan agregat harian.
5. Saat backfill mengisi histori lama, batalkan atau hitung ulang ringkasan yang terpengaruh. Pemrosesan ulang tidak boleh menggandakan volume, fee, atau PnL. Simpan penanda versi perhitungan dan cakupan data.
6. Gunakan pagination berbasis cursor untuk daftar transaksi. Jangan mengirim semua fills hanya agar client membuang sebagian besar titik.
7. Bedakan hasil cache yang masih segar, sedang diperbarui, parsial, dan gagal diperbarui. Simpan waktu sumber serta waktu perhitungan; jangan memperbarui tulisan Last updated hanya karena browser melakukan polling.
8. Buat polling mengikuti kebutuhan data. Histori dan leaderboard dapat lebih jarang daripada posisi live. Hentikan polling saat tab tersembunyi dan jangan memulai query panel yang belum diperlukan.
9. Muat komponen chart berat sesuai kebutuhan. Halaman publik tidak perlu membawa provider koneksi wallet atau dependency autentikasi terminal melalui import bersama.

Agregasi bertahap seluruh metrik bukan syarat untuk menyelesaikan perpindahan frontend. Tahap pertama harus sudah mengisolasi beban dari trading, mempertahankan ketepatan hasil, dan memiliki batas query serta cache yang terukur. Optimasi lanjutan dapat dilakukan sesudah isolasi tanpa mengganti kontrak UI sekaligus.

## 7 Penyimpanan browser dan kesinambungan pengguna

Watch serta tema saat ini memakai localStorage. Penyimpanan itu terikat pada origin sehingga tidak otomatis ikut saat analytics berpindah subdomain. Perilaku ini perlu dirancang secara sengaja agar pengguna tidak menganggap Watch terhapus.

Sediakan ekspor dan impor daftar Watch dalam JSON dengan versi schema, network, serta identitas akun kanonis. Pertahankan tombol ekspor pada halaman peralihan origin lama. Di origin baru, validasi jumlah entri, format, duplikasi, dan network sebelum menyimpan. Data ini tidak memerlukan cookie login atau pengiriman key wallet.

Jika handoff otomatis dipilih kemudian, gunakan pertukaran data dengan validasi origin yang ketat. Jangan menambahkan mekanisme tersebut hanya untuk mempercepat migrasi awal. Perbedaan tema pada origin baru boleh mengikuti preferensi perangkat dan harus tetap dapat diubah pengguna.

Pastikan deep link wallet dan daftar Compare tetap bekerja setelah redirect. Browser back tidak boleh membentuk loop. Kembalikan pengguna dari login My Monday ke halaman performanya melalui tujuan internal yang tervalidasi.

## 8 Urutan implementasi

**Tahap 1 Baseline dan pengaman regresi**

Catat commit serta perubahan lokal yang menjadi acuan. Jalankan build production pada salinan pengujian. Ukur overview, wallet sibuk, Compare empat akun berbeda, dan terminal. Gunakan fixture atau salinan data statistik, serta runner simulator untuk tindakan trading. Simpan hasil sebelum perubahan agar perbaikan dapat dibandingkan.

Tambahkan pengujian kontrak lima keluarga endpoint statistik dan kasus utama My Monday. Identifikasi bagian perbaikan audit yang sudah ada agar tidak tertimpa oleh perpindahan berkas.

**Tahap 2 Pisahkan API dan worker statistik**

Buat package `apps/stats`, konfigurasi terpisah, path database absolut, modul baca, migrasi schema, dan dua entrypoint. Jalankan API serta worker sendiri. Hapus ketergantungan runtime statistik dari server trading pada mode simulasi maupun dana nyata. Arahkan route lama ke layanan baru melalui proxy agar frontend lama tetap berfungsi selama tahap ini.

Kriteria selesai tahap ini: mematikan API statistik hanya mengganggu statistik. Trading tetap dapat Start, Stop, dan Kill pada simulator. Menjalankan server trading tidak membuat file statistik baru atau memulai indexer.

**Tahap 3 Pisahkan frontend publik**

Pindahkan overview, wallet, dan Compare ke `apps/analytics`. Ekstrak komponen bersama secukupnya. Pertahankan tampilan dan metrik yang sudah diperbaiki. Pindahkan My Monday ke aplikasi utama dengan gate autentikasi yang tidak memaksa trading. Buat navigasi, redirect sementara, dan ekspor serta impor Watch.

Kriteria selesai tahap ini: dua frontend dapat dibuild serta dijalankan independen. Analytics publik tidak meminta login. My Monday selalu memakai identitas dan sumber data akun pribadi.

**Tahap 4 Performa dan deployment**

Ulangi benchmark dengan fixture serta kondisi yang sama. Terapkan optimasi yang terbukti diperlukan. Perbarui root scripts, CI, Dockerfile, Compose, reverse proxy, contoh environment, health endpoint, dan dokumentasi operasi. Siapkan preview dengan origin yang saling cocok sebelum menentukan perpindahan domain production.

Migrasi awal tidak mencakup perubahan strategi trading, smart contract, wallet provider, atau perpindahan ke database baru. Perubahan tersebut hanya dilakukan bila ada kebutuhan spesifik yang terpisah.

## 9 Cara menjalankan dan deployment

Pertahankan npm workspaces dan satu lockfile. Tambahkan script pengembangan serta production untuk frontend analytics dan API statistik. Alihkan script indexer ke worker baru. Root `build` harus membangun kedua frontend; root `typecheck` harus mencakup kedua package tambahan. Perintah pengembangan boleh menggabungkan proses, sedangkan production harus mengelola setiap layanan dengan restart dan health check masing masing.

Usulan port lokal adalah web utama 3000, API trading 3001, web analytics 3002, dan API statistik 3003. Periksa port yang sudah dipakai dan gunakan override untuk pengujian terisolasi. Worker indexer tidak membutuhkan port publik. Nomor tersebut bukan alasan untuk menghentikan proses pengguna yang sedang berjalan.

Jika frontend tetap menggunakan Vercel, buat dua project dari repository yang sama dengan Root Directory `apps/web` dan `apps/analytics`. Vercel mendukung beberapa project dari direktori berbeda dalam satu monorepo. Pastikan dependency package bersama tercantum sehingga perubahan yang relevan ikut membangun ulang frontend yang menggunakannya. [Dokumentasi monorepo Vercel](https://vercel.com/docs/monorepos).

Untuk backend yang sudah memakai container, definisikan layanan trading, API statistik, dan worker indexer secara eksplisit. Dua layanan statistik dapat memakai image package yang sama dengan perintah berbeda. Hanya layanan statistik yang mendapat volume statistik; trading mempertahankan volume trading. Atur batas CPU dan memori agar backfill tidak menghabiskan kapasitas host yang juga menjalankan trading. Proses terpisah masih dapat bersaing atas sumber daya mesin yang sama.

Health API statistik membedakan proses hidup, database siap dibaca, data belum tersedia, dan indexer tertinggal. Matinya RPC tidak perlu dianggap proses mati jika cache valid masih dapat dilayani, tetapi usia data harus terlihat. Status indexer mengikuti network statistik, bukan network trading.

Jangan mengandalkan filesystem sementara deployment frontend untuk SQLite persisten atau worker kontinu. Topologi awal mempertahankan API statistik dan worker pada satu host dengan volume lokal. Skala lintas host memerlukan rancangan penyimpanan tersendiri setelah ada kebutuhan terukur.

## 10 Pengukuran dan kriteria selesai

Catat waktu respons API, waktu transfer, ukuran respons sebelum dan sesudah kompresi, JavaScript yang dimuat, waktu render chart, memori proses, serta keterlambatan event loop trading. Pisahkan hasil saat cache kosong dan terisi. Pada pengukuran halaman, lakukan setidaknya lima kunjungan baru dan lima kunjungan ulang dengan perangkat serta pembatasan jaringan yang sama. Persentil API dihitung dari uji beban yang menghasilkan cukup request, bukan dari lima kunjungan tersebut.

Gunakan dua tingkat pengunjung analytics, misalnya 10 dan 50 pengguna virtual selama 60 detik per tingkat, masing masing tiga kali. Campurkan overview, wallet berbeda, dan Compare. Jalankan hanya pada staging atau fixture lokal; jangan menggunakan traffic beban ini terhadap endpoint publik pihak ketiga atau server dana nyata. Rekam periode refresh cache dan pekerjaan indexer agar hasil tidak hanya mencerminkan cache diam.

Target awal berikut adalah kriteria proyek, bukan hasil benchmark yang sudah tercapai:

1. Respons API statistik dengan cache terisi memiliki p95 maksimal 500 ms pada lingkungan pengujian yang dicatat.
2. Waktu halaman analytics sampai ringkasan utama terlihat ditargetkan maksimal 2,5 detik pada profil desktop pengujian. Hasil mobile dilaporkan terpisah dengan konfigurasi perangkat yang jelas.
3. Kurva tetap paling banyak 600 titik dan daftar transaksi tidak bertambah tanpa batas bersama umur wallet. Setiap kenaikan payload dibanding baseline dijelaskan.
4. Di bawah beban analytics, p95 penerimaan Stop dan Kill pada API trading simulator tidak bertambah lebih dari nilai yang lebih besar antara 20 persen baseline atau 25 ms. Ukur waktu server menerima perintah terpisah dari waktu venue menuntaskan penutupan posisi.
5. Tidak ada putusnya stream trading atau runner berhenti akibat restart API statistik maupun worker pada uji isolasi. Jika satu host masih kehabisan CPU atau memori, ubah batas sumber daya atau penempatan layanan lalu ulangi.
6. Jika target belum tercapai, agent menyimpan angka aktual dan penyebabnya, lalu menyelesaikan penyebab yang ditemukan. Pergantian subdomain tidak boleh dipakai sebagai bukti aplikasi sudah lebih cepat.

Pengujian fungsional wajib mencakup:

1. Kesetaraan hasil API lama dan baru untuk fixture yang sama, termasuk ordering fills, fee, PnL, profit factor, coverage, dan pemotongan histori.
2. Indexer restart dan backfill tidak menggandakan data. API serta worker membaca path dan network yang sama setelah container dibuat ulang.
3. Halaman overview, wallet, Watch, dan Compare tetap berfungsi pada desktop serta lebar 390 px. State loading, kosong, data lama, 404, 429, serta error layanan memiliki pesan yang sesuai.
4. URL lama mempertahankan wallet serta parameter Compare. My Monday tidak pernah diarahkan ke origin publik.
5. Pengguna tanpa key aktif tetap dapat membaca histori pribadinya sesudah login. Login mempertahankan tujuan, dan sesi tidak dibagikan ke analytics publik.
6. Kasus dua akun dan dua tab tetap menolak tindakan dengan konteks akun kedaluwarsa. Logout menghentikan akses stream privat yang relevan.
7. Ekspor Watch dari origin lama lalu impor di origin baru menghasilkan daftar yang sama tanpa duplikasi atau tercampur network.
8. Restart masing masing layanan analytics tidak menghentikan proses trading. Pemakaian resource host juga diuji saat backfill berjalan.

## 11 Rollout dan pemulihan

Deploy API statistik lebih dahulu, lalu arahkan endpoint lama melalui proxy. Setelah kontrak dan hasilnya sesuai, deploy frontend analytics pada preview. Uji route, My Monday, database persisten, dan benchmark sebelum mengaktifkan redirect production.

Simpan konfigurasi origin dan tujuan proxy per environment. Preview harus mengarah ke backend pengujian yang sesuai. Hindari tautan preview menuju kontrol trading production karena nilai environment yang diwariskan.

Selama masa transisi, pertahankan frontend analytics lama yang dapat dinyalakan kembali melalui konfigurasi. Bila frontend baru gagal, kembalikan navigasi ke frontend lama sambil tetap memakai API statistik terpisah. Pemulihan tampilan tidak boleh otomatis memasukkan query statistik berat kembali ke proses trading.

Gunakan perubahan schema yang kompatibel dengan versi API sebelum dan sesudah rollout. Cadangan database harus diuji dapat dipulihkan. Dokumentasikan versi image, path volume, perintah layanan, route proxy, serta cara memeriksa cursor dan network. Jangan menghapus database lama hanya karena aplikasi baru sudah dapat dibuka.

## 12 Hasil yang harus diserahkan agent

1. Implementasi pemisahan dalam repository yang sama, dengan build independen dan dependency yang jelas.
2. Konfigurasi lokal serta deployment untuk dua frontend, API trading, API statistik, dan worker indexer.
3. Pemetaan route, migrasi Watch, serta alur My Monday yang sudah diuji.
4. Catatan perpindahan database yang memuat path asal, path tujuan, pemeriksaan isi, dan langkah pemulihan.
5. Hasil benchmark sebelum dan sesudah pada kondisi yang sama, beserta hasil uji isolasi beban analytics terhadap trading.
6. Daftar tes yang dijalankan dan masalah yang masih terbuka. Tidak menyatakan audit lama selesai tanpa menguji ulang kasus yang relevan.
7. README dan contoh environment yang cukup untuk menjalankan ulang seluruh layanan tanpa menebak urutan startup.

Mulai dari baseline dan pemisahan layanan statistik. Gunakan [audit mendalam](</Users/yoga/Projects/mondaynad/reports/Deep app audit 2026-10-10.md>) serta [audit user flow](</Users/yoga/Projects/mondaynad/reports/User flow and feature audit 2026-10-10.md>) sebagai daftar kasus regresi. Selesaikan perpindahan secara bertahap dengan bukti pada setiap batas layanan.
