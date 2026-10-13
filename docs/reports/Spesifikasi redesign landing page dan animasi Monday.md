# Spesifikasi redesign landing page dan animasi Monday

Tanggal: 10 Oktober 2026  
Halaman: [Landing page Monday](http://localhost:3000/)  
Repositori: [moudybk1/monday](https://github.com/moudybk1/monday)  
Basis source: commit d157a662e75972ae261c7a6204ab6fa7f676ed53 beserta perubahan lokal pada working tree.

Versi dokumen: 2, spesifikasi implementasi diperinci.  
Pembaruan ini menambahkan kontrak section, ukuran layout, storyboard per waktu, model state, normalisasi data, copy siap pakai, paket pekerjaan, dan pengujian reproduktif. Tidak ada klaim pemeriksaan browser baru pada revisi dokumen ini.

## Panduan membaca

Bagian 1 sampai 16 menjelaskan tujuan, hasil pemeriksaan, dan persyaratan dasar. Bagian 17 sampai 28 menetapkan detail implementasi yang lebih spesifik. Brief pada bagian 29 dapat diteruskan bersama seluruh dokumen kepada agent.

Jika rentang desain pada bagian awal belum menentukan perilaku tertentu, gunakan keputusan rinci pada bagian 17 sampai 28. Angka ukuran adalah titik awal yang harus diuji dalam browser, sedangkan aturan kebenaran data, kontrol pengguna, dan penjagaan domain merupakan persyaratan wajib.

## 1. Tujuan pekerjaan

Redesign landing page Monday agar manfaat produknya cepat dipahami, komposisinya terasa matang, dan animasinya menjadi bagian penting dari penjelasan cara kerja bot.

Audiens utama adalah calon pengguna yang mengenal trading tetapi belum memahami Monday, serta juri hackathon yang ingin melihat apa yang sudah dibangun dan bagaimana integrasi Monad digunakan.

Setelah melihat bagian awal halaman, pengunjung harus dapat menjawab:

1. Monday melakukan market making pada Perpl.
2. Monday menggunakan informasi smart money untuk menyesuaikan perilaku quoting.
3. Pengguna mengatur batas dan tetap mengelola dananya pada akun Perpl.
4. Policy dan bukti keputusan mempunyai integrasi dengan Monad sesuai konfigurasi sistem.
5. Demonstrasi pada halaman adalah ilustrasi atau data live, dengan label yang tidak ambigu.
6. Launch app membawa pengguna ke aplikasi untuk menyiapkan atau mengelola bot.

Hasil yang diminta adalah implementasi landing page yang lengkap, termasuk animasi, responsivitas, aksesibilitas, dan state gagal. Dokumen ini merupakan spesifikasi pekerjaan; perubahan yang diusulkan belum diimplementasikan saat laporan ditulis.

## 2. Dasar pemeriksaan

### 2.1 Pemeriksaan yang sudah dilakukan

Pada pemeriksaan browser sebelumnya dalam percakapan ini, halaman dibuka pada viewport desktop 1440 × 1000 dan mobile 390 × 844. Bagian hero, demonstrasi, navigasi anchor, serta tabel preset diperiksa. Pemilihan tahap Quote pada demonstrasi juga dicoba.

Source landing page, komponen demonstrasi, header, footer, font, animasi CSS, dan koneksi data publik dibaca kembali sebelum laporan ini dibuat.

Pengamatan terukur pada sesi tersebut:

1. Tinggi halaman desktop sekitar 5.360 piksel.
2. Tinggi hero desktop sekitar 867 piksel.
3. Tinggi halaman mobile sekitar 7.297 piksel.
4. Tinggi hero mobile sekitar 1.556 piksel.
5. Bagian penjelasan setelah hero mulai sekitar posisi vertikal 1.613 piksel pada mobile.
6. Tabel preset memiliki lebar 520 piksel di dalam area sekitar 341 piksel pada mobile, sehingga pengguna perlu menggeser tabel secara horizontal.
7. Hero menampilkan status BOOK ONLY pada waktu pemeriksaan. Visual tersebut menunjukkan data pasar, bukan bukti bahwa agent pengguna sedang beroperasi.

Ukuran tersebut adalah snapshot pada lingkungan development lokal. Angka dapat berubah mengikuti data, font, dan viewport. Panjang halaman sendiri bukan ukuran kualitas; masalahnya adalah beban informasi sebelum manfaat produk menjadi jelas.

### 2.2 Hal yang belum diukur

Belum ada benchmark production untuk LCP, INP, CLS, frame rate, konsumsi memori, atau ukuran bundle sebelum dan sesudah redesign. Belum ada uji pemahaman dengan pengguna eksternal. Jangan menyebut target performa dalam dokumen ini sebagai hasil yang sudah dicapai.

Temuan tentang struktur dan copy didukung source. Temuan tentang pengalaman visual didukung pemeriksaan browser. Risiko crash pada response data tidak lengkap perlu pengujian tambahan dan tidak dilaporkan sebagai crash yang sudah direproduksi.

## 3. Diagnosis halaman saat ini

### F01. Hero mengharuskan pengguna membaca terminal terlalu dini

Prioritas P0. Dasar: browser dan source.

HeroTerminal menampilkan order book, candlestick chart, indikator, flow bars, dan transaksi wallet. Semua itu relevan dalam aplikasi, tetapi pengunjung landing page belum mempunyai konteks untuk memilih informasi yang penting.

Status BOOK ONLY juga membuat visual terbesar tidak memperlihatkan perilaku agent yang dijanjikan headline.

Perbaikan: tampilkan satu demonstrasi terkurasi yang menyorot aksi Monday. Sediakan data pasar live sebagai pilihan terpisah setelah pengguna memahami produk.

### F02. Pesan dan tindakan utama terlalu berjauhan pada desktop

Prioritas P0. Dasar: browser dan source.

Headline mendominasi lebar halaman, deskripsi berada di kiri, dan kelompok tombol didorong ke kanan. Hierarki antar elemen tersebut belum terasa sebagai satu alur baca.

Perbaikan: susun headline, deskripsi, dan CTA dalam satu kelompok. Tempatkan visual utama di sampingnya pada desktop, lalu di bawahnya pada mobile.

### F03. Hero mobile terlalu tinggi

Prioritas P0. Dasar: browser dan ukuran DOM.

Order book, chart, dan smart money feed berubah menjadi tiga panel bertumpuk. Pengunjung harus melewati bagian panjang sebelum mendapatkan penjelasan sebab akibat yang membedakan Monday.

Perbaikan: buat visual khusus mobile dengan satu adegan aktif. Jangan mengecilkan seluruh terminal desktop atau menumpuk semua panelnya.

### F04. Ritme layout terlalu seragam

Prioritas P1. Dasar: penilaian visual dan source.

Banyak section mengulang judul, paragraf, ruang kosong besar, lalu panel bergaris. Bagian preset memiliki margin kiri 34 persen pada desktop, sehingga tabel terasa terpisah dari penjelasan dan meninggalkan ruang yang kurang membantu alur baca.

Perbaikan: bedakan fungsi dan komposisi setiap section. Gunakan demonstrasi besar untuk cara kerja, urutan langkah untuk onboarding, contoh pengaturan untuk kontrol, dan ringkasan penelitian untuk Evidence.

### F05. Dua demonstrasi besar mengulang informasi

Prioritas P0. Dasar: browser dan source.

HeroTerminal menampilkan terminal live, sementara Story kembali menampilkan order book, flow, dan keputusan dalam ilustrasi. Pengunjung melihat banyak informasi serupa dengan konteks data yang berbeda.

Perbaikan: satu demonstrasi interaktif utama. Tidak perlu dua order book besar dalam urutan awal halaman.

### F06. Animasi belum mempunyai kontrol pemutaran yang lengkap

Prioritas P0. Dasar: source.

Story mengganti tahap setiap 4.200 milidetik sejak komponen dimuat. Interval tidak menunggu section masuk viewport. Pointer masuk atau fokus menghentikan autoplay, tetapi tidak ada tombol Resume atau Replay yang menjelaskan keadaan tersebut.

Perbaikan: pemutaran mengikuti visibilitas, memiliki kontrol eksplisit, mempertahankan pilihan pengguna, dan tidak berputar tanpa henti secara default.

### F07. Navigasi mobile kehilangan beberapa tujuan

Prioritas P1. Dasar: browser dan source.

How it works dan Custody disembunyikan pada layar kecil tanpa pengganti menu. Analytics dan Evidence tetap terlihat, sementara bagian yang membantu pengguna memahami produk menjadi lebih sulit ditemukan.

Perbaikan: pertahankan logo, Launch app, dan tombol menu pada mobile. Menu menyediakan semua tujuan navigasi yang sudah ada, tanpa mengganti URL atau nama navigasi utama dalam pekerjaan ini.

### F08. State data gagal dapat menampilkan penjelasan yang salah

Prioritas P0. Dasar: source.

HeroTerminal menampilkan instruksi menjalankan npm run dev ketika belum ada state. Instruksi pengembangan tersebut tidak membantu pengunjung produk.

EvidenceTeaser menggunakan state yang sama untuk studi pending dan request gagal. Kegagalan jaringan dapat terlihat sebagai pesan bahwa studi masih mengumpulkan data.

Perbaikan: pisahkan loading, data belum cukup, error, stale, dan sukses. Landing page harus tetap dapat menjelaskan produk ketika layanan data tidak tersedia.

### F09. Sebagian copy membutuhkan penyesuaian terhadap perilaku produk

Prioritas P0. Dasar: source landing dan pemeriksaan domain pada laporan Policy.

Label “Closest it quotes to fair price” menyiratkan jarak minimum mutlak, sementara spread pada model dapat berubah sesuai perilaku engine. Kalimat “Monday stays inside them” juga terlalu absolut jika dibaca sebagai jaminan posisi dan kerugian aktual tidak pernah melampaui batas.

Kalimat tentang memperoleh spread perlu menjelaskan tujuan strategi tanpa menjanjikan keuntungan pada setiap fill. Biaya dan pergerakan harga tetap memengaruhi hasil.

Perbaikan: jelaskan batas sebagai konfigurasi dan pemicu tindakan. Gunakan istilah base quote, position limit, serta daily loss trigger secara konsisten dengan aplikasi.

### F10. Evidence belum membantu pengunjung menafsirkan hasil

Prioritas P1. Dasar: browser dan source.

Angka korelasi, interval, dan tingkat kesamaan arah ditampilkan tanpa ringkasan kesimpulan yang cukup sederhana. Caption periode “seven days, BTC” ditulis tetap. Source juga mengasumsikan kombinasi window dan horizon tertentu selalu tersedia.

Perbaikan: tampilkan interpretasi singkat, periode data yang benar, sumber data, serta keterbatasan. Tangani dataset tidak lengkap tanpa crash. Jangan menyajikan tingkat kesamaan arah sebagai win rate trading.

## 4. Arah desain

Pembacaan desain: landing page untuk produk trading otomatis, dengan bahasa visual presisi dan tenang, memakai identitas Monday serta demonstrasi produk yang menjadi fokus utama.

Kalibrasi untuk agent desain:

1. DESIGN_VARIANCE 6: layout boleh asimetris tetapi harus mempertahankan alur baca yang jelas.
2. MOTION_INTENSITY 6: satu adegan animasi utama yang bermakna, didukung transisi ringan.
3. VISUAL_DENSITY 3: informasi landing page lebih lapang dan terpilih daripada terminal aplikasi.

Gunakan fondasi yang sudah ada: Next, Tailwind, Motion, Mona Sans, JetBrains Mono untuk angka, serta ikon Phosphor. Ini adalah arah visual produk, bukan adopsi sistem desain eksternal baru.

Pertahankan wordmark dan logo. Gunakan warna dasar gelap dan amber yang ada. Bid dan ask boleh mempertahankan warna semantik yang sesuai. Semua section tetap berada dalam satu keluarga tema; dukungan tema terang yang sudah ada tidak boleh rusak.

Kualitas visual harus datang dari proporsi, pemilihan informasi, tipografi, detail antarmuka, dan gerak yang tepat. Background bergerak terus, koin 3D generik, efek partikel di seluruh halaman, dan kartu mengambang acak tidak diperlukan untuk menjelaskan Monday.

## 5. Susunan halaman yang direkomendasikan

### 5.1 Header

Desktop: wordmark di kiri, navigasi yang sudah ada di tengah, theme control dan Launch app di kanan. Tinggi sekitar 56 sampai 72 piksel.

Mobile: wordmark, Launch app, dan tombol menu. Menu berisi How it works, Custody, Analytics, dan Evidence. Jika theme control disediakan di menu, pastikan preferensi yang tersimpan tetap konsisten dengan shell aplikasi.

Pertahankan tujuan /app, /analytics, /evidence, /#how, dan /#custody. Sticky header tidak boleh menutupi target anchor atau fokus keyboard.

### 5.2 Hero dan demonstrasi utama

Headline usulan:

> Market making that reacts.

Deskripsi usulan:

> Monday quotes on Perpl, reacts to smart money, and records decisions on Monad.

Gunakan Launch app sebagai CTA utama ke /app. CTA sekunder “See how it works” menuju #how. Link Evidence tetap tersedia pada navigasi serta section Evidence.

Pada desktop, pesan berada di sekitar 42 persen area konten dan demonstrasi sekitar 58 persen. Ini titik awal komposisi, bukan rasio yang harus dipaksakan pada semua layar.

Tempatkan id how pada area demonstrasi utama. Dengan demikian, CTA sekunder dan navigasi menuju satu penjelasan interaktif yang sama. Hindari membuat Story kedua dengan visual order book yang sama di bawah hero.

Hero harus tetap informatif jika JavaScript atau API terlambat. Headline, deskripsi, CTA, dan representasi tahap awal tersedia terlebih dahulu.

### 5.3 Peran integrasi

Setelah hero, sediakan baris ringkas yang menjelaskan peran teknologi:

1. Perpl sebagai tempat eksekusi trading.
2. Nansen sebagai sumber informasi smart money yang digunakan produk.
3. Monad sebagai jaringan untuk publikasi policy dan pencatatan bukti keputusan sesuai implementasi.

Jangan menulis “Trusted by” atau menyiratkan kemitraan resmi hanya karena memakai teknologi tersebut. Gunakan logo resmi hanya jika aset dan penggunaannya sudah sesuai; teks yang jelas lebih baik daripada logo rekaan.

### 5.4 How to start

Tampilkan tiga langkah dalam satu urutan visual, dengan cuplikan antarmuka aktual jika tersedia:

1. Connect your account: pengguna menyiapkan koneksi akun Perpl dan key dengan izin yang sesuai.
2. Set your limits: pengguna memilih market serta mengatur ukuran dan pemicu risiko.
3. Start Monday: pengguna menyelesaikan langkah publikasi yang diperlukan dan memulai bot secara eksplisit.

Jangan menyebut seluruh proses hanya satu klik. Jangan menampilkan input key yang benar benar menerima rahasia pada landing page. Cuplikan onboarding bersifat penjelasan, dengan aksi lanjut melalui /app.

### 5.5 Controls and custody

Pertahankan id custody. Gabungkan isi custody dan tujuan tabel preset ke dalam penjelasan kontrol yang lebih mudah dipahami.

Tampilkan satu contoh pengaturan, disertai tiga hal utama: batas posisi, pemicu rugi harian, dan kemampuan menghentikan agent. Angka contoh harus diberi label ilustrasi serta tidak ditulis sebagai konfigurasi yang pasti tersedia bagi semua akun.

Sediakan penjelasan perbedaan Stop, Kill, dan pencabutan key. Detail lengkap tetap dapat dibuka di aplikasi atau dokumentasi yang benar benar tersedia.

Jangan memasang tiga tabel preset penuh atau kalkulator risiko baru pada landing page. Perhitungan serta penyimpanan policy tetap menjadi tanggung jawab editor aplikasi.

### 5.6 Evidence

Judul usulan: “See what the data supports.”

Susun isi menjadi ringkasan hasil yang mudah dibaca, beberapa angka relevan, visual sederhana bila membantu, dan tautan ke /evidence.

Untuk hasil yang belum meyakinkan, tulis secara eksplisit bahwa data belum mendukung kesimpulan kuat. Status simulasi harus terlihat sebelum pengguna menafsirkan metrik sebagai hasil nyata.

Rekaman demo atau contoh transaksi Monad dapat memperkuat bukti implementasi jika asetnya benar benar tersedia. Jangan membuat txHash, jumlah pengguna, volume trading, testimoni, audit badge, atau hasil keuntungan rekaan untuk mengisi desain.

### 5.7 FAQ

Gunakan accordion yang dapat dioperasikan dengan keyboard. Jawaban singkat wajib mencakup:

1. Apa yang perlu disiapkan sebelum memakai Monday.
2. Di mana dana berada dan akses apa yang dimiliki key.
3. Apakah strategi dapat merugi.
4. Apa perbedaan Stop dan Kill.
5. Apa yang terjadi ketika data atau koneksi venue bermasalah.
6. Apa yang dicatat pada Monad.

Jawaban harus berasal dari perilaku implementasi terbaru. Jangan mengubah klaim teknis hanya untuk membuat kalimat lebih meyakinkan.

### 5.8 CTA akhir dan footer

CTA akhir mengulangi Launch app dengan kalimat pendek tentang kesiapan mencoba produk. Jangan menambahkan formulir signup jika produk tidak mempunyai alur itu.

Footer menyediakan GitHub, Evidence, Analytics, informasi jaringan, dan dokumentasi bila route atau URL dokumentasinya sudah tersedia. Pertahankan peringatan risiko yang sudah ada. Hindari link kosong atau tombol yang hanya menjadi hiasan.

## 6. Wireframe desktop dan mobile

### 6.1 Desktop

~~~text
Monday       How it works   Custody   Analytics   Evidence       Launch app

┌──────────────────────────────┐  ┌──────────────────────────────────────┐
│ Market making                │  │ Interactive demo · Example data      │
│ that reacts.                 │  │                                      │
│                              │  │ Bid            Fair price       Ask  │
│ Penjelasan produk singkat    │  │                                      │
│                              │  │ Sinyal masuk dan aksi Monday         │
│ [ Launch app ]               │  │                                      │
│ See how it works             │  │ Quote  Detect  Step aside  Explain   │
│                              │  │ Pause                         Replay │
└──────────────────────────────┘  └──────────────────────────────────────┘

Perpl · Execution       Nansen · Market intelligence       Monad · Records

How to start
Connect your account → Set your limits → Start Monday

Controls and custody
Contoh batas pengguna             Penjelasan akses serta Stop dan Kill

Evidence
Kesimpulan sederhana · Data dan periode · Read the evidence

FAQ

CTA akhir dan footer
~~~

### 6.2 Mobile

~~~text
Monday                  Launch app    Menu

Market making
that reacts.

Penjelasan singkat
[ Launch app ]  See how it works

┌──────────────────────────────────────┐
│ Interactive demo · Example data      │
│ Satu adegan yang terbaca              │
│ Penjelasan satu tahap                 │
│ Previous          Pause         Next │
└──────────────────────────────────────┘

Peran Perpl, Nansen, dan Monad
How to start
Controls and custody
Evidence
FAQ
CTA akhir dan footer
~~~

Wireframe menunjukkan hierarki, bukan gambar antarmuka final. Proporsi, detail visual, dan aset harus diselesaikan serta diperiksa melalui browser.

## 7. Spesifikasi demonstrasi utama

### 7.1 Batas perilaku

Demonstrasi menggunakan skenario yang terkontrol dan diberi label “Interactive demo · Example data”. Semua tombol hanya mengubah ilustrasi lokal. Tidak ada koneksi wallet, penyimpanan policy, penempatan order, atau tanda tangan yang dipicu demonstrasi.

Gunakan data fixture yang koheren dan visual dari bahasa antarmuka Monday. Komponen tampilan boleh dipakai ulang dalam bentuk yang disederhanakan. Hindari gambar dashboard rekaan yang tidak sesuai dengan produk.

Mode data demonstrasi tidak boleh berubah diam diam menjadi data live atau sebaliknya. Jika pengguna membuka live preview, tampilkan perubahan konteks dengan jelas.

### 7.2 Tahap Quote

Tujuan: pengguna memahami Monday memasang penawaran beli dan jual.

Visual memperlihatkan fair price serta dua quote Monday, dengan label Buy quote dan Sell quote yang terbaca. Order lain boleh hadir sebagai konteks samar, tetapi tidak perlu belasan baris angka.

Gerakan: dua quote masuk dengan jarak pendek menuju posisinya, kemudian diam. Tidak perlu terus bergerak mengikuti angka acak.

Copy usulan: “Monday places buy and sell quotes around its estimate of fair price.”

Jangan menambahkan profit counter. Tahap ini menjelaskan quoting, bukan membuktikan hasil keuntungan.

### 7.3 Tahap Detect

Tujuan: pengguna melihat informasi yang menyebabkan perubahan keputusan.

Tampilkan satu sinyal pembelian kuat dari trader yang ditandai pada sumber data. Fixture lama dengan contoh arus 640 ribu USD boleh digunakan selama label contoh terlihat.

Gerakan: highlight berpindah ke sinyal, kemudian satu penghubung visual mengarahkan perhatian ke quote yang terpapar. Angka tidak perlu bergulir dari nol jika itu memperlambat pembacaan.

Copy usulan: “A strong buying signal changes the risk of keeping the sell quote open.”

Jangan menyebut sinyal pasti mengetahui arah harga berikutnya.

### 7.4 Tahap Step aside

Tujuan: pengguna memahami tindakan spesifik agent.

Quote jual milik Monday ditarik dari posisi yang sama dengan tahap awal. Bid tetap terlihat untuk skenario ilustrasi ini. Order jual milik pasar tidak ikut hilang.

Gerakan: status quote beralih menjadi Withdrawn, baris quote memudar, dan ruang visual tetap stabil. Pertahankan fair price sebagai titik referensi agar perubahan mudah diikuti.

Copy usulan: “Monday pulls the exposed quote while it reassesses the market.”

Jangan membuat animasi yang menyiratkan penarikan order selalu mendahului gerakan pasar atau mencegah semua kerugian.

### 7.5 Tahap Explain

Tujuan: pengguna melihat keputusan mempunyai alasan yang dapat diperiksa.

Tampilkan kartu ringkas dengan aksi, alasan, dan konteks pencatatan pada Monad. Kartu muncul setelah aksi terlihat, sehingga pengguna dapat menghubungkan keduanya.

Copy usulan: “The decision includes a reason and evidence that can be checked.”

Untuk demonstrasi, gunakan label Example record. Tombol menuju transaksi nyata hanya muncul jika ada txHash yang telah diverifikasi dan sesuai jaringan. Jangan memberi link explorer palsu pada fixture.

Berikan catatan singkat bahwa urutan animasi diringkas. Interval governor, proses konfirmasi chain, dan respons venue tidak berlangsung serempak hanya karena adegannya berdurasi beberapa detik.

### 7.6 Penjelasan engine yang dipertahankan

Isi Engine, Reflex, dan Governor tetap berguna bagi pembaca yang ingin detail. Tempatkan dalam disclosure “Under the hood” di dekat demonstrasi atau tautan dokumentasi yang tersedia.

Pertahankan perbedaan antara loop eksekusi, respons terhadap burst, dan perubahan parameter oleh LLM. Jangan menggambar koneksi yang menyiratkan setiap order membutuhkan panggilan model atau tanda tangan wallet.

## 8. Spesifikasi animasi dan interaksi

### 8.1 Hierarki gerakan

Ada tiga lapisan gerak:

1. Pembukaan hero untuk mengarahkan urutan perhatian.
2. Demonstrasi utama untuk menjelaskan sebab akibat.
3. Umpan balik kontrol dan transisi section untuk membuat interaksi terasa konsisten.

Hanya demonstrasi utama yang boleh mempunyai narasi gerak panjang. Informasi risiko, menu, footer, dan teks FAQ harus mudah dibaca dalam keadaan diam.

### 8.2 Pembukaan hero

Gunakan perpindahan vertikal sekitar 12 sampai 20 piksel dengan opacity. Durasi per elemen sekitar 500 sampai 650 milidetik, selisih awal sekitar 60 sampai 90 milidetik, dan rangkaian utama selesai dalam sekitar 900 milidetik.

Urutan: headline, deskripsi, CTA, lalu panel demonstrasi. Teks harus sudah ada dalam HTML. CTA tidak boleh menunggu animasi selesai untuk dapat digunakan.

Gunakan perlambatan yang konsisten, misalnya kurva [0.16, 1, 0.3, 1]. Hindari pantulan pada headline atau blur besar yang membuat teks sulit dibaca.

### 8.3 Pemutaran demonstrasi

Baseline implementasi adalah pemutaran satu kali dengan kontrol manual. Pemutaran otomatis dimulai hanya setelah sekitar 60 persen area demonstrasi terlihat dan preferensi pengguna tidak meminta pengurangan gerakan.

Rancangan waktu awal:

1. Quote: sekitar 3 detik.
2. Detect: sekitar 4 detik.
3. Step aside: sekitar 4 detik.
4. Explain: sekitar 4 detik.

Total sekitar 15 detik. Transisi objek sekitar 250 sampai 450 milidetik. Waktu tersebut adalah parameter desain yang boleh disesuaikan setelah uji keterbacaan, bukan klaim latensi engine.

Sesudah selesai, adegan terakhir tetap diam dan Replay tersedia. Jangan otomatis mengulang tanpa batas.

### 8.4 State pemutaran

State yang perlu dibedakan adalah ready, playing, paused, dan completed. Simpan tahap terpilih dan alasan penghentian otomatis secara terpisah jika diperlukan.

Aturan transisi:

1. Kunjungan pertama dengan demonstrasi belum terlihat tetap ready pada tahap Quote.
2. Masuk viewport memulai pemutaran satu kali bila diizinkan.
3. Pause menghentikan progres tanpa mengubah tahap.
4. Pemilihan tahap secara manual menghentikan autoplay dan menampilkan tahap tersebut.
5. Keluar viewport atau tab browser tersembunyi menghentikan kerja animasi.
6. Kembali ke viewport tidak mengabaikan Pause yang dilakukan pengguna.
7. Resume melanjutkan pemutaran dari tahap yang sedang dilihat.
8. Replay kembali ke Quote dan memulai rangkaian sesuai preferensi gerakan.
9. Unmount membersihkan timer, observer, dan subscription.

Untuk scope awal, pengguna yang kembali setelah pemutaran otomatis terhenti dapat menekan Resume. Tidak perlu algoritme otomatis yang menebak apakah pengguna ingin melanjutkan.

### 8.5 Kontrol desktop dan mobile

Desktop menyediakan empat pilihan tahap yang terbaca, Play atau Pause, dan Replay setelah selesai. Status tahap aktif harus terlihat melalui teks atau bentuk selain warna.

Mobile boleh menggunakan satu judul tahap dengan Previous, Play atau Pause, dan Next. Empat tombol tahap juga boleh dipakai jika tetap mempunyai target sentuh yang memadai. Tidak perlu gesture swipe sebagai satu satunya cara berpindah tahap.

Jika memakai pola tabs, lengkapi hubungan tab dan panel, fokus keyboard, serta navigasi tombol panah. Jika memakai tombol langkah biasa, jangan menambahkan role tab tanpa perilaku tab yang lengkap.

### 8.6 Scroll dan section lain

Section tambahan boleh masuk melalui perpindahan sekitar 8 sampai 16 piksel dan opacity, satu kali ketika terlihat. Gerakan ini tidak boleh menyembunyikan konten secara permanen ketika JavaScript gagal.

Mode demonstrasi yang dikendalikan scroll dapat ditambahkan setelah baseline berfungsi dan diuji. Dalam mode tersebut, scroll menjadi satu pengendali progres. Jangan menjalankan autoplay dan progres scroll secara bersamaan.

Jangan mengunci scroll halaman atau menahan pengguna dalam rangkaian panjang. Pada mobile, pertahankan perpindahan tahap manual sebagai jalur utama. Native scrolling harus tetap terasa normal.

### 8.7 Umpan balik interaksi

Hover atau fokus tombol menggunakan transisi warna dan border sekitar 150 sampai 200 milidetik. Press boleh memakai scale sekitar 0,98 dengan pemulihan singkat. Area klik tidak bergerak menjauhi pointer.

Menu mobile dan FAQ menggunakan transisi singkat tanpa melompatkan fokus. Hindari cursor khusus, tombol magnetis yang berlebihan, dan tilt besar pada panel yang berisi teks penting.

### 8.8 Pengurangan gerakan

Jika pengguna mengaktifkan reduced motion, tampilkan konten tanpa translasi pembukaan, tanpa parallax, dan tanpa autoplay. Semua tahap tetap dapat dipilih secara manual. Perubahan state langsung atau fade ringan boleh dipakai bila tetap nyaman.

Preferensi yang berubah saat halaman terbuka harus ditangani. Pengguna tidak boleh kehilangan tahap yang sedang dibaca.

Motion sudah tersedia dalam proyek dan mendukung animasi saat elemen terlihat serta animasi yang mengikuti scroll. Gunakan kemampuan yang ada sebelum menambah library. Rujukan: [animasi scroll Motion](https://motion.dev/docs/react-scroll-animations) dan [useReducedMotion](https://motion.dev/docs/react-use-reduced-motion).

## 9. Sistem visual dan responsivitas

### 9.1 Tipografi

Pertahankan Mona Sans untuk teks dan JetBrains Mono untuk angka yang perlu dibandingkan. Jangan mengganti font hanya untuk menghasilkan perbedaan kosmetik.

Rentang awal yang disarankan:

1. Headline desktop sekitar 56 sampai 72 piksel dengan maksimal dua baris pada lebar yang memadai.
2. Headline mobile sekitar 36 sampai 44 piksel, menyesuaikan panjang kata tanpa pemotongan.
3. Deskripsi hero sekitar 17 sampai 18 piksel pada desktop dan 16 piksel pada mobile.
4. Teks isi sekitar 15 sampai 17 piksel.
5. Caption sekitar 12 sampai 13 piksel dengan kontras yang tetap terbaca.

Jangan memakai ukuran terminal 10 sampai 12 piksel sebagai teks utama demonstrasi pemasaran. Gunakan satu istilah teknis hanya ketika diperlukan untuk menjelaskan manfaat.

### 9.2 Spacing dan bentuk

Gunakan lebar konten sekitar 1.200 sampai 1.320 piksel. Jarak section sekitar 80 sampai 112 piksel pada desktop dan 56 sampai 72 piksel pada mobile sebagai titik awal.

Jarak besar harus mengelompokkan cerita. Kurangi ruang kosong yang memisahkan judul dari visual tanpa tujuan. Pertahankan radius dan border yang berasal dari komponen Monday, dengan kedalaman visual secukupnya pada demonstrasi utama.

Jangan membuat semua section menjadi kartu. Hindari panel di dalam panel hanya untuk menambah garis dekoratif.

### 9.3 Target mobile

Pada lebar 390 piksel, headline, deskripsi, dan CTA utama harus terlihat dalam viewport awal pada ukuran teks normal. Demonstrasi berada segera setelahnya dengan tinggi awal sekitar 300 sampai 380 piksel.

Target awal tinggi gabungan hero sekitar 850 sampai 1.000 piksel, bergantung pada wrapping. Jangan memaksakan tinggi tetap yang memotong teks saat zoom atau pengaturan font diperbesar.

Tidak ada tabel horizontal yang harus dibaca untuk memahami manfaat utama. Tidak ada tiga panel terminal yang bertumpuk sebagai visual pembuka. Grafik bukti yang panjang harus mempunyai versi ringkas atau ringkasan tekstual.

### 9.4 Aset

Gunakan cuplikan UI asli, rekaman produk yang aktual, atau komponen demonstrasi yang benar benar interaktif. Jika memakai screenshot, pastikan teks masih terbaca pada ukuran tampil dan data sensitif tidak ikut terlihat.

Aset video opsional menggunakan poster yang informatif, kontrol yang dapat digunakan, tanpa audio otomatis, serta dimuat setelah diperlukan. Jangan menambah video besar dan demonstrasi berat yang melakukan pekerjaan penjelasan sama pada hero.

## 10. Data, copy, dan state gagal

### 10.1 Landing page tidak bergantung pada live feed untuk menjelaskan produk

Demonstrasi utama memakai fixture yang diberi label. API dan WebSocket publik tidak perlu berjalan hanya untuk menampilkan headline atau ilustrasi.

Jika live preview dipertahankan, tempatkan pada bagian opsional “View live market data”. Muat modul dan koneksi ketika pengguna membukanya, lalu bersihkan saat ditutup. Perubahan ini khusus komponen publik, tanpa mematikan koneksi dashboard pengguna.

Pertahankan pembeda live, simulated, paper, stale, disconnected, dan book only pada preview tersebut. Jangan mengganti label menjadi Live ketika yang bergerak adalah fixture.

### 10.2 State Evidence

1. Loading: placeholder dengan ukuran stabil dan teks bahwa hasil sedang dimuat.
2. Pending: data belum cukup untuk menghasilkan studi.
3. Error: data tidak dapat dimuat, dengan Retry bila relevan.
4. Partial: sebagian metrik tidak tersedia; tampilkan yang valid dan jelaskan kekurangannya.
5. Success: hasil, periode, sumber data, serta interpretasi tampil bersama.
6. Synthetic: penanda simulasi terlihat dekat hasil, bukan hanya di bagian paling bawah.

Jangan mengubah network error menjadi “still collecting data”. Jangan mengisi metrik yang hilang dengan nol. Periksa keberadaan grid window dan horizon sebelum membaca rho atau intervalnya.

Periode data berasal dari metadata yang benar. Bila API belum bisakamenyediakannya, hilangkan klaim periode spesifik atau tambahkan dukungan metadata yang dapat diverifikasi.

### 10.3 Klaim yang perlu dijaga

1. Dana di akun Perpl tidak berarti akun bebas dari kerugian trading.
2. Batas rugi adalah pemicu tindakan, bukan jaminan kerugian akhir.
3. Stop tidak sama dengan menutup seluruh posisi.
4. Kill dan cleanup dapat membutuhkan waktu serta bergantung pada respons venue.
5. Base quote dapat berbeda dari ukuran order yang akhirnya dikirim.
6. Smart money signal tidak menjamin arah harga.
7. Hasil event study tidak sama dengan profit strategi setelah biaya.
8. Policy tersimpan, policy terbit, dan keputusan tercatat adalah state yang berbeda.

Gunakan laporan Policy sebagai rujukan istilah domain. Jangan menambahkan janji perlindungan atau keuntungan melalui headline baru.

### 10.4 Bahasa produk

UI tetap berbahasa Inggris agar konsisten dengan aplikasi. Laporan ini berbahasa Indonesia untuk agent.

Gunakan kalimat pendek dan konkret. Jangan memakai em dash dalam copy. Hindari istilah seperti revolutionary, guaranteed profit, atau intelligent ecosystem tanpa penjelasan yang dapat dibuktikan.

Pesan kegagalan harus membantu pengguna produk. Instruksi npm, nama environment variable, stack trace, atau detail infrastruktur tidak masuk state publik.

## 11. Performa dan aksesibilitas

### 11.1 Performa

Pertahankan halaman utama sebagai Server Component jika sesuai arsitektur saat ini. Isolasi demonstrasi dan kontrol interaktif dalam komponen client yang kecil. Jangan menjadikan semua konten statis client hanya untuk memberi animasi masuk.

Gunakan Motion yang sudah ada untuk interaksi. Library tambahan hanya diperlukan jika ada kebutuhan yang tidak dapat dipenuhi secara wajar oleh fondasi tersebut. Tidak perlu memasang GSAP, Three.js, atau sistem smooth scroll untuk memenuhi brief ini.

Utamakan transform dan opacity. Animasi yang memicu perubahan layout atau pengecatan besar harus dibatasi dan diperiksa pada perangkat target. Rujukan: [panduan animasi berperforma baik](https://web.dev/articles/animations-guide).

Perhitungan progres per frame tidak dilakukan melalui React state. Gunakan motion values dan observer untuk perubahan visibilitas. State React cukup untuk tahap semantik, menu, dan pilihan pengguna.

Target awal yang harus diukur pada production build:

1. LCP paling lama sekitar 2,5 detik pada profil pengujian yang dicatat.
2. Respons interaksi utama sekitar 200 milidetik atau lebih cepat pada kondisi yang dicatat.
3. CLS paling besar sekitar 0,1.
4. Animasi stabil tanpa tersendat yang terlihat pada perangkat desktop dan mobile pengujian.
5. Tidak ada kerja animasi berkelanjutan setelah tab tersembunyi atau demonstrasi keluar viewport.
6. Tidak ada koneksi WebSocket publik sebelum live preview opsional dibuka.
7. Chart library dan data analytics yang tidak diperlukan tidak masuk jalur pembukaan hero.

Angka di atas adalah sasaran, bukan pengukuran saat ini atau jaminan untuk semua perangkat. Catat perangkat, build, jaringan, dan metode pengukuran. Hasil Lighthouse saja tidak membuktikan seluruh pengalaman interaksi atau INP pengguna nyata.

### 11.2 Aksesibilitas

1. Gunakan satu h1 dan urutan heading yang masuk akal.
2. Semua kontrol mempunyai nama yang dapat dikenali pembaca layar.
3. Fokus keyboard terlihat pada tema gelap serta terang.
4. Menu mobile dapat dibuka dan ditutup dengan keyboard, termasuk Escape, dengan pengembalian fokus yang tepat.
5. Tombol utama dan kontrol demonstrasi memiliki target sentuh sekitar 44 piksel.
6. Teks penting tidak disembunyikan dalam tooltip yang hanya muncul saat hover.
7. Pembaruan animasi tidak membacakan setiap angka melalui live region. Pengumuman cukup untuk perubahan tahap atau hasil aksi yang diperlukan.
8. Demo tetap dapat dipahami tanpa warna atau gerakan.
9. Zoom 200 persen dan pembesaran teks tidak memotong headline, menu, CTA, atau kontrol.
10. Konten penjelasan inti tetap tersedia jika JavaScript gagal atau animasi dinonaktifkan.

## 12. Peta implementasi

### 12.1 File yang sudah ada

1. [apps/web/app/page.tsx](/Users/yoga/Projects/mondaynad/apps/web/app/page.tsx): susunan section, copy, anchor, hero, CTA, FAQ, serta penggantian tabel preset pada landing.
2. [apps/web/components/landing.tsx](/Users/yoga/Projects/mondaynad/apps/web/components/landing.tsx): HeroTerminal, Story, EvidenceTeaser, fixture, dan state interaktif yang perlu disusun ulang.
3. [apps/web/components/site-header.tsx](/Users/yoga/Projects/mondaynad/apps/web/components/site-header.tsx): menu mobile, navigasi, footer, dan link publik. Komponen ini digunakan halaman publik lain; periksa dampaknya.
4. [apps/web/app/globals.css](/Users/yoga/Projects/mondaynad/apps/web/app/globals.css): token dan animasi bersama. Jangan mengubah ukuran teks atau panel global demi landing sehingga terminal ikut berubah.
5. [apps/web/app/layout.tsx](/Users/yoga/Projects/mondaynad/apps/web/app/layout.tsx): font dan metadata bersama. Metadata khusus landing sebaiknya dibatasi pada route yang relevan agar judul halaman lain tidak ikut tertimpa.
6. [apps/web/components/ui.tsx](/Users/yoga/Projects/mondaynad/apps/web/components/ui.tsx): ButtonLink, Wordmark, Panel, serta primitives yang dapat dipakai ulang.
7. [apps/web/components/book.tsx](/Users/yoga/Projects/mondaynad/apps/web/components/book.tsx): rujukan visual order book. Jangan memaksa seluruh perilaku terminal masuk ke demonstrasi ringan.
8. [apps/web/components/price-chart.tsx](/Users/yoga/Projects/mondaynad/apps/web/components/price-chart.tsx): komponen chart saat ini yang sebaiknya tidak menjadi kebutuhan pembukaan hero.
9. [apps/web/components/charts.tsx](/Users/yoga/Projects/mondaynad/apps/web/components/charts.tsx): visual Evidence yang dapat dipakai bila memang membantu penjelasan.
10. [apps/web/lib/live.ts](/Users/yoga/Projects/mondaynad/apps/web/lib/live.ts): REST preview, WebSocket, reconnect, dan stale detection. Batasi perubahan perilaku koneksi pada pemakaian publik yang relevan.
11. [apps/web/components/network-note.tsx](/Users/yoga/Projects/mondaynad/apps/web/components/network-note.tsx): sumber keterangan jaringan dan dana nyata.
12. [apps/web/AGENTS.md](/Users/yoga/Projects/mondaynad/apps/web/AGENTS.md): instruksi proyek yang harus dibaca sebelum implementasi, termasuk dokumentasi Next yang terpasang.

### 12.2 Pembagian tanggung jawab yang disarankan

1. LandingHero menyusun pesan, CTA, dan slot demonstrasi.
2. ProductDemo mengelola tahap serta kontrol pemutaran, tanpa API trading.
3. DemoScene menampilkan keadaan visual berdasarkan tahap yang diberikan.
4. DemoControls menyediakan navigasi dan status pemutaran yang dapat diakses.
5. LandingEvidence mengelola state data dan interpretasi hasil.
6. LiveMarketPreview menjadi komponen opsional yang baru dimuat ketika dibuka.
7. LandingFAQ menyediakan pertanyaan produk dengan jawaban yang bersumber dari implementasi.

Nama tersebut adalah usulan tanggung jawab. Tidak wajib membuat satu file untuk setiap nama, dan tidak perlu menambahkan state management global baru.

### 12.3 Metadata dan link

Pertahankan route yang ada. Audit metadata title, description, serta preview sosial ketika copy hero berubah. Tambahkan aset preview sosial jika dibuat dan diverifikasi; jangan menulis path ke gambar yang belum ada.

Pertahankan event analytics yang sudah digunakan jika ada. Jangan menambah tracker pihak ketiga hanya untuk mengukur redesign tanpa kebutuhan yang jelas.

### 12.4 Perlindungan pekerjaan yang sudah ada

Working tree memiliki banyak perubahan lokal. Baca git status dan diff terkait sebelum mengedit. Jangan menggunakan reset atau mengganti komponen besar secara membabi buta.

Perubahan route Policy, terminal, analytics, serta runner bukan bagian dari redesign landing kecuali perbaikan kecil yang memang diperlukan dan dijelaskan secara eksplisit.

## 13. Prioritas dan urutan pengerjaan

### Tahap 1. Struktur serta kebenaran isi

Prioritas P0.

Susun hero baru, tentukan satu demonstrasi utama, pertahankan anchor, rapikan pesan produk, dan tetapkan kontrak fixture. Tangani pesan developer serta copy yang tidak sesuai perilaku engine.

Hasil tahap: layout statis sudah dapat dipahami pada desktop dan mobile sebelum animasi ditambahkan.

### Tahap 2. Demonstrasi dan animasi utama

Prioritas P0.

Implementasikan empat tahap, transisi objek yang berkesinambungan, Play, Pause, Resume, Replay, penghentian di luar viewport, serta reduced motion. Animasi utama merupakan bagian wajib dari hasil pekerjaan.

Hasil tahap: pengguna dapat memahami alur Quote → Detect → Step aside → Explain dan mengontrol kecepatannya sendiri.

### Tahap 3. Konten pendukung dan state data

Prioritas P0 untuk error dan kebenaran data; P1 untuk penyempurnaan komposisi.

Bangun How to start, Controls and custody, Evidence, FAQ, serta footer. Pisahkan live preview dari jalur utama. Lengkapi menu mobile.

Hasil tahap: seluruh halaman berfungsi saat data live tersedia maupun gagal dimuat, dengan link dan CTA yang benar.

### Tahap 4. Verifikasi dan penyempurnaan

Prioritas P0 untuk regresi, aksesibilitas utama, dan mobile; P1 untuk perapian detail visual.

Uji kedua tema, keyboard, zoom, viewport, animasi, jaringan, bundle, dan halaman lain yang memakai komponen bersama. Perbaiki berdasarkan bukti, lalu rekam demonstrasi hasil akhir.

### Tahap 5. Tambahan opsional

Prioritas P2.

Animasi yang dikendalikan scroll, video presentasi tambahan, atau visual khusus dapat ditambahkan jika membantu pemahaman dan performanya memenuhi target. Hindari menunda alur inti demi efek dekoratif.

## 14. Kriteria penerimaan

Daftar ini adalah pekerjaan verifikasi untuk agent implementasi. Belum ada klaim bahwa redesign atau pengujian berikut telah selesai.

### 14.1 Struktur dan layout

1. LP01: Headline, deskripsi, dan Launch app membentuk satu kelompok visual yang jelas pada desktop.
2. LP02: Hanya ada satu demonstrasi utama; order book besar tidak diulang dalam section berikutnya.
3. LP03: Pada mobile 390 × 844, pesan inti dan CTA tersedia dalam viewport awal pada ukuran teks normal.
4. LP04: Mobile tidak menumpuk order book, chart, dan feed penuh dalam hero.
5. LP05: Informasi inti tidak memerlukan geser horizontal pada lebar 360, 390, dan 430 piksel.
6. LP06: Layout bekerja pada 768, 1024, 1280, dan 1440 piksel tanpa tabrakan, teks terpotong, atau ruang kosong yang memisahkan elemen terkait.
7. LP07: Tema terang dan gelap mempertahankan hierarki, kontras, dan warna semantik yang terbaca.
8. LP08: Section mempunyai variasi komposisi yang sesuai fungsi dan tidak seluruhnya menjadi kumpulan kartu seragam.

### 14.2 Demonstrasi dan animasi

1. LP09: Quote, Detect, Step aside, dan Explain dapat dipahami sebagai empat state yang saling berhubungan.
2. LP10: Tahap penarikan quote menghapus quote Monday yang tepat, tanpa menghilangkan seluruh sisi order book pasar.
3. LP11: Example data dan Example record terlihat, dan tidak ada fixture yang diberi label live atau transaksi nyata.
4. LP12: Autoplay belum berjalan saat demonstrasi belum terlihat.
5. LP13: Pemutaran otomatis selesai satu kali dan menyediakan Replay.
6. LP14: Pause, Resume, Previous, Next, dan pemilihan tahap bekerja sesuai kontrol yang ditampilkan.
7. LP15: Keluar viewport atau menyembunyikan tab menghentikan kerja animasi; kembali tidak membatalkan pilihan Pause pengguna.
8. LP16: Reduced motion mematikan autoplay serta gerak besar, sambil menjaga seluruh informasi tetap dapat diakses.
9. LP17: Timer dan observer dibersihkan setelah navigasi, unmount, atau perubahan mode.
10. LP18: Transisi tidak menyebabkan teks melompat, kontrol berpindah dari pointer, atau perubahan tinggi panel yang mengganggu.

### 14.3 Alur pengguna dan aksesibilitas

1. LP19: Launch app menuju /app dan tidak memicu trading, wallet signature, atau start otomatis dari landing.
2. LP20: How it works dan CTA demonstrasi menuju #how; Custody menuju #custody tanpa tertutup sticky header.
3. LP21: Menu mobile menyediakan seluruh tujuan navigasi utama yang tersedia di desktop.
4. LP22: Menu dapat dioperasikan dengan keyboard, ditutup dengan Escape, dan mengembalikan fokus secara benar.
5. LP23: Semua tahap demo dan FAQ dapat digunakan tanpa mouse.
6. LP24: Role tab hanya digunakan jika hubungan panel dan perilaku keyboardnya lengkap.
7. LP25: Zoom 200 persen tidak memotong isi atau menyembunyikan tombol penting.
8. LP26: Pembaca layar tidak menerima pengumuman berulang untuk setiap angka animasi; label serta state kontrol tetap jelas.

### 14.4 Data dan kepercayaan

1. LP27: Loading, pending, network error, partial, success, dan synthetic pada Evidence mempunyai tampilan yang sesuai.
2. LP28: Grid window atau horizon yang hilang tidak menyebabkan crash atau metrik rekaan.
3. LP29: Periode data tidak memakai klaim tetap yang berbeda dari dataset aktual.
4. LP30: Angka studi tidak disebut win rate atau profit strategi tanpa dukungan data yang memang mengukur hal tersebut.
5. LP31: State publik tidak menampilkan perintah developer, stack trace, atau instruksi konfigurasi server.
6. LP32: Live preview menunjukkan status data yang benar, termasuk stale, disconnected, simulated, paper, dan book only sesuai konteks.
7. LP33: Tidak ada testimoni, partner, angka volume, txHash, atau badge audit yang dibuat tanpa bukti.
8. LP34: Penjelasan dana, API key, Stop, Kill, spread, dan loss trigger konsisten dengan perilaku produk terbaru.

### 14.5 Performa dan regresi

1. LP35: Hero tetap menjelaskan produk ketika backend data tidak tersedia.
2. LP36: WebSocket publik baru dibuka ketika live preview opsional dibuka dan dibersihkan ketika ditutup.
3. LP37: Perubahan koneksi publik tidak memutus atau mengubah perilaku stream dashboard pengguna.
4. LP38: Pemeriksaan bundle memastikan modul chart berat yang tidak diperlukan tidak menjadi bagian wajib pembukaan hero.
5. LP39: Build, pemeriksaan tipe, pengujian perilaku relevan, serta pemeriksaan browser dicatat dengan hasil sebenarnya.
6. LP40: Pengujian singkat dengan pembaca baru menunjukkan mereka dapat menjelaskan fungsi Monday, peran integrasinya, kontrol risiko, dan langkah berikutnya. Jika belum ada peserta uji, catat sebagai belum dilakukan.

## 15. Prosedur verifikasi

### 15.1 Pemeriksaan otomatis

Gunakan test untuk state pemutaran, transisi yang rawan timer bocor, perilaku reduced motion bila harness mendukung, parsing hasil Evidence, dan fallback response tidak lengkap.

Jangan menambah test yang hanya menyalin jumlah div atau isi class CSS. Snapshot visual dan pemeriksaan browser lebih sesuai untuk membuktikan komposisi.

Perintah dasar yang tersedia pada repositori:

~~~sh
npm run typecheck
npm run build
npm test
~~~

Gunakan subset pengujian yang relevan selama pengembangan, kemudian jalankan pemeriksaan yang diwajibkan proyek. Catat kegagalan baseline secara terpisah dari regresi perubahan ini. Pengujian yang tidak dijalankan tidak boleh dilaporkan lulus.

### 15.2 Browser dan rekaman

Ambil screenshot hero serta halaman penuh pada desktop dan mobile. Sertakan contoh menu mobile, state Evidence gagal, dan reduced motion. Ambil rekaman sekitar 15 sampai 25 detik yang memperlihatkan satu siklus demonstrasi beserta kontrolnya.

Rekaman membuktikan kualitas transisi yang tidak dapat dinilai dari screenshot. Pastikan label ilustrasi terlihat. Tidak perlu melakukan transaksi nyata untuk menghasilkan bukti animasi.

### 15.3 Pengukuran performa

Bandingkan production build sebelum dan sesudah dengan viewport, perangkat, dan kondisi jaringan yang sama. Catat request, bundle, layout shift, serta respons interaksi.

Jika performance trace menunjukkan pekerjaan berulang saat demo tidak terlihat, perbaiki lifecycle animasi. Jika font atau panel menyebabkan layout shift, tetapkan ukuran dan fallback yang sesuai. Jangan menyembunyikan masalah dengan memperpanjang loading screen.

### 15.4 Pemeriksaan lintas halaman

Karena header, footer, UI primitives, dan CSS dipakai bersama, periksa minimal landing, Evidence, Analytics, onboarding, dan dashboard setelah perubahan global. Jangan menganggap halaman lain aman hanya karena route landing berhasil dibuka.

## 16. Hasil akhir yang harus diserahkan

1. Landing page yang berfungsi dengan layout desktop dan mobile yang telah diperiksa.
2. Demonstrasi empat tahap dengan animasi yang benar benar berjalan dan kontrol pemutaran yang lengkap.
3. State data yang jujur serta tidak bergantung pada backend untuk menjelaskan fungsi dasar produk.
4. Daftar file yang berubah dan ringkasan keputusan desain.
5. Screenshot sebelum dan sesudah, serta rekaman animasi hasil akhir.
6. Hasil pemeriksaan tipe, build, test yang relevan, dan pemeriksaan browser.
7. Hasil pengukuran performa jika dilakukan, dengan konteks pengukurannya.
8. Daftar batasan yang masih ada, termasuk uji pengguna atau perangkat yang belum tersedia.

Pekerjaan selesai ketika pengunjung dapat memahami produk dan mengoperasikan demonstrasi dengan mudah, animasi memperjelas tindakan agent, mobile nyaman digunakan, serta perubahan tidak merusak halaman aplikasi lain.

## 17. Kontrak setiap section

### S01. Header dan navigasi

Tugas pengguna: mengenali brand dan menemukan jalur menuju aplikasi atau penjelasan yang dibutuhkan.

Isi wajib adalah wordmark, navigasi utama yang sudah ada, theme control, dan Launch app. Desktop menggunakan satu baris. Mobile menampilkan wordmark, Launch app, serta tombol menu; navigasi lengkap berada di dalam menu.

Header tidak berubah tinggi ketika pengguna scroll. Efek blur yang sudah ada boleh dipertahankan secara ringan dengan warna permukaan yang tetap terbaca bila blur tidak tersedia.

Pada lebar ketika seluruh label navigasi tidak lagi muat, pindahkan ke menu. Jangan mengecilkan teks sampai sukar dibaca atau membuang tujuan navigasi. Ambang awal yang disarankan adalah 1024 piksel, lalu sesuaikan berdasarkan pengukuran isi sebenarnya.

Acceptance section: seluruh tujuan yang tersedia pada desktop juga tersedia di mobile, fokus terlihat, dan satu klik Launch app selalu mengarah ke /app tanpa proses lain.

### S02. Hero dan demonstrasi

Tugas pengguna: memahami manfaat Monday dalam beberapa detik dan memilih mencoba aplikasi atau melihat cara kerja.

Urutan isi teks adalah h1, satu paragraf penjelasan, lalu pasangan CTA. Hindari tambahan eyebrow, angka statistik, ticker, dan badge teknologi di atas headline. Konteks data ilustrasi berada pada panel demonstrasi.

Visual utama mempunyai tiga lapisan: konteks harga yang tetap, objek quote serta sinyal yang berubah, dan caption tahap yang menjelaskan perubahan. Kontrol pemutaran diletakkan setelah adegan, bukan mengambang di atas angka.

Jika layout belum diukur, prioritaskan keterbacaan visual dengan mengurangi jumlah data. Jangan memaksakan panel kanan berisi chart, tape, order book, dan log sekaligus.

Acceptance section: pengunjung dapat menunjuk quote yang berubah dan alasan perubahannya tanpa membaca source, sementara CTA selalu dekat dengan pesan utama.

### S03. Peran integrasi

Tugas pengguna: memahami bagian produk yang berjalan pada Perpl, menggunakan Nansen, dan dicatat pada Monad.

Tiga peran ditampilkan dalam baris yang rapi pada desktop dan kelompok vertikal ringkas pada mobile. Setiap peran berisi nama, fungsi satu kalimat, dan link penjelasan yang memang tersedia bila diperlukan.

Pernyataan integrasi menjelaskan arsitektur produk. State deployment tetap harus diperiksa dari config. Bila registry tidak dikonfigurasi, jangan memberi badge “Onchain active” hanya karena nama Monad ada di bagian ini.

Acceptance section: pengunjung tidak salah mengira Monad adalah sumber sinyal atau Nansen adalah tempat dana disimpan.

### S04. How to start

Tugas pengguna: mengetahui persiapan dan langkah setelah Launch app.

Gunakan urutan bernomor 1, 2, 3 yang menghubungkan tindakan pengguna dengan hasilnya. Cuplikan UI paling banyak satu per langkah. Screenshot harus dipotong pada area yang relevan dengan langkah tersebut, tanpa menampilkan key atau informasi sensitif.

Jika aset UI belum tersedia, gunakan teks dan representasi kontrol asli yang sederhana. Jangan membuat screenshot dari produk lain atau modal wallet palsu.

Pada mobile, ketiga langkah tetap tampil sebagai urutan yang dapat dibaca. Hindari carousel yang menyembunyikan dua langkah lain di luar layar tanpa penanda.

Acceptance section: langkah memilih limit muncul sebelum start, dan proses tanda tangan yang mungkin diperlukan tidak dihilangkan dari penjelasan demi mengesankan onboarding instan.

### S05. Controls and custody

Tugas pengguna: mengetahui batas yang dapat diatur serta cara mengambil kembali kendali.

Gunakan satu panel contoh dengan market BTC, base quote 25 USD, position limit 250 USD, daily loss trigger 25 USD, dan leverage limit 2x. Nilai ini sesuai template Conservative yang diperiksa, tetapi tetap berlabel contoh dan bukan rekomendasi personal atau janji nilai minimum yang tersedia.

Di samping atau setelah panel, tampilkan penjelasan ringkas tentang dana pada Perpl, Stop, Kill, dan pencabutan key. Hindari tombol merah menyerupai tombol trading yang aktif. Bila penjelasan memakai kontrol visual, tandai sebagai illustration dan gunakan elemen yang tidak mengeksekusi tindakan.

Panel contoh tidak menghitung return, APY, atau perkiraan profit. Tidak ada slider modal interaktif yang menghasilkan klaim hasil tanpa model yang sah.

Acceptance section: pengguna memahami bahwa Stop meninggalkan posisi terbuka dan bahwa pemicu rugi tidak menjamin jumlah kerugian akhir.

### S06. Evidence

Tugas pengguna: menilai bukti yang tersedia dan menemukan metodologinya.

Susunan wajib adalah status sumber data, ringkasan interpretasi, metrik inti, waktu perhitungan, dan Read the evidence. Chart kecil bersifat pendukung dan dapat ditunda sampai mendekati viewport.

Gunakan satu market yang benar benar ada dalam response. Preferensi awal BTC; jika tidak tersedia, gunakan market pertama yang valid dan tampilkan label market aktual. Jangan memberi judul BTC pada data ETH.

Tampilkan maksimal tiga metrik utama. Detail semua window, horizon, serta replay tetap berada pada /evidence. Hasil negatif atau tidak meyakinkan tidak disembunyikan untuk mempertahankan narasi pemasaran.

Acceptance section: angka yang sama mempunyai label dan satuan yang sama antara ringkasan landing dan halaman Evidence.

### S07. FAQ

Tugas pengguna: menyelesaikan keraguan sebelum membuka aplikasi.

Semua pertanyaan tersedia dalam HTML. Baseline menggunakan disclosure yang dapat dibuka satu per satu dan boleh membiarkan beberapa jawaban terbuka agar pembaca bisa membandingkan.

Header pertanyaan adalah tombol penuh dengan indikator expanded. Jangan hanya membuat ikon kecil di kanan sebagai target klik. Pertahankan jawaban singkat; jika detail memerlukan paragraf panjang, arahkan ke halaman yang relevan.

Acceptance section: FAQ dapat dioperasikan dengan Tab, Enter, dan Space tanpa perilaku fokus yang mengejutkan.

### S08. CTA akhir, footer, dan informasi jaringan

Tugas pengguna: melanjutkan ke aplikasi setelah membaca, atau menemukan source dan bukti.

CTA akhir tetap Launch app. Hindari pengulangan dua tombol berbeda yang sebenarnya menuju tujuan sama. Footer mencakup link yang valid dan informasi lingkungan dari config atau fallback yang jujur.

Keterangan dana nyata tidak boleh hilang saat halaman memakai fixture ilustrasi. Pisahkan dua informasi tersebut: demonstrasi memakai contoh, sedangkan deployment aplikasi dapat menggunakan dana nyata.

Acceptance section: setiap link membuka tujuan yang ada, dan keterangan network tidak diasumsikan dari tampilan atau hostname.

## 18. Spesifikasi ukuran, grid, dan detail visual

### 18.1 Grid menurut lebar layar

1. Lebar 360 sampai 639 piksel: satu kolom, padding horizontal 16 piksel, jarak antar kelompok kecil 16 sampai 24 piksel. Header ringkas dengan menu.
2. Lebar 640 sampai 1023 piksel: satu kolom hero dengan visual yang lebih lebar, padding horizontal 24 piksel. Isi teks memiliki lebar maksimal sekitar 38rem agar baris tidak terlalu panjang.
3. Lebar 1024 sampai 1279 piksel: hero boleh memakai dua kolom jika area pesan minimal sekitar 360 piksel dan visual minimal sekitar 460 piksel setelah padding serta gap. Jika tidak tercapai, pertahankan satu kolom.
4. Lebar 1280 piksel ke atas: lebar konten maksimal sekitar 1280 piksel, padding sisi minimal 32 piksel, dan gap hero 40 sampai 56 piksel.
5. Lebar sangat besar: konten tetap berada dalam batas lebar tersebut. Jangan meregangkan teks dan adegan mengikuti seluruh monitor.

Gunakan pengukuran container jika sidebar atau shell mengurangi ruang. Hindari mencocokkan tinggi kolom dengan deretan elemen kosong.

### 18.2 Skala jarak

Gunakan kelipatan dasar 4 piksel. Pilihan yang dianjurkan adalah 4, 8, 12, 16, 24, 32, 48, 64, dan 96 piksel.

Jarak headline ke deskripsi sekitar 20 sampai 24 piksel. Deskripsi ke CTA sekitar 24 sampai 28 piksel. Caption ke kontrol demo sekitar 16 piksel. Jarak antar section harus lebih besar daripada jarak antar elemen di dalam section.

Jangan menambahkan margin acak pada setiap komponen untuk memperbaiki screenshot satu ukuran. Periksa penyebab pada grid, line height, atau lebar elemen lebih dahulu.

### 18.3 Tipografi yang lebih spesifik

Headline menggunakan weight sekitar 600, line height sekitar 1,05 sampai 1,12, dan tracking sedikit rapat. Paragraf menggunakan line height sekitar 1,5 sampai 1,65. Label kontrol harus tetap terbaca pada ukuran minimal sekitar 13 sampai 14 piksel.

Teks panjang dalam caption demo memiliki lebar maksimal sekitar 48 karakter per baris pada desktop. Pada mobile, caption boleh dua atau tiga baris tetapi tidak boleh menggeser tombol keluar panel setiap kali tahap berganti.

Sediakan ruang caption untuk tahap dengan isi terpanjang. Angka memakai tabular figures agar perubahan digit tidak menggeser alignment. Gunakan monospaced font hanya untuk harga, angka, identitas singkat, dan detail bukti yang membutuhkannya.

### 18.4 Token warna yang sudah tersedia

Source tema gelap yang diperiksa menyediakan void #060708, canvas #0c0d10, raised #14161a, teks utama #e9ebee, teks sekunder #a3a9b2, amber #ffa630, bid #27a583, dan ask #e0633f.

Gunakan token yang sudah ada, bukan menyalin seluruh hex ke komponen baru. Warna semantik untuk teks bid dan ask juga sudah tersedia dan berbeda dari warna dasar bidangnya.

Teks tombol utama menggunakan pasangan accent dan accent foreground yang sudah disediakan untuk masing masing tema. Jangan memasang teks putih di atas semua tombol amber tanpa mengukur kontras.

Kualitas visual tidak memerlukan perubahan global ke seluruh tema. Gunakan style yang terikat pada landing jika dibutuhkan penyesuaian khusus.

### 18.5 Bentuk dan kedalaman

Pertahankan kontrol sekitar radius 4 piksel dan panel sekitar 6 piksel sebagai titik awal bahasa bentuk Monday. Panel demo boleh mempunyai frame lebih jelas melalui border dan satu lapisan bayangan halus.

Gunakan kedalaman untuk memisahkan objek keputusan dari konteks pasar. Jangan memberi bayangan besar yang sama ke seluruh panel atau menambahkan glow pada semua elemen.

Ikon memakai keluarga Phosphor yang sudah terpasang. Logo Monday yang sudah ada dipertahankan. Diagram berfungsi menjelaskan alur dan bukan menjadi kumpulan ikon dekoratif.

### 18.6 Detail pembeda yang layak dikerjakan

1. Quote yang ditarik meninggalkan jejak posisi singkat sehingga pengguna memahami lokasi asalnya.
2. Caption menyebut tindakan yang benar benar terlihat pada tahap aktif.
3. Indikator tahap menunjukkan progres cerita tanpa berubah menjadi grafik performa.
4. Kartu keputusan masuk dengan alignment yang sama terhadap quote terkait.
5. Hover tombol hanya memberi respons lokal dan tidak mengubah komposisi seluruh hero.
6. Label sumber contoh tetap terlihat selama semua transisi.

Detail tersebut wajib tetap nyaman saat diam. Screenshot dari setiap tahap harus tetap bermakna tanpa pengguna melihat animasi sebelumnya.

## 19. Storyboard animasi per waktu

### 19.1 Sistem koordinat visual

Gunakan satu area adegan dengan tinggi stabil. Fair price menjadi referensi yang tetap. Quote beli dan jual memiliki identitas visual serta posisi yang dapat dilacak antar tahap.

Setiap objek mempunyai identitas yang stabil di dalam component tree. Jangan membongkar seluruh scene dan membuat ulang DOM saat pindah tahap karena transisi akan terlihat sebagai pergantian slide.

Urutan contoh berikut berdurasi total 15.000 milidetik sejak pemutaran dimulai. Waktu pembukaan hero tidak dihitung sebagai waktu demonstrasi.

### 19.2 Waktu 0 sampai 3.000 milidetik: Quote

1. Waktu 0: konteks harga dan label Example data sudah terlihat.
2. Waktu 0 sampai 350: kedua quote muncul dari perpindahan pendek sekitar 8 sampai 12 piksel menuju posisi akhirnya.
3. Waktu 350 sampai 800: label Buy quote dan Sell quote mencapai opacity penuh.
4. Waktu 800 sampai 3.000: visual diam agar pengguna membaca caption dan memahami dua sisi quote.

Tidak ada angka harga yang bergerak acak pada waktu diam. Adegan memperlihatkan konsep, bukan mensimulasikan feed live tanpa sumber.

### 19.3 Waktu 3.000 sampai 7.000 milidetik: Detect

1. Waktu 3.000 sampai 3.350: sinyal pembelian masuk pada area yang disediakan.
2. Waktu 3.350 sampai 3.750: penekanan visual berpindah dari kedua quote ke sinyal dan sisi jual yang terpapar.
3. Waktu 3.750 sampai 4.100: satu penghubung atau highlight menunjukkan hubungan sinyal dengan quote jual.
4. Waktu 4.100 sampai 7.000: scene diam dengan caption penjelasan.

Hindari kilatan merah berulang. Warna status digunakan secara konsisten dan tetap disertai teks.

### 19.4 Waktu 7.000 sampai 11.000 milidetik: Step aside

1. Waktu 7.000 sampai 7.200: quote jual diberi state Withdrawn.
2. Waktu 7.200 sampai 7.600: objek quote tersebut memudar atau bergerak pendek keluar dari posisi aktif.
3. Waktu 7.600 sampai 8.000: referensi posisi sebelumnya tetap terlihat sebagai jejak samar, lalu stabil.
4. Waktu 8.000 sampai 11.000: bid, fair price, dan caption tetap diam.

Jangan mengubah seluruh order book menjadi kosong. Pengguna harus mengetahui bahwa hanya quote milik Monday yang sedang dijelaskan.

### 19.5 Waktu 11.000 sampai 15.000 milidetik: Explain

1. Waktu 11.000 sampai 11.400: kartu keputusan muncul dengan perpindahan pendek.
2. Waktu 11.400 sampai 11.800: alasan dan label Example record terlihat sepenuhnya.
3. Waktu 11.800 sampai 15.000: adegan tetap diam untuk dibaca.
4. Waktu 15.000: state menjadi completed dan aksi Replay tersedia. Adegan tidak kembali ke awal sendiri.

Jika pengguna memilih tahap Explain secara langsung, tampilkan keadaan final yang lengkap tanpa harus memutar ulang tahap sebelumnya.

### 19.6 Perpindahan manual

Klik tahap selalu menuju snapshot tahap yang dapat dipahami. Transisi manual sekitar 180 sampai 250 milidetik, dengan caption langsung menunjukkan tujuan baru.

Snapshot logis tujuan berlaku pada saat pilihan diterima. Gerakan singkat hanya memperhalus perpindahan posisi atau opacity; ia tidak boleh membuat quote yang sudah berstatus Withdrawn tetap terlihat sebagai quote aktif. Dalam perpindahan otomatis, perubahan caption mengikuti event semantik yang dijadwalkan pada storyboard.

Memilih Detect setelah Explain harus mengembalikan kedua quote dan menghapus kartu keputusan yang belum terjadi pada tahap itu. Memilih Quote menghapus highlight burst. State visual tidak boleh menyisakan elemen dari tahap sebelumnya yang tidak relevan.

### 19.7 Pause saat transisi sedang berjalan

Pause membekukan progres yang sedang terlihat. Resume melanjutkan sisa durasi, tanpa memainkan dua timeline sekaligus. Jika library tidak dapat membekukan efek tertentu secara andal, ubah efek itu menjadi transisi yang lebih sederhana.

Jangan mengartikan Pause sebagai reset ke awal tahap. Jangan mengubah teks tahap lebih cepat daripada objek sehingga caption menyebut quote sudah ditarik ketika quote masih aktif.

### 19.8 Kualitas yang harus dinilai pada rekaman

Periksa gerakan dalam kecepatan normal serta replay lambat. Cari lompatan posisi, objek yang muncul dua kali, caption terlambat, perubahan tinggi panel, dan frame yang memperlihatkan data contoh tanpa label.

Durasi yang presisi tidak cukup untuk menyebut animasi berkualitas. Hasil harus menunjukkan kontinuitas objek dan waktu baca yang memadai.

## 20. Kontrak state dan event demonstrasi

### 20.1 Bentuk state usulan

Contoh berikut adalah kontrak desain untuk implementasi, bukan kode yang sudah dipasang atau diuji pada aplikasi.

~~~ts
type DemoStage = 'quote' | 'detect' | 'withdraw' | 'explain';
type PlaybackStatus = 'ready' | 'playing' | 'paused' | 'completed';
type PauseReason = 'user' | 'manualStage' | 'viewport' | 'documentHidden' | 'reducedMotion' | null;

type DemoState = {
  stage: DemoStage;
  status: PlaybackStatus;
  elapsedMs: number;
  autoStarted: boolean;
  autoEligible: boolean;
  pauseReason: PauseReason;
  intersectionRatio: number;
  visible: boolean;
  documentVisible: boolean;
  reducedMotion: boolean;
};
~~~

elapsedMs pada state adalah snapshot ketika event bermakna terjadi. Progres per frame tetap di luar pembaruan React state. Nilai waktu keseluruhan harus dibatasi antara 0 dan 15.000.

autoEligible dimulai true dan menjadi false setelah interaksi tahap, Play, Pause, atau Replay manual. autoStarted menandai autoplay yang sudah pernah berjalan. Keduanya mempunyai fungsi berbeda: pengguna yang memilih tahap sebelum autoplay dimulai tidak boleh tiba tiba kehilangan pilihannya ketika ambang viewport tercapai.

visible menunjukkan bahwa ada bagian adegan yang dapat dilihat, sedangkan intersectionRatio menentukan ambang autoplay dan penghentian. Jangan mengartikan visible hanya sebagai ambang 60 persen karena itu akan membuat Play manual tidak bekerja pada layar pendek.

### 20.2 Event yang perlu ditangani

1. ENTER_VIEW: memperbarui rasio serta visibilitas dan dapat memulai autoplay pertama kali bila status ready, autoEligible true, autoStarted false, dan syarat lain terpenuhi.
2. LEAVE_VIEW: menghentikan pemutaran yang aktif dan menyimpan progres.
3. PLAY: memulai dari ready atau melanjutkan paused jika adegan terlihat serta tab aktif.
4. PAUSE: menyimpan progres dan menandai pilihan pengguna.
5. SELECT_STAGE: mengganti tahap, menyusun ulang scene secara deterministik, dan menghentikan autoplay.
6. NEXT_STAGE dan PREVIOUS_STAGE: menuju tahap yang valid tanpa keluar rentang.
7. REPLAY: mengatur progres kembali ke nol lalu memainkan sesuai preferensi gerakan.
8. DOCUMENT_HIDDEN: menghentikan pemutaran aktif.
9. DOCUMENT_VISIBLE: memperbarui ketersediaan tab tanpa melanjutkan demo yang paused secara otomatis.
10. REDUCED_MOTION_CHANGED: mematikan pemutaran otomatis dan efek besar ketika preferensi diaktifkan.
11. FINISHED: mempertahankan tahap Explain dan status completed.
12. DISPOSE: menghentikan seluruh pekerjaan yang dimiliki instance.

ENTER_VIEW dan perubahan rasio tidak hanya dipanggil saat melewati ambang 60 persen. Observer juga harus menyediakan perubahan yang diperlukan untuk mendeteksi ambang penghentian dan keadaan sepenuhnya di luar viewport.

### 20.3 Urutan prioritas event

Penghentian karena tab tersembunyi, keluar viewport, atau reduced motion menang atas callback timer yang tiba bersamaan. PAUSE dari pengguna tidak boleh ditimpa oleh ENTER_VIEW.

REPLAY dari pengguna boleh menghapus alasan pause lama, tetapi tidak boleh melewati reduced motion atau memulai kerja visual pada tab yang tersembunyi.

Untuk baseline ini, setiap pemutaran yang paused tetap menunggu Resume, termasuk pause akibat viewport atau tab tersembunyi. Masuk kembali hanya memperbarui visibilitas. Kebijakan ini menyederhanakan prioritas dan mencegah perubahan tahap saat pengguna baru kembali membaca.

Jangan menyimpan flags auto, paused, playing, dan finished yang saling bertentangan. Satu status utama harus cukup untuk menentukan label tombol.

### 20.4 Aturan batas viewport

Gunakan threshold masuk sekitar 60 persen dan threshold keluar sekitar 20 persen untuk mengurangi pergantian state berulang di tepi viewport. Nilai ini boleh disesuaikan setelah uji layar pendek.

Untuk layar dengan tinggi yang tidak memungkinkan 60 persen panel terlihat sekaligus, autoplay boleh tidak berjalan. Kontrol Play manual tetap tersedia. Jangan menurunkan seluruh aturan visibilitas hanya agar autoplay selalu dipaksakan.

Play manual diizinkan bila sedikitnya sekitar 20 persen adegan terlihat, tab aktif, dan reduced motion tidak aktif. Jika kontrol tersedia tetapi adegan kurang terlihat, gulirkan adegan ke posisi yang sesuai dengan preferensi gerakan lalu evaluasi kembali. Ketika rasio turun di bawah 20 persen, pause berlaku juga untuk pemutaran manual. Rasio tepat nol selalu menghentikan pemutaran.

### 20.5 State awal dan hydration

Server dan render client pertama menampilkan tahap Quote dengan label ilustrasi yang sama. Hindari membaca viewport, localStorage, atau angka acak untuk menghasilkan markup awal yang berbeda.

Preferensi gerakan dipakai setelah tersedia tanpa menyembunyikan isi awal. Keadaan belum mengetahui preferensi bukan alasan menjalankan autoplay segera.

Mount ulang pada development tidak boleh membuat dua timer atau dua observer aktif. Navigasi kembali ke landing boleh membuat instance demo baru; tidak perlu menyimpan progres cerita ke server atau localStorage.

### 20.6 Kontrak UI kontrol

1. ready menampilkan Play demo.
2. playing menampilkan Pause demo.
3. paused menampilkan Resume demo jika melanjutkan animasi diizinkan.
4. completed menampilkan Replay demo.
5. reduced motion menampilkan kontrol tahap manual; pilihan Replay mengembalikan tahap Quote tanpa memulai autoplay.
6. Pada tahap pertama, Previous nonaktif atau tidak ditampilkan sesuai layout yang konsisten.
7. Pada tahap terakhir, Next nonaktif; Replay tetap tersedia.

Status pada kontrol tidak boleh menggunakan kata Start quoting karena itu adalah aksi trading di aplikasi. Gunakan istilah demo untuk menjaga konteks.

## 21. Kontrak data publik dan normalisasi Evidence

### 21.1 Endpoint yang sudah tersedia

Source saat pemeriksaan menyediakan GET /api/config, GET /api/evidence, serta GET /api/public/preview. useLive public juga membuka stream publik melalui WebSocket. Demonstrasi fixture tidak memerlukan endpoint tersebut.

AppConfig menyediakan networkName, realFunds, sim, paper, smartMoney, registry, explorerUrl, serta spesifikasi market. Gunakan field yang benar untuk masing masing konteks; keberadaan explorerUrl tidak membuktikan suatu keputusan sudah tercatat.

GET /api/evidence dapat mengembalikan objek pending atau Evidence. Response harus diperiksa pada batas data sebelum dipakai oleh komponen tampilan.

### 21.2 Arti field Evidence yang sudah ada

1. at adalah waktu hasil Evidence dihitung. Ini bukan tanggal awal dataset.
2. synthetic menunjukkan hasil menggunakan data simulasi pada sumber yang menentukan flag tersebut.
3. smartMoneySource dan priceSource menjelaskan sumber informasi yang dipakai studi.
4. lagMs berhubungan dengan lag data yang dipakai dalam penyelarasan studi. Ini tidak boleh dipakai sebagai penghitung usia response tanpa memahami artinya.
5. studies berisi studi per market dan dapat tidak memiliki BTC.
6. replays berisi hasil replay per market dengan from dan to masing masing.
7. policy adalah konfigurasi yang dipakai pada hasil tersebut, bukan policy pengguna yang sedang membuka landing.

EventStudy mempunyai samples, grid, deciles, hit, dan skewEnabled. Sampel pada grid untuk window serta horizon tertentu berasal dari grid.n. Jangan menukar grid.n dengan samples hanya karena salah satunya lebih besar.

### 21.3 Periode penelitian

Implementasi computeEvidence meminta rentang sekitar tujuh hari dan melakukan penyelarasan candle. Rentang permintaan tidak membuktikan setiap menit berisi observasi asli yang lengkap.

EventStudy saat ini tidak menyediakan from dan to secara langsung. Replay mempunyai from serta to untuk simulasi replaynya. Jangan menggunakan periode replay sebagai periode event study tanpa memastikan kesetaraannya.

Scope awal yang aman adalah menampilkan Computed beserta waktu at dan sumber data. Jika ingin menampilkan rentang penelitian lengkap, tambahkan metadata yang benar melalui perubahan API yang teruji. Jangan mengarang start time dengan mengurangi tujuh hari dari waktu sekarang pada client.

### 21.4 Pemeriksaan nilai sebelum render

1. Pastikan response merupakan objek dengan field yang dibutuhkan, bukan HTML error atau null.
2. Periksa bahwa studies memiliki setidaknya satu market dengan struktur yang dapat dibaca.
3. Cari kombinasi window 15 dan horizon 15 secara eksplisit. Jika tidak ada, tampilkan bahwa metrik utama belum tersedia.
4. rho harus finite dan berada dalam rentang korelasi yang valid. lo serta hi harus finite dan mempunyai urutan yang benar.
5. n harus berupa bilangan bulat finite yang tidak negatif. Jangan menampilkan korelasi sebagai hasil valid jika n sama dengan nol, atau menarik kesimpulan ketika metode server tidak menghasilkan metrik yang valid. Kebutuhan minimum sampel metodologis harus mengikuti implementasi studi, bukan angka baru yang dikarang frontend.
6. hit.rate hanya dipakai jika finite, berada pada rentang 0 sampai 1, dan hit.n lebih dari nol.
7. deciles diperiksa satu per satu. Entri yang tidak valid tidak diberi nilai nol sebagai pengganti.
8. Timestamp yang tidak valid tidak ditampilkan sebagai Invalid Date. Gunakan keterangan waktu belum tersedia.

Validasi ini menjaga tampilan terhadap response parsial. Ia tidak mengganti validasi atau metodologi statistik server.

### 21.5 Model tampilan yang disarankan

Pisahkan tiga dimensi: status request, ketersediaan isi, dan sumber data.

~~~ts
type EvidenceTransport = 'idle' | 'loading' | 'success' | 'error';
type EvidenceAvailability = 'pending' | 'partial' | 'ready';
type EvidenceOrigin = 'observed' | 'synthetic' | 'unknown';

type EvidencePreview = {
  transport: EvidenceTransport;
  availability: EvidenceAvailability;
  origin: EvidenceOrigin;
  market: 'BTC' | 'ETH' | 'SOL' | null;
  computedAt: number | null;
  correlation: number | null;
  interval: { low: number; high: number } | null;
  correlationSamples: number | null;
  sameDirection: { rate: number; events: number } | null;
  sourceLabels: string[];
};
~~~

Model ini adalah usulan client, bukan schema baru yang sudah tersedia pada API. Tambahkan error atau data lama bila diperlukan tanpa mencampurnya menjadi satu string none.

Gunakan tipe MarketSym dari paket inti pada implementasi agar daftar market tidak mempunyai dua sumber kebenaran. origin observed hanya boleh ditetapkan dari metadata yang telah divalidasi, bukan karena field synthetic hilang. Response tanpa penanda sumber yang memadai tetap unknown.

Komponen tampilan menerima hasil normalisasi. Hindari mengulang pencarian grid dan pemeriksaan null di setiap angka.

### 21.6 Interpretasi hasil

Jika interval mencakup nol, copy dapat menyatakan bahwa sampel ini belum menunjukkan hubungan arah yang jelas. Jika interval berada di satu sisi nol, jelaskan hubungan dalam sampel tersebut tanpa mengubahnya menjadi janji kemampuan prediksi atau profit.

Tampilkan skewEnabled hanya bila perlu menjelaskan keputusan engine yang dilaporkan server. Jangan menghitung aturan trading baru pada landing berdasarkan satu nilai korelasi.

Metrik hit adalah kesamaan arah setelah suatu kejadian pada studi. Label usulan adalah “Same direction after a signal”, dengan jumlah kejadian di dekat persentase. Jangan menggantinya menjadi Win rate atau Success rate.

Source yang diperiksa menghitung hit dari sinyal window 5 menit yang melewati ambang kekuatan, dengan return 15 menit sesudahnya. Korelasi utama memakai window 15 menit dan horizon 15 menit. Jelaskan konteks tersebut dalam detail singkat; jangan mengesankan keduanya memakai populasi kejadian yang sama. Gunakan label Samples untuk jumlah observasi korelasi, tanpa menjanjikan bahwa pemilihan sampel menghapus seluruh ketergantungan statistik.

Jika synthetic true, interpretasi pertama harus menjelaskan data simulasi. Nilai yang menarik tetap tidak dianggap sebagai bukti keuntungan live.

### 21.7 Request, retry, dan response lama

Mulai request Evidence ketika section mendekati viewport, misalnya sekitar 600 piksel sebelumnya, atau gunakan fetch server yang sesuai arsitektur deployment. Pilih satu pola dan hindari request ganda yang tidak diperlukan.

Timeout tampilan awal yang disarankan sekitar 10 detik. Setelah itu, tampilkan state gagal memuat dengan Retry. Jika request masih hidup, batalkan atau tandai versinya agar response lama tidak menimpa retry yang lebih baru.

Retry dilakukan atas tindakan pengguna atau aturan terbatas yang jelas. Tidak ada polling cepat untuk studi yang diperbarui dengan cadence jauh lebih lambat daripada harga pasar.

Jika hasil lama tetap ditampilkan ketika refresh gagal, sebutkan bahwa hasil terakhir sedang ditampilkan dan tunjukkan waktu perhitungannya. Jangan menghapus hasil yang valid hanya untuk menggantinya dengan skeleton berulang.

## 22. Copy siap pakai dan aturan substitusi

Semua copy berikut adalah usulan untuk implementasi dan harus diverifikasi terhadap konfigurasi final. Variabel dalam kurung kurawal adalah placeholder data yang harus diisi dari sumber yang benar, bukan teks yang ditampilkan mentah.

### 22.1 Hero

Headline: “Market making that reacts.”

Deskripsi: “Monday quotes on Perpl, reacts to smart money, and records decisions on Monad.”

CTA utama: “Launch app”. CTA sekunder: “See how it works”.

Jika integrasi pencatatan tidak tersedia pada deployment, deskripsi dapat memakai versi netral: “Monday quotes on Perpl and adjusts its orders as market signals change.” Informasi Monad tetap dapat dijelaskan sebagai kemampuan arsitektur dengan status konfigurasi yang jujur.

Jangan mengganti headline berdasarkan harga live atau hasil profit pengguna. Pesan produk harus stabil.

### 22.2 Demonstrasi

Label panel: “Interactive demo”. Label sumber: “Example data”.

Tahap Quote: “Monday places buy and sell quotes around its estimate of fair price.”

Tahap Detect: “A strong buying signal changes the risk of keeping the sell quote open.”

Tahap Step aside: “Monday pulls the exposed quote while it reassesses the market.”

Tahap Explain: “The decision includes a reason and evidence that can be checked.”

Catatan waktu: “This sequence is simplified. Actual timing depends on data, execution, and network confirmation.”

Kontrol: “Play demo”, “Pause demo”, “Resume demo”, “Replay demo”, “Previous step”, dan “Next step”. Nama aksesibel kontrol boleh memuat nama tahap tujuan, misalnya “Next step: Detect”.

### 22.3 Integrasi

Perpl: “Trading execution in your Perpl account.”

Nansen: “Market intelligence from labelled smart money activity.”

Monad: “Policy publication and verifiable decision records.”

Jangan menyebut semua aktivitas tersebut terjadi langsung di browser. Tidak perlu menampilkan jargon API, WebSocket, signer, atau private key pada bagian pemasaran ini.

### 22.4 How to start

Langkah pertama: “Connect your account.” Penjelasan: “Set up your Perpl account connection and a key with the required trading permissions.”

Langkah kedua: “Set your limits.” Penjelasan: “Choose markets, position limits, and a daily loss trigger before trading starts.”

Langkah ketiga: “Start Monday.” Penjelasan: “Review your settings, complete any required wallet steps, and start quoting when you are ready.”

Tautan bawah opsional: “Open the app to get started”, menuju /app. Bila sudah ada CTA berdekatan, tautan ini tidak perlu ditambahkan.

### 22.5 Controls and custody

Judul: “Your account. Your limits. Your controls.”

Penjelasan: “Set the bot's trading limits and keep access to your funds through Perpl.”

Label contoh: “Example settings”. Field: “Market”, “Base quote per side”, “Position limit”, “Daily loss trigger”, dan “Leverage limit”.

Catatan contoh: “Actual settings depend on your balance, market rules, and server limits.”

Catatan risiko: “Loss triggers initiate protective actions. Execution can exceed the configured amount.”

Copy Stop: “Stops Monday's quoting and cancels its orders. Open positions remain in your account.”

Copy Kill: “Attempts to cancel orders and close positions. Completion depends on the venue.”

Jika cakupan kill mencakup seluruh order dan posisi akun seperti implementasi yang diperiksa, konteks itu harus tersedia dalam penjelasan lengkap atau FAQ. Jangan mengesankan kill hanya berlaku pada ilustrasi BTC yang sedang dilihat.

### 22.6 Evidence

Judul: “See what the data supports.”

Loading: “Loading the latest study.”

Pending: “The study is not available yet.” Jangan menyatakan penyebabnya pasti kekurangan data jika response hanya menyediakan pending true tanpa alasan.

Error: “We could not load the study. You can try again or open the Evidence page.”

Partial: “Some results are available. The summary metric is not available for this dataset.”

Synthetic: “Simulated data. These results demonstrate the analysis pipeline and do not establish live trading performance.”

Interpretasi saat interval mencakup nol: “This sample does not show a clear directional relationship.”

Keterangan waktu: “Computed {date} at {time} {timezone}.”

CTA: “Read the evidence”, menuju /evidence. Retry adalah tombol request ulang, bukan link ke route yang sama jika perilakunya berbeda.

### 22.7 Live preview

Pemicu: “View live market data”. Setelah terbuka: “Hide live market data”.

Loading: “Connecting to market data.”

Tidak tersedia: “Live market data is unavailable. The interactive demo is still available above.”

Book only: “Market data only. This preview does not show your bot's orders.”

Stale atau terputus: “Showing the last update from {time}. Prices may be out of date.”

Paper atau simulasi harus memakai label yang secara eksplisit membedakan harga nyata dari order simulasi. Jangan memakai satu badge Live untuk seluruh kombinasi tersebut.

### 22.8 FAQ lengkap

Pertanyaan: “What do I need to use Monday?”

Jawaban: “You need a compatible Perpl account and the connection steps shown in the app. Available markets and funding requirements depend on the deployment and your account.”

Pertanyaan: “Where are my funds held?”

Jawaban: “Your funds remain in your Perpl account. Monday uses a trading key to operate the bot. You manage withdrawals through Perpl.”

Pertanyaan: “Can Monday lose money?”

Jawaban: “Yes. Market making involves inventory, execution, and market risk. Signals can be wrong or late, and loss triggers do not guarantee the final loss amount.”

Pertanyaan: “What is the difference between Stop and Kill?”

Jawaban: “Stop cancels Monday's orders and leaves open positions for you to manage. Kill attempts to cancel orders and close positions across the account. Closing may take time or fail while the venue is unavailable.”

Pertanyaan: “What happens if the connection fails?”

Jawaban: “Monday has checks for stale data and connection failures. A lost connection can delay cancellation or closing. Check the app's status and use Perpl directly when needed.”

Pertanyaan: “What is recorded on Monad?”

Jawaban: “When the registry is configured, your wallet publishes a policy and the agent can record hashes of decisions and their evidence. Publication, confirmation, and logging are shown as separate states.”

FAQ tersebut perlu pemeriksaan akhir terhadap engine terbaru sebelum diterbitkan. Jangan mengubahnya menjadi jaminan layanan yang tidak didukung.

### 22.9 CTA akhir dan metadata

Headline CTA akhir: “Set your limits. Put Monday to work.”

Tombol: “Launch app”. Tidak perlu menambahkan estimasi profit atau janji onboarding beberapa detik.

Title usulan: “Monday | Adaptive market making on Perpl”. Description usulan: “Automated market making on Perpl with configurable limits, smart money signals, and decision records on Monad.” Sesuaikan klaim pencatatan terhadap kemampuan produk yang memang tersedia.

Preview sosial harus menggunakan aset final yang dibuat dan diperiksa. Jangan menunjuk placeholder yang menghasilkan 404.

## 23. Kontrak interaksi dan navigasi

### 23.1 Launch app

Gunakan link navigasi normal ke /app. Landing tidak perlu menentukan apakah pengguna sudah onboarding, membuka wallet modal, atau menyalakan bot. Shell aplikasi yang sudah ada menangani konteks akun.

Klik tengah, buka tab baru, serta navigasi keyboard tetap bekerja. Jangan mengubah link menjadi div dengan onClick. Jangan menampilkan status “Trading started” hanya karena navigasi berhasil.

### 23.2 See how it works

Tujuan adalah anchor #how pada demonstrasi yang sama. Scroll mengikuti preferensi gerakan. Setelah aktivasi keyboard, fokus dapat diarahkan ke judul demonstrasi yang sesuai tanpa melompat ke tombol trading lain.

Navigasi menuju #how tidak otomatis mengulang demo yang sudah selesai. Tampilkan Replay jika pengguna ingin mengulang. Jika belum pernah dimainkan dan syarat autoplay terpenuhi, aturan pertama kali tetap berlaku.

### 23.3 Menu mobile

Gunakan pola disclosure sederhana di bawah header sebagai baseline. Toggle mempunyai label Open menu atau Close menu serta state expanded. Daftar link memakai elemen nav biasa.

Baseline ini tidak memerlukan focus trap seperti modal karena konten halaman tetap tersedia. Jika agent memilih drawer modal sebagai variasi, implementasikan focus trap, inert pada background, penguncian scroll, dan pengembalian fokus secara lengkap. Jangan mencampur setengah perilaku disclosure dengan setengah perilaku modal.

Link anchor menutup menu setelah dipilih. Escape menutup dan mengembalikan fokus ke toggle. Ketika viewport berpindah ke desktop, menu mobile tidak boleh meninggalkan body terkunci atau fokus berada dalam elemen tersembunyi.

### 23.4 Theme control

Pertahankan mekanisme tema yang sudah digunakan produk. Komponen baru membaca token halaman, tidak menyimpan tema kedua di dalam demo.

Pergantian tema tidak mereset tahap, memulai ulang autoplay, atau mengubah sumber data. Label, chart opsional, dan status selected harus tetap terbaca setelah tema berubah.

### 23.5 FAQ

Klik seluruh judul pertanyaan membuka atau menutup jawabannya. Fokus tetap pada tombol pertanyaan. Jika ada animasi tinggi, isi tidak boleh terpotong saat font selesai dimuat atau pengguna memperbesar teks.

Link di dalam jawaban tetap dapat difokuskan. Status terbuka tidak perlu disimpan ke server atau localStorage.

### 23.6 Link bukti dan sumber

Read the evidence menuju /evidence. GitHub menuju repositori yang disebut dalam dokumen. Link explorer hanya memakai explorerUrl yang sesuai dan hash transaksi yang telah diketahui valid.

Jika membuka link eksternal di tab baru, beri penanda aksesibel. Jika bukti transaksi belum tersedia, tampilkan teks bahwa contoh transaksi belum disertakan, atau hilangkan link tersebut. Jangan membuat tombol nonaktif tanpa alasan.

### 23.7 Live preview opsional

Pemicu expand harus terlihat sebagai pilihan melihat data pasar. Membukanya memuat komponen dan koneksi milik preview; menutupnya membersihkan koneksi tersebut.

Saat preview terbuka, pengguna masih dapat kembali membaca demo tanpa kehilangan posisi scroll secara besar. Tinggi awal preview dicadangkan secukupnya. Jangan membuka area lebih tinggi dari beberapa layar tanpa memberi cara menutup yang mudah ditemukan.

## 24. Arsitektur komponen dan batas dependensi

### 24.1 Struktur yang disarankan

~~~text
LandingPage
  SiteHeader
    MobileNavigation
  LandingHero
    HeroCopy
    ProductDemo
      DemoScene
      DemoCaption
      DemoControls
  IntegrationRoles
  GettingStarted
  ControlsAndCustody
  LandingEvidence
  OptionalLivePreview
  LandingFAQ
  FinalCTA
  SiteFooter
~~~

Nama ini memetakan tanggung jawab. Hindari membuat komponen terlalu kecil hanya untuk satu span atau terlalu besar sehingga semua request dan timer berada pada satu file.

### 24.2 Pemisahan server dan client

Susunan halaman, copy, dan konten statis dapat tetap dirender server. ProductDemo mengelola interaksi lokal. LandingEvidence mengelola request serta normalisasi hasil jika memilih pola client fetch. Live preview menjadi bagian yang dimuat sesuai kebutuhan.

Jangan mengimpor provider wallet dari lib/wallet hanya untuk mengambil config publik. Modul tersebut membawa kebutuhan aplikasi terautentikasi. Gunakan akses config publik yang ringan dan sesuai pola existing.

Jika config dipakai beberapa bagian landing, deduplikasi request melalui satu pemilik data yang sempit atau mekanisme cache yang sudah tersedia. Jangan menambahkan provider besar ke root hanya untuk dua label.

### 24.3 Dependensi yang perlu dijaga

ProductDemo tidak mengimpor PriceChart, modul analytics, library wallet, atau useLive. Demo menerima fixture dan state lokal.

LandingEvidence dapat menggunakan komponen visual ringan tanpa membawa seluruh terminal. Jika SignedBars mempunyai dependensi yang lebih luas dari kebutuhan ringkasan, evaluasi pemisahan modul tampilan yang relevan.

OptionalLivePreview boleh memakai komponen pasar yang ada, tetapi baru setelah diminta pengguna. Pastikan module boundary benar benar menghasilkan pemuatan tertunda pada production build.

### 24.4 Prefetch navigasi

Bedakan dependensi landing dengan resource yang diprefetch untuk route tujuan. Link ke /app atau /analytics dapat memicu prefetch berdasarkan perilaku framework.

Ukur production build sebelum menyatakan chart masuk bundle landing. Jika prefetch route berat membebani pembukaan halaman, pertimbangkan menonaktifkan prefetch pada link tertentu atau memicunya saat ada intent. Jangan menonaktifkan semua optimasi navigasi tanpa pengukuran.

### 24.5 Interface demonstrasi

Fixture harus berada di modul yang tidak mengandung request jaringan. Scene menerima tahap serta progres visual dan tidak mengetahui status wallet atau sesi trading.

Kontrol mengirim event semantik ke satu pengelola state. Caption berasal dari definisi tahap yang sama dengan scene. Jangan menduplikasi indeks tahap dalam tiga useState yang terpisah.

### 24.6 Pencegahan hasil request yang terlambat

Setiap request Evidence mempunyai identitas atau mekanisme abort. Hanya request terbaru yang masih relevan dapat mengganti state. Unmount menandai response sebagai tidak relevan atau membatalkannya.

Retry tidak boleh membuat dua hasil bersaing. Loading setelah retry boleh mempertahankan data valid sebelumnya, dengan status pembaruan yang terpisah.

### 24.7 CSS khusus landing

Gunakan wrapper atau modul yang membatasi perubahan tipografi, spacing, dan animasi ke landing. Pertahankan ukuran terminal yang memang dirancang lebih padat.

Jika primitive bersama perlu ditambah variasi, pastikan variasi lama tetap sama. Contohnya ukuran tombol pemasaran dapat diperbesar melalui varian atau class lokal tanpa mengubah seluruh tombol aplikasi.

### 24.8 Pemilihan aset

Tetapkan rasio dan dimensi intrinsik gambar sebelum dimuat. Screenshot bukan background yang memotong informasi tanpa alt atau caption.

Rekaman produk bersifat opsional setelah demonstrasi utama berfungsi. Jika ditambahkan, gunakan poster, pemuatan tertunda, caption atau transkrip yang relevan, dan kontrol tanpa suara otomatis.

## 25. Fixture pengujian dan skenario yang dapat direproduksi

### 25.1 Cara menyiapkan lingkungan uji

Gunakan fixture lokal pada harness test atau intercept response browser. Jangan mengganti data server bersama, mengubah saldo, memulai bot, atau memalsukan bukti produksi untuk menguji landing. Fixture dan hasil screenshot pengujian harus diberi keterangan bahwa datanya merupakan contoh.

Siapkan delapan kelompok response berikut. Gunakan bentuk response aktual dari tipe proyek; daftar ini menjelaskan variasi yang harus dicakup, bukan schema API pengganti.

1. D01: Evidence valid untuk BTC. Sertakan cell window 15 dan horizon 15, jumlah observasi positif, interval yang melintasi nol, timestamp valid, serta sumber data yang diketahui. Contoh rho 0,06 dengan interval dari negatif 0,03 sampai positif 0,16 hanya merupakan angka fixture.
2. D02: Server mengembalikan pending true tanpa studies. Ini adalah data yang belum siap, bukan koneksi gagal.
3. D03: Response valid memiliki studies kosong, atau studi yang tersedia tidak mempunyai cell window 15 dan horizon 15. Tidak boleh terjadi exception karena asumsi bahwa find selalu menghasilkan object.
4. D04: Hanya market selain BTC yang valid. Nama market pada heading, caption, dan statistik harus mengikuti studi yang benar benar dipilih.
5. D05: Response valid dengan synthetic true. Semua komponen ringkasan harus mempertahankan keterangan data simulasi.
6. D06: Transport gagal, body tidak sesuai schema, nilai numerik null, rate di luar rentang, n sama dengan nol, atau timestamp tidak valid. Uji variasi ini secara terpisah agar penyebab kegagalan bisa diketahui.
7. D07: Request pertama lambat, request kedua cepat, lalu response pertama baru tiba. Data terbaru tidak boleh tertimpa response lama.
8. D08: Config publik berubah antara mode simulasi, paper, dan penggunaan dana nyata, serta smartMoney bernilai nansen, sim, atau none. Uji juga config gagal dimuat tanpa mengarang jaringan atau sumber data.

### T01. Pembukaan halaman dan awal pemutaran

1. Buka halaman baru dengan cache bersih pada 390 × 844 dan preferensi gerakan normal. Pastikan demo belum memenuhi ambang visibilitas jika posisinya masih di bawah lipatan layar.
2. Tunggu lima detik sebelum menggulir. Tahap tidak boleh maju jika syarat visibilitas belum terpenuhi.
3. Gulir hingga sedikitnya 60 persen demo terlihat. Demo mulai satu kali, label Example data tetap terlihat, dan kontrol Pause tersedia.
4. Gulir sedikit di sekitar ambang tanpa benar benar meninggalkan area. Pemutaran tidak boleh berulang kali memulai dari awal. Simpan rekaman sebagai bukti LP12 dan LP15.

### T02. Pause di tengah transisi dan kembali ke viewport

1. Jeda ketika quote sedang berubah pada perpindahan Detect ke Step aside. Ambil catatan tahap dan progres visual.
2. Gulir menjauh, kembali ke demo, pindah ke tab lain, lalu kembali. Demo tetap paused karena pengguna yang menjedanya.
3. Tekan Resume. Pemutaran melanjutkan progres yang tersimpan tanpa loncatan ke tahap terakhir atau dua timer berjalan bersamaan.
4. Jalankan juga versi pause otomatis akibat viewport. Kembalinya pengguna mengikuti aturan bagian 20 dan tidak boleh menimpa pilihan pause manual yang lebih baru.

### T03. Satu siklus selesai dan Replay

1. Biarkan pemutaran mencapai Explain. Tunggu sedikitnya sepuluh detik setelah selesai.
2. Scene tetap berada pada Explain dan tidak kembali ke Quote secara otomatis.
3. Tekan Replay sekali. Semua quote contoh, caption, progres, dan kartu alasan kembali ke state awal yang konsisten, lalu mengikuti aturan gerakan aktif.
4. Klik Replay berulang dengan cepat. Hanya satu pemutaran yang aktif; tidak ada percepatan, caption rangkap, atau callback lama yang mengubah tahap.

### T04. Navigasi tahap manual dan reduced motion

1. Pilih Explain, Quote, Step aside, lalu Detect dengan cepat melalui kontrol tahap. Visual akhir harus cocok dengan pilihan terakhir, termasuk quote yang perlu muncul kembali.
2. Aktifkan reduced motion saat pemutaran sedang berjalan. Gerakan berkelanjutan berhenti dan pengguna tetap dapat membaca serta memilih keempat tahap.
3. Tekan Replay dalam mode tersebut. Demo kembali ke tahap awal tanpa menyalakan autoplay.
4. Nonaktifkan reduced motion. Perubahan preferensi tidak boleh dianggap sebagai izin menghapus pilihan Pause pengguna. Periksa mode ini sejak halaman pertama kali dimuat juga.

### T05. Perubahan viewport, menu, dan tema

1. Buka menu pada 390 piksel, pindah ke lebar desktop, kemudian kembali ke mobile. Tidak ada overlay tertinggal, body terkunci, atau fokus tersimpan pada elemen tersembunyi.
2. Buka menu dengan keyboard lalu tekan Escape. Fokus kembali ke pemicu. Pilih Custody dan pastikan section tujuan terlihat di bawah header.
3. Ganti tema ketika demo berada pada Detect dan Evidence sudah terisi. Tahap, status pause, dan data tidak direset.
4. Periksa 360, 390, 430, 768, 1024, 1280, dan 1440 piksel. Simpan screenshot kedua tema pada ukuran representatif, bukan hanya satu desktop lebar.

### T06. Evidence lambat dan pending

1. Tunda response Evidence hingga beberapa detik. Placeholder mencadangkan ruang yang sesuai, sedangkan hero dan CTA tetap dapat digunakan.
2. Kembalikan D02. Teks berubah dari pesan loading menjadi keterangan studi belum tersedia, tanpa menebak penyebabnya, memberi label koneksi gagal, atau menampilkan angka nol rekaan.
3. Ulangi dengan response melampaui batas waktu request. Tampilkan state gagal dan tindakan Retry sesuai kontrak request.
4. Retry yang berhasil harus mengganti pesan tersebut tanpa menggandakan kartu statistik atau menggeser seluruh halaman secara besar.

### T07. Evidence parsial dan market selain BTC

1. Jalankan D03 dengan grid kosong, kemudian dengan grid yang hanya memiliki pasangan window dan horizon lain.
2. Tidak ada crash, NaN, undefined, atau angka korelasi yang diambil dari cell yang salah.
3. Jalankan D04. Semua nama market dan interpretasi mengikuti market yang tersedia. Jangan menampilkan heading BTC di atas data market lain.
4. Jika ada informasi valid selain korelasi, tampilkan sebagai informasi parsial dengan label jelas. Ketiadaan satu cell tidak harus membuang seluruh studi.

### T08. Kejujuran statistik dan simulasi

1. Jalankan D01 dengan interval yang melintasi nol. Penjelasan tidak menyebut sinyal terbukti menguntungkan atau arah hubungan yang sudah pasti.
2. Jalankan D05. Label synthetic atau simulated mudah terlihat sebelum pengguna menafsirkan statistik.
3. Uji hit.n nol, hit.rate null, dan rate di luar rentang dengan variasi D06. Statistik terkait dinyatakan tidak tersedia, bukan 0 persen atau nilai yang dipaksa masuk rentang.
4. Hilangkan metadata periode. Halaman tidak menulis seven days hanya karena implementasi collector pernah meminta rentang tersebut.

### T09. Error, Retry, dan response yang datang terlambat

1. Jalankan D07. Mulai request A, picu request B melalui jalur retry atau refresh yang memang tersedia pada implementasi, lalu selesaikan B sebelum A.
2. Hasil B tetap menjadi tampilan akhir meskipun A datang belakangan. Jika A dibatalkan, pembatalannya tidak ditampilkan sebagai error baru kepada pengguna.
3. Navigasi keluar halaman ketika request masih berlangsung. Penyelesaian request tidak memperbarui komponen yang sudah dilepas atau memunculkan pesan pada halaman lain.
4. Jika data valid sebelumnya dipertahankan ketika refresh gagal, timestamp dan label status harus menjelaskan bahwa pembaruan gagal. Data lama tidak boleh diberi waktu pembaruan baru.

### T10. Config dan keterangan jaringan

1. Jalankan seluruh variasi D08. Peran Nansen tidak ditampilkan sebagai sumber live ketika config menyatakan sim atau none.
2. Jika registry tidak tersedia, jangan menyebut contoh reason card sebagai record Monad yang telah dikonfirmasi.
3. Jika config gagal, tampilkan penjelasan netral sesuai fallback yang ditetapkan. Jangan menebak mainnet, testnet, atau keadaan dana.
4. Bedakan label Example data milik demo dengan status dana milik deployment. Pengunjung harus dapat melihat bahwa demo berupa ilustrasi meskipun aplikasi tujuan dapat memakai dana nyata.

### T11. Live preview opsional dan pembersihan koneksi

1. Buka halaman dan catat koneksi sebelum menyentuh live preview. Tidak ada koneksi WebSocket publik yang dibuat oleh demo.
2. Buka preview, tutup, lalu buka lagi sebanyak tiga kali. Jumlah koneksi aktif tidak bertambah secara kumulatif.
3. Putuskan jaringan ketika preview terbuka. Status stale atau disconnected mengikuti sumber data dan tidak menyebut bot pengguna aktif.
4. Tutup preview ketika mekanisme reconnect sedang menunggu. Tidak ada reconnect baru setelah komponen dilepas. Jika preview tidak termasuk implementasi akhir, catat skenario ini sebagai tidak berlaku disertai alasannya.

### T12. Keyboard, pembaca layar, dan teks yang membesar

1. Gunakan Tab, Shift Tab, Enter, Space, dan Escape tanpa mouse. Urutan fokus mengikuti urutan baca yang masuk akal.
2. Pastikan fokus terlihat pada kedua tema. Caption demo, tombol, dan FAQ mempunyai nama serta state aksesibel.
3. Jalankan pembaca layar pada satu siklus demo. Setiap perubahan angka tidak boleh dibacakan sebagai pengumuman baru.
4. Perbesar tampilan hingga 200 persen dan, jika perangkat mendukung, perbesar teks secara terpisah. Kontrol tidak saling menimpa, jawaban FAQ tidak terpotong, dan tidak ada informasi inti yang hanya tersedia melalui hover.

### T13. JavaScript gagal dan font terlambat

1. Buka halaman dengan JavaScript dinonaktifkan. Headline, deskripsi, link Launch app, dan penjelasan inti produk tetap tersedia sebagai konten server.
2. Kontrol interaktif tidak boleh tampak siap digunakan jika tidak mempunyai perilaku. Sediakan representasi statis yang wajar untuk demo.
3. Perlambat pemuatan font, lalu aktifkan kembali JavaScript. Headline, caption, dan tombol tidak bertabrakan ketika font final masuk.
4. Jika FAQ memakai elemen native, jawabannya tetap bisa diakses tanpa hydration. Jika memakai kontrol client, pastikan informasi pokok tidak hanya terkunci di dalamnya.

### T14. Anchor, link, dan perpindahan route

1. Buka URL langsung dengan #how dan #custody. Setelah font serta layout siap, judul tujuan tetap terbaca di bawah sticky header.
2. Klik Launch app, buka link tersebut di tab baru, lalu gunakan Back. Tidak ada aksi trading atau wallet signature yang dipicu oleh landing.
3. Kunjungi /evidence dan repositori dari link yang disediakan. Pastikan tujuan benar dan tidak ada placeholder.
4. Periksa header, footer, dan metadata pada halaman publik lain setelah perubahan komponen bersama.

### T15. Performa pada kondisi yang dicatat

1. Jalankan production build dan catat profil perangkat, browser, jaringan, CPU, viewport, serta keadaan cache.
2. Rekam pembukaan halaman, satu siklus demo, pause, perpindahan keluar viewport, dan klik menu mobile.
3. Bandingkan request awal dengan request setelah preview dibuka. Identifikasi resource berdasarkan initiator agar prefetch route tidak keliru dianggap sebagai import wajib hero.
4. Simpan nilai mentah serta trace. Laporkan angka sebagai hasil pengujian pada profil tersebut, bukan jaminan untuk semua pengunjung.

### T16. Regresi aplikasi dan pemahaman pengguna baru

1. Periksa onboarding, dashboard, Policy, Analytics, dan Evidence setelah perubahan shared UI. Gunakan pemeriksaan yang tidak memulai trading atau mengubah konfigurasi akun.
2. Pastikan ukuran tombol terminal, warna status, koneksi dashboard, dan navigasi sebelumnya tetap berfungsi sesuai baseline.
3. Jika tersedia, minta tiga pembaca baru melihat landing selama sekitar tiga puluh detik, kemudian menjelaskan fungsi produk, peran integrasi, arti demo, risiko, dan langkah berikutnya tanpa petunjuk.
4. Catat jawaban asli dan bagian yang membingungkan. Jumlah peserta ini merupakan pemeriksaan formatif kecil, bukan bukti statistik. Jika tidak ada peserta, tandai belum diuji; jangan mengganti uji pengguna dengan penilaian agent sendiri.

## 26. Protokol pengukuran dan penilaian kualitas

### 26.1 Baseline yang dapat dibandingkan

Simpan baseline dari kondisi kode sebelum implementasi landing, termasuk perubahan lokal yang sudah ada. Membandingkan hasil dengan commit HEAD saja dapat menyesatkan karena working tree sudah mempunyai perubahan. Gunakan snapshot yang tidak merusak pekerjaan pengguna dan catat identitas snapshot tersebut.

Untuk setiap pengukuran, catat versi browser, sistem operasi, perangkat atau profil emulasi, ukuran viewport, device pixel ratio, mode production, jaringan, pembatasan CPU, cache, tema, dan preferensi gerakan. Emulasi perangkat mobile tidak sama dengan pengujian pada perangkat fisik.

Jalankan sedikitnya tiga pembukaan dengan cache bersih pada profil yang sama. Simpan semua hasil dan median. Lakukan pengujian cache hangat secara terpisah. Jangan memilih satu hasil tercepat untuk mewakili seluruh perubahan.

### 26.2 Metrik dan arti hasilnya

1. Catat elemen LCP yang sebenarnya. Jika elemen tersebut berubah setelah redesign, jelaskan perubahan konteksnya.
2. Catat layout shift yang terlihat dan pemicunya, termasuk font, placeholder Evidence, menu, dan caption demo. Tinggi panel yang berubah karena tindakan pengguna tetap perlu dinilai secara visual walaupun tidak selalu menambah CLS.
3. Catat durasi respons pada Play, Pause, pilihan tahap, menu, FAQ, dan Retry. Angka interaksi dari satu sesi lab tidak boleh diberi label INP populasi pengguna.
4. Catat jumlah request awal, JavaScript yang ditransfer dalam bentuk terkompresi, JavaScript yang benar benar dieksekusi, dan resource yang baru muncul setelah preview dibuka.
5. Pada trace, periksa pekerjaan JavaScript, layout, dan paint yang berkaitan dengan demo. Saat demo paused, di luar viewport, atau tab tersembunyi, tidak boleh ada siklus per frame yang terus bekerja untuk demo.
6. Periksa jumlah koneksi serta timer setelah membuka dan menutup preview berulang. Kenaikan koneksi yang tidak kembali ke baseline menunjukkan cleanup belum benar.

Target angka dasar tetap mengikuti bagian 11.1. Besarnya penurunan bundle belum dapat ditentukan sebelum baseline diukur. Jangan menuliskan klaim seperti 50 persen lebih cepat atau skor 100 tanpa bukti pengukuran.

### 26.3 Batas pemuatan yang harus dipenuhi

1. ProductDemo menjelaskan produk tanpa request trading, provider wallet, chart terminal, atau data Analytics.
2. Aset di bawah lipatan layar tidak menghalangi teks hero dan CTA tampil.
3. Live preview hanya memuat modul serta koneksinya setelah ada tindakan pengguna.
4. Jangan memasang library animasi kedua untuk menggantikan kebutuhan yang sudah bisa dipenuhi fondasi proyek tanpa alasan teknis yang terukur.
5. Tidak ada video berukuran besar yang diputar otomatis sebagai syarat pembukaan hero.
6. Tidak ada loading screen penuh yang menahan seluruh halaman sampai Evidence siap.

Jika hasil pengukuran bertambah berat, agent harus menunjukkan resource penyebab dan manfaat yang diperoleh. Hapus beban yang tidak membantu pemahaman sebelum mencoba mengoptimalkan efek dekoratif.

### 26.4 Rubrik review visual

Nilai tiap dimensi dari 0 sampai 2. Nilai 0 berarti gagal, 1 berarti perlu perbaikan, dan 2 berarti memenuhi contoh perilaku yang dijelaskan. Rubrik ini alat diskusi desain, bukan metrik ilmiah atau pengganti acceptance test.

1. Hierarki: pada nilai 2, headline, CTA, dan demonstrasi mudah dikenali dalam satu pandangan tanpa bersaing dengan lima statistik atau panel yang sama kuat.
2. Komposisi: pada nilai 2, tiap section mempunyai fungsi serta ritme yang jelas, dan ruang kosong menjaga kedekatan elemen yang berhubungan.
3. Keterbacaan: pada nilai 2, body, angka, caption, dan kontrol terbaca di desktop serta mobile pada kedua tema tanpa memerlukan pembesaran untuk informasi utama.
4. Gerakan: pada nilai 2, pengguna dapat melihat hubungan sinyal, perubahan quote, dan penjelasan; tidak ada gerakan dekoratif yang mengalihkan perhatian dari hubungan tersebut.
5. Kepercayaan: pada nilai 2, pengunjung dapat membedakan contoh, data pasar, hasil studi, serta bukti jaringan tanpa membaca disclaimer yang tersembunyi.

Sasaran review adalah sedikitnya 8 dari 10 tanpa dimensi bernilai 0. Semua persyaratan perilaku dan kebenaran data tetap wajib. Skor visual tinggi tidak dapat menutupi crash, klaim palsu, atau kontrol yang tidak dapat diakses.

### 26.5 Bukti yang harus disimpan

1. Screenshot hero sebelum dan sesudah pada desktop serta mobile dengan ukuran viewport tercantum.
2. Screenshot halaman penuh untuk menilai ritme antar section, serta detail menu dan contoh Evidence parsial atau gagal.
3. Rekaman satu siklus demo, pause di tengah transisi, navigasi tahap manual, dan reduced motion.
4. Hasil perintah pemeriksaan proyek beserta status lulus, gagal, atau belum dijalankan.
5. Ringkasan network dan performance trace dengan kondisi pengujian yang cukup untuk diulang.
6. Daftar kekurangan yang masih ada serta dampaknya terhadap pengguna. Jangan menyebut target desain sebagai hasil verifikasi.

## 27. Paket pekerjaan untuk agent implementasi

Paket berikut menentukan urutan kerja dan hasil yang dapat direview. Nama komponen adalah usulan; gunakan struktur proyek yang masuk akal. Agent boleh menggabungkan perubahan yang erat kaitannya selama batas tanggung jawab dan bukti pengujiannya tetap jelas.

### WP01. Catat baseline dan kontrak produk

Prioritas P0. Tidak mempunyai prasyarat.

Baca instruksi proyek, status Git, diff lokal yang relevan, landing saat ini, tipe data, config publik, dan perilaku engine yang menjadi dasar copy. Simpan baseline visual serta daftar request pembukaan. Konfirmasikan arti Stop, Kill, loss trigger, status simulasi, dan publikasi record melalui source terbaru.

Hasil yang diserahkan adalah daftar kondisi awal dan keputusan yang berbeda dari laporan jika source telah berubah. Jangan memulai dengan mengganti seluruh file sehingga pekerjaan lokal lain hilang. Selesai ketika baseline dapat dibandingkan dan klaim produk sudah mempunyai sumber yang jelas.

### WP02. Bangun struktur, copy, dan layout statis

Prioritas P0. Bergantung pada WP01.

Kerjakan route landing, susunan section S01 sampai S08, token lokal, hierarki heading, CTA, anchor, serta contoh kontrol yang ringkas. Terapkan copy bagian 22 dengan substitusi yang sesuai konfigurasi. Hapus duplikasi demonstrasi besar dari susunan akhir.

Hasil yang diserahkan adalah halaman statis yang sudah dapat menjelaskan produk pada desktop dan mobile sebelum animasi ditambahkan. Verifikasi LP01 sampai LP08, LP19 sampai LP21, dan bagian statis T13 serta T14. Jangan memakai efek gerak untuk menutupi layout yang belum selesai.

### WP03. Buat state demonstrasi dan scene deterministik

Prioritas P0. Bergantung pada WP02.

Pisahkan fixture, definisi tahap, pengelola event, scene, caption, dan kontrol. Implementasikan perpindahan manual terlebih dahulu, termasuk navigasi mundur yang mengembalikan quote contoh dengan benar. Tambahkan pemeriksaan bermakna untuk transisi state dan pembersihan lifecycle.

Hasil yang diserahkan adalah empat tahap yang konsisten tanpa request jaringan. Verifikasi LP09 sampai LP11, LP14, LP17, dan T04. Selesai ketika scene serta caption selalu mengikuti tahap yang sama walaupun pengguna menekan kontrol dengan cepat.

### WP04. Tambahkan motion dan kontrol pemutaran

Prioritas P1. Bergantung pada WP03.

Terapkan storyboard bagian 19, satu siklus autoplay, ambang viewport, pause manual, tab visibility, Replay, dan reduced motion. Periksa transisi secara visual pada kecepatan normal serta saat dijeda. Jangan menambahkan animasi berdasarkan scroll sebelum mekanisme inti ini stabil.

Hasil yang diserahkan adalah rekaman demo dan pemeriksaan T01 sampai T04. Verifikasi LP12 sampai LP18. Selesai ketika pemutaran dapat dikendalikan, timer dibersihkan, dan perubahan preferensi tidak menyebabkan gerakan kembali tanpa konteks yang benar.

### WP05. Perbaiki Evidence, config, dan label sumber

Prioritas P0. Bergantung pada WP01 dan struktur WP02; tidak perlu menunggu penyempurnaan animasi.

Bangun normalisasi data dan state tampilan bagian 21. Hilangkan asumsi cell selalu ada, periode tetap, sumber selalu Nansen live, serta pending sama dengan gagal. Pertahankan informasi valid ketika hanya sebagian data tersedia. Pastikan config diakses tanpa membawa provider wallet ke landing.

Hasil yang diserahkan adalah bukti fixture D01 sampai D08 dan hasil T06 sampai T10. Verifikasi LP27 sampai LP35. Selesai ketika response tidak lengkap tetap menghasilkan tampilan yang jujur dan tidak crash.

### WP06. Lengkapi navigasi dan aksesibilitas

Prioritas P0. Bergantung pada WP02 dan kontrol WP03.

Selesaikan menu mobile, fokus keyboard, anchor offset, FAQ, label kontrol, tema, zoom, serta fallback konten tanpa JavaScript. Periksa shared header pada halaman publik lain. Gunakan elemen semantik sebelum menambah ARIA untuk meniru elemen yang sebenarnya sudah tersedia.

Hasil yang diserahkan adalah hasil T05, T12, T13, dan T14 pada kedua tema. Verifikasi LP19 sampai LP26. Selesai ketika seluruh informasi serta tindakan penting dapat diakses tanpa pointer.

### WP07. Kurangi dependensi awal dan periksa koneksi

Prioritas P1. Bergantung pada struktur final dan WP05.

Periksa production bundle, route prefetch, pemuatan modul chart, sumber request, dan lifecycle koneksi. Jika live preview dipertahankan, pastikan pemuatannya berdasarkan tindakan pengguna dan cleanup bekerja ketika ditutup. Batasi perubahan lib/live pada kebutuhan yang terbukti agar stream aplikasi lain tetap aman.

Hasil yang diserahkan adalah perbandingan baseline, hasil T11 dan T15, serta penjelasan resource yang berubah. Verifikasi LP35 sampai LP38. Selesai ketika batas pemuatan bagian 26.3 terpenuhi atau keterbatasan teknisnya dilaporkan dengan bukti yang konkret.

### WP08. Review akhir, regresi, dan serah terima

Prioritas P0. Bergantung pada seluruh paket yang termasuk scope final.

Jalankan pemeriksaan proyek yang relevan, seluruh acceptance test yang berlaku, serta pemeriksaan lintas route. Cocokkan copy dengan perilaku terbaru. Nilai desain melalui rubrik, perbaiki masalah prioritas tinggi, dan lengkapi bukti implementasi.

Hasil yang diserahkan adalah laporan penyelesaian menggunakan format bagian 28. Verifikasi LP39, LP40, dan T16. Uji pengguna atau perangkat yang belum tersedia harus tetap dicatat belum dilakukan. Jangan menyatakan pekerjaan seluruhnya terverifikasi hanya karena build berhasil.

## 28. Keterlacakan temuan dan format serah terima

### 28.1 Hubungan temuan dengan pekerjaan

1. F01, beban terminal terlalu dini: ditangani WP02, WP03, dan WP07. Bukti utama LP01, LP02, LP04, LP35, dan LP38; periksa T13 dan T15.
2. F02, CTA terpisah dari pesan: ditangani WP02. Bukti utama LP01 dan LP03; periksa screenshot hero pada T05.
3. F03, hero mobile terlalu panjang: ditangani WP02 dan WP06. Bukti utama LP03 sampai LP06 dan LP25; periksa T05 serta T12.
4. F04, ritme section seragam: ditangani WP02. Bukti utama LP08 dan rubrik komposisi; periksa screenshot halaman penuh.
5. F05, demonstrasi berulang: ditangani WP02 dan WP03. Bukti utama LP02, LP09, dan LP11; periksa susunan halaman final.
6. F06, kontrol animasi belum lengkap: ditangani WP03 dan WP04. Bukti utama LP12 sampai LP18; periksa T01 sampai T04.
7. F07, navigasi mobile tidak lengkap: ditangani WP06. Bukti utama LP20 sampai LP26; periksa T05, T12, dan T14.
8. F08, state gagal memberikan pesan salah: ditangani WP05. Bukti utama LP27, LP28, LP31, dan LP35; periksa T06, T07, dan T09.
9. F09, copy melampaui perilaku produk: ditangani WP01, WP02, dan WP05. Bukti utama LP11 serta LP29 sampai LP34; periksa T08, T10, dan T14.
10. F10, Evidence sulit ditafsirkan: ditangani WP05. Bukti utama LP27 sampai LP30; periksa T07 dan T08 serta jawaban pembaca baru pada T16 jika tersedia.

### 28.2 Kondisi yang harus diperbaiki sebelum dinyatakan siap

1. Landing atau Evidence crash pada response yang menjadi bagian fixture wajib.
2. Fixture demo terlihat seperti order, transaksi, atau hasil trading pengguna nyata.
3. Tombol landing memulai trading, meminta signature, atau mengubah policy tanpa alur aplikasi yang semestinya.
4. Pause, reduced motion, atau cleanup tidak bekerja sehingga pemutaran terus berlangsung setelah seharusnya berhenti.
5. Kontrol utama tidak dapat digunakan pada mobile atau dengan keyboard.
6. Copy memberikan jaminan keuntungan, jaminan batas kerugian mutlak, atau klaim publikasi Monad yang tidak didukung keadaan aktual.
7. Perubahan global merusak onboarding, terminal, Policy, atau Analytics.

Perbedaan selera seperti jarak section yang masih perlu disesuaikan dapat dicatat sebagai penyempurnaan desain. Tujuh kondisi di atas berhubungan dengan fungsi atau kejujuran produk dan harus diselesaikan sebelum pekerjaan dilaporkan siap.

### 28.3 Format laporan penyelesaian agent

Gunakan struktur ringkas berikut, sertai link ke file atau bukti yang benar benar tersedia:

1. Hasil: jelaskan perubahan pengalaman pengunjung dalam dua sampai empat kalimat.
2. Scope: sebutkan paket WP yang selesai, bagian yang sengaja tidak diambil seperti live preview opsional, dan alasannya.
3. File: sebutkan file yang diubah beserta fungsi perubahannya, termasuk dampak pada komponen bersama.
4. Data dan copy: jelaskan sumber label jaringan, sumber Evidence, status ilustrasi demo, serta perubahan klaim yang penting.
5. Verifikasi: catat hasil LP01 sampai LP40 dan T01 sampai T16 dengan status lulus, gagal, belum diuji, atau tidak berlaku beserta alasan. Boleh dikelompokkan jika semua kasus di dalam kelompok mempunyai hasil dan bukti yang sama.
6. Visual: sertakan screenshot desktop, mobile, kedua tema, serta rekaman animasi dan kontrol.
7. Performa: tampilkan baseline, hasil sesudah, profil pengujian, dan keterbatasan perbandingan. Jika belum diukur, tulis belum diukur.
8. Regresi: tulis route lain yang diperiksa, hasilnya, dan kegagalan baseline yang sudah ada sebelum perubahan.
9. Keterbatasan: jelaskan masalah yang masih tersisa, dampaknya, serta langkah berikutnya yang spesifik.

### 28.4 Catatan keputusan yang perlu dipertahankan

Catat hanya keputusan yang membantu reviewer memahami hasil: alasan satu demo dipilih, sumber data yang dipakai, alasan pola fetch dipilih, perilaku autoplay dan reduced motion, serta alasan jika live preview dihilangkan. Keputusan yang berbeda dari spesifikasi harus menyebut masalah yang diselesaikan dan bukti bahwa pengalaman pengguna tetap memenuhi tujuan.

Tidak perlu mencatat setiap eksperimen desain yang dibatalkan. Jangan menambah pekerjaan pemisahan repo, migrasi analytics, perubahan strategi trading, atau deployment sebagai konsekuensi otomatis dari brief landing ini.

## 29. Brief siap dikirim kepada agent

> Redesign landing page Monday pada route / menggunakan spesifikasi dalam dokumen ini. Pertahankan identitas gelap dan amber, logo, fondasi font, route, serta perilaku produk yang sudah ada. Mulai dengan membaca source dan perubahan lokal terbaru agar pekerjaan pengguna tidak tertimpa.
>
> Susun ulang hero menjadi pesan dan CTA yang berdekatan, dengan satu demonstrasi interaktif sebagai visual utama. Gantikan terminal penuh yang langsung tampil serta pengulangan Story dengan rangkaian Quote, Detect, Step aside, dan Explain. Gunakan fixture yang diberi label jelas dan visual yang sesuai produk. Demonstrasi tidak boleh memanggil API trading atau meminta wallet signature.
>
> Bangun animasi yang terarah, kontrol Play, Pause, Resume, dan Replay, penghentian saat tidak terlihat, serta reduced motion. Buat versi mobile khusus yang ringkas. Pertahankan anchor how dan custody. Tambahkan alur memulai, penjelasan kontrol dan custody, Evidence yang dapat dipahami, FAQ, serta footer yang berguna.
>
> Pisahkan data live dari jalur pembukaan hero. Perbaiki state data gagal dan copy yang memberi kesan jaminan risiko atau keuntungan. Jangan menambahkan fitur strategi, mengubah kontrak policy, memecah repo, atau mengganti algoritme trading sebagai bagian dari pekerjaan ini.
>
> Gunakan kontrak rinci bagian 17 sampai 24 untuk ukuran, copy, storyboard, state, request, dan batas komponen. Kerjakan paket WP01 sampai WP08 sesuai ketergantungannya. Gunakan fixture dan skenario T01 sampai T16 untuk memeriksa keadaan normal, error, response parsial, perubahan viewport, serta interaksi yang cepat.
>
> Verifikasi di browser pada desktop dan mobile, uji keyboard dan reduced motion, jalankan pemeriksaan proyek yang relevan, dan periksa regresi komponen bersama. Serahkan implementasi yang berfungsi, screenshot, rekaman animasi, hasil pengujian, serta keterbatasan yang masih ada.

## 30. Referensi pendukung

1. [Spesifikasi redesign Policy Monday](</Users/yoga/Projects/mondaynad/reports/Spesifikasi redesign Policy Monday dengan referensi Tread.md>): rujukan istilah risiko, model policy, serta hubungan save, publish, dan start. Temuan harus tetap dicocokkan dengan source terbaru.
2. [Motion scroll animations](https://motion.dev/docs/react-scroll-animations): kemampuan animasi berdasarkan viewport dan progres scroll.
3. [Motion reduced motion](https://motion.dev/docs/react-use-reduced-motion): penyesuaian terhadap preferensi gerakan pengguna.
4. [Panduan performa animasi](https://web.dev/articles/animations-guide): pertimbangan biaya rendering dan pemilihan properti animasi.
5. [Tipe data inti Monday](/Users/yoga/Projects/mondaynad/packages/core/src/types.ts): bentuk AppConfig, Evidence, EventStudy, Replay, serta status yang harus dicocokkan kembali sebelum implementasi.
6. [Penyusunan Evidence pada server](/Users/yoga/Projects/mondaynad/apps/server/src/evidence.ts): sumber periode permintaan data, penggabungan hasil, dan penandaan data simulasi.
7. [Akses API web](/Users/yoga/Projects/mondaynad/apps/web/lib/api.ts): mekanisme request yang tersedia. Tipe TypeScript pada hasil fetch tidak menggantikan validasi response saat runtime.

Referensi teknis membantu implementasi. Keputusan layout, tahapan demonstrasi, copy usulan, dan prioritas pekerjaan dalam dokumen ini merupakan rancangan khusus untuk kebutuhan Monday.
