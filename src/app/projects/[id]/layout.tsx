import { WorkspaceShell } from "@/components/studio/workspace/workspace-shell";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkspaceShell projectId={id}>{children}</WorkspaceShell>;
}
