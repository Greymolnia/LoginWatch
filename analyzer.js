(function (scope) {
  "use strict";
  const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

  function parseTimestamp(timestamp, line) {
    const match = timestampPattern.exec(timestamp);
    if (match) {
      const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      // Validate the date in its original time zone before converting to UTC.
      if (month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1]) {
        const time = Date.parse(timestamp);
        if (Number.isFinite(time)) return time;
      }
    }
    throw new Error(`Событие ${line}: укажите действительную дату ISO 8601 с часовым поясом.`);
  }

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
      const time = parseTimestamp(timestamp, line);
      if (!['success', 'failure'].includes(item.result)) throw new Error(`Событие ${line}: result должен быть success или failure.`);
      const parts = item.ip.split('.');
      if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) throw new Error(`Событие ${line}: ожидается IPv4-адрес.`);
      return {id:item.id, timestamp, account:item.account, ip:item.ip, result:item.result, time, order:index};
    }).sort((a,b) => a.time-b.time || a.order-b.order);
  }
  // Sorted events let the window advance without scanning its retained entries.
  function expire(state, cutoff) {
    while (state.start < state.queue.length && state.queue[state.start].time < cutoff) {
      const removed = state.queue[state.start++];
      if (state.accounts) {
        const count = state.accounts.get(removed.account);
        if (count === 1) state.accounts.delete(removed.account);
        else state.accounts.set(removed.account, count - 1);
      }
    }
  }

  function recordEpisode(state, identity, episodes, cutoff) {
    if (!state.active || state.active.events.at(-1).time < cutoff) {
      state.active = {...identity, events: []};
      episodes.push(state.active);
    }
    // A later qualifying window can cover previously unreported failures.
    for (let i = Math.max(state.start, state.reportedUntil); i < state.queue.length; i++) {
      state.active.events.push(state.queue[i]);
    }
    state.reportedUntil = state.queue.length;
  }

  function detect(events, threshold, minutes) {
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > 1000 || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Укажите целые пороги: 2–1000 ошибок и 1–1440 минут.");
    const groups = new Map();
    const episodes = [];
    const duration = minutes * 60000;
    for (const event of events) {
      if (event.result === 'success') {groups.delete(event.account); continue;}
      let state = groups.get(event.account);
      if (!state) {state = {queue:[], start:0, reportedUntil:0, active:null}; groups.set(event.account, state);}
      const cutoff = event.time - duration;
      expire(state, cutoff);
      state.queue.push(event);
      if (state.queue.length - state.start >= threshold) recordEpisode(state, {account:event.account}, episodes, cutoff);
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
      if (!state) {state={queue:[],start:0,reportedUntil:0,active:null,accounts:new Map()};states.set(event.ip,state);}
      const cutoff = event.time - duration;
      expire(state, cutoff);
      state.queue.push(event);
      state.accounts.set(event.account, (state.accounts.get(event.account) || 0) + 1);
      if (state.accounts.size >= threshold) recordEpisode(state, {ip:event.ip}, episodes, cutoff);
    }
    return episodes;
  }
  function detectSuccessAfterFailures(events, threshold, minutes) {
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > 1000 || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Для третьего правила укажите 2–1000 ошибок и 1–1440 минут целыми числами.");
    const queues = new Map();
    const episodes = [];
    const duration = minutes * 60000;
    for (const event of events) {
      let state = queues.get(event.account);
      if(event.result==='failure') {
        if (!state) {state = {queue:[], start:0}; queues.set(event.account, state);}
        state.queue.push(event);
      } else if (state) {
        expire(state, event.time - duration);
        if (state.queue.length - state.start >= threshold) {
          episodes.push({account:event.account,events:[...state.queue.slice(state.start),event]});
        }
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
