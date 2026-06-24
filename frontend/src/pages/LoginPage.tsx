import { useState } from 'react';
import { supabase } from '../lib/supabase';
import api from '../services/api';
import { storePendingInviteCode } from '../services/auth.service';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        try {
          await api.post('/auth/validate-invite', { code: inviteCode });
        } catch {
          setError('Invalid invite code. Please ask for access.');
          return;
        }

        storePendingInviteCode(inviteCode);
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccessMessage('Account created! Check your email to confirm, then log in.');
        setMode('login');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const fieldLabel: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-muted)',
    marginBottom: 5,
    display: 'block',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: '24px 16px',
      }}
    >
      <div
        className="card page"
        style={{
          padding: '36px 32px',
          width: '100%',
          maxWidth: 380,
        }}
      >
        {/* Brand */}
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: 'var(--primary)',
              letterSpacing: '-0.01em',
              marginBottom: 4,
            }}
          >
            🛒 ShoppingList
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
          </p>
        </div>

        {error && (
          <div
            style={{
              background: 'var(--alert-error-bg)',
              color: 'var(--alert-error-text)',
              padding: '10px 14px',
              borderRadius: 'var(--radius)',
              fontSize: 14,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <span style={{ flexShrink: 0 }}>⚠️</span>
            {error}
          </div>
        )}
        {successMessage && (
          <div
            style={{
              background: 'var(--alert-success-bg)',
              color: 'var(--alert-success-text)',
              padding: '10px 14px',
              borderRadius: 'var(--radius)',
              fontSize: 14,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <span style={{ flexShrink: 0 }}>✅</span>
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={fieldLabel}>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={fieldLabel}>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {mode === 'signup' && (
            <div>
              <label style={fieldLabel}>Invite code</label>
              <input
                type="text"
                placeholder="Enter your invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{
              padding: '11px 0',
              fontWeight: 600,
              fontSize: 15,
              borderRadius: 'var(--radius)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              marginTop: 4,
            }}
          >
            {loading ? (
              <>
                <span
                  className="spinner"
                  style={{
                    width: 16,
                    height: 16,
                    borderColor: 'rgba(255,255,255,0.3)',
                    borderTopColor: 'white',
                  }}
                />
                {mode === 'login' ? 'Signing in…' : 'Creating account…'}
              </>
            ) : (
              mode === 'login' ? 'Sign In' : 'Sign Up'
            )}
          </button>
        </form>

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 14, color: 'var(--text-muted)' }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError('');
              setSuccessMessage('');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 14,
              padding: 0,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {mode === 'login' ? 'Sign Up' : 'Sign In'}
          </button>
        </p>
      </div>
    </div>
  );
}
