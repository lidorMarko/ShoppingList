import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { storePendingInviteCode } from '../services/auth.service';

export default function InviteCodePage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/validate-invite', { code });
      storePendingInviteCode(code);
      await qc.invalidateQueries({ queryKey: ['auth-me'] });
    } catch {
      setError('Invalid invite code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 40, width: '100%', maxWidth: 360, boxShadow: 'var(--shadow)' }}>
        <h2 style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Enter Invite Code</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
          An invite code is required to activate your account.
        </p>
        {error && (
          <div style={{ background: 'var(--alert-error-bg)', color: 'var(--alert-error-text)', padding: '10px 14px', borderRadius: 6, fontSize: 14, marginBottom: 16 }}>
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            autoFocus
            placeholder="Invite code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 16, letterSpacing: 3, fontWeight: 700, outline: 'none' }}
          />
          <button
            type="submit"
            disabled={loading || !code}
            style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 0', fontWeight: 600, fontSize: 15, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? '...' : 'Activate'}
          </button>
        </form>
      </div>
    </div>
  );
}
