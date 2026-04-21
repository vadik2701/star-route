mapboxgl.accessToken = "pk.eyJ1IjoidmFkaWtmYW5kaWNoIiwiYSI6ImNtbzh5a2U5bzA0c2YycXIweHFnenBxbjkifQ.VPmfULjpK3zz8VHXvY4LCg";

const mapError = document.getElementById("mapError");
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

const addressInput = document.getElementById("addressInput");
const searchBtn = document.getElementById("searchBtn");
const suggestionsEl = document.getElementById("suggestions");
const searchStatus = document.getElementById("searchStatus");
const routeBtn = document.getElementById("routeBtn");
const clearBtn = document.getElementById("clearBtn");
const stopsList = document.getElementById("stopsList");
const stopCount = document.getElementById("stopCount");
const routeKm = document.getElementById("routeKm");
const routeTime = document.getElementById("routeTime");

let stops = [];
let markers = [];
let pendingRouteBuild = false;
let mapLoaded = false;

map.on("load", () => {
  mapLoaded = true;
  hideMapError();
  if (pendingRouteBuild) {
    pendingRouteBuild = false;
    buildRoadRoute();
  }
});

map.on("error", (e) => {
  const msg = e && e.error && e.error.message ? e.error.message : "";
  console.error("Mapbox error:", e);
  if (msg) {
    showMapError("Карта не підвантажила стиль. Часто це через обмеження токена по домену або збій стилю. Я вже переключив на streets-v12. Якщо ще біло — треба дозволити цей домен у Mapbox token.");
  }
});

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}

function renderStops() {
  stopCount.textContent = stops.length;
  stopsList.innerHTML = "";
  stops.forEach((stop, index) => {
    const item = document.createElement("div");
    item.className = "stop-item";
    item.innerHTML = `
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
    `;
    stopsList.appendChild(item);
  });
  drawMarkers();
}

stopsList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const index = Number(btn.dataset.index);
  const action = btn.dataset.action;
  if (action === "remove") {
    stops.splice(index, 1);
  } else if (action === "up" && index > 0) {
    [stops[index - 1], stops[index]] = [stops[index], stops[index - 1]];
  } else if (action === "down" && index < stops.length - 1) {
    [stops[index + 1], stops[index]] = [stops[index], stops[index + 1]];
  }
  renderStops();
  if (stops.length >= 2) buildRoadRoute();
});

function drawMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
  stops.forEach((stop, index) => {
    const el = document.createElement("div");
    el.style.cssText = `
      width:30px;height:30px;border-radius:999px;background:#0f172a;color:#fff;
      display:flex;align-items:center;justify-content:center;font-weight:800;
      border:3px solid #fff;box-shadow:0 6px 18px rgba(0,0,0,.18);
      font-size:12px;
    `;
    el.textContent = index + 1;
    const marker = new mapboxgl.Marker(el).setLngLat([stop.lng, stop.lat]).addTo(map);
    markers.push(marker);
  });
}

function setRouteStats(distanceMeters = 0, durationSeconds = 0) {
  routeKm.textContent = distanceMeters ? (distanceMeters / 1000).toFixed(1) : "0";
  const mins = durationSeconds ? Math.round(durationSeconds / 60) : 0;
  routeTime.textContent = mins ? `${mins} хв` : "0 хв";
}

async function searchAddress() {
  const query = addressInput.value.trim();
  if (!query) return;
  searchStatus.textContent = "Шукаю...";
  suggestionsEl.innerHTML = "";
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&country=ua&limit=5&language=uk`;
    const res = await fetch(url);
    const data = await res.json();
    const features = data.features || [];
    if (!features.length) {
      searchStatus.textContent = "Нічого не знайдено";
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

suggestionsEl.addEventListener("click", (e) => {
  const el = e.target.closest(".suggestion");
  if (!el) return;
  const features = JSON.parse(suggestionsEl.dataset.features || "[]");
  const feature = features[Number(el.dataset.index)];
  if (!feature) return;
  stops.push(feature);
  addressInput.value = "";
  suggestionsEl.innerHTML = "";
  searchStatus.textContent = "";
  renderStops();
  map.flyTo({center:[feature.lng, feature.lat], zoom:12});
  if (stops.length >= 2) buildRoadRoute();
});

async function buildRoadRoute() {
  if (stops.length < 2) return;
  if (!mapLoaded) {
    pendingRouteBuild = true;
    return;
  }

  const coords = stops.map(s => `${s.lng},${s.lat}`).join(";");
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.routes || !data.routes.length) {
      alert("Маршрут не знайдено");
      return;
    }

    const route = data.routes[0];
    const geojson = {
      type: "Feature",
      geometry: route.geometry
    };

    if (!map.getSource("route")) {
      map.addSource("route", {
        type: "geojson",
        data: geojson
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#111827",
          "line-width": 5
        },
        layout: {
          "line-cap": "round",
          "line-join": "round"
        }
      });
    } else {
      map.getSource("route").setData(geojson);
    }

    const bounds = new mapboxgl.LngLatBounds();
    route.geometry.coordinates.forEach(c => bounds.extend(c));
    map.fitBounds(bounds, { padding: 60 });

    setRouteStats(route.distance, route.duration);
  } catch (e) {
    console.error(e);
    searchStatus.textContent = "Не вдалось побудувати маршрут";
  }
}

searchBtn.addEventListener("click", searchAddress);
addressInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchAddress();
});
routeBtn.addEventListener("click", buildRoadRoute);

clearBtn.addEventListener("click", () => {
  stops = [];
  renderStops();
  setRouteStats();
  suggestionsEl.innerHTML = "";
  searchStatus.textContent = "";
  addressInput.value = "";
  if (map.getLayer("route-line")) map.removeLayer("route-line");
  if (map.getSource("route")) map.removeSource("route");
  map.flyTo({center:[24.03,49.84], zoom:9});
});
