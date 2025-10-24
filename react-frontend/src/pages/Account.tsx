import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchProfile, updateProfile } from '../lib/api';
import { Field, FieldLabel, FieldContent } from '../components/ui/field';
import { Button } from '../components/ui/button';
import { useAuth } from '../lib/auth';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/card';

export default function Account() {
  const qc = useQueryClient();
  const { setUser, user } = useAuth();
  const navigate = useNavigate();

  // Prevent admin users from accessing the account page
  useEffect(() => {
    try {
      const role = String(((user as unknown) as { role?: string })?.role ?? '');
      if (role === 'admin') {
        // Redirect admins to admin panel
        navigate('/admin', { replace: true });
      }
    } catch {
      // ignore
    }
  }, [user, navigate]);

  const { data, isLoading } = useQuery<{ success: boolean; user?: Record<string, unknown> }>({ queryKey: ['profile'], queryFn: fetchProfile, retry: false });

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [createdAtLabel, setCreatedAtLabel] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (data && data.user) {
      const u = data.user as Record<string, unknown>;
      setFullName(String((u.full_name ?? '') as string));
      setEmail(String((u.email ?? '') as string));
      // Try common creation date fields
      const candidates = ['created_at', 'createdAt', 'registered_at', 'created'];
      let found: string | null = null;
      for (const k of candidates) {
        const v = u[k];
        if (typeof v === 'string' && v) { found = v; break; }
        if (typeof v === 'number' && Number.isFinite(v)) { found = String(v); break; }
      }
      if (found) {
        // Try to parse as ISO or timestamp
        let dt: Date | null = null;
        const asNum = Number(found);
        if (!Number.isNaN(asNum) && String(asNum).length >= 10) {
          // Assume seconds or ms
          dt = new Date(asNum > 1e12 ? asNum : asNum * 1000);
        } else {
          const parsed = Date.parse(found);
          if (!Number.isNaN(parsed)) dt = new Date(parsed);
        }
        if (dt && !Number.isNaN(dt.getTime())) {
          setCreatedAtLabel(new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(dt));
        } else {
          setCreatedAtLabel(null);
        }
      } else {
        setCreatedAtLabel(null);
      }
    }
  }, [data]);
  const mut = useMutation({
    mutationFn: (p: { full_name?: string; email?: string; password?: string }) => updateProfile(p),
    onSuccess: (res: { success?: boolean; user?: Record<string, unknown> }) => {
      if (res && res.user) {
        setUser(res.user);
        qc.invalidateQueries({ queryKey: ['profile'] });
      }
      alert('Profil güncellendi');
    }
  });

  return (
    <div className="max-w-md mx-auto p-4">
      <Card className="p-4">
        <h2 className="text-xl font-bold">Hesabım</h2>

        {isLoading && <div>Yükleniyor...</div>}

        {createdAtLabel ? (
          <div className="text-sm text-muted-foreground">Hesap oluşturulma tarihi: {createdAtLabel}</div>
        ) : (
          <div className="text-sm text-muted-foreground">Hesap oluşturulma tarihi: Bilinmiyor</div>
        )}

        <form onSubmit={(e) => {
    e.preventDefault();
    setFormError(null);
    if (password !== '' || confirmPassword !== '') {
      if (password.length < 6) {
        setFormError('Şifre en az 6 karakter olmalı');
        return;
      }
      if (password !== confirmPassword) {
        setFormError('Şifreler eşleşmiyor');
        return;
      }
    }

    const payload: { full_name?: string; email?: string; password?: string } = { full_name: fullName, email };
    if (password) payload.password = password;
    mut.mutate(payload);
  }} className="space-y-3">
        <Field>
          <FieldLabel>Ad Soyad</FieldLabel>
          <FieldContent>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full border px-3 py-2 rounded" />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>Email</FieldLabel>
          <FieldContent>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border px-3 py-2 rounded" />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>Yeni Şifre (isteğe bağlı)</FieldLabel>
          <FieldContent>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Yeni şifre" className="w-full border px-3 py-2 rounded" />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>Yeni Şifre (Tekrar)</FieldLabel>
          <FieldContent>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Şifre tekrar" className="w-full border px-3 py-2 rounded" />
          </FieldContent>
        </Field>

        {formError && (
          <div className="text-red-600 text-sm">{formError}</div>
        )}

        <div className="flex justify-end">
          {(() => {
            const loading = mut.status === 'pending';
            return (<Button type="submit" size="sm" className="h-10" disabled={loading}>{loading ? 'Güncelleniyor...' : 'Güncelle'}</Button>);
          })()}
        </div>
        </form>
      </Card>
    </div>
  );
}
