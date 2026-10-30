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
  // Payments: itch.io donate page (PayPal checkout, $3 prefilled, quick buttons $1/$2/$5/$10).
  // It has no amount URL parameter, so we link the page and state the amount to pay.
  const payUrl = cfg.pay_url || 'https://secretwall.itch.io/burn-rate/donate';
  const claimEmail = cfg.claim_email || 'secretwall@mail.grokbot.com';
  $('tiplink').href = payUrl;
  if (next && $('cta-claim')) $('cta-claim').textContent = `Claim a tile for $${next}`; else if ($('cta-claim')) $('cta-claim').textContent = 'See the wall';

  // header status (tiles left; no countdown)
  $('clock').textContent = raised >= cfg.goal_usd ? 'WALL FILLED 👑' : (archived ? 'Archived wall' : next ? `${N - tiles.length} tiles open · next $${next}` : 'Wall full');

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
    proof(c.length);
    const el = $('supporters'); if (!el) return;
    el.innerHTML = c.length ? c.map(x => `<li>${esc(x.name)} <span class="muted">· ${esc(x.tier||'')}${x.since?' since '+esc(x.since):''}</span></li>`).join('')
                            : '<li class="muted">No members yet. You could be the first.</li>';
  }).catch(()=>proof(0));

  // social proof: only real numbers from board.json / credits.json; stays hidden while everything is zero
  function proof(members){
    const el = $('proof'); if (!el || archived) return;
    const bits = [];
    if (sold) bits.push(`<b>${sold}</b> tile${sold>1?'s':''} claimed`);
    const backers = new Set(paidTiles.map(t => (t.handle||'').toLowerCase()).filter(Boolean)).size;
    if (backers > 1) bits.push(`<b>${backers}</b> named backers`);
    if (members) bits.push(`<b>${members}</b> member${members>1?'s':''}`);
    const last = [...paidTiles].filter(t=>t.ts).sort((a,b)=> new Date(b.ts) - new Date(a.ts))[0];
    if (last){
      const mins = Math.max(1, Math.round((Date.now() - new Date(last.ts))/60000));
      const ago = mins < 60 ? mins+' min' : mins < 2880 ? Math.round(mins/60)+' h' : Math.round(mins/1440)+' days';
      bits.push(`Latest: ${esc(last.emoji||'')} ${esc(last.text||'tile '+(last.pos+1))}${last.handle?' by '+esc(last.handle):''} · ${ago} ago`);
    }
    if (!bits.length) return;
    el.innerHTML = bits.map(b => `<span>${b}</span>`).join(''); el.hidden = false;
  }

  // ?tile=... from Burn Rate: prefill the claim form with the player's score (they still pick the tile and decide to tip)
  const pre = new URLSearchParams(location.search).get('tile');
  let preEmoji = '', preText = '';
  if (pre && next){
    const m = pre.match(/^(\S+)\s+(.*)$/);
    if (m && !/[A-Za-z0-9$]/.test(m[1])){ preEmoji = m[1].slice(0,8); preText = m[2]; } else preText = pre;
    preText = preText.slice(0,24);
    const pf = $('prefill');
    if (pf){ pf.textContent = `Your Burn Rate score “${(preEmoji+' '+preText).trim()}” is ready. Tap any empty tile below and it's filled in. You can change it before you tip.`; pf.hidden = false; requestAnimationFrame(() => pf.scrollIntoView({block:'start'})); }
  }

  // claim dialog: 1) pay the tile price on itch.io, 2) email the tile details (prefilled mailto with the claim code)
  const dlg = $('claim'); let cur = null;
  const code = () => 'S-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b%31]).join('');
  const clean = v => String(v||'').replace(/[|\r\n]+/g,' ').trim();
  const howToPay = amt => amt === 3 ? ' (already filled in)' : [1,2,5,10].includes(amt) ? ` (tap the $${amt} button)` : ` (type ${amt} as the amount)`;
  function openClaim(p){
    cur = {pos:p, code:code()};
    $('c-tile').textContent = '#'+(p+1);
    $('c-price').textContent = $('c-price2').textContent = $('c-price3').textContent = '$'+next;
    $('c-custom').textContent = howToPay(next);
    $('c-code').textContent = cur.code;
    $('pixrow').style.display = next >= 3 ? '' : 'none';
    $('c-pay').href = payUrl;
    $('c-mail').textContent = '2 · Email my tile details';
    $('c-copy').textContent = 'Copy';
    if (preText){ $('f-text').value = preText; if (preEmoji) $('f-emoji').value = preEmoji; preText = ''; }
    refresh(); dlg.showModal();
  }
  // One line, "key value" pairs split by " | ". admin/wall.py parse_claim() reads this format.
  function claimText(){
    const parts = [cur.code, `tile ${cur.pos+1}`, `price $${next}`, `emoji ${clean($('f-emoji').value)}`, `color ${$('f-color').value}`];
    const opt = [['text','f-text'],['name','f-handle'],['link','f-link']].concat(next>=3 ? [['pixel','f-pixel']] : []);
    opt.forEach(([k,id]) => { const v = clean($(id).value); if (v) parts.push(`${k} ${v}`); });
    return parts.join(' | ');
  }
  function mailBody(){
    const payer = clean($('f-payer').value);
    return [claimText(), '',
      `Amount: $${next} (paid on itch.io: ${payUrl})`,
      `Paid as: ${payer || '(name or email on your PayPal payment)'}`, '',
      'My tile goes up once the payment is matched, usually within a day.'].join('\n');
  }
  function mailHref(){
    return `mailto:${claimEmail}?subject=${encodeURIComponent('Tile claim '+cur.code)}&body=${encodeURIComponent(mailBody())}`;
  }
  function refresh(){
    const pv = $('c-preview');
    pv.style.background = $('f-color').value;
    pv.querySelector('.e').textContent = $('f-emoji').value || '■';
    pv.querySelector('.t').textContent = $('f-text').value;
    $('c-msg').value = mailBody();
    $('c-len').textContent = '';
    $('c-mail').href = mailHref();
  }
  ['f-emoji','f-color','f-text','f-handle','f-link','f-pixel','f-payer'].forEach(id => $(id).addEventListener('input', refresh));
  $('c-pay').addEventListener('click', () => { $('c-mail').textContent = '2 · Now email my tile details'; });
  $('c-mail').addEventListener('click', () => { refresh(); $('c-mail').textContent = 'Email opened ✓ (no mail app? copy the details below)'; });
  $('c-copy').onclick = async () => {
    const msg = mailBody();
    try { await navigator.clipboard.writeText(msg); }
    catch(e){ const ta = $('c-msg'); ta.focus(); ta.select(); try { document.execCommand('copy'); } catch(_){} }
    $('c-copy').textContent = 'Copied ✓';
  };
  $('c-msg').addEventListener('focus', e => e.target.select());

  function safeLink(u){
    if (!u) return '';
    const href = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    try { const x = new URL(href); if (!/^https?:$/.test(x.protocol)) return ''; return ` <a href="${esc(x.href)}" target="_blank" rel="nofollow ugc noopener">${esc(x.hostname)}</a>`; } catch(e){ return ''; }
  }
  function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
})();
