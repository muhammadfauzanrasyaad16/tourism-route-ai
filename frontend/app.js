"use strict";

const API_BASE = "http://127.0.0.1:8000";

const DIY_CENTER = [-7.8, 110.35];
const DIY_ZOOM = 10;
const MAX_STOPS = 3;

const css = getComputedStyle(document.documentElement);
const cssVar = (name) => css.getPropertyValue(name).trim();

// Satu warna per leg supaya urutan kunjungan terlihat jelas di peta.
const LEG_COLORS = [cssVar("--leg-1"), cssVar("--leg-2"), cssVar("--leg-3")];
const TIER_COLORS = { ok: cssVar("--ok"), offset: cssVar("--offset-dot"), limited: cssVar("--limited") };
const TIER_LABELS = { ok: "Akses baik", offset: "Offset jalan", limited: "Akses terbatas" };
const ALGO_LABELS = { astar: "A*", dijkstra: "Dijkstra" };
const ORDINALS = ["pertama", "kedua", "ketiga"];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let hotels = [];
let destinations = [];
const plan = { hotel: null, stops: [] };
let lastResult = null; // { payloadKey, payload, data }
let busy = false;

const el = (id) => document.getElementById(id);

// Shared motion: state updates never wait for presentation animations.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const motionDuration = (name) => parseFloat(cssVar(`--motion-${name}`));
const runningMotion = new Map();
function animateUI(element, frames, duration = "content") {
  runningMotion.get(element)?.cancel();
  if (reducedMotion.matches || !element.animate) return;
  const animation = element.animate(frames, {
    duration: motionDuration(duration), easing: cssVar("--ease"),
  });
  runningMotion.set(element, animation);
  const clean = () => {
    if (runningMotion.get(element) === animation) runningMotion.delete(element);
  };
  animation.onfinish = clean;
  animation.oncancel = clean;
}
function revealUI(element, duration = "content", distance = 4) {
  animateUI(element, [
    { opacity: 0, transform: `translateY(${distance}px)` },
    { opacity: 1, transform: "translateY(0)" },
  ], duration);
}
function scrollToContent(element) {
  element.scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "nearest" });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const fmtKm = (m) => (m / 1000).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMs = (ms) => ms.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtInt = (n) => n.toLocaleString("id-ID");
const fmtSnap = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`);
const shortKategori = (k) => String(k || "").replace(/^Wisata\s+/i, "");

function tierBadge(item) {
  return `<span class="tier ${item.access_tier}" title="Node jalan terdekat ${fmtSnap(item.snap_distance_m)}">${TIER_LABELS[item.access_tier]} · ${fmtSnap(item.snap_distance_m)}</span>`;
}

function byId(list, id) {
  return list.find((x) => String(x.id) === String(id)) || null;
}

async function fetchJson(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`HTTP ${res.status} saat memuat ${path}`);
  return res.json();
}

function setStatus(text, cls) {
  const s = el("status");
  s.textContent = text;
  s.className = `status${cls ? " " + cls : ""}`;
  if (text && cls === "error") revealUI(s, "notice", 2);
}

function currentAlgorithm() {
  // Scope terbaru: aplikasi utama selalu A*; Dijkstra hanya mode validasi
  // via tombol "Validasi dengan Dijkstra" (lihat compareAlgorithms).
  return "astar";
}

function currentPayload() {
  if (!plan.hotel) return null;
  return {
    hotel_id: plan.hotel.id,
    destination_ids: plan.stops.map((d) => Number(d.id)),
    algorithm: currentAlgorithm(),
  };
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
const map = L.map("map", {
  zoomControl: false,
  zoomAnimation: !reducedMotion.matches,
  fadeAnimation: !reducedMotion.matches,
  markerZoomAnimation: !reducedMotion.matches,
}).setView(DIY_CENTER, DIY_ZOOM);
reducedMotion.addEventListener("change", () => {
  for (const animation of runningMotion.values()) animation.cancel();
  runningMotion.clear();
  map.stop();
  map.options.zoomAnimation = !reducedMotion.matches;
  map.options.fadeAnimation = !reducedMotion.matches;
  map.options.markerZoomAnimation = !reducedMotion.matches;
});
function mapMotion(target) {
  const distance = map.latLngToContainerPoint(target).distanceTo(map.latLngToContainerPoint(map.getCenter()));
  const shortMove = distance <= Math.min(map.getSize().x, map.getSize().y) / 3;
  return { animate: !reducedMotion.matches && shortMove, duration: motionDuration("map") / 1000 };
}
function fitRoute(bounds) {
  map.stop();
  map.fitBounds(bounds, { ...mapMotion(bounds.getCenter()), maxZoom: 17 });
}
L.control.zoom({ position: "topright" }).addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=cb1_44s1_1_da7d389170033be23e691f47", {
  attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

const destLayer = L.layerGroup().addTo(map); // semua 209 destinasi (warna tier)
const routeLayer = L.layerGroup().addTo(map); // polyline hasil pencarian
const planLayer = L.layerGroup().addTo(map); // pin hotel + destinasi terpilih
let legLines = [];

function pinIcon(label, color) {
  return L.divIcon({
    className: "",
    html: `<div class="map-pin" style="background:${color}"><span>${escapeHtml(label)}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

function destPopup(dest) {
  const wrap = document.createElement("div");
  wrap.innerHTML =
    `<div class="pop-title">${escapeHtml(dest.nama)}</div>` +
    `<div class="pop-sub">${escapeHtml(shortKategori(dest.kategori))} · ${escapeHtml(dest.kabupaten)}</div>` +
    tierBadge(dest);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pop-btn";
  const inPlan = plan.stops.some((s) => s.id === dest.id);
  if (inPlan) {
    btn.textContent = "Sudah ada di rencana";
    btn.disabled = true;
  } else if (plan.stops.length >= MAX_STOPS) {
    btn.textContent = `Maksimal ${MAX_STOPS} destinasi`;
    btn.disabled = true;
  } else {
    btn.textContent = `Jadikan destinasi ${ORDINALS[plan.stops.length]}`;
    btn.addEventListener("click", () => {
      addStop(dest);
      map.closePopup();
    });
  }
  wrap.appendChild(btn);
  return wrap;
}

function renderDestinationMarkers() {
  destLayer.clearLayers();
  for (const d of destinations) {
    const m = L.circleMarker([d.lat, d.lon], {
      radius: 5,
      weight: 1.5,
      color: "#fff",
      fillColor: TIER_COLORS[d.access_tier],
      fillOpacity: 0.9,
    });
    m.bindTooltip(escapeHtml(d.nama), { direction: "top", offset: [0, -4] });
    m.bindPopup(() => destPopup(d));
    m.addTo(destLayer);
  }
}

let previousPinIds = new Set();
function renderPlanPins() {
  const nextPinIds = new Set();
  function enterPin(marker, id) {
    nextPinIds.add(id);
    if (!previousPinIds.has(id)) {
      const content = marker.getElement()?.querySelector(".map-pin span");
      if (content) animateUI(content, [
        { opacity: 0, transform: "rotate(45deg) scale(0.96)" },
        { opacity: 1, transform: "rotate(45deg) scale(1)" },
      ], "component");
    }
  }
  planLayer.clearLayers();
  if (plan.hotel) {
    const marker = L.marker([plan.hotel.lat, plan.hotel.lon], { icon: pinIcon("H", cssVar("--ink")), zIndexOffset: 1000 })
      .bindTooltip(escapeHtml(plan.hotel.nama), { direction: "top", offset: [0, -28] })
      .addTo(planLayer);
    enterPin(marker, `hotel:${plan.hotel.id}`);
  }
  plan.stops.forEach((d, i) => {
    const marker = L.marker([d.lat, d.lon], { icon: pinIcon(String(i + 1), LEG_COLORS[i]), zIndexOffset: 900 })
      .bindTooltip(escapeHtml(d.nama), { direction: "top", offset: [0, -28] })
      .bindPopup(() => destPopup(d))
      .addTo(planLayer);
    enterPin(marker, `dest:${d.id}`);
  });
  previousPinIds = nextPinIds;
}

function revealOnMap(item) {
  const ll = L.latLng(item.lat, item.lon);
  if (!map.getBounds().pad(-0.1).contains(ll)) {
    map.stop();
    map.panTo(ll, mapMotion(ll));
  }
}

function renderRouteLines(data) {
  routeLayer.clearLayers();
  legLines = [];

  data.legs.forEach((leg, i) => {
    const color = LEG_COLORS[i % LEG_COLORS.length];
    L.polyline(leg.path_coords, { color: "#fff", weight: 8, opacity: 0.9, interactive: false }).addTo(routeLayer);
    const line = L.polyline(leg.path_coords, { color, weight: 5, opacity: 0.95, className: "route-leg-line" })
      .bindTooltip(`${i + 1}. ${escapeHtml(leg.to)} — ${fmtKm(leg.distance_m)} km`, { sticky: true })
      .addTo(routeLayer);
    legLines.push(line);

    // Garis putus-putus: offset snapping antara node jalan terakhir dan titik asli destinasi.
    const dest = plan.stops[i];
    const end = leg.path_coords[leg.path_coords.length - 1];
    if (dest && end) {
      L.polyline([end, [dest.lat, dest.lon]], { color, weight: 2, opacity: 0.8, dashArray: "4 6", interactive: false }).addTo(routeLayer);
    }
  });

  const bounds = L.latLngBounds(data.legs.flatMap((l) => l.path_coords));
  fitRoute(bounds.pad(0.12));
}

function emphasizeLeg(index) {
  legLines.forEach((line, i) => {
    line.setStyle({ weight: index === null || i === index ? 5 : 3, opacity: index === null || i === index ? 0.95 : 0.35 });
    if (i === index) line.bringToFront();
  });
}

// ---------------------------------------------------------------------------
// Combobox (ARIA 1.2 combobox + listbox, keyboard: ↑ ↓ Enter Esc)
// ---------------------------------------------------------------------------
function createCombobox({ input, list, getItems, matches, renderOption, groupOf, isDisabled, onSelect, emptyText }) {
  let options = []; // item yang sedang tampil (urutan = urutan navigasi)
  let active = -1;

  function highlight(text, query) {
    const safe = escapeHtml(text);
    const q = query.trim();
    if (!q) return safe;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return safe;
    return escapeHtml(text.slice(0, idx)) + "<mark>" + escapeHtml(text.slice(idx, idx + q.length)) + "</mark>" + escapeHtml(text.slice(idx + q.length));
  }

  function render(query) {
    const q = query.trim().toLowerCase();
    options = getItems().filter((it) => !q || matches(it, q));
    list.innerHTML = "";
    active = -1;

    if (options.length === 0) {
      const li = document.createElement("li");
      li.className = "combo-empty";
      li.textContent = emptyText(query);
      list.appendChild(li);
      return;
    }

    let lastGroup = null;
    options.forEach((it, i) => {
      const group = groupOf ? groupOf(it) : null;
      if (group && group !== lastGroup) {
        const g = document.createElement("li");
        g.className = "combo-group";
        g.setAttribute("role", "presentation");
        g.textContent = group;
        list.appendChild(g);
        lastGroup = group;
      }
      const li = document.createElement("li");
      li.className = "combo-option";
      li.id = `${list.id}-opt-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      if (isDisabled && isDisabled(it)) li.setAttribute("aria-disabled", "true");
      li.innerHTML = renderOption(it, (t) => highlight(t, query));
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // jaga fokus di input
        choose(i);
      });
      li.addEventListener("mousemove", () => setActive(i, false));
      list.appendChild(li);
    });
  }

  function setActive(i, scroll = true) {
    const prev = list.querySelector('[aria-selected="true"]');
    if (prev) prev.setAttribute("aria-selected", "false");
    active = i;
    if (i < 0) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    const li = el(`${list.id}-opt-${i}`);
    li.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", li.id);
    if (scroll) li.scrollIntoView({ block: "nearest" });
  }

  function open(query) {
    const wasHidden = list.hidden;
    render(query);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (wasHidden) revealUI(list, "component", 3);
  }

  function close() {
    runningMotion.get(list)?.cancel();
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function choose(i) {
    const it = options[i];
    if (!it || (isDisabled && isDisabled(it))) return;
    close();
    onSelect(it);
  }

  input.addEventListener("focus", () => {
    input.select();
    open("");
  });
  input.addEventListener("click", () => {
    if (list.hidden) open("");
  });
  input.addEventListener("input", () => open(input.value));
  input.addEventListener("blur", () => {
    close();
    input.dispatchEvent(new CustomEvent("combo:blur"));
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) open(input.value);
      if (!options.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((active + step + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!list.hidden) choose(active >= 0 ? active : 0);
    } else if (e.key === "Escape") {
      close();
    }
  });

  return { close };
}

function textMatch(fields, q) {
  const hay = fields.join(" ").toLowerCase();
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

// ---------------------------------------------------------------------------
// Planner UI
// ---------------------------------------------------------------------------
function renderHotel() {
  const input = el("hotel-input");
  input.value = plan.hotel ? plan.hotel.nama : "";
  input.classList.toggle("has-value", !!plan.hotel);
  el("hotel-meta").innerHTML = plan.hotel
    ? `<span class="dest-sub">${escapeHtml(plan.hotel.golongan || "")} ${tierBadge(plan.hotel)}</span>`
    : "";
}

const ICON_UP = '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
const ICON_DOWN = '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_X = '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

function iconButton(svg, label, onClick, { disabled = false, danger = false } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `icon-btn${danger ? " danger" : ""}`;
  b.innerHTML = svg;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function renderStops() {
  const ol = el("stops");
  const oldPositions = new Map(Array.from(ol.children, (node) => [node.dataset.stopId, node.getBoundingClientRect().top]));
  for (const node of ol.children) runningMotion.get(node)?.cancel();
  ol.innerHTML = "";

  plan.stops.forEach((d, i) => {
    const li = document.createElement("li");
    li.className = "stop";
    li.dataset.stopId = String(d.id);

    const pin = document.createElement("span");
    pin.className = "stop-pin";
    pin.style.background = LEG_COLORS[i];
    pin.setAttribute("aria-hidden", "true");
    pin.textContent = String(i + 1);

    const body = document.createElement("div");
    body.className = "stop-body";
    body.innerHTML = `<span class="stop-label">Destinasi ${ORDINALS[i]}</span>`;

    const card = document.createElement("div");
    card.className = "dest-card";
    const main = document.createElement("div");
    main.className = "dest-card-main";
    main.innerHTML =
      `<div class="dest-name">${escapeHtml(d.nama)}</div>` +
      `<div class="dest-sub">${escapeHtml(shortKategori(d.kategori))} · ${escapeHtml(d.kabupaten)} ${tierBadge(d)}</div>`;

    const actions = document.createElement("div");
    actions.className = "dest-actions";
    actions.append(
      iconButton(ICON_UP, `Pindahkan ${d.nama} ke atas`, () => moveStop(i, -1), { disabled: i === 0 }),
      iconButton(ICON_DOWN, `Pindahkan ${d.nama} ke bawah`, () => moveStop(i, 1), { disabled: i === plan.stops.length - 1 }),
      iconButton(ICON_X, `Hapus ${d.nama}`, () => removeStop(i), { danger: true })
    );

    card.append(main, actions);
    body.appendChild(card);
    li.append(pin, body);
    ol.appendChild(li);
  });

  const full = plan.stops.length >= MAX_STOPS;
  el("add-stop").hidden = full;
  el("add-stop-label").textContent = `Destinasi ${ORDINALS[Math.min(plan.stops.length, MAX_STOPS - 1)]}`;
  el("add-stop-count").textContent = plan.stops.length === 0 ? "" : "(opsional)";
  el("dest-input").placeholder = "Cari destinasi wisata…";
  for (const node of ol.children) {
    const previousTop = oldPositions.get(node.dataset.stopId);
    if (previousTop === undefined) revealUI(node, "content");
    else {
      const offset = previousTop - node.getBoundingClientRect().top;
      // Skip large jumps on short mobile panels rather than sweeping across them.
      if (Math.abs(offset) > 1 && Math.abs(offset) <= window.innerHeight / 3) animateUI(node, [
        { transform: `translateY(${offset}px)` }, { transform: "translateY(0)" },
      ], "reorder");
    }
  }
}

function onPlanChanged() {
  renderHotel();
  renderStops();
  renderPlanPins();
  markStaleIfNeeded();
  setStatus("");
}

function addStop(dest) {
  if (plan.stops.length >= MAX_STOPS || plan.stops.some((s) => s.id === dest.id)) return;
  plan.stops.push(dest);
  onPlanChanged();
  revealOnMap(dest);
}

function removeStop(i) {
  plan.stops.splice(i, 1);
  onPlanChanged();
  if (plan.stops.length < MAX_STOPS) el("dest-input").focus({ preventScroll: true });
}

function moveStop(i, dir) {
  const j = i + dir;
  [plan.stops[i], plan.stops[j]] = [plan.stops[j], plan.stops[i]];
  onPlanChanged();
  // Pertahankan fokus keyboard pada tombol yang sama di posisi baru.
  const btns = el("stops").children[j]?.querySelectorAll(".icon-btn");
  const target = btns && btns[dir < 0 ? 0 : 1];
  if (target && !target.disabled) target.focus();
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
function payloadKey(p) {
  return p ? `${p.hotel_id}|${p.destination_ids.join(",")}|${p.algorithm}` : "";
}

function markStaleIfNeeded() {
  if (!lastResult) return;
  const stale = payloadKey(currentPayload()) !== lastResult.payloadKey;
  const wasHidden = el("stale-note").hidden;
  el("results").classList.toggle("is-stale", stale);
  el("stale-note").hidden = !stale;
  el("compare-btn").disabled = stale;
  if (stale && wasHidden) revealUI(el("stale-note"), "notice", 2);
}

function renderResults(data) {
  el("result-algo").textContent = ALGO_LABELS[data.algorithm] || data.algorithm;
  el("stat-distance").textContent = fmtKm(data.total_distance_m);
  el("stat-time").textContent = fmtMs(data.search_time_ms);
  el("stat-explored").textContent = fmtInt(data.nodes_explored);

  const list = el("leg-list");
  list.innerHTML = "";
  data.legs.forEach((leg, i) => {
    const li = document.createElement("li");
    li.className = "leg";
    li.tabIndex = 0;
    li.innerHTML =
      `<span class="leg-bar" style="background:${LEG_COLORS[i % LEG_COLORS.length]}"></span>` +
      `<span class="leg-route"><span class="leg-step">Leg ${i + 1}</span><br>` +
      `<span class="leg-to">${escapeHtml(leg.to)}</span><br>` +
      `<span class="leg-from">dari ${escapeHtml(leg.from)}</span></span>` +
      `<span class="leg-km">${fmtKm(leg.distance_m)} km</span>`;
    li.addEventListener("mouseenter", () => emphasizeLeg(i));
    li.addEventListener("mouseleave", () => emphasizeLeg(null));
    li.addEventListener("focus", () => emphasizeLeg(i));
    li.addEventListener("blur", () => emphasizeLeg(null));
    const zoomToLeg = () => fitRoute(L.latLngBounds(leg.path_coords).pad(0.15));
    li.addEventListener("click", zoomToLeg);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        zoomToLeg();
      }
    });
    list.appendChild(li);
  });

  const other = data.algorithm === "astar" ? "dijkstra" : "astar";
  el("compare-label").textContent = `Bandingkan dengan ${ALGO_LABELS[other]}`;
  el("compare-table").hidden = true;
  el("compare-table").innerHTML = "";

  el("results").hidden = false;
  el("results").classList.remove("is-stale");
  el("stale-note").hidden = true;
  el("compare-btn").disabled = false;
  revealUI(el("results"));
}

function renderComparison(a, b) {
  // Selalu tampilkan kolom A* lalu Dijkstra.
  const astar = a.algorithm === "astar" ? a : b;
  const dijk = a.algorithm === "astar" ? b : a;
  const row = (label, x, y) => `<tr><td>${label}</td><td>${x}</td><td>${y}</td></tr>`;

  const sameCost = Math.abs(astar.total_distance_m - dijk.total_distance_m) < 1e-6;
  const nodeRatio = dijk.nodes_explored / Math.max(astar.nodes_explored, 1);
  const timeRatio = dijk.search_time_ms / Math.max(astar.search_time_ms, 1e-9);

  const verdict = sameCost
    ? `Jarak identik &mdash; A* menjelajah <b>${nodeRatio.toLocaleString("id-ID", { maximumFractionDigits: 1 })}&times;</b> lebih sedikit node dan <b>${timeRatio.toLocaleString("id-ID", { maximumFractionDigits: 1 })}&times;</b> lebih cepat dibanding Dijkstra.`
    : `Jarak berbeda (${fmtKm(astar.total_distance_m)} vs ${fmtKm(dijk.total_distance_m)} km) &mdash; periksa heuristic.`;

  const box = el("compare-table");
  box.innerHTML =
    `<table><thead><tr><th></th><th>A*</th><th>Dijkstra</th></tr></thead><tbody>` +
    row("Jarak (km)", fmtKm(astar.total_distance_m), fmtKm(dijk.total_distance_m)) +
    row("Waktu (ms)", fmtMs(astar.search_time_ms), fmtMs(dijk.search_time_ms)) +
    row("Node", fmtInt(astar.nodes_explored), fmtInt(dijk.nodes_explored)) +
    `</tbody></table><p class="compare-verdict${sameCost ? "" : " warn"}">${verdict}</p>`;
  box.hidden = false;
  revealUI(box);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------
async function postRoute(payload) {
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
  return data;
}

function setBusy(btn, on) {
  busy = on;
  btn.disabled = on;
  btn.classList.toggle("is-loading", on);
  btn.setAttribute("aria-busy", String(on));
  // Kunci semua input selama request berjalan supaya hasil tidak langsung
  // berstatus stale dan rencana tidak berubah diam-diam.
  const controls = [
    el("hotel-input"),
    el("dest-input"),
    ...document.querySelectorAll("#stops button, .panel-foot .btn:not(#search-btn)"),
  ];
  for (const c of controls) c.disabled = on;
}

function validatePlan() {
  if (!plan.hotel) return { msg: "Pilih hotel keberangkatan terlebih dahulu.", focus: "hotel-input" };
  if (plan.stops.length === 0) return { msg: "Tambahkan minimal 1 destinasi.", focus: "dest-input" };
  const clash = plan.stops.find((d) => d.lat === plan.hotel.lat && d.lon === plan.hotel.lon);
  if (clash) return { msg: `Hotel dan destinasi "${clash.nama}" berada di titik yang sama persis.`, focus: null };
  return null;
}

async function searchRoute() {
  if (busy) return;
  const invalid = validatePlan();
  if (invalid) {
    setStatus(invalid.msg, "error");
    if (invalid.focus) el(invalid.focus).focus();
    return;
  }

  const payload = currentPayload();
  const btn = el("search-btn");
  setBusy(btn, true);
  btn.querySelector(".btn-label").textContent = `Mencari rute (${ALGO_LABELS[payload.algorithm]})…`;
  setStatus("");

  try {
    const data = await postRoute(payload);
    lastResult = { payloadKey: payloadKey(payload), payload, data };
    renderRouteLines(data);
    renderResults(data);
    scrollToContent(el("results"));
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setBusy(btn, false);
    btn.querySelector(".btn-label").textContent = "Cari rute";
  }
}

async function compareAlgorithms() {
  if (busy || !lastResult) return;
  const base = lastResult.data;
  const other = base.algorithm === "astar" ? "dijkstra" : "astar";
  const btn = el("compare-btn");
  setBusy(btn, true);
  el("compare-label").textContent = `Menjalankan ${ALGO_LABELS[other]}…`;

  try {
    const data = await postRoute({ ...lastResult.payload, algorithm: other });
    renderComparison(base, data);
    scrollToContent(el("compare-table"));
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setBusy(btn, false);
    el("compare-label").textContent = `Bandingkan dengan ${ALGO_LABELS[other]}`;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function setupComboboxes() {
  const hotelInput = el("hotel-input");
  createCombobox({
    input: hotelInput,
    list: el("hotel-list"),
    getItems: () => hotels,
    matches: (h, q) => textMatch([h.nama, h.golongan], q),
    renderOption: (h, hl) =>
      `<span class="tier-dot ${h.access_tier}" aria-hidden="true"></span>` +
      `<span class="opt-main"><div class="opt-name">${hl(h.nama)}</div><div class="opt-sub">${escapeHtml(h.golongan || "")}</div></span>`,
    onSelect: (h) => {
      plan.hotel = h;
      onPlanChanged();
      revealOnMap(h);
      hotelInput.blur();
    },
    emptyText: (q) => `Tidak ada hotel yang cocok dengan "${q}". Coba nama hotel atau golongan, mis. "Melati".`,
  });
  hotelInput.addEventListener("combo:blur", renderHotel);

  const destInput = el("dest-input");
  createCombobox({
    input: destInput,
    list: el("dest-list"),
    getItems: () => destinations,
    matches: (d, q) => textMatch([d.nama, d.kategori, d.kabupaten], q),
    groupOf: (d) => d.kabupaten,
    isDisabled: (d) => plan.stops.some((s) => s.id === d.id),
    renderOption: (d, hl) =>
      `<span class="tier-dot ${d.access_tier}" aria-hidden="true"></span>` +
      `<span class="opt-main"><div class="opt-name">${hl(d.nama)}</div><div class="opt-sub">${escapeHtml(shortKategori(d.kategori))}</div></span>` +
      `<span class="opt-dist" title="Jarak ke node jalan terdekat">${fmtSnap(d.snap_distance_m)}</span>`,
    onSelect: (d) => {
      addStop(d);
      destInput.value = "";
      if (plan.stops.length < MAX_STOPS) destInput.focus();
    },
    emptyText: (q) => `Tidak ada destinasi untuk "${q}". Coba kategori ("pantai", "museum") atau kabupaten ("Sleman").`,
  });
  destInput.addEventListener("combo:blur", () => (destInput.value = ""));
}

async function init() {
  setStatus("Memuat data hotel & destinasi…");
  try {
    [hotels, destinations] = await Promise.all([fetchJson("/hotels"), fetchJson("/destinations")]);
  } catch (err) {
    setStatus(`Gagal memuat data dari backend (${API_BASE}). Pastikan server berjalan. Detail: ${err.message}`, "error");
    return;
  }

  // Kelompokkan destinasi per kabupaten di dropdown, urut abjad di dalamnya.
  destinations.sort((a, b) => a.kabupaten.localeCompare(b.kabupaten, "id") || a.nama.localeCompare(b.nama, "id"));
  hotels.sort((a, b) => a.nama.localeCompare(b.nama, "id"));

  setupComboboxes();
  renderDestinationMarkers();

  el("hotel-input").disabled = false;
  el("hotel-input").placeholder = `Cari dari ${hotels.length} hotel…`;
  el("dest-input").disabled = false;
  renderStops();

  el("search-btn").addEventListener("click", searchRoute);
  el("compare-btn").addEventListener("click", compareAlgorithms);
  el("search-btn").disabled = false;
  setStatus(`${hotels.length} hotel & ${destinations.length} destinasi siap.`);
}

const legend = document.querySelector(".map-legend");
legend.addEventListener("toggle", () => {
  if (legend.open) revealUI(legend.querySelector("ul"), "notice", 2);
});
init();
