from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
GRAPH_DIR = ROOT / "graph"
ZIP_PATH = GRAPH_DIR / "diy_road_network.zip"
GRAPHML_PATH = GRAPH_DIR / "diy_road_network.graphml"


def main():
    if GRAPHML_PATH.exists():
        print(f"GraphML sudah ada: {GRAPHML_PATH}")
        return

    if not ZIP_PATH.exists():
        raise FileNotFoundError(
            f"File ZIP tidak ditemukan: {ZIP_PATH}"
        )

    target_name = "diy_road_network.graphml"

    with ZipFile(ZIP_PATH, "r") as z:
        names = z.namelist()

        if target_name not in names:
            raise FileNotFoundError(
                f"{target_name} tidak ditemukan di dalam ZIP."
            )

        z.extract(target_name, GRAPH_DIR)

    print(f"Graph berhasil diekstrak ke: {GRAPHML_PATH}")


if __name__ == "__main__":
    main()
