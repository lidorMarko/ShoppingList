import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { fetchProfile } from '../services/auth.service';
import { useAuth } from '../contexts/AuthContext';
import type { Profile, Family } from '../types/index';

export default function FamilyPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: profile, isLoading } = useQuery<Profile>({
    queryKey: ['auth-me'],
    queryFn: fetchProfile,
    enabled: !!user,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['auth-me'] });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post('/families', { name }).then((r) => r.data),
    onSuccess: invalidate,
  });

  const joinMutation = useMutation({
    mutationFn: (code: string) => api.post('/families/join', { inviteCode: code }).then((r) => r.data),
    onSuccess: invalidate,
  });

  const leaveMutation = useMutation({
    mutationFn: () => api.delete('/families/leave').then((r) => r.data),
    onSuccess: invalidate,
  });

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) return <p style={{ color: 'var(--text-muted)' }}>Loading...</p>;

  const family = profile?.family as Family | null;

  return (
    <div style={{ maxWidth: 520 }}>
      <h2 style={{ fontWeight: 700, fontSize: 22, marginBottom: 24 }}>Family</h2>

      {family ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 24,
            }}
          >
            <p style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{family.name}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
              Your role: <strong>{profile?.familyRole}</strong>
            </p>

            <p style={{ fontSize: 13, marginBottom: 8, fontWeight: 500 }}>Invite code</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: 4,
                  color: 'var(--primary)',
                }}
              >
                {family.inviteCode}
              </code>
              <button
                onClick={() => copyCode(family.inviteCode)}
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>
                Members ({(family.members ?? []).length})
              </p>
              {(family.members ?? []).map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 14,
                  }}
                >
                  <span style={{ flex: 1 }}>{m.displayName || m.email}</span>
                  <span
                    style={{
                      fontSize: 11,
                      background: m.familyRole === 'admin' ? 'rgba(79,70,229,0.1)' : 'var(--bg)',
                      color: m.familyRole === 'admin' ? 'var(--primary)' : 'var(--text-muted)',
                      padding: '2px 8px',
                      borderRadius: 99,
                      fontWeight: 600,
                    }}
                  >
                    {m.familyRole}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => leaveMutation.mutate()}
            disabled={leaveMutation.isPending}
            style={{
              background: '#fee2e2',
              color: '#b91c1c',
              border: 'none',
              borderRadius: 6,
              padding: '10px 20px',
              fontWeight: 600,
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            {leaveMutation.isPending ? 'Leaving...' : 'Leave Family'}
          </button>
          {leaveMutation.isError && (
            <p style={{ color: '#b91c1c', fontSize: 13 }}>
              {(leaveMutation.error as Error).message}
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 24,
            }}
          >
            <p style={{ fontWeight: 600, marginBottom: 16 }}>Create a new family</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                placeholder="Family name"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 14,
                }}
              />
              <button
                onClick={() => { if (familyName.trim()) createMutation.mutate(familyName.trim()); }}
                disabled={createMutation.isPending || !familyName.trim()}
                style={{
                  background: 'var(--primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 18px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {createMutation.isPending ? '...' : 'Create'}
              </button>
            </div>
            {createMutation.isError && (
              <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>
                {(createMutation.error as Error).message}
              </p>
            )}
          </div>

          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 24,
            }}
          >
            <p style={{ fontWeight: 600, marginBottom: 16 }}>Join an existing family</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                placeholder="Invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                maxLength={6}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 14,
                  letterSpacing: 3,
                  fontWeight: 700,
                }}
              />
              <button
                onClick={() => { if (inviteCode.trim()) joinMutation.mutate(inviteCode.trim()); }}
                disabled={joinMutation.isPending || inviteCode.length < 6}
                style={{
                  background: 'var(--primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 18px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {joinMutation.isPending ? '...' : 'Join'}
              </button>
            </div>
            {joinMutation.isError && (
              <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>
                {(joinMutation.error as Error).message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
