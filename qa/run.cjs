'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'.'),out=path.resolve(process.argv[3]||path.join(__dirname,'../evidence'));
fs.mkdirSync(out,{recursive:true});
const a=require(path.join(root,'analyzer.js')),io=require(path.join(root,'io.js')),tl=require(path.join(root,'timeline.js'));
const results=[];function check(id,title,fn){try{fn();results.push({id,title,status:'PASS'});}catch(e){results.push({id,title,status:'FAIL',actual:e.message});}}
const manifest=require('./manifest.json');let TP=0,FN=0,FP=0,TN=0;
for(const c of manifest){const events=a.validate(JSON.parse(fs.readFileSync(path.join(__dirname,'data',c.file))));const actual=[a.detect(events,5,10).length,a.detectManyAccounts(events,5,10).length,a.detectSuccessAfterFailures(events,5,10).length];const positive=actual.some(Boolean);if(c.suspicious){if(positive)TP++;else FN++;}else{if(positive)FP++;else TN++;}check(c.id,c.title,()=>assert.deepEqual(actual,c.expected));}
const base={id:'e1',timestamp:'2026-11-20T09:00:00Z',account:'user',ip:'192.0.2.1',result:'failure'};
check('S01','Отклонение повторяющихся ID',()=>assert.throws(()=>a.validate([base,base])));
check('S02','Отклонение неизвестного result',()=>assert.throws(()=>a.validate([{...base,result:'admin'}])));
check('S03','Отклонение неверного IPv4',()=>{for(const ip of ['256.1.1.1','-1.1.1.1','::1','1.1.1','https://example.org'])assert.throws(()=>a.validate([{...base,ip}]));});
check('S04','Отклонение времени без зоны',()=>assert.throws(()=>a.validate([{...base,timestamp:'2026-11-20T09:00:00'}])));
check('S05','Несуществующие даты отклоняются, допустимые даты сохраняют точность',()=>{
  for(const timestamp of ['2026-02-29T09:00:00Z','2026-02-30T09:00:00Z','2026-04-31T09:00:00+03:00','1900-02-29T09:00:00Z']){
    assert.throws(()=>a.validate([{...base,timestamp}]),/действительную дату/);
  }
  for(const [timestamp,utc] of [
    ['2026-02-28T09:00:00Z','2026-02-28T09:00:00.000Z'],
    ['2024-02-29T00:30:00.125+03:00','2024-02-28T21:30:00.125Z'],
    ['2000-02-29T23:30:00.001-02:00','2000-03-01T01:30:00.001Z']
  ]){
    const [event]=a.validate([{...base,timestamp}]);
    assert.equal(event.timestamp,timestamp);
    assert.equal(new Date(event.time).toISOString(),utc);
  }
});
check('S06','Пустые и неверные структуры',()=>{for(const x of [null,{},[],[null],[[]],[1]])assert.throws(()=>a.validate(x));});
check('S07','Обязательные поля и их типы',()=>{for(const key of Object.keys(base))for(const value of ['',null,7,'   '])assert.throws(()=>a.validate([{...base,[key]:value}]));});
check('S08','Поле 200 символов принимается, 201 отклоняется',()=>{assert.equal(a.validate([{...base,account:'a'.repeat(200)}]).length,1);assert.throws(()=>a.validate([{...base,account:'a'.repeat(201)}]));});
check('S09','20 000 событий принимаются, 20 001 отклоняется',()=>{const e=Array.from({length:20000},(_,i)=>({...base,id:String(i),result:'success'}));assert.equal(a.validate(e).length,20000);assert.throws(()=>a.validate([...e,{...base,id:'extra'}]));});
check('S10','JSON с __proto__ не изменяет прототип',()=>{const x=io.parseJournal('[{"__proto__":{"polluted":true},"id":"1","timestamp":"2026-11-20T09:00:00Z","account":"__proto__","ip":"192.0.2.1","result":"failure"}]','x.json');assert.equal(a.validate(x)[0].account,'__proto__');assert.equal({}.polluted,undefined);});
check('S11','Повторные заголовки CSV отклоняются',()=>assert.throws(()=>io.parseCSV('id,id,account,ip,result\n1,2,u,192.0.2.1,failure')));
check('S12','Некорректные кавычки CSV отклоняются',()=>assert.throws(()=>io.parseCSV('id,timestamp,account,ip,result\n"unfinished')));
check('S13','HTML в данных сохраняется строкой в JSON',()=>{const payload='<img src=x onerror=alert(1)>';assert.equal(a.validate([{...base,account:payload}])[0].account,payload);});
check('S14','Недопустимые настройки всех правил',()=>{for(const f of [a.detect,a.detectManyAccounts,a.detectSuccessAfterFailures])for(const [t,w] of [[1,10],[1001,10],[2.5,10],[NaN,10],[5,0],[5,1441],[5,1.5],[5,Infinity]])assert.throws(()=>f(a.validate([base]),t,w));});
check('F01','Нижние и верхние границы настроек',()=>{for(const f of [a.detect,a.detectManyAccounts,a.detectSuccessAfterFailures])for(const [t,w] of [[2,1],[1000,1440]])assert.doesNotThrow(()=>f(a.validate([base]),t,w));});
check('F02','BOM, CRLF, разделитель ; и порядок колонок',()=>assert.equal(a.validate(io.parseJournal('\uFEFFresult;ip;account;timestamp;id\r\nfailure;192.0.2.1;user;2026-11-20T09:00:00Z;1\r\n','LOG.CSV'))[0].id,'1'));
check('F03','Кавычки и перенос строки в CSV',()=>assert.equal(io.parseCSV('id,timestamp,account,ip,result\n1,2026-11-20T09:00:00Z,"user,""quoted""\nline",192.0.2.1,failure')[0].account,'user,"quoted"\nline'));
check('F04','TXT и JSON отчеты содержат причину и исходные события',()=>{const e=a.validate(require('./data/P04.json'));const episodes=a.detect(e,5,10).map(x=>({...x,rule:'account'}));const s={mode:'account',account:{threshold:5,minutes:10}};const r=io.buildReport(e,episodes,s,'P04.json','2026-11-22T18:00:00Z');assert.equal(r.summary.events,6);assert.equal(r.episodes[0].events.length,5);assert.ok(r.episodes[0].reason&&r.episodes[0].recommendation);assert.deepEqual(JSON.parse(JSON.stringify(r)),r);assert.match(io.reportText(r),/Предупреждений: 1/);});
check('F05','Шкала сортирует, сохраняет состав и UTC',()=>{const e=a.validate(require('./data/P06.json'));const episodes=a.detect(e,5,10).map(x=>({...x,rule:'account'}));const list=tl.buildTimeline(e,episodes,'1');assert.equal(list.length,5);assert.equal(list[0].event.id,'0');assert.equal(list[1].gapMs,60000);});
const report={testedCommit:'a147061aaa6929940ef0b72c984ca59006de09e1',runAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform},results,metrics:{TP,FN,FP,TN,recall:TP/(TP+FN),falsePositiveRate:FP/(FP+TN),note:'Учебная синтетическая выборка, не оценка реального качества детектора.'}};
fs.writeFileSync(path.join(out,'qa-results.json'),JSON.stringify(report,null,2));for(const r of results)console.log(`${r.status} ${r.id} ${r.title}${r.actual?' — '+r.actual:''}`);console.log(JSON.stringify(report.metrics));console.log(`PASS ${results.filter(x=>x.status==='PASS').length}/${results.length}`);process.exitCode=results.some(x=>x.status==='FAIL')?1:0;
