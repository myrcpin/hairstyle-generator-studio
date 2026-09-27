import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { isConfigured } from "./config";
import { currencyForLocale, isCurrency, type Currency } from "../../supabase/functions/_shared/core/pricing.ts";

export interface PublicPlan {
  code: string; kind: "subscription" | "one_time" | "business"; name: string; description?: string | null;
  access_days?: number | null; max_members?: number | null;
  generations: number; alterations: number; card_builds: number;
  prices: Partial<Record<Currency, { amount: string }>>;
}
interface PublicConfig {
  limits: { free_generations: number; paid_generations: number; paid_alterations: number };
  referrals?: { friends_per_reward: number; max_rewards: number; reward_days: number; referee_bonus_generations: number };
  plans: PublicPlan[];
}

const FALLBACK: PublicConfig = {
  limits: { free_generations: 3, paid_generations: 7, paid_alterations: 2 },
  referrals: { friends_per_reward: 3, max_rewards: 3, reward_days: 30, referee_bonus_generations: 1 },
  plans: [
    { code: "starter_pack", kind: "one_time", name: "Starter Pack", generations: 5, alterations: 1, card_builds: 1, access_days: 60, prices: { GBP: { amount: "2.99" }, USD: { amount: "4.99" } } },
    { code: "plus_monthly", kind: "subscription", name: "Plus", generations: 7, alterations: 2, card_builds: 3, prices: { GBP: { amount: "2.99" }, USD: { amount: "3.99" } } },
    { code: "business_studio", kind: "business", name: "Salon", description: "For independent salons and barbershops: up to 3 staff.", generations: 60, alterations: 20, card_builds: 40, max_members: 3, prices: { GBP: { amount: "29.00" }, USD: { amount: "39.00" } } },
    { code: "business_pro", kind: "business", name: "Salon Pro", description: "For busy or multi-chair salons: up to 10 staff.", generations: 150, alterations: 50, card_builds: 100, max_members: 10, prices: { GBP: { amount: "59.00" }, USD: { amount: "79.00" } } },
  ],
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
  const plan = config.plans.find((p) => p.kind === "subscription") ?? FALLBACK.plans[1];
  const pack = config.plans.find((p) => p.kind === "one_time") ?? FALLBACK.plans[0];
  const businessPlans = config.plans.filter((p) => p.kind === "business");
  const referrals = config.referrals ?? FALLBACK.referrals!;
  return { config, plan, pack, businessPlans, referrals, currency, setCurrency };
}
