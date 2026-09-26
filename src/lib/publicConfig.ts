import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { isConfigured } from "./config";
import { currencyForLocale, isCurrency, type Currency } from "../../supabase/functions/_shared/core/pricing.ts";

export interface PublicPlan {
  code: string; kind: "subscription" | "one_time"; name: string;
  generations: number; alterations: number; card_builds: number;
  prices: Partial<Record<Currency, { amount: string }>>;
}
interface PublicConfig { limits: { free_generations: number; paid_generations: number; paid_alterations: number }; plans: PublicPlan[] }

const FALLBACK: PublicConfig = {
  limits: { free_generations: 3, paid_generations: 7, paid_alterations: 2 },
  plans: [{ code: "plus_monthly", kind: "subscription", name: "Plus", generations: 7, alterations: 2, card_builds: 3, prices: { GBP: { amount: "2.99" }, USD: { amount: "3.99" } } }],
};

let cached: Promise<PublicConfig> | null = null;
function load(): Promise<PublicConfig> {
  if (!isConfigured) return Promise.resolve(FALLBACK);
  cached ??= Promise.resolve(supabase.rpc("public_config")).then(({ data }) => (data as PublicConfig) ?? FALLBACK, () => FALLBACK);
  return cached;
}

const CUR_KEY = "cc_currency";
function initialCurrency(): Currency {
  try {
    const v = localStorage.getItem(CUR_KEY);
    if (isCurrency(v)) return v;
  } catch { /* ignore */ }
  return currencyForLocale(navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone);
}

const listeners = new Set<(c: Currency) => void>();
let currentCurrency: Currency | null = null;

export function usePublicConfig() {
  const [config, setConfig] = useState<PublicConfig>(FALLBACK);
  const [currency, setCur] = useState<Currency>(() => (currentCurrency ??= initialCurrency()));
  useEffect(() => { void load().then(setConfig); }, []);
  useEffect(() => { listeners.add(setCur); return () => { listeners.delete(setCur); }; }, []);
  const setCurrency = (c: Currency) => {
    currentCurrency = c;
    try { localStorage.setItem(CUR_KEY, c); } catch { /* ignore */ }
    listeners.forEach((l) => l(c));
  };
  const plan = config.plans.find((p) => p.kind === "subscription") ?? FALLBACK.plans[0];
  return { config, plan, currency, setCurrency };
}
