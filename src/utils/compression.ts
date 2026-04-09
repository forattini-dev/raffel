import zlib from 'node:zlib'

export interface CompressedData {
  __compressed: true
  __data: string
  __originalSize?: number
}

export function compressToBase64(data: string): string {
  const buffer = Buffer.from(data, 'utf8')
  return zlib.gzipSync(buffer).toString('base64')
}

export function decompressFromBase64(base64: string): string {
  const buffer = Buffer.from(base64, 'base64')
  return zlib.gunzipSync(buffer).toString('utf8')
}

export function compressData(data: string): CompressedData {
  const buffer = Buffer.from(data, 'utf8')
  const compressed = zlib.gzipSync(buffer)
  return {
    __compressed: true,
    __data: compressed.toString('base64'),
    __originalSize: buffer.length,
  }
}

export function isCompressedData(data: unknown): data is CompressedData {
  return typeof data === 'object' && data !== null && '__compressed' in data
}
