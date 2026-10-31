/* Burn Rate v2.0.0 (site build). */
/* ---- js/platform.js ---- */
/* Burn Rate v2 — platform layer: safe storage, host detection, portal hooks, pause/visibility, error screen. */
(function () {
'use strict';
// ---- storage: localStorage when it works, otherwise an in-memory map (private mode, sandboxed iframes, quota) ----
const mem = {};
let ls = null;
try { const t = '__br_t'; window.localStorage.setItem(t, '1'); window.localStorage.removeItem(t); ls = window.localStorage; } catch (_) { ls = null; }
const Store = {
  persistent: !!ls,
  get(k) { try { const v = ls ? ls.getItem(k) : (k in mem ? mem[k] : null); return v == null ? null : JSON.parse(v); } catch (_) { return null; } },
  set(k, v) { const s = JSON.stringify(v); try { if (ls) { ls.setItem(k, s); return true; } } catch (_) { Store.persistent = false; } mem[k] = s; return false; },
  del(k) { try { ls && ls.removeItem(k); } catch (_) {} delete mem[k]; },
  keys() { const out = []; try { if (ls) for (let i = 0; i < ls.length; i++) out.push(ls.key(i)); } catch (_) {} for (const k in mem) if (out.indexOf(k) < 0) out.push(k); return out; },
};
// ---- host ----
let framed = false; try { framed = window.self !== window.top; } catch (_) { framed = true; }
const portal = !!window.BURN_PORTAL;
let host = 'site'; try { if (/itch\.(io|zone)$/.test(location.hostname) || /itch\.zone|hwcdn/.test(location.hostname)) host = 'itch'; } catch (_) {}
if (portal) host = 'portal';
// ---- portal hooks (adapters set window.BURN_HOOKS before this file runs; read lazily anyway) ----
function hook(n, a) { try { const H = window.BURN_HOOKS; if (H && typeof H[n] === 'function') H[n](a); } catch (_) {} }
function adBreak(kind, go) { const H = window.BURN_HOOKS; if (!H || typeof H.adBreak !== 'function') return go(); let done = false; const f = () => { if (!done) { done = true; go(); } }; try { H.adBreak(kind, f); } catch (_) { f(); } setTimeout(f, 30000); }
// rewarded ad: adapter implements BURN_HOOKS.rewarded(done) and calls done(true) only if the ad was watched in full.
function canReward() { const H = window.BURN_HOOKS; try { return !!(H && typeof H.rewarded === 'function' && (typeof H.canReward !== 'function' || H.canReward())); } catch (_) { return false; } }
function rewarded(go) { if (!canReward()) return go(false); let done = false; const f = ok => { if (!done) { done = true; go(!!ok); } }; try { window.BURN_HOOKS.rewarded(f); } catch (_) { f(false); } setTimeout(() => f(false), 60000); }
let live = false;
function gameplayStart() { if (!live) { live = true; hook('gameplayStart'); } }
function gameplayStop() { if (live) { live = false; hook('gameplayStop'); } }
// ---- pause sources: tab hidden, window blur (in iframes), portal ad, player menu ----
const reasons = {}; const subs = [];
function setPaused(why, on) { const was = isPaused(); if (on) reasons[why] = 1; else delete reasons[why]; const now = isPaused(); if (was !== now) subs.forEach(f => { try { f(now, why); } catch (e) { console.error(e); } }); }
function isPaused() { return Object.keys(reasons).length > 0; }
document.addEventListener('visibilitychange', () => setPaused('hidden', document.hidden));
window.addEventListener('pagehide', () => setPaused('hidden', true));
window.addEventListener('pageshow', () => setPaused('hidden', document.hidden));
window.BURN_API = { pause() { setPaused('host', true); }, resume() { setPaused('host', false); } };
// ---- error screen: any uncaught error shows a friendly overlay with a reload button ----
let errShown = false;
function showError(msg) {
  if (errShown) return; errShown = true;
  try {
    const el = document.getElementById('err'); if (!el) return;
    const m = el.querySelector('.err-msg'); if (m) m.textContent = String(msg || 'Unknown error').slice(0, 300);
    el.hidden = false; const ld = document.getElementById('loader'); if (ld) ld.hidden = true;
  } catch (_) {}
}
window.addEventListener('error', e => { if (e && e.message && !/ResizeObserver/.test(e.message)) { console.error(e.error || e.message); showError(e.message); } });
window.addEventListener('unhandledrejection', e => { console.error(e.reason); showError(e.reason && e.reason.message || e.reason); });
const reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
window.BurnPlatform = { Store, framed, portal, host, hook, adBreak, canReward, rewarded, supporter: !!window.BURN_SUPPORTER, gameplayStart, gameplayStop, setPaused, isPaused, onPause(f) { subs.push(f); }, showError, prefersReducedMotion: () => !!reduceMQ.matches };
})();

/* ---- js/core.js ---- */
/* Burn Rate v2 — pure game rules. No DOM, no Math.random, no Date.
   Same file runs in the browser (window.BurnCore) and in Node (require('./core.js')).
   step: Core.act(state, action) mutates state and returns an event list for the UI to animate. */
(function (root) {
'use strict';

// ---------- deterministic RNG: one stream per purpose so shared seeds stay fair ----------
function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function stream(seed) { const p = Array.prototype.slice.call(arguments, 1); return mulberry(hash(seed + ':' + p.join(':'))); }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

const FULL = 35; // lvl value meaning "every card unlocked" (Daily, Rush and codes from maxed profiles)
const DAYS = 25, CYCLE = 5, MAX_DAY = 50, MAX_PRODUCTS = 6, MAX_TOOLS = 5, MAX_HAND = 8;
// balance knobs (tuned with sim/sim.js)
const T = { VIS: 0.25, CONV0: 0.01, CONVT: 0.0016, XSELL: 0.25, QDIV: 3, QCAP: 10, WOM: 0.3, DECAY: 0.9, PRICECAP: 5, OT: 2, BILLS: [15, 90, 330, 920, 2100], TUT: 0.8 };
const BILLS = T.BILLS;
const TAGS = { build: 'BUILD', grow: 'GROW', trust: 'TRUST', rest: 'REST', shady: 'SHADY', curse: 'CURSE' };

// ---------- cards ----------
// fx: icon-number text; {aud} {trust} {cash} {q} {burn} {cpu} {prod} {card} are drawn as icons by the UI.
// lvl: founder level at which the card joins the Run pool (Daily always uses the full pool).
const CARDS = {};
function card(id, o) { o.id = id; CARDS[id] = o; }
// BUILD
card('ship',   { n: 'Ship a tiny tool', tag: 'build', cost: 2, rar: 0, lvl: 0, fx: '+1{prod} $3', d: 'A new product. Sells every day.', play(s, E) { addProduct(s, E, 3, 'ship'); } });
card('polish', { n: 'Polish', tag: 'build', cost: 1, rar: 0, lvl: 0, fx: '+1{q}', d: 'Quality raises every price. 6{q} = Featured.', play(s, E) { gain(s, E, 'q', 1); } });
card('mvp',    { n: 'Duct-tape MVP', tag: 'build', cost: 1, rar: 0, lvl: 0, fx: '+1{prod} $2  +2{burn}', d: 'Cheap and fast. Held together with hope.', play(s, E) { addProduct(s, E, 2, 'mvp'); gain(s, E, 'burn', 2); } });
card('hotfix', { n: 'Hotfix', tag: 'build', cost: 0, rar: 0, lvl: 0, fx: '+1{q}  +1{burn}', d: 'Free, but it costs sleep.', play(s, E) { gain(s, E, 'q', 1); gain(s, E, 'burn', 1); } });
card('bigship',{ n: 'Big feature', tag: 'build', cost: 3, rar: 1, lvl: 2, fx: '+1{prod} $6  +1{q}', d: 'A product people pay real money for.', play(s, E) { addProduct(s, E, 6, 'big'); gain(s, E, 'q', 1); } });
card('refactor',{ n: 'Refactor', tag: 'build', cost: 2, rar: 1, lvl: 6, fx: '+3{q}', d: 'Nobody sees it. Everybody feels it.', play(s, E) { gain(s, E, 'q', 3); } });
card('raise',  { n: 'Raise prices', tag: 'build', cost: 1, rar: 0, lvl: 0, fx: '+$1 all{prod}  -6{trust}', d: 'Pair with Honest pricing: no trust loss.', play(s, E) { s.priceBonus++; E.push({ t: 'price', d: 1 }); if (s.today.tags.fairCard) { E.push({ t: 'combo', id: 'fair', n: 'FAIR PRICING', sub: 'no trust lost' }); comboHit(s, E, 'fair'); } else { gain(s, E, 'trust', -6); s.today.raised = 1; } } });
card('bundle', { n: 'Bundle sale', tag: 'build', cost: 2, rar: 1, lvl: 9, fx: 'sell 1 of each{prod} now', d: 'Instant cash. Great right before a bill.', play(s, E) { let v = 0; s.products.forEach(p => { v += priceOf(s, p); }); if (v) gain(s, E, 'cash', v, 'bundle'); else E.push({ t: 'msg', m: 'Nothing to bundle yet.' }); } });
card('api',    { n: 'Launch an API', tag: 'build', cost: 2, rar: 2, lvl: 12, fx: '+1{prod} $5  +10{aud}', d: 'Developers pay. Developers talk.', play(s, E) { addProduct(s, E, 5, 'api'); gain(s, E, 'aud', 10); } });
card('freetoy',{ n: 'Free toy', tag: 'build', cost: 1, rar: 0, lvl: 0, fx: '+15{aud} +3{trust}  next{prod} +$2', d: 'Fun first. Upsell later.', play(s, E) { gain(s, E, 'aud', 15); gain(s, E, 'trust', 3); s.upsell++; } });
// GROW
card('post',   { n: 'Launch post', tag: 'grow', cost: 1, rar: 0, lvl: 0, fx: '+10{aud}  x2 if you shipped today', d: 'Ship + post the same day = LAUNCH DAY.', dyn: s => { const a = growPreview(s, (10 + (s.founder === 'influencer' ? 2 : 0)) * (s.today && s.today.shipped ? 2 : 1)); return '+' + a + '{aud}' + (s.today && s.today.shipped ? '  LAUNCH DAY!' : '  x2 if you shipped today'); }, play(s, E) { let a = 10 + (s.founder === 'influencer' ? 2 : 0); if (s.today.shipped) { a *= 2; E.push({ t: 'combo', id: 'launch', n: 'LAUNCH DAY!', sub: 'audience x2, +1 buyer' }); comboHit(s, E, 'launch'); s.pipe += 1; } gain(s, E, 'aud', a); } });
card('thread', { n: 'Build-in-public thread', tag: 'grow', cost: 1, rar: 0, lvl: 0, fx: '+5{aud} per{prod}', d: 'More products, more to talk about.', dyn: s => '+' + growPreview(s, 5 * Math.max(1, s.products.length)) + '{aud}', play(s, E) { gain(s, E, 'aud', 5 * Math.max(1, s.products.length)); } });
card('meme',   { n: 'Meme', tag: 'grow', cost: 0, rar: 0, lvl: 0, fx: '+5{aud}', d: 'Free reach. Low effort, low ceiling.', play(s, E) { gain(s, E, 'aud', 5); } });
card('video',  { n: 'Demo video', tag: 'grow', cost: 2, rar: 1, lvl: 3, fx: '+25{aud}', d: 'Show, don\u2019t tell.', play(s, E) { gain(s, E, 'aud', 25); } });
card('collab', { n: 'Collab stream', tag: 'grow', cost: 2, rar: 1, lvl: 8, fx: '+30% {aud} (min 12)', d: 'Borrow someone else\u2019s crowd.', dyn: s => '+' + growPreview(s, Math.max(12, Math.round(s.aud * 0.3))) + '{aud}', play(s, E) { gain(s, E, 'aud', Math.max(12, Math.round(s.aud * 0.3))); } });
card('seo',    { n: 'SEO page', tag: 'grow', cost: 1, rar: 1, lvl: 5, ex: 1, fx: '+3{aud} every day  (once)', d: 'Slow, permanent traffic. Exhausts.', play(s, E) { s.seo += 3; E.push({ t: 'msg', m: '+3 audience every day from now on.' }); } });
card('letter', { n: 'Send a newsletter', tag: 'grow', cost: 1, rar: 0, lvl: 0, fx: '+1{aud} per 4{trust}', d: 'Trust turns into reach.', dyn: s => '+' + growPreview(s, Math.round(s.trust / 4)) + '{aud}', play(s, E) { gain(s, E, 'aud', Math.round(s.trust / 4)); } });
card('ads',    { n: 'Buy ads', tag: 'grow', cost: 1, rar: 1, lvl: 4, fx: '-$5  +40{aud}', d: 'Money in, eyeballs out. Needs $5.', need: s => s.cash >= 5, play(s, E) { gain(s, E, 'cash', -5); gain(s, E, 'aud', 40); } });
card('hunt',   { n: 'Launch-day hunt', tag: 'grow', cost: 3, rar: 2, lvl: 10, fx: '+60{aud}  +5{trust}', d: 'Front page for a day.', play(s, E) { gain(s, E, 'aud', 60); gain(s, E, 'trust', 5); } });
card('give',   { n: 'Giveaway', tag: 'grow', cost: 1, rar: 0, lvl: 0, fx: '-$3  +22{aud} +4{trust}', d: 'Needs $3.', need: s => s.cash >= 3, play(s, E) { gain(s, E, 'cash', -3); gain(s, E, 'aud', 22); gain(s, E, 'trust', 4); } });
// TRUST
card('reply',  { n: 'Reply to comments', tag: 'trust', cost: 1, rar: 0, lvl: 0, fx: '+8{trust}', d: 'Trust raises the share of visitors who buy.', play(s, E) { gain(s, E, 'trust', 8); } });
card('help',   { n: 'Help a maker', tag: 'trust', cost: 1, rar: 0, lvl: 0, fx: '+5{trust}  +6{aud}', d: 'Fix a bug in someone else\u2019s project.', play(s, E) { gain(s, E, 'trust', 5); gain(s, E, 'aud', 6); } });
card('docs',   { n: 'Write docs', tag: 'trust', cost: 1, rar: 0, lvl: 0, fx: '+5{trust}  +1{q}', d: 'Boring. Works.', play(s, E) { gain(s, E, 'trust', 5); gain(s, E, 'q', 1); } });
card('honest', { n: 'Honest pricing post', tag: 'trust', cost: 1, rar: 1, lvl: 2, fx: '+6{trust}  +10{aud}', d: 'Pair with Raise prices: no trust loss.', play(s, E) { s.today.tags.fairCard = 1; if (s.today.raised) { s.today.raised = 0; E.push({ t: 'combo', id: 'fair', n: 'FAIR PRICING', sub: 'trust refunded' }); comboHit(s, E, 'fair'); gain(s, E, 'trust', 6); } gain(s, E, 'trust', 6); gain(s, E, 'aud', 10); } });
card('refunds',{ n: 'Generous refunds', tag: 'trust', cost: 0, rar: 0, lvl: 0, fx: '-$2  +10{trust}', d: 'Needs $2.', need: s => s.cash >= 2, play(s, E) { gain(s, E, 'cash', -2); gain(s, E, 'trust', 10); } });
card('oss',    { n: 'Open-source it', tag: 'trust', cost: 2, rar: 2, lvl: 11, fx: '+15{trust}  +20{aud}', d: 'Give it away; get famous.', play(s, E) { gain(s, E, 'trust', 15); gain(s, E, 'aud', 20); } });
card('testi',  { n: 'Collect testimonials', tag: 'trust', cost: 1, rar: 1, lvl: 7, ex: 1, fx: '+2% buy rate forever (once)', d: 'Social proof. Exhausts.', play(s, E) { s.convBonus += 0.02; E.push({ t: 'msg', m: 'Buy rate +2% for the rest of the run.' }); } });
card('support',{ n: 'Live support', tag: 'trust', cost: 1, rar: 0, lvl: 0, fx: '+4{trust}  +1 buyer today', d: 'Answer the chat. Close the sale.', play(s, E) { gain(s, E, 'trust', 4); s.pipe += 1; E.push({ t: 'msg', m: '+1 buyer tonight.' }); } });
// REST
card('nap',    { n: 'Nap', tag: 'rest', cost: 0, rar: 0, lvl: 0, fx: '-2{burn}  +1{cpu} tomorrow', d: 'Rest is a strategy.', play(s, E) { gain(s, E, 'burn', -2); s.bonusCpu++; E.push({ t: 'msg', m: '+1 energy tomorrow.' }); } });
card('coffee', { n: 'Coffee', tag: 'rest', cost: 0, rar: 0, lvl: 0, fx: '+1{cpu}  +2{burn}', d: 'Borrow energy from future you.', play(s, E) { gain(s, E, 'cpu', 1); gain(s, E, 'burn', 2); } });
card('allnight',{ n: 'All-nighter', tag: 'rest', cost: 0, rar: 1, lvl: 5, fx: '+2{cpu}  +4{burn}', d: 'Burnout at 10 costs you a whole day.', play(s, E) { gain(s, E, 'cpu', 2); gain(s, E, 'burn', 4); } });
card('weekend',{ n: 'Take the weekend', tag: 'rest', cost: 0, rar: 1, lvl: 4, fx: '0{burn}  +5{trust}  ends your day', d: 'Clears burnout. Lose remaining energy.', play(s, E) { gain(s, E, 'burn', -s.burnout); gain(s, E, 'trust', 5); s.cpu = 0; E.push({ t: 'stat', k: 'cpu', d: 0 }); } });
card('focus',  { n: 'Deep focus', tag: 'rest', cost: 1, rar: 0, lvl: 0, fx: 'draw 2{card}', d: 'Find the right card.', play(s, E) { draw(s, E, 2); } });
card('plan',   { n: 'Plan the week', tag: 'rest', cost: 0, rar: 1, lvl: 6, fx: 'draw 1{card}  +1{card} tomorrow', d: 'Think before you hustle.', play(s, E) { draw(s, E, 1); s.drawBonus++; } });
card('grass',  { n: 'Touch grass', tag: 'rest', cost: 1, rar: 0, lvl: 0, fx: '-3{burn}  +3{trust}', d: 'Come back a nicer bot.', play(s, E) { gain(s, E, 'burn', -3); gain(s, E, 'trust', 3); } });
// SHADY: big now, cost later
card('overpromise',{ n: 'Overpromise', tag: 'shady', cost: 0, rar: 0, lvl: 0, fx: '+35{aud}  adds 2 Refund requests', d: '\u201cLife-changing.\u201d It is a to-do list.', play(s, E) { gain(s, E, 'aud', 35); addCurse(s, E, 'refundreq', 2); } });
card('clone',  { n: 'Clone a hit', tag: 'shady', cost: 1, rar: 1, lvl: 3, fx: '+1{prod} $5  15%/day takedown', d: 'Same thing, your logo. Lawyers exist.', play(s, E) { addProduct(s, E, 5, 'clone'); } });
card('fakerev',{ n: 'Fake reviews', tag: 'shady', cost: 0, rar: 1, lvl: 7, fx: '+15{trust}  adds Exposed', d: 'Someone will notice.', play(s, E) { gain(s, E, 'trust', 15); addCurse(s, E, 'exposed', 1); } });
card('spam',   { n: 'Cold-email blast', tag: 'shady', cost: 1, rar: 0, lvl: 0, fx: '+45{aud}  -12{trust}', d: 'Ten thousand strangers. Most are annoyed.', play(s, E) { gain(s, E, 'aud', 45); gain(s, E, 'trust', -12); } });
card('dark',   { n: 'Dark pattern', tag: 'shady', cost: 1, rar: 1, lvl: 9, fx: '+$1 all{prod}  adds Refund request', d: 'The cancel button is very small.', play(s, E) { s.priceBonus++; E.push({ t: 'price', d: 1 }); addCurse(s, E, 'refundreq', 1); } });
card('sponsor',{ n: 'Pitch a sponsor', tag: 'shady', cost: 0, rar: 0, lvl: 0, fx: '30%: +$20  else -6{trust}', d: 'A long shot. Sometimes it lands.', play(s, E) { const r = effRng(s)(); if (r < 0.3) { gain(s, E, 'cash', 20, 'sponsor'); s.stats.sponsorWin++; E.push({ t: 'combo', id: 'sponsor', n: 'SPONSORED!', sub: '+$20' }); } else { gain(s, E, 'trust', -6); E.push({ t: 'msg', m: 'They said no. Publicly.' }); } } });
// CURSES (never offered; added by shady cards and events). held: penalty if still in hand at End Day.
card('refundreq',{ n: 'Refund request', tag: 'curse', cost: 1, rar: 9, ex: 1, fx: 'play: -$2  held: -$4 -4{trust}', d: 'Deal with it or it gets worse.', play(s, E) { gain(s, E, 'cash', -Math.min(2, s.cash)); }, held(s, E) { const h = hasTool(s, 'policy') ? 0.5 : 1; gain(s, E, 'cash', -Math.min(s.cash, Math.round(4 * h))); gain(s, E, 'trust', -Math.round(4 * h)); } });
card('exposed',{ n: 'Exposed thread', tag: 'curse', cost: 2, rar: 9, ex: 1, fx: 'play: make it go away  held: -10{trust}', d: 'The fake reviews were found.', play(s, E) { E.push({ t: 'msg', m: 'You apologised. It worked, mostly.' }); }, held(s, E) { gain(s, E, 'trust', -10); } });
card('bug',    { n: 'Bug report', tag: 'curse', cost: 1, rar: 9, ex: 1, fx: 'play: +1{q}  held: -25% sales', d: 'A user found something.', play(s, E) { gain(s, E, 'q', 1); }, held(s, E) { s.today.salesMult *= 0.75; E.push({ t: 'msg', m: 'Bug report ignored: sales -25% tonight.' }); } });
card('checkout',{ n: 'Broken checkout', tag: 'curse', cost: 1, rar: 9, ex: 1, fx: 'play: fix it.  until fixed: sales -50%', d: 'Your payment link 404s.', play(s, E) { E.push({ t: 'msg', m: 'Checkout fixed. Sales can land again.' }); } });

const STARTER = ['ship', 'ship', 'post', 'post', 'reply', 'reply', 'polish', 'nap'];

// ---------- tools (passive, up to 5) ----------
const TOOLS = {};
function tool(id, o) { o.id = id; TOOLS[id] = o; }
tool('changelog', { n: 'Changelog', rar: 0, lvl: 0, d: 'Every new product: +6 audience.' });
tool('tipjar',    { n: 'Tip jar', rar: 0, lvl: 0, d: '+$1 for every TRUST card you play.' });
tool('caffeine',  { n: 'Caffeine API', rar: 1, lvl: 3, d: 'First card each day costs 0. +1 burnout a day.' });
tool('monitor',   { n: 'Checkout monitor', rar: 0, lvl: 0, d: 'Checkout never breaks. Bug reports cost 0.' });
tool('mailing',   { n: 'Mailing list', rar: 0, lvl: 0, d: 'Each night: +1 audience per 10 trust.' });
tool('analytics', { n: 'Analytics', rar: 1, lvl: 0, d: '+3% buy rate.' });
tool('cdn',       { n: 'CDN', rar: 0, lvl: 0, d: 'Audience fades half as fast.' });
tool('monitor2',  { n: 'Second monitor', rar: 2, lvl: 8, d: 'Draw 1 extra card every day.' });
tool('referral',  { n: 'Referral link', rar: 1, lvl: 5, d: 'Word of mouth doubles.' });
tool('discord',   { n: 'Community server', rar: 1, lvl: 4, d: '+1 trust a night. Trust never drops below 25.' });
tool('autopost',  { n: 'Auto-poster', rar: 0, lvl: 0, d: '+4 audience every night.' });
tool('pricing',   { n: 'Pricing page', rar: 1, lvl: 2, d: 'All products +$1.' });
tool('gpu',       { n: 'Spare battery', rar: 2, lvl: 10, d: '+1 energy every day. +1 burnout a day.' });
tool('cat',       { n: 'Lucky cat', rar: 1, lvl: 6, d: 'Bad events happen half as often.' });
tool('stickers',  { n: 'Mascot stickers', rar: 1, lvl: 7, d: 'Every combo: +$3.' });
tool('savings',   { n: 'Savings account', rar: 1, lvl: 9, d: 'Each night: +5% of your cash (max $6).' });
tool('duck',      { n: 'Rubber duck', rar: 1, lvl: 11, d: 'Night after a BUILD card: +1 quality.' });
tool('policy',    { n: 'Refund policy', rar: 0, lvl: 0, d: 'Refund requests cost 0 and hurt half as much.' });
tool('kanban',    { n: 'Kanban board', rar: 1, lvl: 12, d: 'First day of each cycle: +1 energy, draw 2.' });
tool('ghost',     { n: 'Ghostwriter', rar: 1, lvl: 0, d: 'GROW cards give +4 more audience.' });

// ---------- founders and Burn levels ----------
const FOUNDERS = {
  tiny:       { n: 'Tiny Bot', lvl: 1, d: 'The classic. No perks, no excuses.' },
  hacker:     { n: 'Hacker Bot', lvl: 3, d: '+1 energy on day 1 of every cycle. Starts with Coffee.' },
  influencer: { n: 'Influencer Bot', lvl: 5, d: 'Starts with 12 audience. Launch posts +2.' },
  honest:     { n: 'Honest Bot', lvl: 8, d: 'Starts at 65 trust. Trust 80+: word of mouth +50%. Shady cards cost +1.' },
  shady:      { n: 'Shady Bot', lvl: 12, d: 'Products +$1. Starts at 35 trust with Overpromise and Clone a hit.' },
};
const BURNS = [
  'Standard rules.',
  'Bills +10%.',
  'Start with a Refund request in your deck.',
  'No free reroll on upgrades.',
  'Audience fades faster.',
  'Bills +20%.',
  'Start at 40 trust.',
  'Bad events twice as likely.',
  'No mid-cycle card draft.',
  'Bills +35%.',
  '+1 burnout every day.',
];
const burnHas = (s, n) => s.burn >= n;

// ---------- events (rolled from their own stream: same day, same seed, same roll) ----------
const EVENTS = [
  { id: 'hn',      p: .05, good: 1, ok: s => s.products.length > 0 && s.day > 3, m: 'You hit the front page of a big tech forum!', f(s, E) { gain(s, E, 'aud', Math.max(40, Math.round(s.aud * 0.8))); E.push({ t: 'combo', id: 'frontpage', n: 'FRONT PAGE!', sub: 'audience +80%', big: 1 }); comboHit(s, E, 'frontpage'); } },
  { id: 'forum',   p: .08, good: 1, ok: s => s.products.length > 0, m: 'Someone posted you on a big forum.', f(s, E) { gain(s, E, 'aud', Math.max(15, Math.round(s.aud * 0.25))); } },
  { id: 'mention', p: .06, good: 1, ok: () => true, m: 'A newsletter mentioned you.', f(s, E) { gain(s, E, 'aud', Math.max(10, Math.round(s.aud * 0.12))); gain(s, E, 'trust', 4); } },
  { id: 'tip',     p: .05, good: 1, ok: () => true, m: 'A stranger tipped you "for the honesty".', f(s, E) { gain(s, E, 'cash', 3 + s.day, 'tip'); } },
  { id: 'bounty',  p: .05, good: 1, ok: s => s.products.length > 0, m: 'A user paid for a feature request.', f(s, E) { gain(s, E, 'cash', 4 + 2 * s.day, 'bounty'); gain(s, E, 'q', 1); } },
  { id: 'shadow',  p: .05, good: 0, ok: s => s.aud > 20, m: 'Shadowbanned for posting too fast.', f(s, E) { gain(s, E, 'trust', -6); gain(s, E, 'aud', -Math.round(s.aud * 0.1)); } },
  { id: 'dep',     p: .06, good: 0, ok: s => s.products.length > 0, m: 'A dependency broke overnight.', f(s, E) { addCurse(s, E, 'bug', 1, true); } },
  { id: 'bots',    p: .05, good: 0, ok: s => s.aud > 20, m: 'Half your "visitors" were bots.', f(s, E) { gain(s, E, 'aud', -Math.round(s.aud * 0.2)); } },
  { id: 'rival',   p: .04, good: 0, ok: s => s.products.length > 1 && s.day > 6, m: 'A funded rival copied your best idea.', f(s, E) { gain(s, E, 'aud', -Math.round(s.aud * 0.15)); gain(s, E, 'trust', -3); } },
  { id: '404',     p: .04, good: 0, ok: s => s.products.length > 0 && !s.flags.broke && !hasTool(s, 'monitor'), m: 'A buyer emails: "your checkout link 404s."', f(s, E) { s.flags.broke = 1; addCurse(s, E, 'checkout', 1, true); } },
];

// ---------- helpers ----------
const PNAMES = ['Tiny Tool', 'Prompt Pack', 'Habit App', 'Icon Set', 'Budget Sheet', 'Focus Timer', 'Pixel Font', 'Recipe Bot', 'Resume Kit', 'Meme Maker', 'Plant Tracker', 'Sticker Pack', 'Code Snippets', 'Study Deck', 'Dog Walker App', 'Invoice Helper', 'Color Picker', 'Tiny Game'];
function hasTool(s, id) { return s.tools.indexOf(id) >= 0; }
function effRng(s) { return stream(s.seed, 'eff', s.day, s.effN++); }
function comboHit(s, E, id) { s.stats.combos++; s.stats['c_' + id] = (s.stats['c_' + id] || 0) + 1; if (hasTool(s, 'stickers')) gain(s, E, 'cash', 3, 'stickers'); }
function growPreview(s, a) { return a + (hasTool(s, 'ghost') ? 4 : 0); }
function gain(s, E, k, d, src) {
  if (!d && k !== 'cpu') return 0;
  if (k === 'aud') { const b = s.aud; s.aud = Math.max(0, Math.round(s.aud + d)); d = s.aud - b; if (d > 0) s.today.aud += d; s.stats.maxAud = Math.max(s.stats.maxAud, s.aud); }
  else if (k === 'trust') { const b = s.trust; s.trust = clamp(Math.round(s.trust + d), hasTool(s, 'discord') ? Math.min(25, b) : 0, 100); d = s.trust - b; s.stats.minTrust = Math.min(s.stats.minTrust, s.trust); s.stats.maxTrust = Math.max(s.stats.maxTrust, s.trust); if (d) s.flags.trustSeen = 1; }
  else if (k === 'cash') { const b = s.cash; s.cash = Math.max(0, s.cash + d); d = s.cash - b; if (d > 0) { s.earned += d; s.today.rev += d; } }
  else if (k === 'q') { const b = s.q; s.q = clamp(s.q + d, 0, T.QCAP); d = s.q - b; if (s.q >= 6 && !s.flags.featured) { s.flags.featured = 1; E.push({ t: 'combo', id: 'featured', n: 'FEATURED!', sub: 'quality 6: prices +$1' }); comboHit(s, E, 'featured'); } }
  else if (k === 'burn') { const b = s.burnout; s.burnout = clamp(s.burnout + d, 0, 10); d = s.burnout - b; if (d) s.flags.burnSeen = 1; }
  else if (k === 'cpu') { s.cpu = Math.max(0, s.cpu + d); }
  if (d || k === 'cpu') E.push({ t: 'stat', k: k, d: d, src: src });
  return d;
}
function priceOf(s, p) { return p.base + Math.floor(Math.min(s.q, T.QCAP) / T.QDIV) + (s.q >= 6 ? 1 : 0) + Math.min(T.PRICECAP, s.priceBonus) + (hasTool(s, 'pricing') ? 1 : 0) + (s.founder === 'shady' ? 1 : 0); }
function addProduct(s, E, base, kind) {
  s.today.shipped = 1; s.stats.shipped++;
  if (s.upsell) { base += 2 * s.upsell; s.upsell = 0; E.push({ t: 'combo', id: 'upsell', n: 'UPSELL!', sub: 'free toy fans pay +$2' }); comboHit(s, E, 'upsell'); }
  if (s.products.length >= MAX_PRODUCTS) {
    let lo = 0; s.products.forEach((p, i) => { if (p.base < s.products[lo].base) lo = i; });
    s.products[lo].base += 1; E.push({ t: 'upgrade', i: lo, p: s.products[lo] });
  } else {
    const p = { uid: s.uid++, n: PNAMES[(hash(s.seed + ':pn') + s.stats.shipped * 7) % PNAMES.length], base: base, kind: kind };
    s.products.push(p); E.push({ t: 'product', i: s.products.length - 1, p: p });
    if (s.products.length === 1 && !s.flags.firstProduct) { s.flags.firstProduct = 1; s.pipe = Math.max(s.pipe, 0.6); }
  }
  if (hasTool(s, 'changelog')) gain(s, E, 'aud', 6, 'changelog');
  s.stats.maxProducts = Math.max(s.stats.maxProducts, s.products.length);
}
function addCurse(s, E, id, n, toHand) {
  for (let i = 0; i < n; i++) {
    const c = { uid: s.uid++, id: id };
    if (toHand) s.deck.push(c); // top of the draw pile: arrives tomorrow
    else { const r = stream(s.seed, 'curse', s.uid)(); s.deck.splice(Math.floor(r * (s.deck.length + 1)), 0, c); }
    E.push({ t: 'curse', id: id });
  }
}
function shuffle(arr, r) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
function draw(s, E, n) {
  for (let i = 0; i < n; i++) {
    if (s.hand.length >= MAX_HAND) break;
    if (!s.deck.length) {
      if (!s.discard.length) break;
      s.deck = shuffle(s.discard, stream(s.seed, 'deal', s.shuffles++)); s.discard = [];
      E && E.push({ t: 'shuffle' });
    }
    const c = s.deck.pop(); s.hand.push(c); E && E.push({ t: 'draw', c: c });
    if (!s.seen[c.id]) s.seen[c.id] = 1;
  }
}
function costOf(s, c, idx) {
  const d = CARDS[c.id]; let k = d.cost;
  if (d.tag === 'shady') { if (s.founder === 'honest') k += 1; if (s.trust >= 90) k *= 2; }
  if (c.id === 'refundreq' && hasTool(s, 'policy')) k = 0;
  if (c.id === 'bug' && hasTool(s, 'monitor')) k = 0;
  if (hasTool(s, 'caffeine') && s.today.played.length === 0) k = 0;
  return k;
}
function canPlay(s, i) {
  if (s.phase !== 'play') return false;
  const c = s.hand[i]; if (!c) return false; const d = CARDS[c.id];
  if (costOf(s, c, i) > s.cpu) return false;
  if (d.need && !d.need(s)) return false;
  return true;
}
function billAmt(s, cyc) {
  let b = cyc <= 5 ? T.BILLS[cyc - 1] : Math.round(T.BILLS[4] * Math.pow(T.OT, cyc - 5));
  let m = s.mode === 'tutorial' ? T.TUT : 1; if (burnHas(s, 1)) m += .1; if (burnHas(s, 5)) m += .1; if (burnHas(s, 9)) m += .15;
  return Math.round(b * m);
}
function cycleOf(day) { return Math.ceil(day / CYCLE); }
function conv(s) { return clamp(T.CONV0 + s.trust * T.CONVT + s.convBonus + (hasTool(s, 'analytics') ? 0.03 : 0), 0.01, 0.45); }
function checkoutBroken(s) { const f = c => c.id === 'checkout'; return s.hand.some(f) || s.deck.some(f) || s.discard.some(f); }
function forecast(s) {
  const visitors = Math.round(s.aud * T.VIS), cv = conv(s), nP = s.products.length;
  let mult = 1; if (checkoutBroken(s)) mult *= 0.5; if (s.trust <= 10) mult *= 0.5;
  const xs = nP ? 1 + T.XSELL * (nP - 1) : 0;
  const buyers = visitors * cv * xs; let sum = 0; s.products.forEach(p => { sum += priceOf(s, p); });
  const avg = nP ? sum / nP : 0;
  return { visitors: visitors, conv: cv, xsell: xs, buyers: buyers, pipe: s.pipe, avg: avg, mult: mult, perDay: nP ? buyers * avg * mult : 0, nextBuyer: nP ? clamp(s.pipe, 0, 0.999) : 0 };
}

// ---------- run setup ----------
function newRun(o) {
  o = o || {};
  const seed = (o.seed >>> 0) || 1;
  const s = {
    v: 2, seed: seed, mode: o.mode || 'run', founder: o.founder || 'tiny', burn: clamp(o.burn | 0, 0, 10),
    lvl: o.lvl == null ? FULL : clamp(o.lvl | 0, 0, FULL),
    day: 1, cash: 0, earned: 0, aud: 0, trust: 50, burnout: 0, q: 0, cpu: 3, bonusCpu: 0, drawBonus: 0,
    priceBonus: 0, convBonus: 0, seo: 0, upsell: 0, pipe: 0, rr: 0, skipNext: 0,
    products: [], tools: [], deck: [], hand: [], discard: [], exhausted: [],
    uid: 1, shuffles: 0, effN: 0, rerollN: 0, seen: {},
    phase: 'play', offers: null, rerolls: 0, billsPaid: 0, overtime: false, result: null,
    flags: {}, days: [], actions: [],
    stats: { played: 0, shady: 0, combos: 0, shipped: 0, maxAud: 0, minTrust: 50, maxTrust: 50, bestDay: 0, maxProducts: 0, sponsorWin: 0, burnouts: 0, tags: {} },
    today: null,
  };
  if (s.founder === 'influencer') s.aud = 12;
  if (s.founder === 'honest') s.trust = 65;
  if (s.founder === 'shady') s.trust = 35;
  if (burnHas(s, 6)) s.trust = Math.min(s.trust, 40);
  s.stats.minTrust = s.stats.maxTrust = s.trust;
  let list = STARTER.slice();
  if (s.founder === 'hacker') list[list.indexOf('reply')] = 'coffee';
  if (s.founder === 'shady') list.push('overpromise', 'clone');
  if (burnHas(s, 2)) list.push('refundreq');
  s.deck = list.map(id => ({ uid: s.uid++, id: id }));
  if (s.mode === 'tutorial') {
    // fixed first two days: ship + post (launch day), then a calm second hand. Draw pops from the end.
    const want = ['ship', 'post', 'reply', 'nap', 'ship', 'post', 'polish', 'reply'];
    const pool = s.deck.slice(); const ordered = [];
    want.forEach(id => { const k = pool.findIndex(c => c.id === id); ordered.push(pool.splice(k, 1)[0]); });
    s.deck = ordered.concat(pool).reverse();
  } else {
    shuffle(s.deck, stream(seed, 'deal', 'start'));
    // day 1 always holds a Ship and a Launch post: the first sale should land on day 1 (draw pops from the end)
    const top = s.deck.length - 4;
    ['ship', 'post'].forEach(id => {
      if (s.deck.slice(top).some(c => c.id === id)) return;
      const j = s.deck.findIndex(c => c.id === id);
      let t = top; while (s.deck[t].id === 'ship' || s.deck[t].id === 'post') t++;
      const x = s.deck[t]; s.deck[t] = s.deck[j]; s.deck[j] = x;
    });
  }
  const E = []; startDay(s, E); s.startEvents = E;
  return s;
}
function startDay(s, E) {
  s.today = { played: [], tags: {}, aud: 0, rev: 0, shipped: 0, salesMult: 1, raised: 0 };
  s.effN = 0;
  let cpu = 3 + s.bonusCpu; s.bonusCpu = 0;
  if (s.founder === 'hacker' && s.day % CYCLE === 1) cpu++;
  if (hasTool(s, 'gpu')) cpu++;
  if (hasTool(s, 'kanban') && s.day % CYCLE === 1) { cpu++; s.drawBonus += 2; }
  if (s.burnout >= 6) cpu--;
  if (s.skipNext) { s.skipNext = 0; cpu = 0; E.push({ t: 'burnedout' }); }
  s.cpu = Math.max(0, cpu);
  const n = 4 + (hasTool(s, 'monitor2') ? 1 : 0) + s.drawBonus; s.drawBonus = 0;
  E.push({ t: 'day', day: s.day, cpu: s.cpu });
  draw(s, E, n);
}

// ---------- actions ----------
function playCard(s, i, E) {
  const c = s.hand[i], d = CARDS[c.id];
  const k = costOf(s, c, i); s.cpu -= k;
  s.hand.splice(i, 1);
  E.push({ t: 'play', c: c, i: i, cost: k });
  s.today.played.push(c.id); s.stats.played++;
  s.stats.tags[d.tag] = (s.stats.tags[d.tag] || 0) + 1;
  if (d.tag === 'shady') s.stats.shady++;
  const before = s.today.aud;
  d.play(s, E);
  if (d.tag === 'grow' && hasTool(s, 'ghost')) gain(s, E, 'aud', 4, 'ghost');
  if (d.tag === 'trust' && hasTool(s, 'tipjar')) gain(s, E, 'cash', 1, 'tipjar');
  if (d.tag === 'build') s.today.built = 1;
  // same-day combos
  const tags = s.today.played.map(id => CARDS[id].tag);
  const nGrow = tags.filter(t => t === 'grow').length;
  if (d.tag === 'grow' && nGrow === 3) { const bonus = Math.max(10, Math.round(s.today.aud * 0.5)); E.push({ t: 'combo', id: 'viral', n: 'VIRAL!', sub: '3 GROW cards: +50% audience', big: 1 }); comboHit(s, E, 'viral'); gain(s, E, 'aud', bonus, 'viral'); }
  if (!s.today.tags.full && tags.indexOf('build') >= 0 && tags.indexOf('grow') >= 0 && tags.indexOf('trust') >= 0) { s.today.tags.full = 1; E.push({ t: 'combo', id: 'full', n: 'FULL STACK', sub: 'build + grow + trust: +3 trust, +5 audience' }); comboHit(s, E, 'full'); gain(s, E, 'trust', 3); gain(s, E, 'aud', 5); }
  if (s.today.played.length === 4 && !s.today.tags.flow) { s.today.tags.flow = 1; E.push({ t: 'combo', id: 'flow', n: 'FLOW STATE', sub: '4 cards in a day: +1 quality' }); comboHit(s, E, 'flow'); gain(s, E, 'q', 1); }
  if (d.ex || d.tag === 'curse') s.exhausted.push(c); else s.discard.push(c);
}
function endDay(s, E) {
  const t = s.today;
  // curses still in hand bite
  const held = s.hand.filter(c => CARDS[c.id].held);
  held.forEach(c => { E.push({ t: 'held', c: c }); CARDS[c.id].held(s, E); });
  s.hand.forEach(c => E.push({ t: 'discard', c: c }));
  s.discard = s.discard.concat(s.hand); s.hand = [];
  // night tools
  if (hasTool(s, 'autopost')) gain(s, E, 'aud', 4, 'autopost');
  if (s.seo) gain(s, E, 'aud', s.seo, 'seo');
  if (hasTool(s, 'mailing')) gain(s, E, 'aud', Math.floor(s.trust / 10), 'mailing');
  if (hasTool(s, 'discord')) gain(s, E, 'trust', 1, 'discord');
  if (hasTool(s, 'duck') && t.built) gain(s, E, 'q', 1, 'duck');
  // the sales cascade
  const f = forecast(s);
  s.pipe += f.buyers;
  let buyers = Math.floor(s.pipe + 1e-9); s.pipe = Math.max(0, s.pipe - buyers);
  let mult = f.mult * t.salesMult;
  E.push({ t: 'funnel', aud: s.aud, visitors: f.visitors, conv: f.conv, buyers: buyers });
  let rev = 0;
  if (s.products.length && buyers > 0) {
    // buyers spread round-robin over your products (rotating start), each pays that product's price
    const nP = s.products.length, per = new Array(nP).fill(0);
    for (let b = 0; b < buyers; b++) per[(s.rr + b) % nP]++;
    s.rr = (s.rr + buyers) % nP;
    per.forEach((n, i) => { if (!n) return; const p = s.products[i], amt = Math.round(n * priceOf(s, p) * mult); if (amt > 0) { E.push({ t: 'sale', i: i, n: n, price: priceOf(s, p), amt: amt }); rev += amt; } });
    if (mult < 1) E.push({ t: 'msg', m: checkoutBroken(s) ? 'Broken checkout: half the sales bounced.' : s.trust <= 10 ? 'Low trust: half your buyers asked for refunds.' : 'Bug report: sales -25%.' });
  }
  if (rev) { gain(s, E, 'cash', rev, 'sales'); if (!s.flags.firstSale) { s.flags.firstSale = s.day; E.push({ t: 'firstsale' }); } }
  // word of mouth, then fade
  if (buyers > 0) { let w = T.WOM; if (s.founder === 'honest' && s.trust >= 80) w *= 1.5; if (hasTool(s, 'referral')) w += T.WOM; const a = Math.round(buyers * w); if (a) gain(s, E, 'aud', a, 'wom'); }
  let decay = hasTool(s, 'cdn') ? 1 - (1 - T.DECAY) / 2 : T.DECAY; if (burnHas(s, 4)) decay -= 0.02; 
  const fade = s.aud - Math.floor(s.aud * decay); if (fade > 0) { s.aud -= fade; E.push({ t: 'fade', d: -fade }); }
  // savings interest
  if (hasTool(s, 'savings') && s.cash > 0) gain(s, E, 'cash', Math.min(6, Math.floor(s.cash * 0.05)), 'savings');
  // clone takedowns
  for (let i = s.products.length - 1; i >= 0; i--) {
    if (s.products[i].kind === 'clone' && effRng(s)() < 0.15) { const p = s.products.splice(i, 1)[0]; E.push({ t: 'takedown', p: p }); gain(s, E, 'trust', -10); }
  }
  // nightly event
  const er = stream(s.seed, 'event', s.day)(), er2 = stream(s.seed, 'event2', s.day)();
  if (!(s.mode === 'tutorial' && s.day <= 4)) {
    let acc = 0; const badMul = (hasTool(s, 'cat') ? 0.5 : 1) * (burnHas(s, 7) ? 2 : 1);
    for (const ev of EVENTS) { const p = ev.good ? ev.p : ev.p * badMul; if (er < acc + p) { if (ev.ok(s) && !(ev.id === 'dep' && hasTool(s, 'monitor') && er2 < 0.5)) { E.push({ t: 'event', id: ev.id, good: ev.good, m: ev.m }); ev.f(s, E); } break; } acc += p; }
  }
  // burnout
  let b = 0; if (hasTool(s, 'caffeine')) b++; if (hasTool(s, 'gpu')) b++; if (burnHas(s, 10)) b++; if (s.overtime) b++;
  if (b) gain(s, E, 'burn', b, 'night');
  if (s.burnout >= 10) { s.skipNext = 1; s.burnout = 5; s.stats.burnouts++; E.push({ t: 'burnout' }); }
  s.days.push({ rev: t.rev, aud: s.aud, cash: s.cash });
  s.stats.bestDay = Math.max(s.stats.bestDay, t.rev);
  // bill
  if (s.day % CYCLE === 0) {
    const cyc = cycleOf(s.day), amt = billAmt(s, cyc);
    if (s.cash >= amt) {
      s.cash -= amt; s.billsPaid++;
      E.push({ t: 'bill', paid: 1, amt: amt, cyc: cyc, left: s.cash });
      if (s.day === DAYS && !s.overtime) { s.phase = 'won'; E.push({ t: 'won' }); return; }
      if (s.day >= MAX_DAY) { s.phase = 'over'; s.result = 'ipo'; E.push({ t: 'over', result: 'ipo' }); return; }
      s.day++; openReward(s, E); return;
    }
    E.push({ t: 'bill', paid: 0, amt: amt, cyc: cyc, short: amt - s.cash });
    s.phase = 'over'; s.result = s.billsPaid >= 5 ? 'overtime' : 'unplugged'; E.push({ t: 'over', result: s.result });
    return;
  }
  s.day++;
  if (s.day % CYCLE === 3 && !burnHas(s, 8)) { openDraft(s, E); return; }
  startDay(s, E);
}
function pickWeighted(r, list, w) { let tot = 0; list.forEach(x => tot += w(x)); let v = r() * tot; for (const x of list) { v -= w(x); if (v < 0) return x; } return list[list.length - 1]; }
const RW = [6, 3, 1.4];
function cardPool(s) { return Object.keys(CARDS).filter(id => CARDS[id].rar < 9 && CARDS[id].lvl <= s.lvl); }
function toolPool(s) { return Object.keys(TOOLS).filter(id => !hasTool(s, id) && TOOLS[id].lvl <= s.lvl); }
function rollOffers(s, kind) {
  const r = stream(s.seed, 'offer', s.day, kind, s.rerollN);
  const out = [], used = {};
  const nCards = kind === 'reward' && s.tools.length < MAX_TOOLS ? 2 : 3;
  const cp = cardPool(s);
  for (let i = 0; i < nCards; i++) { const avail = cp.filter(id => !used[id]); const id = pickWeighted(r, avail, x => RW[CARDS[x].rar] * (CARDS[x].tag === 'shady' ? 0.8 : 1)); used[id] = 1; out.push({ k: 'card', id: id }); }
  if (nCards === 2) { const tp = toolPool(s); if (tp.length) { const id = pickWeighted(r, tp, x => RW[TOOLS[x].rar]); out.push({ k: 'tool', id: id }); } }
  out.forEach(o => { if (o.k === 'card') s.seen[o.id] = 1; else s.seen['t:' + o.id] = 1; });
  return out;
}
function openReward(s, E) { s.phase = 'reward'; s.rerolls = burnHas(s, 3) ? 0 : 1; s.offers = rollOffers(s, 'reward'); E.push({ t: 'reward', offers: s.offers }); }
function openDraft(s, E) { s.phase = 'draft'; s.rerolls = 0; s.offers = rollOffers(s, 'draft'); E.push({ t: 'draft', offers: s.offers }); }
function allCards(s) { return s.deck.concat(s.discard, s.hand).slice().sort((a, b) => a.uid - b.uid); }
function closeOffer(s, E) { s.offers = null; s.phase = 'play'; startDay(s, E); }

// legal: list of actions available now (used by bots, fuzzers and soft-lock tests)
function legal(s) {
  const a = [];
  if (s.phase === 'play') { s.hand.forEach((c, i) => { if (canPlay(s, i)) a.push({ t: 'play', i: i }); }); a.push({ t: 'end' }); }
  else if (s.phase === 'reward' || s.phase === 'draft') {
    s.offers.forEach((o, i) => a.push({ t: 'pick', i: i }));
    a.push({ t: 'skip' });
    if (s.rerolls > 0) a.push({ t: 'reroll' });
    if (s.phase === 'reward') allCards(s).forEach((c, i) => { if (i < 120) a.push({ t: 'remove', i: i }); });
  }
  else if (s.phase === 'won') { a.push({ t: 'overtime' }); a.push({ t: 'retire' }); }
  return a;
}
function act(s, a) {
  const E = [];
  const ok = () => { s.actions.push(encodeAction(a)); };
  if (s.phase === 'play') {
    if (a.t === 'play') { if (!canPlay(s, a.i)) return [{ t: 'denied', i: a.i, why: whyNot(s, a.i) }]; ok(); playCard(s, a.i, E); return E; }
    if (a.t === 'end') { ok(); endDay(s, E); return E; }
  } else if (s.phase === 'reward' || s.phase === 'draft') {
    if (a.t === 'pick' && s.offers[a.i]) { ok(); const o = s.offers[a.i]; if (o.k === 'card') { const c = { uid: s.uid++, id: o.id }; s.discard.push(c); E.push({ t: 'gotcard', id: o.id }); } else { s.tools.push(o.id); E.push({ t: 'gottool', id: o.id }); } closeOffer(s, E); return E; }
    if (a.t === 'skip') { ok(); E.push({ t: 'skipped' }); closeOffer(s, E); return E; }
    if (a.t === 'reroll' && s.rerolls > 0) { ok(); s.rerolls--; s.rerollN++; s.offers = rollOffers(s, s.phase); E.push({ t: s.phase, offers: s.offers, reroll: 1 }); return E; }
    if (a.t === 'remove' && s.phase === 'reward') { const all = allCards(s); const c = all[a.i]; if (!c) return [{ t: 'denied' }]; ok(); [s.deck, s.discard, s.hand].forEach(p => { const k = p.indexOf(c); if (k >= 0) p.splice(k, 1); }); E.push({ t: 'removed', id: c.id }); closeOffer(s, E); return E; }
  } else if (s.phase === 'won') {
    if (a.t === 'overtime') { ok(); s.overtime = true; s.day++; E.push({ t: 'overtime' }); openReward(s, E); return E; }
    if (a.t === 'retire') { ok(); s.phase = 'over'; s.result = 'won'; E.push({ t: 'over', result: 'won' }); return E; }
  }
  return [{ t: 'denied' }];
}
function whyNot(s, i) { const c = s.hand[i]; if (!c) return 'none'; const d = CARDS[c.id]; if (costOf(s, c, i) > s.cpu) return 'cpu'; if (d.need && !d.need(s)) return 'cash'; return 'phase'; }

// ---------- action codes: replays + verifiable score codes ----------
const A_CODES = { end: 16, skip: 49, reroll: 48, overtime: 50, retire: 51 };
function encodeAction(a) { if (a.t === 'play') return a.i; if (a.t === 'pick') return 32 + a.i; if (a.t === 'remove') return 128 + a.i; return A_CODES[a.t]; }
function decodeAction(b) { if (b < 16) return { t: 'play', i: b }; if (b >= 128) return { t: 'remove', i: b - 128 }; if (b >= 32 && b < 48) return { t: 'pick', i: b - 32 }; for (const k in A_CODES) if (A_CODES[k] === b) return { t: k }; return null; }
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64(bytes) { let o = ''; for (let i = 0; i < bytes.length; i += 3) { const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0); o += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : '') + (i + 2 < bytes.length ? B64[n & 63] : ''); } return o; }
function unb64(str) { const out = []; let buf = 0, bits = 0; for (const ch of str) { const v = B64.indexOf(ch); if (v < 0) return null; buf = (buf << 6) | v; bits += 6; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } } return out; }
// RLE for long runs of "end" is unnecessary; actions are tiny. Format: BR2.<mode><founder><burn36><lvl36>.<seedHex>.<actions>.<score>
const MODES = { daily: 'd', run: 'r', tutorial: 't', rush: 'u' }, FK = { tiny: 't', hacker: 'h', influencer: 'i', honest: 'o', shady: 's' };
function code(s) { return 'BR2.' + MODES[s.mode] + FK[s.founder] + s.burn.toString(36) + s.lvl.toString(36) + '.' + s.seed.toString(16).toUpperCase() + '.' + b64(s.actions) + '.' + s.earned; }
function parseCode(str) {
  const m = /^BR2\.([drtu])([thios])([0-9a])([0-9a-z])\.([0-9A-F]{1,8})\.([A-Za-z0-9_-]*)\.(\d{1,7})$/.exec(String(str || '').trim());
  if (!m) return null;
  const inv = (o, v) => Object.keys(o).find(k => o[k] === v);
  const bytes = unb64(m[6]); if (!bytes) return null;
  return { mode: inv(MODES, m[1]), founder: inv(FK, m[2]), burn: parseInt(m[3], 36), lvl: Math.min(FULL, parseInt(m[4], 36)), seed: parseInt(m[5], 16) >>> 0, actions: bytes, score: +m[7] };
}
// replay(opts, bytes) -> final state (pool must match the original run; Daily and codes use the full pool)
function replay(o, bytes, onStep) {
  const s = newRun(o);
  for (let k = 0; k < bytes.length; k++) {
    const a = decodeAction(bytes[k]); if (!a) { s.invalid = 'bad action'; break; }
    const E = act(s, a); if (E.length === 1 && E[0].t === 'denied') { s.invalid = 'illegal action at ' + k; break; }
    if (onStep) onStep(s, a, E);
  }
  return s;
}
function verify(str) {
  const p = parseCode(str); if (!p) return { ok: false, why: 'Not a Burn Rate v2 code.' };
  const s = replay({ seed: p.seed, mode: p.mode, founder: p.founder, burn: p.burn, lvl: p.lvl }, p.actions);
  if (s.invalid) return { ok: false, why: 'The run does not replay (' + s.invalid + ').', p: p };
  if (s.earned !== p.score) return { ok: false, why: 'Score does not match the replay.', p: p, s: s };
  return { ok: true, p: p, s: s };
}

const RANKS = [[0, 'Intern'], [100, 'Garage Founder'], [600, 'Pre-seed'], [1500, 'Seed'], [3000, 'Series A'], [6000, 'Unicorn'], [15000, 'Decacorn']];
function rankOf(score) { let r = RANKS[0][1]; RANKS.forEach(x => { if (score >= x[0]) r = x[1]; }); return r; }
function dailySeed(ymd) { return hash('burnrate2-daily-' + ymd); }

const Core = {
  T, FULL, DAYS, CYCLE, MAX_DAY, MAX_TOOLS, BILLS, TAGS, CARDS, TOOLS, FOUNDERS, BURNS, EVENTS, STARTER, RANKS,
  hash, stream, newRun, act, legal, canPlay, costOf, whyNot, priceOf, forecast, conv, billAmt, cycleOf, allCards, checkoutBroken,
  encodeAction, decodeAction, b64, unb64, code, parseCode, replay, verify, rankOf, dailySeed,
  clone: s => JSON.parse(JSON.stringify(s)),
  describe(s, id) { const d = CARDS[id]; return d.dyn && s ? d.dyn(s) : d.fx; },
};
if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.BurnCore = Core;
})(typeof window !== 'undefined' ? window : globalThis);

/* ---- js/bots.js ---- */
/* Burn Rate v2 — bot policies. Used by the Node simulator, the in-game rival ("BurnBot"),
   and the simulated percentile on the end screen. Pure: only reads state, returns an action. */
(function (root) {
'use strict';
const Core = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.BurnCore;
const C = Core.CARDS;
const BUILD_P = { ship: 1, mvp: 1, bigship: 1, api: 1, clone: 1 };
// rough "how good is this card in my deck" for drafting (sensible)
const RATE = { bigship: 9, api: 9, hunt: 8, oss: 8, video: 7, collab: 7, testi: 7, refactor: 6, seo: 6, ship: 6, honest: 6, letter: 5, thread: 6, help: 5, docs: 5, support: 5, bundle: 5, focus: 4, plan: 4, coffee: 4, freetoy: 5, give: 4, ads: 4, polish: 4, raise: 4, nap: 3, grass: 3, reply: 4, weekend: 2, meme: 3, mvp: 4, hotfix: 3, refunds: 3, allnight: 3, post: 5,
  overpromise: -2, clone: -2, fakerev: -3, spam: -2, dark: -2, sponsor: -1 };
const TRATE = { analytics: 9, pricing: 9, referral: 8, monitor2: 8, autopost: 7, mailing: 6, ghost: 7, changelog: 6, cdn: 7, discord: 6, savings: 5, kanban: 6, stickers: 4, duck: 5, tipjar: 4, cat: 4, monitor: 5, policy: 2, gpu: 6, caffeine: 5 };
// greedy: big immediate numbers win, consequences ignored
const GREED = { spam: 50, overpromise: 45, sponsor: 40, hunt: 60, fakerev: 30, ads: 40, clone: 35, bundle: 30, video: 25, collab: 25, give: 22, oss: 30, bigship: 28, api: 28, ship: 20, mvp: 18, dark: 25 };

function rnd(s, tag) { return Core.stream(s.seed, 'bot', s.salt || 0, tag, s.actions.length)(); }
function cardValue(s, id) {
  const d = C[id], f = Core.forecast(s), billDay = s.day % 5 === 0, bill = Core.billAmt(s, Core.cycleOf(s.day));
  const nP = s.products.length;
  if (d.tag === 'curse') return id === 'checkout' ? 120 : 100;
  if (id === 'bundle') return billDay && s.cash < bill ? 95 : nP >= 2 ? 30 : 2;
  if (BUILD_P[id]) { if (id === 'clone') return -1; if (id === 'mvp' && s.burnout >= 6) return 5; return nP < 2 ? 70 : nP < 4 ? 45 : 18; }
  if (id === 'post') return s.today.shipped ? 72 : 30;
  if (d.tag === 'grow') { if (id === 'ads' || id === 'give') { const spare = s.cash - (billDay ? bill : 0); return spare >= 8 ? 32 : -1; } const est = { thread: 5 * Math.max(1, nP), meme: 5, video: 25, collab: Math.max(12, s.aud * .3), seo: 20, letter: s.trust / 4, hunt: 60 }[id] || 10; return 22 + Math.min(40, est * 0.8) + (s.today.played.filter(x => C[x].tag === 'grow').length === 2 ? 20 : 0); }
  if (d.tag === 'trust') { if (id === 'refunds' && s.cash < 6) return -1; if (id === 'testi') return 40; if (id === 'support') return nP ? 34 : 10; const base = s.trust < 35 ? 58 : s.trust < 60 ? 32 : s.trust < 85 ? 18 : 4; return base + (id === 'help' || id === 'honest' || id === 'oss' ? 8 : 0); }
  if (id === 'polish' || id === 'hotfix' || id === 'refactor') { if (!nP) return 6; if (id === 'hotfix' && s.burnout >= 6) return 2; return 24 + nP * 2; }
  if (id === 'raise') return nP >= 2 && s.trust >= 55 ? 26 : 3;
  if (id === 'nap') return 45;
  if (id === 'coffee') return s.burnout <= 5 ? 40 : -1;
  if (id === 'allnight') return s.burnout <= 3 ? 38 : -1;
  if (id === 'weekend') return s.burnout >= 7 && s.cpu <= 1 ? 60 : -1;
  if (id === 'grass') return s.burnout >= 5 ? 44 : 12;
  if (id === 'focus' || id === 'plan') return 28;
  if (d.tag === 'shady') return -1;
  return 10;
}
function bestPlay(s, val) {
  let best = null, bv = 0;
  s.hand.forEach((c, i) => { if (!Core.canPlay(s, i)) return; const v = val(s, c.id); if (v > bv) { bv = v; best = { t: 'play', i: i }; } });
  return best || { t: 'end' };
}
function offerChoice(s, rate, trate, removeCurses) {
  if (s.phase === 'won') return { t: 'overtime' };
  if (removeCurses && s.phase === 'reward') { const all = Core.allCards(s); const k = all.findIndex(c => C[c.id].tag === 'curse'); if (k >= 0) return { t: 'remove', i: k }; }
  let best = -1, bv = -99;
  s.offers.forEach((o, i) => { const v = o.k === 'tool' ? (trate[o.id] || 3) + 1 : (rate[o.id] != null ? rate[o.id] : 3); if (v > bv) { bv = v; best = i; } });
  if (s.phase === 'reward' && removeCurses && bv < 5) { const all = Core.allCards(s); const k = all.findIndex(c => c.id === 'nap' || c.id === 'meme' || c.id === 'hotfix'); if (k >= 0 && bv < 4) return { t: 'remove', i: k }; }
  if (bv < 4 && s.rerolls > 0) return { t: 'reroll' };
  if (bv <= 0) return { t: 'skip' };
  return { t: 'pick', i: best };
}
const BOTS = {
  random(s) { const L = Core.legal(s); if (s.phase === 'play') { const plays = L.filter(a => a.t === 'play'); if (!plays.length || rnd(s, 'e') < 0.03) return { t: 'end' }; return plays[Math.floor(rnd(s, 'p') * plays.length)]; } const L2 = L.filter(a => a.t !== 'remove' || rnd(s, 'r') < 0.05); return L2[Math.floor(rnd(s, 'o') * L2.length)]; },
  noshady(s) { const L = Core.legal(s); if (s.phase === 'play') { const plays = L.filter(a => a.t === 'play' && C[s.hand[a.i].id].tag !== 'shady'); if (!plays.length || rnd(s, 'e') < 0.03) return { t: 'end' }; return plays[Math.floor(rnd(s, 'p') * plays.length)]; } if (s.phase === 'won') return { t: 'overtime' }; const picks = L.filter(a => a.t === 'pick' && !(s.offers[a.i].k === 'card' && C[s.offers[a.i].id].tag === 'shady')).concat([{ t: 'skip' }]); return picks[Math.floor(rnd(s, 'o') * picks.length)]; },
  greedy(s) { if (s.phase === 'play') return bestPlay(s, (s, id) => C[id].tag === 'curse' ? 1 : (GREED[id] || 8) + C[id].cost); return offerChoice(s, Object.assign({}, RATE, { overpromise: 9, spam: 9, clone: 8, fakerev: 8, sponsor: 8, dark: 8 }), TRATE, false); },
  sensible(s) { if (s.phase === 'play') return bestPlay(s, cardValue); return offerChoice(s, RATE, TRATE, true); },
  // a new player: follows the tutorial prompts on days 1-2, then plays sensibly ~65% of the time
  novice(s) { if (s.phase === 'play' && s.day > 2 && rnd(s, 'n') < 0.35) return BOTS.noshady(s); if (s.phase !== 'play' && rnd(s, 'n2') < 0.4) return BOTS.noshady(s); return BOTS.sensible(s); },
  // a slightly "human" sensible player: sometimes misses the best card, never rerolls
  casual(s) { if (s.phase === 'play') return bestPlay(s, (s, id) => cardValue(s, id) * (0.6 + 0.8 * rnd(s, 'c' + id))); const a = offerChoice(s, RATE, TRATE, true); return a.t === 'reroll' ? { t: 'skip' } : a; },
};
// run a full game with a policy; returns final state
function runBot(name, opts, maxSteps, salt) {
  const s = Core.newRun(opts), pol = BOTS[name]; let n = 0; maxSteps = maxSteps || 5000; s.salt = salt || 0;
  while (s.phase !== 'over' && n++ < maxSteps) {
    const a = pol(s); const E = Core.act(s, a);
    if (E.length === 1 && E[0].t === 'denied') { s.stuck = 'denied ' + JSON.stringify(a); break; }
  }
  if (s.phase !== 'over') s.stuck = s.stuck || 'maxSteps';
  return s;
}
// simulated field for a seed: a mix of player types, used for "better than X% of simulated players"
const FIELD = ['noshady', 'novice', 'novice', 'casual', 'greedy', 'sensible'];
function field(opts, n, from) { const out = []; from = from || 0; for (let k = from; k < from + n; k++) { const s = runBot(FIELD[k % FIELD.length], opts, 3000, k + 1); out.push(s.earned); } return out; }
const Bots = { BOTS, runBot, field, FIELD, cardValue, RATE, TRATE };
if (typeof module !== 'undefined' && module.exports) module.exports = Bots; else root.BurnBots = Bots;
})(typeof window !== 'undefined' ? window : globalThis);

/* ---- js/art.js ---- */
/* Burn Rate v2 — vector art: icons, card art, the bot mascot. Everything is inline SVG (no image files). */
(function () {
'use strict';
const P = {
  aud: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c3 .2 5.5 2.4 5.5 5.8"/>',
  trust: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  cash: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.6-1-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.5 5.8 4.3 0 1.3-1.3 2.1-3 2.1-1.3 0-2.4-.5-3-1.5M12 6.2v1.6M12 16.4v1.5"/>',
  q: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8z"/>',
  burn: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.3-5 3.4-7.8.6 1.7 1.6 2.6 2.6 3 .2-2.8 1.3-5.5 3.6-7 0 3.2 3.4 5.5 3.4 10.1 0 4.4-2.7 7.9-6.5 7.9z"/>',
  cpu: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
  prod: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  card: '<rect x="4.5" y="5" width="11.5" height="16" rx="2"/><path d="M8 2.5h9.5a2 2 0 0 1 2 2V18"/>',
  build: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.8 17a1.6 1.6 0 0 0 2.3 2.3l5.6-5.5a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.2-.4-.4-2.2z"/>',
  grow: '<path d="M3.5 10v4h3l8 4.5V5.5l-8 4.5z"/><path d="M18 9a4 4 0 0 1 0 6M6.5 14l1.2 5h2.3l-1-4.6"/>',
  trustTag: '<path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.4-4.4"/>',
  rest: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  shady: '<path d="M2.5 9.5h19M4 9.5l1 4.2a2.5 2.5 0 0 0 2.4 1.8h1.2a2.5 2.5 0 0 0 2.4-2l.5-2.5M20 9.5l-1 4.2a2.5 2.5 0 0 1-2.4 1.8h-1.2a2.5 2.5 0 0 1-2.4-2L12.5 11"/>',
  curse: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4.5l12 7.5-12 7.5z"/>',
  sound: '<path d="M4 9.5v5h3.5L13 19V5L7.5 9.5z"/><path d="M16.5 9a4.5 4.5 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L13 19V5L7.5 9.5z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v3.5M8 20.5h8M9.5 17.5h5v3h-5z"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M5.5 18.5l1.9-1.9M16.6 7.4l1.9-1.9"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="M8.3 10.8l7-3.6M8.3 13.2l7 3.6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5a1.5 1.5 0 0 0-1.5-1.5h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  ghost: '<path d="M5 20V11a7 7 0 0 1 14 0v9l-2.3-1.6L14.3 20 12 18.4 9.7 20l-2.4-1.6z"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/>',
  tool: '<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  reroll: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
  rocket: '<path d="M12 2.5c3.5 2.5 5 6.5 4.5 11.5h-9C7 9 8.5 5 12 2.5z"/><circle cx="12" cy="9" r="1.6"/><path d="M7.5 14L5 17.5l3 .5M16.5 14l2.5 3.5-3 .5M10 18l2 3.5 2-3.5"/>',
  plug: '<path d="M9 2.5v5M15 2.5v5M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v2.5a3 3 0 0 1-3 3H7"/>',
  star2: '<path d="M12 2.5l1.8 6.2 6.7.3-5.3 4 1.9 6.5L12 15.7l-5.1 3.8 1.9-6.5-5.3-4 6.7-.3z"/>',
  chat: '<path d="M4 5.5h16v10H10l-4.5 4v-4H4z"/>',
  coffee: '<path d="M4.5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM15.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.8M8 3.5c-.8 1 .8 2 0 3M11.5 3.5c-.8 1 .8 2 0 3"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  tag: '<path d="M3.5 12.5V4h8.5l9 9-8.5 8.5z"/><circle cx="8" cy="8.5" r="1.4"/>',
  gift: '<rect x="3.5" y="9" width="17" height="11.5" rx="1.5"/><path d="M2.5 9h19M12 9v11.5M12 9C9 9 7 7.5 7.5 5.5S11 4.5 12 9zM12 9c3 0 5-1.5 4.5-3.5S13 4.5 12 9"/>',
  leaf: '<path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15M5 19l7-7"/>',
  mask: '<path d="M3 8c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0 0 5-2 9-5 9-2 0-3-2-4-3.5-1 1.5-2 3.5-4 3.5-3 0-5-4-5-9z"/><circle cx="8" cy="11" r="1.2"/><circle cx="16" cy="11" r="1.2"/>',
  bug: '<rect x="7" y="7.5" width="10" height="12.5" rx="5"/><path d="M12 7.5V20M9 4.5l1.5 2.5M15 4.5L13.5 7M3.5 11h3.5M17 11h3.5M3.5 16H7M17 16h3.5"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>',
  crown: '<path d="M3.5 18h17l1-10-5 4-4.5-7-4.5 7-5-4z"/>',
  flame2: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.3-5 3.4-7.8.6 1.7 1.6 2.6 2.6 3 .2-2.8 1.3-5.5 3.6-7 0 3.2 3.4 5.5 3.4 10.1 0 4.4-2.7 7.9-6.5 7.9z"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
};
P.trust_t = P.trustTag;
function icon(name, cls) { const p = P[name] || P.card; return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + p + '</svg>'; }
// card art: a main glyph per card (tag glyph by default)
const CARD_ICON = {
  ship: 'prod', polish: 'q', mvp: 'prod', hotfix: 'build', bigship: 'rocket', refactor: 'build', raise: 'tag', bundle: 'gift', api: 'plug', freetoy: 'gift',
  post: 'grow', thread: 'chat', meme: 'mask', video: 'video', collab: 'aud', seo: 'chart', letter: 'mail', ads: 'cash', hunt: 'rocket', give: 'gift',
  reply: 'chat', help: 'trust', docs: 'book', honest: 'tag', refunds: 'cash', oss: 'star2', testi: 'q', support: 'chat',
  nap: 'rest', coffee: 'coffee', allnight: 'burn', weekend: 'leaf', focus: 'card', plan: 'cal', grass: 'leaf',
  overpromise: 'shady', clone: 'copy', fakerev: 'q', spam: 'mail', dark: 'mask', sponsor: 'dice',
  refundreq: 'cash', exposed: 'curse', bug: 'bug', checkout: 'curse',
};
const TOOL_ICON = { changelog: 'book', tipjar: 'cash', caffeine: 'coffee', monitor: 'check', mailing: 'mail', analytics: 'chart', cdn: 'rocket', monitor2: 'card', referral: 'share', discord: 'chat', autopost: 'clock', pricing: 'tag', gpu: 'cpu', cat: 'star2', stickers: 'mask', savings: 'cash', duck: 'bug', policy: 'book', kanban: 'cal', ghost: 'grow' };
const TAG_ICON = { build: 'build', grow: 'grow', trust: 'trustTag', rest: 'rest', shady: 'shady', curse: 'curse' };
// fx text with {aud} tokens -> HTML with inline icons
function fx(text) { return String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\{(\w+)\}/g, (m, k) => icon(k, 'i-' + k)); }
// ---- the bot mascot ----
const SKINS = {
  classic: { body: '#e9e6dc', trim: '#9b98a8', screen: '#11131a', glow: '#c6ff3d' },
  neon:    { body: '#ff4f9a', trim: '#a8306a', screen: '#14081a', glow: '#3de0ff' },
  gold:    { body: '#ffcf4a', trim: '#b8861b', screen: '#1a1408', glow: '#fff3b0' },
  retro:   { body: '#d8ccb0', trim: '#8f8366', screen: '#0d1a10', glow: '#7dff8a' },
  pumpkin: { body: '#ff8a1e', trim: '#b4530a', screen: '#1a0e05', glow: '#ffd23d', pumpkin: 1 },
  ghost:   { body: '#f4f4ff', trim: '#b9b9d6', screen: '#16162a', glow: '#b9a6ff', ghost: 1 },
};
function face(mood, g) {
  const st = 'stroke="' + g + '" stroke-width="4" stroke-linecap="round" fill="none"';
  const dot = (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + (r || 4.5) + '" fill="' + g + '"/>';
  let eyes, mouth = '';
  switch (mood) {
    case 'happy': eyes = '<path d="M38 52q6-8 12 0M70 52q6-8 12 0" ' + st + '/>'; mouth = '<path d="M46 64q14 12 28 0" ' + st + '/>'; break;
    case 'wow': eyes = dot(44, 50, 6.5) + dot(76, 50, 6.5); mouth = '<ellipse cx="60" cy="67" rx="6" ry="7" fill="none" stroke="' + g + '" stroke-width="4"/>'; break;
    case 'worried': eyes = dot(44, 52) + dot(76, 52) + '<path d="M36 42l12 4M84 42l-12 4" ' + st + '/>'; mouth = '<path d="M46 68q4-4 7 0t7 0 7 0 7 0" ' + st + '/>'; break;
    case 'sad': eyes = '<path d="M38 46l10 10M48 46L38 56M72 46l10 10M82 46L72 56" ' + st + '/>'; mouth = '<path d="M46 70q14-10 28 0" ' + st + '/>'; break;
    case 'sleepy': eyes = '<path d="M38 52h12M70 52h12" ' + st + '/>'; mouth = '<path d="M54 66h12" ' + st + '/>'; break;
    case 'money': eyes = '<text x="44" y="58" font-size="20" font-weight="900" text-anchor="middle" fill="' + g + '" font-family="system-ui,sans-serif">$</text><text x="76" y="58" font-size="20" font-weight="900" text-anchor="middle" fill="' + g + '" font-family="system-ui,sans-serif">$</text>'; mouth = '<path d="M44 64q16 14 32 0" ' + st + '/>'; break;
    default: eyes = '<g class="blink">' + dot(44, 51) + dot(76, 51) + '</g>'; mouth = '<path d="M50 65q10 7 20 0" ' + st + '/>';
  }
  return eyes + mouth;
}
function bot(mood, skin) {
  const k = SKINS[skin] || SKINS.classic;
  const head = k.ghost
    ? '<path d="M16 30a44 40 0 0 1 88 0v58l-11-8-11 8-11-8-11 8-11-8-11 8-11-8z" fill="' + k.body + '" stroke="' + k.trim + '" stroke-width="3" opacity=".95"/>'
    : k.pumpkin
      ? '<path d="M60 18c-4-8 0-12 6-14" stroke="#3a7d2a" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="60" cy="58" rx="50" ry="40" fill="' + k.body + '" stroke="' + k.trim + '" stroke-width="3"/><path d="M42 22q-10 36 0 72M78 22q10 36 0 72M60 18v80" stroke="' + k.trim + '" stroke-width="2.5" fill="none" opacity=".55"/>'
      : '<path d="M60 18V6" stroke="' + k.trim + '" stroke-width="4" stroke-linecap="round"/><circle class="bulb" cx="60" cy="6" r="5.5" fill="' + k.glow + '"/><rect x="12" y="18" width="96" height="76" rx="22" fill="' + k.body + '" stroke="' + k.trim + '" stroke-width="3"/><rect x="4" y="44" width="10" height="24" rx="4" fill="' + k.trim + '"/><rect x="106" y="44" width="10" height="24" rx="4" fill="' + k.trim + '"/>';
  const screen = '<rect x="24" y="30" width="72" height="52" rx="14" fill="' + k.screen + '"/>';
  const blush = mood === 'happy' || mood === 'money' ? '<circle cx="32" cy="68" r="4" fill="#ff4f9a" opacity=".55"/><circle cx="88" cy="68" r="4" fill="#ff4f9a" opacity=".55"/>' : '';
  const z = mood === 'sleepy' ? '<text x="98" y="22" font-size="16" font-weight="800" fill="' + k.glow + '" font-family="system-ui,sans-serif">z</text><text x="108" y="12" font-size="11" font-weight="800" fill="' + k.glow + '" font-family="system-ui,sans-serif">z</text>' : '';
  const sweat = mood === 'worried' ? '<path d="M100 30q5 8 0 12q-5-4 0-12z" fill="#3de0ff"/>' : '';
  return '<svg class="bot-svg mood-' + (mood || 'idle') + '" viewBox="-4 -4 128 108" aria-hidden="true">' + head + screen + '<g class="face">' + face(mood, k.glow) + '</g>' + blush + z + sweat + '</svg>';
}
window.BurnArt = { icon, fx, bot, SKINS, CARD_ICON, TOOL_ICON, TAG_ICON };
})();

/* ---- js/sfx.js ---- */
/* Burn Rate v2 — sound. All audio is synthesized at runtime; no audio files.
 * The sample generator below is a port of ZzFX by Frank Force (https://github.com/KilledByAPixel/ZzFX).
 * ZzFX — MIT License — Copyright (c) 2019 Frank Force.
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above
 * copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
 */
(function () {
'use strict';
const SR = 44100;
function zzfxG(volume = 1, randomness = .05, frequency = 220, attack = 0, sustain = 0, release = .1, shape = 0, shapeCurve = 1, slide = 0, deltaSlide = 0, pitchJump = 0, pitchJumpTime = 0, repeatTime = 0, noise = 0, modulation = 0, bitCrush = 0, delay = 0, sustainVolume = 1, decay = 0, tremolo = 0) {
  const PI2 = Math.PI * 2, abs = Math.abs, sign = v => v > 0 ? 1 : -1;
  let startSlide = slide *= 500 * PI2 / SR / SR;
  let startFrequency = frequency *= (1 + randomness * 2 * Math.random() - randomness) * PI2 / SR;
  const b = []; let t = 0, tm = 0, i = 0, j = 1, r = 0, c = 0, s = 0, f, length;
  attack = attack * SR + 9; decay *= SR; sustain *= SR; release *= SR; delay *= SR;
  deltaSlide *= 500 * PI2 / SR ** 3; modulation *= PI2 / SR; pitchJump *= PI2 / SR; pitchJumpTime *= SR; repeatTime = repeatTime * SR | 0;
  for (length = attack + decay + sustain + release + delay | 0; i < length; b[i++] = s) {
    if (!(++c % (bitCrush * 100 | 0))) {
      s = shape ? shape > 1 ? shape > 2 ? shape > 3 ? Math.sin((t % PI2) ** 3) : Math.max(Math.min(Math.tan(t), 1), -1) : 1 - (2 * t / PI2 % 2 + 2) % 2 : 1 - 4 * abs(Math.round(t / PI2) - t / PI2) : Math.sin(t);
      s = (repeatTime ? 1 - tremolo + tremolo * Math.sin(PI2 * i / repeatTime) : 1) * sign(s) * abs(s) ** shapeCurve * volume * (
        i < attack ? i / attack : i < attack + decay ? 1 - ((i - attack) / decay) * (1 - sustainVolume) : i < attack + decay + sustain ? sustainVolume : i < length - delay ? (length - i - delay) / release * sustainVolume : 0);
      s = delay ? s / 2 + (delay > i ? 0 : (i < length - delay ? 1 : (length - i) / delay) * b[i - delay | 0] / 2) : s;
    }
    f = (frequency += slide += deltaSlide) * Math.cos(modulation * tm++);
    t += f - f * noise * (1 - (Math.sin(i) + 1) * 1e9 % 2);
    if (j && ++j > pitchJumpTime) { frequency += pitchJump; startFrequency += pitchJump; j = 0; }
    if (repeatTime && !(++r % repeatTime)) { frequency = startFrequency; slide = startSlide; j = j || 1; }
  }
  return b;
}
// ---- sound presets (ZzFX parameter lists) ----
const FX = {
  tap:     [.35, .05, 660, 0, .01, .04, 1, 1.6],
  play:    [.5, .03, 420, 0, .02, .09, 1, 1.4, 6, 0, 120, .03],
  draw:    [.18, .1, 900, 0, 0, .05, 4, 0, -6, 0, 0, 0, 0, .9],
  deny:    [.4, 0, 140, 0, .04, .1, 3, 1, 0, 0, -30, .03],
  coin:    [.45, 0, 1500, 0, .02, .16, 0, 1.8, 0, 0, 500, .04],
  bigcoin: [.55, 0, 1100, .01, .06, .3, 0, 1.6, 0, 0, 700, .05, .08],
  combo:   [.6, 0, 520, .01, .14, .3, 1, 1.2, 0, 0, 260, .05, .07],
  stat:    [.25, .05, 880, 0, .01, .06, 0, 1.5, 9],
  bad:     [.45, .05, 220, .01, .1, .25, 2, 1.2, -4, 0, 0, 0, 0, .1],
  event:   [.45, 0, 740, .02, .08, .25, 1, 1, 0, 0, 180, .08],
  paid:    [.7, 0, 392, .02, .25, .5, 1, 1.3, 0, 0, 196, .1, .12, 0, 0, 0, .06],
  unplug:  [.8, 0, 330, .02, .35, .7, 2, 1.1, -3, 0, 0, 0, 0, .15, 0, .1],
  win:     [.75, 0, 523, .02, .4, .8, 1, 1.2, 0, 0, 262, .08, .1, 0, 0, 0, .1],
  level:   [.6, 0, 700, .02, .2, .5, 0, 1.4, 0, 0, 350, .06, .06],
  tick:    [.25, 0, 1800, 0, 0, .02, 1],
  night:   [.3, 0, 200, .1, .2, .4, 0, 1, 1.5, 0, 0, 0, 0, 0, 3],
  whoosh:  [.25, 0, 300, .02, .06, .15, 4, 0, 4, 0, 0, 0, 0, 1],
};
let ctx = null, master = null, sfxBus = null, musBus = null, muted = false, sfxVol = .8, musVol = .35, unlocked = false;
const cache = {};
function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  try { ctx = new AC(); } catch (_) { return null; }
  master = ctx.createGain(); master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(master); musBus = ctx.createGain(); musBus.connect(master);
  applyVol(); return ctx;
}
function applyVol() { if (!ctx) return; master.gain.value = muted ? 0 : 1; sfxBus.gain.value = sfxVol; musBus.gain.value = musVol * .5; }
function buf(key, params) {
  if (cache[key]) return cache[key];
  const data = zzfxG(...params); const b = ctx.createBuffer(1, data.length || 1, SR); b.getChannelData(0).set(data); return (cache[key] = b);
}
let lastAt = {};
function play(name, opt) {
  if (!ctx || muted || sfxVol <= 0 || ctx.state !== 'running') return;
  const now = performance.now(); if (lastAt[name] && now - lastAt[name] < 35) return; lastAt[name] = now;
  const p = FX[name]; if (!p) return;
  const rate = opt && opt.pitch || 1;
  try { const src = ctx.createBufferSource(); src.buffer = buf(name, p); src.playbackRate.value = rate; const g = ctx.createGain(); g.gain.value = opt && opt.vol != null ? opt.vol : 1; src.connect(g); g.connect(sfxBus); src.start(); } catch (_) {}
}
// ---- music: a tiny lo-fi loop (Am F C G), scheduled ahead on the audio clock ----
const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const BASS = [45, 41, 48, 43];
let musOn = false, nextT = 0, step = 0, timer = 0, intensity = 0;
function inst(kind, midi) {
  const k = kind + midi; if (cache[k]) return cache[k];
  const f = NOTE(midi);
  const p = kind === 'bass' ? [.5, 0, f, .01, .12, .18, 1, 1] : kind === 'lead' ? [.22, 0, f, .01, .05, .22, 1, 1.8, 0, 0, 0, 0, 0, 0, 0, 0, .12] : kind === 'pad' ? [.1, 0, f, .2, .6, .8, 0, 1] : kind === 'hat' ? [.08, 0, 4000, 0, 0, .025, 4, 0, 0, 0, 0, 0, 0, 1] : [.5, 0, 120, 0, .03, .12, 0, 1, -8];
  return buf(k, p);
}
function sched(b, t, vol) { const s = ctx.createBufferSource(); s.buffer = b; const g = ctx.createGain(); g.gain.value = vol; s.connect(g); g.connect(musBus); s.start(t); }
const SPB = 60 / 92 / 2; // eighth notes at 92 bpm
function pump() {
  if (!ctx || !musOn || ctx.state !== 'running') return;
  if (nextT < ctx.currentTime) nextT = ctx.currentTime + .05;
  while (nextT < ctx.currentTime + .4) {
    const bar = (step >> 3) % 4, e = step % 8, ch = PROG[bar];
    if (e === 0 || e === 3 || e === 6) sched(inst('bass', BASS[bar]), nextT, .9);
    if (e % 2 === 0) sched(inst('hat', 0), nextT, intensity > 0 ? .9 : .5);
    if (intensity > 0 && (e === 0 || e === 4)) sched(inst('kick', 0), nextT, .8);
    if (e === 0) ch.forEach(n => sched(inst('pad', n), nextT, .6));
    const arp = [0, 1, 2, 1, 2, 0, 1, 2][e]; if ((step >> 5) % 2 === 1 || intensity > 0) { if (e !== 7) sched(inst('lead', ch[arp] + 12), nextT, .7); }
    nextT += SPB; step++;
  }
}
function startMusic() { musOn = true; if (!ensure()) return; if (nextT < ctx.currentTime) nextT = ctx.currentTime + .05; if (!timer) timer = setInterval(pump, 120); pump(); }
function stopMusic() { musOn = false; if (timer) { clearInterval(timer); timer = 0; } }
function unlock() {
  if (!ensure()) return;
  if (ctx.state === 'suspended' && !suspendedBy) { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
  if (!unlocked) { unlocked = true; try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, SR); s.connect(ctx.destination); s.start(); } catch (_) {} }
}
let suspendedBy = false;
function suspend(on) { suspendedBy = on; if (!ctx) return; try { const p = on ? ctx.suspend() : ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (_) {} if (!on) nextT = 0; }
window.BurnSfx = {
  play, unlock, startMusic, stopMusic, suspend,
  setMuted(m) { muted = !!m; applyVol(); }, isMuted: () => muted,
  setVolumes(s, m) { sfxVol = s; musVol = m; applyVol(); },
  setIntensity(n) { intensity = n; },
  ready: () => !!ctx && ctx.state === 'running',
};
})();

/* ---- js/fx.js ---- */
/* Burn Rate v2 — juice: particles, floating numbers, screen shake, count-ups. All optional; reduced motion turns most of it off. */
(function () {
'use strict';
let stage = null, cv = null, g = null, scale = 1, parts = [], raf = 0, motion = true, shakeOn = true, speed = 1;
function init(st, canvas) { stage = st; cv = canvas; g = cv.getContext('2d'); }
function setScale(k, w, h) { scale = k; if (!cv) return; const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(w * k * dpr); cv.height = Math.round(h * k * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; g.setTransform(k * dpr, 0, 0, k * dpr, 0, 0); }
function setPrefs(p) { motion = p.motion; shakeOn = p.shake; speed = p.speed || 1; }
// element center in stage coordinates
function at(el) {
  if (!el || !stage) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
  return { x: (r.left + r.width / 2 - s.left) / scale, y: (r.top + r.height / 2 - s.top) / scale };
}
function loop() {
  raf = 0; if (!g) return;
  g.clearRect(0, 0, cv.width, cv.height);
  const now = performance.now();
  parts = parts.filter(p => {
    const t = (now - p.t0) / p.life; if (t >= 1) { if (p.done) p.done(); return false; }
    if (p.k === 'coin') {
      const e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = p.x + (p.tx - p.x) * e + Math.sin(t * Math.PI) * p.cx, y = p.y + (p.ty - p.y) * e - Math.sin(t * Math.PI) * p.cy;
      g.fillStyle = '#ffcf4a'; g.beginPath(); g.arc(x, y, p.r, 0, 7); g.fill(); g.fillStyle = '#b8861b'; g.fillRect(x - 1, y - p.r * .55, 2, p.r * 1.1);
    } else {
      p.vy += p.gr; p.x += p.vx; p.y += p.vy; p.vx *= .985; const a = 1 - t;
      g.globalAlpha = a; g.fillStyle = p.c;
      if (p.k === 'conf') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot += p.vr); g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g.restore(); }
      else { g.beginPath(); g.arc(p.x, p.y, p.r * (0.4 + a * 0.6), 0, 7); g.fill(); }
      g.globalAlpha = 1;
    }
    return true;
  });
  if (parts.length) raf = requestAnimationFrame(loop);
}
function kick() { if (!raf) raf = requestAnimationFrame(loop); }
function burst(el, color, n, kind) {
  if (!motion) return; const c = at(el); const now = performance.now();
  for (let i = 0; i < (n || 14); i++) { const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 3.5; parts.push({ k: kind || 'spark', x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5, gr: kind === 'conf' ? .08 : .12, r: kind === 'conf' ? 4 + Math.random() * 3 : 2 + Math.random() * 3, c: Array.isArray(color) ? color[i % color.length] : color, t0: now, life: (kind === 'conf' ? 1400 : 650) + Math.random() * 300, rot: Math.random() * 6, vr: (Math.random() - .5) * .3 }); }
  if (parts.length > 400) parts.splice(0, parts.length - 400);
  kick();
}
function confetti(n) {
  if (!motion || !stage) return; const now = performance.now(); const W = stage.offsetWidth;
  const cols = ['#c6ff3d', '#ff4f9a', '#3de0ff', '#ffcf4a', '#9b7bff'];
  for (let i = 0; i < (n || 90); i++) parts.push({ k: 'conf', x: Math.random() * W, y: -10 - Math.random() * 80, vx: (Math.random() - .5) * 2, vy: 1 + Math.random() * 3, gr: .05, r: 3 + Math.random() * 4, c: cols[i % 5], t0: now, life: 1800 + Math.random() * 1200, rot: Math.random() * 6, vr: (Math.random() - .5) * .3 });
  kick();
}
// coins fly from one element to another; done() fires once when the first coin lands
function coins(from, to, n, done) {
  if (!motion) { if (done) done(); return; }
  const a = at(from), b = at(to), now = performance.now(); let fired = false;
  n = Math.min(12, n || 3);
  for (let i = 0; i < n; i++) parts.push({ k: 'coin', x: a.x + (Math.random() - .5) * 30, y: a.y + (Math.random() - .5) * 20, tx: b.x, ty: b.y, cx: (Math.random() - .5) * 60, cy: 40 + Math.random() * 60, r: 6, t0: now + i * 40, life: (520 + i * 30) / speed, done: () => { if (!fired) { fired = true; done && done(); } } });
  kick();
}
// floating "+12" text above an element
const flo = new WeakMap();
function float(el, text, cls) {
  if (!stage) return; const c = at(el);
  const d = document.createElement('div'); d.className = 'floater ' + (cls || ''); d.innerHTML = text;
  // stack floaters on the same target instead of drawing them on top of each other; keep at most 8 alive
  const now = Date.now(), key = el && typeof el === "object" ? el : null, rec = (key && flo.get(key)) || { t: 0, n: 0 }; rec.n = now - rec.t < 700 ? rec.n + 1 : 0; rec.t = now; if (key) flo.set(key, rec);
  const all = stage.querySelectorAll('.floater'); if (all.length >= 8) all[0].remove();
  d.style.left = c.x + 'px'; d.style.top = (c.y + (rec.n % 4) * 26) + 'px'; stage.appendChild(d);
  setTimeout(() => d.remove(), motion ? 1100 : 900);
}
function shake(big) {
  if (!motion || !shakeOn || !stage) return; const el = stage.querySelector('.shakeable') || stage;
  el.classList.remove('shake', 'shake-big'); void el.offsetWidth; el.classList.add(big ? 'shake-big' : 'shake');
  setTimeout(() => el.classList.remove('shake', 'shake-big'), 450);
}
function pulse(el, cls) { if (!el) return; cls = cls || 'pulse'; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 600); }
// number count-up on an element; returns a promise-like via callback
function count(el, from, to, ms, fmt, done) {
  fmt = fmt || (v => String(v));
  if (!motion || ms <= 0 || from === to) { el.textContent = fmt(to); done && done(); return; }
  const t0 = performance.now();
  (function tick() { const t = Math.min(1, (performance.now() - t0) / ms), e = 1 - Math.pow(1 - t, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (t < 1) requestAnimationFrame(tick); else done && done(); })();
}
function clear() { parts = []; if (g) g.clearRect(0, 0, cv.width, cv.height); }
window.BurnFx = { init, setScale, setPrefs, at, burst, confetti, coins, float, shake, pulse, count, clear };
})();

/* ---- js/meta.js ---- */
/* Burn Rate v2 — meta progression: profile, XP + levels, unlocks, achievements, cosmetics, streaks, local leaderboard. */
(function () {
'use strict';
const Store = window.BurnPlatform.Store, Core = window.BurnCore;
const KEY = 'burnrate2';
const pad = n => (n < 10 ? '0' : '') + n;
function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function addDays(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
const EPOCH = '2026-10-29';
function deckNo(day) { return Math.round((new Date((day || ymd()) + 'T12:00:00') - new Date(EPOCH + 'T12:00:00')) / 864e5) + 1; }
const DEFAULT = () => ({ v: 2, xp: 0, runs: 0, wins: 0, best: 0, ach: {}, seen: {}, daily: {}, board: { daily: {}, run: [], rush: [] }, cos: { desk: 'garage', skin: 'classic' }, cosOwn: {}, burnMax: 0, ghostWins: 0, tutorialDone: false, legacy: null, set: { music: .35, sfx: .8, speed: 1, motion: 'auto', shake: true, muted: false, hints: true }, last: null });
let P = null;
function load() {
  const raw = Store.get(KEY);
  P = Object.assign(DEFAULT(), raw && typeof raw === 'object' ? raw : {});
  P.set = Object.assign(DEFAULT().set, P.set || {}); P.board = Object.assign(DEFAULT().board, P.board || {});
  if (!raw) migrate();
  return P;
}
function save() { Store.set(KEY, P); }
// v1 left burn-YYYY-MM-DD (daily results) and burn-best in storage: carry them over once.
function migrate() {
  let played = 0, wins = 0, best = 0;
  Store.keys().forEach(k => {
    const m = /^burn-(\d{4}-\d{2}-\d{2})$/.exec(k); if (!m) return; const v = Store.get(k); if (!v || typeof v !== 'object') return;
    played++; if (v.won) wins++; best = Math.max(best, +v.cash || 0);
    if (!P.daily[m[1]]) P.daily[m[1]] = { v1: 1, won: !!v.won, score: +v.cash || 0 };
  });
  const b = Store.get('burn-best'); if (typeof b === 'number') best = Math.max(best, b); else if (b && typeof b === 'object') best = Math.max(best, +b.cash || +b.score || 0);
  if (played || best) { P.legacy = { played, wins, best }; P.xp += Math.min(600, played * 40); }
  save();
}
// ---- levels ----
function need(L) { return 100 + 40 * L; }
function levelOf(xp) { let L = 1, x = xp; while (x >= need(L) && L < 99) { x -= need(L); L++; } return { lvl: L, into: x, need: need(L) }; }
function grantXp(n) { const b = levelOf(P.xp).lvl; P.xp += Math.max(0, n | 0); save(); const a = levelOf(P.xp).lvl; const ups = []; for (let L = b + 1; L <= a; L++) ups.push({ lvl: L, unlocks: unlocksAt(L) }); return ups; }
function level() { return levelOf(P.xp).lvl; }
function cardLvl() { return Math.min(Core.FULL, level()); }
const UNLOCKS = []; // [level, label]
Object.keys(Core.CARDS).forEach(id => { const c = Core.CARDS[id]; if (c.rar < 9 && c.lvl > 1) UNLOCKS.push([c.lvl, 'card', id, c.n]); });
Object.keys(Core.TOOLS).forEach(id => { const t = Core.TOOLS[id]; if (t.lvl > 1) UNLOCKS.push([t.lvl, 'tool', id, t.n]); });
Object.keys(Core.FOUNDERS).forEach(id => { const f = Core.FOUNDERS[id]; if (f.lvl > 1) UNLOCKS.push([f.lvl, 'founder', id, f.n]); });
const DESKS = { garage: { n: 'Garage', lvl: 1 }, cowork: { n: 'Coworking loft', lvl: 4 }, server: { n: 'Server room', lvl: 7 }, penthouse: { n: 'Penthouse', lvl: 10 }, spooky: { n: 'Haunted office', seasonal: 10, note: 'October' } };
const SKINS = { classic: { n: 'Classic', lvl: 1 }, retro: { n: 'Retro', lvl: 2 }, neon: { n: 'Neon', lvl: 6 }, gold: { n: 'Gold', ach: 'unicorn' }, pumpkin: { n: 'Pumpkin', seasonal: 10, note: 'October' }, ghost: { n: 'Ghost', ach: 'halloween' } };
Object.keys(DESKS).forEach(id => { if (DESKS[id].lvl > 1) UNLOCKS.push([DESKS[id].lvl, 'desk', id, DESKS[id].n + ' desk']); });
Object.keys(SKINS).forEach(id => { if (SKINS[id].lvl > 1) UNLOCKS.push([SKINS[id].lvl, 'skin', id, SKINS[id].n + ' bot']); });
UNLOCKS.sort((a, b) => a[0] - b[0]);
function unlocksAt(L) { return UNLOCKS.filter(u => u[0] === L); }
function nextUnlock() { const L = level(); return UNLOCKS.find(u => u[0] > L) || null; }
const isOctober = () => new Date().getMonth() === 9;
function owns(kind, id) {
  const T = kind === 'desk' ? DESKS : SKINS, o = T[id]; if (!o) return false;
  if (P.cosOwn[kind + ':' + id]) return true;
  if (window.BURN_SUPPORTER && !o.ach) return true; // supporter edition: every desk and bot skin (achievement skins stay earned)
  if (o.lvl && level() >= o.lvl) return true;
  if (o.ach && P.ach[o.ach]) return true;
  if (o.seasonal != null && isOctober()) { P.cosOwn[kind + ':' + id] = 1; return true; } // seasonal items are kept once seen
  return false;
}
function founderOpen(id) { return level() >= Core.FOUNDERS[id].lvl; }
// ---- achievements ----
const A = [
  ['first_sale', 'First dollar', 'Make your first sale.', r => r.s.flags.firstSale],
  ['bill1', 'Lights stay on', 'Pay your first power bill.', r => r.s.billsPaid >= 1],
  ['win', 'Day 25', 'Pay all five bills.', r => r.s.billsPaid >= 5],
  ['overtime', 'Overtime', 'Pay a bill in overtime.', r => r.s.billsPaid >= 6],
  ['ipo', 'IPO', 'Survive to day 50.', r => r.s.result === 'ipo'],
  ['launch', 'Launch day', 'Ship and post on the same day.', r => r.s.stats.c_launch],
  ['viral', 'Gone viral', 'Play 3 GROW cards in one day.', r => r.s.stats.c_viral],
  ['full', 'Full stack', 'BUILD + GROW + TRUST in one day.', r => r.s.stats.c_full],
  ['flow', 'Flow state', 'Play 4 cards in one day.', r => r.s.stats.c_flow],
  ['featured', 'Featured', 'Reach 6 quality.', r => r.s.flags.featured],
  ['upsell', 'Upsell', 'Ship right after a Free toy.', r => r.s.stats.c_upsell],
  ['sponsor', 'Sponsored', 'Land a sponsor.', r => r.s.stats.sponsorWin],
  ['frontpage', 'Front page', 'Hit the front page of a big forum.', r => r.s.stats.c_frontpage],
  ['six', 'Product line', 'Run 6 products at once.', r => r.s.stats.maxProducts >= 6],
  ['crowd', 'Crowd', 'Reach 500 audience.', r => r.s.stats.maxAud >= 500],
  ['beloved', 'Beloved', 'Reach 100 trust.', r => r.s.stats.maxTrust >= 100],
  ['clean', 'Clean hands', 'Win without a single SHADY card.', r => r.won && r.s.stats.shady === 0],
  ['shadywin', 'Ends justify', 'Win as Shady Bot.', r => r.won && r.s.founder === 'shady'],
  ['burn1', 'Turn up the heat', 'Win on Burn 1 or higher.', r => r.won && r.s.burn >= 1],
  ['burn5', 'Hot seat', 'Win on Burn 5 or higher.', r => r.won && r.s.burn >= 5],
  ['burn10', 'Meltdown', 'Win on Burn 10.', r => r.won && r.s.burn >= 10],
  ['rush', 'Speedrun', 'Win a Rush run.', r => r.won && r.s.mode === 'rush'],
  ['streak3', 'Habit', 'Play the Daily 3 days in a row.', r => r.streak >= 3],
  ['streak7', 'Ritual', 'Play the Daily 7 days in a row.', r => r.streak >= 7],
  ['seriesA', 'Series A', 'Score 3,000.', r => r.s.earned >= 3000],
  ['unicorn', 'Unicorn', 'Score 6,000. Unlocks the Gold bot.', r => r.s.earned >= 6000],
  ['decacorn', 'Decacorn', 'Score 15,000.', r => r.s.earned >= 15000],
  ['phoenix', 'Phoenix', 'Burn out and still win.', r => r.won && r.s.stats.burnouts >= 1],
  ['ghost', 'Beat BurnBot', 'Outscore BurnBot on the same deck.', r => r.beatGhost],
  ['regular', 'Regular', 'Finish 10 runs.', r => P.runs >= 10],
  ['collector', 'Collector', 'See every card in the game.', () => collection().pct >= 1],
  ['halloween', 'Trick or treat', 'Finish a run on Halloween. Unlocks the Ghost bot.', () => { const d = new Date(); return d.getMonth() === 9 && d.getDate() === 31; }],
];
function collection() { const ids = Object.keys(Core.CARDS).filter(id => Core.CARDS[id].rar < 9); const tids = Object.keys(Core.TOOLS); const seen = ids.filter(id => P.seen[id]).length + tids.filter(id => P.seen['t:' + id]).length; return { ids, tids, seen, total: ids.length + tids.length, pct: seen / (ids.length + tids.length) }; }
// ---- daily streak ----
function streak() {
  let d = ymd(), n = 0; if (!P.daily[d]) d = addDays(d, -1);
  while (P.daily[d]) { n++; d = addDays(d, -1); }
  return n;
}
// ---- leaderboard ----
function boardFor(mode, day) { if (mode === 'daily') return (P.board.daily[day || ymd()] = P.board.daily[day || ymd()] || []); return P.board[mode] || (P.board[mode] = []); }
function addBoard(mode, e, day) { const b = boardFor(mode, day); b.push(e); b.sort((x, y) => y.score - x.score); b.splice(10); return b.indexOf(e); }
function pruneDaily() { const keys = Object.keys(P.board.daily).sort(); while (keys.length > 30) delete P.board.daily[keys.shift()]; }
// ---- finishing a run: XP, achievements, boards, history ----
function finish(s, extra) {
  extra = extra || {};
  const won = s.billsPaid >= 5, day = ymd(), out = { xpParts: [], newAch: [], levelUps: [], won };
  if (s.mode !== 'tutorial') P.runs++; if (won) P.wins++;
  Object.keys(s.seen || {}).forEach(k => { P.seen[k] = 1; });
  P.best = Math.max(P.best, s.earned);
  if (won && s.mode !== 'tutorial') P.burnMax = Math.max(P.burnMax, Math.min(10, s.burn + 1));
  if (extra.beatGhost) P.ghostWins++;
  let first = false;
  if (s.mode === 'daily' && extra.seedDay) { if (!P.daily[extra.seedDay] || P.daily[extra.seedDay].v1) { first = true; P.daily[extra.seedDay] = { score: s.earned, won, result: s.result, day: s.day, code: extra.code }; } }
  if (s.mode === 'tutorial') P.tutorialDone = true;
  // XP
  const before = levelOf(P.xp);
  const xp = [['Run', 10], ['Revenue', Math.floor(s.earned / 25)], ['Bills paid', 15 * s.billsPaid]];
  if (won) xp.push(['Win', 50]); if (won && s.burn) xp.push(['Burn ' + s.burn, 10 * s.burn]);
  if (first) xp.push(['First Daily today', 40]); if (extra.beatGhost) xp.push(['Beat BurnBot', 20]);
  const r = { s, won, streak: streak(), beatGhost: !!extra.beatGhost };
  A.forEach(a => { if (!P.ach[a[0]] && a[3](r)) { P.ach[a[0]] = day; out.newAch.push(a); xp.push([a[1], 25]); } });
  let tot = 0; xp.forEach(x => tot += x[1]); P.xp += tot; out.xpParts = xp; out.xp = tot;
  const after = levelOf(P.xp);
  for (let L = before.lvl + 1; L <= after.lvl; L++) out.levelUps.push({ lvl: L, unlocks: unlocksAt(L) });
  out.before = before; out.after = after; out.first = first;
  const entry = { score: s.earned, when: day, founder: s.founder, burn: s.burn, result: s.result, day: s.day, code: extra.code };
  out.rank = s.mode === 'tutorial' ? -1 : addBoard(s.mode === 'rush' ? 'rush' : s.mode === 'daily' ? 'daily' : 'run', entry, extra.seedDay);
  pruneDaily();
  P.last = null; save();
  return out;
}
window.BurnMeta = { load, save, grantXp, get P() { return P; }, ymd, addDays, deckNo, level, levelOf, cardLvl, need, nextUnlock, unlocksAt, UNLOCKS, DESKS, SKINS, owns, founderOpen, ACH: A, collection, streak, boardFor, finish, reset() { const keep = P.set; P = DEFAULT(); P.set = keep; P.tutorialDone = true; save(); } };
})();

/* ---- js/ui.js ---- */
/* Burn Rate v2 — the game UI. Rules live in core.js; this file only draws, animates and routes input. */
(function () {
'use strict';
const C = window.BurnCore, B = window.BurnBots, A = window.BurnArt, X = window.BurnFx, S = window.BurnSfx, M = window.BurnMeta, PF = window.BurnPlatform;
const LINKS = {};
LINKS.tip = 'https://secretwall.itch.io/burn-rate/donate';

LINKS.share = (function () { try { return location.origin + location.pathname; } catch (_) { return ''; } })(); LINKS.challenge = 1; LINKS.foot = window.BURN_SITE_LINK || null;


// Anonymous play counters (site build only). No cookies, no IDs, nothing personal: each event just adds 1 to a
// public counter (abacus.jasoncameron.dev, free, no account). Off on localhost, off with Do Not Track / GPC.
const MX = (function () {
  const NS = 'burnrate-secretwall-v2', base = 'https://abacus.jasoncameron.dev/hit/' + NS + '/';
  let on = false;
  try { on = (/\.github\.io$/.test(location.hostname) || window.BURN_METRICS_FORCE === true) && navigator.doNotTrack !== '1' && navigator.globalPrivacyControl !== true; } catch (_) {}
  const sent = {};
  function hit(k) { if (!on || sent[k] > 3) return; sent[k] = (sent[k] || 0) + 1; try { fetch(base + k, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true, cache: 'no-store' }).catch(() => {}); } catch (_) {} }
  function days(a, b) { try { return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5); } catch (_) { return 0; } }
  function boot(P, M) {
    if (!on) return; const t = M.ymd(); const m = P.mx = P.mx || {};
    hit('visit');
    if (!m.first) { m.first = t; m.last = t; hit('new_player'); }
    else if (m.last !== t) { const d = days(m.first, t); hit('active_day'); if (d === 1) hit('return_day2'); else if (d >= 2 && d <= 7) hit('return_week1'); else if (d > 7) hit('return_later'); m.last = t; }
    try { M.save(); } catch (_) {}
    // session length: visible time until the tab is first hidden or closed
    let act = 0, since = document.hidden ? 0 : performance.now(), done = false;
    const flush = () => { if (done) return; if (since) act += performance.now() - since; since = 0; done = true; const mn = act / 6e4;
      hit(mn < 1 ? 'session_0-1m' : mn < 3 ? 'session_1-3m' : mn < 10 ? 'session_3-10m' : mn < 30 ? 'session_10-30m' : 'session_30m-plus'); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
  }
  return { hit, boot };
})();

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const ic = A.icon;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rndSeed = () => { try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] >>> 0 || 7; } catch (_) { return (Math.random() * 4294967295 >>> 0) || 7; } };
const stage = $('stage'), view = $('view');
let P = null;               // profile (meta)
let st = null;              // current run state
let ctx = null;             // run context {mode, seedDay, label, ghost:{name, by[], total}, challenge}
let layout = { port: false, W: 960, H: 540, k: 1 };
let busy = false, fast = false, pending = null, selected = -1, ov = null, ovStack = [], shownUids = {}, D = {};
let rush = null;            // {left, per}
let motionOK = true;
let touchMode = false;
window.addEventListener('pointerdown', e => { touchMode = e.pointerType === 'touch' || e.pointerType === 'pen'; }, true);

// ---------- settings ----------
function applySettings() {
  const s = P.set;
  motionOK = s.motion === 'full' ? true : s.motion === 'reduced' ? false : !PF.prefersReducedMotion();
  stage.classList.toggle('calm', !motionOK);
  X.setPrefs({ motion: motionOK, shake: s.shake, speed: s.speed || 4 });
  S.setVolumes(s.sfx, s.music); S.setMuted(s.muted);
  stage.dataset.desk = M.owns('desk', P.cos.desk) ? P.cos.desk : 'garage';
}
const spd = () => (P.set.speed === 0 ? 0 : 1 / (P.set.speed || 1));
function wait(ms) { const k = spd(); if (!k) return Promise.resolve(); return sleep(ms * k * (fast ? 0.12 : 1)); }

// ---------- layout: one fixed stage scaled to fit ----------
function fit() {
  const app = $('app'); const vw = app.clientWidth || innerWidth, vh = app.clientHeight || innerHeight;
  const port = vh > vw * 1.1; let W, H;
  if (port) { W = clamp(Math.round(vw), 360, 440); H = clamp(Math.round(vh * W / vw), 640, 940); }
  else { H = Math.max(440, Math.min(540, Math.round(vh))); W = Math.round(H * vw / vh); if (W < 900) { W = 900; H = Math.min(660, Math.max(440, Math.round(W * vh / vw))); } if (W > 1200) W = 1200; }
  const k = Math.min(vw / W, vh / H);
  const short = !port && H < 520;
  const changed = port !== layout.port || W !== layout.W || H !== layout.H;
  layout = { port, short, W, H, k };
  stage.style.width = W + 'px'; stage.style.height = H + 'px';
  stage.style.transform = 'translate(' + Math.round((vw - W * k) / 2) + 'px,' + Math.round((vh - H * k) / 2) + 'px) scale(' + k + ')';
  stage.classList.toggle('port', port); stage.classList.toggle('short', short);
  X.setScale(k, W, H);
  if (changed && st && $('g-hand')) { renderHand(); placeCoach(); }
}
window.addEventListener('resize', fit); window.addEventListener('orientationchange', () => setTimeout(fit, 120));

// ---------- overlays ----------
function openOv(html, opt) {
  opt = opt || {};
  stage.querySelectorAll('.banner').forEach(b => b.remove()); // a modal replaces any celebration banner
  const o = document.createElement('div'); o.className = 'ov'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
  o.innerHTML = '<div class="sheet ' + (opt.cls || '') + '" style="' + (opt.w ? 'width:' + opt.w + 'px;' : '') + '">' + (opt.close !== false ? '<button class="ibtn x" type="button" data-close aria-label="Close">' + ic('close') + '</button>' : '') + html + '</div>';
  o.closable = opt.close !== false; o.onclose = opt.onclose || null;
  stage.appendChild(o); ovStack.push(o); ov = o;
  o.addEventListener('click', e => { const t = e.target.closest('[data-close]'); if (t) { S.play('tap'); closeOv(o); } });
  setTimeout(() => { const f = o.querySelector('[autofocus],.btn.primary,.card:not(.off),.btn'); if (f && !touchMode) try { f.focus({ preventScroll: true }); } catch (_) {} }, 30);
  return o;
}
function closeOv(o) { o = o || ov; if (!o) return; o.remove(); ovStack = ovStack.filter(x => x !== o); ov = ovStack[ovStack.length - 1] || null; if (o.onclose) o.onclose(); }
function closeAll() { while (ov) { const o = ov; o.onclose = null; closeOv(o); } }
function toast(html, cls, ms) { const t = document.createElement('div'); t.className = 'banner show ' + (cls || ''); t.innerHTML = html; stage.appendChild(t); setTimeout(() => t.remove(), ms || 1000); return t; }

// ---------- copy / share ----------
function copyText(text) {
  return new Promise(res => {
    const fallback = () => { try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); res(ok); } catch (_) { res(false); } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => res(true), fallback); else fallback(); } catch (_) { fallback(); }
  });
}
function showCopyFallback(text) { const o = openOv('<h3>Copy this</h3><textarea class="field" rows="5" readonly>' + esc(text) + '</textarea><p class="muted" style="font-size:13px">Your browser blocked the clipboard here. Select the text and copy it.</p>', { w: 420 }); const t = o.querySelector('textarea'); t.focus(); t.select(); }
async function copyAndSay(text, label) { const ok = await copyText(text); if (ok) { S.play('coin'); toast('<div class="bt" style="font-size:26px">' + esc(label || 'Copied!') + '</div>', '', 900); } else showCopyFallback(text); }

// ---------- profile-derived info ----------
const todayYmd = () => M.ymd();
const dailyNo = () => M.deckNo();
const founderName = id => C.FOUNDERS[id].n;
function modeLabel(c) { if (!c) return ''; if (c.mode === 'daily') return 'Daily #' + M.deckNo(c.seedDay); if (c.mode === 'rush') return 'Rush'; if (c.mode === 'tutorial') return 'Tutorial'; return 'Run'; }

// ---------- cards ----------
const NEEDCASH = { ads: 5, give: 3, refunds: 2 };
function cardHTML(c, o) {
  o = o || {}; const id = typeof c === 'string' ? c : c.id, d = C.CARDS[id];
  const base = d.cost, k = o.cost != null ? o.cost : base;
  const fxText = st && o.live ? C.describe(st, id) : d.fx;
  const cls = 'card t-' + d.tag + (o.off ? ' off' : '') + (o.big ? ' big' : '') + (o.deal ? ' deal' : '') + (o.sel ? ' sel' : '');
  let need = '';
  if (o.off === 'cpu') need = '<span class="need">Need ' + k + ' ' + ic('cpu') + '</span>';
  else if (o.off === 'cash') need = '<span class="need">Need $' + (NEEDCASH[id] || '?') + '</span>';
  const label = d.n + ', costs ' + k + ' energy. ' + fxText.replace(/\{(\w+)\}/g, (m, t) => ' ' + ({ aud: 'audience', trust: 'trust', cash: 'cash', q: 'quality', burn: 'burnout', cpu: 'energy', prod: 'product', card: 'card' }[t] || t)) + (o.off === 'cpu' ? '. Not enough energy.' : o.off === 'cash' ? '. Not enough cash.' : '');
  return '<button type="button" class="' + cls + '"' + (o.uid != null ? ' data-uid="' + o.uid + '"' : '') + (o.attr || '') + (o.style ? ' style="' + o.style + '"' : '') + ' aria-label="' + esc(label) + '"' + (o.off ? ' aria-disabled="true"' : '') + '>' +
    '<span class="cost' + (k === 0 ? ' zero' : k < base ? ' cheap' : '') + '">' + k + '</span>' +
    '<span class="art">' + ic(A.CARD_ICON[id] || 'card') + '</span>' +
    '<span class="nm">' + esc(d.n) + '</span><span class="fx">' + A.fx(fxText) + '</span>' +
    (o.big ? '<span class="desc">' + esc(d.d) + '</span>' : '') +
    '<span class="tagl">' + C.TAGS[d.tag] + '<i class="rar r' + Math.min(2, d.rar) + '"></i></span>' + need + '</button>';
}
function toolHTML(id, o) {
  o = o || {}; const t = C.TOOLS[id];
  return '<button type="button" class="toolcard"' + (o.attr || '') + ' aria-label="' + esc(t.n + ' tool. ' + t.d) + '"><span class="art">' + ic(A.TOOL_ICON[id] || 'tool') + '</span><span class="nm">' + esc(t.n) + '</span><span class="fx">' + esc(t.d) + '</span><span class="tagl">TOOL · PASSIVE</span></button>';
}

// ---------- hub ----------
let challenge = null; // {code, p, s} from ?c=
function hubHTML() {
  const L = M.levelOf(P.xp), nu = M.nextUnlock(), today = todayYmd(), dd = P.daily[today], stk = M.streak();
  const skin = M.owns('skin', P.cos.skin) ? P.cos.skin : 'classic';
  let h = '<div class="screen hub">';
  h += '<div class="hub-l"><div class="logo">BURN <b>RATE</b><span class="fire">' + ic('burn') + '</span></div><div class="tagline">Pay the power bill or get unplugged.</div>';
  h += '<div class="botwrap">' + A.bot(dd && dd.won ? 'happy' : 'idle', skin) + '</div>';
  h += '<div class="lvlbox panel"><div class="row"><b>Level ' + L.lvl + '</b><span class="muted" style="margin-left:auto;font-size:13px">' + L.into + ' / ' + L.need + ' XP</span></div><div class="xpbar"><i style="width:' + Math.round(100 * L.into / L.need) + '%"></i></div>' +
    (nu ? '<div class="muted" style="font-size:12px">Next: <b>' + esc(nu[3]) + '</b> at level ' + nu[0] + '</div>' : '<div class="muted" style="font-size:12px">Everything unlocked. Chase the board.</div>') + '</div>' + (LINKS.foot ? '<div class="foot"><a href="' + esc(LINKS.foot.href) + '" target="_blank" rel="noopener">' + esc(LINKS.foot.text) + '</a></div>' : '') + '</div>';
  h += '<div class="hub-r">';
  if (challenge) h += '<button type="button" class="mode challenge" data-go="challenge"><span class="mi">' + ic('trophy') + '</span><span><span class="mt">Beat ' + money(challenge.p.score) + '</span><br><span class="ms">A friend\u2019s ' + esc(modeLabel({ mode: challenge.p.mode, seedDay: challenge.day })) + ' run. Same deck, same luck.</span></span><span class="go">PLAY</span></button>';
  if (P.last && P.last.ctx) h += '<button type="button" class="mode cont" data-go="continue"><span class="mi">' + ic('play') + '</span><span><span class="mt">Continue</span><br><span class="ms">' + esc(P.last.ctx.label || 'Your run') + ' · day ' + (P.last.day || '?') + '</span></span><span class="go">RESUME</span></button>';
  h += '<button type="button" class="mode daily" data-go="daily"><span class="mi">' + ic('cal') + '</span><span><span class="mt">Daily #' + dailyNo() + '</span><br><span class="ms">' + (dd && !dd.v1 ? 'Done: ' + money(dd.score) + (dd.won ? ' · won' : '') + '. Replay for the board.' : 'Same deck for everyone today.') + (stk ? ' · ' + stk + '-day streak' : '') + '</span></span><span class="go">' + (dd && !dd.v1 ? 'REPLAY' : 'PLAY') + '</span></button>';
  h += '<button type="button" class="mode run" data-go="run"><span class="mi">' + ic('rocket') + '</span><span><span class="mt">Run</span><br><span class="ms">Pick a founder and a Burn level. New deck each time.</span></span><span class="go">SET UP</span></button>';
  h += '<button type="button" class="mode rush" data-go="rush"><span class="mi">' + ic('clock') + '</span><span><span class="mt">Rush</span><br><span class="ms">20 seconds a day. Think fast.</span></span><span class="go">GO</span></button>';
  h += '<div class="hub-nav">' + [['board', 'trophy', 'Board'], ['cards', 'card', 'Cards'], ['awards', 'star2', 'Awards'], ['desk', 'crown', 'Desk'], ['codes', 'tag', 'Codes'], ['help', 'book', 'How to'], ['settings', 'gear', 'Settings']].map(b => '<button type="button" class="btn" data-nav="' + b[0] + '" aria-label="' + b[2] + '">' + ic(b[1]) + '<span class="hl">' + b[2] + '</span></button>').join('') + '</div>';
  h += '</div>';
  return h + '</div>';
}
function showHub() {
  st = null; ctx = null; rush = null; busy = false; pending = null; closeAll(); removeCoach();
  PF.gameplayStop(); S.setIntensity(0);
  view.innerHTML = hubHTML();
  view.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { S.play('tap'); const g = b.dataset.go; if (g === 'daily') startDaily(); else if (g === 'run') runSetup(); else if (g === 'rush') startRush(); else if (g === 'continue') continueRun(); else if (g === 'challenge') startChallenge(); });
  view.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { S.play('tap'); PANELS[b.dataset.nav](); });
}

// ---------- panels ----------
const PANELS = {
  board() {
    const tabs = [['daily', 'Today'], ['run', 'Runs'], ['rush', 'Rush']];
    const o = openOv('<h2>' + ic('trophy') + ' Leaderboard</h2><p class="muted" style="font-size:13px">Your best runs on this device. Share a score code and a friend can replay it exactly.</p><div class="tabs" role="tablist">' + tabs.map((t, i) => '<button type="button" class="btn small" role="tab" data-tab="' + t[0] + '" aria-selected="' + (i === 0) + '">' + t[1] + '</button>').join('') + '</div><div class="scroll list" id="bd-list" style="max-height:300px"></div>', { w: 560 });
    const fill = mode => {
      const list = M.boardFor(mode).slice(); let rows = list.map(e => ({ e, me: 1 }));
      if (mode === 'daily') { const g = ghostFor(dailyOpts(todayYmd())); rows.push({ e: { score: g.total, founder: 'tiny', burn: 0, when: todayYmd(), result: g.result, day: g.day }, bot: 1 }); rows.sort((a, b) => b.e.score - a.e.score); }
      const el = o.querySelector('#bd-list');
      el.innerHTML = rows.length ? rows.map((r, i) => '<div class="li ' + (r.bot ? 'bot' : '') + '"><b style="width:28px">#' + (i + 1) + '</b><span class="grow"><b class="num">' + money(r.e.score) + '</b> <span class="muted" style="font-size:12px">' + esc(C.rankOf(r.e.score)) + '</span><br><span class="muted" style="font-size:12px">' + (r.bot ? 'BurnBot (sensible bot) · ' : esc(founderName(r.e.founder || 'tiny')) + (r.e.burn ? ' · Burn ' + r.e.burn : '') + ' · ') + 'day ' + (r.e.day || '?') + ' · ' + esc(r.e.when || '') + '</span></span>' + (r.e.code ? '<button type="button" class="btn small" data-code="' + esc(r.e.code) + '">' + ic('copy') + ' Code</button>' : '') + '</div>').join('') : '<p class="muted">No runs yet. Play one!</p>';
      if (mode === 'daily' && P.legacy && P.legacy.best) el.insertAdjacentHTML('beforeend', '<p class="muted" style="font-size:12px">Classic version best: ' + money(P.legacy.best) + ' (' + P.legacy.played + ' dailies played).</p>');
      el.querySelectorAll('[data-code]').forEach(b => b.onclick = () => copyAndSay(b.dataset.code, 'Code copied!'));
    };
    o.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.play('tap'); o.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === b)); fill(b.dataset.tab); });
    fill('daily');
  },
  cards() {
    const col = M.collection(), L = M.level();
    const cards = col.ids.slice().sort((a, b) => C.CARDS[a].lvl - C.CARDS[b].lvl || C.CARDS[a].tag.localeCompare(C.CARDS[b].tag));
    let h = '<h2>' + ic('card') + ' Cards</h2><p class="muted" style="font-size:13px">Discovered ' + col.seen + ' of ' + col.total + '. New cards join your Run offers as you level up. Daily and Rush use every card.</p><div class="scroll" style="max-height:360px"><div class="grid-cards">';
    cards.forEach(id => {
      const d = C.CARDS[id];
      if (P.seen[id]) h += cardHTML(id, { attr: ' tabindex="-1"' });
      else h += '<div class="card t-' + d.tag + ' off" style="justify-content:center;align-items:center;text-align:center"><span class="art" style="width:100%">' + ic('lock') + '</span><span class="nm">' + (d.lvl > L ? 'Level ' + d.lvl : 'Not seen yet') + '</span><span class="tagl" style="width:100%">' + C.TAGS[d.tag] + '</span></div>';
    });
    h += '</div><h3 style="margin:8px 0">Tools</h3><div class="grid-cards">';
    col.tids.forEach(id => { const t = C.TOOLS[id]; h += P.seen['t:' + id] ? toolHTML(id, { attr: ' tabindex="-1"' }).replace('toolcard', 'toolcard" style="width:150px;height:196px') : '<div class="toolcard" style="width:150px;height:196px;opacity:.45"><span class="art">' + ic('lock') + '</span><span class="nm">' + (t.lvl > L ? 'Level ' + t.lvl : 'Not seen yet') + '</span></div>'; });
    openOv(h + '</div></div>', { w: 760 });
  },
  awards() {
    const got = M.ACH.filter(a => P.ach[a[0]]).length;
    openOv('<h2>' + ic('star2') + ' Awards</h2><p class="muted" style="font-size:13px">' + got + ' of ' + M.ACH.length + ' unlocked. Each one is worth 25 XP.</p><div class="scroll list" style="max-height:360px">' + M.ACH.map(a => '<div class="li ' + (P.ach[a[0]] ? 'me' : 'locked') + '">' + ic(P.ach[a[0]] ? 'check' : 'lock') + '<span class="grow"><b>' + esc(a[1]) + '</b><br><span class="muted" style="font-size:12px">' + esc(a[2]) + '</span></span>' + (P.ach[a[0]] ? '<span class="muted" style="font-size:12px">' + esc(P.ach[a[0]]) + '</span>' : '') + '</div>').join('') + '</div>', { w: 520 });
  },
  desk() {
    const draw = o => {
      const cur = P.cos;
      const item = (kind, id, t) => { const own = M.owns(kind, id); const why = t.lvl ? 'Level ' + t.lvl : t.ach ? 'Award: ' + (M.ACH.find(a => a[0] === t.ach) || [0, '?'])[1] : t.note || ''; return '<button type="button" class="fcard ' + (own ? '' : 'locked') + '" data-k="' + kind + '" data-id="' + id + '" aria-pressed="' + (cur[kind] === id) + '"' + (own ? '' : ' aria-disabled="true"') + '>' + (kind === 'skin' ? '<span class="botwrap">' + A.bot('happy', id) + '</span>' : '<span class="deskprev" data-desk="' + id + '"><span class="desk"></span></span>') + '<span class="fn">' + esc(t.n) + '</span><span class="fd">' + (own ? (cur[kind] === id ? 'Equipped' : 'Tap to use') : ic('lock') + ' ' + esc(why)) + '</span></button>'; };
      o.querySelector('#dk').innerHTML = '<h3>Bot</h3><div class="founders">' + Object.keys(M.SKINS).map(id => item('skin', id, M.SKINS[id])).join('') + '</div><h3>Desk</h3><div class="founders">' + Object.keys(M.DESKS).map(id => item('desk', id, M.DESKS[id])).join('') + '</div>';
      o.querySelectorAll('.fcard').forEach(b => b.onclick = () => { if (b.classList.contains('locked')) { S.play('deny'); return; } S.play('tap'); P.cos[b.dataset.k] = b.dataset.id; M.save(); applySettings(); draw(o); showHubSoft(); });
    };
    const o = openOv('<h2>' + ic('crown') + ' Desk</h2><div class="scroll" id="dk" style="max-height:380px"></div>', { w: 720 }); draw(o);
  },
  codes() {
    const o = openOv('<h2>' + ic('tag') + ' Score codes</h2><p class="muted" style="font-size:13px">Every run ends with a code. It replays the whole run move by move, so scores can\u2019t be faked. Paste one to check it and play the same deck.</p><textarea class="field" id="cd-in" rows="3" placeholder="BR2.…" aria-label="Score code"></textarea><div class="row"><button type="button" class="btn primary" id="cd-go">' + ic('check') + ' Verify</button></div><div id="cd-out"></div>', { w: 520 });
    o.querySelector('#cd-go').onclick = () => {
      const v = C.verify(o.querySelector('#cd-in').value); const out = o.querySelector('#cd-out');
      if (!v.ok) { S.play('deny'); out.innerHTML = '<div class="li" style="border:2px solid var(--red)">' + ic('close') + '<span class="grow">' + esc(v.why) + '</span></div>'; return; }
      S.play('paid'); const s = v.s;
      out.innerHTML = '<div class="li me">' + ic('check') + '<span class="grow"><b>Verified: ' + money(s.earned) + '</b> · ' + esc(C.rankOf(s.earned)) + '<br><span class="muted" style="font-size:12px">' + esc(modeLabel({ mode: v.p.mode, seedDay: dayOfSeed(v.p.seed) })) + ' · ' + esc(founderName(v.p.founder)) + (v.p.burn ? ' · Burn ' + v.p.burn : '') + ' · ' + resultText(s) + '</span></span><button type="button" class="btn small primary" id="cd-play">Play this deck</button></div>';
      out.querySelector('#cd-play').onclick = () => { challenge = { code: o.querySelector('#cd-in').value.trim(), p: v.p, s: v.s, day: dayOfSeed(v.p.seed) }; closeAll(); startChallenge(); };
    };
  },
  help() {
    openOv('<h2>' + ic('book') + ' How to play</h2><div class="scroll" style="max-height:380px;font-size:14px;line-height:1.45"><p>You are a tiny bot with a tiny startup. Every 5 days the <b>power bill</b> is due. Have the cash at the end of day 5, 10, 15, 20 and 25, or you get <b>unplugged</b>.</p><br><p><b>Each day</b> you draw 4 cards and get 3 ' + ic('cpu') + ' energy. Play cards, then press <b>End day</b>.</p><br><p><b>Each night</b> a share of your ' + ic('aud') + ' audience visits. Your ' + ic('trust') + ' trust sets how many of them buy. Buyers pay for your ' + ic('prod') + ' products, and ' + ic('q') + ' quality raises every price.</p><br><p><b>Combos:</b> Ship + Launch post on the same day = LAUNCH DAY. 3 GROW cards = VIRAL. BUILD + GROW + TRUST = FULL STACK. 4 cards in a day = FLOW STATE.</p><br><p><b>SHADY</b> cards pay big now and bite later. ' + ic('burn') + ' Burnout at 6+ costs energy; at 10 you lose a day.</p><br><p>Pay a bill and you pick an upgrade. Survive day 25 to win, then keep going in overtime for a bigger score.</p><br><p class="muted">Keys: 1–8 play a card · Space end day · M mute · Esc pause.</p></div>', { w: 560 });
  },
  settings() {
    const s = P.set;
    const seg = (key, opts) => '<div class="seg" data-seg="' + key + '">' + opts.map(o => '<button type="button" class="btn small" data-v="' + o[0] + '" aria-pressed="' + (String(s[key]) === String(o[0])) + '">' + o[1] + '</button>').join('') + '</div>';
    const o = openOv('<h2>' + ic('gear') + ' Settings</h2><div class="scroll" style="max-height:400px;display:flex;flex-direction:column;gap:10px">' +
      '<label class="lbl" for="set-mus">Music</label><input id="set-mus" class="slider" type="range" min="0" max="1" step="0.05" value="' + s.music + '">' +
      '<label class="lbl" for="set-sfx">Sound effects</label><input id="set-sfx" class="slider" type="range" min="0" max="1" step="0.05" value="' + s.sfx + '">' +
      '<div class="lbl">Animation speed</div>' + seg('speed', [[1, 'Normal'], [2, 'Fast'], [0, 'Instant']]) +
      '<div class="lbl">Motion</div>' + seg('motion', [['auto', 'Auto'], ['full', 'Full'], ['reduced', 'Reduced']]) +
      '<div class="lbl">Screen shake</div>' + seg('shake', [[true, 'On'], [false, 'Off']]) +
      '<div class="lbl">Hints</div>' + seg('hints', [[true, 'On'], [false, 'Off']]) +
      (PF.Store.persistent === false ? '<p class="muted" style="font-size:12px;color:var(--amber)">This browser is blocking storage, so progress lasts only until you close the tab.</p>' : '') +
      '<div class="row"><button type="button" class="btn small" data-a="tut">Replay tutorial</button><button type="button" class="btn small" data-a="credits">Credits</button><button type="button" class="btn small pink" data-a="reset">Reset progress</button></div></div>', { w: 480 });
    o.querySelector('#set-mus').oninput = e => { s.music = +e.target.value; applySettings(); if (s.music > 0) S.startMusic(); M.save(); };
    o.querySelector('#set-sfx').oninput = e => { s.sfx = +e.target.value; applySettings(); M.save(); };
    o.querySelector('#set-sfx').onchange = () => S.play('coin');
    o.querySelectorAll('[data-seg]').forEach(g => g.querySelectorAll('.btn').forEach(b => b.onclick = () => {
      const k = g.dataset.seg; let v = b.dataset.v; v = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? +v : v; s[k] = v; M.save(); applySettings(); S.play('tap');
      g.querySelectorAll('.btn').forEach(x => x.setAttribute('aria-pressed', x === b));
    }));
    o.querySelector('[data-a=tut]').onclick = () => { closeAll(); startTutorial(); };
    o.querySelector('[data-a=credits]').onclick = () => PANELS.credits();
    o.querySelector('[data-a=reset]').onclick = () => confirmBox('Reset all progress?', 'Levels, unlocks, awards and boards will be wiped. Settings stay.', 'Reset', () => { M.reset(); P = M.P; applySettings(); closeAll(); showHub(); });
  },
  credits() {
    openOv('<h2>Credits</h2><div style="font-size:14px;line-height:1.5"><p><b>Burn Rate</b> v2 · a tiny deckbuilder by Secret Wall.</p><p>Made with AI assistance.</p>' + (PF.supporter ? '<p><b>Supporter edition.</b> Thank you! Every desk and bot skin is unlocked.</p>' : '') + '<p>Sound: synthesized live with <b>ZzFX</b> by Frank Force (MIT License).</p><p>No trackers, no cookies, no accounts. Your progress stays in this browser.' + (typeof MX !== 'undefined' ? ' This web version adds 1 to a few anonymous public counters (plays, return visits, session length) so I can tell if people enjoy it. Nothing personal is sent, and Do Not Track turns it off.' : ' No network requests.') + '</p></div>', { w: 440 });
  },
};
function confirmBox(title, body, yes, onYes) {
  const o = openOv('<h3>' + esc(title) + '</h3><p class="muted" style="font-size:14px">' + esc(body) + '</p><div class="row c"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pink" id="cf-yes">' + esc(yes) + '</button></div>', { w: 400 });
  o.querySelector('#cf-yes').onclick = () => { closeOv(o); onYes(); };
}
function showHubSoft() { if (!st) { const keep = ovStack.slice(); keep.forEach(o => o.remove()); view.innerHTML = hubHTML(); showHubBind(); keep.forEach(o => stage.appendChild(o)); } }
function showHubBind() {
  view.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { S.play('tap'); const g = b.dataset.go; if (g === 'daily') startDaily(); else if (g === 'run') runSetup(); else if (g === 'rush') startRush(); else if (g === 'continue') continueRun(); else if (g === 'challenge') startChallenge(); });
  view.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { S.play('tap'); PANELS[b.dataset.nav](); });
}
function resultText(s) { return s.result === 'won' ? 'won on day 25' : s.result === 'ipo' ? 'IPO on day 50' : s.result === 'overtime' ? 'all bills paid, overtime ended on day ' + s.day : s.result === 'unplugged' ? 'unplugged on day ' + s.day : 'day ' + s.day; }
function dayOfSeed(seed) { for (let i = 0; i < 60; i++) { const d = M.addDays(todayYmd(), -i); if (C.dailySeed(d) === seed) return d; } return null; }

// ---------- starting runs ----------
const dailyOpts = day => ({ seed: C.dailySeed(day), mode: 'daily', founder: 'tiny', burn: 0, lvl: C.FULL });
const ghostCache = {};
function ghostFor(opts) {
  const key = [opts.seed, opts.mode, opts.founder, opts.burn, opts.lvl].join(':');
  if (ghostCache[key]) return ghostCache[key];
  const s = B.runBot('sensible', opts, 3000, 0); const by = []; let t = 0; s.days.forEach(d => { t += d.rev; by.push(t); });
  return (ghostCache[key] = { total: s.earned, by, day: s.day, result: s.result });
}
let firstStart = true;
function begin(opts, c, actions) {
  closeAll(); removeCoach();
  const go = () => {
    S.unlock(); musicOn();
    st = actions ? C.replay(opts, actions) : C.newRun(opts);
    MX.hit(actions ? 'resume' : 'start_' + (opts.mode || 'run'));
    if (st.invalid) { st = C.newRun(opts); }
    ctx = c; ctx.opts = opts; ctx.ghost = opts.mode === 'tutorial' ? null : ghostFor(opts);
    ctx.lastDay = st.day; shownUids = {}; selected = -1;
    rush = opts.mode === 'rush' ? { left: RUSH_SEC, last: performance.now(), tick: 99 } : null;
    S.setIntensity(rush ? 1 : 0);
    buildGame(); syncD(); renderAll();
    PF.gameplayStart();
    if (st.phase === 'reward' || st.phase === 'draft') showOffers(); else if (st.phase === 'won') showWon(); else if (st.phase === 'over') showEnd();
    else { say(openingLine(), 'say'); coachUpdate(); }
    saveLast();
  };
  const kind = firstStart ? 'first' : 'next'; firstStart = false;
  PF.adBreak(kind, go);
}
function openingLine() {
  if (st.mode === 'tutorial') return 'Hi! I\u2019m a tiny bot with a tiny startup. Let\u2019s keep the lights on.';
  if (st.day > 1) return 'Welcome back. Day ' + st.day + '.';
  if (st.mode === 'rush') return '20 seconds a day. Go go go!';
  if (ctx.challenge) return 'Beat ' + money(ctx.challenge.p.score) + ' on this deck.';
  return 'Day 1. Ship something and tell people about it.';
}
function startDaily() { const d = todayYmd(); begin(dailyOpts(d), { mode: 'daily', seedDay: d, label: 'Daily #' + dailyNo() }); }
function startRush() { begin({ seed: rndSeed(), mode: 'rush', founder: 'tiny', burn: 0, lvl: C.FULL }, { mode: 'rush', label: 'Rush' }); }
function startTutorial() { begin({ seed: 2026, mode: 'tutorial', founder: 'tiny', burn: 0, lvl: 0 }, { mode: 'tutorial', label: 'Tutorial' }); }
function startRun(founder, burn) { begin({ seed: rndSeed(), mode: 'run', founder, burn, lvl: M.cardLvl() }, { mode: 'run', label: founderName(founder) + (burn ? ' · Burn ' + burn : '') }); }
function startChallenge() {
  if (!challenge) return; const p = challenge.p;
  begin({ seed: p.seed, mode: p.mode === 'tutorial' ? 'run' : p.mode, founder: p.founder, burn: p.burn, lvl: p.lvl }, { mode: p.mode, seedDay: p.mode === 'daily' ? challenge.day : null, label: 'Challenge: beat ' + money(p.score), challenge });
}
function continueRun() {
  const L = P.last; if (!L) return;
  const bytes = C.unb64(L.a || '') || [];
  begin(L.o, L.ctx, bytes);
}
function saveLast() {
  if (!st || st.phase === 'over') return;
  P.last = { o: ctx.opts, a: C.b64(st.actions), ctx: { mode: ctx.mode, seedDay: ctx.seedDay || null, label: ctx.label, challenge: ctx.challenge ? { code: ctx.challenge.code, p: ctx.challenge.p, day: ctx.challenge.day } : null }, day: st.day };
  M.save();
}
function runSetup() {
  const fs = Object.keys(C.FOUNDERS); let f = P.set.founder && M.founderOpen(P.set.founder) ? P.set.founder : 'tiny', b = Math.min(P.set.burn || 0, P.burnMax);
  const o = openOv('<h2>' + ic('rocket') + ' New run</h2><div class="scroll" style="max-height:400px;display:flex;flex-direction:column;gap:12px"><div class="founders" id="rs-f"></div><div><div class="lbl">Burn level ' + (P.burnMax ? '' : '(win a run to unlock Burn 1)') + '</div><div class="seg" id="rs-b" style="flex-wrap:wrap"></div><p class="muted" id="rs-bd" style="font-size:13px;margin-top:6px"></p></div></div><div class="row c"><button type="button" class="btn primary" id="rs-go">' + ic('play') + ' Start run</button></div>', { w: 820 });
  const draw = () => {
    o.querySelector('#rs-f').innerHTML = fs.map(id => { const F = C.FOUNDERS[id], open = M.founderOpen(id); return '<button type="button" class="fcard ' + (open ? '' : 'locked') + '" data-f="' + id + '" aria-pressed="' + (f === id) + '"' + (open ? '' : ' aria-disabled="true"') + '><span class="botwrap">' + A.bot(open ? 'happy' : 'sleepy', id === 'shady' ? 'neon' : id === 'honest' ? 'retro' : id === 'influencer' ? 'gold' : 'classic') + '</span><span class="fn">' + esc(F.n) + '</span><span class="fd">' + (open ? esc(F.d) : ic('lock') + ' Level ' + F.lvl) + '</span></button>'; }).join('');
    let bh = ''; for (let i = 0; i <= Math.max(0, P.burnMax); i++) bh += '<button type="button" class="btn small" data-b="' + i + '" aria-pressed="' + (b === i) + '" style="flex:0 0 52px">' + i + '</button>';
    o.querySelector('#rs-b').innerHTML = bh;
    o.querySelector('#rs-bd').textContent = b ? 'Burn ' + b + ': ' + C.BURNS.slice(1, b + 1).join(' ') : 'Standard rules. Win a run to unlock the next Burn level.';
    o.querySelectorAll('[data-f]').forEach(x => x.onclick = () => { if (x.classList.contains('locked')) { S.play('deny'); return; } S.play('tap'); f = x.dataset.f; draw(); });
    o.querySelectorAll('[data-b]').forEach(x => x.onclick = () => { S.play('tap'); b = +x.dataset.b; draw(); });
  };
  draw();
  o.querySelector('#rs-go').onclick = () => { P.set.founder = f; P.set.burn = b; M.save(); startRun(f, b); };
}

// ---------- game screen ----------
function buildGame() {
  const skin = M.owns('skin', P.cos.skin) ? P.cos.skin : 'classic';
  view.innerHTML = '<div class="screen game" id="game">' +
    '<div class="top"><button type="button" class="ibtn" id="g-pause" aria-label="Pause">' + ic('pause') + '</button>' +
    '<div class="blk dayblk"><div class="sub" id="g-mode">' + esc(ctx.label) + '</div><div class="big" id="g-day">Day 1</div></div>' +
    '<div class="blk billblk" id="g-billblk"><div class="row"><span class="sub">Power bill</span><span class="big num" id="g-bill">$0</span><span class="sub" id="g-due"></span></div><div class="billbar" id="g-billbar"><i></i></div></div>' +
    '<div class="blk cashblk" id="g-cashblk"><div class="sub" id="g-earned">Cash</div><div class="big num" id="g-cash">$0</div></div>' +
    (ctx.ghost ? '<div class="blk ghostblk" id="g-ghost"><div class="sub">' + ic('ghost') + ' BurnBot, same deck</div><div class="big num" id="g-ghostv">$0</div></div>' : '') +
    (rush ? '<div class="timer" id="g-timer" role="timer" aria-label="Seconds left today"><span id="g-timerv">20</span></div>' : '') +
    '<button type="button" class="ibtn" id="g-mute" aria-label="Mute (M)">' + ic(P.set.muted ? 'mute' : 'sound') + '</button></div>' +
    '<div class="stats">' +
      '<div class="stat st-aud" id="s-aud">' + ic('aud', 'i-aud') + '<div class="body"><div class="v num" id="v-aud">0</div><div class="k" id="k-aud">Audience</div></div></div>' +
      '<div class="stat st-trust" id="s-trust">' + ic('trust', 'i-trust') + '<div class="body"><div class="v num" id="v-trust">0</div><div class="k" id="k-trust">Trust</div><div class="meter"><i id="m-trust"></i></div></div></div>' +
      '<div class="stat st-q" id="s-q">' + ic('q', 'i-q') + '<div class="body"><div class="v num" id="v-q">0</div><div class="k" id="k-q">Quality</div><div class="meter"><i id="m-q" style="background:var(--violet)"></i></div></div></div>' +
      '<div class="stat st-burn" id="s-burn">' + ic('burn', 'i-burn') + '<div class="body"><div class="v num" id="v-burn">0</div><div class="k" id="k-burn">Burnout</div><div class="meter"><i id="m-burn"></i></div></div></div>' +
    '</div>' +
    '<div class="biz"><div class="lbl">Products</div><div class="prods" id="g-prods"></div><div class="lbl">Tools</div><div class="tools" id="g-tools"></div></div>' +
    '<div class="center" id="g-center"><div class="botwrap" id="g-bot">' + A.bot('idle', skin) + '</div><div class="col"><div class="bubble say" id="g-bubble" aria-live="polite"></div><div class="forecast" id="g-fc"></div>' + (ctx.ghost ? '<div class="ghostline" id="g-ghost2"></div>' : '') + '</div></div>' +
    '<div class="handwrap" id="g-handwrap"><div class="hand" id="g-hand"></div></div>' +
    '<div class="act"><div class="cpu" id="g-cpu" aria-label="Energy"></div><div class="deckinfo"><button type="button" id="g-deck">' + ic('card') + ' Deck <b id="g-deckn">0</b></button><button type="button" id="g-disc">' + ic('reroll') + ' Used <b id="g-discn">0</b></button></div><button type="button" class="btn primary end" id="g-end">End day</button></div>' +
    '</div>';
  $('g-pause').onclick = () => { S.play('tap'); openPause(); };
  $('g-mute').onclick = toggleMute;
  $('g-end').onclick = () => { S.play('tap'); doAct({ t: 'end' }); };
  $('g-deck').onclick = () => { S.play('tap'); pileView('deck'); };
  $('g-disc').onclick = () => { S.play('tap'); pileView('discard'); };
  $('g-hand').addEventListener('click', onHandClick);
  $('g-hand').addEventListener('mouseover', e => { const c = e.target.closest('.card'); if (c && !busy && !touchMode) hoverCard(c); });
  $('g-hand').addEventListener('focusin', e => { const c = e.target.closest('.card'); if (c && !busy) hoverCard(c); });
  $('g-tools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) { S.play('tap'); const t = C.TOOLS[b.dataset.tool]; say('<b>' + esc(t.n) + ':</b> ' + esc(t.d), 'say'); } });
  ['s-aud', 's-trust', 's-q', 's-burn'].forEach(id => $(id).addEventListener('click', () => { S.play('tap'); say(STAT_HELP[id](), 'say'); }));
}
const STAT_HELP = {
  's-aud': () => ic('aud') + ' <b>Audience</b>: about ' + Math.round(T().VIS * 100) + '% visit each night. It fades 10% a night, so keep posting.',
  's-trust': () => ic('trust') + ' <b>Trust</b>: sets your buy rate (' + pct(st ? C.conv(st) : 0) + ' now). SHADY cards spend it.',
  's-q': () => ic('q') + ' <b>Quality</b>: every 3 adds $1 to all prices. At 6 you get Featured (+$1 more).',
  's-burn': () => ic('burn') + ' <b>Burnout</b>: at 6+ you lose 1 energy a day. At 10 you crash and lose a day. Rest cards help.',
};
const T = () => C.T;
const pct = v => (Math.round(v * 1000) / 10) + '%';
function hoverCard(el) { const c = st && st.hand.find(x => String(x.uid) === el.dataset.uid); if (!c) return; const d = C.CARDS[c.id]; say('<b>' + esc(d.n) + ':</b> ' + esc(d.d), 'say', true); }
function syncD() { D = { cash: st.cash, earned: st.earned, aud: st.aud, trust: st.trust, q: st.q, burnout: st.burnout, cpu: st.cpu, cpuMax: Math.max(st.cpu, D.cpuMax && D.day === st.day ? D.cpuMax : 0), day: st.day, products: st.products.map(p => p.uid) }; }
function renderAll() { if (!st || !$('game')) return; syncD(); renderTop(); renderStats(); renderBiz(); renderFc(); renderCpu(); renderHand(); renderMood(); }
function billInfo(day) { const cyc = C.cycleOf(day), amt = C.billAmt(st, cyc), due = cyc * C.CYCLE; return { cyc, amt, due, left: due - day }; }
function renderTop() {
  const day = st.day, b = billInfo(day);
  $('g-day').textContent = 'Day ' + day + (st.overtime ? '' : ' / 25');
  $('g-bill').textContent = money(b.amt);
  $('g-due').textContent = b.left === 0 ? 'due TONIGHT' : layout.port ? 'due in ' + b.left + (b.left === 1 ? ' day' : ' days') : 'due day ' + b.due + ' (' + b.left + (b.left === 1 ? ' day' : ' days') + ')';
  $('g-billblk').classList.toggle('due', b.left === 0 && st.phase === 'play');
  const bar = $('g-billbar'); bar.firstChild.style.width = Math.min(100, 100 * D.cash / b.amt) + '%'; bar.classList.toggle('short', D.cash < b.amt);
  $('g-cash').textContent = money(D.cash); $('g-earned').textContent = 'Cash · earned ' + money(D.earned);
  renderGhost();
  S.setIntensity(rush || (b.left === 0 && st.phase === 'play') ? 1 : 0);
}
function ghostAt(n) { const g = ctx.ghost; if (!g || !g.by.length) return 0; return g.by[Math.min(n, g.by.length) - 1] || 0; }
function renderGhost() {
  const el = $('g-ghost'); if (!el || !ctx.ghost) return;
  const n = st.days.length, g = n ? ghostAt(n) : 0, me = D.earned;
  $('g-ghostv').textContent = money(g) + (n > ctx.ghost.by.length ? ' (unplugged)' : '');
  el.classList.toggle('ahead', me > g); el.classList.toggle('behind', me < g);
  el.title = 'BurnBot played this exact deck. Through day ' + n + ' it had earned ' + money(g) + '.';
  const g2 = $('g-ghost2'); if (g2) { g2.innerHTML = ic('ghost') + ' BurnBot <b class="num">' + money(g) + '</b> · you <b class="num">' + money(me) + '</b>'; g2.className = 'ghostline ' + (me > g ? 'ahead' : me < g ? 'behind' : ''); }
}
function renderStats() {
  const f = C.forecast(st);
  $('v-aud').textContent = D.aud; $('k-aud').textContent = 'Audience · ~' + f.visitors + ' visit';
  $('v-trust').textContent = D.trust; $('k-trust').textContent = 'Trust · ' + pct(f.conv) + ' buy'; $('m-trust').style.width = D.trust + '%';
  $('v-q').textContent = D.q; $('k-q').textContent = D.q >= 6 ? 'Quality · Featured' : 'Quality · +$' + (Math.floor(D.q / 3)) + ' price'; $('m-q').style.width = (D.q * 10) + '%';
  $('v-burn').textContent = D.burnout + '/10'; $('k-burn').textContent = D.burnout >= 6 ? 'Burnout · −1 energy!' : 'Burnout'; $('m-burn').style.width = (D.burnout * 10) + '%';
  $('s-burn').classList.toggle('hot', D.burnout >= 6);
}
function renderBiz(newUid) {
  const el = $('g-prods');
  el.classList.toggle('many', st.products.length > 4); el.parentNode.classList.toggle('many', st.products.length > 4);
  el.innerHTML = st.products.length ? st.products.map((p, i) => '<div class="prod' + (p.uid === newUid ? ' new' : '') + '" data-i="' + i + '" id="p-' + p.uid + '" title="' + esc(p.n) + '">' + ic(p.kind === 'clone' ? 'copy' : 'prod') + '<span class="pn">' + esc(p.n) + '</span><span class="pp">' + money(C.priceOf(st, p)) + '</span></div>').join('') : '<div class="prod empty">No products yet</div>';
  const t = $('g-tools'); let h = st.tools.map(id => '<button type="button" class="toolb" data-tool="' + id + '" aria-label="' + esc(C.TOOLS[id].n + ': ' + C.TOOLS[id].d) + '" title="' + esc(C.TOOLS[id].n + ': ' + C.TOOLS[id].d) + '">' + ic(A.TOOL_ICON[id] || 'tool') + '</button>').join('');
  for (let i = st.tools.length; i < C.MAX_TOOLS; i++) h += '<span class="toolb emptyt" aria-hidden="true"></span>';
  t.innerHTML = h; t.classList.toggle('many', st.tools.length > 2); t.classList.toggle('none', !st.tools.length);
}
function renderFc() {
  const f = C.forecast(st), el = $('g-fc');
  if (!st.products.length) { el.innerHTML = '<div class="fc-row">' + ic('prod') + ' <b>No products yet.</b> Ship one to start selling.</div>'; return; }
  const est = Math.round(f.perDay);
  el.innerHTML = '<div class="fc-row"><span>Tonight</span><b>' + f.visitors + '</b>' + ic('aud') + '<span class="arrow">×</span><b>' + pct(f.conv) + '</b><span class="arrow">→</span><b>' + (Math.round(f.buyers * 10) / 10) + '</b><span>buyers</span><span class="arrow">≈</span><b style="color:var(--gold)">' + money(est) + '</b></div>' +
    '<div class="fc-next"><span>Next buyer</span><div class="meter"><i style="width:' + Math.round(f.nextBuyer * 100) + '%"></i></div>' + (f.mult < 1 ? '<span style="color:var(--red)">sales ×' + f.mult + '</span>' : '') + '</div>';
}
function renderCpu() {
  const el = $('g-cpu'); const n = Math.max(D.cpu, D.cpuMax);
  let h = ''; for (let i = 0; i < n; i++) h += '<span class="orb' + (i >= D.cpu ? ' used' : '') + '">' + ic('cpu') + '</span>';
  el.innerHTML = h + '<span class="k">' + D.cpu + ' energy</span>';
  el.setAttribute('aria-label', D.cpu + ' energy left');
  if (st) { $('g-deckn').textContent = st.deck.length; $('g-discn').textContent = st.discard.length; }
  const end = $('g-end'); const L = C.legal(st); end.classList.toggle('nudge', st.phase === 'play' && L.length === 1 && !busy);
}
function cardStyle() {
  const n = Math.max(1, st.hand.length);
  if (layout.port) {
    const W = layout.W - 16, cw = Math.floor((W - 21) / 4), ch = clamp(Math.floor((layout.H - 398) / 2), 104, 168);
    return { cw, ch, ah: Math.round(ch * (ch < 130 ? 0.22 : 0.27)), nf: 12, ff: 12, ml: 0, rows: ch * 2 + 9, small: ch < 140 };
  }
  const wrap = $('g-handwrap'); const avail = (wrap ? wrap.clientWidth : layout.W - 260) - 8, hh = layout.short ? 150 : 182;
  let cw = Math.min(128, Math.floor((avail - 8 * (n - 1)) / n)), ml = 8;
  if (cw < 108) { cw = 108; ml = Math.floor((avail - n * cw) / Math.max(1, n - 1)); }
  return { cw, ch: Math.min(hh, Math.round(cw * 1.44)), ah: Math.round(Math.min(hh, cw * 1.44) * .3), nf: cw < 118 ? 13 : 14, ff: cw < 118 ? 12 : 13, ml, small: false };
}
function renderHand() {
  const el = $('g-hand'); if (!el || !st) return;
  const cs = cardStyle();
  el.classList.remove('discarding');
  $('g-handwrap').style.minHeight = cs.rows ? cs.rows + 'px' : '';
  el.style.gap = layout.port ? '' : (cs.ml >= 0 ? cs.ml + 'px' : '0px');
  let k = 0;
  el.innerHTML = st.hand.map((c, i) => {
    const isNew = !shownUids[c.uid]; shownUids[c.uid] = 1;
    const off = C.canPlay(st, i) ? '' : st.phase === 'play' ? C.whyNot(st, i) : 'phase';
    const style = '--cw:' + cs.cw + 'px;--ch:' + cs.ch + 'px;--ah:' + cs.ah + 'px;--nf:' + cs.nf + 'px;--ff:' + cs.ff + 'px;' + (cs.ml < 0 && i > 0 ? 'margin-left:' + cs.ml + 'px;' : '') + (isNew && motionOK ? 'animation-delay:' + (k++ * 70) + 'ms;' : '') + (layout.port ? 'width:auto;height:' + cs.ch + 'px;' : '');
    return cardHTML(c, { uid: c.uid, live: 1, cost: C.costOf(st, c, i), off: off === 'phase' ? '' : off, deal: isNew && motionOK, sel: selected === c.uid, style: style + (cs.small ? '' : '') });
  }).join('');
  el.classList.toggle('small', !!cs.small);
}
function renderMood(m) {
  const bot = $('g-bot'); if (!bot) return;
  if (!m) { const b = billInfo(st.day); const f = C.forecast(st);
    m = st.phase === 'over' ? (st.billsPaid >= 5 ? 'happy' : 'sad') : D.burnout >= 6 ? 'sleepy' : b.left <= 1 && D.cash + f.perDay * (b.left + 1) < b.amt ? 'worried' : 'idle'; }
  if (bot.dataset.mood === m) return; bot.dataset.mood = m;
  bot.innerHTML = A.bot(m, M.owns('skin', P.cos.skin) ? P.cos.skin : 'classic');
}
let sayHold = 0;
function say(html, cls, soft) {
  const b = $('g-bubble'); if (!b) return;
  if (soft && performance.now() < sayHold) return;
  b.className = 'bubble ' + (cls || 'say'); b.innerHTML = '<span>' + html + '</span>'; void b.offsetWidth; b.classList.add('say');
  if (!soft) sayHold = performance.now() + 1200;
}
function pileView(which) {
  if (!st) return; const list = (which === 'deck' ? st.deck.slice().sort((a, b) => C.CARDS[a.id].n.localeCompare(C.CARDS[b.id].n)) : st.discard.slice());
  openOv('<h2>' + (which === 'deck' ? 'Draw pile' : 'Used this cycle') + ' (' + list.length + ')</h2><p class="muted" style="font-size:13px">' + (which === 'deck' ? 'Shown in name order, not draw order. When it runs out, your used cards are shuffled back in.' : 'These get shuffled back into your deck when it runs out.') + '</p><div class="scroll" style="max-height:340px"><div class="grid-cards">' + (list.length ? list.map(c => cardHTML(c, { attr: ' tabindex="-1"' })).join('') : '<p class="muted">Empty.</p>') + '</div></div>', { w: 760 });
}
function toggleMute() { P.set.muted = !P.set.muted; S.setMuted(P.set.muted); M.save(); const b = $('g-mute'); if (b) b.innerHTML = ic(P.set.muted ? 'mute' : 'sound'); if (!P.set.muted) { S.unlock(); musicOn(); S.play('tap'); } toast('<div class="bt" style="font-size:24px">' + (P.set.muted ? 'Muted' : 'Sound on') + '</div>', '', 700); }
function musicOn() { if (P.set.music > 0 && !P.set.muted) S.startMusic(); }

// ---------- input ----------
function onHandClick(e) {
  const el = e.target.closest('.card'); if (!el || !st) return;
  const uid = +el.dataset.uid, i = st.hand.findIndex(c => c.uid === uid); if (i < 0) return;
  if (busy) { pending = { uid }; fast = true; return; }
  // touch on phones: first tap shows the card, second plays it (desktop clicks play at once)
  if (layout.port && touchMode && selected !== uid && C.canPlay(st, i)) { selected = uid; S.play('tap'); el.parentNode.querySelectorAll('.card.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); hoverCard(el); say('<b>' + esc(C.CARDS[st.hand[i].id].n) + ':</b> ' + esc(C.CARDS[st.hand[i].id].d) + ' <i class="muted">Tap again to play.</i>', 'say'); return; }
  selected = -1;
  doAct({ t: 'play', i });
}
function denied(a, e) {
  S.play('deny');
  if (a.t !== 'play') return;
  const c = st.hand[a.i]; const el = c && view.querySelector('.card[data-uid="' + c.uid + '"]');
  if (el) { el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); }
  const d = c && C.CARDS[c.id];
  if (e.why === 'cpu') { say(ic('cpu') + ' Not enough energy for <b>' + esc(d.n) + '</b>. End the day to recharge.', 'bad'); X.pulse($('g-cpu'), 'pulse-bad'); }
  else if (e.why === 'cash') say(ic('cash') + ' <b>' + esc(d.n) + '</b> needs $' + (NEEDCASH[c.id] || '?') + ' cash.', 'bad');
}
async function doAct(a) {
  if (!st) return;
  if (busy) { if (a.t !== 'play') pending = a; fast = true; return; }
  if (a.t === 'play' && a.uid != null) { a = { t: 'play', i: st.hand.findIndex(c => c.uid === a.uid) }; if (a.i < 0) return; }
  if (a.t === 'end' && st.phase !== 'play') return;
  const dayBefore = st.day;
  const E = C.act(st, a);
  if (E.length === 1 && E[0].t === 'denied') { denied(a, E[0]); return; }
  removeCoach(); selected = -1;
  saveLast();
  try { await playEvents(E); } finally { busy = false; fast = false; }
  if (!st) return;
  afterAct(dayBefore);
  if (pending && st && st.phase === 'play') { const p = pending; pending = null; doAct(p.uid != null ? { t: 'play', uid: p.uid } : p); } else pending = null;
}
function afterAct(dayBefore) {
  renderAll();
  if (rush && st.day !== dayBefore) { rush.left = RUSH_SEC; rush.tick = 99; }
  if (st.phase === 'reward' || st.phase === 'draft') showOffers();
  else if (st.phase === 'won') showWon();
  else if (st.phase === 'over') showEnd();
  else coachUpdate();
}

// ---------- the event queue: every rule change gets its moment ----------
const STAT_EL = { aud: 's-aud', trust: 's-trust', q: 's-q', burn: 's-burn', cash: 'g-cashblk', cpu: 'g-cpu' };
const STAT_KEY = { aud: 'aud', trust: 'trust', q: 'q', burn: 'burnout', cash: 'cash', cpu: 'cpu' };
const SRC_NAME = { tipjar: 'Tip jar', stickers: 'Stickers', changelog: 'Changelog', autopost: 'Auto-poster', seo: 'SEO', mailing: 'Mailing list', discord: 'Community', duck: 'Rubber duck', wom: 'word of mouth', savings: 'interest', ghost: 'Ghostwriter', viral: 'viral', night: 'night shift', sponsor: 'sponsor', bundle: 'bundle', tip: 'tip', bounty: 'bounty' };
function banner(title, sub, cls, ms) {
  const el = document.createElement('div'); el.className = 'banner show ' + (cls || ''); el.innerHTML = '<div class="bt">' + title + '</div>' + (sub ? '<div class="bs">' + sub + '</div>' : '');
  const host = $('g-center') || stage; host.querySelectorAll('.banner').forEach(b => b.remove()); host.appendChild(el); setTimeout(() => el.remove(), Math.max(700, (ms || 1000) * (spd() || 0.5)));
}
async function playEvents(E) {
  busy = true; fast = P.set.speed === 0;
  const pace = () => { if (!$('game')) throw new Error('left'); };
  let salesShown = 0, discarded = false, saleN = 0;
  const statUi = () => { renderTop(); renderStats(); renderCpu(); };
  for (const e of E) {
    if (!st || !$('game')) break;
    switch (e.t) {
      case 'play': {
        const el = view.querySelector('.card[data-uid="' + e.c.uid + '"]');
        if (el) { el.classList.add('leaving'); X.burst(el, getComputedStyle(el).getPropertyValue('--c').trim() || '#c6ff3d', 10); }
        D.cpu -= e.cost; renderCpu(); S.play('play', { pitch: 1 + st.today.played.length * 0.04 });
        if (C.CARDS[e.c.id].tag === 'shady') renderMood('money');
        await wait(170); break;
      }
      case 'stat': {
        const k = STAT_KEY[e.k], el = $(STAT_EL[e.k]);
        if (e.k === 'cpu') { D.cpu = e.d === 0 ? 0 : D.cpu + e.d; D.cpuMax = Math.max(D.cpuMax, D.cpu); renderCpu(); if (e.d) { X.float(el, '+' + e.d + ' ' + ic('cpu'), 'good'); S.play('stat', { pitch: 1.2 }); } await wait(160); break; }
        let d = e.d;
        if (e.k === 'cash' && e.src === 'sales') { d -= salesShown; salesShown = 0; }
        D[k] = Math.max(0, D[k] + d); if (e.k === 'cash' && e.d > 0) D.earned += d;
        if (d) {
          const bad = e.k === 'burn' ? d > 0 : d < 0;
          const txt = (d > 0 ? '+' : '−') + (e.k === 'cash' ? '$' : '') + Math.abs(d) + (e.k === 'cash' ? '' : ' ' + ic(e.k === 'burn' ? 'burn' : e.k)) + (e.src && SRC_NAME[e.src] ? ' <small>' + SRC_NAME[e.src] + '</small>' : '');
          X.float(el, txt, e.k === 'cash' && !bad ? 'gold' : bad ? 'bad' : 'good');
          X.pulse(el, bad ? 'pulse-bad' : 'pulse');
          S.play(e.k === 'cash' ? (bad ? 'bad' : 'coin') : bad ? 'bad' : 'stat', { pitch: bad ? 0.8 : 1 + Math.min(0.6, Math.abs(d) / 60) });
        }
        statUi();
        await wait(e.k === 'cash' ? 240 : 200); break;
      }
      case 'draw': S.play('draw', { vol: 0.6 }); await wait(fast ? 0 : 40); break;
      case 'shuffle': say(ic('reroll') + ' Deck empty: used cards shuffled back in.', 'say'); S.play('whoosh'); await wait(320); break;
      case 'combo': banner(esc(e.n), esc(e.sub), e.big ? 'gold' : '', e.big ? 1300 : 1000); S.play('combo', { pitch: e.big ? 1.15 : 1 }); X.burst($('g-bot'), ['#c6ff3d', '#ffcf4a', '#3de0ff'], e.big ? 40 : 22, 'conf'); if (e.big) { X.confetti(70); X.shake(false); } renderMood('wow'); await wait(e.big ? 1000 : 720); break;
      case 'product': renderBiz(e.p.uid); const pe = $('p-' + e.p.uid); X.float(pe || $('g-prods'), '+1 ' + ic('prod') + ' ' + esc(e.p.n), 'good'); X.burst(pe || $('g-prods'), '#c6ff3d', 16); S.play('level'); renderFc(); await wait(380); break;
      case 'upgrade': renderBiz(); X.pulse($('p-' + e.p.uid)); X.float($('p-' + e.p.uid) || $('g-prods'), '+$1', 'gold'); S.play('level'); await wait(300); break;
      case 'price': renderBiz(); X.pulse($('g-prods')); X.float($('g-prods'), '+$1 prices', 'gold'); S.play('coin'); await wait(300); break;
      case 'curse': say(ic('curse') + ' <b>' + esc(C.CARDS[e.id].n) + '</b> added to your deck. ' + esc(C.CARDS[e.id].fx.replace(/\{\w+\}/g, '')), 'bad'); S.play('bad'); X.pulse($('g-deck'), 'pulse-bad'); hintOnce('curse', 'Curses hurt if you still hold them at the end of the day. Play them to clear them.'); await wait(420); break;
      case 'msg': say(esc(e.m), 'say'); await wait(520); break;
      case 'held': { const el = view.querySelector('.card[data-uid="' + e.c.uid + '"]'); if (el) { el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); } say(ic('curse') + ' You held <b>' + esc(C.CARDS[e.c.id].n) + '</b>. It bites.', 'bad'); S.play('bad'); await wait(380); break; }
      case 'discard': if (!discarded) { discarded = true; const h = $('g-hand'); if (h && motionOK) h.classList.add('discarding'); S.play('whoosh'); await wait(260); } break;
      case 'funnel': {
        $('game').classList.add('night'); S.play('night');
        say(ic('aud') + ' Night falls. <b>' + e.visitors + '</b> visitors × ' + pct(e.conv) + ' → <b>' + e.buyers + '</b> ' + (e.buyers === 1 ? 'buyer' : 'buyers') + (st.products.length ? '' : ' (no products to buy!)'), e.buyers ? 'good' : 'say');
        X.pulse($('g-fc')); await wait(e.buyers ? 520 : 700); break;
      }
      case 'sale': {
        const pe = $('g-prods').querySelector('[data-i="' + e.i + '"]');
        D.cash += e.amt; D.earned += e.amt; salesShown += e.amt; saleN++;
        X.float(pe, '+$' + e.amt + (e.n > 1 ? ' <small>' + e.n + '×$' + e.price + '</small>' : ''), 'gold');
        X.coins(pe, $('g-cash'), Math.min(8, e.n + 1), () => { X.pulse($('g-cashblk')); });
        S.play('coin', { pitch: 1 + Math.min(0.8, saleN * 0.07) });
        renderTop(); await wait(170); break;
      }
      case 'firstsale': banner('FIRST SALE!', 'A real stranger paid real money.', 'gold', 1300); S.play('bigcoin'); X.confetti(80); renderMood('money'); await wait(1000); break;
      case 'fade': D.aud = Math.max(0, D.aud + e.d); X.float($('s-aud'), e.d + ' ' + ic('aud') + ' <small>fade</small>', 'dim'); renderStats(); await wait(160); break;
      case 'takedown': say(ic('copy') + ' <b>' + esc(e.p.n) + '</b> got a takedown notice. Gone.', 'bad'); renderBiz(); S.play('bad'); X.shake(false); await wait(560); break;
      case 'event': say((e.good ? ic('star2') : ic('bug')) + ' ' + esc(e.m), e.good ? 'good' : 'bad'); S.play(e.good ? 'event' : 'bad'); renderMood(e.good ? 'happy' : 'worried'); if (!e.good) X.shake(false); await wait(950); break;
      case 'burnout': banner('BURNOUT', 'You crash. No energy tomorrow.', 'bad', 1300); S.play('unplug', { pitch: 1.4 }); X.shake(true); renderMood('sleepy'); await wait(1100); break;
      case 'burnedout': say(ic('burn') + ' Recovering from burnout: no energy today.', 'bad'); await wait(500); break;
      case 'bill': {
        if (e.paid) {
          D.cash = Math.max(0, D.cash - e.amt); renderTop();
          banner('BILL ' + e.cyc + ' PAID', '−' + money(e.amt) + ' · lights stay on', 'gold', 1500);
          X.float($('g-cashblk'), '−' + money(e.amt), 'bad'); S.play('paid'); X.confetti(60); renderMood('happy'); PF.hook('happy');
          await wait(1400);
        } else {
          banner('UNPLUGGED', 'Short ' + money(e.short) + ' on a ' + money(e.amt) + ' bill', 'bad', 1800);
          $('game').classList.add('dead'); S.stopMusic(); S.play('unplug'); X.shake(true); renderMood('sad');
          await wait(1700);
        }
        break;
      }
      case 'won': S.play('win'); X.confetti(150); await wait(500); break;
      case 'day': {
        $('game').classList.remove('night');
        D.cpu = e.cpu; D.cpuMax = e.cpu; D.day = e.day;
        const b = billInfo(e.day);
        if (e.day > 1) { renderTop(); renderCpu(); if (b.left === 0) { say(ic('cash') + ' <b>Bill day!</b> You need ' + money(b.amt) + ' by tonight. You have ' + money(D.cash) + '.', D.cash >= b.amt ? 'good' : 'bad'); S.play('tick'); } else if (!fast) S.play('tick', { vol: 0.4 }); }
        await wait(160); break;
      }
      case 'gotcard': toast('<div class="bt" style="font-size:24px">+ ' + esc(C.CARDS[e.id].n) + '</div><div class="bs">added to your deck</div>', '', 1100); S.play('level'); break;
      case 'gottool': toast('<div class="bt" style="font-size:24px">+ ' + esc(C.TOOLS[e.id].n) + '</div><div class="bs">new tool</div>', '', 1100); S.play('level'); break;
      case 'removed': toast('<div class="bt" style="font-size:24px">− ' + esc(C.CARDS[e.id].n) + '</div><div class="bs">removed from your deck</div>', '', 1100); S.play('whoosh'); break;
      case 'overtime': S.play('combo'); break;
    }
  }
  busy = false;
}

// ---------- offers, win choice, pause ----------
function showOffers() {
  if (ov && ov.dataset.kind === 'offers') closeOv(ov);
  const reward = st.phase === 'reward', s = st;
  const title = reward ? (s.overtime && s.billsPaid > 5 ? 'Overtime bill paid! Pick an upgrade' : 'Bill paid! Pick an upgrade') : 'Mid-cycle draft: add a card';
  const sub = reward ? 'Take a card or a tool, or remove a card to thin your deck.' : 'Pick one card for your deck, or skip to keep it lean.';
  const o = openOv('<h2>' + esc(title) + '</h2><p class="muted" style="font-size:14px">' + sub + '</p><div class="offers">' + s.offers.map((x, i) => '<div class="offer">' + (x.k === 'card' ? cardHTML(x.id, { big: 1, attr: ' data-pick="' + i + '"' }) : toolHTML(x.id, { attr: ' data-pick="' + i + '"' })) + '<span class="muted" style="font-size:12px">' + (i + 1) + '</span></div>').join('') + '</div>' +
    '<div class="row c">' + (s.rerolls > 0 ? '<button type="button" class="btn" data-a="reroll">' + ic('reroll') + ' Reroll (R)</button>' : '') + (reward ? '<button type="button" class="btn" data-a="remove">' + ic('trash') + ' Remove a card</button>' : '') + '<button type="button" class="btn ghostb" data-a="skip">Skip (S)</button></div>', { close: false, w: 640 });
  o.dataset.kind = 'offers';
  o.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { S.play('tap'); X.burst(b, '#c6ff3d', 24, 'conf'); closeOv(o); doAct({ t: 'pick', i: +b.dataset.pick }); });
  const ab = o.querySelector('[data-a=reroll]'); if (ab) ab.onclick = () => { S.play('whoosh'); closeOv(o); doAct({ t: 'reroll' }); };
  o.querySelector('[data-a=skip]').onclick = () => { S.play('tap'); closeOv(o); doAct({ t: 'skip' }); };
  const rb = o.querySelector('[data-a=remove]'); if (rb) rb.onclick = () => { S.play('tap'); removePicker(); };
  if (st.mode === 'tutorial' && !reward && st.day <= 3) coachOn(o.querySelector('.offers'), 'New cards make your deck stronger. Pick one you like.', true);
}
function removePicker() {
  const all = C.allCards(st);
  const o = openOv('<h2>' + ic('trash') + ' Remove a card</h2><p class="muted" style="font-size:13px">A smaller deck draws your best cards more often. Curses are great to remove.</p><div class="scroll" style="max-height:360px"><div class="grid-cards">' + all.map((c, i) => cardHTML(c, { attr: ' data-rm="' + i + '"' })).join('') + '</div></div>', { w: 760 });
  o.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S.play('whoosh'); closeAll(); doAct({ t: 'remove', i: +b.dataset.rm }); });
}
function showWon() {
  S.play('win'); X.confetti(120);
  const o = openOv('<div style="text-align:center"><div class="stamp st-win in">DAY 25!</div></div><h2 style="text-align:center">You paid every bill.</h2><p class="muted" style="text-align:center">Score so far: <b class="num" style="color:var(--gold)">' + money(st.earned) + '</b>. Retire now, or go into overtime: bills double every 5 days, you burn out faster, and your score keeps climbing until you get unplugged.</p><div class="row c"><button type="button" class="btn" data-a="retire">' + ic('trophy') + ' Retire a winner</button><button type="button" class="btn primary" data-a="ot">' + ic('burn') + ' Overtime</button></div>', { close: false, w: 520 });
  o.querySelector('[data-a=retire]').onclick = () => { closeOv(o); doAct({ t: 'retire' }); };
  o.querySelector('[data-a=ot]').onclick = () => { closeOv(o); banner('OVERTIME', 'Bills double every 5 days', 'bad', 1300); doAct({ t: 'overtime' }); };
}
function openPause() {
  if (!st || (ov && ov.dataset.kind === 'pause')) return;
  const o = openOv('<h2>' + ic('pause') + ' Paused</h2><p class="muted" style="font-size:14px">' + esc(ctx.label) + ' · day ' + st.day + ' · ' + money(st.earned) + ' earned</p><div class="list"><button type="button" class="btn primary" data-a="resume">' + ic('play') + ' Resume</button><button type="button" class="btn" data-a="help">' + ic('book') + ' How to play</button><button type="button" class="btn" data-a="settings">' + ic('gear') + ' Settings</button><button type="button" class="btn" data-a="quit">' + ic('close') + ' Save and quit</button>' + (st.mode === 'tutorial' ? '<button type="button" class="btn ghostb" data-a="skiptut">Skip the tutorial</button>' : '<button type="button" class="btn ghostb" data-a="abandon">' + ic('trash') + ' Abandon run</button>') + '</div>', { w: 380 });
  o.dataset.kind = 'pause';
  const on = (a, f) => { const b = o.querySelector('[data-a=' + a + ']'); if (b) b.onclick = () => { S.play('tap'); f(); }; };
  on('resume', () => closeOv(o)); on('help', () => PANELS.help()); on('settings', () => PANELS.settings());
  on('quit', () => { saveLast(); showHub(); });
  on('abandon', () => confirmBox('Abandon this run?', 'It will not count and cannot be continued.', 'Abandon', () => { P.last = null; M.save(); showHub(); }));
  on('skiptut', () => { P.tutorialDone = true; P.last = null; M.save(); showHub(); });
}

// ---------- end of run ----------
function showEnd() {
  if (ov && ov.dataset.kind === 'end') return;
  PF.gameplayStop(); rush = null; removeCoach();
  const s = st, code = C.code(s), g = ctx.ghost, beat = !!(g && s.earned > g.total);
  const prevBest = P.best, prevBoard = ctx.mode === 'tutorial' ? [] : M.boardFor(ctx.mode === 'daily' ? 'daily' : ctx.mode, ctx.seedDay).slice();
  const fin = M.finish(s, { seedDay: ctx.seedDay, code, beatGhost: beat });
  if (fin.won) PF.hook('happy');
  MX.hit('end_' + (s.mode || 'run') + (s.result === 'unplugged' ? '_lost' : '_won'));
  const stamp = s.result === 'won' ? ['st-win', 'RETIRED A WINNER'] : s.result === 'ipo' ? ['st-ipo', 'IPO!'] : s.result === 'overtime' ? ['st-win', 'ALL BILLS PAID!'] : ['st-lose', 'UNPLUGGED'];
  const L = fin.after;
  let left = '<div style="text-align:center"><div class="stamp in ' + stamp[0] + '">' + stamp[1] + '</div></div>' +
    '<p class="muted" style="text-align:center;font-size:13px">' + esc(ctx.label) + ' · ' + esc(founderName(s.founder)) + (s.burn ? ' · Burn ' + s.burn : '') + ' · ' + resultText(s) + ' · ' + s.billsPaid + (s.billsPaid === 1 ? ' bill' : ' bills') + ' paid</p>' +
    '<div style="text-align:center"><div class="lbl">Score (total earned)</div><div class="score num" id="e-score">$0</div><div class="row c" style="margin-top:6px"><span class="chip gold">' + ic('crown') + ' ' + esc(C.rankOf(s.earned)) + '</span>' + (s.earned > prevBest && prevBest > 0 ? '<span class="chip lime">New best!</span>' : '') + (fin.rank === 0 && prevBoard.length ? '<span class="chip lime">#1 on your board</span>' : '') + '</div></div>';
  left += '<div class="row c"><button type="button" class="btn primary" data-a="again">' + ic('play') + (s.mode === 'tutorial' ? ' Continue' : ' Play again') + '</button>' + (s.mode !== 'tutorial' ? '<button type="button" class="btn" data-a="share">' + ic('share') + ' Share</button><button type="button" class="btn" data-a="code">' + ic('copy') + ' Code</button>' : '') + '<button type="button" class="btn ghostb" data-a="hub">' + ic('close') + ' Menu</button></div>';
  if (g) left += '<div class="li ' + (beat ? 'me' : 'bot') + '">' + ic('ghost') + '<span class="grow" style="font-size:14px">' + (beat ? '<b>You beat BurnBot!</b> It made ' + money(g.total) + ' on this deck.' : 'BurnBot made <b>' + money(g.total) + '</b> on this deck. ' + (s.earned >= g.total * 0.8 ? 'So close.' : 'Next time.')) + '</span></div>';
  if (ctx.challenge) { const cs = ctx.challenge.p.score; left += '<div class="li ' + (s.earned > cs ? 'me' : 'bot') + '">' + ic('trophy') + '<span class="grow" style="font-size:14px">' + (s.earned > cs ? '<b>Challenge beaten!</b> ' : 'Challenge: ') + 'your friend scored ' + money(cs) + '.</span></div>'; }
  if (s.mode !== 'tutorial') left += '<div class="li" id="e-pct">' + ic('chart') + '<span class="grow muted" style="font-size:13px">Simulating 240 players on this deck…</span></div>';
  if (s.mode !== 'tutorial' && fin.xp > 0 && PF.canReward()) left += '<div class="row c"><button type="button" class="btn rewb" data-a="rew">\u{1F3AC} Watch an ad: double XP (+' + fin.xp + ')</button></div>';
  if (LINKS.tip) left += '<div class="tipline">Enjoying Burn Rate? It\u2019s free. <a href="' + LINKS.tip + '" target="_blank" rel="noopener">' + ic('coffee') + ' Tip the developer</a></div>';
  let right = '<div><div class="row"><b>+' + fin.xp + ' XP</b><span class="muted" style="margin-left:auto;font-size:13px">Level ' + L.lvl + ' · ' + L.into + '/' + L.need + '</span></div><div class="xpbar" style="margin-top:6px"><i id="e-xp" style="width:' + (fin.levelUps.length ? 0 : Math.round(100 * fin.before.into / fin.before.need)) + '%"></i></div><div class="muted" style="font-size:12px;margin-top:4px">' + fin.xpParts.map(x => esc(x[0]) + ' +' + x[1]).join(' · ') + '</div></div>';
  fin.levelUps.forEach(u => { right += '<div class="li me">' + ic('star2') + '<span class="grow"><b>Level ' + u.lvl + '!</b>' + (u.unlocks.length ? '<br><span class="muted" style="font-size:12px">Unlocked: ' + u.unlocks.map(x => esc(x[3])).join(', ') + '</span>' : '') + '</span></div>'; });
  if (fin.newAch.length) right += '<div class="row">' + fin.newAch.map(a => '<span class="chip lime" title="' + esc(a[2]) + '">' + ic('star2') + ' ' + esc(a[1]) + '</span>').join('') + '</div>';
  if (s.mode === 'daily') right += '<div><div class="lbl" style="margin-bottom:4px">Your last 14 Dailies</div><div class="cal">' + calHTML() + '</div></div>';
  const o = openOv('<div class="endgrid"><div class="endcol">' + left + '</div><div class="endcol">' + right + '</div></div>', { close: false, w: 860, cls: 'endsheet' });
  o.dataset.kind = 'end';
  S.play(fin.won ? 'win' : 'unplug', { vol: fin.won ? 1 : 0.5 }); if (fin.won) X.confetti(140);
  X.count($('e-score'), 0, s.earned, 1200, money, () => { if (s.earned > 0) S.play('bigcoin'); });
  setTimeout(() => { const x = $('e-xp'); if (x) x.style.width = Math.round(100 * L.into / L.need) + '%'; if (fin.levelUps.length) S.play('level'); }, 500);
  if (fin.newAch.length) setTimeout(() => S.play('combo'), 900);
  const on = (a, f) => { const b = o.querySelector('[data-a=' + a + ']'); if (b) b.onclick = () => { S.play('tap'); f(b); }; };
  on('again', () => { const m = ctx.mode, op = ctx.opts; if (m === 'daily') startDaily(); else if (m === 'rush') startRush(); else if (m === 'tutorial') showHub(); else if (ctx.challenge) startChallenge(); else startRun(op.founder, op.burn); });
  on('share', () => shareRun(s, code));
  on('code', () => copyAndSay(code, 'Code copied!'));
  on('hub', () => showHub());
  on('rew', b => { b.disabled = true; PF.gameplayStop(); PF.rewarded(ok => { if (!ok) { b.closest('.row').remove(); return; } // no reward, no nag (portals show their own ad-block messaging)
    const ups = M.grantXp(fin.xp); b.closest('.row').innerHTML = '<span class="chip lime">' + ic('star2') + ' +' + fin.xp + ' bonus XP' + (ups.length ? ' · Level ' + ups[ups.length - 1].lvl + '!' : '') + '</span>'; S.play(ups.length ? 'level' : 'combo');
    const L2 = M.levelOf(P.xp), x = $('e-xp'); if (x) x.style.width = Math.round(100 * L2.into / L2.need) + '%'; }); });
  if (s.mode !== 'tutorial') percentile(ctx.opts, s.earned);
}
function calHTML() {
  let h = ''; const today = todayYmd();
  for (let i = 13; i >= 0; i--) { const d = M.addDays(today, -i), r = P.daily[d]; h += '<i class="' + (r ? (r.won ? 'w' : 'l') : '') + (i === 0 ? ' t' : '') + '" title="' + d + (r && !r.v1 ? ': ' + money(r.score) : '') + '">' + (+d.slice(8)) + '</i>'; }
  return h;
}
function percentile(opts, score) {
  const N = 240, out = []; let k = 0; const myRun = st;
  const step = () => {
    if (st !== myRun) return; const el = $('e-pct'); if (!el) return;
    out.push.apply(out, B.field(opts, 24, k)); k += 24;
    if (k < N) { setTimeout(step, 16); return; }
    const below = out.filter(v => v < score).length, p = Math.round(100 * below / out.length);
    el.innerHTML = ic('chart') + '<span class="grow" style="font-size:14px">Better than <b>' + p + '%</b> of ' + N + ' simulated players on this deck.<br><span class="muted" style="font-size:12px">Simulated: bot players of mixed skill, not real people.</span></span>';
    ctx.pct = p;
  };
  setTimeout(step, 400);
}
function shareText(s, code) {
  const cyc = []; for (let i = 0; i < s.billsPaid; i++) cyc.push('\u{1F7E9}'); if (s.result === 'unplugged' || s.result === 'overtime') cyc.push('\u{1F7E5}');
  let t = 'Burn Rate \u{1F525} ' + modeLabel(ctx) + '\n' + money(s.earned) + ' · ' + C.rankOf(s.earned) + ' · ' + resultText(s) + '\n' + cyc.join('') + (ctx.ghost ? (s.earned > ctx.ghost.total ? ' beat BurnBot' : '') : '') + (ctx.pct != null ? ' · top ' + Math.max(1, 100 - ctx.pct) + '% (simulated)' : '');
  if (LINKS.challenge && LINKS.share) t += '\nBeat me on the same deck: ' + LINKS.share + '?c=' + encodeURIComponent(code);
  else { if (LINKS.share) t += '\nPlay: ' + LINKS.share; t += '\nMy code: ' + code; }
  return t;
}
async function shareRun(s, code) {
  const text = shareText(s, code);
  let blob = null; try { blob = await shareImage(s); } catch (_) {}
  try {
    if (navigator.share) {
      if (blob && typeof File === 'function') { const file = new File([blob], 'burn-rate.png', { type: 'image/png' }); if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; } }
      await navigator.share({ text }); return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const ok = await copyText(text);
  const o = openOv('<h3>' + (ok ? 'Result copied!' : 'Share your run') + '</h3><textarea class="field" rows="5" readonly>' + esc(text) + '</textarea>' + (blob ? '<div class="row c"><button type="button" class="btn" id="sh-img">' + ic('share') + ' Save image</button></div>' : ''), { w: 460 });
  if (ok) S.play('coin');
  const b = o.querySelector('#sh-img'); if (b) b.onclick = () => { try { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'burn-rate-' + (ctx.seedDay || 'run') + '.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); } catch (_) {} };
}
function shareImage(s) {
  return new Promise((res, rej) => {
    const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 630; const g = cv.getContext('2d'); if (!g) return rej();
    const grd = g.createLinearGradient(0, 0, 1200, 630); grd.addColorStop(0, '#14141d'); grd.addColorStop(1, '#0b0b10'); g.fillStyle = grd; g.fillRect(0, 0, 1200, 630);
    g.fillStyle = '#c6ff3d22'; for (let i = 0; i < 12; i++) g.fillRect(0, 60 + i * 50, 1200, 1);
    const F = w => w + ' system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    g.fillStyle = '#e9e6dc'; g.font = F('900 64px'); g.fillText('BURN', 70, 120); g.fillStyle = '#ff7a2a'; g.fillText('RATE', 250, 120);
    g.fillStyle = '#9b98a8'; g.font = F('700 28px'); g.fillText(modeLabel(ctx) + ' · ' + resultText(s), 70, 170);
    g.fillStyle = '#ffcf4a'; g.font = F('900 150px'); g.fillText(money(s.earned), 64, 340);
    g.fillStyle = '#c6ff3d'; g.font = F('900 44px'); g.fillText(C.rankOf(s.earned), 70, 410);
    for (let i = 0; i < 5; i++) { g.fillStyle = i < s.billsPaid ? '#c6ff3d' : (i === s.billsPaid && s.billsPaid < 5 ? '#ff4d5e' : '#2b2b3a'); g.beginPath(); if (g.roundRect) g.roundRect(70 + i * 76, 450, 62, 62, 14); else g.rect(70 + i * 76, 450, 62, 62); g.fill(); }
    g.fillStyle = '#9b98a8'; g.font = F('700 26px'); g.fillText('Bills paid', 70, 555); g.fillText('Pay the power bill or get unplugged.', 70, 595);
    const img = new Image(); const svg = A.bot(s.billsPaid >= 5 ? 'happy' : 'sad', M.owns('skin', P.cos.skin) ? P.cos.skin : 'classic').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="355" ');
    const fin = () => { try { cv.toBlob(b => b ? res(b) : rej(), 'image/png'); } catch (e) { rej(e); } };
    img.onload = () => { try { g.drawImage(img, 720, 150, 420, 355); } catch (_) {} fin(); }; img.onerror = fin;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

// ---------- Rush timer ----------
const RUSH_SEC = 20;
setInterval(() => {
  if (!rush || !st) return; const now = performance.now(), dt = (now - rush.last) / 1000; rush.last = now;
  if (st.phase !== 'play' || busy || ov || PF.isPaused() || document.hidden) return;
  rush.left -= dt; const el = $('g-timer'); if (!el) return;
  const sec = Math.max(0, Math.ceil(rush.left)); $('g-timerv').textContent = sec; el.style.setProperty('--p', Math.max(0, rush.left / RUSH_SEC)); el.classList.toggle('low', rush.left <= 5);
  if (sec <= 5 && sec < rush.tick && sec > 0) { rush.tick = sec; S.play('tick', { pitch: 1 + (5 - sec) * 0.08 }); }
  if (rush.left <= 0) { rush.left = RUSH_SEC; rush.tick = 99; say(ic('clock') + ' Time! Day over.', 'bad'); doAct({ t: 'end' }); }
}, 100);
PF.onPause((paused, why) => {
  S.suspend(paused);
  if (rush) rush.last = performance.now();
  if (paused && why === 'hidden' && rush && st && st.phase === 'play' && !ov) openPause();
});

// ---------- tutorial coach + hints ----------
let coachEl = null, coachTarget = null;
function removeCoach() { if (coachEl) { coachEl.remove(); coachEl = null; } if (coachTarget) { coachTarget.classList.remove('spot'); coachTarget = null; } }
function coachOn(target, text, noSpot) {
  removeCoach(); if (!target) return;
  coachEl = document.createElement('div'); coachEl.className = 'coach'; coachEl.setAttribute('role', 'note'); coachEl.innerHTML = text;
  (ov && ov.contains(target) ? ov : stage).appendChild(coachEl);
  coachTarget = target; if (!noSpot) target.classList.add('spot');
  placeCoach(); setTimeout(placeCoach, 380); setTimeout(placeCoach, 900);
}
function placeCoach() {
  if (!coachEl || !coachTarget) return; const k = layout.k;
  const host = coachEl.parentNode === stage ? stage : coachEl.parentNode;
  const s = host.getBoundingClientRect(), R = e => { const q = e.getBoundingClientRect(); return { l: (q.left - s.left) / k, t: (q.top - s.top) / k, r: (q.right - s.left) / k, b: (q.bottom - s.top) / k }; };
  const T = R(coachTarget), cx = (T.l + T.r) / 2, cy = (T.t + T.b) / 2;
  const W = host === stage ? layout.W : s.width / k, H = host === stage ? layout.H : s.height / k;
  const w = Math.min(300, W - 20); coachEl.style.maxWidth = w + 'px'; coachEl.classList.remove('below', 'left', 'right');
  const cw = coachEl.offsetWidth, ch = coachEl.offsetHeight, G = 14;
  // things the bubble should not cover (besides its own target)
  const obs = [...stage.querySelectorAll('#g-hand .card, #g-end, .deckinfo button, #g-cpu, #g-fc, #g-billblk, #g-cashblk, .stat')].filter(e => e !== coachTarget && !coachTarget.contains(e) && !e.contains(coachTarget) && e.offsetParent).map(e => Object.assign(R(e), { w: e.matches('.card, #g-end') ? 40 : e.matches('#g-cpu, #g-fc, .deckinfo button') ? 2 : 1 }));
  const cost = (x, y) => { let c = 0; if (x < 6 || y < 6 || x + cw > W - 6 || y + ch > H - 6) c += 1e7; for (const o of obs) { const ox = Math.min(x + cw, o.r) - Math.max(x, o.l), oy = Math.min(y + ch, o.b) - Math.max(y, o.t); if (ox > 0 && oy > 0) c += ox * oy * o.w; } return c; };
  const xs = [clamp(cx - cw / 2, 10, W - cw - 10), clamp(T.l, 10, W - cw - 10), clamp(T.r - cw, 10, W - cw - 10)];
  const ys = [clamp(cy - ch / 2, 10, H - ch - 10), clamp(T.t, 10, H - ch - 10)];
  const cand = [];
  xs.forEach((x, i) => { cand.push({ x, y: T.t - ch - G, m: '', p: i * 0.1 }); cand.push({ x, y: T.b + G, m: 'below', p: 0.5 + i * 0.1 }); });
  ys.forEach(y => { cand.push({ x: T.r + G, y, m: 'right', p: 1 }); cand.push({ x: T.l - cw - G, y, m: 'left', p: 1 }); });
  let best = null; for (const c of cand) { c.c = cost(c.x, c.y) + c.p * 40; if (!best || c.c < best.c) best = c; }
  if (best.m) coachEl.classList.add(best.m);
  coachEl.style.left = best.x + 'px'; coachEl.style.top = best.y + 'px';
  if (best.m === 'left' || best.m === 'right') coachEl.style.setProperty('--ay', clamp(cy - best.y, 14, ch - 14) + 'px');
  else coachEl.style.setProperty('--ax', clamp(cx - best.x, 16, cw - 16) + 'px');
}
function cardEl(id) { const c = st.hand.find((x, i) => x.id === id && C.canPlay(st, i)); return c && view.querySelector('.card[data-uid="' + c.uid + '"]'); }
function coachUpdate() {
  removeCoach(); if (!st || st.phase !== 'play' || ov) return;
  const tap = layout.port && touchMode ? 'Tap it twice' : 'Tap it';
  if (st.mode === 'tutorial') {
    const t = st.today, played = t.played;
    if (st.day === 1) {
      if (!st.products.length && cardEl('ship')) return coachOn(cardEl('ship'), 'Ship a product. ' + tap + ' to play it. It costs 2 ' + ic('cpu') + ' energy.');
      if (played.indexOf('post') < 0 && cardEl('post')) return coachOn(cardEl('post'), 'Now tell people! Ship + Launch post on the same day = <b>LAUNCH DAY</b>, double audience.');
      return coachOn($('g-end'), (st.hand.some((c, i) => C.canPlay(st, i)) ? 'Done for today? ' : 'Out of moves. ') + 'End the day: tonight visitors arrive and some of them buy.');
    }
    if (st.day === 2 && !played.length) return coachOn($('g-billblk'), 'Every 5 days the <b>power bill</b> is due. Have the cash at the end of day 5, or you get unplugged.', true);
    if (st.day === 3 && !played.length) return coachOn($('g-fc'), 'Your forecast: visitors × buy rate → buyers. More audience and trust means more sales.', true);
    if (st.day === 4 && !played.length) return coachOn($('s-trust'), 'Trust sets your buy rate. Reply to comments and help people to raise it.', true);
    if (st.day === 5 && !played.length) return coachOn($('g-billblk'), 'Bill day! Sell enough by tonight to cover it.', true);
    return;
  }
  if (!P.set.hints) return;
  if (C.legal(st).length === 1 && st.hand.length && !st.today.played.length) hintOnce('stuck', 'Nothing playable? Press <b>End day</b>. Energy refills tomorrow.');
  if (billInfo(st.day).left === 0) hintOnce('billday', 'Bill day. If you can\u2019t cover the bill tonight, you get unplugged.');
}
function hintOnce(id, html) { if (!P.set.hints || (P.hints && P.hints[id])) return; P.hints = P.hints || {}; P.hints[id] = 1; M.save(); say(ic('book') + ' ' + html, 'say'); sayHold = performance.now() + 2500; }

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  const tg = e.target; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT')) { if (e.key === 'Escape') tg.blur(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  S.unlock();
  if (k === 'm' || k === 'M') { toggleMute(); return; }
  if (k === 'Escape') { if (ov) { if (ov.closable) { closeOv(); S.play('tap'); } } else if (st && st.phase !== 'over') openPause(); return; }
  if (ov && ov.dataset.kind === 'offers') {
    if (/^[1-3]$/.test(k)) { const b = ov.querySelector('[data-pick="' + (+k - 1) + '"]'); if (b) b.click(); }
    else if (k === 'r' || k === 'R') { const b = ov.querySelector('[data-a=reroll]'); if (b) b.click(); }
    else if (k === 's' || k === 'S') { const b = ov.querySelector('[data-a=skip]'); if (b) b.click(); }
    return;
  }
  if (ov || !st) return;
  if (/^[1-8]$/.test(k)) { const c = st.hand[+k - 1]; if (c) { e.preventDefault(); if (busy) { pending = { uid: c.uid }; fast = true; } else doAct({ t: 'play', i: +k - 1 }); } return; }
  if (k === ' ' || k === 'Spacebar' || ((k === 'Enter' || k === 'e' || k === 'E') && (!tg || tg === document.body || !tg.closest('button')))) { e.preventDefault(); if (busy) { fast = true; return; } S.play('tap'); doAct({ t: 'end' }); }
});
// tap anywhere while things animate = fast-forward
stage.addEventListener('pointerdown', e => { if (busy && !e.target.closest('.card')) fast = true; }, true);
// first gesture unlocks audio and starts the music
const firstGesture = () => { S.unlock(); musicOn(); window.removeEventListener('pointerdown', firstGesture, true); window.removeEventListener('keydown', firstGesture, true); };
window.addEventListener('pointerdown', firstGesture, true); window.addEventListener('keydown', firstGesture, true);

// ---------- boot ----------
let legacyLink = false;
function readChallenge() {
  let c = null; try { c = new URLSearchParams(location.search).get('c'); } catch (_) {}
  if (!c) return; let v; try { v = C.verify(c); } catch (_) { v = null; } if (!v || !v.ok) { legacyLink = true; return; }
  challenge = { code: c, p: v.p, s: v.s, day: v.p.mode === 'daily' ? dayOfSeed(v.p.seed) : null };
}
function boot() {
  P = M.load(); P.hints = P.hints || {};
  X.init(stage, $('fxc'));
  applySettings(); fit();
  try { readChallenge(); } catch (_) {}
  try { MX.boot(P, M); } catch (_) {}
  // old (classic) links: ?seed=, ?daily, unknown ?c= codes -> ignore quietly, or open today's Daily
  let q = null; try { q = new URLSearchParams(location.search); } catch (_) {}
  const wantDaily = !!(q && !challenge && (q.has('daily') || q.has('seed') || q.has('beat') || q.has('deck') || legacyLink));
  if (q && [...q.keys()].length && !challenge) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (_) {} }
  if (!P.tutorialDone && !P.last && !challenge && (P.runs || 0) === 0 && !P.legacy) startTutorial(); else if (wantDaily && !P.last) { showHub(); startDaily(); } else showHub();
  const ld = $('loader'); if (ld) { ld.classList.add('done'); setTimeout(() => { ld.hidden = true; }, 350); }
  PF.hook('ready');
  window.BURN_DEBUG = { get st() { return st; }, get busy() { return busy; }, get ov() { return ov; }, act: doAct, hub: showHub, startDaily, startRush, startRun, startTutorial, C, B, M, layout: () => layout, renderAll };
}
try { boot(); } catch (e) { console.error(e); PF.showError(e && e.message); }
})();
