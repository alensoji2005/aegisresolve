import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import './index.css';
import { AuditConsole } from './pages/AuditConsole';
import { CaseDetail } from './pages/CaseDetail';
import { CaseList } from './pages/CaseList';
import { DigitalTwin } from './pages/DigitalTwin';
import { KnowledgeGraph } from './pages/KnowledgeGraph';
import { Login } from './pages/Login';
import { SubmitComplaint } from './pages/SubmitComplaint';
import { homeFor, NAV_BY_ROLE, RequireRole } from './routes';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function Shell() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold tracking-tight">Aegis<span className="text-accent">Resolve</span></span>
          <nav className="flex flex-wrap gap-1">
            {NAV_BY_ROLE[user.role].map((n) => (
              <NavLink key={n.path} to={n.path}
                className={({ isActive }) => `rounded px-2.5 py-1 text-sm ${isActive ? 'bg-accent-soft text-accent' : 'text-ink/70 hover:bg-paper'}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-ink/60">{user.username} · {user.role.replaceAll('_', ' ').toLowerCase()}</span>
            <button className="btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6"><Outlet /></main>
    </div>
  );
}

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Home />} />
            <Route element={<RequireRole><Shell /></RequireRole>}>
              <Route path="/submit" element={<RequireRole roles={['COMPLAINANT', 'STORE_OFFICER']}><SubmitComplaint /></RequireRole>} />
              <Route path="/cases" element={<CaseList title="Cases" />} />
              <Route path="/assignments" element={<RequireRole roles={['INVESTIGATOR']}><CaseList title="My assignments" query="assigned=me" /></RequireRole>} />
              <Route path="/triage" element={<RequireRole roles={['SAFETY_OFFICER', 'REVIEW_BOARD']}>
                <CaseList title="Triage queue" query="status=SUBMITTED,TRIAGED" sortByRisk /></RequireRole>} />
              <Route path="/review" element={<RequireRole roles={['SAFETY_OFFICER', 'REVIEW_BOARD']}>
                <CaseList title="Review queue" query="status=FINDINGS_SUBMITTED,APPEALED" sortByRisk /></RequireRole>} />
              <Route path="/audit" element={<RequireRole roles={['AUDITOR', 'REVIEW_BOARD']}><AuditConsole /></RequireRole>} />
              <Route path="/graph" element={<RequireRole roles={['INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR']}><KnowledgeGraph /></RequireRole>} />
              <Route path="/twin" element={<RequireRole roles={['INVESTIGATOR', 'SAFETY_OFFICER', 'REVIEW_BOARD', 'AUDITOR', 'STORE_OFFICER']}><DigitalTwin /></RequireRole>} />
              <Route path="/cases/:id" element={<CaseDetail />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
