// Drives the new app flows in headless Chrome; results land in <pre id="testlog">.
const LOG=[];window.onerror=(m,src,l,c,e)=>LOG.push("JSERROR "+m+" @"+l+":"+c+" "+(e&&e.stack));const log=(...a)=>LOG.push(a.join(" "));
const ok=(cond,msg)=>log((cond?"PASS":"FAIL")+" "+msg);
const mtext=()=>modalEl.textContent.replace(/\s+/g," ").trim();
const atext=()=>app.textContent.replace(/\s+/g," ").trim();
const click=sel=>{const el=document.querySelector(sel);if(!el){log("FAIL no element "+sel);return false;}el.click();return true;};
const clickText=(root,txt)=>{const el=[...root.querySelectorAll("button")].find(b=>b.textContent.includes(txt)&&!b.disabled);if(!el){log("FAIL no button '"+txt+"'");return false;}el.click();return true;};
const stepInc=(root,id,n=1)=>{const st=root.querySelector(`.step[data-step='${id}']`);if(!st){log("FAIL no stepper "+id);return;}for(let i=0;i<n;i++)st.querySelector("[data-plus]").click();};
const tap=el=>el.dispatchEvent(new MouseEvent("click",{bubbles:true}));
(async()=>{try{
  // ---- setup: steppers instead of number boxes; back disabled at the root
  ok(G.screen==="setup"&&app.querySelector("#backbtn").disabled,"setup: back button present but disabled at the root");
  ok(window.quackBack()===false,"quackBack() returns false at the root (Android exits)");
  stepInc(app,"vp",3);stepInc(app,"rub",1);ok(G.vp===3&&G.rubies===2,"setup steppers change VP/rubies ("+G.vp+"/"+G.rubies+")");
  click("#go");await sleep(80);
  ok(G.screen==="prebrew"&&G.round===1,"start -> prebrew round 1");
  ok(modalEl.querySelector("[data-card='choices']"),"round 1: fortune picker opens (no check-in wizard in round 1)");
  ok(!app.querySelector("#backbtn").disabled,"back button enabled on prebrew");
  click("[data-card='']");await sleep(50);ok(!modalEl.innerHTML&&G.cardRound===1,"skip card closes the picker");
  ok(atext().includes("This round")&&atext().includes("Edit"),"prebrew shows the round summary with Edit");
  // ---- brewing
  click("#go");await sleep(400);
  ok(G.screen==="brew"&&G.ctx&&G.brew,"start brewing -> brew screen");
  ok(atext().includes("Nothing in the pot yet"),"pot strip empty at the start");
  onChip(IDX.O1);await sleep(350);onChip(IDX.W1);await sleep(350);onChip(IDX.G1);await sleep(350);
  ok(app.querySelectorAll("#potstrip .disc").length===3&&G.chips.length===3,"pot strip shows the 3 chips drawn");
  ok(app.querySelector("#potstrip .disc.last"),"last chip highlighted");
  click("#undo");await sleep(350);ok(G.chips.length===2,"undo removes the last chip");
  onChip(IDX.G1);await sleep(350);
  // back from a brew with chips asks first
  window.quackBack();await sleep(50);ok(mtext().includes("Leave the brew"),"back during a brew asks to confirm");
  clickText(modalEl,"Stay");await sleep(50);ok(G.screen==="brew"&&G.chips.length===3,"stay keeps the brew");
  // ---- stop -> animated replay -> scoring
  click("#stopb");await sleep(50);
  ok(modalEl.querySelector("svg.spiral")&&modalEl.querySelector("#rp-next"),"stop opens the replay popup with the pot");
  await sleep(2500);
  ok(modalEl.querySelectorAll("#chips .chipg").length===3,"replay dropped all 3 chips into the pot");
  ok(modalEl.querySelector("#rw .rw")&&mtext().includes("coins"),"replay shows the payout pills");
  ok(getComputedStyle(modalEl.querySelector("#rp-next")).visibility==="visible","continue button appears after the replay");
  click("#rp-next");await sleep(80);
  ok(G.screen==="eval"&&atext().includes("Stopped at space"),"replay -> scoring screen");
  const vpBefore=G.vp;app.querySelector("[data-die='vp1']").click();await sleep(50);
  // back from scoring returns to the brew with the chips intact
  window.quackBack();await sleep(400);ok(G.screen==="brew"&&G.chips.length===3&&G.brew,"back from scoring -> brew with chips intact");
  click("#stopb");await sleep(50);tap(modalEl.querySelector("svg"));await sleep(100);click("#rp-next");await sleep(80);
  app.querySelector("[data-die='vp1']").click();await sleep(50);
  click("#go");await sleep(50);
  ok(modalEl.querySelector(".tally .tr")&&mtext().includes("Round 1 scored"),"score it -> animated tally popup");
  await sleep(1500);
  ok(G.vp===vpBefore+1,"VP applied (die 1 VP): "+G.vp);
  const vpAfter=G.vp;
  // back from the tally undoes the scoring
  window.quackBack();await sleep(80);ok(G.screen==="eval"&&G.vp===vpBefore,"back from the tally -> scoring screen, VP restored");
  click("#go");await sleep(50);clickText(modalEl,"go shopping");await sleep(200);
  ok(G.screen==="shop"&&G.vp===vpAfter,"done -> shop");
  ok(app.querySelector("[data-buy]"),"shop ranks purchases");
  // back from the shop -> scoring
  window.quackBack();await sleep(80);ok(G.screen==="eval"&&G.vp===vpBefore,"back from the shop -> scoring with VP restored");
  click("#go");await sleep(50);clickText(modalEl,"go shopping");await sleep(200);
  click("#go");await sleep(50);ok(mtext().includes("At the table"),"shop next -> at-the-table tally");
  clickText(modalEl,"On to round 2");await sleep(80);
  // ---- round 2: the check-in wizard, one question per step
  ok(G.round===2&&G.screen==="prebrew","round 2 prebrew");
  ok(modalEl.querySelector(".wiz")&&mtext().includes("Best opponent's VP"),"wizard opens on best opponent's VP");
  const dots=modalEl.querySelectorAll(".dots i").length;ok(dots===5,"wizard has 5 steps ("+dots+")");
  // back at step 1 returns to the shop
  window.quackBack();await sleep(80);ok(G.screen==="shop"&&G.round===1,"wizard back at step 1 -> previous round's shop");
  click("#go");await sleep(50);clickText(modalEl,"On to round 2");await sleep(80);
  ok(modalEl.querySelector(".wiz"),"wizard again after going forward");
  const Ldef=G.leader??OPP.leader_vp[2];modalEl.querySelector("[data-winc]").click();modalEl.querySelector("[data-winc]").click();
  const L0=(G.leader??OPP.leader_vp[2]);ok($("#wok").textContent.includes("Yes, "+(Ldef+2))&&!$("#wok").classList.contains("attn"),"+ twice: confirm button reads the new value");
  click("#wok");await sleep(50);ok(G.leader===Ldef+2,"leader confirmed = "+G.leader);
  ok(mtext().includes("Your droplet"),"step 2: droplet");
  click("#wboard");await sleep(50);ok(modalEl.querySelector("svg.spiral.tap"),"tap-on-the-pot board opens");
  tap(modalEl.querySelector("[data-sp='3']"));await sleep(50);ok(G.droplet===3&&mtext().includes("💧 3"),"tapped space 3 -> droplet 3");
  click("#bclose");await sleep(50);ok(mtext().includes("Your droplet")&&$("#wv-v").textContent==="3","back in the wizard at the droplet step showing 3");
  click("#wok");await sleep(50);ok(mtext().includes("Your stuff"),"step 3: your stuff");
  const R0=G.rubies;stepInc(modalEl,"rub",1);modalEl.querySelector(".seg[data-seg='flask'] [data-v='0']").click();
  ok(G.rubies===R0+1&&G.flask===false,"stuff step: rubies + and flask empty");
  click("#wok");await sleep(50);ok(mtext().includes("black chips"),"step 4: neighbours' blacks");
  stepInc(modalEl,"nb1",2);click("#wok");await sleep(50);ok(G.nb[1]===2,"right neighbour blacks = 2");
  ok(mtext().includes("Rat tails"),"step 5: rat tails");
  click("#wok");await sleep(80);
  ok(G.promptedRound===2&&modalEl.querySelector("[data-card='choices']"),"wizard done -> fortune picker");ok(NB[1]===2,"neighbour blacks exported to the model after render");
  click("[data-card='choices']");await sleep(50);ok(modalEl.querySelector("[data-fo]"),"Choices opens the ranked options");
  window.quackBack();await sleep(50);ok(!G.mods.card&&!G.usedCards.includes("choices"),"back from a card's options un-chooses the card");
  click("#pickcard");await sleep(50);click("[data-card='drop']");await sleep(50);ok(G.droplet===4,"Drop It: droplet 3 -> 4");
  ok(atext().includes("Best opponent's VP")&&atext().includes("2"),"prebrew summary shows the leader");
  click("#edit");await sleep(50);ok(modalEl.querySelector(".wiz"),"Edit reopens the wizard");
  window.quackBack();await sleep(50);ok(!modalEl.innerHTML&&G.screen==="prebrew","back from an edit just closes it");
  // ---- BOOM replay + blue chip flow
  click("#go");await sleep(400);ok(G.screen==="brew","round 2 brewing");
  G.S.bag[IDX.W3]+=3;onChip(IDX.W3);await sleep(350);onChip(IDX.W3);await sleep(350);onChip(IDX.W3);await sleep(350);
  ok(G.exploded&&mtext().includes("BOOM"),"exploded: BOOM popup");
  clickText(modalEl,"See the round");await sleep(2500);
  ok(modalEl.querySelector(".boomtxt")&&modalEl.querySelector("svg").classList.contains("shake"),"replay shows the explosion");
  click("#rp-next");await sleep(80);ok(G.screen==="eval"&&atext().includes("Keep VP or coins"),"exploded scoring asks VP or coins");
  window.quackBack();await sleep(400);click("#undo");await sleep(350);click("#undo");await sleep(350);click("#undo");await sleep(350);
  ok(G.chips.length===0&&!G.exploded,"undone back to an empty pot");
  G.S.bag[IDX.B2]++;onChip(IDX.B2);await sleep(350);ok(mtext().includes("STOP!")&&mtext().includes("Pull"),"blue chip: STOP popup");
  window.quackBack();await sleep(50);ok(mtext().includes("STOP!"),"back can't dismiss the crow-skull prompt");
  clickText(modalEl,"show me");await sleep(50);
  modalEl.querySelector(`.chips [data-chip='${IDX.O1}']`).click();await sleep(30);modalEl.querySelector(`.chips [data-chip='${IDX.G1}']`).click();await sleep(350);
  ok(modalEl.querySelector("[data-pick]"),"pick which one to place");clickText(modalEl,"green 1");await sleep(400);
  ok(G.chips.length===2&&G.S.pos===G.start+3,"placed the green 1 after the blue 2");
  // ---- board popup from the fab
  fabEl.click();await sleep(50);ok(modalEl.querySelector("svg.spiral")&&modalEl.querySelectorAll("#chips .chipg").length===2,"fab opens the pot with the chips");
  click("#bclose");await sleep(50);
  // ---- final round + score
  click("#stopb");await sleep(50);tap(modalEl.querySelector("svg"));await sleep(100);click("#rp-next");await sleep(80);
  G.round=9;render();await sleep(50);click("#go");await sleep(50);clickText(modalEl,"final score");await sleep(300);
  ok(G.screen==="final"&&app.querySelector("#final-n"),"final score screen");
}catch(e){log("EXCEPTION "+e.stack);}
const pre=document.createElement("pre");pre.id="testlog";pre.textContent=LOG.join("\n");document.body.appendChild(pre);})();
