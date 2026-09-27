import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { callFn, errorMessage } from "../lib/api";
import { Alert, Spinner } from "../components/ui";

export default function BusinessJoin() {
  const { code = "" } = useParams();
  const { ready, session, isVerified } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !isVerified) return;
    callFn<{ orgId: string }>("business", { action: "join", code })
      .then((r) => navigate(`/business/dashboard?org=${r.orgId}`, { replace: true }))
      .catch((e) => setError(errorMessage(e)));
  }, [session, isVerified, code, navigate]);

  if (!ready) return <div className="container-x py-16"><Spinner /></div>;
  if (!session || !isVerified) return <Navigate to={`/signin?next=/business/join/${code}`} replace />;
  return <div className="container-x max-w-xl py-16">{error ? <Alert>{error}</Alert> : <p role="status" className="flex items-center gap-3"><Spinner /> Joining your salon team…</p>}</div>;
}
