import { useState } from 'react';
import { Outlet, NavLink, useNavigate, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { fetchProfile } from '../services/auth.service';
import { useTheme } from '../hooks/useTheme';
import type { Profile } from '../types/index';

const NAV_ITEMS = [
  { to: '/integrations/eden', label: 'Eden', icon: '🔗' },
  { to: '/lists',      label: 'Lists',      icon: '📋' },
  { to: '/sessions',   label: 'Shopping',   icon: '🛒' },
  { to: '/products',   label: 'Products',   icon: '📦' },
  { to: '/categories', label: 'Categories', icon: '🏷️' },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const { isDark, toggleTheme } = useTheme();

  const { data: profile, error: profileError } = useQuery<Profile>({
    queryKey: ['auth-me'],
    queryFn: fetchProfile,
    enabled: !!user,
    retry: false,
  });

  if (axios.isAxiosError(profileError) && profileError.response?.status === 403) {
    return <Navigate to="/invite" replace />;
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  const displayName = profile?.displayName || user?.email?.split('@')[0] || 'Account';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="app-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          <span style={{ fontSize: 18 }}>🛒</span>
          <span className="brand-gradient">ShoppingList</span>
        </span>

        <nav className="top-nav-links">
          {NAV_ITEMS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                padding: '6px 14px',
                borderRadius: 'var(--radius)',
                fontWeight: 500,
                fontSize: 14,
                color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                background: isActive ? 'var(--primary-light)' : 'transparent',
                transition: 'all 0.15s',
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{ marginLeft: 'auto' }}
        >
          {isDark ? '☀️' : '🌙'}
        </button>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--bg)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 99,
              padding: '5px 14px 5px 6px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-strong)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'var(--primary)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {displayName[0].toUpperCase()}
            </span>
            <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
          </button>

          {menuOpen && (
            <>
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 10 }}
              />
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 8px)',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-lg)',
                  minWidth: 180,
                  zIndex: 20,
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '6px 0' }}>
                  <div
                    style={{
                      padding: '8px 16px 10px',
                      borderBottom: '1px solid var(--border)',
                      marginBottom: 4,
                    }}
                  >
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 1 }}>Signed in as</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{displayName}</div>
                  </div>
                  <button
                    onClick={() => { setMenuOpen(false); navigate('/family'); }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      padding: '9px 16px',
                      fontSize: 14,
                      cursor: 'pointer',
                      color: 'var(--text)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                  >
                    <span style={{ fontSize: 15 }}>👨‍👩‍👧</span>
                    Family
                    {profile?.familyId && (
                      <span
                        style={{
                          fontSize: 10,
                          background: 'var(--primary-light)',
                          color: 'var(--primary)',
                          padding: '2px 7px',
                          borderRadius: 99,
                          fontWeight: 600,
                          marginLeft: 'auto',
                        }}
                      >
                        Joined
                      </span>
                    )}
                  </button>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />
                  <button
                    onClick={handleSignOut}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      padding: '9px 16px',
                      fontSize: 14,
                      cursor: 'pointer',
                      color: 'var(--danger)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--alert-error-bg)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                  >
                    <span style={{ fontSize: 15 }}>↩</span>
                    Sign Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            <span className="nav-icon">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
