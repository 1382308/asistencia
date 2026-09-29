export const empty = () => ({version:1,revision:0,groups:[],students:[],sessions:[]});
// Recent files are local workspace state, never part of a group's Excel.
export function fileSnapshot(data){const {recent,...snapshot}=data;return structuredClone(snapshot);}
export function fileKey(data){return data.groups.map(g=>g.name.trim().normalize('NFC').toLocaleLowerCase('es')).sort().join('|');}
export function sameClassroomData(left,right){
 const snapshot=data=>{
  const groups=new Map(data.groups.map(g=>[g.id,g.name]));
  return {
   groups:data.groups.map(g=>g.name),
   students:data.students.map(s=>[groups.get(s.groupId),s.name,s.code||'',s.qr||'',s.preferredName||'']),
   sessions:data.sessions.map(s=>[
    groups.get(s.groupId),s.title,s.date,Boolean(s.closed),s.nativeColumn??null,
    s.roster.map(r=>{const record=s.records[r.id];return [r.name,r.code||'',record?.status||'pendiente',record?.time??null,record?.source||''];})
   ])
  };
 };
 return JSON.stringify(snapshot(left))===JSON.stringify(snapshot(right));
}
export function recentFiles(data){return [fileSnapshot(data),...(data.recent||[])].filter(d=>d.students.length);}
export function selectFile(current,incoming){
 const next=fileSnapshot(incoming),key=fileKey(next);
 next.recent=recentFiles(current).filter(d=>fileKey(d)!==key);
 next.revision=current.revision;return next;
}
export const statusSymbol = status => ({presente:'✔️',ausente:'❌',retraso:'⌛️'})[status] || status;
const attended = status => ['presente','retraso'].includes(status);
export const uid = () => crypto.randomUUID();
const validPreferredName = name => typeof name==='string'&&name.length<=300&&Boolean(name.trim());
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
export function importRosterCSV(text,groupName=''){
 const group=String(groupName||'').trim();
 if(!group||group.length>120)throw Error('Escribe el nombre del grupo (máximo 120 caracteres).');
 const rows=parseCSV(text);
 if(!rows.length||rows[0].length!==1||rows[0][0].trim().toLocaleLowerCase('es')!=='nombre')throw Error('Usa la plantilla CSV de una sola columna llamada nombre.');
 const names=rows.slice(1);
 if(!names.length)throw Error('La lista CSV está vacía.');
 const d=empty(),g={id:uid(),name:group},seen=new Set();d.groups.push(g);
 for(const [i,row] of names.entries()){
  if(row.length!==1)throw Error(`Fila ${i+2}: la plantilla solo permite la columna nombre.`);
  const name=(row[0]||'').replace(/\s+/g,' ').trim();
  if(!name)throw Error(`Fila ${i+2}: falta el nombre.`);
  if(name.length>300)throw Error(`Fila ${i+2}: el nombre supera 300 caracteres.`);
  const key=name.normalize('NFC').toLocaleLowerCase('es');
  if(seen.has(key))throw Error(`Fila ${i+2}: el nombre se repite. Completa los apellidos para distinguir a cada alumno.`);
  seen.add(key);d.students.push({id:uid(),groupId:g.id,name,code:'',qr:''});
 }
 return validate(d);
}
export function validate(d){
 const fail=()=>{throw Error('El archivo no es un respaldo válido de Asistencia.');};
 const str=(s,n=300)=>typeof s==='string'&&s.length<=n; const id=s=>str(s,100)&&/^[\w-]+$/.test(s)&&!['__proto__','constructor','prototype'].includes(s);
 if(!d||d.version!==1||!Number.isSafeInteger(d.revision)||d.revision<0||!['groups','students','sessions'].every(k=>Array.isArray(d[k])&&d[k].length<=50000))fail();
 const ids=new Set(); for(const a of [d.groups,d.students,d.sessions])for(const x of a){if(!x||!id(x.id)||ids.has(x.id))fail();ids.add(x.id);}
 for(const g of d.groups)if(!str(g.name)||!g.name.trim())fail();
 const groupIds=new Set(d.groups.map(g=>g.id)),studentIds=new Set(d.students.map(s=>s.id)),qrs=new Set();
 for(const s of d.students){if(!groupIds.has(s.groupId)||!str(s.name)||!s.name.trim()||!str(s.code,200)||!str(s.qr,2048)||s.qr&&qrs.has(s.qr)||s.preferredName!==undefined&&!validPreferredName(s.preferredName))fail();if(s.qr)qrs.add(s.qr);}
 const date=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
 for(const s of d.sessions){if(!groupIds.has(s.groupId)||!str(s.title)||!s.title.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||!date(s.date)||!Array.isArray(s.roster)||!s.records||typeof s.records!=='object'||Array.isArray(s.records))fail();const seen=new Set();if(s.closed!==undefined&&typeof s.closed!=='boolean')fail();if(s.finalizedAt!==undefined&&!date(s.finalizedAt))fail();if(s.closed&&!s.finalizedAt)fail();
 for(const r of s.roster){if(!r||!studentIds.has(r.id)||seen.has(r.id)||!str(r.name)||!str(r.code,200))fail();seen.add(r.id);}
 for(const [k,r]of Object.entries(s.records))if(!seen.has(k)||!r||!['presente','ausente','retraso','justificado','pendiente'].includes(r.status)||!['qr','manual'].includes(r.source)||!date(r.updated)||(attended(r.status)?r.time!==null&&!date(r.time):r.time!==null))fail();
 }return d;
}
export function exportCSV(d,sessions=d.sessions){
 const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const rows=[['grupo','sesion','fecha','nombre','estado','hora_local','hora_iso','origen']];
 for(const s of sessions)for(const r of s.roster){const a=s.records[r.id]; rows.push([d.groups.find(g=>g.id===s.groupId)?.name,s.title,s.date,r.name,statusSymbol(a?.status||'pendiente'),a?.time?new Date(a.time).toLocaleString('es-MX'):'',a?.time||'',a?.source||'']);}
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
export function groupFromFilename(name){
 if(!/\.xlsx$/i.test(name))return '';
 const stem=name.replace(/\.xlsx$/i,'').replace(/^idoceo[ _-]+/i,'').trim();
 const match=stem.match(/^grupo[ _-]+(.+)$/i);if(!match)return '';
 const suffix=match[1].replace(/[_]+/g,' ').trim();return suffix?`Grupo ${suffix}`:'';
}
export function rosterBackupFilename(groupName){
 const safe=String(groupName||'').normalize('NFC').trim()
  .replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').replace(/\s+/g,' ')
  .replace(/[. ]+$/,'').slice(0,80)||'Grupo';
 return `Asistencia - ${safe}.xlsx`;
}
export function exportDailyCSV(d,groupId){
 const sessions=d.sessions.filter(s=>s.groupId===groupId).slice().sort((a,b)=>a.date.localeCompare(b.date));
 const roster=new Map(d.students.filter(s=>s.groupId===groupId).map(s=>[s.id,s]));for(const s of sessions)for(const r of s.roster)if(!roster.has(r.id))roster.set(r.id,r);
 const counts=new Map();const headings=sessions.map(s=>{const n=(counts.get(s.date)||0)+1;counts.set(s.date,n);return n===1?s.date:`${s.date} (${n})`;});
 const rows=[['grupo','nombre',...headings]];
 for(const r of roster.values())rows.push([d.groups.find(g=>g.id===groupId)?.name,r.name,...sessions.map(s=>!s.roster.some(x=>x.id===r.id)?'':statusSymbol(s.records[r.id]?.status||'pendiente'))]);
 const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
export function linkAndScan(d,sessionId,studentId,qr,preferredName){
 const s=d.sessions.find(s=>s.id===sessionId);if(!s||s.closed||!s.roster.some(r=>r.id===studentId))throw Error('El alumno no pertenece a una asistencia abierta.');
 const student=d.students.find(s=>s.id===studentId);if(student.qr&&student.qr!==qr)throw Error('Este alumno ya tiene otro QR. Corrígelo desde Archivo.');
 if(preferredName!==undefined&&!validPreferredName(preferredName))throw Error('Escribe un nombre de entre 1 y 300 caracteres.');
 bindQR(d,studentId,qr);const result=scan(d,sessionId,qr);
 if(preferredName!==undefined)student.preferredName=preferredName.trim();
 return result;
}
