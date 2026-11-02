import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";

export class ScoreFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreFileError";
  }
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

/** Decodes XML bytes, honouring a UTF-16 byte order mark (some editors still write UTF-16). */
function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Returns the MusicXML text from a file's bytes: plain .musicxml/.xml, or a compressed .mxl,
 * whose root file is named in META-INF/container.xml.
 */
export function musicXmlText(bytes: Uint8Array): string {
  if (!isZip(bytes)) return decodeXml(bytes);

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ScoreFileError("This .mxl file could not be unzipped.");
  }
  const container = files["META-INF/container.xml"];
  let rootPath: string | null = null;
  if (container) {
    const doc = parseXml(strFromU8(container));
    const rootfiles = Array.from(doc.getElementsByTagName("rootfile"));
    const musicXml = rootfiles.find((r) => {
      const type = r.getAttribute("media-type");
      return !type || type === "application/vnd.recordare.musicxml+xml";
    });
    rootPath = musicXml?.getAttribute("full-path") ?? null;
  }
  // Fall back to the first XML file outside META-INF when the container is missing or empty.
  rootPath ??=
    Object.keys(files).find((name) => !name.startsWith("META-INF/") && /\.(xml|musicxml)$/i.test(name)) ?? null;
  const root = rootPath ? files[rootPath] : undefined;
  if (!root) throw new ScoreFileError("This .mxl file has no MusicXML inside.");
  return decodeXml(root);
}

export function parseXml(text: string): Document {
  const errors: string[] = [];
  let doc: Document;
  try {
    doc = new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") errors.push(message);
      },
    }).parseFromString(text, "text/xml") as unknown as Document;
  } catch (e) {
    throw new ScoreFileError(`This file is not valid XML: ${(e as Error).message}`);
  }
  if (errors.length > 0 || !doc.documentElement) {
    throw new ScoreFileError(`This file is not valid XML: ${errors[0] ?? "no root element"}`);
  }
  return doc;
}

/** SHA-256 of the MusicXML text plus the selected part (TECH §2): any edit gives a new version. */
export async function referenceVersion(xmlText: string, partId: string): Promise<string> {
  const data = new TextEncoder().encode(`${xmlText}\u0000${partId}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
