import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { captureReferralFromUrl } from "./lib/referral";

captureReferralFromUrl();

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
