import { RenderPage } from "@/components/studio/render/render-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RenderPage projectId={id} />;
}
