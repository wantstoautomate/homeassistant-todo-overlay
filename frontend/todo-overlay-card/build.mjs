import { build } from "esbuild";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { globSync } from "glob";
import path from "path";

const dist = "dist";

mkdirSync(dist, { recursive: true });

// Remove old hashed bundles
for (const file of globSync(path.join(dist, "todo-overlay.*.js"))) {
    rmSync(file);
}

// Build to a temporary file
const tmp = path.join(dist, "todo-overlay.bundle.js");

await build({
    entryPoints: ["src/todo-overlay.ts"],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: tmp,
});

const contents = readFileSync(tmp);

const hash = createHash("sha256")
    .update(contents)
    .digest("hex")
    .slice(0, 8);

const hashed = `todo-overlay.${hash}.js`;

writeFileSync(
    path.join(dist, hashed),
    contents,
);

rmSync(tmp);

// Stable loader
writeFileSync(
    path.join(dist, "todo-overlay.js"),
    `import "./${hashed}";\n`,
);

console.log(`Built ${hashed}`);
