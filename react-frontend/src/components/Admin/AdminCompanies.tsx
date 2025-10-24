import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCompany, updateCompany, deleteCompany, assignManager, removeManager, fetchCompany } from '../../lib/api';
import { Card } from '../ui/card';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { Field, FieldLabel, FieldContent } from '../ui/field';

export default function AdminCompanies({ companies, companiesLoading, companiesError, users }: { companies: Array<Record<string, unknown>>; companiesLoading?: boolean; companiesError?: boolean; users: Array<Record<string, unknown>>; }) {
  function getErrorMessage(err: unknown): string {
    if (!err) return 'Bilinmeyen hata';
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') return String((err as { message?: unknown }).message);
    return 'Bilinmeyen hata';
  }
  const qc = useQueryClient();
  const isLoading = !!companiesLoading;
  const isError = !!companiesError;


  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLogo, setNewLogo] = useState<string | null>(null);

  const [editCompany, setEditCompany] = useState<Record<string, unknown> | null>(null);
  const [editName, setEditName] = useState('');
  const [editLogo, setEditLogo] = useState<string | null>(null);

  const [deleteCompanyItem, setDeleteCompanyItem] = useState<Record<string, unknown> | null>(null);

  const [managingCompany, setManagingCompany] = useState<Record<string, unknown> | null>(null);
  const [managingLoading, setManagingLoading] = useState(false);
  // new: accept email instead of selecting user id
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>('');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (p: { name: string; logo_path?: string | null }) => createCompany(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'companies'] });
      setApiError(null);
    },
    onError: (err: unknown) => {
      setApiError(getErrorMessage(err));
    }
  });
  const updateMut = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) => updateCompany(id, payload), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'companies'] }) });
  const deleteMut = useMutation({ mutationFn: (id: string) => deleteCompany(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'companies'] }) });
  

  // Enhance assign/remove to refresh managingCompany data after mutation
  const assignMutEnhanced = useMutation({
    mutationFn: ({ companyId, userId }: { companyId: string; userId: string }) => assignManager(companyId, userId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'companies'] });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (vars && vars.companyId) {
        setManagingLoading(true);
        fetchCompany(String(vars.companyId)).then((res) => {
          const r = res as { success?: boolean; data?: Record<string, unknown> };
          if (r && r.data) setManagingCompany(r.data);
        }).catch(() => {}).finally(() => setManagingLoading(false));
      }
    }
  });

  const removeMutEnhanced = useMutation({
    mutationFn: ({ companyId, userId }: { companyId: string; userId: string }) => removeManager(companyId, userId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'companies'] });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (vars && vars.companyId) {
        setManagingLoading(true);
        fetchCompany(String(vars.companyId)).then((res) => {
          const r = res as { success?: boolean; data?: Record<string, unknown> };
          if (r && r.data) setManagingCompany(r.data);
        }).catch(() => {}).finally(() => setManagingLoading(false));
      }
    }
  });

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Firmalar</h2>
      <Card className="p-4 mb-4">
          <div className="flex justify-between items-center">
          <div>Toplam: {companies.length}</div>
          <div>
            <Button size="sm" onClick={() => { setApiError(null); setShowNew((s) => !s); }}>{showNew ? 'İptal' : 'Yeni Firma'}</Button>
          </div>
        </div>

        {showNew && (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
              <Card className="p-4 w-full max-w-md rounded-lg shadow-lg">
                <h3 className="text-lg font-bold mb-2">Yeni Firma Ekle</h3>
                <form onSubmit={(e) => { e.preventDefault(); setApiError(null); createMut.mutate({ name: newName, logo_path: newLogo }, { onSuccess: () => { setNewName(''); setNewLogo(null); setShowNew(false); } }); }} className="space-y-2">
                  <Field>
                    <FieldLabel>Firma Adı</FieldLabel>
                    <FieldContent>
                      <input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full border px-3 py-2 rounded" />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>Logo Path (opsiyonel)</FieldLabel>
                    <FieldContent>
                      <input value={newLogo ?? ''} onChange={(e) => setNewLogo(e.target.value || null)} className="w-full border px-3 py-2 rounded" />
                      {newLogo && (
                        <div className="mt-2">
                          <img src={newLogo} alt="Yeni firma logo önizleme" className="h-24 object-contain" />
                        </div>
                      )}
                    </FieldContent>
                  </Field>
                    <div className="flex justify-end gap-2 mt-3">
                      <Button size="sm" onClick={() => { setShowNew(false); setNewLogo(null); setApiError(null); if ((createMut as unknown as { reset?: () => void }).reset) { (createMut as unknown as { reset?: () => void }).reset!(); } }}>İptal</Button>
                      <Button size="sm" type="submit">Ekle</Button>
                    </div>
                  {apiError && (
                    <div className="mt-2">
                      <Alert variant="destructive">
                        <AlertTitle>Hata</AlertTitle>
                        <AlertDescription>{apiError}</AlertDescription>
                      </Alert>
                    </div>
                  )}
                </form>
              </Card>
            </div>
          </div>
        )}

      </Card>

      <div>
        {isLoading && <div>Yükleniyor...</div>}
        {isError && <div>Hata oluştu</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {companies.map((c: Record<string, unknown>) => (
            <Card key={String(c.id ?? Math.random())} className="p-3 w-full flex flex-col justify-between">
              <div className="flex items-center gap-3">
                {c.logo_path != null ? (
                  <img src={String(c.logo_path)} className="h-12 w-12 object-contain" />
                ) : (
                  <div className="h-12 w-12 bg-gray-100 rounded flex items-center justify-center text-sm text-muted-foreground">No</div>
                )}
                <div className="flex-1">
                  <div className="font-medium">{String(c.name ?? '')}</div>
                  <div className="text-sm mt-1">Yöneticiler: <span className="font-medium">{String(c.manager_count ?? 0)}</span></div>
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => {
                  setEditCompany(c); setEditName(String(c.name ?? '')); setEditLogo(c.logo_path ? String(c.logo_path) : null);
                }}>Düzenle</Button>
                <Button size="sm" onClick={() => setDeleteCompanyItem(c)}>Sil</Button>
                <Button size="sm" className='px-2' onClick={() => {
                  setManagingCompany({ id: c.id, name: c.name });
                  // reset email input and errors when opening
                  setSelectedUserEmail('');
                  setAssignError(null);
                  setManagingLoading(true);
                  fetchCompany(String(c.id)).then((res) => {
                    const r = res as { success?: boolean; data?: Record<string, unknown> };
                    if (r && r.data) setManagingCompany(r.data);
                  }).catch(() => {}).finally(() => setManagingLoading(false));
                }}>Yöneticiler</Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Edit modal */}
      {editCompany && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <Card className="p-4 w-full max-w-md rounded-lg shadow-lg">
              <h3 className="text-lg font-bold mb-2">Firma Düzenle</h3>
              <form onSubmit={(e) => {
                e.preventDefault();
                setApiError(null);
                updateMut.mutate({ id: String(editCompany.id), payload: { name: editName, logo_path: editLogo } }, {
                  onSuccess: () => {
                    // close modal only on success
                    setEditCompany(null);
                  },
                  onError: (err: unknown) => {
                    setApiError(getErrorMessage(err));
                  }
                });
              }} className="space-y-2">
                <Field>
                  <FieldLabel>Firma Adı</FieldLabel>
                  <FieldContent>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Logo Path (opsiyonel)</FieldLabel>
                  <FieldContent>
                    <input value={editLogo ?? ''} onChange={(e) => setEditLogo(e.target.value || null)} className="w-full border px-3 py-2 rounded" />
                    {editLogo && (
                      <div className="mt-2">
                        <img src={editLogo} alt="Firma logo önizleme" className="h-24 object-contain" />
                      </div>
                    )}
                  </FieldContent>
                </Field>
                <div className="flex justify-end gap-2 mt-3">
                  <Button size="sm" onClick={() => { setEditCompany(null); setApiError(null); if ((updateMut as unknown as { reset?: () => void }).reset) { (updateMut as unknown as { reset?: () => void }).reset!(); } }}>İptal</Button>
                  <Button size="sm" type="submit">Kaydet</Button>
                </div>
                {apiError && (
                  <div className="mt-2">
                    <Alert variant="destructive">
                      <AlertTitle>Hata</AlertTitle>
                      <AlertDescription>{apiError}</AlertDescription>
                    </Alert>
                  </div>
                )}
              </form>
            </Card>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteCompanyItem && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <Card className="p-4 w-full max-w-md rounded-lg shadow-lg">
              <h3 className="text-lg font-bold mb-2">Firma Sil</h3>
              <div>"{String(deleteCompanyItem.name ?? '')}" adlı firmayı silmek istiyor musunuz? Bu işlem geri alınamaz.</div>
              <div className="text-sm text-muted-foreground mt-2">Not: Firma silindiğinde, firmaya ait gelecekteki seferler iptal edilecek ve bu seferlere bilet almış yolcuların ücretleri bakiyelerine iade edilecektir.</div>
              <div className="flex justify-end gap-2 mt-3">
                <Button size="sm" onClick={() => { setDeleteCompanyItem(null); setApiError(null); if ((deleteMut as unknown as { reset?: () => void }).reset) { (deleteMut as unknown as { reset?: () => void }).reset!(); } }}>İptal</Button>
                <Button size="sm" onClick={() => { deleteMut.mutate(String(deleteCompanyItem.id)); setDeleteCompanyItem(null); }}>Sil</Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Manage managers modal */}
      {managingCompany && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <Card className="p-4 w-full max-w-lg rounded-lg shadow-lg">
              <h3 className="text-lg font-bold mb-2">{String(managingCompany.name ?? '')} - Yöneticiler</h3>
              <div className="space-y-2">
                <div className="text-sm font-medium">Mevcut Yöneticiler</div>
                <div className="space-y-1">
                  {managingLoading ? (
                    <div>Yükleniyor...</div>
                  ) : Array.isArray(managingCompany.managers) && (managingCompany.managers as Array<Record<string, unknown>>).length > 0 ? (
                    <ScrollArea className="max-h-48 rounded border">
                      <div className="space-y-1 p-2">
                        {(managingCompany.managers as Array<Record<string, unknown>>).map((m) => (
                          <div key={String(m.id ?? Math.random())} className="flex items-center justify-between border rounded p-2">
                            <div>
                              <div className="font-medium">{String(m.full_name ?? m.email ?? '')}</div>
                              <div className="text-sm text-muted-foreground">{String(m.email ?? '')}</div>
                            </div>
                            <div>
                              <Button size="sm" onClick={() => { removeMutEnhanced.mutate({ companyId: String(managingCompany.id), userId: String(m.id) }); }}>Kaldır</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="text-sm text-muted-foreground">Henüz yönetici atanmadı.</div>
                  )}
                </div>

                <div className="mt-3">
                  <div className="text-sm font-medium">Yeni Yönetici Ata</div>
                  <div className="mt-2">
                    <input
                      type="email"
                      placeholder="Kullanıcı e-posta adresi"
                      value={selectedUserEmail}
                      onChange={(e) => { setSelectedUserEmail(e.target.value); setAssignError(null); }}
                      className="w-full border px-3 py-2 rounded"
                    />
                    {assignError && <div className="text-sm text-red-600 mt-1">{assignError}</div>}
                    {apiError && (
                      <div className="mt-2">
                        <Alert variant="destructive">
                          <AlertTitle>Hata</AlertTitle>
                          <AlertDescription>{apiError}</AlertDescription>
                        </Alert>
                      </div>
                    )}
                  </div>
                    <div className="flex justify-end gap-2 mt-3">
                    <Button size="sm" onClick={() => { setManagingCompany(null); setApiError(null); setAssignError(null); }}>Kapat</Button>
                    <Button size="sm" onClick={() => {
                      // validate email presence
                      const email = selectedUserEmail.trim();
                      if (!email) { setAssignError('Lütfen bir e-posta girin'); return; }
                      // find user by email
                      const found = users.find((u) => String(u.email ?? '').toLowerCase() === email.toLowerCase());
                      if (!found || !found.id) { setAssignError('Bu e-posta ile eşleşen kullanıcı bulunamadı'); return; }
                      setAssignError(null);
                      setApiError(null);
                      assignMutEnhanced.mutate({ companyId: String(managingCompany.id), userId: String(found.id) }, {
                        onError: (err: unknown) => {
                          setApiError(getErrorMessage(err));
                        }
                      });
                    }}>Ata</Button>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

    </div>
  );
}
