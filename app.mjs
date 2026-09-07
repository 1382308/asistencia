import {readIdoceo,writeIdoceo,idoceoRows} from './idoceo.mjs';
import {createFileBytes,restoreFileBytes,FILE_NAME,FILE_TYPE} from './file-store.mjs';
import {empty,bindQR,mark,scan,validate,localDate,dailySession,startDaily,finishDaily,reopenDaily,exportDailyCSV,parseCSV,importRosterFile,groupFromFilename,linkAndScan,fileKey,recentFiles,selectFile} from './core.mjs';
const $=id=>document.getElementById(id);let db,data=empty(),groupId='',day=localDate(),busy=false,stream=null,generation=0,pendingQR='',lastScan='',lastAt=0,noticeTimer,sharing=false,home=true,finishedKey='';
function notice(text,error=false){clearTimeout(noticeTimer);$('message').textContent=text;$('message').className=error?'error':'';$('message').hidden=false;if($('cameraDialog').open)$('cameraMessage').textContent=text;if($('linkDialog').open&&error)$('linkDialog').querySelector('.muted').textContent=text;if(!error)noticeTimer=setTimeout(()=>{$('message').hidden=true;},4500);}
const safe=fn=>async e=>{try{await fn(e);}catch(err){notice(err.message||'No se pudo completar la acción.',true);}};
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('aula-asistencia',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Cierra otras ventanas de la app y vuelve a abrirla.'));});}
function read(){return new Promise((resolve,reject)=>{const t=db.transaction('state'),r=t.objectStore('state').get('main');r.onsuccess=()=>resolve(r.result||empty());r.onerror=()=>reject(r.error);});}
function write(next){return new Promise((resolve,reject)=>{let conflict=false;const t=db.transaction('state','readwrite'),s=t.objectStore('state'),r=s.get('main');r.onsuccess=()=>{if((r.result?.revision||0)!==data.revision){conflict=true;t.abort();return;}next.revision=data.revision+1;s.put(next,'main');};t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(Error(conflict?'Hay cambios en otra ventana. Recarga la app antes de continuar.':'No se guardó: almacenamiento no disponible. Guarda un respaldo y libera espacio.'));});}
async function change(fn,dirty=true){if(!db)throw Error('Almacenamiento no disponible.');if(busy)throw Error('Espera a que termine el guardado.');busy=true;try{const next=structuredClone(data);const result=fn(next);if(dirty)next.exportPending=true;validate(next);await write(next);data=next;render();return result;}finally{busy=false;renderHome();}}
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
 home=false;finishedKey='';render();
 if(action==='scan')await begin();
 else {if(data.idoceo&&!session())await change(d=>startDaily(d,groupId,day));$('manualList').open=true;window.scrollTo(0,0);}
}
function renderHome(){
 const files=recentFiles(data).sort((a,b)=>a.groups[0].name.localeCompare(b.groups[0].name,'es',{numeric:true}));$('openFile').textContent=files.length?'Cargar otro grupo':'Cargar grupo';$('recentGroups').replaceChildren();$('recentNote').hidden=!files.length;$('openFile').disabled=sharing||busy;
 for(const file of files){
  const key=fileKey(file),g=file.groups[0],s=dailySession(file,g.id,localDate());
  const card=element('article',undefined,'group-card'),heading=element('div',undefined,'section-head');heading.append(element('h2',g.name),element('span',s?.closed?'Hoy · Finalizada':s?'Hoy · En curso':'Lista para hoy'));
  card.append(heading);if(file.exportPending)card.append(element('p','Excel pendiente de guardar','pending-label'));
  const actions=element('div',undefined,'group-actions');
  for(const [action,label] of [['scan',s?.closed?'Añadir alumno':s?'Continuar':'Tomar asistencia'],['edit','Editar'],...(file.exportPending?[['save','Guardar Excel']]:[])]){
   const button=element('button',label,action==='scan'?'secondary':'text-button');button.disabled=sharing||busy;button.onclick=safe(()=>activateFile(key,action));actions.append(button);
  }
  card.append(actions);$('recentGroups').append(card);
 }
}
function render(){
 if(!data.groups.some(g=>g.id===groupId))groupId=data.groups[0]?.id||'';
 $('welcome').hidden=!home;$('workspace').hidden=home||!data.students.length;$('homeButton').hidden=home;renderHome();
 $('sourceFile').textContent=data.idoceo?`Archivo: ${data.idoceo.filename}`:'Registro de una versión anterior. Carga el Excel del grupo para añadir las fechas en él.';
 options($('group'),data.groups.map(g=>[g.id,g.name]),groupId);
 $('dateLabel').textContent=new Date(day+'T12:00:00').toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'});
 const s=session(),students=data.students.filter(s=>s.groupId===groupId);
 $('dayStatus').textContent=s?.closed?'Hoy · Ya registrada':s?'Hoy · En curso':'Hoy';
 $('count').textContent=s?`${arrived(s)} de ${s.roster.length}`:`${students.length} alumnos`;
 $('startDay').textContent=s?.closed?'Añadir alumno':s?'Continuar escaneando':'Tomar asistencia';$('startDay').hidden=false;$('startDay').disabled=!students.length||busy&&sharing;
 $('finishDay').hidden=!s;$('finishDay').textContent=s?.closed?'Guardar y volver al inicio':'Finalizar asistencia';$('absences').hidden=!home||finishedKey!==fileKey(data)||!s?.closed;$('manualList').hidden=!s;
 const absent=s?.roster.filter(r=>s.records[r.id]?.status==='ausente')||[];$('absentCount').textContent=absent.length;$('noAbsences').hidden=absent.length>0;$('absentList').replaceChildren();for(const r of absent){const li=element('li',r.name);if(r.code)li.append(element('small',r.code));$('absentList').append(li);}
 $('attendanceList').replaceChildren();for(const r of s?.roster||[]){const row=element('div',undefined,'person'),name=element('div'),status=element('select');name.append(element('b',r.name),element('small',s.records[r.id]?.time?new Date(s.records[r.id].time).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}):r.code||''));status.setAttribute('aria-label',`Asistencia de ${r.name}`);options(status,[['pendiente','Pendiente'],['presente','✔️ Presente'],['ausente','❌ Falta'],['retraso','⌛️ Retraso'],['justificado','Justificado']],s.records[r.id]?.status||'pendiente');status.onchange=safe(async()=>{const value=status.value;try{await change(d=>{if(s.closed)reopenDaily(d,s.id);mark(d,s.id,r.id,value);if(s.closed&&value!=='pendiente')finishDaily(d,s.id);});$('saveStatus').textContent='Cambios nuevos. Guarda el archivo.';}catch(e){render();throw e;}});row.append(name,status);$('attendanceList').append(row);}
 $('historyTable').replaceChildren();if(!data.idoceo&&!data.sessions.some(s=>s.groupId===groupId))$('historyTable').append(element('p','Aún no hay registros.','muted'));else{const rows=data.idoceo?idoceoRows(data):parseCSV(exportDailyCSV(data,groupId)),table=element('table');rows.forEach((row,i)=>{const tr=element('tr');row.forEach((v,j)=>{if(j!==0&&j!==2)tr.append(element(i?'td':'th',v));});table.append(tr);});$('historyTable').append(table);}
 $('studentList').replaceChildren();for(const student of students){const row=element('div',undefined,'person'),label=element('div');label.append(element('b',student.name),element('small',student.qr?'QR asociado':'Sin QR'));const edit=element('button','Corregir','text-button');edit.onclick=safe(async()=>{const name=prompt('Nombre del alumno:',student.name);if(name===null)return;if(!name.trim())throw Error('El nombre es obligatorio.');const qr=prompt('Contenido del QR (vacío para volver a asociar al escanear):',student.qr);if(qr===null)return;await change(d=>{const a=d.students.find(s=>s.id===student.id);a.name=name.trim();if(qr)bindQR(d,a.id,qr);else a.qr='';});notice('Alumno actualizado.');});row.append(label,edit);$('studentList').append(row);}
 $('saveMenu').disabled=!data.students.length||sharing;$('exportMatrix').hidden=Boolean(data.idoceo);
 $('saveMenu').textContent=data.idoceo?'Guardar archivo actualizado':'Respaldar registro anterior';
 if(!data.idoceo){$('startDay').hidden=false;$('startDay').textContent='Cargar Excel del grupo';$('finishDay').hidden=true;$('resumeDay').hidden=true;$('saveFile').hidden=true;}else{$('resumeDay').hidden=false;$('saveFile').hidden=false;}
}
function refreshDay(){const today=localDate();if(today!==day){stopCamera();day=today;render();notice('Ya puedes iniciar la asistencia de hoy.');}}
$('group').onchange=()=>{stopCamera();groupId=$('group').value;$('saveStatus').textContent='';render();};
$('menuButton').onclick=()=>$('menuDialog').showModal();$('closeMenu').onclick=()=>$('menuDialog').close();
function pickFile(){if(sharing||busy)return;$('menuDialog').close();$('fileInput').click();}
function goHome(){stopCamera();home=true;render();window.scrollTo(0,0);}
$('homeButton').onclick=goHome;
$('openFile').onclick=pickFile;$('changeFile').onclick=pickFile;
$('fileInput').onchange=safe(async()=>{const f=$('fileInput').files[0];if(!f)return;stopCamera();try{
 if(f.size>20e6)throw Error('El archivo supera 20 MB.');
 if(/\.(csv|tsv)$/i.test(f.name)){const text=await f.text(),name=groupFromFilename(f.name);await change(d=>importRosterFile(d,text,f.name));groupId=data.groups.find(g=>g.name.toLowerCase()===name.toLowerCase())?.id||groupId;render();}
 else{const bytes=await f.arrayBuffer();let restored;
 if(/\.json$/i.test(f.name))restored=validate(JSON.parse(new TextDecoder().decode(bytes)));
 else {const book=XLSX.read(bytes,{type:'array'});restored=book.Sheets.Datos_app?restoreFileBytes(bytes):readIdoceo(bytes,f.name);}
 const existing=recentFiles(data).find(d=>fileKey(d)===fileKey(restored));
 if(existing&&JSON.stringify(existing.sessions)!==JSON.stringify(restored.sessions)&&!confirm('Ya tienes este grupo en el dispositivo. ¿Reemplazarlo con el Excel seleccionado? Para continuar sin reemplazar, cancela y elige el grupo en Inicio.'))return;
 restored.exportPending=false;
 await change(d=>{const next=selectFile(d,restored);for(const k of Object.keys(d))delete d[k];Object.assign(d,next);},false);groupId=data.groups[0]?.id;day=localDate();home=false;finishedKey='';$('saveStatus').textContent='';render();}

 if(session()?.closed){notice('La asistencia de hoy ya está registrada. Pulsa Añadir a alguien para completarla.');}else await begin();
 }finally{$('fileInput').value='';}});

async function begin(){if(sharing||busy)return;if(!data.idoceo){pickFile();return;}home=false;refreshDay();render();const s=session();if(!s)await change(d=>startDaily(d,groupId,day));else if(s.closed)await change(d=>reopenDaily(d,s.id));await startCamera();}
$('startDay').onclick=safe(begin);$('resumeDay').onclick=safe(begin);
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=element('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function saveFile(){
 if(sharing)return;const filename=data.idoceo?.filename||FILE_NAME;const file=new File([data.idoceo?writeIdoceo(data):createFileBytes(data)],filename,{type:FILE_TYPE});sharing=true;$('saveFile').disabled=true;$('saveMenu').disabled=true;renderHome();
 try{if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});await change(d=>{d.exportPending=false;},false);$('saveStatus').textContent=`En Archivos, guarda ${filename} en la carpeta original y elige Reemplazar.`;}else{download(file,filename,FILE_TYPE);await change(d=>{d.exportPending=false;},false);$('saveStatus').textContent=`Descargado: ${filename}. Reemplaza el archivo anterior en su carpeta.`;}}
 catch(e){$('saveStatus').textContent=e.name==='AbortError'?'Guardado cancelado. Puedes guardar aquí.':'Pulsa Guardar archivo para abrir el guardado del teléfono.';}
 finally{sharing=false;$('saveFile').disabled=false;$('saveMenu').disabled=false;renderHome();}
}
async function finish(){if(!data.idoceo)throw Error('Carga primero el Excel del grupo. Tu registro anterior sigue guardado en este navegador.');const s=session();if(!s)return;stopCamera();clearTimeout(noticeTimer);$('message').hidden=true;if(!s.closed)await change(d=>finishDaily(d,s.id));finishedKey=fileKey(data);home=true;render();window.scrollTo(0,0);$('manualList').open=false;$('saveStatus').textContent='';await saveFile();}
$('finishDay').onclick=safe(finish);$('finishCamera').onclick=safe(finish);$('saveFile').onclick=safe(saveFile);$('saveMenu').onclick=safe(()=>{$('menuDialog').close();return saveFile();});
$('exportMatrix').onclick=()=>download(exportDailyCSV(data,groupId),`asistencia-${day}.csv`,'text/csv;charset=utf-8');
function showLink(qr){pendingQR=qr;$('findStudent').value='';$('linkDialog').querySelector('.muted').textContent='Solo tendrás que elegirlo esta vez.';renderLinks();$('linkDialog').showModal();}
function renderLinks(){const s=session(),filter=$('findStudent').value.toLocaleLowerCase('es');$('linkStudents').replaceChildren();for(const r of s?.roster||[]){const student=data.students.find(x=>x.id===r.id);if(student.qr||!`${r.name} ${r.code}`.toLocaleLowerCase('es').includes(filter))continue;const button=element('button',r.name,'student-choice');if(r.code)button.append(element('small',r.code));button.onclick=safe(async()=>{if(day!==localDate()){refreshDay();throw Error('Cambió el día. Inicia la asistencia de hoy.');}const qr=pendingQR;if(!qr)return;const result=await change(d=>linkAndScan(d,s.id,r.id,qr));pendingQR='';$('linkDialog').close();confirmScan(result);});$('linkStudents').append(button);}if(!$('linkStudents').children.length)$('linkStudents').append(element('p','No hay alumnos sin QR que coincidan. Puedes corregir un QR desde Archivo.','muted'));}
$('findStudent').oninput=renderLinks;function cancelLink(){pendingQR='';lastAt=Date.now();$('linkDialog').close();}$('cancelLink').onclick=cancelLink;$('linkDialog').addEventListener('cancel',cancelLink);
function confirmScan(result){const text=result.changed?`✔️ ${result.student.name}`:`${result.student.name} · ya registrado`;$('cameraMessage').textContent=text;$('cameraCount').textContent=`${arrived(session())} de ${session().roster.length}`;if(!$('cameraDialog').open)notice(text);}
async function acceptQR(qr){if(day!==localDate()){refreshDay();throw Error('Cambió el día.');}const s=session();if(!s||s.closed)throw Error('Abre la asistencia para registrar.');if(!data.students.some(s=>s.qr===qr)){showLink(qr);return;}confirmScan(await change(d=>scan(d,s.id,qr)));}
$('scanForm').onsubmit=safe(async e=>{e.preventDefault();await acceptQR($('rawQR').value);$('rawQR').value='';});
function stopCamera(){generation++;stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;pendingQR='';if($('linkDialog').open)$('linkDialog').close();if($('cameraDialog').open)$('cameraDialog').close();}
async function startCamera(){stopCamera();if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('La cámara necesita HTTPS. También puedes registrar desde Lista y correcciones.');const current=generation;$('cameraTitle').textContent=data.groups.find(g=>g.id===groupId)?.name||'';$('cameraMessage').textContent='Apunta a una tarjeta.';$('cameraCount').textContent=`${arrived(session())} de ${session().roster.length}`;$('cameraDialog').showModal();try{const result=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});if(current!==generation){result.getTracks().forEach(t=>t.stop());return;}stream=result;$('video').srcObject=stream;await $('video').play();lastScan='';lastAt=0;tick(current);}catch(e){stopCamera();throw Error('No se pudo abrir la cámara. Permite el acceso a la cámara en tu navegador o usa Lista y correcciones.');}}
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
async function tick(current){if(!stream||current!==generation)return;try{const v=$('video');if(!pendingQR&&v.readyState>=2&&v.videoWidth){const scale=Math.min(1,900/v.videoWidth);canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);ctx.drawImage(v,0,0,canvas.width,canvas.height);const frame=ctx.getImageData(0,0,canvas.width,canvas.height),qr=window.jsQR(frame.data,frame.width,frame.height,{inversionAttempts:'attemptBoth'});if(qr&&(qr.data!==lastScan||Date.now()-lastAt>3000)){lastScan=qr.data;lastAt=Date.now();await acceptQR(qr.data);}}}catch(e){$('cameraMessage').textContent=e.message;}if(stream&&current===generation)setTimeout(()=>tick(current),170);}
$('stopCamera').onclick=stopCamera;$('cameraDialog').addEventListener('cancel',stopCamera);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();else refreshDay();});window.addEventListener('pagehide',stopCamera);setInterval(refreshDay,30000);
try{db=await openDB();data=validate(await read());render();navigator.storage?.persist?.().catch(()=>{});}catch(e){notice(`No se pudo abrir el registro: ${e.message}`,true);$('openFile').disabled=true;$('startDay').disabled=true;}
if('serviceWorker'in navigator&&isSecureContext){try{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;$('offlineStatus').textContent='Lista sin conexión. Prueba abrirla en modo avión antes de clase.';}catch{$('offlineStatus').textContent='Abre la app con internet para preparar el modo sin conexión.';}}else $('offlineStatus').textContent='Necesitas HTTPS para cámara y uso sin conexión.';
