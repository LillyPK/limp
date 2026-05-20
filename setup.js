import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { $ } from "bun";

const root = import.meta.dir;

mkdirSync(join(root, "data"), { recursive: true });

console.log("Installing server dependencies...");
await $`bun install`.cwd(join(root, "server")).quiet();
console.log("  done");

console.log("Installing client dependencies...");
await $`bun install`.cwd(join(root, "client")).quiet();
console.log("  done");

console.log("Building client...");
await $`bun run build`.cwd(join(root, "client")).quiet();
console.log("  done");

console.log('\nSetup complete. Run "bun run start" to launch the server.');
