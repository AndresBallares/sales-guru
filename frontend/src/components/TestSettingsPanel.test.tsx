import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestSettingsPanel } from "./TestSettingsPanel";
import * as api from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    getTestSettings: vi.fn<typeof actual.getTestSettings>(),
    updateTestSettings: vi.fn<typeof actual.updateTestSettings>(),
  };
});
const mockedApi = vi.mocked(api);

function makeSettings(
  overrides: Partial<api.TestSettings> = {},
): api.TestSettings {
  return {
    dailyBudget: 100,
    minDailyBudget: 40,
    durationDays: 10,
    totalBudget: 1000,
    optimizationEvent: "PURCHASE",
    adCount: 4,
    advice: { recommended: null, reasons: [], pixelChecked: true },
    ...overrides,
  };
}

function renderPanel(published = false, onSaved = vi.fn<() => void>()) {
  render(
    <TestSettingsPanel
      businessId="biz-1"
      campaignId="camp-1"
      published={published}
      onSaved={onSaved}
    />,
  );
  return onSaved;
}

describe("TestSettingsPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders nothing when the campaign has no campaign-level settings", async () => {
    mockedApi.getTestSettings.mockRejectedValue(
      new api.ApiError(400, "no settings"),
    );
    renderPanel();
    await waitFor(() => expect(mockedApi.getTestSettings).toHaveBeenCalled());
    expect(screen.queryByLabelText(/daily budget/i)).not.toBeInTheDocument();
  });

  it("shows the budget, the minimum and the total", async () => {
    mockedApi.getTestSettings.mockResolvedValue(makeSettings());
    renderPanel();
    expect(await screen.findByLabelText(/daily budget/i)).toHaveValue(100);
    expect(screen.getByText(/at least \$40 for 4 ads/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,000 in total/i)).toBeInTheDocument();
  });

  it("shows the advice reasons and marks Add to Cart as suggested", async () => {
    mockedApi.getTestSettings.mockResolvedValue(
      makeSettings({
        advice: {
          recommended: "ADD_TO_CART",
          reasons: ["Too pricey."],
          pixelChecked: true,
        },
      }),
    );
    renderPanel();
    expect(await screen.findByText("Too pricey.")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /add to cart \(suggested\)/i }),
    ).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Purchase" })).toBeChecked();
  });

  it("blocks a budget under the minimum", async () => {
    mockedApi.getTestSettings.mockResolvedValue(makeSettings());
    renderPanel();
    const input = await screen.findByLabelText(/daily budget/i);
    await userEvent.clear(input);
    await userEvent.type(input, "30");
    expect(screen.getByRole("alert")).toHaveTextContent(/at least \$40/i);
    expect(
      screen.getByRole("button", { name: /save test settings/i }),
    ).toBeDisabled();
  });

  it("saves only what changed and tells the page", async () => {
    mockedApi.getTestSettings.mockResolvedValue(makeSettings());
    mockedApi.updateTestSettings.mockResolvedValue(
      makeSettings({ optimizationEvent: "ADD_TO_CART" }),
    );
    const onSaved = renderPanel();
    await userEvent.click(
      await screen.findByRole("radio", { name: "Add to Cart" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /save test settings/i }),
    );
    await waitFor(() =>
      expect(mockedApi.updateTestSettings).toHaveBeenCalledWith(
        "biz-1",
        "camp-1",
        {
          optimizationEvent: "ADD_TO_CART",
        },
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("shows the server error when saving fails", async () => {
    mockedApi.getTestSettings.mockResolvedValue(makeSettings());
    mockedApi.updateTestSettings.mockRejectedValue(
      new api.ApiError(422, "Budget too low."),
    );
    renderPanel();
    await userEvent.click(
      await screen.findByRole("radio", { name: "Add to Cart" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /save test settings/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Budget too low.",
    );
  });

  it("locks the controls once published", async () => {
    mockedApi.getTestSettings.mockResolvedValue(makeSettings());
    renderPanel(true);
    expect(await screen.findByLabelText(/daily budget/i)).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /save test settings/i }),
    ).not.toBeInTheDocument();
  });
});
