
mapboxgl.accessToken = "pk.eyJ1IjoidmFkaWtmYW5kaWNoIiwiYSI6ImNtbzh5a2U5bzA0c2YycXIweHFnenBxbjkifQ.VPmfULjpK3zz8VHXvY4LCg";

const STORAGE_KEY = "star-route-pro-v1";
const defaultDrivers = Array.from({ length: 7 }, (_, i) => ({ id: `d${i+1}`, name: `Водій ${i+1}`, home: null }));
const $ = (id) => document.getElementById(id);

const appShell = $("appShell");
const routesList = $("routesList");
const driversList = $("driversList");
const driverSelect = $("driverSelect");
const routeFilterDriver = $("routeFilterDriver");
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
const startTimeInput = $("startTimeInput");
const routeStatusSelect = $("routeStatusSelect");
const stopsList = $("stopsList");
const stopCount = $("stopCount");
const routeKm = $("routeKm");
const routeTime = $("routeTime");
const departureTimeLabel = $("departureTimeLabel");
const finishTimeLabel = $("finishTimeLabel");
const workTimeLabel = $("workTimeLabel");
const activeRouteTitle = $("activeRouteTitle");
const activeRouteMeta = $("activeRouteMeta");
const mapError = $("mapError");
const renameModal = $("renameModal");
const renameDriverInput = $("renameDriverInput");
const saveDriverNameBtn = $("saveDriverNameBtn");
const cancelDriverNameBtn = $("cancelDriverNameBtn");
const googleMapsBtn = $("googleMapsBtn");
const shareRouteBtn = $("shareRouteBtn");
const driverModeBtn = $("driverModeBtn");
const shareToast = $("shareToast");

let renameDriverId = null;
let homeMarker = null;
let searchTimer = null;
let homeTimer = null;
let mapLoaded = false;
let pendingRouteBuild = false;
let selectedHomeFeature = null;
let routeLegDurations = [];
let routeLegDistances = [];
let isDriverMode = false;
let dragIndex = null;

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
  routeFilterDriverId: "all",
  routes: [{ id: "r1", name: "Львів 24.04", driverId: "d1", deliveries: [], startTime: "09:00", status: "Заплановано" }],
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
function showToast(text) {
  shareToast.textContent = text;
  shareToast.classList.remove("hidden");
  setTimeout(() => shareToast.classList.add("hidden"), 1800);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function parseTimeToMinutes(str) {
  const [h, m] = (str || "09:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatMinutes(mins) {
  const total = ((mins % (24*60)) + (24*60)) % (24*60);
  const h = Math.floor(total / 60).toString().padStart(2, "0");
  const m = Math.floor(total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function getArrivalTimes(route) {
  const deliveries = route.deliveries || [];
  const startMinutes = parseTimeToMinutes(route.startTime || "09:00");
  let current = startMinutes;
  const result = [];
  for (let i = 0; i < deliveries.length; i++) {
    const legSeconds = routeLegDurations[i] || 0;
    current += Math.round(legSeconds / 60);
    result.push(formatMinutes(current));
  }
  return result;
}

function getLegTexts(route) {
  const deliveries = route.deliveries || [];
  return deliveries.map((_, i) => {
    const km = routeLegDistances[i] ? (routeLegDistances[i] / 1000).toFixed(1) : "0.0";
    const mins = routeLegDurations[i] ? Math.round(routeLegDurations[i] / 60) : 0;
    return `${km} км · ${mins} хв від попередньої точки`;
  });
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
  routeFilterDriver.innerHTML = `<option value="all">Усі водії</option>` + state.drivers.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
  routeFilterDriver.value = state.routeFilterDriverId || "all";

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
  const filterDriverId = state.routeFilterDriverId || "all";
  const filtered = filterDriverId === "all" ? state.routes : state.routes.filter(r => r.driverId === filterDriverId);

  routesList.innerHTML = filtered.map(r => {
    const driver = getDriver(r.driverId);
    const active = r.id === state.activeRouteId ? "active" : "";
    return `
      <div class="route-item ${active}" data-route-id="${r.id}">
        <div><strong>${escapeHtml(r.name)}</strong></div>
        <div class="route-item-meta">Водій: ${escapeHtml(driver ? driver.name : "—")} · Доставок: ${r.deliveries.length} · Старт: ${r.startTime || "09:00"} · Статус: ${r.status || "Заплановано"}</div>
      </div>
    `;
  }).join("");
}

function renderStops() {
  const route = getActiveRoute();
  const deliveries = route.deliveries || [];
  const etaList = getArrivalTimes(route);
  const legTexts = getLegTexts(route);
  stopCount.textContent = deliveries.length;

  stopsList.innerHTML = deliveries.map((stop, index) => `
    <div class="stop-item" draggable="true" data-drag-index="${index}">
      <div class="stop-badge ${index === 0 ? "next" : ""}">${index + 1}</div>
      <div class="stop-main">
        <div class="stop-label">${escapeHtml(stop.label)}</div>
        <div class="stop-coords">Доставка · ${stop.lng.toFixed(5)}, ${stop.lat.toFixed(5)}</div>
        <div class="stop-eta">Прибуття: ${etaList[index] || "--:--"}${index === 0 ? " · наступна точка" : ""}</div>
        <div class="stop-leg">${legTexts[index] || ""}</div>
      </div>
      <div class="stop-actions">
        <button class="icon-btn" type="button" data-action="up" data-index="${index}">↑</button>
        <button class="icon-btn" type="button" data-action="down" data-index="${index}">↓</button>
        <button class="icon-btn" type="button" data-action="remove" data-index="${index}">✕</button>
      </div>
    </div>
  `).join("");
  drawMarkers();
  if (mapLoaded) ensureStopsLayer();
}


function getStopsGeoJSON() {
  const route = getActiveRoute();
  return {
    type: "FeatureCollection",
    features: route.deliveries.map((stop, index) => ({
      type: "Feature",
      properties: {
        idx: index + 1,
        next: index === 0 ? 1 : 0
      },
      geometry: {
        type: "Point",
        coordinates: [stop.lng, stop.lat]
      }
    }))
  };
}

function ensureStopsLayer() {
  if (!mapLoaded) return;
  const data = getStopsGeoJSON();

  if (map.getSource("delivery-points")) {
    map.getSource("delivery-points").setData(data);
  } else {
    map.addSource("delivery-points", {
      type: "geojson",
      data
    });

    map.addLayer({
      id: "delivery-circles",
      type: "circle",
      source: "delivery-points",
      paint: {
        "circle-radius": 15,
        "circle-color": [
          "case",
          ["==", ["get", "next"], 1],
          "#2563eb",
          "#0f172a"
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
        "circle-opacity": 1
      }
    });

    map.addLayer({
      id: "delivery-labels",
      type: "symbol",
      source: "delivery-points",
      layout: {
        "text-field": ["to-string", ["get", "idx"]],
        "text-size": 12,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"]
      },
      paint: {
        "text-color": "#ffffff"
      }
    });
  }
}

function drawMarkers() {
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

  ensureStopsLayer();
}


function setRouteStats(distanceMeters = 0, durationSeconds = 0) {
  routeKm.textContent = distanceMeters ? (distanceMeters / 1000).toFixed(1) : "0";
  routeTime.textContent = durationSeconds ? Math.round(durationSeconds / 60) + " хв" : "0 хв";
  const route = getActiveRoute();
  const departure = route.startTime || "09:00";
  departureTimeLabel.textContent = departure;
  const finishMinutes = parseTimeToMinutes(departure) + Math.round((durationSeconds || 0) / 60);
  finishTimeLabel.textContent = durationSeconds ? formatMinutes(finishMinutes) : "--:--";
  workTimeLabel.textContent = durationSeconds ? Math.round(durationSeconds / 60) + " хв" : "0 хв";
}

function renderHeader() {
  const route = getActiveRoute();
  const driver = getDriver(route.driverId);
  activeRouteTitle.textContent = route.name;
  activeRouteMeta.textContent = `Водій: ${driver ? driver.name : "—"} · Старт: ${route.startTime || "09:00"} · Статус: ${route.status || "Заплановано"} · Дім → доставки → дім`;
}

function renderAll() {
  renderDrivers();
  renderRoutes();
  renderStops();
  renderHeader();
  startTimeInput.value = getActiveRoute().startTime || "09:00";
  routeStatusSelect.value = getActiveRoute().status || "Заплановано";
  if (getOrderedStops(getActiveRoute()).length < 2) setRouteStats();
  driverModeBtn.textContent = isDriverMode ? "Вийти з режиму водія" : "Режим водія";
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
cancelDriverNameBtn.onclick = closeRenameModal;
renameModal.onclick = (e) => { if (e.target === renameModal) closeRenameModal(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !renameModal.classList.contains("hidden")) closeRenameModal(); });

routeFilterDriver.onchange = () => {
  state.routeFilterDriverId = routeFilterDriver.value;
  saveState();
  renderRoutes();
};

routesList.addEventListener("click", (e) => {
  const item = e.target.closest("[data-route-id]");
  if (!item) return;
  state.activeRouteId = item.dataset.routeId;
  routeLegDurations = [];
  routeLegDistances = [];
  saveState();
  renderAll();
  if (getOrderedStops(getActiveRoute()).length >= 2) buildRoadRoute();
});

driverSelect.onchange = () => {
  const route = getActiveRoute();
  route.driverId = driverSelect.value;
  routeLegDurations = [];
  routeLegDistances = [];
  saveState();
  renderAll();
  if (getOrderedStops(route).length >= 2) buildRoadRoute();
};

startTimeInput.onchange = () => {
  const route = getActiveRoute();
  route.startTime = startTimeInput.value || "09:00";
  saveState();
  renderAll();
};

routeStatusSelect.onchange = () => {
  const route = getActiveRoute();
  route.status = routeStatusSelect.value;
  saveState();
  renderAll();
};

stopsList.addEventListener("dragstart", (e) => {
  const item = e.target.closest("[data-drag-index]");
  if (!item) return;
  dragIndex = Number(item.dataset.dragIndex);
  item.classList.add("dragging");
});

stopsList.addEventListener("dragend", (e) => {
  const item = e.target.closest("[data-drag-index]");
  if (item) item.classList.remove("dragging");
});

stopsList.addEventListener("dragover", (e) => {
  e.preventDefault();
});

stopsList.addEventListener("drop", (e) => {
  e.preventDefault();
  const item = e.target.closest("[data-drag-index]");
  if (!item || dragIndex === null) return;
  const dropIndex = Number(item.dataset.dragIndex);
  if (dropIndex === dragIndex) return;
  const route = getActiveRoute();
  const moved = route.deliveries.splice(dragIndex, 1)[0];
  route.deliveries.splice(dropIndex, 0, moved);
  dragIndex = null;
  routeLegDurations = [];
  routeLegDistances = [];
  saveState();
  renderAll();
  if (getOrderedStops(route).length >= 2) buildRoadRoute();
});

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
  routeLegDurations = [];
  routeLegDistances = [];
  saveState();
  renderAll();
  if (getOrderedStops(route).length >= 2) buildRoadRoute();
});

newRouteBtn.onclick = () => {
  const name = routeNameInput.value.trim();
  const driverId = driverSelect.value;
  if (!name) return alert("Введи назву маршруту");
  const id = "r" + Date.now();
  state.routes.unshift({ id, name, driverId, deliveries: [], startTime: startTimeInput.value || "09:00", status: "Заплановано" });
  state.activeRouteId = id;
  routeLegDurations = [];
  routeLegDistances = [];
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
  routeLegDurations = [];
  routeLegDistances = [];
  saveState();
  renderAll();
  clearRouteLayer();
  if (getOrderedStops(getActiveRoute()).length >= 2) buildRoadRoute();
};

driverModeBtn.onclick = () => {
  isDriverMode = !isDriverMode;
  document.body.classList.toggle("driver-mode", isDriverMode);
  renderAll();
  setTimeout(() => map.resize(), 250);
};

function getGoogleMapsLink() {
  const ordered = getOrderedStops(getActiveRoute());
  if (!ordered.length) return "";
  const origin = `${ordered[0].lat},${ordered[0].lng}`;
  const destination = `${ordered[ordered.length - 1].lat},${ordered[ordered.length - 1].lng}`;
  const waypoints = ordered.slice(1, -1).map(s => `${s.lat},${s.lng}`).join("|");
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  if (waypoints) url.searchParams.set("waypoints", waypoints);
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

googleMapsBtn.onclick = () => {
  const link = getGoogleMapsLink();
  if (!link) return alert("Спочатку створи маршрут");
  window.open(link, "_blank");
};

shareRouteBtn.onclick = async () => {
  const route = getActiveRoute();
  const driver = getDriver(route.driverId);
  const text = [
    `Маршрут: ${route.name}`,
    `Водій: ${driver ? driver.name : "—"}`,
    `Статус: ${route.status || "Заплановано"}`,
    `Старт: ${route.startTime || "09:00"}`,
    `Доставок: ${route.deliveries.length}`,
    `Google Maps: ${getGoogleMapsLink()}`
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    showToast("Посилання і дані маршруту скопійовано");
  } catch {
    showToast("Не вдалося скопіювати");
  }
};

function clearRouteLayer() {
  if (map.getLayer("route-line")) map.removeLayer("route-line");
  if (map.getSource("route")) map.removeSource("route");
  if (map.getLayer("delivery-labels")) map.removeLayer("delivery-labels");
  if (map.getLayer("delivery-circles")) map.removeLayer("delivery-circles");
  if (map.getSource("delivery-points")) map.removeSource("delivery-points");
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
  routeLegDurations = [];
  routeLegDistances = [];
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
  routeLegDurations = [];
  routeLegDistances = [];
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
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?annotations=duration,distance&access_token=${mapboxgl.accessToken}`;

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
    // small 2-opt improvement
    function routeCost(order) {
      let total = 0, prev = 0;
      order.forEach(i => { total += durations[prev][i + 1] || 0; prev = i + 1; });
      total += durations[prev][0] || 0;
      return total;
    }
    let improved = orderedIdx.slice();
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < improved.length - 1; i++) {
        for (let j = i + 1; j < improved.length; j++) {
          const candidate = improved.slice();
          const segment = candidate.slice(i, j + 1).reverse();
          candidate.splice(i, j - i + 1, ...segment);
          if (routeCost(candidate) + 1 < routeCost(improved)) {
            improved = candidate;
            changed = true;
          }
        }
      }
    }
    route.deliveries = improved.map(i => deliveries[i]);
    routeLegDurations = [];
    routeLegDistances = [];
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
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&steps=true&access_token=${mapboxgl.accessToken}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes.length) return alert("Маршрут не знайдено");
    const r = data.routes[0];
    const geojson = { type: "Feature", geometry: r.geometry };
    routeLegDurations = (r.legs || []).map(leg => leg.duration || 0);
    routeLegDistances = (r.legs || []).map(leg => leg.distance || 0);

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
    renderStops();
    ensureStopsLayer();
  } catch (e) {
    console.error(e);
    searchStatus.textContent = "Не вдалось побудувати маршрут";
  }
}

routeBtn.onclick = buildRoadRoute;

clearBtn.onclick = () => {
  getActiveRoute().deliveries = [];
  routeLegDurations = [];
  routeLegDistances = [];
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
