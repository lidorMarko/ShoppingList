import { productsService } from '../services/products.service';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { categoriesService } from '../services/categories.service';
import { Category } from '../types';

const PRESET_COLORS = [
  '#e53e3e', '#dd6b20', '#d69e2e', '#38a169',
  '#319795', '#3182ce', '#6b46c1', '#d53f8c',
];

export default function CategoriesPage() {
  const qc = useQueryClient();
  const { data: isAdmin = false } = useQuery({ queryKey: ['is-admin'], queryFn: productsService.isAdmin });
  const [showForm, setShowForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesService.getAll,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] });

  const createMutation = useMutation({
    mutationFn: categoriesService.create,
    onSuccess: () => { invalidate(); resetForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; color?: string } }) =>
      categoriesService.update(id, data),
    onSuccess: () => { invalidate(); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: categoriesService.remove,
    onSuccess: invalidate,
  });

  const resetForm = () => {
    setName(''); setColor(PRESET_COLORS[0]);
    setShowForm(false); setEditingCategory(null);
  };

  const openEdit = (c: Category) => {
    setEditingCategory(c);
    setName(c.name);
    setColor(c.color ?? PRESET_COLORS[0]);
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = { name: name.trim(), color };
    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Categories</h1>
        {isAdmin && <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          + New Category
        </button>}
      </div>

      {!isAdmin && <p>Categories are shared across households. Only the catalog admin can change them.</p>}
      {isAdmin && showForm && (
        <form
          onSubmit={handleSubmit}
          className="card"
          style={{ padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div style={{ fontWeight: 600 }}>{editingCategory ? 'Edit Category' : 'New Category'}</div>
          <input
            autoFocus
            placeholder="Category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>Color</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: c,
                    border: color === c ? '3px solid var(--text)' : '3px solid transparent',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{ width: 28, height: 28, padding: 2, borderRadius: '50%', cursor: 'pointer' }}
                title="Custom color"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" type="submit">
              {editingCategory ? 'Save' : 'Create'}
            </button>
            <button className="btn-ghost" type="button" onClick={resetForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
      ) : categories.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
          No categories yet. Create one to organize your products!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {categories.map((c: Category) => (
            <div
              key={c.id}
              className="card"
              style={{
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: c.color || 'var(--text-muted)',
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, fontWeight: 500 }}>{c.name}</span>
              {isAdmin && <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => openEdit(c)}>
                  Edit
                </button>
                <button
                  className="btn-danger"
                  style={{ padding: '5px 10px', fontSize: 13 }}
                  onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteMutation.mutate(c.id); }}
                >
                  Delete
                </button>
              </div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
