// Minimal client for the Wikimedia Commons API used by the dataset scripts.

const API_URL = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'grid-intensity-classifier-dataset/0.1 (educational image dataset script)';
const FREE_LICENSE = /^(cc0|public domain|pd\b|pdm|cc[- ]by(?:-sa)?[- ]\d)/i;
const MAX_RATE_LIMIT_WAITS = 24;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(url, { attempts = 7, baseDelayMs = 2000 } = {}) {
  let lastError;
  let failures = 0;
  let rateLimitWaits = 0;
  while (failures < attempts && rateLimitWaits < MAX_RATE_LIMIT_WAITS) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (response.ok) return response;
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = (retryAfter > 0 ? retryAfter * 1000 : 60000) + 5000;
        await response.body?.cancel();
        lastError = new Error('HTTP 429');
        rateLimitWaits++;
        console.log(`rate limited, waiting ${Math.round(waitMs / 1000)} s`);
        await sleep(waitMs);
        continue;
      }
      if (response.status < 500) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { fatal: true });
      }
      await response.body?.cancel();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (error.fatal) throw error;
      lastError = error;
    }
    await sleep(baseDelayMs * 2 ** failures);
    failures++;
  }
  throw Object.assign(lastError, { transient: true });
}

export async function queryApi(params) {
  const query = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetchWithRetry(`${API_URL}?${query}`);
    const json = await response.json();
    if (json.error?.code === 'maxlag' || json.error?.code === 'cirrussearch-too-busy-error') {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (json.error) throw new Error(`Commons API: ${json.error.code}`);
    return json;
  }
  throw new Error('Commons API stayed lagged');
}

const stripHtml = (value = '') =>
  value.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export function isFreeLicense(name) {
  return FREE_LICENSE.test(name ?? '');
}

export function parseFilePage(page) {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  return {
    title: page.title,
    width: info.width,
    height: info.height,
    bytes: info.size,
    sha1: info.sha1,
    url: info.url,
    thumbUrl: info.thumburl,
    pageUrl: info.descriptionurl,
    license: meta.LicenseShortName?.value ?? '',
    licenseUrl: meta.LicenseUrl?.value ?? '',
    author: stripHtml(meta.Artist?.value) || 'unknown',
  };
}

export async function searchFiles(search, { offset = 0, limit = 50, thumbWidth = 320 } = {}) {
  const json = await queryApi({
    action: 'query',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: String(limit),
    gsroffset: String(offset),
    gsrsearch: search,
    prop: 'imageinfo',
    iiprop: 'url|size|sha1|extmetadata',
    iiurlwidth: String(thumbWidth),
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
  });
  const pages = (json.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return {
    files: pages.map(parseFilePage).filter(Boolean),
    nextOffset: json.continue?.gsroffset ?? null,
  };
}
