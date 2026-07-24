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
  "conciliarSAT", "dedupeProductos", "rangoSemanaLabel", "aliasSospechosos",
  "fmt", "duplicadosSospechosos", "migrarCategorias",
  "_unionPorId", "mergeEstados",
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
});
t("padre nuevo CON _partidas + una categoría suelta igual → sugiere borrar la suelta", () => {
  const r = S.duplicadosSospechosos([
    { id: "p1", proveedor: "WALMART", factura: "IBAGY272028", fecha: "2026-07-01", categoria: "Dividida", importe: 637.00,
      _dividida: true, _partidas: [{ categoria: "Abarrotes / Secos", importe: 400 }, { categoria: "Limpieza / Plásticos", importe: 237 }] },
    { id: "h1", proveedor: "WALMART", factura: "IBAGY272028", fecha: "2026-07-01", categoria: "Abarrotes / Secos", importe: 637.00 },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].sugeridos, ["h1"], "el padre trae el desglose → se conserva; se borra la captura plana");
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
t("sin folio no agrupa (compras repetidas reales no se marcan)", () => {
  const r = S.duplicadosSospechosos([
    { id: "a", proveedor: "TORTILLERIA", factura: "", fecha: "2026-07-01", categoria: "Tortilla", importe: 500.00 },
    { id: "b", proveedor: "TORTILLERIA", factura: "", fecha: "2026-07-01", categoria: "Tortilla", importe: 500.00 },
  ]);
  assert.equal(r.length, 0);
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

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
