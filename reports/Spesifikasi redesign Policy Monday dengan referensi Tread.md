# Spesifikasi redesign Policy Monday dengan referensi Tread

Tanggal: 10 Oktober 2026  
Produk: Monday, aplikasi market making pada Perpl dengan integrasi Monad  
Halaman utama: [Policy Monday](http://localhost:3000/app/policy)  
Referensi produk: [Tread Volume Bot](https://app.tread.fi/volume_bot)  
Repositori: [moudybk1/monday](https://github.com/moudybk1/monday)  
Basis pemeriksaan: working tree lokal pada commit d157a662e75972ae261c7a6204ab6fa7f676ed53, termasuk perubahan lokal yang belum dikomit.

## 1. Keputusan produk

Redesign halaman Policy menjadi tempat mengatur bot melalui satu form utama, dengan ringkasan dampak yang selalu dekat dengan input. Pola penyusunan informasi Tread sesuai untuk dijadikan referensi karena pengguna dapat memahami urutan pengaturan sebelum menjalankan bot.

Keputusan yang direkomendasikan untuk Monday:

1. Gunakan judul tampilan **Bot settings**. Pertahankan route /app/policy dan istilah policy dalam API serta domain internal.
2. Susun alur menjadi Account → Markets → Template → Capital and risk → Advanced settings → Review changes → Save or publish.
3. Jadikan margin untuk perhitungan, batas leverage, dan pemicu rugi harian sebagai pengaturan utama.
4. Jadikan preset sebagai titik awal pengisian form. Hilangkan tabel perbandingan lima preset dari tampilan utama.
5. Tampilkan ukuran quote, batas posisi per market, kebutuhan saldo menurut policy, dan status aktivasi dalam panel ringkasan.
6. Gunakan satu model draft untuk form, ringkasan, validasi, dan payload yang disimpan.
7. Pertahankan perbedaan antara menyimpan policy, menerbitkan policy di Monad, mengizinkan pencatatan keputusan, dan menjalankan bot.
8. Pakai editor dan aturan yang sama pada langkah Limits di onboarding.
9. Pertahankan karakter visual Monday: permukaan gelap, warna amber, angka yang mudah dibandingkan, serta kontrol yang padat tetapi terbaca.

Target keberhasilan: pengguna baru dapat menjelaskan market yang dipilih, besar batas posisi, pemicu penghentian, status perubahan, dan langkah berikutnya tanpa harus memahami nama field backend.

Dokumen ini adalah spesifikasi implementasi. Rancangan dan kriteria penerimaan di bawah belum merupakan fitur yang sudah dikerjakan.

## 2. Dasar pemeriksaan dan batas bukti

### 2.1 Bukti yang digunakan

1. Pembacaan ulang komponen Policy, form, onboarding, penghubung wallet, endpoint policy, fungsi perhitungan pada core, serta perilaku runner pada working tree terbaru.
2. Dokumentasi resmi Tread dan gambar antarmuka yang tersedia dalam dokumentasi tersebut.
3. Pemeriksaan browser sebelumnya dalam percakapan ini. Tautan Tread mengarah ke terminal pada sesi tanpa login, sedangkan halaman Monday meminta koneksi wallet.
4. Laporan audit sebelumnya hanya digunakan sebagai konteks. Temuan lama tidak otomatis dianggap masih berlaku setelah ada perubahan kode.

Perbandingan ini tidak mengklaim bahwa semua kontrol Tread telah diuji melalui akun yang login. Form Monday yang memerlukan autentikasi juga tidak diuji ulang menggunakan dana nyata untuk menulis dokumen ini.

### 2.2 Cara membaca status temuan

**Terverifikasi pada kode** berarti implementasi dapat ditunjuk langsung pada source yang dibaca. Ini tidak selalu berarti kegagalan sudah direproduksi dalam browser.

**Penilaian UX** berarti kesimpulan tentang beban pemahaman berdasarkan struktur dan copy yang tersedia. Kesimpulan ini perlu diuji dengan pengguna setelah prototipe selesai.

**Usulan implementasi** berarti perilaku baru yang harus dibangun dan diverifikasi oleh agent.

**Perlu pengujian runtime** berarti perilaku bergantung pada wallet, jaringan, akun, harga, atau state server dan belum dibuktikan dalam pemeriksaan ini.

### 2.3 Perbaikan yang sudah terlihat dan wajib dipertahankan

1. Form telah membedakan input sizer yang baru berupa preview dengan input yang menghasilkan draft saat ini.
2. Halaman telah membedakan perubahan belum disimpan, policy menunggu tanda tangan, dan policy aktif.
3. Aksi mengecilkan ukuran agar sesuai saldo telah mempertahankan spread serta leverage dan menampilkan perubahan angka.
4. Kegagalan otorisasi agent setelah policy terbit telah memiliki jalur pemulihan tersendiri.
5. Disconnect sudah menangani kegagalan API, termasuk pembatalan order yang belum selesai.
6. Server memeriksa hash policy di chain dan memastikan pending policy yang dipromosikan masih sama dengan yang diperiksa.

Redesign harus menyempurnakan struktur dan konsistensi fitur tersebut. Jangan menghapusnya karena sedang membangun tampilan baru.

## 3. Apa yang diambil dari Tread

Dokumentasi Tread menempatkan pemilihan akun dan pair sebelum pengaturan modal serta leverage, kemudian mengarahkan pengguna memeriksa ringkasan sebelum memulai. Pola ini menghubungkan pilihan pengguna dengan konsekuensinya. Monday dapat menggunakan urutan serupa, dengan panel ringkasan di sebelah form pada desktop. Sumber: [Market Maker Bot](https://docs.tread.fi/bots/market-maker-bot).

Pengaturan reference price dan kontrol risiko lanjutan memiliki makna strategi tersendiri di Tread. Keberadaan menu tersebut bukan alasan untuk menambahkan kontrol dengan nama sama ke Monday jika mesinnya tidak mendukung perilaku itu. Sumber: [Reference Price Modes and Risk Controls](https://docs.tread.fi/bots/market-maker-bot/reference-price-modes-and-risk-controls).

Rekomendasi untuk Monday berdasarkan perbandingan tersebut:

1. Ambil urutan pengambilan keputusan, pengelompokan input, dan kedekatan ringkasan dengan tombol utama.
2. Sediakan satu cara utama untuk mengubah draft, dengan pengaturan rinci yang dapat dibuka ketika dibutuhkan.
3. Tampilkan hasil turunan segera setelah input valid.
4. Berikan nama berdasarkan tujuan pengguna, disertai penjelasan teknis singkat bila diperlukan.
5. Pertahankan batasan domain Monday pada semua label, angka, dan aksi.

Fitur yang tidak masuk pekerjaan ini: target volume, durasi trading, participation rate, directional bias manual, pemilihan reference price, serta beberapa bot independen dalam satu akun. Jangan membuat kontrol yang terlihat aktif jika belum ada kontrak API dan perilaku runner untuk mengeksekusinya.

Session stop loss dan take profit **sudah ada** pada kontrol agent Monday. Keduanya bukan fitur baru yang perlu ditiru dari Tread dan tidak boleh dicampur ke dalam daily policy tanpa keputusan domain yang terpisah.

## 4. Masalah halaman saat ini

### 4.1 Dua cara mengedit pengaturan bersaing dalam satu halaman

Status: terverifikasi pada kode dan penilaian UX. Prioritas P0 untuk redesign.

Pengguna pertama melihat matriks Conservative, Balanced, Active, High leverage, dan Custom. Setelah itu ada bagian “Or size from margin and leverage”. Mengubah sizer menulis kembali limit dan mengubah preset menjadi Custom.

Akibatnya pengguna harus memahami hubungan antara dua kelompok input sebelum tahu mana yang sebaiknya dipakai. Pada mobile, lima pilihan preset juga memperpanjang halaman sebelum pengguna mencapai pengaturan modal.

Perbaikan: satu form utama. Template mengisi form yang sama. Sizer menjadi cara utama menghitung ukuran, sementara angka teknis tampil sebagai hasil atau editor manual yang jelas modenya.

### 4.2 Istilah internal muncul sebelum pengguna memahami tujuannya

Status: terverifikasi pada kode dan penilaian UX. Prioritas P0.

Max inventory, min half spread, governor, dan policy meminta pengguna memahami arsitektur strategi terlalu dini. Judul Policy sendiri belum menjawab pekerjaan yang akan dilakukan pengguna.

Perbaikan: gunakan Bot settings, Position limit per market, Base spread, dan Base quote per side. Penjelasan istilah internal tersedia sebagai bantuan, bukan paragraf pembuka yang padat.

### 4.3 Panel kanan belum membantu keputusan pengaturan

Status: terverifikasi pada kode dan penilaian UX. Prioritas P0.

Panel kanan saat ini berisi Withdraw, Revoke the key, dan Disconnect. Kontrol ini penting, tetapi pada saat mengatur bot pengguna lebih membutuhkan ringkasan akibat dari inputnya.

Perbaikan: gunakan panel kanan untuk Draft summary. Letakkan Account access setelah editor, dengan tautan dan aksi yang tetap mudah ditemukan. Penghentian darurat pada dashboard harus tetap tersedia selama perubahan layout berlangsung.

### 4.4 Copy margin dapat memberi kesan ada dana yang dialokasikan secara terpisah

Status: terverifikasi pada kode dan penilaian UX. Prioritas P0.

Label “Margin to commit” dan kalimat “Uses up to” dapat dibaca sebagai reservasi dana. Saat ini sizer menghasilkan parameter policy. Ia tidak membuat saldo terpisah, memindahkan dana, atau membatasi kerugian akun hanya pada angka margin tersebut.

Perbaikan: gunakan “Margin for sizing” dan “Policy balance requirement”. Jelaskan bahwa angka pertama digunakan untuk menghitung limit dan tidak mengunci dana. Jangan mengganti label saldo menjadi Available margin jika API hanya mengembalikan balanceUsd.

### 4.5 Ringkasan quote belum sepenuhnya selaras dengan perilaku runner

Status: terverifikasi pada kode. Prioritas P0.

policySummary menyebut bot akan quote sejumlah nilai quoteSizeUsd di setiap sisi. Bantuan pada form menjelaskan bahwa nilai itu adalah ukuran dasar dan governor dapat menaikkannya sampai 1,5 kali dalam kondisi tertentu. Runner juga menerapkan cap operator dan gerbang eksekusi.

Perbaikan: sebut “Base quote per side”. Bila menampilkan batas nominal order, hitung dari aturan yang sama dengan runner. Tulis sebagai batas konfigurasi, bukan jumlah order yang pasti akan ditempatkan.

### 4.6 Waktu penerapan perubahan perlu dijelaskan konsisten

Status: terverifikasi pada kode. Prioritas P0.

Paragraf pembuka menyebut pengetatan mengurangi inventory “straight away”, sementara setPolicy memperbarui policy dan memicu evaluasi berikutnya. Pelepasan posisi juga bergantung pada tick, koneksi venue, order, dan kondisi pasar.

Perbaikan: jelaskan bahwa limit baru dipakai setelah aktif dan diproses oleh runner. Jika eksposur sudah melampaui limit baru, Monday akan berupaya menguranginya. Jangan menjanjikan posisi langsung tertutup ketika tombol Save selesai.

### 4.7 Input sizer tersimpan secara global pada browser

Status: terverifikasi pada kode. Prioritas P1.

Storage monday.sizer menyimpan margin dan leverage tanpa identitas wallet, akun Perpl, network, atau hash policy. Nilai lama dapat muncul sebagai konteks yang tidak sesuai dengan policy yang sedang dibuka. Kode saat ini sudah menyebut preview yang tidak diterapkan, sehingga ini bukan bukti policy akun lain otomatis tersimpan.

Perbaikan: ambil policy server sebagai sumber otoritatif. Metadata editor lokal harus diberi identitas akun dan hash policy, atau diabaikan jika konteks tidak cocok.

### 4.8 Pemeriksaan perubahan berbeda dari representasi hash

Status: terverifikasi pada kode. Prioritas P1.

sameLimits membandingkan market dan nilai limit tetapi mengabaikan preset. policyForHash memasukkan preset. Artinya tampilan dapat menganggap tidak ada perubahan limit, padahal payload dengan nama preset berbeda menghasilkan identitas policy berbeda.

Perbaikan: bedakan perubahan perilaku trading dan perubahan payload yang perlu disimpan. Jangan mengubah format hash pada redesign ini. Status penyimpanan harus mengikuti payload kanonis, sementara ringkasan perubahan dapat menjelaskan bahwa hanya template yang berubah.

### 4.9 Balasan save dapat mengandung angka berbeda dari draft awal

Status: terverifikasi pada kode, dampak UI perlu pengujian runtime. Prioritas P0.

Server menghitung kembali preset menggunakan saldo terbaru dan cap operator. State draft halaman hanya diinisialisasi ketika belum ada draft. Perubahan saldo antara preview dan save dapat menghasilkan policy server yang berbeda dari angka yang sedang ditampilkan pengguna.

Perbaikan: review harus mengikat angka yang benar benar dikirim. Setelah save, gunakan policy kanonis dari server untuk rekonsiliasi. Bila ada perubahan material sebelum tanda tangan, tampilkan kembali angka baru dan minta pengguna melakukan review terhadap angka tersebut.

## 5. Struktur halaman yang harus dibangun

### 5.1 Header

Judul: **Bot settings**.

Deskripsi: “Choose markets, size your quotes, and set when Monday should stop.”

Di dekat judul tampilkan identitas akun, network, dan status bot. Gunakan status bot dari sumber runtime, bukan dari keberadaan policy. Policy aktif tidak berarti bot sedang quoting.

Gunakan penanda jelas untuk lingkungan dengan dana nyata. Jangan menebak network dari hostname, warna tema, atau alamat wallet.

### 5.2 Form utama

Urutan kelompok:

1. Account context, hanya informasi jika aplikasi memang hanya mendukung satu akun yang terhubung.
2. Markets, dengan pilihan market yang benar benar tersedia pada config.
3. Starting template, satu select atau kelompok radio ringkas.
4. Capital and risk, berisi margin untuk sizing, leverage, dan pemicu rugi harian.
5. Advanced settings, berisi base quote, position limit, dan base spread.
6. Review changes, memperlihatkan perubahan terhadap policy aktif.

Tidak perlu mengubah editor menjadi wizard panjang. Pengguna berpengalaman harus tetap bisa melihat pengaturan dan akibatnya dalam satu halaman.

### 5.3 Panel ringkasan

Judul: **Draft summary** saat ada perubahan. Pada state tanpa perubahan dapat menggunakan **Current settings**.

Urutan isi:

1. Market terpilih.
2. Policy balance requirement.
3. Base quote per side.
4. Position limit per market.
5. Total configured position limit, hasil batas per market dikalikan jumlah market, dengan penjelasan bahwa ini batas konfigurasi dan bukan posisi saat ini.
6. Daily loss trigger.
7. Leverage limit.
8. Status penyimpanan, penerbitan, dan runtime sebagai informasi terpisah.
9. Tombol utama sesuai state.

Jika cap operator mengubah hasil sizing, tampilkan penyebabnya dekat angka yang berubah. Jangan menyembunyikannya hanya di tooltip.

### 5.4 Account access

Letakkan setelah area konfigurasi. Isi tetap meliputi membuka Perpl untuk pengelolaan dana, membuka API keys untuk pencabutan, dan disconnect dari Monday.

Disconnect tetap menjelaskan bahwa posisi terbuka tidak ditutup otomatis. Bila pembatalan order belum selesai, tampilkan status tertunda dan jangan berpura pura akun sudah terputus.

### 5.5 Wireframe desktop

~~~text
Bot settings                              Mainnet · Account 123 · Stopped
Choose markets, size your quotes, and set when Monday should stop.

┌───────────────────────────────────────┐  ┌─────────────────────────────┐
│ Account                               │  │ Draft summary               │
│ Perpl account 123    Balance $500      │  │ Markets                 BTC │
│                                       │  │ Policy requirement  $200.00 │
│ Markets                               │  │ Base quote           $54.00 │
│ [ BTC ✓ ]  [ ETH ]  [ SOL ]            │  │ Position per market $540.00 │
│                                       │  │ Daily loss trigger   $20.00 │
│ Starting template [ Custom       ▾ ]  │  │ Leverage limit           3x │
│                                       │  │                             │
│ Capital and risk                      │  │ Unsaved changes             │
│ Margin for sizing      [ $200       ] │  │ [ Review changes          ] │
│ Leverage limit         [ 3x         ] │  │                             │
│ Daily loss trigger     [ $20        ] │  │ Saving does not start a     │
│                                       │  │ stopped bot.                │
│ Advanced settings                  ▾  │  └─────────────────────────────┘
└───────────────────────────────────────┘

Account access
Open Perpl     Manage API keys     Disconnect Monday
~~~

Angka wireframe ini adalah fixture ilustrasi tanpa cap operator. Jangan memasangnya sebagai hasil live mainnet. Pada konfigurasi dengan cap, ringkasan wajib menunjukkan angka efektif yang sudah dibatasi.

### 5.6 Wireframe mobile

~~~text
Bot settings
Mainnet · Account 123
Bot status: Stopped

Account and balance
Markets
Starting template
Margin for sizing
Leverage limit
Daily loss trigger
Advanced settings

Draft summary
Policy requirement
Base quote and position limits
Publication status

Account access

┌──────────────────────────────────┐
│ Unsaved changes                  │
│ [ Review changes               ] │
└──────────────────────────────────┘
~~~

Bar aksi di bawah boleh melekat pada viewport. Sisakan ruang bawah agar tidak menutupi input, error, atau ringkasan. Pada keyboard mobile terbuka, utamakan input tetap terlihat dan tidak ada dua area scroll yang saling mengunci.

## 6. Spesifikasi input dan perilakunya

### 6.1 Account context

Tampilkan accountId, wallet yang dipersingkat, network, serta saldo yang bersumber dari API. Gunakan state loading, gagal, dan tidak tersedia secara eksplisit. Saldo yang belum diketahui tidak boleh ditampilkan sebagai nol.

Jika tidak tersedia pemilihan beberapa akun, jangan menggambar dropdown akun yang seolah dapat dipakai. Cukup tampilkan identitas dan tautan pengelolaan yang nyata.

### 6.2 Markets

Tampilkan hanya pilihan yang didukung config. Minimal satu market wajib dipilih. Pilihan harus dapat dioperasikan dengan keyboard dan memiliki state selected yang tidak bergantung pada warna saja.

Dalam mode sizing, perubahan jumlah market membagi kapasitas inventory sesuai rumus. Dalam mode manual, angka per market tetap dan kebutuhan saldo dihitung ulang. Perbedaan ini harus terlihat pada bantuan form.

Jika market yang dihapus masih memiliki posisi, review menampilkan posisi tersebut serta menjelaskan bahwa penghapusan tidak langsung menutupnya. Runner tetap dapat mengelola pengurangan eksposur market yang keluar dari policy. Posisi tersebut tidak boleh hilang dari dashboard.

### 6.3 Starting template

Gunakan opsi domain yang sudah ada: Conservative, Balanced, Active, High leverage, dan Custom. Jangan memetakan Active menjadi mode strategi baru atau menganggap High leverage sebagai ukuran quote yang lebih besar.

Template mengisi draft melalui aturan fit yang sama dengan server. Tampilkan label “Adjusted to your balance and server limits” jika hasilnya berbeda dari nilai template asli.

Sesudah pengguna mengubah nilai yang memengaruhi payload, gunakan Custom. Boleh menampilkan konteks tambahan “Based on Balanced” sebagai metadata editor. Jangan menambahkan konteks itu ke policy hash tanpa perubahan kontrak yang direncanakan.

Pemilihan template yang mengganti beberapa nilai harus menampilkan ringkasan perubahan dan menyediakan Undo sebelum disimpan. Tidak perlu dialog konfirmasi untuk setiap pergantian template.

### 6.4 Margin for sizing

Ini input perhitungan lokal. Ia tidak ada sebagai field tersendiri dalam PolicyLimits yang disimpan sekarang.

Copy bantuan: “Used to calculate your limits. This does not reserve or move funds.”

Gunakan USD sebagai unit. Simpan teks selama pengguna mengetik, lalu parse dan validasi secara eksplisit. Input kosong bukan nol dan bukan perintah menghapus batas risiko.

Jangan otomatis mengisi seluruh saldo sebagai margin pada pembukaan halaman yang sudah mempunyai policy. Jangan mengubah policy ketika saldo baru selesai dimuat.

### 6.5 Leverage limit

Input numerik wajib tersedia walaupun ada slider. Batas atas berasal dari nilai terendah maxLeverage seluruh market terpilih dan batas schema server.

Jika pemilihan market menurunkan batas leverage yang diperbolehkan, tandai konflik dan tawarkan nilai yang valid. Jangan menyimpan perubahan leverage diam diam.

Copy bantuan: “Limits exposure relative to account equity. Actual exposure depends on positions and execution rules.”

Jangan membuat ilustrasi harga likuidasi dari rumus sederhana margin dibagi leverage. Angka likuidasi memerlukan data posisi dan aturan venue yang sesuai.

### 6.6 Daily loss trigger

Gunakan USD sebagai input utama. Jangan mengganti nilainya menjadi persentase tanpa mempertahankan nilai USD yang akan disimpan.

Untuk draft sizing baru, sarankan 10 persen dari margin sebagai nilai awal. Setelah pengguna mengeditnya, jangan menimpanya ketika margin berubah. Batas ini adalah pemicu tindakan runner, bukan jaminan jumlah kerugian akhir.

Copy bantuan: “When the daily risk threshold is reached, Monday stops quoting and attempts to cancel orders and close positions. Execution can exceed this amount.”

Batas harian menggunakan pergantian hari UTC pada kode runner. Untuk pengguna WIB, 00.00 UTC setara 07.00 WIB. Tampilkan zona waktu pada penjelasan. Jangan menyebut reset otomatis berarti bot pasti mulai kembali.

### 6.7 Advanced settings

Base quote per side memetakan quoteSizeUsd. Position limit per market memetakan maxInventoryUsd. Base spread memetakan minHalfSpreadBps.

Base spread tetap menggunakan bps dan arti setengah spread dari model saat ini. Bantuan harus menyebut 1 bp sama dengan 0,01 persen, serta bahwa mesin dapat menempatkan quote lebih dekat dalam kondisi tertentu. Jangan menyebutnya jarak minimum mutlak yang selalu dijaga.

Membuka Advanced settings tidak mengubah draft. Mengubah quote atau inventory secara langsung mengaktifkan mode manual yang dijelaskan pada bagian berikut.

Session stop loss dan take profit tetap berada pada alur memulai sesi. Keduanya tidak dimasukkan ke payload PUT /api/policy.

### 6.8 Batas validasi dari schema saat pemeriksaan

1. quoteSizeUsd: minimal 1 dan maksimal 5.000 USD, serta tidak melebihi maxInventoryUsd.
2. maxInventoryUsd: minimal 1 dan maksimal 50.000 USD.
3. minHalfSpreadBps: minimal 1 dan maksimal 100 bps.
4. maxDailyLossUsd: minimal 1 dan maksimal 10.000 USD.
5. maxLeverage: minimal 1 dan maksimal 50, dibatasi lagi oleh spesifikasi setiap market.
6. markets: satu sampai tiga pilihan dari daftar domain yang tersedia, kemudian divalidasi terhadap market yang didukung venue.

Cap operator dapat membuat batas efektif jauh lebih rendah dari schema. Angka schema ini adalah snapshot source, bukan nilai yang harus disalin ke beberapa komponen. Gunakan definisi bersama atau response config yang sesuai agar UI dan server tidak berbeda ketika batas berubah.

Preset Conservative saat ini memakai Q 25, I 250, spread 6, D 25, dan L 2. Balanced memakai 50, 500, 4, 50, dan 3. Active memakai 100, 1.000, 3, 100, dan 3. High leverage memakai 50, 500, 4, 50, dan 10. Angka ini membantu agent memahami template lama; pilihan pengguna tetap harus menampilkan hasil penyesuaian saldo dan cap yang sebenarnya.

## 7. Kontrak domain yang harus dipertahankan

### 7.1 Policy aktif, pending policy, dan draft adalah tiga objek berbeda

Policy aktif adalah konfigurasi yang digunakan server. Pending policy adalah konfigurasi tersimpan yang belum selesai diterbitkan atau dikonfirmasi. Draft adalah perubahan lokal yang sedang diedit.

Saat ada pending policy, editor boleh membukanya sebagai sumber awal. Ringkasan harus tetap dapat menunjukkan policy aktif untuk perbandingan. Jangan memberi label “Active” pada pending policy hanya karena PUT berhasil.

Jika belum ada policy aktif, copy harus menyebut “No active policy yet”. Jangan menyatakan limit lama tetap berjalan ketika limit lama memang belum ada.

### 7.2 Penerbitan dan otorisasi mempunyai hasil yang terpisah

useRegistry.publish saat ini dapat menerbitkan policy, mengonfirmasi ke server, lalu meminta otorisasi agent. Langkah terakhir dapat gagal setelah policy sudah aktif.

State UI harus mampu menampilkan “Policy active” bersamaan dengan “Decision logging authorisation required”. Jangan mengembalikan seluruh proses ke state Save failed atau meminta pengguna menerbitkan policy yang sama sekali lagi.

Otorisasi ini berkaitan dengan pencatatan keputusan oleh agent pada MondayRegistry. Jangan menyebutnya sebagai izin transfer dana atau izin withdrawal.

### 7.3 Penyimpanan dapat memengaruhi bot yang sedang berjalan

Menyimpan policy tidak menyalakan bot yang sedang berhenti. Namun perubahan policy yang aktif dapat memengaruhi bot yang sudah quoting.

Copy untuk bot berhenti: “Saving these settings does not start the bot.”

Copy untuk bot berjalan: “These changes will affect the running bot after the policy becomes active.”

Pada review, penurunan inventory atau penghapusan market harus disertai konteks posisi yang masih ada. Penurunan daily loss trigger di bawah pemakaian risiko saat ini juga perlu diberi tahu jika metrik yang tepat tersedia.

### 7.4 Stop, kill, dan disconnect tidak boleh disamakan

1. Stop menghentikan quoting dan membatalkan order Monday. Posisi terbuka tetap ada dan pengawasan risiko aktif oleh bot berhenti.
2. Kill and flatten berupaya membatalkan order serta menutup posisi. Implementasi cleanup flatten saat ini juga dapat mencakup order dan posisi lain dalam akun yang sama. Copy jangan mengesankan tindakan ini hanya mengenai satu market yang sedang terlihat.
3. Disconnect menghentikan agent, membatalkan order Monday, dan menghapus key tersimpan jika kondisi cleanup memungkinkan. Posisi terbuka tetap menjadi tanggung jawab pengguna.
4. Hasil cancel atau flatten yang belum dikonfirmasi venue harus tetap terlihat sebagai Cancelling atau Closing. Jangan menggantinya dengan status selesai hanya karena request awal diterima.

Perilaku ini perlu diuji melalui simulator atau lingkungan pengujian. Redesign bukan alasan menjalankan transaksi nyata untuk membuktikannya.

### 7.5 Daily risk berbeda dari profit yang ditampilkan

Runner memiliki perhitungan trading PnL dan perhitungan risiko yang tidak identik. Deposit dikeluarkan dari perhitungan risiko, sementara penurunan saldo tertentu diperlakukan secara konservatif. Withdrawal ketika bot aktif dapat memengaruhi pemicu risiko.

Karena itu, jangan menghitung “remaining daily loss allowance” hanya dengan mengurangkan angka Today pada dashboard dari nilai limit. Gunakan metrik risiko server yang memang dipakai runner. Jika belum tersedia dalam API yang sesuai, tampilkan nilai trigger tanpa menciptakan metrik sisa yang berpotensi salah.

### 7.6 Nilai konfigurasi bukan jaminan hasil pasar

Position limit adalah batas konfigurasi strategi. Eksposur aktual dapat sementara melewatinya karena perubahan harga, kondisi eksekusi, atau posisi yang sudah ada. Risk gate juga mempunyai toleransi teknis dan jalur pengurangan posisi.

Jangan menulis “You can never lose more than”, “Funds are protected”, atau janji bahwa posisi selalu persis di bawah angka ringkasan. Berikan penjelasan singkat dekat kontrol yang relevan, bukan disclaimer panjang yang menutupi form.

## 8. Model perhitungan dan satu sumber draft

### 8.1 Rumus yang ada sekarang

Definisi:

1. M adalah margin untuk perhitungan.
2. L adalah batas leverage.
3. N adalah jumlah market terpilih, minimal satu.
4. D adalah maxDailyLossUsd.
5. I adalah maxInventoryUsd per market.
6. Q adalah quoteSizeUsd per sisi.

Perilaku limitsFromMargin saat ini:

~~~text
D = max(1, floor(M × 0.10))
I = max(0, floor(((M − D) × L) ÷ N))
Q = floor(I ÷ 10)

marginFloor = (I × N) ÷ L
balanceNeeded = marginFloor + D
~~~

fitLimits menggunakan faktor pengecilan yang mempertimbangkan saldo, quote cap, inventory cap, dan daily loss cap. Ia mengecilkan Q, I, dan D dengan pembulatan ke bawah serta minimum satu dolar. Spread dan leverage dipertahankan.

Minimum satu dolar berarti saldo yang sangat kecil tetap dapat tidak cukup. Jangan berasumsi hasil fit selalu valid untuk semua saldo, termasuk nol.

### 8.2 Keputusan untuk editor baru

Pertahankan dua mode perhitungan dalam satu editor: **Sized from margin** dan **Manual sizes**. Mode menjelaskan sumber angka, bukan menghadirkan dua form yang berisi nilai berbeda pada saat bersamaan.

Dalam Sized from margin:

1. M, L, D, market, dan spread adalah input.
2. D diisi 10 persen M hanya untuk inisialisasi draft baru atau aksi eksplisit memulihkan saran.
3. Setelah D ditetapkan, perubahan M tidak mengubah D secara otomatis.
4. I dihitung dari floor(((M − D) × L) ÷ N).
5. Q dihitung dari floor(I ÷ 10) sebelum penerapan cap.
6. Terapkan quote cap dan inventory cap seperti aturan sizer saat ini, masing masing secara independen. Tampilkan hasil efektif dan alasan pembatasannya.
7. D yang diketik melebihi daily loss cap harus menghasilkan error yang dapat diperbaiki. Jangan menurunkannya diam diam karena pengguna sedang mengatur toleransi risiko secara eksplisit.
8. Validasi M > D, Q minimal satu, I minimal satu, Q ≤ I, leverage yang didukung, serta kebutuhan saldo terhadap data terbaru.

Ini memerlukan helper bersama yang menerima daily loss secara eksplisit. Jangan mengganti diam diam semantik limitsFromMargin lama. Tambahkan fungsi atau parameter yang menjaga kompatibilitas pemanggil lama, kemudian uji kedua jalurnya.

Dalam Manual sizes:

1. Q, I, D, L, market, dan spread adalah input kanonis.
2. Margin for sizing berubah menjadi informasi baca saja bernama Policy balance requirement.
3. Mengubah Q atau I secara langsung memindahkan mode ke Manual sizes dan mempertahankan seluruh nilai lain.
4. Mengubah market menghitung ulang kebutuhan saldo, tanpa membagi I secara otomatis.
5. Aksi “Recalculate from margin” menampilkan hasil penggantian ukuran sebelum diterapkan pada draft.
6. Menutup Advanced settings tidak mengubah mode atau membuang nilai manual.

Jika scope implementasi awal belum mencakup helper D eksplisit, tampilkan D sebagai hasil baca saja pada mode sizing dan izinkan perubahan melalui mode manual. Jangan menyediakan input D yang terlihat dapat diedit tetapi selalu ditimpa oleh rumus lama.

### 8.3 Memuat policy lama tanpa mengarang input asal

PolicyLimits tidak menyimpan M. Nilai M asli tidak selalu dapat direkonstruksi dari policy setelah pembulatan, cap, atau edit manual.

Aturan pemuatan:

1. Muat nilai policy server persis sebagaimana adanya.
2. Jika ada metadata sizing dengan identitas akun, network, dan hash policy yang cocok, hitung kembali hasilnya dan pastikan identik sebelum dipakai.
3. Jika tidak cocok, buka editor pada Manual sizes dengan kebutuhan saldo hasil perhitungan. Jangan mengklaim angka kebutuhan saldo adalah margin yang pernah diketik pengguna.
4. Pengguna dapat memilih Sized from margin melalui aksi eksplisit yang memperlihatkan perubahan Q dan I.
5. Default browser atau respons saldo yang datang terlambat tidak boleh memicu penulisan ulang draft.

Metadata editor adalah kemudahan penggunaan. Kehilangannya tidak boleh mengubah kemampuan memuat atau menjalankan policy yang tersimpan.

### 8.4 Contoh numerik wajib untuk verifikasi

Contoh A, tanpa cap: M 200, L 3, N 1, D 20 menghasilkan I 540, Q 54, dan kebutuhan saldo 200.

Contoh B, tanpa cap: M 200, L 3, N 2, D 20 menghasilkan I 270 per market, Q 27 per sisi, dan kebutuhan saldo 200.

Contoh C, tanpa cap: M 200, L 3, N 3, D 20 menghasilkan I 180 per market, Q 18 per sisi, dan kebutuhan saldo 200.

Contoh D, D eksplisit pada helper usulan: M 200, L 3, N 1, D 10 menghasilkan I 570, Q 57, dan kebutuhan saldo 200.

Contoh E, dengan cap ilustrasi Q 50, I 250, D 25: input seperti A menghasilkan Q efektif 50, I efektif 250, D tetap 20, serta kebutuhan saldo sekitar 103,33. Margin input tetap 200. UI harus menjelaskan pengaruh cap dan tidak menyebut selisihnya sebagai saldo bebas yang sudah diverifikasi venue.

Contoh F, preset Balanced asli tanpa penyesuaian: Q 50, I 500, D 50, L 3, satu market membutuhkan sekitar 216,67. Angka ini tidak identik dengan hasil sizing sepuluh persen. Memilih preset tidak boleh diam diam mengubahnya menjadi rumus lain.

Contoh G, saldo 0,50: hasil minimum fit satu dolar masih dapat melebihi saldo. Form harus menunjukkan saldo tidak cukup, bukan Ready.

### 8.5 Presisi dan angka kanonis

Gunakan presisi internal yang sama pada preview dan payload. Pembulatan untuk tampilan tidak boleh digunakan sebagai validasi kecukupan saldo. Angka 103,3333 tidak menjadi 103,33 untuk tujuan pemeriksaan saldo.

Periksa representasi onchainArgs: maxInventoryUsd dan maxDailyLossUsd saat ini dibulatkan menjadi integer, sedangkan schema policy menerima angka. Leverage dikonversi menjadi kelipatan seratus.

Untuk input baru, tampilkan aturan presisi yang sesuai dan validasi sebelum review. Policy lama dengan desimal harus tetap terbaca. Jangan diam diam membulatkan policy lama saat mount atau mengubah format hash. Perbedaan representasi JSON dan field kontrak perlu dicatat dan diuji bila agent menyentuh area tersebut.

## 9. Model state dan aturan penyimpanan

### 9.1 State minimum

Pisahkan data berikut:

1. accountContext, identitas sesi, wallet, accountId, dan network yang relevan.
2. activePolicy, payload kanonis dan hash dari server.
3. pendingPolicy, payload kanonis dan hash yang menunggu penerbitan.
4. draft, nilai input yang sedang diedit beserta mode perhitungannya.
5. validation, error per field dan error antar field.
6. reviewSnapshot, payload beku yang benar benar disetujui pada review.
7. operation, tahap request, tanda tangan, konfirmasi, atau pemulihan.
8. runtimeStatus, kondisi bot termasuk proses cleanup yang belum selesai.
9. loggingAuthorisation, status izin agent untuk pencatatan di registry.

Derived values dihitung dari satu draft. Jangan menyimpan salinan quote atau inventory terpisah dalam state ringkasan yang dapat tertinggal dari form.

### 9.2 Perubahan lokal

Setiap perubahan input hanya memperbarui draft. Tidak ada PUT, tanda tangan, atau start otomatis dari onChange.

Gunakan pembandingan payload kanonis untuk status belum disimpan. Urutan market harus dikanonisasi. Jika payload berubah setelah review, batalkan snapshot review sebelumnya dan minta review ulang saat pengguna hendak menyimpan.

Sediakan Reset changes yang jelas kembali ke versi yang sedang diedit, yaitu pending jika ada atau active jika tidak ada pending. Batalkan pending pada server hanya jika ada aksi dan dukungan API yang memang dirancang untuk itu. Reset lokal tidak boleh diam diam menghapus pending policy server.

Saat pengguna meninggalkan halaman dengan perubahan lokal, berikan cara mempertahankan atau membuang draft secara jelas. Untuk perpindahan route internal, gunakan pola aplikasi yang tersedia. Saat transaksi sudah dikirim, navigasi tidak boleh memberi kesan transaksi dapat dibatalkan hanya dengan menutup halaman. Hasilnya harus dapat direkonsiliasi ketika pengguna kembali.

### 9.3 Payload yang dapat direview dengan tepat

Server saat ini menghitung ulang named preset pada PUT. Untuk editor baru, rekomendasi paling sederhana adalah mengirim hasil edit yang telah direview sebagai preset Custom dengan limits eksplisit, sementara asal template menjadi metadata UI.

Ini perlu dilakukan konsisten: selecting template mengisi angka, review menunjukkan angka final, save mengirim angka final. Pengguna tidak perlu memahami bahwa payload internal memakai Custom.

Jika agent mempertahankan named preset pada payload, ia wajib menangani hasil server yang berbeda. Pending yang berubah harus direview kembali sebelum publish. Untuk mode yang langsung aktif tanpa tanda tangan, diperlukan validasi preview dan kontrol konflik sebelum mutasi agar angka yang tidak direview tidak telanjur berlaku.

Jangan memperlakukan PUT /api/policy sebagai endpoint preview. Pada demo atau server tanpa registry, endpoint itu dapat langsung mengaktifkan policy.

### 9.4 Account dan tab lain

Gunakan mekanisme penjagaan akun yang sudah ada pada API client. Saat wallet atau identitas akun berubah, hentikan operasi yang masih berjalan, bersihkan state editor yang terikat akun lama, dan muat konteks baru.

Respons terlambat dari akun lama tidak boleh mengganti draft akun baru. Simpan metadata editor hanya dengan identitas yang cocok dan tanpa key rahasia.

Jika policy server berubah dari tab lain saat draft lokal sudah diedit, jangan menimpa draft. Tampilkan pesan konflik dan pilihan memuat versi baru atau membandingkannya.

Peningkatan yang disarankan: server menerima hash atau revision yang diharapkan saat save dan mengembalikan konflik bila basis berubah. Ini usulan tambahan, bukan kemampuan yang sudah tersedia. Pemeriksaan pending_hash pada confirm yang sudah ada harus tetap dipertahankan.

## 10. Alur pengguna dan tombol utama

### 10.1 Akun baru pada onboarding

1. Pengguna menyelesaikan koneksi akun dan key melalui alur yang sudah ada.
2. Limits menggunakan editor bersama dengan Policy.
3. Pengguna menentukan market, template atau sizing, serta pemicu risiko.
4. Continue memvalidasi dan membawa angka yang sama ke review.
5. Review menjelaskan apakah policy perlu diterbitkan pada Monad atau cukup disimpan pada lingkungan yang sedang digunakan.
6. Setelah publish berhasil, status pencatatan agent ditampilkan terpisah.
7. Start quoting adalah aksi eksplisit terakhir. Kegagalan start tidak menghapus policy yang sudah tersimpan.

### 10.2 Mengubah pengaturan ketika bot berhenti

1. Policy aktif ditampilkan saat halaman dibuka.
2. Edit membuat state Unsaved changes.
3. Review changes memperlihatkan nilai lama dan baru hanya untuk field yang berubah, plus konteks akun dan network.
4. Aksi final bernama Save settings pada jalur tanpa publish atau Publish policy pada jalur registry.
5. Setelah server mengonfirmasi, tampilkan Policy active dan Bot stopped secara terpisah.
6. Tautan Return to dashboard membawa pengguna ke kontrol Start yang sudah ada. Tidak perlu membuat tombol Start kedua pada editor untuk scope awal.

### 10.3 Mengubah pengaturan ketika bot berjalan

Review wajib menyebut bot sedang berjalan dan perubahan akan memengaruhi sesi aktif. Tampilkan perubahan market, leverage, inventory, dan daily loss dengan jelas.

Jangan otomatis menghentikan atau memulai ulang bot demi perubahan tampilan. Ikuti kontrak setPolicy dan eksekusi yang sudah ada. Jika kondisi tertentu memang membutuhkan penghentian, implementasikan serta jelaskan aturan itu secara eksplisit sebagai perubahan perilaku tersendiri.

### 10.4 Melanjutkan pending policy

Jika tidak ada edit baru, tombol Publish policy melanjutkan payload pending yang sama. Jangan melakukan PUT baru hanya untuk mencoba tanda tangan lagi.

Jika terdapat draft yang berbeda dari pending, tampilkan bahwa pengguna akan mengganti pending policy. Review angka baru sebelum request penyimpanan. Setelah publikasi, gunakan hasil confirm dan pembacaan ulang server untuk menetapkan status aktif.

### 10.5 State tombol yang diwajibkan

1. Data belum tersedia: tampilkan loading dan nonaktifkan aksi penyimpanan dengan alasan yang terbaca.
2. Tidak ada perubahan: Settings saved, atau tombol utama nonaktif dengan keterangan yang sesuai.
3. Draft valid: Review changes.
4. Draft tidak valid: Review changes nonaktif, error dekat field, dan penjelasan ringkas penyebabnya.
5. Review siap tanpa registry: Save settings.
6. Review siap dengan registry: Publish policy.
7. Wallet belum terhubung: Reconnect wallet untuk akun yang benar.
8. Menunggu wallet: Confirm in wallet.
9. Transaksi terkirim: Waiting for confirmation dengan tautan transaksi bila tersedia.
10. Policy aktif tetapi logging belum diizinkan: Authorise decision logging sebagai aksi terpisah.
11. Confirm server gagal setelah transaksi terkirim: Check confirmation atau Retry confirmation, tanpa langsung mengirim transaksi baru.

## 11. Error dan pemulihan

### 11.1 Error input

Pesan harus menjelaskan field dan perbaikannya. Contoh: “Daily loss trigger must be below the margin used for sizing.” dan “SOL allows at most 10x leverage on this network.” Nilai batas harus diambil dari config, bukan ditulis tetap dalam komponen.

Error server dengan field limits.quoteSizeUsd harus muncul pada field Base quote per side. Error insufficient_balance juga perlu ringkasan yang menunjukkan kebutuhan saldo dan saldo terakhir yang diketahui.

### 11.2 Data tidak tersedia

Tampilkan “Could not load account balance” dengan Retry. Pengguna dapat tetap membaca atau mengedit draft, tetapi penyimpanan menunggu pemeriksaan data yang diperlukan. Jangan menyajikan sukses hanya karena draftFits menerima balance null pada implementasi lama.

### 11.3 Tanda tangan ditolak

Draft dan pending harus tetap tersedia. Jika ada policy aktif, jelaskan policy itu masih digunakan. Jika belum ada, jelaskan belum ada policy aktif.

Tindakan pemulihan: reconnect jika koneksi wallet hilang, atau publish lagi terhadap pending yang sama ketika pengguna siap.

### 11.4 Hasil transaksi belum pasti

Pisahkan transaksi gagal, transaksi masih pending, receipt sukses tetapi confirm server gagal, dan policy hash berubah. Simpan txHash yang sudah diketahui selama konteks akun masih sama.

Gunakan pembacaan ulang chain dan server untuk memulihkan state. Jangan mengirim ulang setPolicy otomatis setelah timeout karena transaksi sebelumnya mungkin sudah berhasil.

### 11.5 Saldo atau cap berubah

Jika saldo berkurang sebelum save, pertahankan draft dan tawarkan Adjust sizes to balance. Tampilkan perubahan Q, I, dan D sebelum diterapkan. Pengguna masih perlu menyimpan hasilnya.

Jika cap operator berubah, tampilkan nilai yang melanggar dan batas terbaru. Angka preview yang bergantung pada config lama harus dihitung ulang sebelum review selesai.

### 11.6 Pengurangan posisi belum selesai

Setelah policy lebih ketat aktif, jangan menampilkan “Positions closed” dari hasil save. Tampilkan status runtime yang benar. Jika venue belum berhasil mengurangi atau menutup posisi, berikan akses ke dashboard dan Perpl.

### 11.7 Minimum ukuran order

Validitas nominal policy tidak menjamin quote dapat ditempatkan pada semua market. Ukuran dasar aset dapat menjadi lebih kecil dari sizeStep setelah konversi harga dan pembulatan.

Jika data harga serta spesifikasi tersedia, tampilkan pemeriksaan indikatif per market. Bila data tidak tersedia, jangan memberi jaminan order akan dikirim. Pengujian harus memastikan pengguna mendapat alasan dari runtime ketika bot berjalan tetapi tidak bisa menempatkan quote.

## 12. Spesifikasi visual

### 12.1 Layout dan kepadatan

Gunakan dua kolom ketika ruang konten cukup untuk form sekitar 520 sampai 680 piksel dan ringkasan sekitar 300 sampai 360 piksel. Jarak antarkolom sekitar 24 sampai 32 piksel. Jika ruang tidak cukup, pindahkan ringkasan ke bawah form.

Gunakan lebar konten aktual setelah sidebar aplikasi, bukan hanya lebar viewport, untuk memutuskan kapan dua kolom layak dipakai. Jangan memaksakan desktop layout pada tablet yang sempit.

Panel ringkasan boleh sticky pada desktop selama tidak melebihi tinggi viewport. Halaman form harus dapat discroll secara wajar. Jangan menyalin aturan terminal yang mengunci seluruh halaman pada tinggi layar jika menyebabkan bagian form tidak terjangkau.

### 12.2 Tipografi

1. Judul halaman sekitar 24 sampai 30 piksel.
2. Judul kelompok sekitar 14 sampai 16 piksel dengan bobot yang jelas.
3. Label dan input sekitar 14 piksel pada desktop; input mobile setidaknya 16 piksel agar nyaman dibaca.
4. Bantuan sekitar 12 sampai 13 piksel, dengan kontras memadai.
5. Angka ringkasan menggunakan angka tabular dan unit yang konsisten.

Hindari paragraf teknis panjang di bagian atas. Pengguna harus dapat menemukan market dan pengaturan pertama tanpa melewati blok penjelasan besar.

### 12.3 Warna dan komponen

Gunakan token canvas, raised, line, fg, dan accent yang sudah ada. Amber menandai aksi utama dan pilihan. Warna risiko hanya digunakan pada error atau status yang relevan.

Pertahankan dukungan tema terang yang sudah ada. Kontras, error, dan ringkasan harus diuji dalam kedua tema. Tidak perlu mengganti library UI atau menambahkan sistem desain lain untuk halaman ini.

Gunakan pemisah dan jarak untuk mengelompokkan field. Hindari setiap input dibungkus kartu tersendiri yang membuat halaman terlalu tinggi.

### 12.4 Label, bantuan, dan istilah

Label utama singkat. Bantuan menjelaskan akibat tindakan. Tooltip hanya menjadi tambahan, bukan tempat satu satunya untuk informasi penting seperti dana tidak direservasi, batas harian UTC, atau posisi tidak ditutup oleh disconnect.

Gunakan tanda USD atau simbol dolar secara konsisten. Bedakan dollar per side, dollar per market, dan dollar per account. Jangan memakai satu label “Size” untuk ketiganya.

Teks bahasa Inggris dipertahankan pada produk agar konsisten dengan UI yang ada. Dokumen ini berbahasa Indonesia untuk agent. Jangan mencampur kedua bahasa secara acak dalam halaman hasil implementasi.

### 12.5 Aksesibilitas

1. Setiap input memiliki label yang terhubung secara programatis.
2. Error terhubung melalui aria-describedby dan state invalid.
3. Semua pilihan, accordion, dialog review, dan aksi dapat dipakai dengan keyboard.
4. Slider memiliki input angka alternatif.
5. State selected dan error tetap jelas tanpa mengandalkan warna.
6. Fokus dialog berada pada lokasi yang masuk akal, kembali ke pemicu setelah dialog ditutup, dan tidak tersesat di belakang dialog.
7. Pembaruan status operasi menggunakan pengumuman yang sesuai. Jangan membacakan seluruh ringkasan setiap kali pengguna mengetik satu digit.
8. Target sentuh utama sekitar 44 piksel. Jangan membuat market chip atau ikon bantuan terlalu kecil untuk mobile.
9. Pada zoom 200 persen, semua field, unit, error, dan tombol tetap tersedia.
10. Hormati preferensi pengurangan animasi. Animasi tidak boleh diperlukan untuk memahami perubahan angka.

## 13. Performa dan batas scope

Halaman Policy tidak membutuhkan chart, riwayat transaksi besar, indexer analytics, atau tabel order lengkap untuk menjelaskan draft. Hindari menarik dependensi analytics ke dalam editor.

Perhitungan Q, I, dan kebutuhan saldo harus dilakukan secara lokal melalui fungsi murni. Perubahan input tidak boleh memicu request API per ketikan.

Gunakan data akun, config, dan policy yang sudah tersedia melalui pola query aplikasi. Ukur request saat halaman dibuka dan setelah save untuk memastikan tidak ada loop refetch atau request ganda yang tidak diperlukan.

Status runtime boleh diambil dari sumber bersama yang ada. Jangan membuka koneksi live kedua hanya demi badge bot jika data yang sama sudah disediakan pada shell.

Tugas ini tetap dikerjakan di monorepo yang sama. Pemisahan analytics adalah pekerjaan arsitektur tersendiri. Redesign Policy tidak memerlukan repo, subdomain, atau deployment baru.

Target verifikasi performa:

1. Mengetik margin atau leverage langsung memperbarui preview yang valid tanpa menunggu network.
2. Membuka Advanced settings tidak memuat modul chart atau dataset analytics.
3. Submit hanya menjalankan mutasi yang sesuai tahapnya, dengan pencegahan klik ganda.
4. Tidak ada loncatan layout besar ketika saldo atau status publish selesai dimuat.
5. Catat ukuran bundle route dan hasil pemeriksaan interaksi sebelum serta setelah perubahan jika tooling tersedia. Jangan mengklaim peningkatan performa hanya dari berkurangnya jumlah komponen.

## 14. Peta file dan tanggung jawab perubahan

Path berikut menunjuk workspace yang diperiksa. Agent pada mesin lain dapat memakai path relatif repositori yang terlihat pada label.

### 14.1 Halaman dan komponen

1. [apps/web/app/app/policy/page.tsx](/Users/yoga/Projects/mondaynad/apps/web/app/app/policy/page.tsx): komposisi halaman, hubungan active dan pending, state operasi, review, hasil save, serta relokasi account access.
2. [apps/web/components/policy-form.tsx](/Users/yoga/Projects/mondaynad/apps/web/components/policy-form.tsx): pengganti matriks preset dan sizer terpisah, editor satu draft, field validation, template, dan peralihan mode.
3. [apps/web/app/app/onboarding/page.tsx](/Users/yoga/Projects/mondaynad/apps/web/app/app/onboarding/page.tsx): gunakan editor serta ringkasan yang sama pada Limits dan Review, dengan aksi Continue serta Start sesuai tahap.
4. [apps/web/components/ui.tsx](/Users/yoga/Projects/mondaynad/apps/web/components/ui.tsx): gunakan primitives yang ada. Tambahkan hanya kebutuhan aksesibilitas atau state yang belum tersedia.
5. [apps/web/app/globals.css](/Users/yoga/Projects/mondaynad/apps/web/app/globals.css): gunakan token yang ada; batasi perubahan global agar dashboard dan analytics tidak ikut berubah tanpa sengaja.
6. [apps/web/components/agent.tsx](/Users/yoga/Projects/mondaynad/apps/web/components/agent.tsx): rujukan perilaku session stop loss, take profit, Stop, dan Kill and flatten. Perubahan hanya diperlukan untuk konsistensi istilah atau integrasi yang benar benar relevan.

### 14.2 Data dan integrasi

1. [apps/web/lib/wallet.tsx](/Users/yoga/Projects/mondaynad/apps/web/lib/wallet.tsx): publikasi policy, konfirmasi, pemulihan transaksi, dan otorisasi pencatatan agent. Pertahankan hasil parsial yang sudah sukses.
2. [apps/web/lib/api.ts](/Users/yoga/Projects/mondaynad/apps/web/lib/api.ts): pemetaan error dan penjagaan identitas akun. Pertahankan penolakan mutasi untuk akun yang sudah berubah.
3. [packages/core/src/types.ts](/Users/yoga/Projects/mondaynad/packages/core/src/types.ts): tipe domain, preset, fitLimits, balanceNeededUsd, dan helper sizing bersama bila diperluas.
4. [packages/core/src/format.ts](/Users/yoga/Projects/mondaynad/packages/core/src/format.ts): ringkasan bahasa yang selaras dengan base quote, serta rujukan format hash yang tidak boleh berubah tanpa keputusan migrasi.
5. [apps/server/src/api.ts](/Users/yoga/Projects/mondaynad/apps/server/src/api.ts): validasi final, named preset yang dihitung ulang, pending policy, confirm, dan opsi kontrol konflik bila diimplementasikan.
6. [apps/server/src/config.ts](/Users/yoga/Projects/mondaynad/apps/server/src/config.ts): rujukan cap operator. Jangan menyalin nilai defaultnya menjadi konstanta UI.
7. [apps/server/src/runner.ts](/Users/yoga/Projects/mondaynad/apps/server/src/runner.ts): rujukan kebenaran perilaku penerapan policy, daily risk, session risk, pengurangan inventory, dan cleanup. Redesign tidak otomatis memerlukan perubahan algoritme di sini.
8. [packages/core/src/execution.ts](/Users/yoga/Projects/mondaynad/packages/core/src/execution.ts): rujukan gerbang risiko dan lifecycle inventory ketika menyusun copy serta pengujian konsekuensi policy.

### 14.3 Pengujian dan instruksi repositori

1. [packages/core/src/core.test.ts](/Users/yoga/Projects/mondaynad/packages/core/src/core.test.ts): perluas pengujian rumus hanya untuk perilaku baru serta kondisi batas yang relevan.
2. [apps/server/src/api.test.ts](/Users/yoga/Projects/mondaynad/apps/server/src/api.test.ts): verifikasi payload, validasi, dan konflik yang berubah. File ini sudah ada sebagai perubahan lokal pada saat pemeriksaan.
3. [apps/server/src/runner.test.ts](/Users/yoga/Projects/mondaynad/apps/server/src/runner.test.ts): jalankan pengujian yang relevan untuk menjamin copy sesuai perilaku dan bila kontrak penerapan policy disentuh.
4. [apps/web/AGENTS.md](/Users/yoga/Projects/mondaynad/apps/web/AGENTS.md): ikuti instruksi membaca dokumentasi Next yang terpasang sebelum menulis kode aplikasi.

Working tree berisi banyak perubahan yang sudah ada. Agent harus membaca git status dan diff terkait sebelum mengedit, lalu menjaga perubahan pengguna. Jangan memulai dengan reset atau mengganti seluruh file tanpa memahami pembaruan terbaru.

## 15. Struktur komponen yang disarankan

Pembagian berikut adalah usulan tanggung jawab, bukan kewajiban membuat satu file untuk setiap nama.

1. PolicyEditor mengelola input yang terkontrol dan mode sizing atau manual.
2. PolicySummary menampilkan hasil dari draft yang sama, tanpa kalkulasi alternatif.
3. PolicyReview menampilkan snapshot perubahan dan konteks efek terhadap bot.
4. PolicyPublicationStatus menampilkan active, pending, transaksi, dan authorisation secara terpisah.
5. PolicyAccountAccess menempatkan pengelolaan akun dan disconnect.
6. Helper domain bersama menghasilkan preview, error, dan payload kanonis dari input yang valid.

Komponen editor tidak melakukan start atau menandatangani transaksi. Halaman dan onboarding menjadi pengatur alur. Pemisahan ini membuat editor dapat dipakai ulang tanpa menyalin perilaku request.

Jangan menambahkan state management global hanya karena form memiliki beberapa state. Gunakan pola React yang sudah sesuai dengan proyek. State global hanya dibutuhkan bila benar benar ada konsumen lintas halaman yang memerlukan data tersebut.

## 16. Urutan implementasi

### Tahap 1: Bekukan kontrak dan fixture

Prioritas P0.

1. Baca source terbaru dan diff pengguna.
2. Catat payload policy aktif, pending, cap, market specs, dan state runtime yang diperlukan.
3. Putuskan jalur penyimpanan angka eksplisit sebagai Custom atau named preset dengan review server yang aman. Rekomendasi dokumen ini adalah angka eksplisit.
4. Tetapkan perilaku mode sizing dan manual, termasuk D eksplisit.
5. Siapkan fixture untuk akun baru, akun lama, pending, bot berjalan, saldo kecil, dan cap aktif.

Hasil tahap: kontrak editor dan contoh angka dapat diverifikasi sebelum layout baru dihubungkan ke mutasi.

### Tahap 2: Bangun halaman utama

Prioritas P0.

1. Ganti tabel preset dengan pemilih template ringkas.
2. Satukan capital dan risk dalam satu form.
3. Bangun ringkasan dari draft yang sama.
4. Pindahkan account access ke bagian terpisah.
5. Perbaiki label, bantuan, dan error.
6. Selesaikan desktop serta mobile bersama, bukan menunda seluruh mobile sampai akhir.

Hasil tahap: pengguna bisa memahami serta mengedit fixture tanpa ada dua sumber nilai.

### Tahap 3: Hubungkan review dan persistensi

Prioritas P0.

1. Bekukan payload review.
2. Hubungkan save, publish, confirm, dan authorisation sesuai state.
3. Tangani balasan server yang berbeda, signature rejection, dan hasil transaksi belum pasti.
4. Pastikan save tidak memulai bot yang berhenti.
5. Pastikan perubahan pada bot berjalan dijelaskan sebelum diterapkan.
6. Integrasikan editor dan ringkasan pada onboarding.

Hasil tahap: satu alur lengkap dari edit sampai policy aktif, dengan recovery yang tidak membuang hasil sukses.

### Tahap 4: Ketahanan state dan kualitas

Prioritas P1.

1. Beri konteks akun pada metadata lokal atau hapus metadata lama yang tidak dapat dipercaya.
2. Tangani perubahan dari tab lain dan tambahkan kontrol konflik server bila diperlukan.
3. Verifikasi input desimal, pembulatan kontrak, minimum order, serta cap dinamis.
4. Verifikasi aksesibilitas, kedua tema, viewport kecil, zoom, dan request jaringan.

Hasil tahap: editor aman digunakan kembali pada akun lama dan kondisi jaringan yang tidak ideal.

### Tahap 5: Penyempurnaan setelah alur utama benar

Prioritas P2.

Perbandingan preset rinci dapat disediakan sebagai panel opsional jika pengujian pengguna menunjukkan kebutuhannya. Riwayat perubahan policy atau metadata sizing yang disimpan server juga dapat dikerjakan kemudian.

Jangan menunda perbaikan P0 untuk menambahkan animasi, chart, target profit ilustratif, atau fitur strategi baru.

## 17. Skenario penerimaan

Skenario berikut adalah pengujian yang harus dilakukan agent implementasi. Daftar ini tidak menyatakan bahwa pengujian sudah lulus saat dokumen ditulis.

### 17.1 Perhitungan dan input

1. C01: Input contoh A sampai C menghasilkan Q, I, dan kebutuhan saldo yang sesuai untuk satu, dua, dan tiga market.
2. C02: D eksplisit pada contoh D tidak kembali menjadi 10 persen ketika pengguna mengganti M.
3. C03: Cap pada contoh E terlihat sebagai penyebab angka efektif berubah. Kebutuhan saldo tidak tetap ditampilkan 200.
4. C04: Memilih Balanced mempertahankan arti preset dan menghasilkan contoh F sebelum penyesuaian yang memang diperlukan.
5. C05: Saldo 0,50 atau nol tidak lolos hanya karena fitLimits sudah mengembalikan angka minimum.
6. C06: Input kosong, angka negatif, NaN, Infinity, teks tidak valid, dan angka di luar schema menampilkan error serta tidak terkirim sebagai nol atau null tanpa maksud pengguna.
7. C07: Q tidak boleh melebihi I. D dalam mode sizing harus lebih kecil dari M. Limit yang melebihi cap ditangani sesuai aturan masing masing field.
8. C08: Penambahan market dengan cap leverage lebih kecil memunculkan konflik yang terlihat sebelum save.
9. C09: Kebutuhan saldo dihitung memakai presisi internal. Selisih pembulatan tampilan tidak membuat policy yang kekurangan saldo dinyatakan cukup.
10. C10: Mengedit quote secara manual mempertahankan spread, leverage, dan D, serta memindahkan mode dengan jelas.

### 17.2 Draft, template, dan akun

1. C11: Membuka policy lama mempertahankan semua angka server. Mount, hydration, atau data saldo yang terlambat tidak mengubah policy.
2. C12: Metadata monday.sizer dari wallet atau network lain tidak dipakai sebagai input asal policy saat ini.
3. C13: Membuka dan menutup Advanced settings tidak mengubah payload atau dirty state.
4. C14: Pergantian template memperlihatkan angka baru; Undo mengembalikan seluruh draft sebelumnya.
5. C15: Menghapus pilihan market terakhir dicegah dengan penjelasan yang jelas.
6. C16: Perubahan market dalam mode sizing membagi kapasitas, sedangkan mode manual mempertahankan batas per market dan menghitung ulang kebutuhan saldo.
7. C17: Reset changes kembali ke sumber editor yang benar tanpa menghapus pending policy pada server. Navigasi dengan draft belum disimpan memberi pilihan yang jelas, dan kembali setelah transaksi terkirim memulihkan status sebenarnya.
8. C18: Perbedaan preset yang memengaruhi hash tidak salah dilabeli sebagai payload yang sudah tersimpan.
9. C19: Perubahan wallet atau akun selama request tidak menerapkan respons lama ke akun baru.
10. C20: Perubahan policy dari tab lain ketika draft lokal kotor menampilkan konflik, tanpa menimpa draft diam diam.

### 17.3 Save, publish, dan runtime

1. C21: Ringkasan, review, dan payload mutasi berisi market serta angka yang sama.
2. C22: Klik ganda pada aksi final tidak membuat dua operasi publish atau dua alur save bersaing.
3. C23: Demo dan server tanpa registry menyimpan sesuai jalurnya tanpa memunculkan permintaan tanda tangan palsu.
4. C24: Policy dengan registry tetap pending sampai konfirmasi yang sesuai. UI tidak memberi label aktif setelah PUT saja.
5. C25: Penolakan tanda tangan menjaga pending dan membedakan apakah policy aktif sebelumnya ada atau belum ada.
6. C26: Retry publish tanpa edit menggunakan pending yang sama tanpa PUT baru yang tidak diperlukan.
7. C27: Receipt sukses tetapi confirm server gagal dapat dipulihkan tanpa mengirim setPolicy lagi secara otomatis.
8. C28: pending_changed atau hash yang tidak cocok menghasilkan pemulihan yang jelas dan tidak mempromosikan policy lain.
9. C29: Policy sukses tetapi authorisation gagal tetap tampil aktif, dengan aksi terpisah untuk pencatatan keputusan.
10. C30: Menyimpan saat bot berhenti tidak memanggil start. State bot tetap berhenti.
11. C31: Menyimpan saat bot berjalan memperlihatkan efeknya pada review dan tidak mengklaim posisi langsung tertutup.
12. C32: Menghapus market dengan posisi terbuka tidak menyembunyikan posisi pada dashboard atau menjanjikan flatten langsung.
13. C33: Pemicu rugi harian, stop loss sesi, dan take profit tetap mempunyai payload serta perilaku yang berbeda.
14. C34: Disconnect yang gagal membatalkan order tidak menampilkan akun seolah sudah terputus.
15. C35: State Closing atau Cancelling tetap terlihat sampai hasil venue yang sesuai, dan start tidak melewati cleanup flatten yang masih tertunda.

### 17.4 Browser dan pemahaman pengguna

1. C36: Desktop sekitar 1440 piksel memperlihatkan form dan ringkasan tanpa kolom yang saling menekan.
2. C37: Laptop sekitar 1280 piksel dan tablet sekitar 768 piksel memiliki layout yang dapat dipakai setelah memperhitungkan sidebar.
3. C38: Mobile 360 dan 390 piksel tidak memiliki overflow horizontal dan bar aksi tidak menutupi input atau error.
4. C39: Keyboard mobile dan zoom 200 persen tidak membuat aksi akhir atau field terakhir tidak terjangkau.
5. C40: Seluruh alur dapat dilakukan dengan keyboard; label, error, accordion, slider, dan fokus dialog bekerja dengan pembaca layar yang sesuai.
6. C41: Tema gelap dan terang tetap memperlihatkan teks bantuan, status selected, serta error dengan jelas.
7. C42: Loading, saldo gagal dimuat, session expired, dan wallet disconnected mempunyai langkah berikutnya yang dapat ditemukan.
8. C43: Mengetik input tidak mengirim request per karakter, dan route editor tidak memuat chart analytics yang tidak digunakan.
9. C44: Quote di bawah ukuran minimum market menghasilkan penjelasan yang dapat ditindaklanjuti, bukan status yang memberi kesan bot pasti sedang menempatkan order.
10. C45: Pengguna baru dapat menyebutkan market, batas posisi, pemicu rugi, status penyimpanan, dan apakah bot berjalan tanpa bantuan penjelasan agent.

## 18. Cara verifikasi implementasi

### 18.1 Otomasi yang relevan

Gunakan unit test untuk rumus, validasi, dan transisi yang dapat menyebabkan payload salah. Gunakan integration test untuk save, pending, confirm, konflik, dan respons akun. Jangan menulis snapshot yang hanya menyalin susunan JSX tanpa membuktikan perilaku pengguna.

Perintah yang tersedia pada repositori saat pemeriksaan:

~~~sh
npm test -- packages/core/src/core.test.ts apps/server/src/api.test.ts apps/server/src/runner.test.ts
npm run typecheck
npm run build
~~~

Jalankan pengujian frontend yang relevan jika harness sudah tersedia atau ditambahkan untuk perilaku state baru. Perintah di atas tidak menggantikan pemeriksaan browser.

Jika ada kegagalan yang sudah ada sebelum perubahan, catat hasil baseline dan bedakan dari regresi patch. Jangan menyebut seluruh pengujian lulus bila ada bagian yang tidak dijalankan.

### 18.2 Pemeriksaan browser

Gunakan simulator, fixture, atau akun pengujian yang sesuai. Periksa alur lengkap melalui UI sampai respons API dan state hasilnya. Pengujian wallet yang belum bisa dijalankan dicatat sebagai belum diverifikasi.

Ambil bukti tampilan desktop dan mobile untuk state normal, error, review, pending, serta hasil publish. Tandai fixture dengan jelas agar angka contoh tidak disalahartikan sebagai data live.

### 18.3 Uji pemahaman singkat

Minta beberapa pengguna yang belum memahami Monday mengatur market, memilih modal, dan menjelaskan akibat tombol akhir. Target uji awal adalah mereka dapat menyelesaikan serta menjelaskan alur dalam sekitar dua menit tanpa penjelasan tentang nama field backend.

Ini target desain untuk dievaluasi, bukan angka yang sudah diukur. Catat istilah yang masih disalahpahami dan perbaiki copy berdasarkan hasilnya.

## 19. Batas pekerjaan

Termasuk pekerjaan utama:

1. Redesign Policy dan penggunaan editor bersama pada onboarding.
2. Konsistensi perhitungan, preview, review, dan payload.
3. Copy yang akurat terhadap perilaku engine.
4. Penanganan pending, kegagalan tanda tangan, serta hasil sukses sebagian.
5. Penjagaan konteks akun dan pengalaman desktop serta mobile.

Pekerjaan yang memerlukan keputusan terpisah:

1. Mengubah algoritme market making atau risk gate.
2. Menambah target volume, durasi, jenis strategi, atau beberapa bot independen.
3. Mengubah bentuk hash policy, kontrak registry, atau melakukan migrasi onchain.
4. Mengubah aturan saldo venue atau membuat reservasi dana yang sungguhan.
5. Memindahkan analytics ke aplikasi atau deployment lain.
6. Mendesain ulang seluruh terminal dan landing page.

Agent boleh memperbaiki integrasi yang diperlukan agar editor benar. Namun perubahan domain besar harus dijelaskan sebagai tambahan scope, bukan disisipkan melalui penggantian label.

## 20. Hasil yang wajib diserahkan agent

1. Halaman Bot settings yang dapat dipakai, termasuk desktop dan mobile.
2. Editor serta ringkasan yang dipakai bersama dengan onboarding.
3. Daftar file yang diubah dan alasan perubahan domain jika ada.
4. Bukti kesamaan angka pada input, preview, review, payload, dan hasil server.
5. Hasil pengujian otomatis beserta pengujian browser yang benar benar dijalankan.
6. Screenshot state penting dengan penanda fixture bila memakai data contoh.
7. Daftar keterbatasan yang tersisa, khususnya alur wallet atau venue yang belum bisa diuji.

Implementasi dinyatakan selesai ketika satu alur utuh dapat dijalankan dan dipahami, state gagal dapat dipulihkan, angka yang disimpan sesuai angka yang direview, serta perubahan tidak merusak onboarding dan kontrol risiko yang sudah ada.

## 21. Brief siap diberikan kepada agent

> Redesign halaman /app/policy Monday menjadi Bot settings dengan satu form utama dan panel ringkasan, mengikuti spesifikasi dalam dokumen ini. Gunakan pola pengelompokan informasi Tread sebagai referensi dan pertahankan identitas visual Monday.
>
> Mulai dengan membaca working tree terbaru, instruksi AGENTS, dan file yang dipetakan dalam dokumen. Pertahankan perubahan lokal yang sudah ada. Satukan pemilih market, template, sizing, leverage, daily loss, dan advanced settings dalam satu model draft. Hilangkan matriks lima preset dari tampilan utama serta gabungkan sizer ke alur editor tersebut.
>
> Pastikan margin hanya disebut sebagai input perhitungan, base quote tidak disajikan sebagai ukuran order tetap, dan daily loss dibedakan dari stop loss sesi. Review harus membekukan angka yang akan dikirim. Bedakan policy aktif, pending, draft lokal, izin pencatatan keputusan, serta status bot.
>
> Tangani penolakan tanda tangan, konfirmasi yang belum pasti, perubahan akun, perubahan saldo, dan hasil server yang berbeda. Menyimpan tidak boleh menyalakan bot yang berhenti. Perubahan pada bot berjalan harus dijelaskan sebelum diterapkan. Pakai editor dan ringkasan yang sama pada onboarding.
>
> Jangan menambahkan target volume, durasi, strategi baru, perubahan kontrak, atau transaksi dana nyata sebagai bagian dari redesign ini. Verifikasi melalui pengujian yang relevan serta pemeriksaan browser desktop dan mobile. Serahkan hasil yang berfungsi, bukti pengujian, screenshot, dan keterbatasan yang masih ada.

## 22. Hubungan dengan laporan sebelumnya

Dokumen ini memperinci pekerjaan Policy. Audit yang lebih luas tetap tersedia sebagai konteks:

1. [Deep app audit 2026 10 10](</Users/yoga/Projects/mondaynad/reports/Deep app audit 2026-10-10.md>).
2. [User flow and feature audit 2026 10 10](</Users/yoga/Projects/mondaynad/reports/User flow and feature audit 2026-10-10.md>).
3. [Rencana pemisahan analytics dalam monorepo](</Users/yoga/Projects/mondaynad/reports/Rencana pemisahan analytics dalam monorepo.md>).

Temuan pada laporan lama harus diperiksa ulang terhadap source terbaru. Untuk kontrak serta detail redesign Policy, gunakan dokumen ini sebagai acuan yang lebih spesifik.
