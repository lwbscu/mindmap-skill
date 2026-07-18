import { layoutWithElk } from "./layout-profiles.mjs";

self.addEventListener("message", async (event) => {
  try {
    const diagram = await layoutWithElk(event.data?.diagram ?? {}, event.data?.viewType ?? "architecture");
    self.postMessage({ ok: true, diagram });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
