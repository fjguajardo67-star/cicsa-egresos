#!/usr/bin/env node
/**
 * CICSA — pruebas de la lógica financiera del frontend.
 *
 * index.html es un archivo único sin módulos, así que estas pruebas extraen las
 * funciones REALES del <script> por nombre (brace-matching) y las evalúan en un
 * sandbox con los globals mínimos. Así siempre se prueba el código vigente, sin
 * copias que se desactualicen.
 *
 * Correr:  node tests/run_js_tests.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function extractFunction(name) {
  const decl = "function " + name + "(";
  // Primero la forma async: buscar solo "function nombre(" encontraría esa misma posición dentro
  // de "async function nombre(" y recortaría el async, dejando un cuerpo con await inválido.
  let i = script.indexOf("async " + decl);
  if (i === -1) i = script.indexOf(decl);
  if (i === -1) throw new Error("No encontré la función: " + name);
  const bodyStart = script.indexOf("{", i);
  let depth = 0, inStr = null, inComment = null;
  for (let j = bodyStart; j < script.length; j++) {
    const c = script[j], p = script[j - 1];
    if (inComment === "//") { if (c === "\n") inComment = null; continue; }
    if (inComment === "/*") { if (p === "*" && c === "/") inComment = null; continue; }
    if (inStr) {
      // Contar las diagonales invertidas: "\\\\" termina en una comilla NO escapada, porque la
      // barra que la precede está a su vez escapada. El chequeo simple p !== "\\" se equivocaba
      // ahí y el extractor se salía de la función (escAttrJs lo destapó).
      if (c === inStr) {
        let bs = 0, k = j - 1;
        while (k >= 0 && script[k] === "\\") { bs++; k--; }
        if (bs % 2 === 0) inStr = null;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "/" && script[j + 1] === "/") { inComment = "//"; continue; }
    if (c === "/" && script[j + 1] === "*") { inComment = "/*"; continue; }
    // Literales de expresión regular. Sin esto, el /'/g de .replace(/'/g,"…") se leía como el
    // inicio de una cadena y el extractor se iba hasta el final del archivo. Para distinguir la
    // regex de una división se mira el carácter significativo anterior: después de ( , = : [ ! & |
    // ? { } ; o return, un / solo puede empezar una regex.
    if (c === "/") {
      let k = j - 1;
      while (k >= 0 && /\s/.test(script[k])) k--;
      const anterior = k >= 0 ? script[k] : "(";
      if ("(,=:[!&|?{};+-*%~^".includes(anterior) || /\breturn$/.test(script.slice(Math.max(0, k - 6), k + 1))) {
        let m = j + 1, enClase = false;
        for (; m < script.length; m++) {
          const d = script[m];
          if (d === "\\") { m++; continue; }        // \/ y \] no cuentan
          if (d === "[") enClase = true;
          else if (d === "]") enClase = false;
          else if (d === "/" && !enClase) break;
          else if (d === "\n") break;               // una regex no cruza renglones: era división
        }
        j = m;
        continue;
      }
    }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return script.slice(i, j + 1); }
  }
  throw new Error("Llaves desbalanceadas en: " + name);
}

// Constantes de nivel superior que las funciones extraídas necesitan (CATS es la lista de
// categorías de fábrica sobre la que trabaja catsActuales).
function extractConst(name) {
  // Arrays (pueden abarcar varias lineas) y escalares (const X = 50;). Se EXTRAEN, nunca se
  // copian: una copia se queda vieja y la prueba acaba comparando el valor contra si mismo.
  const arr = script.match(new RegExp("const\\s+" + name + "\\s*=\\s*\\[[\\s\\S]*?\\];"));
  if (arr) return arr[0];
  const esc = script.match(new RegExp("const\\s+" + name + "\\s*=\\s*[^;\\n]+;"));
  if (esc) return esc[0];
  throw new Error("No encontré la constante: " + name);
}
// Se EXTRAEN de index.html, nunca se copian aquí: una copia se queda vieja y la prueba pasa
// comparando el valor contra sí misma. Pasó con CORTES_VERSIONES_OK — index.html decía [1,2],
// el harness también, y el archivo v3 que la app de cortes exporta hoy se rechazaba sin que
// ninguna prueba lo notara.
const CONSTS = ["CATS", "CORTES_VERSIONES_OK", "_FALLOS_MAX", "ADMIN_UID", "FIRESTORE_TOPE_DOC", "_COBERTURA_MAX_DIAS"];
const CONSTS_OBJ = ["ORIGEN_ETIQUETA", "PERMISOS_DETALLE"];
const CONSTS_ARR = ["COLS_DETALLE_GASTOS"];


const FUNCS = [
  "normalizarParaComparar", "posibleMismoIngrediente", "esGastoEfectivo",
  "montoEfectivoGasto", "difImporteCaja", "_yaVinculadoAOtroFolio",
  "permisosDetalle", "claveFormaPago", "filtrarGastosPanel", "totalesPorFormaPago", "folioDuplicado",
  "filasDetalleGastos", "gastosRepetidosPorId",
  "mapaUuidAFolio", "_folioIdentidad", "facturaEnteraYSusPartes",
  "basePresupuestoPeriodo",
  "parsearFaltantesCsv", "_esPalabraCompleta", "riesgoAlias", "candidatosAlias",
  "planAlias", "resumenPlanAlias", "conSinonimoAgregado",
  "formaPagoLabel", "partidasExpandidas", "contenidoTotalGramos",
  "precioPorUnidadBase", "diaSemanaLabel", "fechaLocalStr", "todayStr", "diasRestantes",
  "allGastosAllWeeks", "_cortesCrudos", "esCorteContable", "todosLosCortes", "todosLosCortesNoContables", "todosLosRetiros", "todasLasAportaciones",
  "findDuplicate", "calcularSaldoAntesDe", "calcularSaldoCajaPeriodo",
  "conciliarSAT", "dedupeProductos", "rangoSemanaLabel", "aliasSospechosos",
  "fmt", "duplicadosSospechosos", "separarNombresMenu", "construirMapaPreciosMenu", "migrarCategorias", "consolidarFacturaDividida",
  "variantesLlaveMenu", "llavesMenuDeFila",
  "_desescaparXml", "unidadDesdeClaveSAT", "_cfdiConceptos", "_cfdiNomina", "corridasDeNomina", "corridaNominaRegistrada", "preciosDesdeCfdis", "resolverPreciosCatalogo",
  "planIdentificacion", "_identSugerida", "_indiceNombresCatalogo", "decidirDestinoIdent",
  "resumenGmail", "_firmaEstado", "textoSync", "avisoGastoFueraDeVista", "resolverPeriodoSP",
  "cortesManualesSospechosos", "egresosExcluidos", "folioDeIgnorado", "_unirIgnorados",
  "puedeEntrar", "_bytesUtf8", "medirEstado", "contarMovimientos", "hayQueSubir",
  "datosDeCaptura",
  "todosLosCortesNoContables",
  "registrarFallo", "resumenFallos", "pistaFallo", "_anotarFallo", "fbUpdateDoc", "fbDeleteDoc",
  "origenDeMovimiento", "etiquetaOrigen", "desglosarPorOrigen", "construirImportacionCortes",
  "gastosConFechaDudosa", "_fechaCorreoISO", "gastosQueSonComplemento", "bloqueoComplementoPago", "gastosConImporteDistinto",
  "_dupFolioCanon", "_dupFoliosEquivalentes", "_folioDeCfdi", "_dupNormProv", "_dupProvParecidos",
  "clasificarDiferenciaSAT", "folioCapturableCfdi",
  "_unionPorId", "mergeEstados", "_cfdiAttr", "parseCFDIXML",
  "cfdiMes", "filtrarCfdisPorRango", "agruparCfdisPorMes",
  "_cfdiTipoDesdeTexto", "filtrarCfdisConciliables", "autodetectarRfcPropio",
  "rfcPropio", "guardarRfcPropio",
  "_gmailHuella", "filterGmailDuplicates",
  "catsActuales", "_catsEditable", "_catExiste", "renombrarCategoriaEnEstado",
  "factorPresupuestoPeriodo", "presupCatPeriodo",
  "fechaCorteDatos", "filtrarPorCorte", "contarAntesDelCorte",
  "divididasDescuadradas", "prorratearPartidas",
  "canonizarCategoria", "canonizarProveedor", "_categoriasEnUso", "variantesDeCategoria",
  "_normCat", "_limpiarNombreCat",
  "balanceOperativo", "ingresosDetalle",
  "fetchStorage", "esImagenRespaldo",
  "gastosFiltradosReporte",
  "resumenEstado", "_estadoValido", "podarRespaldos",
  "esc", "escAttrJs",
  "_esFechaISO", "_esNum", "validarArchivoCortes", "avisosControlCortes",
  "foliosCorteImportados", "foliosEgresoImportados", "foliosCorteIgnorados", "foliosAportacionImportadas", "clasificacionInicialEgreso",
  "_sumarDiaISO", "manifiestoDeImportacion", "_claveManifiesto", "agregarManifiesto", "_unirManifiestos",
  "coberturaDePeriodos", "validarCadenaPeriodos", "rupturasDeCadena",
  "totalesDeclarados", "estadoConciliacionCaja",
  "_pareceFolioFactura", "gastoMismoImporte",
  "findDuplicate",
  "totalesPorCatPeriodo", "gastosDelPeriodoSP", "getPeriodoSP", "getPeriodoSPRaw", "getActiveWeek",
];

const sandbox = {
  state: { weeks: [], activeWeek: null, budget: {} }, console,
  _gmailRevisados: null,
  // Stubs para consolidarFacturaDividida (efectos de UI/persistencia fuera de alcance del test).
  confirm: () => true, alert: () => {}, save: () => {}, marcarBorrado: () => {},
  renderRevisionDuplicados: () => {},
  // Los campos del formulario de Auditoría se simulan con un mapa: null cuando el id no está,
  // igual que un DOM donde ese elemento no existe.
  __dom: {},
  document: { getElementById: (id) => (id in sandbox.__dom ? { value: sandbox.__dom[id] } : null) },
  localStorage: (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })(),
  // fetchStorage habla con Firebase Storage: se le pone una sesión y un fetch de mentira.
  auth: { currentUser: { getIdToken: async () => "TOKEN" } },
  FB_BASE: "https://firestore/x", FB_KEY: "K",
  fbSet: async () => {},
  // fbDeleteDoc ya NO se stubea: se extrae la real desde index.html (esta en FUNCS). El stub
  // le ganaba a la declaracion y devolvia undefined, con lo que la prueba del 403 no probaba nada.
  // Con el fetch stubeado (ok:true) la real es igual de inofensiva para el resto de pruebas.
  fetch: async () => ({ ok: true, status: 200 }),
};
vm.createContext(sandbox);
for (const c of CONSTS) vm.runInContext(extractConst(c), sandbox);
// Constantes objeto (const X = { ... };) — mismo principio: se extraen, no se copian.
for (const c of (typeof CONSTS_ARR !== "undefined" ? CONSTS_ARR : [])) {
  vm.runInContext(extractConst(c), sandbox);
  sandbox[c] = vm.runInContext(c, sandbox);
}
for (const c of CONSTS_OBJ) {
  const m = script.match(new RegExp("const\\s+" + c + "\\s*=\\s*\\{[\\s\\S]*?\\};"));
  if (!m) throw new Error("No encontré la constante objeto: " + c);
  vm.runInContext(m[0], sandbox);
}
vm.runInContext("const TOL_DIVIDIDA = 0.05;", sandbox);
vm.runInContext('const CORTES_STORAGE_PREFIJO = "cortes";', sandbox);
vm.runInContext("let _storageAuthScheme = null;", sandbox);   // memo del esquema que funcionó
vm.runInContext('const CAT_SIN = "__SIN__";', sandbox);       // centinela de "sin categoría"
vm.runInContext('const RESPALDO_PREFIJO = "respaldo-"; const RESPALDOS_A_CONSERVAR = 30;', sandbox);
vm.runInContext('const RESPALDOS_COL = "respaldos"; const RESPALDO_INDICE = "_indice";', sandbox);
vm.runInContext('var currentRole = "admin";', sandbox);   // var: reasignable desde las pruebas
for (const f of FUNCS) vm.runInContext(extractFunction(f), sandbox);
const S = sandbox;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok - " + name); }
  catch (e) { fail++; console.error("  FAIL - " + name + "\n        " + e.message); }
}
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `esperaba ${b}, salió ${a}`);
// t() es síncrona: si fn devuelve una promesa rechazada, el try/catch no la ve y la corrida se
// cae con un stack en vez de contar un FAIL. Las pruebas asíncronas usan tAsync.
async function tAsync(name, fn) {
  try { await fn(); pass++; console.log("  ok - " + name); }
  catch (e) { fail++; console.error("  FAIL - " + name + "\n        " + e.message); }
}
// El archivo corre de arriba a abajo de forma SINCRONA. Llamar a tAsync directamente devuelve una
// promesa que nadie espera: las pruebas se entremezclan, comparten estado y el resumen se imprime
// antes de que terminen. Se encolan y se corren en fila al final.
const _colaAsync = [];
function tAsyncQ(name, fn) { _colaAsync.push([name, fn]); }

console.log("\n== precioPorUnidadBase / contenidoTotalGramos ==");
t("kg con merma: Rollo de Res $92.90, 1kg, 30% → $132.71/kg", () => {
  const r = S.precioPorUnidadBase({ unidad_base: "kg", unidad_factura: "kg", precio_actual: 92.90, contenido_cantidad: 1, contenido_unidad: "kg", merma_pct: 30 });
  assert.ok(r.ok); close(r.precio, 132.71); assert.equal(r.unidadBase, "kg");
});
t("lt por contenido: Aceite $734.51, 16 lt → $45.91/lt", () => {
  const r = S.precioPorUnidadBase({ unidad_base: "lt", unidad_factura: "pz", precio_actual: 734.51, contenido_cantidad: 16, contenido_unidad: "lt" });
  assert.ok(r.ok); close(r.precio, 45.91);
});
t("lt por piezas×peso (dato legado): 16 × 1000ml → $45.91/lt", () => {
  const r = S.precioPorUnidadBase({ unidad_base: "lt", unidad_factura: "pz", precio_actual: 734.51, piezas_por_presentacion: 16, peso_pieza_valor: 1000, peso_pieza_unidad: "ml" });
  assert.ok(r.ok); close(r.precio, 45.91);
});
t("pz: Catsup $100.90, 204 piezas → $0.49/pz (no exige peso)", () => {
  const r = S.precioPorUnidadBase({ unidad_base: "pz", unidad_factura: "pz", precio_actual: 100.90, piezas_por_presentacion: 204 });
  assert.ok(r.ok); close(r.precio, 0.49); assert.equal(r.unidadBase, "pz");
});
t("pz: Bimbollos $142.20, 18 piezas → $7.90/pz", () => {
  const r = S.precioPorUnidadBase({ unidad_base: "pz", unidad_factura: "pz", precio_actual: 142.20, piezas_por_presentacion: 18 });
  assert.ok(r.ok); close(r.precio, 7.90);
});
t("pz sin piezas pero factura=base → asume 1 pieza", () => {
  const r = S.precioPorUnidadBase({ unidad_base: "pz", unidad_factura: "pz", precio_actual: 50 });
  assert.ok(r.ok); close(r.precio, 50);
});
t("porción: Papa $200, 2.4kg, porción 120g, 5% merma → $10.53", () => {
  const r = S.precioPorUnidadBase({ unidad_base: "porcion", unidad_factura: "pz", precio_actual: 200, contenido_cantidad: 2.4, contenido_unidad: "kg", porcion_valor: 120, porcion_unidad: "g", merma_pct: 5 });
  assert.ok(r.ok); close(r.precio, 10.53);
});
t("la merma SUBE el precio (nunca lo baja)", () => {
  const sin = S.precioPorUnidadBase({ unidad_base: "kg", unidad_factura: "kg", precio_actual: 100, contenido_cantidad: 1, contenido_unidad: "kg" });
  const con = S.precioPorUnidadBase({ unidad_base: "kg", unidad_factura: "kg", precio_actual: 100, contenido_cantidad: 1, contenido_unidad: "kg", merma_pct: 20 });
  assert.ok(con.precio > sin.precio);
});
t("sin precio → excluido, no inventa número", () => {
  assert.equal(S.precioPorUnidadBase({ unidad_base: "kg", contenido_cantidad: 1, contenido_unidad: "kg" }).ok, false);
});
t("merma 100% → excluido", () => {
  assert.equal(S.precioPorUnidadBase({ unidad_base: "kg", unidad_factura: "kg", precio_actual: 100, contenido_cantidad: 1, contenido_unidad: "kg", merma_pct: 100 }).ok, false);
});
t("contenidoTotalGramos: 2.9 kg → 2900 g; misma unidad kg→1000; sin datos → null", () => {
  assert.equal(S.contenidoTotalGramos({ contenido_cantidad: 2.9, contenido_unidad: "kg" }), 2900);
  assert.equal(S.contenidoTotalGramos({ unidad_factura: "kg", unidad_base: "kg" }), 1000);
  assert.equal(S.contenidoTotalGramos({}), null);
});

console.log("\n== clasificación de gastos ==");
t("esGastoEfectivo: efectivo/caja_cortes/formaPagoFinal sí; transferencia no", () => {
  assert.ok(S.esGastoEfectivo({ formaPago: "efectivo" }));
  assert.ok(S.esGastoEfectivo({ formaPago: "caja_cortes" }));
  assert.ok(S.esGastoEfectivo({ formaPago: "credito", formaPagoFinal: "efectivo" }));
  assert.ok(!S.esGastoEfectivo({ formaPago: "transferencia" }));
});
t("formaPagoLabel cubre todas las formas", () => {
  assert.equal(S.formaPagoLabel({ _dividida: true }), "🔀 Dividida");
  assert.ok(S.formaPagoLabel({ formaPago: "efectivo" }).includes("Efectivo"));
  assert.ok(S.formaPagoLabel({ formaPago: "transferencia" }).includes("Transferencia"));
  assert.ok(S.formaPagoLabel({ formaPago: "credito" }).includes("Crédito"));
  assert.equal(S.formaPagoLabel({}), "—");
});
t("partidasExpandidas: divide la dividida, conserva el total, ignora partidas ≤ 0", () => {
  const gastos = [
    { id: "a", importe: 100, categoria: "X" },
    { id: "b", importe: 300, categoria: "Mixta", _dividida: true, _partidas: [
      { categoria: "Cárnicos", importe: 200 }, { categoria: "Hielo", importe: 100 }, { categoria: "Nada", importe: 0 },
    ]},
  ];
  const out = S.partidasExpandidas(gastos);
  assert.equal(out.length, 3);
  close(out.reduce((s, g) => s + g.importe, 0), 400);
  assert.deepEqual(out.filter(g => g.categoria === "Cárnicos").length, 1);
  assert.ok(!out.some(g => g.categoria === "(sin desglosar)"), "si el desglose cuadra, no se inventa resto");
});
t("una factura dividida a la que le falta desglose NO pierde ese dinero", () => {
  // Caso real: el balance daba $2,292,182.34 por categoría contra $2,292,580.69 de salidas.
  // El desglose por proveedor cuadraba, el de categorías no, y el hueco no aparecía en ningún lado.
  const out = S.partidasExpandidas([
    { id: "b", importe: 1000, categoria: "Mixta", _dividida: true, _partidas: [
      { categoria: "Cárnicos", importe: 600 }, { categoria: "Hielo", importe: 1.65 },
    ]},
  ]);
  close(out.reduce((s, g) => s + g.importe, 0), 1000, 0.001);
  const resto = out.find(g => g.categoria === "(sin desglosar)");
  assert.ok(resto, "el resto se muestra, no se esfuma");
  close(resto.importe, 398.35);
});
t("si las partidas suman de MÁS, el sobrante sale negativo en vez de taparse", () => {
  const out = S.partidasExpandidas([
    { id: "c", importe: 100, categoria: "M", _dividida: true, _partidas: [
      { categoria: "A", importe: 80 }, { categoria: "B", importe: 50 },
    ]},
  ]);
  const resto = out.find(g => g.categoria === "(sin desglosar)");
  assert.ok(resto && resto.importe < 0, "un desglose inflado tiene que verse");
  close(out.reduce((s, g) => s + g.importe, 0), 100, 0.001);
});
t("diferencias de centavos por redondeo no ensucian el reporte", () => {
  const out = S.partidasExpandidas([
    { id: "d", importe: 100, categoria: "M", _dividida: true, _partidas: [
      { categoria: "A", importe: 33.33 }, { categoria: "B", importe: 33.33 }, { categoria: "C", importe: 33.34 },
    ]},
  ]);
  assert.ok(!out.some(g => g.categoria === "(sin desglosar)"), "cuadra exacto, sin fila de resto");
});

console.log("\n== saldos de Caja ==");
const semanas = [
  { id: "1", label: "s1", gastos: [{ id: "g1", importe: 100, formaPago: "efectivo", fecha: "2026-06-01" }], cortes: [{ id: "c1", monto: 500, fecha: "2026-06-02" }], retiros: [{ id: "r1", monto: 50, fecha: "2026-06-03" }] },
  { id: "2", label: "s2", gastos: [{ id: "g2", importe: 80, formaPago: "transferencia", fecha: "2026-06-08" }], cortes: [{ id: "c2", monto: 200, fecha: "2026-06-09" }], retiros: [] },
  { id: "3", label: "s3", gastos: [], cortes: [], retiros: [] },
];
t("calcularSaldoAntesDe: corte estricto por fecha (<, no ≤)", () => {
  S.state.weeks = semanas;
  close(S.calcularSaldoAntesDe("2026-06-09").saldo, 500 - 100 - 50); // corte del 09 NO entra
  close(S.calcularSaldoAntesDe("2026-06-10").saldo, 500 - 100 - 50 + 200);
});

console.log("\n== duplicados y conciliación SAT ==");
t("findDuplicate: mismo folio+proveedor; mismo prov+importe+fecha; ±3 días", () => {
  S.state.weeks = [{ id: "1", gastos: [{ id: "g", proveedor: "WALMART", factura: "F123", importe: 500, fecha: "2026-07-01" }] }];
  assert.ok(S.findDuplicate("walmart", 999, "2026-07-20", "F123"));
  assert.ok(S.findDuplicate("WALMART", 500, "2026-07-01", ""));
  assert.ok(S.findDuplicate("WALMART", 500.5, "2026-07-03", ""));
  assert.equal(S.findDuplicate("OTRO", 500, "2026-07-01", ""), null);
});
t("conciliarSAT: clasifica conciliada / faltante / diferencia", () => {
  S.state.weeks = [{ id: "1", gastos: [
    { id: "a", proveedor: "X", factura: "ABCD1234-XXXX", importe: 100, fecha: "2026-07-01" },
    { id: "b", proveedor: "Y", factura: "", importe: 200, fecha: "2026-07-05" },
  ]}];
  const r = S.conciliarSAT([
    { folio: "ABCD1234-YYYY", total: 100, fecha: "2026-07-01" },   // por folio
    { folio: "ZZZZ", total: 200.5, fecha: "2026-07-06" },          // por monto/fecha
    { folio: "QQQQ", total: 9999, fecha: "2026-07-01" },           // faltante
  ], "", "");
  assert.equal(r.conciliadas.length, 2);
  assert.equal(r.faltantes.length, 1);
  assert.equal(r.faltantes[0].folio, "QQQQ");
});
t("posibleMismoIngrediente: contención y traslape; idénticos NO cuentan", () => {
  assert.ok(S.posibleMismoIngrediente("Grano de elote", "Elote"));
  assert.ok(!S.posibleMismoIngrediente("Elote", "elote"));
  assert.ok(!S.posibleMismoIngrediente("Aceite", "Harina"));
});
t("dedupeProductos: mismo nombre+precio se funde; precio distinto se conserva", () => {
  const out = S.dedupeProductos([
    { nombre: "Papa", precio_unitario: 20 }, { nombre: "papa", precio_unitario: 20 }, { nombre: "Papa", precio_unitario: 25 },
  ]);
  assert.equal(out.length, 2);
});

console.log("\n== fechas ==");
t("todayStr usa la fecha LOCAL (no UTC) — regresión del bug de zona horaria", () => {
  assert.ok(!S.todayStr.toString().includes("toISOString"), "todayStr no debe usar toISOString (da la fecha UTC, no la local)");
  const d = new Date();
  const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(S.todayStr(), esperado);
});
t("diaSemanaLabel: 2026-07-15 es Miércoles", () => {
  assert.equal(S.diaSemanaLabel("2026-07-15"), "Miércoles");
});
t("diasRestantes: hoy → 0", () => {
  const d = new Date();
  const hoy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.equal(S.diasRestantes(hoy), 0);
  assert.equal(S.diasRestantes(""), null);
});
t("rangoSemanaLabel: auto-nombre de semana nueva usa el rango real lunes–domingo", () => {
  // Jueves 16 jul 2026 -> semana lunes 13 al domingo 19 jul 2026
  assert.equal(S.rangoSemanaLabel(new Date(2026, 6, 16, 12)), "13 al 19 jul 2026");
  // Domingo cuenta como el ÚLTIMO día de SU semana (no el primero de la siguiente)
  assert.equal(S.rangoSemanaLabel(new Date(2026, 6, 19, 12)), "13 al 19 jul 2026");
  // Lunes es el primer día de una semana nueva
  assert.equal(S.rangoSemanaLabel(new Date(2026, 6, 20, 12)), "20 al 26 jul 2026");
  // Cruce de mes: se muestra el mes en ambos extremos
  assert.equal(S.rangoSemanaLabel(new Date(2026, 6, 30, 12)), "27 jul al 02 ago 2026");
});

console.log("\n== alias sospechosos ==");
t("marca aliases de otro producto (Queso americano bajo Queso crema), respeta legítimos y sinónimos", () => {
  S._catalogoProductos = [
    { id: "1", nombre_comercial: "Queso crema procesado 1.36kg",
      alias_factura: ["Queso crema procesado 1.36kg", "Queso crema BC 1.36kg", "Queso americano", "Queso crema 1.36kg"] },
    { id: "2", nombre_comercial: "Queso panela 3kg", alias_factura: ["Queso panela 3kg", "Queso 3kg"] },
    { id: "3", nombre_comercial: "Alas Naturales", alias_factura: ["Alas Naturales", "Alitas", "Alitas de Pollo"] },
  ];
  const r = S.aliasSospechosos();
  const q = r.find(x => x.id === "1");
  assert.ok(q && q.sospechosos.includes("Queso americano"), "debe marcar 'Queso americano'");
  assert.ok(!q.sospechosos.includes("Queso crema BC 1.36kg"), "no debe marcar alias legítimo con palabras compartidas");
  assert.ok(!r.find(x => x.id === "2"), "queso panela sin sospechosos");
  assert.ok(!r.find(x => x.id === "3"), "sinónimo sin palabra en común (Alitas/Alas) no se marca");
});

t("alias GENÉRICO absorbido (caso real Zanahoria/Papa) sí se marca", () => {
  S._catalogoProductos = [
    { id: "10", nombre_comercial: "Mezcla zanahoria y chícharo congelada",
      alias_factura: ["Mezcla zanahoria y chícharo congelada", "Mezcla California congelada", "Zanahoria y chicharo congelado", "Zanahoria"] },
    { id: "11", nombre_comercial: "Puré de papa instantáneo 2.5kg",
      alias_factura: ["Puré de papa instantáneo 2.5kg", "Papa", "Papaya"] },
    { id: "12", nombre_comercial: "Queso panela 3kg", alias_factura: ["Queso panela 3kg", "Queso 3kg"] },
  ];
  const r = S.aliasSospechosos();
  const m = r.find(x => x.id === "10");
  assert.ok(m && m.sospechosos.includes("Zanahoria"), "'Zanahoria' bajo la mezcla congelada debe marcarse");
  assert.ok(!m.sospechosos.includes("Zanahoria y chicharo congelado"), "la variante multi-palabra es legítima");
  const q = r.find(x => x.id === "11");
  assert.ok(q && q.sospechosos.includes("Papa"), "'Papa' bajo el puré debe marcarse");
  assert.ok(!r.find(x => x.id === "12"), "'Queso 3kg' bajo 'Queso panela 3kg' NO se marca (regresión)");
});

console.log("\n== sincronización a CICSA Menú (reemplaza, no acumula) ==");
t("nombre canónico con comas: conserva el primero y mueve el resto a sinónimos", () => {
  const r = S.separarNombresMenu("Alitas, Alitas IQF, Alitas de Pollo", []);
  assert.equal(r.principal, "Alitas");
  assert.deepEqual(r.sinonimos, ["Alitas IQF", "Alitas de Pollo"]);
  assert.equal(r.movidos, 2);
});
t("nombre histórico con puntos: separa variantes sin romper decimales", () => {
  const r = S.separarNombresMenu("Tortilla Maiz. Tortilla", ["Aderezo ranch 3.8lt"]);
  assert.equal(r.principal, "Tortilla Maiz");
  assert.deepEqual(r.sinonimos, ["Tortilla", "Aderezo ranch 3.8lt"]);
  assert.equal(r.movidos, 1);
});
t("fusiona variantes existentes sin repetir mayúsculas ni acentos", () => {
  const r = S.separarNombresMenu("Orégano seco, oregano seco", ["ORÉGANO SECO", "Orégano mexicano"]);
  assert.equal(r.principal, "Orégano seco");
  assert.deepEqual(r.sinonimos, ["Orégano mexicano"]);
  assert.equal(r.movidos, 1);
});
t("acepta el campo de sinónimos como texto separado por comas", () => {
  const r = S.separarNombresMenu("Tortilla de maíz", "tortillas de maíz, Tortilla");
  assert.deepEqual(r.sinonimos, ["tortillas de maíz", "Tortilla"]);
});
const filaSync = (nombre, precio, fecha, incluir = true, ok = true) => ({
  producto: { fecha_precio: fecha }, nombreSync: nombre, incluir,
  calc: { ok, precio, unidadBase: "kg" },
});
t("los productos que ya no están validados desaparecen del documento", () => {
  // Caso real: el documento traía 37 entradas viejas (01/06) de productos ya borrados.
  const previos = {
    "Papa lisa europea": { precio: 119.90, unidad_base: "pz", fecha: "01/06/2026" },
    "Jamón super pavo loyval": { precio: 80, unidad_base: "kg", fecha: "01/06/2026" },
    "Cebolla": { precio: 20, unidad_base: "kg", fecha: "01/06/2026" },
  };
  const nuevo = S.construirMapaPreciosMenu(
    [filaSync("Papa a la francesa, papa frita", 54.69, "2026-07-28"), filaSync("Cebolla", 22.5, "2026-07-28")],
    previos, "28/07/2026");
  // La coma histórica se corrige en dos nombres útiles; cada uno además ocupa variantes de
  // mayúsculas/acentos, así que se compara el conjunto normalizado, no el número de llaves.
  const distintos = [...new Set(Object.keys(nuevo).map(S.normalizarParaComparar))].sort();
  assert.deepEqual(distintos, ["cebolla", "papa a la francesa", "papa frita"]);
  assert.ok(!("Papa lisa europea" in nuevo), "el producto borrado ya no cotiza en Menú");
  assert.ok(!("Jamón super pavo loyval" in nuevo), "el duplicado mal escrito se va");
  close(nuevo["Cebolla"].precio, 22.5);
  assert.equal(nuevo["Cebolla"].fecha, "28/07/2026", "el que sí sigue validado se actualiza");
});
t("destildar una fila CONSERVA su precio anterior (no lo borra de Menú)", () => {
  const previos = { "Cebolla": { precio: 20, unidad_base: "kg", fecha: "01/06/2026" } };
  const nuevo = S.construirMapaPreciosMenu([filaSync("Cebolla", 99, "2026-07-28", false)], previos, "28/07/2026");
  assert.deepEqual(nuevo["Cebolla"], previos["Cebolla"], "queda intacto: ni se actualiza ni se pierde");
});
t("fila excluida que nunca estuvo en Menú no se inventa", () => {
  const nuevo = S.construirMapaPreciosMenu([filaSync("Nuevo", 10, "2026-07-28", false)], {}, "28/07/2026");
  assert.deepEqual(nuevo, {});
});
t("productos que no se pueden costear (calc.ok=false) no entran", () => {
  const nuevo = S.construirMapaPreciosMenu([filaSync("Sin unidad", 0, "2026-07-28", true, false)], {}, "28/07/2026");
  assert.deepEqual(nuevo, {});
});
t("mismo nombre en dos filas: gana la factura más reciente", () => {
  const nuevo = S.construirMapaPreciosMenu(
    [filaSync("Elote", 30, "2026-07-28"), filaSync("Elote", 10, "2026-06-01")], {}, "28/07/2026");
  assert.equal(Object.keys(nuevo).length, 2, "'Elote' y 'elote': una llave por variante");
  close(nuevo["Elote"].precio, 30);
  close(nuevo["elote"].precio, 30);   // la variante trae el mismo precio, no el viejo
});

console.log("\n== llaves de Menú: mayúsculas, acentos y sinónimos ==");
t("'Ajo' publica también 'ajo' — 53 recetas lo escriben de las dos formas", () => {
  assert.deepEqual(S.variantesLlaveMenu("Ajo"), ["Ajo", "ajo"]);
});
t("desde la forma acentuada se cubren las dos escrituras", () => {
  const v = S.variantesLlaveMenu("Orégano seco");
  assert.ok(v.includes("Orégano seco") && v.includes("Oregano seco"), "con y sin acento");
  assert.ok(v.includes("orégano seco") && v.includes("oregano seco"), "y en minúsculas");
});
t("frase larga recupera la inicial mayúscula sin tocar el resto", () => {
  const v = S.variantesLlaveMenu("pierna y muslo deshuesado");
  assert.ok(v.includes("Pierna y muslo deshuesado"), "la receta que lo capitaliza también conecta");
});
t("vacío, espacios o null no generan llaves", () => {
  assert.deepEqual(S.variantesLlaveMenu(""), []);
  assert.deepEqual(S.variantesLlaveMenu("   "), []);
  assert.deepEqual(S.variantesLlaveMenu(null), []);
});
t("NO se inventan plurales: 'Papas' (fritas) no puede costearse con el precio de 'Papa'", () => {
  assert.ok(!S.variantesLlaveMenu("Papa").includes("Papas"));
});
t("las llaves de una fila incluyen los sinónimos capturados a mano", () => {
  const k = S.llavesMenuDeFila({ nombreSync: "Tortilla de maíz", producto: { sinonimos_menu: ["tortillas de maiz"] } });
  assert.ok(k.includes("Tortilla de maíz") && k.includes("Tortilla de maiz"), "el nombre y su forma sin acento");
  assert.ok(k.includes("tortillas de maiz") && k.includes("Tortillas de maiz"), "el plural entra por el sinónimo");
});
t("una fila histórica con nombres pegados publica cada nombre por separado", () => {
  const nombres = S.separarNombresMenu("Alitas, Alitas IQF, Alitas de Pollo", []);
  const k = S.llavesMenuDeFila({ nombreSync:nombres.principal, sinonimosSync:nombres.sinonimos, producto:{} });
  ["Alitas", "Alitas IQF", "Alitas de Pollo"].forEach(n => assert.ok(k.includes(n), `falta ${n}`));
  assert.ok(!k.some(n => n.includes(",")), "nunca se publica la cadena combinada con comas");
});
t("sin sinónimos no truena y no duplica llaves", () => {
  assert.deepEqual(S.llavesMenuDeFila({ nombreSync: "Sal", producto: {} }), ["Sal", "sal"]);
});
t("el mapa publica el precio bajo cada variante y cada sinónimo", () => {
  const rows = [{
    nombreSync: "Ajo", incluir: true, calc: { ok: true, precio: 90, unidadBase: "kg" },
    producto: { fecha_precio: "2026-08-18", sinonimos_menu: ["Ajo picado"] },
  }];
  const nuevo = S.construirMapaPreciosMenu(rows, {}, "18/08/2026");
  ["Ajo", "ajo", "Ajo picado", "ajo picado"].forEach(k => {
    assert.ok(k in nuevo, `falta la llave "${k}"`);
    close(nuevo[k].precio, 90);
  });
});
t("una fila destildada conserva TODAS sus llaves previas, no solo la principal", () => {
  const previos = {
    "Ajo": { precio: 80, unidad_base: "kg", fecha: "01/06/2026" },
    "ajo": { precio: 80, unidad_base: "kg", fecha: "01/06/2026" },
  };
  const nuevo = S.construirMapaPreciosMenu([{
    nombreSync: "Ajo", incluir: false, calc: { ok: true, precio: 90, unidadBase: "kg" },
    producto: { fecha_precio: "2026-08-18", sinonimos_menu: [] },
  }], previos, "18/08/2026");
  assert.deepEqual(nuevo, previos, "ni se actualizan ni se pierden");
});

console.log("\n== saldo de caja del periodo (fuente única: Caja, su PDF y el Resumen) ==");
t("cifras reales 06-12 jul: 1,653 + 122,274 − 91,935.66 − 0 = 31,991.34", () => {
  const ef = (id, fecha, imp) => ({ id, fecha, importe: imp, formaPago: "efectivo", estadoPago: "pagado" });
  S.state = { activeWeek: "w1", budget: {},
    cajaSaldoInicial: { "2026-07-06": { valor: 1653.00 } },
    weeks: [{ id: "w1", label: "06 al 12 jul 2026", ini: "2026-07-06", fin: "2026-07-12",
      cortes: [{ id: "c1", fecha: "2026-07-10", monto: 53066.00 }, { id: "c2", fecha: "2026-07-07", monto: 69208.00 }],
      retiros: [],
      gastos: [ef("1","2026-07-10",8200.00), ef("2","2026-07-10",36827.63), ef("3","2026-07-10",10380.00),
               ef("4","2026-07-10",459.00), ef("5","2026-07-07",2619.00), ef("6","2026-07-07",193.10),
               ef("7","2026-07-07",2310.90), ef("8","2026-07-06",24946.02), ef("9","2026-07-06",6000.01)] }] };
  const r = S.calcularSaldoCajaPeriodo("2026-07-06", "2026-07-12");
  close(r.totalCortes, 122274.00);
  close(r.totalGastos, 91935.66);
  close(r.saldo, 31991.34);
});
t("solo cuenta lo que cae DENTRO del periodo, venga de la semana que venga", () => {
  const ef = (id, fecha, imp) => ({ id, fecha, importe: imp, formaPago: "efectivo", estadoPago: "pagado" });
  S.state = { activeWeek: "w2", budget: {},
    cajaSaldoInicial: { "2026-07-06": { valor: 1000 } },
    weeks: [
      { id: "w1", label: "sem previa", ini: "2026-06-29", fin: "2026-07-05", cortes: [{ id:"cx", fecha:"2026-07-01", monto: 99999 }], retiros: [], gastos: [ef("x","2026-07-01",5000)] },
      // Un gasto FECHADO dentro del periodo pero guardado en la bolsa de otra semana sí cuenta.
      { id: "w2", label: "06-12", ini: "2026-07-06", fin: "2026-07-12", cortes: [{ id:"c1", fecha:"2026-07-07", monto: 500 }],
        retiros: [{ id:"r1", fecha:"2026-07-08", monto: 100 }], gastos: [ef("a","2026-07-07",200)] },
    ] };
  const r = S.calcularSaldoCajaPeriodo("2026-07-06", "2026-07-12");
  close(r.totalCortes, 500, 0.001);
  close(r.totalGastos, 200, 0.001);
  close(r.saldo, 1000 + 500 - 200 - 100);
});
t("sin saldo inicial fijado el periodo parte de $0 (no arrastra en silencio)", () => {
  S.state = { activeWeek: "w1", budget: {}, cajaSaldoInicial: {},
    weeks: [{ id: "w1", ini: "2026-07-06", fin: "2026-07-12", cortes: [{ id:"c", fecha:"2026-07-07", monto: 700 }], retiros: [], gastos: [] }] };
  const r = S.calcularSaldoCajaPeriodo("2026-07-06", "2026-07-12");
  assert.equal(r.saldoInicialManual, null);
  close(r.saldo, 700);
});

console.log("\n== duplicados sospechosos (facturas contadas dos veces) ==");
t("padre 'Dividida' + categorías sueltas que suman lo mismo → sugiere borrar el padre", () => {
  const r = S.duplicadosSospechosos([
    { id: "p1", proveedor: "WALMART", factura: "ICAJG465599", fecha: "2026-07-01", categoria: "Dividida", importe: 2817.99 },
    { id: "h1", proveedor: "WALMART", factura: "ICAJG465599", fecha: "2026-07-01", categoria: "Gastos Generales", importe: 64.00 },
    { id: "h2", proveedor: "WALMART", factura: "ICAJG465599", fecha: "2026-07-01", categoria: "Lácteos / Cremería", importe: 170.00 },
    { id: "h3", proveedor: "WALMART", factura: "ICAJG465599", fecha: "2026-07-01", categoria: "Cárnicos", importe: 1733.97 },
    { id: "h4", proveedor: "WALMART", factura: "ICAJG465599", fecha: "2026-07-01", categoria: "Limpieza / Plásticos", importe: 399.01 },
    { id: "h5", proveedor: "WALMART", factura: "ICAJG465599", fecha: "2026-07-01", categoria: "Abarrotes / Secos", importe: 220.00 },
    { id: "h6", proveedor: "WALMART", factura: "ICAJG465599", fecha: "2026-07-01", categoria: "Frutas y Verduras", importe: 230.01 },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].sugeridos, ["p1"], "sin _partidas en el padre, el desglose vive en las sueltas → borrar padre");
  close(r[0].exceso, 2817.99);
  assert.equal(r[0].consolidable, true, "padre sin desglose + categorías sueltas → se puede consolidar");
});
t("padre nuevo CON _partidas + una categoría suelta igual → sugiere borrar la suelta", () => {
  const r = S.duplicadosSospechosos([
    { id: "p1", proveedor: "WALMART", factura: "IBAGY272028", fecha: "2026-07-01", categoria: "Dividida", importe: 637.00,
      _dividida: true, _partidas: [{ categoria: "Abarrotes / Secos", importe: 400 }, { categoria: "Limpieza / Plásticos", importe: 237 }] },
    { id: "h1", proveedor: "WALMART", factura: "IBAGY272028", fecha: "2026-07-01", categoria: "Abarrotes / Secos", importe: 637.00 },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].sugeridos, ["h1"], "el padre trae el desglose → se conserva; se borra la captura plana");
  assert.equal(r[0].consolidable, false, "el padre ya trae desglose → no hace falta consolidar");
});
t("consolidar F5863: padre total + 2 categorías sueltas → 1 factura dividida con ambas categorías", () => {
  S.state = { activeWeek: "w1", budget: {}, weeks: [{ id: "w1", label: "sem", gastos: [
    { id: "p1", proveedor: "ASAEL CRUZ", factura: "F5863", fecha: "2026-07-01", categoria: "Dividida", importe: 16201.10, respaldo: null },
    { id: "h1", proveedor: "ASAEL CRUZ", factura: "F5863", fecha: "2026-07-01", categoria: "Cárnicos", importe: 2903.10 },
    { id: "h2", proveedor: "ASAEL CRUZ", factura: "F5863", fecha: "2026-07-01", categoria: "Lácteos / Cremería", importe: 13298.00 },
  ] }] };
  S.consolidarFacturaDividida("ASAEL CRUZ", "F5863");
  const regs = S.state.weeks[0].gastos.filter(g => g.factura === "F5863");
  assert.equal(regs.length, 1, "queda un solo registro de la factura");
  const g = regs[0];
  assert.equal(g._dividida, true);
  close(g.importe, 16201.10);
  const cats = (g._partidas || []).map(p => p.categoria).sort();
  assert.deepEqual(cats, ["Cárnicos", "Lácteos / Cremería"], "conserva ambas categorías de compra");
  close(g._partidas.reduce((s, p) => s + p.importe, 0), 16201.10, 0.02);
});
t("consolidar suma categorías repetidas de la misma clase (2 'Cárnicos' → una partida)", () => {
  S.state = { activeWeek: "w1", budget: {}, weeks: [{ id: "w1", label: "sem", gastos: [
    { id: "p1", proveedor: "PROV", factura: "X1", fecha: "2026-07-01", categoria: "Dividida", importe: 300.00, respaldo: null },
    { id: "h1", proveedor: "PROV", factura: "X1", fecha: "2026-07-01", categoria: "Cárnicos", importe: 100.00 },
    { id: "h2", proveedor: "PROV", factura: "X1", fecha: "2026-07-01", categoria: "Cárnicos", importe: 200.00 },
  ] }] };
  S.consolidarFacturaDividida("PROV", "X1");
  const g = S.state.weeks[0].gastos.find(x => x.factura === "X1");
  assert.equal(g._partidas.length, 1, "las dos partidas 'Cárnicos' se funden en una");
  close(g._partidas[0].importe, 300.00);
});
t("captura repetida exacta (mismo folio, fecha e importe) → sugiere borrar la más reciente", () => {
  const r = S.duplicadosSospechosos([
    { id: "1001", proveedor: "JOSE LEONARDO DURAN PARRA", factura: "F-1426", fecha: "2026-07-01", categoria: "Hielo", importe: 17250.00 },
    { id: "1002", proveedor: "JOSE LEONARDO DURAN PARRA", factura: "F-1426", fecha: "2026-07-01", categoria: "Hielo", importe: 17250.00 },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].sugeridos, ["1002"]);
  close(r[0].exceso, 17250.00);
});
t("mismo folio con importes distintos que no cuadran (partidas viejas sin padre) → NO se marca", () => {
  const r = S.duplicadosSospechosos([
    { id: "a", proveedor: "WALMART", factura: "ICAJG465231", fecha: "2026-06-30", categoria: "Abarrotes / Secos", importe: 1200.00 },
    { id: "b", proveedor: "WALMART", factura: "ICAJG465231", fecha: "2026-06-30", categoria: "Frutas y Verduras", importe: 601.00 },
  ]);
  assert.equal(r.length, 0, "categorías sueltas legítimas del formato viejo no son duplicado");
});
t("padre con desglose coherente → TODA suelta del mismo folio sobra (limpieza a medias)", () => {
  // Caso real ICAJG466113: se borraron algunas sueltas de una en una y las restantes dejaron
  // de sumar el total del padre, así que el detector viejo ya no las marcaba.
  const sueltas = [11611.25, 1457.00, 11499.35, 2517.98, 3819.33, 19667.70, 3909.33,
                   11900.33, 1447.00, 11598.69, 1378.41];
  const r = S.duplicadosSospechosos([
    { id: "900", proveedor: "NUEVA WAL MART DE MEXICO", factura: "ICAJG466113", fecha: "2026-07-06",
      categoria: "Dividida", importe: 24946.02, _dividida: true,
      _partidas: [{ categoria: "Abarrotes / Secos", importe: 11611.25 }, { categoria: "Frutas y Verduras", importe: 1457.00 },
                  { categoria: "Lácteos / Cremería", importe: 11499.35 }, { categoria: "Artículos de limpieza", importe: 378.42 }] },
    ...sueltas.map((imp, i) => ({ id: String(910 + i), proveedor: "NUEVA WAL MART DE MEXICO",
      factura: "ICAJG466113", fecha: "2026-07-06", categoria: "Abarrotes / Secos", importe: imp })),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].sugeridos.length, 11, "las 11 sueltas sobran aunque ya no sumen el total");
  assert.ok(!r[0].sugeridos.includes("900"), "el padre con el desglose se conserva");
  close(r[0].exceso, 80806.37);
});
t("padre con desglose NO cuadrado no dispara la regla fuerte (no borra sin base)", () => {
  const r = S.duplicadosSospechosos([
    { id: "p1", proveedor: "PROV", factura: "A1", fecha: "2026-07-06", categoria: "Dividida", importe: 1000, _dividida: true,
      _partidas: [{ categoria: "Cárnicos", importe: 100 }, { categoria: "Hielo", importe: 200 }] },   // suman 300 ≠ 1000
    { id: "h1", proveedor: "PROV", factura: "A1", fecha: "2026-07-06", categoria: "Cárnicos", importe: 640 },
  ]);
  assert.equal(r.length, 0, "desglose incompleto: no se sugiere borrar nada por esta regla");
});
t("suelta de OTRA fecha con el mismo folio no se marca por la regla fuerte", () => {
  const r = S.duplicadosSospechosos([
    { id: "p1", proveedor: "PROV", factura: "B2", fecha: "2026-07-06", categoria: "Dividida", importe: 300, _dividida: true,
      _partidas: [{ categoria: "Cárnicos", importe: 100 }, { categoria: "Hielo", importe: 200 }] },
    { id: "h1", proveedor: "PROV", factura: "B2", fecha: "2026-07-09", categoria: "Cárnicos", importe: 55 },
  ]);
  assert.equal(r.length, 0, "otra fecha = otro documento, no duplicado");
});
t("sin folio no agrupa (compras repetidas reales no se marcan)", () => {
  const r = S.duplicadosSospechosos([
    { id: "a", proveedor: "TORTILLERIA", factura: "", fecha: "2026-07-01", categoria: "Tortilla", importe: 500.00 },
    { id: "b", proveedor: "TORTILLERIA", factura: "", fecha: "2026-07-01", categoria: "Tortilla", importe: 500.00 },
  ]);
  assert.equal(r.length, 0);
});

console.log("\n== faltantes de Menu: el precio ya estaba, con otro nombre ==");
// Al cruzar los 96 faltantes que exporto Menu contra las 239 llaves publicadas apareció que 25 YA
// tenian precio bajo otro nombre, y esos 25 concentraban 205 de los 353 usos en recetas. No
// faltaba el precio: faltaba el sinonimo. Los casos de abajo son textuales de ese cruce.

t("lee el CSV que exporta Menu", () => {
  const f = S.parsearFaltantesCsv(
    'Prioridad,Ingrediente,Recetas afectadas,Variantes en las recetas\n' +
    '1,Ajo,53,"Ajo (42); ajo (11)"\n' +
    '3,Aceite,37,"Aceite (32); aceite (5)"\n');
  assert.equal(f.length, 2);
  assert.equal(f[0].nombre, "Ajo");
  assert.equal(f[0].recetas, 53);
});
t("las comas dentro de comillas no parten la fila", () => {
  // "Ajo (42); ajo (11)" y las listas de recetas llevan comas adentro.
  const f = S.parsearFaltantesCsv('Ingrediente,Recetas afectadas,Ejemplos\nSal,53,"Uno, Dos, Tres"\n');
  assert.equal(f.length, 1);
  assert.equal(f[0].nombre, "Sal");
  assert.equal(f[0].recetas, 53);
});
t("el BOM del inicio no se come la primera columna", () => {
  // El archivo real venia con BOM: sin quitarlo, la cabecera no casaba y salian cero filas.
  const f = S.parsearFaltantesCsv('\uFEFFPrioridad,Ingrediente,Recetas afectadas\n1,Ajo,53\n');
  assert.equal(f.length, 1);
  assert.equal(f[0].nombre, "Ajo");
});
t("sale ordenado por cuanto duele, no por orden de archivo", () => {
  const f = S.parsearFaltantesCsv('Ingrediente,Recetas afectadas\nComino,5\nAjo,53\nPapa,11\n');
  assert.deepEqual(f.map(x=>x.nombre), ["Ajo", "Papa", "Comino"]);
});
t("un archivo sin columna Ingrediente no inventa filas", () => {
  assert.deepEqual(S.parsearFaltantesCsv("Producto,Precio\nAjo,10\n"), []);
  assert.deepEqual(S.parsearFaltantesCsv(""), []);
  assert.deepEqual(S.parsearFaltantesCsv(null), []);
});

console.log("\n== la guardia que impide costear col a precio de pollo ==");
// posibleMismoIngrediente casa por subcadena, y por subcadena "pollo" esta dentro de "repollo" y
// "sal" dentro de "salsa bbq". El cruce real propuso las dos. Lo que separa esos desastres de
// "Aceite -> Aceite vegetal" no es el parecido ni el tamaño: es si la palabra esta COMPLETA.

t("Repollo contra Pollo se marca: comparten letras, no una palabra", () => {
  const r = S.riesgoAlias("Repollo", { nombre_comercial:"Pollo", unidad_base:"kg" });
  assert.ok(r, "tiene que levantar sospecha");
  assert.equal(r.tipo, "pedazo");
});
t("Sal contra Salsa BBQ se marca por lo mismo", () => {
  // 53 recetas costeadas con salsa embotellada a $37.50/lt si esto pasa de largo.
  const r = S.riesgoAlias("Sal", { nombre_comercial:"Salsa BBQ", unidad_base:"lt" });
  assert.ok(r); assert.equal(r.tipo, "pedazo");
});
t("Aceite contra Aceite vegetal NO se marca: ahi si es palabra entera", () => {
  assert.equal(S.riesgoAlias("Aceite", { nombre_comercial:"Aceite vegetal", unidad_base:"lt" }), null);
});
t("Jalapeno contra Chile jalapeno tampoco", () => {
  assert.equal(S.riesgoAlias("Jalapeno", { nombre_comercial:"Chile jalapeno", unidad_base:"kg" }), null);
});
t("los acentos no cambian el veredicto", () => {
  assert.equal(S.riesgoAlias("Jalapeño", { nombre_comercial:"Chile jalapeno", unidad_base:"kg" }), null);
  assert.equal(S.riesgoAlias("Rollo Norteño", { nombre_comercial:"Rollo Norteno de Res", unidad_base:"kg" }), null);
});
t("la unidad que no cuadra se marca aunque el nombre encaje", () => {
  // Harina -> Tortilla de Harina, $3/pz. "harina" SI es palabra entera ahi, asi que la guardia
  // de palabra no lo caza; la de unidad si. Hacen falta las dos.
  const r = S.riesgoAlias("Harina", { nombre_comercial:"Tortilla de Harina", unidad_base:"pz" }, "kg");
  assert.ok(r); assert.equal(r.tipo, "unidad");
});
t("sin unidad esperada no se inventa un problema de unidad", () => {
  assert.equal(S.riesgoAlias("Harina", { nombre_comercial:"Tortilla de Harina", unidad_base:"pz" }), null);
});
t("un producto sin nombre no pasa como candidato bueno", () => {
  const r = S.riesgoAlias("Ajo", { nombre_comercial:"", unidad_base:"kg" });
  assert.ok(r); assert.equal(r.tipo, "vacio");
});
t("_esPalabraCompleta hace justo eso y nada mas", () => {
  assert.equal(S._esPalabraCompleta("aceite", "aceite vegetal"), true);
  assert.equal(S._esPalabraCompleta("pollo", "repollo"), false);
  assert.equal(S._esPalabraCompleta("sal", "salsa bbq"), false);
  assert.equal(S._esPalabraCompleta("pierna y muslo", "pierna y muslo de pollo"), true);
  assert.equal(S._esPalabraCompleta("", "algo"), false);
});

console.log("\n== el plan: que hacer con cada faltante ==");
const CAT = [
  { id:"1", nombre_comercial:"Aceite vegetal",         unidad_base:"lt", estado:"validado", sinonimos_menu:[] },
  { id:"2", nombre_comercial:"Pierna y muslo de pollo", unidad_base:"kg", estado:"validado", sinonimos_menu:[] },
  { id:"3", nombre_comercial:"Pollo",                   unidad_base:"kg", estado:"validado", sinonimos_menu:[] },
  { id:"4", nombre_comercial:"Comino",                  unidad_base:"kg", estado:"validado", sinonimos_menu:["comino molido"] },
];

t("lo que ya se publica con ese nombre queda cubierto, sin preguntar", () => {
  const p = S.planAlias([{ nombre:"Comino", recetas:5 }], CAT);
  assert.equal(p[0].estado, "cubierto");
  assert.equal(p[0].candidatos.length, 0);
});
t("un sinonimo YA capturado tambien cuenta como cubierto", () => {
  // Si no, cada importacion volveria a preguntar por lo mismo que ya se resolvio.
  const p = S.planAlias([{ nombre:"comino molido", recetas:4 }], CAT);
  assert.equal(p[0].estado, "cubierto");
});
t("Aceite encuentra a Aceite vegetal, sin sospecha", () => {
  const p = S.planAlias([{ nombre:"Aceite", recetas:37 }], CAT);
  assert.equal(p[0].estado, "candidatos");
  assert.equal(p[0].candidatos[0].producto.id, "1");
  assert.equal(p[0].candidatos[0].riesgo, null);
});
t("Repollo encuentra a Pollo pero llega MARCADO", () => {
  // No se esconde el candidato: se enseña con el motivo, porque esconderlo tampoco ayuda a
  // quien tiene que decidir. Lo que no se hace es aplicarlo solo.
  const p = S.planAlias([{ nombre:"Repollo", recetas:1 }], CAT);
  assert.equal(p[0].estado, "candidatos");
  assert.ok(p[0].candidatos[0].riesgo, "tiene que venir con su advertencia");
});
t("los candidatos limpios salen antes que los sospechosos", () => {
  // "Sal" casa con los dos: con "Salsa BBQ" por pedazo de palabra (mal) y con "Sal de grano"
  // por palabra entera (bien). El sospechoso va primero en el catalogo a proposito: si nadie
  // ordena, es el que ve la persona arriba y el que va a aceptar de corrido.
  const cat = [
    { id:"a", nombre_comercial:"Salsa BBQ",   unidad_base:"lt", estado:"validado", sinonimos_menu:[] },
    { id:"b", nombre_comercial:"Sal de grano", unidad_base:"kg", estado:"validado", sinonimos_menu:[] },
  ];
  const c = S.planAlias([{ nombre:"Sal", recetas:53 }], cat)[0].candidatos;
  assert.equal(c.length, 2, "los dos tienen que aparecer");
  assert.equal(c[0].producto.id, "b", "primero el limpio");
  assert.equal(c[0].riesgo, null);
  assert.ok(c[1].riesgo, "y el sospechoso al final, con su motivo");
});
t("lo que no se parece a nada pide precio nuevo", () => {
  const p = S.planAlias([{ nombre:"Chile morita", recetas:3 }], CAT);
  assert.equal(p[0].estado, "sin_candidato");
});
t("un producto ignorado no se ofrece como candidato", () => {
  // "Ignorado" significa que alguien ya dijo que eso no se costea. Proponerlo lo revive.
  const cat = [{ id:"9", nombre_comercial:"Agua", unidad_base:"lt", estado:"ignorado", sinonimos_menu:[] }];
  assert.equal(S.planAlias([{ nombre:"Agua", recetas:4 }], cat)[0].estado, "sin_candidato");
});
t("el resumen cuenta recetas, no renglones", () => {
  // 25 filas suena poco; 205 usos en recetas es lo que de verdad se arregla.
  const r = S.resumenPlanAlias(S.planAlias([
    { nombre:"Aceite", recetas:37 }, { nombre:"Comino", recetas:5 }, { nombre:"Chile morita", recetas:3 },
  ], CAT));
  assert.equal(r.candidatos, 1);   assert.equal(r.recetas.candidatos, 37);
  assert.equal(r.cubierto, 1);     assert.equal(r.recetas.cubierto, 5);
  assert.equal(r.sin_candidato, 1);assert.equal(r.recetas.sin_candidato, 3);
  assert.equal(r.total, 45);
});
t("no truena con catalogo vacio ni con basura", () => {
  assert.deepEqual(S.planAlias([], []), []);
  assert.deepEqual(S.planAlias(null, null), []);
  assert.equal(S.planAlias([{ nombre:"Ajo", recetas:1 }], null)[0].estado, "sin_candidato");
});

console.log("\n== escribir el sinonimo sin ensuciar el producto ==");
t("agrega el nombre nuevo conservando los que ya estaban", () => {
  const s = S.conSinonimoAgregado({ nombre_comercial:"Comino", sinonimos_menu:["comino molido"] }, "Comino en polvo");
  assert.deepEqual(s, ["comino molido", "Comino en polvo"]);
});
t("no duplica por mayusculas ni acentos", () => {
  assert.equal(S.conSinonimoAgregado({ nombre_comercial:"Comino", sinonimos_menu:["Comino molido"] }, "comino molido"), null);
  assert.equal(S.conSinonimoAgregado({ nombre_comercial:"Jalapeno", sinonimos_menu:["Jalapeño"] }, "jalapeno"), null);
});
t("no se agrega a si mismo como sinonimo", () => {
  // El nombre principal ya se publica solo; repetirlo solo engorda el documento.
  assert.equal(S.conSinonimoAgregado({ nombre_comercial:"Aceite vegetal", sinonimos_menu:[] }, "aceite vegetal"), null);
});
t("respeta ingrediente_generico como principal cuando existe", () => {
  assert.equal(S.conSinonimoAgregado({ nombre_comercial:"Aceite Nutrioli 20L", ingrediente_generico:"Aceite", sinonimos_menu:[] }, "aceite"), null);
});
t("un nombre vacio no escribe nada", () => {
  assert.equal(S.conSinonimoAgregado({ nombre_comercial:"X", sinonimos_menu:[] }, "  "), null);
  assert.equal(S.conSinonimoAgregado(null, "Ajo"), null);
});

console.log("\n== la fecha publicada tiene que ser la del precio ==");
t("cada entrada lleva fecha_precio, no solo la de sincronizacion", () => {
  // Las 239 llaves publicadas decian todas 21/08/2026 porque aqui se estampaba fechaHoy. En Menu
  // una factura de enero y una de agosto se veian igual de frescas, y sin fecha real no hay
  // forma de caducar nada.
  const m = S.construirMapaPreciosMenu([{
    incluir:true, nombreSync:"Ajo", sinonimosSync:[],
    producto:{ fecha_precio:"2026-08-14" },
    calc:{ ok:true, precio:140.51, unidadBase:"kg" },
  }], {}, "21/08/2026");
  assert.equal(m["Ajo"].fecha_precio, "2026-08-14", "la fecha DEL PRECIO");
  assert.equal(m["Ajo"].fecha, "21/08/2026", "y la de sincronizacion se conserva para no romper Menu");
});
t("un producto sin fecha de precio no inventa una", () => {
  const m = S.construirMapaPreciosMenu([{
    incluir:true, nombreSync:"Sal", sinonimosSync:[], producto:{},
    calc:{ ok:true, precio:10, unidadBase:"kg" },
  }], {}, "21/08/2026");
  assert.equal(m["Sal"].fecha_precio, "", "vacio es honesto; la fecha de hoy seria mentira");
});

console.log("\n== contra QUE se compara el gasto del periodo ==");
// Caso real del 03 al 31 de agosto de 2026: objetivo asignado 350,000/semana, pero las metas por
// categoria sumaban 547,000/semana. Con 29 dias (factor 4.142857) la pantalla contestaba dos cosas
// opuestas con los mismos datos: contra la suma de categorias el gasto salia POR DEBAJO y en verde
// (+805,968.96), contra el objetivo salia POR ENCIMA y en rojo (-10,173.90). Las dos cuentas
// estaban bien. Lo que faltaba era decir cual manda.

const F29 = 29 / 7;

t("manda el objetivo asignado, no la suma de categorias", () => {
  const B = S.basePresupuestoPeriodo(350000, 547000, F29);
  close(B.objetivo, 1450000, 0.01);
  close(B.suma, 2266142.86, 0.01);
  close(B.base, 1450000, 0.01, "el tope es el que alguien asigno");
  assert.equal(B.fuente, "asignado");
});
t("el descuadre queda dicho, no escondido", () => {
  // Es la cifra que explica por que las dos lecturas se contradecian.
  const B = S.basePresupuestoPeriodo(350000, 547000, F29);
  close(B.descuadre, 816142.86, 0.01, "las categorias reparten de mas");
  assert.ok(B.descuadre > 0);
});
t("repartir de menos tambien es descuadre, con el signo al reves", () => {
  const B = S.basePresupuestoPeriodo(350000, 300000, 1);
  close(B.descuadre, -50000, 0.01);
  close(B.base, 350000, 0.01, "el tope no baja porque se reparta de menos");
});
t("cuadrado es descuadre cero", () => {
  const B = S.basePresupuestoPeriodo(350000, 350000, F29);
  close(B.descuadre, 0, 0.005);
  close(B.base, B.suma, 0.01);
});
t("sin objetivo asignado el tope es la suma de categorias", () => {
  // Es el unico numero que queda; comparar contra cero pintaria TODO en rojo.
  const B = S.basePresupuestoPeriodo(0, 547000, F29);
  close(B.base, 2266142.86, 0.01);
  assert.equal(B.fuente, "categorias");
  assert.equal(B.descuadre, 0, "sin tope no hay nada que descuadre");
});
t("el objetivo tambien se prorratea, no se compara semanal contra un mes", () => {
  // El error que ya se corrigio una vez en Seguimiento: un mes de gasto contra la meta de UNA
  // semana hace que todo salga excedido.
  const B = S.basePresupuestoPeriodo(350000, 350000, F29);
  close(B.objetivo, 1450000, 0.01);
  assert.ok(B.objetivo > 350000, "sin prorratear, el tope de 29 dias seria el de 7");
});
t("factor invalido o ausente vale 1, no cero", () => {
  // Con factor 0 el tope seria 0 y toda la pantalla saldria excedida.
  [undefined, null, 0, -3, NaN, "cuatro"].forEach(f => {
    const B = S.basePresupuestoPeriodo(350000, 350000, f);
    close(B.objetivo, 350000, 0.01, "factor " + String(f));
  });
});
t("no truena con basura en las cifras", () => {
  const B = S.basePresupuestoPeriodo(undefined, null, 1);
  assert.equal(B.objetivo, 0);
  assert.equal(B.suma, 0);
  assert.equal(B.base, 0);
  assert.equal(B.fuente, "categorias");
});

t("la barra del admin y la tarjeta hacen la MISMA cuenta", () => {
  // Guardia sobre el fuente: si cada una vuelve a calcular su tope por su cuenta, vuelven a poder
  // contradecirse — que es exactamente el reporte que origino esto.
  const cuerpo = (n) => {
    const i = script.indexOf("function " + n + "(");
    assert.ok(i > -1, "no encontre " + n);
    let j = script.indexOf("{", i), d = 0;
    for (let k = j; k < script.length; k++) {
      if (script[k] === "{") d++;
      else if (script[k] === "}") { d--; if (!d) return script.slice(i, k + 1); }
    }
    return "";
  };
  ["actualizarTotalPresupuesto", "renderDetallePresupuesto"].forEach(n => {
    const b = cuerpo(n).replace(/\/\/[^\n]*/g, "");
    assert.ok(b.includes("basePresupuestoPeriodo("), n + " tiene que salir del calculo compartido");
    // Y tiene que USAR lo que devuelve. Llamarla y despues recalcular por tu cuenta deja el
    // nombre puesto y la contradiccion intacta, que es lo que hay que impedir.
    assert.ok(!/\*\s*F\.factor/.test(b), n + " volvio a prorratear por su cuenta");
  });
});

console.log("\n== Seguimiento se fusiono en Presupuesto ==");
// Seguimiento dibujaba por tercera vez la comparacion gasto-vs-presupuesto por categoria que
// budgetGrid ya pinta con los mismos numeros, y su tabla de detalle ya solo aportaba la forma de
// pago — que Gastos tambien edita desde el paso 1. Lo que quedaba propio eran los exportadores y
// el resumen que veia quien no es admin. Todo eso vive ahora en Presupuesto.

t("hay un modo que ve todo y solo cambia la forma de pago", () => {
  const p = S.permisosDetalle("pago");
  assert.equal(p.formaPago, true, "es lo unico que esta pantalla toca");
  assert.equal(p.borrar, false, "borrar vive SOLO en Gastos");
  assert.equal(p.importe, false);
  assert.equal(p.categoria, false);
  assert.equal(p.proveedor, false);
  assert.equal(p.folio, false);
  assert.equal(p.verFactura, true, "revisar un pago sin poder ver el comprobante no sirve");
});
t("un modo que no existe cae en lectura, no en edicion", () => {
  // Si alguien teclea mal el nombre del modo, el peor default posible seria dejar editar.
  const p = S.permisosDetalle("pagos");   // el plural, un dedazo natural
  assert.equal(p.formaPago, false);
  assert.equal(p.borrar, false);
});

t("no quedo ni un cable suelto de Seguimiento", () => {
  // Guardia sobre el fuente. Al quitar una pantalla lo que truena no es lo que se borra, es lo que
  // se queda apuntando a lo borrado: un boton en la barra sin pagina detras, o un repintado que
  // llama a una funcion que ya no existe. Eso falla en silencio y solo se ve usandola.
  // Ojo con las subcadenas: "page-reporte" vive dentro de "page-reportes", que es Auditoria y
  // sigue existiendo. Por eso el id se busca con sus comillas y no suelto.
  assert.ok(!html.includes('id="page-reporte"'), "quedo la pagina de Seguimiento");
  ["reporteContent", "reportePeriodoSel", "renderReporteActual",
   "renderSeguimientoVista"].forEach(x => {
    assert.ok(!html.includes(x), "quedo una referencia viva a " + x);
  });
});
t("cada showPage() apunta a una pagina que existe", () => {
  // La guardia general, no solo para este cambio: un boton que lleva a una pagina inexistente
  // deja la pantalla en blanco sin decir nada.
  const destinos = [...html.matchAll(/showPage\(\s*['"]([\w-]+)['"]/g)].map(m => m[1]);
  assert.ok(destinos.length > 5, "esperaba encontrar la navegacion");
  [...new Set(destinos)].forEach(d => {
    assert.ok(html.includes('id="page-' + d + '"'), 'showPage("' + d + '") no tiene pagina');
  });
});
t("Presupuesto revisa y marca pagos, pero no borra", () => {
  const i = script.indexOf("function renderDetallePresupuesto(");
  assert.ok(i > -1, "no encontre renderDetallePresupuesto");
  let j = script.indexOf("{", i), d = 0, b = "";
  for (let k = j; k < script.length; k++) {
    if (script[k] === "{") d++;
    else if (script[k] === "}") { d--; if (!d) { b = script.slice(i, k + 1); break; } }
  }
  assert.ok(/permisosDetalle\("pago"\)/.test(b), "tiene que declarar sus permisos, no armarlos a mano");
  assert.ok(!b.includes("eliminarGasto("), "el bote de basura vive solo en Gastos");
  assert.ok(b.includes("verEnGastos("), "pero tiene que llevar a donde SI se corrige");
});
t("el detalle y las metas se repintan juntos", () => {
  // Si renderPresupuesto repinta budgetGrid pero no el detalle, la misma pantalla acaba
  // enseñando dos periodos distintos a la vez.
  const i = script.indexOf("function renderPresupuesto(");
  let j = script.indexOf("{", i), d = 0, b = "";
  for (let k = j; k < script.length; k++) {
    if (script[k] === "{") d++;
    else if (script[k] === "}") { d--; if (!d) { b = script.slice(i, k + 1); break; } }
  }
  // Sin los comentarios: una llamada comentada sigue conteniendo el texto, asi que buscarlo tal
  // cual daria por buena una pantalla que ya no repinta nada.
  const vivo = b.replace(/\/\/[^\n]*/g, "");
  assert.ok(vivo.includes("renderDetallePresupuesto("), "renderPresupuesto tiene que repintar su detalle");
});
t("los exportadores siguen colgados de un boton", () => {
  // Vivian en la barra de Seguimiento. Si la pagina se va y nadie los mueve, el Excel y el PDF
  // del periodo dejan de existir sin que ninguna prueba se entere.
  ["exportarExcel()", "exportarPDF()"].forEach(f => {
    assert.ok(html.includes('onclick="' + f + '"'), "nadie puede llamar a " + f);
  });
});

console.log("\n== el UUID y el folio son el mismo comprobante ==");
// El boton «Capturar» de la conciliacion SAT escribia el UUID en el campo Factura. El registro con
// el folio real y el registro con el UUID son dos cadenas que no se parecen en nada, asi que nunca
// caian en el mismo grupo: la conciliacion acusaba un duplicado que «Revisar duplicados» no
// encontraba, y que a mano tampoco aparecia.

t("el mapa traduce el UUID al folio real del CFDI", () => {
  const m = S.mapaUuidAFolio([
    { uuid: "FAB5A405-B677-44E4-9689-83C1228B3088", folio: "FAB5A405-B677-44E4-9689-83C1228B3088", serie: "FCPF", folioComp: "4010508626" },
  ]);
  assert.equal(m[S._dupFolioCanon("FAB5A405-B677-44E4-9689-83C1228B3088")], S._dupFolioCanon("FCPF4010508626"));
});
t("un CFDI sin folio no ensucia el mapa", () => {
  const m = S.mapaUuidAFolio([{ uuid: "AAAA-BBBB", serie: "", folio: "" }, null]);
  assert.deepEqual(Object.keys(m).filter(k => k), Object.keys(m).filter(k => k && m[k]));
  assert.equal(Object.keys(m).length, 0);
});
t("no truena sin CFDIs", () => {
  assert.deepEqual(S.mapaUuidAFolio(null), {});
  assert.deepEqual(S.mapaUuidAFolio([]), {});
});
t("la identidad resuelve el UUID capturado en el campo Factura", () => {
  const m = S.mapaUuidAFolio([{ uuid: "FAB5A405-B677-44E4-9689-83C1228B3088", folio: "FAB5A405-B677-44E4-9689-83C1228B3088", serie: "FCPF", folioComp: "4010508626" }]);
  const conUuid  = { factura: "FAB5A405-B677-44E4-9689-83C1228B3088" };
  const conFolio = { factura: "FCPF4010508626" };
  assert.equal(S._folioIdentidad(conUuid, m), S._folioIdentidad(conFolio, m),
    "los dos registros tienen que quedar con la MISMA identidad");
});
t("sin folio capturado, el cfdiUuid sigue identificando el gasto", () => {
  const m = S.mapaUuidAFolio([{ uuid: "FAB5A405-B677-44E4-9689-83C1228B3088", folio: "FAB5A405-B677-44E4-9689-83C1228B3088", serie: "FCPF", folioComp: "4010508626" }]);
  assert.equal(S._folioIdentidad({ factura: "", cfdiUuid: "FAB5A405-B677-44E4-9689-83C1228B3088" }, m),
               S._dupFolioCanon("FCPF4010508626"));
});
t("sin folio y sin uuid, no hay identidad (no agrupa a ciegas)", () => {
  assert.equal(S._folioIdentidad({ proveedor: "X", importe: 100 }, {}), "");
  assert.equal(S._folioIdentidad(null, null), "");
});
t("sin mapa, la identidad es el folio tal cual (no rompe lo que ya funcionaba)", () => {
  assert.equal(S._folioIdentidad({ factura: "PBAL-31598" }, null), S._dupFolioCanon("PBAL-31598"));
});

console.log("\n== la factura entera Y sus partes, las dos guardadas ==");
// La forma mas comun de duplicar: se divide una factura por categorias y despues se vuelve a subir
// la original completa. Por importe no salta —ninguno de los tres coincide con otro; lo que coincide
// es la SUMA— y el detector viejo solo buscaba esa suma cuando existia un registro marcado
// "Dividida", que aqui no existe.

t("ONUS 06 jul: 29,038.36 + 4,996.00 = 34,034.36 → sobra la completa", () => {
  const r = S.facturaEnteraYSusPartes([
    { id: "a", categoria: "Cárnicos",           importe: 29038.36 },
    { id: "b", categoria: "Frutas y Verduras",  importe: 4996.00  },
    { id: "c", categoria: "Cárnicos",           importe: 34034.36 },
  ]);
  assert.ok(r, "tiene que detectarlo");
  assert.equal(r.completo.id, "c", "la que sobra es la completa, no una de las partes");
  assert.deepEqual(r.partes.map(x => x.id).sort(), ["a", "b"]);
});
t("el reparto redondeado a centavos sigue cuadrando", () => {
  const r = S.facturaEnteraYSusPartes([
    { id: "a", importe: 33.33 }, { id: "b", importe: 33.33 }, { id: "c", importe: 33.34 },
    { id: "d", importe: 100.00 },
  ]);
  assert.ok(r); assert.equal(r.completo.id, "d");
});
t("una sola parte NO basta: eso ya es el duplicado exacto de siempre", () => {
  // Con dos registros iguales no hay "reparto" que conservar; de eso se encarga la regla de
  // captura repetida, que sabe cual borrar (la mas reciente).
  assert.equal(S.facturaEnteraYSusPartes([{ id: "a", importe: 100 }, { id: "b", importe: 100 }]), null);
});
t("divisiones legitimas sin la factura completa NO se marcan", () => {
  // Tres categorias de la misma factura, sin que nadie haya subido el entero: es captura correcta.
  assert.equal(S.facturaEnteraYSusPartes([
    { id: "a", importe: 100 }, { id: "b", importe: 200 }, { id: "c", importe: 350 },
  ]), null);
});
t("importes en cero o negativos no inventan una suma que cuadre", () => {
  assert.equal(S.facturaEnteraYSusPartes([
    { id: "a", importe: 0 }, { id: "b", importe: 100 }, { id: "c", importe: 100 },
  ]), null, "descontando el cero quedan dos, y dos iguales no son entero+partes");
});
t("no truena con basura", () => {
  assert.equal(S.facturaEnteraYSusPartes(null), null);
  assert.equal(S.facturaEnteraYSusPartes([null, undefined, { id: "a", importe: 1 }]), null);
});

t("el caso ONUS completo, de punta a punta, con el UUID en el campo Factura", () => {
  // La reproduccion exacta de lo que el usuario tenia en pantalla: dos categorias con el folio real
  // y una tercera captura, del total, con el UUID. Sin el mapa son dos grupos distintos y no se
  // detecta nada.
  const cfdis = [{ uuid: "FAB5A405-B677-44E4-9689-83C1228B3088", folio: "FAB5A405-B677-44E4-9689-83C1228B3088",
                   serie: "FCPF", folioComp: "4010508626", proveedor: "ONUS COMERCIAL", total: 34034.36, fecha: "2026-07-06" }];
  const gastos = [
    { id: "1", proveedor: "ONUS COMERCIAL", factura: "FCPF4010508626", fecha: "2026-07-06",
      categoria: "Cárnicos", importe: 29038.36 },
    { id: "2", proveedor: "ONUS COMERCIAL", factura: "FCPF4010508626", fecha: "2026-07-06",
      categoria: "Frutas y Verduras", importe: 4996.00 },
    { id: "3", proveedor: "ONUS COMERCIAL", factura: "FAB5A405-B677-44E4-9689-83C1228B3088",
      fecha: "2026-07-06", categoria: "Cárnicos", importe: 34034.36 },
  ];
  const r = S.duplicadosSospechosos(gastos, S.mapaUuidAFolio(cfdis));
  assert.equal(r.length, 1, "los tres tienen que caer en UN grupo");
  assert.deepEqual(r[0].sugeridos, ["3"], "se borra la completa; el reparto por categoria se conserva");
  close(r[0].exceso, 34034.36);
});
t("sin el mapa, ese mismo caso no se detecta (es justo el bug que se corrigio)", () => {
  const gastos = [
    { id: "1", proveedor: "ONUS COMERCIAL", factura: "FCPF4010508626", fecha: "2026-07-06", importe: 29038.36 },
    { id: "2", proveedor: "ONUS COMERCIAL", factura: "FCPF4010508626", fecha: "2026-07-06", importe: 4996.00 },
    { id: "3", proveedor: "ONUS COMERCIAL", factura: "FAB5A405-B677-44E4-9689-83C1228B3088", fecha: "2026-07-06", importe: 34034.36 },
  ];
  const r = S.duplicadosSospechosos(gastos, {});
  assert.ok(!r.some(g => (g.sugeridos || []).includes("3")),
    "sin el puente uuid→folio son dos grupos y el entero pasa desapercibido");
});
t("las partes de una factura dividida, solas, siguen sin marcarse", () => {
  // Guardia contra el falso positivo caro: si la regla nueva se pasara de lista, borraria capturas
  // buenas. Dos categorias del mismo folio, sin el entero, son captura correcta.
  const r = S.duplicadosSospechosos([
    { id: "1", proveedor: "ONUS COMERCIAL", factura: "FCPF4010508626", fecha: "2026-07-06", importe: 29038.36 },
    { id: "2", proveedor: "ONUS COMERCIAL", factura: "FCPF4010508626", fecha: "2026-07-06", importe: 4996.00 },
  ], {});
  assert.equal(r.length, 0);
});

console.log("\n== duplicados v2: casos reales de la semana 06-12 jul 2026 ==");
t("folio con y sin prefijo (PBAL-31598 ≡ 31598) → duplicado", () => {
  const r = S.duplicadosSospechosos([
    { id: "1", proveedor: "POLLO BAL", factura: "PBAL-31598", fecha: "2026-07-07", categoria: "Cárnicos", importe: 26484.00 },
    { id: "2", proveedor: "POLLO BAL", factura: "31598", fecha: "2026-07-07", categoria: "Cárnicos", importe: 26484.00 },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].sugeridos, ["2"]);
  close(r[0].exceso, 26484.00);
});
t("proveedor escrito distinto, mismo folio (Eva Mota (Plásticos) ≡ Plásticos de Morelia) → duplicado", () => {
  const r = S.duplicadosSospechosos([
    { id: "1", proveedor: "EVA MOTA CARDENAS (PLÁSTICOS DE MORELIA)", factura: "12493", fecha: "2026-07-06", categoria: "Artículos de limpieza", importe: 11023.20 },
    { id: "2", proveedor: "PLASTICOS DE MORELIA", factura: "12493", fecha: "2026-07-06", categoria: "Desechables", importe: 11023.20 },
  ]);
  assert.equal(r.length, 1, "el paréntesis y el acento no deben impedir el agrupamiento");
  close(r[0].exceso, 11023.20);
});
t("mismo folio y proveedor, capturado dos veces igual (12524) → duplicado", () => {
  const r = S.duplicadosSospechosos([
    { id: "1", proveedor: "EVA MOTA CARDENAS (PLÁSTICOS DE MORELIA)", factura: "12524", fecha: "2026-07-09", categoria: "Deschables", importe: 23488.64 },
    { id: "2", proveedor: "EVA MOTA CARDENAS", factura: "12524", fecha: "2026-07-09", categoria: "Deschables", importe: 23488.64 },
  ]);
  assert.equal(r.length, 1);
  close(r[0].exceso, 23488.64);
});
t("Walmart ICAJG466113: padre Dividida + DOS tripletas que suman el padre → sugiere las 6 sueltas", () => {
  const r = S.duplicadosSospechosos([
    { id: "10", proveedor: "NUEVA WAL MART DE MEXICO", factura: "ICAJG466113", fecha: "2026-07-06", categoria: "Dividida", importe: 24946.02 },
    { id: "11", proveedor: "NUEVA WAL MART DE MEXICO", factura: "ICAJG466113", fecha: "2026-07-06", categoria: "Abarrotes / Secos", importe: 18608.71 },
    { id: "12", proveedor: "NUEVA WAL MART DE MEXICO", factura: "ICAJG466113", fecha: "2026-07-06", categoria: "Frutas y Verduras", importe: 2517.98 },
    { id: "13", proveedor: "NUEVA WAL MART DE MEXICO", factura: "ICAJG466113", fecha: "2026-07-06", categoria: "Lácteos / Cremería", importe: 3819.33 },
    { id: "14", proveedor: "NUEVA WAL MART DE MEXICO", factura: "ICAJG466113", fecha: "2026-07-06", categoria: "Abarrotes / Secos", importe: 19667.70 },
    { id: "15", proveedor: "NUEVA WAL MART DE MEXICO", factura: "ICAJG466113", fecha: "2026-07-06", categoria: "Frutas y Verduras", importe: 1368.99 },
    { id: "16", proveedor: "NUEVA WAL MART DE MEXICO", factura: "ICAJG466113", fecha: "2026-07-06", categoria: "Lácteos / Cremería", importe: 3909.33 },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].sugeridos.sort(), ["11", "12", "13", "14", "15", "16"], "las 6 sueltas sobran; se conserva el padre");
  close(r[0].exceso, 49892.04, 0.05);
  assert.ok(/no trae desglose/.test(r[0].motivo), "avisa que hay que capturar el desglose antes de borrar");
});
t("padre con desglose + UNA tripleta: solo sobra la tripleta", () => {
  const r = S.duplicadosSospechosos([
    { id: "10", proveedor: "WALMART", factura: "F900", fecha: "2026-07-06", categoria: "Dividida", importe: 300.00,
      _dividida: true, _partidas: [{ categoria: "Abarrotes / Secos", importe: 200 }, { categoria: "Cárnicos", importe: 100 }] },
    { id: "11", proveedor: "WALMART", factura: "F900", fecha: "2026-07-06", categoria: "Abarrotes / Secos", importe: 150.00 },
    { id: "12", proveedor: "WALMART", factura: "F900", fecha: "2026-07-06", categoria: "Cárnicos", importe: 100.00 },
    { id: "13", proveedor: "WALMART", factura: "F900", fecha: "2026-07-06", categoria: "Lácteos / Cremería", importe: 50.00 },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].sugeridos.sort(), ["11", "12", "13"]);
  assert.ok(!/no trae desglose/.test(r[0].motivo), "el padre ya trae partidas: no hace falta el aviso");
});
t("divisiones manuales legítimas (mismo folio, importes distintos, sin padre) → NO se marcan", () => {
  const r = S.duplicadosSospechosos([
    { id: "1", proveedor: "ONUS COMERCIAL, SA DE CV", factura: "FCPF4010508626", fecha: "2026-07-06", categoria: "Cárnicos", importe: 29038.36 },
    { id: "2", proveedor: "ONUS COMERCIAL, SA DE CV", factura: "FCPF4010508626", fecha: "2026-07-06", categoria: "Frutas y Verduras", importe: 4996.00 },
    { id: "3", proveedor: "NUEVA WAL MART DE MEXICO", factura: "IBAGY272188", fecha: "2026-07-07", categoria: "Artículos de limpieza", importe: 193.10 },
    { id: "4", proveedor: "NUEVA WAL MART DE MEXICO", factura: "IBAGY272188", fecha: "2026-07-07", categoria: "Lácteos / Cremería", importe: 2310.90 },
  ]);
  assert.equal(r.length, 0, "partidas de una misma factura con montos distintos son legítimas");
});
t("el grupo conserva el folio tal cual se capturó (para que 'Consolidar' lo encuentre)", () => {
  const r = S.duplicadosSospechosos([
    { id: "p1", proveedor: "ASAEL CRUZ", factura: "F-5863", fecha: "2026-07-01", categoria: "Dividida", importe: 300.00 },
    { id: "h1", proveedor: "ASAEL CRUZ", factura: "F-5863", fecha: "2026-07-01", categoria: "Cárnicos", importe: 100.00 },
    { id: "h2", proveedor: "ASAEL CRUZ", factura: "F-5863", fecha: "2026-07-01", categoria: "Lácteos / Cremería", importe: 200.00 },
  ]);
  assert.equal(r[0].consolidable, true);
  assert.equal(r[0].folioReal, "F-5863", "el guion debe conservarse; el canónico solo se usa para mostrar");
  assert.equal(r[0].folio, "F5863");
});
t("folios cortos distintos NO se confunden (5891 vs 891)", () => {
  assert.equal(S._dupFoliosEquivalentes("5891", "891"), false, "folios de <4 dígitos: solo igualdad exacta");
  assert.equal(S._dupFoliosEquivalentes("PBAL31598", "31598"), true);
  assert.equal(S._dupFoliosEquivalentes("12493", "12524"), false);
});
t("proveedores realmente distintos no se agrupan aunque compartan folio corto", () => {
  assert.equal(S._dupProvParecidos("POLLO BAL", "GAS EXPRESS NIETO"), false);
  assert.equal(S._dupProvParecidos("EVA MOTA CARDENAS (PLÁSTICOS DE MORELIA)", "PLASTICOS DE MORELIA"), true);
  assert.equal(S._dupProvParecidos("NUEVA WAL MART DE MEXICO", "NUEVA WAL MART DE MEXICO "), true);
});
t("mismo día e importe con folios totalmente distintos → se marca como posible repetición", () => {
  const r = S.duplicadosSospechosos([
    { id: "1", proveedor: "BEBIDAS PURIFICADAS", factura: "A-100", fecha: "2026-07-11", categoria: "Refrescos / Pepsi", importe: 32639.33 },
    { id: "2", proveedor: "BEBIDAS PURIFICADAS", factura: "MOJBE550120", fecha: "2026-07-11", categoria: "Refrescos / Pepsi", importe: 32639.33 },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].sugeridos, ["2"]);
});
t("mismo día e importe SIN folio (compras reales repetidas) → NO se marca", () => {
  const r = S.duplicadosSospechosos([
    { id: "1", proveedor: "TORTILLERIA", factura: "", fecha: "2026-07-06", categoria: "Tortilla", importe: 1200.00 },
    { id: "2", proveedor: "TORTILLERIA", factura: "", fecha: "2026-07-06", categoria: "Tortilla", importe: 1200.00 },
  ]);
  assert.equal(r.length, 0);
});

console.log("\n== precios desde los renglones del CFDI (dato fiscal, sin IA) ==");
const CONCEPTO = (d, vu, extra = "") =>
  `<cfdi:Concepto ClaveProdServ="50221300" Cantidad="905" ClaveUnidad="KGM" Descripcion="${d}" ValorUnitario="${vu}" Importe="100.00" ${extra}/>`;
t("se extrae cada renglón con su valor unitario exacto", () => {
  const c = S._cfdiConceptos("<x>" + CONCEPTO("KILOGRAMOS DE TORTILLAS", "25.00") + "</x>");
  assert.equal(c.length, 1);
  assert.equal(c[0].desc, "KILOGRAMOS DE TORTILLAS");
  close(c[0].precio, 25);
  assert.equal(c[0].unidad, "KGM", "la clave del SAT se guarda tal cual");
  assert.equal(c[0].clave, "50221300");
});
t("las entidades XML se desescapan o el alias nunca casaría", () => {
  const c = S._cfdiConceptos("<x>" + CONCEPTO("JUGO SAZONADOR M&amp;E BOT 1 L", "70") + "</x>");
  assert.equal(c[0].desc, "JUGO SAZONADOR M&E BOT 1 L");
  assert.equal(S._desescaparXml("A &lt;b&gt; &quot;c&quot;"), 'A <b> "c"');
});
t("un renglón sin descripción no entra (no hay nada que identificar)", () => {
  assert.deepEqual(S._cfdiConceptos("<x>" + CONCEPTO("", "25") + "</x>"), []);
});
t("la unidad del SAT se traduce; lo desconocido se deja vacío, no se inventa", () => {
  assert.equal(S.unidadDesdeClaveSAT("KGM"), "kg");
  assert.equal(S.unidadDesdeClaveSAT("H87"), "pz");
  assert.equal(S.unidadDesdeClaveSAT("XBX"), "cja");
  assert.equal(S.unidadDesdeClaveSAT("ZZ"), "", "inventar la unidad costearía con un factor mil");
  assert.equal(S.unidadDesdeClaveSAT(null), "");
});

const CFDI = (fecha, tipo, conceptos, rfcRec = "MIRFC") =>
  ({ tipo, fecha, rfcReceptor: rfcRec, proveedor: "PROV", uuid: "U-" + fecha, conceptos });
t("de una descripción repetida gana el renglón MÁS RECIENTE", () => {
  const p = S.preciosDesdeCfdis([
    CFDI("2026-07-05", "I", [{ desc: "LECHUGA ROMA", precio: 30, unidad: "KGM" }]),
    CFDI("2026-07-28", "I", [{ desc: "LECHUGA ROMA", precio: 35.81, unidad: "KGM" }]),
  ]);
  assert.equal(p.length, 1);
  close(p[0].precio, 35.81);
  assert.equal(p[0].fecha, "2026-07-28");
});
t("solo cuentan las facturas de gasto: pago y nómina no traen precios", () => {
  const p = S.preciosDesdeCfdis([
    CFDI("2026-07-05", "P", [{ desc: "PAGO", precio: 100 }]),
    CFDI("2026-07-06", "N", [{ desc: "SUELDO", precio: 100 }]),
  ]);
  assert.deepEqual(p, [], "un complemento de pago no es una compra");
});
t("una factura que YO emití es una venta, no una compra", () => {
  const p = S.preciosDesdeCfdis([
    CFDI("2026-07-05", "I", [{ desc: "COMIDA", precio: 90 }], "MIRFC"),
    CFDI("2026-07-06", "I", [{ desc: "COMIDA", precio: 90 }], "MIRFC"),
    CFDI("2026-07-07", "I", [{ desc: "SERVICIO DE COMEDOR", precio: 500 }], "OTRORFC"),
  ]);
  assert.deepEqual(p.map(x => x.desc), ["COMIDA"], "el receptor más frecuente es uno mismo");
});
t("un renglón sin precio no sirve para costear", () => {
  assert.deepEqual(S.preciosDesdeCfdis([CFDI("2026-07-05", "I", [{ desc: "X", precio: 0 }])]), []);
});
t("el catálogo identifica por nombre y por alias, igual que al leer facturas", () => {
  const cat = [
    { id: "1", nombre_comercial: "Lechuga romana", alias_factura: ["LECHUGA ROMA"] },
    { id: "2", nombre_comercial: "Tortilla de maíz", alias_factura: [] },
  ];
  const r = S.resolverPreciosCatalogo(
    [{ desc: "LECHUGA ROMA", precio: 35 }, { desc: "tortilla de maiz", precio: 25 }, { desc: "MM PASTA TOM", precio: 157 }],
    cat);
  assert.equal(r.identificados.length, 2, "uno por alias, otro por nombre sin acentos");
  assert.deepEqual(r.porIdentificar.map(x => x.desc), ["MM PASTA TOM"]);
});
t("NO se adivina por parecido: 'Ajo' jamás debe casar con 'UNIFORMES DE TRABAJO'", () => {
  // Caso real de un mes de CFDIs: el emparejado difuso cazaba "Ajo" dentro de "trabAJO",
  // "Sal" con "SALSA CATSUP" y "Mantequilla" con "MANTECA". Un precio equivocado costea mal
  // y nadie se entera, así que lo dudoso se pregunta — nunca se aplica solo.
  const cat = [{ id: "1", nombre_comercial: "Ajo", alias_factura: ["AJO"] },
               { id: "2", nombre_comercial: "Sal", alias_factura: ["SAL"] }];
  const r = S.resolverPreciosCatalogo(
    [{ desc: "UNIFORMES DE TRABAJO", precio: 4357.3 }, { desc: "SALSA CATSUP SOBRE STAR VALU", precio: 95.86 }],
    cat);
  assert.equal(r.identificados.length, 0, "ninguno de los dos es un match real");
  assert.equal(r.porIdentificar.length, 2);
});

console.log("\n== identificación asistida: la IA propone, la persona confirma ==");
const PRECIO = (desc, precio = 10, extra = {}) =>
  ({ desc, precio, unidad: "kg", proveedor: "PROV", fecha: "2026-07-28", folio: "U1", ...extra });
const CAT2 = [
  { id: "1", nombre_comercial: "Queso americano", ingrediente_generico: "Queso americano", alias_factura: [] },
  { id: "2", nombre_comercial: "Puré de tomate", ingrediente_generico: "Puré de tomate", alias_factura: [] },
];
t("si la IA reconoce un producto que ya existe, se vuelve alias — no un duplicado", () => {
  const a = S.planIdentificacion(
    [{ descripcion: "MM QUESO AME", producto: "Queso americano", existente: "Queso americano", confianza: "alta", es_insumo: true }],
    [PRECIO("MM QUESO AME", 173.91)], CAT2);
  assert.equal(a.length, 1);
  assert.equal(a[0].tipo, "alias");
  assert.equal(a[0].producto.id, "1");
});
t("si no reconoce ninguno existente, se propone producto nuevo", () => {
  const a = S.planIdentificacion(
    [{ descripcion: "BC 3K SPAGU", producto: "Espagueti", existente: null, unidad: "kg", confianza: "media", es_insumo: true }],
    [PRECIO("BC 3K SPAGU", 92.07)], CAT2);
  assert.equal(a[0].tipo, "nuevo");
  assert.equal(a[0].nombre, "Espagueti");
  assert.equal(a[0].unidad, "kg");
});
t("lo que no es insumo de cocina no ensucia el catálogo", () => {
  const a = S.planIdentificacion(
    [{ descripcion: "UNIFORMES DE TRABAJO", producto: "Uniformes", existente: null, es_insumo: false, confianza: "alta" }],
    [PRECIO("UNIFORMES DE TRABAJO", 4357.3)], CAT2);
  assert.equal(a[0].tipo, "ignorar");
  assert.ok(!S._identSugerida(a[0]), "y ni siquiera viene marcado");
});
t("una propuesta que NO corresponde a ningún renglón del CFDI se descarta", () => {
  // Si el modelo inventa una descripción que nunca estuvo en la factura, no debe llegar al catálogo.
  const a = S.planIdentificacion(
    [{ descripcion: "PRODUCTO QUE NO EXISTE", producto: "Fantasma", existente: null, es_insumo: true, confianza: "alta" }],
    [PRECIO("MM QUESO AME")], CAT2);
  assert.deepEqual(a, []);
});
t("si la IA repite una descripción, solo cuenta una vez", () => {
  const a = S.planIdentificacion(
    [{ descripcion: "MM QUESO AME", producto: "Queso americano", existente: "Queso americano", es_insumo: true, confianza: "alta" },
     { descripcion: "MM QUESO AME", producto: "Otra cosa", existente: null, es_insumo: true, confianza: "baja" }],
    [PRECIO("MM QUESO AME")], CAT2);
  assert.equal(a.length, 1);
  assert.equal(a[0].tipo, "alias", "gana la primera, no la duplicada");
});
t("un 'existente' que no está en el catálogo NO se da por bueno: se crea nuevo", () => {
  const a = S.planIdentificacion(
    [{ descripcion: "X", producto: "Chorizo", existente: "Chorizo argentino", es_insumo: true, confianza: "alta" }],
    [PRECIO("X")], CAT2);
  assert.equal(a[0].tipo, "nuevo", "no se inventa un producto al que apuntar");
});
t("solo lo de confianza ALTA viene premarcado; lo dudoso lo decide la persona", () => {
  const alta = { descripcion: "A", producto: "P", existente: null, es_insumo: true, confianza: "alta" };
  const baja = { descripcion: "B", producto: "Q", existente: null, es_insumo: true, confianza: "baja" };
  const a = S.planIdentificacion([alta, baja], [PRECIO("A"), PRECIO("B")], CAT2);
  assert.equal(S._identSugerida(a[0]), true);
  assert.equal(S._identSugerida(a[1]), false, "confianza baja NO se guarda sin revisar");
});

console.log("\n== antiduplicados: un producto que ya existe NO se vuelve a crear ==");
t("si la IA propone como NUEVO algo que ya está en el catálogo, se vuelve alias", () => {
  // El riesgo real: la IA no reconoce "Queso americano" en la lista y propone crearlo otra vez.
  const a = S.planIdentificacion(
    [{ descripcion: "BC1.36K QCRE", producto: "Queso americano", existente: null, es_insumo: true, confianza: "alta" }],
    [PRECIO("BC1.36K QCRE", 120)], CAT2);
  assert.equal(a[0].tipo, "alias", "no se crea un segundo 'Queso americano'");
  assert.equal(a[0].producto.id, "1");
});
t("el nombre se compara también contra los alias ya guardados", () => {
  const cat = [{ id: "9", nombre_comercial: "Cebolla", alias_factura: ["CEBOLLA BLANCA"] }];
  const a = S.planIdentificacion(
    [{ descripcion: "20/500ROMA", producto: "Cebolla blanca", existente: null, es_insumo: true, confianza: "media" }],
    [PRECIO("20/500ROMA", 30)], cat);
  assert.equal(a[0].tipo, "alias");
  assert.equal(a[0].nombre, "Cebolla", "cae en el producto real, no en el alias");
});
t("corregir el nombre a mano reconvierte la fila a alias del producto existente", () => {
  const idx = S._indiceNombresCatalogo(CAT2);
  const nuevo = { tipo: "nuevo", desc: "MM PASTA TOM", nombre: "Pasta de tomate", confianza: "media", precio: PRECIO("MM PASTA TOM") };
  const corregido = S.decidirDestinoIdent({ ...nuevo, nombre: "Puré de tomate" }, idx);
  assert.equal(corregido.tipo, "alias");
  assert.equal(corregido.producto.id, "2");
});
t("y al revés: si se corrige a un nombre que no existe, vuelve a ser producto nuevo", () => {
  const idx = S._indiceNombresCatalogo(CAT2);
  const alias = S.decidirDestinoIdent({ tipo: "nuevo", desc: "X", nombre: "Puré de tomate", precio: PRECIO("X") }, idx);
  assert.equal(alias.tipo, "alias");
  const devuelta = S.decidirDestinoIdent({ ...alias, nombre: "Salsa bechamel" }, idx);
  assert.equal(devuelta.tipo, "nuevo");
  assert.ok(!devuelta.producto, "no queda apuntando al producto anterior");
});
t("la selección del usuario sobrevive al cambio de nombre", () => {
  const idx = S._indiceNombresCatalogo(CAT2);
  const r = S.decidirDestinoIdent({ tipo: "nuevo", desc: "X", nombre: "Puré de tomate", _sel: true, precio: PRECIO("X") }, idx);
  assert.equal(r._sel, true, "no se destilda solo por corregir el nombre");
});
t("una fila 'no es insumo' no se convierte en producto por tener nombre", () => {
  const idx = S._indiceNombresCatalogo(CAT2);
  const r = S.decidirDestinoIdent({ tipo: "ignorar", desc: "UNIFORMES", nombre: "Puré de tomate" }, idx);
  assert.equal(r.tipo, "ignorar", "omitir gana sobre cualquier coincidencia de nombre");
});

console.log("\n== Gmail: decir POR QUÉ la bandeja está vacía ==");
t("buzón sin adjuntos en el rango: se aclara que Gmail SÍ respondió", () => {
  const m = S.resumenGmail(0, 0, 0, 30);
  assert.ok(/no hay ningún adjunto/i.test(m));
  assert.ok(/30 día/.test(m), "dice el rango que se consultó");
  assert.ok(!/no se encontraron facturas/i.test(m), "el texto viejo hacía asumir que no cargó");
});
t("todo ya capturado por el equipo NO se reporta como bandeja vacía", () => {
  // Es el caso que confundía: llegaron 12, pero alguien más ya las capturó.
  const m = S.resumenGmail(12, 0, 12, 30);
  assert.ok(/12 adjunto/.test(m), "se dice cuántas llegaron");
  assert.ok(/ya están todos capturados o descartados/i.test(m));
});
t("con trabajo nuevo se cuentan por separado las nuevas y las ya revisadas", () => {
  const m = S.resumenGmail(12, 5, 7, 30);
  assert.ok(/5 factura\(s\) nueva\(s\)/.test(m));
  assert.ok(/7 ya revisadas/.test(m));
});
t("si no hay ya revisadas, no se menciona la parte de ya revisadas", () => {
  const m = S.resumenGmail(5, 5, 0, 15);
  assert.ok(/5 factura\(s\) nueva\(s\)/.test(m));
  assert.ok(!/ya revisadas/.test(m));
});

console.log("\n== sincronización visible entre usuarios ==");
const W = (id, gastos) => ({ id, label: id, gastos, cortes: [], retiros: [] });
t("si la nube trae un gasto que no tenías, la firma cambia y hay que repintar", () => {
  const antes = S._firmaEstado({ weeks: [W("w1", [{ id: "1", importe: 100 }])] });
  const despues = S._firmaEstado({ weeks: [W("w1", [{ id: "1", importe: 100 }, { id: "2", importe: 50 }])] });
  assert.notEqual(antes, despues);
});
t("si no cambió nada, la firma es igual y NO se repinta de balde", () => {
  const a = { weeks: [W("w1", [{ id: "1", importe: 100 }])], budget: { total: 10 } };
  const b = { weeks: [W("w1", [{ id: "1", importe: 100 }])], budget: { total: 10 } };
  assert.equal(S._firmaEstado(a), S._firmaEstado(b));
});
t("cambiar el presupuesto o el saldo inicial también cuenta como cambio visible", () => {
  const base = { weeks: [], budget: { total: 10 }, cajaSaldoInicial: { w1: 5 } };
  assert.notEqual(S._firmaEstado(base), S._firmaEstado({ ...base, budget: { total: 20 } }));
  assert.notEqual(S._firmaEstado(base), S._firmaEstado({ ...base, cajaSaldoInicial: { w1: 9 } }));
});
t("un estado corrupto no tumba la sincronización", () => {
  const ciclico = { weeks: [] }; ciclico.weeks.push(ciclico);   // referencia circular
  assert.equal(S._firmaEstado(ciclico), "", "devuelve vacío en vez de lanzar");
  assert.equal(S._firmaEstado(null), JSON.stringify([undefined, undefined, undefined]));
});
t("el aviso de sincronización dice hace cuánto, no solo que existe", () => {
  const ahora = 1_700_000_000_000;
  assert.equal(S.textoSync(0, ahora), "⟳ sin sincronizar");
  assert.equal(S.textoSync(ahora - 5000, ahora), "⟳ al día");
  assert.equal(S.textoSync(ahora - 60_000, ahora), "⟳ hace 1 min");
  assert.equal(S.textoSync(ahora - 7 * 60_000, ahora), "⟳ hace 7 min");
});
t("un reloj adelantado no produce 'hace -3 min'", () => {
  const ahora = 1_700_000_000_000;
  assert.equal(S.textoSync(ahora + 180_000, ahora), "⟳ al día");
});

console.log("\n== el periodo compartido, resuelto a fechas de verdad ==");
// getPeriodoSP() en modo semana devuelve weekId y etiqueta, SIN ini/fin. Todo lo que compare
// fechas contra el periodo tiene que pasar por resolverPeriodoSP() o se queda ciego.
const WKS = [
  { id: "w1", ini: "2026-08-17", fin: "2026-08-23", label: "17 al 23 ago 2026" },
  { id: "w2", ini: "2026-08-24", fin: "2026-08-30", label: "24 al 30 ago 2026" },
];
t("modo semana: saca las fechas de la semana seleccionada", () => {
  const r = S.resolverPeriodoSP({ modo: "semana", weekId: "w2", label: "24 al 30 ago 2026" }, WKS);
  assert.equal(r.ini, "2026-08-24");
  assert.equal(r.fin, "2026-08-30");
  assert.equal(r.modo, "semana");
});
t("modo rango: respeta las fechas que eligió el usuario", () => {
  const r = S.resolverPeriodoSP({ modo: "rango", ini: "2026-07-04", fin: "2026-08-02", label: "04 jul 2026 al 02 ago 2026" }, WKS);
  assert.equal(r.ini, "2026-07-04");
  assert.equal(r.fin, "2026-08-02");
  assert.equal(r.modo, "rango");
});
t("una semana vieja sin rango no inventa fechas", () => {
  const r = S.resolverPeriodoSP({ modo: "semana", weekId: "vieja" }, [{ id: "vieja", label: "Semana 3" }]);
  assert.equal(r.ini, "");
  assert.equal(r.fin, "");
});
t("sin periodo y sin semanas no truena", () => {
  const r = S.resolverPeriodoSP(null, null);
  assert.deepEqual(r, { modo: "semana", ini: "", fin: "", label: "" });
});

console.log("\n== un gasto guardado que no se ve: hay que decirlo ==");
const PER = { modo: "semana", ini: "2026-08-03", fin: "2026-08-09", label: "03 al 09 ago 2026" };
t("un gasto dentro del periodo no genera aviso", () => {
  assert.equal(S.avisoGastoFueraDeVista("2026-08-05", PER, ""), "");
  assert.equal(S.avisoGastoFueraDeVista("2026-08-03", PER, ""), "", "el primer día cuenta");
  assert.equal(S.avisoGastoFueraDeVista("2026-08-09", PER, ""), "", "el último también");
});
t("una factura de Gmail con fecha de otro periodo avisa que no se va a ver", () => {
  // El caso reportado: se captura desde Gmail, se guarda bien, y no aparece en Gastos,
  // Auditoría ni Presupuesto porque esas vistas filtran por FECHA, no por semana.
  const conSemana = [{ ini: "2026-07-13", fin: "2026-07-19", label: "13 al 19 jul 2026" }];
  const m = S.avisoGastoFueraDeVista("2026-07-15", PER, "", conSemana);
  assert.ok(/FUERA del periodo/.test(m));
  assert.ok(/03 al 09 ago 2026/.test(m), "dice a qué periodo estás mirando");
  assert.ok(/Se guardó bien/.test(m), "deja claro que SÍ se guardó");
});
const SEMANAS = [
  { ini: "2026-08-03", fin: "2026-08-09", label: "03 al 09 ago 2026" },
  { ini: "2026-08-17", fin: "2026-08-23", label: "17 al 23 ago 2026" },
];
t("una fecha posterior al periodo también avisa", () => {
  assert.ok(/FUERA del periodo/.test(S.avisoGastoFueraDeVista("2026-08-19", PER, "", SEMANAS)));
});
t("si NO existe la semana que cubre la fecha, se dice que hay que crearla", () => {
  // Caso real: facturas del 10 al 16 de agosto sin esa semana creada. Como las vistas filtran
  // por fecha y no por bolsa, no había NINGÚN periodo donde pudieran verse.
  const m = S.avisoGastoFueraDeVista("2026-08-12", PER, "", SEMANAS);
  assert.ok(/NINGUNA semana creada/.test(m));
  assert.ok(/no hay que recapturarlo/.test(m), "hay que decir que el dato no se perdió");
  assert.ok(!/cámbiate/i.test(m), "no mandar a un periodo que no existe");
});
t("si la semana sí existe, se manda a cambiarse a ella POR SU NOMBRE", () => {
  // Antes decía "cámbiate a la semana que le toca" sin decir a cuál. Nombrarla es la diferencia
  // entre un aviso accionable y uno que sólo preocupa.
  const m = S.avisoGastoFueraDeVista("2026-08-19", PER, "", SEMANAS);
  assert.ok(/Cámbiate a la semana «17 al 23 ago 2026»/.test(m));
  assert.ok(!/crea la semana/i.test(m));
});
t("una semana sin etiqueta se nombra por sus fechas", () => {
  const m = S.avisoGastoFueraDeVista("2026-08-19", PER, "", [{ ini: "2026-08-17", fin: "2026-08-23" }]);
  assert.ok(/2026-08-17 al 2026-08-23/.test(m), "sin fmtDate en el sandbox van las fechas crudas");
});
t("los bordes de una semana existente cuentan como cubiertos", () => {
  assert.ok(/Cámbiate a la semana/.test(S.avisoGastoFueraDeVista("2026-08-17", PER, "", SEMANAS)), "primer día");
  assert.ok(/Cámbiate a la semana/.test(S.avisoGastoFueraDeVista("2026-08-23", PER, "", SEMANAS)), "último día");
  assert.ok(/NINGUNA semana creada/.test(S.avisoGastoFueraDeVista("2026-08-24", PER, "", SEMANAS)));
});
t("el aviso dice que el periodo NO es la semana de captura de esa pantalla", () => {
  // El reporte que lo destapó: la barra lateral decía "24 al 30 ago 2026", el gasto era del 26,
  // aparecía en Gastos, y el aviso hablaba de "04 jul al 02 ago". Eran dos periodos distintos y
  // el mensaje llamaba al invisible "el periodo que estás viendo".
  const m = S.avisoGastoFueraDeVista("2026-08-19", PER, "", SEMANAS);
  assert.ok(/NO es la semana de captura de esta pantalla/.test(m));
  assert.ok(/Gastos, Presupuesto o Seguimiento/.test(m), "hay que decir dónde se cambia");
});
t("en modo rango no se manda a ninguna semana: se manda a cambiar el rango", () => {
  // Exactamente el caso del reporte: un rango olvidado de la importación de cortes.
  const RANGO = { modo: "rango", ini: "2026-07-04", fin: "2026-08-02", label: "04 jul 2026 al 02 ago 2026" };
  const m = S.avisoGastoFueraDeVista("2026-08-26", RANGO, "", WKS);
  assert.ok(/04 jul 2026 al 02 ago 2026/.test(m), "nombra el rango culpable");
  assert.ok(/Rango de fechas/.test(m), "dice en qué modo está");
  assert.ok(/Semana guardada/.test(m), "y cómo salirse de él");
  assert.ok(!/Cámbiate a la semana/.test(m), "en modo rango no hay semana a la que cambiarse");
  assert.ok(!/NINGUNA semana creada/.test(m), "tampoco se pide crear semanas");
});
t("el aviso en modo semana no se queda mudo por falta de fechas", () => {
  // La regresión de fondo: guardarGasto le pasaba getPeriodoSP() crudo, que en modo semana
  // llega sin ini/fin, así que el aviso devolvía "" SIEMPRE en el modo por default. Encadenar
  // resolverPeriodoSP() es lo que lo despierta.
  const crudo = { modo: "semana", weekId: "w2", label: "24 al 30 ago 2026" };
  assert.equal(S.avisoGastoFueraDeVista("2026-07-15", crudo, "", WKS), "", "sin fechas no puede comparar");
  const resuelto = S.resolverPeriodoSP(crudo, WKS);
  assert.ok(/FUERA del periodo/.test(S.avisoGastoFueraDeVista("2026-07-15", resuelto, "", WKS)));
});
t("guardarGasto le pasa el periodo YA resuelto a fechas, no el crudo", () => {
  // Guardia sobre el código fuente. La prueba de arriba demuestra que con getPeriodoSP() crudo
  // el aviso se queda mudo; ésta impide que alguien vuelva a cablearlo así. No hay DOM ni
  // localStorage en el sandbox, así que el cableado sólo se puede vigilar de forma textual.
  const m = script.match(/_fueraDeVista = avisoGastoFueraDeVista\([\s\S]{0,400}?\);/);
  assert.ok(m, "no encontré la llamada en guardarGasto");
  assert.ok(m[0].includes("periodoSPRango"),
            "el aviso necesita ini/fin: sin periodoSPRango() no compara nada en modo semana");
  assert.ok(!/getPeriodoSP\s*\(/.test(m[0]),
            "getPeriodoSP() crudo no trae fechas en modo semana — el aviso vuelve a quedarse mudo");
});
t("la fecha de corte gana: ese gasto no se ve en NINGUNA consulta", () => {
  const m = S.avisoGastoFueraDeVista("2026-06-01", PER, "2026-07-01");
  assert.ok(/fecha de corte/.test(m));
  assert.ok(!/FUERA del periodo/.test(m), "se explica la causa real, no la secundaria");
});
t("sin periodo definido no se inventan avisos", () => {
  assert.equal(S.avisoGastoFueraDeVista("2026-07-15", null, ""), "");
  assert.equal(S.avisoGastoFueraDeVista("2026-07-15", { ini: "", fin: "" }, ""), "");
});
t("un gasto sin fecha no dispara aviso", () => {
  assert.equal(S.avisoGastoFueraDeVista("", PER, "2026-07-01"), "");
});

console.log("\n== gastos con fecha dudosa (el presupuesto se reparte por fecha) ==");
const HOY = "2026-08-19";
const REV = [{ msgId: "m1", fechaCorreo: "Wed, 12 Aug 2026 17:13:18 +0000" }];
t("la fecha del correo RFC 2822 se entiende", () => {
  assert.equal(S._fechaCorreoISO("Mon, 10 Aug 2026 15:17:33 +0000"), "2026-08-10");
  assert.equal(S._fechaCorreoISO(""), "");
  assert.equal(S._fechaCorreoISO("no es fecha"), "", "basura no truena");
});
t("un gasto POSTERIOR al correo que lo trajo es prueba, no sospecha", () => {
  // Caso real: correo de PolloBal del 12 ago, gasto fechado el 19.
  const r = S.gastosConFechaDudosa(
    [{ id: "1", fecha: "2026-08-19", proveedor: "POLLO BAL", _gmailMsgId: "m1" }], REV, HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].nivel, "seguro");
  assert.ok(/posterior al correo/.test(r[0].motivo));
  assert.equal(r[0].fechaCorreo, "2026-08-12", "se ofrece la fecha del correo como arranque");
});
t("un gasto anterior o igual al correo NO se marca", () => {
  assert.deepEqual(S.gastosConFechaDudosa(
    [{ id: "1", fecha: "2026-08-11", _gmailMsgId: "m1" }], REV, HOY), []);
  assert.deepEqual(S.gastosConFechaDudosa(
    [{ id: "1", fecha: "2026-08-12", _gmailMsgId: "m1" }], REV, HOY), []);
});
t("una fecha en el futuro se marca aunque no haya correo", () => {
  const r = S.gastosConFechaDudosa([{ id: "1", fecha: "2026-09-01" }], [], HOY);
  assert.equal(r.length, 1);
  assert.ok(/futuro/.test(r[0].motivo));
});
t("la huella del fallback: fecha igual al día en que se capturó, viniendo de Gmail", () => {
  const idCaptura = String(new Date("2026-08-19T10:00:00").getTime());
  const r = S.gastosConFechaDudosa(
    [{ id: idCaptura, fecha: "2026-08-19", _gmailMsgId: "zzz" }], [], HOY);
  assert.equal(r.length, 1);
  assert.equal(r[0].nivel, "posible", "es indicio, no prueba");
});
t("un gasto capturado a mano el mismo día NO se marca", () => {
  // Sin _gmailMsgId no aplica: capturar hoy una factura de hoy es lo normal.
  const idCaptura = String(new Date("2026-08-19T10:00:00").getTime());
  assert.deepEqual(S.gastosConFechaDudosa([{ id: idCaptura, fecha: "2026-08-19" }], [], HOY), []);
});
t("los seguros salen antes que los posibles", () => {
  const idCaptura = String(new Date("2026-08-19T10:00:00").getTime());
  const r = S.gastosConFechaDudosa([
    { id: idCaptura, fecha: "2026-08-19", _gmailMsgId: "zzz" },
    { id: "1", fecha: "2026-08-19", proveedor: "POLLO BAL", _gmailMsgId: "m1" },
  ], REV, HOY);
  assert.equal(r.length, 2);
  assert.equal(r[0].nivel, "seguro", "primero lo que es prueba");
  assert.equal(r[1].nivel, "posible");
});
t("un gasto sin fecha no entra a la lista", () => {
  assert.deepEqual(S.gastosConFechaDudosa([{ id: "1", fecha: "" }], REV, HOY), []);
});
const CFDIS = [
  { folioComp: "12668", fecha: "2026-07-24" },
  { folioComp: "PBAL31832", fecha: "2026-07-28" },
  { folioComp: "EAR181665", fecha: "2026-07-08" },
];
t("el CFDI manda: si su fecha es otra, se marca como prueba y se ofrece la buena", () => {
  // Caso real: EVA MOTA folio 12668 quedó en 24 AGO y el comprobante dice 24 JUL.
  const r = S.gastosConFechaDudosa(
    [{ id: "1", fecha: "2026-08-24", factura: "12668", proveedor: "EVA MOTA" }], [], HOY, CFDIS);
  assert.equal(r.length, 1);
  assert.equal(r[0].nivel, "seguro");
  assert.equal(r[0].fuente, "CFDI");
  assert.equal(r[0].fechaCorreo, "2026-07-24", "la fecha ofrecida es la del comprobante");
});
t("si el CFDI confirma la fecha, el gasto NO se marca aunque haya indicios", () => {
  // 5 de 9 sospechosos de un mes real resultaron correctos: coincidían con el día de captura
  // sólo porque la factura se capturó el mismo día que llegó.
  const idCaptura = String(new Date("2026-07-08T10:00:00").getTime());
  const r = S.gastosConFechaDudosa(
    [{ id: idCaptura, fecha: "2026-07-08", factura: "EAR-181665", _gmailMsgId: "zzz" }], [], HOY, CFDIS);
  assert.deepEqual(r, [], "el comprobante gana sobre el indicio");
});
t("el folio casa aunque tenga guiones o prefijo distinto", () => {
  const r = S.gastosConFechaDudosa(
    [{ id: "1", fecha: "2026-08-10", factura: "PBAL-31832" }], [], HOY, CFDIS);
  assert.equal(r.length, 1);
  assert.equal(r[0].fechaCorreo, "2026-07-28");
});
t("un CFDI descartado a mano no se usa como verdad", () => {
  // Fecha en el pasado y sin origen Gmail: si el CFDI descartado contara, saldría marcada.
  const r = S.gastosConFechaDudosa(
    [{ id: "1", fecha: "2026-08-10", factura: "12668" }], [], HOY,
    [{ folioComp: "12668", fecha: "2026-07-24", ignorado: true }]);
  assert.deepEqual(r, [], "sin CFDI válido y sin otra señal, no se inventa sospecha");
});
t("sin CFDI que casar, siguen valiendo las señales de antes", () => {
  const r = S.gastosConFechaDudosa(
    [{ id: "1", fecha: "2026-09-01", factura: "NO-EXISTE" }], [], HOY, CFDIS);
  assert.equal(r.length, 1);
  assert.ok(/futuro/.test(r[0].motivo));
});

console.log("\n== el folio de un CFDI es serie+folio, no el UUID ==");
t("se usa serie+folio, que es lo que la persona teclea", () => {
  assert.equal(S._folioDeCfdi({ serie: "BE2026", folioComp: "070001148188",
    folio: "8E3B6DA1-0067-4301-BD22-6FEAAF67AD6D" }), "BE2026070001148188");
});
t("si SOLO hay UUID no se compara nada, en vez de comparar mal", () => {
  // Un folio corto es hexadecimal y casaría con casi cualquier UUID por casualidad.
  assert.equal(S._folioDeCfdi({ folio: "8E3B6DA1-0067-4301-BD22-6FEAAF67AD6D" }), "");
});
t("un registro viejo sin serie ni folioComp usa su folio si no es un UUID", () => {
  assert.equal(S._folioDeCfdi({ folio: "PBAL-31832" }), "PBAL31832");
});
t("sin nada no truena", () => {
  assert.equal(S._folioDeCfdi(null), "");
  assert.equal(S._folioDeCfdi({}), "");
});
t("el complemento real de julio SÍ se detecta guardado como lo guarda la app", () => {
  // Caso reportado: los 5 complementos seguían saliendo como gasto porque se comparaba el UUID.
  const guardadoComoLoGuardaLaApp = [{
    uuid: "8E3B6DA1-0067-4301-BD22-6FEAAF67AD6D",
    folio: "8E3B6DA1-0067-4301-BD22-6FEAAF67AD6D",   // parseCFDIXML pone el UUID aquí
    serie: "BE2026", folioComp: "070001148188",
    tipo: "P", fecha: "2026-07-30", proveedor: "BEBIDAS PURIFICADAS",
  }];
  const r = S.gastosQueSonComplemento(
    [{ id: "1", factura: "BE2026070001148188", importe: 87302.64, proveedor: "BEBIDAS PURIFICADAS" }],
    guardadoComoLoGuardaLaApp);
  assert.equal(r.length, 1, "ahora sí lo encuentra");
  close(r[0].gasto.importe, 87302.64);
});

console.log("\n== complementos de pago capturados como gasto (dinero contado dos veces) ==");
const CFDIS_P = [
  { serie: "BE2026", folioComp: "080001152524", fecha: "2026-08-06", tipo: "P", proveedor: "BEBIDAS PURIFICADAS" },
  { folioComp: "MOJBE623610", fecha: "2026-08-08", tipo: "I", proveedor: "BEBIDAS PURIFICADAS" },
];
t("un gasto cuyo folio es un CFDI tipo P se marca", () => {
  // Caso real: $139,873.09 capturado desde un complemento de pago de GEPP.
  const r = S.gastosQueSonComplemento(
    [{ id: "1", fecha: "2026-08-04", factura: "BE2026080001152524", importe: 139873.09, proveedor: "BEBIDAS PURIFICADAS" }],
    CFDIS_P);
  assert.equal(r.length, 1);
  assert.equal(r[0].gasto.importe, 139873.09);
});
t("una factura normal (tipo I) NO se marca", () => {
  assert.deepEqual(S.gastosQueSonComplemento(
    [{ id: "1", factura: "MOJBE623610", importe: 23119.5 }], CFDIS_P), []);
});
t("sin CFDI tipo P guardado no se marca nada", () => {
  assert.deepEqual(S.gastosQueSonComplemento(
    [{ id: "1", factura: "BE2026080001152524", importe: 1 }],
    [{ folioComp: "MOJBE623610", tipo: "I" }]), []);
});
t("un complemento descartado a mano no cuenta", () => {
  assert.deepEqual(S.gastosQueSonComplemento(
    [{ id: "1", factura: "BE2026080001152524", importe: 1 }],
    [{ folioComp: "BE2026080001152524", tipo: "P", ignorado: true }]), []);
});
t("un gasto sin folio no puede casarse con nada", () => {
  assert.deepEqual(S.gastosQueSonComplemento([{ id: "1", factura: "", importe: 500 }], CFDIS_P), []);
});
t("salen ordenados por importe, para atacar primero lo que más pesa", () => {
  const r = S.gastosQueSonComplemento([
    { id: "1", factura: "0001135584", importe: 60103.26 },
    { id: "2", factura: "0001148188", importe: 87302.64 },
  ], [{ folioComp: "0001135584", tipo: "P" }, { folioComp: "0001148188", tipo: "P" }]);
  assert.equal(r.length, 2);
  assert.equal(r[0].gasto.importe, 87302.64, "el mayor primero");
});

console.log("\n== bloqueo de complementos de pago al capturar ==");
t("el XML timbrado tipo P se BLOQUEA, sin opción de guardarlo", () => {
  assert.equal(S.bloqueoComplementoPago({ tipo: "P", folio: "BE2026080001152524" }, false), "bloqueo");
  assert.equal(S.bloqueoComplementoPago({ tipo: "p" }, false), "bloqueo", "no importa la caja");
  assert.equal(S.bloqueoComplementoPago({ tipo: "P-PAGO" }, false), "bloqueo");
});
t("una factura normal con XML pasa sin estorbo", () => {
  assert.equal(S.bloqueoComplementoPago({ tipo: "I", folio: "MOJBE623610" }, false), "");
  assert.equal(S.bloqueoComplementoPago({ tipo: "E" }, false), "", "una nota de crédito no es este caso");
});
t("sin XML, la sospecha de la IA solo pide confirmación: puede equivocarse", () => {
  assert.equal(S.bloqueoComplementoPago(null, true), "confirmar");
  assert.equal(S.bloqueoComplementoPago(null, false), "");
});
t("el XML manda sobre la IA: si el comprobante es tipo I, no se estorba aunque la IA dude", () => {
  assert.equal(S.bloqueoComplementoPago({ tipo: "I" }, true), "confirmar",
    "sigue pidiendo confirmación, pero nunca bloquea una factura real");
});
t("el XML tipo P bloquea aunque la IA no haya sospechado nada", () => {
  assert.equal(S.bloqueoComplementoPago({ tipo: "P" }, false), "bloqueo");
});

console.log("\n== importes que no cuadran con el CFDI ==");
const CF_I = [
  { folioComp: "MOJBE623610", tipo: "I", total: 23119.50, subtotal: 19930.60 },
  { folioComp: "ICAJG470507", tipo: "I", total: 24122.00, subtotal: 20794.83 },
];
t("un importe igual al del CFDI no se marca", () => {
  assert.deepEqual(S.gastosConImporteDistinto(
    [{ id: "1", factura: "MOJBE623610", importe: 23119.50 }], CF_I), []);
});
t("haber capturado el SUBTOTAL se detecta y se dice", () => {
  const r = S.gastosConImporteDistinto(
    [{ id: "1", factura: "MOJBE623610", importe: 19930.60 }], CF_I);
  assert.equal(r.length, 1);
  assert.equal(r[0].esSubtotal, true, "se avisa que falta el IVA");
  close(r[0].diferencia, -3188.90);
  close(r[0].totalCfdi, 23119.50);
});
t("diferencias de centavos se ignoran (redondeo)", () => {
  assert.deepEqual(S.gastosConImporteDistinto(
    [{ id: "1", factura: "MOJBE623610", importe: 23119.00 }], CF_I), [],
    "medio peso no es un error de captura");
});
t("un complemento (tipo P) no entra aquí: tiene su propia lista", () => {
  assert.deepEqual(S.gastosConImporteDistinto(
    [{ id: "1", factura: "BE123", importe: 139873.09 }],
    [{ folioComp: "BE123", tipo: "P", total: 0 }]), []);
});
t("sin CFDI que casar no se inventa nada", () => {
  assert.deepEqual(S.gastosConImporteDistinto(
    [{ id: "1", factura: "NO-EXISTE", importe: 999 }], CF_I), []);
});
t("salen ordenados por el tamaño del error", () => {
  const r = S.gastosConImporteDistinto([
    { id: "1", factura: "MOJBE623610", importe: 23000 },
    { id: "2", factura: "ICAJG470507", importe: 10000 },
  ], CF_I);
  assert.equal(r.length, 2);
  assert.equal(r[0].gasto.id, "2", "primero el que más distorsiona");
});

// Caso real reportado: una factura con dos categorías se captura DIVIDIDA. Antes de que eso fuera
// un solo gasto con _partidas, cada categoría quedó como un renglón aparte con el MISMO folio.
// El chequeo comparaba renglón por renglón, así que una factura correcta salía como N errores y
// el botón "Usar el del CFDI" le habría puesto el total completo a cada pedazo.
t("una factura repartida en dos categorías NO se marca si la suma cuadra", () => {
  // ONUS COMERCIAL FCPF4010508626: 4,996.00 + 29,038.36 = 34,034.36 = el CFDI.
  assert.deepEqual(S.gastosConImporteDistinto([
    { id: "1", factura: "FCPF4010508626", importe: 4996.00,  categoria: "Abarrotes / Secos" },
    { id: "2", factura: "FCPF4010508626", importe: 29038.36, categoria: "Cárnicos" },
  ], [{ folioComp: "FCPF4010508626", tipo: "I", total: 34034.36, subtotal: 29340.00 }]), []);
});
t("una factura repartida en seis renglones tampoco, si la suma cuadra", () => {
  // NUEVA WAL MART ICAJG465599, los seis pedazos de la captura real.
  const gs = [64.00, 170.00, 220.00, 230.01, 399.01, 1733.97].map((n,i)=>(
    { id: String(i), factura: "ICAJG465599", importe: n }));
  assert.deepEqual(S.gastosConImporteDistinto(
    gs, [{ folioComp: "ICAJG465599", tipo: "I", total: 2816.99, subtotal: 2428.44 }]), []);
});
t("si la suma NO cuadra se marca UNA vez, con la suma y la diferencia real", () => {
  const r = S.gastosConImporteDistinto([
    { id: "1", factura: "MOJBE623610", importe: 10000 },
    { id: "2", factura: "MOJBE623610", importe: 3119.50 },
  ], CF_I);
  assert.equal(r.length, 1, "un renglón por factura, no uno por pedazo");
  assert.equal(r[0].gastos.length, 2, "lleva los renglones del grupo");
  close(r[0].capturado, 13119.50);
  close(r[0].diferencia, -10000);
});

t("los renglones se juntan aunque el folio se haya tecleado distinto", () => {
  // El mismo comprobante se captura "PBAL-31598", "pbal31598" y "31598". Con igualdad exacta de
  // texto cada uno quedaba suelto y la factura salía como error tres veces.
  assert.deepEqual(S.gastosConImporteDistinto([
    { id: "1", factura: "PBAL-31598", importe: 1000 },
    { id: "2", factura: "pbal31598",  importe: 2000 },
    { id: "3", factura: "31598",      importe: 500  },
  ], [{ folioComp: "PBAL31598", tipo: "I", total: 3500, subtotal: 3017.24 }]), []);
});

t("una factura repartida no sale como diferencia en la conciliación", () => {
  S.state.weeks = [{ id: "1", gastos: [
    { id: "1", factura: "FCPF4010508626", importe: 4996.00,  fecha: "2026-07-06", proveedor: "ONUS COMERCIAL" },
    { id: "2", factura: "FCPF4010508626", importe: 29038.36, fecha: "2026-07-06", proveedor: "ONUS COMERCIAL" },
  ]}];
  const r = S.conciliarSAT([
    { uuid: "11111111-2222-3333-4444-555555555555", folio: "11111111-2222-3333-4444-555555555555",
      serie: "FCPF", folioComp: "4010508626", proveedor: "ONUS COMERCIAL",
      fecha: "2026-07-06", total: 34034.36, tipo: "I" },
  ], "", "", "");
  assert.equal(r.diferencias.length, 0, "la suma de los renglones cuadra con el CFDI");
  assert.equal(r.conciliadas.length, 1);
});
t("la conciliación también junta folios equivalentes, no solo idénticos", () => {
  S.state.weeks = [{ id: "1", gastos: [
    { id: "1", factura: "PBAL-31598", importe: 1000, fecha: "2026-07-06", proveedor: "POLLO BAL" },
    { id: "2", factura: "31598",      importe: 2500, fecha: "2026-07-06", proveedor: "POLLO BAL" },
  ]}];
  const r = S.conciliarSAT([
    { uuid: "99999999-2222-3333-4444-555555555555", folio: "99999999-2222-3333-4444-555555555555",
      serie: "PBAL", folioComp: "31598", proveedor: "POLLO BAL",
      fecha: "2026-07-06", total: 3500, tipo: "I" },
  ], "", "", "");
  assert.equal(r.diferencias.length, 0, "1000 + 2500 = 3500, el total del CFDI");
  assert.equal(r.conciliadas.length, 1);
});
t("si de verdad falta dinero, la conciliación lo sigue diciendo", () => {
  S.state.weeks = [{ id: "1", gastos: [
    { id: "1", factura: "PBAL-31598", importe: 1000, fecha: "2026-07-06", proveedor: "POLLO BAL" },
  ]}];
  const r = S.conciliarSAT([
    { uuid: "99999999-2222-3333-4444-555555555555", folio: "99999999-2222-3333-4444-555555555555",
      serie: "PBAL", folioComp: "31598", proveedor: "POLLO BAL",
      fecha: "2026-07-06", total: 3500, tipo: "I" },
  ], "", "", "");
  assert.equal(r.diferencias.length, 1, "juntar renglones no debe tapar un faltante real");
  close(r.diferencias[0].capturado, 1000);
  close(r.diferencias[0].diferencia, 2500);
});

console.log("\n== ingresos excluidos: se marcan, no se borran ==");
// Los seis globales de julio son cierres acumulados tecleados a mano junto a los cortes
// individuales que YA los contienen. Verificado contra el JSON real, al centavo:
//   63,175 = cortes 18..21 jul   |   72,792 = cortes 22..24 jul
//   74,379 = RCE-2026-00081 (1,915) + cortes 25..28 jul  <- fechado el 14 jul por error
// El corte RCE-2026-00081 termina contado TRES veces: solo, y dentro de dos resumenes.
t("un corte marcado no contable deja de sumar pero sigue guardado", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", retiros:[], gastos:[], cortes:[
    { id:"c1", fecha:"2026-07-18", monto:15535, _folioCorte:"RCE-1" },
    { id:"g1", fecha:"2026-07-22", monto:63175, _noContable:{ motivo:"Cierre acumulado", por:"Paco", ts:"2026-08-24T00:00:00Z" } },
  ]}]};
  close(S.todosLosCortes().reduce((t,c)=>t+c.monto,0), 15535, 0.01);
  assert.equal(S.todosLosCortes().length, 1, "el excluido no aparece en los contables");
  assert.equal(S.todosLosCortesNoContables().length, 1, "pero sigue ahi, entero");
  close(S.todosLosCortesNoContables()[0].monto, 63175, 0.01);
  assert.equal(S.state.weeks[0].cortes.length, 2, "no se borro ningun movimiento");
});
t("esCorteContable distingue, y no truena con basura", () => {
  assert.equal(S.esCorteContable({ monto:1 }), true);
  assert.equal(S.esCorteContable({ monto:1, _noContable:{ motivo:"x" } }), false);
  assert.equal(S.esCorteContable(null), true, "un nulo no es un excluido; no se inventa nada");
});
t("los cuatro dictaminados suman 256,800 y el ingreso queda en 430,054", () => {
  const F = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture_cortes_v3.json"), "utf8"));
  const ef = c => (parseFloat(c.boletos25)||0)+(parseFloat(c.contratistas)||0)+(parseFloat(c.otrosIngresos)||0);
  const globales = [["2026-07-14",74379],["2026-07-24",72792],["2026-07-22",63175],["2026-07-18",46454]];
  S.state = { budget:{}, weeks:[{ id:"w1", retiros:[], gastos:[], cortes: [
    ...F.cortes.map((c,i)=>({ id:"i"+i, fecha:c.fecha, monto:ef(c), _folioCorte:c.folio })),
    ...globales.map(([f,m],i)=>({ id:"g"+i, fecha:f, monto:m })),
  ]}]};
  close(S.todosLosCortes().reduce((t,c)=>t+c.monto,0), 430054 + 256800, 0.01);
  // Se excluyen los cuatro
  S.state.weeks[0].cortes.forEach(c=>{ if(String(c.id).startsWith("g")) c._noContable = { motivo:"Cierre acumulado" }; });
  close(S.todosLosCortes().reduce((t,c)=>t+c.monto,0), 430054, 0.01);
  close(S.todosLosCortesNoContables().reduce((t,c)=>t+c.monto,0), 256800, 0.01);
  assert.equal(S.todosLosCortes().length, 133, "quedan los 133 folios unicos");
});
t("un corte importado nunca se excluye solo", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", retiros:[], gastos:[], cortes:[
    { id:"c1", fecha:"2026-07-18", monto:15535, _folioCorte:"RCE-1" },
  ]}]};
  assert.deepEqual(S.todosLosCortesNoContables(), [], "excluir es siempre una decision humana");
});

console.log("\n== importacion atomica: se arma primero, se escribe despues ==");
// Antes se empujaba de uno en uno sobre week.cortes/gastos/retiros. Si algo tronaba a media
// vuelta quedaba una importacion a medias, sin forma de saber donde se corto ni de deshacerla.
const _previosVacios = () => ({ cortes:[], gastos:[], retiros:[], ignorados:[] });
const _impBase = (egresos, cortesNuevos) => ({
  obj:{ periodo:{ ini:"2026-07-11", fin:"2026-08-02" }, saldoInicial:0 },
  cortesNuevos: cortesNuevos || [], egresos: egresos || [],
});

t("no muta lo que recibe: devuelve listas nuevas", () => {
  const previos = { cortes:[{id:"viejo"}], gastos:[], retiros:[], ignorados:[] };
  const r = S.construirImportacionCortes(
    _impBase([], [{ folio:"RCE-1", fecha:"2026-07-11", boletos25:100, contratistas:0, otrosIngresos:0, terminal:0 }]),
    previos, "Diana", 1000);
  assert.equal(previos.cortes.length, 1, "la lista original NO se toca");
  assert.equal(r.cortes.length, 2, "la nueva trae lo viejo mas lo importado");
  assert.equal(r.cortes[0].id, "viejo", "lo previo va primero y sobrevive");
});

t("clasifica cada egreso a su destino y cuenta bien", () => {
  const r = S.construirImportacionCortes(_impBase([
    { folio:"EGR-a", fecha:"2026-07-22", concepto:"COMPRA", monto:100, _clase:"gasto",   _cat:"Otro" },
    { folio:"EGR-b", fecha:"2026-07-22", concepto:"RETIRO", monto:200, _clase:"retiro" },
    { folio:"EGR-c", fecha:"2026-07-22", concepto:"YA ESTA",monto:300, _clase:"ignorar" },
  ]), _previosVacios(), "Diana", 1000);
  assert.equal(r.nG, 1); assert.equal(r.nR, 1); assert.equal(r.nI, 1);
  assert.equal(r.gastos[0]._folioEgreso, "EGR-a");
  assert.equal(r.retiros[0]._folioEgreso, "EGR-b");
  close(r.ignorados[0].monto, 300, 0.01);
  assert.equal(r.ignorados[0].por, "Diana", "queda quien lo excluyo");
});

t("un excluido que ya estaba no se duplica", () => {
  const r = S.construirImportacionCortes(
    _impBase([{ folio:"EGR-c", fecha:"2026-07-22", concepto:"X", monto:300, _clase:"ignorar" }]),
    { cortes:[], gastos:[], retiros:[], ignorados:["EGR-c"] }, "Diana", 1000);
  assert.equal(r.ignorados.length, 1, "sigue habiendo uno solo");
  assert.equal(r.nI, 0, "y no se cuenta como excluido nuevo");
});

t("un egreso sin folio se salta en vez de crear basura", () => {
  const r = S.construirImportacionCortes(
    _impBase([{ folio:"", fecha:"2026-07-22", concepto:"X", monto:300, _clase:"gasto", _cat:"Otro" }]),
    _previosVacios(), "Diana", 1000);
  assert.equal(r.nG, 0);
  assert.equal(r.gastos.length, 0);
});

t("los ids no chocan entre cortes, gastos y retiros", () => {
  const r = S.construirImportacionCortes(_impBase(
    [{ folio:"EGR-a", fecha:"2026-07-22", concepto:"A", monto:1, _clase:"gasto", _cat:"Otro" },
     { folio:"EGR-b", fecha:"2026-07-22", concepto:"B", monto:2, _clase:"retiro" }],
    [{ folio:"RCE-1", fecha:"2026-07-11", boletos25:1, contratistas:0, otrosIngresos:0, terminal:0 }]),
    _previosVacios(), "Diana", 1000);
  const ids = [...r.cortes, ...r.gastos, ...r.retiros].map(x=>x.id);
  assert.equal(new Set(ids).size, ids.length, "ids repetidos romperian el borrado y la fusion");
});

t("el saldo inicial se devuelve como dato, no se escribe", () => {
  const d = _impBase([]); d.obj.saldoInicial = -1500;   // un periodo puede abrir en rojo
  const r = S.construirImportacionCortes(d, _previosVacios(), "Diana", 1000);
  assert.equal(r.saldo.fecha, "2026-07-11");
  close(r.saldo.entrada.valor, -1500);
});
t("sin saldoInicial numerico no se inventa uno", () => {
  const d = _impBase([]); d.obj.saldoInicial = null;
  assert.equal(S.construirImportacionCortes(d, _previosVacios(), "Diana", 1000).saldo, null);
});

// LA prueba que importa: si truena, no debe quedar nada a medias.
t("si truena a media vuelta, NO deja una importacion parcial", () => {
  const previos = { cortes:[], gastos:[{ id:"g0", importe:99 }], retiros:[], ignorados:[] };
  const real = S.canonizarCategoria;
  let vueltas = 0;
  S.canonizarCategoria = (c) => { if(++vueltas === 3) throw new Error("categoria imposible"); return real(c); };
  try{
    const egresos = [1,2,3,4,5].map(i => (
      { folio:"EGR-"+i, fecha:"2026-07-22", concepto:"C"+i, monto:i*10, _clase:"gasto", _cat:"Otro" }));
    assert.throws(() => S.construirImportacionCortes(_impBase(egresos), previos, "Diana", 1000),
      /categoria imposible/);
    // Lo que el llamador ve: sus listas intactas. Los dos gastos que alcanzaron a construirse
    // vivian en el arreglo local, que se descarta con la excepcion.
    assert.equal(previos.gastos.length, 1, "no se colo ningun gasto a medias");
    assert.equal(previos.gastos[0].id, "g0");
    assert.equal(previos.cortes.length, 0);
    assert.equal(previos.ignorados.length, 0);
  } finally { S.canonizarCategoria = real; }
});

// ── Vincular una factura existente como pago de caja ────────────────────────
// El agujero: "ignorar" no crea gasto ni retiro Y no toca la factura que ya estaba. Si esa
// factura estaba como credito o transferencia, la salida de efectivo del concentrado no llegaba
// nunca a Caja —que solo suma esGastoEfectivo()— y el saldo quedaba inflado por esa cantidad, sin
// que nada en pantalla lo explicara. Vincular registra el hecho real: la factura no se duplica, y
// el efectivo que salio si cuenta.
const _egVinc = (folio, gastoDup, monto, fecha) => ({
  folio, fecha: fecha || "2026-08-20", concepto:"COMPRA SAMS", comprobante:"ICAJ-1",
  monto, _clase:"vincular_efectivo", _dup:{ gasto: gastoDup, reason:"Mismo No. de factura" },
});

t("vincular NO crea un gasto nuevo: devuelve un parche para el que ya existe", () => {
  const existente = { id:"g1", proveedor:"COMPRA SAMS", importe:3184, fecha:"2026-08-20", formaPago:"credito" };
  const r = S.construirImportacionCortes(
    _impBase([_egVinc("EGR-2026-00024", existente, 3184)]),
    { cortes:[], gastos:[existente], retiros:[], ignorados:[] }, "Diana", 1000);
  assert.equal(r.nG, 0, "no se crea un gasto: seria contar la factura dos veces");
  assert.equal(r.nV, 1);
  assert.equal(r.gastos.length, 1, "sigue habiendo una sola factura");
  assert.equal(r.vinculos.length, 1);
  const c = r.vinculos[0].cambios;
  assert.equal(r.vinculos[0].id, "g1");
  assert.equal(c.formaPagoFinal, "caja_cortes", "por fin cuenta como salida de efectivo");
  assert.equal(c.formaPagoAnterior, "credito", "queda de que forma de pago venia");
  assert.equal(c._folioEgreso, "EGR-2026-00024");
  close(c.montoCaja, 3184, 0.01);
});

t("vincular NO sobrescribe el importe fiscal de la factura", () => {
  // El ticket del SAMS del 6 de agosto salio de caja por 5,124.00 y la factura dice 5,073.99.
  // Las dos cifras son correctas. Pisar el importe para cuadrar la caja seria falsear el
  // comprobante ante el SAT; por eso el parche toca montoCaja y NO toca importe.
  const existente = { id:"g1", proveedor:"COMPRA SAMS", importe:5073.99, fecha:"2026-08-06" };
  const r = S.construirImportacionCortes(
    _impBase([_egVinc("EGR-9", existente, 5124, "2026-08-06")]),
    { cortes:[], gastos:[existente], retiros:[], ignorados:[] }, "Diana", 1000);
  const c = r.vinculos[0].cambios;
  assert.ok(!("importe" in c), "el importe fiscal no se toca NUNCA");
  close(c.montoCaja, 5124, 0.01);
  close(existente.importe, 5073.99, 0.01, "ni siquiera de rebote sobre el objeto original");
});

t("la factura a vincular puede estar en OTRA semana", () => {
  // Es el caso normal, no el raro: la factura entro por Gmail o por el SAT semanas antes, y las
  // semanas de esta app son bolsas de captura, no rangos de fecha. Buscarla solo en la semana que
  // se esta importando haria tronar casi todos los vinculos.
  const enOtraSemana = { id:"gX", proveedor:"COMPRA SAMS", importe:4801, fecha:"2026-08-25" };
  const r = S.construirImportacionCortes(
    _impBase([_egVinc("EGR-2026-00030", enOtraSemana, 4801, "2026-08-25")]),
    { cortes:[], gastos:[], retiros:[], ignorados:[], gastosTodos:[enOtraSemana] }, "Diana", 1000);
  assert.equal(r.nV, 1);
  assert.equal(r.vinculos[0].id, "gX");
  assert.equal(r.gastos.length, 0, "no se agrega nada a la semana activa");
});

t("si la factura a vincular no aparece, NO se importa nada", () => {
  assert.throws(() => S.construirImportacionCortes(
    _impBase([_egVinc("EGR-1", { id:"fantasma", importe:100 }, 100)]),
    _previosVacios(), "Diana", 1000), /No encontr./);
});

t("una factura no se puede vincular a dos folios distintos", () => {
  // Seria decir que la misma factura se pago dos veces desde la caja.
  const ya = { id:"g1", proveedor:"X", importe:100, fecha:"2026-08-20", _folioEgreso:"EGR-VIEJO" };
  assert.throws(() => S.construirImportacionCortes(
    _impBase([_egVinc("EGR-NUEVO", ya, 100)]),
    { cortes:[], gastos:[ya], retiros:[], ignorados:[] }, "Diana", 1000), /EGR-VIEJO/);
});

t("dos egresos del mismo archivo no pueden vincularse a la misma factura", () => {
  const g = { id:"g1", proveedor:"X", importe:100, fecha:"2026-08-20" };
  assert.throws(() => S.construirImportacionCortes(
    _impBase([_egVinc("EGR-1", g, 100), _egVinc("EGR-2", g, 100)]),
    { cortes:[], gastos:[g], retiros:[], ignorados:[] }, "Diana", 1000), /misma factura/);
});

t("los gastos se CLONAN: vincular no escribe en el estado antes de confirmar", () => {
  // [...gastos] copia el arreglo pero comparte los objetos. En el momento en que la funcion
  // modifica uno estaria escribiendo en week.gastos sin que nadie haya confirmado nada, y un
  // error a media vuelta dejaria media importacion aplicada.
  const original = { id:"g1", proveedor:"X", importe:100, fecha:"2026-08-20", formaPago:"credito" };
  const r = S.construirImportacionCortes(
    _impBase([{ folio:"EGR-a", fecha:"2026-08-20", concepto:"NUEVO", monto:5, _clase:"gasto", _cat:"Otro" }]),
    { cortes:[], gastos:[original], retiros:[], ignorados:[] }, "Diana", 1000);
  assert.notStrictEqual(r.gastos[0], original, "el objeto devuelto NO puede ser el mismo de la semana");
  r.gastos[0].formaPago = "efectivo";
  assert.equal(original.formaPago, "credito", "tocar la copia no puede alterar el estado real");
});

t("reclasificar un folio excluido lo SACA de la lista de excluidos", () => {
  // Si no, el mismo movimiento sale contado como gasto real Y listado como egreso excluido: el
  // reporte se contradice a si mismo y nadie sabe cual de los dos creer.
  const previos = { cortes:[], gastos:[], retiros:[],
    ignorados:[{ folio:"EGR-c", monto:300, concepto:"X", ts:"2026-08-01" }] };
  const r = S.construirImportacionCortes(
    _impBase([{ folio:"EGR-c", fecha:"2026-08-20", concepto:"X", monto:300, _clase:"gasto", _cat:"Otro" }]),
    previos, "Diana", 1000);
  assert.equal(r.nG, 1);
  assert.equal(r.ignorados.length, 0, "ya no es un excluido: ahora es un gasto de verdad");
});

t("vincular un folio que estaba excluido tambien lo saca de la lista", () => {
  const g = { id:"g1", proveedor:"X", importe:100, fecha:"2026-08-20" };
  const previos = { cortes:[], gastos:[g], retiros:[], ignorados:["EGR-1"] };
  const r = S.construirImportacionCortes(_impBase([_egVinc("EGR-1", g, 100)]), previos, "Diana", 1000);
  assert.equal(r.nV, 1);
  assert.equal(r.ignorados.length, 0);
});

// ── Cobertura: saber que FALTA un periodo, no solo que no cuadra ────────────
// El caso que lo motiva: agosto 2026. Estaban los cortes del 3 al 9 y los del 19 al 25, faltaban
// nueve dias por $150,164.00, y el reporte no dijo nada — cuadraba consigo mismo porque nunca
// supo que ese tramo debia existir. La deduplicacion es por folio: un folio que jamas llego no se
// puede detectar por su ausencia.
console.log("\n== 'diferencia de monto' que en realidad es la misma factura dos veces ==");
// Siete renglones en pantalla con el Monto CICSA EXACTAMENTE al doble del Total SAT. No es que
// el proveedor haya facturado otra cosa: es una factura dividida cuyo padre y cuyas categorias
// sueltas siguen guardados los dos. Como la tabla no ensenaba el folio, se leia como un problema
// del comprobante —que esta bien— en vez de uno de la captura.
const _dif = (total, gastos, cfdiExtra) => ({
  cfdi:{ total, fecha:"2026-07-06", proveedor:"ONUS COMERCIAL",
         uuid:"UUID-1", folio:"UUID-1", serie:"", folioComp:"F-1", ...(cfdiExtra||{}) },
  gastos, capturado: Math.round(gastos.reduce((s,g)=>s+g.importe,0)*100)/100,
});

t("EL caso: padre Dividida + sus categorias sueltas dan el doble exacto", () => {
  const d = _dif(34034.36, [
    { id:"p", proveedor:"ONUS COMERCIAL", factura:"A-1201", fecha:"2026-07-06", importe:34034.36, categoria:"Dividida",
      _partidas:[{categoria:"Carnicos",importe:20000},{categoria:"Abarrotes",importe:14034.36}] },
    { id:"h1", proveedor:"ONUS COMERCIAL", factura:"A-1201", fecha:"2026-07-06", importe:20000, categoria:"Carnicos" },
    { id:"h2", proveedor:"ONUS COMERCIAL", factura:"A-1201", fecha:"2026-07-06", importe:14034.36, categoria:"Abarrotes" },
  ], { folioComp:"A-1201" });
  const c = S.clasificarDiferenciaSAT(d);
  assert.equal(c.tipo, "duplicado", "no es una diferencia contra el SAT");
  assert.ok(/dividida/i.test(c.motivo), "y se dice por que");
  close(c.excedente, 34034.36, 0.01, "lo contado de mas es exactamente un comprobante");
  assert.equal(c.uniforme, true, "proveedor y folio identicos: se puede consolidar de un boton");
});

t("la misma factura capturada dos veces, sin division, tambien", () => {
  const d = _dif(2504, [
    { id:"a", proveedor:"NUEVA WAL MART DE MEXICO", factura:"WM-88", fecha:"2026-07-07", importe:2504, categoria:"Abarrotes" },
    { id:"b", proveedor:"NUEVA WAL MART DE MEXICO", factura:"WM-88", fecha:"2026-07-07", importe:2504, categoria:"Abarrotes" },
  ], { folioComp:"WM-88" });
  const c = S.clasificarDiferenciaSAT(d);
  assert.equal(c.tipo, "duplicado");
  assert.equal(c.exacto, true);
  assert.ok(/2 veces/.test(c.motivo));
});

t("si el FOLIO no coincide, sigue siendo una diferencia de verdad", () => {
  // Dos facturas distintas del mismo proveedor y dia existen. Sin folio igual no se puede
  // afirmar que sean la misma, y afirmarlo escondería una diferencia real.
  const c = S.clasificarDiferenciaSAT(_dif(1000, [
    { id:"a", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:1000 },
    { id:"b", proveedor:"X", factura:"F-2", fecha:"2026-07-06", importe:1000 },
  ]));
  assert.equal(c.tipo, "diferencia");
});
t("dos fechas distintas NO impiden reconocerlo: el folio ya identifica el documento", () => {
  // Al exigir tambien la fecha se escapaban justo los casos reales — la misma factura capturada
  // dos veces suele traer dos fechas (una tecleada mal, o la del ticket contra la del timbrado).
  // Con proveedor y folio no hacen falta mas senias: no existen dos facturas del mismo proveedor
  // con el mismo folio.
  const c = S.clasificarDiferenciaSAT(_dif(1000, [
    { id:"a", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:1000 },
    { id:"b", proveedor:"X", factura:"F-1", fecha:"2026-07-09", importe:1020 },
  ]));
  assert.equal(c.tipo, "duplicado");
  close(c.excedente, 1020, 0.01, "importes distintos entre las dos capturas, y aun asi es la misma");
});
t("con el folio IDENTICO, el nombre del proveedor ya no hace falta que empate", () => {
  // Es la otra forma en que se duplica: la misma factura capturada una vez con el nombre fiscal
  // ("NUEVA WAL-MART DE MEXICO") y otra con el del ticket ("COMPRA SAMS"). Exigir que los nombres
  // se parecieran dejaba fuera justo eso. El folio de una factura ya identifica el documento.
  const c = S.clasificarDiferenciaSAT(_dif(2456, [
    { id:"a", proveedor:"NUEVA WAL MART DE MEXICO", factura:"ICAJG468220", fecha:"2026-07-24", importe:2456 },
    { id:"b", proveedor:"COMPRA SAMS", factura:"ICAJG468220", fecha:"2026-07-25", importe:2476 },
  ], { folioComp:"ICAJG468220", proveedor:"NUEVA WAL MART DE MEXICO" }));
  assert.equal(c.tipo, "duplicado");
  close(c.excedente, 2476, 0.01);
});
t("pero si el folio solo coincide por TERMINACION, el proveedor sigue pesando", () => {
  // "7213" contra "POSM13847213" es una coincidencia debil: un folio corto puede casar de
  // casualidad entre proveedores distintos, y ahi si hay que pedir mas senias.
  const c = S.clasificarDiferenciaSAT(_dif(1000, [
    { id:"a", proveedor:"OFFICE DEPOT DE MEXICO", factura:"POSM13847213", fecha:"2026-07-15", importe:1000 },
    { id:"b", proveedor:"UN PROVEEDOR SIN RELACION", factura:"7213", fecha:"2026-07-15", importe:1000 },
  ], { folioComp:"POSM13847213", proveedor:"OFFICE DEPOT DE MEXICO" }));
  assert.equal(c.tipo, "diferencia");
  assert.ok(/terminaci/i.test(c.motivo), "y se dice por que no se agrupo");
});
t("un renglon sin folio nunca se agrupa como duplicado", () => {
  // Sin folio no hay con que afirmar que sean la misma factura.
  const c = S.clasificarDiferenciaSAT(_dif(1000, [
    { id:"a", proveedor:"X", factura:"", fecha:"2026-07-06", importe:1000 },
    { id:"b", proveedor:"X", factura:"", fecha:"2026-07-06", importe:1000 },
  ]));
  assert.equal(c.tipo, "diferencia");
});

t("un SOLO gasto con importe distinto es una diferencia real, no un duplicado", () => {
  // Es un dedo en el monto: hay que ir al comprobante.
  const c = S.clasificarDiferenciaSAT(_dif(1000, [
    { id:"a", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:1500 },
  ]));
  assert.equal(c.tipo, "diferencia");
});

t("capturado POR DEBAJO del comprobante NO es contado de mas: falta un pedazo", () => {
  // Ahi el reporte esta corto, no inflado, y esconderlo dejaria dinero sin capturar.
  const c = S.clasificarDiferenciaSAT(_dif(10000, [
    { id:"a", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:4000, categoria:"Carnicos" },
    { id:"b", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:3000, categoria:"Abarrotes" },
  ]));
  assert.equal(c.tipo, "diferencia");
});

t("folio equivalente pero tecleado distinto: es duplicado, pero NO consolidable de un boton", () => {
  // consolidarFacturaDividida() fusiona por proveedor y folio EXACTOS; con folios equivalentes
  // no encontraria el grupo y diria "ya no hay duplicados". Ofrecer el boton seria mentir.
  const c = S.clasificarDiferenciaSAT(_dif(5000, [
    { id:"a", proveedor:"POLLO BAL", factura:"PBAL31598", fecha:"2026-07-06", importe:5000 },
    { id:"b", proveedor:"POLLO BAL", factura:"31598", fecha:"2026-07-06", importe:5000 },
  ], { folioComp:"PBAL31598", proveedor:"POLLO BAL" }));
  assert.equal(c.tipo, "duplicado");
  assert.equal(c.uniforme, false);
});

t("un registro con el UUID en el campo Factura sigue siendo la misma factura", () => {
  // Es el caso de cuatro de los siete renglones reportados: capturar desde la conciliacion metia
  // el UUID en "Factura", asi que el registro del folio y el del UUID no se parecian en nada
  // aunque fueran el mismo comprobante, y el grupo se leia como diferencia de monto.
  const c = S.clasificarDiferenciaSAT(_dif(2504, [
    { id:"a", proveedor:"NUEVA WAL MART", factura:"IBAGY272188", fecha:"2026-07-07", importe:2504 },
    { id:"b", proveedor:"NUEVA WAL MART", factura:"859B4C9E-3598-4ABC-A0C5-84E40EF675DA", fecha:"2026-07-07", importe:2504 },
  ], { uuid:"859B4C9E-3598-4ABC-A0C5-84E40EF675DA", folio:"859B4C9E-3598-4ABC-A0C5-84E40EF675DA", folioComp:"IBAGY272188" }));
  assert.equal(c.tipo, "duplicado");
  assert.equal(c.uniforme, false, "los folios se tecleron distinto: consolidar de un boton no funcionaria");
});

t("un registro ligado por cfdiUuid cuenta aunque no tenga folio", () => {
  const c = S.clasificarDiferenciaSAT(_dif(1000, [
    { id:"a", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:1000 },
    { id:"b", proveedor:"X", factura:"", cfdiUuid:"UUID-1", fecha:"2026-07-06", importe:1000 },
  ]));
  assert.equal(c.tipo, "duplicado");
});

t("cuando NO se agrupa, se dice por que", () => {
  // Tres renglones con el folio identico en pantalla seguian saliendo como diferencia de monto y
  // no habia forma de saber que los separaba sin abrir los datos a mano. Ahora el motivo viaja
  // con el resultado y se imprime en la tabla.
  const sinFolio = S.clasificarDiferenciaSAT(_dif(2456, [
    { id:"a", proveedor:"NUEVA WAL MART", factura:"ICAJG468220", fecha:"2026-07-24", importe:2456 },
    { id:"b", proveedor:"NUEVA WAL MART", factura:"", fecha:"2026-07-24", importe:2476 },
  ], { folioComp:"ICAJG468220" }));
  assert.equal(sinFolio.tipo, "diferencia");
  assert.ok(/no trae folio ni UUID/.test(sinFolio.motivo));
  assert.equal(sinFolio.nGastos, 2);

  const otroFolio = S.clasificarDiferenciaSAT(_dif(1000, [
    { id:"a", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:1000 },
    { id:"b", proveedor:"X", factura:"NADA-QUE-VER", fecha:"2026-07-06", importe:1000 },
  ]));
  assert.ok(/no corresponde al del comprobante/.test(otroFolio.motivo));
});

t("varios registros del mismo comprobante que suman DE MENOS: falta capturar una parte", () => {
  const c = S.clasificarDiferenciaSAT(_dif(10000, [
    { id:"a", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:4000, categoria:"Carnicos" },
    { id:"b", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:3000, categoria:"Abarrotes" },
  ]));
  assert.equal(c.tipo, "diferencia");
  assert.ok(/falta capturar una parte/.test(c.motivo), "no es contado de mas: es contado de menos");
});

t("un grupo pegado solo por el MONTO no se declara duplicado", () => {
  // conciliarSAT tambien empareja por importe y fecha cercana. Dos compras distintas del mismo
  // dia por el mismo monto existen; llamarlas "la misma factura" seria inventar.
  const c = S.clasificarDiferenciaSAT(_dif(1000, [
    { id:"a", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:1000 },
    { id:"b", proveedor:"X", factura:"OTRA-999", fecha:"2026-07-06", importe:1000 },
  ]));
  assert.equal(c.tipo, "diferencia");
});

t("si el CFDI no trae folio legible, no se puede afirmar nada", () => {
  // Solo con UUID y sin cfdiUuid en los gastos no hay con que ligarlos.
  const c = S.clasificarDiferenciaSAT(_dif(1000, [
    { id:"a", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:1000 },
    { id:"b", proveedor:"X", factura:"F-1", fecha:"2026-07-06", importe:1000 },
  ], { folioComp:"", folio:"8148F7B7-2BAF-4EF9-960C-83A293EEA460", uuid:"8148F7B7-2BAF-4EF9-960C-83A293EEA460" }));
  assert.equal(c.tipo, "diferencia");
});

console.log("\n== capturar desde la conciliacion: el folio de la FACTURA, no el UUID ==");
t("folioCapturableCfdi devuelve serie+folio, no el UUID", () => {
  assert.equal(S.folioCapturableCfdi({ serie:"A", folioComp:"1201", uuid:"U", folio:"U" }), "A1201");
  assert.equal(S.folioCapturableCfdi({ serie:"", folioComp:"ICAJG468220" }), "ICAJG468220");
});
t("si SOLO hay UUID, el campo queda vacio", () => {
  // Mejor en blanco que con un identificador que nadie lee en el papel y que ademas rompe el
  // cruce con los demas registros del mismo comprobante.
  assert.equal(S.folioCapturableCfdi({ folio:"8148F7B7-2BAF-4EF9-960C-83A293EEA460" }), "");
  assert.equal(S.folioCapturableCfdi({}), "");
  assert.equal(S.folioCapturableCfdi(null), "");
});
t("un folio no-UUID en el campo folio si se usa", () => {
  assert.equal(S.folioCapturableCfdi({ folio:"POSM13847213" }), "POSM13847213");
});
t("el boton Capturar de la conciliacion ya no manda el UUID", () => {
  // Guardia sobre el codigo fuente: el bug no estaba en una funcion, estaba en el cableado.
  // El onclick lleva comillas dobles adentro (dentro de las plantillas), asi que no se puede
  // recortar con [^"]*: se toma un tramo fijo desde la llamada.
  const i = script.indexOf("onclick=\"preLlenarCaptura(");
  assert.ok(i > -1, "no encontre el boton Capturar");
  const m = script.slice(i, i + 260);
  assert.ok(m.includes("folioCapturableCfdi"), "tiene que pasar el folio de la factura");
  assert.ok(!m.includes("escAttrJs(c.folio||\"\")"), "c.folio es el UUID: no puede ir al campo Factura");
});

t("conciliarSAT los saca de diferencias y los pone en duplicados", () => {
  // La prueba de integracion: la tabla de "Diferencias de monto" deja de acusar al comprobante.
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"p",  proveedor:"ONUS COMERCIAL", factura:"A-1201", fecha:"2026-07-06", importe:34034.36, categoria:"Dividida",
      _partidas:[{categoria:"Carnicos",importe:34034.36}] },
    { id:"h1", proveedor:"ONUS COMERCIAL", factura:"A-1201", fecha:"2026-07-06", importe:34034.36, categoria:"Carnicos" },
  ]}]};
  const r = S.conciliarSAT([
    { uuid:"U-1", folio:"U-1", serie:"A-", folioComp:"1201", rfc:"AAA010101AAA",
      proveedor:"ONUS COMERCIAL", fecha:"2026-07-06", total:34034.36, receptorRfc:"XAXX010101000" }
  ], "2026-07-01", "2026-07-31", "XAXX010101000");
  assert.equal(r.diferencias.length, 0, "ya no acusa al comprobante");
  assert.equal(r.duplicados.length, 1, "lo reporta como lo que es: contado de mas");
  close(r.duplicados[0].clase.excedente, 34034.36, 0.01);
});

t("una diferencia de monto de verdad SIGUE saliendo en diferencias", () => {
  // El riesgo de esta reclasificacion es tragarse las diferencias reales. No se traga ninguna.
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"g1", proveedor:"ONUS COMERCIAL", factura:"A-1201", fecha:"2026-07-06", importe:20000, categoria:"Carnicos" },
  ]}]};
  const r = S.conciliarSAT([
    { uuid:"U-1", folio:"U-1", serie:"A-", folioComp:"1201", rfc:"AAA010101AAA",
      proveedor:"ONUS COMERCIAL", fecha:"2026-07-06", total:34034.36, receptorRfc:"XAXX010101000" }
  ], "2026-07-01", "2026-07-31", "XAXX010101000");
  assert.equal(r.duplicados.length, 0);
  assert.equal(r.diferencias.length, 1);
  close(r.diferencias[0].diferencia, 14034.36, 0.01);
});

console.log("\n== cobertura de periodos: el hueco que nadie avisaba ==");

const _M = (ini, fin, extra) => ({ ini, fin, emitido:(extra&&extra.emitido)||"", ...(extra||{}) });

t("_sumarDiaISO cruza fin de mes, fin de anio y bisiesto sin pasar por UTC", () => {
  assert.equal(S._sumarDiaISO("2026-08-31", 1), "2026-09-01");
  assert.equal(S._sumarDiaISO("2026-12-31", 1), "2027-01-01");
  assert.equal(S._sumarDiaISO("2028-02-28", 1), "2028-02-29", "2028 es bisiesto");
  assert.equal(S._sumarDiaISO("2026-08-01", -1), "2026-07-31");
  assert.equal(S._sumarDiaISO("no es fecha", 1), "");
});
t("_sumarDiaISO no usa toISOString: guardia sobre el codigo fuente", () => {
  // toISOString() convierte a UTC. Con la fecha anclada al mediodia local funciona en Mexico
  // (UTC-6), asi que una prueba de comportamiento aqui NO caza el error: solo se rompe en zonas
  // horarias adelantadas, donde devuelve el dia de al lado y la cobertura corre un dia. Un dia
  // corrido acusa un hueco falso, o peor, tapa uno real. Se vigila de forma textual.
  const m = script.match(/function _sumarDiaISO\(fecha, dias\)\{[\s\S]*?\n\}/);
  assert.ok(m, "no encontre _sumarDiaISO");
  assert.ok(!m[0].includes("toISOString"), "volvio a UTC: la cobertura se corre un dia");
  assert.ok(/getFullYear|fechaLocalStr/.test(m[0]), "tiene que armar la fecha con los getters locales");
});

t("EL caso: importar 3-9 y 19-25 delata el hueco del 10 al 18", () => {
  const c = S.coberturaDePeriodos("2026-08-03", "2026-08-25",
    [_M("2026-08-03","2026-08-09"), _M("2026-08-19","2026-08-25")]);
  assert.equal(c.cubierto, false);
  assert.equal(c.dias.length, 9, "nueve dias sin importar");
  assert.equal(c.tramos.length, 1, "consecutivos: un solo tramo, no nueve renglones");
  assert.equal(c.tramos[0].ini, "2026-08-10");
  assert.equal(c.tramos[0].fin, "2026-08-18");
});

t("al importar el tramo que faltaba, la cobertura queda completa", () => {
  const c = S.coberturaDePeriodos("2026-08-03", "2026-08-25",
    [_M("2026-08-03","2026-08-09"), _M("2026-08-10","2026-08-18"), _M("2026-08-19","2026-08-25")]);
  assert.equal(c.cubierto, true);
  assert.equal(c.dias.length, 0);
});

t("huecos separados salen como tramos separados", () => {
  const c = S.coberturaDePeriodos("2026-08-01", "2026-08-10",
    [_M("2026-08-03","2026-08-05"), _M("2026-08-08","2026-08-09")]);
  assert.deepEqual(c.tramos.map(t=>[t.ini,t.fin,t.dias]),
    [["2026-08-01","2026-08-02",2], ["2026-08-06","2026-08-07",2], ["2026-08-10","2026-08-10",1]]);
});

t("periodos traslapados no inventan huecos", () => {
  const c = S.coberturaDePeriodos("2026-08-01", "2026-08-20",
    [_M("2026-08-01","2026-08-12"), _M("2026-08-10","2026-08-20")]);
  assert.equal(c.cubierto, true);
});

t("un periodo mas amplio que lo consultado cubre de sobra", () => {
  const c = S.coberturaDePeriodos("2026-08-05", "2026-08-06", [_M("2026-07-01","2026-09-30")]);
  assert.equal(c.cubierto, true);
});

t("sin NINGUNA constancia no se acusa de un hueco: se dice que no hay con que comprobar", () => {
  // Quien ya venia usando la app importo sin dejar constancia. Reportar "faltan 30 dias" seria
  // mentir con la misma seguridad con la que antes se callaba.
  const c = S.coberturaDePeriodos("2026-08-03", "2026-08-25", []);
  assert.equal(c.sinRegistro, true);
  assert.equal(c.cubierto, false, "tampoco se declara cubierto: no se sabe");
  assert.equal(c.dias.length, 0, "y no se listan dias que nadie puede confirmar");
});

t("un rango absurdo no cuelga la pestania", () => {
  const c = S.coberturaDePeriodos("1990-01-01", "2090-01-01", [_M("2026-08-01","2026-08-02")]);
  // El const se declara DENTRO del contexto del vm, asi que es un binding lexico y no una
  // propiedad del sandbox: S._COBERTURA_MAX_DIAS seria undefined, y `n <= undefined` es false.
  const tope = vm.runInContext("_COBERTURA_MAX_DIAS", sandbox);
  assert.ok(tope > 0, "el tope tiene que existir de verdad, no llegar como undefined");
  assert.ok(c.dias.length <= tope);
});

t("los manifiestos con fechas invalidas se ignoran, no tumban el calculo", () => {
  const c = S.coberturaDePeriodos("2026-08-01", "2026-08-02", [null, {}, _M("","2026-08-02"), _M("2026-08-01","2026-08-02")]);
  assert.equal(c.cubierto, true);
  assert.equal(c.nManifiestos, 1);
});

console.log("\n== bitacora de importaciones: idempotente y compartida ==");
t("el manifiesto guarda los totales que DECLARA el archivo", () => {
  const m = S.manifiestoDeImportacion({ periodo:{ini:"2026-08-19",fin:"2026-08-25"}, emitido:"2026-08-26",
    version:3, saldoInicial:-24.37, cortes:[1,2], egresos:[1], totales:{ efectivo:119425.5, efectivoAEntregar:12284.22 } }, "Diana", "T1");
  assert.equal(m.ini, "2026-08-19"); assert.equal(m.cortes, 2); assert.equal(m.egresos, 1);
  close(m.saldoInicial, -24.37, 0.01);
  close(m.totales.efectivoAEntregar, 12284.22, 0.01, "es el dato del archivo, para poder compararlo despues");
  assert.equal(m.importadoPor, "Diana");
});
t("reimportar EL MISMO archivo no agrega otro renglon", () => {
  const m = _M("2026-08-19","2026-08-25",{emitido:"2026-08-26"});
  const l1 = S.agregarManifiesto([], m);
  const l2 = S.agregarManifiesto(l1, { ...m });
  assert.equal(l1.length, 1); assert.equal(l2.length, 1);
});
t("volver a exportar el mismo periodo SI deja constancia aparte", () => {
  // Es otro archivo. La trazabilidad pide saber cual de los dos se uso.
  const l = S.agregarManifiesto(
    S.agregarManifiesto([], _M("2026-08-19","2026-08-25",{emitido:"2026-08-26"})),
    _M("2026-08-19","2026-08-25",{emitido:"2026-08-28"}));
  assert.equal(l.length, 2);
});
t("un manifiesto sin periodo no entra a la bitacora", () => {
  assert.equal(S.agregarManifiesto([], { ini:"", fin:"" }).length, 0);
});
t("los manifiestos se UNEN entre dispositivos y salen ordenados", () => {
  // Si una companiera importo un periodo desde su equipo y aqui no esta su constancia, la app
  // reportaria un hueco que no existe.
  const u = S._unirManifiestos([_M("2026-08-19","2026-08-25")], [_M("2026-08-03","2026-08-09"), _M("2026-08-19","2026-08-25")]);
  assert.equal(u.length, 2, "el repetido no se duplica");
  assert.equal(u[0].ini, "2026-08-03", "y quedan en orden de fecha");
});
t("mergeEstados conserva las constancias de los dos dispositivos", () => {
  const r = S.mergeEstados(
    { weeks:[], cortesImportaciones:[_M("2026-08-03","2026-08-09")] },
    { weeks:[], cortesImportaciones:[_M("2026-08-19","2026-08-25")] });
  assert.equal(r.cortesImportaciones.length, 2);
});

console.log("\n== lo que declaran los archivos vs. lo que tiene Egresos ==");
// Hasta aqui Egresos solo podia cuadrar consigo mismo, y cuadrar consigo mismo es lo que hace un
// sistema aunque le falte medio mes. Esta es la otra mitad de la conciliacion.
const _MT = (ini, fin, tot, extra) => ({ ini, fin, emitido:"", totales:tot||{}, ...(extra||{}) });

t("un solo archivo que cubre el periodo exacto SI es comparable", () => {
  const d = S.totalesDeclarados("2026-08-19", "2026-08-25",
    [_MT("2026-08-19","2026-08-25",{ efectivo:119425.5, egresos:107116.91, aportaciones:0 }, { saldoInicial:-24.37 })]);
  assert.equal(d.comparable, true);
  close(d.efectivo, 119425.5, 0.01);
  close(d.saldoInicial, -24.37, 0.01);
});

t("dos archivos pegados suman, y el saldo inicial es el del PRIMERO", () => {
  // Los saldos iniciales de en medio son arrastre interno: sumarlos contaria el mismo dinero dos
  // veces. Solo cuenta con cuanto abrio el tramo completo.
  const d = S.totalesDeclarados("2026-08-19", "2026-08-25", [
    _MT("2026-08-22","2026-08-25",{ efectivo:60000, egresos:50000 }, { saldoInicial:-696.28 }),
    _MT("2026-08-19","2026-08-21",{ efectivo:59425.5, egresos:57116.91 }, { saldoInicial:-24.37 }),
  ]);
  assert.equal(d.comparable, true);
  assert.equal(d.nArchivos, 2);
  close(d.efectivo, 119425.5, 0.01);
  close(d.saldoInicial, -24.37, 0.01, "el del 19, no el del 22");
});

t("con un hueco en medio NO es comparable", () => {
  // Comparar contra una suma parcial daria una diferencia que parece un descuadre y es un
  // artefacto del recorte. Una diferencia falsa erosiona la confianza en las verdaderas.
  const d = S.totalesDeclarados("2026-08-03", "2026-08-25", [
    _MT("2026-08-03","2026-08-09",{ efectivo:100 }),
    _MT("2026-08-19","2026-08-25",{ efectivo:200 }),
  ]);
  assert.equal(d.comparable, false);
});

t("si los archivos no empiezan o no terminan donde el periodo, tampoco", () => {
  assert.equal(S.totalesDeclarados("2026-08-01","2026-08-25",[_MT("2026-08-03","2026-08-25",{})]).comparable, false);
  assert.equal(S.totalesDeclarados("2026-08-03","2026-08-31",[_MT("2026-08-03","2026-08-25",{})]).comparable, false);
});

t("un archivo que se sale del periodo consultado ni se considera", () => {
  const d = S.totalesDeclarados("2026-08-03", "2026-08-09", [_MT("2026-07-01","2026-09-30",{ efectivo:999999 })]);
  assert.equal(d.comparable, false);
  assert.equal(d.nArchivos, 0);
});

t("sin archivos no se inventa una comparacion", () => {
  assert.equal(S.totalesDeclarados("2026-08-03","2026-08-09",[]).comparable, false);
  assert.equal(S.totalesDeclarados("", "", [_MT("2026-08-03","2026-08-09",{})]).comparable, false);
});

console.log("\n== el veredicto: CONCILIADO no se dice a la ligera ==");
// La pantalla y el PDF salen de esta misma funcion. Que pudieran decir cosas distintas del mismo
// periodo era el problema de fondo: se firma lo que dice el PDF y se decide con la pantalla.
const _CUB = { cubierto:true, sinRegistro:false, dias:[], tramos:[], nManifiestos:1 };

t("todo en orden: CONCILIADO", () => {
  const v = S.estadoConciliacionCaja({ cobertura:_CUB, rupturas:[], excluidos:[], diferencia:0 });
  assert.equal(v.estado, "CONCILIADO");
  assert.equal(v.conciliado, true);
  assert.equal(v.motivos.length, 0);
});

t("faltan dias: INCOMPLETO, y se dice cuales", () => {
  const v = S.estadoConciliacionCaja({
    cobertura:{ cubierto:false, sinRegistro:false, dias:["2026-08-10"], tramos:[{ini:"2026-08-10",fin:"2026-08-18",dias:9}] },
    rupturas:[], excluidos:[], diferencia:0 });
  assert.equal(v.estado, "INCOMPLETO");
  assert.ok(/2026-08-10 a 2026-08-18/.test(v.motivos[0].texto));
});

t("sin constancia de importaciones tampoco se declara conciliado", () => {
  const v = S.estadoConciliacionCaja({ cobertura:{ sinRegistro:true }, rupturas:[], excluidos:[], diferencia:0 });
  assert.equal(v.estado, "INCOMPLETO");
});

t("una exclusion sin resolver impide el verde", () => {
  // "Ignorar" no puede significar que el dinero desaparece. Mientras haya un egreso excluido sin
  // vincular ni corregir en el origen, el periodo no esta conciliado.
  const v = S.estadoConciliacionCaja({ cobertura:_CUB, rupturas:[],
    excluidos:[{ folio:"EGR-1", monto:3184 }], diferencia:0 });
  assert.equal(v.estado, "CON DIFERENCIAS");
  assert.ok(/3184/.test(v.motivos[0].texto), "con su monto, no solo el conteo");
});

t("un centavo de diferencia basta para que NO este conciliado", () => {
  const v = S.estadoConciliacionCaja({ cobertura:_CUB, rupturas:[], excluidos:[], diferencia:0.01 });
  assert.equal(v.estado, "CON DIFERENCIAS");
});
t("medio centavo es redondeo y no rompe nada", () => {
  assert.equal(S.estadoConciliacionCaja({ cobertura:_CUB, rupturas:[], excluidos:[], diferencia:0.004 }).estado, "CONCILIADO");
});
t("sin diferencia calculable no se inventa un motivo", () => {
  // Cuando no hay con que comparar, la ausencia de comparacion no es un descuadre.
  assert.equal(S.estadoConciliacionCaja({ cobertura:_CUB, rupturas:[], excluidos:[], diferencia:null }).estado, "CONCILIADO");
});

t("la falta de cobertura pesa mas que las diferencias", () => {
  // Un periodo al que le faltan dias no es "un periodo con diferencias": es un periodo incompleto,
  // y ponerle la misma etiqueta invita a cerrarlo como si solo hubiera que ajustar unos pesos.
  const v = S.estadoConciliacionCaja({
    cobertura:{ cubierto:false, sinRegistro:false, dias:["2026-08-10"], tramos:[{ini:"2026-08-10",fin:"2026-08-10",dias:1}] },
    rupturas:[{}], excluidos:[{ folio:"x", monto:1 }], diferencia:500 });
  assert.equal(v.estado, "INCOMPLETO");
  assert.equal(v.motivos.length, 4, "pero se listan TODOS los motivos, no solo el peor");
});

console.log("\n== aportaciones: dinero que ENTRA a la caja ==");
t("las aportaciones suman al saldo del periodo", () => {
  // Antes solo se avisaba de ellas, y un aviso no suma: el saldo salia corto por esa cantidad.
  S.state = { budget:{}, weeks:[{ id:"w1", retiros:[], gastos:[],
    cortes:[{ id:"c1", fecha:"2026-08-06", monto:10000 }],
    aportaciones:[{ id:"a1", fecha:"2026-08-07", monto:2500, concepto:"Fondeo" }] }],
    cajaSaldoInicial:{ "2026-08-01": { valor:0 } } };
  const r = S.calcularSaldoCajaPeriodo("2026-08-01", "2026-08-31");
  close(r.totalAport, 2500, 0.01);
  close(r.saldo, 12500, 0.01);
});
t("una aportacion fuera del periodo no se cuela", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", retiros:[], gastos:[], cortes:[],
    aportaciones:[{ id:"a1", fecha:"2026-09-15", monto:2500 }] }],
    cajaSaldoInicial:{ "2026-08-01": { valor:0 } } };
  close(S.calcularSaldoCajaPeriodo("2026-08-01","2026-08-31").saldo, 0, 0.01);
});
t("las aportaciones anteriores al periodo entran al arrastre", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", retiros:[], gastos:[], cortes:[],
    aportaciones:[{ id:"a1", fecha:"2026-07-15", monto:800 }] }] };
  close(S.calcularSaldoAntesDe("2026-08-01").saldo, 800, 0.01);
});
t("importar aportaciones: entran con su folio y son idempotentes", () => {
  const d = _impBase([]);
  d.aportNuevas = [{ folio:"APO-1", fecha:"2026-07-20", monto:1500, concepto:"Reposicion de fondo" }];
  const r = S.construirImportacionCortes(d, _previosVacios(), "Diana", 1000);
  assert.equal(r.nA, 1);
  assert.equal(r.aportaciones[0]._folioAportacion, "APO-1");
  close(r.aportaciones[0].monto, 1500, 0.01);
});

console.log("\n== cadena de saldos entre archivos ==");
// Cada archivo cuadra consigo mismo. Una fuga ENTRE dos archivos no la ve ninguno de los dos.
t("lo que un periodo deja a entregar tiene que ser con lo que abre el siguiente", () => {
  const v = S.validarCadenaPeriodos(
    { totales:{ efectivoAEntregar:-696.28 } }, { saldoInicial:-696.28 });
  assert.equal(v.ok, true);
  close(v.diferencia, 0, 0.001);
});
t("una diferencia de un peso rompe la cadena", () => {
  const v = S.validarCadenaPeriodos({ totales:{ efectivoAEntregar:1000 } }, { saldoInicial:999 });
  assert.equal(v.ok, false);
  close(v.diferencia, -1, 0.001);
});
t("sin los saldos no se declara ok: se dice que faltan datos", () => {
  const v = S.validarCadenaPeriodos({ totales:{} }, { saldoInicial:100 });
  assert.equal(v.ok, false);
  assert.equal(v.sinDatos, true, "faltar datos no es lo mismo que estar mal");
});
t("rupturasDeCadena solo revisa archivos CONSECUTIVOS", () => {
  // Entre el 3-9 y el 19-25 hay un hueco: no se encadenan, y decir que "la cadena se rompe" ahi
  // taparia el problema real, que es la falta de cobertura.
  const r = S.rupturasDeCadena([
    _M("2026-08-03","2026-08-09",{ totales:{ efectivoAEntregar:5000 } }),
    _M("2026-08-19","2026-08-25",{ saldoInicial:-24.37 }),
  ]);
  assert.equal(r.length, 0);
});
t("dos archivos pegados con saldos que no empatan SI se reportan", () => {
  const r = S.rupturasDeCadena([
    _M("2026-08-19","2026-08-21",{ totales:{ efectivoAEntregar:-696.28 } }),
    _M("2026-08-22","2026-08-25",{ saldoInicial:1500 }),
  ]);
  assert.equal(r.length, 1);
  close(r[0].diferencia, 2196.28, 0.01);
  assert.equal(r[0].anterior.fin, "2026-08-21");
});
t("los archivos auditados encadenan al centavo", () => {
  // 19-21 cierra en -696.28 y 22-25 abre en -696.28.
  const r = S.rupturasDeCadena([
    _M("2026-08-22","2026-08-25",{ saldoInicial:-696.28 }),
    _M("2026-08-19","2026-08-21",{ totales:{ efectivoAEntregar:-696.28 } }),
  ]);
  assert.equal(r.length, 0, "y el orden en que se importaron no cambia el resultado");
});

console.log("\n== la bitacora se escribe con la importacion, no aparte ==");
t("importar deja constancia del periodo cubierto", () => {
  const d = _impBase([]);
  d.obj.emitido = "2026-08-03";
  const r = S.construirImportacionCortes(d, _previosVacios(), "Diana", 1000);
  assert.equal(r.importaciones.length, 1);
  assert.equal(r.importaciones[0].ini, "2026-07-11");
  assert.equal(r.importaciones[0].importadoPor, "Diana");
});
t("si la importacion truena, tampoco queda registrado que el periodo se cubrio", () => {
  // Seria el peor de los dos mundos: no entraron los movimientos y ademas la app cree que ese
  // tramo ya esta cubierto, asi que deja de reclamarlo.
  const previos = { cortes:[], gastos:[], retiros:[], ignorados:[], importaciones:[] };
  const real = S.canonizarCategoria;
  S.canonizarCategoria = () => { throw new Error("categoria imposible"); };
  try{
    assert.throws(() => S.construirImportacionCortes(
      _impBase([{ folio:"EGR-1", fecha:"2026-07-22", concepto:"X", monto:10, _clase:"gasto", _cat:"Otro" }]),
      previos, "Diana", 1000), /categoria imposible/);
    assert.equal(previos.importaciones.length, 0, "la bitacora del llamador queda intacta");
  } finally { S.canonizarCategoria = real; }
});

t("un gasto nuevo de caja nace con montoCaja igual al importe", () => {
  const r = S.construirImportacionCortes(
    _impBase([{ folio:"EGR-a", fecha:"2026-08-20", concepto:"COMPRA", monto:250.5, _clase:"gasto", _cat:"Otro" }]),
    _previosVacios(), "Diana", 1000);
  close(r.gastos[0].importe, 250.5, 0.01);
  close(r.gastos[0].montoCaja, 250.5, 0.01, "para el flujo de caja no hay que adivinar");
});

console.log("\n== el mismo registro guardado en dos semanas ==");
// allGastosAllWeeks() es state.weeks.flatMap(...) SIN deduplicar por id. La fusion entre
// dispositivos deduplica DENTRO de cada semana, pero nada impide que el mismo id acabe en dos.
// Cuando pasa, ese gasto cuenta doble en todo y es invisible: ninguna pantalla mostraba en que
// semana vive cada renglon, asi que se ven dos filas identicas y parecen dos capturas distintas.
t("el mismo id en dos semanas se detecta, con las dos semanas nombradas", () => {
  const g = { id:"g1", proveedor:"NUEVA WAL MART", factura:"ICAJG468220", fecha:"2026-07-24", importe:2456 };
  const r = S.gastosRepetidosPorId([{...g, _weekLabel:"20 al 26 jul"}, {...g, _weekLabel:"27 jul al 02 ago"}]);
  assert.equal(r.length, 1);
  assert.equal(r[0].veces, 2);
  close(r[0].deMas, 2456, 0.01, "una copia de mas cuenta una vez de mas");
  assert.deepEqual(r[0].semanas, ["20 al 26 jul", "27 jul al 02 ago"], "hay que decir DONDE estan");
});
t("tres copias sobran dos", () => {
  const g = { id:"g1", proveedor:"X", importe:100 };
  const r = S.gastosRepetidosPorId([g,g,g]);
  assert.equal(r[0].veces, 3);
  close(r[0].deMas, 200, 0.01);
});
t("dos gastos distintos con el mismo folio NO son esto", () => {
  // Eso es un duplicado de captura, que ya lo caza duplicadosSospechosos. Aqui solo entra el
  // MISMO registro: mismo id. Confundirlos mandaria a borrar una captura legitima.
  const r = S.gastosRepetidosPorId([
    { id:"a", factura:"F-1", importe:100 },
    { id:"b", factura:"F-1", importe:100 },
  ]);
  assert.deepEqual(r, []);
});
t("sin repetidos devuelve vacio, y no truena con basura", () => {
  assert.deepEqual(S.gastosRepetidosPorId([{id:"a"},{id:"b"}]), []);
  assert.deepEqual(S.gastosRepetidosPorId([null, undefined, {}]), []);
  assert.deepEqual(S.gastosRepetidosPorId([]), []);
  assert.deepEqual(S.gastosRepetidosPorId(null), []);
});
t("sale primero lo que mas dinero mete de mas", () => {
  const a = { id:"a", importe:100 }, b = { id:"b", importe:9000 };
  const r = S.gastosRepetidosPorId([a,a,b,b]);
  assert.equal(r[0].id, "b", "lo caro primero: es lo que mas mueve el saldo");
});
t("una semana sin nombre se dice, no se calla", () => {
  const g = { id:"g1", importe:10 };
  const r = S.gastosRepetidosPorId([g, {...g}]);
  assert.deepEqual(r[0].semanas, ["(sin nombre)", "(sin nombre)"]);
});

console.log("\n== un solo reporte: la forma en un lugar, el contenido en cada uno ==");
// Los dos exportadores a PDF eran dos funciones de ~4,750 caracteres que hacian casi lo mismo, y
// los dos Excel traian su propia hoja "Detalle" de los mismos gastos — con columnas distintas.
// Quien comparaba los dos archivos veia dos verdades del mismo mes.

t("la hoja de detalle sale en orden cronologico", () => {
  // Un detalle que salta en el tiempo no se puede seguir, y es lo que se entrega a contabilidad.
  const f = S.filasDetalleGastos([
    { fecha:"2026-08-20", proveedor:"C", importe:3 },
    { fecha:"2026-08-01", proveedor:"A", importe:1 },
    { fecha:"2026-08-10", proveedor:"B", importe:2 },
  ]);
  assert.deepEqual(f.map(x=>x[1]), ["A","B","C"]);
});
t("lleva TODAS las columnas: folio, forma de pago, importe y notas", () => {
  // El Excel del periodo no traia la forma de pago y el de Auditoria no traia las notas.
  const f = S.filasDetalleGastos([
    { fecha:"2026-08-01", proveedor:"POLLO BAL", categoria:"Carnicos", factura:"PBAL-1",
      formaPago:"transferencia", importe:1234.5, notas:"pedido especial" },
  ])[0];
  assert.equal(f.length, S.COLS_DETALLE_GASTOS.length, "una celda por columna declarada");
  assert.equal(f[3], "PBAL-1");
  assert.ok(/Transferencia/.test(f[4]), "la forma de pago va en el detalle");
  close(f[5], 1234.5, 0.01);
  assert.equal(f[6], "pedido especial");
});
t("un gasto sin folio ni notas no deja huecos que corran las columnas", () => {
  const f = S.filasDetalleGastos([{ fecha:"2026-08-01", proveedor:"X", importe:10 }])[0];
  assert.equal(f.length, S.COLS_DETALLE_GASTOS.length);
  assert.equal(f[3], "\u2014");
  assert.equal(f[6], "");
});
t("no truena con una lista vacia ni con basura", () => {
  assert.deepEqual(S.filasDetalleGastos([]), []);
  assert.deepEqual(S.filasDetalleGastos([null, undefined]), []);
  assert.deepEqual(S.filasDetalleGastos(null), []);
});
t("no muta la lista que recibe", () => {
  // Ordena una COPIA: ordenar la original le cambiaria el orden a la pantalla que la paso.
  const gs = [{ fecha:"2026-08-20", proveedor:"C", importe:3 }, { fecha:"2026-08-01", proveedor:"A", importe:1 }];
  S.filasDetalleGastos(gs);
  assert.equal(gs[0].proveedor, "C", "la lista original queda como estaba");
});

t("los dos PDF salen del mismo lienzo: ninguno dibuja su propia cabecera", () => {
  // Guardia sobre el codigo fuente. Un PDF no se puede ejecutar en las pruebas, pero el error a
  // evitar es textual: que alguien vuelva a escribir la banda verde a mano en uno de los dos y
  // los reportes empiecen a verse distintos.
  const cuerpo = (n) => {
    const i = script.indexOf("function " + n + "(");
    assert.ok(i > -1, "no encontre " + n);
    let j = script.indexOf("{", i), d = 0;
    for (let k = j; k < script.length; k++) {
      if (script[k] === "{") d++;
      else if (script[k] === "}") { d--; if (!d) return script.slice(i, k + 1); }
    }
    return "";
  };
  ["exportarPDF", "exportarReportePDF"].forEach(n => {
    const b = cuerpo(n);
    assert.ok(b.includes("lienzoPDF("), n + " tiene que salir del lienzo compartido");
    assert.ok(!/doc\.rect\(0,\s*0,\s*PW/.test(b), n + " volvio a dibujar su propia cabecera");
    assert.ok(!b.includes("new jsPDF("), n + " volvio a crear su propio documento");
  });
});
t("los dos Excel usan la misma hoja de detalle", () => {
  const cuerpo = (n) => {
    const i = script.indexOf("function " + n + "(");
    let j = script.indexOf("{", i), d = 0;
    for (let k = j; k < script.length; k++) {
      if (script[k] === "{") d++;
      else if (script[k] === "}") { d--; if (!d) return script.slice(i, k + 1); }
    }
    return "";
  };
  ["exportarExcel", "exportarReporteExcel"].forEach(n => {
    const b = cuerpo(n);
    assert.ok(b.includes("hojaDetalleGastos("), n + " tiene que usar la hoja compartida");
    assert.ok(!/book_append_sheet\([^)]*"Detalle"\)/.test(b), n + " volvio a armar su propia hoja Detalle");
  });
});

t("Auditoria pinta su detalle en modo LECTURA", () => {
  // Guardia sobre el cableado: la regla es que Auditoria revisa y no toca. Si alguien le vuelve a
  // poner permisos de edicion, el bote de basura reaparece en la pantalla que no debe borrar.
  const i = script.indexOf("function renderReportes(");
  assert.ok(i > -1);
  let j = script.indexOf("{", i), d = 0, b = "";
  for (let k = j; k < script.length; k++) {
    if (script[k] === "{") d++;
    else if (script[k] === "}") { d--; if (!d) { b = script.slice(i, k + 1); break; } }
  }
  assert.ok(/permisosDetalle\("lectura"\)/.test(b), "Auditoria tiene que pedir permisos de lectura");
  assert.ok(!b.includes("eliminarGasto("), "Auditoria no borra: el 🗑️ vive solo en Gastos");
  assert.ok(b.includes("verEnGastos("), "pero si tiene que llevar a donde se corrige");
});
t("Gastos sigue siendo la unica que borra", () => {
  const i = script.indexOf("function renderGastos(");
  let j = script.indexOf("{", i), d = 0, b = "";
  for (let k = j; k < script.length; k++) {
    if (script[k] === "{") d++;
    else if (script[k] === "}") { d--; if (!d) { b = script.slice(i, k + 1); break; } }
  }
  assert.ok(/permisosDetalle\("edicion"\)/.test(b));
});

console.log("\n== la tabla de detalle: permisos como dato, no como HTML repetido ==");
// La misma lista de gastos se pinta en tres pantallas, y cada una tenia su tabla escrita a mano.
// Por eso los permisos quedaron repartidos al azar: categoria editable en dos, importe en una,
// forma de pago en otra, y borrar —lo unico irreversible— en las tres.

t("el modo edicion permite todo; el de lectura, nada que escriba", () => {
  const e = S.permisosDetalle("edicion"), l = S.permisosDetalle("lectura");
  ["proveedor","categoria","importe","folio","formaPago","borrar"].forEach(k=>{
    assert.equal(e[k], true, "edicion deberia permitir "+k);
    assert.equal(l[k], false, "lectura NO deberia permitir "+k);
  });
  assert.equal(l.verFactura, true, "ver la factura no escribe nada: se conserva en lectura");
});
t("un modo desconocido cae en lectura, no en edicion", () => {
  // Si algun dia se teclea mal el modo, el error tiene que ser no poder editar — nunca poder
  // borrar sin querer.
  assert.equal(S.permisosDetalle("modo-que-no-existe").borrar, false);
  assert.equal(S.permisosDetalle().borrar, false);
});
t("los permisos se devuelven como COPIA", () => {
  const a = S.permisosDetalle("lectura");
  a.borrar = true;
  assert.equal(S.permisosDetalle("lectura").borrar, false, "tocar una copia no puede abrir permisos a las demas pantallas");
});

console.log("\n== forma de pago: filtrar y sumar por via ==");
t("caja_cortes y efectivo son la misma via", () => {
  // Es el mismo dinero saliendo del mismo cajon. Si el filtro los separara, buscar "efectivo"
  // escondería la mitad.
  assert.equal(S.claveFormaPago({ formaPago:"efectivo" }), "efectivo");
  assert.equal(S.claveFormaPago({ formaPago:"caja_cortes" }), "efectivo");
});
t("formaPagoFinal gana sobre formaPago", () => {
  // Es lo que quedo al liquidarlo, no lo que se penso al capturarlo.
  assert.equal(S.claveFormaPago({ formaPago:"credito", formaPagoFinal:"efectivo" }), "efectivo");
});
t("un gasto sin forma de pago se puede buscar como tal", () => {
  assert.equal(S.claveFormaPago({}), "sin");
  const r = S.filtrarGastosPanel([{ id:"a", importe:10 }, { id:"b", importe:10, formaPago:"efectivo" }], { formaPago:"sin" });
  assert.equal(r.length, 1); assert.equal(r[0].id, "a");
});

t("filtrar por efectivo trae tambien los de caja_cortes", () => {
  const gs = [
    { id:"a", importe:100, formaPago:"efectivo", categoria:"Gas" },
    { id:"b", importe:200, formaPago:"caja_cortes", categoria:"Gas" },
    { id:"c", importe:300, formaPago:"transferencia", categoria:"Gas" },
  ];
  assert.deepEqual(S.filtrarGastosPanel(gs, { formaPago:"efectivo" }).map(g=>g.id), ["a","b"]);
  assert.deepEqual(S.filtrarGastosPanel(gs, { formaPago:"transferencia" }).map(g=>g.id), ["c"]);
  assert.equal(S.filtrarGastosPanel(gs, {}).length, 3, "sin filtro no se esconde nada");
});

t("una factura DIVIDIDA aparece si el filtro casa con alguna de sus partidas", () => {
  // Si no, filtrar por "Carnicos" esconderia facturas que si traen carnicos adentro.
  const gs = [{ id:"d", importe:1000, categoria:"Dividida", formaPago:"efectivo",
                _partidas:[{categoria:"Carnicos",importe:600},{categoria:"Abarrotes",importe:400}] }];
  assert.equal(S.filtrarGastosPanel(gs, { categoria:"Carnicos" }).length, 1);
  assert.equal(S.filtrarGastosPanel(gs, { categoria:"Tortilla" }).length, 0);
});

t("los dos filtros se combinan", () => {
  const gs = [
    { id:"a", importe:100, formaPago:"efectivo", categoria:"Gas" },
    { id:"b", importe:100, formaPago:"transferencia", categoria:"Gas" },
    { id:"c", importe:100, formaPago:"efectivo", categoria:"Hielo" },
  ];
  assert.deepEqual(S.filtrarGastosPanel(gs, { categoria:"Gas", formaPago:"efectivo" }).map(g=>g.id), ["a"]);
});

t("el total de efectivo usa lo que salio de la CAJA, no el importe fiscal", () => {
  // El ticket del SAMS salio por 5,124 y su factura dice 5,073.99. En la columna de efectivo
  // tiene que ir el dinero, o el total no cuadra contra el conteo fisico.
  const t2 = S.totalesPorFormaPago([
    { importe:5073.99, montoCaja:5124, formaPago:"caja_cortes" },
    { importe:1000, formaPago:"transferencia" },
  ]);
  close(t2.efectivo, 5124, 0.01);
  close(t2.transferencia, 1000, 0.01);
  close(t2.total, 6124, 0.01);
});
t("totalesPorFormaPago no truena con una lista vacia o con basura", () => {
  const t3 = S.totalesPorFormaPago([null, undefined]);
  close(t3.total, 0, 0.01);
  close(S.totalesPorFormaPago([]).total, 0, 0.01);
});

console.log("\n== editar el folio a mano: la puerta por la que entra un duplicado ==");
t("teclear el folio de otra factura del mismo proveedor se detecta", () => {
  const gs = [
    { id:"1", proveedor:"NUEVA WAL MART DE MEXICO", factura:"ICAJG468220", fecha:"2026-07-24", importe:2456 },
    { id:"2", proveedor:"NUEVA WAL MART", factura:"", fecha:"2026-07-24", importe:2476 },
  ];
  const d = S.folioDuplicado(gs, "2", "NUEVA WAL MART", "ICAJG468220");
  assert.ok(d && d.id === "1");
});
t("el propio gasto no cuenta como duplicado de si mismo", () => {
  const gs = [{ id:"1", proveedor:"X", factura:"F-1", importe:100 }];
  assert.equal(S.folioDuplicado(gs, "1", "X", "F-1"), null);
});
t("el mismo folio de OTRO proveedor no es duplicado", () => {
  // Dos proveedores distintos numeran sus facturas por su cuenta: el 001 de uno no tiene nada
  // que ver con el 001 del otro.
  const gs = [{ id:"1", proveedor:"POLLO BAL", factura:"00025", importe:100 }];
  assert.equal(S.folioDuplicado(gs, "2", "OFFICE DEPOT", "00025"), null);
});
t("dejar el folio vacio no dispara la alerta", () => {
  const gs = [{ id:"1", proveedor:"X", factura:"F-1", importe:100 }];
  assert.equal(S.folioDuplicado(gs, "2", "X", ""), null);
  assert.equal(S.folioDuplicado(gs, "2", "X", "   "), null);
});
t("la comparacion ignora guiones y mayusculas", () => {
  const gs = [{ id:"1", proveedor:"POLLO BAL", factura:"PBAL-32078", importe:100 }];
  assert.ok(S.folioDuplicado(gs, "2", "POLLO BAL", "pbal32078"));
});

console.log("\n== importe fiscal vs. efectivo que salio de la caja ==");
t("sin montoCaja, el efectivo es el importe (todo lo capturado hasta hoy)", () => {
  close(S.montoEfectivoGasto({ formaPago:"efectivo", importe:1234.5 }), 1234.5, 0.01);
});
t("con montoCaja, manda montoCaja", () => {
  close(S.montoEfectivoGasto({ formaPago:"caja_cortes", importe:5073.99, montoCaja:5124 }), 5124, 0.01);
});
t("un gasto que no salio de la caja aporta cero", () => {
  close(S.montoEfectivoGasto({ formaPago:"transferencia", importe:9999, montoCaja:9999 }), 0, 0.01);
});
t("montoCaja en cero es un dato, no un hueco", () => {
  // 0 es falsy: un `montoCaja || importe` habria cobrado el importe completo de un movimiento
  // que de la caja no saco nada.
  close(S.montoEfectivoGasto({ formaPago:"efectivo", importe:500, montoCaja:0 }), 0, 0.01);
});
t("un montoCaja invalido no tumba la suma: se cae al importe", () => {
  close(S.montoEfectivoGasto({ formaPago:"efectivo", importe:500, montoCaja:"" }), 500, 0.01);
  close(S.montoEfectivoGasto({ formaPago:"efectivo", importe:500, montoCaja:-3 }), 500, 0.01);
});
t("difImporteCaja solo marca diferencias de verdad", () => {
  assert.equal(S.difImporteCaja({ importe:500 }), 0, "sin montoCaja no hay nada que explicar");
  assert.equal(S.difImporteCaja({ importe:500, montoCaja:500 }), 0);
  close(S.difImporteCaja({ importe:5073.99, montoCaja:5124 }), 50.01, 0.001);
  // Un centavo SI se muestra: la caja suma montoCaja, asi que ese centavo esta de verdad en el
  // total y un renglon que no lo explique deja al total sin cuadrar contra sus propias filas.
  // Lo que un centavo NO hace es pedir confirmacion al importar — ese umbral (0.02) vive en
  // confirmarImportarCortes, que es donde se modifica un dato contable.
  close(S.difImporteCaja({ importe:3914.01, montoCaja:3914.00 }), -0.01, 0.001);
});
t("el saldo de caja usa montoCaja, no el importe fiscal", () => {
  // La prueba de integracion: si esto usara g.importe, la caja cuadraria contra el comprobante
  // y no contra el dinero, que es justo al reves de para lo que sirve.
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[{ id:"c1", fecha:"2026-08-06", monto:10000 }],
    retiros:[], gastos:[
      { id:"g1", proveedor:"SAMS", fecha:"2026-08-06", importe:5073.99, montoCaja:5124, formaPago:"caja_cortes" }
    ]}], cajaSaldoInicial:{ "2026-08-01": { valor:0 } } };
  const r = S.calcularSaldoCajaPeriodo("2026-08-01", "2026-08-31");
  close(r.totalGastos, 5124, 0.01, "sale de la caja lo que salio, no lo que dice la factura");
  close(r.saldo, 10000 - 5124, 0.01);
});

t("el fixture real entra completo por esta via", () => {
  // Se lee aqui y no se usa la constante FIX de mas abajo: depender del orden de declaracion
  // hace que mover un bloque de pruebas rompa otro por un motivo que no tiene nada que ver.
  const F = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture_cortes_v3.json"), "utf8"));
  const egresos = F.egresos.map(e => ({ ...e, _clase:"gasto", _cat:"Otro" }));
  const r = S.construirImportacionCortes(
    { obj:{ periodo:{ ini:"2026-07-04", fin:"2026-08-02" }, saldoInicial:0 },
      cortesNuevos: F.cortes, egresos },
    _previosVacios(), "Diana", 1000);
  assert.equal(r.nC, 133); assert.equal(r.nG, 53); assert.equal(r.nR, 0); assert.equal(r.nI, 0);
  close(r.cortes.reduce((t,c)=>t+c.monto,0), 430054, 0.01);
  close(r.gastos.reduce((t,g)=>t+g.importe,0), 369415.97, 0.01);
  // La terminal viaja en el corte pero NO entra al efectivo.
  close(r.cortes.reduce((t,c)=>t+(c.terminal||0),0), 8945, 0.01);
  // Y todo lo importado se reconoce como tal.
  const d = S.desglosarPorOrigen(r.cortes, "monto");
  assert.equal(d.length, 1); assert.equal(d[0].origen, "cortes");
});

console.log("\n== origen de cada movimiento: de donde salio de verdad ==");
// No hay campo _origen: se deduce de las marcas que cada camino ya deja. Asi funciona sobre todo
// el historico, cosa que un campo nuevo nunca haria.
t("cada camino se reconoce por su marca", () => {
  assert.equal(S.origenDeMovimiento({ importe:100, _folioEgreso:"EGR-1" }), "cortes");
  assert.equal(S.origenDeMovimiento({ monto:100, _folioCorte:"RCE-1" }),   "cortes");
  assert.equal(S.origenDeMovimiento({ importe:100, _nominaCorrida:"2026-07-18" }), "nomina");
  assert.equal(S.origenDeMovimiento({ importe:100, _gmailMsgId:"abc" }),   "gmail");
  assert.equal(S.origenDeMovimiento({ importe:100, cfdiUuid:"U-1" }),      "sat");
  assert.equal(S.origenDeMovimiento({ importe:100, _importado:true }),     "excel");
});
t("un corte tecleado a mano es 'manual', sin ambiguedad", () => {
  // guardarCorte crea {id,fecha,tipo,monto,label} y nunca dejo marca: la ausencia SI significa
  // capturado a mano. Estos son los seis globales que inflaron julio en $384,542.
  assert.equal(S.origenDeMovimiento({ id:"1", fecha:"2026-07-07", monto:74676, label:"Martes" }), "manual");
  assert.equal(S.origenDeMovimiento({ id:"2", fecha:"2026-07-10", monto:53066, motivo:"retiro" }), "manual");
});
t("un gasto que NO trae la llave _gmailMsgId no se da por manual", () => {
  // La captura escribe _gmailMsgId aunque sea null. Sin la llave, el registro es de un formato
  // anterior: suponer su procedencia produce una cifra que parece verificada sin serlo.
  assert.equal(S.origenDeMovimiento({ importe:100, proveedor:"X" }), "sin_marcar");
  assert.equal(S.origenDeMovimiento({ importe:100, proveedor:"X", _gmailMsgId:null }), "manual");
});
t("basura no truena y no se inventa un origen", () => {
  ["", null, undefined, 42, []].forEach(x =>
    assert.equal(S.origenDeMovimiento(x), "sin_marcar", JSON.stringify(x)));
});
t("cortes gana sobre las demas marcas: es el camino por el que entro", () => {
  assert.equal(S.origenDeMovimiento({ importe:1, _folioEgreso:"E", _gmailMsgId:"g", cfdiUuid:"u" }), "cortes");
});
t("etiquetaOrigen traduce, y no rompe con algo desconocido", () => {
  assert.equal(S.etiquetaOrigen("cortes"), "importado de Cortes");
  assert.equal(S.etiquetaOrigen("sin_marcar"), "origen no registrado");
  assert.equal(S.etiquetaOrigen("loquesea"), "loquesea");
});

t("desglosarPorOrigen separa lo importado de lo tecleado — el caso de julio", () => {
  const cortes = [
    ...Array.from({length:133}, (_, i) => ({ id:"i"+i, monto:430054/133, _folioCorte:"RCE-"+i })),
    { id:"g1", fecha:"2026-07-07", monto:74676 }, { id:"g2", fecha:"2026-07-10", monto:53066 },
    { id:"g3", fecha:"2026-07-14", monto:74379 }, { id:"g4", fecha:"2026-07-18", monto:46454 },
    { id:"g5", fecha:"2026-07-22", monto:63175 }, { id:"g6", fecha:"2026-07-24", monto:72792 },
  ];
  const d = S.desglosarPorOrigen(cortes, "monto");
  assert.equal(d.length, 2, "dos fuentes distintas, no una sola cifra");
  assert.equal(d[0].origen, "cortes");   // el mayor primero
  close(d[0].monto, 430054); assert.equal(d[0].n, 133);
  assert.equal(d[1].origen, "manual");
  close(d[1].monto, 384542); assert.equal(d[1].n, 6);
  close(d.reduce((t,x)=>t+x.monto,0), 814596, 0.01);   // el total sigue siendo el mismo
});
t("desglosarPorOrigen usa el campo que se le pida", () => {
  const d = S.desglosarPorOrigen([{ importe:500, _gmailMsgId:"a" }], "importe");
  assert.equal(d[0].origen, "gmail"); close(d[0].monto, 500);
});
t("con una sola fuente devuelve una sola linea (no se ensucia el reporte)", () => {
  const d = S.desglosarPorOrigen([{ monto:10, _folioCorte:"A" }, { monto:20, _folioCorte:"B" }], "monto");
  assert.equal(d.length, 1);
  close(d[0].monto, 30);
});
t("sin movimientos, nada que desglosar", () => {
  assert.deepEqual(S.desglosarPorOrigen([], "monto"), []);
  assert.deepEqual(S.desglosarPorOrigen(null, "monto"), []);
});

console.log("\n== guardrail: ninguna escritura falla en silencio ==");
// fetch() solo rechaza por fallo de red: un 403 llega como respuesta normal. fbUpdateDoc y
// fbDeleteDoc ni miraban r.ok, asi que toda escritura rechazada por Firestore "salia bien".
// Por eso los respaldos estuvieron meses sin guardarse sin que nadie se enterara.
t("registrarFallo acumula y respeta el tope", () => {
  let l = [];
  for(let i = 0; i < 60; i++) l = S.registrarFallo(l, "guardar", "err " + i, "2026-08-24T00:00:00Z");
  assert.equal(l.length, 50, "se guardan los ultimos 50, no crece sin fin");
  assert.equal(l[l.length-1].detalle, "err 59", "el mas reciente sobrevive");
});
t("registrarFallo no truena con lista invalida", () => {
  assert.equal(S.registrarFallo(null, "x", "y").length, 1);
  assert.equal(S.registrarFallo(undefined, "x", "y").length, 1);
});
t("resumenFallos: sin fallos, silencio total", () => {
  const r = S.resumenFallos([]);
  assert.equal(r.n, 0);
  assert.equal(r.texto, "", "no se pinta nada si no hay nada que decir");
  assert.deepEqual(S.resumenFallos(null).ops, []);
});
t("resumenFallos: singular y plural", () => {
  assert.ok(/^1 cambio no se guard/.test(S.resumenFallos([{op:"a",detalle:""}]).texto));
  assert.ok(/^3 cambios no se guard/.test(
    S.resumenFallos([{op:"a"},{op:"a"},{op:"b"}]).texto));
});
t("resumenFallos agrupa por operacion, la mas frecuente primero", () => {
  const r = S.resumenFallos([{op:"guardar en cfdis"},{op:"guardar estado"},{op:"guardar en cfdis"}]);
  assert.equal(r.n, 3);
  assert.equal(r.ops[0], "guardar en cfdis");
  assert.equal(r.porOp["guardar en cfdis"], 2);
});
t("pistaFallo nombra el 403 como lo que es, y no adivina de mas", () => {
  assert.ok(/regla/i.test(S.pistaFallo(403)), "un 403 casi siempre es una regla que falta");
  assert.ok(/regla/i.test(S.pistaFallo(401)));
  assert.ok(/minuto/i.test(S.pistaFallo(429)));
  assert.ok(S.pistaFallo(500).length > 0);
  assert.equal(S.pistaFallo(404), "", "sin pista inventada para lo que no se reconoce");
  assert.equal(S.pistaFallo(200), "");
});

// Prueba de fuego: un 403 de verdad, no un objeto inventado. Si fbUpdateDoc vuelve a dejar de
// mirar r.ok, esto falla.
vm.runInContext("let _fallosEscritura = []; const FB_BASE='x'; const FB_KEY='k';" +
  "async function fbAuthHeader(){ return {}; } function pintarAvisoFallos(){}", sandbox);
const _leerFallos = () => vm.runInContext("_fallosEscritura", sandbox);
const _resetFallos = () => vm.runInContext("_fallosEscritura = [];", sandbox);
const _conRespuesta = (resp) => { sandbox.fetch = async () => resp; };

tAsyncQ("un 403 en fbUpdateDoc se registra y devuelve false", async () => {
  _resetFallos(); _conRespuesta({ ok:false, status:403 });
  const ok = await S.fbUpdateDoc("gmail_revisados", "h1", { a:1 });
  assert.equal(ok, false, "el llamador tiene que poder enterarse");
  const f = _leerFallos();
  assert.equal(f.length, 1, "quedo registrado");
  assert.ok(/403/.test(f[0].detalle));
  assert.ok(/regla/i.test(f[0].detalle), "y dice donde se arregla");
  assert.ok(/gmail_revisados/.test(f[0].op), "y en que coleccion");
});
tAsyncQ("un 200 no registra nada", async () => {
  _resetFallos(); _conRespuesta({ ok:true, status:200 });
  assert.equal(await S.fbUpdateDoc("cfdis", "u1", {}), true);
  assert.equal(_leerFallos().length, 0, "no se molesta al usuario cuando todo va bien");
});
tAsyncQ("un fallo de red tambien se registra", async () => {
  _resetFallos();
  sandbox.fetch = async () => { throw new Error("Failed to fetch"); };
  assert.equal(await S.fbUpdateDoc("cfdis", "u1", {}), false);
  assert.equal(_leerFallos().length, 1);
});
tAsyncQ("un borrado rechazado no se da por hecho", async () => {
  _resetFallos(); _conRespuesta({ ok:false, status:403 });
  assert.equal(await S.fbDeleteDoc("cfdis", "u1"), false);
  assert.ok(/borrar/.test(_leerFallos()[0].op));
});

console.log("\n== guardrail: toda coleccion usada tiene regla en firestore.rules ==");
// Dos bugs reales de esta misma sesion: se agregaron gmail_revisados y respaldos al codigo y no
// a las reglas. El encabezado de firestore.rules ya advertia que hay que hacerlo — pero una
// advertencia escrita no la ejecuta nadie. Esta prueba si.
const RULES = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
function coleccionesUsadas(){
  const cols = new Set();
  // const XXX_COL = "nombre"
  for(const m of script.matchAll(/const\s+\w*_COL\w*\s*=\s*["'`]([a-z_]+)["'`]/g)) cols.add(m[1]);
  // rutas literales tipo 'estado/cicsa' o `datos/precios`
  for(const m of script.matchAll(/fb(?:Get|Set)\(\s*["'`]([a-z_]+)\//g)) cols.add(m[1]);
  // db.collection(ALGO) con constante conocida
  for(const m of script.matchAll(/db\.collection\((\w+)\)/g)){
    const c = script.match(new RegExp("const\\s+" + m[1] + "\\s*=\\s*[\"'`]([a-z_]+)[\"'`]"));
    if(c) cols.add(c[1]);
  }
  return [...cols].sort();
}
t("cada coleccion que usa index.html esta declarada en firestore.rules", () => {
  const usadas = coleccionesUsadas();
  assert.ok(usadas.length >= 5, "el detector debe encontrar algo, si no la prueba no prueba nada: " + usadas.join(","));
  const sinRegla = usadas.filter(c => !new RegExp("match\\s+/" + c + "/").test(RULES));
  assert.deepEqual(sinRegla, [],
    "sin regla, Firestore devuelve 403 y la pantalla se queda vacia. Agregalas a firestore.rules: " + sinRegla.join(", "));
});
t("el detector reconoce las colecciones que sabemos que existen", () => {
  const u = coleccionesUsadas();
  ["cfdis", "productos_comerciales", "proveedores", "gmail_revisados", "respaldos", "actividad"]
    .forEach(c => assert.ok(u.includes(c), "el detector deberia ver " + c + "; vio: " + u.join(",")));
});

console.log("\n== fixture real v3: importar, reimportar, idempotencia ==");
// Archivo real de Manejo de Cortes (133 cortes, 53 egresos, 4 jul - 2 ago 2026). Es el mismo que
// se rechazaba por version y el que destapo el doble conteo de ingresos.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture_cortes_v3.json"), "utf8"));
const _sum = (a, k) => a.reduce((t, x) => t + (parseFloat(x[k]) || 0), 0);
const _efectivoCorte = c => (parseFloat(c.boletos25)||0)+(parseFloat(c.contratistas)||0)+(parseFloat(c.otrosIngresos)||0);

t("el fixture v3 se acepta sin errores ni avisos", () => {
  const v = S.validarArchivoCortes(FIX);
  assert.equal(v.ok, true, v.errores.join(" | "));
  assert.deepEqual(S.avisosControlCortes(FIX), [], "sus totales cuadran solos");
});
t("cifras de control del fixture", () => {
  assert.equal(FIX.cortes.length, 133);
  assert.equal(new Set(FIX.cortes.map(c => c.folio)).size, 133, "sin folios repetidos");
  assert.equal(FIX.egresos.length, 53);
  assert.equal(new Set(FIX.egresos.map(e => e.folio)).size, 53);
  close(_sum(FIX.cortes, "total"), 430054);
  close(_sum(FIX.cortes, "terminal"), 8945);
  close(_sum(FIX.egresos, "monto"), 369415.97);
  close(430054 - 369415.97, FIX.totales.efectivoAEntregar);
});
t("el efectivo contable de cada corte NO incluye la terminal", () => {
  // total = boletos25 + contratistas + otrosIngresos; la terminal va aparte. Si algun dia el
  // contrato cambiara y 'total' incluyera la terminal, el ingreso se inflaria en silencio.
  const malos = FIX.cortes.filter(c => Math.abs(_efectivoCorte(c) - (parseFloat(c.total)||0)) > 0.001);
  assert.equal(malos.length, 0, "total debe ser exactamente la suma de los tres conceptos de efectivo");
  assert.ok(_sum(FIX.cortes, "terminal") > 0, "y si hay terminal, para que la prueba signifique algo");
});
t("los totales del archivo son control, no transacciones", () => {
  // Ninguna cifra global debe convertirse en movimiento: se comparan contra la suma de renglones.
  close(_sum(FIX.cortes, "total"), FIX.totales.efectivo);
  close(_sum(FIX.cortes, "terminal"), FIX.totales.terminal);
  close(_sum(FIX.egresos, "monto"), FIX.totales.egresos);
});
t("tocar totales.efectivo dispara alerta de integridad y NO crea ingreso", () => {
  const a = JSON.parse(JSON.stringify(FIX));
  a.totales.efectivo = a.totales.efectivo + 50000;
  const av = S.avisosControlCortes(a);
  assert.ok(av.some(x => /efectivo/i.test(x)), "debe avisar que no cuadra");
  assert.equal(S.validarArchivoCortes(a).ok, true, "pero no bloquea: es un aviso, no un rechazo");
  close(_sum(a.cortes, "total"), 430054, 0.01);   // los cortes no cambiaron
});

// ── idempotencia: la reimportacion se decide por folio ────────────────────────
// foliosCorteImportados/foliosEgresoImportados leen _folioCorte/_folioEgreso del estado. Se
// simula el estado que dejaria una importacion para comprobar que la segunda no crea nada.
t("primera importacion: 133 cortes nuevos, 53 egresos", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[] }], cortesIgnorados:[] };
  const yaC = S.foliosCorteImportados();
  const nuevos = FIX.cortes.filter(c => !yaC.has(String(c.folio).trim()));
  assert.equal(nuevos.length, 133);
  close(nuevos.reduce((t, c) => t + _efectivoCorte(c), 0), 430054);
});
t("segunda importacion identica: 0 nuevos, 0 duplicados", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", retiros:[], gastos:
      FIX.egresos.map((e, i) => ({ id:"g"+i, importe:e.monto, fecha:e.fecha, _folioEgreso:e.folio })),
    cortes: FIX.cortes.map((c, i) => ({ id:"c"+i, fecha:c.fecha, monto:_efectivoCorte(c), _folioCorte:c.folio })) }],
    cortesIgnorados:[] };
  const yaC = S.foliosCorteImportados(), yaE = S.foliosEgresoImportados();
  assert.equal(FIX.cortes.filter(c => !yaC.has(String(c.folio).trim())).length, 0, "cero cortes nuevos");
  assert.equal(FIX.egresos.filter(e => !yaE.has(String(e.folio).trim())).length, 0, "cero egresos nuevos");
  assert.equal(yaC.size, 133);
  assert.equal(yaE.size, 53);
  close(S.todosLosCortes().reduce((t, c) => t + c.monto, 0), 430054, 0.01);
});
t("el ingreso NO cambia al reimportar", () => {
  const antes = S.todosLosCortes().reduce((t, c) => t + c.monto, 0);
  const yaC = S.foliosCorteImportados();
  FIX.cortes.filter(c => !yaC.has(String(c.folio).trim()))
    .forEach(c => S.state.weeks[0].cortes.push({ id:"x", fecha:c.fecha, monto:_efectivoCorte(c), _folioCorte:c.folio }));
  close(S.todosLosCortes().reduce((t, c) => t + c.monto, 0), antes, 0.01);
});
t("un global tecleado sobre ese mismo estado se detecta, y explica los $384,542", () => {
  // Los seis cierres reales que inflaron el balance de julio.
  [["2026-07-07",74676],["2026-07-10",53066],["2026-07-14",74379],
   ["2026-07-18",46454],["2026-07-22",63175],["2026-07-24",72792]]
    .forEach(([f, m], i) => S.state.weeks[0].cortes.push({ id:"glob"+i, fecha:f, monto:m }));
  close(S.todosLosCortes().reduce((t, c) => t + c.monto, 0), 814596, 0.01);   // el numero que salio en pantalla
  const r = S.cortesManualesSospechosos(S.todosLosCortes(), "", "");
  assert.equal(r.hallazgos.length, 6, "los seis quedan señalados");
  close(r.montoManual, 384542);
  close(r.montoImportado, 430054);
  // Los del 7 y 10 de julio son ANTERIORES al primer corte importado (11 jul): quedan listados
  // pero fuera del tramo, que es justo la distincion que hay que poder hacer.
  assert.equal(r.hallazgos.filter(h => h.dentroDelTramo).length, 4);
});
// El septimo global aparecio en el PDF de balance de julio: 03/jul $62,105. Con el, los cortes
// tecleados a mano suman $446,647 y el ingreso correcto del periodo son los 133 importados.
// Manejo de Cortes empezo a operar el 11 de julio, asi que los tres anteriores a esa fecha no
// pueden ser ingreso de cortes; el codigo no puede saberlo, pero SI puede separarlos de los que
// caen dentro del tramo, para no acusarlos de duplicados sin prueba.
t("los siete globales se clasifican por su posicion respecto al tramo importado", () => {
  S.state.weeks[0].cortes.push({ id:"glob6", fecha:"2026-07-03", monto:62105 });
  const r = S.cortesManualesSospechosos(S.todosLosCortes(), "2026-07-01", "2026-08-02");
  assert.equal(r.tramo.desde, "2026-07-11", "el primer corte importado es del 11 de julio");
  assert.equal(r.tramo.hasta, "2026-08-02");
  close(r.montoManual, 446647);
  close(r.montoImportado, 430054);

  const antes = r.hallazgos.filter(h => h.posicion === "antes");
  assert.deepEqual(antes.map(h => h.fecha).sort(), ["2026-07-03","2026-07-07","2026-07-10"]);
  close(antes.reduce((t, h) => t + h.monto, 0), 189847);

  const dentro = r.hallazgos.filter(h => h.posicion === "dentro");
  assert.deepEqual(dentro.map(h => h.fecha).sort(), ["2026-07-14","2026-07-18","2026-07-22","2026-07-24"]);
  close(dentro.reduce((t, h) => t + h.monto, 0), 256800);

  assert.equal(r.hallazgos.filter(h => h.posicion === "despues").length, 0);
  // posicion y dentroDelTramo no pueden contradecirse: el panel usa las dos.
  assert.ok(r.hallazgos.every(h => h.dentroDelTramo === (h.posicion === "dentro")));
});
// Marcar NO borra: el movimiento se conserva, deja de sumar, y el total baja exactamente por el
// monto excluido. Sin esto, "excluir" seria indistinguible de perder un dato.
t("excluir los siete deja el ingreso en los $430,054 de los cortes importados", () => {
  const antes = S.todosLosCortes().reduce((t, c) => t + c.monto, 0);
  close(antes, 876701, 0.01);                       // 430,054 importados + 446,647 tecleados
  S.state.weeks[0].cortes.filter(c => !c._folioCorte)
    .forEach(c => { c._noContable = { motivo:"prueba", por:"", ts:"2026-08-27T00:00:00Z" }; });
  close(S.todosLosCortes().reduce((t, c) => t + c.monto, 0), 430054, 0.01);
  close(S.todosLosCortesNoContables().reduce((t, c) => t + c.monto, 0), 446647, 0.01);
  assert.equal(S.state.weeks[0].cortes.length, 140, "no se borro ni uno: 133 + 7");
});

console.log("\n== captura: el CFDI timbrado gana sobre lo que lee la IA ==");
// El XML es el dato fiscal exacto; la IA esta leyendo una imagen o un PDF y puede confundir un
// 6 con un 8 en el importe, o tomar la fecha de vencimiento en vez de la de emision. Cuando el
// correo trae las dos cosas, mandan los campos del comprobante.
const XML_TIMBRADO = { proveedor:"CARNES DEL NORTE SA DE CV", fecha:"2026-07-18", folio:"FCPF4010508626", total:36195.50 };
const LEIDO_IA     = { proveedor:"CARNES DEL NORT",           fecha:"2026-08-02", factura:"FCPF401050B626", importe:36195.80,
                       categoria:"Cárnicos" };

t("con CFDI y con lectura de IA, gana el CFDI en los cuatro campos", () => {
  const r = S.datosDeCaptura(XML_TIMBRADO, LEIDO_IA);
  assert.equal(r.proveedor, XML_TIMBRADO.proveedor);
  assert.equal(r.fecha,     "2026-07-18", "la fecha de emision del timbrado, no la que leyo la IA");
  assert.equal(r.factura,   "FCPF4010508626", "el folio del XML, no el que la IA leyo con una B");
  close(r.importe, 36195.50, 0.001);
  assert.equal(r.fechaAsumida, false);
  assert.equal(r.fechaDelCfdi, true);
});
t("sin CFDI, se usa lo que leyo la IA", () => {
  const r = S.datosDeCaptura(null, LEIDO_IA);
  assert.equal(r.proveedor, "CARNES DEL NORT");
  assert.equal(r.fecha,     "2026-08-02");
  assert.equal(r.factura,   "FCPF401050B626");
  close(r.importe, 36195.80, 0.001);
  assert.equal(r.fechaAsumida, false, "la IA si trajo fecha");
  assert.equal(r.fechaDelCfdi, false);
});
t("un CFDI incompleto solo gana en los campos que si trae", () => {
  const r = S.datosDeCaptura({ folio:"A-123" }, LEIDO_IA);
  assert.equal(r.factura,   "A-123",           "esto si lo trae el XML");
  assert.equal(r.proveedor, "CARNES DEL NORT", "esto no, cae a la IA");
  assert.equal(r.fecha,     "2026-08-02");
  close(r.importe, 36195.80, 0.001);
});
// Un complemento de pago va con Total 0: el monto que enseña el PDF es lo PAGADO de facturas ya
// registradas. Si el 0 ganara, se guardaria un gasto de cero; si ganara lo que leyo la IA del
// PDF, se duplicaria el egreso. Por eso total 0 NO gana y el importe queda para que lo decida
// una persona — el bloqueo de complementos vive aparte.
t("un total de cero NO gana: es el caso del complemento de pago", () => {
  const r = S.datosDeCaptura({ ...XML_TIMBRADO, total:0 }, LEIDO_IA);
  close(r.importe, 36195.80, 0.001, "cae al de la IA, no se guarda un gasto de cero");
  assert.equal(r.fecha, "2026-07-18", "los demas campos del XML_TIMBRADO siguen ganando");
});
t("sin fecha en ningun lado se avisa, y no se inventa una", () => {
  const r = S.datosDeCaptura(null, { proveedor:"X", importe:100 });
  assert.equal(r.fecha, null, "null, no la fecha de hoy: quien llama decide y avisa");
  assert.equal(r.fechaAsumida, true);
});
t("sin CFDI y sin lectura de IA no truena: devuelve vacios", () => {
  const r = S.datosDeCaptura(null, null);
  assert.deepEqual(
    { p:r.proveedor, f:r.fecha, x:r.factura, i:r.importe, a:r.fechaAsumida },
    { p:"", f:null, x:"", i:"", a:true });
});

console.log("\n== sincronizacion: no escribir lo que ya esta ==");
t("si la nube ya tiene exactamente esto, no se sube", () => {
  assert.equal(S.hayQueSubir('{"a":1}', '{"a":1}'), false);
});
t("si cambio algo, se sube", () => {
  assert.equal(S.hayQueSubir('{"a":1}', '{"a":2}'), true);
});
t("sin remoto SIEMPRE se sube: ante la duda, escribir", () => {
  // Primera vez, o el fbGet fallo. Perder una captura es peor que una escritura de mas.
  assert.equal(S.hayQueSubir(null, '{"a":1}'), true);
  assert.equal(S.hayQueSubir(undefined, '{"a":1}'), true);
});

console.log("\n== tamano del estado: el techo de 1 MiB ==");
// Todo el estado vive en UN documento y Firestore corta en 1 MiB. Nada se archiva, asi que
// crece siempre. El dia que se cruce, la app deja de poder guardar. Esto lo hace visible antes.
const TOPE = vm.runInContext("FIRESTORE_TOPE_DOC", sandbox);
t("el tope es el limite real de Firestore, no un numero inventado", () => {
  assert.equal(TOPE, 1048576, "1 MiB por documento");
});
t("mide BYTES utf-8, no caracteres: esta app escribe en espanol", () => {
  // "ñ" y los acentos ocupan dos bytes. Contar caracteres subestimaria el tamano real, que es
  // justo el error que hace que un medidor de espacio no sirva para nada.
  assert.equal(S.medirEstado("abc", 0).bytes, 3);
  assert.equal(S.medirEstado("ñ", 0).bytes, 2);
  assert.equal(S.medirEstado("Cárnicos", 0).bytes, 9, "8 caracteres, 9 bytes");
  assert.equal(S.medirEstado("€", 0).bytes, 3);
  assert.equal(S.medirEstado("🍽", 0).bytes, 4, "un emoji son 4 bytes, aunque JS lo vea como 2");
  // Contra la referencia del entorno, cuando existe.
  if (typeof TextEncoder !== "undefined") {
    for (const txt of ["Cárnicos", "ñ", "🍽 Comedores", "ACME S.A. de C.V.", ""]) {
      assert.equal(S.medirEstado(txt, 0).bytes, new TextEncoder().encode(txt).length, txt);
    }
  }
});
t("los tres niveles cambian donde deben", () => {
  const en = p => S.medirEstado("x".repeat(Math.round(TOPE * p / 100)), 0).nivel;
  assert.equal(en(10), "ok");
  assert.equal(en(59), "ok");
  assert.equal(en(60), "aviso",  "al 60% empieza a avisar");
  assert.equal(en(79), "aviso");
  assert.equal(en(80), "critico", "al 80% ya es urgente");
  assert.equal(en(95), "critico");
});
t("cuenta gastos, cortes y retiros de todas las semanas", () => {
  assert.equal(S.contarMovimientos({ weeks: [
    { gastos:[1,2,3], cortes:[1], retiros:[] },
    { gastos:[1],     cortes:[],  retiros:[1,2] },
  ]}), 7);
  assert.equal(S.contarMovimientos({}), 0, "estado vacio no truena");
  assert.equal(S.contarMovimientos(null), 0);
});
t("el peso por movimiento sale de los datos reales, no de una estimacion", () => {
  const m = S.medirEstado("x".repeat(1000), 10);
  assert.equal(m.porMovimiento, 100);
  assert.equal(m.movimientosQueCaben, Math.floor((TOPE - 1000) / 100));
});
t("sin movimientos no se inventa una proyeccion", () => {
  const m = S.medirEstado("x".repeat(1000), 0);
  assert.equal(m.porMovimiento, 0);
  assert.equal(m.movimientosQueCaben, null, "mejor no decir nada que decir un numero falso");
});

console.log("\n== librerias externas: nada se ejecuta sin verificar ==");
// Sin integrity el navegador ejecuta lo que devuelva el CDN, con la sesion de Firebase del
// usuario y acceso a todo el estado. Los hashes son de versiones EXACTAS: si alguien sube una
// version y no recalcula, el archivo deja de cargar — ruidoso, que es justo lo que se quiere.
t("todo <script src> externo lleva integrity y crossorigin", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
  const sinSri = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"[^>]*>/g)) {
    if (!/\bintegrity="sha(256|384|512)-/.test(m[0]) || !/\bcrossorigin=/.test(m[0])) {
      sinSri.push(m[1]);
    }
  }
  assert.deepEqual(sinSri, [], "estos scripts entran sin verificar");
});

console.log("\n== mensajes de estado: texto, no HTML ==");
// setStatus escribia con innerHTML, y por ahi pasan el nombre del proveedor, el numero de
// factura y los mensajes de error del servidor. Ahora escribe con textContent. Las 7 llamadas
// que si llevan formato usan setStatusHTML y escapan lo suyo. Esta prueba es un guardia sobre
// el codigo fuente: no hay DOM en el sandbox, pero el error a evitar es textual.
t("setStatus escribe texto plano, nunca innerHTML", () => {
  const m = script.match(/function setStatus\(id,msg,type\)\{[\s\S]*?\n\}/);
  assert.ok(m, "no encontre setStatus");
  assert.ok(m[0].includes("textContent") || m[0].includes("createTextNode"),
            "setStatus tiene que escribir texto");
  assert.ok(!m[0].includes("innerHTML"),
            "setStatus volvio a innerHTML: cualquier proveedor o factura con etiquetas se ejecuta");
});
t("ninguna llamada a setStatus mete etiquetas HTML", () => {
  // Si alguien necesita formato tiene que usar setStatusHTML, que es la explicita.
  const malas = [];
  const re = /(?<![\w.])setStatus\s*\(/g;
  let m;
  while ((m = re.exec(script))) {
    let d = 1, i = re.lastIndex;
    while (i < script.length && d) {
      if (script[i] === "(") d++;
      else if (script[i] === ")") d--;
      i++;
    }
    const args = script.slice(re.lastIndex, i - 1);
    if (/<(br|strong|span|div|b|i|em|a|small|code)\b|<\/[a-z]+>/.test(args)) {
      malas.push(script.slice(0, m.index).split("\n").length);
    }
  }
  assert.deepEqual(malas, [], "esas llamadas necesitan setStatusHTML, no setStatus");
});

console.log("\n== acceso: tener sesion no es estar dado de alta ==");
// El alta por correo de Firebase es un endpoint PUBLICO de Google y la llave del proyecto va
// en index.html, que se sirve abierto: cualquiera puede crearse una cuenta sin invitacion.
// Antes, al entrar sin registro se le creaba uno como "operativo" — y con el, lectura y
// escritura de estado/cicsa, o sea de todo el dinero. Ahora sin registro no se entra.
t("una cuenta dada de alta entra", () => {
  assert.equal(S.puedeEntrar(true, "cualquierUid"), true);
});
t("una cuenta SIN registro no entra, aunque su contrasena sea valida", () => {
  assert.equal(S.puedeEntrar(false, "uidDeAlguienQueSeRegistroSolo"), false);
});
// ADMIN_UID se declara con const, y un const de vm.runInContext queda en el ambito lexico
// del contexto, NO como propiedad del sandbox: S.ADMIN_UID seria undefined. Las funciones si
// aparecen (function es var-scoped), por eso S.puedeEntrar si existe. Se lee desde dentro.
const ADMIN = vm.runInContext("ADMIN_UID", sandbox);
t("el dueno entra por UID aunque le falte su registro: si no, nadie podria dar de alta a nadie", () => {
  assert.ok(typeof ADMIN === "string" && ADMIN.length > 20, "ADMIN_UID salio de index.html");
  assert.equal(S.puedeEntrar(false, ADMIN), true);
});
t("un uid parecido al del dueno NO pasa: la comparacion es exacta", () => {
  assert.equal(S.puedeEntrar(false, ADMIN + "x"), false);
  assert.equal(S.puedeEntrar(false, ADMIN.slice(0, -1)), false);
  assert.equal(S.puedeEntrar(false, ADMIN.toLowerCase()), false);
});

console.log("\n== auditoría de caja: doble conteo de ingresos y egresos excluidos ==");
// Caso real: el balance mostro $814,596 de ingreso cuando los 133 cortes del archivo suman
// $430,054. Los $384,542 de diferencia eran 6 cortes GLOBALES tecleados a mano (cierres de
// semana) que conviven con los cortes individuales importados. No hay folio que comparar, asi
// que la importacion no puede verlo sola: hay que señalarlo.
t("un global tecleado dentro del tramo importado se señala como doble conteo", () => {
  const cortes = [
    { id:"i1", fecha:"2026-07-18", monto:10000, _folioCorte:"RCE-1" },
    { id:"i2", fecha:"2026-07-19", monto:12000, _folioCorte:"RCE-2" },
    { id:"i3", fecha:"2026-07-21", monto:9000,  _folioCorte:"RCE-3" },
    { id:"m1", fecha:"2026-07-18", monto:63175 },                      // cierre tecleado a mano
  ];
  const r = S.cortesManualesSospechosos(cortes, "2026-07-01", "2026-07-31");
  assert.equal(r.hallazgos.length, 1);
  assert.equal(r.hallazgos[0].id, "m1");
  assert.equal(r.hallazgos[0].dentroDelTramo, true);
  assert.equal(r.hallazgos[0].mismoDia, true, "ese dia YA tiene cortes importados");
  close(r.montoImportado, 31000);
  close(r.montoManual, 63175);
});
t("si no hay cortes importados no se acusa a nadie", () => {
  const r = S.cortesManualesSospechosos([{ id:"m1", fecha:"2026-07-18", monto:63175 }], "", "");
  assert.equal(r.hallazgos.length, 1, "se lista");
  assert.equal(r.hallazgos[0].dentroDelTramo, false, "pero NO como doble conteo: no hay tramo importado");
});
t("un global POSTERIOR al ultimo corte importado tambien queda fuera del tramo", () => {
  const r = S.cortesManualesSospechosos([
    { id:"i1", fecha:"2026-07-11", monto:10000, _folioCorte:"RCE-1" },
    { id:"i2", fecha:"2026-07-20", monto:12000, _folioCorte:"RCE-2" },
    { id:"m1", fecha:"2026-07-28", monto:50000 },
  ], "2026-07-01", "2026-07-31");
  assert.equal(r.hallazgos.length, 1);
  assert.equal(r.hallazgos[0].posicion, "despues");
  assert.equal(r.hallazgos[0].dentroDelTramo, false, "fuera del tramo no es doble conteo");
});
t("sin ningun corte importado, la posicion es sin_tramo: no hay contra que comparar", () => {
  const r = S.cortesManualesSospechosos([{ id:"m1", fecha:"2026-07-18", monto:63175 }], "", "");
  assert.equal(r.hallazgos[0].posicion, "sin_tramo");
  assert.equal(r.hallazgos[0].dentroDelTramo, false);
});
t("solo con cortes importados no hay hallazgos", () => {
  const r = S.cortesManualesSospechosos([{ id:"i1", fecha:"2026-07-18", monto:10000, _folioCorte:"RCE-1" }], "", "");
  assert.deepEqual(r.hallazgos, []);
});
t("el diagnostico respeta el periodo pedido", () => {
  const cortes = [
    { id:"i1", fecha:"2026-07-18", monto:10000, _folioCorte:"RCE-1" },
    { id:"m1", fecha:"2026-06-30", monto:5000 },                       // fuera del rango
  ];
  assert.deepEqual(S.cortesManualesSospechosos(cortes, "2026-07-01", "2026-07-31").hallazgos, []);
});

// Antes se guardaba SOLO el folio, asi que un egreso excluido desaparecia sin dejar importe ni
// concepto: el reporte no podia explicar su propio faltante.
t("un excluido con detalle dice cuanto y por que", () => {
  const st = { cortesIgnorados:[
    { folio:"EGR-a", fecha:"2026-07-22", concepto:"PAGO SEM ING FRANCISCO", monto:20000,
      motivo:"Mismo importe en fecha cercana", por:"Diana", ts:"2026-08-01T10:00:00Z" },
  ]};
  const r = S.egresosExcluidos(st);
  assert.equal(r.length, 1);
  close(r[0].monto, 20000);
  assert.equal(r[0]._sinDetalle, false);
});
t("los excluidos viejos (solo folio) se siguen leyendo, marcados como sin detalle", () => {
  const st = { cortesIgnorados:["EGR-viejo", { folio:"EGR-nuevo", monto:500 }] };
  const r = S.egresosExcluidos(st);
  assert.equal(r.length, 2);
  assert.equal(r[0]._sinDetalle, true, "del viejo no se sabe el monto");
  assert.equal(r[0].monto, null);
});
// REGRESIÓN REAL: mergeEstados hacía [...new Set(...map(String))] sobre esta lista. Con los
// renglones nuevos (objetos), String() da "[object Object]": el Set los colapsaba en UNO, se
// perdía el detalle de todos, y sus folios dejaban de coincidir — así que los egresos ya
// descartados volvían a ofrecerse como nuevos, listos para contarse dos veces.
t("fusionar excluidos NO los colapsa en [object Object]", () => {
  const a = [{ folio:"EGR-a", monto:20000, ts:"2026-08-01T10:00:00Z" }];
  const b = [{ folio:"EGR-b", monto:500,   ts:"2026-08-01T11:00:00Z" }];
  const r = S._unirIgnorados(a, b);
  assert.equal(r.length, 2, "dos folios distintos siguen siendo dos");
  assert.deepEqual(r.map(S.folioDeIgnorado).sort(), ["EGR-a", "EGR-b"]);
  assert.ok(r.every(x => typeof x !== "string"), "conservan el detalle");
});
t("el mismo folio en los dos dispositivos no se duplica", () => {
  const r = S._unirIgnorados([{ folio:"EGR-a", monto:100, ts:"2026-08-01T10:00:00Z" }],
                             [{ folio:"EGR-a", monto:100, ts:"2026-08-02T10:00:00Z" }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].ts, "2026-08-02T10:00:00Z", "gana el más reciente");
});
t("un folio suelto viejo no pisa al renglón con detalle", () => {
  const r = S._unirIgnorados(["EGR-a"], [{ folio:"EGR-a", monto:33000, ts:"2026-08-02T10:00:00Z" }]);
  assert.equal(r.length, 1);
  assert.equal(typeof r[0], "object", "gana el que trae el importe");
  close(r[0].monto, 33000);
  // y en el otro orden
  const r2 = S._unirIgnorados([{ folio:"EGR-a", monto:33000 }], ["EGR-a"]);
  assert.equal(typeof r2[0], "object");
});
t("mergeEstados conserva el detalle de los excluidos", () => {
  const remote = { weeks:[], cortesIgnorados:[{ folio:"EGR-a", monto:20000, ts:"2026-08-01T10:00:00Z" }] };
  const local  = { weeks:[], cortesIgnorados:["EGR-b"] };
  const m = S.mergeEstados(remote, local);
  assert.equal(m.cortesIgnorados.length, 2);
  assert.ok(m.cortesIgnorados.some(x => typeof x === "object" && x.monto === 20000),
            "el renglón con importe sobrevive al sync");
});
t("foliosCorteIgnorados devuelve folios, no [object Object]", () => {
  S.state = { budget:{}, weeks:[], cortesIgnorados:["EGR-viejo", { folio:"EGR-nuevo", monto:500 }] };
  const f = S.foliosCorteIgnorados();
  assert.ok(f.has("EGR-viejo") && f.has("EGR-nuevo"), "los dos formatos se reconocen");
  assert.ok(!f.has("[object Object]"), "nunca la cadena basura");
});

t("folioDeIgnorado lee las dos formas", () => {
  assert.equal(S.folioDeIgnorado("EGR-a"), "EGR-a");
  assert.equal(S.folioDeIgnorado({ folio:"EGR-b" }), "EGR-b");
});
t("sin nada excluido, cero", () => {
  assert.deepEqual(S.egresosExcluidos({}), []);
});

console.log("\n== conciliación SAT: el folio se compara contra la FACTURA, no contra el UUID ==");
const UUID_A = "BC46CB99-12D7-E945-0000-000000002450";
t("un folio corto no se empareja con un UUID que lo contenga por casualidad", () => {
  // Bug real: "245" son dígitos hexadecimales, así que aparecía dentro de casi cualquier UUID y
  // el MISMO gasto de $36,195 salía emparejado con cuatro CFDI de proveedores distintos.
  S.state.weeks = [{ id: "1", gastos: [
    { id: "1", factura: "245", importe: 36195, fecha: "2026-07-09", proveedor: "OTRO" },
  ]}];
  const r = S.conciliarSAT([
    { uuid: UUID_A, folio: UUID_A, serie: "A", folioComp: "9001",
      proveedor: "GETNET", fecha: "2026-07-31", total: 1406.34, tipo: "I" },
  ], "", "", "");
  assert.equal(r.diferencias.length, 0, "no debe inventar una diferencia de monto");
  assert.equal(r.faltantes.length, 1, "el CFDI queda como faltante, que es la verdad");
});
t("el folio real de la factura sí empareja, con o sin guiones", () => {
  S.state.weeks = [{ id: "1", gastos: [
    { id: "1", factura: "PBAL-31832", importe: 5940, fecha: "2026-07-28", proveedor: "POLLO BAL" },
  ]}];
  const r = S.conciliarSAT([
    { uuid: "AAAAAAAA-1111-2222-3333-444444444444", folio: "AAAAAAAA-1111-2222-3333-444444444444",
      serie: "", folioComp: "PBAL31832", proveedor: "POLLO BAL", fecha: "2026-07-28", total: 5940, tipo: "I" },
  ], "", "", "");
  assert.equal(r.conciliadas.length, 1, "cuadra por folio pese al guion");
  assert.equal(r.faltantes.length, 0);
});
t("una diferencia de monto REAL sí se reporta, con el gasto que le toca", () => {
  S.state.weeks = [{ id: "1", gastos: [
    { id: "1", factura: "F6533", importe: 10943.85, fecha: "2026-07-11", proveedor: "ASAEL" },
  ]}];
  const r = S.conciliarSAT([
    { uuid: "BBBBBBBB-1111-2222-3333-444444444444", folio: "BBBBBBBB-1111-2222-3333-444444444444",
      serie: "", folioComp: "F6533", proveedor: "ASAEL", fecha: "2026-07-11", total: 12000, tipo: "I" },
  ], "", "", "");
  assert.equal(r.diferencias.length, 1);
  close(r.diferencias[0].gastoCICSA.importe, 10943.85, 0.01);
  close(r.diferencias[0].diferencia, 1056.15, 0.01);
});

console.log("\n== nómina timbrada: agrupar por corrida y registrar el BRUTO ==");
const NOM = (fecha, per, ded, otros, total) =>
  ({ tipo: "N", fecha, total, nomina: { percepciones: per, deducciones: ded, otrosPagos: otros } });
t("los recibos se agrupan por corrida, no uno por trabajador", () => {
  // Julio real: 58 recibos en 5 corridas. Registrar 58 gastos sería inservible.
  const r = S.corridasDeNomina([
    NOM("2026-07-04", 1000, 10, 0, 990), NOM("2026-07-04", 2000, 20, 0, 1980),
    NOM("2026-07-10", 1500, 15, 0, 1485),
  ]);
  assert.equal(r.length, 2, "dos corridas");
  assert.equal(r[0].recibos, 2);
  close(r[0].bruto, 3000, 0.01);
  close(r[0].neto, 2970, 0.01);
});
t("el importe es el BRUTO, no el neto: las retenciones también salen de la caja", () => {
  const r = S.corridasDeNomina([NOM("2026-07-04", 124365.74, 719.13, 2.59, 123649.20)]);
  close(r[0].bruto, 124365.74, 0.01);
  close(r[0].neto, 123649.20, 0.01);
  assert.ok(r[0].bruto > r[0].neto, "el bruto es mayor");
});
t("solo entran los CFDI de nómina, y no los descartados", () => {
  const r = S.corridasDeNomina([
    NOM("2026-07-04", 1000, 0, 0, 1000),
    { tipo: "I", fecha: "2026-07-04", total: 5000 },
    { ...NOM("2026-07-04", 9999, 0, 0, 9999), ignorado: true },
  ]);
  assert.equal(r.length, 1);
  close(r[0].bruto, 1000, 0.01);
});
t("un recibo sin complemento se cuenta aparte, para poder avisar", () => {
  const r = S.corridasDeNomina([
    NOM("2026-07-04", 1000, 0, 0, 1000),
    { tipo: "N", fecha: "2026-07-04", total: 500 },   // guardado antes de leer el complemento
  ]);
  assert.equal(r[0].recibos, 2);
  assert.equal(r[0].sinDesglose, 1, "se avisa que falta desglose");
  close(r[0].bruto, 1000, 0.01, "no se inventa el bruto que falta");
});
t("el rango de fechas se respeta", () => {
  const cfdis = [NOM("2026-06-30", 100, 0, 0, 100), NOM("2026-07-15", 200, 0, 0, 200)];
  assert.equal(S.corridasDeNomina(cfdis, "2026-07-01", "2026-07-31").length, 1);
});
t("las corridas salen en orden cronológico", () => {
  const r = S.corridasDeNomina([NOM("2026-07-30", 1, 0, 0, 1), NOM("2026-07-04", 1, 0, 0, 1)]);
  assert.deepEqual(r.map(c => c.fecha), ["2026-07-04", "2026-07-30"]);
});
t("una corrida ya registrada se reconoce: duplicar una nómina descuadra el mes", () => {
  const gastos = [{ id: "1", _nominaCorrida: "2026-07-04", importe: 124365.74 }];
  assert.ok(S.corridaNominaRegistrada("2026-07-04", gastos));
  assert.ok(!S.corridaNominaRegistrada("2026-07-10", gastos));
  assert.ok(!S.corridaNominaRegistrada("", gastos), "sin fecha no se da por registrada");
});
t("el complemento de nómina se lee del XML", () => {
  const xml = '<cfdi:Comprobante Total="123649.20"><nomina12:Nomina TotalPercepciones="124365.74" TotalDeducciones="719.13" TotalOtrosPagos="2.59"/></cfdi:Comprobante>';
  const n = S._cfdiNomina(xml);
  close(n.percepciones, 124365.74, 0.01);
  close(n.deducciones, 719.13, 0.01);
  close(n.otrosPagos, 2.59, 0.01);
  assert.equal(S._cfdiNomina('<cfdi:Comprobante Total="100"/>'), null, "una factura normal no trae nómina");
});

console.log("\n== CFDI XML (conciliación SAT sin tokens) ==");
t("CFDI 4.0: extrae UUID, total (no SubTotal), fecha, RFC/nombre del EMISOR (no receptor)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="A" Folio="123" Fecha="2026-07-15T10:30:00" SubTotal="13967.33" Total="16201.10" Moneda="MXN">
  <cfdi:Emisor Rfc="CACX7605101P8" Nombre="ASAEL CRUZ"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="CICSA"/>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="A1B2C3D4-1234-5678-9ABC-DEF012345678"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
  const c = S.parseCFDIXML(xml);
  assert.ok(c, "debe parsear");
  close(c.total, 16201.10);                                  // Total, NO SubTotal
  assert.equal(c.fecha, "2026-07-15");                        // se recorta a YYYY-MM-DD
  assert.equal(c.rfc, "CACX7605101P8");                       // RFC del emisor, no del receptor
  assert.equal(c.proveedor, "ASAEL CRUZ");
  assert.equal(c.uuid, "A1B2C3D4-1234-5678-9ABC-DEF012345678");
  assert.equal(c.folio, c.uuid, "el folio de conciliación es el UUID");
});
t("CFDI 3.2 (atributos en minúscula) también se lee", () => {
  const xml = `<Comprobante total="500.00" fecha="2026-06-01T09:00:00" serie="B" folio="7"><Emisor rfc="AAA010101AAA" nombre="PROV UNO"/><Complemento><tfd:TimbreFiscalDigital UUID="U-2"/></Complemento></Comprobante>`;
  const c = S.parseCFDIXML(xml);
  assert.ok(c);
  close(c.total, 500.00);
  assert.equal(c.rfc, "AAA010101AAA");
  assert.equal(c.proveedor, "PROV UNO");
  assert.equal(c.uuid, "U-2");
});
t("un XML que no es CFDI regresa null", () => {
  assert.equal(S.parseCFDIXML(`<root><foo bar="1"/></root>`), null);
});
t("almacén CFDI: filtra por rango, agrupa por mes y saca YYYY-MM", () => {
  const store = [
    { uuid:"A", fecha:"2026-07-05", total:100 },
    { uuid:"B", fecha:"2026-07-12", total:200 },
    { uuid:"C", fecha:"2026-06-30", total:300 },
  ];
  assert.equal(S.cfdiMes("2026-07-12"), "2026-07");
  const rango = S.filtrarCfdisPorRango(store, "2026-07-07", "2026-07-14");
  assert.deepEqual(rango.map(c=>c.uuid), ["B"], "solo el que cae en el rango 7-14 jul");
  const g = S.agruparCfdisPorMes(store);
  assert.equal(g["2026-07"].length, 2);
  assert.equal(g["2026-06"].length, 1);
});

console.log("\n== migración de categorías ==");
t("renombra Limpieza/Plásticos → Artículos de limpieza (gastos, partidas, presupuesto) y blanco → Desechables (1 vez)", () => {
  S.CAT_RENAMES = { "Limpieza / Plásticos": "Artículos de limpieza" };
  let saves = 0; S.save = () => { saves++; };
  S.state = {
    budget: { "Limpieza / Plásticos": 5000, "Cárnicos": 80000 },
    weeks: [{ id: "w1", gastos: [
      { id: "g1", categoria: "Limpieza / Plásticos", importe: 100 },
      { id: "g2", categoria: "", importe: 16201.10 },          // el recuadro en blanco
      { id: "g3", categoria: "Cárnicos", importe: 200 },
      { id: "g4", _dividida: true, categoria: "Dividida", importe: 300,
        _partidas: [{ categoria: "Limpieza / Plásticos", importe: 120 }, { categoria: "", importe: 180 }] },
    ]}],
  };
  S.migrarCategorias();
  const g = S.state.weeks[0].gastos;
  assert.equal(g[0].categoria, "Artículos de limpieza");
  assert.equal(g[1].categoria, "Desechables");
  assert.equal(g[2].categoria, "Cárnicos");
  assert.equal(g[3]._partidas[0].categoria, "Artículos de limpieza");
  assert.equal(g[3]._partidas[1].categoria, "Desechables");
  assert.equal(S.state.budget["Artículos de limpieza"], 5000);
  assert.ok(!("Limpieza / Plásticos" in S.state.budget), "la llave vieja se elimina");
  assert.equal(S.state.migracionDesechables, true);
  // idempotente: correr de nuevo no reintroduce blancos ni cambia nada
  S.state.weeks[0].gastos.push({ id: "g5", categoria: "", importe: 9 });  // blanco NUEVO post-migración
  S.migrarCategorias();
  assert.equal(S.state.weeks[0].gastos[4].categoria, "", "un blanco nuevo NO se vuelve Desechables tras la migración única");
});

console.log("\n== mergeEstados (anti-sobrescritura multi-dispositivo) ==");
const wk = (id, obj) => ({ id, label: id, gastos: [], cortes: [], retiros: [], ...obj });
t("preserva capturas locales que el remoto (viejo) no tiene — el bug que perdió datos", () => {
  const remote = { weeks: [wk("w1", { gastos: [{ id: "g1", importe: 100 }] })] };
  const local  = { weeks: [wk("w1", { gastos: [{ id: "g1", importe: 100 }, { id: "g2", importe: 200 }],
                                       cortes: [{ id: "c1", monto: 50 }], retiros: [{ id: "r1", monto: 10 }] })] };
  const m = S.mergeEstados(remote, local);
  const w = m.weeks.find(x => x.id === "w1");
  assert.deepEqual(w.gastos.map(g => g.id).sort(), ["g1", "g2"]);
  assert.equal(w.cortes.length, 1);
  assert.equal(w.retiros.length, 1);
});
t("une adiciones de DOS dispositivos distintos (remoto tiene C, local tiene B)", () => {
  const remote = { weeks: [wk("w1", { gastos: [{ id: "A" }, { id: "C" }] })] };
  const local  = { weeks: [wk("w1", { gastos: [{ id: "A" }, { id: "B" }] })] };
  const m = S.mergeEstados(remote, local);
  assert.deepEqual(m.weeks[0].gastos.map(g => g.id).sort(), ["A", "B", "C"]);
});
t("tombstone: lo borrado localmente NO revive aunque el remoto aún lo tenga", () => {
  const remote = { weeks: [wk("w1", { gastos: [{ id: "A" }, { id: "B" }] })] };
  const local  = { weeks: [wk("w1", { gastos: [{ id: "A" }] })], tombstones: [{ id: "B", ts: Date.now() }] };
  const m = S.mergeEstados(remote, local);
  assert.deepEqual(m.weeks[0].gastos.map(g => g.id), ["A"]);
});
t("semana nueva en un dispositivo aparece tras fusionar", () => {
  const remote = { weeks: [wk("w1")] };
  const local  = { weeks: [wk("w1"), wk("w2", { gastos: [{ id: "g9" }] })] };
  const m = S.mergeEstados(remote, local);
  assert.deepEqual(m.weeks.map(w => w.id), ["w1", "w2"]);
});
t("en conflicto de mismo id, gana la versión local (edición más reciente de este equipo)", () => {
  const remote = { weeks: [wk("w1", { gastos: [{ id: "g1", importe: 100 }] })] };
  const local  = { weeks: [wk("w1", { gastos: [{ id: "g1", importe: 175 }] })] };
  const m = S.mergeEstados(remote, local);
  close(m.weeks[0].gastos[0].importe, 175);
});
t("budget y cajaSaldoInicial se unen por llave", () => {
  const remote = { weeks: [], budget: { "Cárnicos": 80000, "Hielo": 40000 }, cajaSaldoInicial: { "2026-07-01": { valor: 100 } } };
  const local  = { weeks: [], budget: { "Cárnicos": 90000, "Gas": 10000 }, cajaSaldoInicial: { "2026-07-08": { valor: 200 } } };
  const m = S.mergeEstados(remote, local);
  assert.equal(m.budget["Cárnicos"], 90000);      // local gana
  assert.equal(m.budget["Hielo"], 40000);          // remoto se conserva
  assert.equal(m.budget["Gas"], 10000);
  assert.equal(Object.keys(m.cajaSaldoInicial).length, 2);
});

console.log("\n== CFDI: qué es realmente un gasto ==");
// Caso real: la Consulta del SAT devolvía facturas emitidas por la propia CICSA
// (RFC CIC190426SD4) y complementos de pago, y la conciliación pedía capturarlos.
const RFC_CICSA = "CIC190426SD4";
const cfdisReales = [
  { folio: "B876F3AC", rfc: RFC_CICSA, proveedor: "COMEDORES INDUSTRIALES DE CUAUHTEMOC", fecha: "2026-07-04", total: 1837.80, tipo: "I" },
  { folio: "09B01E9A", rfc: RFC_CICSA, proveedor: "COMEDORES INDUSTRIALES DE CUAUHTEMOC", fecha: "2026-07-10", total: 970.20,  tipo: "P" },
  { folio: "A5909D50", rfc: RFC_CICSA, proveedor: "COMEDORES INDUSTRIALES DE CUAUHTEMOC", fecha: "2026-07-25", total: 2205.20, tipo: "P" },
  { folio: "WM-001",   rfc: "WMA991231AAA", proveedor: "NUEVA WAL MART DE MEXICO", fecha: "2026-07-06", total: 24946.02, tipo: "I" },
  { folio: "PB-315",   rfc: "PBA010101BBB", proveedor: "POLLO BAL", fecha: "2026-07-07", total: 26484, tipo: "I" },
  { folio: "PB-315P",  rfc: "PBA010101BBB", proveedor: "POLLO BAL", fecha: "2026-07-12", total: 26484, tipo: "P" },
];
t("las facturas que emite la propia empresa no son gastos", () => {
  const r = S.filtrarCfdisConciliables(cfdisReales, RFC_CICSA);
  assert.ok(!r.utiles.some(c => c.rfc === RFC_CICSA), "quedó un CFDI emitido por la empresa");
  // Solo la factura (tipo I) cuenta como "emitida por la empresa = ingreso". Sus dos
  // complementos de pago se reportan como complementos, que es lo que son.
  assert.equal(r.omitidos.PROPIO, 1);
});
t("un recibo de nómina propio NO se reporta como ingreso", () => {
  // La nómina la emite SIEMPRE la propia empresa: revisando primero el emisor, 58 recibos
  // salían como "facturas que emitió tu empresa (son ingresos)". No son ingresos.
  const r = S.filtrarCfdisConciliables([
    { folio: "N-1", rfc: RFC_CICSA, proveedor: "COMEDORES INDUSTRIALES DE CUAUHTEMOC",
      fecha: "2026-07-04", total: 2145.50, tipo: "N" },
  ], RFC_CICSA);
  assert.equal(r.omitidos.N, 1, "se cuenta como recibo de nómina");
  assert.ok(!r.omitidos.PROPIO, "y no como ingreso");
  assert.equal(r.utiles.length, 0, "sigue sin pedirse capturar");
});
t("el complemento de pago de un proveedor no se pide capturar", () => {
  const r = S.filtrarCfdisConciliables(cfdisReales, RFC_CICSA);
  assert.ok(!r.utiles.some(c => c.folio === "PB-315P"), "el complemento de pago pasó el filtro");
  // 3 en total: el de Pollo Bal y los dos que emitió la propia empresa — antes esos dos se
  // reportaban como "facturas que emitió tu empresa", escondiendo que eran complementos.
  assert.equal(r.omitidos.P, 3);
});
t("solo sobreviven las 2 facturas reales de proveedor (Walmart y Pollo Bal)", () => {
  const r = S.filtrarCfdisConciliables(cfdisReales, RFC_CICSA);
  assert.deepEqual(r.utiles.map(c => c.folio).sort(), ["PB-315", "WM-001"]);
});
t("sin RFC configurado se filtra por tipo, pero las propias siguen pasando", () => {
  const r = S.filtrarCfdisConciliables(cfdisReales, "");
  assert.equal(r.omitidos.P, 3);            // los 3 complementos de pago sí se van
  assert.equal(r.utiles.length, 3);         // quedan las 3 de tipo I
});
t("CFDIs viejos sin tipo (guardados antes del fix) no se descartan", () => {
  const r = S.filtrarCfdisConciliables([{ folio: "X", rfc: "OTRO010101XXX", total: 100 }], RFC_CICSA);
  assert.equal(r.utiles.length, 1);
});
t("nómina, traslado y nota de crédito quedan fuera", () => {
  const r = S.filtrarCfdisConciliables([
    { folio: "n", rfc: "A", total: 1, tipo: "N" },
    { folio: "t", rfc: "A", total: 1, tipo: "T" },
    { folio: "e", rfc: "A", total: 1, tipo: "E" },
    { folio: "i", rfc: "A", total: 1, tipo: "I" },
  ], "");
  assert.deepEqual(r.utiles.map(c => c.folio), ["i"]);
  assert.equal(r.omitidos.N, 1); assert.equal(r.omitidos.T, 1); assert.equal(r.omitidos.E, 1);
});
t("el tipo del Excel del SAT se lee como palabra o como letra", () => {
  assert.equal(S._cfdiTipoDesdeTexto("Pago"), "P");
  assert.equal(S._cfdiTipoDesdeTexto("Ingreso"), "I");
  assert.equal(S._cfdiTipoDesdeTexto("Egreso"), "E");
  assert.equal(S._cfdiTipoDesdeTexto("Nómina"), "N");
  assert.equal(S._cfdiTipoDesdeTexto("Traslado"), "T");
  assert.equal(S._cfdiTipoDesdeTexto("P"), "P");
  assert.equal(S._cfdiTipoDesdeTexto(""), "");
});
t("parseCFDIXML saca tipo y receptor del XML", () => {
  const xml = `<cfdi:Comprobante Version="4.0" Serie="A" Folio="12" Fecha="2026-07-10T10:00:00" SubTotal="0" Total="0" TipoDeComprobante="P">
    <cfdi:Emisor Rfc="${RFC_CICSA}" Nombre="COMEDORES INDUSTRIALES DE CUAUHTEMOC"/>
    <cfdi:Receptor Rfc="CLI010101AAA" Nombre="CLIENTE SA"/>
    <tfd:TimbreFiscalDigital UUID="09B01E9A-23DA-4AD0-0000-000000000000"/></cfdi:Comprobante>`;
  const c = S.parseCFDIXML(xml);
  assert.equal(c.tipo, "P");
  assert.equal(c.rfc, RFC_CICSA);
  assert.equal(c.rfcReceptor, "CLI010101AAA");
  assert.equal(S.filtrarCfdisConciliables([c], RFC_CICSA).utiles.length, 0);
});

t("el RFC propio se deduce: es el único que aparece en TODOS los comprobantes", () => {
  // Empate a propósito: 3 facturas emitidas a un cliente grande y 3 recibidas de proveedores.
  // Contar solo receptores daría empate y podía elegir al cliente; contar ambos papeles no falla.
  const mezcla = [
    { rfc: RFC_CICSA, rfcReceptor: "CLIENTE01AAA" }, { rfc: RFC_CICSA, rfcReceptor: "CLIENTE01AAA" },
    { rfc: RFC_CICSA, rfcReceptor: "CLIENTE01AAA" }, { rfc: "WMA991231AAA", rfcReceptor: RFC_CICSA },
    { rfc: "PBA010101BBB", rfcReceptor: RFC_CICSA }, { rfc: "EVA010101CCC", rfcReceptor: RFC_CICSA },
  ];
  S.localStorage.removeItem("cicsa_rfc_propio");
  assert.equal(S.autodetectarRfcPropio(mezcla), RFC_CICSA);
});
t("sin mayoría clara no adivina el RFC: lo deja en blanco", () => {
  S.localStorage.removeItem("cicsa_rfc_propio");
  assert.equal(S.autodetectarRfcPropio([{ rfc: "A", rfcReceptor: "B" }, { rfc: "C", rfcReceptor: "D" },
                                        { rfc: "E", rfcReceptor: "F" }, { rfc: "G", rfcReceptor: "H" }]), "");
});

t("un CFDI descartado a mano deja de pedirse (y se cuenta aparte)", () => {
  const r = S.filtrarCfdisConciliables([
    { folio: "a", rfc: "PROV1", total: 100, tipo: "I" },
    { folio: "b", rfc: "PROV1", total: 200, tipo: "I", ignorado: true },
  ], RFC_CICSA);
  assert.deepEqual(r.utiles.map(c => c.folio), ["a"]);
  assert.equal(r.omitidos.DESCARTADO, 1);
});
t("el gasto capturado desde un CFDI queda conciliado por UUID, aunque cambien folio y monto", () => {
  const UUID = "PB-315-UUID";
  S.state = { activeWeek: "w1", weeks: [{ id: "w1", cortes: [], retiros: [], gastos: [
    // El usuario tecleó el folio del proveedor y ajustó el importe: el UUID lo salva.
    { id: "g1", fecha: "2026-07-07", proveedor: "POLLO BAL", factura: "31598", importe: 26000, cfdiUuid: UUID },
  ] }] };
  const r = S.conciliarSAT([{ folio: UUID, uuid: UUID, rfc: "PBA010101BBB", proveedor: "POLLO BAL",
                              fecha: "2026-07-07", total: 26484, tipo: "I" }], "2026-07-01", "2026-07-31", RFC_CICSA);
  assert.equal(r.faltantes.length, 0, "quedó como faltante pese al UUID");
  assert.equal(r.diferencias.length, 1, "la diferencia de monto sí debe reportarse");
});
t("sin el UUID, un folio distinto y monto distinto sí sale como faltante", () => {
  S.state = { activeWeek: "w1", weeks: [{ id: "w1", cortes: [], retiros: [], gastos: [
    { id: "g1", fecha: "2026-07-07", proveedor: "POLLO BAL", factura: "31598", importe: 26000 },
  ] }] };
  const r = S.conciliarSAT([{ folio: "OTRO-UUID", uuid: "OTRO-UUID", rfc: "PBA010101BBB",
                              proveedor: "POLLO BAL", fecha: "2026-07-07", total: 26484, tipo: "I" }],
                            "2026-07-01", "2026-07-31", RFC_CICSA);
  assert.equal(r.faltantes.length, 1);
});

console.log("\n== Gmail: facturas ya revisadas ==");
const adj = (n, b64, msg) => ({ filename: n, data_b64: b64, msg_id: msg || ("m-" + n), sender: "prov@x.com", subject: "Factura" });
t("la huella distingue archivos y repite en el mismo contenido", () => {
  const a = S._gmailHuella("JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+Pg==");
  assert.equal(a, S._gmailHuella("JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+Pg=="));
  assert.notEqual(a, S._gmailHuella("JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2d+Pg=="));
  assert.equal(S._gmailHuella(""), "");
});
t("el mismo PDF reenviado en OTRO correo y con OTRO nombre se detecta", () => {
  // Es el caso que se colaba: msg_id distinto y filename distinto, mismo archivo.
  S.state = { activeWeek: "w1", weeks: [{ id: "w1", cortes: [], retiros: [], gastos: [] }] };
  S._gmailRevisados = [{ id: "h1", huella: S._gmailHuella("AAAA"), estado: "capturado", por: "Fernando" }];
  const r = S.filterGmailDuplicates([adj("factura_reenviada.pdf", "AAAA", "msg-nuevo")]);
  assert.equal(r[0]._isDup, true);
  assert.ok(/Ya revisada por Fernando/.test(r[0]._dupReason), r[0]._dupReason);
});
t("lo descartado por un compañero no le reaparece a nadie", () => {
  S._gmailRevisados = [{ id: "h1", huella: S._gmailHuella("BBBB"), estado: "descartado", por: "Ana" }];
  const r = S.filterGmailDuplicates([adj("promo.pdf", "BBBB")]);
  assert.ok(/Ya descartada por Ana/.test(r[0]._dupReason), r[0]._dupReason);
});
t("el mismo adjunto repetido dentro de una descarga se marca una sola vez", () => {
  S._gmailRevisados = [];
  const r = S.filterGmailDuplicates([adj("a.pdf", "CCCC", "m1"), adj("b.pdf", "CCCC", "m2")]);
  assert.equal(r[0]._isDup, false, "el primero debe pasar");
  assert.equal(r[1]._isDup, true, "el segundo es la repetición");
  assert.ok(/Repetida en esta descarga/.test(r[1]._dupReason), r[1]._dupReason);
});
t("una factura genuinamente nueva no se marca", () => {
  S._gmailRevisados = [{ id: "h1", huella: S._gmailHuella("AAAA"), estado: "capturado", por: "Fernando" }];
  const r = S.filterGmailDuplicates([adj("nueva.pdf", "ZZZZ", "m9")]);
  assert.equal(r[0]._isDup, false);
  assert.ok(r[0]._huella);
});
t("se conserva la detección por msg_id contra los gastos ya capturados", () => {
  S._gmailRevisados = [];
  S.state = { activeWeek: "w1", weeks: [{ id: "w1", cortes: [], retiros: [], gastos: [
    { id: "g1", _gmailMsgId: "m-viejo", _gmailFile: "walmart.pdf", importe: 100, fecha: "2026-07-01" } ] }] };
  assert.equal(S.filterGmailDuplicates([adj("otro.pdf", "QQQQ", "m-viejo")])[0]._dupReason, "Ya capturada");
  assert.equal(S.filterGmailDuplicates([adj("walmart.pdf", "WWWW", "m-otro")])[0]._dupReason, "Archivo ya procesado");
});

console.log("\n== Categorías editables ==");
const CATS_FAB = ["Cárnicos","Lácteos / Cremería","Frutas y Verduras","Tortilla","Abarrotes / Secos",
  "Refrescos / Pepsi","Hielo","Gas","Artículos de limpieza","Desechables","Mantenimiento y Equipo",
  "Transporte / Combustible","Servicios (Basura, Agua, Luz)","Nómina / Personal","Gastos Generales","Otro"];
t("sin lista propia se usan las categorías de fábrica", () => {
  S.state = { weeks: [], budget: {} };
  assert.deepEqual(S.catsActuales(), CATS_FAB);
});
t("con lista propia manda la del admin", () => {
  S.state = { weeks: [], budget: {}, categorias: ["Cárnicos", "Pescados y Mariscos"] };
  assert.deepEqual(S.catsActuales(), ["Cárnicos", "Pescados y Mariscos"]);
});
t("no deja duplicar una categoría aunque cambie mayúsculas o acentos", () => {
  S.state = { weeks: [], budget: {}, categorias: ["Cárnicos", "Tortilla"] };
  assert.equal(S._catExiste("CARNICOS"), true);
  assert.equal(S._catExiste("cárnicos"), true);
  assert.equal(S._catExiste("Pescados"), false);
});
t("renombrar arrastra gastos, partidas y presupuesto (el dinero no se pierde)", () => {
  S.state = {
    weeks: [{ id: "w1", cortes: [], retiros: [], gastos: [
      { id: "g1", categoria: "Hielo", importe: 500 },
      { id: "g2", categoria: "Tortilla", importe: 100 },
      { id: "g3", categoria: "Mixto", importe: 300, _partidas: [{ categoria: "Hielo", importe: 300 }] },
    ] }],
    budget: { "Hielo": 40000, "Tortilla": 60000 },
    categorias: ["Hielo", "Tortilla"],
  };
  const n = S.renombrarCategoriaEnEstado("Hielo", "Hielo y Agua");
  assert.equal(n, 2, "debe tocar el gasto y la partida");
  assert.equal(S.state.weeks[0].gastos[0].categoria, "Hielo y Agua");
  assert.equal(S.state.weeks[0].gastos[2]._partidas[0].categoria, "Hielo y Agua");
  assert.equal(S.state.budget["Hielo y Agua"], 40000);
  assert.equal(S.state.budget["Hielo"], undefined);
  assert.deepEqual(S.state.categorias, ["Hielo y Agua", "Tortilla"]);
});
t("renombrar hacia una categoría existente FUSIONA sin dejarla duplicada", () => {
  S.state = {
    weeks: [{ id: "w1", cortes: [], retiros: [], gastos: [{ id: "g1", categoria: "Refrescos", importe: 700 }] }],
    budget: { "Refrescos": 1000, "Refrescos / Pepsi": 100000 },
    categorias: ["Refrescos", "Refrescos / Pepsi"],
  };
  S.renombrarCategoriaEnEstado("Refrescos", "Refrescos / Pepsi");
  assert.deepEqual(S.state.categorias, ["Refrescos / Pepsi"], "no debe quedar duplicada");
  assert.equal(S.state.weeks[0].gastos[0].categoria, "Refrescos / Pepsi");
  assert.equal(S.state.budget["Refrescos / Pepsi"], 100000, "no debe pisar el presupuesto del destino");
});
t("reasignar una categoría suelta (la tarjeta sin nombre) la mete a una real", () => {
  // Caso real de la pantalla: gastos con categoria "" sumando $11,290.30.
  S.state = {
    weeks: [{ id: "w1", cortes: [], retiros: [], gastos: [{ id: "g1", categoria: "", importe: 11290.30 }] }],
    budget: {}, categorias: ["Gastos Generales"],
  };
  S.renombrarCategoriaEnEstado("", "Gastos Generales");
  assert.equal(S.state.weeks[0].gastos[0].categoria, "Gastos Generales");
  assert.deepEqual(S.state.categorias, ["Gastos Generales"], "no debe agregar la vacía a la lista");
});

console.log("\n== Presupuesto proporcional al rango ==");
const F = (ini, fin) => S.factorPresupuestoPeriodo({ modo: "rango", ini, fin });
t("una semana guardada vale 1, sin importar sus días", () => {
  const r = S.factorPresupuestoPeriodo({ modo: "semana", weekId: "w1" });
  assert.equal(r.factor, 1); assert.equal(r.esRango, false);
});
t("un rango de 7 días es exactamente una semana", () => {
  const r = F("2026-07-27", "2026-08-02");
  assert.equal(r.dias, 7); close(r.factor, 1);
});
t("julio completo (31 días) = 4.43 semanas", () => {
  const r = F("2026-07-01", "2026-07-31");
  assert.equal(r.dias, 31); close(r.factor, 31 / 7, 0.0001);
});
t("un solo día es un séptimo de la semana", () => {
  const r = F("2026-07-15", "2026-07-15");
  assert.equal(r.dias, 1); close(r.factor, 1 / 7, 0.0001);
});
t("una quincena escala la meta de Cárnicos de 80,000 a 171,428.57", () => {
  S.state = { weeks: [], budget: { "Cárnicos": 80000 } };
  const f = F("2026-07-01", "2026-07-15").factor;   // 15 días
  close(S.presupCatPeriodo("Cárnicos", f), 80000 * 15 / 7, 0.01);
});
t("en modo semana la meta no se toca (cifras reales de la pantalla)", () => {
  S.state = { weeks: [], budget: { "Cárnicos": 80000, "Tortilla": 60000 } };
  close(S.presupCatPeriodo("Cárnicos", 1), 80000);
  close(S.presupCatPeriodo("Tortilla", 1), 60000);
});
t("una categoría sin presupuesto sigue en cero por más largo que sea el rango", () => {
  S.state = { weeks: [], budget: {} };
  close(S.presupCatPeriodo("Hielo", F("2026-01-01", "2026-12-31").factor), 0);
});
t("fechas inválidas no rompen el cálculo: cae a factor 1", () => {
  assert.equal(S.factorPresupuestoPeriodo({ modo: "rango", ini: "", fin: "" }).factor, 1);
  assert.equal(S.factorPresupuestoPeriodo({ modo: "rango", ini: "no-es-fecha", fin: "tampoco" }).factor, 1);
});
t("el gasto de un mes deja de verse excedido contra la meta semanal", () => {
  // Caso reportado: $87,824.18 gastados en el mes contra $440,000 semanal se veía
  // bien, pero por categoría todo salía en rojo. Tortilla: 29,200 gastados en 31 días.
  S.state = { weeks: [], budget: { "Tortilla": 60000 } };
  const semanal = S.presupCatPeriodo("Tortilla", 1);
  const mensual = S.presupCatPeriodo("Tortilla", F("2026-07-01", "2026-07-31").factor);
  assert.ok(mensual > semanal * 4, "el mes debe valer más de 4 semanas");
  close(mensual, 60000 * 31 / 7, 0.01);
});

console.log("\n== Fecha de corte: ocultar histórico mal capturado ==");
const CORTE = "2026-06-28";
const semanaCon = (gastos, extra) => [{ id: "w1", label: "s", cortes: [], retiros: [], gastos, ...(extra || {}) }];
t("sin corte configurado no se filtra nada", () => {
  S.state = { weeks: semanaCon([{ id: "a", fecha: "2026-01-05", importe: 100 }]), budget: {} };
  assert.equal(S.fechaCorteDatos(), "");
  assert.equal(S.allGastosAllWeeks().length, 1);
});
t("una fecha inválida se ignora (no oculta nada por accidente)", () => {
  S.state = { weeks: semanaCon([{ id: "a", fecha: "2026-01-05", importe: 100 }]), budget: {}, fechaCorte: "28/06/2026" };
  assert.equal(S.fechaCorteDatos(), "");
  assert.equal(S.allGastosAllWeeks().length, 1, "no debe ocultar con una fecha mal escrita");
});
t("con corte, lo anterior desaparece y el propio día del corte se conserva", () => {
  S.state = { budget: {}, fechaCorte: CORTE, weeks: semanaCon([
    { id: "viejo",  fecha: "2026-06-27", importe: 500 },
    { id: "borde",  fecha: "2026-06-28", importe: 300 },   // el día del corte SÍ entra
    { id: "nuevo",  fecha: "2026-07-15", importe: 200 },
  ]) };
  assert.deepEqual(S.allGastosAllWeeks().map(g => g.id), ["borde", "nuevo"]);
});
t("un gasto SIN fecha se conserva: no hay forma de saber si es viejo", () => {
  S.state = { budget: {}, fechaCorte: CORTE, weeks: semanaCon([
    { id: "sinFecha", importe: 900 }, { id: "viejo", fecha: "2026-05-01", importe: 100 },
  ]) };
  assert.deepEqual(S.allGastosAllWeeks().map(g => g.id), ["sinFecha"]);
});
t("los cortes y retiros de caja también respetan el corte", () => {
  S.state = { budget: {}, fechaCorte: CORTE, weeks: [{ id: "w1", label: "s", gastos: [],
    cortes:  [{ fecha: "2026-06-01", monto: 1000 }, { fecha: "2026-07-01", monto: 2000 }],
    retiros: [{ fecha: "2026-06-10", monto: 300 },  { fecha: "2026-07-05", monto: 400 }] }] };
  assert.deepEqual(S.todosLosCortes().map(c => c.monto), [2000]);
  assert.deepEqual(S.todosLosRetiros().map(r => r.monto), [400]);
});
t("el corte se refleja en los totales por categoría del periodo", () => {
  S.state = { budget: {}, fechaCorte: CORTE, activeWeek: "w1",
    weeks: semanaCon([
      { id: "v", fecha: "2026-06-20", categoria: "Cárnicos", importe: 5000 },
      { id: "n", fecha: "2026-07-02", categoria: "Cárnicos", importe: 1500 },
    ], { ini: "2026-06-01", fin: "2026-07-31" }) };
  S.localStorage.setItem("cicsa_periodo_seg_pres", JSON.stringify({ modo: "rango", ini: "2026-06-01", fin: "2026-07-31" }));
  close(S.totalesPorCatPeriodo()["Cárnicos"], 1500, 0.01);
});
t("contarAntesDelCorte dice cuánto se va a ocultar antes de aplicarlo", () => {
  S.state = { budget: {}, weeks: semanaCon([
    { id: "a", fecha: "2026-06-01", importe: 1200.50 },
    { id: "b", fecha: "2026-06-27", importe: 800.25 },
    { id: "c", fecha: "2026-07-01", importe: 999 },
  ]) };
  const r = S.contarAntesDelCorte(CORTE);
  assert.equal(r.n, 2); close(r.monto, 2000.75, 0.01);
});
t("quitar el corte devuelve TODO el histórico (es reversible)", () => {
  const gastos = [{ id: "a", fecha: "2026-01-01", importe: 10 }, { id: "b", fecha: "2026-07-01", importe: 20 }];
  S.state = { budget: {}, fechaCorte: CORTE, weeks: semanaCon(gastos) };
  assert.equal(S.allGastosAllWeeks().length, 1);
  S.state.fechaCorte = "";
  assert.equal(S.allGastosAllWeeks().length, 2, "al quitar el corte deben volver todos");
});

t("la conciliación SAT no pide capturar comprobantes del periodo ya cerrado", () => {
  // Sin esto, los gastos quedaban ocultos por el corte pero los CFDIs no, así que TODO el
  // periodo cerrado reaparecía como "falta capturar" — el trabajo que el corte evita.
  S.state = { budget: {}, fechaCorte: "2026-07-01", weeks: semanaCon([
    { id: "n", fecha: "2026-07-08", proveedor: "POLLO BAL", factura: "31598", importe: 26484 },
  ]) };
  const r = S.conciliarSAT([
    { folio: "VIEJO-1", uuid: "VIEJO-1", rfc: "PBA010101BBB", proveedor: "POLLO BAL", fecha: "2026-05-10", total: 9000, tipo: "I" },
    { folio: "VIEJO-2", uuid: "VIEJO-2", rfc: "EVA010101CCC", proveedor: "EVA MOTA",  fecha: "2026-06-30", total: 4000, tipo: "I" },
    { folio: "NUEVO",   uuid: "NUEVO",   rfc: "PBA010101BBB", proveedor: "POLLO BAL", fecha: "2026-07-08", total: 26484, tipo: "I" },
  ], "2026-01-01", "2026-12-31", "CIC190426SD4");
  assert.equal(r.faltantes.length, 0, "no debe pedir capturar nada del periodo cerrado");
  assert.equal(r.conciliadas.length, 1);
  assert.equal(r.omitidos.CORTE, 2, "los 2 viejos se cuentan aparte, no se esconden en silencio");
});
t("sin corte, los CFDIs viejos siguen apareciendo (no cambia el comportamiento previo)", () => {
  S.state = { budget: {}, weeks: semanaCon([]) };
  const r = S.conciliarSAT([
    { folio: "V", uuid: "V", rfc: "X", proveedor: "P", fecha: "2026-05-10", total: 9000, tipo: "I" },
  ], "2026-01-01", "2026-12-31", "CIC190426SD4");
  assert.equal(r.faltantes.length, 1);
  assert.equal(r.omitidos.CORTE, undefined);
});

console.log("\n== Facturas divididas que no cuadran ==");
const dividida = (id, total, partidas) => ({ id, fecha: "2026-07-10", importe: total,
  _dividida: true, categoria: "Dividida", _partidas: partidas });
t("detecta la factura cuyo desglose no cubre el total", () => {
  const g = dividida("f1", 10000, [{ categoria: "Abarrotes", importe: 6000 }, { categoria: "Lácteos", importe: 3601.65 }]);
  const r = S.divididasDescuadradas([g]);
  assert.equal(r.length, 1);
  close(r[0].diff, 398.35, 0.01);   // el hueco real del reporte
});
t("una división que cuadra no se reporta, ni por centavos de redondeo", () => {
  assert.equal(S.divididasDescuadradas([
    dividida("ok", 10000, [{ categoria: "A", importe: 6000 }, { categoria: "B", importe: 4000 }]),
    dividida("centavo", 100, [{ categoria: "A", importe: 99.98 }]),
  ]).length, 0);
});
t("una factura normal (no dividida) nunca se reporta", () => {
  assert.equal(S.divididasDescuadradas([{ id: "n", importe: 500, categoria: "Cárnicos" }]).length, 0);
});
t("el prorrateo reparte la diferencia en proporción y suma EXACTO el total", () => {
  const ps = S.prorratearPartidas([{ categoria: "A", importe: 6000 }, { categoria: "B", importe: 3601.65 }], 10000);
  const suma = ps.reduce((s, p) => s + p.importe, 0);
  close(suma, 10000, 0.001);
  assert.ok(ps[0].importe > 6000 && ps[1].importe > 3601.65, "ambas deben subir");
  assert.ok(ps[0].importe > ps[1].importe, "la mayor se lleva más");
});
t("prorratear cuando SOBRA dinero baja las partidas y sigue cuadrando", () => {
  const ps = S.prorratearPartidas([{ categoria: "A", importe: 7000 }, { categoria: "B", importe: 4000 }], 10000);
  close(ps.reduce((s, p) => s + p.importe, 0), 10000, 0.001);
  assert.ok(ps[0].importe < 7000 && ps[1].importe < 4000);
});
t("el redondeo no deja centavos sueltos (tres partes iguales de $100)", () => {
  const ps = S.prorratearPartidas([{ categoria: "A", importe: 1 }, { categoria: "B", importe: 1 }, { categoria: "C", importe: 1 }], 100);
  close(ps.reduce((s, p) => s + p.importe, 0), 100, 0.001);
});
t("prorratear no rompe si las partidas suman cero", () => {
  const ps = S.prorratearPartidas([{ categoria: "A", importe: 0 }], 500);
  assert.equal(ps.length, 1);
});
t("tras prorratear, el detector ya no la marca", () => {
  const g = dividida("f1", 10000, [{ categoria: "A", importe: 6000 }, { categoria: "B", importe: 3601.65 }]);
  g._partidas = S.prorratearPartidas(g._partidas, g.importe);
  assert.equal(S.divididasDescuadradas([g]).length, 0);
});

console.log("\n== Nombres canónicos: evitar variantes antes de que existan ==");
t("una categoría que solo cambia en mayúsculas usa la grafía OFICIAL", () => {
  S.state = { weeks: [], budget: {}, categorias: ["Agua Purificada", "Cárnicos"] };
  assert.equal(S.canonizarCategoria("agua purificada"), "Agua Purificada");
  assert.equal(S.canonizarCategoria("AGUA PURIFICADA"), "Agua Purificada");
  assert.equal(S.canonizarCategoria("CARNICOS"), "Cárnicos", "también sin acentos");
});
t("si no está en la lista oficial, respeta la primera grafía ya usada", () => {
  S.state = { budget: {}, categorias: ["Cárnicos"], weeks: [{ id: "w1", cortes: [], retiros: [],
    gastos: [{ id: "a", categoria: "Mant Software", importe: 100 }] }] };
  assert.equal(S.canonizarCategoria("MANT SOFTWARE"), "Mant Software");
  assert.equal(S.canonizarCategoria("mant software"), "Mant Software");
});
t("una categoría genuinamente nueva pasa tal cual", () => {
  S.state = { weeks: [], budget: {}, categorias: ["Cárnicos"] };
  assert.equal(S.canonizarCategoria("  Fletes  "), "Fletes", "solo se recortan espacios");
  assert.equal(S.canonizarCategoria(""), "");
});
t("NO fusiona nombres que difieren en algo más que mayúsculas o acentos", () => {
  // Es la lección de los alias de productos: aproximar acaba juntando cosas distintas.
  S.state = { weeks: [], budget: {}, categorias: ["RENTA DEPTO CICSA"] };
  assert.equal(S.canonizarCategoria("renta depto"), "renta depto", "son categorías distintas");
});
t("el proveedor reusa el nombre que ya existe en los gastos", () => {
  S.state = { budget: {}, weeks: [{ id: "w1", cortes: [], retiros: [],
    gastos: [{ id: "a", proveedor: "GAS EXPRESS NIETO", importe: 100 }] }] };
  assert.equal(S.canonizarProveedor("Gas Express Nieto"), "GAS EXPRESS NIETO");
  assert.equal(S.canonizarProveedor("gas express nieto"), "GAS EXPRESS NIETO");
  assert.equal(S.canonizarProveedor("POLLO BAL"), "POLLO BAL", "uno nuevo pasa tal cual");
});
t("detecta los grupos de variantes y elige la oficial como canónica", () => {
  S.state = { budget: {}, categorias: ["Agua Purificada"], weeks: [{ id: "w1", cortes: [], retiros: [],
    gastos: [
      { id: "a", categoria: "Agua Purificada", importe: 35470.50 },
      { id: "b", categoria: "agua purificada", importe: 18190.00 },
      { id: "c", categoria: "Cárnicos", importe: 5000 },
    ] }] };
  const g = S.variantesDeCategoria();
  assert.equal(g.length, 1, "solo un grupo con variantes");
  assert.equal(g[0].canon, "Agua Purificada");
  assert.deepEqual(g[0].variantes, ["agua purificada"]);
  close(g[0].monto, 53660.50, 0.01);
});
t("sin lista oficial, gana la variante con más dinero", () => {
  S.state = { budget: {}, categorias: ["Cárnicos"], weeks: [{ id: "w1", cortes: [], retiros: [],
    gastos: [
      { id: "a", categoria: "mant software", importe: 500 },
      { id: "b", categoria: "MANT SOFTWARE", importe: 9940 },
    ] }] };
  assert.equal(S.variantesDeCategoria()[0].canon, "MANT SOFTWARE");
});
t("las variantes dentro de facturas divididas también se detectan", () => {
  S.state = { budget: {}, categorias: [], weeks: [{ id: "w1", cortes: [], retiros: [], gastos: [
    { id: "d", categoria: "Dividida", importe: 300, _dividida: true, _partidas: [
      { categoria: "Desechables", importe: 200 }, { categoria: "DESECHABLES", importe: 100 }] }] }] };
  const g = S.variantesDeCategoria();
  assert.equal(g.length, 1);
  close(g[0].monto, 300, 0.01);
});

console.log("\n== Variantes invisibles (mismo texto, distintos espacios) ==");
t("dos categorías que se ven IGUAL en pantalla se reconocen como la misma", () => {
  // El HTML colapsa los espacios: "MANT SOFTWARE" y "MANT  SOFTWARE" se pintan idénticas.
  assert.equal(S._normCat("MANT SOFTWARE"), S._normCat("MANT  SOFTWARE"));
  assert.equal(S._normCat("MANT SOFTWARE"), S._normCat("MANT SOFTWARE "));
  assert.equal(S._normCat("RENTA DEPTO CICSA"), S._normCat(" RENTA  DEPTO CICSA "));
  assert.equal(S._normCat("Mant Software"), S._normCat("MANT\u00a0SOFTWARE"), "espacio no separable");
});
t("las dos tarjetas repetidas se unifican en un solo grupo", () => {
  S.state = { budget: {}, categorias: ["MANT SOFTWARE", "RENTA DEPTO CICSA"], weeks: [{ id: "w1",
    cortes: [], retiros: [], gastos: [
      { id: "a", categoria: "MANT SOFTWARE",   importe: 10440 },
      { id: "b", categoria: "MANT  SOFTWARE",  importe: 8000 },
      { id: "c", categoria: "RENTA DEPTO CICSA",  importe: 4500 },
      { id: "d", categoria: "RENTA DEPTO CICSA ", importe: 15000 },
    ] }] };
  const g = S.variantesDeCategoria().sort((a, b) => a.canon.localeCompare(b.canon));
  assert.equal(g.length, 2, "los dos pares repetidos");
  assert.equal(g[0].canon, "MANT SOFTWARE");        close(g[0].monto, 18440, 0.01);
  assert.equal(g[1].canon, "RENTA DEPTO CICSA");    close(g[1].monto, 19500, 0.01);
  g.forEach(x => x.variantes.forEach(v => S.renombrarCategoriaEnEstado(v, x.canon)));
  assert.deepEqual(S._categoriasEnUso().sort(), ["MANT SOFTWARE", "RENTA DEPTO CICSA"]);
  assert.equal(S.variantesDeCategoria().length, 0, "ya no queda ninguna repetida");
});
t("al capturar, un nombre con espacios de más nace ya limpio", () => {
  S.state = { weeks: [], budget: {}, categorias: ["Cárnicos"] };
  assert.equal(S.canonizarCategoria("  Mant   Software  "), "Mant Software");
});
t("sigue sin fusionar categorías realmente distintas", () => {
  assert.notEqual(S._normCat("RENTA DEPTO CICSA"), S._normCat("renta depto"));
});

console.log("\n== Balance operativo del periodo ==");
const RFC_YO = "CIC190426SD4";
const semBal = (gastos, cortes, retiros) => [{ id: "w1", label: "s", ini: "2026-06-29", fin: "2026-07-26",
  gastos: gastos || [], cortes: cortes || [], retiros: retiros || [] }];
t("suma lo facturado (subtotal) más el efectivo, y resta los egresos", () => {
  S.state = { budget: {}, weeks: semBal(
    [{ id: "g1", fecha: "2026-07-05", importe: 300000 }, { id: "g2", fecha: "2026-07-10", importe: 200000 }],
    [{ fecha: "2026-07-06", monto: 80000 }, { fecha: "2026-07-13", monto: 70000 }]) };
  const r = S.balanceOperativo([
    { rfc: RFC_YO, fecha: "2026-07-08", subtotal: 500000, total: 580000, tipo: "I" },
  ], "2026-06-29", "2026-07-26", RFC_YO);
  close(r.facturado, 500000, 0.01);            // subtotal, NO el total con IVA
  close(r.efectivo, 150000, 0.01);
  close(r.entradas, 650000, 0.01);
  close(r.salidas, 500000, 0.01);
  close(r.resultado, 150000, 0.01);
  close(r.margen, 150000 / 650000 * 100, 0.01);
});
t("el IVA no cuenta como ingreso", () => {
  S.state = { budget: {}, weeks: semBal([], []) };
  const r = S.balanceOperativo([{ rfc: RFC_YO, fecha: "2026-07-08", subtotal: 100000, total: 116000, tipo: "I" }],
    "2026-06-29", "2026-07-26", RFC_YO);
  close(r.facturado, 100000, 0.01);
});
t("solo cuenta lo que EMITIÓ la empresa, no lo que le facturan", () => {
  S.state = { budget: {}, weeks: semBal([], []) };
  const r = S.balanceOperativo([
    { rfc: RFC_YO,          fecha: "2026-07-08", subtotal: 100000, tipo: "I" },
    { rfc: "PBA010101BBB",  fecha: "2026-07-09", subtotal: 26484,  tipo: "I" },   // proveedor: es egreso
  ], "2026-06-29", "2026-07-26", RFC_YO);
  close(r.facturado, 100000, 0.01);
  assert.equal(r.nFacturas, 1);
});
t("complementos de pago no son venta nueva; las notas de crédito restan", () => {
  S.state = { budget: {}, weeks: semBal([], []) };
  const r = S.balanceOperativo([
    { rfc: RFC_YO, fecha: "2026-07-08", subtotal: 100000, tipo: "I" },
    { rfc: RFC_YO, fecha: "2026-07-09", subtotal: 100000, tipo: "P" },   // complemento: no suma
    { rfc: RFC_YO, fecha: "2026-07-10", subtotal: 5000,   tipo: "E" },   // nota de crédito: resta
  ], "2026-06-29", "2026-07-26", RFC_YO);
  close(r.facturado, 100000, 0.01);
  close(r.notasCredito, 5000, 0.01);
  close(r.entradas, 95000, 0.01);
});
t("los retiros de caja NO son salida (se informan aparte)", () => {
  S.state = { budget: {}, weeks: semBal(
    [{ id: "g1", fecha: "2026-07-05", importe: 100000 }], [{ fecha: "2026-07-06", monto: 50000 }],
    [{ fecha: "2026-07-07", monto: 30000 }]) };
  const r = S.balanceOperativo([], "2026-06-29", "2026-07-26", RFC_YO);
  close(r.salidas, 100000, 0.01, "el retiro no debe sumarse a las salidas");
  close(r.retiros, 30000, 0.01);
});
t("un periodo con más salidas que entradas da resultado negativo", () => {
  S.state = { budget: {}, weeks: semBal([{ id: "g1", fecha: "2026-07-05", importe: 900000 }], []) };
  const r = S.balanceOperativo([{ rfc: RFC_YO, fecha: "2026-07-08", subtotal: 500000, tipo: "I" }],
    "2026-06-29", "2026-07-26", RFC_YO);
  close(r.resultado, -400000, 0.01);
  assert.ok(r.resultado < 0);
});
t("un CFDI descartado a mano no entra al balance", () => {
  S.state = { budget: {}, weeks: semBal([], []) };
  const r = S.balanceOperativo([{ rfc: RFC_YO, fecha: "2026-07-08", subtotal: 100000, tipo: "I", ignorado: true }],
    "2026-06-29", "2026-07-26", RFC_YO);
  close(r.facturado, 0, 0.01);
});
t("sin RFC configurado no inventa ingresos", () => {
  S.state = { budget: {}, weeks: semBal([], []) };
  const r = S.balanceOperativo([{ rfc: RFC_YO, fecha: "2026-07-08", subtotal: 100000, tipo: "I" }],
    "2026-06-29", "2026-07-26", "");
  close(r.facturado, 0, 0.01);
});
t("un CFDI viejo sin subtotal cae al total, en vez de contarse como cero", () => {
  S.state = { budget: {}, weeks: semBal([], []) };
  const r = S.balanceOperativo([{ rfc: RFC_YO, fecha: "2026-07-08", total: 58000, tipo: "I" }],
    "2026-06-29", "2026-07-26", RFC_YO);
  close(r.facturado, 58000, 0.01);
});
t("lo de fuera del periodo no entra", () => {
  S.state = { budget: {}, weeks: semBal(
    [{ id: "g1", fecha: "2026-05-01", importe: 999999 }], [{ fecha: "2026-05-02", monto: 999999 }]) };
  const r = S.balanceOperativo([{ rfc: RFC_YO, fecha: "2026-05-03", subtotal: 999999, tipo: "I" }],
    "2026-06-29", "2026-07-26", RFC_YO);
  close(r.entradas, 0, 0.01); close(r.salidas, 0, 0.01);
});

console.log("\n== Desglose de ingresos (para conciliar contra estimaciones) ==");
t("cada factura emitida sale con su folio legible y su cliente", () => {
  S.state = { budget: {}, weeks: [{ id: "w1", gastos: [], retiros: [],
    cortes: [{ fecha: "2026-07-06", label: "Lunes", monto: 80000 }] }] };
  const d = S.ingresosDetalle([
    { rfc: RFC_YO, fecha: "2026-07-08", subtotal: 500000, serie: "A", folioComp: "1024",
      nombreReceptor: "CLIENTE COMEDOR SA", tipo: "I", uuid: "UUID-1" },
  ], "2026-06-29", "2026-07-26", RFC_YO);
  assert.equal(d.facturas.length, 1);
  assert.equal(d.facturas[0].folio, "A1024", "serie + folio, no el UUID");
  assert.equal(d.facturas[0].cliente, "CLIENTE COMEDOR SA");
  close(d.facturas[0].monto, 500000, 0.01);
  assert.equal(d.cortes.length, 1);
  assert.equal(d.cortes[0].label, "Lunes");
});
t("una factura sin folio cae al UUID, no se queda en blanco", () => {
  S.state = { budget: {}, weeks: [{ id: "w1", gastos: [], cortes: [], retiros: [] }] };
  const d = S.ingresosDetalle([{ rfc: RFC_YO, fecha: "2026-07-08", subtotal: 1000, tipo: "I",
    uuid: "B876F3AC-8DD9-455D-0000-000000000001" }], "2026-06-29", "2026-07-26", RFC_YO);
  assert.equal(d.facturas[0].folio, "B876F3AC");
  assert.equal(d.facturas[0].cliente, "—", "sin receptor guardado");
});
t("la nota de crédito aparece en negativo y marcada", () => {
  S.state = { budget: {}, weeks: [{ id: "w1", gastos: [], cortes: [], retiros: [] }] };
  const d = S.ingresosDetalle([
    { rfc: RFC_YO, fecha: "2026-07-08", subtotal: 100000, tipo: "I", uuid: "u1" },
    { rfc: RFC_YO, fecha: "2026-07-20", subtotal: 5000,   tipo: "E", uuid: "u2" },
  ], "2026-06-29", "2026-07-26", RFC_YO);
  assert.equal(d.facturas.length, 2);
  const nc = d.facturas.find(f => f.tipo === "E");
  close(nc.monto, -5000, 0.01);
});
t("el detalle suma exactamente lo que reporta el balance", () => {
  S.state = { budget: {}, weeks: [{ id: "w1", gastos: [], retiros: [],
    cortes: [{ fecha: "2026-07-06", monto: 80000 }, { fecha: "2026-07-13", monto: 70000 }] }] };
  const cf = [
    { rfc: RFC_YO, fecha: "2026-07-08", subtotal: 500000, tipo: "I", uuid: "u1" },
    { rfc: RFC_YO, fecha: "2026-07-15", subtotal: 300000, tipo: "I", uuid: "u2" },
    { rfc: RFC_YO, fecha: "2026-07-16", subtotal: 300000, tipo: "P", uuid: "u3" },  // no es venta
    { rfc: "OTRO010101XXX", fecha: "2026-07-09", subtotal: 26484, tipo: "I", uuid: "u4" },
  ];
  const b = S.balanceOperativo(cf, "2026-06-29", "2026-07-26", RFC_YO);
  const d = S.ingresosDetalle(cf, "2026-06-29", "2026-07-26", RFC_YO);
  close(d.facturas.reduce((s, f) => s + f.monto, 0), b.facturado - b.notasCredito, 0.01);
  close(d.cortes.reduce((s, c) => s + c.monto, 0), b.efectivo, 0.01);
  assert.equal(d.facturas.length, 2, "el complemento de pago y el CFDI ajeno no entran");
});
t("el detalle sale ordenado por fecha", () => {
  S.state = { budget: {}, weeks: [{ id: "w1", gastos: [], cortes: [], retiros: [] }] };
  const d = S.ingresosDetalle([
    { rfc: RFC_YO, fecha: "2026-07-20", subtotal: 1, tipo: "I", uuid: "c" },
    { rfc: RFC_YO, fecha: "2026-07-01", subtotal: 1, tipo: "I", uuid: "a" },
    { rfc: RFC_YO, fecha: "2026-07-10", subtotal: 1, tipo: "I", uuid: "b" },
  ], "2026-06-29", "2026-07-26", RFC_YO);
  assert.deepEqual(d.facturas.map(f => f.fecha), ["2026-07-01", "2026-07-10", "2026-07-20"]);
});

// ── Autenticación contra Firebase Storage ───────────────────────────────
// El bug real: se mandaba «Bearer <idToken>», que Storage no reconoce — trataba la petición
// como anónima, las reglas devolvían 403, la subida fallaba en silencio y la factura no se
// podía abrir. El SDK oficial manda «Firebase <idToken>».
const setScheme = (v) => vm.runInContext("_storageAuthScheme = " + JSON.stringify(v) + ";", sandbox);
const getScheme = () => vm.runInContext("_storageAuthScheme", sandbox);
// Devuelve [fn, llamadas]: fn responde ok solo al esquema indicado.
function fetchQueAcepta(esquema) {
  const llamadas = [];
  return [async (url, o) => {
    const h = (o && o.headers && o.headers.Authorization) || "";
    llamadas.push(h);
    return h.startsWith(esquema + " ") ? { ok: true, status: 200 } : { ok: false, status: 403 };
  }, llamadas];
}
// ── Filtro de categoría en Auditoría ────────────────────────────────────
// El bug: "" ya significaba "todas", así que al saltar desde Presupuesto a las facturas SIN
// categoría el filtro llegaba vacío y la pantalla mostraba TODO. Ahora va un centinela.
// ── Respaldos ───────────────────────────────────────────────────────────
// Toda la contabilidad vive en un solo documento que se reescribe completo. Sin copias, un
// borrado o una fusión mala eran irreversibles.
// ── Escapado de texto del usuario ───────────────────────────────────────
// El nombre del proveedor lo escribe cualquiera del equipo (y a veces lo extrae la IA de una
// factura) y termina en innerHTML. Sin escapar, un nombre con comillas ejecuta código en la
// sesión de quien abra la pantalla — incluido el admin.
console.log("\n== Escapado de texto del usuario ==");
t("esc neutraliza los cinco caracteres que rompen el HTML", () => {
  assert.equal(S.esc('<img src=x>'), "&lt;img src=x&gt;");
  assert.equal(S.esc('a"b'), "a&quot;b");
  assert.equal(S.esc("a'b"), "a&#39;b");
  assert.equal(S.esc("a&b"), "a&amp;b");
  assert.equal(S.esc("<&>"), "&lt;&amp;&gt;");   // el & primero, si no se doblan las entidades
});
t("esc no inventa nada con null, undefined ni números", () => {
  assert.equal(S.esc(null), ""); assert.equal(S.esc(undefined), "");
  assert.equal(S.esc(0), "0"); assert.equal(S.esc("ACME"), "ACME");
});
t("escAttrJs escapa para JavaScript ANTES que para HTML", () => {
  // La comilla simple sale como \' (escape de JS) y luego como entidad (escape de HTML):
  // al decodificar el navegador queda \' dentro de la cadena de JS.
  assert.equal(S.escAttrJs("O'BRIEN"), "O\\&#39;BRIEN");
  // La comilla doble es la que cierra el atributo: tiene que salir como entidad.
  assert.ok(!S.escAttrJs('ACME" onfocus="x').includes('"'), "no puede quedar una comilla doble cruda");
  // La diagonal invertida se dobla, si no se comería el escape siguiente.
  assert.equal(S.escAttrJs("a\\b"), "a\\\\b");
});
// BUG REAL, cerrado el 2026-08-28: el panel de usuarios metia el nombre en un onclick con
// JSON.stringify(nombre).replace(/"/g,'&quot;'). Eso escapa la comilla doble, pero NO el &.
// Un nombre que contuviera el texto literal "&quot;" pasaba entero al atributo, el analizador
// de HTML lo decodificaba a una comilla de verdad, y el de JavaScript veia la cadena cerrada:
//   nombre  = a&quot;+alert(1)+&quot;b
//   atributo= editarNombreUsuario('uid', "a&quot;+alert(1)+&quot;b")
//   tras decodificar HTML -> editarNombreUsuario('uid', "a"+alert(1)+"b")   <- ejecuta
// escAttrJs escapa el & primero, asi que el &quot; se queda como texto y nunca vuelve a ser
// comilla. Solo lo podia disparar un usuario dado de alta, y contra el admin — que es quien
// abre ese panel.
t("un nombre con &quot; adentro no puede cerrar la cadena del onclick", () => {
  const r = S.escAttrJs('a&quot;+alert(1)+&quot;b');
  assert.ok(!/(^|[^&])&quot;/.test(r), "el &quot; del nombre tiene que quedar neutralizado");
  assert.ok(r.includes("&amp;quot;"), "el & se escapa primero, si no todo lo demas da igual");
  assert.ok(!r.includes('"'), "no puede quedar una comilla doble cruda");
});

t("escAttrJs deja inertes las cargas que se probaron en el navegador", () => {
  [`ACME" onfocus="window.x=1" autofocus q="`,
   `ACME' onmouseover='window.x=1' q='`,
   `<img src=x onerror="window.x=1">`].forEach(carga => {
    const r = S.escAttrJs(carga);
    assert.ok(!r.includes('"'), "sin comilla doble cruda: " + r);
    assert.ok(!r.includes("<"), "sin < crudo: " + r);
    // toda comilla simple que quede va precedida de su escape de JS
    assert.ok(!/(^|[^\\])&#39;/.test(r.replace(/\\&#39;/g, "")), "comilla simple sin escapar: " + r);
  });
});
t("los nombres normales sobreviven: el escape se deshace al mostrarse", () => {
  // El navegador decodifica las entidades, así que lo que ve el usuario es el texto original.
  const decodificar = (x) => x.replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&");
  [`MC DONALD'S`, `AGUA & HIELO`, `OFFICE DEPOT DE MÉXICO`, `CÍA "EL BUENO"`].forEach(n =>
    assert.equal(decodificar(S.esc(n)), n, n));
});

console.log("\n== Respaldos ==");
const estadoCon = (gastos, cortes) => ({ weeks: [
  { id: "w1", gastos: gastos.slice(0, Math.ceil(gastos.length / 2)), cortes: cortes || [], retiros: [] },
  { id: "w2", gastos: gastos.slice(Math.ceil(gastos.length / 2)), cortes: [], retiros: [] },
]});
t("el resumen cuenta gastos e importe de TODAS las semanas", () => {
  const r = S.resumenEstado(estadoCon(
    [{ importe: 100 }, { importe: 250.5 }, { importe: 49.5 }], [{ monto: 1 }, { monto: 2 }]));
  assert.equal(r.semanas, 2); assert.equal(r.gastos, 3);
  close(r.importe, 400); assert.equal(r.cortes, 2);
});
t("un estado vacío da cero, no explota", () => {
  assert.deepEqual(S.resumenEstado({ weeks: [] }), { semanas: 0, gastos: 0, cortes: 0, importe: 0 });
  assert.equal(S.resumenEstado(null).gastos, 0);
  assert.equal(S.resumenEstado({}).gastos, 0);
});
t("un importe corrupto no contamina el total", () => {
  const r = S.resumenEstado({ weeks: [{ gastos: [{ importe: 100 }, { importe: "x" }, { importe: null }] }] });
  assert.equal(r.gastos, 3); close(r.importe, 100);
});
t("solo pasa por respaldo válido lo que tiene semanas", () => {
  assert.equal(S._estadoValido({ weeks: [] }), true);
  ["", null, undefined, 42, "texto", {}, { weeks: "no" }, []].forEach(x =>
    assert.equal(S._estadoValido(x), false, JSON.stringify(x) + " no debería pasar"));
});
console.log("\n== Filtro de categoría en Auditoría ==");
const GASTOS_CAT = [
  { id: "a", fecha: "2026-07-05", proveedor: "POLLO", categoria: "Cárnicos", importe: 100 },
  { id: "b", fecha: "2026-07-06", proveedor: "MISTERIO 1", categoria: "", importe: 20000 },
  { id: "c", fecha: "2026-07-07", proveedor: "MISTERIO 2", importe: 3059.01 },          // ni la clave existe
  { id: "d", fecha: "2026-07-08", proveedor: "MIXTA", categoria: "Cárnicos", importe: 500,
    _dividida: true, _partidas: [{ categoria: "Cárnicos", importe: 300 }, { categoria: "", importe: 200 }] },
  { id: "e", fecha: "2026-08-01", proveedor: "FUERA DE RANGO", categoria: "", importe: 999 },
];
const conFiltro = (f) => {
  S.state = { budget: {}, weeks: [{ id: "w1", gastos: GASTOS_CAT, cortes: [], retiros: [] }] };
  S.__dom = { rFechaIni: "2026-07-01", rFechaFin: "2026-07-31", rCategoria: f, rProveedor: "" };
  return S.gastosFiltradosReporte().map(g => g.id);
};
t("sin filtro salen todas las del rango", () => {
  assert.deepEqual(conFiltro("").sort(), ["a", "b", "c", "d"]);
});
t("el centinela trae SOLO las facturas sin categoría", () => {
  assert.deepEqual(conFiltro("__SIN__").sort(), ["b", "c", "d"]);
});
t("una categoría normal no arrastra las que no tienen ninguna", () => {
  assert.deepEqual(conFiltro("Cárnicos").sort(), ["a", "d"]);
});
t("la factura dividida entra por su partida sin categoría, no por su encabezado", () => {
  const soloSin = conFiltro("__SIN__");
  assert.ok(soloSin.includes("d"), "tiene una partida sin categoría");
  S.__dom = { rFechaIni: "2026-07-01", rFechaFin: "2026-07-31", rCategoria: "__SIN__", rProveedor: "" };
  const g = S.gastosFiltradosReporte().find(x => x.id === "d");
  assert.equal(g.categoria, "Cárnicos", "el encabezado sí tiene categoría; entra por la partida");
});
t("el rango de fechas sigue mandando sobre el centinela", () => {
  assert.ok(!conFiltro("__SIN__").includes("e"), "agosto queda fuera del rango de julio");
});
t("el filtro de proveedor se combina con el centinela", () => {
  S.state = { budget: {}, weeks: [{ id: "w1", gastos: GASTOS_CAT, cortes: [], retiros: [] }] };
  S.__dom = { rFechaIni: "2026-07-01", rFechaFin: "2026-07-31", rCategoria: "__SIN__", rProveedor: "MISTERIO 1" };
  assert.deepEqual(S.gastosFiltradosReporte().map(g => g.id), ["b"]);
});

console.log("\n== Respaldos (asíncrono) ==");

async function pruebasStorage() {
  const T = tAsync;

  // Los espias PISABAN S.fbDeleteDoc / S.fbSet y no los devolvian nunca: cualquier prueba
  // posterior recibia el espia en vez de la funcion real y fallaba por un motivo que no tenia
  // nada que ver consigo misma. Se restauran al terminar.
  const _realDelete = S.fbDeleteDoc, _realSet = S.fbSet;
  const restaurarEspias = () => { S.fbDeleteDoc = _realDelete; S.fbSet = _realSet; };
  const espiarPoda = () => {
    const borrados = [], indices = [];
    S.fbDeleteDoc = async (col, id) => { borrados.push(col + "/" + id); };
    S.fbSet = async (path, data) => { indices.push({ path, data }); };
    return { borrados, indices };
  };
  const setRol = (r) => vm.runInContext(`currentRole = ${JSON.stringify(r)};`, sandbox);

  await T("la poda conserva los 30 más recientes y borra el resto", async () => {
    setRol("admin");
    const { borrados } = espiarPoda();
    // listarRespaldos ya entrega del más nuevo al más viejo
    const lista = Array.from({ length: 40 }, (_, i) =>
      ({ id: "respaldo-2026-06-" + String(40 - i).padStart(2, "0") }));
    const n = await S.podarRespaldos(lista);
    assert.equal(n, 10, "40 - 30 conservados");
    assert.equal(borrados.length, 10);
    assert.ok(borrados.every(b => b.startsWith("respaldos/respaldo-")));
    assert.ok(borrados.includes("respaldos/respaldo-2026-06-01"), "borra el más viejo");
    assert.ok(!borrados.includes("respaldos/respaldo-2026-06-40"), "conserva el más nuevo");
  });

  await T("la poda deja el índice sin lo que borró", async () => {
    setRol("admin");
    const { indices } = espiarPoda();
    const lista = Array.from({ length: 32 }, (_, i) =>
      ({ id: "respaldo-2026-06-" + String(32 - i).padStart(2, "0") }));
    await S.podarRespaldos(lista);
    assert.equal(indices.length, 1, "se reescribe el índice una vez");
    assert.equal(indices[0].path, "respaldos/_indice");
    assert.equal(indices[0].data.length, 30);
    assert.ok(!indices[0].data.some(x => x.id === "respaldo-2026-06-01"), "el borrado sale del índice");
  });

  await T("el _indice nunca se borra: no lleva el prefijo", async () => {
    setRol("admin");
    const { borrados } = espiarPoda();
    const lista = Array.from({ length: 35 }, (_, i) => ({ id: "respaldo-" + i }));
    lista.push({ id: "_indice" });                   // al final, en la zona de poda
    await S.podarRespaldos(lista);
    assert.ok(!borrados.some(b => b.endsWith("/_indice")), "el índice jamás se borra");
  });

  await T("un operativo no poda nada — borrar es solo del admin en las reglas", async () => {
    setRol("operativo");
    const { borrados } = espiarPoda();
    const n = await S.podarRespaldos(Array.from({ length: 40 }, (_, i) => ({ id: "respaldo-" + i })));
    assert.equal(n, 0); assert.equal(borrados.length, 0);
    setRol("admin");
  });

  await T("con 30 o menos no borra nada", async () => {
    setRol("admin");
    const { borrados } = espiarPoda();
    const n = await S.podarRespaldos(Array.from({ length: 30 }, (_, i) => ({ id: "respaldo-" + i })));
    assert.equal(n, 0); assert.equal(borrados.length, 0);
  });

  console.log("\n== Autenticación con Firebase Storage ==");

  await T("usa «Firebase <token>» — el esquema del SDK oficial, no «Bearer»", async () => {
    setScheme(null);
    const [f, llamadas] = fetchQueAcepta("Firebase");
    S.fetch = f;
    const r = await S.fetchStorage("https://storage/x");
    assert.ok(r.ok);
    assert.equal(llamadas.length, 1, "no debió reintentar: el primer esquema funcionó");
    assert.equal(llamadas[0], "Firebase TOKEN");
    assert.equal(getScheme(), "Firebase");
  });

  await T("si Storage rechaza «Firebase» con 403, reintenta con «Bearer»", async () => {
    setScheme(null);
    const [f, llamadas] = fetchQueAcepta("Bearer");
    S.fetch = f;
    const r = await S.fetchStorage("https://storage/x");
    assert.ok(r.ok, "el reintento debió funcionar");
    assert.deepEqual(llamadas, ["Firebase TOKEN", "Bearer TOKEN"]);
    assert.equal(getScheme(), "Bearer");
  });

  await T("una vez que sabe el esquema no vuelve a duplicar peticiones", async () => {
    setScheme("Bearer");
    const [f, llamadas] = fetchQueAcepta("Bearer");
    S.fetch = f;
    await S.fetchStorage("https://storage/x");
    await S.fetchStorage("https://storage/y");
    assert.equal(llamadas.length, 2, "una petición por factura, no dos");
  });

  await T("un 404 no dispara el reintento (no es problema de credencial)", async () => {
    setScheme(null);
    const llamadas = [];
    S.fetch = async (url, o) => { llamadas.push((o.headers||{}).Authorization); return { ok:false, status:404 }; };
    const r = await S.fetchStorage("https://storage/x");
    assert.equal(r.status, 404);
    assert.equal(llamadas.length, 1);
    assert.equal(getScheme(), null, "un 404 no confirma ningún esquema");
  });

  await T("si los dos esquemas fallan, devuelve el error original", async () => {
    setScheme(null);
    S.fetch = async () => ({ ok:false, status:403 });
    const r = await S.fetchStorage("https://storage/x");
    assert.equal(r.ok, false); assert.equal(r.status, 403);
    assert.equal(getScheme(), null, "no debe memorizar un esquema que no funcionó");
  });

  await T("sin sesión iniciada no manda cabecera de autorización", async () => {
    setScheme(null);
    const guardado = S.auth; S.auth = { currentUser: null };
    let vistas = null;
    S.fetch = async (url, o) => { vistas = (o && o.headers) || null; return { ok:true, status:200 }; };
    await S.fetchStorage("https://storage/x");
    assert.ok(!vistas || !vistas.Authorization, "sin usuario no hay token que mandar");
    S.auth = guardado;
  });

  await T("conserva método y cuerpo al reintentar la subida", async () => {
    setScheme(null);
    const vistas = [];
    S.fetch = async (url, o) => {
      vistas.push({ method:o.method, body:o.body, ct:(o.headers||{})["Content-Type"] });
      return { ok: ((o.headers||{}).Authorization||"").startsWith("Bearer "), status:403 };
    };
    await S.fetchStorage("https://storage/subir", { method:"POST", headers:{"Content-Type":"image/jpeg"}, body:"BLOB" });
    assert.equal(vistas.length, 2);
    vistas.forEach(v => { assert.equal(v.method, "POST"); assert.equal(v.body, "BLOB"); assert.equal(v.ct, "image/jpeg"); });
  });

  console.log("\n== Tipo de respaldo (imagen vs PDF) ==");

  await T("reconoce como imagen las URL de Storage con la ruta codificada", async () => {
    const u = (n) => "https://firebasestorage.googleapis.com/v0/b/b/o/" + encodeURIComponent("facturas/" + n);
    ["a.jpg", "a.jpeg", "a.PNG", "a.webp", "a.gif"].forEach(n =>
      assert.ok(S.esImagenRespaldo(u(n)), n + " debería contar como imagen"));
  });

  await T("un PDF (o un adjunto sin extensión conocida) no es imagen", async () => {
    const u = (n) => "https://firebasestorage.googleapis.com/v0/b/b/o/" + encodeURIComponent("facturas/" + n);
    ["a.pdf", "a.octet-stream", "a.xml", "sin_extension"].forEach(n =>
      assert.equal(S.esImagenRespaldo(u(n)), false, n + " no debería contar como imagen"));
    assert.equal(S.esImagenRespaldo(""), false);
    assert.equal(S.esImagenRespaldo(null), false);
  });

  restaurarEspias();   // que las pruebas de despues reciban las funciones reales
}

pruebasStorage().then(() => {
  // ── Importar cortes de Manejo de Cortes (contrato v2) ───────────────────
console.log("\n== Importar cortes de Manejo de Cortes ==");

// El ejemplo real del contrato v2 (recortado a lo esencial, mismos totales).
const archivoBase = () => ({
  version: 2, app: "cicsa-cortes-caja",
  periodo: { ini: "2026-08-01", fin: "2026-08-04" },
  emitido: "2026-08-05T18:24:00.000Z", saldoInicial: 9983.42,
  cortes: [
    { folio: "RCE-2026-00123", fecha: "2026-08-01", cajera: "JANE", turno: "1ERO",
      boletos25: 2725, contratistas: 960, otrosIngresos: 3065, terminal: 100, total: 6750 },
    { folio: "RCE-2026-00124", fecha: "2026-08-01", cajera: "KIKE", turno: "RUTA 1",
      boletos25: 925, contratistas: 240, otrosIngresos: 5, terminal: 0, total: 1170 },
  ],
  egresos: [
    { folio: "EGR-2026-00001", fecha: "2026-08-01", concepto: "RECARGA CELULAR", comprobante: "0001",
      autoriza: "DIANA IBARRA", monto: 100, clase: "gasto" },
    { folio: "EGR-2026-00005", fecha: "2026-08-03", concepto: "COMPRAS SAMS", comprobante: "ICAJG469779",
      autoriza: "XAVIER MINJAREZ", monto: 29487, clase: "gasto" },
    { folio: "EGR-2026-00003", fecha: "2026-08-01", concepto: "PAGO VUELO", comprobante: "0001",
      autoriza: "FRANCISCO GUAJARDO", monto: 10876, clase: "deposito" },
  ],
});

t("saldoInicial negativo del corte sirve para abrir el periodo siguiente en rojo", () => {
  // El importador escribe state.cajaSaldoInicial[periodo.ini] = { valor: saldoInicial }, y ese
  // valor puede ser negativo. La validación NO lo rechaza (es dato, no error).
  const a = archivoBase(); a.saldoInicial = -15563.83;
  assert.equal(S.validarArchivoCortes(a).ok, true);
  assert.ok(S._esNum(a.saldoInicial) && a.saldoInicial < 0, "un saldo negativo es un número válido");
});
t("un archivo bien formado pasa la validación", () => {
  assert.equal(S.validarArchivoCortes(archivoBase()).ok, true);
});
t("una aportacion con fecha invalida se rechaza", () => {
  const a = archivoBase();
  a.aportaciones = [{ folio:"APO-1", fecha:"no-es-fecha", monto:100 }];
  const v = S.validarArchivoCortes(a);
  assert.equal(v.ok, false);
  assert.ok(v.errores.some(e=>/Aportaci.*fecha/.test(e)));
});
t("una aportacion con monto invalido se rechaza", () => {
  // Entra al saldo como dinero, igual que un corte: un monto que no es numero lo envenena.
  const a = archivoBase();
  a.aportaciones = [{ folio:"APO-1", fecha:"2026-08-03", monto:"mucho" }];
  const v = S.validarArchivoCortes(a);
  assert.equal(v.ok, false);
  assert.ok(v.errores.some(e=>/Aportaci.*monto/.test(e)), "el error tiene que senialar el monto");
});
t("una aportacion sin folio se rechaza: sin folio no hay idempotencia", () => {
  const a = archivoBase();
  a.aportaciones = [{ fecha:"2026-08-03", monto:100 }];
  assert.ok(S.validarArchivoCortes(a).errores.some(e=>/Aportaci.*folio/.test(e)));
});
t("un folio de aportacion repetido dentro del archivo se caza", () => {
  const a = archivoBase();
  a.aportaciones = [{ folio:a.egresos[0].folio, fecha:"2026-08-03", monto:100 }];
  const v = S.validarArchivoCortes(a);
  assert.ok(v.errores.some(e=>/repetidos/i.test(e)));
});
t("sin aportaciones el archivo sigue siendo valido (v1 y v2 no las traen)", () => {
  const a = archivoBase(); delete a.aportaciones;
  assert.equal(S.validarArchivoCortes(a).ok, true);
});
t("rechaza versión desconocida", () => {
  const a = archivoBase(); a.version = 99;
  const r = S.validarArchivoCortes(a);
  assert.equal(r.ok, false); assert.ok(r.errores.some(e => /Versi/.test(e)));
});
t("rechaza un corte sin folio — es lo que evita duplicar", () => {
  const a = archivoBase(); delete a.cortes[0].folio;
  assert.equal(S.validarArchivoCortes(a).ok, false);
});
t("rechaza fecha en formato equivocado", () => {
  const a = archivoBase(); a.cortes[0].fecha = "01/08/2026";
  assert.equal(S.validarArchivoCortes(a).ok, false);
});
t("rechaza una columna de ingreso no numérica", () => {
  const a = archivoBase(); a.cortes[0].boletos25 = "$2,725.00";
  assert.equal(S.validarArchivoCortes(a).ok, false);
});
t("rechaza folios repetidos dentro del archivo", () => {
  const a = archivoBase(); a.egresos[1].folio = "EGR-2026-00001";
  const r = S.validarArchivoCortes(a);
  assert.equal(r.ok, false); assert.ok(r.errores.some(e => /repetid/i.test(e)));
});
t("un saldo inicial NEGATIVO es válido, no un error", () => {
  const a = archivoBase(); a.saldoInicial = -15563.83;
  assert.equal(S.validarArchivoCortes(a).ok, true);
});
t("acepta también la versión 1 del contrato", () => {
  const a = archivoBase(); a.version = 1;
  assert.equal(S.validarArchivoCortes(a).ok, true);
});

// La app de cortes pasó a la v3 y aquí no se actualizó la lista, así que el concentrado del mes
// se rechazaba de entrada con "Versión de archivo no reconocida (3)".
t("acepta la versión 3, que es la que exporta la app de cortes hoy", () => {
  const a = archivoBase(); a.version = 3;
  const r = S.validarArchivoCortes(a);
  assert.equal(r.ok, true, r.errores.join(" | "));
});
t("una versión que de verdad no se conoce se sigue rechazando", () => {
  const a = archivoBase(); a.version = 99;
  assert.equal(S.validarArchivoCortes(a).ok, false, "no se debe aceptar cualquier número");
});

// 'aportaciones' llegó con la v3 y esta pantalla no la importa. Tragárselo dejaría el saldo de
// caja corto sin explicación posible.
t("avisa que las aportaciones del archivo NO se importan", () => {
  const a = archivoBase();
  a.aportaciones = [{ folio: "APT-1", fecha: "2026-07-10", concepto: "Fondo", monto: 5000 }];
  const av = S.avisosControlCortes(a);
  assert.ok(av.some(x => /aportaci/i.test(x)), "debe mencionarlas");
  assert.ok(av.some(x => x.includes("5,000")), "debe decir cuánto dinero es");
});
t("sin aportaciones no inventa el aviso", () => {
  const a = archivoBase(); a.aportaciones = [];
  assert.ok(!S.avisosControlCortes(a).some(x => /aportaci/i.test(x)));
});

t("avisa si los totales no cuadran (archivo incompleto)", () => {
  const a = archivoBase();
  a.totales = { efectivo: 56067, egresos: 62121 };   // el archivo trae solo 2 cortes / 3 egresos
  const av = S.avisosControlCortes(a);
  assert.ok(av.length >= 1, "debe avisar que no cuadra");
});
t("sin totales no inventa avisos", () => {
  assert.deepEqual(S.avisosControlCortes(archivoBase()), []);
});

t("_pareceFolioFactura distingue folio de proveedor de vale interno", () => {
  assert.equal(S._pareceFolioFactura("ICAJG470108"), true);   // ticket de Sam's
  assert.equal(S._pareceFolioFactura("A-88213"), true);
  assert.equal(S._pareceFolioFactura("0005"), false);         // vale interno
  assert.equal(S._pareceFolioFactura("0007"), false);
  assert.equal(S._pareceFolioFactura("131862"), false);       // adelanto de nómina (numérico)
  assert.equal(S._pareceFolioFactura(""), false);
  assert.equal(S._pareceFolioFactura(null), false);
});
t("gastoMismoImporte caza por monto en fecha cercana AUNQUE el nombre difiera", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"g1", proveedor:"NUEVA WAL-MART DE MEXICO", factura:"A-88213", importe:5124, fecha:"2026-08-06" }
  ]}]};
  const m = S.gastoMismoImporte(5124, "2026-08-07");   // un día de diferencia
  assert.ok(m && m.id==="g1", "encuentra el gasto por importe, sin exigir el nombre");
});
t("gastoMismoImporte NO cruza contra otros renglones ya importados de un corte", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"c1", proveedor:"X", importe:5124, fecha:"2026-08-06", _folioEgreso:"EGR-1" }
  ]}]};
  assert.equal(S.gastoMismoImporte(5124, "2026-08-06"), null);
});
t("gastoMismoImporte ignora si la fecha está lejos", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"g1", proveedor:"X", importe:5124, fecha:"2026-07-01" }
  ]}]};
  assert.equal(S.gastoMismoImporte(5124, "2026-08-06"), null);
});
// El SAMS se SEÑALA, pero ya no se preselecciona "ignorar": la coincidencia es solo por importe
// y +-4 dias, sin mirar proveedor ni concepto. Con montos redondos engancha cualquier cosa (dos
// cargas de gas de $500, dos pagos de $20,000), y preseleccionar "ignorar" hacia que bastara con
// darle a Importar sin revisar para que el dinero desapareciera. Candidato, no veredicto.
t("el SAMS se SEÑALA por importe, pero entra como gasto — no se preselecciona ignorar", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"gmail", proveedor:"NUEVA WAL-MART DE MEXICO", factura:"A-88213", importe:5124, fecha:"2026-08-06" }
  ]}]};
  const c = S.clasificacionInicialEgreso({ concepto:"COMPRA SAMS", comprobante:"ICAJG470108", monto:5124, fecha:"2026-08-06", clase:"gasto" });
  assert.equal(c.clase, "gasto", "no se descuenta dinero sin que alguien lo confirme");
  assert.ok(c.dup, "pero se muestra el gasto parecido");
  assert.ok(c.aviso && /importe/i.test(c.aviso), "y se dice que la coincidencia es solo por importe");
});
// Una coincidencia FUERTE (mismo proveedor y misma factura) es literalmente el mismo documento.
// Antes eso arrancaba en "ignorar", y ahi se perdia el dinero: "ignorar" no crea gasto ni retiro
// y tampoco toca la factura que ya estaba. Si esa factura estaba como credito o transferencia, la
// salida de efectivo del concentrado no llegaba NUNCA a Caja, que solo suma esGastoEfectivo(). Lo
// correcto no es duplicar la factura ni descartar el movimiento: es vincularlos.
t("una coincidencia por proveedor+factura arranca en VINCULAR, no en ignorar", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"ya", proveedor:"COMPRA SAMS", factura:"ICAJG470108", importe:5124, fecha:"2026-08-06" }
  ]}]};
  const c = S.clasificacionInicialEgreso({ folio:"EGR-1", concepto:"COMPRA SAMS", comprobante:"ICAJG470108", monto:5124, fecha:"2026-08-06", clase:"gasto" });
  assert.equal(c.clase, "vincular_efectivo");
  assert.ok(c.dup && c.dup.gasto.id === "ya");
});
t("si la factura existente NO estaba en efectivo, el aviso lo dice", () => {
  // Es el caso que hacia desaparecer el dinero: la factura existe como credito, asi que la salida
  // de caja no contaba en ningun lado. Vincular es lo que la hace contar.
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"ya", proveedor:"COMPRA SAMS", factura:"ICAJG470108", importe:5124, fecha:"2026-08-06", formaPago:"credito" }
  ]}]};
  const c = S.clasificacionInicialEgreso({ folio:"EGR-1", concepto:"COMPRA SAMS", comprobante:"ICAJG470108", monto:5124, fecha:"2026-08-06" });
  assert.equal(c.clase, "vincular_efectivo");
  assert.ok(/NO esta registrada como pago de caja/.test(c.aviso.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
});
t("si la factura YA estaba en efectivo, se vincula sin duplicar el importe", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"ya", proveedor:"COMPRA SAMS", factura:"ICAJG470108", importe:5124, fecha:"2026-08-06", formaPago:"efectivo" }
  ]}]};
  const c = S.clasificacionInicialEgreso({ folio:"EGR-1", concepto:"COMPRA SAMS", comprobante:"ICAJG470108", monto:5124, fecha:"2026-08-06" });
  assert.equal(c.clase, "vincular_efectivo");
  assert.ok(/sin duplicar/.test(c.aviso));
});
t("una factura ya vinculada a otro folio NO se ofrece para vincular de nuevo", () => {
  // Vincularla dos veces seria decir que la misma factura se pago dos veces desde la caja.
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"ya", proveedor:"COMPRA SAMS", factura:"ICAJG470108", importe:5124, fecha:"2026-08-06", _folioEgreso:"EGR-OTRO" }
  ]}]};
  const c = S.clasificacionInicialEgreso({ folio:"EGR-1", concepto:"COMPRA SAMS", comprobante:"ICAJG470108", monto:5124, fecha:"2026-08-06" });
  assert.equal(c.clase, "ignorar");
  assert.ok(/EGR-OTRO/.test(c.aviso), "hay que decir con cual esta vinculada");
});
t("el aviso de comprobante-que-parece-factura NO se perdio al agregar vincular", () => {
  // Sobrevive de la version anterior: sin duplicado, un comprobante con letras puede ser una
  // factura que todavia no llega por Gmail/SAT, y hay que quedar pendiente de ella.
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[] }] };
  const c = S.clasificacionInicialEgreso({ folio:"EGR-1", concepto:"COMPRA SAMS", comprobante:"ICAJG470108", monto:5124, fecha:"2026-08-06" });
  assert.equal(c.clase, "gasto");
  assert.ok(/folio de factura/.test(c.aviso));
});
t("un egreso con comprobante de factura pero sin duplicado se avisa, no se ignora", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[] }] };
  const c = S.clasificacionInicialEgreso({ concepto:"COMPRA SAMS", comprobante:"ICAJG470108", monto:5124, fecha:"2026-08-06", clase:"gasto" });
  assert.equal(c.clase, "gasto");     // la factura quizá no ha llegado aún
  assert.ok(c.aviso, "avisa que el comprobante parece factura");
});
t("un vale interno normal no dispara ni ignore ni aviso", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[] }] };
  const c = S.clasificacionInicialEgreso({ concepto:"RECARGA CELULAR", comprobante:"0005", monto:100, fecha:"2026-08-05", clase:"gasto" });
  assert.equal(c.clase, "gasto");
  assert.ok(!c.aviso, "sin aviso para un vale interno");
});
t("clasificación inicial respeta la clase capturada", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", gastos:[], cortes:[], retiros:[] }] };
  const a = archivoBase();
  assert.equal(S.clasificacionInicialEgreso(a.egresos[0]).clase, "gasto");     // clase:gasto
  assert.equal(S.clasificacionInicialEgreso(a.egresos[2]).clase, "retiro");    // clase:deposito
});
t("clasificación inicial sugiere VINCULAR si ya existe un gasto igual", () => {
  // El SAMS ya está capturado (misma factura + proveedor): la factura entró por otro lado, pero el
  // efectivo sí salió del concentrado. Son el mismo hecho visto desde dos sistemas.
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"g1", proveedor:"COMPRAS SAMS", factura:"ICAJG469779", importe:29487, fecha:"2026-08-03" }
  ]}]};
  const a = archivoBase();
  const c = S.clasificacionInicialEgreso(a.egresos[1]);
  assert.equal(c.clase, "vincular_efectivo");
  assert.ok(c.dup, "trae el gasto que ya existía");
});
t("sin clase y sin duplicado, arranca como gasto", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", gastos:[], cortes:[], retiros:[] }] };
  const e = { folio:"EGR-9", fecha:"2026-08-01", concepto:"X", monto:50 };
  assert.equal(S.clasificacionInicialEgreso(e).clase, "gasto");
});

t("mergeEstados UNE los cortes ignorados de ambos dispositivos", () => {
  const r = S.mergeEstados(
    { weeks:[], cortesIgnorados:["EGR-1","EGR-2"] },
    { weeks:[], cortesIgnorados:["EGR-2","EGR-3"] });
  assert.deepEqual([...r.cortesIgnorados].sort(), ["EGR-1","EGR-2","EGR-3"]);
});
t("los folios ignorados se recuerdan, para que reimportar no los reofrezca", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", gastos:[], cortes:[], retiros:[] }],
    cortesIgnorados:["EGR-2026-00005"] };
  assert.ok(S.foliosCorteIgnorados().has("EGR-2026-00005"));
  assert.ok(!S.foliosCorteIgnorados().has("EGR-2026-00001"));
});
t("sin nada ignorado, el set queda vacío (no truena con estado limpio)", () => {
  S.state = { budget:{}, weeks:[] };
  assert.equal(S.foliosCorteIgnorados().size, 0);
});
t("los folios ya importados se detectan para no repetir", () => {
  S.state = { budget:{}, weeks:[{ id:"w1",
    cortes:[{ id:"c1", _folioCorte:"RCE-2026-00123" }],
    gastos:[{ id:"g1", _folioEgreso:"EGR-2026-00001" }],
    retiros:[{ id:"r1", _folioEgreso:"EGR-2026-00003" }] }]};
  assert.ok(S.foliosCorteImportados().has("RCE-2026-00123"));
  assert.ok(S.foliosEgresoImportados().has("EGR-2026-00001"));
  assert.ok(S.foliosEgresoImportados().has("EGR-2026-00003"));
  assert.ok(!S.foliosCorteImportados().has("RCE-2026-99999"));
});

  // Las pruebas encoladas corren AQUI, en fila, antes del resumen y antes de salir. Ponerlas
  // sueltas dejaba promesas sin esperar: se entremezclaban, compartian estado y process.exit
  // mataba el proceso antes de que terminaran.
  (async () => {
    for (const [nombre, fn] of _colaAsync) await tAsync(nombre, fn);
    console.log(`\n${pass} pasaron, ${fail} fallaron`);
    process.exit(fail ? 1 : 0);
  })();
});
