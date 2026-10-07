/**
 * Encuesta Octubre Rosa · Backend en Google Apps Script + Google Sheets.
 *
 * Instalación (ver README.md para el paso a paso con capturas de texto):
 *   1. Crea una hoja de cálculo de Google y abre Extensiones → Apps Script.
 *   2. Pega este archivo completo en Code.gs.
 *   3. En Configuración del proyecto → Propiedades de la secuencia de comandos,
 *      agrega la propiedad ADMIN_KEY con una clave larga y secreta.
 *   4. Implementar → Nueva implementación → Aplicación web:
 *        Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario.
 *   5. Copia la URL que termina en /exec y pégala en js/config.js.
 *
 * Cada respuesta es una fila independiente en la hoja "Respuestas".
 * La clave de administrador nunca se guarda en el sitio web: solo aquí.
 */

var HOJA = 'Respuestas';
var COLUMNAS = ['id', 'timestamp', 'rol', 'nivel_conocimiento', 'temas', 'pregunta_experto', 'otro_tema', 'recibido'];

var ROLES = [
  'Estudiante de preparatoria', 'Estudiante profesional', 'Estudiante de posgrado',
  'Profesor(a)', 'Colaborador(a) / administrativo', 'Otro'
];
var TEMAS = [
  'Prevención', 'Factores de riesgo', 'Autoexploración', 'Detección temprana', 'Mastografía',
  'Síntomas y señales de alerta', 'Diagnóstico', 'Tratamiento', 'Mitos y realidades',
  'Cáncer de mama en hombres', 'Factores hereditarios / genética', 'Otro'
];
var MAX_PREGUNTA = 500;
var MAX_OTRO = 300;

function doPost(e) {
  try {
    var cuerpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (cuerpo.accion === 'guardar') return json_(guardar_(cuerpo.respuesta || {}));
    if (cuerpo.accion === 'listar') return json_(listar_(cuerpo.clave));
    return json_({ ok: false, codigo: 'accion', error: 'Acción no válida' });
  } catch (err) {
    return json_({ ok: false, codigo: 'servidor', error: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, servicio: 'Encuesta Octubre Rosa' });
}

function guardar_(r) {
  var id = texto_(r.id, 80);
  var rol = texto_(r.rol, 80);
  var nivel = Number(r.nivel_conocimiento);
  var temas = (Array.isArray(r.temas) ? r.temas : []).filter(function (t) { return TEMAS.indexOf(t) !== -1; });
  var pregunta = texto_(r.pregunta_experto, MAX_PREGUNTA).trim();
  var otro = texto_(r.otro_tema, MAX_OTRO).trim();

  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return { ok: false, codigo: 'datos', error: 'Identificador inválido' };
  if (ROLES.indexOf(rol) === -1) return { ok: false, codigo: 'datos', error: 'Rol inválido' };
  if (!(nivel >= 1 && nivel <= 5 && Math.floor(nivel) === nivel)) return { ok: false, codigo: 'datos', error: 'Nivel inválido' };
  if (!temas.length) return { ok: false, codigo: 'datos', error: 'Selecciona al menos un tema' };
  if (pregunta.length < 3) return { ok: false, codigo: 'datos', error: 'La pregunta es obligatoria' };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var hoja = hoja_();
    // Idempotencia: si el mismo envío llega dos veces, no se duplica.
    var ultima = hoja.getLastRow();
    if (ultima > 1) {
      var desde = Math.max(2, ultima - 499);
      var ids = hoja.getRange(desde, 1, ultima - desde + 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i][0] === id) return { ok: true, duplicado: true };
      }
    }
    var ahora = new Date();
    var ts = new Date(r.timestamp);
    if (isNaN(ts.getTime()) || Math.abs(ts - ahora) > 24 * 3600 * 1000) ts = ahora;
    hoja.appendRow([
      id, ts.toISOString(), rol, nivel, temas.join('; '),
      seguro_(pregunta), seguro_(otro), ahora.toISOString()
    ]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function listar_(clave) {
  var esperada = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!esperada) return { ok: false, codigo: 'config', error: 'Falta configurar ADMIN_KEY en el proyecto' };
  if (!clave || String(clave) !== esperada) {
    Utilities.sleep(600); // frena intentos de adivinar la clave
    return { ok: false, codigo: 'clave', error: 'Clave incorrecta' };
  }
  var hoja = hoja_();
  var ultima = hoja.getLastRow();
  if (ultima < 2) return { ok: true, respuestas: [] };
  var filas = hoja.getRange(2, 1, ultima - 1, COLUMNAS.length).getValues();
  var respuestas = filas.map(function (f) {
    return {
      id: String(f[0]),
      timestamp: f[1] instanceof Date ? f[1].toISOString() : String(f[1]),
      rol: String(f[2]),
      nivel_conocimiento: Number(f[3]) || 0,
      temas: String(f[4]).split(/\s*;\s*/).filter(String),
      pregunta_experto: limpiar_(f[5]),
      otro_tema: limpiar_(f[6])
    };
  });
  return { ok: true, respuestas: respuestas };
}

function hoja_() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(HOJA);
  if (!hoja) {
    hoja = libro.insertSheet(HOJA);
    hoja.appendRow(COLUMNAS);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, COLUMNAS.length).setFontWeight('bold');
  }
  return hoja;
}

function texto_(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').slice(0, max);
}
// Evita que Sheets interprete un texto como fórmula.
function seguro_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function limpiar_(v) {
  var s = String(v == null ? '' : v);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
