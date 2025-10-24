import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdminCoupons, createAdminCoupon, updateAdminCoupon, deleteAdminCoupon, type Coupon } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Field, FieldLabel, FieldContent } from '../../components/ui/field';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
// intentionally minimal UI imports for this panel

// Note: to keep things simple we reuse the same UI and behavior as company coupons.
export default function AdminCoupons() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<{ success: boolean; coupons?: Coupon[] }>({ queryKey: ['admin', 'coupons'], queryFn: fetchAdminCoupons });
  const coupons: Coupon[] = (data && data.coupons) || [];

  const [showNew, setShowNew] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDiscount, setNewDiscount] = useState<number>(0);
  const [newUsage, setNewUsage] = useState<number>(1);
  const [newExpire, setNewExpire] = useState<string>('');

  const [editItem, setEditItem] = useState<Coupon | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editDiscount, setEditDiscount] = useState<number>(0);
  const [editUsage, setEditUsage] = useState<number>(1);
  const [editExpire, setEditExpire] = useState<string>('');

  const [apiError, setApiError] = useState<string | null>(null);
  const [deleteItem, setDeleteItem] = useState<Coupon | null>(null);

  const createMut = useMutation({ mutationFn: (p: { code: string; discount: number; usage_limit: number; expire_date: string }) => createAdminCoupon(p), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }); setShowNew(false); setApiError(null); } , onError: (err: unknown) => setApiError(err instanceof Error ? err.message : String(err)) });
  const updateMut = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Partial<{ code: string; discount: number; usage_limit: number; expire_date: string }> }) => updateAdminCoupon(id, payload), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }); setEditItem(null); setApiError(null); }, onError: (err: unknown) => setApiError(err instanceof Error ? err.message : String(err)) });
  const deleteMut = useMutation({ mutationFn: (id: string) => deleteAdminCoupon(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }); }, onError: (err: unknown) => setApiError(err instanceof Error ? err.message : String(err)) });

  function openNew() { setNewCode(''); setNewDiscount(0); setNewUsage(1); setNewExpire(''); setApiError(null); setShowNew(true); }
  function openEdit(c: Coupon) { setEditItem(c); setEditCode(c.code); setEditDiscount(c.discount ?? 0); setEditUsage(c.usage_limit ?? 1); setEditExpire(c.expire_date ?? ''); setApiError(null); }

  return (
    <div className="p-2">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold">Admin Kuponları (Global)</h3>
        <Button size="sm" onClick={openNew}>{showNew ? 'İptal' : 'Yeni Kupon'}</Button>
      </div>

      {isLoading && <div>Yükleniyor...</div>}
      {isError && <div>Kuponlar yüklenirken hata oluştu</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Array.isArray(coupons) && coupons.length > 0 ? coupons.map((c: Coupon) => (
          <div key={c.id} className="border rounded p-3">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{c.code}</div>
                <div className="text-sm text-muted-foreground">İndirim: {c.discount}%</div>
                <div className="text-sm text-muted-foreground">Kullanım limiti: {c.usage_limit}</div>
                <div className="text-sm text-muted-foreground">Kullanıldı: {typeof c.used_count === 'number' ? c.used_count : 0}</div>
                <div className="text-sm text-muted-foreground">Bitiş: {c.expire_date ?? '—'}</div>
              </div>
              <div className="flex flex-col gap-2">
                <Button size="sm" onClick={() => openEdit(c)}>Düzenle</Button>
                <Button size="sm" onClick={() => setDeleteItem(c)}>Sil</Button>
              </div>
            </div>
          </div>
        )) : (
          <div>Henüz kupon bulunmamaktadır.</div>
        )}
      </div>

      {/* New modal */}
      {showNew && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <div className="p-4 w-full max-w-md rounded-lg shadow-lg bg-white">
              <h3 className="text-lg font-bold mb-2">Yeni Kupon Oluştur</h3>
              <div className="space-y-2">
                <Field>
                  <FieldLabel>Kupon Kodu</FieldLabel>
                  <FieldContent>
                    <input value={newCode} onChange={(e) => setNewCode(e.target.value)} className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>İndirim (%) — maksimum 50</FieldLabel>
                  <FieldContent>
                    <input type="number" min={0} max={50} value={newDiscount} onChange={(e) => setNewDiscount(Number(e.target.value))} className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Kullanım Limiti</FieldLabel>
                  <FieldContent>
                    <input type="number" value={newUsage} onChange={(e) => setNewUsage(Number(e.target.value))} className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Bitiş Tarihi</FieldLabel>
                  <FieldContent>
                    <input type="datetime-local" value={newExpire} onChange={(e) => setNewExpire(e.target.value)} className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>

                <div className="flex justify-end gap-2 mt-3">
                  <Button size="sm" onClick={() => setShowNew(false)}>İptal</Button>
                  <Button size="sm" onClick={() => {
                    setApiError(null);
                    if (!newCode.trim()) { setApiError('Kod gerekli'); return; }
                    if (!newExpire) { setApiError('Bitiş tarihi gerekli'); return; }
                    if (isNaN(Number(newDiscount)) || Number(newDiscount) < 0 || Number(newDiscount) > 50) { setApiError('İndirim 0-50 arası yüzde olarak girilmelidir'); return; }
                    createMut.mutate({ code: newCode.trim(), discount: Number(newDiscount), usage_limit: Number(newUsage), expire_date: newExpire });
                  }}>Oluştur</Button>
                </div>

                {apiError && (
                  <div className="mt-2">
                    <Alert variant="destructive"><AlertTitle>Hata</AlertTitle><AlertDescription>{apiError}</AlertDescription></Alert>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editItem && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <div className="p-4 w-full max-w-md rounded-lg shadow-lg bg-white">
              <h3 className="text-lg font-bold mb-2">Kupon Düzenle</h3>
              <div className="space-y-2">
                <Field>
                  <FieldLabel>Kupon Kodu</FieldLabel>
                  <FieldContent>
                    <input value={editCode} onChange={(e) => setEditCode(e.target.value)} className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>İndirim (%) — maksimum 50</FieldLabel>
                  <FieldContent>
                    <input type="number" min={0} max={50} value={editDiscount} onChange={(e) => setEditDiscount(Number(e.target.value))} className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Kullanım Limiti</FieldLabel>
                  <FieldContent>
                    <input type="number" value={editUsage} onChange={(e) => setEditUsage(Number(e.target.value))} className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Bitiş Tarihi</FieldLabel>
                  <FieldContent>
                    <input type="datetime-local" value={editExpire} onChange={(e) => setEditExpire(e.target.value)} className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>

                <div className="flex justify-end gap-2 mt-3">
                  <Button size="sm" onClick={() => setEditItem(null)}>İptal</Button>
                  <Button size="sm" onClick={() => {
                    setApiError(null);
                    if (!editCode.trim()) { setApiError('Kod gerekli'); return; }
                    if (!editExpire) { setApiError('Bitiş tarihi gerekli'); return; }
                    if (isNaN(Number(editDiscount)) || Number(editDiscount) < 0 || Number(editDiscount) > 50) { setApiError('İndirim 0-50 arası yüzde olarak girilmelidir'); return; }
                    updateMut.mutate({ id: String(editItem?.id), payload: { code: editCode.trim(), discount: Number(editDiscount), usage_limit: Number(editUsage), expire_date: editExpire } });
                  }}>Kaydet</Button>
                </div>

                {apiError && (
                  <div className="mt-2">
                    <Alert variant="destructive"><AlertTitle>Hata</AlertTitle><AlertDescription>{apiError}</AlertDescription></Alert>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal for admin coupons */}
      {deleteItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg max-w-md w-full p-4">
            <h3 className="text-lg font-bold mb-2">Kuponu Sil</h3>
            <p className="text-sm text-muted-foreground mb-4">"{deleteItem?.code}" kodlu kuponu silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</p>
            {apiError && <div className="mb-3 text-sm text-red-600">Hata: {apiError}</div>}
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 rounded bg-gray-100" onClick={() => { setDeleteItem(null); setApiError(null); }} disabled={deleteMut.status === 'pending'}>Vazgeç</button>
              <button className="px-3 py-1 rounded bg-red-500 text-white" onClick={() => {
                if (!deleteItem) return;
                setApiError(null);
                deleteMut.mutate(String(deleteItem.id), { onSuccess: () => { setDeleteItem(null); } });
              }} disabled={deleteMut.status === 'pending'}>{deleteMut.status === 'pending' ? 'Siliniyor...' : 'Sil'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
