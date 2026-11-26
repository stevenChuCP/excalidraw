import { fileSave } from "browser-fs-access";

/**
 * Saves a text file: in place or through a save dialog where the browser has
 * the File System Access API (Chrome, Edge), as a download elsewhere.
 */
export const saveTextFile = async (
  text: string,
  fileName: string,
  mime: string,
  description: string,
  handle?: FileSystemFileHandle | null,
) => {
  const ext = fileName.match(/\.[^.]+$/)?.[0] || "";
  const blob = new Blob([text], { type: mime });
  return fileSave(
    blob,
    {
      fileName,
      description,
      extensions: ext ? [ext] : undefined,
      mimeTypes: [mime],
    },
    handle || null,
    false,
  );
};

/** true when saving can't go through a file picker and becomes a download */
export const savesAsDownload = () =>
  typeof window === "undefined" || !("showSaveFilePicker" in window);
