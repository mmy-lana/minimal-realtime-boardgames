/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
// The JSX transform is automatic, but the ErrorBoundary cases call
// `React.useEffect` directly to prove a remount, which needs the binding.
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionEngine } from "@/engine/factory";

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
const { ErrorBoundary } = await import("@/components/primitives/ErrorBoundary");

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

  it("hydrates without a mismatch, whatever the server could not have known", () => {
    // The real regression: this component's answer depends on `navigator.onLine`
    // and on a channel that only exists in the browser, so the server renders
    // it without knowing the answer. If the first client render resolved that
    // answer eagerly, React would find markup it did not produce and throw the
    // tree away — which is what "Error in screenshot" was.
    //
    // `renderToString` stands in for the server render and `hydrateRoot` for
    // the client one, so this is the actual hydration path rather than a
    // render that happens to look similar.
    const serverMarkup = renderToString(
      <NetworkIndicator
        connection="connected"
        isOnline={false}
        pendingCount={3}
        syncState="pending_upload"
        showLabel
      />
    );

    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.appendChild(container);

    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    let root: ReturnType<typeof hydrateRoot> | null = null;
    try {
      act(() => {
        root = hydrateRoot(
          container,
          <NetworkIndicator
            connection="connected"
            isOnline={false}
            pendingCount={3}
            syncState="pending_upload"
            showLabel
          />
        );
      });
    } finally {
      console.error = originalError;
    }

    const hydrationFailures = errors.filter((args) =>
      String(args[0]).includes("did not match") ||
      String(args[0]).includes("Hydration")
    );
    expect(hydrationFailures).toEqual([]);

    // The placeholder the server emitted must not have claimed a status it
    // could not know, and the effect must have replaced it with the truth.
    expect(serverMarkup).not.toContain("Offline");
    expect(screen.getByText("Offline · 3 queued")).toBeDefined();

    act(() => root?.unmount());
    container.remove();
  });

  it("keeps the server markup free of a client-only answer", () => {
    // Belt and braces for the same defect: the rendered `title` and label have
    // to be identical on both sides of hydration, which means neither may be
    // derived from `navigator.onLine` before the first effect runs.
    const markup = renderToString(
      <NetworkIndicator connection="connected" isOnline pendingCount={0} syncState="synced" showLabel />
    );
    expect(markup).toContain("Checking…");
    expect(markup).not.toContain("Live");
  });
});

const { GameOverDialog } = await import("@/components/compound/GameOverDialog");
type Outcome = Parameters<typeof GameOverDialog>[0]["outcome"];

/** The dialog's accessible name, resolved the way a screen reader would. */
function dialogName(): string {
  const dialog = screen.getByRole("dialog");
  const id = dialog.getAttribute("aria-labelledby")!;
  return document.getElementById(id)?.textContent ?? "";
}

function renderResult(outcome: Outcome, mode: "offline_local" | "online_realtime", localSeat: "black" | "white" = "black") {
  return render(
    <GameOverDialog
      outcome={outcome}
      gameKind="tictactoe"
      mode={mode}
      localSeat={localSeat}
      onPlayAgain={() => {}}
      onBackToLobby={() => {}}
    />
  );
}

describe("GameOverDialog", () => {
  it("names the winning seat in a local match, not the reader", () => {
    // "You win" is true of both seats at a hot-seat table, so it identifies
    // nobody: the reader has to work out from the last move whether the words
    // were about them. The seat is named instead.
    for (const [winner, expected] of [
      ["black", "Player 1 (Black) Wins!"],
      ["white", "Player 2 (White) Wins!"],
    ] as const) {
      const { unmount } = renderResult({ kind: "win", winner }, "offline_local");
      expect(dialogName()).toBe(expected);
      expect(screen.getByText(`${winner === "black" ? "Player 1 (Black)" : "Player 2 (White)"} has won the game.`))
        .toBeTruthy();
      unmount();
    }
  });

  it("gives a local draw a headline and a body that both say so", () => {
    renderResult({ kind: "draw" }, "offline_local");
    expect(dialogName()).toBe("Match Drawn!");
    expect(screen.getByText("Neither player can claim victory.")).toBeTruthy();
  });

  it("names the seat and the colour in an online match", () => {
    const { unmount } = renderResult({ kind: "win", winner: "black" }, "online_realtime", "black");
    expect(dialogName()).toBe("Victory! You won as Black (Player 1)");
    unmount();

    renderResult({ kind: "win", winner: "white" }, "online_realtime", "black");
    expect(dialogName()).toBe("Defeat. Opponent won as White (Player 2)");
    cleanup();

    renderResult({ kind: "draw" }, "online_realtime");
    expect(dialogName()).toBe("Draw. The match ended in a tie.");
  });

  it("names both seats in an online body, so 'was that me' is answered in text", () => {
    // The headline names the winner. The body has to answer the other half of
    // the question — which seat the reader held — because across a network the
    // two players may have been looking at differently named boards, and
    // "Defeat" alone leaves the loser to recall it.
    const { unmount } = renderResult({ kind: "win", winner: "black" }, "online_realtime", "white");
    const loss = document.querySelector("p")!.textContent ?? "";
    expect(loss).toContain("Black (Player 1) has won");
    expect(loss).toContain("You played White (Player 2)");
    unmount();

    renderResult({ kind: "win", winner: "white" }, "online_realtime", "white");
    const win = document.querySelector("p")!.textContent ?? "";
    expect(win).toContain("White (Player 2) has won");
    expect(win).toContain("You played White (Player 2)");
    // Exactly two facts: the winner and the reader's seat. A third clause that
    // named "the seat you did not hold" would be false in the losing case,
    // because the loser is holding it.
    expect(win).not.toContain("did not hold");
    cleanup();
  });

  it("numbers Black as Player 1 in both modes", () => {
    // A result dialog that numbered players differently from the score cards
    // would introduce a second numbering at the exact moment a player is
    // trying to remember which one they were.
    const seen: string[] = [];
    for (const mode of ["offline_local", "online_realtime"] as const) {
      for (const winner of ["black", "white"] as const) {
        const { unmount } = renderResult({ kind: "win", winner }, mode, winner);
        seen.push(screen.getByRole("dialog").getAttribute("aria-labelledby")!.replace("-title", ""));
        expect(document.getElementById(seen[seen.length - 1]!)!.textContent).toContain(
          winner === "black" ? "Player 1" : "Player 2"
        );
        unmount();
      }
    }
    expect(seen).toHaveLength(4);
  });

  it("puts a disc in the winner's colour in the modal header", () => {
    const { unmount } = renderResult({ kind: "win", winner: "white" }, "online_realtime", "black");
    const badge = document.querySelector('[data-winner-badge="white"]') as HTMLElement;
    expect(badge).not.toBeNull();
    // The header strip, not the body: the result should be legible before the
    // body is read. The header is the ancestor that holds the <h2>.
    let node: HTMLElement | null = badge;
    while (node && !node.querySelector("h2")) node = node.parentElement;
    expect(node?.querySelector("h2")).not.toBeNull();
    expect(badge.closest("p")).toBeNull();
    // White is the pearl disc, black the jet one — the same treatment the
    // board uses, so a result screen and a mid-game board read alike.
    expect(badge.querySelector(".bg-white")).not.toBeNull();
    unmount();

    renderResult({ kind: "win", winner: "black" }, "online_realtime", "black");
    const black = document.querySelector('[data-winner-badge="black"]') as HTMLElement;
    expect(black.querySelector('[class*="radial-gradient"]')).not.toBeNull();
    expect(black.querySelector(".bg-white")).toBeNull();
  });

  it("keeps the badge out of the dialog's accessible name", () => {
    // The badge repeats what the title already says. Folding it into the
    // labelled element would announce "Black · Player 1 Black · Player 1" on
    // every result screen.
    renderResult({ kind: "win", winner: "black" }, "offline_local");
    const dialog = screen.getByRole("dialog");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    expect(title?.textContent).toBe("Player 1 (Black) Wins!");
    expect(dialog.getAttribute("aria-labelledby")).toBe(title?.id);
  });

  it("shows no winner badge on a draw or an abandoned match", () => {
    // A neutral grey disc would read as a result nobody won. Better to show
    // nothing than to imply a third outcome.
    for (const outcome of [{ kind: "draw" }, { kind: "abandoned" }] as Outcome[]) {
      const { unmount } = renderResult(outcome, "offline_local");
      expect(document.querySelector("[data-winner-badge]")).toBeNull();
      unmount();
    }
  });

  it("still offers reconciliation instead of a rematch when the copies disagree", () => {
    // A conflict is neither a win nor a loss, and replaying from a board
    // nobody can verify is the one thing this dialog must never offer.
    render(
      <GameOverDialog
        outcome={{ kind: "conflict", detail: "divergent" }}
        gameKind="hex"
        mode="online_realtime"
        localSeat="black"
        onRevalidate={() => {}}
        onPlayAgain={() => {}}
        onBackToLobby={() => {}}
        conflictDetail="Move 14 differs between the two copies."
      />
    );
    expect(screen.getByRole("button", { name: /re-check against server/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /play again/i })).toBeNull();
    expect(screen.getByText("Move 14 differs between the two copies.")).toBeTruthy();
    expect(document.querySelector("[data-winner-badge]")).toBeNull();
  });
});

describe("BoardTile target markers", () => {
  it("keeps a marker's utilities on the pseudo-element, not on the tile", () => {
    // `targetDotClass` is emitted verbatim, so a caller who writes a bare
    // `border-2` puts a real border on the tile — the one thing a tile may
    // never carry. The prefix is the caller's responsibility, which makes it a
    // promise the component cannot keep by itself, so the case is pinned here:
    // the well-formed overrides are clean, and the badly written one is caught.
    const cases: ReadonlyArray<readonly [string, string | undefined]> = [
      ["default", undefined],
      ["green dot", "after:bg-emerald-600/80"],
      ["ghost disc", "after:animate-pulse after:border-2 after:border-dashed"],
      ["bare border, as a caller might write it", "border-2"],
    ];
    for (const [label, targetDotClass] of cases) {
      const { unmount } = render(
        <BoardTile label="e4" onClick={() => {}} isLegalTarget targetDotClass={targetDotClass} />
      );
      const bare = (document.querySelector("[data-board-surface]") as HTMLElement)
        .className.split(/\s+/)
        .filter((token) => /^border(-\d|$)/.test(token));
      if (label.startsWith("bare")) expect(bare, "the test must be able to see the hazard").toEqual(["border-2"]);
      else expect(bare, `${label} marker must not put a border on the tile`).toEqual([]);
      unmount();
    }
  });

  it("keeps a view's marker honest by refusing one that would resize the tile", async () => {
    // The same hazard seen from the other end: a real board view is checked
    // against the same rule, so a marker added in Reversi or Hex cannot
    // quietly start taking a pixel from its neighbours.
    const { ReversiBoardView } = await import("@/components/boards/ReversiBoardView");
    const { HexBoardView } = await import("@/components/boards/HexBoardView");
    const boxModel = /^(border|w-|h-|size-|min-w-|min-h-|max-w-|max-h-|p|px|py|m|gap)-?/;
    for (const [name, kind, View] of [
      ["Reversi", "reversi", ReversiBoardView],
      ["Hex", "hex", HexBoardView],
    ] as const) {
      const { container, unmount } = render(
        <View
          board={getSessionEngine(kind).createInitialBoard()}
          selected={new Set<string>()}
          legalSquares={new Set(["0,0"])}
          selectableSquares={new Set<string>()}
          destinations={new Set(["0,0"])}
          lastMove={null}
          disabled={false}
          onSquareActivate={() => {}}
          label={`${name} board`}
          size="sm"
        />
      );
      // What matters is not the exact list — the size preset differs per view —
      // but that every tile agrees on it. A marker that added a border to one
      // square would show up as a tile that disagrees with its neighbours.
      const boxModels = new Set(
        [...container.querySelectorAll("[data-board-surface]")].map((tile) =>
          (tile as HTMLElement).className.split(/\s+/).filter((t) => boxModel.test(t)).sort().join(" ")
        )
      );
      expect(boxModels.size, `${name} tiles must all share one box model`).toBe(1);
      for (const model of boxModels) {
        expect(model.split(" ").filter((t) => t.startsWith("border")), `${name} must have no tile border`).toEqual([]);
      }
      unmount();
    }
  });
});

describe("Modal header accessory", () => {
  it("adorns the header without touching the accessible name", () => {
    // A result screen's badge repeats what the title already says. Inside the
    // labelled element it would be announced twice on every result dialog.
    render(
      <Modal
        open
        title="Player 1 (Black) Wins!"
        onClose={() => {}}
        headerAccessory={<span data-testid="badge">Black</span>}
      />
    );
    const dialog = screen.getByRole("dialog");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    expect(title?.textContent).toBe("Player 1 (Black) Wins!");
    expect(title?.querySelector("[data-testid='badge']")).toBeNull();
    expect(dialog.querySelector("[data-testid='badge']")).not.toBeNull();
  });
});

/**
 * REL-ERR-01 — the error boundary.
 *
 * Each case here is a way the app used to end up as a blank page. A render
 * that throws takes the whole tree with it, so on a page whose only job is
 * "pick a game and play" a single unreadable IndexedDB row meant a player
 * could not reach a single board, could not get back to the lobby, and had no
 * UI to report it from. The boundary is what makes the failure legible and
 * recoverable instead.
 */
describe("ErrorBoundary", () => {
  /**
   * A child whose failure is controlled by the test, not by its own execution.
   *
   * The first version of this fixture threw once and then rendered normally.
   * That does not work: React re-runs a failed render pass before it commits
   * an error to the boundary, so a child that only throws on its first call is
   * silently recovered and the boundary never sees anything. React does the
   * same thing to a genuinely transient fault, which is exactly why "Try
   * again" has to be proven by an explicit remount counter below rather than
   * by watching a throw stop happening on its own.
   */
  let shouldThrow = true;
  let mountCount = 0;

  function ControlledChild(): React.ReactElement {
    React.useEffect(() => {
      mountCount += 1;
      return () => {
        mountCount -= 1;
      };
    }, []);
    if (shouldThrow) throw new Error("indexeddb row is not a game");
    return <p>recovered content</p>;
  }

  /** Silences React's own error logging, which every throwing case provokes. */
  function withQuietConsole<T>(body: () => T): T {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      return body();
    } finally {
      spy.mockRestore();
    }
  }

  beforeEach(() => {
    shouldThrow = true;
    mountCount = 0;
  });

  it("renders its children untouched when nothing throws", () => {
    shouldThrow = false;
    render(
      <ErrorBoundary>
        <ControlledChild />
      </ErrorBoundary>
    );
    expect(screen.getByText("recovered content")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mountCount).toBe(1);
  });

  it("catches a render error and reports what happened", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallbackTitle="Could not load recent games">
        <ControlledChild />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Could not load recent games")).toBeTruthy();
    // The player is shown the actual failure, not merely that one occurred.
    expect(screen.getByText("indexeddb row is not a game")).toBeTruthy();
    // A swallowed error is a bug that will never be found; it must still log.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("re-mounts the subtree on 'Try again' rather than re-throwing", () => {
    withQuietConsole(() => {
      render(
        <ErrorBoundary>
          <ControlledChild />
        </ErrorBoundary>
      );
    });
    // The child threw on mount, so it never got to mount at all.
    expect(mountCount).toBe(0);
    expect(screen.queryByText("recovered content")).toBeNull();

    shouldThrow = false;
    withQuietConsole(() => {
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    });

    // A real remount: the effect ran, so this is a fresh instance and not a
    // re-render of a fiber that already failed. Clearing the error state alone
    // would re-render the same failed children and raise the same exception.
    expect(screen.getByText("recovered content")).toBeTruthy();
    expect(mountCount).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps reporting when the retry fails too", () => {
    withQuietConsole(() => {
      render(
        <ErrorBoundary>
          <ControlledChild />
        </ErrorBoundary>
      );
    });
    expect(screen.getByText("indexeddb row is not a game")).toBeTruthy();
    // Still broken: retrying must not silently drop the failure.
    withQuietConsole(() => {
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("indexeddb row is not a game")).toBeTruthy();
  });

  it("normalises a thrown non-Error into a readable message", () => {
    withQuietConsole(() => {
      function ThrowsString(): React.ReactElement {
        throw "a bare string, not an Error";
      }
      render(
        <ErrorBoundary>
          <ThrowsString />
        </ErrorBoundary>
      );
    });
    expect(screen.getByText("a bare string, not an Error")).toBeTruthy();
  });

  it("supports a custom fallback and hands it the error and a reset", () => {
    withQuietConsole(() => {
      render(
        <ErrorBoundary
          fallback={(error, reset) => (
            <div>
              <p>caught: {error.message}</p>
              <button type="button" onClick={reset}>
                retry
              </button>
            </div>
          )}
        >
          <ControlledChild />
        </ErrorBoundary>
      );
    });
    expect(screen.getByText("caught: indexeddb row is not a game")).toBeTruthy();

    shouldThrow = false;
    withQuietConsole(() => {
      fireEvent.click(screen.getByRole("button", { name: "retry" }));
    });
    expect(screen.getByText("recovered content")).toBeTruthy();
  });

  it("clears a caught error when its resetKeys change, so a new route retries", () => {
    // One boundary for the whole case: a second `render()` would leave the
    // first one's error card in the document and every later query would find
    // it instead of the one under test.
    const { rerender } = withQuietConsole(() =>
      render(
        <ErrorBoundary resetKeys={["game-a"]}>
          <ControlledChild />
        </ErrorBoundary>
      )
    );
    expect(screen.getByRole("alert")).toBeTruthy();

    // Same keys: the failure stands, because nothing has changed and re-running
    // it would only fail again.
    withQuietConsole(() => {
      rerender(
        <ErrorBoundary resetKeys={["game-a"]}>
          <ControlledChild />
        </ErrorBoundary>
      );
    });
    expect(screen.getByRole("alert")).toBeTruthy();

    // A new key: the boundary forgets the failure and tries again.
    shouldThrow = false;
    withQuietConsole(() => {
      rerender(
        <ErrorBoundary resetKeys={["game-b"]}>
          <ControlledChild />
        </ErrorBoundary>
      );
    });
    expect(screen.getByText("recovered content")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ErrorBoundary local data reset", () => {
  let shouldThrow = true;
  const reload = vi.fn();
  const realLocation = window.location;

  function BrokenChild(): React.ReactElement {
    if (shouldThrow) throw new Error("corrupt row");
    return <p>fine</p>;
  }

  beforeEach(() => {
    shouldThrow = true;
    reload.mockClear();
    // jsdom's `location.reload` is not implemented and not writable, so the
    // whole object is stood in for. The component reloads to escape a broken
    // state, and the test must observe that without a real navigation.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...realLocation, reload, assign: vi.fn(), replace: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: realLocation,
    });
  });

  function renderBroken(): void {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <BrokenChild />
        </ErrorBoundary>
      );
    } finally {
      spy.mockRestore();
    }
  }

  it("asks before deleting anything, because the action is irreversible", async () => {
    const { getLocalDb } = await import("@/lib/db");
    const { createGameSession } = await import("@/hooks/useGameSession");
    const deleteDatabase = vi.spyOn(indexedDB, "deleteDatabase");

    await getLocalDb().games.put(
      createGameSession({ id: "precious", gameKind: "hex", mode: "offline_local", playerBlackToken: "t" })
    );

    renderBroken();
    fireEvent.click(screen.getByRole("button", { name: /reset local data/i }));

    // First click only arms the action. A single tap on a phone must not be
    // able to destroy every game the player has.
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    // And the data is still there.
    expect(await getLocalDb().games.get("precious")).toBeDefined();
  });

  it("disarms without deleting when the player cancels", async () => {
    const deleteDatabase = vi.spyOn(indexedDB, "deleteDatabase");
    renderBroken();

    fireEvent.click(screen.getByRole("button", { name: /reset local data/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    // Back to the ordinary recovery affordance.
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("re-arms from scratch on a second first click", async () => {
    const deleteDatabase = vi.spyOn(indexedDB, "deleteDatabase");
    renderBroken();

    fireEvent.click(screen.getByRole("button", { name: /reset local data/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /reset local data/i }));

    // Confirmation is a fresh decision, not a latch left over from the last one.
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it("really deletes the stored games and reloads once confirmed", async () => {
    const { getLocalDb } = await import("@/lib/db");
    const { createGameSession } = await import("@/hooks/useGameSession");
    await getLocalDb().games.put(
      createGameSession({ id: "doomed", gameKind: "hex", mode: "offline_local", playerBlackToken: "t" })
    );
    expect(await getLocalDb().games.get("doomed")).toBeDefined();

    renderBroken();
    fireEvent.click(screen.getByRole("button", { name: /reset local data/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, delete my games/i }));

    // The escape hatch is the reload; the point of the button is what happened
    // before it.
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    // Checked through a fresh connection rather than the module singleton.
    // `delete()` closes that instance, so querying it again would raise
    // DatabaseClosedError — which is precisely why the handler reloads instead
    // of trying to carry on in this tab.
    const { MinimalBoardGamesDB, LOCAL_DB_NAME } = await import("@/lib/db");
    const reopened = new MinimalBoardGamesDB(LOCAL_DB_NAME);
    await reopened.open();
    expect(await reopened.games.toArray()).toEqual([]);
    await reopened.delete();
  });
});
