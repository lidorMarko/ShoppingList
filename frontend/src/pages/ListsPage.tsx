import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listsService } from '../services/lists.service';
import { sessionsService } from '../services/sessions.service';
import { ShoppingList } from '../types';

export default function ListsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [startingSessionFor, setStartingSessionFor] = useState<string | null>(null);

  const { data: lists = [], isLoading } = useQuery({
    queryKey: ['lists'],
    queryFn: listsService.getAll,
  });

  const createMutation = useMutation({
    mutationFn: listsService.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lists'] });
      setNewName('');
      setCreating(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: listsService.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
  });

  const startSessionMutation = useMutation({
    mutationFn: sessionsService.create,
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      navigate(`/sessions/${session.id}`);
    },
    onSettled: () => setStartingSessionFor(null),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim()) createMutation.mutate({ name: newName.trim() });
  };

  if (isLoading) return (
    <div className="loading-state">
      <div className="spinner" />
      Loading lists...
    </div>
  );

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Shopping Lists</h1>
        <button className="btn-primary" onClick={() => setCreating(!creating)}>
          + New List
        </button>
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="card"
          style={{ padding: 16, marginBottom: 16, display: 'flex', gap: 8 }}
        >
          <input
            autoFocus
            placeholder="List name, e.g. Weekend Shopping"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={createMutation.isPending}>
            Create
          </button>
          <button className="btn-ghost" type="button" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}

      {lists.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">📝</div>
          <div className="empty-title">No shopping lists yet</div>
          <div className="empty-desc">Create your first list to start tracking groceries</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lists.map((list: ShoppingList) => {
            const total = list.items?.length ?? 0;
            const isStarting = startingSessionFor === list.id;
            return (
              <div
                key={list.id}
                className="card"
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <Link
                    to={`/lists/${list.id}`}
                    style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)' }}
                  >
                    {list.name}
                  </Link>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    {total === 0 ? 'Empty list' : `${total} items`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-primary"
                    style={{ padding: '6px 14px', fontSize: 13 }}
                    disabled={isStarting || total === 0}
                    title={total === 0 ? 'Add items to the list first' : 'Start a shopping session'}
                    onClick={() => {
                      setStartingSessionFor(list.id);
                      startSessionMutation.mutate(list.id);
                    }}
                  >
                    {isStarting ? '...' : '🛒 Shop'}
                  </button>
                  <Link
                    to={`/lists/${list.id}`}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 'var(--radius)',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--text)',
                    }}
                  >
                    Edit
                  </Link>
                  <button
                    className="btn-danger"
                    style={{ padding: '6px 12px', fontSize: 13 }}
                    onClick={() => {
                      if (confirm(`Delete "${list.name}"?`)) deleteMutation.mutate(list.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
