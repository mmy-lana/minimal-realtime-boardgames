import { notFound } from "next/navigation";

import { isGameKind } from "@/engine/types";
import { LocalGameRoute } from "@/components/game/LocalGameRoute";

/**
 * Phase 5.2 — the local match route.
 *
 * The session is auto-instantiated the first time a kind is opened and resumed
 * on every visit after that, so the route stays a thin shell: it validates
 * the param, hands the kind to a client component, and gets out of the way.
 * Instantiating in Dexie is the plan's requirement — a local match must survive
 * a refresh without ever touching the network.
 */
export default async function LocalGamePage({
  params,
  searchParams,
}: {
  params: Promise<{ gameKind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const { gameKind } = await params;
  if (!isGameKind(gameKind)) notFound();

  const query = await searchParams;
  const sessionParam = query.session;
  const sessionId = typeof sessionParam === "string" ? sessionParam : null;

  return <LocalGameRoute gameKind={gameKind} resumeSessionId={sessionId} />;
}
