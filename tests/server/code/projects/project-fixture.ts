import { createWorkspace } from "../../../../apps/web/src/server/api/code/code.workspace";
import { createProject } from "../../../../apps/web/src/server/api/code/code.projects";
import { installAppForTests } from "../../../../apps/web/src/server/app-root";
import type { CodeProjectRow } from "../../../../apps/web/src/server/db";
import { fakeGitHub, type FakeGitHub } from "./fake-github";
import { bareRepo, localExec, type LocalExec } from "./local-exec";

export interface ProjectFixture {
  project: CodeProjectRow;
  local: LocalExec;
  github: FakeGitHub;
  cleanup(): void;
}

export async function seedProject(defaultInstanceId: string): Promise<ProjectFixture> {
  const local = localExec();
  const bare = await bareRepo(local);
  const github = fakeGitHub(local, bare);
  const ws = createWorkspace({
    exec: local.exec,
    credential: { kind: "token", token: async () => "ghs_test" },
    remoteUrl: () => bare,
  });
  installAppForTests({
    codeGitHub: {
      client: async () => github,
      workspace: async () => ws,
      credential: async () => "token",
      installationFor: async () => 4242,
      appRepositories: async () => [{ fullName: "acme/web", installationId: 4242, private: true }],
      convertManifest: async () => {
        throw new Error("No GitHub App in this test.");
      },
    },
  });
  const project = await createProject({ repo: "acme/web", defaultInstanceId });
  return {
    project,
    local,
    github,
    cleanup() {
      installAppForTests({ codeGitHub: undefined, codeBranchNamer: undefined });
      local.cleanup();
    },
  };
}
