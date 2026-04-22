
mapboxgl.accessToken = "pk.eyJ1IjoidmFkaWtmYW5kaWNoIiwiYSI6ImNtbzh5a2U5bzA0c2YycXIweHFnenBxbjkifQ.VPmfULjpK3zz8VHXvY4LCg";

const STORAGE_KEY = "star-route-clean-working-v1";
const defaultDrivers = Array.from({ length: 7 }, (_, i) => ({ id: `d${i+1}`, name: `Водій ${i+1}`, home: null }));

const $ = (id) => document.getElementById(id);

const routesList = $("routesList");
const driversList = $("driversList");
const driverSelect = $("driverSelect");
const routeNameInput = $("routeNameInput");
const newRouteBtn = $("newRouteBtn");
const deleteRouteBtn = $("deleteRouteBtn");
const addressInput = $("addressInput");
const suggestionsEl = $("suggestions");
const searchStatus = $("searchStatus");
const homeInput = $("homeInput");
const homeSuggestions = $("homeSuggestions");
const homeStatus = $("homeStatus");
const saveHomeBtn = $("saveHomeBtn");
const optimizeBtn = $("optimizeBtn");
const routeBtn = $("routeBtn");
const clearBtn = $("clearBtn");
const stopsList = $("stopsList");
const stopCount = $("stopCount");
const routeKm = $("routeKm");
const routeTime = $("routeTime");
const activeRouteTitle = $("activeRouteTitle");
const activeRouteMeta = $("activeRouteMeta");
const mapError = $("mapError");
const renameModal = $("renameModal");
const renameDriverInput = $("renameDriverInput");
const saveDriverNameBtn = $("saveDriverNameBtn");
const cancelDriverNameBtn = $("cancelDriverNameBtn");

let renameDriverId = null;
let markers = [];
let homeMarker = null;
let searchTimer = null;
let homeTimer = null;
let mapLoaded = false;
let pendingRouteBuild = false;
let selectedHomeFeature = null;

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [24.03, 49.84],
  zoom: 9
});
map.addControl(new mapboxgl.NavigationControl(), "top-right");

const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
let state = stored || {
  drivers: defaultDrivers,
  routes: [{ id: "r1", name: "Львів 24.04", driverId: "d1", deliveries: [] }],
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
  return home ? [home, ...deliveries, home] : deliveries;
}

function showMapError(text) {
  mapError.textContent = text;
  mapError.classList.remove("hidden");
}
function hideMapError() {
  mapError.classList.add("hidden");
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function openRenameModal(driverId) {
  renameDriverId = driverId;
  const driver = getDriver(driverId);
  renameDriverInput.value = driver ? driver.name : "";
  renameModal.classList.remove("hidden");
  setTimeout(() => renameDriverInput.focus(), 0);
}

function closeRenameModal() {
  renameModal.classList.add("hidden");
  renameDriverId = null;
  renameDriverInput.value = "";
}

function renderDrivers() {
  driverSelect.innerHTML = state.drivers.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
  const activeRoute = getActiveRoute();
  driverSelect.value = activeRoute.driverId;
  driversList.innerHTML = state.drivers.map(d => `
    <div class="driver-chip">
      <div class="driver-left">
        <div class="driver-name">${escapeHtml(d.name)}</div>
        <div class="driver-meta">${d.home ? escapeHtml(d.home.label) : "Домашня точка не задана"}</div>
      </div>
      <button class="small-btn" type="button" data-rename-driver="${d.id}">Назва</button>
    </div>
  `).join("");
  const driver = getDriver(activeRoute.driverId);
  homeInput.value = (driver && driver.home && driver.home.label) || "";
}

function renderRoutes() {
  routesList.innerHTML = state.routes.map(r => {
    const driver = getDriver(r.driverId);
    const active = r.id === state.activeRouteId ? "active" : "";
    const homeSet = driver && driver.home ? "дім ок" : "нема дому";
    return `
      <div class="route-item ${active}" data-route-id="${r.id}">
        <div><strong>${escapeHtml(r.name)}</strong></div>
        <div class="route-item-meta">Водій: ${escapeHtml(driver ? driver.name : "—")} · Доставок: ${r.deliveries.length} · ${homeSet}</div>
      </div>
    `;
  }).join("");
}

function renderStops() {
  const deliveries = getActiveRoute().deliveries || [];
  stopCount.textContent = deliveries.length;
  stopsList.innerHTML = deliveries.map((stop, index) => `
    <div class="stop-item">
      <div class="stop-badge">${index + 1}</div>
      <div class="stop-main">
        <div class="stop-label">${escapeHtml(stop.label)}</div>
        <div class="stop-coords">Доставка · ${stop.lng.toFixed(5)}, ${stop.lat.toFixed(5)}</div>
      </div>
      <div class="stop-actions">
        <button class="icon-btn" type="button" data-action="up" data-index="${index}">↑</button>
        <button class="icon-btn" type="button" data-action="down" data-index="${index}">↓</button>
        <button class="icon-btn" type="button" data-action="remove" data-index="${index}">✕</button>
      </div>
    </div>
  `).join("");
  drawMarkers();
}

function drawMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
  if (homeMarker) {
    homeMarker.remove();
    homeMarker = null;
  }
  const route = getActiveRoute();
  const driver = getDriver(route.driverId);
  if (driver && driver.home) {
    const homeEl = document.createElement("div");
    homeEl.textContent = "🏠";
    homeEl.style.cssText = "font-size:24px;line-height:1;";
    homeMarker = new mapboxgl.Marker(homeEl).setLngLat([driver.home.lng, driver.home.lat]).addTo(map);
  }
  route.deliveries.forEach((stop, index) => {
    const el = document.createElement("div");
    el.style.cssText = "width:30px;height:30px;border-radius:999px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;border:3px solid #fff;box-shadow:0 6px 18px rgba(0,0,0,.18);font-size:12px;";
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
  activeRouteMeta.textContent = `Водій: ${driver ? driver.name : "—"} · ${driver && driver.home ? "Дім задано" : "Задай дім"} · Дім → доставки → дім`;
}

function renderAll() {
  renderDrivers();
  renderRoutes();
  renderStops();
  renderHeader();
  if (getOrderedStops(getActiveRoute()).length < 2) setRouteStats();
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
map.on("error", () => showMapError("Карта не підвантажила стиль або домен токена не дозволений."));

driversList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-rename-driver]");
  if (!btn) return;
  openRenameModal(btn.dataset.renameDriver);
});

saveDriverNameBtn.onclick = () => {
  const value = renameDriverInput.value.trim();
  if (!renameDriverId || !value) return;
  const driver = getDriver(renameDriverId);
  if (driver) driver.name = value;
  saveState();
  renderAll();
  closeRenameModal();
};

cancelDriverNameBtn.onclick = () => closeRenameModal();

renameModal.onclick = (e) => {
  if (e.target === renameModal) closeRenameModal();
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !renameModal.classList.contains("hidden")) closeRenameModal();
});

routesList.addEventListener("click", (e) => {
  const item = e.target.closest("[data-route-id]");
  if (!item) return;
  state.activeRouteId = item.dataset.routeId;
  saveState();
  renderAll();
  if (getOrderedStops(getActiveRoute()).length >= 2) buildRoadRoute();
  else clearRouteLayer();
});

driverSelect.onchange = () => {
  const route = getActiveRoute();
  route.driverId = driverSelect.value;
  saveState();
  renderAll();
  if (getOrderedStops(route).length >= 2) buildRoadRoute();
  else clearRouteLayer();
};

stopsList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const route = getActiveRoute();
  const deliveries = route.deliveries;
  const index = Number(btn.dataset.index);
  const action = btn.dataset.action;
  if (action === "remove") deliveries.splice(index, 1);
  else if (action === "up" && index > 0) [deliveries[index - 1], deliveries[index]] = [deliveries[index], deliveries[index - 1]];
  else if (action === "down" && index < deliveries.length - 1) [deliveries[index + 1], deliveries[index]] = [deliveries[index], deliveries[index + 1]];
  saveState();
  renderAll();
  if (getOrderedStops(route).length >= 2) buildRoadRoute();
});

newRouteBtn.onclick = () => {
  const name = routeNameInput.value.trim();
  const driverId = driverSelect.value;
  if (!name) return alert("Введи назву маршруту");
  const id = "r" + Date.now();
  state.routes.unshift({ id, name, driverId, deliveries: [] });
  state.activeRouteId = id;
  routeNameInput.value = "";
  saveState();
  renderAll();
  clearRouteLayer();
  map.flyTo({ center: [24.03, 49.84], zoom: 9 });
};

deleteRouteBtn.onclick = () => {
  if (state.routes.length <= 1) return alert("Останній маршрут видаляти не можна");
  state.routes = state.routes.filter(r => r.id !== state.activeRouteId);
  state.activeRouteId = state.routes[0].id;
  saveState();
  renderAll();
  clearRouteLayer();
  if (getOrderedStops(getActiveRoute()).length >= 2) buildRoadRoute();
};

function clearRouteLayer() {
  if (map.getLayer("route-line")) map.removeLayer("route-line");
  if (map.getSource("route")) map.removeSource("route");
}

async function geocode(query) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&country=ua&limit=5&language=uk`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features || []).map(f => ({ label: f.place_name, lng: f.center[0], lat: f.center[1] }));
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
  } catch {
    searchStatus.textContent = "Помилка пошуку";
  }
}

addressInput.oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchAddress, 350);
};

suggestionsEl.onclick = (e) => {
  const el = e.target.closest(".suggestion");
  if (!el) return;
  const features = JSON.parse(suggestionsEl.dataset.features || "[]");
  const feature = features[Number(el.dataset.index)];
  if (!feature) return;
  getActiveRoute().deliveries.push(feature);
  addressInput.value = "";
  suggestionsEl.innerHTML = "";
  searchStatus.textContent = "";
  saveState();
  renderAll();
  map.flyTo({ center: [feature.lng, feature.lat], zoom: 12 });
  if (getOrderedStops(getActiveRoute()).length >= 2) buildRoadRoute();
};

async function searchHome() {
  const query = homeInput.value.trim();
  if (query.length < 3) {
    homeSuggestions.innerHTML = "";
    homeStatus.textContent = "";
    return;
  }
  homeStatus.textContent = "Шукаю дім...";
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
  } catch {
    homeStatus.textContent = "Помилка пошуку";
  }
}

homeInput.oninput = () => {
  selectedHomeFeature = null;
  clearTimeout(homeTimer);
  homeTimer = setTimeout(searchHome, 350);
};

homeSuggestions.onclick = (e) => {
  const el = e.target.closest(".suggestion");
  if (!el) return;
  const features = JSON.parse(homeSuggestions.dataset.features || "[]");
  selectedHomeFeature = features[Number(el.dataset.homeIndex)];
  if (!selectedHomeFeature) return;
  homeInput.value = selectedHomeFeature.label;
  homeSuggestions.innerHTML = "";
  homeStatus.textContent = "Домашню точку вибрано";
};

saveHomeBtn.onclick = () => {
  const driver = getDriver(getActiveRoute().driverId);
  if (!selectedHomeFeature && !homeInput.value.trim()) return alert("Вкажи домашню точку");
  if (selectedHomeFeature) driver.home = selectedHomeFeature;
  else if (!(driver && driver.home && homeInput.value.trim() === driver.home.label)) return alert("Вибери домашню точку зі списку");
  saveState();
  renderAll();
  if (getOrderedStops(getActiveRoute()).length >= 2) buildRoadRoute();
};

async function optimizeDeliveries() {
  const route = getActiveRoute();
  const driver = getDriver(route.driverId);
  if (!driver || !driver.home) return alert("Спочатку задай домашню точку водія");
  if (route.deliveries.length < 2) return alert("Для оптимізації треба хоча б 2 доставки");

  const coords = [driver.home, ...route.deliveries].map(s => `${s.lng},${s.lat}`).join(";");
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?annotations=duration&access_token=${mapboxgl.accessToken}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const durations = data.durations;
    if (!durations) return alert("Не вдалось оптимізувати");

    const deliveries = route.deliveries.slice();
    let remaining = Array.from({ length: deliveries.length }, (_, i) => i + 1);
    let orderedIdx = [];
    let current = 0;
    while (remaining.length) {
      let bestPos = 0;
      let bestValue = Infinity;
      remaining.forEach((candidate, pos) => {
        const d = durations[current][candidate];
        if (d != null && d < bestValue) {
          bestValue = d;
          bestPos = pos;
        }
      });
      const picked = remaining.splice(bestPos, 1)[0];
      orderedIdx.push(picked - 1);
      current = picked;
    }
    route.deliveries = orderedIdx.map(i => deliveries[i]);
    saveState();
    renderAll();
    buildRoadRoute();
  } catch (e) {
    console.error(e);
    alert("Помилка оптимізації");
  }
}

optimizeBtn.onclick = optimizeDeliveries;

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
    if (!data.routes || !data.routes.length) return alert("Маршрут не знайдено");
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

routeBtn.onclick = buildRoadRoute;

clearBtn.onclick = () => {
  getActiveRoute().deliveries = [];
  saveState();
  renderAll();
  setRouteStats();
  suggestionsEl.innerHTML = "";
  searchStatus.textContent = "";
  addressInput.value = "";
  clearRouteLayer();
  const driver = getDriver(getActiveRoute().driverId);
  if (driver && driver.home) map.flyTo({ center: [driver.home.lng, driver.home.lat], zoom: 10 });
  else map.flyTo({ center: [24.03, 49.84], zoom: 9 });
};

renderAll();
