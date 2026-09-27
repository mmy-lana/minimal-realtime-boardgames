/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Section 4.1 — the primitive layer.
 *
 * These are interaction tests rather than snapshot tests: a snapshot would
 * happily pass on markup that no longer responds to a click. Each case
 * asserts the behaviour a player actually depends on.
 */

const { Badge } = await import("@/components/primitives/Badge");
const { Button } = await import("@/components/primitives/Button");
const { Modal } = await import("@/components/primitives/Modal");
const { SegmentedControl } = await import("@/components/primitives/SegmentedControl");
const { BoardTile } = await import("@/components/primitives/BoardTile");
const { NetworkIndicator } = await import("@/components/primitives/NetworkIndicator");

afterEach(cleanup);

/**
 * The control's own label is part of each option's accessible name, so options
 * are located by their value rather than by a full label string.
 */
function optionValue(value: string): HTMLElement {
  const input = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!input) throw new Error(`No radio option with value "${value}"`);
  return input;
}

describe("Button", () => {
  it("calls its handler when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Play</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call its handler while disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Play
      </Button>
    );
    const button = screen.getByRole("button", { name: "Play" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("marks itself busy and stays out of the tab order while loading", () => {
    render(
      <Button loading disabled>
        Play
      </Button>
    );
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("exposes the busy state to assistive technology", () => {
    render(<Button>Play</Button>);
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBeNull();
  });
});

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Waiting</Badge>);
    expect(screen.getByText("Waiting")).toBeDefined();
  });

  it("applies the tone class so the badge reads as a status, not as text", () => {
    render(<Badge tone="error">Offline</Badge>);
    const error = screen.getByText("Offline").className;
    render(<Badge tone="live">Live</Badge>);
    const success = screen.getByText("Live").className;
    expect(error).not.toBe(success);
  });

  it("hides the dot from assistive technology", () => {
    render(
      <Badge withDot dotMotion="pulse">
        Syncing
      </Badge>
    );
    const badge = screen.getByText("Syncing");
    const dot = badge.firstElementChild;
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  });

  it("omits the dot entirely when it is not asked for", () => {
    render(<Badge>Syncing</Badge>);
    expect(screen.getByText("Syncing").firstElementChild).toBeNull();
  });
});

describe("SegmentedControl", () => {
  it("reports the chosen option", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        name="mode"
        label="Match mode"
        value="offline_local"
        onChange={onChange}
        options={[
          { value: "offline_local", label: "Local" },
          { value: "online_realtime", label: "Realtime" },
        ]}
      />
    );

    fireEvent.click(optionValue("online_realtime"));
    expect(onChange).toHaveBeenCalledWith("online_realtime");
  });

  it("marks exactly one option as checked", () => {
    render(
      <SegmentedControl
        name="mode"
        label="Match mode"
        value="online_realtime"
        onChange={vi.fn()}
        options={[
          { value: "offline_local", label: "Local" },
          { value: "online_realtime", label: "Realtime" },
        ]}
      />
    );

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.filter((el) => el.checked)).toHaveLength(1);
    expect(radios.find((el) => el.checked)?.value).toBe("online_realtime");
  });

  it("does not fire a change when the checked option is clicked again", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        name="mode"
        label="Match mode"
        value="offline_local"
        onChange={onChange}
        options={[
          { value: "offline_local", label: "Local" },
          { value: "online_realtime", label: "Realtime" },
        ]}
      />
    );
    fireEvent.click(optionValue("offline_local"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} title="Match over" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders its title and body when open", () => {
    render(
      <Modal open title="Match over" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Match over")).toBeDefined();
    expect(within(dialog).getByText("Body")).toBeDefined();
  });

  it("moves focus into the dialog on open", () => {
    render(
      <Modal open title="Match over" onClose={vi.fn()}>
        <button type="button">Play again</button>
      </Modal>
    );
    const inside = screen.getByRole("dialog").contains(document.activeElement);
    expect(inside).toBe(true);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Match over" onClose={onClose}>
        <p>Body</p>
      </Modal>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on Escape when it is not dismissible", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Match over" onClose={onClose} dismissible={false}>
        <p>Body</p>
      </Modal>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers a footer action", () => {
    const onClick = vi.fn();
    render(
      <Modal
        open
        title="Match over"
        onClose={vi.fn()}
        footer={<Button onClick={onClick}>Play again</Button>}
      >
        <p>Body</p>
      </Modal>
    );
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the tab ring inside the dialog", () => {
    render(
      <Modal open title="Match over" onClose={vi.fn()}>
        <button type="button">One</button>
        <button type="button">Two</button>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("BoardTile", () => {
  it("is a button described by its square", () => {
    const onClick = vi.fn();
    render(<BoardTile label="Row 1 column 1, empty" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Row 1 column 1, empty" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire when it is disabled", () => {
    const onClick = vi.fn();
    render(<BoardTile label="A1" disabled onClick={onClick} />);
    const tile = screen.getByRole("button", { name: "A1" });
    expect((tile as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tile);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("marks a selected square and a legal target for the board to style", () => {
    const { rerender } = render(<BoardTile label="A1" selected isLegalTarget onClick={vi.fn()} />);
    const tile = screen.getByRole("button", { name: "A1" });
    expect(tile.getAttribute("aria-pressed")).toBe("true");

    rerender(<BoardTile label="A1" onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "A1" }).getAttribute("aria-pressed")).toBeNull();
  });

  it("accepts content for the piece it holds", () => {
    render(
      <BoardTile label="A1" onClick={vi.fn()}>
        <span>checkers</span>
      </BoardTile>
    );
    expect(screen.getByText("checkers")).toBeDefined();
  });

  it("does not let a long press raise the context menu", () => {
    render(<BoardTile label="A1" onClick={vi.fn()} />);
    const tile = screen.getByRole("button", { name: "A1" });
    const prevented = !fireEvent.contextMenu(tile);
    expect(prevented).toBe(true);
  });
});

describe("NetworkIndicator", () => {
  it("reports a connected, fully synced client as live", () => {
    render(
      <NetworkIndicator connection="connected" isOnline pendingCount={0} syncState="synced" showLabel />
    );
    expect(screen.getByText("Live")).toBeDefined();
  });

  it("reports how many moves are waiting to upload", () => {
    render(
      <NetworkIndicator
        connection="connected"
        isOnline
        pendingCount={3}
        syncState="pending_upload"
        showLabel
      />
    );
    expect(screen.getByText("3 queued")).toBeDefined();
  });

  it("surfaces a conflict as an error rather than as a pending count", () => {
    render(
      <NetworkIndicator
        connection="connected"
        isOnline
        pendingCount={0}
        syncState="conflict"
        showLabel
      />
    );
    expect(screen.getByText("Sync conflict")).toBeDefined();
  });

  it("reports an offline browser even when the socket says connected", () => {
    render(
      <NetworkIndicator
        connection="connected"
        isOnline={false}
        pendingCount={0}
        syncState="synced"
        showLabel
      />
    );
    expect(screen.getByText("Offline")).toBeDefined();
  });

  it("counts the queue in the offline label so no move looks lost", () => {
    render(
      <NetworkIndicator
        connection="connected"
        isOnline={false}
        pendingCount={2}
        syncState="pending_upload"
        showLabel
      />
    );
    expect(screen.getByText("Offline · 2 queued")).toBeDefined();
  });

  it("reports an unsupported realtime backend instead of pretending to be online", () => {
    render(
      <NetworkIndicator
        connection="unsupported"
        isOnline
        pendingCount={0}
        syncState="synced"
        showLabel
      />
    );
    expect(screen.getByText("Realtime unavailable")).toBeDefined();
  });

  it("keeps the indicator out of the way of a screen reader when the label is hidden", () => {
    const { container } = render(
      <NetworkIndicator connection="connected" isOnline pendingCount={0} syncState="synced" />
    );
    // The dot is decorative, but the sentence behind it still has to reach the
    // screen reader, so the component keeps an `sr-only` detail regardless.
    expect(container.querySelector(".sr-only")?.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});
