"use strict";
const byId=id=>document.getElementById(id);
let events=null;
let sourceLabel="",lastReport=null;
let timelineEpisodes=[],timelineLimit=50;
const timestamp=minute=>`2026-11-20T09:${String(minute).padStart(2,'0')}:00Z`;
function example(kind) {
  ++readVersion;byId('file').value='';
  const data=Array.from({length:6},(_,i)=>({id:`event-${i+1}`,timestamp:timestamp(i),account:(kind==='account'||kind==='success')?'employee-01':`employee-${i+1}`,ip:kind==='normal'?`192.0.2.${i+10}`:'192.0.2.10',result:'failure'}));
  data.push({id:'event-7',timestamp:timestamp(7),account:kind==='success'?'employee-01':'employee-02',ip:'192.0.2.20',result:'success'});
  load(data,{account:'Пример: серия ошибок в аккаунте',ip:'Пример: разные аккаунты с одного IP',success:'Пример: успешный вход после ошибок',normal:'Пример: ошибки разных аккаунтов с разных IP'}[kind]);
}
function message(text,error=false){byId('message').textContent=text;byId('message').className=error?'notice error':'notice success';}
function clearResults(){resetMetrics();resetTimeline();lastReport=null;byId('export-text').disabled=true;byId('export-json').disabled=true;byId('summary').textContent='Здесь появится сводка после проверки журнала.';byId('result-empty').hidden=false;byId('result-empty').querySelector('h3').textContent='Журнал ещё не проверен';byId('result-empty').querySelector('p').textContent='Выберите файл или готовый пример, затем нажмите «Проверить журнал».';byId('episodes').replaceChildren();}
function load(data,label){events=LoginWatch.validate(data);sourceLabel=label;byId('source').textContent=`${label}. Событий: ${events.length}.`;byId('analyze').disabled=false;clearResults();message('Журнал готов к проверке.');}
function node(tag,text,parent){const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;}
byId('suspicious').onclick=()=>example('account');
byId('spray').onclick=()=>example('ip');
byId('success-example').onclick=()=>example('success');
byId('normal').onclick=()=>example('normal');
let readVersion=0;
byId('file').onchange=async e=>{
  const version=++readVersion; events=null;byId('analyze').disabled=true;clearResults();byId('source').textContent='Журнал ещё не выбран.';
  const file=e.target.files[0];if(!file)return;
  try{if(file.size>5*1024*1024)throw new Error('Размер файла не должен превышать 5 МБ.');const text=await file.text();if(version!==readVersion)return;const data=LoginWatchIO.parseJournal(text,file.name);load(data,file.name);}
  catch(error){if(version===readVersion)message(error.message,true);}
};
for (const id of ['threshold','window','ip-threshold','ip-window','success-threshold','success-window','rule']) byId(id).oninput=()=>{syncRuleCards();clearResults();message('Настройки изменены. Запустите проверку заново.');};
byId('analyze').onclick=()=>{
  clearResults();
  try {
    if(!events)throw new Error('Сначала выберите журнал.');
    const threshold=Number(byId('threshold').value), minutes=Number(byId('window').value);
    const mode=byId('rule').value;
    const ipThreshold=Number(byId('ip-threshold').value),ipMinutes=Number(byId('ip-window').value);
    const accountEpisodes=!['account','both','all'].includes(mode)?[]:LoginWatch.detect(events,threshold,minutes).map(e=>({...e,rule:'account'}));
    const ipEpisodes=!['ip','both','all'].includes(mode)?[]:LoginWatch.detectManyAccounts(events,ipThreshold,ipMinutes).map(e=>({...e,rule:'ip'}));
    const successThreshold=Number(byId('success-threshold').value),successMinutes=Number(byId('success-window').value);
    const successEpisodes=!['success','all'].includes(mode)?[]:LoginWatch.detectSuccessAfterFailures(events,successThreshold,successMinutes).map(e=>({...e,rule:'success'}));
    const episodes=[...accountEpisodes,...ipEpisodes,...successEpisodes].sort((a,b)=>a.events[0].time-b.events[0].time);byId('episodes').replaceChildren();
    byId('summary').textContent=`Проверено событий: ${events.length}. Подозрительных эпизодов: ${episodes.length}. Проверка: ${{account:"правило 1",ip:"правило 2",success:"правило 3",both:"правила 1 и 2",all:"все три правила"}[mode]}.`;
    if(!episodes.length)message('По выбранным правилам эпизоды не найдены. Это не исключает другие виды подозрительной активности.');else message('Проверка завершена. Изучите связанные события.');
    lastReport=LoginWatchIO.buildReport(events,episodes,{mode,account:{threshold,minutes},ip:{threshold:ipThreshold,minutes:ipMinutes},success:{threshold:successThreshold,minutes:successMinutes}},sourceLabel);
    byId('export-text').disabled=false;byId('export-json').disabled=false;
    renderMetrics();
    setupTimeline(episodes);
    for(const [index,episode] of episodes.entries()) {
      const card=node('article','',byId('episodes'));card.className='episode-card';
      const reportEpisode=lastReport.episodes[index];
      const isIP=episode.rule==='ip',isSuccess=episode.rule==='success';
      const header=node('div','',card);header.className='episode-header';
      const heading=node('div','',header);heading.className='episode-heading';
      node('span',`Эпизод ${index+1} · Правило ${{account:1,ip:2,success:3}[episode.rule]}`,heading).className='episode-tag';
      node('h3',isIP?`Несколько аккаунтов · ${episode.ip}`:isSuccess?`Успех после ошибок · ${episode.account}`:`Серия ошибок · ${episode.account}`,heading);
      const jump=node('button','На временной шкале ↗',header);jump.type='button';jump.className='secondary';jump.onclick=()=>{byId('timeline-filter').value=String(index+1);timelineLimit=50;renderTimeline();byId('timeline-section').focus();byId('timeline-section').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});};
      const facts=node('div','',card);facts.className='episode-facts';
      node('span',`${episode.events.length} событий`,facts);
      if(isIP)node('span',`${new Set(episode.events.map(e=>e.account)).size} аккаунтов`,facts);
      if(isSuccess)node('span',`${episode.events.length-1} ошибок + 1 успех`,facts);
      const fmt=t=>new Date(t).toISOString().replace('T',' ').replace('.000Z',' UTC');
      node('span',`${fmt(episode.events[0].timestamp)} → ${fmt(episode.events.at(-1).timestamp)}`,facts);
      node('p',reportEpisode.reason,card).className='episode-reason';
      const advice=node('p','',card);advice.className='episode-advice';node('strong','Что проверить: ',advice);advice.append(document.createTextNode(reportEpisode.recommendation));
      if(isSuccess)node('p','Сотрудник мог вспомнить пароль после ошибок. Последовательность сама по себе не подтверждает захват аккаунта.',card).className='episode-advice';
      if(isIP)node('p','Общий IP может принадлежать офису или VPN. Без данных о паролях нельзя подтвердить использование одного пароля.',card).className='episode-advice';
      const details=node('details','',card);node('summary',`Связанные события · ${episode.events.length}`,details);
      const wrap=node('div','',details);wrap.className='table-wrap';const table=node('table','',wrap);const head=node('tr','',node('thead','',table));
      for(const title of ['ID','Время','Аккаунт','IP-адрес','Результат']){const th=node('th',title,head);th.scope='col';}
      const body=node('tbody','',table);
      for(const event of episode.events){const tr=node('tr','',body);for(const value of [event.id,event.timestamp,event.account,event.ip,event.result==='success'?'Успешный вход':'Ошибка входа'])node('td',value,tr);}
    }
  } catch(error){message(error.message,true);}
};

function downloadReport(format){
  if(!lastReport){message('Сначала выполните проверку журнала.',true);return;}
  const text=format==='json'?JSON.stringify(lastReport,null,2):LoginWatchIO.reportText(lastReport);
  const blob=new Blob([text],{type:format==='json'?'application/json;charset=utf-8':'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`LoginWatch_report_${lastReport.createdAt.replace(/[:.]/g,'-')}.${format}`;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
byId('export-text').onclick=()=>downloadReport('txt');
byId('export-json').onclick=()=>downloadReport('json');

function resetTimeline(){
  timelineEpisodes=[];timelineLimit=50;
  const filter=byId('timeline-filter');filter.replaceChildren();const option=node('option','Весь журнал',filter);option.value='all';filter.disabled=true;
  byId('timeline-list').replaceChildren();byId('timeline-summary').textContent='Шкала появится после проверки журнала.';byId('timeline-more').hidden=true;
}
function setupTimeline(episodes){
  timelineEpisodes=episodes;timelineLimit=50;const filter=byId('timeline-filter');
  filter.replaceChildren();node('option','Весь журнал',filter).value='all';
  for(const [i,e] of episodes.entries())node('option',`Эпизод ${i+1} · Правило ${{account:1,ip:2,success:3}[e.rule]}`,filter).value=String(i+1);
  filter.value='all';filter.disabled=false;renderTimeline();
}
function renderTimeline(){
  if(!lastReport||!events)return;
  const entries=LoginWatchTimeline.buildTimeline(events,timelineEpisodes,byId('timeline-filter').value);
  const list=byId('timeline-list');list.replaceChildren();
  const shown=entries.slice(0,timelineLimit);
  byId('timeline-summary').textContent=`Событий в выбранном просмотре: ${entries.length}. Показано: ${shown.length}. Ошибок: ${entries.filter(x=>x.event.result==='failure').length}. Успешных входов: ${entries.filter(x=>x.event.result==='success').length}.`;
  for(const entry of shown){
    const e=entry.event,item=node('li','',list);item.className='timeline-item'+(e.result==='success'?' is-success':'');
    if(entry.gapMs!==null)node('div',`+ ${entry.gapMs/1000} с от предыдущего события`,item).className='timeline-gap';
    const eventLine=node('div','',item);eventLine.className='timeline-event-line';
    const time=node('time',entry.utc.replace('T',' ').replace('.000Z',' UTC'),eventLine);time.dateTime=entry.utc;
    node('span',e.result==='success'?'Успешный вход':'Ошибка входа',eventLine).className='timeline-status';
    node('div',`${e.id} · ${e.account} · IP ${e.ip}`,item).className='timeline-meta';
    const membership=node('div','',item);membership.className='timeline-membership';
    if(entry.memberships.length)for(const x of entry.memberships)node('span',`Эпизод ${x.episode} · Правило ${{account:1,ip:2,success:3}[x.rule]}`,membership).className='timeline-chip';
    else node('span','Не включено в предупреждения',membership).className='timeline-unlinked';
  }
  byId('timeline-more').hidden=shown.length>=entries.length;
}
byId('timeline-filter').onchange=()=>{timelineLimit=50;renderTimeline();};
byId('timeline-more').onclick=()=>{timelineLimit+=50;renderTimeline();};

function syncRuleCards(){
  const selected={account:['account'],ip:['ip'],success:['success'],both:['account','ip'],all:['account','ip','success']}[byId('rule').value]||[];
  for(const rule of ['account','ip','success']){
    const enabled=selected.includes(rule);byId('card-'+rule).disabled=!enabled;byId('state-'+rule).textContent=enabled?'Включено':'Выключено';
  }
}
function resetMetrics(){for(const key of ['events','episodes','account','ip','success'])byId('metric-'+key).textContent='—';}
function renderMetrics(){
  byId('metric-events').textContent=lastReport.summary.events;
  byId('metric-episodes').textContent=lastReport.summary.episodes;
  for(const key of ['account','ip','success'])byId('metric-'+key).textContent=lastReport.summary.byRule[key]??'—';
  byId('result-empty').hidden=lastReport.summary.episodes>0;
  if(!lastReport.summary.episodes){byId('result-empty').querySelector('h3').textContent='По выбранным правилам предупреждений нет';byId('result-empty').querySelector('p').textContent='События доступны на временной шкале. Результат можно скачать в отчёте.';}
}
syncRuleCards();
