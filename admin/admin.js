// WQW 管理後台（CLAUDE.md 第 4.C 節）— 只有平台管理員（profiles.role = admin）能用。
// 所有權限都在資料庫（RLS 與伺服器端函式）檢查，這個網頁只是操作介面。
'use strict';

const SUPABASE_URL = 'https://zcvtqzjgmhsstbyzvuyo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_avakZ2zeH7B5qfeaGYctCQ_Hkps52Lm'; // 公開金鑰（publishable），不是密鑰
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const LEVELS = ['I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'CN'];
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d) => (d ? new Date(d).toLocaleString('zh-TW', { hour12: false }) : '—');
const page = () => $('#page');

const ERRORS = {
  not_allowed: '沒有權限（需要管理員）',
  invalid_level: '等級不正確',
  note_required: '請寫原因',
  already_sent: '這則已經送出過了',
  next_match_started: '下一場已經開打，不能改勝負',
  invalid_score: '比分不正確（超過要搶的局數，或兩邊同時搶到）',
  match_not_ready: '這場還不能改比分',
  not_pending: '這筆已經審核過了',
  already_verified: '這位球員已經通過認證（可能已在球館當面認證）',
  role_not_allowed: '你的後台角色沒有這個權限（請超級管理員調整）',
  last_super_admin: '至少要留一位超級管理員',
  not_an_admin: '這個人不是管理員',
  nothing_to_restore: '這筆是新增的設定，沒有「改之前」可以還原',
};
function errText(e) {
  const m = String(e?.message ?? e ?? '');
  for (const [k, v] of Object.entries(ERRORS)) if (m.includes(k)) return v;
  return '發生錯誤：' + m;
}
function toast(text, isError = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 4000);
}
async function run(promise, okText) {
  const { data, error } = await promise;
  if (error) { toast(errText(error), true); throw error; }
  if (okText) toast(okText);
  return data;
}

// ---------------------------------------------------------------------
// 登入：手機號碼 + 簡訊驗證碼（和 App 同一個帳號）
// ---------------------------------------------------------------------
function e164(raw) {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('0')) d = '84' + d.slice(1);
  if (!d.startsWith('84')) d = '84' + d;
  return '+' + d;
}
let loginPhone = null;
// 手機號碼＋密碼（不花錢）；驗證碼每則要錢，只在忘記密碼或還沒設密碼時用（登入後到 App 的「設定」設密碼）
$('#login-pw').onclick = async () => {
  $('#login-msg').textContent = '';
  const { error } = await db.auth.signInWithPassword({ phone: e164($('#login-phone').value), password: $('#login-password').value });
  if (error) { $('#login-msg').textContent = '手機號碼或密碼錯誤'; return; }
  await start();
};
$('#login-password').onkeydown = (e) => { if (e.key === 'Enter') $('#login-pw').click(); };
$('#login-send').onclick = async () => {
  const phone = e164($('#login-phone').value);
  $('#login-msg').textContent = '';
  const { error } = await db.auth.signInWithOtp({ phone });
  if (error) { $('#login-msg').textContent = '傳送失敗：' + error.message; return; }
  loginPhone = phone;
  $('#login-phone-step').classList.add('hidden');
  $('#login-code-step').classList.remove('hidden');
  $('#login-code').focus();
};
$('#login-verify').onclick = async () => {
  const { error } = await db.auth.verifyOtp({ phone: loginPhone, token: $('#login-code').value.trim(), type: 'sms' });
  if (error) { $('#login-msg').textContent = '驗證碼錯誤或已過期'; return; }
  await start();
};
$('#login-back').onclick = () => {
  $('#login-code-step').classList.add('hidden');
  $('#login-phone-step').classList.remove('hidden');
};
$('#logout').onclick = async () => { await db.auth.signOut(); location.hash = ''; location.reload(); };

async function start() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); return; }
  const { data: me } = await db.from('profiles').select('display_name, role').eq('id', user.id).single();
  if (me?.role !== 'admin') {
    $('#login').classList.remove('hidden');
    $('#app').classList.add('hidden');
    $('#login-msg').textContent = '這個帳號不是平台管理員。';
    await db.auth.signOut();
    return;
  }
  // 兩步驟驗證（負責人 2026-11-25）：伺服器只認 aal2 的管理員，這裡先帶使用者完成
  const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2') {
    await showMfa();
    return;
  }
  $('#me-name').textContent = me.display_name || '管理員';
  // 後台角色（2026-11-26）：依角色藏起用不到的頁面（真正的權限在資料庫檢查）
  MY_ROLE = (await db.rpc('admin_role')).data || 'super_admin';
  $('#me-name').textContent += '（' + (ROLE_NAMES[MY_ROLE] || MY_ROLE) + '）';
  document.querySelectorAll('.side a[data-roles]').forEach((a) => {
    const ok = MY_ROLE === 'super_admin' || a.dataset.roles.split(',').includes(MY_ROLE);
    a.classList.toggle('hidden', !ok);
  });
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  route();
}

// ---------------------------------------------------------------------
// 兩步驟驗證：第一次綁定手機驗證 App（掃 QR code），之後每次登入輸入 6 位數
// ---------------------------------------------------------------------
let mfaFactorId = null;
async function showMfa() {
  $('#login').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#login-phone-step').classList.add('hidden');
  $('#login-code-step').classList.add('hidden');
  $('#login-mfa-step').classList.remove('hidden');
  $('#login-msg').textContent = '';
  $('#mfa-code').value = '';
  const { data: f, error } = await db.auth.mfa.listFactors();
  if (error) { $('#login-msg').textContent = errText(error); return; }
  const verified = (f?.totp ?? []).find((x) => x.status === 'verified');
  if (verified) {
    mfaFactorId = verified.id;
    $('#mfa-intro').textContent = '請打開手機的驗證 App（Google Authenticator 等），輸入「WQW 管理後台」的 6 位數。';
    $('#mfa-qr').innerHTML = '';
    $('#mfa-secret').textContent = '';
  } else {
    // 上次沒完成的綁定先清掉，重新產生
    for (const x of f?.all ?? []) {
      if (x.status !== 'verified') await db.auth.mfa.unenroll({ factorId: x.id });
    }
    const { data: en, error: e2 } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'WQW 管理後台' });
    if (e2) { $('#login-msg').textContent = errText(e2); return; }
    mfaFactorId = en.id;
    $('#mfa-intro').textContent = '第一次登入要綁定手機：用 Google Authenticator（或其他驗證 App）掃下面的 QR code，再輸入 App 上的 6 位數。之後每次登入都要輸入。';
    const img = document.createElement('img');
    img.src = en.totp.qr_code;
    img.alt = 'QR code';
    img.style.cssText = 'width:180px;height:180px;background:#fff;padding:8px;border-radius:8px;display:block;margin:8px auto';
    $('#mfa-qr').innerHTML = '';
    $('#mfa-qr').appendChild(img);
    $('#mfa-secret').textContent = '不能掃描時，手動輸入金鑰：' + en.totp.secret;
  }
  $('#mfa-code').focus();
}
$('#mfa-verify').onclick = async () => {
  const code = $('#mfa-code').value.replace(/\D/g, '');
  if (code.length !== 6 || !mfaFactorId) { $('#login-msg').textContent = '請輸入 6 位數'; return; }
  const { error } = await db.auth.mfa.challengeAndVerify({ factorId: mfaFactorId, code });
  if (error) { $('#login-msg').textContent = '驗證碼不對或已過期，請看 App 上最新的 6 位數'; return; }
  $('#login-mfa-step').classList.add('hidden');
  $('#login-phone-step').classList.remove('hidden');
  await start();
};
$('#mfa-code').onkeydown = (e) => { if (e.key === 'Enter') $('#mfa-verify').click(); };
$('#mfa-cancel').onclick = async () => { await db.auth.signOut(); location.hash = ''; location.reload(); };

// ---------------------------------------------------------------------
// 頁面切換
// ---------------------------------------------------------------------
const PAGES = { overview, levels, venues, players, members, lucky, flags, disputes, reports, feedback, otp, rules, release, configlog, roles, store, orders, revenue, ads, push };
function route() {
  const name = (location.hash.replace('#/', '') || 'overview').split('?')[0];
  document.querySelectorAll('.side a').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
  page().innerHTML = '<p class="muted">載入中…</p>';
  (PAGES[name] ?? overview)().catch((e) => { page().innerHTML = '<p class="msg">' + esc(errText(e)) + '</p>'; });
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------------
// 總覽
// ---------------------------------------------------------------------
async function overview() {
  const o = await run(db.rpc('admin_overview'));
  const { count: pendingLevels } = await db.from('level_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  const card = (n, label, alert = false, href = null) =>
    `<div class="card ${alert && n > 0 ? 'alert' : ''}">${href ? `<a href="${href}" style="text-decoration:none;color:inherit">` : ''}
      <div class="num">${n}</div><div class="label">${label}</div>${href ? '</a>' : ''}</div>`;
  page().innerHTML = `<h1>總覽</h1>
    <div class="cards">
      ${card(o.players, '註冊球員')}${card(o.verified, '已認證')}${card(o.suspended, '停權中')}
      ${card(o.venues, '球館')}${card(o.tournaments_open, '報名中／比賽中的比賽')}${card(o.matches_today, '24 小時內打完的對局')}
      ${card(pendingLevels ?? 0, '待審核的等級申報', true, '#/levels')}
      ${card(o.open_flags, '待處理的可疑名單', true, '#/flags')}${card(o.open_disputes, '待處理的比分爭議', true, '#/disputes')}
      ${card(o.open_reports, '待處理的檢舉', true, '#/reports')}
    </div>
    <div id="stats"><p class="muted">營運數據載入中…</p></div>`;
  await renderStats($('#stats'));
}

// ---------------------------------------------------------------------
// 營運數據（負責人 2026-11-25）：近 30 天每天的新增會員、活躍人數、對局、報名（越南時間）
// 活躍 = 那天打開過 App 的人
// ---------------------------------------------------------------------
async function renderStats(el) {
  const s = await run(db.rpc('admin_stats', { p_days: 30 }));
  const sum = s.summary;
  const card = (n, label) => `<div class="card"><div class="num">${Number(n)}</div><div class="label">${label}</div></div>`;
  // 每天一根長條；滑過去看日期和數字
  const chart = (key, title) => {
    const rows = s.daily;
    const max = Math.max(1, ...rows.map((r) => Number(r[key])));
    const total = rows.reduce((a, r) => a + Number(r[key]), 0);
    const bars = rows.map((r) => {
      const v = Number(r[key]);
      const h = v === 0 ? 0 : Math.max(4, Math.round((v / max) * 100));
      const d = String(r.day).slice(5).replace('-', '/');
      return `<div class="sbar" title="${esc(d)}：${v}"><div style="height:${h}%"></div></div>`;
    }).join('');
    const first = String(rows[0]?.day ?? '').slice(5).replace('-', '/');
    const last = String(rows.at(-1)?.day ?? '').slice(5).replace('-', '/');
    return `<div class="card schart">
      <div class="label">${title}</div>
      <div class="num" style="font-size:22px">${total}<span class="muted" style="font-size:13px;font-weight:400"> 近 30 天合計・最高一天 ${max === 1 && total === 0 ? 0 : max}</span></div>
      <div class="sbars">${bars}</div>
      <div class="saxis"><span>${esc(first)}</span><span>${esc(last)}</span></div>
    </div>`;
  };
  el.innerHTML = `<h2>營運數據（越南時間）</h2>
    <div class="cards">
      ${card(sum.active_today, '今天活躍')}${card(sum.active_7d, '近 7 天活躍')}${card(sum.active_30d, '近 30 天活躍')}
      ${card(sum.new_7d, '近 7 天新增會員')}${card(sum.tournaments_done_30d, '近 30 天辦完的比賽')}${card(sum.challenges_done_30d, '近 30 天完成的約戰')}
    </div>
    <div class="schart-grid">
      ${chart('active', '每天活躍人數（打開 App）')}${chart('new_members', '每天新增會員')}
      ${chart('matches', '每天打完的對局')}${chart('registrations', '每天報名')}
    </div>
    <p class="muted" style="font-size:13px">活躍 = 那天打開過 App 的人（每天登入經驗值）。滑鼠移到長條上可以看日期和數字。</p>`;
}

// ---------------------------------------------------------------------
// 等級審核（負責人 2026-11-24）：球員註冊時自己申報的等級，通過（可改等級）或退回（要寫原因）
// ---------------------------------------------------------------------
async function levels() {
  const showAll = location.hash.includes('all=1');
  let q = db.from('level_applications')
    .select('*, player:profiles!level_applications_player_id_fkey(display_name, avatar_url, city, verified_at), reviewer:profiles!level_applications_reviewed_by_fkey(display_name)')
    .order('created_at', { ascending: !showAll }).limit(300);
  if (!showAll) q = q.eq('status', 'pending');
  const list = await run(q);
  const levelSelect = (id, v) => `<select data-level="${id}">${LEVELS.map((l) => `<option ${l === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const status = { pending: '<span class="pill warn">審核中</span>', approved: '<span class="pill ok">通過</span>', rejected: '<span class="pill">退回</span>' };
  page().innerHTML = `<h1>等級審核</h1>
    <p class="muted">球員註冊時自己選的等級。通過才算認證（建立起始實力分、可以報名正式比賽），可以改成別的等級；退回一定要寫原因，球員會收到通知、可以重新申報。也可以請球員到合作球館當面認證。</p>
    <div id="tg-box" class="form"><span class="muted">Telegram 審核群組載入中…</span></div>
    <p><a href="#/levels">待審核</a>　|　<a href="#/levels?all=1">全部紀錄</a></p>
    <table><tr><th>申報時間</th><th>球員</th><th>所在地區</th><th>申報等級</th><th>${showAll ? '結果' : '給的等級'}</th><th>${showAll ? '備註／原因' : '備註（退回一定要寫）'}</th><th>${showAll ? '審核人' : ''}</th></tr>
      ${list.map((a) => `<tr><td>${fmt(a.created_at)}</td>
        <td>${esc(a.player?.display_name || '（還沒取名）')}${a.player?.verified_at ? ' <span class="pill">已認證</span>' : ''}</td>
        <td>${esc(a.player?.city ?? '—')}</td>
        <td><span class="badge">${esc(a.requested_level)}</span></td>
        ${a.status === 'pending' && !showAll
          ? `<td>${levelSelect(a.id, a.requested_level)}</td>
             <td><input data-note="${a.id}" placeholder="退回原因或備註" style="width:100%"></td>
             <td><div class="actions"><button class="btn small gold inline" data-approve="${a.id}">通過</button>
               <button class="btn small" data-reject="${a.id}">退回</button></div></td>`
          : `<td>${status[a.status]} ${a.approved_level ? `<span class="badge">${esc(a.approved_level)}</span>` : ''}</td>
             <td>${esc(a.note ?? '')}</td><td>${esc(a.reviewer?.display_name ?? '')} ${a.reviewed_at ? fmt(a.reviewed_at) : ''}</td>`}
      </tr>`).join('') || `<tr><td colspan="7" class="muted">${showAll ? '還沒有申報' : '沒有待審核的申報'}</td></tr>`}
    </table>`;
  telegramPanel().catch((e) => { $('#tg-box').innerHTML = '<span class="msg">' + esc(errText(e)) + '</span>'; });
  const note = (id) => page().querySelector(`[data-note="${id}"]`)?.value.trim() || null;
  page().querySelectorAll('[data-approve]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.approve;
    const level = page().querySelector(`[data-level="${id}"]`).value;
    await run(db.rpc('review_level_application', { p_id: id, p_approve: true, p_level: level, p_note: note(id) }), '已通過，等級 ' + level);
    levels();
  }));
  page().querySelectorAll('[data-reject]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.reject;
    if (!note(id)) { toast('退回請寫原因（球員會看到）', true); return; }
    await run(db.rpc('review_level_application', { p_id: id, p_approve: false, p_level: null, p_note: note(id) }), '已退回');
    levels();
  }));
}

// Telegram 審核群組（負責人 2026-11-25）：申報會貼到群組，綁定的管理員按「通過／退回」就算審核
async function telegramPanel() {
  const box = $('#tg-box');
  if (!box) return;
  const st = await run(db.rpc('telegram_status'));
  const bot = st.bot_username;
  box.innerHTML = `<div><b>Telegram 審核群組</b>　
      機器人：${bot ? `<span class="pill ok">@${esc(bot)}</span>` : '<span class="pill bad">還沒設定</span>'}　
      群組：${st.group_set ? '<span class="pill ok">已設定</span>' : '<span class="pill bad">還沒設定</span>'}　
      我的 Telegram：${st.me ? `<span class="pill ok">${esc(st.me.telegram_name ?? '已綁定')}</span>` : '<span class="pill bad">還沒綁定</span>'}</div>
    ${st.admins.length ? `<p class="hint">已綁定的管理員：${st.admins.map((a) => esc((a.display_name || '管理員') + '（' + (a.telegram_name ?? '') + '）')).join('、')}。只有他們按的按鈕才算數。</p>` : ''}
    <div class="actions">
      <button class="btn small${bot ? '' : ' gold inline'}" id="tg-setup">${bot ? '重新設定機器人' : '設定機器人'}</button>
      ${bot ? `<button class="btn small${st.me ? '' : ' gold inline'}" id="tg-link">${st.me ? '重新綁定我的 Telegram' : '綁定我的 Telegram'}</button>` : ''}
      ${st.me ? '<button class="btn small" id="tg-unlink">解除綁定</button>' : ''}
    </div>
    <div id="tg-code"></div>
    <p class="hint">步驟：① 設定機器人 → ② 綁定我的 Telegram → ③ 把機器人加進審核群組，在群組裡打 <code>/setgroup</code>。之後有人申報等級，群組會收到訊息：按「通過」照申報的等級通過；按「退回」後要「回覆」機器人的訊息寫原因。要改成別的等級，請在這個頁面審核。</p>`;
  $('#tg-setup').onclick = async () => {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/telegram/setup', {
      method: 'POST', headers: { Authorization: 'Bearer ' + session?.access_token, apikey: SUPABASE_KEY },
    });
    const out = await res.json().catch(() => ({}));
    if (!out.bot_username) return toast('設定失敗：' + (out.error === 'bot_token_missing' ? '還沒在 Supabase 設定 TELEGRAM_BOT_TOKEN' : (out.error ?? res.status)), true);
    toast('機器人 @' + out.bot_username + ' 設定完成');
    telegramPanel();
  };
  if ($('#tg-link')) $('#tg-link').onclick = async () => {
    const code = await run(db.rpc('telegram_link_code'));
    const url = 'https://t.me/' + encodeURIComponent(bot) + '?start=' + encodeURIComponent(code);
    $('#tg-code').innerHTML = `<p>用你的 Telegram 打開 <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a> 按「開始」；
      或私訊 @${esc(bot)}：<code>/start ${esc(code)}</code>（15 分鐘內有效，用一次就失效）。綁定完重新整理這頁。</p>`;
  };
  if ($('#tg-unlink')) $('#tg-unlink').onclick = async () => {
    if (!confirm('解除綁定後，你在 Telegram 按的審核按鈕就不算數。確定？')) return;
    await run(db.rpc('telegram_unlink'), '已解除綁定');
    telegramPanel();
  };
}

// ---------------------------------------------------------------------
// 球館與員工
// ---------------------------------------------------------------------
// 越南 34 個省級行政區（和 App 的 lib/core/cities.dart 同一份；資料庫存越南文）
const CENTRAL_CITIES = [["Hà Nội","河內市"],["Huế","順化市"],["Hải Phòng","海防市"],["Đà Nẵng","峴港市"],["Thành phố Hồ Chí Minh","胡志明市"],["Cần Thơ","芹苴市"]];
const PROVINCES = [["Cao Bằng","高平省"],["Tuyên Quang","宣光省"],["Điện Biên","奠邊省"],["Lai Châu","萊州省"],["Sơn La","山羅省"],["Lào Cai","老街省"],["Thái Nguyên","太原省"],["Lạng Sơn","諒山省"],["Quảng Ninh","廣寧省"],["Bắc Ninh","北寧省"],["Phú Thọ","富壽省"],["Hưng Yên","興安省"],["Ninh Bình","寧平省"],["Thanh Hóa","清化省"],["Nghệ An","乂安省"],["Hà Tĩnh","河靜省"],["Quảng Trị","廣治省"],["Quảng Ngãi","廣義省"],["Gia Lai","嘉萊省"],["Khánh Hòa","慶和省"],["Đắk Lắk","多樂省"],["Lâm Đồng","林同省"],["Đồng Nai","同奈省"],["Tây Ninh","西寧省"],["Vĩnh Long","永隆省"],["Đồng Tháp","同塔省"],["Cà Mau","金甌省"],["An Giang","安江省"]];
const CITY_ZH = Object.fromEntries([...CENTRAL_CITIES, ...PROVINCES]);
let DISTRICTS = []; // 區域（districts 表，上架中的），名稱一律越南文

async function venues() {
  const [list, districts] = await Promise.all([
    run(db.from('venues').select('*').order('name')),
    run(db.from('districts').select('id, city, name, sort_order').eq('active', true).order('sort_order', { ascending: true })),
  ]);
  DISTRICTS = districts ?? [];
  const dname = Object.fromEntries(DISTRICTS.map((d) => [d.id, d.name]));
  const selected = new URLSearchParams(location.hash.split('?')[1]).get('id');
  page().innerHTML = `<h1>球館與員工</h1>
    <table><tr><th>球館</th><th>城市・區域</th><th>地址</th><th>球檯</th><th>狀態</th><th></th></tr>
      ${list.map((v) => `<tr><td>${esc(v.name)}</td>
        <td>${v.city ? esc(CITY_ZH[v.city] ?? v.city) + (v.district_id ? '・' + esc(dname[v.district_id] ?? v.district_id) : '') : '<span class="muted">未設定</span>'}</td>
        <td>${esc(v.address)}</td><td>${v.table_count}</td>
        <td>${v.status === 'active' ? '<span class="pill ok">營業中</span>' : `<span class="pill">${esc(v.status)}</span>`}</td>
        <td><a class="btn small" href="#/venues?id=${v.id}">編輯／員工</a></td></tr>`).join('') || '<tr><td colspan="6" class="muted">還沒有球館</td></tr>'}
    </table>
    <div id="venue-edit"></div>`;
  renderVenueForm(list.find((v) => v.id === selected) ?? null);
}

function renderVenueForm(v) {
  const box = $('#venue-edit');
  box.innerHTML = `<h2>${v ? '編輯：' + esc(v.name) : '新增球館'}</h2>
    <div class="form">
      <div class="row">
        <div><label>名稱</label><input id="v-name" value="${esc(v?.name)}"></div>
        <div><label>球檯數</label><input id="v-tables" type="number" min="0" value="${v?.table_count ?? 0}"></div>
        <div><label>狀態</label><select id="v-status">
          <option value="active">營業中（App 看得到）</option><option value="pending">籌備中</option><option value="inactive">停用</option></select></div>
      </div>
      <div class="row">
        <div><label>城市（必填）</label><select id="v-city"><option value="">請選擇</option>
          <optgroup label="中央直轄市">${CENTRAL_CITIES.map(([vi, zh]) => `<option value="${esc(vi)}">${esc(zh)}（${esc(vi)}）</option>`).join('')}</optgroup>
          <optgroup label="省">${PROVINCES.map(([vi, zh]) => `<option value="${esc(vi)}">${esc(zh)}（${esc(vi)}）</option>`).join('')}</optgroup>
        </select></div>
        <div id="v-district-box"><label>區域（必填）</label><select id="v-district"></select></div>
      </div>
      <div><label>地址</label><input id="v-address" value="${esc(v?.address)}"></div>
      <div class="row">
        <div><label>緯度（Google 地圖上按右鍵可以複製）</label><input id="v-lat" value="${v?.lat ?? ''}"></div>
        <div><label>經度</label><input id="v-lng" value="${v?.lng ?? ''}"></div>
        <div><label>營業時間（例如 09:00 – 24:00）</label><input id="v-hours" value="${esc(v?.hours?.text)}"></div>
      </div>
      <div class="actions"><button class="btn gold inline" id="v-save">${v ? '儲存' : '新增球館'}</button>
        ${v ? '<a class="btn" href="#/venues">取消</a>' : ''}</div>
    </div>
    ${v ? `<h2>員工</h2><div id="staff"></div>` : ''}`;
  if (v) $('#v-status').value = v.status;
  // 區域：只有有區域清單的城市（目前胡志明市）才顯示、必填；換城市要重選
  const fillDistricts = (keep) => {
    const list = DISTRICTS.filter((d) => d.city === $('#v-city').value);
    $('#v-district-box').classList.toggle('hidden', list.length === 0);
    $('#v-district').innerHTML = '<option value="">請選擇</option>' +
      list.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
    $('#v-district').value = list.some((d) => d.id === keep) ? keep : '';
  };
  $('#v-city').value = v?.city ?? '';
  fillDistricts(v?.district_id);
  $('#v-city').onchange = () => fillDistricts(null);
  $('#v-save').onclick = async () => {
    const row = {
      name: $('#v-name').value.trim(),
      address: $('#v-address').value.trim() || null,
      city: $('#v-city').value || null,
      district_id: $('#v-district').value || null,
      table_count: Number($('#v-tables').value) || 0,
      status: $('#v-status').value,
      lat: $('#v-lat').value ? Number($('#v-lat').value) : null,
      lng: $('#v-lng').value ? Number($('#v-lng').value) : null,
      hours: $('#v-hours').value.trim() ? { text: $('#v-hours').value.trim() } : null,
    };
    if (!row.name) return toast('請填球館名稱', true);
    if (!row.city) return toast('請選城市', true);
    if (DISTRICTS.some((d) => d.city === row.city) && !row.district_id) return toast('請選區域', true);
    if (v) await run(db.from('venues').update(row).eq('id', v.id), '已儲存');
    else await run(db.from('venues').insert(row), '已新增球館');
    location.hash = '#/venues';
    route();
  };
  if (v) renderStaff(v);
}

async function renderStaff(v) {
  const staff = await run(db.from('venue_staff').select('user_id, role, profile:profiles(display_name)').eq('venue_id', v.id));
  $('#staff').innerHTML = `<table><tr><th>員工</th><th>身分</th><th></th></tr>
      ${staff.map((s) => `<tr><td>${esc(s.profile?.display_name ?? '（未設定暱稱）')}</td>
        <td>${s.role === 'owner' ? '負責人' : '員工'}</td>
        <td><button class="btn small danger" data-remove="${s.user_id}">移除</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">還沒有員工</td></tr>'}
    </table>
    <div class="form" style="margin-top:12px">
      <div class="row">
        <div><label>用手機號碼加員工（對方要先在 App 登入過一次）</label><input id="s-phone" placeholder="0901 234 567"></div>
        <div class="shrink"><label>身分</label><select id="s-role"><option value="staff">員工</option><option value="owner">負責人</option></select></div>
        <button class="btn gold inline" id="s-add">加入</button>
      </div>
    </div>`;
  $('#staff').querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    if (!confirm('確定移除這位員工？')) return;
    await run(db.from('venue_staff').delete().eq('venue_id', v.id).eq('user_id', b.dataset.remove), '已移除');
    renderStaff(v);
  }));
  $('#s-add').onclick = async () => {
    const found = await run(db.rpc('find_player_by_phone', { p_phone: e164($('#s-phone').value) }));
    if (!found?.length) return toast('找不到這個手機號碼的帳號（請對方先在 App 登入一次）', true);
    await run(db.from('venue_staff').insert({ venue_id: v.id, user_id: found[0].id, role: $('#s-role').value }),
      '已加入：' + (found[0].display_name ?? ''));
    renderStaff(v);
  };
}

// ---------------------------------------------------------------------
// 會員名單（負責人 2026-11-25）：暱稱、手機號碼、等級、地區、狀態、註冊日期；可以搜尋、匯出 Excel
// 手機號碼只有管理員看得到（伺服器 admin_members 把關）；每次匯出都會留紀錄（誰、何時、幾筆）
// ---------------------------------------------------------------------
const MEMBERS_PAGE = 50;
// 會員編號（VN＋6 位數字）：admin_members 沒有這欄，另外用 profiles 查（每次 200 人）
async function memberNoMap(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await run(db.from('profiles').select('id, member_no').in('id', ids.slice(i, i + 200)));
    for (const r of rows) out[r.id] = r.member_no;
  }
  return out;
}
const parseSN = (q) => {
  const m = String(q ?? '').toUpperCase().replace(/[\s.-]/g, '').match(/^(VN)?([1-9]\d{5,6})$/);
  return m ? m[2] : null;
};
// 搜尋會員編號：先找到那個人，再用名字查會員名單、留下同一個人
async function membersBySN(sn, exportAll) {
  const hit = await run(db.rpc('find_player_by_member_no', { p_text: sn }));
  if (!hit.length) return [];
  const list = await run(db.rpc('admin_members', { p_query: hit[0].display_name ?? '', p_limit: 200, p_offset: 0, p_export: exportAll }));
  return list.filter((m) => m.id === hit[0].id).map((m) => ({ ...m, total: 1 }));
}

async function members() {
  let offset = 0;
  page().innerHTML = `<h1>會員名單</h1>
    <p class="muted">手機號碼屬於個人資料：只在需要聯絡會員時使用，不要轉給其他人。每次匯出都會留下紀錄。</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <input id="m-q" placeholder="名字（不用打聲調）、會員編號 VN、手機號碼或 Email" style="max-width:320px">
      <button class="btn gold inline" id="m-search">搜尋</button>
      <button class="btn inline" id="m-export">匯出 Excel</button>
    </div>
    <div id="m-results" style="margin-top:16px"></div>`;
  const q = () => $('#m-q').value.trim() || null;
  const statusText = (s) => (s === 'active' ? '正常' : '停權');
  const load = async () => {
    const sn = parseSN(q());
    const list = sn
      ? await membersBySN(sn, false)
      : await run(db.rpc('admin_members', { p_query: q(), p_limit: MEMBERS_PAGE, p_offset: offset, p_export: false }));
    const nos = await memberNoMap(list.map((m) => m.id));
    const total = list.length ? Number(list[0].total) : 0;
    const from = total ? offset + 1 : 0;
    const to = offset + list.length;
    $('#m-results').innerHTML = `<p class="muted">共 ${total} 人${total ? `，第 ${from}–${to} 人` : ''}</p>
      <table><tr><th>暱稱</th><th>編號</th><th>手機號碼</th><th>等級</th><th>地區</th><th>狀態</th><th>Zalo</th><th>認證</th><th>註冊</th><th></th></tr>
      ${list.map((m) => `<tr>
        <td>${esc(m.display_name ?? '（未設定暱稱）')}${m.role === 'admin' ? ' <span class="pill warn">管理員</span>' : ''}</td>
        <td style="white-space:nowrap">${nos[m.id] ? 'VN ' + esc(nos[m.id]) : '—'}</td>
        <td style="white-space:nowrap">${esc(m.phone ?? '—')}${m.phone_verified === false ? ' <span class="pill warn">未驗證</span>' : ''}${m.email ? `<div class="hint">${esc(m.email)}</div>` : ''}</td>
        <td>${m.level ? `<span class="badge">${esc(m.level)}</span>` : '—'}</td>
        <td>${m.city ? esc(CITY_ZH[m.city] ?? m.city) : '<span class="muted">—</span>'}</td>
        <td style="white-space:nowrap">${m.status === 'active' ? '<span class="pill ok">正常</span>' : '<span class="pill bad">停權</span>'}</td>
        <td style="white-space:nowrap">${m.has_zalo ? '已綁定' : '—'}</td>
        <td>${m.verified_at ? fmt(m.verified_at) : '<span class="muted">未認證</span>'}</td>
        <td>${fmt(m.created_at)}</td>
        <td><button class="btn small" data-open="${m.id}">查看／調整</button></td></tr>`).join('') || '<tr><td colspan="10" class="muted">找不到</td></tr>'}
      </table>
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn small" id="m-prev" ${offset === 0 ? 'disabled' : ''}>上一頁</button>
        <button class="btn small" id="m-next" ${to >= total ? 'disabled' : ''}>下一頁</button>
      </div>`;
    $('#m-results').querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => playerDetail(b.dataset.open)));
    $('#m-prev').onclick = () => { offset = Math.max(0, offset - MEMBERS_PAGE); load(); };
    $('#m-next').onclick = () => { offset += MEMBERS_PAGE; load(); };
  };
  const search = () => { offset = 0; load(); };
  $('#m-search').onclick = search;
  $('#m-q').onkeydown = (e) => { if (e.key === 'Enter') search(); };
  $('#m-export').onclick = async () => {
    if (!confirm('匯出的檔案有會員的手機號碼，請妥善保管、不要轉給其他人。確定要匯出嗎？')) return;
    const sn = parseSN(q());
    const list = sn
      ? await membersBySN(sn, true)
      : await run(db.rpc('admin_members', { p_query: q(), p_limit: 10000, p_offset: 0, p_export: true }));
    const nos = await memberNoMap(list.map((m) => m.id));
    // Excel 會把 = + - @ 開頭的格子當公式執行：暱稱是使用者自己填的，前面加 ' 讓它只當文字
    const cell = (v) => {
      // 手機號碼用 Excel 的 ="0901…" 寫法，開頭的 0 才不會被吃掉（只有數字，自己產生的，安全）
      if (v && typeof v === 'object') return v.phone ? '"=""' + String(v.phone).replace(/\D/g, '') + '"""' : '""';
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const rows = [
      ['暱稱', '會員編號', '手機號碼', '手機已驗證', 'Email', '等級', '地區', '狀態', 'Zalo', '認證時間', '註冊時間'],
      ...list.map((m) => [
        m.display_name ?? '',
        nos[m.id] ? 'VN ' + nos[m.id] : '',
        { phone: m.phone },
        m.phone_verified === false ? '否（用 Email 註冊）' : '是',
        m.email ?? '',
        m.level ?? '',
        m.city ? (CITY_ZH[m.city] ?? m.city) : '',
        statusText(m.status),
        m.has_zalo ? '已綁定' : '',
        m.verified_at ? fmt(m.verified_at) : '',
        fmt(m.created_at),
      ]),
    ];
    // 開頭加 BOM，Excel 打開才不會亂碼（越南文、中文）
    const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const d = new Date();
    a.download = `sniper-members-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`已匯出 ${list.length} 人`);
  };
  await load();
}

// ---------------------------------------------------------------------
// 球員
// ---------------------------------------------------------------------
async function players() {
  page().innerHTML = `<h1>球員</h1>
    <div class="form"><div class="row">
      <div><label>暱稱或手機號碼</label><input id="p-q" placeholder="例如 Minh 或 0901234567"></div>
      <button class="btn gold inline" id="p-search">搜尋</button></div></div>
    <div id="p-results" style="margin-top:16px"></div><div id="p-detail"></div>`;
  const search = async () => {
    const q = $('#p-q').value.trim();
    let list;
    if (/^[\d\s+]{8,}$/.test(q)) {
      const found = await run(db.rpc('find_player_by_phone', { p_phone: e164(q) }));
      list = found.length ? await run(db.from('profiles').select('*').in('id', found.map((f) => f.id))) : [];
    } else {
      let query = db.from('profiles').select('*').order('created_at', { ascending: false }).limit(50);
      // 不用打聲調：name_fold 是伺服器算的「拿掉聲調的名字」（nguyen 找得到 Nguyễn）
      if (q) query = query.ilike('name_fold', '%' + foldVi(q).replace(/[%,()*]/g, ' ') + '%');
      list = await run(query);
    }
    $('#p-results').innerHTML = `<table><tr><th>球員</th><th>等級</th><th>認證</th><th>狀態</th><th></th></tr>
      ${list.map((p) => `<tr><td>${esc(p.display_name ?? '（未設定暱稱）')}${p.role === 'admin' ? ' <span class="pill warn">管理員</span>' : ''}</td>
        <td>${p.level ? `<span class="badge">${p.level}</span>` : '—'}</td>
        <td>${p.verified_at ? fmt(p.verified_at) : '<span class="muted">未認證</span>'}</td>
        <td>${p.status === 'active' ? '<span class="pill ok">正常</span>' : '<span class="pill bad">停權</span>'}</td>
        <td><button class="btn small" data-open="${p.id}">查看／調整</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">找不到</td></tr>'}
    </table>`;
    $('#p-results').querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => playerDetail(b.dataset.open)));
  };
  $('#p-search').onclick = search;
  $('#p-q').onkeydown = (e) => { if (e.key === 'Enter') search(); };
  search();
}

// 拿掉越南文聲調、轉小寫（和資料庫的 vn_fold 一樣）
function foldVi(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

async function playerDetail(id) {
  const [p, chat, ratings, history] = await Promise.all([
    run(db.from('profiles').select('*').eq('id', id).single()),
    run(db.rpc('admin_chat_moderation', { p_user: id })),
    run(db.from('ratings').select('*').eq('player_id', id)),
    run(db.from('level_history').select('*').eq('player_id', id).order('created_at', { ascending: false })),
  ]);
  const ban = chat?.ban;
  const banText = !ban || !ban.active ? '<span class="pill ok">可以留言</span>'
    : ban.muted_until ? `<span class="pill bad">禁言到 ${fmt(ban.muted_until)}</span>` : '<span class="pill bad">留言已停用（等管理員處理）</span>';
  const reason = { verification: '球館認證', championship: '冠軍路線', rating: '實力分路線', admin: '管理員調整' };
  const box = $('#p-detail');
  box.innerHTML = `<h2>${esc(p.display_name ?? '（未設定暱稱）')}</h2>
    <div class="form">
      <div class="row">
        <div class="shrink"><label>目前等級</label><div style="font-size:22px;font-weight:800">${p.level ?? '—'}</div></div>
        <div class="shrink"><label>調整成</label><select id="d-level">${LEVELS.map((l) => `<option ${l === p.level ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>原因（一定要寫，會留紀錄）</label><input id="d-note"></div>
        <button class="btn gold inline" id="d-set">調整等級</button>
      </div>
      <p class="hint">等級原則上只升不降；手動調降會留下紀錄（第 5.8 節）。</p>
      <label style="margin-top:14px">狀態消息（名字下面自己寫的一句話，公開）</label>
      <div style="padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.04)">${p.status_text ? esc(p.status_text) : '<span class="muted">（沒有填）</span>'}
        ${p.status_locked ? ' <span class="pill bad">已禁止修改</span>' : ''}</div>
      <div class="actions">
        ${p.status_text ? '<button class="btn small" id="d-status-clear">清除狀態</button>' : ''}
        ${p.status_locked
          ? '<button class="btn small" id="d-status-unlock">允許修改狀態</button>'
          : '<button class="btn small danger" id="d-status-lock">清除並禁止修改</button>'}
      </div>
      <label style="margin-top:14px">約戰留言管理（嚴禁賭博、色情、違法、私下聯絡方式）</label>
      <div style="padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.04)">
        ${banText} · 30 天內嚴重違規 <b>${chat?.strikes_30d ?? 0}</b> 次 ·
        ${chat?.accepted_at ? '同意規則：' + fmt(chat.accepted_at) : '<span class="muted">還沒同意規則</span>'}
      </div>
      <div class="actions">
        <button class="btn small danger" id="d-chat-7">禁言 7 天</button>
        <button class="btn small danger" id="d-chat-forever">停用留言</button>
        ${ban && ban.active ? '<button class="btn small" id="d-chat-unmute">解除禁言</button>' : ''}
      </div>
      <div class="actions">
        ${p.status === 'active'
          ? '<button class="btn danger" id="d-suspend">停權</button>'
          : '<button class="btn" id="d-unsuspend">恢復帳號</button>'}
      </div>
    </div>
    <h2>被擋下的留言（違規紀錄）</h2>
    <table><tr><th>時間</th><th>類別</th><th>原文</th></tr>
      ${(chat?.violations ?? []).map((v) => `<tr><td>${fmt(v.created_at)}</td>
        <td>${v.severe ? '<span class="pill bad">' : '<span class="pill">'}${CHAT_CAT[v.category] ?? v.category}</span></td><td>${esc(v.body)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">沒有</td></tr>'}
    </table>
    <h2>最近送出的留言</h2>
    <table><tr><th>時間</th><th>內容</th></tr>
      ${(chat?.messages ?? []).map((m) => `<tr><td>${fmt(m.created_at)}</td><td>${esc(m.body)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">沒有</td></tr>'}
    </table>
    <h2>實力分</h2>
    <table><tr><th>項目</th><th>實力分</th><th>場數</th><th>暫定期</th></tr>
      ${ratings.map((r) => `<tr><td>${{ '8ball': '8 號球', '9ball': '9 號球', '10ball': '10 號球' }[r.discipline] ?? r.discipline}</td>
        <td>${Math.round(r.rating)}</td><td>${r.games_played}</td><td>${r.provisional ? '是' : '否'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">沒有</td></tr>'}
    </table>
    <h2>等級紀錄</h2>
    <table><tr><th>時間</th><th>變動</th><th>原因</th><th>備註</th></tr>
      ${history.map((h) => `<tr><td>${fmt(h.created_at)}</td><td>${h.from_level ?? '—'} → ${h.to_level}</td>
        <td>${reason[h.reason] ?? h.reason}</td><td>${esc(h.note)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">沒有</td></tr>'}
    </table>`;
  const statusAction = async (clear, lock, ask) => {
    const note = prompt(ask + String.fromCharCode(10) + '原因（選填，會留紀錄）：', '');
    if (note === null) return;
    await run(db.rpc('admin_set_status', { p_user: id, p_clear: clear, p_lock: lock, p_note: note }), '已更新狀態');
    playerDetail(id);
  };
  if ($('#d-status-clear')) $('#d-status-clear').onclick = () => statusAction(true, null, '清除這位球員的狀態消息？');
  if ($('#d-status-lock')) $('#d-status-lock').onclick = () => statusAction(true, true, '清除狀態並禁止他修改？');
  if ($('#d-status-unlock')) $('#d-status-unlock').onclick = () => statusAction(false, false, '允許他再修改狀態？');
  $('#d-set').onclick = async () => {
    await run(db.rpc('admin_set_level', { p_player_id: id, p_level: $('#d-level').value, p_note: $('#d-note').value }), '已調整等級');
    playerDetail(id);
  };
  const chatMute = async (action, days, ask) => {
    const note = prompt(ask + String.fromCharCode(10) + '原因（選填，會留紀錄）：', '');
    if (note === null) return;
    await run(db.rpc('admin_set_chat_mute', { p_user: id, p_action: action, p_days: days, p_note: note }), '已更新');
    playerDetail(id);
  };
  $('#d-chat-7').onclick = () => chatMute('mute_days', 7, '禁言 7 天？');
  $('#d-chat-forever').onclick = () => chatMute('mute_forever', null, '停用這個人的留言功能（直到你解除）？');
  if ($('#d-chat-unmute')) $('#d-chat-unmute').onclick = () => chatMute('unmute', null, '解除禁言？');
  const setStatus = async (status) => {
    if (!confirm(status === 'suspended' ? '確定停權？停權後不能報名比賽。' : '確定恢復這個帳號？')) return;
    await run(db.from('profiles').update({ status }).eq('id', id), '已更新');
    playerDetail(id);
  };
  $('#d-suspend')?.addEventListener('click', () => setStatus('suspended'));
  $('#d-unsuspend')?.addEventListener('click', () => setStatus('active'));
  box.scrollIntoView({ behavior: 'smooth' });
}

// ---------------------------------------------------------------------
// 可疑名單（只標記，由負責人判斷，第 5.9 節）
// ---------------------------------------------------------------------
const CHAT_CAT = {
  gambling: '賭博', sexual: '色情', illegal: '違法', has_contact: '聯絡方式', has_link: '網址', inappropriate: '髒話',
};
const FLAG_TYPES = {
  final_forfeit: '決賽棄權',
  handicap_above_level: '讓球等級高於顯示等級（實力分超過自己的等級）',
  new_player_dominant: '新帳號很快就很強',
  repeated_pair: '同兩人重複對戰，幾乎都同一人贏',
  near_cap_no_promotion: '實力分長期貼著等級上限卻沒升級',
  upset_losses: '常輸給分數低很多的對手（可能故意輸球）',
  venue_fast_promotions: '這家球館認證的新人很多很快就升級（可能認證給太低）',
  dispute_own_win: '對自己贏的比賽提出爭議（會讓這場暫時不計分）',
  chat_gambling: '約戰留言提到賭博（已被擋下）',
  chat_sexual: '約戰留言有色情內容（已被擋下）',
  chat_illegal: '約戰留言有違法內容：毒品、高利貸、武器、威脅（已被擋下）',
  chat_muted: '約戰留言多次嚴重違規，已自動停用留言（請決定要不要停權）',
};
const DISC = { '8ball': '8 號球', '9ball': '9 號球', '10ball': '10 號球' };
async function flags() {
  const showAll = location.hash.includes('all=1');
  let q = db.from('suspicious_flags').select('*, player:profiles!suspicious_flags_player_id_fkey(display_name, level)').order('created_at', { ascending: false }).limit(200);
  if (!showAll) q = q.eq('status', 'open');
  const list = await run(q);
  // 細節裡的對手、球員、球館：換成名字
  const ids = [...new Set(list.flatMap((f) => [f.detail?.opponent, ...(f.detail?.players ?? [])]).filter(Boolean))];
  const vids = [...new Set(list.map((f) => f.detail?.venue_id).filter(Boolean))];
  const [people, venueRows] = await Promise.all([
    ids.length ? run(db.from('profiles').select('id, display_name').in('id', ids)) : [],
    vids.length ? run(db.from('venues').select('id, name').in('id', vids)) : [],
  ]);
  const names = Object.fromEntries([...people.map((p) => [p.id, p.display_name ?? '（已刪除）']), ...venueRows.map((v) => [v.id, v.name])]);
  page().innerHTML = `<h1>可疑名單</h1>
    <p class="hint">系統只標記，不會自動停權。請判斷後按「沒問題」或「已處理」。
      ${showAll ? '<a href="#/flags">只看待處理</a>' : '<a href="#/flags?all=1">看全部（含已處理）</a>'}</p>
    <table><tr><th>時間</th><th>球員</th><th>原因</th><th>細節</th><th>狀態</th><th></th></tr>
      ${list.map((f) => `<tr><td>${fmt(f.created_at)}</td>
        <td>${esc(f.player?.display_name)} ${f.player?.level ? `<span class="badge">${f.player.level}</span>` : ''}</td>
        <td>${esc(FLAG_TYPES[f.flag_type] ?? f.flag_type)}</td>
        <td class="hint">${esc(flagDetail(f, names))}</td>
        <td>${{ open: '<span class="pill warn">待處理</span>', dismissed: '<span class="pill">沒問題</span>', actioned: '<span class="pill ok">已處理</span>' }[f.status]}</td>
        <td>${f.status === 'open' ? `<div class="actions"><button class="btn small" data-flag="${f.id}" data-s="dismissed">沒問題</button>
          <button class="btn small" data-flag="${f.id}" data-s="actioned">已處理</button>
          <a class="btn small" href="#/players" data-player="${f.player_id}">看球員</a></div>` : ''}</td></tr>`).join('') ||
        '<tr><td colspan="6" class="muted">沒有待處理的項目</td></tr>'}
    </table>`;
  page().querySelectorAll('[data-player]').forEach((a) => (a.onclick = () => setTimeout(() => playerDetail(a.dataset.player), 300)));
  page().querySelectorAll('[data-flag]').forEach((b) => (b.onclick = async () => {
    const { data: { user } } = await db.auth.getUser();
    await run(db.from('suspicious_flags').update({ status: b.dataset.s, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq('id', b.dataset.flag), '已更新');
    flags();
  }));
}
function flagDetail(f, names = {}) {
  const d = f.detail ?? {};
  const n = (id) => names[id] ?? '?';
  switch (f.flag_type) {
    case 'handicap_above_level': return `顯示等級 ${d.display_level ?? '?'}，讓球等級 ${d.handicap_level ?? '?'}`;
    case 'new_player_dominant':
      return d.reason === 'early_championship'
        ? `拿冠軍前只打過 ${d.prior_games} 場計分對局`
        : `前 ${d.games} 場計分對局贏了 ${d.wins} 場（${Math.round((d.wins / d.games) * 100)}%）`;
    case 'repeated_pair': return `近 90 天和 ${n(d.opponent)} 打了 ${d.games} 場，贏了 ${d.wins} 場`;
    case 'near_cap_no_promotion':
      return `${DISC[d.discipline] ?? d.discipline}：最近 ${d.games} 場賽後分數都在 ${d.threshold} 以上（最低 ${d.min_rating}），仍是 ${d.level} 級`;
    case 'dispute_own_win': return `理由：${d.reason ?? ''}`;
    case 'chat_gambling':
    case 'chat_sexual':
    case 'chat_illegal': return `留言：「${d.text ?? ''}」`;
    case 'chat_muted': return `30 天內第 ${d.strikes} 次嚴重違規，最後一則：「${d.text ?? ''}」`;
    case 'upset_losses': return `近 ${d.days} 天輸給比自己低 ${d.gap} 分以上的對手 ${d.losses} 次`;
    case 'venue_fast_promotions':
      return `${n(d.venue_id)}：近 90 天認證 ${d.verified} 人，${d.fast} 人在 20 場內就靠實力分升級（${(d.players ?? []).map(n).join('、')}）`;
    default: return '';
  }
}

// ---------------------------------------------------------------------
// 比分爭議（處理完之前這場不計分，第 5.2 節）
// ---------------------------------------------------------------------
async function disputes() {
  const list = await run(db.from('disputes')
    .select('*, raiser:profiles!disputes_raised_by_fkey(display_name), match:matches(id, score_a, score_b, race_to_a, race_to_b, result_type, ' +
      'a:profiles!matches_player_a_fkey(display_name), b:profiles!matches_player_b_fkey(display_name), tournament:tournaments(name))')
    .eq('status', 'open').order('created_at'));
  page().innerHTML = `<h1>比分爭議</h1>
    <p class="hint">爭議處理完之前，這場不計實力分。比分沒問題就「維持原判」；比分要改就填正確比分後按「改比分並結案」。</p>
    ${list.map((d) => {
      const m = d.match ?? {};
      return `<div class="form" style="margin-bottom:12px">
        <div><b>${esc(m.tournament?.name)}</b>　${fmt(d.created_at)}</div>
        <div style="font-size:18px">${esc(m.a?.display_name)} <b>${m.score_a}</b>（搶 ${m.race_to_a}） – <b>${m.score_b}</b>（搶 ${m.race_to_b}） ${esc(m.b?.display_name)}</div>
        <div>提出人：${esc(d.raiser?.display_name)}　原因：${esc(d.reason)}</div>
        <div class="row">
          <div class="shrink"><label>正確比分 A</label><input id="sa-${d.id}" type="number" min="0" value="${m.score_a}" style="width:90px"></div>
          <div class="shrink"><label>B</label><input id="sb-${d.id}" type="number" min="0" value="${m.score_b}" style="width:90px"></div>
          <div><label>處理說明</label><input id="note-${d.id}"></div>
        </div>
        <div class="actions">
          <button class="btn" data-d="${d.id}" data-m="${m.id}" data-act="upheld">維持原判</button>
          <button class="btn gold inline" data-d="${d.id}" data-m="${m.id}" data-act="changed">改比分並結案</button>
          <button class="btn danger" data-d="${d.id}" data-m="${m.id}" data-act="rejected">駁回爭議</button>
        </div></div>`;
    }).join('') || '<p class="muted">沒有待處理的爭議</p>'}`;
  page().querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
    const note = $('#note-' + b.dataset.d).value;
    if (b.dataset.act === 'changed') {
      await run(db.rpc('set_match_score', { p_match_id: b.dataset.m,
        p_score_a: Number($('#sa-' + b.dataset.d).value), p_score_b: Number($('#sb-' + b.dataset.d).value) }));
    }
    await run(db.rpc('resolve_dispute', { p_match_id: b.dataset.m, p_resolution: b.dataset.act, p_note: note }), '已結案，這場重新計分');
    disputes();
  }));
}

// ---------------------------------------------------------------------
// 檢舉
// ---------------------------------------------------------------------
async function reports() {
  const list = await run(db.from('reports')
    .select('*, reporter:profiles!reports_reporter_id_fkey(display_name), target:profiles!reports_target_player_id_fkey(display_name, level)')
    .order('created_at', { ascending: false }).limit(200));
  page().innerHTML = `<h1>檢舉</h1>
    <table><tr><th>時間</th><th>被檢舉的球員</th><th>檢舉人</th><th>原因</th><th>狀態</th><th></th></tr>
      ${list.map((r) => `<tr><td>${fmt(r.created_at)}</td>
        <td>${esc(r.target?.display_name)} ${r.target?.level ? `<span class="badge">${r.target.level}</span>` : ''}</td>
        <td>${esc(r.reporter?.display_name)}</td><td>${esc(r.reason)}</td>
        <td>${{ open: '<span class="pill warn">待處理</span>', reviewed: '<span class="pill ok">已處理</span>', dismissed: '<span class="pill">不成立</span>' }[r.status]}</td>
        <td>${r.status === 'open' ? `<div class="actions"><button class="btn small" data-r="${r.id}" data-s="reviewed">已處理</button>
          <button class="btn small" data-r="${r.id}" data-s="dismissed">不成立</button></div>` : ''}</td></tr>`).join('') ||
        '<tr><td colspan="6" class="muted">沒有檢舉</td></tr>'}
    </table>`;
  page().querySelectorAll('[data-r]').forEach((b) => (b.onclick = async () => {
    const { data: { user } } = await db.auth.getUser();
    await run(db.from('reports').update({ status: b.dataset.s, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq('id', b.dataset.r), '已更新');
    reports();
  }));
}

// ---------------------------------------------------------------------
// 積分規則與設定（app_config）
// ---------------------------------------------------------------------
const CONFIG_NAMES = {
  elo: '實力分（Elo）參數',
  effective_rating: '有效分',
  levels: '等級門檻與認證起始分',
  handicap: '讓球',
  promotion: '升級條件',
  ranking_points: '排名積分',
  feature_flags: '功能開關',
  home_sections: 'App 首頁區塊與順序',
  bracket: '對戰表',
};
// ---------------------------------------------------------------------
// 驗證碼（負責人 2026-11-26 獨立出來）：Zalo 官方帳號、Zalo 即時額度與品質、發送統計、範本、上限
// ---------------------------------------------------------------------
const OTP_RESULT = {
  sent: '成功', not_configured: '還沒設定好（範本 ID 空白或官方帳號沒連結）', invalid_phone: '號碼不對',
  rate_limited: '超過上限被擋', zalo_account_not_found: '這個號碼沒有 Zalo', failed: 'Zalo 送不出去',
};
const QUALITY = { HIGH: '好', MEDIUM: '中', LOW: '差', UNDEFINED: '還沒評等' };
const ZBS_URL = 'https://account.zalo.solutions/VVUAMWWNKBPQ76RV';
const vnd = (n) => Number(n ?? 0).toLocaleString('vi-VN') + ' đ';

async function otp() {
  const rows = await run(db.from('app_config').select('*').in('key', ['zalo_otp', 'otp_limits']));
  const zaloCfg = rows.find((r) => r.key === 'zalo_otp')?.value ?? { template_id: null, param: 'otp', unit_price: 400 };
  const limits = rows.find((r) => r.key === 'otp_limits')?.value ?? { per_phone_per_day: 5, total_per_hour: 300 };
  const [zaloStatus, s] = await Promise.all([run(db.rpc('zalo_oa_status')), run(db.rpc('admin_otp_stats'))]);
  const zaloResult = { linked: '已連結 Zalo 官方帳號', cancelled: '已取消連結', expired: '連結逾時，請再按一次', failed: '連結失敗，請再試一次' };
  const zr = new URLSearchParams(location.hash.split('?')[1]).get('zalo');
  if (zr) { toast(zaloResult[zr] ?? zr, zr !== 'linked'); history.replaceState(null, '', '#/otp'); }
  const ready = zaloStatus.linked && zaloCfg.template_id;
  const w = s.windows ?? {};
  const card = (n, label, sub = '') => `<div class="card"><div class="num">${n}</div><div class="label">${label}</div>${sub ? `<div class="hint">${sub}</div>` : ''}</div>`;

  page().innerHTML = `<h1>驗證碼</h1>
    <p class="hint">註冊、忘記密碼時用 Zalo 送 6 位數驗證碼（平常登入不用）。${ready
      ? '<span class="pill ok">可以送</span>'
      : '<span class="pill bad">還不能送</span> 要官方帳號已連結＋範本 ID 填好（範本要 Zalo 審核通過）。'}</p>

    <h2>Zalo 即時狀態</h2>
    <div class="cards" id="otp-live"><p class="muted">查詢 Zalo 中…</p></div>
    <p class="hint">餘額 Zalo 沒有提供查詢的 API，請到 <a href="${ZBS_URL}/spending/overview" target="_blank" rel="noopener">ZBS 後台</a> 看（右上角「Số dư」）。
      <a href="${ZBS_URL}/tool/zns/manage/template" target="_blank" rel="noopener">範本審核狀態</a> ·
      <a href="${ZBS_URL}/topup" target="_blank" rel="noopener">儲值</a> ·
      <a href="https://oa.zalo.me/manage/subscription" target="_blank" rel="noopener">官方帳號方案</a></p>

    <h2>我們送出的驗證碼</h2>
    <div class="cards">
      ${card(w.today?.sent ?? 0, '今天成功', `失敗 ${w.today?.failed ?? 0} · 約 ${vnd(w.today?.cost)}`)}
      ${card(w.d7?.sent ?? 0, '近 7 天成功', `失敗 ${w.d7?.failed ?? 0} · 約 ${vnd(w.d7?.cost)}`)}
      ${card(w.d30?.sent ?? 0, '近 30 天成功', `失敗 ${w.d30?.failed ?? 0} · 約 ${vnd(w.d30?.cost)}`)}
      ${card(s.last_hour ?? 0, '最近一小時送出', `上限 ${limits.total_per_hour ?? 300} 則／小時`)}
    </div>
    <p class="hint">花費是用「成功則數 × 每則單價 ${vnd(s.unit_price)}」估的，實際以 ZBS 帳單為準。
      ${s.last_sent_at ? '最近一次成功：' + fmt(s.last_sent_at) + '。' : '還沒有成功送出過。'}
      ${s.last_failure ? `最近一次失敗：${fmt(s.last_failure.at)}（${esc(OTP_RESULT[s.last_failure.result] ?? s.last_failure.result)}${s.last_failure.zalo_error ? '，Zalo 錯誤 ' + s.last_failure.zalo_error : ''}）。` : ''}</p>
    <table><tr><th>日期（越南時間）</th><th>成功</th><th>失敗</th><th>約花費</th></tr>
      ${(s.daily ?? []).map((d) => `<tr><td>${esc(d.day)}</td><td>${d.sent}</td><td>${d.failed ? `<span class="pill bad">${d.failed}</span>` : '0'}</td><td>${vnd(d.sent * s.unit_price)}</td></tr>`).join('')}
    </table>
    ${Object.keys(s.by_result_30d ?? {}).filter((k) => k !== 'sent').length ? `<p class="hint">近 30 天失敗原因：${Object.entries(s.by_result_30d).filter(([k]) => k !== 'sent').map(([k, n]) => esc(OTP_RESULT[k] ?? k) + ' ' + n).join('、')}</p>` : ''}

    <h2>Zalo 官方帳號</h2>
    <div class="form">
      <div>${zaloStatus.linked
        ? `<span class="pill ok">已連結</span> <span class="hint">OA ${esc(zaloStatus.oa_id ?? '')}，token 更新於 ${fmt(zaloStatus.updated_at)}（每天自動更新）</span>`
        : '<span class="pill bad">還沒連結</span>'}</div>
      <div><button class="btn${zaloStatus.linked ? '' : ' gold inline'}" id="zalo-link">${zaloStatus.linked ? '重新連結' : '連結 Zalo 官方帳號'}</button>
        <span class="hint">會打開 Zalo 授權頁，請用 OA 管理員的 Zalo 按「允許」。</span></div>
    </div>

    <h2>範本</h2>
    <div class="form">
      <div class="row">
        <div><label>驗證碼範本 ID（Zalo 審核通過後拿到）</label><input id="zalo-tpl" value="${esc(zaloCfg.template_id)}"></div>
        <div class="shrink"><label>範本參數名稱</label><input id="zalo-param" value="${esc(zaloCfg.param ?? 'otp')}" style="width:120px"></div>
        <div class="shrink"><label>每則單價（VND，估花費用）</label><input id="zalo-price" type="number" min="0" value="${esc(zaloCfg.unit_price ?? 400)}" style="width:120px"></div>
        <button class="btn gold inline" id="zalo-save">儲存</button>
      </div>
      <p class="hint">範本 ID 空白時，App 會顯示「目前無法傳送驗證碼」（Zalo 登入不受影響）。</p>
    </div>

    <h2>發送上限（防止被狂發浪費錢）</h2>
    <div class="form">
      <div class="row">
        <div class="shrink"><label>同一個號碼 24 小時最多幾則</label><input id="otp-per-phone" type="number" min="1" value="${esc(limits.per_phone_per_day ?? 5)}" style="width:120px"></div>
        <div class="shrink"><label>全平台每小時最多幾則</label><input id="otp-per-hour" type="number" min="1" value="${esc(limits.total_per_hour ?? 300)}" style="width:120px"></div>
        <button class="btn gold inline" id="otp-limits-save">儲存上限</button>
      </div>
      <p class="hint">每小時用到 80% 時 Telegram 會發警報。辦大型活動前可以先調高每小時上限。</p>
    </div>`;

  // Zalo 即時額度、品質（要 OA 成長方案以上）
  (async () => {
    const box = $('#otp-live');
    if (!zaloStatus.linked) { box.innerHTML = '<p class="muted">官方帳號還沒連結。</p>'; return; }
    try {
      const { data: { session } } = await db.auth.getSession();
      const res = await fetch(SUPABASE_URL + '/functions/v1/zalo-otp/stats', {
        method: 'POST', headers: { Authorization: 'Bearer ' + session?.access_token, apikey: SUPABASE_KEY },
      });
      const out = await res.json();
      const q = out.quota;
      const ql = out.quality;
      const needUpgrade = [out.quota_error, out.quality_error].some((e) => e && e.code === -120);
      box.innerHTML = (q
        ? card(q.dailyQuota ?? '–', 'Zalo 每日額度') + card(q.remainingQuota ?? '–', '今天還能送',
            '已用 ' + ((q.dailyQuota ?? 0) - (q.remainingQuota ?? 0)) + ' 則')
        : '') +
        (ql ? card(esc(QUALITY[ql.oaCurrentQuality] ?? ql.oaCurrentQuality ?? '–'), '傳送品質（目前）', '近 7 天：' + esc(QUALITY[ql.oa7dayQuality] ?? ql.oa7dayQuality ?? '–')) : '') +
        (needUpgrade
          ? '<p class="msg">Zalo 回覆「官方帳號沒有權限」（-120）：要把官方帳號升級到「成長方案（Tăng trưởng）」以上，才能用 API 送驗證碼和查額度。<a href="https://oa.zalo.me/manage/subscription" target="_blank" rel="noopener">去升級</a></p>'
          : (!q && out.quota_error ? '<p class="msg">查額度失敗：' + esc(out.quota_error.message ?? out.quota_error.code) + '</p>' : ''));
    } catch (e) {
      box.innerHTML = '<p class="msg">連不上 Zalo：' + esc(String(e)) + '</p>';
    }
  })();

  $('#zalo-save').onclick = async () => {
    const value = { ...zaloCfg, template_id: $('#zalo-tpl').value.trim() || null, param: $('#zalo-param').value.trim() || 'otp',
      unit_price: Number($('#zalo-price').value) || 400 };
    await run(db.from('app_config').update({ value }).eq('key', 'zalo_otp'), '已儲存範本設定');
    otp();
  };
  $('#otp-limits-save').onclick = async () => {
    const perPhone = Number($('#otp-per-phone').value);
    const perHour = Number($('#otp-per-hour').value);
    if (!(perPhone >= 1 && perHour >= 1)) return toast('上限要大於 0', true);
    await run(db.from('app_config').update({ value: { ...limits, per_phone_per_day: perPhone, total_per_hour: perHour } }).eq('key', 'otp_limits'), '已儲存上限');
    otp();
  };
  $('#zalo-link').onclick = async () => {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/zalo-otp/oa/start', {
      method: 'POST', headers: { Authorization: 'Bearer ' + session?.access_token, apikey: SUPABASE_KEY },
    });
    const out = await res.json().catch(() => ({}));
    if (!out.url) return toast('無法開始連結：' + (out.error ?? res.status), true);
    location.href = out.url;
  };
}

const FLAG_NAMES = { zalo_login: 'Zalo 登入', challenges: '約戰', email_otp: 'Email 驗證碼註冊（Zalo 驗證碼還不能用時的備案；Zalo 好了請關掉）' };
const TIER_HELP = '比賽分級代碼（weekly = 球館週賽、monthly = 球館月賽、quarterly = 季賽、open = 公開賽），建立比賽時選的分級要和這裡一樣；重要的比賽可以給比較多分。';

async function rules() {
  const rows = await run(db.from('app_config').select('*').order('key'));
  const get = (k) => rows.find((r) => r.key === k);
  const flagsRow = get('feature_flags');
  const rp = get('ranking_points')?.value ?? { window_months: 12, tiers: {} };
  // 舊的 Zalo 連結回傳網址（#/rules?zalo=…）轉到「驗證碼」頁
  const zr = new URLSearchParams(location.hash.split('?')[1]).get('zalo');
  if (zr) { location.hash = '#/otp?zalo=' + encodeURIComponent(zr); return; }
  page().innerHTML = `<h1>積分規則與設定</h1>
    <p class="hint">登入驗證碼（Zalo 官方帳號、範本、發送上限、用量）在左邊的「<a href="#/otp">驗證碼</a>」頁。</p>

    <h2>功能開關</h2>
    <div class="form" id="flags-box">
      ${Object.entries(flagsRow?.value ?? {}).map(([k, v]) => `<label class="switch"><input type="checkbox" data-flagkey="${esc(k)}" ${v ? 'checked' : ''}>
        <span style="font-size:15px;color:var(--text)">${esc(FLAG_NAMES[k] ?? k)}</span></label>`).join('')}
      <div><button class="btn gold inline" id="flags-save">儲存功能開關</button></div>
    </div>

    <h2>排名積分（第 5.10 節）</h2>
    <div class="form">
      <p class="hint">${TIER_HELP}</p>
      <p class="hint">計算期間：<select id="rp-window" style="width:auto;display:inline-block">
          <option value="season" ${(rp.window ?? 'season') !== 'months' ? 'selected' : ''}>本季（越南時間三個月一季，每季從 0 開始）</option>
          <option value="months" ${rp.window === 'months' ? 'selected' : ''}>最近幾個月</option>
        </select>
        <span id="rp-months-box">最近 <input id="rp-months" type="number" min="1" value="${rp.window_months ?? 12}" style="width:80px;display:inline-block"> 個月</span>
        　名次變動（▲▼）和 <input id="rp-change-days" type="number" min="1" value="${rp.change_days ?? 7}" style="width:70px;display:inline-block"> 天前比</p>
      <table id="tiers"><tr><th>分級代碼</th>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<th>第 ${n} 名</th>`).join('')}<th></th></tr></table>
      <div class="actions"><button class="btn" id="tier-add">新增分級</button><button class="btn gold inline" id="rp-save">儲存排名積分</button></div>
      <p class="hint">雙敗或單淘汰時，同一輪被淘汰的人名次相同，下一個名次會跳號（例如兩位四強都是第 3 名，就沒有第 4 名，接下來是第 5 名）。空白 = 0 分。</p>
    </div>

    <h2>全部重算</h2>
    <div class="form">
      <p class="hint">改了實力分參數（Elo、讓球、等級門檻）之後，按這裡用全部比賽紀錄重算所有人的實力分（第 5.3 節）。顯示等級不會因此下降。</p>
      <div><button class="btn danger" id="recompute">全部重算實力分</button></div>
    </div>

    <h2>其他參數（進階）</h2>
    <p class="hint">⚠ 等級只升不降，調高等級門檻前請先想清楚（第 5.11 節）。格式是 JSON，存檔前會檢查格式。</p>
    ${rows.filter((r) => !['feature_flags', 'ranking_points', 'zalo_otp', 'otp_limits'].includes(r.key)).map((r) => `
      <div class="form" style="margin-bottom:12px">
        <div><b>${esc(CONFIG_NAMES[r.key] ?? r.key)}</b> <span class="muted">（${esc(r.key)}）</span></div>
        <div class="hint">${esc(r.description)}</div>
        <textarea id="cfg-${esc(r.key)}">${esc(JSON.stringify(r.value, null, 2))}</textarea>
        <div><button class="btn" data-cfg="${esc(r.key)}">儲存</button></div>
      </div>`).join('')}`;

  // 排名積分表格
  const tiersTable = $('#tiers');
  const addTierRow = (code = '', pts = {}) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input class="tier-code" value="${esc(code)}" placeholder="weekly"></td>` +
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<td><input class="tier-pt" data-n="${n}" type="number" min="0" value="${pts[n] ?? ''}" style="width:80px"></td>`).join('') +
      '<td><button class="btn small danger">刪除</button></td>';
    tr.querySelector('button').onclick = () => tr.remove();
    tiersTable.tBodies[0].appendChild(tr);
  };
  Object.entries(rp.tiers ?? {}).forEach(([code, pts]) => addTierRow(code, pts));
  if (!Object.keys(rp.tiers ?? {}).length) addTierRow();
  $('#tier-add').onclick = () => addTierRow();
  // 選「本季」時不用填幾個月
  const syncWindow = () => { $('#rp-months-box').style.display = $('#rp-window').value === 'months' ? '' : 'none'; };
  $('#rp-window').onchange = syncWindow;
  syncWindow();
  $('#rp-save').onclick = async () => {
    const tiers = {};
    tiersTable.querySelectorAll('tr').forEach((tr) => {
      const code = tr.querySelector('.tier-code')?.value.trim();
      if (!code) return;
      const pts = {};
      tr.querySelectorAll('.tier-pt').forEach((i) => { if (i.value !== '') pts[i.dataset.n] = Number(i.value); });
      tiers[code] = pts;
    });
    const value = {
      ...rp,
      window: $('#rp-window').value === 'months' ? 'months' : 'season',
      window_months: Number($('#rp-months').value) || 12,
      change_days: Number($('#rp-change-days').value) || 7,
      tiers,
    };
    await run(db.from('app_config').update({ value }).eq('key', 'ranking_points'), '已儲存排名積分');
  };

  $('#flags-save').onclick = async () => {
    const value = { ...(flagsRow?.value ?? {}) };
    document.querySelectorAll('[data-flagkey]').forEach((c) => { value[c.dataset.flagkey] = c.checked; });
    await run(db.from('app_config').update({ value }).eq('key', 'feature_flags'), '已儲存功能開關');
  };
  $('#recompute').onclick = async () => {
    if (!confirm('確定用全部比賽紀錄重算所有人的實力分？')) return;
    await run(db.rpc('recompute_ratings'), '已全部重算');
  };
  page().querySelectorAll('[data-cfg]').forEach((b) => (b.onclick = async () => {
    let value;
    try { value = JSON.parse($('#cfg-' + b.dataset.cfg).value); } catch { return toast('格式不正確（JSON），沒有存檔', true); }
    await run(db.from('app_config').update({ value }).eq('key', b.dataset.cfg), '已儲存');
  }));
}

// ---------------------------------------------------------------------
// 廣告
// ---------------------------------------------------------------------
const SLOTS = { home_hero: '首頁大圖輪播（16:9）', home_banner: '首頁橫幅', ranking_banner: '排行榜橫幅', splash: '開啟畫面' };
// 各位置建議的圖片尺寸
const SLOT_SIZE = { home_hero: '建議 1920×1080（16:9）', home_banner: '建議 1600×600', ranking_banner: '建議 1600×600', splash: '建議 1080×1920 直式（9:16），重點放中間，上下左右可能被裁一點' };
const localInput = (d) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
async function ads() {
  const [list, stats, venueList] = await Promise.all([
    run(db.from('ads').select('*').order('created_at', { ascending: false })),
    run(db.rpc('ad_stats')),
    run(db.from('venues').select('id, name').order('name')),
  ]);
  const st = Object.fromEntries(stats.map((s) => [s.ad_id, s]));
  page().innerHTML = `<h1>廣告</h1>
    <table><tr><th>圖片</th><th>位置</th><th>期間</th><th>曝光／點擊</th><th>狀態</th><th></th></tr>
      ${list.map((a) => `<tr><td><img class="thumb" src="${esc(a.image_url)}" alt=""></td>
        <td>${esc(SLOTS[a.slot] ?? a.slot)}<div class="hint">${a.venue_ids?.length ? a.venue_ids.length + ' 家球館' : '全部球館'}</div>
          ${a.link && /^(https?:\/\/|\/tournament\/)/.test(a.link) ? `<div class="hint"><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">連結</a></div>` : ''}</td>
        <td class="hint">${fmt(a.starts_at)}<br>到 ${fmt(a.ends_at)}</td>
        <td>${st[a.id]?.impressions ?? 0} ／ ${st[a.id]?.clicks ?? 0}<div class="hint">${st[a.id]?.viewers ?? 0} 人看過</div></td>
        <td>${a.active ? '<span class="pill ok">上架</span>' : '<span class="pill">下架</span>'}</td>
        <td><div class="actions"><button class="btn small" data-toggle="${a.id}" data-on="${a.active}">${a.active ? '下架' : '上架'}</button>
          <button class="btn small danger" data-del="${a.id}">刪除</button></div></td></tr>`).join('') ||
        '<tr><td colspan="6" class="muted">還沒有廣告</td></tr>'}
    </table>
    <h2>新增廣告</h2>
    <div class="form">
      <div class="row">
        <div><label>位置</label><select id="a-slot">${Object.entries(SLOTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div><label>圖片（<span id="a-size">${SLOT_SIZE.home_hero}</span>，2 MB 以內）</label><input id="a-img" type="file" accept="image/png,image/jpeg,image/webp"></div>
      </div>
      <div><label>點了要開的網址（可以空白）</label><input id="a-link" placeholder="https://… 或 App 內頁面 /tournament/比賽ID"><div class="hint">https:// 開頭會開瀏覽器；/ 開頭會開 App 內的頁面（例如某場比賽）</div></div>
      <div class="row">
        <div><label>開始時間（空白 = 馬上）</label><input id="a-start" type="datetime-local"></div>
        <div><label>結束時間（空白 = 不結束）</label><input id="a-end" type="datetime-local"></div>
      </div>
      <div><label>只在這些球館顯示（都不勾 = 全部球館）</label>
        <div class="row">${venueList.map((v) => `<label class="switch"><input type="checkbox" class="a-venue" value="${v.id}"><span style="color:var(--text)">${esc(v.name)}</span></label>`).join('')}</div></div>
      <div><button class="btn gold inline" id="a-save">上傳並上架</button></div>
    </div>`;
  $('#a-slot').onchange = () => ($('#a-size').textContent = SLOT_SIZE[$('#a-slot').value] ?? '');
  page().querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = async () => {
    await run(db.from('ads').update({ active: b.dataset.on !== 'true' }).eq('id', b.dataset.toggle), '已更新');
    ads();
  }));
  page().querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('確定刪除這則廣告？曝光和點擊紀錄也會一起刪除。')) return;
    await run(db.from('ads').delete().eq('id', b.dataset.del), '已刪除');
    ads();
  }));
  $('#a-save').onclick = async () => {
    const file = $('#a-img').files[0];
    if (!file) return toast('請選擇圖片', true);
    if (file.size > 2 * 1024 * 1024) return toast('圖片超過 2 MB', true);
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = crypto.randomUUID() + '.' + ext;
    await run(db.storage.from('ads').upload(path, file, { contentType: file.type }));
    const url = db.storage.from('ads').getPublicUrl(path).data.publicUrl;
    const venuesChecked = [...document.querySelectorAll('.a-venue:checked')].map((c) => c.value);
    await run(db.from('ads').insert({
      slot: $('#a-slot').value,
      image_url: url,
      link: $('#a-link').value.trim() || null,
      starts_at: $('#a-start').value ? new Date($('#a-start').value).toISOString() : null,
      ends_at: $('#a-end').value ? new Date($('#a-end').value).toISOString() : null,
      venue_ids: venuesChecked.length ? venuesChecked : null,
      active: true,
    }), '已上架');
    ads();
  };
}

// ---------------------------------------------------------------------
// 推播
// ---------------------------------------------------------------------
async function push() {
  const [list, venueList] = await Promise.all([
    run(db.from('push_campaigns').select('*').order('created_at', { ascending: false }).limit(100)),
    run(db.from('venues').select('id, name').order('name')),
  ]);
  const vname = Object.fromEntries(venueList.map((v) => [v.id, v.name]));
  const aud = (a) => a?.type === 'venue' ? '球館：' + (vname[a.venue_id] ?? '?') : a?.type === 'level' ? '等級：' + (a.levels ?? []).join('、') : '全體';
  page().innerHTML = `<h1>推播</h1>
    <div class="form">
      <div><label>標題</label><input id="c-title" maxlength="60" placeholder="例如：Giải tuần này đã mở đăng ký!"></div>
      <div><label>內容</label><textarea id="c-body" style="min-height:80px;font-family:inherit;font-size:15px" maxlength="300"></textarea></div>
      <p class="hint">推播照你寫的文字送出，不會自動翻譯；球員大多是越南人，建議用越南語。</p>
      <div class="row">
        <div><label>對象</label><select id="c-aud"><option value="all">全體</option><option value="venue">某家球館的球員</option><option value="level">某些等級</option></select></div>
        <div id="c-venue-box" class="hidden"><label>球館</label><select id="c-venue">${venueList.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
        <div id="c-level-box" class="hidden"><label>等級</label><div class="row">${LEVELS.map((l) => `<label class="switch"><input type="checkbox" class="c-level" value="${l}"><span style="color:var(--text)">${l}</span></label>`).join('')}</div></div>
      </div>
      <div class="row">
        <div><label>預約時間（空白 = 立即送出）</label><input id="c-when" type="datetime-local"></div>
        <button class="btn gold inline" id="c-send">送出</button>
      </div>
    </div>
    <h2>紀錄</h2>
    <table><tr><th>建立</th><th>標題</th><th>對象</th><th>預約</th><th>送出</th></tr>
      ${list.map((c) => `<tr><td>${fmt(c.created_at)}</td><td><b>${esc(c.title)}</b><div class="hint">${esc(c.body)}</div></td>
        <td>${esc(aud(c.audience))}</td><td>${fmt(c.scheduled_at)}</td>
        <td>${c.sent_at ? fmt(c.sent_at) : `<span class="pill warn">等待中</span> <button class="btn small" data-sendnow="${c.id}">立即送出</button>`}</td></tr>`).join('') ||
        '<tr><td colspan="5" class="muted">還沒有推播</td></tr>'}
    </table>`;
  $('#c-aud').onchange = () => {
    $('#c-venue-box').classList.toggle('hidden', $('#c-aud').value !== 'venue');
    $('#c-level-box').classList.toggle('hidden', $('#c-aud').value !== 'level');
  };
  page().querySelectorAll('[data-sendnow]').forEach((b) => (b.onclick = async () => {
    if (!confirm('確定現在送出？')) return;
    const n = await run(db.rpc('send_campaign', { p_campaign_id: b.dataset.sendnow }));
    toast('已送出給 ' + n + ' 人');
    push();
  }));
  $('#c-send').onclick = async () => {
    const title = $('#c-title').value.trim(), body = $('#c-body').value.trim();
    if (!title || !body) return toast('請填標題和內容', true);
    const type = $('#c-aud').value;
    const audience = type === 'venue' ? { type, venue_id: $('#c-venue').value }
      : type === 'level' ? { type, levels: [...document.querySelectorAll('.c-level:checked')].map((c) => c.value) } : { type: 'all' };
    if (type === 'level' && !audience.levels.length) return toast('請至少勾一個等級', true);
    const when = $('#c-when').value ? new Date($('#c-when').value).toISOString() : null;
    if (!confirm(when ? '確定預約這則推播？' : '確定現在送出給「' + aud(audience) + '」？')) return;
    const { data: { user } } = await db.auth.getUser();
    const created = await run(db.from('push_campaigns').insert({ title, body, audience, scheduled_at: when, created_by: user.id }).select('id').single());
    if (!when) {
      const n = await run(db.rpc('send_campaign', { p_campaign_id: created.id }));
      toast('已送出給 ' + n + ' 人');
    } else {
      toast('已預約');
    }
    push();
  };
}

start();

// ---------------------------------------------------------------------
// 吉利號碼（負責人 2026-11-25）：保留的豹子號、吉利號碼由管理員指定給會員
// 指定後會員編號換成吉利號碼；收回換回原本的號碼，吉利號碼回到可用清單
// ---------------------------------------------------------------------
const LUCKY_CAT = { leopard: '豹子號', straight: '連號', pattern: '對稱號碼', combo: '吉利組合', ending: '吉利結尾' };
async function lucky() {
  page().innerHTML = `<h1>吉利號碼</h1>
    <p class="hint">豹子號、吉利號碼不會自動發給新會員，要在這裡指定。指定後，會員的編號會換成吉利號碼；原本的號碼保留在他名下，按「收回」就換回來，吉利號碼也會回到可用清單。</p>
    <h2>已專屬的號碼</h2>
    <div id="l-assigned"></div>
    <h2 style="margin-top:28px">指定吉利號碼給會員</h2>
    <div class="form">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div class="shrink"><label>分類</label>
          <select id="l-cat"><option value="">全部</option>${Object.entries(LUCKY_CAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="shrink"><label>包含的數字（選填）</label><input id="l-contains" placeholder="例如 888、168" style="width:160px" inputmode="numeric"></div>
        <button class="btn inline" id="l-find-no">查詢可用號碼</button>
      </div>
      <label style="margin-top:12px">可用的號碼</label>
      <select id="l-no"><option value="">（先按「查詢可用號碼」）</option></select>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:12px">
        <div><label>會員（VN 編號、名字或手機號碼）</label><input id="l-q" placeholder="例如 VN 482915、Minh、0901234567"></div>
        <button class="btn inline" id="l-find-user">找會員</button>
      </div>
      <label style="margin-top:12px">要給誰</label>
      <select id="l-user"><option value="">（先按「找會員」）</option></select>
      <label style="margin-top:12px">備註（選填，例如：老闆送的、活動獎品）</label>
      <input id="l-note">
      <div class="actions" style="margin-top:14px"><button class="btn gold inline" id="l-assign">指定</button></div>
    </div>`;

  const loadAssigned = async () => {
    const list = await run(db.rpc('admin_lucky_assignments'));
    $('#l-assigned').innerHTML = `<table><tr><th>號碼</th><th>分類</th><th>會員</th><th>原本的號碼</th><th>指定人</th><th>指定時間</th><th></th></tr>
      ${list.map((r) => `<tr>
        <td style="white-space:nowrap"><b>VN ${esc(r.no)}</b></td>
        <td>${esc(LUCKY_CAT[r.category] ?? r.category ?? '')}</td>
        <td>${esc(r.display_name ?? '（已刪除）')} ${r.level ? `<span class="badge">${esc(r.level)}</span>` : ''}</td>
        <td style="white-space:nowrap">${r.original_no ? 'VN ' + esc(r.original_no) : '—'}</td>
        <td>${esc(r.assigned_by_name ?? '—')}</td>
        <td>${fmt(r.assigned_at)}</td>
        <td>${r.user_id ? `<button class="btn small" data-revoke="${r.user_id}" data-no="${r.no}">收回</button>` : ''}</td></tr>`).join('') ||
        '<tr><td colspan="7" class="muted">還沒有專屬的吉利號碼</td></tr>'}
      </table>`;
    $('#l-assigned').querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = async () => {
      const note = prompt(`收回 VN ${b.dataset.no}？會員會換回原本的號碼。\n備註（選填）：`, '');
      if (note === null) return;
      await run(db.rpc('admin_revoke_lucky_no', { p_user: b.dataset.revoke, p_note: note }), '已收回，會員換回原本的號碼');
      loadAssigned();
    }));
  };

  $('#l-find-no').onclick = async () => {
    const list = await run(db.rpc('admin_available_lucky_numbers', {
      p_category: $('#l-cat').value || null, p_contains: $('#l-contains').value.trim() || null, p_limit: 300,
    }));
    $('#l-no').innerHTML = list.length
      ? list.map((r) => `<option value="${r.no}">VN ${r.no}（${esc(LUCKY_CAT[r.category] ?? r.category)}）</option>`).join('')
      : '<option value="">沒有符合的可用號碼</option>';
    toast(`找到 ${list.length} 個可用號碼${list.length >= 300 ? '（只列前 300 個，可以用「包含的數字」縮小範圍）' : ''}`);
  };

  $('#l-find-user').onclick = async () => {
    const q = $('#l-q').value.trim();
    if (!q) return toast('請輸入 VN 編號、名字或手機號碼', true);
    const sn = parseSN(q);
    const list = sn ? await membersBySN(sn, false) : await run(db.rpc('admin_members', { p_query: q, p_limit: 30, p_offset: 0, p_export: false }));
    const nos = await memberNoMap(list.map((m) => m.id));
    $('#l-user').innerHTML = list.length
      ? list.map((m) => `<option value="${m.id}">${esc(m.display_name ?? '（未設定暱稱）')} · VN ${esc(nos[m.id] ?? '—')}${m.phone ? ' · ' + esc(m.phone) : ''}${m.level ? ' · ' + esc(m.level) + ' 級' : ''}</option>`).join('')
      : '<option value="">找不到會員</option>';
  };
  $('#l-q').onkeydown = (e) => { if (e.key === 'Enter') $('#l-find-user').click(); };

  $('#l-assign').onclick = async () => {
    const no = Number($('#l-no').value);
    const user = $('#l-user').value;
    if (!no) return toast('請先選號碼', true);
    if (!user) return toast('請先選會員', true);
    const who = $('#l-user').selectedOptions[0]?.textContent ?? '';
    if (!confirm(`把 VN ${no} 指定給「${who}」？\n他的會員編號會換成 VN ${no}。`)) return;
    await run(db.rpc('admin_assign_lucky_no', { p_user: user, p_no: no, p_note: $('#l-note').value.trim() || null }), `已指定 VN ${no}`);
    $('#l-no').innerHTML = '<option value="">（先按「查詢可用號碼」）</option>';
    $('#l-note').value = '';
    loadAssigned();
  };

  await loadAssigned();
}

// ---------------------------------------------------------------------
// 問題回報（上架前 2026-11-26）：App「設定 → 回報問題」送來的；截圖不公開，用 15 分鐘的臨時網址看
// ---------------------------------------------------------------------
const FB_CAT = { bug: '錯誤', suggestion: '建議', payment: '付款', account: '帳號', other: '其他' };
const FB_STATUS = {
  open: '<span class="pill warn">待處理</span>', in_progress: '<span class="pill">處理中</span>',
  resolved: '<span class="pill ok">已解決</span>', dismissed: '<span class="pill">不處理</span>',
};
async function feedback() {
  const want = new URLSearchParams(location.hash.split('?')[1]).get('status') ?? 'open';
  let q = db.from('feedback').select('*, user:profiles!feedback_user_id_fkey(display_name, member_no)')
    .order('created_at', { ascending: false }).limit(200);
  if (want !== 'all') q = q.eq('status', want);
  const list = await run(q);
  const shots = {};
  await Promise.all(list.filter((f) => f.screenshot).map(async (f) => {
    const { data } = await db.storage.from('feedback').createSignedUrl(f.screenshot, 900);
    shots[f.id] = data?.signedUrl;
  }));
  page().innerHTML = `<h1>問題回報</h1>
    <p class="hint">會員在 App「設定 → 回報問題」送來的。每人每天最多 5 則（app_config.feedback）。</p>
    <div class="actions">${['open', 'in_progress', 'resolved', 'dismissed', 'all'].map((s) =>
      `<a class="btn small ${s === want ? 'gold' : ''}" href="#/feedback?status=${s}">${{ open: '待處理', in_progress: '處理中', resolved: '已解決', dismissed: '不處理', all: '全部' }[s]}</a>`).join('')}</div>
    <table><tr><th>時間</th><th>會員</th><th>類型</th><th>內容</th><th>手機／版本</th><th>狀態</th><th></th></tr>
      ${list.map((f) => `<tr><td>${fmt(f.created_at)}</td>
        <td>${esc(f.user?.display_name ?? '（已刪除）')}${f.user?.member_no ? `<br><span class="muted">VN ${f.user.member_no}</span>` : ''}</td>
        <td>${esc(FB_CAT[f.category] ?? f.category)}</td>
        <td style="max-width:420px;white-space:pre-wrap">${esc(f.body)}${shots[f.id] ? `<br><a href="${esc(shots[f.id])}" target="_blank" rel="noopener">看截圖</a>` : ''}
          ${f.admin_note ? `<br><span class="muted">備註：${esc(f.admin_note)}</span>` : ''}</td>
        <td class="muted">${esc(f.device ?? '')}<br>${esc(f.os_version ?? '')}<br>${esc(f.app_version ?? '')} · ${esc(f.locale ?? '')}<br>${esc(f.route ?? '')}</td>
        <td>${FB_STATUS[f.status] ?? esc(f.status)}</td>
        <td><div class="actions">${['in_progress', 'resolved', 'dismissed'].filter((s) => s !== f.status).map((s) =>
          `<button class="btn small" data-fb="${f.id}" data-s="${s}">${{ in_progress: '處理中', resolved: '已解決', dismissed: '不處理' }[s]}</button>`).join('')}</div></td></tr>`).join('') ||
        '<tr><td colspan="7" class="muted">沒有回報</td></tr>'}
    </table>`;
  page().querySelectorAll('[data-fb]').forEach((b) => (b.onclick = async () => {
    const note = b.dataset.s === 'in_progress' ? null : (prompt('備註（選填）') ?? null);
    await run(db.rpc('admin_handle_feedback', { p_id: Number(b.dataset.fb), p_status: b.dataset.s, p_note: note || null }), '已更新');
    feedback();
  }));
}

// ---------------------------------------------------------------------
// 版本與維護（上架前 2026-11-26）：app_config.app_status
//   最低版本：低於這個版本號（pubspec 的 +N）的 App 一定要更新才能用
//   最新版本：低於這個會提醒有新版（可以略過）
//   維護模式：打開後 App 顯示維護畫面（管理員照常可以用）
// ---------------------------------------------------------------------
async function release() {
  const row = (await run(db.from('app_config').select('value').eq('key', 'app_status').maybeSingle()));
  const v = row?.value ?? {};
  const a = v.android ?? {};
  const m = v.maintenance ?? {};
  const msg = m.message ?? {};
  page().innerHTML = `<h1>版本與維護</h1>
    <h2>強制更新（Android）</h2>
    <div class="form">
      <p class="hint">版本號 = App「設定」最下面「版本 1.0.13」後面的建置號碼（pubspec.yaml 的 +N，例如 1.0.13+14 的 14）。</p>
      <label>最低版本號（低於這個一定要更新，0 = 不擋）<input id="rl-min" type="number" min="0" value="${Number(a.min_build ?? 0)}"></label>
      <label>最新版本號（低於這個會提醒有新版，0 = 不提醒）<input id="rl-latest" type="number" min="0" value="${Number(a.latest_build ?? 0)}"></label>
      <label>App 在 Google Play 的下載頁（「需要更新」畫面的「立即更新」按鈕會打開這裡；和買東西無關）<input id="rl-store" value="${esc(a.store_url ?? '')}"></label>
      <p class="hint">⚠️ 最低版本號調高前，先確認新版已經在 Google Play 上架，不然大家會被擋在外面又沒有新版可以下載。</p>
    </div>
    <h2>維護模式</h2>
    <div class="form">
      <label class="switch"><input type="checkbox" id="rl-maint" ${m.enabled ? 'checked' : ''}>
        <span style="font-size:15px;color:var(--text)">維護中（會員打開 App 只看到維護畫面；管理員照常可以用）</span></label>
      <label>越南文說明（空白 = 預設文字）<input id="rl-vi" value="${esc(msg.vi ?? '')}"></label>
      <label>中文說明<input id="rl-zh" value="${esc(msg.zh ?? '')}"></label>
      <label>英文說明<input id="rl-en" value="${esc(msg.en ?? '')}"></label>
    </div>
    <div class="actions"><button class="btn gold inline" id="rl-save">儲存</button></div>`;
  $('#rl-save').onclick = async () => {
    const min = Math.max(0, parseInt($('#rl-min').value, 10) || 0);
    const latest = Math.max(0, parseInt($('#rl-latest').value, 10) || 0);
    const maint = $('#rl-maint').checked;
    if (maint && !m.enabled && !confirm('確定要打開維護模式？所有會員會馬上看到維護畫面。')) return;
    if (min > Number(a.min_build ?? 0) && !confirm(`確定把最低版本號調到 ${min}？版本比這個舊的會員都要先更新才能用。`)) return;
    const value = {
      ...v,
      android: { ...a, min_build: min, latest_build: Math.max(latest, min), store_url: $('#rl-store').value.trim() },
      maintenance: { ...m, enabled: maint, message: { vi: $('#rl-vi').value.trim(), zh: $('#rl-zh').value.trim(), en: $('#rl-en').value.trim() } },
    };
    await run(db.from('app_config').update({ value }).eq('key', 'app_status'), '已儲存');
    release();
  };
}

// =====================================================================
// 後台角色、設定修改紀錄、商城、訂單與退款、營收報表（負責人 2026-11-26）
// =====================================================================
var MY_ROLE = 'super_admin'; // var：start() 可能在這行執行前就被呼叫
var ROLE_NAMES = { super_admin: '超級管理員', operator: '營運', finance: '財務', support: '客服' };
const ROLE_HELP = {
  super_admin: '全部權限，含指派角色、還原設定',
  operator: '改設定、功能開關、版本與維護、商城上架',
  finance: '訂單、退款、補發／收回、營收報表',
  support: '查會員、檢舉、問題回報（不能改設定、不能碰錢）',
};

// ---- 角色 ----
async function roles() {
  const list = await run(db.rpc('admin_list_roles'));
  const canEdit = MY_ROLE === 'super_admin';
  page().innerHTML = `<h1>後台角色</h1>
    <p class="hint">管理員再分四種角色，「提出」和「核准」盡量給不同人。資料庫會檢查權限，這裡只是設定。
      要新增管理員，仍然在 Supabase 把 profiles.role 設成 admin（見 CLAUDE.md），預設是超級管理員，再到這裡調整。</p>
    <table><tr><th>管理員</th><th>會員編號</th><th>角色</th><th>可以做什麼</th></tr>
      ${list.map((r) => `<tr><td>${esc(r.display_name)}</td><td>${r.member_no ? 'VN ' + r.member_no : '—'}</td>
        <td>${canEdit ? `<select data-role-user="${r.user_id}" style="width:auto">${Object.keys(ROLE_NAMES).map((k) =>
          `<option value="${k}" ${k === r.role ? 'selected' : ''}>${ROLE_NAMES[k]}</option>`).join('')}</select>` : esc(ROLE_NAMES[r.role] ?? r.role)}</td>
        <td class="muted">${esc(ROLE_HELP[r.role] ?? '')}</td></tr>`).join('')}
    </table>
    ${canEdit ? '' : '<p class="hint">只有超級管理員能調整角色。</p>'}`;
  page().querySelectorAll('[data-role-user]').forEach((s) => (s.onchange = async () => {
    if (!confirm(`把這位管理員改成「${ROLE_NAMES[s.value]}」？`)) { roles(); return; }
    await run(db.rpc('admin_set_role', { p_user: s.dataset.roleUser, p_role: s.value }), '已更新角色');
    roles();
  }));
}

// ---- 設定修改紀錄 ----
async function configlog() {
  const list = await run(db.from('config_changes').select('*, who:profiles!config_changes_changed_by_fkey(display_name)')
    .order('changed_at', { ascending: false }).limit(200));
  const pretty = (v) => (v == null ? '（無）' : JSON.stringify(v, null, 2));
  const canRestore = MY_ROLE === 'super_admin' || MY_ROLE === 'operator';
  page().innerHTML = `<h1>設定修改紀錄</h1>
    <p class="hint">積分規則、功能開關、版本與維護等所有設定（app_config）每次修改都記在這裡：誰、什麼時候、改前、改後。按「還原」會改回那一次「改之前」的值（還原本身也會記一筆）。</p>
    <table><tr><th>時間</th><th>設定</th><th>動作</th><th>誰</th><th>改前 → 改後</th><th></th></tr>
      ${list.map((c) => `<tr><td>${fmt(c.changed_at)}</td><td><b>${esc(CONFIG_NAMES[c.key] ?? c.key)}</b><br><span class="muted">${esc(c.key)}</span></td>
        <td>${{ insert: '新增', update: '修改', delete: '刪除', restore: '還原' }[c.action] ?? esc(c.action)}</td>
        <td>${esc(c.who?.display_name ?? (c.changed_by ? '' : '系統'))}</td>
        <td><details><summary>看內容</summary><div class="row" style="align-items:flex-start;gap:8px">
          <pre style="flex:1;white-space:pre-wrap;max-height:300px;overflow:auto">${esc(pretty(c.old_value))}</pre>
          <pre style="flex:1;white-space:pre-wrap;max-height:300px;overflow:auto">${esc(pretty(c.new_value))}</pre></div></details></td>
        <td>${c.old_value != null && canRestore ? `<button class="btn small" data-restore="${c.id}">還原</button>` : ''}</td></tr>`).join('') ||
        '<tr><td colspan="6" class="muted">還沒有修改紀錄</td></tr>'}
    </table>`;
  page().querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => {
    if (!confirm('確定把這個設定改回這一次「改之前」的值？')) return;
    await run(db.rpc('admin_restore_config', { p_change: Number(b.dataset.restore) }), '已還原');
    configlog();
  }));
}

// ---- 商城 ----
const KIND_NAMES = { cosmetic: '外觀', season_pass: '賽季通行證', subscription: '會員', lucky_no: '吉利號碼', bundle: '組合包' };
const SLOT_NAMES = { avatar_frame: '頭像框', card_bg: '名片底圖', name_effect: '名字特效', title_effect: '稱號特效', entrance: '進場特效' };
async function store() {
  const list = await run(db.from('store_products').select('*').order('sort_order').order('id'));
  const cfg = (await run(db.from('app_config').select('value').eq('key', 'store').maybeSingle()))?.value ?? {};
  page().innerHTML = `<h1>商城</h1>
    <p class="hint">商品目錄。價格是參考價（實際以 Google Play 設定的價格為準），要賣的商品一定要填「Google Play 商品 ID」，並在 Play Console 建同一個 ID。
      商店開關目前：<b>${cfg.enabled ? '打開' : '關閉（App 看不到商城）'}</b>。只有營運、超級管理員能上架。</p>
    <div class="actions"><button class="btn gold inline" id="sp-new">新增商品</button>
      <button class="btn" id="sp-toggle">${cfg.enabled ? '關閉商店' : '打開商店'}</button></div>
    <table><tr><th>圖</th><th>ID</th><th>名稱</th><th>類型</th><th>價格</th><th>Google Play</th><th>狀態</th><th></th></tr>
      ${list.map((p) => `<tr><td>${p.asset?.image ? `<img src="${esc(p.asset.image)}" style="width:44px;height:44px;object-fit:contain">` : ''}</td>
        <td>${esc(p.id)}</td><td>${esc(p.name?.zh || p.name?.vi || '')}<br><span class="muted">${esc(p.name?.vi || '')}</span></td>
        <td>${esc(KIND_NAMES[p.kind] ?? p.kind)}${p.slot ? '<br><span class="muted">' + esc(SLOT_NAMES[p.slot] ?? p.slot) + '</span>' : ''}</td>
        <td>${p.price_vnd != null ? vnd(p.price_vnd) : '—'}${p.duration_days ? '<br><span class="muted">' + p.duration_days + ' 天</span>' : ''}</td>
        <td>${esc(p.store_product_id ?? '—')}</td>
        <td>${p.active ? '<span class="pill ok">上架</span>' : '<span class="pill">下架</span>'}</td>
        <td><button class="btn small" data-edit="${esc(p.id)}">編輯</button></td></tr>`).join('') ||
        '<tr><td colspan="8" class="muted">還沒有商品</td></tr>'}
    </table><div id="sp-form"></div>`;
  $('#sp-new').onclick = () => storeForm(null);
  $('#sp-toggle').onclick = async () => {
    if (!confirm(cfg.enabled ? '確定關閉商店？App 會看不到商城。' : '確定打開商店？App 會出現商城（要先有上架的商品）。')) return;
    await run(db.from('app_config').update({ value: { ...cfg, enabled: !cfg.enabled } }).eq('key', 'store'), '已更新');
    store();
  };
  page().querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => storeForm(list.find((p) => p.id === b.dataset.edit))));
}

function storeForm(p) {
  const isNew = !p;
  p = p ?? { kind: 'cosmetic', slot: 'avatar_frame', name: {}, description: {}, asset: {}, active: false, sort_order: 0 };
  const dt = (v) => (v ? new Date(v).toISOString().slice(0, 16) : '');
  $('#sp-form').innerHTML = `<h2>${isNew ? '新增商品' : '編輯 ' + esc(p.id)}</h2><div class="form">
    <label>商品 ID（小寫英數、. _，例如 frame.gold_2027q1；建立後不能改）<input id="f-id" value="${esc(p.id ?? '')}" ${isNew ? '' : 'disabled'}></label>
    <div class="row"><label style="flex:1">類型<select id="f-kind">${Object.entries(KIND_NAMES).map(([k, v]) => `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label style="flex:1">外觀位置（外觀才需要）<select id="f-slot"><option value="">—</option>${Object.entries(SLOT_NAMES).map(([k, v]) => `<option value="${k}" ${k === p.slot ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div class="row"><label style="flex:1">名稱（越南文）<input id="f-vi" value="${esc(p.name?.vi ?? '')}"></label>
      <label style="flex:1">名稱（中文）<input id="f-zh" value="${esc(p.name?.zh ?? '')}"></label>
      <label style="flex:1">名稱（英文）<input id="f-en" value="${esc(p.name?.en ?? '')}"></label></div>
    <div class="row"><label style="flex:1">參考價（VND）<input id="f-price" type="number" min="0" value="${p.price_vnd ?? ''}"></label>
      <label style="flex:1">有效天數（空白 = 永久）<input id="f-days" type="number" min="1" value="${p.duration_days ?? ''}"></label>
      <label style="flex:1">Google Play 商品 ID（空白 = 只能送不能買）<input id="f-gp" value="${esc(p.store_product_id ?? '')}"></label></div>
    <div class="row"><label style="flex:1">開始販售（空白 = 馬上）<input id="f-start" type="datetime-local" value="${dt(p.starts_at)}"></label>
      <label style="flex:1">結束販售（空白 = 不結束）<input id="f-end" type="datetime-local" value="${dt(p.ends_at)}"></label>
      <label style="flex:1">排序（小的在前）<input id="f-sort" type="number" value="${p.sort_order ?? 0}"></label></div>
    <label>素材圖（PNG／WebP，透明背景；頭像框建議 512×512）<input id="f-img" type="file" accept="image/png,image/webp"></label>
    ${p.asset?.image ? `<img src="${esc(p.asset.image)}" style="width:96px;height:96px;object-fit:contain;background:#222;border-radius:12px">` : ''}
    <label class="switch"><input type="checkbox" id="f-active" ${p.active ? 'checked' : ''}><span style="font-size:15px;color:var(--text)">上架（商店打開時 App 看得到）</span></label>
    <div class="actions"><button class="btn gold inline" id="f-save">儲存</button><button class="btn" id="f-cancel">取消</button></div></div>`;
  $('#f-cancel').onclick = () => { $('#sp-form').innerHTML = ''; };
  $('#f-save').onclick = async () => {
    const id = isNew ? $('#f-id').value.trim() : p.id;
    if (!/^[a-z0-9][a-z0-9_.]{2,63}$/.test(id)) { toast('商品 ID 格式不對', true); return; }
    const asset = { ...(p.asset ?? {}) };
    const file = $('#f-img').files[0];
    if (file) {
      const path = 'products/' + id + '-' + Date.now() + (file.type === 'image/webp' ? '.webp' : '.png');
      await run(db.storage.from('store').upload(path, file, { contentType: file.type }));
      asset.image = db.storage.from('store').getPublicUrl(path).data.publicUrl;
    }
    const num = (v) => (v === '' ? null : Number(v));
    const row = {
      id, kind: $('#f-kind').value, slot: $('#f-slot').value || null,
      name: { vi: $('#f-vi').value.trim(), zh: $('#f-zh').value.trim(), en: $('#f-en').value.trim() },
      price_vnd: num($('#f-price').value), duration_days: num($('#f-days').value),
      store_product_id: $('#f-gp').value.trim() || null,
      starts_at: $('#f-start').value ? new Date($('#f-start').value).toISOString() : null,
      ends_at: $('#f-end').value ? new Date($('#f-end').value).toISOString() : null,
      sort_order: Number($('#f-sort').value || 0), active: $('#f-active').checked, asset,
    };
    await run(isNew ? db.from('store_products').insert(row) : db.from('store_products').update(row).eq('id', id), '已儲存');
    store();
  };
}

// ---- 訂單與退款 ----
const ORDER_STATUS = {
  verified: ['成功', 'ok'], pending: ['處理中', 'warn'], refunded: ['已退款', 'warn'],
  cancelled: ['已取消', ''], expired: ['已到期', ''], failed: ['失敗', ''],
};
const orderPill = (s) => (ORDER_STATUS[s] ? `<span class="pill ${ORDER_STATUS[s][1]}">${ORDER_STATUS[s][0]}</span>` : esc(s));
async function orders() {
  const want = new URLSearchParams(location.hash.split('?')[1]).get('status') || '';
  const list = await run(db.rpc('admin_store_orders', { p_status: want || null, p_limit: 300 }));
  page().innerHTML = `<h1>訂單與退款</h1>
    <p class="hint">Google Play 的購買紀錄。退款由 Google 處理（使用者向 Google 申請，或在 Play Console 退款），退款後系統會自動收回東西。
      這裡可以手動補發（例如付了錢沒拿到、活動贈送）或收回。只有財務、超級管理員看得到。</p>
    <div class="actions">${['', 'verified', 'pending', 'refunded', 'cancelled', 'expired', 'failed'].map((s) =>
      `<a class="btn small ${s === want ? 'gold' : ''}" href="#/orders${s ? '?status=' + s : ''}">${s ? ORDER_STATUS[s][0] : '全部'}</a>`).join('')}</div>
    <table><tr><th>時間</th><th>會員</th><th>商品</th><th>價格</th><th>Google 訂單</th><th>狀態</th><th></th></tr>
      ${list.map((o) => `<tr><td>${fmt(o.created_at)}</td>
        <td>${esc(o.display_name ?? '（已刪除）')}${o.member_no ? '<br><span class="muted">VN ' + o.member_no + '</span>' : ''}</td>
        <td>${esc(o.product_name?.zh || o.product_name?.vi || o.product_id)}<br><span class="muted">${esc(o.product_id)}</span></td>
        <td>${o.price_vnd != null ? vnd(o.price_vnd) : '—'}</td><td class="muted">${esc(o.order_id ?? '')}</td>
        <td>${orderPill(o.status)}${o.item_revoked ? '<br><span class="muted">東西已收回</span>' : ''}</td>
        <td>${o.item_id && !o.item_revoked ? `<button class="btn small danger" data-revoke="${o.item_id}">收回</button>` : ''}</td></tr>`).join('') ||
        '<tr><td colspan="7" class="muted">沒有訂單</td></tr>'}
    </table>
    <h2>手動補發</h2>
    <div class="form"><div class="row">
      <label style="flex:1">會員編號（VN482915）<input id="g-sn"></label>
      <label style="flex:1">商品 ID<input id="g-product"></label>
      <label style="flex:1">有效天數（空白 = 照商品設定）<input id="g-days" type="number" min="1"></label></div>
      <label>原因（必填，會記錄）<input id="g-note"></label>
      <div><button class="btn gold inline" id="g-go">補發</button></div></div>`;
  page().querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = async () => {
    const note = prompt('收回原因（必填）');
    if (!note) return;
    await run(db.rpc('admin_revoke_item', { p_item: Number(b.dataset.revoke), p_note: note }), '已收回');
    orders();
  }));
  $('#g-go').onclick = async () => {
    const sn = parseSN($('#g-sn').value);
    const product = $('#g-product').value.trim();
    const note = $('#g-note').value.trim();
    if (!sn || !product || !note) { toast('會員編號、商品 ID、原因都要填', true); return; }
    const hit = await run(db.rpc('find_player_by_member_no', { p_text: sn }));
    if (!hit.length) { toast('找不到這個會員編號', true); return; }
    if (!confirm(`補發「${product}」給 ${hit[0].display_name}（VN ${sn}）？`)) return;
    const days = $('#g-days').value ? Number($('#g-days').value) : null;
    await run(db.rpc('admin_grant_item', { p_user: hit[0].id, p_product: product, p_days: days, p_note: note }), '已補發');
    orders();
  };
}

// ---- 營收報表 ----
async function revenue() {
  const days = Number(new URLSearchParams(location.hash.split('?')[1]).get('days') || 30);
  const r = await run(db.rpc('admin_store_revenue', { p_days: days }));
  const t = r.total ?? {};
  const max = Math.max(1, ...r.daily.map((d) => d.revenue));
  const f = r.funnel ?? {};
  const step = (k, label) => `<div class="card"><div class="num">${f[k]?.users ?? 0}</div><div class="label">${label}（${f[k]?.n ?? 0} 次）</div></div>`;
  page().innerHTML = `<h1>營收報表</h1>
    <p class="hint">金額用商品參考價估算，實際入帳以 Google Play 帳單為準（Google 抽 15%）。只有財務、超級管理員看得到。</p>
    <div class="actions">${[7, 30, 90, 365].map((d) => `<a class="btn small ${d === days ? 'gold' : ''}" href="#/revenue?days=${d}">近 ${d} 天</a>`).join('')}</div>
    <div class="cards">
      <div class="card"><div class="num">${vnd(t.revenue ?? 0)}</div><div class="label">營收（估）</div></div>
      <div class="card"><div class="num">${t.orders ?? 0}</div><div class="label">成功訂單</div></div>
      <div class="card"><div class="num">${t.buyers ?? 0}</div><div class="label">付費會員</div></div>
      <div class="card"><div class="num">${t.buyers ? vnd(Math.round((t.revenue ?? 0) / t.buyers)) : '—'}</div><div class="label">平均每位付費會員</div></div>
      <div class="card alert"><div class="num">${t.refunds ?? 0}</div><div class="label">退款（${vnd(t.refunded ?? 0)}）</div></div>
    </div>
    <h2>商城漏斗（人數）</h2>
    <div class="cards">${step('view_store', '看商城')}${step('view_product', '看商品')}${step('tap_buy', '按購買')}${step('purchase_ok', '購買成功')}${step('purchase_cancel', '取消')}</div>
    <h2>熱賣商品</h2>
    <table><tr><th>商品</th><th>訂單</th><th>營收（估）</th></tr>
      ${r.top.map((p) => `<tr><td>${esc(p.name?.zh || p.name?.vi || p.product_id)}<br><span class="muted">${esc(p.product_id)}</span></td><td>${p.orders}</td><td>${vnd(p.revenue)}</td></tr>`).join('') ||
        '<tr><td colspan="3" class="muted">還沒有銷售</td></tr>'}
    </table>
    <h2>每天</h2>
    <table><tr><th>日期</th><th>營收（估）</th><th></th><th>訂單</th><th>買家</th><th>退款</th></tr>
      ${r.daily.slice().reverse().map((d) => `<tr><td>${esc(d.day)}</td><td>${vnd(d.revenue)}</td>
        <td style="width:40%"><div style="height:8px;border-radius:4px;background:var(--gold);width:${Math.round((d.revenue / max) * 100)}%"></div></td>
        <td>${d.orders}</td><td>${d.buyers}</td><td>${d.refunds ? d.refunds + '（' + vnd(d.refunded) + '）' : ''}</td></tr>`).join('')}
    </table>`;
}
