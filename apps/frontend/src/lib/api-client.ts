import axios, { AxiosInstance } from "axios";
import { useAuthStore } from "../stores/auth.store";

// Relative "/api" by default so the app works on any host (localhost, LAN IP for
// mobile testing, or a deployed domain) via the dev-server / reverse-proxy — and
// avoids CORS entirely since requests are same-origin. Override with VITE_API_URL.
const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

let apiClient: AxiosInstance;

export function initializeApiClient() {
  apiClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
  });

  // Request interceptor - add auth token
  apiClient.interceptors.request.use((config) => {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  });

  // Response interceptor - handle token refresh & errors
  apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;

      // If 401 and not already retried, try to refresh token
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        const { refreshToken } = useAuthStore.getState();

        if (refreshToken) {
          try {
            const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
              refreshToken,
            });

            const { accessToken: newAccessToken, refreshToken: newRefreshToken, user } = response.data;
            useAuthStore.setState({ accessToken: newAccessToken, refreshToken: newRefreshToken, user });

            // Retry original request
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            return apiClient(originalRequest);
          } catch (_err) {
            // Refresh failed, logout
            useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
              window.location.href = "/login";
          }
        }
      }

      return Promise.reject(error);
    },
  );

  return apiClient;
}

export function getApiClient(): AxiosInstance {
  if (!apiClient) {
    initializeApiClient();
  }
  return apiClient;
}

// Unauthenticated client for the public visitor lead form (no bearer token).
const publicClient = axios.create({ baseURL: API_BASE_URL, timeout: 30000 });

export const publicApi = {
  getForm: (shortCode: string) => publicClient.get(`/public/v/${shortCode}`),
  submitLead: (data: unknown) => publicClient.post("/public/leads", data),
  getAnalysis: (id: string) => publicClient.get(`/ai/analysis/${id}`),
  getBoothContext: () => publicClient.get("/public/booth-context"),
  saveBoothLead: (data: unknown) => publicClient.post("/public/booth-lead", data),
  // Play session (visitor "extra link" → game selector)
  getPlaySession: (token: string) => publicClient.get(`/public/play/${token}`),
  // Public BNI directory lookup (phone-first / card-scan enrichment)
  bniLookup: (q: string) => publicClient.get("/public/bni", { params: { q } }),
  // Public business-card scan (OCR + BNI enrich)
  cardScan: (image: string) => publicClient.post("/public/card-scan", { image }),
  // Public AI Score game (queue a comparison; poll via getAnalysis)
  submitScore: (data: unknown) => publicClient.post("/public/score", data),
  tts: (text: string) => publicClient.post("/public/tts", { text }),
  bookMeeting: (data: { playToken: string; date: string; time: string; note?: string }) =>
    publicClient.post("/public/meeting", data),
  // Public Profitability Calculator (compute + email results)
  submitCalculator: (data: unknown) => publicClient.post("/public/calculator", data),
  // Booth TV / stall display feed
  tvFeed: () => publicClient.get("/public/tv-feed"),
  // Match a walk-up to their lead by name/email/mobile → play token
  findSession: (q: string) => publicClient.get("/public/find-session", { params: { q } }),
};

// API Methods
export const api = {
  // Auth
  auth: {
    login: (email: string, password: string) =>
      getApiClient().post("/auth/login", { email, password }),
    register: (email: string, password: string, name: string) =>
      getApiClient().post("/auth/register", { email, password, name }),
    logout: () => getApiClient().post("/auth/logout"),
    me: () => getApiClient().get("/auth/me"),
    updateProfile: (data: { name?: string; currentPassword?: string; newPassword?: string }) =>
      getApiClient().put("/auth/me", data),
  },

  // Events
  events: {
    list: (params?: any) => getApiClient().get("/events", { params }),
    get: (id: string) => getApiClient().get(`/events/${id}`),
    create: (data: any) => getApiClient().post("/events", data),
    update: (id: string, data: any) => getApiClient().put(`/events/${id}`, data),
    delete: (id: string) => getApiClient().delete(`/events/${id}`),
  },

  // Booths
  booths: {
    list: (eventId: string, params?: any) =>
      getApiClient().get(`/events/${eventId}/booths`, { params }),
    get: (eventId: string, boothId: string) =>
      getApiClient().get(`/events/${eventId}/booths/${boothId}`),
    create: (eventId: string, data: any) =>
      getApiClient().post(`/events/${eventId}/booths`, data),
    update: (eventId: string, boothId: string, data: any) =>
      getApiClient().put(`/events/${eventId}/booths/${boothId}`, data),
    delete: (eventId: string, boothId: string) =>
      getApiClient().delete(`/events/${eventId}/booths/${boothId}`),
  },

  // Forms
  forms: {
    list: (eventId: string) => getApiClient().get(`/events/${eventId}/forms`),
    get: (eventId: string, formId: string) =>
      getApiClient().get(`/events/${eventId}/forms/${formId}`),
    create: (eventId: string, data: any) =>
      getApiClient().post(`/events/${eventId}/forms`, data),
    update: (eventId: string, formId: string, data: any) =>
      getApiClient().put(`/events/${eventId}/forms/${formId}`, data),
    delete: (eventId: string, formId: string) =>
      getApiClient().delete(`/events/${eventId}/forms/${formId}`),
  },

  // Form Fields (nested under a form definition)
  formFields: {
    list: (eventId: string, formId: string) =>
      getApiClient().get(`/events/${eventId}/forms/${formId}/fields`),
    create: (eventId: string, formId: string, data: any) =>
      getApiClient().post(`/events/${eventId}/forms/${formId}/fields`, data),
    update: (eventId: string, formId: string, fieldId: string, data: any) =>
      getApiClient().put(`/events/${eventId}/forms/${formId}/fields/${fieldId}`, data),
    remove: (eventId: string, formId: string, fieldId: string) =>
      getApiClient().delete(`/events/${eventId}/forms/${formId}/fields/${fieldId}`),
    activate: (eventId: string, formId: string, fieldId: string) =>
      getApiClient().post(`/events/${eventId}/forms/${formId}/fields/${fieldId}/activate`),
    deactivate: (eventId: string, formId: string, fieldId: string) =>
      getApiClient().post(`/events/${eventId}/forms/${formId}/fields/${fieldId}/deactivate`),
  },

  // AI Experience Hub
  ai: {
    roast: (data: any) => getApiClient().post("/ai/roast", data, { timeout: 120000 }),
    score: (data: any) => getApiClient().post("/ai/score", data, { timeout: 180000 }),
    bniLookup: (q: string) => getApiClient().get("/ai/bni", { params: { q } }),
    get: (id: string) => getApiClient().get(`/ai/analysis/${id}`),
    saveLead: (id: string, data: any) => getApiClient().post(`/ai/analysis/${id}/lead`, data),
    history: (params?: any) => getApiClient().get("/ai/history", { params }),
  },

  // OCR (business card scanning)
  ocr: {
    smartScan: (image: string) => getApiClient().post("/ocr/smart-scan", { image }, { timeout: 60000 }),
    scan: (imageFile: File) => {
      const fd = new FormData();
      fd.append("image", imageFile);
      return getApiClient().post("/ocr/scan", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
    },
    submit: (data: any) => getApiClient().post("/ocr/submit", data),
  },

  // QR Codes
  qr: {
    list: (eventId: string, boothId: string) =>
      getApiClient().get(`/events/${eventId}/booths/${boothId}/qr`),
    generate: (eventId: string, boothId: string, data: any) =>
      getApiClient().post(`/events/${eventId}/booths/${boothId}/qr`, data),
    delete: (eventId: string, boothId: string, qrId: string) =>
      getApiClient().delete(`/events/${eventId}/booths/${boothId}/qr/${qrId}`),
  },

  // CRM Config
  crm: {
    list: (eventId: string) => getApiClient().get(`/events/${eventId}/crm-config`),
    get: (eventId: string, configId: string) =>
      getApiClient().get(`/events/${eventId}/crm-config/${configId}`),
    create: (eventId: string, data: any) =>
      getApiClient().post(`/events/${eventId}/crm-config`, data),
    update: (eventId: string, configId: string, data: any) =>
      getApiClient().put(`/events/${eventId}/crm-config/${configId}`, data),
    delete: (eventId: string, configId: string) =>
      getApiClient().delete(`/events/${eventId}/crm-config/${configId}`),
    test: (eventId: string, configId: string) =>
      getApiClient().post(`/events/${eventId}/crm-config/${configId}/test`),
  },

  // Sync Queue
  syncQueue: {
    status: (params?: any) => getApiClient().get("/sync-queue/status", { params }),
    pending: () => getApiClient().get("/sync-queue/pending"),
    retry: (queueItemId: string) =>
      getApiClient().post(`/sync-queue/${queueItemId}/retry`),
    logs: (params?: any) => getApiClient().get("/sync-queue/logs", { params }),
    process: () => getApiClient().post("/sync-queue/process"),
  },

  // Dashboard
  dashboard: {
    stats: () => getApiClient().get("/dashboard/stats"),
  },

  // Leads
  leads: {
    list: (params?: any) => getApiClient().get("/leads", { params }),
    get: (id: string) => getApiClient().get(`/leads/${id}`),
    export: (filters?: any) =>
      getApiClient().post("/leads/export", filters ?? {}, { responseType: "blob" }),
    remove: (id: string) => getApiClient().delete(`/leads/${id}`),
    sendReport: (id: string) => getApiClient().post(`/leads/${id}/send-report`),
    bookMeeting: (id: string, data: { date: string; time: string; note?: string }) =>
      getApiClient().post(`/leads/${id}/meeting`, data),
    syncSheet: () => getApiClient().post(`/leads/sync-sheet`),
  },

  // Audit Logs
  audit: {
    list: (params?: any) => getApiClient().get("/audit-logs", { params }),
  },

  // Notifications / Automation
  notifications: {
    list: (eventId: string) => getApiClient().get(`/notifications/${eventId}`),
    create: (data: any) => getApiClient().post("/notifications", data),
    update: (id: string, data: any) => getApiClient().put(`/notifications/${id}`, data),
    remove: (id: string) => getApiClient().delete(`/notifications/${id}`),
    whatsappStatus: () => getApiClient().get("/notifications/whatsapp/status"),
    whatsappTest: (data: any) => getApiClient().post("/notifications/whatsapp/test", data),
    emailStatus: () => getApiClient().get("/notifications/email/status"),
    emailTest: (data: any) => getApiClient().post("/notifications/email/test", data),
  },

  // Settings (owner only)
  settings: {
    get: () => getApiClient().get("/settings"),
    save: (updates: Record<string, string>) => getApiClient().put("/settings", { updates }),
    test: (integration: string) => getApiClient().post(`/settings/test/${integration}`),
    dataforseoBalance: () => getApiClient().get("/settings/dataforseo-balance"),
  },

  // Users
  users: {
    list: () => getApiClient().get("/users"),
    get: (id: string) => getApiClient().get(`/users/${id}`),
    create: (data: any) => getApiClient().post("/users", data),
    update: (id: string, data: any) => getApiClient().put(`/users/${id}`, data),
    deactivate: (id: string) => getApiClient().post(`/users/${id}/deactivate`),
    resetPassword: (id: string) => getApiClient().post(`/users/${id}/reset-password`),
    remove: (id: string) => getApiClient().delete(`/users/${id}`),
  },
};
