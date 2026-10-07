/*
 * Genera una versión de un solo archivo HTML (CSS y JS incrustados).
 *
 *   node scripts/build-single-file.mjs              -> dist/encuesta-octubre-rosa.html
 *   node scripts/build-single-file.mjs --artifact   -> dist/artifact.html (para publicar como Artifact de Claude)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leer = (p) => fs.readFileSync(path.join(raiz, p), "utf8");
const artifact = process.argv.includes("--artifact");

let html = leer("index.html");
html = html.replace('<link rel="stylesheet" href="css/styles.css">', () => "<style>\n" + leer("css/styles.css") + "</style>");
for (const js of ["js/config.js", "js/storage.js", "js/app.js"]) {
  html = html.replace(`<script src="${js}"></script>`, () => "<script>\n" + leer(js) + "</script>");
}

if (artifact) {
  // El Artifact agrega su propio esqueleto: se deja solo el contenido.
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/i, "")
    .replace(/<meta name="viewport"[^>]*>\s*/i, "")
    .replace(/<link rel="icon"[^>]*>\s*/i, "")
    .replace(/<link rel="preconnect"[^>]*>\s*/gi, "");
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = head.trim() + "\n" + body.trim() + "\n";
}

fs.mkdirSync(path.join(raiz, "dist"), { recursive: true });
const salida = path.join(raiz, "dist", artifact ? "artifact.html" : "encuesta-octubre-rosa.html");
fs.writeFileSync(salida, html);
console.log("Generado:", path.relative(raiz, salida), (html.length / 1024).toFixed(1) + " KB");
