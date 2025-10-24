import { useEffect, useState } from 'react';
import { checkCoupon, purchaseTicket, fetchProfile, type PurchaseResponse, type Trip } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';

type Props = {
  tripId: string;
  trip?: Trip | null;
  price: number;
  capacity?: number;
  seats?: Array<{ seat_number: number; status?: string; disabled?: boolean }>; // optional preloaded seats state
  onClose: () => void;
  onPurchased?: (res: PurchaseResponse) => void;
};

export default function TripBuy({ tripId, trip = null, price, capacity = 0, seats = [], onClose, onPurchased }: Props) {
  const { setUser } = useAuth();
  const [selected, setSelected] = useState<number[]>([]);
  const [occupied, setOccupied] = useState<Record<number, boolean>>({});
  const [coupon, setCoupon] = useState('');
  const [couponInfo, setCouponInfo] = useState<{ discount?: number } | null>(null);
  const [couponApplied, setCouponApplied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const occ: Record<number, boolean> = {};
    for (const s of seats) {
      if (s.status === 'booked' || s.disabled) occ[s.seat_number] = true;
    }
    setOccupied(occ);
  }, [seats]);

  const toggleSeat = (n: number) => {
    if (occupied[n]) return; // cannot select occupied
    setSelected((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      return [...prev, n];
    });
  };

  const handleCheckCoupon = async () => {
    setError(null);
    try {
      const res = await checkCoupon(coupon, tripId);
      setCouponInfo(res.coupon ?? null);
      // mark that user explicitly applied a coupon
      setCouponApplied(!!res.coupon);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in (e as Record<string, unknown>) ? String((e as Record<string, unknown>)['message']) : String(e);
      setError(msg);
      setCouponInfo(null);
      setCouponApplied(false);
    }
  };

  const handlePurchase = async () => {
    setLoading(true);
    setError(null);
    try {
      if (selected.length === 0) throw new Error('En az bir koltuk secin');
      // Only include coupon_code in payload if user explicitly applied it via "Kupon Kullan"
      const payload: { trip_id: string; seats: number[]; coupon_code?: string } = { trip_id: tripId, seats: selected };
      if (couponApplied && couponInfo) payload.coupon_code = coupon;
      const res = await purchaseTicket(payload);
      if (onPurchased) onPurchased(res);
      // Refresh profile so header (balance) is updated
      try {
        const profile = await fetchProfile().catch(() => null);
        if (profile && typeof profile === 'object' && 'user' in (profile as Record<string, unknown>)) {
          const maybe = (profile as Record<string, unknown>)['user'];
          setUser(maybe as unknown as Record<string, unknown>);
        }
      } catch {
        // ignore profile refresh errors
      }
      onClose();
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in (e as Record<string, unknown>) ? String((e as Record<string, unknown>)['message']) : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const computeDiscounted = (base: number, discount?: number | null) => {
    if (!discount || discount === 0) return base;
    // discount is percentage (e.g. 10 => 10%). Cap at 50% for safety.
    let percent = Number(discount) || 0;
    percent = Math.max(0, Math.min(50, percent));
    return Math.max(0, Math.round(base * (1 - percent / 100)));
  };

  const seatCount = capacity || (seats.length > 0 ? seats.length : 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg max-w-2xl w-full p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Bilet Detayı</h3>
        </div>

        <div className="mb-4">
          {/* Full ticket/trip details */}
          <div className="mb-3 p-3 border rounded bg-gray-50">
            <div className="flex items-center gap-3">
              {trip?.company_logo ? (
                <img src={trip.company_logo} alt={String(trip.company_name)} className="w-12 h-12 object-contain rounded" />
              ) : (
                <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-xs text-muted-foreground">Logo</div>
              )}
              <div className="flex-1">
                <div className="font-medium">{trip?.company_name ?? '-'}</div>
                <div className="text-sm text-muted-foreground">
                  {trip?.departure_city ?? '-'} → {trip?.destination_city ?? '-'}
                </div>
              </div>
              <div className="text-right text-sm">
                <div>
                  Koltuk başı: <strong>{price} TL</strong>
                </div>
                <div>
                  Fiyat toplam: <strong className={couponInfo ? 'line-through text-gray-500' : ''}>{price * selected.length} TL</strong>
                  {couponInfo && (
                    <div className="text-xs text-green-700">→ {computeDiscounted(price * selected.length, couponInfo.discount)} TL (indirimli)</div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              Kalkış: {trip?.departure_time ? new Date(trip.departure_time).toLocaleString() : '-'}
              <br />
              Varış: {trip?.arrival_time ? new Date(String(trip.arrival_time)).toLocaleString() : '-'}
              <br />
              Kapasite: {trip?.capacity ?? '-'} • Kalan: {trip?.available_seats ?? '-'}
            </div>
          </div>
          <ScrollArea className="max-h-64 rounded border p-2">
            <div className="grid grid-cols-8 gap-2">
              {Array.from({ length: seatCount }).map((_, idx) => {
              const n = idx + 1;
              const isOccupied = !!occupied[n];
              const isSelected = selected.includes(n);
              return (
                <button
                  key={n}
                  disabled={isOccupied}
                  onClick={() => toggleSeat(n)}
                  className={`p-2 rounded border ${isOccupied ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : isSelected ? 'bg-green-500 text-white' : 'bg-white'}`}
                >
                  {n}
                </button>
              );
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="mb-4">
          <div>
            Fiyat / koltuk: <strong>{price} TL</strong>
          </div>
          <div>
            Toplam: <strong className={couponInfo ? 'line-through text-gray-500' : ''}>{price * selected.length} TL</strong>
            {couponInfo && <span className="ml-2 text-sm text-green-700">{computeDiscounted(price * selected.length, couponInfo.discount)} TL</span>}
          </div>
        </div>

        <div className="mb-4 flex gap-2">
          <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Kupon kodu" className="border px-2 py-1 rounded w-full" />
          <Button size="sm" onClick={handleCheckCoupon}>Kupon Kullan</Button>
        </div>
        {couponInfo && (
          <div className="mb-4 text-sm text-green-700">
              Kupon bulundu: {couponInfo.discount}% indirim
            </div>
        )}
        {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>İptal</Button>
          <Button onClick={handlePurchase} disabled={loading}>{loading ? 'İşlem...' : 'Satın Al'}</Button>
        </div>
      </div>
    </div>
  );
}
