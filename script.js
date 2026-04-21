mapboxgl.accessToken = "pk.eyJ1IjoidmFkaWtmYW5kaWNoIiwiYSI6ImNtbzh5a2U5bzA0c2YycXIweHFnenBxbjkifQ.VPmfULjpK3zz8VHXvY4LCg";

const STORAGE_KEY = "star-route-planner-v3";
const defaultDrivers = Array.from({ length: 7 }, (_, i) => ({
  id: `d${i + 1}`,
  name: `Водій ${i + 1}`,
  home: null
}));

const mapError = document.getElementById("mapError");
const routesList = document.getElementById("routesList");
const driversList = document.getElementById("driversList");
const driverSelect = document.getElementById("driverSelect");
const routeNameInput = document.getElementById("routeNameInput");
const newRouteBtn = document.getElementById("newRouteBtn");
const addressInput = document.getElementById("addressInput");
const suggestionsEl = document.getElementById("suggestions");
const searchStatus = document.getElementById("searchStatus");
const homeInput = document.getElementById("homeInput");
const homeSuggestions = document.getElementById("homeSuggestions");
const homeStatus = document.getElementById("homeStatus");
const saveHomeBtn = document.getElementById("saveHomeBtn");
const optimizeBtn = document.getElementById("optimizeBtn");
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
let homeTimer = null;
let mapLoaded = false;
let pendingRouteBuild = false;
let selectedHomeFeature = null;

const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
let state = stored || {
  drivers: defaultDrivers,
  routes: [
    {
      id: "r1",
      name: "Львів 24.04",
      driverId: "d1",
      deliveries: []
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

function getDriver(driverId) {
  return state.drivers.find(d => d.id === driverId);
}

function getOrderedStops(route) {
  const driver = getDriver(route.driverId);
  const home = driver && driver.home;
  const deliveries = route.deliveries || [];
  if (!home) return deliveries;
  return [
    { ...home, type: "home-start" },
    ...deliveries.map(x => ({ ...x, type: "delivery" })),
    { ...home, type: "home-end" }
  ];
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
  return text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderDrivers() {
  driverSelect.innerHTML = state.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
  const activeRoute = getActiveRoute();
  driverSelect.value = activeRoute.driverId;
  driversList.innerHTML = state.drivers.map(d => `
    <div class="driver-chip">
      <div>
        <div><strong>${escapeHtml(d.name)}</strong></div>
        <div class="driver-meta">${d.home ? escapeHtml(d.home.label) : "Домашня точка не задана"}</div>
      </div>
      <div class="driver-meta">${state.routes.filter(r => r.driverId === d.id).length} маршрут(ів)</div>
    </div>
  `).join("");
  const driver = getDriver(activeRoute.driverId);
  homeInput.value = (driver && driver.home && driver.home.label) || "";
}

function renderRoutes() {
  routesList.innerHTML = state.routes.map(r => {
    const driver = getDriver(r.driverId);
    const active = r.id === state.activeRouteId ? "active" : "";
    const homeSet = driver && driver.home ? "база ок" : "нема бази";
    return `
      <div class="route-item ${active}" data-route-id="${r.id}">
        <div><strong>${escapeHtml(r.name)}</strong></div>
        <div class="route-item-meta">Водій: ${escapeHtml(driver ? driver.name : "—")} · Доставок: ${r.deliveries.length} · ${homeSet}</div>
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
  if (getOrderedStops(getActiveRoute()).length >= 2) buildRoadRoute();
  else clearRouteLayer();
});

driverSelect.addEventListener("change", () => {
  const route = getActiveRoute();
  route.driverId = driverSelect.value;
  saveState();
  renderAll();
  if (getOrderedStops(route).length >= 2) buildRoadRoute();
  else clearRouteLayer();
});

function renderStops() {
  const route = getActiveRoute();
  const ordered = getOrderedStops(route);
  stopCount.textContent = ordered.length;
  stopsList.innerHTML = ordered.map((stop, index) => {
    const isHome = stop.type === "home-start" || stop.type === "home-end";
    const badgeClass = isHome ? "stop-badge home" : "stop-badge";
    const tag = stop.type === "home-start" ? "Старт" : stop.type === "home-end" ? "Фініш" : "Доставка";
    const controls = isHome ? "" : `
      <div class="stop-actions">
        <button class="icon-btn" data-action="up" data-index="${index - 1}">↑</button>
        <button class="icon-btn" data-action="down" data-index="${index - 1}">↓</button>
        <button class="icon-btn" data-action="remove" data-index="${index - 1}">✕</button>
      </div>
    `;
    return `
      <div class="stop-item">
        <div class="${badgeClass}">${index + 1}</div>
        <div class="stop-main">
          <div class="stop-label">${escapeHtml(stop.label)}</div>
          <div class="stop-coords">${tag} · ${stop.lng.toFixed(5)}, ${stop.lat.toFixed(5)}</div>
        </div>
        ${controls}
      </div>
    `;
  }).join("");
  drawMarkers();
}

stopsList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const route = getActiveRoute();
  const deliveries = route.deliveries;
  const index = Number(btn.dataset.index);
  const action = btn.dataset.action;
  if (action === "remove") {
    deliveries.splice(index, 1);
  } else if (action === "up" && index > 0) {
    [deliveries[index - 1], deliveries[index]] = [deliveries[index], deliveries[index - 1]];
  } else if (action === "down" && index < deliveries.length - 1) {
    [deliveries[index + 1], deliveries[index]] = [deliveries[index], deliveries[index + 1]];
  }
  saveState();
  renderAll();
  if (getOrderedStops(route).length >= 2) buildRoadRoute();
});

function drawMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
  const ordered = getOrderedStops(getActiveRoute());
  ordered.forEach((stop, index) => {
    const el = document.createElement("div");
    const bg = stop.type === "home-start" || stop.type === "home-end" ? "#16a34a" : "#0f172a";
    el.style.cssText = `
      width:30px;height:30px;border-radius:999px;background:${bg};color:#fff;
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
  const driver = getDriver(route.driverId);
  activeRouteTitle.textContent = route.name;
  activeRouteMeta.textContent = `Водій: ${driver ? driver.name : "—"} · ${driver && driver.home ? "База задана" : "Задай базу"} · База → доставки → база`;
}

function renderAll() {
  renderDrivers();
  renderRoutes();
  renderStops();
  renderHeader();
  if (getOrderedStops(getActiveRoute()).length < 2) setRouteStats();
}

newRouteBtn.addEventListener("click", () => {
  const name = routeNameInput.value.trim();
  const driverId = driverSelect.value;
  if (!name) {
    alert("Введи назву маршруту");
    return;
  }
  const id = "r" + Date.now();
  state.routes.unshift({ id, name, driverId, deliveries: [] });
  state.activeRouteId = id;
  routeNameInput.value = "";
  saveState();
  renderAll();
  clearRouteLayer();
  map.flyTo({ center: [24.03, 49.84], zoom: 9 });
});

function clearRouteLayer() {
  if (map.getLayer("route-line")) map.removeLayer("route-line");
  if (map.getSource("route")) map.removeSource("route");
}

async function geocode(query) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&country=ua&limit=5&language=uk`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features || []).map(f => ({
    label: f.place_name,
    lng: f.center[0],
    lat: f.center[1]
  }));
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
    const features = await geocode(query);
    if (!features.length) {
      searchStatus.textContent = "Нічого не знайдено";
      suggestionsEl.innerHTML = "";
      return;
    }
    searchStatus.textContent = "Вибери правильну адресу";
    suggestionsEl.innerHTML = features.map((f, i) => `
      <div class="suggestion" data-index="${i}">
        <div class="suggestion-title">${escapeHtml(f.label)}</div>
        <div class="suggestion-meta">${f.lng.toFixed(5)}, ${f.lat.toFixed(5)}</div>
      </div>
    `).join("");
    suggestionsEl.dataset.features = JSON.stringify(features);
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
  route.deliveries.push(feature);
  addressInput.value = "";
  suggestionsEl.innerHTML = "";
  searchStatus.textContent = "";
  saveState();
  renderAll();
  map.flyTo({ center: [feature.lng, feature.lat], zoom: 12 });
  if (getOrderedStops(route).length >= 2) buildRoadRoute();
});

async function searchHome() {
  const query = homeInput.value.trim();
  if (query.length < 3) {
    homeSuggestions.innerHTML = "";
    homeStatus.textContent = "";
    return;
  }
  homeStatus.textContent = "Шукаю базу...";
  try {
    const features = await geocode(query);
    if (!features.length) {
      homeStatus.textContent = "Нічого не знайдено";
      homeSuggestions.innerHTML = "";
      return;
    }
    homeStatus.textContent = "Вибери правильну домашню точку";
    homeSuggestions.innerHTML = features.map((f, i) => `
      <div class="suggestion" data-home-index="${i}">
        <div class="suggestion-title">${escapeHtml(f.label)}</div>
        <div class="suggestion-meta">${f.lng.toFixed(5)}, ${f.lat.toFixed(5)}</div>
      </div>
    `).join("");
    homeSuggestions.dataset.features = JSON.stringify(features);
  } catch (e) {
    homeStatus.textContent = "Помилка пошуку";
  }
}

homeInput.addEventListener("input", () => {
  selectedHomeFeature = null;
  clearTimeout(homeTimer);
  homeTimer = setTimeout(searchHome, 450);
});

homeSuggestions.addEventListener("click", (e) => {
  const el = e.target.closest(".suggestion");
  if (!el) return;
  const features = JSON.parse(homeSuggestions.dataset.features || "[]");
  selectedHomeFeature = features[Number(el.dataset.homeIndex)];
  if (!selectedHomeFeature) return;
  homeInput.value = selectedHomeFeature.label;
  homeSuggestions.innerHTML = "";
  homeStatus.textContent = "Домашню точку вибрано";
});

saveHomeBtn.addEventListener("click", () => {
  const route = getActiveRoute();
  const driver = getDriver(route.driverId);
  if (!selectedHomeFeature && !homeInput.value.trim()) {
    alert("Вкажи домашню точку");
    return;
  }
  if (selectedHomeFeature) {
    driver.home = selectedHomeFeature;
  } else if (driver && driver.home && homeInput.value.trim() === driver.home.label) {
    // existing kept
  } else {
    alert("Вибери домашню точку зі списку");
    return;
  }
  saveState();
  renderAll();
  if (getOrderedStops(route).length >= 2) buildRoadRoute();
});

async function optimizeDeliveries() {
  const route = getActiveRoute();
  const driver = getDriver(route.driverId);
  if (!driver || !driver.home) {
    alert("Спочатку задай домашню точку водія");
    return;
  }
  if (route.deliveries.length < 2) {
    alert("Для оптимізації треба хоча б 2 доставки");
    return;
  }

  const coords = [driver.home, ...route.deliveries].map(s => `${s.lng},${s.lat}`).join(";");
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?annotations=duration,distance&access_token=${mapboxgl.accessToken}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const durations = data.durations;
    if (!durations) {
      alert("Не вдалось оптимізувати");
      return;
    }

    const n = route.deliveries.length;
    const remaining = Array.from({ length: n }, (_, i) => i + 1);
    const ordered = [];
    let current = 0;

    while (remaining.length) {
      let bestIdx = 0;
      let bestValue = Infinity;
      remaining.forEach((candidate, idx) => {
        const d = durations[current][candidate];
        if (d != null && d < bestValue) {
          bestValue = d;
          bestIdx = idx;
        }
      });
      const picked = remaining.splice(bestIdx, 1)[0];
      ordered.push(route.deliveries[picked - 1]);
      current = picked;
    }

    route.deliveries = ordered;
    saveState();
    renderAll();
    buildRoadRoute();
  } catch (e) {
    console.error(e);
    alert("Помилка оптимізації");
  }
}

optimizeBtn.addEventListener("click", optimizeDeliveries);

async function buildRoadRoute() {
  const ordered = getOrderedStops(getActiveRoute());
  if (ordered.length < 2) return;
  if (!mapLoaded) {
    pendingRouteBuild = true;
    return;
  }
  const coords = ordered.map(s => `${s.lng},${s.lat}`).join(";");
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
  route.deliveries = [];
  saveState();
  renderAll();
  setRouteStats();
  suggestionsEl.innerHTML = "";
  searchStatus.textContent = "";
  addressInput.value = "";
  clearRouteLayer();
  const driver = getDriver(route.driverId);
  if (driver && driver.home) {
    map.flyTo({ center: [driver.home.lng, driver.home.lat], zoom: 10 });
  } else {
    map.flyTo({ center: [24.03, 49.84], zoom: 9 });
  }
});

renderAll();
