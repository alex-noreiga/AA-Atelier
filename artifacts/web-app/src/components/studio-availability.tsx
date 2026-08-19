// The studio dashboard's working-hours editor — where the atelier says when
// each person is available, which is the positive grid every offered slot is
// computed from before their calendar's busy time is subtracted.
//
// This replaced a Google Sheet of the same six columns. The sheet's problem
// wasn't the shape, it was that nothing checked it: a mistyped name, a range
// that ended before it started, or a location spelled some other way produced
// no error and no hours — the day simply stopped being offered. So the editor's
// job is to make an unbookable entry impossible to save rather than to be a
// prettier grid:
//
//  - **Staff is a picker, not a field.** The names come from the server, which
//    reads the appointment catalog, so hours can only be assigned to someone the
//    studio actually books.
//  - **Days and locations are toggles.** No spelling to get wrong, no comma
//    lists or `Mon-Fri` ranges to parse.
//  - **Times are time inputs**, and the server refuses a range that ends before
//    it begins — the one rule a flat form can't express on its own.
//
// A day off is still a calendar event, not an edit here: this is the standing
// week, and Google free/busy is what carves the exceptions out of it.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStaffAvailability,
  useCreateStaffAvailability,
  useUpdateStaffAvailability,
  useDeleteStaffAvailability,
  getListStaffAvailabilityQueryKey,
  type StaffAvailabilityEntry,
  type StaffAvailabilityRequest,
  type StaffWeekday,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { serverErrorMessage } from "@/lib/api-error";
import { CalendarClock, Loader2, Plus, Trash2, Pencil } from "lucide-react";

const WEEKDAYS: StaffWeekday[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const LOCATIONS: Array<{ id: "in-person" | "virtual"; label: string }> = [
  { id: "in-person", label: "In person" },
  { id: "virtual", label: "Virtual" },
];

/** The shape the form holds while it's being filled in. */
type Draft = StaffAvailabilityRequest;

function emptyDraft(staff: string): Draft {
  return {
    staff,
    calendarEmail: "",
    weekdays: ["Monday"],
    start: "10:00",
    end: "17:00",
    locations: ["in-person"],
  };
}

/** An entry as a draft, for editing it in place. */
function draftOf(entry: StaffAvailabilityEntry): Draft {
  return {
    staff: entry.staff,
    calendarEmail: entry.calendarEmail,
    weekdays: entry.weekdays,
    start: entry.start,
    end: entry.end,
    locations: entry.locations,
  };
}

export function StudioAvailability() {
  const queryClient = useQueryClient();
  const schedule = useListStaffAvailability({
    query: { queryKey: getListStaffAvailabilityQueryKey(), retry: false },
  });
  // The form is either closed, adding, or editing one entry by id.
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: getListStaffAvailabilityQueryKey(),
    });

  const entries = schedule.data?.entries ?? [];
  const staffNames = schedule.data?.staff ?? [];
  // Grouped by person, in the order the server listed the staff, so the week
  // reads as "here is Alayna's week, here is Alexandra's".
  const grouped = staffNames
    .map((name) => ({
      name,
      entries: entries.filter((entry) => entry.staff === name),
    }))
    .filter((group) => group.entries.length > 0);
  const orphaned = entries.filter((entry) => !staffNames.includes(entry.staff));

  return (
    <section data-testid="panel-availability">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <CalendarClock className="w-4 h-4" strokeWidth={1.5} />
        Working hours
      </h2>

      {schedule.isLoading ? (
        <div
          className="py-8 flex justify-center"
          data-testid="availability-loading"
        >
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : schedule.isError ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="availability-error"
        >
          {serverErrorMessage(schedule.error) ??
            "We couldn't load the working hours just now."}
        </p>
      ) : (
        <div className="space-y-3">
          {entries.length === 0 && editing !== "new" && (
            <p
              className="text-sm text-muted-foreground font-light"
              data-testid="availability-empty"
            >
              No working hours are set, so no appointment times are being
              offered. Add the hours each person works and bookings open up
              inside them.
            </p>
          )}

          {[
            ...grouped,
            ...(orphaned.length ? [{ name: null, entries: orphaned }] : []),
          ].map((group) => (
            <div
              key={group.name ?? "unassigned"}
              className="rounded-sm border border-border bg-card/40 p-5"
              data-testid={`availability-staff-${group.name ?? "unassigned"}`}
            >
              <h3 className="text-base font-serif text-foreground">
                {group.name ?? "No longer booked"}
              </h3>
              {group.name === null && (
                <p className="mt-1 text-sm text-muted-foreground font-light">
                  These hours belong to someone the studio no longer books, so
                  nothing can be booked into them.
                </p>
              )}
              <ul className="mt-3 space-y-2">
                {group.entries.map((entry) =>
                  editing === entry.id ? (
                    <li key={entry.id}>
                      <AvailabilityForm
                        staffNames={staffNames}
                        initial={draftOf(entry)}
                        entryId={entry.id}
                        onDone={() => {
                          setEditing(null);
                          void refresh();
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </li>
                  ) : (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      onEdit={() => setEditing(entry.id)}
                      onRemoved={() => void refresh()}
                    />
                  ),
                )}
              </ul>
            </div>
          ))}

          {editing === "new" ? (
            <AvailabilityForm
              staffNames={staffNames}
              initial={emptyDraft(staffNames[0] ?? "")}
              onDone={() => {
                setEditing(null);
                void refresh();
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <Button
              variant="outline"
              onClick={() => setEditing("new")}
              className="gap-2"
              data-testid="availability-add"
            >
              <Plus className="w-4 h-4" strokeWidth={1.5} />
              Add hours
            </Button>
          )}
        </div>
      )}

      <p className="mt-2 text-xs text-muted-foreground/80 font-light">
        These are the standing hours. A day off, a trip, or anything else on a
        staff calendar is subtracted automatically — block it there, not here.
      </p>
    </section>
  );
}

/** One block of hours, as a line the atelier can read at a glance. */
function EntryRow({
  entry,
  onEdit,
  onRemoved,
}: {
  entry: StaffAvailabilityEntry;
  onEdit: () => void;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useDeleteStaffAvailability();

  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-2 first:border-t-0 first:pt-0"
      data-testid={`availability-entry-${entry.id}`}
    >
      <span className="text-sm text-foreground">
        {summarizeDays(entry.weekdays)}
      </span>
      <span className="text-sm text-muted-foreground font-light">
        {entry.start}–{entry.end}
      </span>
      <span className="text-xs tracking-wide uppercase text-muted-foreground/80">
        {entry.locations
          .map((id) => LOCATIONS.find((l) => l.id === id)?.label ?? id)
          .join(" · ")}
      </span>
      <span className="text-xs text-muted-foreground/70 font-light break-all">
        {entry.calendarEmail}
      </span>

      <span className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="gap-1 text-xs"
          data-testid={`availability-edit-${entry.id}`}
        >
          <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
          Edit
        </Button>
        {confirming ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { entryId: entry.id },
                  {
                    onSuccess: onRemoved,
                    onError: (err) =>
                      setError(
                        serverErrorMessage(err) ??
                          "Those hours couldn't be removed.",
                      ),
                  },
                )
              }
              data-testid={`availability-remove-confirm-${entry.id}`}
            >
              Remove
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
              data-testid={`availability-remove-cancel-${entry.id}`}
            >
              Keep
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            className="gap-1 text-xs text-muted-foreground"
            data-testid={`availability-remove-${entry.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            Remove
          </Button>
        )}
      </span>

      {error && (
        <p
          className="w-full text-sm text-destructive"
          data-testid={`availability-entry-error-${entry.id}`}
        >
          {error}
        </p>
      )}
    </li>
  );
}

/** The add/edit form. One component for both, so the two can't drift apart —
 * the server validates them identically for the same reason. */
function AvailabilityForm({
  staffNames,
  initial,
  entryId,
  onDone,
  onCancel,
}: {
  staffNames: string[];
  initial: Draft;
  /** Present when editing an existing entry; absent when adding one. */
  entryId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateStaffAvailability();
  const update = useUpdateStaffAvailability();
  const pending = create.isPending || update.isPending;

  const toggleDay = (day: StaffWeekday) =>
    setDraft((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((d) => d !== day)
        : WEEKDAYS.filter((d) => d === day || current.weekdays.includes(d)),
    }));

  const toggleLocation = (id: "in-person" | "virtual") =>
    setDraft((current) => ({
      ...current,
      locations: current.locations.includes(id)
        ? current.locations.filter((l) => l !== id)
        : [...current.locations, id],
    }));

  // The server has the final say (and says why); this only stops a submit that
  // couldn't possibly be saved, so the atelier isn't sent a round trip to learn
  // they left the days empty.
  const incomplete =
    !draft.staff ||
    !draft.calendarEmail.trim() ||
    draft.weekdays.length === 0 ||
    draft.locations.length === 0 ||
    !draft.start ||
    !draft.end;

  const save = () => {
    setError(null);
    const data: Draft = { ...draft, calendarEmail: draft.calendarEmail.trim() };
    const handlers = {
      onSuccess: onDone,
      onError: (err: unknown) =>
        setError(
          serverErrorMessage(err) ?? "Those hours couldn't be saved just now.",
        ),
    };
    if (entryId) update.mutate({ entryId, data }, handlers);
    else create.mutate({ data }, handlers);
  };

  const fieldId = `availability-${entryId ?? "new"}`;

  return (
    <div
      className="rounded-sm border border-border bg-card/60 p-5"
      data-testid={
        entryId ? `availability-form-${entryId}` : "availability-form-new"
      }
    >
      <div className="flex flex-wrap gap-4">
        <div className="min-w-[10rem]">
          <Label
            htmlFor={`${fieldId}-staff`}
            className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground"
          >
            Who
          </Label>
          <select
            id={`${fieldId}-staff`}
            value={draft.staff}
            onChange={(event) =>
              setDraft({ ...draft, staff: event.target.value })
            }
            className="mt-1 h-9 w-full rounded-sm border border-input bg-background px-3 text-sm"
            data-testid={`${fieldId}-staff`}
          >
            {staffNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-[14rem]">
          <Label
            htmlFor={`${fieldId}-email`}
            className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground"
          >
            Booking calendar
          </Label>
          <Input
            id={`${fieldId}-email`}
            type="email"
            value={draft.calendarEmail}
            onChange={(event) =>
              setDraft({ ...draft, calendarEmail: event.target.value })
            }
            placeholder="name@a3iceanddance.com"
            autoComplete="off"
            className="mt-1"
            data-testid={`${fieldId}-email`}
          />
        </div>

        <div className="w-28">
          <Label
            htmlFor={`${fieldId}-start`}
            className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground"
          >
            From
          </Label>
          <Input
            id={`${fieldId}-start`}
            type="time"
            value={draft.start}
            onChange={(event) =>
              setDraft({ ...draft, start: event.target.value })
            }
            className="mt-1"
            data-testid={`${fieldId}-start`}
          />
        </div>

        <div className="w-28">
          <Label
            htmlFor={`${fieldId}-end`}
            className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground"
          >
            To
          </Label>
          <Input
            id={`${fieldId}-end`}
            type="time"
            value={draft.end}
            onChange={(event) =>
              setDraft({ ...draft, end: event.target.value })
            }
            className="mt-1"
            data-testid={`${fieldId}-end`}
          />
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
          Days
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const on = draft.weekdays.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1 text-xs tracking-wide transition-colors ${
                  on
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`${fieldId}-day-${day.toLowerCase()}`}
              >
                {day.slice(0, 3)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
          Bookable for
        </legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {LOCATIONS.map((location) => (
            <label
              key={location.id}
              htmlFor={`${fieldId}-location-${location.id}`}
              className="flex items-center gap-2 cursor-pointer group w-fit"
            >
              <input
                id={`${fieldId}-location-${location.id}`}
                type="checkbox"
                checked={draft.locations.includes(location.id)}
                onChange={() => toggleLocation(location.id)}
                className="h-4 w-4 shrink-0 rounded-sm border-border text-primary accent-primary focus-visible:ring-primary"
                data-testid={`${fieldId}-location-${location.id}`}
              />
              <span className="text-sm font-light text-muted-foreground group-hover:text-foreground transition-colors">
                {location.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 flex items-center gap-2">
        <Button
          onClick={save}
          disabled={incomplete || pending}
          className="gap-2"
          data-testid={`${fieldId}-save`}
        >
          {pending && (
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
          )}
          Save hours
        </Button>
        <Button
          variant="ghost"
          onClick={onCancel}
          data-testid={`${fieldId}-cancel`}
        >
          Cancel
        </Button>
      </div>

      {error && (
        <p
          className="mt-3 text-sm text-destructive"
          data-testid={`${fieldId}-error`}
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** "Mon–Fri" when the days run consecutively, otherwise "Mon · Wed · Sat". */
function summarizeDays(days: string[]): string {
  if (days.length === 0) return "No days";
  const indexes = days
    .map((day) => WEEKDAYS.indexOf(day as StaffWeekday))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  const consecutive = indexes.every(
    (index, i) => i === 0 || index === indexes[i - 1] + 1,
  );
  const short = (index: number) => WEEKDAYS[index].slice(0, 3);
  if (indexes.length > 2 && consecutive) {
    return `${short(indexes[0])}–${short(indexes[indexes.length - 1])}`;
  }
  return indexes.map(short).join(" · ");
}
