import {empty,uid,groupFromFilename,localDate,startDaily,validate,fileSnapshot} from './core.mjs';
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/package/2006/relationships';
const META='xl/worksheets/asistencia_app.xml';
const enc=new TextEncoder(),dec=new TextDecoder();
const parse=s=>{const d=new DOMParser().parseFromString(s,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('Excel dañado.');return d;};
const xml=d=>new XMLSerializer().serializeToString(d);
const all=(d,n)=>Array.from(d.getElementsByTagNameNS('*',n));
const get=(zip,path)=>{const e=XLSX.CFB.find(zip,'/'+path);if(!e)throw Error('El Excel está incompleto.');return dec.decode(new Uint8Array(e.content));};
const put=(zip,path,s)=>XLSX.CFB.utils.cfb_add(zip,'/'+path,enc.encode(s));
const zipRead=bytes=>XLSX.CFB.read(new Uint8Array(bytes),{type:'array'});
function b64(bytes){let s='';for(const b of new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s);}
function unb64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
export function idoceoRows(data){
 const info=data.idoceo,book=XLSX.read(unb64(info.base),{type:'array'}),rows=XLSX.utils.sheet_to_json(book.Sheets[info.sheetName],{header:1,defval:''});
 for(const student of data.students)if(info.rowMap[student.id])rows[info.rowMap[student.id]-1][0]=student.name;
 let next=rows[0].length;
 for(const s of data.sessions.filter(s=>s.groupId===info.groupId)){const col=s.nativeColumn??next++;rows[0][col]=s.date.slice(8)+'/'+s.date.slice(5,7);for(const [id,r] of Object.entries(info.rowMap))rows[r-1][col]=({presente:'✔️',ausente:'❌',retraso:'⌛️',justificado:'Justificado',pendiente:''})[s.records[id]?.status]||'';}
 return [['','Alumno','',...rows[0].slice(1).map(x=>String(x).trim())],...Object.values(info.rowMap).map(r=>['',rows[r-1][0],'',...rows[r-1].slice(1)])];
}
function textCell(doc,ref,value,style){const c=doc.createElementNS(NS,'c');c.setAttribute('r',ref);c.setAttribute('t','inlineStr');if(style)c.setAttribute('s',style);const is=doc.createElementNS(NS,'is'),t=doc.createElementNS(NS,'t');t.setAttribute('xml:space','preserve');t.textContent=value;is.append(t);c.append(is);return c;}
export function readIdoceo(bytes,filename){
 const zip=zipRead(bytes);
 if(XLSX.CFB.find(zip,'/'+META)){
  const meta=parse(get(zip,META));let payload;try{payload=JSON.parse(all(meta,'t').map(t=>t.textContent).join(''));validate(payload.data);}catch{throw Error('El registro QR del Excel está dañado.');}
  const book=XLSX.read(bytes,{type:'array'}),sheet=book.Sheets[payload.data.idoceo.sheetName];
  if(!sheet||JSON.stringify(XLSX.utils.sheet_to_json(sheet,{header:1,defval:''}))!==JSON.stringify(payload.values))throw Error('El Excel se modificó fuera de la app. Abre la última copia guardada por Asistencia para conservar los QR y registros.');
  payload.data.idoceo.filename=filename;
  return payload.data;
 }
 const name=groupFromFilename(filename);if(!name)throw Error('El nombre debe indicar el grupo, por ejemplo idoceo_Grupo_I.xlsx.');
 const book=XLSX.read(bytes,{type:'array'});
 if(book.SheetNames.length!==1||book.SheetNames[0]!=='Asistencia')throw Error('Exporta desde iDoceo la hoja Asistencia con nombres en la primera columna y fechas a continuación.');
 const sheet=book.Sheets.Asistencia,rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
 if(rows[0]?.[0]||!rows[0]?.slice(1).some(v=>/^\s*\d{2}\/\d{2}\s*$/.test(String(v))))throw Error('No se reconoce la columna de asistencia de iDoceo.');
 const d=empty(),g={id:uid(),name};d.groups.push(g);const rowMap={};const names=new Set();
 for(let r=1;r<rows.length;r++){const name=String(rows[r][0]||'').trim();if(!name)continue;if(names.has(name))throw Error('Hay nombres repetidos. Añade un identificador al nombre en iDoceo antes de exportar.');names.add(name);const s={id:uid(),groupId:g.id,name,code:'',qr:''};d.students.push(s);rowMap[s.id]=r+1;}
 if(!d.students.length)throw Error('No hay alumnos en el archivo.');
 const workbook=parse(get(zip,'xl/workbook.xml')),rels=parse(get(zip,'xl/_rels/workbook.xml.rels'));
 const rid=all(workbook,'sheet')[0].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
 const target=all(rels,'Relationship').find(r=>r.getAttribute('Id')===rid)?.getAttribute('Target');
 if(!target||target.includes('..'))throw Error('Estructura de Excel no compatible.');
 const sheetPath=target.startsWith('/')?target.slice(1):'xl/'+target;
 d.idoceo={base:b64(bytes),filename,groupId:g.id,sheetName:'Asistencia',sheetPath,rowMap};
 // iDoceo exports day/month as text, without a year. Only today's column
 // becomes an editable session; older columns remain untouched in the template.
 const today=localDate(),label=today.slice(8)+'/'+today.slice(5,7),columns=rows[0].map((v,i)=>String(v).trim()===label?i:-1).filter(i=>i>0);
 if(columns.length>1)throw Error('El Excel tiene más de una columna con la fecha de hoy. Conserva una sola antes de cargarlo.');
 if(columns.length){const {session:s}=startDaily(d,g.id,today);s.nativeColumn=columns[0];const now=new Date().toISOString();for(const a of d.students){const value=String(rows[rowMap[a.id]-1][s.nativeColumn]||'').trim().replace(/\uFE0F/g,'');const status={'✔':'presente','✅':'presente','❌':'ausente','⌛':'retraso','⏳':'retraso','':'pendiente'}[value];if(!status)throw Error('La asistencia de hoy contiene un símbolo no reconocido.');s.records[a.id]={status,time:null,updated:now,source:'manual'};}s.closed=true;s.finalizedAt=now;}
 return validate(d);
}
export function writeIdoceo(data){
 validate(data);const info=data.idoceo,zip=zipRead(unb64(info.base)),doc=parse(get(zip,info.sheetPath));
 const rows=all(doc,'row'),header=rows.find(r=>r.getAttribute('r')==='1');
 for(const student of data.students){const r=info.rowMap[student.id],row=rows.find(row=>Number(row.getAttribute('r'))===r);if(!row)continue;const old=all(row,'c').find(c=>c.getAttribute('r')==='A'+r);const cell=textCell(doc,'A'+r,student.name,old?.getAttribute('s'));if(old)old.replaceWith(cell);else row.prepend(cell);}
 const cells=all(header,'c'),colIndex=ref=>XLSX.utils.decode_cell(ref).c;
 let last=Math.max(...cells.map(c=>colIndex(c.getAttribute('r'))));
 const template=last;const columns=all(doc,'cols')[0];
 for(const session of data.sessions.filter(s=>s.groupId===info.groupId)){
  const col=session.nativeColumn??++last,letter=XLSX.utils.encode_col(col);last=Math.max(last,col);
  for(const row of rows){const r=Number(row.getAttribute('r')),source=all(row,'c').find(c=>colIndex(c.getAttribute('r'))===template);const old=all(row,'c').find(c=>colIndex(c.getAttribute('r'))===col);if(old)old.remove();
   let value='';if(r===1)value='\n'+session.date.slice(8)+'/'+session.date.slice(5,7);else{const studentId=Object.keys(info.rowMap).find(id=>info.rowMap[id]===r);if(studentId)value=({presente:' ✔️',ausente:' ❌',retraso:' ⌛️',justificado:'Justificado',pendiente:''})[session.records[studentId]?.status]||'';}
   row.append(textCell(doc,letter+r,value,source?.getAttribute('s')));
  }
  if(columns){for(const c of all(columns,'col'))if(Number(c.getAttribute('min'))===col+1)c.remove();const source=all(columns,'col').find(c=>Number(c.getAttribute('min'))===template+1);if(source){const c=source.cloneNode(true);c.setAttribute('min',col+1);c.setAttribute('max',col+1);columns.append(c);}}
 }
 // Keep cell and column order valid when updating an existing date.
 for(const row of rows)for(const c of all(row,'c').sort((a,b)=>colIndex(a.getAttribute('r'))-colIndex(b.getAttribute('r'))))row.append(c);
 if(columns)for(const c of all(columns,'col').sort((a,b)=>+a.getAttribute('min')-+b.getAttribute('min')))columns.append(c);
 all(doc,'dimension')[0].setAttribute('ref',`A1:${XLSX.utils.encode_col(last)}${Math.max(...rows.map(r=>+r.getAttribute('r')))}`);
 put(zip,info.sheetPath,xml(doc));
 const wb=parse(get(zip,'xl/workbook.xml')),rels=parse(get(zip,'xl/_rels/workbook.xml.rels')),types=parse(get(zip,'[Content_Types].xml'));
 const sheet=wb.createElementNS(NS,'sheet');sheet.setAttribute('name','Datos_QR');sheet.setAttribute('sheetId','999');sheet.setAttribute('state','hidden');sheet.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','r:id','rIdAsistencia');all(wb,'sheets')[0].append(sheet);
 const rel=rels.createElementNS(REL,'Relationship');rel.setAttribute('Id','rIdAsistencia');rel.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet');rel.setAttribute('Target','worksheets/asistencia_app.xml');rels.documentElement.append(rel);
 const type=types.createElementNS(types.documentElement.namespaceURI,'Override');type.setAttribute('PartName','/'+META);type.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');types.documentElement.append(type);
 put(zip,'xl/workbook.xml',xml(wb));put(zip,'xl/_rels/workbook.xml.rels',xml(rels));put(zip,'[Content_Types].xml',xml(types));
 const preview=XLSX.read(XLSX.CFB.write(zip,{type:'array',fileType:'zip'}),{type:'array'});
 const payload=JSON.stringify({data:fileSnapshot(data),values:XLSX.utils.sheet_to_json(preview.Sheets[info.sheetName],{header:1,defval:''})});
 const meta=parse(`<worksheet xmlns="${NS}"><sheetData/></worksheet>`),body=all(meta,'sheetData')[0];
 for(let i=0,r=1;i<payload.length;r++){let end=Math.min(i+20000,payload.length);if(end<payload.length&&/[\uD800-\uDBFF]/.test(payload[end-1]))end--;const row=meta.createElementNS(NS,'row');row.setAttribute('r',r);row.append(textCell(meta,'A'+r,payload.slice(i,end)));body.append(row);i=end;}
 put(zip,META,xml(meta));return XLSX.CFB.write(zip,{type:'array',fileType:'zip',compression:true});
}
