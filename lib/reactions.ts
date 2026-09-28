/**
 * The reaction set.
 *
 * Icons are lucide-react component *names* — the allowlist lives here because it
 * is enforced on the server (`POST /api/skies/[id]/react`) and rendered on the
 * client, and the two must never drift apart.
 */

export const REACTION_ICONS = ["sun", "heart", "cloud", "rainbow", "star"] as const;

export type ReactionIcon = (typeof REACTION_ICONS)[number];

export const REACTION_LABELS: Record<ReactionIcon, string> = {
  sun: "Golden",
  heart: "Beloved",
  cloud: "Dreamy",
  rainbow: "Serene",
  star: "Starlit",
};

export function isReactionIcon(value: unknown): value is ReactionIcon {
  return typeof value === "string" && (REACTION_ICONS as readonly string[]).includes(value);
}
