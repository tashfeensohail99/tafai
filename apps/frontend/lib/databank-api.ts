'use client';

import {
  copyDatabankFile,
  createDatabankFolder,
  createPersonalDatabankFolder,
  deleteDatabankFile,
  deleteDatabankFolder,
  directUploadDatabankFile,
  fetchDatabankByAssociate,
  fetchDatabankTree,
  fetchPersonalDatabankTree,
  getDatabankFileSignedUrl,
  moveDatabankFile,
  moveDatabankFolder,
  renameDatabankFile,
  renameDatabankFolder,
  uploadDatabankFile,
  uploadPersonalDatabankFile,
  type ApiDatabankByAssociate,
  type ApiDatabankFile,
  type ApiDatabankFolder,
  type ApiDatabankTree,
  type DatabankFileSource,
  type DatabankUploadTarget,
} from './processing';
import {
  copyJrDatabankFile,
  createJrDatabankFolder,
  createJrPersonalFolder,
  deleteJrDatabankFile,
  deleteJrDatabankFolder,
  directUploadJrDatabankFile,
  fetchJrDatabankByAssociate,
  fetchJrDatabankTree,
  fetchJrPersonalTree,
  jrDatabankFileSignedUrl,
  moveJrDatabankFile,
  moveJrDatabankFolder,
  renameJrDatabankFile,
  renameJrDatabankFolder,
  uploadJrDatabankFile,
  uploadJrPersonalFile,
} from './jr-databank';
import type { DatabankBasePath } from './databank-upload/transport';

/**
 * ONE Databank, several portals. The explorer (DatabankTab) and the landing
 * (DatabankClientsPage) are built once and talk to the backend only through
 * this adapter; each portal supplies its API prefix (/processing/databank vs
 * /jr/databank — same shared DatabankService behind both), its client-page
 * route and its permission wording. Add a feature to the shared components
 * and every portal gets it — no more parallel Processing / JR copies.
 */
export interface DatabankApi {
  /** This portal's databank API prefix (the resumable-upload routes live under it). */
  uploadBase: DatabankBasePath;
  /** Route to this portal's per-client explorer page. */
  clientHref(clientId: string, name: string): string;
  /** Who besides the owner can see an associate's personal "My folders". */
  personalVisibleTo: string;
  /** Read-only chip shown on a client assigned to someone else. */
  readOnlyLabel: string;
  readOnlyTitle: string;

  fetchByAssociate(q?: string): Promise<ApiDatabankByAssociate>;
  fetchTree(clientId: string): Promise<ApiDatabankTree>;
  fetchPersonalTree(): Promise<ApiDatabankTree>;
  createFolder(clientId: string, name: string, parentFolderId: string | null): Promise<ApiDatabankFolder>;
  createPersonalFolder(name: string, parentFolderId: string | null): Promise<ApiDatabankFolder>;
  /** Small-file multipart upload THROUGH the backend (used for pasted
   *  screenshots so their CLIPBOARD origin is recorded). */
  uploadFile(clientId: string, file: File, folderId: string | null, source: DatabankFileSource): Promise<ApiDatabankFile>;
  uploadPersonalFile(file: File, folderId: string | null, source: DatabankFileSource): Promise<ApiDatabankFile>;
  /** Direct browser→R2 upload with byte progress (0..1); `signal` aborts it. */
  directUpload(
    target: DatabankUploadTarget,
    file: File,
    folderId: string | null,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
    /** commitKey: stored already — only record it. onStored: the bytes are in storage. */
    opts?: { commitKey?: string; onStored?: (storageKey: string) => void },
  ): Promise<ApiDatabankFile>;
  renameFolder(folderId: string, name: string): Promise<unknown>;
  moveFolder(folderId: string, parentFolderId: string | null): Promise<unknown>;
  deleteFolder(folderId: string): Promise<unknown>;
  signedUrl(fileId: string): Promise<{ url: string; fileName: string; mimeType: string | null }>;
  renameFile(fileId: string, fileName: string): Promise<ApiDatabankFile>;
  moveFile(fileId: string, folderId: string | null): Promise<ApiDatabankFile>;
  copyFile(fileId: string, opts?: { targetClientId?: string; targetFolderId?: string | null }): Promise<ApiDatabankFile>;
  deleteFile(fileId: string): Promise<unknown>;
}

export const processingDatabankApi: DatabankApi = {
  uploadBase: '/processing/databank',
  clientHref: (clientId, name) => `/processing/databank/${clientId}?name=${encodeURIComponent(name)}`,
  personalVisibleTo: 'a manager',
  readOnlyLabel: 'View only — assigned to another officer',
  readOnlyTitle: 'This client is assigned to another officer — you can view and download, but not edit.',
  fetchByAssociate: fetchDatabankByAssociate,
  fetchTree: fetchDatabankTree,
  fetchPersonalTree: fetchPersonalDatabankTree,
  createFolder: createDatabankFolder,
  createPersonalFolder: createPersonalDatabankFolder,
  uploadFile: uploadDatabankFile,
  uploadPersonalFile: uploadPersonalDatabankFile,
  directUpload: directUploadDatabankFile,
  renameFolder: renameDatabankFolder,
  moveFolder: moveDatabankFolder,
  deleteFolder: deleteDatabankFolder,
  signedUrl: getDatabankFileSignedUrl,
  renameFile: renameDatabankFile,
  moveFile: moveDatabankFile,
  copyFile: copyDatabankFile,
  deleteFile: deleteDatabankFile,
};

export const jrDatabankApi: DatabankApi = {
  uploadBase: '/jr/databank',
  clientHref: (clientId, name) => `/jr/databank/${clientId}?name=${encodeURIComponent(name)}`,
  personalVisibleTo: 'a JR head',
  readOnlyLabel: 'View only — assigned to another associate',
  readOnlyTitle: 'This client is assigned to another associate — you can view and download, but not modify.',
  fetchByAssociate: fetchJrDatabankByAssociate,
  fetchTree: fetchJrDatabankTree,
  fetchPersonalTree: fetchJrPersonalTree,
  createFolder: createJrDatabankFolder,
  createPersonalFolder: createJrPersonalFolder,
  uploadFile: uploadJrDatabankFile,
  uploadPersonalFile: uploadJrPersonalFile,
  directUpload: directUploadJrDatabankFile,
  renameFolder: renameJrDatabankFolder,
  moveFolder: moveJrDatabankFolder,
  deleteFolder: deleteJrDatabankFolder,
  signedUrl: jrDatabankFileSignedUrl,
  renameFile: renameJrDatabankFile,
  moveFile: moveJrDatabankFile,
  copyFile: copyJrDatabankFile,
  deleteFile: deleteJrDatabankFile,
};
