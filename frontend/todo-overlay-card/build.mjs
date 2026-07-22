import { build } from "esbuild";

const outfile = "../../custom_components/todo_overlay/frontend_dist/todo-overlay.js";

await build({
    entryPoints: ["src/todo-overlay.ts"],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile,
});

console.log(`Built ${outfile}`);
