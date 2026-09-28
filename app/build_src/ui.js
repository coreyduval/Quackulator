// ============================================================ UI
const $=sel=>document.querySelector(sel);
const app=$("#app"),modalEl=$("#modal"),toastEl=$("#toast"),fabEl=$("#fab");
const fmtBag=bag=>bag.map((n,i)=>n?NAME(i)+(n>1?"×"+n:""):"").filter(Boolean).join(" ")||"empty";
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const chipBtn=(i,extra="",cnt=null)=>`<button class="chip c-${COLOR[i]} ${extra}" data-chip="${i}" aria-label="${CNAME[COLOR[i]]} ${VALUE[i]} (${PIC[COLOR[i]]})">${VALUE[i]}${cnt!==null?`<span class="cnt">${cnt}</span>`:""}</button>`;
const disc=(i,cls="")=>`<b class="disc c-${COLOR[i]} ${cls}">${VALUE[i]}</b>`;
const chipName=i=>`${CNAME[COLOR[i]]} ${VALUE[i]}`;
const plural=(n,w)=>`${n} ${w==="ruby"?(n===1?"ruby":"rubies"):w+(n===1?"":"s")}`;
const vibe=p=>{try{if(navigator.vibrate)navigator.vibrate(p);}catch(e){}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let toastTimer=null;
const duck=cls=>DUCK_SVG.replace("<svg ",`<svg class="duck ${cls}" `);
function toast(msg){toastEl.innerHTML=`<div class="toast">${msg}</div>`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.innerHTML="",2800);}

// ---------- game state, the back stack and modals
let G=null;          // game state (plain data + ctx/brew rebuilt from it)
const HIST=[];       // snapshots taken before every forward step, so Back always works
let MODAL=null;      // {onBack} for the open modal
function snapshot(){const o={};for(const k in G){if(k==="ctx"||k==="brew")continue;o[k]=G[k];}return JSON.parse(JSON.stringify(o));}
function go(screen){HIST.push(snapshot());G.screen=screen;render();}
function makeBrew(){ // ctx + brew are derived from the round's inputs; rebuilt after a Back
  const m=G.mods||{};SHOP={discount:0,max:2,stock:G.stock};
  G.ctx=new Ctx(G.round,{n_opp:G.nOpp,nbBlack:nbNow().map(k=>k*DRAW_SHARE),target:G.round===ROUNDS?m.target:0,baseVp:G.vp,baseRubies:G.rubies,...(m.rules||{})});
  if(VMODEL&&!G.ctx.target)G.ctx.pay=new PayTable(G.bag,G.round,G.droplet,G.rubies,G.flask,G.round>=2?G.vp-(G.leader||0):0);
  G.brew=new Brew(G.ctx,G.bag.slice(),G.flask,tot(G.bag)>=22?1:2);}
function doBack(){G=HIST.pop();if(G.screen==="brew"||G.screen==="eval"||G.screen==="final"){makeBrew();G.brew.start(G.droplet+((G.mods&&G.mods.dropTemp)?1:0),G.rats);}render();}
function goBack(){ // -> true if the page handled it (the Android wrapper exits otherwise)
  if(MODAL&&MODAL.onBack){const h=MODAL.onBack;h();return true;}
  if(modalEl.innerHTML){closeModal();return true;}
  if(!HIST.length)return false;
  if(G.screen==="brew"&&G.chips.length){popup({cls:"stop",icon:"↩️",title:"Leave the brew?",body:`The ${plural(G.chips.length,"chip")} you've drawn this round will be cleared. Use <b>Undo</b> to take back just the last chip.`,
    buttons:[{label:"Go back anyway",cls:"primary",on:doBack},{label:"Stay",on:()=>{}}]});return true;}
  doBack();return true;}
window.quackBack=goBack;
try{history.pushState({q:1},"");window.addEventListener("popstate",()=>{goBack();history.pushState({q:1},"");});}catch(e){}
function closeModal(){modalEl.innerHTML="";MODAL=null;}
function newGame(){HIST.length=0;G={round:1,bag:START_BAG(),droplet:0,vp:0,rubies:START_RUBIES,flask:true,nOpp:2,nb:[0,0],stock:initialStock(3),stockEdited:false,usedCards:[],screen:"setup"};render();}
// neighbours' black chips as the value function sees them (one opponent: the same bag on both sides)
const nbNow=()=>G.nOpp===1?[G.nb[0],G.nb[0]]:[G.nb[0],G.nb[1]];
// value shown for a brew outcome: a win chance with the WIN model, otherwise VP-equivalents
const fv=v=>G.ctx&&G.ctx.pay&&G.ctx.pay.win?(100*v).toFixed(1)+"%":v.toFixed(2);

function render(){closeModal();NB=nbNow();
  if(G.screen==="setup")renderSetup();else if(G.screen==="prebrew")renderPreBrew();else if(G.screen==="brew")renderBrew();
  else if(G.screen==="eval")renderEval();else if(G.screen==="shop")renderShop();else if(G.screen==="final")renderFinal();
  const bb=$("#backbtn");if(bb)bb.onclick=()=>goBack();
  window.scrollTo(0,0);}
function screen(html){app.innerHTML=`<div class="screen">${html}</div>`;}

// ---------- HUD (back button, title, round pips, resources)
function hud(sub){
  const pips=Array.from({length:ROUNDS},(_,k)=>`<i class="${k+1<G.round?"done":k+1===G.round?"now":""}" title="round ${k+1}"></i>`).join("");
  setFab();
  return `<div class="hud"><div class="hud-top"><button class="backbtn" id="backbtn" ${HIST.length?"":"disabled"} aria-label="Back">‹ Back</button><h1>Quackulator</h1><div class="pips">${pips}</div></div>
  <div class="hud-sub">${sub}</div>
  <div class="hud-stats"><span class="pill">★ <b class="num">${G.vp}</b> VP</span><span class="pill">♦ <b class="num">${G.rubies}</b></span><span class="pill">💧 <b class="num">${G.droplet}</b></span><span class="pill">⚗ <b>${G.flask?"full":"empty"}</b></span><span class="pill">👜 <b class="num">${tot(G.bag)}</b></span></div></div>`;}

// ---------- steppers: big −/+ controls instead of number boxes (a value can't be skipped past unnoticed)
function stepper(id,label,val,min=0,max=999,sub="",cls=""){return `<div class="step ${cls}" data-step="${id}" data-min="${min}" data-max="${max}"><span class="lbl">${label}${sub?`<small>${sub}</small>`:""}</span><button class="sb" data-minus aria-label="less">−</button><b class="val num">${val}</b><button class="sb" data-plus aria-label="more">+</button></div>`;}
function bindSteppers(root,onChange){root.querySelectorAll(".step").forEach(st=>{const id=st.dataset.step,min=+st.dataset.min,max=+st.dataset.max,v=st.querySelector(".val");
  const set=d=>{const n=Math.max(min,Math.min(max,(+v.textContent||0)+d));v.textContent=n;vibe(10);onChange(id,n);};
  st.querySelector("[data-minus]").onclick=()=>set(-1);st.querySelector("[data-plus]").onclick=()=>set(1);});}
function segBtns(id,opts,val){return `<div class="seg" data-seg="${id}">${opts.map(([v,l])=>`<button class="${String(v)===String(val)?"on":""}" data-v="${v}">${l}</button>`).join("")}</div>`;}
function bindSegs(root,onChange){root.querySelectorAll(".seg").forEach(sg=>sg.querySelectorAll("button").forEach(b=>b.onclick=()=>{sg.querySelectorAll("button").forEach(x=>x.classList.remove("on"));b.classList.add("on");vibe(10);onChange(sg.dataset.seg,b.dataset.v);}));}

// ---------- the board: the pot spiral (0 outside, winding to the centre), drawn as a cauldron
const SP={W:460,R0:40,D:45,B:50,CR:19,ANCHOR:LAST}; // start radius, step along the path, radius gained per turn, cell radius; the last space (35 coins) sits at 3 o'clock
const SPOTS=(()=>{const a=[];let th=0,r=SP.R0;for(let k=0;k<=LAST;k++){a.push({th,r});th+=SP.D/r;r=SP.R0+SP.B*th/(2*Math.PI);}
  const rot=-a[SP.ANCHOR].th;return a.map(({th,r})=>({x:SP.W/2+r*Math.cos(th+rot),y:SP.W/2-r*Math.sin(th+rot)}));})();
const CHIP_GRAD={W:["#FFFFFF","#DCD3C4"],O:["#F7B25E","#C9621A"],G:["#66B876","#2A6B3A"],B:["#7A98E6","#2B4AA0"],R:["#E86A60","#9E2622"],Y:["#F8DA6A","#C9971A"],P:["#A874D6","#54297C"],K:["#5A5268","#111018"]};
const f1=n=>n.toFixed(1);
const at=(x,y)=>`style="transform:translate(${f1(x)}px,${f1(y)}px)"`;
function chipG(i,x,y,cls=""){const c=COLOR[i];const ring=cls.includes("boom")?"#F05562":cls.includes("last")?"#F6D77E":null;return `<g ${at(x,y)}><g class="chipg ${cls}">${ring?`<circle r="21" fill="none" stroke="${ring}" stroke-width="3.5"/>`:""}<circle r="17" fill="url(#cg-${c})" stroke="#1A1420" stroke-width="3" filter="url(#sh)"/><text class="dv ${c==="W"||c==="Y"?"dark":""}" y="5.5">${VALUE[i]}</text></g></g>`;}
const dropletG=(x,y,cls="")=>`<g class="marker" id="mk-drop" ${at(x-11,y+15)}><g class="mk-in ${cls}"><path d="M0,-13 C7,-4 9,1 9,5 A9,9 0 1,1 -9,5 C-9,1 -7,-4 0,-13Z" fill="url(#dropG)" stroke="#1B2E6E" stroke-width="1.5"/><ellipse cx="-3" cy="2" rx="2.2" ry="3" fill="rgba(255,255,255,.7)"/></g></g>`;
const ratG=(x,y)=>`<g class="marker" id="mk-rat" ${at(x+12,y+15)}><circle r="10" fill="#8C8494" stroke="#3A3543" stroke-width="1.5"/><text y="4" font-size="12">🐀</text></g>`;
function replayChips(chips,start){let pos=start,oranges=0;const out=[];const ob=(G.mods&&G.mods.rules&&G.mods.rules.orangeBonus)||0;
  for(const i of chips){let v=VALUE[i];if(COLOR[i]==="R")v+=oranges>=3?2:(oranges>=1?1:0);if(COLOR[i]==="O")v+=ob;pos=Math.min(pos+v,LAST);out.push({i,at:pos});if(COLOR[i]==="O")oranges++;}
  return out;}
function boardDefs(){return `<defs>
  <radialGradient id="iron" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#5A5266"/><stop offset="1" stop-color="#1A171F"/></radialGradient>
  <radialGradient id="liquid" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#6B4488"/><stop offset=".7" stop-color="#3A2350"/><stop offset="1" stop-color="#1E1230"/></radialGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9A93A6"/><stop offset=".5" stop-color="#3A3543"/><stop offset="1" stop-color="#8A8296"/></linearGradient>
  <radialGradient id="stone" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#8E82A8"/><stop offset="1" stop-color="#4E4466"/></radialGradient>
  <radialGradient id="stoneS" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#FFF4C8"/><stop offset="1" stop-color="#E4C36A"/></radialGradient>
  <radialGradient id="coinG" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#FFE99A"/><stop offset="1" stop-color="#C9962E"/></radialGradient>
  <linearGradient id="dropG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8FB4F5"/><stop offset="1" stop-color="#2B4AA0"/></linearGradient>
  ${Object.entries(CHIP_GRAD).map(([c,[a,b]])=>`<radialGradient id="cg-${c}" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`).join("")}
  <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="#000" flood-opacity=".45"/></filter>
</defs>`;}
function boardSVG(o){
  const placed=o.chips||[];const atMap={};placed.forEach((c,k)=>atMap[c.at]={i:c.i,last:k===placed.length-1});
  const rat=o.rats?Math.min(LAST,o.droplet+o.rats):-1;const scoring=o.scoring==null?-1:Math.min(LAST,o.scoring);
  const C=SP.W/2;let g="",chips="",marks="";
  const path=SPOTS.map((p,k)=>(k?"L":"M")+f1(p.x)+","+f1(p.y)).join(" ");
  const bubbles=Array.from({length:9},(_,k)=>{const a=k*2.4,r=95+((k*53)%110);return `<circle class="bubble" cx="${f1(C+r*Math.cos(a))}" cy="${f1(C+r*Math.sin(a))}" r="${3+(k%3)*2}" style="animation-delay:${-(k*0.7)}s"/>`;}).join("");
  for(let idx=0;idx<=LAST;idx++){const{x,y}=SPOTS[idx];const[c,v,rb]=TRACK[idx];const ch=atMap[idx];
    const cls=["cell",idx===scoring?"score":"",idx<o.droplet?"past":""].filter(Boolean).join(" ");
    g+=`<circle class="${cls}" cx="${f1(x)}" cy="${f1(y)}" r="${SP.CR}" ${idx===scoring?'fill="url(#stoneS)"':""} filter="url(#sh)"/>`;
    if(ch)chips+=chipG(ch.i,x,y,ch.last?"last"+(o.exploded?" boom":""):"");
    else g+=`<text class="idx" x="${f1(x)}" y="${f1(y-9.5)}" fill="${idx===scoring?"#5A4A1E":"#E6DFF2"}">${idx}</text><circle cx="${f1(x)}" cy="${f1(y+1.5)}" r="7.5" fill="url(#coinG)" stroke="#8A6414" stroke-width=".7"/><text class="coin" x="${f1(x)}" y="${f1(y+4.7)}">${c}</text>${v?`<text class="vpt" x="${f1(x)}" y="${f1(y+15.5)}" fill="${idx===scoring?"#3B2A05":"#FFF3C4"}">${v}★</text>`:""}${rb?`<rect x="${f1(x+8)}" y="${f1(y-15)}" width="6" height="6" fill="#E0323F" stroke="#7E1F29" stroke-width=".8" transform="rotate(45 ${f1(x+11)} ${f1(y-12)})"/>`:""}`;
    if(o.tappable)g+=`<circle class="hit" cx="${f1(x)}" cy="${f1(y)}" r="${SP.CR+2}" fill="transparent" data-sp="${idx}"/>`;}
  if(scoring>=0&&!o.noRing){const{x,y}=SPOTS[scoring];marks+=`<circle class="ring" cx="${f1(x)}" cy="${f1(y)}" r="21"/>`;}
  const d=SPOTS[Math.min(LAST,o.droplet)];marks+=dropletG(d.x,d.y);if(rat>=0)marks+=ratG(SPOTS[rat].x,SPOTS[rat].y);
  const legend=(o.center||[]).map((t,k)=>k?`<span>${t}</span>`:`<b>${t}</b>`).join(" · ");
  return `<svg class="spiral ${o.tappable?"tap":""}" viewBox="0 0 ${SP.W} ${SP.W}">${boardDefs()}
    <ellipse cx="${C}" cy="${C+8}" rx="${C-4}" ry="${C-10}" fill="rgba(0,0,0,.35)"/>
    <circle cx="${C}" cy="${C}" r="${C-4}" fill="url(#iron)"/>
    <circle cx="${C}" cy="${C}" r="${C-16}" fill="url(#liquid)"/>
    <circle cx="${C}" cy="${C}" r="${C-9}" fill="none" stroke="url(#rim)" stroke-width="9"/>
    <g id="bubbles">${bubbles}</g>
    <path d="${path}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="32" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${path}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="26" stroke-linejoin="round" stroke-linecap="round"/>
    <g id="cells">${g}</g><g id="chips">${chips}</g><g id="marks">${marks}</g>
    <rect class="flash" id="flash" x="0" y="0" width="${SP.W}" height="${SP.W}" rx="${C}"/><g id="fx"></g></svg><div class="bl" id="bl">${legend}</div>`;}
function boardOpts(){ // what the board shows for the current screen
  const m=G.mods||{};const d=G.droplet+(m.dropTemp?1:0);
  if((G.screen==="brew"||G.screen==="eval"||G.screen==="final")&&G.S){const sp=G.S.pos+1,[c,v,r]=track(sp);
    return{droplet:d,rats:G.rats,chips:replayChips(G.chips,G.start),scoring:sp,exploded:G.exploded,center:[`Space ${sp}`,`${c} coins · ${v} VP${r?" · ruby":""}`,`💧 ${d}${G.rats?` · 🐀 ${Math.min(LAST,d+G.rats)}`:""}`]};}
  if(G.screen==="shop"&&G.shop){const dd=G.droplet+G.shop.drop;return{droplet:dd,center:[`💧 ${dd}`,G.shop.drop?`moves ${G.droplet} → ${dd}`:"stays put"]};}
  if(G.screen==="prebrew"){const rats=ratInfo().rats;return{droplet:d,rats,center:[`💧 ${d}`,rats?`🐀 rat stone on ${Math.min(LAST,d+rats)}`:"no rat stone"]};}
  return{droplet:G.droplet,center:[`💧 ${G.droplet}`]};}
function boardPopup(opts={}){const o={...boardOpts(),...opts};if(o.tappable)o.center=["Tap the space your droplet is on",`💧 ${o.droplet}`];
  modalEl.innerHTML=`<div class="modal center board"><div class="box">${boardSVG(o)}<div class="opts"><button class="primary" id="bclose">${o.tappable?"Done":"Close"}</button></div></div></div>`;
  const close=()=>{closeModal();if(opts.onClose)opts.onClose();};MODAL={onBack:close};
  $("#bclose").onclick=close;modalEl.querySelector(".modal").onclick=e=>{if(e.target===e.currentTarget)close();};
  if(o.tappable)modalEl.querySelectorAll("[data-sp]").forEach(el=>el.onclick=()=>{const v=+el.dataset.sp;vibe(15);if(opts.onPick)opts.onPick(v);else G.droplet=v;boardPopup({...opts,droplet:v});});}
function setFab(){const s=G.screen;let t;
  if((s==="brew"||s==="eval"||s==="final")&&G.S)t=`space <b class="num">${G.S.pos+1}</b>`;
  else t=`💧 <b class="num">${G.droplet+((G.mods&&G.mods.dropTemp)?1:0)+(s==="shop"&&G.shop?G.shop.drop:0)}</b>`;
  fabEl.innerHTML="🫕 "+t;}

// ---------- popups (centered alerts) and bottom sheets
function popup(o){
  modalEl.innerHTML=`<div class="modal center ${o.cls||""}"><div class="box">${o.icon?`<div class="icon">${o.icon}</div>`:""}<h2>${o.title}</h2><div class="body">${o.body||""}</div>
    <div class="opts">${o.buttons.map((b,k)=>`<button class="${b.cls||""}" data-pb="${k}">${b.label}</button>`).join("")}</div></div></div>`;
  MODAL={onBack:o.onBack||(()=>{closeModal();const b=o.buttons.find(x=>x.back);if(b&&b.on)b.on();})};
  modalEl.querySelectorAll("[data-pb]").forEach(el=>el.onclick=()=>{closeModal();const b=o.buttons[+el.dataset.pb];b.on&&b.on();});}
function modal(html,o={}){modalEl.innerHTML=`<div class="modal"><div class="box">${o.title?`<div class="mhead"><button class="backbtn small" id="mback">‹</button><h2>${o.title}</h2></div>`:""}${html}</div></div>`;
  MODAL={onBack:o.onBack||closeModal};const mb=$("#mback");if(mb)mb.onclick=()=>MODAL.onBack();}
const rulesList=items=>`<ul>${items.map(t=>`<li>${t}</li>`).join("")}</ul>`;
// animated tally: rows slide in one after another and numbers tick up; optional droplet move on the board
function resultsPopup(o){
  const rows=o.rows.map((r,k)=>`<div class="tr" style="animation-delay:${(k*.3+.15).toFixed(2)}s"><span class="ic">${r.ic}</span><span class="tl">${r.l}${r.sub?`<small>${r.sub}</small>`:""}</span><span class="tv ${r.to>r.from?"up":r.to<r.from?"dn":""}" ${r.to!=null?`data-from="${r.from}" data-to="${r.to}"`:""}>${r.to!=null?`<small style="font-size:14px;color:var(--ink2)">${r.from} →</small> <span class="n">${r.from}</span>`:r.txt}</span></div>`).join("");
  modalEl.innerHTML=`<div class="modal center ${o.cls||"go"}"><div class="box">${o.icon?`<div class="icon">${o.icon}</div>`:""}<h2>${o.title}</h2>${o.intro?`<div class="muted">${o.intro}</div>`:""}
    ${o.board?`<div class="tally-board" style="margin:6px -6px 0">${boardSVG({droplet:o.board.from,rats:0,center:[`💧 ${o.board.from} → ${o.board.to}`],noRing:true})}</div>`:""}
    <div class="tally">${rows||`<div class="muted" style="text-align:center">Nothing to collect this round.</div>`}</div>
    <div class="opts"><button class="primary" id="rs-next">${o.button.label}</button></div></div></div>`;
  MODAL={onBack:()=>{closeModal();doBack();}};$("#rs-next").onclick=()=>{closeModal();o.button.on();};
  modalEl.querySelectorAll(".tv[data-to]").forEach((el,k)=>{const from=+el.dataset.from,to=+el.dataset.to,n=el.querySelector(".n");const delay=k*300+500,dur=550,t0=performance.now()+delay;
    const tick=now=>{const p=Math.min(1,Math.max(0,(now-t0)/dur));n.textContent=Math.round(from+(to-from)*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(tick);else vibe(15);};requestAnimationFrame(tick);});
  if(o.board&&o.board.to!==o.board.from)setTimeout(()=>{const mk=modalEl.querySelector("#mk-drop");if(!mk)return;const p=SPOTS[Math.min(LAST,o.board.to)];mk.style.transform=`translate(${f1(p.x-11)}px,${f1(p.y+15)}px)`;mk.firstElementChild.classList.add("hop");},900);}
function confetti(){const el=document.createElement("div");el.className="confetti";const cols=["#C9456A","#E9C46A","#3D63C6","#3C8C4C","#7A46A8","#E8862E"];
  el.innerHTML=Array.from({length:60},(_,k)=>`<i style="left:${(k*1.7)%100}%;background:${cols[k%cols.length]};animation-delay:${(k%12)*.12}s;animation-duration:${2+(k%5)*.3}s"></i>`).join("");document.body.appendChild(el);setTimeout(()=>el.remove(),4200);}

// ---------- setup
function stockEditor(){
  return `<div class="bagedit">${BUYABLE.map(i=>`<div class="be ${G.stock[i]?"":"out"}">${chipBtn(i)}<b id="sc-${i}" class="num">${G.stock[i]||"out"}</b><button class="tiny" data-sdec="${i}">−</button><button class="tiny" data-sinc="${i}">+</button></div>`).join("")}</div>`;}
function bindStock(after){
  app.querySelectorAll("[data-sdec]").forEach(b=>b.onclick=()=>{const i=+b.dataset.sdec;if(G.stock[i]>0)G.stock[i]--;G.stockEdited=true;after(i);});
  app.querySelectorAll("[data-sinc]").forEach(b=>b.onclick=()=>{const i=+b.dataset.sinc;G.stock[i]++;G.stockEdited=true;after(i);});}
function renderSetup(){
  screen(hud("New game · where are you?")+`
  <div class="card"><h2>Your seat</h2>
    <div class="row" style="flex-direction:column;align-items:stretch;gap:8px">
      ${stepper("round","Round",G.round,1,9)}${stepper("drop","Droplet space",G.droplet,0,LAST,"0 = outside the pot")}
      ${stepper("vp","Victory points",G.vp,0,199)}${stepper("rub","Rubies",G.rubies,0,30)}
    </div>
    <div class="row" style="margin-top:10px"><span class="grow muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.04em;font-size:12px">Opponents</span>${segBtns("opp",[[1,"1"],[2,"2"],[3,"3"]],G.nOpp)}</div>
    <div class="row" style="margin-top:8px"><span class="grow muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.04em;font-size:12px">Flask</span>${segBtns("flask",[[1,"⚗ full"],[0,"empty"]],G.flask?1:0)}</div>
    <div class="row" style="flex-direction:column;align-items:stretch;gap:8px;margin-top:10px">${nbSteppers()}</div>
  </div>
  <div class="card"><h2>Your bag</h2>
    <div class="bagedit">${CHIPS.map((c,i)=>`<div class="be">${chipBtn(i)}<b id="bc-${i}" class="num">${G.bag[i]}</b><button class="tiny" data-dec="${i}">−</button><button class="tiny" data-inc="${i}">+</button></div>`).join("")}</div>
  </div>
  <details class="card"><summary>Chip supply <span class="muted">edit if chips were already bought</span></summary>
    <div class="muted" style="margin:8px 0">Left in the box. Knock off anything already bought.</div>${stockEditor()}</details>
  <div class="bar"><div class="in"><button class="primary" id="go">Start round ${G.round} ›</button></div></div>`);
  bindSteppers(app,(id,n)=>{if(id==="round"){G.round=n;$("#go").textContent=`Start round ${n} ›`;}else if(id==="drop")G.droplet=n;else if(id==="vp")G.vp=n;else if(id==="rub")G.rubies=n;else if(id==="nb0")G.nb[0]=n;else if(id==="nb1")G.nb[1]=n;});
  bindSegs(app,(id,v)=>{if(id==="opp"){G.nOpp=+v;if(!G.stockEdited)G.stock=initialStock(G.nOpp+1);renderSetup();}else G.flask=v==="1";});
  app.querySelectorAll("[data-inc]").forEach(b=>b.onclick=()=>{G.bag[+b.dataset.inc]++;$("#bc-"+b.dataset.inc).textContent=G.bag[+b.dataset.inc];});
  app.querySelectorAll("[data-dec]").forEach(b=>b.onclick=()=>{const i=+b.dataset.dec;if(G.bag[i]>0)G.bag[i]--;$("#bc-"+i).textContent=G.bag[i];});
  bindStock(i=>{const el=$("#sc-"+i);el.textContent=G.stock[i]||"out";el.parentElement.classList.toggle("out",!G.stock[i]);});
  $("#go").onclick=()=>{G.startedRound=G.round;go("prebrew");};
}
// black chips in the neighbours' bags: the model prices the moth against them (one opponent: a single input)
function nbSteppers(){return G.nOpp===1?stepper("nb0","Opponent's black chips",G.nb[0],0,20):stepper("nb0","Left neighbour's blacks",G.nb[0],0,20)+stepper("nb1","Right neighbour's blacks",G.nb[1],0,20);}

// ---------- pre-brew: round check-in, fortune card, rat tails, droplet position
function ratInfo(){const m=G.mods,leader=G.leader??OPP.leader_vp[G.round];
  const tails=G.round>=2?RAT_TAIL_VP.filter(t=>G.vp<t&&t<leader):[];
  const rats=Math.max(0,tails.length*m.ratsMult+m.ratsExtra);return{leader,tails,rats};}
function renderPreBrew(){
  if(G.round===EXTRA_WHITE_ROUND&&G.round!==G.startedRound&&!G.extraWhiteDone){G.bag[IDX.W1]++;G.extraWhiteDone=true;}
  G.mods=G.mods||{dropTemp:0,ratsExtra:0,ratsMult:1,target:0,card:null,rules:{},note:""};const m=G.mods;
  const ri=ratInfo();const lastShop=G.lastShop||{};
  const start=Math.min(LAST,G.droplet+(m.dropTemp?1:0)+ri.rats);
  screen(hud(`Round ${G.round} · before brewing`)+`
  ${lastShop.text?`<div class="card muted">Last shop: ${lastShop.text}</div>`:""}
  ${G.round===EXTRA_WHITE_ROUND&&G.round!==G.startedRound?`<div class="card muted">White 1 added to your bag (round 6).</div>`:""}
  <div class="card"><div class="row"><h2 class="grow">This round</h2><button class="small" id="edit">✎ Edit</button></div>
    <div class="kv" style="margin-top:6px"><span>💧 Droplet</span><b class="num">space ${G.droplet}</b>
    ${G.round>=2?`<span>🏆 Best opponent's VP</span><b class="num">${ri.leader}</b><span>🐀 Rat tails</span><b class="num">${ri.rats}${ri.rats?` → rat stone on ${start}`:""}</b>`:""}
    <span>🦋 ${G.nOpp===1?"Opponent's blacks":"Neighbours' blacks (left / right)"}</span><b class="num">${G.nOpp===1?G.nb[0]:G.nb[0]+" / "+G.nb[1]}</b>
    ${G.round===ROUNDS?`<span>🎯 Score to beat</span><b class="num">${m.target||"—"}</b>`:""}</div>
    ${G.round>=2?`<div class="mods" style="margin-top:8px"><button class="small ${m.ratsMult===0?"on":""}" data-rats="0">No rats this round</button><button class="small ${m.ratsMult===2?"on":""}" data-rats="2">Double rats</button><button class="small" id="showpot">🫕 Show the pot</button></div>`:`<div class="mods" style="margin-top:8px"><button class="small" id="showpot">🫕 Show the pot</button></div>`}
  </div>
  ${fortuneCard()}
  <div class="card muted">Bag: ${fmtBag(G.bag)} · flask ${G.flask?"full":"empty"} · ${plural(G.rubies,"ruby")}</div>
  <div class="bar"><div class="in"><button class="primary" id="go">Start brewing ›</button></div></div>`);
  app.querySelectorAll("[data-rats]").forEach(b=>b.onclick=()=>{const v=+b.dataset.rats;m.ratsMult=m.ratsMult===v?1:v;render();});
  $("#edit").onclick=()=>roundWizard(0);$("#showpot").onclick=()=>boardPopup();
  const pc=$("#pickcard");if(pc)pc.onclick=fortunePicker;
  $("#go").onclick=()=>{if(G.cardRound!==G.round){fortunePicker();return;}startBrew();};
  // the round's inputs first (best opponent's VP, droplet, rat tails), then the fortune card
  if(G.round>=2&&G.promptedRound!==G.round)roundWizard(0);else if(G.cardRound!==G.round)fortunePicker();
}
// round check-in: one question per card, each confirmed with its own tap, so nothing is skipped past
function wizardSteps(){const m=G.mods;const steps=[];
  if(G.round>=2)steps.push({title:"Best opponent's VP",q:"The highest score on the track that isn't yours.",icon:"🏆",get:()=>G.leader??OPP.leader_vp[G.round],set:v=>G.leader=v,max:199});
  steps.push({title:"Your droplet",q:"The space your droplet sits on. 0 = still outside the pot.",icon:"💧",get:()=>G.droplet,set:v=>G.droplet=v,max:LAST,board:true});
  steps.push({title:"Your stuff",q:"Does the app match what's in front of you?",icon:"🧙",rows:[{id:"vp",l:"Victory points",get:()=>G.vp,set:v=>G.vp=v,max:199},{id:"rub",l:"Rubies",get:()=>G.rubies,set:v=>G.rubies=v,max:30},{id:"flask",l:"Flask",seg:[[1,"⚗ full"],[0,"empty"]],get:()=>G.flask?1:0,set:v=>G.flask=+v===1}]});
  steps.push({title:"Neighbours' black chips",q:"Moths in the bags next to you (the ones you compete with at scoring).",icon:"🦋",rows:G.nOpp===1?[{id:"nb0",l:"Opponent's blacks",get:()=>G.nb[0],set:v=>G.nb[0]=v,max:20}]:[{id:"nb0",l:"Left neighbour",get:()=>G.nb[0],set:v=>G.nb[0]=v,max:20},{id:"nb1",l:"Right neighbour",get:()=>G.nb[1],set:v=>G.nb[1]=v,max:20}]});
  if(G.round>=2)steps.push({title:"Rat tails",icon:"🐀",qf:()=>`You ${G.vp} VP, best opponent ${ratInfo().leader}: the app counts <b>${Math.max(0,ratInfo().tails.length*m.ratsMult)}</b>. Adjust if the table says otherwise.`,get:()=>ratInfo().rats,set:v=>{m.ratsExtra+=v-ratInfo().rats;},max:20});
  if(G.round===ROUNDS)steps.push({title:"Score to beat",q:"Optional: the total you need to finish first. 0 = just play for the most points.",icon:"🎯",get:()=>m.target||0,set:v=>m.target=v,max:199});
  return steps;}
function roundWizard(k){const steps=wizardSteps();if(k>=steps.length){G.promptedRound=G.round;closeModal();render();return;}
  const st=steps[k];const dots=steps.map((_,j)=>`<i class="${j<k?"done":j===k?"on":""}"></i>`).join("");
  const num=(id,v,max)=>`<div class="ctl"><button class="sb" data-wdec="${id}">−</button><span class="bigval num" id="wv-${id}">${v}</span><button class="sb" data-winc="${id}">+</button></div>`;
  let body;
  if(st.rows)body=`<div class="rows">${st.rows.map(r=>r.seg?`<div class="row" style="justify-content:space-between"><span class="muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.04em;font-size:12px">${r.l}</span>${segBtns(r.id,r.seg,r.get())}</div>`:stepper(r.id,r.l,r.get(),0,r.max)).join("")}</div>`;
  else body=num("v",st.get(),st.max)+(st.board?`<button class="small" id="wboard">🫕 Tap it on the pot</button>`:"");
  modalEl.innerHTML=`<div class="modal center go"><div class="box wiz"><div class="dots">${dots}</div><div class="step-anim"><div class="icon">${st.icon}</div><h2>${st.title}</h2><div class="q">${st.qf?st.qf():st.q}</div>${body}
    <button class="go ok attn" id="wok">✓ ${st.rows?"That's right":"Yes, "+st.get()}</button>
    <div class="nav"><button class="ghost small" id="wback">‹ ${k?"Previous":"Back"}</button><span class="muted" style="align-self:center">${k+1} / ${steps.length}</span></div></div></div></div>`;
  const back=()=>{if(k)roundWizard(k-1);else{closeModal();if(G.promptedRound!==G.round&&HIST.length)doBack();else render();}};MODAL={onBack:back};
  const refresh=()=>{const q=modalEl.querySelector(".q");if(st.qf)q.innerHTML=st.qf();const ok=$("#wok");if(!st.rows)ok.textContent=`✓ Yes, ${st.get()}`;ok.classList.remove("attn");};
  modalEl.querySelectorAll("[data-wdec],[data-winc]").forEach(b=>b.onclick=()=>{const d=b.dataset.wdec!==undefined?-1:1;const v=Math.max(0,Math.min(st.max,st.get()+d));st.set(v);$("#wv-v").textContent=v;vibe(10);refresh();});
  bindSteppers(modalEl,(id,n)=>{st.rows.find(r=>r.id===id).set(n);refresh();});bindSegs(modalEl,(id,v)=>{st.rows.find(r=>r.id===id).set(v);refresh();});
  const wb=$("#wboard");if(wb)wb.onclick=()=>boardPopup({tappable:true,droplet:G.droplet,rats:0,onPick:v=>{G.droplet=v;},onClose:()=>roundWizard(k)});
  $("#wback").onclick=back;$("#wok").onclick=()=>{if(!st.rows)st.set(st.get());vibe(20);roundWizard(k+1);};}
// ---------- fortune teller card: the picker, the card panel, and the purple cards' immediate effects
function fortuneCard(){const m=G.mods,c=m.card&&FCARD(m.card);
  if(!c)return `<div class="card"><h2>Fortune teller card</h2><div class="muted">${G.cardRound===G.round?"No card this round.":"Not chosen yet."}</div><div class="mods" style="margin-top:8px"><button class="small primary" id="pickcard">🔮 Choose the card</button></div></div>`;
  return `<div class="fc ${c.blue?"fblue":"fpurple"}"><div class="big">${c.name}</div><div class="why">${c.text}</div>${m.note?`<div class="why"><b>${m.note}</b></div>`:""}${c.blue?`<button class="small" id="pickcard">Change card</button>`:""}</div>`;}
function fortunePicker(){const m=G.mods,used=G.usedCards||[];
  const item=c=>`<button class="opt ${c.blue?"fblue":"fpurple"} ${m.card===c.id?"best":""}" data-card="${c.id}" ${used.includes(c.id)&&m.card!==c.id?"disabled":""}><span><b>${c.name}</b><div class="muted">${c.text}</div></span></button>`;
  modal(`<div class="muted">Blue cards change this round's rules; purple ones happen right now. Cards already played are greyed out.</div>
    <div class="opts"><button class="opt" data-card="">No card / skip</button>
    <div class="muted" style="margin-top:6px">Round rules</div>${FORTUNE.filter(c=>c.blue).map(item).join("")}
    <div class="muted" style="margin-top:6px">Immediate effects</div>${FORTUNE.filter(c=>!c.blue).map(item).join("")}</div>`,{title:`Round ${G.round}: which card came up?`});
  modalEl.querySelectorAll("[data-card]").forEach(el=>el.onclick=()=>{G.cardRound=G.round;vibe(15);chooseFortune(el.dataset.card||null);});}
function chooseFortune(id){const m=G.mods;closeModal();
  if(m.card&&m.card!==id)G.usedCards=G.usedCards.filter(c=>c!==m.card);
  m.card=id;m.rules={};m.note="";
  if(!id){render();return;}
  if(!G.usedCards.includes(id))G.usedCards.push(id);
  const c=FCARD(id);
  if(c.blue){m.rules=BLUE_RULES[id]||{};render();return;}
  resolvePurple(c);}
function unchooseFortune(){const m=G.mods;if(m.card)G.usedCards=G.usedCards.filter(c=>c!==m.card);m.card=null;m.rules={};m.note="";G.cardRound=null;render();}
// value of a start-of-round state, to rank a purple card's options: the learned V_r (a logit for the WIN
// model, with any VP gained folded into the margin), or the heuristic's brew EV plus rubies at the round's rate
function cardValue(bag,droplet,rubies,flask,vpGain=0){const rnd=G.round,margin=rnd>=2?G.vp-(G.leader||0):0;
  if(VMODEL){const r=Math.max(2,rnd);const v=vvalue(r,bag,droplet,rubies,flask);return VMODEL.win?v+vmargin(r)*(margin+vpGain):v+vpGain;} // V_1 is a constant: rank one round ahead
  const ctx=new Ctx(rnd,{n_opp:G.nOpp}),A=new Abstract(ctx);return nextRoundEV(bag,droplet,flask,ctx,A,G.vp+vpGain)+rubies*WEIGHTS.ruby[rnd]+vpGain;}
const fmtCard=v=>VMODEL&&VMODEL.win?(100*sigmoid(v)).toFixed(1)+"%":v.toFixed(2);
// Good Start: value of this round's brew with the rat stone k spaces back and k more rubies
function goodStartValue(k){const rats=ratInfo().rats-k,rub=G.rubies+k;const ctx=new Ctx(G.round,{n_opp:G.nOpp});
  ctx.nb=nbNow().map(k=>k*DRAW_SHARE);if(VMODEL)ctx.pay=new PayTable(G.bag,G.round,G.droplet,rub,G.flask,G.round>=2?G.vp-G.leader:0);
  const b=new Brew(ctx,G.bag,G.flask,tot(G.bag)>=22?1:2);return b.V(b.start(G.droplet,rats))+(VMODEL?0:k*WEIGHTS.ruby[G.round]);}
// options: [{label, v, show?, apply}] ranked best first; the user taps what they actually took
function choiceModal(c,opts,intro){const sorted=opts.slice().sort((a,b)=>b.v-a.v),best=sorted[0];
  modal(`<div class="muted">${c.text}${intro?`<br>${intro}`:""}</div><div class="opts">${sorted.map((o,k)=>`<button class="opt ${o===best?"best":""}" data-fo="${k}"><span>${o.label}${o===best?'<span class="tag">Best</span>':""}</span><span class="ev num">${o.show||fmtCard(o.v)}</span></button>`).join("")}</div>`,{title:c.name,onBack:unchooseFortune});
  modalEl.querySelectorAll("[data-fo]").forEach(el=>el.onclick=()=>{const o=sorted[+el.dataset.fo];closeModal();o.apply();G.mods.note=o.label.replace(/<[^>]+>/g,"").trim();vibe(15);render();});}
function yesNo(c,question,yesLabel,onYes,noNote){popup({cls:"go",icon:"🔮",title:c.name,body:`${c.text}<div style="margin-top:8px"><b>${question}</b></div>`,onBack:unchooseFortune,
  buttons:[{label:yesLabel,cls:"primary",on:()=>{onYes();render();}},{label:"No",on:()=>{G.mods.note=noNote;render();}}]});}
const takeChip=i=>{G.bag[i]++;if(G.stock[i]>0)G.stock[i]--;};
const withChip=(bag,i)=>{const b=bag.slice();b[i]++;return b;};
function resolvePurple(c){const m=G.mods,bag=G.bag,d=G.droplet,rub=G.rubies,fl=G.flask;const inStock=i=>G.stock[i]>0;
  const chipOpt=(i,extra="")=>({label:`${disc(i)} ${chipName(i)}${extra}`,v:cardValue(withChip(bag,i),d,rub,fl),apply:()=>takeChip(i)});
  switch(c.id){
    case "drop":G.droplet++;m.note=`Droplet moved to ${G.droplet}.`;render();return;
    case "infestation":m.ratsMult=2;m.note=`Rat tails counted twice: ${ratInfo().rats}.`;render();return;
    case "charity":yesNo(c,"Do you have the fewest rubies (ties count)?","Yes — took a ruby",()=>{G.rubies++;m.note="Took a ruby.";},"Not the fewest rubies.");return;
    case "beginner":yesNo(c,"Do you have the fewest VP (ties count)?","Yes — took a green 1",()=>{takeChip(IDX.G1);m.note="Green 1 added to your bag.";},"Not the fewest VP.");return;
    case "less":popup({cls:"go",icon:"🔮",title:c.name,body:`${c.text}<div style="margin-top:8px"><b>Draw 5 from your bag and compare sums.</b></div>`,onBack:unchooseFortune,
      buttons:[{label:"Lowest sum — took a blue 2",cls:"primary",on:()=>{takeChip(IDX.B2);m.note="Blue 2 added to your bag.";render();}},{label:"Took a ruby",on:()=>{G.rubies++;m.note="Took a ruby.";render();}}]});return;
    case "chance":modal(`<div class="muted">${c.text}<br><b>What did you roll?</b></div><div class="opts">${["vp1","vp2","ruby","droplet","orange"].map(f=>`<button class="opt" data-face="${f}"><span>${{vp1:"1 VP",vp2:"2 VP",ruby:"Ruby",droplet:"Droplet +1",orange:"Orange chip"}[f]}</span></button>`).join("")}</div>`,{title:c.name,onBack:unchooseFortune});
      modalEl.querySelectorAll("[data-face]").forEach(el=>el.onclick=()=>{const f=el.dataset.face;closeModal();
        if(f==="vp1")G.vp+=1;else if(f==="vp2")G.vp+=2;else if(f==="ruby")G.rubies++;else if(f==="droplet")G.droplet++;else takeChip(IDX.O1);
        m.note=`Rolled: ${{vp1:"1 VP",vp2:"2 VP",ruby:"a ruby",droplet:"droplet +1",orange:"an orange chip"}[f]}.`;render();});return;
    case "choices":{const opts=[];if(inStock(IDX.K1))opts.push(chipOpt(IDX.K1));for(const i of[IDX.G2,IDX.B2,IDX.R2,IDX.Y2])if(inStock(i))opts.push(chipOpt(i));
      opts.push({label:"3 rubies",v:cardValue(bag,d,rub+3,fl),apply:()=>{G.rubies+=3;}});choiceModal(c,opts);return;}
    case "wheeling":{if(rub<1){m.note="No ruby to trade.";render();return;}const opts=[{label:"Keep the ruby",v:cardValue(bag,d,rub,fl),apply:()=>{}}];
      for(const i of[IDX.O1,IDX.G1,IDX.B1,IDX.R1,IDX.Y1])if(inStock(i))opts.push({label:`${disc(i)} Ruby → ${chipName(i)}`,v:cardValue(withChip(bag,i),d,rub-1,fl),apply:()=>{G.rubies--;takeChip(i);}});choiceModal(c,opts);return;}
    case "boomberry":{const opts=[{label:"Score 4 VP",v:cardValue(bag,d,rub,fl,4),apply:()=>{G.vp+=4;}}];
      if(bag[IDX.W1]>0){const b=bag.slice();b[IDX.W1]--;opts.push({label:`${disc(IDX.W1)} Remove a white 1 from the bag`,v:cardValue(b,d,rub,fl),apply:()=>{G.bag[IDX.W1]--;}});}choiceModal(c,opts);return;}
    case "goodstart":{const rats=ratInfo().rats;if(!rats){m.note="No rat tails to give back.";render();return;}
      const opts=[];for(let k=0;k<=Math.min(3,rats);k++){const v=goodStartValue(k);opts.push({label:k?`Rat stone back ${k} → +${plural(k,"ruby")}`:"Leave the rat stone",v,show:VMODEL&&VMODEL.win?(100*v).toFixed(1)+"%":v.toFixed(2),apply:()=>{m.ratsExtra-=k;G.rubies+=k;}});}
      choiceModal(c,opts,`You have ${plural(rats,"rat tail")}.`);return;}
    case "ratatat":{const rats=ratInfo().rats;const opts=[];for(const i of[IDX.G4,IDX.B4,IDX.R4,IDX.Y4])if(inStock(i))opts.push(chipOpt(i));
      opts.push({label:`Score ${plural(rats,"VP")} (rat tails behind the leader)`,v:cardValue(bag,d,rub,fl,rats),apply:()=>{G.vp+=rats;}});choiceModal(c,opts);return;}
    case "decisions":{const opts=[{label:"Droplet +2",v:cardValue(bag,d+2,rub,fl),apply:()=>{G.droplet+=2;}}];if(inStock(IDX.P1))opts.push(chipOpt(IDX.P1));choiceModal(c,opts);return;}
    case "flea":popup({cls:"go",icon:"🔮",title:c.name,body:`${c.text}<div style="margin-top:8px"><b>Draw 4 chips from your bag.</b></div>`,onBack:unchooseFortune,buttons:[{label:"I've drawn 4 — show me",cls:"primary",on:()=>pickChips(bag,Math.min(4,tot(bag)),"Flea Market: which 4 did you draw?","Tap them in any order",picked=>{
        const opts=[];for(const i of new Set(picked)){const j=CHIPS.findIndex((ch,k)=>ch[0]===COLOR[i]&&ch[1]>VALUE[i]);if(j>=0&&inStock(j)){const b=bag.slice();b[i]--;b[j]++;opts.push({label:`${disc(i)} → ${disc(j)} Trade ${chipName(i)} for ${chipName(j)}`,v:cardValue(b,d,rub,fl),apply:()=>{G.bag[i]--;takeChip(j);}});}}
        if(opts.length)opts.push({label:"No trade — everything back in the bag",v:cardValue(bag,d,rub,fl),apply:()=>{}});
        else opts.push({label:`${disc(IDX.G1)} No upgrade possible: take a green 1`,v:cardValue(withChip(bag,IDX.G1),d,rub,fl),apply:()=>takeChip(IDX.G1)});
        choiceModal(c,opts,`Drawn: ${picked.map(i=>disc(i)).join(" ")}`);},unchooseFortune)}]});return;
  }}
function startBrew(){
  const m=G.mods;const rats=ratInfo().rats;
  HIST.push(snapshot());
  makeBrew();
  G.verdictKey=null;G.start=G.droplet+(m.dropTemp?1:0)+rats;
  G.S=G.brew.start(G.droplet+(m.dropTemp?1:0),rats);G.rats=rats;G.hist=[];G.log=[];G.chips=[];G.exploded=false;
  G.screen="brew";render();
}

// ---------- brew
function renderBrew(){
  const s=G.S,b=G.brew,ctx=G.ctx;
  const k=skey(s);
  if(!G.exploded&&tot(s.bag)&&G.verdictKey!==k){ // solve off the render path so the tap registers first
    app.innerHTML=hud(`Round ${G.round} · brewing`)+`<div class="verdict think"><div class="thinkduck">${duck("chomp")}<div><div class="word" style="font-size:30px">Hmm…</div><div class="why">Working out the odds</div></div></div></div>`+potStrip(s);
    setTimeout(()=>{G.verdict=b.shouldDraw(s);G.verdictKey=k;renderBrew();const bb=$("#backbtn");if(bb)bb.onclick=()=>goBack();},20);return;}
  const[draw,stop,dv]=G.exploded||!tot(s.bag)?[false,0,null]:G.verdict;
  const pe=b.explodeProb(s);const space=s.pos+1;const[coins,vp,ruby]=track(space);
  const empty=tot(s.bag)===0;
  const lastW=G.chips.length&&COLOR[G.chips[G.chips.length-1]]==="W";
  const bombs=`<span class="bombmeter">${Array.from({length:ctx.limit},(_,i)=>`<i class="${i<s.white?"on":""}${lastW&&i>=s.white-VALUE[G.chips[G.chips.length-1]]&&i<s.white?" new":""}"></i>`).join("")}</span>`;
  let verdict;
  if(G.exploded)verdict=`<div class="verdict boom"><div class="word">BOOM</div><div class="why">Pot exploded at space ${space} with ${s.white} bombs. Head to scoring.</div></div>`;
  else if(empty)verdict=`<div class="verdict stop"><div class="word">STOP</div><div class="why">Bag is empty.</div></div>`;
  else verdict=`<div class="verdict ${draw?"draw":"stop"}"><div class="word">${draw?"DRAW":"STOP"}</div>
    <div class="why">${whyVerdict(s,draw,stop,dv,pe)}</div>
    <div class="stats"><span>Bombs <b class="num">${s.white}/${ctx.limit}</b> ${bombs}</span><span>Explode next draw <b class="num">${Math.round(pe*100)}%</b></span>${ctx.target?`<span>Reach ${ctx.target}: stop <b class="num">${Math.round(stop*100)}%</b> · draw <b class="num">${Math.round(dv*100)}%</b></span>`:ctx.pay&&ctx.pay.win?`<span>Win chance: stop <b class="num">${(stop*100).toFixed(1)}%</b> · draw <b class="num">${(dv*100).toFixed(1)}%</b></span>`:`<span>Stop <b class="num">${stop.toFixed(1)}</b> · draw <b class="num">${dv.toFixed(1)}</b></span>`}</div></div>`;
  screen(hud(`Round ${G.round} · brewing`)+verdict+potStrip(s)+`
  <div class="card"><h2>${G.exploded?"Chips drawn":"Tap the chip you drew"}</h2>
    <div class="chips">${CHIPS.map((c,i)=>s.bag[i]?chipBtn(i,"",s.bag[i]):"").join("")}</div>
    <div class="legend">${tot(s.bag)} chips left in the bag · flask ${s.flask?"ready":"used"}</div>
    ${G.log.length?`<div class="log">${G.log.map(esc).join("<br>")}</div>`:""}
  </div>
  <div class="bar"><div class="in">
    <button class="ghost" id="undo" ${G.hist.length?"":"disabled"}>↶ Undo</button>
    ${G.exploded||empty?`<button class="primary" id="score">Score the round ›</button>`:`<button class="stop" id="stopb">✋ Stop &amp; score</button>`}
  </div></div>`);
  const ps=$("#potstrip");if(ps)ps.scrollLeft=ps.scrollWidth;
  if(!G.exploded)app.querySelectorAll(".chips .chip").forEach(el=>el.onclick=()=>onChip(+el.dataset.chip));
  $("#undo").onclick=()=>{const h=G.hist.pop();G.S=h.S;G.exploded=false;G.log=h.log;G.chips=h.chips;render();};
  const sc=$("#score")||$("#stopb");sc.onclick=()=>{if(!G.exploded&&ctx.safety&&tot(s.bag)>0)safetyFlow();else roundReplay();};
  if(!G.exploded&&s.mull&&tot(s.bag)<=b.mullN&&!modalEl.innerHTML)secondChances();
}
function potStrip(s){const space=s.pos+1,[coins,vp,ruby]=track(space);const n=G.chips.length;
  const strip=n?G.chips.map((i,k)=>disc(i,"md"+(k===n-1?" last"+(G.exploded?" boom":""):""))).join('<span class="arrow">›</span>'):'<span class="empty">Nothing in the pot yet</span>';
  return `<div class="card soft" style="padding:8px 12px"><div class="row" style="justify-content:space-between"><span class="muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.04em;font-size:12px">In the pot</span><span class="pill">space <b class="num">${space}</b> · ${coins} 🪙 · ${vp} ★${ruby?" · ♦":""}</span></div><div class="potstrip" id="potstrip">${strip}</div></div>`;}
// Second Chances: the 5th chip is in the pot without exploding — carry on, or put everything back and start the round over
function secondChances(){const s=G.S,b=G.brew;const restart=b.restartValue();const cont=b.V({...s,mull:false});const again=restart>cont;
  const keep=()=>{G.S={...s,mull:false};render();};
  popup({cls:"stop",icon:"🔁",title:"Second Chances",body:`You've placed your first 5 chips (space ${s.pos+1}, ${s.white} of ${G.ctx.limit} bombs). Once this round you may put all your chips back in the bag and start the round over.<div class="muted" style="margin-top:6px">Carry on ${fv(cont)} vs start over ${fv(restart)}.</div>`,onBack:()=>{closeModal();keep();},
    buttons:[{label:`Start the round over${again?" ✓ best":""}`,cls:again?"primary":"",on:()=>{pushHist();G.S={...b.start0,mull:false};G.chips=[];G.log.push("Second Chances: started the round over");render();}},
             {label:`Keep going${again?"":" ✓ best"}`,cls:again?"":"primary",on:keep}]});}
// Safety Procedure: stopped without exploding -> draw up to 5 chips, place one of them or none, then score
function safetyFlow(){const s=G.S,b=G.brew,k=Math.min(5,tot(s.bag));
  popup({cls:"stop",icon:"🧤",title:"Safety Procedure",body:`You stopped without exploding: draw <b>${plural(k,"chip")}</b> from your bag and look at them. You may place one; the rest go back.`,
    buttons:[{label:`I've drawn ${k} — show me`,cls:"primary",on:()=>pickChips(s.bag,k,"Safety Procedure: which chips did you draw?","Tap them in any order",picked=>{
      const vals=b.safetyPick(s,picked);const entries=Object.entries(vals).sort((a,b)=>b[1]-a[1]);const best=entries[0][0];
      modal(`<div class="muted">The others go back in the bag, then the round is scored.</div><div class="opts">${entries.map(([j,v])=>`<button class="opt ${j===best?"best":""}" data-pick="${j}"><span>${j==="none"?"None — put them all back":`${disc(+j)} Place ${chipName(+j)}`}${j===best?'<span class="tag">Best</span>':""}</span><span class="ev num">${fv(v)}</span></button>`).join("")}</div>`,{title:"Place which one?",onBack:()=>render()});
      modalEl.querySelectorAll("[data-pick]").forEach(el=>el.onclick=()=>{const j=el.dataset.pick;closeModal();
        if(j!=="none"){pushHist();G.S=b.placed(wo(s,+j),+j)[0];G.chips.push(+j);G.log.push("Safety Procedure: placed "+NAME(+j));}else G.log.push("Safety Procedure: placed nothing");
        roundReplay();});},()=>render())},{label:"Back",back:true,on:()=>render()}]});}

function whyVerdict(s,draw,stop,dv,pe){
  const ctx=G.ctx,space=s.pos+1,[coins,vp]=track(space);const n=tot(s.bag);
  if(ctx.target){const need=ctx.target-(ctx.baseVp+vp+Math.floor(coins/5)+Math.floor(ctx.baseRubies/2));
    if(draw)return need<=0?`You'd already reach ${ctx.target} by stopping, but drawing keeps that chance and adds insurance — no white left can hurt you enough.`:`Stopping now leaves you ${need} short of ${ctx.target}. Drawing risks a ${Math.round(pe*100)}% explosion but is the only way to get there.`;
    return need<=0?`Stopping here reaches ${ctx.target} (space ${space}: ${vp} VP + ${Math.floor(coins/5)} from coins). Drawing only adds a ${Math.round(pe*100)}% chance of throwing it away.`:`You're ${need} short and drawing doesn't improve the odds enough — take the sure result.`;}
  const safe=n-[1,2,3].reduce((a,v)=>a+s.bag[I_W[v]],0);const okWhite=[1,2,3].filter(v=>s.white+v<=ctx.limit).reduce((a,v)=>a+s.bag[I_W[v]],0);
  const keep=vp>=coins*ctx.w_coin?`${vp} VP`:`${coins} coins`;
  const win=ctx.pay&&ctx.pay.win;const gain=win?`${(100*(dv-stop)).toFixed(1)} points of win chance`:`${(dv-stop).toFixed(1)}`;const loss=win?`${(100*(stop-dv)).toFixed(1)} points of win chance`:`${(stop-dv).toFixed(1)}`;
  if(draw){
    if(pe===0)return `No bomb can blow you up on this draw (${okWhite} safe white${okWhite===1?"":"s"}, ${safe} coloured). Nothing to lose.`;
    return `${Math.round(pe*100)}% chance to explode, but even then you'd keep ${keep} from space ${space}. The other ${n-Math.round(pe*n)} chips push you further — worth ~${gain} more than stopping.`;
  }
  return `Space ${space} already pays ${coins} coins and ${vp} VP${ctx.pWinDie(space)>0.5?" with a good shot at the bonus die":""}. A ${Math.round(pe*100)}% bomb risk would cost that${G.round===ROUNDS?"":" and the shop"}; the safe chips left don't add enough to justify it (~${loss} in favour of stopping).`;
}

function pushHist(){G.hist.push({S:G.S,log:G.log.slice(),chips:G.chips.slice()});}
function undoLast(){const h=G.hist.pop();G.S=h.S;G.exploded=false;G.log=h.log;G.chips=h.chips;render();}

function onChip(i){
  const b=G.brew,sb=G.S,ctx=G.ctx;const s=wo(sb,i);const c=COLOR[i];
  const[s2,boom]=b.placed(s,i);
  pushHist();
  if(c==="W"){
    if(boom){G.S=s2;G.chips.push(i);G.exploded=true;G.log.push(`Drew ${NAME(i)} — exploded`);render();vibe([90,60,250]);
      popup({cls:"boom",icon:"💥",title:"BOOM!",body:`Exploded on <b>space ${s2.pos+1}</b> with ${s2.white} bombs. Coins <b>or</b> VP, no bonus die.`,
        buttons:[{label:"See the round ›",cls:"primary",on:roundReplay},{label:"Wait, undo that",back:true,on:undoLast}]});return;}
    if(sb.cb){ // Cauldron Bubble: the first white may go back into the bag for free
      const keep=b.V({...s2,cb:false}),ret=b.V({...sb,cb:false});G.S={...s2,cb:false};G.chips.push(i);G.log.push(`Drew ${NAME(i)}`);render();vibe(60);
      popup({cls:"stop",icon:"🫧",title:"Cauldron Bubble",body:`That's your first white this round: you may put this <b>white ${VALUE[i]}</b> back in the bag for free (your flask stays full). Bombs ${s2.white} → ${sb.white}, position back to space ${sb.pos+1}.<div class="muted" style="margin-top:6px">Keep it ${fv(keep)} vs put it back ${fv(ret)}.</div>`,
        buttons:[{label:`Put it back${ret>keep?" ✓ best":""}`,cls:ret>keep?"primary":"",on:()=>{G.S={...sb,cb:false};G.chips.pop();G.log.push("Cauldron Bubble: returned "+NAME(i));render();}},{label:`Keep it in the pot${ret>keep?"":" ✓ best"}`,cls:ret>keep?"":"primary",on:()=>render()}]});return;}
    if(sb.flask){const keep=b.V(s2),ret=b.V(b.useFlask(sb));
      if(ret>keep){G.log.push(`Drew ${NAME(i)}`);G.S=s2;G.chips.push(i);render();vibe(60);
        popup({cls:"stop",icon:"⚗️",title:"Use the flask!",body:`Put this <b>white ${VALUE[i]}</b> back in the bag and flip your flask to empty. Your bombs drop from ${s2.white} back to ${sb.white} of ${ctx.limit}, so you can keep drawing with far less risk.<div class="muted" style="margin-top:6px">Keep it ${fv(keep)} vs return it ${fv(ret)}. Refilling the flask costs 2 rubies at the end of a round.</div>`,
          buttons:[{label:"Returned it — flask is empty",cls:"primary",on:()=>{G.S=b.useFlask(sb);G.chips.pop();G.log.push("Flask: returned "+NAME(i));render();}},{label:"Keep it in the pot",on:()=>render()}]});return;}}
    G.S=s2;G.chips.push(i);G.log.push(`Drew ${NAME(i)}`);render();return;
  }
  if(c==="Y"&&s.lastw){const[s3]=b.placed(s,i,true);const keep=b.V(s2),ret=b.V(s3);G.S=s2;G.chips.push(i);G.log.push(`Drew ${NAME(i)}`);render();vibe(60);
    const doRet=()=>{G.S=s3;G.chips.splice(G.chips.length-2,1);G.log.push("Mandrake: returned W"+s.lastw);render();};
    popup({cls:"stop",icon:"🌱",title:"Mandrake!",body:`The chip before it was a <b>white ${s.lastw}</b>. You may put that white back in the bag; the mandrake takes its spot. Bombs ${s.white} → ${s.white-s.lastw}, you lose only ${plural(s.lastw,"space")}.<div class="muted" style="margin-top:6px">Keep ${fv(keep)} vs return ${fv(ret)}.</div>`,
      buttons:[{label:`Return the white ${s.lastw}${ret>keep?" ✓ best":""}`,cls:ret>keep?"primary":"",on:doRet},{label:`Keep it${ret>keep?"":" ✓ best"}`,cls:ret>keep?"":"primary",on:()=>render()}]});return;}
  if(c==="B"){G.S=s2;G.chips.push(i);G.log.push(`Drew ${NAME(i)}`);render();const k=Math.min(VALUE[i],tot(s2.bag));if(k===0)return;vibe([70,50,70,50,70]);
    popup({cls:"stop",icon:"✋",title:"STOP!",body:`Pull <b>${k} more chip${k>1?"s":""}</b> and look. Place one or none; the rest go back.`,onBack:()=>toast("Pull the chips first, then tap them"),
      buttons:[{label:`I've pulled ${k} — show me`,cls:"primary",on:()=>blueModal(s2,k)}]});return;}
  G.S=s2;G.chips.push(i);G.log.push(`Drew ${NAME(i)}`);render();
}

// tap the k chips just drawn from `bag` (crow skull, Safety Procedure, Flea Market), then `done(picked)`
function pickChips(bag,k,title,sub,done,cancel){const picked=[];
  const draw=()=>{const left=bag.slice();for(const j of picked)left[j]--;
    modal(`<div class="muted">${sub} (${picked.length}/${k}).</div>
      <div class="chips" style="margin-top:10px">${CHIPS.map((c,i)=>left[i]?chipBtn(i,"",left[i]):"").join("")}</div>
      <div class="row" style="margin-top:10px"><span class="pick">${picked.map(j=>disc(j)).join("")}</span>
      <span class="grow"></span><button class="small" id="m-clear">Clear</button></div>`,{title,onBack:()=>{if(picked.length){picked.length=0;draw();}else{closeModal();if(cancel)cancel();}}});
    modalEl.querySelectorAll(".chips .chip").forEach(el=>el.onclick=()=>{vibe(10);picked.push(+el.dataset.chip);if(picked.length===k)done(picked);else draw();});
    $("#m-clear").onclick=()=>{picked.length=0;draw();};};
  draw();}
function blueModal(s2,k){
  if(k===0)return;
  const none=()=>{G.log.push("Crow skull: placed nothing");render();};
  pickChips(s2.bag,k,`Crow skull: which ${k} did you pull?`,"Tap them in any order",picked=>{const vals=G.brew.bluePickValues(s2,picked);const entries=Object.entries(vals).sort((a,b)=>b[1]-a[1]);const best=entries[0][0];
    modal(`<div class="muted">The others go back in the bag.</div><div class="opts">${entries.map(([j,v])=>`<button class="opt ${j===best?"best":""}" data-pick="${j}"><span>${j==="none"?"None — put them all back":`${disc(+j)} Place ${chipName(+j)}${COLOR[+j]==="W"?" (+"+VALUE[+j]+" bomb"+(VALUE[+j]>1?"s":"")+")":""}`}${j===best?'<span class="tag">Best</span>':""}</span><span class="ev num">${fv(v)}</span></button>`).join("")}</div>`,{title:"Place which one?",onBack:()=>blueModal(s2,k)});
    modalEl.querySelectorAll("[data-pick]").forEach(el=>el.onclick=()=>{const j=el.dataset.pick;closeModal();
      if(j==="none"){none();return;}
      G.hist.pop(); // the blue draw and its pick count as one undo step
      onChip(+j);});},none);
}

// ---------- end of the brew: the round replayed on the pot, then scoring
function roundReplay(){
  const o=boardOpts();const chips=o.chips;const s=G.S,b=G.brew,ctx=G.ctx;const space=s.pos+1,[coins,vp,ruby]=track(space);
  const greens=(s.g1?1:0)+(s.g2?1:0),purples=b.nP-s.bag[I_P],blacks=b.nK-s.bag[I_K];
  modalEl.innerHTML=`<div class="modal center board"><div class="box">${boardSVG({...o,chips:[],scoring:null,center:[`Round ${G.round}`,`💧 ${o.droplet}${G.rats?` · 🐀 ${Math.min(LAST,o.droplet+G.rats)}`:""}`]})}<div class="rewards" id="rw"></div><div class="opts"><button class="primary" id="rp-next" style="visibility:hidden">Scoring ›</button></div></div></div>`;
  const svg=modalEl.querySelector("svg"),layer=svg.querySelector("#chips"),cells=svg.querySelector("#cells"),bl=$("#bl"),rw=$("#rw"),nextBtn=$("#rp-next");
  let k=0,timer=null,done=false;
  const next=()=>{closeModal();go("eval");};
  const finish=()=>{if(done)return;done=true;clearTimeout(timer);
    layer.innerHTML=chips.map((c,j)=>chipG(c.i,SPOTS[c.at].x,SPOTS[c.at].y,j===chips.length-1?"last"+(G.exploded?" boom":""):"")).join("");
    const cell=cells.querySelectorAll(".cell")[space];if(cell){cell.classList.add("score");cell.setAttribute("fill","url(#stoneS)");}
    svg.querySelector("#marks").insertAdjacentHTML("beforeend",`<circle class="ring" cx="${f1(SPOTS[space].x)}" cy="${f1(SPOTS[space].y)}" r="21"/>`);
    if(G.exploded){svg.classList.add("shake");$("#flash").classList.add("on");svg.querySelector("#fx").innerHTML=`<text class="boomtxt" x="${SP.W/2}" y="${SP.W/2+22}">BOOM!</text>`;vibe([90,60,250]);}
    bl.innerHTML=`<b>${G.exploded?"💥 Exploded at":"Stopped at"} space ${space}</b> · ${plural(chips.length,"chip")} in the pot`;
    const pills=[];pills.push(`<span class="rw">🪙 ${coins} coins</span>`);if(vp)pills.push(`<span class="rw vp">★ ${vp} VP</span>`);if(ruby)pills.push(`<span class="rw ruby">♦ ruby</span>`);
    if(G.exploded)pills.push(`<span class="rw bad">coins OR VP · no die</span>`);
    if(greens)pills.push(`<span class="rw ruby">🕷 +${plural(greens,"ruby")}</span>`);if(purples)pills.push(`<span class="rw">👻 purple ×${purples}</span>`);if(blacks)pills.push(`<span class="rw bad">🦋 black ×${blacks}</span>`);
    rw.innerHTML=pills.map((p,j)=>p.replace('class="rw','style="animation-delay:'+(0.35+j*0.22).toFixed(2)+'s" class="rw')).join("");
    nextBtn.style.visibility="visible";};
  const tick=()=>{if(k>=chips.length){finish();return;}const c=chips[k],{x,y}=SPOTS[c.at],last=k===chips.length-1;
    layer.insertAdjacentHTML("beforeend",chipG(c.i,x,y,"drop"+(last?" last"+(G.exploded?" boom":""):""))+`<circle class="splash" cx="${f1(x)}" cy="${f1(y)}" r="12"/>`);
    bl.innerHTML=`<b>${chipName(c.i)}</b> → space ${c.at+1}`;vibe(15);k++;timer=setTimeout(tick,k>=chips.length?600:430);};
  MODAL={onBack:()=>{if(!done)finish();else next();}};nextBtn.onclick=next;svg.onclick=()=>{if(!done)finish();};
  timer=setTimeout(tick,chips.length?450:200);
}

// ---------- evaluation
function renderEval(){
  const s=G.S,b=G.brew,ctx=G.ctx;const space=s.pos+1;const[coins,vp,ruby]=track(space);
  const greens=(s.g1?1:0)+(s.g2?1:0),purples=b.nP-s.bag[I_P],blacks=b.nK-s.bag[I_K];
  const takeVpRec=ctx.pay?((ctx.pay.win?ctx.pay.a:1)*vp+ctx.pay.get(0,0,0,!s.flask)>=ctx.pay.get(coins,0,0,!s.flask)):(vp>=coins*ctx.w_coin); // WIN model: compare in logit units
  G.ev=G.ev||{takeVp:takeVpRec,die:"none",die2:"none",moth:"droplet",toil:"none"};const e=G.ev;
  const pdie=Math.round(100*ctx.pWinDie(space));
  let purpleTxt="";if(purples>=3)purpleTxt="+2 VP, droplet +1";else if(purples===2)purpleTxt="+1 VP, +1 ruby";else if(purples===1)purpleTxt="+1 VP";
  const card=G.mods&&G.mods.card?FCARD(G.mods.card):null;
  const dieBtns=key=>`<div class="mods" style="margin-top:8px">${["none","vp1","vp2","ruby","droplet","orange"].map(f=>`<button data-${key}="${f}" class="${e[key]===f?"on":""}">${{none:"Didn't roll",vp1:"1 VP",vp2:"2 VP",ruby:"Ruby",droplet:"Droplet",orange:"Orange chip"}[f]}</button>`).join("")}</div>`;
  // Toil and Trouble: a 2-value chip if the player to your right exploded, ranked by next round's value
  const twos=ctx.toil&&G.round<ROUNDS?[IDX.G2,IDX.B2,IDX.R2,IDX.Y2].filter(i=>G.stock[i]>0).map(i=>[i,vvalue(G.round+1,withChip(G.bag,i),G.droplet,G.rubies,G.flask)]).sort((a,b)=>b[1]-a[1]):[];
  screen(hud(`Round ${G.round} · scoring`)+`
  ${card?`<div class="fc ${card.blue?"fblue":"fpurple"}"><div class="big">${card.name}</div><div class="why">${card.text}</div></div>`:""}
  <div class="card"><h2>${G.exploded?"💥 Exploded at":"Stopped at"} space ${space}</h2>
    <div class="kv"><span>🪙 Coins</span><b class="num">${coins}</b><span>★ Victory points</span><b class="num">${vp}</b><span>♦ Ruby on this space</span><b>${ruby?"yes":"no"}</b>
    ${ruby&&ctx.luckyVp?`<span>Lucky Devil</span><b>+${ctx.luckyVp} VP</b>`:""}${ruby&&ctx.fireRuby?`<span>Fire Burn</span><b>+1 extra ruby</b>`:""}
    ${!G.exploded&&ctx.white7?`<span>Bubbling Over (${s.white} whites)</span><b>${s.white===7?"droplet +1":"no bonus"}</b>`:""}
    ${greens?`<span>🕷 Green in the last two chips</span><b>+${plural(greens,"ruby")}</b>`:""}${purples?`<span>👻 Purple ×${purples}</span><b>${purpleTxt}</b>`:""}${ctx.flaskFree?`<span>Flask Rabbit</span><b>flask refilled free</b>`:""}</div></div>
  ${G.exploded&&!ctx.both?`<div class="card"><h2>Keep VP or coins?</h2><div class="muted">${vp} VP vs ${coins} coins${ctx.pay?"":` (worth ~${(coins*ctx.w_coin).toFixed(1)} VP now)`}.</div>
    <div class="opts"><button class="opt ${e.takeVp?"best":""}" data-take="vp"><span>Take the ${vp} VP${takeVpRec?'<span class="tag">Best</span>':""}</span></button><button class="opt ${!e.takeVp?"best":""}" data-take="coins"><span>Take the ${coins} coins${!takeVpRec?'<span class="tag">Best</span>':""}</span></button></div></div>`:""}
  ${G.exploded&&ctx.toil?`<div class="card muted">Toil and Trouble: the player to your <b>left</b> takes any 2-value chip from the supply (knock it off in the supply panel at the shop).</div>`:""}
  ${!G.exploded?`<div class="card"><h2>🎲 Bonus die</h2><div class="muted">Rolled it? (~${pdie}% by the model)${ctx.dieTwice?" Double Double: roll it twice.":""}</div>${dieBtns("die")}
    ${ctx.dieTwice&&e.die!=="none"?`<div class="muted" style="margin-top:8px">Second roll:</div>${dieBtns("die2")}`:""}</div>`:""}
  ${blacks?`<div class="card"><h2>🦋 Black ×${blacks}</h2><div class="muted">Compared with your neighbours' black chips:</div>
    <div class="mods" style="margin-top:8px">${["none","droplet","droplet+ruby"].map(f=>`<button data-moth="${f}" class="${e.moth===f?"on":""}">${{none:"Nothing",droplet:"Droplet +1","droplet+ruby":"Droplet +1 and ruby"}[f]}</button>`).join("")}</div></div>`:""}
  ${twos.length?`<div class="card"><h2>Toil and Trouble</h2><div class="muted">Did the player to your <b>right</b> explode? Then you take any 2-value chip:</div>
    <div class="opts">${[["none",null],...twos].map(([i,v],k)=>`<button class="opt ${String(e.toil)===String(i)?"best":""}" data-toil="${i}"><span>${i==="none"?"No, they didn't explode":`${disc(i)} ${chipName(i)}`}${k===1?'<span class="tag">Best</span>':""}</span>${v!=null?`<span class="ev num">${VMODEL&&VMODEL.win?(100*sigmoid(v+vmargin(G.round+1)*(G.vp-(G.leader||0)-VMODEL.opp_gain[G.round-1]))).toFixed(1)+"%":v.toFixed(2)}</span>`:""}</button>`).join("")}</div></div>`:""}
  <div class="bar"><div class="in"><button class="ghost" id="replay">🫕</button><button class="primary" id="go">${G.round<ROUNDS?"Score it ›":"Final score ›"}</button></div></div>`);
  app.querySelectorAll("[data-take]").forEach(el=>el.onclick=()=>{e.takeVp=el.dataset.take==="vp";render();});
  app.querySelectorAll("[data-die]").forEach(el=>el.onclick=()=>{e.die=el.dataset.die;render();});
  app.querySelectorAll("[data-die2]").forEach(el=>el.onclick=()=>{e.die2=el.dataset.die2;render();});
  app.querySelectorAll("[data-moth]").forEach(el=>el.onclick=()=>{e.moth=el.dataset.moth;render();});
  app.querySelectorAll("[data-toil]").forEach(el=>el.onclick=()=>{e.toil=el.dataset.toil==="none"?"none":+el.dataset.toil;render();});
  $("#replay").onclick=()=>boardPopup();
  $("#go").onclick=()=>{applyEval();};
}

function applyEval(){
  HIST.push(snapshot());
  const s=G.S,b=G.brew,ctx=G.ctx,e=G.ev;const space=s.pos+1;let[coins,vp,ruby]=track(space);
  let rubies=ruby+(s.g1?1:0)+(s.g2?1:0)+(ctx.fireRuby?ruby:0),extra=ctx.luckyVp*ruby;const purples=b.nP-s.bag[I_P],blacks=b.nK-s.bag[I_K];const d0=G.droplet,vp0=G.vp,r0=G.rubies;
  if(purples>=3){extra+=2;G.droplet++;}else if(purples===2){extra+=1;rubies++;}else if(purples===1)extra+=1;
  if(blacks){if(e.moth!=="none")G.droplet++;if(e.moth==="droplet+ruby")rubies++;}
  if(!G.exploded&&ctx.white7&&s.white===7)G.droplet++;
  const dieFace=f=>{if(f==="vp1")extra+=1;else if(f==="vp2")extra+=2;else if(f==="ruby")rubies++;else if(f==="droplet")G.droplet++;else if(f==="orange"){G.bag[I_O]++;if(G.stock[I_O]>0)G.stock[I_O]--;}};
  if(G.exploded&&!ctx.both){if(e.takeVp)coins=0;else vp=0;}
  else if(!G.exploded){extra+=ctx.novp;rubies+=ctx.noruby;dieFace(e.die);if(ctx.dieTwice&&e.die!=="none")dieFace(e.die2);}
  const toil=ctx.toil&&e.toil!=="none"&&e.toil!=null?e.toil:null;if(toil!=null)takeChip(toil);
  G.vp+=vp+extra;G.rubies+=rubies;G.flask=s.flask||!!ctx.flaskFree;G.coins=coins;G.ev=null;G.mods=null;G.extraWhiteDone=false;
  const rows=[];if(vp+extra)rows.push({ic:"★",l:"Victory points",sub:"move your seal on the score track",from:vp0,to:G.vp});
  if(rubies)rows.push({ic:"♦",l:"Rubies",sub:`take ${plural(rubies,"ruby")}`,from:r0,to:G.rubies});
  if(G.droplet>d0)rows.push({ic:"💧",l:"Droplet",sub:G.droplet-d0>1?`+${G.droplet-d0} from chips, die or card`:"chip, die or card effect",from:d0,to:G.droplet});
  if(e.die==="orange"||(ctx.dieTwice&&e.die!=="none"&&e.die2==="orange"))rows.push({ic:"🎃",l:"Orange chip",sub:"from the supply into your bag",txt:"+1"});
  if(toil!=null)rows.push({ic:"🧪",l:chipName(toil),sub:"Toil and Trouble: from the supply into your bag",txt:"+1"});
  if(ctx.flaskFree&&!s.flask)rows.push({ic:"⚗",l:"Flask",sub:"Flask Rabbit: flip it back to full for free",txt:"full"});
  if(G.round<ROUNDS)rows.push({ic:"🪙",l:"Coins for the shop",sub:"they don't carry over",txt:String(coins)});
  const next=()=>{if(G.round<ROUNDS){G.screen="shop";G.shop=null;render();}else{G.screen="final";render();}};
  resultsPopup({cls:"go",icon:"📜",title:`Round ${G.round} scored`,rows,board:G.droplet>d0?{from:d0,to:G.droplet}:null,button:{label:G.round<ROUNDS?"Done — go shopping ›":"Done — final score ›",on:next}});
}

// ---------- shop
function rubyPlan(bagAfter,rubies,drop0){ // -> {steps, refill, alts:[{steps,refill,v}]}
  const rnd=G.round,alts=[];
  if(VMODEL){for(let st=0;st<=Math.floor(rubies/2);st++)for(const rf of[false,true]){if(rf&&(G.flask||rubies-2*st<2))continue;
      alts.push({steps:st,refill:rf,v:vvalue(rnd+1,bagAfter,drop0+st,rubies-2*st-(rf?2:0),G.flask||rf)});}
    alts.sort((a,b)=>b.v-a.v);return{steps:alts[0].steps,refill:alts[0].refill,alts};}
  const acts=rubyAdvice(bagAfter,rubies,rnd,drop0,G.flask,G.vp);
  return{steps:acts.filter(a=>a==="droplet").length,refill:acts.includes("flask"),alts:[]};}
function renderShop(){
  SHOP.stock=G.stock;
  if(!G.shop){app.innerHTML=hud(`Round ${G.round} · shop`)+`<div class="card thinking"><div class="thinkduck">${duck("chomp")}<div><b style="font-size:18px;color:var(--ink)">Crunching the numbers…</b><br>Working out the best buy</div></div></div>`;
    setTimeout(()=>{
      let ranked;
      if(VMODEL){ // rank every purchase by whole-game value (rubies spent optimally for each)
        ranked=purchaseOptions(G.coins,G.round).map(o=>{const b=G.bag.slice();for(const i of o)b[i]++;
          let best=-Infinity;for(let st=0;st<=Math.floor(G.rubies/2);st++)for(const rf of[false,true]){if(rf&&(G.flask||G.rubies-2*st<2))continue;
            best=Math.max(best,vvalue(G.round+1,b,G.droplet+st,G.rubies-2*st-(rf?2:0),G.flask||rf));}
          return[o,best];}).sort((a,b)=>b[1]-a[1]);
      }else ranked=bestPurchase(G.bag,G.coins,G.round,G.droplet,G.flask,G.vp);
      G.shop={ranked,bought:ranked[0][0]};render();},30);return;}
  const sh=G.shop;const boughtKey=o=>o.join("-");
  const label=o=>o.length?o.map(i=>`${disc(i)} ${chipName(i)}`).join(" + "):"Nothing";
  const base=sh.ranked.find(([o])=>o.length===0);const baseEv=base?base[1]:0;
  // WIN model: show each option as an estimated win chance (margin projected with the mean opponent gain this round)
  const winPct=VMODEL&&VMODEL.win?v=>(100*sigmoid(v+vmargin(G.round+1)*(G.vp-(G.leader||0)-VMODEL.opp_gain[G.round-1]))).toFixed(1)+"%":null;
  const why=o=>{if(!o.length)return "Nothing here is worth its price right now (coins don't carry over, so this is rare).";
    const parts=[...new Set(o.map(i=>COLOR[i]))].map(c=>WHY[c]);return parts.join(" ");};
  const bagAfter=G.bag.slice();for(const i of sh.bought)bagAfter[i]++;
  const rubiesNow=G.rubies;const plan=rubyPlan(bagAfter,rubiesNow,G.droplet);
  sh.drop=sh.drop??plan.steps;sh.refill=sh.refill??plan.refill;
  const spend=2*sh.drop+(sh.refill?2:0);const recSpend=2*plan.steps+(plan.refill?2:0);
  const soldOutNow=BUYABLE.filter(i=>!G.stock[i]);
  let coachBig,coachWhy;
  if(rubiesNow<2){coachBig=`Hold your ${rubiesNow===1?"ruby":"rubies"} — you need 2 to spend.`;coachWhy="Leftover pairs are worth 1 VP each at the end.";}
  else if(plan.steps||plan.refill){const parts=[];if(plan.steps)parts.push(`move your droplet ${plan.steps>1?plan.steps+" steps ":""}to space ${G.droplet+plan.steps}`);if(plan.refill)parts.push("flip your flask back to full");
    coachBig=`Pay ${recSpend} rubies now: ${parts.join(" and ")}.`;
    coachWhy=(plan.steps?"A droplet step is permanent — every remaining brew starts a space further along, which is worth more than the 1 VP the pair would cash in for at the end. ":"")+(plan.refill?"With an empty flask you have no bomb take-back next round; refilling is worth more than holding the rubies. ":"")+`Keep ${rubiesNow-recSpend}.`;}
  else{coachBig=`Hold all ${rubiesNow} rubies.`;coachWhy=`Every 2 rubies become 1 VP at the end of round 9${G.round>=7?", which is close now":""}; a droplet step${G.flask?"":" or a flask refill"} is worth less than that from here.`;}
  screen(hud(`Round ${G.round} · shop`)+`
  <div class="card"><h2>🪙 ${G.coins} coins to spend</h2><div class="muted" style="margin-bottom:6px"><b>Tap what you actually bought.</b>${soldOutNow.length?` <b>Sold out:</b> ${soldOutNow.map(chipName).join(", ")} — already left out.`:""}</div>
    <div class="opts">${sh.ranked.slice(0,7).map(([o,v],n)=>`<button class="opt ${boughtKey(o)===boughtKey(sh.bought)?"best":""}" data-buy="${n}"><span>${label(o)}${n===0?'<span class="tag">Best</span>':""}${boughtKey(o)===boughtKey(sh.bought)?'<span class="tag gold">✓ bought</span>':""}<div class="muted">${cost(o)} coins${o.length?` · left in box: ${o.map(i=>`${VALUE[i]} ${CNAME[COLOR[i]]} ×${G.stock[i]}`).join(", ")}`:""} · ${winPct?`win chance ${winPct(v)} (nothing: ${winPct(baseEv)})`:`${VMODEL?"rest of game":"next round"} +${(v-baseEv).toFixed(2)} over buying nothing`}</div>${n===0||boughtKey(o)===boughtKey(sh.bought)?`<div class="muted" style="margin-top:4px">${why(o)}</div>`:""}</span><span class="ev num">${winPct?winPct(v):v.toFixed(2)}</span></button>`).join("")}</div></div>
  <div class="card"><h2>♦ Rubies: ${rubiesNow} <span class="gems">${Array.from({length:Math.min(rubiesNow,8)},(_,k)=>`<i class="${k<spend?"spent":""}"></i>`).join("")}</span></h2>
    <div class="coach ${plan.steps||plan.refill?"":"hold"}"><div class="big">${coachBig}</div><div class="why">${coachWhy}</div></div>
    ${plan.alts.length>1&&winPct?`<div class="muted" style="margin-top:8px">${plan.alts.slice(0,4).map(a=>`${a.steps?`droplet +${a.steps}`:""}${a.steps&&a.refill?" + ":""}${a.refill?"refill":""}${!a.steps&&!a.refill?"hold":""}: ${winPct(a.v)}`).join(" · ")}</div>`:""}
    <div style="margin-top:10px">${stepper("drop","Droplet steps",sh.drop,0,Math.floor(rubiesNow/2),`2 rubies each → droplet on ${G.droplet+sh.drop}`)}</div>
    ${!G.flask?`<div class="row" style="margin-top:8px"><span class="grow">Refill flask (2 rubies)</span>${segBtns("refill",[[1,"Yes"],[0,"No"]],sh.refill?1:0)}</div>`:""}
    <div class="muted" style="margin-top:6px">${spend>rubiesNow?"<b>Not enough rubies for that.</b>":`Spending ${spend}, keeping ${rubiesNow-spend}.`}</div></div>
  <details class="card"><summary>Chip supply <span class="muted">${soldOutNow.length?soldOutNow.length+" sold out":"tap − for chips others bought"}</span></summary>
    <div class="muted" style="margin:8px 0">Knock off what the others bought (yours comes off on Next).</div>${stockEditor()}</details>
  <div class="bar"><div class="in"><button class="primary" id="go" ${spend>rubiesNow?"disabled":""}>Next: round ${G.round+1} ›</button></div></div>`);
  app.querySelectorAll("[data-buy]").forEach(el=>el.onclick=()=>{sh.bought=sh.ranked[+el.dataset.buy][0];sh.drop=undefined;sh.refill=undefined;vibe(10);render();});
  bindSteppers(app,(id,n)=>{sh.drop=n;render();});bindSegs(app,(id,v)=>{sh.refill=v==="1";render();});
  bindStock(()=>{G.shop=null;render();});
  $("#go").onclick=()=>{
    HIST.push(snapshot());
    const rows=[];const gone=[];
    for(const i of sh.bought){G.bag[i]++;if(G.stock[i]>0)G.stock[i]--;if(!G.stock[i])gone.push(chipName(i));}
    for(const i of sh.bought)rows.push({ic:disc(i),l:chipName(i),sub:"from the supply into your bag",txt:"+1"});
    if(!sh.bought.length)rows.push({ic:"🛒",l:"Nothing bought",sub:"coins are lost",txt:"—"});
    const d0=G.droplet,r0=G.rubies;G.droplet+=sh.drop;G.rubies-=spend;if(sh.refill)G.flask=true;
    if(sh.drop)rows.push({ic:"💧",l:"Droplet",sub:`pay ${2*sh.drop} rubies and move it forward`,from:d0,to:G.droplet});
    if(sh.refill)rows.push({ic:"⚗",l:"Flask",sub:"pay 2 rubies and flip it to full",txt:"full"});
    rows.push({ic:"♦",l:"Rubies left",sub:spend?`${spend} spent`:"none spent",from:r0,to:G.rubies});
    for(const g of gone)rows.push({ic:"🚫",l:`${g} sold out`,sub:"nobody can buy it for the rest of the game",txt:"0"});
    G.lastShop={text:`bought ${sh.bought.length?sh.bought.map(chipName).join(" + "):"nothing"}${sh.drop?`; droplet ${d0} → ${G.droplet} (${sh.drop*2} rubies)`:""}${sh.refill?"; flask refilled (2 rubies)":""}; rubies left ${G.rubies}`};
    resultsPopup({cls:"go",icon:"🛒",title:"At the table",rows,board:sh.drop?{from:d0,to:G.droplet}:null,button:{label:`On to round ${G.round+1} ›`,on:()=>{G.round++;G.screen="prebrew";render();}}});};
}

function renderFinal(){
  const coins=G.coins,bonus=Math.floor(coins/5)+Math.floor(G.rubies/2);const total=G.vp+bonus;
  screen(hud("Final score")+`
  <div class="card" style="text-align:center"><div class="muted" style="font-weight:800;text-transform:uppercase;letter-spacing:.06em">Your final score</div><div class="bigscore num" id="final-n">0</div>
  <div class="tally">
    <div class="tr" style="animation-delay:.2s"><span class="ic">★</span><span class="tl">On the score track</span><span class="tv num">${G.vp}</span></div>
    <div class="tr" style="animation-delay:.5s"><span class="ic">🪙</span><span class="tl">${coins} coins<small>5 coins = 1 VP</small></span><span class="tv num">+${Math.floor(coins/5)}</span></div>
    <div class="tr" style="animation-delay:.8s"><span class="ic">♦</span><span class="tl">${plural(G.rubies,"ruby")}<small>2 rubies = 1 VP</small></span><span class="tv num">+${Math.floor(G.rubies/2)}</span></div>
  </div></div>
  <div class="card muted">Final bag: ${fmtBag(G.bag)}</div>
  <div class="bar"><div class="in"><button class="primary" id="new">New game</button></div></div>`);
  const n=$("#final-n"),t0=performance.now()+300;const tick=now=>{const p=Math.min(1,Math.max(0,(now-t0)/1200));n.textContent=Math.round(total*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(tick);};requestAnimationFrame(tick);
  setTimeout(confetti,400);
  $("#new").onclick=()=>popup({cls:"stop",icon:"🧙",title:"New game?",body:"This clears the current game.",buttons:[{label:"Start a new game",cls:"primary",on:newGame},{label:"Keep this one",back:true}]});
}

fabEl.onclick=()=>boardPopup();
newGame();
// splash: the duck greets you for a moment (tap to skip)
(()=>{const sp=$("#splash");if(!sp)return;const hide=()=>{sp.classList.add("gone");setTimeout(()=>sp.remove(),600);};sp.onclick=hide;setTimeout(hide,1600);})();
