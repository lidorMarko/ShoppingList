import ProductImage from '../components/ProductImage';
import api from '../services/api';
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsService } from '../services/sessions.service';
import { productsService } from '../services/products.service';
import { SessionItem, Product } from '../types';

function groupByCategory(items: SessionItem[]): Record<string, SessionItem[]> {
  return items.reduce<Record<string, SessionItem[]>>((acc, item) => {
    const key = item.product?.category?.name ?? 'ללא קטגוריה';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return '';
  return `₪${Number(price).toFixed(2)}`;
}

export default function ShoppingModePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [showAddItem, setShowAddItem] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedProductName, setSelectedProductName] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');

  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState('');
  const [receiptType, setReceiptType] = useState('');

  const [receiptError, setReceiptError] = useState('');
  const [showReceiptFull, setShowReceiptFull] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const { data: session, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsService.getOne(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });

  const { data: allProducts = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsService.getAll(),
    enabled: showAddItem,
  });

  const products = productSearch
    ? (allProducts as Product[]).filter((p) =>
        p.name.toLowerCase().includes(productSearch.toLowerCase())
      )
    : (allProducts as Product[]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['session', sessionId] });

  const toggleMutation = useMutation({
    mutationFn: (itemId: string) => sessionsService.toggleItem(sessionId!, itemId),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => sessionsService.removeItem(sessionId!, itemId),
    onSuccess: invalidate,
  });

  const addItemMutation = useMutation({
    mutationFn: (data: { productId: string; quantity?: number; unit?: string }) =>
      sessionsService.addItem(sessionId!, data),
    onSuccess: () => {
      invalidate();
      setSelectedProductId('');
      setSelectedProductName('');
      setProductSearch('');
      setQuantity('');
      setUnit('');
      setShowAddItem(false);
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => sessionsService.complete(sessionId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      navigate('/sessions');
    },
  });

  const analyzeReceiptMutation = useMutation({
    mutationFn: () => sessionsService.analyzeReceipt(sessionId!),
    onSuccess: invalidate,
  });

  const handleReceiptChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptUploading(true);
    setReceiptError('');
    try {
      await sessionsService.uploadReceipt(sessionId!, file);
      invalidate();
    } catch {
      setReceiptError('Upload failed. Please try again.');
    } finally {
      setReceiptUploading(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    let disposed = false, objectUrl = '';
    setReceiptPreview('');
    if (session?.receiptUrl) {
      api.get(`/sessions/${session.id}/receipt/file`, { responseType: 'blob' }).then(({ data }) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(data);
        setReceiptType(data.type); setReceiptPreview(objectUrl);
      }).catch(() => { if (!disposed) setReceiptError('Receipt could not be loaded securely.'); });
    }
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [session?.id, dataUpdatedAt]);

  if (isLoading || !session) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        Loading session...
      </div>
    );
  }

  const isCompleted = session.status === 'completed';
  const items = session.items ?? [];
  const total = items.length;
  const purchased = items.filter((i) => i.isPurchased).length;
  const pct = total > 0 ? Math.round((purchased / total) * 100) : 0;
  const grouped = groupByCategory(items);
  const analysis = session.receiptAnalysis;
  const isPdfReceipt = receiptType === 'application/pdf';

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) return;
    addItemMutation.mutate({
      productId: selectedProductId,
      quantity: quantity ? parseFloat(quantity) : undefined,
      unit: unit || undefined,
    });
  };

  return (
    <div className="page" style={{ maxWidth: 640, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '16px 20px',
          marginBottom: 20,
          boxShadow: 'var(--shadow)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>
              {isCompleted ? 'Completed session' : 'Shopping from'}
            </div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>
              {session.shoppingList?.name ?? 'Shopping Session'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              className="btn-ghost"
              style={{ fontSize: 13 }}
              onClick={() => receiptInputRef.current?.click()}
              disabled={receiptUploading}
              title="Upload receipt photo"
            >
              {receiptUploading ? 'Uploading...' : session.receiptUrl ? '🧾 Receipt' : '📎 Add Receipt'}
            </button>
            <input
              ref={receiptInputRef}
              type="file"
              accept="image/*,application/pdf"
              style={{ display: 'none' }}
              onChange={handleReceiptChange}
            />
            {!isCompleted && (
              <button
                className="btn-primary"
                onClick={() => {
                  if (confirm('Complete this shopping session?')) completeMutation.mutate();
                }}
                disabled={completeMutation.isPending}
              >
                ✓ Complete
              </button>
            )}
          </div>
        </div>

        {/* Progress */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', marginBottom: 5 }}>
            <span>{purchased} of {total} purchased</span>
            <span style={{ fontWeight: 600, color: pct === 100 ? 'var(--success)' : 'var(--text)' }}>
              {pct}%
            </span>
          </div>
          <div style={{ height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: pct === 100 ? 'var(--progress-success-gradient)' : 'var(--progress-gradient)',
                borderRadius: 99,
                transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </div>
        </div>
      </div>

      {/* Upload error */}
      {receiptError && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: 'var(--alert-error-bg)', border: '1px solid var(--alert-error-border)', fontSize: 13, color: 'var(--alert-error-text)' }}>
          {receiptError}
        </div>
      )}

      {/* Receipt preview */}
      {session.receiptUrl && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>🧾 Receipt</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-ghost"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => {
                  if (isPdfReceipt) receiptPreview && window.open(receiptPreview, '_blank', 'noopener,noreferrer');
                  else setShowReceiptFull(true);
                }}
              >
                View full
              </button>
              <button
                className="btn-ghost"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => receiptInputRef.current?.click()}
                disabled={receiptUploading}
              >
                Replace
              </button>
              <button
                className="btn-ghost"
                style={{
                  fontSize: 12, padding: '4px 10px',
                  background: analyzeReceiptMutation.isPending ? 'var(--border)' : undefined,
                }}
                onClick={() => analyzeReceiptMutation.mutate()}
                disabled={analyzeReceiptMutation.isPending}
                title="Analyze receipt with AI to match products and extract prices"
              >
                {analyzeReceiptMutation.isPending ? 'Analyzing...' : '✨ Analyze'}
              </button>
            </div>
          </div>

          {isPdfReceipt ? (
            <div
              onClick={() => receiptPreview && window.open(receiptPreview, '_blank', 'noopener,noreferrer')}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px', borderRadius: 6, cursor: 'pointer',
                background: 'var(--bg)', border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 32 }}>📄</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>PDF Receipt uploaded</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Click to open · then press ✨ Analyze to extract prices
                </div>
              </div>
            </div>
          ) : (
            <img
              src={receiptPreview || undefined}
              alt="Receipt"
              onClick={() => setShowReceiptFull(true)}
              style={{
                width: '100%', maxHeight: 200, objectFit: 'cover',
                borderRadius: 6, cursor: 'pointer',
              }}
            />
          )}

          {analyzeReceiptMutation.isError && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>
              Analysis failed. Please try again.
            </div>
          )}
        </div>
      )}

      {/* Receipt analysis results */}
      {analysis && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>✨ Receipt Analysis</span>
            {analysis.receiptTotal != null && (
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--primary)' }}>
                Total: {formatPrice(analysis.receiptTotal)}
              </span>
            )}
          </div>
          {analysis.storeName && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              🏪 {analysis.storeName}
            </div>
          )}

          {/* Matched items from the session */}
          {analysis.matchedItems.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 6 }}>
                Your list
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {analysis.matchedItems.map((m) => (
                  <div
                    key={m.sessionItemId}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 10px', borderRadius: 6,
                      background: m.found ? 'var(--purchased-bg)' : 'var(--bg)',
                      border: `1px solid ${m.found ? 'var(--purchased-border)' : 'var(--border)'}`,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: m.found ? 'var(--success)' : 'var(--text-muted)', fontSize: 12 }}>
                        {m.found ? '✓' : '–'}
                      </span>
                      <span style={{ color: m.found ? 'var(--text)' : 'var(--text-muted)' }}>
                        {m.productName}
                      </span>
                    </span>
                    {m.price != null && (
                      <span style={{ fontWeight: 600, color: 'var(--success)' }}>
                        {formatPrice(m.price)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Items on receipt not in the list */}
          {analysis.unmatchedReceiptItems.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 6 }}>
                Also on receipt
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {analysis.unmatchedReceiptItems.map((u, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 10px', borderRadius: 6,
                      background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 13,
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>{u.name}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{formatPrice(u.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
            Analyzed {new Date(analysis.analyzedAt).toLocaleString()}
          </div>
        </div>
      )}

      {/* Full-screen receipt lightbox (images only) */}
      {showReceiptFull && session.receiptUrl && !isPdfReceipt && (
        <div
          onClick={() => setShowReceiptFull(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200, cursor: 'zoom-out', padding: 16,
          }}
        >
          <img
            src={receiptPreview || undefined}
            alt="Receipt full"
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
          />
        </div>
      )}

      {/* Add item (active only) */}
      {!isCompleted && (
        <div style={{ marginBottom: 16 }}>
          {showAddItem ? (
            <form
              onSubmit={handleAddItem}
              className="card"
              style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {/* Product autocomplete */}
              <div style={{ position: 'relative' }}>
                <input
                  placeholder="Search product..."
                  value={selectedProductId ? selectedProductName : productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    setSelectedProductId('');
                    setSelectedProductName('');
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  autoFocus
                  style={{ borderColor: selectedProductId ? 'var(--success)' : undefined }}
                />
                {showDropdown && !selectedProductId && products.length > 0 && (
                  <div
                    style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)',
                      maxHeight: 220, overflowY: 'auto', marginTop: 2,
                    }}
                  >
                    {products.map((p) => (
                      <div
                        key={p.id}
                        onMouseDown={() => {
                          setSelectedProductId(p.id);
                          setSelectedProductName(p.name);
                          setProductSearch('');
                          setShowDropdown(false);
                        }}
                        style={{
                          padding: '8px 12px', cursor: 'pointer', display: 'flex',
                          justifyContent: 'space-between', alignItems: 'center', fontSize: 14,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span>{p.name}</span>
                        {p.category && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.category.name}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Qty" type="number" min="0" step="any" value={quantity}
                  onChange={(e) => setQuantity(e.target.value)} style={{ width: 80 }} />
                <input placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary" type="submit" disabled={addItemMutation.isPending || !selectedProductId}>Add</button>
                <button className="btn-ghost" type="button" onClick={() => {
                  setShowAddItem(false);
                  setProductSearch('');
                  setSelectedProductId('');
                  setSelectedProductName('');
                }}>Cancel</button>
              </div>
            </form>
          ) : (
            <button
              className="btn-ghost"
              style={{ width: '100%', padding: '10px', borderStyle: 'dashed' }}
              onClick={() => setShowAddItem(true)}
            >
              + Add item
            </button>
          )}
        </div>
      )}

      {/* Items grouped by category */}
      {total === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">🛒</div>
          <div className="empty-title">No items in this session</div>
          <div className="empty-desc">Add items using the button above</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.entries(grouped).map(([categoryName, catItems]) => {
            const catPurchased = catItems.filter((i) => i.isPurchased).length;
            return (
              <div key={categoryName}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: 'var(--text-muted)',
                  marginBottom: 6, paddingLeft: 4,
                }}>
                  <span>{categoryName}</span>
                  <span>{catPurchased}/{catItems.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {catItems.map((item) => (
                    <ShoppingItemRow
                      key={item.id}
                      item={item}
                      isCompleted={isCompleted}
                      onToggle={() => toggleMutation.mutate(item.id)}
                      onRemove={() => removeMutation.mutate(item.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Back link */}
      <div style={{ marginTop: 32, textAlign: 'center' }}>
        <button className="btn-ghost" onClick={() => navigate('/sessions')} style={{ fontSize: 13 }}>
          ← Back to sessions
        </button>
      </div>
    </div>
  );
}

function ShoppingItemRow({
  item,
  isCompleted,
  onToggle,
  onRemove,
}: {
  item: SessionItem;
  isCompleted: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: item.isPurchased ? 'var(--purchased-bg)' : 'var(--surface)',
        borderColor: item.isPurchased ? 'var(--purchased-border)' : 'var(--border)',
        transition: 'background 0.2s, border-color 0.2s',
      }}
    >
      {/* Checkbox */}
      {!isCompleted ? (
        <button
          onClick={onToggle}
          style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            border: `2px solid ${item.isPurchased ? 'var(--success)' : 'var(--border)'}`,
            background: item.isPurchased ? 'var(--success)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.15s', padding: 0,
            color: 'white', fontSize: 14, fontWeight: 700,
          }}
        >
          {item.isPurchased ? '✓' : ''}
        </button>
      ) : (
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          border: `2px solid ${item.isPurchased ? 'var(--success)' : 'var(--border)'}`,
          background: item.isPurchased ? 'var(--success)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontSize: 14, fontWeight: 700,
        }}>
          {item.isPurchased ? '✓' : ''}
        </div>
      )}

      {/* Product image */}
      {item.product?.imageUrl && (
        <ProductImage
          productId={item.product.id}
          src={item.product.imageUrl}
          alt={item.product.name}
          style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
        />
      )}

      {/* Name + details */}
      <div style={{ flex: 1 }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 15,
            textDecoration: item.isPurchased ? 'line-through' : 'none',
            color: item.isPurchased ? 'var(--text-muted)' : 'var(--text)',
            transition: 'all 0.2s',
          }}
        >
          {item.product?.name ?? 'Product no longer available'}
        </span>
        {(item.quantity || item.unit || item.notes || item.price) && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 8 }}>
            <span>
              {item.quantity ? `${item.quantity}` : ''}
              {item.unit ? ` ${item.unit}` : ''}
              {item.notes ? ` — ${item.notes}` : ''}
            </span>
            {item.price != null && (
              <span style={{ fontWeight: 600, color: 'var(--success)' }}>
                ₪{Number(item.price).toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Remove (active only) */}
      {!isCompleted && (
        <button
          onClick={onRemove}
          title="Remove from session"
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontSize: 15, padding: '4px 6px', cursor: 'pointer',
            borderRadius: 4, flexShrink: 0,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
