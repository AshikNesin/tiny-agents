import { cn } from "@groot/shell/lib/utils";

interface BotAvatarProps {
  name: string;
  emoji: string | null;
  color: string;
  className?: string;
}

/**
 * Rounded-square avatar: the bot's emoji, or initials of its name, on the
 * bot's colour (Talorys "T." mark style, PRD §6.1).
 */
export function BotAvatar({ name, emoji, color, className }: BotAvatarProps) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg font-medium text-white select-none",
        className ?? "size-9 text-sm",
      )}
      style={{ backgroundColor: color }}
    >
      {emoji || initials}
    </div>
  );
}
