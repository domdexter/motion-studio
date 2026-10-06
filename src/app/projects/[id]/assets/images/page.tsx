import { ImagesPage } from "@/components/studio/assets/asset-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImagesPage projectId={id} />;
}
