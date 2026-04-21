function initMap() {
  const token = document.getElementById("token").value;
  mapboxgl.accessToken = token;

  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [24.03, 49.84],
    zoom: 10
  });

  map.addControl(new mapboxgl.NavigationControl());

  new mapboxgl.Marker().setLngLat([24.03, 49.84]).addTo(map);
}
