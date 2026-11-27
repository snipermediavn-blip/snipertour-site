// 公開賽事頁 https://snipertour.com/t/<賽事ID>（GitHub Pages 用 404.html 回這一頁，由這支程式畫內容）
// - 不用登入：用公開金鑰（publishable，不是密鑰）讀資料，權限由資料庫 RLS 控制（草稿讀不到 = 找不到）
// - 只讀公開欄位；所有文字用 textContent 放進去，不用 innerHTML
// - 網頁不能報名：主按鈕打開 App 的賽事詳情（沒裝 App 去 Google Play）
// - 2026-11-26 改版：照 App 的 Design System（深綠、金色、Be Vietnam Pro、沒有封面畫球檯、獎金前三名）
'use strict';
(function () {
  const SUPABASE_URL = 'https://zcvtqzjgmhsstbyzvuyo.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_avakZ2zeH7B5qfeaGYctCQ_Hkps52Lm'; // 公開金鑰（publishable），不是密鑰
  const PACKAGE = 'com.sniperbilliards.sniper_billiards';
  const STORE_URL = 'https://play.google.com/store/apps/details?id=' + PACKAGE;
  const SITE = 'snipertour.com';
  const TZ = 'Asia/Ho_Chi_Minh';
  const COLUMNS = 'id,name,discipline,format,race_to,status,max_players,entry_fee,registration_closes_at,starts_at,days,' +
    'prize_total,prize_list,cover_url,location_name,location_address,venue:venues(name,address),registrations(count)';

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

  // 放不下完整金額的地方（冠亞季三格）：6.000.000 → 6 triệu、1.500.000 → 1,5 triệu
  function shortMoney(n) {
    const f = (x) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(x);
    if (n >= 1e9) return f(n / 1e9) + ' tỷ';
    if (n >= 1e6) return f(n / 1e6) + ' triệu';
    if (n >= 1e3) return f(n / 1e3) + ' nghìn';
    return money(n);
  }

  // 線條圖示（和 App 的 Material 圖示同風格）：用 SVG path 畫，不用 innerHTML
  const ICONS = {
    clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm-.75 3h1.5v5.3l4.4 2.6-.75 1.3-5.15-3.1z',
    pin: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 2a5 5 0 0 1 5 5c0 3.07-3.3 7.68-5 9.87C10.3 16.68 7 12.07 7 9a5 5 0 0 1 5-5zm0 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    cue: 'M3 21 19.5 4.5l1.06 1.06L4.06 22.06zM18 3l3 3-1.5 1.5-3-3z',
    ticket: 'M4 6h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V7a1 1 0 0 1 1-1zm1 2v1.27a4 4 0 0 1 0 5.46V16h14v-1.27a4 4 0 0 1 0-5.46V8z',
    flag: 'M5 3h2v18H5zm3 1h11l-2.5 4L19 12H8z',
    trophy: 'M7 3h10v2h3v3a4 4 0 0 1-4 4h-.35A5 5 0 0 1 13 14.9V18h3v2H8v-2h3v-3.1A5 5 0 0 1 8.35 12H8a4 4 0 0 1-4-4V5h3zm2 2v4a3 3 0 0 0 6 0V5zM6 7v1a2 2 0 0 0 1.1 1.79A5 5 0 0 1 7 9V7zm11 0v2c0 .27-.02.53-.06.79A2 2 0 0 0 18 8V7z',
    search: 'M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
    wifi: 'M12 18.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 13c2 0 3.8.8 5.1 2.1l-1.4 1.4A5.2 5.2 0 0 0 12 15c-1.4 0-2.7.6-3.7 1.5l-1.4-1.4A7.2 7.2 0 0 1 12 13zm0-4.5c3.2 0 6.2 1.3 8.3 3.5l-1.4 1.4A9.7 9.7 0 0 0 12 10.5c-2.7 0-5.2 1.1-6.9 2.9l-1.4-1.4A11.7 11.7 0 0 1 12 8.5z',
  };
  function icon(name, size) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (size) { svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); }
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }

  // 越南時間的日期、時間、星期
  function vnParts(iso) {
    const d = new Date(iso);
    const f = (o) => new Intl.DateTimeFormat('vi-VN', Object.assign({ timeZone: TZ }, o)).format(d);
    return {
      day: f({ day: '2-digit' }) + '/' + f({ month: '2-digit' }),
      year: f({ year: 'numeric' }),
      time: f({ hour: '2-digit', minute: '2-digit', hour12: false }),
      weekday: f({ weekday: 'long' }),
    };
  }

  // 還有多久截止（只給報名中的）
  function left(iso) {
    const ms = new Date(iso) - new Date();
    if (ms <= 0) return null;
    const h = Math.floor(ms / 3600e3);
    if (h >= 48) return 'còn ' + Math.floor(h / 24) + ' ngày';
    if (h >= 1) return 'còn ' + h + ' giờ';
    return 'sắp hết hạn';
  }

  function dock(label, href, secondary) {
    const bar = el('div', 'dock');
    const inner = el('div', 'dock-in');
    const btn = el('a', 'btn' + (secondary ? ' secondary' : ''), label);
    btn.href = href;
    btn.id = 'main-action';
    inner.appendChild(btn);
    const store = el('a', 'store');
    store.appendChild(document.createTextNode('Chưa có ứng dụng? '));
    store.appendChild(el('u', null, 'Tải WQW trên Google Play'));
    store.href = STORE_URL;
    store.rel = 'noopener';
    inner.appendChild(store);
    bar.appendChild(inner);
    return bar;
  }

  function emptyState(id, iconName, title, text, action) {
    app.replaceChildren();
    const box = el('div', 'empty');
    box.id = id;
    const ic = el('div', 'ic');
    ic.appendChild(icon(iconName));
    box.appendChild(ic);
    box.appendChild(el('h1', null, title));
    box.appendChild(el('p', null, text));
    if (action) box.appendChild(action);
    app.appendChild(box);
  }

  function notFound() {
    document.title = 'Không tìm thấy giải đấu · WQW';
    emptyState('not-found', 'search', 'Không tìm thấy giải đấu', 'Giải đấu này không tồn tại hoặc chưa được công khai.');
    app.appendChild(dock('Xem giải đấu khác', appLink('/t'), true));
  }

  function failed() {
    const retry = el('a', 'btn', 'Thử lại');
    retry.href = location.href;
    emptyState('load-failed', 'wifi', 'Không tải được giải đấu', 'Vui lòng kiểm tra kết nối mạng và thử lại.', retry);
  }

  // 狀態標籤：報名中（還沒截止）／已截止／比賽中／已結束／已取消
  function statusOf(t) {
    const closed = t.registration_closes_at && new Date(t.registration_closes_at) <= new Date();
    switch (t.status) {
      case 'registration': return closed ? { text: 'Đã hết hạn đăng ký', cls: '', open: false }
        : { text: 'Đang nhận đăng ký', cls: 'open', open: true };
      case 'in_progress': return { text: 'Đang thi đấu', cls: 'live', open: false };
      case 'completed': return { text: 'Đã kết thúc', cls: '', open: false };
      case 'cancelled': return { text: 'Đã hủy', cls: '', open: false };
      default: return null;
    }
  }

  // 沒有封面：畫球檯和這個項目的球（和 App 一樣，不重複用同一張照片）
  function feltArt(t) {
    const felt = el('div', 'felt');
    felt.appendChild(el('div', 'spot'));
    const sets = { '8ball': [1, 9, 2, 10, 8, 3], '9ball': [1, 2, 3, 9, 4, 5], '10ball': [1, 2, 3, 10, 4, 5] };
    const balls = sets[t.discipline] || sets['9ball'];
    // 三角排列（球寬 12.5%，用左上角定位）
    const pos = [[50, 36], [43.8, 48], [56.2, 48], [37.6, 60], [50, 60], [62.4, 60]];
    pos.forEach(function (p, i) {
      const b = el('img', 'ball');
      b.alt = '';
      b.src = '/t/ball-' + String(balls[i]).padStart(2, '0') + '.svg';
      b.style.left = 'calc(' + p[0] + '% - 6.25%)';
      b.style.top = 'calc(' + p[1] + '% - 10%)';
      felt.appendChild(b);
    });
    return felt;
  }

  function render(t) {
    const st = statusOf(t);
    if (!st) return notFound();
    const count = (t.registrations && t.registrations[0] && t.registrations[0].count) || 0;
    const full = t.max_players != null && count >= t.max_players;
    const venue = t.venue || {};
    const placeName = t.location_name || venue.name || '';
    const placeAddr = (t.location_name ? t.location_address : venue.address) || '';
    document.title = t.name + ' · WQW';
    app.replaceChildren();

    // 封面＋頂列
    const hero = el('div', 'hero');
    const hasCover = typeof t.cover_url === 'string' && t.cover_url.startsWith(SUPABASE_URL + '/storage/');
    if (hasCover) {
      const img = el('img', 'cover');
      img.alt = '';
      img.src = t.cover_url;
      img.onerror = function () { img.replaceWith(feltArt(t)); };
      hero.appendChild(img);
    } else {
      hero.appendChild(feltArt(t));
    }
    const top = el('div', 'top');
    const logo = el('img', 'logo');
    logo.src = '/brand/icon_512.png';
    logo.alt = '';
    top.appendChild(logo);
    const word = el('a', 'word', 'WQW');
    word.href = '/';
    top.appendChild(word);
    const open = el('a', 'open-app', 'Mở ứng dụng');
    open.href = appLink('/t/' + t.id);
    top.appendChild(open);
    hero.appendChild(top);
    app.appendChild(hero);

    // 標題
    const head = el('div', 'head');
    const chips = el('div', 'chips');
    const tag = el('span', 'chip ' + st.cls, st.text);
    tag.id = 'status-tag';
    chips.appendChild(tag);
    if (full && st.open) chips.appendChild(el('span', 'chip full', 'Đã đủ người'));
    chips.appendChild(el('span', 'chip', DISCIPLINE[t.discipline] || t.discipline));
    head.appendChild(chips);
    head.appendChild(el('h1', null, t.name));
    if (placeName) head.appendChild(el('p', 'where', placeName));
    app.appendChild(head);

    // 三格重點：日期、時間、人數
    const stats = el('div', 'stats');
    function stat(k, v, extra) {
      const s = el('div', 'stat');
      s.appendChild(el('div', 'k', k));
      s.appendChild(el('div', 'v num', v));
      if (extra) s.appendChild(extra);
      stats.appendChild(s);
    }
    const sp = t.starts_at ? vnParts(t.starts_at) : null;
    // 好幾天的比賽（2026-11-27）：「02/12 – 04/12」
    const days = Number(t.days) > 1 ? Number(t.days) : 1;
    const ep = sp && days > 1 ? vnParts(new Date(Date.parse(t.starts_at) + (days - 1) * 86400000).toISOString()) : null;
    stat('Ngày thi đấu', sp ? (ep ? sp.day + ' – ' + ep.day : sp.day) : '—');
    stat('Giờ bắt đầu', sp ? sp.time : '—');
    let bar = null;
    if (t.max_players) {
      bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = Math.min(100, Math.round((count / t.max_players) * 100)) + '%';
      bar.appendChild(fill);
    }
    stat('Đã đăng ký', t.max_players != null ? count + '/' + t.max_players : String(count), bar);
    app.appendChild(stats);

    // 獎金：總額＋冠亞季
    if (t.prize_total > 0) {
      const prize = el('div', 'prize');
      const k = el('div', 'k');
      k.appendChild(icon('trophy', 16));
      k.appendChild(document.createTextNode('Tổng giải thưởng'));
      prize.appendChild(k);
      prize.appendChild(el('div', 'total num', money(t.prize_total)));
      const rows = Array.isArray(t.prize_list) ? t.prize_list : [];
      const top3 = [1, 2, 3].map(function (n) {
        return rows.find(function (r) { return r && r.from <= n && (r.to || r.from) >= n; });
      });
      if (top3.some(Boolean)) {
        const podium = el('div', 'podium');
        ['Vô địch', 'Á quân', 'Hạng 3'].forEach(function (name, i) {
          const r = top3[i];
          const pl = el('div', 'place');
          pl.appendChild(el('div', 'medal', String(i + 1)));
          // 第三名兩位（同一輪淘汰名次一樣）
          pl.appendChild(el('div', 'n', i === 2 && r && (r.to || r.from) >= 4 ? 'Hạng 3 (2 người)' : name));
          pl.appendChild(el('div', 'a num', r && r.amount > 0 ? shortMoney(r.amount) : '—'));
          if (r && r.gift) pl.appendChild(el('div', 'g', '+ ' + r.gift));
          podium.appendChild(pl);
        });
        prize.appendChild(podium);
      }
      app.appendChild(prize);
    }

    // 詳細資訊
    app.appendChild(el('div', 'section', 'Thông tin giải đấu'));
    const list = el('div', 'list');
    function item(ic, k, v, s, href, go, goAccent) {
      const it = el(href ? 'a' : 'div', 'item');
      if (href) { it.href = href; it.rel = 'noopener'; }
      const i = el('div', 'ic');
      i.appendChild(icon(ic));
      it.appendChild(i);
      const b = el('div', 'body');
      b.appendChild(el('div', 'k', k));
      b.appendChild(el('div', 'v', v));
      if (s) b.appendChild(el('div', 's', s));
      it.appendChild(b);
      if (go) it.appendChild(el('span', 'go' + (goAccent ? ' accent' : ''), go));
      list.appendChild(it);
    }
    if (sp) {
      item('clock', 'Thời gian', sp.time + ' · ' + sp.day + '/' + sp.year,
        sp.weekday.charAt(0).toUpperCase() + sp.weekday.slice(1) + ' · giờ Việt Nam');
    }
    if (placeName) {
      const q = encodeURIComponent([placeName, placeAddr].filter(Boolean).join(', '));
      item('pin', 'Địa điểm', placeName, placeAddr, 'https://www.google.com/maps/search/?api=1&query=' + q, 'Chỉ đường ›', true);
    }
    item('cue', 'Thể thức', [DISCIPLINE[t.discipline] || t.discipline, FORMAT[t.format] || t.format].join(' · '), 'Chạm ' + t.race_to);
    item('ticket', 'Lệ phí', t.entry_fee > 0 ? money(t.entry_fee) : 'Miễn phí', null);
    if (t.registration_closes_at) {
      const p = vnParts(t.registration_closes_at);
      item('flag', 'Hạn đăng ký', p.time + ' · ' + p.day + '/' + p.year, null, null, st.open ? left(t.registration_closes_at) : null, false);
    }
    app.appendChild(list);

    // App 介紹
    const promo = el('div', 'promo');
    const pi = el('img');
    pi.src = '/brand/icon_512.png';
    pi.alt = '';
    promo.appendChild(pi);
    const pt = el('div');
    pt.appendChild(el('b', null, 'WQW'));
    pt.appendChild(el('span', null, 'Đăng ký giải, xem bảng đấu trực tiếp, tích điểm và lên hạng.'));
    promo.appendChild(pt);
    app.appendChild(promo);

    if (st.open) {
      app.appendChild(el('p', 'note', 'Đăng ký và thanh toán trong ứng dụng WQW.'));
      app.appendChild(dock(full ? 'Xem giải đấu trong ứng dụng' : 'Đăng ký trong ứng dụng', appLink('/t/' + t.id), false));
    } else {
      app.appendChild(el('p', 'note', t.status === 'registration'
        ? 'Giải đấu đã hết hạn đăng ký.' : 'Giải đấu không còn nhận đăng ký.'));
      app.appendChild(dock('Xem giải đấu khác', appLink('/t'), true));
    }
  }

  async function main() {
    const m = location.pathname.match(/^\/t\/([0-9a-fA-F-]{36})\/?$/);
    const id = m && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m[1]) ? m[1].toLowerCase() : null;
    if (!id) return notFound();
    // Cloudflare 伺服器（_worker.js）已經讀好的資料，不用再讀一次
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
