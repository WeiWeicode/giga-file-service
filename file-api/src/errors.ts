/** 錯誤(BACKEND-GUIDE.md §5.3):自訂代碼以 FILE_ 開頭;不可使用 Gateway 專用代碼(AGENT.md §8) */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = () => new AppError(404, 'FILE_NOT_FOUND', '找不到此檔案');
export const accessDenied = () => new AppError(403, 'DATA_ACCESS_DENIED', '無權存取此檔案');
