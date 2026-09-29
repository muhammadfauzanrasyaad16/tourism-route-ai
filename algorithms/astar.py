"""A* (A-star) diimplementasikan manual — lihat AGENTS.md §2.

Aturan keras: TIDAK boleh memakai `nx.astar_path()` / `nx.dijkstra_path()`.
Yang boleh: struktur data graph NetworkX (`G.nodes`, `G[u][v]`, `.items()`).

Struktur data (semua wajib ada agar bisa dijelaskan per baris saat presentasi):
  - `open_set`        : heapq, prioritas f_score = g_score + h_score
  - `closed_set`      : node yang sudah di-POP (bukan hanya saat di-push)
  - `g_score`         : dict, cost terbaik start -> n
  - `f_score`         : dict, g_score + h_score (disimpan agar bisa cek entry basi)
  - `came_from`       : dict, node sebelumnya untuk rekonstruksi path
  - `_counter`        : tie-breaker monoton agar urutan pop deterministik

Catatan MultiDiGraph: graph OSMnx adalah MultiDiGraph, jadi satu pasangan
(u, v) bisa punya beberapa edge paralel dengan panjang berbeda. Semua edge
paralel di-relaksasi dan yang termurah yang menang — kalau cuma mengambil
`G[u][v][0]` panjang hasil bisa bukan yang optimal.

Catatan graf berarah: graph punya ~3.781 jalan satu arah (edge tanpa pasangan
reverse), jadi tetangga yang dikunjungi hanya suksesor searah. Edge balik
TIDAK boleh disintesis.
"""

import heapq
import time


def astar(G, start_node, goal_node, heuristic_fn) -> dict:
    """Cari path terpendek dari `start_node` ke `goal_node` dengan A*.

    `heuristic_fn(node_a_attrs, node_b_attrs) -> float` dipanggil sebagai
    `heuristic_fn(G.nodes[n], G.nodes[goal_node])`, jadi signature-nya dua dict
    atribut node, bukan dua node id.

    Return:
        {
            "path_nodes": [node_id, ...],  # start -> goal, node id int
            "distance_m": float,           # total g_score start->goal, None kalau unreachable
            "nodes_explored": int,         # jumlah node di-POP dari open_set
            "search_time_ms": float,
        }
    """
    started = time.perf_counter()

    goal_attrs = G.nodes[goal_node]
    h_of = lambda n: heuristic_fn(G.nodes[n], goal_attrs)

    g_score = {start_node: 0.0}
    f_score = {start_node: h_of(start_node)}
    came_from = {}
    closed_set = set()

    open_set = []
    _counter = 0
    heapq.heappush(open_set, (f_score[start_node], _counter, start_node))
    nodes_explored = 0

    while open_set:
        _f, _c, current = heapq.heappop(open_set)

        if current in closed_set:
            continue
        if _f > f_score.get(current, float("inf")):
            continue
        closed_set.add(current)
        nodes_explored += 1

        if current == goal_node:
            path_nodes = _reconstruct_path(came_from, start_node, goal_node)
            return {
                "path_nodes": path_nodes,
                "distance_m": g_score[current],
                "nodes_explored": nodes_explored,
                "search_time_ms": (time.perf_counter() - started) * 1000.0,
            }

        current_g = g_score[current]

        for neighbor, edge_keydict in G[current].items():
            for _key, data in edge_keydict.items():
                tentative_g = current_g + data["length"]

                if tentative_g < g_score.get(neighbor, float("inf")):
                    g_score[neighbor] = tentative_g
                    f_score[neighbor] = tentative_g + h_of(neighbor)
                    came_from[neighbor] = current
                    _counter += 1
                    heapq.heappush(
                        open_set, (f_score[neighbor], _counter, neighbor)
                    )

    return {
        "path_nodes": [],
        "distance_m": None,
        "nodes_explored": nodes_explored,
        "search_time_ms": (time.perf_counter() - started) * 1000.0,
    }


def _reconstruct_path(came_from: dict, start_node, goal_node) -> list:
    """Balik jalan `came_from` dari goal ke start, lalu dibalik jadi start -> goal."""
    path = [goal_node]
    node = goal_node
    while node != start_node:
        node = came_from[node]
        path.append(node)
    path.reverse()
    return path
