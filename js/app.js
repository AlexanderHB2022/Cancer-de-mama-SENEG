/*
 * Encuesta Octubre Rosa · lógica de la encuesta y del panel de administrador.
 */
(function () {
  "use strict";

  const CFG = window.ENCUESTA_CONFIG || {};
  const MAX_PREGUNTA = CFG.MAX_PREGUNTA || 500;
  const MAX_OTRO = CFG.MAX_OTRO_TEMA || 300;
  const CSV_FILENAME = CFG.CSV_FILENAME || "respuestas_octubre_rosa.csv";
  const BORRADOR_KEY = "octubreRosa.borrador.v1";
  const CLAVE_KEY = "octubreRosa.claveAdmin";
  const TOTAL_PASOS = 5;
  const TIEMPO_LIMITE_MS = 20000;

  const ROLES = [
    "Estudiante de preparatoria",
    "Estudiante profesional",
    "Estudiante de posgrado",
    "Profesor(a)",
    "Colaborador(a) / administrativo",
    "Otro",
  ];
  const TEMAS = [
    "Prevención",
    "Factores de riesgo",
    "Autoexploración",
    "Detección temprana",
    "Mastografía",
    "Síntomas y señales de alerta",
    "Diagnóstico",
    "Tratamiento",
    "Mitos y realidades",
    "Cáncer de mama en hombres",
    "Factores hereditarios / genética",
    "Otro",
  ];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ================= Utilidades ================= */
  function nuevoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function leerLS(clave, almacen) {
    try { return JSON.parse((almacen || localStorage).getItem(clave)); } catch (e) { return null; }
  }
  function escribirLS(clave, valor, almacen) {
    try {
      const a = almacen || localStorage;
      if (valor == null) a.removeItem(clave); else a.setItem(clave, JSON.stringify(valor));
    } catch (e) { /* almacenamiento no disponible: se ignora */ }
  }
  function conTiempoLimite(promesa, ms) {
    return Promise.race([
      promesa,
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("tiempo"), { codigo: "tiempo" })), ms)),
    ]);
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  const fmtFecha = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  function fechaLegible(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "—" : fmtFecha.format(d);
  }
  function fechaCSV(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return String(iso || "");
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
      p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  const normalizarBusqueda = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  /* ================= Vistas y rutas ================= */
  const vistas = {
    portada: $("#vista-portada"),
    encuesta: $("#vista-encuesta"),
    confirmacion: $("#vista-confirmacion"),
    admin: $("#vista-admin"),
  };
  let vistaActual = null;
  function mostrarVista(nombre) {
    if (vistaActual === nombre) return;
    vistaActual = nombre;
    Object.entries(vistas).forEach(([k, el]) => { el.hidden = k !== nombre; });
    $("#enlace-admin").hidden = nombre === "admin";
    window.scrollTo({ top: 0 });
  }

  function enrutar() {
    if (location.hash === "#admin") {
      abrirAdmin();
    } else if (vistaActual === "admin" || vistaActual === null) {
      irAPortada();
    }
  }
  window.addEventListener("hashchange", enrutar);

  /* ================= Encuesta ================= */
  const estado = {
    paso: 1,
    respuestas: { rol: "", nivel_conocimiento: 0, temas: [], pregunta_experto: "", otro_tema: "" },
    envioId: nuevoId(),
    enviando: false,
  };

  const form = $("#formulario");
  const pasos = $$(".paso");
  const btnAtras = $("#btn-atras");
  const btnSiguiente = $("#btn-siguiente");
  const btnEnviar = $("#btn-enviar");
  const taPregunta = $("#pregunta_experto");
  const taOtro = $("#otro_tema");
  const errorEnvio = $("#error-envio");
  const pista = $("#pista-requerida");

  taPregunta.maxLength = MAX_PREGUNTA;
  taOtro.maxLength = MAX_OTRO;

  function crearOpcion(tipo, nombre, valor, i) {
    const label = document.createElement("label");
    label.className = "opcion";
    const input = document.createElement("input");
    input.type = tipo;
    input.name = nombre;
    input.value = valor;
    input.id = nombre + "-" + (i + 1);
    const marca = document.createElement("i");
    marca.className = tipo === "radio" ? "radio" : "check";
    const texto = document.createElement("span");
    texto.textContent = valor;
    label.append(input, marca, texto);
    return label;
  }
  ROLES.forEach((r, i) => $("#opciones-rol").appendChild(crearOpcion("radio", "rol", r, i)));
  TEMAS.forEach((t, i) => $("#opciones-temas").appendChild(crearOpcion("checkbox", "temas", t, i)));

  function pasoValido(n) {
    const r = estado.respuestas;
    switch (n) {
      case 1: return ROLES.includes(r.rol);
      case 2: return r.nivel_conocimiento >= 1 && r.nivel_conocimiento <= 5;
      case 3: return r.temas.length > 0;
      case 4: return r.pregunta_experto.trim().length >= 3;
      case 5: return true;
      default: return false;
    }
  }
  const MENSAJES_REQUERIDOS = {
    1: "Elige tu rol para continuar.",
    2: "Elige un número del 1 al 5 para continuar.",
    3: "Elige al menos un tema para continuar.",
    4: "Escribe tu pregunta para continuar.",
  };

  function leerFormulario() {
    const r = estado.respuestas;
    const rol = form.querySelector('input[name="rol"]:checked');
    r.rol = rol ? rol.value : "";
    const nivel = form.querySelector('input[name="nivel_conocimiento"]:checked');
    r.nivel_conocimiento = nivel ? Number(nivel.value) : 0;
    r.temas = $$('input[name="temas"]:checked').map((i) => i.value);
    r.pregunta_experto = taPregunta.value.slice(0, MAX_PREGUNTA);
    r.otro_tema = taOtro.value.slice(0, MAX_OTRO);
  }

  function escribirFormulario() {
    const r = estado.respuestas;
    $$('input[name="rol"]').forEach((i) => { i.checked = i.value === r.rol; });
    $$('input[name="nivel_conocimiento"]').forEach((i) => { i.checked = Number(i.value) === r.nivel_conocimiento; });
    $$('input[name="temas"]').forEach((i) => { i.checked = r.temas.includes(i.value); });
    taPregunta.value = r.pregunta_experto;
    taOtro.value = r.otro_tema;
    actualizarContadores();
  }

  function actualizarContadores() {
    const n = taPregunta.value.length;
    $("#cuenta-principal").textContent = n;
    const c = $("#contador-principal");
    c.classList.toggle("cerca", n >= MAX_PREGUNTA * 0.9 && n < MAX_PREGUNTA);
    c.classList.toggle("limite", n >= MAX_PREGUNTA);
    $("#cuenta-otro").textContent = taOtro.value.length;
    $("#contador-otro").classList.toggle("limite", taOtro.value.length >= MAX_OTRO);
  }

  function actualizarUI() {
    const n = estado.paso;
    const valido = pasoValido(n);
    const ultimo = n === TOTAL_PASOS;

    btnAtras.classList.toggle("invisible", n === 1);
    btnAtras.disabled = n === 1 || estado.enviando;
    btnSiguiente.hidden = ultimo;
    btnSiguiente.disabled = !valido;
    btnEnviar.hidden = !ultimo;
    btnEnviar.disabled = estado.enviando || !todosValidos();

    pista.textContent = valido || ultimo ? "" : (MENSAJES_REQUERIDOS[n] || "");

    const completados = (n - 1) + (valido && n !== TOTAL_PASOS ? 1 : 0) + (ultimo ? 1 : 0);
    const pct = Math.round((Math.min(completados, TOTAL_PASOS) / TOTAL_PASOS) * 100);
    $("#progreso-etiqueta").textContent = "Pregunta " + n + " de " + TOTAL_PASOS;
    $("#progreso-porcentaje").textContent = pct + "%";
    $("#progreso-relleno").style.width = pct + "%";
    $("#progreso-barra").setAttribute("aria-valuenow", String(pct));
  }

  function todosValidos() {
    for (let i = 1; i <= TOTAL_PASOS; i++) if (!pasoValido(i)) return false;
    return true;
  }

  function guardarBorrador() {
    escribirLS(BORRADOR_KEY, { paso: estado.paso, respuestas: estado.respuestas, envioId: estado.envioId, guardado: Date.now() });
  }

  function hayBorrador(b) {
    if (!b || !b.respuestas) return false;
    const r = b.respuestas;
    return !!(r.rol || r.nivel_conocimiento || (r.temas && r.temas.length) || (r.pregunta_experto || "").trim() || (r.otro_tema || "").trim());
  }

  function irAPaso(n, direccion) {
    n = Math.max(1, Math.min(TOTAL_PASOS, n));
    estado.paso = n;
    pasos.forEach((p) => {
      const activo = Number(p.dataset.paso) === n;
      p.hidden = !activo;
      p.classList.remove("entrando-adelante", "entrando-atras");
      if (activo && direccion) {
        void p.offsetWidth; // reinicia la animación
        p.classList.add(direccion === "atras" ? "entrando-atras" : "entrando-adelante");
      }
    });
    errorEnvio.hidden = true;
    actualizarUI();
    guardarBorrador();
    enfocarPaso(n);
  }

  function enfocarPaso(n) {
    const paso = pasos[n - 1];
    // En móvil no se abre el teclado automáticamente salvo en la pregunta principal.
    requestAnimationFrame(() => {
      const objetivo = paso.querySelector("textarea") ||
        paso.querySelector("input:checked") || paso.querySelector("input");
      if (!objetivo) return;
      const esTexto = objetivo.tagName === "TEXTAREA";
      const pantallaTactil = window.matchMedia("(hover: none)").matches;
      if (esTexto && pantallaTactil && n !== 4) return;
      objetivo.focus({ preventScroll: true });
    });
    const barra = $(".barra-encuesta");
    if (barra && window.scrollY > barra.offsetTop) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function siguiente() {
    leerFormulario();
    if (!pasoValido(estado.paso)) {
      actualizarUI();
      pasos[estado.paso - 1].animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
        { duration: 260, easing: "ease-out" }
      );
      return;
    }
    if (estado.paso < TOTAL_PASOS) irAPaso(estado.paso + 1, "adelante");
  }
  function atras() {
    if (estado.paso > 1 && !estado.enviando) irAPaso(estado.paso - 1, "atras");
  }

  form.addEventListener("input", () => {
    leerFormulario();
    actualizarContadores();
    actualizarUI();
    guardarBorrador();
  });
  form.addEventListener("change", () => {
    leerFormulario();
    actualizarUI();
    guardarBorrador();
  });
  btnSiguiente.addEventListener("click", siguiente);
  btnAtras.addEventListener("click", atras);

  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || estado.enviando) return;
    const t = e.target;
    if (t.tagName === "TEXTAREA") {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (estado.paso === TOTAL_PASOS) form.requestSubmit(); else siguiente();
      }
      return;
    }
    if (t.tagName === "INPUT") {
      e.preventDefault();
      if (t.type === "checkbox") { t.checked = !t.checked; t.dispatchEvent(new Event("change", { bubbles: true })); return; }
      if (estado.paso === TOTAL_PASOS) form.requestSubmit(); else siguiente();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (estado.enviando) return; // evita doble envío
    leerFormulario();
    if (!todosValidos()) {
      const primero = [1, 2, 3, 4].find((n) => !pasoValido(n));
      if (primero) irAPaso(primero, "atras");
      return;
    }

    const r = estado.respuestas;
    const registro = {
      id: estado.envioId,
      timestamp: new Date().toISOString(),
      rol: r.rol,
      nivel_conocimiento: r.nivel_conocimiento,
      temas: TEMAS.filter((t) => r.temas.includes(t)),
      pregunta_experto: r.pregunta_experto.trim().slice(0, MAX_PREGUNTA),
      otro_tema: r.otro_tema.trim().slice(0, MAX_OTRO),
    };

    estado.enviando = true;
    errorEnvio.hidden = true;
    btnEnviar.classList.add("cargando");
    btnEnviar.querySelector(".btn-etiqueta").textContent = "Enviando…";
    actualizarUI();

    try {
      await conTiempoLimite(Almacen.guardar(registro), TIEMPO_LIMITE_MS);
      escribirLS(BORRADOR_KEY, null);
      mostrarConfirmacion(registro.pregunta_experto);
      reiniciarEncuesta();
    } catch (err) {
      errorEnvio.textContent = mensajeError(err);
      errorEnvio.hidden = false;
    } finally {
      estado.enviando = false;
      btnEnviar.classList.remove("cargando");
      btnEnviar.querySelector(".btn-etiqueta").textContent = "Enviar respuesta";
      actualizarUI();
    }
  });

  function mensajeError(err) {
    const c = err && err.codigo;
    if (c === "tiempo") return "El envío está tardando demasiado. Revisa tu conexión e inténtalo de nuevo; tus respuestas siguen aquí.";
    if (c === "sin_sesion") return "Para enviar tu respuesta desde esta página necesitas iniciar sesión.";
    if (c === "sin_permiso") return "Esta página no permite enviar respuestas con tu cuenta. Pide el enlace público de la encuesta.";
    if (!navigator.onLine) return "No hay conexión a internet. Tus respuestas siguen aquí; vuelve a intentarlo cuando tengas conexión.";
    return "No pudimos guardar tu respuesta. Inténtalo de nuevo en un momento; tus respuestas siguen aquí.";
  }

  function reiniciarEncuesta() {
    estado.respuestas = { rol: "", nivel_conocimiento: 0, temas: [], pregunta_experto: "", otro_tema: "" };
    estado.envioId = nuevoId();
    estado.paso = 1;
    escribirFormulario();
  }

  function mostrarConfirmacion(pregunta) {
    $("#cita-texto").textContent = pregunta;
    $("#cita-enviada").hidden = !pregunta;
    mostrarVista("confirmacion");
    requestAnimationFrame(() => $("#titulo-gracias").focus({ preventScroll: true }));
  }

  function iniciarEncuesta(continuar) {
    if (!continuar) {
      reiniciarEncuesta();
      escribirLS(BORRADOR_KEY, null);
    }
    mostrarVista("encuesta");
    irAPaso(estado.paso, "adelante");
  }

  function irAPortada() {
    const b = leerLS(BORRADOR_KEY);
    const conBorrador = hayBorrador(b);
    if (conBorrador) {
      estado.respuestas = Object.assign({ rol: "", nivel_conocimiento: 0, temas: [], pregunta_experto: "", otro_tema: "" }, b.respuestas);
      estado.paso = Math.max(1, Math.min(TOTAL_PASOS, Number(b.paso) || 1));
      if (b.envioId) estado.envioId = b.envioId;
      escribirFormulario();
    }
    $("#btn-continuar").hidden = !conBorrador;
    $("#btn-comenzar").firstChild.textContent = conBorrador ? "Empezar de nuevo " : "Comenzar encuesta ";
    $("#btn-comenzar").classList.toggle("btn-primario", !conBorrador);
    $("#btn-comenzar").classList.toggle("btn-texto", conBorrador);
    $("#btn-continuar").classList.toggle("btn-primario", conBorrador);
    $("#btn-continuar").classList.toggle("btn-texto", !conBorrador);
    if (conBorrador) $(".portada-acciones").prepend($("#btn-continuar"));
    else $(".portada-acciones").prepend($("#btn-comenzar"));
    mostrarVista("portada");
  }

  $("#btn-comenzar").addEventListener("click", () => iniciarEncuesta(false));
  $("#btn-continuar").addEventListener("click", () => iniciarEncuesta(true));
  $("#btn-marca").addEventListener("click", irAPortada);
  $("#btn-inicio").addEventListener("click", () => {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    irAPortada();
  });

  /* ================= Panel de administrador ================= */
  let datos = [];
  let cargandoAdmin = false;

  function salirAdmin() {
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname + location.search);
    irAPortada();
  }
  $("#btn-salir-admin").addEventListener("click", salirAdmin);
  $("#btn-cancelar-acceso").addEventListener("click", salirAdmin);
  $("#enlace-admin").addEventListener("click", (e) => {
    e.preventDefault();
    if (location.hash !== "#admin") location.hash = "admin"; else abrirAdmin();
  });

  function adminSeccion(cual) {
    $("#admin-acceso").hidden = cual !== "acceso";
    $("#admin-contenido").hidden = cual !== "contenido";
    $("#admin-cargando").hidden = cual !== "cargando";
    $(".admin-acciones").hidden = cual === "acceso";
  }

  async function abrirAdmin() {
    mostrarVista("admin");
    adminSeccion("cargando");
    const modo = await Almacen.modo();
    const acceso = await Almacen.accesoAdmin();
    $("#aviso-demo").hidden = modo !== "local";
    $("#admin-estado").textContent = {
      sheets: "Conectado a Google Sheets",
      claude: "Conectado a la base de datos del Artifact",
      local: "Modo demostración (solo este navegador)",
      sinAcceso: "Sin acceso a la base de datos",
    }[modo];

    if (!acceso.permitido) {
      $("#acceso-texto").textContent = "Solo la persona responsable de la encuesta puede consultar las respuestas. Abre esta página con la cuenta propietaria.";
      $("#campo-clave").hidden = true;
      $("#btn-entrar").hidden = true;
      $("#error-acceso").hidden = true;
      adminSeccion("acceso");
      return;
    }
    $("#campo-clave").hidden = false;
    $("#btn-entrar").hidden = false;
    if (acceso.requiereClave && !leerLS(CLAVE_KEY, sessionStorage)) {
      adminSeccion("acceso");
      $("#clave-admin").focus();
      return;
    }
    await cargarDatos();
  }

  $("#form-acceso").addEventListener("submit", async (e) => {
    e.preventDefault();
    const clave = $("#clave-admin").value.trim();
    if (!clave) return;
    const btn = $("#btn-entrar");
    btn.classList.add("cargando");
    $("#error-acceso").hidden = true;
    try {
      datos = await conTiempoLimite(Almacen.listar({ clave }), TIEMPO_LIMITE_MS);
      escribirLS(CLAVE_KEY, clave, sessionStorage);
      $("#clave-admin").value = "";
      adminSeccion("contenido");
      renderAdmin();
    } catch (err) {
      $("#error-acceso").textContent = err && err.codigo === "clave"
        ? "La clave no es correcta."
        : "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";
      $("#error-acceso").hidden = false;
    } finally {
      btn.classList.remove("cargando");
    }
  });

  async function cargarDatos() {
    if (cargandoAdmin) return;
    cargandoAdmin = true;
    const btn = $("#btn-actualizar");
    btn.disabled = true;
    if ($("#admin-contenido").hidden) adminSeccion("cargando");
    try {
      datos = await conTiempoLimite(Almacen.listar({ clave: leerLS(CLAVE_KEY, sessionStorage) }), TIEMPO_LIMITE_MS);
      adminSeccion("contenido");
      renderAdmin();
    } catch (err) {
      if (err && err.codigo === "clave") {
        escribirLS(CLAVE_KEY, null, sessionStorage);
        adminSeccion("acceso");
        $("#error-acceso").textContent = "La clave guardada ya no es válida. Escríbela de nuevo.";
        $("#error-acceso").hidden = false;
      } else {
        adminSeccion("contenido");
        renderAdmin();
        toast("No se pudieron cargar las respuestas. Inténtalo de nuevo.");
      }
    } finally {
      cargandoAdmin = false;
      btn.disabled = false;
    }
  }
  $("#btn-actualizar").addEventListener("click", async () => {
    await cargarDatos();
    if (!$("#admin-contenido").hidden) toast("Respuestas actualizadas");
  });

  function contar(lista, clave) {
    const m = new Map();
    lista.forEach((r) => {
      const v = r[clave];
      (Array.isArray(v) ? v : [v]).forEach((x) => { if (x) m.set(x, (m.get(x) || 0) + 1); });
    });
    return m;
  }

  function renderBarras(contenedor, orden, conteos, total) {
    contenedor.textContent = "";
    if (!total) {
      const p = document.createElement("p");
      p.className = "panel-nota";
      p.textContent = "Aún no hay respuestas.";
      contenedor.appendChild(p);
      return;
    }
    const filas = orden.map((nombre) => ({ nombre, n: conteos.get(nombre) || 0 }))
      .sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...filas.map((f) => f.n));
    filas.forEach((f, i) => {
      const pct = Math.round((f.n / total) * 100);
      const fila = document.createElement("div");
      fila.className = "barra" + (i === 0 && f.n > 0 ? " top" : "");
      fila.innerHTML = '<span class="barra-nombre"></span><span class="barra-valor"><strong></strong> · <span></span></span><div class="barra-pista"><div class="barra-relleno"></div></div>';
      fila.querySelector(".barra-nombre").textContent = f.nombre;
      fila.querySelector(".barra-valor strong").textContent = pct + "%";
      fila.querySelector(".barra-valor span").textContent = f.n === 1 ? "1 respuesta" : f.n + " respuestas";
      contenedor.appendChild(fila);
      const relleno = fila.querySelector(".barra-relleno");
      requestAnimationFrame(() => { relleno.style.width = (f.n / max) * 100 + "%"; });
    });
  }

  function renderNivel(lista) {
    const c = $("#grafica-nivel");
    c.textContent = "";
    const cuentas = [1, 2, 3, 4, 5].map((n) => lista.filter((r) => r.nivel_conocimiento === n).length);
    const max = Math.max(1, ...cuentas);
    const validos = lista.filter((r) => r.nivel_conocimiento >= 1);
    const prom = validos.length ? validos.reduce((s, r) => s + r.nivel_conocimiento, 0) / validos.length : null;
    $("#nivel-resumen").textContent = prom == null
      ? "Aún no hay respuestas."
      : "Promedio " + prom.toFixed(1) + " de 5 · 1 = muy poco, 5 = mucho";
    cuentas.forEach((n, i) => {
      const col = document.createElement("div");
      col.className = "columna" + (n === max && n > 0 ? " max" : "");
      col.innerHTML = '<span class="columna-valor"></span><div class="columna-barra"></div><span class="columna-eje"></span>';
      col.querySelector(".columna-valor").textContent = n;
      col.querySelector(".columna-eje").textContent = i + 1;
      col.setAttribute("aria-label", "Nivel " + (i + 1) + ": " + n + " respuestas");
      c.appendChild(col);
      const barra = col.querySelector(".columna-barra");
      barra.style.height = "0%";
      requestAnimationFrame(() => { barra.style.height = (n / max) * 72 + "%"; });
    });
    return prom;
  }

  function llenarSelect(sel, opciones, etiquetaTodos) {
    const actual = sel.value;
    sel.textContent = "";
    const todos = document.createElement("option");
    todos.value = "";
    todos.textContent = etiquetaTodos;
    sel.appendChild(todos);
    opciones.forEach((o) => {
      const op = document.createElement("option");
      op.value = o;
      op.textContent = o;
      sel.appendChild(op);
    });
    sel.value = opciones.includes(actual) ? actual : "";
  }

  function renderAdmin() {
    const total = datos.length;
    const conPregunta = datos.filter((r) => r.pregunta_experto.trim()).length;
    $("#kpi-total").textContent = total.toLocaleString("es-MX");
    $("#kpi-preguntas").textContent = conPregunta.toLocaleString("es-MX");
    const prom = renderNivel(datos);
    $("#kpi-nivel").textContent = prom == null ? "–" : prom.toFixed(1);
    const ultima = datos.reduce((m, r) => (r.timestamp > m ? r.timestamp : m), "");
    $("#kpi-ultima").textContent = ultima ? fechaLegible(ultima) : "–";
    $("#csv-detalle").textContent = total === 1 ? "1 respuesta" : total + " respuestas";
    $("#btn-csv").disabled = total === 0;

    renderBarras($("#grafica-temas"), TEMAS, contar(datos, "temas"), total);
    renderBarras($("#grafica-roles"), ROLES, contar(datos, "rol"), total);

    const rolesExtra = Array.from(new Set(datos.map((r) => r.rol))).filter((r) => r && !ROLES.includes(r));
    llenarSelect($("#filtro-rol"), ROLES.concat(rolesExtra), "Todos los roles");
    llenarSelect($("#filtro-tema"), TEMAS, "Todos los temas");
    renderTabla();
  }

  function resaltar(el, texto, termino) {
    el.textContent = "";
    if (!termino) { el.textContent = texto; return; }
    const base = normalizarBusqueda(texto);
    let i = 0;
    let pos = base.indexOf(termino);
    while (pos !== -1) {
      if (pos > i) el.appendChild(document.createTextNode(texto.slice(i, pos)));
      const m = document.createElement("mark");
      m.textContent = texto.slice(pos, pos + termino.length);
      el.appendChild(m);
      i = pos + termino.length;
      pos = base.indexOf(termino, i);
    }
    if (i < texto.length) el.appendChild(document.createTextNode(texto.slice(i)));
  }

  function renderTabla() {
    const termino = normalizarBusqueda($("#filtro-texto").value.trim());
    const rol = $("#filtro-rol").value;
    const tema = $("#filtro-tema").value;
    const filas = datos
      .filter((r) => !rol || r.rol === rol)
      .filter((r) => !tema || r.temas.includes(tema))
      .filter((r) => !termino ||
        normalizarBusqueda(r.pregunta_experto).includes(termino) ||
        normalizarBusqueda(r.otro_tema).includes(termino))
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    const cuerpo = $("#tabla-cuerpo");
    cuerpo.textContent = "";
    const frag = document.createDocumentFragment();
    filas.forEach((r) => {
      const tr = document.createElement("tr");
      const celda = (clase, etiqueta) => {
        const td = document.createElement("td");
        td.className = clase;
        td.dataset.etiqueta = etiqueta;
        tr.appendChild(td);
        return td;
      };
      celda("td-fecha", "Fecha").textContent = fechaLegible(r.timestamp);
      celda("td-rol", "Rol").textContent = r.rol || "—";
      celda("td-nivel", "Conocimiento").textContent = r.nivel_conocimiento ? r.nivel_conocimiento + " / 5" : "—";
      celda("td-temas", "Temas").textContent = r.temas.join(", ") || "—";
      resaltar(celda("td-pregunta", "Pregunta"), r.pregunta_experto, termino);
      const tdOtro = celda("td-otro", "Otro tema");
      if (r.otro_tema) resaltar(tdOtro, r.otro_tema, termino);
      else { tdOtro.textContent = "—"; tdOtro.classList.add("vacia"); }
      frag.appendChild(tr);
    });
    cuerpo.appendChild(frag);

    const filtrando = termino || rol || tema;
    $("#conteo-filtro").textContent = filtrando
      ? "Mostrando " + filas.length + " de " + datos.length
      : datos.length + (datos.length === 1 ? " respuesta" : " respuestas");
    const vacio = $("#tabla-vacia");
    vacio.hidden = filas.length > 0;
    $("#tabla").hidden = filas.length === 0;
    vacio.textContent = datos.length === 0
      ? "Todavía no hay respuestas. Comparte el enlace de la encuesta para empezar a recibir preguntas."
      : "Ninguna respuesta coincide con la búsqueda o los filtros.";
  }

  let busquedaTimer = null;
  $("#filtro-texto").addEventListener("input", () => {
    clearTimeout(busquedaTimer);
    busquedaTimer = setTimeout(renderTabla, 120);
  });
  $("#filtro-rol").addEventListener("change", renderTabla);
  $("#filtro-tema").addEventListener("change", renderTabla);

  /* ================= CSV ================= */
  function celdaCSV(valor) {
    let s = valor == null ? "" : String(valor);
    // Evita que Excel interprete el texto como fórmula (inyección CSV).
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    s = s.replace(/\r\n?/g, "\n");
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function generarCSV(lista) {
    const columnas = ["timestamp", "rol", "nivel_conocimiento", "temas", "pregunta_experto", "otro_tema"];
    const filas = lista
      .slice()
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
      .map((r) => [
        fechaCSV(r.timestamp),
        r.rol,
        r.nivel_conocimiento || "",
        r.temas.join("; "),
        r.pregunta_experto,
        r.otro_tema,
      ].map(celdaCSV).join(","));
    return "﻿" + [columnas.join(",")].concat(filas).join("\r\n") + "\r\n";
  }
  window.__generarCSV = generarCSV; // usado por las pruebas automáticas

  $("#btn-csv").addEventListener("click", async () => {
    const btn = $("#btn-csv");
    if (btn.classList.contains("cargando")) return;
    btn.classList.add("cargando");
    const estadoCsv = $("#csv-estado");
    estadoCsv.textContent = "";
    try {
      await Almacen.descargar(CSV_FILENAME, generarCSV(datos), "text/csv;charset=utf-8");
      estadoCsv.textContent = "Se generó " + CSV_FILENAME + " con " + datos.length + (datos.length === 1 ? " respuesta." : " respuestas.");
    } catch (err) {
      estadoCsv.textContent = err && err.code === "declined"
        ? "Descarga cancelada."
        : "No se pudo descargar el archivo. Inténtalo de nuevo.";
    } finally {
      btn.classList.remove("cargando");
    }
  });

  /* ================= Inicio ================= */
  escribirFormulario();
  enrutar();
  // Precarga el modo de almacenamiento para que el envío sea inmediato.
  Almacen.modo();
})();
