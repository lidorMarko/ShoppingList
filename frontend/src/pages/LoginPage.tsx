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
        // Validate invite code before creating the Supabase account
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

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 40,
          width: '100%',
          maxWidth: 380,
          boxShadow: 'var(--shadow)',
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
          ShoppingList
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 28, fontSize: 14 }}>
          {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
        </p>

        {error && (
          <div
            style={{
              background: '#fee2e2',
              color: '#b91c1c',
              padding: '10px 14px',
              borderRadius: 6,
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}
        {successMessage && (
          <div
            style={{
              background: '#dcfce7',
              color: '#15803d',
              padding: '10px 14px',
              borderRadius: 6,
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 14,
              outline: 'none',
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 14,
              outline: 'none',
            }}
          />
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="Invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
              style={{
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 14,
                outline: 'none',
              }}
            />
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              background: 'var(--primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 0',
              fontWeight: 600,
              fontSize: 15,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? '...' : mode === 'login' ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 14, color: 'var(--text-muted)' }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setSuccessMessage(''); }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 14,
              padding: 0,
            }}
          >
            {mode === 'login' ? 'Sign Up' : 'Sign In'}
          </button>
        </p>
      </div>
    </div>
  );
}
