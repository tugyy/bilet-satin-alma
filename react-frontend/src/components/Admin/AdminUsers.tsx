import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createUser } from '../../lib/api';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field, FieldLabel, FieldContent } from '../ui/field';

export default function AdminUsers({ companies, companiesLoading, companiesError, users, usersLoading, usersError }: { companies: Array<Record<string, unknown>>; companiesLoading?: boolean; companiesError?: boolean; users: Array<Record<string, unknown>>; usersLoading?: boolean; usersError?: boolean }) {
  function getErrorMessage(err: unknown): string {
    if (!err) return 'Bilinmeyen hata';
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') return String((err as { message?: unknown }).message);
    return 'Bilinmeyen hata';
  }
  const qc = useQueryClient();
  // users are provided via props from parent AdminPanel

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newCompanyId, setNewCompanyId] = useState('');
  const [companyError, setCompanyError] = useState('');

  const companyNameById: Record<string, string> = {};
  for (const c of companies || []) {
    const id = String(c.id ?? '');
    const name = String(c.name ?? '');
    if (id) companyNameById[id] = name || id;
  }

  const [apiError, setApiError] = useState<string | null>(null);

  const addMut = useMutation({
    mutationFn: (p: { full_name: string; email: string; password: string; role?: string; company_id?: string }) => createUser(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setApiError(null);
      // keep closing handled by caller after success
    },
    onError: (err: unknown) => {
      setApiError(getErrorMessage(err));
    }
  });

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Kullanıcılar</h2>
      <Card className="p-4 mb-4">
        <div className="flex justify-between items-center">
          <div>Toplam: {users.length}</div>
          <div>
            <Button size="sm" onClick={() => {
              if (!showNew) setNewPassword('temppassword');
              else setNewPassword('');
              setShowNew((s) => !s);
            }}>Yeni Firma Admini</Button>
          </div>
        </div>

        {showNew && (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
              <Card className="p-4 w-full max-w-md rounded-lg shadow-lg">
                <h3 className="text-lg font-bold mb-2">Yeni Firma Admini Ekle</h3>
                <form onSubmit={(e) => {
                    e.preventDefault();
                    if (!newCompanyId) {
                      setCompanyError('Lütfen bir firma seçin.');
                      return;
                    }
                    const pw = newPassword || 'temppassword';
                    // clear previous api error before mutating
                    setApiError(null);
                    addMut.mutate({ full_name: newName, email: newEmail, password: pw, company_id: newCompanyId }, {
                      onSuccess: () => {
                        setNewName(''); setNewEmail(''); setNewPassword(''); setNewCompanyId(''); setCompanyError(''); setShowNew(false);
                      }
                    });
                  }} className="space-y-2">
                  <Field>
                    <FieldLabel>Ad Soyad</FieldLabel>
                    <FieldContent>
                      <input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full border px-3 py-2 rounded" />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>Email</FieldLabel>
                    <FieldContent>
                      <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full border px-3 py-2 rounded" />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>Şifre</FieldLabel>
                    <FieldContent>
                      <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled className="w-full border px-3 py-2 rounded bg-gray-100" />
                    </FieldContent>
                  </Field>
                    <Field>
                      <FieldLabel>Rol</FieldLabel>
                      <FieldContent>
                          <input value={"Firma Admini"} readOnly className="w-full border px-3 py-2 rounded bg-gray-100" />
                      </FieldContent>
                    </Field>
                    <Field>
                      <FieldLabel>Firma</FieldLabel>
                      <FieldContent>
                        <select value={newCompanyId} onChange={(e) => { setNewCompanyId(e.target.value); setCompanyError(''); }} className="w-full border px-3 py-2 rounded" disabled={!!companiesLoading}>
                          <option value="">-- Firma seçiniz --</option>
                          {companies.map((c) => (
                            <option key={String(c.id ?? Math.random())} value={String(c.id ?? '')}>{String(c.name ?? c.id ?? '')}</option>
                          ))}
                        </select>
                        {companyError && <div className="text-sm text-red-600 mt-1">{companyError}</div>}
                        {apiError && (
                          <div className="mt-2">
                            <Alert variant="destructive">
                              <AlertTitle>Hata</AlertTitle>
                              <AlertDescription>{apiError}</AlertDescription>
                            </Alert>
                          </div>
                        )}
                        {companiesLoading && <div className="text-sm text-muted-foreground mt-1">Firmalar yükleniyor...</div>}
                        {companiesError && <div className="text-sm text-red-600 mt-1">Firmalar yüklenirken hata oluştu.</div>}
                      </FieldContent>
                    </Field>
                  <div className="flex justify-end gap-2 mt-3">
                    <Button size="sm" onClick={() => { setShowNew(false); setNewPassword(''); setApiError(null); if ((addMut as unknown as { reset?: () => void }).reset) { (addMut as unknown as { reset?: () => void }).reset!(); } }}>İptal</Button>
                    <Button size="sm" type="submit">Ekle</Button>
                  </div>
                </form>
              </Card>
            </div>
          </div>
        )}

      </Card>

      <div>
  {usersLoading && <div>Yükleniyor...</div>}
  {usersError && <div>Hata oluştu</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {users.map((u: Record<string, unknown>) => (
            <Card key={String((u.id ?? u.email) ?? Math.random())} className="p-3 w-full flex flex-col justify-between">
              <div>
                <div className="font-medium">{String((u.full_name ?? u.email) ?? '')}</div>
                <div className="text-sm text-muted-foreground">{String(u.email ?? '')}</div>
                <div className="text-sm mt-2">Rol: <span className="font-medium">{String(u.role ?? 'user') === 'company' ? "Firma Admini" : String(u.role ?? 'user') === 'user' ? "Kullanıcı" : String(u.role ?? 'user')}</span></div>
                {String(u.role ?? '') === 'company' && (
                  <div className="text-sm">Firma: <span className="font-medium">{companyNameById[String(u.company_id ?? '')] ?? String(u.company_id ?? '')}</span></div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
      
    </div>
  );
}
