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
  const m = script.match(new RegExp("const\\s+" + name + "\\s*=\\s*\\[[\\s\\S]*?\\];"));
  if (!m) throw new Error("No encontré la constante: " + name);
  return m[0];
}
const CONSTS = ["CATS"];


const FUNCS = [
  "normalizarParaComparar", "posibleMismoIngrediente", "esGastoEfectivo",
  "formaPagoLabel", "partidasExpandidas", "contenidoTotalGramos",
  "precioPorUnidadBase", "diaSemanaLabel", "fechaLocalStr", "todayStr", "diasRestantes",
  "allGastosAllWeeks", "todosLosCortes", "todosLosRetiros",
  "findDuplicate", "saldoInicialSemana", "calcularSaldoAntesDe", "calcularSaldoCajaPeriodo",
  "conciliarSAT", "dedupeProductos", "rangoSemanaLabel", "aliasSospechosos",
  "fmt", "duplicadosSospechosos", "construirMapaPreciosMenu", "migrarCategorias", "consolidarFacturaDividida",
  "variantesLlaveMenu", "llavesMenuDeFila",
  "_desescaparXml", "unidadDesdeClaveSAT", "_cfdiConceptos", "preciosDesdeCfdis", "resolverPreciosCatalogo",
  "planIdentificacion", "_identSugerida", "_indiceNombresCatalogo", "decidirDestinoIdent",
  "resumenGmail", "_firmaEstado", "textoSync", "avisoGastoFueraDeVista",
  "gastosConFechaDudosa", "_fechaCorreoISO", "gastosQueSonComplemento", "bloqueoComplementoPago", "gastosConImporteDistinto",
  "_dupFolioCanon", "_dupFoliosEquivalentes", "_folioDeCfdi", "_dupNormProv", "_dupProvParecidos",
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
  "foliosCorteImportados", "foliosEgresoImportados", "foliosCorteIgnorados", "clasificacionInicialEgreso",
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
  fbSet: async () => {}, fbDeleteDoc: async () => {},
  fetch: async () => ({ ok: true, status: 200 }),
};
vm.createContext(sandbox);
for (const c of CONSTS) vm.runInContext(extractConst(c), sandbox);
vm.runInContext("const TOL_DIVIDIDA = 0.05;", sandbox);
vm.runInContext('const CORTES_VERSIONES_OK = [1, 2]; const CORTES_STORAGE_PREFIJO = "cortes";', sandbox);
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
t("saldoInicialSemana: semana 3 = cortes − efectivo − retiros de las 2 anteriores", () => {
  S.state.weeks = semanas;
  const r = S.saldoInicialSemana("3");
  close(r.saldo, 500 - 100 - 50 + 200); // transferencia NO resta
  assert.equal(r.fechaMin, "2026-06-01"); assert.equal(r.fechaMax, "2026-06-09");
});
t("saldoInicialSemana: primera semana → 0 sin movimientos", () => {
  S.state.weeks = semanas;
  const r = S.saldoInicialSemana("1");
  assert.equal(r.saldo, 0); assert.equal(r.n, 0);
});
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
  // Cada producto ocupa varias llaves (mayúsculas/acentos), así que lo que se compara es el
  // conjunto de ingredientes distintos, no el número de llaves.
  const distintos = [...new Set(Object.keys(nuevo).map(S.normalizarParaComparar))].sort();
  assert.deepEqual(distintos, ["cebolla", "papa a la francesa, papa frita"]);
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

console.log("\n== un gasto guardado que no se ve: hay que decirlo ==");
const PER = { ini: "2026-08-03", fin: "2026-08-09", label: "03 al 09 ago 2026" };
t("un gasto dentro del periodo no genera aviso", () => {
  assert.equal(S.avisoGastoFueraDeVista("2026-08-05", PER, ""), "");
  assert.equal(S.avisoGastoFueraDeVista("2026-08-03", PER, ""), "", "el primer día cuenta");
  assert.equal(S.avisoGastoFueraDeVista("2026-08-09", PER, ""), "", "el último también");
});
t("una factura de Gmail con fecha de otro periodo avisa que no se va a ver", () => {
  // El caso reportado: se captura desde Gmail, se guarda bien, y no aparece en Gastos,
  // Auditoría ni Presupuesto porque esas vistas filtran por FECHA, no por semana.
  const conSemana = [{ ini: "2026-07-13", fin: "2026-07-19" }];
  const m = S.avisoGastoFueraDeVista("2026-07-15", PER, "", conSemana);
  assert.ok(/FUERA del periodo/.test(m));
  assert.ok(/03 al 09 ago 2026/.test(m), "dice a qué periodo estás mirando");
  assert.ok(/Se guardó/.test(m), "deja claro que SÍ se guardó");
});
const SEMANAS = [{ ini: "2026-08-03", fin: "2026-08-09" }, { ini: "2026-08-17", fin: "2026-08-23" }];
t("una fecha posterior al periodo también avisa", () => {
  assert.ok(/FUERA del periodo/.test(S.avisoGastoFueraDeVista("2026-08-19", PER, "", SEMANAS)));
});
t("si NO existe la semana que cubre la fecha, se dice que hay que crearla", () => {
  // Caso real: facturas del 10 al 16 de agosto sin esa semana creada. Como las vistas filtran
  // por fecha y no por bolsa, no había NINGÚN periodo donde pudieran verse.
  const m = S.avisoGastoFueraDeVista("2026-08-12", PER, "", SEMANAS);
  assert.ok(/NO cae en ninguna semana creada/.test(m));
  assert.ok(/no hay que recapturarlo/.test(m), "hay que decir que el dato no se perdió");
  assert.ok(!/cámbiate/i.test(m), "no mandar a un periodo que no existe");
});
t("si la semana sí existe, se manda a cambiarse a ella", () => {
  const m = S.avisoGastoFueraDeVista("2026-08-19", PER, "", SEMANAS);
  assert.ok(/te cambies a la semana que le toca/.test(m));
  assert.ok(!/crea la semana/i.test(m));
});
t("los bordes de una semana existente cuentan como cubiertos", () => {
  assert.ok(/te cambies/.test(S.avisoGastoFueraDeVista("2026-08-17", PER, "", SEMANAS)), "primer día");
  assert.ok(/te cambies/.test(S.avisoGastoFueraDeVista("2026-08-23", PER, "", SEMANAS)), "último día");
  assert.ok(/ninguna semana creada/.test(S.avisoGastoFueraDeVista("2026-08-24", PER, "", SEMANAS)));
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
  assert.equal(r.omitidos.PROPIO, 3);
});
t("el complemento de pago de un proveedor no se pide capturar", () => {
  const r = S.filtrarCfdisConciliables(cfdisReales, RFC_CICSA);
  assert.ok(!r.utiles.some(c => c.folio === "PB-315P"), "el complemento de pago pasó el filtro");
  assert.equal(r.omitidos.P, 1);
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
t("el SAMS se caza al importar aunque la factura tenga nombre fiscal distinto", () => {
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"gmail", proveedor:"NUEVA WAL-MART DE MEXICO", factura:"A-88213", importe:5124, fecha:"2026-08-06" }
  ]}]};
  const c = S.clasificacionInicialEgreso({ concepto:"COMPRA SAMS", comprobante:"ICAJG470108", monto:5124, fecha:"2026-08-06", clase:"gasto" });
  assert.equal(c.clase, "ignorar");
  assert.ok(c.dup, "trae el gasto que ya existía por factura");
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
t("clasificación inicial sugiere 'ignorar' si ya existe un gasto igual", () => {
  // El SAMS ya está capturado (misma factura + proveedor): la factura entró por otro lado.
  S.state = { budget:{}, weeks:[{ id:"w1", cortes:[], retiros:[], gastos:[
    { id:"g1", proveedor:"COMPRAS SAMS", factura:"ICAJG469779", importe:29487, fecha:"2026-08-03" }
  ]}]};
  const a = archivoBase();
  const c = S.clasificacionInicialEgreso(a.egresos[1]);
  assert.equal(c.clase, "ignorar");
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

console.log(`\n${pass} pasaron, ${fail} fallaron`);
  process.exit(fail ? 1 : 0);
});
