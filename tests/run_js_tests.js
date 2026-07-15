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

const FUNCS = [
  "normalizarParaComparar", "posibleMismoIngrediente", "esGastoEfectivo",
  "formaPagoLabel", "partidasExpandidas", "contenidoTotalGramos",
  "precioPorUnidadBase", "diaSemanaLabel", "fechaLocalStr", "todayStr", "diasRestantes",
  "allGastosAllWeeks", "todosLosCortes", "todosLosRetiros",
  "findDuplicate", "saldoInicialSemana", "calcularSaldoAntesDe",
  "conciliarSAT", "dedupeProductos",
];

const sandbox = { state: { weeks: [], activeWeek: null, budget: {} }, console };
vm.createContext(sandbox);
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

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
