# Implementasi Algoritma A\* untuk Pencarian Rute Kunjungan Wisata dari Penginapan di Yogyakarta

Aplikasi web untuk mencari rute dari sebuah penginapan ke maksimal tiga destinasi wisata di Daerah Istimewa Yogyakarta (DIY), menggunakan jaringan jalan nyata dari OpenStreetMap. Algoritma utamanya adalah **A\*** dengan heuristik **Haversine** yang diimplementasikan secara manual. Dijkstra tersedia sebagai validasi opsional pada rute yang sama.

Proyek ini dibuat sebagai final project mata kuliah Artificial Intelligence.

**Nama Anggota, NIM:**

- Muhammad Fauzan Rasyaad — 23/519864/TK/57281
- Muhammad Wildan Wilhamdi — 23/518666/TK/57133
- Nafil Nissano Yogma Pratama — 23/521136/TK/57475

---

## Fitur

- Memilih 1 hotel (dari 551 hotel) sebagai titik awal.
- Memilih 1 sampai 3 destinasi (dari 209 destinasi wisata) dalam urutan kunjungan yang ditentukan pengguna.
- Menghitung rute utama dengan A\* (Haversine).
- Memvalidasi rute yang sama dengan Dijkstra secara opsional.
- Rute ditampilkan di peta Leaflet, satu warna per leg perjalanan.
- Statistik hasil pencarian: total jarak, waktu pencarian, jumlah node yang dieksplorasi.
- Penanda kualitas akses (`ok`, `offset`, `limited`) untuk titik yang jauh dari jalan.

> Urutan kunjungan mengikuti pilihan pengguna. Sistem **tidak** mengoptimasi urutan (bukan TSP); setiap leg dicari secara berurutan: hotel → destinasi 1 → destinasi 2 → destinasi 3.

---

## Data dan Sumber

| Data | File | Jumlah | Sumber |
|---|---|---|---|
| Penginapan | `data/hotel.csv` | 551 baris | Portal Data Kota Yogyakarta, [Data Hotel 2020](https://dataset.jogjakota.go.id/id/dataset/datahotel2020) |
| Destinasi wisata | `data/wisata.csv` | 209 baris | [jogjaprov.go.id/wisata](https://jogjaprov.go.id/wisata), diambil dengan scraping |
| Jaringan jalan | `graph/diy_road_network.zip` | 153.703 node, 397.053 edge | OpenStreetMap (via OSMnx) |

Kolom `hotel.csv`: `nama`, `tipe`, `golongan`, `jumlah_kamar`, `alamat`, `lat`, `lon`.

Kolom `wisata.csv`: `id`, `nama`, `kategori`, `kabupaten`, `district`, `lat`, `lon`, `rating`, `address`.

File GraphML hasil ekstraksi berukuran sekitar 185 MiB, jadi yang disimpan di repository adalah versi ZIP (sekitar 20 MB). GraphML diekstrak secara lokal dengan `scripts/unpack_graph.py` dan sudah masuk `.gitignore`.

---

## Formalisasi Masalah

| Komponen | Definisi |
|---|---|
| **State** | Sebuah node pada jaringan jalan OSM |
| **Initial state** | Node jalan terdekat dari koordinat hotel |
| **Goal state** | Node jalan terdekat dari koordinat destinasi |
| **Action** | Berpindah ke node tetangga melalui edge yang searah dengan arah jalan |
| **Path cost** | Panjang edge (meter); `g(n)` adalah total panjang dari start ke `n` |
| **Objective** | Jalur dengan total jarak minimum |

Graf berbentuk `MultiDiGraph`: satu pasangan node bisa punya beberapa edge paralel, dan jalan satu arah tidak dibuatkan edge baliknya. Implementasi merelaksasi semua edge paralel dan mengambil yang termurah.

## Algoritma

**A\*** memakai fungsi evaluasi

```text
f(n) = g(n) + h(n)
```

dengan `h(n)` berupa jarak Haversine (great-circle, R = 6.371.000 m) dari node `n` ke node goal. Implementasi manual di `algorithms/astar.py` memakai `heapq` sebagai open set, `closed_set`, `g_score`, `f_score`, dan `came_from`, tanpa memanggil `nx.astar_path()` maupun `nx.dijkstra_path()`.

**Dijkstra** (`algorithms/dijkstra.py`) adalah mesin pencarian yang sama dengan `h(n) = 0`. Frontend menjalankannya hanya ketika pengguna meminta validasi, sehingga perbandingan tetap memakai kode, graf, dan tie-breaker yang identik.

**Snapping** (`routing/snapping.py`): koordinat hotel/destinasi dipetakan ke node terdekat dengan `osmnx.distance.nearest_nodes()` (batch saat startup backend), lalu jarak snap dihitung dan diklasifikasikan:

| Tier | Jarak titik ke node jalan | Arti |
|---|---:|---|
| `ok` | ≤ 100 m | Node jalan hampir tepat di titik tujuan |
| `offset` | 100 m – 1 km | Rute berakhir beberapa ratus meter dari titik |
| `limited` | > 1 km | Praktis tidak ada jalan di sekitar (mis. pantai tebing, puncak gunung); rute berakhir di node jalan terdekat |

---

## Alur Sistem

```text
Browser (Leaflet)  ──POST /route──▶  FastAPI  ──▶  plan_route()
                                                       │
                                     snapped nodes (dihitung sekali saat startup)
                                                       │
                                         A* / Dijkstra per leg pada graf OSM
                                                       │
Browser (peta + statistik)  ◀────────  JSON: legs, jarak, waktu, node
```

## Struktur Repository

```text
tourism-route-ai/
├── algorithms/
│   ├── astar.py          # A* manual
│   ├── dijkstra.py       # Dijkstra = A* dengan h(n) = 0
│   └── heuristics.py     # Haversine
├── routing/
│   ├── route.py          # rute multi-leg (maks. 3 destinasi)
│   └── snapping.py       # snapping koordinat ke node jalan + access tier
├── backend/
│   └── main.py           # FastAPI: /hotels, /destinations, /route
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── data/
│   ├── hotel.csv
│   └── wisata.csv
├── graph/
│   └── diy_road_network.zip
├── scripts/
│   └── unpack_graph.py   # ekstrak GraphML dari ZIP
├── test_experiment.py    # eksperimen A* (1, 2, 3 destinasi x 10 kali)
├── test_dijkstra.py      # eksperimen Dijkstra (skenario yang sama)
└── requirements.txt
```

---

## Cara Menjalankan

Contoh di bawah memakai Windows PowerShell. Versi di `requirements.txt` dipatok untuk **Python 3.14** (`networkx==3.7` membutuhkan Python 3.12 atau lebih baru).

**1. Clone repository**

```powershell
git clone https://github.com/muhammadfauzanrasyaad16/tourism-route-ai.git
cd tourism-route-ai
```

**2. Buat virtual environment dan install dependency**

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Perintah di atas memanggil Python di dalam `.venv` secara langsung, jadi tidak perlu `Activate.ps1` (yang bisa terblokir oleh Execution Policy Windows).

**3. Ekstrak jaringan jalan**

```powershell
.\.venv\Scripts\python.exe scripts\unpack_graph.py
```

Hasilnya `graph/diy_road_network.graphml`.

**4. Jalankan backend**

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

Tunggu sampai muncul pesan berikut. Memuat graf butuh sekitar 30 detik.

```text
Ready: 153,703 nodes, 551 hotel, 209 destinasi.
INFO:     Application startup complete.
```

Backend berjalan di `http://127.0.0.1:8000`.

**5. Buka frontend**

Jalankan server statis untuk folder `frontend` di terminal kedua (biarkan backend tetap berjalan di terminal pertama):

```powershell
.\.venv\Scripts\python.exe -m http.server 5500 --directory frontend
```

Lalu buka `http://127.0.0.1:5500` di browser.

Jangan membuka `frontend/index.html` langsung dengan klik dua kali (`file://`): tile peta OpenStreetMap ditolak dengan error 403 (Access blocked) dan peta tidak tampil. Jika Windows menampilkan dialog firewall untuk Python, pilih Allow access pada jaringan Private.

Frontend memuat Leaflet dan tile CARTO Voyager dari internet, jadi koneksi internet dibutuhkan untuk menampilkan peta. Attribution CARTO dan OpenStreetMap ditampilkan di sudut peta.

### Cara memakai

1. Pilih hotel.
2. Pilih destinasi pertama, lalu (opsional) kedua dan ketiga.
3. Klik **Cari Rute** untuk menghitung rute A\*.
4. Gunakan **Validasi dengan Dijkstra** bila ingin membandingkan rute yang sama.

<!-- Screenshot: tambahkan gambar ke docs/screenshots/ lalu tampilkan di sini, mis.
![Hasil rute 3 destinasi](docs/screenshots/route-3-destinations.png)
-->

---

## API

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/hotels` | Daftar hotel beserta jarak snap dan `access_tier` |
| GET | `/destinations` | Daftar destinasi beserta kategori, kabupaten, jarak snap, dan `access_tier` |
| POST | `/route` | Hitung rute berurutan |

Contoh request `POST /route`:

```json
{
  "hotel_id": "H001",
  "destination_ids": [198, 210, 212],
  "algorithm": "astar"
}
```

`algorithm` bernilai `astar` atau `dijkstra`. `hotel_id` berformat `H001` sampai `H551` mengikuti urutan baris `hotel.csv`.

Contoh memanggil dari PowerShell:

```powershell
(Invoke-WebRequest "http://127.0.0.1:8000/route" -Method POST -ContentType "application/json" -Body '{"hotel_id":"H001","destination_ids":[198],"algorithm":"astar"}' -UseBasicParsing).Content
```

Respons berisi `algorithm`, `legs` (tiap leg punya `from`, `to`, `path_nodes`, `path_coords`, `distance_m`), `total_distance_m`, `search_time_ms`, dan `nodes_explored`. Nilai agregat adalah penjumlahan seluruh leg.

---

## Eksperimen

**Skenario** (hotel `H001` = 105 Losmen; urutan destinasi tetap):

| Destinasi | Rute |
|---:|---|
| 1 | 105 Losmen → Candi Prambanan (`198`) |
| 2 | … → Istana Ratu Boko (`210`) |
| 3 | … → Candi Barong (`212`) |

Setiap skenario dijalankan 10 kali per algoritma pada satu mesin (Windows, Python 3.14), lewat endpoint `/route`.

**Hasil (rata-rata 10 kali):**

| Destinasi | Algoritma | Jarak (m) | Waktu (ms) | Std. dev. (ms) | Node dieksplorasi |
|---:|---|---:|---:|---:|---:|
| 1 | A\* | 17.030,56 | 61,98 | 1,27 | 7.652 |
| 1 | Dijkstra | 17.030,56 | 573,30 | 15,32 | 80.340 |
| 2 | A\* | 22.648,37 | 71,23 | 0,88 | 8.777 |
| 2 | Dijkstra | 22.648,37 | 589,23 | 12,11 | 84.013 |
| 3 | A\* | 26.007,28 | 73,10 | 1,24 | 8.957 |
| 3 | Dijkstra | 26.007,28 | 594,55 | 16,44 | 84.712 |

Pada ketiga skenario, A\* dan Dijkstra menghasilkan jarak yang sama. A\* mengeksplorasi sekitar 89–90% lebih sedikit node dan waktu pencariannya sekitar 88–89% lebih rendah. Hasil ini berlaku untuk skenario di atas dan tidak dimaksudkan sebagai klaim bahwa A\* selalu lebih cepat untuk semua pasangan titik. Waktu eksekusi juga bergantung pada spesifikasi mesin.

**Mengulang eksperimen** (backend harus sedang berjalan, jalankan dari root project):

```powershell
.\.venv\Scripts\python.exe test_experiment.py
.\.venv\Scripts\python.exe test_dijkstra.py
```

---

## Keterbatasan

1. Urutan destinasi ditentukan pengguna; tidak ada optimasi urutan kunjungan (TSP).
2. Maksimal 3 destinasi per pencarian.
3. Hotel dan destinasi di-*snap* ke node jalan terdekat. Untuk tier `limited`, rute berakhir jauh dari lokasi sebenarnya.
4. Cost adalah panjang jalan; tidak memperhitungkan lalu lintas real-time, waktu tempuh, atau penutupan jalan.
5. Jaringan jalan adalah snapshot lokal; pembaruan OSM memerlukan pembuatan graf ulang.
6. Data hotel berasal dari dataset tahun 2020 dan mencakup Kota Yogyakarta.
7. Frontend membutuhkan internet untuk memuat Leaflet dan tile peta.
8. Hasil eksperimen terbatas pada skenario pengujian yang dijelaskan di atas.

---

## Teknologi

Python, FastAPI, Uvicorn, NetworkX, OSMnx, GeoPandas, Shapely, Pandas, NumPy, scikit-learn (dibutuhkan OSMnx untuk `nearest_nodes` pada graf yang belum diproyeksikan), Requests, Leaflet, OpenStreetMap.

## Repository

https://github.com/muhammadfauzanrasyaad16/tourism-route-ai
