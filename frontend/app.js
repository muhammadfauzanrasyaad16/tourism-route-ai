"use strict";

const API_BASE = "http://127.0.0.1:8000";

const DIY_CENTER = [-7.8, 110.35];
const DIY_ZOOM = 10;

// Satu warna per leg supaya urutan kunjungan terlihat jelas di peta.
const LEG_COLORS = ["#1565c0", "#6a1b9a", "#00838f"];

const TIER_LABELS = {
  ok: "akses baik",
  offset: "offset jalan",
  limited: "terbatas — rute berakhir jauh dari lokasi",
};

const map = L.map("map").setView(DIY_CENTER, DIY_ZOOM);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

let hotels = [];
let destinations = [];
let routeLayers = []; // marker/polyline hasil pencarian sebelumnya

const el = (id) => document.getElementById(id);

async function fetchJson(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`HTTP ${res.status} saat memuat ${path}`);
  return res.json();
}

function tierSuffix(item) {
  if (!item.snap_distance_m && item.snap_distance_m !== 0) return "";
  const m = Math.round(item.snap_distance_m);
  return ` · ${TIER_LABELS[item.access_tier] || ""} (jalan terdekat ${m} m)`;
}

function fillSelect(select, items, withEmptyLabel) {
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = withEmptyLabel;
  select.appendChild(placeholder);

  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.nama + tierSuffix(item);
    select.appendChild(opt);
  }
  select.disabled = false;
}

function showSnapInfo(infoEl, item) {
  if (!item) {
    infoEl.textContent = "";
    infoEl.className = "snap-info";
    return;
  }
  infoEl.textContent = `${TIER_LABELS[item.access_tier]} — node jalan terdekat ${Math.round(item.snap_distance_m)} m`;
  infoEl.className = `snap-info ${item.access_tier}`;
}

function byId(list, id) {
  return list.find((x) => String(x.id) === String(id)) || null;
}

function selectedDestinations() {
  const out = [];
  for (const idx of [1, 2, 3]) {
    const sel = el(`dest-${idx}`);
    if (!sel.value) continue;
    if (out.some((d) => d.id === sel.value)) continue; // cegah duplikat di sisi UI
    out.push(byId(destinations, sel.value));
  }
  return out.filter(Boolean);
}

function setStatus(text, cls) {
  const s = el("status");
  s.textContent = text;
  s.className = `status${cls ? " " + cls : ""}`;
}

function clearRouteLayers() {
  for (const layer of routeLayers) map.removeLayer(layer);
  routeLayers = [];
}

function renderRoute(data) {
  clearRouteLayers();

  data.legs.forEach((leg, i) => {
    const color = LEG_COLORS[i % LEG_COLORS.length];
    const line = L.polyline(leg.path_coords, { color, weight: 4, opacity: 0.85 }).addTo(map);
    routeLayers.push(line);

    const fromMarker = L.circleMarker(leg.path_coords[0], { radius: 6, color, fillColor: color, fillOpacity: 1 });
    const toMarker = L.marker(leg.path_coords[leg.path_coords.length - 1]);
    toMarker.bindPopup(`<b>${leg.to}</b><br>${(leg.distance_m / 1000).toFixed(2)} km dari ${leg.from}`);
    fromMarker.addTo(map);
    routeLayers.push(fromMarker, toMarker);
  });

  const bounds = L.latLngBounds(data.legs.flatMap((l) => l.path_coords));
  map.fitBounds(bounds.pad(0.1));

  el("stat-distance").textContent = `${(data.total_distance_m / 1000).toFixed(2)} km`;
  el("stat-time").textContent = `${data.search_time_ms.toFixed(1)} ms`;
  el("stat-explored").textContent = data.nodes_explored.toLocaleString("id-ID");
  el("stat-algorithm").textContent = data.algorithm;

  const list = el("leg-list");
  list.innerHTML = "";
  data.legs.forEach((leg, i) => {
    const li = document.createElement("li");
    const swatch = `<span class="swatch" style="background:${LEG_COLORS[i % LEG_COLORS.length]}"></span>`;
    li.innerHTML = `${swatch}<b>${leg.from}</b> &rarr; <b>${leg.to}</b> — ${(leg.distance_m / 1000).toFixed(2)} km`;
    list.appendChild(li);
  });
  el("stats").classList.remove("hidden");
}

async function searchRoute() {
  const hotel = byId(hotels, el("hotel-select").value);
  const dests = selectedDestinations();

  if (!hotel) {
    setStatus("Pilih hotel dulu.", "error");
    return;
  }
  if (dests.length === 0) {
    setStatus("Pilih minimal 1 destinasi.", "error");
    return;
  }

  const algorithm = document.querySelector('input[name="algorithm"]:checked').value;
  const payload = {
    hotel_id: hotel.id,
    destination_ids: dests.map((d) => Number(d.id)),
    algorithm,
  };

  const btn = el("search-btn");
  btn.disabled = true;
  setStatus("Mencari rute...", "loading");

  try {
    const res = await fetch(`${API_BASE}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = typeof data.detail === "string" ? data.detail : "Permintaan ditolak server.";
      throw new Error(msg);
    }
    setStatus("");
    renderRoute(data);
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  try {
    [hotels, destinations] = await Promise.all([fetchJson("/hotels"), fetchJson("/destinations")]);
  } catch (err) {
    setStatus(`Gagal memuat data backend (${API_BASE}): ${err.message}`, "error");
    return;
  }

  fillSelect(el("hotel-select"), hotels, "-- pilih hotel --");
  fillSelect(el("dest-1"), destinations, "-- pilih destinasi --");
  fillSelect(el("dest-2"), destinations, "-- kosong --");
  fillSelect(el("dest-3"), destinations, "-- kosong --");

  el("hotel-select").addEventListener("change", (e) =>
    showSnapInfo(el("hotel-info"), byId(hotels, e.target.value))
  );
  for (const idx of [1, 2, 3]) {
    el(`dest-${idx}`).addEventListener("change", (e) =>
      showSnapInfo(el(`dest-${idx}-info`), byId(destinations, e.target.value))
    );
  }

  el("search-btn").addEventListener("click", searchRoute);
  el("search-btn").disabled = false;
  setStatus(`${hotels.length} hotel & ${destinations.length} destinasi dimuat.`);
}

init();
