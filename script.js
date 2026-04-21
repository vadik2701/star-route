mapboxgl.accessToken="pk.eyJ1IjoidmFkaWtmYW5kaWNoIiwiYSI6ImNtbzh5a2U5bzA0c2YycXIweHFnenBxbjkifQ.VPmfULjpK3zz8VHXvY4LCg";

const map=new mapboxgl.Map({
container:"map",
style:"mapbox://styles/mapbox/streets-v12",
center:[24.03,49.84],
zoom:9
});

let home=null;
let deliveries=[];
let markers=[];

function drawMarkers(){
markers.forEach(m=>m.remove());
markers=[];

if(home){
const el=document.createElement("div");
el.innerHTML="🏠";
el.style.fontSize="24px";
markers.push(new mapboxgl.Marker(el).setLngLat([home.lng,home.lat]).addTo(map));
}

deliveries.forEach((d,i)=>{
const el=document.createElement("div");
el.style.cssText="background:black;color:white;border-radius:50%;width:25px;height:25px;display:flex;align-items:center;justify-content:center";
el.innerText=i+1;
markers.push(new mapboxgl.Marker(el).setLngLat([d.lng,d.lat]).addTo(map));
});
}

async function geocode(q){
const r=await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?access_token=${mapboxgl.accessToken}&country=ua`);
const d=await r.json();
return d.features.map(f=>({label:f.place_name,lng:f.center[0],lat:f.center[1]}));
}

document.getElementById("addressInput").oninput=async(e)=>{
const q=e.target.value;
if(q.length<3)return;
const res=await geocode(q);
document.getElementById("suggestions").innerHTML=res.map((r,i)=>`<div onclick="addPoint(${i})">${r.label}</div>`).join("");
window.tmp=res;
};

function addPoint(i){
deliveries.push(window.tmp[i]);
drawMarkers();
}

document.getElementById("homeInput").oninput=async(e)=>{
const q=e.target.value;
if(q.length<3)return;
const res=await geocode(q);
document.getElementById("homeSuggestions").innerHTML=res.map((r,i)=>`<div onclick="setHome(${i})">${r.label}</div>`).join("");
window.tmpHome=res;
};

function setHome(i){
home=window.tmpHome[i];
drawMarkers();
}

async function buildRoute(){
if(!home||deliveries.length==0)return;

const coords=[home,...deliveries,home].map(p=>p.lng+','+p.lat).join(';');

const r=await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&access_token=${mapboxgl.accessToken}`);
const d=await r.json();

const geo={type:"Feature",geometry:d.routes[0].geometry};

if(map.getSource("route"))map.getSource("route").setData(geo);
else{
map.addSource("route",{type:"geojson",data:geo});
map.addLayer({id:"r",type:"line",source:"route",paint:{"line-width":4}});
}
}

document.getElementById("routeBtn").onclick=buildRoute;
