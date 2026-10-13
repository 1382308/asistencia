# Asistencia · Aula

PWA para tomar asistencia con tarjetas QR. La app guarda la sesión en el navegador y permite respaldar cada grupo en un Excel maestro.

## Empezar

Abre [Asistencia](https://1382308.github.io/asistencia/) con internet e instálala desde el menú del navegador o añádela a la pantalla de inicio. Ábrela en línea una vez; en **⋯ → Ayuda y uso sin conexión**, espera el aviso **“Lista para usarse sin conexión”**. La cámara requiere HTTPS y permiso del navegador.

Descarga la plantilla CSV desde la pantalla inicial o en **⋯ → Descargar plantilla CSV**. Conserva el encabezado `nombre` y agrega un nombre por fila:

```csv
nombre
Ana López
Luis Ruiz
```

Carga ese `.csv` con **Cargar lista o Excel** (o **Agregar grupo** si ya tienes grupos) y escribe el nombre del grupo. Si hay nombres repetidos, complétalos para distinguirlos. Si ya trabajas con iDoceo, su Excel de asistencia sigue siendo compatible.

## Pasar lista

En **Grupos**, cada tarjeta muestra cómo va la lista de hoy, con un punto por persona. Toca **Escanear** para abrir la cámara, o toca el grupo para ver su lista del día.

La primera vez que aparezca una tarjeta QR, elige a quién pertenece y escribe cómo le llamas. La app guarda esa relación y después la reconoce automáticamente. Si la cámara no lee una tarjeta, usa el botón de teclado del escáner para escribir el código.

En la lista del día puedes marcar **Presente**, **Retraso** o **Falta** con un toque y filtrar por estado (**Sin registrar**, **Faltas**…). Toca un nombre para justificar, quitar la marca o corregir su nombre o tarjeta QR.

Al terminar, toca **Finalizar**. Quien siga sin registro queda con falta; la app lo confirma antes y puedes corregirlo después.

## Guardar, restaurar y exportar

Al finalizar, la app ofrece el Excel del grupo (por ejemplo, `Asistencia - 3A.xlsx`). Guárdalo y reemplaza la copia anterior; confirma el guardado solo cuando ya esté en Archivos u otra ubicación elegida. Mientras haya cambios sin guardar, el grupo muestra **Excel sin guardar** con un botón para hacerlo. El Excel maestro conserva la lista, los QR, los nombres preferidos y el historial. La próxima clase, carga la copia más reciente; también permite recuperar el grupo si se borra el almacenamiento del navegador o cambias de dispositivo. No edites las hojas del Excel fuera de la app: podría impedir su restauración.

Para ver todas las fechas o descargar una tabla de asistencia en CSV, abre el grupo y toca **⋯ → Historial → Exportar CSV**.

## Sin conexión y datos del aula

Después de cargar la app en línea una vez, sus archivos se guardan para usarla sin conexión. Prueba abrirla en modo avión antes de clase. Los datos de la clase se guardan en el navegador de este dispositivo; la app no los envía a GitHub. El Excel maestro contiene una hoja de recuperación oculta llamada `Datos_app`, que no está cifrada, así que guárdalo con cuidado.

La tipografía es [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) (licencia SIL OFL 1.1, incluida en `vendor/`).
