mapboxgl.accessToken = "pk.eyJ1IjoidmFkaWtmYW5kaWNoIiwiYSI6ImNtbzh5a2U5bzA0c2YycXIweHFnenBxbjkifQ.VPmfULjpK3zz8VHXvY4LCg";

const STORAGE_KEY = "star-route-planner-v2";
const defaultDrivers = Array.from({length:7}, (_,i)=>({id:`d${i+1}`,name:`Водій ${i+1}`}));

const mapError = document.getElementById("mapError");
const routesList = document.getElementById("routesList");
const driversList = document.getElementById("driversList");
const driverSelect = document.getElementById("driverSelect");
const routeNameInput = document.getElementById("routeNameInput");
const newRouteBtn = document.getElementById("newRouteBtn");
const addressInput = document.getElementById("addressInput");
const suggestionsEl = document.getElementById("suggestions");
const searchStatus = document.getElementById("searchStatus");
const routeBtn = document.getElementById("routeBtn");
const clearBtn = document.getElementById("clearBtn");
const stopsList = document.getElementById("stopsList");
const stopCount = document.getElementById("stopCount");
const routeKm = document.getElementById("routeKm");
const routeTime = document.getElementById("routeTime");
const activeRouteTitle = document.getElementById("activeRouteTitle");
const activeRouteMeta = document.getElementById("activeRouteMeta");

function showMapError(text) {
  mapError.textContent = text;
  mapError.classList.remove("hidden");
}
function hideMapError() {
  mapError.classList.add("hidden");
}

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [24.03, 49.84],
  zoom: 9
});
map.addControl(new mapboxgl.NavigationControl(), "top-right");

let markers = [];
let searchTimer = null;
let mapLoaded = false;
let pendingRouteBuild = false;

const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
let state = stored || {
  drivers: defaultDrivers,
  routes: [
    {
      id: "r1",
      name: "Львів 24.04",
      driverId: "d1",
      stops: []
    }
  ],
  activeRouteId: "r1"
};

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveRoute() {
  return state.routes.find(r => r.id === state.activeRouteId) || state.routes[0];
}

map.on("load", () => {
  mapLoaded = true;
  hideMapError();
  renderAll();
  if (pendingRouteBuild) {
    pendingRouteBuild = false;
    buildRoadRoute();
  }
});

map.on("error", (e) => {
  console.error("Mapbox error:", e);
  showMapError("Карта не підвантажила стиль або домен токена не дозволений.");
});

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

function renderDrivers() {
  driverSelect.innerHTML = state.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
  driversList.innerHTML = state.drivers.map(d => `
    <div class="driver-chip">
      <div>${escapeHtml(d.name)}</div>
      <div class="route-item-meta">${state.routes.filter(r => r.driverId === d.id).length} маршрут(ів)</div>
    </div>
  `).join("");
}

function renderRoutes() {
  routesList.innerHTML = state.routes.map(r => {
    const driver = state.drivers.find(d => d.id === r.driverId)?.name || "—";
    const active = r.id === state.activeRouteId ? "active" : "";
    return `
      <div class="route-item ${active}" data-route-id="${r.id}">
        <div><strong>${escapeHtml(r.name)}</strong></div>
        <div class="route-item-meta">Водій: ${escapeHtml(driver)} · Точок: ${r.stops.length}</div>
      </div>
    `;
  }).join("");
}

routesList.addEventListener("click", (e) => {
  const item = e.target.closest("[data-route-id]");
  if (!item) return;
  state.activeRouteId = item.dataset.routeId;
  saveState();
  renderAll();
});

function renderStops() {
  const route = getActiveRoute();
  stopCount.textContent = route.stops.length;
  stopsList.innerHTML = route.stops.map((stop, index) => `
    <div class="stop-item">
      <div class="stop-badge">${index + 1}</div>
      <div class="stop-main">
        <div class="stop-label">${escapeHtml(stop.label)}</div>
        <div class="stop-coords">${stop.lng.toFixed(5)}, ${stop.lat.toFixed(5)}</div>
      </div>
      <div class="stop-actions">
        <button class="icon-btn" data-action="up" data-index="${index}">↑</button>
        <button class="icon-btn" data-action="down" data-index="${index}">↓</button>
        <button class="icon-btn" data-action="remove" data-index="${index}">✕</button>
      </div>
    </div>
  `).join("");
  drawMarkers();
}

stopsList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const route = getActiveRoute();
  const index = Number(btn.dataset.index);
  const action = btn.dataset.action;
  if (action === "remove") {
    route.stops.splice(index, 1);
  } else if (action === "up" && index > 0) {
    [route.stops[index - 1], route.stops[index]] = [route.stops[index], route.stops[index - 1]];
  } else if (action === "down" && index < route.stops.length - 1) {
    [route.stops[index + 1], route.stops[index]] = [route.stops[index], route.stops[index + 1]];
  }
  saveState();
  renderAll();
  if (route.stops.length >= 2) buildRoadRoute();
});

function drawMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
  const route = getActiveRoute();
  route.stops.forEach((stop, index) => {
    const el = document.createElement("div");
    el.style.cssText = `
      width:30px;height:30px;border-radius:999px;background:#0f172a;color:#fff;
      display:flex;align-items:center;justify-content:center;font-weight:800;
      border:3px solid #fff;box-shadow:0 6px 18px rgba(0,0,0,.18);font-size:12px;
    `;
    el.textContent = index + 1;
    markers.push(new mapboxgl.Marker(el).setLngLat([stop.lng, stop.lat]).addTo(map));
  });
}

function setRouteStats(distanceMeters = 0, durationSeconds = 0) {
  routeKm.textContent = distanceMeters ? (distanceMeters / 1000).toFixed(1) : "0";
  routeTime.textContent = durationSeconds ? Math.round(durationSeconds / 60) + " хв" : "0 хв";
}

function renderHeader() {
  const route = getActiveRoute();
  const driver = state.drivers.find(d => d.id === route.driverId)?.name || "—";
  activeRouteTitle.textContent = route.name;
  activeRouteMeta.textContent = `Водій: ${driver} · Mapbox Directions API`;
}

function renderAll() {
  renderDrivers();
  renderRoutes();
  renderStops();
  renderHeader();
  if (getActiveRoute().stops.length < 2) setRouteStats();
}

newRouteBtn.addEventListener("click", () => {
  const name = routeNameInput.value.trim();
  const driverId = driverSelect.value;
  if (!name) {
    alert("Введи назву маршруту");
    return;
  }
  const id = "r" + Date.now();
  state.routes.unshift({ id, name, driverId, stops: [] });
  state.activeRouteId = id;
  routeNameInput.value = "";
  saveState();
  renderAll();
  clearRouteLayer();
  map.flyTo({center:[24.03,49.84], zoom:9});
});

function clearRouteLayer() {
  if (map.getLayer("route-line")) map.removeLayer("route-line");
  if (map.getSource("route")) map.removeSource("route");
}

async function searchAddress() {
  const query = addressInput.value.trim();
  if (query.length < 3) {
    suggestionsEl.innerHTML = "";
    searchStatus.textContent = "";
    return;
  }
  searchStatus.textContent = "Шукаю...";
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&country=ua&limit=5&language=uk`;
    const res = await fetch(url);
    const data = await res.json();
    const features = data.features || [];
    if (!features.length) {
      searchStatus.textContent = "Нічого не знайдено";
      suggestionsEl.innerHTML = "";
      return;
    }
    searchStatus.textContent = "Вибери правильну адресу";
    suggestionsEl.innerHTML = features.map((f, i) => `
      <div class="suggestion" data-index="${i}">
        <div class="suggestion-title">${escapeHtml(f.place_name)}</div>
        <div class="suggestion-meta">${f.center[0].toFixed(5)}, ${f.center[1].toFixed(5)}</div>
      </div>
    `).join("");
    suggestionsEl.dataset.features = JSON.stringify(features.map(f => ({
      label: f.place_name,
      lng: f.center[0],
      lat: f.center[1]
    })));
  } catch (e) {
    searchStatus.textContent = "Помилка пошуку";
  }
}

addressInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchAddress, 450);
});

suggestionsEl.addEventListener("click", (e) => {
  const el = e.target.closest(".suggestion");
  if (!el) return;
  const features = JSON.parse(suggestionsEl.dataset.features || "[]");
  const feature = features[Number(el.dataset.index)];
  if (!feature) return;
  const route = getActiveRoute();
  route.stops.push(feature);
  addressInput.value = "";
  suggestionsEl.innerHTML = "";
  searchStatus.textContent = "";
  saveState();
  renderAll();
  map.flyTo({center:[feature.lng, feature.lat], zoom:12});
  if (route.stops.length >= 2) buildRoadRoute();
});

async function buildRoadRoute() {
  const route = getActiveRoute();
  if (route.stops.length < 2) return;
  if (!mapLoaded) {
    pendingRouteBuild = true;
    return;
  }
  const coords = route.stops.map(s => `${s.lng},${s.lat}`).join(";");
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes.length) {
      alert("Маршрут не знайдено");
      return;
    }
    const r = data.routes[0];
    const geojson = { type: "Feature", geometry: r.geometry };
    if (!map.getSource("route")) {
      map.addSource("route", { type: "geojson", data: geojson });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#111827", "line-width": 5 },
        layout: { "line-cap": "round", "line-join": "round" }
      });
    } else {
      map.getSource("route").setData(geojson);
    }
    const bounds = new mapboxgl.LngLatBounds();
    r.geometry.coordinates.forEach(c => bounds.extend(c));
    map.fitBounds(bounds, { padding: 60 });
    setRouteStats(r.distance, r.duration);
  } catch (e) {
    console.error(e);
    searchStatus.textContent = "Не вдалось побудувати маршрут";
  }
}

routeBtn.addEventListener("click", buildRoadRoute);

clearBtn.addEventListener("click", () => {
  const route = getActiveRoute();
  route.stops = [];
  saveState();
  renderAll();
  setRouteStats();
  suggestionsEl.innerHTML = "";
  searchStatus.textContent = "";
  addressInput.value = "";
  clearRouteLayer();
  map.flyTo({center:[24.03,49.84], zoom:9});
});

renderAll();
