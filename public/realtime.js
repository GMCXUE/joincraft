// Server events only invalidate state; the authenticated REST endpoint remains authoritative.
export async function watchChanges({getHeaders, onChange, onUnauthorized, onStatus, signal}) {
  let delay = 1000;
  const pause = ms => new Promise(resolve => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, {once:true});
  });
  while (!signal.aborted) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, {once:true});
    let watchdog;
    const alive = () => { clearTimeout(watchdog); watchdog = setTimeout(abort, 35000); };
    try {
      alive();
      const response = await fetch('/api/events', {headers:getHeaders(),signal:controller.signal});
      if (response.status === 401) { await onUnauthorized(); return; }
      if (!response.ok || !response.body) throw new Error('Stream unavailable');
      onStatus(true); delay = 1000;
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!signal.aborted) {
          const {value,done} = await reader.read();
          if (done) break;
          alive(); buffer += decoder.decode(value,{stream:true});
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const event = buffer.slice(0,boundary); buffer = buffer.slice(boundary+2);
            if (event.startsWith('event: change\n')) await onChange();
          }
        }
      } finally { await reader.cancel().catch(()=>{}); }
    } catch { /* A fresh connection always requests a complete state snapshot. */ }
    finally { clearTimeout(watchdog); controller.abort(); signal.removeEventListener('abort',abort); }
    if (!signal.aborted) { onStatus(false); await pause(delay); delay = Math.min(delay*2,15000); }
  }
}
