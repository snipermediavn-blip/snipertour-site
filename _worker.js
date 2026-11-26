// Cloudflare Pages（advanced mode，_worker.js 不會被當成網頁檔案公開）：公開賽事頁 https://snipertour.com/t/<賽事ID>（負責人 2026-11-25：分享出去一定要有圖、不能回 404）
//
// 為什麼要伺服器端：Zalo、Facebook、Messenger 抓預覽卡片時不執行 JavaScript，而且看到 404 常常不顯示卡片。
// 所以這裡先向資料庫讀這場賽事，直接回 200 和這場的 Open Graph（名稱、時間、地點、封面圖＋圖片寬高）。
// 頁面內容照舊由 /t/tournament.js 畫；伺服器把讀到的資料放在 <script type="application/json">，網頁不用再讀一次。
//
// - 用公開金鑰（publishable）讀，權限由資料庫 RLS 控制：草稿讀不到 = 找不到（回 404，但一樣有分享圖）
// - 所有文字都經過 HTML 跳脫；封面只接受本專案 Storage 的網址
// - 只處理 /t 和 /t/<UUID>（_routes.json 只把這些送進來），其他一律交給靜態檔案
// - 選用：環境變數 OG_IMAGE_TRANSFORM = "1"（網域在 Cloudflare、開了 Images Transformations）時，
//   預覽圖經 /cdn-cgi/image 轉成 1200×630 JPEG（檔案小、每個 App 都收）；沒開就用原圖並讀出寬高

const SUPABASE_URL = 'https://zcvtqzjgmhsstbyzvuyo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_avakZ2zeH7B5qfeaGYctCQ_Hkps52Lm'; // 公開金鑰（publishable），不是密鑰
const SITE = 'https://snipertour.com';
const DEFAULT_IMAGE = { url: SITE + '/brand/cover.png', w: 1600, h: 900, type: 'image/png' };
const TZ = 'Asia/Ho_Chi_Minh';
const COLUMNS = 'id,name,discipline,format,race_to,status,max_players,entry_fee,registration_closes_at,starts_at,' +
  'prize_total,prize_list,cover_url,location_name,location_address,venue:venues(name,address),registrations(count)';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISCIPLINE = { '8ball': '8 bi', '9ball': '9 bi', '10ball': '10 bi' };

export default {
  async fetch(request, env) {
    try {
      return await handle({ request, env, next: () => env.ASSETS.fetch(request) });
    } catch (_) {
      return env.ASSETS.fetch(request);
    }
  },
};

async function handle(context) {
  const { request } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') return context.next();
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/t(?:\/([^/]*))?\/?$/);
  if (!m) return context.next();
  const seg = m[1] || '';
  if (seg && !UUID.test(seg)) {
    // tournament.js、tournament.css 等靜態檔案
    if (seg.includes('.')) return context.next();
    return page(context, null, 404, url);
  }
  if (!seg) return page(context, null, 200, url); // /t：沒有指定賽事（App 的「查看其他賽事」）

  const id = seg.toLowerCase();
  let t = null;
  try {
    const api = SUPABASE_URL + '/rest/v1/tournaments?select=' + encodeURIComponent(COLUMNS) +
      '&id=eq.' + id + '&status=neq.draft&limit=1';
    const res = await fetch(api, {
      headers: { apikey: SUPABASE_KEY, Accept: 'application/json' },
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return page(context, null, 404, url);
    t = rows[0];
  } catch (_) {
    // 資料庫暫時讀不到：照樣回 200、通用分享圖，網頁自己再讀一次
    return page(context, null, 200, url);
  }
  return page(context, t, 200, url);
}

async function page(context, t, status, url) {
  const { env } = context;
  const html = await template(context);
  const canonical = SITE + url.pathname.replace(/\/$/, '');
  let title = 'Giải đấu bida trên Sniper Billiards';
  let desc = 'Xem thông tin giải đấu và đăng ký trong ứng dụng Sniper Billiards.';
  let docTitle = 'Giải đấu bida · Sniper Billiards';
  let image = DEFAULT_IMAGE;
  if (status === 404) {
    docTitle = 'Không tìm thấy giải đấu · Sniper Billiards';
  }
  if (t) {
    title = t.name;
    docTitle = t.name + ' · Sniper Billiards';
    desc = describe(t);
    image = await ogImage(t.cover_url, env);
  }

  const meta = [
    `<title>${esc(docTitle)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Sniper Billiards">`,
    `<meta property="og:locale" content="vi_VN">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:image" content="${esc(image.url)}">`,
    `<meta property="og:image:secure_url" content="${esc(image.url)}">`,
    image.type ? `<meta property="og:image:type" content="${esc(image.type)}">` : '',
    image.w ? `<meta property="og:image:width" content="${image.w}">` : '',
    image.h ? `<meta property="og:image:height" content="${image.h}">` : '',
    `<meta property="og:image:alt" content="${esc(title)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(image.url)}">`,
  ].filter(Boolean).join('\n  ');

  // 把 404.html 裡固定的 <title>、description、og:*、twitter:* 換成這場的
  let out = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(?:name|property)="(?:description|og:[^"]*|twitter:[^"]*)"[^>]*>\s*/gi, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    // 用函式取代：賽事名稱裡有 $&、$` 這種字也不會被當成特殊替換符號（安全檢查 2026-11-26）
    .replace('</head>', () => '  ' + meta + '\n</head>');
  // 讀到的資料直接交給網頁（type=application/json 不會執行，CSP 不受影響）；< 跳脫避免提早結束標籤
  const data = t ? { ok: true, tournament: t } : (status === 404 ? { ok: false, notFound: true } : null);
  if (data) {
    const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    out = out.replace('<script src="/t/tournament.js">', () => `<script type="application/json" id="t-data">${json}</script>\n  <script src="/t/tournament.js">`);
  }

  return new Response(context.request.method === 'HEAD' ? null : out, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 報名人數、狀態會變：瀏覽器 1 分鐘、Cloudflare 邊緣 1 分鐘
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

// 404.html 就是賽事頁的外框（和 GitHub Pages 時期同一份）
let templateCache = null;
async function template(context) {
  if (templateCache) return templateCache;
  const res = await context.env.ASSETS.fetch(new URL('/404.html', context.request.url));
  templateCache = await res.text();
  return templateCache;
}

function describe(t) {
  const parts = [];
  if (t.starts_at) parts.push(when(t.starts_at));
  const place = t.location_name || (t.venue && t.venue.name);
  if (place) parts.push(place);
  parts.push([DISCIPLINE[t.discipline] || t.discipline, 'chạm ' + t.race_to].join(' · '));
  if (t.prize_total > 0) parts.push('Tổng giải ' + money(t.prize_total));
  const closed = t.registration_closes_at && new Date(t.registration_closes_at) <= new Date();
  if (t.status === 'registration' && !closed) parts.push('Đang nhận đăng ký');
  else if (t.status === 'in_progress') parts.push('Đang thi đấu');
  else if (t.status === 'completed') parts.push('Đã kết thúc');
  else if (t.status === 'cancelled') parts.push('Đã hủy');
  else if (closed) parts.push('Đã hết hạn đăng ký');
  return parts.join(' — ');
}

function when(iso) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return time + ' ' + date;
}

function money(n) { return new Intl.NumberFormat('vi-VN').format(n) + ' đ'; }

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 預覽圖：有封面用封面，沒有或讀不到用品牌分享圖。一定附寬高（Facebook 第一次分享沒有寬高常常不顯示圖）
async function ogImage(coverUrl, env) {
  if (typeof coverUrl !== 'string' || !coverUrl.startsWith(SUPABASE_URL + '/storage/v1/object/public/')) return DEFAULT_IMAGE;
  if (env && env.OG_IMAGE_TRANSFORM === '1') {
    return { url: SITE + '/cdn-cgi/image/width=1200,height=630,fit=cover,quality=82,format=jpeg/' + coverUrl, w: 1200, h: 630, type: 'image/jpeg' };
  }
  try {
    const res = await fetch(coverUrl, { headers: { Range: 'bytes=0-65535' }, cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!res.ok && res.status !== 206) return DEFAULT_IMAGE;
    const buf = new Uint8Array(await res.arrayBuffer());
    const size = imageSize(buf);
    if (!size || size.w < 200 || size.h < 200) return DEFAULT_IMAGE;
    return { url: coverUrl, w: size.w, h: size.h, type: size.type };
  } catch (_) {
    return DEFAULT_IMAGE;
  }
}

// 從檔案開頭讀出 JPEG／PNG／WebP 的寬高
function imageSize(b) {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { w: be32(b, 16), h: be32(b, 20), type: 'image/png' };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xff) { i++; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], type: 'image/jpeg' };
      }
      i += 2 + len;
    }
    return null;
  }
  if (b.length >= 30 && str(b, 0, 4) === 'RIFF' && str(b, 8, 4) === 'WEBP') {
    const kind = str(b, 12, 4);
    if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), type: 'image/webp' };
    if (kind === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff, type: 'image/webp' };
    if (kind === 'VP8L') {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, type: 'image/webp' };
    }
  }
  return null;
}

function be32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
function str(b, i, n) { return String.fromCharCode(...b.slice(i, i + n)); }
