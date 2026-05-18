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
  pendingPhotos: [],     // { file, dataUrl }[]
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
    d.style.background = '#e94560';
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
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');

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
function initMainMap() {
  if (S.map) { renderMarkers(); return; }
  S.map = L.map('map', { zoomControl: false }).setView([20, 10], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(S.map);
  L.control.zoom({ position: 'bottomleft' }).addTo(S.map);
  renderMarkers();
}

function makePinIcon(cat) {
  const c = cat?.color || '#DDA0DD';
  const i = cat?.icon  || '📍';
  return L.divIcon({
    html: `<div style="width:38px;height:38px;background:${c};border-radius:50% 50% 50% 0;
             transform:rotate(-45deg);border:2px solid rgba(255,255,255,.4);
             box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">
             <span style="transform:rotate(45deg);font-size:17px">${i}</span></div>`,
    iconSize: [38, 38], iconAnchor: [19, 38], className: '',
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
function renderBrowse() {
  const el = document.getElementById('browse-list');
  if (!S.places.length) {
    el.innerHTML = `<div class="empty-state"><span>🗺️</span><p>No places saved yet</p><small>Tap + to save your first place</small></div>`;
    return;
  }

  const byCity = {};
  S.places.forEach(p => {
    const key = [p.city, p.country].filter(Boolean).join(', ') || 'Unknown';
    (byCity[key] = byCity[key] || []).push(p);
  });

  el.innerHTML = Object.entries(byCity).map(([city, places]) => `
    <div class="city-group">
      <div class="city-header">
        <span class="city-name">${city}</span>
        <span class="city-count">${places.length}</span>
      </div>
      ${places.map(cardHTML).join('')}
    </div>`).join('');

  el.querySelectorAll('[data-pid]').forEach(card =>
    card.addEventListener('click', () => {
      const p = S.places.find(x => x.id === card.dataset.pid);
      if (p) openDetail(p);
    })
  );
}

function cardHTML(p) {
  const cat   = p.categories;
  const photos = p.photos || [];
  const date  = new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `
    <div class="place-card" data-pid="${p.id}">
      <div class="place-card-icon">${cat?.icon || '📍'}</div>
      <div class="place-card-body">
        <div class="place-card-cat" style="color:${cat?.color || '#DDA0DD'}">${cat?.name || 'Other'}</div>
        <div class="place-card-note">${p.note || 'No description'}</div>
        <div class="place-card-date">${date}</div>
      </div>
      ${photos.length ? `<img class="place-card-thumb" src="${photos[0]}" loading="lazy">` : ''}
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

  renderCatPicker();
  openOverlay('screen-add');

  navigator.geolocation.getCurrentPosition(onGPS, onGPSErr, { enableHighAccuracy: true, timeout: 12000 });
}

async function onGPS(pos) {
  const { latitude: lat, longitude: lng } = pos.coords;
  S.currentLat = lat; S.currentLng = lng;
  document.getElementById('loc-coords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  // Mini map
  if (!S.addMap) {
    S.addMap = L.map('add-map', { zoomControl: false, attributionControl: false }).setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(S.addMap);
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
    const { data: place, error } = await db.from('places').insert({
      lat: S.currentLat, lng: S.currentLng,
      city: S.currentCity, country: S.currentCountry,
      note: document.getElementById('place-note').value.trim(),
      category_id: S.selectedCatId,
      photos: [],
    }).select('*, categories(id,name,icon,color)').single();

    if (error) throw error;

    if (S.pendingPhotos.length) {
      toast('Uploading photos…');
      const urls = [];
      for (const p of S.pendingPhotos) {
        urls.push(await uploadPhoto(p.file, place.id));
      }
      await db.from('places').update({ photos: urls }).eq('id', place.id);
      place.photos = urls;
    }

    S.places.unshift(place);
    renderMarkers();
    S.map?.flyTo([place.lat, place.lng], 15, { duration: 1 });

    closeAddPlace();
    toast('Saved ✓');
  } catch (err) {
    console.error(err);
    toast('Error saving — check your connection');
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
  if (p) window.open(`https://www.google.com/maps?q=${p.lat},${p.lng}`, '_blank');
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

/* ── Settings ─────────────────────────────────────────────────────────── */
function openSettings() {
  renderSettingsCats();
  openOverlay('screen-settings');
}

function closeSettings() { closeOverlay('screen-settings'); }

function renderSettingsCats() {
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
  }).select().single();

  if (error) { toast('Error creating category'); return; }

  S.categories.push(data);
  S.selectedCatId = data.id;
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

  // Online/offline feedback
  window.addEventListener('offline', () => toast('You\'re offline'));
  window.addEventListener('online',  () => toast('Back online'));
});

/* ── Service worker ───────────────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
