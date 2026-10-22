// ゆうしゃのしたく LIGHT - Service Worker
var CACHE_NAME = 'yuusha-light-v1';
var STATE_CACHE = 'yts-light-state';
var PRECACHE = ['./', './index.html', './manifest.json'];

function stateUrl() { return new URL('./__yts_state__', self.registration.scope).href; }

function readState() {
  return caches.open(STATE_CACHE)
    .then(function (c) { return c.match(stateUrl()); })
    .then(function (r) { return r ? r.json() : {}; })
    .catch(function () { return {}; })
    .then(function (s) { s = s || {}; s.active = s.active || []; s.cleared = s.cleared || []; return s; });
}

function updateState(fn) {
  return readState().then(function (s) {
    fn(s);
    return caches.open(STATE_CACHE).then(function (c) {
      return c.put(stateUrl(), new Response(JSON.stringify(s), { headers: { 'Content-Type': 'application/json' } }));
    });
  }).catch(function () {});
}

// 消された通知を、同じ内容で静かに出し直す（見張り続ける）
function reshow(n) {
  var d = n.data || {};
  var o = {
    body: n.body, tag: n.tag, icon: n.icon, badge: n.badge, data: d,
    requireInteraction: true, silent: true, renotify: false,
    timestamp: n.timestamp,
    actions: [{ action: 'clear', title: 'そうび解除' }]
  };
  if (d.thumb) o.image = d.thumb;
  return self.registration.showNotification(n.title, o);
}

self.addEventListener('install', function (event) {
  try {
    event.waitUntil(
      caches.open(CACHE_NAME).then(function (c) { return c.addAll(PRECACHE); }).catch(function () {})
    );
    self.skipWaiting();
  } catch (e) {}
});

self.addEventListener('activate', function (event) {
  try {
    event.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME && k !== STATE_CACHE; })
          .map(function (k) { return caches.delete(k); }));
      }).catch(function () {})
    );
    self.clients.claim();
  } catch (e) {}
});

self.addEventListener('fetch', function (event) {
  try {
    var req = event.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    event.respondWith(
      fetch(req).then(function (res) {
        try {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function (c) { c.put(req, copy).catch(function () {}); }).catch(function () {});
          }
        } catch (e) {}
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || new Response('オフラインです', { status: 503, statusText: 'Service Unavailable' });
        });
      })
    );
  } catch (e) {}
});

// スワイプなどで消された場合：まだ装備中なら出し直す
self.addEventListener('notificationclose', function (event) {
  try {
    var n = event.notification, d = n.data || {};
    if (!d.id) return;
    event.waitUntil(
      readState().then(function (s) {
        if (s.active.indexOf(d.id) >= 0) return reshow(n);
      }).catch(function () {})
    );
  } catch (e) {}
});

// 通知タップ：「そうび解除」なら消去、それ以外はアプリを開いて通知は残す
self.addEventListener('notificationclick', function (event) {
  try {
    var n = event.notification, d = n.data || {};
    n.close();
    if (event.action === 'clear' && d.id) {
      event.waitUntil(
        updateState(function (s) {
          s.active = s.active.filter(function (x) { return x !== d.id; });
          if (s.cleared.indexOf(d.id) < 0) s.cleared.push(d.id);
        }).then(function () {
          return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        }).then(function (list) {
          list.forEach(function (c) { c.postMessage({ type: 'cleared', id: d.id }); });
        }).catch(function () {})
      );
      return;
    }
    event.waitUntil(
      reshow(n).catch(function () {}).then(function () {
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      }).then(function (list) {
        for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
        if (self.clients.openWindow) return self.clients.openWindow('./index.html');
      }).catch(function () {})
    );
  } catch (e) {}
});
