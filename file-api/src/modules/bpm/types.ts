/** BPM 表單附件(F6;API.md §3、LEGACY-INVENTORY.md §5)。NaNa 只讀,欄位對應 NoCmDocument / ProcessInstance */

export interface BpmAttachment {
  /** NoCmDocument.OID(32 碼十六進位) */
  doid: string;
  /** 中文原檔名(logicalName) */
  originalName: string;
  ext: string | null;
  /** 加密檔名;只在 file-api 內部組取檔路徑,不對外回傳 */
  physicalName: string;
  createdAt: Date | null;
  /** 所屬表單;附件沒有關聯到流程時為 null */
  serialNumber: string | null;
  formName: string | null;
  subject: string | null;
}

export interface BpmRepo {
  /** 依單號完全比對(不用 LIKE,避免比對到其他表單) */
  bySerialNumber(serialNumber: string): Promise<BpmAttachment[]>;
  byDoid(doid: string): Promise<BpmAttachment | null>;
}

/** 單號:英數、底線、連字號(例 CustomerComplaintProcess00000014、THR005_00000519) */
export const SERIAL_RE = '^[A-Za-z0-9_-]{1,100}$';
/** Doid:NoCmDocument.OID */
export const DOID_RE = '^[0-9a-fA-F]{32}$';
