import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, callFn, errorMessage } from "../lib/api";
import type { CardPayload } from "../lib/types";
import { HairstyleCard } from "../components/HairstyleCard";
import { Alert, Spinner } from "../components/ui";
import { APP_NAME } from "../lib/config";

export default function PublicCard() {
  const { token = "" } = useParams();
  const [card, setCard] = useState<CardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callFn<CardPayload>("public-card", { token }, { auth: false })
      .then((c) => setCard({ ...c, tier: "full" }))
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "This Hairstyle Card link isn't valid or is no longer shared." : errorMessage(e)));
  }, [token]);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  if (error) return (
    <div className="container-x max-w-xl py-16">
      <Alert tone="info">{error}</Alert>
      <p className="mt-6 text-ink-2">Want your own? <Link to="/" className="underline">Try {APP_NAME} free</Link>.</p>
    </div>
  );
  if (!card) return <div className="container-x py-16"><Spinner label="Loading card" /></div>;
  return (
    <div className="container-x py-8">
      <HairstyleCard card={card} />
      <p className="no-print mt-8 text-center text-[14px] text-muted">Made with <Link to="/" className="underline">{APP_NAME}</Link> — see your next haircut before you cut it.</p>
    </div>
  );
}
