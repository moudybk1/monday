# Audit user flow dan fungsi Monday

Tanggal pemeriksaan: 10 Oktober 2026, sekitar 13.50 sampai 14.10 WIB. Repository: `/Users/yoga/Projects/mondaynad`. Dokumen ini melanjutkan [audit mendalam sebelumnya](</Users/yoga/Projects/mondaynad/reports/Deep app audit 2026-10-10.md>) dengan fokus pada perjalanan pengguna, tujuan setiap kontrol, perubahan state, dan pemulihan ketika alur terputus.

**Kesimpulan utama**

Alur satu akun pada kondisi normal sudah berfungsi, tetapi identitas akun belum konsisten antara tab, koneksi realtime, dan perintah HTTP. Dalam reproduksi simulator, menekan Stop pada tab yang menampilkan akun 4949 justru menghentikan akun 9584 yang baru masuk melalui tab lain. Akun 4949 tetap quoting. Ini perlu menjadi pekerjaan pertama sebelum perbaikan tampilan.

Ada delapan temuan tambahan: satu P1, lima P2, dan dua P3. P1 berkaitan dengan kendali akun yang salah. P2 mencakup inkonsistensi identitas wallet, state policy, konteks data, dan pemulihan koneksi wallet. P3 mencakup petunjuk Compare dan tujuan navigasi setelah login. Tujuh temuan memiliki observasi langsung pada browser; temuan reconnect wallet merupakan risiko berdasarkan kode yang masih membutuhkan pengujian wallet pada lingkungan staging.

**Metode, versi, dan batas pengujian**

Halaman publik pada `localhost:3000` diperiksa untuk analytics, wallet, Compare, Evidence, dan pembukaan modal wallet. Konfigurasi aplikasi aktif menunjukkan penggunaan dana nyata. Seluruh Start, Stop, burst, pengubahan policy, sesi demo, dan pelepasan key dilakukan pada salinan simulator terpisah di `127.0.0.1:3100`, API port 3101, database aplikasi di memori, tanpa menyalin environment atau key pengguna.

Kode workspace berubah selama pemeriksaan. Reproduksi simulator berlaku untuk salinan kode yang digunakan saat pengujian, bukan otomatis untuk setiap perubahan yang datang setelahnya. [Manifest sumber](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/source-manifest.json>) memuat hash salinan audit dan pembanding workspace. Sumber terkait disimpan di direktori `audited-source` pada folder bukti. Rujukan kode di bawah mengarah ke salinan itu agar nomor baris tetap dapat diperiksa. Bagian penyebab delapan temuan masih ditemukan dalam pembacaan workspace sekitar 14.08 WIB, tetapi keseluruhan versi terbaru belum diuji ulang.

Tidak ada perubahan implementasi aplikasi, transaksi mainnet, penandatanganan wallet nyata, pembuatan kredensial nyata, atau penghapusan key nyata. Watch yang digunakan untuk pengujian wallet publik dikembalikan ke keadaan awal. Hasil 66 tes, typecheck, contract test, dan build pada laporan sebelumnya adalah baseline audit sebelumnya, bukan klaim pengulangan seluruh suite pada pemeriksaan ini.

## 1. Temuan yang perlu ditindaklanjuti

### F01. P1. Tampilan akun dan target perintah berbeda setelah pergantian sesi di tab lain

**Bukti:** direproduksi melalui UI simulator dengan dua akun dan dua tab terminal.

1. Masuk sebagai akun A, ID 4949, lalu buka terminal pada dua tab dan jalankan agent.
2. Sign out pada tab pertama. Tab kedua tetap menerima pembaruan akun A dan masih menampilkan kontrol Stop.
3. Menekan Stop di tab kedua saat belum ada sesi baru menampilkan pesan untuk sign in, tetapi data realtime akun A tetap terlihat.
4. Pada tab pertama, masuk ke akun demo B, ID 9584, selesaikan setup dan Start.
5. Tab kedua masih menunjukkan akun A 4949 dalam keadaan Quoting.
6. Tekan Stop pada tab kedua. Akun B 9584 menjadi Stopped di tab pertama, sedangkan akun A 4949 tetap Quoting.

Cookie sesi dibagikan antar tab, tetapi query pengguna dan WebSocket pada tab lama masih memakai konteks A. Request Stop memakai cookie B tanpa menyertakan identitas akun yang sedang ditampilkan. Ini bukan bukti bahwa pengguna dapat mengendalikan akun orang lain tanpa autentikasi; masalahnya adalah tindakan sah pengguna diterapkan pada konteks akun yang berbeda dari tampilan. Kelanjutan stream privat sesudah logout juga memperpanjang paparan data pada tab yang masih terbuka.

Lokasi: [logout dan penghapusan cookie](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/server/src/api.ts:239>), [subscription WebSocket](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/server/src/api.ts:433>), [effect live hanya bergantung pada mode](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/lib/live.ts:70>), [query autentikasi](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/lib/wallet.tsx:101>), dan [pengiriman tindakan terminal](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/app/app/page.tsx:76>).

**Perbaikan:** ikat subscription ke sesi yang dapat dicabut; putuskan stream pada logout atau pergantian sesi. Siarkan perubahan autentikasi antar tab, kosongkan data privat, dan buat ulang query serta stream ketika identitas berubah. Sertakan konteks akun yang diharapkan dalam tindakan dan tolak request jika tidak cocok dengan sesi aktif. Identitas dari client merupakan pengaman konsistensi, bukan pengganti pemeriksaan otorisasi server.

**Syarat selesai:** skenario dua akun dan dua tab tidak dapat membuat Stop, Kill, perubahan market, atau Save policy mengenai akun selain yang sedang ditampilkan. Tab lama segera menghapus data privat dan menonaktifkan kontrol. Logout tidak perlu otomatis menghentikan bot yang memang dirancang berjalan di server; pencabutan akses sesi harus dipisahkan dari lifecycle trading.

Bukti: [urutan sebelum dan sesudah](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/cross-account-control.json>), [akun B berhenti](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/account-b-stopped.jpg>), [akun A tetap berjalan](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/account-a-still-quoting.jpg>), dan [tab setelah logout](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/logout-other-tab.json>).

### F02. P2. Watch dan Compare memakai representasi alamat sebagai identitas

**Bukti:** direproduksi pada wallet publik akun 424.

Membuka wallet melalui nomor akun menghasilkan alamat dalam huruf kecil. Watch berubah menjadi Watching. Setelah membuka Compare lalu kembali ke wallet melalui tautan alamat, API mengembalikan alamat dengan checksum yang memakai campuran huruf besar dan kecil. Tombol kembali menjadi Watch. Membuka nomor akun 424 lagi mengembalikan Watching. Compare juga menerima nomor 424 dan alamat wallet yang sama sebagai dua kolom terpisah.

Lokasi: [resolusi nomor akun dan alamat](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/server/src/stats/routes.ts:151>), [pencocokan string Watch](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/components/stats-ui.tsx:93>), dan [pencegahan duplikasi Compare](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/app/analytics/compare/page.tsx:32>).

**Perbaikan:** gunakan identitas kanonis berupa network dan account ID, atau alamat yang dinormalisasi. Simpan alamat checksum hanya untuk tampilan. Resolve alias sebelum menambahkan kolom dan migrasikan daftar Watch lama.

**Syarat selesai:** nomor akun, alamat huruf kecil, dan alamat checksum memiliki satu status Watching dan hanya dapat menempati satu kolom Compare. Daftar Watch dua network tidak saling tertukar.

Bukti: [perubahan Watch](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/watch-case-mismatch.json>) dan [kolom wallet ganda](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/duplicate-wallet.jpg>).

### F03. P2. Kalkulator menyebut draft sebagai In force dan tidak memulihkan input yang dipakai

**Bukti:** direproduksi pada onboarding dan halaman Policy simulator.

Pada Limits sebelum Continue, margin 100 dan leverage 10 menghasilkan quote 90, inventory 900, serta loss limit 10. UI langsung menyebut hasil itu In force, padahal draft belum disimpan. Setelah menyimpan margin 100 dan leverage 9.5 pada Policy, nilai policy 85, 855, 10, dan 9.5 tetap tersimpan setelah reload, tetapi kalkulator kembali ke margin 200 dan leverage 10. Labelnya kemudian menyatakan hasil kalkulator tidak berlaku.

Penyimpanan policy berfungsi. Yang salah adalah hubungan tampilan antara input kalkulator, draft, dan policy aktif. Pengguna sulit mengetahui angka mana yang sudah mengendalikan agent.

Lokasi: [inisialisasi margin dan leverage](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/components/policy-form.tsx:159>), [perbandingan dengan draft](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/components/policy-form.tsx:169>), dan [label In force](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/components/policy-form.tsx:192>).

**Perbaikan:** sebut hasil yang belum disimpan sebagai Preview atau Unsaved changes. Tampilkan policy aktif dari respons server secara terpisah. Simpan mode dan input kalkulator, atau tampilkan kalkulator sebagai alat estimasi yang secara eksplisit perlu diterapkan. Jangan mengasumsikan margin dapat dihitung balik secara unik dari policy yang sudah terkena pembatasan.

**Syarat selesai:** edit tanpa Save tidak pernah berlabel aktif; reload memulihkan input terakhir atau menyatakan kalkulator sebagai estimasi baru. Preview, tersimpan, menunggu signature, dan aktif dapat dibedakan tanpa membaca source code.

Bukti: [draft yang disebut In force](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/draft-in-force.jpg>).

### F04. P2. Fit to my balance mengganti pilihan risiko yang tidak perlu diganti

**Bukti:** direproduksi pada Limits simulator dengan balance 1000.

Draft custom quote 50, inventory 50000, minimum spread 4 bps, loss 50, dan leverage 3 ditolak karena kebutuhan margin terlalu besar. Fit to my balance mengubahnya menjadi quote 25, inventory 250, spread 6 bps, loss 25, dan leverage 2. Tombol tersebut memulai dari preset Conservative, sehingga juga mengganti spread, loss limit, dan leverage yang dipilih pengguna.

Lokasi: [fungsi fit](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/components/policy-form.tsx:59>).

**Perbaikan:** sesuaikan ukuran yang diperlukan dengan tetap mempertahankan pilihan lain, atau ubah nama menjadi Use Conservative limits dan tampilkan perubahan sebelum diterapkan. Validasi kebutuhan margin sudah berfungsi; pertahankan validasi itu.

**Syarat selesai:** tombol penyesuaian ukuran tidak diam diam mengubah spread dan leverage. Bila beberapa perubahan memang diperlukan, pengguna melihat nilai lama dan baru beserta alasannya.

### F05. P2. My Monday kehilangan identitas akun dan sumber data trading

**Bukti:** diamati pada sesi simulator yang sudah menghasilkan fills.

Terminal menyebut Simulated market dan nomor akun. Setelah berpindah ke My Monday, data pribadi simulator ditampilkan di bawah badge Perpl testnet yang berasal dari konfigurasi analytics publik. Tidak ada identitas akun atau penanda simulasi yang sebanding. Dalam harness ini venue trading adalah simulator sedangkan `STATS_NETWORK` adalah testnet. Label network publik tidak menjelaskan asal performa pribadi.

Lokasi: [header memakai stats overview](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/app/analytics/layout.tsx:39>) dan [halaman performa pribadi](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/app/analytics/monday/page.tsx:24>).

**Perbaikan:** tampilkan akun, venue, network trading, periode, dan sumber data di My Monday. Ambil konteks dari sesi serta konfigurasi trading. Gunakan label analytics publik hanya untuk data publik.

**Syarat selesai:** performa simulator selalu diberi penanda simulasi, meskipun analytics publik membaca mainnet. Pengguna dapat mengenali akun dan jenis dana dari halaman ini secara mandiri, termasuk pada mobile.

Bukti: [konteks My Monday](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/my-monday-context.jpg>).

### F06. P3. Petunjuk Compare mengarahkan pengguna ke pencarian yang meninggalkan halaman

**Bukti:** direproduksi melalui navigasi UI.

Compare kosong meminta pengguna memakai search above. Pencarian utama di atas tab membuka halaman detail wallet ketika Enter ditekan; input Add address or account pada area Compare justru menambahkan kolom. Keduanya menerima input yang hampir sama, tetapi menghasilkan tindakan berbeda. Ini masalah petunjuk dan pembeda tujuan, bukan kegagalan fungsi Add.

Lokasi: [petunjuk kosong](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/app/analytics/compare/page.tsx:87>) dan [tujuan pencarian utama](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/app/analytics/layout.tsx:63>).

**Perbaikan:** beri nama Open wallet pada pencarian global dan Add to comparison pada input lokal. Petunjuk kosong harus menunjuk kontrol penambahan yang benar.

**Syarat selesai:** pengguna yang mengikuti petunjuk halaman kosong bisa menambahkan dua wallet tanpa meninggalkan Compare atau kehilangan daftar yang sudah dipilih.

### F07. P3. Login dari My Monday tidak mempertahankan tujuan awal

**Bukti:** jalur sebelum login diamati melalui UI; tujuan setelah onboarding dikonfirmasi dari kode.

My Monday yang belum login menawarkan Open Monday ke `/app`. Pengguna melihat Connect wallet di terminal, lalu akhir onboarding selalu menuju `/app`. Tidak ada penanda untuk kembali ke analytics pribadi yang semula diminta.

Lokasi: [tautan login My Monday](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/app/analytics/monday/page.tsx:41>) dan [tujuan sesudah Start](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/app/app/onboarding/page.tsx:235>).

**Perbaikan:** bawa tujuan internal yang tervalidasi sepanjang login dan setup, lalu kembali ke halaman yang diminta jika prasyarat terpenuhi. Untuk sekadar melihat histori, jangan memaksa Start jika akun sudah memiliki histori yang dapat dibaca.

**Syarat selesai:** login dari My Monday kembali ke My Monday. Login dari Terminal kembali ke Terminal. Parameter tujuan tidak boleh menjadi redirect ke domain luar.

### F08. P2. Recovery wallet meminta reconnect tanpa menyediakan tindakan langsung

**Bukti:** inspeksi kode, belum diuji dengan wallet nyata.

Jika cookie sesi masih valid tetapi koneksi wallet tidak memiliki alamat, `canSign` bernilai false. Review meminta pengguna reconnect tetapi tombol Sign on Monad dinonaktifkan. Shell yang masih authenticated menampilkan Sign out, sementara Connect wallet berada pada cabang belum login. Policy juga menonaktifkan signature ketika wallet belum terhubung. Jalur pemulihan dari state tersebut tidak menyediakan tombol reconnect yang jelas.

Review juga menyebut One transaction untuk menyimpan policy dan memberi otorisasi agent. Implementasi bisa membutuhkan dua transaksi terpisah. Ini memperburuk pemahaman pengguna ketika transaksi policy selesai tetapi otorisasi agent ditolak; risiko commit parsial sudah dijelaskan sebagai A05 pada audit sebelumnya.

Lokasi: [state canSign dan dua transaksi](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/lib/wallet.tsx:152>) dan [pesan reconnect serta tombol nonaktif](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/audited-source/apps/web/app/app/onboarding/page.tsx:259>).

**Perbaikan:** sediakan Reconnect wallet pada langkah yang memerlukannya, periksa kesesuaian alamat, dan tampilkan tahapan Publish policy serta Authorize agent secara terpisah. Lanjutkan dari tahapan yang belum selesai tanpa menyuruh pengguna mengulang semuanya.

**Syarat selesai:** pada staging, putuskan koneksi wallet dengan cookie tetap valid. Pengguna dapat reconnect, menolak salah satu signature, mencoba kembali, dan menyelesaikan tahapan yang tersisa dengan status yang benar. Temuan belum dianggap selesai hanya karena tombol reconnect ditambahkan.

## 2. Penilaian perjalanan pengguna

**Pengunjung baru → memahami produk → mencoba**

Landing → How it works → Evidence atau Analytics → Launch app → Connect wallet. Navigasi utama tersedia dan modal wallet terbuka. Namun bukti simulasi, bukti historis, dan transaksi onchain perlu memiliki label yang konsisten. Keterangan hash cocok hanya membuktikan kecocokan payload terhadap hash tersimpan; itu bukan bukti keputusan telah tercatat onchain.

**Akun baru → siap trading**

Wallet → Perpl account → Trade key → Limits → Review → Start. Alur simulator berhasil diselesaikan. Risiko terbesar berada pada makna Limits aktif, hilangnya input kalkulator, dan tahapan signature. Review sebaiknya menampilkan identitas akun, jenis dana, market aktif, estimasi kebutuhan margin, daily loss, serta pilihan stop loss dan target sesi sebelum Start pertama.

**Trading → memantau → mengubah → berhenti**

Terminal → pilih market → baca chart dan quote model → Trade market atau Stop market → baca fills dan keputusan → Stop global atau Kill. Memilih market hanya mengganti tampilan; Trade market mengubah policy dan dapat memulai quoting market itu saat agent sudah aktif. Perbedaan ini sudah ada pada tooltip, tetapi perlu terlihat sebelum pengguna melakukan tindakan.

Stop market dapat mengerjakan keluar posisi market tersebut. Stop global menghentikan quote dan pemantauan sambil membiarkan posisi terbuka. Kill membatalkan order dan menutup posisi. Ketiga tindakan ini perlu memakai penjelasan akibat yang langsung terlihat. Peringatan posisi terbuka setelah Stop sudah berfungsi dan perlu dipertahankan.

**Analytics → wallet → Watch → Compare → kembali**

Pencarian wallet dan penambahan kolom Compare bekerja, tetapi identitas wallet berubah tergantung pintu masuk. Satu wallet harus tetap satu entitas sepanjang perjalanan ini. Periode dan kelengkapan data juga harus konsisten; tombol filter yang berhasil dipilih tidak membuktikan angka di bawahnya benar. Temuan coverage pada laporan sebelumnya tetap perlu verifikasi tersendiri terhadap versi terbaru.

**My Monday → login → kembali ke performa pribadi**

Login harus mempertahankan tujuan semula. Setelah masuk, halaman performa perlu menampilkan siapa yang dilihat, jenis venue, periode, dan apakah datanya simulasi. Konteks itu tidak boleh hanya tersedia pada Terminal.

**Keluar → kembali → melanjutkan**

Bedakan Sign out, Disconnect key, pencabutan key di Perpl, Stop, dan Kill. Sign out mengakhiri sesi browser; tidak sama dengan menghentikan bot. Disconnect menghapus koneksi aplikasi; pencabutan key dilakukan di Perpl. Sebelum keluar, jelaskan apakah agent tetap berjalan dan posisi masih terbuka. Pergantian sesi harus langsung tercermin pada seluruh tab.

## 3. Inventaris fungsi dan status verifikasi

Status UI berarti kontrol dioperasikan dan hasil tampak diperiksa. Status kode berarti fungsi dibaca tetapi jalur lengkap belum dijalankan. Status sebelumnya merujuk audit mendalam terdahulu. Kontrol dikelompokkan ketika beberapa pilihan melakukan fungsi yang sama; inventaris ini bukan klaim semua kombinasi perangkat, input, jaringan, dan wallet telah diuji.

**T01. Navigasi Home, How it works, Custody, Analytics, Evidence, Launch app**

Fungsi: Menghubungkan penjelasan produk, bukti, data publik, dan aplikasi. Status: UI dan kode. Halaman tujuan utama terbuka; anchor informasional tidak melakukan trading.

**T02. Preview market di landing**

Fungsi: Menampilkan kondisi market publik yang dipilih. Status: UI sebagian. Preview BTC terlihat; semua variasi market landing belum dioperasikan. Pemilih market terminal diuji terpisah.

**T03. Ilustrasi How it works**

Fungsi: Menjelaskan deteksi aliran dan perubahan perilaku quote. Status: UI sebagian. Detect dan Step aside berganti tampilan; ilustrasi bukan bukti transaksi akun pengguna.

**T04. Theme**

Fungsi: Mengganti tema terang dan gelap. Status: UI. Tema berganti dan dikembalikan; diuji pada origin simulator.

**T05. Connect wallet dan Close modal**

Fungsi: Membuka pemilihan wallet dan membatalkannya. Status: UI sebagian. Modal menampilkan Browser Wallet, Rabby, MetaMask, dan OKX. Koneksi ekstensi dan signature nyata tidak dijalankan.

**T06. SIWE sign in**

Fungsi: Mengautentikasi pemilik wallet melalui pesan. Status: Kode. Validasi nonce, domain, chain, dan signature dibaca. Belum diuji dengan wallet nyata pada pemeriksaan ini.

**T07. Use a demo account**

Fungsi: Membuat sesi simulasi untuk mencoba aplikasi. Status: UI. Dua akun demo dapat masuk dan menyelesaikan setup; pergantian akun mengungkap F01.

**T08. Perpl account dan balance**

Fungsi: Memastikan akun dan dana yang dibutuhkan tersedia. Status: UI simulator. Akun ditemukan dengan balance 1000 dan Continue aktif. Kondisi API gagal tercatat dalam audit sebelumnya.

**T09. Open Perpl dan Check now**

Fungsi: Membuka tempat deposit serta memeriksa ulang akun. Status: Kode. Tujuan tautan dan refetch dibaca. Deposit, withdraw, dan akun yang baru didanai tidak diuji langsung.

**T10. Navigasi langkah setup**

Fungsi: Menampilkan langkah yang tersedia sesuai prasyarat. Status: UI sebagian. Alur maju selesai. Semua kombinasi kembali, refresh, dan deep link belum diuji; label mobile dibahas dalam A12.

**T11. Perpl API keys page**

Fungsi: Membuka pengelolaan key di Perpl. Status: Kode. Merupakan tujuan eksternal; pembuatan dan pencabutan key nyata tidak dilakukan.

**T12. Fill a demo key**

Fungsi: Mengisi pasangan key khusus simulator. Status: UI. Field terisi dan bisa diteruskan ke validasi.

**T13. Validate key**

Fungsi: Memeriksa kredensial lalu menghubungkannya dengan akun. Status: UI simulator. Key demo valid melanjutkan ke Limits. Penolakan jenis token dibahas dalam audit sebelumnya.

**T14. Preset risiko**

Fungsi: Mengisi batas dari pilihan preset. Status: UI sebagian dan kode. Balanced dan Custom digunakan, Conservative muncul melalui Fit. Seluruh preset dan batas operator belum diuji kombinasinya.

**T15. Pilihan market pada Limits**

Fungsi: Menentukan market yang boleh diperdagangkan. Status: UI sebagian dan kode. Perubahan market juga diuji melalui Trade ETH dan Stop ETH di terminal. Perlu memperlihatkan pengaruh jumlah market terhadap margin.

**T16. Custom limits**

Fungsi: Mengatur quote size, inventory, spread, daily loss, dan leverage. Status: UI. Input dapat diubah; draft yang tidak sesuai balance menonaktifkan Continue.

**T17. Margin calculator dan slider leverage**

Fungsi: Menghitung batas dari margin serta leverage. Status: UI, F03. Angka turunannya berubah, tetapi label aktif dan pemulihan input setelah reload tidak konsisten.

**T18. Fit to my balance**

Fungsi: Menyesuaikan draft agar sesuai kapasitas dana. Status: UI, F04. Menggunakan Conservative sehingga pilihan lain ikut berubah. Guard kebutuhan margin tetap berfungsi.

**T19. Continue dari Limits**

Fungsi: Memvalidasi dan menyimpan draft untuk Review. Status: UI simulator. Draft valid tersimpan dan Review dapat dibuka.

**T20. Review dan persetujuan real funds**

Fungsi: Menampilkan rangkuman sebelum menjalankan agent. Status: UI simulator dan kode. Rangkuman tampil. Gate persetujuan dana nyata dibaca dari kode, tidak dieksekusi.

**T21. Sign on Monad**

Fungsi: Mempublikasikan policy serta mengotorisasi agent bila diperlukan. Status: Kode, F08 dan A05. Dapat memerlukan dua transaksi. Penolakan signature, salah chain, dan reconnect perlu diuji pada staging.

**T22. Save policy**

Fungsi: Menyimpan perubahan batas dari halaman Policy. Status: UI simulator. Pesan sukses terlihat dan nilai policy tetap ada setelah reload. Masalah input kalkulator dibedakan dari keberhasilan penyimpanan.

**T23. Tautan transaksi policy**

Fungsi: Membuka bukti publikasi di explorer. Status: Kode. Hanya bermakna ketika hash transaksi tersedia. Tidak ada publikasi onchain baru dalam audit.

**T24. Start Monday, Start quoting, Start again**

Fungsi: Menjalankan atau melanjutkan agent. Status: UI simulator. Quote dan state Quoting muncul. Uji Start bersamaan dengan Kill merupakan temuan A01, bukan tertutup oleh keberhasilan normal ini.

**T25. Pemilih market**

Fungsi: Mengganti market chart, order book, serta model yang dilihat. Status: UI. BTC ke ETH berhasil. Melihat market yang off tidak otomatis menambahnya ke policy.

**T26. Trade market**

Fungsi: Menambahkan market ke policy. Status: UI simulator. Trade ETH membuat agent aktif mengeluarkan quote ETH. Pada mode registry, jalur signature belum diuji.

**T27. Stop market**

Fungsi: Menghentikan quote market tertentu dan mengerjakan keluar posisinya. Status: UI simulator. Stop ETH menghapus market aktif sementara agent global tetap berjalan. Bedakan akibatnya dari Stop global.

**T28. Timeframe chart**

Fungsi: Mengubah interval candle. Status: UI sebagian. 5m dipilih dan preferensi bertahan pada tab terminal baru. Pilihan timeframe lain dibaca dari kode, tidak seluruhnya diklik.

**T29. EMA 20, EMA 50, EMA 200**

Fungsi: Menampilkan rata rata bergerak harga. Status: UI. Ketiga pilihan indikator aktif dan legend tampil. Akurasi matematis seluruh seri tidak dihitung ulang dalam audit ini.

**T30. Bollinger Bands**

Fungsi: Menampilkan pita variasi harga. Status: UI. Pilihan aktif dan plot tampil bersama indikator lain.

**T31. Volume dan VWAP**

Fungsi: Menampilkan volume serta harga rata rata berbobot volume. Status: UI sebagian. Pilihan aktif; VWAP pada simulator tampil sebagai nilai tidak tersedia karena volume candle nol. Nilai VWAP live belum divalidasi.

**T32. RSI dan MACD**

Fungsi: Menampilkan oscillator serta momentum. Status: UI. Pilihan aktif dan panel tambahan tampil. Semua indikator sekaligus meningkatkan kepadatan terminal.

**T33. Order book dan Trades**

Fungsi: Menunjukkan antrean pasar serta transaksi pasar terbaru. Status: UI sebagian dan kode. Data order book terlihat. Trades menggambarkan pasar; berbeda dari Fills milik agent. Semua interaksi panel belum diuji terpisah.

**T34. Open orders**

Fungsi: Memperlihatkan order agent yang masih aktif. Status: UI. Dua sisi quote terlihat; Buy burst mengurangi sisi ask sehingga tersisa satu sisi.

**T35. Positions**

Fungsi: Memperlihatkan inventory, entry, mark, dan open PnL. Status: UI. Tab merender state flat dan posisi dari fills. Ini tampilan baca; tidak menyediakan close per baris.

**T36. Fills**

Fungsi: Memperlihatkan eksekusi milik agent dan markout. Status: UI. State kosong tampil dengan penjelasan; fills muncul setelah simulasi berjalan.

**T37. Decisions**

Fungsi: Memperlihatkan keputusan, alasan, efek quote, dan status bukti. Status: UI. Keputusan Rules serta Reflex muncul dan record detail bisa dibuka.

**T38. Equity**

Fungsi: Memperlihatkan perubahan equity akun. Status: UI. Chart tampil ketika tab dipilih. Rekonsiliasi deposit, funding, dan PnL nyata belum diuji di sini.

**T39. Quote model**

Fungsi: Menjelaskan pembentuk harga, spread, skew, dan ukuran quote. Status: UI. Rincian market terpilih tampil. Ini penjelasan state, bukan input untuk mengubah setiap komponen secara manual.

**T40. Guide dan Got it**

Fungsi: Menjelaskan cara membaca terminal. Status: UI. Dialog terbuka dan dapat ditutup. Kemunculan otomatis pada penyimpanan browser yang benar benar baru belum diuji ulang.

**T41. Buy burst**

Fungsi: Memicu aliran beli besar pada simulator. Status: UI simulator. Ask ditarik selama periode Reflex dan keputusan tercatat. Ini alat demonstrasi, bukan tombol order beli pengguna.

**T42. Sell burst**

Fungsi: Memicu aliran jual besar pada simulator. Status: UI simulator. Bid ETH ditarik dan keputusan tercatat. Hanya tersedia pada simulator.

**T43. Stop global**

Fungsi: Membatalkan order agent dan menghentikan pemantauan. Status: UI simulator, F01. Pada satu sesi agent menjadi Stopped; posisi dapat tetap terbuka dan peringatannya tampil. Pergantian akun antar tab menargetkan akun yang salah.

**T44. Kill and flatten**

Fungsi: Membatalkan order dan menutup posisi. Status: Sebelumnya dan kode. Alur manual normal serta kegagalan tertentu diuji pada audit sebelumnya. Pemeriksaan ini menguji flatten yang dipicu stop loss; tidak mengklaim semua kegagalan Kill selesai.

**T45. Session stop loss**

Fungsi: Memicu Kill ketika rugi sesi mencapai batas. Status: UI simulator. Batas 0.01 memicu penghentian; setelah cleanup, order dan posisi terlihat nol. Screenshot disimpan.

**T46. Take profit**

Fungsi: Menghentikan agent dan meminta penutupan posisi ketika target sesi tercapai. Status: Fixture Runner. Target 5, hasil setelah fee 5.95 menghasilkan paused, cancel satu kali, flatten satu kali. Fixture tidak memiliki posisi terbuka sehingga tidak membuktikan fill penutupan di venue.

**T47. Status koneksi dan alasan penghentian**

Fungsi: Menjelaskan freshness, pause, kill, atau cleanup yang belum selesai. Status: UI sebagian dan kode. State normal dan stop loss terlihat. Kode reconnect berubah selama audit; perilaku offline versi terbaru belum diuji ulang.

**T48. Window 24H, 7D, 30D, All**

Fungsi: Memilih periode ringkasan protokol. Status: UI. Keempat pilihan menunjukkan selected tanpa error terlihat. Ketepatan total tetap bergantung pada coverage data.

**T49. Metric Volume, Fees, Traders, Net flows, Liquidations**

Fungsi: Mengganti metrik grafik histori. Status: UI. Lima pilihan berganti dan terpilih.

**T50. Range 30D, 90D, All**

Fungsi: Mengubah rentang histori grafik. Status: UI. Ketiga pilihan terpilih. Ini tidak mengesahkan tanggal kosong sebagai nol.

**T51. Leaderboard Sort Volume dan PnL**

Fungsi: Mengubah dasar urutan akun. Status: UI. Kedua pilihan dapat diaktifkan.

**T52. Leaderboard Days Today, 7D, 30D**

Fungsi: Mengubah periode leaderboard. Status: UI. Ketiga pilihan terpilih. Batas waktu yang konsisten perlu pengujian data terpisah.

**T53. Pencarian wallet atau nomor akun**

Fungsi: Membuka detail akun publik. Status: UI. Nomor akun 424 berhasil dibuka. Di Compare, fungsi ini tetap navigasi sehingga petunjuknya membingungkan, F06.

**T54. Detail wallet**

Fungsi: Menampilkan posisi dan statistik akun publik. Status: UI. Data termuat. Kelengkapan seluruh histori, profit factor, dan beban payload dibahas pada audit sebelumnya; kode metrik berubah selama pemeriksaan.

**T55. Copy address**

Fungsi: Menyalin alamat wallet. Status: Kode. Handler clipboard tersedia. Hasil clipboard dan penanganan kegagalannya belum diuji.

**T56. Watch dan Watching**

Fungsi: Menyimpan pilihan wallet pada browser. Status: UI, F02. Toggle bekerja untuk string identik; status berbeda ketika kapitalisasi alamat berubah. Preferensi uji dikembalikan.

**T57. Compare dari wallet**

Fungsi: Membuka perbandingan dengan wallet pilihan. Status: UI. Kolom awal terbentuk. Alias alamat dan nomor akun belum disatukan.

**T58. Add wallet, Remove, dan chip Watching**

Fungsi: Mengelola hingga empat kolom perbandingan. Status: UI sebagian, F02. Tambah, hapus, state kosong, dan tambah melalui chip bekerja. Batas empat dibaca dari kode; wallet sama masih bisa menduplikasi kolom.

**T59. My Monday ketika belum login**

Fungsi: Memberi jalan masuk ke performa pribadi. Status: UI, F07. Prompt sign in muncul, tetapi tujuan semula tidak dipertahankan.

**T60. My Monday dan filter periode**

Fungsi: Menampilkan fills, volume, PnL, market, serta regime milik pengguna. Status: UI sebagian, F05. Data akun simulator tampil dan 7D dapat dipilih. Identitas serta asal data tidak cukup jelas.

**T61. Evidence BTC, ETH, SOL**

Fungsi: Mengganti market event study dan replay historis. Status: UI. Ketiga tab terpilih dan konten sesuai market tampil. Audit ini tidak mengulang komputasi dataset historis.

**T62. Record keputusan**

Fungsi: Membuka payload dan hash keputusan. Status: UI. Record 7 berhasil dibuka dari Decisions.

**T63. Recompute hashes in this browser**

Fungsi: Menghitung ulang hash payload untuk dibandingkan dengan catatan. Status: UI. Dua hasil matches terlihat. Ini verifikasi kecocokan payload, bukan bukti bahwa transaksi onchain berhasil.

**T64. Explorer keputusan**

Fungsi: Membuka transaksi log ketika tersedia. Status: Kode. Harness tidak mengaktifkan log chain dan tidak menghasilkan transaksi untuk diuji.

**T65. Sign out**

Fungsi: Menghapus sesi browser dan melepas koneksi wallet lokal. Status: UI simulator, F01. Tab asal kembali ke Connect wallet. Tab lain masih menampilkan data dan kontrol akun lama.

**T66. Disconnect dan Stay connected**

Fungsi: Mengonfirmasi penghapusan koneksi key dari Monday. Status: UI simulator sebagian. Disconnect akun B yang stopped dan flat berhasil kembali ke setup akun. Kegagalan HTTP dan pesan pemulihan dibahas dalam A10; Stay connected dibaca dari dialog.

**T67. Open Perpl dan Perpl API keys dari Policy**

Fungsi: Mengelola posisi atau mencabut izin key pada venue. Status: Kode. Tujuan eksternal tersedia. Tidak ada transaksi atau pencabutan key nyata.

## 4. Urutan pekerjaan untuk agent

1. Selesaikan F01 terlebih dahulu pada server dan client. Jangan hanya menambahkan refresh halaman atau mengganti tulisan nomor akun. Tambahkan pengujian dua sesi, dua tab, stream lama, dan request dengan konteks akun kedaluwarsa.
2. Verifikasi ulang kontrol darurat A01 dan A02 pada kode terbaru. Pastikan Kill tidak dapat dikalahkan Start yang masih menunggu dan tidak terhalang kuota request baca. Audit ini tidak menyatakan perubahan terbaru sudah menutup kedua masalah itu.
3. Selesaikan F02 agar Watch, cache wallet, URL, dan Compare memakai identitas yang sama. Pertahankan network sebagai bagian identitas.
4. Rapikan state policy F03 dan F04. Definisikan draft, saved, pending signature, active, serta error. Nilai yang belum disimpan tidak boleh terlihat aktif.
5. Selesaikan F05 dan F08, termasuk pengujian staging untuk wallet terputus dan transaksi kedua yang ditolak. Buat konteks akun dan jenis dana terlihat di setiap halaman pribadi.
6. Selesaikan F06 dan F07 untuk mengurangi navigasi buntu. Tambahkan return target yang aman dan petunjuk Compare yang spesifik.
7. Baru lanjutkan penyederhanaan layout, ukuran teks, hierarki panel, serta mobile. Temuan tampilan dan aksesibilitas dari audit sebelumnya tetap perlu diretes terhadap perubahan terbaru.

## 5. Bentuk alur yang disarankan

Sebelum trading pertama: pilih atau konfirmasi akun → pastikan venue dan jenis dana → hubungkan key → pilih market dan batas → tinjau margin serta risiko → atur stop loss dan target sesi opsional → selesaikan tahapan signature bila diperlukan → Start.

Pada terminal: identitas dan status akun tetap terlihat → market yang hanya dilihat dibedakan dari market yang diperdagangkan → perubahan policy memperlihatkan efeknya sebelum diterapkan → perintah berhenti menjelaskan apakah posisi akan ditutup → kondisi closing bertahan sampai venue mengonfirmasi hasil.

Pada penyuntingan: tampilkan ringkasan policy aktif bersebelahan dengan draft. Save menghasilkan status yang terverifikasi dari server. Navigasi meninggalkan perubahan yang belum disimpan harus memberi pilihan untuk menyimpan atau membuangnya. Ini rekomendasi UX, bukan klaim bahwa setiap navigasi kehilangan data sudah direproduksi.

Pada sesi dan kredensial: perubahan akun disiarkan ke seluruh tab; data lama dibersihkan; kontrol dinonaktifkan sampai identitas terkonfirmasi. Sediakan Replace key yang mudah ditemukan beserta akibatnya terhadap agent. Jelaskan perbedaan Sign out, Stop, Kill, Disconnect Monday, dan revoke key di Perpl.

## 6. Pengujian penerimaan yang wajib dilakukan setelah perbaikan

1. Login A pada dua tab → logout satu tab → login B → tindakan dari tab lama ditolak atau meminta pemuatan konteks baru. Tidak ada efek pada A atau B akibat klik yang konteksnya salah.
2. Logout mencabut akses stream privat. Buka kembali tab lama, kembalikan fokus, dan lakukan reconnect jaringan; tidak ada data sesi lama yang muncul.
3. Wallet melalui nomor akun, alamat huruf kecil, dan checksum memiliki Watch serta kolom Compare yang sama. Ulangi pada dua network.
4. Edit Limits tanpa Save tidak mengubah ringkasan aktif. Reload setelah Save memberikan state yang koheren, termasuk input kalkulator atau penjelasan bahwa kalkulator hanya estimasi.
5. Fit mempertahankan pilihan pengguna yang tidak perlu berubah atau memperlihatkan semua perubahan secara eksplisit.
6. My Monday selalu memperlihatkan identitas, jenis venue, periode, dan sumber data yang sesuai. Login dari halaman itu kembali ke tujuan semula.
7. Pada staging, koneksi wallet terputus dapat dipulihkan dari halaman yang meminta signature. Penolakan transaksi pertama dan kedua memiliki status serta langkah lanjut yang benar.
8. Stop dengan posisi terbuka tetap memperingatkan bahwa posisi tidak sedang dipantau. Kill dan target sesi menunggu bukti cleanup yang sebenarnya sebelum menyatakan selesai.
9. Ulangi alur inti pada lebar 390 px dengan keyboard saja: onboarding, pengaturan risiko, Stop, Kill, wallet search, dan Compare. Ukur visibilitas serta nama kontrol, bukan hanya apakah halaman dapat dimuat.
10. Uji 401, 403, 429, 503, koneksi terputus, dan data kosong pada batas API yang relevan. Jangan menampilkan error layanan sebagai wallet tidak ditemukan atau skeleton tanpa akhir.

## 7. Bukti, hasil positif, dan batas keyakinan

Ada 67 kelompok fungsi dalam inventaris. Bukti terstruktur tersedia pada [inventaris fungsi](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/feature-inventory.json>). Hasil pengoperasian [17 pilihan analytics](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/analytics-controls.json>), [tab terminal](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/terminal-tabs.json>), serta [tiga market Evidence](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/evidence-controls.json>) disimpan terpisah.

Buy burst menghasilkan penarikan ask dan keputusan Reflex, sedangkan Sell burst menghasilkan penarikan bid. [Bukti keputusan](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/buy-burst-decisions.jpg>) dan [hasil hash](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/decision-hashes.jpg>) tersedia. [Stop loss sesi](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/session-stop-loss.jpg>) mencapai keadaan tanpa order dan tanpa posisi di simulator.

Probe Take profit memakai Runner asli dengan venue tiruan dan fill yang dikendalikan. [Hasil JSON](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/take-profit-result.json>) menunjukkan status paused, satu cancel, dan satu flatten. [Kode probe](</Users/yoga/Projects/mondaynad/reports/assets/flow-audit-2026-10-10/take-profit-probe.ts>) dapat ditempatkan pada direktori `apps/server` dari snapshot audit dan dijalankan dengan tsx, venue simulator, serta database memori. Fixture ini tidak menguji likuiditas, slippage, atau keberhasilan penutupan posisi nyata.

Pengujian tidak mencakup deposit, withdraw, signature nyata, WalletConnect pada ponsel, seluruh wallet provider, seluruh kombinasi policy, pemicu LLM eksternal, maupun verifikasi independen semua angka analytics. Tidak ada klaim bahwa semua bug sudah ditemukan. Log browser publik dan simulator yang dibaca pada akhir pemeriksaan tidak memuat error atau warning; hal itu tidak membatalkan temuan fungsional di atas.

Empat tab yang dibuat untuk pemeriksaan ini sudah ditutup. Kedua proses server simulator milik audit sudah dihentikan. Proses aplikasi pengguna pada port 3000 dan 3001 tidak dihentikan.
