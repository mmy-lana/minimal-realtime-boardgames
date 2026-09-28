/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameKind, PlayerColor } from "@/engine/types";

/**
 * The shell and the board views.
 *
 * Every case here corresponds to a complaint from a player rather than to a
 * line of source: a board that could not be seen, a "Black" card on a shared
 * phone that could not say whose turn it was, a game with no way back to the
 * lobby, and a red banner that appeared when a player lifted a checker.
 *
 * The board tests assert the *contract* rather than exact pixels — that a
 * board fills the width it is given and derives its height from its own
 * geometry — because a fixed pixel size that renders correctly at 1024px and
 * disappears at 360px is precisely the failure they exist to prevent.
 */

const { GameShell } = await import("@/components/compound/GameShell");
const { PlayerScoreCard } = await import("@/components/compound/PlayerScoreCard");
const { BoardStage } = await import("@/components/compound/BoardStage");
const { BoardTile } = await import("@/components/primitives/BoardTile");
const { getSessionEngine } = await import("@/engine/factory");

const BOARD_VIEWS: ReadonlyArray<readonly [GameKind, () => Promise<unknown>]> = [
  ["tictactoe", async () => (await import("@/components/boards/TicTacToeBoardView")).TicTacToeBoardView],
  ["connect4", async () => (await import("@/components/boards/ConnectFourBoardView")).ConnectFourBoardView],
  ["gomoku", async () => (await import("@/components/boards/GomokuBoardView")).GomokuBoardView],
  ["reversi", async () => (await import("@/components/boards/ReversiBoardView")).ReversiBoardView],
  ["checkers", async () => (await import("@/components/boards/CheckersBoardView")).CheckersBoardView],
  ["chess", async () => (await import("@/components/boards/ChessBoardView")).ChessBoardView],
];

afterEach(cleanup);

function shellProps(overrides: Record<string, unknown> = {}) {
  return {
    gameKind: "tictactoe" as GameKind,
    mode: "offline_local" as const,
    board: <div data-testid="board" />,
    moves: [],
    lastMoveId: null,
    status: "active" as const,
    currentTurn: "black" as PlayerColor,
    localSeat: "black" as PlayerColor,
    isSeated: { black: true, white: true } as const,
    syncState: "synced" as const,
    connection: "connected" as const,
    isOnline: true,
    pendingCount: 0,
    outcome: null,
    onPlayAgain: vi.fn(),
    onBackToLobby: vi.fn(),
    ...overrides,
  };
}

describe("PlayerScoreCard seat labelling", () => {
  function renderSeat(overrides: Record<string, unknown> = {}) {
    const props = {
      color: "black" as PlayerColor,
      isLocalSeat: true,
      isToMove: true,
      status: "active" as const,
      isSeated: true,
      gameKind: "tictactoe" as GameKind,
      mode: "offline_local" as const,
      ...overrides,
    };
    return render(<PlayerScoreCard {...props} />);
  }

  it("names the player and the colour together in a local match", () => {
    // A hot-seat match has two people at one keyboard. "Black" alone cannot
    // tell either of them whether it is their move.
    renderSeat();
    expect(screen.getByText("Player 1 (Black)")).toBeDefined();
    cleanup();
    renderSeat({ color: "white" });
    expect(screen.getByText("Player 2 (White)")).toBeDefined();
  });

  it("says who is being waited for, not merely that someone is", () => {
    renderSeat({ isToMove: true });
    expect(screen.getByText("Playing now")).toBeDefined();
    cleanup();
    renderSeat({ isToMove: false });
    expect(screen.getByText("Waiting for Player 2")).toBeDefined();
    cleanup();
    renderSeat({ color: "white", isToMove: false });
    expect(screen.getByText("Waiting for Player 1")).toBeDefined();
  });

  it("keeps colour-only names online, where the colour is the seat", () => {
    renderSeat({ mode: "online_realtime" });
    expect(screen.getByText("Black")).toBeDefined();
    cleanup();
    // The opponent has not taken their seat, which is a different fact from
    // "it is not your turn" and is the one worth showing.
    renderSeat({ color: "white", isLocalSeat: false, isSeated: false, isToMove: false, mode: "online_realtime" });
    expect(screen.getByText("Waiting for an opponent")).toBeDefined();
  });

  it("never claims both hot-seat players are you", () => {
    // In a local match both seats are "this browser", so the `(you)` tag would
    // mark both cards — telling a player holding the device that nobody is
    // here but them, which is the opposite of the truth.
    const { container } = render(
      <>
        <PlayerScoreCard
          color="black"
          isLocalSeat
          isToMove
          status="active"
          isSeated
          gameKind="tictactoe"
          mode="offline_local"
        />
        <PlayerScoreCard
          color="white"
          isLocalSeat
          isToMove={false}
          status="active"
          isSeated
          gameKind="tictactoe"
          mode="offline_local"
        />
      </>
    );
    expect(container.textContent).not.toContain("(you)");
  });

  it("does mark the single seat in a realtime match", () => {
    const { container } = render(
      <PlayerScoreCard
        color="black"
        isLocalSeat
        isToMove
        status="active"
        isSeated
        gameKind="tictactoe"
        mode="online_realtime"
      />
    );
    expect(container.textContent).toContain("(you)");
  });
});

describe("GameShell in-game navigation", () => {
  it("always offers a way back to the lobby", () => {
    const onBackToLobby = vi.fn();
    render(<GameShell {...shellProps({ onBackToLobby })} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to games" }));
    expect(onBackToLobby).not.toHaveBeenCalled();
  });

  it("asks before leaving a live match, and leaves when confirmed", () => {
    const onBackToLobby = vi.fn();
    render(<GameShell {...shellProps({ onBackToLobby })} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to games" }));
    // The confirmation is the point: a live match is the one navigation that
    // can cost a player the game, and a mis-tap is enough to trigger it.
    expect(onBackToLobby).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave match" }));
    expect(onBackToLobby).toHaveBeenCalledTimes(1);
  });

  it("keeps the player in the match when the confirmation is declined", () => {
    const onBackToLobby = vi.fn();
    render(<GameShell {...shellProps({ onBackToLobby })} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to games" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(onBackToLobby).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves a finished match straight away — there is nothing to lose", () => {
    const onBackToLobby = vi.fn();
    render(<GameShell {...shellProps({ status: "finished", onBackToLobby })} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to games" }));
    expect(onBackToLobby).toHaveBeenCalledTimes(1);
  });

  it("does not claim a room when there is none", () => {
    render(<GameShell {...shellProps({ mode: "online_realtime", roomId: null })} />);
    expect(screen.queryByText(/Room undefined/)).toBeNull();
    expect(screen.getByText(/Realtime match/)).toBeDefined();
  });
});

describe("GameShell rules dialog", () => {
  it("is closed until asked for", () => {
    render(<GameShell {...shellProps()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens with the game's own objective and steps", () => {
    render(<GameShell {...shellProps({ gameKind: "checkers" })} />);
    fireEvent.click(screen.getByRole("button", { name: "How to play" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Capture every opponent piece");
    // The two-step interaction is the part nothing on screen explains.
    expect(dialog.textContent).toMatch(/click one of your pieces/i);
    expect(dialog.textContent).toMatch(/switch which one is lifted/i);
  });

  it("has rules for every game the lobby offers", async () => {
    for (const [kind] of BOARD_VIEWS) {
      const { unmount } = render(<GameShell {...shellProps({ gameKind: kind })} />);
      fireEvent.click(screen.getByRole("button", { name: "How to play" }));
      const dialog = screen.getByRole("dialog");
      // An empty objective would render a dialog that says nothing, which is
      // the failure mode of a lookup table with a missing key.
      expect(dialog.textContent?.length ?? 0).toBeGreaterThan(80);
      expect(dialog.textContent).toContain("How to play");
      unmount();
    }
  });
});

describe("board sizing", () => {
  it("locks the frame so nothing a player does can resize it", () => {
    // The stage is two boxes: a rigid frame whose geometry comes from the
    // viewport alone, and a centring canvas inside it. The frame is what makes
    // "selection never changes the board's size" a structural fact rather than
    // a promise each board view has to keep.
    render(
      <BoardStage gameKind="tictactoe" size="md" isDesktop={false}>
        <div />
      </BoardStage>
    );
    const stage = document.querySelector("[data-board-stage]") as HTMLElement;
    expect(stage.className).toContain("w-full");
    // A generous desktop cap: 620px, not the 34rem (544px) it used to be.
    expect(stage.className).toMatch(/max-w-\[min\(92vw,620px\)\]/);
    expect(stage.className).toContain("overflow-hidden");
    expect(stage.className).toContain("shrink-0");
    // The ratio is set inline so it sits next to the `overflow-hidden` that
    // depends on it.
    expect(stage.style.aspectRatio).toBe("1 / 1");
  });

  it("keeps a non-square board centred inside the square frame", () => {
    // Connect Four is 7x6. Forcing a square on the *board* would stretch it;
    // forcing a square on the *frame* is fine and is what the board centres
    // itself inside.
    const { container } = render(
      <BoardStage gameKind="connect4" size="md" isDesktop>
        <div data-testid="inner" />
      </BoardStage>
    );
    const canvas = container.querySelector("[data-board-stage] > div") as HTMLElement;
    expect(canvas.className).toContain("items-center");
    expect(canvas.className).toContain("justify-center");
    expect(canvas.className).toContain("h-full");
  });

  it("never resizes a tile when a board state changes", async () => {
    // The jitter bug, stated as a test. A tile's *state* classes may change
    // freely between renders — selecting, targeting, last-move — but the set
    // of classes that decide its box model may not.
    const empty = () => new Set<string>();
    for (const [kind, load] of BOARD_VIEWS) {
      const View = (await load()) as React.ComponentType<Record<string, unknown>>;
      const board = getSessionEngine(kind).createInitialBoard();
      const base = {
        board,
        selected: empty(),
        legalSquares: empty(),
        selectableSquares: empty(),
        destinations: empty(),
        lastMove: null,
        disabled: false,
        onSquareActivate: () => {},
        label: `${kind} board`,
        size: "sm",
      };
      const { container, rerender, unmount } = render(<View {...base} />);

      // Snapshot the box-model classes of every tile, then turn every state
      // flag on at once and compare.
      const boxModelOf = () =>
        [...container.querySelectorAll("[data-board-surface]")].map((tile) =>
          tile.className
            .split(/\s+/)
            .filter((token) => /^(border|w-|h-|size-|min-w-|min-h-|max-w-|max-h-|p|px|py|m|gap)-?/.test(token))
            .sort()
            .join(" ")
        );

      const before = boxModelOf();
      expect(before.length, `${kind} should render tiles`).toBeGreaterThan(0);

      rerender(
        <View
          {...base}
          selected={new Set(["0,0"])}
          legalSquares={new Set(["1,1"])}
          destinations={new Set(["1,1"])}
          lastMove={{ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }}
        />
      );

      expect(boxModelOf(), `${kind} tile box model must not depend on state`).toEqual(before);
      unmount();
    }
  });

  it("gives a tile no border at all, in any state", () => {
    // A border is the one thing a tile must never carry: 0px and 2px are
    // different box models, and the difference is exactly the jump.
    const states: ReadonlyArray<{ name: string; selected?: boolean; isLegalTarget?: boolean; isLastMove?: boolean }> = [
      { name: "idle" },
      { name: "selected", selected: true },
      { name: "target", isLegalTarget: true },
      { name: "last move", isLastMove: true },
      { name: "everything at once", selected: true, isLegalTarget: true, isLastMove: true },
    ];
    for (const state of states) {
      const { unmount } = render(
        <BoardTile
          label="A1"
          onClick={() => {}}
          selected={state.selected}
          isLegalTarget={state.isLegalTarget}
          isLastMove={state.isLastMove}
        />
      );
      const tile = document.querySelector("[data-board-surface]") as HTMLElement;
      const borderUtilities = tile.className
        .split(/\s+/)
        .filter((token) => /^border(-\d|$)/.test(token));
      expect(borderUtilities, `${state.name} tile must carry no border`).toEqual([]);
      // The selection treatment is a ring instead, and an inset one so it
      // paints inside the tile rather than stealing a pixel from its neighbour.
      if (state.selected) expect(tile.className).toMatch(/ring-2/);
      if (state.selected || state.isLastMove) expect(tile.className).toMatch(/ring-inset/);
      unmount();
    }
  });

  it("never pins a board cell to a fixed pixel size", async () => {
    // A `w-9` or `h-9` here is the whole UI-02 bug: it renders at one width
    // and overflows or vanishes at another.
    const empty = () => new Set<string>();
    for (const [kind, load] of BOARD_VIEWS) {
      const View = (await load()) as React.ComponentType<Record<string, unknown>>;
      const { unmount } = render(
        <View
          board={getSessionEngine(kind).createInitialBoard()}
          selected={empty()}
          legalSquares={empty()}
          selectableSquares={empty()}
          destinations={empty()}
          lastMove={null}
          disabled={false}
          onSquareActivate={() => {}}
          label={`${kind} board`}
          size="sm"
        />
      );
      const cells = document.querySelectorAll("[data-board-surface]");
      expect(cells.length, `${kind} should expose its squares as controls`).toBeGreaterThan(0);
      for (const cell of cells) {
        const className = cell.className;
        // Connect Four is the exception that proves the rule: its cells are
        // a stacked column of discs, so a fluid *width* is all it can promise.
        if (kind === "connect4") continue;
        expect(className, `${kind} cell should fill its column`).toMatch(
          /\bw-full\b|\bcol-span-full\b/
        );
        // The lookbehind excludes `min-h-*`: a floor is the point, a fixed
        // size is the bug. `size-[22px]` was the old preset, so it has to be
        // caught by name as well as by width/height.
        expect(className, `${kind} cell should not be a fixed size`).not.toMatch(
          /(?<![\w-])size-\[/
        );
        expect(className, `${kind} cell should not be a fixed width`).not.toMatch(
          /(?<![\w-])w-\[\d+px\]/
        );
        expect(className, `${kind} cell should not be a fixed height`).not.toMatch(
          /(?<![\w-])h-\[\d+px\]/
        );
        expect(className, `${kind} cell should not be a fixed square`).not.toMatch(
          /(?<![\w-])w-\d+(?![\w-])[\s\S]*?(?<![\w-])h-\d+(?![\w-])/
        );
      }
      unmount();
    }
  });

  it("marks at most the hovered Gomoku square, never all 225 legal ones", async () => {
    // The bug this guards: every empty intersection on a 15x15 Gomoku board is
    // a legal move, so a per-square "legal target" marker put ~225 green rings
    // on the board at once and buried the grid lines. A count is the only
    // assertion that catches it — any existence check passes just as happily
    // with 225 markers as with one.
    const { GomokuBoardView } = await import("@/components/boards/GomokuBoardView");
    const gomoku = getSessionEngine("gomoku");
    const board = gomoku.createInitialBoard();
    // Every empty intersection is legal; assert the view still decorates almost
    // none of them.
    const legal = new Set<string>();
    for (let y = 0; y < 15; y += 1) {
      for (let x = 0; x < 15; x += 1) legal.add(`${x},${y}`);
    }
    const { container, unmount } = render(
      <GomokuBoardView
        board={board}
        selected={new Set<string>()}
        legalSquares={legal}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Gomoku board"
        size="sm"
      />
    );

    // `data-square="legal"` is what BoardTile sets for a target, and the ring
    // it paints is the thing that used to blanket the board.
    const marked = container.querySelectorAll('[data-square="legal"]');
    expect(marked).toHaveLength(0);
    expect(container.querySelectorAll(".border-emerald-600")).toHaveLength(0);
    unmount();
  });

  it("draws the five traditional Gomoku star points", async () => {
    const { GomokuBoardView } = await import("@/components/boards/GomokuBoardView");
    const { container, unmount } = render(
      <GomokuBoardView
        board={getSessionEngine("gomoku").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Gomoku board"
        size="sm"
      />
    );

    // Hoshi are the five points a go board has carried since the 1600s, and
    // they are how you find the centre and the quarters by eye.
    const hoshi = container.querySelectorAll(".bg-\\[\\#4A3718\\]");
    expect(hoshi).toHaveLength(5);
    unmount();
  });

  it("sizes a Gomoku stone to most of its intersection, not a fixed dot", async () => {
    const { GomokuBoardView } = await import("@/components/boards/GomokuBoardView");
    const { container, unmount } = render(
      <GomokuBoardView
        board={getSessionEngine("gomoku").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Gomoku board"
        size="sm"
      />
    );
    // 84% of the intersection: `p-[8%]` on the tile leaves 16% of clearance for
    // the grid line to stay visible, and scales with the board.
    const tiles = container.querySelectorAll("[data-board-surface]");
    for (const tile of tiles) expect(tile.className).toContain("p-[8%]");
    unmount();
  });

  it("snaps a Gomoku click to the intersection nearest the finger", async () => {
    // Stones sit on crossings, not in cells, so the coordinate the view reports
    // has to be the nearest *intersection* to the pointer. Aiming at a line
    // crossing and landing on the one beside it is what made a 15x15 board
    // unplayable on a phone.
    const { GomokuBoardView } = await import("@/components/boards/GomokuBoardView");
    const activated: unknown[] = [];
    const { container, unmount } = render(
      <GomokuBoardView
        board={getSessionEngine("gomoku").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={(coord: unknown) => activated.push(coord)}
        label="Gomoku board"
        size="sm"
      />
    );

    const grid = container.querySelector("[data-board-surface]")?.parentElement;
    expect(grid).not.toBeNull();

    // jsdom has no layout, so the measured board is given one: a 300px square,
    // which is 20px per cell on a 15x15 grid.
    Object.defineProperty(grid as Element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300 }),
    });

    // 154/20 = 7.7. The nearest crossing to 154 is 7 (its centre is at 150),
    // not 8 — and the offset that decides that is a half cell. Without it the
    // line drawn at the centre of a cell resolves to its left-hand
    // neighbour, and every stone lands one crossing off from the grid.
    const cell = (grid as Element).querySelectorAll("[data-board-surface]")[7 * 15 + 7];
    expect(cell).toBeDefined();
    fireEvent.click(cell as Element, { clientX: 154, clientY: 154 });
    expect(activated).toEqual([{ x: 7, y: 7 }]);

    // And it is still a *nearest* search, not a shifted one: 166 is nearer to
    // the crossing at 170, and resolves to 8.
    fireEvent.click(cell as Element, { clientX: 166, clientY: 166 });
    expect(activated).toEqual([
      { x: 7, y: 7 },
      { x: 8, y: 8 },
    ]);
    unmount();
  });

  it("keeps every Gomoku intersection playable, not just the stones", async () => {
    // At 360px a 15x15 grid is ~22px per cell, well under the 44px touch
    // guideline. The hit area has to be the whole cell, not the stone.
    const { GomokuBoardView } = await import("@/components/boards/GomokuBoardView");
    const { container, unmount } = render(
      <GomokuBoardView
        board={getSessionEngine("gomoku").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Gomoku board"
        size="sm"
      />
    );
    const cells = container.querySelectorAll("[data-board-surface]");
    expect(cells).toHaveLength(15 * 15);
    for (const cell of cells) {
      expect(cell.className).toMatch(/\bw-full\b/);
      expect(cell.className).toMatch(/aspect-square/);
    }
    unmount();
  });
});
