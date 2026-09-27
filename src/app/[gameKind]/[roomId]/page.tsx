import { notFound } from "next/navigation";

import { isGameKind } from "@/engine/types";
import { RealtimeGameRoute } from "@/components/game/RealtimeGameRoute";

/**
 * Phase 5.3 — the realtime match route.
 *
 * The whole surface of a realtime match is the URL: `/{gameKind}/{roomId}` is
 * the invitation, and it is the only thing a second player needs. There is no
 * lobby step and no join code, which is why this route does nothing but
 * validate its two params and hand them to the client half that opens the
 * channel.
 */
export default async function RealtimeGamePage({
  params,
}: {
  params: Promise<{ gameKind: string; roomId: string }>;
}): Promise<React.ReactElement> {
  const { gameKind, roomId } = await params;
  if (!isGameKind(gameKind)) notFound();

  return <RealtimeGameRoute gameKind={gameKind} roomId={roomId} />;
}
