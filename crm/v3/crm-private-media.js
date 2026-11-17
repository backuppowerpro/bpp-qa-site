// Private job-media references stay durable; authorized bytes live only in memory.
(function (root) {
  'use strict';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const marker = /^bpp-private-media:v1:([0-9a-f-]+)$/i;
  const mimes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);
  const live = new Set();
  let epoch = 0;
  let watchedAuth;
  let authSubscription;
  function parse(value) {
    if (typeof value !== 'string') return null;
    const match = marker.exec(value);
    return match && uuid.test(match[1]) ? match[1].toLowerCase() : null;
  }
  function clear() {
    epoch++;
    for (const url of live) root.URL.revokeObjectURL(url);
    live.clear();
    root.dispatchEvent?.(new root.CustomEvent('bpp-private-media-cleared'));
  }
  function watchAuth() {
    const auth = root.CRM?.__db?.auth;
    if (!auth || watchedAuth === auth) return;
    authSubscription?.unsubscribe?.();
    watchedAuth = auth;
    authSubscription = auth.onAuthStateChange?.((event) => {
      if (event !== 'INITIAL_SESSION') clear();
    })?.data?.subscription;
  }
  async function resolve(value, options = {}) {
    const mediaId = parse(value);
    if (!mediaId || !uuid.test(options.contactId || '')) throw new Error('Photo unavailable');
    const generation = epoch;
    let blob;
    if (options.installer) {
      const { endpoint, token, photoId } = options.installer;
      if (!uuid.test(photoId || '') || !token || typeof endpoint !== 'string') throw new Error('Photo unavailable');
      const response = await root.fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read_private_media', token, contactId: options.contactId, photoId }),
        cache: 'no-store', credentials: 'omit', signal: options.signal,
      });
      if (!response.ok) throw new Error('Photo unavailable');
      blob = await response.blob();
    } else {
      watchAuth();
      const crm = root.CRM;
      if (!crm?.authed || !crm.__db?.auth?.getSession || !crm.__url || !crm.__anonKey) throw new Error('Photo unavailable');
      const session = await crm.__db.auth.getSession();
      const accessToken = session?.data?.session?.access_token;
      if (session.error || !accessToken || generation !== epoch || !crm.authed) throw new Error('Photo unavailable');
      // FunctionsClient decodes image/* as text. Binary fetch preserves bytes and
      // keeps the current operator token in headers, never in the media URL.
      const response = await root.fetch(crm.__url + '/functions/v1/get-recording', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: crm.__anonKey, Authorization: 'Bearer ' + accessToken },
        body: JSON.stringify({ action: 'read_private_media', contact_id: options.contactId, media_id: mediaId }),
        cache: 'no-store', credentials: 'omit', signal: options.signal,
      });
      if (!response.ok) throw new Error('Photo unavailable');
      blob = await response.blob();
    }
    if (generation !== epoch || options.signal?.aborted) throw new Error('Photo unavailable');
    if (!(blob instanceof root.Blob) || !blob.size || blob.size > 15 * 1024 * 1024 || !mimes.has(blob.type.toLowerCase())) throw new Error('Photo unavailable');
    const url = root.URL.createObjectURL(blob);
    live.add(url);
    return { url, release() { if (live.delete(url)) root.URL.revokeObjectURL(url); } };
  }
  function useSource(value, contactId) {
    const React = root.React;
    const privateRef = parse(value);
    const [result, setResult] = React.useState({ value: '', contactId: '', url: '', failed: false });
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
      if (!privateRef) return;
      let active = true;
      let held;
      const onClear = () => { if (active) setResult({ value, contactId, url: '', failed: true }); };
      const onReady = () => { if (active && root.CRM?.authed) setRetry(n => n + 1); };
      root.addEventListener('bpp-private-media-cleared', onClear);
      root.addEventListener('crm-data-ready', onReady);
      setResult({ value, contactId, url: '', failed: false });
      resolve(value, { contactId }).then(resource => {
        held = resource;
        if (active) setResult({ value, contactId, url: resource.url, failed: false });
        else resource.release();
      }).catch(() => { if (active) setResult({ value, contactId, url: '', failed: true }); });
      return () => {
        active = false; held?.release();
        root.removeEventListener('bpp-private-media-cleared', onClear);
        root.removeEventListener('crm-data-ready', onReady);
      };
    }, [value, contactId, retry]);
    if (!privateRef) {
      const safeValue = typeof value === 'string' ? value : '';
      return { url: safeValue.startsWith('bpp-private-media:') ? '' : safeValue, failed: !safeValue || safeValue.startsWith('bpp-private-media:') };
    }
    return result.value === value && result.contactId === contactId ? result : { url: '', failed: false };
  }
  root.addEventListener?.('pagehide', clear);
  root.BPPPrivateMedia = Object.freeze({ parse, resolve, clear, useSource });
})(window);
