import {validate,exportDailyCSV,exportCSV,parseCSV} from './core.mjs';
export const FILE_NAME='Asistencia.xlsx';
export const FILE_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function registerRows(data){
 const groups=data.groups.map(g=>parseCSV(exportDailyCSV(data,g.id)));
 const dates=[...new Set(groups.flatMap(r=>r[0].slice(3)))].sort();
 const rows=[['grupo','nombre','matricula',...dates]];
 for(const g of groups){for(const r of g.slice(1))rows.push([...r.slice(0,3),...dates.map(date=>{const index=g[0].indexOf(date);return index<0?'':r[index]||'';})]);}
 return rows;
}
function library(XLSX){if(!XLSX?.utils)throw Error('No está disponible el generador de archivos. Abre la app con internet para completar la actualización.');return XLSX;}
export function createFileBytes(data,XLSX=globalThis.XLSX){
 library(XLSX);validate(data);const book=XLSX.utils.book_new();
 const append=(name,rows,widths)=>{const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=widths.map(wch=>({wch}));if(name!=='Datos_app')sheet['!autofilter']={ref:sheet['!ref']};XLSX.utils.book_append_sheet(book,sheet,name);};
 const rows=registerRows(data);append('Registro',rows,[14,32,18,...rows[0].slice(3).map(()=>18)]);
 const detailRows=parseCSV(exportCSV(data));append('Detalle',detailRows,[14,24,16,18,32,16,26,28,16]);
 append('Información',[
 ['Asistencia','Archivo completo'],
 ['Actualizado',new Date().toISOString()],
 ['Contenido','Todos los grupos, historial, alumnos, códigos QR y horas.'],
 ['Recuperar','Abre este archivo desde Archivo → Abrir otro archivo.'],
 ['Uso','Consulta Registro y Detalle. Corrige los datos dentro de la app.'],
 ['Guardar','En Archivos, usa el mismo nombre y confirma Reemplazar.'],
 ['Copia','Conserva una copia adicional antes de reemplazar si la necesitas.'],
 ['Datos_app','Hoja de recuperación. No eliminar ni editar. No está cifrada.'],
 ['Iconos','✔️ Presente · ❌ Falta · ⌛️ Retraso. Pendiente y justificado se conservan como texto.'],
 ],[22,100]);
 const text=JSON.stringify({data,tables:{Registro:rows,Detalle:detailRows}});const chunks=[['ASISTENCIA_ARCHIVO_V1']];
 for(let i=0;i<text.length;){let end=Math.min(i+20000,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;chunks.push([text.slice(i,end)]);i=end;}
 append('Datos_app',chunks,[24]);book.Workbook={Sheets:book.SheetNames.map(name=>({name,Hidden:name==='Datos_app'?1:0}))};
 return XLSX.write(book,{bookType:'xlsx',type:'array',compression:true});
}
export function restoreFileBytes(bytes,XLSX=globalThis.XLSX){
 library(XLSX);let book;try{book=XLSX.read(bytes,{type:'array',cellFormula:true,sheetRows:50001});}catch{throw Error('No se pudo leer el archivo Excel. Elige un Asistencia.xlsx generado por esta app.');}
 const sheet=book.Sheets.Datos_app;if(!sheet||sheet.A1?.v!=='ASISTENCIA_ARCHIVO_V1')throw Error('Este Excel no contiene un respaldo de la app. Para una lista nueva usa Cargar alumnos · CSV.');
 const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:''});let data,payload;try{payload=JSON.parse(rows.slice(1).map(r=>{if(typeof r[0]!=='string')throw Error();return r[0];}).join(''));data=validate(payload.data);if(!payload.tables||!Array.isArray(payload.tables.Registro)||!Array.isArray(payload.tables.Detalle))throw Error();}catch{throw Error('Los datos de recuperación del archivo están incompletos o dañados.');}
 for(const [name,expected] of Object.entries(payload.tables)){
 const actual=book.Sheets[name];if(!actual)throw Error(`Falta la hoja ${name}. Usa el archivo original guardado por la app.`);
 if(Object.entries(actual).some(([key,c])=>!key.startsWith('!')&&c.f))throw Error('El archivo fue editado fuera de la app. Usa una copia sin modificar.');
 const values=XLSX.utils.sheet_to_json(actual,{header:1,raw:true,defval:''});
 const trim=rs=>rs.map(r=>{r=[...r];while(r.length&&r.at(-1)==='')r.pop();return r;});
 if(JSON.stringify(trim(values))!==JSON.stringify(trim(expected)))throw Error('Las hojas de asistencia fueron editadas fuera de la app. Usa una copia sin modificar para no perder esos cambios.');
 }
 return data;
}
