"""Penyusunan rute multi-leg dari hotel ke maksimal 3 destinasi — AGENTS.md §7.

Urutan kunjungan ditentukan user, bukan dioptimasi sistem (bukan TSP): setiap
leg dihitung berurutan start->dest1, dest1->dest2, dest2->dest3, dan hasil
leg sebelumnya jadi titik awal leg berikutnya.

Format response mengikuti kontrak §8 persis: `path_coords` berurutan [lat, lon],
`path_nodes` berupa node id int, dan field agregat di level atas adalah
PENJUMLAHAN antar-leg — bukan wall-clock. Itu yang membuat
`experiments/destination_count_experiment.py` bisa membaca pertumbuhan
`search_time_ms` seiring jumlah leg.
"""

from algorithms.astar import astar
from algorithms.dijkstra import dijkstra
from algorithms.heuristics import haversine_nodes

from routing.snapping import snap_to_nearest_node

MAX_DESTINATIONS = 3


class RouteError(Exception):
    """Permintaan rute tidak valid atau tidak bisa dilayani."""


def _search_astar(G, start_node, goal_node) -> dict:
    return astar(G, start_node, goal_node, heuristic_fn=haversine_nodes)


# Dispatcher: kedua algoritma dikunci ke signature (G, start, goal) -> dict,
# sehingga perbandingan A* vs Dijkstra benar-benar lewat kode yang sama (§2).
_SEARCHERS = {"astar": _search_astar, "dijkstra": dijkstra}


def _default_label(lat, lon) -> str:
    return f"{lat:.5f},{lon:.5f}"


def plan_route(
    G,
    start_coords,
    destination_coords_list,
    algorithm="astar",
    start_label="",
    destination_labels=None,
    snapped_nodes=None,
) -> dict:
    """Rute berurutan dari `start_coords` ke `destination_coords_list`.

    `start_coords` dan tiap elemen `destination_coords_list` adalah pasangan
    (lat, lon). Panggil astar()/dijkstra() per-leg berurutan: start->dest1,
    dest1->dest2, dest2->dest3.

    `start_label` / `destination_labels` hanya untuk mengisi field "from"/"to"
    di response; koordinat tetap jadi sumber kebenaran routing.

    `snapped_nodes` = {"start": node_id, "goals": [node_id, ...]} untuk memakai
    hasil snapping yang sudah dihitung sebelumnya (mis. cache startup backend,
    yang sudah batch-snap semua titik). Kalau `None` (default), snapping done
    di sini dan kontrak §7 asli berlaku penuh.

    Return format JSON PERSIS seperti kontrak di §8.
    """
    if algorithm not in _SEARCHERS:
        raise RouteError(
            f"algorithm tidak dikenal: {algorithm!r} (pilihan: {sorted(_SEARCHERS)})"
        )

    destination_coords_list = [tuple(c) for c in destination_coords_list]
    n_dest = len(destination_coords_list)
    if not 1 <= n_dest <= MAX_DESTINATIONS:
        raise RouteError(
            f"destinasi harus 1..{MAX_DESTINATIONS}, dapat {n_dest}"
        )

    if destination_labels is None:
        labels = [_default_label(*start_coords)] + [
            _default_label(*c) for c in destination_coords_list
        ]
    else:
        labels = [start_label] + list(destination_labels)
        if len(labels) != n_dest + 1:
            raise RouteError(
                f"destination_labels harus {n_dest + 1} item (start + {n_dest} destinasi), "
                f"dapat {len(labels)}"
            )

    search = _SEARCHERS[algorithm]

    if snapped_nodes is None:
        start_node, _ = snap_to_nearest_node(G, *start_coords)
        goal_nodes = [snap_to_nearest_node(G, *c)[0] for c in destination_coords_list]
    else:
        if "start" not in snapped_nodes:
            raise RouteError("snapped_nodes wajib punya key 'start'")
        goal_ids = list(snapped_nodes.get("goals", ()))
        if len(goal_ids) != n_dest:
            raise RouteError(
                f"snapped_nodes.goals harus {n_dest} item (sama dengan jumlah destinasi), "
                f"dapat {len(goal_ids)}"
            )
        # int() paksa: numpy int64 bukan subclass int dan akan lolos ke
        # path_nodes (endpoint leg diambil langsung dari argumen start/goal),
        # lalu membuat json.dumps gagal di backend.
        start_node = int(snapped_nodes["start"])
        goal_nodes = [int(node) for node in goal_ids]

    legs = []
    total_distance_m = 0.0
    total_time_ms = 0.0
    total_nodes_explored = 0

    for index, goal_node in enumerate(goal_nodes):
        result = search(G, start_node, goal_node)
        if result["distance_m"] is None:
            raise RouteError(
                f"tidak ada rute dari node {start_node} ke {goal_node} "
                f"(leg {index + 1}/{n_dest}, {labels[index]} -> {labels[index + 1]})"
            )

        path_nodes = result["path_nodes"]
        legs.append(
            {
                "from": labels[index],
                "to": labels[index + 1],
                "path_nodes": path_nodes,
                "path_coords": [[G.nodes[n]["y"], G.nodes[n]["x"]] for n in path_nodes],
                "distance_m": result["distance_m"],
            }
        )
        total_distance_m += result["distance_m"]
        total_time_ms += result["search_time_ms"]
        total_nodes_explored += result["nodes_explored"]

        start_node = goal_node

    return {
        "algorithm": algorithm,
        "legs": legs,
        "total_distance_m": total_distance_m,
        "search_time_ms": total_time_ms,
        "nodes_explored": total_nodes_explored,
    }
