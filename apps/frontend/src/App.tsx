import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useAuthStore } from "./stores/auth.store";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/Dashboard";
import { LeadsPage } from "./pages/Leads";
import { LeadDetailPage } from "./pages/LeadDetail";
import { QrCodesPage } from "./pages/QrCodes";
import { FormBuilderPage } from "./pages/FormBuilder";
import { OcrScanPage } from "./pages/OcrScan";
import { SyncPage } from "./pages/Sync";
import { AuditLogPage } from "./pages/AuditLog";
import { UsersPage } from "./pages/Users";
import { AutomationPage } from "./pages/Automation";
import { EventsPage } from "./pages/Events";
import { AccountPage } from "./pages/Account";
import { SettingsPage, OWNER_EMAIL } from "./pages/Settings";
import { PublicLeadForm } from "./pages/PublicLeadForm";
import { WebsiteRoastPage } from "./pages/WebsiteRoast";
import { ScoreGamePage } from "./pages/ScoreGame";
import { AnalysisHistoryPage } from "./pages/AnalysisHistory";
import { AnalysisReportPage } from "./pages/AnalysisReport";
import { BoothLanding } from "./pages/BoothLanding";
import { PartnershipCalculator } from "./pages/PartnershipCalculator";
import { PlaySelect } from "./pages/PlaySelect";
import { PublicScoreGame } from "./pages/PublicScoreGame";
import { ProfitCalculator } from "./pages/ProfitCalculator";
import { TvDisplay } from "./pages/TvDisplay";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Blocks direct-URL access to routes above the user's role (defense in depth —
// the sidebar hides them and the backend also enforces the same roles).
function RequireRole({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const ADMIN = ["ADMIN", "SUPER_ADMIN"];

// Settings are locked to a single owner account — even other super admins can't enter.
function RequireOwner({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user || (user.email || "").toLowerCase() !== OWNER_EMAIL.toLowerCase()) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/v/:shortCode" element={<PublicLeadForm />} />
        <Route path="/play/:token" element={<PlaySelect />} />
        <Route path="/play/:token/score" element={<PublicScoreGame />} />
        <Route path="/booth/score" element={<PublicScoreGame />} />
        <Route path="/play/:token/calculator" element={<ProfitCalculator />} />
        <Route path="/tv" element={<TvDisplay />} />
        <Route path="/ai/report/:id" element={<AnalysisReportPage />} />
        <Route path="/booth" element={<BoothLanding />} />
        <Route path="/booth/calculator" element={<ProfitCalculator />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="leads/:id" element={<LeadDetailPage />} />
          <Route path="scan" element={<OcrScanPage />} />
          <Route path="ai/score" element={<ScoreGamePage />} />
          <Route path="ai/roast" element={<WebsiteRoastPage />} />
          <Route path="ai/history" element={<AnalysisHistoryPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="settings" element={<RequireOwner><SettingsPage /></RequireOwner>} />
          <Route path="qr-codes" element={<RequireRole roles={ADMIN}><QrCodesPage /></RequireRole>} />
          <Route path="forms" element={<RequireRole roles={ADMIN}><FormBuilderPage /></RequireRole>} />
          <Route path="sync" element={<RequireRole roles={ADMIN}><SyncPage /></RequireRole>} />
          <Route path="audit" element={<RequireRole roles={ADMIN}><AuditLogPage /></RequireRole>} />
          <Route path="automation" element={<RequireRole roles={ADMIN}><AutomationPage /></RequireRole>} />
          <Route path="events" element={<RequireRole roles={ADMIN}><EventsPage /></RequireRole>} />
          <Route path="partnership-calc" element={<RequireRole roles={ADMIN}><PartnershipCalculator /></RequireRole>} />
          <Route path="users" element={<RequireRole roles={["SUPER_ADMIN"]}><UsersPage /></RequireRole>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" />
    </>
  );
}
