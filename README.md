# Encuesta Octubre Rosa · Tec de Monterrey, Campus Sinaloa

Encuesta anónima, estilo Google Forms, para recopilar las preguntas que la comunidad Tec le haría a un experto en cáncer de mama. Incluye un panel privado con estadísticas, tabla de respuestas y descarga en CSV.

**Pregunta central:** *¿Qué le preguntarías a un experto en cáncer de mama para resolver tus dudas?*

Es HTML, CSS y JavaScript puro. No usa frameworks ni pasos de compilación, así que se puede publicar en cualquier hosting estático (GitHub Pages, Netlify, Vercel o el servidor del campus).

## Estructura

```
index.html              Formulario, confirmación y panel de administrador
css/styles.css          Estilos (claro/oscuro, responsive)
js/config.js            Configuración: URL de Google Apps Script, límites, nombre del CSV
js/storage.js           Guardado de respuestas (Google Sheets, Artifact de Claude o modo demo)
js/app.js               Lógica de la encuesta, del panel y del CSV
apps-script/Code.gs     Backend gratuito con Google Sheets
scripts/                Genera una versión de un solo archivo HTML
tests/e2e.mjs           Pruebas automáticas de punta a punta (Playwright)
```

## La encuesta

Funciona como un formulario de Google Forms: todo está en una sola página.

1. **Encabezado**: franja rosa con el moño y la tarjeta del título (*Octubre Rosa*, subtítulo, *Comunidad Tec · Campus Sinaloa* y la nota de campos obligatorios).
2. **Cinco preguntas, una por tarjeta**:
   1. Rol en la comunidad Tec (obligatoria)
   2. Qué tanto sabes sobre el cáncer de mama, del 1 al 5 (obligatoria)
   3. Temas que te generan más dudas, selección múltiple (obligatoria)
   4. **Pregunta principal** para el experto, hasta 500 caracteres con contador (obligatoria)
   5. Otro tema que te gustaría que se abordara (opcional)
3. **Enviar** y la pantalla de agradecimiento.

Detalles de calidad incluidos:

- Si se intenta enviar con preguntas obligatorias vacías, esas tarjetas se marcan en rojo con *Esta pregunta es obligatoria* y la página baja a la primera. El aviso desaparece al contestar.
- Una barra delgada fija arriba y el contador *N de 5 respondidas* muestran el avance.
- **Ninguna respuesta se pierde**: lo que se va contestando se guarda como borrador en el navegador. Si la persona recarga o cierra la página, sus respuestas siguen ahí.
- *Borrar formulario* pide un segundo clic para confirmar.
- **Sin duplicados**: cada envío lleva un identificador único. Un doble clic o un reintento tras un error no crea un segundo registro.
- Mientras se guarda aparece un indicador de carga, y si el guardado falla se muestra un error. Las respuestas siguen en pantalla para reintentar.
- Se puede contestar con teclado (Ctrl + Enter en los campos de texto envía), funciona con lectores de pantalla y respeta *reducir movimiento*.
- Es anónima: no pide nombre, correo, teléfono ni datos médicos personales.

## Panel de administrador

Se abre con el enlace discreto **Administración** del pie de página, o añadiendo `#admin` a la URL (por ejemplo `https://tusitio/#admin`).

- Total de respuestas, preguntas recibidas, conocimiento promedio y fecha de la última respuesta.
- Gráficas: temas que generan más dudas (en % de respuestas), distribución por rol y nivel de conocimiento.
- Tabla de respuestas con búsqueda (no distingue acentos ni mayúsculas) y filtros por rol y tema. En el celular la tabla se muestra como tarjetas.
- Botón **Descargar CSV** → `respuestas_octubre_rosa.csv`, con las columnas
  `timestamp, rol, nivel_conocimiento, temas, pregunta_experto, otro_tema`.
  El archivo está en UTF-8 con BOM para que Excel muestre bien los acentos. Las comas, comillas y saltos de línea van escapados, y un texto que empiece con `=`, `+`, `-` o `@` se neutraliza para que Excel no lo ejecute como fórmula.

## Dónde se guardan las respuestas

`js/storage.js` elige el modo automáticamente:

| Modo | Cuándo se usa | Quién puede responder | Acceso al panel |
|---|---|---|---|
| **Google Sheets** (recomendado) | `APPS_SCRIPT_URL` tiene una URL en `js/config.js` | Cualquier persona con el enlace | Clave de administrador, verificada en el servidor |
| **Artifact de Claude** | La página se abre como Artifact de Claude | Personas con acceso de *Colaborador* o superior | Propietario y editores del Artifact |
| **Demostración** | Ninguno de los anteriores | Solo se guarda en ese navegador | Libre (solo ve los datos de ese navegador) |

### Configurar Google Sheets (unos 10 minutos)

1. Crea una hoja de cálculo nueva en Google Sheets, por ejemplo *Respuestas Octubre Rosa*.
2. Ve a **Extensiones → Apps Script**, borra el contenido de `Code.gs` y pega el de [`apps-script/Code.gs`](apps-script/Code.gs). Guarda.
3. En **Configuración del proyecto** (ícono de engrane) → **Propiedades de la secuencia de comandos** → *Agregar propiedad*:
   - Propiedad: `ADMIN_KEY`
   - Valor: una clave larga que solo conozca el equipo organizador.
4. **Implementar → Nueva implementación** → tipo **Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario**
   - Autoriza los permisos que pide Google.
5. Copia la URL de la aplicación web (termina en `/exec`) y pégala en `js/config.js`:
   ```js
   APPS_SCRIPT_URL: "https://script.google.com/macros/s/XXXXXXXX/exec",
   ```
6. Publica el sitio (ver abajo). Cada respuesta llega como una fila nueva a la hoja **Respuestas**.

La clave de administrador **solo** existe en Apps Script. El sitio web nunca la contiene, así que nadie puede leer las respuestas sin conocerla. El servidor también valida cada envío (rol y temas permitidos, nivel de 1 a 5, longitudes máximas) e ignora envíos repetidos.

> Si más adelante modificas `Code.gs`, usa **Implementar → Administrar implementaciones → Editar → Nueva versión** para que la URL siga siendo la misma.

### Usarla como Artifact de Claude

La página detecta la base de datos del Artifact (`claude.use("db")`) igual que el HTML original, pero con estas mejoras:

- **Cada respuesta es un registro independiente** (`respuestas/<persona>/items/<id>`). Ya no se sobrescribe la respuesta anterior de la misma persona.
- **Privacidad por reglas de acceso**: solo el propietario y los editores leen `respuestas`. Cada participante solo puede escribir en su propio espacio y no puede leer el de nadie más. Al publicar se declaran estas capacidades:
  ```json
  {
    "db": { "rules": [
      { "path": "respuestas",        "read": "admin",    "write": "admin" },
      { "path": "respuestas/{self}", "read": "interact", "write": "interact" }
    ] },
    "user": {},
    "downloads": true
  }
  ```
- El botón de administrador espera la respuesta de `canEdit()`. En el original se evaluaba la promesa sin esperarla y el botón aparecía para todo el mundo.
- El CSV se descarga con la capacidad `downloads`, la única que funciona dentro del Artifact.

Limitación importante: en un Artifact, solo pueden enviar respuestas las personas con nivel *Colaborador* o superior dentro de la organización dueña del Artifact. Las visitas externas por enlace público solo pueden ver la página. Para una encuesta abierta a toda la comunidad, usa el modo Google Sheets.

`npm run build:artifact` genera `dist/artifact.html` (un solo archivo, sin el esqueleto `<html>`) listo para publicarse como Artifact.

## Publicar el sitio

Es un sitio estático. Cualquiera de estas opciones funciona:

- **GitHub Pages**: *Settings → Pages → Deploy from a branch → `main` / root*. Tu encuesta quedará en `https://<usuario>.github.io/<repositorio>/`.
- **Netlify / Vercel**: arrastra la carpeta del proyecto o conecta el repositorio. No requiere comando de compilación.
- **Un solo archivo**: `npm run build` genera `dist/encuesta-octubre-rosa.html` con todo incrustado.

Para probarla en tu computadora:

```bash
python3 -m http.server 8123
# abre http://localhost:8123  ·  panel: http://localhost:8123/#admin
```

## Pruebas

```bash
npm install            # instala Playwright
npx playwright install chromium
python3 -m http.server 8123 &
npm test               # o: node tests/e2e.mjs capturas/   (guarda capturas y el CSV)
```

Las pruebas recorren la encuesta completa en escritorio y en móvil (390 px). Verifican:

- marcado de preguntas obligatorias vacías, progreso y contador;
- recuperación del borrador al recargar y el botón *Borrar formulario*;
- que un doble clic en *Enviar* solo cree un registro;
- estadísticas, búsqueda sin acentos y filtros del panel;
- el CSV: BOM, encabezados, escape de comas, comillas, saltos de línea y acentos, y neutralización de fórmulas;
- en modo Google Sheets simulado: error de guardado y reintento sin duplicar, rechazo de clave incorrecta y acceso con la correcta;
- que no haya scroll horizontal en móvil ni errores de JavaScript.

## Personalizar

- **Textos y preguntas**: `index.html`. Las listas de roles y temas están en `js/app.js` (`ROLES`, `TEMAS`) y, si usas Google Sheets, también en `apps-script/Code.gs`.
- **Colores**: variables al inicio de `css/styles.css` (`--tema` es el rosa principal; `--fondo`, `--tarjeta`, `--texto`, `--suave` y `--borde` controlan el resto).
- **Límites de caracteres y nombre del CSV**: `js/config.js`.

---

Esta encuesta tiene fines informativos y de recopilación de preguntas. No sustituye la orientación de un profesional de la salud.
