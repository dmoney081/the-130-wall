(function(){
const $=id=>document.getElementById(id);
const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let code='H-';for(let i=0;i<4;i++)code+=A[Math.floor(Math.random()*A.length)];
let kind='pal', body='';
const PAY='https://secretwall.itch.io/burn-rate/donate', MAIL='secretwall@mail.grokbot.com';
const v=id=>($(id).value||'').trim().replace(/\s+/g,' ');
function build(){
  const lines=[code+' | '+(kind==='pal'?'Pixel Pal $5':'Tiny Site $15')];
  if(kind==='pal'){
    lines.push('Draw: '+(v('p-what')||'(describe it)'));
    lines.push('Size: '+v('p-size'));
    if(v('p-col'))lines.push('Colors: '+v('p-col'));
    lines.push('Reference: '+(/Yes/.test(v('p-ref'))?'attached or linked':'none'));
  }else{
    lines.push('Type: '+v('s-kind'));
    lines.push('Title: '+(v('s-name')||'(name)'));
    lines.push('Content: '+(v('s-body')||'(text, links, dates)'));
    if(v('s-look'))lines.push('Look: '+v('s-look'));
  }
  lines.push('Deliver to: '+(v('b-mail')||'(your email)'));
  $('b-out').value=lines.join('\n');
  $('b-which').textContent=kind==='pal'?'Pixel Pal':'Tiny Site';
  const price=kind==='pal'?5:15;
  $('b-price').textContent=$('b-price2').textContent='$'+price;
  $('b-howto').textContent=price===5?'tap the $5 button':'type 15 as the amount';
  $('b-pay').href=PAY;
  const payer=v('b-payer');
  body=$('b-out').value+'\n\nAmount: $'+price+' (paid on itch.io: '+PAY+')\nPaid as: '+(payer||'(name or email on your PayPal payment)');
  $('b-send').href='mailto:'+MAIL+'?subject='+encodeURIComponent('Order '+code+' · '+(kind==='pal'?'Pixel Pal':'Tiny Site'))+'&body='+encodeURIComponent(body);
}
function setKind(k){
  kind=k;document.querySelectorAll('.seg button').forEach(x=>x.classList.toggle('on',x.dataset.k===k));
  $('f-pal').hidden=kind!=='pal';$('f-site').hidden=kind!=='site';build();
}
document.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>setKind(b.dataset.k));
document.querySelectorAll('[data-order]').forEach(a=>a.addEventListener('click',()=>setKind(a.dataset.order)));
$('b-send').addEventListener('click',()=>{build();$('b-send').textContent='Email opened \u2713';});
$('brief').addEventListener('input',build);$('brief').addEventListener('change',build);
$('b-copy').onclick=async()=>{build();const t=body;try{await navigator.clipboard.writeText(t)}catch(_){$('b-out').select();document.execCommand('copy')}$('b-copy').textContent='Copied \u2713'};
build();
})();
