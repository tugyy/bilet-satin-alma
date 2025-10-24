import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { login } from '../lib/api';
import type { AuthResponse } from '../lib/api';
import { Button } from '../components/ui/button';
import { Field, FieldLabel, FieldContent } from '../components/ui/field';
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert';
import { useAuth, type User } from '../lib/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/card';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  type LocState = { from?: { pathname?: string } } | null;
  const state = location.state as LocState;
  const from = state?.from?.pathname ?? '/';

  const mut = useMutation<AuthResponse, Error, { email: string; password: string }>({
    mutationFn: (data: { email: string; password: string }) => login(data),
    onSuccess: (data: AuthResponse) => {
      if (data && (data as unknown as { user?: unknown }).user) {
        setUser((data as unknown as { user?: User }).user ?? null);
      }
      navigate(from, { replace: true });
    }
  });

  return (
    <div className="max-w-md mx-auto p-4">
      <Card className="p-4">
        <h2 className="text-xl font-bold mb-4">Giriş Yap</h2>

      {mut.isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Hata</AlertTitle>
          <AlertDescription>{(mut.error as Error)?.message ?? 'Bilinmeyen hata'}</AlertDescription>
        </Alert>
      )}

  <form onSubmit={(e) => { e.preventDefault(); mut.mutate({ email, password }); }} className="space-y-3">
        <Field>
          <FieldLabel>Email</FieldLabel>
          <FieldContent>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border px-3 py-2 rounded" />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>Şifre</FieldLabel>
          <FieldContent>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border px-3 py-2 rounded" />
          </FieldContent>
        </Field>

        <div className="flex justify-end">
          {(() => {
            const loading = mut.status === 'pending';
            return (
              <Button type="submit" size="sm" className="h-10" disabled={loading}>{loading ? 'Bekleyiniz...' : 'Giriş'}</Button>
            );
          })()}
        </div>
      </form>
      </Card>
    </div>
  );
}
