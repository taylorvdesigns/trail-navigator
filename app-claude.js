/**
 * Trail Navigation App Error Handling System
 * 
 * This system provides structured error handling for navigation, geolocation, 
 * data fetching, and user interface components of your trail app.
 */




// ─── 1) ERROR TYPES & CONFIG ───────────────────────────────────────────────────
// Define error types for different categories
const ErrorTypes = {
  LOCATION: 'location',
  NETWORK: 'network',
  ROUTE: 'route',
  MAP: 'map',
  DATA: 'data',
  UI: 'ui'
};

// ----- ADD THESE NEAR THE TOP OF YOUR ERROR HANDLER FILE -----

// Check for required functions and provide fallbacks
function ensureRequiredFunctions() {
  // Define fallbacks for required functions if they don't exist
  window.updateNavView = window.updateNavView || function() {
    console.warn("updateNavView called but not defined");
  };
  
  window.renderListView = window.renderListView || function() {
    console.warn("renderListView called but not defined");
  };
  
  window.showDetail = window.showDetail || function() {
    console.warn("showDetail called but not defined");
  };
  
  window.promptManualEntryPoint = window.promptManualEntryPoint || function() {
    console.warn("promptManualEntryPoint called but not defined");
    
    // Basic fallback implementation if the main app doesn't define it
    if (window.entryOverlay) {
      window.entryOverlay.style.display = 'block';
      if (typeof window.hasManualEntry !== 'undefined') {
        window.hasManualEntry = true;
      }
    }
  };
}

// ----- MODIFY THE initErrorHandling FUNCTION -----

function initErrorHandling() {
  // Only initialize if not already done
  if (window.appErrorHandler) {
    console.log('Error handling already initialized');
    return window.appErrorHandler;
  }
  // Ensure required functions exist first
  ensureRequiredFunctions();
  
  // Create stylesheet for animations
  const style = document.createElement('style');
  style.textContent = `
    /* Your CSS remains the same */
  `;
  document.head.appendChild(style);
  
  // Create global error handler
  window.appErrorHandler = new ErrorHandler();
  
  // Setup all error handling systems
  window.setupGeolocationWithErrorHandling = setupGeolocationWithErrorHandling;
  
  // Only call these setups if they aren't being called from the main app
  setupMapErrorHandling();
  setupUIErrorHandling();
  
  console.log('Error handling system initialized');
  
  // Return the error handler for direct use
  return window.appErrorHandler;
}

// ----- MODIFY setupUIErrorHandling -----

function setupUIErrorHandling() {
  // Wrap key UI functions with try/catch
  const errorHandler = window.appErrorHandler;
  
  // Safe wrapper for UI updates
  window.safeUpdateUI = function(fn, context = 'UI') {
    try {
      return fn();
    } catch (err) {
      console.error(`Error in ${context}:`, err);
      if (errorHandler) {
        errorHandler.handleError(ErrorTypes.UI, 'render-failed', {
          context,
          message: err.message
        });
      }
      return null;
    }
  };
  
  // Add global error catching
  window.addEventListener('error', (event) => {
    if (errorHandler) {
      errorHandler.handleError(ErrorTypes.UI, 'runtime-error', {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno
      });
    }
  });
  
  // Only wrap functions if they exist and haven't been wrapped yet
  if (window.showDetail && !window.showDetail._wrapped) {
    const originalShowDetail = window.showDetail;
    window.showDetail = function(dest) {
      window.showDetail._wrapped = true;
      return window.safeUpdateUI(() => originalShowDetail(dest), 'showDetail');
    };
  }
  
  if (window.updateNavView && !window.updateNavView._wrapped) {
    const originalUpdateNavView = window.updateNavView;
    window.updateNavView = function() {
      window.updateNavView._wrapped = true;
      return window.safeUpdateUI(() => originalUpdateNavView(), 'updateNavView');
    };
  }
  
  if (window.renderListView && !window.renderListView._wrapped) {
    const originalRenderListView = window.renderListView;
    window.renderListView = function() {
      window.renderListView._wrapped = true;
      return window.safeUpdateUI(() => originalRenderListView(), 'renderListView');
    };
  }
}


// Configuration for error messages and recovery actions
const ErrorConfig = {
  [ErrorTypes.LOCATION]: {
    // GeolocationPositionError codes: 1=permission denied, 2=unavailable, 3=timeout
    1: {
      message: 'Location access denied. Please enable location services in your settings.',
      critical: true,
      recovery: () => showLocationPermissionHelp()
    },
    2: {
      message: 'Unable to determine your location. Try moving to an area with better GPS signal.',
      critical: false,
      recovery: () => promptManualEntryPoint()
    },
    3: {
      message: 'Location request timed out. Please check your device settings.',
      critical: false,
      recovery: () => promptManualEntryPoint()
    },
    'accuracy': {
      message: 'Low GPS accuracy. Your position on the trail may not be precise.',
      critical: false
    },
    'off-trail': {
      message: 'You appear to be off the trail.',
      critical: false,
      recovery: () => promptManualEntryPoint()
    }
  },
  [ErrorTypes.NETWORK]: {
    'offline': {
      message: 'You\'re offline. Some features may be limited.',
      critical: false,
      recovery: () => enableOfflineMode()
    },
    'fetch-failed': {
      message: 'Failed to load data. Please check your connection.',
      critical: false,
      recovery: () => retryFetch()
    }
  },
  [ErrorTypes.ROUTE]: {
    'load-failed': {
      message: 'Failed to load trail route. Please try again later.',
      critical: true,
      recovery: () => retryRouteLoad()
    },
    'processing-failed': {
      message: 'Error processing trail data.',
      critical: true
    }
  },
  [ErrorTypes.MAP]: {
    'render-failed': {
      message: 'Error displaying map. Please refresh the page.',
      critical: true,
      recovery: () => window.location.reload()
    },
    'tile-load-failed': {
      message: 'Map tiles failed to load. Limited map view available.',
      critical: false
    }
  },
  [ErrorTypes.DATA]: {
    'poi-load-failed': {
      message: 'Failed to load point of interest data.',
      critical: false,
      recovery: () => retryPoiLoad()
    }
  },
  [ErrorTypes.UI]: {
    'render-failed': {
      message: 'Error displaying content. Please refresh the app.',
      critical: false,
      recovery: () => window.location.reload()
    }
  }
};

// ─── 2) ERROR HANDLER CLASS ─────────────────────────────────────────────────────
class ErrorHandler {
  constructor() {
    this.activeErrors = new Map();
    this.retryAttempts = new Map();
    this.maxRetries = 3;
    this.errorContainer = null;
    this.initErrorContainer();
    this.offlineMode = false;

    // Monitor network status
    window.addEventListener('online', () => this.handleNetworkChange(true));
    window.addEventListener('offline', () => this.handleNetworkChange(false));
  }

  initErrorContainer() {
    // Create error message container if it doesn't exist
    if (!document.getElementById('error-container')) {
      const container = document.createElement('div');
      container.id = 'error-container';
      container.className = 'error-container';
      container.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        max-width: 90%;
        z-index: 1000;
        width: auto;
      `;
      document.body.appendChild(container);
      this.errorContainer = container;
    } else {
      this.errorContainer = document.getElementById('error-container');
    }
  }

  handleError(type, code, details = {}) {
    const errorKey = `${type}-${code}`;
    const config = ErrorConfig[type]?.[code];
    
    if (!config) {
      console.error(`Unhandled error: ${type}-${code}`, details);
      return;
    }

    console.error(`${config.message}`, details);
    
    // Store active error
    this.activeErrors.set(errorKey, {
      type,
      code,
      timestamp: Date.now(),
      details,
      config
    });

    // Display error to user
    this.showErrorMessage(errorKey, config.message, config.critical, config.recovery);

    // Execute critical error logic
    if (config.critical) {
      this.handleCriticalError(type, code);
    }

    return errorKey;
  }

  clearError(errorKey) {
    if (this.activeErrors.has(errorKey)) {
      this.activeErrors.delete(errorKey);
      this.removeErrorMessage(errorKey);
    }
  }

  showErrorMessage(key, message, isCritical, hasRecovery) {
    const existingAlert = document.getElementById(`error-${key}`);
    if (existingAlert) {
      return; // Don't show duplicate errors
    }

    const alertDiv = document.createElement('div');
    alertDiv.id = `error-${key}`;
    alertDiv.className = `error-alert ${isCritical ? 'critical' : 'warning'}`;
    alertDiv.style.cssText = `
      margin-bottom: 10px;
      padding: 12px 15px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background-color: ${isCritical ? '#f8d7da' : '#fff3cd'};
      border: 1px solid ${isCritical ? '#f5c6cb' : '#ffeeba'};
      color: ${isCritical ? '#721c24' : '#856404'};
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      font-size: 14px;
      animation: fadeIn 0.3s;
    `;

    const messageWrapper = document.createElement('div');
    messageWrapper.style.flex = '1';
    messageWrapper.textContent = message;

    alertDiv.appendChild(messageWrapper);

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      margin-left: 10px;
      color: inherit;
    `;
    closeBtn.onclick = () => this.removeErrorMessage(key);
    alertDiv.appendChild(closeBtn);

    // Add action button if recovery action exists
    if (hasRecovery) {
      const actionBtn = document.createElement('button');
      actionBtn.textContent = 'Fix';
      actionBtn.style.cssText = `
        background: none;
        border: 1px solid currentColor;
        border-radius: 3px;
        padding: 3px 8px;
        font-size: 12px;
        cursor: pointer;
        margin-left: 10px;
        color: inherit;
      `;
      actionBtn.onclick = () => {
        hasRecovery();
        this.removeErrorMessage(key);
      };
      alertDiv.appendChild(actionBtn);
    }

    this.errorContainer.appendChild(alertDiv);

    // Auto-dismiss non-critical errors after 8 seconds
    if (!isCritical) {
      setTimeout(() => {
        this.removeErrorMessage(key);
      }, 8000);
    }
  }

  removeErrorMessage(key) {
    const alertDiv = document.getElementById(`error-${key}`);
    if (alertDiv) {
      alertDiv.style.animation = 'fadeOut 0.3s';
      setTimeout(() => {
        if (alertDiv.parentNode) {
          alertDiv.parentNode.removeChild(alertDiv);
        }
      }, 300);
    }
  }

  handleCriticalError(type, code) {
    // Log critical errors
    this.logError(type, code);
    
    // For location critical errors, show manual entry immediately
    if (type === ErrorTypes.LOCATION) {
      promptManualEntryPoint();
    }
    
    // For route critical errors, try to load cached data
    if (type === ErrorTypes.ROUTE) {
      this.tryLoadCachedRoute();
    }
  }

  logError(type, code, details = {}) {
    const error = {
      type,
      code,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      details
    };
    
    // Store in local storage for later analysis
    const errors = JSON.parse(localStorage.getItem('trail-app-errors') || '[]');
    errors.push(error);
    localStorage.setItem('trail-app-errors', JSON.stringify(errors.slice(-20))); // Keep last 20 errors
    
    // Could send to server analytics here if needed
    // sendErrorToAnalytics(error);
  }

  handleNetworkChange(isOnline) {
    if (isOnline) {
      this.clearError(`${ErrorTypes.NETWORK}-offline`);
      if (this.offlineMode) {
        this.offlineMode = false;
        this.refreshDataAfterReconnect();
      }
    } else {
      this.handleError(ErrorTypes.NETWORK, 'offline');
      this.offlineMode = true;
    }
  }

  async retryWithBackoff(fn, retryKey, maxRetries = this.maxRetries) {
    const attempts = this.retryAttempts.get(retryKey) || 0;
    
    if (attempts >= maxRetries) {
      this.retryAttempts.delete(retryKey);
      return false;
    }
    
    this.retryAttempts.set(retryKey, attempts + 1);
    
    // Exponential backoff: 1s, 2s, 4s, etc.
    const delay = Math.pow(2, attempts) * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      await fn();
      this.retryAttempts.delete(retryKey);
      return true;
    } catch (error) {
      console.error(`Retry ${attempts + 1}/${maxRetries} failed:`, error);
      return false;
    }
  }

  refreshDataAfterReconnect() {
    // Refresh essential data
    tryLoadRouteData();
    tryLoadPoiData();
  }

  tryLoadCachedRoute() {
    try {
      const cachedRoute = localStorage.getItem('cached-route-data');
      if (cachedRoute) {
        const data = JSON.parse(cachedRoute);
        // Process cached route data
        processRouteData(data);
        this.handleError(ErrorTypes.UI, 'cached-data', { 
          message: 'Using cached trail data. Some information may be outdated.' 
        });
        return true;
      }
    } catch (e) {
      console.error('Failed to load cached route data', e);
    }
    return false;
  }
}

// ─── 3) GEOLOCATION ERROR HANDLING ─────────────────────────────────────────────
function setupGeolocationWithErrorHandling() {
  if (!window.navigator.geolocation) {
    if (window.appErrorHandler) {
      window.appErrorHandler.handleError(ErrorTypes.LOCATION, 2, {
        message: 'Geolocation is not supported by your browser'
      });
    }
    if (window.promptManualEntryPoint) {
      window.promptManualEntryPoint();
    }
    return;
  }

  // If main app already set up geolocation, don't override it
  if (window._geolocationInitialized) {
    return;
  }

  // Enhanced watchPosition with error handling
  const watchId = navigator.geolocation.watchPosition(
    handlePositionSuccess,
    handlePositionError,
    { 
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );

  function handlePositionSuccess(pos) {
    // Clear any existing location errors
    errorHandler.clearError(`${ErrorTypes.LOCATION}-2`);
    errorHandler.clearError(`${ErrorTypes.LOCATION}-3`);
    
    const coords = [pos.coords.latitude, pos.coords.longitude];
    
    // Check accuracy
    if (pos.coords.accuracy > 50) { // Accuracy in meters
      errorHandler.handleError(ErrorTypes.LOCATION, 'accuracy', {
        accuracy: pos.coords.accuracy
      });
    } else {
      errorHandler.clearError(`${ErrorTypes.LOCATION}-accuracy`);
    }
    
    // Update user marker
    updateUserPosition(coords, pos.coords);
    
    // Check if user is off-trail
    if (routeLine) {
      checkOffTrail(coords);
    }
  }

  function handlePositionError(err) {
    console.warn('Geolocation error:', err);
    errorHandler.handleError(ErrorTypes.LOCATION, err.code, {
      message: err.message
    });
    
    // For timeout or position unavailable, try with lower accuracy
    if (err.code === 2 || err.code === 3) {
      navigator.geolocation.getCurrentPosition(
        handlePositionSuccess,
        (fallbackErr) => {
          console.error('Fallback position also failed:', fallbackErr);
          promptManualEntryPoint();
        },
        { enableHighAccuracy: false, timeout: 20000 }
      );
    }
  }

  function checkOffTrail(coords) {
    if (!routeLine || !coords) return;
    
    const userPt = turf.point([coords[1], coords[0]]);
    const snapped = turf.nearestPointOnLine(routeLine, userPt, { units: 'kilometers' });
    const [lng, lat] = snapped.geometry.coordinates;
    const lateralKm = haversineDistance(coords, [lat, lng]);
    
    // If user is more than 150m from trail
    if (lateralKm > 0.15) {
      errorHandler.handleError(ErrorTypes.LOCATION, 'off-trail', { 
        distance: lateralKm 
      });
      // Don't prompt automatically - user can use the "Fix" button if they choose
    } else {
      errorHandler.clearError(`${ErrorTypes.LOCATION}-off-trail`);
    }
  }

  return watchId;
}

function showLocationPermissionHelp() {
  // Show a helpful modal with instructions for enabling location
  const modal = document.createElement('div');
  modal.className = 'permission-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Enable Location Access</h3>
      <p>This app needs location access to help you navigate the trail.</p>
      <div class="help-steps">
        <div class="step">
          <h4>For iPhone/iPad:</h4>
          <ol>
            <li>Open <strong>Settings</strong></li>
            <li>Scroll down and tap <strong>Safari</strong></li>
            <li>Under "Settings for Websites", tap <strong>Location</strong></li>
            <li>Select <strong>Allow</strong> for this website</li>
          </ol>
        </div>
        <div class="step">
          <h4>For Android:</h4>
          <ol>
            <li>Open <strong>Settings</strong></li>
            <li>Tap <strong>Site Settings</strong> or <strong>Permissions</strong></li>
            <li>Tap <strong>Location</strong></li>
            <li>Make sure location access is enabled</li>
          </ol>
        </div>
      </div>
      <div class="modal-buttons">
        <button id="retry-location">Try Again</button>
        <button id="manual-entry">Use Manual Entry</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  document.getElementById('retry-location').addEventListener('click', () => {
    document.body.removeChild(modal);
    setupGeolocationWithErrorHandling();
  });
  
  document.getElementById('manual-entry').addEventListener('click', () => {
    document.body.removeChild(modal);
    promptManualEntryPoint();
  });
}

function promptManualEntryPoint() {
  // Show entry point selection
  renderEntryList();
  entryOverlay.style.display = 'block';
  hasManualEntry = true; // Prevent future popups
}

// ─── 4) NETWORK ERROR HANDLING ────────────────────────────────────────────────
function enableOfflineMode() {
  // Enable offline mode with cached data
  const errorHandler = window.appErrorHandler;
  errorHandler.offlineMode = true;
  
  // Try to load cached data
  const routeLoaded = errorHandler.tryLoadCachedRoute();
  
  // Try to load cached POIs
  const poisLoaded = loadCachedPOIs();
  
  if (!routeLoaded && !poisLoaded) {
    errorHandler.handleError(ErrorTypes.DATA, 'no-cached-data', {
      message: 'No cached data available for offline use'
    });
  }
}

function loadCachedPOIs() {
  try {
    const cachedPOIs = localStorage.getItem('cached-poi-data');
    if (cachedPOIs) {
      poiData = JSON.parse(cachedPOIs);
      updateNavView();
      renderListView();
      return true;
    }
  } catch (e) {
    console.error('Failed to load cached POI data', e);
  }
  return false;
}

// ─── 5) DATA FETCHING WITH ERROR HANDLING ───────────────────────────────────────
function tryLoadRouteData() {
  const errorHandler = window.appErrorHandler;
  
  // Fetch route with error handling
  fetch(routeUrl, {
    headers: {
      'x-rwgps-api-key': API_KEY,
      'x-rwgps-auth-token': AUTH_TOKEN
    }
  })
    .then(r => {
      if (!r.ok) {
        throw new Error(`RWGPS error: ${r.status}`);
      }
      return r.json();
    })
    .then(data => {
      // Cache the route data
      try {
        localStorage.setItem('cached-route-data', JSON.stringify(data));
      } catch (e) {
        console.warn('Failed to cache route data', e);
      }
      
      processRouteData(data);
      
      // Clear any route loading errors
      errorHandler.clearError(`${ErrorTypes.ROUTE}-load-failed`);
    })
    .catch(err => {
      console.error('Route loading error:', err);
      const errorKey = errorHandler.handleError(ErrorTypes.ROUTE, 'load-failed', { 
        message: err.message 
      });
      
      // Try to retry
      errorHandler.retryWithBackoff(() => tryLoadRouteData(), 'route-load');
    });
}

function processRouteData(data) {
  try {
    // Draw polyline
    const pts = data.route.track_points;
    routeLatLngs = pts.map(p => [p.y, p.x]);
    
    if (routeLine) {
      map.removeLayer(routeLine);
    }
    
    routeLine = L.polyline(routeLatLngs, { weight: 4, color: '#0077CC' }).addTo(map);
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
  } catch (err) {
    console.error('Error processing route data:', err);
    window.appErrorHandler.handleError(ErrorTypes.ROUTE, 'processing-failed', {
      message: err.message
    });
  }
}

function retryRouteLoad() {
  tryLoadRouteData();
}

function tryLoadPoiData() {
  const errorHandler = window.appErrorHandler;
  
  fetch('https://srtmaps.elev8maps.com/wp-json/geodir/v2/places?per_page=100')
    .then(r => {
      if (!r.ok) {
        throw new Error(`GeoDir error ${r.status}`);
      }
      return r.json();
    })
    .then(places => {
      // Cache the POI data
      try {
        localStorage.setItem('cached-poi-data', JSON.stringify(places));
      } catch (e) {
        console.warn('Failed to cache POI data', e);
      }
      
      processPoiData(places);
      
      // Clear any POI loading errors
      errorHandler.clearError(`${ErrorTypes.DATA}-poi-load-failed`);
    })
    .catch(err => {
      console.error('POI loading error:', err);
      errorHandler.handleError(ErrorTypes.DATA, 'poi-load-failed', { 
        message: err.message 
      });
      
      // Try to retry
      errorHandler.retryWithBackoff(() => tryLoadPoiData(), 'poi-load');
    });
}

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
      categories: (p.post_category || []).map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug.replace(/^\d+-/, '')
      })).filter(cat => cat.slug !== 'business')
    }));

    // Draw them on the map
    places.forEach(p => {
      const lat = parseFloat(p.latitude),
        lng = parseFloat(p.longitude);
      if (isNaN(lat) || isNaN(lng)) return;
      
      try {
        L.marker([lat, lng])
          .addTo(map)
          .bindPopup(`<strong>${p.title.rendered}</strong>`);
      } catch (e) {
        console.warn(`Failed to add marker for ${p.title.rendered}`, e);
      }
    });

    // Update views
    updateNavView();
    renderListView();
  } catch (err) {
    console.error('Error processing POI data:', err);
    window.appErrorHandler.handleError(ErrorTypes.DATA, 'processing-failed', {
      message: err.message
    });
  }
}

function retryPoiLoad() {
  tryLoadPoiData();
}

// ─── 6) MAP ERROR HANDLING ────────────────────────────────────────────────────
function setupMapErrorHandling() {
  const errorHandler = window.appErrorHandler;
  
  // Wait for map to be initialized
  const checkAndSetupMap = () => {
    // Check if map exists and is a Leaflet map instance
    if (window.map && typeof window.map.on === 'function') {
      try {
        window.map.on('tileerror', (error) => {
          if (errorHandler) {
            errorHandler.handleError(ErrorTypes.MAP, 'tile-load-failed', {
              url: error.tile,
              error: error.error
            });
          }
        });
      } catch (e) {
        console.warn('Error setting up map error handling:', e);
      }
    } else {
      // Try again in 100ms if map isn't ready
      setTimeout(checkAndSetupMap, 100);
    }
  };

  checkAndSetupMap();
}

function updateUserPosition(coords, geoCoords) {
  try {
    // Update user marker
    if (!userMarker) {
      userMarker = L.marker(coords).addTo(map).bindPopup('You are here');
    } else {
      userMarker.setLatLng(coords);
    }
    
    // Update heading if available
    if (geoCoords.heading) {
      userBearing = geoCoords.heading;
    } else if (lastPos) {
      userBearing = getBearing(lastPos, coords);
    }
    
    lastPos = coords;
    updateNavView();
  } catch (err) {
    console.error('Error updating user position:', err);
    window.appErrorHandler.handleError(ErrorTypes.MAP, 'position-update-failed', {
      message: err.message
    });
  }
}

// ─── 7) UI ERROR HANDLING ─────────────────────────────────────────────────────
function setupUIErrorHandling() {
  // Wrap key UI functions with try/catch
  const errorHandler = window.appErrorHandler;
  
  // Safe wrapper for UI updates
  window.safeUpdateUI = function(fn, context = 'UI') {
    try {
      return fn();
    } catch (err) {
      console.error(`Error in ${context}:`, err);
      errorHandler.handleError(ErrorTypes.UI, 'render-failed', {
        context,
        message: err.message
      });
      return null;
    }
  };
  
  // Add global error catching
  window.addEventListener('error', (event) => {
    errorHandler.handleError(ErrorTypes.UI, 'runtime-error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno
    });
  });
  
  // Safe version of showDetail
  const originalShowDetail = window.showDetail;
  window.showDetail = function(dest) {
    return safeUpdateUI(() => originalShowDetail(dest), 'showDetail');
  };
  
  // Safe version of updateNavView
  const originalUpdateNavView = window.updateNavView;
  window.updateNavView = function() {
    return safeUpdateUI(() => originalUpdateNavView(), 'updateNavView');
  };
  
  // Safe version of renderListView
  const originalRenderListView = window.renderListView;
  window.renderListView = function() {
    return safeUpdateUI(() => originalRenderListView(), 'renderListView');
  };
}

// ─── 8) INITIALIZATION ─────────────────────────────────────────────────────────
function initErrorHandling() {
  // Create stylesheet for animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes fadeOut {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(-10px); }
    }
    .error-container {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .permission-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }
    .modal-content {
      background: white;
      border-radius: 8px;
      padding: 20px;
      max-width: 90%;
      width: 500px;
      max-height: 90vh;
      overflow-y: auto;
    }
    .help-steps {
      display: flex;
      flex-direction: column;
      gap: 15px;
      margin: 15px 0;
    }
    .modal-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    }
    .modal-buttons button {
      padding: 8px 16px;
      border-radius: 4px;
      border: none;
      background: #0077CC;
      color: white;
      cursor: pointer;
    }
    .modal-buttons button:hover {
      background: #0066AA;
    }
  `;
  document.head.appendChild(style);
  
  // Create global error handler
  window.appErrorHandler = new ErrorHandler();
  
  // Setup all error handling systems
  setupGeolocationWithErrorHandling();
  setupMapErrorHandling();
  setupUIErrorHandling();
  
  // Replace fetch calls with error-handled versions
  tryLoadRouteData();
  tryLoadPoiData();
  
  console.log('Error handling system initialized');
}

// Start the error handling system
document.addEventListener('DOMContentLoaded', () => {
  initErrorHandling();
});

// ─── 9) USAGE EXAMPLES ──────────────────────────────────────────────────────────
/*
// Example: Handle location error
navigator.geolocation.getCurrentPosition(
  (pos) => {
    // Success handling
  },
  (err) => {
    window.appErrorHandler.handleError(ErrorTypes.LOCATION, err.code, {
      message: err.message
    });
  }
);

// Example: Handle network request error
fetch('https://example.com/api')
  .then(response => {
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    // Process data
  })
  .catch(err => {
    window.appErrorHandler.handleError(ErrorTypes.NETWORK, 'fetch-failed', {
      url: 'https://example.com/api',
      message: err.message
    });
  });

// Example: Manually trigger an error
document.getElementById('some-button').addEventListener('click', () => {
  if (!someCondition) {
    window.appErrorHandler.handleError(ErrorTypes.UI, 'action-failed', {
      action: 'button-click'
    });
  }
});
*/