import "./App.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import TripList from "./components/TripList";
import Login from "./pages/Login";
import Register from "./pages/Register";
import AdminPanel from "./pages/AdminPanel";
import CompanyPanel from "./pages/CompanyPanel";
import MyTickets from "./pages/MyTickets";
import Account from "./pages/Account";
import RequireAuth from "./lib/RequireAuth";
import { Card } from "./components/ui/card";
import { AuthProvider, useAuth } from "./lib/auth";

const queryClient = new QueryClient();

function NavLinks() {
  const { user, logout } = useAuth();
  // Try to safely extract a numeric balance from the user object.
  // Also extract role to control which nav links are visible (admins shouldn't see personal account link)
  const role: string = (() => {
    try {
      if (!user) return "";
      const maybe = user as Record<string, unknown>;
      const r = maybe["role"];
      return typeof r === "string" ? r : String(r ?? "");
    } catch {
      return "";
    }
  })();
  const balanceValue: number | null = (() => {

    if (!user) return null;
    const maybe = user as Record<string, unknown>;
    const keys = ["balance", "bakiye", "credit", "credits", "money", "amount"];
    for (const k of keys) {
      const v = maybe[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") {
        // Normalize comma decimal and strip non-numeric chars
        const cleaned = v.replace(",", ".").replace(/[^0-9.-]/g, "");
        const n = Number(cleaned);
        if (!Number.isNaN(n)) return n;
      }
    }
    return null;
  })();

  const formatTRY = (n: number) =>
    new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(n);

  return (
    <div className="flex items-center gap-4">
      <NavLink
        to="/"
        className={({ isActive }) =>
          isActive
            ? "font-semibold text-black"
            : "font-semibold text-muted-foreground"
        }
      >
        Ana Sayfa
      </NavLink>
      {!user && (
        <>
          <NavLink
            to="/login"
            className={({ isActive }) =>
              isActive
                ? "text-black font-semibold text-sm"
                : "text-sm text-muted-foreground"
            }
          >
            Giriş
          </NavLink>
          <NavLink
            to="/register"
            className={({ isActive }) =>
              isActive
                ? "text-black font-semibold text-sm"
                : "text-sm text-muted-foreground"
            }
          >
            Kayıt
          </NavLink>
        </>
      )}

      {user && user.role === "admin" && (
        <>
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              isActive ? "text-black font-semibold text-sm" : "text-sm"
            }
          >
            Admin Paneli
          </NavLink>
        </>
      )}

      {user && user.role === "company" && (
        <NavLink
          to="/company"
          className={({ isActive }) =>
            isActive ? "text-black font-semibold text-sm" : "text-sm"
          }
        >
          Firma Paneli
        </NavLink>
      )}

      {/* Don't show personal account link to admin users */}
      {user && role !== "admin" && (
        <NavLink
          to="/account"
          className={({ isActive }) =>
            isActive ? "text-black font-semibold text-sm" : "text-sm"
          }
        >
          Hesabım
        </NavLink>
      )}

      {user && user.role === "user" && (
        <NavLink
          to="/my-tickets"
          className={({ isActive }) =>
            isActive ? "text-black font-semibold text-sm" : "text-sm"
          }
        >
          Biletlerim
        </NavLink>
      )}

      {user && balanceValue != null && (
        <div className="ml-auto text-sm font-medium">
          {formatTRY(balanceValue)}
        </div>
      )}

      {user && (
        <button
          onClick={() => logout()}
          className={`text-sm ${
            balanceValue == null ? "ml-auto" : "ml-2"
          } cursor-pointer`}
          aria-label="Çıkış"
        >
          Çıkış
        </button>
      )}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <div className="min-h-screen bg-gray-50">
            <nav className="p-4 bg-white shadow-sm">
              <div className="max-w-5xl mx-auto flex items-center justify-between">
                <a href="/" className="flex items-center gap-2 text-xl font-bold text-black">
                  {/* Simple text logo; replace with SVG or image if desired */}
                  <span>Yavuzlar</span>
                </a>
                <NavLinks />
              </div>
            </nav>

            <main className="p-4">
              <div className="max-w-5xl mx-auto">
                <Routes>
                  <Route
                    path="/"
                    element={
                      <div className="p-4">
                        <Card className="max-w-4xl mx-auto">
                          <TripList />
                        </Card>
                      </div>
                    }
                  />
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  <Route
                    path="/admin"
                    element={
                      <RequireAuth allowedRoles={["admin"]}>
                        <AdminPanel />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/company"
                    element={
                      <RequireAuth allowedRoles={["company"]}>
                        <CompanyPanel />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/account"
                    element={
                      <RequireAuth>
                        <Account />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/my-tickets"
                    element={
                      <RequireAuth allowedRoles={["user"]}>
                        <MyTickets />
                      </RequireAuth>
                    }
                  />
                </Routes>
              </div>
            </main>
          </div>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
