import { Suspense } from "react";
import { PreviewPage } from "@/components/studio/preview/preview-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <PreviewPage projectId={id} />
    </Suspense>
  );
}
