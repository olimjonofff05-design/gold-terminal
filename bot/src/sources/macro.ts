import { env, getJson, log } from '../util.ts';

export interface Series { last: number; prev5: number; date: string }
export interface Macro {
  realYield: Series | null; // DFII10, %
  nominal: Series | null; // DGS10, %
  dxy: Series | null; // ICE DXY (Yahoo), zaxira — FRED DTWEXBGS
  dxySource: string;
}

async function fred(id: string): Promise<Series | null> {
  try {
    const j = await getJson<{ observations: { date: string; value: string }[] }>(
      `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${env('FRED_API_KEY')}&file_type=json&sort_order=desc&limit=15`,
    );
    const v = j.observations.filter((o) => o.value !== '.').map((o) => ({ date: o.date, v: +o.value }));
    if (v.length < 6) return null;
    return { last: v[0].v, prev5: v[5].v, date: v[0].date };
  } catch (e) {
    log(`FRED ${id}:`, (e as Error).message);
    return null;
  }
}

async function yahooDxy(): Promise<Series | null> {
  try {
    const j = await getJson<{ chart: { result: { timestamp: number[]; indicators: { quote: { close: (number | null)[] }[] } }[] } }>(
      'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=1mo',
    );
    const r = j.chart.result[0];
    const v = r.timestamp.map((t, i) => ({ t, v: r.indicators.quote[0].close[i] })).filter((x): x is { t: number; v: number } => x.v != null);
    if (v.length < 6) return null;
    const n = v.length;
    return { last: v[n - 1].v, prev5: v[n - 6].v, date: new Date(v[n - 1].t * 1000).toISOString().slice(0, 10) };
  } catch (e) {
    log('DXY:', (e as Error).message);
    return null;
  }
}

export async function macro(): Promise<Macro> {
  const [realYield, nominal, dxyY] = await Promise.all([fred('DFII10'), fred('DGS10'), yahooDxy()]);
  if (dxyY) return { realYield, nominal, dxy: dxyY, dxySource: 'DXY' };
  return { realYield, nominal, dxy: await fred('DTWEXBGS'), dxySource: 'Dollar indeksi (FRED)' };
}

// ---------------- COT (CFTC, disaggregated, oltin 088691) ----------------
export interface Cot { date: string; net: number; netPrev: number; index3y: number }
export async function cot(): Promise<Cot | null> {
  try {
    const j = await getJson<{ report_date_as_yyyy_mm_dd: string; m_money_positions_long_all: string; m_money_positions_short_all: string }[]>(
      'https://publicreporting.cftc.gov/resource/72hh-3qpy.json?cftc_contract_market_code=088691' +
        '&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=156&$select=report_date_as_yyyy_mm_dd,m_money_positions_long_all,m_money_positions_short_all',
    );
    const net = j.map((r) => +r.m_money_positions_long_all - +r.m_money_positions_short_all);
    if (net.length < 10) return null;
    const lo = Math.min(...net);
    const hi = Math.max(...net);
    return { date: j[0].report_date_as_yyyy_mm_dd.slice(0, 10), net: net[0], netPrev: net[1], index3y: hi > lo ? ((net[0] - lo) / (hi - lo)) * 100 : 50 };
  } catch (e) {
    log('COT:', (e as Error).message);
    return null;
  }
}

/** FRED release_id: 50 — Employment Situation (NFP), 10 — CPI */
export async function releaseDates(releaseId: number, n = 14): Promise<string[]> {
  const j = await getJson<{ release_dates: { date: string }[] }>(
    `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${env('FRED_API_KEY')}&file_type=json&sort_order=desc&limit=${n}&include_release_dates_with_no_data=true`,
  );
  return j.release_dates.map((d) => d.date);
}
