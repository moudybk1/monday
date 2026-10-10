# Laporan perbaikan analytics Monday

Monday sudah menampilkan analytics Perpl mainnet dan indexer yang mengikuti blok terbaru. Pekerjaan utama berikutnya adalah memulihkan kelengkapan histori, menampilkan cakupan data secara jujur, dan merekonsiliasi definisi volume. Label `live` saat ini dapat muncul ketika agregasi historis masih berlubang, sehingga total fee, jumlah trader, dan peringkat akun belum dapat dianggap lengkap.

Laporan ini ditujukan kepada agent implementasi. Selesaikan temuan berdasarkan bukti dan kriteria penerimaan di bawah, lalu serahkan hasil validasi sebelum dan sesudah perbaikan.

## Lingkup dan versi

| Item | Nilai |
| --- | --- |
| Tanggal pemeriksaan | 10 Oktober 2026, WIB |
| Halaman | http://localhost:3000/analytics |
| Workspace | `/Users/yoga/Projects/mondaynad` |
| Commit dasar | `d157a662e75972ae261c7a6204ab6fa7f676ed53` |
| Kondisi kode | Ada perubahan lokal yang belum di-commit; commit dasar saja tidak merepresentasikan seluruh implementasi yang diperiksa |
| Lingkup implementasi | Indexer analytics, agregasi, API statistik, penanda coverage, dan grafik terkait |

Port 3000 merupakan instance utama yang melaporkan `network: mainnet`, `venue: perpl`, `realFunds: true`, `smartMoney: nansen`, dan `llm: true`. Port 3100 yang diperiksa sebelumnya adalah simulator. Pisahkan bukti kedua instance tersebut.

Keempat endpoint `/api/stats/overview`, `/api/stats/risk`, `/api/stats/liquidations?limit=40`, dan `/api/stats/traders?days=7&sort=net` mengembalikan HTTP 200 pada pemeriksaan. Tidak ada error console yang teramati saat halaman analytics dimuat. Ini membuktikan jalur pembacaan bekerja; akurasi dan kelengkapan historinya tetap memerlukan perbaikan berikut.

## Bukti yang disertakan

- [Ringkasan hasil API dan database](/Users/yoga/Projects/mondaynad/reports/assets/analytics-2026-10-10/evidence-summary.json).
- [Screenshot filter 7D dan grafik Fees](/Users/yoga/Projects/mondaynad/reports/assets/analytics-2026-10-10/analytics-fees.jpg).

Ringkasan JSON merupakan transkripsi terstruktur dari hasil pemeriksaan yang sudah teramati, bukan ekspor penuh respons mentah. Pembacaan berlangsung berurutan sehingga angka yang terus bergerak, seperti fee dan jumlah posisi, dapat sedikit berbeda antarhasil. Pengambilan ulang snapshot saat penyusunan laporan mengalami timeout 10 detik; gunakan bukti bertanggal ini sebagai baseline dan ambil snapshot baru saat mulai mengerjakan.

## Prioritas pekerjaan

| ID | Prioritas | Masalah | Hasil yang diperlukan |
| --- | --- | --- | --- |
| AN01 | P1 | Agregasi histori berlubang tetapi kelengkapannya tidak terwakili di UI | Data dipulihkan, coverage diverifikasi, status parsial terlihat sampai pemulihan selesai |
| AN02 | P1 investigasi | Volume ETH pada ticker dan candle tidak konsisten | Definisi, skala, market, dan waktu kedua sumber direkonsiliasi |
| AN03 | P2 | Batas waktu agregasi volume dan fee berbeda | Semua metrik dalam satu pilihan periode memakai batas waktu yang selaras |

P1 berarti perlu diselesaikan sebelum angka historis dipakai sebagai bukti akurasi produk dalam submission. AN02 adalah ketidakkonsistenan teramati dengan penyebab yang masih terbuka; jangan langsung menganggap salah satu API upstream rusak.

## AN01 Kelengkapan histori dan status data

### Bukti

API melaporkan `source: hypersync` dan `live: true`, dengan cursor di sekitar head terbaru. Namun query read-only pada tabel `px_day` menemukan rentang tanggal tanpa baris agregasi:

| Rentang UTC | Jumlah hari tanpa agregasi |
| --- | ---: |
| 17–18 Februari 2026 | 2 |
| 21 Februari 2026 | 1 |
| 11 Agustus–5 Oktober 2026 | 56 |
| 7 Oktober 2026 | 1 |

Ketiadaan baris saja tidak membuktikan setiap tanggal seharusnya berisi transaksi. Akan tetapi, candle API menunjukkan volume positif pada banyak tanggal yang hilang, termasuk 4, 5, dan 7 Oktober. Ini merupakan ketidaksesuaian yang harus ditelusuri antara sumber volume, log mentah, dan agregasi.

Dalam seri harian yang dikembalikan API:

| Periode yang diperiksa | Hari tersedia | Hari dengan agregasi fee |
| --- | ---: | ---: |
| 7 hari | 7 | 4 |
| 30 hari | 30 | 4 |
| 90 hari | 90 | 33 |

Empat tanggal terakhir yang memiliki agregasi adalah 6, 8, 9, dan 10 Oktober. Salah satu snapshot mengembalikan `fees7dUsd` dan `fees30dUsd` identik, yaitu `7015.4925880000155`, serta jumlah trader 7D dan 30D sama-sama 398. Kesamaan total saja bukan bukti bug; kesamaan tersebut menjadi bermasalah bersama bukti celah agregasi dan aktivitas pada candle.

### Jalur kode yang relevan

- [Indexer dan penyimpanan status](/Users/yoga/Projects/mondaynad/apps/server/src/stats/indexer.ts:57): `indexerStatus()` mengukur aktivitas proses.
- [Cursor HyperSync](/Users/yoga/Projects/mondaynad/apps/server/src/stats/indexer.ts:143): flag `genesis` diisi ketika backfill mulai; cursor menggunakan key metadata `cursor`.
- [Cursor RPC](/Users/yoga/Projects/mondaynad/apps/server/src/stats/indexer.ts:196): memakai key cursor yang sama dan dapat melompat mendekati head ketika terlalu tertinggal.
- [Klaim histori lengkap](/Users/yoga/Projects/mondaynad/apps/server/src/stats/indexer.ts:233): `historyComplete()` memakai flag genesis dan kedekatan cursor dengan head, tanpa membuktikan kesinambungan rentang yang telah diindeks.
- [Agregasi overview](/Users/yoga/Projects/mondaynad/apps/server/src/stats/routes.ts:79): keberadaan tanggal paling awal dipakai sebagai bukti bahwa data sudah diindeks.
- [Penanda parsial frontend](/Users/yoga/Projects/mondaynad/apps/web/app/analytics/page.tsx:36): `partial()` hanya memeriksa `since`, sehingga celah di tengah tidak terdeteksi.
- [Grafik histori](/Users/yoga/Projects/mondaynad/apps/web/app/analytics/page.tsx:86): hari tanpa fee disaring keluar. [SignedBars](/Users/yoga/Projects/mondaynad/apps/web/components/charts.tsx:180) kemudian memberi jarak berdasarkan urutan item, sehingga periode kosong dapat terkompresi tanpa terlihat sebagai celah waktu.

### Dugaan penyebab yang perlu dibuktikan

Peralihan HyperSync ke RPC lalu kembali ke HyperSync dapat meninggalkan gap: RPC boleh memajukan cursor, sementara flag genesis lama tetap ada. Ini adalah jalur kegagalan yang terlihat dari kode, tetapi riwayat proses belum membuktikan bahwa jalur itulah yang menghasilkan database saat ini.

Kemungkinan lain adalah log mentah tersedia tetapi `px_day` belum lengkap, perubahan ABI/event sepanjang histori, atau timestamp yang tidak berhasil dipetakan. HyperSync dan RPC saat ini memiliki fallback timestamp `0`; telusuri apakah fallback ini pernah terpakai. Bandingkan `px_trades`, `px_day`, log sumber, serta market dan kontrak yang berlaku pada tanggal sampel sebelum menentukan perbaikan.

### Pekerjaan implementasi

1. Buat backup SQLite yang konsisten dengan WAL melalui mekanisme backup SQLite, lalu lakukan investigasi dan pemulihan awal pada salinan. Pastikan database yang dipakai proses aktif sama dengan yang diperiksa; path saat ini bergantung pada working directory.
2. Tentukan apakah masalah ada pada pengambilan log, decoding, timestamp, atau agregasi. Gunakan sampel dari periode lengkap dan periode yang hilang. Jangan mengisi angka fee berdasarkan estimasi volume.
3. Simpan bukti rentang blok yang berhasil diproses, termasuk rentang tanpa event. Pisahkan cursor backfill historis dan cursor live, atau terapkan model coverage ekuivalen yang tetap benar saat sumber berganti.
4. Jadikan status `live`, kelengkapan histori, dan cakupan periode terpilih sebagai konsep terpisah. Kedekatan cursor dengan head tidak cukup untuk mengklaim seluruh histori lengkap.
5. Jalankan backfill rentang yang belum terbukti lengkap. Rebuild agregasi dari log mentah jika log sudah tersedia. Replay harus idempotent; jangan menggandakan fills, fee, volume, PnL, ataupun flows.
6. Tambahkan metadata coverage per periode ke API. UI harus menampilkan `Partial history` atau status setara pada fee, traders, leaderboard, dan profil wallet yang bergantung pada rentang belum lengkap. Tinjau pula flows dan liquidations berdasarkan coverage event masing-masing.
7. Hentikan klaim histori lengkap hanya berdasarkan sumber HyperSync atau tanggal pertama. Tampilkan rentang yang benar-benar terverifikasi.
8. Pertahankan slot tanggal pada grafik. Bedakan data yang belum tersedia (`null`) dengan nol yang sudah terverifikasi. Ketiadaan likuidasi atau perdagangan pada rentang yang sudah diperiksa adalah kondisi valid.
9. Hitung rasio fee terhadap volume hanya untuk cakupan dan periode yang sebanding. Sembunyikan atau beri penjelasan eksplisit ketika coverage pembilang dan penyebut berbeda.

### Kriteria selesai

- Fixture dengan transaksi pada hari pertama dan terakhir tetapi gap di tengah tetap menghasilkan status histori parsial walaupun cursor live berada di head.
- Rentang yang sudah dipindai dan memang tanpa event dapat dinyatakan lengkap; tidak harus ada transaksi setiap hari.
- Restart dan pergantian sumber tidak menghilangkan kewajiban backfill.
- Replay batch yang sama tidak mengubah total untuk kedua kalinya.
- Pemulihan menghasilkan kecocokan log mentah dan agregasi pada sampel tanggal yang sebelumnya hilang, dengan aturan menghitung maker/taker yang terdokumentasi.
- Grafik mempertahankan posisi kalender pada tanggal kosong dan menampilkan status missing data yang jelas.
- UI, API, wallet profile, dan leaderboard menyampaikan coverage yang konsisten. Ada bukti sebelum dan sesudah pemulihan, bukan hanya perubahan label.

## AN02 Rekonsiliasi volume ETH

### Bukti

Dalam satu respons overview dengan `at: 1791608552816`:

| Nilai | USD |
| --- | ---: |
| ETH `volume24hUsd` dari ticker | 786188.46509 |
| ETH candle tanggal 10 Oktober UTC | 893211.0031 |

Jika keduanya adalah notional perdagangan dengan unit, cakupan market, dan definisi yang sama, volume hari berjalan biasanya tercakup di dalam rolling 24 jam. Selisih ini memerlukan penjelasan sebelum dipakai untuk perbandingan volume atau rasio fee. Cache atau koreksi historis juga harus dipertimbangkan; belum ada bukti penyebab tunggal.

### Jalur kode dan langkah investigasi

- [Ticker](/Users/yoga/Projects/mondaynad/apps/server/src/stats/perpl.ts:88): `dva` dibagi `m.usd`, cache 5 detik.
- [Daily candles](/Users/yoga/Projects/mondaynad/apps/server/src/stats/perpl.ts:101): `v` dibagi `mk.px * mk.sz`, cache 10 menit.
- [Penyusunan overview](/Users/yoga/Projects/mondaynad/apps/server/src/stats/routes.ts:46): kedua sumber digabung tanpa timestamp freshness terpisah dalam respons.

Ambil respons upstream ticker, candle, dan context secara berdekatan. Catat network, exchange, market ID, simbol, field mentah, faktor skala, timestamp sumber, waktu pengambilan, dan rentang candle. Cocokkan makna `dva` dan `v` dengan dokumentasi resmi Perpl; komentar lokal bukan bukti kontrak API. Periksa apakah candle merupakan data hari berjalan, memiliki koreksi, atau berasal dari definisi volume berbeda.

Perbaiki konversi atau label sesuai hasil tersebut. Jika perbedaannya sah karena definisi sumber, jelaskan definisinya pada produk dan jangan mencampurkannya menjadi rasio yang seolah setara. Tambahkan freshness per sumber agar pengguna bisa menilai umur data.

### Kriteria selesai

- Ada fixture respons resmi atau respons tersimpan yang menguji konversi skala ticker dan candle.
- Hubungan volume hari berjalan dan rolling 24 jam dapat dijelaskan dengan bukti. Jangan mengubah atau memaksa angka hanya untuk memenuhi ketidaksamaan numerik.
- Market ID, simbol, exchange, unit, dan periode yang dibandingkan cocok.
- Rasio terhadap Hyperliquid dan rasio fee/volume memakai definisi yang sebanding atau menampilkan keterbatasan perbandingan.

## AN03 Konsistensi batas waktu

Review kode menemukan `vol(n * DAY)` memilih candle yang timestamp awal harinya `>= now - n * DAY`, sedangkan `feesDays(n)` dan `tradersDays(n)` membulatkan cutoff ke awal hari melalui `floor()`.

Contohnya, pada 10 Oktober pukul 05 UTC, volume 7D memasukkan bucket 4–10 Oktober, sedangkan fee/traders dapat memasukkan bucket 3–10 Oktober. Perbedaan satu bucket ini tetap relevan setelah histori dipulihkan. Endpoint leaderboard juga memakai batas hari yang dibulatkan.

Tentukan kontrak periode produk. Pilihan rolling 7 × 24 jam membutuhkan penyaringan timestamp yang tepat, termasuk bucket batas parsial. Pilihan hari kalender UTC membutuhkan label dan cutoff kalender yang konsisten. Terapkan definisi yang sama pada volume, fee, trader, leaderboard, dan rasio turunannya.

**Kriteria selesai:** fixture dengan waktu tetap sebelum, tepat pada, dan sesudah 00 UTC menunjukkan bahwa semua metrik periode memakai interval yang sama. Uji unique traders lintas hari agar akun yang sama tidak dihitung ulang sebagai trader baru dalam total periode.

## Cara mereproduksi tanpa mengubah data

Jalankan dari root repo. Semua probe berikut hanya membaca.

```sh
curl -fsS http://localhost:3000/api/stats/overview
curl -fsS http://localhost:3000/api/stats/risk
```

Probe API untuk melihat coverage seri harian dan ketidakkonsistenan volume:

```sh
node --input-type=module <<'JS'
const r = await fetch('http://localhost:3000/api/stats/overview', {
  signal: AbortSignal.timeout(15000),
});
if (!r.ok) throw new Error(`HTTP ${r.status}`);
const o = await r.json();
const day = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
console.log({ at: o.at, indexer: o.indexer, headline: o.headline });
for (const n of [7, 30, 90]) {
  const ds = o.daily.filter(d => d.t >= o.at - n * day);
  console.log({
    period: n, days: ds.length,
    daysWithFees: ds.filter(d => d.feesUsd != null).length,
    missingWithVolume: ds.filter(d => d.feesUsd == null && d.volumeUsd > 0)
      .map(d => ({ date: iso(d.t), volume: d.volumeUsd })),
  });
}
console.log({
  ethTicker: o.markets.find(m => m.sym === 'ETH')?.volume24hUsd,
  latestCandleDate: iso(o.daily.at(-1).t),
  ethLatestCandle: o.daily.at(-1).byMarket.ETH,
});
JS
```

Probe agregasi database menggunakan Node 22 yang sudah dipakai repo:

```sh
node --input-type=module <<'JS'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('apps/server/data/perpl-stats-mainnet.sqlite', {
  readOnly: true,
});
const rows = db.prepare(`
  select day, count(*) accounts, sum(trades) fills, sum(fees) fees
  from px_day group by day order by day
`).all();
const date = day => new Date(day * 86400000).toISOString().slice(0, 10);
for (let i = 1; i < rows.length; i++) {
  if (rows[i].day - rows[i - 1].day > 1) {
    console.log({ from: date(rows[i - 1].day + 1), to: date(rows[i].day - 1) });
  }
}
console.log(rows.slice(-5).map(r => ({ ...r, date: date(r.day) })));
db.close();
JS
```

Pastikan path database di atas cocok dengan working directory proses aktif. Probe tanggal kosong adalah indikator investigasi; keputusan coverage final harus berasal dari rentang blok yang diproses dan rekonsiliasi sumber.

## Urutan kerja dan validasi agent

1. Baca aturan repo, catat perubahan lokal yang sudah ada, dan ambil snapshot bukti baru. Pertahankan perubahan yang tidak terkait.
2. Buat reproduksi deterministik untuk AN01 dan AN03. Simpan sampel upstream yang relevan untuk AN02 tanpa credential.
3. Implementasikan coverage dan pemulihan pada salinan database. Jalankan backfill sebagai proses analytics terpisah; jalur trading tidak perlu dijalankan untuk menguji pekerjaan ini.
4. Perbaiki kontrak API dan tampilan status, lalu grafik dan batas periode. Terapkan perubahan data yang tervalidasi melalui prosedur backup dan pemulihan yang terdokumentasi.
5. Jalankan regression tests yang relevan, `npm test`, `npm run typecheck`, dan `npm run build`. Baseline sebelum perbaikan adalah 66 tes aplikasi, typecheck, build, serta 25 tes kontrak lulus; angka tersebut tidak membuktikan perbaikan analytics yang belum dibuat.
6. Verifikasi browser pada 24H, 7D, 30D, dan All; periksa fee, trader, leaderboard, profil wallet, serta grafik pada kondisi complete, partial, catching up, dan offline. Verifikasi label coverage juga dapat dibaca pada layar kecil.
7. Serahkan ringkasan perubahan, penyebab yang terbukti, hasil replay dan rekonsiliasi, hasil tes, screenshot, serta keterbatasan yang tersisa. Klaim selesai membutuhkan hasil pemulihan data selain perubahan kode.

Pekerjaan ini tidak memerlukan order, deposit, perubahan key, atau transaksi wallet. Registry keputusan Monday dan strategi trading berada di luar lingkup perbaikan analytics ini.

## Fakta yang relevan untuk submission

| Klaim | Batas bukti saat ini |
| --- | --- |
| Analytics membaca data Perpl mainnet dan kontrak Exchange | Teramati pada UI, API, dan jalur implementasi |
| Indexer HyperSync mengikuti blok terbaru | Teramati, tetapi histori agregasi masih memiliki gap |
| Nansen dan LLM digunakan pada instance utama | Konfigurasi menyatakan aktif; pemeriksaan analytics ini tidak membuktikan satu keputusan LLM tertentu berhasil dieksekusi |
| Seluruh histori analytics sudah lengkap sejak genesis | Belum dapat diklaim sampai AN01 selesai |
| Keputusan Monday sudah tercatat di registry Monad | Instance melaporkan `registry: null` dan `chainLog: false`; ini berbeda dari pembacaan data kontrak Exchange oleh analytics |
| Profitabilitas atau keberhasilan order live milik Monday | Tidak dibuktikan oleh statistik protokol pada halaman ini |

Gunakan perkembangan implementasi terbaru dan bukti tambahan ketika menyusun jawaban submission. Pertanyaan, track, serta batas karakter submission akan diberikan pengguna secara terpisah.
