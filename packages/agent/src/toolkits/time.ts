/** The `time` toolkit: the current date and time, in the owner's timezone by default. */
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";

export interface TimeToolkitOptions {
  /** IANA zone used when the model passes none. Default: the server's zone. */
  timeZone?: string;
  /** Clock override (tests). */
  now?: () => Date;
}

export function createTimeToolkit(options: TimeToolkitOptions = {}): Capability {
  const now = options.now ?? (() => new Date());
  const fallbackZone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const currentTime = defineTool({
    name: "current_time",
    description:
      "Get the current date and time. Pass an IANA timezone (e.g. 'Asia/Kolkata') for another zone; default is the owner's.",
    parameters: Type.Object({ timeZone: Type.Optional(Type.String()) }),
    replay: "safe",
    execute: async (args) => {
      const zone = args.timeZone || fallbackZone;
      const date = now();
      let local: string;
      try {
        local = new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          dateStyle: "full",
          timeStyle: "long",
        }).format(date);
      } catch {
        return { output: [{ type: "text", text: `Unknown timezone "${zone}".` }], isError: true };
      }
      return {
        output: [{ type: "text", text: `${local} (${zone}); ISO ${date.toISOString()}` }],
      };
    },
  });

  return {
    id: "time",
    kind: "toolkit",
    name: "Time",
    description: "Current date and time",
    extension: defineExtension({ name: "time", tools: [currentTime] }),
    tools: [
      {
        name: "current_time",
        label: "Checked the time",
        description: "Current date and time",
        readOnly: true,
      },
    ],
  };
}
