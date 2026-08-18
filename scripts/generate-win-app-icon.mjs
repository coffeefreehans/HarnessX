/** Generate a multi-resolution Windows ICO without electron-builder's PNG conversion step. */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(packageRoot, 'build', 'app-icon.png')
const outputPath = join(packageRoot, 'build', 'app-icon.ico')
const iconSizes = [16, 32, 48, 64, 256]

const source = await readFile(sourcePath)
const images = await Promise.all(iconSizes.map(size => sharp(source)
  .resize(size, size, { fit: 'fill' })
  .png({ bitdepth: 8, compressionLevel: 9 })
  .toBuffer()))

const headerSize = 6
const entrySize = 16
const dataOffset = headerSize + entrySize * images.length
const header = Buffer.alloc(dataOffset)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)

let imageOffset = dataOffset
for (const [index, image] of images.entries()) {
  const size = iconSizes[index]
  if (size === undefined) throw new Error('Windows icon size is missing')
  const entryOffset = headerSize + index * entrySize
  header.writeUInt8(size === 256 ? 0 : size, entryOffset)
  header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1)
  header.writeUInt8(0, entryOffset + 2)
  header.writeUInt8(0, entryOffset + 3)
  header.writeUInt16LE(1, entryOffset + 4)
  header.writeUInt16LE(32, entryOffset + 6)
  header.writeUInt32LE(image.byteLength, entryOffset + 8)
  header.writeUInt32LE(imageOffset, entryOffset + 12)
  imageOffset += image.byteLength
}

await writeFile(outputPath, Buffer.concat([header, ...images]))
