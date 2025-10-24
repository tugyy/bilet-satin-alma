import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { registerUser } from '../lib/api';
import type { RegisterResponse } from '../lib/api';
import { Button } from '../components/ui/button';
import { Field, FieldLabel, FieldContent } from '../components/ui/field';
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert';
import { Card } from '../components/ui/card';

export default function RegisterPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mut = useMutation<RegisterResponse, Error, { full_name: string; email: string; password: string }>({
    mutationFn: (data: { full_name: string; email: string; password: string }) => registerUser(data),
    onSuccess: (data) => {
  if (data && data.token) {
        alert('Kayıt başarılı. Giriş yapıldı. Anasayfaya yönlendiriliyorsunuz.');
        window.location.href = '/';
      } else {
        alert('Kayıt başarılı. Lütfen giriş yapınız.');
        window.location.href = '/login';
      }
    }
  });

  return (
    <div className="max-w-md mx-auto p-4">
      <Card className="p-4">
        <h2 className="text-xl font-bold mb-4">Kayıt Ol</h2>

        {mut.isError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Hata</AlertTitle>
            <AlertDescription>{(mut.error as Error)?.message ?? 'Bilinmeyen hata'}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={(e) => { e.preventDefault(); mut.mutate({ full_name: fullName, email, password }); }} className="space-y-3">
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
            <FieldLabel>Şifre</FieldLabel>
            <FieldContent>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border px-3 py-2 rounded" />
            </FieldContent>
          </Field>

          <div className="flex justify-end">
            <Button type="submit" size="sm" className="h-10" disabled={mut.status === 'pending'}>
              {mut.status === 'pending' ? 'Bekleyiniz...' : 'Kayıt Ol'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
