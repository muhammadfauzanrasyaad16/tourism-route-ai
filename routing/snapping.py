"""Snapping koordinat bebas (lat, lon) ke node graph terdekat — AGENTS.md §7.

Dua koordinat yang dipakai di proyek ini:
  - `path_coords` di response JSON  : urutan **[lat, lon]** (ikut Leaflet)
  - `ox.distance.nearest_nodes(G, X, Y)` : **X = lon, Y = lat**

Jadi konversi eksplisit di setiap titik peralihan. `tes.py` adalah contoh
pemakaian yang benar untuk `nearest_nodes`.
"""

import osmnx as ox

from algorithms.heuristics import haversine

# Gate 3 §10: snap distance di atas ambang ini ditandai sebagai kandidat data
# bermasalah. Dicatat di laporan, TIDAK diperbaiki otomatis.
SNAP_DISTANCE_WARN_M = 100.0

# Di atas ini, titik secara praktis tidak terjangkau kendaraan: node jalan
# terdekat sudah bermeter-kilometer (mayoritas pantai tebing di Gunung Kidul /
# Kulon Progo, dan summit seperti Gunung Merapi). Rute tetap bisa dihitung ke
# node terdekat, offset-nya hanya perlu ditampilkan ke user.
SNAP_DISTANCE_LIMITED_M = 1000.0

TIER_OK = "ok"
TIER_OFFSET = "offset"
TIER_LIMITED = "limited"


def access_tier(snap_distance_m: float) -> str:
    """Klasifikasi severitas snap untuk badge UI / field API `access_tier`.

    - "ok"      : <= 100 m  — node jalan pada dasarnya adalah titik tuju
    - "offset"  : <= 1 km   — endpoint rute bergeser ratusan meter
    - "limited" : > 1 km    — tidak ada jalan memadai di sekitar titik (pantai
      tebing, summit); rute berakhir jauh dari lokasi sesungguhnya
    """
    if snap_distance_m <= SNAP_DISTANCE_WARN_M:
        return TIER_OK
    if snap_distance_m <= SNAP_DISTANCE_LIMITED_M:
        return TIER_OFFSET
    return TIER_LIMITED


def snap_to_nearest_node(G, lat, lon) -> tuple[int, float]:
    """Return (node_id, snap_distance_meter). Pakai ox.distance.nearest_nodes(G, lon, lat)."""
    node_id = ox.distance.nearest_nodes(G, lon, lat)
    node_attrs = G.nodes[node_id]
    snap_distance_m = haversine(lat, lon, node_attrs["y"], node_attrs["x"])
    return node_id, snap_distance_m


def snap_to_nearest_nodes(G, coords_list) -> tuple[list[int], list[float]]:
    """Snap banyak titik dalam SATU panggilan vectorized: ([node_id], [snap_m]).

    `coords_list` berisi pasangan (lat, lon) — urutan sama dengan kontrak §8.
    Wajib dipakai untuk praproses startup backend: jalur per-titik butuh
    ~470 ms/panggilan (551 hotel = ±4 menit), batch 760 titik < 1 detik.

    `node_id` hasil nearest_nodes adalah numpy int64 yang BUKAN subclass int
    dan akan membuat `json.dumps` gagal — karena itu keluaran di-`.tolist()`-kan
    ke Python int native, supaya aman masuk ke `astar()`/`plan_route()` dan
    response §8.

    `snap_distance_m` dari osmnx memakai `ox.distance.great_circle`, rumus
    Haversine yang sama dengan `algorithms.heuristics.haversine` (R = 6371000);
    bedanya hanya ~mm karena vectorized numpy vs module math, tidak mengubah
    node terpilih maupun `access_tier`.
    """
    if not coords_list:
        return [], []

    lats = [float(lat) for lat, _ in coords_list]
    lons = [float(lon) for _, lon in coords_list]

    nodes, distances = ox.distance.nearest_nodes(G, lons, lats, return_dist=True)
    return nodes.tolist(), distances.tolist()


def snap_all(G, coords_list) -> tuple[list, list]:
    """Snap banyak titik sekaligus, satu per satu. Balikin (node_ids, snap_distances_m).

    Jalur lambat (~470 ms/titik). Untuk praproses massal pakai
    `snap_to_nearest_nodes` yang vectorized.
    """
    snapped = [snap_to_nearest_node(G, lat, lon) for lat, lon in coords_list]
    return [node for node, _ in snapped], [dist for _, dist in snapped]


def find_distant_snaps(G, points, threshold=SNAP_DISTANCE_WARN_M) -> list[dict]:
    """Titik dengan snap distance > `threshold` — gate 3 §10.

    `points` iterable berisi (label, lat, lon). Hasil diurutkan dari yang
    terjauh, supaya kasus terburuk muncul di paling atas laporan.
    """
    flagged = []
    for label, lat, lon in points:
        node_id, snap_distance_m = snap_to_nearest_node(G, lat, lon)
        if snap_distance_m > threshold:
            flagged.append(
                {
                    "label": label,
                    "lat": lat,
                    "lon": lon,
                    "node_id": node_id,
                    "snap_distance_m": snap_distance_m,
                }
            )
    flagged.sort(key=lambda row: -row["snap_distance_m"])
    return flagged
