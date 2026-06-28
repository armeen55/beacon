import { loadTodayMovesHeroData } from "@/app/(shell)/today-moves-data";
import { loadMovesWorklist } from "@/app/(shell)/moves/moves-data";
process.env.BEACON_TENANT_ID = "tenant-iranopedia";
async function main() {
  const oldD = await loadTodayMovesHeroData({ limit: 60 }).catch((e)=>{console.log("OLD fail",String(e).slice(0,80)); return {moves:[],stats:{} as any};});
  const neu = await loadMovesWorklist().catch((e)=>{console.log("NEW fail",String(e).slice(0,80)); return {moves:[],stats:{} as any};});
  const tone = (ms:any[]) => ms.reduce((a:any,m:any)=>{a[m.actionTone]=(a[m.actionTone]||0)+1;return a;},{});
  console.log("OLD /moves cards:", oldD.moves.length, "tones:", JSON.stringify(tone(oldD.moves)));
  console.log("NEW /moves cards:", neu.moves.length, "tones:", JSON.stringify(tone(neu.moves)));
  console.log("OLD top10:", oldD.moves.slice(0,10).map((m:any)=>`${m.actionTone}:${(m.targetUrl||m.query).slice(0,40)}`));
  console.log("NEW top10:", neu.moves.slice(0,10).map((m:any)=>`${m.actionTone}:${(m.targetUrl||m.query).slice(0,40)}`));
  const lightweight = neu.moves.filter((m:any)=>m.debate && m.outline.length===0 && m.score && !m.savedAnswerBlock && m.rankWhy?.startsWith("Ranked by"));
  console.log("NEW lightweight (coverage-only AEO) cards:", lightweight.length);
  console.log("NEW with GA4:", neu.moves.filter((m:any)=>m.ga4).length, "| with whoCited:", neu.moves.filter((m:any)=>m.whoCited).length, "| with friction:", neu.moves.filter((m:any)=>m.friction).length);
  console.log("NEW stats:", JSON.stringify(neu.stats));
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
export {};
