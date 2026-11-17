'use client';

import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import { ArrowUpRight, Compass, MapPin } from 'lucide-react';
import type { PlanRow } from '@/lib/procurement';
import 'leaflet/dist/leaflet.css';

// Deliberately limited, approximate area centroids. Do not silently geocode unknown names.
const CENTROIDS: Record<string, [number, number]> = {
  goa: [15.40, 73.82], dubai: [25.20, 55.27], bali: [-8.41, 115.19],
  jaipur: [26.91, 75.79], singapore: [1.35, 103.82], kerala: [9.55, 76.55], bangkok: [13.76, 100.50],
};
const cash = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
type Group = { name: string; rows: PlanRow[]; position: [number, number] | null; spend: number; profit: number };

function FitMarkers({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map(p => p.join(',')).join('|');
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (map.getContainer().clientWidth && map.getContainer().clientHeight) map.invalidateSize(); });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  useEffect(() => {
    map.invalidateSize();
    if (points.length === 1) map.setView(points[0], 5);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 5, animate: false });
    else map.setView([18, 83], 3);
    // The coordinate key intentionally tracks point changes, not reference identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

function FocusMarker({ group }: { group: Group | undefined }) {
  const map = useMap();
  const position = group?.position;
  useEffect(() => { if (position) map.panTo(position, { animate: false }); }, [map, position]);
  return null;
}

export default function InventoryDestinationMap({ rows, source }: { rows: PlanRow[]; source: 'synthetic' | 'imported' }) {
  const [tileError, setTileError] = useState(false);
  const groups = useMemo(() => {
    const byName = new Map<string, Group>();
    for (const row of rows) {
      const key = row.destination.trim().toLocaleLowerCase('en');
      let group = byName.get(key);
      if (!group) {
        group = { name: row.destination.trim() || 'Unspecified', rows: [], position: Object.hasOwn(CENTROIDS, key) ? CENTROIDS[key] : null, spend: 0, profit: 0 };
        byName.set(key, group);
      }
      group.rows.push(row); group.spend += row.spend; group.profit += row.expectedProfit;
    }
    return [...byName.values()].sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
  }, [rows]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected = groups.find(g => g.name === selectedName) ?? groups[0];
  const mapped = groups.filter(g => g.position);
  const unmapped = groups.filter(g => !g.position);
  const points = mapped.map(g => g.position!);
  return <div className="destination-explorer">
    <div className="destination-intro"><div><span className="destination-kicker"><Compass size={14}/> DESTINATION EXPLORER</span><h3>See where your plan goes.</h3><p>Pick a destination to inspect the current modeled allocation.</p></div><span className="destination-source">{source === 'synthetic' ? 'SYNTHETIC INPUTS' : 'CURRENT INPUTS'}</span></div>
    <div className="destination-layout">
      <div className="destination-map-frame">
        <MapContainer className="destination-map" center={[18, 83]} zoom={3} scrollWheelZoom={false} aria-label="Map of approximate destinations">
          <TileLayer eventHandlers={{ tileerror: () => setTileError(true) }} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
          <FitMarkers points={points}/>
          {selectedName && <FocusMarker group={selected?.name === selectedName ? selected : undefined}/>}
          {mapped.map(g => <Marker key={g.name} position={g.position!} title={`${g.name}: ${g.rows.length} opportunities`} alt={`${g.name}: ${g.rows.length} opportunities`} icon={L.divIcon({ className: 'destination-pin-wrap', html: `<span class="destination-pin${g.name === selected?.name ? ' active' : ''}">${g.rows.length}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] })} eventHandlers={{ click: () => setSelectedName(g.name) }}/>) }
        </MapContainer>
        <span className="map-label"><MapPin size={13}/> APPROXIMATE AREAS</span>{tileError && <div className="map-error" role="status">Some map tiles could not load. Use the destination list to explore your plan.</div>}
      </div>
      <div className="destination-side">
        <div className="destination-side-head"><div><span>EXPLORE BY DESTINATION</span><strong>{groups.length} {groups.length === 1 ? 'destination' : 'destinations'}</strong></div><span className="destination-side-icon"><MapPin size={17}/></span></div>
        {groups.length > 0 ? <><div className="destination-list" aria-label="Choose a destination">{groups.slice(0,100).map(g => <button key={g.name} type="button" aria-pressed={selected?.name === g.name} onClick={() => setSelectedName(g.name)}><span className="destination-list-dot"/><span className="destination-list-name">{g.name}<small>{g.rows.length} {g.rows.length === 1 ? 'opportunity' : 'opportunities'}{!g.position ? ' · not mapped' : ''}</small></span><strong>{cash(g.spend)}</strong></button>)}</div>{groups.length > 100 && <p className="destination-note">Showing 100 destinations. Use the list view to see all opportunities.</p>}
        {selected && <div className="destination-selected" aria-live="polite"><span className="destination-selected-kicker">SELECTED DESTINATION</span><h4>{selected.name}</h4><div className="destination-stats"><div><small>ALLOCATED</small><strong>{cash(selected.spend)}</strong></div><div><small>EST. PROFIT</small><strong>{cash(selected.profit)}</strong></div></div><div className="destination-products">{selected.rows.slice(0,4).map(r => <div key={r.id}><span>{r.name}<small>{r.kind} · {r.period}</small></span><b>{r.qty} units</b></div>)}{selected.rows.length > 4 && <p>+ {selected.rows.length - 4} more in list view</p>}</div></div>}</> : <p className="destination-empty">No opportunities match your filters. Change the type or period to explore.</p>}
      </div>
    </div>
    <div className="destination-foot"><span>Markers are approximate area centers, not supplier locations. {unmapped.length ? `${unmapped.length} ${unmapped.length === 1 ? 'destination is' : 'destinations are'} not mapped; select them in the list.` : 'Flight pins show destinations, not routes.'} Figures are modeled, not quotes.</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Map data <ArrowUpRight size={13}/></a></div>
    <p className="destination-privacy">Map tiles load from OpenStreetMap when this view is opened; your browser connects to its servers.</p>
  </div>;
}
