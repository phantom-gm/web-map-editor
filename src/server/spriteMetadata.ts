import type { SpriteMetadata } from "../lib/spriteAsset";

const PNG_MAGIC = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_IEND = Buffer.from("49454e44ae426082", "hex");
type Field = number | Buffer;
type Cursor = { offset: number };
export type SpriteProperty = { key?: string; value?: string | null };

function uint(bytes: Buffer, cursor: Cursor): number {
  let value = 0, factor = 1;
  for (let i = 0; i < 8; i++) {
    if (cursor.offset >= bytes.length) throw new Error("Truncated sprite metadata.");
    const b = bytes[cursor.offset++];
    value += (b & 127) * factor;
    if (!Number.isSafeInteger(value)) throw new Error("Sprite metadata integer overflow.");
    if (!(b & 128)) return value;
    factor *= 128;
  }
  throw new Error("Invalid sprite metadata integer.");
}

function take(bytes: Buffer, cursor: Cursor, size: number): Buffer {
  if (size < 0 || cursor.offset + size > bytes.length) throw new Error("Truncated sprite metadata.");
  const value = bytes.subarray(cursor.offset, cursor.offset + size);
  cursor.offset += size;
  return value;
}

function message(bytes: Buffer): Map<number, Field> {
  const fields = new Map<number, Field>();
  const cursor = { offset: 0 };
  while (cursor.offset < bytes.length) {
    const tag = uint(bytes, cursor), field = Math.floor(tag / 8), wire = tag % 8;
    if (!field) throw new Error("Invalid sprite metadata field.");
    if (wire === 0) fields.set(field, uint(bytes, cursor));
    else if (wire === 2) fields.set(field, take(bytes, cursor, uint(bytes, cursor)));
    else if (wire === 5) fields.set(field, take(bytes, cursor, 4).readFloatLE(0));
    else if (wire === 1) take(bytes, cursor, 8);
    else throw new Error("Unsupported sprite metadata wire format.");
  }
  return fields;
}

function nested(value: Field | undefined): Map<number, Field> {
  if (!Buffer.isBuffer(value)) throw new Error("Missing native sprite metadata.");
  return message(value);
}

function finite(value: Field | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid native sprite metric.");
  return value;
}

function pngSize(png: Buffer): [number, number] {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_MAGIC)
      || png.readUInt32BE(8) !== 13 || png.toString("ascii", 12, 16) !== "IHDR"
      || !png.subarray(-PNG_IEND.length).equals(PNG_IEND)) throw new Error("Invalid embedded PNG.");
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (!width || !height) throw new Error("Empty embedded PNG.");
  return [width, height];
}

/** Legacy image-only consumers can still recover PNGs from other .mod layouts. */
export function extractEmbeddedPng(mod: Buffer): Buffer | null {
  const start = mod.indexOf(PNG_MAGIC);
  if (start < 0) return null;
  const end = mod.indexOf(PNG_IEND, start);
  if (end < 0) return null;
  return mod.subarray(start, end + PNG_IEND.length);
}

/**
 * Native UGC sprite .mod: length-delimited header, then length-delimited Sprite payload.
 * Sprite fields: 1/2 native dimensions, 4 normalized pivot, 5 PPU, 10 image(type + bytes).
 * Verified against native tree, building and 4x4 ground sprites. Unknown layouts fail closed;
 * never infer a pivot from a filename or silently substitute thumbnail dimensions.
 */
export function parseSpriteMod(
  mod: Buffer,
  properties: SpriteProperty[] = [],
  version = "",
): { png: Buffer; metadata: SpriteMetadata } {
  const cursor = { offset: 0 };
  take(mod, cursor, uint(mod, cursor)); // container header
  const sprite = message(take(mod, cursor, uint(mod, cursor)));
  if (cursor.offset !== mod.length) throw new Error("Unsupported trailing sprite payload.");
  const image = nested(sprite.get(10));
  if (image.get(1) !== 1 || !Buffer.isBuffer(image.get(2))) throw new Error("Sprite is not an embedded PNG.");
  const png = image.get(2) as Buffer;
  const [width, height] = pngSize(png);
  if (finite(sprite.get(1)) !== width || finite(sprite.get(2)) !== height) {
    throw new Error("Sprite dimensions differ from the PNG canvas; cropped sprites are not supported.");
  }
  const nativePivot = nested(sprite.get(4));
  let pivot: [number, number] = [finite(nativePivot.get(1) ?? 0), finite(nativePivot.get(2) ?? 0)];
  const pixelsPerUnit = finite(sprite.get(5));
  if (pixelsPerUnit <= 0) throw new Error("Invalid sprite pixels per unit.");
  const props = new Map(properties.map(p => [p.key, p.value]));
  let pivotSource: SpriteMetadata["pivotSource"] = "mod";
  if (props.has("pivot_x") || props.has("pivot_y")) {
    const rawX = props.get("pivot_x"), rawY = props.get("pivot_y");
    const x = Number(rawX), y = Number(rawY);
    if (rawX == null || rawY == null || rawX.trim() === "" || rawY.trim() === ""
        || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid storage pivot override.");
    pivot = [x, y];
    pivotSource = "storage";
  }
  return { png, metadata: { width, height, pivot, pixelsPerUnit, version, pivotSource } };
}
