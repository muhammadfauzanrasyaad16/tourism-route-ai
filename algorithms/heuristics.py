"""Heuristic untuk A* pada routing wisata DIY.

Satu-satunya heuristic yang dipakai di proyek ini (scope lock AGENTS.md §3):
jarak lintang bumi (great-circle / spherical distance) antara dua titik,
dihitung dengan rumus Haversine. Tidak ada Euclidean, tidak ada weighted-A*.

Rumus Haversine dengan `a` sebagai setengah sudut pusat (haversine of central angle):

    a = sin^2(dphi/2) + cos(phi1) * cos(phi2) * sin^2(dlambda/2)
    d = 2 * R * arcsin(sqrt(a))

`R = 6371000` meter (jari-jari bumi rata-rata). Semua argumen dan hasil dalam
derajat desimal untuk lat/lon, meter untuk jarak.
"""

import math

EARTH_RADIUS_M = 6371000.0


def haversine(lat1, lon1, lat2, lon2) -> float:
    """Jarak meter. R = 6371000, rumus 2R*arcsin(sqrt(a))."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    )
    a = min(1.0, max(0.0, a))

    return 2.0 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def haversine_nodes(node_a: dict, node_b: dict) -> float:
    """Jarak meter antara dua node graph.

    `node_a` / `node_b` adalah dict atribut node OSMnx: koordinat dibaca dari
    key `'y'` (lat) dan `'x'` (lon) — bukan `lat`/`lon`.
    """
    return haversine(node_a["y"], node_a["x"], node_b["y"], node_b["x"])
