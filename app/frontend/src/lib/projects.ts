import { client } from './api';
import type { ChatMessage, NewVersion, Project, ProjectUpdate, ProjectVersion, SharedProject } from './types';

const PENDING_PROMPT_KEY = 'pending_prompt';

export function makeTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  return clean.length > 24 ? `${clean.slice(0, 24)}…` : clean || '未命名应用';
}

export async function listProjects(): Promise<Project[]> {
  const res = await client.entities.projects.query({
    sort: '-updated_at',
    limit: 50,
    fields: ['id', 'title', 'prompt', 'version', 'created_at', 'updated_at'],
  });
  return (res.data?.items ?? []) as Project[];
}

export async function getProject(projectId: string): Promise<Project> {
  const res = await client.entities.projects.get({ id: projectId });
  return res.data as Project;
}

export async function createProject(prompt: string): Promise<Project> {
  const res = await client.entities.projects.create({
    data: { title: makeTitle(prompt), prompt, code: '', messages: '[]', version: 0 },
  });
  return res.data as Project;
}

export async function saveProject(projectId: string, data: ProjectUpdate): Promise<void> {
  await client.entities.projects.update({ id: projectId, data });
}

/** Deletes the project with its versions and share links (server-side cascade). */
export async function removeProject(projectId: string): Promise<void> {
  await client.apiCall.invoke({ url: `/api/v1/workspace/projects/${projectId}`, method: 'DELETE', data: {} });
}

export async function listVersions(projectId: string): Promise<ProjectVersion[]> {
  const res = await client.entities.project_versions.query({
    query: { project_id: Number(projectId) },
    sort: '-version',
    limit: 200,
  });
  return (res.data?.items ?? []) as ProjectVersion[];
}

export async function createVersion(data: NewVersion): Promise<ProjectVersion> {
  const res = await client.entities.project_versions.create({ data });
  return res.data as ProjectVersion;
}

/** Updates an existing snapshot in place (used by "auto-fix again", which must not add a version). */
export async function updateVersionRow(
  rowId: number,
  data: Partial<Pick<ProjectVersion, 'code' | 'fix_rounds' | 'test_passed' | 'test_issues'>>,
): Promise<ProjectVersion> {
  const res = await client.entities.project_versions.update({ id: String(rowId), data });
  return res.data as ProjectVersion;
}

export async function getShareToken(projectId: string): Promise<string | null> {
  const res = await client.apiCall.invoke({ url: `/api/v1/workspace/share-status/${projectId}`, method: 'GET', data: {} });
  return res.data?.token ?? null;
}

export async function createShare(projectId: string): Promise<string> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/workspace/share',
    method: 'POST',
    data: { project_id: Number(projectId) },
  });
  return res.data.token as string;
}

export async function revokeShare(projectId: string): Promise<void> {
  await client.apiCall.invoke({ url: `/api/v1/workspace/share/${projectId}`, method: 'DELETE', data: {} });
}

export async function getSharedProject(token: string): Promise<SharedProject> {
  const res = await client.apiCall.invoke({ url: `/api/v1/workspace/public/${token}`, method: 'GET', data: {} });
  return res.data as SharedProject;
}

export const shareUrl = (token: string) => `${window.location.origin}/share/${token}`;

export function parseMessages(raw?: string | null): ChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export const pendingPrompt = {
  set: (value: string) => sessionStorage.setItem(PENDING_PROMPT_KEY, value),
  take: () => {
    const value = sessionStorage.getItem(PENDING_PROMPT_KEY) ?? '';
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
    return value;
  },
};

export function getErrorDetail(error: unknown): string {
  const e = error as { data?: { detail?: string }; response?: { data?: { detail?: string } }; message?: string };
  return e?.data?.detail || e?.response?.data?.detail || e?.message || '请求失败，请稍后重试';
}

export function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
