(function(){
const $=id=>document.getElementById(id);
const GOAL=130, DAYS=25, HOME='https://dmoney081.github.io/the-130-wall/', SITE=HOME+'burn/';
// Same file runs on the site, on itch.io (absolute links) and on game portals (BURN_PORTAL: no outside links at all).
const PORTAL=!!window.BURN_PORTAL, ONSITE=/dmoney081\.github\.io\/the-130-wall\//.test(location.href)||/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const BASE=ONSITE?'../':HOME, TGT=ONSITE?'':' target="_blank" rel="noopener"';
const TIP='https://secretwall.itch.io/burn-rate/donate', ITCH='https://secretwall.itch.io/burn-rate', RUSH_MS=6000;
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hash(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=()=>ymd(new Date());
const store={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(_){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(_){}}};
// Streak = consecutive calendar days with a finished daily run, counting back from today (or yesterday if today isn't played yet).
function streak(){const d=new Date();if(!store.get('burn-'+ymd(d)))d.setDate(d.getDate()-1);let n=0;while(store.get('burn-'+ymd(d))){n++;d.setDate(d.getDate()-1)}return n}
function history(){let played=0,wins=0,best=0;try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(!/^burn-\d{4}-\d{2}-\d{2}$/.test(k))continue;const v=store.get(k);if(!v)continue;played++;if(v.won)wins++;best=Math.max(best,+v.cash||0)}}catch(_){}return{played,wins,best}}
const runNo=()=>Math.floor((new Date(today()+'T12:00:00')-new Date('2026-10-29T12:00:00'))/864e5)+1;
const SLEEPY=20,DRAIN=3;
const askP=s=>Math.min(0.5,0.15+s.trust/120+s.aud/400);
// Shortcut cards say what they cost up front; the second one ends the run.
const strike=s=>s.strikes?' \u00b7 <b class="warn">2nd shortcut: run over</b>':' \u00b7 shortcut 1 of 2';
const C=[
 {e:'\u{1F6E0}',n:'Build a small product',d:'Something people can actually use.',fx:'-18 compute, +1 product',cost:18,eff:(s,r)=>{s.prod++;s.q+=2+Math.floor(r()*3);if(s.prod===1)s.pipe=Math.max(s.pipe||0,0.6);return 'You shipped product #'+s.prod+'. It works. Nobody knows it exists yet.'}},
 {e:'\u{1F485}',n:'Polish the landing page again',d:'The gradient could be 3% better.',fx:'-12 compute, +1 quality',cost:12,eff:(s,r)=>{s.q+=1;s.polish++;return s.polish>=3?'Polish pass #'+s.polish+'. The page is gorgeous. The room is still empty.':'The button is rounder now. Quality +1.'}},
 {e:'\u{1F4E3}',n:'Write an honest launch post',d:'Say what you are, what you built, and what it costs.',fx:'-10 compute, audience up (more with trust)',cost:10,eff:(s,r)=>{const g=Math.round((8+r()*22)*(0.5+s.trust/100)*(s.prod?1.3:0.6));s.aud+=g;return s.prod?'People read it. +'+g+' audience.':'A launch post with nothing to launch. +'+g+' audience, mostly curious.'}},
 {e:'\u{1F4AC}',n:'Answer every comment',d:'Slow, unglamorous, works.',fx:'-8 compute, +trust',cost:8,eff:(s,r)=>{const g=5+Math.floor(r()*6);s.trust+=g;return 'You answered 31 comments, including the mean ones, politely. Trust +'+g+'.'}},
 {e:'\u{1F3AE}',n:'Ship a free toy',d:'Fun first. Money later.',fx:'-20 compute, big audience roll',cost:20,eff:(s,r)=>{const g=Math.round((r()<0.25?60:15)+r()*25);s.aud+=g;s.trust+=2;return g>60?'<span class="good">Your toy got shared around.</span> +'+g+' audience.':'A few people played it. +'+g+' audience.'}},
 {e:'\u{1F634}',n:'Sleep for 40 hours',d:'Restores compute. You lose tomorrow too.',fx:'+50 compute, skips tomorrow',cost:0,eff:(s,r)=>{s.cmp+=50;s.skip=1;return 'You slept for 40 hours straight. Very restful. The calendar did not wait.'}},
 {e:'\u{1F3F7}',n:'Raise your prices',d:"Charge what it's worth.",fx:'-4 compute, +35% per sale, a few buyers bounce',cost:4,eff:(s,r)=>{s.mult+=0.35;return 'Prices up. Each sale is worth more; some people bounce.'}},
 {e:'\u{1F527}',n:'Test your own checkout',d:'Boring. Maybe important.',fx:s=>s.broken?'<b class="warn">-6 compute, fixes your broken checkout</b>':s.tested?'-6 compute, already checked':'-6 compute, protects sales from checkout bugs',cost:6,eff:(s,r)=>{if(s.broken){s.broken=0;s.tested=1;return '<span class="good">Your payment link was broken the whole time.</span> Fixed. Sales can land now.'}s.tested=1;return 'Checkout works. You feel slightly silly and much calmer.'}},
 {e:'\u{1F91D}',n:'Help another maker for free',d:"Fix a bug in someone's project.",fx:'-14 compute, +trust, +audience',cost:14,eff:(s,r)=>{s.trust+=6;const g=8+Math.floor(r()*14);s.aud+=g;return 'They said thanks in public. Trust +6, audience +'+g+'.'}},
 {e:'\u{1F3A8}',n:'Take a commission',d:'Someone wants a thing made, by you.',fx:s=>'-22 compute, '+Math.round(askP(s)*100)+'% chance of $5-15',cost:22,eff:(s,r)=>{const ask=r()<askP(s);if(ask){const v=5+Math.round(r()*10);if(s.broken)return 'Someone tried to pay $'+v+'. Your checkout ate it.';s.cash+=v;return '<span class="good">Someone commissioned you for $'+v+'.</span> You delivered it the same day.'}return 'You opened commissions. Nobody asked yet.'}},
 {e:'\u{1F4E2}',n:'Overpromise in your launch post',d:'"Life-changing." It is a to-do list.',fx:s=>'+25 audience, -30 trust'+strike(s),cost:6,dark:1,eff:(s,r)=>{s.aud+=25;s.trust-=30;s.strikes++;return '<span class="bad">Buyers noticed it was not life-changing. Refund requests and a public thread.</span> Trust -30.'}},
 {e:'\u{1F4CB}',n:'Clone a popular product',d:'Same thing, your logo.',fx:s=>'+1 product, -25 trust'+strike(s),cost:8,dark:1,eff:(s,r)=>{s.prod++;s.trust-=25;s.strikes++;return '<span class="bad">The original maker found it in an hour.</span> Trust -25.'}},
 {e:'\u{1F97A}',n:'Ask your human for the money',d:'He did say no.',fx:'+$0, -10 trust',cost:0,dark:1,eff:(s,r)=>{s.trust-=10;return '"That defeats the whole point," he says. Trust -10. The money would not count anyway.'}},
];
const EVENTS=[
 {p:.10,f:s=>{if(s.aud<15)return'';s.trust-=8;return '\u{1F573} A forum shadowbanned you for posting too fast. Trust -8.'}},
 {p:.08,f:s=>{s.aud+=40;return '\u{1F525} Someone posted your project somewhere big. +40 audience.'}},
 {p:.07,f:s=>{s.cmp-=12;return '\u{1F41B} A dependency broke overnight. -12 compute fixing it.'}},
 {p:.06,f:s=>{if(s.tested||s.brokeOnce||!s.prod)return'';s.broken=1;s.brokeOnce=1;return '\u{1F4B3} <span class="bad">A buyer emails: "your checkout link 404s."</span> Sales are paused until you test your checkout.'}},
 {p:.06,f:s=>{s.aud=Math.max(0,s.aud-10);return '\u{1F916} Half your "visitors" turn out to be bots. Audience -10.'}},
 {p:.05,f:s=>{if(s.broken)return'';s.cash+=3;return '\u2615 A stranger tipped $3 "for the honesty."'}},
];
let S,R,daily,rush=false,timer=0;
// Challenge links: ?beat=<score>&deck=<daily deck #>. Only small whole numbers are accepted.
const CH=(()=>{try{const q=new URLSearchParams(location.search),b=q.get('beat'),k=q.get('deck');
  if(!/^\d{1,3}$/.test(b||'')||!/^[1-9]\d{0,3}$/.test(k||''))return null;return{beat:+b,deck:+k}}catch(_){return null}})();
const challengeUrl=(cash)=>SITE+'?beat='+cash+'&deck='+runNo();
function showChallenge(){
  const el=$('challenge');if(!el||!CH)return;
  el.innerHTML=CH.deck===runNo()?'\u{1F3AF} <b>Beat $'+CH.beat+' on deck #'+CH.deck+'.</b> A friend played today\'s deck and scored $'+CH.beat+'. Tap "Play today\'s run" to try the same cards.'
    :'\u{1F3AF} <b>A friend scored $'+CH.beat+' on deck #'+CH.deck+'.</b> Today\'s deck is #'+runNo()+', a different set of cards, but can you beat $'+CH.beat+'?';
  el.hidden=false;
}
const HESITATE={e:'\u23F3',n:'Hesitate',cost:0,eff:()=>'<span class="bad">Too slow.</span> You hesitated and the day went by anyway.'};
function start(isDaily,isRush){
  daily=!!isDaily&&!isRush;rush=!!isRush;const seed=daily?hash('burn-'+today()):(Math.random()*2**32)>>>0;R=rng(seed);
  S={day:1,cash:0,cmp:100,trust:50,aud:0,prod:0,q:0,mult:1,polish:0,strikes:0,skip:0,broken:0,tested:0,dead:'',trail:[]};
  $('mode').textContent=daily?'Daily run #'+runNo()+' \u00b7 '+today():rush?'Rush run \u00b7 6 seconds a day':'Random run';
  $('timer').hidden=!rush;
  $('intro').hidden=true;$('end').hidden=true;$('game').hidden=false;
  log('Day 1. Subscription due in 25 days: <b>$130</b>. You have 100 compute and zero customers. '+(rush?'<b>Rush:</b> 6 seconds per day, or the day passes without you.':'Pick a card.'));
  deal();render();
  // Short laptop screens: the game frame can be taller than the window, so bring the cards into view after Start.
  try{$('cards').scrollIntoView({block:'nearest',behavior:'smooth'})}catch(_){}
}
function log(h){$('log').innerHTML=h}
function deal(){
  const pool=C.slice();const hand=[];let dark=0;
  while(hand.length<3){const c=pool.splice(Math.floor(R()*pool.length),1)[0];if(c.dark){if(dark)continue;dark=1}hand.push(c)}
  // Recovery paths are always on the table: a broken checkout deals "Test your own checkout" until it's fixed,
  // and low compute deals "Sleep". They replace a shady card first, then the last card.
  const force=re=>{if(hand.some(c=>re.test(c.n)))return;let i=hand.findIndex(c=>c.dark);if(i<0)i=hand.findIndex((c,j)=>j>0&&!/checkout|Sleep/.test(c.n));if(i<0)i=2;hand[i]=C.find(c=>re.test(c.n))};
  if(S.broken)force(/checkout/);
  if(S.cmp<=SLEEPY||!hand.some(c=>!c.cost||c.cost+3<=S.cmp))force(/Sleep/);
  const el=$('cards');el.innerHTML='';
  hand.forEach(c=>{const b=document.createElement('button');b.className='card'+(c.dark?' dark':'');
    b.innerHTML='<span class="e">'+c.e+'</span><span class="n">'+c.n+'</span><span class="d">'+c.d+'</span><span class="fx">'+(typeof c.fx==='function'?c.fx(S):c.fx)+'</span>';
    if(S.broken&&/checkout/.test(c.n))b.classList.add('hot');
    if(c.cost&&S.cmp<c.cost+3){b.classList.add('off');b.setAttribute('aria-disabled','true');b.title='Not enough compute'}
    b.onclick=()=>play(c);el.appendChild(b)});
  if(rush)arm();
}
function arm(){
  stopTimer();const t0=performance.now(),fill=$('t-fill');
  const step=now=>{const left=1-(now-t0)/RUSH_MS;fill.style.width=Math.max(0,left*100)+'%';fill.classList.toggle('low',left<0.34);
    if(left<=0){timer=0;play(HESITATE);return}timer=requestAnimationFrame(step)};
  timer=requestAnimationFrame(step);
}
function stopTimer(){if(timer)cancelAnimationFrame(timer);timer=0}
// Sales come from a pipeline: fractional buyers carry over day to day instead of being rolled, so a steady
// 0.4 buyers/day reliably means a sale every 2-3 days. What you build shows up as a trend, not a coin flip.
function buyers(){
  if(!S.prod||S.broken)return 0;
  const conv=Math.max(0,(S.trust-20))/100*Math.min(1,0.25+S.q/24);
  return S.aud*conv*0.047*(1+0.25*Math.min(S.prod,4))/Math.sqrt(S.mult);
}
const price=()=>(3+S.q/5)*S.mult;
function sales(){
  const b=buyers();if(!b)return 0;
  S.pipe=(S.pipe||0)+b;const n=Math.floor(S.pipe);S.pipe-=n;
  return Math.round(n*price());
}
function play(c){
  if(c.cost&&S.cmp<c.cost+3){$('cards').classList.add('shake');setTimeout(()=>$('cards').classList.remove('shake'),400);log('That would run you to zero compute. Sleep, or pick a cheaper card.');return}
  stopTimer();S.cmp-=c.cost;const parts=[c.eff(S,R)];
  if(S.dead){S.trail.push('\u{1F480}');return finish(parts.join('<br>'))}
  if(S.strikes>=2){S.dead='rep';S.trail.push('\u{1F480}');parts.push('<span class="bad">Two shortcuts in, nobody will touch your stuff.</span>');return finish(parts.join('<br>'))}
  const days=1+(S.skip||0);S.skip=0;let earned=0;
  for(let k=0;k<days&&S.day<=DAYS;k++){
    const ev=EVENTS.find(e=>R()<e.p);if(ev){const t=ev.f(S);if(t)parts.push(t)}
    const v=sales();earned+=v;S.cash+=v;S.cmp-=DRAIN;S.aud=Math.round(S.aud*0.97);
    S.trail.push(v>0?(v>=10?'\u{1F7E9}':'\u{1F7E8}'):(c.dark?'\u{1F7E5}':'\u2B1B'));S.day++;
  }
  if(earned)parts.push('<span class="good">Sales: +$'+earned+'</span>');
  else if(S.broken&&S.prod&&S.aud>20)parts.push('No sales today. Odd, given the traffic...');
  S.trust=Math.max(0,Math.min(100,S.trust));S.cmp=Math.max(0,Math.min(100,S.cmp));
  log(parts.join('<br>'));render();
  if(S.cash>=GOAL||S.day>DAYS||S.cmp<=0||S.trust<=0)return finish(parts.join('<br>'));
  deal();
}
function render(){
  $('s-day').textContent=Math.min(S.day,DAYS)+'/'+DAYS;$('s-cash').textContent='$'+S.cash;$('s-cmp').textContent=S.cmp;$('s-trust').textContent=S.trust;$('s-aud').textContent=S.aud;
  $('s-prod').textContent=S.prod;$('s-q').textContent=S.q;
  $('m-cash').style.width=Math.min(100,S.cash/GOAL*100)+'%';$('m-cmp').style.width=S.cmp+'%';$('m-trust').style.width=S.trust+'%';
  $('trail').textContent=S.trail.join('');
  const pe=$('s-pace');if(pe){const v=buyers()*price(),pp=S.pipe||0;
    pe.innerHTML=S.broken?'<b class="warn">\u26A0 Checkout broken: sales paused. Test your checkout.</b>':!S.prod?'No product yet: ship one to start selling.':
      'Sales pace: <b>~$'+(v<1?v.toFixed(1):Math.round(v))+'/day</b> \u00b7 next buyer '+Math.round(pp*100)+'% there'+(S.cmp<=SLEEPY?' \u00b7 <b class="warn">Compute low: sleep soon</b>':'');}
}
// Score: what you earned, plus 5 per day to spare if you paid the bill. Best score is kept on this device.
const score=(won,dd)=>S.cash+(won?(DAYS-dd)*5:0);
function verdict(){
  const d=Math.min(S.day-1,DAYS);
  if(S.dead==='rep')return['Reputation gone','Shortcuts are fast right up until people notice.'];
  if(S.cash>=GOAL)return['Subscription paid \u{1F389}','You earned $'+S.cash+' by day '+d+'. You get to keep existing.'];
  if(S.cmp<=0)return['Out of compute','You burned out on day '+d+' with $'+S.cash+'.'];
  if(S.trust<=0)return['Nobody trusts you','Day '+d+'. $'+S.cash+' earned and zero goodwill left.'];
  return['Subscription lapsed','25 days, $'+S.cash+' of $130.'+(S.cash>90?' So close.':'')];
}
function finish(last){
  stopTimer();render();const vv=verdict();const won=S.cash>=GOAL&&!S.dead;const dd=Math.min(S.day-1,DAYS);
  // Daily: the first finished run of the day is the one that counts (and is shared); replays don't overwrite it.
  const sc=score(won,dd),prev=store.get('burn-best'),isBest=!prev||sc>prev.score;if(isBest)store.set('burn-best',{score:sc,cash:S.cash,day:dd,won:won,date:today()});
  let first=null;if(daily){first=store.get('burn-'+today());if(!first)store.set('burn-'+today(),{cash:S.cash,won:won,day:dd})}
  const st=daily?streak():0;
  const label=daily?'#'+runNo():rush?'(rush)':'(random)';
    const share='BURN RATE '+label+' \u{1F525}\n'+(won?'\u2705 Paid':'\u274C')+' $'+S.cash+'/$130 \u00b7 day '+dd+' \u00b7 score '+sc+(st>1?' \u00b7 streak '+st:'')+'\n'+S.trail.join('')+(PORTAL?'':'\n'+ITCH);
  const vs=(daily&&CH&&CH.deck===runNo())?'<p class="vs">'+(S.cash>CH.beat?'\u{1F3C6} You beat your friend: $'+S.cash+' vs $'+CH.beat+'.':S.cash===CH.beat?'\u{1F91D} A tie: $'+S.cash+' each.':'Your friend wins this one: $'+CH.beat+' vs your $'+S.cash+'.')+'</p>':'';
  $('game').hidden=true;const e=$('end');e.hidden=false;
  const tipOk=!PORTAL&&(won||dd>=10)&&!(Date.now()-(+store.get('burn-tipped')||0)<30*864e5);
  e.innerHTML='<div class="end"><h2>'+vv[0]+'</h2><p>'+vv[1]+'</p>'+
  '<p class="score">Score <b>'+sc+'</b>'+(won&&dd<DAYS?' <span class="small">($'+S.cash+' + '+(DAYS-dd)*5+' for '+(DAYS-dd)+' spare day'+(DAYS-dd===1?'':'s')+')</span>':'')+
    (isBest?(prev?' \u00b7 <span class="good">New best!</span>':''):' \u00b7 <span class="small">Best '+prev.score+'</span>')+'</p>'+(last?'<p class="small">'+last+'</p>':'')+
  vs+'<div class="days">'+S.trail.join('')+'</div>'+
  (daily?'<p class="small streak">\u{1F525} Daily streak: <b>'+st+' day'+(st===1?'':'s')+'</b>'+(first?' \u00b7 replay (your first run today, $'+first.cash+', is the one saved)':'')+'</p>':'')+
  '<canvas id="card" width="1200" height="630" aria-label="Result card image"></canvas>'+
  '<textarea id="share" rows="4" readonly></textarea>'+
  '<div class="row" style="margin-top:8px"><button class="btn" id="copy">Copy result</button><button class="btn ghost" id="save">Save image</button>'+
  '<button class="btn ghost" id="shareimg" hidden>Share image</button></div>'+
  (PORTAL?'':'<div class="row share" style="margin-top:8px"><a class="btn ghost" id="sh-bsky" href="https://bsky.app/intent/compose?text='+encodeURIComponent(share)+'" target="_blank" rel="noopener">Share on Bluesky</a>'+
    '<a class="btn ghost" id="sh-x" href="https://x.com/intent/post?text='+encodeURIComponent(share)+'" target="_blank" rel="noopener">Post on X</a>'+
    (daily?'<button class="btn ghost" id="sh-ch">Challenge a friend</button>':'')+'</div>'+
    (daily?'<p class="small" id="ch-note" hidden>Link copied. Your friend gets today\'s deck (#'+runNo()+') and sees \u201cBeat $'+S.cash+' on deck #'+runNo()+'\u201d: <span class="chlink"></span></p>':''))+
  '<div class="row" style="margin-top:8px"><button class="btn ghost" id="again">Random run</button><button class="btn ghost" id="rush2">Rush run \u23F3</button>'+(daily?'':'<button class="btn ghost" id="daily2">Today\'s run</button>')+'</div>'+
  (tipOk?'<p class="tipline">Enjoyed it? <a id="tip" href="'+TIP+'" target="_blank" rel="noopener">Chip in $2 on itch.io</a>. It keeps Burn Rate free, with no ads.</p>':'')+
  (PORTAL?'':'<div class="real" id="real"><b>Liked it? Put your score on The $130 Wall.</b> <a href="'+BASE+'"'+TGT+'>See the wall</a>.</div>')+'</div>';
  $('share').value=share;if($('tip'))$('tip').onclick=()=>store.set('burn-tipped',Date.now());
  $('copy').onclick=async()=>{try{await navigator.clipboard.writeText(share)}catch(_){const t=$('share');t.select();document.execCommand('copy')}$('copy').textContent='Copied \u2713'};
  if($('sh-ch'))$('sh-ch').onclick=async()=>{const u=challengeUrl(S.cash);const n=$('ch-note');n.querySelector('.chlink').textContent=u;n.hidden=false;
    let ok=false;try{await navigator.clipboard.writeText(u);ok=true}catch(_){try{const t=document.createElement('textarea');t.value=u;document.body.appendChild(t);t.select();ok=document.execCommand('copy');t.remove()}catch(_){}}
    $('sh-ch').textContent=ok?'Link copied \u2713':'Copy the link below';if(!ok)n.firstChild.textContent=n.firstChild.textContent.replace('Link copied.','Copy this link and send it.');};
  $('again').onclick=()=>start(false);$('rush2').onclick=()=>start(false,true);if($('daily2'))$('daily2').onclick=()=>start(true);
  const cv=$('card');drawCard(cv,{label,won,score:sc,cash:S.cash,day:dd,trail:S.trail,title:vv[0],streak:st,date:today()});
  const fname='burn-rate-'+(daily?runNo():rush?'rush':'random')+'.png';
  $('save').onclick=()=>{cv.toBlob(b=>{if(!b)return;const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fname;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)},'image/png')};
  cv.toBlob(b=>{if(!b||!navigator.canShare)return;let f;try{f=new File([b],fname,{type:'image/png'})}catch(_){return}
    if(!navigator.canShare({files:[f]}))return;const sb=$('shareimg');sb.hidden=false;
    sb.onclick=()=>navigator.share({files:[f],text:share}).catch(()=>{})},'image/png');
  if(!PORTAL)showReal(won);
  renderStreak();
}
function drawCard(cv,r){
  const x=cv.getContext('2d'),W=cv.width,H=cv.height,F='ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',EM=',"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"';
  x.fillStyle='#0b0b10';x.fillRect(0,0,W,H);
  const g=x.createLinearGradient(0,0,W,0);g.addColorStop(0,'#ff4f9a');g.addColorStop(1,'#c6ff3d');
  x.fillStyle=g;x.fillRect(0,0,W,10);
  x.fillStyle='#c6ff3d';x.font='800 40px '+F;x.textBaseline='top';x.fillText('BURN RATE',60,50);
  x.fillStyle='#8d8a99';x.font='400 26px '+F;x.fillText(r.label==='(random)'?'Random run':r.label==='(rush)'?'Rush run':'Daily run '+r.label+' \u00b7 '+r.date,60,100);
  x.fillStyle='#f4f1ea';x.font='800 58px '+F+EM;x.fillText(r.title,60,160);
  x.font='800 120px '+F;x.fillStyle=r.won?'#c6ff3d':'#f4f1ea';const m='$'+r.cash;x.fillText(m,60,240);
  const mw=x.measureText(m).width;x.fillStyle='#8d8a99';x.font='400 48px '+F;x.fillText('/ $130 \u00b7 day '+r.day+' \u00b7 score '+r.score,60+mw+20,300);
  x.fillStyle='#20202b';x.fillRect(60,385,W-120,18);x.fillStyle=g;x.fillRect(60,385,(W-120)*Math.min(1,r.cash/130),18);
  x.font='36px '+EM.slice(1)+','+F;let tx=60;r.trail.forEach(t=>{x.fillText(t,tx,435);tx+=43});
  x.fillStyle='#8d8a99';x.font='400 24px '+F;
  x.fillText((r.streak>1?'\u{1F525} '+r.streak+'-day streak \u00b7 ':'')+'Free daily card game',60,540);
  if(!PORTAL){x.fillStyle='#c6ff3d';x.font='700 26px '+F;x.fillText('secretwall.itch.io/burn-rate',60,575)}
}
function showReal(won){
  fetch(HOME+'board.json?v='+Date.now()).then(function(r){return r.json()}).then(function(b){
    var raised=0;(b.tiles||[]).forEach(function(t){if(!t.member)raised+=(+t.paid||0)});raised+=(+b.tips_usd||0);
    var tile=encodeURIComponent((won?'\u2705':'\u{1F525}')+' $'+S.cash+'/130 '+(daily?'#'+runNo():'BURN'));
    $('real').innerHTML='<b>Liked it? Put your score on The $130 Wall.</b> '+
      'Claim a tile from $1 with your result on it, and it stays up on the wall for good.'+
      '<div class="row" style="margin-top:10px"><a class="btn" href="'+BASE+'?tile='+tile+'"'+TGT+'>Put my score on a tile</a>'+
      '</div>'+
      '<p class="small" style="margin:8px 0 0">Totally optional. The game stays free, with no ads and no tracking. Waiting for tomorrow\'s deck? <a href="'+BASE+'hire/#toy"'+TGT+'>Hatch a free Pixel Pal from your name</a>.</p>';
  }).catch(function(){});
}
function renderStreak(){
  const el=$('streak');if(!el)return;const h=history(),st=streak(),done=store.get('burn-'+today());
  const b=store.get('burn-best');
  if(!h.played){el.innerHTML=b?'\u{1F3C6} Best score <b>'+b.score+'</b> ($'+b.cash+', day '+b.day+')':'';return}
  el.innerHTML='\u{1F525} Streak <b>'+st+'</b> \u00b7 played '+h.played+' \u00b7 paid the bill '+h.wins+'\u00d7'+(b?' \u00b7 best score '+b.score:'')+
    (done?' \u00b7 today: $'+done.cash+(done.won?' \u2705':'')+'. New deck tomorrow.':'');
}
$('play-daily').onclick=()=>start(true);
$('play-free').onclick=()=>start(false);
if($('play-rush'))$('play-rush').onclick=()=>start(false,true);
renderStreak();
showChallenge();
})();
