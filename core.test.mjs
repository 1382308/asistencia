import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {empty,startDaily,linkAndScan,scan,validate,selectFile} from './core.mjs';
import {createFileBytes,restoreFileBytes} from './file-store.mjs';

const XLSX=createRequire(import.meta.url)('./vendor/xlsx.mini.min.js');
function classroom(){
 const d=empty();
 d.groups.push({id:'group-1',name:'Grupo I'});
 d.students.push({id:'student-1',groupId:'group-1',name:'Juan Carlos Pérez López',code:'1',qr:''});
 const {session}=startDaily(d,'group-1','2026-09-14');
 return {d,session};
}

test('el nombre elegido se conserva en las siguientes clases sin duplicar asistencias',()=>{
 const {d,session}=classroom();
 const result=linkAndScan(d,session.id,'student-1','qr-1','  Carlos  ');
 assert.equal(result.student.preferredName,'Carlos');
 assert.equal(result.student.name,'Juan Carlos Pérez López');
 assert.equal(result.changed,true);
 assert.equal(session.records['student-1'].status,'presente');
 const firstRecord=structuredClone(session.records['student-1']);
 assert.equal(scan(d,session.id,'qr-1').changed,false);
 assert.deepEqual(session.records['student-1'],firstRecord);
 const next=startDaily(d,'group-1','2026-09-15').session;
 assert.equal(scan(d,next.id,'qr-1').student.preferredName,'Carlos');
 assert.equal(next.roster[0].name,'Juan Carlos Pérez López');
});

test('el nombre elegido viaja en el respaldo y al cambiar de grupo',()=>{
 const {d,session}=classroom();
 linkAndScan(d,session.id,'student-1','qr-1','Carlos');
 const restored=restoreFileBytes(createFileBytes(d,XLSX),XLSX);
 assert.equal(restored.students[0].preferredName,'Carlos');
 assert.equal(restored.students[0].name,'Juan Carlos Pérez López');
 assert.equal(restored.students[0].qr,'qr-1');
 const other=empty();other.groups.push({id:'group-2',name:'Grupo II'});
 assert.equal(selectFile(restored,other).recent[0].students[0].preferredName,'Carlos');
 const book=XLSX.read(createFileBytes(d,XLSX),{type:'array'});
 assert.equal(book.Sheets.Registro.B2.v,'Juan Carlos Pérez López');
});

test('acepta registros anteriores y rechaza nombres preferidos inválidos antes de registrar',()=>{
 const {d,session}=classroom();
 assert.doesNotThrow(()=>validate(d));
 for(const name of ['', '   ', 'a'.repeat(301), null, 123]){
  assert.throws(()=>linkAndScan(d,session.id,'student-1','qr-1',name));
  assert.equal(d.students[0].qr,'');
  assert.deepEqual(session.records,{});
  const imported=structuredClone(d);imported.students[0].preferredName=name;
  assert.throws(()=>validate(imported));
 }
});
