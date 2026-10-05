import assert from 'node:assert/strict';
import { calculateVoyage } from './core.js';
import { planBunkering, locateBunkerPort } from './bunkerplan.js';
const stop=(port,dist,spd,stay,x={})=>({port,distanceNm:dist,speedKn:spd,anchorStayDays:0,anchorStayHours:0,portStayDays:stay,portStayHours:0,utcOffset:8,bunkers:{},eca:{entering:{enabled:false},leaving:{enabled:false},port:{enabled:false}},...x});
const tk=(id,group,name,cap,rob,seq,x={})=>({id,group,name,capacity:cap,rob,unpumpable:0,consumable:true,category:'storage',sequence:seq,fuelType:group==='fo'?'vlsfo':group==='do'?'lsmgo':null,density:group==='fo'?0.95:group==='do'?0.85:undefined,...x});
const base=()=>({
  meta:{startUtc:'2026-10-10T00:00:00Z',maxFillPct:85},
  fuels:[{id:'fo',name:'FO',seaRate:20,portRate:2,reserveDays:3,reserveRate:20,unit:'MT',foMode:'vlsfo'},{id:'do',name:'DO',seaRate:1,portRate:1,reserveDays:3,reserveRate:1,unit:'MT'}],
  lubes:[{id:'cyl',name:'Cyl',seaRate:200,portRate:0,reserveDays:3,reserveRate:200,unit:'L'}],
  tanks:[tk('f1','fo','FO 1',500,300,1),tk('f2','fo','FO 2',500,0,2),tk('d1','do','DO 1',100,40,1),tk('c1','cyl','Cyl 1',10000,4000,1)],
  active:{fo:0,do:0},
  route:[stop('Kainan',0,0,0),stop('Singapore',2400,12,1),stop('Fujairah',3000,12,1)],
});
const full=calculateVoyage(base());
// route port plan
const p=planBunkering(base(),{routeIndex:1});
assert.ok(p.ok);assert.equal(p.port.name,'Singapore');assert.equal(p.port.inserted,false);
const fo=p.products.find(x=>x.id==='fo');
// independent check: required = future cons + reserve - departure ROB
const r1=full.results[1],r2=full.results[2];
const futureFo=r2.seaUsage.fo+r2.anchorUsage.fo+r2.portUsage.fo;
assert.ok(Math.abs(fo.futureConsumption-futureFo)<1e-6);
assert.ok(Math.abs(fo.required-(futureFo+60-r1.departureFuel.fo))<1e-6);
assert.ok(fo.suggested>=fo.required-1e-9&&fo.suggested<fo.required+1+1e-9);   // rounded up to 1 MT
// VLSFO no-mix: tank FO 1 holds ROB -> excluded, FO 2 (empty) takes it
const f1=fo.tanks.find(t=>t.id==='f1'),f2=fo.tanks.find(t=>t.id==='f2');
assert.ok(f1&&f2&&f2.qty>0);
// verification: departure ROB after = departure before + suggested, no shortages
assert.ok(Math.abs(fo.robDepartureAfter-(r1.departureFuel.fo+fo.suggested))<1e-6);
assert.ok(fo.finalRob>=60+0-1e-6);
// plan does not mutate input
const inp=base();planBunkering(inp,{routeIndex:1});assert.deepEqual(inp,base());
// existing planned bunker at port is ignored (warning), same numbers
const withB=base();withB.route[1].bunkers={fo:{quantity:100,autoAllocate:true,allocations:[]}};
const pw=planBunkering(withB,{routeIndex:1});assert.ok(pw.warnings.some(w=>/already entered/.test(w)));
assert.ok(Math.abs(pw.products[0].required-fo.required)<1e-6);
// later planned bunker reduces the requirement
const later=base();later.route[2].bunkers={fo:{quantity:50,autoAllocate:true,allocations:[]}};
const pl=planBunkering(later,{routeIndex:1});assert.ok(pl.products[0].required<fo.required);
// cover until arrival at Fujairah: no port stay, no sea beyond
const pu=planBunkering(base(),{routeIndex:1},{untilIndex:2});
assert.ok(Math.abs(pu.products[0].futureConsumption-r2.seaUsage.fo)<1e-6);
// fill to max
const pm=planBunkering(base(),{routeIndex:1},{fillToMax:true});
assert.ok(Math.abs(pm.products[0].suggested-pm.products[0].maxReceivable)<1e-6);
// max fill respected
for(const t of pm.products[0].tanks)if(t.qty>0)assert.ok(t.robArrival+t.qty<=t.capacity*0.85+1e-6);
// shortage-limited: tiny tanks
const tiny=base();tiny.tanks[1].capacity=50;tiny.tanks[0].rob=0;
const pt=planBunkering(tiny,{routeIndex:1});assert.ok(['limited','critical'].includes(pt.status));
// off-route port by date: midway Singapore->Fujairah
const dep1=Date.parse(r1.departureUtc),arr2=Date.parse(r2.arrivalUtc),T=new Date((dep1+arr2)/2).toISOString();
const po=planBunkering(base(),{name:'Colombo',etaUtc:T,stayHours:12,utcOffset:5.5});
assert.ok(po.ok&&po.port.inserted&&po.port.name==='Colombo');
assert.ok(Math.abs(Date.parse(po.port.etaUtc)-Date.parse(T))<2000);
const foo=po.products[0];
// ROB at that point = arrival ROB (Singapore dep minus half the leg consumption)
assert.ok(Math.abs(foo.robArrival-(r1.departureFuel.fo-r2.seaUsage.fo/2))<0.01,`${foo.robArrival}`);
// off-route 12 h stay adds port consumption; remaining sea = half leg
assert.ok(Math.abs(foo.futureConsumption-(r2.seaUsage.fo/2+r2.anchorUsage.fo+r2.portUsage.fo))<0.01);
// date inside a port stay -> that port
const ps=planBunkering(base(),{name:'Singapore',etaUtc:new Date(Date.parse(r1.arrivalUtc)+3600e3).toISOString()});
assert.equal(ps.port.inserted,false);assert.equal(ps.port.routeIndex,1);
// bad input
assert.equal(planBunkering({...base(),route:[]},{routeIndex:0}).ok,false);
assert.equal(planBunkering(base(),{name:'X',etaUtc:'nope'}).ok,false);
// diesel & lube present
assert.deepEqual(p.products.map(x=>x.id),['fo','do','cyl']);
// chunk 2: manual per-tank quantities, grade choice
const pman=planBunkering(base(),{routeIndex:1},{overrides:{fo:{f2:100}}});
const mf=pman.products[0];assert.ok(mf.manual);assert.equal(mf.suggested,100);assert.equal(mf.tanks.find(t=>t.id==='f2').qty,100);
assert.ok(pman.warnings.some(w=>/short of the/.test(w)));
const pover=planBunkering(base(),{routeIndex:1},{overrides:{fo:{f2:480}}});
assert.ok(pover.warnings.some(w=>/maximum fill/.test(w)));
assert.equal(planBunkering(base(),{routeIndex:1},{overrides:{fo:{f1:50,f2:0}}}).products[0].tanks.find(t=>t.id==='f1').qty,0);   // old VLSFO tank stays blocked
const phfo=planBunkering(base(),{routeIndex:1},{fuelTypes:{fo:'hfo'}});assert.equal(phfo.products[0].fuelType,'hfo');assert.equal(phfo.products[0].suggested,0);
assert.ok(phfo.products[0].status==='limited');   // no HFO tank
console.log('test-bunkerplan: OK');
