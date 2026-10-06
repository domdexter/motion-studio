import { GraphicsPage } from "@/components/studio/assets/asset-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GraphicsPage projectId={id} />;
}
