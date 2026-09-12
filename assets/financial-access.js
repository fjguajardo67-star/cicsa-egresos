/* CICSA: frontera de persistencia. Los permisos reales viven en Firestore.
 * El JSON operativo nunca es una fuente autorizada de presupuesto ni de Caja. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CicsaFinancialAccess = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const PUBLIC_KEYS = ['activeWeek', 'categorias', 'provAliases', 'rfcPropio',
    'fechaCorte', 'migracionDesechables', 'tombstones'];
  const WEEK_KEYS = ['id', 'label', 'ini', 'fin', 'gastos'];
  const PATHS = { operation: 'operacion/cicsa', budget: 'finanzas/presupuesto',
    cash: 'finanzas/caja', marker: 'configuracion/seguridadFinanciera' };
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function pick(value, keys) {
    const out = {};
    for (const key of keys) if (Object.hasOwn(value || {}, key)) out[key] = clone(value[key]);
    return out;
  }
  function operational(st) {
    return { ...pick(st, PUBLIC_KEYS), weeks: (st.weeks || []).map(w => pick(w, WEEK_KEYS)) };
  }
  function split(st) {
    if (!st || !Array.isArray(st.weeks)) throw new Error('Estado financiero incompleto. No se guardó.');
    const cash = {};
    for (const key of Object.keys(st)) {
      if (!['weeks', 'budget', 'budgetObjetivo', ...PUBLIC_KEYS].includes(key)) cash[key] = clone(st[key]);
    }
    cash.weeks = st.weeks.filter(w => Object.keys(w).some(k => !WEEK_KEYS.includes(k))).map(w => {
      const copy = clone(w); delete copy.gastos; return copy;
    });
    return { operation: operational(st), budget: pick(st, ['budget', 'budgetObjetivo']), cash };
  }
  function compose(operation, budget, cash) {
    if (!operation || !Array.isArray(operation.weeks) || !budget || !budget.budget)
      throw new Error('Falta información autorizada. Se bloqueó el guardado para proteger los datos.');
    // Lista permitida: ignora campos financieros inyectados en el JSON compartido.
    const result = { ...operational(operation), ...pick(budget, ['budget', 'budgetObjetivo']) };
    if (cash) {
      for (const [key, value] of Object.entries(cash)) {
        if (!['weeks', 'budget', 'budgetObjetivo', ...PUBLIC_KEYS].includes(key)) result[key] = clone(value);
      }
      const weeks = new Map(result.weeks.map(w => [String(w.id), w]));
      for (const w of cash.weeks || []) {
        const id = String(w.id), publicWeek = weeks.get(id);
        // Borrar o alterar una semana operativa no borra ni mueve movimientos privados.
        weeks.set(id, { ...clone(w), gastos: clone(publicWeek?.gastos || []) });
      }
      result.weeks = [...weeks.values()];
    }
    return result;
  }
  function forRole(st, authoritative, admin) {
    if (admin) return clone(st);
    return compose(operational(st), split(authoritative).budget, null);
  }
  function envelope(st) {
    return { schema: { integerValue: '2' }, json: { stringValue: JSON.stringify(st) },
      ts: { stringValue: new Date().toISOString() } };
  }
  function parseDocument(doc) {
    if (!doc?.updateTime || doc.fields?.schema?.integerValue !== '2')
      throw new Error('La separación de permisos aún no está disponible. Recarga en unos minutos.');
    return JSON.parse(doc.fields.json.stringValue);
  }
  function createStore({ base, key, headers, isAdmin, fetch: request = globalThis.fetch }) {
    const prefix = base.slice(base.indexOf('projects/'));
    async function post(method, body) {
      const response = await request(`${base}:${method}?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await headers()) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const error = new Error(response.status === 403
          ? 'Tu cuenta no tiene permiso para esta operación. Recarga para verificar tu acceso.'
          : `No se pudo sincronizar (${response.status}). Se conservan tus cambios pendientes.`);
        error.conflict = [409, 412].includes(response.status) ||
          (method === 'commit' && ['FAILED_PRECONDITION', 'ABORTED'].includes(detail.error?.status));
        error.denied = [401, 403].includes(response.status);
        throw error;
      }
      return response.json();
    }
    async function read() {
      const admin = isAdmin();
      const scopes = ['operation', 'budget', ...(admin ? ['cash'] : []), 'marker'];
      const rows = await post('batchGet', { documents: scopes.map(s => `${prefix}/${PATHS[s]}`),
        newTransaction: { readOnly: {} } });
      const transaction = rows.find(row => row.transaction)?.transaction;
      try {
        const docs = Object.fromEntries(rows.filter(r => r.found).map(r => [r.found.name, r.found]));
        const snapshots = Object.fromEntries(scopes.map(s => [s, docs[`${prefix}/${PATHS[s]}`]]));
        if (snapshots.marker?.fields?.version?.integerValue !== '2')
          throw new Error('Actualización de permisos en curso. Recarga en unos minutos. No captures cambios todavía.');
        const parts = Object.fromEntries(scopes.filter(s => s !== 'marker').map(s => [s, parseDocument(snapshots[s])]));
        return { exists: true, data: compose(parts.operation, parts.budget, parts.cash), snapshots, parts, admin };
      } finally {
        if (transaction) await post('rollback', { transaction }).catch(() => {});
      }
    }
    async function write(st, expected) {
      if (!expected?.snapshots || expected.admin !== isAdmin())
        throw new Error('Verifica tu sesión y vuelve a sincronizar antes de guardar.');
      const admin = isAdmin();
      const parts = split(forRole(st, expected.data, admin));
      const scopes = admin ? ['operation', 'budget', 'cash'] : ['operation'];
      // Un único commit: si cambia una versión o falla un permiso, no se escribe NADA.
      // El admin incluye las tres versiones para no combinar cortes con gastos de otra revisión.
      const writes = scopes.map(scope => ({
        update: { name: `${prefix}/${PATHS[scope]}`, fields: envelope(parts[scope]) },
        currentDocument: { updateTime: expected.snapshots[scope].updateTime }
      }));
      return post('commit', { writes });
    }
    return { read, write };
  }
  return { PUBLIC_KEYS, WEEK_KEYS, PATHS, clone, equal, operational, split, compose, forRole, envelope, createStore };
});
