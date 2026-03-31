/**
 * pdfjs-dist (per pdf-parse v2) tikisi naršyklės API. Vercel serverless Node neturi DOMMatrix / Path2D.
 * Šį modulį importuoti prieš bet kokį `pdf-parse` įkėlimą.
 */
export function installNodeDomPolyfillsForPdf(): void {
  const g = globalThis as Record<string, unknown>;

  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrixStub {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
    };
  }

  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2DStub {
      constructor() {}
    };
  }
}

installNodeDomPolyfillsForPdf();
