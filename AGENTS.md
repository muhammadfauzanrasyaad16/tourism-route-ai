# DIY Tourism Route Planner — Build Spec & Repo Guide

Spesifikasi final proyek + konteks kerja agent. **Jangan menyimpang dari keputusan scope di bawah kecuali diminta eksplisit.** Deadline: 30 September 2026.

---

## 1. Ringkasan Proyek

Pencarian rute wisata DIY (Daerah Istimewa Yogyakarta) berbasis **A\***, dari hotel di Kota Yogyakarta menuju maksimal 3 destinasi yang dipilih user **secara berurutan** (bukan TSP — urutan user, bukan dioptimasi sistem).

Pertanyaan riset utama (fokus laporan; aplikasi web hanya demonstrasi):
> Bagaimana heuristic Haversine memengaruhi efisiensi A* dibandingkan Dijkstra pada jaringan jalan nyata DIY?

## 2. ATUR PALING KRITIS: algoritma diimplementasikan manual

**A\* dan Dijkstra WAJIB dari nol** — `heapq` untuk open set (priority by f_score), `closed_set`, `g_score`, `h_score`, `f_score`, `came_from` untuk reconstruct path.

**DILARANG** memakai `nx.astar_path()` / `nx.dijkstra_path()` di kode produksi routing. Boleh hanya sebagai cross-check di test/eksperimen. Alasan: proyek ini harus bisa dijelaskan per baris saat presentasi.

NetworkX/OSMnx **boleh** untuk: akses struktur graph (`G.nodes`, `G.edges`, `G[u][v][0]['length']`, `G.neighbors()`), `load_graphml`, dan `ox.distance.nearest_nodes()`.

`dijkstra.py` harus **reuse** `astar.py` dengan `heuristic_fn = lambda a, b: 0` — jangan tulis ulang, kalau logikanya berbeda perbandingannya tidak apple-to-apple.

## 3. Scope Lock — FINAL

| Aspek | Keputusan |
|---|---|
| Heuristic | Haversine saja. Tanpa Euclidean, tanpa weighted-A* multi-w. |
| Pembanding | Dijkstra (h(n)=0) sebagai baseline/validator |
| Alternative routes | Tidak ada |
| Destinasi per rute | Maksimal 3 |
| Cost function | Distance (panjang jalan) saja. Tanpa mode waktu tempuh / penalty. |
| Cakupan graph | Seluruh DIY, `network_type='drive'` |
| Cakupan hotel | Hanya Kota Yogyakarta (keterbatasan disengaja) |
| Cakupan wisata | Seluruh 5 kabupaten |

## 4. State Repo (verifikasi 26 Sep 2026)

**Sudah ada:**
```
graph/diy_road_network.graphml   # 194 MB
data/wisata.csv                  # 209 baris
data/hotel.csv                   # 551 baris
cache/*.json                     # 145 MB, cache HTTP OSMnx
tes.py                           # scratch: load graph + test nearest_node
AGENTS.md
algorithms/    heuristics.py, astar.py, dijkstra.py, __init__.py   # §13 langkah 1-3 SELESAI
routing/       snapping.py, route.py, __init__.py                  # §13 langkah 4 SELESAI
backend/       main.py, __init__.py                                # §13 langkah 5 SELESAI (fastapi 0.141.1)
frontend/      index.html, style.css, app.js                       # §13 langkah 6 SELESAI (Leaflet CDN)
requirements.txt                                                   # versi riil mesin dev
```

**BELUM ada** (masih harus dibuat): `experiments/`, `results/`, `README.md`, `data/README.md`.

> Catatan: `graph/download_graph.py` **tidak ada dan tidak akan dibuat** — graphml sudah final, jangan panggil `ox.graph_from_*`.

## 5. Environment — realities of this machine

- **Bukan git repo.** Tidak ada `.gitignore`, CI, atau pre-commit. Jangan mengandalkan `git diff` untuk review.
- Python **3.14.7** global di `C:\Users\Pinggg\AppData\Local\Programs\Python\Python314\python.exe`. **Tidak ada virtualenv** — jangan asumsikan ada `.venv`.
- Sudah terinstall: `osmnx 2.1.1`, `networkx 3.7`, `pandas 3.0.6`, `geopandas 1.1.4`, `numpy 2.5.3`, `requests`, `fastapi 0.141.1`, `uvicorn 0.54.0`, `matplotlib`/`pytest` BELUM.
- **Belum terinstall:** `matplotlib`, `pytest`, `httpx`. Error saat import = belum diinstall, bukan bug kode.
- **Node.js v24 tersedia** — berguna sebagai test runner integrasi frontend/API (`node --check`, skrip `.mjs` dengan `fetch`).
- Backend dev: `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000` + static server frontend terpisah (mis. `python -m http.server 8080 --directory frontend`). CORS sudah `*`. Startup butuh ±35 dtk (load graph); JANGAN pakai `--reload` tanpa `--reload-dir backend` — tiap save memicu reload + load ulang 30 dtk.
- Kalau repo di-init nanti: ignore `cache/` (145 MB, hasil HTTP cache, bisa di-regenerate) tapi **jangan** `graph/*.graphml` (satu-satunya sumber graph, tidak ada script download-nya).
- `cache/` = `ox.settings.cache_folder` (default `./cache`). **Jangan** panggil `ox.graph_from_polygon` dst — graphml sudah final, network call hanya membuang waktu.

### Perintah penting

```powershell
python tes.py                                  # sanity check graph load + snapping
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000    # backend (startup ±35 dtk)
python -m http.server 8080 --directory frontend                    # static frontend -> http://127.0.0.1:8080
```

Jalankan **dari repo root** — `tes.py` memakai path relatif `graph/diy_road_network.graphml`.

### Gotcha terbesar: graph lambat
`ox.load_graphml()` butuh **~30 detik** dan RAM besar (194 MB file, 153k node). Loop debugging A* akan sangat lambat kalau load tiap run. Solusi: cache graph di module-level singleton / `functools.lru_cache`, dan untuk eksperimen pakai satu proses panjang yang reuse graph.

## 6. Fakta Graph & Data (sudah diverifikasi, jangan di-assume lain)

```
graph/diy_road_network.graphml
  type              MultiDiGraph (directed)
  nodes             153.703
  edges             397.053
  strong. conn.     True (100%)
  node id           int (bukan string) — G.nodes[275838150]
  node attrs        y (lat), x (lon), street_count
  edge attrs        length, geometry, highway, oneway, name, maxspeed, lanes, ...
  edges tanpa length    0
  oneway == True        3.849
  edge tanpa pasangan reverse  ~3.781  -> arah jalan BERARTI, jangan symmetrize
```

PENTING: graph ini **MultiDiGraph**. Panjang edge via `G[u][v][0]['length']`. Node id bertipe `int`, jadi `path_nodes` di JSON aman tanpa konversi.

Akses koordinat: `G.nodes[n]['y']` = **lat**, `G.nodes[n]['x']` = **lon**.

### Data
- `data/wisata.csv`: kolom `id, nama, kategori, kabupaten, district, lat, lon, rating, address`. Distribusi kabupaten: Gunung Kidul 72, Kota Yogya 55, Sleman 34, Bantul 29, Kulon Progo 19.
- `data/hotel.csv`: kolom `nama, tipe, golongan, jumlah_kamar, alamat, lat, lon`. **Tidak ada kolom kabupaten** — semua koordinat sudah di area Kota Yogya (lat -7.8347..-7.7509, lon 110.3409..110.403). Wajib synthesise `id` untuk hotel karena CSV tidak punya.

### Jebakan urutan koordinat
- `path_coords` di response JSON: urutan **`[lat, lon]`** (ikut Leaflet).
- `ox.distance.nearest_nodes(G, X, Y)`: **X = lon, Y = lat** (`tes.py` sudah menjadi contoh pemakaian yang benar). Konversi eksplisit di titik peralihan.

### Jebakan tipe data (sudah menelan 1 bug, jangan ulangi)
- `np.int64` **bukan** subclass `int` → `json.dumps({"x": np.int64(5)})` melempar `TypeError`. Yang aman: `np.float64` (subclass `float`).
- Batch `ox.distance.nearest_nodes()` mengembalikan `ndarray` int64. **`snap_to_nearest_nodes()` sudah `.tolist()`**, dan `plan_route()` juga memaksa `int()` pada `snapped_nodes` — kalau menambah jalur snapping baru, pertahankan keduanya.
- `isinstance(np.int64(5), int)` bernilai `False`. Untuk cek tipe asli pakai `type(x) is int`, bukan `isinstance` — dan jangan pernah menuliskan `isinstance(int(x), int)`, itu selalu True dan tidak menguji apa pun.

### Snapping massal WAJIB batch
Scalar `snap_to_nearest_node()` butuh **~470 ms/panggilan** (tree rebuilt tiap panggilan) → 551 hotel = ±4 menit. Batch satu panggilan: 209 + 551 titik = **~0,9 detik** (200-500x lebih cepat). Praproses startup backend harus pakai `snap_to_nearest_nodes()`. Hasil batch **identik** dengan per-titik (0 node berbeda; selisih jarak maks 5,7 mm karena numpy vectorized vs `math`, tidak mengubah node maupun `access_tier`).

### Lookup hotel/wisata: key by `id`, JANGAN by `nama`
`wisata.csv` punya 2 pasang nama duplikat yang sudah didokumentasikan (§12). Skrip validasi yang key-nya `nama` menghasilkan salah banding persis 2 titik — bugnya di skrip, bukan di data. `id` wisata sudah ada; hotel pakai `id` sintetis (usulkan format string `"H001"`..`"H551"` agar tidak tertukar dengan `id` wisata yang integer).

## 7. Kontrak Fungsi Inti

### `algorithms/heuristics.py`
```python
def haversine(lat1, lon1, lat2, lon2) -> float:
    """Jarak meter. R = 6371000, rumus 2R*arcsin(sqrt(a))."""

def haversine_nodes(node_a, node_b) -> float:
    """Versi yang menerima dict atribut node graph (key 'y'=lat, 'x'=lon).
    Inilah yang dipass ke astar() sebagai heuristic_fn."""
```
Validasi dengan 2-3 pasang koordinat berjarak known (mis. dari Google Maps) sebelum dipakai lebih jauh.

### `algorithms/astar.py`
```python
def astar(G, start_node, goal_node, heuristic_fn) -> dict:
    """
    Return: {
        "path_nodes": [node_id, ...],
        "distance_m": float,       # total g_score start->goal
        "nodes_explored": int,     # jumlah node di-POP dari open_set (bukan hanya di-add)
        "search_time_ms": float,
    }
    h(n) = heuristic_fn(G.nodes[n], G.nodes[goal_node])
    """
```
`distance_m` = `None` dan `path_nodes` = `[]` kalau goal unreachable.

### `algorithms/dijkstra.py`
```python
def dijkstra(G, start_node, goal_node) -> dict:
    """Thin wrapper: return astar(G, start_node, goal_node, heuristic_fn=lambda a, b: 0.0).
    Return shape identik astar() supaya eksperimen bisa bandingkan langsung."""
```

### `routing/snapping.py`
```python
def snap_to_nearest_node(G, lat, lon) -> tuple[int, float]:
    """Return (node_id, snap_distance_meter). Pakai ox.distance.nearest_nodes(G, lon, lat)."""

def snap_to_nearest_nodes(G, coords_list) -> tuple[list[int], list[float]]:
    """Batch vectorized. coords_list = [(lat, lon), ...]. WAJIB untuk praproses massal."""

def access_tier(snap_distance_m) -> str:
    """'ok' <=100m | 'offset' <=1km | 'limited' >1km."""
```

### `routing/route.py`
```python
def plan_route(G, start_coords, destination_coords_list, algorithm="astar",
               start_label="", destination_labels=None, snapped_nodes=None) -> dict:
    """Panggil astar()/dijkstra() per-leg berurutan: start->dest1, dest1->dest2, dest2->dest3.
    destination_coords_list: max 3 pasang (lat, lon).
    snapped_nodes: {"start": node_id, "goals": [node_id, ...]} untuk pakai hasil
    batch-snapping yang sudah di-cache; default None = snap sendiri (kontrak asli).
    Raise RouteError untuk: destinasi 0 atau >3, algorithm tak dikenal,
    jumlah label/goals tidak cocok, leg unreachable."""
```

## 8. Kontrak Response JSON — WAJIB PERSIS

```json
{
  "algorithm": "astar",
  "legs": [
    {
      "from": "Hotel XYZ",
      "to": "Candi Prambanan",
      "path_nodes": [123456, 123457],
      "path_coords": [[-7.79, 110.36], [-7.80, 110.37]],
      "distance_m": 12450.3
    }
  ],
  "total_distance_m": 38200.5,
  "search_time_ms": 182.4,
  "nodes_explored": 4821
}
```

`path_coords` = `[lat, lon]`. `path_nodes` = int (cocok dengan node id graph).

**Jangan tambah field apa pun ke response ini** — termasuk `snap_distance_m`. Kontrak §8 dikunci persis 5 key di level atas dan 5 key per leg. Info offset snapping ditaruh di endpoint LIST (§9), frontend cross-reference dari sana.

## 9. Backend (`backend/main.py`) & Frontend

`pip install fastapi uvicorn` dulu — keduanya **belum terinstall** (§5).

FastAPI, load graph & CSV **sekali saat startup** (bukan tiap request). Startup juga batch-snap semua 551 hotel + 209 wisata (~0,9 detik, lihat §6) lalu simpan node id-nya sebagai cache.
```
GET  /hotels        -> id, nama, lat, lon, golongan, snap_distance_m, access_tier
GET  /destinations  -> id, nama, kategori, kabupaten, lat, lon, snap_distance_m, access_tier
POST /route         -> { hotel_id, destination_ids: [id1,id2,id3], algorithm: "astar"|"dijkstra" }
```
Response `/route` = persis §8. `RouteError` -> HTTP 400 dengan pesan yang bisa ditampilkan user.

Frontend Leaflet: center DIY (lat -7.8, lon 110.35, zoom ~10). Form: 1 dropdown hotel, 3 dropdown destinasi (urut kunjungan), radio A*/Dijkstra, tombol. Render tiap leg sebagai polyline **warna berbeda per-leg**. Panel statistik: total distance (km), search time (ms), nodes explored. Error handling: destinasi belum lengkap dipilih, hotel dan destinasi sama persis.

**Keputusan scope (Opsi A, sudah dipilih):** semua 209 destinasi tetap bisa dipilih, TIDAK ada filter default. Titik dengan snap jauh cuma diberi badge/warna tier di UI, jangan disembunyikan.

**Keputusan scope (Opsi A, sudah dipilih):** semua 209 destinasi tetap bisa dipilih, TIDAK ada filter default. Titik dengan snap jauh cuma diberi badge/warna tier di UI, jangan disembunyikan.

## 10. Kontrak Validasi — SUDAH DILEWATI (jangan skip lagi kalau ubah kode)

1. **Cost equality** ✅ `distance_m` A* == Dijkstra == `nx.dijkstra_path_length` (toleransi 1e-6 m) pada 1-leg dan multi-leg (3 leg: 79.041,08 m, `path_nodes` identik).
2. **Edge membership** ✅ semua `G.has_edge(u, v)` + jumlah panjang edge == `distance_m`.
3. **Snap distance** ✅ sudah diaudit penuh, hasilnya di §12.

Hasil baseline yang sudah terukur (hotel `105 Losmen` / Malioboro, jangan di-assume ulang):

| tujuan | distance | A* explored | Dijkstra explored | A* ms | Dij ms |
|---|---|---|---|---|---|
| Candi Sambisari | 12.329,25 m | 6.871 | 51.834 | 134 | 796 |
| Candi Prambanan | 17.030,56 m | 7.652 | 80.340 | 126 | 1.206 |
| Baron Technopark | 55.493,97 m | 63.559 | 148.666 | 1.141 | 1.999 |

Pola untuk laporan: penghematan node A* **turun** seiring jarak (10,5x -> 2,3x). `nodes_explored` implementasi kita boleh beda tipis dari NetworkX (tie-breaker `_counter` kita deterministik, punya NX tidak) — yang wajib identik hanya `distance_m`.

## 11. Eksperimen (`experiments/`, output CSV ke `results/`)

- `compare_astar_dijkstra.py`: 2-3 pasang rute jarak varied — dekat ~2 km, sedang ~15 km, jauh ~40 km lintas kabupaten (pakai destinasi Gunungkidul/Kulon Progo untuk yang jauh, karena hotel cuma di Kota Yogya). Catat `distance_m`, `search_time_ms`, `nodes_explored` untuk kedua algoritma.
- `destination_count_experiment.py`: rute 1, 2, 3 berturut-turut dari hotel sama. Catat pertumbuhan `search_time_ms` seiring jumlah leg.

**Syarat pemilihan pasangan (penting, dari audit §12):** kedua ujung harus `access_tier == "ok"` (snap < 100 m), dan jarak 2/15/40 km diukur **dari node hasil snap**, bukan koordinat mentah. Rute ke titik `limited` (mis. Pantai Bekah, node terdekat 3,3 km) mengukur offset snapping, bukan perilaku algoritma — jangan dipakai sebagai test case. Ada 99 wisata `ok` tersebar di 5 kabupaten, cukup bahan.

## 12. Keterbatasan yang Disengaja — JANGAN "perbaiki" Otomatis

- **Hotel hanya di Kota Yogyakarta** (551 data) — data hotel di 4 kabupaten lain memang tidak tersedia. Sudah diputuskan diterima, catat di laporan.
- 1 baris sudah dibuang dari dataset asli (koordinat salah, menunjuk ke Jakarta) — `wisata.csv` yang ada sudah bersih, jangan re-clean.
- 2 pasang nama tempat mirip di `wisata.csv` (`Masjid Agung Mataram Kota Gede`, `Pantai Widodaren`) — kemungkinan 2 titik berbeda, bukan duplikat murni. Dibiarkan.

### Hasil audit snap distance (gate 3, jangan di-regenerate)
Tier wisata (209): **<100 m: 99** | 100-300 m: 55 | 300 m-1 km: 40 | **>1 km: 15**. Hotel (551) praktis bersih: 502 < 100 m, 551 < 300 m.

Bukan 110 data rusak — akar masalahnya `network_type='drive'` + geometri lokasi. Dari 103 `Wisata Pantai`, hanya 20 yang snap < 100 m; 14 dari 15 titik `>1 km` adalah pantai tebing Gunung Kidul/Kulon Progo (jalan berhenti ratusan meter-hampir 2 km dari pasir). 20 pantai lainnya normal (Pantai Sadeng 7 m). **Bukti bukan koordinat salah**: snap terjauh seluruh dataset cuma 4.052 m (Gunung Merapi = summit, 0 node graph dalam radius 4 km). Kalau ada koordinat nyasar seperti kasus Jakarta, angkanya bakal ratusan km.

Tulis di laporan sebagai "offset snapping akibat keterbatasan `network_type='drive'`", bukan sebagai masalah kualitas data. Jangan regenerate graph untuk "memperbaikinya" — graphml adalah dasar seluruh hasil laporan.

## 13. Urutan Kerja

1. `algorithms/heuristics.py` → test Haversine dgn koordinat known
2. `algorithms/astar.py` → test single-leg, validasi hasil masuk akal
3. `algorithms/dijkstra.py` (reuse astar) → validasi cost sama dgn A*
4. `routing/snapping.py` + `routing/route.py` → test multi-leg (2-3 destinasi)
5. `backend/main.py` → test endpoint via curl/Postman **sebelum** sentuh frontend
6. `frontend/` → integrasi terakhir
7. `experiments/` → setelah semua stabil; hasilnya langsung untuk laporan & PPT
