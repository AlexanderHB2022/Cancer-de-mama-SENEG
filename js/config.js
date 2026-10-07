/*
 * Configuración de la encuesta Octubre Rosa.
 *
 * ¿Dónde se guardan las respuestas?
 *   1. Si APPS_SCRIPT_URL tiene una URL, las respuestas se envían a una
 *      hoja de Google Sheets mediante Google Apps Script (ver apps-script/Code.gs).
 *      Es la opción recomendada para publicar la encuesta en internet.
 *   2. Si la página se abre como Artifact de Claude, se usa la base de
 *      datos del Artifact automáticamente.
 *   3. Si no hay ninguna de las dos, la encuesta funciona en "modo
 *      demostración" y guarda las respuestas solo en este navegador.
 */
window.ENCUESTA_CONFIG = {
  // Pega aquí la URL de tu implementación de Apps Script (termina en /exec).
  APPS_SCRIPT_URL: "",

  // Nombre del archivo CSV que descarga el panel de administrador.
  CSV_FILENAME: "respuestas_octubre_rosa.csv",

  // Límites de texto.
  MAX_PREGUNTA: 500,
  MAX_OTRO_TEMA: 300,
};
