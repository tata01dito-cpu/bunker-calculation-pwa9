import assert from 'node:assert/strict';
import { LF_GRID, LF_PAGE_W, lfFormBodyChunk2, lfBulkRows, lfBulkTankRow } from './lubeform.js';
assert.equal(LF_GRID.reduce((a,b)=>a+b,0),LF_PAGE_W);
const tanks=[
  {kind:'Cylinder oil',tank:'No.1 Storage',capM3:40,beforeM3:12.5,planKl:20,planDensity:920,planTemp:25,afterKl:32.5,afterPct:81},
  {kind:'Cylinder oil',tank:'No.2 Storage',capM3:30,beforeM3:5,planKl:10,afterKl:15,afterPct:50},
];
const rows=lfBulkRows(tanks);
assert.equal(rows.length,6+1,'6 padded rows + total');
const spanOf=r=>[...r.matchAll(/<w:tcW w:w="(\d+)"/g)].reduce((a,m)=>a+Number(m[1]),0);
for(const r of rows)assert.equal(spanOf(r),LF_PAGE_W,'every row spans the full grid');
assert.match(lfBulkTankRow(tanks[0]),/40\.0/);
const tot=rows[rows.length-1];assert.match(tot,/>30\.0</,'plan total 30 kl');assert.match(tot,/>70\.0</,'capacity total 70 m3');assert.match(tot,/>68</,'after % = 47.5/70');
const xml=lfFormBodyChunk2({port:'Singapore'},tanks);
assert.match(xml,/Singapore/);
console.log('lubeform chunk 2 tests passed');

import { lfDrumRows, lfDrumRow, lfFormRows, lfFormDocumentXml } from './lubeform.js';
const drums=[{type:'Drums',kind:'Cylinder oil',sizeL:200,planCount:10,planL:2000,tank:'No.1 Storage'}];
const drows=lfDrumRows(drums);
assert.equal(drows.length,3);
const span=r=>[...r.matchAll(/<w:tcW w:w="(\d+)"/g)].reduce((a,m)=>a+Number(m[1]),0);
for(const r of lfFormRows({port:'Singapore'},tanks,drums))assert.equal(span(r),LF_PAGE_W,'full form: every row spans the grid');
assert.match(lfDrumRow(drums[0]),/2000/);
const doc=lfFormDocumentXml({port:'Singapore',remarks:'Test & check'},tanks,drums);
assert.match(doc,/Test &amp; check/);
assert.ok(doc.includes('<w:sectPr>'));
console.log('lubeform chunk 3 tests passed');

import { lfPageFromStop, lfFormsDocumentXml } from './lubeform.js';
const stop={port:'Singapore',tankAtArrival:[{id:'t1',name:'No.1 Storage',capacity:40000,rob:12500}],
  bunkerInfo:{cyl:{mode:'bulk',quantity:20000,allocations:[{tankId:'t1',quantity:20000}],drumReceived:0,transferred:0},
              gesys:{mode:'drums',quantity:1000,allocations:[],drumReceived:1000,transferred:0}}};
const pg=lfPageFromStop(stop,[{id:'cyl',name:'Cylinder oil'},{id:'gesys',name:'GE system oil'}]);
assert.equal(pg.header.port,'Singapore');
assert.deepEqual([pg.tanks[0].capM3,pg.tanks[0].beforeM3,pg.tanks[0].planKl,pg.tanks[0].afterKl,Math.round(pg.tanks[0].afterPct)],[40,12.5,20,32.5,81]);
assert.equal(pg.drums[0].planL,1000);
assert.equal(lfPageFromStop({port:'X',bunkerInfo:{cyl:{mode:'bulk',allocations:[]}}},[{id:'cyl',name:'C'}]),null);
const two=lfFormsDocumentXml([pg,pg]);
assert.equal((two.match(/w:type="page"/g)||[]).length,1,'page break between two forms');
console.log('lubeform chunk 4 mapping tests passed');
