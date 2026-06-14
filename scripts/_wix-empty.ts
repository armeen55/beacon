import { readFileSync } from "node:fs"; import { join } from "node:path";
try { const e=readFileSync(join(process.cwd(),".env.local"),"utf-8"); for(const l of e.split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]!]===undefined){let v=m[2]!.trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); process.env[m[1]!]=v;}} } catch {}
process.env.DATA_SOURCE="supabase";
const BASE="https://www.wixapis.com";
(async()=>{
  const { getWixConnectorToken } = await import("@/lib/connector-store");
  const t=await getWixConnectorToken("tenant-iranopedia"); if(!t?.api_key){console.error("no token");process.exit(1);}
  const h={Authorization:t.api_key,"wix-site-id":t.site_id,"Content-Type":"application/json"} as Record<string,string>;
  for(const col of ["PersianKabobs"]){
    const sc=((await (await fetch(`${BASE}/wix-data/v2/collections/${col}`,{headers:h})).json()) as any).collection;
    const textFields=(sc.fields as any[]).filter(f=>f.type==="TEXT"&&!String(f.key).startsWith("_")).map(f=>String(f.key));
    const items=(((await (await fetch(`${BASE}/wix-data/v2/items/query`,{method:"POST",headers:h,body:JSON.stringify({dataCollectionId:col,query:{paging:{limit:50}}})})).json()) as any).dataItems)??[];
    for(const it of items){ const d=it.data??{}; const empty=textFields.filter(f=>typeof d[f]!=="string"||d[f].trim()===""); console.log(`\n${col} :: ${d.title} (slug=${d.slug})`); console.log(`  EMPTY text fields: ${empty.join(", ")||"(none)"}`);}
  }
})().catch(e=>{console.error(e);process.exit(1);});
