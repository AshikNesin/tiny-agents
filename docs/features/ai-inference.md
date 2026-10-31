# AI Inference

Built-in LLM access via [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi), giving you one API across providers (OpenAI, Anthropic, and more).

The adapter lives in `packages/ai` (`@groot/ai`). It simplifies common operations: text completion, streaming, structured data extraction with Zod, typed prompt tasks, and embeddings.

## Basic usage

```typescript
import { AI } from "@groot/ai";

const ai = new AI({ provider: "anthropic", model: "claude-sonnet-4-6" });

const text = await ai.complete("Translate 'hello world' to French.");

for await (const chunk of ai.stream("Write a short story...")) {
  process.stdout.write(chunk);
}
```

API keys are read automatically from standard env vars (e.g. `OPENAI_API_KEY`), or pass `apiKey` in the config to override.

The gateway keys and `DEFAULT_MODEL` are also in the validated env (`packages/core/src/env.ts`), so app code can pass them explicitly instead of relying on the SDK fallback:

```typescript
import { env } from "@groot/core/env";

const ai = new AI({
  provider: "cloudflare-ai-gateway",
  model: env.DEFAULT_MODEL ?? "claude-sonnet-4-5",
  apiKey: env.CLOUDFLARE_API_KEY,
});
```

Provider keys themselves (e.g. `OPENAI_API_KEY`) are not in `envSchema`: the SDKs read them from `process.env`, and nothing in groot's code path needs them validated.

## Cloudflare AI Gateway

pi-ai includes Cloudflare AI Gateway as a built-in provider:

```typescript
import { getModel } from "@earendil-works/pi-ai/compat";

const model = getModel("cloudflare-ai-gateway", "claude-sonnet-4-5");
```

`CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_GATEWAY_ID`
are read automatically. The provider sends only `cf-aig-authorization`; keep
provider keys in the gateway with BYOK.

## Custom OpenAI-compatible endpoints

For an endpoint that is not in pi-ai's provider catalog, set `baseUrl` and any
required headers directly:

```typescript
const ai = new AI({
  provider: "custom-gateway",
  model: "my-model",
  baseUrl: "https://gateway.example.com/v1",
  headers: { Authorization: "Bearer your-gateway-token" },
});
```

## Structured output (Zod)

Define a Zod object schema and the model is forced to return matching data (via tool calling):

```typescript
import { z } from "zod";

const person = await ai.generateObject({
  prompt: "Extract: John Doe is a 30-year-old software engineer.",
  schema: z.object({
    name: z.string(),
    age: z.number(),
    occupation: z.string().optional(),
  }),
});
// { name: "John Doe", age: 30, occupation: "software engineer" }
```

## Prompt tasks

`definePrompt` packages a task once (typed input → messages → typed output); `ai.execute` runs it:

```typescript
import { definePrompt } from "@groot/ai";

const extractPerson = definePrompt({
  name: "extract-person",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ name: z.string(), age: z.number() }),
  getMessages: (input) => [
    { role: "system", content: "Extract person data from the text." },
    { role: "user", content: input.text },
  ],
});

const result = await ai.execute(extractPerson, { text: "Jane is 28." });

// Same prompt, different model on the same provider/endpoint:
const other = await ai.execute(extractPerson, { text: "Jane is 28." }, { model: "openai/gpt-4o" });
```

Input is validated against `inputSchema` before anything is sent; output is validated against `outputSchema` before it's returned.

## Multimodal inputs

User message content accepts text, image, and file parts (base64, data: URLs, or bytes). Documents like PDFs go through pi-ai as base64 blocks with a document mimeType:

```typescript
const out = await ai.complete({
  prompt: [
    { type: "text", text: "Summarize this document." },
    { type: "image", mimeType: "application/pdf", data: pdfBuffer },
  ],
});
```

Use `getModelCapabilities(modelId)` to check whether a model accepts native documents or images before attaching files (e.g. to decide whether to rasterize a PDF to page images):

```typescript
import { getModelCapabilities } from "@groot/ai";

const caps = getModelCapabilities("google/gemini-3-flash-preview");
// { nativeDocuments: true, nativeImages: true }
```

## Reasoning, embeddings, escape hatch

```typescript
// Thinking/reasoning models
await ai.complete({ prompt: "Solve this…", reasoning: "high" });

// Embeddings (OpenAI, defaults to text-embedding-3-small)
const vectors = await ai.embed(["text one", "text two"]);

// Full pi-ai primitives when the adapter is too limiting
const { model, complete, stream } = ai.raw();
```
