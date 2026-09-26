import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import Landing from "./pages/Landing";

const Studio = lazy(() => import("./pages/Studio"));
const Project = lazy(() => import("./pages/Project"));
const Card = lazy(() => import("./pages/Card"));
const PublicCard = lazy(() => import("./pages/PublicCard"));
import Pricing from "./pages/Pricing";
const BillingReturn = lazy(() => import("./pages/BillingReturn"));
const Account = lazy(() => import("./pages/Account"));
const SignIn = lazy(() => import("./pages/SignIn"));
const Admin = lazy(() => import("./pages/Admin"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Privacy = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Terms })));
const Cookies = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Cookies })));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Layout>
          <Suspense fallback={<div className="container-x py-16"><Spinner /></div>}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/start" element={<Studio />} />
              <Route path="/project/:id" element={<Project />} />
              <Route path="/card/:id" element={<Card />} />
              <Route path="/style/:token" element={<PublicCard />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/billing/return" element={<BillingReturn />} />
              <Route path="/account" element={<Account />} />
              <Route path="/signin" element={<SignIn />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/cookies" element={<Cookies />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Layout>
      </AuthProvider>
    </BrowserRouter>
  );
}
