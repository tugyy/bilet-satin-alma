import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyTrips, createTrip, updateTrip, deleteTrip, fetchTripTickets, fetchMyCoupons, createCoupon, updateCoupon, deleteCoupon, cancelTicket, downloadTicketPdf, fetchProfile } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Coupon } from '../lib/api';
import type { Trip } from '../lib/api';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardHeader, CardFooter, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Field, FieldLabel, FieldContent } from '../components/ui/field';
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';

type TicketInfo = {
  ticket_id: string;
  user_id: string;
  total_price: number;
  status: string;
  created_at?: string;
  full_name?: string;
  email?: string;
  seats?: Array<{ id: string; seat_number: number }>;
  coupon_id?: string | null;
  coupon_code?: string | null;
};

export default function CompanyPanel() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [showEdit, setShowEdit] = useState<Trip | null>(null);
  const [deleteTripItem, setDeleteTripItem] = useState<Trip | null>(null);
  const [deleteTicketsCount, setDeleteTicketsCount] = useState<number | null>(null);
  const [ticketsFor, setTicketsFor] = useState<Trip | null>(null);

  // form state handled by react-hook-form + zod
  const [apiError, setApiError] = useState<string | null>(null);

  const tripSchema = z.object({
    departure_city: z.string().min(1, 'Kalkış şehri gerekli'),
    destination_city: z.string().min(1, 'Varış şehri gerekli'),
    departure_time: z.string().min(1, 'Kalkış zamanı gerekli'),
    // arrival_time is optional string (not null)
    arrival_time: z.string().optional(),
    price: z.number().min(1, 'Fiyat 1 veya daha büyük olmalıdır'),
    capacity: z.number().int().min(1, 'Kapasite en az 1 olmalı'),
  });

  type TripForm = z.infer<typeof tripSchema>;

  const createForm = useForm<TripForm>({ resolver: zodResolver(tripSchema), defaultValues: { departure_city: '', destination_city: '', departure_time: '', arrival_time: '', price: 0, capacity: 1 } });
  const editForm = useForm<TripForm>({ resolver: zodResolver(tripSchema), defaultValues: { departure_city: '', destination_city: '', departure_time: '', arrival_time: '', price: 0, capacity: 1 } });

  const { data, isLoading, error, refetch } = useQuery<import('../lib/api').TripsResponse, Error>({ queryKey: ['company', 'trips'], queryFn: fetchMyTrips });

  useEffect(() => { refetch().catch(() => {}); }, [refetch]);

  function formatDate(dt?: string) {
    if (!dt) return "";
    const d = new Date(dt);
    return d.toLocaleString();
  }

  const createMut = useMutation({ mutationFn: (p: { destination_city: string; departure_city: string; departure_time: string; arrival_time?: string; price: number; capacity: number }) => createTrip(p), onSuccess: () => { qc.invalidateQueries({ queryKey: ['company', 'trips'] }); setShowNew(false); } });
  const updateMut = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) => updateTrip(id, payload), onSuccess: () => { qc.invalidateQueries({ queryKey: ['company', 'trips'] }); setShowEdit(null); } });
  const deleteMut = useMutation({ mutationFn: (id: string) => deleteTrip(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['company', 'trips'] }); setDeleteTripItem(null); } });

  function openNew() {
    setApiError(null);
    createForm.reset({ departure_city: '', destination_city: '', departure_time: '', arrival_time: '', price: 0, capacity: 1 });
    setShowNew(true);
  }

  function closeNew() {
    setShowNew(false);
    setApiError(null);
    // clear form errors
    createForm.clearErrors();
    // reset mutation state if applicable
    if ((createMut as unknown as { reset?: () => void }).reset) {
      (createMut as unknown as { reset?: () => void }).reset!();
    }
  }

  function openEdit(t: Trip) {
    setApiError(null);
    editForm.reset({ destination_city: t.destination_city, departure_city: t.departure_city, departure_time: t.departure_time, arrival_time: t.arrival_time ?? '', price: t.price, capacity: t.capacity ?? 1 });
    setShowEdit(t);
  }

  function closeEdit() {
    setShowEdit(null);
    setApiError(null);
    editForm.clearErrors();
    if ((updateMut as unknown as { reset?: () => void }).reset) {
      (updateMut as unknown as { reset?: () => void }).reset!();
    }
  }

  // Create handler with additional client-side checks
  function handleCreateSubmit(values: TripForm) {
    setApiError(null);
    // arrival must be after departure if provided
    if (values.arrival_time && values.departure_time) {
      const dep = new Date(values.departure_time);
      const arr = new Date(values.arrival_time);
      if (isNaN(dep.getTime()) || isNaN(arr.getTime()) || arr <= dep) {
        createForm.setError('arrival_time', { type: 'manual', message: 'Varış zamanı kalkış zamanından sonra olmalıdır' });
        return;
      }
    }

    createMut.mutate(values, { onError: (err: unknown) => { const msg = err instanceof Error ? err.message : String(err); setApiError(msg); } });
  }

  // Edit handler with additional client-side checks (prevent capacity decrease below current)
  function handleEditSubmit(values: TripForm) {
    setApiError(null);
    if (!showEdit) return;

    // arrival must be after departure if provided
    if (values.arrival_time && values.departure_time) {
      const dep = new Date(values.departure_time);
      const arr = new Date(values.arrival_time);
      if (isNaN(dep.getTime()) || isNaN(arr.getTime()) || arr <= dep) {
        editForm.setError('arrival_time', { type: 'manual', message: 'Varış zamanı kalkış zamanından sonra olmalıdır' });
        return;
      }
    }

    // Prevent decreasing capacity below current value
    const currentCap = typeof showEdit.capacity === 'number' ? showEdit.capacity : (Number(showEdit.capacity) || null);
    if (currentCap !== null && values.capacity < currentCap) {
      editForm.setError('capacity', { type: 'manual', message: 'Kapasite azaltılamaz. Kapasiteyi artırabilirsiniz.' });
      return;
    }

    updateMut.mutate({ id: showEdit.id, payload: values }, { onError: (err: unknown) => { const msg = err instanceof Error ? err.message : String(err); setApiError(msg); } });
  }

  // when delete modal opens, fetch tickets count for that trip
  useEffect(() => {
    if (!deleteTripItem) {
      setDeleteTicketsCount(null);
      return;
    }
    // fetch tickets for trip (only count needed)
    fetchTripTickets(String(deleteTripItem.id)).then((res) => {
      const count = Array.isArray(res.data) ? res.data.length : 0;
      setDeleteTicketsCount(count);
    }).catch(() => setDeleteTicketsCount(null));
  }, [deleteTripItem]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Firma Admin Paneli</h2>
      </div>

      {/* Top card moved inside the Seferler tab */}

      {isLoading && <div>Yükleniyor...</div>}
      {error && (
        <Alert variant="destructive"><AlertTitle>Hata</AlertTitle><AlertDescription>{String((error as Error).message)}</AlertDescription></Alert>
      )}

      <Tabs defaultValue="trips">
        <TabsList>
          <TabsTrigger value="trips">Seferler</TabsTrigger>
          <TabsTrigger value="coupons">Kupon kodları</TabsTrigger>
        </TabsList>

        <TabsContent value="trips">
          <h3 className="text-lg font-bold mb-2">Seferler</h3>
          <Card className="p-4 mb-4">
            <div className="flex justify-between items-center">
              <div>Toplam sefer: {data?.data ? data.data.length : 0}</div>
              <div>
                <Button size="sm" onClick={openNew}>{showNew ? 'İptal' : 'Yeni Sefer'}</Button>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data?.data?.map((t: Trip) => (
              <Card key={t.id} className="hover:shadow-md transition-shadow gap-0">
                <CardHeader className="flex items-start justify-between ">
                  <div>
                    <CardTitle className="text-lg">
                      {t.departure_city} → {t.destination_city}
                    </CardTitle>
                    <CardDescription className="text-sm text-muted-foreground">
                      <div className="text-xs text-muted-foreground mt-2">{t.departure_time ? formatDate(t.departure_time) : '-'}
                        <br />
                        {t.arrival_time ? formatDate(t.arrival_time) : '-'}</div>
                    </CardDescription>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Badge className="bg-green-400 text-foreground border-0 text-sm">{t.capacity ? `${t.capacity} kişilik` : 'Standart'}</Badge>
                    <div className="text-right">
                      <div className="text-2xl font-extrabold whitespace-nowrap">{t.price} TL</div>
                      <div className="text-sm text-muted-foreground">Kalan: {t.available_seats ?? '-'}</div>
                    </div>
                  </div>
                </CardHeader>

                <CardFooter className="flex justify-between mt-2">
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => openEdit(t)}>Düzenle</Button>
                    <Button size="sm" onClick={() => setDeleteTripItem(t)}>Sil</Button>
                  </div>
                  <div>
                    <Button size="sm" onClick={() => setTicketsFor(t)}>Biletler</Button>
                  </div>
                </CardFooter>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="coupons">
          <CouponsPanel />
        </TabsContent>
      </Tabs>

      {/* New modal */}
      {showNew && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <Card className="p-4 w-full max-w-md rounded-lg shadow-lg">
              <h3 className="text-lg font-bold mb-2">Yeni Sefer Ekle</h3>
              <form onSubmit={createForm.handleSubmit(handleCreateSubmit)} className="space-y-2">
                <Field>
                  <FieldLabel>Kalkış Şehri</FieldLabel>
                  <FieldContent>
                    <input {...createForm.register('departure_city')} className="w-full border px-3 py-2 rounded" />
                    {createForm.formState.errors.departure_city && <div className="text-sm text-red-600">{createForm.formState.errors.departure_city.message}</div>}
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Varış Şehri</FieldLabel>
                  <FieldContent>
                    <input {...createForm.register('destination_city')} className="w-full border px-3 py-2 rounded" />
                    {createForm.formState.errors.destination_city && <div className="text-sm text-red-600">{createForm.formState.errors.destination_city.message}</div>}
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Kalkış Zamanı</FieldLabel>
                  <FieldContent>
                    <input {...createForm.register('departure_time')} type="datetime-local" className="w-full border px-3 py-2 rounded" />
                    {createForm.formState.errors.departure_time && <div className="text-sm text-red-600">{createForm.formState.errors.departure_time.message}</div>}
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Varış Zamanı (opsiyonel)</FieldLabel>
                  <FieldContent>
                    <input {...createForm.register('arrival_time')} type="datetime-local" className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Fiyat (TL)</FieldLabel>
                  <FieldContent>
                    <input {...createForm.register('price', { valueAsNumber: true })} type="number" className="w-full border px-3 py-2 rounded" />
                    {createForm.formState.errors.price && <div className="text-sm text-red-600">{createForm.formState.errors.price.message}</div>}
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Kapasite</FieldLabel>
                  <FieldContent>
                    <input {...createForm.register('capacity', { valueAsNumber: true })} type="number" className="w-full border px-3 py-2 rounded" />
                    {createForm.formState.errors.capacity && <div className="text-sm text-red-600">{createForm.formState.errors.capacity.message}</div>}
                  </FieldContent>
                </Field>

                <div className="flex justify-end gap-2 mt-3">
                  <Button size="sm" onClick={closeNew}>İptal</Button>
                  <Button size="sm" type="submit">Ekle</Button>
                </div>
                {apiError && <Alert variant="destructive"><AlertTitle>Hata</AlertTitle><AlertDescription>{apiError}</AlertDescription></Alert>}
              </form>
            </Card>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {showEdit && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <Card className="p-4 w-full max-w-md rounded-lg shadow-lg">
              <h3 className="text-lg font-bold mb-2">Sefer Düzenle</h3>
              <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="space-y-2">
                <Field>
                  <FieldLabel>Kalkış Şehri</FieldLabel>
                  <FieldContent>
                    <input {...editForm.register('departure_city')} className="w-full border px-3 py-2 rounded" />
                    {editForm.formState.errors.departure_city && <div className="text-sm text-red-600">{editForm.formState.errors.departure_city.message}</div>}
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Varış Şehri</FieldLabel>
                  <FieldContent>
                    <input {...editForm.register('destination_city')} className="w-full border px-3 py-2 rounded" />
                    {editForm.formState.errors.destination_city && <div className="text-sm text-red-600">{editForm.formState.errors.destination_city.message}</div>}
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Kalkış Zamanı</FieldLabel>
                  <FieldContent>
                    <input {...editForm.register('departure_time')} type="datetime-local" className="w-full border px-3 py-2 rounded" />
                    {editForm.formState.errors.departure_time && <div className="text-sm text-red-600">{editForm.formState.errors.departure_time.message}</div>}
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Varış Zamanı (opsiyonel)</FieldLabel>
                  <FieldContent>
                    <input {...editForm.register('arrival_time')} type="datetime-local" className="w-full border px-3 py-2 rounded" />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Fiyat (TL)</FieldLabel>
                  <FieldContent>
                    <input {...editForm.register('price', { valueAsNumber: true })} type="number" className="w-full border px-3 py-2 rounded" />
                    {editForm.formState.errors.price && <div className="text-sm text-red-600">{editForm.formState.errors.price.message}</div>}
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel>Kapasite</FieldLabel>
                  <FieldContent>
                    <input {...editForm.register('capacity', { valueAsNumber: true })} type="number" className="w-full border px-3 py-2 rounded" />
                    {editForm.formState.errors.capacity && <div className="text-sm text-red-600">{editForm.formState.errors.capacity.message}</div>}
                  </FieldContent>
                </Field>

                <div className="flex justify-end gap-2 mt-3">
                  <Button size="sm" onClick={closeEdit}>İptal</Button>
                  <Button size="sm" type="submit">Kaydet</Button>
                </div>
                {apiError && <Alert variant="destructive"><AlertTitle>Hata</AlertTitle><AlertDescription>{apiError}</AlertDescription></Alert>}
              </form>
            </Card>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteTripItem && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <Card className="p-4 w-full max-w-md rounded-lg shadow-lg">
              <h3 className="text-lg font-bold mb-2">Sefer Sil</h3>
              <div className="mb-3">"{deleteTripItem.departure_city} → {deleteTripItem.destination_city}" seferini silmek istiyor musunuz? Bu işlem geri alınamaz.</div>
              {deleteTicketsCount !== null && deleteTicketsCount > 0 && (
                <Alert variant="destructive">
                  <AlertTitle>Uyarı: İade ve bilet silme</AlertTitle>
                  <AlertDescription>
                    Bu sefere ait <strong>{deleteTicketsCount}</strong> adet aktif bilet bulundu. Sefer silindiğinde yolcuların ücretleri otomatik olarak iade edilecek ve biletler silinecektir. Lütfen yolcularla iletişime geçerek durumu bildirin.
                  </AlertDescription>
                </Alert>
              )}
              {deleteTicketsCount !== null && deleteTicketsCount === 0 && (
                <Alert>
                  <AlertTitle>Bilgi</AlertTitle>
                  <AlertDescription>Bu sefere ait aktif bilet bulunmamaktadır. Silme işlemi tüm kayıtları kaldıracaktır.</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-2 mt-3">
                <Button size="sm" onClick={() => { setDeleteTripItem(null); setApiError(null); if ((deleteMut as unknown as { reset?: () => void }).reset) { (deleteMut as unknown as { reset?: () => void }).reset!(); } }} disabled={deleteMut.status === 'pending'}>İptal</Button>
                <Button size="sm" onClick={() => deleteMut.mutate(String(deleteTripItem.id))} disabled={deleteMut.status === 'pending'}>{deleteMut.status === 'pending' ? 'Siliniyor...' : 'Sil'}</Button>
              </div>
              {deleteMut.status === 'success' && (
                <Alert className="mt-3">
                  <AlertTitle>Sefer silindi</AlertTitle>
                  <AlertDescription>Sefer başarılı şekilde silindi. Bilet alan yolculara ulaşarak bilgilendirmeniz tavsiye edilir.</AlertDescription>
                </Alert>
              )}
              {deleteMut.status === 'error' && (
                <Alert variant="destructive" className="mt-3"><AlertTitle>Hata</AlertTitle><AlertDescription>{String((deleteMut.error as Error)?.message ?? 'Silme sırasında hata oluştu')}</AlertDescription></Alert>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Tickets modal */}
      {ticketsFor && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <Card className="p-4 w-full max-w-2xl rounded-lg shadow-lg">
              <h3 className="text-lg font-bold mb-2">"{ticketsFor.departure_city} → {ticketsFor.destination_city}" seferine ait biletler</h3>
              <TicketsList tripId={String(ticketsFor.id)} departure_time={ticketsFor.departure_time} company_id={ticketsFor.company_id} onClose={() => setTicketsFor(null)} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function TicketsList({ tripId, onClose, departure_time, company_id }: { tripId: string; onClose: () => void; departure_time?: string; company_id?: string | null }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['trip', tripId, 'tickets'], queryFn: () => fetchTripTickets(tripId), enabled: true });
  const { user, setUser } = useAuth();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmTicket, setConfirmTicket] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  function currentUserId() {
    if (!user) return null;
    // user object may contain 'id' or 'user_id'
    return (user as Record<string, unknown>)['id'] || (user as Record<string, unknown>)['user_id'] || null;
  }

  function currentUserRole() {
    if (!user) return null;
    return (user as Record<string, unknown>)['role'] as string | null;
  }

  function currentUserCompanyId() {
    if (!user) return null;
    return (user as Record<string, unknown>)['company_id'] as string | null;
  }

  function canCancel(t: TicketInfo) {
    if (t.status !== 'active') return false;
    if (departure_time) {
      const dep = new Date(departure_time).getTime();
      if (isNaN(dep) || dep - Date.now() <= 1000 * 60 * 60) return false;
    }
    const uid = currentUserId();
    if (uid && uid === t.user_id) return true;
    const role = currentUserRole();
    if (role === 'company') {
      const myCompany = currentUserCompanyId();
      if (myCompany && company_id && myCompany === company_id) return true;
    }
    return false;
  }

  const openConfirm = (ticketId: string) => {
    setConfirmTicket(ticketId);
    setModalError(null);
  };

  const handleConfirmCancel = async () => {
    if (!confirmTicket) return;
    try {
      setActionLoading(confirmTicket);
      await cancelTicket(confirmTicket);
      setConfirmTicket(null);
      // refresh tickets list
      qc.invalidateQueries({ queryKey: ['trip', tripId, 'tickets'] });
      // refresh profile to update balances (if owner)
      try {
        const profile = await fetchProfile().catch(() => null);
        if (profile && typeof profile === 'object' && 'user' in (profile as Record<string, unknown>)) {
          const maybe = (profile as Record<string, unknown>)['user'];
          setUser(maybe as unknown as Record<string, unknown>);
        }
      } catch { /* ignore */ }
    } catch (e) {
      setModalError(String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadPdf = async (ticketId: string) => {
    try {
      setActionLoading(ticketId);
      await downloadTicketPdf(ticketId);
    } catch (e) {
      // ignore or show error
      setModalError(String(e));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      {isLoading && <div>Yükleniyor...</div>}
      {error && <Alert variant="destructive"><AlertTitle>Hata</AlertTitle><AlertDescription>{String((error as Error).message)}</AlertDescription></Alert>}
      {!isLoading && !error && (
        <ScrollArea className="max-h-96 rounded border p-2">
          <div className="space-y-3">
            {data?.data && data.data.length > 0 ? (
              (data.data as TicketInfo[]).map((t) => (
                <div key={t.ticket_id} className="border rounded p-3">
                  <div className="flex justify-between">
                    <div>
                      <div className="font-semibold">{t.full_name ?? t.user_id}</div>
                      <div className="text-sm text-muted-foreground">{t.email ?? ''}</div>
                      <div className="text-sm">Durum: {t.status === 'canceled' ? 'İptal Edildi' : departure_time && new Date(departure_time).getTime() < Date.now() ? 'Süresi Dolmuş' : 'Aktif'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{t.total_price} TL</div>
                      <div className="text-sm">Oluşturulma: {t.created_at}</div>
                      {t.coupon_code && (
                        <div className="text-sm mt-1">Kupon: <span className="font-medium">{t.coupon_code}</span></div>
                      )}
                      <div className="mt-2 flex justify-end gap-2">
                        {canCancel(t) && (
                          <button className="px-2 py-1 text-sm bg-red-500 text-white rounded" onClick={() => openConfirm(t.ticket_id)} disabled={actionLoading !== null}>
                            {actionLoading === t.ticket_id ? 'İptal ediliyor...' : 'İptal Et'}
                          </button>
                        )}
                        {currentUserId() && currentUserId() === t.user_id && (
                          <button className="px-2 py-1 text-sm bg-blue-600 text-white rounded" onClick={() => handleDownloadPdf(String(t.ticket_id))} disabled={actionLoading !== null}>
                            {actionLoading === t.ticket_id ? 'Hazırlanıyor...' : 'PDF'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2">Koltuklar: {Array.isArray(t.seats) ? t.seats.map(s => s.seat_number).join(', ') : '-'}</div>
                </div>
              ))
            ) : (
              <div>Bu sefere ait aktif bilet bulunmuyor.</div>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Confirm modal for company/admin cancellation or owner cancellation */}
      {confirmTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg max-w-md w-full p-4">
            <h3 className="text-lg font-bold mb-2">Bilet İptali</h3>
            <p className="text-sm text-muted-foreground mb-4">Bu bileti iptal etmek istediğinize emin misiniz? İptal halinde ücret iade edilecektir.</p>
            {modalError && <div className="mb-3 text-sm text-red-600">Hata: {modalError}</div>}
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 rounded bg-gray-100" onClick={() => { setConfirmTicket(null); setModalError(null); }} disabled={actionLoading !== null}>Vazgeç</button>
              <button className="px-3 py-1 rounded bg-red-500 text-white" onClick={() => handleConfirmCancel()} disabled={actionLoading !== null}>{actionLoading === confirmTicket ? 'İptal ediliyor...' : 'İptal Et'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end mt-3">
        <Button size="sm" onClick={onClose}>Kapat</Button>
      </div>
    </div>
  );
}

function CouponsPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery<{ success: boolean; coupons?: Coupon[] }>({ queryKey: ['company', 'coupons'], queryFn: fetchMyCoupons });
  const coupons: Coupon[] = (data && data.coupons) || [];

  const [showNew, setShowNew] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDiscount, setNewDiscount] = useState<number>(0);
  const [newUsage, setNewUsage] = useState<number>(1);
  const [newExpire, setNewExpire] = useState<string>('');

  const [editItem, setEditItem] = useState<import('../lib/api').Coupon | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editDiscount, setEditDiscount] = useState<number>(0);
  const [editUsage, setEditUsage] = useState<number>(1);
  const [editExpire, setEditExpire] = useState<string>('');

  const [apiError, setApiError] = useState<string | null>(null);

  const createMut = useMutation({ mutationFn: (p: { code: string; discount: number; usage_limit: number; expire_date: string }) => createCoupon(p), onSuccess: () => { qc.invalidateQueries({ queryKey: ['company', 'coupons'] }); setShowNew(false); setApiError(null); } , onError: (err: unknown) => setApiError(err instanceof Error ? err.message : String(err)) });
  const updateMut = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Partial<{ code: string; discount: number; usage_limit: number; expire_date: string }> }) => updateCoupon(id, payload), onSuccess: () => { qc.invalidateQueries({ queryKey: ['company', 'coupons'] }); setEditItem(null); setApiError(null); }, onError: (err: unknown) => setApiError(err instanceof Error ? err.message : String(err)) });
  const deleteMut = useMutation({ mutationFn: (id: string) => deleteCoupon(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['company', 'coupons'] }); }, onError: (err: unknown) => setApiError(err instanceof Error ? err.message : String(err)) });

  function openNew() { setNewCode(''); setNewDiscount(0); setNewUsage(1); setNewExpire(''); setApiError(null); setShowNew(true); }
  function openEdit(c: import('../lib/api').Coupon) { setEditItem(c); setEditCode(c.code); setEditDiscount(c.discount ?? 0); setEditUsage(c.usage_limit ?? 1); setEditExpire(c.expire_date ?? ''); setApiError(null); }

  return (
    <div className="p-2">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold">Kupon Kodları</h3>
        <Button size="sm" onClick={openNew}>{showNew ? 'İptal' : 'Yeni Kupon'}</Button>
      </div>

      {isLoading && <div>Yükleniyor...</div>}
      {isError && <div>Kuponlar yüklenirken hata oluştu</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
  {Array.isArray(coupons) && coupons.length > 0 ? coupons.map((c: Coupon) => (
          <Card key={c.id} className="p-3">
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
                <Button size="sm" onClick={() => { if (confirm('Bu kuponu silmek istediğinize emin misiniz?')) deleteMut.mutate(String(c.id)); }}>Sil</Button>
              </div>
            </div>
          </Card>
        )) : (
          <div>Henüz kupon bulunmamaktadır.</div>
        )}
      </div>

      {/* New modal */}
      {showNew && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <Card className="p-4 w-full max-w-md rounded-lg shadow-lg">
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
            </Card>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editItem && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <Card className="p-4 w-full max-w-md rounded-lg shadow-lg">
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
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
