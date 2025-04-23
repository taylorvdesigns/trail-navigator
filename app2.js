// ─── 0) GLOBAL STATE & MAP SETUP ─────────────────────────────────────
let userMarker     = null;
let routeLatLngs   = [];
let routeLine      = null;
let lastPos        = null;
let userBearing    = null;
let poiData        = [];
let lastDetailDest = null;
let hasManualEntry = false;
let currentMode    = 'walk';
let lastActiveTab  = null;
let entryPoints    = [];
let activeFilter   = null;
let currentAhead   = [];
let currentBehind  = [];

// Elements that will be accessed globally
let navOverlay, listOverlay, detailOverlay, entryOverlay;
let tabMap, tabNav, tabList;
let aheadList, behindList, entryList;
let detailTitle, detailImg, detailDesc, detailDistance;
let changeEntryBtn, closeDetailBtn, entryClose;

// Constants
const DEFAULT_COORDS = [40.785091, -73.968285];
const ROUTE_ID   = 50357921;
const API_KEY    = '81c8a1eb';
const AUTH_TOKEN = '5cc5e4b222670322422e8a3fb7324379';
const ROUTE_URL  = `https://ridewithgps.com/api/v1/routes/${ROUTE_ID}.json?version=2`;
const MODE_SPEEDS = { walk: 3.1, run: 5.0, bike: 12.0 };

// Category definitions
const filterDefs = [
  { slug: 'food',      iconClass: 'fa-solid fa-utensils',        title: 'Food'      },
  { slug: 'drink',     iconClass: 'fa-solid fa-beer-mug-empty',  title: 'Drink'     },
  { slug: 'ice-cream', iconClass: 'fa-solid fa-ice-cream',       title: 'Ice Cream' },
  { slug: 'landmark',  iconClass: 'fa-solid fa-map-pin',         title: 'Landmark'  },
  { slug: 'playground',iconClass: 'fa-solid fa-child-reaching',  title: 'Playground'}
];

// Category icons mapping
const categoryIcons = {
  food:       'fas fa-utensils',
  drink:      'fas fa-beer',
  'ice-cream':'fas fa-ice-cream',
  landmark:   'fas fa-map-pin',
  playground: 'fas fa-child-reaching'
};

// Base entry points
const baseEntryPoints = [
  { name: "Between Swamp Rabbit Cafe and Unity", coords: [34.863381, -82.421034] },
  { name: "Between Downtown and Unity",          coords: [34.848406, -82.404906] },
  { name: "Furman Univ",                         coords: [34.926555, -82.443180] },
  { name: "Greenville Tech",                     coords: [34.826607, -82.378538] }
];

// Initialize map
const map = L.map('map').setView(DEFAULT_COORDS, 15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// ─── 1) HELPER FUNCTIONS ─────────────────────────────────────────────
// Bearing calculations
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

// Distance calculations
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

// Convert time to minutes string
function toMinutesStr(hours) {
  return Math.round(hours * 60) + ' min';
}

// Helper to render category icons
function getCategoryIcons(categories = []) {
  return categories
    .map(cat => categoryIcons[cat.slug])  // look up each slug
    .filter(Boolean)                      // drop any undefined
    .map(cls => `<i class="${cls}" aria-hidden="true"></i>`)
    .join(' ');
}

// ─── 2) UI FUNCTIONS ─────────────────────────────────────────────────
// Create filter buttons
function makeFilterButtons(container) {
  container.innerHTML = '';
  filterDefs.forEach(f => {
    const btn = document.createElement('button');
    btn.innerHTML    = `<i class="${f.iconClass}"></i>`;
    btn.title        = f.title;
    btn.dataset.slug = f.slug;
    if (f.slug === activeFilter) btn.classList.add('active');
    container.appendChild(btn);

    btn.addEventListener('click', () => {
      const slug = btn.dataset.slug;
      
      // toggle off if same, otherwise set
      activeFilter = (activeFilter === slug ? null : slug);

      // refresh the button states and both views
      refreshFilterUI();
      updateNavView();
      renderListView();
    });
  });
}

// Refresh filter UI state
function refreshFilterUI() {
  document
    .querySelectorAll('.filter-buttons button, .list-filters button')
    .forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.slug === activeFilter
      );
    });
}

// Set active tab
function setActiveTab(tabBtn) {
  [tabMap, tabNav, tabList].forEach(b => b.classList.remove('active'));
  tabBtn.classList.add('active');
  lastActiveTab = tabBtn;
}

// ─── 3) DATA LOADING FUNCTIONS ───────────────────────────────────────
// Load route data from RWGPS
function tryLoadRouteData() {
  fetch(ROUTE_URL, {
    headers: {
      'x-rwgps-api-key': API_KEY,
      'x-rwgps-auth-token': AUTH_TOKEN
    }
  })
    .then(r => {
      if (!r.ok) throw new Error(`RWGPS error: ${r.status}`);
      return r.json();
    })
    .then(data => {
      processRouteData(data);
    })
    .catch(err => {
      console.error("Failed to load route data:", err);
      if (window.appErrorHandler) {
        window.appErrorHandler.handleError('ROUTE', 'fetch-failed', {
          message: err.message
        });
      }
    });
}

// Process loaded route data
function processRouteData(data) {
  try {
    // Draw polyline
    const pts = data.route.track_points;
    routeLatLngs = pts.map(p => [p.y, p.x]);
    
    if (window.routeLine) {
      map.removeLayer(window.routeLine);
    }
    
    const polyline = L.polyline(routeLatLngs, { weight: 4, color: '#0077CC' }).addTo(map);
    map.fitBounds(routeLatLngs);

    // Build turf lineString ([lng,lat])
    routeLine = turf.lineString(routeLatLngs.map(([lat, lng]) => [lng, lat]));

    // Set trail name
    const tn = data.route.name || 'Trail Navigator';
    document.getElementById('trail-header').textContent = tn;
    const navName = document.getElementById('nav-trail-name');
    if (navName) navName.textContent = tn;
    
    // Update views if we have position data
    if (lastPos) {
      updateNavView();
    }
    
    // Initialize entry points now that we have the route
    renderEntryList();
  } catch (err) {
    console.error('Error processing route data:', err);
    if (window.appErrorHandler) {
      window.appErrorHandler.handleError('ROUTE', 'processing-failed', {
        message: err.message
      });
    }
  }
}

// Load POI data from WordPress
function tryLoadPoiData() {
  fetch('https://srtmaps.elev8maps.com/wp-json/geodir/v2/places?per_page=100')
    .then(r => {
      if (!r.ok) throw new Error(`GeoDir error ${r.status}`);
      return r.json();
    })
    .then(places => {
      // Map each WP place into our poiData, now including a unique `id`
      poiData = places.map(p => ({
        id:          p.id,
        name:        p.title.rendered,
        coords:      [+p.latitude, +p.longitude],
        description: p.content.raw,
        image:       p.featured_image?.[0]?.source_url || '',
        tags:        (p.post_tags     || []).map(t => ({ slug: t.slug, name: t.name })),
        categories:  (p.post_category || []).map(c => ({
                      id:   c.id,
                      name: c.name,
                      slug: c.slug.replace(/^\d+-/, '')
                    }))
                    .filter(cat => cat.slug !== 'business')
      }));

      // Add markers to the map
      places.forEach(p => {
        const lat = parseFloat(p.latitude),
              lng = parseFloat(p.longitude);
        if (isNaN(lat) || isNaN(lng)) return;
        L.marker([lat, lng])
          .addTo(map)
          .bindPopup(`<strong>${p.title.rendered}</strong>`);
      });

      // Update views
      updateNavView();
      renderListView();
    })
    .catch(err => {
      console.error("Failed to load POI data:", err);
      if (window.appErrorHandler) {
        window.appErrorHandler.handleError('POI', 'fetch-failed', {
          message: err.message
        });
      }
    });
}

// ─── 4) GEOLOCATION FUNCTIONS ─────────────────────────────────────────
function setupGeolocationWithErrorHandling() {
  if (!navigator.geolocation) {
    console.warn("Geolocation is not supported by this browser");
    if (window.appErrorHandler) {
      window.appErrorHandler.handleError('GEOLOCATION', 'not-supported');
    }
    promptManualEntryPoint();
    return;
  }

  navigator.geolocation.watchPosition(
    handlePositionUpdate,
    handlePositionError,
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

function handlePositionUpdate(pos) {
  if (!routeLine) return;
  const coords = [pos.coords.latitude, pos.coords.longitude];

  // Always update/move your marker
  if (!userMarker) {
    userMarker = L.marker(coords).addTo(map).bindPopup('You are here').openPopup();
  } else {
    userMarker.setLatLng(coords);
  }

  // If we have a last position, then check lateral offset
  if (lastPos) {
    const userPt = turf.point([coords[1], coords[0]]);
    const snapped = turf.nearestPointOnLine(routeLine, userPt, { units: 'kilometers' });
    const [lng, lat] = snapped.geometry.coordinates;
    const lateralKm = haversineDistance(coords, [lat, lng]);

    // If we're far from the trail and haven't chosen entry, show entry modal
    if (!hasManualEntry && lateralKm > 0.152) {
      entryOverlay.style.display = 'block';
      return;
    }
  }

  // Update position and bearing
  if (lastPos) userBearing = getBearing(lastPos, coords);
  lastPos = coords;
  updateNavView();
}

function handlePositionError(err) {
  console.warn("Geolocation error:", err);
  if (window.appErrorHandler) {
    window.appErrorHandler.handleError('GEOLOCATION', 'permission-denied', {
      code: err.code,
      message: err.message
    });
  }
  promptManualEntryPoint();
}

function promptManualEntryPoint() {
  renderEntryList();
  entryOverlay.style.display = 'block';
  hasManualEntry = true; // Prevent future popups
}

// ─── 5) VIEW UPDATE FUNCTIONS ──────────────────────────────────────────
// Update navigation view (ahead/behind lists)
// Update the path distance calculation in updateNavView()
function updateNavView() {
  if (!lastPos || !poiData.length || !routeLine) return;

  // Apply category filters
  let data = poiData;
  if (activeFilter) {
    data = data.filter(dest =>
      dest.categories?.some(c => c.slug === activeFilter)
    );
  }

  // Snap your position to trail
  const userPt = turf.point([lastPos[1], lastPos[0]]);
  const snappedU = turf.nearestPointOnLine(routeLine, userPt, { units: 'miles' });
  
  // Get the user's position along the trail as a fraction (0-1)
  const userFraction = snappedU.properties.location;
  
  const ahead = [];
  const behind = [];
  const bearing = userBearing ?? 0;

  data.forEach(dest => {
    // Snap POI to trail
    const poiPt = turf.point([dest.coords[1], dest.coords[0]]);
    const snappedP = turf.nearestPointOnLine(routeLine, poiPt, { units: 'miles' });
    
    // Get POI position along trail as fraction (0-1)
    const poiFraction = snappedP.properties.location;
    
    // Calculate along-trail distance
    let alongTrailDist;
    
    // If POI is further along the trail than user
    if (poiFraction > userFraction) {
      // Create a line slice from user to POI
      const segment = turf.lineSlice(snappedU, snappedP, routeLine);
      alongTrailDist = turf.length(segment, { units: 'miles' });
    } 
    // If POI is earlier on the trail than user
    else {
      // Create a line slice from POI to user
      const segment = turf.lineSlice(snappedP, snappedU, routeLine);
      alongTrailDist = turf.length(segment, { units: 'miles' });
    }
    
    // Also calculate lateral distance from the POI to the trail
    const lateralDist = turf.distance(
      poiPt, 
      turf.point(snappedP.geometry.coordinates), 
      { units: 'miles' }
    );
    
    // Store distances for later use
    dest._currentDistance = alongTrailDist;
    dest._lateralDistance = lateralDist;
    
    // Add to ahead/behind lists based on bearing
    const b = getBearing(lastPos, dest.coords);
    const diff = Math.min(Math.abs(b - bearing), 360 - Math.abs(b - bearing));
    if (diff <= 90) ahead.push(dest);
    else behind.push(dest);
  });

  // Sort each list by actual trail distance
  ahead.sort((a, b) => a._currentDistance - b._currentDistance);
  behind.sort((a, b) => a._currentDistance - b._currentDistance);
  currentAhead = ahead;
  currentBehind = behind;

  // Render Ahead: five closest but *reverse* so furthest is at top
  aheadList.innerHTML = '';
  behindList.innerHTML = '';
  
  // Add mode toggle buttons
  aheadList.insertAdjacentHTML('beforeend', `
    <div class="mode-toggle">
      <button data-mode="walk" class="${currentMode === 'walk' ? 'active' : ''}"><i class="fa-solid fa-person-walking"></i></button>
      <button data-mode="run" class="${currentMode === 'run' ? 'active' : ''}"><i class="fa-solid fa-person-running"></i></button>
      <button data-mode="bike" class="${currentMode === 'bike' ? 'active' : ''}"><i class="fa-solid fa-person-biking"></i></button>
    </div>
  `);
  
  // Add event listeners to mode buttons
  aheadList
    .querySelectorAll('.mode-toggle button')
    .forEach(btn => btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode;
      updateNavView();   // Re-draw everything in the newly selected mode
    }));
  
  // Add ahead header
  aheadList.insertAdjacentHTML('beforeend', `
    <div class="poi-row header-row">
      <div class="poi-name header-label">Destinations Ahead</div>
      <div class="poi-times">
        <span class="poi-distance">Distance</span>
        <span class="poi-time">Time</span>
      </div>
    </div>
  `);
  
  // Add behind header
  behindList.insertAdjacentHTML('beforeend', `
    <div class="poi-row header-row">
      <div class="poi-name header-label">Destinations Behind</div>
      <div class="poi-times">
        <span class="poi-distance">Distance</span>
        <span class="poi-time">Time</span>
      </div>
    </div>
  `);

  // Render ahead list
  ahead
    .slice(0, 5)
    .reverse()
    .forEach(d => {
      // Compute time for the chosen mode
      const speed = MODE_SPEEDS[currentMode];
      const hours = d._currentDistance / speed;
      const timeStr = toMinutesStr(hours);

      // Render destination row
      aheadList.insertAdjacentHTML('beforeend', `
        <div class="poi-row" data-id="${d.id}">
          <div class="poi-name">
            ${d.name} ${getCategoryIcons(d.categories)}
          </div>
          <div class="poi-times">
            <span class="poi-distance">${d._currentDistance.toFixed(1)} mi</span>
            <span class="poi-time">${timeStr}</span>
          </div>
        </div>
      `);
    });

  // Render behind list
  behind.slice(0, 3).forEach(d => {
    // Compute time for the chosen mode
    const speed = MODE_SPEEDS[currentMode];
    const hours = d._currentDistance / speed;
    const timeStr = toMinutesStr(hours);

    // Render destination row
    behindList.insertAdjacentHTML('beforeend', `
      <div class="poi-row" data-id="${d.id}">
        <div class="poi-name">
          ${d.name} ${getCategoryIcons(d.categories)}
        </div>
        <div class="poi-times">
          <span class="poi-distance">${d._currentDistance.toFixed(1)} mi</span>
          <span class="poi-time">${timeStr}</span>
        </div>
      </div>
    `);
  });
}

// Render list view grouped by tags
function renderListView() {
  // Get container and clear it
  const container = document.getElementById('list-content');
  container.innerHTML = '';

  // Optionally filter by the activeFilter
  let data = poiData;
  if (activeFilter) {
    data = data.filter(dest =>
      dest.categories?.some(c => c.slug === activeFilter)
    );
  }

  // Group by the first tag's slug
  const groups = {};
  data.forEach(dest => {
    const tag = dest.tags?.[0];
    if (!tag) return;
    const key = tag.slug;
    if (!groups[key]) groups[key] = { name: tag.name, items: [] };
    groups[key].items.push(dest);
  });

  // Build each section
  Object.values(groups).forEach(group => {
    const sec = document.createElement('section');
    sec.style.marginBottom = '1.5rem';

    const h2 = document.createElement('h2');
    h2.textContent = group.name;
    h2.style.marginBottom = '0.5rem';
    sec.appendChild(h2);

    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = '0';

    group.items.forEach(dest => {
      const li = document.createElement('li');
      li.classList.add('poi-row');
      li.dataset.id = dest.id;
      li.innerHTML = `
        <span class="poi-name">
          ${dest.name} ${getCategoryIcons(dest.categories)}
        </span>
      `;
      li.addEventListener('click', () => {
        showDetail(dest);
        listOverlay.style.display = 'none';
        setActiveTab(tabList);
      });
      ul.appendChild(li);
    });

    sec.appendChild(ul);
    container.appendChild(sec);
  });
}

// Show detail view for a destination
function showDetail(dest) {
  lastDetailDest = dest;

  // Hide any other overlays
  navOverlay.style.display = 'none';
  listOverlay.style.display = 'none';
  entryOverlay.style.display = 'none';

  // Populate the detail panel
  detailTitle.textContent = dest.name;
  detailImg.src = dest.image || 'https://picsum.photos/200';
  detailImg.alt = dest.name;
  detailDesc.textContent = dest.description;

  if (typeof dest._currentDistance === 'number') {
    detailDistance.textContent = dest._currentDistance.toFixed(1) + ' mi';
    detailDistance.parentElement.style.display = '';
  } else {
    detailDistance.parentElement.style.display = 'none';
  }

  // Show detail overlay
  detailOverlay.style.display = 'block';
}

// Render entry point list
function renderEntryList() {
  if (!entryList || !routeLatLngs.length) return;
  
  entryList.innerHTML = '';
  const startPt = { name: "Trail Start", coords: routeLatLngs[0] };
  const endPt = { name: "Trail End", coords: routeLatLngs.slice(-1)[0] };
  entryPoints = [startPt, ...baseEntryPoints, endPt];

  entryPoints.forEach((pt, i) => {
    const btn = document.createElement('button');
    btn.textContent = pt.name;
    btn.dataset.index = i;
    entryList.appendChild(btn);
    
    btn.addEventListener('click', () => {
      lastPos = [...pt.coords];
      userBearing = null;
      hasManualEntry = true; // Prevent future pop-ups
      entryOverlay.style.display = 'none';
      navOverlay.style.display = 'flex';
      setActiveTab(tabNav);
      updateNavView();
      
      // Create a marker at the selected entry point if none exists
      if (!userMarker) {
        userMarker = L.marker(lastPos).addTo(map).bindPopup('You are here').openPopup();
      } else {
        userMarker.setLatLng(lastPos);
      }
      
      // Center map on selected entry point
      map.setView(lastPos, 15);
    });
  });
}

// Handle click on a navigation row
function handleNavRowClick(evt) {
  const row = evt.target.closest('.poi-row[data-id]');
  if (!row) return;
  const id = +row.dataset.id;
  const dest = poiData.find(d => d.id === id);
  if (dest) {
    showDetail(dest);
  }
}

// ─── 6) ERROR HANDLING ─────────────────────────────────────────────────
function initErrorHandling() {
  const ErrorTypes = {
    GEOLOCATION: 'GEOLOCATION',
    ROUTE: 'ROUTE',
    POI: 'POI'
  };

  const errorOverlay = document.createElement('div');
  errorOverlay.id = 'error-overlay';
  errorOverlay.style.cssText = `
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.85);
    z-index: 9999;
    color: white;
    padding: 2rem;
    text-align: center;
    justify-content: center;
    align-items: center;
    flex-direction: column;
  `;
  document.body.appendChild(errorOverlay);

  // Create and expose the error handler
  window.appErrorHandler = {
    handleError(type, code, details = {}) {
      console.error(`Error: ${type} - ${code}`, details);
      
      // Handle different error types
      if (type === ErrorTypes.GEOLOCATION) {
        if (code === 'permission-denied') {
          this.showErrorOverlay(
            'Location Access Needed',
            'We need your location to guide you on the trail. Please enable location services and refresh the page.',
            [
              { label: 'Use Manual Entry', callback: () => promptManualEntryPoint() },
              { label: 'Refresh Page', callback: () => location.reload() }
            ]
          );
        } else if (code === 'not-supported') {
          this.showErrorOverlay(
            'Location Not Supported',
            'Your device doesn\'t support geolocation. You can still use manual entry to explore the trail.',
            [{ label: 'Use Manual Entry', callback: () => promptManualEntryPoint() }]
          );
        }
      } else if (type === ErrorTypes.ROUTE || type === ErrorTypes.POI) {
        this.showErrorOverlay(
          'Connection Error',
          'We couldn\'t load trail data. Please check your connection and try again.',
          [{ label: 'Retry', callback: () => window.retryFetch() }]
        );
      }
    },
    
    showErrorOverlay(title, message, actions = []) {
      errorOverlay.innerHTML = `
        <div style="max-width: 500px;">
          <h2 style="margin-bottom: 1rem;">${title}</h2>
          <p style="margin-bottom: 2rem;">${message}</p>
          <div id="error-actions"></div>
        </div>
      `;
      
      const actionsContainer = document.getElementById('error-actions');
      actions.forEach(action => {
        const btn = document.createElement('button');
        btn.textContent = action.label;
        btn.style.cssText = `
          background: #0077CC;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          margin: 0.5rem;
          border-radius: 4px;
          cursor: pointer;
        `;
        btn.addEventListener('click', () => {
          errorOverlay.style.display = 'none';
          if (action.callback) action.callback();
        });
        actionsContainer.appendChild(btn);
      });
      
      errorOverlay.style.display = 'flex';
    },
    
    hideError() {
      errorOverlay.style.display = 'none';
    }
  };
}

// ─── 7) INITIALIZATION ───────────────────────────────────────────────
function initializeAppUI() {
  // Get references to DOM elements
  tabMap = document.getElementById('tab-map');
  tabNav = document.getElementById('tab-nav');
  tabList = document.getElementById('tab-list');
  navOverlay = document.getElementById('nav-overlay');
  listOverlay = document.getElementById('list-overlay');
  detailOverlay = document.getElementById('detail-overlay');
  entryOverlay = document.getElementById('entry-overlay');
  entryClose = document.getElementById('entry-close');
  
  aheadList = document.getElementById('ahead-list');
  behindList = document.getElementById('behind-list');
  entryList = document.getElementById('entry-list');
  
  changeEntryBtn = document.getElementById('change-entry');
  closeDetailBtn = document.getElementById('close-detail');
  
  detailTitle = document.getElementById('detail-title');
  detailImg = document.getElementById('detail-img');
  detailDesc = document.getElementById('detail-desc');
  detailDistance = document.getElementById('detail-distance');
  
  const navFilterContainer = document.querySelector('.filter-buttons');
  const listFilterContainer = document.querySelector('.list-filters');
  
  // Set up filter buttons
  makeFilterButtons(navFilterContainer);
  makeFilterButtons(listFilterContainer);
  
  // Initialize mode buttons
  const modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentMode);
    btn.addEventListener('click', () => {
      const m = btn.dataset.mode;
      if (currentMode === m) return;
      currentMode = m;
      modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === currentMode));
      updateNavView();
    });
  });
  
  // Set up event listeners for navigation rows
  aheadList.addEventListener('click', handleNavRowClick);
  behindList.addEventListener('click', handleNavRowClick);
  
  // Set up entry point modal
  changeEntryBtn.addEventListener('click', () => {
    renderEntryList();
    entryOverlay.style.display = 'block';
  });
  
  entryClose.addEventListener('click', () => {
    entryOverlay.style.display = 'none';
  });
  
  // Set up detail view close button
  closeDetailBtn.addEventListener('click', () => {
    detailOverlay.style.display = 'none';
    
    // Restore previous overlay state
    if (lastActiveTab === tabMap) {
      navOverlay.style.display = 'none';
      listOverlay.style.display = 'none';
    } else if (lastActiveTab === tabNav) {
      navOverlay.style.display = 'flex';
      listOverlay.style.display = 'none';
      updateNavView();
    } else if (lastActiveTab === tabList) {
      navOverlay.style.display = 'none';
      listOverlay.style.display = 'block';
    }
    
    setActiveTab(lastActiveTab);
  });
  
  // Set up tab navigation
  tabMap.addEventListener('click', () => {
    navOverlay.style.display = 'none';
    listOverlay.style.display = 'none';
    entryOverlay.style.display = 'none';
    setActiveTab(tabMap);
  });
  
  tabNav.addEventListener('click', () => {
    navOverlay.style.display = 'flex';
    listOverlay.style.display = 'none';
    entryOverlay.style.display = 'none';
    setActiveTab(tabNav);
    updateNavView();
  });
  
  tabList.addEventListener('click', () => {
    listOverlay.style.display = 'flex';
    navOverlay.style.display = 'none';
    entryOverlay.style.display = 'none';
    setActiveTab(tabList);
    renderListView();
	
	});
  
	// Tab click handlers
	tabList.addEventListener('click', function() {
	  listOverlay.style.display = 'flex';
	  navOverlay.style.display = 'none';
	  entryOverlay.style.display = 'none';
	  setActiveTab(tabList);
	  renderListView();
	});

	// Set initial active tab
	setActiveTab(tabMap);
	}

	// Retry fetch function for error handling
	window.retryFetch = function() {
	  tryLoadRouteData();
	  tryLoadPoiData();
	};

	// Main initialization function
	function initApp() {
	  // Initialize error handling
	  initErrorHandling();
  
	  // Initialize UI components
	  initializeAppUI();
  
	  // Start geolocation tracking
	  setupGeolocationWithErrorHandling();
  
	  // Load route and POI data
	  tryLoadRouteData();
	  tryLoadPoiData();
	}

	// Start the app when DOM is loaded
	document.addEventListener('DOMContentLoaded', initApp);