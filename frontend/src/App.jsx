import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';

// Import Leaflet CSS
import 'leaflet/dist/leaflet.css';

// Leaflet default marker icon bug fix
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Helper to decode Google Polyline strings into coordinates for Leaflet
function decodePolyline(encoded) {
  if (!encoded) return [];
  var points = [];
  var index = 0, len = encoded.length;
  var lat = 0, lng = 0;
  while (index < len) {
    var b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    var dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    var dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// Haversine formula to compute distance in km between two lat/lon coordinates
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Major outer rail hubs in Klang Valley / Negeri Sembilan to serve as a default fallback
const DEFAULT_RAIL_HUBS = [
  { name: 'Nilai KTM Station', lat: 2.802356, lon: 101.799303 },
  { name: 'Seremban KTM Station', lat: 2.719169, lon: 101.940792 },
  { name: 'Labu KTM Station', lat: 2.754501, lon: 101.826656 },
  { name: 'Tiroi KTM Station', lat: 2.741459, lon: 101.871914 },
  { name: 'Sungai Gadut KTM Station', lat: 2.660898, lon: 101.996158 },
  { name: 'Senawang KTM Station', lat: 2.690138, lon: 101.972336 },
  { name: 'Kajang KTM/MRT Station', lat: 2.9831, lon: 101.7901 },
  { name: 'Sungai Buloh Station', lat: 3.2064, lon: 101.5804 },
  { name: 'Port Klang KTM Station', lat: 2.9993, lon: 101.3918 },
  { name: 'Rawang KTM Station', lat: 3.3224, lon: 101.5779 },
];

// Estimates Malaysia public transit fares based on route leg distance & modes
function calculateEstimatedFare(legs) {
  let totalFare = 0;
  let hasTransit = false;
  
  legs.forEach(leg => {
    const distanceKm = leg.distance / 1000;
    if (leg.mode === 'BUS') {
      hasTransit = true;
      const routeName = leg.route?.shortName || '';
      if (routeName.startsWith('T') || routeName.startsWith('t')) {
        totalFare += 1.00; // Feeder Bus flat rate
      } else {
        totalFare += 1.50; // Trunk Line Bus flat rate
      }
    } else if (leg.mode === 'SUBWAY' || leg.mode === 'MONORAIL') {
      hasTransit = true;
      // LRT/MRT fare: base RM 1.20 + ~RM 0.18 per km
      const fare = 1.20 + distanceKm * 0.18;
      totalFare += Math.min(6.00, Math.max(1.20, fare));
    } else if (leg.mode === 'RAIL' || leg.mode === 'TRAM') {
      hasTransit = true;
      // KTM Komuter fare: base RM 1.50 + ~RM 0.12 per km
      const fare = 1.50 + distanceKm * 0.12;
      totalFare += Math.min(8.00, Math.max(1.50, fare));
    }
  });

  return hasTransit ? parseFloat(totalFare.toFixed(2)) : 0;
}

// React component to pan and fit Leaflet map dynamically based on selected locations and routes
function MapController({ selectedOrigin, selectedDest, allRouteCoords }) {
  const map = useMap();

  useEffect(() => {
    if (allRouteCoords && allRouteCoords.length > 0) {
      // If we have route polylines, fit the map to show the entire route
      map.fitBounds(allRouteCoords, { padding: [50, 50] });
    } else if (selectedOrigin && selectedDest) {
      // If we have both pins but no route yet, fit the map to contain both pins
      map.fitBounds([
        [selectedOrigin.lat, selectedOrigin.lon],
        [selectedDest.lat, selectedDest.lon]
      ], { padding: [100, 100] });
    } else if (selectedOrigin) {
      // If only origin is selected, center map on it
      map.setView([selectedOrigin.lat, selectedOrigin.lon], 15);
    } else if (selectedDest) {
      // If only destination is selected, center map on it
      map.setView([selectedDest.lat, selectedDest.lon], 15);
    }
  }, [selectedOrigin, selectedDest, allRouteCoords, map]);

  return null;
}

function App() {
  // Search inputs & Autocomplete state
  const [originQuery, setOriginQuery] = useState('');
  const [originResults, setOriginResults] = useState([]);
  const [selectedOrigin, setSelectedOrigin] = useState(null); // { name, lat, lon }
  const [isOriginFocused, setIsOriginFocused] = useState(false);

  const [destQuery, setDestQuery] = useState('');
  const [destResults, setDestResults] = useState([]);
  const [selectedDest, setSelectedDest] = useState(null); // { name, lat, lon }
  const [isDestFocused, setIsDestFocused] = useState(false);

  // GPS loading
  const [isGpsLoading, setIsGpsLoading] = useState(false);

  // Transportation mode selectors
  const [modes, setModes] = useState({
    bus: true,
    rail: true,     // KTM
    subway: true,   // LRT/MRT
  });

  const [primaryMode, setPrimaryMode] = useState('transit'); // 'transit', 'drive', 'walk', 'bicycle', 'mixed'

  // Routing Results state
  const [allItineraries, setAllItineraries] = useState({
    transit: [],
    drive: [],
    walk: [],
    bicycle: [],
    mixed: [],
  });
  const [selectedItineraryIdx, setSelectedItineraryIdx] = useState(0);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [railHubs, setRailHubs] = useState(DEFAULT_RAIL_HUBS);

  // Fetch rail hubs dynamically from OpenTripPlanner on startup
  useEffect(() => {
    const fetchRailHubs = async () => {
      try {
        const graphqlQuery = {
          query: `
            query {
              stops {
                name
                lat
                lon
                vehicleMode
              }
            }
          `
        };
        const response = await axios.post('http://localhost:8080/otp/routers/default/index/graphql', graphqlQuery);
        const stops = response.data?.data?.stops || [];
        // Filter for train modes: SUBWAY (LRT/MRT), TRAM (KTM Komuter), and RAIL (ETS/KTM ETS)
        const filteredHubs = stops
          .filter(stop => ['SUBWAY', 'TRAM', 'RAIL'].includes(stop.vehicleMode))
          .map(stop => ({
            name: stop.name,
            lat: parseFloat(stop.lat),
            lon: parseFloat(stop.lon)
          }));
        if (filteredHubs.length > 0) {
          setRailHubs(filteredHubs);
        }
      } catch (err) {
        console.error('Failed to fetch rail hubs dynamically from OTP, using default list:', err);
      }
    };
    fetchRailHubs();
  }, []);

  const itineraries = allItineraries[primaryMode] || [];

  // Active tracking simulation state
  const [isTracking, setIsTracking] = useState(false);
  const [simulatedVehiclePos, setSimulatedVehiclePos] = useState(null);
  const simIntervalRef = useRef(null);

  // Map Default Center (Kuala Lumpur Centre)
  const defaultCenter = [3.1390, 101.6869];
  const defaultZoom = 13;

  // Handle Geocoding Search via OpenStreetMap Nominatim restricted to Peninsular Malaysia
  const searchLocations = async (query, setResults) => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    try {
      // restricted to Peninsular Malaysia to prevent foreign results
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        query
      )}&viewbox=99.5,1.2,104.5,6.8&bounded=1&limit=5`;
      const res = await axios.get(url);
      setResults(res.data || []);
    } catch (err) {
      console.error('Error fetching geocoding results:', err);
    }
  };

  // Debouncing geocoding inputs
  useEffect(() => {
    const timer = setTimeout(() => {
      if (originQuery && !selectedOrigin) searchLocations(originQuery, setOriginResults);
    }, 400);
    return () => clearTimeout(timer);
  }, [originQuery, selectedOrigin]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (destQuery && !selectedDest) searchLocations(destQuery, setDestResults);
    }, 400);
    return () => clearTimeout(timer);
  }, [destQuery, selectedDest]);

  // Handle GPS Scanning
  const handleGpsScan = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setIsGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          // Reverse geocode
          const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`;
          const res = await axios.get(url);
          const name = res.data?.display_name || 'My Location';
          setSelectedOrigin({ name, lat: latitude, lon: longitude });
          setOriginQuery(name);
          setOriginResults([]);
        } catch (err) {
          console.error(err);
          setSelectedOrigin({ name: 'Current GPS Location', lat: latitude, lon: longitude });
          setOriginQuery('Current GPS Location');
        } finally {
          setIsGpsLoading(false);
        }
      },
      (error) => {
        console.error(error);
        alert('Failed to detect GPS location. Please type manually.');
        setIsGpsLoading(false);
      },
      { enableHighAccuracy: true }
    );
  };

  // Query OpenTripPlanner Routing API via GraphQL
  const findRoutes = async () => {
    if (!selectedOrigin || !selectedDest) {
      alert('Please choose both an origin and a destination.');
      return;
    }

    setIsLoadingRoutes(true);
    setErrorMessage('');
    setAllItineraries({
      transit: [],
      drive: [],
      walk: [],
      bicycle: [],
      mixed: [],
    });
    setIsTracking(false);
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);

    // Build transit modes
    const transitModes = [{ mode: 'WALK' }];
    if (modes.bus) transitModes.push({ mode: 'BUS' });
    if (modes.subway) {
      transitModes.push({ mode: 'SUBWAY' });
      transitModes.push({ mode: 'MONORAIL' });
    }
    if (modes.rail) {
      transitModes.push({ mode: 'RAIL' });
      transitModes.push({ mode: 'TRAM' }); // KTM Komuter is classified as TRAM in the graph
    }
    if (transitModes.length === 1) {
      transitModes.push({ mode: 'TRANSIT' });
    }

    // Build mixed modes
    const mixedModes = [{ mode: 'CAR', qualifier: 'PARK' }];
    if (modes.bus) mixedModes.push({ mode: 'BUS' });
    if (modes.subway) {
      mixedModes.push({ mode: 'SUBWAY' });
      mixedModes.push({ mode: 'MONORAIL' });
    }
    if (modes.rail) {
      mixedModes.push({ mode: 'RAIL' });
      mixedModes.push({ mode: 'TRAM' }); // KTM Komuter is TRAM
    }
    if (mixedModes.length === 1) {
      mixedModes.push({ mode: 'TRANSIT' });
    }

    // Determine the closest rail hub to the destination for egress driving mixed mode
    let hubLat = 0;
    let hubLon = 0;
    let closestHub = null;

    if (selectedDest) {
      let minDistance = Infinity;
      railHubs.forEach(hub => {
        const dist = getDistance(parseFloat(selectedDest.lat), parseFloat(selectedDest.lon), hub.lat, hub.lon);
        if (dist < minDistance) {
          minDistance = dist;
          closestHub = hub;
        }
      });
      if (closestHub) {
        hubLat = closestHub.lat;
        hubLon = closestHub.lon;
      }
    }

    const itinerarySelection = `
      itineraries {
        duration
        startTime
        endTime
        walkDistance
        numberOfTransfers
        legs {
          mode
          duration
          distance
          startTime
          endTime
          from {
            name
            lat
            lon
          }
          to {
            name
            lat
            lon
          }
          legGeometry {
            points
          }
          route {
            shortName
            longName
            color
          }
        }
      }
    `;

    const graphqlQuery = {
      query: `
        query RoutePlans(
          $fromLat: Float!,
          $fromLon: Float!,
          $toLat: Float!,
          $toLon: Float!,
          $hubLat: Float!,
          $hubLon: Float!,
          $transitModes: [TransportMode!],
          $mixedModes: [TransportMode!]
        ) {
          transit: plan(
            from: { lat: $fromLat, lon: $fromLon }
            to: { lat: $toLat, lon: $toLon }
            transportModes: $transitModes
            numItineraries: 5
          ) {
            ${itinerarySelection}
          }
          drive: plan(
            from: { lat: $fromLat, lon: $fromLon }
            to: { lat: $toLat, lon: $toLon }
            transportModes: [{ mode: CAR }]
            numItineraries: 5
          ) {
            ${itinerarySelection}
          }
          walk: plan(
            from: { lat: $fromLat, lon: $fromLon }
            to: { lat: $toLat, lon: $toLon }
            transportModes: [{ mode: WALK }]
            numItineraries: 5
          ) {
            ${itinerarySelection}
          }
          bicycle: plan(
            from: { lat: $fromLat, lon: $fromLon }
            to: { lat: $toLat, lon: $toLon }
            transportModes: [{ mode: BICYCLE }]
            numItineraries: 5
          ) {
            ${itinerarySelection}
          }
          mixedPark: plan(
            from: { lat: $fromLat, lon: $fromLon }
            to: { lat: $toLat, lon: $toLon }
            transportModes: $mixedModes
            numItineraries: 5
          ) {
            ${itinerarySelection}
          }
          egressTransit: plan(
            from: { lat: $fromLat, lon: $fromLon }
            to: { lat: $hubLat, lon: $hubLon }
            transportModes: $transitModes
            numItineraries: 3
          ) {
            ${itinerarySelection}
          }
          egressDrive: plan(
            from: { lat: $hubLat, lon: $hubLon }
            to: { lat: $toLat, lon: $toLon }
            transportModes: [{ mode: CAR }]
            numItineraries: 1
          ) {
            ${itinerarySelection}
          }
        }
      `,
      variables: {
        fromLat: parseFloat(selectedOrigin.lat),
        fromLon: parseFloat(selectedOrigin.lon),
        toLat: parseFloat(selectedDest.lat),
        toLon: parseFloat(selectedDest.lon),
        hubLat: hubLat,
        hubLon: hubLon,
        transitModes: transitModes,
        mixedModes: mixedModes,
      },
    };

    try {
      // Query our OTP engine running locally (exposing GraphQL endpoint)
      const response = await axios.post('http://localhost:8080/otp/routers/default/index/graphql', graphqlQuery);
      const data = response.data?.data;
      if (data) {
        // Construct combined egress transit + egress driving itineraries (Transit to Hub + Egress Car to Destination)
        const combinedEgressItineraries = [];
        const eTransit = data.egressTransit?.itineraries || [];
        const eDrive = data.egressDrive?.itineraries || [];
        
        if (eTransit.length > 0 && eDrive.length > 0 && closestHub) {
          eTransit.forEach((transitItinerary) => {
            const driveItinerary = eDrive[0];
            const driveLeg = driveItinerary.legs[0] || {
              mode: 'CAR',
              duration: driveItinerary.duration,
              distance: driveItinerary.duration * 13,
              startTime: transitItinerary.endTime,
              endTime: transitItinerary.endTime + driveItinerary.duration * 1000,
              from: { name: closestHub.name, lat: closestHub.lat, lon: closestHub.lon },
              to: { name: selectedDest.name, lat: parseFloat(selectedDest.lat), lon: parseFloat(selectedDest.lon) },
              legGeometry: { points: '' }
            };

            const updatedDriveLeg = {
              ...driveLeg,
              startTime: transitItinerary.endTime,
              endTime: transitItinerary.endTime + driveLeg.duration * 1000,
              from: { name: closestHub.name, lat: closestHub.lat, lon: closestHub.lon },
              to: { name: selectedDest.name, lat: parseFloat(selectedDest.lat), lon: parseFloat(selectedDest.lon) }
            };

            combinedEgressItineraries.push({
              duration: transitItinerary.duration + driveItinerary.duration,
              startTime: transitItinerary.startTime,
              endTime: transitItinerary.endTime + driveItinerary.duration * 1000,
              walkDistance: transitItinerary.walkDistance,
              numberOfTransfers: transitItinerary.numberOfTransfers + 1,
              legs: [...transitItinerary.legs, updatedDriveLeg]
            });
          });
        }

        const standardParkAndRide = data.mixedPark?.itineraries || [];
        const mixedItineraries = [...standardParkAndRide, ...combinedEgressItineraries];
        
        // Sort mixed itineraries by duration so the fastest route option is presented first
        mixedItineraries.sort((a, b) => a.duration - b.duration);

        setAllItineraries({
          transit: data.transit?.itineraries || [],
          drive: data.drive?.itineraries || [],
          walk: data.walk?.itineraries || [],
          bicycle: data.bicycle?.itineraries || [],
          mixed: mixedItineraries,
        });
        setSelectedItineraryIdx(0);
      } else {
        setErrorMessage('Failed to fetch routes. Please verify that coordinates are correct.');
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Could not connect to routing server. Please check that OpenTripPlanner is running.');
    } finally {
      setIsLoadingRoutes(false);
    }
  };

  // Automatically search routes when locations or routing modes/methods change
  useEffect(() => {
    if (selectedOrigin && selectedDest) {
      findRoutes();
    }
  }, [selectedOrigin, selectedDest, modes]);

  // Live Vehicle simulation along the selected route line
  useEffect(() => {
    if (isTracking && itineraries[selectedItineraryIdx]) {
      const activeItinerary = itineraries[selectedItineraryIdx];
      
      // Collect all coordinates along the route legs
      const transitCoordinates = activeItinerary.legs
        .flatMap(l => decodePolyline(l.legGeometry?.points));

      if (transitCoordinates.length > 0) {
        let index = 0;
        setSimulatedVehiclePos(transitCoordinates[0]);

        simIntervalRef.current = setInterval(() => {
          index = (index + 1) % transitCoordinates.length;
          setSimulatedVehiclePos(transitCoordinates[index]);
        }, 1500);
      }
    } else {
      setSimulatedVehiclePos(null);
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    }

    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, [isTracking, selectedItineraryIdx, itineraries]);

  // Decode the selected itinerary lines for Leaflet map polylines
  const activeItinerary = itineraries[selectedItineraryIdx];
  const mapPolylines = activeItinerary
    ? activeItinerary.legs.map((leg) => {
        const coords = decodePolyline(leg.legGeometry?.points);
        let color = '#6b7280'; // Walk (grey)
        let dashArray = '5, 5';
        
        if (leg.mode === 'BUS') {
          color = '#f97316'; // Bus (orange)
          dashArray = '';
        } else if (leg.mode === 'SUBWAY' || leg.mode === 'MONORAIL') {
          color = '#3b82f6'; // LRT/MRT (blue)
          dashArray = '';
        } else if (leg.mode === 'RAIL' || leg.mode === 'TRAM') {
          color = '#10b981'; // KTM (green)
          dashArray = '';
        } else if (leg.mode === 'CAR') {
          color = '#8b5cf6'; // Drive (purple)
          dashArray = '';
        } else if (leg.mode === 'BICYCLE') {
          color = '#eab308'; // Cycle (yellow)
          dashArray = '';
        }
        
        return { coords, color, dashArray, mode: leg.mode, routeName: leg.route?.shortName || '' };
      })
    : [];

  const allRouteCoords = mapPolylines.flatMap((p) => p.coords);

  const handleTabClick = (mode) => {
    setPrimaryMode(mode);
    setSelectedItineraryIdx(0);
    setIsTracking(false);
  };

  const formatTabDuration = (mode) => {
    const itinerariesForMode = allItineraries[mode];
    if (!itinerariesForMode || itinerariesForMode.length === 0) {
      return '';
    }
    const durationMin = Math.round(itinerariesForMode[0].duration / 60);
    if (durationMin < 60) {
      return `${durationMin} min`;
    }
    const hrs = Math.floor(durationMin / 60);
    const mins = durationMin % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  };

  const getTrackingEmoji = () => {
    if (primaryMode === 'drive') return '🚗';
    if (primaryMode === 'walk') return '🚶‍♂️';
    if (primaryMode === 'bicycle') return '🚴‍♂️';
    
    if (activeItinerary) {
      const nonWalkLeg = activeItinerary.legs.find(l => l.mode !== 'WALK');
      if (nonWalkLeg) {
        if (nonWalkLeg.mode === 'BUS') return '🚌';
        if (nonWalkLeg.mode === 'SUBWAY' || nonWalkLeg.mode === 'MONORAIL') return '🚇';
        if (nonWalkLeg.mode === 'RAIL' || nonWalkLeg.mode === 'TRAM') return '🚆';
        if (nonWalkLeg.mode === 'CAR') return '🚗';
      }
    }
    return '🚌';
  };

  const getErrorMessage = () => {
    if (errorMessage) return errorMessage;
    if (selectedOrigin && selectedDest && itineraries.length === 0 && !isLoadingRoutes) {
      switch (primaryMode) {
        case 'transit':
          return 'No public transit routes found between these locations.';
        case 'drive':
          return 'No driving routes found between these locations.';
        case 'walk':
          return 'No walking routes found between these locations.';
        case 'bicycle':
          return 'No cycling routes found between these locations.';
        case 'mixed':
          return 'No mixed (Park & Ride) routes found between these locations.';
        default:
          return 'No routes found.';
      }
    }
    return '';
  };

  return (
    <div className="relative flex flex-col md:flex-row h-screen w-screen bg-slate-900 text-slate-100 overflow-hidden font-['Outfit',sans-serif]">
      {/* Sidebar Controls Panel */}
      <aside className="w-full md:w-[420px] bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col z-30 relative">
        {/* App Title Header */}
        <header className="p-5 pb-3 flex items-center justify-between border-b border-slate-850">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="LaluanKU Logo" className="w-9 h-9 rounded-lg shadow-md object-cover" />
            <div>
              <h1 className="text-xl font-bold text-white">LaluanKU</h1>
              <p className="text-xs text-slate-500 font-light">Moovit Alternative for Malaysia</p>
            </div>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            KL/Selangor
          </span>
        </header>

        {/* Primary Mode Selector Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/20">
          <button
            onClick={() => handleTabClick('transit')}
            className={`flex-1 py-3 text-[10px] font-semibold text-center border-b-2 transition cursor-pointer ${
              primaryMode === 'transit'
                ? 'border-blue-500 text-blue-400 font-bold bg-slate-850/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <div>🚇 Transit</div>
            {formatTabDuration('transit') ? (
              <span className="text-[9px] text-slate-400 block mt-0.5 font-normal">
                {formatTabDuration('transit')}
              </span>
            ) : (selectedOrigin && selectedDest && !isLoadingRoutes) ? (
              <span className="text-[9px] text-slate-600 block mt-0.5 font-normal">N/A</span>
            ) : null}
          </button>
          <button
            onClick={() => handleTabClick('drive')}
            className={`flex-1 py-3 text-[10px] font-semibold text-center border-b-2 transition cursor-pointer ${
              primaryMode === 'drive'
                ? 'border-blue-500 text-blue-400 font-bold bg-slate-850/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <div>🚗 Drive</div>
            {formatTabDuration('drive') ? (
              <span className="text-[9px] text-slate-400 block mt-0.5 font-normal">
                {formatTabDuration('drive')}
              </span>
            ) : (selectedOrigin && selectedDest && !isLoadingRoutes) ? (
              <span className="text-[9px] text-slate-600 block mt-0.5 font-normal">N/A</span>
            ) : null}
          </button>
          <button
            onClick={() => handleTabClick('walk')}
            className={`flex-1 py-3 text-[10px] font-semibold text-center border-b-2 transition cursor-pointer ${
              primaryMode === 'walk'
                ? 'border-blue-500 text-blue-400 font-bold bg-slate-850/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <div>🚶‍♂️ Walk</div>
            {formatTabDuration('walk') ? (
              <span className="text-[9px] text-slate-400 block mt-0.5 font-normal">
                {formatTabDuration('walk')}
              </span>
            ) : (selectedOrigin && selectedDest && !isLoadingRoutes) ? (
              <span className="text-[9px] text-slate-600 block mt-0.5 font-normal">N/A</span>
            ) : null}
          </button>
          <button
            onClick={() => handleTabClick('bicycle')}
            className={`flex-1 py-3 text-[10px] font-semibold text-center border-b-2 transition cursor-pointer ${
              primaryMode === 'bicycle'
                ? 'border-blue-500 text-blue-400 font-bold bg-slate-850/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <div>🚴‍♂️ Cycle</div>
            {formatTabDuration('bicycle') ? (
              <span className="text-[9px] text-slate-400 block mt-0.5 font-normal">
                {formatTabDuration('bicycle')}
              </span>
            ) : (selectedOrigin && selectedDest && !isLoadingRoutes) ? (
              <span className="text-[9px] text-slate-600 block mt-0.5 font-normal">N/A</span>
            ) : null}
          </button>
          <button
            onClick={() => handleTabClick('mixed')}
            className={`flex-1 py-3 text-[10px] font-semibold text-center border-b-2 transition cursor-pointer ${
              primaryMode === 'mixed'
                ? 'border-blue-500 text-blue-400 font-bold bg-slate-850/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <div>🚗🚇 Mixed</div>
            {formatTabDuration('mixed') ? (
              <span className="text-[9px] text-slate-400 block mt-0.5 font-normal">
                {formatTabDuration('mixed')}
              </span>
            ) : (selectedOrigin && selectedDest && !isLoadingRoutes) ? (
              <span className="text-[9px] text-slate-600 block mt-0.5 font-normal">N/A</span>
            ) : null}
          </button>
        </div>

        {/* Input Form Panel */}
        <section className="p-5 space-y-4 border-b border-slate-850">
          {/* Origin Input */}
          <div className="relative">
            <label id="origin-label" className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1.5">Starting From</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Enter starting location..."
                  value={originQuery}
                  onChange={(e) => {
                    setOriginQuery(e.target.value);
                    setSelectedOrigin(null);
                  }}
                  onFocus={() => setIsOriginFocused(true)}
                  onBlur={() => setTimeout(() => setIsOriginFocused(false), 200)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition"
                />
                {originQuery && !selectedOrigin && (
                  <button
                    onClick={() => {
                      setOriginQuery('');
                      setSelectedOrigin(null);
                    }}
                    className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleGpsScan}
                disabled={isGpsLoading}
                className="px-3.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-900 transition flex items-center justify-center"
                title="Detect location with GPS"
              >
                {isGpsLoading ? (
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>

            {/* Origin Autocomplete Dropdown */}
            {isOriginFocused && originResults.length > 0 && (
              <ul className="absolute left-0 right-0 mt-1 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl max-h-52 overflow-y-auto z-50">
                {originResults.map((item, idx) => (
                  <li key={idx}>
                    <button
                      type="button"
                      onMouseDown={() => {
                        setSelectedOrigin({ name: item.display_name, lat: parseFloat(item.lat), lon: parseFloat(item.lon) });
                        setOriginQuery(item.display_name);
                        setOriginResults([]);
                      }}
                      className="w-full text-left px-4 py-3 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition border-b border-slate-850 last:border-b-0 truncate"
                    >
                      📍 {item.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Destination Input */}
          <div className="relative">
            <label id="dest-label" className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1.5">Destination</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Enter destination..."
                value={destQuery}
                onChange={(e) => {
                  setDestQuery(e.target.value);
                  setSelectedDest(null);
                }}
                onFocus={() => setIsDestFocused(true)}
                onBlur={() => setTimeout(() => setIsDestFocused(false), 200)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition"
              />
              {destQuery && !selectedDest && (
                <button
                  onClick={() => {
                    setDestQuery('');
                    setSelectedDest(null);
                  }}
                  className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Destination Autocomplete Dropdown */}
            {isDestFocused && destResults.length > 0 && (
              <ul className="absolute left-0 right-0 mt-1 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl max-h-52 overflow-y-auto z-50">
                {destResults.map((item, idx) => (
                  <li key={idx}>
                    <button
                      type="button"
                      onMouseDown={() => {
                        setSelectedDest({ name: item.display_name, lat: parseFloat(item.lat), lon: parseFloat(item.lon) });
                        setDestQuery(item.display_name);
                        setDestResults([]);
                      }}
                      className="w-full text-left px-4 py-3 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition border-b border-slate-850 last:border-b-0 truncate"
                    >
                      🏁 {item.display_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Transit Mode Filters */}
          {(primaryMode === 'transit' || primaryMode === 'mixed') && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">Include Transit Modes</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setModes({ ...modes, subway: !modes.subway })}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                    modes.subway
                      ? 'bg-blue-600/15 border-blue-500/30 text-blue-400'
                      : 'bg-slate-950 border-slate-800 text-slate-500 hover:bg-slate-900'
                  }`}
                >
                  🚇 LRT / MRT
                </button>
                <button
                  type="button"
                  onClick={() => setModes({ ...modes, rail: !modes.rail })}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                    modes.rail
                      ? 'bg-emerald-600/15 border-emerald-500/30 text-emerald-400'
                      : 'bg-slate-950 border-slate-800 text-slate-500 hover:bg-slate-900'
                  }`}
                >
                  🚊 KTM
                </button>
                <button
                  type="button"
                  onClick={() => setModes({ ...modes, bus: !modes.bus })}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                    modes.bus
                      ? 'bg-orange-600/15 border-orange-500/30 text-orange-400'
                      : 'bg-slate-950 border-slate-800 text-slate-500 hover:bg-slate-900'
                  }`}
                >
                  🚌 Bus
                </button>
              </div>
            </div>
          )}

          {/* Search Button */}
          <button
            type="button"
            onClick={findRoutes}
            disabled={isLoadingRoutes}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98"
          >
            {isLoadingRoutes ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Calculating Routes...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Find Routes
              </>
            )}
          </button>
        </section>

        {/* Results Lists Panel */}
        <section className="flex-1 overflow-y-auto p-5 space-y-4">
          {getErrorMessage() && (
            <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/20 text-red-400 text-sm">
              ⚠️ {getErrorMessage()}
            </div>
          )}

          {itineraries.length > 0 && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-3">Suggested Itineraries</span>
              <div className="space-y-3">
                {itineraries.map((itinerary, index) => {
                  const fare = calculateEstimatedFare(itinerary.legs);
                  const isSelected = selectedItineraryIdx === index;
                  
                  return (
                    <div
                      key={index}
                      onClick={() => {
                        setSelectedItineraryIdx(index);
                        setIsTracking(false);
                      }}
                      className={`p-4 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-slate-850 border-blue-500 shadow-md'
                          : 'bg-slate-950 border-slate-850 hover:bg-slate-850 hover:border-slate-800'
                      }`}
                    >
                      {/* Top row: Time and cost */}
                      <div className="flex justify-between items-start mb-2.5">
                        <div>
                          <span className="text-lg font-bold text-white">
                            {Math.round(itinerary.duration / 60)} min
                          </span>
                          <span className="text-xs text-slate-400 ml-2">
                            {new Date(itinerary.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(itinerary.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <span className="px-2.5 py-1 rounded-lg bg-blue-600/15 text-blue-400 border border-blue-500/20 text-xs font-semibold">
                          {fare > 0 ? `RM ${fare.toFixed(2)}` : 'FREE / Walk'}
                        </span>
                      </div>

                      {/* Timeline Summary Line of Modes */}
                      <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
                        {itinerary.legs.map((leg, legIdx) => (
                          <React.Fragment key={legIdx}>
                            {legIdx > 0 && <span className="text-slate-600 text-xs">➔</span>}
                            <div className="flex items-center gap-1 bg-slate-950 border border-slate-850 py-1 px-2 rounded-lg text-xs">
                              {leg.mode === 'WALK' ? (
                                <span className="text-slate-400" title="Walk">🚶‍♂️ {Math.round(leg.duration / 60)}m</span>
                              ) : leg.mode === 'BUS' ? (
                                <span className="text-orange-400 font-bold" title="Bus">🚌 {leg.route?.shortName || 'Bus'}</span>
                              ) : leg.mode === 'SUBWAY' || leg.mode === 'MONORAIL' ? (
                                <span className="text-blue-400 font-bold" title="LRT/MRT">🚇 {leg.route?.shortName || 'MRT'}</span>
                              ) : leg.mode === 'RAIL' || leg.mode === 'TRAM' ? (
                                <span className="text-emerald-400 font-bold" title="KTM">🚊 {leg.route?.shortName || 'KTM'}</span>
                              ) : leg.mode === 'CAR' ? (
                                <span className="text-purple-400 font-bold" title="Drive">🚗 Drive</span>
                              ) : leg.mode === 'BICYCLE' ? (
                                <span className="text-yellow-400 font-bold" title="Cycle">🚴‍♂️ Cycle</span>
                              ) : (
                                <span>{leg.mode}</span>
                              )}
                            </div>
                          </React.Fragment>
                        ))}
                      </div>

                      {/* Expand details for selected */}
                      {isSelected && (
                        <div className="mt-4 pt-4 border-t border-slate-750 space-y-3 text-xs animate-fadeIn">
                          {/* Live Track Action */}
                          <div className="flex items-center justify-between pb-2 border-b border-slate-750">
                            <span className="text-slate-400 font-medium">Live Ride Assistant</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsTracking(!isTracking);
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                                isTracking
                                  ? 'bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse'
                                  : 'bg-blue-600 hover:bg-blue-500 text-white'
                              }`}
                            >
                              {isTracking ? '✕ Stop Assist' : '⚡ Start Track'}
                            </button>
                          </div>

                          {/* Stop list detail timeline */}
                          <div className="space-y-4 relative pl-4 border-l border-slate-800 ml-1.5">
                            {itinerary.legs.map((leg, legIdx) => (
                              <div key={legIdx} className="relative">
                                {/* Dot Indicator */}
                                <div className={`absolute left-[-21px] top-1 w-2.5 h-2.5 rounded-full border-2 ${
                                  leg.mode === 'WALK' ? 'bg-slate-400 border-slate-900' :
                                  leg.mode === 'BUS' ? 'bg-orange-500 border-slate-900' :
                                  leg.mode === 'SUBWAY' || leg.mode === 'MONORAIL' ? 'bg-blue-500 border-slate-900' :
                                  (leg.mode === 'RAIL' || leg.mode === 'TRAM') ? 'bg-emerald-500 border-slate-900' :
                                  leg.mode === 'CAR' ? 'bg-purple-500 border-slate-900' :
                                  leg.mode === 'BICYCLE' ? 'bg-yellow-500 border-slate-900' :
                                  'bg-slate-500 border-slate-900'
                                }`} />

                                <div className="space-y-1">
                                  <div className="flex justify-between font-semibold">
                                    <span className="text-slate-200">
                                      {leg.mode === 'WALK' ? 'Walk' :
                                       leg.mode === 'CAR' ? 'Drive' :
                                       leg.mode === 'BICYCLE' ? 'Cycle' :
                                       (leg.mode === 'RAIL' || leg.mode === 'TRAM') ? `KTM ${leg.route?.shortName || ''}` :
                                       `${leg.mode} ${leg.route?.shortName || ''}`}
                                    </span>
                                    <span className="text-slate-400">{Math.round(leg.duration / 60)} min</span>
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    From: <span className="text-slate-300 font-medium">{leg.from.name}</span>
                                  </div>
                                  {leg.route?.longName && (
                                    <div className="text-[10px] text-slate-500 italic">
                                      {leg.route.longName}
                                    </div>
                                  )}
                                  <div className="text-[11px] text-slate-400">
                                    To: <span className="text-slate-300 font-medium">{leg.to.name}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </aside>

      {/* Main Full-Screen Map Panel */}
      <main className="flex-1 h-[40vh] md:h-full relative z-10">
        <MapContainer
          center={defaultCenter}
          zoom={defaultZoom}
          className="h-full w-full"
          zoomControl={false} // Disable to position in custom top-right layout
        >
          {/* Custom zoom buttons placement */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            // Dark map styling overlay using Leaflet tiles filter
            className="map-tiles-dark"
          />

          {/* User Origin Marker */}
          {selectedOrigin && (
            <Marker position={[selectedOrigin.lat, selectedOrigin.lon]}>
              <Popup>
                <div className="text-xs font-semibold">📍 Starting Point: {selectedOrigin.name}</div>
              </Popup>
            </Marker>
          )}

          {/* User Destination Marker */}
          {selectedDest && (
            <Marker position={[selectedDest.lat, selectedDest.lon]}>
              <Popup>
                <div className="text-xs font-semibold">🏁 Destination: {selectedDest.name}</div>
              </Popup>
            </Marker>
          )}

          {/* Render Route Leg Polylines */}
          {mapPolylines.map((polyline, idx) => (
            <Polyline
              key={idx}
              positions={polyline.coords}
              pathOptions={{
                color: polyline.color,
                weight: polyline.mode === 'WALK' ? 4 : 6,
                dashArray: polyline.dashArray,
                opacity: 0.8,
              }}
            >
              <Popup>
                <div className="text-xs font-semibold uppercase">{polyline.mode} {polyline.routeName}</div>
              </Popup>
            </Polyline>
          ))}

          {/* Render Transit Stop Markers for the selected route */}
          {activeItinerary && activeItinerary.legs.map((leg, legIdx) => {
            if (leg.mode === 'WALK' || leg.mode === 'CAR' || leg.mode === 'BICYCLE') return null;
            return (
              <React.Fragment key={legIdx}>
                <Marker
                  position={[leg.from.lat, leg.from.lon]}
                  icon={L.divIcon({
                    className: 'custom-stop-icon border-2 border-slate-900 bg-white rounded-full w-3.5 h-3.5 shadow-md',
                    iconSize: [14, 14],
                  })}
                >
                  <Popup>
                    <div className="text-xs font-semibold">🚉 {leg.from.name}</div>
                  </Popup>
                </Marker>
                <Marker
                  position={[leg.to.lat, leg.to.lon]}
                  icon={L.divIcon({
                    className: 'custom-stop-icon border-2 border-slate-900 bg-white rounded-full w-3.5 h-3.5 shadow-md',
                    iconSize: [14, 14],
                  })}
                >
                  <Popup>
                    <div className="text-xs font-semibold">🚉 {leg.to.name}</div>
                  </Popup>
                </Marker>
              </React.Fragment>
            );
          })}

          {/* Render Live Vehicle Simulation Position */}
          {simulatedVehiclePos && (
            <Marker
              position={simulatedVehiclePos}
              icon={L.divIcon({
                className: 'animate-ping-slow flex items-center justify-center bg-blue-600 rounded-full w-7 h-7 border border-white text-xs text-white font-bold shadow-lg',
                html: getTrackingEmoji(),
                iconSize: [28, 28],
                iconAnchor: [14, 14]
              })}
            >
              <Popup>
                <div className="text-xs font-semibold">⚡ Active Vehicle Tracker</div>
                <div className="text-[10px] text-slate-500">Tracking bus/train live location</div>
              </Popup>
            </Marker>
          )}

          {/* Automatically focuses/auto-pans the map contextually */}
          <MapController selectedOrigin={selectedOrigin} selectedDest={selectedDest} allRouteCoords={allRouteCoords} />
        </MapContainer>
      </main>
    </div>
  );
}

export default App;
