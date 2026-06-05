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
      const geo = await jsonFetch(`${GEO_BASE}?name=${encodeURIComponent(label)}&count=1`);
      const hit = Array.isArray(geo?.results) ? geo.results[0] : null;
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
      + `&hourly=temperature_2m`
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
      high: typeof fc.daily.temperature_2m_max?.[i] === 'number' ? Math.round(fc.daily.temperature_2m_max[i]) : undefined,
      low: typeof fc.daily.temperature_2m_min?.[i] === 'number' ? Math.round(fc.daily.temperature_2m_min[i]) : undefined,
      code: typeof code === 'number' ? code : undefined,
      ...wmo(code),
    });
  }

  // Next ~24h of hourly temps, starting near "now".
  const hourly: WeatherHourly[] = [];
  const hTime: string[] = fc?.hourly?.time || [];
  const nowMs = Date.now();
  let startIdx = hTime.findIndex((t) => new Date(t).getTime() >= nowMs);
  if (startIdx < 0) startIdx = 0;
  for (let i = startIdx; i < Math.min(startIdx + 24, hTime.length); i += 3) {
    const t = new Date(hTime[i]);
    const hr = t.getHours();
    hourly.push({
      time: `${((hr + 11) % 12) + 1}${hr < 12 ? 'am' : 'pm'}`,
      temp: typeof fc.hourly.temperature_2m?.[i] === 'number' ? Math.round(fc.hourly.temperature_2m[i]) : undefined,
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
