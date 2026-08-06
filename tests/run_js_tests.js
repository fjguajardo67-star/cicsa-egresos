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
  let i = script.indexOf(decl);
  if (i === -1) { i = script.indexOf("async " + decl); }
  if (i === -1) throw new Error("No encontré la función: " + name);
  const bodyStart = script.indexOf("{", i);
  let depth = 0, inStr = null, inComment = null;
  for (let j = bodyStart; j < script.length; j++) {
    const c = script[j], p = script[j - 1];
    if (inComment === "//") { if (c === "\n") inComment = null; continue; }
    if (inComment === "/*") { if (p === "*" && c === "/") inComment = null; continue; }
    if (inStr) { if (c === inStr && p !== "\\") inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "/" && script[j + 1] === "/") { inComment = "//"; continue; }
    if (c === "/" && script[j + 1] === "*") { inComment = "/*"; continue; }
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
  "_dupFolioCanon", "_dupFoliosEquivalentes", "_dupNormProv", "_dupProvParecidos",
  "_unionPorId", "mergeEstados", "_cfdiAttr", "parseCFDIXML",
  "cfdiMes", "filtrarCfdisPorRango", "agruparCfdisPorMes",
  "_cfdiTipoDesdeTexto", "filtrarCfdisConciliables", "autodetectarRfcPropio",
  "rfcPropio", "guardarRfcPropio",
  "_gmailHuella", "filterGmailDuplicates",
  "catsActuales", "_catsEditable", "_catExiste", "renombrarCategoriaEnEstado",
];

const sandbox = {
  state: { weeks: [], activeWeek: null, budget: {} }, console,
  _gmailRevisados: null,
  // Stubs para consolidarFacturaDividida (efectos de UI/persistencia fuera de alcance del test).
  confirm: () => true, alert: () => {}, save: () => {}, marcarBorrado: () => {},
  renderRevisionDuplicados: () => {}, document: { getElementById: () => null },
  localStorage: (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })(),
};
vm.createContext(sandbox);
for (const c of CONSTS) vm.runInContext(extractConst(c), sandbox);
for (const f of FUNCS) vm.runInContext(extractFunction(f), sandbox);
const S = sandbox;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok - " + name); }
  catch (e) { fail++; console.error("  FAIL - " + name + "\n        " + e.message); }
}
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `esperaba ${b}, salió ${a}`);

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
  assert.deepEqual(Object.keys(nuevo).sort(), ["Cebolla", "Papa a la francesa, papa frita"]);
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
  assert.equal(Object.keys(nuevo).length, 1);
  close(nuevo["Elote"].precio, 30);
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

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
