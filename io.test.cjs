const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {parseCSV,parseJournal,buildReport,reportText}=require('./io.js');
const a=require('./analyzer.js');
const header='id,timestamp,account,ip,result';
const row='e1,2026-11-20T09:00:00Z,user,192.0.2.10,failure';
test('CSV эквивалентен JSON во всех трёх примерах',()=>{for(const name of ['rule3_suspicious','rule2_suspicious','rule2_different_ips'])assert.deepEqual(parseJournal(fs.readFileSync(`samples/${name}.csv`,'utf8'),name+'.csv'),JSON.parse(fs.readFileSync(`samples/${name}.json`,'utf8')));});
test('BOM, CRLF, точка с запятой и перестановка заголовков',()=>{const data=parseCSV('\uFEFFresult;ip;account;timestamp;id\r\nfailure;192.0.2.10;user;2026-11-20T09:00:00Z;e1\r\n');assert.equal(a.validate(data)[0].id,'e1');});
test('кавычки, запятые, переносы строк и экранированные кавычки',()=>{const data=parseCSV(header+'\n'+row.replace('user','"user, \""name\""\nnext"'));assert.equal(data[0].account,'user, "name"\nnext');});
test('отсутствующие и повторяющиеся заголовки отклоняются',()=>{assert.throws(()=>parseCSV('id,id,account,ip,result\n'+row));assert.throws(()=>parseCSV(fs.readFileSync('samples/invalid_missing_column.csv','utf8')));});
test('незакрытые кавычки и неверное число полей отклоняются',()=>{assert.throws(()=>parseCSV(header+'\n"broken'));assert.throws(()=>parseCSV(header+'\n'+row+',extra'));assert.throws(()=>parseCSV(header+'\n'+row.replace('user','"user"x')));});
test('пустой CSV, только заголовок и неизвестное расширение',()=>{assert.throws(()=>parseCSV(''));assert.throws(()=>parseCSV(header));assert.throws(()=>parseJournal(row,'example.txt'));});
test('значения CSV проходят общую проверку журнала',()=>assert.throws(()=>a.validate(parseCSV(fs.readFileSync('samples/invalid_result.csv','utf8'))),/result/));
const settings={mode:'all',account:{threshold:5,minutes:10},ip:{threshold:5,minutes:10},success:{threshold:5,minutes:10}};
function fixture(){const events=a.validate(parseCSV(fs.readFileSync('samples/rule3_suspicious.csv','utf8')));const episodes=[...a.detect(events,5,10).map(e=>({...e,rule:'account'})),...a.detectSuccessAfterFailures(events,5,10).map(e=>({...e,rule:'success'}))];return {events,episodes};}
test('отчёт сохраняет настройки, причины, события и распределение по правилам',()=>{const {events,episodes}=fixture();const r=buildReport(events,episodes,settings,'example.csv','2026-11-22T12:00:00Z');assert.deepEqual(r.summary,{events:7,episodes:2,byRule:{account:1,ip:0,success:1}});assert.equal(r.settings.rules.length,3);assert.equal(r.episodes[1].events.at(-1).result,'success');assert.ok(r.episodes.every(e=>e.reason&&e.recommendation));assert.ok(!('time' in r.episodes[0].events[0]));assert.deepEqual(JSON.parse(JSON.stringify(r)),r);});
test('текстовый отчёт содержит результат и корректно описывает отсутствие эпизодов',()=>{const {events,episodes}=fixture();assert.match(reportText(buildReport(events,episodes,settings,'example.csv')),/Предупреждений: 2/);const r=buildReport(events,[],{...settings,mode:'ip'},'example.csv');assert.equal(r.settings.rules.length,1);assert.match(reportText(r),/эпизоды не найдены/);});
