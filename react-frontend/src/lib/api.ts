export type Trip = {
  id: string;
  company_id?: string;
  company_name?: string;
  company_logo?: string | null;
  destination_city: string;
  departure_city: string;
  departure_time: string;
  arrival_time?: string;
  price: number;
  capacity?: number;
  available_seats?: number;
};

export type TripsResponse = {
  success: boolean;
  data: Trip[];
  count: number;
  total?: number;
  limit?: number;
  offset?: number;
};

const _env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
const rawBase = _env?.VITE_API_BASE ?? (_env?.DEV ? 'http://localhost:8000/api' : '/api');
const API_BASE = rawBase ? String(rawBase).replace(/\/$/, '') : '/api';

export async function fetchTrips(query: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && String(v) !== '') params.set(k, String(v));
  }

  const res = await fetch(`${API_BASE}/trips.php?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  const json = await res.json();
  return json as TripsResponse;
}

export async function fetchMyTrips() {
  // uses mine=true and authenticated headers
  const res = await apiFetch(`${API_BASE}/trips.php?mine=true`, { headers: authHeaders() });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return await res.json() as TripsResponse;
}

export async function fetchTripTickets(tripId: string) {
  const res = await apiFetch(`${API_BASE}/trips.php/${encodeURIComponent(tripId)}/tickets`, { headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean; data?: Array<Record<string, unknown>> };
}

export async function createTrip(payload: { destination_city: string; departure_city: string; departure_time: string; arrival_time?: string; price: number; capacity: number }) {
  const res = await apiFetch(`${API_BASE}/trips.php`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export async function updateTrip(id: string, payload: Record<string, unknown>) {
  const res = await apiFetch(`${API_BASE}/trips.php/${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export async function deleteTrip(id: string) {
  const res = await apiFetch(`${API_BASE}/trips.php/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export type AuthResponse = {
  success: boolean;
  message?: string;
  token?: string;
  user?: Record<string, unknown>;
  error?: string;
};

export type RegisterResponse = AuthResponse;

const TOKEN_KEY = 'auth_token';

function saveToken(token?: string | null) {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY);
  } else {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

// Central fetch wrapper that handles 401 (expired/invalid JWT) globally.
async function apiFetch(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, init);
  if (res.status === 401) {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('auth_user');
    } catch {
      // ignore
    }

    try {
      window.location.replace('/login');
    } catch {
      // ignore
    }
    throw new Error('Unauthorized');
  }
  return res;
}

export async function login(payload: { email: string; password: string }) {
  const res = await apiFetch(`${API_BASE}/auth.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }

  const data = json as AuthResponse;
  if (data.token) saveToken(data.token);
  return data;
}

export async function logout() {
  const res = await apiFetch(`${API_BASE}/auth.php`, { method: 'DELETE', headers: authHeaders() });
  saveToken(null);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return await res.json();
}

export async function registerUser(payload: { full_name: string; email: string; password: string; role?: string }) {
  // Register endpoint is separate from admin user creation
  const body = JSON.stringify({ full_name: payload.full_name, email: payload.email, password: payload.password });
  const res = await fetch(`${API_BASE}/register.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }

  const data = json as AuthResponse;
  if (data.token) saveToken(data.token);
  return data;
}

// Create a user as an admin (requires auth). This posts to users.php and does not
// automatically save/return an auth token (unlike registerUser).
export async function createUser(payload: { full_name: string; email: string; password: string; role?: string; company_id?: string }) {
  const body = JSON.stringify(payload);
  const res = await apiFetch(`${API_BASE}/users.php`, {
    method: 'POST',
    headers: authHeaders(),
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }

  return json as UsersResponse | Record<string, unknown>;
}

export type UsersResponse = {
  success: boolean;
  data?: Array<Record<string, unknown>>;
  user?: Record<string, unknown>;
};

export async function fetchUsers() {
  const res = await apiFetch(`${API_BASE}/users.php`, { headers: authHeaders() });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return await res.json() as UsersResponse;
}

export type CompaniesResponse = {
  success: boolean;
  data?: Array<Record<string, unknown>>;
  count?: number;
};

export async function fetchCompanies() {
  const res = await apiFetch(`${API_BASE}/companies.php`, { headers: authHeaders() });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return await res.json() as CompaniesResponse;
}

export async function fetchCompany(id: string) {
  const res = await apiFetch(`${API_BASE}/companies.php/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return await res.json() as { success: boolean; data?: Record<string, unknown> };
}

export async function createCompany(payload: { name: string; logo_path?: string | null }) {
  const res = await apiFetch(`${API_BASE}/companies.php`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export async function updateCompany(id: string, payload: Record<string, unknown>) {
  const res = await apiFetch(`${API_BASE}/companies.php/${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export async function fetchTrip(id: string) {
  const res = await apiFetch(`${API_BASE}/trips.php/${encodeURIComponent(id)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean; data?: Trip };
}

export async function deleteCompany(id: string) {
  const res = await apiFetch(`${API_BASE}/companies.php/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export async function assignManager(companyId: string, userId: string) {
  const res = await apiFetch(`${API_BASE}/companies.php/${encodeURIComponent(companyId)}/assign_manager`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ user_id: userId }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export async function removeManager(companyId: string, userId: string) {
  const res = await apiFetch(`${API_BASE}/companies.php/${encodeURIComponent(companyId)}/remove_manager`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ user_id: userId }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export async function fetchUser(id: string) {
  const res = await apiFetch(`${API_BASE}/users.php?id=${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return await res.json() as UsersResponse;
}

export async function updateUser(id: string, payload: Record<string, unknown>) {
  const res = await apiFetch(`${API_BASE}/users.php?id=${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export async function deleteUser(id: string) {
  const res = await apiFetch(`${API_BASE}/users.php?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export async function fetchProfile() {
  const res = await apiFetch(`${API_BASE}/auth.php`, { method: 'GET', headers: authHeaders() });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return await res.json();
}

export async function fetchMyTickets() {
  const res = await apiFetch(`${API_BASE}/tickets.php`, { method: 'GET', headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean; data?: Array<{ ticket_id: string; trip_id?: string; total_price?: number; status?: string; created_at?: string; seats?: number[]; departure_time?: string; arrival_time?: string; departure_city?: string; destination_city?: string; company_name?: string; company_logo?: string | null }> };
}

export async function updateProfile(payload: Record<string, unknown>) {
  const res = await apiFetch(`${API_BASE}/auth.php`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

export type CheckCouponResponse = { success: boolean; coupon?: { id: string; code: string; discount: number; company_id?: string | null; usage_limit?: number; expire_date?: string } };
export async function checkCoupon(code: string, trip_id?: string): Promise<CheckCouponResponse> {
  const body: Record<string, unknown> = { code };
  if (trip_id) body.trip_id = trip_id;
  const res = await apiFetch(`${API_BASE}/check_coupon.php`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as CheckCouponResponse;
}

export type Coupon = {
  id: string;
  code: string;
  discount: number;
  company_id?: string | null;
  usage_limit?: number;
  used_count?: number;
  expire_date?: string;
  created_at?: string;
};

export async function fetchMyCoupons() {
  const res = await apiFetch(`${API_BASE}/coupons.php`, { method: 'GET', headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean; coupons?: Coupon[] };
}

export async function createCoupon(payload: { code: string; discount: number; usage_limit: number; expire_date: string }) {
  const res = await apiFetch(`${API_BASE}/coupons.php`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean; coupon?: Coupon };
}

export async function updateCoupon(id: string, payload: Partial<{ code: string; discount: number; usage_limit: number; expire_date: string }>) {
  const res = await apiFetch(`${API_BASE}/coupons.php?id=${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean };
}

export async function deleteCoupon(id: string) {
  const res = await apiFetch(`${API_BASE}/coupons.php?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean };
}

// Admin-specific coupon endpoints (global coupons owned by admin)
export async function fetchAdminCoupons() {
  const res = await apiFetch(`${API_BASE}/admin_coupons.php`, { method: 'GET', headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean; coupons?: Coupon[] };
}

export async function createAdminCoupon(payload: { code: string; discount: number; usage_limit: number; expire_date: string }) {
  const res = await apiFetch(`${API_BASE}/admin_coupons.php`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean; coupon?: Coupon };
}

export async function updateAdminCoupon(id: string, payload: Partial<{ code: string; discount: number; usage_limit: number; expire_date: string }>) {
  const res = await apiFetch(`${API_BASE}/admin_coupons.php?id=${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean };
}

export async function deleteAdminCoupon(id: string) {
  const res = await apiFetch(`${API_BASE}/admin_coupons.php?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean };
}

export type PurchaseResponse = { success: boolean; message?: string; ticket?: { ticket_id: string; user_id: string; total_price: number; seats: Array<{ seat_number: number }>; status: string } };
export async function purchaseTicket(payload: { trip_id: string; seats: number[]; coupon_code?: string }): Promise<PurchaseResponse> {
  const res = await apiFetch(`${API_BASE}/purchase.php`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as PurchaseResponse;
}

export async function cancelTicket(ticketId: string) {
  const res = await apiFetch(`${API_BASE}/tickets.php/${encodeURIComponent(ticketId)}`, { method: 'DELETE', headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json as { success: boolean; message?: string };
}

export async function downloadTicketPdf(ticketId: string) {
  const token = getToken();
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/tickets.php/${encodeURIComponent(ticketId)}/pdf`, { method: 'GET', headers });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const err = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  const blob = await res.blob();
  // create download
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ticket-${ticketId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
