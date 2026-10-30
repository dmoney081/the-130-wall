(async function(){
  const bust = '?v=' + Date.now();
  const mq = new URLSearchParams(location.search).get('m');
  const want = /^\d{4}-\d{2}$/.test(mq||'') ? mq : null;
  const [cfg, live, months] = await Promise.all([
    fetch('config.json'+bust).then(r=>r.json()),
    fetch('board.json'+bust).then(r=>r.json()),
    fetch('boards/index.json'+bust).then(r=>r.ok?r.json():[]).catch(()=>[])
  ]);
  let board = live, archived = false;
  if (want && want !== live.month && months.includes(want)){
    const r = await fetch(`boards/${want}.json`+bust).catch(()=>null);
    if (r && r.ok){ board = await r.json(); archived = true; }
  }
  const N = cfg.cols * cfg.rows;
  const tiles = board.tiles || [];
  const byPos = {}; tiles.forEach(t => byPos[t.pos] = t);
  const paidTiles = tiles.filter(t => !t.member);           // member perk tiles (paid 0) never count
  const sold = paidTiles.length;
  const raised = paidTiles.reduce((s,t)=>s+(+t.paid||0),0) + (+board.tips_usd||0);
  const priceAt = k => cfg.tier_prices[Math.min(Math.floor(k/cfg.tier_size), cfg.tier_prices.length-1)];
  const next = (!archived && tiles.length < N) ? priceAt(sold) : null;
  const $ = id => document.getElementById(id);
  // month + theme, and past walls
  const mname = m => m ? new Date(m+'-15').toLocaleString([], {month:'long', year:'numeric'}) : '';
  const mt = $('monththeme');
  if (mt) mt.textContent = (archived ? 'Archived wall: ' : 'This month: ') + mname(board.month) + (board.theme ? ' · ' + board.theme : '');
  const pw = $('pastwalls');
  if (pw){
    const list = [...new Set(months)].filter(m => m !== live.month).sort().reverse();
    pw.innerHTML = (archived ? '<a href="./">← Live wall</a>' : '') +
      (list.length ? (archived ? ' · ' : '') + 'Past walls: ' + list.map(m => m===board.month ? `<b>${esc(mname(m))}</b>` : `<a href="?m=${esc(m)}">${esc(mname(m))}</a>`).join(' · ')
                   : (archived ? '' : 'Past walls appear here when a month closes.'));
  }
  const money = v => '$' + (Math.round(v*100)/100).toString().replace(/\.(\d)$/,'.$10');

  // progress
  $('raised').textContent = money(raised);
  $('sold').textContent = sold;
  $('nextprice').textContent = next ? '$'+next : (archived ? 'closed' : 'sold out');
  requestAnimationFrame(()=> $('fill').style.width = Math.min(100, raised/cfg.goal_usd*100) + '%');
  $('updated').textContent = 'wall updated ' + new Date(board.updated).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const kofi = cfg.kofi_url || 'https://ko-fi.com/secretwall';
  // Ko-fi has no documented amount parameter, so by default we link the plain page and state the amount.
  const kofiFor = amt => cfg.kofi_amount_deeplink ? `${kofi}/${amt}` : kofi;
  $('tiplink').href = kofi;

  // countdown
  const dl = new Date(cfg.deadline_iso);
  function tick(){
    let s = Math.max(0, (dl - new Date())/1000|0);
    const d=s/86400|0; s%=86400; const h=s/3600|0; s%=3600; const m=s/60|0; s%=60;
    $('clock').textContent = raised >= cfg.goal_usd ? 'GOAL HIT 👑' : `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s left`;
  }
  tick(); setInterval(tick, 1000);

  // wall
  const wall = $('wall');
  for (let p = 0; p < N; p++){
    const el = document.createElement('div');
    el.className = 'tile';
    const t = byPos[p];
    if (t){
      el.classList.add('sold'); if (t.member) el.classList.add('member');
      el.style.background = t.color || '#333';
      el.innerHTML = (t.pixel ? `<img class="px" src="${esc(t.pixel)}" alt="">` : `<span class="e">${esc(t.emoji||'■')}</span>`) +
        `<span class="t">${esc(t.text||'')}</span>` + (t.crown ? '<span class="crown">👑</span>' : '') + (t.member ? '<span class="mb" title="Member tile">M</span>' : '');
      el.title = `${t.text||''}${t.handle ? ' by '+t.handle : ''} · ${t.member ? 'member tile (not counted in the total)' : money(t.paid)}`;
    } else {
      el.innerHTML = `<span class="p">${next ? '$'+next : '·'}</span>`;
      if (next) el.onclick = () => openClaim(p);
    }
    wall.appendChild(el);
  }

  // ledger
  const led = [...paidTiles].sort((a,b)=> new Date(b.ts) - new Date(a.ts));
  if (led.length || board.tips_usd){
    $('ledger').innerHTML = led.map(t => `<li><span>${esc(t.emoji||'')} Tile ${t.pos+1}${t.handle?' · '+esc(t.handle):''}${safeLink(t.link)}</span><span>${money(t.paid)}</span></li>`).join('') +
      (board.tips_usd ? `<li><span>Tips</span><span>${money(board.tips_usd)}</span></li>` : '');
  }

  const mem = tiles.filter(t => t.member);
  if (mem.length && $('ledger')) $('ledger').insertAdjacentHTML('beforeend', `<li class="muted"><span>${mem.length} member tile${mem.length>1?'s':''} (★ M badge)</span><span>$0, not counted</span></li>`);

  // supporters
  fetch('credits.json'+bust).then(r=>r.ok?r.json():[]).then(c => {
    const el = $('supporters'); if (!el) return;
    el.innerHTML = c.length ? c.map(x => `<li>${esc(x.name)} <span class="muted">· ${esc(x.tier||'')}${x.since?' since '+esc(x.since):''}</span></li>`).join('')
                            : '<li class="muted">No members yet. You could be the first.</li>';
  }).catch(()=>{});

  // claim dialog (Ko-fi flow)
  const dlg = $('claim'); let cur = null;
  const code = () => 'S-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b%31]).join('');
  const clean = v => String(v||'').replace(/[|\r\n]+/g,' ').trim();
  function openClaim(p){
    cur = {pos:p, code:code()};
    $('c-tile').textContent = '#'+(p+1);
    $('c-price').textContent = $('c-price2').textContent = $('c-price3').textContent = '$'+next;
    $('c-custom').textContent = [1,3,5].includes(next) ? ` (tap the $${next} button)` : ` (type ${next} in "or enter an amount")`;
    $('c-code').textContent = $('c-code2').textContent = cur.code;
    $('pixrow').style.display = next >= 3 ? '' : 'none';
    $('c-pay').href = kofiFor(next);
    $('c-copy').textContent = '1 · Copy claim message';
    refresh(); dlg.showModal();
  }
  // One line, "key value" pairs split by " | ". admin/wall.py parse_claim() reads this format.
  function claimText(){
    const parts = [cur.code, `tile ${cur.pos+1}`, `price $${next}`, `emoji ${clean($('f-emoji').value)}`, `color ${$('f-color').value}`];
    const opt = [['text','f-text'],['name','f-handle'],['link','f-link']].concat(next>=3 ? [['pixel','f-pixel']] : []);
    opt.forEach(([k,id]) => { const v = clean($(id).value); if (v) parts.push(`${k} ${v}`); });
    return parts.join(' | ');
  }
  function refresh(){
    const pv = $('c-preview');
    pv.style.background = $('f-color').value;
    pv.querySelector('.e').textContent = $('f-emoji').value || '■';
    pv.querySelector('.t').textContent = $('f-text').value;
    const msg = claimText();
    $('c-msg').value = msg;
    $('c-len').textContent = `${msg.length}/280` + (msg.length > 280 ? ' (too long for Ko-fi, shorten something)' : '');
    $('c-mail').href = `mailto:${cfg.claim_email}?subject=${encodeURIComponent('Tile claim '+cur.code)}&body=${encodeURIComponent(msg)}`;
  }
  ['f-emoji','f-color','f-text','f-handle','f-link','f-pixel'].forEach(id => $(id).addEventListener('input', refresh));
  $('c-copy').onclick = async () => {
    const msg = claimText();
    try { await navigator.clipboard.writeText(msg); }
    catch(e){ const ta = $('c-msg'); ta.focus(); ta.select(); try { document.execCommand('copy'); } catch(_){} }
    $('c-copy').textContent = 'Copied ✓ Now tip on Ko-fi';
  };
  $('c-msg').addEventListener('focus', e => e.target.select());

  function safeLink(u){
    if (!u) return '';
    const href = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    try { const x = new URL(href); if (!/^https?:$/.test(x.protocol)) return ''; return ` <a href="${esc(x.href)}" target="_blank" rel="nofollow ugc noopener">${esc(x.hostname)}</a>`; } catch(e){ return ''; }
  }
  function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
})();
