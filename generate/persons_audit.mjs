#!/usr/bin/env bun
// Read-only audit of reconciliation proposals. Surfaces the entries a human must
// eyeball (semantic merges, low confidence) and groups the NEW slugs by phonetic
// key so genuinely-missing persons can be created once (not duplicated).
//
// Usage: node persons_audit.mjs <proposals.json>
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONS_DIR = path.join(__dirname, 'persons', 'nb');
const [, , PROP] = process.argv;
if (!PROP) { console.error('usage: node persons_audit.mjs <proposals.json>'); process.exit(1); }

const catalog = new Map();
for (const f of fs.readdirSync(PERSONS_DIR).filter(f => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(PERSONS_DIR, f), 'utf-8'));
  catalog.set(d.id, d.name);
}
const base = s => String(s).toLowerCase().replace(/\s*\([^)]*\)/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const pkey = s => base(s).replace(/sch|sh|sj/g,'s').replace(/kh|ch/g,'k').replace(/ph/g,'f').replace(/th/g,'t').replace(/w/g,'v').replace(/y/g,'j').replace(/c/g,'k').replace(/z/g,'s').replace(/q/g,'k').replace(/([a-z])\1+/g,'$1').replace(/h/g,'').replace(/[aeiou]/g,'a');
function editDist(a,b){const m=a.length,n=b.length;const dp=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);for(let j=0;j<=n;j++)dp[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return dp[m][n];}

const props = JSON.parse(fs.readFileSync(PROP, 'utf-8'));
const byConf = {}, byKind = {};
for (const p of props) { byConf[p.confidence] = (byConf[p.confidence]||0)+1; byKind[p.kind]=(byKind[p.kind]||0)+1; }
console.log('total:', props.length, '| confidence:', JSON.stringify(byConf), '| kind:', JSON.stringify(byKind));

const matched = props.filter(p => p.match !== 'NEW');
const news = props.filter(p => p.match === 'NEW');
console.log(`matched existing: ${matched.length} | NEW: ${news.length}`);

// Flag matches to eyeball: low/medium confidence, OR big spelling gap between slug and target (possible semantic merge / false merge)
const flag = matched.filter(p => {
  const targetName = catalog.get(p.match) || p.match;
  const gap = Math.min(editDist(base(p.slug), base(p.match)), editDist(base(p.slug), base(targetName)));
  const phoneticSame = pkey(p.slug) === pkey(p.match) || pkey(p.slug) === pkey(targetName);
  return p.confidence !== 'high' || (gap > 2 && !phoneticSame);
}).sort((a,b)=>b.count-a.count);

console.log(`\n=== ${flag.length} MATCHES TO EYEBALL (semantic/low-confidence), by refcount ===`);
for (const p of flag) {
  console.log(`  ${p.slug} (${p.count}) -> ${p.match} [${catalog.get(p.match)}] {${p.confidence}}  :: ${p.reason.slice(0,90)}`);
}

// Group NEW by phonetic key to dedupe persons-to-create
const groups = new Map();
for (const p of news) { const k = pkey(p.slug); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
const multi = [...groups.values()].filter(g => g.length > 1);
console.log(`\n=== NEW persons to create: ${groups.size} distinct (from ${news.length} slugs; ${multi.length} groups have variant-spellings to merge) ===`);
const ranked = [...groups.values()].map(g => ({ slugs: g.map(x=>x.slug), refs: g.reduce((s,x)=>s+x.count,0) })).sort((a,b)=>b.refs-a.refs);
for (const g of ranked.slice(0, 60)) {
  console.log(`  ${g.slugs[0]} (${g.refs} refs)${g.slugs.length>1?'  [+variants: '+g.slugs.slice(1).join(', ')+']':''}`);
}
console.log(`  ... (${ranked.length} total groups)`);
