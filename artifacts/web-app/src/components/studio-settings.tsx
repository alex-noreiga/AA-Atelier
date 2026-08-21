// The studio dashboard's settings editor.
//
// These settings have been live-editable for a while — as a free-text key/value
// table in Notion, where both halves of a row fail silently when they're wrong.
// A mistyped KEY is a row nothing reads. A mistyped VALUE is parsed, rejected,
// and replaced by the built-in default. Notion shows both as though they were in
// force, so the table's own display is exactly the thing you can't trust.
//
// So this panel's job isn't to be a prettier table, it's to answer the two
// questions the table can't:
//
//  - **What is actually in force, and where did it come from?** Every setting
//    carries a source chip — Notion, environment, or the built-in default — and
//    an explicit callout when a configured value is being ignored. The server
//    resolves this the same way the app itself does, so the chip can't disagree
//    with the running code.
//  - **Which rows aren't settings at all?** A key nothing reads is listed at the
//    bottom with the setting it was probably meant to be. This panel is the only
//    place in the app where such a row is visible.
//
// Saving validates before writing, which is the difference between this and
// typing into Notion: there, a value the app can't use saves happily and is then
// ignored forever. The server owns those refusals and this renders them verbatim.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetStudioSettings,
  useSetStudioSetting,
  getGetStudioSettingsQueryKey,
  type StudioSetting,
  type SettingSource,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { serverErrorMessage } from "@/lib/api-error";
import { AlertTriangle, Loader2, SlidersHorizontal } from "lucide-react";

/** How each source reads to the atelier. The wording matters more than it looks:
 * "built-in default" has to be distinguishable from "nobody has set this", which
 * is why an unset setting still shows a source rather than an empty cell. */
const SOURCE_LABEL: Record<SettingSource, string> = {
  notion: "Notion",
  environment: "Environment",
  default: "Default",
};

const SOURCE_CLASS: Record<SettingSource, string> = {
  notion: "bg-primary/10 text-primary",
  environment: "bg-muted text-muted-foreground",
  default: "bg-muted text-muted-foreground",
};

export function StudioSettings() {
  const queryClient = useQueryClient();
  const settings = useGetStudioSettings({
    query: { queryKey: getGetStudioSettingsQueryKey(), retry: false },
  });

  const data = settings.data;
  const groups: Array<{ name: string; settings: StudioSetting[] }> = [];
  for (const setting of data?.settings ?? []) {
    const group = groups.find((candidate) => candidate.name === setting.group);
    if (group) group.settings.push(setting);
    else groups.push({ name: setting.group, settings: [setting] });
  }
  const unknown = data?.unknownRows ?? [];

  return (
    <section data-testid="panel-settings">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <SlidersHorizontal className="w-4 h-4" strokeWidth={1.5} />
        Studio settings
      </h2>

      {settings.isLoading ? (
        <div
          className="py-8 flex justify-center"
          data-testid="settings-loading"
        >
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : settings.isError || !data ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="settings-error"
        >
          {serverErrorMessage(settings.error) ??
            "We couldn't load the studio settings just now."}
        </p>
      ) : (
        <div className="space-y-8">
          {/* Not connected is a state only a human can clear, so it's said
              plainly rather than rendering an editor whose Save has nowhere to
              write. The values below are still real — they're just the
              environment's and the built-ins'. */}
          {!data.configured && (
            <p
              className="rounded border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground font-light"
              data-testid="settings-unconfigured"
            >
              No Studio Settings database is connected, so these can only be
              changed in the environment. Everything below shows what the app is
              using right now.
            </p>
          )}

          {groups.map((group) => (
            <div key={group.name} className="space-y-4">
              <h3 className="text-sm font-serif text-foreground">
                {group.name}
              </h3>
              <div className="space-y-4">
                {group.settings.map((setting) => (
                  <SettingRow
                    key={setting.key}
                    setting={setting}
                    editable={data.configured}
                    onSaved={() =>
                      queryClient.invalidateQueries({
                        queryKey: getGetStudioSettingsQueryKey(),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ))}

          {unknown.length > 0 && (
            <div className="space-y-2" data-testid="settings-unknown">
              <h3 className="text-sm font-serif text-foreground">
                Rows that aren&apos;t settings
              </h3>
              <p className="text-xs text-muted-foreground font-light">
                These rows are in the Studio Settings database but no part of
                the app reads them, so they have no effect at all.
              </p>
              <ul className="space-y-1.5">
                {unknown.map((row) => (
                  <li
                    key={row.key}
                    className="rounded border border-border/60 bg-muted/20 px-3 py-2 text-sm font-light"
                    data-testid={`settings-unknown-${row.key}`}
                  >
                    <span className="font-mono text-xs">{row.key}</span>
                    {row.suggestion && (
                      <span className="text-muted-foreground">
                        {" "}
                        — did you mean{" "}
                        <span className="font-mono text-xs">
                          {row.suggestion}
                        </span>
                        ?
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** What the app falls back to, phrased for a human. `defaultLabel` covers the
 * cases where the fallback isn't a value at all — an unset studio inbox means
 * the notification is skipped, not sent somewhere else. */
function defaultText(setting: StudioSetting): string {
  if (setting.defaultLabel) return setting.defaultLabel;
  return setting.defaultValue === "" ? "Not set" : setting.defaultValue;
}

/** What's in force, phrased the same way, so an unset setting reads as a state
 * rather than a blank. */
function effectiveText(setting: StudioSetting): string {
  return setting.effectiveValue === ""
    ? defaultText(setting)
    : setting.effectiveValue;
}

function SettingRow({
  setting,
  editable,
  onSaved,
}: {
  setting: StudioSetting;
  editable: boolean;
  onSaved: () => void;
}) {
  // The field starts from what Notion holds, NOT from the effective value: an
  // environment value shown in an editable box would be saved into Notion the
  // moment anyone pressed Save, silently moving where that setting lives.
  const [value, setValue] = useState(setting.notionValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useSetStudioSetting();

  const dirty = value !== (setting.notionValue ?? "");
  const isNumeric =
    setting.kind === "number" ||
    setting.kind === "integer" ||
    setting.kind === "percent" ||
    setting.kind === "money";

  const submit = () => {
    setError(null);
    save.mutate(
      { key: setting.key, data: { value } },
      {
        onSuccess: () => onSaved(),
        onError: (mutationError) =>
          setError(
            serverErrorMessage(mutationError) ??
              "We couldn't save that just now.",
          ),
      },
    );
  };

  return (
    <div
      className="rounded border border-border/60 p-3 sm:p-4"
      data-testid={`setting-${setting.key}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label
          htmlFor={`setting-input-${setting.key}`}
          className="text-sm text-foreground"
        >
          {setting.label}
        </Label>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] tracking-wide uppercase ${SOURCE_CLASS[setting.source]}`}
          data-testid={`setting-source-${setting.key}`}
        >
          {SOURCE_LABEL[setting.source]}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground font-light">
        {setting.description}
      </p>

      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs font-light text-muted-foreground">
        <div className="flex gap-1.5">
          <dt>In force:</dt>
          <dd
            className="text-foreground break-all"
            data-testid={`setting-effective-${setting.key}`}
          >
            {effectiveText(setting)}
            {setting.unit ? ` ${setting.unit}` : ""}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Default:</dt>
          <dd className="break-all">{defaultText(setting)}</dd>
        </div>
        {setting.envValue && (
          <div className="flex gap-1.5">
            <dt>Environment:</dt>
            <dd className="break-all">{setting.envValue}</dd>
          </div>
        )}
        <div className="flex gap-1.5">
          <dt className="sr-only">Key</dt>
          <dd className="font-mono text-[10px] opacity-70">{setting.key}</dd>
        </div>
      </dl>

      {/* The silent failure, made loud. A value is set, Notion looks normal, and
          the app is using the default instead. */}
      {setting.ignoredValue && (
        <p
          className="mt-2 flex items-start gap-1.5 text-xs text-destructive font-light"
          data-testid={`setting-ignored-${setting.key}`}
        >
          <AlertTriangle
            className="w-3.5 h-3.5 mt-0.5 shrink-0"
            strokeWidth={1.5}
          />
          <span>
            <span className="font-mono">{setting.ignoredValue}</span> isn&apos;t
            a value this setting can take, so the default is being used instead.
          </span>
        </p>
      )}

      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            id={`setting-input-${setting.key}`}
            type={isNumeric ? "number" : "text"}
            inputMode={isNumeric ? "decimal" : undefined}
            min={setting.min}
            max={setting.max}
            step={setting.step}
            value={value}
            placeholder={setting.placeholder ?? defaultText(setting)}
            onChange={(event) => setValue(event.target.value)}
            className="h-9 flex-1 min-w-[12rem] text-sm"
            data-testid={`setting-field-${setting.key}`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={submit}
            data-testid={`setting-save-${setting.key}`}
          >
            {save.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
            ) : (
              "Save"
            )}
          </Button>
          {/* Clearing is the undo: it hands the setting back to the environment
              or the built-in default, which is why it only shows when there is
              something stored to clear. */}
          {setting.notionValue !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={() => {
                setValue("");
                setError(null);
                save.mutate(
                  { key: setting.key, data: { value: "" } },
                  {
                    onSuccess: () => onSaved(),
                    onError: (mutationError) =>
                      setError(
                        serverErrorMessage(mutationError) ??
                          "We couldn't clear that just now.",
                      ),
                  },
                );
              }}
              className="text-muted-foreground"
              data-testid={`setting-clear-${setting.key}`}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {error && (
        <p
          className="mt-2 text-xs text-destructive font-light"
          data-testid={`setting-error-${setting.key}`}
        >
          {error}
        </p>
      )}
    </div>
  );
}
