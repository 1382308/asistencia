# Asistencia · Aula

PWA para tomar asistencia con tarjetas QR. La app guarda la sesión en el navegador y permite respaldar cada grupo en un Excel maestro.

## Empezar

Abre [Asistencia](https://1382308.github.io/asistencia/) con internet e instálala desde el menú del navegador o añádela a la pantalla de inicio. Ábrela en línea una vez; en **Opciones → Ayuda**, espera el aviso **“Lista sin conexión”**. La cámara requiere HTTPS y permiso del navegador.

En Inicio, descarga la plantilla CSV. Conserva el encabezado `nombre` y agrega un alumno por fila:

```csv
nombre
Ana López
Carlos Ruiz
```

Carga ese `.csv` y escribe el nombre del grupo cuando se solicite. Para crear grupos nuevos, usa esta plantilla de una sola columna. Si hay nombres repetidos, complétalos para distinguir a cada alumno. Si ya trabajas con iDoceo, su Excel de asistencia sigue siendo compatible.

## Pasar lista

Permite el acceso a la cámara y escanea las tarjetas. La primera vez que aparezca un QR, elige al alumno y escribe el nombre preferido. La app guarda la relación entre ese QR y el alumno; después lo reconocerá automáticamente. Puedes corregir nombres o QR desde **Opciones → Corregir nombres o QR**.

## Guardar, restaurar y exportar

Al finalizar la clase, guarda el Excel que ofrece la app (por ejemplo, `Asistencia - 3A.xlsx`) y reemplaza la copia anterior del grupo. Confirma el guardado solo cuando ya esté en Archivos u otra ubicación elegida. El Excel maestro conserva la lista, los QR, los nombres preferidos y el historial. La próxima clase, carga la copia más reciente; también permite recuperar el grupo si se borra el almacenamiento del navegador o cambias de dispositivo. No edites las hojas del Excel fuera de la app: podría impedir su restauración.

Para descargar una tabla de asistencia en CSV, abre **Opciones → Historial del grupo abierto → Exportar CSV**.

## Sin conexión y datos del aula

Después de cargar la app en línea una vez, sus archivos se guardan para usarla sin conexión. Prueba abrirla en modo avión antes de clase. Los datos de la clase se guardan en el navegador de este dispositivo; la app no los envía a GitHub. El Excel maestro contiene una hoja de recuperación oculta llamada `Datos_app`, que no está cifrada, así que guárdalo con cuidado.
