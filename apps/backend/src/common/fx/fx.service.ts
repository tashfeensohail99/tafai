import { Injectable, Logger } from '@nestjs/common';

export interface FxRates {
  /** Base currency these rates are expressed against. Always CAD. */
  base: string;
  /** "1 BASE = N <currency>" — e.g. rates.PKR = 202.44 means 1 CAD = 202.44 PKR. */
  rates: Record<string, number>;
  /** Epoch ms when we fetched them. */
  fetchedAt: number;
  /** Which provider supplied them (or 'fallback'). */
  source: string;
  /** Provider's own "as of" timestamp, when available. */
  asOf: string;
}

export interface Conversion {
  baseAmount: number;   // amount expressed in CAD, 2dp
  baseCurrency: string; // 'CAD'
  rate: number;         // units of source currency per 1 CAD (e.g. 202.44)
  source: string;       // provider label
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Foreign-exchange rates to the firm's base currency (CAD).
 *
 * Free, no-API-key providers, cached in memory for a few hours, with graceful
 * fallback so a foreign-currency payment can always be booked:
 *   1. open.er-api.com            (primary — daily, includes PKR)
 *   2. fawazahmed0 currency-api    (CDN fallback — daily, includes PKR)
 *   3. last good cached rates      (even if stale)
 *   4. a hardcoded sane default    (cold-start + both providers down)
 *
 * Rates are "1 CAD = N <currency>", so converting a foreign amount to CAD is
 * `baseAmount = amount / rate`. The rate used is stamped onto each transaction
 * so historical records never move when the live rate changes.
 */
@Injectable()
export class FxService {
  private readonly log = new Logger(FxService.name);
  private readonly base = 'CAD';
  private readonly ttlMs = 6 * 60 * 60 * 1000; // 6 hours
  private cache: FxRates | null = null;
  private inflight: Promise<FxRates> | null = null;

  // Last-resort static rates (1 CAD = N) — only used at cold start if both
  // providers are unreachable. Approximate; the live feed corrects within hours.
  private static readonly FALLBACK: Record<string, number> = {
    CAD: 1, PKR: 202, USD: 0.73, GBP: 0.58, EUR: 0.68, AED: 2.68, INR: 61, AUD: 1.11, SAR: 2.74,
  };

  get baseCurrency(): string {
    return this.base;
  }

  async getRates(): Promise<FxRates> {
    if (this.cache && Date.now() - this.cache.fetchedAt < this.ttlMs) return this.cache;
    if (this.inflight) return this.inflight;
    this.inflight = this.refresh();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /** Convert `amount` in `currency` to CAD. Throws if the currency is unknown. */
  async convertToBase(amount: number, currency: string | null | undefined): Promise<Conversion> {
    const ccy = (currency || this.base).toUpperCase();
    if (ccy === this.base) {
      return { baseAmount: round2(amount), baseCurrency: this.base, rate: 1, source: 'base' };
    }
    const { rates, source } = await this.getRates();
    const rate = rates[ccy];
    if (!rate || rate <= 0) {
      throw new Error(`No exchange rate available for ${ccy} → ${this.base}`);
    }
    return { baseAmount: round2(amount / rate), baseCurrency: this.base, rate, source };
  }

  /**
   * Convert a CAD amount INTO `currency` (inverse of convertToBase). Used by the
   * reporting layer to express consolidated CAD totals in a chosen display
   * currency, and to state a foreign-currency cost in an agreement's own
   * currency. Rates are "1 CAD = N currency", so `amount = cad * rate`.
   */
  async convertFromBase(cadAmount: number, currency: string | null | undefined): Promise<number> {
    const ccy = (currency || this.base).toUpperCase();
    if (ccy === this.base) return round2(cadAmount);
    const { rates } = await this.getRates();
    const rate = rates[ccy];
    if (!rate || rate <= 0) {
      throw new Error(`No exchange rate available for ${this.base} → ${ccy}`);
    }
    return round2(cadAmount * rate);
  }

  /** Convert `amount` from one currency to another (via the CAD base). */
  async convertBetween(
    amount: number,
    from: string | null | undefined,
    to: string | null | undefined,
  ): Promise<number> {
    const src = (from || this.base).toUpperCase();
    const dst = (to || this.base).toUpperCase();
    if (src === dst) return round2(amount);
    const { baseAmount } = await this.convertToBase(amount, src);
    return this.convertFromBase(baseAmount, dst);
  }

  private async refresh(): Promise<FxRates> {
    // 1) open.er-api.com
    try {
      const r = await this.fetchJson<{
        result?: string;
        rates?: Record<string, number>;
        time_last_update_utc?: string;
      }>(`https://open.er-api.com/v6/latest/${this.base}`);
      if (r.result === 'success' && r.rates && r.rates.PKR) {
        this.cache = {
          base: this.base,
          rates: r.rates,
          fetchedAt: Date.now(),
          source: 'open.er-api.com',
          asOf: r.time_last_update_utc ?? '',
        };
        return this.cache;
      }
    } catch (e) {
      this.log.warn(`FX primary (open.er-api) failed: ${(e as Error).message}`);
    }

    // 2) fawazahmed0 currency-api (CDN)
    try {
      const r = await this.fetchJson<{ date?: string; cad?: Record<string, number> }>(
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cad.json`,
      );
      if (r.cad && r.cad.pkr) {
        const rates: Record<string, number> = { CAD: 1 };
        for (const [k, v] of Object.entries(r.cad)) rates[k.toUpperCase()] = v;
        this.cache = {
          base: this.base,
          rates,
          fetchedAt: Date.now(),
          source: 'fawazahmed0',
          asOf: r.date ?? '',
        };
        return this.cache;
      }
    } catch (e) {
      this.log.warn(`FX fallback (fawazahmed0) failed: ${(e as Error).message}`);
    }

    // 3) stale cache
    if (this.cache) {
      this.log.warn('FX providers unreachable — serving stale cached rates');
      return this.cache;
    }

    // 4) hardcoded fallback
    this.log.warn('FX providers unreachable and no cache — using hardcoded fallback rates');
    return {
      base: this.base,
      rates: { ...FxService.FALLBACK },
      fetchedAt: Date.now(),
      source: 'fallback',
      asOf: '',
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
