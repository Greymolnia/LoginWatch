(function(scope){
  "use strict";
  const fields=['id','timestamp','account','ip','result'];
  function parseCSV(text){
    text=text.replace(/^\uFEFF/,'');
    // Заголовок имеет пять фиксированных имён без кавычек.
    const first=text.split(/\r?\n/,1)[0];
    const delimiter=first.includes(';')?';':',';
    const rows=[];let row=[],field='',quoted=false,closed=false;
    function finishField(){row.push(field);field='';closed=false;}
    function finishRow(){finishField();if(row.some(x=>x!==''))rows.push(row);row=[];}
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){
        if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}
        else field+=c;
      }else if(c===delimiter){finishField();}
      else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;finishRow();}
      else if(closed){throw new Error('CSV: после закрывающей кавычки допустим только разделитель или конец строки.');}
      else if(c==='"'){if(field!=='')throw new Error('CSV: кавычки внутри поля должны быть экранированы.');quoted=true;}
      else field+=c;
    }
    if(quoted)throw new Error('CSV: найдена незакрытая кавычка.');
    if(field!==''||row.length||closed)finishRow();
    if(rows.length<2)throw new Error('CSV должен содержать заголовок и хотя бы одно событие.');
    const header=rows.shift().map(x=>x.trim());
    if(header.length!==5||new Set(header).size!==5||fields.some(k=>!header.includes(k)))throw new Error('CSV: нужны ровно пять столбцов id, timestamp, account, ip, result без повторов.');
    return rows.map((values,index)=>{
      if(values.length!==header.length)throw new Error(`CSV: запись ${index+1} содержит ${values.length} полей вместо ${header.length}.`);
      return Object.fromEntries(header.map((key,i)=>[key,values[i]]));
    });
  }
  function parseJournal(text,name){
    const ext=name.toLowerCase().split('.').pop();
    if(ext==='csv')return parseCSV(text);
    if(ext!=='json')throw new Error('Выберите файл .json или .csv.');
    try{return JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('Не удалось прочитать JSON. Проверьте формат файла.');}
  }
  const names={account:'Правило 1 · Серия ошибок в одном аккаунте',ip:'Правило 2 · Разные аккаунты с одного IP',success:'Правило 3 · Успех после серии ошибок'};
  function buildReport(events,episodes,settings,source,createdAt=new Date().toISOString()){
    const clean=e=>({id:e.id,timestamp:e.timestamp,account:e.account,ip:e.ip,result:e.result});
    const selected={account:['account'],ip:['ip'],success:['success'],both:['account','ip'],all:['account','ip','success']}[settings.mode];
    if(!selected)throw new Error('Неизвестный режим проверки.');
    return {
      application:'LoginWatch',version:'0.4',createdAt,source,
      notice:'Учебный анализ синтетических журналов. Предупреждение требует проверки и не доказывает атаку. Эпизоды разных правил могут описывать одни события.',
      settings:{mode:settings.mode,rules:selected.map(rule=>({rule,name:names[rule],...settings[rule]}))},
      summary:{events:events.length,episodes:episodes.length,byRule:Object.fromEntries(selected.map(k=>[k,episodes.filter(e=>e.rule===k).length]))},
      episodes:episodes.map((e,i)=>{
        const rule=e.rule,p=settings[rule];
        const reason=rule==='ip'?`Ошибки входа минимум в ${p.threshold} разных аккаунтов с одного IP за ${p.minutes} мин.`:rule==='success'?`Успешному входу предшествовало минимум ${p.threshold} ошибок того же аккаунта за ${p.minutes} мин.`:`Минимум ${p.threshold} ошибок в одном аккаунте за ${p.minutes} мин.`;
        const recommendation=rule==='ip'?'Проверьте источник попыток и не является ли IP общим выходом сотрудников или VPN.':rule==='success'?'Уточните у владельца аккаунта, выполнял ли он успешный вход; сопоставьте IP ошибок и успеха.':'Уточните у владельца аккаунта происхождение ошибок и проверьте IP попыток.';
        return {id:i+1,rule,name:names[rule],account:e.account||null,ip:e.ip||null,start:e.events[0].timestamp,end:e.events.at(-1).timestamp,reason,recommendation,events:e.events.map(clean)};
      })
    };
  }
  function reportText(report){
    const lines=['LoginWatch · Отчёт проверки',`Дата формирования: ${report.createdAt}`,`Источник: ${report.source}`,report.notice,'','Настройки'];
    for(const r of report.settings.rules)lines.push(`${r.name}: порог ${r.threshold}; окно ${r.minutes} мин.`);
    lines.push('',`Проверено событий: ${report.summary.events}`,`Предупреждений: ${report.summary.episodes}`);
    for(const r of report.settings.rules)lines.push(`${r.name}: ${report.summary.byRule[r.rule]}`);
    for(const e of report.episodes){
      lines.push('',`Эпизод ${e.id} · ${e.name}`,`Аккаунт: ${e.account||'несколько'}; IP: ${e.ip||'см. события'}`,`Начало: ${e.start}; конец: ${e.end}`,`Причина: ${e.reason}`,`Рекомендация: ${e.recommendation}`,'Связанные события (JSON):');
      for(const event of e.events)lines.push(JSON.stringify(event));
    }
    if(!report.episodes.length)lines.push('По выбранным правилам эпизоды не найдены. Это не исключает другие виды подозрительной активности.');
    return lines.join('\n');
  }
  const api={parseCSV,parseJournal,buildReport,reportText};scope.LoginWatchIO=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
