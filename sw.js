/* 三島ポータル サービスワーカー（ホーム画面に追加したときの動作）
   ・ページ（index.html）は、つねに最新をネットから読み込みます。つながらないときだけ、前回の内容を表示します
   ・画像やアイコンは、一度読み込んだものを保存して、次から速く表示します
   ・画像を差し替えたのに古いまま表示されるときは、下の CACHE の数字を1つ上げてアップしてください */
const CACHE = 'mishima-portal-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  // 古い保存データを消す
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 天気など、ほかのサイトへの通信はそのまま

  // ページ本体：ネット優先（いつも最新）、つながらないときだけ保存した内容
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // 画像・アイコン・設定ファイル：保存したものを優先し、裏で新しいものを取りに行く
  e.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
