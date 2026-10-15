/* Dominio de ingredientes. Sin DOM, red ni fechas de carga como fechas de precio. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CicsaIngredients = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const unique = values => [...new Set(values.filter(Boolean))];
  const number = x => x === '' || x == null ? NaN : Number(x);
  const positive = x => Number.isFinite(number(x)) && number(x) > 0;
  function date(value) {
    const s = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(s)) return '';
    if (s.length > 10 && (Number(s.slice(11,13)) > 23 || Number(s.slice(14,16)) > 59 || Number(s.slice(17,19)) > 59)) return '';
    const day = s.slice(0, 10), d = new Date(day + 'T12:00:00Z');
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === day ? s : '';
  }
  // Todo lo comprado se registra. Antes esto decidía si un producto servía como ingrediente de
  // FORX: dejaba fuera categorías enteras (limpieza, refrescos, desechables, combustible…) y
  // nombres sueltos (detergente, cloro, pepsi, unicel), y mandaba 391 de 736 productos a una
  // pestaña aparte llamada «Solo Egresos». Para un historial de compras esa regla no solo sobra,
  // estorba: el precio del detergente sube igual que el del aceite y hay que poder verlo.
  // Queda una sola exclusión, y no es una regla sino una decisión: lo que alguien omitió a mano.
  function destination(p) {
    if (p.estado === 'ignorado') return { include:false, reason:'Omitido a mano' };
    return { include:true, reason:'Registrado' };
  }
  function ingredientName(p) { return String(p.ingrediente_nombre || p.ingrediente_generico || p.nombre_comercial || '').trim(); }
  function groupId(p) { return p.ingrediente_id || (p.ingrediente_generico ? 'legacy:' + norm(p.ingrediente_generico) : 'producto:' + p.id); }
  const aliases = p => unique([p.nombre_comercial, p.nombre_normalizado, ...(p.alias_factura || [])].map(norm));
  function findProduct(products, input) {
    const name = norm(input.nombre), supplier = norm(input.proveedor);
    const candidates = products.filter(p => aliases(p).includes(name) && (!p.proveedor_nombre || norm(p.proveedor_nombre) === supplier));
    // Ambigüedad y cambios de unidad no se resuelven por posición en el arreglo.
    const fits = candidates.filter(p => !p.unidad_compra || !input.unidad || norm(p.unidad_compra) === norm(input.unidad));
    return fits.length === 1 ? fits[0] : null;
  }
  // conversion() vivía aquí: convertía el precio de la presentación a precio por kilo, litro,
  // pieza o porción, descontando la merma, para que FORX costeara recetas. Un historial de
  // compras no necesita nada de eso: el precio que importa es el que dice la factura.
  function observations(p) {
    const result = [...(p.compras_forx || [])];
    if (!result.length && positive(p.precio_actual)) result.push({
      id:'legacy:' + p.id, precio:number(p.precio_actual), fecha:p.fecha_precio || '',
      folio:p.factura_origen || '', proveedor:p.proveedor_nombre || '', origen:p.precio_origen || 'factura',
      fuente:p.precio_fuente || '', unidad:p.unidad_compra || '',
      fecha_consulta:p.precio_fecha_consulta || '', vigencia_hasta:p.precio_vigencia_hasta || '',
    });
    // Las compras ya guardadas conservan su campo conversion_forx: es dato histórico y borrarlo
    // sería reescribir 736 documentos por una limpieza. Simplemente ya no se calcula ninguno nuevo.
    return result;
  }
  function recordPurchase(p, obs) {
    if (!positive(obs.precio) || !obs.id) throw new Error('La partida necesita identificador y precio válido');
    const purchases = observations(p), at = purchases.findIndex(x => x.id === obs.id);
    const previous = at >= 0 ? purchases[at] : null;
    // Un XML puede completar la misma evidencia, no una compra adicional.
    if (previous && previous.evidencia === 'xml' && obs.evidencia !== 'xml' && !obs.correcciones?.length) return p;
    const recorded={...obs};
    if (at >= 0) purchases[at] = { ...previous, ...recorded }; else purchases.push(recorded);
    const updated = { ...p, compras_forx:purchases };
    const valid = purchases.filter(x => date(x.fecha) && positive(x.precio));
    const xmlReceipts=new Set(valid.filter(x=>x.evidencia==='xml'&&x.folio).map(x=>norm(x.folio)));
    const evidence=valid.filter(x=>x.evidencia==='xml'||x.correcciones?.length||!xmlReceipts.has(norm(x.folio)));
    const invoices = evidence.filter(x => x.origen !== 'web');
    const best = (invoices.length ? invoices : evidence).sort((a,b) => date(b.fecha).localeCompare(date(a.fecha)) || a.id.localeCompare(b.id))[0];
    if (best) Object.assign(updated, { precio_actual:best.precio, fecha_precio:best.fecha, factura_origen:best.folio || '', precio_origen:best.origen || 'factura' });
    return updated;
  }
  function keys(p) {
    const names = [ingredientName(p), ...(p.sinonimos_menu || [])];
    return unique(names.flatMap(name => {
      const s = String(name || '').trim(), lower = s.toLowerCase();
      return [s, lower, lower.charAt(0).toUpperCase() + lower.slice(1)].flatMap(x => [x, x.normalize('NFD').replace(/[\u0300-\u036f]/g, '')]);
    }));
  }
  function groups(products) {
    const map = new Map();
    products.filter(p => !p._internal).forEach(p => {
      const id = groupId(p);
      if (!map.has(id)) map.set(id, { id, name:ingredientName(p), products:[] });
      map.get(id).products.push(p);
    });
    return [...map.values()].sort((a,b) => a.name.localeCompare(b.name, 'es'));
  }
  // La compra más reciente del grupo, tal como la facturaron. Antes esto exigía que cada
  // presentación estuviera «validada» con su unidad de costeo y su nombre de ingrediente de FORX,
  // y convertía el precio a por-kilo descontando merma. Nada de eso aplica a un historial: el
  // precio que importa es el de la factura, por la presentación que se compró.
  function priceForGroup(group) {
    const included = group.products.filter(p => destination(p).include);
    if (!included.length) return { state:'excluido', reason:destination(group.products[0]).reason };
    const compras = [];
    for (const p of included)
      for (const o of observations(p))
        if (date(o.fecha) && positive(o.precio)) compras.push({ ...o, productId:p.id });
    if (!compras.length) return { state:'pendiente', reason:'Sin compras registradas todavía' };
    // El XML gana sobre la lectura de IA de la MISMA factura: es el dato fiscal, no una
    // interpretación de una imagen. Las dos describen una sola compra, no dos.
    const xmlReceipts = new Set(compras.filter(x=>x.evidencia==='xml'&&x.folio).map(x=>x.productId+'|'+norm(x.folio)));
    const evidencia = compras.filter(x=>x.evidencia==='xml'||x.correcciones?.length||!xmlReceipts.has(x.productId+'|'+norm(x.folio)));
    // Un precio consultado en internet (origen 'web') es provisional, no una compra: mientras
    // haya facturas, mandan ellas. Si no hay ninguna, se muestra el provisional en vez de nada.
    const facturas = evidencia.filter(x => x.origen !== 'web');
    const elegibles = facturas.length ? facturas : evidencia;
    // Si de una factura solo se conoce el día, no se inventa un orden por la hora de carga.
    const day = elegibles.map(x => x.fecha.slice(0,10)).sort().at(-1);
    let latest = elegibles.filter(x => x.fecha.slice(0,10) === day);
    if (latest.every(x => x.fecha.length > 10)) {
      const timestamp = latest.map(x => x.fecha).sort().at(-1);
      latest = latest.filter(x => x.fecha === timestamp);
    }
    latest.sort((a,b) => a.id.localeCompare(b.id));
    return { state:'listo', winner:latest[0], compras:evidencia, candidates:latest };
  }
  function homologate(products, sourceId, targetId) {
    const source = products.find(p => p.id === sourceId), target = products.find(p => p.id === targetId);
    if (!source || !target || sourceId === targetId) throw new Error('Selecciona dos productos distintos');
    if (!destination(source).include || !destination(target).include) throw new Error('Recupera primero el producto omitido');
    const sourceGroup = groupId(source), targetGroup = groupId(target);
    if (sourceGroup === targetGroup) return [];
    const members = products.filter(p => [sourceGroup,targetGroup].includes(groupId(p)));
    const name = ingredientName(target), id = target.ingrediente_id || 'ing:' + target.id;
    const synonyms = unique(members.flatMap(p => [ingredientName(p), ...(p.sinonimos_menu || [])])).filter(x => norm(x) !== norm(name));
    return members.map(p => ({ ...p, compras_forx:observations(p), ingrediente_id:id, ingrediente_nombre:name, ingrediente_generico:name, sinonimos_menu:synonyms }));
  }
  const presentationWords=new Set(('de del el la los las en un una por x ' +
    'kg kgs kilogramo kilogramos kilo kilos g gr grs gramo gramos mg miligramo miligramos ' +
    'l lt lts litro litros ml mililitro mililitros cc oz onza onzas lb libra libras ' +
    'pz pza pzas pieza piezas unidad unidades bote botes caja cajas bolsa bolsas lata latas ' +
    'frasco frascos botella botellas cubeta cubetas envase envases empaque empaques ' +
    'paquete paquetes paq pq pqt pack packs costal costales saco sacos presentacion presentaciones').split(' '));
  // Equivalencias gramaticales acotadas: no hay stemming ni equivalencias entre alimentos.
  const ingredientPlurals=Object.fromEntries([
    ['aceitunas','aceituna'],['aderezos','aderezo'],['aceites','aceite'],['salsas','salsa'],['pastas','pasta'],
    ['chiles','chile'],['jalapenos','jalapeno'],['papas','papa'],['tomates','tomate'],['jitomates','jitomate'],
    ['cebollas','cebolla'],['zanahorias','zanahoria'],['huevos','huevo'],['tortillas','tortilla'],
    ['frijoles','frijol'],['limones','limon'],['nopales','nopal'],['quesos','queso'],['lechugas','lechuga'],
    ['pimientos','pimiento'],['pepinos','pepino'],['manzanas','manzana'],['naranjas','naranja'],
    ['verdes','verde'],['negras','negra'],['blancas','blanca'],['rojas','roja'],['enteras','entera'],
    ['negros','negro'],['blancos','blanco'],['rojos','rojo'],['enteros','entero'],['integrales','integral'],
    ['huesos','hueso'],['rebanadas','rebanada'],['rebanados','rebanado'],['molidos','molido'],['molidas','molida']
  ]);
  const ambiguousIngredients=new Set(['producto','alimento','insumo','salsa','aderezo','pasta','aceite','carne','queso','bebida','condimento','mezcla']);
  const presentationQuantity=/\b(?:\d+(?:[.,]\d+)?\s*[x×]\s*)*\d+(?:[.,]\d+)?\s*(?:kilogramos?|kilos?|kgs?|gramos?|grs?|mg|miligramos?|g|litros?|lts?|mililitros?|ml|cc|l|onzas?|oz|libras?|lb|pzas?|pz|piezas?|unidades?|botes?|cajas?|bolsas?|latas?|frascos?|botellas?|cubetas?|paquetes?|packs?)(?=$|[\s,.;:/()])/gi;
  function ingredientIdentity(p) {
    // El nombre comercial es la evidencia; un nombre genérico amplio no borra sus calificativos.
    const name=String(p.nombre_comercial||p.ingrediente_nombre||p.ingrediente_generico||'');
    // Un porcentaje puede definir el alimento (p. ej., grasa), no el tamaño del empaque.
    const percentages=unique((name.match(/\d+(?:[.,]\d+)?\s*%/g)||[]).map(x=>String(Number(x.replace('%','').replace(',','.').trim())))).sort();
    let text=norm(name.replace(/\d+(?:[.,]\d+)?\s*%/g,' ').replace(presentationQuantity,' '));
    for(const metadata of [p.marca,p.proveedor_nombre]){
      const phrase=norm(metadata);if(phrase)text=(' '+text+' ').split(' '+phrase+' ').join(' ').trim();
    }
    const tokens=text.split(' ').filter(w=>w&&!presentationWords.has(w)).map(w=>ingredientPlurals[w]||w);
    if(!tokens.some(w=>/[a-z]/.test(w)) || (tokens.length===1&&ambiguousIngredients.has(tokens[0])))return '';
    // Códigos o números sin unidad conocida se conservan: no suponemos que sean peso.
    // Se conservan orden, tipo, preparación y «con/sin». Peso, unidad o proveedor nunca bastan.
    return tokens.join(' ')+(percentages.length?' '+percentages.map(x=>x+'%').join(' '):'');
  }
  function createMatcher(products) {
    const byId=new Map(products.map(p=>[p.id,{p,group:groupId(p),include:destination(p).include,identity:ingredientIdentity(p)}]));
    const index=new Map(),rejected=new Map();
    for(const m of byId.values()){
      if(m.include&&m.identity){if(!index.has(m.identity))index.set(m.identity,[]);index.get(m.identity).push(m);}
      for(const id of m.p.forx_distintos||[]){
        const other=byId.get(id);if(!other)continue;
        for(const [a,b] of [[m.group,other.group],[other.group,m.group]]){if(!rejected.has(a))rejected.set(a,new Set());rejected.get(a).add(b);}
      }
    }
    return function(source,limit=3){
      if(!destination(source).include)return [];
      const own=byId.get(source.id)||{group:groupId(source),identity:ingredientIdentity(source)};
      if(!own.identity)return [];
      const seen=new Set();
      return (index.get(own.identity)||[]).filter(m=>m.group!==own.group&&!rejected.get(own.group)?.has(m.group))
        .sort((a,b)=>a.p.id.localeCompare(b.p.id))
        .filter(m=>{if(seen.has(m.group))return false;seen.add(m.group);return true;}).slice(0,limit).map(m=>m.p);
    };
  }
  const suggest=(products,source,limit=3)=>createMatcher(products)(source,limit);
  // Búsqueda explícita del usuario; nunca se usa para sugerir ni fusionar automáticamente.
  function manualTargets(products, sourceId, query) {
    const source=products.find(p=>p.id===sourceId),text=norm(query);
    if(!source||!destination(source).include||text.length<2)return [];
    const terms=text.split(' ');
    return groups(products).filter(g=>g.id!==groupId(source)&&g.products.some(p=>destination(p).include))
      .filter(g=>{const names=norm([g.name,...g.products.flatMap(p=>[p.nombre_comercial,p.proveedor_nombre,...(p.sinonimos_menu||[])])].join(' '));return terms.every(t=>names.includes(t));})
      .map(g=>({...g,targetId:g.products.find(p=>destination(p).include).id}))
      .sort((a,b)=>a.name.localeCompare(b.name,'es')||a.id.localeCompare(b.id));
  }
  // publication() vivía aquí: armaba el mapa de precios por ingrediente que se escribía en
  // datos/precios para que FORX costeara recetas. Egresos ya no publica: el documento queda
  // congelado con sus últimos valores, así que lo que todavía lo lea sigue leyendo algo.
  // Con ella se va el único consumidor de priceForGroup fuera de la pantalla.

  // ─── Consulta del historial de compras ───────────────────────────────────────
  // Aplana las observaciones de todos los productos en renglones de compra. Un renglón es
  // «esta presentación, esta factura, este día»: lo que el XML del proveedor dice que se
  // compró. No inventa nada que la factura no traiga — cantidad y SKU ausentes quedan en
  // null y '', que no es lo mismo que cero ni que vacío.
  //
  // Qué significa `precio`: en un CFDI es el ValorUnitario del renglón, o sea lo que cuesta
  // UNA presentación (una caja, un bulto, una pieza), y `cantidad` es cuántas se compraron.
  // Por eso precio × cantidad es el importe del renglón, y por eso el precio sí se puede
  // comparar contra el mismo producto en otra fecha: es el precio de la misma cosa.
  function purchaseRows(products) {
    const rows = [];
    for (const p of products || []) {
      if (!destination(p).include) continue;
      for (const o of observations(p)) {
        const fecha = date(o.fecha);
        if (!fecha || !positive(o.precio)) continue;
        const cantidad = positive(o.cantidad) ? number(o.cantidad) : null;
        const precio = number(o.precio);
        rows.push({
          id: o.id, productoId: p.id, grupoId: groupId(p),
          producto: ingredientName(p), presentacion: p.nombre_comercial || '',
          proveedor: o.proveedor || p.proveedor_nombre || '',
          // El SKU del renglón es el que traía ESA factura. El del producto es el último
          // conocido: sirve para buscar, nunca para rellenar un renglón que no lo traía.
          sku: String(o.codigo_proveedor || '').trim(),
          skuProducto: String(p.codigo_proveedor || '').trim(),
          fecha, dia: fecha.slice(0, 10),
          cantidad, unidad: o.unidad || p.unidad_compra || '',
          precio, importe: cantidad == null ? null : precio * cantidad,
          folio: o.folio || '', origen: o.origen || 'factura', evidencia: o.evidencia || '',
        });
      }
    }
    return rows.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.producto.localeCompare(b.producto, 'es') || a.id.localeCompare(b.id));
  }
  function productList(rows) {
    const byGroup = new Map();
    for (const r of rows || []) {
      if (!byGroup.has(r.grupoId)) byGroup.set(r.grupoId, { grupoId:r.grupoId, nombre:r.producto || r.presentacion, compras:0, presentaciones:new Set() });
      const g = byGroup.get(r.grupoId); g.compras++; g.presentaciones.add(r.productoId);
    }
    return [...byGroup.values()].map(g => ({ ...g, presentaciones:g.presentaciones.size }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.grupoId.localeCompare(b.grupoId));
  }
  const supplierList = rows => [...new Set((rows || []).map(r => r.proveedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  function filterPurchases(rows, filter) {
    const f = filter || {}, text = norm(f.texto), supplier = norm(f.proveedor);
    // Una fecha inválida no filtra: vale más enseñar de más que esconder compras en silencio.
    const from = date(f.desde).slice(0, 10), to = date(f.hasta).slice(0, 10);
    const terms = text ? text.split(' ') : [];
    return (rows || []).filter(r => {
      if (f.grupo && r.grupoId !== f.grupo) return false;
      if (supplier && norm(r.proveedor) !== supplier) return false;
      if (from && r.dia < from) return false;
      if (to && r.dia > to) return false;
      if (!terms.length) return true;
      const haystack = norm([r.producto, r.presentacion, r.proveedor, r.sku, r.skuProducto, r.folio].join(' '));
      return terms.every(t => haystack.includes(t));
    });
  }
  // Una línea por presentación, no por producto: la caja de 3 kg y el frasco de 1 kg del mismo
  // arroz cuestan distinto porque son cosas distintas, y juntarlas en una línea dibujaría
  // saltos de precio que nunca ocurrieron. Varias compras el mismo día se promedian pesando
  // por cantidad —comprar 40 cajas a $90 pesa más que 1 a $120—, y se conserva el rango del
  // día para no esconder que hubo dos precios.
  function priceSeries(rows) {
    const byProduct = new Map();
    for (const r of rows || []) {
      if (!byProduct.has(r.productoId)) byProduct.set(r.productoId, { productoId: r.productoId, presentacion: r.presentacion, proveedor: r.proveedor, unidad: r.unidad, dias: new Map(), compras: 0 });
      const s = byProduct.get(r.productoId);
      s.compras++;
      const acc = s.dias.get(r.dia) || { dia: r.dia, suma: 0, peso: 0, compras: 0, min: Infinity, max: -Infinity };
      const peso = r.cantidad == null ? 1 : r.cantidad;
      acc.suma += r.precio * peso; acc.peso += peso; acc.compras++;
      acc.min = Math.min(acc.min, r.precio); acc.max = Math.max(acc.max, r.precio);
      s.dias.set(r.dia, acc);
    }
    return [...byProduct.values()]
      .map(s => ({ productoId: s.productoId, presentacion: s.presentacion, proveedor: s.proveedor, unidad: s.unidad, compras: s.compras,
        puntos: [...s.dias.values()].map(a => ({ dia: a.dia, precio: a.suma / a.peso, compras: a.compras, min: a.min, max: a.max })).sort((a, b) => a.dia.localeCompare(b.dia)) }))
      // Orden estable por id, no por cuántas compras tiene: así acotar las fechas no le cambia
      // el color a las líneas que sobreviven al filtro.
      .sort((a, b) => a.productoId.localeCompare(b.productoId));
  }
  return { norm, date, destination, ingredientName, groupId, findProduct, observations, recordPurchase, keys, groups, priceForGroup, homologate, ingredientIdentity, createMatcher, suggest, manualTargets, purchaseRows, supplierList, productList, filterPurchases, priceSeries };
});
