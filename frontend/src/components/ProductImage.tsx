import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import api from '../services/api';

export default function ProductImage({ productId, src, ...props }: ImgHTMLAttributes<HTMLImageElement> & { productId?: string }) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    let disposed = false, objectUrl = '';
    setPreview('');
    if (src?.startsWith('data:') || src?.startsWith('blob:')) { setPreview(src); return; }
    if (!src) return;
    const path = productId ? `/products/${productId}/image` : '/uploads/product-image';
    api.get(path, { responseType: 'blob', ...(!productId ? { params: { reference: src } } : {}) }).then(({ data }) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(data); setPreview(objectUrl);
    }).catch(() => { if (!disposed) setPreview(''); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [productId, src]);
  return <img {...props} src={preview || undefined} />;
}
