declare module "pdf-parse-debugging-disabled" {
  interface PdfParseInfo {
    Title?: string;
    Author?: string;
    [key: string]: unknown;
  }
  interface PdfParseResult {
    text: string;
    numpages: number;
    info?: PdfParseInfo;
    metadata?: unknown;
    version?: string;
  }
  function pdfParse(data: Buffer | Uint8Array, options?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}
