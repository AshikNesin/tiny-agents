import { cn } from "@groot/ui/lib/utils";

interface BotAvatarProps {
  name: string;
  className?: string;
}

const PALETTE = [
  "#0ea5e9",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function botAvatarDataUrl(name: string): string {
  const hash = hashName(name);
  const background = PALETTE[hash % PALETTE.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="24" fill="${background}"/><text x="24" y="30" font-family="system-ui, sans-serif" font-size="18" font-weight="600" fill="#ffffff" text-anchor="middle">${initials(name)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function BotAvatar({ name, className }: BotAvatarProps) {
  return (
    <img
      src={botAvatarDataUrl(name)}
      alt=""
      aria-hidden
      loading="lazy"
      className={cn("shrink-0 rounded-full bg-muted", className ?? "size-11")}
    />
  );
}
