import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as core from './core.mjs';
import {createFileBytes,restoreFileBytes} from './file-store.mjs';

const XLSX=createRequire(import.meta.url)('./vendor/xlsx.mini.min.js');
const {empty,startDaily,finishDaily,exportDailyCSV,exportCSV,groupFromFilename,importRosterCSV,linkAndScan,parseCSV,rosterBackupFilename,sameClassroomData,scan,validate,selectFile}=core;
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

test('importa la plantilla CSV de una columna y pide un nombre de grupo',()=>{
 const d=importRosterCSV('\uFEFFnombre\r\nAna López\r\nCarlos Ruiz\r\n','  3A  ');
 assert.equal(d.groups.length,1);
 assert.equal(d.groups[0].name,'3A');
 assert.deepEqual(d.students.map(s=>s.name),['Ana López','Carlos Ruiz']);
 assert.deepEqual(d.students.map(({code,qr})=>({code,qr})),[{code:'',qr:''},{code:'',qr:''}]);
 assert.equal(d.idoceo,undefined);
});

test('rechaza listas CSV que no siguen la plantilla de una columna o repiten nombres',()=>{
 assert.throws(()=>importRosterCSV('nombre,matricula\nAna,1\n','3A'),/plantilla CSV/i);
 assert.throws(()=>importRosterCSV('nombre\nAna López\nana lópez\n','3A'),/repite/i);
 assert.throws(()=>importRosterCSV('nombre\nAna López\n','  '),/grupo/i);
});

test('el Excel generado conserva los QR, nombres preferidos y asistencia de una lista CSV',()=>{
 const d=importRosterCSV('nombre\r\nAna López\r\nCarlos Ruiz\r\n','3A');
 const {session}=startDaily(d,d.groups[0].id,'2026-09-27');
 linkAndScan(d,session.id,d.students[0].id,'qr-ana','Ana');
 finishDaily(d,session.id,'2026-09-27T18:00:00.000Z');
 const restored=restoreFileBytes(createFileBytes(d,XLSX),XLSX);
 assert.equal(restored.idoceo,undefined);
 assert.equal(restored.groups[0].name,'3A');
 assert.equal(restored.students[0].qr,'qr-ana');
 assert.equal(restored.students[0].preferredName,'Ana');
 assert.equal(restored.sessions[0].closed,true);
 assert.equal(restored.sessions[0].records[restored.students[0].id].status,'presente');
 assert.equal(restored.sessions[0].records[restored.students[1].id].status,'ausente');
 assert.equal(sameClassroomData(d,restored),true);
});

test('los reportes de asistencia no incluyen una columna de matrícula',()=>{
 const {d}=classroom();
 assert.deepEqual(parseCSV(exportDailyCSV(d,'group-1'))[0],['grupo','nombre','2026-09-14']);
 assert.deepEqual(parseCSV(exportCSV(d))[0],['grupo','sesion','fecha','nombre','estado','hora_local','hora_iso','origen']);
 const book=XLSX.read(createFileBytes(d,XLSX),{type:'array'});
 assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets.Registro,{header:1})[0].slice(0,2),['grupo','nombre']);
 assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets.Detalle,{header:1})[0],['grupo','sesion','fecha','nombre','estado','hora_local','hora_iso','origen']);
});

test('el nombre del Excel maestro identifica el grupo sin permitir una ruta de archivo',()=>{
 assert.equal(rosterBackupFilename('3A/Matutino'),'Asistencia - 3A-Matutino.xlsx');
});

test('iDoceo conserva la detección de grupo en archivos Excel',()=>{
 assert.equal(groupFromFilename('idoceo_Grupo_I.xlsx'),'Grupo I');
 assert.equal(groupFromFilename('Grupo_3A.csv'),'');
});

test('un Excel guardado se restaura como maestro vigente, sin bandera de cambios pendientes',()=>{
 const d=importRosterCSV('nombre\nAna López\n','3A');
 d.exportPending=true;
 const restored=restoreFileBytes(createFileBytes(d,XLSX),XLSX);
 assert.equal(restored.exportPending,undefined);
});

test('detecta cambios de QR o nombre preferido aunque el historial sea idéntico',()=>{
 const {d,session}=classroom();
 linkAndScan(d,session.id,'student-1','qr-vigente','Carlos');
 const identical=structuredClone(d);
 identical.revision=12;identical.exportPending=false;
 assert.equal(sameClassroomData(d,identical),true);
 const staleQR=structuredClone(d);staleQR.students[0].qr='qr-anterior';
 assert.deepEqual(staleQR.sessions,d.sessions);
 assert.equal(sameClassroomData(d,staleQR),false);
 const staleName=structuredClone(d);delete staleName.students[0].preferredName;
 assert.deepEqual(staleName.sessions,d.sessions);
 assert.equal(sameClassroomData(d,staleName),false);
 const staleAttendance=structuredClone(d);staleAttendance.sessions[0].records['student-1'].status='ausente';
 assert.equal(sameClassroomData(d,staleAttendance),false);
});
