/* Clasificación operativa por producto/proveedor. No cambia precios ni gastos históricos. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CicsaExpenseClassification=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Se conservan números, presentación y puntuación: sin coincidencias difusas.
  const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const amount=x=>x==null||x===''?NaN:Number(x);
  function categories(list){
    const out=[];
    for(const c of [...(list||[]),'Congelados'])if(c&&!out.some(x=>norm(x)===norm(c)))out.push(c);
    return out;
  }
  function identity(supplier,p){
    const s=norm(supplier),code=norm(p.codigo_proveedor),name=norm(p.nombre);
    if(!s||!name)return '';
    return encodeURIComponent(JSON.stringify([s,code?'codigo':'nombre',code||name]));
  }
  function frozen(name){
    const n=norm(name);
    if(/\b(?:no|sin)\s+(?:ultra)?congelad[oa]s?\b|\b(?:no|not)\s+frozen\b/.test(n))return false;
    return /\b(?:ultra)?congelad[oa]s?\b|\biqf\b|\bfrozen\b/.test(n);
  }
  function classify(p,supplier,rules={},cats=[]){
    const id=identity(supplier,p),rule=id&&rules[id];
    const options=categories(cats);
    const canonical=x=>options.find(c=>norm(c)===norm(x))||x||'Otro';
    if(rule?.activa&&norm(rule.proveedor)===norm(supplier)){
      return {categoria:canonical(rule.categoria),fuente:'regla',regla:id,
        tipo_alimento:rule.tipo_alimento||p.tipo_alimento||p.categoria||''};
    }
    if(frozen(p.nombre))return {categoria:canonical('Congelados'),fuente:'descripcion',regla:'',tipo_alimento:p.tipo_alimento||p.categoria||''};
    return {categoria:canonical(p.categoria),fuente:'ia',regla:'',tipo_alimento:p.tipo_alimento||p.categoria||''};
  }
  function rows(products,supplier,rules,cats){
    return (products||[]).map(p=>{
      const r=classify(p,supplier,rules,cats);
      return {...p,...r,nombre:String(p.nombre||'').trim(),codigo_proveedor:String(p.codigo_proveedor||'').trim(),
        importe:amount(p.importe_clasificacion??p.importe),_producto:true,_recordar:!!r.regla};
    });
  }
  function valid(rows){
    return Array.isArray(rows)&&rows.length>0&&rows.every(p=>String(p.categoria||'').trim()&&Number.isFinite(amount(p.importe))&&amount(p.importe)>=0);
  }
  function group(rows){
    if(!valid(rows))throw new Error('Revisa las categorías y los importes: no pueden estar vacíos, ser negativos ni inválidos.');
    const grouped=new Map();
    for(const p of rows){
      if(Number(p.importe)===0)continue;
      const k=norm(p.categoria),g=grouped.get(k)||{categoria:p.categoria,centavos:0,nombres:[]};
      g.centavos+=Math.round(Number(p.importe)*100);
      g.nombres.push(p.nombre||p.descripcion||'');grouped.set(k,g);
    }
    return [...grouped.values()].map(g=>({categoria:g.categoria,importe:g.centavos/100,descripcion:g.nombres.filter(Boolean).join('; ')}));
  }
  function updateRules(previous,products,supplier,stamp,uid){
    const result={...(previous||{})},decisions=new Map();
    for(const p of products||[]){
      if(!p._producto)continue; // Nunca aprender de un grupo «papa, zanahoria, ajo».
      const id=identity(supplier,p);
      if(p._recordar&&!id)throw new Error('Para recordar una clasificación se necesitan producto y proveedor.');
      if(!id||(!p._recordar&&!p.regla))continue;
      const decision=p._recordar?norm(p.categoria):'__inactiva__';
      if(decisions.has(id)&&decisions.get(id)!==decision)throw new Error('El mismo producto tiene dos decisiones distintas. Unifica su categoría y la opción Recordar.');
      decisions.set(id,decision);
      result[id]={proveedor:supplier,nombre:p.nombre,codigo_proveedor:p.codigo_proveedor||'',
        categoria:p.categoria,tipo_alimento:p.tipo_alimento||'',activa:!!p._recordar,
        actualizada:stamp,usuario:uid||''};
    }
    return result;
  }
  return {norm,amount,categories,identity,frozen,classify,rows,valid,group,updateRules};
});
