/**
 * Tests for the empty-state "Generate full site" card. Covers:
 *   - It renders when composer has no sections (caller's job to gate)
 *   - Click on the primary button fires onGenerate
 *   - The advertised template/category counts come through accurately
 *   - The pointer-events overlay only blocks the card area (rest of the
 *     preview stays scrollable). Asserted by checking the outer wrapper
 *     is `pointer-events-none` and the card itself is `pointer-events-auto`.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyStateCard } from "@/components/composer/empty-state-card";

describe("EmptyStateCard", () => {
  it("renders the headline + section list + button", () => {
    render(
      <EmptyStateCard
        templateCount={25}
        categoryCount={11}
        onGenerate={() => {}}
      />,
    );
    expect(screen.getByText(/start with a full site/i)).toBeInTheDocument();
    // The 11 section types should be enumerated so the user knows what they
    // get without having to click first.
    expect(
      screen.getByText(/nav, hero, about, services, gallery/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /generate full site/i }),
    ).toBeInTheDocument();
  });

  it("shows the advertised counts in the helper line", () => {
    render(
      <EmptyStateCard
        templateCount={25}
        categoryCount={11}
        onGenerate={() => {}}
      />,
    );
    expect(screen.getByText(/25 templates/i)).toBeInTheDocument();
    expect(screen.getByText(/11 categories/i)).toBeInTheDocument();
  });

  it("clicking the button fires onGenerate exactly once", () => {
    const onGenerate = vi.fn();
    render(
      <EmptyStateCard
        templateCount={25}
        categoryCount={11}
        onGenerate={onGenerate}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /generate full site/i }),
    );
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("outer overlay is pointer-events-none, card is pointer-events-auto", () => {
    // The whole point of the layered pointer-events is that the card
    // intercepts clicks but the surrounding empty space lets the user
    // still interact with the iframe behind. Regression-guard this so
    // a future refactor doesn't accidentally make the whole overlay
    // capture clicks.
    const { container } = render(
      <EmptyStateCard
        templateCount={25}
        categoryCount={11}
        onGenerate={() => {}}
      />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toMatch(/pointer-events-none/);
    const card = outer.firstElementChild as HTMLElement;
    expect(card.className).toMatch(/pointer-events-auto/);
  });
});
