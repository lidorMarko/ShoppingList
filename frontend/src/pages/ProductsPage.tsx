import ProductImage from '../components/ProductImage';
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsService } from '../services/products.service';
import { categoriesService } from '../services/categories.service';
import { Product, Category } from '../types';

export default function ProductsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [isGlobal, setIsGlobal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: isAdmin = false } = useQuery({
    queryKey: ['is-admin'],
    queryFn: productsService.isAdmin,
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', search],
    queryFn: () => productsService.getAll(search || undefined),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesService.getAll,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['products'] });

  const createMutation = useMutation({
    mutationFn: productsService.create,
    onSuccess: () => { invalidate(); resetForm(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof productsService.update>[1] }) =>
      productsService.update(id, data),
    onSuccess: () => { invalidate(); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: productsService.remove,
    onSuccess: invalidate,
  });

  const resetForm = () => {
    setName(''); setUnit(''); setCategoryId(''); setImageUrl(''); setImagePreview(''); setIsGlobal(false);
    setShowForm(false); setEditingProduct(null);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setUnit(p.unit ?? '');
    setCategoryId(p.categoryId ?? '');
    setImageUrl(p.imageUrl ?? '');
    setImagePreview(p.imageUrl ?? '');
    setShowForm(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImagePreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const url = await productsService.uploadImage(file);
      setImageUrl(url);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: name.trim(),
      unit: unit || undefined,
      categoryId: categoryId || undefined,
      imageUrl: imageUrl || undefined,
      isGlobal: isGlobal || undefined,
    };
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Products</h1>
        <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          + New Product
        </button>
      </div>

      <input
        placeholder="Search products..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16 }}
      />

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="card"
          style={{ padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <div style={{ fontWeight: 600 }}>{editingProduct ? 'Edit Product' : 'New Product'}</div>
          <input
            autoFocus
            placeholder="Product name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            placeholder="Unit (kg, pcs, liters...)"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">No category</option>
            {categories.map((c: Category) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {isAdmin && !editingProduct && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isGlobal}
                onChange={(e) => setIsGlobal(e.target.checked)}
              />
              <span>Global product <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(visible to all families)</span></span>
            </label>
          )}

          {/* Image upload */}
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Product image</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {imagePreview ? (
                <ProductImage
                  productId={editingProduct && imagePreview === editingProduct.imageUrl ? editingProduct.id : undefined}
                  src={imagePreview}
                  alt="preview"
                  style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                />
              ) : (
                <div
                  style={{
                    width: 64, height: 64, borderRadius: 8,
                    border: '2px dashed var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-muted)', fontSize: 22,
                  }}
                >
                  +
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 13 }}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? 'Uploading...' : imagePreview ? 'Change image' : 'Upload image'}
                </button>
                {imagePreview && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 13, color: 'var(--danger)' }}
                    onClick={() => { setImageUrl(''); setImagePreview(''); }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" type="submit" disabled={uploading}>
              {editingProduct ? 'Save' : 'Create'}
            </button>
            <button className="btn-ghost" type="button" onClick={resetForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="loading-state">
          <div className="spinner" />
          Loading products...
        </div>
      ) : products.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">📦</div>
          <div className="empty-title">No products found</div>
          <div className="empty-desc">
            {search ? 'Try a different search term' : 'Add your first product to get started'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {products.map((p: Product) => (
            <div
              key={p.id}
              className="card"
              style={{
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              {p.imageUrl ? (
                <ProductImage
                  productId={p.id}
                  src={p.imageUrl}
                  alt={p.name}
                  style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                />
              ) : (
                <div
                  style={{
                    width: 44, height: 44, borderRadius: 6, flexShrink: 0,
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20,
                  }}
                >
                  🛒
                </div>
              )}
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                {p.unit && (
                  <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>
                    / {p.unit}
                  </span>
                )}
                {p.avgPrice != null && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    avg price: <span style={{ fontWeight: 600, color: 'var(--success)' }}>₪{Number(p.avgPrice).toFixed(2)}</span>
                  </div>
                )}
              </div>
              {p.category && (
                <span
                  className="badge"
                  style={{
                    background: p.category.color ? `${p.category.color}22` : 'var(--bg)',
                    color: p.category.color || 'var(--text-muted)',
                    border: `1px solid ${p.category.color || 'var(--border)'}`,
                  }}
                >
                  {p.category.name}
                </span>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                {(p.userId !== null || isAdmin) && <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => openEdit(p)}>
                  Edit
                </button>}
                <button
                  className="btn-danger"
                  style={{ padding: '5px 10px', fontSize: 13 }}
                  onClick={() => { if (confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p.id); }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
