/* ── Travel Places PWA ─────────────────────────────────────────────────── */

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── State ───────────────────────────────────────────────────────────── */
const S = {
  places: [],
  categories: [],
  currentLat: null,
  currentLng: null,
  currentCity: '',
  currentCountry: '',
  selectedCatId: null,
  pendingPhotos: [],
  activePlaceId: null,
  map: null,
  addMap: null,
  addMapMarker: null,
  markers: {},
  pin: '',
  isSettingPin: false,
  firstPinEntry: '',
  pickedEmoji: '📍',
  pickedColor: '#FF6B6B',
  // Search
  addMode: 'here',
  searchResults: [],
  searchTimer: null,
  // Near me
  nearMeActive: false,
  userLat: null,
  userLng: null,
  userMarker: null,
  // Select mode
  selectMode: false,
  selectedIds: new Set(),
};

/* ── PIN ──────────────────────────────────────────────────────────────── */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function updateDots(n) {
  for (let i = 0; i < 4; i++)
    document.getElementById(`dot-${i}`).classList.toggle('filled', i < n);
}

function errorDots() {
  document.querySelectorAll('.dot').forEach(d => {
    d.classList.add('shake');
    d.style.background = '#ba1a1a';
    setTimeout(() => { d.classList.remove('shake'); d.style.background = ''; }, 500);
  });
}

async function onPinDigit(digit) {
  if (S.pin.length >= 4) return;
  S.pin += digit;
  updateDots(S.pin.length);
  if (S.pin.length < 4) return;

  const stored = localStorage.getItem('ph');

  if (!stored) {
    if (!S.isSettingPin) {
      S.isSettingPin = true;
      S.firstPinEntry = S.pin;
      S.pin = '';
      updateDots(0);
      document.getElementById('pin-subtitle').textContent = 'Confirm your PIN';
    } else {
      if (S.pin === S.firstPinEntry) {
        localStorage.setItem('ph', await sha256(S.pin));
        await boot();
      } else {
        S.isSettingPin = false; S.firstPinEntry = ''; S.pin = '';
        updateDots(0);
        document.getElementById('pin-subtitle').textContent = "PINs didn't match — try again";
        errorDots();
      }
    }
    return;
  }

  if (await sha256(S.pin) === stored) {
    await boot();
  } else {
    S.pin = ''; updateDots(0);
    document.getElementById('pin-subtitle').textContent = 'Incorrect PIN';
    errorDots();
  }
}

function pinBack() {
  if (S.pin.length) { S.pin = S.pin.slice(0, -1); updateDots(S.pin.length); }
}

/* ── Boot ─────────────────────────────────────────────────────────────── */
async function boot() {
  showScreen('screen-main');
  await loadData();
  renderBrowse();
  initMainMap();
}

/* ── Screen helpers ───────────────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.style.display = 'none'; s.classList.remove('active');
  });
  const el = document.getElementById(id);
  el.style.display = 'flex'; el.classList.add('active');
}

function openOverlay(id) {
  document.getElementById(id).classList.add('open');
}

function closeOverlay(id) {
  document.getElementById(id).classList.remove('open');
}

/* ── Tab switching ────────────────────────────────────────────────────── */
function switchTab(tab) {
  document.querySelectorAll('.nav-item[id^="tab-"]').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');

  document.getElementById('view-map').style.display    = tab === 'map'    ? 'block' : 'none';
  document.getElementById('view-browse').style.display = tab === 'browse' ? 'flex'  : 'none';

  if (tab === 'map') setTimeout(() => S.map?.invalidateSize(), 50);
  if (tab === 'browse') renderBrowse();
}

/* ── Data ─────────────────────────────────────────────────────────────── */
async function loadData() {
  const [pr, cr] = await Promise.all([
    db.from('places').select('*, categories(id,name,icon,color)').order('created_at', { ascending: false }),
    db.from('categories').select('*').order('name'),
  ]);
  S.places     = pr.data || [];
  S.categories = cr.data || [];
  if (!S.categories.length) await seedCategories();
}

async function seedCategories() {
  const defaults = [
    { name: 'Food',        icon: '🍕', color: '#FF6B6B' },
    { name: 'Café',        icon: '☕', color: '#FF9F43' },
    { name: 'Gym',         icon: '🏋️', color: '#4ECDC4' },
    { name: 'Shopping',    icon: '🛍️', color: '#45B7D1' },
    { name: 'Sightseeing', icon: '🏛️', color: '#96CEB4' },
    { name: 'Other',       icon: '📍', color: '#DDA0DD' },
  ];
  const { data } = await db.from('categories').insert(defaults).select();
  S.categories = data || [];
}

/* ── Main map ─────────────────────────────────────────────────────────── */
function makeUserIcon() {
  return L.divIcon({
    html: '<div class="user-dot"><div class="user-pulse"></div></div>',
    iconSize: [20, 20], iconAnchor: [10, 10], className: '',
  });
}

function initMainMap() {
  if (S.map) { renderMarkers(); return; }

  S.map = L.map('map', { zoomControl: false }).setView([20, 10], 2);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(S.map);

  L.control.zoom({ position: 'bottomleft' }).addTo(S.map);
  renderMarkers();

  // Watch user position: center on first fix, update dot continuously
  let centeredOnUser = false;
  navigator.geolocation.watchPosition(
    pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      S.userLat = lat; S.userLng = lng;
      if (!centeredOnUser) { S.map.setView([lat, lng], 13); centeredOnUser = true; }
      if (S.userMarker) S.userMarker.remove();
      S.userMarker = L.marker([lat, lng], { icon: makeUserIcon(), zIndexOffset: 1000 }).addTo(S.map);
    },
    null,
    { enableHighAccuracy: false, maximumAge: 30000 }
  );
}

function locateMe() {
  const btn = document.getElementById('locate-btn');
  btn.classList.add('locating');
  navigator.geolocation.getCurrentPosition(
    pos => {
      btn.classList.remove('locating');
      const { latitude: lat, longitude: lng } = pos.coords;
      S.userLat = lat; S.userLng = lng;
      S.map.flyTo([lat, lng], 15, { duration: 1.2 });
      if (S.userMarker) S.userMarker.remove();
      S.userMarker = L.marker([lat, lng], { icon: makeUserIcon(), zIndexOffset: 1000 }).addTo(S.map);
    },
    () => { btn.classList.remove('locating'); toast('Could not get your location'); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function makePinIcon(cat) {
  const c = cat?.color || '#DDA0DD';
  const i = cat?.icon  || '📍';
  return L.divIcon({
    html: `<div class="pin-marker" style="width:44px;height:52px;position:relative;display:flex;justify-content:center">
             <div style="width:44px;height:44px;background:#fff;border-radius:50% 50% 50% 0;
               transform:rotate(-45deg);border:2px solid rgba(0,0,0,0.08);
               box-shadow:0 4px 16px rgba(0,0,0,0.14),0 8px 24px rgba(0,0,0,0.08);
               display:flex;align-items:center;justify-content:center">
               <span style="transform:rotate(45deg);font-size:18px;display:block">${i}</span>
             </div>
             <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);
               width:8px;height:8px;background:rgba(0,0,0,0.12);border-radius:50%;filter:blur(2px)"></div>
           </div>`,
    iconSize: [44, 52], iconAnchor: [22, 52], className: '',
  });
}

function renderMarkers() {
  Object.values(S.markers).forEach(m => m.remove());
  S.markers = {};
  S.places.forEach(p => {
    const cat = p.categories;
    const m = L.marker([p.lat, p.lng], { icon: makePinIcon(cat) })
      .addTo(S.map)
      .on('click', () => openDetail(p));
    S.markers[p.id] = m;
  });
}

/* ── Browse ───────────────────────────────────────────────────────────── */
let sortableInstance = null;

function renderBrowse() {
  const el      = document.getElementById('browse-list');
  const totalEl = document.getElementById('browse-total');
  if (totalEl) totalEl.textContent = `${S.places.length} place${S.places.length !== 1 ? 's' : ''}`;

  if (!S.places.length) {
    el.innerHTML = `<div class="empty-state"><span>🗺️</span><p>No places yet</p><small>Tap + to save your first place</small></div>`;
    return;
  }

  if (S.nearMeActive && S.userLat !== null) {
    const sorted = [...S.places]
      .map(p => ({ ...p, _dist: haversine(S.userLat, S.userLng, p.lat, p.lng) }))
      .sort((a, b) => a._dist - b._dist);
    el.innerHTML = `<div class="near-me-label">Sorted by distance from you</div>` +
      sorted.map(p => cardHTML(p, p._dist)).join('');
    if (sortableInstance) { sortableInstance.destroy(); sortableInstance = null; }
  } else {
    // City-grouped with saved order
    let savedOrder = [];
    try { savedOrder = JSON.parse(localStorage.getItem('city_order') || '[]'); } catch {}
    const byCity = {};
    S.places.forEach(p => {
      const key = [p.city, p.country].filter(Boolean).join(', ') || 'Unknown';
      (byCity[key] = byCity[key] || []).push(p);
    });
    let entries = Object.entries(byCity);
    if (savedOrder.length) {
      const ordered = [];
      savedOrder.forEach(c => { const e = entries.find(([k]) => k === c); if (e) ordered.push(e); });
      entries.forEach(e => { if (!ordered.includes(e)) ordered.push(e); });
      entries = ordered;
    }
    el.innerHTML = entries.map(([city, places]) => `
      <div class="city-group" data-city="${city.replace(/"/g, '&quot;')}">
        <div class="city-header">
          <div class="city-drag-handle" onclick="event.stopPropagation()">⋮⋮</div>
          <span class="city-name">${city}</span>
          <span class="city-count">${places.length}</span>
        </div>
        ${places.map(p => cardHTML(p)).join('')}
      </div>`).join('');

    if (sortableInstance) { sortableInstance.destroy(); sortableInstance = null; }
    if (typeof Sortable !== 'undefined') {
      sortableInstance = new Sortable(el, {
        animation: 200,
        handle: '.city-drag-handle',
        draggable: '.city-group',
        ghostClass: 'card-drag-ghost',
        chosenClass: 'card-drag-chosen',
        onEnd: () => {
          const order = [...el.querySelectorAll('.city-group')].map(g => g.dataset.city);
          localStorage.setItem('city_order', JSON.stringify(order));
        },
      });
    }
  }

  el.querySelectorAll('[data-pid]').forEach(card =>
    card.addEventListener('click', () => {
      const p = S.places.find(x => x.id === card.dataset.pid);
      if (!p) return;
      if (S.selectMode) toggleSelect(p.id);
      else openDetail(p);
    })
  );
}

function cardHTML(p, dist = null) {
  const cat      = p.categories;
  const photos   = p.photos || [];
  const date     = new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const distBadge = dist !== null ? `<span class="dist-badge">${formatDist(dist)}</span>` : '';
  const cityTag   = dist !== null && p.city ? `<span class="card-city-tag">· ${p.city}</span>` : '';
  const catColor  = cat?.color || '#DDA0DD';
  const isSelected = S.selectedIds.has(p.id);

  const leftCtrl = S.selectMode
    ? `<div class="card-checkbox ${isSelected ? 'checked' : ''}">
         ${isSelected ? '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.5"><polyline points="1.5,6 5,9.5 10.5,2.5"/></svg>' : ''}
       </div>`
    : `<div class="drag-handle" onclick="event.stopPropagation()"><span></span><span></span><span></span></div>`;

  const navBtn = S.selectMode ? '' : `
    <button class="card-nav-btn" onclick="navToPlace('${p.id}', event)" title="Navigate">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11"/>
      </svg>
    </button>`;

  return `
    <div class="place-card${isSelected ? ' selected' : ''}" data-pid="${p.id}">
      <div class="place-card-bar" style="background:${catColor}"></div>
      ${leftCtrl}
      <div class="place-card-inner">
        <div class="place-card-icon">${cat?.icon || '📍'}</div>
        <div class="place-card-body">
          <div class="place-card-cat" style="color:${catColor}">${cat?.name || 'Other'}${cityTag}</div>
          <div class="place-card-note">${p.note || 'No description'}</div>
          <div class="place-card-date">${date}${distBadge}</div>
        </div>
        ${photos.length ? `<img class="place-card-thumb" src="${photos[0]}" loading="lazy">` : ''}
        ${navBtn}
      </div>
    </div>`;
}

/* ── Add Place ────────────────────────────────────────────────────────── */
function openAddPlace() {
  S.pendingPhotos = [];
  S.currentLat = S.currentLng = null;
  S.currentCity = S.currentCountry = '';
  S.selectedCatId = S.categories[0]?.id || null;

  document.getElementById('place-note').value = '';
  document.getElementById('photo-thumbs').innerHTML = '';
  document.getElementById('loc-city').textContent = 'Detecting location…';
  document.getElementById('loc-coords').textContent = '';

  setAddMode('here');
  clearSearch();
  renderCatPicker();
  openOverlay('screen-add');

  navigator.geolocation.getCurrentPosition(onGPS, onGPSErr, { enableHighAccuracy: true, timeout: 12000 });
}

/* ── Add mode (here vs search) ──────────────────────────────────────────── */
function setAddMode(mode) {
  S.addMode = mode;
  const isSearch = mode === 'search';
  document.getElementById('mode-tab-here').classList.toggle('active', !isSearch);
  document.getElementById('mode-tab-search').classList.toggle('active', isSearch);
  document.getElementById('mini-map-wrap').style.display   = isSearch ? 'none'  : 'block';
  document.getElementById('search-section').style.display  = isSearch ? 'flex'  : 'none';
  if (!isSearch && S.addMap) setTimeout(() => S.addMap.invalidateSize(), 60);
  if (isSearch) setTimeout(() => document.getElementById('place-search-input').focus(), 60);
}

/* ── Search ──────────────────────────────────────────────────────────────── */
function onSearchInput(val) {
  clearTimeout(S.searchTimer);
  const el = document.getElementById('search-results');
  if (val.length < 2) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="search-status">Searching…</div>';
  S.searchTimer = setTimeout(() => doSearch(val), 380);
}

async function doSearch(query) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=7&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    S.searchResults = await r.json();
    renderSearchResults();
  } catch {
    document.getElementById('search-results').innerHTML =
      '<div class="search-status">Search failed — check connection</div>';
  }
}

function searchResultIcon(r) {
  const t = r.type || '';
  if (['restaurant','fast_food','food_court','biergarten'].includes(t)) return '🍽️';
  if (['cafe','coffee_shop'].includes(t))                               return '☕';
  if (['bar','pub','nightclub'].includes(t))                            return '🍺';
  if (['gym','fitness_centre','sports_centre'].includes(t))             return '🏋️';
  if (['hotel','hostel','motel','guest_house'].includes(t))             return '🏨';
  if (['pharmacy','hospital','clinic','doctors'].includes(t))           return '💊';
  if (r.class === 'tourism')  return '🏛️';
  if (r.class === 'shop')     return '🛍️';
  if (r.class === 'leisure')  return '🌿';
  if (r.class === 'natural')  return '🌲';
  return '📍';
}

function renderSearchResults() {
  const el = document.getElementById('search-results');
  if (!S.searchResults.length) {
    el.innerHTML = '<div class="search-status">No results found</div>';
    return;
  }
  el.innerHTML = S.searchResults.map((r, i) => {
    const parts = r.display_name.split(', ');
    const name  = parts[0];
    const sub   = parts.slice(1, 3).join(', ');
    return `
      <div class="search-result-item" data-ridx="${i}">
        <span class="search-result-icon">${searchResultIcon(r)}</span>
        <div>
          <div class="search-result-name">${name}</div>
          <div class="search-result-sub">${sub}</div>
        </div>
      </div>`;
  }).join('');
  el.querySelectorAll('[data-ridx]').forEach(item =>
    item.addEventListener('click', () => selectSearchResult(+item.dataset.ridx))
  );
}

function selectSearchResult(idx) {
  const r = S.searchResults[idx];
  S.currentLat = parseFloat(r.lat);
  S.currentLng = parseFloat(r.lon);
  const a = r.address || {};
  S.currentCity    = a.city || a.town || a.village || a.county || a.state || r.display_name.split(',')[0];
  S.currentCountry = a.country || '';

  document.getElementById('loc-city').textContent =
    [S.currentCity, S.currentCountry].filter(Boolean).join(', ');
  document.getElementById('loc-coords').textContent =
    `${S.currentLat.toFixed(5)}, ${S.currentLng.toFixed(5)}`;

  setAddMode('here');

  if (!S.addMap) {
    S.addMap = L.map('add-map', { zoomControl: false, attributionControl: false })
      .setView([S.currentLat, S.currentLng], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png', { maxZoom: 19 }).addTo(S.addMap);
  } else {
    if (S.addMapMarker) S.addMapMarker.remove();
    S.addMap.setView([S.currentLat, S.currentLng], 15);
  }
  S.addMapMarker = L.marker([S.currentLat, S.currentLng]).addTo(S.addMap);
  setTimeout(() => S.addMap.invalidateSize(), 80);
}

function clearSearch() {
  const inp = document.getElementById('place-search-input');
  const res = document.getElementById('search-results');
  if (inp) inp.value = '';
  if (res) res.innerHTML = '';
  S.searchResults = [];
}

/* ── Near Me ─────────────────────────────────────────────────────────────── */
function toggleNearMe() {
  if (!S.nearMeActive) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        S.userLat = pos.coords.latitude;
        S.userLng = pos.coords.longitude;
        S.nearMeActive = true;
        document.getElementById('near-me-btn').classList.add('active');
        renderBrowse();
      },
      () => toast('Could not get your location'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  } else {
    S.nearMeActive = false;
    document.getElementById('near-me-btn').classList.remove('active');
    renderBrowse();
  }
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

async function onGPS(pos) {
  const { latitude: lat, longitude: lng } = pos.coords;
  S.currentLat = lat; S.currentLng = lng;
  document.getElementById('loc-coords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  // Mini map
  if (!S.addMap) {
    S.addMap = L.map('add-map', { zoomControl: false, attributionControl: false }).setView([lat, lng], 16);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png', { maxZoom: 19 }).addTo(S.addMap);
  } else {
    S.addMap.setView([lat, lng], 16);
    if (S.addMapMarker) S.addMapMarker.remove();
  }
  S.addMapMarker = L.marker([lat, lng]).addTo(S.addMap);

  // Reverse geocode
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
      headers: { 'Accept-Language': 'en' }
    });
    const d = await r.json();
    const a = d.address;
    S.currentCity    = a.city || a.town || a.village || a.county || a.state || 'Unknown';
    S.currentCountry = a.country || '';
    document.getElementById('loc-city').textContent =
      [S.currentCity, S.currentCountry].filter(Boolean).join(', ');
  } catch {
    document.getElementById('loc-city').textContent = 'Location detected';
  }
}

function onGPSErr() {
  document.getElementById('loc-city').textContent = 'Could not get location';
}

function closeAddPlace() { closeOverlay('screen-add'); }

/* Category picker in add form */
function renderCatPicker() {
  const el = document.getElementById('cat-picker');
  el.innerHTML = S.categories.map(c => `
    <div class="cat-chip ${c.id === S.selectedCatId ? 'active' : ''}"
         style="--chip-color:${c.color}"
         data-cid="${c.id}">${c.icon} ${c.name}</div>`).join('');
  el.querySelectorAll('.cat-chip').forEach(chip =>
    chip.addEventListener('click', () => { S.selectedCatId = chip.dataset.cid; renderCatPicker(); })
  );
}

/* Photos */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('photo-input').addEventListener('change', async e => {
    for (const file of e.target.files) {
      const compressed = await compressImage(file);
      const dataUrl = await toDataUrl(compressed);
      S.pendingPhotos.push({ file: compressed, dataUrl });
    }
    renderPendingPhotos();
    e.target.value = '';
  });
});

function renderPendingPhotos() {
  document.getElementById('photo-thumbs').innerHTML = S.pendingPhotos.map((p, i) => `
    <div class="photo-wrap">
      <img class="photo-thumb-img" src="${p.dataUrl}">
      <button class="photo-remove-btn" onclick="removePhoto(${i})">✕</button>
    </div>`).join('');
}

function removePhoto(i) { S.pendingPhotos.splice(i, 1); renderPendingPhotos(); }

async function compressImage(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1400;
      let w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob(blob => {
        URL.revokeObjectURL(url);
        resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.82);
    };
    img.src = url;
  });
}

function toDataUrl(file) {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.readAsDataURL(file);
  });
}

async function uploadPhoto(file, placeId) {
  const path = `${placeId}/${Date.now()}.jpg`;
  const { error } = await db.storage.from('place-photos').upload(path, file, { contentType: 'image/jpeg' });
  if (error) throw error;
  return db.storage.from('place-photos').getPublicUrl(path).data.publicUrl;
}

/* Save */
async function savePlace() {
  if (!S.currentLat) { toast('Still getting your location…'); return; }
  if (!S.selectedCatId) { toast('Pick a category'); return; }

  const btn = document.getElementById('btn-save-place');
  btn.textContent = 'Saving…'; btn.disabled = true;

  try {
    const note = document.getElementById('place-note').value.trim();
    const { data: rows, error } = await db.from('places').insert({
      lat: S.currentLat, lng: S.currentLng,
      city: S.currentCity, country: S.currentCountry,
      note, category_id: S.selectedCatId, photos: [],
    }).select();

    if (error) throw error;
    const placeId = rows?.[0]?.id;

    if (S.pendingPhotos.length && placeId) {
      toast('Uploading photos…');
      const urls = [];
      for (const ph of S.pendingPhotos) urls.push(await uploadPhoto(ph.file, placeId));
      await db.from('places').update({ photos: urls }).eq('id', placeId);
    }

    closeAddPlace();
    toast('Saved ✓');
    await loadData();
    renderMarkers();
  } catch (err) {
    console.error(err);
    toast('Error: ' + (err.message || 'Could not save'));
  } finally {
    btn.textContent = 'Save'; btn.disabled = false;
  }
}

/* ── Detail ───────────────────────────────────────────────────────────── */
function openDetail(place) {
  S.activePlaceId = place.id;
  const cat = place.categories;

  document.getElementById('detail-cat-label').textContent = `${cat?.icon || '📍'} ${cat?.name || 'Place'}`;
  document.getElementById('detail-city').textContent    = place.city || '';
  document.getElementById('detail-country').textContent = place.country || '';
  document.getElementById('detail-note').textContent    = place.note || 'No description';
  document.getElementById('detail-date').textContent    =
    new Date(place.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const strip = document.getElementById('detail-photos');
  const photos = place.photos || [];
  strip.innerHTML = photos.map(url =>
    `<img class="detail-photo-img" src="${url}" loading="lazy">`).join('');

  openOverlay('screen-detail');
}

function closeDetail() { closeOverlay('screen-detail'); }

function openInMaps() {
  const p = S.places.find(x => x.id === S.activePlaceId);
  if (p) window.open(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`, '_blank');
}

function navToPlace(id, e) {
  e.stopPropagation();
  const p = S.places.find(x => x.id === id);
  if (p) window.open(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`, '_blank');
}

async function deleteCurrentPlace() {
  if (!confirm('Delete this place?')) return;
  const id = S.activePlaceId;
  await db.from('places').delete().eq('id', id);
  S.markers[id]?.remove();
  delete S.markers[id];
  S.places = S.places.filter(p => p.id !== id);
  closeDetail();
  renderBrowse();
  toast('Deleted');
}

/* ── Select mode ──────────────────────────────────────────────────────── */
function toggleSelectMode() {
  S.selectMode = !S.selectMode;
  S.selectedIds = new Set();
  const btn = document.getElementById('select-btn');
  const bar = document.getElementById('select-bar');
  if (btn) btn.textContent = S.selectMode ? 'Done' : 'Select';
  if (bar) bar.style.display = S.selectMode ? 'flex' : 'none';
  renderBrowse();
}

function toggleSelect(id) {
  if (S.selectedIds.has(id)) S.selectedIds.delete(id);
  else S.selectedIds.add(id);
  const n = S.selectedIds.size;
  const countEl = document.getElementById('select-count');
  const delBtn  = document.getElementById('select-delete-btn');
  if (countEl) countEl.textContent = `${n} selected`;
  if (delBtn)  delBtn.disabled = n === 0;
  renderBrowse();
}

async function deleteSelected() {
  const n = S.selectedIds.size;
  if (!n) return;
  if (!confirm(`Delete ${n} place${n > 1 ? 's' : ''}?`)) return;
  const ids = [...S.selectedIds];
  for (const id of ids) {
    await db.from('places').delete().eq('id', id);
    S.markers[id]?.remove();
    delete S.markers[id];
  }
  S.places = S.places.filter(p => !ids.includes(p.id));
  S.selectedIds = new Set();
  S.selectMode = false;
  document.getElementById('select-bar').style.display = 'none';
  document.getElementById('select-btn').textContent = 'Select';
  renderBrowse();
  toast(`Deleted ${n} place${n > 1 ? 's' : ''}`);
}

/* ── Settings ─────────────────────────────────────────────────────────── */
function openSettings() {
  renderSettingsCats();
  openOverlay('screen-settings');
}

function closeSettings() { closeOverlay('screen-settings'); }

function renderStats() {
  const el = document.getElementById('settings-stats');
  if (!el) return;
  const totalPlaces   = S.places.length;
  const uniqueCities  = new Set(S.places.map(p => p.city).filter(Boolean)).size;
  const uniqueCountries = new Set(S.places.map(p => p.country).filter(Boolean)).size;
  const catCounts = {};
  S.places.forEach(p => {
    const cat = S.categories.find(c => c.id === p.category_id);
    if (cat) catCounts[cat.id] = (catCounts[cat.id] || 0) + 1;
  });
  const topCatEntry = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
  const topCat = topCatEntry ? S.categories.find(c => c.id === topCatEntry[0]) : null;

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${totalPlaces}</div>
      <div class="stat-label">Places logged</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${uniqueCities}</div>
      <div class="stat-label">Cities explored</div>
    </div>
    ${uniqueCountries > 0 ? `
    <div class="stat-card">
      <div class="stat-value">${uniqueCountries}</div>
      <div class="stat-label">Countries visited</div>
    </div>` : ''}
    ${topCat ? `
    <div class="stat-card ${uniqueCountries > 0 ? '' : 'stat-card-wide'}">
      <div class="stat-top-cat">
        <div class="stat-cat-icon">${topCat.icon}</div>
        <div class="stat-cat-info">
          <div class="stat-cat-name">${topCat.name}</div>
          <div class="stat-cat-sub">Top category · ${topCatEntry[1]} place${topCatEntry[1] !== 1 ? 's' : ''}</div>
        </div>
      </div>
    </div>` : ''}`;
}

function renderSettingsCats() {
  renderStats();
  document.getElementById('settings-cats').innerHTML = S.categories.map(c => `
    <div class="settings-cat-row">
      <span class="settings-cat-dot" style="background:${c.color}"></span>
      <span class="settings-cat-icon">${c.icon}</span>
      <span class="settings-cat-name">${c.name}</span>
    </div>`).join('');
}

function resetPIN() {
  if (!confirm('Reset your PIN? You\'ll need to create a new one.')) return;
  localStorage.removeItem('ph');
  S.pin = ''; S.isSettingPin = false; S.firstPinEntry = '';
  updateDots(0);
  document.getElementById('pin-subtitle').textContent = 'Create a new PIN';
  closeSettings();
  showScreen('screen-pin');
}

/* ── Category modal ───────────────────────────────────────────────────── */
function openCategoryModal() {
  S.pickedEmoji = '📍'; S.pickedColor = '#FF6B6B';
  document.getElementById('cat-name-input').value = '';
  document.querySelectorAll('.emoji-opt').forEach(e => e.classList.toggle('selected', e.dataset.emoji === '📍'));
  document.querySelectorAll('.color-opt').forEach(c => c.classList.toggle('selected', c.dataset.color === '#FF6B6B'));
  document.getElementById('modal-cat').classList.add('open');
}

function closeCategoryModal() {
  document.getElementById('modal-cat').classList.remove('open');
}

async function createCategory() {
  const name = document.getElementById('cat-name-input').value.trim();
  if (!name) { toast('Enter a name'); return; }

  const { data, error } = await db.from('categories').insert({
    name, icon: S.pickedEmoji, color: S.pickedColor,
  }).select();

  if (error || !data?.length) { console.error(error); toast('Error creating category'); return; }

  const newCat = data[0];
  S.categories.push(newCat);
  S.selectedCatId = newCat.id;
  closeCategoryModal();
  renderCatPicker();
  renderSettingsCats();
  toast(`"${name}" added`);
}

/* ── Toast ────────────────────────────────────────────────────────────── */
let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ── Init ─────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (!localStorage.getItem('ph'))
    document.getElementById('pin-subtitle').textContent = 'Create a PIN to protect your places';

  // Numpad
  document.querySelectorAll('.num-btn[data-num]').forEach(b =>
    b.addEventListener('click', () => onPinDigit(b.dataset.num))
  );
  document.getElementById('pin-delete').addEventListener('click', pinBack);

  // Emoji/color pickers
  document.querySelectorAll('.emoji-opt').forEach(e =>
    e.addEventListener('click', () => {
      document.querySelectorAll('.emoji-opt').forEach(x => x.classList.remove('selected'));
      e.classList.add('selected'); S.pickedEmoji = e.dataset.emoji;
    })
  );
  document.querySelectorAll('.color-opt').forEach(c =>
    c.addEventListener('click', () => {
      document.querySelectorAll('.color-opt').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected'); S.pickedColor = c.dataset.color;
    })
  );

  // Close modal on backdrop tap
  document.getElementById('modal-cat').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCategoryModal();
  });

  // Search input
  document.getElementById('place-search-input').addEventListener('input', e => {
    onSearchInput(e.target.value.trim());
  });

  // Online/offline feedback
  window.addEventListener('offline', () => toast('You\'re offline'));
  window.addEventListener('online',  () => toast('Back online'));
});

/* ── Kill old service workers + their caches ─────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => r.unregister());
  });
}
