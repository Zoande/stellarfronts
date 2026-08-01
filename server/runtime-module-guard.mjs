import { register } from "node:module";

register("./runtime-module-hooks.mjs", import.meta.url, {
  data: {
    rootAuthStoreUrl: new URL("./auth-store.ts", import.meta.url).href,
  },
});
