// 公開賽事頁 https://snipertour.com/t/<賽事ID>（GitHub Pages 用 404.html 回這一頁，由這支程式畫內容）
// - 不用登入：用公開金鑰（publishable，不是密鑰）讀資料，權限由資料庫 RLS 控制（草稿讀不到 = 找不到）
// - 只讀公開欄位；所有文字用 textContent 放進去，不用 innerHTML
// - 網頁不能報名：主按鈕打開 App 的賽事詳情（沒裝 App 去 Google Play）
'use strict';
(function () {
  const SUPABASE_URL = 'https://zcvtqzjgmhsstbyzvuyo.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_avakZ2zeH7B5qfeaGYctCQ_Hkps52Lm'; // 公開金鑰（publishable），不是密鑰
  const PACKAGE = 'com.sniperbilliards.sniper_billiards';
  const STORE_URL = 'https://play.google.com/store/apps/details?id=' + PACKAGE;
  const SITE = 'snipertour.com';
  const TZ = 'Asia/Ho_Chi_Minh';
  const COLUMNS = 'id,name,discipline,format,race_to,status,max_players,entry_fee,registration_closes_at,starts_at,' +
    'prize_total,cover_url,location_name,location_address,venue:venues(name,address),registrations(count)';

  const DISCIPLINE = { '8ball': '8 bi', '9ball': '9 bi', '10ball': '10 bi' };
  const FORMAT = { double_elim: 'Loại kép', single_elim: 'Loại trực tiếp' };

  const app = document.getElementById('app');
  const isAndroid = /Android/i.test(navigator.userAgent);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // App 裡的路徑：Android 用 intent://（裝了就開 App，沒裝去商店）；其他裝置直接去商店
  function appLink(path) {
    if (!isAndroid) return STORE_URL;
    return 'intent://' + SITE + path + '#Intent;scheme=https;package=' + PACKAGE +
      ';S.browser_fallback_url=' + encodeURIComponent(STORE_URL) + ';end';
  }

  function money(n) { return new Intl.NumberFormat('vi-VN').format(n) + ' đ'; }

  function when(iso) {
    if (!iso) return 'Chưa xác định';
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    return time + ' · ' + date;
  }

  function bottomBar(label, href, secondary) {
    const bar = el('div', 'bar');
    const inner = el('div', 'bar-in');
    const btn = el('a', 'btn' + (secondary ? ' secondary' : ''), label);
    btn.href = href;
    btn.id = 'main-action';
    inner.appendChild(btn);
    const store = el('a', 'store', 'Chưa có ứng dụng? Tải Sniper Billiards trên Google Play');
    store.href = STORE_URL;
    store.rel = 'noopener';
    inner.appendChild(store);
    bar.appendChild(inner);
    return bar;
  }

  function notFound() {
    document.title = 'Không tìm thấy giải đấu · Sniper Billiards';
    app.replaceChildren();
    const box = el('div', 'empty');
    box.id = 'not-found';
    box.appendChild(el('h1', null, 'Không tìm thấy giải đấu'));
    box.appendChild(el('p', null, 'Giải đấu này không tồn tại hoặc chưa được công khai.'));
    app.appendChild(box);
    app.appendChild(bottomBar('Xem giải đấu khác', appLink('/t'), true));
  }

  function failed() {
    app.replaceChildren();
    const box = el('div', 'empty');
    box.id = 'load-failed';
    box.appendChild(el('h1', null, 'Không tải được giải đấu'));
    box.appendChild(el('p', null, 'Vui lòng kiểm tra kết nối mạng và thử lại.'));
    const retry = el('a', 'btn', 'Thử lại');
    retry.href = location.href;
    box.appendChild(retry);
    app.appendChild(box);
  }

  // 狀態標籤：報名中（還沒截止）／已截止／比賽中／已結束／已取消
  function statusOf(t) {
    const closed = t.registration_closes_at && new Date(t.registration_closes_at) <= new Date();
    switch (t.status) {
      case 'registration': return closed ? { text: 'Đã hết hạn đăng ký', cls: 'closed', open: false }
        : { text: 'Đang nhận đăng ký', cls: 'open', open: true };
      case 'in_progress': return { text: 'Đang thi đấu', cls: 'live', open: false };
      case 'completed': return { text: 'Đã kết thúc', cls: 'closed', open: false };
      case 'cancelled': return { text: 'Đã hủy', cls: 'closed', open: false };
      default: return null;
    }
  }

  function render(t) {
    const st = statusOf(t);
    if (!st) return notFound();
    const count = (t.registrations && t.registrations[0] && t.registrations[0].count) || 0;
    const full = t.max_players != null && count >= t.max_players;
    document.title = t.name + ' · Sniper Billiards';
    app.replaceChildren();

    const cover = el('div', 'cover');
    const img = el('img');
    img.alt = '';
    // 封面只接受本專案 Storage 的網址，其他一律用預設分享圖
    img.src = typeof t.cover_url === 'string' && t.cover_url.startsWith(SUPABASE_URL + '/storage/') ? t.cover_url : '/brand/cover.png';
    img.onerror = function () { img.onerror = null; img.src = '/brand/cover.png'; };
    cover.appendChild(img);
    const brand = el('a', 'brand', 'SNIPER');
    brand.href = '/';
    cover.appendChild(brand);
    app.appendChild(cover);

    const head = el('div', 'head');
    const tag = el('span', 'tag ' + st.cls, st.text);
    tag.id = 'status-tag';
    head.appendChild(tag);
    if (full && st.open) head.appendChild(el('span', 'tag full', 'Đã đủ người'));
    head.appendChild(el('h1', null, t.name));
    app.appendChild(head);

    const card = el('div', 'card');
    function row(k, v, sub) {
      const r = el('div', 'row');
      r.appendChild(el('span', 'k', k));
      const val = el('span', 'v', v);
      if (sub) val.appendChild(el('small', null, sub));
      r.appendChild(val);
      card.appendChild(r);
    }
    const venue = t.venue || {};
    row('Thời gian', when(t.starts_at));
    row('Địa điểm', t.location_name || venue.name || '', (t.location_name ? t.location_address : venue.address) || '');
    row('Thể thức', [DISCIPLINE[t.discipline] || t.discipline, FORMAT[t.format] || t.format, 'chạm ' + t.race_to].join(' · '));
    row('Số người', t.max_players != null ? count + ' / ' + t.max_players + (full ? ' (đã đủ)' : '') : String(count));
    row('Lệ phí', t.entry_fee > 0 ? money(t.entry_fee) : 'Miễn phí');
    row('Hạn đăng ký', when(t.registration_closes_at));
    app.appendChild(card);

    if (t.prize_total > 0) {
      const prize = el('div', 'prize');
      prize.appendChild(el('div', 'k', 'Tổng giải thưởng'));
      prize.appendChild(el('div', 'v', money(t.prize_total)));
      app.appendChild(prize);
    }

    if (st.open) {
      app.appendChild(el('p', 'note', 'Đăng ký và thanh toán trong ứng dụng Sniper Billiards.'));
      app.appendChild(bottomBar('Đăng ký trong ứng dụng', appLink('/t/' + t.id), false));
    } else {
      app.appendChild(el('p', 'note', st.cls === 'closed' && t.status === 'registration'
        ? 'Giải đấu đã hết hạn đăng ký.' : 'Giải đấu không còn nhận đăng ký.'));
      app.appendChild(bottomBar('Xem giải đấu khác', appLink('/t'), true));
    }
  }

  async function main() {
    const m = location.pathname.match(/^\/t\/([0-9a-fA-F-]{36})\/?$/);
    const id = m && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m[1]) ? m[1].toLowerCase() : null;
    if (!id) return notFound();
    // Cloudflare 伺服器已經讀好的資料（functions/t/[[path]].js），不用再讀一次
    const pre = document.getElementById('t-data');
    if (pre) {
      try {
        const d = JSON.parse(pre.textContent);
        if (d && d.ok && d.tournament && d.tournament.id === id) return render(d.tournament);
        if (d && d.notFound) return notFound();
      } catch (_) { /* 讀不懂就照舊自己讀 */ }
    }
    try {
      const url = SUPABASE_URL + '/rest/v1/tournaments?select=' + encodeURIComponent(COLUMNS) +
        '&id=eq.' + id + '&status=neq.draft&limit=1';
      const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return notFound();
      render(rows[0]);
    } catch (_) {
      failed();
    }
  }

  main();
})();
