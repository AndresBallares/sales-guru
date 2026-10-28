import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  getTestSettings,
  updateTestSettings,
  type OptimizationEvent,
  type TestSettings,
} from "../lib/api";

interface TestSettingsPanelProps {
  businessId: string;
  campaignId: string;
  // Locks the controls once the campaign is on Meta.
  published: boolean;
  // Called after a save, so the page can pick up the campaign's new status.
  onSaved: () => void;
}

const EVENT_LABELS: Record<OptimizationEvent, string> = {
  PURCHASE: "Purchase",
  ADD_TO_CART: "Add to Cart",
};

function formatMoney(amount: number): string {
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

// A creative test's daily budget and conversion event. Renders nothing for a
// campaign without campaign-level settings (the backend answers 400/404).
export function TestSettingsPanel({
  businessId,
  campaignId,
  published,
  onSaved,
}: TestSettingsPanelProps) {
  const [settings, setSettings] = useState<TestSettings | null>(null);
  const [budget, setBudget] = useState("");
  const [event, setEvent] = useState<OptimizationEvent>("PURCHASE");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function adopt(next: TestSettings) {
    setSettings(next);
    setBudget(String(next.dailyBudget));
    setEvent(next.optimizationEvent);
  }

  useEffect(() => {
    let cancelled = false;
    getTestSettings(businessId, campaignId)
      .then((loaded) => {
        if (!cancelled) adopt(loaded);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, campaignId]);

  if (settings === null) return null;

  const parsedBudget = Number(budget);
  const budgetValid =
    budget.trim() !== "" && Number.isFinite(parsedBudget) && parsedBudget > 0;
  const belowMinimum = budgetValid && parsedBudget < settings.minDailyBudget;
  const dirty =
    parsedBudget !== settings.dailyBudget ||
    event !== settings.optimizationEvent;
  const total = budgetValid
    ? parsedBudget * settings.durationDays
    : settings.totalBudget;
  const { advice } = settings;

  async function handleSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    if (!budgetValid || belowMinimum || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      adopt(
        await updateTestSettings(businessId, campaignId, {
          ...(parsedBudget !== settings?.dailyBudget
            ? { dailyBudget: parsedBudget }
            : {}),
          ...(event !== settings?.optimizationEvent
            ? { optimizationEvent: event }
            : {}),
        }),
      );
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not save the test settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="test-budget-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="field">
        <label htmlFor="test-daily-budget">Daily budget ($)</label>
        <input
          id="test-daily-budget"
          type="number"
          inputMode="decimal"
          min={settings.minDailyBudget}
          step="1"
          value={budget}
          disabled={published || saving}
          onChange={(e) => setBudget(e.target.value)}
        />
        <p className="field-hint">
          At least {formatMoney(settings.minDailyBudget)} for {settings.adCount}{" "}
          ads ($10 each). Over {settings.durationDays} days that is{" "}
          {formatMoney(total)} in total.
        </p>
        {belowMinimum && (
          <p className="form-error" role="alert">
            The daily budget must be at least{" "}
            {formatMoney(settings.minDailyBudget)}.
          </p>
        )}
      </div>

      <fieldset className="test-event-group" disabled={published || saving}>
        <legend>Optimize for</legend>
        {(Object.keys(EVENT_LABELS) as OptimizationEvent[]).map((value) => (
          <label key={value} className="test-event-option">
            <input
              type="radio"
              name="test-optimization-event"
              value={value}
              checked={event === value}
              onChange={() => setEvent(value)}
            />
            {EVENT_LABELS[value]}
            {advice.recommended === value && " (suggested)"}
          </label>
        ))}
      </fieldset>

      {advice.reasons.length > 0 && (
        <div className="field-hint test-event-advice">
          <p>Add to Cart may suit this test better:</p>
          <ul>
            {advice.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {!advice.pixelChecked && (
        <p className="field-hint">
          Couldn&apos;t check your Pixel&apos;s recent Purchase events, so there
          is no advice based on them.
        </p>
      )}

      {!published && (
        <button
          type="submit"
          className="btn-outline test-settings-save"
          disabled={saving || !dirty || !budgetValid || belowMinimum}
        >
          {saving ? "Saving…" : "Save test settings"}
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
