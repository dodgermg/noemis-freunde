/* Lernwelt – Service Worker 2.84.0 */
const CACHE = 'lwf-lernwelt-2.84.0';
const FILES = ['index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
// Immer frisch vom Server laden – manche Server (z. B. Home Assistant /local) lassen Dateien wochenlang zwischenspeichern
// v2.18: Update nur übernehmen, wenn ALLE Dateien vollständig da sind und index.html wirklich die Lernwelt ist
// v2.27: Im Reise-Modus keine Updates, solange eine Version im Speicher liegt (nichts kann unterwegs kaputtgehen).
//        index.html muss genau zu diesem Service Worker passen (gleiche Versionsnummer).
const reiseAn = () => caches.open('lwf-cfg').then(c => c.match('/__cfg')).then(r => r ? r.json() : {}).then(c => !!c.reise).catch(() => false);
const hatApp = () => caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('lwf-lernwelt-')).map(k => caches.open(k).then(c => c.match('index.html'))))).then(l => l.some(Boolean)).catch(() => false);
const html = t => new Response(t, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
self.addEventListener('install', e => {
  e.waitUntil(Promise.all([reiseAn(), hatApp()]).then(([rm, alt]) => {
    if (rm && alt) throw new Error('Reise-Modus: kein Update unterwegs');
    return Promise.all(FILES.map(f => fetch(new Request(f, { cache: 'reload' })).then(r => {
      if (!r.ok) throw new Error('fehlt: ' + f);
      if (f !== 'index.html') return [f, r];
      // als frische Antwort speichern – Safari lehnt umgeleitete (redirected) Antworten beim Öffnen der App ab
      return r.text().then(t => { if (t.indexOf('lernwelt-freunde-app') < 0 || t.lastIndexOf('</html>') < 0 || t.indexOf("APP_VERSION = '2.84.0'") < 0) throw new Error('index passt nicht'); return [f, html(t)]; });
    })));
  }).then(list => caches.open(CACHE).then(c => Promise.all(list.map(([f, r]) => c.put(f, r))))).then(() => self.skipWaiting()));
});
// Die vorige Version als Notfall-Kopie behalten („Vorige Version starten“ auf dem Hoppla-Bildschirm)
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => {
    const old = ks.filter(k => k.startsWith('lwf-lernwelt-') && k !== CACHE);
    const keep = old.length ? caches.open(old[old.length - 1]).then(c => c.match('index.html')).then(r => r ? r.text().then(t => t.indexOf('lernwelt-freunde-app') >= 0 ? caches.open('lwf-vorher').then(c => c.put('index.html', html(t))) : null) : null).catch(() => null) : Promise.resolve();
    return keep.then(() => Promise.all(old.map(k => caches.delete(k))));
  }).then(() => self.clients.claim()));
});
const clean = r => r && r.redirected ? r.text().then(html) : r;
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Online: neueste Version holen (für Updates). Offline: sofort aus dem Speicher.
    // Reise-Modus (Elternbereich): immer sofort aus dem Speicher; neue Versionen nur über ein vollständiges SW-Update.
    // Schutz vor WLAN-Anmeldeseiten (Flughafen, Hotel, Flugzeug): nur eine vollständige Lernwelt ersetzt die gespeicherte
    const notfall = () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Noemis Freunde</title><meta name="robots" content="noindex, nofollow"><body style="font-family:system-ui;padding:40px;text-align:center;background:#EDF6FA;color:#12324A"><div style="font-size:64px">🐧</div><h1>Gleich geht es weiter!</h1><p>Die Lernwelt ist noch nicht im Speicher dieses iPads. Bitte einmal mit Internet öffnen.</p><button onclick="location.reload()" style="font-size:20px;padding:12px 24px;border-radius:14px;border:0;background:#2C8BC8;color:#fff">Nochmal versuchen</button></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const reise = caches.open('lwf-cfg').then(c => c.match('/__cfg')).then(r => r ? r.json() : {}).then(c => !!c.reise).catch(() => false);
    e.respondWith(reise.then(rm => rm ? caches.match('index.html').then(clean) : null).then(hit => hit || Promise.race([fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }), timeout(2500)]).then(res => {
      if (!res.ok || (res.redirected && new URL(res.url).origin !== location.origin)) throw new Error('http ' + res.status);
      return Promise.race([res.text(), timeout(6000)]).then(txt => {
        if (txt.indexOf('lernwelt-freunde-app') < 0 || txt.lastIndexOf('</html>') < 0) throw new Error('keine Lernwelt');
        const page = () => new Response(txt, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        // nur speichern, wenn die Seite zu DIESEM Service Worker passt – eine neue Version speichert ihr eigener SW (mit Notfall-Kopie der alten)
        if (txt.indexOf("APP_VERSION = '2.84.0'") >= 0) caches.open(CACHE).then(c => c.put('index.html', page()));
        return page();
      });
    }).catch(() => caches.match('index.html').then(clean).then(hit => hit || fetch(req).catch(notfall)))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
