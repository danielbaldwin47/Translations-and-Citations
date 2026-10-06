#!/usr/bin/env node
/*
 * RESEARCH SCRIPT (issue #61, go/no-go) — not part of the extension, the
 * build, or the checks. Classifies every BYU citation span in the bundled
 * early General Conference (E) and Journal of Discourses (J) talk HTML by
 * whether the span's own text is a scripture reference label, and whether a
 * reference-looking string sits within 120 characters outside the span.
 * Finding: the span text is BYU's own label in 99.7% (E) / 99.9% (J) of
 * spans, so span text cannot separate explicit references from allusions;
 * see docs/research/cite-verbatim-share.md.
 *
 * Usage: node tools/research-cite-explicit.js
 */
'use strict';
const z=require('zlib'),fs=require('fs'),path=require('path');
const R=path.resolve(__dirname,'../src/citations/data')+'/';
const src=JSON.parse(fs.readFileSync(R+'sources.json'));
const BOOKS='Gen(?:esis)?|Ex(?:od(?:us)?)?|Lev(?:iticus)?|Num(?:bers)?|Deut(?:eronomy)?|Josh(?:ua)?|Judg(?:es)?|Ruth|Sam(?:uel)?|Kgs|Kings|Chr(?:on(?:icles)?)?|Ezra|Neh(?:emiah)?|Esth(?:er)?|Job|Ps(?:a|alms?)?|Prov(?:erbs)?|Eccl(?:es(?:iastes)?)?|Song|Isa(?:iah)?|Jer(?:emiah)?|Lam(?:entations)?|Ezek(?:iel)?|Dan(?:iel)?|Hos(?:ea)?|Joel|Amos|Obad(?:iah)?|Jonah|Micah?|Nahum?|Hab(?:akkuk)?|Zeph(?:aniah)?|Hag(?:gai)?|Zech(?:ariah)?|Mal(?:achi)?|Matt?(?:hew)?|Mark?|Luke?|John|Jn|Acts|Rom(?:ans)?|Cor(?:inthians)?|Gal(?:atians)?|Eph(?:esians)?|Phil(?:ip(?:pians)?)?|Col(?:ossians)?|Thess?(?:alonians)?|Tim(?:othy)?|Titus|Philem(?:on)?|Heb(?:rews)?|James|Jas|Pet(?:er)?|Jude|Rev(?:elation)?|Ne|Nephi|Jac(?:ob)?|Enos|Jarom|Omni|W\\.? of M|Mos(?:iah)?|Alma|Hel(?:aman)?|Morm(?:on)?|Ether|Moro(?:ni)?|D\\.? ?& ?C|D&amp;C|Doc(?:trine)?\\.? and Cov(?:enants)?|Doctrine and Covenants|P\\.? of G\\.? ?P|Abr(?:aham)?|Moses|JS|Joseph Smith|Articles? of Faith|A of F|Sec(?:tion)?|Ch(?:ap(?:ter)?)?|Vs?|Verses?|Vers|Rev';
const BOOKS2=BOOKS.replace(/\\\\/g,'\\');
const strict=new RegExp('(?:\\b(?:'+BOOKS2+')\\b\\.?[ ,]*\\d+|\\d+\\s*:\\s*\\d+|\\bverses?\\s+\\d+|\\b\\d+\\s*(?:st|nd|rd)?\\s*(?:Ne|Nephi|Cor|Thess?|Tim|Pet|John|Kgs|Kings|Sam|Chr)\\b\\.?[ ,]*\\d+)','i');
const generic=/\b[A-Z][A-Za-z]*\.?\s+\d+/;  // loose: any Capitalized word + digits
function text(h){return h.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;|&#160;/g,' ').replace(/&[a-z]+;/g,' ').replace(/\s+/g,' ');}
const out={};const ex={};let seed=12345;const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
function keep(corp,cat,item){const k=corp+cat;const a=ex[k]=ex[k]||{n:0,s:[]};a.n++;if(a.s.length<5)a.s.push(item);else{const j=Math.floor(rnd()*a.n);if(j<5)a.s[j]=item;}}
for(const[id,v]of Object.entries(src)){
  if(v.c!=='E'&&v.c!=='J')continue;
  const p=R+'talks/'+id+'.html.gz';if(!fs.existsSync(p))continue;
  const c=out[v.c]=out[v.c]||{talks:0,spans:0,expl:0,explGenericOnly:0,near:0,neither:0,empty:0,missingTalks:0,ibid:0,talksNoSpans:0};
  c.talks++;
  const h=z.gunzipSync(fs.readFileSync(p)).toString();
  let n=0;
  const re=/<span class="citation"[^>]*>(.*?)<\/span>/gs;let m;
  while((m=re.exec(h))){
    n++;c.spans++;
    const t=text(m[1]).trim();
    const before=text(h.slice(Math.max(0,m.index-600),m.index)).slice(-120);
    const after=text(h.slice(m.index+m[0].length,m.index+m[0].length+600)).slice(0,120);
    let cat;
    if(!t){c.empty++;cat='neither';}
    else if(strict.test(t)){cat='expl';}
    else if(generic.test(t)){cat='expl';c.explGenericOnly++;}
    else if(strict.test(before)||strict.test(after)){cat='near';}
    else cat='neither';
    if(cat==='neither'&&/^(ibid|id)\b/i.test(t))c.ibid++;
    c[cat==='expl'?'expl':cat]++;
    keep(v.c,cat,{id,t:t.slice(0,100),ctx:cat==='near'?(strict.test(before)?'<'+before.slice(-60):'>'+after.slice(0,60)):''});
  }
  if(!n)c.talksNoSpans++;
}
for(const k of Object.keys(out)){const c=out[k];const f=x=>(100*x/c.spans).toFixed(1)+'%';
console.log(k,JSON.stringify(c),'expl',f(c.expl),'near',f(c.near),'neither',f(c.neither));}
for(const k of Object.keys(ex)){console.log('\n##',k,'total',ex[k].n);for(const e of ex[k].s)console.log(' ',e.id,JSON.stringify(e.t),e.ctx?JSON.stringify(e.ctx):'');}
