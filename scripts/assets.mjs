import { cp, mkdir } from "node:fs/promises";
await mkdir("public/fonts", { recursive: true });
await cp(
  "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
  "public/fonts",
  { recursive: true },
);
await cp("licenses", "public/licenses", { recursive: true });
