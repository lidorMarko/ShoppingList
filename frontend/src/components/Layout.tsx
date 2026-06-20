import { useState } from 'react';
import { Outlet, NavLink, useNavigate, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { fetchProfile } from '../services/auth.service';
import type { Profile } from '../types/index';

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

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
      <header
        style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          height: 56,
          boxShadow: 'var(--shadow)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--primary)' }}>
          ShoppingList
        </span>
        <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
          {[
            { to: '/lists', label: 'Lists' },
            { to: '/sessions', label: 'Shopping' },
            { to: '/products', label: 'Products' },
            { to: '/categories', label: 'Categories' },
          ].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                padding: '6px 14px',
                borderRadius: 'var(--radius)',
                fontWeight: 500,
                fontSize: 14,
                color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                background: isActive ? 'rgba(79,70,229,0.08)' : 'transparent',
                transition: 'all 0.15s',
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 99,
              padding: '5px 14px 5px 8px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
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
              }}
            >
              {displayName[0].toUpperCase()}
            </span>
            {displayName}
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
                  borderRadius: 'var(--radius)',
                  boxShadow: 'var(--shadow)',
                  minWidth: 160,
                  zIndex: 20,
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '8px 0' }}>
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
                    }}
                  >
                    Family
                    {profile?.familyId && (
                      <span
                        style={{
                          fontSize: 10,
                          background: 'rgba(79,70,229,0.1)',
                          color: 'var(--primary)',
                          padding: '2px 6px',
                          borderRadius: 99,
                          fontWeight: 600,
                        }}
                      >
                        Joined
                      </span>
                    )}
                  </button>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
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
                      color: '#b91c1c',
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </header>
      <main style={{ flex: 1, padding: '24px', maxWidth: 900, width: '100%', margin: '0 auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
