"""Dijkstra sebagai baseline A* — lihat AGENTS.md §2 & §7.

Ini BUKAN implementasi ulang. Dijkstra eksak sama dengan A* yang
heuristic-nya konstan nol, jadi cukup panggil `astar()` dengan
`heuristic_fn` yang selalu mengembalikan 0. memakai satu kode yang sama
penting supaya perbandingan A* vs Dijkstra di `experiments/` benar-benar
apple-to-apple — kalau logikanya ditulis ulang, selisih yang terukur bisa
berasal dari perbedaan implementasi, bukan dari heuristic.

Catatan soal `nodes_explored`: angka ini TIDAK akan selalu sama dengan
`nx.dijkstra_path`. Implementasi di `astar.py` memakai tie-breaker monoton,
sehingga urutan pop deterministik; NetworkX tidak punya itu dan urutan pop-nya
ikut iterasi set. Yang wajib identik adalah `distance_m`, bukan jumlah node.
"""

from .astar import astar


def dijkstra(G, start_node, goal_node) -> dict:
    """Dijkstra asli = A* dengan heuristic konstan nol: h(n) = 0.

    `G` graph NetworkX, `start_node` / `goal_node` node id (int).

    Return dict dengan 4 key yang sama persis seperti `astar()` — `path_nodes`,
    `distance_m`, `nodes_explored`, `search_time_ms` — supaya eksperimen §11
    bisa membandingkan hasil call secara langsung tanpa mapping field.

    `search_time_ms` diukur di dalam `astar()`, jadi rentang timing-nya sama
    persis dengan A* dan overhead wrapper ini tidak ikut terhitung.
    """
    return astar(G, start_node, goal_node, heuristic_fn=lambda _a, _b: 0.0)
