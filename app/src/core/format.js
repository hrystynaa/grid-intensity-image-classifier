const BYTE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
const numberFormat = new Intl.NumberFormat('uk-UA');
const pad = (value) => String(value).padStart(2, '0');
const decimal = (value, digits) => value.toFixed(digits).replace('.', ',');

export const formatNumber = (value) => numberFormat.format(value);

export function pluralUk(count, one, few, many) {
  const tens = Math.abs(count) % 100;
  const units = tens % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}

export const formatImages = (count) =>
  `${formatNumber(count)} ${pluralUk(count, 'зображення', 'зображення', 'зображень')}`;
export const formatFiles = (count) => `${formatNumber(count)} ${pluralUk(count, 'файл', 'файли', 'файлів')}`;

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${decimal(value, digits)} ${BYTE_UNITS[unit]}`;
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 999.5) return `${Math.round(ms)} мс`;
  if (ms < 59950) return `${decimal(ms / 1000, 1)} с`;
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours} год ${pad(minutes)} хв` : `${minutes} хв ${pad(total % 60)} с`;
}

export const formatPercent = (fraction, digits = 1) =>
  Number.isFinite(fraction) ? `${decimal(fraction * 100, digits)}%` : '—';

export const formatMetric = (value) =>
  Number.isFinite(value) ? String(Number(value.toPrecision(3))).replace('.', ',') : '—';

export function formatClock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDateTime(date) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${formatClock(date)}`;
}

export function formatAspectRatio(width, height) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  const w = width / divisor;
  const h = height / divisor;
  return w <= 32 && h <= 32 ? `${w}:${h}` : `${decimal(width / height, 2)}:1`;
}
