// The studio dashboard's appointment-staffing editor — who takes which kind of
// appointment.
//
// It sits under the working-hours panel because the two are halves of one
// answer: those hours say WHEN each person is available, this says WHAT FOR, and
// a customer is only offered a time where both agree. That is also why this
// used to be so easy to get wrong from the outside — a person with hours but no
// types, or a type with hours behind it and nobody assigned, produces no error
// and no times, just a booking page that quietly has nothing to offer.
//
// So the panel is a matrix rather than a text field, and it says out loud the
// things the underlying value can't:
//
//  - **Every type is a row and every person a column**, so "who does fittings"
//    and "what is Alayna taking this season" are both read off the same grid.
//  - **A type with nobody ticked can't be saved**, and the Save button says so
//    before the round trip rather than after it. The server refuses it too —
//    this is the courtesy, that is the rule.
//  - **A type moved off the built-in staffing is marked**, with what the code
//    would have done, so a change made last season is visible rather than
//    something to remember.
//  - **Unticking somebody everywhere is fine** and is the ordinary way to say
//    they aren't taking appointments — their working hours stay on record, and
//    the bookings already in their diary can still be moved.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAppointmentStaffing,
  useSetAppointmentStaffing,
  getGetAppointmentStaffingQueryKey,
  type AppointmentStaffingType,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { serverErrorMessage } from "@/lib/api-error";
import { CalendarCheck, Loader2, RotateCcw } from "lucide-react";

const LOCATION_LABELS: Record<string, string> = {
  "in-person": "In person",
  virtual: "Virtual",
};

/** The grid being edited: type id → the people ticked for it. */
type Draft = Record<string, string[]>;

function draftOf(
  types: AppointmentStaffingType[],
  pick: (type: AppointmentStaffingType) => string[],
): Draft {
  return Object.fromEntries(types.map((type) => [type.id, [...pick(type)]]));
}

/** Same staffing, ignoring the order two lists happen to be written in. */
function sameStaff(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((name) => b.includes(name));
}

export function StudioAppointmentStaff() {
  const queryClient = useQueryClient();
  const staffing = useGetAppointmentStaffing({
    query: { queryKey: getGetAppointmentStaffingQueryKey(), retry: false },
  });
  const save = useSetAppointmentStaffing();

  // Keyed by nothing — the draft is seeded once the read lands and then owned
  // by the atelier until they save or reset, so a background refetch can't wipe
  // out half-made changes.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const data = staffing.data;
  const types = data?.types ?? [];
  const roster = data?.staff ?? [];
  const current = draft ?? draftOf(types, (type) => type.staff);

  const dirty = types.some(
    (type) => !sameStaff(current[type.id] ?? [], type.staff),
  );
  // The one rule the form can check itself. The server checks it as well and
  // its wording is what a refusal shows; this only spares a round trip.
  const emptyType = types.find((type) => (current[type.id] ?? []).length === 0);

  const toggle = (typeId: string, name: string) => {
    setSaved(false);
    setError(null);
    setDraft((held) => {
      const grid = held ?? draftOf(types, (type) => type.staff);
      const on = grid[typeId] ?? [];
      return {
        ...grid,
        // Kept in roster order, which is also the order slots fall back through
        // when a customer expresses no preference.
        [typeId]: on.includes(name)
          ? on.filter((ticked) => ticked !== name)
          : roster.filter((known) => known === name || on.includes(known)),
      };
    });
  };

  const reset = () => {
    setSaved(false);
    setError(null);
    setDraft(draftOf(types, (type) => type.defaultStaff));
  };

  const submit = () => {
    setError(null);
    save.mutate(
      {
        data: {
          types: types.map((type) => ({
            id: type.id,
            staff: current[type.id] ?? [],
          })),
        },
      },
      {
        onSuccess: () => {
          setDraft(null);
          setSaved(true);
          void queryClient.invalidateQueries({
            queryKey: getGetAppointmentStaffingQueryKey(),
          });
        },
        onError: (err) =>
          setError(
            serverErrorMessage(err) ??
              "That staffing couldn't be saved just now.",
          ),
      },
    );
  };

  return (
    <section data-testid="panel-appointment-staff">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <CalendarCheck className="w-4 h-4" strokeWidth={1.5} />
        Appointment staffing
      </h2>

      {staffing.isLoading ? (
        <div
          className="py-8 flex justify-center"
          data-testid="appointment-staff-loading"
        >
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : staffing.isError || !data ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="appointment-staff-error"
        >
          {serverErrorMessage(staffing.error) ??
            "We couldn't load the appointment staffing just now."}
        </p>
      ) : (
        <div className="rounded-sm border border-border bg-card/40 p-4 sm:p-5">
          <p className="text-sm text-muted-foreground font-light">
            Who takes each kind of appointment. A customer is only offered a
            time where this and the working hours above agree, so a type nobody
            is ticked for never appears with a slot.
          </p>

          {!data.configured && (
            <p
              className="mt-3 text-sm text-muted-foreground font-light"
              data-testid="appointment-staff-unconfigured"
            >
              There's no Studio Settings database connected, so this is what the
              code and the environment say and nothing here can be changed yet.
            </p>
          )}

          <div className="mt-4 space-y-3">
            {data.types.map((type) => {
              const on = current[type.id] ?? [];
              const moved = !sameStaff(on, type.defaultStaff);
              return (
                <div
                  key={type.id}
                  className="border-t border-border/60 pt-3 first:border-t-0 first:pt-0"
                  data-testid={`appointment-staff-type-${type.id}`}
                >
                  <div className="sm:flex sm:items-baseline sm:justify-between sm:gap-4">
                    <div>
                      <h3 className="text-base font-serif text-foreground">
                        {type.name}
                      </h3>
                      <p className="text-xs text-muted-foreground/80 font-light">
                        {type.durationMinutes} min ·{" "}
                        {type.locations
                          .map((id) => LOCATION_LABELS[id] ?? id)
                          .join(" · ")}
                        {type.requiresOrder ? " · Existing orders only" : ""}
                      </p>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 sm:mt-0 sm:justify-end">
                      {roster.map((name) => {
                        const ticked = on.includes(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => toggle(type.id, name)}
                            disabled={!data.configured || save.isPending}
                            aria-pressed={ticked}
                            className={`rounded-full border px-3 py-1 text-xs tracking-wide transition-colors disabled:opacity-60 ${
                              ticked
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:text-foreground"
                            }`}
                            data-testid={`appointment-staff-${type.id}-${name.toLowerCase()}`}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {on.length === 0 ? (
                    <p
                      className="mt-2 text-sm text-destructive"
                      data-testid={`appointment-staff-empty-${type.id}`}
                    >
                      Nobody is taking {type.name}, so no times will be offered
                      for it. Tick at least one person.
                    </p>
                  ) : (
                    moved && (
                      <p
                        className="mt-2 text-xs text-muted-foreground/80 font-light"
                        data-testid={`appointment-staff-moved-${type.id}`}
                      >
                        Changed from the studio's usual{" "}
                        {type.defaultStaff.join(" and ")}.
                      </p>
                    )
                  )}
                </div>
              );
            })}
          </div>

          {data.configured && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button
                onClick={submit}
                disabled={!dirty || Boolean(emptyType) || save.isPending}
                className="gap-2"
                data-testid="appointment-staff-save"
              >
                {save.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                )}
                Save staffing
              </Button>
              <Button
                variant="ghost"
                onClick={reset}
                disabled={save.isPending}
                className="gap-2 text-muted-foreground"
                data-testid="appointment-staff-reset"
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                Use the studio's usual staffing
              </Button>
              {saved && !dirty && (
                <span
                  className="text-sm text-muted-foreground font-light"
                  data-testid="appointment-staff-saved"
                >
                  Saved.
                </span>
              )}
            </div>
          )}

          {error && (
            <p
              className="mt-3 text-sm text-destructive"
              data-testid="appointment-staff-save-error"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
