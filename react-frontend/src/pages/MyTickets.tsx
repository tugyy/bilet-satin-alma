import { useEffect, useState } from "react";
import { fetchMyTickets, cancelTicket, downloadTicketPdf, fetchProfile } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
export type Ticket = {
  ticket_id: string;
  trip_id?: string;
  total_price?: number;
  seat_price?: number;
  status?: string;
  created_at?: string;
  seats?: number[];
  departure_time?: string;
  arrival_time?: string;
  departure_city?: string;
  destination_city?: string;
  company_name?: string;
  company_logo?: string | null;
};

export default function MyTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const { setUser } = useAuth();

  useEffect(() => {
    setLoading(true);
    fetchMyTickets()
      .then((res) => {
        setTickets(res.data || []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const refresh = () => {
    setLoading(true);
    fetchMyTickets()
      .then((res) => setTickets(res.data || []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  const openCancelModal = (ticketId: string) => {
    setSelectedTicketId(ticketId);
    setModalError(null);
    setConfirmModalOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!selectedTicketId) return;
    try {
      setActionLoading(selectedTicketId);
      await cancelTicket(selectedTicketId);
      setConfirmModalOpen(false);
      setSelectedTicketId(null);
      // Refresh profile so header (balance) is updated after refund
      try {
        const profile = await fetchProfile().catch(() => null);
        if (profile && typeof profile === 'object' && 'user' in (profile as Record<string, unknown>)) {
          const maybe = (profile as Record<string, unknown>)['user'];
          setUser(maybe as unknown as Record<string, unknown>);
        }
      } catch {
        // ignore
      }
      // refresh list
      refresh();
    } catch (e) {
      const msg =
        e &&
        typeof e === "object" &&
        "message" in (e as Record<string, unknown>)
          ? String((e as Record<string, unknown>)["message"])
          : String(e);
      setModalError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadPdf = async (ticketId: string) => {
    try {
      setActionLoading(ticketId);
      await downloadTicketPdf(ticketId);
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in (e as Record<string, unknown>) ? String((e as Record<string, unknown>)['message']) : String(e);
      // show modal error if modal open, otherwise set global error
      if (confirmModalOpen) setModalError(msg); else setError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Biletlerim</h2>
      {loading && <div>Yükleniyor...</div>}
      {error && <div className="text-red-600">Hata: {error}</div>}
      {!loading && tickets.length === 0 && <div>Henüz biletiniz yok.</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tickets.map((t) => (
          <Card key={t.ticket_id}>
            <CardHeader className="flex justify-between items-start">
              <div>
                <div className="font-medium">
                  {t.departure_city} → {t.destination_city}
                </div>
                <div className="text-sm text-muted-foreground">
                  Kalkış:{" "}
                  {t.departure_time
                    ? new Date(t.departure_time).toLocaleString()
                    : "-"}
                  <br />
                  Varış:{" "}
                  {t.arrival_time
                    ? new Date(t.arrival_time).toLocaleString()
                    : "-"}
                  <div className="m-auto">
                    {/* Show cancel button when ticket is active and departure is more than 1 hour away */}
                    {t.status === "active" &&
                      t.departure_time &&
                      new Date(t.departure_time).getTime() - Date.now() >
                        1000 * 60 * 60 && (
                        <button
                          className="px-2 py-1 text-sm bg-red-500 text-white rounded"
                          onClick={() => openCancelModal(String(t.ticket_id))}
                          disabled={actionLoading !== null}
                        >
                          {actionLoading === t.ticket_id
                            ? "Iptal ediliyor..."
                            : "Iptal Et"}
                        </button>
                      )}
                    <button
                      className="ml-2 px-2 py-1 text-sm bg-blue-600 text-white rounded"
                      onClick={() => handleDownloadPdf(String(t.ticket_id))}
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === t.ticket_id ? "Hazırlanıyor..." : "PDF"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="text-right">
                {(() => {
                  const finalPrice = t.total_price ?? 0;
                  const seatPrice = t.seat_price ?? 0;
                  const seatCount = t.seats ? t.seats.length : 0;
                  const original = seatPrice * seatCount;
                  if (original && original > finalPrice) {
                    return (
                      <div>
                        <div className="text-sm text-gray-500 line-through">{original} TL</div>
                        <div className="font-bold text-green-700">{finalPrice} TL</div>
                      </div>
                    );
                  }
                  return <div className="font-bold">{finalPrice} TL</div>;
                })()}
                <div className="mt-1">
                  <Badge>
                    {t.status === "canceled"
                      ? "İptal Edildi"
                      : t.departure_time &&
                        new Date(t.departure_time).getTime() < Date.now()
                      ? "Süresi Dolmuş"
                      : "Aktif"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                {t.company_logo ? (
                  <img
                    src={t.company_logo}
                    alt={String(t.company_name)}
                    className="w-12 h-12 object-contain rounded"
                  />
                ) : (
                  <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-xs text-muted-foreground">
                    Logo
                  </div>
                )}
                <div className="flex flex-col">
                  <div className="font-medium">{t.company_name ?? ""}</div>
                  <div className="text-sm">
                    Koltuklar:{" "}
                    {t.seats && t.seats.length > 0 ? t.seats.join(", ") : "-"}
                  </div>
                  {/* Confirm cancellation modal */}
                  {confirmModalOpen && selectedTicketId && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                      <div className="bg-white rounded-lg max-w-md w-full p-4">
                        <h3 className="text-lg font-bold mb-2">Bilet İptali</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Bu bileti iptal etmek istediğinize emin misiniz? İptal
                          halinde ücret iade edilecektir.
                        </p>
                        {modalError && (
                          <div className="mb-3 text-sm text-red-600">
                            Hata: {modalError}
                          </div>
                        )}
                        <div className="flex justify-end gap-2">
                          <button
                            className="px-3 py-1 rounded bg-gray-100"
                            onClick={() => {
                              setConfirmModalOpen(false);
                              setSelectedTicketId(null);
                              setModalError(null);
                            }}
                          >
                            Vazgeç
                          </button>
                          <button
                            className="px-3 py-1 rounded bg-red-500 text-white"
                            onClick={() => handleConfirmCancel()}
                            disabled={actionLoading !== null}
                          >
                            {actionLoading === selectedTicketId
                              ? "Iptal ediliyor..."
                              : "İptal Et"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <div className="text-xs text-muted-foreground">
                Bilet No: {t.ticket_id}
                <br />
                Oluşturuldu:{" "}
                {t.created_at ? new Date(t.created_at).toLocaleString() : "-"}
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
