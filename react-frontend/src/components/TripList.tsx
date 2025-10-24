import { useEffect, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchTrips } from "../lib/api";
import type { Trip, TripsResponse } from "../lib/api";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardDescription
} from "./ui/card";
import { Badge } from "./ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Field, FieldLabel, FieldContent } from "./ui/field";
import TripBuy from "./TripBuy";
import { fetchTrip } from "../lib/api";

function formatDate(dt?: string) {
  if (!dt) return "";
  const d = new Date(dt);
  return d.toLocaleString();
}

export default function TripList() {
  const [departure, setDeparture] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");

  const queryKey = ["trips"];

  const queryResult = useQuery({
    queryKey,
    queryFn: () =>
      fetchTrips({
        departure_city: departure,
        destination_city: destination,
        date,
      }),
    enabled: false,
  }) as UseQueryResult<TripsResponse, Error>;

  const { data, isLoading, error, refetch } = queryResult;

  const [openTrip, setOpenTrip] = useState<string | null>(null);
  const [selectedTripSeats, setSelectedTripSeats] = useState<
    | Array<{ seat_number: number; status?: string; disabled?: boolean }>
    | undefined
  >(undefined);
  const [selectedTripPrice, setSelectedTripPrice] = useState<number>(0);
  const [selectedTripCapacity, setSelectedTripCapacity] = useState<
    number | undefined
  >(undefined);

  // initial load on mount
  useEffect(() => {
    refetch().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Seferleri Ara</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          refetch();
        }}
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6 items-end"
      >
        <Field className="col-span-1 md:col-span-1">
          <FieldLabel>Kalkış Şehri</FieldLabel>
          <FieldContent>
            <input
              placeholder="Kalkış Şehri"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
              className="border px-3 py-2 w-full rounded-md"
            />
          </FieldContent>
        </Field>

        <Field className="col-span-1 md:col-span-1">
          <FieldLabel>Varış Şehri</FieldLabel>
          <FieldContent>
            <input
              placeholder="Varış Şehri"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="border px-3 py-2 w-full rounded-md"
            />
          </FieldContent>
        </Field>

        <Field className="col-span-1 md:col-span-1">
          <FieldLabel>Tarih</FieldLabel>
          <FieldContent>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border px-3 py-2 w-full rounded-md"
            />
          </FieldContent>
        </Field>

        <div className="col-span-1 md:col-span-1 flex justify-start md:justify-end">
          <Button type="submit" size="lg" className="w-full h-10 text-base">
            Ara
          </Button>
        </div>
      </form>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse bg-gray-100 rounded-lg p-4 h-28"
            />
          ))}
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Hata</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : String(error)}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && data?.data && data.data.length === 0 && (
        <Alert>Sefer bulunamadı.</Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.data?.map((t: Trip) => (
          <Card key={t.id} className="hover:shadow-md transition-shadow gap-0">
            <CardHeader className="flex items-start justify-between ">
              <div>
                <CardTitle className="text-lg">
                  {t.departure_city} → {t.destination_city}
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  <div className="text-xs text-muted-foreground mt-2">
                    {t.departure_time ? formatDate(t.departure_time) : '-'} • {t.arrival_time ? formatDate(t.arrival_time) : '-'}
                  </div>
                </CardDescription>
              </div>

              <div className="flex flex-col gap-2">
                <Badge className="bg-green-400 text-foreground border-0 text-sm">
                  {t.capacity ? `${t.capacity} kişilik` : "Standart"}
                </Badge>
                <div className="text-right">
                  <div className="text-2xl font-extrabold whitespace-nowrap">{t.price} TL</div>
                  <div className="text-sm text-muted-foreground">
                    Kalan: {t.available_seats ?? "-"}
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              <div className="flex items-center justify-between gap-3 mt-2">
                <div className="flex items-center gap-3">
                  {t.company_logo ? (
                    <img src={t.company_logo} alt={String(t.company_name)} className="w-16 h-16 object-contain rounded" />
                  ) : (
                    <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center text-xs text-muted-foreground">Logo</div>
                  )}

                    <div className="text-sm font-medium">{t.company_name ?? ''}</div>
                </div>

                <div className="items-end">
                  <Button
                    size="sm"
                    onClick={async () => {
                      setOpenTrip(t.id);
                      setSelectedTripPrice(t.price);
                      setSelectedTripCapacity(t.capacity);
                      try {
                        const jRaw = await fetchTrip(t.id).catch(
                          () => ({} as unknown)
                        );
                        const j = jRaw as {
                          success?: boolean;
                          data?: { seats?: Array<Record<string, unknown>> };
                        };
                        if (j && j.data && j.data.seats) {
                          setSelectedTripSeats(
                            j.data.seats.map((s) => {
                              return {
                                seat_number: Number(s["seat_number"]),
                                status: String(s["status"] ?? ""),
                                disabled: !!s["disabled"],
                              };
                            })
                          );
                        } else {
                          setSelectedTripSeats(undefined);
                        }
                      } catch {
                        setSelectedTripSeats(undefined);
                      }
                    }}
                  >
                    Detay
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {openTrip && (
        <TripBuy
          tripId={openTrip}
          trip={data?.data?.find((x) => x.id === openTrip) ?? null}
          price={selectedTripPrice}
          capacity={selectedTripCapacity}
          seats={selectedTripSeats}
          onClose={() => setOpenTrip(null)}
          onPurchased={() => {
            refetch();
          }}
        />
      )}
    </div>
  );
}
