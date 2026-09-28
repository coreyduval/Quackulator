// Screenshot driver: state chosen by the page's ?shot= query
const which=(location.search.match(/shot=(\w+)/)||[])[1]||"setup";
const tap=el=>el.dispatchEvent(new MouseEvent("click",{bubbles:true}));
async function toBrew(chips){newGame();G.round=3;G.vp=5;G.leader=8;G.rubies=3;G.droplet=2;G.startedRound=3;G.promptedRound=3;G.cardRound=3;G.screen="prebrew";render();await sleep(50);
  document.querySelector("#go").click();await sleep(400);for(const c of chips){onChip(IDX[c]);await sleep(350);}}
(async()=>{
  if(which==="setup"){}
  if(which==="splash"){const sp=document.querySelector("#splash");if(sp){sp.onclick=null;const id=setTimeout(()=>{});for(let i=0;i<=id;i++)clearTimeout(i);}}
  if(which==="think"){newGame();G.round=2;G.coins=10;G.screen="shop";G.shop=null;render();const id=setTimeout(()=>{});for(let i=0;i<=id;i++)clearTimeout(i);}
  if(which==="wizard"){newGame();G.round=3;G.vp=5;G.rubies=3;G.startedRound=3;G.screen="prebrew";render();await sleep(50);}
  if(which==="wizard3"){newGame();G.round=3;G.vp=5;G.rubies=3;G.startedRound=3;G.screen="prebrew";render();await sleep(50);document.querySelector("#wok").click();document.querySelector("#wok").click();await sleep(50);}
  if(which==="prebrew"){newGame();G.round=3;G.vp=5;G.leader=8;G.rubies=3;G.droplet=2;G.startedRound=3;G.promptedRound=3;G.screen="prebrew";render();await sleep(50);modalEl.querySelector("[data-card='pumpkin']").click();await sleep(50);}
  if(which==="brew"){await toBrew(["O1","W1","G1","W2"]);}
  if(which==="board"){await toBrew(["O1","W1","G1","W2","O1"]);fabEl.click();await sleep(50);}
  if(which==="replay"){await toBrew(["O1","W1","G1","W2","O1"]);document.querySelector("#stopb").click();await sleep(3000);}
  if(which==="boom"){await toBrew(["W3","W2","W3"]);modalEl.querySelector("[data-pb='0']").click();await sleep(3000);}
  if(which==="eval"){await toBrew(["O1","W1","G1","W2","O1"]);document.querySelector("#stopb").click();await sleep(100);tap(modalEl.querySelector("svg"));await sleep(50);document.querySelector("#rp-next").click();await sleep(100);}
  if(which==="tally"){await toBrew(["O1","W1","G1","W2","O1"]);document.querySelector("#stopb").click();await sleep(100);tap(modalEl.querySelector("svg"));await sleep(50);document.querySelector("#rp-next").click();await sleep(100);app.querySelector("[data-die='droplet']").click();await sleep(50);document.querySelector("#go").click();await sleep(2500);}
  if(which==="shop"){await toBrew(["O1","W1","G1","W2","O1"]);document.querySelector("#stopb").click();await sleep(100);tap(modalEl.querySelector("svg"));await sleep(50);document.querySelector("#rp-next").click();await sleep(100);document.querySelector("#go").click();await sleep(100);document.querySelector("#rs-next").click();await sleep(400);}
  if(which==="final"){await toBrew(["O1","W1","G1"]);G.round=9;render();await sleep(50);document.querySelector("#stopb").click();await sleep(100);tap(modalEl.querySelector("svg"));await sleep(50);document.querySelector("#rp-next").click();await sleep(100);document.querySelector("#go").click();await sleep(100);document.querySelector("#rs-next").click();await sleep(1800);}
  document.title="READY";
})();
