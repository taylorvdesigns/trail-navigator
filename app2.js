// ─── 0) GLOBAL STATE & MAP SETUP ─────────────────────────────────────
let map = null;
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
let userTrailDirection = null; // 1 = towards end, -1 = towards start
let prevTrailPosition = null;  // Previous position fraction along trail
let directionOverrideActive = false;
let trailEndpoints = { start: "Travelers Rest", end: "Conestee Park" };
let maxNavItems = 5; // Maximum items to show in ahead/behind lists
let expandedGroups = []; // Track which groups are expanded
let currentPage = 0; // For paging through filtered results
let navOverlay, listOverlay, detailOverlay, entryOverlay;
let tabMap, tabNav, tabList;
let aheadList, behindList, entryList;
let detailTitle, detailImg, detailDesc, detailDistance;
let changeEntryBtn, closeDetailBtn, entryClose;
let initializationInProgress = true;


// Add at the top of your file with other global variables
const appState = {
  mapInitialized: false,
  routeLoaded: false,
  poiLoaded: false,
  hasPosition: false
};

// Add a function to check if we're ready to update the nav
function isReadyForNavUpdate() {
  const missing = [];
  if (!lastPos) missing.push('lastPos');
  if (!poiData?.length) missing.push('poiData');
  if (!routeLine) missing.push('routeLine');
  
  if (missing.length > 0) {
    if (initializationInProgress) {
      console.debug('Initializing, waiting for:', missing.join(', '));
    } else {
      console.debug('Not ready for nav update. Missing:', missing.join(', '));
    }
    return false;
  }
  return true;
}


// Constants
const MAX_TRAIL_DISTANCE = 0.1; // sets how far off the trail to dectect whether the user is on or off the trail
const DEFAULT_COORDS = [40.785091, -73.968285];
const ROUTE_ID   = 50608713;
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
function initializeMap() {
  try {
    map = L.map('map', {
      center: DEFAULT_COORDS,
      zoom: 15,
      zoomControl: true
    });
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    return true;
  } catch (error) {
    console.error('Failed to initialize map:', error);
    if (window.appErrorHandler) {
      window.appErrorHandler.handleError('MAP', 'initialization-failed', {
        message: error.message
      });
    }
    return false;
  }
}

// ─── 1) HELPER FUNCTIONS ─────────────────────────────────────────────
// helper
function isMapReady() {
  if (!map) {
    console.warn('Map not initialized');
    return false;
  }
  return true;
}

function toMinutesStr(hours) {
  return Math.round(hours * 60) + ' min';
}

// Bearing calculations
function getBearing(start, end) {
  // Validate inputs
  if (!Array.isArray(start) || !Array.isArray(end) || 
      start.length !== 2 || end.length !== 2 ||
      !start.every(n => typeof n === 'number') ||
      !end.every(n => typeof n === 'number')) {
    console.warn('Invalid coordinates provided to getBearing');
    return 0;
  }
  
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


// Helper to render category icons
function getCategoryIcons(categories = []) {
  return categories
    .map(cat => categoryIcons[cat.slug])  // look up each slug
    .filter(Boolean)                      // drop any undefined
    .map(cls => `<i class="${cls}" aria-hidden="true"></i>`)
    .join(' ');
}

// Function to cluster POIs based on proximity and tags
function clusterPOIs(pois) {
  // Group POIs by their tags
  const groups = {};
  pois.forEach(poi => {
    const tag = poi.tags?.[0]?.name || 'Untagged';
    if (!groups[tag]) {
      groups[tag] = [];
    }
    groups[tag].push(poi);
  });

  // For each group, find the nearest POI to user
  const results = [];
  Object.entries(groups).forEach(([tag, groupPOIs]) => {
    // Sort POIs in group by distance from user
    groupPOIs.sort((a, b) => a._currentDistance - b._currentDistance);

    // Get the nearest POI in this group
    const nearestPOI = groupPOIs[0];
    
    // Create group result using nearest POI's distances
    results.push({
      name: tag,
      pois: groupPOIs,
      distance: nearestPOI._currentDistance,
      alongTrailDistance: nearestPOI._alongTrailDistance,
      lateralDistance: nearestPOI._lateralDistance,
      position: nearestPOI._actualPosition
    });
  });

  // Sort groups by distance
  results.sort((a, b) => a.distance - b.distance);

  return results;
}

// Helper function to render nav items (clusters or individual POIs)
function renderNavItems(container, items, isAhead) {
  // Clear existing content
  container.innerHTML = '';

  function clearExistingListeners() {
    const rows = container.querySelectorAll('.poi-row[data-id]');
    rows.forEach(row => {
      const clone = row.cloneNode(true);
      row.parentNode.replaceChild(clone, row);
    });

    // Clear cluster rows too
    const clusterRows = container.querySelectorAll('.cluster-row');
    clusterRows.forEach(row => {
      const clone = row.cloneNode(true);
      row.parentNode.replaceChild(clone, row);
    });
  }

  // Group items by category
  const groups = {};
  items.forEach(item => {
    const category = item.categories?.[0]?.name || 'Other';
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(item);
  });

  // Render each group
  Object.entries(groups).forEach(([category, groupItems]) => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'poi-group';
    
    // Create group header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'poi-group-header';
    headerDiv.innerHTML = `
      <div class="group-title">
        <i class="fas fa-layer-group"></i>
        ${category} (${groupItems.length})
      </div>
      <div class="group-distance">
        ${(Math.min(...groupItems.map(i => i._currentDistance || Infinity))).toFixed(1)} mi
      </div>
    `;

    // Create collapsible content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'poi-group-content';
    if (!expandedGroups.includes(category)) {
      contentDiv.classList.add('hidden');
    }
    
    // Add items to the group
    groupItems.forEach(item => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'poi-row';
      itemDiv.dataset.id = item.id;
      
      // Format distance display
      let distanceDisplay = item._currentDistance?.toFixed(1) + ' mi';
      if (item._lateralDistance > 0.1) {
        distanceDisplay += ` (${item._lateralDistance.toFixed(1)} mi off trail)`;
      }
      
      itemDiv.innerHTML = `
        <div class="poi-name">
          ${item.name} ${getCategoryIcons(item.categories || [])}
        </div>
        <div class="poi-times">
          <span class="poi-distance">${distanceDisplay}</span>
          <span class="poi-time">${toMinutesStr(item._currentDistance / MODE_SPEEDS[currentMode])}</span>
        </div>
      `;

      itemDiv.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent group toggle
        const dest = poiData.find(d => d.id === item.id);
        if (dest) showDetail(dest);
      });

      contentDiv.appendChild(itemDiv);
    });

    // Add click handler for group header
    headerDiv.addEventListener('click', () => {
      contentDiv.classList.toggle('hidden');
      if (contentDiv.classList.contains('hidden')) {
        expandedGroups = expandedGroups.filter(g => g !== category);
      } else if (!expandedGroups.includes(category)) {
        expandedGroups.push(category);
      }
      headerDiv.classList.toggle('expanded');
    });

    groupDiv.appendChild(headerDiv);
    groupDiv.appendChild(contentDiv);
    container.appendChild(groupDiv);
  });
}

// Add this CSS to ensure proper styling
const style = document.createElement('style');
style.textContent = `
  .poi-group {
    margin-bottom: 8px;
  }
  .poi-group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px;
    background-color: #f5f5f5;
    cursor: pointer;
    border-radius: 4px;
  }
  .poi-group-header.expanded {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .poi-group-content {
    background-color: white;
    border: 1px solid #f0f0f0;
    border-top: none;
  }
  .poi-group-content.hidden {
    display: none;
  }
  .poi-group-header:hover {
    background-color: #eeeeee;
  }
  .group-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .group-title i {
    color: #666;
  }
  .poi-row {
    padding: 8px;
    border-bottom: 1px solid #f0f0f0;
    cursor: pointer;
  }
  .poi-row:hover {
    background-color: #f8f8f8;
  }
  .poi-row:last-child {
    border-bottom: none;
  }
`;
document.head.appendChild(style);


// Function to handle cluster clicks
function showClusterDetail(tag) {
  // Switch to list view and filter by tag
  listOverlay.style.display = 'flex';
  navOverlay.style.display = 'none';
  setActiveTab(tabList);
  
  // Filter list by tag
  renderListView(tag);
}


// ─── 2) UI FUNCTIONS ─────────────────────────────────────────────────
// Create filter buttons
function makeFilterButtons(targetContainer) {  // Rename parameter to avoid conflicts
  if (!targetContainer) {
    console.warn('No container provided for filter buttons');
    return;
  }

  targetContainer.innerHTML = '';
  filterDefs.forEach(f => {
    const btn = document.createElement('button');
    btn.innerHTML = `<i class="${f.iconClass}"></i>`;
    btn.title = f.title;
    btn.dataset.slug = f.slug;
    if (f.slug === activeFilter) btn.classList.add('active');
    targetContainer.appendChild(btn);

    btn.addEventListener('click', () => {
      const slug = btn.dataset.slug;
      activeFilter = (activeFilter === slug ? null : slug);
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

function toggleTrailDirection() {
  // Always allow manual toggle
  directionOverrideActive = true;
  // If it's already 1, flip to -1; otherwise set to 1
  userTrailDirection = userTrailDirection === 1 ? -1 : 1;

  updateDirectionIndicator();
  updateNavView();
  // console.log("Direction toggled:", userTrailDirection);
}

// Add function to update direction indicator
function updateDirectionIndicator() {
  const indicator = document.getElementById('direction-indicator');
  if (!indicator) return;
  
  // Clear existing classes
  indicator.classList.remove('towards-end', 'towards-start', 'auto-detected', 'manual-override');
  
  // Set new classes based on current state
  if (userTrailDirection === 1) {
    indicator.classList.add('towards-end');
    indicator.innerHTML = '<i class="fas fa-arrow-up"></i> Towards Travelers Rest';
  } else if (userTrailDirection === -1) {
    indicator.classList.add('towards-start');
    indicator.innerHTML = '<i class="fas fa-arrow-down"></i> Towards Conestee';
  } else {
    indicator.innerHTML = '<i class="fas fa-question"></i> Unknown';
  }
  
  // Add class for auto/manual mode
  indicator.classList.add(directionOverrideActive ? 'manual-override' : 'auto-detected');
}

// Add function to reset to automatic direction detection
function resetToAutoDirection() {
  directionOverrideActive = false;
  userTrailDirection = null;
  prevTrailPosition = null;
  
  // If we have a position, try to determine direction
  if (lastPos) {
    updateUserTrailOrientation(lastPos);
  }
  
  updateDirectionButtons();
  updateNavView();
}

// Modify updateUserTrailOrientation to respect manual override
function updateUserTrailOrientation(currentPos) {
  // Only skip updates if we have a valid manual direction
  if (directionOverrideActive && userTrailDirection !== null) {
    return userTrailDirection;
  }
  
  if (!routeLine || !currentPos) {
    return null;
  }
  
  const userPt = turf.point([currentPos[1], currentPos[0]]);
  const snapped = turf.nearestPointOnLine(routeLine, userPt, { units: 'kilometers' });
  
  if (!snapped || typeof snapped.properties.location !== 'number') {
    console.warn('Failed to snap to route, keeping current direction');
    return userTrailDirection;
  }
  
  const currentFraction = snapped.properties.location;
  
  if (prevTrailPosition !== null) {
    if (Math.abs(currentFraction - prevTrailPosition) > 0.001) {
      userTrailDirection = (currentFraction > prevTrailPosition) ? 1 : -1;
      updateDirectionIndicator();
    }
  } 
  else if (userBearing !== null) {
    // Bearing-based calculation with added validation
    const coordIndex = snapped.properties.index;
    if (coordIndex !== undefined && coordIndex < routeLatLngs.length - 1) {
      const trailBefore = routeLatLngs[Math.max(0, coordIndex)];
      const trailAfter = routeLatLngs[Math.min(routeLatLngs.length - 1, coordIndex + 1)];
      
      if (trailBefore && trailAfter) {
        const trailBearing = getBearing(trailBefore, trailAfter);
        const bearingDiff = Math.abs(userBearing - trailBearing);
        const normalizedDiff = Math.min(bearingDiff, 360 - bearingDiff);
        userTrailDirection = (normalizedDiff < 90) ? 1 : -1;
        updateDirectionIndicator();
      }
    }
  }
  
  updateDirectionButtons();
  prevTrailPosition = currentFraction;
  return userTrailDirection;
}


function addDirectionControls() {
  // Create container for direction controls in the nav overlay
  const navHeader = document.querySelector('.nav-header') || document.getElementById('nav-overlay').querySelector('header');

  // Create direction controls
  const directionControls = document.createElement('div');
  directionControls.className = 'direction-controls';
  directionControls.innerHTML = `
    <div id="direction-indicator" class="auto-detected">
      <span>Trail Direction</span>
    </div>
    <div class="direction-buttons">
      <button id="direction-start" title="Head towards trail start">
        <i class="fas fa-arrow-left"></i> <span>${trailEndpoints.start}</span>
      </button>
      <button id="direction-end" title="Head towards trail end">
        <span>${trailEndpoints.end}</span> <i class="fas fa-arrow-right"></i>
      </button>
      <button id="reset-direction" title="Reset to auto-detect">
        <i class="fas fa-sync"></i>
      </button>
    </div>
  `;

  // Add to nav header
  navHeader.appendChild(directionControls);

  // Add event listeners (old)
  // document.getElementById('toggle-direction').addEventListener('click', toggleTrailDirection);
  // document.getElementById('reset-direction').addEventListener('click', resetToAutoDirection);

// Add event listeners
  document.getElementById('direction-start').addEventListener('click', () => {
    userTrailDirection = -1; // Towards start
    directionOverrideActive = true;
    updateDirectionButtons();
    updateNavView();
  });
  
  document.getElementById('direction-end').addEventListener('click', () => {
    userTrailDirection = 1;  // Towards end
    directionOverrideActive = true;
    updateDirectionButtons();
    updateNavView();
  });
  
  document.getElementById('reset-direction').addEventListener('click', resetToAutoDirection);
  
  // Add some CSS for the controls
  const style = document.createElement('style');
  style.textContent = `
    .direction-controls {
      display: flex;
      flex-direction: column;
      margin-top: 8px;
      padding: 8px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
    }
    
    #direction-indicator {
      font-size: 0.9rem;
      padding: 4px 0;
      margin-bottom: 6px;
      text-align: center;
      color: #ccc;
    }
    
    #direction-indicator.manual-override {
      color: #ff9800;
    }
    
    .direction-buttons {
      display: flex;
      justify-content: space-between;
    }
    
    .direction-buttons button {
      background: transparent;
      border: 1px solid #ccc;
      border-radius: 3px;
      padding: 6px 12px;
      cursor: pointer;
      flex-grow: 1;
      margin: 0 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 45%;
    }
    
    .direction-buttons button.active {
      background: #0077CC;
      color: white;
      border-color: #0077CC;
    }
    
    #reset-direction {
      flex-grow: 0 !important;
      max-width: 40px !important;
    }
  `;
  document.head.appendChild(style);
  
  // Initial update
  updateDirectionButtons();
}

// Add a new function to update the direction buttons
function updateDirectionButtons() {
  const startBtn = document.getElementById('direction-start');
  const endBtn = document.getElementById('direction-end');
  const indicator = document.getElementById('direction-indicator');
  
  if (!startBtn || !endBtn) return;
  
  // Update button text with current endpoint names
  startBtn.querySelector('span').textContent = trailEndpoints.start;
  endBtn.querySelector('span').textContent = trailEndpoints.end;
  
  // Remove active class from both
  startBtn.classList.remove('active');
  endBtn.classList.remove('active');
  
  // Update indicator and active state
  if (userTrailDirection === 1) {
    endBtn.classList.add('active');
    indicator.innerHTML = `Heading towards <strong>${trailEndpoints.end}</strong>`;
  } else if (userTrailDirection === -1) {
    startBtn.classList.add('active');
    indicator.innerHTML = `Heading towards <strong>${trailEndpoints.start}</strong>`;
  } else {
    indicator.innerHTML = 'Auto-detecting direction...';
  }
  
  // Show if auto or manual
  indicator.classList.toggle('manual-override', directionOverrideActive);
}

// ─── 3) DATA LOADING FUNCTIONS ───────────────────────────────────────
// Load route data from RWGPS
function tryLoadRouteData() {
  return fetch(ROUTE_URL, {
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
    if (!window.map) {
      throw new Error('Map not initialized');
    }

    // Draw polyline
    const pts = data.route.track_points;
    routeLatLngs = pts.map(p => [p.y, p.x]);
    
    if (routeLine && window.map) {
      window.map.removeLayer(routeLine);
    }
    
    routeLine = L.polyline(routeLatLngs, { weight: 4, color: '#0077CC' }).addTo(window.map);
    window.map.fitBounds(routeLatLngs);

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
  } catch (err) {
    console.error('Error processing route data:', err);
    if (window.appErrorHandler) {
      window.appErrorHandler.handleError(ErrorTypes.ROUTE, 'processing-failed', {
        message: err.message
      });
    }
  }
}

// Load POI data from WordPress
function tryLoadPoiData() {
  return fetch('https://srtmaps.elev8maps.com/wp-json/geodir/v2/places?per_page=100')
    .then(r => {
      if (!r.ok) throw new Error(`GeoDir error ${r.status}`);
      return r.json();
    })
    .then(places => {
      try {
        // Map each WP place into our poiData
        poiData = places.map(p => ({
          id: p.id,
          name: p.title.rendered,
          coords: [+p.latitude, +p.longitude],
          description: p.content.raw,
          image: p.featured_image?.[0]?.source_url || '',
          tags: (p.post_tags || []).map(t => ({ slug: t.slug, name: t.name })),
          categories: (p.post_category || [])
            .map(c => ({
              id: c.id,
              name: c.name,
              slug: c.slug.replace(/^\d+-/, '')
            }))
            .filter(cat => cat.slug !== 'business')
        }));

        // Add markers to the map if it's initialized
        if (map) {
          places.forEach(p => {
            const lat = parseFloat(p.latitude),
                  lng = parseFloat(p.longitude);
            if (isNaN(lat) || isNaN(lng)) return;
            L.marker([lat, lng])
              .addTo(map)
              .bindPopup(`<strong>${p.title.rendered}</strong>`);
          });
        }

        appState.poiLoaded = true;
        
        // Only update nav view if we have all required data
        if (isReadyForNavUpdate()) {
          updateNavView();
        }

      } catch (error) {
        console.error('Error processing POI data:', error);
        if (window.appErrorHandler) {
          window.appErrorHandler.handleError('POI', 'processing-failed', {
            message: error.message
          });
        }
      }
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

// Add this function to app2.js right after tryLoadPoiData
function processPoiData(places) {
  try {
    // Map each WP place into our poiData
    poiData = places.map(p => ({
      id: p.id,
      name: p.title.rendered,
      coords: [+p.latitude, +p.longitude],
      description: p.content.raw,
      image: p.featured_image?.[0]?.source_url || '',
      tags: (p.post_tags || []).map(t => ({ slug: t.slug, name: t.name })),
      categories: (p.post_category || [])
        .map(c => ({
          id: c.id,
          name: c.name,
          slug: c.slug.replace(/^\d+-/, '')
        }))
        .filter(cat => cat.slug !== 'business')
    }));

    // Add markers to map only if it's initialized
    if (window.map && window.map instanceof L.Map) {
      places.forEach(p => {
        try {
          const lat = parseFloat(p.latitude);
          const lng = parseFloat(p.longitude);
          
          if (isNaN(lat) || isNaN(lng)) {
            console.warn(`Invalid coordinates for POI: ${p.title.rendered}`);
            return;
          }
          
          L.marker([lat, lng])
            .addTo(window.map)
            .bindPopup(`<strong>${p.title.rendered}</strong>`);
        } catch (e) {
          console.warn(`Failed to add marker for ${p.title.rendered}:`, e);
        }
      });
    }

    appState.poiLoaded = true;
    
    // Only update views if we have all required data
    if (isReadyForNavUpdate()) {
      updateNavView();
    }

  } catch (err) {
    console.error('Error processing POI data:', err);
    if (window.appErrorHandler) {
      window.appErrorHandler.handleError('DATA', 'processing-failed', {
        message: err.message
      });
    }
  }
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

  // Remove any existing prompt first
  const existingPrompt = document.getElementById('location-prompt');
  if (existingPrompt) {
    existingPrompt.remove();
  }

  // Create location prompt overlay
  const locationPrompt = document.createElement('div');
  locationPrompt.id = 'location-prompt';
  locationPrompt.innerHTML = `
    <div class="location-prompt-content">
      <h3>Location Access</h3>
      <p>To help you navigate the trail, we need your location. You can:</p>
      <div class="location-buttons">
        <button id="enable-location" class="primary-button">
          <i class="fas fa-location-arrow"></i> Enable Location
        </button>
        <button id="use-manual-entry" class="secondary-button">
          <i class="fas fa-map-marker-alt"></i> Choose Entry Point
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(locationPrompt);

  // Wait for DOM to ensure buttons exist
  setTimeout(() => {
    const enableLocationBtn = document.getElementById('enable-location');
    const useManualEntryBtn = document.getElementById('use-manual-entry');

    if (enableLocationBtn) {
      enableLocationBtn.onclick = () => {
        console.log('Enable location clicked');
        locationPrompt.remove();
        requestLocation();
      };
    }

    if (useManualEntryBtn) {
      useManualEntryBtn.onclick = () => {
        console.log('Manual entry clicked');
        locationPrompt.remove();
        promptManualEntryPoint();
      };
    }
  }, 0);
}

function requestLocation() {
  console.log('Requesting location...');
  
  // Show loading state
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'location-loading';
  loadingDiv.innerHTML = `
    <div class="loading-spinner"></div>
    <p>Getting your location...</p>
  `;
  document.body.appendChild(loadingDiv);

  // Try to get location with a timeout
  const timeoutId = setTimeout(() => {
    console.log('Location request timed out');
    document.getElementById('location-loading')?.remove();
    promptManualEntryPoint();
  }, 10000); // 10 second timeout

  try {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('Got position:', position);
        clearTimeout(timeoutId);
        document.getElementById('location-loading')?.remove();
        handlePositionUpdate(position);
        
        // Start watching position after getting initial position
        navigator.geolocation.watchPosition(
          handlePositionUpdate,
          handlePositionError,
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
      },
      (error) => {
        console.log('Position error:', error);
        clearTimeout(timeoutId);
        document.getElementById('location-loading')?.remove();
        handlePositionError(error);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  } catch (e) {
    console.error('Error requesting location:', e);
    clearTimeout(timeoutId);
    document.getElementById('location-loading')?.remove();
    promptManualEntryPoint();
  }
}

function handlePositionUpdate(pos) {
  if (!map) {
    console.warn('Map not initialized yet');
    return;
  }

  const coords = [pos.coords.latitude, pos.coords.longitude];

  try {
    // Create or update user marker
    if (!userMarker) {
      userMarker = L.marker(coords).addTo(map);
    } else {
      userMarker.setLatLng(coords);
    }

    // Update last position and bearing
    if (lastPos) {
      userBearing = getBearing(lastPos, coords);
    }
    lastPos = coords;

    // Check if user is on trail
    if (routeLine) {
      const userPt = turf.point([coords[1], coords[0]]);
      const snapped = turf.nearestPointOnLine(routeLine, userPt, { units: 'miles' });
      
      // Calculate distance from trail
      const distanceFromTrail = turf.distance(
        userPt,
        turf.point(snapped.geometry.coordinates),
        { units: 'miles' }
      );

      console.debug('Distance from trail:', distanceFromTrail.toFixed(3), 'miles');

      // If not on trail and haven't shown entry dialog yet
      if (distanceFromTrail > MAX_TRAIL_DISTANCE && !hasManualEntry) {
        promptManualEntryPoint();
      }

      updateNavView();
    }

  } catch (error) {
    console.error('Error updating user position:', error);
    if (window.appErrorHandler) {
      window.appErrorHandler.handleError('POSITION', 'update-failed', {
        message: error.message
      });
    }
  }
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
  console.log('Showing manual entry prompt');
  
  // Ensure entry overlay exists
  const entryOverlay = document.getElementById('entry-overlay');
  if (!entryOverlay) {
    console.error('Entry overlay not found');
    return;
  }

  // Add message to entry overlay explaining why we're showing it
  const messageDiv = document.createElement('div');
  messageDiv.className = 'entry-message';
  messageDiv.innerHTML = `
    <p>Please select an entry point on the trail:</p>
  `;

  // Clear any existing messages
  const existingMessage = entryOverlay.querySelector('.entry-message');
  if (existingMessage) {
    existingMessage.remove();
  }

  // Add message before the entry list
  const entryList = document.getElementById('entry-list');
  if (entryList && entryList.parentNode) {
    entryList.parentNode.insertBefore(messageDiv, entryList);
  }

  // Render entry points and show overlay
  renderEntryList();
  entryOverlay.style.display = 'block';
  hasManualEntry = true; // Prevent future popups
}

// ─── 5) VIEW UPDATE FUNCTIONS ──────────────────────────────────────────
// Update the relevant part of the updateNavView function (around line 745):
// Update the updateNavView function to use DOM manipulation
function updateNavView() {
  if (!isReadyForNavUpdate()) {
    console.debug('Missing data: lastPos, poiData, or routeLine');
    return;
  }

  const aheadList = document.getElementById('ahead-list');
  const behindList = document.getElementById('behind-list');
  
  if (!aheadList || !behindList) {
    console.error('Navigation lists not found');
    return;
  }

  // Apply category filters
  let data = poiData;
  if (activeFilter) {
    data = data.filter(dest =>
      dest.categories?.some(c => c.slug === activeFilter)
    );
  }

  // Calculate distances and sort data
  const { ahead, behind } = processAndSortPOIs(data);

  // Get clustered results
  const aheadResult = clusterPOIs(ahead);
  const behindResult = clusterPOIs(behind);

  // Clear existing content
  aheadList.innerHTML = '';
  behindList.innerHTML = '';

  // Render ahead items
  if (aheadResult.length > 0) {
    aheadResult.forEach(cluster => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'poi-group';
      
      const headerDiv = document.createElement('div');
      headerDiv.className = 'poi-group-header';
      headerDiv.innerHTML = `
        <div class="group-title">
          <i class="fas fa-layer-group"></i>
          ${cluster.name} (${cluster.pois.length})
        </div>
        <div class="group-distance">
          ${cluster.distance.toFixed(1)} mi
        </div>
      `;

      // Create collapsible content
      const contentDiv = document.createElement('div');
      contentDiv.className = 'poi-group-content';
      if (!expandedGroups.includes(cluster.name)) {
        contentDiv.classList.add('hidden');
      }

      // Add items to the group
      cluster.pois.forEach(poi => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'poi-row';
        itemDiv.dataset.id = poi.id;

        let distanceDisplay = poi._currentDistance?.toFixed(1) + ' mi';
        if (poi._lateralDistance > 0.1) {
          distanceDisplay += ` (${poi._lateralDistance.toFixed(1)} mi off trail)`;
        }

        itemDiv.innerHTML = `
          <div class="poi-name">
            ${poi.name} ${getCategoryIcons(poi.categories || [])}
          </div>
          <div class="poi-times">
            <span class="poi-distance">${distanceDisplay}</span>
            <span class="poi-time">${toMinutesStr(poi._currentDistance / MODE_SPEEDS[currentMode])}</span>
          </div>
        `;

        itemDiv.addEventListener('click', (e) => {
          e.stopPropagation();
          showDetail(poi);
        });

        contentDiv.appendChild(itemDiv);
      });

      // Add click handler for group header
      headerDiv.addEventListener('click', () => {
        contentDiv.classList.toggle('hidden');
        if (contentDiv.classList.contains('hidden')) {
          expandedGroups = expandedGroups.filter(g => g !== cluster.name);
        } else if (!expandedGroups.includes(cluster.name)) {
          expandedGroups.push(cluster.name);
        }
        headerDiv.classList.toggle('expanded');
      });

      groupDiv.appendChild(headerDiv);
      groupDiv.appendChild(contentDiv);
      aheadList.appendChild(groupDiv);
    });
  } else {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'poi-row';
    emptyDiv.textContent = 'No destinations ahead';
    aheadList.appendChild(emptyDiv);
  }

  // Render behind items (same pattern as ahead)
  if (behindResult.length > 0) {
    behindResult.forEach(cluster => {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'poi-group';
      
      const headerDiv = document.createElement('div');
      headerDiv.className = 'poi-group-header';
      headerDiv.innerHTML = `
        <div class="group-title">
          <i class="fas fa-layer-group"></i>
          ${cluster.name} (${cluster.pois.length})
        </div>
        <div class="group-distance">
          ${cluster.distance.toFixed(1)} mi
        </div>
      `;

      // Create collapsible content
      const contentDiv = document.createElement('div');
      contentDiv.className = 'poi-group-content';
      if (!expandedGroups.includes(cluster.name)) {
        contentDiv.classList.add('hidden');
      }

      // Add items to the group
      cluster.pois.forEach(poi => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'poi-row';
        itemDiv.dataset.id = poi.id;

        let distanceDisplay = poi._currentDistance?.toFixed(1) + ' mi';
        if (poi._lateralDistance > 0.1) {
          distanceDisplay += ` (${poi._lateralDistance.toFixed(1)} mi off trail)`;
        }

        itemDiv.innerHTML = `
          <div class="poi-name">
            ${poi.name} ${getCategoryIcons(poi.categories || [])}
          </div>
          <div class="poi-times">
            <span class="poi-distance">${distanceDisplay}</span>
            <span class="poi-time">${toMinutesStr(poi._currentDistance / MODE_SPEEDS[currentMode])}</span>
          </div>
        `;

        itemDiv.addEventListener('click', (e) => {
          e.stopPropagation();
          showDetail(poi);
        });

        contentDiv.appendChild(itemDiv);
      });

      // Add click handler for group header
      headerDiv.addEventListener('click', () => {
        contentDiv.classList.toggle('hidden');
        if (contentDiv.classList.contains('hidden')) {
          expandedGroups = expandedGroups.filter(g => g !== cluster.name);
        } else if (!expandedGroups.includes(cluster.name)) {
          expandedGroups.push(cluster.name);
        }
        headerDiv.classList.toggle('expanded');
      });

      groupDiv.appendChild(headerDiv);
      groupDiv.appendChild(contentDiv);
      behindList.appendChild(groupDiv);
    });
  } else {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'poi-row';
    emptyDiv.textContent = 'No destinations behind';
    behindList.appendChild(emptyDiv);
  }
}

// Helper function to process and sort POIs
function processAndSortPOIs(data) {
  // Calculate trail position
  const userPt = turf.point([lastPos[1], lastPos[0]]);
  const snappedU = turf.nearestPointOnLine(routeLine, userPt, { units: 'miles' });
  const userDistance = snappedU.properties.location;

  // Process POIs with distance calculations
  data.forEach(dest => {
    try {
      const poiPt = turf.point([dest.coords[1], dest.coords[0]]);
      const snapped = turf.nearestPointOnLine(routeLine, poiPt, { units: 'miles' });

      const poiDistance = snapped.properties.location;
      const alongTrailDist = Math.abs(poiDistance - userDistance);
      const lateralDist = turf.distance(
        poiPt,
        turf.point(snapped.geometry.coordinates),
        { units: 'miles' }
      );

      dest._currentDistance = Math.sqrt(Math.pow(alongTrailDist, 2) + Math.pow(lateralDist, 2));
      dest._lateralDistance = lateralDist;
      dest._alongTrailDistance = alongTrailDist;
      dest._actualPosition = poiDistance;

    } catch (error) {
      console.error(`Error calculating distance for ${dest.name}:`, error);
      dest._currentDistance = Infinity;
    }
  });

  // Sort into ahead/behind
  const ahead = [];
  const behind = [];

  data.forEach(dest => {
    if (dest._currentDistance === Infinity) return;

    const poiDistance = dest._actualPosition;

    if (directionOverrideActive && userTrailDirection !== null) {
      if (userTrailDirection === 1) {
        if (poiDistance > userDistance) {
          ahead.push(dest);
        } else {
          behind.push(dest);
        }
      } else {
        if (poiDistance < userDistance) {
          ahead.push(dest);
        } else {
          behind.push(dest);
        }
      }
    } else {
      if (dest._currentDistance <= 2) { // Adjust threshold as needed
        ahead.push(dest);
      } else {
        behind.push(dest);
      }
    }
  });

  ahead.sort((a, b) => a._currentDistance - b._currentDistance);
  behind.sort((a, b) => a._currentDistance - b._currentDistance);

  return { ahead, behind };
}


// Modify renderListView to accept a tag filter
function renderListView(tagFilter = null) {
  // Get container and clear it
  const container = document.getElementById('list-content');
  container.innerHTML = '';

  // Apply filters (category and now tag)
  let data = poiData;
  if (activeFilter) {
    data = data.filter(dest =>
      dest.categories?.some(c => c.slug === activeFilter)
    );
  }
  
  // Apply tag filter if provided
  if (tagFilter) {
    data = data.filter(dest =>
      dest.tags?.some(t => t.slug === tagFilter)
    );
    
    // Add a "back to all" button
    const backBtn = document.createElement('button');
    backBtn.innerHTML = `<i class="fas fa-arrow-left"></i> Back to all`;
    backBtn.className = 'back-button';
    backBtn.addEventListener('click', () => {
      renderListView(); // Reset to no tag filter
    });
    container.appendChild(backBtn);
    
    // Add tag title
    const tagName = poiData.find(p => p.tags?.some(t => t.slug === tagFilter))?.tags.find(t => t.slug === tagFilter)?.name || tagFilter;
    const tagTitle = document.createElement('h2');
    tagTitle.textContent = tagName;
    tagTitle.className = 'tag-title';
    container.appendChild(tagTitle);
  }

  // Group by the first tag's slug (skip if we're already filtered by tag)
  if (!tagFilter) {
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
  } else {
    // Simple list when tag filtered
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    
    // Sort by trail distance if available
    if (lastPos) {
      data.sort((a, b) => 
        (a._currentDistance || Infinity) - (b._currentDistance || Infinity)
      );
    }
    
    data.forEach(dest => {
      const li = document.createElement('li');
      li.classList.add('poi-row');
      li.dataset.id = dest.id;
      
      // Include distance if available
      let distanceHtml = '';
      if (typeof dest._currentDistance === 'number') {
        distanceHtml = `<span class="poi-distance">${dest._currentDistance.toFixed(1)} mi</span>`;
      }
      
      li.innerHTML = `
        <span class="poi-name">
          ${dest.name} ${getCategoryIcons(dest.categories)}
        </span>
        ${distanceHtml}
      `;
      
      li.addEventListener('click', () => {
        showDetail(dest);
      });
      ul.appendChild(li);
    });
    
    container.appendChild(ul);
  }
// Add some CSS for the new elements if not already present
  if (!document.getElementById('cluster-styles')) {
    const style = document.createElement('style');
    style.id = 'cluster-styles';
    style.textContent = `
      .back-button {
        margin-bottom: 10px;
        padding: 5px 15px;
        background: #f0f0f0;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      .back-button:hover {
        background: #e0e0e0;
      }
      .tag-title {
        margin-bottom: 15px;
        padding-bottom: 5px;
        border-bottom: 1px solid #eee;
      }
      .cluster-row {
        background-color: #f8f8f8;
      }
      .cluster-row .fa-layer-group {
        color: #0077CC;
        margin-right: 5px;
      }
      .pagination {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 5px;
        border-top: 1px solid #eee;
        margin-top: 10px;
      }
      .pagination button {
        background: #f0f0f0;
        border: none;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
      }
      .pagination button:hover {
        background: #e0e0e0;
      }
      .page-info {
        font-size: 0.9rem;
        color: #666;
      }
    `;
    document.head.appendChild(style);
  }
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
  if (!entryList || !routeLatLngs.length || !window.map) return;
  
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
      hasManualEntry = true;
      entryOverlay.style.display = 'none';
      navOverlay.style.display = 'flex';
      setActiveTab(tabNav);
      
      // Create or update user marker
      try {
        if (!window.map) {
          console.warn('Map not initialized');
          return;
        }
        
        if (!userMarker) {
          userMarker = L.marker(lastPos)
            .addTo(window.map)
            .bindPopup('You are here');
        } else {
          userMarker.setLatLng(lastPos);
        }
        
        // Center map on selected entry point
        window.map.setView(lastPos, 15);
        
        // Update the navigation view
        updateNavView();
      } catch (error) {
        console.error('Error updating user position:', error);
        if (window.appErrorHandler) {
          window.appErrorHandler.handleError('MAP', 'marker-update-failed', {
            message: error.message
          });
        }
      }
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
// app-claude.js is handling this
/* function initErrorHandling() {
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

*/

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
  
// Create container for entry message if it doesn't exist
  const entryContainer = document.getElementById('entry-container');
  if (!entryContainer) {
    const container = document.createElement('div');
    container.id = 'entry-container';
    entryList.parentNode.insertBefore(container, entryList);
  }
  
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

	// Set initial active tab
	setActiveTab(tabMap);
	
};

	// Retry fetch function for error handling
	window.retryFetch = function() {
	  tryLoadRouteData();
	  tryLoadPoiData();
	};

	// Main initialization function
	function initApp() {
	  initializationInProgress = true;

	  // Initialize UI components first
	  initializeAppUI();
  
	  // Initialize map
	  try {
	    window.map = L.map('map').setView(DEFAULT_COORDS, 15);
	    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
	      attribution: '&copy; OpenStreetMap contributors'
	    }).addTo(window.map);
    
	    appState.mapInitialized = true;
    
	    // Set up error handling after map is initialized
	    if (typeof setupMapErrorHandling === 'function') {
	      setupMapErrorHandling();
	    }
    
	    // Add direction controls
	    addDirectionControls();

	    // Load route and POI data
	    Promise.all([
	      tryLoadRouteData(),
	      tryLoadPoiData()
	    ]).then(() => {
	      initializationInProgress = false;
	      // Show location prompt after data is loaded
	      if (!lastPos && !hasManualEntry) {
	        setupGeolocationWithErrorHandling();
	      }
	    }).catch(error => {
	      console.error('Failed to load initial data:', error);
	      initializationInProgress = false;
	      if (window.appErrorHandler) {
	        window.appErrorHandler.handleError('DATA', 'initial-load-failed', {
	          message: error.message
	        });
	      }
	    });
    
	  } catch (error) {
	    console.error('Failed to initialize map:', error);
	    initializationInProgress = false;
	    if (window.appErrorHandler) {
	      window.appErrorHandler.handleError('MAP', 'initialization-failed', {
	        message: error.message
	      });
	    }
	  }
	}
	
/*

	// Start the app when DOM is loaded, but after error handling is initialized
	document.addEventListener('DOMContentLoaded', () => {
	  // Initialize error handling first
	  if (!window.appErrorHandler) {
	    initErrorHandling();
	  }
  
	  // Then initialize the app with a slight delay to ensure error handling is ready
	  setTimeout(initApp, 100);
	});
	
*/