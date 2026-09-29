"""Paket algoritma pathfinding manual untuk routing wisata DIY.

Sengaja tidak meng-import submodul di sini: `backend/main.py` mengimpor paket
ini, dan import samping bisa menambah waktu start / memicu efek samping tak
diinginkan. Impor langsung ke modul yang dipakai, mis.
`from algorithms.astar import astar`.
"""
