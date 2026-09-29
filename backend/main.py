"""Backend API routing wisata DIY — AGENTS.md §9.

FastAPI. Graph + CSV + snapping dimuat/dihitung SEKALI saat startup lewat
`lifespan`, bukan tiap request — load graphml butuh ~30 detik dan RAM besar,
dan snapping 760 titik harus batch (lihat §6).

PENTING (kenali sebelum ubah):
- Semua endpoint route didefinisikan `def` BIASA, bukan `async def`. Pencarian
  A* itu CPU-bound (~0,1-3 s); sebagai sync, FastAPI melemparnya ke thread pool
  sehingga server tetap responsif. Kalau dijadikan `async def`, pencarian akan
  memblokir event loop.
- Response `/route` dikembalikan mentah TANPA `response_model` — kontrak §8
  (persis 5 key atas + 5 key per leg) dijaga oleh test, bukan oleh pydantic,
  supaya tidak ada koersi tipe numpy yang tersembunyi. Semua nilai sudah
  terbukti `json.dumps`-safe (lihat §6 jebakan tipe data).
- Lookup hotel/wisata di-key `id`, BUKAN `nama` — ada 2 pasang nama duplikat
  (§12) yang akan menabrak kalau dikunci by nama.
"""

from contextlib import asynccontextmanager
from pathlib import Path

import osmnx as ox
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from routing.route import RouteError, plan_route
from routing.snapping import access_tier, snap_to_nearest_nodes

# Aset (graph + CSV) TIDAK memakai path relatif-cwd: uvicorn tidak menjamin cwd
# = repo root, jadi patokannya file ini -> dua level ke atas = repo root.
BASE_DIR = Path(__file__).resolve().parent.parent
GRAPH_PATH = BASE_DIR / "graph" / "diy_road_network.graphml"
HOTEL_CSV = BASE_DIR / "data" / "hotel.csv"
WISATA_CSV = BASE_DIR / "data" / "wisata.csv"

# Cache global. Diisi sekali di `lifespan`, dibaca tiap request.
STATE: dict = {}


def _hotel_id(row_index: int) -> str:
    """Id sintetis hotel: H001..H551 mengikuti urutan baris CSV.

    String berprefix supaya tidak tertukar dengan id wisata yang integer (§6).
    Stabil selama CSV tidak diurut ulang.
    """
    return f"H{row_index + 1:03d}"


def _load_state() -> None:
    """Muat graph + CSV, batch-snap semua titik, bangun cache di-key id."""
    print("Memuat graph (±30 detik)...")
    graph = ox.load_graphml(str(GRAPH_PATH))

    hotels_df = pd.read_csv(HOTEL_CSV)
    wisata_df = pd.read_csv(WISATA_CSV)

    hotel_coords = [(float(r.lat), float(r.lon)) for r in hotels_df.itertuples()]
    wisata_coords = [(float(r.lat), float(r.lon)) for r in wisata_df.itertuples()]

    # Batch snapping sekaligus: WAJIB (per-titik = ±4,3 menit, batch < 1 detik).
    hotel_nodes, hotel_dists = snap_to_nearest_nodes(graph, hotel_coords)
    wisata_nodes, wisata_dists = snap_to_nearest_nodes(graph, wisata_coords)

    hotels: dict[str, dict] = {}
    for i, r in enumerate(hotels_df.itertuples()):
        hid = _hotel_id(i)
        hotels[hid] = {
            "id": hid,
            "nama": r.nama,
            "lat": float(r.lat),
            "lon": float(r.lon),
            "golongan": r.golongan,
            "snap_distance_m": hotel_dists[i],
            "access_tier": access_tier(hotel_dists[i]),
            "node": hotel_nodes[i],
        }

    destinations: dict[int, dict] = {}
    for i, r in enumerate(wisata_df.itertuples()):
        did = int(r.id)
        destinations[did] = {
            "id": did,
            "nama": r.nama,
            "kategori": r.kategori,
            "kabupaten": r.kabupaten,
            "lat": float(r.lat),
            "lon": float(r.lon),
            "snap_distance_m": wisata_dists[i],
            "access_tier": access_tier(wisata_dists[i]),
            "node": wisata_nodes[i],
        }

    STATE.update(graph=graph, hotels=hotels, destinations=destinations)
    print(
        f"Ready: {graph.number_of_nodes():,} nodes, {len(hotels)} hotel, "
        f"{len(destinations)} destinasi."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_state()
    yield


app = FastAPI(title="DIY Tourism Route Planner", lifespan=lifespan)

# Fase 3 frontend bisa dibuka dari Live Server / file:// tanpa balik ke sini.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RouteRequest(BaseModel):
    hotel_id: str
    destination_ids: list[int]
    algorithm: str = "astar"


def _public_point_fields(row: dict) -> dict:
    """Field titik yang aman untuk UI — `node` internal dibuang."""
    return {
        "id": row["id"],
        "nama": row["nama"],
        "lat": row["lat"],
        "lon": row["lon"],
        "snap_distance_m": row["snap_distance_m"],
        "access_tier": row["access_tier"],
    }


@app.get("/hotels")
def get_hotels() -> list:
    return [
        {**_public_point_fields(row), "golongan": row["golongan"]}
        for row in STATE["hotels"].values()
    ]


@app.get("/destinations")
def get_destinations() -> list:
    return [
        {
            **_public_point_fields(row),
            "kategori": row["kategori"],
            "kabupaten": row["kabupaten"],
        }
        for row in STATE["destinations"].values()
    ]


@app.post("/route")
def post_route(req: RouteRequest) -> dict:
    hotels = STATE["hotels"]
    destinations = STATE["destinations"]
    graph = STATE["graph"]

    hotel = hotels.get(req.hotel_id)
    if hotel is None:
        raise HTTPException(400, f"Hotel tidak dikenal: {req.hotel_id}")

    if not req.destination_ids:
        raise HTTPException(400, "Pilih minimal 1 destinasi.")
    if len(set(req.destination_ids)) != len(req.destination_ids):
        raise HTTPException(400, "Ada destinasi yang dipilih lebih dari satu kali.")

    chosen = []
    for did in req.destination_ids:
        row = destinations.get(did)
        if row is None:
            raise HTTPException(400, f"Destinasi tidak dikenal: {did}")
        chosen.append(row)

    dest_coords = [(row["lat"], row["lon"]) for row in chosen]
    snapped = {
        "start": hotel["node"],
        "goals": [row["node"] for row in chosen],
    }

    try:
        return plan_route(
            graph,
            (hotel["lat"], hotel["lon"]),
            dest_coords,
            algorithm=req.algorithm,
            start_label=hotel["nama"],
            destination_labels=[row["nama"] for row in chosen],
            snapped_nodes=snapped,
        )
    except RouteError as exc:
        # Pesan di dalam RouteError sudah berbahasa Indonesia & user-readable.
        raise HTTPException(400, str(exc))
