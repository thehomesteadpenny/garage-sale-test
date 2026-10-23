export type Listing = { id: number; title: string; price_cents: number; photo_key: string; status?: string }

export function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function photoUrl(key: string): string {
  return `/photos/${key}`
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message)
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init })
  } catch {
    throw new ApiError('You look offline. Check your connection and try again.', 0, {})
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(String(body.error ?? 'Something went wrong.'), res.status, body)
  return body as T
}

export function postJson<T>(path: string, data: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
}

/** Shrinks a phone photo to at most 1600px on its long side, as a JPEG. */
export async function compressPhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`${file.name} isn’t a photo type this browser can read. Try a JPEG.`)
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t prepare that photo.'))), 'image/jpeg', 0.82),
  )
}
