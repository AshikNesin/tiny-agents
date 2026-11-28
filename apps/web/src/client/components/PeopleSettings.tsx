import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@groot/ui/card";
import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import { useConfirm } from "@groot/ui/primitives";
import type { Guest } from "../../shared/api/people";
import { useBotsStore } from "../store/bots";
import { errorMessage } from "../lib/errors";
import { useGuestMutations, useGuests } from "../queries/people";

const EMPTY = { name: "", email: "", password: "" };

export function PeopleSettings() {
  const list = useGuests();
  const { add: addGuest, remove: removeGuest } = useGuestMutations();
  const guests = list.status === "ready" ? list.data : list.status === "failed" ? list.last : null;
  const loadError = list.status === "failed" ? list.loadError : null;
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const bots = useBotsStore((s) => s.bots);
  const confirm = useConfirm();

  useEffect(() => {
    if (loadError) toast.error(loadError);
  }, [loadError]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setAdding(true);
    try {
      await addGuest.mutateAsync({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      toast.success("Guest added", {
        description: "Share a bot with them from its settings → Sharing.",
      });
      setForm(EMPTY);
      await list.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to add guest"));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (guest: Guest) => {
    const ok = await confirm({
      title: `Remove ${guest.name || guest.email}?`,
      description: "Their account is deleted and they leave every shared chat.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeGuest.mutateAsync(guest.id);
      await list.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to remove guest"));
    }
  };

  const botName = (id: string) => bots.find((bot) => bot.id === id)?.name;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a guest</CardTitle>
          <CardDescription>
            A guest chats with the bots you share with them, in the same chat as you, and can use
            Code. Everything else stays yours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="guest-name">Name</Label>
              <Input
                id="guest-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-email">Email</Label>
              <Input
                id="guest-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="guest-password">Password</Label>
              <Input
                id="guest-password"
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={adding}>
                <UserPlus className="size-4" />
                {adding ? "Adding…" : "Add guest"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Guests</CardTitle>
          <CardDescription>Share a bot with a guest from its settings → Sharing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!guests && <p className="text-muted-foreground text-sm">Loading…</p>}
          {guests?.length === 0 && <p className="text-muted-foreground text-sm">No guests yet.</p>}
          {guests?.map((guest) => {
            const shared = guest.botIds.map(botName).filter(Boolean);
            return (
              <div
                key={guest.id}
                className="bg-secondary/50 flex items-center gap-3 rounded-2xl p-3.5"
                data-testid="guest-row"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{guest.name || guest.email}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {guest.email} ·{" "}
                    {shared.length > 0 ? `Shared: ${shared.join(", ")}` : "No bots shared"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive rounded-xl"
                  onClick={() => void remove(guest)}
                  aria-label={`Remove ${guest.name || guest.email}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
