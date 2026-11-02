// Saving a file the person asked for: the browser's own download, or, inside the Android app (whose web
// view cannot download a file made on the page), the phone's «save as» window.

interface AndroidBridge {
  saveFile?(name: string, mime: string, base64: string): void
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(binary)
}

export async function saveFile(data: BlobPart, fileName: string, mime: string): Promise<void> {
  const blob = new Blob([data], { type: mime })
  const bridge = (window as unknown as { M2Android?: AndroidBridge }).M2Android
  if (bridge?.saveFile) {
    bridge.saveFile(fileName, mime, toBase64(new Uint8Array(await blob.arrayBuffer())))
    return
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
