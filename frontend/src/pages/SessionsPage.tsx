import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsService } from '../services/sessions.service';
import { ShoppingSession } from '../types';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function SessionsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsService.getAll,
  });

  const deleteMutation = useMutation({
    mutationFn: sessionsService.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const active = sessions.filter((s: ShoppingSession) => s.status === 'active');
  const completed = sessions.filter((s: ShoppingSession) => s.status === 'completed');

  if (isLoading) return <div style={{ color: 'var(--text-muted)' }}>Loading...</div>;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Shopping Sessions</h1>

      {/* Active sessions */}
      {active.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10 }}>
            Active
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {active.map((s: ShoppingSession) => (
              <SessionCard
                key={s.id}
                session={s}
                onOpen={() => navigate(`/sessions/${s.id}`)}
                onDelete={() => { if (confirm('Delete this session?')) deleteMutation.mutate(s.id); }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed sessions */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10 }}>
          Completed {completed.length > 0 && `(${completed.length})`}
        </div>
        {completed.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No completed sessions yet. Start shopping from a list!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {completed.map((s: ShoppingSession) => (
              <SessionCard
                key={s.id}
                session={s}
                onOpen={() => navigate(`/sessions/${s.id}`)}
                onDelete={() => { if (confirm('Delete this session?')) deleteMutation.mutate(s.id); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  onOpen,
  onDelete,
}: {
  session: ShoppingSession;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const total = session.items?.length ?? 0;
  const purchased = session.items?.filter((i) => i.isPurchased).length ?? 0;
  const isActive = session.status === 'active';
  const pct = total > 0 ? Math.round((purchased / total) * 100) : 0;
  const receiptTotal = session.receiptAnalysis?.receiptTotal;
  const storeName = session.receiptAnalysis?.storeName;

  return (
    <div
      className="card"
      style={{
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        borderLeft: isActive ? '3px solid var(--primary)' : '3px solid var(--success)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>
          {session.shoppingList?.name ?? 'Unknown list'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{isActive ? 'Started' : 'Completed'}: {formatDate(isActive ? session.startedAt : session.completedAt!)}</span>
          {storeName && (
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>🏪 {storeName}</span>
          )}
          {receiptTotal != null && (
            <span style={{ fontWeight: 600, color: 'var(--success)' }}>₪{Number(receiptTotal).toFixed(2)}</span>
          )}
        </div>
        {total > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 3 }}>
              <span>{purchased}/{total} items</span>
              <span>{pct}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: isActive ? 'var(--primary)' : 'var(--success)',
                  borderRadius: 99,
                  transition: 'width 0.3s',
                }}
              />
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          className={isActive ? 'btn-primary' : 'btn-ghost'}
          style={{ fontSize: 13, padding: '6px 14px' }}
          onClick={onOpen}
        >
          {isActive ? 'Continue' : 'View'}
        </button>
        <button
          className="btn-danger"
          style={{ fontSize: 13, padding: '6px 10px' }}
          onClick={onDelete}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
