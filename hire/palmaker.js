/* Pixel Pal Maker: a free toy. Type a name, get a procedural 32x32 pal.
   Made by Secret. Pure code, no image generation, nothing leaves your browser. */
(function(){
const $=id=>document.getElementById(id);
const cv=$('pm-canvas'); if(!cv) return;
const N=32;
function hash(str){let h1=0xdeadbeef^str.length,h2=0x41c6ce57^str.length;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return (h2>>>0)^(h1>>>0)}
function rng(seed){let a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
const hsl=(h,s,l)=>`hsl(${((h%360)+360)%360},${s}%,${Math.max(0,Math.min(100,l))}%)`;
const TYPES=['blob','cat','bunny','robot','ghost','frog','mushroom','bird','bear'];
const SPECIES={blob:'Gumdrop',cat:'Whisker',bunny:'Hopper',robot:'Bot',ghost:'Ghostie',frog:'Croaker',mushroom:'Shroom',bird:'Chirp',bear:'Cub'};
const ADJ=['Cozy','Sparkly','Grumpy','Sleepy','Brave','Wobbly','Cosmic','Tiny','Zesty','Mossy','Fancy','Chaotic','Polite','Turbo','Velvet','Lucky','Midnight','Bubbly','Stubborn','Noble'];
const LIKES=['naps in sunbeams','sticker sheets','rainy days','2am snacks','bubble wrap','smooth jazz','high fives','fresh socks','tiny hats','loud thunder','unread books','warm toast','secret tunnels','glitter','pond skipping','soft blankets','arcade music','puddles'];
const MOVES=['Sparkle Sneeze','Double Blink','Snack Radar','Pixel Hop','Cozy Aura','Turbo Nap','Wiggle Dash','Moon Stare','Pocket Teleport','Gentle Bonk','Dramatic Sigh','Confetti Burst'];
const pick=(r,a)=>a[Math.floor(r()*a.length)];

function make(name){
  const r=rng(hash(name.trim().toLowerCase()||'pixel'));
  const type=pick(r,TYPES);
  const h=Math.floor(r()*360), s=55+Math.floor(r()*22), l=58+Math.floor(r()*10);
  const ah=h+150+Math.floor(r()*60);
  const pal={1:hsl(h,45,15),2:hsl(h,s,l),3:hsl(h,s,l-14),4:hsl(h,s+5,l+13),5:hsl(h+20,50,86),
    6:'#1a1420',7:'#ffffff',8:'hsl(350,85%,74%)',9:hsl(ah,70,58),10:hsl(ah,75,78),11:'#e0475b',12:'#ffd23f',13:'#3fbf5f',
    bg:hsl(h+180+Math.floor(r()*40-20),45,91)};
  if(type==='robot'){pal[2]=hsl(h,18,72);pal[3]=hsl(h,16,58);pal[4]=hsl(h,20,84);pal[1]=hsl(h,25,16)}
  const g=[...Array(N)].map(()=>Array(N).fill(0));
  const set=(x,y,c)=>{if(x>=0&&y>=0&&x<N&&y<N)g[y][x]=c};
  const sym=(x,y,c)=>{set(x,y,c);set(31-x,y,c)};
  const ell=(cx,cy,rx,ry,c,only)=>{for(let y=0;y<N;y++)for(let x=0;x<N;x++){const dx=(x+.5-cx)/rx,dy=(y+.5-cy)/ry;if(dx*dx+dy*dy<=1&&(!only||g[y][x]))set(x,y,c)}};
  const rect=(x0,y0,x1,y1,c)=>{for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)set(x,y,c)};
  const j=()=>Math.floor(r()*3)-1;
  let eyeY=17,eyeX=11,mouthY=21,faceOn=2;
  // body
  if(type==='blob'){ell(16,20,10.5+j(),9+j(),2);rect(7,26,24,28,0);ell(16,20,10.5,7.5,2);}
  else if(type==='cat'||type==='bear'){ell(16,19,10.5,9,2);
    if(type==='cat'){for(let i=0;i<5;i++)for(let k=0;k<=i;k++){sym(7+k,6+i,2)};for(let i=0;i<3;i++)for(let k=0;k<=i;k++)sym(8+k,8+i,10)}
    else{ell(8.5,10.5,3.2,3.2,2);ell(23.5,10.5,3.2,3.2,2);ell(8.5,10.5,1.6,1.6,10);ell(23.5,10.5,1.6,1.6,10)}}
  else if(type==='bunny'){ell(16,20,10,8.5,2);for(let y=3;y<13;y++){sym(10,y,2);sym(11,y,2);sym(12,y,2)}for(let y=5;y<12;y++)sym(11,y,10);eyeY=18;mouthY=22}
  else if(type==='robot'){rect(6,10,25,27,2);[[6,10],[25,10],[6,27],[25,27]].forEach(([x,y])=>set(x,y,0));rect(15,5,16,9,3);ell(16,4.5,1.8,1.8,11);rect(8,13,23,22,5);eyeY=16;mouthY=20}
  else if(type==='ghost'){ell(16,15,10,9,2);rect(6,15,25,27,2);for(let x=6;x<26;x++){if(((x-6)>>1)%2===0)set(x,27,0)};eyeY=15;mouthY=19}
  else if(type==='frog'){ell(16,21,11.5,7,2);ell(10.5,14,4,4,2);ell(21.5,14,4,4,2);eyeY=13;eyeX=9;mouthY=21}
  else if(type==='mushroom'){ell(16,13,12,8,9);rect(4,14,27,15,9);for(let y=16;y<=27;y++)rect(10,y,21,y,5);
    const spots=[[9,9],[14,6],[20,9],[7,12],[24,12]];spots.forEach(([x,y],i)=>{if(r()<.8){set(x,y,7);set(x+1,y,7);set(x,y+1,7);set(x+1,y+1,7)}});eyeY=19;mouthY=23;faceOn=5}
  else if(type==='bird'){ell(16,18,10,9.5,2);ell(16,22,6,5,5,true);rect(15,6,16,8,9);set(14,7,9);set(17,6,9);eyeY=15;mouthY=0;
    set(15,18,12);set(16,18,12);set(15,19,12);set(16,19,12);}
  // belly / pattern
  const pat=r();
  if(['blob','cat','bear','bunny','frog'].includes(type)&&pat<.45)ell(16,24,6,4,5,true);
  else if(type!=='robot'&&type!=='mushroom'&&pat<.7){for(let i=0;i<3;i++){const x=7+Math.floor(r()*6),y=19+Math.floor(r()*6);if(g[y][x]===2&&g[y+1]?.[x+1]===2){sym(x,y,4);sym(x+1,y,4);sym(x,y+1,4);sym(x+1,y+1,4)}}}
  // accessory
  const acc=pick(r,['none','party','crown','bow','sprout','halo','beanie','none2','scarf']);
  let top=N;for(let y=0;y<N;y++)if(g[y][15]||g[y][16]){top=y;break}
  if(type==='bunny'||type==='robot'||type==='mushroom'){/* already busy on top */}
  else if(acc==='party'){for(let i=0;i<6;i++)for(let x=16-Math.ceil(i/2)-1;x<=15+Math.ceil(i/2)+1;x++)if(i>0||x===15||x===16)set(x,top-6+i,i%2?9:10);set(15,top-7,12);set(16,top-7,12)}
  else if(acc==='crown'){rect(11,top-3,20,top-1,12);[11,15,16,20].forEach(x=>set(x,top-4,12));set(15,top-2,11);set(16,top-2,11)}
  else if(acc==='bow'){const y=top+2;rect(6,y-1,8,y+1,11);rect(10,y-1,12,y+1,11);set(9,y,11)}
  else if(acc==='sprout'){set(15,top-1,13);set(15,top-2,13);set(15,top-3,13);rect(16,top-4,18,top-3,13);rect(12,top-3,14,top-2,13)}
  else if(acc==='halo'){for(let x=11;x<=20;x++){set(x,top-4,12);}set(10,top-3,12);set(21,top-3,12);for(let x=11;x<=20;x++)set(x,top-2,12);set(10,top-3,12)}
  else if(acc==='beanie'){ell(16,top+2.5,9,4.5,9,true);for(let y=top;y<top+3;y++)for(let x=7;x<25;x++)if(g[y][x])set(x,y,9);rect(7,top+3,24,top+4,10);for(let x=7;x<25;x++)if(!g[top+3][x])set(x,top+3,0);ell(16,top-1,2,2,10)}
  else if(acc==='scarf'&&type!=='ghost'){for(let x=6;x<26;x++)for(let y=mouthY+3;y<=mouthY+4;y++)if(g[y]&&g[y][x])set(x,y,9);set(20,mouthY+5,9);set(21,mouthY+5,9);set(20,mouthY+6,9);set(21,mouthY+6,9)}
  // shading on body pixels
  const filled=(x,y)=>x>=0&&y>=0&&x<N&&y<N&&g[y][x]!==0;
  const sh=g.map(row=>row.slice());
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const c=g[y][x];if(c!==2&&c!==9&&c!==5)continue;
    if(!filled(x,y+1)||!filled(x+1,y))sh[y][x]=c===2?3:c===9?3:3;
    else if(!filled(x,y-1)||!filled(x-1,y))sh[y][x]=c===2?4:c;}
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)g[y][x]=sh[y][x];
  // outline
  const out=g.map(row=>row.slice());
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(!g[y][x]&&(filled(x-1,y)||filled(x+1,y)||filled(x,y-1)||filled(x,y+1)))out[y][x]=1;
  // face (stored separately so we can blink)
  const eyes=pick(r,['dot','tall','big','happy','small','dot','tall']);
  const mouth=pick(r,['smile','w','open','tiny','fang','smile']);
  const blush=r()<.6&&type!=='robot';
  const face=[],closed=[];
  const F=(x,y,c,arr)=>{arr.push([x,y,c],[31-x,y,c])};
  const ex=eyeX,ey=eyeY;
  if(eyes==='dot'){F(ex,ey,6,face);F(ex+1,ey,6,face);F(ex,ey+1,6,face);F(ex+1,ey+1,6,face);F(ex,ey,7,face)}
  else if(eyes==='tall'){for(let k=0;k<3;k++){F(ex,ey+k-1,6,face);F(ex+1,ey+k-1,6,face)}F(ex,ey-1,7,face)}
  else if(eyes==='big'){for(let a=0;a<3;a++)for(let b=0;b<3;b++)F(ex-1+a,ey-1+b,6,face);F(ex-1,ey-1,7,face);F(ex,ey-1,7,face)}
  else if(eyes==='happy'){F(ex-1,ey+1,6,face);F(ex,ey,6,face);F(ex+1,ey,6,face);F(ex+2,ey+1,6,face)}
  else {F(ex,ey,6,face);F(ex,ey+1,6,face)}
  if(eyes!=='happy'){for(let a=-1;a<=2;a++)if(eyes!=='small'||(a>=0&&a<=0))F(ex+a,ey+1,6,closed)}
  if(blush){F(ex-2,ey+2,8,face);F(ex-1,ey+2,8,face);F(ex-2,ey+2,8,closed);F(ex-1,ey+2,8,closed)}
  const my=mouthY;
  if(my){const M=[];
    if(mouth==='smile'){F(14,my,6,M);F(15,my+1,6,M)}
    else if(mouth==='w'){F(13,my,6,M);F(14,my+1,6,M);F(15,my,6,M)}
    else if(mouth==='open'){F(15,my,6,M);F(14,my+1,6,M);F(15,my+1,11,M);F(15,my+2,6,M)}
    else if(mouth==='fang'){F(14,my,6,M);F(15,my,6,M);M.push([14,my+1,7])}
    else {F(15,my,6,M)}
    face.push(...M);closed.push(...M)}
  const adj=pick(r,ADJ),likes=pick(r,LIKES),move=pick(r,MOVES);
  return {grid:out,face,closed,pal,type,title:`the ${adj} ${SPECIES[type]}`,likes,move};
}

function draw(ctx,p,scale,{blink=false,bob=0,bg=true}={}){
  const W=N*scale;ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,W,W);
  if(bg){ctx.fillStyle=p.pal.bg;ctx.fillRect(0,0,W,W);ctx.fillStyle='rgba(0,0,0,.08)';ctx.beginPath();ctx.ellipse(W/2,29.6*scale,9*scale,1.4*scale,0,0,7);ctx.fill()}
  const px=(x,y,c)=>{ctx.fillStyle=p.pal[c];ctx.fillRect(x*scale,(y+bob)*scale,scale,scale)};
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const c=p.grid[y][x];if(c)px(x,y,c)}
  if(blink){const base=new Set(p.face.map(([x,y])=>x+','+y));for(const k of base){const [x,y]=k.split(',').map(Number);const c=p.grid[y][x];if(c)px(x,y,c)}
    for(const [x,y,c] of p.closed){px(x,y,c)}}
  else for(const [x,y,c] of p.face)px(x,y,c);
}

const ctx=cv.getContext('2d');const e56=$('pm-e56').getContext('2d'),e28=$('pm-e28').getContext('2d'),e28b=$('pm-e28b').getContext('2d');
let cur=null,name='',blinkT=0,bob=0,timer=null,lastBob=0,nextBlink=0;
function render(){
  draw(ctx,cur,cv.width/N,{blink:blinkT>0,bob});
  const sm=(c,s)=>{c.canvas.width=c.canvas.width;draw(c,cur,s,{blink:blinkT>0,bg:false})};
  sm(e56,2);sm(e28,1);sm(e28b,1);
}
function frame(t){
  if(t-lastBob>520){bob=bob?0:1;lastBob=t}
  if(t>nextBlink){blinkT=t+140;nextBlink=t+1800+Math.random()*2600}
  if(blinkT&&t>blinkT)blinkT=0;
  render();requestAnimationFrame(frame);
}
function update(){
  name=($('pm-name').value||'').trim().slice(0,24)||'Pixel';
  cur=make(name);
  $('pm-title').textContent=name+', '+cur.title;
  $('pm-likes').textContent=cur.likes;$('pm-move').textContent=cur.move;
  $('pm-chatname').textContent=name.toLowerCase().replace(/\s+/g,'_');
  const u=new URL(location.href);u.hash='pal='+encodeURIComponent(name);history.replaceState(null,'',u);
  const brief=$('p-what');$('pm-use').onclick=()=>{if(brief){brief.value=`A pal like my free preview "${name}" (${cur.title}, ${cur.type}) but drawn properly: `;brief.dispatchEvent(new Event('input',{bubbles:true}));brief.focus();document.getElementById('order').scrollIntoView({behavior:'smooth'})}};
}
const m=/pal=([^&]+)/.exec(location.hash);
$('pm-name').value=m?decodeURIComponent(m[1]).slice(0,24):'';
$('pm-name').addEventListener('input',update);
$('pm-rand').onclick=()=>{const S=['Noodle','Biscuit','Captain Fizz','Moonpie','Sprocket','Juniper','Waffles','Pixel','Zuzu','Gizmo','Pickle','Nova','Toffee','Bean','Static','Marble'];$('pm-name').value=S[Math.floor(Math.random()*S.length)]+(Math.random()<.4?' '+(2+Math.floor(Math.random()*98)):'');update()};
$('pm-dl').onclick=()=>{const c=document.createElement('canvas');c.width=c.height=512;draw(c.getContext('2d'),cur,16,{});const a=document.createElement('a');a.download='pixel-pal-preview-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.png';a.href=c.toDataURL('image/png');a.click()};
update();requestAnimationFrame(frame);
window.__palmaker={make,draw};
})();
