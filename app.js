console.log('🟢 app.js loaded');

document.addEventListener('DOMContentLoaded', () => {
  console.log('🟢 DOMContentLoaded fired');

  // ─── 1) DOM ELEMENTS & MAP SETUP ─────────────────────────────────────
  let userMarker     = null;
  let routeLatLngs   = [];
  let routeLine;
  let lastPos        = null;
  let userBearing    = null;
  let poiData        = [];
  let lastDetailDest = null;
  
  // Your static custom spots
  const baseEntryPoints = [
    { name: "Between Swamp Rabbit Cafe and Unity", coords: [34.863381, -82.421034] },
    { name: "Between Downtown and Unity",           coords: [34.848406, -82.404906] },
    { name: "Furman Univ",                           coords: [34.926555, -82.443180] },
    { name: "Greenville Tech",                       coords: [34.826607, -82.378538] }
  ];

  // Will hold [ Trail Start, ...baseEntryPoints, Trail End ]
  let entryPoints = [];
  

  // bottom‐tab buttons
  const tabMap    = document.getElementById('tab-map');
  const tabNav    = document.getElementById('tab-nav');
  const tabList   = document.getElementById('tab-list');

  // overlays
  const navOverlay    = document.getElementById('nav-overlay');
  const listOverlay   = document.getElementById('list-overlay');
  const detailOverlay = document.getElementById('detail-overlay');
  const entryOverlay = document.getElementById('entry-overlay');
  const entryList    = document.getElementById('entry-list');
  

  // floating buttons
  const openNavBtn     = document.getElementById('open-nav');
  const closeDetailBtn = document.getElementById('close-detail');

  // detail‐view elements
  const detailTitle    = document.getElementById('detail-title');
  const detailImg      = document.getElementById('detail-img');
  const detailDesc     = document.getElementById('detail-desc');
  const detailDistance = document.getElementById('detail-distance');
  

  const DEFAULT_COORDS = [40.785091, -73.968285];
  const map = L.map('map').setView(DEFAULT_COORDS, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // ─── 2) NAV & DETAIL TOGGLE LOGIC ────────────────────────────────────
  openNavBtn.addEventListener('click', () => {
    navOverlay.style.display = 'block';
    openNavBtn.style.display = 'none';
  });
  

  // ─── 3) RwGPS ROUTE FETCH & Turf setup ────────────────────────────────
  const ROUTE_ID   = 50357921;
  const API_KEY    = '81c8a1eb';
  const AUTH_TOKEN = '5cc5e4b222670322422e8a3fb7324379';
  const routeUrl   = `https://ridewithgps.com/api/v1/routes/${ROUTE_ID}.json?version=2`;

  fetch(routeUrl, {
    headers: {
      'x-rwgps-api-key': API_KEY,
      'x-rwgps-auth-token': AUTH_TOKEN
    }
  })
    .then(res => {
      if (!res.ok) throw new Error(`RWGPS error: ${res.status}`);
      return res.json();
    })
    .then(data => {
      // Draw the full trail polyline
      const pts = data.route.track_points;
      routeLatLngs = pts.map(p => [p.y, p.x]);
      L.polyline(routeLatLngs, { weight: 4, color: '#0077CC' }).addTo(map);
      map.fitBounds(routeLatLngs);
	  
	  // 1) Trail Start & End
	  const startPt = { name: "Trail Start", coords: routeLatLngs[0] };
	  const endPt   = { name: "Trail End",   coords: routeLatLngs[routeLatLngs.length - 1] };

	  // 2) Compose the full list
	  entryPoints = [
	    startPt,
	    ...baseEntryPoints,
	    endPt
	  ];

	  // 3) Pre‑render so buttons exist when needed
	  renderEntryList();

	  // 4) Also update your visible trail name header
	  const trailName = data.route.name || 'My Trail';
	  document.getElementById('trail-header').textContent    = trailName;
	  document.getElementById('nav-trail-header').textContent = trailName;
	  

      // Build Turf lineString ([lng, lat])
      routeLine = turf.lineString(routeLatLngs.map(([lat, lng]) => [lng, lat]));
	  
	// 4) Set the header text to the route’s name
	  const trailName = data.route.name || 'My Trail';
	  document.getElementById('trail-header').textContent = trailName;
	
    })
    .catch(err => console.error('Failed to load RWGPS route:', err));

  // ─── 4) HELPERS ───────────────────────────────────────────────────────
    // ─── BEARING HELPER ────────────────────────────────────────────────
    function getBearing(start, end) {
      const toRad = d => d * Math.PI/180;
      const toDeg = r => r * 180/Math.PI;
      const [lat1, lon1] = start.map(toRad);
      const [lat2, lon2] = end.map(toRad);
      const dLon = lon2 - lon1;
      const y    = Math.sin(dLon)*Math.cos(lat2);
      const x    = Math.cos(lat1)*Math.sin(lat2)
                - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
      return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    // ─── STRAIGHT‑LINE (Haversine) DISTANCE HELPER ────────────────────
    function haversineDistance([lat1, lon1], [lat2, lon2]) {
      const toRad = d => d * Math.PI/180;
      const R     = 6371; // Earth radius in mi
      const dLat  = toRad(lat2 - lat1);
      const dLon  = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2)**2
              + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
              * Math.sin(dLon/2)**2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }

    // ─── NAV VIEW BUILDER WITH PURELY ALONG‑TRAIL DISTANCES ───────────
	function updateNavView() {
	  if (!lastPos || !poiData.length || !routeLine) return;

	  const bearing   = userBearing != null ? userBearing : 0;
	  const ahead     = [];
	  const behind    = [];

	  // Pre‑snap your position once
	  const userPt    = turf.point([ lastPos[1], lastPos[0] ]);
	  const snappedUser = turf.nearestPointOnLine(routeLine, userPt, { units: 'miles' });

	  poiData.forEach(dest => {
	    // 1) Snap the POI to the trail
	    const poiPt      = turf.point([ dest.coords[1], dest.coords[0] ]);
	    const snappedPoi = turf.nearestPointOnLine(routeLine, poiPt, { units: 'miles' });
	    const snappedLatLng = [
	      snappedPoi.geometry.coordinates[1],
	      snappedPoi.geometry.coordinates[0]
	    ];

	    // 2) Compute both possible along‑trail segments
	    const seg1 = turf.lineSlice(snappedUser, snappedPoi, routeLine);
	    const d1   = turf.length(seg1, { units: 'miles' });
	    const seg2 = turf.lineSlice(snappedPoi, snappedUser, routeLine);
	    const d2   = turf.length(seg2, { units: 'miles' });

	    // 3) Pick the shorter path
	    const dist = Math.min(d1, d2);
	    dest._currentDistance = dist;

	    // 4) Bucket by raw bearing
	    const b    = getBearing(lastPos, dest.coords);
	    const diff = Math.min(Math.abs(b - bearing), 360 - Math.abs(b - bearing));
	    if (diff <= 90) ahead.push(dest);
	    else            behind.push(dest);


	  });

	  // 6) Sort ascending
	  ahead.sort((a, b) => a._currentDistance - b._currentDistance);
	  behind.sort((a, b) => a._currentDistance - b._currentDistance);

	  // 7) Render lists
	  const aheadList  = document.getElementById('ahead-list');
	  const behindList = document.getElementById('behind-list');
	  aheadList.innerHTML  = '';
	  behindList.innerHTML = '';

	  // Ahead: five nearest → display farthest→nearest
	  ahead
	    .slice(0, 5)
	    .sort((a, b) => b._currentDistance - a._currentDistance)
	    .forEach(d => {
	      aheadList.insertAdjacentHTML('beforeend', `
	        <div class="poi-row">
	          <span>${d.icon} ${d.name}</span>
	          <span>${d._currentDistance.toFixed(1)} mi</span>
	        </div>`);
	    });

	  // Behind: three nearest → display nearest→farthest
	  behind
	    .slice(0, 3)
	    .forEach(d => {
	      behindList.insertAdjacentHTML('beforeend', `
	        <div class="poi-row">
	          <span>${d.icon} ${d.name}</span>
	          <span>${d._currentDistance.toFixed(1)} mi</span>
	        </div>`);
	    });
	}


	function renderEntryList() {
	  entryList.innerHTML = '';
	  entryPoints.forEach((pt, i) => {
	    const btn = document.createElement('button');
	    btn.textContent = pt.name;
	    btn.dataset.index = i;
	    entryList.appendChild(btn);
	    btn.addEventListener('click', () => {
	      // Override position and resume Nav
	      lastPos = pt.coords.slice();
	      userBearing = null;
	      entryOverlay.style.display = 'none';
	      navOverlay.style.display = 'block';
	      setActiveTab(tabNav);
	      updateNavView();
	    });
	  });
	}

  

  function showDetail(dest) {
    lastDetailDest = dest;  
    detailTitle.textContent     = dest.name;
    detailImg.src               = dest.image  || 'https://via.placeholder.com/400';
    detailImg.alt               = dest.name;
    detailDesc.textContent      = dest.description;
    detailDistance.textContent  = dest._currentDistance?.toFixed(1) + ' mi' || '';
    detailOverlay.style.display = 'block';
  }

  // ─── RENDER THE “LIST” OVERLAY GROUPED BY place tags ─────────────────
  function renderListView() {
    console.log('▶ renderListView', poiData.length, 'POIs');  // debug

    // 1) Group by first tag
    const groups = {};
    poiData.forEach(dest => {
      const tag = dest.tags?.[0];
      if (!tag) return;
      if (!groups[tag.id]) {
        groups[tag.id] = { name: tag.name, items: [] };
      }
      groups[tag.id].items.push(dest);
    });

    // 2) Clear and inject into #list-overlay
    listOverlay.innerHTML = '';
    Object.values(groups).forEach(group => {
      const section = document.createElement('section');
      section.style.marginBottom = '1.5rem';

      const h2 = document.createElement('h2');
      h2.textContent = group.name;
      h2.style.marginBottom = '.5rem';
      section.appendChild(h2);

      const ul = document.createElement('ul');
      ul.style.listStyle = 'none';
      ul.style.padding   = '0';
      group.items.forEach(dest => {
        const li = document.createElement('li');
        li.style.padding = '.25rem 0';
        li.innerHTML = `
          ${dest.icon}
          <span class="clickable">${dest.name}</span>
        `;
        li.querySelector('.clickable').addEventListener('click', () => {
          showDetail(dest);
          listOverlay.style.display = 'none';
          setActiveTab(tabList);
        });
        ul.appendChild(li);
      });

      section.appendChild(ul);
      listOverlay.appendChild(section);
    });
  }



  // ─── 5) LOAD YOUR WORDPRESS PLACES ───────────────────────────────────
  fetch('https://srtmaps.elev8maps.com/wp-json/geodir/v2/places?per_page=100')
    .then(r => {
      if (!r.ok) throw new Error(`GeoDir error: ${r.status}`);
      return r.json();
    })
    .then(places => {
      // 1) Map into poiData, including the tags array
      poiData = places.map(p => ({
        name:        p.title.rendered,
        coords:      [ parseFloat(p.latitude), parseFloat(p.longitude) ],
        icon:        '📍',
        description: p.content.raw,
        image:       p.featured_image?.[0]?.source_url || '',
        tags:        p.post_tags    // capture the tags for grouping
      }));

      // 2) Draw markers as before
      places.forEach(p => {
        const lat = parseFloat(p.latitude);
        const lng = parseFloat(p.longitude);
        if (isNaN(lat) || isNaN(lng)) return;
        L.marker([lat, lng])
         .addTo(map)
         .bindPopup(`<strong>${p.title.rendered}</strong>`);
      });

      // 3) Refresh your views
      updateNavView();
      renderListView();   // populate the List tab
    })
    .catch(err => console.error(err));

 

  // ─── 6) REAL‑TIME LOCATION WATCHER ───────────────────────────────────
  if (navigator.geolocation) {
	  navigator.geolocation.watchPosition(
	    pos => {
	      const coords = [pos.coords.latitude, pos.coords.longitude];

	      // 1) Snap & measure lateral offset from trail
	      const userPt      = turf.point([ coords[1], coords[0] ]);
	      const snappedUser = turf.nearestPointOnLine(routeLine, userPt, { units: 'kilometers' });
	      const snapLat     = snappedUser.geometry.coordinates[1];
	      const snapLng     = snappedUser.geometry.coordinates[0];
	      const lateralKm   = haversineDistance(coords, [ snapLat, snapLng ]);

	      // 2) If off‑trail (> 0.152 km ≈ 500 ft), show entry picker
	      if (lateralKm > 0.152) {
	        entryOverlay.style.display = 'block';
	        return;  // skip updating map until user picks a point
	      }

	      // 3) Otherwise hide overlay and update real position
	      entryOverlay.style.display = 'none';
	      if (!userMarker) {
	        userMarker = L.marker(coords)
	          .addTo(map)
	          .bindPopup('You are here')
	          .openPopup();
	      } else {
	        userMarker.setLatLng(coords);
	      }

	      // 4) Compute bearing, set lastPos, and refresh Nav view
	      if (lastPos) userBearing = getBearing(lastPos, coords);
	      lastPos = coords;
	      updateNavView();
	    },
	    err => console.warn(err),
	    { enableHighAccuracy: false }
	  );
    
  }
  // ─── 9) BOTTOM‑TAB NAVIGATION ────────────────────────────────────────


  // 2) Active‑tab helper (now includes List)
  function setActiveTab(tabBtn) {
    [tabMap, tabNav, tabList].forEach(b => b.classList.remove('active'));
    tabBtn.classList.add('active');
  }

  // 3) Map tab: show map, hide overlays
  tabMap.addEventListener('click', () => {
    navOverlay.style.display    = 'none';
    listOverlay.style.display   = 'none';
    openNavBtn.style.display    = 'block';
    setActiveTab(tabMap);
  });

  // 4) Nav tab: show nav overlay
  tabNav.addEventListener('click', () => {
    navOverlay.style.display    = 'block';
    listOverlay.style.display   = 'none';
    openNavBtn.style.display    = 'none';
    setActiveTab(tabNav);
  });

  // 5) List tab: show your grouped list view
  tabList.addEventListener('click', () => {
	navOverlay.style.display    = 'none';
    listOverlay.style.display   = 'block';
    openNavBtn.style.display    = 'none';
    setActiveTab(tabList);
  });
  


  
}); // end DOMContentLoaded
