// --- Data endpoints (OWID Grapher) ---
const URLS = {
  production: 'https://ourworldindata.org/grapher/oil-production-by-country.csv',
  consumption: 'https://ourworldindata.org/grapher/oil-consumption-by-country.csv',
  reserves: 'https://ourworldindata.org/grapher/oil-proved-reserves.csv',
  price: 'https://ourworldindata.org/grapher/crude-oil-prices.csv',
  worldGeo: 'https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json'
};

const state = {
  data: { production: [], consumption: [], reserves: [] },
  years: [],
  countries: new Set(),
  selectedYear: null,
  selectedMetric: 'production',
  selectedCountries: []
};

// Helpers
function groupBy(arr, key){ return arr.reduce((m,o)=>((m[o[key]]=(m[o[key]]||[])).push(o),m),{}); }
function formatNum(x){ if(x===null || x===undefined || isNaN(x)) return '–'; 
  const abs=Math.abs(x);
  if(abs>=1e12) return (x/1e12).toFixed(2)+'T';
  if(abs>=1e9) return (x/1e9).toFixed(2)+'B';
  if(abs>=1e6) return (x/1e6).toFixed(2)+'M';
  if(abs>=1e3) return (x/1e3).toFixed(2)+'k';
  return (+x).toLocaleString();
}

async function loadCSV(url){
  return new Promise((resolve,reject)=>{
    Papa.parse(url, {
      download: true,
      header: true,
      dynamicTyping: true,
      complete: res => resolve(res.data.filter(r => r.entity || r.Year)),
      error: err => reject(err)
    });
  });
}

async function loadAll(){
  const [prod, cons, res, price] = await Promise.all([
    loadCSV(URLS.production),
    loadCSV(URLS.consumption),
    loadCSV(URLS.reserves),
    loadCSV(URLS.price)
  ]);
  state.data.production = prod.map(d=>({country:d.entity, code:d.code, year:+d.year, value:+d['Oil production - TWh']})).filter(d=>d.country);
  state.data.consumption = cons.map(d=>({country:d.entity, code:d.code, year:+d.year, value:+d['Oil consumption - TWh']})).filter(d=>d.country);
  state.data.reserves = res.map(d=>({country:d.entity, code:d.code, year:+d.year, value:+d['Oil reserves - tonnes']})).filter(d=>d.country);
  state.price = price.map(d=>({year:+d.Year, price:+d['Crude oil prices - current US$ per cubic meter']})).filter(d=>!isNaN(d.year)&&!isNaN(d.price));

  state.years = Array.from(new Set(state.data.production.map(d=>d.year))).sort((a,b)=>a-b);
  state.selectedYear = state.years[state.years.length-1];

  state.data.production.forEach(d=>state.countries.add(d.country));
  initControls();
  updateAll();
  initMap();
}

function initControls(){
  const yearSel = document.getElementById('year');
  state.years.slice(-30).forEach(y=>{
    const opt=document.createElement('option');
    opt.value=y; opt.textContent=y;
    if(y===state.selectedYear) opt.selected=true;
    yearSel.appendChild(opt);
  });
  yearSel.addEventListener('change', e=>{ state.selectedYear=+e.target.value; updateAll(); updateMap(); });

  const metricSel = document.getElementById('metric');
  metricSel.addEventListener('change', e=>{ state.selectedMetric=e.target.value; updateAll(); updateMap(); });

  const countriesSel = document.getElementById('countries');
  Array.from(state.countries).sort().forEach(c=>{
    const opt=document.createElement('option'); opt.value=c; opt.textContent=c; countriesSel.appendChild(opt);
  });
  countriesSel.addEventListener('change', e=>{
    state.selectedCountries = Array.from(e.target.selectedOptions).map(o=>o.value).slice(0,8);
    updateTimeSeries();
  });

  document.getElementById('reset').addEventListener('click',()=>{
    metricSel.value='production';
    state.selectedMetric='production';
    yearSel.value=state.selectedYear;
    countriesSel.value=null;
    state.selectedCountries=[];
    updateAll(); updateMap();
  });
}

function currentDataset(){
  return state.data[state.selectedMetric];
}

function updateKPIs(){
  const latestYear = Math.max(...state.data.production.map(d=>d.year));
  const latest = state.data.production.filter(d=>d.year===latestYear);
  const worldTotal = latest.reduce((s,d)=>s+(isNaN(d.value)?0:d.value),0);
  const top = latest.reduce((a,b)=> a.value>b.value ? a : b );
  document.getElementById('kpi-world-value').textContent = formatNum(worldTotal) + ' TWh ('+latestYear+')';
  document.getElementById('kpi-top-name').textContent = top.country;
  document.getElementById('kpi-top-value').textContent = formatNum(top.value) + ' TWh';
  // price
  const lastPrice = state.price[state.price.length-1];
  if(lastPrice){
    document.getElementById('kpi-price-value').textContent = '$' + Math.round(lastPrice.price).toLocaleString() + '/m³';
  }
}

function updateBar(){
  const year = state.selectedYear;
  const data = currentDataset().filter(d=>d.year===year).sort((a,b)=>b.value-a.value).slice(0,10);
  const trace = {
    type:'bar',
    x: data.map(d=>d.country).reverse(),
    y: data.map(d=>d.value).reverse(),
    orientation:'h',
    hovertemplate: '%{x}<br>'+ (state.selectedMetric==='reserves' ? '%{y:,.0f} tonnes' : '%{y:,.0f} TWh') +'<extra></extra>'
  };
  const layout = {
    margin:{l:140,r:20,t:10,b:30},
    paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
    font:{color:'#eaf2ff'}, xaxis:{gridcolor:'#1f2d4f'}
  };
  Plotly.newPlot('bar-top',[trace],layout,{displayModeBar:false});
  document.getElementById('panel-year').textContent = year;
}

function updateTimeSeries(){
  const countries = state.selectedCountries.length? state.selectedCountries : ['United States','Saudi Arabia','Russia','Canada','China'];
  const traces = countries.map(c=>{
    const series = currentDataset().filter(d=>d.country===c).sort((a,b)=>a.year-b.year);
    return { type:'scatter', mode:'lines', name:c, x: series.map(d=>d.year), y: series.map(d=>d.value) };
  });
  const layout = {
    margin:{l:50,r:10,t:10,b:30},
    paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
    font:{color:'#eaf2ff'}, xaxis:{gridcolor:'#1f2d4f'}, yaxis:{gridcolor:'#1f2d4f'}
  };
  Plotly.newPlot('ts', traces, layout, {displayModeBar:false});
}

function updatePrice(){
  const tr = [{type:'scatter', mode:'lines', x: state.price.map(d=>d.year), y: state.price.map(d=>d.price), name:'Crude (nominal $/m³)'}];
  const layout = {
    margin:{l:60,r:10,t:10,b:30},
    paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
    font:{color:'#eaf2ff'}, xaxis:{gridcolor:'#1f2d4f'}, yaxis:{gridcolor:'#1f2d4f'}
  };
  Plotly.newPlot('price', tr, layout, {displayModeBar:false});
}

function updateAll(){
  updateKPIs();
  updateBar();
  updateTimeSeries();
  updatePrice();
}

// ---- Map ----
let leafletMap, geoLayer;
async function initMap(){
  leafletMap = L.map('map', {zoomControl: true}).setView([20,0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(leafletMap);
  const geo = await fetch(URLS.worldGeo).then(r=>r.json());
  geoLayer = L.geoJSON(geo, { style: f=>({weight:0.5,color:'#223a6f',fillOpacity:0.8, fillColor:'#0a1c39'}) }).addTo(leafletMap);
  updateMap();
}
function valueForCountry(country){
  const row = currentDataset().filter(d=>d.country===country && d.year===state.selectedYear)[0];
  return row ? row.value : null;
}
function colorScale(v, min, max){
  if(v===null || v===undefined || isNaN(v)) return '#0a1c39';
  const t = (v-min)/(max-min+1e-9);
  const r = Math.round(255*t);
  const g = Math.round(64 + 120*(1-t));
  const b = Math.round(160 + 40*(1-t));
  return `rgb(${r},${g},${b})`;
}
function updateMap(){
  if(!geoLayer) return;
  const year = state.selectedYear;
  const vals = currentDataset().filter(d=>d.year===year).map(d=>d.value).filter(v=>!isNaN(v));
  const min = Math.min(...vals), max = Math.max(...vals);
  geoLayer.eachLayer(layer=>{
    const name = layer.feature.properties.name;
    const v = valueForCountry(name);
    layer.setStyle({fillColor: colorScale(v, min, max)});
    const unit = state.selectedMetric==='reserves' ? 'tonnes' : 'TWh';
    layer.bindTooltip(`<strong>${name}</strong><br>${v?formatNum(v):'–'} ${unit} (${year})`, {sticky:true});
  });
  document.getElementById('legend').innerHTML = `Color scale by ${state.selectedMetric} (${year}).`;
}

// Kick-off
loadAll();
