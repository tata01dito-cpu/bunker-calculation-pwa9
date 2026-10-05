import assert from 'node:assert/strict';
import { BF_GRID, BF_NCOLS, BF_PAGE_W, bfCol, bfDate, bfNum, bfFormBody, bfFormsDocumentXml, BF_TANK_SKELETON } from './bunkerform.js';
assert.equal(BF_NCOLS,31);assert.equal(BF_GRID.reduce((a,b)=>a+b,0),BF_PAGE_W);
assert.equal(bfCol('A'),0);assert.equal(bfCol('Z'),25);assert.equal(bfCol('AE'),30);
assert.equal(bfDate('2025-04-29T00:00:00Z',8),'29/Apr/2025');assert.equal(bfDate('2025-04-29T20:00:00Z',8),'30/Apr/2025');
assert.equal(bfNum(295,2),'295.00');assert.equal(bfNum(''),'');
const body=bfFormBody({vessel:'MV TEST',date:'29/Apr/2025',port:'Zhenjiang',planned:[{name:'F.O.TK. S',qtyMt:295,sulphur:0.5}]});
for(const tr of body.match(/<w:tr>.*?<\/w:tr>/g)){
  const spans=[...tr.matchAll(/<w:tc>.*?<\/w:tc>/g)].map(m=>{const g=m[0].match(/<w:gridSpan w:val="(\d+)"/);return g?+g[1]:1;});
  assert.equal(spans.reduce((a,b)=>a+b,0),31,'row must cover 31 columns');
}
for(const label of ['Planned Bunker Oil Details','Bunker Tank Details','Bunker/Transfer Plan','Present Tank Condition','Qty to be Added/Transferred','Estimated Tank Condition After Transferring','FO Additive added','Method of Topping Off*','TANK CONDITION AFTER BUNKERING/TRANSFERRING','CHIEF ENGINEER:','MASTER:','1AE:','Remarks:','Note: * Method of Topping Off','Sequence Number','Rate of loading at start of transfer'])assert.ok(body.includes(label),label);
assert.equal(BF_TANK_SKELETON.length,16);
assert.ok(!/KUROBE|CAPINPIN|TOBONGBANUA|VALENZUELA|Zhenjiang, China/.test(body));   // no Excel sample data
assert.ok(body.includes('MV TEST')&&body.includes('295.00')&&body.includes('0.500'));
assert.equal((bfFormsDocumentXml([{},{}]).match(/w:type="page"/g)||[]).length,1);
console.log('test-bunkerform: full form template OK');

/* ---- chunk 2: app data -> form (uses the real calculateVoyage) ---- */
import { calculateVoyage } from './core.js';
import { bfPageFromStop, bfTankSpecs, bfPlannedItems, bfTankSpec, bfTotalSpec } from './bunkerform.js';
const voy={
  meta:{startUtc:'2026-10-10T00:00'},
  fuels:[{id:'fo',name:'FO',seaRate:20,portRate:2,unit:'MT',reserveDays:2,reserveRate:20},{id:'do',name:'DO',seaRate:1,portRate:0.5,unit:'MT',reserveDays:2,reserveRate:1}],
  lubes:[],
  tanks:[
   {id:'f1',group:'fo',name:'FO Tank 1 (P)',capacity:470,capacityM3:500,density:0.94,robInput:'volume',robVolumeM3:57,robTempC:36,rob:50.11,sulphur:0.496,consumable:true,category:'storage'},
   {id:'f2',group:'fo',name:'FO Tank 2 (S)',capacity:513,capacityM3:546.1,density:0.94,robInput:'volume',robVolumeM3:1.8,robTempC:33,rob:1.57,sulphur:0.5,consumable:true,category:'storage'},
   {id:'d1',group:'do',name:'DO Tank 1',capacity:70,capacityM3:84.2,density:0.83,robInput:'mt',rob:35.55,consumable:true,category:'storage'},
   {id:'fs',group:'fo',name:'FO Settling',capacity:30,density:0.94,rob:10,consumable:true,category:'settling'}
  ], active:{fo:0,do:0}, route:[
   {port:'Start',distanceNm:0,speedKn:10,portStayDays:1,utcOffset:8,bunkers:{}},
   {port:'Zhenjiang',distanceNm:240,speedKn:10,portStayDays:1,utcOffset:8,bunkers:{fo:{quantity:295,autoAllocate:false,allocations:[{tankId:'f2',quantity:295}]},do:{quantity:10,autoAllocate:false,allocations:[{tankId:'d1',quantity:10}]}}}
  ]};
const calc=calculateVoyage(voy);
assert.equal(bfPageFromStop(calc.results[0],{vessel:'MV T',limitPct:85}),null);          // nothing bunkered at the first stop
const pg=bfPageFromStop(calc.results[1],{vessel:'MV TEST',limitPct:85,sulphur:(g)=>g==='fo'?0.5:0.1});
assert.ok(pg,'page expected');
assert.equal(pg.port,'Zhenjiang');
assert.equal(pg.planned.length,2);
assert.deepEqual(pg.planned.map(x=>[x.name,x.qtyMt,x.sulphur]),[['FO Tank 2 (S)',295,0.5],['DO Tank 1',10,0.1]]);
// tank table: settling tank is excluded; FO capacity 500+546.1 ; limit volume 85 %
const specs=bfTankSpecs(calc.results[1],85);
const t2=specs.find(x=>x.name==='FO Tank 2 (S)');
assert.equal(t2.v.vol,'546.1');assert.equal(t2.v.limVol,'464.19');assert.equal(t2.v.addQty,'295.00');
assert.equal(t2.v.addVol,(295/0.94).toFixed(2));                       // volume = quantity / density
assert.equal(t2.v.aQty,(1.57+295).toFixed(2));                          // after = before + planned
assert.equal(t2.v.pVol,'1.80');assert.equal(t2.v.pTemp,'33');
assert.ok(Number(t2.v.pTcf)>0.98&&Number(t2.v.pTcf)<1.0);              // ASTM 54B factor at 33 C
assert.ok(specs.some(x=>x.name==='DO Tank 1'));assert.ok(!specs.some(x=>x.name==='FO Settling'));
const d1=specs.find(x=>x.name==='DO Tank 1');assert.equal(d1.v.pTemp,'');assert.equal(d1.v.pTcf,'');   // weight-entered ROB has no temperature
const tFot=specs.find(x=>x.place==='FOT'),tDot=specs.find(x=>x.place==='DOT');
assert.equal(tFot.v.vol,'1046.1');assert.equal(tFot.v.addQty,'295.00');assert.equal(tDot.v.addQty,'10.00');assert.equal(tDot.kind,'totalGold');
// tanks that receive nothing still show an "after" condition (= present), so the totals are complete
const t1=specs.find(x=>x.name==='FO Tank 1 (P)');assert.equal(t1.v.aQty,t1.v.pQty);assert.equal(t1.v.addQty,'');assert.ok(Number(t1.v.pQty)>0&&Number(t1.v.pQty)<50.11);   // ROB at ARRIVAL (after sea consumption)
assert.equal(t1.v.aPct,(Number(t1.v.aVol)/500*100).toFixed(1)+'%');
const fo2=specs.filter(x=>x.kind==='data'&&/^FO Tank/.test(x.name));
assert.equal(tFot.v.aQty,fo2.reduce((a,x)=>a+Number(x.v.aQty),0).toFixed(2));assert.equal(tFot.v.pQty,fo2.reduce((a,x)=>a+Number(x.v.pQty),0).toFixed(2));
assert.equal((Number(tFot.v.aQty)-Number(tFot.v.pQty)).toFixed(2),'295.00');       // totals differ by exactly the planned bunker
// total rows exist once and the first TOTAL carries the capacity only
const tot1=specs.find(x=>x.name==='TOTAL'&&!x.place&&x.v.vol);assert.deepEqual(Object.keys(tot1.v),['vol']);
// whole page renders: 31 columns per row, labels present, no NaN/undefined, no Excel sample data
const pbody=bfFormBody(pg);
for(const tr of pbody.match(/<w:tr>.*?<\/w:tr>/g)){const sp=[...tr.matchAll(/<w:tc>.*?<\/w:tc>/g)].map(m=>{const g=m[0].match(/<w:gridSpan w:val="(\d+)"/);return g?+g[1]:1;});assert.equal(sp.reduce((a,b)=>a+b,0),31);}
assert.ok(pbody.includes('FILLING LIMIT (85%)')&&pbody.includes('MV TEST')&&pbody.includes('Zhenjiang'));
assert.ok(!/NaN|undefined/.test(pbody));assert.ok(!/KUROBE|CAPINPIN|TOBONGBANUA|VALENZUELA/.test(pbody));
assert.equal(bfDate(calc.results[1].arrivalUtc,8),pg.date);
// a tank with nothing known renders blanks
assert.equal(bfTankSpec({id:'x',name:'X'},0,null,85).v.pVol,'');
console.log('test-bunkerform: chunk 2 OK');

import { bfFitSize } from './bunkerform.js';
assert.equal(bfFitSize('F.O.TK.'),14,'short names keep the normal size');
assert.ok(bfFitSize('No.1 FO Storage Tank (Port) long name')<14,'long names shrink');
assert.equal(bfFitSize('x'.repeat(200)),10,'never below 5 pt');
console.log('test-bunkerform: name fitting OK');

{
  const mk=(g,n)=>Array.from({length:n},(_,i)=>({id:g+i,group:g,name:g+i,capacity:100,rob:10,density:0.9,category:'storage'}));
  const rowsFor=(nf,nd)=>bfTankSpecs({tankAtArrival:[...mk('fo',nf),...mk('do',nd)],bunkerInfo:{}},85).length;
  assert.equal(rowsFor(3,3),rowsFor(2,2),'extra tanks use the spare blank rows: same row count up to 5 extra');
  assert.equal(rowsFor(8,2)-rowsFor(2,2),1,'beyond that the table grows (6 extra tanks - 5 spare rows)');
  console.log('test-bunkerform: row budget OK');
}

{
  const stop={port:'X',arrivalUtc:'2026-01-01T00:00:00Z',utcOffset:0,
    tankAtArrival:[{id:'a',group:'fo',name:'FO A',capacity:100,rob:50,density:0.95,category:'storage'},{id:'b',group:'fo',name:'FO B',capacity:100,rob:50,category:'storage'},{id:'c',group:'fo',name:'Settling',capacity:10,rob:5,category:'settling'}],
    bunkerInfo:{fo:{allocations:[{tankId:'a',quantity:10}]}}};
  const p=bfPageFromStop(stop,{limitPct:85});
  assert.deepEqual(p.missingDensity,['FO B'],'storage tank without density is reported; settling tank is ignored');
  assert.equal(bfPageFromStop({...stop,bunkerInfo:{fo:{allocations:[]}}},{}),null,'no planned fuel -> no page');
  console.log('test-bunkerform: missing density OK');
}

{ // every row of the finished form must cover all 31 grid columns (merged padding cells count by gridSpan)
  const xml=bfFormsDocumentXml([{vessel:'V',port:'P',planned:[{name:'T',qtyMt:1}]}]);
  const rows=[...xml.matchAll(/<w:tr>.*?<\/w:tr>/gs)].map(m=>m[0]);
  assert.ok(rows.length>40);
  for(const r of rows){
    const cells=[...r.matchAll(/<w:tc>.*?<\/w:tc>/gs)].map(m=>m[0]);
    const n=cells.reduce((a,c)=>a+Number((c.match(/<w:gridSpan w:val="(\d+)"/)||[0,1])[1]),0);
    assert.equal(n,31,'row covers 31 grid columns');
  }
  assert.ok(xml.length<600000,'one page stays under 0.6 MB of XML (about 0.52 MB now; guards against bloat)');
  console.log('test-bunkerform: grid coverage + size OK');
}
