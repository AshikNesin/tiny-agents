export interface WorkspaceFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  isGenerated: boolean;
  hash: string;
  viewed?: boolean;
}

export type FileStatus = WorkspaceFile["status"];

export function treeOrder<T extends { path: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const x = a.path.split("/");
    const y = b.path.split("/");
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const xDir = i < x.length - 1;
      const yDir = i < y.length - 1;
      if (xDir !== yDir) return xDir ? -1 : 1;
      if (x[i] !== y[i]) return x[i]!.localeCompare(y[i]!);
    }
    return x.length - y.length;
  });
}
