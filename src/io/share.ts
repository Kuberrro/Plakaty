/**
 * Zapis pliku na iPhonie. Arkusz udostępniania jest pewniejszy w trybie web app
 * niż pobieranie blobów; zwykły link działa jako rezerwa.
 * Zwraca true tylko wtedy, gdy użytkownik nie anulował.
 */
export async function saveFile(name: string, content: string, type: string): Promise<boolean> {
  const file = new File([content], name, { type });
  if (navigator.maxTouchPoints > 1 && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
