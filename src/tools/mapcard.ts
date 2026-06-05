// src/tools/mapcard.ts
// Builds the `map` rich artifact. Keyless: markers may carry lat/lng directly,
// or an address that is geocoded via OpenStreetMap Nominatim (best-effort).

import type { MapArtifact, MapMarker } from '../gateway/rich-artifacts';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

interface MapArgs {
  markers?: any[];
  center?: { lat?: number; lng?: number };
  zoom?: number;
  title?: string;
}

interface MapResult {
  success: boolean;
  stdout?: string;
  error?: string;
  data?: any;
  extra?: { richArtifacts: any[] };
}

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(`${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1`, {
      headers: { 'User-Agent': 'Prometheus/1.0 (rich-artifact map card)', accept: 'application/json' },
    });
    if (!res.ok) return null;
    const arr = await res.json();
    const hit = Array.isArray(arr) ? arr[0] : null;
    if (!hit) return null;
    return { lat: Number(hit.lat), lng: Number(hit.lon) };
  } catch {
    return null;
  }
}

export async function executeMapLookup(args: MapArgs): Promise<MapResult> {
  const raw = Array.isArray(args.markers) ? args.markers : [];
  if (!raw.length) return { success: false, error: 'show_map requires markers[] (each with lat/lng or an address).' };

  const markers: MapMarker[] = [];
  for (const m of raw.slice(0, 20)) {
    if (!m || typeof m !== 'object') continue;
    let lat = Number(m.lat ?? m.latitude);
    let lng = Number(m.lng ?? m.lon ?? m.longitude);
    const label = String(m.label || m.name || '').trim() || 'Location';
    const address = m.address ? String(m.address) : undefined;
    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && address) {
      const g = await geocode(`${label} ${address}`.trim() || address);
      if (g) { lat = g.lat; lng = g.lng; }
    }
    markers.push({
      label,
      address,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      url: m.url ? String(m.url) : (m.websiteUrl ? String(m.websiteUrl) : undefined),
      category: m.category ? String(m.category) : undefined,
      rating: Number.isFinite(Number(m.rating)) ? Number(m.rating) : undefined,
      id: m.id ? String(m.id) : undefined,
    });
  }

  const located = markers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
  let center = args.center && Number.isFinite(Number(args.center.lat)) && Number.isFinite(Number(args.center.lng))
    ? { lat: Number(args.center.lat), lng: Number(args.center.lng) }
    : undefined;
  if (!center && located.length) {
    center = {
      lat: located.reduce((s, m) => s + (m.lat as number), 0) / located.length,
      lng: located.reduce((s, m) => s + (m.lng as number), 0) / located.length,
    };
  }
  if (!center) {
    return { success: false, error: 'Could not resolve any marker coordinates (provide lat/lng or geocodable addresses).' };
  }

  const artifact: MapArtifact = {
    id: `map-${Date.now()}`,
    type: 'map',
    title: args.title ? String(args.title) : undefined,
    center,
    zoom: Number.isFinite(Number(args.zoom)) ? Number(args.zoom) : undefined,
    markers,
  };

  return {
    success: true,
    stdout: `Map ready — ${located.length}/${markers.length} marker(s) located near ${center.lat.toFixed(3)}, ${center.lng.toFixed(3)}.`,
    data: { center, markerCount: markers.length, locatedCount: located.length },
    extra: { richArtifacts: [artifact] },
  };
}
