/**
 * Cloudflare Pages Functions：ニュースRSSの中継
 * 置き場所：リポジトリの functions/api/rss.js
 * 呼び出し：/api/rss?url=（RSSのURL）
 * ・許可したサイトのRSSだけを取得します（それ以外は拒否）
 * ・10分間キャッシュするので、アクセスが増えても相手サイトに負担をかけません
 */
const ALLOWED_HOSTS = [
  'www.apple.com',
  'news.google.com',
  'rss.itmedia.co.jp',
];

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url');
  let url;
  try { url = new URL(target); } catch { return new Response('URLが正しくありません', { status: 400 }); }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
    return new Response('このサイトは許可されていません', { status: 403 });
  }
  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MishimaPortal/1.0)' },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    if (!res.ok) return new Response('取得に失敗しました', { status: 502 });
    return new Response(await res.text(), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=600',
      },
    });
  } catch {
    return new Response('取得に失敗しました', { status: 502 });
  }
}
