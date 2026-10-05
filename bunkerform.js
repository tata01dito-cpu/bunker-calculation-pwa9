/* bunkerform.js — BUNKER/INTERNAL TRANSFER PLAN & RESULT (Word .docx), laid out like form S-082000-03FRM.
   FULL-FORM TEMPLATE (v2 of chunk 1) + CHUNK 2 data mapping (bottom of file: bfTankSpecs, bfPlannedItems, bfPageFromStop): every block of the Excel sheet is reproduced on one landscape A4 page on a 31-column
   grid (Excel columns A-AE): header, Planned Bunker Oil Details + loading-rate box, Bunker Tank Details / Bunker-Transfer Plan
   table (3-level header, tank rows, TOTAL FOT / DOT rows), signatures, note, remarks, "Tank condition after bunkering" table.
   With no data every value cell is blank. Chunk 3 maps app data into these builders; chunk 4 wires the export button.
   Pure functions (no dependency on app.js). Reuses the OOXML helpers of lubeform.js. */
import { lfEsc, lfRow, LF_COLORS } from './lubeform.js';
import { vcf54B } from './core.js';

/* ---- text: Arial Narrow (the Excel columns are very narrow); the paragraph mark carries the size too, so empty cells stay short ---- */
export function bfRun(text,o={}){
  const p=['<w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow" w:cs="Arial Narrow"/>'];
  if(o.bold)p.push('<w:b/>');if(o.italic)p.push('<w:i/>');if(o.underline)p.push('<w:u w:val="single"/>');
  if(o.color)p.push(`<w:color w:val="${o.color}"/>`);p.push(`<w:sz w:val="${o.size||13}"/>`);
  return `<w:r><w:rPr>${p.join('')}</w:rPr><w:t xml:space="preserve">${lfEsc(text)}</w:t></w:r>`;
}
export function bfPara(lines,o={}){
  const arr=Array.isArray(lines)?lines:[lines];
  const runs=arr.map((t,i)=>(i?'<w:r><w:br/></w:r>':'')+(t===''||t===undefined||t===null?'':bfRun(t,o))).join('');
  const jc=o.align?`<w:jc w:val="${o.align}"/>`:'';
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${jc}<w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:sz w:val="${o.size||13}"/></w:rPr></w:pPr>${runs}</w:p>`;
}
const lfPara=bfPara;

/* ---- grid: Excel column widths A..AE scaled to landscape A4 (15398 twips usable) ---- */
const XL_W=[0.6,10.7,5.6,7.4,7.9,5.0,3.6,2.9,3.6,3.3,6.7,7.6,8.1,6.6,5.7,6.4,7.0,7.6,9.0,8.4,9.0,7.4,7.6,7.9,6.9,7.3,8.0,7.4,9.0,7.9,3.1];
export const BF_NCOLS=XL_W.length;                       // 31
export const BF_PAGE_W=15398;
export const BF_GRID=(()=>{const tot=XL_W.reduce((a,b)=>a+b,0),w=XL_W.map(x=>Math.round(x*BF_PAGE_W/tot));w[w.length-1]+=BF_PAGE_W-w.reduce((a,b)=>a+b,0);return w;})();
export const BF_COLORS={...LF_COLORS,grey:'D9D9D9',input:'FFFFCC',gold:'FFE599',red:'FF0000'};
export const bfCol=s=>[...s].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0)-1;      // 'A'->0 ... 'AE'->30

/* ---- cell / row / table ----
   borders: 'none' | 'all' | {top,bottom,left,right}; each side = 0 (none) | size | [size,'RRGGBB'] */
function bordersXml(b){
  if(b==='none')b={top:0,bottom:0,left:0,right:0};
  if(b===undefined||b==='all')b={top:4,bottom:4,left:4,right:4};
  const side=(n,v)=>{const sz=Array.isArray(v)?v[0]:v,col=Array.isArray(v)?v[1]:'000000';return sz?`<w:${n} w:val="single" w:sz="${sz}" w:space="0" w:color="${col}"/>`:`<w:${n} w:val="nil"/>`;};
  return `<w:tcBorders>${side('top',b.top)}${side('left',b.left)}${side('bottom',b.bottom)}${side('right',b.right)}</w:tcBorders>`;
}
export function bfCell(text,o={}){
  const first=o.col||0,span=o.span||1;
  let w=0;for(let i=first;i<first+span;i++)w+=BF_GRID[i];
  const pr=[`<w:tcW w:w="${w}" w:type="dxa"/>`];
  if(span>1)pr.push(`<w:gridSpan w:val="${span}"/>`);
  if(o.vmerge==='restart')pr.push('<w:vMerge w:val="restart"/>');else if(o.vmerge==='continue')pr.push('<w:vMerge/>');
  pr.push(bordersXml(o.borders));
  if(o.shade)pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>`);
  pr.push(`<w:vAlign w:val="${o.valign||'center'}"/>`);
  const para=o.xml!==undefined?o.xml:lfPara(text??'',{bold:o.bold,align:o.align||'center',size:o.size||13,color:o.color,italic:o.italic,underline:o.underline});
  return `<w:tc><w:tcPr>${pr.join('')}</w:tcPr>${para}</w:tc>`;
}
/* A row = list of {text,col,span,...}; gaps are padded with empty borderless cells so every row covers all 31 columns. */
export function bfRowOf(cells,o={}){
  const list=[...cells].sort((a,b)=>a.col-b.col),out=[];let at=0;
  const pad=(from,to)=>{if(to>from)out.push(bfCell('',{col:from,span:to-from,borders:'none'}));};   // one spanning cell per gap (keeps the file small)
  for(const c of list){pad(at,c.col);out.push(bfCell(c.text,c));at=c.col+(c.span||1);}
  pad(at,BF_NCOLS);
  return lfRow(out,o);
}
export function bfTable(rowsXml){
  const grid=BF_GRID.map(w=>`<w:gridCol w:w="${w}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${BF_PAGE_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="15" w:type="dxa"/><w:right w:w="15" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowsXml.join('')}</w:tbl>`;
}
const gap=h=>bfRowOf([],{height:h,exact:true});                 // empty full-width spacer row
export const bfNum=(v,dp=2)=>{if(v===undefined||v===null||v==='')return '';const x=Number(v);return Number.isFinite(x)?x.toFixed(dp):'';};
/* Long tank / oil names: shrink the type (down to 5 pt) so a name wraps to at most two short lines instead of making the row, and the whole form, taller.
   ~165 half-point-characters fit across one 1100-twip name column (measured with a wider fallback font, so Word with Arial Narrow has spare room). */
export const bfFitSize=(text,base=14,min=10)=>{const L=String(text||'').length;return L<=0?base:Math.max(min,Math.min(base,Math.floor(165/L)));};
export function bfDate(iso,offsetH=0){                           // ISO instant + UTC offset (h) -> "29/Apr/2025"
  if(!iso)return '';const d=new Date(new Date(iso).getTime()+(Number(offsetH)||0)*3600000);if(isNaN(d))return '';
  const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getUTCDate()).padStart(2,'0')}/${M[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
}
const UL={top:0,bottom:4,left:0,right:0};
const lab=(text,c,span=1,o={})=>({text,col:bfCol(c),span,borders:'none',align:'left',size:13,...o});
const val=(text,c,span=1,o={})=>({text,col:bfCol(c),span,borders:UL,align:'center',size:15,...o});

/* ================= BLOCK 1: HEADER (Excel print header + rows 1-3) ================= */
export function bfHeaderRows(d={}){
  return [
    bfRowOf([lab('NYK SMS Manual','A',8,{size:15}),lab('(Rev:2023-02-01)','I',14,{align:'center',size:15}),lab('<S-082000-03 FRM>','W',9,{align:'right',size:15})],{height:230}),
    bfRowOf([lab("Ship's Name:",'A',2,{size:12}),val(d.vessel,'C',4,{shade:BF_COLORS.input,bold:true,size:15}),
      {text:'BUNKER/INTERNAL TRANSFER PLAN & RESULT',col:bfCol('G'),span:16,vmerge:'restart',borders:'none',size:22},
      lab('Date:','W',3,{align:'center',size:12}),val(d.date,'Z',6,{bold:true})],{height:230}),
    bfRowOf([{text:'',col:bfCol('G'),span:16,vmerge:'continue',borders:'none'},lab('Location / Port:','W',3,{align:'center',size:12}),val(d.port,'Z',6,{bold:true})],{height:230}),
    bfRowOf([lab('DRAFT (m) :','T',2,{align:'right',size:12}),lab('FWD :','V',1,{align:'right',size:12}),val('','W',2),
      lab('AFT :','Y',1,{align:'right',size:12}),val('','Z',2),lab('TRIM :','AB',1,{align:'right',size:12}),val('','AC',3)],{height:230})
  ];
}

/* ================= BLOCK 2: PLANNED BUNKER OIL DETAILS + loading-rate box (Excel rows 4-10) =================
   items: [{ name, qtyMt, sulphur }] — only these come from the app; density/temp/factor/volume/times/rates stay blank. */
export function bfPlannedRows(items=[],o={}){
  const minRows=o.minRows??4,H='all';
  const h=(text,c,span,extra={})=>({text,col:bfCol(c),span,size:12,...extra});
  const rate=(label,unit)=>[{text:label,col:bfCol('X'),span:4,borders:'none',align:'right',size:12},
    {text:'',col:bfCol('AB'),span:2,borders:H,shade:BF_COLORS.input},{text:unit,col:bfCol('AD'),span:2,borders:'none',align:'left',size:12}];
  const rows=[bfRowOf([h('Planned Bunker Oil Details','A',22,{shade:BF_COLORS.grey,size:19})],{height:250})];
  rows.push(bfRowOf([h('NAME OF OIL :','A',2),h('QUANTITY (MT) :','C',2),h('DENSITY (g/cm3):','E',2),h('TEMP. (\u2103) :','G',2),h('Temp. Corr. Factor:','I',3),
    h('Volume (m3):','L',2),h('Sulphur %','N',2),h('ESTIMATE TIME OF START / STOP :','P',7),...rate('Rate of loading at start of transfer :','m3/h')],{height:240}));
  const rr=[['Maximum Rate of loading :','m3/h'],['Rate of loading when Topping off :','m3/h'],['Max allowed manifold pressure :','MPa']];
  const n=Math.max(minRows,items.length);
  for(let i=0;i<n;i++){
    const it=items[i]||{},y={shade:BF_COLORS.input};
    const cells=[h(it.name||'','A',2,{...y,align:'left',size:bfFitSize(it.name)}),h(bfNum(it.qtyMt,2),'C',2,{...y,bold:true,size:14}),h('','E',2,y),h('','G',2,y),h('','I',3,y),h('','L',2,y),
      h(it.sulphur===undefined||it.sulphur===null||it.sulphur===''?'':bfNum(it.sulphur,3),'N',2,{...y,size:14}),h('','P',3,y),h('','S',1,y),h('','T',3,y)];
    if(i<rr.length)cells.push(...rate(rr[i][0],rr[i][1]));
    rows.push(bfRowOf(cells,{height:250}));
  }
  return rows;
}

/* ================= BLOCK 3: BUNKER TANK DETAILS / BUNKER-TRANSFER PLAN (Excel rows 11-30) ================= */
const THICK_L=new Set([1,3,5,10,17,21,29]);              // columns that start a group (thick left rule)
const LAST=29;                                           // AD = last column of the table
/* border set for a table cell starting at grid column c, spanning `span`; pos: 'top' | 'mid' | 'bottom' (red box top/bottom) */
function planBorders(c,span,pos){
  const R=BF_COLORS.red,end=c+span-1;
  const b={top:4,bottom:4,left:THICK_L.has(c)?12:4,right:end===LAST?12:4};
  if(c===21)b.left=[12,R]; if(end===28)b.right=[12,R];
  if(c===LAST)b.left=[12,R];
  if(pos==='top'&&c>=21&&end<=28)b.top=[12,R];
  if(pos==='bottom'){b.bottom=12;if(c>=21&&end<=28)b.bottom=[12,R];}
  if(pos==='title'){b.top=12;}
  return b;
}
export function bfTankHeaderRows(o={}){
  const limTxt=Number.isFinite(Number(o.limitPct))&&o.limitPct!==''&&o.limitPct!==null?Number(o.limitPct).toFixed(0):'90';
  const hc=(text,c,span=1,o={})=>({text,col:c,span,borders:planBorders(c,span,o.pos),size:12,...o});   // size 12 = 6 pt narrow
  const G={shade:BF_COLORS.grey};
  const rows=[];
  rows.push(bfRowOf([hc('Bunker Tank Details',1,9,{...G,size:19,pos:'title'}),hc('Bunker/Transfer Plan',10,20,{...G,size:19,pos:'title'})],{height:250}));
  rows.push(bfRowOf([hc('TANK',1,2,{bold:true}),hc('FULL CAPACITY(100%)',3,2,{bold:true}),hc(`FILLING LIMIT (${limTxt}%)`,5,5,{bold:true}),
    hc('Present Tank Condition',10,7,{bold:true,size:14}),hc('Qty to be Added/Transferred',17,4,{bold:true}),
    hc('Estimated Tank Condition After Transferring',21,8,{bold:true,size:14}),hc('FO Additive added',29,1,{vmerge:'restart',size:11})],{height:250}));
  rows.push(bfRowOf([hc('Name',1,1,{vmerge:'restart'}),hc('PLACE',2,1,{vmerge:'restart'}),hc('SOUNDING',3),hc('VOLUME',4),hc('Limit',5),hc('SOUNDING',6,2),hc('VOLUME',8,2),
    hc('SOUNDING',10),hc('VOLUME',11),hc('QUANTITY',12),hc('DENSITY',13),hc('TEMP',14),hc('TEMP COR FAC',15,1,{vmerge:'restart'}),hc('SULPHUR',16),
    hc('SEQUENCE',17),hc('Method of Topping Off*',18,1,{vmerge:'restart',color:BF_COLORS.red,underline:true,size:11}),hc('VOLUME',19),hc('QUANTITY',20),
    hc('SOUNDING',21),hc('VOLUME',22),hc('QUANTITY',23,1,{bold:true}),hc('DENSITY',24),hc('TEMP',25),hc('TEMP COR FACTOR',26,1,{vmerge:'restart'}),hc('SULPHUR',27),hc('% Capacity',28),
    hc('',29,1,{vmerge:'continue'})],{height:230}));
  const u=(t,c,span=1)=>hc(t,c,span,{size:11});
  rows.push(bfRowOf([hc('',1,1,{vmerge:'continue'}),hc('',2,1,{vmerge:'continue'}),u('(m)',3),u('(m3)',4),u('(%)',5),u('(m)',6,2),u('(m3)',8,2),u('(m)',10),u('(m3)',11),u('(MT)',12),u('(g/cm\u00B3)',13),u('C\u00B0',14),
    hc('',15,1,{vmerge:'continue'}),u('(% By Wt.)',16),u('Number',17),hc('',18,1,{vmerge:'continue'}),u('(m3)',19),u('(MT)',20),u('(m)',21),u('(m3)',22),u('(MT)',23),u('(g/cm\u00B3)',24),u('C\u00B0',25),
    hc('',26,1,{vmerge:'continue'}),u('(% By Wt.)',27),u('Tank Filled',28),u('(L)',29)],{height:210}));
  return rows;
}
/* field layout of one body row: [first grid column, span, key] */
const BODY_COLS=[[1,1,'name'],[2,1,'place'],[3,1,'snd'],[4,1,'vol'],[5,1,'limit'],[6,2,'limSnd'],[8,2,'limVol'],[10,1,'pSnd'],[11,1,'pVol'],[12,1,'pQty'],[13,1,'pDen'],[14,1,'pTemp'],[15,1,'pTcf'],[16,1,'pSul'],
  [17,1,'seq'],[18,1,'method'],[19,1,'addVol'],[20,1,'addQty'],[21,1,'aSnd'],[22,1,'aVol'],[23,1,'aQty'],[24,1,'aDen'],[25,1,'aTemp'],[26,1,'aTcf'],[27,1,'aSul'],[28,1,'aPct'],[29,1,'additive']];
const RED_KEYS=new Set(['limit','pSnd','pVol','pQty','pDen','pTemp','pTcf','pSul','aSnd','aSul','aDen']);
/* t: { kind:'data'|'blank'|'total'|'totalGold', name, place, v:{key:text}, pos:'top'|'mid'|'bottom', h } — v is empty for a blank template */
export function bfTankRow(t={}){
  const kind=t.kind||'blank',v=t.v||{};
  const shade=kind==='total'?undefined:(kind==='totalGold'?BF_COLORS.gold:BF_COLORS.input);
  const cells=BODY_COLS.map(([c,span,key])=>{
    let text=key==='name'?(t.name||''):key==='place'?(t.place||''):(v[key]??'');
    if(key==='limit'&&t.limit)text=t.limit;
    return {text,col:c,span,borders:planBorders(c,span,t.pos),shade:(kind==='total'&&c<=2)?undefined:shade,size:key==='name'?bfFitSize(text):14,
      bold:key==='aQty'||key==='limit',color:(RED_KEYS.has(key)&&text!=='')?BF_COLORS.red:undefined,align:key==='name'?'left':'center'};
  });
  return bfRowOf(cells,{height:t.h||210});
}
/* the fixed row skeleton of the Excel sheet: 15 F.O.TK. P | 16 F.O.TK. S | 17 TOTAL | 18 blank | 19 D.O.TK P | 20 D.O.TK. S | 21-22 blank | 23 TOTAL FOT | 24 TOTAL DOT | 25-29 blank | 30 TOTAL */
export const BF_TANK_SKELETON=[
  {kind:'data',name:'F.O.TK.',place:'P',h:300},{kind:'data',name:'F.O.TK.',place:'S',h:280},{kind:'total',name:'TOTAL',h:200},{kind:'blank',h:200},
  {kind:'data',name:'D.O.TK',place:'P',h:290},{kind:'data',name:'D.O.TK.',place:'S',h:290},{kind:'blank'},{kind:'blank'},
  {kind:'total',name:'TOTAL',place:'FOT'},{kind:'totalGold',name:'TOTAL',place:'DOT'},
  {kind:'blank',h:190},{kind:'blank',h:190},{kind:'blank',h:190},{kind:'blank',h:190},{kind:'blank',h:190},{kind:'total',name:'TOTAL',h:200}
];
export function bfTankBodyRows(rowsSpec=BF_TANK_SKELETON){
  return rowsSpec.map((t,i)=>bfTankRow({...t,pos:i===rowsSpec.length-1?'bottom':(i===0?'top':'mid')}));
}

/* ================= BLOCK 4: signatures, note, remarks (Excel rows 31-39, 50-51) ================= */
export function bfSignRows(s={}){
  return [
    bfRowOf([lab('Sign','B',2,{size:11})],{height:150}),
    bfRowOf([lab('MASTER:','B',1,{size:12}),val(s.master||'CAPT.','C',9,{align:'left',size:16}),lab('CHIEF ENGINEER:','L',3,{align:'right',size:15}),val(s.chief||'','O',5,{align:'left',size:16}),
      lab('1AE:','V',3,{align:'right',size:15}),val(s.ae||'','Y',6,{size:16})],{height:260})
  ];
}
export function bfNoteRows(){
  return [bfRowOf([lab('Note: * Method of Topping Off - VALVE : Opening  valve of another Tank.  PUMPING RATE: Reduce pumping rate. OTHERS: (Provide Details in Remarks) ','B',29,{size:15,color:BF_COLORS.red,underline:true})],{height:220})];
}
export function bfRemarksRows(text=''){
  const box={top:4,bottom:4,left:4,right:4};
  return [bfRowOf([{col:1,span:30,borders:box,valign:'top',xml:lfPara(['Remarks:',text],{align:'left',size:14})}],{height:560})];
}

/* ================= BLOCK 5: TANK CONDITION AFTER BUNKERING/TRANSFERRING (Excel rows 41-48) — actual results, blank =================
   r: [{ left:{name,place}, right:{name,place} }] (4 rows). Labels only; every result cell is left blank. */
const RES_KEYS=[[3,1],[4,1],[5,2],[7,2],[9,2],[11,1],[12,1],[13,1],[14,1]];     // left table value cells (D..O)
const RES_KEYS_R=[[17,1],[18,1],[19,1],[20,1],[21,1],[22,1],[23,1],[24,1],[25,1],[26,4]]; // right table value cells (R..AD)
export function bfResultRows(rows){
  const sk=rows||[{left:{name:'FOTK',place:'PORT'},right:{name:'DOTK',place:'P ( C )'}},{left:{name:'FOTK',place:'STBD'},right:{name:'DOTK ',place:'S ( C )'}},{},{}];
  const B=(c,span)=>({top:4,bottom:4,left:(c===1||c===15)?12:4,right:(c+span-1===29)?12:4});
  const hc=(text,c,span=1,o={})=>({text,col:c,span,borders:B(c,span),size:12,...o});
  const out=[];
  out.push(bfRowOf([{text:'TANK CONDITION AFTER BUNKERING/TRANSFERRING',col:1,span:30,borders:{top:12,bottom:4,left:12,right:12},shade:BF_COLORS.grey,size:19}],{height:240}));
  out.push(bfRowOf([hc('TANK',1,2),hc('SOUNDING',3,1,{vmerge:'restart'}),hc('VOLUME',4,1,{vmerge:'restart'}),hc('QUANTITY',5,2,{vmerge:'restart'}),hc('TEMP.',7,2,{vmerge:'restart'}),
    hc('TEMP CORR. FACTOR',9,2,{vmerge:'restart'}),hc('DENSITY',11,1,{vmerge:'restart'}),hc('SULPHUR',12,1,{vmerge:'restart'}),hc('Capacity Tank',13,1,{vmerge:'restart'}),hc('Sequence Number',14,1,{vmerge:'restart'}),
    hc('TANK',15,2),hc('SOUNDING',17,1,{vmerge:'restart'}),hc('VOLUME',18,1,{vmerge:'restart'}),hc('QUANTITY',19,1,{vmerge:'restart'}),hc('TEMP.',20,1,{vmerge:'restart'}),
    hc('TEMP CORR. FACTOR',21,1,{vmerge:'restart'}),hc('DENSITY',22,1,{vmerge:'restart'}),hc('SULPHUR',23,1,{vmerge:'restart'}),hc('Capacity',24,1,{vmerge:'restart'}),hc('Sequence',25,1,{vmerge:'restart'}),
    hc('Remarks',26,4,{vmerge:'restart'})],{height:210}));
  const cont=(c,span=1)=>hc('',c,span,{vmerge:'continue'});
  out.push(bfRowOf([hc('Name',1,1,{vmerge:'restart'}),hc('PLACE',2,1,{vmerge:'restart'}),cont(3),cont(4),cont(5,2),cont(7,2),cont(9,2),cont(11),cont(12),cont(13),cont(14),
    hc('Name',15,1,{vmerge:'restart'}),hc('PLACE',16,1,{vmerge:'restart'}),cont(17),cont(18),cont(19),cont(20),cont(21),cont(22),cont(23),cont(24),cont(25),cont(26,4)],{height:190}));
  const u=(t,c,span=1)=>hc(t,c,span,{size:11});
  out.push(bfRowOf([cont(1),cont(2),u('(m)',3),u('(m3)',4),u('(MT)',5,2),u('(\u2103)',7,2),cont(9,2),u('(g/cm3)',11),u('(% By Wt.)',12),u('Filled(%)',13),cont(14),
    cont(15),cont(16),u('(m)',17),u('(m3)',18),u('(MT)',19),u('(\u2103)',20),cont(21),u('(g/cm3)',22),u('(% By Wt.)',23),u('Tank (%)',24),cont(25),cont(26,4)],{height:190}));
  sk.forEach((r,i)=>{
    const y={shade:BF_COLORS.input},last=i===sk.length-1;
    const cells=[{text:r.left?.name||'',col:1,span:1,borders:B(1,1),...y,align:'left',size:14},{text:r.left?.place||'',col:2,span:1,borders:B(2,1),...y,align:'left',size:14},
      ...RES_KEYS.map(([c,s])=>({text:'',col:c,span:s,borders:B(c,s),...y})),
      {text:r.right?.name||'',col:15,span:1,borders:B(15,1),...y,align:'left',size:14},{text:r.right?.place||'',col:16,span:1,borders:B(16,1),...y,align:'left',size:14},
      ...RES_KEYS_R.map(([c,s])=>({text:'',col:c,span:s,borders:B(c,s),...y}))];
    out.push(bfRowOf(cells.map(c=>last?{...c,borders:{...c.borders,bottom:12}}:c),{height:210}));
  });
  return out;
}

/* ================= WHOLE FORM ================= */
/* d: { vessel, date, port, planned:[{name,qtyMt,sulphur}], tanks:[row specs for bfTankRow] | undefined, remarks, results }  — all optional */
export function bfFormRows(d={}){
  return [
    ...bfHeaderRows(d),
    ...bfPlannedRows(d.planned||[]),
    gap(130),
    ...bfTankHeaderRows({limitPct:d.limitPct}),
    ...bfTankBodyRows(d.tanks||BF_TANK_SKELETON),
    gap(60),
    ...bfSignRows(),
    gap(80),
    ...bfNoteRows(),
    gap(80),
    ...bfRemarksRows(d.remarks||''),
    gap(80),
    ...bfResultRows(d.results),
    gap(40),
    ...bfSignRows()
  ];
}
export const bfFormBody=(d={})=>bfTable(bfFormRows(d));
/* landscape A4, narrow margins (page text width = BF_PAGE_W) */
export const BF_SECT_PR='<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="300" w:right="720" w:bottom="200" w:left="720" w:header="150" w:footer="150" w:gutter="0"/></w:sectPr>';
export function bfDocumentXml(bodyXml){
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${bodyXml}${BF_SECT_PR}</w:body></w:document>`;
}
/* several pages (one per port): bodies joined by page breaks */
export function bfFormsDocumentXml(pages=[{}]){
  const PB='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  return bfDocumentXml(pages.map(bfFormBody).join(PB));
}

/* ================= CHUNK 2: APP DATA -> FORM (tank table, planned oil lines, one page per port) =================
   Input is one row of calculateVoyage().results ("stop"). Fuel (group 'fo') and diesel (group 'do') STORAGE tanks only.
   FILLED from the app: tank name, capacity (m3), filling limit, present volume / quantity / density / temperature / corr. factor / sulphur,
   planned volume + quantity per tank, estimated volume / quantity / sulphur / % capacity after bunkering.
   BLANK (not in the app): place P/S, all soundings, sequence, topping-off method, after-temperature, after corr. factor, additive.
   "After" = before + planned quantity into that tank; port consumption is not netted off (as on the paper form). */
const isNum=v=>v!==undefined&&v!==null&&v!==''&&Number.isFinite(Number(v));
const fx=(v,dp)=>isNum(v)?Number(v).toFixed(dp):'';
const fuelTanksOf=(stop,group)=>(stop.tankAtArrival||[]).filter(t=>t.group===group&&(t.category||'storage')==='storage');
/* one tank -> { name, v:{...}, limit, raw:{numbers for the totals} } */
export function bfTankSpec(t,alloc,after,limitPct){
  const den=isNum(t.density)&&Number(t.density)>0?Number(t.density):undefined;
  const capM3=isNum(t.capacityM3)?Number(t.capacityM3):(den&&isNum(t.capacity)?Number(t.capacity)/den:undefined);
  const byVol=t.robInput!=='mt'&&isNum(t.robVolumeM3);
  const volM3=byVol?Number(t.robVolumeM3):(den&&isNum(t.rob)?Number(t.rob)/den:undefined);
  const tempC=byVol&&isNum(t.robTempC)?Number(t.robTempC):undefined;
  const tcf=den&&tempC!==undefined?vcf54B(den*1000,tempC):undefined;       // ASTM 54B, same factor the app uses for ROB
  const qty=isNum(t.rob)?Number(t.rob):undefined,add=isNum(alloc)&&Number(alloc)>0?Number(alloc):0;
  const planMt=add>0?add:undefined,planM3=add>0&&den?add/den:undefined;
  const aQty=qty!==undefined?qty+add:undefined,aVol=aQty!==undefined&&den?aQty/den:undefined;   // every tank gets an "after" figure (= present when nothing is added), as on the Excel sheet
  const limVol=capM3!==undefined&&isNum(limitPct)?capM3*Number(limitPct)/100:undefined;
  const aPct=aVol!==undefined&&capM3>0?aVol/capM3*100:undefined;
  const aSul=isNum(after&&after.sulphur)?Number(after.sulphur):(isNum(t.sulphur)?Number(t.sulphur):undefined);
  const v={vol:fx(capM3,1),limVol:fx(limVol,2),pVol:fx(volM3,2),pQty:fx(qty,2),pDen:fx(den,4),pTemp:fx(tempC,0),pTcf:fx(tcf,4),pSul:isNum(t.sulphur)?fx(t.sulphur,3):'',
    addVol:fx(planM3,2),addQty:fx(planMt,2),aVol:fx(aVol,2),aQty:fx(aQty,2),aDen:aQty!==undefined?fx(den,4):'',aSul:fx(aSul,3),aPct:aPct!==undefined?fx(aPct,1)+'%':''};
  return{kind:'data',name:t.name||'',place:'',limit:isNum(limitPct)?`${Number(limitPct).toFixed(0)} %`:'',v,
    raw:{capM3,limVol,volM3,qty,planM3,planMt,aVol,aQty}};
}
/* TOTAL row from a list of tank specs; `only` limits which keys are summed (the first TOTAL on the Excel sheet carries only the capacity) */
export function bfTotalSpec(place,specs,kind='total',only){
  const sum=k=>specs.reduce((a,x)=>a+(isNum(x.raw[k])?Number(x.raw[k]):0),0),any=k=>specs.some(x=>isNum(x.raw[k]));
  const m={vol:['capM3',1],limVol:['limVol',2],pVol:['volM3',2],pQty:['qty',2],addVol:['planM3',2],addQty:['planMt',2],aVol:['aVol',2],aQty:['aQty',2]};
  const v={};
  for(const [key,[k,dp]] of Object.entries(m)){if(only&&!only.includes(key))continue;if(any(k))v[key]=fx(sum(k),dp);}
  if(!only&&any('aVol')&&sum('capM3')>0)v.aPct=fx(sum('aVol')/sum('capM3')*100,1)+'%';
  return{kind,name:'TOTAL',place:place||'',v};
}
/* the full row list for the tank table, in the order of the Excel sheet: FO tanks, TOTAL, blank, DO tanks, 2 blanks, TOTAL FOT, TOTAL DOT, blanks, TOTAL.
   Extra tanks beyond two per group simply add rows. */
export function bfTankSpecs(stop,limitPct){
  const planned=g=>Object.fromEntries(((stop.bunkerInfo?.[g]?.allocations)||[]).map(a=>[a.tankId,a.quantity]));
  const mk=g=>{const pl=planned(g);return fuelTanksOf(stop,g).map(t=>bfTankSpec(t,pl[t.id],(stop.tankAfter||[]).find(x=>x.id===t.id),limitPct));};
  const fo=mk('fo'),dos=mk('do'),blank=h=>({kind:'blank',...(h?{h}:{})});
  const rows=[...fo];
  while(rows.length<2)rows.push({kind:'data',name:'',place:'',v:{}});
  rows.push(bfTotalSpec('',fo,'total',['vol']),blank(200));
  const d0=rows.length+0;rows.push(...dos);
  while(rows.length-d0<2)rows.push({kind:'data',name:'',place:'',v:{}});
  rows.push(blank(),blank(),bfTotalSpec('FOT',fo),bfTotalSpec('DOT',dos,'totalGold'));
  /* tanks beyond the two-per-group skeleton use up the spare blank rows so the form still fits one page */
  const extra=Math.max(0,fo.length-2)+Math.max(0,dos.length-2);
  for(let i=0;i<Math.max(0,5-extra);i++)rows.push(blank(190));
  rows.push({kind:'total',name:'TOTAL',place:'',v:{}});
  return rows;
}
/* planned bunker oil lines (Excel rows 6-9): one line per tank receiving fuel or diesel at this stop.
   o.sulphur(group, info) -> the sulphur % of the bunker being received (the caller knows the bunker event); blank when it returns nothing. */
export function bfPlannedItems(stop,o={}){
  const items=[];
  for(const g of ['fo','do']){
    const info=stop.bunkerInfo?.[g];if(!info)continue;
    for(const a of (info.allocations||[])){
      if(!(a.quantity>0))continue;
      const tk=(stop.tankAtArrival||[]).find(t=>t.id===a.tankId);
      items.push({name:(tk&&tk.name)||a.tankName||'',qtyMt:a.quantity,sulphur:o.sulphur?o.sulphur(g,info):undefined});
    }
  }
  return items;
}
/* One form page per port, or null when no fuel / diesel is bunkered at that stop.
   o: { vessel, limitPct (company maximum fill, %), sulphur(group,info) } */
export function bfPageFromStop(stop,o={}){
  const planned=bfPlannedItems(stop,o);
  if(!planned.length)return null;
  /* tanks whose volumes / capacity cannot be shown because no density is entered (the quantities in MT are still filled) */
  const missingDensity=['fo','do'].flatMap(g=>fuelTanksOf(stop,g)).filter(t=>!(isNum(t.density)&&Number(t.density)>0)).map(t=>t.name||'(unnamed tank)');
  return{vessel:o.vessel||'',port:stop.port||'',date:bfDate(stop.arrivalUtc,stop.utcOffset),limitPct:o.limitPct,planned,tanks:bfTankSpecs(stop,o.limitPct),missingDensity};
}
