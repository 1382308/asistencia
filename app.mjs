import {readIdoceo,writeIdoceo,idoceoRows} from './idoceo.mjs';
import {createFileBytes,restoreFileBytes,FILE_NAME,FILE_TYPE} from './file-store.mjs';
import {empty,bindQR,mark,scan,validate,localDate,dailySession,startDaily,finishDaily,reopenDaily,exportDailyCSV,parseCSV,importRosterCSV,rosterBackupFilename,linkAndScan,fileKey,sameClassroomData,recentFiles,selectFile} from './core.mjs';

const $=id=>document.getElementById(id);
let db,data=empty(),groupId='',day=localDate(),busy=false,stream=null,generation=0,pendingQR='',pendingStudentId='',lastScan='',lastAt=0,noticeTimer,flashTimer,sharing=false;
// Estado de la interfaz: vista actual, filtro de la lista y hojas abiertas.
let view='home',filter='todos',personId='',editingId='',askResolve=null,groupNameResolve=null;
const sessionChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('aula-session'):null;
const nav=globalThis.history;
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});

// ---------- Vocabulario visual ----------
const STATUS={
 presente:{label:'Presente',plural:'Presentes',icon:'check'},
 retraso:{label:'Retraso',plural:'Retrasos',icon:'clock'},
 ausente:{label:'Falta',plural:'Faltas',icon:'x'},
 justificado:{label:'Justificado',plural:'Justificados',icon:'doc'},
 pendiente:{label:'Sin registrar',plural:'Sin registrar',icon:'dash'}
};
const SEAT_ORDER=['presente','retraso','justificado','ausente','pendiente'];
const QUICK=['presente','retraso','ausente'];
const FILTERS=['todos','pendiente','ausente','retraso','justificado','presente'];
const ICONS={
 check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
 clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
 x:'<path d="M7 7l10 10M17 7L7 17"/>',
 doc:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
 dash:'<path d="M7 12h10"/>',
 scan:'<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3M7 12h10"/>'
};
const svg=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

// ---------- Utilidades ----------
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function button(cls,onclick,text){const b=element('button',text,cls);b.type='button';if(onclick)b.onclick=onclick;return b;}
const capitalize=s=>s.charAt(0).toUpperCase()+s.slice(1);
const todayLabel=()=>capitalize(new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'}));
const clock=iso=>new Date(iso).toLocaleTimeString('es-MX',{hour:'numeric',minute:'2-digit'});
const plural=(n,one,many)=>`${n} ${n===1?one:many}`;
const sentence=text=>/[.!?]$/.test(text)?text:`${text}.`;
const fold=s=>String(s).normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('es');
const pendingBackup=d=>Boolean(d.exportPending||d.exportPending!==false&&d.sessions.length);
const keyboardFocus=()=>Boolean(document.activeElement?.matches?.(':focus-visible'));
function refocus(key){globalThis.requestAnimationFrame?.(()=>document.querySelector?.(`[data-focus="${key}"]`)?.focus?.());}

function cameraMessage(text,error=false){$('cameraMessage').className=error?'scan-error':'';$('cameraMessage').textContent=text;}
function notice(text,error=false){
 clearTimeout(noticeTimer);$('message').textContent=text;$('message').className=error?'error':'';$('message').hidden=false;
 if($('scanDialog').open)cameraMessage(text,error);
 if(error){
  if($('linkDialog').open){$('linkHint').textContent=text;$('linkHint').className='sheet-sub is-error';}
  for(const [dialog,slot] of [['nameDialog','nameError'],['editDialog','editError'],['groupNameDialog','groupNameError'],['manualDialog','manualError']])if($(dialog).open)$(slot).textContent=text;
 }
 noticeTimer=setTimeout(()=>{$('message').hidden=true;},error?8000:4500);
}
const safe=fn=>async e=>{try{await fn(e);}catch(err){notice(err.message||'No se pudo completar la acción.',true);}};

// ---------- Almacenamiento ----------
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('aula-asistencia',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Cierra otras ventanas de la app y vuelve a abrirla.'));});}
function read(){return new Promise((resolve,reject)=>{const t=db.transaction('state'),r=t.objectStore('state').get('main');r.onsuccess=()=>resolve(r.result||empty());r.onerror=()=>reject(r.error);});}
function write(next){return new Promise((resolve,reject)=>{let conflict=false;const t=db.transaction('state','readwrite'),s=t.objectStore('state'),r=s.get('main');r.onsuccess=()=>{if((r.result?.revision||0)!==data.revision){conflict=true;t.abort();return;}next.revision=data.revision+1;s.put(next,'main');};t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(Error(conflict?'Hay cambios en otra ventana. Recarga la app antes de continuar.':'No se guardó: almacenamiento no disponible. Guarda un respaldo y libera espacio.'));});}
async function change(fn,dirty=true){if(!db)throw Error('Almacenamiento no disponible.');if(busy)throw Error('Espera a que termine el guardado.');busy=true;$('cancelLink').disabled=$('cancelName').disabled=true;try{const next=structuredClone(data);const result=fn(next);if(dirty)next.exportPending=true;validate(next);await write(next);data=next;render();return result;}finally{busy=false;$('cancelLink').disabled=$('cancelName').disabled=false;renderHome();}}

// ---------- Datos para mostrar ----------
function session(){return dailySession(data,groupId,day);}
function rosterOf(d,gid,s){
 return (s?s.roster:d.students.filter(x=>x.groupId===gid)).map(r=>{
  const student=d.students.find(x=>x.id===r.id)||r,record=s?.records[r.id];
  return {id:r.id,name:student.name||r.name,preferred:student.preferredName||'',qr:student.qr||'',status:record?.status||'pendiente',time:record?.time||null,source:record?.source||''};
 });
}
const people=()=>rosterOf(data,groupId,session());
function tally(list){const t={todos:list.length,presente:0,retraso:0,ausente:0,justificado:0,pendiente:0};for(const p of list)t[p.status]++;t.llegaron=t.presente+t.retraso;return t;}
function fillSeats(box,list){box.replaceChildren(...[...list].sort((a,b)=>SEAT_ORDER.indexOf(a.status)-SEAT_ORDER.indexOf(b.status)).map(p=>element('span',undefined,`seat ${p.status}`)));}
function pendingNames(list){
 const names=list.filter(p=>p.status==='pendiente').map(p=>p.preferred||p.name);
 if(!names.length)return 'Todas las personas tienen registro.';
 return names.length>2?`Sin registrar: ${names.slice(0,2).join(', ')} y ${names.length-2} más`:`Sin registrar: ${names.join(' y ')}`;
}

// ---------- Vista: Grupos ----------
function renderHome(){
 const files=recentFiles(data).sort((a,b)=>a.groups[0].name.localeCompare(b.groups[0].name,'es',{numeric:true}));
 const locked=sharing||busy;
 $('homeDate').textContent=todayLabel();
 $('emptyState').hidden=Boolean(files.length);$('addGroup').hidden=!files.length;
 $('openFile').disabled=$('addGroup').disabled=$('menuOpenFile').disabled=locked;
 $('logoutButton').disabled=locked||!files.length;
 $('recentGroups').replaceChildren();
 for(const file of files){
  const key=fileKey(file),g=file.groups[0],s=dailySession(file,g.id,localDate()),list=rosterOf(file,g.id,s),t=tally(list);
  const card=element('article',undefined,'group-card');
  const open=button('group-open',safe(()=>activateFile(key,'open')));
  open.append(element('span',g.name,'group-name'),element('span',!s?'Sin iniciar hoy':s.closed?(t.ausente?`Finalizada con ${plural(t.ausente,'falta','faltas')}`:'Finalizada sin faltas'):`${t.llegaron} de ${t.todos} ${t.llegaron===1?'llegó':'llegaron'}`,'group-state'));
  open.disabled=locked;card.append(open);
  if(s?.closed){const done=element('span',undefined,'tag tag-done tag-icon');done.innerHTML=svg('check');done.setAttribute('role','img');done.setAttribute('aria-label','Lista finalizada');card.append(done);}
  else{const go=button('btn btn-primary btn-sm group-scan',safe(()=>activateFile(key,'scan')));go.innerHTML=svg('scan');go.append(element('span','Escanear'));go.setAttribute('aria-label',`Escanear tarjetas de ${g.name}`);go.disabled=locked;card.append(go);}
  const dots=element('div',undefined,'seats seats-sm');dots.setAttribute('aria-hidden','true');fillSeats(dots,list);card.append(dots);
  if(pendingBackup(file)){const row=element('div',undefined,'group-save');row.append(element('span','Excel sin guardar','tag tag-warn'));const save=button('link-btn',safe(()=>activateFile(key,'save')),'Guardar');save.setAttribute('aria-label',`Guardar el Excel de ${g.name}`);save.disabled=locked;row.append(save);card.append(row);}
  $('recentGroups').append(card);
 }
}

// ---------- Vista: Lista del día ----------
function renderGroup(){
 const g=data.groups.find(x=>x.id===groupId);if(!g)return;
 const s=session(),list=people(),t=tally(list),pending=pendingBackup(data);
 $('groupTitle').textContent=g.name;$('groupDate').textContent=todayLabel();
 $('summaryText').textContent=`${t.llegaron} de ${t.todos} ${t.llegaron===1?'llegó':'llegaron'}`;
 $('summaryNote').textContent=!s?'La lista de hoy no se ha iniciado.':s.closed?(t.ausente?`Lista finalizada con ${plural(t.ausente,'falta','faltas')}.`:'Lista finalizada sin faltas.'):t.pendiente?`Lista en curso. Quedan ${t.pendiente} sin registrar.`:'Lista en curso. Todas las personas tienen registro.';
 fillSeats($('seatMap'),list);
 $('saveBanner').hidden=!pending;$('saveBannerButton').disabled=sharing;
 renderFilters(t);renderList(list);
 $('scanLabel').textContent=!s?'Escanear tarjetas':s.closed?'Reabrir y escanear':'Seguir escaneando';
 $('scanButton').className=`btn btn-lg ${s?.closed?'btn-secondary':'btn-primary'}`;
 $('finishButton').hidden=!s||Boolean(s.closed);
 $('scanButton').disabled=$('finishButton').disabled=sharing;
 $('groupMenuTitle').textContent=g.name;
 $('sourceFile').textContent=data.idoceo?`Archivo de iDoceo: ${data.idoceo.filename}`:`Excel del grupo: ${rosterBackupFilename(g.name)}`;
 $('saveMenuText').textContent=data.idoceo?'Guardar archivo de iDoceo':'Guardar Excel';
 $('saveMenuNote').textContent=pending?'Hay cambios sin guardar':'Sin cambios pendientes';
 $('saveMenu').disabled=!data.students.length||sharing;
}
function renderFilters(t){
 const box=$('filters');box.replaceChildren();
 for(const key of FILTERS){
  if(key!=='todos'&&!t[key]&&filter!==key)continue;
  const chip=button(`chip chip-${key}`,()=>{const kb=keyboardFocus();filter=key;renderGroup();if(kb)refocus(`chip-${key}`);});
  chip.setAttribute('aria-pressed',String(filter===key));chip.setAttribute('data-focus',`chip-${key}`);
  chip.append(element('span',key==='todos'?'Todos':STATUS[key].plural),element('span',String(t[key]),'chip-count'));
  box.append(chip);
 }
 globalThis.requestAnimationFrame?.(()=>{const chip=box.querySelector?.('[aria-pressed="true"]');if(chip&&chip.offsetLeft+chip.offsetWidth>box.scrollLeft+box.clientWidth)box.scrollLeft=chip.offsetLeft-16;});
}
function renderList(list){
 const box=$('attendanceList'),shown=filter==='todos'?list:list.filter(p=>p.status===filter);
 box.replaceChildren();
 for(const p of shown){
  const display=p.preferred||p.name,li=element('li',undefined,`person is-${p.status}`);
  const main=button('person-main',()=>openPerson(p.id));
  const line=element('span',undefined,'person-line');line.append(element('span',display,'person-name'));
  if(p.time)line.append(element('span',clock(p.time),'person-time'));
  main.append(line);
  const meta=element('span',undefined,'person-meta');
  if(p.status==='justificado')meta.append(element('span','Justificado','person-tag'));
  if(p.preferred&&p.preferred!==p.name)meta.append(element('span',p.name,'person-full'));
  if(meta.children.length)main.append(meta);
  const marks=element('div',undefined,'marks');marks.setAttribute('role','group');marks.setAttribute('aria-label',`Asistencia de ${display}`);
  for(const key of QUICK){
   const on=p.status===key,focusKey=`mark-${p.id}-${key}`;
   const b=button(`mark mark-${key}`,safe(async()=>{const kb=keyboardFocus();await setStatus(p.id,on?'pendiente':key);if(kb)refocus(focusKey);}));
   b.innerHTML=svg(STATUS[key].icon);b.append(element('span',STATUS[key].label,'mark-label'));
   b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',STATUS[key].label);b.setAttribute('data-focus',focusKey);b.disabled=sharing;
   marks.append(b);
  }
  li.append(main,marks);box.append(li);
 }
 if(!shown.length)box.append(element('li',filter==='pendiente'?'Todas las personas tienen registro.':'Nadie en esta categoría.','person-empty'));
}
function renderScanStatus(){
 const list=people(),t=tally(list);
 $('cameraCount').textContent=`${t.llegaron} de ${t.todos}`;
 fillSeats($('scanSeats'),list);$('scanPending').textContent=pendingNames(list);
}
function render(){
 if(!data.groups.some(g=>g.id===groupId))groupId=data.groups[0]?.id||'';
 if(view==='group'&&!groupId)view='home';
 $('homeView').hidden=view!=='home';$('groupView').hidden=view!=='group';$('app').className=`app view-${view}`;
 renderHome();
 if(groupId){renderGroup();renderScanStatus();if($('personDialog').open)renderPerson();}
}

// ---------- Navegación ----------
const SHEETS=['menuDialog','groupMenuDialog','historyDialog','personDialog','editDialog','helpDialog'];
function closeSheets(){for(const id of SHEETS)if($(id).open)$(id).close();if(groupNameResolve||$('groupNameDialog').open)resolveGroupName(null);if(askResolve||$('confirmDialog').open)answer(false);}
function showGroup(){if(view!=='group'){view='group';nav?.pushState?.({view:'group'},'');}render();window.scrollTo(0,0);}
function goHome(){stopCamera();closeSheets();if(view==='group'&&nav?.state?.view==='group'){nav.back();return;}view='home';render();window.scrollTo(0,0);}
window.addEventListener('popstate',()=>{if(view==='home')return;stopCamera();closeSheets();view='home';render();window.scrollTo(0,0);});
function refreshDay(){const today=localDate();if(today!==day){stopCamera();closeSheets();day=today;filter='todos';goHome();notice('Ya puedes iniciar la asistencia de hoy.');}}

async function activateFile(key,action){
 if(sharing||busy)return;stopCamera();
 const selected=recentFiles(data).find(d=>fileKey(d)===key);if(!selected)throw Error('Carga el Excel del grupo.');
 if(fileKey(data)!==key)await change(d=>{const next=selectFile(d,selected);for(const k of Object.keys(d))delete d[k];Object.assign(d,next);},false);
 groupId=data.groups[0]?.id;day=localDate();filter='todos';
 if(action==='save'){render();await saveFile();return;}
 showGroup();
 if(action==='scan')await startScan();
}

// ---------- Marcar a mano ----------
async function setStatus(studentId,value){
 if(busy||sharing)return;
 if(day!==localDate()){refreshDay();throw Error('Cambió el día. Abre la lista de hoy.');}
 const s=session();if(!s&&value==='pendiente')return;
 await change(d=>{
  const current=s?d.sessions.find(x=>x.id===s.id):startDaily(d,groupId,day).session,wasClosed=Boolean(current.closed);
  if(wasClosed)reopenDaily(d,current.id);
  mark(d,current.id,studentId,value);
  if(wasClosed&&value!=='pendiente')finishDaily(d,current.id);
 });
}
function openPerson(id){personId=id;renderPerson();$('personDialog').showModal();}
function describe(p){
 const when=p.time?` a las ${clock(p.time)}`:'';
 const text=sentence({presente:`Llegó${when}`,retraso:`Llegó con retraso${when}`,ausente:'Falta registrada hoy',justificado:'Justificado hoy',pendiente:'Sin registro hoy'}[p.status]);
 return p.status==='pendiente'?text:`${text} ${p.source==='qr'?'Registro con tarjeta QR.':'Registro manual.'}`;
}
function renderPerson(){
 const p=people().find(x=>x.id===personId);
 if(!p){if($('personDialog').open)$('personDialog').close();return;}
 $('personName').textContent=p.preferred||p.name;
 $('personFull').textContent=p.preferred&&p.preferred!==p.name?p.name:'';
 $('personInfo').textContent=describe(p);
 $('personCard').textContent=p.qr?'Tiene una tarjeta QR vinculada.':'Todavía no tiene tarjeta QR vinculada.';
 const box=$('personStatuses');box.replaceChildren();
 for(const key of ['presente','retraso','ausente','justificado']){
  const b=button(`status-btn status-${key}`,safe(async()=>{$('personDialog').close();await setStatus(p.id,key);}));
  b.innerHTML=svg(STATUS[key].icon);b.append(element('span',STATUS[key].label));
  b.setAttribute('aria-pressed',String(p.status===key));b.disabled=sharing;box.append(b);
 }
 $('clearStatus').hidden=p.status==='pendiente';$('clearStatus').disabled=sharing;
}
$('clearStatus').onclick=safe(async()=>{const id=personId;$('personDialog').close();await setStatus(id,'pendiente');});
$('editPerson').onclick=()=>openEdit(personId);
function openEdit(id){
 const student=data.students.find(s=>s.id===id);if(!student)return;
 editingId=id;$('editName').value=student.name;$('editPreferred').value=student.preferredName||'';$('editQR').value=student.qr||'';$('editError').textContent='';
 if($('personDialog').open)$('personDialog').close();
 $('editDialog').showModal();
}
$('editForm').onsubmit=safe(async e=>{
 e.preventDefault();
 const id=editingId,name=$('editName').value.trim(),preferredName=$('editPreferred').value.trim(),qr=$('editQR').value;
 if(!name)throw Error('El nombre es obligatorio.');
 await change(d=>{const a=d.students.find(s=>s.id===id);if(!a)throw Error('Ese nombre ya no está en la lista.');a.name=name;if(preferredName)a.preferredName=preferredName;else delete a.preferredName;if(qr)bindQR(d,a.id,qr);else a.qr='';});
 $('editDialog').close();notice('Cambios guardados.');
});
$('clearQR').onclick=()=>{$('editQR').value='';};

// ---------- Historial ----------
function cellStatus(value){const text=String(value??'').trim().replace(/️/g,'');if(!text)return '';return {'✔':'presente','✅':'presente','❌':'ausente','⌛':'retraso','⏳':'retraso',justificado:'justificado',Justificado:'justificado',pendiente:'pendiente'}[text]||null;}
function shortDate(text){const m=text.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);return m?`${m[3]}/${m[2]}${m[4]}`:text;}
function renderHistory(){
 const g=data.groups.find(x=>x.id===groupId),hasSessions=data.sessions.some(s=>s.groupId===groupId);
 $('historyGroup').textContent=g?.name||'';$('exportMatrix').hidden=Boolean(data.idoceo)||!hasSessions;
 const box=$('historyTable');box.replaceChildren();
 if(!data.idoceo&&!hasSessions){box.append(element('p','Todavía no hay registros. Aparecerán aquí después de pasar lista.','help'));return;}
 const rows=data.idoceo?idoceoRows(data):parseCSV(exportDailyCSV(data,groupId));
 const [nameCol,...dateCols]=rows[0].map((_,j)=>j).filter(j=>data.idoceo?j!==0&&j!==2:j!==0);
 const today=localDate(),todayShort=`${today.slice(8)}/${today.slice(5,7)}`;
 const isToday=dateCols.map(j=>{const text=String(rows[0][j]).trim();return text===today||text===todayShort;});
 const table=element('table'),thead=element('thead'),head=element('tr'),tbody=element('tbody');
 const nameHead=element('th','Nombre');nameHead.setAttribute('scope','col');head.append(nameHead);
 dateCols.forEach((j,i)=>{const th=element('th',shortDate(String(rows[0][j]).trim()),isToday[i]?'is-today':undefined);th.setAttribute('scope','col');head.append(th);});
 const totalHead=element('th','Faltas','total-col');totalHead.setAttribute('scope','col');head.append(totalHead);
 thead.append(head);
 for(const row of rows.slice(1)){
  const tr=element('tr'),name=element('th',String(row[nameCol]??''));name.setAttribute('scope','row');tr.append(name);let absences=0;
  dateCols.forEach((j,i)=>{
   const status=cellStatus(row[j]),td=element('td',undefined,isToday[i]?'is-today':undefined);
   if(status===null)td.textContent=String(row[j]).trim();
   else if(status){if(status==='ausente')absences++;const badge=element('span',undefined,`cell cell-${status}`);badge.innerHTML=svg(STATUS[status].icon);badge.setAttribute('title',STATUS[status].label);td.append(badge,element('span',STATUS[status].label,'sr'));}
   tr.append(td);
  });
  tr.append(element('td',String(absences),absences?'total-col has-absences':'total-col'));tbody.append(tr);
 }
 table.append(thead,tbody);box.append(table);
}

// ---------- Hojas propias en lugar de prompt() y confirm() ----------
function ask({title,message,ok='Aceptar',cancel='Cancelar',danger=false}){
 if(askResolve)answer(false);
 $('confirmTitle').textContent=title;$('confirmMessage').textContent=message;$('confirmOk').textContent=ok;$('confirmCancel').textContent=cancel;
 $('confirmOk').className=`btn btn-lg ${danger?'btn-danger':'btn-primary'}`;
 const result=new Promise(resolve=>{askResolve=resolve;});
 $('confirmDialog').showModal();return result;
}
function answer(value){const resolve=askResolve;askResolve=null;if($('confirmDialog').open)$('confirmDialog').close();resolve?.(value);}
$('confirmOk').onclick=()=>answer(true);$('confirmCancel').onclick=()=>answer(false);
$('confirmDialog').addEventListener('close',()=>{if(askResolve)answer(false);});
function askGroupName(){
 if(groupNameResolve)resolveGroupName(null);
 $('groupNameInput').value='';$('groupNameError').textContent='';
 const result=new Promise(resolve=>{groupNameResolve=resolve;});
 $('groupNameDialog').showModal();return result;
}
function resolveGroupName(value){const resolve=groupNameResolve;groupNameResolve=null;if($('groupNameDialog').open)$('groupNameDialog').close();resolve?.(value);}
$('groupNameForm').onsubmit=e=>{e.preventDefault();const name=$('groupNameInput').value.trim();if(!name){$('groupNameError').textContent='Escribe el nombre del grupo.';return;}resolveGroupName(name);};
$('groupNameInput').oninput=()=>{$('groupNameError').textContent='';};
$('cancelGroupName').onclick=()=>resolveGroupName(null);
$('groupNameDialog').addEventListener('close',()=>{if(groupNameResolve)resolveGroupName(null);});

// ---------- Cerrar sesión ----------
async function logout(){
 if(sharing||busy)return;
 await change(d=>{const revision=d.revision;for(const k of Object.keys(d))delete d[k];Object.assign(d,empty(),{revision});},false);
 resetSessionView();sessionChannel?.postMessage('logout');
}
function resetSessionView(){
 stopCamera();closeSheets();
 view='home';groupId='';day=localDate();filter='todos';personId='';editingId='';lastScan='';lastAt=0;
 for(const id of ['rawQR','findStudent','fileInput'])$(id).value='';
 for(const id of ['cameraMessage','scanTitle','linkStudents'])$(id).replaceChildren();
 canvas.width=0;canvas.height=0;clearTimeout(noticeTimer);$('message').hidden=true;$('message').textContent='';
 render();window.scrollTo(0,0);
}
$('logoutButton').onclick=safe(async()=>{
 if(sharing||busy)return;
 const pending=recentFiles(data).filter(pendingBackup).length;
 $('menuDialog').close();
 const confirmed=await ask({
  title:'¿Cerrar sesión?',
  message:pending?`${pending===1?'Hay un Excel sin guardar.':`Hay ${pending} Excel sin guardar.`} Si cierras la sesión, perderás esos cambios. Los Excel guardados en Archivos no se borran.`:'Se quitarán los grupos de este dispositivo. Los Excel guardados en Archivos no se borran.',
  ok:pending?'Cerrar sin guardar':'Cerrar sesión',cancel:'Volver',danger:true
 });
 if(confirmed)await logout();
});
async function syncLogout(){if(!db)return;try{const latest=validate(await read());if(!latest.students.length&&latest.revision>data.revision){data=latest;resetSessionView();}}catch{}}
if(sessionChannel)sessionChannel.onmessage=e=>{if(e.data==='logout')syncLogout();};
window.addEventListener('pageshow',syncLogout);
window.addEventListener('beforeunload',e=>{if(recentFiles(data).some(pendingBackup)){e.preventDefault();e.returnValue='';}});

// ---------- Cargar archivos ----------
function pickFile(){if(sharing||busy)return;if($('menuDialog').open)$('menuDialog').close();$('fileInput').click();}
$('fileInput').onchange=safe(async()=>{const f=$('fileInput').files[0];if(!f)return;stopCamera();try{
 if(f.size>20e6)throw Error('El archivo supera 20 MB.');
 if(/\.tsv$/i.test(f.name))throw Error('Usa la plantilla CSV de una sola columna llamada nombre.');
 if(/\.csv$/i.test(f.name)){
  const groupName=await askGroupName();if(groupName===null)return;
  const restored=importRosterCSV(await f.text(),groupName),key=fileKey(restored);
  if(recentFiles(data).some(d=>fileKey(d)===key))throw Error(`Ya existe el grupo ${restored.groups[0].name}. Ábrelo desde Grupos o carga su Excel actualizado.`);
  const next=selectFile(data,restored);
  await change(d=>{for(const k of Object.keys(d))delete d[k];Object.assign(d,next);},false);
 }
 else{const bytes=await f.arrayBuffer();let restored;
  if(/\.json$/i.test(f.name))restored=validate(JSON.parse(new TextDecoder().decode(bytes)));
  else {const book=XLSX.read(bytes,{type:'array'});restored=book.Sheets.Datos_app?restoreFileBytes(bytes):readIdoceo(bytes,f.name);}
  const existing=recentFiles(data).find(d=>fileKey(d)===fileKey(restored));
  if(existing&&!sameClassroomData(existing,restored)&&!await ask({
   title:'¿Reemplazar los datos de este dispositivo?',
   message:`Ya tienes el grupo ${restored.groups[0].name} con cambios en la lista, las tarjetas, los nombres o la asistencia. Si lo reemplazas, se usarán los datos del Excel seleccionado. Para conservar los de este dispositivo, cancela y ábrelo desde Grupos.`,
   ok:'Reemplazar',cancel:'Cancelar',danger:true
  }))return;
  restored.exportPending=false;
  await change(d=>{const next=selectFile(d,restored);for(const k of Object.keys(d))delete d[k];Object.assign(d,next);},false);
 }
 groupId=data.groups[0]?.id||'';day=localDate();filter='todos';
 showGroup();
}finally{$('fileInput').value='';}});

function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=element('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
const downloadTemplate=()=>download('﻿nombre\r\n','plantilla-lista.csv','text/csv;charset=utf-8');

// ---------- Guardar el Excel ----------
async function saveFile(){
 if(sharing)return;
 const groupName=data.groups.find(g=>g.id===groupId)?.name||data.groups[0]?.name||'';
 const filename=data.idoceo?.filename||(groupName?rosterBackupFilename(groupName):FILE_NAME);
 const file=new File([data.idoceo?writeIdoceo(data):createFileBytes(data)],filename,{type:FILE_TYPE});
 sharing=true;render();
 try{
  try{if(navigator.share&&navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});else download(file,filename,FILE_TYPE);}
  catch(e){notice(e.name==='AbortError'?'Guardado cancelado. Puedes intentarlo de nuevo con Guardar Excel.':'No se abrió el guardado del teléfono. Toca Guardar Excel para intentarlo de nuevo.',e.name!=='AbortError');return;}
  const saved=await ask({title:'¿Guardaste el Excel?',message:`Confirma solo si ${filename} ya está en Archivos u otra ubicación, en lugar de la copia anterior del grupo.`,ok:'Sí, ya lo guardé',cancel:'Todavía no'});
  if(!saved){notice(`Respaldo pendiente: guarda ${filename} como la copia más reciente.`);return;}
  await change(d=>{d.exportPending=false;},false);notice('Excel guardado. Carga esta copia al iniciar la siguiente clase.');
 }
 finally{sharing=false;render();}
}

// ---------- Finalizar la lista ----------
async function finish(){
 const s=session();if(!s)return;
 const left=s.closed?0:s.roster.filter(r=>!s.records[r.id]||s.records[r.id].status==='pendiente').length;
 if(left&&!await ask({title:'¿Finalizar la lista?',message:`${left===1?'1 persona sin registrar quedará':`${left} personas sin registrar quedarán`} con falta. Puedes corregirlo después desde la lista.`,ok:'Finalizar',cancel:'Volver'}))return;
 stopCamera();clearTimeout(noticeTimer);$('message').hidden=true;
 if(!session()?.closed)await change(d=>finishDaily(d,s.id));
 filter=tally(people()).ausente?'ausente':'todos';showGroup();
 await saveFile();
}

// ---------- Escáner ----------
async function startScan(){
 if(sharing||busy)return;
 if(day!==localDate()){refreshDay();return;}
 const s=session();if(!s)await change(d=>startDaily(d,groupId,day));else if(s.closed)await change(d=>reopenDaily(d,s.id));
 await startCamera();
}
function stopCamera(){generation++;stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;cancelRegistration();for(const id of ['scanDialog','manualDialog'])if($(id).open)$(id).close();}
function closeScanner(){stopCamera();render();}
async function startCamera(){
 stopCamera();const current=generation;
 $('scanTitle').textContent=data.groups.find(g=>g.id===groupId)?.name||'';cameraMessage('Apunta a una tarjeta QR.');$('retryCamera').hidden=true;$('viewfinder').className='viewfinder';
 renderScanStatus();$('scanDialog').showModal();
 try{if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Camera unavailable');const result=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
 if(current!==generation){result.getTracks().forEach(t=>t.stop());return;}stream=result;$('video').srcObject=stream;await $('video').play();lastScan='';lastAt=0;tick(current);
 }catch(e){if(current!==generation)return;stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;cameraMessage('Permite el acceso a la cámara o marca la asistencia en la lista.');$('retryCamera').hidden=false;}
}
async function tick(current){if(!stream||current!==generation)return;try{const v=$('video');if(!pendingQR&&!$('manualDialog').open&&!$('confirmDialog').open&&v.readyState>=2&&v.videoWidth){const scale=Math.min(1,900/v.videoWidth);canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);ctx.drawImage(v,0,0,canvas.width,canvas.height);const frame=ctx.getImageData(0,0,canvas.width,canvas.height),qr=window.jsQR(frame.data,frame.width,frame.height,{inversionAttempts:'attemptBoth'});if(qr&&(qr.data!==lastScan||Date.now()-lastAt>3000)){lastScan=qr.data;lastAt=Date.now();await acceptQR(qr.data);}}}catch(e){cameraMessage(e.message,true);}if(stream&&current===generation)setTimeout(()=>tick(current),170);}
async function acceptQR(qr){if(day!==localDate()){refreshDay();throw Error('Cambió el día.');}const s=session();if(!s||s.closed)throw Error('Abre la asistencia para registrar.');if(typeof qr!=='string'||!qr.length||qr.length>2048)throw Error('QR vacío o demasiado largo.');const student=data.students.find(s=>s.qr===qr);if(!student){showLink(qr);return;}if(!s.roster.some(r=>r.id===student.id))throw Error('Esa tarjeta no está en la lista de hoy.');if(!student.preferredName){showName(student,qr);return;}confirmScan(await change(d=>scan(d,s.id,qr)));}
function confirmScan(result){
 const name=result.student.preferredName||result.student.name,label=result.changed?'Asistencia registrada':'Ya tenía asistencia hoy';
 const check=element('span',undefined,'scan-check'),details=element('div',undefined,'scan-details');check.innerHTML=svg('check');check.setAttribute('aria-hidden','true');
 details.append(element('strong',name,'scan-name'),element('span',label,'scan-label'));
 if(name!==result.student.name)details.append(element('span',result.student.name,'scan-full-name'));
 $('cameraMessage').className=result.changed?'scan-success':'scan-success scan-repeat';$('cameraMessage').replaceChildren(check,details);
 renderScanStatus();
 lastScan=result.student.qr;lastAt=Date.now();if($('manualDialog').open)$('manualDialog').close();
 if(result.changed){navigator.vibrate?.(35);clearTimeout(flashTimer);$('viewfinder').className='viewfinder is-ok';flashTimer=setTimeout(()=>{$('viewfinder').className='viewfinder';},900);}
 if(!$('scanDialog').open)notice(`${name}: ${label}`);
}
$('scanForm').onsubmit=safe(async e=>{e.preventDefault();$('manualError').textContent='';await acceptQR($('rawQR').value);$('rawQR').value='';});

// ---------- Vincular una tarjeta nueva ----------
function showLink(qr){pendingQR=qr;cameraMessage('Elige a quién pertenece la tarjeta.');$('findStudent').value='';$('linkHint').textContent='Elige el nombre. Solo se pide la primera vez.';$('linkHint').className='sheet-sub';renderLinks();$('linkDialog').showModal();}
function renderLinks(){
 const s=session(),query=fold($('findStudent').value.trim());$('linkStudents').replaceChildren();
 for(const r of s?.roster||[]){
  const student=data.students.find(x=>x.id===r.id);
  if(!student||student.qr||!fold(`${student.name} ${r.name} ${r.code}`).includes(query))continue;
  const choice=button('choice',safe(async()=>{if(day!==localDate()){refreshDay();throw Error('Cambió el día. Abre la lista de hoy.');}const qr=pendingQR;if(!qr)return;$('linkDialog').close();showName(student,qr);}));
  choice.append(element('span',student.name));if(r.code)choice.append(element('small',r.code));
  $('linkStudents').append(choice);
 }
 if(!$('linkStudents').children.length)$('linkStudents').append(element('p','No hay nombres sin tarjeta que coincidan. Para cambiar una tarjeta, toca el nombre en la lista del grupo.','help'));
}
function showName(student,qr){
 pendingQR=qr;pendingStudentId=student.id;cameraMessage('Escribe cómo le llamas para registrar su asistencia.');
 $('studentFullName').textContent=student.name;$('preferredName').value=student.preferredName||'';$('nameError').textContent='';
 $('nameDialog').showModal();
 setTimeout(()=>$('preferredName').focus(),50);
}
$('preferredName').oninput=()=>{$('nameError').textContent='';};
$('nameForm').onsubmit=safe(async e=>{
 e.preventDefault();if(day!==localDate()){refreshDay();throw Error('Cambió el día. Abre la lista de hoy.');}
 const qr=pendingQR,id=pendingStudentId,s=session();if(!qr||!id)return;
 if(!s||s.closed)throw Error('Abre la asistencia para registrar.');
 const name=$('preferredName').value;$('saveName').disabled=true;
 try{const result=await change(d=>linkAndScan(d,s.id,id,qr,name));if(pendingQR!==qr)return;cancelRegistration();confirmScan(result);}
 finally{$('saveName').disabled=false;}
});
function cancelRegistration(){pendingQR='';pendingStudentId='';lastAt=Date.now();for(const id of ['linkDialog','nameDialog'])if($(id).open)$(id).close();cameraMessage('Apunta a una tarjeta QR.');}
$('findStudent').oninput=renderLinks;$('cancelLink').onclick=$('cancelName').onclick=()=>{if(!busy)cancelRegistration();};
for(const id of ['linkDialog','nameDialog'])$(id).addEventListener('cancel',e=>{e.preventDefault();if(!busy)cancelRegistration();});

// ---------- Botones ----------
$('menuButton').onclick=()=>$('menuDialog').showModal();
$('menuOpenFile').onclick=$('openFile').onclick=$('addGroup').onclick=pickFile;
$('downloadRosterTemplate').onclick=downloadTemplate;
$('menuTemplate').onclick=()=>{$('menuDialog').close();downloadTemplate();};
$('helpButton').onclick=()=>{$('menuDialog').close();$('helpDialog').showModal();};
$('backHome').onclick=goHome;
$('groupMenuButton').onclick=()=>$('groupMenuDialog').showModal();
$('historyButton').onclick=()=>{$('groupMenuDialog').close();renderHistory();$('historyDialog').showModal();};
$('saveMenu').onclick=safe(()=>{$('groupMenuDialog').close();return saveFile();});
$('saveBannerButton').onclick=safe(saveFile);
$('exportMatrix').onclick=()=>{const name=data.groups.find(g=>g.id===groupId)?.name||'';download(exportDailyCSV(data,groupId),rosterBackupFilename(name).replace(/\.xlsx$/,` - ${day}.csv`),'text/csv;charset=utf-8');};
$('scanButton').onclick=safe(startScan);
$('finishButton').onclick=$('finishCamera').onclick=safe(finish);
$('closeScan').onclick=$('scanToList').onclick=closeScanner;
$('retryCamera').onclick=safe(startCamera);
$('manualEntry').onclick=()=>{$('rawQR').value='';$('manualError').textContent='';$('manualDialog').showModal();};
$('scanDialog').addEventListener('cancel',e=>{e.preventDefault();closeScanner();});
$('message').onclick=()=>{$('message').hidden=true;};
for(const [buttonId,dialogId] of [['closeMenu','menuDialog'],['closeGroupMenu','groupMenuDialog'],['closeHistory','historyDialog'],['closePerson','personDialog'],['closeHelp','helpDialog'],['closeManual','manualDialog'],['cancelEdit','editDialog']])$(buttonId).onclick=()=>$(dialogId).close();
// Tocar fuera de una hoja la cierra, salvo en formularios para no perder lo escrito.
function onBackdrop(id,fn){$(id).addEventListener('click',e=>{if(e.target===$(id))fn();});}
for(const id of ['menuDialog','groupMenuDialog','historyDialog','personDialog','helpDialog'])onBackdrop(id,()=>$(id).close());
onBackdrop('confirmDialog',()=>answer(false));
onBackdrop('linkDialog',()=>{if(!busy)cancelRegistration();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if($('scanDialog').open)closeScanner();}else{refreshDay();syncLogout();}});
window.addEventListener('pagehide',stopCamera);setInterval(refreshDay,30000);

// ---------- Inicio ----------
if(nav?.state?.view)nav.replaceState?.(null,'');
try{db=await openDB();data=validate(await read());render();navigator.storage?.persist?.().catch(()=>{});}catch(e){notice(`No se pudo abrir el registro: ${e.message}`,true);for(const id of ['openFile','addGroup','menuOpenFile'])$(id).disabled=true;}
if('serviceWorker'in navigator&&isSecureContext){try{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;$('offlineStatus').textContent='Lista para usarse sin conexión. Prueba abrirla en modo avión antes de clase.';}catch{$('offlineStatus').textContent='Abre la app con internet para preparar el uso sin conexión.';}}else $('offlineStatus').textContent='Necesitas HTTPS para la cámara y el uso sin conexión.';
