import { Switch } from "@groot/ui/switch";

export function EveryBotSwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="bg-secondary/50 flex items-start gap-3 rounded-2xl p-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Every bot</p>
        <p className="text-muted-foreground text-xs">
          Bots you make later get it too, including bots shared with guests. Project chats get it
          only when ticked below.
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label="Every bot" />
    </div>
  );
}
