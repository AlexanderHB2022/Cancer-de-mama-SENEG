/*
 * Prueba de punta a punta de la encuesta y el panel de administrador.
 *
 *   python3 -m http.server 8123      (en la raíz del proyecto)
 *   node tests/e2e.mjs [carpeta-de-capturas]
 *
 * Requiere el paquete "playwright" (npm i -D playwright).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:8123/";
const SHOTS = process.argv[2] || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let fallos = 0;
const ok = (cond, msg) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) fallos++;
};
const foto = async (page, nombre) => {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, nombre + ".png"), fullPage: true });
};

const PREGUNTA = 'Si mi mamá tuvo cáncer, ¿a qué edad debo empezar a hacerme "mastografías", y cada cuánto?\nGracias, saludos.';

async function contestar(page, { pregunta = PREGUNTA, otro = "Alimentación, y apoyo emocional" } = {}) {
  ok((await page.textContent("#progreso-etiqueta")) === "0 de 5 respondidas", "Progreso inicial: 0 de 5");
  // Enviar vacío: se marcan las 4 obligatorias, como en Google Forms.
  await page.click("#btn-enviar");
  ok((await page.locator(".card.con-error").count()) === 4, "Marca las 4 preguntas obligatorias vacías");
  ok(await page.isVisible("#error-campo-1"), "Mensaje 'Esta pregunta es obligatoria'");
  await page.click("text=Estudiante profesional");
  ok(await page.isHidden("#error-campo-1"), "El error desaparece al contestar");
  await page.click(".escala-op:has(#nivel-2)");
  await page.click("text=Detección temprana");
  await page.click("text=Mastografía");
  ok((await page.textContent("#progreso-etiqueta")) === "3 de 5 respondidas", "Progreso se actualiza");
  await page.fill("#pregunta_experto", pregunta);
  ok((await page.textContent("#cuenta-principal")) === String(pregunta.length), "Contador de caracteres");
  await page.fill("#otro_tema", otro);
  ok((await page.locator(".card.con-error").count()) === 0, "Sin errores con todo contestado");
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

/* ---------- Escritorio, modo local ---------- */
{
  console.log("Escritorio · modo local");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts/.test(m.text()) && errores.push(m.text()));
  await page.goto(BASE);
  await foto(page, "01-formulario-vacio");
  ok((await page.textContent("h1")).includes("Octubre"), "Encabezado con título");

  await contestar(page);
  await foto(page, "02-formulario-lleno");

  // Recarga a mitad: el borrador no se pierde.
  await page.reload();
  ok(await page.isVisible("#aviso-borrador"), "Borrador recuperado tras recargar");
  ok((await page.inputValue("#otro_tema")).startsWith("Alimentación"), "Borrador conserva textos");
  ok((await page.inputValue("#pregunta_experto")) === PREGUNTA, "Borrador conserva pregunta principal");

  // Doble clic en Enviar: solo un registro.
  await page.dblclick("#btn-enviar");
  await page.waitForSelector("#vista-confirmacion:not([hidden])");
  await foto(page, "03-confirmacion");
  ok((await page.textContent("#titulo-gracias")).includes("¡Gracias"), "Pantalla de agradecimiento");
  const n = await page.evaluate(() => JSON.parse(localStorage.getItem("octubreRosa.respuestas.v1")).length);
  ok(n === 1, "Doble clic guarda un solo registro (" + n + ")");

  await page.click("#btn-inicio");
  ok(await page.isVisible("#vista-encuesta"), "Volver al inicio");
  ok(await page.isHidden("#aviso-borrador"), "Sin borrador después de enviar");
  ok((await page.inputValue("#pregunta_experto")) === "", "Formulario limpio para otra respuesta");

  // Borrar formulario pide confirmación con un segundo clic.
  await page.click("text=Profesor(a)");
  await page.click("#btn-borrar");
  ok(await page.isChecked("#rol-4"), "Primer clic en Borrar no borra");
  await page.click("#btn-borrar");
  ok(!(await page.isChecked("#rol-4")), "Segundo clic borra el formulario");

  // Segunda respuesta independiente con caracteres especiales.
  await contestar(page, { pregunta: '=SUMA(1,2) ¿"comillas", comas; y ñ?', otro: "" });
  await page.click("#btn-enviar");
  await page.waitForSelector("#vista-confirmacion:not([hidden])");

  // Panel de administrador
  await page.click("#enlace-admin");
  await page.waitForSelector("#admin-contenido:not([hidden])");
  ok((await page.textContent("#kpi-total")) === "2", "Total de respuestas = 2");
  ok((await page.textContent("#kpi-preguntas")) === "2", "Preguntas recibidas = 2");
  ok((await page.textContent("#kpi-nivel")) === "2.0", "Conocimiento promedio = 2.0");
  ok((await page.locator("#grafica-temas .barra").first().textContent()).includes("Detección temprana"), "Gráfica de temas ordenada");
  ok((await page.locator("#tabla-cuerpo tr").count()) === 2, "Tabla con 2 filas");
  await foto(page, "04-admin-escritorio");

  await page.fill("#filtro-texto", "mastografias");
  await page.waitForTimeout(250);
  ok((await page.locator("#tabla-cuerpo tr").count()) === 1, "Búsqueda sin acentos encuentra 'mastografías'");
  ok((await page.locator("#tabla-cuerpo mark").count()) >= 1, "Resalta coincidencias");
  await page.fill("#filtro-texto", "");
  await page.selectOption("#filtro-tema", "Prevención");
  ok(await page.isVisible("#tabla-vacia"), "Filtro por tema sin coincidencias");
  await page.selectOption("#filtro-tema", "");
  await page.selectOption("#filtro-rol", "Estudiante profesional");
  ok((await page.locator("#tabla-cuerpo tr").count()) === 2, "Filtro por rol");

  const [descarga] = await Promise.all([page.waitForEvent("download"), page.click("#btn-csv")]);
  ok(descarga.suggestedFilename() === "respuestas_octubre_rosa.csv", "Nombre del CSV");
  const csvPath = await descarga.path();
  const bytes = fs.readFileSync(csvPath);
  ok(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, "CSV con BOM UTF-8");
  const csv = bytes.toString("utf8").slice(1);
  ok(csv.startsWith("timestamp,rol,nivel_conocimiento,temas,pregunta_experto,otro_tema\r\n"), "Encabezados del CSV");
  ok(csv.includes('"Si mi mamá tuvo cáncer, ¿a qué edad debo empezar a hacerme ""mastografías"", y cada cuánto?\nGracias, saludos."'), "CSV escapa comillas, comas, saltos y acentos");
  ok(csv.includes(`"'=SUMA(1,2) ¿""comillas"", comas; y ñ?"`), "CSV neutraliza fórmulas");
  ok(csv.includes('"Detección temprana; Mastografía"'), "Temas unidos con punto y coma");
  if (SHOTS) fs.copyFileSync(csvPath, path.join(SHOTS, "respuestas_octubre_rosa.csv"));

  ok(errores.length === 0, "Sin errores de JavaScript" + (errores.length ? ": " + errores.join(" | ") : ""));
  await ctx.close();
}

/* ---------- Móvil ---------- */
{
  console.log("Móvil · 390px");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await foto(page, "05-formulario-movil");
  const desborde = async () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!(await desborde()), "Formulario sin scroll horizontal");
  await page.tap("#btn-enviar");
  await foto(page, "06-errores-movil");
  await page.tap("text=Profesor(a)");
  await page.tap(".escala-op:has(#nivel-4)");
  await page.tap("text=Prevención");
  await page.tap("text=Cáncer de mama en hombres");
  await page.fill("#pregunta_experto", "¿Los hombres también deben hacerse autoexploración?");
  await foto(page, "07-lleno-movil");
  ok(!(await desborde()), "Sin scroll horizontal con contenido");
  const alto = await page.evaluate(() => document.querySelector("#btn-enviar").getBoundingClientRect().height);
  ok(alto >= 48, "Botones táctiles ≥ 48px (" + alto + ")");
  await page.tap("#btn-enviar");
  await page.waitForSelector("#vista-confirmacion:not([hidden])");
  await foto(page, "09-confirmacion-movil");
  await page.goto(BASE + "#admin");
  await page.waitForSelector("#admin-contenido:not([hidden])");
  ok(!(await desborde()), "Panel sin scroll horizontal en móvil");
  await foto(page, "10-admin-movil");
  await ctx.close();
}

/* ---------- Modo Google Sheets (servidor simulado) ---------- */
{
  console.log("Modo Google Sheets (simulado)");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const filas = [];
  let fallarProximo = true;
  await page.route("**/config.js", (r) => r.fulfill({
    contentType: "application/javascript",
    body: 'window.ENCUESTA_CONFIG={APPS_SCRIPT_URL:"https://script.google.com/macros/s/PRUEBA/exec",CSV_FILENAME:"respuestas_octubre_rosa.csv",MAX_PREGUNTA:500,MAX_OTRO_TEMA:300};',
  }));
  await page.route("https://script.google.com/**", async (r) => {
    const b = JSON.parse(r.request().postData() || "{}");
    if (b.accion === "guardar") {
      if (fallarProximo) { fallarProximo = false; return r.fulfill({ status: 500, body: "error" }); }
      await new Promise((res) => setTimeout(res, 400));
      if (!filas.some((f) => f.id === b.respuesta.id)) filas.push(b.respuesta);
      return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    if (b.accion === "listar") {
      if (b.clave !== "secreta") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, codigo: "clave" }) });
      return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, respuestas: filas }) });
    }
  });
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await contestar(page);
  await page.click("#btn-enviar");
  await page.waitForSelector("#error-envio:not([hidden])");
  ok(true, "Muestra error si falla el guardado");
  await foto(page, "11-error-envio");
  ok((await page.inputValue("#otro_tema")).length > 0, "Las respuestas se conservan tras el error");
  await page.click("#btn-enviar");
  ok(await page.locator("#btn-enviar.cargando").isVisible(), "Estado de carga mientras guarda");
  await page.waitForSelector("#vista-confirmacion:not([hidden])");
  ok(filas.length === 1, "Reintento guarda un solo registro");

  await page.goto(BASE + "#admin");
  await page.waitForSelector("#admin-acceso:not([hidden])");
  await foto(page, "12-acceso-admin");
  await page.fill("#clave-admin", "incorrecta");
  await page.click("#btn-entrar");
  await page.waitForSelector("#error-acceso:not([hidden])");
  ok((await page.textContent("#error-acceso")).includes("no es correcta"), "Rechaza clave incorrecta");
  await page.fill("#clave-admin", "secreta");
  await page.click("#btn-entrar");
  await page.waitForSelector("#admin-contenido:not([hidden])");
  ok((await page.textContent("#kpi-total")) === "1", "Panel carga datos con la clave correcta");
  await ctx.close();
}

/* ---------- Tema oscuro ---------- */
if (SHOTS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await foto(page, "13-portada-oscuro");
  await ctx.close();
}

await browser.close();
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas pasaron");
process.exit(fallos ? 1 : 0);
