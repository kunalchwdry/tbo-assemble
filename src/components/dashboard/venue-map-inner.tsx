"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  ZoomControl,
} from "react-leaflet";
import {
  MapPin,
  X,
  Maximize2,
  Navigation,
  ExternalLink,
  Loader2,
  Compass,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// Helper component to fix Leaflet size calculations on mount / resize / modal animation
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [map]);
  return null;
}

// Helper component to re-center map if coordinates change
function MapRecenter({
  center,
  zoom,
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: true });
  }, [center, zoom, map]);
  return null;
}

// Custom vector SVG pin icons that avoid any Webpack/Next.js asset-bundling issues
function getVenueIcon() {
  return L.divIcon({
    className: "venue-interactive-pin",
    html: `
      <div style="position: relative; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;">
        <span style="position: absolute; width: 38px; height: 38px; border-radius: 9999px; background: rgba(37, 99, 235, 0.28); animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>
        <div style="position: relative; width: 34px; height: 34px; border-radius: 9999px 9999px 9999px 0; transform: rotate(-45deg); background: linear-gradient(135deg, #2563eb, #1d4ed8); border: 2.5px solid white; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center;">
          <svg style="transform: rotate(45deg); width: 17px; height: 17px; color: white;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
        </div>
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -38],
  });
}

function getMiniPinIcon() {
  return L.divIcon({
    className: "mini-venue-pin",
    html: `
      <div style="width: 20px; height: 20px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: #2563eb; border: 2px solid white; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35); display: flex; align-items: center; justify-content: center;">
        <div style="transform: rotate(45deg); width: 6px; height: 6px; border-radius: 50%; background: white;"></div>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 20],
  });
}

export interface VenueMapProps {
  venue: string;
  location: string;
  initialLat?: number | null;
  initialLng?: number | null;
}

export default function VenueMap({
  venue,
  location,
  initialLat,
  initialLng,
}: VenueMapProps) {
  const hasInitialCoords = initialLat != null && initialLng != null;
  const [geocodedCoords, setGeocodedCoords] = useState<[number, number] | null>(null);
  // Provenance from /api/geocode: approximate coordinates are labelled, unresolved places get no pin.
  const [geoInfo, setGeoInfo] = useState<{ approximate: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(!hasInitialCoords);
  const [modalOpen, setModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const coords = useMemo<[number, number] | null>(() => {
    return hasInitialCoords ? [initialLat, initialLng] : geocodedCoords;
  }, [hasInitialCoords, initialLat, initialLng, geocodedCoords]);

  // Fetch coordinates using Nominatim API route if not provided
  useEffect(() => {
    if (hasInitialCoords) return;

    let isMounted = true;
    async function geocode() {
      try {
        const query = `${venue}, ${location}`;
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
        const data = await res.json().catch(() => null);
        if (!isMounted || !data) return;
        if (res.ok && typeof data.lat === "number" && typeof data.lng === "number") {
          setGeocodedCoords([data.lat, data.lng]);
          setGeoInfo({ approximate: data.approximate !== false, message: typeof data.message === "string" ? data.message : "" });
        } else {
          setGeoInfo({ approximate: true, message: typeof data.message === "string" ? data.message : "Location not found." });
        }
      } catch (err) {
        console.error("Geocoding error:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    geocode();
    return () => {
      isMounted = false;
    };
  }, [venue, location, hasInitialCoords]);

  // Handle ESC key to close modal
  useEffect(() => {
    if (!modalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen]);

  const venueIcon = useMemo(() => getVenueIcon(), []);
  const miniIcon = useMemo(() => getMiniPinIcon(), []);

  // Google Maps directions URL
  const directionsUrl = useMemo(() => {
    const dest = coords ? `${coords[0]},${coords[1]}` : encodeURIComponent(`${venue}, ${location}`);
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  }, [coords, venue, location]);

  // OpenStreetMap direct page URL
  const osmUrl = useMemo(() => {
    if (!coords) return `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${venue}, ${location}`)}`;
    return `https://www.openstreetmap.org/?mlat=${coords[0]}&mlon=${coords[1]}#map=16/${coords[0]}/${coords[1]}`;
  }, [coords, venue, location]);

  // No default city: an unknown venue gets no pin. Approximate matches are zoomed out and labelled.
  const approximate = !hasInitialCoords && geoInfo?.approximate === true;
  const miniZoom = approximate ? 11 : 13;
  const modalZoom = approximate ? 12 : 15;
  const notFoundMessage = geoInfo?.message || "Location not found.";

  return (
    <>
      {/* 1. Compact, rounded mini-map preview card (180px wide x 64px high) */}
      <div
        onClick={() => setModalOpen(true)}
        className="group relative h-[64px] w-[180px] shrink-0 cursor-pointer overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-all duration-200 hover:border-primary/50 hover:shadow-md select-none"
        title="Click to expand interactive map"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setModalOpen(true);
          }
        }}
      >
        {loading ? (
          <div className="flex h-full w-full items-center justify-center gap-1.5 bg-muted/50 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>Finding venue...</span>
          </div>
        ) : !coords ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-muted/50 px-2 text-center text-[10px] text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate w-full">Location not found</span>
          </div>
        ) : (
          <div className="relative h-full w-full pointer-events-none">
            <MapContainer
              center={coords}
              zoom={miniZoom}
              zoomControl={false}
              dragging={false}
              scrollWheelZoom={false}
              doubleClickZoom={false}
              touchZoom={false}
              attributionControl={false}
              className="h-full w-full z-0"
            >
              <TileLayer
                url="/api/tiles/{z}/{x}/{y}.png"
                maxZoom={19}
              />
              <Marker position={coords} icon={miniIcon} />
              <MapResizer />
              <MapRecenter center={coords} zoom={miniZoom} />
            </MapContainer>

            {/* Subtle bottom gradient label showing venue pin indicator */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2 py-0.5 pointer-events-none">
              <p className="truncate text-[10px] font-medium text-white flex items-center gap-1">
                <MapPin className="h-2.5 w-2.5 text-blue-400 shrink-0" />
                <span className="truncate">{approximate ? `≈ ${venue}` : venue}</span>
              </p>
            </div>
          </div>
        )}

        {/* Hover overlay badge: "Expand Map" */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[1px] opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-10">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-900 shadow-sm dark:bg-neutral-900/95 dark:text-neutral-100">
            <Maximize2 className="h-3 w-3 text-primary" />
            Expand Map
          </span>
        </div>
      </div>

      {/* 2. Full-featured Modal / Dialog displaying large interactive OpenStreetMap */}
      {modalOpen && mounted && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setModalOpen(false)}
          />

          {/* Modal Container */}
          <div className="relative z-[10000] flex flex-col w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-border bg-surface px-5 py-4">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                    <Compass className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-foreground truncate">
                      {venue}
                    </h2>
                    <p className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                      <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="truncate">{location}</span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {approximate && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" title={geoInfo?.message}>
                    Approximate location
                  </span>
                )}
                {coords && (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-mono text-muted-foreground">
                    {coords[0].toFixed(4)}°, {coords[1].toFixed(4)}°
                  </span>
                )}
                <button
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Close map (Esc)"
                  aria-label="Close map"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Interactive Leaflet Map Content */}
            <div className="relative h-[420px] sm:h-[480px] w-full bg-muted/40">
              {!coords ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                  <MapPin className="h-6 w-6 text-muted-foreground" />
                  <p className="font-medium text-foreground">{loading ? "Finding venue..." : notFoundMessage}</p>
                  <p className="text-xs">No pin is shown rather than a guessed location. Use OpenStreetMap search below.</p>
                </div>
              ) : (
              <MapContainer
                center={coords}
                zoom={modalZoom}
                zoomControl={false}
                scrollWheelZoom={true}
                className="h-full w-full z-0"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
                  url="/api/tiles/{z}/{x}/{y}.png"
                  maxZoom={19}
                />
                <ZoomControl position="bottomright" />
                <Marker position={coords} icon={venueIcon}>
                  <Popup autoPan={true} offset={[0, -28]}>
                    <div className="p-1 min-w-[200px]">
                      <h4 className="font-bold text-sm text-gray-900 leading-tight">
                        {venue}
                      </h4>
                      <p className="text-xs text-gray-600 mt-1 leading-normal">
                        {location}
                      </p>
                      {approximate && (
                        <p className="text-[11px] text-amber-700 mt-1 leading-normal">{geoInfo?.message}</p>
                      )}
                      <p className="text-[10px] text-gray-400 font-mono mt-1">
                        {coords[0].toFixed(5)}, {coords[1].toFixed(5)}
                      </p>
                      <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between">
                        <a
                          href={directionsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
                        >
                          <Navigation className="h-3 w-3" /> Get Directions
                        </a>
                      </div>
                    </div>
                  </Popup>
                </Marker>
                <MapResizer />
                <MapRecenter center={coords} zoom={modalZoom} />
              </MapContainer>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <a
                  href={osmUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View on OpenStreetMap
                </a>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  asChild
                  className="gap-1.5"
                >
                  <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    Get Directions
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setModalOpen(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
