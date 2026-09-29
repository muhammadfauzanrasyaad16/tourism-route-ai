import requests
import statistics

URL = "http://127.0.0.1:8000/route"

tests = {
    1: [198],
    2: [198, 210],
    3: [198, 210, 212],
}

for n_dest, destinations in tests.items():
    results = []

    for i in range(10):
        response = requests.post(
            URL,
            json={
                "hotel_id": "H001",
                "destination_ids": destinations,
                "algorithm": "astar"
            }
        )

        data = response.json()
        results.append(data)

    times = [r["search_time_ms"] for r in results]
    distances = [r["total_distance_m"] for r in results]
    nodes = [r["nodes_explored"] for r in results]

    print(f"\n=== {n_dest} DESTINASI ===")
    print(f"Destinasi       : {destinations}")
    print(f"Jarak rata-rata : {statistics.mean(distances):.2f} m")
    print(f"Waktu rata-rata : {statistics.mean(times):.2f} ms")
    print(f"Waktu minimum   : {min(times):.2f} ms")
    print(f"Waktu maksimum   : {max(times):.2f} ms")
    print(f"Std dev waktu   : {statistics.stdev(times):.2f} ms")
    print(f"Node rata-rata  : {statistics.mean(nodes):.0f}")

