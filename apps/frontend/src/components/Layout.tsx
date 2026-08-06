import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  QrCode,
  FileText,
  ScanLine,
  RefreshCw,
  ScrollText,
  UserCog,
  Workflow,
  CalendarDays,
  Sparkles,
  MonitorPlay,
  Gamepad2,
  Settings,
  LogOut,
  Menu,
  X,
  PencilLine,
  ChevronDown,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth.store";
import { OWNER_EMAIL } from "@/pages/Settings";
import { api } from "@/lib/api-client";
import clsx from "clsx";

const ADMIN = ["ADMIN", "SUPER_ADMIN"];

// Kept flat at the top so the booth sidebar stays simple.
const primaryItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Data", icon: Users },
  { to: "/scan", label: "Capture Lead", icon: ScanLine },
  { to: "/scan?manual=1", label: "Manual Form", icon: PencilLine },
  { to: "/booth", label: "Booth Mode", icon: MonitorPlay, roles: ADMIN },
];

// Admin-only tools, tucked behind a collapsible "Admin Tools" group.
const toolItems = [
  { to: "/events", label: "Events", icon: CalendarDays, roles: ADMIN },
  { to: "/ai/score", label: "AI Score Game", icon: Gamepad2, roles: ADMIN },
  { to: "/ai/history", label: "Analysis History", icon: Sparkles, roles: ADMIN },
  { to: "/qr-codes", label: "QR Codes", icon: QrCode, roles: ADMIN },
  { to: "/forms", label: "Form Builder", icon: FileText, roles: ADMIN },
  { to: "/sync", label: "Sync", icon: RefreshCw, roles: ADMIN },
  { to: "/audit", label: "Audit Log", icon: ScrollText, roles: ADMIN },
  { to: "/automation", label: "Automation", icon: Workflow, roles: ADMIN },
];

const bottomItems = [
  { to: "/users", label: "Users", icon: UserCog, roles: ["SUPER_ADMIN"] },
  { to: "/settings", label: "Settings", icon: Settings, owner: true },
];

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const visible = (item: any) => {
    if (item.owner) return (user?.email || "").toLowerCase() === OWNER_EMAIL.toLowerCase();
    return !item.roles || (user && item.roles.includes(user.role));
  };

  const isActive = (to: string) => {
    const [path] = to.split("?");
    if (path === "/") return location.pathname === "/";
    const pathMatch = location.pathname === path || location.pathname.startsWith(path + "/");
    // /scan (Capture Lead) vs /scan?manual=1 (Manual Form) — split by the query.
    if (path === "/scan") {
      const wantsManual = to.includes("manual=1");
      return location.pathname === "/scan" && location.search.includes("manual=1") === wantsManual;
    }
    return pathMatch;
  };

  const renderLink = (item: any) => (
    <Link
      key={item.to}
      to={item.to}
      onClick={() => setSidebarOpen(false)}
      className={clsx(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        isActive(item.to) ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
      )}
    >
      <item.icon className="h-5 w-5 flex-shrink-0" />
      {item.label}
    </Link>
  );

  const tools = toolItems.filter(visible);
  const [toolsOpen, setToolsOpen] = useState(() => tools.some((t) => location.pathname.startsWith(t.to)));

  // Title the app after the active event (e.g. "MMD 2026").
  const { data: eventsData } = useQuery({
    queryKey: ["layout-active-event"],
    queryFn: async () => (await api.events.list({ take: 100 })).data,
  });
  const eventList: { name: string; status?: string }[] = eventsData?.events ?? [];
  const eventName = (eventList.find((e) => e.status === "ACTIVE") ?? eventList[0])?.name || "Lead Capture";

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-white border-r border-gray-200 transition-transform duration-200 lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-6">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            {eventName.charAt(0).toUpperCase()}
          </div>
          <span className="truncate text-lg font-bold text-gray-900" title={eventName}>{eventName}</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {primaryItems.filter(visible).map(renderLink)}

          {/* Admin Tools — collapsed by default to keep the booth sidebar simple */}
          {tools.length > 0 && (
            <div className="pt-1">
              <button
                onClick={() => setToolsOpen((o) => !o)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                <Wrench className="h-5 w-5 flex-shrink-0" />
                <span className="flex-1 text-left">Admin Tools</span>
                <ChevronDown className={clsx("h-4 w-4 transition-transform", toolsOpen && "rotate-180")} />
              </button>
              {toolsOpen && <div className="mt-1 space-y-1 border-l border-gray-100 pl-3">{tools.map(renderLink)}</div>}
            </div>
          )}

          {bottomItems.filter(visible).map(renderLink)}
        </nav>

        <div className="border-t border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <Link to="/account" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 hover:bg-gray-100" title="My account">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                {user?.name?.charAt(0) ?? "A"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{user?.name ?? "Admin"}</p>
                <p className="truncate text-xs text-gray-500">{user?.role ?? "SUPER_ADMIN"}</p>
              </div>
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center gap-4 border-b border-gray-200 bg-white px-4 lg:px-6">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <h1 className="truncate text-lg font-semibold text-gray-900">{eventName}</h1>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
