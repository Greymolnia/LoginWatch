(function (scope) {
  "use strict";
  function validate(data) {
    if (!Array.isArray(data) || data.length === 0) throw new Error("Журнал должен содержать непустой массив событий.");
    if (data.length > 20000) throw new Error("Для прототипа допустимо не более 20 000 событий.");
    const ids = new Set();
    return data.map((item, index) => {
      const line = index + 1;
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Событие ${line}: ожидается объект.`);
      for (const key of ["id", "timestamp", "account", "ip", "result"]) {
        if (typeof item[key] !== "string" || !item[key].trim()) throw new Error(`Событие ${line}: поле ${key} должно быть непустой строкой.`);
        if (item[key].length > 200) throw new Error(`Событие ${line}: поле ${key} слишком длинное.`);
      }
      if (ids.has(item.id)) throw new Error(`Событие ${line}: повторяется id ${item.id}.`);
      ids.add(item.id);
      const timestamp = item.timestamp;
      const time = Date.parse(timestamp);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(time)) throw new Error(`Событие ${line}: укажите дату ISO 8601 с часовым поясом.`);
      if (!['success', 'failure'].includes(item.result)) throw new Error(`Событие ${line}: result должен быть success или failure.`);
      const parts = item.ip.split('.');
      if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) throw new Error(`Событие ${line}: ожидается IPv4-адрес.`);
      return {id:item.id, timestamp, account:item.account, ip:item.ip, result:item.result, time, order:index};
    }).sort((a,b) => a.time-b.time || a.order-b.order);
  }
  function detect(events, threshold, minutes) {
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > 1000 || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Укажите целые пороги: 2–1000 ошибок и 1–1440 минут.");
    const groups = new Map();
    const episodes = [];
    const duration = minutes * 60000;
    for (const event of events) {
      let state = groups.get(event.account);
      if (!state) {state = {queue:[], active:null}; groups.set(event.account, state);}
      if (event.result === 'success') {state.queue=[]; state.active=null; continue;}
      state.queue = state.queue.filter(e => event.time-e.time <= duration);
      if (state.active && event.time-state.active.events.at(-1).time > duration) state.active=null;
      state.queue.push(event);
      if (state.queue.length >= threshold) {
        if (!state.active) {
          state.active={account:event.account, events:[...state.queue]};
          episodes.push(state.active);
        } else {
          const known=new Set(state.active.events.map(e=>e.id));
          for (const e of state.queue) if (!known.has(e.id)) {state.active.events.push(e); known.add(e.id);}
        }
      }
    }
    return episodes;
  }
  function detectManyAccounts(events, threshold, minutes) {
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > 1000 || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Для второго правила укажите 2–1000 разных аккаунтов и 1–1440 минут целыми числами.");
    const states = new Map();
    const episodes = [];
    const duration = minutes * 60000;
    for (const event of events) {
      // Успех в одном аккаунте не отменяет ошибки в других аккаунтах с этого IP.
      if (event.result !== 'failure') continue;
      let state = states.get(event.ip);
      if (!state) {state={queue:[],active:null};states.set(event.ip,state);}
      state.queue=state.queue.filter(e=>event.time-e.time<=duration);
      if(state.active && event.time-state.active.events.at(-1).time>duration)state.active=null;
      state.queue.push(event);
      if(new Set(state.queue.map(e=>e.account)).size<threshold)continue;
      if(!state.active){
        state.active={ip:event.ip,events:[...state.queue]};episodes.push(state.active);
      }else{
        const known=new Set(state.active.events.map(e=>e.id));
        for(const e of state.queue)if(!known.has(e.id)){state.active.events.push(e);known.add(e.id);}
      }
    }
    return episodes;
  }
  function detectSuccessAfterFailures(events, threshold, minutes) {
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > 1000 || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Для третьего правила укажите 2–1000 ошибок и 1–1440 минут целыми числами.");
    const queues = new Map();
    const episodes = [];
    const duration = minutes * 60000;
    for (const event of events) {
      let failures=(queues.get(event.account)||[]).filter(e=>event.time-e.time<=duration);
      if(event.result==='failure') {
        failures.push(event);
        queues.set(event.account,failures);
      } else {
        if(failures.length>=threshold) episodes.push({account:event.account,events:[...failures,event]});
        // Любой успех завершает предшествующую серию этого аккаунта.
        queues.delete(event.account);
      }
    }
    return episodes;
  }
  const api={validate,detect,detectManyAccounts,detectSuccessAfterFailures};
  scope.LoginWatch=api;
  if (typeof module !== 'undefined') module.exports=api;
})(globalThis);
