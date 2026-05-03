import { AdminState, AdminUser, AuthSession, FeaturePermission } from "../types";

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const message = await response.text();
    const errorMessage = (() => {
      try {
        const parsed = JSON.parse(message) as { error?: string };
        return parsed.error || message;
      } catch {
        return message;
      }
    })();
    throw new Error(errorMessage || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const fetchSession = async (): Promise<AuthSession> => {
  return postJson<AuthSession>('/api/auth/session', {});
};

export const registerUser = async (name: string, email: string, password: string): Promise<{ user: AdminUser; message: string }> => {
  return postJson<{ user: AdminUser; message: string }>('/api/auth/register', { name, email, password });
};

export const loginUser = async (email: string, password: string): Promise<AuthSession> => {
  return postJson<AuthSession>('/api/auth/login', { email, password });
};

export const logoutUser = async (): Promise<{ ok: boolean }> => {
  return postJson<{ ok: boolean }>('/api/auth/logout', {});
};

export const fetchAdminState = async (): Promise<AdminState> => {
  return postJson<AdminState>('/api/admin/state', {});
};

export const setUserStatus = async (userId: string, status: AdminUser['status'], reason = ''): Promise<AdminState> => {
  return postJson<AdminState>('/api/admin/users/status', { userId, status, reason });
};

export const setUserPermission = async (userId: string, permission: FeaturePermission, enabled: boolean): Promise<AdminState> => {
  return postJson<AdminState>('/api/admin/users/permissions', { userId, permission, enabled });
};
