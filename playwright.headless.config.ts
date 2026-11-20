import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  reporter: "list",
  use: { ...base.use, headless: true },
});
