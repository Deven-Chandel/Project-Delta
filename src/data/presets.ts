import type { Place } from '../core/types';

type Seed = Omit<Place, 'id'>;

/** The 28 places from the original Canada Time Board (v1), now with coordinates. */
export const CANADA: Seed[] = [
  { name: 'Prince George', region: 'BC', lat: 53.917, lon: -122.749, tz: 'America/Vancouver' },
  { name: 'Kelowna', region: 'BC', lat: 49.888, lon: -119.496, tz: 'America/Vancouver' },
  { name: 'Victoria', region: 'BC', lat: 48.428, lon: -123.366, tz: 'America/Vancouver' },
  { name: 'Kamloops', region: 'BC', lat: 50.674, lon: -120.327, tz: 'America/Vancouver' },
  { name: 'Vancouver', region: 'BC', lat: 49.283, lon: -123.121, tz: 'America/Vancouver' },
  { name: 'Regina', region: 'SK', lat: 50.445, lon: -104.619, tz: 'America/Regina' },
  { name: 'Saskatoon', region: 'SK', lat: 52.133, lon: -106.67, tz: 'America/Regina' },
  { name: 'Halifax', region: 'NS', lat: 44.649, lon: -63.575, tz: 'America/Halifax' },
  { name: 'Sydney', region: 'NS', lat: 46.137, lon: -60.194, tz: 'America/Halifax' },
  { name: 'Charlottetown', region: 'PE', lat: 46.238, lon: -63.131, tz: 'America/Halifax' },
  { name: 'Whitehorse', region: 'YT', lat: 60.721, lon: -135.057, tz: 'America/Whitehorse' },
  { name: 'Winnipeg', region: 'MB', lat: 49.895, lon: -97.138, tz: 'America/Winnipeg' },
  { name: 'Toronto', region: 'ON', lat: 43.653, lon: -79.383, tz: 'America/Toronto' },
  { name: 'Windsor', region: 'ON', lat: 42.315, lon: -83.036, tz: 'America/Toronto' },
  { name: 'Thunder Bay', region: 'ON', lat: 48.381, lon: -89.247, tz: 'America/Thunder_Bay' },
  { name: 'Hamilton', region: 'ON', lat: 43.256, lon: -79.871, tz: 'America/Toronto' },
  { name: 'Kitchener', region: 'ON', lat: 43.452, lon: -80.492, tz: 'America/Toronto' },
  { name: 'London', region: 'ON', lat: 42.984, lon: -81.246, tz: 'America/Toronto' },
  { name: 'Sudbury', region: 'ON', lat: 46.522, lon: -80.953, tz: 'America/Toronto' },
  { name: 'Calgary', region: 'AB', lat: 51.045, lon: -114.072, tz: 'America/Edmonton' },
  { name: 'Edmonton', region: 'AB', lat: 53.546, lon: -113.494, tz: 'America/Edmonton' },
  { name: 'Yellowknife', region: 'NT', lat: 62.454, lon: -114.372, tz: 'America/Yellowknife' },
  { name: 'Moncton', region: 'NB', lat: 46.087, lon: -64.778, tz: 'America/Moncton' },
  { name: 'Fredericton', region: 'NB', lat: 45.964, lon: -66.643, tz: 'America/Moncton' },
  { name: 'Iqaluit', region: 'NU', lat: 63.749, lon: -68.522, tz: 'America/Iqaluit' },
  { name: "St. John's", region: 'NL', lat: 47.562, lon: -52.713, tz: 'America/St_Johns' },
  { name: 'Corner Brook', region: 'NL', lat: 48.951, lon: -57.952, tz: 'America/St_Johns' },
  { name: 'Goose Bay', region: 'NL', lat: 53.302, lon: -60.326, tz: 'America/Goose_Bay' },
];

/** A second demo showing the board outside Canada, including a half-hour zone. */
export const GLOBAL_TEAM: Seed[] = [
  { name: 'San Francisco', region: 'US', lat: 37.775, lon: -122.419, tz: 'America/Los_Angeles' },
  { name: 'New York', region: 'US', lat: 40.713, lon: -74.006, tz: 'America/New_York' },
  { name: 'São Paulo', region: 'BR', lat: -23.551, lon: -46.633, tz: 'America/Sao_Paulo' },
  { name: 'London', region: 'GB', lat: 51.507, lon: -0.128, tz: 'Europe/London' },
  { name: 'Berlin', region: 'DE', lat: 52.52, lon: 13.405, tz: 'Europe/Berlin' },
  { name: 'Nairobi', region: 'KE', lat: -1.292, lon: 36.822, tz: 'Africa/Nairobi' },
  { name: 'Bengaluru', region: 'IN', lat: 12.972, lon: 77.595, tz: 'Asia/Kolkata' },
  { name: 'Singapore', region: 'SG', lat: 1.352, lon: 103.82, tz: 'Asia/Singapore' },
  { name: 'Tokyo', region: 'JP', lat: 35.676, lon: 139.65, tz: 'Asia/Tokyo' },
  { name: 'Sydney', region: 'AU', lat: -33.869, lon: 151.209, tz: 'Australia/Sydney' },
];
