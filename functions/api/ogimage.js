/**
 * Cloudflare Pages Functions：ニュース記事の代表画像（OGP画像）を探す
 * 置き場所：リポジトリの functions/api/ogimage.js
 * 呼び出し：/api/ogimage?url=（記事のURL）  →  { "image": "画像のURL" }
 * ・記事ページの og:image / twitter:image を読み取ります
 * ・Googleニュースのリンクは、元の記事URLに変換してから読み取ります
 * ・結果は1日キャッシュするので、同じ記事を何度も読みに行きません
 * ・画像が見つからない場合は空文字を返し、ポータル側はアイコン表示になります
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function onRequestGet(context) {
  const { request } = context;
  const target = new URL(request.url).searchParams.get('url');
  let url;
  try { url = new URL(target); } catch { return json({ image: '' }, 400); }
  if (!/^https?:$/.test(url.protocol)) return json({ image: '' }, 400);

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let image = '';
  try {
    let articleUrl = url.toString();
    if (url.hostname === 'news.google.com') articleUrl = await decodeGoogleNews(url);
    if (articleUrl) image = await findImage(articleUrl);
  } catch { image = ''; }

  // 見つかったら1日、見つからなければ1時間キャッシュ
  const res = json({ image }, 200, image ? 86400 : 3600);
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function json(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` },
  });
}

// ページの先頭部分だけ読む（画像指定は<head>内にあるため）
async function readHead(res, limit = 300000) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '', size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    text += decoder.decode(value, { stream: true });
    if (/<\/head>/i.test(text)) break;
  }
  try { await reader.cancel(); } catch {}
  return text;
}

async function findImage(pageUrl) {
  const res = await fetch(pageUrl, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'ja,en;q=0.8' },
    redirect: 'follow',
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return '';
  const html = await readHead(res);
  const pick = re => { const m = html.match(re); return m ? m[1] : ''; };
  let img =
    pick(/<meta[^>]+property=["']og:image(?::secure_url|:url)?["'][^>]*content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url|:url)?["']/i) ||
    pick(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i);
  if (!img) return '';
  img = img.replace(/&amp;/g, '&').trim();
  try { img = new URL(img, res.url).toString(); } catch { return ''; }
  if (img.startsWith('http://')) img = 'https://' + img.slice(7);
  return img.startsWith('https://') ? img : '';
}

// GoogleニュースのリンクをもとのニュースサイトのURLに変換
async function decodeGoogleNews(url) {
  const m = url.pathname.match(/\/(?:rss\/)?articles\/([^/?]+)/);
  if (!m) return '';
  const id = m[1];
  const page = await fetch(`https://news.google.com/articles/${id}`, { headers: { 'User-Agent': UA } });
  if (!page.ok) return '';
  const html = await page.text();
  const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
  const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sg || !ts) return '';
  const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`;
  const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner]]]));
  const r = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
    body,
  });
  if (!r.ok) return '';
  const chunk = (await r.text()).split('\n\n')[1];
  if (!chunk) return '';
  const decoded = JSON.parse(JSON.parse(chunk)[0][2])[1];
  return typeof decoded === 'string' && /^https?:\/\//.test(decoded) ? decoded : '';
}
