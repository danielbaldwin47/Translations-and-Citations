#!/usr/bin/env node
/*
 * RESEARCH SCRIPT (issue #61, go/no-go) — not part of the extension, the
 * build, or the checks. With every BYU citation span stripped from the talk
 * text, counts how many early General Conference (E) and Journal of
 * Discourses (J) cites have a speaker-written reference (book + digits, or
 * n:n) within 120 characters of the span's position: an upper bound on
 * "the speaker named the reference beside the quote".
 * Finding: 1.0% (E) and 0.3% (J); see docs/research/cite-verbatim-share.md.
 *
 * Usage: node tools/research-cite-author-refs.js
 */
'use strict';
const z=require('zlib'),fs=require('fs'),path=require('path');const R=path.resolve(__dirname,'../src/citations/data')+'/';
const src=JSON.parse(fs.readFileSync(R+'sources.json'));
const BOOKS='Gen(?:esis)?|Ex(?:od(?:us)?)?|Lev(?:iticus)?|Num(?:bers)?|Deut(?:eronomy)?|Josh(?:ua)?|Judg(?:es)?|Sam(?:uel)?|Kings|Chr(?:on(?:icles)?)?|Neh(?:emiah)?|Job|Ps(?:a|alms?)?|Prov(?:erbs)?|Eccl(?:es(?:iastes)?)?|Isa(?:iah)?|Jer(?:emiah)?|Ezek(?:iel)?|Dan(?:iel)?|Hos(?:ea)?|Amos|Micah?|Hab(?:akkuk)?|Zech(?:ariah)?|Mal(?:achi)?|Matt?(?:hew)?|Mark|Luke?|John|Acts|Rom(?:ans)?|Cor(?:inthians)?|Gal(?:atians)?|Eph(?:esians)?|Phil(?:ip(?:pians)?)?|Col(?:ossians)?|Thess?(?:alonians)?|Tim(?:othy)?|Heb(?:rews)?|James|Pet(?:er)?|Rev(?:elation)?|Nephi|Ne|Jacob|Mos(?:iah)?|Alma|Hel(?:aman)?|Morm(?:on)?|Ether|Moro(?:ni)?|D\\. ?& ?C|D&C|Doctrine and Covenants|Doc\\. and Cov\\.|Abr(?:aham)?|Moses|JS|Section|Chapter|verses?';
const strict=new RegExp('(?:\\b(?:'+BOOKS.replace(/\\\\/g,'\\')+')\\b\\.?[ ,]*\\d+|\\d+\\s*:\\s*\\d+)','i');
const T=h=>h.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&[a-z#0-9]+;/g,' ').replace(/\s+/g,' ');
const strip=h=>h.replace(/<span class="citation"[^>]*>.*?<\/span>/gs,'');
const c={},ex={};
for(const[id,v]of Object.entries(src)){if(v.c!=='E'&&v.c!=='J')continue;const p=R+'talks/'+id+'.html.gz';if(!fs.existsSync(p))continue;
const h=z.gunzipSync(fs.readFileSync(p)).toString();const re=/<span class="citation"[^>]*>.*?<\/span>/gs;let m;
while((m=re.exec(h))){const o=c[v.c]=c[v.c]||{n:0,before:0,after:0,either:0};o.n++;
const b=T(strip(h.slice(Math.max(0,m.index-1500),m.index))).slice(-120),a=T(strip(h.slice(m.index+m[0].length,m.index+m[0].length+1500))).slice(0,120);
const B=strict.test(b),A=strict.test(a);if(B)o.before++;if(A)o.after++;if(A||B){o.either++;const k=v.c;(ex[k]=ex[k]||[]);if(ex[k].length<5&&Math.random()<0.001)ex[k].push(id+' '+JSON.stringify((B?b.slice(-70):a.slice(0,70))));}}}
for(const k in c)console.log(k,JSON.stringify(c[k]),(100*c[k].either/c[k].n).toFixed(1)+'% author-ref within 120 chars outside any span');
console.log(ex);
