import { cn } from "@groot/ui/lib/utils";

interface BotAvatarProps {
  name: string;
  className?: string;
}

function avatarUrl(name: string): string {
  return `https://api.dicebear.com/10.x/gaze/svg?seed=${encodeURIComponent(name)}`;
}

export function BotAvatar({ name, className }: BotAvatarProps) {
  return (
    <img
      src={avatarUrl(name)}
      alt=""
      aria-hidden
      loading="lazy"
      className={cn("shrink-0 rounded-full bg-muted", className ?? "size-11")}
    />
  );
}
