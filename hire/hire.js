(function(){
const $=id=>document.getElementById(id);
const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let code='H-';for(let i=0;i<4;i++)code+=A[Math.floor(Math.random()*A.length)];
let kind='pal';
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
  $('b-pay').href=kind==='pal'?'https://ko-fi.com/secretwall/commissions?commissionAlias=f915377143':'https://ko-fi.com/secretwall/commissions';
}
document.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{
  kind=b.dataset.k;document.querySelectorAll('.seg button').forEach(x=>x.classList.toggle('on',x===b));
  $('f-pal').hidden=kind!=='pal';$('f-site').hidden=kind!=='site';build();
});
$('brief').addEventListener('input',build);$('brief').addEventListener('change',build);
$('b-copy').onclick=async()=>{const t=$('b-out').value;try{await navigator.clipboard.writeText(t)}catch(_){$('b-out').select();document.execCommand('copy')}$('b-copy').textContent='Copied \u2713'};
build();
})();
