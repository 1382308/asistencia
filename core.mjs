export const empty = () => ({version:1,revision:0,groups:[],students:[],sessions:[]});
export const statusSymbol = status => ({presente:'✔️',ausente:'❌',retraso:'⌛️'})[status] || status;
const attended = status => ['presente','retraso'].includes(status);
export const uid = () => crypto.randomUUID();
export function bindQR(d,id,qr){
 if(typeof qr!=='string'||!qr.length||qr.length>2048) throw Error('QR vacío o demasiado largo.');
 const s=d.students.find(s=>s.id===id); if(!s) throw Error('Elige un alumno.');
 if(d.students.some(s=>s.id!==id&&s.qr===qr)) throw Error('Este QR ya está asociado a otro alumno.');
 s.qr=qr;
}
export function mark(d,sessionId,studentId,status='presente',source='manual',now=new Date().toISOString()){
 const s=d.sessions.find(s=>s.id===sessionId); if(!s||!s.roster.some(r=>r.id===studentId)) throw Error('Alumno fuera de esta sesión.');
 if(s.closed)throw Error('La asistencia ya está finalizada. Reábrela para corregirla.');
 if(!['presente','ausente','retraso','justificado','pendiente'].includes(status)) throw Error('Estado inválido.');
 const old=s.records[studentId];
 if(source==='qr'&&attended(old?.status)) return false;
 s.records[studentId]={status,time:attended(status)?(attended(old?.status)?old.time:now):null,updated:now,source}; return true;
}
export function scan(d,sessionId,qr){
 const student=d.students.find(s=>s.qr===qr); if(!student) throw Error('QR sin asociar. Ve a Ajustes → Asociar códigos QR para vincularlo.');
 const changed=mark(d,sessionId,student.id,'presente','qr');return {student,changed};
}
export function newSession(d,groupId,title,date){
 if(!d.groups.some(g=>g.id===groupId))throw Error('Crea o elige un grupo.');
 const roster=d.students.filter(s=>s.groupId===groupId).map(({id,name,code})=>({id,name,code}));
 if(!roster.length)throw Error('Añade alumnos antes de crear la sesión.');
 if(!title.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Escribe un nombre y una fecha.');
 const s={id:uid(),groupId,title:title.trim(),date,roster,records:{}};d.sessions.push(s);return s;
}
export function parseCSV(text){
 text=text.replace(/^\uFEFF/,''); const first=text.split(/\r?\n/)[0]; const delimiter=first.includes('\t')?'\t':first.includes(';')?';':',';
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(!quoted&&field.length)throw Error('Comillas inválidas en CSV.');else quoted=!quoted;}else if(!quoted&&(c===delimiter||c==='\n'||c==='\r')){row.push(field);field='';if(c!==delimiter){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x.trim()))rows.push(row);row=[];}}else field+=c;}
 if(quoted)throw Error('CSV con comillas sin cerrar.');row.push(field);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
export function importRoster(d,groupId,text){
 if(!d.groups.some(g=>g.id===groupId))throw Error('Elige un grupo.');
 const rows=parseCSV(text);const headers=rows.shift()?.map(x=>x.trim().toLowerCase());const ni=headers?.indexOf('nombre');if(ni<0||ni===undefined)throw Error('La primera fila debe incluir nombre; opcionales: matricula, qr.');
 const ci=headers.indexOf('matricula'),qi=headers.indexOf('qr');const added=[];
 for(const [i,r] of rows.entries()){
 const name=(r[ni]||'').trim(),code=ci<0?'':(r[ci]||'').trim(),qr=qi<0?'':r[qi]||'';
 if(!name)throw Error(`Fila ${i+2}: falta el nombre.`);
 if(code&&[...d.students,...added].some(s=>s.groupId===groupId&&s.code===code))throw Error(`Fila ${i+2}: matrícula repetida (${code}). No se importó la lista.`);
 if(qr&&[...d.students,...added].some(s=>s.qr===qr))throw Error(`Fila ${i+2}: QR repetido. No se importó la lista.`);
 if(name.length>300||code.length>200||qr.length>2048)throw Error(`Fila ${i+2}: dato demasiado largo.`);
 added.push({id:uid(),groupId,name,code,qr});
 }if(!added.length)throw Error('La lista no contiene alumnos.');d.students.push(...added);return added.length;
}
export function validate(d){
 const fail=()=>{throw Error('El archivo no es un respaldo válido de Asistencia.');};
 const str=(s,n=300)=>typeof s==='string'&&s.length<=n; const id=s=>str(s,100)&&/^[\w-]+$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
 if(!d||d.version!==1||!Number.isSafeInteger(d.revision)||d.revision<0||!['groups','students','sessions'].every(k=>Array.isArray(d[k])&&d[k].length<=50000))fail();
 const ids=new Set(); for(const a of [d.groups,d.students,d.sessions])for(const x of a){if(!x||!id(x.id)||ids.has(x.id))fail();ids.add(x.id);}
 for(const g of d.groups)if(!str(g.name)||!g.name.trim())fail();
 const groupIds=new Set(d.groups.map(g=>g.id)),studentIds=new Set(d.students.map(s=>s.id)),qrs=new Set();
 for(const s of d.students){if(!groupIds.has(s.groupId)||!str(s.name)||!s.name.trim()||!str(s.code,200)||!str(s.qr,2048)||s.qr&&qrs.has(s.qr))fail();if(s.qr)qrs.add(s.qr);}
 const date=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
 for(const s of d.sessions){if(!groupIds.has(s.groupId)||!str(s.title)||!s.title.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||!date(s.date)||!Array.isArray(s.roster)||!s.records||typeof s.records!=='object'||Array.isArray(s.records))fail();const seen=new Set();if(s.closed!==undefined&&typeof s.closed!=='boolean')fail();if(s.finalizedAt!==undefined&&!date(s.finalizedAt))fail();if(s.closed&&!s.finalizedAt)fail();
 for(const r of s.roster){if(!r||!studentIds.has(r.id)||seen.has(r.id)||!str(r.name)||!str(r.code,200))fail();seen.add(r.id);}
 for(const [k,r]of Object.entries(s.records))if(!seen.has(k)||!r||!['presente','ausente','retraso','justificado','pendiente'].includes(r.status)||!['qr','manual'].includes(r.source)||!date(r.updated)||(attended(r.status)?r.time!==null&&!date(r.time):r.time!==null))fail();
 }return d;
}
export function exportCSV(d,sessions=d.sessions){
 const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const rows=[['grupo','sesion','fecha','matricula','nombre','estado','hora_local','hora_iso','origen']];
 for(const s of sessions)for(const r of s.roster){const a=s.records[r.id]; rows.push([d.groups.find(g=>g.id===s.groupId)?.name,s.title,s.date,r.code,r.name,statusSymbol(a?.status||'pendiente'),a?.time?new Date(a.time).toLocaleString('es-MX'):'',a?.time||'',a?.source||'']);}
 return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}

export function localDate(now=new Date()){return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
export function dailySession(d,groupId,date=localDate()){return d.sessions.filter(s=>s.groupId===groupId&&s.date===date).at(-1);}
export function startDaily(d,groupId,date=localDate()){
 const existing=dailySession(d,groupId,date);if(existing)return {session:existing,created:false};
 return {session:newSession(d,groupId,'Asistencia diaria',date),created:true};
}
export function finishDaily(d,id,now=new Date().toISOString()){
 const s=d.sessions.find(s=>s.id===id);if(!s)throw Error('Inicia la asistencia primero.');if(s.closed)return s;
 for(const r of s.roster)if(!s.records[r.id]||s.records[r.id].status==='pendiente')mark(d,id,r.id,'ausente','manual',now);
 s.closed=true;s.finalizedAt=now;return s;
}
export function reopenDaily(d,id){const s=d.sessions.find(s=>s.id===id);if(!s)throw Error('No existe el registro.');s.closed=false;return s;}
export function prepareRoster(text,groupName=''){
 const rows=parseCSV(text);if(!rows.length)throw Error('La lista está vacía.');
 const headers=rows[0].map(x=>x.trim().toLowerCase());
 if(headers.includes('grupo')&&headers.includes('nombre'))return text;
 const named=headers.findIndex(x=>['nombre','nombre completo','alumno'].includes(x));
 const hasHeader=named>=0;const names=hasHeader?rows.slice(1):rows;
 if(!hasHeader&&names.some(r=>r.slice(1).some(x=>x.trim())))throw Error('Este CSV tiene columnas sin identificar. Usa encabezados grupo,nombre o un listado de iDoceo con nombres y columnas vacías.');
 if(!groupName.trim())throw Error('Selecciona un archivo como idoceo_Grupo_I.csv para obtener el grupo, o pega un CSV con columnas grupo,nombre.');
 const cell=x=>'"'+String(x).replaceAll('"','""')+'"';
 const output=[['grupo','nombre','matricula','qr']];
 for(const row of names){const name=(row[hasHeader?named:0]||'').trim();if(!name)throw Error('Hay una fila con datos pero sin nombre.');const get=key=>hasHeader&&headers.includes(key)?row[headers.indexOf(key)]||'':'';output.push([groupName.trim(),name,get('matricula'),get('qr')]);}
 return output.map(row=>row.map(cell).join(',')).join('\r\n');
}
export function groupFromFilename(name){
 if(!/\.(csv|tsv|xlsx)$/i.test(name))return '';
 const stem=name.replace(/\.(csv|tsv|xlsx)$/i,'').replace(/^idoceo[ _-]+/i,'').trim();
 const match=stem.match(/^grupo[ _-]+(.+)$/i);if(!match)return '';
 const suffix=match[1].replace(/[_]+/g,' ').trim();return suffix?`Grupo ${suffix}`:'';
}
export function importRosterFile(d,text,filename){
 const group=groupFromFilename(filename);if(!group)throw Error('No se reconoce el grupo en el nombre del archivo. Usa, por ejemplo, idoceo_Grupo_I.csv o Grupo_II.csv.');
 const rows=parseCSV(text),h=rows[0]?.map(x=>x.trim().toLowerCase());
 if(h?.includes('grupo')&&h.includes('nombre')){
  const index=h.indexOf('grupo');if(rows.slice(1).some(r=>(r[index]||'').trim().toLowerCase()!==group.toLowerCase()))throw Error('El grupo dentro del CSV no coincide con el nombre del archivo. Revisa el archivo antes de cargarlo.');
 }
 return importGroups(d,text,group);
}
export function importGroups(d,text,groupName=''){
 text=prepareRoster(text,groupName);
 const next=structuredClone(d),rows=parseCSV(text),h=rows.shift()?.map(x=>x.trim().toLowerCase());
 if(!h||!h.includes('grupo')||!h.includes('nombre'))throw Error('El CSV debe tener encabezados grupo,nombre. Opcionales: matricula,qr.');
 if(!rows.length)throw Error('La lista está vacía.');
 const norm=x=>x.trim().toLocaleLowerCase('es');let added=0,skipped=0;const seen=new Set();
 for(const [i,row]of rows.entries()){
 const get=k=>h.includes(k)?(row[h.indexOf(k)]||'').trim():'';const group=get('grupo'),name=get('nombre'),code=get('matricula'),qr=h.includes('qr')?(row[h.indexOf('qr')]||''):'';
 if(!group||!name)throw Error(`Fila ${i+2}: faltan grupo o nombre.`);
 if(group.length>120||name.length>300||code.length>200||qr.length>2048)throw Error(`Fila ${i+2}: dato demasiado largo.`);
 let g=next.groups.find(g=>norm(g.name)===norm(group));if(!g){g={id:uid(),name:group};next.groups.push(g);}
 const key=JSON.stringify([g.id,code?'code':'name',code||norm(name)]);if(seen.has(key))throw Error(`Fila ${i+2}: alumno repetido. Para homónimos usa matrículas distintas.`);seen.add(key);
 const matches=next.students.filter(s=>s.groupId===g.id&&(code?s.code===code:norm(s.name)===norm(name)));
 if(matches.length>1)throw Error(`Fila ${i+2}: nombre ambiguo. Usa matrícula.`);
 if(matches.length){const old=matches[0];if(qr&&old.qr&&qr!==old.qr)throw Error(`Fila ${i+2}: el alumno ya tiene otro QR. Cámbialo en Ajustes.`);if(qr)bindQR(next,old.id,qr);skipped++;continue;}
 const student={id:uid(),groupId:g.id,name,code,qr:''};next.students.push(student);if(qr)bindQR(next,student.id,qr);added++;
 }validate(next);d.groups=next.groups;d.students=next.students;return {added,skipped};
}
export function exportDailyCSV(d,groupId){
 const sessions=d.sessions.filter(s=>s.groupId===groupId).slice().sort((a,b)=>a.date.localeCompare(b.date));
 const roster=new Map(d.students.filter(s=>s.groupId===groupId).map(s=>[s.id,s]));for(const s of sessions)for(const r of s.roster)if(!roster.has(r.id))roster.set(r.id,r);
 const counts=new Map();const headings=sessions.map(s=>{const n=(counts.get(s.date)||0)+1;counts.set(s.date,n);return n===1?s.date:`${s.date} (${n})`;});
 const rows=[['grupo','nombre','matricula',...headings]];
 for(const r of roster.values())rows.push([d.groups.find(g=>g.id===groupId)?.name,r.name,r.code,...sessions.map(s=>!s.roster.some(x=>x.id===r.id)?'':statusSymbol(s.records[r.id]?.status||'pendiente'))]);
 const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
export function linkAndScan(d,sessionId,studentId,qr){
 const s=d.sessions.find(s=>s.id===sessionId);if(!s||s.closed||!s.roster.some(r=>r.id===studentId))throw Error('El alumno no pertenece a una asistencia abierta.');
 const student=d.students.find(s=>s.id===studentId);if(student.qr&&student.qr!==qr)throw Error('Este alumno ya tiene otro QR. Corrígelo desde Archivo.');
 bindQR(d,studentId,qr);return scan(d,sessionId,qr);
}
