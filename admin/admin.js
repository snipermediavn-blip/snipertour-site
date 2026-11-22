// Sniper 管理後台（CLAUDE.md 第 4.C 節）— 只有平台管理員（profiles.role = admin）能用。
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
  $('#me-name').textContent = me.display_name || '管理員';
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  route();
}

// ---------------------------------------------------------------------
// 頁面切換
// ---------------------------------------------------------------------
const PAGES = { overview, venues, players, flags, disputes, reports, rules, ads, push };
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
  const card = (n, label, alert = false, href = null) =>
    `<div class="card ${alert && n > 0 ? 'alert' : ''}">${href ? `<a href="${href}" style="text-decoration:none;color:inherit">` : ''}
      <div class="num">${n}</div><div class="label">${label}</div>${href ? '</a>' : ''}</div>`;
  page().innerHTML = `<h1>總覽</h1>
    <div class="cards">
      ${card(o.players, '註冊球員')}${card(o.verified, '已認證')}${card(o.suspended, '停權中')}
      ${card(o.venues, '球館')}${card(o.tournaments_open, '報名中／比賽中的比賽')}${card(o.matches_today, '24 小時內打完的對局')}
      ${card(o.open_flags, '待處理的可疑名單', true, '#/flags')}${card(o.open_disputes, '待處理的比分爭議', true, '#/disputes')}
      ${card(o.open_reports, '待處理的檢舉', true, '#/reports')}
    </div>`;
}

// ---------------------------------------------------------------------
// 球館與員工
// ---------------------------------------------------------------------
async function venues() {
  const list = await run(db.from('venues').select('*').order('name'));
  const selected = new URLSearchParams(location.hash.split('?')[1]).get('id');
  page().innerHTML = `<h1>球館與員工</h1>
    <table><tr><th>球館</th><th>地址</th><th>球檯</th><th>狀態</th><th></th></tr>
      ${list.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(v.address)}</td><td>${v.table_count}</td>
        <td>${v.status === 'active' ? '<span class="pill ok">營業中</span>' : `<span class="pill">${esc(v.status)}</span>`}</td>
        <td><a class="btn small" href="#/venues?id=${v.id}">編輯／員工</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">還沒有球館</td></tr>'}
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
  $('#v-save').onclick = async () => {
    const row = {
      name: $('#v-name').value.trim(),
      address: $('#v-address').value.trim() || null,
      table_count: Number($('#v-tables').value) || 0,
      status: $('#v-status').value,
      lat: $('#v-lat').value ? Number($('#v-lat').value) : null,
      lng: $('#v-lng').value ? Number($('#v-lng').value) : null,
      hours: $('#v-hours').value.trim() ? { text: $('#v-hours').value.trim() } : null,
    };
    if (!row.name) return toast('請填球館名稱', true);
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
      if (q) query = query.ilike('display_name', '%' + q + '%');
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

async function playerDetail(id) {
  const [p, ratings, history] = await Promise.all([
    run(db.from('profiles').select('*').eq('id', id).single()),
    run(db.from('ratings').select('*').eq('player_id', id)),
    run(db.from('level_history').select('*').eq('player_id', id).order('created_at', { ascending: false })),
  ]);
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
      <div class="actions">
        ${p.status === 'active'
          ? '<button class="btn danger" id="d-suspend">停權</button>'
          : '<button class="btn" id="d-unsuspend">恢復帳號</button>'}
      </div>
    </div>
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
  $('#d-set').onclick = async () => {
    await run(db.rpc('admin_set_level', { p_player_id: id, p_level: $('#d-level').value, p_note: $('#d-note').value }), '已調整等級');
    playerDetail(id);
  };
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
const FLAG_TYPES = {
  final_forfeit: '決賽棄權',
  handicap_above_level: '讓球等級高於顯示等級（實力分超過自己的等級）',
};
async function flags() {
  const showAll = location.hash.includes('all=1');
  let q = db.from('suspicious_flags').select('*, player:profiles!suspicious_flags_player_id_fkey(display_name, level)').order('created_at', { ascending: false }).limit(200);
  if (!showAll) q = q.eq('status', 'open');
  const list = await run(q);
  page().innerHTML = `<h1>可疑名單</h1>
    <p class="hint">系統只標記，不會自動停權。請判斷後按「沒問題」或「已處理」。
      ${showAll ? '<a href="#/flags">只看待處理</a>' : '<a href="#/flags?all=1">看全部（含已處理）</a>'}</p>
    <table><tr><th>時間</th><th>球員</th><th>原因</th><th>細節</th><th>狀態</th><th></th></tr>
      ${list.map((f) => `<tr><td>${fmt(f.created_at)}</td>
        <td>${esc(f.player?.display_name)} ${f.player?.level ? `<span class="badge">${f.player.level}</span>` : ''}</td>
        <td>${esc(FLAG_TYPES[f.flag_type] ?? f.flag_type)}</td>
        <td class="hint">${esc(flagDetail(f))}</td>
        <td>${{ open: '<span class="pill warn">待處理</span>', dismissed: '<span class="pill">沒問題</span>', actioned: '<span class="pill ok">已處理</span>' }[f.status]}</td>
        <td>${f.status === 'open' ? `<div class="actions"><button class="btn small" data-flag="${f.id}" data-s="dismissed">沒問題</button>
          <button class="btn small" data-flag="${f.id}" data-s="actioned">已處理</button>
          <a class="btn small" href="#/players" onclick="setTimeout(()=>playerDetail('${f.player_id}'),300)">看球員</a></div>` : ''}</td></tr>`).join('') ||
        '<tr><td colspan="6" class="muted">沒有待處理的項目</td></tr>'}
    </table>`;
  page().querySelectorAll('[data-flag]').forEach((b) => (b.onclick = async () => {
    const { data: { user } } = await db.auth.getUser();
    await run(db.from('suspicious_flags').update({ status: b.dataset.s, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq('id', b.dataset.flag), '已更新');
    flags();
  }));
}
function flagDetail(f) {
  const d = f.detail ?? {};
  if (f.flag_type === 'handicap_above_level') return `顯示等級 ${d.display_level ?? '?'}，讓球等級 ${d.handicap_level ?? '?'}`;
  return '';
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
const FLAG_NAMES = { zalo_login: 'Zalo 登入', challenges: '約戰' };
const TIER_HELP = '比賽分級代碼（例如 weekly = 球館週賽、monthly = 球館月賽、city = 城市公開賽），建立比賽時選的分級要和這裡一樣。';

async function rules() {
  const rows = await run(db.from('app_config').select('*').order('key'));
  const get = (k) => rows.find((r) => r.key === k);
  const flagsRow = get('feature_flags');
  const rp = get('ranking_points')?.value ?? { window_months: 12, tiers: {} };
  const zaloCfg = get('zalo_otp')?.value ?? { template_id: null, param: 'otp' };
  const zaloStatus = await run(db.rpc('zalo_oa_status'));
  const zaloResult = { linked: '已連結 Zalo 官方帳號', cancelled: '已取消連結', expired: '連結逾時，請再按一次', failed: '連結失敗，請再試一次' };
  const zr = new URLSearchParams(location.hash.split('?')[1]).get('zalo');
  if (zr) { toast(zaloResult[zr] ?? zr, zr !== 'linked'); history.replaceState(null, '', '#/rules'); }
  page().innerHTML = `<h1>積分規則與設定</h1>
    <h2>登入驗證碼（用 Zalo 傳送）</h2>
    <div class="form">
      <div>Zalo 官方帳號：${zaloStatus.linked
        ? `<span class="pill ok">已連結</span> <span class="hint">OA ${esc(zaloStatus.oa_id ?? '')}，token 更新於 ${fmt(zaloStatus.updated_at)}（每天自動更新）</span>`
        : '<span class="pill bad">還沒連結</span>'}</div>
      <div><button class="btn${zaloStatus.linked ? '' : ' gold inline'}" id="zalo-link">${zaloStatus.linked ? '重新連結' : '連結 Zalo 官方帳號'}</button>
        <span class="hint">會打開 Zalo 授權頁，請用 OA 管理員的 Zalo 按「允許」。</span></div>
      <div class="row">
        <div><label>驗證碼範本 ID（Zalo 審核通過後拿到）</label><input id="zalo-tpl" value="${esc(zaloCfg.template_id)}"></div>
        <div class="shrink"><label>範本參數名稱</label><input id="zalo-param" value="${esc(zaloCfg.param ?? 'otp')}" style="width:120px"></div>
        <button class="btn gold inline" id="zalo-save">儲存</button>
      </div>
      <p class="hint">範本 ID 空白時，App 登入會顯示「目前無法傳送驗證碼」（Zalo 登入不受影響）。</p>
    </div>

    <h2>功能開關</h2>
    <div class="form" id="flags-box">
      ${Object.entries(flagsRow?.value ?? {}).map(([k, v]) => `<label class="switch"><input type="checkbox" data-flagkey="${esc(k)}" ${v ? 'checked' : ''}>
        <span style="font-size:15px;color:var(--text)">${esc(FLAG_NAMES[k] ?? k)}</span></label>`).join('')}
      <div><button class="btn gold inline" id="flags-save">儲存功能開關</button></div>
    </div>

    <h2>排名積分（第 5.10 節）</h2>
    <div class="form">
      <p class="hint">${TIER_HELP} 只計算最近幾個月：<input id="rp-months" type="number" min="1" value="${rp.window_months ?? 12}" style="width:80px;display:inline-block"> 個月</p>
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
    ${rows.filter((r) => !['feature_flags', 'ranking_points', 'zalo_otp'].includes(r.key)).map((r) => `
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
  $('#rp-save').onclick = async () => {
    const tiers = {};
    tiersTable.querySelectorAll('tr').forEach((tr) => {
      const code = tr.querySelector('.tier-code')?.value.trim();
      if (!code) return;
      const pts = {};
      tr.querySelectorAll('.tier-pt').forEach((i) => { if (i.value !== '') pts[i.dataset.n] = Number(i.value); });
      tiers[code] = pts;
    });
    const value = { ...rp, window_months: Number($('#rp-months').value) || 12, tiers };
    await run(db.from('app_config').update({ value }).eq('key', 'ranking_points'), '已儲存排名積分');
  };

  $('#zalo-save').onclick = async () => {
    const value = { ...zaloCfg, template_id: $('#zalo-tpl').value.trim() || null, param: $('#zalo-param').value.trim() || 'otp' };
    await run(db.from('app_config').update({ value }).eq('key', 'zalo_otp'), '已儲存驗證碼範本');
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
const SLOTS = { splash: '開啟畫面', home_banner: '首頁橫幅', ranking_banner: '排行榜橫幅' };
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
          ${a.link ? `<div class="hint"><a href="${esc(a.link)}" target="_blank" rel="noopener">連結</a></div>` : ''}</td>
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
        <div><label>圖片（建議 1600×600，2 MB 以內）</label><input id="a-img" type="file" accept="image/png,image/jpeg,image/webp"></div>
      </div>
      <div><label>點了要開的網址（可以空白）</label><input id="a-link" placeholder="https://"></div>
      <div class="row">
        <div><label>開始時間（空白 = 馬上）</label><input id="a-start" type="datetime-local"></div>
        <div><label>結束時間（空白 = 不結束）</label><input id="a-end" type="datetime-local"></div>
      </div>
      <div><label>只在這些球館顯示（都不勾 = 全部球館）</label>
        <div class="row">${venueList.map((v) => `<label class="switch"><input type="checkbox" class="a-venue" value="${v.id}"><span style="color:var(--text)">${esc(v.name)}</span></label>`).join('')}</div></div>
      <div><button class="btn gold inline" id="a-save">上傳並上架</button></div>
    </div>`;
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
