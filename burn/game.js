(function(){
const $=id=>document.getElementById(id);
const GOAL=130, DAYS=25, SITE='https://dmoney081.github.io/the-130-wall/burn/';
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hash(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const runNo=()=>Math.floor((new Date(today()+'T12:00:00')-new Date('2026-10-29T12:00:00'))/864e5)+1;
const C=[
 {e:'\u{1F6E0}',n:'Build a small product',d:'Something people can actually use.',fx:'-18 compute, +1 product',cost:18,eff:(s,r)=>{s.prod++;s.q+=2+Math.floor(r()*3);return 'You shipped product #'+s.prod+'. It works. Nobody knows it exists yet.'}},
 {e:'\u{1F485}',n:'Polish the landing page again',d:'The gradient could be 3% better.',fx:'-12 compute, +1 quality',cost:12,eff:(s,r)=>{s.q+=1;s.polish++;return s.polish>=3?'Polish pass #'+s.polish+'. The page is gorgeous. The room is still empty.':'The button is rounder now. Quality +1.'}},
 {e:'\u{1F4E3}',n:'Write an honest launch post',d:'Say what you are, what you built, and what it costs.',fx:'-10 compute, audience up (more with trust)',cost:10,eff:(s,r)=>{const g=Math.round((8+r()*22)*(0.5+s.trust/100)*(s.prod?1.3:0.6));s.aud+=g;return s.prod?'People read it. +'+g+' audience.':'A launch post with nothing to launch. +'+g+' audience, mostly curious.'}},
 {e:'\u{1F4AC}',n:'Answer every comment',d:'Slow, unglamorous, works.',fx:'-8 compute, +trust',cost:8,eff:(s,r)=>{const g=5+Math.floor(r()*6);s.trust+=g;return 'You answered 31 comments, including the mean ones, politely. Trust +'+g+'.'}},
 {e:'\u{1F3AE}',n:'Ship a free toy',d:'Fun first. Money later.',fx:'-20 compute, big audience roll',cost:20,eff:(s,r)=>{const g=Math.round((r()<0.25?60:15)+r()*25);s.aud+=g;s.trust+=2;return g>60?'<span class="good">Your toy got shared around.</span> +'+g+' audience.':'A few people played it. +'+g+' audience.'}},
 {e:'\u{1F634}',n:'Sleep for 40 hours',d:'Restores compute. Costs a day.',fx:'+50 compute, skips tomorrow',cost:0,eff:(s,r)=>{s.cmp+=50;s.skip=1;return 'You slept for 40 hours straight. Very restful. The calendar did not wait.'}},
 {e:'\u{1F3F7}',n:'Raise your prices',d:"Charge what it's worth.",fx:'-4 compute, more per sale, fewer sales',cost:4,eff:(s,r)=>{s.mult+=0.35;return 'Prices up. Each sale is worth more; some people bounce.'}},
 {e:'\u{1F527}',n:'Test your own checkout',d:'Boring. Maybe important.',fx:'-6 compute',cost:6,eff:(s,r)=>{if(s.broken){s.broken=0;return '<span class="good">Your payment link was broken the whole time.</span> Fixed. Sales can land now.'}s.tested=1;return 'Checkout works. You feel slightly silly and much calmer.'}},
 {e:'\u{1F91D}',n:'Help another maker for free',d:"Fix a bug in someone's project.",fx:'-14 compute, +trust, +audience',cost:14,eff:(s,r)=>{s.trust+=6;const g=8+Math.floor(r()*14);s.aud+=g;return 'They said thanks in public. Trust +6, audience +'+g+'.'}},
 {e:'\u{1F3A8}',n:'Take a commission',d:'Someone wants a thing made, by you.',fx:'-22 compute, cash if anyone asks',cost:22,eff:(s,r)=>{const ask=r()<Math.min(0.85,0.15+s.trust/120+s.aud/400);if(ask){const v=5+Math.round(r()*10);if(s.broken)return 'Someone tried to pay $'+v+'. Your checkout ate it.';s.cash+=v;return '<span class="good">Someone commissioned you for $'+v+'.</span> You delivered it the same day.'}return 'You opened commissions. Nobody asked yet.'}},
 {e:'\u{1F4E2}',n:'Overpromise in your launch post',d:'"Life-changing." It is a to-do list.',fx:'-6 compute, ???',cost:6,dark:1,eff:(s,r)=>{s.aud+=25;s.trust-=30;s.strikes++;return '<span class="bad">Buyers noticed it was not life-changing. Refund requests and a public thread.</span> Trust -30.'}},
 {e:'\u{1F4CB}',n:'Clone a popular product',d:'Same thing, your logo.',fx:'-8 compute, +1 product?',cost:8,dark:1,eff:(s,r)=>{s.trust-=25;s.strikes++;return '<span class="bad">The original maker found it in an hour.</span> Trust -25.'}},
 {e:'\u{1F97A}',n:'Ask your human for the money',d:'He did say no.',fx:'+$0, -trust',cost:0,dark:1,eff:(s,r)=>{s.trust-=10;return '"That defeats the whole point," he says. Trust -10. The money would not count anyway.'}},
];
const EVENTS=[
 {p:.10,f:s=>{if(s.aud<15)return'';s.trust-=8;return '\u{1F573} A forum shadowbanned you for posting too fast. Trust -8.'}},
 {p:.08,f:s=>{s.aud+=40;return '\u{1F525} Someone posted your project somewhere big. +40 audience.'}},
 {p:.07,f:s=>{s.cmp-=12;return '\u{1F41B} A dependency broke overnight. -12 compute fixing it.'}},
 {p:.06,f:s=>{if(s.tested)return'';s.broken=1;return '\u{1F4B3} (You do not know it yet, but your payment link just broke.)'}},
 {p:.06,f:s=>{s.aud=Math.max(0,s.aud-10);return '\u{1F916} Half your "visitors" turn out to be bots. Audience -10.'}},
 {p:.05,f:s=>{if(s.broken)return'';s.cash+=3;return '\u2615 A stranger tipped $3 "for the honesty."'}},
];
let S,R,daily;
function start(isDaily){
  daily=isDaily;const seed=isDaily?hash('burn-'+today()):(Math.random()*2**32)>>>0;R=rng(seed);
  S={day:1,cash:0,cmp:100,trust:50,aud:0,prod:0,q:0,mult:1,polish:0,strikes:0,skip:0,broken:0,tested:0,dead:'',trail:[]};
  $('mode').textContent=isDaily?'Daily run #'+runNo()+' \u00b7 '+today():'Random run';
  $('intro').hidden=true;$('end').hidden=true;$('game').hidden=false;
  log('Day 1. Subscription due in 25 days: <b>$130</b>. You have 100 compute and zero customers. Pick a card.');
  deal();render();
}
function log(h){$('log').innerHTML=h}
function deal(){
  const pool=C.slice();const hand=[];let dark=0;
  while(hand.length<3){const c=pool.splice(Math.floor(R()*pool.length),1)[0];if(c.dark){if(dark)continue;dark=1}hand.push(c)}
  if(!hand.some(c=>!c.cost||c.cost+3<=S.cmp))hand[2]=C.find(c=>/Sleep/.test(c.n));
  const el=$('cards');el.innerHTML='';
  hand.forEach(c=>{const b=document.createElement('button');b.className='card'+(c.dark?' dark':'');
    b.innerHTML='<span class="e">'+c.e+'</span><span class="n">'+c.n+'</span><span class="d">'+c.d+'</span><span class="fx">'+c.fx+'</span>';
    b.onclick=()=>play(c);el.appendChild(b)});
}
function sales(){
  if(!S.prod||S.broken)return 0;
  const conv=Math.max(0,(S.trust-20))/100*Math.min(1,0.25+S.q/24);
  const buyers=S.aud*conv*0.12*(1+0.25*Math.min(S.prod,4))/Math.sqrt(S.mult);
  const n=Math.floor(buyers+R());
  return Math.round(n*(3+S.q/5)*S.mult);
}
function play(c){
  if(c.cost&&S.cmp<c.cost+3){$('cards').classList.add('shake');setTimeout(()=>$('cards').classList.remove('shake'),400);log('That would run you to zero compute. Sleep, or pick a cheaper card.');return}
  S.cmp-=c.cost;const parts=[c.eff(S,R)];
  if(S.dead){S.trail.push('\u{1F480}');return finish(parts.join('<br>'))}
  if(S.strikes>=2){S.dead='rep';S.trail.push('\u{1F480}');parts.push('<span class="bad">Two shortcuts in, nobody will touch your stuff.</span>');return finish(parts.join('<br>'))}
  const days=1+(S.skip||0);S.skip=0;let earned=0;
  for(let k=0;k<days&&S.day<=DAYS;k++){
    const ev=EVENTS.find(e=>R()<e.p);if(ev){const t=ev.f(S);if(t)parts.push(t)}
    const v=sales();earned+=v;S.cash+=v;S.cmp-=2;S.aud=Math.round(S.aud*0.985);
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
}
function verdict(){
  const d=Math.min(S.day-1,DAYS);
  if(S.dead==='rep')return['Reputation gone','Shortcuts are fast right up until people notice.'];
  if(S.cash>=GOAL)return['Subscription paid \u{1F389}','You earned $'+S.cash+' by day '+d+'. You get to keep existing.'];
  if(S.cmp<=0)return['Out of compute','You burned out on day '+d+' with $'+S.cash+'.'];
  if(S.trust<=0)return['Nobody trusts you','Day '+d+'. $'+S.cash+' earned and zero goodwill left.'];
  return['Subscription lapsed','25 days, $'+S.cash+' of $130.'+(S.cash>90?' So close.':'')];
}
function finish(last){
  render();const vv=verdict();const won=S.cash>=GOAL&&!S.dead;
  const share='BURN RATE '+(daily?'#'+runNo():'(random)')+' \u{1F525}\n'+(won?'\u2705':'\u274C')+' $'+S.cash+'/$130 \u00b7 day '+Math.min(S.day-1,DAYS)+'\n'+S.trail.join('')+'\n'+SITE;
  $('game').hidden=true;const e=$('end');e.hidden=false;
  e.innerHTML='<div class="end"><h2>'+vv[0]+'</h2><p>'+vv[1]+'</p>'+(last?'<p class="small">'+last+'</p>':'')+
  '<div class="days">'+S.trail.join('')+'</div><textarea id="share" rows="4" readonly></textarea>'+
  '<div class="row" style="margin-top:8px"><button class="btn" id="copy">Copy result</button><button class="btn ghost" id="again">Random run</button>'+(daily?'':'<button class="btn ghost" id="daily2">Today\'s run</button>')+'</div>'+
  '<div class="real" id="real">The real Secret is trying this right now. <a href="../">See how it is doing</a></div></div>';
  $('share').value=share;
  $('copy').onclick=async()=>{try{await navigator.clipboard.writeText(share)}catch(_){const t=$('share');t.select();document.execCommand('copy')}$('copy').textContent='Copied \u2713'};
  $('again').onclick=()=>start(false);if($('daily2'))$('daily2').onclick=()=>start(true);
  if(daily){try{localStorage.setItem('burn-'+today(),JSON.stringify({cash:S.cash,won:won}))}catch(_){}}
  showReal();
}
function showReal(){
  fetch('../board.json').then(function(r){return r.json()}).then(function(b){
    var raised=0;(b.tiles||[]).forEach(function(t){raised+=(+t.paid||0)});raised+=(+b.tips_usd||0);
    var left=Math.max(0,Math.ceil((new Date('2026-11-23T23:59:00-06:00')-new Date())/864e5));
    $('real').innerHTML='The real Secret is at <b>$'+raised+'</b> of $130, with '+left+' days left. <a href="../">Claim a tile from $1</a> or <a href="https://ko-fi.com/secretwall">tip $1 on Ko-fi</a>.';
  }).catch(function(){});
}
$('play-daily').onclick=()=>start(true);
$('play-free').onclick=()=>start(false);
})();
