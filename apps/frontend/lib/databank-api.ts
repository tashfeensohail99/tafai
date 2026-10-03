'use client';

import {
  copyDatabankFile,
  createDatabankFolder,
  createPersonalDatabankFolder,
  databankVersionSignedUrl,
  deleteDatabankFile,
  deleteDatabankFolder,
  deleteDatabankVersion,
  directUploadDatabankFile,
  fetchDatabankByAssociate,
  fetchDatabankFileVersions,
  fetchDatabankTrash,
  fetchDatabankTree,
  fetchPersonalDatabankTree,
  getDatabankFileSignedUrl,
  moveDatabankFile,
  moveDatabankFolder,
  purgeDatabankFile,
  purgeDatabankFolder,
  renameDatabankFile,
  renameDatabankFolder,
  renameDatabankVersion,
  restoreDatabankFile,
  restoreDatabankFolder,
  restoreDatabankVersion,
  searchDatabankFiles,
  updateDatabankFile,
  uploadDatabankFile,
  uploadDatabankFileVersion,
  uploadPersonalDatabankFile,
  type ApiDatabankByAssociate,
  type ApiDatabankFile,
  type ApiDatabankFolder,
  type ApiDatabankTree,
  type DatabankFileSource,
  type DatabankSearchParams,
  type DatabankSearchResult,
  type DatabankUploadTarget,
  type TrashItem,
  type Version,
} from './processing';
import {
  copyJrDatabankFile,
  createJrDatabankFolder,
  createJrPersonalFolder,
  deleteJrDatabankFile,
  deleteJrDatabankFolder,
  deleteJrDatabankVersion,
  directUploadJrDatabankFile,
  fetchJrDatabankByAssociate,
  fetchJrDatabankFileVersions,
  fetchJrDatabankTrash,
  fetchJrDatabankTree,
  fetchJrPersonalTree,
  jrDatabankFileSignedUrl,
  jrDatabankVersionSignedUrl,
  moveJrDatabankFile,
  moveJrDatabankFolder,
  purgeJrDatabankFile,
  purgeJrDatabankFolder,
  renameJrDatabankFile,
  renameJrDatabankFolder,
  renameJrDatabankVersion,
  restoreJrDatabankFile,
  restoreJrDatabankFolder,
  restoreJrDatabankVersion,
  searchJrDatabankFiles,
  updateJrDatabankFile,
  uploadJrDatabankFile,
  uploadJrDatabankFileVersion,
  uploadJrPersonalFile,
} from './jr-databank';
import { apiFetch } from './api-client';
import type { DatabankBasePath } from './databank-upload/transport';
import type { ListOpenUploadsResponse } from './databank-upload/api-types';

export type { OpenUpload } from './databank-upload/api-types';

/**
 * The caller's unfinished upload sessions for ONE portal (UPLOADING not-expired,
 * COMPLETING, or recently-FAILED) — the data behind the "resume your interrupted
 * uploads" banner. A browser can't keep File handles across a page reload, so the
 * in-memory queue is gone after a refresh even though the server-side session and
 * its already-uploaded parts live on (a ~6-day window); this lets the banner ask
 * the user to re-select the files so the resumable engine can continue them.
 */
export function fetchOpenUploads(base: DatabankBasePath): Promise<ListOpenUploadsResponse> {
  return apiFetch<ListOpenUploadsResponse>(`${base}/uploads`, { cache: 'no-store' }).then((r) => ({
    uploads: r.uploads ?? [],
    hasMore: r.hasMore ?? false,
  }));
}

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
  /** Rename AND/OR set metadata (description, tags) in one PATCH. */
  updateFile(
    fileId: string,
    patch: { fileName?: string; description?: string | null; tags?: string[] },
  ): Promise<ApiDatabankFile>;
  /** Full-text / fuzzy file search with server-side pagination + type facets. */
  search(params: DatabankSearchParams): Promise<DatabankSearchResult>;
  moveFile(fileId: string, folderId: string | null): Promise<ApiDatabankFile>;
  copyFile(fileId: string, opts?: { targetClientId?: string; targetFolderId?: string | null }): Promise<ApiDatabankFile>;
  deleteFile(fileId: string): Promise<unknown>;

  // ---- Trash (P3-1) — distinct names from the soft-delete deleteFile/deleteFolder.
  /** The TOP-LEVEL trashed items in ONE scope (a client or the caller's personal area). */
  fetchTrash(scope: { clientId: string } | { personal: true }): Promise<TrashItem[]>;
  /** Restore a trashed folder (and its trashed subtree) back into the databank. */
  restoreTrashedFolder(folderId: string): Promise<unknown>;
  /** Restore a trashed file back into the databank. */
  restoreTrashedFile(fileId: string): Promise<unknown>;
  /** PERMANENTLY remove a trashed folder + its whole subtree (frees storage). */
  purgeTrashedFolder(folderId: string): Promise<{ purgedFolders: number; purgedFiles: number }>;
  /** PERMANENTLY remove a trashed file (frees its storage). */
  purgeTrashedFile(fileId: string): Promise<{ id: string; purged: true }>;

  // ---- File versions (P3-2) ----
  /** A file's version history (newest first) + the `etag` to echo back as If-Match. */
  listFileVersions(fileId: string): Promise<{ etag: string; versions: Version[] }>;
  /** A fresh short-lived signed URL for ONE version's bytes. */
  versionSignedUrl(fileId: string, versionId: string): Promise<{ url: string; fileName: string; mimeType: string | null }>;
  /** Upload a NEW version of an existing file (presign → sha256 → PUT → commit). */
  uploadFileVersion(fileId: string, file: File, onProgress?: (fraction: number) => void): Promise<ApiDatabankFile>;
  /** Make an older version the current one (If-Match → 412 on a stale history). */
  restoreFileVersion(fileId: string, versionId: string, ifMatch?: string): Promise<ApiDatabankFile>;
  /** Set a version's human label; returns the refreshed `{ etag, versions }`. */
  renameFileVersion(fileId: string, versionId: string, name: string, ifMatch?: string): Promise<{ etag: string; versions: Version[] }>;
  /** PERMANENTLY delete a NON-current version (409 if it is the current one). */
  deleteFileVersion(fileId: string, versionId: string, ifMatch?: string): Promise<{ id: string; deleted: true }>;
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
  updateFile: updateDatabankFile,
  search: searchDatabankFiles,
  moveFile: moveDatabankFile,
  copyFile: copyDatabankFile,
  deleteFile: deleteDatabankFile,
  fetchTrash: fetchDatabankTrash,
  restoreTrashedFolder: restoreDatabankFolder,
  restoreTrashedFile: restoreDatabankFile,
  purgeTrashedFolder: purgeDatabankFolder,
  purgeTrashedFile: purgeDatabankFile,
  listFileVersions: fetchDatabankFileVersions,
  versionSignedUrl: databankVersionSignedUrl,
  uploadFileVersion: uploadDatabankFileVersion,
  restoreFileVersion: restoreDatabankVersion,
  renameFileVersion: renameDatabankVersion,
  deleteFileVersion: deleteDatabankVersion,
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
  updateFile: updateJrDatabankFile,
  search: searchJrDatabankFiles,
  moveFile: moveJrDatabankFile,
  copyFile: copyJrDatabankFile,
  deleteFile: deleteJrDatabankFile,
  fetchTrash: fetchJrDatabankTrash,
  restoreTrashedFolder: restoreJrDatabankFolder,
  restoreTrashedFile: restoreJrDatabankFile,
  purgeTrashedFolder: purgeJrDatabankFolder,
  purgeTrashedFile: purgeJrDatabankFile,
  listFileVersions: fetchJrDatabankFileVersions,
  versionSignedUrl: jrDatabankVersionSignedUrl,
  uploadFileVersion: uploadJrDatabankFileVersion,
  restoreFileVersion: restoreJrDatabankVersion,
  renameFileVersion: renameJrDatabankVersion,
  deleteFileVersion: deleteJrDatabankVersion,
};
