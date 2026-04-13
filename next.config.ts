import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Kai C:\Users\<user>\ turi kitą package-lock.json, Next gali painioti šaknį.
  // process.cwd() = katalogas, iš kur paleistas `npm run dev` / `next build` (projekto šaknis).
  outputFileTracingRoot: path.resolve(process.cwd()),
  // IMAP / paštas — nebundlinti į vieną failą (kartais sukelia 500 paleidžiant route).
  serverExternalPackages: [
    "@prisma/client",
    "imapflow",
    "mailparser",
    "nodemailer",
    "@azure/identity",
    "@napi-rs/canvas",
    // pdf-parse → pdfjs-dist: bundlintas Webpack sugadina pdf.mjs (__webpack_require__.r ant ne objekto)
    "pdf-parse",
    "pdfjs-dist",
  ],
};

export default nextConfig;
