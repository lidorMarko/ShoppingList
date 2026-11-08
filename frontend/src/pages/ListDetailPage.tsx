import ProductImage from '../components/ProductImage';
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listsService, listItemsService } from '../services/lists.service';
import { productsService } from '../services/products.service';
import { ListItem, Product, ShoppingList } from '../types';

export default function ListDetailPage() {
  const { listId } = useParams<{ listId: string }>();
  const qc = useQueryClient();

  const [showAddItem, setShowAddItem] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [notes, setNotes] = useState('');
  const [productSearch, setProductSearch] = useState('');

  const [showCopyModal, setShowCopyModal] = useState(false);
  const [targetListId, setTargetListId] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameName, setRenameName] = useState('');

  const { data: list, isLoading } = useQuery({
    queryKey: ['list', listId],
    queryFn: () => listsService.getOne(listId!),
    enabled: !!listId,
  });

  const { data: allLists = [] } = useQuery({
    queryKey: ['lists'],
    queryFn: listsService.getAll,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products', productSearch],
    queryFn: () => productsService.getAll(productSearch || undefined),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['list', listId] });
    qc.invalidateQueries({ queryKey: ['lists'] });
  };

  const addItemMutation = useMutation({
    mutationFn: (data: { productId: string; quantity?: number; unit?: string; notes?: string }) =>
      listItemsService.create(listId!, data),
    onSuccess: () => {
      invalidate();
      setSelectedProductId('');
      setQuantity('');
      setUnit('');
      setNotes('');
      setShowAddItem(false);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (itemId: string) => listItemsService.toggle(listId!, itemId),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => listItemsService.remove(listId!, itemId),
    onSuccess: invalidate,
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => listsService.update(listId!, { name }),
    onSuccess: () => {
      invalidate();
      setIsRenaming(false);
    },
  });

  const copyMutation = useMutation({
    mutationFn: () => listsService.copyItems(listId!, targetListId),
    onSuccess: () => {
      setShowCopyModal(false);
      setTargetListId('');
    },
  });

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) return;
    addItemMutation.mutate({
      productId: selectedProductId,
      quantity: quantity ? parseFloat(quantity) : undefined,
      unit: unit || undefined,
      notes: notes || undefined,
    });
  };

  if (isLoading || !list) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        Loading list...
      </div>
    );
  }

  const grouped = groupByCategory(list.items ?? []);
  const totalItems = list.items?.length ?? 0;
  const purchasedItems = list.items?.filter((i) => i.isPurchased).length ?? 0;

  return (
    <div className="page">
      <div style={{ marginBottom: 24 }}>
        <Link to="/lists" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          ← All Lists
        </Link>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          {isRenaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (renameName.trim()) renameMutation.mutate(renameName.trim());
              }}
              style={{ display: 'flex', gap: 8 }}
            >
              <input
                autoFocus
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                style={{ fontSize: 22, fontWeight: 700, width: 280 }}
              />
              <button className="btn-primary" type="submit">
                Save
              </button>
              <button className="btn-ghost" type="button" onClick={() => setIsRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h1
              style={{ fontSize: 24, fontWeight: 700, cursor: 'pointer' }}
              onClick={() => {
                setRenameName(list.name);
                setIsRenaming(true);
              }}
              title="Click to rename"
            >
              {list.name}
            </h1>
          )}
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {totalItems === 0
              ? 'No items yet'
              : `${purchasedItems} of ${totalItems} purchased`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={() => setShowCopyModal(true)}>
            Copy Items To...
          </button>
          <button className="btn-primary" onClick={() => setShowAddItem(!showAddItem)}>
            + Add Item
          </button>
        </div>
      </div>

      {showAddItem && (
        <form
          onSubmit={handleAddItem}
          className="card"
          style={{ padding: 16, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Add item</div>
          <input
            placeholder="Search products..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            required
          >
            <option value="">Select a product</option>
            {products.map((p: Product) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.category ? `(${p.category.name})` : ''}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Qty"
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              style={{ width: 90 }}
            />
            <input
              placeholder="Unit (kg, pcs...)"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
          <input
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" type="submit" disabled={addItemMutation.isPending}>
              Add
            </button>
            <button className="btn-ghost" type="button" onClick={() => setShowAddItem(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {showCopyModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setShowCopyModal(false)}
        >
          <div
            className="card"
            style={{ padding: 24, width: 360 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              Copy items to another list
            </h2>
            <select
              value={targetListId}
              onChange={(e) => setTargetListId(e.target.value)}
              style={{ marginBottom: 16 }}
            >
              <option value="">Select target list</option>
              {allLists
                .filter((l: ShoppingList) => l.id !== listId)
                .map((l: ShoppingList) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-primary"
                onClick={() => copyMutation.mutate()}
                disabled={!targetListId || copyMutation.isPending}
              >
                Copy Items
              </button>
              <button className="btn-ghost" onClick={() => setShowCopyModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {totalItems === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">🧺</div>
          <div className="empty-title">This list is empty</div>
          <div className="empty-desc">Add items using the button above</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.entries(grouped).map(([categoryName, items]) => (
            <div key={categoryName}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--text-muted)',
                  marginBottom: 6,
                  paddingLeft: 4,
                }}
              >
                {categoryName}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onToggle={() => toggleMutation.mutate(item.id)}
                    onDelete={() => removeMutation.mutate(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ListItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        opacity: item.isPurchased ? 0.6 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      <input
        type="checkbox"
        checked={item.isPurchased}
        onChange={onToggle}
        style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--primary)' }}
      />
      {item.product?.imageUrl ? (
        <ProductImage
          productId={item.product.id}
          src={item.product.imageUrl}
          alt={item.product.name}
          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
        />
      ) : null}
      <div style={{ flex: 1 }}>
        <span
          style={{
            fontWeight: 500,
            textDecoration: item.isPurchased ? 'line-through' : 'none',
            color: item.isPurchased ? 'var(--text-muted)' : 'var(--text)',
          }}
        >
          {item.product?.name ?? 'Product no longer available'}
        </span>
        {(item.quantity || item.unit || item.notes) && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>
            {item.quantity ? `${item.quantity}` : ''}
            {item.unit ? ` ${item.unit}` : ''}
            {item.notes ? ` — ${item.notes}` : ''}
          </span>
        )}
      </div>
      {item.product?.category && (
        <span
          className="badge"
          style={{
            background: item.product.category.color
              ? `${item.product.category.color}22`
              : 'var(--bg)',
            color: item.product.category.color || 'var(--text-muted)',
            border: `1px solid ${item.product.category.color || 'var(--border)'}`,
          }}
        >
          {item.product.category.name}
        </span>
      )}
      <button
        onClick={onDelete}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: 16,
          padding: '4px 8px',
          borderRadius: 4,
          lineHeight: 1,
        }}
        title="Remove item"
      >
        ✕
      </button>
    </div>
  );
}

function groupByCategory(items: ListItem[]): Record<string, ListItem[]> {
  return items.reduce<Record<string, ListItem[]>>((acc, item) => {
    const key = item.product?.category?.name ?? 'Uncategorized';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}
