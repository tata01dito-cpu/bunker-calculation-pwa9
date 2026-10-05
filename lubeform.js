/* lubeform.js — Lub. Oil Replenishment Plan and Result Record (Word .docx), laid out like form S-082001-02FRM.
   CHUNKS 1-3 of 4: OOXML helpers, form header, bulk table, drum/tin table, signatures and page assembly.
   Pure functions (no dependency on app.js) so they can be tested in Node.
   Later chunks add: 2 = bulk tank rows, 3 = drum/tin table + signatures + page assembly, 4 = wiring into app.js. */

/* ---- grid: the 16 Excel columns scaled to a landscape A4 page (15398 twips usable) ---- */
const XL_COLS=[4160,2208,2720,2208,2720,2208,2208,2208,2208,2208,2208,2208,2208,2208,2208,2368];
export const LF_PAGE_W=15398;
export const LF_GRID=(()=>{const tot=XL_COLS.reduce((a,b)=>a+b,0),w=XL_COLS.map(x=>Math.round(x*LF_PAGE_W/tot));w[w.length-1]+=LF_PAGE_W-w.reduce((a,b)=>a+b,0);return w;})();

/* ---- colours used by the original form ---- */
export const LF_COLORS={red:'FF0000',planYellow:'FFFFCC',fill:'FFFF00',noFill:'FF0000',drums:'99CC00',line:'000000'};

/* ---- low-level OOXML helpers ---- */
export function lfEsc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
export function lfRun(text,o={}){
  const p=['<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'];
  if(o.bold)p.push('<w:b/>');
  if(o.italic)p.push('<w:i/>');
  if(o.underline)p.push('<w:u w:val="single"/>');
  if(o.color)p.push(`<w:color w:val="${o.color}"/>`);
  p.push(`<w:sz w:val="${o.size||16}"/>`);
  return `<w:r><w:rPr>${p.join('')}</w:rPr><w:t xml:space="preserve">${lfEsc(text)}</w:t></w:r>`;
}
/* one paragraph; `lines` may be a string or an array of strings (one run per line, separated by line breaks) */
export function lfPara(lines,o={}){
  const arr=Array.isArray(lines)?lines:[lines];
  const runs=arr.map((t,i)=>(i?'<w:r><w:br/></w:r>':'')+lfRun(t,o)).join('');
  const jc=o.align?`<w:jc w:val="${o.align}"/>`:'';
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="${o.after??0}" w:line="240" w:lineRule="auto"/>${jc}</w:pPr>${runs}</w:p>`;
}
/* Border spec: 'all' | 'none' | {top,bottom,left,right} each 0 (none) / 4 (thin) / 12 (thick) */
function bordersXml(b){
  if(b==='none')b={top:0,bottom:0,left:0,right:0};
  if(b===undefined||b==='all')b={top:4,bottom:4,left:4,right:4};
  const side=(name,sz)=>sz?`<w:${name} w:val="single" w:sz="${sz}" w:space="0" w:color="${LF_COLORS.line}"/>`:`<w:${name} w:val="nil"/>`;
  return `<w:tcBorders>${side('top',b.top)}${side('left',b.left)}${side('bottom',b.bottom)}${side('right',b.right)}</w:tcBorders>`;
}
/* Cell. o.span = grid columns covered (default 1); o.vmerge = 'restart' | 'continue' (vertical merge); o.cols = [first column index] */
export function lfCell(text,o={}){
  const first=o.col||0,span=o.span||1;
  let w=0;for(let i=first;i<first+span;i++)w+=LF_GRID[i];
  const pr=[`<w:tcW w:w="${w}" w:type="dxa"/>`];
  if(span>1)pr.push(`<w:gridSpan w:val="${span}"/>`);
  if(o.vmerge==='restart')pr.push('<w:vMerge w:val="restart"/>');
  else if(o.vmerge==='continue')pr.push('<w:vMerge/>');
  pr.push(bordersXml(o.borders));
  if(o.shade)pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>`);
  pr.push('<w:tcMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tcMar>');
  pr.push(`<w:vAlign w:val="${o.valign||'center'}"/>`);
  const para=(o.xml!==undefined)?o.xml:lfPara(text??'',{bold:o.bold,align:o.align||'center',size:o.size,color:o.color,italic:o.italic,underline:o.underline});
  return `<w:tc><w:tcPr>${pr.join('')}</w:tcPr>${para}</w:tc>`;
}
export function lfRow(cells,o={}){
  const pr=[];
  if(o.height)pr.push(`<w:trHeight w:val="${o.height}" w:hRule="${o.exact?'exact':'atLeast'}"/>`);
  pr.push('<w:cantSplit/>');
  return `<w:tr><w:trPr>${pr.join('')}</w:trPr>${cells.join('')}</w:tr>`;
}
/* the whole table always uses the 16-column grid so every section lines up like the Excel sheet */
export function lfTable(rowsXml){
  const grid=LF_GRID.map(w=>`<w:gridCol w:w="${w}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${LF_PAGE_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowsXml.join('')}</w:tbl>`;
}
export const lfSpacer=(h=120)=>`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${h}" w:lineRule="exact"/></w:pPr></w:p>`;

/* ---- FORM HEADER (Excel rows 1-5) ----
   d (all optional): { port, workStarted, workFinished, seaTemp, ambTemp, draftF, draftA, trim, brand }
   Only `port` comes from the Bunker Pilot app. Every other field is left blank for the engineer to write in. */
const UL={top:0,bottom:4,left:0,right:0};        // underline-only value fields, as on the original form
export function lfHeaderRows(d={}){
  const lab=(txt,col,span=1,o={})=>lfCell(txt,{col,span,borders:'none',align:'left',...o});
  const val=(txt,col,span=1,o={})=>lfCell(txt,{col,span,borders:UL,align:'center',...o});
  const rows=[];
  // title
  rows.push(lfRow([lfCell('Lub. Oil Replenishment Plan and Result Record',{col:0,span:16,borders:'none',bold:true,size:24})],{height:520}));
  // draft (F)
  rows.push(lfRow([lab('',0,13),lab('Draft:',13,1,{align:'right'}),lab('F:',14,1,{align:'right'}),val(d.draftF,15)],{height:260}));
  // port | work started | sea water temperature | draft (A)
  rows.push(lfRow([
    lab('Replenishing Port:',0),val(d.port,1,2,{bold:true}),
    lab('Time/Date Work Started:',3,3),val(d.workStarted,6,2),
    lab('Sea Water Temperature:',8,3),val(d.seaTemp,11),lab('\u00B0C',12),
    lab('',13),lab('A:',14,1,{align:'right'}),val(d.draftA,15)
  ],{height:300}));
  // (blank) | work finished | ambient temperature | trim
  rows.push(lfRow([
    lab('',0),lab('',1,2),
    lab('Time/Date Work Finished:',3,3),val(d.workFinished,6,2),
    lab('Ambient Temperature:',8,3),val(d.ambTemp,11),lab('\u00B0C',12),
    lab('',13),lab('Trim:',14,1,{align:'right'}),val(d.trim,15)
  ],{height:300}));
  // oil brand (red) + note
  rows.push(lfRow([
    lfCell(d.brand||'',{col:0,span:1,borders:'none',align:'left',bold:true,size:20,color:LF_COLORS.red}),
    lab('',1,11),
    lfCell('<Note: Below to be entered after replenishment>',{col:12,span:4,borders:'none',align:'right',italic:true,size:14})
  ],{height:420}));
  return rows;
}

/* ---- BULK TABLE COLUMN HEADINGS (Excel rows 6-8) ---- */
const T4={top:4,bottom:0,left:4,right:4},M4={top:0,bottom:0,left:4,right:4},B4={top:0,bottom:4,left:4,right:4};
export function lfBulkHeaderRows(){
  const h=(txt,col,span=1,o={})=>lfCell(txt,{col,span,size:14,...o});
  const rows=[];
  rows.push(lfRow([
    h('Bulk',0,1,{bold:true,size:16}),
    h('Tank Capacity (100%)',1,2),h('Before Replenishing',3,2),h('Replenishment Plan Quantity',5,4),
    h('After Replenishing',9,3),h('Actual Replenishment Quantity',12,4)
  ],{height:300}));
  const names=['Gauge','Volume','Gauge','Volume','Volume','Density','Temperature','Actual Volume','Gauge'];
  const r2=[h('Tank /',0,1,{borders:T4}),...names.map((x,i)=>h(x,i+1,1,{borders:T4})),h('Volume',10,2,{borders:T4}),
    h('Volume',12,1,{borders:T4}),h('Density',13,1,{borders:T4}),h('Temperature',14,1,{borders:T4}),h('Actual Volume',15,1,{borders:T4})];
  rows.push(lfRow(r2,{height:260}));
  const units=['( cm )','( M3 )','( M3 )','(kl)','(kl)','kg/m3','Conversion Factor','(kl)','( M3 )','(kl)','(%)','(kl)','kg/m3','Conversion Factor','(kl)'];
  const r3=[h('Kind of Oil',0,1,{borders:B4}),...units.map((x,i)=>h(x,i+1,1,{borders:B4,size:i===6||i===13?12:14}))];
  rows.push(lfRow(r3,{height:300}));
  return rows;
}

/* ---- CHUNK 1 assembly: header + bulk headings as one table (chunks 2-3 append the tank rows, drum table and signatures) ---- */
export function lfFormRowsChunk1(d={}){return [...lfHeaderRows(d),...lfBulkHeaderRows()];}
export function lfFormBodyChunk1(d={}){return lfTable(lfFormRowsChunk1(d));}

/* ---- CHUNK 2 of 4: BULK TANK ROWS (one row per lube-oil storage tank) ----
   t (all optional): { kind, tank, capM3, beforeM3, planKl, planDensity, planTemp, afterKl, afterPct }
   Quantities are passed in m3 / kl (1 m3 = 1 kl = 1000 L); chunk 4 converts the app's litres.
   Gauge, actual-volume and "actual replenishment" cells are left blank for the engineer to write in.
   Plan cells (quantity, density, temperature) are tinted like the original form. */
const lfNum=(v,dp=2)=>{if(v===undefined||v===null||v==='')return '';const x=Number(v);return Number.isFinite(x)?x.toFixed(dp):'';};
const BODY_L={top:0,bottom:0,left:4,right:4};            // open top/bottom: the kind/tank label sits over two lines
export function lfBulkTankRow(t={}){
  const c=(txt,col,span=1,o={})=>lfCell(txt,{col,span,size:16,...o});
  const plan={shade:LF_COLORS.planYellow};
  const label=[t.kind,t.tank].filter(Boolean);
  return lfRow([
    lfCell('',{col:0,xml:lfPara(label.length?label:'',{align:'left',size:16,bold:true})}),
    c('',1),                                              // capacity gauge (cm)
    c(lfNum(t.capM3,1),2),                                // capacity 100 % (m3)
    c('',3),                                              // before: gauge
    c(lfNum(t.beforeM3,1),4),                             // before: volume (m3)
    c(lfNum(t.planKl,1),5,1,{...plan,bold:true}),         // plan: volume (kl)
    c(lfNum(t.planDensity,1),6,1,plan),                   // plan: density
    c(lfNum(t.planTemp,1),7,1,plan),                      // plan: temperature
    c('',8),                                              // plan: actual volume
    c('',9),                                              // after: gauge
    c(lfNum(t.afterKl,1),10),                             // after: volume (kl)
    c(t.afterPct===undefined||t.afterPct===''?'':lfNum(t.afterPct,0),11), // after: %
    c('',12),c('',13),c('',14),c('',15)                   // actual replenishment: volume, density, temperature, actual volume
  ],{height:420});
}
/* A "Total" row summing capacity / before / plan / after, as at the foot of the Excel bulk table. */
export function lfBulkTotalRow(tanks){
  const sum=k=>tanks.reduce((a,t)=>a+(Number.isFinite(Number(t[k]))?Number(t[k]):0),0);
  const c=(txt,col,span=1,o={})=>lfCell(txt,{col,span,size:16,bold:true,...o});
  const has=k=>tanks.some(t=>t[k]!==undefined&&t[k]!==null&&t[k]!=='');
  const cap=sum('capM3'),aft=sum('afterKl');
  return lfRow([
    c('Total',0,1,{align:'left'}),c('',1),c(has('capM3')?lfNum(cap,1):'',2),c('',3),c(has('beforeM3')?lfNum(sum('beforeM3'),1):'',4),
    c(has('planKl')?lfNum(sum('planKl'),1):'',5,1,{shade:LF_COLORS.planYellow}),c('',6),c('',7),c('',8),c('',9),
    c(has('afterKl')?lfNum(aft,1):'',10),c(has('afterKl')&&cap>0?lfNum(aft/cap*100,0):'',11),
    c('',12),c('',13),c('',14),c('',15)
  ],{height:340});
}
/* Tank rows padded with blank rows to `minRows` so the engineer can write in extra tanks. */
export function lfBulkRows(tanks=[],o={}){
  const minRows=o.minRows??6,rows=tanks.map(lfBulkTankRow);
  while(rows.length<minRows)rows.push(lfBulkTankRow({}));
  if(tanks.length)rows.push(lfBulkTotalRow(tanks));
  return rows;
}
/* CHUNK 2 assembly: header + bulk headings + tank rows as one table */
export function lfFormRowsChunk2(d={},tanks=[],o={}){return [...lfFormRowsChunk1(d),...lfBulkRows(tanks,o)];}
export function lfFormBodyChunk2(d={},tanks=[],o={}){return lfTable(lfFormRowsChunk2(d,tanks,o));}

/* ---- CHUNK 3 of 4: DRUM / TIN TABLE + REMARKS + SIGNATURES + PAGE ASSEMBLY ----
   dr (all optional): { type:'Drums'|'Tins', kind, sizeL, planCount, planL, tank }
   Drum/tin receipts are counted in containers and litres; where they are pumped over to is written in by hand
   unless `tank` is given. Actual-result cells are left blank for the engineer. */
export function lfDrumHeaderRows(){
  const h=(txt,col,span=1,o={})=>lfCell(txt,{col,span,size:14,...o});
  const g={shade:LF_COLORS.drums};
  const rows=[];
  rows.push(lfRow([
    h('Drums / Tins',0,1,{bold:true,size:16,...g}),h('Kind of Oil',1,3,g),h('Size',4,1,g),
    h('Replenishment Plan',5,4,g),h('Transferred to Tank',9,3,g),h('Actual Quantity',12,4,g)
  ],{height:300}));
  rows.push(lfRow([
    h('Container',0,1,{borders:B4}),h('',1,3,{borders:B4}),h('( L )',4,1,{borders:B4}),
    h('No. of Containers',5,2,{borders:B4}),h('Quantity ( L )',7,2,{borders:B4}),h('Tank / Remarks',9,3,{borders:B4}),
    h('No. of Containers',12,2,{borders:B4}),h('Quantity ( L )',14,2,{borders:B4})
  ],{height:300}));
  return rows;
}
export function lfDrumRow(dr={}){
  const c=(txt,col,span=1,o={})=>lfCell(txt,{col,span,size:16,...o});
  const plan={shade:LF_COLORS.planYellow};
  return lfRow([
    c(dr.type||'',0,1,{bold:true,align:'left'}),c(dr.kind||'',1,3,{align:'left'}),c(lfNum(dr.sizeL,0),4),
    c(lfNum(dr.planCount,0),5,2,plan),c(lfNum(dr.planL,0),7,2,{...plan,bold:true}),c(dr.tank||'',9,3),
    c('',12,2),c('',14,2)
  ],{height:380});
}
export function lfDrumRows(drums=[],o={}){
  const minRows=o.minRows??3,rows=drums.map(lfDrumRow);
  while(rows.length<minRows)rows.push(lfDrumRow({}));
  return rows;
}

/* Remarks box + signature line (prepared by / checked by / date). */
export function lfFooterRows(d={}){
  const gap=()=>lfRow([lfCell('',{col:0,span:16,borders:'none'})],{height:200});
  const lab=(txt,col,span=1,o={})=>lfCell(txt,{col,span,borders:'none',align:'left',size:16,...o});
  const ul=(txt,col,span=1)=>lfCell(txt,{col,span,borders:UL,align:'center',size:16});
  return [
    gap(),
    lfRow([lfCell('',{col:0,span:16,align:'left',valign:'top',xml:lfPara(['Remarks:',d.remarks||''],{align:'left',size:16,bold:false})})],{height:900}),
    gap(),gap(),
    lfRow([
      lab('Prepared by (Engineer):',0),ul(d.preparedBy||'',1,4),lab('',5),
      lab('Checked by (Chief Engineer):',6,3),ul(d.checkedBy||'',9,3),lab('',12),
      lab('Date:',13,1,{align:'right'}),ul(d.signDate||'',14,2)
    ],{height:360}),
    lfRow([lfCell('Form S-082001-02FRM',{col:0,span:16,borders:'none',align:'right',italic:true,size:12})],{height:240})
  ];
}

/* The whole form as ONE table (header, bulk table, drum/tin table, remarks, signatures). */
export function lfFormRows(d={},tanks=[],drums=[],o={}){
  return [
    ...lfFormRowsChunk1(d),...lfBulkRows(tanks,o),
    lfRow([lfCell('',{col:0,span:16,borders:'none'})],{height:160}),
    ...lfDrumHeaderRows(),...lfDrumRows(drums,o),
    ...lfFooterRows(d)
  ];
}
export function lfFormBody(d={},tanks=[],drums=[],o={}){return lfTable(lfFormRows(d,tanks,drums,o));}
/* landscape A4, 720-twip margins (page text width = LF_PAGE_W) */
export const LF_SECT_PR='<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
/* Complete word/document.xml for the stand-alone form (chunk 4 wraps it in the .docx package). */
export function lfFormDocumentXml(d={},tanks=[],drums=[],o={}){
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${lfFormBody(d,tanks,drums,o)}${LF_SECT_PR}</w:body></w:document>`;
}

/* ---- CHUNK 4 helpers: one form page per replenishment port, and the data mapping from a calculated stop ---- */
/* pages = [{header, tanks, drums}] -> a single document.xml with a page break between forms */
export function lfFormsDocumentXml(pages=[],o={}){
  const PB='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const body=pages.map(p=>lfFormBody(p.header||{},p.tanks||[],p.drums||[],o)).join(PB);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}${LF_SECT_PR}</w:body></w:document>`;
}
/* Pure mapping: calculated stop -> one form page, or null when no lube oil is replenished/pumped at that stop.
   stop = a calculateVoyage result row; lubes = [{id,name}] (lube products). Litres are converted to m3 / kl.
   "After" = before + planned quantity into that tank (port consumption is not netted off, as on the paper form). */
export function lfPageFromStop(stop,lubes,groupLabel){
  const L=1000,tanks=[],drums=[];
  for(const p of lubes){
    const bi=stop.bunkerInfo?.[p.id];if(!bi)continue;
    const name=groupLabel?groupLabel(p.id):p.name;
    for(const a of (bi.allocations||[])){
      if(!(a.quantity>0))continue;
      const before=(stop.tankAtArrival||[]).find(t=>t.id===a.tankId);if(!before)continue;
      const cap=Number(before.capacity)||0,b=Number(before.rob)||0,after=b+a.quantity;
      tanks.push({kind:name,tank:before.name,capM3:cap/L,beforeM3:b/L,planKl:a.quantity/L,afterKl:after/L,afterPct:cap>0?after/cap*100:''});
    }
    if(bi.mode==='drums'&&bi.drumReceived>0)drums.push({type:'Drums',kind:name,planL:bi.drumReceived});
    if(bi.mode==='drums'&&bi.transferred>0){
      const names=(bi.allocations||[]).map(a=>(stop.tankAtArrival||[]).find(t=>t.id===a.tankId)?.name).filter(Boolean).join(', ');
      drums.push({type:'Drums',kind:name+' (pump-over)',planL:bi.transferred,tank:names});
    }
  }
  if(!tanks.length&&!drums.length)return null;
  return{header:{port:stop.port},tanks,drums};
}
