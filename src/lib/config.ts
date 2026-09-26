export const APP_NAME = import.meta.env.VITE_APP_NAME || "CutCard";
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "support@example.com";
export const COMPANY_NAME = import.meta.env.VITE_COMPANY_NAME || `${APP_NAME} (operator name to be configured)`;
export const COMPANY_ADDRESS = import.meta.env.VITE_COMPANY_ADDRESS || "";
export const isConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
