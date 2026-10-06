import { VersionsPage } from "@/components/studio/versions/versions-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VersionsPage projectId={id} />;
}
