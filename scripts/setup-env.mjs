import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const example = join(root, ".env.example");
const target = join(root, ".env");

if (existsSync(target)) {
  console.log(".env jau yra — neperrašiau. Jei reikia šviežio šablono, ištrink .env ir paleisk dar kartą.");
  process.exit(0);
}

copyFileSync(example, target);
console.log("Sukurta .env iš .env.example projekto šaknyje.");
console.log("Atidaryk .env ir įrašyk slaptažodžius bei raktus.");
