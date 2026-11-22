(function(scope){
  "use strict";
  function buildTimeline(events,episodes,selected='all'){
    const selectedNumber=selected==='all'?null:Number(selected);
    if(selectedNumber!==null&&(!Number.isInteger(selectedNumber)||selectedNumber<1||selectedNumber>episodes.length))throw new Error('Неизвестный эпизод временной шкалы.');
    const memberships=new Map();
    episodes.forEach((episode,i)=>episode.events.forEach(event=>{
      if(!memberships.has(event.id))memberships.set(event.id,[]);
      memberships.get(event.id).push({episode:i+1,rule:episode.rule});
    }));
    const chosen=selectedNumber===null?null:new Set(episodes[selectedNumber-1].events.map(e=>e.id));
    const visible=[...events].sort((a,b)=>a.time-b.time||a.order-b.order).filter(e=>!chosen||chosen.has(e.id));
    return visible.map((event,i)=>({event,utc:new Date(event.time).toISOString(),gapMs:i?event.time-visible[i-1].time:null,memberships:memberships.get(event.id)||[]}));
  }
  const api={buildTimeline};scope.LoginWatchTimeline=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
