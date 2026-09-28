"use client";

/**
 * Section 3.7 — the match-resolution dialog.
 *
 * One modal serves every way a match can end, and it distinguishes three
 * situations that a naive implementation would merge into "game over":
 *
 *  - a completed match, where the result is a fact and the actions are
 *    "play again" and "back to the lobby";
 *  - a match abandoned with no result;
 *  - a `syncState: "conflict"` match, where the local board and the server's
 *    move log disagree. That is not a loss and not a win, so this variant
 *    never offers "play again" — replaying from a board nobody can verify is
 *    exactly what the plan forbids. It offers a re-verify action instead, and
 *    the copy says plainly that the match is paused rather than finished.
 *
 * The dialog is never dismissible by Escape or by a backdrop click: a result
 * that can be swiped away by accident is a result players will miss.
 *
 * **The result is named, not implied.** "You win" is true of both seats, so
 * it identifies nothing: a hot-seat player reading "You win" has to work out
 * from the colour of the last move whether they were the one who won, and
 * that is a question the result dialog exists to answer. So the local copy
 * names the seat — "Player 1 (Black) Wins!" — and the online copy names both
 * the seat and the colour, since across a network the colour is the only
 * thing the two sides are certain to agree on. The online body then names
 * *both* seats again, so "who won" and "was that me" are both answered in
 * text rather than one being left for the player to recall.
 *
 * **No variant of this dialog reports a draw for Hex.** Not because the copy
 * is suppressed for that one kind, but because the Hex engine has no draw to
 * report: every position resolves to a winner, so `isDraw` cannot be true.
 * Branching on the kind here would be a way of hiding a bug rather than
 * fixing it.
 *
 * Player numbers are the same in both modes: Black is always Player 1. That
 * is the mapping the score cards and the lobby already use, and a result
 * dialog that numbered players differently from the rest of the app would
 * introduce a second, conflicting numbering at the exact moment a player is
 * trying to remember which one they were.
 */

import { GameKind, getGameMetadata, PlayerColor, SessionMode } from "@/engine/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/primitives/Button";
import { Modal } from "@/components/primitives/Modal";

export type GameOverReason =
  | { readonly kind: "win"; readonly winner: PlayerColor }
  | { readonly kind: "draw" }
  | { readonly kind: "abandoned" }
  | { readonly kind: "conflict"; readonly detail: string };

export interface GameOverDialogProps {
  /** `null` keeps the dialog closed. */
  readonly outcome: GameOverReason | null;
  readonly gameKind: GameKind;
  /**
   * Which mode the result is being reported in. It changes the copy, not the
   * facts: an online player has an opponent to distinguish themselves from, a
   * local one has a hot seat to name.
   */
  readonly mode: SessionMode;
  readonly localSeat: PlayerColor;
  /** Re-runs the history replay against the server copy. */
  readonly onRevalidate?: () => void;
  /** True while a re-verify is on the wire. */
  readonly isRevalidating?: boolean;
  readonly onPlayAgain: () => void;
  readonly onBackToLobby: () => void;
  /** Shown under the headline on a conflict, from the integrity gate. */
  readonly conflictDetail?: string | null;
}

const COLOR_NAME: Record<PlayerColor, string> = { black: "Black", white: "White" };

/** Black is Player 1 everywhere in the app; see the note at the top. */
const PLAYER_NUMBER: Record<PlayerColor, string> = { black: "1", white: "2" };

/** "Player 1 (Black)" — the form the score cards use. */
function seatLabel(color: PlayerColor): string {
  return `Player ${PLAYER_NUMBER[color]} (${COLOR_NAME[color]})`;
}

function headline(outcome: GameOverReason, mode: SessionMode, localSeat: PlayerColor): string {
  const local = mode === "offline_local";
  switch (outcome.kind) {
    case "win":
      // Locally there is no "you" to speak to, so the seat itself is named.
      // Online, the person reading is the subject.
      return local
        ? `${seatLabel(outcome.winner)} Wins!`
        : outcome.winner === localSeat
          ? `Victory! You won as ${COLOR_NAME[localSeat]} (Player ${PLAYER_NUMBER[localSeat]})`
          : `Defeat. Opponent won as ${COLOR_NAME[outcome.winner]} (Player ${PLAYER_NUMBER[outcome.winner]})`;
    case "draw":
      return local ? "Match Drawn!" : "Draw. The match ended in a tie.";
    case "abandoned":
      return "Match abandoned";
    case "conflict":
      return "This match is out of sync";
  }
}

function body(
  outcome: GameOverReason,
  gameKind: GameKind,
  mode: SessionMode,
  localSeat: PlayerColor
): string {
  const name = getGameMetadata(gameKind).name;
  switch (outcome.kind) {
    case "win": {
      // Both the headline and the body name the winner, and the online body
      // names *both* seats. The headline answers "who won"; the body answers
      // "and was that me", which a headline that only names the winner leaves
      // a player to work out from memory of the last move.
      if (mode === "offline_local") {
        return `${seatLabel(outcome.winner)} has won the game.`;
      }
      // Two facts and no third: who won, and which seat the reader held. A
      // further clause naming "the seat you did not hold" reads as a
      // contradiction the moment the reader is the loser, and adds nothing the
      // two sentences above do not already say.
      return (
        `${COLOR_NAME[outcome.winner]} (Player ${PLAYER_NUMBER[outcome.winner]}) has won ` +
        `the ${name}. You played ${COLOR_NAME[localSeat]} (Player ${PLAYER_NUMBER[localSeat]}).`
      );
    }
    case "draw":
      return mode === "offline_local"
        ? "Neither player can claim victory."
        : "The match ended in a tie.";
    case "abandoned":
      return `The ${name} was ended before a result was reached.`;
    case "conflict":
      return (
        `The board on this device and the move log on the server no longer agree, so the ${name} ` +
        "is paused. Nothing has been scored and nothing has been lost — the two copies simply " +
        "need to be reconciled before anyone moves again."
      );
  }
}

/**
 * A disc in the winner's colour, so the result is legible before a word of the
 * copy is read. On a draw or an abandoned match there is nobody to colour it
 * for, and the badge is omitted rather than shown in a neutral grey that would
 * look like a result nobody won.
 */
function WinnerBadge({ winner }: { winner: PlayerColor }): React.ReactElement {
  const isBlack = winner === "black";
  return (
    <span
      data-winner-badge={winner}
      className="inline-flex items-center gap-2 rounded-full border border-board-border bg-board-subtle py-1 pl-1 pr-3"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-5 rounded-full",
          // White is pearl with a rim, black is a near-black with a highlight:
          // the same treatment the board discs get, so a result screen and a
          // mid-game board speak the same visual language.
          isBlack
            ? "bg-[radial-gradient(circle_at_32%_26%,#52525b_0%,#18181b_42%,#000000_100%)]"
            : "border border-neutral-300 bg-white"
        )}
      />
      <span className="text-xs font-medium text-board-dark">
        {COLOR_NAME[winner]} · Player {PLAYER_NUMBER[winner]}
      </span>
    </span>
  );
}

export function GameOverDialog({
  outcome,
  gameKind,
  mode,
  localSeat,
  onRevalidate,
  isRevalidating = false,
  onPlayAgain,
  onBackToLobby,
  conflictDetail,
}: GameOverDialogProps): React.ReactElement | null {
  if (!outcome) return null;
  const isConflict = outcome.kind === "conflict";
  // A conflict is never dismissible into a state where the player believes the
  // result stands, so it has no Escape or backdrop exit and no "play again" —
  // the only way forward is an explicit reconciliation. A finished match, by
  // contrast, can be closed out with the actions below.

  return (
    <Modal
      open
      // `dismissible={false}` is what makes this a result screen rather than
      // a piece of ambient UI.
      dismissible={false}
      onClose={() => undefined}
      title={headline(outcome, mode, localSeat)}
      headerAccessory={outcome.kind === "win" ? <WinnerBadge winner={outcome.winner} /> : undefined}
      panelClassName="max-w-md"
    >
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-board-dark/80">
          {body(outcome, gameKind, mode, localSeat)}
        </p>

        {isConflict && conflictDetail ? (
          <p
            role="status"
            className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-board-dark"
          >
            {conflictDetail}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onBackToLobby}>
            Back to games
          </Button>
          {isConflict ? (
            <Button
              variant="primary"
              onClick={onRevalidate}
              loading={isRevalidating}
              loadingLabel="Re-checking"
              disabled={!onRevalidate}
            >
              Re-check against server
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={onPlayAgain}
              className={cn(outcome.kind === "win" && "bg-success text-white hover:bg-success/90")}
            >
              Play again
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
