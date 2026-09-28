// ============================================================ DATA
const TRACK=[[0,0,0],[1,0,0],[2,0,0],[3,0,0],[4,0,0],[5,0,1],[6,1,0],[7,1,0],[8,1,0],[9,1,1],[10,2,0],[11,2,0],[12,2,0],[13,2,1],[14,3,0],[15,3,0],[15,3,1],[16,3,0],[16,4,0],[17,4,0],[17,4,1],[18,4,0],[18,5,0],[19,5,0],[19,5,1],[20,5,0],[20,6,0],[21,6,0],[21,6,1],[22,7,0],[22,7,1],[23,7,0],[23,8,0],[24,8,0],[24,8,1],[25,9,0],[25,9,1],[26,9,0],[26,10,0],[27,10,0],[27,10,1],[28,11,0],[28,11,1],[29,11,0],[29,12,0],[30,12,0],[30,12,1],[31,12,0],[31,13,0],[32,13,0],[32,13,1],[33,14,0],[33,14,1],[35,15,0]];
const LAST=TRACK.length-1;
const track=s=>TRACK[Math.min(s,LAST)];
const CHIPS=[["W",1],["W",2],["W",3],["O",1],["G",1],["G",2],["G",4],["B",1],["B",2],["B",4],["R",1],["R",2],["R",4],["Y",1],["Y",2],["Y",4],["P",1],["K",1]];
const N=CHIPS.length, COLOR=CHIPS.map(c=>c[0]), VALUE=CHIPS.map(c=>c[1]);
const IDX={}; CHIPS.forEach((c,i)=>IDX[c[0]+c[1]]=i);
const NAME=i=>COLOR[i]+VALUE[i];
const CNAME={W:"white",O:"orange",G:"green",B:"blue",R:"red",Y:"yellow",P:"purple",K:"black"};
const PIC={W:"cherry bomb",O:"pumpkin",G:"spider",B:"crow skull",R:"toadstool",Y:"mandrake",P:"ghost's breath",K:"moth"};
const WHY={
  O:"Cheapest safe chip. Dilutes the bombs and feeds red's bonus (+1 space with 1–2 orange in the pot, +2 with 3+).",
  G:"Safe mover that pays a ruby when it's one of your last two chips — rubies buy droplet steps.",
  B:"Peek at 1/2/4 chips and place the best one — extra movement with no bomb risk.",
  R:"Moves its value plus a bonus when orange chips are already in the pot.",
  Y:"Lets you throw the last white back into the bag — a bomb eraser that keeps you drawing.",
  P:"End of round: 1 = 1 VP, 2 = 1 VP + ruby, 3+ = 2 VP + droplet step.",
  K:"End of round: more black than your neighbours = droplet step (+ ruby if you beat both)."};
const PRICES={O1:3,G1:4,G2:8,G4:14,B1:5,B2:10,B4:19,R1:6,R2:10,R4:16,Y1:8,Y2:12,Y4:18,P1:9,K1:10};
const UNLOCK={O:1,G:1,B:1,R:1,Y:2,P:3,K:1};
// chips in the box (215). The supply is shared by the table; a sold-out chip cannot be bought.
const STOCK={W1:20,W2:8,W3:4,O1:20,G1:15,G2:10,G4:13,B1:14,B2:10,B4:10,R1:12,R2:8,R4:10,Y1:13,Y2:6,Y4:10,P1:15,K1:18};
const START_RUBIES=1; // every player starts with one ruby
const BUYABLE=Object.keys(PRICES).map(k=>IDX[k]);
const START_BAG=()=>{const b=new Array(N).fill(0);b[IDX.W1]=4;b[IDX.W2]=2;b[IDX.W3]=1;b[IDX.O1]=1;b[IDX.G1]=1;return b;};
const ROUNDS=9, EXTRA_WHITE_ROUND=6;
const initialStock=players=>{const sb=START_BAG();return CHIPS.map((c,i)=>Math.max(0,STOCK[NAME(i)]-sb[i]*players));};
const BONUS_DIE=["vp1","vp1","vp2","ruby","droplet","orange"];
const OPP={n:2,leader_vp:[0,0,3,5,8,12,18,25,34,46],best_space_mean:[0,9.7,12.8,15.1,18.6,23.4,27.7,34.4,41.8,45.9],best_space_sd:4.3,p_survive:0.65,opp_black:[0,0.03,0.48,0.85,0.86,0.82,0.76,0.81,0.86,0.87]};
const RAT_TAIL_VP=[1,3,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,50];
const WEIGHTS={coin:[0,.55,.52,.48,.44,.40,.35,.30,.25,.20],ruby:[0,1.2,1.15,1.1,1.05,1,.9,.8,.65,.5],droplet:[0,3,2.7,2.4,2.1,1.8,1.5,1.1,.7,0],orange:[0,1.6,1.45,1.3,1.15,1,.8,.6,.35,0]};
const I_O=IDX.O1,I_P=IDX.P1,I_K=IDX.K1,I_W=[null,IDX.W1,IDX.W2,IDX.W3];

// ============================================================ LEARNED VALUE FUNCTION (optional)
// Filled in by rust/install_weights.py from a trained weights.json; null = v1 heuristic rates.
const VMODEL={"rounds":[[-1.076509,0.0,0.0,0.0,-0.001454,-0.002772,0.00259,0.020918,-0.003375,0.009356,0.0,-0.004774,0.0,0.0,0.0,0.0,0.0,0.0,0.006619,0.0,0.0,0.0,-0.004362,-0.003138,0.00259,0.020918,-0.003375,0.009356,0.0,-0.004774,0.0,0.0,0.0,0.0,0.0,0.0,0.006619,0.024812,-0.00271,0.011441,0.0,0.0,0.027107,-0.004774,-0.002108,0.005475,0.0,0.0,0.0,0.0],[-2.127836,0.0,0.0,0.0,-0.085918,-0.064914,0.063071,0.16003,-0.102069,0.066037,0.0,-0.090301,0.033177,0.0,-0.051269,0.238491,0.0,0.0,0.105495,0.0,0.0,0.0,-0.009903,-0.018346,-0.020943,0.078163,0.021716,0.040959,0.0,0.015078,0.033177,0.0,-0.051269,-0.160499,0.0,0.0,-0.097666,0.227896,-0.004722,0.077509,0.030655,-0.0,0.27183,0.000348,-0.006456,0.025453,0.036673,0.064821,0.137812,0.078864],[-3.023347,0.0,0.0,0.0,-0.157497,-0.153449,0.026939,0.210609,-0.096208,0.117254,0.0,-0.124412,0.054648,0.237121,-0.102848,0.204309,0.0,0.122013,-0.008601,-0.0,0.0,0.0,-0.001594,-0.000533,-0.017676,0.076418,0.0051,0.017404,0.0,0.007223,-0.018005,0.237121,-0.044177,-0.188823,0.0,-0.006293,-0.05157,0.23341,0.004119,0.104015,0.049017,-0.0,0.329877,0.007601,-0.02888,0.04114,0.07573,0.051001,0.21156,0.145131],[-3.870744,0.0,0.0,0.0,-0.132235,-0.142958,-0.00237,0.313806,-0.063313,0.162581,-0.041685,-0.149712,0.050663,0.287089,-0.134972,0.151985,0.0,0.113746,-0.093235,0.0,0.0,0.0,-0.007266,-0.004223,-0.004469,0.004097,-0.007366,0.00086,-0.041685,0.001879,-0.020576,-0.021982,-0.001637,-0.106303,0.0,0.003544,-0.02075,0.200838,0.006948,0.086015,0.082685,0.0,0.319391,0.030379,0.033038,0.052586,0.066329,0.059261,0.176856,0.090762],[-4.527571,0.0,0.0,0.0,-0.181155,-0.133792,-0.005953,0.300534,-0.062167,0.148212,0.106441,-0.168503,-0.025866,0.382076,-0.156263,0.140985,-0.055223,0.124778,-0.102635,0.0,0.0,0.0,0.001399,-0.007561,-0.011065,-0.007114,-0.011131,-0.000567,0.394673,0.007463,0.004453,-0.049371,0.009188,-0.101788,-0.055223,-0.011373,-0.017428,0.167355,0.006623,0.078413,0.13039,0.0,0.31147,0.025822,0.006616,0.066137,0.042721,0.048409,0.146152,0.057687],[-5.129067,0.0,0.0,0.0,-0.175436,-0.165795,-0.027402,0.247208,-0.073864,0.097961,0.301602,-0.188026,-0.001936,0.308279,-0.175966,0.083698,0.076039,0.125256,-0.125482,0.0,0.0,0.0,-0.00069,-0.002364,-0.007435,-0.003303,-0.005532,0.008316,0.103098,0.012082,-0.021411,-0.013885,0.018399,-0.085314,0.076039,-0.022516,-0.012746,0.153459,0.005134,0.067175,0.159569,0.0,0.306136,0.021813,-0.05337,0.090117,0.030856,0.04201,0.097481,0.056346],[-5.680698,0.0,-0.0,0.0,-0.163702,-0.180504,-0.067139,0.210969,-0.083236,0.07617,0.337684,-0.197801,-0.009164,0.258991,-0.196992,-0.052766,0.344656,0.157303,-0.135771,0.0,0.0,0.0,-0.002451,-0.001021,0.00222,-0.002985,-0.0051,0.008817,0.048872,0.010971,-0.022573,-0.007988,0.029246,0.009979,-0.062065,-0.036376,-0.015458,0.132167,0.004444,0.068712,0.20428,0.0,0.2987,0.019862,-0.011222,0.128919,0.004665,0.043592,0.110558,0.056349],[-5.948318,-0.0,0.0,0.0,-0.137502,-0.139853,-0.072953,0.193088,-0.079479,0.051379,0.292191,-0.161906,0.018769,0.213243,-0.184923,-0.075688,0.332383,0.166671,-0.15214,-0.0,0.0,0.0,-0.002605,-0.005965,0.006394,-0.00779,-0.002455,0.011301,0.03463,0.010604,-0.028888,-0.00196,0.02396,0.032357,-0.085736,-0.038556,0.000264,0.126922,0.002773,0.09926,0.309839,-0.0,0.26328,0.015537,0.06856,0.185801,-0.012743,0.023936,0.099197,0.034722],[-5.111142,-0.0,0.0,0.0,-0.11175,-0.084381,-0.053346,0.146085,-0.055638,0.03004,0.224753,-0.116721,0.018497,0.149572,-0.093819,-0.048827,0.205535,0.111459,-0.124721,-0.0,-0.0,0.0,-0.001716,-0.009597,0.001446,-0.007728,-0.003743,0.009706,0.02129,0.00383,-0.01421,0.00012,-0.000675,0.017628,-0.03467,-0.026982,0.004446,0.097492,0.001165,0.141992,0.459254,-0.0,0.196739,0.010869,0.063402,0.280258,-0.01851,0.023096,0.06511,0.00912],[-0.732717,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.428078,0.0,0.0,0.0,0.0]],"games":4000,"win":true,"opp_gain":[1.13,1.411,2.207,3.337,4.502,6.029,8.662,10.603,16.065],"win_rate":0.528};
// Two model kinds: VP (rounds[0..8], value = expected VP to come) and WIN (VMODEL.win, rounds[0..9],
// value = logit of P(win) with a margin feature = my VP - best opponent's VP; rounds[9] = game end).
// features: constant, chip counts, squares, 8 bag/resource terms, margin, then my black-chip standing vs the two
// neighbours (4 terms; older weight files stop before them and those coefficients read as 0)
const NF=1+N+N+8+1+4,IDX_MARGIN=1+N+N+8,IDX_NB=IDX_MARGIN+1,MARGIN_CLAMP=30,NB_CLAMP=3;
const DRAW_SHARE=0.63; // share of a bag a brew typically draws: neighbour's bag blacks x this = expected blacks in their pot
let NB=[0,0];         // black chips in the neighbours' bags (left, right), set from the round prompt
const sigmoid=z=>1/(1+Math.exp(-z));
function vfeatures(bag,droplet,rubies,flask,margin=0){
  const f=new Array(NF).fill(0);f[0]=1;f[IDX_MARGIN]=Math.max(-MARGIN_CLAMP,Math.min(MARGIN_CLAMP,margin));let k=1;
  const mine=bag[IDX.K1],lo=Math.min(NB[0],NB[1]),hi=Math.max(NB[0],NB[1]);
  f[IDX_NB]=Math.max(-NB_CLAMP,Math.min(NB_CLAMP,mine-lo));f[IDX_NB+1]=Math.max(-NB_CLAMP,Math.min(NB_CLAMP,mine-hi));f[IDX_NB+2]=mine>lo?1:0;f[IDX_NB+3]=mine>hi?1:0;
  for(let i=0;i<N;i++)f[k++]=bag[i];for(let i=0;i<N;i++)f[k++]=bag[i]*bag[i];
  const wsum=bag[I_W[1]]+2*bag[I_W[2]]+3*bag[I_W[3]],t=tot(bag),whites=bag[I_W[1]]+bag[I_W[2]]+bag[I_W[3]],reds=bag[IDX.R1]+bag[IDX.R2]+bag[IDX.R4];
  f[k]=droplet;f[k+1]=droplet*droplet;f[k+2]=rubies;f[k+3]=flask?1:0;f[k+4]=wsum;f[k+5]=t-whites;f[k+6]=bag[I_O]*reds;f[k+7]=whites/Math.max(1,t);
  return f;}
// value with the margin term left out (the brewing terminal adds it for WIN models)
function vvalue(rnd,bag,droplet,rubies,flask){if(!VMODEL||rnd>ROUNDS)return 0;const c=VMODEL.rounds[rnd-1],f=vfeatures(bag,droplet,rubies,flask);let s=0;for(let i=0;i<c.length;i++)s+=c[i]*f[i];return s;}
function vmargin(rnd){return VMODEL&&VMODEL.win?VMODEL.rounds[Math.min(rnd,ROUNDS+1)-1][IDX_MARGIN]:0;}
const RUBMAX=6,DDMAX=2;
class PayTable{
  constructor(bag,rnd,droplet,rubies,flaskFull,margin=0){
    this.win=!!(VMODEL&&VMODEL.win);this.a=this.win?vmargin(rnd+1):0;this.m0=this.win?margin-VMODEL.opp_gain[rnd-1]:0;
    this.g=new Float64Array(36*(RUBMAX+1)*(DDMAX+1)*2);
    for(let c=0;c<36;c++)for(let r=0;r<=RUBMAX;r++)for(let d=0;d<=DDMAX;d++)for(let fu=0;fu<2;fu++){
      this.g[((c*(RUBMAX+1)+r)*(DDMAX+1)+d)*2+fu]=bestShopLearned(bag,c,rubies+r,rnd,droplet+d,flaskFull&&fu===0).v;}
    if(rnd>=ROUNDS)this.dOrange=0;else{const b2=bag.slice();b2[I_O]++;this.dOrange=vvalue(rnd+1,b2,droplet,rubies,flaskFull)-vvalue(rnd+1,bag,droplet,rubies,flaskFull);}
  }
  get(c,r,d,fu){c=Math.max(0,Math.min(35,c));r=Math.min(RUBMAX,Math.max(0,r));d=Math.min(DDMAX,Math.max(0,d));return this.g[((c*(RUBMAX+1)+r)*(DDMAX+1)+d)*2+(fu?1:0)];}
}
function bestShopLearned(bag,coins,rubies,rnd,droplet,flask){
  if(rnd>=ROUNDS){const cash=Math.floor(coins/5)+Math.floor(rubies/2);return{opt:[],steps:0,refill:false,v:VMODEL&&VMODEL.win?VMODEL.rounds[ROUNDS][0]+vmargin(ROUNDS+1)*cash:cash};}
  const next=rnd+1;let best={opt:[],steps:0,refill:false,v:-Infinity};
  for(const o of purchaseOptions(coins,rnd)){const b=bag.slice();for(const i of o)b[i]++;
    for(let steps=0;steps<=Math.floor(rubies/2);steps++)for(const refill of[false,true]){
      if(refill&&(flask||rubies-2*steps<2))continue;const left=rubies-2*steps-(refill?2:0);
      const v=vvalue(next,b,droplet+steps,left,flask||refill);if(v>best.v)best={opt:o,steps,refill,v};}}
  return best;}

// ============================================================ VALUE
function phi(x){ // normal cdf
  const t=1/(1+.2316419*Math.abs(x)), d=.3989423*Math.exp(-x*x/2);
  let p=d*t*(.3193815+t*(-.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  return x>0?1-p:p;
}
function poisPmf(k,mu){if(k<0)return 0;let f=1;for(let i=2;i<=k;i++)f*=i;return Math.exp(-mu)*Math.pow(mu,k)/f;}
function poisCdf(k,mu){let s=0;for(let i=0;i<=k;i++)s+=poisPmf(i,mu);return s;}
function rat_tails(my,leader){if(leader<=my)return 0;return RAT_TAIL_VP.filter(t=>my<t&&t<leader).length;}

class Ctx{
  constructor(rnd,o={}){
    this.rnd=rnd; this.limit=o.limit||7; this.n_opp=o.n_opp??OPP.n;
    this.both=!!o.both; this.novp=o.novp||0; this.noruby=o.noruby||0; this.opp_black=OPP.opp_black[rnd];
    // fortune-teller rules for the round (blue cards, see BLUE_RULES)
    this.orangeBonus=o.orangeBonus||0;this.white7=!!o.white7;this.luckyVp=o.luckyVp||0;this.fireRuby=!!o.fireRuby;this.flaskFree=!!o.flaskFree;
    this.dieTwice=!!o.dieTwice;this.safety=!!o.safety;this.mulligan=!!o.mulligan;this.bubble=!!o.bubble;this.toil=!!o.toil;
    this.target=o.target||0; this.baseVp=o.baseVp||0; this.baseRubies=o.baseRubies||0;
    this.w_coin=WEIGHTS.coin[rnd]; this.w_ruby=WEIGHTS.ruby[rnd]; this.w_drop=WEIGHTS.droplet[rnd]; this.w_orange=WEIGHTS.orange[rnd];
    this.w_flask=rnd>=ROUNDS?0:1.5*this.w_ruby;
    this.nb=o.nbBlack||[this.opp_black,this.opp_black]; // expected blacks in each neighbour's pot
    const v={vp1:1,vp2:2,ruby:this.w_ruby,droplet:this.w_drop,orange:this.w_orange};
    this.die_ev=BONUS_DIE.reduce((a,f)=>a+v[f],0)/BONUS_DIE.length;
    this._die={};
  }
  blackOdds(b){const[m0,m1]=this.nb,pl=poisCdf(b-1,m0),pe=poisPmf(b,m0);
    if(this.n_opp<=1)return[pl+pe,pl];const p2=poisCdf(b-1,m1);return[1-(1-pl)*(1-p2),pl*p2];}
  pWinDie(space){if(this.n_opp===0)return 1;if(this._die[space]!==undefined)return this._die[space];
    const m=OPP.best_space_mean[this.rnd],sd=OPP.best_space_sd,ps=OPP.p_survive;
    const p=(1-ps)+ps*phi((space-.5-m)/sd);return this._die[space]=p**this.n_opp;}
  dieMult(){return this.dieTwice?2:1;}
  // `white` = white total in the pot (Bubbling Over pays a droplet step for exactly 7 at a stop)
  terminal(pos,exploded,greens,purples,blacks,flaskUsed,white=0){
    flaskUsed=flaskUsed&&!this.flaskFree;
    if(this.target)return this.winProb(pos,exploded,greens,purples,blacks);
    if(this.pay)return this.terminalLearned(pos,exploded,greens,purples,blacks,flaskUsed,white);
    const space=pos+1,[coins,vp,ruby]=track(space);let rubies=ruby+greens+(this.fireRuby?ruby:0),extra=this.luckyVp*ruby;
    if(purples>=3)extra+=2+this.w_drop;else if(purples===2){extra+=1;rubies+=1;}else if(purples===1)extra+=1;
    if(blacks>0){const[pd,pr]=this.blackOdds(blacks);extra+=pd*this.w_drop;rubies+=pr;}
    if(!exploded&&this.white7&&white===7)extra+=this.w_drop;
    extra+=rubies*this.w_ruby; if(flaskUsed)extra-=this.w_flask;
    if(exploded&&!this.both)return Math.max(vp,coins*this.w_coin)+extra;
    let val=vp+coins*this.w_coin+extra;
    if(!exploded)val+=this.novp+this.noruby*this.w_ruby+this.pWinDie(space)*this.die_ev*this.dieMult();
    return val;
  }
  terminalLearned(pos,exploded,greens,purples,blacks,fu,white){
    const t=this.pay,space=pos+1,[coins,vp,ruby]=track(space);let rub=ruby+greens+(this.fireRuby?ruby:0),vpNow=this.luckyVp*ruby,dd=(!exploded&&this.white7&&white===7)?1:0;
    if(purples>=3){vpNow+=2;dd+=1;}else if(purples===2){vpNow+=1;rub+=1;}else if(purples===1)vpNow+=1;
    const[pd,pr]=blacks>0?this.blackOdds(blacks):[0,0];
    if(t.win){ // P(win) = sigmoid(logit of best shop + a*(projected margin + VP gained this round)), expected over the black outcome
      const h=(c,r,d,vpg,dz)=>{const s=z=>sigmoid(z+dz+t.a*(t.m0+vpg));return(1-pd)*s(t.get(c,r,d,fu))+(pd-pr)*s(t.get(c,r,d+1,fu))+pr*s(t.get(c,r+1,d+1,fu));};
      if(exploded&&!this.both)return Math.max(h(0,rub,dd,vp+vpNow,0),h(coins,rub,dd,vpNow,0));
      const vpg=vp+vpNow+(exploded?0:this.novp),nr=exploded?0:this.noruby,b=h(coins,rub+nr,dd,vpg,0);
      if(exploded)return b;
      const die=(2*h(coins,rub+nr,dd,vpg+1,0)+h(coins,rub+nr,dd,vpg+2,0)+h(coins,rub+nr+1,dd,vpg,0)+h(coins,rub+nr,dd+1,vpg,0)+h(coins,rub+nr,dd,vpg,t.dOrange))/6;
      return b+this.pWinDie(space)*(die-b)*this.dieMult();}
    const g=(c,r,d)=>(1-pd)*t.get(c,r,d,fu)+(pd-pr)*t.get(c,r,d+1,fu)+pr*t.get(c,r+1,d+1,fu);
    if(exploded&&!this.both)return vpNow+Math.max(vp+g(0,rub,dd),g(coins,rub,dd));
    const base=g(coins,rub,dd);let val=vp+vpNow+base;
    if(!exploded){const die=(1+1+2+(g(coins,rub+1,dd)-base)+(g(coins,rub,dd+1)-base)+t.dOrange)/6;val+=this.novp+this.noruby*1+this.pWinDie(space)*die*this.dieMult();}
    return val;
  }
  // Final-round mode: probability that this round's outcome reaches the target score.
  winProb(pos,exploded,greens,purples,blacks){
    const space=pos+1,[coins,vp,ruby]=track(space);let rubies=this.baseRubies+ruby+greens+(this.fireRuby?ruby:0),pts=this.baseVp+this.luckyVp*ruby;
    if(purples>=3)pts+=2;else if(purples===2){pts+=1;rubies+=1;}else if(purples===1)pts+=1;
    const[pd,pr]=blacks>0?this.blackOdds(blacks):[0,0];
    const need=(rb,extraVp)=>this.target-(pts+extraVp+Math.floor(rb/2));
    if(exploded&&!this.both){
      const best=Math.max(vp,Math.floor(coins/5));
      const p0=need(rubies,best)<=0?1:0,p1=need(rubies+1,best)<=0?1:0;
      return p0+(p1-p0)*pr;
    }
    const gained=vp+Math.floor(coins/5)+this.novp;
    const rb=rubies+this.noruby;
    const P=(r)=>{ // with r rubies, before the die
      const d=need(r,gained);if(d<=0)return 1;
      const pdie=exploded?0:this.pWinDie(space);
      // die faces: vp1 x2, vp2, ruby, droplet, orange
      let ok=0;if(d<=1)ok+=2;if(d<=2)ok+=1;if(need(r+1,gained)<=0)ok+=1;
      return pdie*ok/6;};
    return P(rb)+(P(rb+1)-P(rb))*pr;
  }
}

// ============================================================ BREW SOLVER
// mull = Second Chances still available (cleared once the 5th chip is in the pot); cb = Cauldron Bubble, no white drawn yet
const S=(bag,pos,white,lastw,g1,g2,flask,mull=false,cb=false)=>({bag,pos,white,lastw,g1,g2,flask,mull,cb});
const rm=(bag,i)=>{const b=bag.slice();b[i]--;return b;};
const ad=(bag,i)=>{const b=bag.slice();b[i]++;return b;};
const wo=(s,i)=>S(rm(s.bag,i),s.pos,s.white,s.lastw,s.g1,s.g2,s.flask,s.mull,s.cb); // state with chip i taken out of the bag
const tot=bag=>bag.reduce((a,b)=>a+b,0);
const skey=s=>s.bag.join(",")+"|"+s.pos+"|"+s.white+"|"+s.lastw+"|"+(s.g1?1:0)+(s.g2?1:0)+(s.flask?1:0)+(s.mull?1:0)+(s.cb?1:0);
// Safety Procedure: value of revealing up to 5 chips after a stop and placing the best (or none); opts = [value, P(revealed)]
function expectedBest(opts,base){opts.sort((a,b)=>b[0]-a[0]);let val=0,rest=1;for(const[v,p]of opts){val+=rest*p*v;rest*=1-p;}return val+rest*base;}
function comb(n,k){if(k<0||k>n)return 0;let r=1;for(let i=1;i<=k;i++)r=r*(n-k+i)/i;return Math.round(r);}
function* combos(bag,k,start=0){ if(k===0){yield[[],1];return;}
  for(let i=start;i<N;i++){const c=bag[i];if(!c)continue;
    for(let t=1;t<=Math.min(c,k);t++){const w=comb(c,t);
      for(const[rest,rw]of combos(bag,k-t,i+1))yield[new Array(t).fill(i).concat(rest),w*rw];}}}

class Abstract{
  constructor(ctx){this.ctx=ctx;this.memo=new Map();}
  eff(i,oranges){const c=COLOR[i];let v=VALUE[i];
    if(c==="R")v+=oranges>=3?2:(oranges>=1?1:0);else if(c==="B")v+={1:1,2:1,4:2}[v];else if(c==="Y")v+=.6;else if(c==="G")v+=.3*this.ctx.w_ruby;else if(c==="O")v+=this.ctx.orangeBonus;return v;}
  // mullN = chips left in the bag when the 5th is in the pot, restart = value of starting the round over (Second Chances)
  value(s,greens,purples,blacks,oranges,mullN=Infinity,restart=0){
    const w=[s.bag[I_W[1]],s.bag[I_W[2]],s.bag[I_W[3]]],safe=new Array(8).fill(0);
    for(let i=0;i<N;i++){const k=s.bag[i];if(!k||"WPK".includes(COLOR[i]))continue;safe[Math.min(Math.round(this.eff(i,oranges)),7)]+=k;}
    return this._v(w,safe,s.bag[I_P],s.bag[I_K],s.pos,s.white,s.flask,greens,purples,blacks,!!s.mull,!!s.cb,mullN,restart);
  }
  _stop(w,safe,pr,kr,pos,white,flask,g,p,b,n){ // stop value, with the Safety Procedure reveal when that card is out
    const ctx=this.ctx,fu=!flask,base=ctx.terminal(pos,false,g,p,b,fu,white);
    if(!ctx.safety||!n)return base;const k=Math.min(n,5),opts=[];
    const push=(cnt,v)=>{if(cnt>0&&v>base)opts.push([v,1-comb(n-cnt,k)/comb(n,k)]);},at=v=>Math.min(pos+v,LAST);
    for(let v=1;v<8;v++)push(safe[v],ctx.terminal(at(v),false,g,p,b,fu,white));
    for(let wi=0;wi<3;wi++){const v=wi+1;if(white+v<=ctx.limit)push(w[wi],ctx.terminal(at(v),false,g,p,b,fu,white+v));}
    push(pr,ctx.terminal(at(1),false,g,p+1,b,fu,white));push(kr,ctx.terminal(at(1),false,g,p,b+1,fu,white));
    return expectedBest(opts,base);}
  _v(w,safe,pr,kr,pos,white,flask,g,p,b,mull,cb,mullN,restart){
    const key=w.join()+"|"+safe.join()+"|"+pr+"|"+kr+"|"+pos+"|"+white+"|"+(flask?1:0)+"|"+g+p+b+"|"+(mull?1:0)+(cb?1:0);
    const m=this.memo;if(m.has(key))return m.get(key);
    const ctx=this.ctx;const n=w[0]+w[1]+w[2]+safe.reduce((a,x)=>a+x,0)+pr+kr;
    if(mull&&n<=mullN){ // Second Chances: the 5th chip is in the pot — carry on without the option, or start the round over
      const val=Math.max(this._v(w,safe,pr,kr,pos,white,flask,g,p,b,false,cb,mullN,restart),restart);m.set(key,val);return val;}
    let best=this._stop(w,safe,pr,kr,pos,white,flask,g,p,b,n);
    if(n){let dv=0;
      for(let wi=0;wi<3;wi++){const k=w[wi];if(!k)continue;const v=wi+1,nw=white+v,np=Math.min(pos+v,LAST);let val;
        if(nw>ctx.limit)val=ctx.terminal(np,true,g,p,b,!flask,nw); // an explosion ends the round: no Second Chances
        else{const w2=w.slice();w2[wi]--;val=this._v(w2,safe,pr,kr,np,nw,flask,g,p,b,mull,false,mullN,restart);
          if(cb)val=Math.max(val,this._v(w,safe,pr,kr,pos,white,flask,g,p,b,mull,false,mullN,restart)); // first white back for free
          else if(flask)val=Math.max(val,this._v(w,safe,pr,kr,pos,white,false,g,p,b,mull,cb,mullN,restart));}
        dv+=k*val;}
      for(let v=0;v<8;v++){const k=safe[v];if(!k)continue;const s2=safe.slice();s2[v]--;dv+=k*this._v(w,s2,pr,kr,Math.min(pos+v,LAST),white,flask,g,p,b,mull,cb,mullN,restart);}
      if(pr)dv+=pr*this._v(w,safe,pr-1,kr,Math.min(pos+1,LAST),white,flask,g,p+1,b,mull,cb,mullN,restart);
      if(kr)dv+=kr*this._v(w,safe,pr,kr-1,Math.min(pos+1,LAST),white,flask,g,p,b+1,mull,cb,mullN,restart);
      dv/=n;if(dv>best)best=dv;}
    m.set(key,best);return best;
  }
}

class Brew{
  constructor(ctx,startBag,flaskFull=true,depth=2,abstract=null){
    this.ctx=ctx;this.depth=depth;this.startBag=startBag;this.nO=startBag[I_O];this.nP=startBag[I_P];this.nK=startBag[I_K];
    this.flaskFull=flaskFull;this.memo=new Map();this.bmemo=new Map();this.abstract=abstract||new Abstract(ctx);
    const mull=!!ctx.mulligan&&tot(startBag)>5;this.mullN=mull?tot(startBag)-5:Infinity;this.start0=null;this._restart=null;
  }
  start(droplet,rats=0){const s=S(this.startBag.slice(),droplet+rats,0,0,false,false,this.flaskFull,this.mullN!==Infinity,!!this.ctx.bubble);this.start0=s;return s;}
  // Second Chances: value of putting everything back and starting the round over (no second mulligan)
  restartValue(){if(this._restart!==null)return this._restart;return this._restart=this.V({...this.start0,mull:false});}
  term(s,exploded){return this.ctx.terminal(s.pos,exploded,(s.g1?1:0)+(s.g2?1:0),this.nP-s.bag[I_P],this.nK-s.bag[I_K],!s.flask,s.white);}
  // value of stopping here; with Safety Procedure out, the reveal-5-place-1 that follows a stop
  stopValue(s){const base=this.term(s,false),n=tot(s.bag);if(!this.ctx.safety||!n)return base;const k=Math.min(n,5),opts=[];
    for(let i=0;i<N;i++){const c=s.bag[i];if(!c)continue;const[s2,boom]=this.placed(wo(s,i),i);if(boom)continue;const v=this.term(s2,false);if(v>base)opts.push([v,1-comb(n-c,k)/comb(n,k)]);}
    return expectedBest(opts,base);}
  // Safety Procedure at the table: value of placing each revealed chip (none = put them all back)
  safetyPick(s,revealed){const out={none:this.term(s,false)};for(const j of new Set(revealed)){const[s2,boom]=this.placed(wo(s,j),j);if(!boom)out[j]=this.term(s2,false);}return out;}
  explodeProb(s){const n=tot(s.bag);if(!n)return 0;let c=0;for(let v=1;v<=3;v++)if(s.white+v>this.ctx.limit)c+=s.bag[I_W[v]];return c/n;}
  placed(s,i,retWhite=false){
    const c=COLOR[i];let v=VALUE[i],bag=s.bag,pos=s.pos,white=s.white,g1=s.g1,g2=s.g2;
    if(retWhite){bag=ad(bag,I_W[s.lastw]);pos-=s.lastw;white-=s.lastw;g1=g2;g2=false;}
    if(c==="W"){white+=v;pos+=v;return[S(bag,Math.min(pos,LAST),white,v,false,g1,s.flask,s.mull,s.cb),white>this.ctx.limit];}
    if(c==="R"){const o=this.nO-bag[I_O];v+=o>=3?2:(o>=1?1:0);}
    if(c==="O")v+=this.ctx.orangeBonus;
    pos+=v;return[S(bag,Math.min(pos,LAST),white,0,c==="G",g1,s.flask,s.mull,s.cb),false];
  }
  useFlask(sb){return{...sb,flask:false};}
  V(s,d){ if(d===undefined)d=this.depth;const key=skey(s)+"#"+d;const m=this.memo;if(m.has(key))return m.get(key);
    if(s.mull&&tot(s.bag)<=this.mullN){ // Second Chances: the 5th chip is in the pot — carry on without the option, or start over
      const val=Math.max(this.V({...s,mull:false},d),this.restartValue());m.set(key,val);return val;}
    let best=this.stopValue(s);const n=tot(s.bag);
    if(n&&d<=0)best=Math.max(best,this.leaf(s));
    else if(n){let dv=0;for(let i=0;i<N;i++){const k=s.bag[i];if(k)dv+=k*this.place(wo(s,i),i,s,d-1);}
      dv/=n;if(dv>best)best=dv;}
    m.set(key,best);return best;}
  leaf(s){const restart=s.mull?this.restartValue():0;return this.abstract.value(s,(s.g1?1:0)+(s.g2?1:0),this.nP-s.bag[I_P],this.nK-s.bag[I_K],this.nO-s.bag[I_O],this.mullN,restart);}
  drawValue(s,d){if(d===undefined)d=this.depth;const n=tot(s.bag);if(!n)return null;let dv=0;
    for(let i=0;i<N;i++){const k=s.bag[i];if(k)dv+=k*this.place(wo(s,i),i,s,d-1);}return dv/n;}
  place(s,i,sb,d){const c=COLOR[i];const[s2,boom]=this.placed(s,i);
    if(c==="W"){if(boom)return this.term(s2,true); // an explosion ends the round: no Second Chances
      if(sb.cb)return Math.max(this.V({...s2,cb:false},d),this.V({...sb,cb:false},d)); // Cauldron Bubble: keep, or the first white back for free
      let val=this.V(s2,d);if(sb.flask)val=Math.max(val,this.V(this.useFlask(sb),d));return val;}
    if(c==="Y"&&s.lastw){const[s3]=this.placed(s,i,true);return Math.max(this.V(s2,d),this.V(s3,d));}
    if(c==="B")return this.blue(s2,VALUE[i],d);
    return this.V(s2,d);}
  blue(s,k,d){const key=skey(s)+"#"+k+"#"+d;if(this.bmemo.has(key))return this.bmemo.get(key);
    const n=tot(s.bag);k=Math.min(k,n);let val;
    if(k===0)val=this.V(s,d);else{val=0;const den=comb(n,k);
      for(const[combo,ways]of combos(s.bag,k)){let best=this.V(s,d);
        for(const j of combo)best=Math.max(best,this.place(wo(s,j),j,s,d));
        val+=ways/den*best;}}
    this.bmemo.set(key,val);return val;}
  bluePickValues(s,combo){const out={none:this.V(s)};for(const j of new Set(combo))out[j]=this.place(wo(s,j),j,s,this.depth);return out;}
  shouldDraw(s){const stop=this.stopValue(s),draw=this.drawValue(s);return[draw!==null&&draw>stop,stop,draw];}
}

// ============================================================ SHOP
function nextRoundEV(bag,droplet,flask,ctx,A,myVp){
  const rats=ctx.rnd>=2?rat_tails(myVp,OPP.leader_vp[ctx.rnd]):0;
  const b=new Brew(ctx,bag,flask,0,A);return b.V(b.start(droplet,rats));
}
const cost=opt=>opt.reduce((a,i)=>a+price(i),0);
let SHOP={discount:0,max:2,stock:null}; // stock: chips left in the box (null = unlimited)
const price=i=>Math.max(1,PRICES[NAME(i)]-SHOP.discount);
function purchaseOptions(coins,rnd){
  const avail=BUYABLE.filter(i=>UNLOCK[COLOR[i]]<=rnd+1&&price(i)<=coins&&(!SHOP.stock||SHOP.stock[i]>0));
  const opts=[[]];for(const i of avail)opts.push([i]);
  for(let a=0;a<avail.length;a++)for(let b=a+1;b<avail.length;b++){const i=avail[a],j=avail[b];
    if(COLOR[i]!==COLOR[j]&&price(i)+price(j)<=coins)opts.push([i,j]);}
  if(SHOP.max>=3)for(let a=0;a<avail.length;a++)for(let b=a+1;b<avail.length;b++)for(let c=b+1;c<avail.length;c++){
    const i=avail[a],j=avail[b],k=avail[c];const cs=new Set([COLOR[i],COLOR[j],COLOR[k]]);
    if(cs.size===3&&price(i)+price(j)+price(k)<=coins)opts.push([i,j,k]);}
  return opts;
}
function bestPurchase(bag,coins,rnd,droplet,flask,myVp,topSingles=5){
  const ctx=new Ctx(rnd+1),A=new Abstract(ctx);const opts=purchaseOptions(coins,rnd);
  const apply=o=>{let b=bag.slice();for(const i of o)b[i]++;return b;};
  const scored=new Map();const singles=opts.filter(o=>o.length===1);
  for(const o of[[],...singles])scored.set(o,nextRoundEV(apply(o),droplet,flask,ctx,A,myVp));
  const good=new Set(singles.slice().sort((x,y)=>scored.get(y)-scored.get(x)).slice(0,topSingles).map(o=>o[0]));
  for(const o of opts)if(o.length>=2&&o.every(i=>good.has(i)))scored.set(o,nextRoundEV(apply(o),droplet,flask,ctx,A,myVp));
  return[...scored.entries()].sort((a,b)=>b[1]-a[1]);
}
function rubyAdvice(bag,rubies,rnd,droplet,flask,myVp){
  const acts=[];if(rnd>=ROUNDS)return acts;const ctx=new Ctx(rnd+1),A=new Abstract(ctx);
  const left=ROUNDS-rnd,hold=2*WEIGHTS.ruby[rnd+1];
  while(rubies>=2){const base=nextRoundEV(bag,droplet,flask,ctx,A,myVp);
    const gd=(nextRoundEV(bag,droplet+1,flask,ctx,A,myVp)-base)*left;
    const gf=flask?0:nextRoundEV(bag,droplet,true,ctx,A,myVp)-base;
    const best=Math.max(gd,gf,hold);if(best===hold)break;rubies-=2;
    if(best===gd){droplet++;acts.push("droplet");}else{flask=true;acts.push("flask");}}
  return acts;
}


// ============================================================ FORTUNE-TELLER CARDS (24; one is drawn at the start of every round)
const FORTUNE=[
 {id:"bubbling",name:"Bubbling Over",blue:1,text:"If your white tokens total exactly 7 when you stop drawing, move your droplet a space forward."},
 {id:"toil",name:"Toil and Trouble",blue:1,text:"If your cauldron explodes this round, the player to your left takes any 2-value token from the supply."},
 {id:"second",name:"Second Chances",blue:1,text:"After your first 5 tokens (if you haven't exploded) you may put everything back in the bag and start the round over. Once only."},
 {id:"double",name:"Double Double",blue:1,text:"Whoever rolls the bonus die this round rolls it twice."},
 {id:"portentous",name:"Portentous Potables",blue:1,text:"This round the cauldron explodes above 9 whites instead of 7."},
 {id:"pumpkin",name:"Pumpkin Party",blue:1,text:"This round every orange token moves an extra space."},
 {id:"safety",name:"Safety Procedure",blue:1,text:"If you stop before exploding, draw up to 5 tokens from your bag and you may place one of them."},
 {id:"lucky",name:"Lucky Devil",blue:1,text:"If your final space shows a ruby, score 2 VP (even if you exploded)."},
 {id:"rabbit",name:"Flask Rabbit",blue:1,text:"At the end of the round every flask is refilled for free."},
 {id:"bubble",name:"Cauldron Bubble",blue:1,text:"You may put the first white token you draw back into your bag."},
 {id:"fire",name:"Fire Burn",blue:1,text:"If your final space shows a ruby, take an extra ruby."},
 {id:"choices",name:"Choices, Choices",blue:0,text:"Take a black token, any 2-value token, or 3 rubies."},
 {id:"drop",name:"Drop It",blue:0,text:"Move your droplet a space forward."},
 {id:"wheeling",name:"Wheeling and Dealing",blue:0,text:"You may trade a ruby for any 1-value token except purple or black."},
 {id:"charity",name:"Charity",blue:0,text:"The player(s) with the fewest rubies take a ruby."},
 {id:"beginner",name:"Beginner's Luck",blue:0,text:"The player(s) with the fewest VP receive a green 1."},
 {id:"boomberry",name:"Boomberry Cleanse",blue:0,text:"Score 4 VP, or remove a white 1 from your bag."},
 {id:"infestation",name:"Infestation",blue:0,text:"Count your rat tails again and move your rat stone that many extra spaces."},
 {id:"less",name:"Less is More",blue:0,text:"Everyone draws 5 tokens. The lowest sum takes a blue 2, everyone else a ruby. The tokens go back."},
 {id:"goodstart",name:"Good Start",blue:0,text:"You may move your rat stone back 1–3 spaces and take that many rubies."},
 {id:"ratatat",name:"Rat-a-Tat",blue:0,text:"Take any 4-value token, or score 1 VP for each rat tail you are behind the leader."},
 {id:"decisions",name:"Decisions, Decisions",blue:0,text:"Move your droplet 2 spaces forward, or take a purple token."},
 {id:"chance",name:"Take a Chance",blue:0,text:"Everyone rolls the bonus die once and takes the reward."},
 {id:"flea",name:"Flea Market",blue:0,text:"Draw 4 tokens. You may trade one for the next higher value of its colour; if you can't, take a green 1 instead."}];
const FCARD=id=>FORTUNE.find(c=>c.id===id);
// blue cards -> the solver's round rules (Ctx options); Toil and Trouble only matters at scoring
const BLUE_RULES={bubbling:{white7:1},toil:{toil:1},second:{mulligan:1},double:{dieTwice:1},portentous:{limit:9},pumpkin:{orangeBonus:1},safety:{safety:1},lucky:{luckyVp:2},rabbit:{flaskFree:1},bubble:{bubble:1},fire:{fireRuby:1}};

