import { rmSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
rmSync(path.join(root, "dist"), { recursive: true, force: true });
const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], {
  cwd: root, stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
for (const file of ["rules-frete-desconto.v1.json", "rules-frete-desconto.v2.json"]) {
  copyFileSync(path.join(root, "examples", file), path.join(root, "dist/examples", file));
}
