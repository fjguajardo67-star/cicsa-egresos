// Retira únicamente los enlaces de descarga persistentes de cortes/.
// Los archivos se conservan. No toca facturas/, credenciales de Gmail ni IAM.
// --check: conteos. --apply: elimina firebaseStorageDownloadTokens con precondición.
const {createRequire}=require('node:module');
const path=require('node:path');
const dep=createRequire(path.join(__dirname,'../tests/firebase/package.json'));
const {getProjectDefaultAccount}=dep('firebase-tools/lib/auth');
const {requireAuth}=dep('firebase-tools/lib/requireAuth');
const {Client}=dep('firebase-tools/lib/apiv2');
const project='cicsa-egresos',bucket='cicsa-egresos.firebasestorage.app';
const quiet={skipLog:{body:true,resBody:true,queryParams:true}};
let stage='sesion';
(async()=>{
  if(process.argv.slice(2).some(a=>!['--check','--apply'].includes(a))) throw Error('ARGUMENTOS');
  const account=getProjectDefaultAccount(path.resolve(__dirname,'..'));
  if(!account) throw Error('LOGIN_REQUIRED');
  await requireAuth({project,nonInteractive:true,user:account.user,tokens:account.tokens});
  const client=new Client({urlPrefix:'https://storage.googleapis.com',apiVersion:'storage/v1'});
  let pageToken,total=0,withLinks=0,revoked=0,deniedOldLinks=0;
  do{
    stage='listar_metadatos';
    const queryParams=new URLSearchParams({prefix:'cortes/',maxResults:'100',
      fields:'items(name,generation,metageneration,metadata/firebaseStorageDownloadTokens),nextPageToken'});
    if(pageToken) queryParams.set('pageToken',pageToken);
    const res=await client.get(`/b/${bucket}/o`,{...quiet,queryParams});
    for(const item of res.body.items||[]){
      if(!/^cortes\/[^/]+\.json$/.test(item.name)) throw Error('RUTA_INESPERADA');
      total++;
      if(!item.metadata?.firebaseStorageDownloadTokens) continue;
      withLinks++;
      if(process.argv.includes('--apply')){
        stage='retirar_enlace';
        await client.patch(`/b/${bucket}/o/${encodeURIComponent(item.name)}`,
          {metadata:{firebaseStorageDownloadTokens:null}},
          {...quiet,queryParams:new URLSearchParams({ifGenerationMatch:String(item.generation),
            ifMetagenerationMatch:String(item.metageneration),fields:'name,metageneration'})});
        revoked++;
        stage='verificar_enlace_retirado';
        // No imprime ni registra URL, token ni contenido. Descarta el cuerpo inmediatamente.
        const url=new URL(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(item.name)}`);
        url.searchParams.set('alt','media');
        url.searchParams.set('token',item.metadata.firebaseStorageDownloadTokens.split(',')[0]);
        const check=await fetch(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
        await check.body?.cancel();
        if(![401,403].includes(check.status)) throw Error('ENLACE_NO_REVOCADO');
        deniedOldLinks++;
      }
    }
    pageToken=res.body.nextPageToken;
  }while(pageToken);
  console.log(JSON.stringify({project,bucket,prefix:'cortes/',files:total,withLinks,revoked,deniedOldLinks,filesDeleted:0}));
})().catch(e=>{
  console.error(JSON.stringify({status:'detenido',stage,code:Number(e.status||e.context?.response?.statusCode||0)}));
  process.exitCode=1;
});
