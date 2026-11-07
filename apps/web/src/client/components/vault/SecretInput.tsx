import { useState } from "react";
import { Eye, EyeOff, Wand2 } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";

/** A long random password from the browser's CSPRNG. */
function generatePassword(length = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!@#%";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

/** A masked field with a show toggle and, for passwords, a generator. */
export function SecretInput({
  id,
  value,
  onChange,
  autoComplete = "off",
  generate = false,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  generate?: boolean;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <Input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        spellCheck={false}
        placeholder={placeholder}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => setShown((prev) => !prev)}
        aria-label={shown ? "Hide" : "Show"}
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
      {generate && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => {
            onChange(generatePassword());
            setShown(true);
          }}
          aria-label="Generate a password"
        >
          <Wand2 className="size-4" />
        </Button>
      )}
    </div>
  );
}
