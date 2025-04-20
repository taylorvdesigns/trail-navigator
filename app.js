// ─── 0) GLOBAL STATE & MAP SETUP ─────────────────────────────────────
let userMarker     = null;
let routeLatLngs   = [];
let routeLine;
let lastPos        = null;
let userBearing    = null;
let poiData        = [];
let lastDetailDest = null;

// for filtering Nav view
const filterDefs = [
  { slug: 'food',      iconClass: 'fa-solid fa-utensils',       title: 'Food'      },
  { slug: 'drink',     iconClass: 'fa-solid fa-beer-mug-empty', title: 'Drink'     },
  { slug: 'ice-cream', iconClass: 'fa-solid fa-ice-cream',       title: 'Ice Cream' },
  { slug: 'landmark',  iconClass: 'fa-solid fa-map-pin',         title: 'Landmark'  },
  { slug: 'playground',iconClass: 'fa-solid fa-child-reaching',  title: 'Playground'}
];
const activeFilters = new Set();

// hold the exact arrays you rendered in Nav
let currentAhead  = [];
let currentBehind = [];

// bottom‑tabs & overlays
const tabMap      = document.getElementById('tab-map');
const tabNav      = document.getElementById('tab-nav');
const tabList     = document.getElementById('tab-list');
const navOverlay    = document.getElementById('nav-overlay');
const listOverlay   = document.getElementById('list-overlay');
const detailOverlay = document.getElementById('detail-overlay');
const entryOverlay  = document.getElementById('entry-overlay');
const entryClose   = document.getElementById('entry-close');

// lists within overlays
const aheadList   = document.getElementById('ahead-list');
const behindList  = document.getElementById('behind-list');
const entryList   = document.getElementById('entry-list');

// floating buttons
const changeEntryBtn = document.getElementById('change-entry');
const closeDetailBtn = document.getElementById('close-detail');

// detail view elements
const detailTitle    = document.getElementById('detail-title');
const detailImg      = document.getElementById('detail-img');
const detailDesc     = document.getElementById('detail-desc');
const detailDistance = document.getElementById('detail-distance');

// category → FontAwesome
const categoryIcons = {
  food:       'fas fa-utensils',
  drink:      'fas fa-beer',
  'ice-cream':'fas fa-ice-cream',
  landmark:   'fas fa-map-pin',
  playground: 'fas fa-child-reaching'
};

// helper to render category icons
function getCategoryIcons(categories = []) {
  return categories
    .map(cat => categoryIcons[cat.slug])  // look up each slug
    .filter(Boolean)                      // drop any undefined
    .map(cls => `<i class="${cls}" aria-hidden="true"></i>`)
    .join(' ');
}

// filters UI
const filterContainer = document.querySelector('.filter-buttons');
filterDefs.forEach(f => {
  const btn = document.createElement('button');
  btn.innerHTML    = `<i class="${f.iconClass}"></i>`;
  btn.title        = f.title;
  btn.dataset.slug = f.slug;
  filterContainer.appendChild(btn);

  btn.addEventListener('click', () => {
    if (activeFilters.has(f.slug)) {
      activeFilters.delete(f.slug);
      btn.classList.remove('active');
    } else {
      activeFilters.add(f.slug);
      btn.classList.add('active');
    }
    updateNavView();
  });
});

// initialize map
const DEFAULT_COORDS = [40.785091, -73.968285];
const map = L.map('map').setView(DEFAULT_COORDS, 15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// ─── 1) Fetch & draw the RWGPS route ─────────────────────────────────
const ROUTE_ID   = 50357921;
const API_KEY    = '81c8a1eb';
const AUTH_TOKEN = '5cc5e4b222670322422e8a3fb7324379';
const routeUrl   = `https://ridewithgps.com/api/v1/routes/${ROUTE_ID}.json?version=2`;

fetch(routeUrl, {
  headers: {
    'x-rwgps-api-key':    API_KEY,
    'x-rwgps-auth-token': AUTH_TOKEN
  }
})
  .then(r => {
    if (!r.ok) throw new Error(`RWGPS error: ${r.status}`);
    return r.json();
  })
  .then(data => {
    // draw polyline
    const pts = data.route.track_points;
    routeLatLngs = pts.map(p => [p.y, p.x]);
    L.polyline(routeLatLngs, { weight: 4, color: '#0077CC' }).addTo(map);
    map.fitBounds(routeLatLngs);

    // build turf lineString ([lng,lat])
    routeLine = turf.lineString(routeLatLngs.map(([lat,lng]) => [lng, lat]));

    // set trail name
    const tn = data.route.name || 'Trail Navigator';
    document.getElementById('trail-header').textContent = tn;
    const navName = document.getElementById('nav-trail-name');
    if (navName) navName.textContent = tn;
  })
  .catch(console.error);

// ─── 2) Helpers: bearing & straight‑line distance ────────────────────
function getBearing(start, end) {
  const toRad = d => d * Math.PI/180;
  const toDeg = r => r * 180/Math.PI;
  const [lat1, lon1] = start.map(toRad);
  const [lat2, lon2] = end.map(toRad);
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon)*Math.cos(lat2);
  const x = Math.cos(lat1)*Math.sin(lat2)
          - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function haversineDistance([lat1, lon1], [lat2, lon2]) {
  const toRad = d => d * Math.PI/180;
  const R     = 6371; // km
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2
          + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))
          * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── 3) Build the Nav view (ahead/behind lists) ──────────────────────
function updateNavView() {
  if (!lastPos || !poiData.length || !routeLine) return;

  // 1) apply category filters
  let data = poiData;
  if (activeFilters.size) {
    data = data.filter(d =>
      d.categories?.some(c => activeFilters.has(c.slug))
    );
  }

  // 2) snap your position once
  const userPt    = turf.point([ lastPos[1], lastPos[0] ]);
  const snappedU  = turf.nearestPointOnLine(routeLine, userPt, { units:'miles' });

  const ahead  = [];
  const behind = [];
  const bearing = userBearing ?? 0;

  data.forEach(dest => {
    // snap POI
    const poiPt   = turf.point([ dest.coords[1], dest.coords[0] ]);
    const snappedP= turf.nearestPointOnLine(routeLine, poiPt, { units:'miles' });

    // measure along-trail both ways
    const seg1 = turf.lineSlice(snappedU, snappedP, routeLine);
    const seg2 = turf.lineSlice(snappedP, snappedU, routeLine);
    const d1   = turf.length(seg1, { units:'miles' });
    const d2   = turf.length(seg2, { units:'miles' });
    const dist = Math.min(d1, d2);
    dest._currentDistance = dist;

    // bearing bucket
    const b    = getBearing(lastPos, dest.coords);
    const diff = Math.min(Math.abs(b - bearing), 360 - Math.abs(b - bearing));
    if (diff <= 90) ahead.push(dest);
    else            behind.push(dest);
  });

  // sort & slice
  ahead.sort((a,b) => a._currentDistance - b._currentDistance);
  behind.sort((a,b) => a._currentDistance - b._currentDistance);

  // render Ahead: five closest but *reverse* so furthest is at top
  const aheadList  = document.getElementById('ahead-list');
  const behindList = document.getElementById('behind-list');
  aheadList.innerHTML = '';
  behindList.innerHTML = '';

ahead
  .slice(0,5)
  .reverse()
  .forEach(d => {
	  // inside your `ahead.forEach(d => { … })` or similar:
	  console.log(
	    '→', d.name,
	    'slugs =', d.categories.map(c=>c.slug),
	    'html =', getCategoryIcons(d.categories)
	  );
	  
	  
	  
    aheadList.insertAdjacentHTML('beforeend', `
      <div class="poi-row" data-id="${d.id}">
        <span class="poi-name">
          ${d.name} ${getCategoryIcons(d.categories)}
        </span>
        <span>${d._currentDistance.toFixed(1)} mi</span>
      </div>`);
  });

  // render Behind: three closest in normal order
behind
  .slice(0,3)
  .forEach(d => {
    behindList.insertAdjacentHTML('beforeend', `
      <div class="poi-row" data-id="${d.id}">
        <span class="poi-name">
          ${d.name} ${getCategoryIcons(d.categories)}
        </span>
        <span>${d._currentDistance.toFixed(1)} mi</span>
      </div>`);
  });
}

// Delegated listener for all POI rows in the Nav view
navOverlay.addEventListener('click', evt => {
  const row = evt.target.closest('.poi-row[data-id]');
  if (!row) return;
  const id = +row.dataset.id;
  const dest = poiData.find(d => d.id === id);
  if (dest) {
    showDetail(dest);
  }
});

// ─── 4) showDetail with fallback image ────────────────────────────────
function showDetail(dest) {
  lastDetailDest = dest;

  // hide any other overlays
  navOverlay.style.display    = 'none';
  listOverlay.style.display   = 'none';
  entryOverlay.style.display  = 'none';

  // populate the detail panel
  detailTitle.textContent    = dest.name;
  detailImg.src              = dest.image   || 'https://picsum.photos/200';
  detailImg.alt              = dest.name;
  detailDesc.textContent     = dest.description;

  if (typeof dest._currentDistance === 'number') {
    detailDistance.textContent = dest._currentDistance.toFixed(1) + ' mi';
    detailDistance.parentElement.style.display = '';
  } else {
    detailDistance.parentElement.style.display = 'none';
  }

  // show it
  detailOverlay.style.display = 'block';
}

// wire up close button
closeDetailBtn.addEventListener('click', () => {
  detailOverlay.style.display = 'none';

  // restore overlays exactly as if you’d clicked that tab:
  if (lastActiveTab === tabMap) {
    navOverlay.style.display  = 'none';
    listOverlay.style.display = 'none';

  } else if (lastActiveTab === tabNav) {
    navOverlay.style.display  = 'block';
    listOverlay.style.display = 'none';
    updateNavView();  // rebuild ahead/behind lists

  } else if (lastActiveTab === tabList) {
    navOverlay.style.display  = 'none';
    listOverlay.style.display = 'block';
  }

  // restore the CSS “active” state
  setActiveTab(lastActiveTab);
});




// ─── 5) Click‑through on Nav rows ────────────────────────────────────
aheadList.addEventListener('click',  handleNavRowClick);
behindList.addEventListener('click', handleNavRowClick);

function handleNavRowClick(evt) {
  const row = evt.target.closest('.poi-row');
  if (!row) return;
  const which = row.dataset.list;
  const idx   = parseInt(row.dataset.idx,10);
  const dest  = which === 'ahead'
    ? currentAhead[idx]
    : currentBehind[idx];
  if (dest) showDetail(dest);
}

// ─── 6) Render the List view grouped by tags ────────────────────────
function renderListView() {
  const groups = {};
  poiData.forEach(dest => {
    const tag = dest.tags[0]?.slug;
    if (!tag) return;
    if (!groups[tag]) groups[tag] = { name: dest.tags[0].name, items: [] };
    groups[tag].items.push(dest);
  });

  listOverlay.innerHTML = '';
  Object.values(groups).forEach(group => {
    const sec = document.createElement('section');
    const h2  = document.createElement('h2');
    h2.textContent = group.name;
    sec.appendChild(h2);
    const ul  = document.createElement('ul');
    ul.style.listStyle = 'none';
    group.items.forEach(dest => {
      const li = document.createElement('li');
      li.classList.add('poi-row');
      li.dataset.idx = poiData.indexOf(dest);
      li.innerHTML = `
        <span class="poi-name">
          ${dest.name} ${getCategoryIcons(dest.categories)}
        </span>`;
      li.addEventListener('click', () => {
        showDetail(dest);
        listOverlay.style.display = 'none';
        setActiveTab(tabList);
      });
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    listOverlay.appendChild(sec);
  });
}

// ─── 7) Load POIs from WordPress ────────────────────────────────────
fetch('https://srtmaps.elev8maps.com/wp-json/geodir/v2/places?per_page=100')
  .then(r => {
    if (!r.ok) throw new Error(`GeoDir error ${r.status}`);
    return r.json();
  })
  .then(places => {
    // Map each WP place into our poiData, now including a unique `id`
    poiData = places.map(p => ({
      id:          p.id,                   // ← add this
      name:        p.title.rendered,
      coords:      [ +p.latitude, +p.longitude ],
      description: p.content.raw,
      image:       p.featured_image?.[0]?.source_url || '',
      // keep tags if you need them later
      tags:        (p.post_tags     || []).map(t => ({ slug: t.slug, name: t.name })),
      // turn post_category into an array of slugs (or objects if you prefer)
      categories:  (p.post_category || []).map(c => ({
                      id:   c.id,
                      name: c.name,
                      slug: c.slug.replace(/^\d+-/, '')
                    }))
					.filter(cat => cat.slug !== 'business')
    }));

    // draw them on the map as before:
    places.forEach(p => {
      const lat = parseFloat(p.latitude),
            lng = parseFloat(p.longitude);
      if (isNaN(lat) || isNaN(lng)) return;
      L.marker([lat, lng])
        .addTo(map)
        .bindPopup(`<strong>${p.title.rendered}</strong>`);
    });

    // now that poiData has ids, refresh your views:
    updateNavView();
    renderListView();
  })
  .catch(err => console.error(err));


// ─── 8) Real‑time geolocation watcher ───────────────────────────────
  navigator.geolocation.watchPosition(pos => {
    if (!routeLine) return;  
    const coords = [pos.coords.latitude, pos.coords.longitude];

    // always update/move your marker
    if (!userMarker) {
      userMarker = L.marker(coords).addTo(map).bindPopup('You are here').openPopup();
    } else {
      userMarker.setLatLng(coords);
    }

    // if we have a last‐pos, *then* check lateral offset
    if (lastPos) {
      const userPt    = turf.point([ coords[1], coords[0] ]);
      const snapped   = turf.nearestPointOnLine(routeLine, userPt, { units: 'kilometers' });
      const [ lng, lat ] = snapped.geometry.coordinates;
      const lateralKm = haversineDistance(coords, [lat, lng]);

	  let hasChosenEntry = false;

	  navigator.geolocation.watchPosition(pos => {
	    if (!routeLine || hasChosenEntry) return;

	    /* … compute lateralKm … */

	    if (lateralKm > 0.152) {
	      entryOverlay.style.display = 'block';
	      return;
	    }

	    // once we use real position, we can stop showing entry modal
	    hasChosenEntry = true;
	    entryOverlay.style.display = 'none';
	    /* … update map & nav … */
	  },
	  err => console.warn(err),
	  { enableHighAccuracy: false });
    }

    // if we reach here, either it’s our very first fix, or we’re on‑trail:
    entryOverlay.style.display = 'none';
    if (lastPos) userBearing = getBearing(lastPos, coords);
    lastPos = coords;
    updateNavView();
  },
  err => console.warn(err),
  { enableHighAccuracy: false });


// ─── 9) Entry‑points UI & Bottom‑tab navigation ──────────────────────
const baseEntryPoints = [
  { name: "Between Swamp Rabbit Cafe and Unity", coords: [34.863381, -82.421034] },
  { name: "Between Downtown and Unity",           coords: [34.848406, -82.404906] },
  { name: "Furman Univ",                           coords: [34.926555, -82.443180] },
  { name: "Greenville Tech",                       coords: [34.826607, -82.378538] }
];
let entryPoints = [];

function renderEntryList() {
  entryList.innerHTML = '';
  const startPt = { name: "Trail Start", coords: routeLatLngs[0] };
  const endPt   = { name: "Trail End",   coords: routeLatLngs.slice(-1)[0] };
  entryPoints = [ startPt, ...baseEntryPoints, endPt ];

  entryPoints.forEach((pt,i) => {
    const btn = document.createElement('button');
    btn.textContent    = pt.name;
    btn.dataset.index  = i;
    entryList.appendChild(btn);
	btn.addEventListener('click', () => {
	  lastPos = [...pt.coords];
	  userBearing = null;
	  hasChosenEntry = true;       // ← prevent future pop‑ups
	  entryOverlay.style.display = 'none';
	  navOverlay.style.display   = 'block';
	  setActiveTab(tabNav);
	  updateNavView();
	});navOverlay.style.display = 'flex';
  });
}

changeEntryBtn.addEventListener('click', () => {
  renderEntryList();
  entryOverlay.style.display = 'block';
});

// hide modal on “×”
entryClose.addEventListener('click', () => {
  entryOverlay.style.display = 'none';
});

let lastActiveTab = tabMap;  // default

function setActiveTab(tabBtn) {
  [tabMap, tabNav, tabList].forEach(b => b.classList.remove('active'));
  tabBtn.classList.add('active');
  lastActiveTab = tabBtn;   // remember it
}

tabMap.addEventListener('click', () => {
  navOverlay.style.display   = 'none';
  listOverlay.style.display  = 'none';
  entryOverlay.style.display = 'none';
  setActiveTab(tabMap);
});

tabNav.addEventListener('click', () => {
  navOverlay.style.display = 'flex';
  listOverlay.style.display = 'none';
  entryOverlay.style.display= 'none';
  setActiveTab(tabNav);
  updateNavView();
});


tabList.addEventListener('click', () => {
  navOverlay.style.display   = 'none';
  listOverlay.style.display  = 'block';
  entryOverlay.style.display = 'none';
  setActiveTab(tabList);
});


// right after your bottom‑tab listeners…
renderEntryList();
entryOverlay.style.display = 'block';
navOverlay.style.display   = 'none';
listOverlay.style.display  = 'none';
detailOverlay.style.display= 'none';
setActiveTab(tabMap);

