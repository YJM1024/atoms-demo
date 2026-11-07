export type AgentRole = 'user' | 'pm' | 'architect' | 'engineer' | 'tester';
export type StepStatus = 'running' | 'done' | 'error';
export type VersionMode = 'full' | 'patch' | 'rewrite' | 'rollback' | 'fix';

export interface ChatMessage {
  id: string;
  role: AgentRole;
  content: string;
  status: StepStatus;
  createdAt: number;
  version?: number;
  /** Tester report that exhausted the auto-fix budget and offers a manual re-run. */
  needsFix?: boolean;
  /** Legacy field from early projects; versions now live in project_versions. */
  code?: string;
}

/** Mirrors the `projects` table contract. */
export interface Project {
  id: number;
  title: string;
  prompt: string;
  code?: string | null;
  messages?: string | null;
  version?: number | null;
  created_at?: string;
  updated_at?: string;
}

export type ProjectUpdate = Partial<Pick<Project, 'title' | 'code' | 'messages' | 'version'>>;

/** Mirrors the `project_versions` table contract. */
export interface ProjectVersion {
  id: number;
  project_id: number;
  version: number;
  code: string;
  summary?: string | null;
  mode?: VersionMode | string | null;
  /** Auto-fix rounds this request went through; null on versions saved before this was tracked. */
  fix_rounds?: number | null;
  /** Final tester verdict; null when not recorded (legacy rows). */
  test_passed?: boolean | null;
  /** Remaining tester issues (one per line) when the version failed testing. */
  test_issues?: string | null;
  created_at?: string;
}

export interface VersionTestFields {
  fix_rounds: number;
  test_passed: boolean | null;
  test_issues: string;
}

export interface NewVersion extends VersionTestFields {
  project_id: number;
  version: number;
  code: string;
  summary: string;
  mode: VersionMode;
}

export interface SharedProject {
  title: string;
  code: string;
  version: number;
  updated_at?: string | null;
}
