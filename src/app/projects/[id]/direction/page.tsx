import { DirectionPage } from "@/components/studio/creative/direction-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DirectionPage projectId={id} />;
}
