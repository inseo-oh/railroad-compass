const EARTH_RADIUS_METERS = 6371000;
const STATION_COUNT = 10;

let stationInfo = [];
let currentPosition = null;
let heading = 0;
let watchId = null;

const locationStatus = document.querySelector('#locationStatus');
const headingValue = document.querySelector('#headingValue');
const locationButton = document.querySelector('#locationButton');
const compassButton = document.querySelector('#compassButton');

function distanceMeters(a, b) {
    // Haversine distance accounts for the Earth's curve, so we can rank stations
    // by real distance instead of comparing raw latitude/longitude differences.
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const lat1 = toRadians(a.latitude);
    const lat2 = toRadians(b.latitude);
    const latDiff = lat2 - lat1;
    const lonDiff = toRadians(b.longitude - a.longitude);
    const h = Math.sin(latDiff / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDiff / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function update() {
    if (!currentPosition || stationInfo.length === 0) return;

    const stationNamesWrap = document.querySelector('.stationNamesWrap');
    const compass = document.querySelector('.compassBg');
    // Expand the search radius until we have enough distinct station names,
    // then use that radius to fit the nearest stations inside the compass.
    const maxRadius = 50000;
    let radius = 500;
    let nearbyStations = [];

    while (radius <= maxRadius) {
        const seenNames = new Set();
        nearbyStations = stationInfo
            .map((station) => ({
                ...station,
                distance: distanceMeters(station, currentPosition),
            }))
            .filter((station) => {
                if (station.distance > radius || seenNames.has(station.stationName)) return false;
                seenNames.add(station.stationName);
                return true;
            })
            .sort((a, b) => a.distance - b.distance)
            .slice(0, STATION_COUNT);
        if (nearbyStations.length >= STATION_COUNT || radius === maxRadius) break;
        radius = Math.min(radius + 500, maxRadius);
    }

    const visibleRadius = Math.max(radius, ...nearbyStations.map((station) => station.distance));
    const scale = (compass.clientWidth * 0.44) / visibleRadius;
    const visibleCodes = new Set(nearbyStations.map((station) => station.stationCode));

    for (const stationElement of stationNamesWrap.querySelectorAll('[station]')) {
        if (!visibleCodes.has(stationElement.getAttribute('station'))) stationElement.remove();
    }

    for (const station of nearbyStations) {
        let stationElement = stationNamesWrap.querySelector(`[station='${station.stationCode}']`);
        if (!stationElement) {
            stationElement = document.createElement('div');
            stationElement.setAttribute('station', station.stationCode);
            stationElement.textContent = station.stationName;
            stationNamesWrap.appendChild(stationElement);
        }

        // Convert the small local coordinate offsets to meters. Longitude
        // shrinks toward the poles, so adjust east-west distance by latitude.
        const northMeters = (station.latitude - currentPosition.latitude) * 111320;
        const eastMeters =
            (station.longitude - currentPosition.longitude) *
            111320 *
            Math.cos((currentPosition.latitude * Math.PI) / 180);
        stationElement.style.opacity = `${Math.max(0.25, 1 - station.distance / (visibleRadius * 1.15))}`;
        stationElement.style.transform = `translate(${eastMeters * scale}px, ${-northMeters * scale}px) translate(-50%, -50%) scale(${Math.max(0.65, 1 - station.distance / (visibleRadius * 2))}) rotate(calc(-1 * var(--rotation)))`;
    }

    locationStatus.textContent = `Showing ${nearbyStations.length} nearby stations · ${currentPosition.latitude.toFixed(4)}, ${currentPosition.longitude.toFixed(4)}`;
}

let oldHeading;
let rotation = 0;

function setHeading(degrees) {
    // Keep the red marker at the top as north: rotate the map opposite to the
    // direction the device is facing, while keeping the numeric readout normal.
    const heading = ((degrees % 360) + 360) % 360;

    if (oldHeading !== undefined) {
        const delta = ((heading - oldHeading + 540) % 360) - 180;
        rotation -= delta;
    }

    oldHeading = heading;
    document.body.style.setProperty('--rotation', `${rotation}deg`);
    headingValue.textContent = `${Math.round(heading)}°`;
}

function startLocation() {
    if (!('geolocation' in navigator)) {
        locationStatus.textContent = 'Location is not supported by this browser.';
        return;
    }

    locationButton.disabled = true;
    locationStatus.textContent = 'Waiting for your location permission…';
    // watchPosition reports the first fix and continues updating as the user moves.
    watchId = navigator.geolocation.watchPosition(
        ({ coords }) => {
            currentPosition = { latitude: coords.latitude, longitude: coords.longitude };
            locationButton.textContent = 'Location active';
            update();
        },
        (error) => {
            locationButton.disabled = false;
            locationStatus.textContent =
                error.code === error.PERMISSION_DENIED
                    ? 'Location permission was denied. Allow it in your browser settings to continue.'
                    : 'Could not get your location. Check your connection and try again.';
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
}

function onDeviceOrientation(event) {
    // Safari exposes a direct compass heading. Other browsers can report alpha
    // as an absolute angle, which is measured in the opposite direction.
    const deviceHeading = event.webkitCompassHeading;
    if (Number.isFinite(deviceHeading)) {
        setHeading(deviceHeading);
    } else if (event.absolute && Number.isFinite(event.alpha)) {
        setHeading(360 - event.alpha);
    }
}

async function startCompass() {
    if (!('DeviceOrientationEvent' in window)) {
        compassButton.textContent = 'Compass unavailable';
        compassButton.disabled = true;
        return;
    }

    try {
        // iOS requires sensor permission to be requested from a user gesture,
        // which is why this runs only after the Enable compass button is tapped.
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission !== 'granted') throw new Error('permission denied');
        }
        window.addEventListener('deviceorientation', onDeviceOrientation, true);
        window.addEventListener('deviceorientationabsolute', onDeviceOrientation, true);
        compassButton.textContent = 'Compass enabled';
        compassButton.disabled = true;
    } catch {
        compassButton.textContent = 'Allow compass in settings';
    }
}

async function initialize() {
    const degText = document.querySelector('.degText');
    for (let degree = 0; degree < 360; degree += 20) {
        const text = document.createElement('div');
        text.className = 'text';
        text.style.transform = `rotate(${degree}deg)`;
        text.textContent = `${degree}`;
        degText.appendChild(text);
    }

    startLocation();
    startCompass();
    locationButton.addEventListener('click', startLocation);
    compassButton.addEventListener('click', startCompass);

    // Station data is bundled with the page; once loaded, a later location fix
    // can immediately render the closest entries around the user.
    try {
        const response = await fetch('./urban_rail_stations.json');
        if (!response.ok) throw new Error('Station data could not be loaded.');
        stationInfo = await response.json();
        update();
    } catch {
        locationStatus.textContent = 'Could not load station data. Try reloading the page.';
        locationButton.disabled = true;
    }
}

window.addEventListener('resize', update);
window.addEventListener('load', initialize);
