import { ecaExitNm, bunkerEventQuantity, bunkerByTank, sumAllocations, calculateVoyage, groupRob, tankCapacity, projectTankDays, consumptionOrder, isConsumableTank, resolveFoActiveFuel, effectiveFuelRates, MAX_LOAD_FRAC, maxFillFrac, rateFor, portRateFor, anchorRateFor, defaultFuelType, fuelTypeNoMixing, normFuelType, fobasChangeover, robFromVolume, sulphurOf, vcf54B, wcf56, defaultSulphur, tankSulphur as coreTankSulphur } from './core.js';
import { lfFormsDocumentXml, lfPageFromStop } from './lubeform.js';
import { bfFormsDocumentXml, bfPageFromStop } from './bunkerform.js';
import { planBunkering } from './bunkerplan.js';

const KEY='bunker-pwa-v16';
const SAVED_VOYAGES_KEY='bunker-saved-voyages-v1';
const APP_VERSION='1.62';
const DEFAULT_PORTS=['Singapore','Port Klang','Tanjung Pelepas','Manila','Batangas','Subic Bay','Cebu','Davao','Iloilo','Bacolod','Kaohsiung','Hong Kong','Shanghai','Ningbo-Zhoushan','Qingdao','Busan','Tokyo','Yokohama','Nagoya','Kobe','Keelung','Xiamen','Shenzhen/Yantian','Ho Chi Minh City','Vung Tau','Laem Chabang','Bangkok','Port Louis','Colombo','Chennai','Mumbai','Mundra','Kandla','Kochi','Dubai','Jebel Ali','Fujairah','Abu Dhabi','Dammam','Ras Tanura','Doha','Sohar','Salalah','Aden','Suez','Port Said','Alexandria','Piraeus','Istanbul','Rotterdam','Antwerp','Hamburg','Bremerhaven','London','Felixstowe','Southampton','Algeciras','Valencia','Barcelona','Genoa','Marseille','Durban','Cape Town','Richards Bay','Lagos','Tema','Mombasa','Dar es Salaam','Maputo','New York','Houston','New Orleans','Los Angeles','Long Beach','San Francisco','Seattle','Vancouver','Montreal','Panama Canal','Cartagena','Balboa','Colon','Santos','Rio de Janeiro','Buenos Aires','Valparaiso','Callao','Melbourne','Sydney','Brisbane','Fremantle','Auckland'];
const $=(s,root=document)=>root.querySelector(s);
const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const uid=(p='id')=>`${p}-${crypto.randomUUID?crypto.randomUUID():Date.now()+Math.random()}`;
const GROUPS={
  fo:{name:'Fuel Oil (VLSFO/HFO)',unit:'MT',defaults:{seaRate:0,portRate:0,reserveDays:3}},
  do:{name:'Diesel Oil (LSMGO/DO)',unit:'MT',defaults:{seaRate:0,portRate:0,reserveDays:3}},
  cyl:{name:'Cylinder Oil',unit:'L',defaults:{seaRate:0,portRate:0,reserveDays:3}},
  mesys:{name:'ME System Oil',unit:'L',defaults:{seaRate:0,portRate:0,reserveDays:7}},
  gesys:{name:'GE System Oil',unit:'L',defaults:{seaRate:0,portRate:0,reserveDays:7}}
};
/* Reserve/day label differs by fuel/lube type (feedback item 1) */
const RESERVE_LABEL={fo:'Reserve Fuel/day',do:'Reserve Fuel/day',cyl:'Reserve Cyl. Oil/day',mesys:'Reserve L.O./day',gesys:'Reserve L.O./day'};
/* Curated default tank-name suggestions per group + role (feedback item: name dropdown) */
const NAME_PRESETS={
  fo:{storage:['No.1 FO Tank (P)','No.1 FO Tank (S)','No.2 FO Tank (P)','No.2 FO Tank (S)','No.3 FO Tank (P)','No.3 FO Tank (S)','FO Overflow Tank'],
      settling:['FO Settling Tank No.1','FO Settling Tank No.2'],
      service:['FO Service Tank No.1','FO Service Tank No.2','Boiler FO Service Tank']},
  do:{storage:['No.1 DO Tank (P)','No.1 DO Tank (S)','No.2 DO Tank (P)','No.2 DO Tank (S)','DO Overflow Tank'],
      settling:['DO Settling Tank'],
      service:['DO Service Tank No.1','DO Service Tank No.2']},
  cyl:{storage:['Cyl Oil Storage Tk 1','Cyl Oil Storage Tk 2','Cylinder Oil Measuring Tank']},
  mesys:{storage:['ME System Oil Tank','ME Sump Tank','ME System Oil Renovating Tank']},
  gesys:{storage:['GE System Oil Tank','GE Sump Tank','GE System Oil Renovating Tank']}
};
const CUSTOM_NAME='__custom__';
/* Fuel sub-type per tank (feedback item: choose HFO/VLSFO for FO tanks, LSMGO/MGO/Biodiesel/Other for DO tanks).
   Drives the bunkering mixing rule (fuelTypeNoMixing in core.js) and which tanks are offered for a given bunker. */
const FUEL_TYPE_OPTIONS={
  fo:[{value:'vlsfo',label:'VLSFO'},{value:'hfo',label:'HFO'}],
  do:[{value:'lsmgo',label:'LSMGO'},{value:'mgo',label:'MGO'},{value:'biodiesel',label:'Biodiesel'}]
};
const FUEL_MANUAL='__manual__';
function fuelTypeOptions(group){return FUEL_TYPE_OPTIONS[group]||null;}
/* Tank sulphur with the v1.41 inheritance: a settling/service/support tank with none entered takes the sulphur of the storage tank being consumed. */
const tankSulphur=t=>coreTankSulphur(t,state.tanks,state.active);
const fmtSul=v=>{const x=sulphurOf(v);return x===null?'':x.toFixed(x<1?3:2).replace(/0+$/,'').replace(/\.$/,'')+' % S';};
const tankSulPlaceholder=t=>{const ft=t.fuelType||defaultFuelType(t.group);if(t.category&&t.category!=='storage'&&fuelTypeOptions(t.group)){const v=tankSulphur({...t,sulphur:undefined});if(v!==null)return `same as storage: ${fmtSulNum(v)}`;}return sulPlaceholder(ft);};
const sulPlaceholder=ft=>{const d=defaultSulphur(ft);return d===null?'e.g. 0.50':`default ${d}`;};
const fmtSulNum=v=>{const x=sulphurOf(v);return x===null?'?':x.toFixed(x<1?3:2).replace(/0+$/,'').replace(/\.$/,'');};
const sulVal=v=>{const x=sulphurOf(v);return x===null?'':String(x);};
function fuelTypeLabel(group,val){const opts=fuelTypeOptions(group);const hit=opts&&opts.find(o=>o.value===val);return hit?hit.label:((!val||val==='other')?'Other':String(val));}
/* Drop-down of preset grades plus "Other (type manually)"; the typed text is stored as the value itself.
   dataAttrs carries data-mp="tank|bunker|eca" and the target ids (see manualPickApply). */
function manualPickHtml(opts,val,dataAttrs,placeholder){
  const preset=opts.some(o=>o.value===val),txt=(preset||val==='other'||!val)?'':val;
  return `<span class="manual-pick"><select ${dataAttrs}>${opts.map(o=>`<option value="${o.value}" ${preset&&val===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}<option value="${FUEL_MANUAL}" ${preset?'':'selected'}>Other (type manually)</option></select><input type="text" ${dataAttrs} data-mp-text="1" class="manual-name-input" value="${esc(txt)}" placeholder="${esc(placeholder||'Type fuel type')}" autocomplete="off" ${preset?'hidden':''}></span>`;
}
function manualPickApply(el,val){
  const k=el.dataset.mp;
  if(k==='tank'){const x=state.tanks[Number(el.dataset.tankIndex)];if(x)x.fuelType=val;}
  else if(k==='bunker'){const r=state.route[Number(el.dataset.bunkerRoute)];if(r){r.bunkers ||= {};(r.bunkers[el.dataset.bunkerFuel] ||= {quantity:0,autoAllocate:true,allocations:[]}).fuelType=val;}}
  else if(k==='eca'){const r=state.route[Number(el.dataset.eca)];if(r){r.eca ||= {entering:{},leaving:{}};(r.eca[el.dataset.ecaDir] ||= {})[el.dataset.ecaField]=val;}}
}
function manualPickSelector(el){
  const k=el.dataset.mp;
  if(k==='tank')return `[data-mp-text][data-tank-index="${el.dataset.tankIndex}"]`;
  if(k==='bunker')return `[data-mp-text][data-bunker-route="${el.dataset.bunkerRoute}"][data-bunker-fuel="${el.dataset.bunkerFuel}"]`;
  return `[data-mp-text][data-eca="${el.dataset.eca}"][data-eca-dir="${el.dataset.ecaDir}"][data-eca-field="${el.dataset.ecaField}"]`;
}
/* Top-bar icon labels: tapping an icon flashes its name beneath it. */
let iconTipTimer=null;
function showIconLabel(btn){
  let tip=document.getElementById('iconTip');
  if(!tip){tip=document.createElement('div');tip.id='iconTip';tip.className='icon-tip';tip.setAttribute('role','status');document.body.appendChild(tip);}
  tip.textContent=btn.dataset.label;tip.classList.add('show');
  const r=btn.getBoundingClientRect(),w=tip.offsetWidth;
  tip.style.top=(r.bottom+8)+'px';
  tip.style.left=Math.max(8,Math.min(window.innerWidth-w-8,r.left+r.width/2-w/2))+'px';
  clearTimeout(iconTipTimer);iconTipTimer=setTimeout(()=>tip.classList.remove('show'),1800);
}
/* Small safe arithmetic evaluator for the calculator (no eval). Returns a string, 'Error', or null if incomplete. */
function calcEval(src){
  const s=String(src).replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/\s+/g,'');
  if(!s)return null;
  let i=0;
  const fail=()=>{throw new Error('x');};
  function primary(){
    if(s[i]==='('){i++;const v=expr();if(s[i]!==')')fail();i++;return v;}
    const m=/^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));if(!m)fail();i+=m[0].length;return parseFloat(m[0]);
  }
  function factor(){
    if(s[i]==='-'){i++;return -factor();}
    if(s[i]==='+'){i++;return factor();}
    let v=primary();while(s[i]==='%'){i++;v/=100;}return v;
  }
  function term(){let v=factor();while(s[i]==='*'||s[i]==='/'){const o=s[i++],r=factor();v=o==='*'?v*r:v/r;}return v;}
  function expr(){let v=term();while(s[i]==='+'||s[i]==='-'){const o=s[i++],r=term();v=o==='+'?v+r:v-r;}return v;}
  try{const v=expr();if(i!==s.length)return null;if(!Number.isFinite(v))return 'Error';return String(Number(v.toPrecision(12)));}catch{return null;}
}
function initCalcModal(){
  const modal=$('#calcModal'),expr=$('#calcExpr'),res=$('#calcResult');
  const update=()=>{const v=expr.value.trim()?calcEval(expr.value):'0';res.textContent=v===null?'':'= '+v;};
  const equals=()=>{const v=calcEval(expr.value);if(v===null||v==='Error'){res.textContent='= Error';return;}expr.value=v;update();};
  const press=k=>{if(k==='C')expr.value='';else if(k==='⌫')expr.value=expr.value.slice(0,-1);else if(k==='=')return equals();else expr.value+=k;update();};
  $('#calcBtn').onclick=()=>{modal.hidden=false;update();try{expr.focus({preventScroll:true});}catch{}};
  expr.addEventListener('input',update);
  expr.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();equals();}});
  $('#calcPane').addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(b)press(b.dataset.k);});
}
/* Port -> IANA time zone for DEFAULT_PORTS. Offsets are computed with Intl (built into the browser, works offline)
   for the chosen date, so daylight-saving time is respected. */
const PORT_TZ={'Singapore':'Asia/Singapore','Port Klang':'Asia/Kuala_Lumpur','Tanjung Pelepas':'Asia/Kuala_Lumpur','Manila':'Asia/Manila','Batangas':'Asia/Manila','Subic Bay':'Asia/Manila','Cebu':'Asia/Manila','Davao':'Asia/Manila','Iloilo':'Asia/Manila','Bacolod':'Asia/Manila','Kaohsiung':'Asia/Taipei','Keelung':'Asia/Taipei','Hong Kong':'Asia/Hong_Kong','Shanghai':'Asia/Shanghai','Ningbo-Zhoushan':'Asia/Shanghai','Qingdao':'Asia/Shanghai','Xiamen':'Asia/Shanghai','Shenzhen/Yantian':'Asia/Shanghai','Busan':'Asia/Seoul','Tokyo':'Asia/Tokyo','Yokohama':'Asia/Tokyo','Nagoya':'Asia/Tokyo','Kobe':'Asia/Tokyo','Ho Chi Minh City':'Asia/Ho_Chi_Minh','Vung Tau':'Asia/Ho_Chi_Minh','Laem Chabang':'Asia/Bangkok','Bangkok':'Asia/Bangkok','Port Louis':'Indian/Mauritius','Colombo':'Asia/Colombo','Chennai':'Asia/Kolkata','Mumbai':'Asia/Kolkata','Mundra':'Asia/Kolkata','Kandla':'Asia/Kolkata','Kochi':'Asia/Kolkata','Dubai':'Asia/Dubai','Jebel Ali':'Asia/Dubai','Fujairah':'Asia/Dubai','Abu Dhabi':'Asia/Dubai','Dammam':'Asia/Riyadh','Ras Tanura':'Asia/Riyadh','Doha':'Asia/Qatar','Sohar':'Asia/Muscat','Salalah':'Asia/Muscat','Aden':'Asia/Aden','Suez':'Africa/Cairo','Port Said':'Africa/Cairo','Alexandria':'Africa/Cairo','Piraeus':'Europe/Athens','Istanbul':'Europe/Istanbul','Rotterdam':'Europe/Amsterdam','Antwerp':'Europe/Brussels','Hamburg':'Europe/Berlin','Bremerhaven':'Europe/Berlin','London':'Europe/London','Felixstowe':'Europe/London','Southampton':'Europe/London','Algeciras':'Europe/Madrid','Valencia':'Europe/Madrid','Barcelona':'Europe/Madrid','Genoa':'Europe/Rome','Marseille':'Europe/Paris','Durban':'Africa/Johannesburg','Cape Town':'Africa/Johannesburg','Richards Bay':'Africa/Johannesburg','Lagos':'Africa/Lagos','Tema':'Africa/Accra','Mombasa':'Africa/Nairobi','Dar es Salaam':'Africa/Dar_es_Salaam','Maputo':'Africa/Maputo','New York':'America/New_York','Houston':'America/Chicago','New Orleans':'America/Chicago','Los Angeles':'America/Los_Angeles','Long Beach':'America/Los_Angeles','San Francisco':'America/Los_Angeles','Seattle':'America/Los_Angeles','Vancouver':'America/Vancouver','Montreal':'America/Toronto','Panama Canal':'America/Panama','Cartagena':'America/Bogota','Balboa':'America/Panama','Colon':'America/Panama','Santos':'America/Sao_Paulo','Rio de Janeiro':'America/Sao_Paulo','Buenos Aires':'America/Argentina/Buenos_Aires','Valparaiso':'America/Santiago','Callao':'America/Lima','Melbourne':'Australia/Melbourne','Sydney':'Australia/Sydney','Brisbane':'Australia/Brisbane','Fremantle':'Australia/Perth','Auckland':'Pacific/Auckland'};
const UTC_OFFSETS=[-12,-11,-10,-9,-9.5,-8,-7,-6,-5,-4,-3.5,-3,-2,-1,0,1,2,3,3.5,4,4.5,5,5.5,5.75,6,6.5,7,8,8.75,9,9.5,10,10.5,11,12,12.75,13,14];


/* ---------- v1.8 UI helpers ---------- */
const ico=d=>`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON={
  trash:ico('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  up:ico('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down:ico('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  plus:ico('<path d="M12 5v14M5 12h14"/>'),
  chev:ico('<path d="M6 9l6 6 6-6"/>').replace('class="ico"','class="ico fold-chev"')
};
const uiOpen=new Set();           // remembers which cards/folds are expanded across re-renders
let tableTouched=false;
const isCons=isConsumableTank;
const isFixedRole=t=>t.category==='settling'||t.category==='service';
/* Settling and service tanks are always treated as in service. */
function tankInService(t){return!!t&&isFixedRole(t);}
const fmtN=(v,unit)=>n(v).toFixed(unit==='L'?0:2);
const TAB_TITLES={dashboard:'Dashboard',setup:'Setup',tanks:'Tank Condition',voyage:'Ports',bunkering:'Bunkering & Lube Oil',eca:'ECA / SECA Changeover',results:'Results & Export'};
let currentTab=null;const tabScroll={};
/* ---- Folds return to their closed position ------------------------------------------
   Every fold (tank / port / ECA / bunkering cards, per-port consumption overrides, the Setup,
   Tanks and Results info panels, ignored alerts…) closes again by itself:
   • when you move to another tab — the folds of the tab you left are closed once it is out of
     sight (after the slide), so they are shut when you come back;
   • when a fold has been left open and untouched for FOLD_IDLE_MS (5 min). Touching = tapping,
     typing or focusing inside it, scrolling while it is on screen, or opening it. The sweep waits
     for FOLD_PAUSE_MS without any input so nothing collapses under a finger that is scrolling,
     skips a fold with a field being edited, and is paused during the guided tour.
   The two blocks that are designed to start expanded (KEEP_OPEN_KEYS) are left as the user set them. */
const FOLD_IDLE_MS=5*60*1000,FOLD_PAUSE_MS=10*1000;
const KEEP_OPEN_KEYS=new Set(['routetable']);
const foldUsed=new Map();            // fold (its data-open-key, else the element) -> last time it was used
let lastUserInput=Date.now();
const foldId=d=>d.dataset.openKey||d;
const foldTouch=d=>{for(let x=d;x;x=x.parentElement?.closest('details'))foldUsed.set(foldId(x),Date.now());};
function closeFold(d){const k=d.dataset.openKey;d.open=false;if(k)uiOpen.delete(k);foldUsed.delete(foldId(d));}
const closableFolds=root=>[...root.querySelectorAll('details[open]')].filter(d=>!KEEP_OPEN_KEYS.has(d.dataset.openKey));
function collapseTabFolds(tabId){const sec=document.getElementById(tabId);if(sec)closableFolds(sec).forEach(closeFold);}
function sweepIdleFolds(){
  if(document.hidden||tourIndex>=0||Date.now()-lastUserInput<FOLD_PAUSE_MS)return;
  const ae=document.activeElement,editing=ae&&/^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)?ae:null,now=Date.now();
  closableFolds(document).forEach(d=>{
    if(d.closest('[hidden]')||(editing&&d.contains(editing)))return;
    const t=foldUsed.get(foldId(d));
    if(t===undefined){foldTouch(d);return;}                 // opened by code: its clock starts now
    if(now-t>=FOLD_IDLE_MS)closeFold(d);
  });
}
function initFoldAutoClose(){
  const used=e=>{lastUserInput=Date.now();const d=e.target&&e.target.closest?e.target.closest('details'):null;if(d)foldTouch(d);};
  ['pointerdown','keydown','focusin','input','change'].forEach(ev=>document.addEventListener(ev,used,true));
  let scrollTimer=0;
  window.addEventListener('scroll',()=>{
    lastUserInput=Date.now();
    if(scrollTimer)return;
    scrollTimer=setTimeout(()=>{scrollTimer=0;   // a fold that is on screen while the page scrolls is being read
      const vh=window.innerHeight;
      $$('.section:not([hidden]) details[open]').forEach(d=>{const r=d.getBoundingClientRect();if(r.bottom>0&&r.top<vh)foldTouch(d);});
    },1000);
  },{passive:true,capture:true});
  window.addEventListener('wheel',()=>{lastUserInput=Date.now();},{passive:true,capture:true});
  window.addEventListener('touchmove',()=>{lastUserInput=Date.now();},{passive:true,capture:true});
  setInterval(sweepIdleFolds,5000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sweepIdleFolds();});
}
/* ---- Tab slide transition (500 ms) --------------------------------------------------
   Direction follows the tab order in the nav (setup → tanks → voyage → dashboard → bunkering →
   eca → results): moving to a tab further along slides the new screen in from the right while
   the old one leaves to the left, and vice versa. Only the two screens involved are rendered.
   The outgoing screen is pinned (position:fixed) where it was so the page scroll can jump to the
   new tab's saved position underneath it without the outgoing screen visibly moving. */
const TAB_SLIDE_MS=500;
let endTabSlide=null;
const tabOrder=()=>[...new Set($$('.nav-link').map(a=>a.dataset.tab))];
function canSlideTabs(opts){
  if(opts.animate===false||document.hidden||typeof Element.prototype.animate!=='function')return false;
  try{return!window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch{return true;}
}
function prepareTabSlide(fromId,toId){
  if(endTabSlide)endTabSlide();                    // a quick second tap finishes the first slide at once
  const out=document.getElementById(fromId),inn=document.getElementById(toId);
  if(!out||!inn||out.hidden)return null;
  const r=out.getBoundingClientRect();
  if(!r.width||!r.height)return null;
  const order=tabOrder(),dir=order.indexOf(toId)>=order.indexOf(fromId)?1:-1;
  return{out,inn,r,dir};
}
function startTabSlide(s){
  const{out,inn,r,dir}=s,host=inn.parentElement,st=out.style;
  st.cssText=`position:fixed;top:${r.top}px;left:${r.left}px;width:${r.width}px;margin:0;z-index:1;pointer-events:none;box-sizing:border-box`;
  out.setAttribute('aria-hidden','true');out.inert=true;
  host.classList.add('tab-sliding');
  const opt={duration:TAB_SLIDE_MS,easing:'ease-in-out',fill:'both'};
  const ao=out.animate([{transform:'translateX(0)'},{transform:`translateX(${-dir*100}%)`}],opt);
  const ai=inn.animate([{transform:`translateX(${dir*100}%)`},{transform:'translateX(0)'}],opt);
  let done=false,timer=0;
  const finish=()=>{
    if(done)return;done=true;clearTimeout(timer);
    ao.cancel();ai.cancel();
    out.hidden=out.id!==currentTab;st.cssText='';out.removeAttribute('aria-hidden');out.inert=false;
    host.classList.remove('tab-sliding');
    if(out.id!==currentTab)collapseTabFolds(out.id);
    endTabSlide=null;
  };
  endTabSlide=finish;
  Promise.all([ao.finished,ai.finished]).then(finish,finish);
  timer=setTimeout(finish,TAB_SLIDE_MS+250);       // safety net if the browser throttles animations
}
function showTab(id,opts={}){
  if(!TAB_TITLES[id])id='dashboard';
  const changed=currentTab!==id;
  if(changed&&currentTab==='tanks'&&!opts.force&&tankDirty()){pendingLeaveTab=id;$('#tankLeaveModal').hidden=false;if(location.hash!=='#tanks')history.replaceState(null,'','#tanks');return;}
  if(changed&&id==='tanks')tankBaseline=currentTankSig();
  if(currentTab)tabScroll[currentTab]=window.scrollY;
  const prev=currentTab;
  const slide=changed&&prev&&canSlideTabs(opts)?prepareTabSlide(prev,id):null;
  if(changed&&!slide&&endTabSlide)endTabSlide();
  currentTab=id;
  renderTabIfStale(id);
  if(id==='tanks')setTimeout(()=>askMaxFill(false),0);
  $$('.section').forEach(sec=>{const on=sec.id===id;sec.classList.toggle('active',on);sec.hidden=!on&&!(slide&&sec===slide.out);});
  if(slide)startTabSlide(slide);
  if(changed&&prev&&!slide)collapseTabFolds(prev);   // with a slide this happens when the old screen has left (see startTabSlide)
  $$('.nav-link').forEach(a=>{const on=a.dataset.tab===id;a.classList.toggle('active',on);if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  const title=$('#pageTitle');if(title)title.textContent=TAB_TITLES[id];
  refreshTankFab();
  try{sessionStorage.setItem('bunker-tab',id);}catch{}
  if(location.hash!=='#'+id)history.replaceState(null,'','#'+id);
  if(changed&&opts.scroll!==false)window.scrollTo({top:tabScroll[id]||0});
}
function applyHints(){
  // Explanation text now appears on demand when a field is focused/tapped (see .field:focus-within>.help),
  // so the global toggle defaults OFF and is only for people who want every hint visible at once.
  let v=null;try{v=localStorage.getItem('bunker-hints');}catch{}
  const on=v==='1';
  document.body.classList.toggle('hints',on);
  const b=$('#hintsBtn');if(b)b.setAttribute('aria-pressed',String(on));
}

function defaultState(){return{
  meta:{vesselName:'',voyageNo:'',noonLocal:nowWall(devOffset()),posUtcOffset:devOffset(),startUtc:wallToIso(nowWall(devOffset()),devOffset()),currentPosition:'',positionMode:'manual',notes:'',noonRob:{fo:0,do:0,cyl:0,mesys:0,gesys:0},ecaSystemDefaults:{me:{rate:0,qty:0},ae:{rate:0,qty:0},boiler:{rate:0,qty:0}}},
  fuels:[{id:'fo',name:GROUPS.fo.name,seaRate:0,portRate:0,anchorRate:0,unit:'MT',reserveDays:3,reserveRate:0,foMode:'vlsfo',hfo:{seaRate:0,portRate:0,anchorRate:0,reserveDays:3,reserveRate:0}},{id:'do',name:GROUPS.do.name,seaRate:0,portRate:0,anchorRate:0,unit:'MT',reserveDays:3,reserveRate:0,doEcaSplit:false,insideEca:{seaRate:0,portRate:0,anchorRate:0}}],
  lubes:[{id:'cyl',name:GROUPS.cyl.name,seaRate:0,portRate:0,anchorRate:0,unit:'L',reserveDays:3,reserveRate:0},{id:'mesys',name:GROUPS.mesys.name,seaRate:0,portRate:0,anchorRate:0,unit:'L',reserveDays:7,reserveRate:0},{id:'gesys',name:GROUPS.gesys.name,seaRate:0,portRate:0,anchorRate:0,unit:'L',reserveDays:7,reserveRate:0}],
  tanks:[],tankLog:[],active:{fo:0,do:0},route:[]
};}

function migrate(s){
  if(!s||typeof s!=='object')return defaultState();
  const d=defaultState();
  const hadLocal=!!(s.meta&&typeof s.meta.noonLocal==='string'&&s.meta.noonLocal);
  const oldStart=s.meta&&typeof s.meta.startUtc==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s.meta.startUtc)?s.meta.startUtc.slice(0,16):'';
  s.meta={...d.meta,...(s.meta||{})};
  if(!hadLocal){s.meta.noonLocal=oldStart||d.meta.noonLocal;s.meta.posUtcOffset=oldStart?0:d.meta.posUtcOffset;}
  s.meta.posUtcOffset=n(s.meta.posUtcOffset);
  s.meta.startUtc=wallToIso(s.meta.noonLocal,s.meta.posUtcOffset);
  s.meta.currentPosition=s.meta.currentPosition??'';s.meta.positionMode=s.meta.positionMode??'manual';s.meta.noonRob={fo:0,do:0,cyl:0,mesys:0,gesys:0,...(s.meta.noonRob||{})};
  s.meta.ecaSystemDefaults={me:{rate:0,qty:0,...(s.meta.ecaSystemDefaults?.me||{})},ae:{rate:0,qty:0,...(s.meta.ecaSystemDefaults?.ae||{})},boiler:{rate:0,qty:0,...(s.meta.ecaSystemDefaults?.boiler||{})}};
  s.fuels=(s.fuels||d.fuels).map((x,i)=>({...d.fuels[i%2],...x}));
  s.fuels.forEach(f=>{if(f.id==='fo'){f.foMode=['vlsfo','hfo','both'].includes(f.foMode)?f.foMode:'vlsfo';f.hfo={seaRate:0,portRate:0,anchorRate:0,reserveDays:3,reserveRate:0,...(f.hfo||{})};}else if(f.id==='do'){f.doEcaSplit=f.doEcaSplit===true;f.insideEca={seaRate:0,portRate:0,anchorRate:0,...(f.insideEca||{})};}});
  s.lubes=(s.lubes||d.lubes).map((x,i)=>({...d.lubes[i%3],...x}));
  s.lubes.forEach(l=>{if(l.id==='gesys'){l.portRate=n(l.seaRate);l.anchorRate=n(l.seaRate);}else if(l.id==='cyl'||l.id==='mesys'){l.portRate=0;l.anchorRate=0;}});
  [...s.fuels,...s.lubes].forEach(p=>{if(!(n(p.reserveRate)>0)&&n(p.seaRate)>0)p.reserveRate=n(p.seaRate);if(p.hfo&&!(n(p.hfo.reserveRate)>0)&&n(p.hfo.seaRate)>0)p.hfo.reserveRate=n(p.hfo.seaRate);});
  s.tanks=(s.tanks||[]).map((t,i)=>{
    const hasFuelOpts=!!fuelTypeOptions(t.group),capUnit=hasFuelOpts?(t.capUnit==='weight'?'weight':'volume'):undefined;
    const vol=hasFuelOpts&&capUnit==='volume',density=vol?(Number(t.density)>0?Number(t.density):0.95):undefined;
    const capacityM3=vol?(Number.isFinite(Number(t.capacityM3))?Number(t.capacityM3):(density?Number(t.capacity||0)/density:0)):undefined;
    let robVolumeM3,robTempC,rob=Number(t.rob)||0;
    if(vol){
      robTempC=Number.isFinite(Number(t.robTempC))?Number(t.robTempC):15;
      robVolumeM3=Number.isFinite(Number(t.robVolumeM3))?Number(t.robVolumeM3):
        // Backfill from a previously-entered MT value (older plans / imports) so existing ROB isn't lost
        // when this tank first shows the Corrected Volume field — precise only once volume/temp are re-sounded.
        (density>0?Math.round((rob/density)*100)/100:0);
      rob=t.robInput==='mt'?Math.max(0,rob):Math.max(0,robFromVolume(robVolumeM3,robTempC,density));
    }
    return{...t,sequence:Number.isFinite(Number(t.sequence))?Number(t.sequence):i+1,order:Number.isFinite(Number(t.order))?Number(t.order):i,unpumpable:Number(t.unpumpable)||0,consumable:t.consumable!==false,category:t.category||'storage',inService:t.inService===true,nameCustom:t.nameCustom===true,fuelType:t.fuelType||defaultFuelType(t.group)||null,capUnit,density,capacityM3,robVolumeM3,robTempC,rob};
  });
  s.active={...d.active,...(s.active||{})};
  const ecaDefaults=()=>({entering:{enabled:false},leaving:{enabled:false}});
  let legacyInEca=false;const blankOrNum=v=>(v===''||v===null||v===undefined)?'':Math.max(0,Number(v)||0);
  s.route=(s.route||[]).map(r=>{
    const base={port:'',distanceNm:0,speedKn:0,anchorStayDays:0,anchorStayHours:0,anchorMode:'anchor',portStayDays:0,portStayHours:0,utcOffset:0,notes:'',eta:'',foActiveFuel:'vlsfo',bunkers:{}};
    const merged={...base,...r};
    const d=ecaDefaults();
    merged.portStayHours=Number(merged.portStayHours)||0;
    merged.anchorStayDays=Number(merged.anchorStayDays)||0;
    merged.anchorStayHours=Number(merged.anchorStayHours)||0;
    merged.eca={entering:{...d.entering,...(r.eca?.entering||{})},leaving:{...d.leaving,...(r.eca?.leaving||{})}};
    const pp=r.eca?.port;
    if(pp&&typeof pp==='object'){merged.eca.port={enabled:pp.enabled===true,prevToLineNm:blankOrNum(pp.prevToLineNm),lineToPortNm:Math.max(0,Number(pp.lineToPortNm)||0),exitNm:blankOrNum(pp.exitNm)};}
    else{/* plans before v1.55: ports between an 'enters' and a 'leaves' flag count as ECA/SECA ports; line distance 0 = line at the port (old behaviour) */
      if(merged.eca.entering.enabled)legacyInEca=true;
      merged.eca.port={enabled:legacyInEca,prevToLineNm:'',lineToPortNm:0,exitNm:''};
      if(merged.eca.leaving.enabled)legacyInEca=false;}
    return merged;
  });
  s.tankLog=Array.isArray(s.tankLog)?s.tankLog.filter(x=>x&&Array.isArray(x.tanks)).slice(0,20).map(l=>l.atLocal?l:{...l,atLocal:String(l.atUtc||'').slice(0,16),utcOffset:0,port:''}):[];
  return s;
}
function load(){try{return migrate(JSON.parse(localStorage.getItem(KEY)||'null'));}catch{return defaultState();}}
let state=load();let calc=calculateVoyage(state);
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{/* quota or storage unavailable — keep working in-memory; use Save Voyage to keep a named copy */}}
function rerun(){ecaSyncFromPorts();ecaPropagateDefaults();calc=calculateVoyage(state);save();renderAll();}
/* Live recalculation: every input recomputes the whole plan. The tab being edited is updated in place (so typing
   is never interrupted); the other tabs are flagged and redrawn the moment they are opened. */
const staleTabs=new Set();
function renderTabIfStale(id){
  if(!staleTabs.has(id))return;staleTabs.delete(id);
  const fn={tanks:()=>renderTanks(),voyage:()=>renderRoute(),bunkering:()=>renderBunkering(),eca:()=>renderEca()}[id];if(fn)fn();
}
function syncAllCards(){
  state.tanks.forEach((_,i)=>syncTankCard(i));
  state.route.forEach((_,i)=>{syncRouteCard(i);syncBunkerConditions(i);syncEcaResult(i);});
  document.querySelectorAll('[data-open-key^="bunkport:"]').forEach(el=>{const i=Number(el.dataset.openKey.slice(9)),c=calc.results[i],m=el.querySelector('.rs-meta');if(m&&c)m.textContent=`ETA ${fmtDate(c.arrivalUtc,c.utcOffset)}`;const f=portFlagInfo(i);el.classList.toggle('pf-bunk',f.bunk);el.classList.toggle('pf-eca',f.eca.length>0);el.classList.toggle('pf-both',f.bunk&&f.eca.length>0);const pf=el.querySelector('.pflags');if(pf)pf.innerHTML=portFlagChips(i,false);});
  ['tanks','voyage','bunkering','eca'].forEach(t=>{if(t!==currentTab)staleTabs.add(t);});
}
function refreshOutputs(){calc=calculateVoyage(state);save();renderDashboard();renderResults();renderSidebar();renderRouteSummary(activePosition().index);syncAllCards();}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function fmtQty(v,unit='MT'){return `${n(v).toFixed(unit==='L'?0:2)} ${unit}`;}
function fmtDate(iso,offset=0){const d=new Date(iso);if(Number.isNaN(d.getTime()))return'—';const local=new Date(d.getTime()+n(offset)*3600000),pad=x=>String(x).padStart(2,'0');return `${local.getUTCFullYear()}-${pad(local.getUTCMonth()+1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;}
/* Noon report date is entered in LOCAL time at the present position. state.meta.noonLocal holds that wall-clock
   value, state.meta.posUtcOffset the offset of the present position; state.meta.startUtc is the derived absolute
   instant (ISO with Z) that the calculation engine uses — it is never typed by the user. */
function pad2(x){return String(x).padStart(2,'0');}
function nowWall(offset){const d=new Date(Date.now()+n(offset)*3600000);return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;}
function devOffset(){const o=-new Date().getTimezoneOffset()/60;return UTC_OFFSETS.some(x=>Math.abs(x-o)<0.01)?o:0;}
function wallToIso(wall,offset){const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall||'');if(!m)return'';return new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5])-n(offset)*3600000).toISOString();}
function syncStartUtc(){state.meta.startUtc=wallToIso(state.meta.noonLocal,state.meta.posUtcOffset);}
function portKey(name){const k=String(name||'').trim().toLowerCase();return DEFAULT_PORTS.find(p=>p.toLowerCase()===k)||null;}
function zoneOffsetAt(tz,ms){const p={};new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(ms)).forEach(x=>{p[x.type]=x.value;});return Math.round(((Date.UTC(+p.year,+p.month-1,+p.day,+p.hour%24,+p.minute,+p.second)-Math.floor(ms/1000)*1000)/3600000)*4)/4;}
/* UTC offset (hours) of a named port for a given LOCAL wall-clock date/time; null when the port is unknown. */
function portUtcOffset(name,wall){const key=portKey(name),tz=key&&PORT_TZ[key];if(!tz)return null;const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall||'');const wallMs=m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]):Date.now();try{const o1=zoneOffsetAt(tz,wallMs);return zoneOffsetAt(tz,wallMs-o1*3600000);}catch{return null;}}
function noonStartExplain(){const s=state.meta.startUtc;return s?`${fmtDate(s,state.meta.posUtcOffset)} local (= ${fmtUTC(s)})`:'not set';}
function fmtUTC(iso){const d=new Date(iso);if(Number.isNaN(d.getTime()))return'—';return d.toISOString().slice(0,16).replace('T',' ')+' UTC';}
function pct(x){return`${(n(x)*100).toFixed(1)}%`;}
function days(x){return n(x).toFixed(3);}
/* True when a "fixed once entered" field actually needs a confirm: it held a real (non-zero) value
   and the committed edit actually changes it. undefined `before` means the field was never focused
   through the guard (e.g. set programmatically), so nothing to confirm. */
function lockedFieldNeedsConfirm(before,after){
  if(before===undefined)return false;
  const b=Number(before),a=Number(after);
  return Number.isFinite(b)&&b!==0&&Number.isFinite(a)&&b!==a;
}
function daysHours(x){
  let d=Math.floor(Math.max(0,n(x))),h=Math.round((Math.max(0,n(x))-d)*24);
  if(h>=24){h-=24;d+=1;}
  return `${d} d ${h} h`;
}
function unitFor(id){return[...state.fuels,...state.lubes].find(p=>p.id===id)?.unit||'MT';}
function getProfile(id){return[...state.fuels,...state.lubes].find(p=>p.id===id);}
function groupLabel(id){return getProfile(id)?.name||GROUPS[id]?.name||id;}
function tanksFor(group,onlyConsumable=false){return consumptionOrder(state.tanks.filter(t=>t.group===group&&(!onlyConsumable||isCons(t))));}
function activePosition(){
  if(!calc.results.length)return{kind:'none',label:'No route yet',detail:'Add ports to calculate the voyage.',progress:0,next:'—',index:-1};
  // First honour an explicit present-position match. This makes the dashboard
  // deterministic for stored/historical plans and for offline planning.
  const currentText=String(state.meta.currentPosition||'').trim().toLowerCase();
  if(currentText){
    const exact=calc.results.findIndex(r=>String(r.port||'').trim().toLowerCase()===currentText);
    if(exact>=0){
      const next=calc.results[exact+1];
      return {kind:'at-port',label:`At ${calc.results[exact].port}`,detail:`Present position matches route point ${exact+1}.`,progress:progressAt(calc.results[exact],exact),next:next?.port||'Voyage complete',index:exact};
    }
    const partial=calc.results.findIndex(r=>String(r.port||'').toLowerCase().includes(currentText)||currentText.includes(String(r.port||'').toLowerCase()));
    if(partial>=0){
      const next=calc.results[partial+1];
      return {kind:'at-port',label:`At ${calc.results[partial].port}`,detail:`Present position matches route point ${partial+1}.`,progress:progressAt(calc.results[partial],partial),next:next?.port||'Voyage complete',index:partial};
    }
  }
  const now=Date.now(),start=new Date(state.meta.startUtc||0).getTime();
  if(!Number.isFinite(start))return{kind:'scheduled',label:'Scheduled',detail:'Voyage timeline is available below.',progress:0,next:calc.results[0]?.port||'—',index:0};
  if(now<start)return{kind:'not-started',label:'Not departed',detail:`Planned voyage starts ${fmtDate(state.meta.startUtc,state.meta.posUtcOffset)} local.`,progress:0,next:calc.results[0]?.port||'—',index:0};
  for(let i=0;i<calc.results.length;i++){
    const r=calc.results[i],a=new Date(r.arrivalUtc).getTime(),d=new Date(r.departureUtc).getTime();
    if(now>=a&&now<=d){const next=calc.results[i+1];return{kind:'at-port',label:`At ${r.port}`,detail:`Port stay ends ${fmtDate(r.departureUtc,r.utcOffset)} local.`,progress:progressAt(r,i),next:next?.port||'Voyage complete',index:i};}
    const next=calc.results[i+1];
    if(next){const na=new Date(next.arrivalUtc).getTime();if(now>d&&now<na)return{kind:'underway',label:`Underway to ${next.port}`,detail:`ETA ${fmtDate(next.arrivalUtc,next.utcOffset)} local.`,progress:progressAt(r,i,true),next:next.port,index:i+1};}
  }
  const last=calc.results.at(-1);
  if(now>new Date(last.departureUtc).getTime())return{kind:'complete',label:'Voyage complete',detail:`Last planned departure was ${fmtDate(last.departureUtc,last.utcOffset)} local.`,progress:100,next:'—',index:calc.results.length-1};
  return{kind:'scheduled',label:'Scheduled',detail:'Voyage timeline is available below.',progress:progressAt(calc.results[0],0),next:calc.results[0].port,index:0};
}
function progressAt(r,i,underway=false){
  if(!calc.results.length)return 0;
  const start=new Date(state.meta.startUtc).getTime(),end=new Date(calc.results.at(-1).departureUtc).getTime();
  if(end<=start)return 0;
  if(underway){const dep=new Date(r.departureUtc).getTime(),next=calc.results[i],arr=new Date(next.arrivalUtc).getTime();return Math.max(0,Math.min(99,((Date.now()-dep)/(arr-dep))*100+(i-1)/Math.max(1,calc.results.length)*100));}
  const t=new Date(r.departureUtc).getTime();return Math.max(0,Math.min(100,((t-start)/(end-start))*100));
}
function explain(title,text){return `<span class="help"><b>${esc(title)}:</b> ${esc(text)}</span>`;}
function utcOffsetLabel(v){const sign=v<0?'-':'+',abs=Math.abs(v),h=Math.floor(abs),m=Math.round((abs-h)*60);return `UTC${sign}${h}:${String(m).padStart(2,'0')}`;}

let pendingFocus=null;
function renderAll(){
  staleTabs.clear();
  const ver=$('#appVersion');if(ver)ver.textContent=`v${APP_VERSION}`;const dl=$('#defaultPorts');if(dl)dl.innerHTML=DEFAULT_PORTS.map(x=>`<option value="${esc(x)}">`).join('');
  $('#vesselName').value=state.meta.vesselName||'';$('#voyageNo').value=state.meta.voyageNo||'';$('#noonLocal').value=state.meta.noonLocal||'';for(const po of [$('#posUtcOffset'),$('#noonUtcOffset')]){if(!po)continue;if(!po.options.length)po.innerHTML=UTC_OFFSETS.map(o=>`<option value="${o}">${utcOffsetLabel(o)}</option>`).join('');po.value=String(UTC_OFFSETS.find(o=>Math.abs(o-n(state.meta.posUtcOffset))<0.01)??0);}renderNoonDate();$('#currentPosition').value=state.meta.currentPosition||'';
  const nr=state.meta.noonRob||{};$('#noonRobFo').value=nr.fo||'';$('#noonRobDo').value=nr.do||'';$('#noonRobCyl').value=nr.cyl||'';$('#noonRobMesys').value=nr.mesys||'';$('#noonRobGesys').value=nr.gesys||'';
  renderRates();renderTanks();renderRoute();renderBunkering();renderEca();renderDashboard();renderResults();renderSidebar();
  if(pendingFocus){const sel=pendingFocus;pendingFocus=null;requestAnimationFrame(()=>{const el=document.querySelector(sel);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.focus();if(el.select&&el.type!=='number')el.select();}});}
}
function renderSidebar(){
  $('#sideVessel').textContent=state.meta.vesselName||'No vessel yet';$('#sideVoyage').textContent=state.meta.voyageNo||'Set up the vessel and voyage';
  const sub=$('#topSub');if(sub)sub.textContent=[state.meta.vesselName,state.meta.voyageNo].filter(Boolean).join(' / ')||'Bunker & ROB Planner';
}
function renderDashboard(){
  const first=calc.results[0],last=calc.results.at(-1),status=activePosition();
  const alertCount=buildAlertItems().length;const navDot=$('#navDot');if(navDot)navDot.hidden=!alertCount;
  renderRouteSummary(status.index);
  const PRODUCTS=[{id:'fo',label:'Fuel Oil'},{id:'do',label:'Diesel Oil'},{id:'cyl',label:'Cylinder Oil'},{id:'mesys',label:'ME System Oil'},{id:'gesys',label:'GE System Oil'}];
  const nr=state.meta.noonRob||{};
  const robRows=PRODUCTS.map(p=>{
    const unit=unitFor(p.id),noon=Math.max(0,n(nr[p.id])),actual=groupRob(state.tanks,p.id),delta=actual-noon,tol=Math.max(unit==='MT'?1:20,noon*0.02);
    const flag=Math.abs(delta)>tol,sign=delta>0?'+':delta<0?'−':'±';
    return `<tr class="rob-compare-row${flag?' warn':''}"${W('robcompare',{g:p.id})}><th scope="row">${esc(p.label)}</th><td>${fmtQty(noon,unit)}</td><td>${fmtQty(actual,unit)}</td><td class="rob-diff ${flag?'warn':'ok'}">${sign} ${fmtQty(Math.abs(delta),unit)}</td></tr>`;
  }).join('');
  const robTable=`<table class="rob-compare-table"><thead><tr><th>Product</th><th>Logbook ROB</th><th>Actual (tanks)</th><th>Difference</th></tr></thead><tbody>${robRows}</tbody></table>`;
  $('#robCompare').innerHTML=wrapMetricLabel('LOGBOOK ROB vs ACTUAL TANK ROB',`<div class="rob-compare-wrap">${robTable}</div>`,`<span class="noon-date-chip" title="Date of noon report entry (Tanks tab)">${esc(noonDateText())}</span>`);
  $('#bunkerNeeded').innerHTML=bunkerNeededHtml(status.index);
  $('#ecaAhead').innerHTML=ecaAheadHtml(status.index);
}
/* v1.43 — port flags. A port with bunkering (any fuel / diesel / lube receipt or drum pump-over) is marked amber "Bunkering";
   a port where the vessel enters or leaves an ECA/SECA (fuel changeover) is marked cyan "ECA in" / "ECA out". Used on the Bunkering tab
   and in the Dashboard route summary; both can apply to the same port. */
function ecaDirsAt(r){return['entering','leaving'].filter(d=>r&&r.eca&&r.eca[d]&&r.eca[d].enabled);}
function portFlagInfo(i){const r=state.route[i];return{bunk:hasBunkerAt(r),eca:ecaDirsAt(r)};}
function portFlagClass(i){const f=portFlagInfo(i);return(f.bunk?' pf-bunk':'')+(f.eca.length?' pf-eca':'')+(f.bunk&&f.eca.length?' pf-both':'');}
function portFlagChips(i,withEca=true){
  const f=portFlagInfo(i);
  return(f.bunk?'<span class="pflag pf-chip-bunk" title="Bunkering planned at this port">Bunkering</span>':'')
    +(withEca?f.eca:[]).map(d=>`<span class="pflag pf-chip-eca" title="${d==='entering'?'Entering':'Leaving'} an ECA/SECA — fuel changeover at this port">ECA ${d==='entering'?'in':'out'}</span>`).join('');
}
function portFlagsHtml(i,withEca=true){const h=portFlagChips(i,withEca);return `<span class="pflags" data-pflags="${i}">${h}</span>`;}
/* Bunkering required / planned card: the next port that still needs fuel or diesel to keep the reserve, plus EVERY port from here with a
   planned receipt (fuel, diesel or lube oil). Planned fuel and diesel are shown too — not only lube oil. */
function bunkerNeededHtml(fromIndex){
  const from=Math.max(0,fromIndex),PRODUCTS=[{id:'fo',label:'Fuel',fuel:true},{id:'do',label:'Diesel',fuel:true},{id:'cyl',label:'Cylinder oil'},{id:'mesys',label:'ME system oil'},{id:'gesys',label:'GE system oil'}];
  const blocks=[];let shortfallShown=false;
  for(let i=from;i<calc.results.length;i++){
    const r=calc.results[i],items=[];
    for(const p of PRODUCTS){
      const bi=r.bunkerInfo?.[p.id],u=unitFor(p.id),planned=n(bi&&bi.quantity),pumped=n(bi&&bi.transferred);
      const need=p.fuel&&!shortfallShown?Math.max(0,n(r.fuelStatus?.[p.id]?.bunkerRequiredNow)):0;
      if(planned<=0.005&&pumped<=0.005&&need<=0.005)continue;
      const parts=[];
      if(planned>0.005)parts.push(`${fmtQty(planned,u)} ${bi&&bi.mode==='drums'?'in drums':'planned'}`);
      if(pumped>0.005)parts.push(`${fmtQty(pumped,u)} pumped from drums`);
      if(need>0.005)parts.push(`<em class="need-more">${planned>0.005?'+ ':''}${fmtQty(need,u)} ${planned>0.005?'more ':''}needed</em>`);
      items.push(`<span${need>0.005?W('req',{i,g:p.id}):''}><b>${esc(p.label)}</b> ${parts.join(' · ')}</span>`);
    }
    if(!items.length)continue;
    if(p0needs(r))shortfallShown=true;
    blocks.push(`<div class="next-port bn-port${portFlagClass(i)}"><strong>${esc(r.port)}</strong><small class="muted">ETA ${fmtDate(r.arrivalUtc,r.utcOffset)} local</small><div class="bn-flags">${portFlagChips(i)}</div><div class="bunker-needed-rows">${items.join('')}</div></div>`);
  }
  if(blocks.length)return `<h3>Bunkering required / planned</h3>${blocks.join('')}`;
  return `<h3>Bunkering required</h3><div class="next-port"><span>No fuel, diesel or lube-oil bunkering is required or planned from here to the end of the voyage.</span></div>`;
}
function p0needs(r){return['fo','do'].some(id=>n(r.fuelStatus?.[id]?.bunkerRequiredNow)>0.005);}
/* First upcoming ECA/SECA direction (entering or leaving), from the vessel's current position onward. */
function ecaAheadHtml(fromIndex){
  const from=Math.max(0,fromIndex);
  for(let i=from;i<state.route.length;i++){
    const r=state.route[i];
    for(const dir of['entering','leaving']){
      const cfg=r.eca?.[dir];if(!cfg?.enabled)continue;
      const c=calc.results[i];if(!c)continue;
      const scrubber=(cfg.method||'fuel')==='scrubber';
      const f=ecaFuels(cfg,dir,i),sr=ecaSystemResults(dir,cfg,i);
      const when=dir==='entering'?`Approaching ${esc(r.port)} · ETA ${fmtDate(c.arrivalUtc,c.utcOffset)} local`:`Leaving ${esc(r.port)} · ETD ${fmtDate(c.departureUtc,c.utcOffset)} local`;
      const detail=(scrubber?'Scrubber (EGCS) · ':'')+`${esc(ecaFuelLabel(f.from))} → ${esc(ecaFuelLabel(f.to))}${sr&&sr.planning!==null?` · planning time ${fmtH(sr.planning)}`:''}`;
      /* Entering card: also show the planning time of the switch back (compliant fuel -> fuel to resume) at the next planned ECA/SECA exit. */
      let back='';
      if(dir==='entering'&&!scrubber){
        for(let j=i;j<state.route.length;j++){
          const lc=state.route[j].eca?.leaving;if(!lc?.enabled||(lc.method||'fuel')==='scrubber'||!calc.results[j])continue;
          const lf=ecaFuels(lc,'leaving',j),ls=ecaSystemResults('leaving',lc,j);
          back=`<span>${esc(ecaFuelLabel(lf.from))} → ${esc(ecaFuelLabel(lf.to))}${ls&&ls.planning!==null?` · planning time ${fmtH(ls.planning)}`:''}<small class=\"muted\"> · on leaving ${esc(state.route[j].port||`Port ${j+1}`)}</small></span>`;
          break;
        }
        if(!back)back=`<span class=\"muted\">${esc(ecaFuelLabel(f.to))} → ${esc(ecaFuelLabel(f.from))} · no ECA/SECA exit planned yet</span>`;
      }
      return `<div class=\"panel next-panel eca-ahead-panel\"><h3>ECA/SECA ahead</h3><div class=\"next-port\"><strong>${dir==='entering'?'Entering':'Leaving'} an ECA/SECA</strong><small class=\"muted\">${when}</small><span>${detail}</span>${back}<span class=\"tag\" data-goto-tab=\"eca\">See full plan — ECA/SECA tab</span></div></div>`;
    }
  }
  return '';
}
function metricCard(label,value,foot,width,barClass,why){return `<div class="metric-card"${why||''}><div class="metric-label">${esc(label)}</div><div class="metric-value">${value}</div><div class="progress ${barClass||''}"><span style="width:${width||0}%"></span></div><div class="metric-foot">${esc(foot)}</div></div>`;}
function wrapMetricLabel(label,html,extra=''){return html?(extra?`<div class="eyebrow metric-heading metric-heading-row"><span>${label}</span>${extra}</div>`:`<div class="eyebrow metric-heading">${label}</div>`)+`<div class="metric-grid-inner">${html}</div>`:'';}
/* The noon report entry date (Tanks tab → "Date of noon report entry") is shown at the top of every Logbook ROB card. */
const noonDateText=()=>state.meta.noonLocal?`${state.meta.noonLocal.replace('T',' ')} local`:'Date not set';
function renderNoonDate(){const c=$('#noonRobDate');if(c)c.textContent=noonDateText();}
function rtCell(t,unit,group,i,ph){
  if(!t)return `<div class="rt-cell"><div class="hbar ${barColorClass(group)}"><span style="width:0%"></span></div><b>—</b></div>`;
  const cap=Math.max(0,n(t.capacity)),rob=Math.max(0,n(t.rob)),u=cap?Math.min(1,rob/cap):0,over=cap>0&&rob>cap+1e-9,over85=cap>0&&!over&&rob>cap*bunkerFillFrac()+1e-9;
  return `<div class="rt-cell"${i!==undefined?W('rob',{i,g:group,t:t.id,ph}):''}><div class="hbar ${barColorClass(group)} ${over?'over':''} ${over85?'over85':''}"><span style="width:${(u*100).toFixed(1)}%"></span></div><b>${fmtN(rob,unit)}${cap?`/${fmtN(cap,unit)}`:''}</b></div>`;
}
/* Tank display order must match the Tanks tab (drag/move order, i.e. t.order) rather than raw
   insertion order in state.tanks — keeps Dashboard and Bunkering tank lists consistent with
   what the user arranged under Tanks. */
function sortTankIdsByDisplayOrder(ids){
  const orderIndex=new Map(state.tanks.map((t,idx)=>[t.id,n(t.order)]));
  return [...ids].sort((a,b)=>(orderIndex.get(a)??0)-(orderIndex.get(b)??0));
}
/* Projected sulphur of a tank after all planned bunkering (the voyage calculation mixes each bunker into the tank). */
function sulProjText(t){
  if(!t||!fuelTypeOptions(t.group))return'';
  const fin=(calc&&calc.finalTanks||[]).find(x=>x.id===t.id);if(!fin)return'';
  const a=tankSulphur(t),b=sulphurOf(fin.sulphur);
  if(b===null||(a!==null&&Math.abs(a-b)<0.0005))return'';
  return `After planned bunkering: ${esc(fmtSul(b))}`;
}
/* Unpumpable quantity chip for the strip below a Dashboard Tank ROB row. */
function ftChip(group,srcTank,sTank){if(!fuelTypeOptions(group))return'';const sTxt=fmtSul(tankSulphur(sTank||srcTank));return `<small class="rt-ft rt-ft-chip">${esc(fuelTypeLabel(group,(srcTank&&srcTank.fuelType)||defaultFuelType(group)))}${sTxt?` · <span class="rt-sul" title="Sulphur content after any bunkering at this port">${esc(sTxt)}</span>`:''}</small>`;}
function unpChip(sTank,srcTank,unit){const u=Math.max(0,n((sTank||srcTank||{}).unpumpable));return `<small class="rt-unp rt-unp-chip" title="Unpumpable quantity in this tank (included in the ROB figures)">Unpumpable ${fmtN(u,unit)} ${esc(unit)}</small>`;}
/* Tank name with its fuel type printed underneath (fuel groups only). */
function tankNameHtml(name,group,srcTank,sTank,unit,noUnp){
  const sTxt=fuelTypeOptions(group)?fmtSul(tankSulphur(sTank||srcTank)):'';
  const ft=fuelTypeOptions(group)&&!noUnp?`<small class="rt-ft">${esc(fuelTypeLabel(group,(srcTank&&srcTank.fuelType)||defaultFuelType(group)))}${sTxt?` · <span class="rt-sul" title="Sulphur content after any bunkering at this port">${esc(sTxt)}</span>`:''}</small>`:'';
  const unp=Math.max(0,n((sTank||srcTank||{}).unpumpable)),unpHtml=unit&&!noUnp?`<small class="rt-unp" title="Unpumpable quantity in this tank (included in the ROB figures)">Unpumpable ${fmtN(unp,unit)} ${esc(unit)}</small>`:'';
  return `<span class="rt-nm"><span>${esc(name)}</span>${ft}${unpHtml}</span>`;
}

/* ---------- Tap-to-explain: "where did this value come from and how" ---------- */
function W(kind,o={}){
  const a=Object.entries(o).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>` data-${k}="${esc(String(v))}"`).join('');
  return ` data-why="${kind}"${a} role="button" tabindex="0" title="Tap to see how this is calculated"`;
}
function ratesFor(g,i){
  const p=getProfile(g);if(!p)return{sea:0,port:0,anchor:0,basis:0};
  const isFuel=state.fuels.some(f=>f.id===g),ef=isFuel?effectiveFuelRates(p,resolveFoActiveFuel(p,state.route[i])):p;
  return{sea:rateFor(ef,'sea'),port:rateFor(ef,'port'),anchor:Math.max(0,n(ef.anchorRate)),basis:Math.max(0,n(ef.reserveRate))||Math.max(0,n(ef.seaRate))};
}
function whyInfo(d){
  const i=d.i!==undefined?Number(d.i):null,r=i!==null?calc.results[i]:null,g=d.g,gl=g?groupLabel(g):'',u=g?unitFor(g):'MT';
  const q=(v,gg)=>fmtQty(v,gg?unitFor(gg):u),L=[];let title='',value='',src='';
  const stop=i!==null?state.route[i]:null,pname=r?r.port:'';
  const legIn=()=>{if(!r)return;if(i===0)L.push(stop?.eta?`First port: the exact ETA typed in the Voyage tab (${esc(stop.eta.replace('T',' '))}).`:`First port: arrival = noon report date (local time) from the Tanks tab, ${esc(noonStartExplain())}.`);else{const pv=calc.results[i-1];L.push(`Departure from ${esc(pv.port)}: ${esc(fmtUTC(pv.departureUtc))}`);L.push(`+ sea time = ${n(r.distanceNm).toFixed(1)} NM ÷ ${n(r.speedKn)} kn ÷ 24 = ${days(r.seaDays)} d`);}};
  const sumUse=(usage)=>n(usage?.[g]);
  const kpi=r?{sea:sumUse(r.seaUsage),anc:sumUse(r.anchorUsage),port:sumUse(r.portUsage),bunk:n(r.bunkerInfo?.[g]?.allocated),arr:n(r.arrivalFuel?.[g]!==undefined?r.arrivalFuel[g]:r.arrivalLube?.[g]),dep:n(r.departureFuel?.[g]!==undefined?r.departureFuel[g]:r.departureLube?.[g]),prev:g?groupRob(r.tankBefore||[],g):0}:null;
  switch(d.why){
    case 'stops':title='Stops';value=String(calc.results.length);L.push('Counted from the ports entered in the Voyage tab:');L.push(esc(calc.results.map(x=>x.port).join(' → ')||'none yet'));break;
    case 'duration':{title='Duration';const last=calc.results.at(-1);value=last?`${calc.totals.totalVoyageDays.toFixed(2)} d`:'—';if(last){L.push(`Noon report date (Tanks tab): ${esc(noonStartExplain())}`);L.push(`Departure from last port (${esc(last.port)}): ${esc(fmtUTC(last.departureUtc))}`);L.push(`Duration = last departure − voyage start = ${calc.totals.totalVoyageDays.toFixed(2)} days`);L.push('It adds up every sea leg (distance ÷ speed ÷ 24), anchor/drift time and port stay.');}break;}
    case 'alerts':{title='Alerts';const cap=calc.results.reduce((c,x)=>c+x.tankAfter.filter(t=>n(t.capacity)>0&&n(t.rob)>n(t.capacity)+1e-9).length,0),sh=calc.totals.shortages.length,below=calc.results.reduce((c,x)=>c+Object.values(x.fuelStatus).filter(z=>z.belowReserve).length,0);value=String(cap+sh+below);L.push(`Tanks above capacity after a port: ${cap}`);L.push(`Shortages / allocation problems: ${sh}`);L.push(`Fuel departures below reserve: ${below}`);L.push(`Total = ${value}. Tap the bell icon in the top bar to read each alert.`);break;}
    case 'nextport':{const st=activePosition();title='Next port';value=st.next||'—';L.push('The first port in the route that the vessel has not yet departed, judged by the current date/time against each ETA and ETD.');L.push(esc(st.detail||''));break;}
    case 'position':{const st=activePosition();title='Present position';value=state.meta.currentPosition||'Not entered';L.push('The text is what you entered under Setup › Present position.');L.push(`Status “${esc(st.label)}” comes from comparing the current date/time with each port’s ETA/ETD.`);L.push(esc(st.detail||''));break;}
    case 'progress':{const st=activePosition();title='Voyage progress';value=`${Math.round(st.progress)}%`;L.push('Progress = (time of the last completed departure − voyage start) ÷ (final departure − voyage start).');L.push(`Noon report date (voyage start): ${esc(noonStartExplain())}`);const last=calc.results.at(-1);if(last)L.push(`Final departure: ${esc(fmtUTC(last.departureUtc))}`);L.push('While underway it is interpolated between the two ports using elapsed time.');break;}
    case 'gcard':{title=`${gl} ROB`;const last=calc.results.at(-1),rob=n(last?.departureFuel?.[g]??last?.departureLube?.[g]??groupRob(state.tanks,g)),cap=tankCapacity(calc.finalTanks,g),st=last?.fuelStatus?.[g];value=q(rob);L.push(`ROB = sum of all ${esc(gl)} tanks after the last port’s consumption and bunkering: ${q(rob)}`);L.push(`Capacity = sum of tank capacities: ${q(cap)}`);L.push(`Utilisation = ${q(rob)} ÷ ${q(cap)} = ${pct(cap?rob/cap:0)}`);if(st){const rt=ratesFor(g,calc.results.length-1).basis;L.push(`Margin = (ROB ${q(rob)} − unpumpable ${q(st.unpumpable)} − reserve ${q(st.reserveQty)}) ÷ ${rt.toFixed(2)} ${u}/day = ${Number.isFinite(st.marginDays)?st.marginDays.toFixed(1)+' d':'—'}`);L.push('Reserve = reserve days × daily rate set in Setup.');}break;}
    case 'robcompare':{title=`${gl} — Logbook ROB vs actual`;const noon=Math.max(0,n(state.meta.noonRob?.[g])),actual=groupRob(state.tanks,g),delta=actual-noon;value=q(actual);L.push(`Logbook ROB (Tanks tab): ${q(noon)}`);L.push(`Actual tank ROB (sum of ${esc(gl)} tanks on the Tanks tab): ${q(actual)}`);L.push(`Difference = actual − logbook ROB = ${delta>=0?'+':'−'}${q(Math.abs(delta))}`);L.push('A large difference usually means a tank ROB needs updating, or the logbook ROB figure was entered for a different date.');break;}
    case 'eta':title=`ETA — ${pname}`;value=`${fmtDate(r.arrivalUtc,r.utcOffset)} local`;legIn();L.push(`= ${esc(fmtUTC(r.arrivalUtc))}`);L.push(`Local time = UTC ${esc(utcOffsetLabel(r.utcOffset))} → ${esc(fmtDate(r.arrivalUtc,r.utcOffset))}`);break;
    case 'etd':title=`ETD — ${pname}`;value=`${fmtDate(r.departureUtc,r.utcOffset)} local`;L.push(`ETA: ${esc(fmtUTC(r.arrivalUtc))}`);L.push(`+ anchor/drift stay ${days(r.anchorStayDays)} d`);L.push(`+ port stay ${days(r.portStayDays)} d`);L.push(`= ETD ${esc(fmtUTC(r.departureUtc))}`);L.push(`Local time = UTC ${esc(utcOffsetLabel(r.utcOffset))} → ${esc(fmtDate(r.departureUtc,r.utcOffset))}`);break;
    case 'portstay':title=`Time at ${pname}`;value=`${Math.floor(n(r.portStayDays))} d ${n(r.portStayHours)} h`;L.push('Port stay is entered in the Voyage tab (days + hours).');if(r.anchorStayDays>0)L.push(`Anchor/drift time before berthing: ${days(r.anchorStayDays)} d (also entered there).`);L.push(`Total ETA → ETD = anchor/drift + port stay = ${days(r.anchorStayDays+r.portStayDays)} d`);break;
    case 'distance':title='Distance';value=`${n(r.distanceNm).toFixed(1)} NM`;L.push(i===0?'First port: normally 0 NM (start point).':`Entered in the Voyage tab as the distance from ${esc(calc.results[i-1].port)} to ${esc(pname)}.`);break;
    case 'speed':title='Speed';value=`${n(r.speedKn).toFixed(1)} kn`;L.push('Planning speed entered in the Voyage tab for this leg. It is not measured — it drives the sailing time.');break;
    case 'seadays':title='Steaming days';value=`${days(r.seaDays)} d (${daysHours(r.seaDays)})`;L.push(i===0?'First port: no sailing leg, so 0 days.':`= distance ${n(r.distanceNm).toFixed(1)} NM ÷ speed ${n(r.speedKn)} kn ÷ 24 = ${days(r.seaDays)} days`);break;
    case 'cons':{const ph=d.ph,dd=ph==='sea'?r.seaDays:ph==='port'?r.portStayDays:r.anchorStayDays,usage=ph==='sea'?r.seaUsage:ph==='port'?r.portUsage:r.anchorUsage;title=`${ph==='sea'?'At sea':ph==='port'?'In port':'At anchor/drift'} consumption — ${pname}`;value=formatConsumption(usage);L.push(`Time: ${days(dd)} d ${ph==='sea'?'(distance ÷ speed ÷ 24)':'(from the Voyage tab)'}`);[...state.fuels,...state.lubes].forEach(pf=>{const rt=ratesFor(pf.id,i),rate=ph==='sea'?rt.sea:ph==='port'?rt.port:rt.anchor,v=n(usage?.[pf.id]);if(v>0||rate>0)L.push(`${esc(pf.name)}: ${rate.toFixed(2)} ${pf.unit}/day × ${days(dd)} d = ${fmtQty(v,pf.unit)}`);});L.push('Daily rates come from Setup › Consumption rates.');break;}
    case 'rob':{const id=d.t,b=(r.tankBefore||[]).find(x=>x.id===id),a=(r.tankAtArrival||[]).find(x=>x.id===id),f=(r.tankAfter||[]).find(x=>x.id===id),tn=(a||f||b||{}).name||id,cap=n((a||f||b||{}).capacity);
      const bunk=n((r.bunkerInfo?.[g]?.allocations||[]).find(x=>x.tankId===id)?.quantity);title=`${tn} — ROB at ${d.ph==='eta'?'ETA':'ETD'}`;
      if(d.ph==='eta'){value=q(a?.rob);L.push(`ROB before this leg: ${q(b?.rob)} ${i===0?'(present ROB from the Tanks tab)':'(departure ROB of the previous port)'}`);L.push(`− drawn from this tank during the sea leg: ${q(n(b?.rob)-n(a?.rob))}`);L.push(`= ROB at ETA: ${q(a?.rob)}`);L.push('Consumption is drawn from tanks in the consumption sequence set in the Tanks tab (Sequence 1 first), moving to the next when a tank runs empty.');}
      else{value=q(f?.rob);L.push(`ROB at ETA: ${q(a?.rob)}`);L.push(`− anchor/port consumption drawn from this tank: ${q(n(a?.rob)+bunk-n(f?.rob))}`);L.push(`+ bunker / replenishment received into this tank: ${q(bunk)}`);L.push(`= ROB at ETD: ${q(f?.rob)}`);}
      if(cap>0)L.push(`Tank capacity ${q(cap)} → ${pct(n((d.ph==='eta'?a:f)?.rob)/cap)} full.`);break;}
    case 'gtotal':title=`${gl} total ROB — ${pname}`;value=`${q(kpi.arr)} → ${q(kpi.dep)}`;L.push(`At ETA = previous departure ${q(kpi.prev)} − sea consumption ${q(kpi.sea)} = ${q(kpi.arr)}`);L.push(`At ETD = ETA ${q(kpi.arr)} − anchor ${q(kpi.anc)} − port ${q(kpi.port)} + bunker received ${q(kpi.bunk)} = ${q(kpi.dep)}`);L.push('Both are the sum of every tank in this group (see the tank rows above).');break;
    case 'arr':title=`${gl} ROB on arrival — ${pname}`;value=q(kpi.arr);L.push(`Previous departure ROB: ${q(kpi.prev)}`);L.push(`− sea consumption on this leg: ${q(kpi.sea)}`);L.push(`= ROB on arrival: ${q(kpi.arr)} (never carried below zero — a shortage is flagged instead)`);break;
    case 'dep':{title=`${gl} ROB on departure — ${pname}`;value=q(kpi.dep);L.push(`ROB on arrival: ${q(kpi.arr)}`);L.push(`− anchor/drift consumption: ${q(kpi.anc)}`);L.push(`− port consumption: ${q(kpi.port)}`);L.push(`+ bunker received: ${q(kpi.bunk)}`);L.push(`= ROB on departure: ${q(kpi.dep)}`);const st=r.fuelStatus?.[g];if(st){L.push(`Utilisation = ${q(st.rob)} ÷ capacity ${q(st.capacity)} = ${pct(st.utilization)}`);L.push(`Margin = (ROB − unpumpable ${q(st.unpumpable)} − reserve ${q(st.reserveQty)}) ÷ ${ratesFor(g,i).basis.toFixed(2)} ${u}/day = ${Number.isFinite(st.marginDays)?st.marginDays.toFixed(1)+' d':'—'}`);if(st.belowReserve)L.push('⚠ Usable ROB is below the reserve, so this departure is flagged.');}break;}
    case 'req':{title=`Required bunker — ${pname}`;const st=r.fuelStatus[g];let rem=0,fut=0;calc.results.forEach((x,j)=>{if(j>=i)rem+=n(x.seaUsage[g])+n(x.anchorUsage[g])+n(x.portUsage[g]);if(j>i)fut+=n(x.bunkerInfo?.[g]?.allocated);});value=q(st.bunkerRequiredNow);L.push(`Consumption from this port’s leg to the end of the voyage: ${q(rem)}`);L.push(`+ reserve (${q(st.reserveQty)}) + unpumpable (${q(st.unpumpable)})`);L.push(`− ROB on departure: ${q(kpi.dep)}`);L.push(`− bunkers already planned at later ports: ${q(fut)}`);L.push(`= ${q(st.bunkerRequiredNow)} (never below zero)`);L.push('It is the extra quantity you would still need to bunker here to finish the voyage with the reserve intact.');break;}
    case 'ctotal':{title=`${gl} total consumption`;value=q(calc.totals.consumption[g]);L.push(`At sea: ${q(calc.totals.seaConsumption[g])}`);L.push(`At anchor/drift: ${q(calc.totals.anchorConsumption?.[g])}`);L.push(`In port: ${q(calc.totals.portConsumption[g])}`);L.push('Each leg = daily rate (Setup) × days (Voyage tab); the totals add up all legs.');break;}
    case 'alert':{if(d.a==='cap'){const t=(r.tankAfter||[]).find(x=>x.id===d.t);title='Tank over capacity';value=t?t.name:'';L.push(`Tank ROB after ${esc(pname)}: ${q(t?.rob,t?.group)}`);L.push(`Tank capacity: ${q(t?.capacity,t?.group)}`);L.push('The alert appears when ROB (including any bunker allocated) is above the capacity entered in the Tanks tab.');}
      else if(d.a==='over85'){const t=(r.tankAfter||[]).find(x=>x.id===d.t),maxf=bunkerFillFrac();title='Above maximum fill';value=t?t.name:'';L.push(`Tank ROB after ${esc(pname)}: ${q(t?.rob,t?.group)}`);L.push(`Tank capacity: ${q(t?.capacity,t?.group)}`);L.push(`Company maximum fill: ${Math.round(maxf*100)}% = ${q(n(t?.capacity)*maxf,t?.group)}`);L.push('Set in Setup / the Bunkering tab. This does not stop the plan — it flags a tank you may want to load less into.');}
      else if(d.a==='short'){const sh=calc.totals.shortages[Number(d.x)]||{};title='Shortage';value=esc(sh.item||'');L.push(`Location / phase: ${esc(sh.location||'route')} / ${esc(sh.phase||'—')}`);L.push(`Quantity that could not be supplied or placed: ${q(sh.shortage,getProfileIdByName(sh.item))}`);L.push(esc(sh.message||'Consumption or bunkering was larger than what the tanks could provide or hold, so the balance is flagged instead of going negative.'));}
      else{const st=r.fuelStatus?.[g];title='Below reserve';value=gl;L.push(`Usable ROB at departure = ROB ${q(st?.rob)} − unpumpable ${q(st?.unpumpable)} = ${q(n(st?.rob)-n(st?.unpumpable))}`);L.push(`Reserve = reserve days × daily rate (Setup) = ${q(st?.reserveQty)}`);L.push('The alert appears when usable ROB is smaller than the reserve.');}break;}
    default:title='Value';L.push('No explanation available.');
  }
  return{title,value,lines:L};
}
function showWhy(el){
  const info=whyInfo({...el.dataset});
  $('#whyTitle').textContent=info.title;
  $('#whyValue').innerHTML=info.value||'';
  $('#whySteps').innerHTML=info.lines.map(l=>`<li>${l}</li>`).join('');
  $('#whyModal').hidden=false;
}
let selectedPoint=-1,swipeDir=0;
function renderPointDetails(index){
  const r=calc.results[index];selectedPoint=r?index:-1;
  const panel=$('#portDetails');
  if(!panel)return;
  if(!r){panel.innerHTML='<div class="empty">Add ports in the Ports tab to see the port details here.</div>';const tp=$('#tankRobCard');if(tp)tp.innerHTML='';return;}
  $$('.route-node').forEach(b=>b.classList.toggle('selected',Number(b.dataset.routePoint)===index));
  const tanksEta=r.tankAtArrival||r.tankBefore||[];
  const tanksEtd=r.tankAfter||[];
  const tankIds=[...new Set([...tanksEta,...tanksEtd].map(t=>t.id))];
  const order=[...state.fuels,...state.lubes].map(p=>p.id);
  const byGroup={};
  tankIds.forEach(id=>{const t=tanksEta.find(x=>x.id===id)||tanksEtd.find(x=>x.id===id);(byGroup[t.group]||(byGroup[t.group]=[])).push(id);});
  Object.keys(byGroup).forEach(g=>{byGroup[g]=sortTankIdsByDisplayOrder(byGroup[g]);});
  const groupKeys=Object.keys(byGroup).sort((x,y)=>{const ix=order.indexOf(x),iy=order.indexOf(y);return(ix<0?99:ix)-(iy<0?99:iy);});
  const tankBlocks=groupKeys.map(g=>{
    const unit=getProfile(g)?.unit||'MT';
    const rows=byGroup[g].map(id=>{
      const a=tanksEta.find(t=>t.id===id),d=tanksEtd.find(t=>t.id===id);
      const activeEta=!!(a&&isCons(a)&&n(a.sequence)===n(r.activeAtArrival?.[a.group])+1);
      const activeEtd=!!(d&&isCons(d)&&n(d.sequence)===n(r.active?.[d.group])+1);
      const srcTank=state.tanks.find(x=>x.id===id);
      const fixedInService=srcTank&&tankInService(srcTank);
      const on=activeEta||activeEtd||fixedInService,name=a?.name||d?.name||id;
      const where=fixedInService?(srcTank.category==='settling'?'settling tank in service':'service tank in service'):(activeEta&&activeEtd?'ETA and ETD':activeEta?'ETA':'ETD');
      const bunkAlloc=(r.bunkerInfo?.[g]?.allocations||[]).find(x=>x.tankId===id),bunked=bunkAlloc&&n(bunkAlloc.quantity)>0.005;
      const sulChg=bunked&&fuelTypeOptions(g)&&sulphurOf(d&&d.sulphur)!==null?`<span class="rt-bk rt-bk-s" title="Sulphur content of this tank before → after the bunker is mixed in (by mass, including the unpumpable quantity left in the tank)">Sulphur ${fmtSulNum(a&&a.sulphur)} → ${fmtSulNum(d.sulphur)} %</span>`:'';
      const bunkTagHtml=bunked?`<span class="rt-bk-pair"><span class="rt-bk">${fuelTypeOptions(g)?'Bunkered':'Replenished'} +${fmtN(bunkAlloc.quantity,unit)}</span>${sulChg}</span>`:'';
      return `<div class="rt-row ${on?'tank-active':''} ${bunked?'rt-bunkered':''}" ${bunked?`data-goto-bunker-port="${index}"`:`data-goto-tank="${esc(id)}"`} role="button" tabindex="0" title="${bunked?'Open this port’s bunkering on the Bunkering tab':'Open this tank on the Tanks tab'}"><div class="rt-name" title="${esc(name)}">${on?`<i class="svc-dot" title="In service — ${where}"></i>`:''}${tankNameHtml(name,g,srcTank,d||a,unit,true)}</div>${rtCell(a,unit,g,index,'eta')}${rtCell(d,unit,g,index,'etd')}<div class="rt-extra">${ftChip(g,srcTank,d||a)}${bunkTagHtml}</div></div>`;
    }).join('');
    const arr=n(r.arrivalFuel?.[g]!==undefined?r.arrivalFuel[g]:r.arrivalLube?.[g]),dep=n(r.departureFuel?.[g]!==undefined?r.departureFuel[g]:r.departureLube?.[g]);
    const b=r.bunkerInfo?.[g];
    const bunkerLine=b&&(b.quantity>0||b.transferred>0)?`<div class="rt-group-bunker">${b.mode==='drums'?(b.quantity>0?`Received in drums ${fmtQty(b.drumReceived,unit)}`:''):`Bunker ${fmtQty(b.quantity,unit)} · Allocated ${fmtQty(n(b.allocated)-n(b.transferred),unit)}${b.unallocated>0?` · Unallocated ${fmtQty(b.unallocated,unit)}`:''}`}${b.transferred>0?`${b.quantity>0?' · ':''}Pumped from drums ${fmtQty(b.transferred,unit)}`:''}${b.mode==='drums'||b.drumArrival>0||b.drumDeparture>0?` · In drums at ETD ${fmtQty(b.drumDeparture,unit)}`:''}</div>`:'';
    const groupHead=esc(groupLabel(g).replace(/\s*\([^)]*\)\s*$/,''));
    return `<div class="rt-group"><div class="rt-head"><span>${groupHead} (${esc(unit)})</span><span>ETA</span><span>ETD</span></div>${rows}<div class="rt-group-total"${W('gtotal',{i:index,g})}><span>${groupHead} Total ROB</span><strong>${fmtQty(arr,unit)} → ${fmtQty(dep,unit)}</strong></div>${bunkerLine}</div>`;
  }).join('');
  const total=calc.results.length;
  const anchorLine=(r.anchorStayDays>0)?`<div${W('portstay',{i:index})}><span>At ${r.anchorMode==='drift'?'drift':'anchor'}</span><strong>${Math.floor(r.anchorStayDays)} d ${r.anchorStayHours} h</strong></div>`:'';
  const anchorConsLine=(r.anchorStayDays>0)?`<div class="detail-kpi hl"${W('cons',{i:index,ph:'anchor'})}><span>At anchor/drift consumption</span><strong>${formatConsumptionHtml(r.anchorUsage)}</strong></div>`:'';
  const tankPanel=$('#tankRobCard');
  if(tankPanel)tankPanel.innerHTML=`<div class="route-detail-head"><div><h3>${esc(r.port)}</h3></div></div><details class="rt-whole" data-open-key="robwhole" ${uiOpen.has('robwhole')?'open':''}><summary class="rt-title"><h4>Tank ROB</h4>${ICON.chev}<span class="rt-hint">Press the fold icon to see more details</span><span class="rt-legend"><i class="svc-dot"></i> in service</span></summary><div class="rt-list">${tankBlocks||'<div class="empty">No tanks configured.</div>'}</div></details>`;
  panel.innerHTML=`<div class="route-detail-head"><div><small>Point ${index+1} of ${total}</small><h3>${esc(r.port)}</h3></div><div class="pd-nav"><button type="button" class="icon-btn sm" data-route-point="${index-1}" aria-label="Previous port" ${index<=0?'disabled':''}>‹</button><button type="button" class="icon-btn sm" data-route-point="${index+1}" aria-label="Next port" ${index>=total-1?'disabled':''}>›</button></div></div><div class="detail-grid"><div${W('eta',{i:index})}><span>ETA</span><strong>${fmtDate(r.arrivalUtc,r.utcOffset)}</strong><small>${fmtUTC(r.arrivalUtc)}</small></div><div${W('etd',{i:index})}><span>ETD</span><strong>${fmtDate(r.departureUtc,r.utcOffset)}</strong><small>${fmtUTC(r.departureUtc)}</small></div>${anchorLine}<div${W('portstay',{i:index})}><span>Port stay</span><strong>${Math.floor(n(r.portStayDays))} d ${n(r.portStayHours)} h</strong></div><div${W('distance',{i:index})}><span>Distance to last port</span><strong>${n(r.distanceNm).toFixed(1)} NM</strong></div><div${W('speed',{i:index})}><span>Estimated speed</span><strong>${n(r.speedKn).toFixed(1)} kn</strong></div><div${W('seadays',{i:index})}><span>Steaming days</span><strong>${days(r.seaDays)} d</strong><small>${daysHours(r.seaDays)}</small></div></div><div class="detail-kpis consumption-detail"><div class="detail-kpi hl"${W('cons',{i:index,ph:'sea'})}><span>At sea consumption</span><strong>${formatConsumptionHtml(r.seaUsage)}</strong></div>${anchorConsLine}<div class="detail-kpi hl"${W('cons',{i:index,ph:'port'})}><span>In port consumption</span><strong>${formatConsumptionHtml(r.portUsage)}</strong></div></div>${r.notes?`<p class="muted detail-note">${esc(r.notes)}</p>`:''}`;
}
/* v1.51 — swipe the Tank ROB card (or the port details) left / right to move to the next / previous port;
   the Route summary selection and every card below follow. */
function goToPoint(next,dir){
  if(!calc.results.length||next<0||next>=calc.results.length||next===selectedPoint)return;
  swipeDir=dir;renderPointDetails(next);
  ['#tankRobCard','#portDetails'].forEach(sel=>{const el=$(sel);if(el){el.classList.remove('swipe-in-next','swipe-in-prev');void el.offsetWidth;el.classList.add(dir>0?'swipe-in-next':'swipe-in-prev');}});
  const node=document.querySelector(`.route-node[data-route-point="${next}"]`);
  if(node&&node.scrollIntoView)node.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'});
}
function bindPointSwipe(){
  ['#tankRobCard','#portDetails'].forEach(sel=>{
    const el=$(sel);if(!el||el._swipeBound)return;el._swipeBound=true;
    let x0=0,y0=0,t0=0,on=false;
    el.addEventListener('touchstart',e=>{if(e.touches.length!==1){on=false;return;}const p=e.touches[0];x0=p.clientX;y0=p.clientY;t0=Date.now();on=true;},{passive:true});
    el.addEventListener('touchend',e=>{
      if(!on)return;on=false;const p=e.changedTouches[0],dx=p.clientX-x0,dy=p.clientY-y0;
      if(Math.abs(dx)<55||Math.abs(dx)<Math.abs(dy)*1.5||Date.now()-t0>900)return;
      goToPoint(selectedPoint+(dx<0?1:-1),dx<0?1:-1);
    },{passive:true});
    el.addEventListener('touchcancel',()=>{on=false;},{passive:true});
  });
}
function renderRouteSummary(activeIndex){
  const nodes=calc.results.map((r,i)=>`<button type="button" class="route-node ${i===activeIndex?'current':''} ${i===activeIndex+1?'next':''}${portFlagClass(i)}" data-route-point="${i}"><span class="route-node-index">${i+1}</span><strong>${esc(r.port)}</strong>${portFlagInfo(i).bunk||portFlagInfo(i).eca.length?`<span class="pflags">${portFlagChips(i)}</span>`:''}</button>`).join('<span class="route-line" aria-hidden="true"></span>');
  const rows=calc.results.length;
  $('#routeSummary').innerHTML=rows?`<div class="route-timeline">${nodes}</div>`:'<div class="empty">No route yet. Add ports in the Voyage tab to build the route summary.</div>';
  if(rows)renderPointDetails(activeIndex>=0?activeIndex:0);
  bindPointSwipe();
}

const rateHelp={seaRate:'Daily consumption while the vessel is at sea. Enter the planning rate used for this fuel/lubricant.',portRate:'Daily consumption while the vessel is alongside/in port. Use the vessel’s actual planning rate.',anchorRate:'Daily consumption while the vessel is at anchor or drifting (main engine stopped, auxiliaries/boiler only). Often lower than the sea rate — set to 0 if not tracked separately.',reserveDays:'Desired number of days remaining after the planned voyage/port event before a reserve warning is triggered.',reserveRate:'Rate used to convert reserve days into a reserve quantity. If left at zero, the sea rate is used.'};
function renderRates(){
  const profiles=[...state.fuels,...state.lubes];
  $('#ratesList').innerHTML=profiles.map(p=>{
    const isFuel=state.fuels.some(f=>f.id===p.id);
    const num=(field,label,step,help,sub)=>{const val=sub?n(p[sub]?.[field]):n(p[field]);const subAttr=sub?` data-rate-sub="${sub}"`:'';return `<div class="field"><label>${label}<input type="number" inputmode="decimal" step="${step}" min="0" data-rate-id="${p.id}"${subAttr} data-field="${field}" value="${val}"></label>${explain(label,help)}</div>`;};
    const reserveLabel=RESERVE_LABEL[p.id]||'Reserve/day';
    let foModeField='',rateGrid;
    if(p.id==='fo'){
      const mode=['hfo','both'].includes(p.foMode)?p.foMode:'vlsfo';
      foModeField=`<div class="field"><label>Fuel oil(s) used aboard<select data-rate-id="${p.id}" data-field="foMode"><option value="vlsfo" ${mode==='vlsfo'?'selected':''}>VLSFO only</option><option value="hfo" ${mode==='hfo'?'selected':''}>HFO only</option><option value="both" ${mode==='both'?'selected':''}>Both VLSFO and HFO</option></select></label>${explain('Fuel oil(s) used','Choose whether this vessel burns VLSFO, HFO, or switches between both (e.g. HFO outside an ECA/SECA, VLSFO inside). "Both" shows separate consumption rates for each and lets every route leg say which one is actually in use — it also drives the no-mixing bunkering rule for VLSFO automatically.')}</div>`;
      if(mode==='both')foModeField+=`<div class="field"><label class="check"><input type="checkbox" data-rate-id="${p.id}" data-field="sameAsVlsfo" ${p.sameAsVlsfo?'checked':''}> VLSFO and HFO have the same consumption rates</label>${explain('Same consumption rates','When checked, HFO uses the same at-sea/in-port/at-anchor rates, reserve days and reserve rate as VLSFO — the separate HFO fields below are hidden.')}</div>`;
      const grid=(label,sub)=>`<div class="rate-card-grid">${num('seaRate',`At sea/day (${label})`,'0.01',rateHelp.seaRate,sub)}${num('portRate',`In port/day (${label})`,'0.01',rateHelp.portRate,sub)}${num('anchorRate',`At anchor/drift/day (${label})`,'0.01',rateHelp.anchorRate,sub)}${num('reserveDays',`Reserve days (${label})`,'0.1',rateHelp.reserveDays,sub)}${num('reserveRate',`${reserveLabel} (${label})`,'0.01',rateHelp.reserveRate,sub)}</div>`;
      rateGrid=mode==='vlsfo'?grid('VLSFO',null):mode==='hfo'?grid('HFO','hfo'):(p.sameAsVlsfo?`<div class="fo-both-label">VLSFO & HFO (same rates)</div>${grid('VLSFO',null)}`:`<div class="fo-both-label">VLSFO</div>${grid('VLSFO',null)}<div class="fo-both-label">HFO</div>${grid('HFO','hfo')}`);
    }else if(p.id==='do'){
      const grid=(label,sub)=>`<div class="rate-card-grid">${num('seaRate',`At sea/day (${label})`,'0.01',rateHelp.seaRate,sub)}${num('portRate',`In port/day (${label})`,'0.01',rateHelp.portRate,sub)}${num('anchorRate',`At anchor/drift/day (${label})`,'0.01',rateHelp.anchorRate,sub)}</div>`;
      foModeField=`<div class="field"><label class="check"><input type="checkbox" data-rate-id="${p.id}" data-field="doEcaSplit" ${p.doEcaSplit?'checked':''}> Different consumption rate inside an ECA/SECA</label>${explain('Inside-ECA rate','When checked, set a separate at-sea/in-port/at-anchor rate for while the vessel is inside an ECA/SECA (e.g. running on a compliant blend or different load). It applies automatically on legs and port stays between an “entering” and the matching “leaving” on the ECA/SECA tab — reserve days and reserve/day stay the ones above.')}</div>`;
      rateGrid=`<div class="fo-both-label">Outside ECA/SECA</div>${grid('outside',null)}${num('reserveDays','Reserve days','0.1',rateHelp.reserveDays)}${num('reserveRate',reserveLabel,'0.01',rateHelp.reserveRate)}${p.doEcaSplit?`<div class="fo-both-label">Inside ECA/SECA</div>${grid('inside','insideEca')}`:''}`;
    }else if(p.id==='gesys'){
      rateGrid=`<div class="rate-card-grid">${num('seaRate','Consumption/day (at sea, in port & at anchor/drift)','0.01','One daily consumption figure used for GE system oil in every phase: at sea, in port and at anchor/drift.')}${num('reserveDays','Reserve days','0.1',rateHelp.reserveDays)}${num('reserveRate',reserveLabel,'0.01',rateHelp.reserveRate)}</div>`;
    }else if(p.id==='cyl'||p.id==='mesys'){
      rateGrid=`<div class="rate-card-grid">${num('seaRate','At sea/day','0.01',rateHelp.seaRate)}${num('reserveDays','Reserve days','0.1',rateHelp.reserveDays)}${num('reserveRate',reserveLabel,'0.01',rateHelp.reserveRate)}</div><span class="help">No consumption in port or at anchor/drift for this lubricant.</span>`;
    }else{
      rateGrid=`<div class="rate-card-grid">${num('seaRate','At sea/day','0.01',rateHelp.seaRate)}${num('portRate','In port/day','0.01',rateHelp.portRate)}${num('anchorRate','At anchor/drift/day','0.01',rateHelp.anchorRate)}${num('reserveDays','Reserve days','0.1',rateHelp.reserveDays)}${num('reserveRate',reserveLabel,'0.01',rateHelp.reserveRate)}</div>`;
    }
    return `<div class="item-card rate-card ${isFuel?'is-fuel':'is-lube'}"><div class="rate-top"><span class="tag">${isFuel?'Fuel':'Lube'} (${esc(p.unit)})</span><div class="field"><input class="big-input" aria-label="Name" data-rate-id="${p.id}" data-field="name" value="${esc(p.name)}">${explain('Name','Shown throughout the dashboard and tank list.')}</div></div>${foModeField}${rateGrid}<span class="help">Reserve quantity = reserve days × reserve/day. These are planning inputs; verify them against vessel records and company requirements.</span></div>`;
  }).join('');
}
function tankDefaultName(group,category='storage'){
  const presets=(NAME_PRESETS[group]&&NAME_PRESETS[group][category])||null;
  const used=new Set(state.tanks.map(t=>t.name));
  if(presets){const free=presets.find(p=>!used.has(p));if(free)return free;}
  const count=state.tanks.filter(t=>t.group===group).length+1;
  return `${groupLabel(group)} Tank ${count}`;
}
function nameOptionsFor(group,category){return(NAME_PRESETS[group]&&NAME_PRESETS[group][category])||[];}
function normalizeSequence(group){const arr=consumptionOrder(state.tanks.filter(t=>t.group===group&&isCons(t)));arr.forEach((t,i)=>t.sequence=i+1);}
function nextOrder(group){return state.tanks.filter(t=>t.group===group).reduce((m,t)=>Math.max(m,n(t.order)),-1)+1;}
function orderedGroupTanks(group){return state.tanks.map((t,i)=>({t,i})).filter(x=>x.t.group===group).sort((a,b)=>n(a.t.order)-n(b.t.order)||a.i-b.i);}
function moveTankOrder(i,dir){
  const t=state.tanks[i];if(!t)return;
  const arr=orderedGroupTanks(t.group).map(x=>x.t);
  const pos=arr.findIndex(x=>x===t);
  const target=dir==='up'?pos-1:pos+1;
  if(pos<0||target<0||target>=arr.length)return;
  const a=arr[pos],b=arr[target],tmp=a.order;a.order=b.order;b.order=tmp;
}
function moveRoute(i,dir){
  const target=dir==='up'?i-1:i+1;
  if(target<0||target>=state.route.length)return;
  const tmp=state.route[i];state.route[i]=state.route[target];state.route[target]=tmp;
}
function barColorClass(group){return group==='fo'?'bar-fo':group==='do'?'bar-do':'bar-lo';}
function tankSummaryBits(t){
  const unit=getProfile(t.group)?.unit||'MT',cap=Math.max(0,n(t.capacity)),rob=Math.max(0,n(t.rob)),util=cap?rob/cap:0;
  return{unit,cap,rob,util,cls:util>1?'danger':util>.9?'warn':'',over85:util>bunkerFillFrac()&&util<=1+1e-9,bar:barColorClass(t.group),qty:`${fmtN(rob,unit)} / ${fmtN(cap,unit)} ${unit}`,pct:`${Math.round(util*100)}%`,width:Math.min(100,Math.max(0,util*100))};
}
const CATEGORY_LABEL={storage:'Storage / active',settling:'Settling tank',service:'Service tank',support:'Support / fixed ROB'};
function tankCard(t,i,groupOrder){
  const b=tankSummaryBits(t),unit=b.unit,consumable=isCons(t),fixedRole=isFixedRole(t);
  const groupTanks=tanksFor(t.group,true),seq=Math.max(1,groupTanks.findIndex(x=>x.id===t.id)+1);
  const seqField=consumable
    ?`<div class="field f-num tk-seq"><label>Sequence<select data-tank-sequence="${i}">${Array.from({length:Math.max(1,groupTanks.length)},(_,k)=>`<option value="${k+1}" ${k+1===seq?'selected':''}>${k+1}${k===0?' (first)':''}</option>`).join('')}</select></label>${explain('Consumption sequence','Only consumable fuel/storage tanks use a sequence. Sequence 1 is consumed first.')}</div>`
    :`<div class="fixed-rob-note tk-seq"><strong>Fixed ROB</strong><small>Counted in total ROB, not drained automatically.</small></div>`;
  const move=`<div class="sequence-actions"><button type="button" class="icon-btn" data-move-order="${i}" data-direction="up" aria-label="Move tank up in list" title="Move up">${ICON.up}</button><button type="button" class="icon-btn" data-move-order="${i}" data-direction="down" aria-label="Move tank down in list" title="Move down">${ICON.down}</button></div>`;
  const key='tank:'+t.id;
  const presets=nameOptionsFor(t.group,t.category);
  const useCustomName=t.nameCustom===true||(presets.length>0&&!presets.includes(t.name));
  const nameField=presets.length
    ?`<div class="field f-wide"><label>Tank name<select data-tank-index="${i}" data-field="namePreset">${presets.map(p=>`<option value="${esc(p)}" ${!useCustomName&&t.name===p?'selected':''}>${esc(p)}</option>`).join('')}<option value="${CUSTOM_NAME}" ${useCustomName?'selected':''}>Custom (type manually)</option></select></label>${explain('Tank name','Pick a default name for this fuel/lube group and role, or choose Custom to type your own.')}<input data-tank-index="${i}" data-field="name" class="manual-name-input" value="${esc(t.name)}" placeholder="${esc(tankDefaultName(t.group,t.category))}" autocomplete="off" ${useCustomName?'':'hidden'}></div>`
    :`<div class="field f-wide"><label>Tank name<input data-tank-index="${i}" data-field="name" value="${esc(t.name)}" placeholder="${esc(tankDefaultName(t.group,t.category))}" autocomplete="off"></label>${explain('Tank name','Physical tank identification used throughout the plan and export.')}</div>`;
  const volTank=!!fuelTypeOptions(t.group)&&t.capUnit!=='weight',robMt=volTank&&t.robInput==='mt';
  const capField=volTank
    ?`<div class="field f-cap"><label>Capacity (m³)<input type="number" inputmode="decimal" step="0.01" min="0" data-tank-index="${i}" data-field="capacityM3" value="${n(t.capacityM3||(n(t.density)?n(t.capacity)/n(t.density):0))}"></label>${explain('Capacity','Tank capacity by volume. Converted to tonnes using the density below.')}<span class="cap-mt">≈ ${fmtN(t.capacity,unit)} ${esc(unit)}</span></div>`
    :`<div class="field f-cap"><label>Capacity (${esc(unit)})<input type="number" inputmode="decimal" step="0.01" min="0" data-tank-index="${i}" data-field="capacity" value="${n(t.capacity)}"></label>${explain('Capacity','Approved/calibrated planning capacity for this tank.'+(fuelTypeOptions(t.group)?' Entered directly in weight, as chosen when this tank was added.':''))}</div>`;
  const robInField=`<div class="field f-num chg"><label>Present ROB (${esc(unit)})<input type="number" inputmode="decimal" step="0.01" min="0" data-tank-index="${i}" data-field="rob" value="${n(t.rob)}"></label>${explain('Present ROB','Current accepted onboard quantity at the planning start point.'+(fuelTypeOptions(t.group)?(volTank?' Entered directly in MT — the corrected volume and temperature are not used while ROB is entered as weight.':' Entered directly in weight, as chosen when this tank was added.'):''))}</div>`;
  const unpumpField=`<div class="field f-num"><label>Unpumpable (${esc(unit)})<input type="number" inputmode="decimal" step="0.01" min="0" data-tank-index="${i}" data-field="unpumpable" value="${n(t.unpumpable)}"></label>${explain('Unpumpable','Quantity retained as unavailable for consumption/reserve calculations.')}</div>`;
  const pumpField=`<div class="field f-num rob-computed pump"><span>Pumpable ROB</span><strong class="pump-val">${fmtN(Math.max(0,n(t.rob)-n(t.unpumpable)),unit)} ${esc(unit)}</strong><small class="rob-computed-note">Present ROB − unpumpable</small></div>`;
  const densField=`<div class="field f-num chg tk-dens"><label>Density (t/m³)<input type="number" inputmode="decimal" step="0.001" min="0.5" max="1.2" data-tank-index="${i}" data-field="density" value="${n(t.density||0.95)}"></label>${explain('Density','Average density of this fuel/diesel grade, used to convert the tank’s volume (m³) to tonnes (MT) for the ROB, consumption and bunkering calculations.')}</div>`;
  const robAsField=`<div class="field f-num tk-robas"><label>Enter ROB as<select data-tank-index="${i}" data-field="robInput"><option value="volume" ${robMt?'':'selected'}>Volume (m³)</option><option value="mt" ${robMt?'selected':''}>Weight (MT)</option></select></label>${explain('Enter ROB as','Choose how the present ROB of this tank is entered: from the sounded corrected volume and temperature (converted to MT with ASTM Tables 54B/56), or directly in MT. Switching keeps the current ROB, so nothing jumps.')}</div>`;
  /* v1.41: Present ROB sits in the left column with Density directly below it; Unpumpable and Pumpable ROB stack in the right column. */
  const restFields=volTank
    ?(robMt
      ?`${robInField}${unpumpField}${densField}${pumpField}`
      :`<div class="field f-num chg"><label>Corrected Volume (m³)<input type="number" inputmode="decimal" step="0.01" min="0" data-tank-index="${i}" data-field="robVolumeM3" value="${n(t.robVolumeM3)}"></label>${explain('Corrected Volume','Sounded/dipped tank volume at the planning start point, already corrected for trim, list and the tank calibration table (from the ullage report) — not yet temperature-corrected.')}</div><div class="field f-num chg"><label>Observed temp. (°C)<input type="number" inputmode="decimal" step="0.1" data-tank-index="${i}" data-field="robTempC" value="${n(t.robTempC!==undefined?t.robTempC:15)}"></label>${explain('Observed temperature','Fuel temperature in the tank when sounded. Used with the density below — ASTM Table 54B corrects the volume to 15°C, then Table 56 converts it to weight in air.')}</div><div class="field f-num rob-computed"><span>Present ROB (computed)</span><strong class="rob-computed-val">${fmtN(t.rob,unit)} ${esc(unit)}</strong><small class="rob-computed-note">ASTM 54B/56, from Volume × density</small></div>${unpumpField}${densField}${pumpField}`)
    :`${robInField}${unpumpField}${pumpField}`;
  return `<details class="item-card tank-card ${consumable?'':'fixed-tank'}" id="tankcard-${esc(t.id)}" data-open-key="${key}" data-tank-card="${i}" ${uiOpen.has(key)?'open':''}>
    <summary class="tank-sum"><span class="seq-chip ${consumable?'':'fixed'}" title="${consumable?'Consumption order':'Fixed ROB tank'}">${consumable?seq:'F'}</span><span class="tk-main"><span class="tk-title">${esc(t.name||tankDefaultName(t.group,t.category))}</span><span class="tk-qty">${fuelTypeOptions(t.group)?`<span class="tk-fueltype">${esc(fuelTypeLabel(t.group,t.fuelType||defaultFuelType(t.group)))}${fmtSul(tankSulphur(t))?` · ${esc(fmtSul(tankSulphur(t)))}`:''}</span> · `:''}${b.qty}</span></span><span class="tk-side"><span class="tk-pct">${b.pct}</span>${ICON.chev}</span><span class="tank-bar tk-bar ${b.bar} ${b.cls} ${b.over85?'over85':''}"><span style="width:${b.width}%"></span></span></summary>
    <div class="tank-body">
      <div class="tank-fields">
        <div class="field"><label>Tank role<select data-tank-index="${i}" data-field="category"><option value="storage" ${t.category==='storage'?'selected':''}>${CATEGORY_LABEL.storage}</option><option value="settling" ${t.category==='settling'?'selected':''}>${CATEGORY_LABEL.settling}</option><option value="service" ${t.category==='service'?'selected':''}>${CATEGORY_LABEL.service}</option><option value="support" ${t.category==='support'?'selected':''}>${CATEGORY_LABEL.support}</option></select></label>${explain('Tank role','Settling/service/support tanks are excluded from automatic consumption but remain in total ROB.')}</div>
        ${capField}
        ${fuelTypeOptions(t.group)?`<div class="field f-wide ft-sul-row"><div class="ft-col"><label>Fuel type${manualPickHtml(fuelTypeOptions(t.group),t.fuelType||defaultFuelType(t.group),`data-mp="tank" data-tank-index="${i}"`,'Type fuel type')}</label>${explain('Fuel type','The grade this tank is dedicated to (pick from the list or type your own). New VLSFO can never be mixed with old VLSFO, so it needs an empty VLSFO tank (only the unpumpable quantity may remain — VLSFO may be mixed with that). HFO, diesel oil and biodiesel may be topped up into a tank holding the same type.')}</div><div class="sul-col"><label>Sulphur (% m/m)<input type="number" inputmode="decimal" step="0.01" min="0" max="5" placeholder="${tankSulPlaceholder(t)}" data-tank-index="${i}" data-field="sulphur" value="${esc(sulVal(t.sulphur))}"></label>${explain('Sulphur content','Sulphur content (% m/m) of the fuel now in this tank, from its BDN. Leave blank to use the default (VLSFO 0.5 %, LSMGO 0.1 %). When a bunker is loaded into this tank, the planner updates it automatically as a mass-weighted blend of the old ROB and the new fuel — see the projected value shown below.')}<small class="sul-proj" data-sul-proj="${esc(t.id)}">${sulProjText(t)}</small></div></div>`:''}
        ${nameField}
        ${volTank?robAsField:''}
        ${seqField}
        ${restFields}
      </div>
      <div class="tank-foot"><label class="check"><input type="checkbox" data-tank-index="${i}" data-field="consumable" ${t.consumable!==false?'checked':''}> Consume automatically</label><button type="button" class="danger ghost sm" data-remove-tank="${i}">${ICON.trash}<span>Remove</span></button><div class="foot-move" role="group" aria-label="Move tank position">${move}</div></div>
    </div>
  </details>`;
}
/* ---- Save tank condition: date/time + density, volume, temperature and ROB of every tank ---- */
let tankSaveAtDraft=null;
let tankSaveModeDraft='offset',tankSaveOffsetDraft=null,tankSavePortDraft='';
/* Time zone of the tank-condition form: {mode, ok, offset, port, note}. In port mode the UTC offset is looked up from the port name. */
function tankSaveZone(wall){
  if(tankSaveModeDraft==='port'){
    if(!String(tankSavePortDraft).trim())return{mode:'port',ok:false,offset:null,port:'',note:'Choose a port from the list — its UTC offset is filled in automatically.'};
    const key=portKey(tankSavePortDraft),off=key?portUtcOffset(key,wall):null;
    return off===null?{mode:'port',ok:false,offset:null,port:'',note:'Port not recognised — pick one from the list, or switch to UTC offset.'}:{mode:'port',ok:true,offset:off,port:key,note:`${key}: ${utcOffsetLabel(off)} on this date (detected automatically).`};
  }
  return{mode:'offset',ok:true,offset:tankSaveOffsetDraft!==null?n(tankSaveOffsetDraft):n(state.meta.posUtcOffset),port:'',note:''};
}
const fmtAtLocal=l=>l&&l.atLocal?`${String(l.atLocal).replace('T',' ')} local (${utcOffsetLabel(n(l.utcOffset))}${l.port?`, ${l.port}`:''})`:'—';
function refreshTankSaveZone(){const z=tankSaveZone($('#tankSaveAt')?.value||tankSaveAtDraft||''),el=$('#tankSaveZoneNote');if(el){el.textContent=z.note;el.className=`tsg-note ${z.mode==='port'?(z.ok?'ok':'warn'):''}`;}}
function tankConditionOf(t){
  const vol=!!fuelTypeOptions(t.group)&&t.capUnit!=='weight';
  return{id:t.id,name:t.name,group:t.group,...(sulphurOf(t.sulphur)!==null&&fuelTypeOptions(t.group)?{sulphur:sulphurOf(t.sulphur)}:{}),...(vol?{density:n(t.density),robVolumeM3:n(t.robVolumeM3),robTempC:n(t.robTempC!==undefined?t.robTempC:15),...(t.robInput==='mt'?{robInput:'mt'}:{})}:{}),rob:Math.round(n(t.rob)*1000)/1000};
}
const tankSig=list=>JSON.stringify((list||[]).map(x=>[x.id,x.density,x.robVolumeM3,x.robTempC,x.rob,x.sulphur,x.robInput]));
function tankCondStatus(){
  const log=state.tankLog||[];
  if(!log.length)return{cls:'',text:'Not saved yet — enter all tank data, then tap Save tank condition.'};
  const same=tankSig(state.tanks.map(tankConditionOf))===tankSig(log[0].tanks);
  return same?{cls:'ok',text:`Latest saved: ${fmtAtLocal(log[0])} — no changes since.`}:{cls:'warn',text:`Latest saved: ${fmtAtLocal(log[0])} — tank data has changed since. Save again to keep the new values.`};
}
function updateTankSaveStatus(){refreshTankFab();const el=$('#tankSaveStatus');if(!el)return;const st=tankCondStatus();el.className=`tank-save-status ${st.cls}`;el.textContent=st.text;}
function renderTankSave(){
  const host=$('#tankSavePanel');if(!host)return;
  const log=state.tankLog||[],st=tankCondStatus();
  const z0=tankSaveZone(tankSaveAtDraft||''),atVal=tankSaveAtDraft||nowWall(z0.ok?z0.offset:n(state.meta.posUtcOffset)),zn=tankSaveZone(atVal);
  const curOff=tankSaveOffsetDraft!==null?n(tankSaveOffsetDraft):n(state.meta.posUtcOffset);
  const zoneCtl=tankSaveModeDraft==='port'
    ?`<label class="pos-offset pos-port">Port name<input id="tankSavePort" list="defaultPorts" placeholder="Select or type port" autocomplete="off" value="${esc(tankSavePortDraft)}"></label>`
    :`<label class="pos-offset">UTC offset<select id="tankSaveOffset">${UTC_OFFSETS.map(o=>`<option value="${o}" ${Math.abs(curOff-o)<0.01?'selected':''}>${utcOffsetLabel(o)}</option>`).join('')}</select></label>`;
  const sum=(l,g)=>l.tanks.filter(x=>x.group===g).reduce((a,x)=>a+n(x.rob),0);
  const items=log.map(l=>`<li class="tank-log-item"><div class="tl-main"><strong>${esc(fmtAtLocal(l))}</strong><small>${l.tanks.length} tank${l.tanks.length===1?'':'s'} · FO ${fmtN(sum(l,'fo'),'MT')} MT · DO ${fmtN(sum(l,'do'),'MT')} MT</small></div><div class="tl-actions"><button type="button" class="ghost sm" data-tank-restore="${esc(l.id)}">Restore</button><button type="button" class="danger ghost sm" data-tank-log-del="${esc(l.id)}">Delete</button></div></li>`).join('');
  const top=$('#tankDatePanel');
  if(top)top.innerHTML=`<div class="tcr-title"><span>Tank condition report</span></div><div class="panel-heading"><div><h3>Condition date &amp; time</h3><span class="help" style="display:block">Set the date and time of the tank condition here, update the tank data below, then tap the floating Save button.</span></div></div>
    <div class="tank-save-row">
      <div class="field tsg-date"><div class="pos-row"><label class="pos-name">Condition date &amp; time (Local time)<input id="tankSaveAt" type="datetime-local" value="${esc(atVal)}"></label>${zoneCtl}</div><div class="noon-date-actions tsg-seg" role="group" aria-label="Date and time zone"><button type="button" class="ghost sm" data-tank-save-now title="Set the date to today (local time), keeping the time">Today (local)</button><button type="button" class="ghost sm ${tankSaveModeDraft==='offset'?'on':''}" aria-pressed="${tankSaveModeDraft==='offset'}" data-tank-zone-mode="offset">UTC offset</button><button type="button" class="ghost sm ${tankSaveModeDraft==='port'?'on':''}" aria-pressed="${tankSaveModeDraft==='port'}" data-tank-zone-mode="port">Port name</button></div><small id="tankSaveZoneNote" class="tsg-note ${tankSaveModeDraft==='port'?(zn.ok?'ok':'warn'):''}">${esc(zn.note)}</small></div>
    </div>`;
  host.innerHTML=`<div class="panel-heading"><div><h3>Saved tank conditions</h3><span class="help" style="display:block">Use the floating Save button to store the date and time set at the top of this tab together with every tank’s density, volume, temperature and ROB. Saved conditions stay on this device and can be restored later.</span></div></div>
    <div id="tankSaveStatus" class="tank-save-status ${st.cls}">${esc(st.text)}</div>
    ${log.length?`<details class="fold flat tank-log"><summary>Saved tank conditions (${log.length})</summary><ul class="tank-log-list">${items}</ul></details>`:''}`;
}
/* v1.48 — floating Save button + leave-tab guard. tankBaseline is the tank-condition signature when the Tanks tab was
   opened (or last saved); leaving the tab with a different signature asks whether to save first. */
let tankBaseline=null,pendingLeaveTab=null;
const currentTankSig=()=>tankSig(state.tanks.map(tankConditionOf));
const tankDirty=()=>tankBaseline!==null&&currentTankSig()!==tankBaseline;
const SAVE_FAB_TABS=['setup','tanks','voyage','bunkering','eca'];
let saveToastTimer=null;
function showSaveToast(msg){
  let t=document.getElementById('saveToast');
  if(!t){t=document.createElement('div');t.id='saveToast';t.className='save-toast';t.setAttribute('role','status');t.setAttribute('aria-live','polite');document.body.appendChild(t);}
  t.textContent='✓ '+msg;t.classList.add('show');clearTimeout(saveToastTimer);saveToastTimer=setTimeout(()=>t.classList.remove('show'),3200);
}
/* Floating Save on Setup / Ports / Bunkering / ECA: commits the field being edited, then re-runs every calculation and saves the plan. */
function saveAllAndRecalc(){
  const ae=document.activeElement;if(ae&&ae!==document.body&&typeof ae.blur==='function')ae.blur();
  rerun();showSaveToast('Saved — all data and calculations updated.');
}
function refreshTankFab(){const f=$('#tankFab');if(!f)return;f.hidden=!SAVE_FAB_TABS.includes(currentTab);f.classList.toggle('dirty',currentTab==='tanks'&&tankDirty());f.setAttribute('aria-label',currentTab==='tanks'?'Save tank condition':'Save and update calculations');}
function leaveTankChoice(choice){
  const id=pendingLeaveTab;$('#tankLeaveModal').hidden=true;pendingLeaveTab=null;
  if(choice==='stay'||!id)return;
  if(choice==='save'&&!saveTankCondition())return;
  tankBaseline=currentTankSig();showTab(id,{force:true});
}
function saveTankCondition(){
  if(!state.tanks.length){alert('Add at least one tank before saving the tank condition.');return false;}
  const typed=$('#tankSaveAt')?.value||'',z0=tankSaveZone(typed),at=typed||nowWall(z0.ok?z0.offset:n(state.meta.posUtcOffset)),z=tankSaveZone(at);
  if(!z.ok){alert(z.note||'Choose a UTC offset or a port first.');return false;}
  state.tankLog=[{id:uid('tc'),atLocal:at,utcOffset:z.offset,port:z.port,savedUtc:new Date().toISOString(),tanks:state.tanks.map(tankConditionOf)},...(state.tankLog||[])].slice(0,20);
  tankSaveAtDraft=null;save();renderTankSave();tankBaseline=currentTankSig();refreshTankFab();showSaveToast('Tank condition has been saved.');return true;
}
function restoreTankCondition(id){
  const l=(state.tankLog||[]).find(x=>x.id===id);if(!l)return;
  if(!confirm(`Restore the tank condition saved for ${fmtAtLocal(l)}? Density, volume, temperature and ROB of the listed tanks will be replaced by the saved values.`))return;
  l.tanks.forEach(sn=>{
    const x=state.tanks.find(t=>t.id===sn.id);if(!x)return;
    if(sn.density!==undefined&&fuelTypeOptions(x.group)&&x.capUnit!=='weight'){
      x.density=n(sn.density);x.robVolumeM3=n(sn.robVolumeM3);x.robTempC=n(sn.robTempC);
      x.capacity=n(x.density)>0?n(x.capacityM3)*n(x.density):0;
      if(sn.robInput==='mt'){x.robInput='mt';x.rob=n(sn.rob);}
      else{delete x.robInput;x.rob=Math.max(0,robFromVolume(x.robVolumeM3,x.robTempC,x.density));}
    }else x.rob=n(sn.rob);
    if(sn.sulphur!==undefined)x.sulphur=n(sn.sulphur);else if(fuelTypeOptions(x.group))delete x.sulphur;
  });
  rerun();
}
function deleteTankCondition(id){
  const l=(state.tankLog||[]).find(x=>x.id===id);if(!l)return;
  if(!confirm(`Delete the saved tank condition for ${fmtAtLocal(l)}?`))return;
  state.tankLog=state.tankLog.filter(x=>x.id!==id);save();renderTankSave();
}
/* Group header line: total ROB / capacity, plus the total ROB minus the unpumpable quantity. */
function tankGroupSummary(id,unit){
  const items=orderedGroupTanks(id);if(!items.length)return'No tanks yet';
  const rob=items.reduce((a,x)=>a+Math.max(0,n(x.t.rob)),0),cap=items.reduce((a,x)=>a+Math.max(0,n(x.t.capacity)),0),pump=items.reduce((a,x)=>a+Math.max(0,n(x.t.rob)-Math.max(0,n(x.t.unpumpable))),0);
  return `${fmtN(rob,unit)} / ${fmtN(cap,unit)} ${esc(unit)} in ${items.length} tank${items.length>1?'s':''}<span class="tg-pump">Pumpable ROB: <b>${fmtN(pump,unit)} ${esc(unit)}</b></span>`;
}
function renderTanks(){
  renderMaxFillBar();
  const groups=[...state.fuels,...state.lubes],ids=groups.map(g=>g.id);
  const section=(id,title,unit)=>{
    const items=orderedGroupTanks(id);
    return `<div class="tank-group"><div class="tg-head"><div><strong>${esc(title)}</strong><small data-tg-sum="${esc(id||'')}">${tankGroupSummary(id,unit)}</small></div>${id?`<button type="button" class="ghost sm" data-add-tank="${esc(id)}">${ICON.plus}<span>Tank</span></button>`:''}</div>${items.map((x,pos)=>tankCard(x.t,x.i,pos+1)).join('')}</div>`;
  };
  let html=groups.map(g=>section(g.id,g.name,g.unit)).join('');
  if(state.tanks.some(t=>!ids.includes(t.group))){
    const items=state.tanks.map((t,i)=>({t,i})).filter(x=>!ids.includes(x.t.group));
    html+=`<div class="tank-group"><div class="tg-head"><div><strong>Other tanks</strong></div></div>${items.map((x,pos)=>tankCard(x.t,x.i,pos+1)).join('')}</div>`;
  }
  $('#tankList').innerHTML=html;
  renderTankSequenceSummary();
  renderTankSave();
}
function renderTankSequenceSummary(){
  $('#activeTankList').innerHTML=[...state.fuels,...state.lubes].map(p=>{const ts=tanksFor(p.id,true);return `<div class="sequence-box"><strong>${esc(p.name)}</strong>${ts.length?ts.map((t,idx)=>`<div class="sequence-item"><span><span class="badge">${idx+1}</span> ${esc(t.name)}</span><strong>${fmtQty(t.rob,p.unit)}</strong></div>`).join(''):'<div class="muted">No automatic-consumption tanks configured.</div>'}</div>`;}).join('');
}
function syncTankCard(i){
  const t=state.tanks[i],card=document.querySelector(`[data-tank-card="${i}"]`);if(!t||!card)return;
  const b=tankSummaryBits(t);
  card.querySelector('.tk-title').textContent=t.name||tankDefaultName(t.group,t.category);
  const qtyEl=card.querySelector('.tk-qty'),hasFt=!!qtyEl.querySelector('.tk-fueltype');qtyEl.innerHTML=hasFt?`<span class="tk-fueltype">${esc(fuelTypeLabel(t.group,t.fuelType||defaultFuelType(t.group)))}${fmtSul(tankSulphur(t))?` · ${esc(fmtSul(tankSulphur(t)))}`:''}</span> · ${esc(b.qty)}`:esc(b.qty);card.querySelector('.tk-pct').textContent=b.pct;
  const bar=card.querySelector('.tk-bar');bar.className=`tank-bar tk-bar ${b.bar} ${b.cls} ${b.over85?'over85':''}`;bar.firstElementChild.style.width=`${b.width}%`;
  const capMt=card.querySelector('.cap-mt');if(capMt)capMt.textContent=`≈ ${fmtN(t.capacity,b.unit)} ${b.unit}`;
  const robVal=card.querySelector('.rob-computed-val');if(robVal)robVal.textContent=`${fmtN(t.rob,b.unit)} ${b.unit}`;
  const pumpVal=card.querySelector('.pump-val');if(pumpVal)pumpVal.textContent=`${fmtN(Math.max(0,n(t.rob)-n(t.unpumpable)),b.unit)} ${b.unit}`;
  const tgs=document.querySelector(`[data-tg-sum="${t.group}"]`);if(tgs)tgs.innerHTML=tankGroupSummary(t.group,b.unit);
  const sIn=card.querySelector('[data-field="sulphur"]');if(sIn)sIn.placeholder=tankSulPlaceholder(t);
  document.querySelectorAll('[data-sul-proj]').forEach(el=>{const tk=state.tanks.find(x=>x.id===el.dataset.sulProj);if(tk)el.textContent=sulProjText(tk).replace(/&amp;/g,'&');});
  updateTankSaveStatus();
}
function routeMeta(r){const anchor=(Math.max(0,n(r.anchorStayDays))||Math.max(0,n(r.anchorStayHours)))?`, ${Math.floor(n(r.anchorStayDays))}d ${n(r.anchorStayHours)}h at ${r.anchorMode==='drift'?'drift':'anchor'}`:'';const fuelTag=getProfile('fo')?.foMode==='both'?`, ${r.foActiveFuel==='hfo'?'HFO':'VLSFO'}`:'';return `${n(r.distanceNm).toFixed(0)} NM at ${n(r.speedKn)} kn${anchor}, port stay ${Math.floor(n(r.portStayDays))} d ${n(r.portStayHours)} h${fuelTag}`;}
/* Position along the leg (previous departure -> this arrival, or this departure -> next arrival)
   at a given absolute time T, by simple time-fraction interpolation over the leg's distance — the
   app has no port coordinates, so position is expressed relative to the two end ports. */
function positionAtTime(legStartMs,legEndMs,distanceNm,T){
  const span=legEndMs-legStartMs,frac=span>0?Math.max(0,Math.min(1,(T-legStartMs)/span)):1;
  return{frac,nmRun:frac*n(distanceNm),nmLeft:(1-frac)*n(distanceNm)};
}
/* ---------------------------------------------------------------------------------------------
   ECA / SECA fuel change-over — FOBAS-style, calculated separately for the Main Engine, the Aux.
   Engine(s) and the Boiler(s) using the formulas of FOBAS_Changeover_Calculator_with_Formulas.xlsx
   (see fobasChangeover() in core.js). The vessel is ready when the slowest system has finished.
   --------------------------------------------------------------------------------------------- */
const ECA_SYSTEMS=[{key:'me',label:'Main Engine',color:'#ffc63a'},{key:'ae',label:'Aux. Engine',color:'#5ec8ff'},{key:'boiler',label:'Boiler',color:'#ff8a8a'}];
const fmtH=h=>h===null||h===undefined||!Number.isFinite(h)?'—':`${h.toFixed(1)} h`;
const iso=ms=>new Date(ms).toISOString();
/* Litres -> tonnes for the service-system quantity uses the density entered on the Tanks tab
   for the fuel that sits in the service system (the "from" fuel of the changeover). Tanks of that
   fuel type are used; if several, the density is ROB-weighted. */
function ecaFuelGroup(v){return /mgo|diesel|\bdo\b|bio|gasoil|gas oil/.test(String(v||'').toLowerCase())?'do':'fo';}
function ecaFuelDensity(fuel){
  const g=ecaFuelGroup(fuel),want=String(fuel||'').trim().toLowerCase();
  const pool=(state.tanks||[]).filter(t=>t.group===g&&t.capUnit!=='weight'&&n(t.density)>0);
  if(!pool.length)return null;
  const matched=pool.filter(t=>String(t.fuelType||defaultFuelType(t.group)).trim().toLowerCase()===want);
  const use=matched.length?matched:pool,wt=use.reduce((a,t)=>a+Math.max(0,n(t.rob)),0);
  const d=wt>0?use.reduce((a,t)=>a+n(t.density)*Math.max(0,n(t.rob)),0)/wt:use.reduce((a,t)=>a+n(t.density),0)/use.length;
  return{density:d,exact:matched.length>0,count:use.length,group:g};
}
function ecaQtyInfo(dir,cfg,i,sys){
  const c=cfg[sys]||{};
  if(c.qtyUnit!=='L')return{qty:n(c.qty),unit:'t'};
  const fuel=ecaFuels(cfg,dir,i).from,d=ecaFuelDensity(fuel);
  return{qty:d?n(c.qtyL)*d.density/1000:0,unit:'L',dens:d,fuel};
}
function ecaDensityNote(info){
  if(!info.dens)return `No density found on the Tanks tab for ${ecaFuelLabel(info.fuel)} — enter a ${ecaFuelGroup(info.fuel)==='do'?'Diesel Oil':'Fuel Oil'} tank by volume with its density there, then the litres convert to tonnes here.`;
  return `Density ${info.dens.density.toFixed(3)} t/m³ from the Tanks tab (${info.dens.exact?ecaFuelLabel(info.fuel)+' tank'+(info.dens.count>1?'s, ROB-weighted':''):'no '+ecaFuelLabel(info.fuel)+' tank set — using other '+(info.dens.group==='do'?'diesel':'fuel')+' tanks'}).`;
}
function ecaSystemResults(dir,cfg,i){
  const enter=dir==='entering',from=n(cfg.fromSulphurPct),to=n(cfg.toSulphurPct);
  const req=ecaRequiredS(dir,cfg);
  const list=ECA_SYSTEMS.map(s=>{
    const c={...(cfg[s.key]||{})};
    if(c.on===false)return{...s,skipped:true};
    c.qty=ecaQtyInfo(dir,cfg,i,s.key).qty;
    return{...s,c,res:fobasChangeover({rate:c.rate,qty:c.qty,fromS:from,toS:to,reqS:req,mode:enter?'down':'up'})};
  });
  const done=list.filter(x=>!x.skipped&&x.res.valid&&x.res.planning!==null);
  return{list,req,from,to,planning:done.length?Math.max(...done.map(x=>x.res.planning)):null,anyProblem:list.some(x=>!x.skipped&&(!x.res.valid||x.res.planning===null))};
}
function niceScale(raw){
  for(const step of [0.01,0.02,0.05,0.1,0.2,0.25,0.5,1,2,5,10]){if(raw/step<=6)return{step,max:Math.ceil(raw/step-1e-9)*step};}
  return{step:10,max:Math.ceil(raw/10)*10};
}
/* "Sulphur at engine inlet vs time" — same two series per system as the workbook's chart
   (solid = step method, dashed = exact continuous mixing), over 0–40 h. */
function ecaChartHtml(dir,sr){
  const shown=sr.list.filter(x=>!x.skipped&&x.res.valid&&x.res.curve.length);
  if(!shown.length)return'';
  const XMAX=40,W=340,H=228,L=42,Rm=12,Tm=14,Bm=46,pw=W-L-Rm,ph=H-Tm-Bm;
  const {step,max:ymax}=niceScale(Math.max(sr.from,sr.to,sr.req,0.05)*1.04);
  const X=t=>L+t/XMAX*pw,Y=s=>Tm+ph-Math.max(0,Math.min(ymax,s))/ymax*ph;
  const dec=step<0.1?2:step<1?1:0;
  let grid='';
  for(let v=0;v<=ymax+1e-9;v+=step){grid+=`<line class="grid" x1="${L}" x2="${W-Rm}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L-5}" y="${(Y(v)+3).toFixed(1)}" text-anchor="end">${v.toFixed(dec)}</text>`;}
  for(let t=0;t<=XMAX;t+=5){grid+=`<line class="grid v" x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${Tm}" y2="${Tm+ph}"/><text x="${X(t).toFixed(1)}" y="${Tm+ph+13}" text-anchor="middle">${t}</text>`;}
  const pts=c=>c.map(([t,s])=>`${X(t).toFixed(1)},${Y(s).toFixed(1)}`).join(' ');
  const lines=shown.map(x=>`<g class="eca-series" data-sys="${esc(x.key)}"><polyline points="${pts(x.res.exactCurve)}" fill="none" stroke="${x.color}" stroke-width="1.3" stroke-dasharray="4 3" opacity=".85"/><polyline points="${pts(x.res.curve)}" fill="none" stroke="${x.color}" stroke-width="2.2" stroke-linejoin="round"/>${x.res.planning!==null&&x.res.planning<=XMAX?`<circle cx="${X(x.res.planning).toFixed(1)}" cy="${Y(sr.req).toFixed(1)}" r="3.6" fill="${x.color}" stroke="#12070b" stroke-width="1"/>`:''}</g>`).join('');
  const reqLabel=dir==='entering'?`Limit ${sr.req.toFixed(2)} %`:`Target ${sr.req.toFixed(2)} % (95%)`;
  const limitLine=`<line x1="${L}" x2="${W-Rm}" y1="${Y(sr.req).toFixed(1)}" y2="${Y(sr.req).toFixed(1)}" stroke="#45d69b" stroke-width="1.3" stroke-dasharray="6 4"/><text class="lim" x="${W-Rm-2}" y="${(Y(sr.req)-4).toFixed(1)}" text-anchor="end">${reqLabel}</text>`;
  const legend=shown.map(x=>`<span class="eca-legend-item" data-sys="${esc(x.key)}" role="button" tabindex="0" title="Tap to show only the ${esc(x.label)} trend — tap again to show all"><i style="background:${x.color}"></i>${x.label}${x.res.planning!==null?` — ${fmtH(x.res.planning)}`:''}</span>`).join('');
  const over=shown.filter(x=>x.res.planning===null||x.res.planning>XMAX).map(x=>x.label);
  return `<div class="eca-chart">
    <h4>Sulphur at engine inlet vs time <small>(0–40 h)</small></h4>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sulphur at engine inlet versus time from switch-over, 0 to 40 hours">
      ${grid}<line class="axis" x1="${L}" x2="${L}" y1="${Tm}" y2="${Tm+ph}"/><line class="axis" x1="${L}" x2="${W-Rm}" y1="${Tm+ph}" y2="${Tm+ph}"/>
      ${limitLine}${lines}
      <text x="${(L+pw/2).toFixed(0)}" y="${H-18}" text-anchor="middle">Time from switch-over (h)</text>
      <text transform="translate(11 ${(Tm+ph/2).toFixed(0)}) rotate(-90)" text-anchor="middle">S % m/m</text>
    </svg>
    <div class="eca-legend">${legend}</div>
    <div class="eca-key"><span><b class="solid"></b>Step method (FOBAS)</span><span><b class="dash"></b>Exact continuous mixing</span><span><b class="dot"></b>Limit reached</span></div>
    ${over.length?`<p class="help" style="display:block">${esc(over.join(', '))}: limit not reached within the 40 h shown — see the times above.</p>`:''}
  </div>`;
}
function ecaSystemCard(dir,x,startMs,finishMs,utcOffset){
  const head=`<div class="eca-sys-head"><i style="background:${x.color}"></i><strong>${x.label}</strong></div>`;
  if(x.skipped)return `<div class="eca-sys skipped">${head}<small>Not included</small></div>`;
  const r=x.res;
  if(!r.valid)return `<div class="eca-sys">${head}<div class="alert warning" style="margin:6px 0 0">${esc(r.reason)}</div></div>`;
  const stepTxt=r.alreadyOk?'0.0 h':r.unstable?'unstable':r.stepExceeds?'> 200 h':fmtH(r.stepTime);
  const exactTxt=r.alreadyOk?'0.0 h':r.exactRounded===null?'n/a':`${fmtH(r.exactRounded)} <small>(${r.exactTime.toFixed(2)})</small>`;
  const when=startMs!==null?`<div><span>Start</span><strong>${fmtDate(iso(startMs),utcOffset)}</strong></div><div><span>Finish</span><strong>${fmtDate(iso(finishMs),utcOffset)}</strong></div>`:'';
  return `<div class="eca-sys">${head}<div class="eca-sys-grid">
      <div><span>Rate · Quantity</span><strong>${n(x.c.rate)} t/hr · ${n(x.c.qty)} t</strong></div>
      <div><span>Step method</span><strong>${stepTxt}</strong></div>
      <div><span>Exact, rounded up</span><strong>${exactTxt}</strong></div>
      <div><span>Planning time</span><strong class="eca-plan">${fmtH(r.planning)}</strong></div>${when}</div>
      ${r.unstable?`<small class="eca-warn">Step unstable (r·dt/Q &gt; 1) — the exact time is used.</small>`:''}${r.stepExceeds&&!r.unstable&&!r.alreadyOk?`<small class="eca-warn">Limit not reached within 200 h by the step method.</small>`:''}</div>`;
}
const ECA_FUEL_OPTIONS=[{value:'hfo',label:'HFO'},{value:'vlsfo',label:'VLSFO'},{value:'lsmgo',label:'LSMGO'},{value:'mgo',label:'MGO / DO'},{value:'biodiesel',label:'Biodiesel'}];
function ecaFuelLabel(v){const h=ECA_FUEL_OPTIONS.find(o=>o.value===v);return h?h.label:((!v||v==='other')?'Other':String(v));}
/* Fuel being changed from / to. Entering an ECA: current FO grade -> compliant fuel. Leaving: compliant fuel -> FO grade to resume. */
function ecaFuels(cfg,dir,i){
  let active='vlsfo';try{active=resolveFoActiveFuel(getProfile('fo'),state.route[i])||'vlsfo';}catch{}
  return dir==='entering'?{from:cfg.fromFuel||active,to:cfg.toFuel||'lsmgo'}:{from:cfg.fromFuel||'lsmgo',to:cfg.toFuel||active};
}
function ecaSummaryText(r,i){
  const parts=[];
  ['entering','leaving'].forEach(dir=>{const c=r.eca?.[dir];if(!c?.enabled)return;const tag=dir==='entering'?'In':'Out';
    const f=ecaFuels(c,dir,i),sr=ecaSystemResults(dir,c,i);
    parts.push(`${tag}: ${(c.method||'fuel')==='scrubber'?'Scrubber · ':''}${ecaFuelLabel(f.from)} → ${ecaFuelLabel(f.to)}${sr.planning!==null?` (${fmtH(sr.planning)})`:''}`);});
  return parts.length?parts.join(' · '):'Not configured';
}
function ecaMethodHtml(dir,i,cfg){
  const method=cfg.method||'fuel',enter=dir==='entering',f=ecaFuels(cfg,dir,i),at=`data-eca="${i}" data-eca-dir="${dir}"`;
  const picker=(field,label,val,tip)=>`<div class="field rg-half"><label>${label}${manualPickHtml(ECA_FUEL_OPTIONS,val,`data-mp="eca" ${at} data-eca-field="${field}"`,'Type fuel type')}</label>${explain(label,tip)}</div>`;
  return `<div class="field rg-full"><label>${enter?'How will the vessel comply inside the ECA/SECA?':'After leaving the ECA/SECA'}<select ${at} data-eca-field="method"><option value="fuel" ${method==='fuel'?'selected':''}>Fuel changeover</option><option value="scrubber" ${method==='scrubber'?'selected':''}>Scrubber (EGCS) — same changeover procedure</option></select></label>${explain('Compliance method','Choose Fuel changeover to plan the switch to a compliant fuel, or Scrubber (EGCS) if the vessel complies with an approved exhaust gas cleaning system. Both use the same FOBAS mixing calculation, inputs and results.')}</div>`
    +(true?picker('fromFuel',enter?'Change over from':'Fuel in use in the ECA/SECA',f.from,enter?'Fuel currently in the service system, e.g. HFO or VLSFO. Pick from the list or type your own.':'The compliant fuel being used inside the area.')
      +picker('toFuel',enter?'Change over to':'Fuel to resume',f.to,enter?'Compliant fuel to be used inside the ECA/SECA (0.10% S limit), e.g. 0.10% VLSFO/ULSFO, LSMGO, MGO/DO or compliant biodiesel. Pick from the list or type your own.':'Fuel to switch back to after leaving the area.'):'');
}
/* Suggested starting values when a direction is first enabled for a port. */
/* v1.51 — "vessel leaves an ECA" starts from the "vessel enters an ECA" data. Fuel and sulphur are mirrored
   (compliant fuel -> fuel to resume); the ME / AE / Boiler system rates and quantities are copied as entered.
   A leaving changeover stays "auto" (follows the entering data) until the user edits one of its own fields. */
function ecaLeavingFromEntering(en){
  const o={};
  if(en.method)o.method=en.method;
  if(en.toFuel)o.fromFuel=en.toFuel;
  if(en.fromFuel)o.toFuel=en.fromFuel;
  if(en.toSulphurPct!==undefined)o.fromSulphurPct=n(en.toSulphurPct);
  if(en.fromSulphurPct!==undefined)o.toSulphurPct=n(en.fromSulphurPct);
  ['me','ae','boiler'].forEach(k=>{if(en[k])o[k]={...en[k]};});
  return o;
}
function ecaEnteringSource(){for(const r of state.route){const e=r&&r.eca&&r.eca.entering;if(e&&e.enabled)return e;}return null;}
function ecaPropagateDefaults(){
  const src=ecaEnteringSource();if(!src)return false;
  const copy=ecaLeavingFromEntering(src);let changed=false;
  state.route.forEach(r=>{const l=r&&r.eca&&r.eca.leaving;if(l&&l.enabled&&l.autoCopied===true){const next={...l,...copy};if(JSON.stringify(next)!==JSON.stringify(l)){r.eca.leaving=next;changed=true;}}});
  return changed;
}
/* v1.55: after the leaving changeover is re-copied from the entering one, update its visible numeric inputs in place
   (a full re-render here would steal focus from the field the user is moving to). */
function ecaRefreshLeavingInputs(){
  document.querySelectorAll('input[data-eca][data-eca-dir="leaving"]').forEach(el=>{
    if(el===document.activeElement||el.type==='checkbox'||el.dataset.mpText!==undefined)return;
    const r=state.route[Number(el.dataset.eca)],cfg=r&&r.eca&&r.eca.leaving;if(!cfg)return;
    const f=el.dataset.ecaField,sys=el.dataset.ecaSys,v=sys?(cfg[sys]||{})[f]:cfg[f];
    if(v===undefined||f==='limitPct')return;
    el.value=n(v);
  });
}
function ecaMarkLeavingEdited(i){const r=state.route[i];if(r){r.eca ||= {entering:{},leaving:{}};(r.eca.leaving ||= {}).autoCopied=false;}}
function ecaDefaultCfg(dir,i){
  const fo=getProfile('fo'),route=state.route[i],active=resolveFoActiveFuel(fo,route);
  const fallbackMeRate=Number((Math.max(0,n(effectiveFuelRates(fo,active)?.seaRate))/24).toFixed(3));
  const hs=active==='hfo'?3.5:0.5;
  const saved=state.meta.ecaSystemDefaults||{};
  const seed=(key,fallbackRate)=>({on:true,rate:n(saved[key]?.rate)||fallbackRate,qty:n(saved[key]?.qty)||0,qtyUnit:saved[key]?.qtyUnit==='L'?'L':'t',qtyL:n(saved[key]?.qtyL)||0});
  const sys={me:seed('me',fallbackMeRate),ae:seed('ae',0),boiler:seed('boiler',0)};
  const ff=ecaFuels({},dir,i),fuels={method:'fuel',fromFuel:ff.from,toFuel:ff.to};
  if(dir==='entering')return {...fuels,limitPct:0.10,fromSulphurPct:hs,toSulphurPct:0.10,marginHours:1,...sys};
  const base={...fuels,fromSulphurPct:0.10,toSulphurPct:hs,...sys},src=ecaEnteringSource();
  return src?{...base,...ecaLeavingFromEntering(src)}:base;
}
function ecaFieldsHtml(dir,i,cfg){
  const head=ecaMethodHtml(dir,i,cfg);
  const fld=(label,field,step,help,sys)=>{const v=sys?n(cfg[sys]?.[field]):n(cfg[field]);return `<div class="field rg-half"><label>${label}<input type="number" inputmode="decimal" step="${step}" min="0" data-eca="${i}" data-eca-dir="${dir}"${sys?` data-eca-sys="${sys}"`:''} data-eca-field="${field}" value="${v}"></label>${explain(label.replace(/ \(.*\)/,''),help)}</div>`;};
  const shared=dir==='entering'
    ?`<div class="field rg-full"><span class="help" style="display:block">Distances to the ECA/SECA line and the <b>required sulphur at engine inlet (%)</b> are entered at the top of this card.</span></div>`
      +fld('Current fuel sulphur in system (%)','fromSulphurPct','0.01','Sulphur content of the fuel now in the service system (starting value), from its BDN.')
      +fld('New (compliant) fuel sulphur (%)','toSulphurPct','0.01','Sulphur content of the compliant fuel being introduced, from its BDN. Must not exceed the current sulphur or the required sulphur at engine inlet. A value equal to the limit (0.10 or 0.50) is treated as 0.099 / 0.499, as in the FOBAS workbook.')
      +fld('Safety margin (hours)','marginHours','0.1','Extra buffer so all systems finish this long before the vessel crosses the ECA/SECA line. Set per your vessel\'s approved changeover procedure/SMS.')
    :`<div class="field rg-full"><span class="help" style="display:block">The <b>required sulphur at engine inlet (%)</b> after leaving is entered at the top of this card; the FOBAS time to reach it starts when the vessel clears the ECA/SECA line.</span></div>`
      +fld('Current (compliant) sulphur (%)','fromSulphurPct','0.01','Sulphur content of the compliant fuel now in the service system, from its BDN.')
      +fld('Sulphur of fuel to resume (%)','toSulphurPct','0.01','Sulphur content of the fuel you will switch back to once clear of the area, from its BDN.');
  const qtyHelp='Fuel in this system’s service/mixing volume including the mixing column and pipework (Q). Values below 0.1 t are treated as 0.1 t, as in the FOBAS workbook. Once entered here, it is suggested automatically for the next changeover on another port — change it any time.';
  const qtyBlock=(sys,c)=>{
    const unit=c.qtyUnit==='L'?'L':'t',at=`data-eca="${i}" data-eca-dir="${dir}" data-eca-sys="${sys}"`;
    const sel=`<div class="field rg-half"><label>Enter service system quantity in<select ${at} data-eca-field="qtyUnit"><option value="t" ${unit==='t'?'selected':''}>Weight (t)</option><option value="L" ${unit==='L'?'selected':''}>Volume (L) — auto-converted to t</option></select></label></div>`;
    if(unit!=='L')return sel+fld('Service system quantity (t)','qty','0.01',qtyHelp,sys);
    const info=ecaQtyInfo(dir,cfg,i,sys);
    return sel
      +`<div class="field rg-half"><label>Service system quantity (L)<input type="number" inputmode="decimal" step="1" min="0" ${at} data-eca-field="qtyL" value="${n(c.qtyL)}"></label>${explain('Service system quantity','Enter the service/mixing volume in litres. The app converts it to tonnes with the fuel density entered on the Tanks tab (t = L × density ÷ 1000).')}</div>`
      +`<div class="field rg-half"><label>Service system quantity (t)<output class="rob-computed-val" data-eca-qty-out="${i}:${dir}:${sys}">${info.qty.toFixed(3)} t</output></label><span class="help" style="display:block" data-eca-dens-note="${i}:${dir}:${sys}">${esc(ecaDensityNote(info))}</span></div>`;
  };
  const sysBlocks=ECA_SYSTEMS.map(s=>{const c=cfg[s.key]||{};return `<div class="eca-sys-input">
      <label class="check"><input type="checkbox" data-eca="${i}" data-eca-dir="${dir}" data-eca-sys="${s.key}" data-eca-field="on" ${c.on!==false?'checked':''}><i class="eca-dot" style="background:${s.color}"></i> ${s.label}</label>
      ${c.on!==false?`<div class="route-grid">${fld('Consumption rate (t/hr)','rate','0.001','Fuel consumption rate of this system during the changeover (r). Once entered here, it is suggested automatically for the next changeover on another port — change it any time.',s.key)}${qtyBlock(s.key,c)}</div>`:''}
    </div>`;}).join('');
  return `<div class="route-grid" style="margin-top:6px">${head}${shared}</div>${sysBlocks}`;
}
function ecaDirectionResult(dir,i){
  const r=state.route[i];if(!r)return'';
  const cfg=dir==='entering'?(r.eca?.entering||{}):(r.eca?.leaving||{});
  if(!cfg.enabled)return'';
  const f=ecaFuels(cfg,dir,i),scrub=(cfg.method||'fuel')==='scrubber';
  return (scrub?`<div class="eca-fuelline">Scrubber (EGCS) selected — same FOBAS mixing procedure as the fuel changeover</div>`:'')+`<div class="eca-fuelline">${dir==='entering'?'Change over':'Resume'}: <strong>${esc(ecaFuelLabel(f.from))} → ${esc(ecaFuelLabel(f.to))}</strong></div>`+ecaDirectionResultCore(dir,i);
}
/* ---- v1.55: ECA/SECA is asked per port (moved from the Ports tab to the ECA/SECA tab in v1.61); distances to the ECA line drive the changeover timing ---- */
function ecaPortEnsure(r){r.eca ||= {entering:{},leaving:{}};r.eca.entering ||= {};r.eca.leaving ||= {};r.eca.port ||= {enabled:false,prevToLineNm:'',lineToPortNm:0,exitNm:''};return r.eca.port;}
function ecaPortOn(r){return !!(r&&r.eca&&r.eca.port&&r.eca.port.enabled);}
function ecaSetDir(r,dir,want,i){
  const ex=r.eca[dir]||{};if(!!ex.enabled===want)return;
  if(want){const fresh=!Object.keys(ex).some(k=>k!=='enabled'&&k!=='autoCopied');r.eca[dir]={...ecaDefaultCfg(dir,i),...ex,enabled:true,...(dir==='leaving'&&fresh?{autoCopied:true}:{})};}
  else r.eca[dir]={...ex,enabled:false};
}
/* Entering changeover: a port inside an ECA/SECA whose previous port is outside it (the first port is assumed already inside).
   Leaving changeover: a port inside an ECA/SECA whose next port is outside it (or the last port). */
function ecaSyncFromPorts(){
  const last=state.route.length-1;
  state.route.forEach((r,i)=>{
    ecaPortEnsure(r);
    const on=ecaPortOn(r),prev=i>0&&ecaPortOn(state.route[i-1]),next=i<last&&ecaPortOn(state.route[i+1]);
    ecaSetDir(r,'entering',on&&i>0&&!prev,i);
    ecaSetDir(r,'leaving',on&&!next,i);
  });
}
function ecaRequiredS(dir,cfg){
  const lim=n(cfg.limitPct);if(dir==='entering')return lim;
  if(lim>0)return lim;
  const to=n(cfg.toSulphurPct),from=n(cfg.fromSulphurPct);return to-0.05*(to-from);
}
/* Timing of the ECA line crossing for one direction of one port.
   entering: the line is lineToPortNm before the port (ETA - distance/speed).
   leaving:  the line is exitNm after the port (ETD + distance/next-leg speed). */
function ecaLegInfo(dir,i){
  const r=state.route[i],c=calc.results[i];if(!r||!c)return null;
  const p=r.eca?.port||{};
  if(dir==='entering'){
    const speed=n(c.speedKn),dist=n(c.distanceNm),inNm=Math.min(Math.max(0,n(p.lineToPortNm)),dist);
    const outNm=(p.prevToLineNm===''||p.prevToLineNm==null)?Math.max(0,dist-inNm):Math.max(0,n(p.prevToLineNm));
    const legEndMs=new Date(c.arrivalUtc).getTime(),legStartMs=legEndMs-c.seaDays*86400000;
    const lineMs=legEndMs-(speed>0?inNm/speed:0)*3600000;
    return{dist,inNm,outNm,speed,legStartMs,legEndMs,lineMs};
  }
  const next=calc.results[i+1],speed=n(next?next.speedKn:c.speedKn),want=ecaExitNm(p),exitNm=next?Math.min(want,n(next.distanceNm)):want;
  const depMs=new Date(c.departureUtc).getTime(),lineMs=depMs+(speed>0?exitNm/speed:0)*3600000;
  return{next,speed,exitNm,depMs,lineMs};
}
function ecaDirectionResultCore(dir,i){
  const r=state.route[i],c=calc.results[i];if(!c)return'';
  const cfg=r.eca?.[dir]||{};
  if(!cfg.enabled)return'';
  const sr=ecaSystemResults(dir,cfg,i),T=sr.planning,li=ecaLegInfo(dir,i);
  const port=r.port||`Port ${i+1}`;
  const note=`<p class="muted" style="font-size:.7rem;margin:8px 0 0">Planning time = the longer of the FOBAS step-method time and the exact time rounded up to 0.1 h; the vessel is ready when its slowest system (${T===null?'':fmtH(T)}) has finished.</p>`;
  if(dir==='entering'){
    const margin=Math.max(0,n(cfg.marginHours));
    const targetMs=li.lineMs-margin*3600000;
    const cards=sr.list.map(x=>{const ok=!x.skipped&&x.res.valid&&x.res.planning!==null;return ecaSystemCard(dir,x,ok?targetMs-x.res.planning*3600000:null,ok?targetMs:null,c.utcOffset);}).join('');
    if(T===null)return `<div class="eca-systems">${cards}</div><div class="alert warning">Complete the inputs above (rates, quantities, and a new-fuel sulphur at or below the required sulphur) to calculate the changeover.</div>${ecaChartHtml(dir,sr)}`;
    const startMs=targetMs-T*3600000,lead=T+margin,availHrs=(li.lineMs-li.legStartMs)/3600000,insufficient=lead>availHrs+0.001;
    const prevPort=i>0?(state.route[i-1]?.port||`Port ${i}`):'the voyage start';
    const posS=positionAtTime(li.legStartMs,li.legEndMs,c.distanceNm,startMs),posF=positionAtTime(li.legStartMs,li.legEndMs,c.distanceNm,targetMs);
    const lineFromPrev=Math.max(0,n(c.distanceNm)-li.inNm);
    const toLineS=Math.max(0,lineFromPrev-posS.nmRun),toLineF=Math.max(0,lineFromPrev-posF.nmRun);
    return `<div class="eca-systems">${cards}</div>
      <div class="eca-result">
        <div><span>Changeover duration (slowest system)</span><strong>${fmtH(T)}</strong><small>to reach ${sr.req.toFixed(2)}% S at engine inlet</small></div>
        <div><span>Start changeover this long before the ECA line (+${margin} h margin)</span><strong>${fmtH(lead)}</strong></div>
        <div><span>Start changeover (latest)</span><strong>${fmtDate(iso(startMs),c.utcOffset)} local</strong><small>${fmtUTC(iso(startMs))}</small></div>
        <div><span>Low-sulphur fuel fully in use by</span><strong>${fmtDate(iso(targetMs),c.utcOffset)} local</strong><small>${fmtUTC(iso(targetMs))}  before the ECA line</small></div>
        <div><span>Vessel crosses the ECA/SECA line</span><strong>${fmtDate(iso(li.lineMs),c.utcOffset)} local</strong><small>${li.inNm.toFixed(0)} NM before ${esc(port)}  ${fmtUTC(iso(li.lineMs))}</small></div>
        <div><span>Vessel position at start</span><strong>${posS.nmRun.toFixed(0)} NM out from ${esc(prevPort)}</strong><small>${toLineS.toFixed(0)} NM to the ECA line  ${posS.nmLeft.toFixed(0)} NM to ${esc(port)}</small></div>
        <div><span>Vessel position at finish</span><strong>${posF.nmRun.toFixed(0)} NM out from ${esc(prevPort)}</strong><small>${toLineF.toFixed(0)} NM to the ECA line  ${posF.nmLeft.toFixed(0)} NM to ${esc(port)}</small></div>
      </div>${insufficient?`<div class="alert warning">Only ${Math.max(0,availHrs).toFixed(1)} h of sailing before the ECA line  not enough time to complete the changeover (${fmtH(lead)}) before the vessel crosses it. Start earlier (on a previous leg) or review the plan.</div>`:''}
      ${sr.anyProblem?`<div class="alert warning">One or more systems could not be calculated  see their cards above. The duration shown covers only the valid systems.</div>`:''}${ecaChartHtml(dir,sr)}${note}`;
  }
  const next=li.next,legStartMs=li.lineMs;
  const cards=sr.list.map(x=>{const ok=!x.skipped&&x.res.valid&&x.res.planning!==null;return ecaSystemCard(dir,x,ok?legStartMs:null,ok?legStartMs+x.res.planning*3600000:null,c.utcOffset);}).join('');
  if(T===null)return `<div class="eca-systems">${cards}</div><div class="alert warning">Enter the required sulphur at engine inlet (above the compliant sulphur and below the resume fuel sulphur) at the top of this port's card, and each system's rate and quantity, to calculate the leaving changeover.</div>${ecaChartHtml(dir,sr)}`;
  const finishMs=legStartMs+T*3600000;
  let pos;
  if(next){const legEndMs=new Date(next.arrivalUtc).getTime(),p=positionAtTime(li.depMs,legEndMs,next.distanceNm,finishMs),nextPort=next.port||`Port ${i+2}`;pos=`<strong>${p.nmRun.toFixed(0)} NM out from ${esc(port)}</strong><small>${p.nmLeft.toFixed(0)} NM (${(p.frac*100).toFixed(0)}%) to ${esc(nextPort)}</small>`;}
  else pos=`<strong>Beyond the last port in the plan</strong><small>add a next port to estimate the position</small>`;
  return `<div class="eca-systems">${cards}</div>
    <div class="eca-result">
      <div><span>Changeover duration (slowest system)</span><strong>${fmtH(T)}</strong><small>to reach ${sr.req.toFixed(2)}% S at engine inlet (FOBAS)</small></div>
      <div><span>Vessel clears the ECA/SECA line</span><strong>${fmtDate(iso(legStartMs),c.utcOffset)} local</strong><small>${li.exitNm.toFixed(0)} NM after ${esc(port)}  ${fmtUTC(iso(legStartMs))}</small></div>
      <div><span>Start changeover (right after the line)</span><strong>${fmtDate(iso(legStartMs),c.utcOffset)} local</strong><small>${fmtUTC(iso(legStartMs))}</small></div>
      <div><span>Estimated finish</span><strong>${fmtDate(iso(finishMs),c.utcOffset)} local</strong><small>${fmtUTC(iso(finishMs))}</small></div>
      <div><span>Vessel position at start</span><strong>${li.exitNm.toFixed(0)} NM out from ${esc(port)}</strong><small>at the ECA/SECA line${next?`  on the leg to ${esc(next.port||`Port ${i+2}`)}`:''}</small></div>
      <div><span>Vessel position at finish</span>${pos}</div>
    </div>${sr.anyProblem?`<div class="alert warning">One or more systems could not be calculated  see their cards above.</div>`:''}${ecaChartHtml(dir,sr)}
    <div class="help" style="display:block;margin-top:8px">Do not resume higher-sulphur fuel until the vessel is fully clear of the ECA/SECA line. Record date, time, position and tank quantities at both changeovers in the Oil Record Book / changeover log.</div>${note}`;
}
/* ECA/SECA tab (top of each port card): "Is this port in an ECA/SECA?" + distances to the ECA line + required sulphur at engine inlet. */
function ecaPortFieldsHtml(r,i){
  const p=r.eca?.port||{},on=!!p.enabled,en=r.eca?.entering||{},lv=r.eca?.leaving||{},c=calc.results[i];
  const prevOn=i>0&&ecaPortOn(state.route[i-1]),at=`data-eca-port="${i}"`;
  const dist=c?n(c.distanceNm):n(r.distanceNm);
  const dfield=(label,field,val,ph,help)=>`<div class="field rg-half"><label>${label}<input type="number" inputmode="decimal" step="0.1" min="0" ${at} data-eca-pfield="${field}" value="${val}" placeholder="${ph}"></label>${explain(label.replace(/ \(.*\)/,''),help)}</div>`;
  const sfield=(dir,cfg,ph,help)=>{const lbl=dir==='entering'?'Required sulphur at engine inlet inside the ECA (%)':'Required sulphur at engine inlet after leaving the ECA (%)';return `<div class="field rg-half"><label>${lbl}<input type="number" inputmode="decimal" step="0.01" min="0" data-eca="${i}" data-eca-dir="${dir}" data-eca-field="limitPct" value="${n(cfg.limitPct)>0?n(cfg.limitPct):''}" placeholder="${ph}"></label>${explain('Required sulphur at engine inlet',help)}</div>`;};
  let body='';
  if(on){
    if(en.enabled){
      const auto=Math.max(0,dist-Math.max(0,n(p.lineToPortNm)));
      body+=dfield('Distance from previous port to ECA line (NM)','prevToLineNm',(p.prevToLineNm===''||p.prevToLineNm==null)?'':n(p.prevToLineNm),auto.toFixed(1),'Nautical miles sailed outside the ECA/SECA, from the previous port to the ECA/SECA boundary on the way to this port. Leave blank to use the leg distance minus the distance inside the area.')
        +dfield('Distance from ECA line to this port (NM)','lineToPortNm',n(p.lineToPortNm),'0','Nautical miles from the ECA/SECA boundary to this port. The vessel must be fully changed over to the compliant fuel before crossing the boundary; the hours before the line are calculated from this distance and the leg speed.')
        +sfield('entering',en,'0.10','Maximum sulphur allowed at the engine inlet inside the ECA/SECA (0.10% m/m for the IMO-designated ECAs in force). The FOBAS changeover must bring the engine inlet down to this value before the ECA line.');
    }else{
      body+=`<div class="field rg-full"><small class="muted">${i===0?'First port: the vessel is assumed to be inside the ECA/SECA already when the plan starts, so no entry changeover is calculated here.':'The previous port is also in an ECA/SECA, so the vessel stays inside the area on this leg and no entry changeover is calculated.'}</small></div>`;
    }
    if(lv.enabled){
      const to=n(lv.toSulphurPct),from=n(lv.fromSulphurPct),ph=(to>from?(to-0.05*(to-from)):0).toFixed(2);
      body+=dfield('Distance from this port to ECA line when leaving (NM)','exitNm',(p.exitNm===''||p.exitNm==null)?'':n(p.exitNm),String(n(p.lineToPortNm)),'Nautical miles from this port to the ECA/SECA boundary on departure. Blank = same as the distance from the ECA line to this port. The change-over back to the higher-sulphur fuel starts right after the vessel clears this line.')
        +sfield('leaving',lv,ph,'Sulphur content wanted at the engine inlet before the higher-sulphur fuel is considered fully in use again. The FOBAS calculation gives the changeover time needed to reach it once the vessel is outside the ECA/SECA line. Blank = 95% of the way to the resume fuel sulphur.');
    }else if(on&&!lv.enabled){
      body+=`<div class="field rg-full"><small class="muted">The next port is also in an ECA/SECA, so the vessel stays inside the area after leaving this port and no leaving changeover is calculated here.</small></div>`;
    }
  }
  return `<div class="field rg-full eca-port-q"><label class="check"><input type="checkbox" ${at} data-eca-pfield="enabled" ${on?'checked':''}> This port is in an ECA/SECA</label>${explain('ECA/SECA port','Tick if this port is inside an Emission Control Area / Sulphur ECA. You will be asked for the distances between the ECA/SECA line and the port. The vessel changes over to low-sulphur fuel before crossing the line and back to higher-sulphur fuel after clearing it. Fuel types, system rates and quantities are set below, on this tab.')}</div>${body}`;
}
function ecaCard(r,i){
  const en=r.eca?.entering||{},lv=r.eca?.leaving||{},k='ecacard:'+i;
  const ecaChips=ecaDirsAt(r).map(d=>`<span class="pflag pf-chip-eca" title="${d==='entering'?'Entering':'Leaving'} an ECA/SECA  fuel changeover at this port">ECA ${d==='entering'?'in':'out'}</span>`).join('');
  const portBlock=`<div class="route-grid eca-port-block">${ecaPortFieldsHtml(r,i)}</div>`;
  let body;
  if(!ecaPortOn(r))body=`<p class="muted" style="font-size:.78rem;margin:0">Tick <b>This port is in an ECA/SECA</b> above (and enter the distances to the ECA line) to plan the changeovers here.</p>`;
  else if(!en.enabled&&!lv.enabled)body=`<p class="muted" style="font-size:.78rem;margin:0">This port is inside an ECA/SECA together with its neighbouring ports, so the vessel does not cross the ECA/SECA line here and no changeover is needed.</p>`;
  else body=`${en.enabled?`<div class="eca-dir-title"><strong>Entering the ECA/SECA  changeover to low-sulphur fuel before the ECA line</strong></div>${ecaFieldsHtml('entering',i,en)}<div class="eca-result-slot" data-eca-slot="${i}:entering">${ecaDirectionResult('entering',i)}</div>`:''}
      ${lv.enabled?`<div class="eca-dir-title" style="margin-top:16px"><strong>Leaving the ECA/SECA  changeover back to higher-sulphur fuel after the ECA line</strong></div>${ecaFieldsHtml('leaving',i,lv)}<div class="eca-result-slot" data-eca-slot="${i}:leaving">${ecaDirectionResult('leaving',i)}</div>`:''}`;
  return `<details class="item-card route-card${ecaChips?' pf-eca':''}" data-eca-card="${i}" data-open-key="${k}" ${uiOpen.has(k)?'open':''}>
    <summary class="route-sum"><span class="step">${i+1}</span><span class="rs-main"><strong class="rs-port">${esc(r.port||`Port ${i+1}`)}</strong><small class="rs-meta">${esc(ecaSummaryText(r,i))}</small>${ecaChips?`<span class="pflags">${ecaChips}</span>`:''}</span>${ICON.chev}</summary>
    <div class="route-body">
      ${portBlock}
      ${body}
      <p class="muted" style="font-size:.7rem;margin-top:10px">Planning estimate using the FOBAS-style well-mixed service-system model, calculated per system (Main Engine, Aux. Engine, Boiler). The ECA/SECA port question, line distances and the required sulphur at engine inlet are entered at the top of each port's card. Vessel position is estimated by time fraction along the leg (no port coordinates are stored). Always follow the vessel's approved changeover procedure/SMS and verify current ECA boundaries and sulphur limits (MARPOL Annex VI Reg. 14) before use  re-check every port, as designated areas and limits can change.</p>
    </div>
  </details>`;
}
function renderEca(){
  $('#ecaList').innerHTML=state.route.length?state.route.map((r,i)=>ecaCard(r,i)).join(''):'<div class="empty">Add ports in the Voyage tab first, then plan any ECA/SECA changeovers here.</div>';
}
function syncEcaResult(i){
  const enSlot=document.querySelector(`[data-eca-slot="${i}:entering"]`);if(enSlot)enSlot.innerHTML=ecaDirectionResult('entering',i);
  const lvSlot=document.querySelector(`[data-eca-slot="${i}:leaving"]`);if(lvSlot)lvSlot.innerHTML=ecaDirectionResult('leaving',i);
}
/* v1.42: a port has bunkering planned when any product has a received quantity (typed, drum receipt, or the sum of per-tank figures) or a pump-over from drums. */
function evQty(b){return b&&b.mode==='drums'?n(b.quantity):bunkerEventQuantity(b);}
function hasBunkerAt(r){return [...state.fuels,...state.lubes].some(f=>{const b=r.bunkers?.[f.id];return evQty(b)>0||sumAllocations(b&&b.transfer&&b.transfer.allocations)>0;});}
function routeCard(r,i){
  const c=calc.results[i],k='route:'+i,last=state.route.length-1;
  const hasBunker=hasBunkerAt(r);
  const hasEca=!!(r.eca?.entering?.enabled||r.eca?.leaving?.enabled);
  const eta=c?fmtDate(c.arrivalUtc,c.utcOffset):'—',etd=c?fmtDate(c.departureUtc,c.utcOffset):'—';
  const move=`<div class="sequence-actions"><button type="button" class="icon-btn" data-move-route="${i}" data-direction="up" aria-label="Move port earlier" title="Move earlier" ${i===0?'disabled':''}>${ICON.up}</button><button type="button" class="icon-btn" data-move-route="${i}" data-direction="down" aria-label="Move port later" title="Move later" ${i===last?'disabled':''}>${ICON.down}</button></div>`;
  return `<details class="item-card route-card" data-route-card="${i}" data-open-key="${k}" ${uiOpen.has(k)?'open':''}>
    <summary class="route-sum"><span class="step">${i+1}</span><span class="rs-main"><strong class="rs-port">${esc(r.port||`Port ${i+1}`)}</strong><small class="rs-meta">${routeMeta(r)}</small></span><span class="tk-side"><span class="rs-eta">ETA ${eta==='—'?eta:eta.slice(5)}</span>${ICON.chev}</span></summary>
    <div class="route-body">
      <div class="route-grid">
        <div class="field rg-full"><label>Port name<input class="big-input" data-route-index="${i}" data-field="port" value="${esc(r.port)}" placeholder="Port name" autocomplete="off" list="defaultPorts"></label></div>
        ${i===0?`<div class="field rg-full"><label>ETA (first port)<input type="datetime-local" data-route-index="${i}" data-field="eta" value="${esc(r.eta||'')}"></label>${explain('First port ETA','Optional. If set, this exact arrival time is used for the first port instead of the voyage start time. Leave blank to use voyage start UTC as the arrival.')}</div>`:''}
        <div class="field rg-half"><label>Distance from previous (NM)<input type="number" inputmode="decimal" step="0.1" min="0" data-route-index="${i}" data-field="distanceNm" value="${n(r.distanceNm)}"></label>${explain('Distance','Nautical miles from the previous route point to this port. The first port normally uses 0 NM.')}</div>
        <div class="field rg-half"><label>Speed (kn)<input type="number" inputmode="decimal" step="0.1" min="0" data-route-index="${i}" data-field="speedKn" value="${n(r.speedKn)}"></label>${explain('Speed','Planning speed in knots used to calculate sailing time: distance ÷ speed ÷ 24.')}</div>
        <div class="field rg-half"><label>At anchor / drift (days)<input type="number" inputmode="numeric" step="1" min="0" data-route-index="${i}" data-field="anchorStayDays" value="${Math.floor(n(r.anchorStayDays))}"></label></div>
        <div class="field rg-half"><label>At anchor / drift (hours)<input type="number" inputmode="numeric" step="1" min="0" max="23" data-route-index="${i}" data-field="anchorStayHours" value="${n(r.anchorStayHours)}"></label>${explain('At anchor / drift','Time spent waiting at anchor or drifting off this port before going alongside/berthing — added to the ETA→ETD span and consumed at the "At anchor/drift/day" rate set in Setup (or its own override below).')}</div>
        <div class="field rg-half"><label>Port stay (days)<input type="number" inputmode="numeric" step="1" min="0" data-route-index="${i}" data-field="portStayDays" value="${Math.floor(n(r.portStayDays))}"></label></div>
        <div class="field rg-half"><label>Port stay (hours)<input type="number" inputmode="numeric" step="1" min="0" max="23" data-route-index="${i}" data-field="portStayHours" value="${n(r.portStayHours)}"></label>${explain('Port stay','Time spent alongside the berth. Enter whole days and additional hours. Total port-point time = anchor/drift stay + port stay.')}</div>
        <div class="field rg-full"><label>UTC offset<select data-route-index="${i}" data-field="utcOffset">${UTC_OFFSETS.map(o=>`<option value="${o}" ${Math.abs(n(r.utcOffset)-o)<0.01?'selected':''}>${utcOffsetLabel(o)}</option>`).join('')}</select></label>${explain('UTC offset','Local-port time offset from UTC. It changes displayed local ETA/ETD only.')}</div>
        ${getProfile('fo')?.foMode==='both'?`<div class="field rg-full"><label>Fuel oil in use for this leg<select data-route-index="${i}" data-field="foActiveFuel"><option value="vlsfo" ${r.foActiveFuel!=='hfo'?'selected':''}>VLSFO</option><option value="hfo" ${r.foActiveFuel==='hfo'?'selected':''}>HFO</option></select></label>${explain('Fuel oil in use','This vessel tracks VLSFO and HFO separately (set in Setup). Choose which one is actually being burned on this leg — it drives the sea/port/anchor consumption, the reserve/shortage check, and the no-mixing bunkering rule for VLSFO.')}</div>`:''}
      </div>
      <div class="stay-summary"><span>ETA <strong class="eta-val">${eta}</strong></span><span>ETD <strong class="etd-val">${etd}</strong></span></div>
      ${consOverrideHtml(r,i)}
      <div class="cross-tab-links">
        <span class="tag ${hasBunker?'':'dim'}" data-goto-tab="bunkering">${hasBunker?'Bunkering planned':'Bunkering & lube oil'} — see Bunkering tab</span>
        <span class="tag ${hasEca?'':'dim'}" data-goto-tab="eca">${hasEca?'ECA/SECA planned':'ECA/SECA changeover'} — see ECA/SECA tab</span>
      </div>
      <div class="route-foot">${move}<button type="button" class="danger ghost sm" data-remove-route="${i}">${ICON.trash}<span>Remove port</span></button></div>
    </div>
  </details>`;
}
function renderRoute(){
  $('#routeList').innerHTML=state.route.length?state.route.map((r,i)=>routeCard(r,i)).join(''):'<div class="empty">Add the first port. The route is calculated sequentially from the noon report date (local time) set on the Tanks tab.</div>';
  $('#routeList').insertAdjacentHTML('beforeend', `<div class="add-row"><button id="addRouteInline" class="primary">${ICON.plus}<span>Add port</span></button></div>`);
}
/* Per-port override of in-port / anchor-drift daily consumption, one row per fuel & lube. */
function consOverrideHtml(r,i){
  const profiles=[...state.fuels,...state.lubes],hasAnchor=Math.max(0,n(r.anchorStayDays))>0||Math.max(0,n(r.anchorStayHours))>0;
  const rows=profiles.map(p=>{
    const port=r.consOverride?.port?.[p.id],anchor=r.consOverride?.anchor?.[p.id];
    const field=(phase,val,rate)=>`<label>${phase==='port'?'In port':'Anchor/drift'} (${esc(p.unit)}/day)<input type="number" inputmode="decimal" step="0.01" min="0" placeholder="${rate.toFixed(2)}" data-route-index="${i}" data-cons-phase="${phase}" data-cons-id="${p.id}" value="${val===undefined||val===null||val===''?'':n(val)}"></label>`;
    return `<div class="cons-row ${hasAnchor?'':'no-anchor'}"><span class="cons-name">${esc(p.name)}</span>${field('port',port,ratesFor(p.id,i).port)}${hasAnchor?field('anchor',anchor,ratesFor(p.id,i).anchor):''}</div>`;
  }).join('');
  return `<details class="cons-override" data-open-key="cons:${i}" ${uiOpen.has('cons:'+i)?'open':''}><summary>Override in-port${hasAnchor?' / anchor-drift':''} consumption for this port${ICON.chev}</summary><div class="cons-grid">${rows}</div><span class="help" style="display:block;margin-top:6px">Leave blank to use the default rate from Setup. Placeholders show the rate that will be used.</span></details>`;
}
function syncRouteCard(i){
  const r=state.route[i],card=document.querySelector(`[data-route-card="${i}"]`);if(!r||!card)return;
  const c=calc.results[i],eta=c?fmtDate(c.arrivalUtc,c.utcOffset):'—',etd=c?fmtDate(c.departureUtc,c.utcOffset):'—',name=r.port||`Port ${i+1}`;
  card.querySelector('.rs-port').textContent=name;card.querySelector('.rs-meta').textContent=routeMeta(r);
  card.querySelector('.rs-eta').textContent=`ETA ${eta==='—'?eta:eta.slice(5)}`;
  card.querySelector('.eta-val').textContent=eta;card.querySelector('.etd-val').textContent=etd;
  const hasBunker=hasBunkerAt(r);
  const bunkTag=card.querySelector('[data-goto-tab="bunkering"]');
  if(bunkTag){bunkTag.textContent=`${hasBunker?'Bunkering planned':'Bunkering & lube oil'} — see Bunkering tab`;bunkTag.classList.toggle('dim',!hasBunker);}
  const consEl=card.querySelector('.cons-override');
  if(consEl&&!consEl.contains(document.activeElement))consEl.outerHTML=consOverrideHtml(r,i);
}
/* Which tanks a bunker of this fuel/type may be allocated into — mirrors the no-mixing rule in
   core.js: HFO may top up a tank that already has ROB, VLSFO needs an empty tank (unpumpable heel allowed). */
function bunkerFillFrac(){return maxFillFrac(state.meta);}
const maxFillPctText=()=>String(Math.round(bunkerFillFrac()*1000)/10);
function eligibleBunkerTanks(groupId,fuelType,tanksSnapshot){
  const pool=consumptionOrder((tanksSnapshot||state.tanks).filter(t=>t.group===groupId&&isConsumableTank(t)));
  if(!fuelType)return pool;
  const matched=pool.filter(t=>normFuelType(t.fuelType||defaultFuelType(t.group))===normFuelType(fuelType));
  return fuelTypeNoMixing(fuelType)?matched.filter(t=>n(t.rob)<=Math.max(0,n(t.unpumpable))+1e-9):matched;
}
/* Per-tank proposal at the port's arrival condition. Fuel: grade must match the tank; VLSFO needs an empty tank (only the unpumpable heel may remain;
   new VLSFO must not be mixed with old VLSFO ROB); HFO / diesel / biodiesel may top up a tank of the same type, up to 85%.
   Lube oil: replenish each tank up to full capacity. */
function bunkerTankProposals(groupId,fuelType,ri){
  const c=calc.results[ri],snapshot=(c&&c.tankAtArrival)||state.tanks,frac=bunkerFillFrac(groupId),noMix=fuelType?fuelTypeNoMixing(fuelType):false;
  return consumptionOrder(snapshot.filter(t=>t.group===groupId&&isConsumableTank(t))).map(t=>{
    const own=t.fuelType||defaultFuelType(t.group),cap=Math.max(0,n(t.capacity)),rob=Math.max(0,n(t.rob)),room=Math.max(0,cap*frac-rob),roomMax=room;
    let ok=true,reason='';
    if(fuelType&&normFuelType(own)!==normFuelType(fuelType)){ok=false;reason='different fuel type';}
    else if(noMix&&rob>Math.max(0,n(t.unpumpable))+1e-9){ok=false;reason='holds old '+fuelTypeLabel(groupId,fuelType)+' — cannot mix';}
    else if(room<=1e-9){ok=false;reason='already at '+maxFillPctText()+'% or more';}
    return{tank:t,type:own,rob,cap,room,ok,qty:ok?room:0,qtyMax:ok?roomMax:0,reason};
  });
}
function proposedBunkerQuantity(groupId,fuelType,ri){return bunkerTankProposals(groupId,fuelType,ri).reduce((s,p)=>s+p.qty,0);}
function proposedBunkerRange(groupId,fuelType,ri){const l=bunkerTankProposals(groupId,fuelType,ri);return{lo:l.reduce((s,p)=>s+p.qty,0),hi:l.reduce((s,p)=>s+p.qtyMax,0)};}
const fmtRange=(lo,hi,unit)=>Math.abs(hi-lo)<0.005?fmtN(lo,unit):`${fmtN(lo,unit)} – ${fmtN(hi,unit)}`;
/* v1.41: % of a tank's capacity by volume after this port's bunkering (ETD condition), shown under its bunker-quantity input
   (fuel and diesel only). Volume = ROB ÷ density, so the ratio equals ROB ÷ capacity in MT. */
function bunkerPctInfo(ri,fid,tankId){
  const c=calc.results[ri],t=((c&&c.tankAfter)||[]).find(x=>x.id===tankId);if(!t)return{html:'',cls:''};
  const cap=Math.max(0,n(t.capacity)),rob=Math.max(0,n(t.rob));if(!(cap>0))return{html:'',cls:''};
  const pct=rob/cap*100,den=n(t.density)>0?n(t.density):0,capVol=n(t.capacityM3)>0?n(t.capacityM3):(den?cap/den:0);
  const volTxt=den&&capVol?` <span class="ap-vol">(${fmtN(rob/den,'m³')} / ${fmtN(capVol,'m³')} m³)</span>`:'';
  const cls=rob>cap+1e-9?'over':(rob>cap*bunkerFillFrac(fid)+1e-9?'over85':'');
  return{html:`<b>${pct.toFixed(1)} %</b> ${den&&capVol?'by volume':'full'} after bunkering${volTxt}`,cls};
}
/* v1.43: no "how do you want to enter it" switch — the planner detects it. Typing in a tank's box = per-tank entry (the Bunker quantity box
   shows the computed total); typing in the Bunker quantity box = a total that the planner places. */
function bunkerQtyLabel(byTank){return byTank?'Bunker quantity — total of the tanks below':'Bunker quantity';}
function allocShow(a){return n(a)>0?a:'';}
function allocRoom(ri,f,tankId,props){
  const p=(props||bunkerTankProposals(f.id,f.id==='fo'||f.id==='do'?(state.route[ri]?.bunkers?.[f.id]?.fuelType||defaultFuelType(f.id)):null,ri)).find(x=>x.tank.id===tankId);
  return p&&p.ok?p.room:null;
}
function allocPlaceholder(ri,f,tankId,props){const r=allocRoom(ri,f,tankId,props);return r===null?'—':`max ${fmtN(r,f.unit)}`;}
function allocMaxText(ri,f,tankId,props){const r=allocRoom(ri,f,tankId,props);return r===null?'':`Company max fill ${maxFillPctText()}% — room for <b>${fmtN(r,f.unit)}</b> ${esc(f.unit)}`;}
function bunkerEditor(r,f,ri){
  const b=r.bunkers?.[f.id]||{quantity:0,autoAllocate:true,allocations:[]};
  const tg=tanksFor(f.id,true);
  const opts=fuelTypeOptions(f.id),isLube=!opts;
  const drums=isLube&&b.mode==='drums',byTank=!drums&&bunkerByTank(b);
  const fuelType=opts?(b.fuelType||defaultFuelType(f.id)):null,noMix=!!(opts&&fuelType&&fuelTypeNoMixing(fuelType));
  const fuelTypeField=opts?`<div class="field ft-sul-row"><div class="ft-col"><label>Fuel type (this bunker)${manualPickHtml(opts,fuelType,`data-mp="bunker" data-bunker-route="${ri}" data-bunker-fuel="${f.id}"`,'Type fuel type')}</label>${explain('Fuel type','Which grade is being bunkered (pick from the list or type your own). Only tanks of the same type are offered. New VLSFO needs an empty tank (only the unpumpable quantity may remain) — it cannot be mixed with old VLSFO ROB. HFO, diesel oil and biodiesel may top up a tank of the same type.')}</div><div class="sul-col"><label>Sulphur (% m/m)<input type="number" inputmode="decimal" step="0.01" min="0" max="5" placeholder="${sulPlaceholder(fuelType)}" data-bunker-route="${ri}" data-bunker-fuel="${f.id}" data-bunker-field="sulphur" value="${esc(sulVal(b.sulphur))}"></label>${explain('Sulphur content','Sulphur content (% m/m) of the fuel being bunkered, from its BDN. Leave blank to use the default (VLSFO 0.5 %, LSMGO 0.1 %). It is blended into each receiving tank by mass, including any unpumpable quantity left in the tank: tank sulphur = (old ROB × old S + bunker qty × bunker S) ÷ (old ROB + bunker qty). An empty tank simply takes this value.')}</div></div>`:'';
  const eligibleTanks=opts?eligibleBunkerTanks(f.id,fuelType,calc.results[ri]?.tankAtArrival).map(t=>t.id):null;
  const at=`data-bunker-route="${ri}" data-bunker-fuel="${f.id}"`;
  const modeField=isLube?`<div class="field"><label>Received as<select ${at} data-bunker-field="mode"><option value="bulk" ${drums?'':'selected'}>Bulk — into the storage tank</option><option value="drums" ${drums?'selected':''}>In drums — pumped to tank later</option></select></label>${explain('Bulk or drums','Bulk: the quantity is received into the designated storage tank(s) straight away. In drums: the quantity is stored aboard in drums, separately from the tanks (it does not raise any tank ROB), and is pumped over by hand into the storage tank(s) in the “Pump from drums into tank” box below — at this port or a later one.')}</div>`:'';
  const qtyVal=byTank?Math.round(sumAllocations(b.allocations)*100)/100:n(b.quantity);
  const qtyLabel=drums?`Quantity received in drums (${esc(f.unit)})`:bunkerQtyLabel(byTank);
  const qtyHelp=drums?'Quantity received in drums at this port. It is held aboard as drum stock and does not change any tank until you pump it over.':'Type the total here and the planner places it in the tanks — or leave it and type the quantity into each tank below, and this box becomes the total of the tanks automatically. Typing here again goes back to a total. Credited after port consumption and allocated only to tanks with available capacity.';
  const allocHead=drums?'':'<div class="alloc-head muted">Or enter the quantity into each tank</div>';
  const props=opts||isLube?bunkerTankProposals(f.id,fuelType,ri):[];
  const allocList=drums?'':(tg.length?`${allocHead}<div class="allocation-list">${tg.map(t=>{const a=allocValue(ri,f.id,b,t.id),dimmed=eligibleTanks&&!eligibleTanks.includes(t.id);return `<div class="field${dimmed?' tank-ineligible':''}"><label>${esc(t.name)}<small class="inel-note">(not eligible for this fuel type)</small><input type="number" step="0.01" min="0" ${dimmed?'disabled':''} placeholder="${esc(allocPlaceholder(ri,f,t.id,props))}" data-alloc-route="${ri}" data-alloc-fuel="${f.id}" data-alloc-tank="${t.id}" value="${allocShow(a)}"></label><small class="alloc-max" data-alloc-max="${ri}:${f.id}:${t.id}">${allocMaxText(ri,f,t.id,props)}</small>${opts?(()=>{const pi=bunkerPctInfo(ri,f.id,t.id);return `<small class="alloc-pct ${pi.cls}" data-alloc-pct="${ri}:${f.id}:${t.id}">${pi.html}</small>`;})():''}</div>`}).join('')}</div>`:'<div class="muted" style="margin-top:8px">No consumable tanks in this fuel group.</div>');
  const autoBox=drums?'':`<label class="check only-total" style="margin-top:8px"><input type="checkbox" ${at} data-bunker-field="autoAllocate" ${b.autoAllocate!==false?'checked':''}> Auto-allocate by tank free capacity</label>${explain('Auto allocation','When enabled, the planner fills eligible tanks (matching the fuel type above) in sequence, up to '+maxFillPctText()+'% of capacity first, until the bunker quantity is allocated.')}`;
  const live=drums?'':`<div class="bunker-live only-total" data-bunker-live="${ri}:${f.id}">${bunkerLiveHtml(r,f,ri)}</div>`;
  return `<div class="bunker-box${byTank?' by-tank':''}" data-bunker-box="${ri}:${f.id}">${fuelTypeField}${modeField}<div class="field"><label><span class="qty-label">${qtyLabel}</span><input type="number" step="0.01" min="0" class="bq-input${byTank?' auto-total':''}" ${at} data-bunker-field="quantity" value="${qtyVal}"></label>${explain('Bunker quantity',qtyHelp)}</div>${live}${autoBox}${allocList}${isLube?drumPanelHtml(r,f,ri,tg):''}</div>`;}
/* v1.42 — lube oil kept in drums: manual pump-over into the designated storage tank(s). Shown when this port receives drums, or drum stock is aboard on arrival. */
function drumPanelVisible(ri,f){
  const r=state.route[ri],b=r?.bunkers?.[f.id],bi=calc.results[ri]?.bunkerInfo?.[f.id];
  return !!(b&&b.mode==='drums')||n(bi&&bi.drumArrival)>0||sumAllocations(b&&b.transfer&&b.transfer.allocations)>0;
}
function xferValue(r,fid,tankId){return (r.bunkers?.[fid]?.transfer?.allocations||[]).find(x=>x.tankId===tankId)?.quantity||0;}
function drumSummaryHtml(ri,f){
  const bi=calc.results[ri]?.bunkerInfo?.[f.id];if(!bi)return'';
  const r=state.route[ri],want=sumAllocations(r?.bunkers?.[f.id]?.transfer?.allocations),u=f.unit,got=n(bi.transferred);
  const cell=(l,v,cls='')=>`<span class="${cls}">${l} <strong>${fmtQty(v,u)}</strong></span>`;
  const warn=want>got+0.005?`<div class="alert warning">Only ${fmtQty(got,u)} of the ${fmtQty(want,u)} entered could be pumped over — there is not enough in the drums, or the tank has no room. The rest stays in the drums.</div>`:'';
  return `<div class="drum-sum-row">${cell('In drums on arrival',bi.drumArrival)}${cell('Received now',bi.drumReceived)}${cell('Pumped into tanks',got)}${cell('In drums on departure',bi.drumDeparture,'ds-end')}</div>${warn}`;
}
function drumPanelHtml(r,f,ri,tg){
  const tanks=tg.length?`<div class="allocation-list">${tg.map(t=>`<div class="field"><label>${esc(t.name)}<input type="number" step="0.01" min="0" data-xfer-route="${ri}" data-xfer-fuel="${f.id}" data-xfer-tank="${t.id}" value="${n(xferValue(r,f.id,t.id))}"></label></div>`).join('')}</div>`:'<div class="muted" style="margin-top:8px">No consumable tanks in this group to pump into.</div>';
  return `<div class="drum-box" data-drum-panel="${ri}:${f.id}" ${drumPanelVisible(ri,f)?'':'hidden'}><div class="tank-head"><strong>Pump from drums into tank</strong><span class="tag">${esc(f.unit)}</span></div><div class="drum-sum" data-xfer-sum="${ri}:${f.id}">${drumSummaryHtml(ri,f)}</div>${tanks}${explain('Pump from drums','Type how much is pumped by hand from the drums into each designated storage tank at this port. It is taken from the drum stock (never more than is aboard) and added to the tank (never beyond its capacity). It is not counted as a second bunkering.')}</div>`;
}
/* With Auto-allocate on, the tank inputs show the quantity the planner allocated; otherwise the user's own figures. */
function allocValue(ri,fid,b,tankId){
  if(b.autoAllocate!==false&&n(b.quantity)>0&&!bunkerByTank(b)){const bi=calc.results[ri]?.bunkerInfo?.[fid],hit=(bi?.bulkAllocations||bi?.allocations||[]).find(x=>x.tankId===tankId);return hit?Math.round(hit.quantity*100)/100:0;}
  return (b.allocations||[]).find(x=>x.tankId===tankId)?.quantity||0;
}
function bunkerLiveHtml(r,f,ri){
  const opts=fuelTypeOptions(f.id),isLube=!opts;
  const b=r.bunkers?.[f.id]||{quantity:0,autoAllocate:true,allocations:[]},fuelType=opts?(b.fuelType||defaultFuelType(f.id)):null;
  const list=bunkerTankProposals(f.id,fuelType,ri);if(!list.length)return'';
  const lo=list.reduce((s,p)=>s+p.qty,0),hi=list.reduce((s,p)=>s+p.qtyMax,0);
  const rule=`eligible tanks filled to your ${maxFillPctText()}% maximum${isLube?'':(fuelTypeNoMixing(fuelType)?' — new VLSFO needs an empty tank (the unpumpable quantity may remain), no mixing with old VLSFO ROB':'; same-type ROB may be topped up')}`;
  const head=`<div class="proposed-qty"><span>Proposed ${isLube?'replenish':'bunker'} quantity <small>(${rule})</small>: <strong>${fmtN(lo,f.unit)} ${esc(f.unit)}</strong></span><button type="button" class="ghost sm" data-use-proposed="${ri}:${f.id}" >Use this</button></div>`;
  const rows=`<div class="pq-list">${list.map(p=>`<div class="pq-row ${p.ok?'':'pq-no'}"><span>${esc(p.tank.name)}${opts?` <small>${esc(fuelTypeLabel(f.id,p.type))}</small>`:''}</span><span>${p.ok?`<b>${fmtN(p.qty,f.unit)}</b> ${esc(f.unit)}`:esc(p.reason)}</span></div>`).join('')}</div>`;
  const bi=calc.results[ri]?.bunkerInfo?.[f.id];
  const over85Warn=bi&&bi.over85?`<div class="alert warning blink-warn">Over the ${maxFillPctText()}% maximum fill in: ${bi.overTanks.map(esc).join(', ')||'one or more tanks'}. Consider a smaller quantity or spreading it across more tanks.</div>`:'';
  return head+rows+over85Warn;
}
/* Bunkering tab: small horizontal ETA/ETD tank-condition bars (with ROB/Capacity numbers) per
   product group, reusing rtCell so the visuals match the Dashboard's Tank ROB at ETA → ETD list. */
function tankConditionRows(c,groupId){
  const unit=getProfile(groupId)?.unit||'MT';
  const tanksEta=(c?.tankAtArrival)||[],tanksEtd=(c?.tankAfter)||[];
  const storageOnly=!!fuelTypeOptions(groupId);   // v1.41: fuel and diesel oil show the storage tanks only (no settling / service / support tanks)
  const ids=sortTankIdsByDisplayOrder([...new Set([...tanksEta,...tanksEtd].filter(t=>t.group===groupId&&(!storageOnly||t.category==='storage')).map(t=>t.id))]);
  if(!ids.length)return `<div class="empty">${storageOnly?'No storage tanks configured for this product.':'No tanks configured for this product.'}</div>`;
  const rows=ids.map(id=>{
    const a=tanksEta.find(t=>t.id===id),d=tanksEtd.find(t=>t.id===id),name=a?.name||d?.name||id;
    return `<div class="rt-row"><div class="rt-name" title="${esc(name)}">${tankNameHtml(name,groupId,state.tanks.find(x=>x.id===id),d||a,unit)}</div>${rtCell(a,unit,groupId,c?.index,'eta')}${rtCell(d,unit,groupId,c?.index,'etd')}</div>`;
  }).join('');
  return `<div class="rt-group"><div class="rt-head"><span>Tank</span><span>ETA</span><span>ETD</span></div>${rows}</div>`;
}
function bunkerProductBlock(r,p,i){
  const c=calc.results[i];
  return `<div class="bunker-product"><div class="bp-head"><strong>${esc(p.name)}</strong><span class="tag">${esc(p.unit)}</span></div>${bunkerEditor(r,p,i)}<div class="bunker-cond" data-bunker-cond="${i}:${p.id}">${tankConditionRows(c,p.id)}</div></div>`;
}
function bunkerPortCard(r,i){
  const c=calc.results[i],eta=c?fmtDate(c.arrivalUtc,c.utcOffset):'—',k='bunkport:'+i;
  return `<details class="item-card route-card${portFlagClass(i)}" id="bunkport-${i}" data-open-key="${k}" ${uiOpen.has(k)?'open':''}>
    <summary class="route-sum"><span class="step">${i+1}</span><span class="rs-main"><strong class="rs-port">${esc(r.port||`Port ${i+1}`)}</strong><small class="rs-meta">ETA ${eta}</small>${portFlagsHtml(i,false)}</span>${ICON.chev}</summary>
    <div class="route-body">
      <h4 class="bunker-section-title">Fuel bunkering</h4>
      <div class="bunker-grid">${state.fuels.map(f=>bunkerProductBlock(r,f,i)).join('')}</div>
      <h4 class="bunker-section-title">Lube oil replenishment</h4>
      <div class="bunker-grid">${state.lubes.map(l=>bunkerProductBlock(r,l,i)).join('')}</div>
    </div>
  </details>`;
}
let maxFillAsked=false;
function maxFillSeen(){try{return !!localStorage.getItem('bunker-maxfill-asked');}catch{return maxFillAsked;}}
function markMaxFillSeen(){maxFillAsked=true;try{localStorage.setItem('bunker-maxfill-asked','1');}catch{}}
function askMaxFill(force){
  if(!force&&(state.meta.maxFillPct||maxFillAsked||maxFillSeen()||tourIndex>=0))return;   // first Tanks-tab visit only
  markMaxFillSeen();$('#maxFillInput').value=state.meta.maxFillPct||'';$('#maxFillModal').hidden=false;
  setTimeout(()=>{try{$('#maxFillInput').focus();}catch{}},50);
}
function renderMaxFillBar(){
  const el=$('#maxFillBar');if(!el)return;
  el.innerHTML=`<span>Company maximum tank fill: <strong>${maxFillPctText()}%</strong>${state.meta.maxFillPct?'':' <small>(default — not set yet)</small>'}</span><button type="button" class="ghost sm" data-change-maxfill>Change</button>`;
}
function renderBunkering(){
  $('#bunkerList').innerHTML=state.route.length?state.route.map((r,i)=>bunkerPortCard(r,i)).join(''):'<div class="empty">Add ports in the Voyage tab first, then plan bunkering and lube oil replenishment here.</div>';
}
function syncBunkerConditions(i){
  const c=calc.results[i],r=state.route[i];
  [...state.fuels,...state.lubes].forEach(p=>{
    const el=document.querySelector(`[data-bunker-cond="${i}:${p.id}"]`);if(el)el.innerHTML=tankConditionRows(c,p.id);
    const live=document.querySelector(`[data-bunker-live="${i}:${p.id}"]`);if(live&&r)live.innerHTML=bunkerLiveHtml(r,p,i);
    if(r){const b=r.bunkers?.[p.id]||{};document.querySelectorAll(`[data-alloc-route="${i}"][data-alloc-fuel="${p.id}"]`).forEach(inp=>{if(document.activeElement!==inp)inp.value=allocShow(allocValue(i,p.id,b,inp.dataset.allocTank));});}
    const sumEl=document.querySelector(`[data-xfer-sum="${i}:${p.id}"]`);if(sumEl)sumEl.innerHTML=drumSummaryHtml(i,p);
    const dpanel=document.querySelector(`[data-drum-panel="${i}:${p.id}"]`);if(dpanel)dpanel.hidden=!drumPanelVisible(i,p);
    const bb=r?.bunkers?.[p.id],byT=bunkerByTank(bb)&&bb.mode!=='drums';
    const box=document.querySelector(`[data-bunker-box="${i}:${p.id}"]`);if(box){box.classList.toggle('by-tank',byT);const ql=box.querySelector('.qty-label');if(ql&&bb?.mode!=='drums')ql.textContent=bunkerQtyLabel(byT);}
    const bq=document.querySelector(`input[data-bunker-route="${i}"][data-bunker-fuel="${p.id}"][data-bunker-field="quantity"]`);if(bq){bq.classList.toggle('auto-total',byT);if(byT&&document.activeElement!==bq)bq.value=Math.round(sumAllocations(bb.allocations)*100)/100;}
    if(r){const ft=fuelTypeOptions(p.id)?(bb?.fuelType||defaultFuelType(p.id)):null,props=bunkerTankProposals(p.id,ft,i);document.querySelectorAll(`[data-alloc-route="${i}"][data-alloc-fuel="${p.id}"]`).forEach(inp=>{const tid=inp.dataset.allocTank;inp.placeholder=allocPlaceholder(i,p,tid,props);const mx=document.querySelector(`[data-alloc-max="${i}:${p.id}:${tid}"]`);if(mx)mx.innerHTML=allocMaxText(i,p,tid,props);});}
    document.querySelectorAll(`[data-alloc-pct^="${i}:${p.id}:"]`).forEach(el=>{const pi=bunkerPctInfo(i,p.id,el.dataset.allocPct.split(':').slice(2).join(':'));el.innerHTML=pi.html;el.className=`alloc-pct ${pi.cls}`;});
    if(r&&fuelTypeOptions(p.id)){const ft=r.bunkers?.[p.id]?.fuelType||defaultFuelType(p.id),ids=eligibleBunkerTanks(p.id,ft,c?.tankAtArrival).map(t=>t.id);const lockNoMix=true;document.querySelectorAll(`[data-alloc-route="${i}"][data-alloc-fuel="${p.id}"]`).forEach(inp=>{const fld=inp.closest('.field'),bad=!ids.includes(inp.dataset.allocTank);if(fld)fld.classList.toggle('tank-ineligible',bad);inp.disabled=lockNoMix&&bad;});}
  });
}

let lastAlertKeys=new Set(),lastIgnored=[];
function ignoredAlerts(){state.meta.ignoredAlerts=state.meta.ignoredAlerts||{};return state.meta.ignoredAlerts;}
function A(kind,o={}){
  const key=o.k||kind;
  const a=Object.entries(o).filter(([k,v])=>k!=='k'&&v!==undefined&&v!==null).map(([k,v])=>` data-${k}="${esc(String(v))}"`).join('');
  return ` data-alert="${kind}" data-k="${esc(key)}"${a} role="button" tabindex="0" title="Tap to find the source and see how to fix it"`;
}
const GO='<span class="alert-go">Fix ›</span>';
function buildAlertItems(){
  const alertItems=[];const maxf=bunkerFillFrac();lastAlertKeys=new Set();lastIgnored=[];
  const ign=ignoredAlerts();
  const add=(html,k)=>{
    const label=html.replace(/<span class="alert-go">.*?<\/span>/,'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
    if(ign[k]){lastIgnored.push({k,label});return;}
    lastAlertKeys.add(k);
    alertItems.push(html.replace(/<\/li>$/,`<button type="button" class="ghost sm alert-ignore" data-ignore-alert="${esc(k)}" title="Hide this alert from the list">Ignore</button></li>`));
  };
  calc.results.forEach(r=>r.tankAfter.forEach(t=>{
    if(n(t.capacity)>0&&n(t.rob)>n(t.capacity)+1e-9){const k=`cap:${r.index}:${t.id}`;add(`<li${A('cap',{i:r.index,t:t.id,k})}><b>${esc(t.name)}</b> exceeds capacity by ${fmtQty(n(t.rob)-n(t.capacity),unitFor(t.group))}. ${GO}</li>`,k);}
    else if(n(t.capacity)>0&&n(t.rob)>n(t.capacity)*maxf+1e-9&&!(t.group==='fo'&&(t.category==='settling'||t.category==='service'))){const k=`over85:${r.index}:${t.id}`;add(`<li${A('over85',{i:r.index,t:t.id,k})}><b>${esc(t.name)}</b> is at ${Math.round(n(t.rob)/n(t.capacity)*100)}% full after ${esc(r.port)} — above the ${Math.round(maxf*100)}% maximum fill. ${GO}</li>`,k);}
  }));
  calc.totals.shortages.forEach((a,ai)=>{const k=`short:${a.stopIndex}:${a.phase}:${a.item}`;add(`<li${A('short',{x:ai,k})}><b>${esc(a.item)}</b> at ${esc(a.location||'route')}: shortage ${fmtQty(a.shortage,unitFor(getProfileIdByName(a.item)))}. ${esc(a.message||'')} ${GO}</li>`,k);});
  calc.results.forEach(r=>Object.entries(r.fuelStatus).forEach(([id,s])=>{if(s.belowReserve){const k=`res:${r.index}:${id}`;add(`<li${A('res',{i:r.index,g:id,k})}><b>${esc(groupLabel(id))}</b> below reserve at departure from ${esc(r.port)}. Required reserve: ${fmtQty(s.reserveQty,unitFor(id))}. ${GO}</li>`,k);}}));
  return alertItems;
}

/* ---------- Alert → source + correction guide ---------- */
let activeGuide=null;
function alertGuide(d){
  const i=d.i!==undefined&&d.i!==''?Number(d.i):null,r=i!==null?calc.results[i]:null,pname=r?r.port||`Port ${i+1}`:'';
  const q=(v,g)=>fmtQty(v,g?unitFor(g):'MT'),E=esc;
  const bunkQty=(j,g)=>`[data-bunker-route="${j}"][data-bunker-fuel="${g}"][data-bunker-field="quantity"]`;
  const G={title:'Planning alert',where:'',tab:'dashboard',open:[],target:[],steps:[],alt:null};
  if(d.a==='cap'||d.a==='over85'){
    const t=(r?.tankAfter||[]).find(x=>x.id===d.t)||{},g=t.group,tname=t.name||'this tank',maxf=bunkerFillFrac();
    const limit=d.a==='cap'?n(t.capacity):n(t.capacity)*maxf,excess=Math.max(0,n(t.rob)-limit);
    G.title=d.a==='cap'?`${tname} would overfill after ${pname}`:`${tname} is above the maximum fill after ${pname}`;
    let j=-1;for(let k=i;k>=0;k--){if(n((calc.results[k]?.bunkerInfo?.[g]?.allocations||[]).find(x=>x.tankId===d.t)?.quantity)>1e-9){j=k;break;}}
    const limTxt=d.a==='cap'?`its capacity of ${q(t.capacity,g)}`:`the ${Math.round(maxf*100)}% maximum fill (${q(limit,g)})`;
    if(j>=0){
      const rec=n(calc.results[j].bunkerInfo[g].allocations.find(x=>x.tankId===d.t).quantity),pj=calc.results[j].port||`Port ${j+1}`;
      G.tab='bunkering';G.open=['bunkport:'+j];
      G.target=[`[data-alloc-route="${j}"][data-alloc-fuel="${g}"][data-alloc-tank="${d.t}"]`,bunkQty(j,g),`[data-open-key="bunkport:${j}"]`];
      G.where=`Bunkering & Lube Oil › ${pj} › ${groupLabel(g)} › ${tname}`;
      G.steps=[`After ${E(pname)} this tank holds ${q(t.rob,g)}, which is ${q(excess,g)} over ${limTxt}.`,`It got there because ${q(rec,g)} is bunkered into it at ${E(pj)}.`,`Lower this tank’s figure in the highlighted box by at least ${q(excess,g)} — or tick “Auto-allocate” so the planner spreads the bunker over tanks that have room, or reduce the Bunker quantity.`,`This alert clears by itself once the tank is within the limit.`];
    }else{
      const idx=state.tanks.findIndex(x=>x.id===d.t),tk=state.tanks[idx]||{};
      const robBad=n(tk.rob)>limit+1e-9;
      G.tab='tanks';G.open=['tank:'+d.t];
      G.target=robBad?[`[data-tank-index="${idx}"][data-field="rob"]`,`[data-tank-card="${idx}"]`]:[`[data-tank-index="${idx}"][data-field="capacityM3"]`,`[data-tank-index="${idx}"][data-field="capacity"]`,`[data-tank-card="${idx}"]`];
      G.where=`Tanks › ${groupLabel(g)} › ${tname}`;
      G.steps=robBad?[`The present ROB entered for this tank is ${q(tk.rob,g)}, which is over ${limTxt}.`,`Check the sounding: correct the Present ROB in the highlighted box.`,`If the ROB is right, the capacity entered for this tank is too small — correct the capacity instead.`]:[`This tank ends at ${q(t.rob,g)} — ${q(excess,g)} over ${limTxt} — with no bunker going into it.`,`Check the capacity entered for this tank (highlighted) and its present ROB.`,`If they are right, the tank is genuinely too full: move consumption into it earlier in the sequence.`];
    }
  }else if(d.a==='short'){
    const sh=calc.totals.shortages[Number(d.x)]||{},g=getProfileIdByName(sh.item),si=sh.stopIndex,ph=sh.phase,u=g?unitFor(g):'MT';
    G.title=`${sh.item||'Product'} shortage at ${sh.location||'route'}`;
    if(ph==='bunkering'){
      G.tab='bunkering';G.open=['bunkport:'+si];G.target=[bunkQty(si,g),`[data-open-key="bunkport:${si}"]`];
      G.where=`Bunkering & Lube Oil › ${sh.location} › ${sh.item}`;
      if(/drums/.test(sh.message||'')){G.target=[`[data-xfer-route="${si}"][data-xfer-fuel="${g}"]`,`[data-open-key="bunkport:${si}"]`];G.steps=[`${fmtQty(sh.shortage,u)} of the quantity you entered to pump from the drums could not be moved.`,E(sh.message),`Lower the “Pump from drums into tank” figures (highlighted) by ${fmtQty(sh.shortage,u)}, receive more in drums at this or an earlier port, or add/enlarge a tank in the Tanks tab.`];}
      else G.steps=[`${fmtQty(sh.shortage,u)} of the planned bunker could not be placed in any tank.`,E(sh.message||'The tanks have no room for it.'),`Reduce the Bunker quantity (highlighted) by ${fmtQty(sh.shortage,u)}, or add/enlarge an eligible tank in the Tanks tab.`];
    }else{
      const when=ph==='sea'?'on the sea leg to':ph==='anchor'?'at anchor/drift at':'during the port stay at',prev=si>0?calc.results[si-1]?.port||`Port ${si}`:'';
      G.steps=[`${E(sh.item)} runs out ${when} ${E(sh.location)} — short by ${fmtQty(sh.shortage,u)}.`];
      if(si>0){
        G.tab='bunkering';G.open=['bunkport:'+(si-1)];G.target=[bunkQty(si-1,g),`[data-open-key="bunkport:${si-1}"]`];G.where=`Bunkering & Lube Oil › ${prev} › ${sh.item}`;
        G.steps.push(`Bunker at least ${fmtQty(sh.shortage,u)} at ${E(prev)} (the port before) — enter it in the highlighted Bunker quantity box. Bunker received in a port is only available after that port’s own consumption.`,`If the present ROB you entered is too low, correct it in the Tanks tab instead.`,`If the plan is too pessimistic, check the daily rate in Setup or the speed/distance in the Voyage tab.`);
        G.alt={label:'Open Tanks (present ROB)',tab:'tanks',target:[`[data-tank-card]`]};
      }else{
        const idx=state.tanks.findIndex(x=>x.group===g);
        G.tab='tanks';G.open=idx>=0?['tank:'+state.tanks[idx].id]:[];G.target=[`[data-tank-index="${idx}"][data-field="rob"]`,`[data-tank-card="${idx}"]`];G.where=`Tanks › ${groupLabel(g)}`;
        G.steps.push(`This is the first port, so there is no earlier port to bunker at. The present ROB entered for ${E(sh.item)} is too low for the first leg or stay.`,`Correct the Present ROB in the highlighted tank, or lower the daily rate in Setup.`);
      }
    }
  }else if(d.a==='res'){
    const g=d.g,gl=groupLabel(g),st=r?.fuelStatus?.[g]||{},usable=n(st.rob)-n(st.unpumpable),need=Math.max(0,n(st.reserveQty)-usable),cur=n(state.route[i]?.bunkers?.[g]?.quantity);
    G.title=`${gl} below reserve leaving ${pname}`;G.tab='bunkering';G.open=['bunkport:'+i];G.target=[bunkQty(i,g),`[data-open-key="bunkport:${i}"]`];
    G.where=`Bunkering & Lube Oil › ${pname} › ${gl}`;
    G.steps=[`Leaving ${E(pname)}, usable ${E(gl)} is ${q(usable,g)} but the reserve you set needs ${q(st.reserveQty,g)}.`,`Bunker at least ${q(need,g)} more here (planned now: ${q(cur,g)}), so enter ${q(cur+need,g)} or more in the highlighted Bunker quantity box.`,`Or bunker at an earlier port, or reduce the reserve days in Setup › Consumption rates.`];
    G.alt={label:'Open reserve days (Setup)',tab:'setup',target:[`[data-rate-id="${g}"][data-field="reserveDays"]`,`#ratesList`]};
  }
  return G;
}
function guideTarget(sels){for(const sel of sels||[]){try{const el=document.querySelector(sel);if(el)return el;}catch{}}return null;}
function guideHighlight(sels,scroll){
  document.querySelectorAll('.alert-target').forEach(el=>el.classList.remove('alert-target'));
  const el=guideTarget(sels);if(!el)return;
  let dt=el.closest('details');while(dt){dt.open=true;if(dt.dataset.openKey)uiOpen.add(dt.dataset.openKey);dt=dt.parentElement?.closest('details');}
  (el.closest('.field')||el).classList.add('alert-target');
  if(scroll)requestAnimationFrame(()=>{try{el.scrollIntoView({behavior:'smooth',block:'center'});}catch{el.scrollIntoView();}});
}
function guideGo(info,scroll=true){
  showTab(info.tab);
  (info.open||[]).forEach(k=>{uiOpen.add(k);const el=document.querySelector(`[data-open-key="${k}"]`);if(el)el.open=true;});
  guideHighlight(info.target,scroll);
}
function renderGuidePanel(info,resolved){
  let p=document.getElementById('alertGuide');
  if(!p){p=document.createElement('div');p.id='alertGuide';p.className='alert-guide';p.setAttribute('role','status');document.body.appendChild(p);
    p.addEventListener('click',e=>{
      const b=e.target.closest('[data-guide]');if(!b||!activeGuide)return;
      const act=b.dataset.guide;
      if(act==='close')closeAlertGuide();
      else if(act==='again')guideGo(activeGuide.info,true);
      else if(act==='why')showWhy({dataset:{why:'alert',...activeGuide.d}});
      else if(act==='alt'&&activeGuide.info.alt)guideGo({tab:activeGuide.info.alt.tab,open:[],target:activeGuide.info.alt.target},true);
    });}
  p.classList.toggle('resolved',!!resolved);
  p.innerHTML=resolved
    ?`<div class="ag-head"><strong>✓ Fixed</strong><button type="button" class="ghost sm" data-guide="close" aria-label="Close">✕</button></div><p class="ag-where">${esc(info.title)} — this alert no longer applies.</p><div class="ag-actions"><button type="button" class="primary sm" data-guide="close">Done</button></div>`
    :`<div class="ag-head"><strong>${esc(info.title)}</strong><button type="button" class="ghost sm" data-guide="close" aria-label="Close guide">✕</button></div><p class="ag-where">📍 ${esc(info.where||'')}</p><ol class="ag-steps">${info.steps.map(x=>`<li>${x}</li>`).join('')}</ol><div class="ag-actions"><button type="button" class="secondary sm" data-guide="again">Show me again</button>${info.alt?`<button type="button" class="ghost sm" data-guide="alt">${esc(info.alt.label)}</button>`:''}<button type="button" class="ghost sm" data-guide="why">How was this calculated?</button></div>`;
  p.hidden=false;
}
function openAlertGuide(d){
  d={...d,a:d.a||d.alert};
  const info=alertGuide(d);
  activeGuide={d:{...d},key:d.k,info};
  $('#alertsModal').hidden=true;
  renderGuidePanel(info,false);
  guideGo(info,true);
}
function closeAlertGuide(){
  activeGuide=null;document.querySelectorAll('.alert-target').forEach(el=>el.classList.remove('alert-target'));
  const p=document.getElementById('alertGuide');if(p)p.hidden=true;
}
/* Called after every recalculation: keep the guide's figures live, keep the highlight, and confirm when fixed. */
function refreshAlertGuide(){
  if(!activeGuide)return;
  if(!lastAlertKeys.has(activeGuide.key)){
    if(!activeGuide.resolved){activeGuide.resolved=true;document.querySelectorAll('.alert-target').forEach(el=>el.classList.remove('alert-target'));renderGuidePanel(activeGuide.info,true);}
    return;
  }
  if(activeGuide.d.a!=='short'){const fresh=alertGuide(activeGuide.d);activeGuide.info={...fresh,tab:activeGuide.info.tab,open:activeGuide.info.open,target:activeGuide.info.target};renderGuidePanel(activeGuide.info,false);}
  if(currentTab===activeGuide.info.tab&&!document.querySelector('.alert-target'))guideHighlight(activeGuide.info.target,false);
}
let lastAlertCount=null;
function renderAlertsUi(items){
  const count=items.length,badge=$('#alertsBadge'),btn=$('#alertsBtn');
  if(badge){badge.textContent=count>99?'99+':String(count);badge.hidden=!count;}
  if(btn){btn.classList.toggle('has-alerts',count>0);btn.setAttribute('aria-label',count?`Planning alerts: ${count}`:'Planning alerts');}
  const box=$('#alerts');
  const ignHtml=lastIgnored.length?`<details class="ignored-alerts"><summary>${lastIgnored.length} ignored alert${lastIgnored.length>1?'s':''}</summary><ul>${lastIgnored.map(x=>`<li><span>${esc(x.label)}</span><button type="button" class="ghost sm" data-restore-alert="${esc(x.k)}">Restore</button></li>`).join('')}</ul><button type="button" class="ghost sm" data-restore-alert="*">Restore all</button></details>`:'';
  if(box)box.innerHTML=(count?`<div class="alert warning"><strong>${count} planning alert${count>1?'s':''}</strong><ul>${items.join('')}</ul></div>`:'<div class="alert good">No active planning alerts'+(lastIgnored.length?' (some are ignored)':' — no shortages, capacity conflicts or below-reserve fuel departures detected')+'.</div>')+ignHtml;
  if(lastAlertCount!==null&&count>lastAlertCount&&!$('#introScreen')&&tourIndex<0)toastAlerts(count);
  lastAlertCount=count;
  refreshAlertGuide();
}
let alertToastTimer=null;
function toastAlerts(count){
  if(!count)return;
  let t=document.getElementById('alertToast');
  if(!t){t=document.createElement('div');t.id='alertToast';t.className='alert-toast';t.setAttribute('role','alert');t.onclick=()=>{t.classList.remove('show');$('#alertsModal').hidden=false;};document.body.appendChild(t);}
  t.textContent=`⚠ ${count} planning alert${count>1?'s':''} — tap to review`;
  t.classList.add('show');clearTimeout(alertToastTimer);alertToastTimer=setTimeout(()=>t.classList.remove('show'),6000);
}
function renderResults(){
  const head=state.fuels.map(f=>`<th>${esc(f.name)} ARR</th><th>${esc(f.name)} DEP</th><th>Req. bunker</th>`).join('');
  const rows=calc.results.map(r=>`<tr class="${portFlagClass(r.index).trim()}" data-route-point="${r.index}"><td>${r.index+1}</td><td><strong>${esc(r.port)}</strong><div class="port-flags">${portFlagChips(r.index)}</div></td><td${W('eta',{i:r.index})}>${fmtDate(r.arrivalUtc,r.utcOffset)}<small>${fmtUTC(r.arrivalUtc)}</small></td><td${W('etd',{i:r.index})}>${fmtDate(r.departureUtc,r.utcOffset)}<small>${fmtUTC(r.departureUtc)}</small></td><td${W('seadays',{i:r.index})}>${days(r.seaDays)}</td><td${W('portstay',{i:r.index})}>${Math.floor(n(r.portStayDays))} d ${n(r.portStayHours)} h</td><td${W('distance',{i:r.index})}>${n(r.distanceNm).toFixed(1)} NM</td><td${W('speed',{i:r.index})}>${n(r.speedKn).toFixed(1)} kn</td><td${W('cons',{i:r.index,ph:'sea'})}>${formatConsumptionHtml(r.seaUsage)}</td><td${W('cons',{i:r.index,ph:'port'})}>${formatConsumptionHtml(r.portUsage)}</td>${state.fuels.map(f=>`<td${W('arr',{i:r.index,g:f.id})}>${fmtQty(r.arrivalFuel[f.id],f.unit)}</td><td${W('dep',{i:r.index,g:f.id})} class="${r.fuelStatus[f.id].belowReserve?'warn-text':''}">${fmtQty(r.departureFuel[f.id],f.unit)}<small>${pct(r.fuelStatus[f.id].utilization)} util. · ${Number.isFinite(r.fuelStatus[f.id].marginDays)?r.fuelStatus[f.id].marginDays.toFixed(1)+' d margin':'—'}</small></td><td${W('req',{i:r.index,g:f.id})}>${fmtQty(r.fuelStatus[f.id].bunkerRequiredNow,f.unit)}</td>`).join('')}</tr>`).join('');
  $('#resultTable').innerHTML=`<table><thead><tr><th>#</th><th>Port</th><th>ETA local</th><th>ETD local</th><th>Steaming days</th><th>Port stay</th><th>Distance to last port</th><th>Estimated speed</th><th>Sea consumption</th><th>Port consumption</th>${head}</tr></thead><tbody>${rows||'<tr><td colspan="99">No route yet.</td></tr>'}</tbody></table>`;
  renderAlertsUi(buildAlertItems());
  const totals=[...state.fuels,...state.lubes].map(p=>`<div class="metric-card"${W('ctotal',{g:p.id})}><div class="metric-label">${esc(p.name)}</div><div class="metric-value">${fmtQty(calc.totals.consumption[p.id],p.unit)}</div><div class="metric-foot">Sea ${fmtQty(calc.totals.seaConsumption[p.id],p.unit)} · Port ${fmtQty(calc.totals.portConsumption[p.id],p.unit)}</div></div>`).join('');$('#consumptionKpis').innerHTML=totals||'<div class="empty">Add rates to calculate consumption.</div>';
}
function getProfileIdByName(name){return[...state.fuels,...state.lubes].find(p=>p.name===name)?.id||'fo';}
function consumptionParts(usage){return[...state.fuels,...state.lubes].map(p=>{const v=n(usage?.[p.id]);return v>0?`${groupLabel(p.id)} ${fmtQty(v,p.unit)}`:null;}).filter(Boolean);}
function formatConsumption(usage){const parts=consumptionParts(usage);return parts.length?parts.join(' · '):'—';}
/* One fuel/lube type per line, for on-screen display (dashboard route summary & point details). */
function formatConsumptionHtml(usage){const parts=consumptionParts(usage);return parts.length?parts.map(esc).join('<br>'):'—';}

function bind(){
  $('#vesselName').addEventListener('input',e=>{state.meta.vesselName=e.target.value;save();renderSidebar();});
  $('#voyageNo').addEventListener('input',e=>{state.meta.voyageNo=e.target.value;save();renderSidebar();});
  $('#noonLocal').addEventListener('change',e=>{state.meta.noonLocal=e.target.value;syncStartUtc();renderNoonDate();rerun();});
  // One tap: today's date at the present position (local time, using its UTC offset) at noon 12:00.
  $('#noonLocalNow').addEventListener('click',()=>{const v=nowWall(state.meta.posUtcOffset).slice(0,10)+'T12:00';state.meta.noonLocal=v;$('#noonLocal').value=v;syncStartUtc();renderNoonDate();rerun();});
  // UTC offset of the present position: converts the local noon report date to the absolute start instant.
  for(const id of ['#posUtcOffset','#noonUtcOffset'])$(id).addEventListener('change',e=>{state.meta.posUtcOffset=n(e.target.value);const other=$(id==='#posUtcOffset'?'#noonUtcOffset':'#posUtcOffset');if(other)other.value=e.target.value;syncStartUtc();renderNoonDate();rerun();});
  $('#currentPosition').addEventListener('input',e=>{state.meta.currentPosition=e.target.value;save();renderDashboard();});
  const noonRobField=(id,key)=>$('#'+id).addEventListener('input',e=>{state.meta.noonRob||={fo:0,do:0,cyl:0,mesys:0,gesys:0};state.meta.noonRob[key]=Math.max(0,n(e.target.value));save();renderDashboard();});
  noonRobField('noonRobFo','fo');noonRobField('noonRobDo','do');noonRobField('noonRobCyl','cyl');noonRobField('noonRobMesys','mesys');noonRobField('noonRobGesys','gesys');
  const setMaxFill=v=>{const x=Number(v);if(!Number.isFinite(x)||x<50||x>100)return false;state.meta.maxFillPct=x;return true;};
  $('#maxFillSave').onclick=()=>{if(!setMaxFill($('#maxFillInput').value)){alert('Enter a percentage between 50 and 100.');return;}$('#maxFillModal').hidden=true;rerun();};
  $('#maxFillSkip').onclick=()=>{markMaxFillSeen();$('#maxFillModal').hidden=true;};
  $('#maxFillBar').addEventListener('click',e=>{if(e.target.closest('[data-change-maxfill]'))askMaxFill(true);});

  /* Consumption rates and tank capacity/unpumpable are treated as fixed once a real value is entered —
     changing one away from a non-zero value needs confirming. Typing itself is never interrupted; the
     check runs when the field is left (blur), comparing against the value it had when focused. Cancelling
     reverts the field (and, via the normal input handler, the underlying value) back to what it was. */
  const LOCKED_FIELD_SEL='[data-rate-id][data-field="seaRate"],[data-rate-id][data-field="portRate"],[data-rate-id][data-field="anchorRate"],[data-rate-id][data-field="reserveDays"],[data-rate-id][data-field="reserveRate"],[data-tank-index][data-field="capacity"],[data-tank-index][data-field="capacityM3"],[data-tank-index][data-field="unpumpable"]';
  const lockedFieldOrigin=new WeakMap();
  document.addEventListener('focusin',e=>{const el=e.target.closest&&e.target.closest(LOCKED_FIELD_SEL);if(el)lockedFieldOrigin.set(el,el.value);});
  document.addEventListener('focusout',e=>{
    const el=e.target.closest&&e.target.closest(LOCKED_FIELD_SEL);if(!el)return;
    const before=lockedFieldOrigin.get(el);lockedFieldOrigin.delete(el);
    if(!lockedFieldNeedsConfirm(before,el.value))return;
    const label=(el.closest('label')?.childNodes[0]?.textContent||'this value').trim();
    if(!confirm(`Change ${label} from ${before} to ${el.value}?`)){el.value=before;el.dispatchEvent(new Event('input',{bubbles:true}));}
  });

  /* v1.41: a number field showing zero is cleared when it gets focus, so you can type straight away without
     deleting the 0 first. Nothing is changed in the plan by this: if you leave the field without typing, the
     zero is put back (no input event is fired); if you type, the normal input handlers take over. Runs after the
     locked-field recorder above (so it still remembers the original value) and restores before its blur check. */
  const zeroCleared=new WeakMap();
  document.addEventListener('focusin',e=>{
    const t=e.target;
    if(!t||!t.matches||!t.matches('input[type="number"]')||t.readOnly||t.disabled)return;
    if(t.value===''||Number(t.value)!==0)return;
    zeroCleared.set(t,t.value);t.value='';
  });
  document.addEventListener('input',e=>{if(e.target&&zeroCleared.has(e.target))zeroCleared.delete(e.target);},true);
  document.addEventListener('focusout',e=>{
    const t=e.target;if(!t||!zeroCleared.has(t))return;
    const orig=zeroCleared.get(t);zeroCleared.delete(t);
    if(t.value==='')t.value=orig;
  },true);

  document.addEventListener('input',e=>{
    const t=e.target;
    if(t.id==='tankSavePort'){tankSavePortDraft=t.value;refreshTankSaveZone();return;}
    if(t.dataset.mpText!==undefined){manualPickApply(t,t.value.trim()||'other');save();refreshOutputs();const k=t.dataset.mp;if(k==='tank')syncTankCard(Number(t.dataset.tankIndex));else if(k==='bunker')syncBunkerConditions(Number(t.dataset.bunkerRoute));else syncEcaResult(Number(t.dataset.eca));return;}
    if(t.dataset.mp!==undefined)return;
    if(t.dataset.ecaPfield!==undefined){if(t.dataset.ecaPfield==='enabled')return;const i=Number(t.dataset.ecaPort),r=state.route[i];if(r){const pt=ecaPortEnsure(r),f=t.dataset.ecaPfield;pt[f]=((f==='prevToLineNm'||f==='exitNm')&&t.value==='')?'':Math.max(0,n(t.value));refreshOutputs();}return;}
    if(t.dataset.rateId){const p=getProfile(t.dataset.rateId);if(p){const f=t.dataset.field,sub=t.dataset.rateSub;if(f==='sameAsVlsfo'||f==='doEcaSplit')return;const val=(f==='name'||f==='foMode')?t.value:n(t.value);const tgt=sub?(p[sub]=p[sub]||{}):p,oldSea=n(tgt.seaRate);tgt[f]=val;if(f==='seaRate'){if(p.id==='gesys'){p.portRate=val;p.anchorRate=val;}if('reserveRate' in tgt&&(!(n(tgt.reserveRate)>0)||Math.abs(n(tgt.reserveRate)-oldSea)<1e-9)){tgt.reserveRate=val;const rr=document.querySelector(`[data-rate-id="${p.id}"][data-field="reserveRate"]${sub?`[data-rate-sub="${sub}"]`:':not([data-rate-sub])'}`);if(rr)rr.value=val;}}save();refreshOutputs();}}
    if(t.dataset.tankIndex!==undefined){const i=Number(t.dataset.tankIndex),x=state.tanks[i],f=t.dataset.field;
      if(x&&f==='sulphur'){if(t.value==='')delete x.sulphur;else x.sulphur=Math.max(0,n(t.value));save();refreshOutputs();syncTankCard(i);state.tanks.forEach((o,k)=>{if(k!==i&&o.group===x.group)syncTankCard(k);});}
      else if(x&&['name','capacity','rob','unpumpable'].includes(f)){x[f]=f==='name'?t.value:n(t.value);if(f==='rob')x.rob=Math.max(0,x.rob);save();refreshOutputs();syncTankCard(i);}
      else if(x&&(f==='density'||f==='capacityM3')){x[f]=n(t.value);if(!(n(x.density)>0)&&f!=='density')x.density=0.95;x.capacity=n(x.density)>0?n(x.capacityM3)*n(x.density):0;if(fuelTypeOptions(x.group)&&x.robInput!=='mt')x.rob=Math.max(0,robFromVolume(x.robVolumeM3,x.robTempC,x.density));save();refreshOutputs();syncTankCard(i);}
      else if(x&&(f==='robVolumeM3'||f==='robTempC')){x[f]=n(t.value);x.rob=Math.max(0,robFromVolume(x.robVolumeM3,x.robTempC,x.density));save();refreshOutputs();syncTankCard(i);}}
    if(t.dataset.routeIndex!==undefined&&t.dataset.consPhase===undefined){const i=Number(t.dataset.routeIndex),r=state.route[i];if(r){const f=t.dataset.field;const STRING_ROUTE_FIELDS=['port','notes','eta','anchorMode','foActiveFuel'];r[f]=STRING_ROUTE_FIELDS.includes(f)?t.value:n(t.value);save();refreshOutputs();syncRouteCard(i);}}
    if(t.dataset.consPhase!==undefined){const i=Number(t.dataset.routeIndex),r=state.route[i];if(r){r.consOverride||={port:{},anchor:{}};r.consOverride[t.dataset.consPhase]||={};if(t.value==='')delete r.consOverride[t.dataset.consPhase][t.dataset.consId];else r.consOverride[t.dataset.consPhase][t.dataset.consId]=n(t.value);save();refreshOutputs();}}
    if(t.dataset.bunkerRoute!==undefined){const ri=Number(t.dataset.bunkerRoute),r=state.route[ri],f=t.dataset.bunkerFuel;if(r){const field=t.dataset.bunkerField;if(field==='fuelType'||field==='mode')return;r.bunkers ||= {};r.bunkers[f] ||= {quantity:0,autoAllocate:true,allocations:[]};if(field==='autoAllocate'&&!t.checked&&r.bunkers[f].autoAllocate!==false)r.bunkers[f].allocations=((calc.results[ri]?.bunkerInfo?.[f]?.bulkAllocations)||(calc.results[ri]?.bunkerInfo?.[f]?.allocations)||[]).map(x=>({tankId:x.tankId,quantity:Math.round(x.quantity*100)/100}));
if(field==='sulphur'){if(t.value==='')delete r.bunkers[f].sulphur;else r.bunkers[f].sulphur=Math.max(0,n(t.value));}else{if(field==='quantity'&&bunkerByTank(r.bunkers[f])){r.bunkers[f].entryMode='total';r.bunkers[f].allocations=[];r.bunkers[f].autoAllocate=true;const cb=t.closest('.bunker-box')?.querySelector('[data-bunker-field="autoAllocate"]');if(cb)cb.checked=true;}r.bunkers[f][field]=field==='quantity'?n(t.value):t.checked;}save();refreshOutputs();syncRouteCard(ri);syncBunkerConditions(ri);}}
    if(t.dataset.allocRoute!==undefined){const ri=Number(t.dataset.allocRoute),r=state.route[ri],f=t.dataset.allocFuel,tankId=t.dataset.allocTank;if(r){r.bunkers ||= {};const b=(r.bunkers[f] ||= {quantity:0,autoAllocate:true,allocations:[]});
      if(!bunkerByTank(b)){ /* first figure typed against a tank: switch to per-tank entry, keeping the quantities the other tanks currently show */
        const bi=calc.results[ri]?.bunkerInfo?.[f],shown=(b.autoAllocate!==false&&n(b.quantity)>0)?((bi&&(bi.bulkAllocations||bi.allocations))||[]).map(x=>({tankId:x.tankId,quantity:Math.round(x.quantity*100)/100})):(b.allocations||[]).map(x=>({...x}));
        b.allocations=shown;b.entryMode='tanks';b.autoAllocate=false;}
      const a=b.allocations ||= [];const found=a.find(x=>x.tankId===tankId),qty=n(t.value);if(found)found.quantity=qty;else a.push({tankId,quantity:qty});
      b.quantity=Math.round(sumAllocations(a)*100)/100;
      const cb=t.closest('.bunker-box')?.querySelector('[data-bunker-field="autoAllocate"]');if(cb)cb.checked=false;save();refreshOutputs();syncRouteCard(ri);syncBunkerConditions(ri);}}
    if(t.dataset.xferRoute!==undefined){const ri=Number(t.dataset.xferRoute),r=state.route[ri],f=t.dataset.xferFuel,tankId=t.dataset.xferTank;if(r){r.bunkers ||= {};const b=(r.bunkers[f] ||= {quantity:0,autoAllocate:true,allocations:[]});const a=((b.transfer ||= {allocations:[]}).allocations ||= []);const found=a.find(x=>x.tankId===tankId),qty=n(t.value);if(found)found.quantity=qty;else a.push({tankId,quantity:qty});save();refreshOutputs();syncRouteCard(ri);syncBunkerConditions(ri);}}
    if(t.dataset.eca!==undefined&&t.dataset.ecaDir==='leaving'&&t.dataset.ecaField!=='enabled'&&t.dataset.ecaField!=='limitPct')ecaMarkLeavingEdited(Number(t.dataset.eca));
    if(t.dataset.eca!==undefined&&t.dataset.ecaField!=='enabled'&&t.dataset.ecaField!=='method'&&t.dataset.ecaField!=='on'&&t.dataset.ecaField!=='qtyUnit'){const i=Number(t.dataset.eca),r=state.route[i],dir=t.dataset.ecaDir,sys=t.dataset.ecaSys,field=t.dataset.ecaField;if(r){r.eca ||= {entering:{},leaving:{}};r.eca[dir] ||= {};if(sys){r.eca[dir][sys] ||= {};r.eca[dir][sys][field]=n(t.value);if(field==='qtyL'){const o=r.eca[dir][sys],info=ecaQtyInfo(dir,r.eca[dir],i,sys);o.qty=info.qty;const out=document.querySelector(`[data-eca-qty-out="${i}:${dir}:${sys}"]`);if(out)out.textContent=info.qty.toFixed(3)+' t';const dn=document.querySelector(`[data-eca-dens-note="${i}:${dir}:${sys}"]`);if(dn)dn.textContent=ecaDensityNote(info);state.meta.ecaSystemDefaults ||= {};state.meta.ecaSystemDefaults[sys] ||= {rate:0,qty:0};Object.assign(state.meta.ecaSystemDefaults[sys],{qty:o.qty,qtyL:n(o.qtyL),qtyUnit:'L'});}else if(field==='rate'||field==='qty'){state.meta.ecaSystemDefaults ||= {};state.meta.ecaSystemDefaults[sys] ||= {rate:0,qty:0};state.meta.ecaSystemDefaults[sys][field]=n(t.value);if(field==='qty')state.meta.ecaSystemDefaults[sys].qtyUnit='t';}}else{r.eca[dir][field]=n(t.value);}save();syncEcaResult(i);}}
  });
  document.addEventListener('change',e=>{
    const t=e.target;
    if(t.dataset.ecaPfield==='enabled'){const i=Number(t.dataset.ecaPort),r=state.route[i];if(r){ecaPortEnsure(r).enabled=t.checked;save();rerun();}return;}
    if(t.id==='tankSaveAt'){tankSaveAtDraft=t.value||null;refreshTankSaveZone();return;}
    if(t.id==='tankSaveOffset'){tankSaveOffsetDraft=n(t.value);return;}
    if(t.id==='tankSavePort'){tankSavePortDraft=t.value;refreshTankSaveZone();return;}
    if(t.dataset.mp!==undefined){
      if(t.dataset.mpText!==undefined)return;
      const inp=t.closest('.manual-pick')?.querySelector('[data-mp-text]');
      if(t.value===FUEL_MANUAL){manualPickApply(t,(inp&&inp.value.trim())||'other');pendingFocus=manualPickSelector(t);}
      else manualPickApply(t,t.value);
      rerun();return;
    }
    if(t.dataset.eca!==undefined&&t.dataset.ecaDir==='leaving'&&t.dataset.ecaField!=='enabled'&&t.dataset.ecaField!=='limitPct')ecaMarkLeavingEdited(Number(t.dataset.eca));
    if(t.dataset.eca!==undefined&&t.dataset.ecaDir==='entering'&&t.dataset.ecaField!=='enabled'&&ecaPropagateDefaults()){save();refreshOutputs();ecaRefreshLeavingInputs();}
    if(t.dataset.eca!==undefined&&t.dataset.ecaField==='qtyUnit'){const i=Number(t.dataset.eca),r=state.route[i],dir=t.dataset.ecaDir,sys=t.dataset.ecaSys;if(r){r.eca ||= {entering:{},leaving:{}};r.eca[dir] ||= {};const o=(r.eca[dir][sys] ||= {});o.qtyUnit=t.value==='L'?'L':'t';if(o.qtyUnit==='L'){const d=ecaFuelDensity(ecaFuels(r.eca[dir],dir,i).from);if(!(n(o.qtyL)>0)&&n(o.qty)>0&&d)o.qtyL=Math.round(n(o.qty)/d.density*1000);o.qty=ecaQtyInfo(dir,r.eca[dir],i,sys).qty;}state.meta.ecaSystemDefaults ||= {};state.meta.ecaSystemDefaults[sys] ||= {rate:0,qty:0};Object.assign(state.meta.ecaSystemDefaults[sys],{qtyUnit:o.qtyUnit,qty:n(o.qty),qtyL:n(o.qtyL)});save();rerun();}return;}
    if(t.dataset.eca!==undefined&&t.dataset.ecaField==='method'){const i=Number(t.dataset.eca),r=state.route[i],dir=t.dataset.ecaDir;if(r){r.eca ||= {entering:{},leaving:{}};(r.eca[dir] ||= {}).method=t.value;rerun();}return;}
    if(t.dataset.eca!==undefined&&t.dataset.ecaField==='on'){const i=Number(t.dataset.eca),r=state.route[i],dir=t.dataset.ecaDir,sys=t.dataset.ecaSys;if(r){r.eca ||= {entering:{},leaving:{}};r.eca[dir] ||= {};r.eca[dir][sys] ||= {};r.eca[dir][sys].on=t.checked;save();rerun();}return;}
    // Plain numeric/text edits are already applied live on "input"; only structural changes re-render,
    // so the keyboard, focus and any expanded card stay where the user left them.
    if(t.dataset.rateId){if(t.dataset.field==='name')rerun();else if(t.dataset.field==='foMode'){const p=getProfile(t.dataset.rateId);if(p&&(t.value==='hfo'||t.value==='both')&&p.hfo&&!p.hfo.seaRate&&!p.hfo.portRate&&!p.hfo.anchorRate){/* first switch to HFO: seed it from the existing rate so numbers aren't silently lost behind the newly-shown fields */p.hfo={seaRate:p.seaRate,portRate:p.portRate,anchorRate:p.anchorRate,reserveDays:p.reserveDays,reserveRate:p.reserveRate};}rerun();}else if(t.dataset.field==='sameAsVlsfo'){const p=getProfile(t.dataset.rateId);if(p)p.sameAsVlsfo=t.checked;rerun();}else if(t.dataset.field==='doEcaSplit'){const p=getProfile(t.dataset.rateId);if(p){p.doEcaSplit=t.checked;if(t.checked&&p.insideEca&&!p.insideEca.seaRate&&!p.insideEca.portRate&&!p.insideEca.anchorRate){/* first switch on: seed it from the outside-ECA rate so numbers aren't silently lost behind the newly-shown fields */p.insideEca={seaRate:p.seaRate,portRate:p.portRate,anchorRate:p.anchorRate};}}rerun();}return;}
    if(t.dataset.tankIndex!==undefined){const x=state.tanks[Number(t.dataset.tankIndex)];if(!x)return;const f=t.dataset.field;
      if(f==='group'){const old=x.group;x.group=t.value;if(fuelTypeOptions(x.group)){x.capUnit=x.capUnit==='weight'?'weight':'volume';if(x.capUnit==='volume'){if(!(n(x.density)>0))x.density=0.95;x.capacityM3=n(x.capacityM3)||(n(x.capacity)/x.density)||0;x.capacity=x.capacityM3*x.density;if(x.robTempC===undefined)x.robTempC=15;if(!(n(x.robVolumeM3)>0))x.robVolumeM3=n(x.density)>0?Math.round((n(x.rob)/x.density)*100)/100:0;if(x.robInput!=='mt')x.rob=Math.max(0,robFromVolume(x.robVolumeM3,x.robTempC,x.density));}}else{x.capUnit=undefined;}if(!x.name||/ Tank \d+$/.test(x.name))x.name=tankDefaultName(x.group,x.category);x.order=nextOrder(x.group);x.fuelType=defaultFuelType(x.group)||null;normalizeSequence(old);normalizeSequence(x.group);rerun();}
      else if(f==='robInput'){
        if(t.value==='mt'){x.robInput='mt';}
        else{x.robInput='volume';const d15=n(x.density)*1000,den=vcf54B(d15,n(x.robTempC!==undefined?x.robTempC:15))*wcf56(d15);if(den>0)x.robVolumeM3=Math.round(n(x.rob)*1000/den*100)/100;x.rob=Math.max(0,robFromVolume(x.robVolumeM3,x.robTempC,x.density));}
        rerun();}
      else if(f==='category'){const oldCat=x.category;x.category=t.value;if(oldCat!==x.category&&(oldCat==='settling'||oldCat==='service'))x.inService=false;normalizeSequence(x.group);rerun();}
      else if(f==='consumable'){x.consumable=t.checked;normalizeSequence(x.group);rerun();}
      else if(f==='fuelType'){x.fuelType=t.value;rerun();}
      else if(f==='namePreset'){if(t.value===CUSTOM_NAME){x.nameCustom=true;pendingFocus=`[data-tank-index="${t.dataset.tankIndex}"].manual-name-input`;rerun();}else{x.nameCustom=false;x.name=t.value;rerun();}}
      else renderTankSequenceSummary();
      return;}
    if(t.dataset.tankSequence!==undefined){setTankSequence(Number(t.dataset.tankSequence),Number(t.value));rerun();return;}
    if(t.dataset.eca!==undefined&&t.dataset.ecaField==='enabled'){const i=Number(t.dataset.eca),r=state.route[i],dir=t.dataset.ecaDir;if(r){r.eca ||= {entering:{},leaving:{}};const existing=r.eca[dir]||{};const fresh=!Object.keys(existing).some(k=>k!=='enabled'&&k!=='autoCopied');r.eca[dir]=t.checked?{...ecaDefaultCfg(dir,i),...existing,enabled:true,...(dir==='leaving'&&fresh?{autoCopied:true}:{})}:{...existing,enabled:false};save();rerun();}return;}
    if(t.dataset.bunkerRoute!==undefined&&t.dataset.bunkerField==='mode'){const ri=Number(t.dataset.bunkerRoute),r=state.route[ri],f=t.dataset.bunkerFuel;if(r){r.bunkers ||= {};const b=(r.bunkers[f] ||= {quantity:0,autoAllocate:true,allocations:[]});b.mode=t.value==='drums'?'drums':'bulk';save();rerun();}return;}
    if(t.dataset.bunkerRoute!==undefined&&t.dataset.bunkerField==='fuelType'){const ri=Number(t.dataset.bunkerRoute),r=state.route[ri],f=t.dataset.bunkerFuel;if(r){r.bunkers ||= {};r.bunkers[f] ||= {quantity:0,autoAllocate:true,allocations:[]};r.bunkers[f].fuelType=t.value;save();rerun();}return;}
  });
  document.addEventListener('toggle',e=>{
    if(e.target&&e.target.tagName==='DETAILS'&&e.target.open)foldTouch(e.target);
    const k=e.target&&e.target.dataset&&e.target.dataset.openKey;if(!k)return;
    if(e.target.open)uiOpen.add(k);else uiOpen.delete(k);
    if(k==='routetable'&&e.target.open!==(window.innerWidth>760))tableTouched=true;
  },true);
  document.addEventListener('click',e=>{
    const lc=e.target.closest('[data-leave-choice]');if(lc){leaveTankChoice(lc.dataset.leaveChoice);return;}
    if(e.target.closest('#tankFab')){if(currentTab==='tanks')saveTankCondition();else saveAllAndRecalc();return;}
    if(e.target.closest('[data-tank-save]')){saveTankCondition();return;}
    if(e.target.closest('[data-tank-save-now]')){const z=tankSaveZone('');const nw=nowWall(z.ok?z.offset:n(state.meta.posUtcOffset)),cur=$('#tankSaveAt')?.value||'';tankSaveAtDraft=nw.slice(0,10)+'T'+((cur.slice(11,16))||nw.slice(11,16));const i=$('#tankSaveAt');if(i)i.value=tankSaveAtDraft;refreshTankSaveZone();return;}
    const zmEl=e.target.closest('[data-tank-zone-mode]');
    if(zmEl){
      const at=$('#tankSaveAt');if(at&&at.value)tankSaveAtDraft=at.value;
      const po=$('#tankSavePort');if(po)tankSavePortDraft=po.value;
      const so=$('#tankSaveOffset');if(so)tankSaveOffsetDraft=n(so.value);
      const zPrev=tankSaveZone(tankSaveAtDraft||'');if(tankSaveModeDraft==='port'&&zPrev.ok)tankSaveOffsetDraft=zPrev.offset;  // carry the detected offset over
      tankSaveModeDraft=zmEl.dataset.tankZoneMode==='port'?'port':'offset';renderTankSave();return;
    }
    const trEl=e.target.closest('[data-tank-restore]');if(trEl){restoreTankCondition(trEl.dataset.tankRestore);return;}
    const tdEl=e.target.closest('[data-tank-log-del]');if(tdEl){deleteTankCondition(tdEl.dataset.tankLogDel);return;}
    const upEl=e.target.closest('[data-use-proposed]');
    if(upEl){const [riStr,fid]=upEl.dataset.useProposed.split(':'),ri=Number(riStr),r=state.route[ri];if(r){r.bunkers ||= {};r.bunkers[fid] ||= {quantity:0,autoAllocate:true,allocations:[]};const fuelType=r.bunkers[fid].fuelType||defaultFuelType(fid);const qty=proposedBunkerQuantity(fid,fuelType,ri);r.bunkers[fid].quantity=Math.round(qty*100)/100;r.bunkers[fid].autoAllocate=true;save();rerun();}return;}
    const rtEl=e.target.closest('[data-remove-tank]');
    if(rtEl){const rt=rtEl.dataset.removeTank,tk=state.tanks[Number(rt)];if(confirm(`Remove tank “${tk?.name||'this tank'}”? This cannot be undone after the plan is saved.`)){if(tk)uiOpen.delete('tank:'+tk.id);state.tanks.splice(Number(rt),1);state.tanks.forEach((t,i)=>{if(!Number.isFinite(Number(t.sequence)))t.sequence=i+1;});normalizeAllSequences();rerun();}return;}
    const rrEl=e.target.closest('[data-remove-route]');
    if(rrEl){const rr=rrEl.dataset.removeRoute;if(confirm('Remove route port “'+(state.route[Number(rr)]?.port||('Port '+(Number(rr)+1)))+'”?')){state.route.splice(Number(rr),1);[...uiOpen].filter(k=>k.startsWith('route:')||k.startsWith('bunk:')).forEach(k=>uiOpen.delete(k));rerun();}return;}
    const miEl=e.target.closest('[data-move-tank]');
    if(miEl){moveTank(Number(miEl.dataset.moveTank),miEl.dataset.direction);rerun();return;}
    const moEl=e.target.closest('[data-move-order]');
    if(moEl){const idx=Number(moEl.dataset.moveOrder);moveTankOrder(idx,moEl.dataset.direction);rerun();requestAnimationFrame(()=>{const card=document.querySelector(`[data-tank-card="${idx}"]`);if(card)card.scrollIntoView({behavior:'smooth',block:'center'});});return;}
    const mrEl=e.target.closest('[data-move-route]');
    if(mrEl){moveRoute(Number(mrEl.dataset.moveRoute),mrEl.dataset.direction);rerun();return;}
    const rp=e.target.closest('[data-route-point]');if(rp&&rp.dataset.routePoint!==undefined){renderPointDetails(Number(rp.dataset.routePoint));return;}
    const gt=e.target.closest('[data-goto-tab]');if(gt){showTab(gt.dataset.gotoTab);return;}
    const legItem=e.target.closest('.eca-legend-item');
    if(legItem){
      const chart=legItem.closest('.eca-chart'),sys=legItem.dataset.sys;
      const next=chart.dataset.iso===sys?'':sys;
      chart.dataset.iso=next;
      chart.querySelectorAll('[data-sys]').forEach(el=>el.classList.toggle('eca-dim',!!next&&el.dataset.sys!==next));
      return;
    }
    const gtk=e.target.closest('[data-goto-tank]');
    if(gtk&&!e.target.closest('[data-why]')){
      const tid=gtk.dataset.gotoTank;uiOpen.add('tank:'+tid);showTab('tanks');
      requestAnimationFrame(()=>{const el=document.getElementById('tankcard-'+tid);if(el){el.open=true;el.scrollIntoView({behavior:'smooth',block:'start'});el.classList.add('tank-jump');setTimeout(()=>el.classList.remove('tank-jump'),1600);}});
      return;
    }
    const gbp=e.target.closest('[data-goto-bunker-port]');
    if(gbp&&!e.target.closest('[data-why]')){
      const pi=gbp.dataset.gotoBunkerPort;uiOpen.add('bunkport:'+pi);showTab('bunkering');
      requestAnimationFrame(()=>{const el=document.getElementById('bunkport-'+pi);if(el){el.open=true;el.scrollIntoView({behavior:'smooth',block:'start'});el.classList.add('tank-jump');setTimeout(()=>el.classList.remove('tank-jump'),1600);}});
      return;
    }
    const addG=e.target.closest('[data-add-tank]');if(addG){openAddTankModal(addG.dataset.addTank);return;}
    if(e.target.closest('#addRouteInline')){addRoute();return;}
    const loadV=e.target.closest('[data-load-voyage]');
    if(loadV){const list=loadSavedVoyages(),entry=list.find(v=>v.id===loadV.dataset.loadVoyage);if(entry&&confirm(`Load “${entry.name}”? The current unsaved plan will be replaced.`)){state=migrate(JSON.parse(JSON.stringify(entry.data)));rerun();showTab('dashboard');window.scrollTo({top:0});}return;}
    const delV=e.target.closest('[data-delete-voyage]');
    if(delV){const list=loadSavedVoyages(),entry=list.find(v=>v.id===delV.dataset.deleteVoyage);if(entry&&confirm(`Delete saved voyage “${entry.name}”? This cannot be undone.`)){writeSavedVoyages(list.filter(v=>v.id!==entry.id));renderSavedVoyages();}return;}
  });
  const addTank=(group,category,afterTankId,fuelType,density,capacityM3,capUnit)=>{
    category=category||'storage';
    const hasFuelOpts=!!fuelTypeOptions(group),vol=hasFuelOpts&&capUnit!=='weight';
    const dens=vol?(Number(density)||0.95):0,capM3=vol?(Number(capacityM3)||0):0;
    const t={id:uid('tank'),group,name:tankDefaultName(group,category),capacity:vol?dens*capM3:0,density:vol?dens:undefined,capacityM3:vol?capM3:undefined,capUnit:hasFuelOpts?(vol?'volume':'weight'):undefined,robVolumeM3:vol?0:undefined,robTempC:vol?15:undefined,rob:0,unpumpable:0,consumable:true,category,sequence:tanksFor(group,true).length+1,order:0,inService:false,nameCustom:false,fuelType:fuelType||defaultFuelType(group)||null};
    const list=orderedGroupTanks(group).map(x=>x.t);
    state.tanks.push(t);
    let insertIdx=list.length;
    if(afterTankId){const pos=list.findIndex(x=>x.id===afterTankId);if(pos>=0)insertIdx=pos+1;}
    list.splice(insertIdx,0,t);
    list.forEach((x,idx)=>{x.order=idx;});
    const newIdx=state.tanks.length-1;
    uiOpen.add('tank:'+t.id);
    pendingFocus=`[data-tank-index="${newIdx}"][data-field="${vol?'capacityM3':'capacity'}"]`;
    rerun();
  };
  let addTankGroup='fo';
  function populateAddTankPosition(){
    const list=orderedGroupTanks(addTankGroup).map(x=>x.t);
    $('#addTankPosition').innerHTML='<option value="">At the end</option>'+list.map(t=>`<option value="${esc(t.id)}">After: ${esc(t.name||'(unnamed tank)')}</option>`).join('');
  }
  function populateAddTankFuelType(){
    const opts=fuelTypeOptions(addTankGroup),field=$('#addTankFuelTypeField'),densField=$('#addTankDensityField');
    if(!opts){field.hidden=true;$('#addTankFuelType').innerHTML='';densField.hidden=true;return;}
    field.hidden=false;
    densField.hidden=false;$('#addTankDensity').value=$('#addTankDensity').value||'0.95';
    $('#addTankFuelType').innerHTML=opts.map(o=>`<option value="${o.value}">${esc(o.label)}</option>`).join('')+`<option value="${FUEL_MANUAL}">Other (type manually)</option>`;
    const cu=$('#addTankFuelTypeCustom');cu.hidden=true;cu.value='';
  }
  function openAddTankModal(presetGroup){
    const groups=[...state.fuels,...state.lubes];
    addTankGroup=presetGroup&&groups.some(g=>g.id===presetGroup)?presetGroup:(groups[0]?.id||'fo');
    $('#addTankModalGroup').textContent=groupLabel(addTankGroup);
    $('#addTankRole').value='storage';
    populateAddTankPosition();
    populateAddTankFuelType();
    $('#addTankModal').hidden=false;
  }
  $('#addTankFuelType').addEventListener('change',e=>{const cu=$('#addTankFuelTypeCustom');cu.hidden=e.target.value!==FUEL_MANUAL;if(!cu.hidden)cu.focus();});
  $('#addTankConfirm').onclick=()=>{
    const group=addTankGroup,category=$('#addTankRole').value,after=$('#addTankPosition').value||null;
    let fuelType=null,density=null,capacityM3=null,capUnit=null;
    if(fuelTypeOptions(group)){
      const v=$('#addTankFuelType').value;fuelType=v===FUEL_MANUAL?($('#addTankFuelTypeCustom').value.trim()||'other'):(v||null);
      capUnit='volume'; // new fuel/diesel tanks are always set up by volume (the ROB can still be entered in MT on the tank card)
      if(capUnit==='volume'){
        density=Number($('#addTankDensity').value)||0;
        if(density<0.5||density>1.2){alert('Enter an average density between 0.5 and 1.2 t/m³.');$('#addTankDensity').focus();return;}
      }
      capacityM3=0; // capacity is set afterwards on the tank card, once created
    }
    $('#addTankModal').hidden=true;
    addTank(group,category,after,fuelType,density,capacityM3,capUnit);

  };
  const addRoute=()=>{state.route.push({port:'',distanceNm:0,speedKn:0,anchorStayDays:0,anchorStayHours:0,anchorMode:'anchor',portStayDays:0,portStayHours:0,utcOffset:0,notes:'',foActiveFuel:'vlsfo',bunkers:{},eca:{entering:{enabled:false},leaving:{enabled:false},port:{enabled:false,prevToLineNm:'',lineToPortNm:0,exitNm:''}}});uiOpen.add('route:'+(state.route.length-1));pendingFocus=`[data-route-index="${state.route.length-1}"][data-field="port"]`;rerun();};
  initCalcModal(()=>rerun());
  $('#alertsBtn').addEventListener('click',()=>{$('#alertsModal').hidden=false;});
  $('#exportDocx').onclick=exportDocx;
  if($('#exportLubeForm'))$('#exportLubeForm').onclick=exportLubeForm;
  if($('#exportBunkerForm'))$('#exportBunkerForm').onclick=exportBunkerForm;
  const whyTag=(el,kind)=>{if(!el)return;el.dataset.why=kind;el.setAttribute('role','button');el.tabIndex=0;el.title='Tap to see how this is calculated';};
  document.addEventListener('click',e=>{
    const ig=e.target.closest('[data-ignore-alert]');
    if(ig){e.stopPropagation();ignoredAlerts()[ig.dataset.ignoreAlert]=true;save();closeAlertGuide();refreshOutputs();return;}
    const rs=e.target.closest('[data-restore-alert]');
    if(rs){const k=rs.dataset.restoreAlert;if(k==='*')state.meta.ignoredAlerts={};else delete ignoredAlerts()[k];save();refreshOutputs();const d=$('#alerts details');if(d&&lastIgnored.length)d.open=true;return;}
    const al=e.target.closest('[data-alert]');if(al)openAlertGuide({...al.dataset});});
  const openWhy=e=>{const w=e.target.closest('[data-why]');if(!w)return false;if(e.target.closest('button,a,input,select,textarea,summary')&&e.target.closest('button,a,input,select,textarea,summary')!==w)return false;showWhy(w);return true;};
  document.addEventListener('click',e=>{openWhy(e);});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-why]')){e.preventDefault();showWhy(e.target);}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-goto-tank]')&&!e.target.closest('[data-why]')){e.preventDefault();e.target.click();}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-goto-bunker-port]')&&!e.target.closest('[data-why]')){e.preventDefault();e.target.click();}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('.eca-legend-item')){e.preventDefault();e.target.click();}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-alert]')){e.preventDefault();openAlertGuide({...e.target.dataset});}});
  document.addEventListener('click',e=>{const b=e.target.closest('.topbar-actions .icon-btn[data-label]');if(b)showIconLabel(b);});
  const newPlanFn=()=>{if(!confirm('Start a new plan? The current plan will be replaced.'))return;const carry=confirm('Carry over Setup, consumption rates, reserves and Tanks from the previous plan?\n\nOK = carry them over\nCancel = start completely blank');const old=state;state=defaultState();if(carry){state.meta={...state.meta,vesselName:old.meta.vesselName,voyageNo:'',currentPosition:old.meta.currentPosition,posUtcOffset:old.meta.posUtcOffset,positionMode:old.meta.positionMode,notes:old.meta.notes};syncStartUtc();state.fuels=JSON.parse(JSON.stringify(old.fuels));state.lubes=JSON.parse(JSON.stringify(old.lubes));state.tanks=JSON.parse(JSON.stringify(old.tanks));state.active={...old.active};}rerun();showTab('dashboard');window.scrollTo({top:0});};
  const demoPlanFn=()=>{state=migrate(demoState());rerun();showTab('dashboard');window.scrollTo({top:0});};
  const clearAllFn=()=>{
    if(!confirm('Clear ALL entries?\n\nVessel, rates, tanks, route, bunkering and ECA data will be erased and the app returned to a blank plan. Voyages you saved under a name are not affected.'))return;
    closeAlertGuide();state=defaultState();rerun();showTab('setup');window.scrollTo({top:0});
  };
  $('#newPlan').onclick=newPlanFn;$('#demoPlan').onclick=demoPlanFn;$('#demoPlan2').onclick=demoPlanFn;$('#clearAll').onclick=clearAllFn;$('#clearAll2').onclick=clearAllFn;
  $('#tourBtn').onclick=startTour;$$('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>{const m=$('#'+b.dataset.closeModal);if(m)m.hidden=true;}));$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.hidden=true;}));
  $$('.top-logo,.brand-mark').forEach(el=>{el.style.cursor='pointer';el.title='Program credits & version';el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-label','Program credits and version');const open=()=>{$('#aboutModal').hidden=false;};el.addEventListener('click',open);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});});
  $('#saveVoyageBtn').onclick=()=>{
    const nameInput=$('#saveVoyageName');
    const name=(nameInput.value||'').trim()||state.meta.vesselName||`Voyage ${new Date().toISOString().slice(0,16).replace('T',' ')}`;
    const list=loadSavedVoyages();
    list.unshift({id:uid('voyage'),name,savedAt:new Date().toISOString(),data:JSON.parse(JSON.stringify(state))});
    const ok=writeSavedVoyages(list);
    nameInput.value='';renderSavedVoyages();
    if(!ok)alert(`“${name}” could not be saved — browser storage may be full or unavailable on this device.`);
  };
  renderSavedVoyages();
  if($('#aboutVersion'))$('#aboutVersion').textContent=APP_VERSION;
  $$('.nav-link').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();if(a.dataset.tab===currentTab){window.scrollTo({top:0,behavior:'smooth'});return;}showTab(a.dataset.tab);}));
  window.addEventListener('hashchange',()=>showTab(location.hash.slice(1),{scroll:false}));
  $('#hintsBtn').onclick=()=>{const cb=$('#hintsToggle');if(cb)cb.checked=document.body.classList.contains('hints');$('#helpModal').hidden=false;};
  $('#hintsToggle').onchange=e=>{try{localStorage.setItem('bunker-hints',e.target.checked?'1':'0');}catch{}applyHints();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal').forEach(m=>m.hidden=true);});
}
function normalizeAllSequences(){[...state.fuels,...state.lubes].forEach(p=>normalizeSequence(p.id));}
function setTankSequence(index,newSeq){const t=state.tanks[index];if(!t)return;const group=t.group,arr=tanksFor(group,true);const from=arr.findIndex(x=>x.id===t.id);const to=Math.max(0,Math.min(arr.length-1,newSeq-1));if(from<0)return;arr.splice(from,1);arr.splice(to,0,t);arr.forEach((x,i)=>x.sequence=i+1);}
function moveTank(index,dir){const t=state.tanks[index];if(!t)return;const arr=tanksFor(t.group,true),pos=arr.findIndex(x=>x.id===t.id);const target=dir==='up'?pos-1:pos+1;if(pos<0||target<0||target>=arr.length)return;[arr[pos],arr[target]]=[arr[target],arr[pos]];arr.forEach((x,i)=>x.sequence=i+1);}

function xmlEsc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/\r/g,'&#13;').replace(/\n/g,'&#10;');}
function crc32(data){let c=0xFFFFFFFF;for(let i=0;i<data.length;i++){c^=data[i];for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xEDB88320:0);}return (c^0xFFFFFFFF)>>>0;}
function u32(n){return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);}
function u16(n){return new Uint8Array([n&255,(n>>>8)&255]);}
/* ZIP writer. Entries are stored, or — when file.deflated (raw deflate bytes of file.data) is given — deflated (method 8).
   Compression is optional: the browser's CompressionStream makes the large Word forms ~20x smaller; without it files are stored. */
function zipStore(files){
  const enc=new TextEncoder(),parts=[],central=[];let offset=0;
  for(const file of files){
    const name=enc.encode(file.name),data=typeof file.data==='string'?enc.encode(file.data):file.data,crc=crc32(data);
    const body=file.deflated||data,method=file.deflated?8:0;
    const lh=new Uint8Array([
      0x50,0x4b,0x03,0x04,...u16(20),...u16(0),...u16(method),...u16(0),...u16(0),...u32(crc),...u32(body.length),...u32(data.length),...u16(name.length),...u16(0),...name
    ]);
    parts.push(lh,body);
    const ch=new Uint8Array([
      0x50,0x4b,0x01,0x02,...u16(20),...u16(20),...u16(0),...u16(method),...u16(0),...u16(0),
      ...u32(crc),...u32(body.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),
      ...u32(0),...u32(offset),...name
    ]);
    central.push(ch);offset+=lh.length+body.length;
  }
  const cdOffset=offset,cdSize=central.reduce((a,b)=>a+b.length,0);
  const end=new Uint8Array([
    0x50,0x4b,0x05,0x06,...u16(0),...u16(0),...u16(central.length),...u16(central.length),...u32(cdSize),...u32(cdOffset),...u16(0)
  ]);
  parts.push(...central,end);
  const out=new Uint8Array(parts.reduce((a,b)=>a+b.length,0));let at=0;
  for(const part of parts){out.set(part,at);at+=part.length;}
  return out;
}
/* raw deflate via CompressionStream; null when the browser has none (the entry is then simply stored) */
async function deflateRaw(bytes){
  try{
    if(typeof CompressionStream==='undefined')return null;
    const cs=new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(cs).arrayBuffer());
  }catch(e){return null;}
}


function dRun(text,o={}){
  const rpr=[];
  if(o.bold)rpr.push('<w:b/>');
  if(o.italic)rpr.push('<w:i/>');
  if(o.color)rpr.push(`<w:color w:val="${o.color}"/>`);
  if(o.size)rpr.push(`<w:sz w:val="${o.size}"/>`);
  rpr.push(`<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>`);
  const rprXml=rpr.length?`<w:rPr>${rpr.join('')}</w:rPr>`:'';
  return `<w:r>${rprXml}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}
function dPara(runsOrText,o={}){
  const runs=Array.isArray(runsOrText)?runsOrText:[dRun(runsOrText,o)];
  const ppr=[];
  if(o.style)ppr.push(`<w:pStyle w:val="${o.style}"/>`);
  if(o.align)ppr.push(`<w:jc w:val="${o.align}"/>`);
  if(o.spacingAfter!==undefined)ppr.push(`<w:spacing w:after="${o.spacingAfter}"/>`);
  if(o.keepNext)ppr.push('<w:keepNext/>');
  const pprXml=ppr.length?`<w:pPr>${ppr.join('')}</w:pPr>`:'';
  return `<w:p>${pprXml}${runs.join('')}</w:p>`;
}
function dHeading(text,level,o={}){return dPara(text,{style:`Heading${level}`,...o});}
function dCell(content,o={}){
  const w=o.width||1000;
  const tcpr=[`<w:tcW w:w="${w}" w:type="dxa"/>`];
  if(o.shade)tcpr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>`);
  tcpr.push('<w:vAlign w:val="center"/>');
  const body=(content&&typeof content==='object'&&'xml' in content)?content.xml:dPara(String(content),{bold:o.bold,align:o.align});
  return `<w:tc><w:tcPr>${tcpr.join('')}</w:tcPr>${body}</w:tc>`;
}
function dRow(cells,o={}){const trpr=o.header?'<w:trPr><w:tblHeader/></w:trPr>':'';return `<w:tr>${trpr}${cells.join('')}</w:tr>`;}
function dTable(headerLabels,bodyRows,widths){
  const total=widths.reduce((a,b)=>a+b,0);
  const grid=widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('');
  const headerRow=dRow(headerLabels.map((h,i)=>dCell({xml:dPara([dRun(h,{bold:true,color:'FFFFFF'})],{align:'center'})},{width:widths[i],shade:'1F3864'})),{header:true});
  const rows=bodyRows.map((r,ri)=>dRow(r.map((c,i)=>dCell(c,{width:widths[i],shade:ri%2?'F2F2F2':undefined,align:i===0?'left':'center'})))).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7C9D3"/><w:left w:val="single" w:sz="4" w:color="B7C9D3"/><w:bottom w:val="single" w:sz="4" w:color="B7C9D3"/><w:right w:val="single" w:sz="4" w:color="B7C9D3"/><w:insideH w:val="single" w:sz="4" w:color="B7C9D3"/><w:insideV w:val="single" w:sz="4" w:color="B7C9D3"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${headerRow}${rows}</w:tbl>`;
}
function dSpace(h){return dPara('',{spacingAfter:h??0});}

const FULL_W=15398;
const DOCX_W={
  summary:[3200,12198],
  noon:[4000,3800,3800,3798],
  route:[2800,2400,2400,1600,1800,2200,2198],
  bunker:[3398,2400,2400,2400,2400,2400],
  eca:[1700,1300,1700,2400,1600,1400,5298],
  totals:[5132,5133,5133],
  tankCond:[4598,2400,2800,2800,2800],
};

function buildDocxContent(){
  const body=[];
  const genOn=new Date().toISOString().slice(0,16).replace('T',' ');
  body.push(dPara([dRun('Bunker Pilot — Voyage Plan Report',{bold:true,size:36})],{align:'center',spacingAfter:60}));
  body.push(dPara([dRun(`${state.meta.vesselName||'Vessel'}${state.meta.voyageNo?' · '+state.meta.voyageNo:''}`,{bold:true,size:24})],{align:'center',spacingAfter:40}));
  body.push(dPara([dRun(`Generated ${genOn} UTC`,{italic:true,color:'666666',size:18})],{align:'center',spacingAfter:200}));

  // Voyage summary
  body.push(dHeading('Voyage Summary',1,{keepNext:true}));
  const alertCount=buildAlertItems().length;
  body.push(dTable(['Field','Value'],[
    ['Vessel',state.meta.vesselName||'—'],
    ['Voyage / passage no.',state.meta.voyageNo||'—'],
    ['Date of noon report entry (Local time)',state.meta.noonLocal?`${state.meta.noonLocal.replace('T',' ')} (${utcOffsetLabel(n(state.meta.posUtcOffset))})`:'—'],
    ['Present position',state.meta.currentPosition||'—'],
    ['Planned voyage duration',daysHours(calc.totals.totalVoyageDays)],
    ['Number of ports',String(calc.results.length)],
    ['Planning alerts',String(alertCount)],
  ],DOCX_W.summary));
  body.push(dSpace(160));

  // Logbook ROB vs actual ROB
  body.push(dHeading('Logbook ROB vs Actual Tank ROB',1,{keepNext:true}));
  const PRODUCTS=[{id:'fo',label:'Fuel Oil'},{id:'do',label:'Diesel Oil'},{id:'cyl',label:'Cylinder Oil'},{id:'mesys',label:'ME System Oil'},{id:'gesys',label:'GE System Oil'}];
  const nr=state.meta.noonRob||{};
  const noonRows=PRODUCTS.map(p=>{
    const unit=unitFor(p.id),noon=Math.max(0,n(nr[p.id])),actual=groupRob(state.tanks,p.id),delta=actual-noon;
    return [p.label,fmtQty(noon,unit),fmtQty(actual,unit),(delta>=0?'+':'−')+fmtQty(Math.abs(delta),unit)];
  });
  body.push(dTable(['Product','Logbook ROB','Actual (tanks)','Difference'],noonRows,DOCX_W.noon));
  body.push(dSpace(160));

  // Route summary
  body.push(dHeading('Route Summary',1,{keepNext:true}));
  const routeRows=calc.results.map(r=>[
    r.port||`Port ${r.index+1}`,
    fmtDate(r.arrivalUtc,r.utcOffset),
    fmtDate(r.departureUtc,r.utcOffset),
    daysHours(r.seaDays),
    `${Math.floor(n(r.portStayDays))} d ${n(r.portStayHours)} h`,
    n(r.distanceNm).toFixed(1),
    n(r.speedKn).toFixed(1),
  ]);
  body.push(dTable(['Port','ETA (local)','ETD (local)','Sea time','Port stay','Distance (NM)','Speed (kn)'],routeRows,DOCX_W.route));
  body.push(dSpace(160));

  // Bunkering requirements
  body.push(dHeading('Bunkering Requirements',1,{keepNext:true}));
  const bunkerRows=[];
  calc.results.forEach(r=>{
    const fo=Math.max(0,n(r.fuelStatus?.fo?.bunkerRequiredNow)),doo=Math.max(0,n(r.fuelStatus?.do?.bunkerRequiredNow));
    const cyl=Math.max(0,n(r.bunkerInfo?.cyl?.quantity)),mesys=Math.max(0,n(r.bunkerInfo?.mesys?.quantity)),gesys=Math.max(0,n(r.bunkerInfo?.gesys?.quantity));
    if(fo<0.005&&doo<0.005&&cyl<0.005&&mesys<0.005&&gesys<0.005)return;
    bunkerRows.push([r.port||`Port ${r.index+1}`,fo>0.005?fmtQty(fo,'MT'):'—',doo>0.005?fmtQty(doo,'MT'):'—',cyl>0.005?fmtQty(cyl,'L'):'—',mesys>0.005?fmtQty(mesys,'L'):'—',gesys>0.005?fmtQty(gesys,'L'):'—']);
  });
  if(bunkerRows.length)body.push(dTable(['Port','Fuel','Diesel','Cylinder oil','ME system oil','GE system oil'],bunkerRows,DOCX_W.bunker));
  else body.push(dPara('No fuel, diesel or lube-oil bunkering is required or planned anywhere in this voyage.',{italic:true}));
  body.push(dSpace(160));

  // ECA/SECA
  const ecaRows=[];
  state.route.forEach((r,i)=>{
    const c=calc.results[i];if(!c)return;
    ['entering','leaving'].forEach(dir=>{
      const cfg=r.eca?.[dir];if(!cfg?.enabled)return;
      const scrubber=(cfg.method||'fuel')==='scrubber';
      const f=ecaFuels(cfg,dir,i),sr=ecaSystemResults(dir,cfg,i);
      const li=ecaLegInfo(dir,i);let when='';
      if(li&&sr.planning!==null){if(dir==='entering'){const tg=li.lineMs-Math.max(0,n(cfg.marginHours))*3600000;when=`Start ${fmtDate(iso(tg-sr.planning*3600000),c.utcOffset)}, line ${fmtDate(iso(li.lineMs),c.utcOffset)} (local)`;}else when=`Line ${fmtDate(iso(li.lineMs),c.utcOffset)}, done ${fmtDate(iso(li.lineMs+sr.planning*3600000),c.utcOffset)} (local)`;}
      ecaRows.push([r.port||`Port ${i+1}`,dir==='entering'?'Entering':'Leaving',scrubber?'Scrubber (EGCS)':'Fuel changeover',`${ecaFuelLabel(f.from)} > ${ecaFuelLabel(f.to)}`,li?`${(dir==='entering'?li.inNm:li.exitNm).toFixed(0)}`:'',sr.planning!==null?fmtH(sr.planning):'',when]);
    });
  });
  if(ecaRows.length){
    body.push(dHeading('ECA / SECA Changeovers',1,{keepNext:true}));
    body.push(dTable(['Port','Direction','Method','Fuel change','ECA line distance (NM)','Planning time','Timing'],ecaRows,DOCX_W.eca));
    body.push(dSpace(160));
  }

  // Consumption totals
  body.push(dHeading('Consumption Totals',1,{keepNext:true}));
  const totalRows=[...state.fuels,...state.lubes].map(p=>[p.name,fmtQty(calc.totals.consumption[p.id]||0,p.unit),fmtQty(calc.totals.bunker[p.id]||0,p.unit)]);
  body.push(dTable(['Fuel / lubricant','Total consumption','Total bunkering'],totalRows,DOCX_W.totals));
  body.push(dSpace(160));

  // Alerts
  body.push(dHeading('Planning Alerts',1,{keepNext:true}));
  const alertTexts=buildAlertPlainText();
  if(alertTexts.length)alertTexts.forEach((t,i)=>body.push(dPara(`${i+1}. ${t}`,{spacingAfter:40})));
  else body.push(dPara('No shortages, capacity conflicts or below-reserve fuel departures detected from the current inputs.',{italic:true}));

  // Per-port tank condition — page break before this section
  body.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
  body.push(dHeading('Tank Condition — ROB at ETA / ETD, by Port',1));
  calc.results.forEach((r,i)=>{
    body.push(dHeading(`Port ${i+1} — ${r.port||`Port ${i+1}`}`,2,{keepNext:true}));
    body.push(dPara(`ETA ${fmtDate(r.arrivalUtc,r.utcOffset)} local (${fmtUTC(r.arrivalUtc)})  ·  ETD ${fmtDate(r.departureUtc,r.utcOffset)} local (${fmtUTC(r.departureUtc)})`,{italic:true,spacingAfter:80}));
    const rows=(r.tankAfter||[]).map(t=>{
      const at=(r.tankAtArrival||[]).find(x=>x.id===t.id)||t,unit=unitFor(t.group);
      return [t.name,groupLabel(t.group),fmtQty(t.capacity,unit),fmtQty(at.rob,unit),fmtQty(t.rob,unit)];
    });
    if(rows.length)body.push(dTable(['Tank','Group','Capacity','ROB @ ETA','ROB @ ETD'],rows,DOCX_W.tankCond));
    else body.push(dPara('No tanks configured.',{italic:true}));
    body.push(dSpace(140));
  });

  /* v1.62 — Plan a bunkering: the plan last worked out in the pop-up (recalculated from the current data) */
  if(pb.sel!==''){
    const plan=pbCompute();
    if(plan&&plan.ok){
      body.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
      body.push(dPara([dRun(`Plan a Bunkering — ${plan.port.name}`,{bold:true,size:30})],{spacingAfter:100}));
      body.push(...pbDocxSections(plan));
    }
  }
  return body.join('');
}

function buildAlertPlainText(){return buildAlertItems().map(h=>h.replace(/<[^>]+>/g,'').trim());}

/* Landscape A4 document around a body built from dPara / dHeading / dTable (voyage report, bunkering plan). */
function docxWrap(bodyXml){return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${bodyXml}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;}
function docxFiles(documentXmlOverride){
  const documentXml=documentXmlOverride||docxWrap(buildDocxContent());
  const stylesXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="147D92"/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;
  const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rootRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const files=[
    {name:'[Content_Types].xml',data:contentTypes},
    {name:'_rels/.rels',data:rootRels},
    {name:'word/document.xml',data:documentXml},
    {name:'word/_rels/document.xml.rels',data:docRels},
    {name:'word/styles.xml',data:stylesXml},
  ];
  return files;
}
function buildDocxBytes(documentXmlOverride){return zipStore(docxFiles(documentXmlOverride));}
/* same package, with the XML parts deflated when the browser can (document.xml of the printed forms is ~0.5 MB per page uncompressed) */
async function buildDocxBytesZ(documentXmlOverride){
  const files=docxFiles(documentXmlOverride),enc=new TextEncoder();
  for(const f of files){
    const data=typeof f.data==='string'?enc.encode(f.data):f.data;
    if(data.length<1024)continue;
    const z=await deflateRaw(data);if(z&&z.length<data.length)f.deflated=z;
  }
  return zipStore(files);
}
/* Default file name for saved reports: "Bunker Pilot - <vessel name> - <date>" (date = day of saving, local). */
function reportFileBase(){
  const clean=v=>String(v||'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
  const d=new Date(),pad=x=>String(x).padStart(2,'0');
  return `Bunker Pilot - ${clean(state.meta.vesselName)||'Vessel'} - ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
/* v1.59 — Bunker/Internal Transfer Plan & Result (form S-082000-03FRM): one page per port with planned fuel / diesel bunkering.
   Filled from the plan: vessel, port, local ETA date, FO/DO storage tanks (capacity, filling limit = the company max fill, present and
   estimated-after condition) and the planned quantities. Sulphur of the bunker comes from the bunker event on the Bunkering tab.
   Soundings, BDN figures, times, rates, sequence and all "after bunkering" results stay blank to write in. */
async function exportBunkerForm(){
  const limitPct=Math.round(bunkerFillFrac()*1000)/10;
  const pages=calc.results.map(r=>bfPageFromStop(r,{vessel:state.meta.vesselName,limitPct,sulphur:(g)=>{const s=sulphurOf(state.route[r.index]?.bunkers?.[g]?.sulphur);return s===null?undefined:s;}})).filter(Boolean);
  if(!pages.length){alert('No fuel or diesel bunkering is planned at any port. Add a fuel or diesel bunker on the Bunkering tab first.');return;}
  downloadBytes(reportFileBase().replace(/^Bunker Pilot/,'Bunkering Plan Form')+'.docx',await buildDocxBytesZ(bfFormsDocumentXml(pages)),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const noDen=[...new Set(pages.flatMap(p=>p.missingDensity||[]))];
  if(noDen.length)alert('Bunkering plan form exported.\n\nNo density is entered for: '+noDen.join(', ')+'.\nTheir capacity and volume cells are left blank (quantities in MT are filled), and TOTAL capacity leaves them out. Enter the density on the Tanks tab and export again to include them.');
}
/* v1.57 — Lub. Oil Replenishment Plan and Result Record (form S-082001-02FRM): one page per port with planned lube-oil
   replenishment or drum pump-over. Plan cells are filled from the calculation; gauges, work times and actual results stay blank. */
async function exportLubeForm(){
  const pages=calc.results.map(r=>lfPageFromStop(r,state.lubes,groupLabel)).filter(Boolean);
  if(!pages.length){alert('No lube-oil replenishment is planned at any port. Add a lube-oil bunker (or a drum pump-over) on the Bunkering tab first.');return;}
  downloadBytes(reportFileBase().replace(/^Bunker Pilot/,'Lub Oil Replenishment Form')+'.docx',await buildDocxBytesZ(lfFormsDocumentXml(pages)),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
async function exportDocx(){
  downloadBytes(reportFileBase()+'.docx',await buildDocxBytesZ(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}



/* =============================================================================================
   v1.62 — "Plan a bunkering" (Home button). The calculation lives in bunkerplan.js; this block is the pop-up and the Word export.
   The user picks any port: one already on the route, or any other port with its arrival date/time. The pop-up recalculates live
   and lists, per product and per tank, what to take, with the port, ETA/ETD and the figures behind it. Nothing is written to the plan.
   ============================================================================================= */
const pb={sel:'',name:'',wall:'',offset:0,stay:12,until:'end',margin:0,fill:false,plan:null,grade:{},sul:{},ov:{}};
const PB_STATUS={
  critical:{cls:'bad',text:'ROB runs out before this port — bunkering is needed earlier'},
  limited:{cls:'warn',text:'The tanks cannot take the full requirement at this port'},
  needed:{cls:'ok',text:'Bunkering is required at this port'},
  none:{cls:'ok',text:'No bunkering needed here — ROB covers the voyage plus reserve'}
};
function pbDefaultPortIndex(){
  const from=Math.max(0,activePosition().index);
  for(let i=from;i<calc.results.length;i++){if(['fo','do'].some(id=>n(calc.results[i].fuelStatus?.[id]?.bunkerRequiredNow)>0.005))return i;}
  return Math.min(Math.max(0,from),Math.max(0,calc.results.length-1));
}
function pbFillPortSelect(){
  const sel=$('#pbPort');if(!sel)return;
  sel.innerHTML=calc.results.map((r,i)=>`<option value="${i}">${i+1} · ${esc(r.port)} — ETA ${esc(fmtDate(r.arrivalUtc,r.utcOffset))}</option>`).join('')+'<option value="other">Other port / date…</option>';
  sel.value=String(pb.sel);
  const off=$('#pbOffset');if(off&&!off.options.length)off.innerHTML=UTC_OFFSETS.map(o=>`<option value="${o}">${utcOffsetLabel(o)}</option>`).join('');
}
function pbFillUntil(){
  const sel=$('#pbUntil');if(!sel)return;
  let from=-1;
  if(pb.sel==='other'){const T=Date.parse(wallToIso(pb.wall,pb.offset));from=Number.isFinite(T)?calc.results.reduce((k,r,i)=>Date.parse(r.arrivalUtc)<=T?i:k,-1):-1;}
  else from=Number(pb.sel);
  const opts=['<option value="end">End of the voyage (last port, incl. its stay)</option>'];
  for(let j=from+1;j<calc.results.length;j++)opts.push(`<option value="${j}">Arrival at ${esc(calc.results[j].port)}</option>`);
  sel.innerHTML=opts.join('');
  if(![...sel.options].some(o=>o.value===String(pb.until)))pb.until='end';
  sel.value=String(pb.until);
}
function pbSyncForm(){
  const other=pb.sel==='other';
  $$('#planBunkerModal .pb-other').forEach(el=>{el.hidden=!other;});
  $('#pbPort').value=String(pb.sel);$('#pbName').value=pb.name;$('#pbWall').value=pb.wall;$('#pbOffset').value=String(UTC_OFFSETS.find(o=>Math.abs(o-n(pb.offset))<0.01)??0);$('#pbStay').value=String(pb.stay);
  $('#pbMargin').value=pb.margin?String(pb.margin):'';$('#pbFill').checked=!!pb.fill;$('#pbFillPct').textContent=String(Math.round(bunkerFillFrac()*1000)/10);
  pbFillUntil();
}
function pbSpec(){
  if(pb.sel==='other')return{name:pb.name.trim()||'Bunkering port',etaUtc:wallToIso(pb.wall,pb.offset),stayHours:Math.max(0,n(pb.stay)),utcOffset:n(pb.offset)};
  return{routeIndex:Number(pb.sel)};
}
function pbOptions(){return{marginPct:Math.max(0,n(pb.margin)),fillToMax:!!pb.fill,untilIndex:pb.until==='end'?null:Number(pb.until),fuelTypes:Object.fromEntries(Object.entries(pb.grade).filter(([,v])=>v)),bunkerSulphur:pb.sul,overrides:Object.keys(pb.ov).length?pb.ov:null};}
function pbCompute(spec=pbSpec(),opts=pbOptions()){
  if(!calc.results.length||!state.tanks.length)return{ok:false,error:!calc.results.length?'Add the ports of the voyage on the Ports tab first.':'Add your tanks on the Tanks tab first.'};
  return planBunkering(state,spec,opts);
}
function pbRun(){pb.plan=pbCompute();pbRender();pbRenderCompare();}
/* Compare ports: the same settings (grade, sulphur, margin, fill) at every port of the route, side by side. */
function pbRenderCompare(){
  const box=$('#pbCompare'),det=$('#pbCompareBox');if(!box||!det||!det.open)return;
  if(!calc.results.length||!state.tanks.length){box.innerHTML='<div class="pb-empty">Add ports and tanks first.</div>';return;}
  const o={...pbOptions(),overrides:null,untilIndex:null},prods=[...state.fuels,...state.lubes].map(p=>p.id);
  const rows=calc.results.map((r,i)=>{
    const pl=planBunkering(state,{routeIndex:i},o);if(!pl.ok)return'';
    const st=PB_STATUS[pl.status]||PB_STATUS.none,cur=pb.sel===String(i);
    return `<tr class="${cur?'pb-cur':''}"><th scope="row">${i+1} · ${esc(r.port)}<small>ETA ${esc(fmtDate(r.arrivalUtc,r.utcOffset))}</small></th>${prods.map(id=>{const p=pl.products.find(x=>x.id===id);return `<td class="${p&&p.suggested>0.005?'pb-qty':''}">${p?esc(p.suggested>0.005?fmtN(p.suggested,p.unit):'—'):'—'}</td>`;}).join('')}<td><span class="pb-status ${st.cls}">${esc(pl.status==='critical'?'Too late':pl.status==='limited'?'Limited':pl.status==='needed'?'Needed':'Not needed')}</span></td><td><button type="button" class="ghost sm" data-pb-choose="${i}"${cur?' disabled':''}>${cur?'Selected':'Choose'}</button></td></tr>`;
  }).join('');
  const heads=prods.map(id=>`<th>${esc(PRODUCT_SHORT[id]||id)} (${esc(unitFor(id))})</th>`).join('');
  box.innerHTML=`<p class="muted pb-cmp-note">Quantity to bunker at each port if you bunker there (covering the rest of the voyage plus reserve, ignoring bunkering already entered for that port).</p><div class="pb-table-wrap"><table class="pb-table pb-cmp"><thead><tr><th>Port</th>${heads}<th>Result</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
const PRODUCT_SHORT={fo:'Fuel',do:'Diesel',cyl:'Cyl. oil',mesys:'ME sys.',gesys:'GE sys.'};
const pbDays=v=>v===null||v===undefined?'—':n(v)>365?'> 365 d':`${n(v).toFixed(1)} d`;
const pbPct=v=>v===null||v===undefined?'—':`${n(v).toFixed(1)} %`;
function pbRender(){
  const box=$('#pbResults'),exp=$('#pbExport'),plan=pb.plan;if(!box)return;
  if(exp)exp.disabled=!(plan&&plan.ok);
  const ap=$('#pbApply');if(ap){const okApply=!!(plan&&plan.ok&&plan.port.routeIndex!==null&&plan.products.some(p=>p.suggested>0.005));ap.disabled=!okApply;ap.title=!plan||!plan.ok?'':plan.port.routeIndex===null?'This port is not on the Ports tab. Add it to the route first to use the plan on the Bunkering tab.':okApply?'Write these quantities into the Bunkering tab for this port':'Nothing to bunker';}
  if(!plan||!plan.ok){box.innerHTML=`<div class="pb-empty">${esc(plan&&plan.error||'Choose a port.')}</div>`;return;}
  const P=plan.port,st=PB_STATUS[plan.status]||PB_STATUS.none;
  let h=`<div class="pb-head"><div><strong class="pb-port">${esc(P.name)}</strong>${P.inserted?'<span class="pflag pf-chip-eca">not on route</span>':''}</div><span class="pb-status ${st.cls}">${esc(st.text)}</span></div>
  <div class="pb-meta"><span><b>ETA</b> ${esc(fmtDate(P.etaUtc,P.utcOffset))} local <small>(${esc(fmtUTC(P.etaUtc))})</small></span><span><b>ETD</b> ${esc(fmtDate(P.etdUtc,P.utcOffset))} local <small>(${esc(fmtUTC(P.etdUtc))})</small></span><span><b>Port stay</b> ${esc(daysHours(P.stayHours/24))}</span>${P.nextPort?`<span><b>Next port</b> ${esc(P.nextPort)} · ETA ${esc(fmtDate(P.nextEtaUtc,n((calc.results.find(r=>r.port===P.nextPort)||{}).utcOffset)))} local</span>`:''}<span><b>Covers</b> ${esc(plan.basis.coverUntil)} + reserve</span><span><b>Max fill</b> ${esc(String(plan.basis.maxFillPct))} %</span></div>`;
  if(plan.warnings.length)h+=`<ul class="pb-warn">${plan.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`;
  for(const p of plan.products){
    const u=p.unit,cls=p.status==='limited'?'warn':p.required>0.005?'need':'none';
    const figs=[['ROB at ETA',p.robArrival],['ROB at ETD (before bunkering)',p.robDeparture],['Consumption ahead',p.futureConsumption],['Reserve',p.reserve],['Unpumpable',p.unpumpable],['Later planned bunkering',p.futureBunkers],['Required',p.required],['Max receivable',p.maxReceivable],['ROB at ETD after bunkering',p.robDepartureAfter]];
    const fig=figs.map(([l,v])=>`<div><span>${esc(l)}</span><strong>${esc(fmtQty(v,u))}</strong></div>`).join('')+(p.enduranceDays!==null&&p.enduranceDays!==undefined?`<div><span>Endurance after bunkering</span><strong>${esc(pbDays(p.enduranceDays))}</strong></div>`:'');
    const rows=p.tanks.map(t=>`<tr class="${t.eligible?(t.qty>0.005?'pb-load':''):'pb-skip'}"><th scope="row">${esc(t.name)}<small>${esc(t.eligible?(p.isFuel?fuelTypeLabel(p.id,t.fuelType):''):t.reason)}</small></th><td>${esc(fmtN(t.robArrival,u))}</td><td class="pb-qty">${t.eligible?`<input class="pb-tq" type="number" inputmode="decimal" min="0" step="${u==='L'?'10':'0.01'}" value="${esc(String(Math.round(t.qty*100)/100))}" data-pb-prod="${esc(p.id)}" data-pb-tank="${esc(t.id)}" aria-label="Quantity to load in ${esc(t.name)}">`:'—'}</td><td>${t.eligible?esc(fmtN(t.afterLoading,u)):'—'}</td><td>${t.eligible?esc(pbPct(t.pctAfter)):'—'}</td>${p.isFuel?`<td>${t.qtyM3!==null&&t.eligible?esc(t.qtyM3.toFixed(1)):'—'}</td>`:''}</tr>`).join('');
    h+=`<section class="pb-prod ${cls}"><header><h4>${esc(p.label)}${p.fuelType?`<small>${esc(fuelTypeLabel(p.id,p.fuelType))}</small>`:''}</h4><div class="pb-big"><span>To bunker</span><strong>${esc(fmtQty(p.suggested,u))}</strong></div></header>
    ${pbOptsHtml(p)}<div class="pb-figs">${fig}</div>
    <div class="pb-table-wrap"><table class="pb-table"><thead><tr><th>Tank</th><th>ROB at ETA</th><th>Load (${esc(u)})</th><th>After loading</th><th>% of cap.</th>${p.isFuel?'<th>Load (m³)</th>':''}</tr></thead><tbody>${rows||`<tr><td colspan="6" class="muted">No consumable tanks for this product.</td></tr>`}</tbody></table></div></section>`;
  }
  box.innerHTML=h;
}
function pbOptsHtml(p){
  const opts=fuelTypeOptions(p.id);let h='';
  if(opts){
    const cur=p.fuelType||'',list=opts.some(o=>o.value===cur)||!cur?opts:[...opts,{value:cur,label:fuelTypeLabel(p.id,cur)}];
    h+=`<label>Grade<select data-pb-grade="${esc(p.id)}">${list.map(o=>`<option value="${esc(o.value)}"${o.value===cur?' selected':''}>${esc(o.label)}</option>`).join('')}</select></label><label>Bunker sulphur (% m/m)<input type="number" inputmode="decimal" step="0.001" min="0" data-pb-sul="${esc(p.id)}" value="${esc(String(p.bunkerSulphur??''))}" placeholder="${esc(sulPlaceholder(cur))}"></label>`;
  }
  if(p.manual)h+=`<button type="button" class="ghost sm" data-pb-reset="${esc(p.id)}">Reset to automatic</button>`;
  return h?`<div class="pb-opts">${h}</div>`:'';
}
function applyPlanBunker(){
  const plan=pb.plan;if(!plan||!plan.ok||plan.port.routeIndex===null)return;
  const ri=plan.port.routeIndex,r=state.route[ri],items=plan.products.filter(p=>p.suggested>0.005);
  if(!r||!items.length)return;
  const had=items.filter(p=>evQty(r.bunkers?.[p.id])>0).map(p=>p.label);
  if(!confirm(`Write this plan into the Bunkering tab for ${plan.port.name}?\n\n`+items.map(p=>`${p.label}: ${fmtQty(p.suggested,p.unit)}`).join('\n')+(had.length?`\n\nThis replaces the bunkering already entered there for: ${had.join(', ')}.`:'')))return;
  r.bunkers ||= {};
  for(const p of items){
    const old=r.bunkers[p.id]||{},allocs=p.tanks.filter(t=>t.qty>0.005).map(t=>({tankId:t.id,quantity:Math.round(t.qty*100)/100})),ev={...old,quantity:Math.round(sumAllocations(allocs)*100)/100,entryMode:'tanks',autoAllocate:false,allocations:allocs};
    if(p.isFuel){ev.fuelType=p.fuelType;if(p.bunkerSulphur!==''&&p.bunkerSulphur!==undefined)ev.sulphur=p.bunkerSulphur;}else ev.mode='bulk';
    r.bunkers[p.id]=ev;
  }
  $('#planBunkerModal').hidden=true;
  rerun();showTab('bunkering');window.scrollTo({top:0});
}
function pbOpen(){
  if(!pb.sel||(pb.sel!=='other'&&Number(pb.sel)>=calc.results.length))pb.sel=String(pbDefaultPortIndex());
  if(!calc.results.length)pb.sel='other';
  if(!pb.wall){pb.offset=devOffset();pb.wall=nowWall(pb.offset);}
  pbFillPortSelect();pbSyncForm();pbRun();
  $('#planBunkerModal').hidden=false;
}
function initPlanBunker(){
  const btn=$('#planBunkerBtn'),modal=$('#planBunkerModal');if(!btn||!modal)return;
  btn.addEventListener('click',pbOpen);
  const upd=(fn,refreshUntil=false)=>()=>{fn();pb.ov={};if(refreshUntil)pbFillUntil();pbRun();};
  $('#pbPort').addEventListener('change',()=>{
    const v=$('#pbPort').value;
    if(v==='other'&&pb.sel!=='other'&&!pb.wallTouched){const r=calc.results[Number(pb.sel)];if(r){pb.offset=n(r.utcOffset);pb.wall=fmtDate(r.arrivalUtc,r.utcOffset).replace(' ','T');}}
    pb.sel=v;pb.until='end';pb.ov={};pbSyncForm();pbRun();});
  $('#pbName').addEventListener('change',()=>{pb.name=$('#pbName').value;pb.ov={};const o=portUtcOffset(pb.name,pb.wall);if(o!==null){pb.offset=o;$('#pbOffset').value=String(UTC_OFFSETS.find(x=>Math.abs(x-o)<0.01)??0);}pbFillUntil();pbRun();});
  $('#pbWall').addEventListener('change',upd(()=>{pb.wall=$('#pbWall').value;pb.wallTouched=true;const o=portUtcOffset(pb.name,pb.wall);if(o!==null){pb.offset=o;$('#pbOffset').value=String(UTC_OFFSETS.find(x=>Math.abs(x-o)<0.01)??0);}},true));
  $('#pbOffset').addEventListener('change',upd(()=>{pb.offset=n($('#pbOffset').value);},true));
  $('#pbStay').addEventListener('input',upd(()=>{pb.stay=$('#pbStay').value;}));
  $('#pbUntil').addEventListener('change',upd(()=>{pb.until=$('#pbUntil').value;}));
  $('#pbMargin').addEventListener('input',upd(()=>{pb.margin=$('#pbMargin').value;}));
  $('#pbFill').addEventListener('change',upd(()=>{pb.fill=$('#pbFill').checked;}));
  $('#pbExport').addEventListener('click',exportPlanBunker);
  $('#pbApply').addEventListener('click',applyPlanBunker);
  $('#pbCompareBox').addEventListener('toggle',pbRenderCompare);
  $('#pbCompare').addEventListener('click',e=>{const b=e.target.closest('[data-pb-choose]');if(!b)return;pb.sel=b.dataset.pbChoose;pb.until='end';pb.ov={};pbSyncForm();pbRun();$('#pbResults').scrollIntoView({behavior:'smooth',block:'start'});});
  const res=$('#pbResults');
  res.addEventListener('change',e=>{
    const t=e.target;
    if(t.dataset.pbGrade){pb.grade[t.dataset.pbGrade]=t.value;delete pb.ov[t.dataset.pbGrade];pbRun();}
    else if(t.dataset.pbSul!==undefined){pb.sul[t.dataset.pbSul]=t.value;pbRun();}
    else if(t.dataset.pbTank){
      const pid=t.dataset.pbProd,prod=pb.plan&&pb.plan.ok&&pb.plan.products.find(x=>x.id===pid);if(!prod)return;
      const snap=Object.fromEntries(prod.tanks.map(k=>[k.id,k.qty]));snap[t.dataset.pbTank]=Math.max(0,n(t.value));pb.ov[pid]=snap;pbRun();
    }
  });
  res.addEventListener('click',e=>{const b=e.target.closest('[data-pb-reset]');if(b){delete pb.ov[b.dataset.pbReset];pbRun();}});
}
/* ---- Word export of the plan ---- */
const PB_W={summary:[3600,11798],products:[2100,1100,1200,1400,1400,1400,1300,1300,1300,1400,1498],tanks:[3000,1300,1400,1400,1400,1500,1300,1400,1100,1598]};
function pbDocxBody(plan){
  const P=plan.port,body=[],vessel=state.meta.vesselName||'Vessel',genOn=new Date().toISOString().slice(0,16).replace('T',' ');
  const st=(PB_STATUS[plan.status]||PB_STATUS.none).text;
  body.push(dPara([dRun('Bunker Pilot — Bunkering Plan',{bold:true,size:36})],{align:'center',spacingAfter:60}));
  body.push(dPara([dRun(`${vessel}${state.meta.voyageNo?' · '+state.meta.voyageNo:''} · ${P.name}`,{bold:true,size:24})],{align:'center',spacingAfter:40}));
  body.push(dPara([dRun(`Generated ${genOn} UTC`,{italic:true,color:'666666',size:18})],{align:'center',spacingAfter:200}));
  body.push(...pbDocxSections(plan));
  return body.join('');
}
function pbDocxSections(plan){
  const P=plan.port,body=[],vessel=state.meta.vesselName||'Vessel';
  const st=(PB_STATUS[plan.status]||PB_STATUS.none).text;
  body.push(dHeading('Bunkering Port',1,{keepNext:true}));
  const order=plan.products.map(p=>`${p.label}${p.fuelType?' ('+fuelTypeLabel(p.id,p.fuelType)+')':''}: ${fmtQty(p.suggested,p.unit)}`).join('   ·   ');
  body.push(dTable(['Field','Value'],[
    ['Vessel',vessel],['Voyage / passage no.',state.meta.voyageNo||'—'],['Bunkering port',P.name+(P.inserted?' (not on the planned route — position taken along the voyage)':'')],
    ['ETA (local)',`${fmtDate(P.etaUtc,P.utcOffset)}  ${utcOffsetLabel(n(P.utcOffset))}   (${fmtUTC(P.etaUtc)})`],['ETD (local)',`${fmtDate(P.etdUtc,P.utcOffset)}  ${utcOffsetLabel(n(P.utcOffset))}   (${fmtUTC(P.etdUtc)})`],
    ['Port stay',daysHours(P.stayHours/24)],['Next port',P.nextPort?`${P.nextPort} · ETA ${fmtDate(P.nextEtaUtc,n((calc.results.find(r=>r.port===P.nextPort)||{}).utcOffset))} local`:'— (last port)'],
    ['Quantity covers',`${plan.basis.coverUntil} + reserve + unpumpable`],['Maximum tank fill',`${plan.basis.maxFillPct} %`],['Extra margin',`${plan.basis.marginPct||0} %${plan.basis.fillToMax?' (filled to maximum fill)':''}`],
    ['Result',st],['Quantities to bunker',order],
  ],PB_W.summary));
  body.push(dSpace(160));
  body.push(dHeading('Bunker Required — Summary',1,{keepNext:true}));
  body.push(dTable(['Product','Grade','ROB @ ETA','ROB @ ETD (before bunkering)','Consumption ahead','Reserve + unpumpable','Required','To bunker','Max receivable','ROB @ ETD (after)','Endurance (days)'],
    plan.products.map(p=>[p.label,p.fuelType?fuelTypeLabel(p.id,p.fuelType):'—',fmtQty(p.robArrival,p.unit),fmtQty(p.robDeparture,p.unit),fmtQty(p.futureConsumption,p.unit),fmtQty(p.reserve+p.unpumpable,p.unit),fmtQty(p.required,p.unit),fmtQty(p.suggested,p.unit),fmtQty(p.maxReceivable,p.unit),fmtQty(p.robDepartureAfter,p.unit),p.enduranceDays===null||p.enduranceDays===undefined?'—':n(p.enduranceDays)>365?'> 365':n(p.enduranceDays).toFixed(1)]),PB_W.products));
  body.push(dSpace(120));
  body.push(dHeading('Tank by Tank',1,{keepNext:true}));
  for(const p of plan.products){
    body.push(dHeading(`${p.label}${p.fuelType?' — '+fuelTypeLabel(p.id,p.fuelType):''}`,2,{keepNext:true}));
    if(!p.tanks.length){body.push(dPara('No consumable tanks configured for this product.',{italic:true}));continue;}
    if(p.suggested<=0.005)body.push(dPara(p.required>0.005?'Nothing can be loaded into the tanks listed below (see remarks).':'No bunkering required for this product at this port.',{italic:true,spacingAfter:60}));
    body.push(dTable(['Tank','Fuel type','Capacity','Max-fill limit','ROB @ ETA','Quantity to load','Volume (m³)','After loading','% of capacity','Remarks'],
      p.tanks.map(t=>[t.name,t.fuelType?fuelTypeLabel(p.id,t.fuelType):'—',fmtQty(t.capacity,p.unit),t.eligible?fmtQty(t.fillLimit,p.unit):'—',fmtQty(t.robArrival,p.unit),t.eligible?fmtQty(t.qty,p.unit):'—',t.qtyM3!==null&&t.eligible?t.qtyM3.toFixed(1):'—',t.eligible?fmtQty(t.afterLoading,p.unit):'—',t.eligible?pbPct(t.pctAfter):'—',t.eligible?(t.qty>0.005?'Load':'—'):t.reason]),PB_W.tanks));
    body.push(dSpace(100));
  }
  body.push(dHeading('Planning Notes',1,{keepNext:true}));
  const notes=plan.warnings.length?plan.warnings:['No warnings.'];
  notes.forEach((t,i)=>body.push(dPara(`${plan.warnings.length?i+1+'. ':''}${t}`,{spacingAfter:40})));
  body.push(dSpace(80));
  body.push(dPara('Required = consumption to come + reserve + unpumpable quantity − ROB at ETD (before bunkering) − later planned bunkering. The quantity to bunker is the requirement plus any margin, rounded up, and never more than the tanks can take at the maximum fill. Tanks are filled in consumption order; VLSFO is only loaded into tanks holding no old VLSFO. Planning figures from the values entered in Bunker Pilot — verify against actual soundings, tank calibration, BDN, maker instructions and company procedures.',{italic:true,color:'666666',size:18}));
  return body.join('');
}
async function exportPlanBunker(){
  const plan=pb.plan;if(!plan||!plan.ok)return;
  const clean=v=>String(v||'').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
  const name=`Bunkering Plan - ${clean(plan.port.name)||'Port'} - ${reportFileBase().replace(/^Bunker Pilot - /,'')}.docx`;
  downloadBytes(name,await buildDocxBytesZ(docxWrap(pbDocxBody(plan))),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

const TOUR_STEPS=[
  {tab:'setup',sel:'#vesselName',title:'1 · Name your vessel',text:'Start here — enter the vessel name. It appears on the dashboard.'},
  {tab:'tanks',sel:'#noonLocal',title:'2 · Enter the noon report date & Logbook ROB',text:'Enter the local date/time of the noon report (or tap Today · 12:00 local; the UTC offset beside Present position converts it), then the reported ROB figures below it. Every ETA/ETD is calculated from this point, so the date and figures must match the logbook / noon report. Important: the noon report is kept only with your saved voyage — after entering it, remember to save the voyage (last step) so it is not lost.'},
  {tab:'setup',sel:'#ratesList',title:'3 · Set consumption rates',text:'For each fuel/lube: at-sea, in-port and at-anchor/drift rates, plus reserve days and reserve/day.'},
  {tab:'tanks',sel:'[data-add-tank]',title:'4 · Add your tanks',text:'Tap \"+ Tank\" under a group, choose its role and where it should sit in the list, then fill in capacity, present ROB and unpumpable quantity.'},
  {tab:'tanks',sel:'#tankList',fullScreen:true,title:'5 · Set tank details & update soundings',text:'Open a tank to set its consumption sequence, role (storage/settling/service/support) and — for settling/service tanks — which one is in service. Update the fields outlined in teal (density, corrected volume, observed temperature, or present ROB by weight) for every tank. Use the arrows on the right of the tank to move it up or down the list.'},
  {tab:'tanks',sel:'[data-tank-save]',title:'6 · Save the tank condition',text:'Important: after all tank data is entered, tap Save tank condition. Only a saved condition keeps the date, time and every tank’s density, volume, temperature and ROB as a record you can restore later. If you change any tank afterwards, the status below the button turns amber — save again to keep the new values.'},
  {tab:'tanks',sel:'#maxFillBar',title:'7 · Set your maximum tank fill',text:'Your company’s maximum storage in tanks (e.g. 85% or 90%) drives the proposed bunker / replenish quantity and the over-fill warning. Tap Change here any time.',onEnter:'maxfill'},
  {tab:'voyage',sel:'#addRouteInline',title:'8 · Build the route',text:'Tap \"Add port\" for each call: distance, speed, anchor/drift and port stay, and UTC offset.'},
  {tab:'bunkering',sel:'#bunkerList',title:'9 · Plan bunkering & lube oil',text:'For each port, record a planned fuel bunker or lube oil replenishment and preview the tank condition at ETA/ETD.'},
  {tab:'eca',sel:'#ecaList',title:'10 · ECA/SECA changeover',text:'If the voyage enters an Emission Control Area, plan the fuel changeover here — per system (Main Engine, Aux. Engine, Boiler), with planning time, start/finish and vessel position.'},
  {tab:'dashboard',sel:'#routeSummary',title:'11 · Review the dashboard',text:'See fuel/lube ROB and tank ROB at ETA/ETD. Tap any value to see how it was calculated. Planning alerts are under the bell icon in the top bar.'},
  {tab:'dashboard',sel:'#planBunkerBtn',title:'12 · Plan a bunkering',text:'Tap Plan a bunkering, choose any port on the route (or another port and arrival date) and the app works out how much fuel, diesel and lube oil to take, tank by tank. Change the grade or any tank quantity, export it to Word, or use it on the Bunkering tab.'},
  {tab:'results',sel:'#saveVoyageBtn',title:'13 · Save your work',text:'Important: save the voyage under a name. This keeps the noon report date and ROB, all tanks and the whole plan so you can reopen it anytime on this device. Save again after any later change to the noon report or tanks — together with Save tank condition, this is what protects your entries.'}
];
let tourIndex=-1;
function tourOverlayEls(){
  let ov=$('#tourOverlay');
  if(!ov){
    ov=document.createElement('div');ov.id='tourOverlay';ov.className='tour-overlay';
    ov.innerHTML=`<div class="tour-hole"></div><div class="tour-card"><div class="tour-head"><div class="tour-step-count"></div><button type="button" class="ghost sm tour-min" id="tourMin" aria-label="Minimize guide" aria-expanded="true" title="Minimize">–</button></div><h4 class="tour-title"></h4><p class="tour-text"></p><div class="tour-actions"><button type="button" class="ghost sm" id="tourSkip">Skip</button><span style="flex:1"></span><button type="button" class="secondary sm" id="tourPrev">Back</button><button type="button" class="primary sm" id="tourNext">Next</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#tourSkip').onclick=endTour;
    const setMin=m=>{ov.classList.toggle('min',m);const b=ov.querySelector('#tourMin');b.textContent=m?'▴':'–';b.setAttribute('aria-label',m?'Expand guide':'Minimize guide');b.setAttribute('aria-expanded',String(!m));b.title=m?'Expand':'Minimize';};
    ov.querySelector('#tourMin').onclick=e=>{e.stopPropagation();setMin(!ov.classList.contains('min'));};
    ov.querySelector('.tour-card').addEventListener('click',()=>{if(ov.classList.contains('min'))setMin(false);});
    ov.querySelector('#tourPrev').onclick=()=>gotoTourStep(tourIndex-1);
    ov.querySelector('#tourNext').onclick=()=>gotoTourStep(tourIndex+1);
  }
  return ov;
}
function endTour(){
  const ov=$('#tourOverlay');if(ov)ov.remove();
  document.querySelectorAll('.tour-target').forEach(el=>el.classList.remove('tour-target'));
  tourIndex=-1;
  try{localStorage.setItem('bunker-tour-seen','1');}catch{}
}
function positionTourCard(target,card,hole,fullScreen){
  if(fullScreen){
    hole.style.top='0px';hole.style.left='0px';hole.style.width='100vw';hole.style.height='100vh';
  }else{
    const r=target.getBoundingClientRect(),pad=6;
    hole.style.top=(r.top-pad)+'px';hole.style.left=(r.left-pad)+'px';hole.style.width=(r.width+pad*2)+'px';hole.style.height=(r.height+pad*2)+'px';
  }
  const cardH=card.offsetHeight||160,cardW=card.offsetWidth||280;
  const r=target.getBoundingClientRect();
  let top=fullScreen?Math.max(10,(window.innerHeight-cardH)/2):r.bottom+14;
  if(!fullScreen&&top+cardH>window.innerHeight-10)top=Math.max(10,r.top-cardH-14);
  card.style.top=top+'px';
  card.style.left=fullScreen?Math.max(10,(window.innerWidth-cardW)/2)+'px':Math.min(Math.max(10,r.left),window.innerWidth-cardW-10)+'px';
}
/* Waits for the smooth scrollIntoView to actually settle (rather than a fixed delay) before measuring
   the target's position — a fixed short timeout could fire mid-scroll, especially for a sticky-positioned
   target like the "Add port" button, leaving the highlight hole visibly off the element. */
function waitForScrollSettle(cb){
  let lastY=window.scrollY,stable=0;
  const tick=()=>{
    if(window.scrollY===lastY){stable++;}else{stable=0;lastY=window.scrollY;}
    if(stable>=3){cb();return;}
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(cb,900); // hard safety net
}
function gotoTourStep(i){
  document.querySelectorAll('.tour-target').forEach(el=>el.classList.remove('tour-target'));
  if(i<0)return;
  if(i>=TOUR_STEPS.length){endTour();return;}
  const step=TOUR_STEPS[i];
  if(step.onEnter==='maxfill')markMaxFillSeen();   // the tour covers it, so no pop-up later
  tourIndex=i;
  showTab(step.tab,{scroll:false,animate:false});   // the tour measures targets next frame, so no slide
  requestAnimationFrame(()=>{
    const target=document.querySelector(step.sel);
    if(!target){i<TOUR_STEPS.length-1?gotoTourStep(i+1):endTour();return;}
    target.classList.add('tour-target');
    const ov=tourOverlayEls(),card=ov.querySelector('.tour-card'),hole=ov.querySelector('.tour-hole');
    ov.querySelector('.tour-step-count').textContent=`Step ${i+1} of ${TOUR_STEPS.length}`;
    ov.querySelector('.tour-title').textContent=step.title;
    ov.querySelector('.tour-text').textContent=step.text;
    ov.querySelector('#tourPrev').disabled=i===0;
    ov.querySelector('#tourNext').textContent=i===TOUR_STEPS.length-1?'Finish':'Next';
    if(step.fullScreen){
      window.scrollTo({top:0});
      positionTourCard(target,card,hole,true);
    }else{
      target.scrollIntoView({block:'center',behavior:'smooth'});
      waitForScrollSettle(()=>positionTourCard(target,card,hole,false));
    }
  });
}
function startTour(){gotoTourStep(0);}
function loadSavedVoyages(){try{const v=JSON.parse(localStorage.getItem(SAVED_VOYAGES_KEY)||'[]');return Array.isArray(v)?v:[];}catch{return[];}}
function writeSavedVoyages(list){try{localStorage.setItem(SAVED_VOYAGES_KEY,JSON.stringify(list.slice(0,30)));return true;}catch{return false;}}
function renderSavedVoyages(){
  const box=$('#savedVoyageList');if(!box)return;
  const list=loadSavedVoyages();
  box.innerHTML=list.length?list.slice().sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).map(v=>`<div class="saved-voyage-row" data-saved-id="${esc(v.id)}"><div class="sv-info"><strong>${esc(v.name)}</strong><small>Saved ${fmtUTC(v.savedAt)}</small></div><div class="sv-actions"><button type="button" class="secondary sm" data-load-voyage="${esc(v.id)}">Load</button><button type="button" class="danger ghost sm" data-delete-voyage="${esc(v.id)}">${ICON.trash}</button></div></div>`).join(''):'<div class="empty">No saved voyages yet — enter a name above and tap Save.</div>';
}
function safeFileName(name){return (name||'voyage').replace(/[^a-z0-9\-_ ]/gi,'').trim().replace(/\s+/g,'-').slice(0,60)||'voyage';}
/* The anchor is appended to the DOM before .click() and removed after — some mobile browsers/WebViews
   only trigger the native download for an <a download> that is actually attached to the document. */
function triggerDownload(a){document.body.appendChild(a);a.click();requestAnimationFrame(()=>a.remove());}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;triggerDownload(a);setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function downloadBytes(name,bytes,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type}));a.download=name;triggerDownload(a);setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

function demoState(){
  const s=defaultState();
  const today=nowWall(9).slice(0,10)+'T12:00';   // today at noon (local time at Kainan, UTC+9)
  s.meta={...s.meta,vesselName:'MV Vessel',voyageNo:'DEMO-001',noonLocal:today,posUtcOffset:9,currentPosition:'Kainan',positionMode:'manual',notes:'Example values only — replace with vessel records.',noonRob:{fo:483.9,do:102.4,cyl:10000,mesys:10000,gesys:1000}};
  s.fuels[0].seaRate=13.2;s.fuels[0].portRate=3.5;s.fuels[0].reserveRate=13.2;
  s.fuels[1].seaRate=.1;s.fuels[1].portRate=.1;s.fuels[1].reserveRate=.1;
  s.lubes[0].seaRate=205;s.lubes[0].reserveRate=205;
  /* fuel / diesel tanks are entered by volume (capacity in m³) with the present ROB typed in MT */
  const vt=(id,group,name,capM3,rob,o,x={})=>{const d=group==='do'?0.85:0.95;return{id,group,name,capacity:Math.round(capM3*d*1000)/1000,capacityM3:capM3,capUnit:'volume',density:d,robInput:'mt',rob,unpumpable:0,consumable:true,category:'storage',sequence:o+1,order:o,fuelType:defaultFuelType(group)||null,...x};};
  s.tanks=[
    vt('fo-tk-s','fo','FO Tank (S)',546.1,52.4,0,{sequence:1}),
    vt('fo-tk-p','fo','FO Tank (P)',524.9,406.6,1,{sequence:2}),
    vt('fo-sett','fo','FO Settling Tank',13.4,8.8,2,{consumable:false,category:'settling',sequence:99,inService:true}),
    vt('fo-serv','fo','FO Service Tank',16.2,14.1,3,{consumable:false,category:'service',sequence:100,inService:true}),
    vt('blr-serv','fo','Boiler FO Service Tank',2.3,1,4,{consumable:false,category:'support',sequence:101}),
    vt('fo-ovf','fo','FO Overflow Tank',11.8,1,5,{consumable:false,category:'support',sequence:102}),
    vt('do-tk-p','do','DO Tank (P)',84.2,60.4,0,{sequence:1}),
    vt('do-tk-s','do','DO Tank (S)',84.2,32.4,1,{sequence:2}),
    vt('do-serv','do','DO Service Tank',18.7,9.6,2,{consumable:false,category:'service',sequence:99,inService:true}),
    {id:'cyl-tk1',group:'cyl',name:'Cylinder Oil Tank 1',capacity:15000,rob:10000,unpumpable:0,consumable:true,category:'storage',sequence:1,order:0},
    {id:'cyl-tk2',group:'cyl',name:'Cylinder Oil Tank 2',capacity:15000,rob:0,unpumpable:0,consumable:true,category:'storage',sequence:2,order:1},
    {id:'mesys-tk',group:'mesys',name:'ME System Oil Tank',capacity:20000,rob:10000,unpumpable:0,consumable:true,category:'storage',sequence:1,order:0},
    {id:'gesys-tk',group:'gesys',name:'GE System Oil Tank',capacity:5000,rob:1000,unpumpable:0,consumable:true,category:'storage',sequence:1,order:0}
  ];
  s.active={fo:0,do:0};
  s.route=[
    {port:'Kainan',distanceNm:0,speedKn:10.5,portStayDays:10,utcOffset:9,notes:'Starting port',bunkers:{}},
    {port:'Kinuura',distanceNm:206,speedKn:10.5,portStayDays:4,utcOffset:9,notes:'',bunkers:{}},
    {port:'Singapore',distanceNm:2800,speedKn:10.5,anchorStayDays:1,portStayDays:0,utcOffset:8,notes:'Planned bunker port',bunkers:{fo:{entryMode:'tanks',allocations:[{tankId:'fo-tk-s',quantity:430}]},do:{entryMode:'tanks',allocations:[{tankId:'do-tk-s',quantity:30}]}}}
  ];
  return s;
}

function maybeAutoTour(){
  let seen=true;try{seen=!!localStorage.getItem('bunker-tour-seen');}catch{}
  if(!seen)setTimeout(startTour,350);          // first launch: Guide me comes first
  else if(lastAlertCount>0)setTimeout(()=>toastAlerts(lastAlertCount),500);
}
function dismissIntro(){const intro=$('#introScreen');if(intro){intro.remove();maybeAutoTour();}}
function initialTab(){const h=location.hash.slice(1);if(TAB_TITLES[h])return h;try{const t=sessionStorage.getItem('bunker-tab');if(TAB_TITLES[t])return t;}catch{}return'dashboard';}
function init(){
  bind();initPlanBunker();initFoldAutoClose();applyHints();renderAll();showTab(initialTab(),{scroll:false});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  const intro=$('#introScreen');
  if(!intro)maybeAutoTour();
  if(intro){
    // Runs on every load (no "seen before" gate) and lasts exactly 3s in total — see the
    // .intro-screen animation-delay + animation-duration in styles.css, which must sum to 3s.
    intro.addEventListener('click',dismissIntro);
    intro.addEventListener('animationend',e=>{if(e.animationName==='introFadeOut')dismissIntro();});
    setTimeout(dismissIntro,3300); // safety net in case the animationend event doesn't fire
  }
  // Explanation text lingers briefly after a field loses focus so a native dropdown
  // opening over it doesn't just make it vanish.
  document.addEventListener('focusin',e=>{
    const field=e.target.closest('.field');
    if(!field)return;
    field.classList.add('help-visible');
    if(field._helpHideTimer){clearTimeout(field._helpHideTimer);field._helpHideTimer=null;}
  });
  document.addEventListener('focusout',e=>{
    const field=e.target.closest('.field');
    if(!field)return;
    field._helpHideTimer=setTimeout(()=>{field.classList.remove('help-visible');field._helpHideTimer=null;},3000);
  });
}
init();
