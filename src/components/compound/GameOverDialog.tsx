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
 */

import { GameKind, getGameMetadata, PlayerColor } from "@/engine/types";
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

function headline(outcome: GameOverReason, localSeat: PlayerColor): string {
  switch (outcome.kind) {
    case "win":
      return outcome.winner === localSeat ? "You win" : "You lose";
    case "draw":
      return "Draw";
    case "abandoned":
      return "Match abandoned";
    case "conflict":
      return "This match is out of sync";
  }
}

function body(outcome: GameOverReason, gameKind: GameKind, localSeat: PlayerColor): string {
  const name = getGameMetadata(gameKind).name;
  switch (outcome.kind) {
    case "win":
      return outcome.winner === localSeat
        ? `You finished the ${name} ahead.`
        : `Your opponent finished the ${name} ahead.`;
    case "draw":
      return `The ${name} ended level. Neither player can take it from here.`;
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

export function GameOverDialog({
  outcome,
  gameKind,
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
      title={headline(outcome, localSeat)}
      panelClassName="max-w-md"
    >
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-board-dark/80">{body(outcome, gameKind, localSeat)}</p>

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
