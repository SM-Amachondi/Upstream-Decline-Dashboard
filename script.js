// Helper: number formatting
function fmt(x){ if(x===null||x===undefined) return "—"; return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// Global state
let FIELDS = [];
let MONTHLY = [];
let META = {};
let SHOW_FORECAST = false;
let MAP, MARKERS = [];
let FIELD_INDEX = {}; // field_id -> metadata row

// Color mapping by basin
const BASIN_COLORS = {
  "Niger Delta (Deepwater)": "#FFB703",
  "Niger Delta (Ultra-deep)": "#FB8500",
  "Niger Delta (Shallow shelf)": "#90EE90",
  "Niger Delta (Onshore deltaic)": "#00B4D8",
  "default": "#8ecae6"
};

// Initialize
window.addEventListener('DOMContentLoaded', async () =>{
  document.getElementById('year').textContent = new Date().getFullYear();
  document.getElementById('enterBtn').addEventListener('click', ()=>{
    document.getElementById('splash').style.display='none';
  });
  document.getElementById('methodsBtn').addEventListener('click', ()=>{
    alert(`METHODS & ASSUMPTIONS
• Exponential decline fit: q(t)=q0·e^{-Dt} fitted on historical logs via OLS.
• Synthetic data approximates Nigerian deepwater field behavior.
• Forecast extends 24 months beyond last actual; uncertainty not shown.
• Replace data/*.csv with your own to go live.`);
  });

  await loadData();
  buildUI();
  initMap();
  renderMap();
  renderLeaderboard();
  setDefaultField();
  renderTimeSeries();
  updateKPIs();
});

async function loadData(){
  const fieldsResp = await fetch('data/fields.csv');
  const fieldsText = await fieldsResp.text();
  FIELDS = Papa.parse(fieldsText, {header:true, dynamicTyping:true}).data.filter(r=>r.field_id);

  const monthlyResp = await fetch('data/monthly_prod.csv');
  const monthlyText = await monthlyResp.text();
  let rows = Papa.parse(monthlyText, {header:true, dynamicTyping:true}).data.filter(r=>r.field_id);
  // Parse date strings
  rows.forEach(r => r.date = new Date(r.date));
  MONTHLY = rows;

  const metaResp = await fetch('data/metadata.json');
  META = await metaResp.json();

  // Field index
  FIELDS.forEach(r=> FIELD_INDEX[r.field_id] = r);
}

function buildUI(){
  const sel = document.getElementById('fieldSelect');
  FIELDS.forEach(r=>{
    const opt = document.createElement('option');
    opt.value = r.field_id;
    opt.textContent = `${r.field_name} (${r.operator.split(' ')[0]})`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', ()=>{
    highlightOnMap(sel.value);
    renderTimeSeries();
    updateSelectedMeta();
  });
  document.getElementById('searchBox').addEventListener('input', (e)=>{
    const q = e.target.value.toLowerCase();
    for (let i=0; i<sel.options.length; i++){
      const o = sel.options[i];
      o.style.display = o.textContent.toLowerCase().includes(q) ? 'block':'none';
    }
  });
  document.getElementById('toggleForecast').addEventListener('click', ()=>{
    SHOW_FORECAST = !SHOW_FORECAST;
    document.getElementById('toggleForecast').textContent = SHOW_FORECAST ? 'Hide Forecast' : 'Show Forecast';
    renderTimeSeries();
  });
  document.getElementById('downloadCsv').addEventListener('click', ()=>{
    const csv = Papa.unparse(MONTHLY.map(r=> ({
      field_id: r.field_id,
      date: r.date.toISOString().slice(0,10),
      production_bpd: r.production_bpd,
      fitted_bpd: r.fitted_bpd,
      is_forecast: r.is_forecast
    })));
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'monthly_prod.csv'; a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('exportPng').addEventListener('click', ()=>{
    Plotly.downloadImage('ts-chart', {format:'png', width:1100, height:500, filename:'field_timeseries'});
  });
}

function initMap(){
  MAP = L.map('map', { zoomControl: true }).setView([4.8, 5.4], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; OpenStreetMap'
  }).addTo(MAP);
}

function avgRecentProd(field_id, months=12){
  const recs = MONTHLY.filter(r=> r.field_id===field_id && r.is_forecast===0);
  if (recs.length===0) return 0;
  const sorted = recs.sort((a,b)=> a.date-b.date);
  const tail = sorted.slice(-months);
  const avg = tail.reduce((s,r)=> s+(+r.production_bpd||0), 0)/tail.length;
  return avg || 0;
}

function renderMap(){
  // Clear markers
  MARKERS.forEach(m=> MAP.removeLayer(m));
  MARKERS = [];

  FIELDS.forEach(f=>{
    const avg = avgRecentProd(f.field_id);
    const radius = Math.max(6, Math.min(30, Math.sqrt(avg)/100)); // mild scaling
    const color = BASIN_COLORS[f.basin] || BASIN_COLORS.default;

    const marker = L.circleMarker([f.lat, f.lon], {
      radius, color, fillColor: color, fillOpacity: 0.7, weight:1
    }).addTo(MAP);

    marker.bindPopup(`
      <b>${f.field_name}</b><br/>
      Operator: ${f.operator}<br/>
      Basin: ${f.basin}<br/>
      Avg(12m): ${fmt(Math.round(avg))} bpd
    `);

    marker.on('click', ()=>{
      document.getElementById('fieldSelect').value = f.field_id;
      renderTimeSeries();
      updateSelectedMeta();
    });

    MARKERS.push(marker);
  });
}

function highlightOnMap(field_id){
  const f = FIELD_INDEX[field_id];
  if (!f) return;
  MAP.setView([f.lat, f.lon], 7);
}

function renderLeaderboard(){
  // latest actual month
  const actualRows = MONTHLY.filter(r=> r.is_forecast===0);
  const maxDate = actualRows.reduce((max, r)=> r.date>max? r.date : max, new Date(0));
  const latest = actualRows.filter(r=> r.date.getTime()===maxDate.getTime());
  // aggregate by operator
  const byOp = {};
  latest.forEach(r=>{
    const op = FIELD_INDEX[r.field_id]?.operator || 'Unknown';
    if (!byOp[op]) byOp[op] = {fields: new Set(), prod:0};
    byOp[op].fields.add(r.field_id);
    byOp[op].prod += (+r.production_bpd||0);
  });
  const arr = Object.entries(byOp).map(([op,v])=>({operator:op, fields:v.fields.size, prod:Math.round(v.prod)}));
  arr.sort((a,b)=> b.prod-a.prod);

  const tbody = document.getElementById('leader-body');
  tbody.innerHTML = '';
  arr.forEach(row=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row.operator}</td><td>${row.fields}</td><td>${fmt(row.prod)}</td>`;
    tbody.appendChild(tr);
  });
}

function setDefaultField(){
  // choose the largest avg production
  let best = {fid:null, avg:-1};
  FIELDS.forEach(f=>{
    const avg = avgRecentProd(f.field_id);
    if (avg > best.avg) best = {fid:f.field_id, avg};
  });
  const sel = document.getElementById('fieldSelect');
  sel.value = best.fid;
  updateSelectedMeta();
  highlightOnMap(best.fid);
}

function updateSelectedMeta(){
  const fid = document.getElementById('fieldSelect').value;
  const f = FIELD_INDEX[fid];
  if (!f) return;
  const badge = document.getElementById('selectedMeta');
  badge.textContent = `${f.field_name} • ${f.operator} • ${f.basin} • Start ${f.start_year}`;
}

function renderTimeSeries(){
  const fid = document.getElementById('fieldSelect').value;
  const data = MONTHLY.filter(r=> r.field_id===fid);
  if (data.length===0){ Plotly.purge('ts-chart'); return; }

  const hist = data.filter(r=> r.is_forecast===0);
  const fcst = data.filter(r=> r.is_forecast===1);
  const xHist = hist.map(r=> r.date);
  const yHist = hist.map(r=> r.production_bpd);
  const yFitHist = hist.map(r=> r.fitted_bpd);

  const traces = [{
    x: xHist, y: yHist, mode:'lines+markers', name:'Actual', line:{width:3}, hovertemplate:'%{x|%Y-%m}<br>%{y:,.0f} bpd<extra></extra>'
  },{
    x: xHist, y: yFitHist, mode:'lines', name:'Fitted', line:{dash:'dot', width:2}, hovertemplate:'%{x|%Y-%m}<br>%{y:,.0f} bpd (fit)<extra></extra>'
  }];

  if (SHOW_FORECAST && fcst.length>0){
    const xFc = fcst.map(r=> r.date);
    const yFitFc = fcst.map(r=> r.fitted_bpd);
    traces.push({
      x: xFc, y: yFitFc, mode:'lines', name:'Forecast', line:{width:3}, hovertemplate:'%{x|%Y-%m}<br>%{y:,.0f} bpd (fcst)<extra></extra>'
    });
  }

  const maxY = Math.max(...data.map(r=> r.production_bpd), ...data.map(r=> r.fitted_bpd));
  const layout = {
    paper_bgcolor:'rgba(0,0,0,0)',
    plot_bgcolor:'rgba(255,255,255,0.02)',
    margin:{l:60,r:20,t:10,b:50},
    yaxis:{gridcolor:'rgba(255,255,255,0.08)', tickformat:',d', rangemode:'tozero', range:[0, maxY*1.15]},
    xaxis:{gridcolor:'rgba(255,255,255,0.06)'},
    legend:{orientation:'h', x:0, y:1.1},
  };
  Plotly.newPlot('ts-chart', traces, layout, {displaylogo:false, responsive:true});
}

function updateKPIs(){
  // Total production latest actual month
  const actualRows = MONTHLY.filter(r=> r.is_forecast===0);
  if (actualRows.length===0) return;
  const maxDate = actualRows.reduce((max, r)=> r.date>max? r.date : max, new Date(0));
  const latest = actualRows.filter(r=> r.date.getTime()===maxDate.getTime());
  const total = latest.reduce((s,r)=> s+(+r.production_bpd||0), 0);
  document.getElementById('kpi-total').textContent = fmt(Math.round(total)) + " bpd";

  // Fields tracked
  document.getElementById('kpi-fields').textContent = fmt(FIELDS.length);

  // Avg decline rate (approx from fitted slope over last 24 months of history)
  const perFieldDecl = [];
  const histEnd = maxDate;
  FIELDS.forEach(f=>{
    const recs = MONTHLY.filter(r=> r.field_id===f.field_id && r.is_forecast===0).sort((a,b)=> a.date-b.date);
    const tail = recs.slice(-24);
    if (tail.length>=6){
      // approximate monthly decline: (last/first)^(1/n) - 1
      const first = tail[0].production_bpd||0;
      const last = tail[tail.length-1].production_bpd||0;
      if (first>0 && last>0){
        const n = tail.length;
        const mdecl = Math.pow(last/first, 1/n)-1;
        const adecl = 1 - Math.pow(1+mdecl, 12); // convert monthly factor to annual decline fraction
        perFieldDecl.push(adecl);
      }
    }
  });
  const avgDecl = perFieldDecl.length? perFieldDecl.reduce((a,b)=>a+b,0)/perFieldDecl.length : 0;
  document.getElementById('kpi-decline').textContent = (avgDecl*100*-1).toFixed(1).replace('-','') + "%";

  // Forecast horizon
  const maxRow = MONTHLY.reduce((m,r)=> r.date>m.date? r : m, MONTHLY[0]);
  const months = (maxRow.date.getFullYear()-maxDate.getFullYear())*12 + (maxRow.date.getMonth()-maxDate.getMonth());
  document.getElementById('kpi-horizon').textContent = months + " months";
}
