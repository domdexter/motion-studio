import { Overview } from "@/components/studio/workspace/overview";

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Overview projectId={id} />;
}
