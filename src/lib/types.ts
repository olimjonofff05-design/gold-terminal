export interface Candle {
  time: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Dir = 1 | -1;

export interface Pivot {
  i: number;
  time: number;
  price: number;
  type: 'H' | 'L';
  broken?: boolean;
}

export interface StructureEvent {
  i: number;
  time: number;
  price: number;
  kind: 'BOS' | 'CHoCH';
  dir: Dir;
  fromTime: number;
}

export interface Zone {
  kind: 'FVG' | 'OB';
  dir: Dir;
  top: number;
  bottom: number;
  time: number; // start time
  i: number;
}

export interface LiquidityLevel {
  kind: 'BSL' | 'SSL' | 'EQH' | 'EQL' | 'PDH' | 'PDL' | 'AsH' | 'AsL';
  price: number;
  time: number;
}

export interface FibInfo {
  dir: Dir; // 1 = up-leg (look for longs in discount), -1 = down-leg
  high: number;
  low: number;
  startTime: number;
  levels: { r: number; price: number; label: string }[];
  pos: number; // 0 = at low, 1 = at high
}

export interface Factor {
  key: string;
  label: string;
  value: number; // -1..1 (positive = bullish)
  weight: number;
  note: string;
}

export interface Setup {
  dir: Dir;
  entry: number;
  limitEntry: number | null;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rr1: number;
  rr2: number;
}

export interface Analysis {
  price: number;
  atr: number;
  rsi: number;
  ema20: number[];
  ema50: number[];
  ema200: number[];
  trend: 0 | Dir;
  events: StructureEvent[];
  pivots: Pivot[];
  zones: Zone[];
  liquidity: LiquidityLevel[];
  sweep: { dir: Dir; price: number; time: number } | null;
  fib: FibInfo | null;
  factors: Factor[];
  score: number; // -100..100
  setup: Setup | null;
  session: { name: string; killzone: boolean };
  momentum: Momentum;
  nyOpen: number | null; // ICT "true day open" — NY 00:00 ochilish narxi
  asia: { high: number; low: number } | null; // Osiyo diapazoni (20:00–00:00 NY)
}

export type MoveKind = 'Qaytish' | 'Sweep';
export interface MoveSignal {
  i: number;
  time: number;
  dir: Dir;
  kind: MoveKind;
  price: number; // signal shami yopilishi
  sl: number;
  tp: number;
  rr: number; // TP / SL nisbati
  strength: number; // 0..1
  note: string;
}
export interface Momentum {
  dir: 0 | Dir;
  moveAtr: number; // oxirgi 3 sham harakati, ATR birligida
  roc: number; // 10 sham o'zgarishi, %
  volRatio: number; // oxirgi sham hajmi / 20 sham o'rtachasi
  rangeHigh: number; // 20 sham diapazoni
  rangeLow: number;
  current: MoveSignal | null; // oxirgi 2 shamdagi signal
  events: MoveSignal[];
}

export interface KillzoneSpan {
  from: number;
  to: number;
  kind: 'asia' | 'london' | 'ny';
}

export interface BacktestResult {
  trades: number;
  wins: number;
  winRate: number;
  avgR: number;
  totalR: number;
  profitFactor: number;
  maxDD: number;
}
