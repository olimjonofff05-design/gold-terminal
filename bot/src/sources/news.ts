import { getText, log, nowSec } from '../util.ts';

export interface NewsItem { title: string; source: string; link: string; time: number }

const FEEDS: { url: string; source?: string }[] = [
  { url: 'https://news.google.com/rss/search?q=gold+price+when:1d&hl=en-US&gl=US&ceid=US:en' },
  { url: 'https://news.google.com/rss/search?q=%22Federal+Reserve%22+OR+%22Fed+rate%22+when:1d&hl=en-US&gl=US&ceid=US:en' },
  { url: 'https://news.google.com/rss/search?q=%22Treasury+yields%22+OR+%22US+dollar%22+when:1d&hl=en-US&gl=US&ceid=US:en' },
  { url: 'https://news.google.com/rss/search?q=%22central+bank%22+gold+buying+when:3d&hl=en-US&gl=US&ceid=US:en' },
];

const tag = (s: string, t: string) => {
  const m = s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
};
const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Oxirgi `hours` soatdagi yangiliklar, takrorlar olib tashlangan */
export async function news(hours = 24, max = 40): Promise<NewsItem[]> {
  const since = nowSec() - hours * 3600;
  const all: NewsItem[] = [];
  await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const xml = await getText(f.url);
        for (const it of xml.split('<item>').slice(1)) {
          let title = decode(tag(it, 'title'));
          let source = f.source ?? decode(tag(it, 'source'));
          // Google News sarlavhasi: "Sarlavha - Manba"
          const dash = title.lastIndexOf(' - ');
          if (!f.source && dash > 0) {
            source ||= title.slice(dash + 3);
            title = title.slice(0, dash);
          }
          const time = Math.floor(Date.parse(tag(it, 'pubDate')) / 1000);
          if (!title || !(time >= since)) continue;
          all.push({ title, source, link: decode(tag(it, 'link')), time });
        }
      } catch (e) {
        log('RSS:', f.url.slice(0, 50), (e as Error).message);
      }
    }),
  );
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.time - a.time)
    .filter((n) => {
      const k = n.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 7).join(' ');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);
}
