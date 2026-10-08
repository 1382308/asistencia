import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {importRosterCSV,startDaily,finishDaily,linkAndScan,localDate,selectFile} from './core.mjs';
import {createFileBytes,restoreFileBytes} from './file-store.mjs';

const XLSX=createRequire(import.meta.url)('./vendor/xlsx.mini.min.js');
const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
let instance=0;

// Only browser boundaries are doubled: imports, validation, comparison, selection,
// rendering and the file-input handler all execute the production modules.
async function openApp(t,initial,answer){
 const element=()=>({
  children:[],value:'',textContent:'',open:false,
  append(...children){this.children.push(...children);},
  replaceChildren(...children){this.children=children;},
  setAttribute(){},addEventListener(){},getContext(){return {};},
  showModal(){this.open=true;},close(){this.open=false;}
 });
 const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,element()]));
 const state={stored:structuredClone(initial),writes:0,confirmations:[]};
 const db={transaction(name){
  assert.equal(name,'state');
  const transaction={
   objectStore(name){
    assert.equal(name,'state');
    return {
     get(key){
      assert.equal(key,'main');
      const request={result:structuredClone(state.stored)};
      queueMicrotask(()=>request.onsuccess());return request;
     },
     put(value,key){
      assert.equal(key,'main');state.stored=structuredClone(value);state.writes++;
      queueMicrotask(()=>transaction.oncomplete());
     }
    };
   },
   abort(){queueMicrotask(()=>transaction.onabort());}
  };
  return transaction;
 }};
 const globals={
  document:{getElementById:id=>elements.get(id),createElement:element,addEventListener(){}},
  window:{addEventListener(){},scrollTo(){}},navigator:{},isSecureContext:false,
  BroadcastChannel:undefined,XLSX,
  indexedDB:{open(name,version){
   assert.equal(name,'aula-asistencia');assert.equal(version,1);
   const request={result:db};queueMicrotask(()=>request.onsuccess());return request;
  }},
  confirm(message){state.confirmations.push(message);return answer;},
  setInterval(){},setTimeout(){},clearTimeout(){}
 };
 for(const [key,value] of Object.entries(globals)){
  const previous=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else delete globalThis[key];});
 }
 await import(`./app.mjs?test=${++instance}`);
 assert.equal(elements.get('message').textContent,'');
 return {...state,elements,get stored(){return state.stored;},get writes(){return state.writes;},async upload(incoming){
  const input=elements.get('fileInput');
  input.files=[new File([createFileBytes(incoming,XLSX)],'Asistencia.xlsx')];input.value='Asistencia.xlsx';
  await input.onchange();
  assert.notEqual(elements.get('message').className,'error',elements.get('message').textContent);
  assert.equal(input.value,'');
 }};
}

function classroom(){
 const d=importRosterCSV('nombre\nJuan Carlos Pérez López\n','Grupo I');
 const {session}=startDaily(d,d.groups[0].id,localDate());
 linkAndScan(d,session.id,d.students[0].id,'qr-vigente','Carlos');
 finishDaily(d,session.id);
 d.revision=9;d.exportPending=true;
 return d;
}

const differences=[
 ['QR anterior',d=>{d.students[0].qr='qr-anterior';}],
 ['QR eliminado',d=>{d.students[0].qr='';}],
 ['nombre preferido anterior',d=>{d.students[0].preferredName='Juan';}],
 ['nombre preferido eliminado',d=>{delete d.students[0].preferredName;}],
 ['asistencia anterior',d=>{const record=d.sessions[0].records[d.students[0].id];record.status='ausente';record.time=null;}]
];

for(const recent of [false,true]){
 for(const [label,alter] of differences){
  for(const answer of [false,true]){
   test(`importar Excel con ${label}, grupo ${recent?'reciente':'activo'}: ${answer?'reemplazar':'cancelar'}`,async t=>{
    const local=classroom(),incoming=structuredClone(local);alter(incoming);
    if(label!=='asistencia anterior')assert.deepEqual(incoming.sessions,local.sessions);
    const other=importRosterCSV('nombre\nOtra alumna\n','Grupo II');
    other.revision=9;other.exportPending=true;
    const initial=recent?selectFile(local,other):selectFile(other,local);
    const app=await openApp(t,initial,answer);
    await app.upload(incoming);
    assert.equal(app.confirmations.length,1);
    if(!answer){
     assert.equal(app.writes,0);
     assert.deepEqual(app.stored,initial);
    }else{
     assert.equal(app.writes,1);
     assert.deepEqual(app.stored.students,incoming.students);
     assert.deepEqual(app.stored.sessions,incoming.sessions);
     assert.equal(app.stored.exportPending,false);
     assert.equal(app.stored.revision,initial.revision+1);
     assert.deepEqual(app.stored.recent,[other]);
     assert.equal(app.elements.get('recentGroups').children.length,2);
     const restored=restoreFileBytes(createFileBytes(app.stored,XLSX),XLSX);
     assert.deepEqual(restored.students,incoming.students);
     assert.deepEqual(restored.sessions,incoming.sessions);
     assert.equal(restored.recent,undefined);
    }
   });
  }
 }
 test(`importar Excel idéntico, grupo ${recent?'reciente':'activo'}, no pide confirmación`,async t=>{
  const local=classroom(),incoming=structuredClone(local);
  incoming.revision=0;incoming.exportPending=false;
  // Object property order is not a classroom-data difference.
  incoming.students=incoming.students.map(s=>Object.fromEntries(Object.entries(s).reverse()));
  const other=importRosterCSV('nombre\nOtra alumna\n','Grupo II');
  other.revision=9;
  const initial=recent?selectFile(local,other):selectFile(other,local);
  const app=await openApp(t,initial,false);
  await app.upload(incoming);
  assert.equal(app.confirmations.length,0);
  assert.equal(app.writes,1);
  assert.deepEqual(app.stored.students,local.students);
  assert.deepEqual(app.stored.sessions,local.sessions);
  assert.deepEqual(app.stored.recent,[other]);
 });
 test(`la clave normalizada encuentra el grupo ${recent?'reciente':'activo'} antes de reemplazar`,async t=>{
  const local=classroom(),incoming=structuredClone(local);
  incoming.groups[0].name='  GRUPO I  ';incoming.students[0].qr='qr-anterior';
  const other=importRosterCSV('nombre\nOtra alumna\n','Grupo II');
  const initial=recent?selectFile(local,other):selectFile(other,local);
  const app=await openApp(t,initial,false);
  await app.upload(incoming);
  assert.equal(app.confirmations.length,1);
  assert.equal(app.writes,0);
  assert.deepEqual(app.stored,initial);
 });
}
