import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface Credential { id: string; scopes: string[]; expiresAt: string; revokedAt: string | null }
export default function EdenConnectionPage() {
  const { user } = useAuth();
  const query = useQueryClient();
  const [token, setToken] = useState<{ ownerId: string; value: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [allowWrites, setAllowWrites] = useState(false);
  useEffect(() => { setToken(null); setAllowWrites(false); }, [user?.id]);
  const { data: credentials = [], isError } = useQuery({ queryKey: ['eden-credentials', user?.id], queryFn: () => api.get<Credential[]>('/integrations/eden/credentials').then(r => r.data), retry: false });
  async function authorize(rotateCredentialId?: string) {
    setBusy(true); setError(''); setToken(null);
    try {
      const { data } = await api.post('/integrations/eden/credentials', { application: 'eden', consent: true, scopes: allowWrites ? ['shopping:read', 'shopping:write'] : ['shopping:read'], expiresInDays: 30, ...(rotateCredentialId ? { rotateCredentialId } : {}) });
      setToken({ ownerId: user?.id ?? '', value: data.token }); await query.invalidateQueries({ queryKey: ['eden-credentials'] });
    } catch { setError('Connection could not be authorized.'); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setToken(null); setError('');
    try { await api.delete(`/integrations/eden/credentials/${id}`); await query.invalidateQueries({ queryKey: ['eden-credentials'] }); }
    catch { setError('Connection could not be revoked.'); }
    finally { setBusy(false); }
  }
  return <div><h1>Connect Eden</h1>
    <p>Account: {user?.email}. Authorize Eden to read your existing shopping lists and visible products, including lists shared by your current household. It cannot manage your account. Optional write access permits creating, editing and deleting lists and items, and setting purchase state, within your current permissions. Telegram actions remain unconnected.</p>
    <p>Authorization expires in 30 days. You can revoke it here at any time.</p>
    <label><input type="checkbox" checked={allowWrites} disabled={busy} onChange={event => setAllowWrites(event.target.checked)} /> Also authorize shopping list and item changes</label>
    {isError ? <p>Connections are unavailable. No authorization has been granted.</p> : <button disabled={busy} onClick={() => authorize()}>{allowWrites ? 'Authorize Eden read and write access' : 'Authorize Eden read access'}</button>}
    {error && <p role="alert">{error}</p>}
    {token && token.ownerId === user?.id && <section><p>Shown once. Transfer this credential only to Eden’s secure host setup. Do not send it in chat. Eden tools are not connected in this phase.</p><textarea aria-label="One-time Eden credential" readOnly value={token.value} autoComplete="off" spellCheck={false} /><button onClick={() => setToken(null)}>Hide credential</button></section>}
    <ul>{credentials.map(c => <li key={c.id}>{c.scopes.includes('shopping:write') ? 'Read and write access' : 'Read access'} · expires {new Date(c.expiresAt).toLocaleDateString()} · {c.revokedAt ? 'Revoked' : new Date(c.expiresAt) <= new Date() ? 'Expired' : 'Active'} {!c.revokedAt && <><button disabled={busy} onClick={() => revoke(c.id)}>Revoke</button><button disabled={busy} onClick={() => authorize(c.id)}>Replace and revoke old credential</button></>}</li>)}</ul>
  </div>;
}
