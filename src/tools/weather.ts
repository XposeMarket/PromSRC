// src/tools/weather.ts
// Open-Meteo-backed forecast for the `weather` rich artifact. Free, no API key.

import type { WeatherArtifact, WeatherDaily, WeatherHourly } from '../gateway/rich-artifacts';

const GEO_BASE = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';

// WMO weather interpretation codes → { icon, condition }.
const WMO: Record<number, { icon: string; condition: string }> = {
  0: { icon: '☀️', condition: 'Clear sky' },
  1: { icon: '🌤️', condition: 'Mainly clear' },
  2: { icon: '⛅', condition: 'Partly cloudy' },
  3: { icon: '☁️', condition: 'Overcast' },
  45: { icon: '🌫️', condition: 'Fog' },
  48: { icon: '🌫️', condition: 'Rime fog' },
  51: { icon: '🌦️', condition: 'Light drizzle' },
  53: { icon: '🌦️', condition: 'Drizzle' },
  55: { icon: '🌧️', condition: 'Dense drizzle' },
  61: { icon: '🌦️', condition: 'Light rain' },
  63: { icon: '🌧️', condition: 'Rain' },
  65: { icon: '🌧️', condition: 'Heavy rain' },
  66: { icon: '🌧️', condition: 'Freezing rain' },
  67: { icon: '🌧️', condition: 'Freezing rain' },
  71: { icon: '🌨️', condition: 'Light snow' },
  73: { icon: '🌨️', condition: 'Snow' },
  75: { icon: '❄️', condition: 'Heavy snow' },
  77: { icon: '🌨️', condition: 'Snow grains' },
  80: { icon: '🌦️', condition: 'Rain showers' },
  81: { icon: '🌧️', condition: 'Rain showers' },
  82: { icon: '⛈️', condition: 'Violent showers' },
  85: { icon: '🌨️', condition: 'Snow showers' },
  86: { icon: '❄️', condition: 'Snow showers' },
  95: { icon: '⛈️', condition: 'Thunderstorm' },
  96: { icon: '⛈️', condition: 'Thunderstorm + hail' },
  99: { icon: '⛈️', condition: 'Thunderstorm + hail' },
};

function wmo(code: any): { icon: string; condition: string } {
  const c = Number(code);
  return WMO[c] || { icon: '🌡️', condition: '—' };
}

interface WeatherArgs {
  location?: string;
  latitude?: number;
  longitude?: number;
  unit?: string;
  days?: number;
}

interface WeatherResult {
  success: boolean;
  stdout?: string;
  error?: string;
  data?: any;
  extra?: { richArtifacts: any[] };
}

async function jsonFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Open-Meteo geocoding does not understand US state abbreviations ("Frederick, MD"
// returns no results while "Frederick, Maryland" works). Expand them before lookup.
const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};

/**
 * Build geocoding query candidates for a free-form location label.
 * "Frederick, MD" -> ["Frederick, Maryland", "Frederick, MD", "Frederick"]; other labels
 * pass through, with the bare city as a fallback when the API rejects a compound label.
 */
export function geocodeQueryCandidates(label: string): string[] {
  const trimmed = label.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  if (parts.length >= 2) {
    const stateName = US_STATE_NAMES[parts[1].toUpperCase()];
    if (stateName) out.push(`${parts[0]}, ${stateName}`);
  }
  out.push(trimmed);
  if (parts.length >= 2 && parts[0]) out.push(parts[0]);
  return Array.from(new Set(out));
}

async function geocodeLabel(label: string): Promise<any | null> {
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean);
  const wantedState = parts.length >= 2 ? (US_STATE_NAMES[parts[1].toUpperCase()] || parts[1]) : '';
  for (const candidate of geocodeQueryCandidates(label)) {
    const geo = await jsonFetch(`${GEO_BASE}?name=${encodeURIComponent(candidate)}&count=5`);
    const results = Array.isArray(geo?.results) ? geo.results : [];
    if (!results.length) continue;
    // Prefer a hit in the requested state so "Frederick, MD" does not resolve to
    // Frederick, Colorado just because it ranked first in the bare-city fallback.
    const preferred = wantedState
      ? results.find((r: any) => String(r?.admin1 || '').toLowerCase() === wantedState.toLowerCase())
      : null;
    return preferred || results[0];
  }
  return null;
}


export async function executeWeatherLookup(args: WeatherArgs): Promise<WeatherResult> {
  const unitF = String(args.unit || 'F').toUpperCase() !== 'C';
  const tempUnit = unitF ? 'fahrenheit' : 'celsius';
  const days = Math.min(Math.max(Number(args.days) || 10, 1), 16);

  let lat = Number(args.latitude);
  let lon = Number(args.longitude);
  let label = String(args.location || '').trim();

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    if (!label) return { success: false, error: 'show_weather requires a location (e.g. "Frederick, MD") or latitude/longitude.' };
    try {
      const hit = await geocodeLabel(label);
      if (!hit) return { success: false, error: `Could not find location: ${label}` };
      lat = hit.latitude; lon = hit.longitude;
      label = [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', ');
    } catch (err: any) {
      return { success: false, error: `Geocoding failed: ${err?.message || err}` };
    }
  }

  let fc: any;
  try {
    const url = `${FORECAST_BASE}?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,weather_code`
      + `&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code`
      + `&daily=weather_code,temperature_2m_max,temperature_2m_min`
      + `&temperature_unit=${tempUnit}&forecast_days=${days}&timezone=auto`;
    fc = await jsonFetch(url);
  } catch (err: any) {
    return { success: false, error: `Forecast request failed: ${err?.message || err}` };
  }

  const curCode = fc?.current?.weather_code;
  const current = {
    temp: typeof fc?.current?.temperature_2m === 'number' ? Math.round(fc.current.temperature_2m) : undefined,
    code: typeof curCode === 'number' ? curCode : undefined,
    ...wmo(curCode),
  };

  const daily: WeatherDaily[] = [];
  const dTime: string[] = fc?.daily?.time || [];
  for (let i = 0; i < dTime.length; i++) {
    const d = new Date(dTime[i] + 'T12:00:00');
    const code = fc.daily.weather_code?.[i];
    daily.push({
      day: i === 0 ? 'Today' : WEEKDAYS[d.getDay()],
      date: dTime[i],
      high: typeof fc.daily.temperature_2m_max?.[i] === 'number' ? Math.round(fc.daily.temperature_2m_max[i]) : undefined,
      low: typeof fc.daily.temperature_2m_min?.[i] === 'number' ? Math.round(fc.daily.temperature_2m_min[i]) : undefined,
      code: typeof code === 'number' ? code : undefined,
      ...wmo(code),
    });
  }

  // Keep a true hourly forecast for every returned day. The card groups these
  // records under the selected daily tab; past hours today are omitted.
  const hourly: WeatherHourly[] = [];
  const hTime: string[] = fc?.hourly?.time || [];
  const nowMs = Date.now();
  for (let i = 0; i < hTime.length; i += 1) {
    const t = new Date(hTime[i]);
    if (t.getTime() < nowMs) continue;
    const hr = t.getHours();
    const code = fc.hourly.weather_code?.[i];
    hourly.push({
      date: hTime[i].slice(0, 10),
      time: `${((hr + 11) % 12) + 1}${hr < 12 ? 'am' : 'pm'}`,
      temp: typeof fc.hourly.temperature_2m?.[i] === 'number' ? Math.round(fc.hourly.temperature_2m[i]) : undefined,
      feelsLike: typeof fc.hourly.apparent_temperature?.[i] === 'number' ? Math.round(fc.hourly.apparent_temperature[i]) : undefined,
      precipitationProbability: typeof fc.hourly.precipitation_probability?.[i] === 'number' ? Math.round(fc.hourly.precipitation_probability[i]) : undefined,
      code: typeof code === 'number' ? code : undefined,
      ...wmo(code),
    });
  }

  const artifact: WeatherArtifact = {
    id: `weather-${Date.now()}`,
    type: 'weather',
    location: label || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
    unit: unitF ? 'F' : 'C',
    current,
    daily,
    hourly,
  };

  const stdout = `Weather for ${artifact.location}: ${current.temp != null ? `${current.temp}°${unitF ? 'F' : 'C'}` : '?'}, ${current.condition}. `
    + daily.slice(0, 5).map((d) => `${d.day} ${d.high}/${d.low}`).join(', ');

  return {
    success: true,
    stdout,
    data: { location: artifact.location, latitude: lat, longitude: lon, current, daily },
    extra: { richArtifacts: [artifact] },
  };
}
