import {readIdoceo,writeIdoceo,idoceoRows} from './idoceo.mjs';
import {createFileBytes,restoreFileBytes,FILE_NAME,FILE_TYPE} from './file-store.mjs';
import {empty,bindQR,mark,scan,validate,localDate,dailySession,startDaily,finishDaily,reopenDaily,exportDailyCSV,parseCSV,importRosterFile,groupFromFilename,linkAndScan,fileKey,recentFiles,selectFile} from './core.mjs';
const $=id=>document.getElementById(id);let db,data=empty(),groupId='',day=localDate(),busy=false,stream=null,generation=0,pendingQR='',pendingStudentId='',lastScan='',lastAt=0,noticeTimer,sharing=false,home=true,finishedKey='';
const sessionChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('aula-session'):null;
function cameraMessage(text,error=false){$('cameraMessage').className=error?'scan-error':'';$('cameraMessage').textContent=text;}
function notice(text,error=false){clearTimeout(noticeTimer);$('message').textContent=text;$('message').className=error?'error':'';$('message').hidden=false;if($('cameraDialog').open)cameraMessage(text,error);if($('linkDialog').open&&error)$('linkDialog').querySelector('.muted').textContent=text;if($('nameDialog').open&&error)$('nameError').textContent=text;if(!error)noticeTimer=setTimeout(()=>{$('message').hidden=true;},4500);}
const safe=fn=>async e=>{try{await fn(e);}catch(err){notice(err.message||'No se pudo completar la acción.',true);}};
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('aula-asistencia',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Cierra otras ventanas de la app y vuelve a abrirla.'));});}
function read(){return new Promise((resolve,reject)=>{const t=db.transaction('state'),r=t.objectStore('state').get('main');r.onsuccess=()=>resolve(r.result||empty());r.onerror=()=>reject(r.error);});}
function write(next){return new Promise((resolve,reject)=>{let conflict=false;const t=db.transaction('state','readwrite'),s=t.objectStore('state'),r=s.get('main');r.onsuccess=()=>{if((r.result?.revision||0)!==data.revision){conflict=true;t.abort();return;}next.revision=data.revision+1;s.put(next,'main');};t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(Error(conflict?'Hay cambios en otra ventana. Recarga la app antes de continuar.':'No se guardó: almacenamiento no disponible. Guarda un respaldo y libera espacio.'));});}
async function change(fn,dirty=true){if(!db)throw Error('Almacenamiento no disponible.');if(busy)throw Error('Espera a que termine el guardado.');busy=true;$('cancelLink').disabled=$('cancelName').disabled=true;try{const next=structuredClone(data);const result=fn(next);if(dirty)next.exportPending=true;validate(next);await write(next);data=next;render();return result;}finally{busy=false;$('cancelLink').disabled=$('cancelName').disabled=false;renderHome();}}
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function options(select,items,value){select.replaceChildren();for(const [id,label]of items){const option=element('option',label);option.value=id;select.append(option);}select.value=value;}
function session(){return dailySession(data,groupId,day);}
const arrived=s=>Object.values(s?.records||{}).filter(r=>['presente','retraso'].includes(r.status)).length;
async function activateFile(key,action){
 if(sharing||busy)return;stopCamera();
 const selected=recentFiles(data).find(d=>fileKey(d)===key);if(!selected)throw Error('Carga el Excel del grupo.');
 if(fileKey(data)!==key)await change(d=>{const next=selectFile(d,selected);for(const k of Object.keys(d))delete d[k];Object.assign(d,next);},false);
 groupId=data.groups[0]?.id;day=localDate();$('saveStatus').textContent='';
 if(action==='save'){home=true;finishedKey=key;render();await saveFile();return;}
 finishedKey='';await begin();
}
function renderHome(){
 const files=recentFiles(data).sort((a,b)=>a.groups[0].name.localeCompare(b.groups[0].name,'es',{numeric:true}));
 $('logoutButton').disabled=sharing||busy||!files.length;
 $('menuButton').hidden=!files.length;$('homeTitle').hidden=!files.length;$('homeTitle').textContent='Elige un grupo';$('openFile').textContent='Cargar grupo';$('openFile').className=files.length?'text-button':'';
 $('recentGroups').replaceChildren();$('recentNote').hidden=!files.length;$('openFile').disabled=sharing||busy;
 for(const file of files){
  const key=fileKey(file),g=file.groups[0],s=dailySession(file,g.id,localDate());
  const card=element('article',undefined,'group-card'),button=element('button',undefined,'group-launch');
  button.append(element('span',g.name,'group-name'),element('small',s?.closed?'Finalizada · Toca para completar':s?'En curso · Continuar':'Tomar asistencia'));
  button.disabled=sharing||busy;button.onclick=safe(()=>activateFile(key,'scan'));card.append(button);
  if(file.exportPending){const save=element('button','Guardar pendiente','text-button pending-label');save.disabled=sharing||busy;save.onclick=safe(()=>activateFile(key,'save'));card.append(save);}
  $('recentGroups').append(card);
 }
}
function render(){
 if(!data.groups.some(g=>g.id===groupId))groupId=data.groups[0]?.id||'';
 $('welcome').hidden=!home;renderHome();
 $('sourceFile').textContent=data.idoceo?data.idoceo.filename:'Carga el Excel del grupo para añadir las fechas en él.';
 const s=session(),students=data.students.filter(s=>s.groupId===groupId);
 $('cameraCount').textContent=s?`${arrived(s)} de ${s.roster.length}`:'';
 $('absences').hidden=!home||finishedKey!==fileKey(data)||!s?.closed;
 const absent=s?.roster.filter(r=>s.records[r.id]?.status==='ausente')||[];
 const groupName=data.groups.find(g=>g.id===groupId)?.name||'';
 $('absenceSummary').textContent=`${groupName}: ${absent.length?`${absent.length} ${absent.length===1?'falta':'faltas'} · Ver nombres`:'sin faltas'}`;
 $('absentList').replaceChildren();for(const r of absent)$('absentList').append(element('li',r.name));
 $('attendanceList').replaceChildren();for(const r of s?.roster||[]){const row=element('div',undefined,'person'),name=element('div'),status=element('select');name.append(element('b',r.name),element('small',s.records[r.id]?.time?new Date(s.records[r.id].time).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}):r.code||''));status.setAttribute('aria-label',`Asistencia de ${r.name}`);options(status,[['pendiente','Pendiente'],['presente','✔️ Presente'],['ausente','❌ Falta'],['retraso','⌛️ Retraso'],['justificado','Justificado']],s.records[r.id]?.status||'pendiente');status.onchange=safe(async()=>{const value=status.value;try{await change(d=>{if(s.closed)reopenDaily(d,s.id);mark(d,s.id,r.id,value);if(s.closed&&value!=='pendiente')finishDaily(d,s.id);});$('saveStatus').textContent='Cambios nuevos. Guarda el archivo.';}catch(e){render();throw e;}});row.append(name,status);$('attendanceList').append(row);}
 $('historyTable').replaceChildren();if(!data.idoceo&&!data.sessions.some(s=>s.groupId===groupId))$('historyTable').append(element('p','Aún no hay registros.','muted'));else{const rows=data.idoceo?idoceoRows(data):parseCSV(exportDailyCSV(data,groupId)),table=element('table');rows.forEach((row,i)=>{const tr=element('tr');row.forEach((v,j)=>{if(j!==0&&j!==2)tr.append(element(i?'td':'th',v));});table.append(tr);});$('historyTable').append(table);}
 $('studentList').replaceChildren();for(const student of students){const row=element('div',undefined,'person'),label=element('div');label.append(element('b',student.name),element('small',[student.qr?'QR asociado':'Sin QR',student.preferredName?`Le llamas ${student.preferredName}`:''].filter(Boolean).join(' · ')));const edit=element('button','Corregir','text-button');edit.onclick=safe(async()=>{const name=prompt('Nombre completo del alumno:',student.name);if(name===null)return;if(!name.trim())throw Error('El nombre es obligatorio.');const preferredName=prompt('¿Cómo le llamas? (vacío para elegir al escanear):',student.preferredName||'');if(preferredName===null)return;const qr=prompt('Contenido del QR (vacío para volver a asociar al escanear):',student.qr);if(qr===null)return;await change(d=>{const a=d.students.find(s=>s.id===student.id);a.name=name.trim();if(preferredName.trim())a.preferredName=preferredName.trim();else delete a.preferredName;if(qr)bindQR(d,a.id,qr);else a.qr='';});notice('Alumno actualizado.');});row.append(label,edit);$('studentList').append(row);}
 $('saveMenu').disabled=!data.students.length||sharing;$('exportMatrix').hidden=Boolean(data.idoceo);
 $('saveMenu').textContent=data.idoceo?'Guardar archivo actualizado':'Respaldar registro anterior';

}
function refreshDay(){const today=localDate();if(today!==day){stopCamera();home=true;day=today;render();notice('Ya puedes iniciar la asistencia de hoy.');}}
$('menuButton').onclick=$('captureMenu').onclick=()=>$('menuDialog').showModal();$('closeMenu').onclick=()=>$('menuDialog').close();
function resetSessionView(){
 stopCamera();for(const id of ['menuDialog','logoutDialog'])if($(id).open)$(id).close();
 home=true;groupId='';day=localDate();finishedKey='';lastScan='';lastAt=0;
 for(const id of ['rawQR','findStudent','fileInput'])$(id).value='';
 for(const id of ['cameraMessage','cameraTitle','linkStudents','saveStatus','logoutMessage'])$(id).replaceChildren();
 canvas.width=0;canvas.height=0;clearTimeout(noticeTimer);$('message').hidden=true;$('message').textContent='';
 render();window.scrollTo(0,0);
}
async function logout(){
 if(sharing||busy)return;
 await change(d=>{const revision=d.revision;for(const k of Object.keys(d))delete d[k];Object.assign(d,empty(),{revision});},false);
 resetSessionView();sessionChannel?.postMessage('logout');
}
$('logoutButton').onclick=safe(async()=>{
 if(sharing||busy)return;
 const pending=recentFiles(data).filter(d=>d.exportPending||d.exportPending!==false&&d.sessions.length);
 if(pending.length){$('logoutMessage').textContent=`${pending.length===1?'Hay un Excel pendiente de guardar.':'Hay '+pending.length+' Excel pendientes de guardar.'} Si cierras la sesión, perderás los cambios que no hayas guardado. Los Excel de Archivos no se borran.`;$('logoutDialog').showModal();}
 else await logout();
});
$('cancelLogout').onclick=()=>{$('logoutDialog').close();$('menuDialog').close();goHome();};
$('confirmLogout').onclick=safe(async()=>{try{await logout();}catch(e){$('logoutMessage').textContent=e.message;}});
async function syncLogout(){if(!db)return;try{const latest=validate(await read());if(!latest.students.length&&latest.revision>data.revision){data=latest;resetSessionView();}}catch{}}
if(sessionChannel)sessionChannel.onmessage=e=>{if(e.data==='logout')syncLogout();};
window.addEventListener('pageshow',syncLogout);
function pickFile(){if(sharing||busy)return;$('menuDialog').close();$('fileInput').click();}
function goHome(){stopCamera();home=true;render();window.scrollTo(0,0);}
$('openFile').onclick=pickFile;
$('fileInput').onchange=safe(async()=>{const f=$('fileInput').files[0];if(!f)return;stopCamera();try{
 if(f.size>20e6)throw Error('El archivo supera 20 MB.');
 if(/\.(csv|tsv)$/i.test(f.name)){const text=await f.text(),name=groupFromFilename(f.name);await change(d=>importRosterFile(d,text,f.name));groupId=data.groups.find(g=>g.name.toLowerCase()===name.toLowerCase())?.id||groupId;render();}
 else{const bytes=await f.arrayBuffer();let restored;
 if(/\.json$/i.test(f.name))restored=validate(JSON.parse(new TextDecoder().decode(bytes)));
 else {const book=XLSX.read(bytes,{type:'array'});restored=book.Sheets.Datos_app?restoreFileBytes(bytes):readIdoceo(bytes,f.name);}
 const existing=recentFiles(data).find(d=>fileKey(d)===fileKey(restored));
 if(existing&&JSON.stringify(existing.sessions)!==JSON.stringify(restored.sessions)&&!confirm('Ya tienes este grupo en el dispositivo. ¿Reemplazarlo con el Excel seleccionado? Para continuar sin reemplazar, cancela y elige el grupo en Inicio.'))return;
 restored.exportPending=false;
 await change(d=>{const next=selectFile(d,restored);for(const k of Object.keys(d))delete d[k];Object.assign(d,next);},false);groupId=data.groups[0]?.id;day=localDate();home=true;finishedKey='';$('saveStatus').textContent='';render();}

 if(session()?.closed){home=true;render();notice('Ya registrada hoy. Toca el grupo para completar la toma.');}else await begin();
 }finally{$('fileInput').value='';}});

async function begin(){if(sharing||busy)return;if(!data.idoceo){pickFile();return;}home=false;refreshDay();render();const s=session();if(!s)await change(d=>startDaily(d,groupId,day));else if(s.closed)await change(d=>reopenDaily(d,s.id));await startCamera();}
$('correctCamera').onclick=()=>$('correctionDialog').showModal();$('closeCorrections').onclick=()=>$('correctionDialog').close();$('retryCamera').onclick=safe(startCamera);
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=element('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function saveFile(){
 if(sharing)return;const filename=data.idoceo?.filename||FILE_NAME;const file=new File([data.idoceo?writeIdoceo(data):createFileBytes(data)],filename,{type:FILE_TYPE});sharing=true;$('saveMenu').disabled=true;renderHome();
 try{if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});await change(d=>{d.exportPending=false;},false);$('saveStatus').textContent=`En Archivos, guarda ${filename} en la carpeta original y elige Reemplazar.`;}else{download(file,filename,FILE_TYPE);await change(d=>{d.exportPending=false;},false);$('saveStatus').textContent=`Descargado: ${filename}. Reemplaza el archivo anterior en su carpeta.`;}}
 catch(e){$('saveStatus').textContent=e.name==='AbortError'?'Guardado cancelado. Puedes guardar aquí.':'Pulsa Guardar archivo para abrir el guardado del teléfono.';}
 finally{sharing=false;$('saveMenu').disabled=false;renderHome();}
}
async function finish(){if(!data.idoceo)throw Error('Carga primero el Excel del grupo. Tu registro anterior sigue guardado en este navegador.');const s=session();if(!s)return;stopCamera();clearTimeout(noticeTimer);$('message').hidden=true;if(!s.closed)await change(d=>finishDaily(d,s.id));finishedKey=fileKey(data);home=true;render();window.scrollTo(0,0);$('absences').open=false;$('saveStatus').textContent='';await saveFile();}
$('finishCamera').onclick=safe(finish);$('saveMenu').onclick=safe(()=>{$('menuDialog').close();return saveFile();});
$('exportMatrix').onclick=()=>download(exportDailyCSV(data,groupId),`asistencia-${day}.csv`,'text/csv;charset=utf-8');
function showLink(qr){pendingQR=qr;cameraMessage('Elige al alumno para registrar su asistencia.');$('findStudent').value='';$('linkDialog').querySelector('.muted').textContent='Solo tendrás que elegirlo esta vez.';renderLinks();$('linkDialog').showModal();}
function renderLinks(){const s=session(),filter=$('findStudent').value.toLocaleLowerCase('es');$('linkStudents').replaceChildren();for(const r of s?.roster||[]){const student=data.students.find(x=>x.id===r.id);if(student.qr||!`${r.name} ${r.code}`.toLocaleLowerCase('es').includes(filter))continue;const button=element('button',r.name,'student-choice');if(r.code)button.append(element('small',r.code));button.onclick=safe(async()=>{if(day!==localDate()){refreshDay();throw Error('Cambió el día. Inicia la asistencia de hoy.');}const qr=pendingQR;if(!qr)return;if(!student.preferredName){$('linkDialog').close();showName(student,qr);return;}const result=await change(d=>linkAndScan(d,s.id,r.id,qr));cancelRegistration();confirmScan(result);});$('linkStudents').append(button);}if(!$('linkStudents').children.length)$('linkStudents').append(element('p','No hay alumnos sin QR que coincidan. Puedes corregir un QR desde Archivo.','muted'));}
function showName(student,qr){
 pendingQR=qr;pendingStudentId=student.id;cameraMessage('Elige el nombre para registrar su asistencia.');
 $('studentFullName').textContent=student.name;$('preferredName').value='';$('nameError').textContent='';$('nameChoices').replaceChildren();
 // A comma separates surnames from given names in some exported lists.
 for(const name of new Set(student.name.split(',').at(-1).trim().split(/\s+/).filter(Boolean))){
  const button=element('button',name,'secondary');button.type='button';button.setAttribute('aria-pressed','false');
  button.onclick=()=>{$('preferredName').value=name;updateNameChoice();};$('nameChoices').append(button);
 }
 $('nameDialog').showModal();
}
function updateNameChoice(){for(const button of $('nameChoices').children)button.setAttribute('aria-pressed',String(button.textContent===$('preferredName').value.trim()));$('nameError').textContent='';}
$('preferredName').oninput=updateNameChoice;
$('nameForm').onsubmit=safe(async e=>{
 e.preventDefault();if(day!==localDate()){refreshDay();throw Error('Cambió el día. Inicia la asistencia de hoy.');}
 const qr=pendingQR,id=pendingStudentId,s=session();if(!qr||!id)return;
 if(!s||s.closed)throw Error('Abre la asistencia para registrar.');
 const name=$('preferredName').value;$('saveName').disabled=true;
 try{const result=await change(d=>linkAndScan(d,s.id,id,qr,name));if(pendingQR!==qr)return;cancelRegistration();confirmScan(result);}
 finally{$('saveName').disabled=false;}
});
function cancelRegistration(){pendingQR='';pendingStudentId='';lastAt=Date.now();for(const id of ['linkDialog','nameDialog'])if($(id).open)$(id).close();cameraMessage('Apunta a una tarjeta.');}
$('findStudent').oninput=renderLinks;$('cancelLink').onclick=$('cancelName').onclick=()=>{if(!busy)cancelRegistration();};
for(const id of ['linkDialog','nameDialog'])$(id).addEventListener('cancel',e=>{e.preventDefault();if(!busy)cancelRegistration();});
function confirmScan(result){
 const name=result.student.preferredName||result.student.name,label=result.changed?'Asistencia registrada':'Ya registrado hoy';
 const check=element('span','✓','scan-check'),details=element('div');check.setAttribute('aria-hidden','true');details.append(element('strong',name,'scan-name'),element('span',label,'scan-label'));
 if(name!==result.student.name)details.append(element('span',result.student.name,'scan-full-name'));
 $('cameraMessage').className='scan-success';$('cameraMessage').replaceChildren(check,details);$('cameraCount').textContent=`${arrived(session())} de ${session().roster.length}`;
 lastScan=result.student.qr;lastAt=Date.now();if($('correctionDialog').open)$('correctionDialog').close();
 if(!$('cameraDialog').open)notice(`✓ ${name} · ${label}`);
}
async function acceptQR(qr){if(day!==localDate()){refreshDay();throw Error('Cambió el día.');}const s=session();if(!s||s.closed)throw Error('Abre la asistencia para registrar.');if(typeof qr!=='string'||!qr.length||qr.length>2048)throw Error('QR vacío o demasiado largo.');const student=data.students.find(s=>s.qr===qr);if(!student){showLink(qr);return;}if(!s.roster.some(r=>r.id===student.id))throw Error('Alumno fuera de esta sesión.');if(!student.preferredName){showName(student,qr);return;}confirmScan(await change(d=>scan(d,s.id,qr)));}
$('scanForm').onsubmit=safe(async e=>{e.preventDefault();await acceptQR($('rawQR').value);$('rawQR').value='';});
function stopCamera(){generation++;stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;cancelRegistration();if($('cameraDialog').open)$('cameraDialog').close();if($('correctionDialog').open)$('correctionDialog').close();}
async function startCamera(){
 stopCamera();const current=generation;
 $('cameraTitle').textContent=data.groups.find(g=>g.id===groupId)?.name||'';cameraMessage('Apunta a una tarjeta.');$('retryCamera').hidden=true;
 $('cameraCount').textContent=`${arrived(session())} de ${session().roster.length}`;$('cameraDialog').showModal();
 try{if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Camera unavailable');const result=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
 if(current!==generation){result.getTracks().forEach(t=>t.stop());return;}stream=result;$('video').srcObject=stream;await $('video').play();lastScan='';lastAt=0;tick(current);
 }catch(e){if(current!==generation)return;stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;cameraMessage('Permite la cámara o toca Corregir para registrar asistencia.');$('retryCamera').hidden=false;}
}

const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
async function tick(current){if(!stream||current!==generation)return;try{const v=$('video');if(!pendingQR&&!$('correctionDialog').open&&!$('menuDialog').open&&v.readyState>=2&&v.videoWidth){const scale=Math.min(1,900/v.videoWidth);canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);ctx.drawImage(v,0,0,canvas.width,canvas.height);const frame=ctx.getImageData(0,0,canvas.width,canvas.height),qr=window.jsQR(frame.data,frame.width,frame.height,{inversionAttempts:'attemptBoth'});if(qr&&(qr.data!==lastScan||Date.now()-lastAt>3000)){lastScan=qr.data;lastAt=Date.now();await acceptQR(qr.data);}}}catch(e){cameraMessage(e.message,true);}if(stream&&current===generation)setTimeout(()=>tick(current),170);}
$('stopCamera').onclick=goHome;$('cameraDialog').addEventListener('cancel',e=>{e.preventDefault();goHome();});document.addEventListener('visibilitychange',()=>{if(document.hidden)goHome();else{refreshDay();syncLogout();}});window.addEventListener('pagehide',stopCamera);setInterval(refreshDay,30000);
try{db=await openDB();data=validate(await read());render();navigator.storage?.persist?.().catch(()=>{});}catch(e){notice(`No se pudo abrir el registro: ${e.message}`,true);$('openFile').disabled=true;}
if('serviceWorker'in navigator&&isSecureContext){try{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;$('offlineStatus').textContent='Lista sin conexión. Prueba abrirla en modo avión antes de clase.';}catch{$('offlineStatus').textContent='Abre la app con internet para preparar el modo sin conexión.';}}else $('offlineStatus').textContent='Necesitas HTTPS para cámara y uso sin conexión.';
