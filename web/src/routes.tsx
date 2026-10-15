import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from './api';
import { useAuth } from './auth';

export const NAV_BY_ROLE: Record<Role, { path: string; label: string }[]> = {
  COMPLAINANT: [{ path: '/submit', label: 'Submit complaint' }, { path: '/cases', label: 'My cases' }],
  STORE_OFFICER: [{ path: '/submit', label: 'Submit complaint' }, { path: '/cases', label: 'Depot cases' }, { path: '/twin', label: 'Depot twin' }],
  INVESTIGATOR: [{ path: '/assignments', label: 'My assignments' }, { path: '/cases', label: 'All cases' }, { path: '/graph', label: 'Knowledge graph' }, { path: '/twin', label: 'Depot twin' }, { path: '/anomalies', label: 'Anomalies' }],
  SAFETY_OFFICER: [{ path: '/triage', label: 'Triage queue' }, { path: '/review', label: 'Review queue' }, { path: '/cases', label: 'All cases' }, { path: '/twin', label: 'Depot twin' }, { path: '/anomalies', label: 'Anomalies' }, { path: '/graph', label: 'Knowledge graph' }],
  REVIEW_BOARD: [{ path: '/review', label: 'Review queue' }, { path: '/triage', label: 'Triage queue' }, { path: '/cases', label: 'All cases' }, { path: '/graph', label: 'Knowledge graph' }, { path: '/anomalies', label: 'Anomalies' }],
  AUDITOR: [{ path: '/audit', label: 'Audit console' }, { path: '/cases', label: 'All cases' }, { path: '/anomalies', label: 'Anomalies' }, { path: '/graph', label: 'Knowledge graph' }, { path: '/twin', label: 'Depot twin' }],
  ADMIN: [],
  SYSTEM: [],
};

export function homeFor(role: Role): string {
  return NAV_BY_ROLE[role][0]?.path ?? '/cases';
}

export function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
