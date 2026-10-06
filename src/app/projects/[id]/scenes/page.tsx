import { Suspense } from "react";
import { ScenesPage } from "@/components/studio/scenes/scenes-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ScenesPage projectId={id} />
    </Suspense>
  );
}
