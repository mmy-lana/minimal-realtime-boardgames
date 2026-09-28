/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Coordinates, GameKind, PlayerColor } from "@/engine/types";
import { coordKey } from "@/components/boards/boardViewTypes";

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
  ["hex", async () => (await import("@/components/boards/HexBoardView")).HexBoardView],
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

describe("GameShell board review", () => {
  const wonMatch = {
    outcome: { kind: "win", winner: "black" } as const,
    status: "won_black" as const,
  };

  /**
   * The shell already keeps a live region for the connection, so `getByRole
   * ("status")` is ambiguous here and the banner has to be found by its
   * sentence — the thing a player actually reads.
   */
  const HIGHLIGHTED = "The winning line is highlighted on the board.";
  const NO_LINE = "This match is over. Review the board or the move list below.";

  function bannerSentence(): HTMLElement {
    // Exact text and an element that is the sentence itself. Matching on
    // "contains" instead would also find the shell's own connection status,
    // whose direct text is empty and therefore contained by everything.
    return screen.getByText(
      (content, element) =>
        element?.tagName === "SPAN" &&
        element.getAttribute("role") === "status" &&
        (content === NO_LINE || content === HIGHLIGHTED)
    );
  }

  function bannerText(): string {
    return bannerSentence().textContent ?? "";
  }

  function dismissOutcome(): void {
    // The shell always passes an `onClose`, so a decided match offers "Inspect
    // board" and, being dismissible, the modal's own close button too. Either
    // route means the same thing to the shell.
    const inspect = screen.queryByRole("button", { name: /inspect board/i });
    fireEvent.click(inspect ?? screen.getByRole("button", { name: /^close /i }));
  }

  it("puts the result away and offers it back in place", () => {
    // The complaint: the result dialog covered the board the moment a match
    // ended, and dismissing it left no way back. The board stays put, the
    // result goes behind it, and a banner on the board offers it again.
    const { unmount } = render(<GameShell {...shellProps({ ...wonMatch, hasWinningLine: true })} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    dismissOutcome();
    expect(screen.queryByRole("dialog")).toBeNull();

    expect(bannerText()).toBe(HIGHLIGHTED);

    fireEvent.click(screen.getByRole("button", { name: /view match result/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    unmount();
  });

  it("does not put the result back when the board merely re-renders", () => {
    // Every acknowledgement from the sync queue hands the shell a new outcome
    // object for the same finished match. Keyed on the object rather than on
    // what it says, the dialog would re-open over the board the player had just
    // asked to look at — the exact thing the button was for.
    const { rerender, unmount } = render(
      <GameShell {...shellProps({ ...wonMatch, hasWinningLine: true })} />
    );
    dismissOutcome();
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <GameShell
        {...shellProps({
          ...wonMatch,
          hasWinningLine: true,
          // A new object, the same result: what an acknowledgement delivers.
          outcome: { kind: "win", winner: "black" },
          pendingCount: 0,
        })}
      />
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /view match result/i })).toBeTruthy();
    unmount();
  });

  it("re-opens for a different result", () => {
    // The banner must not become a one-way door: a *different* outcome is a
    // new piece of news, and it is the case the effect is actually for.
    const { rerender, unmount } = render(
      <GameShell {...shellProps({ ...wonMatch, hasWinningLine: true })} />
    );
    dismissOutcome();

    rerender(
      <GameShell
        {...shellProps({
          outcome: { kind: "conflict", detail: "divergent" },
          status: "active" as const,
          conflictDetail: "Move 14 differs between the two copies.",
          onRevalidate: vi.fn(),
        })}
      />
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    unmount();
  });

  it("claims a highlight on the board only for an outcome that has one", () => {
    // Three finished matches, one highlight. A draw and a resignation have no
    // line to point at, and a green box around "this match is over" would be
    // promising a highlight the board is not drawing.
    for (const [outcome, hasWinningLine, expected] of [
      [{ kind: "draw" }, false, NO_LINE],
      [{ kind: "abandoned" }, false, NO_LINE],
      [{ kind: "win", winner: "black" }, true, HIGHLIGHTED],
    ] as ReadonlyArray<readonly [Record<string, unknown>, boolean, string]>) {
      const { unmount } = render(
        <GameShell {...shellProps({ outcome, status: "won_black" as const, hasWinningLine })} />
      );
      dismissOutcome();
      expect(screen.queryByRole("dialog")).toBeNull();

      const sentence = bannerSentence();
      expect(sentence.textContent).toBe(expected);
      // Green is the colour of a line on the board, so the green wash goes in
      // with the line and never without it.
      const banner = sentence.closest("div")!;
      const wantsGreen = expected === HIGHLIGHTED;
      expect(banner.className.includes("bg-win-wash")).toBe(wantsGreen);
      expect(banner.className.includes("border-win")).toBe(wantsGreen);
      expect(banner.className.includes("bg-board-subtle")).toBe(!wantsGreen);
      unmount();
    }
  });

  it("shows no banner at all while the match is running", () => {
    // A banner on a live match is a result nobody earned, and it pushes the
    // board down the page for as long as the match runs.
    render(<GameShell {...shellProps()} />);
    expect(screen.queryByRole("button", { name: /view match result/i })).toBeNull();
    expect(screen.queryByText(/winning line is highlighted|review the board or the move list/i)).toBeNull();
  });

  it("draws the arrow rather than typing it", () => {
    // The app promises not to use arrow characters: they render differently on
    // every platform and are not the one thing this repo sweeps for.
    const { container, unmount } = render(
      <GameShell {...shellProps({ ...wonMatch, hasWinningLine: true })} />
    );
    dismissOutcome();
    const button = screen.getByRole("button", { name: /view match result/i });
    expect(button.querySelector("svg")).toBeTruthy();
    expect(button.textContent ?? "").not.toMatch(/[\u2190-\u21ff]/);
    expect(container.innerHTML).not.toContain("&rarr;");
    unmount();
  });
});

describe("the winning line on the board", () => {
  /**
   * Four real games, each played move by move through the engine, each ending
   * the way a player would end it. The highlight the view is given is the line
   * the engine itself reported on the final move, so the number of cells the
   * engine claims and the number of cells the board lights cannot drift apart
   * unnoticed: they come from the same call.
   */
  const WON_GAMES: ReadonlyArray<{
    kind: GameKind;
    expected: number;
    moves: ReadonlyArray<readonly [Coordinates, PlayerColor]>;
  }> = [
    {
      kind: "tictactoe",
      expected: 3,
      moves: [
        [{ x: 0, y: 0 }, "black"],
        [{ x: 1, y: 1 }, "white"],
        [{ x: 0, y: 1 }, "black"],
        [{ x: 2, y: 2 }, "white"],
        [{ x: 0, y: 2 }, "black"],
      ],
    },
    {
      // Black fills the bottom row from the left; White answers at the right
      // and reaches three of its own, which is not yet the four a win needs.
      kind: "connect4",
      expected: 4,
      moves: [
        [{ x: 0, y: 0 }, "black"],
        [{ x: 6, y: 0 }, "white"],
        [{ x: 1, y: 0 }, "black"],
        [{ x: 5, y: 0 }, "white"],
        [{ x: 2, y: 0 }, "black"],
        [{ x: 4, y: 0 }, "white"],
        [{ x: 3, y: 0 }, "black"],
      ],
    },
    {
      // Five in a row on the middle row. White's four down the same row stop
      // short, which is the only reason the fixture reaches a Black win.
      kind: "gomoku",
      expected: 5,
      moves: [
        [{ x: 4, y: 7 }, "black"],
        [{ x: 0, y: 7 }, "white"],
        [{ x: 5, y: 7 }, "black"],
        [{ x: 1, y: 7 }, "white"],
        [{ x: 6, y: 7 }, "black"],
        [{ x: 2, y: 7 }, "white"],
        [{ x: 7, y: 7 }, "black"],
        [{ x: 3, y: 7 }, "white"],
        [{ x: 8, y: 7 }, "black"],
      ],
    },
    {
      // A column through all seven rows. White stays on the near two columns,
      // so it never reaches the right-hand goal edge.
      kind: "hex",
      expected: 7,
      moves: [
        [{ x: 3, y: 0 }, "black"],
        [{ x: 0, y: 0 }, "white"],
        [{ x: 3, y: 1 }, "black"],
        [{ x: 1, y: 6 }, "white"],
        [{ x: 3, y: 2 }, "black"],
        [{ x: 0, y: 2 }, "white"],
        [{ x: 3, y: 3 }, "black"],
        [{ x: 1, y: 3 }, "white"],
        [{ x: 3, y: 4 }, "black"],
        [{ x: 0, y: 4 }, "white"],
        [{ x: 3, y: 5 }, "black"],
        [{ x: 3, y: 6 }, "black"],
      ],
    },
  ];

  function playToWin(kind: GameKind, moves: ReadonlyArray<readonly [Coordinates, PlayerColor]>) {
    const engine = getSessionEngine(kind);
    let board = engine.createInitialBoard();
    let line: Coordinates[] = [];
    for (const [to, player] of moves) {
      const result = engine.applyMove(board, { to }, player);
      board = result.board;
      line = result.winningLine ?? [];
    }
    return { board, line };
  }

  async function renderWonBoard(kind: GameKind, board: unknown, winningSquares: Set<string>) {
    const load = BOARD_VIEWS.find(([entry]) => entry === kind)![1];
    const View = (await load()) as React.ComponentType<Record<string, unknown>>;
    return render(
      <View
        board={board}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        winningSquares={winningSquares}
        disabled
        onSquareActivate={() => {}}
        label={`${kind} board`}
        size="sm"
      />
    );
  }

  for (const game of WON_GAMES) {
    it(`washes exactly the cells that decided a finished ${game.kind}`, async () => {
      const { board, line } = playToWin(game.kind, game.moves);
      expect(line).toHaveLength(game.expected);

      const { container, unmount } = await renderWonBoard(
        game.kind,
        board,
        new Set(line.map(coordKey))
      );

      // One wash per cell, and no others: a highlight that covers half a
      // winning line is not a highlight, and one that covers the whole board
      // is a lie about which stones mattered.
      expect(container.querySelectorAll("[data-winning-cell]")).toHaveLength(game.expected);
      unmount();
    });

    it(`draws no highlight on a ${game.kind} that is still running`, async () => {
      const { board } = playToWin(game.kind, game.moves.slice(0, 2));
      const { container, unmount } = await renderWonBoard(game.kind, board, new Set());

      expect(container.querySelectorAll("[data-winning-cell]")).toHaveLength(0);
      expect(container.querySelectorAll("[data-winning]")).toHaveLength(0);
      unmount();
    });
  }

  it("rings a winning cell in the win colour and not the last-move colour", async () => {
    // The last move of every fixture is the winning move, so every winning
    // board below has a square that is both. The board has to choose: two rings
    // on one tile is undecidable by eye, and the amber "that was the last
    // move" ring is the one that lies about a finished game, because it points
    // at a move that no longer matters.
    for (const kind of ["tictactoe", "gomoku", "hex"] as const) {
      const game = WON_GAMES.find((entry) => entry.kind === kind)!;
      const { board, line } = playToWin(kind, game.moves);
      const { container, unmount } = await renderWonBoard(kind, board, new Set(line.map(coordKey)));

      const winningTiles = [...container.querySelectorAll("[data-winning]")];
      expect(winningTiles, `${kind} should mark its winning tiles`).toHaveLength(game.expected);
      for (const tile of winningTiles) {
        const className = tile.getAttribute("class") ?? "";
        expect(className, `${kind} winning tile`).toContain("ring-win");
        expect(className, `${kind} winning tile`).not.toContain("ring-amber");
        // The invariant BoardTile is built around: one ring, chosen once.
        expect(className.match(/(?:^|\s)ring-\d+/g), `${kind} ring count`).toHaveLength(1);
        // And a screen reader is told the same thing the eye is shown.
        expect(tile.getAttribute("aria-label") ?? "").toMatch(/winning (line|chain)/i);
      }
      unmount();
    }
  });

  it("rings the winning discs on a connect four playfield", async () => {
    const game = WON_GAMES.find((entry) => entry.kind === "connect4")!;
    const { board, line } = playToWin("connect4", game.moves);
    const { container, unmount } = await renderWonBoard("connect4", board, new Set(line.map(coordKey)));

    const playfield = container.querySelector("[data-c4-playfield]")!;
    const highlighted = [...playfield.querySelectorAll("[data-winning-cell]")];
    expect(highlighted).toHaveLength(4);
    for (const wash of highlighted) {
      // The ring is on the socket that holds the wash, which is the one part
      // of a cell with room to glow — so the assertion follows it up a level
      // rather than looking for a ring on the wash itself.
      const socket = wash.parentElement!;
      const className = socket.getAttribute("class") ?? "";
      expect(className).toContain("ring-win");
      // The newest disc wears amber; on a won playfield that ring has to give
      // way, or the board points at a disc that did not decide anything.
      expect(className).not.toContain("ring-amber");
      expect(className.match(/(?:^|\s)ring-\d+/g)).toHaveLength(1);
    }
    unmount();
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

  it("reserves the room a non-square board needs, instead of wasting it", () => {
    // Connect Four is 7x6. A square frame around a 7:6 board is a sixth of
    // empty height, always — and on a 360x640 phone that sixth is the
    // difference between the score cards fitting on screen and being pushed
    // below the fold. The ratio is stated per kind rather than measured from
    // the board, because the frame has to reserve the space *before* the board
    // has been laid out; a board that reported its own ratio back would have
    // already moved everything below it.
    for (const [kind, ratio] of [
      ["connect4", "7 / 6"],
      ["tictactoe", "1 / 1"],
      ["checkers", "1 / 1"],
      // Hex is the second non-square board, and for the same reason. Its
      // playfield is 7 cells plus the 6 half-cell offsets the last row
      // accumulates — 10 cell-widths across, 7 down. A square frame left
      // roughly 200px of dead vertical space between the last row and the
      // bottom goal rail, which read as a gap *in* the board rather than slack
      // around it.
      ["hex", "10 / 7"],
      ["reversi", "1 / 1"],
      ["gomoku", "1 / 1"],
    ] as const) {
      const { container, unmount } = render(
        <BoardStage gameKind={kind} size="md" isDesktop={false}>
          <div />
        </BoardStage>
      );
      const stage = container.querySelector("[data-board-stage]") as HTMLElement;
      expect(stage.style.aspectRatio, `${kind} stage ratio`).toBe(ratio);
      unmount();
    }
  });

  it("keeps a non-square board centred inside the frame", () => {
    // Connect Four is 7x6. Forcing a square on the *board* would stretch it;
    // the frame matches the board and the canvas centres whatever is left.
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

    // Five dots is not the same as the five *right* dots. They are placed from
    // the centre of a 15x15 board, so a set written as literals that drifted by
    // one row would still render five of them and still pass a count.
    const tiles = [...container.querySelectorAll("[data-board-surface]")];
    expect(tiles).toHaveLength(15 * 15);
    const at = (x: number, y: number) => tiles[y * 15 + x]!;
    for (const [x, y] of [
      [3, 3],
      [11, 3],
      [7, 7],
      [3, 11],
      [11, 11],
    ] as const) {
      const dot = at(x, y).querySelector(".bg-\\[\\#4A3718\\]");
      expect(dot, `no star point at ${x},${y}`).not.toBeNull();
    }
    // And nowhere else: the corners and the edges of a 15x15 board are plain.
    for (const [x, y] of [
      [0, 0],
      [14, 0],
      [0, 14],
      [14, 14],
      [7, 0],
      [0, 7],
    ] as const) {
      expect(at(x, y).querySelector(".bg-\\[\\#4A3718\\]"), `a star point at ${x},${y}`).toBeNull();
    }
    unmount();
  });

  it("previews a Gomoku stone on the one intersection under the pointer, and no other", async () => {
    // 225 empty intersections, every one of them legal. A marker per legal
    // square would put a ghost on the whole board, and a ghost that stayed where
    // it was last drawn would put it on the wrong one — a preview of a move
    // nobody is making. So: exactly one ghost, and it follows the pointer.
    const { GomokuBoardView } = await import("@/components/boards/GomokuBoardView");
    const engine = getSessionEngine("gomoku");
    const played = engine.applyMove(engine.createInitialBoard(), { to: { x: 7, y: 7 } }, "black").board;
    const { container, unmount } = render(
      <GomokuBoardView
        board={played}
        selected={new Set<string>()}
        legalSquares={new Set<string>(["2,3", "13,4", "7,7"])}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>(["2,3", "13,4", "7,7"])}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Gomoku board"
        size="sm"
      />
    );

    const grid = container.querySelector("[data-board-surface]")?.parentElement;
    expect(grid).not.toBeNull();
    // jsdom has no layout, so the board is given one: 300px square, 20px cells.
    Object.defineProperty(grid as Element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300 }),
    });
    const tiles = [...container.querySelectorAll("[data-board-surface]")];
    const at = (x: number, y: number) => tiles[y * 15 + x]!;
    const ghosts = () =>
      [...container.querySelectorAll('[aria-hidden="true"]')].filter((node) =>
        (node as HTMLElement).className.includes("animate-pulse")
      );

    // Nothing is previewed before the pointer arrives.
    expect(ghosts()).toHaveLength(0);

    // The pointer over c4 — a legal, empty intersection.
    fireEvent.pointerMove(at(2, 3), { clientX: 50, clientY: 70 });
    const previewed = ghosts();
    expect(previewed).toHaveLength(1);
    expect(previewed[0]!.closest("[data-board-surface]")).toBe(at(2, 3));
    // Dashed, so it reads as a suggestion rather than as a stone already played.
    expect((previewed[0] as HTMLElement).className).toContain("border-dashed");

    // It follows the pointer to the next intersection rather than lingering.
    fireEvent.pointerMove(at(13, 4), { clientX: 274, clientY: 90 });
    expect(ghosts()).toHaveLength(1);
    expect(ghosts()[0]!.closest("[data-board-surface]")).toBe(at(13, 4));

    // An intersection that is not on offer draws no ghost at all, even with the
    // pointer on it: a preview of a move the session will refuse.
    fireEvent.pointerMove(at(5, 5), { clientX: 110, clientY: 110 });
    expect(ghosts()).toHaveLength(0);

    // A stone: there is nothing to preview on top of.
    fireEvent.pointerMove(at(7, 7), { clientX: 150, clientY: 150 });
    expect(ghosts()).toHaveLength(0);

    // And leaving the square takes the preview with it.
    fireEvent.pointerMove(at(2, 3), { clientX: 50, clientY: 70 });
    expect(ghosts()).toHaveLength(1);
    fireEvent.pointerLeave(at(2, 3));
    expect(ghosts()).toHaveLength(0);
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

  it("draws a Tic-Tac-Toe grid with its lines in the gap, not the cells", async () => {
    const { TicTacToeBoardView } = await import("@/components/boards/TicTacToeBoardView");
    const { container, unmount } = render(
      <TicTacToeBoardView
        board={getSessionEngine("tictactoe").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Tic-Tac-Toe board"
        size="md"
      />
    );

    const board = container.querySelector('[role="grid"]') as HTMLElement;
    expect(board.style.aspectRatio).toBe("1 / 1");
    // A viewport term, not a bare pixel cap: this board used to be the only one
    // whose width was a fixed 480px, which on a 360px phone means the outer
    // columns run off the screen edge while the frame centres them.
    expect(board.className).toContain("max-w-[min(92vw,560px)]");
    // Centred inside the stage rather than pinned to the left of it.
    expect(board.className).toContain("mx-auto");
    // The grid lines are the gap showing the frame through. This is why no tile
    // needs a border of its own.
    expect(board.className).toContain("gap-3");

    const tiles = container.querySelectorAll("[data-board-surface]");
    expect(tiles).toHaveLength(9);
    // One fill for all nine. A checkerboard implies the grid by alternating
    // colours, which is what made this read as nine loose marks.
    for (const tile of tiles) expect(tile.className).toContain("bg-neutral-100");
    unmount();
  });

  it("keeps a Tic-Tac-Toe mark legible on a light cell", async () => {
    const { TicTacToeBoardView } = await import("@/components/boards/TicTacToeBoardView");
    // A board with both marks on it, reached the way a real one is: two legal
    // moves through the engine, not a hand-edited array.
    const engine = getSessionEngine("tictactoe");
    const afterX = engine.applyMove(engine.createInitialBoard(), { to: { x: 0, y: 0 } }, "black");
    const board = engine.applyMove(afterX.board, { to: { x: 1, y: 1 } }, "white").board;
    const { container, unmount } = render(
      <TicTacToeBoardView
        board={board}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Tic-Tac-Toe board"
        size="md"
      />
    );

    const strokes = [...container.querySelectorAll("svg g[stroke], svg circle[stroke]")];
    expect(strokes).toHaveLength(2);
    // The stroke is `currentColor` and the colour rides on the mark's wrapper,
    // which is what lets the vanishing mark take the same red the ring and the
    // `breathe` keyframes use.
    for (const stroke of strokes) expect(stroke.getAttribute("stroke")).toBe("currentColor");
    // `closest`, because on an `<svg>` `className` is an `SVGAnimatedString`
    // rather than the string the `text-*` utility is on.
    const colors = strokes.map((stroke) => (stroke.closest("span") as HTMLElement).className);
    // The bug: these were `board-dark`/`board-light` theme tokens chosen to
    // contrast with the *page*, and the cells here are light. A white mark on a
    // light cell is not there at all.
    expect(colors.map((name) => name.trim())).toEqual(["block text-[#111827]", "block text-[#DC2626]"]);
    for (const color of colors) {
      expect(color).not.toContain("text-board-light");
      expect(color).not.toContain("text-board-dark");
    }

    // Both marks are 65% of their cell, and the strokes are the same weight.
    for (const mark of container.querySelectorAll("svg")) {
      expect(mark.parentElement?.getAttribute("style")).toContain("65%");
    }
    for (const stroke of strokes) expect(stroke.getAttribute("stroke-width")).toBe("12");
    unmount();
  });

  it("rings the one Tic-Tac-Toe mark the next move will lift", async () => {
    const { TicTacToeBoardView } = await import("@/components/boards/TicTacToeBoardView");
    // The complaint: a fourth mark makes your first mark disappear, and with
    // nothing on the board to say so the player reads it as a bug in the app
    // rather than as the rule. The mark at stake is named before the move.
    const engine = getSessionEngine("tictactoe");
    const to: Coordinates[] = [
      { x: 2, y: 2 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ];
    let board = engine.createInitialBoard();
    const history: { player: PlayerColor; to: Coordinates }[] = [];
    for (const [ply, coord] of to.entries()) {
      const player: PlayerColor = ply % 2 === 0 ? "black" : "white";
      board = engine.applyMove(
        board,
        { to: coord },
        player,
        { history: history.filter((entry) => entry.player === player) }
      ).board;
      history.push({ player, to: coord });
    }
    // Black now holds 2, 4 and 8, and 8 was played first.
    const { container, unmount } = render(
      <TicTacToeBoardView
        board={board}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        vanishingSquares={new Set(["2,2"])}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Tic-Tac-Toe board"
        size="md"
      />
    );

    // Exactly one ring: the mark named by the session, and no other.
    const rings = container.querySelectorAll("[data-vanishing-mark]");
    expect(rings).toHaveLength(1);
    const ring = rings[0] as HTMLElement;
    // Inside the square, so it cannot spill over a grid line and read as a
    // border on the cell next to it.
    expect(ring.className).toMatch(/inset-/);
    // Dashed, not solid: a solid border looks like a permanent state, a
    // provisional one looks temporary — which is what it is.
    expect(ring.className).toMatch(/border-dashed/);
    // The pulse is the visual half of the warning, and it respects a player who
    // has asked the system for less motion.
    expect(ring.className).toMatch(/motion-safe:/);
    // The tile says it in words too, for a player who cannot see the dash.
    const tile = ring.closest("[data-board-surface]") as HTMLElement;
    expect(tile.getAttribute("aria-label")).toContain("lifts off the board");
    unmount();
  });

  it("rings nothing when the view is not told a mark is at stake", async () => {
    const { TicTacToeBoardView } = await import("@/components/boards/TicTacToeBoardView");
    const { container, unmount } = render(
      <TicTacToeBoardView
        board={getSessionEngine("tictactoe").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        vanishingSquares={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Tic-Tac-Toe board"
        size="md"
      />
    );

    // The session hands every board the same field, empty in every other game.
    // A view that rang something here would be inventing a rule it does not have.
    expect(container.querySelectorAll("[data-vanishing-mark]")).toHaveLength(0);
    unmount();
  });

  it("marks a lifted checker with an inset ring, not a repainted square", async () => {
    const { CheckersBoardView } = await import("@/components/boards/CheckersBoardView");
    const engine = getSessionEngine("checkers");
    const origin = [...engine.getSelectableSquares(engine.createInitialBoard(), "black")][0]!;
    const originKey = `${origin.x},${origin.y}`;

    const { container, unmount } = render(
      <CheckersBoardView
        board={engine.createInitialBoard()}
        selected={new Set([originKey])}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Checkers board"
        size="sm"
      />
    );

    const board = container.querySelector('[role="grid"]') as HTMLElement;
    expect(board.style.aspectRatio).toBe("1 / 1");
    expect(board.className).toContain("max-w-[min(92vw,560px)]");

    const lifted = container.querySelector(`[aria-label*="${originKey}"], [aria-pressed="true"]`);
    expect(lifted).not.toBeNull();
    const liftedClass = (lifted as HTMLElement).className;
    // An inset ring paints inside the square, so it cannot take a pixel from a
    // neighbour and the checkerboard stays visible under the lifted piece.
    expect(liftedClass).toMatch(/ring-4/);
    expect(liftedClass).toMatch(/ring-inset/);
    expect(liftedClass).not.toMatch(/border-2(?![-\d])/);
    unmount();
  });

  it("gives a board exactly one marker per legal destination, never two", async () => {
    // A destination used to be marked twice on Checkers and Reversi: once by
    // the tile's own pseudo-element and once by a ghost disc the view rendered
    // as a child. Two markers for one fact is worse than one, because the
    // player has to work out whether they disagree.
    //
    // The check is structural — "no square carries both kinds" — rather than
    // "square N carries a ghost". An earlier version of this test located the
    // destination by matching the coordinate key against the tile's label, and
    // every board labels its own way ("Square d3", "Column 4, row 5"), so the
    // lookup missed everywhere and the test passed having checked nothing.
    const marksOnPseudoElement = (tile: Element) =>
      /(^|\s)after:(pointer-events-none|absolute|inset-\[)/.test(tile.className);
    const ghostDiscs = (tile: Element) =>
      [...tile.children].filter(
        (child) =>
          child.tagName === "SPAN" &&
          child.getAttribute("aria-hidden") === "true" &&
          // The winning wash is a span for the same reason a ghost is, but it
          // marks a finished game rather than a move, and it is not competing
          // with the pseudo-element marker for the same fact.
          !child.hasAttribute("data-winning-cell") &&
          !child.textContent
      ).length;

    // Two boards deliberately mark nothing in advance. Gomoku has 225 legal
    // intersections and Connect Four a whole column to drop into, so both
    // preview a ghost on the single square the pointer is over instead of
    // painting a board full of markers. Hex is the same case with different
    // numbers: 49 legal cells, every turn. They are named here so that a board
    // quietly joining them fails the count below.
    const UNMARKED = new Set(["gomoku", "connect4", "hex"]);

    for (const [kind, load] of BOARD_VIEWS) {
      const View = (await load()) as React.ComponentType<Record<string, unknown>>;
      const engine = getSessionEngine(kind);
      const board = engine.createInitialBoard();
      const destinations = new Set(
        engine.usesOriginSquare
          ? engine
              .getDestinations(board, engine.getSelectableSquares(board, "black")[0]!, "black")
              .map(coordKey)
          : engine.getLegalSquares(board, "black").map(coordKey)
      );
      expect(destinations.size, `${kind} should have legal moves to open with`).toBeGreaterThan(0);

      const { container, unmount } = render(
        <View
          board={board}
          selected={new Set<string>()}
          legalSquares={new Set<string>()}
          selectableSquares={new Set<string>()}
          destinations={destinations}
          lastMove={null}
          disabled={false}
          onSquareActivate={() => {}}
          label={`${kind} board`}
          size="sm"
        />
      );

      const tiles = [...container.querySelectorAll("[data-board-surface]")];
      expect(tiles.length, `${kind} should render tiles`).toBeGreaterThan(0);
      const marked = tiles.filter(marksOnPseudoElement);
      // Non-vacuity: a board that is supposed to mark its destinations has to
      // actually mark some, or this test is asserting nothing.
      if (!UNMARKED.has(kind)) {
        expect(marked.length, `${kind} should mark its destinations`).toBeGreaterThan(0);
      } else {
        expect(marked.length, `${kind} marks no destination in advance`).toBe(0);
      }
      for (const tile of marked) {
        expect(
          ghostDiscs(tile),
          `${kind} must not draw a ghost disc and a marker on the same square`
        ).toBe(0);
      }
      unmount();
    }
  });

  it("renders a played board for every kind, not just the opening one", async () => {
    // A board view that renders the empty layout perfectly and then misrenders
    // once there is something to draw is the common failure, and a test that
    // only ever opens a game cannot see it. So each kind is played a few plies
    // through the engine and re-rendered.
    // `[data-board-surface]` is the clickable unit, which is not always the
    // drawn cell: Connect Four makes the whole column one surface, because the
    // 42 drawn cells are decorative inside a single drop target. Counting the
    // surface rather than the cell is therefore the right unit to assert on —
    // it is what a click can actually reach, and it is what the click-handling
    // tests above already speak in.
    const TILE_COUNT: Readonly<Record<GameKind, number>> = {
      tictactoe: 9,
      gomoku: 15 * 15,
      reversi: 8 * 8,
      checkers: 8 * 8,
      connect4: 7,
      hex: 7 * 7,
    };

    for (const [kind, load] of BOARD_VIEWS) {
      const View = (await load()) as React.ComponentType<Record<string, unknown>>;
      const engine = getSessionEngine(kind);
      const props = (board: unknown, disabled = false) => ({
        board,
        selected: new Set<string>(),
        legalSquares: new Set<string>(),
        selectableSquares: new Set<string>(),
        destinations: new Set<string>(),
        lastMove: null,
        disabled,
        onSquareActivate: () => {},
        label: `${kind} board`,
        size: "sm",
      });

      const opening = engine.createInitialBoard();
      const first = render(<View {...props(opening)} />);
      const openingMarkup = first.container.innerHTML;
      const openingTiles = first.container.querySelectorAll("[data-board-surface]").length;
      expect(openingTiles, `${kind} tile count`).toBe(TILE_COUNT[kind]);
      first.unmount();

      // Play until two moves have been made, or the engine says there is
      // nothing to play. Hex needs no origin square, so the move shape differs
      // by kind; the loop below picks the one the engine asks for.
      let board = opening;
      let player: PlayerColor = "black";
      for (let ply = 0; ply < 2; ply += 1) {
        const squares = engine.usesOriginSquare
          ? engine.getSelectableSquares(board, player)
          : engine.getLegalSquares(board, player);
        const from = squares[ply] ?? squares[0];
        if (from === undefined) break;
        const to = engine.usesOriginSquare
          ? [...engine.getDestinations(board, from, player)][0]
          : from;
        if (to === undefined) break;
        const result = engine.applyMove(board, engine.usesOriginSquare ? { from, to } : { to }, player);
        if (result.winner !== null) break;
        board = result.board;
        player = player === "black" ? "white" : "black";
      }

      const played = render(<View {...props(board)} />);
      // Same layout: pieces arriving never add or remove a square. This is the
      // jitter guarantee, stated for every kind rather than for a sample.
      expect(
        played.container.querySelectorAll("[data-board-surface]").length,
        `${kind} tile count after play`
      ).toBe(openingTiles);
      // And something actually changed, or the render would be lying about the
      // game being in progress.
      expect(played.container.innerHTML, `${kind} should draw the moves played`).not.toBe(
        openingMarkup
      );
      played.unmount();
    }
  });

  it("advertises no legal move on a board it has locked", async () => {
    // The marker is painted by a pseudo-element, which no amount of `disabled`
    // removes. A locked board that still shows where the next move could go
    // both leaks the opponent's options and flickers on every lock and unlock.
    for (const [kind, load] of BOARD_VIEWS) {
      const View = (await load()) as React.ComponentType<Record<string, unknown>>;
      const engine = getSessionEngine(kind);
      const board = engine.createInitialBoard();
      const destinations = new Set(
        engine.usesOriginSquare
          ? engine
              .getDestinations(board, engine.getSelectableSquares(board, "black")[0]!, "black")
              .map(coordKey)
          : engine.getLegalSquares(board, "black").map(coordKey)
      );
      const { container, unmount } = render(
        <View
          board={board}
          selected={new Set<string>()}
          legalSquares={new Set<string>()}
          selectableSquares={new Set<string>()}
          destinations={destinations}
          lastMove={null}
          disabled
          onSquareActivate={() => {}}
          label={`${kind} board`}
          size="sm"
        />
      );
      expect(
        container.querySelectorAll("[data-square='legal']").length,
        `${kind} must not mark destinations while locked`
      ).toBe(0);
      unmount();
    }
  });
  it("lays the Hex rhombus out in fractions of the board, not in pixels", async () => {
    // The rhombus rests on one fact: the board is ten cell-widths across and
    // seven tall, so every row is 70% of the width and every offset is a
    // fraction of it. A hard-coded pixel offset would break the moment the
    // rails or the padding changed, and the shape is the rule — the diagonals
    // only connect if the rows are really half a cell apart.
    const { HexBoardView } = await import("@/components/boards/HexBoardView");
    const engine = getSessionEngine("hex");
    const { container, unmount } = render(
      <HexBoardView
        board={engine.createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Hex board"
        size="sm"
      />
    );

    const grid = container.querySelector('[role="grid"]') as HTMLElement;
    // 10 wide by 7 tall: seven cells plus the six half-cell offsets the last
    // row accumulates.
    expect(grid.style.aspectRatio).toBe("10 / 7");
    expect(grid.getAttribute("aria-rowcount")).toBe("7");
    expect(grid.getAttribute("aria-colcount")).toBe("7");

    const rows = [...container.querySelectorAll('[style*="repeat(7, minmax(0, 1fr))"]')] as HTMLElement[];
    expect(rows).toHaveLength(7);
    // 70% of the board, and shifted by half a cell (a twentieth) per row.
    expect(rows[0]!.style.width).toBe("70%");
    expect(rows[0]!.style.left).toBe("0%");
    expect(rows[1]!.style.left).toBe("5%");
    expect(rows[6]!.style.left).toBe("30%");
    // No magic pixel offset survives anywhere in the view.
    for (const row of rows) {
      expect(row.style.left).not.toMatch(/\d+px/);
    }
    unmount();
  });

  it("stacks no two Hex rows on top of one another", async () => {
    // The bug this exists for: every row was absolutely positioned with no
    // `top` of its own, so all seven sat at `top: 0` and 49 stones were drawn
    // in one overlapping line along the top edge. The geometry was correct and
    // the rows were still stacked, which is why only `top` — not the width or
    // the half-cell offset — is asserted here.
    const { HexBoardView } = await import("@/components/boards/HexBoardView");
    const engine = getSessionEngine("hex");
    // A played position, so the assertion is about stones and not about gaps.
    let board = engine.createInitialBoard();
    for (const coord of [
      { x: 0, y: 0 },
      { x: 6, y: 6 },
      { x: 3, y: 3 },
    ] as const) {
      board = engine.applyMove(board, { to: coord }, "black").board;
    }

    const { container, unmount } = render(
      <HexBoardView
        board={board}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Hex board"
        size="sm"
      />
    );

    const rows = [...container.querySelectorAll('[style*="repeat(7, minmax(0, 1fr))"]')] as HTMLElement[];
    expect(rows).toHaveLength(7);

    // Row `y` starts one seventh of the board lower than row `y - 1`, and each
    // is exactly one seventh tall, so they tile the board with no overlap and no
    // gap. Every `top` is distinct — that is the whole regression.
    const tops = rows.map((row) => row.style.top);
    expect(new Set(tops).size).toBe(7);
    expect(tops[0]).toBe("0%");
    expect(tops[6]).toBe(`${(6 / 7) * 100}%`);

    const toPercent = (value: string): number => Number.parseFloat(value);
    for (let y = 0; y < rows.length; y += 1) {
      const row = rows[y]!;
      expect(toPercent(row.style.top)).toBeCloseTo((y / 7) * 100, 6);
      expect(toPercent(row.style.height)).toBeCloseTo((1 / 7) * 100, 6);
      // The bottom of this row is the top of the next one: touching, not
      // overlapping, and never running off the board.
      expect(toPercent(row.style.top) + toPercent(row.style.height)).toBeCloseTo(((y + 1) / 7) * 100, 6);
      expect(toPercent(row.style.left) + toPercent(row.style.width)).toBeLessThanOrEqual(100.000001);
    }

    // And the consequence a player would actually see: three stones in three
    // different rows are three different vertical positions, not one line.
    const stones = [...container.querySelectorAll("span[class*='size-[74%]']")].filter(
      (stone) => (stone.getAttribute("class") ?? "").includes("bg-neutral-900")
    );
    expect(stones.length).toBe(3);
    const stoneTops = new Set(stones.map((stone) => (stone.parentElement as HTMLElement).parentElement!.style.top));
    expect(stoneTops.size).toBe(3);
    unmount();
  });

  it("names both goal edges in words, not only in a bar of colour", async () => {
    // A rail on its own says which edges; it does not say whose. A player who
    // cannot tell Black's goal from White's cannot play the game, so each rail is
    // captioned, and the caption points at the rail it belongs to.
    const { HexBoardView } = await import("@/components/boards/HexBoardView");
    const { container, unmount } = render(
      <HexBoardView
        board={getSessionEngine("hex").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Hex board"
        size="sm"
      />
    );

    const edges = ["black-top", "black-bottom", "white-left", "white-right"] as const;
    // Each caption is placed in the board's own grid: the two Black ones above
    // and below the playfield, the two White ones either side of it. A caption
    // that drifted into a corner would still read correctly and still point at
    // the wrong edge, so the placement is asserted rather than the words alone.
    const gridArea = {
      "black-top": "1 / 2",
      "black-bottom": "3 / 2",
      "white-left": "2 / 1",
      "white-right": "2 / 3",
    } as const;
    for (const edge of edges) {
      const node = container.querySelector(`[data-goal-edge='${edge}']`) as HTMLElement;
      expect(node, `${edge} is not captioned`).not.toBeNull();
      expect(node.style.gridArea, `${edge} is beside the wrong edge`).toBe(gridArea[edge]);
      const caption = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      expect(caption, `${edge} names the wrong goal`).toBe(
        edge.startsWith("black") ? "Black Goal Edge" : "White Goal Edge"
      );
      // The rail itself is still there, and still the same colour it always was.
      const rail = node.querySelector("[data-edge-rail]") as HTMLElement;
      expect(rail, `${edge} lost its rail`).not.toBeNull();
      expect(rail.getAttribute("aria-hidden")).toBe("true");
      expect(rail.className).toContain(edge.startsWith("black") ? "bg-neutral-900" : "bg-neutral-50");
      // The rail spans the edge it labels: the full width of the board above and
      // below, the full height of it at either side.
      if (edge.endsWith("top") || edge.endsWith("bottom")) {
        expect(rail.style.height).toBe("9px");
      } else {
        expect(rail.style.width).toBe("9px");
        expect(rail.className).toContain("self-stretch");
      }
      // Two arrows, pointing at this edge rather than at its neighbour.
      const arrows = node.querySelectorAll("svg");
      expect(arrows).toHaveLength(2);
      const pointing = {
        "black-top": "rotate(180deg)",
        "black-bottom": "rotate(0deg)",
        "white-left": "rotate(90deg)",
        "white-right": "rotate(270deg)",
      }[edge]!;
      for (const arrow of arrows) {
        expect((arrow as SVGElement).style.transform, `${edge} points the wrong way`).toBe(pointing);
        expect(arrow.getAttribute("aria-hidden")).toBe("true");
      }
    }

    // The side captions run down their strip rather than across it, so the strip
    // stays narrow enough to leave the board its width.
    const side = container.querySelector("[data-goal-edge='white-left'] [data-edge-words]") as HTMLElement;
    expect(side).not.toBeNull();
    expect(side.textContent).toBe("White Goal Edge");
    expect(side.className).toContain("[writing-mode:vertical-rl]");
    unmount();
  });

  it("marks no Hex cell in advance, and previews the stone under the pointer", async () => {
    // Every empty cell in Hex is legal on every turn, so a marker per
    // destination would be 49 dots stating what the board already states: this
    // cell is empty. Painting them is not merely noisy — it is two marks for
    // one fact the moment a ghost appears over a marked cell. The ghost is
    // therefore the only marker, and it is inert: it never intercepts the click
    // and never reaches the accessible tree.
    const { HexBoardView } = await import("@/components/boards/HexBoardView");
    const { container, unmount } = render(
      <HexBoardView
        board={getSessionEngine("hex").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set(["2,2"])}
        selectableSquares={new Set<string>()}
        destinations={new Set(["2,2"])}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Hex board"
        size="sm"
      />
    );

    // Not one dot, on the legal cell or anywhere else.
    expect(container.querySelector('[data-square="legal"]')).toBeNull();
    expect(container.querySelector('[class*="after:bg-"]')).toBeNull();

    const tile = container.querySelector("[data-board-surface]") as HTMLElement;
    expect(tile.className).toContain("group");
    const ghost = tile.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(ghost.className).toContain("pointer-events-none");
    expect(ghost.className).toContain("group-hover:bg-neutral-500/30");
    // Invisible until hovered, so an untouched board shows 49 empty cells.
    expect(ghost.className).toContain("bg-neutral-500/0");
    // The ghost is the size of a real stone, or the preview misleads about
    // the size of the thing being placed.
    expect(ghost.className).toContain("size-[74%]");
    unmount();
  });

  it("shows no Hex ghost at all on a locked board", async () => {
    // A locked board must not advertise an option it will refuse. Relying on
    // the pointer never arriving is not the same as not drawing it: the element
    // would still be in the tree, and still in the accessible one.
    const { HexBoardView } = await import("@/components/boards/HexBoardView");
    const { container, unmount } = render(
      <HexBoardView
        board={getSessionEngine("hex").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set(["2,2"])}
        selectableSquares={new Set<string>()}
        destinations={new Set(["2,2"])}
        lastMove={null}
        disabled
        onSquareActivate={() => {}}
        label="Hex board"
        size="sm"
      />
    );

    expect(container.querySelectorAll('[data-square="legal"]').length).toBe(0);
    expect(container.querySelector('[class*="group-hover:bg-neutral-500/30"]')).toBeNull();
    // 49 cells are still drawn and still labelled: a locked board is still a
    // board, and a player watching the opponent has to be able to read it.
    expect(container.querySelectorAll("[data-board-surface]")).toHaveLength(49);
    unmount();
  });

  it("draws a Hex stone with an edge, because the disc has none of its own", async () => {
    // A black disc on a pale cell and a white disc on a near-white one are both
    // greys, so each side gets a different kind of separation: shading for the
    // jet stone, a dark hairline for the pearl.
    const { HexBoardView } = await import("@/components/boards/HexBoardView");
    const engine = getSessionEngine("hex");
    const board = engine.applyMove(
      engine.createInitialBoard(),
      { from: undefined, to: { x: 1, y: 1 } },
      "black"
    ).board;
    const withWhite = engine.applyMove(board, { from: undefined, to: { x: 2, y: 1 } }, "white").board;

    const { container, unmount } = render(
      <HexBoardView
        board={withWhite}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Hex board"
        size="sm"
      />
    );

    // Selected by the stone's own size class, not by its colour: the two Black
    // goal rails share `bg-neutral-900` and come first in the DOM, so a colour
    // match would find a rail and quietly assert that a rail has a gloss.
    const jet = container.querySelector('span.bg-neutral-900[class*="size-"]') as HTMLElement;
    expect(jet).not.toBeNull();
    // The gloss, which is what stops a black disc reading as a hole. Matched on
    // the attribute rather than a selector: a `/` in a Tailwind opacity is
    // unambiguous in a class attribute and awkward in a selector, and what is
    // under test is that the gloss exists.
    expect(
      [...jet.children].some((c) => (c.getAttribute("class") ?? "").includes("bg-white/40"))
    ).toBe(true);
    // The pearl's rim.
    const pearl = container.querySelector('span.bg-neutral-50[class*="size-"]') as HTMLElement;
    expect(pearl).not.toBeNull();
    expect(pearl.className).toContain("border");
    // Both stones are drawn the same size, so the board does not read as
    // giving one player bigger pieces.
    expect(jet.className).toContain("size-[74%]");
    expect(pearl.className).toContain("size-[74%]");
    unmount();
  });

  it("gives Connect Four an exact 7:6 playfield with square cells", async () => {
    const { ConnectFourBoardView } = await import("@/components/boards/ConnectFourBoardView");
    const { container, unmount } = render(
      <ConnectFourBoardView
        board={getSessionEngine("connect4").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set<string>()}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Connect Four board"
      />
    );

    // 7 columns by 6 rows, as a ratio rather than as a class that happens to
    // look right. The board was previously 7:6 by intention and not by
    // measurement, because the padding and border that were stealing height
    // from it were on the same element as the ratio.
    const playfield = container.querySelector("[data-c4-playfield]") as HTMLElement;
    expect(playfield.style.aspectRatio).toBe("7 / 6");
    expect(playfield.style.gridTemplateColumns).toBe("repeat(7, minmax(0, 1fr))");
    // 42 sockets, and no gap: a gap would make the cells non-square and the
    // disc inside them oval. Separation comes from per-cell padding.
    expect(container.querySelectorAll(".bg-slate-950")).toHaveLength(42);
    expect(playfield.className).not.toContain("gap-");
    // The invariant that was violated: the box carrying the ratio must carry no
    // chrome of its own. Padding here would shrink the content box off 7:6 and
    // the cells would no longer be square, whatever the ratio says.
    expect(playfield.className).not.toMatch(/(^| )(p|px|py|m|border|shadow)-/);
    unmount();
  });

  it("previews a Connect Four drop in the slot the disc falls into", async () => {
    const { ConnectFourBoardView } = await import("@/components/boards/ConnectFourBoardView");
    const { container, unmount } = render(
      <ConnectFourBoardView
        board={getSessionEngine("connect4").createInitialBoard()}
        selected={new Set<string>()}
        legalSquares={new Set<string>(["0,5", "3,5"])}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Connect Four board"
      />
    );

    // Nothing is previewed until a column is actually pointed at.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);

    // Hovering column 3 puts a ghost in that column's landing slot, which on
    // an empty board is the bottom row — the row the disc will really occupy.
    const column = screen.getByRole("button", { name: /Column 4,/ });
    fireEvent.mouseEnter(column);
    const ghosts = container.querySelectorAll(".animate-pulse");
    expect(ghosts).toHaveLength(1);
    // Translucent, so it reads as "not placed yet" rather than as a disc.
    expect(ghosts[0].className).toMatch(/bg-white\/20/);

    fireEvent.mouseLeave(column);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    unmount();
  });

  it("previews a Connect Four drop in the slot the disc actually falls into", async () => {
    // The preview has one job: say where the disc will land. On a column that
    // already holds two discs that is the third slot from the bottom — not the
    // top of the column, not the middle of it, and not the first empty row read
    // from the top. A preview drawn anywhere else is worse than none, because
    // it is believed.
    const { ConnectFourBoardView } = await import("@/components/boards/ConnectFourBoardView");
    const engine = getSessionEngine("connect4");
    let board = engine.createInitialBoard();
    board = engine.applyMove(board, { to: { x: 3, y: 5 } }, "black").board;
    board = engine.applyMove(board, { to: { x: 3, y: 4 } }, "white").board;

    const { container, unmount } = render(
      <ConnectFourBoardView
        board={board}
        selected={new Set<string>()}
        legalSquares={new Set<string>(["3,3", "0,5"])}
        selectableSquares={new Set<string>()}
        destinations={new Set<string>()}
        lastMove={null}
        disabled={false}
        onSquareActivate={() => {}}
        label="Connect Four board"
      />
    );

    // Row 0 is the top, so the landing row is 3 and the column's own label says
    // the same thing in words — the preview and the announcement agree.
    const column = screen.getByRole("button", { name: /Column 4,/ });
    expect(column.getAttribute("aria-label")).toBe("Column 4, drop a disc in row 3 from the top");

    const playfield = container.querySelector("[data-c4-playfield]") as HTMLElement;
    const columns = [...playfield.children] as HTMLElement[];
    expect(columns).toHaveLength(7);
    const socketsOf = (index: number) => [
      ...columns[index]!.querySelectorAll(".bg-slate-950"),
    ];
    const ghostIn = (index: number) =>
      socketsOf(index).findIndex((socket) => socket.querySelector(".animate-pulse"));

    fireEvent.mouseEnter(column);
    const ghosts = container.querySelectorAll(".animate-pulse");
    expect(ghosts).toHaveLength(1);
    // The landing slot, in the column that was pointed at.
    expect(ghostIn(3)).toBe(3);
    // And in no other column. Matching the landing *row* alone lit up the socket
    // of every column whose disc happened to fall on the same row, so aiming at
    // one column drew up to six previews at once.
    for (const index of [0, 1, 2, 4, 5, 6]) expect(ghostIn(index), `column ${index}`).toBe(-1);

    // Legible on the socket it sits in. The socket is near-black, so a preview
    // that is only a faint outline reads as a printing artefact; a light fill
    // and a light rim make it unmistakable, and it is inert for the same reason
    // every other decoration on this board is.
    const ghost = ghosts[0] as HTMLElement;
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.className).toMatch(/bg-white\//);
    expect(ghost.className).toMatch(/border-white\//);
    expect(ghost.className).toContain("rounded-full");

    // Keyboard aiming gets the same preview as the pointer: the column is one
    // tab stop, so a preview that only answered to a mouse left a keyboard
    // player with nothing to aim by.
    fireEvent.mouseLeave(column);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    fireEvent.focus(column);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(ghostIn(3)).toBe(3);
    fireEvent.blur(column);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
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
