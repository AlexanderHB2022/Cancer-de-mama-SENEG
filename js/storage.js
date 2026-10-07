/*
 * Capa de almacenamiento de respuestas.
 *
 * Expone window.Almacen con la misma interfaz para los tres modos:
 *   - "sheets": Google Sheets mediante Apps Script (producción).
 *   - "claude": base de datos del Artifact de Claude.
 *   - "local":  demostración; solo en este navegador.
 *
 *   await Almacen.modo()                  -> "sheets" | "claude" | "local" | "sinAcceso"
 *   await Almacen.guardar(respuesta)      -> guarda un registro (idempotente por id)
 *   await Almacen.accesoAdmin()           -> {permitido, requiereClave}
 *   await Almacen.listar({clave})         -> [respuesta, ...]
 *
 * Cada respuesta es un registro independiente con un id único generado en
 * el navegador; reenviar el mismo id nunca crea un duplicado.
 */
(function () {
  "use strict";

  const CFG = window.ENCUESTA_CONFIG || {};
  const LOCAL_KEY = "octubreRosa.respuestas.v1";

  class ErrorAlmacen extends Error {
    constructor(codigo, mensaje) {
      super(mensaje);
      this.codigo = codigo;
    }
  }

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Normaliza un registro para que todos los modos devuelvan la misma forma. */
  function normalizar(r) {
    const temas = Array.isArray(r.temas)
      ? r.temas
      : String(r.temas || "")
          .split(/\s*;\s*/)
          .filter(Boolean);
    return {
      id: String(r.id || ""),
      timestamp: String(r.timestamp || ""),
      rol: String(r.rol || ""),
      nivel_conocimiento: Number(r.nivel_conocimiento) || 0,
      temas,
      pregunta_experto: String(r.pregunta_experto || ""),
      otro_tema: String(r.otro_tema || ""),
    };
  }

  /* ---------- Modo Google Sheets (Apps Script) ---------- */
  const sheets = {
    url: (CFG.APPS_SCRIPT_URL || "").trim(),

    async guardar(r) {
      // text/plain evita la petición previa CORS que Apps Script no admite.
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ accion: "guardar", respuesta: r }),
      });
      if (!res.ok) throw new ErrorAlmacen("red", "HTTP " + res.status);
      const json = await res.json();
      if (!json.ok) throw new ErrorAlmacen(json.codigo || "servidor", json.error || "Error del servidor");
    },

    async listar({ clave }) {
      if (!clave) throw new ErrorAlmacen("clave", "Falta la clave de administrador");
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ accion: "listar", clave }),
      });
      if (!res.ok) throw new ErrorAlmacen("red", "HTTP " + res.status);
      const json = await res.json();
      if (!json.ok) throw new ErrorAlmacen(json.codigo || "servidor", json.error || "Error del servidor");
      return (json.respuestas || []).map(normalizar);
    },

    async accesoAdmin() {
      return { permitido: true, requiereClave: true };
    },
  };

  /* ---------- Modo Artifact de Claude ---------- */
  /*
   * Estructura en la base de datos:
   *   respuestas/<idPersona>                 -> índice {actualizado}
   *   respuestas/<idPersona>/items/<idResp>  -> la respuesta
   * Reglas (declaradas al publicar): solo el administrador lee "respuestas";
   * cada persona solo escribe dentro de su propio espacio y no puede leer
   * el de nadie más.
   */
  const claude = {
    db: null,
    user: null,

    async iniciar() {
      if (!window.claude || typeof window.claude.use !== "function") return false;
      try {
        const [db, user] = await Promise.all([
          window.claude.use("db"),
          window.claude.use("user"),
        ]);
        this.db = db;
        this.user = user;
        return !!db;
      } catch (e) {
        return false;
      }
    },

    async guardar(r) {
      const uid = this.user ? await this.user.id() : null;
      if (!uid) throw new ErrorAlmacen("sin_sesion", "Inicia sesión para enviar tu respuesta.");
      const base = "respuestas/" + uid;
      const intento = async () => {
        await this.db.doc(base + "/items/" + r.id).set(r);
        await this.db.doc(base).set({ actualizado: r.timestamp });
      };
      try {
        await intento();
      } catch (e) {
        if (e && e.code === "unavailable") {
          await esperar(400 + Math.random() * 800);
          await intento();
        } else if (e && e.code === "invalid_argument") {
          throw new ErrorAlmacen("sin_permiso", "No tienes permiso para responder en esta página.");
        } else {
          throw new ErrorAlmacen(e && e.code ? e.code : "desconocido", (e && e.message) || "Error al guardar");
        }
      }
    },

    async listar() {
      const personas = await this.db.collection("respuestas").limit(1000).get();
      const lotes = await Promise.all(
        personas.docs.map((d) =>
          this.db.collection("respuestas/" + d.id + "/items").limit(1000).get()
        )
      );
      const todas = [];
      lotes.forEach((snap) => snap.docs.forEach((doc) => doc.exists && todas.push(normalizar(doc.data()))));
      return todas;
    },

    async accesoAdmin() {
      const puede = this.user ? await this.user.canEdit() : false;
      return { permitido: !!puede, requiereClave: false };
    },
  };

  /* ---------- Modo local (demostración) ---------- */
  const local = {
    leer() {
      try {
        return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
      } catch (e) {
        return [];
      }
    },
    async guardar(r) {
      const todas = this.leer().filter((x) => x.id !== r.id);
      todas.push(r);
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(todas));
      } catch (e) {
        throw new ErrorAlmacen("almacenamiento", "El navegador no permitió guardar la respuesta.");
      }
    },
    async listar() {
      return this.leer().map(normalizar);
    },
    async accesoAdmin() {
      return { permitido: true, requiereClave: false };
    },
  };

  /* ---------- Dentro de Claude pero sin base de datos ----------
   * (visitante sin sesión o sin permiso). No se guarda en el navegador para
   * no hacer creer a nadie que su respuesta llegó. */
  const sinAcceso = {
    async guardar() {
      throw new ErrorAlmacen("sin_sesion", "Inicia sesión para enviar tu respuesta.");
    },
    async listar() {
      return [];
    },
    async accesoAdmin() {
      return { permitido: false, requiereClave: false };
    },
  };

  /* ---------- Selección de modo ---------- */
  let modoPromesa = null;
  function resolverModo() {
    if (!modoPromesa) {
      modoPromesa = (async () => {
        if (sheets.url) return "sheets";
        if (await claude.iniciar()) return "claude";
        if (window.claude && typeof window.claude.use === "function") return "sinAcceso";
        return "local";
      })();
    }
    return modoPromesa;
  }
  const impl = { sheets, claude, local, sinAcceso };

  window.Almacen = {
    ErrorAlmacen,
    modo: resolverModo,

    async guardar(r) {
      const m = await resolverModo();
      return impl[m].guardar(r);
    },
    async listar(opciones = {}) {
      const m = await resolverModo();
      return impl[m].listar(opciones);
    },
    async accesoAdmin() {
      const m = await resolverModo();
      return impl[m].accesoAdmin();
    },

    /* Descarga de archivos: dentro de un Artifact se usa la capacidad
     * "downloads"; en un sitio normal, un enlace temporal. */
    async descargar(nombre, contenido, tipo) {
      const blob = new Blob([contenido], { type: tipo });
      if (window.claude && typeof window.claude.use === "function") {
        const dl = await window.claude.use("downloads").catch(() => null);
        if (dl) {
          await dl.save({ filename: nombre, data: blob });
          return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
  };
})();
